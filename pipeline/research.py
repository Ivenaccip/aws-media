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


@observe(name="balanceador_rubro")
async def balancear(brief: str, rubro: str) -> dict:
    """F3.3: valida tema vs rubro ANTES de gastar en research (~$0.001).
    Devuelve {coincide: bool, motivo: str}; ante duda del LLM, deja pasar."""
    r = await chat_json("balanceador_rubro", load_prompt("balanceador_system"),
                        f"Rubro del canal: {rubro}\n\nBrief del video:\n{brief}")
    resultado = {"coincide": bool(r.get("coincide", True)), "motivo": str(r.get("motivo", ""))[:300]}
    get_client().update_current_span(output=resultado)
    return resultado


FORMATOS = ("cuento", "lista", "explicador")


@observe(name="clasificar_brief")
async def clasificar(brief: str) -> tuple[TipoBrief, str]:
    """Devuelve (tipo, formato). El formato es el balanceador del guionista
    (decisión 2026-09-07): «3 curiosidades de X» debe salir como LISTA
    numerada, no convertido a cuento con protagonista inventado."""
    r = await chat_json("clasificar_brief", load_prompt("clasificar_system"), brief)
    tipo = interpretar_tipo(r, brief)
    formato = r.get("formato") if r.get("formato") in FORMATOS else "cuento"
    get_client().update_current_span(output={"tipo": tipo, "formato": formato,
                                             "motivo": r.get("motivo")})
    return tipo, formato


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
