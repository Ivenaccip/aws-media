"""RAG·2/RAG·5/RAG·8 — las rutas públicas de /automatiza, las ÚNICAS bajo
/api/publico/ (lo fija tests/test_rag_camino_publico.py).

Todo aquí corre sin token y dentro del candado de identidad: ninguna función
de este archivo puede llamar db.usuario_actual() (reventaría con 500). Lo que
se toca es la corrida, nunca un usuario.

El recorrido (RAG·8):

    POST /corridas              → las puertas de RAG·7 → fila en la base → cola
    GET  /corridas/{id}         → la página sondea: lugar en la fila, estado,
                                  paso (RAG·11) y el correo ENMASCARADO
    POST /corridas/{id}/correo  → deja o cambia el correo (RAG·12/13)
    GET  /corridas/{id}/flujo.json → la descarga, solo si quedó «listo»

Nada de esto espera al worker: el POST contesta en cuanto la corrida está en
la cola, así que el muro de 29 s de API Gateway no aplica al armado. El {id}
es el publico_id (token aleatorio de 16 caracteres): quien lo tiene es quien
pidió, y no hay otra forma de listar corridas desde aquí.
"""
from __future__ import annotations

import logging
import re
from urllib.parse import urlsplit

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from pipeline import db, jobs
from pipeline import publico as freno
from server import aviso

log = logging.getLogger("publico_api")

router = APIRouter(prefix="/api/publico")

NO_DISPONIBLE = "Ahorita no está disponible"
# Lo que ve el visitante en cada final que no es «listo». El motivo interno
# (excepciones, «apagado»…) se queda en la base: no se le enseña a internet.
MENSAJES = {
    freno.CORTO: f"Cuéntanos un poco más: al menos {freno.LARGO_MINIMO} caracteres.",
    freno.LARGO: f"Es demasiado largo: máximo {freno.LARGO_MAXIMO} caracteres.",
    freno.RECHAZADA: "Esta petición no la podemos armar. Prueba describiéndola de otra forma.",
    # la copia del lienzo aprobado (pantalla 5): abajo la página dice «Qué
    # sigue: lo apuntamos para revisarlo a mano», no «intenta en un rato»
    "no_salio": ("Esta vez no pudimos armar un flujo que importe bien en n8n. "
                 "Preferimos no darte uno roto."),
    "sin_cobertura": "Todavía no sabemos armar esto con n8n.",
}
# secrets.token_urlsafe(12). fullmatch y no match con ^…$: «$» deja pasar un
# salto de línea al final. Lo usa también la página /automatiza/c/{id}.
ID_PUBLICO = re.compile(r"[A-Za-z0-9_-]{16}")
_SIN_CACHE = {"Cache-Control": "no-store"}

# RAG·12/13 — el correo. Validación sensata, no RFC 5322: un solo @, dominio
# con punto, sin espacios ni caracteres de control, ni comas o punto y coma
# (que colarían una segunda dirección). Lo que filtra correos inventados es
# el envío (RAG·16), no esto.
_CORREO = re.compile(r"[^@\s\x00-\x1f\x7f,;<>]+"
                     r"@(?:[^@\s\x00-\x1f\x7f,;<>.]+\.)+[^@\s\x00-\x1f\x7f,;<>.]+")
CORREO_MAX = 254
# la pantalla donde lo dejó; «espera» es «se pasó del tiempo» (2d), que sale
# en la espera y también mientras arma, no solo en la fila
ORIGENES_CORREO = ("listo", "fila", "no_salio", "espera")
# Cuántas veces se puede dejar o cambiar el correo de UNA corrida. Cada vez es
# una fila nueva (la prueba del consentimiento no se edita): sin tope, un
# bucle llenaría la tabla con una sola corrida. Se cuenta en la misma
# sentencia que guarda (db.automatiza_guardar_correo): así es un tope de
# verdad aunque lleguen varias peticiones a la vez.
TOPE_CORREOS = 5
MENSAJE_CORREO = "Revisa tu correo: parece que le falta algo."
MENSAJE_AVISO = ("Actualizamos el aviso de privacidad. Recarga la página para verlo "
                 "y deja tu correo otra vez.")
