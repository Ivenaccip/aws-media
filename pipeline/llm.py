"""Llamadas a OpenAI instrumentadas con Langfuse."""
from __future__ import annotations

import functools
import logging
import os
from typing import TYPE_CHECKING

from .config import settings
from .utils import parse_llm_json

if TYPE_CHECKING:  # solo para los type checkers — en runtime no se evalúa
    from langfuse.openai import AsyncOpenAI

log = logging.getLogger(__name__)

_client: "AsyncOpenAI | None" = None
_client_publico: "AsyncOpenAI | None" = None
_client_sin_trazas: "AsyncOpenAI | None" = None


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
    """El SDK de OpenAI SIN el envoltorio de Langfuse: la Lambda del API carga
    las claves de Langfuse de PLATAFORMA, y con el envoltorio el texto de un
    visitante anónimo terminaría en ese proyecto, sin enmascarar (lo acordado
    el 30-sep: lo público solo en su proyecto aparte, ver trazas_rag)."""
    global _client_publico
    if _client_publico is None:
        from openai import AsyncOpenAI
        _client_publico = AsyncOpenAI(api_key=clave_publica())
    return _client_publico


class ClaveFaltante(RuntimeError):
    """No hay `OPENAI_API_KEY` en el entorno: lo que pide el modelo sin trazas
    (COI y su moderación) no puede salir. El API lo traduce a «no disponible»."""


def client_sin_trazas() -> "AsyncOpenAI":
    """El SDK de OpenAI SIN el envoltorio de Langfuse y con la clave de
    PLATAFORMA (`OPENAI_API_KEY`): para lo que NO debe dejar rastro del texto
    (COI, ver server/coi_api.py). Sin reintentos propios del SDK: quien llama
    tiene su plazo y un reintento oculto lo triplicaría.

    OJO: tener este cliente no basta. `langfuse.openai` parchea con wrapt el
    método `AsyncCompletions.create` de TODO el proceso, no de su cliente: en
    cuanto algo importa `llm.client()`, hasta un `openai.AsyncOpenAI()` pelón
    queda trazado (con el texto de entrada y el de salida). Por eso las
    llamadas de este cliente pasan por `_create_sin_envoltorio`."""
    global _client_sin_trazas
    if _client_sin_trazas is None:
        if not os.getenv("OPENAI_API_KEY"):
            raise ClaveFaltante("falta OPENAI_API_KEY")
        from openai import AsyncOpenAI
        _client_sin_trazas = AsyncOpenAI(max_retries=0)
    return _client_sin_trazas


def _es_envoltorio_de_wrapt(f) -> bool:
    """¿`f` es lo que deja `wrapt.wrap_function_wrapper` sobre un método? Ojo: en wrapt 2.x
    `wrapt.ObjectProxy` (el de Python) NO es la base de los envoltorios de la extensión en C
    (`_wrappers.FunctionWrapper`), así que `isinstance(f, wrapt.ObjectProxy)` da False y el
    parche de Langfuse se quedaría puesto sin que nadie lo notara. Se compara contra las clases
    de función que wrapt exporta, y por nombre como respaldo."""
    try:
        import wrapt
        if isinstance(f, (wrapt.FunctionWrapper, wrapt.BoundFunctionWrapper)):
            return True
    except (ImportError, AttributeError):
        pass
    return type(f).__name__ in ("FunctionWrapper", "BoundFunctionWrapper")


def _create_sin_envoltorio(cliente):
    """`cliente.chat.completions.create` SIN la capa de Langfuse. Si `langfuse.openai`
    ya parcheó la clase (lo hace al importarse, para todo el proceso), se llama a la
    función original que el parche guarda en `__wrapped__`; si no la parcheó, es la
    función de siempre. Devuelve la corrutina lista para llamar con los kwargs."""
    completions = cliente.chat.completions
    create = getattr(type(completions), "create", None)
    if create is None:       # un doble de pruebas con `create` suelto en la instancia
        return completions.create
    while _es_envoltorio_de_wrapt(create) and hasattr(create, "__wrapped__"):
        create = create.__wrapped__
    return functools.partial(create, completions)


