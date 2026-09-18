"""M23 C5 — investiga tu competencia: qué le está funcionando a quien vigilas.

Guardas las cuentas que te interesan (gratis) y, cuando quieres, lanzas una
revisión: el worker trae las últimas publicaciones de cada una vía Apify, las
ordena por lo que rindieron PARA SU PROPIA CUENTA y el LLM dice qué se repite
en las que ganan. El informe queda por usuario en S3 y no se borra nunca.

Reglas duras (las mismas de la copiadora de estilos, M18): preview de costo
antes de cobrar — la tarifa sale de tarifas.json §competencia y la UI la enseña
en el botón —, cobrar antes de encolar, y devolver en fallo nuestro. Aquí la
devolución es POR CUENTA: si Instagram responde y TikTok no, se devuelve lo de
TikTok y el informe sale con lo que sí llegó (worker/competencia_analizar.py).

Lo que se guarda de cada publicación incluye su liga, que es justo lo que
/api/estilo sabe analizar: el puente con la copiadora de estilos queda tendido
en los datos aunque la pantalla todavía no lo ofrezca.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from pipeline import apify, competencia, creditos, db, jobs, media_sync

router = APIRouter(prefix="/api/competencia")

MAX_INFORMES = 40          # tope de lectura del listado
HORAS_CADUCA = 0.5         # una corrida colgada no bloquea la siguiente
_ID_INFORME = re.compile(r"^inf-[0-9]{8}-[0-9]{6}$")


def _nube() -> None:
    if db.backend() != "postgres" or not media_sync._bucket():
        raise HTTPException(503, "Investiga tu competencia corre en el servicio")


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _prefijo(user: str) -> str:
    return f"usuarios/{user}/competencia/"


def _key_cuentas(user: str) -> str:
    return f"{_prefijo(user)}cuentas.json"


def _key_informe(user: str, informe_id: str) -> str:
    return f"{_prefijo(user)}informes/{informe_id}.json"


def _caducado(doc: dict, horas: float) -> bool:
    try:
        inicio = datetime.fromisoformat(doc["inicio"])
    except (KeyError, TypeError, ValueError):
        return True
    return datetime.now(timezone.utc) - inicio > timedelta(hours=horas)


def _leer_json(key: str, default):
    try:
        return json.loads(media_sync.leer_texto(key) or "") or default
    except ValueError:
        return default


def _cuentas(user: str) -> list[dict]:
    doc = _leer_json(_key_cuentas(user), {})
    return doc.get("cuentas", []) if isinstance(doc, dict) else []


def _guardar_cuentas(user: str, cuentas: list[dict]) -> None:
    media_sync.escribir_texto(
        _key_cuentas(user),
        json.dumps({"cuentas": cuentas, "guardado": _ahora()}, ensure_ascii=False))


def _resumen(doc: dict, informe_id: str) -> dict:
    """La ficha de un informe SIN sus publicaciones: cincuenta por informe por
    cuarenta informes no caben en una respuesta de listado. Las publicaciones
    llegan al abrirlo, por /informes/{id}."""
    fallidas = doc.get("fallidas") or []
    return {"id": informe_id, "estado": doc.get("estado"),
            "inicio": doc.get("inicio"), "listo": doc.get("listo"),
            "creditos": doc.get("creditos"), "devueltos": doc.get("devueltos"),
            "cuentas": doc.get("cuentas") or [],
            "n_publicaciones": len(doc.get("publicaciones") or []),
            "n_fallidas": len(fallidas),
            "error": apify.tachar(doc["error"]) if doc.get("error") else ""}


def _informes(user: str) -> list[dict]:
    salida = []
    for key in media_sync.listar_prefijo(f"{_prefijo(user)}informes/")[:MAX_INFORMES]:
        if not key.endswith(".json"):
            continue
        doc = _leer_json(key, None)
        if not isinstance(doc, dict):
            continue
        salida.append(_resumen(doc, key.rsplit("/", 1)[-1][:-len(".json")]))
    salida.sort(key=lambda d: str(d.get("inicio") or ""), reverse=True)
    return salida


class PedidoCuenta(BaseModel):
    url: str = Field(min_length=4, max_length=300)


class PedidoAnalizar(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=competencia.MAX_CUENTAS)


@router.get("")
def listar():
    """Las cuentas vigiladas, los informes y la tarifa para el botón."""
    _nube()
    user = db.usuario_actual()
    return {"cuentas": _cuentas(user), "informes": _informes(user),
            "credito_por_cuenta": creditos.costo_competencia(1),
            "max_cuentas": competencia.MAX_CUENTAS,
            "por_cuenta": competencia.POR_CUENTA}


@router.post("/cuentas")
def agregar(pedido: PedidoCuenta):
    """Agregar una cuenta a vigilar. No cuesta: guardar no trae publicaciones."""
    _nube()
    user = db.usuario_actual()
    try:
        red, cuenta = competencia.detectar(pedido.url)
    except competencia.CuentaInvalida as e:
        raise HTTPException(422, str(e))
    cuentas = _cuentas(user)
    cid = competencia.id_cuenta(red, cuenta)
    if any(c.get("id") == cid for c in cuentas):
        raise HTTPException(409, f"Ya estás vigilando a @{cuenta} en "
                                 f"{competencia.NOMBRE_RED[red]}")
    if len(cuentas) >= competencia.MAX_CUENTAS:
        raise HTTPException(409, f"Puedes vigilar hasta {competencia.MAX_CUENTAS} "
                                 "cuentas — quita una para agregar otra")
    cuentas.append({"id": cid, "red": red, "cuenta": cuenta,
                    "url": competencia.url_perfil(red, cuenta), "agregada": _ahora()})
    _guardar_cuentas(user, cuentas)
    return {"cuentas": cuentas}


@router.delete("/cuentas/{cuenta_id}")
def quitar(cuenta_id: str):
    """Dejar de vigilar una cuenta. Los informes ya hechos NO se tocan: son
    fotos de un momento y se pagaron."""
    _nube()
    user = db.usuario_actual()
    cuentas = _cuentas(user)
    quedan = [c for c in cuentas if c.get("id") != cuenta_id]
    if len(quedan) == len(cuentas):
        raise HTTPException(404, "Esa cuenta no está en tu lista")
    _guardar_cuentas(user, quedan)
    return {"cuentas": quedan}


@router.post("/analizar")
def analizar(pedido: PedidoAnalizar):
    """Cobra por cuenta y encola la revisión; el progreso viaja por el informe."""
    _nube()
    user = db.usuario_actual()
    cuentas = _cuentas(user)
    if pedido.ids:
        pedidas = {i for i in pedido.ids}
        elegidas = [c for c in cuentas if c.get("id") in pedidas]
        faltan = pedidas - {c.get("id") for c in elegidas}
        if faltan:
            raise HTTPException(404, "Esa cuenta no está en tu lista")
    else:
        elegidas = cuentas
    if not elegidas:
        raise HTTPException(422, "Agrega al menos una cuenta que vigilar")
    if len(elegidas) > competencia.MAX_CUENTAS:
        raise HTTPException(422, f"Como mucho {competencia.MAX_CUENTAS} cuentas "
                                 "por revisión")
    vivos = [d for d in _informes(user)
             if d.get("estado") == "analizando" and not _caducado(d, HORAS_CADUCA)]
    if vivos:
        raise HTTPException(409, "Ya hay una revisión en marcha — espera a que termine")

    n = creditos.costo_competencia(len(elegidas))
    informe_id = "inf-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    if creditos.activo():
        try:
            creditos.cobrar(n, f"competencia:{informe_id}", user)
        except creditos.SinSaldo as e:
            raise HTTPException(402, str(e))
    doc = {"estado": "analizando", "inicio": _ahora(), "creditos": n,
           "credito_por_cuenta": creditos.costo_competencia(1),
           "por_cuenta": competencia.POR_CUENTA,
           "cuentas": [{"id": c["id"], "red": c["red"], "cuenta": c["cuenta"]}
                       for c in elegidas]}
    media_sync.escribir_texto(_key_informe(user, informe_id),
                              json.dumps(doc, ensure_ascii=False))
    try:
        jobs.encolar_competencia(user, informe_id, doc["cuentas"])
    except Exception as err:  # noqa: BLE001 — cobrado y sin job = lo peor: revertir
        if creditos.activo():
            creditos.devolver(n, f"competencia:{informe_id}", user)
        doc.update(estado="error", error=f"no se pudo encolar: {err}"[:300])
        media_sync.escribir_texto(_key_informe(user, informe_id),
                                  json.dumps(doc, ensure_ascii=False))
        raise HTTPException(502, f"No se pudo lanzar la revisión: {str(err)[:200]}")
    return {"lanzado": True, "id": informe_id, "creditos": n}


@router.get("/informes/{informe_id}")
def informe(informe_id: str):
    """Un informe con TODAS sus publicaciones. El listado no las trae (serían
    50 por informe); esta es la que abre la pantalla al desplegar uno."""
    _nube()
    if not _ID_INFORME.match(informe_id or ""):
        raise HTTPException(404, "No existe ese informe")
    doc = _leer_json(_key_informe(db.usuario_actual(), informe_id), None)
    if not isinstance(doc, dict):
        raise HTTPException(404, "No existe ese informe")
    doc["id"] = informe_id
    if doc.get("error"):
        doc["error"] = apify.tachar(doc["error"])
    return doc
