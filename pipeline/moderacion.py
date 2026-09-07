"""M13 — guardrail del brief: revisa el texto ANTES de cobrar y de lanzar el
pipeline. Los modelos generativos rechazan violencia explícita / contenido
sexual a mitad de la producción; mejor avisarle al usuario de entrada.

Falla ABIERTO: si el LLM no responde, se permite — los guardrails de los
vendors siguen atrás y un filtro caído no debe tumbar el producto."""
from __future__ import annotations

import logging

from langfuse import observe
from pydantic import BaseModel

from .config import load_prompt
from .llm import chat_json

log = logging.getLogger("moderacion")

MENSAJE_BASE = ("La IA no permite violencia explícita, sangre, contenido "
                "sexual ni odio. Ajusta tu texto para continuar.")


class Veredicto(BaseModel):
    permitido: bool
    motivo: str = ""


@observe(name="moderar")
async def revisar(texto: str) -> Veredicto:
    texto = (texto or "").strip()
    if not texto:
        return Veredicto(permitido=True)
    try:
        r = await chat_json("moderar", load_prompt("moderar_system"), texto[:4000])
        return Veredicto(permitido=bool(r.get("permitido", True)),
                         motivo=str(r.get("motivo") or ""))
    except Exception as err:  # noqa: BLE001
        log.warning("moderación no disponible (%s) — se permite", err)
        return Veredicto(permitido=True)
