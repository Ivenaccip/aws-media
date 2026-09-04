"""Llamadas a OpenAI instrumentadas con Langfuse."""
from __future__ import annotations

from langfuse.openai import AsyncOpenAI  # wrapper: cada llamada queda como `generation`

from .config import settings
from .utils import parse_llm_json

_client: AsyncOpenAI | None = None


def client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI()
    return _client


async def chat_json(name: str, system: str, user: str) -> dict:
    """Ejecuta un prompt que debe responder JSON puro y lo parsea."""
    extra = {}
    # M10: si el system salió de Langfuse (config.PromptTexto trae el objeto),
    # la generation queda enlazada a esa versión del prompt — el dashboard de
    # Langfuse cruza versión × costo × calidad.
    objeto = getattr(system, "objeto", None)
    if objeto is not None:
        extra["langfuse_prompt"] = objeto
    resp = await client().chat.completions.create(
        model=settings.openai_model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        name=name,  # nombre de la generation en Langfuse
        **extra,
    )
    return parse_llm_json(resp.choices[0].message.content or "")
