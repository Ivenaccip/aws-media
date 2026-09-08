"""M8 — shorts en la web: la versión con botones del flujo /shorts de terminal.

Dos trabajos sobre un proyecto del editor (subida de e1 o gen-* del puente):

  analizar : transcripción (SOLO si el proyecto no trae canónico — los gen-* ya
             lo traen) + candidatos puntuados por LLM. Corre en el worker SQS;
             el estado viaja por proyectos_editor.doc.shorts.
  render   : snap → extract (stream copy) → Remotion → export.sh → S3, en
             Fargate vía la state machine de siempre (worker/shorts_task.py).

Reglas duras que se respetan aquí: preview de costo ANTES de cobrar (los
créditos salen de tarifas.json §shorts; los dólares solo informan y vienen de
pricing.json), cobrar antes de lanzar, devolver en fallo nuestro, stream copy
al extraer y loudnorm únicamente en export.sh. Flujo solo en la nube: en dev
local el camino sigue siendo /shorts desde Claude Code.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from pipeline import creditos, db, jobs, media_sync
from pipeline.storage import ruta_proyecto

router = APIRouter(prefix="/api/shorts")

ESTILOS = {"bold", "bounce", "clean"}
PLATAFORMAS = {"youtube", "tiktok", "instagram", "all"}
TIPOS = {"auto", "talking-head", "screen", "podcast"}
MAX_DURACION_S = 5400   # 90 min: más largo no cabe en el worker de 15 min
VIDEO_EXT = (".mp4", ".mov", ".mkv", ".webm")


def _nube() -> None:
    if db.backend() != "postgres":
        raise HTTPException(503, "El flujo web de shorts corre en el servicio — "
                                 "en local usa /shorts desde Claude Code")


def _proyecto(nombre: str) -> dict:
    try:
        ruta_proyecto(nombre)   # validación del nombre (viene del navegador)
    except ValueError as err:
        raise HTTPException(422, str(err))
    doc = db.cargar_proyecto_editor(db.usuario_actual(), nombre)
    if doc is None:
        raise HTTPException(404, f"{nombre}: no está entre tus proyectos")
    return doc


def _fuente(doc: dict, nombre: str) -> str | None:
    """El metraje de entrada: la subida más reciente, o la película del gen."""
    subidas = [s["key"] for s in doc.get("subidas", [])
               if s.get("key", "").lower().endswith(VIDEO_EXT)]
    if subidas:
        return subidas[-1]
    if doc.get("flags", {}).get("generado"):
        return f"videos/{nombre}/pelicula.mp4"
    return None


def _duracion_s(key: str) -> float:
    """ffprobe sobre el CDN (la imagen trae ffmpeg; lee solo el moov, no baja
    el archivo). El costo de transcripción depende de esta duración."""
    base = os.getenv("CDN_BASE", "").rstrip("/")
    if not base:
        raise HTTPException(503, "CDN_BASE no configurada")
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", f"{base}/{key}"],
        capture_output=True, text=True, timeout=30)
    try:
        return float(r.stdout.strip())
    except ValueError:
        raise HTTPException(502, f"No se pudo medir la duración del video ({r.stderr.strip()[:120]})")


def _con_transcript(nombre: str) -> bool:
    return any(k.endswith(".canonical.json")
               for k in media_sync.listar_prefijo(f"videos/{nombre}/work/transcripts/"))


def _caducado(estado: dict, horas: float) -> bool:
    try:
        inicio = datetime.fromisoformat(estado["inicio"])
    except (KeyError, TypeError, ValueError):
        return True
    return datetime.now(timezone.utc) - inicio > timedelta(hours=horas)


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# M17 — importar un video de YouTube por liga (van ANTES de /{nombre}: FastAPI
# matchearía "importar" como nombre de proyecto)

_YT_ID = re.compile(
    r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|live/)|youtu\.be/)"
    r"([A-Za-z0-9_-]{11})")


def _video_id(url: str) -> str:
    m = _YT_ID.search(url or "")
    if not m:
        raise HTTPException(422, "Pega una liga de YouTube válida "
                                 "(youtube.com/watch?v=…, youtu.be/… o /shorts/…)")
    return m.group(1)


def _info_youtube(video_id: str) -> dict:
    """Título + duración vía el actor cotizador (~$0.001 dólares, ~5 s)."""
    from pipeline import apify
    from pipeline.config import settings
    try:
        item = apify.correr(settings.apify_yt_info,
                            {"videoIds": [video_id]}, timeout_s=60)[0]
    except apify.ApifyError as err:
        raise HTTPException(502, f"No se pudo leer el video de YouTube: {str(err)[:200]}")
    dur = float(item.get("lengthSeconds") or 0)
    if not dur:
        raise HTTPException(422, "Ese video no reporta duración — ¿es un directo o está privado?")
    return {"titulo": str(item.get("title") or "")[:120], "duracion_s": dur}


class PedidoImportar(BaseModel):
    url: str = Field(min_length=10, max_length=300)


@router.post("/importar/cotizar")
def importar_cotizar(pedido: PedidoImportar):
    """Preview de costo ANTES de cobrar (regla dura): título, minutos y créditos."""
    _nube()
    vid = _video_id(pedido.url)
    info = _info_youtube(vid)
    if info["duracion_s"] > MAX_DURACION_S:
        raise HTTPException(413, f"El video dura {info['duracion_s']/60:.0f} min — "
                                 f"el máximo del flujo web es {MAX_DURACION_S//60} min")
    return {**info, "nombre": f"yt-{vid}",
            "creditos": creditos.costo_shorts_importar(info["duracion_s"])}


@router.post("/importar")
def importar(pedido: PedidoImportar):
    """Cobra y encola la descarga; el progreso viaja por doc.importar."""
    _nube()
    user = db.usuario_actual()
    vid = _video_id(pedido.url)
    nombre = f"yt-{vid}"
    doc = db.cargar_proyecto_editor(user, nombre) or {}
    st = doc.get("importar") or {}
    if st.get("estado") == "descargando" and not _caducado(st, 0.5):
        raise HTTPException(409, "Ese video ya se está importando — espera a que termine")
    if st.get("estado") == "listo":
        raise HTTPException(409, f"Ese video ya está importado como «{nombre}» — "
                                 "elígelo en la lista y corre el análisis")
    info = _info_youtube(vid)
    if info["duracion_s"] > MAX_DURACION_S:
        raise HTTPException(413, f"El video dura {info['duracion_s']/60:.0f} min — "
                                 f"el máximo del flujo web es {MAX_DURACION_S//60} min")
    n = creditos.costo_shorts_importar(info["duracion_s"])
    if creditos.activo():
        try:
            creditos.cobrar(n, f"shorts-importar:{nombre}", user)
        except creditos.SinSaldo as e:
            raise HTTPException(402, str(e))
    nuevo = {"estado": "descargando", "url": pedido.url, "titulo": info["titulo"],
             "duracion_s": info["duracion_s"], "creditos": n, "inicio": _ahora()}
    doc.setdefault("subidas", [])
    doc["importar"] = nuevo
    db.guardar_proyecto_editor(user, nombre, json.dumps(doc, ensure_ascii=False))
    try:
        jobs.encolar_shorts_importar(user, nombre, pedido.url)
    except Exception as err:  # noqa: BLE001 — cobrado y sin job = lo peor: revertir
        if creditos.activo():
            creditos.devolver(n, f"shorts-importar:{nombre}", user)
        nuevo.update(estado="error", error=f"no se pudo encolar: {err}"[:300])
        db.fijar_campo_editor(user, nombre, "importar", json.dumps(nuevo, ensure_ascii=False))
        raise HTTPException(502, f"No se pudo lanzar la importación: {str(err)[:200]}")
    return {"lanzado": True, "nombre": nombre, "creditos": n}


@router.get("/{nombre}")
def estado(nombre: str):
    """Poll barato de la UI: solo lo que ya está en Postgres."""
    _nube()
    doc = _proyecto(nombre)
    return {"shorts": doc.get("shorts"), "fuente": _fuente(doc, nombre),
            "importar": doc.get("importar"),
            "creditos_por_short": creditos.SHORTS_RENDER_CR,
            "cdn": os.getenv("CDN_BASE", "").rstrip("/")}


@router.get("/{nombre}/costo")
def costo(nombre: str):
    """Preview de costo ANTES del botón (regla dura: nube sin preview = bug)."""
    _nube()
    doc = _proyecto(nombre)
    key = _fuente(doc, nombre)
    if key is None:
        raise HTTPException(404, "Este proyecto no tiene metraje: sube un video en e1 primero")
    dur = _duracion_s(key)
    con_tx = _con_transcript(nombre)
    falta_key = not con_tx and not os.getenv("ASSEMBLYAI_API_KEY")
    return {
        "fuente": key, "duracion_s": round(dur, 1), "con_transcript": con_tx,
        "creditos_analizar": creditos.costo_shorts_analizar(dur, con_tx),
        "creditos_por_short": creditos.SHORTS_RENDER_CR,
        "backend_listo": not falta_key,
        "aviso": None if not falta_key else
            "Falta configurar la transcripción en nube (ASSEMBLYAI_API_KEY) — "
            "este proyecto no trae transcript propio",
    }


@router.post("/{nombre}/analizar")
def analizar(nombre: str):
    _nube()
    user = db.usuario_actual()
    doc = _proyecto(nombre)
    st = doc.get("shorts") or {}
    if st.get("estado") == "analizando" and not _caducado(st, 0.5):
        raise HTTPException(409, "El análisis ya está corriendo — espera a que termine")
    key = _fuente(doc, nombre)
    if key is None:
        raise HTTPException(404, "Este proyecto no tiene metraje: sube un video en e1 primero")
    dur = _duracion_s(key)
    if dur > MAX_DURACION_S:
        raise HTTPException(413, f"El video dura {dur/60:.0f} min — el máximo del flujo web es {MAX_DURACION_S//60} min")
    con_tx = _con_transcript(nombre)
    if not con_tx and not os.getenv("ASSEMBLYAI_API_KEY"):
        raise HTTPException(503, "Transcripción en nube no configurada (ASSEMBLYAI_API_KEY)")
    n = creditos.costo_shorts_analizar(dur, con_tx)
    if creditos.activo():
        try:
            creditos.cobrar(n, f"shorts-analizar:{nombre}", user)
        except creditos.SinSaldo as e:
            raise HTTPException(402, str(e))
    nuevo = {"estado": "analizando", "fuente": key, "duracion_s": round(dur, 1),
             "creditos": n, "inicio": _ahora()}
    db.fijar_campo_editor(user, nombre, "shorts", json.dumps(nuevo, ensure_ascii=False))
    try:
        jobs.encolar_shorts_analizar(user, nombre)
    except Exception as err:  # noqa: BLE001 — cobrado y sin job = lo peor: revertir
        if creditos.activo():
            creditos.devolver(n, f"shorts-analizar:{nombre}", user)
        nuevo.update(estado="error", error=f"no se pudo encolar: {err}"[:300])
        db.fijar_campo_editor(user, nombre, "shorts", json.dumps(nuevo, ensure_ascii=False))
        raise HTTPException(502, f"No se pudo lanzar el análisis: {str(err)[:200]}")
    return {"lanzado": True, "creditos": n}


class Corte(BaseModel):
    start: float = Field(ge=0)
    end: float
    hook_line1: str = ""
    hook_line2: str = ""


class PedidoRender(BaseModel):
    shorts: list[Corte] = Field(min_length=1, max_length=10)
    estilo: str = "bold"
    plataforma: str = "all"
    tipo: str = "auto"


@router.post("/{nombre}/render")
def render(nombre: str, pedido: PedidoRender):
    _nube()
    user = db.usuario_actual()
    doc = _proyecto(nombre)
    st = doc.get("shorts") or {}
    if st.get("estado") != "candidatos":
        raise HTTPException(409, "Primero corre el análisis: los shorts se renderizan sobre sus candidatos")
    if (st.get("render") or {}).get("estado") == "corriendo" and not _caducado(st["render"], 2):
        raise HTTPException(409, "Ya hay un render de shorts corriendo")
    if pedido.estilo not in ESTILOS or pedido.plataforma not in PLATAFORMAS \
            or pedido.tipo not in TIPOS:
        raise HTTPException(400, "estilo, plataforma o tipo de contenido inválido")
    for c in pedido.shorts:
        if not 5 <= c.end - c.start <= 90:
            raise HTTPException(400, f"cada short debe durar entre 5 y 90 s (recibí {c.end - c.start:.1f} s)")
    n = creditos.costo_shorts_render(len(pedido.shorts))
    if creditos.activo():
        try:
            creditos.cobrar(n, f"shorts-render:{nombre}", user)
        except creditos.SinSaldo as e:
            raise HTTPException(402, str(e))
    st["render"] = {
        "estado": "corriendo", "inicio": _ahora(), "creditos": n,
        "estilo": pedido.estilo, "plataforma": pedido.plataforma, "tipo": pedido.tipo,
        "segmentos": [{"id": i + 1, "start": c.start, "end": c.end,
                       "hook_line1": c.hook_line1.strip()[:40],
                       "hook_line2": c.hook_line2.strip()[:40]}
                      for i, c in enumerate(pedido.shorts)],
    }
    db.fijar_campo_editor(user, nombre, "shorts", json.dumps(st, ensure_ascii=False))
    try:
        jobs.lanzar_shorts_render(user, nombre)
    except Exception as err:  # noqa: BLE001
        if creditos.activo():
            creditos.devolver(n, f"shorts-render:{nombre}", user)
        st["render"].update(estado="error", log=f"no se pudo lanzar el job: {err}"[:300])
        db.fijar_campo_editor(user, nombre, "shorts", json.dumps(st, ensure_ascii=False))
        raise HTTPException(502, f"No se pudo lanzar el render: {str(err)[:200]}")
    return {"lanzado": True, "creditos": n}