# el mismo 409 al pedir (RAG·13): la página vuelve a abrir el aviso, y si su
# versión ya es otra (un deploy a media visita), este mensaje pide recargar
MENSAJE_AVISO_PEDIR = ("Antes de armarlo necesitamos que leas y aceptes el aviso de "
                       "privacidad. Si ya lo aceptaste, recarga la página: lo actualizamos.")


class Peticion(BaseModel):
    texto: str = ""
    # la versión del aviso que la persona aceptó en el pop-up antes de mandar
    # (la de data-aviso-version): sin la vigente no se guarda nada
    aviso_version: str = ""
    # de dónde vino (RAG·28); la página los copia de su propia URL
    referrer: str | None = None
    utm_source: str | None = None
    utm_medium: str | None = None
    utm_campaign: str | None = None
    utm_content: str | None = None


class Correo(BaseModel):
    correo: str = ""
    # la casilla APARTE y desmarcada; el texto que vio lo pone el servidor
    recontacto: bool = False
    origen: str = ""
    # la versión del aviso con la que se llenó la página (data-aviso-version):
    # si no es la vigente, la persona vio otro texto y no se guarda nada
    aviso_version: str = ""


def limpiar_correo(correo: str | None) -> str | None:
    """El correo tal como se guarda (minúsculas, sin espacios en las orillas),
    o None si no parece un correo."""
    c = (correo or "").strip().lower()
    if len(c) > CORREO_MAX or not _CORREO.fullmatch(c):
        return None
    return c


def enmascarar(correo: str) -> str:
    """«gu•••@gmail.com»: lo justo para que quien volvió con el enlace
    reconozca SU correo. Nunca el completo: un usuario de 1 o 2 letras
    enseña una o ninguna."""
    usuario, _, dominio = correo.rpartition("@")
    ver = 2 if len(usuario) > 2 else len(usuario) - 1
    return f"{usuario[:max(ver, 0)]}•••@{dominio}"


def solo_sitio(referrer: str | None) -> str | None:
    """De la página de la que llegó, solo el sitio («https://x.com», sin ruta,
    query ni usuario): para medir de dónde llegan las visitas basta, y la ruta
    o el query de otro sitio pueden traer tokens, correos o búsquedas de un
    tercero. Lo que no sea una URL con host no se guarda."""
    try:
        u = urlsplit(str(referrer or "").strip())
        con_host = bool(u.scheme and u.hostname) and u.port != 0   # un puerto imposible revienta
    except ValueError:
        return None
    if not con_host:
        return None
    sitio = u.netloc.rpartition("@")[2].lower()      # sin usuario:contraseña
    return f"{u.scheme.lower()}://{sitio}"


def _json(cuerpo: dict, status: int = 200) -> JSONResponse:
    return JSONResponse(cuerpo, status_code=status, headers=_SIN_CACHE)


def _no_disponible() -> JSONResponse:
    return _json({"disponible": False, "mensaje": NO_DISPONIBLE}, 503)


@router.get("/estado")
def estado(request: Request):
    """¿Se puede pedir un flujo ahora? La página lo consulta al abrir para
    enseñar «Ahorita no está disponible» antes de que alguien escriba.

    No dice POR QUÉ (apagado o tope): al visitante le da igual, y a un bot le
    serviría saber cuánto le queda al día."""
    ip_hash = freno.hash_ip(freno.ip_del_request(request))
    return {"disponible": freno.permiso(ip_hash) is None}


