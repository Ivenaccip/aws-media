"""M13 — guardrail del brief: revisa el texto ANTES de cobrar y de lanzar el
pipeline. Los modelos generativos rechazan violencia explícita / contenido
sexual a mitad de la producción; mejor avisarle al usuario de entrada.

Falla ABIERTO: si el LLM no responde, se permite — los guardrails de los
vendors siguen atrás y un filtro caído no debe tumbar el producto.

RAG·7: en el camino público (/automatiza, internet abierto) falla CERRADO —
ahí no hay usuario con cuenta ni monedero detrás, y un filtro caído que deja
pasar todo es justo el agujero. `falla_cerrado=True` lo pide explícito y el
candado de identidad (db.en_camino_publico) lo fuerza aunque se olvide."""
from __future__ import annotations

import logging

from langfuse import observe
from pydantic import BaseModel

from . import db
from .config import load_prompt
from .llm import chat_json

log = logging.getLogger("moderacion")

MENSAJE_BASE = ("La IA no permite violencia explícita, sangre, contenido "
                "sexual ni odio. Ajusta tu texto para continuar.")


class Veredicto(BaseModel):
    permitido: bool
    motivo: str = ""
    # RAG·7: True cuando NO se pudo moderar (falla cerrado). Separa «tu texto
    # no pasa» de «ahorita no está disponible»: son mensajes distintos.
    caido: bool = False


@observe(name="moderar")
async def revisar(texto: str, *, prompt: str = "moderar_system",
                  falla_cerrado: bool = False) -> Veredicto:
    cerrado = falla_cerrado or db.en_camino_publico()
    texto = (texto or "").strip()
    if not texto:
        return Veredicto(permitido=True)
    try:
        r = await chat_json("moderar", load_prompt(prompt), texto[:4000])
    except Exception as err:  # noqa: BLE001
        if cerrado:
            log.error("moderación no disponible (%s) — se rechaza (falla cerrado)", err)
            return Veredicto(permitido=False, caido=True)
        log.warning("moderación no disponible (%s) — se permite", err)
        return Veredicto(permitido=True)
    r = r if isinstance(r, dict) else {}
    if cerrado:
        # Cerrado de verdad: solo un booleano JSON cuenta como veredicto. Sin
        # la llave (ni default a True), un "true" en texto o cualquier otra
        # cosa rara cuenta como no moderado.
        permitido = r.get("permitido")
        if not isinstance(permitido, bool):
            log.error("moderación respondió sin veredicto claro — se rechaza")
            return Veredicto(permitido=False, caido=True)
    else:
        permitido = bool(r.get("permitido", True))
    return Veredicto(permitido=permitido, motivo=str(r.get("motivo") or ""))
