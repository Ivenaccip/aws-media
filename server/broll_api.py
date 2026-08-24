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

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from langfuse import get_client, propagate_attributes

from pipeline import overlays
from pipeline.config import load_prompt
from pipeline.llm import chat_json
from pipeline.storage import leer_json

log = logging.getLogger("broll_api")
ROOT = Path(__file__).resolve().parent.parent
router = APIRouter(prefix="/editor")

MAX_PROPUESTAS = 5


def _proyecto(name: str) -> Path:
    if not name.replace("-", "").replace("_", "").isalnum():
        raise HTTPException(422, f"nombre inválido: {name}")
    p = ROOT / "videos" / name
    if not p.is_dir():
        raise HTTPException(404, f"proyecto {name} no existe")
    return p


def _transcript_condensado(p: Path, max_chars: int = 3000) -> str:
    et = leer_json(p / "work" / "edited-transcript.json", default=None)
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


@router.post("/{name}/api/broll/sugerir")
async def sugerir(name: str):
    p = _proyecto(name)
    data = overlays.cargar(p)
    ocupados = [(ov["t_in"], ov["t_out"]) for ov in data["overlays"]]
    manifest = leer_json(p / "work" / "editor" / "manifest.json", default={"total": 0})
    contexto = _transcript_condensado(p)
    existentes = ("Recursos IA ya en el timeline (NO proponer encima): "
                  + ", ".join(f"{a:.1f}-{b:.1f}s" for a, b in ocupados)) if ocupados else "Timeline sin recursos IA."
    with propagate_attributes(session_id=f"editor-{name}", tags=["fusion", "b2"]):
        r = await chat_json("broll_sugerir", load_prompt("broll_system"),
                            f"Duración del video: {manifest['total']}s\n{existentes}\n\nTranscript:\n{contexto}")
    get_client().flush()
    propuestas = filtrar_propuestas(r.get("propuestas") or [], float(manifest["total"]), ocupados)
    data["propuestas"] = propuestas
    overlays.guardar(p, data)
    return {"propuestas": propuestas}
