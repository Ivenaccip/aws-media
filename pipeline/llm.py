"""Llamadas a OpenAI instrumentadas con Langfuse."""
from __future__ import annotations

from typing import TYPE_CHECKING

from .config import settings
from .utils import parse_llm_json

if TYPE_CHECKING:  # solo para los type checkers — en runtime no se evalúa
    from langfuse.openai import AsyncOpenAI

_client: "AsyncOpenAI | None" = None
_client_publico: "AsyncOpenAI | None" = None


def client() -> "AsyncOpenAI":
    global _client
    if _client is None:
        # El import vive aquí y no arriba a propósito: `langfuse.openai` arrastra
        # el SDK de OpenAI entero (1,8 s de los 4,7 s que tardaba importar
        # server.app), y la Lambda del API sirve miles de peticiones que jamás
        # llaman al LLM. El init de Lambda tiene 10 s y no le sobra ninguno.
        # wrapper: cada llamada queda como `generation` en Langfuse
        from langfuse.openai import AsyncOpenAI

        _client = AsyncOpenAI()
    return _client


def clave_publica() -> str:
    """Capa 1: la clave de OpenAI de lo PÚBLICO, nunca la de plataforma.
    `OPENAI_API_KEY_PUBLICO` si está en el entorno; si no, el parámetro de
    SSM que dice `SSM_OPENAI_PUBLICO` (la Lambda del API: solo ESE parámetro).
    Sin ninguna de las dos truena, y la moderación falla cerrado."""
    import os
    k = os.getenv("OPENAI_API_KEY_PUBLICO")
    if k:
        return k
    nombre = os.getenv("SSM_OPENAI_PUBLICO")
    if not nombre:
        raise RuntimeError("falta la clave pública de OpenAI (SSM_OPENAI_PUBLICO)")
    import boto3
    return boto3.client("ssm").get_parameter(Name=nombre, WithDecryption=True)["Parameter"]["Value"]


def client_publico() -> "AsyncOpenAI":
    global _client_publico
    if _client_publico is None:
        from langfuse.openai import AsyncOpenAI
        _client_publico = AsyncOpenAI(api_key=clave_publica())
    return _client_publico


async def chat_json(name: str, system: str, user: str, *, publico: bool = False) -> dict:
    """Ejecuta un prompt que debe responder JSON puro y lo parsea. Con
    `publico` va con la clave de lo público (capa 1), no con la de plataforma."""
    extra = {}
    # M10: si el system salió de Langfuse (config.PromptTexto trae el objeto),
    # la generation queda enlazada a esa versión del prompt — el dashboard de
    # Langfuse cruza versión × costo × calidad.
    objeto = getattr(system, "objeto", None)
    if objeto is not None:
        extra["langfuse_prompt"] = objeto
    resp = await (client_publico() if publico else client()).chat.completions.create(
        model=settings.openai_model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        name=name,  # nombre de la generation en Langfuse
        **extra,
    )
    return parse_llm_json(resp.choices[0].message.content or "")
