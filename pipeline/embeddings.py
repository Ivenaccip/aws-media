"""RAG·19/20 — embeddings del RAG con gemini-embedding-001 (API de Google).

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


class SinClave(RuntimeError):
    """No hay clave de Gemini para lo público."""


def clave() -> str:
    k = os.getenv("GEMINI_API_KEY_PUBLICO") or os.getenv("GEMINI_API_KEY")
    if not k:
        raise SinClave("falta GEMINI_API_KEY (en el worker sale de /publico/)")
    return k


def cliente():
    from google import genai
    return genai.Client(api_key=clave())


def embeber(textos: Iterable[str], tarea: str, *, cli=None) -> list[list[float]]:
    """Un vector de 1024, ya normalizado, por texto y en el mismo orden. El
    título de cada trozo va DENTRO de su texto (tools/ingesta.py): el campo
    `title` de Google obliga a una llamada por trozo."""
    if tarea not in TAREAS:
        raise ValueError(f"tarea tiene que ser una de {sorted(TAREAS)}")
    lista = list(textos)
    if any(not t or not t.strip() for t in lista):
        raise ValueError("no se embebe un texto vacío")
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
                    model=vectores.MODELO_EMBEDDINGS, contents=parte, config=config)
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
