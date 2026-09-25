"""M23 · D — MIX: publicidad automática, una imagen al día.

El encargo del dueño, textual: «a un asistente le encargan crear contigo, sin
siquiera que lo revise el dueño. Solo quiere publicidad que salga para traer
cosas.» De ahí salen las tres decisiones que mandan sobre este módulo:

  * **la imagen del usuario es la BASE de todas.** No se inventa una foto
    bonita: se parte de la que subió, así que siempre sale SU producto. Eso
    obliga al endpoint de EDITAR de Grok, no al de crear — cruzarlos rompe en
    silencio (`pipeline/media_fal.py`);
  * **nadie revisa nada.** No hay borrador ni aprobación, y Blotato tampoco
    tiene borradores: lo que se genera, sale;
  * **una campaña, una cuenta.** Lo impone el índice parcial `mix_campana_viva`
    en la base, no este módulo.

El tema de cada día se pide el día que toca, pasándole al LLM los que ya
salieron. Se pensó también generar los treinta temas de golpe al encender, y se
descartó: guardar un plan es estado que se desincroniza en cuanto el usuario
cambia algo, y el historial de temas ya vive en `mix_corridas.tema`, que es la
misma tabla que impide publicar dos veces el mismo día.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from . import llm

log = logging.getLogger("mix")

# Tope duro de campaña. No es una preferencia: la campaña se cobra ENTERA por
# adelantado, así que sin tope un rango de dos años pediría 3 650 créditos de
# un golpe y el error se vería como «no te alcanza», no como «eso no se puede».
MAX_DIAS = 60
MIN_DIAS = 1

# Los atajos de la pantalla. El calendario manda: esto solo rellena el rango.
ATAJOS = {"3 días": 3, "1 semana": 7, "2 semanas": 14, "1 mes": 30}

# Los tres botones de tono (decisión del dueño, 18-sep). Cambian de verdad el
# texto y la imagen del día: no son etiquetas decorativas.
TONOS: dict[str, str] = {
    "vender": ("Vende. Invita a comprar, reservar o venir hoy. Una razón "
               "concreta para actuar ahora, sin exagerar ni prometer de más."),
    "informar": ("Informa. Cuenta algo cierto y útil del negocio: cómo se "
                 "hace, qué lo distingue, para quién es. Sin pedir nada."),
    "recordar": ("Recuerda. Mantén el negocio presente con algo cotidiano y "
                 "cálido. Nada de ofertas ni urgencia."),
}
TONO_POR_DEFECTO = "vender"


def tono_valido(tono: str | None) -> str:
    return tono if tono in TONOS else TONO_POR_DEFECTO


def hoy_en(zona: str | None) -> date:
    """Qué día es HOY para el usuario, no para el servidor.

    La Lambda corre en UTC. Sin esto, alguien en América a las siete de la
    tarde elige «hoy» en el calendario y recibe «no puede empezar en una fecha
    que ya pasó», porque para el servidor ya es mañana. Una zona ilegible cae a
    UTC: es mejor un borde raro que un 500 por una cadena del navegador."""
    return ahora_en(zona).date()


def dias_de(empieza: date, termina: date) -> int:
    """Días del rango, contando los dos extremos: del 1 al 3 son TRES días, no
    dos. Es lo que ve quien marca un calendario, y es lo que se cobra."""
    return (termina - empieza).days + 1


def validar_rango(empieza: date, termina: date, hoy: date | None = None) -> int:
    """Devuelve los días del rango o explica en español por qué no vale.

    El mensaje es el que va a leer el dueño de un negocio, no un log: por eso
    dice qué hacer y no qué falló."""
    hoy = hoy or date.today()
    if termina < empieza:
        raise ValueError("La fecha de fin va antes que la de inicio.")
    if empieza < hoy:
        raise ValueError("La campaña no puede empezar en una fecha que ya pasó.")
    dias = dias_de(empieza, termina)
    if dias < MIN_DIAS:
        raise ValueError("Elige al menos un día.")
    if dias > MAX_DIAS:
        raise ValueError(
            f"Por ahora una campaña puede durar hasta {MAX_DIAS} días. "
            f"Elegiste {dias}.")
    return dias


def dia_numero(campana: dict, dia: date) -> int:
    """Qué día de la campaña es (1 = el primero)."""
    empieza = campana["empieza"]
    if isinstance(empieza, str):
        empieza = date.fromisoformat(empieza)
    return (dia - empieza).days + 1


def dias_de_campana(campana: dict) -> list[date]:
    empieza, termina = campana["empieza"], campana["termina"]
    if isinstance(empieza, str):
        empieza = date.fromisoformat(empieza)
    if isinstance(termina, str):
        termina = date.fromisoformat(termina)
    return [empieza + timedelta(days=i) for i in range(dias_de(empieza, termina))]


SISTEMA = """Eres quien lleva las redes de un negocio pequeño en español latinoamericano.
Cada día publicas UNA imagen con su texto. No exageras, no inventas datos que no
te dieron, no prometes descuentos que nadie mencionó y no usas palabras de
relleno de agencia. Escribes como habla la gente.

