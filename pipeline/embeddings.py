"""RAG·19/20 — embeddings del RAG con gemini-embedding-001 (API de Google).

RESPALDO TEMPORAL (30-sep): con EMBEDDINGS=titan se embebe con Amazon Titan
Text Embeddings V2 por Bedrock (pipeline/vectores.py). IAM puro: ni clave ni
SSM. Titan no distingue documento de consulta; la `tarea` se sigue exigiendo
para que el código no cambie al volver a Gemini. Precio de Titan: sin precio
confirmado (no está en tools/pricing.json).

SEGUNDO RESPALDO (1-oct): con EMBEDDINGS=openai se embebe con OpenAI
text-embedding-3-small y `dimensions`=1024. La clave es `OPENAI_API_KEY_PUBLICO`
si existe; si no, `OPENAI_API_KEY`. En el worker solo existe la segunda y sale
de `/publico/` (una clave nueva con su propio tope, nunca la de plataforma).
OpenAI tampoco distingue documento de consulta. Precio: sin precio confirmado.

Lo que decidió el dueño el 29-sep y NO se cambia sin reindexar (pipeline/vectores.py):
1024 dimensiones con `output_dimensionality`, renormalizadas a norma 1, y
`task_type` de DOCUMENTO para lo que se ingesta y de CONSULTA para lo que se
pregunta. Mezclar los dos tipos degrada la búsqueda sin dar ningún error: por
eso `embeber()` exige decir cuál es.

`auto_truncate=False`: si un trozo pasa del contexto del modelo (2 048 tokens),
Google responde error en vez de cortarlo en silencio. Un trozo cortado se
indexa como si estuviera completo y nadie se entera.

LA CLAVE: `GEMINI_API_KEY_PUBLICO` si existe; si no, `GEMINI_API_KEY`. En el
worker público solo existe la segunda y sale de `/publico/` (capa 1). En la
máquina del dueño la primera evita usar por accidente la clave de plataforma
del `.env` (tools/ingesta.py la lee de SSM `/publico/`).

Precio: sin precio confirmado (gemini-embedding-001 no está en tools/pricing.json).
"""
from __future__ import annotations

import json
import os
import time
from typing import Iterable

from pipeline import vectores

TAREAS = {"documento": "RETRIEVAL_DOCUMENT", "consulta": "RETRIEVAL_QUERY"}
LOTE = 100          # textos por llamada (batchEmbedContents)
# La ingesta manda cientos de trozos seguidos y choca con el límite por
# minuto de Google (429 / RESOURCE_EXHAUSTED): se espera y se reintenta.
# Cualquier otro error sube a la primera.
ESPERAS_429 = (5, 15, 30, 60)


# Qué clave de /publico/ necesita cada proveedor (Titan va por IAM, sin clave).
# La ingesta y el eval la leen de SSM y la ponen como `<NOMBRE>_PUBLICO`.
CLAVES = {"gemini": "GEMINI_API_KEY", "titan": None, "openai": "OPENAI_API_KEY"}


class SinClave(RuntimeError):
    """No hay clave del proveedor de embeddings para lo público."""


def clave() -> str:
    k = os.getenv("GEMINI_API_KEY_PUBLICO") or os.getenv("GEMINI_API_KEY")
    if not k:
        raise SinClave("falta GEMINI_API_KEY (en el worker sale de /publico/)")
    return k


def cliente():
    from google import genai
    return genai.Client(api_key=clave())


def embeber(textos: Iterable[str], tarea: str, *, cli=None, uso=None) -> list[list[float]]:
    """Un vector de 1024, ya normalizado, por texto y en el mismo orden. El
    título de cada trozo va DENTRO de su texto (tools/ingesta.py): el campo
    `title` de Google obliga a una llamada por trozo.

    Con `uso` (un claude_rag.Uso, RAG·24) anota los tokens que cobró el
    proveedor; dentro de una corrida, además, una observación en la traza
    (RAG·23)."""
    if tarea not in TAREAS:
        raise ValueError(f"tarea tiene que ser una de {sorted(TAREAS)}")
    lista = list(textos)
    if any(not t or not t.strip() for t in lista):
        raise ValueError("no se embebe un texto vacío")
    from pipeline import trazas_rag
    modelo = vectores.modelo()
    with trazas_rag.etapa(f"embeber_{tarea}", tipo="embedding", model=modelo) as obs:
        fuera, tokens = _por_proveedor(lista, tarea, cli)
        if tokens is not None:
            obs.update(usage_details={"input": tokens}, metadata={"textos": len(lista)})
    if uso is not None:
        uso.sumar_embedding(f"embeber_{tarea}", modelo, tokens)
    return fuera