@router.post("/corridas")
async def crear(body: Peticion, request: Request):
    """Acepta una petición o dice por qué no. 202 = ya está en la fila."""
    if body.aviso_version != aviso.AVISO_VERSION:
        # Antes que todo lo demás: sin el aviso vigente aceptado no se guarda
        # la descripción, ni se modera (cuesta) ni cuenta para el tope por IP.
        # La página vuelve a enseñar el aviso para que lo acepte.
        return _json({"motivo": "aviso", "mensaje": MENSAJE_AVISO_PEDIR}, 409)
    ip_hash = freno.hash_ip(freno.ip_del_request(request))
    a = await freno.admitir(body.texto, ip_hash)
    if a.motivo in (freno.CORTO, freno.LARGO):
        return _json({"motivo": a.motivo, "mensaje": MENSAJES[a.motivo],
                      "minimo": freno.LARGO_MINIMO, "maximo": freno.LARGO_MAXIMO}, 422)
    origen = body.model_dump(exclude={"texto", "aviso_version"})
    origen["referrer"] = solo_sitio(origen.get("referrer"))
    if a.motivo == freno.RECHAZADA:
        # Se guarda: su moderación ya costó y cuenta para el tope por IP. El
        # motivo es lo que lee quien vuelve con el enlace: sin frase de la
        # moderación, la general (nunca una palabra interna como «moderación»)
        fila = db.automatiza_crear(a.texto, ip_hash=ip_hash, origen=origen,
                                   aviso_version=aviso.AVISO_VERSION)
        db.automatiza_cerrar(fila["id"], "rechazada",
                             motivo=a.detalle or MENSAJES[freno.RECHAZADA])
        return _json({"motivo": a.motivo,
                      "mensaje": a.detalle or MENSAJES[freno.RECHAZADA]}, 422)
    if a.motivo:
        return _no_disponible()
    fila = db.automatiza_crear(a.texto, ip_hash=ip_hash, origen=origen,
                               aviso_version=aviso.AVISO_VERSION)
    db.automatiza_a_fila(fila["id"])
    # el lugar se cuenta ANTES de encolar: con la fila vacía el worker puede
    # tomarla antes de que este POST conteste, y el 202 diría «lugar: null»
    lugar = db.automatiza_lugar(fila["id"])
    try:
        jobs.encolar_publico(fila["id"])
    except Exception:  # noqa: BLE001 — sin cola la corrida no avanzaría nunca
        log.exception("corrida %s: no se pudo encolar", fila["id"])
        db.automatiza_cerrar(fila["id"], "no_salio", motivo="no se pudo encolar")
        return _no_disponible()
    return _json({"id": fila["publico_id"], "estado": "en_fila", "lugar": lugar}, 202)


def _buscar(publico_id: str) -> dict | None:
    # un id mal formado no llega a la base
    return db.automatiza_corrida(publico_id) if ID_PUBLICO.fullmatch(publico_id or "") else None


NO_ENCONTRADA = "No encontramos esa petición."


@router.get("/corridas/{publico_id}")
def consultar(publico_id: str):
    """Lo que la página sondea mientras espera.

    `lleva_seg` es para «Llevas 1:12» al volver con el enlace; `paso`, solo
    mientras arma (sin paso anotado todavía, «entender»); `correo`, si ya lo
    dejó, enmascarado: el enlace se comparte y el correo no es de quien lo abre."""
    c = _buscar(publico_id)
    if not c:
        return _json({"mensaje": NO_ENCONTRADA}, 404)
    cuerpo = {"id": c["publico_id"], "estado": c["estado"],
              "listo": c["estado"] == "listo",
              # int(float()): si el SQL perdiera su ::bigint, el Data API
              # mandaría el numeric como texto («176.26») y esto no daría 500
              "lleva_seg": int(float(c.get("lleva_seg") or 0))}
    if c.get("correo"):
        cuerpo["correo"] = enmascarar(c["correo"])
    if c["estado"] == "en_fila":
        cuerpo["lugar"] = db.automatiza_lugar(c["id"])
    elif c["estado"] == "armando":
        paso = c.get("paso")
        cuerpo["paso"] = paso if paso in db.PASOS_AUTOMATIZA else db.PASOS_AUTOMATIZA[0]
    elif c["estado"] == "listo":
        cuerpo["nodos"] = c.get("nodos") or []
        cuerpo["descarga"] = f"/api/publico/corridas/{c['publico_id']}/flujo.json"
    elif c["estado"] == "rechazada":
        # el motivo de una rechazada lo escribió la moderación PARA el visitante
        cuerpo["mensaje"] = c.get("motivo") or MENSAJES[freno.RECHAZADA]
    elif c["estado"] in MENSAJES:
        cuerpo["mensaje"] = MENSAJES[c["estado"]]
    return _json(cuerpo)


