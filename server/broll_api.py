"""b2 — recomendación de recursos visuales (PLAN-FUSION.md F3.1).

v1 pragmática: el cerebro corre con el mismo stack de agentes del generador
(gpt-5-mini vía pipeline.llm, trazado en Langfuse) con los criterios editoriales
de /broll-ai destilados en prompts/broll_system.md. El puerto a claude-agent-sdk
queda como pendiente documentado — el patrón del chat del cut-editor es
interactivo y este endpoint necesita una respuesta JSON de un tiro.

Las propuestas NO generan nada (≈$0.001 de LLM): se guardan como "propuestas" en
overlays.json y la UI las pinta en la pista 2; generar una pasa por el flujo g1/g2
con sus gates de gasto.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from langfuse import get_client, propagate_attributes

from pipeline import overlays
from pipeline.config import load_prompt
from pipeline.llm import chat_json
from pipeline.storage import leer_json, ruta_proyecto

log = logging.getLogger("broll_api")
ROOT = Path(__file__).resolve().parent.parent
router = APIRouter(prefix="/editor")

MAX_PROPUESTAS = 5


def _proyecto(name: str) -> Path:
    try:
        p = ruta_proyecto(name)
    except ValueError as err:
        raise HTTPException(422, str(err))
    if not p.is_dir():
        raise HTTPException(404, f"proyecto {name} no existe")
    return p


def _transcript_condensado(p: Path, max_chars: int = 3000) -> str:
    et = leer_json(p / "work" / "edited-transcript.json", default=None)
    return _condensar(et, max_chars)


def _condensar(et: dict | None, max_chars: int = 3000) -> str:
    if not et or not et.get("words"):
        raise HTTPException(409, "sin edited-transcript.json — corre el corte o el puente primero")
    lineas, actual, inicio = [], [], 0
    for w in et["words"]:
        if not actual:
            inicio = w["start"]
        actual.append(w["text"])
        if w["text"].endswith((".", "?", "!", "…")):
            lineas.append(f"[{inicio / 1000:.1f}s] {' '.join(actual)}")
            actual = []
    if actual:
        lineas.append(f"[{inicio / 1000:.1f}s] {' '.join(actual)}")
    return "\n".join(lineas)[:max_chars]


def filtrar_propuestas(crudas: list, duracion_s: float, ocupados: list[tuple[float, float]]) -> list[dict]:
    """Valida lo que devolvió el LLM: dentro del video, 3-8s, sin pisar recursos
    IA existentes, máximo MAX_PROPUESTAS."""
    limpias = []
    for c in crudas:
        try:
            t, dur = float(c["t"]), float(c.get("dur_s", 5))
        except (KeyError, TypeError, ValueError):
            continue
        dur = min(max(dur, 3.0), 8.0)
        if not (0 <= t and t + dur <= duracion_s + 0.5):
            continue
        if any(t < fin and t + dur > ini for ini, fin in ocupados):
            continue
        if c.get("familia") not in ("grafico", "audiovisual"):
            continue
        limpias.append({"t": round(t, 2), "dur_s": round(dur, 2), "familia": c["familia"],
                        "titulo": str(c.get("titulo", ""))[:120],
                        "motivo": str(c.get("motivo", ""))[:300],
                        "prompt_imagen": str(c.get("prompt_imagen", ""))[:1000]})
        if len(limpias) >= MAX_PROPUESTAS:
            break
    return limpias


async def _proponer(name: str, data: dict, manifest: dict, contexto: str) -> list[dict]:
    """El cerebro compartido local/nube: LLM con los criterios de /broll-ai."""
    ocupados = [(ov["t_in"], ov["t_out"]) for ov in data["overlays"]]
    existentes = ("Recursos IA ya en el timeline (NO proponer encima): "
                  + ", ".join(f"{a:.1f}-{b:.1f}s" for a, b in ocupados)) if ocupados else "Timeline sin recursos IA."
    with propagate_attributes(session_id=f"editor-{name}", tags=["fusion", "b2"]):
        r = await chat_json("broll_sugerir", load_prompt("broll_system"),
                            f"Duración del video: {manifest['total']}s\n{existentes}\n\nTranscript:\n{contexto}")
    get_client().flush()
    return filtrar_propuestas(r.get("propuestas") or [], float(manifest["total"]), ocupados)


@router.post("/{name}/api/broll/sugerir")
async def sugerir(name: str):
    from server.editor import _leer_json_s3, _nube, _proyecto_nube
    if _nube():
        # M16.3: todo desde S3; cuesta créditos (LLM) — cobrar antes, devolver
        # si el LLM falla (el except del framework devuelve 500 y la UI avisa)
        from pipeline import creditos, db, media_sync
        _proyecto_nube(name)
        user = db.usuario_actual()
        data = _leer_json_s3(f"videos/{name}/work/overlays.json") or \
            {"version": 1, "estilo_prompt": "", "overlays": []}
        contexto = _condensar(_leer_json_s3(f"videos/{name}/work/edited-transcript.json"))
        manifest = _leer_json_s3(f"videos/{name}/work/editor/manifest.json") or {"total": 0}
        n = creditos.costo_broll_sugerencias()
        if creditos.activo():
            try:
                creditos.cobrar(n, f"broll-sugerir:{name}", user)
            except creditos.SinSaldo as e:
                raise HTTPException(402, str(e))
        try:
            propuestas = await _proponer(name, data, manifest, contexto)
        except Exception:
            if creditos.activo():
                creditos.devolver(n, f"broll-sugerir:{name}", user)
            raise
        data["propuestas"] = propuestas
        media_sync.escribir_texto(f"videos/{name}/work/overlays.json",
                                  json.dumps(data, ensure_ascii=False, indent=1))
        return {"propuestas": propuestas, "creditos": n}
    p = _proyecto(name)
    data = overlays.cargar(p)
    manifest = leer_json(p / "work" / "editor" / "manifest.json", default={"total": 0})
    propuestas = await _proponer(name, data, manifest, _transcript_condensado(p))
    data["propuestas"] = propuestas
    overlays.guardar(p, data)
    return {"propuestas": propuestas}