def _por_proveedor(lista: list[str], tarea: str, cli) -> tuple[list[list[float]], int | None]:
    """(vectores, tokens cobrados o None si el proveedor no los dice)."""
    if vectores.proveedor() == "titan":
        return _titan(lista, cli)
    if vectores.proveedor() == "openai":
        return _openai(lista, cli)
    return _gemini(lista, tarea, cli), None


def _gemini(lista: list[str], tarea: str, cli=None) -> list[list[float]]:
    from google.genai import types
    cli = cli or cliente()
    fuera: list[list[float]] = []
    for i in range(0, len(lista), LOTE):
        parte = lista[i:i + LOTE]
        config = types.EmbedContentConfig(
            task_type=TAREAS[tarea], output_dimensionality=vectores.DIMENSION,
            auto_truncate=False)
        for espera in (*ESPERAS_429, None):
            try:
                r = cli.models.embed_content(
                    model=vectores.MODELOS["gemini"], contents=parte, config=config)
                break
            except Exception as e:  # noqa: BLE001 — solo se perdona el límite por minuto
                texto = f"{type(e).__name__} {e}"
                if espera is None or not ("429" in texto or "RESOURCE_EXHAUSTED" in texto):
                    raise
                time.sleep(espera)
        if len(r.embeddings) != len(parte):
            raise RuntimeError("Gemini devolvió otro número de vectores")
        fuera.extend(vectores.validar(e.values) for e in r.embeddings)
    return fuera


# --- respaldo temporal: Titan V2 por Bedrock ---------------------------------

def cliente_bedrock():
    import boto3
    return boto3.client("bedrock-runtime", region_name=os.getenv("AWS_REGION", "us-east-1"))


def _titan(lista: list[str], cli=None) -> tuple[list[list[float]], int | None]:
    """Titan no tiene lotes síncronos: una llamada por texto. Su tope es de
    50 000 caracteres (los trozos de la ingesta no pasan de 6 000). Se
    reintenta solo el límite por minuto de Bedrock (ThrottlingException)."""
    cli = cli or cliente_bedrock()
    fuera: list[list[float]] = []
    tokens: int | None = 0
    for texto in lista:
        cuerpo = json.dumps({"inputText": texto, "dimensions": vectores.DIMENSION,
                             "normalize": True, "embeddingTypes": ["float"]})
        for espera in (*ESPERAS_429, None):
            try:
                r = cli.invoke_model(modelId=vectores.MODELOS["titan"], body=cuerpo,
                                     contentType="application/json", accept="application/json")
                break
            except Exception as e:  # noqa: BLE001 — solo se perdona el límite por minuto
                if espera is None or "Throttling" not in f"{type(e).__name__} {e}":
                    raise
                time.sleep(espera)
        datos = json.loads(r["body"].read())
        fuera.append(vectores.validar(datos.get("embeddingsByType", {}).get("float")
                                      or datos["embedding"]))
        n = datos.get("inputTextTokenCount")
        tokens = tokens + n if tokens is not None and isinstance(n, int) else None
    return fuera, tokens


# --- segundo respaldo temporal: OpenAI text-embedding-3-small ----------------

def clave_openai() -> str:
    k = os.getenv("OPENAI_API_KEY_PUBLICO") or os.getenv("OPENAI_API_KEY")
    if not k:
        raise SinClave("falta OPENAI_API_KEY (en el worker sale de /publico/)")
    return k


def cliente_openai():
    from openai import OpenAI
    # sin reintentos propios del SDK: los de abajo son los únicos y se ven
    return OpenAI(api_key=clave_openai(), max_retries=0)


def _openai(lista: list[str], cli=None) -> tuple[list[list[float]], int | None]:
    """Lotes de LOTE textos por llamada. Con `dimensions` OpenAI ya devuelve
    el vector recortado y normalizado; `validar` lo revisa igual. Se reintenta
    solo el límite por minuto (429 / RateLimitError)."""
    cli = cli or cliente_openai()
    fuera: list[list[float]] = []
    tokens: int | None = 0
    for i in range(0, len(lista), LOTE):
        parte = lista[i:i + LOTE]
        for espera in (*ESPERAS_429, None):
            try:
                r = cli.embeddings.create(model=vectores.MODELOS["openai"], input=parte,
                                          dimensions=vectores.DIMENSION,
                                          encoding_format="float")
                break
            except Exception as e:  # noqa: BLE001 — solo se perdona el límite por minuto
                texto = f"{type(e).__name__} {e}"
                if espera is None or not ("429" in texto or "RateLimit" in texto):
                    raise
                time.sleep(espera)
        if len(r.data) != len(parte):
            raise RuntimeError("OpenAI devolvió otro número de vectores")
        # el orden lo da `index`, no la posición en la respuesta
        fuera.extend(vectores.validar(d.embedding) for d in sorted(r.data, key=lambda d: d.index))
        n = getattr(getattr(r, "usage", None), "prompt_tokens", None)
        tokens = tokens + n if tokens is not None and isinstance(n, int) else None
    return fuera, tokens
