"""Utilidades puras: normalización, parseo de JSON del LLM, duraciones."""
from __future__ import annotations

import json
import re
import unicodedata
from typing import Any


def norm(s: Any) -> str:
    """Sin tildes, trim, minúsculas (igual que `norm` en n8n)."""
    s = "" if s is None else str(s)
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.strip().lower()


def parse_llm_json(raw: str) -> dict:
    """Quita ```json fences y parsea. Lanza ValueError con el fragmento recibido."""
    txt = re.sub(r"```json|```", "", raw or "").strip()
    try:
        return json.loads(txt)
    except json.JSONDecodeError as e:
        raise ValueError(f"El LLM no devolvió JSON válido: {txt[:300]}") from e


_DUR_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")


def parse_ffmpeg_duration(stderr: str) -> float | None:
    """Extrae la duración en segundos de la salida `ffmpeg -i`."""
    m = _DUR_RE.search(stderr or "")
    if not m:
        return None
    h, mi, s = m.groups()
    return round(int(h) * 3600 + int(mi) * 60 + float(s), 2)


def natural_key(s: str) -> list:
    """Orden natural: 1, 2, 5a, 5b, 10."""
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", s)]


def drive_public_url(fila: dict) -> str | None:
    """url explícita > drive_id > nada (Preparar biblioteca)."""
    url = str(fila.get("url") or "").strip()
    if url:
        return url
    _id = str(fila.get("drive_id") or fila.get("driveId") or fila.get("id") or "").strip()
    return f"https://drive.google.com/uc?export=download&id={_id}" if _id else None
