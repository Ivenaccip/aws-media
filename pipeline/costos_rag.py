"""RAG·24 — cuánto costó de verdad una corrida de /automatiza.

Los precios salen SOLO de tools/pricing.json, sección "rag" (regla del repo).
Hoy esa sección no existe: ni Claude ni gemini-embedding-001 tienen precio
confirmado ahí. Mientras falte, `costo_usd()` devuelve None y la corrida
guarda solo los tokens (en `resultado.uso`), así el costo se puede calcular
hacia atrás cuando el dueño agregue los precios. Nunca se inventa un número.

Forma esperada de la sección (dólares por millón de tokens; el embedding
solo usa "entrada"; las consultas, dólares por millón de consultas):

    "rag": {
      "verified_on": "AAAA-MM-DD",
      "modelos": {
        "claude-opus-5-5": {"entrada": 0.0, "salida": 0.0,
                            "cache_escrita": 0.0, "cache_leida": 0.0},
        "text-embedding-3-small": {"entrada": 0.0}
      },
      "s3vectors": {"consultas_por_millon": 0.0}
    }

S3 Vectors cobra además por datos procesados en cada consulta; con un índice
de unos cientos de trozos es despreciable y aquí no se suma (si el índice
crece, se agrega).

La moderación de la entrada (gpt-5-mini, en la Lambda del API) NO entra aquí:
pasa antes de que exista la corrida. Sus tokens salen en el log del API.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

RUTA = Path(__file__).resolve().parent.parent / "tools" / "pricing.json"
CAMPOS = ("entrada", "salida", "cache_escrita", "cache_leida")


@lru_cache(maxsize=1)
def _rag() -> dict:
    return json.loads(RUTA.read_text(encoding="utf-8")).get("rag", {})


def precios() -> dict:
    return _rag().get("modelos", {})


def _numero(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def costo(llamadas: list[dict], consultas: int = 0) -> float | None:
    """Suma de las llamadas (y consultas a S3 Vectors) de una corrida, o None
    si a alguna le falta precio en pricing.json o tokens. Una corrida sin
    llamadas ni consultas cuesta 0."""
    tabla = precios()
    total = 0.0
    for ll in llamadas:
        p = tabla.get(ll["modelo"])
        campos = ("entrada",) if ll.get("tipo") == "embedding" else CAMPOS
        if not p or any(not _numero(p.get(c)) for c in campos):
            return None
        if any(not _numero(ll.get(c)) for c in campos):
            return None
        total += sum(ll[c] * p[c] for c in campos) / 1_000_000
    if consultas:
        q = _rag().get("s3vectors", {}).get("consultas_por_millon")
        if not _numero(q):
            return None
        total += consultas * q / 1_000_000
    return round(total, 4)


def costo_usd(uso) -> float | None:
    """El costo de un `claude_rag.Uso`."""
    return costo(uso.llamadas, getattr(uso, "consultas", 0))


def costo_de_resultado(uso: dict | None) -> float | None:
    """El costo de `resultado.uso` guardado en una corrida, con los precios de
    HOY: así las corridas viejas se cuentan cuando el dueño agregue precios."""
    if not uso:
        return None
    return costo(uso.get("llamadas") or [], uso.get("consultas_vector") or 0)