Devuelves SOLO un JSON con estas llaves:
  "tema"  una frase corta que describe QUÉ se ve en la imagen de hoy, en inglés
          y en modo instrucción visual (va directo a un generador de imágenes)
  "texto" el texto de la publicación, en español, máximo 220 caracteres,
          sin hashtags de relleno (dos como mucho, y solo si suman)
"""


def _usuario_prompt(campana: dict, dia_n: int, total: int,
                    ya_usados: list[str]) -> str:
    partes = [
        f"NEGOCIO Y MOTIVO DE LA CAMPAÑA: {campana.get('motivo') or ''}",
        f"TONO DE HOY: {TONOS[tono_valido(campana.get('tono'))]}",
        f"DÍA {dia_n} DE {total}.",
        "La imagen de hoy parte de una foto real del negocio que ya tenemos: "
        "describe cómo transformarla, no una escena nueva desde cero.",
    ]
    if ya_usados:
        anteriores = "; ".join(t for t in ya_usados[-10:] if t)
        partes.append(f"YA SALIERON estos temas, no los repitas: {anteriores}")
    if dia_n == total and total > 1:
        partes.append("Es el ÚLTIMO día de la campaña: cierra, no abras algo nuevo.")
    return "\n".join(partes)


async def tema_y_texto(campana: dict, dia_n: int, total: int,
                       ya_usados: list[str] | None = None) -> dict:
    """El tema visual y el texto de la publicación de un día.

    Si el LLM devuelve algo raro no se revienta la corrida: se cae a un tema
    honesto y genérico. Un día publicado con un texto sencillo es infinitamente
    mejor que una campaña que se apaga sola, que es justo lo que el dueño
    quería evitar."""
    try:
        datos = await llm.chat_json(
            "mix_tema", SISTEMA,
            _usuario_prompt(campana, dia_n, total, ya_usados or []))
    except Exception as e:  # noqa: BLE001 — el día debe salir igual
        log.warning("el LLM no dio tema para el día %s: %s", dia_n, e)
        datos = {}
    tema = str(datos.get("tema") or "").strip()
    texto = str(datos.get("texto") or "").strip()
    if not tema:
        tema = ("Present the product in a clean, bright advertising shot, "
                "same product as the reference.")
    if not texto:
        texto = (campana.get("motivo") or "").strip()[:200] or "Hoy te esperamos."
    return {"tema": tema, "texto": texto[:220]}


def prompt_imagen(tema: str) -> str:
    """Lo que se le manda a Grok EDIT junto con la foto del usuario.

    «Keep the product exactly as it looks» no es decorativo: es lo que separa
    una campaña que enseña su producto de una que enseña un producto parecido.
    Y «no text» porque los generadores de imagen escriben mal: las palabras van
    en el texto de la publicación, donde además se pueden leer."""
    return (f"Turn this photo into a social media advertising image. {tema}. "
            "Keep the product and the brand exactly as they look in the "
            "reference photo. Bright, clean, professional lighting. "
            "No text, no letters, no watermark.")


def resumen_costo(dias: int, tarifa: int, saldo: int) -> dict:
    """Lo que la pantalla enseña ANTES de cobrar: cuántas publicaciones, cuánto
    cuesta, y si le alcanza. Se calcula aquí para que el número del botón y el
    número que se cobra no puedan separarse nunca."""
    total = tarifa * max(0, int(dias))
    return {
        "dias": dias,
        "publicaciones": dias,
        "creditos": total,
        "saldo": saldo,
        "alcanza": saldo >= total,
        "faltan": max(0, total - saldo),
    }


def json_seguro(valor) -> str:
    return json.dumps(valor, ensure_ascii=False, default=str)


# ---------------------------------------------------------------------------
# el reloj

# Las redes donde MIX puede publicar UNA foto sin pedirle nada más al usuario.
# No es una lista de preferencias: es lo que el API de Blotato acepta con solo
# la cuenta elegida (verificado contra su doc y su esquema, 18-sep).
#   facebook   exige pageId — la página, que MIX no pregunta
#   pinterest  exige boardId — el tablero
#   tiktok     exige privacidad y seis interruptores más, y es de video
#   youtube    exige título y privacidad, y es de video
# Dejarlas en el desplegable no sería un detalle de UI: la campaña se cobra
# ENTERA por adelantado, así que serían treinta días pagados que no pueden
# salir ni uno, y el error aparecería cada día en una corrida que nadie mira.
REDES_MIX = ("instagram", "linkedin", "threads", "twitter", "bluesky")

HORA_POR_DEFECTO = "09:00"
_HORA = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def red_valida(red: str | None) -> bool:
    return red in REDES_MIX


def target_imagen(plataforma: str) -> dict:
    """El `target` de una publicación con UNA foto.

    No se reutiliza `blotato.target_de` a propósito: esa función marca
    mediaType='reel' en Instagram y Facebook porque nació para el producto de
    video, y los únicos valores que Blotato acepta ahí son 'reel' y 'story'.
    Una foto del feed no es ninguna de las dos, así que va SIN mediaType."""
    if not red_valida(plataforma):
        raise ValueError(f"MIX todavía no publica en {plataforma}.")
    return {"targetType": plataforma}


def clave_imagen(user_id: str, nombre: str) -> str:
    """Dónde vive una imagen de MIX en S3.

    Vive aquí, y no en cada lado, porque quien la GUARDA atiende un request
    (sabe quién es por el token) y quien la LEE es un worker sin request, donde
    `usuario_actual()` cae al piloto. Dos formas de armar la misma clave es
    cómo se baja la foto de otro usuario, o ninguna."""
    return f"imagenes/{user_id}/{nombre}"


def nombre_del_dia(campana_id: str, dia) -> str:
    return f"mix-{campana_id}-{dia}.jpg"


def ahora_en(zona: str | None):
    """La hora del usuario, no la del servidor. Una zona ilegible cae a UTC:
    es mejor un borde raro que una campaña que revienta cada hora."""
    try:
        return datetime.now(ZoneInfo(zona or "UTC"))
    except Exception:  # noqa: BLE001 — zona inventada o base de zonas ausente
        return datetime.now(timezone.utc)


def hora_en_minutos(hora: str | None) -> int:
    """'09:00' → 540. Lo que no se entienda cae a las nueve de la mañana.

    La pantalla solo sabe producir horas en punto, pero la columna es `text` y
    el endpoint no la valida: cualquier cliente puede escribir '25:00'. Un
    reloj que reviente al parsear deja esa campaña muerta en silencio —y
    cobrada—, así que aquí se cae a una hora razonable y se sigue."""
    m = _HORA.match((hora or "").strip())
    if not m:
        log.warning("hora ilegible %r: se usa %s", hora, HORA_POR_DEFECTO)
        m = _HORA.match(HORA_POR_DEFECTO)
    return int(m.group(1)) * 60 + int(m.group(2))


def _como_fecha(valor) -> date:
    return date.fromisoformat(valor) if isinstance(valor, str) else valor


def termino(campana: dict, ahora=None) -> bool:
    """Si el último día de la campaña YA pasó donde vive el usuario."""
    ahora = ahora or ahora_en(campana.get("zona"))
    return ahora.date() > _como_fecha(campana["termina"])


def dia_que_toca(campana: dict, ahora=None) -> date | None:
    """Qué día de la campaña debe publicarse AHORA, o None si no toca.

    No se exige que el reloj caiga en la hora exacta, sino que esa hora ya haya
    pasado hoy. Por dos razones, las dos aprendidas leyendo el mapa:

      * hay zonas a media hora de UTC (India, Nepal). El cron dispara en punto,
        así que allí nunca son las nueve EN PUNTO: un «== la hora» no
        publicaría jamás, y nadie se enteraría hasta que el cliente reclamara;
      * si una hora se pierde —un despliegue, un throttling, la base
        despertando— la siguiente recupera el día en vez de perderlo.

    Que no salga dos veces no lo cuida esta función: lo cuida el candado de la
    base (`mix_reclamar_dia`), que es una PRIMARY KEY."""
    ahora = ahora or ahora_en(campana.get("zona"))
    hoy = ahora.date()
    if hoy < _como_fecha(campana["empieza"]) or hoy > _como_fecha(campana["termina"]):
        return None
    if ahora.hour * 60 + ahora.minute < hora_en_minutos(campana.get("hora")):
        return None
    return hoy


def tarifa_cobrada(campana: dict, por_defecto: int) -> int:
    """Lo que el usuario pagó por día, sacado de SU recibo y no de la tabla de
    precios de hoy.

    Entre el cobro y la devolución de una campaña de MIX pueden pasar dos meses
    (MAX_DIAS = 60), y en ese rato se puede desplegar un precio nuevo —la nota
    de tools/tarifas.json ya avisa de que los 5 créditos son 2 de imagen y 3 de
    automatización, y el modelo de imagen está en el aire—. Devolver a la
    tarifa de hoy regalaría créditos si subió y se quedaría con los del usuario
    si bajó. El repo ya resolvió esto para las películas, y con el porqué
    escrito (`creditos.producir_cobrado`): se devuelve lo que se cobró, no lo
    que costaría hoy. Aquí el recibo es exacto, porque `creditos_cobrados` se
    escribió como tarifa × días."""
    cobrados = int(campana.get("creditos_cobrados") or 0)
    dias = len(dias_de_campana(campana))
    if cobrados <= 0 or dias <= 0 or cobrados % dias:
        return por_defecto      # todavía sin cobrar, o un recibo que no cuadra
    return cobrados // dias


def devolucion_pendiente(campana: dict, liquidados: int, tarifa: int) -> int:
    """Los créditos que todavía se le deben: los días que no están saldados,
    MENOS lo que ya se le devolvió por ellos, al precio QUE PAGÓ.

    `tarifa` es solo el precio de reserva para una campaña sin cobrar: el que
    manda es el del recibo (`tarifa_cobrada`).

    Restar lo ya devuelto no es aritmética de adorno. La campaña se cobra
    entera por adelantado y cada día que falla se devuelve en el acto; si al
    apagar se volviera a contar ese día —que sigue sin ser 'publicada'— se
    devolvería dos veces. Con todos los días fallidos eso es devolver el doble
    de lo cobrado, créditos que nadie compró. Y la base no puede frenarlo: su
    único índice único cubre las compras, así que una devolución repetida entra
    sin protestar."""
    cobrados = int(campana.get("creditos_cobrados") or 0)
    devueltos = int(campana.get("creditos_devueltos") or 0)
    sin_salir = max(0, len(dias_de_campana(campana)) - max(0, liquidados))
    precio = tarifa_cobrada(campana, tarifa)
    return max(0, min(precio * sin_salir - devueltos, cobrados - devueltos))
