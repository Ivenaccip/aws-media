"""Brief → clasificar (historia | idea) → deep research con web_search de OpenAI."""
from __future__ import annotations

import logging
import re
from typing import Literal

from langfuse import get_client, observe
from pydantic import BaseModel, Field

from .config import load_prompt, settings
from .llm import chat_json, client

log = logging.getLogger(__name__)

TipoBrief = Literal["historia", "idea"]


class Dossier(BaseModel):
    texto: str
    fuentes: list[str] = Field(default_factory=list)


def interpretar_tipo(r: dict, brief: str) -> TipoBrief:
    tipo = r.get("tipo")
    if tipo in ("historia", "idea"):
        return tipo
    # Heurística de respaldo: textos largos suelen ser historias
    return "historia" if len(brief.split()) > 120 else "idea"


@observe(name="clasificar_brief")
async def clasificar(brief: str) -> TipoBrief:
    r = await chat_json("clasificar_brief", load_prompt("clasificar_system"), brief)
    tipo = interpretar_tipo(r, brief)
    get_client().update_current_span(output={"tipo": tipo, "motivo": r.get("motivo")})
    return tipo


def _extraer_fuentes(resp) -> list[str]:
    urls: list[str] = []
    for item in getattr(resp, "output", None) or []:
        if getattr(item, "type", None) != "message":
            continue
        for c in getattr(item, "content", None) or []:
            for a in getattr(c, "annotations", None) or []:
                url = getattr(a, "url", None)
                if url and url not in urls:
                    urls.append(url)
    return urls


@observe(name="research")
async def investigar(brief: str) -> Dossier:
    """Responses API + web_search. El wrapper de Langfuse registra la llamada como generation."""
    resp = await client().responses.create(
        model=settings.openai_model,
        tools=[{"type": "web_search"}],
        instructions=load_prompt("research_system"),
        input=brief,
        name="research",
    )
    texto = re.sub(r"\s*\(\[[^\]]*\]\([^)]*\)\)", "", resp.output_text or "")  # quita «([dominio](url))»
    texto = re.sub(r"\?utm_source=openai", "", texto)
    d = Dossier(texto=texto.strip(), fuentes=[u.replace("?utm_source=openai", "") for u in _extraer_fuentes(resp)])
    if not d.texto:
        raise RuntimeError("La investigación no devolvió texto")
    get_client().update_current_span(output={"palabras": len(d.texto.split()), "fuentes": d.fuentes})
    return d
