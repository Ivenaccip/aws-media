"""M18 — copiadora de estilos: liga de IG/TikTok → perfil de estilo visual.

Pegas la liga de un reel/TikTok que te guste → se cobra la tarifa fija
(tarifas.json §estilos) → el worker SQS descarga el video vía Apify, saca
frames y arma el perfil (paleta determinística + gpt-5-mini visión). El perfil
vive por usuario en S3 (usuarios/<user>/estilos/<id>.json) y la UI lo pinta
como tarjeta. Copiar estilo, nunca clonar contenido.

Reglas duras: preview de costo antes de cobrar (la tarifa es fija y la UI la
enseña en el botón), cobrar antes de encolar, devolver en fallo nuestro. Los
perfiles no se borran (como toda versión).
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from pipeline import creditos, db, jobs, media_sync

# OJO: /api/estilos ya existe en app.py (los estilos de imagen de crear) —
# esta herramienta vive en /api/estilo
router = APIRouter(prefix="/api/estilo")

_IG = re.compile(r"instagram\.com/(?:[^/]+/)?(?:reels?|p)/([A-Za-z0-9_-]{5,})")
_TT = re.compile(r"tiktok\.com/(?:@[^/]+/video|v)/(\d{8,})")
_TT_CORTA = re.compile(r"(?:vm|vt)\.tiktok\.com/([A-Za-z0-9]{5,})")
MAX_PERFILES = 60   # tope de lectura del listado (nadie llega ahí pronto)


def _nube() -> None:
    if db.backend() != "postgres" or not media_sync._bucket():
        raise HTTPException(503, "La copiadora de estilos corre en el servicio")


def _detectar(url: str) -> tuple[str, str]:
    """(plataforma, id del perfil) desde la liga — 422 si no es IG/TikTok."""
    m = _IG.search(url or "")
    if m:
        return "instagram", f"ig-{m.group(1)}"
    m = _TT.search(url or "") or _TT_CORTA.search(url or "")
    if m:
        return "tiktok", f"tt-{m.group(1)}"
    raise HTTPException(422, "Pega una liga de Instagram (reel o post) o de TikTok")


def _prefijo(user: str) -> str:
    return f"usuarios/{user}/estilos/"


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _caducado(doc: dict, horas: float) -> bool:
    try:
        inicio = datetime.fromisoformat(doc["inicio"])
    except (KeyError, TypeError, ValueError):
        return True
    return datetime.now(timezone.utc) - inicio > timedelta(hours=horas)


class PedidoAnalizar(BaseModel):
    url: str = Field(min_length=10, max_length=300)


@router.get("")
def listar():
    """Los perfiles del usuario (tarjetas) + la tarifa para el botón."""
    _nube()
    user = db.usuario_actual()
    perfiles = []
    for key in media_sync.listar_prefijo(_prefijo(user))[:MAX_PERFILES]:
        if not key.endswith(".json"):
            continue
        try:
            doc = json.loads(media_sync.leer_texto(key) or "{}")
        except ValueError:
            continue
        doc["id"] = key.rsplit("/", 1)[-1][:-len(".json")]
        perfiles.append(doc)
    perfiles.sort(key=lambda d: str(d.get("inicio") or ""), reverse=True)
    return {"estilos": perfiles, "creditos": creditos.costo_estilo_analizar()}


@router.post("/analizar")
def analizar(pedido: PedidoAnalizar):
    """Cobra la tarifa fija y encola el análisis; el progreso viaja por el doc."""
    _nube()
    user = db.usuario_actual()
    plataforma, estilo_id = _detectar(pedido.url)
    key = f"{_prefijo(user)}{estilo_id}.json"
    doc = json.loads(media_sync.leer_texto(key) or "{}")
    if doc.get("estado") == "analizando" and not _caducado(doc, 0.5):
        raise HTTPException(409, "Ese video ya se está analizando — espera a que termine")
    if doc.get("estado") == "listo":
        raise HTTPException(409, "Ese video ya tiene su perfil de estilo — está en tu lista")
    n = creditos.costo_estilo_analizar()
    if creditos.activo():
        try:
            creditos.cobrar(n, f"estilo-analizar:{estilo_id}", user)
        except creditos.SinSaldo as e:
            raise HTTPException(402, str(e))
    nuevo = {"estado": "analizando", "url": pedido.url, "plataforma": plataforma,
             "creditos": n, "inicio": _ahora()}
    media_sync.escribir_texto(key, json.dumps(nuevo, ensure_ascii=False))
    try:
        jobs.encolar_estilo_analizar(user, estilo_id, pedido.url, plataforma)
    except Exception as err:  # noqa: BLE001 — cobrado y sin job = lo peor: revertir
        if creditos.activo():
            creditos.devolver(n, f"estilo-analizar:{estilo_id}", user)
        nuevo.update(estado="error", error=f"no se pudo encolar: {err}"[:300])
        media_sync.escribir_texto(key, json.dumps(nuevo, ensure_ascii=False))
        raise HTTPException(502, f"No se pudo lanzar el análisis: {str(err)[:200]}")
    return {"lanzado": True, "id": estilo_id, "creditos": n}