def _tokens(resp) -> tuple[int | None, int | None, int]:
    """(entrada, salida, entrada en caché) de la respuesta; nunca el texto."""
    u = getattr(resp, "usage", None)
    detalle = getattr(u, "prompt_tokens_details", None)
    en_cache = getattr(detalle, "cached_tokens", 0) or 0
    return getattr(u, "prompt_tokens", None), getattr(u, "completion_tokens", None), int(en_cache)


def _rechaza_razonamiento(err: Exception) -> bool:
    """¿El 400 es porque el modelo no acepta `reasoning_effort`? (se lee el
    error, jamás se loguea su texto)."""
    if getattr(err, "status_code", None) != 400:
        return False
    return ("reasoning_effort" in str(getattr(err, "param", "") or "")
            or "reasoning_effort" in str(err).lower())


async def chat_texto(system: str, user: str, *, razonamiento: str | None = "minimal",
                     max_tokens: int = 4000, timeout: float = 24,
                     modelo: str | None = None) -> tuple[str, dict]:
    """Un turno de chat que responde TEXTO (no JSON), sin trazas: el SDK de
    OpenAI sin Langfuse y con la clave de plataforma. Devuelve `(texto, uso)`.

    `uso` = {modelo, entrada, salida, cache_leida, fin} — solo números y el
    motivo de fin: el texto de entrada y de salida no se loguea aquí ni en
    ningún lado. Si la API rechaza `reasoning_effort` (400), se reintenta UNA
    vez sin ese parámetro y queda un warning sin texto de la persona.
    `razonamiento` vacío o None = no se manda."""
    modelo = modelo or settings.openai_model
    kw: dict = {
        "model": modelo, "timeout": timeout, "max_completion_tokens": max_tokens,
        "messages": [{"role": "system", "content": str(system)},
                     {"role": "user", "content": user}],
    }
    if razonamiento:
        kw["reasoning_effort"] = razonamiento
    create = _create_sin_envoltorio(client_sin_trazas())
    try:
        resp = await create(**kw)
    except Exception as err:  # noqa: BLE001 — se mira si es el 400 del razonamiento
        if "reasoning_effort" in kw and _rechaza_razonamiento(err):
            log.warning("chat_texto: %s no acepta reasoning_effort; se reintenta sin él", modelo)
            kw.pop("reasoning_effort")
            resp = await create(**kw)
        else:
            raise
    escogida = resp.choices[0]
    entrada, salida, en_cache = _tokens(resp)
    uso = {"modelo": modelo, "entrada": entrada, "salida": salida, "cache_leida": en_cache,
           "fin": getattr(escogida, "finish_reason", None)}
    return (escogida.message.content or ""), uso


async def chat_json(name: str, system: str, user: str, *, publico: bool = False,
                    sin_trazas: bool = False) -> dict:
    """Ejecuta un prompt que debe responder JSON puro y lo parsea. Con
    `publico` va con la clave de lo público (capa 1), no con la de plataforma.
    Con `sin_trazas` va con la clave de plataforma pero SIN Langfuse (ni la
    generation ni el enlace al prompt): para lo que lleva texto de una persona
    que no debe quedar en ningún lado (la moderación de COI)."""
    mensajes = [{"role": "system", "content": str(system)}, {"role": "user", "content": user}]
    if sin_trazas:
        resp = await _create_sin_envoltorio(client_sin_trazas())(
            model=settings.openai_model, messages=mensajes)
        entrada, salida, _ = _tokens(resp)
        log.info("%s (sin trazas): %s · entrada %s · salida %s", name, settings.openai_model,
                 entrada, salida)
        return parse_llm_json(resp.choices[0].message.content or "")
    if publico:
        # sin Langfuse (ver client_publico): solo tokens al log, para el costo
        resp = await client_publico().chat.completions.create(
            model=settings.openai_model, messages=mensajes)
        u = getattr(resp, "usage", None)
        log.info("%s (público): %s · entrada %s · salida %s", name, settings.openai_model,
                 getattr(u, "prompt_tokens", None), getattr(u, "completion_tokens", None))
        return parse_llm_json(resp.choices[0].message.content or "")
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