@router.post("/corridas/{publico_id}/correo")
def dejar_correo(publico_id: str, body: Correo):
    """Deja (o cambia) el correo de la corrida: en la fila, en «se pasó del
    tiempo», en «ya está armado» o en «no salió». Cada vez se AGREGA una fila
    con la prueba del consentimiento; el texto de la casilla y la versión del
    aviso los pone el servidor (server/aviso.py), el cliente solo dice sí o no
    y con qué versión se llenó su página (tiene que ser la vigente).

    Aquí no se manda nada: el envío es de RAG·14/16."""
    if not ID_PUBLICO.fullmatch(publico_id or ""):
        return _json({"mensaje": NO_ENCONTRADA}, 404)
    if body.origen not in ORIGENES_CORREO:
        # es un error de la página, no de la persona: no se le dice «revisa tu correo»
        return _json({"motivo": "origen", "mensaje": "Algo falló al mandarlo. "
                                                      "Recarga la página e intenta de nuevo."}, 422)
    correo = limpiar_correo(body.correo)
    if not correo:
        return _json({"motivo": "correo", "mensaje": MENSAJE_CORREO}, 422)
    c = _buscar(publico_id)
    if not c:
        return _json({"mensaje": NO_ENCONTRADA}, 404)
    if c["estado"] == freno.RECHAZADA:
        # no hay nada que mandarle, y guardar el correo sería juntar datos de más
        return _json({"mensaje": "Esta petición no la podemos armar, así que no "
                                 "hay nada que mandarte."}, 409)
    if body.aviso_version != aviso.AVISO_VERSION:
        # La página se llenó con otro aviso (una pestaña abierta desde antes
        # de un deploy): guardar RECONTACTO_TEXTO y AVISO_VERSION de hoy
        # registraría un consentimiento a un texto que la persona no vio.
        return _json({"motivo": "aviso", "mensaje": MENSAJE_AVISO}, 409)
    if not db.automatiza_guardar_correo(c["id"], correo, origen=body.origen,
                                        recontacto=body.recontacto,
                                        recontacto_texto=aviso.RECONTACTO_TEXTO,
                                        aviso_version=aviso.AVISO_VERSION,
                                        tope=TOPE_CORREOS):
        return _json({"mensaje": "Ya cambiaste el correo varias veces. Si necesitas "
                                 "ayuda, escríbenos."}, 429)
    return _json({"ok": True, "correo": enmascarar(correo)})


@router.get("/corridas/{publico_id}/flujo.json")
def descargar(publico_id: str):
    """El flujo para importar en n8n. Se cuenta la descarga, pero si contarla
    falla la persona igual se lleva su archivo."""
    c = _buscar(publico_id)
    flujo = (c or {}).get("resultado") or {}
    if not c or c["estado"] != "listo" or not flujo.get("flujo"):
        return _json({"mensaje": "Todavía no hay flujo para descargar."}, 404)
    try:
        db.automatiza_descargo(c["publico_id"], "json")
    except Exception:  # noqa: BLE001
        log.exception("no se pudo contar la descarga de %s", c["publico_id"])
    return JSONResponse(flujo["flujo"], headers={
        **_SIN_CACHE,
        "Content-Disposition": f'attachment; filename="automatiza-{c["publico_id"]}.json"'})
