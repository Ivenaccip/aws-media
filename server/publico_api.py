"""RAG·2/RAG·5/RAG·8 — las rutas públicas de /automatiza, las ÚNICAS bajo
/api/publico/ (lo fija tests/test_rag_camino_publico.py).

Todo aquí corre sin token y dentro del candado de identidad: ninguna función
de este archivo puede llamar db.usuario_actual() (reventaría con 500). Lo que
se toca es la corrida, nunca un usuario.

El recorrido (RAG·8):

    POST /corridas              → las puertas de RAG·7 → fila en la base → cola
    GET  /corridas/{id}         → la página sondea: lugar en la fila, estado
    GET  /corridas/{id}/flujo.json → la descarga, solo si quedó «listo»

Nada de esto espera al worker: el POST contesta en cuanto la corrida está en
la cola, así que el muro de 29 s de API Gateway no aplica al armado. El {id}
es el publico_id (token aleatorio de 16 caracteres): quien lo tiene es quien
pidió, y no hay otra forma de listar corridas desde aquí.
"""
from __future__ import annotations

import logging
import re

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from pipeline import db, jobs
from pipeline import publico as freno

log = logging.getLogger("publico_api")

router = APIRouter(prefix="/api/publico")

NO_DISPONIBLE = "Ahorita no está disponible"
# Lo que ve el visitante en cada final que no es «listo». El motivo interno
# (excepciones, «apagado»…) se queda en la base: no se le enseña a internet.
MENSAJES = {
    freno.CORTO: f"Cuéntanos un poco más: al menos {freno.LARGO_MINIMO} caracteres.",
    freno.LARGO: f"Es demasiado largo: máximo {freno.LARGO_MAXIMO} caracteres.",
    freno.RECHAZADA: "Esta petición no la podemos armar. Prueba describiéndola de otra forma.",
    "no_salio": "Esta vez no salió. Intenta de nuevo en un rato.",
    "sin_cobertura": "Todavía no sabemos armar esto con n8n.",
}
_ID = re.compile(r"^[A-Za-z0-9_-]{16}$")        # secrets.token_urlsafe(12)
_SIN_CACHE = {"Cache-Control": "no-store"}


class Peticion(BaseModel):
    texto: str = ""
    # de dónde vino (RAG·28); la página los copia de su propia URL
    referrer: str | None = None
    utm_source: str | None = None
    utm_medium: str | None = None
    utm_campaign: str | None = None
    utm_content: str | None = None


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
    ip_hash = freno.hash_ip(freno.ip_del_request(request))
    a = await freno.admitir(body.texto, ip_hash)
    if a.motivo in (freno.CORTO, freno.LARGO):
        return _json({"motivo": a.motivo, "mensaje": MENSAJES[a.motivo],
                      "minimo": freno.LARGO_MINIMO, "maximo": freno.LARGO_MAXIMO}, 422)
    origen = body.model_dump(exclude={"texto"})
    if a.motivo == freno.RECHAZADA:
        # Se guarda: su moderación ya costó y cuenta para el tope por IP.
        fila = db.automatiza_crear(a.texto, ip_hash=ip_hash, origen=origen)
        db.automatiza_cerrar(fila["id"], "rechazada", motivo=a.detalle or "moderación")
        return _json({"motivo": a.motivo,
                      "mensaje": a.detalle or MENSAJES[freno.RECHAZADA]}, 422)
    if a.motivo:
        return _no_disponible()
    fila = db.automatiza_crear(a.texto, ip_hash=ip_hash, origen=origen)
    db.automatiza_a_fila(fila["id"])
    try:
        jobs.encolar_publico(fila["id"])
    except Exception:  # noqa: BLE001 — sin cola la corrida no avanzaría nunca
        log.exception("corrida %s: no se pudo encolar", fila["id"])
        db.automatiza_cerrar(fila["id"], "no_salio", motivo="no se pudo encolar")
        return _no_disponible()
    return _json({"id": fila["publico_id"], "estado": "en_fila",
                  "lugar": db.automatiza_lugar(fila["id"])}, 202)


def _buscar(publico_id: str) -> dict | None:
    # un id mal formado no llega a la base
    return db.automatiza_corrida(publico_id) if _ID.match(publico_id or "") else None


@router.get("/corridas/{publico_id}")
def consultar(publico_id: str):
    """Lo que la página sondea mientras espera."""
    c = _buscar(publico_id)
    if not c:
        return _json({"mensaje": "No encontramos esa petición."}, 404)
    cuerpo = {"id": c["publico_id"], "estado": c["estado"],
              "listo": c["estado"] == "listo"}
    if c["estado"] == "en_fila":
        cuerpo["lugar"] = db.automatiza_lugar(c["id"])
    elif c["estado"] == "listo":
        cuerpo["nodos"] = c.get("nodos") or []
        cuerpo["descarga"] = f"/api/publico/corridas/{c['publico_id']}/flujo.json"
    elif c["estado"] == "rechazada":
        # el motivo de una rechazada lo escribió la moderación PARA el visitante
        cuerpo["mensaje"] = c.get("motivo") or MENSAJES[freno.RECHAZADA]
    elif c["estado"] in MENSAJES:
        cuerpo["mensaje"] = MENSAJES[c["estado"]]
    return _json(cuerpo)


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
