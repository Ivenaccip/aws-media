"""M23 · D — la corrida de UN día de MIX: la imagen sale y se publica sola.

Lo encola el reloj (`worker/mix_reloj.py`) cuando en la zona del usuario ya
llegó su hora. Aquí no hay nadie mirando —es el encargo del dueño: «publicidad
que salga para traer cosas», sin revisión— así que este archivo se escribe
suponiendo lo peor y dejándolo todo escrito en la fila del día, que es lo único
que el usuario va a leer después.

Tres reglas que no se negocian:

**No se relanza NUNCA.** Después del candado, cualquier excepción se traga y se
escribe. Relanzar haría que SQS reintentara, y un reintento no es una segunda
oportunidad: es una segunda publicación en la cuenta de un cliente.

**Lo barato se comprueba antes que lo caro.** Sin una red que podamos publicar,
sin clave o con la cuenta desconectada no se genera nada: una imagen de Grok
cuesta dinero nuestro y fallar después de gastarla es pagar por nada. Treinta
días de una campaña rota son treinta imágenes tiradas.

**Un día que no sale se devuelve en el acto**, y solo puede devolverlo quien
GANÓ el cierre del día (`db.mix_cerrar_dia`, condicionado a 'corriendo'). El
libro mayor no protege contra devolver dos veces: su índice único solo cubre
las compras.

`dir_imagenes`, `limpiar`, `bajar_imagen` y `tema_e_imagen` no llevan guion
bajo porque no son privadas: las usa también `worker/mix_ejemplo.py`, que
prepara el día 1 antes de cobrar con exactamente el mismo código.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import date
from pathlib import Path

import httpx

from worker.env_ssm import cargar_env_usuario

log = logging.getLogger("worker")

SIN_RED = ("MIX todavía no puede publicar en esa red. Apaga la campaña y "
           "vuelve a crearla en Instagram, LinkedIn, Threads, X o Bluesky.")
SIN_CLAVE = ("Tu cuenta de Blotato ya no está conectada, así que no hay dónde "
             "publicar. Conéctala otra vez y reanuda la campaña.")
CUENTA_IDA = ("Esa cuenta ya no está conectada en tu Blotato. Conéctala otra "
              "vez y reanuda la campaña.")
ALMACEN = ("No pudimos leer tu conexión con Blotato. Ese día no salió y te "
           "devolvimos sus créditos; mañana se intenta de nuevo.")
SIN_IMAGEN = ("Perdimos la foto de la campaña, así que ese día no salió. "
              "Apágala y vuelve a crearla con la foto.")
SIN_MODELO = ("La imagen de ese día no se pudo generar. Te devolvimos sus "
              "créditos; mañana se intenta de nuevo.")
NO_SUBIO = ("No pudimos subir la imagen de ese día a Blotato. Te devolvimos "
            "sus créditos; mañana se intenta de nuevo.")
NO_SALIO = ("Blotato no pudo publicar ese día. Te devolvimos sus créditos; "
            "mañana se intenta de nuevo.")
INCIERTO = ("Ese día se mandó a Blotato y no confirmó. No te devolvimos sus "
            "créditos porque pudo haber salido: míralo en tu cuenta.")
TEXTO_MALO = ("El texto de ese día no lo aceptaba la red. Te devolvimos sus "
              "créditos; mañana se intenta de nuevo.")
APAGADA = "La campaña se apagó mientras ese día se preparaba."


def dir_imagenes() -> Path:
    from pipeline.config import settings
    return Path(settings.work_dir) / "_imagenes"


def limpiar(ruta: Path | None) -> None:
    """/tmp lo comparten todas las invocaciones del mismo contenedor caliente,
    así que una imagen a medias de una corrida que falló se queda ahí hasta que
    la Lambda muera."""
    if ruta is not None:
        try:
            ruta.unlink(missing_ok=True)
        except OSError:     # noqa: S110 — limpiar no puede costar la corrida
            pass


def bajar_imagen(user_id: str, nombre: str) -> Path:
    """La imagen en disco, lista para mandarla a Grok o a Blotato.

    La clave se arma con el dueño de la CAMPAÑA, no con `usuario_actual()`:
    aquí no hay request, y ese atajo bajaría la foto del piloto —o la de otro
    usuario— sin que nada fallara de forma visible."""
    from pipeline import media_sync, mix

    local = dir_imagenes() / nombre
    if local.exists():
        return local
    local.parent.mkdir(parents=True, exist_ok=True)
    if media_sync.bajar_archivo(mix.clave_imagen(user_id, nombre), local):
        return local
    raise FileNotFoundError(nombre)


def devolver_dia(user_id: str, campana_id: str, dia: str) -> int:
    """Devuelve los créditos de UN día que no salió.

    Solo se llama después de ganar el cierre del día. Tres cosas lo protegen,
    y las tres hicieron falta:

      * el precio sale del RECIBO del usuario (`mix.tarifa_cobrada`), no de la
        tarifa de hoy: entre el cobro y este día pueden pasar dos meses;
      * una campaña ya saldada —apagada o terminada— no devuelve nada más. Su
        cierre ya devolvió TODOS los días que no salieron, este incluido, así
        que devolverlo otra vez sería pagar dos veces el mismo día;
      * el tope es lo cobrado menos lo ya devuelto."""
    from pipeline import creditos, db, mix

    if not creditos.activo():
        return 0
    campana = db.mix_campana_de(user_id, campana_id) or {}
    if campana.get("estado") not in ("activa", "pausada"):
        log.info("mix %s/%s: el día %s no se devuelve, la campaña ya se liquidó",
                 user_id, campana_id, dia)
        return 0
    tope = (int(campana.get("creditos_cobrados") or 0)
            - int(campana.get("creditos_devueltos") or 0))
    n = min(mix.tarifa_cobrada(campana, creditos.MIX_POR_PUBLICACION_CR),
            max(0, tope))
    if n <= 0:
        return 0
    creditos.devolver(n, f"mix:{campana_id}:dia:{dia}", user_id)
    db.mix_anotar_devolucion(user_id, campana_id, n)
    log.info("mix %s/%s: %d créditos devueltos por el día %s",
             user_id, campana_id, n, dia)
    return n


def _fallar(user_id: str, campana_id: str, dia: str, mensaje: str,
            *, pausar: str = "", devolver: bool = True, estado: str = "error",
            **campos) -> dict:
    """Cierra el día con lo que pasó y devuelve sus créditos.

    `devolver=False` es para el día INCIERTO: Blotato no confirmó, pero pudo
    haberlo publicado, y devolverlo sería regalar la publicación y el dinero.
    Ese día se cierra como 'incierta', que cuenta como saldado para que el
    cierre de la campaña tampoco lo devuelva después.

    `pausar` no es un booleano: es el motivo que va a leer el usuario. Se pausa
    solo cuando mañana va a fallar igual (no hay clave, la cuenta se fue, la
    red no se puede publicar); si fue algo pasajero, la campaña sigue encendida
    y mañana se intenta otra vez."""
    from pipeline import db

    if not db.mix_cerrar_dia(user_id, campana_id, dia, estado,
                             error=mensaje, **campos):
        log.warning("mix %s/%s: el día %s ya estaba cerrado",
                    user_id, campana_id, dia)
        return {"accion": "nada", "motivo": "el día ya estaba cerrado"}
    devueltos = devolver_dia(user_id, campana_id, dia) if devolver else 0
    if pausar and db.mix_pausar(user_id, campana_id, pausar):
        log.warning("mix %s/%s: campaña pausada", user_id, campana_id)
    return {"accion": "error", "dia": dia, "creditos": devueltos,
            "error": mensaje}


async def tema_e_imagen(campana: dict, dia: date, ruta: Path, base: Path,
                        ya_usados: list[str]) -> dict:
    """El tema y el texto del día, y la imagen hecha con la foto del usuario
    como referencia. Las dos llamadas en el mismo bucle: son la parte lenta de
    la corrida y no hay razón para abrir dos.

    La comparte `worker/mix_ejemplo.py`, y eso no es ahorro de líneas: el
    ejemplo del día 1 ES la publicación del día 1. Si cada uno generara a su
    manera, el usuario aprobaría una cosa y saldría otra."""
    from pipeline import media_fal, mix

    total = len(mix.dias_de_campana(campana))
    plan = await mix.tema_y_texto(campana, mix.dia_numero(campana, dia), total,
                                  ya_usados)
    await media_fal.imagen_fal(
        mix.prompt_imagen(plan["tema"]), ruta, referencia=base,
        meta={"mix": campana["id"], "dia": dia.isoformat()}, aspecto="1:1")
    return plan


def _texto_que_pasa(red: str, texto: str) -> str:
    """El texto del día, recortado a lo que la red acepta.

    Antes que perder el día por el texto se recorta y, si aun así no pasa, se
    le quitan los hashtags (Instagram admite cinco). Es la misma idea que ya
    guía a `mix.tema_y_texto`: un día publicado con un texto sencillo es mejor
    que una campaña que se apaga sola."""
    from pipeline import blotato

    limite = blotato.REDES[red]["texto"]
    texto = (texto or "").strip()[:limite]
    try:
        blotato.revisar_texto(red, texto)
        return texto
    except ValueError:
        pass
    sin = " ".join(p for p in texto.split() if not p.startswith("#"))[:limite]
    blotato.revisar_texto(red, sin)     # si tampoco pasa, el día se cierra
    return sin


def correr(user_id: str, campana_id: str, dia: str) -> dict:
    """Punto de entrada del trabajo `mix_dia`. Nunca levanta."""
    from pipeline import costes_infra

    t0 = time.monotonic()
    # el env del trabajo anterior sigue puesto en una Lambda caliente: sin esto
    # la devolución de este usuario caería en el monedero de otro
    os.environ["DEFAULT_USER_ID"] = user_id
    cargar_env_usuario(user_id)    # C5: la clave de Grok del usuario, si tiene
    try:
        return _correr(user_id, campana_id, dia)
    except Exception as err:  # noqa: BLE001 — relanzar publicaría dos veces
        log.error("mix %s/%s día %s: fallo inesperado %s", user_id, campana_id,
                  dia, type(err).__name__)
        return _fallar(user_id, campana_id, dia, NO_SALIO)
    finally:
        costes_infra.registrar(user_id, campana_id, "infra-mix",
                               costes_infra.costo_lambda(time.monotonic() - t0))


def _correr(user_id: str, campana_id: str, dia: str) -> dict:
    from pipeline import blotato, claves_usuario, db, media_sync, mix

    campana = db.mix_campana_de(user_id, campana_id)
    if campana is None or campana["estado"] != "activa":
        return {"accion": "nada", "motivo": "la campaña ya no está encendida"}

    # EL CANDADO. Si el día ya tiene fila puede ser por dos motivos muy
    # distintos: otra corrida lo tomó (nos vamos), o es el día 1 y su fila es
    # el ejemplo que el usuario ya vio antes de pagar. Ese ejemplo se reclama y
    # se reusa: fue gratis, y volver a generarlo sería pagar dos veces la misma
    # imagen y publicar algo distinto de lo que él aprobó.
    listo = None
    if not db.mix_reclamar_dia(user_id, campana_id, dia):
        listo = db.mix_reclamar_ejemplo(user_id, campana_id, dia)
        if listo is None:
            return {"accion": "nada", "motivo": "ese día ya lo tomó otra corrida"}

    red = campana["canal_red"]
    if not mix.red_valida(red):
        return _fallar(user_id, campana_id, dia, SIN_RED, pausar=SIN_RED)
    try:
        clave = blotato.clave_de(user_id)
    except claves_usuario.ErrorAlmacen:
        # no es culpa del usuario y no es definitivo: el día se cierra y se
        # devuelve, pero la campaña sigue encendida para mañana
        return _fallar(user_id, campana_id, dia, ALMACEN)
    if not clave:
        return _fallar(user_id, campana_id, dia, SIN_CLAVE, pausar=SIN_CLAVE)
    try:
        cuentas = blotato.cuentas(clave, timeout=blotato.TIMEOUT_CORTO)
    except (httpx.HTTPError, blotato.ClaveInvalida) as err:
        # sin contexto: el default («publicacion») es el que toca, porque lo
        # que el usuario perdió es la publicación de ese día, no una consulta
        mensaje, reconectar = blotato.explicar_fallo(err, clave)
        return _fallar(user_id, campana_id, dia, mensaje,
                       pausar=mensaje if reconectar else "")
    if not any(str(c.get("id")) == str(campana["canal_id"])
               and c.get("platform") == red for c in cuentas):
        return _fallar(user_id, campana_id, dia, CUENTA_IDA, pausar=CUENTA_IDA)

    fecha = date.fromisoformat(dia)
    ruta = None
    try:
        if listo and listo.get("media_key"):
            tema, texto = listo.get("tema") or "", listo.get("texto") or ""
            media_key = listo["media_key"]
            ruta = bajar_imagen(user_id, media_key)
        else:
            base = bajar_imagen(user_id, campana["imagen_key"])
            media_key = mix.nombre_del_dia(campana_id, dia)
            ruta = dir_imagenes() / media_key
            ruta.parent.mkdir(parents=True, exist_ok=True)
            usados = [c.get("tema") or ""
                      for c in db.mix_corridas(user_id, campana_id)]
            plan = asyncio.run(tema_e_imagen(campana, fecha, ruta, base, usados))
            tema, texto = plan["tema"], plan["texto"]
            media_sync.subir_archivo(ruta, mix.clave_imagen(user_id, media_key))
    except FileNotFoundError:
        limpiar(ruta)
        return _fallar(user_id, campana_id, dia, SIN_IMAGEN, pausar=SIN_IMAGEN)
    except Exception as err:  # noqa: BLE001 — el modelo, la red o el CDN
        limpiar(ruta)
        log.error("mix %s/%s día %s: no se pudo preparar (%s)", user_id,
                  campana_id, dia, type(err).__name__)
        return _fallar(user_id, campana_id, dia, SIN_MODELO)

    try:
        texto = _texto_que_pasa(red, texto)
    except (ValueError, KeyError):
        return _fallar(user_id, campana_id, dia, TEXTO_MALO,
                       tema=tema, media_key=media_key)

    try:
        with ruta.open("rb") as f:
            media = blotato.subir_stream(clave, ruta.name, blotato.trozos(f),
                                         ruta.stat().st_size)
    except Exception as err:  # noqa: BLE001
        log.error("mix %s/%s día %s: subir falló (%s)", user_id, campana_id,
                  dia, type(err).__name__)
        return _fallar(user_id, campana_id, dia, NO_SUBIO,
                       tema=tema, texto=texto, media_key=media_key)
    finally:
        limpiar(ruta)

    # Último vistazo antes del punto sin retorno. Entre el candado y aquí
    # pasaron el tema y la imagen —hasta un par de minutos— y en ese rato el
    # usuario pudo apagar la campaña, cosa que le devolvió este día por no
    # estar publicado. Publicarlo ahora sería regalarle la publicación.
    viva = db.mix_campana_de(user_id, campana_id) or {}
    if viva.get("estado") != "activa":
        # apagada o terminada ya liquidó este día; pausada no, así que ese sí
        # se devuelve
        pausada = viva.get("estado") == "pausada"
        db.mix_cerrar_dia(user_id, campana_id, dia,
                          "error" if pausada else "cancelada", tema=tema,
                          texto=texto, media_key=media_key,
                          error=APAGADA if pausada else None)
        if pausada:
            devolver_dia(user_id, campana_id, dia)
        return {"accion": "nada", "motivo": APAGADA}

    try:
        r = blotato.publicar(clave, campana["canal_id"], red, texto, [media],
                             target=mix.target_imagen(red))
    except httpx.HTTPStatusError as err:
        codigo = err.response.status_code
        log.error("mix %s/%s día %s: Blotato respondió %s", user_id,
                  campana_id, dia, codigo)
        if 400 <= codigo < 500 and codigo != 408:
            # rechazado: Blotato no creó nada, así que el día se devuelve
            mensaje, reconectar = blotato.explicar_fallo(err, clave)
            return _fallar(user_id, campana_id, dia, mensaje, tema=tema,
                           texto=texto, media_key=media_key,
                           pausar=mensaje if reconectar else "")
        return _fallar(user_id, campana_id, dia, INCIERTO, devolver=False,
                       estado="incierta", tema=tema, texto=texto,
                       media_key=media_key)
    except Exception as err:  # noqa: BLE001 — sin respuesta: pudo salir igual
        log.error("mix %s/%s día %s: sin respuesta de Blotato (%s)", user_id,
                  campana_id, dia, type(err).__name__)
        return _fallar(user_id, campana_id, dia, INCIERTO, devolver=False,
                       estado="incierta", tema=tema, texto=texto,
                       media_key=media_key)

    post_id = r.get("postSubmissionId")
    if not (isinstance(post_id, str) and blotato.id_valido(post_id)):
        post_id = ""
    db.mix_cerrar_dia(user_id, campana_id, dia, "publicada", tema=tema,
                      texto=texto, media_key=media_key, post_id=post_id)
    log.info("mix %s/%s: día %s publicado en %s", user_id, campana_id, dia, red)
    return {"accion": "publicada", "dia": dia, "red": red, "post_id": post_id}
