"""M23 C4 — Métricas: lo que ya salió, lo que no salió y cómo rinde.

    GET /api/metricas                 una ventana de 30 días (?desde&hasta&cursor)
    GET /api/metricas/{id}/numeros    los números de UNA, para las que no vinieron

La fuente de verdad vuelve a ser Blotato, como en la Agenda: esta pantalla
enseña TODO lo que salió de la cuenta del usuario, también lo que programó
desde blotato.com. Nuestros registros no entran: viven por proyecto
(usuarios/<sub>/publicaciones/<proyecto>/…), no hay listado global y leerlos
costaría una lectura de S3 por tarjeta.

Por qué DOS llamadas y no una:
  * GET /v2/posts sabe QUÉ hay. Es la única que trae las FALLIDAS (esta
    pantalla es la única casa que tienen) y la única con cursor.
  * GET /v2/analytics sabe CUÁNTO rinde. Trae los números y su historial
    pegados a cada publicación, así que la lista entera se numera sin gastar
    una llamada por tarjeta. Y de paso es «las más vistas»: la misma respuesta
    sin reordenar.
Se juntan por id, que es el mismo en las dos. Ese id es el de Blotato, NO el
postSubmissionId que guarda el worker: son cosas distintas y la de aquí no
está en ningún registro nuestro.

Reglas que este módulo no puede romper:
  * DOS llamadas por carga y ninguna más. Los timeouts de httpx son por fase y
    la Lambda corta a los 29 s: el presupuesto entero (PRESUPUESTO_S) se
    reparte entre las dos, y si la primera se lo come, la segunda no sale.
    /v2/posts va SIEMPRE primero: sin ella no hay lista ni cursor, y la
    pantalla degrada a «tus publicaciones, sin números» en vez de a una
    pantalla en blanco.
  * un fallo de Blotato NO es una lista vacía (la regla la fijó la Agenda).
    Las dos llamadas fallan por separado y la respuesta lo dice por separado
    (hay_lista / hay_numeros): la pantalla conserva lo que ya tenía de la que
    siguió viva.
  * «sin números» NO es un error, y hay cuatro motivos distintos que la
    pantalla cuenta distinto. El peor error posible aquí es decir «no hay
    números» de algo que sí los tiene:
      no_aplica     — la publicación falló: nunca va a tener números;
      no_disponible — LinkedIn. Blotato todavía no recoge de esa red;
      no_medido     — Blotato respondió por toda la ventana y esta no estaba:
                      no guardó nada de ella;
      sin_consultar — no lo sabemos (la consulta falló, o la respuesta venía
                      recortada). Solo en este caso se ofrece preguntar por
                      ella, y esa pregunta cuesta UNA llamada.
  * los contadores llegan como texto y salen como int; lo que no se pueda
    convertir viaja como null, nunca como 0.
  * cero lecturas de S3, cero Postgres, cero créditos: leer números no se
    cobra (la tarifa nueva es de C5, Competencia).
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, HTTPException

from pipeline import blotato, claves_usuario
from pipeline.db import usuario_actual
from server.publicar_api import _clave_o_error, _con_tope

log = logging.getLogger("metricas_api")
router = APIRouter(prefix="/api/metricas")

PAGINA = 20                 # publicaciones por página de /v2/posts
MEJORES = 10                # cuántas «más vistas» viajan a la pantalla
CURSOR_MAX = 512
VENTANA_D = 30              # el ancho de cada tramo, en días
HISTORIA_D = 365            # hasta dónde deja retroceder «Ver más»

# los timeouts de httpx son POR FASE (8 s cada una) y la Lambda de la API corta
# a los 29 s: el tope de verdad es este. Aquí van DOS llamadas, así que el
# presupuesto es del conjunto y no de cada una — con TOPE_S por llamada y sin
# presupuesto común, dos llamadas lentas se comen 18 s y dejan 11 para todo lo
# demás. Con menos de MINIMO_SEGUNDA_S por delante, la segunda ni se intenta:
# gastaría una llamada del cupo del usuario para morir en el timeout.
TOPE_S = 9.0
PRESUPUESTO_S = 18.0
MINIMO_SEGUNDA_S = 2.0
LAMBDA_S = 29.0

CURSOR_MALO = "No pudimos seguir la lista. Vuelve a abrir Métricas."
VENTANA_MALA = "No pudimos leer ese tramo de fechas. Vuelve a abrir Métricas."
MUY_ATRAS = ("Métricas llega hasta un año atrás. Más allá tendrías que mirarlo "
             "en cada red.")
ID_MALO = "Esa publicación no es válida. Actualiza la lista."

# Los motivos, redactados UNA vez. La pantalla los pinta, no los escribe.
MOTIVOS = {
    "no_aplica": "No llegó a publicarse, así que no hay números que medir.",
    "no_disponible": "Blotato todavía no recoge números de LinkedIn. Los de esta "
                     "publicación tendrás que verlos en LinkedIn.",
    "no_medido": "Blotato no guardó números de esta publicación.",
    "sin_consultar": "Todavía no sabemos si tiene números.",
    "aun_no": "Blotato aún no la ha medido. Los recoge por tandas, desde un par de "
              "horas después de publicar: vuelve más tarde.",
    "fallo_red": "La red no le dio los números a Blotato esta vez. Volverá a "
                 "intentarlo solo.",
}

# LinkedIn publica, pero sus números no llegan: la doc de Blotato lista sus
# campos y dice que no se rellenan. Saberlo aquí ahorra una llamada segura al
# vacío por cada publicación de LinkedIn.
SIN_METRICAS = ("linkedin",)


def _usuario() -> str:
    user = usuario_actual()
    if not claves_usuario.id_valido(user):
        raise HTTPException(400, "No pudimos identificar tu cuenta. Vuelve a iniciar sesión.")
    return user


def _fallo(err: Exception, clave: str) -> HTTPException:
    """El fallo de Blotato traducido, con los mismos códigos que la Agenda y
    una diferencia: el 429 sale como 429.

    Preguntar por una publicación es lo único que el usuario puede repetir a
    voluntad en esta pantalla, así que es lo único que puede toparse con el
    cupo de Blotato; envolverlo en un 502 le diría «error» a algo que solo
    necesita un momento."""
    mensaje, reconectar = blotato.explicar_fallo(err, clave, contexto="metricas")
    if reconectar:
        return HTTPException(409, mensaje)
    if isinstance(err, httpx.HTTPStatusError) and err.response.status_code == 429:
        return HTTPException(429, mensaje)
    return HTTPException(502, mensaje)


def _instante(valor: str) -> datetime:
    """Una fecha que nos devuelve la pantalla, ya validada. La pantalla manda
    siempre lo que este mismo endpoint le dio (ISO en UTC), así que esto no
    interpreta horarios de nadie: o se entiende, o es un 422."""
    t = blotato.momento(valor)
    if t is None:
        raise HTTPException(422, VENTANA_MALA)
    return t.astimezone(timezone.utc)


def _ventana(desde: str | None, hasta: str | None) -> tuple[datetime, datetime]:
    """El tramo de 30 días que toca, en UTC.

    Sin nada, el de ahora. Con `desde` solo, el tramo ANTERIOR a ese `desde`
    (así se encadenan sin huecos ni solapes, y el ancla es el `ahora` de la
    primera carga y no el de cada clic). Con los dos, el mismo que ya se estaba
    viendo, que es lo que exige seguir un cursor: pedirle a Blotato otra
    ventana con el cursor de la anterior devuelve cualquier cosa."""
    ahora = datetime.now(timezone.utc)
    if desde is None and hasta is None:
        return ahora - timedelta(days=VENTANA_D), ahora
    if desde is None:
        raise HTTPException(422, VENTANA_MALA)
    fin = _instante(hasta) if hasta is not None else _instante(desde)
    ini = _instante(desde) if hasta is not None else fin - timedelta(days=VENTANA_D)
    if not ini < fin or fin - ini > timedelta(days=VENTANA_D + 1) \
            or fin > ahora + timedelta(days=1):
        raise HTTPException(422, VENTANA_MALA)
    if ini < ahora - timedelta(days=HISTORIA_D):
        raise HTTPException(422, MUY_ATRAS)
    return ini, fin


def _iso(t: datetime) -> str:
    """UTC terminado en Z, no en «+00:00». La pantalla nos devuelve estas
    fechas como parámetros de la URL, y un «+» sin escapar llega al servidor
    como un espacio: la ventana se volvería ilegible por una comilla de más.
    Además es lo que habla Blotato."""
    return t.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _medicion_de(vista: dict, numeros: dict | None, *, sabemos: bool) -> dict:
    """La tarjeta con su medición y su motivo.

    `sabemos` es la pregunta fina: ¿la respuesta de /v2/analytics cubría toda
    la ventana? Si venía recortada (o no llegó), que esta publicación no
    estuviera en ella NO significa que no tenga números — significa que no
    miramos, y la tarjeta ofrece preguntar. Confundir las dos cosas es enseñar
    «sin números» a quien sí los tiene."""
    fila = dict(vista)
    fila.update({"numeros": None, "detalle": [], "medido": "", "historial": []})
    if numeros and numeros.get("numeros") is not None:
        fila.update(numeros)
        fila["medicion"] = "medido"
    elif vista["estado"] == "fallido":
        fila["medicion"] = "no_aplica"
    elif vista["plataforma"] in SIN_METRICAS:
        fila["medicion"] = "no_disponible"
    else:
        fila["medicion"] = "no_medido" if sabemos else "sin_consultar"
    fila["motivo"] = MOTIVOS.get(fila["medicion"], "")
    # solo tiene sentido preguntar por lo que no sabemos, y solo si Blotato va a
    # aceptar el id: un botón que garantiza un 422 es un botón roto
    fila["puede_pedir"] = (fila["medicion"] == "sin_consultar"
                           and blotato.id_valido(fila["id"]))
    return fila


@router.get("")
def listar(desde: str | None = None, hasta: str | None = None,
           cursor: str | None = None):
    """Un tramo de 30 días: lo que salió, lo que no, y sus números.

    Exactamente DOS llamadas a Blotato (una si la primera se lleva el
    presupuesto o si la clave ya no sirve), cero lecturas de S3. El cupo del
    usuario son 60 por minuto y el modal de Publicar ya gasta hasta 3 por
    carga."""
    user = _usuario()
    if cursor is not None and not 1 <= len(cursor) <= CURSOR_MAX:
        raise HTTPException(422, CURSOR_MALO)
    if cursor is not None and (desde is None or hasta is None):
        # un cursor sin su ventana es un cursor de otra consulta
        raise HTTPException(422, CURSOR_MALO)
    ini, fin = _ventana(desde, hasta)
    clave = _clave_o_error(user)

    # la respuesta se arma entera aunque las dos llamadas fallen: esta pantalla
    # nunca devuelve 502, porque una lista en blanco con su motivo se puede
    # refrescar y un 502 no
    # `ultimo_tramo` mira si el tramo ANTERIOR a este cabría todavía dentro del
    # año: es lo que decide si «Ver más» puede seguir retrocediendo, y la
    # pantalla no puede calcularlo sin saber dónde ponemos el suelo
    respuesta: dict = {"items": [], "mejores": [], "cursor": None,
                       "desde": _iso(ini), "hasta": _iso(fin),
                       "ultimo_tramo": ini - timedelta(days=VENTANA_D)
                       < datetime.now(timezone.utc) - timedelta(days=HISTORIA_D),
                       "hay_lista": False, "hay_numeros": False, "truncado": False,
                       "error": None, "reconectar": False}

    reloj = time.monotonic()
    fatal = False
    try:
        pagina = _con_tope(lambda: blotato.publicadas(
            clave, desde=_iso(ini), hasta=_iso(fin), limite=PAGINA, cursor=cursor,
            timeout=blotato.TIMEOUT_CORTO), TOPE_S)
        crudas = pagina["items"]
        respuesta["cursor"] = pagina["cursor"]
        respuesta["hay_lista"] = True
    except Exception as err:  # noqa: BLE001 — TimeoutError incluido
        log.warning("listar las publicaciones: %s", type(err).__name__)
        crudas = []
        respuesta["error"], respuesta["reconectar"] = blotato.explicar_fallo(
            err, clave, contexto="metricas")
        # con la clave rechazada o el cupo agotado, la segunda llamada solo
        # sirve para gastar otra del cupo y repetir el mismo error
        fatal = respuesta["reconectar"] or (
            isinstance(err, httpx.HTTPStatusError)
            and err.response.status_code == 429)

    resto = PRESUPUESTO_S - (time.monotonic() - reloj)
    medidas: dict[str, dict] = {}
    mejores: list[dict] = []
    if not fatal and resto >= MINIMO_SEGUNDA_S:
        try:
            datos = _con_tope(lambda: blotato.analiticas(
                clave, desde=_iso(ini), hasta=_iso(fin),
                timeout=blotato.TIMEOUT_CORTO), min(TOPE_S, resto))
            respuesta["hay_numeros"] = True
            respuesta["truncado"] = datos["truncado"]
            for item in datos["items"]:
                vista = blotato.vista_analitica(item)
                if not vista["id"]:
                    continue
                medidas[vista["id"]] = blotato.medicion_lista(item)
                if len(mejores) < MEJORES:
                    mejores.append(_medicion_de(vista, medidas[vista["id"]], sabemos=True))
        except Exception as err:  # noqa: BLE001
            log.warning("listar los números: %s", type(err).__name__)
            error, reconectar = blotato.explicar_fallo(err, clave, contexto="metricas")
            respuesta["error"] = respuesta["error"] or error
            respuesta["reconectar"] = respuesta["reconectar"] or reconectar

    # solo cuando Blotato contestó por TODA la ventana se puede afirmar que una
    # publicación ausente no tiene números
    sabemos = respuesta["hay_numeros"] and not respuesta["truncado"]
    respuesta["mejores"] = mejores
    respuesta["items"] = [
        _medicion_de(vista, medidas.get(vista["id"]), sabemos=sabemos)
        for vista in (blotato.vista_publicada(c) for c in crudas)
        # una `scheduled` que se cuele es cosa de la Agenda, no de aquí
        if vista["id"] and vista["estado"] in ("publicado", "fallido")]
    return respuesta


@router.get("/{post_id}/numeros")
def numeros(post_id: str):
    """Los números de UNA publicación: exactamente una llamada a Blotato.

    Solo para las tarjetas que la lista no pudo numerar. Las tres respuestas
    sin números son estados y no errores, y ninguna se pinta en rojo — en
    particular el 404, que aquí significa «Blotato no guardó nada de esta» y
    que llega traducido desde explicar_fallo(contexto="metricas"). Si cayera en
    _fallo saldría como un 404 de HTTP y la pantalla lo enseñaría como una
    avería.

    Ningún endpoint de Blotato fuerza una medición nueva: esto devuelve la
    última que recogió. Por eso el botón de la pantalla dice «Ver números» y no
    «Actualizar»."""
    user = _usuario()
    if not blotato.id_valido(post_id):
        raise HTTPException(422, ID_MALO)
    clave = _clave_o_error(user)
    try:
        datos = _con_tope(lambda: blotato.analitica_de(clave, post_id,
                                                       timeout=blotato.TIMEOUT_CORTO),
                          TOPE_S)
    except httpx.HTTPStatusError as err:
        if err.response.status_code == 404:
            return {"id": post_id, "medicion": "no_medido", "numeros": None,
                    "detalle": [], "medido": "", "historial": [],
                    "motivo": blotato.explicar_fallo(err, clave, contexto="metricas")[0]}
        log.warning("números de una publicación: %s", err.response.status_code)
        raise _fallo(err, clave)
    except Exception as err:  # noqa: BLE001
        log.warning("números de una publicación: %s", type(err).__name__)
        raise _fallo(err, clave)

    medicion = blotato.medicion_post(datos)
    fallo_red = medicion.pop("fallo_red", "")
    if medicion["numeros"] is not None:
        estado, motivo = "medido", ""
    elif fallo_red:
        estado, motivo = "fallo_red", f"{MOTIVOS['fallo_red']} ({fallo_red})"
    else:
        estado, motivo = "aun_no", MOTIVOS["aun_no"]
    return {"id": post_id, "medicion": estado, "motivo": motivo, **medicion}
