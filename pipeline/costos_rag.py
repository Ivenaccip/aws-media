"""RAG·24 — cuánto costó de verdad una corrida de /automatiza.

Los precios salen SOLO de tools/pricing.json, sección "rag" (regla del repo).
Hoy esa sección no existe: ni Claude ni gemini-embedding-001 tienen precio
confirmado ahí. Mientras falte, `costo_usd()` devuelve None y la corrida
guarda solo los tokens (en `resultado.uso`), así el costo se puede calcular
hacia atrás cuando el dueño agregue los precios. Nunca se inventa un número.

Forma esperada de la sección (dólares por millón de tokens):

    "rag": {
      "verified_on": "AAAA-MM-DD",
      "modelos": {
        "claude-opus-5-5": {"entrada": 0.0, "salida": 0.0,
                            "cache_escrita": 0.0, "cache_leida": 0.0}
      }
    }
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

RUTA = Path(__file__).resolve().parent.parent / "tools" / "pricing.json"
CAMPOS = ("entrada", "salida", "cache_escrita", "cache_leida")


@lru_cache(maxsize=1)
def precios() -> dict:
    return json.loads(RUTA.read_text(encoding="utf-8")).get("rag", {}).get("modelos", {})


def costo_usd(uso) -> float | None:
    """Suma de las llamadas de la corrida, o None si algún modelo no tiene
    precio completo en pricing.json. Una corrida sin llamadas cuesta 0."""
    tabla = precios()
    total = 0.0
    for ll in uso.llamadas:
        p = tabla.get(ll["modelo"])
        if not p or any(not isinstance(p.get(c), (int, float)) for c in CAMPOS):
            return None
        total += sum(ll[c] * p[c] for c in CAMPOS) / 1_000_000
    return round(total, 4)
