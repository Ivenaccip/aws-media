"""Capa fina de estado (PLAN-FUSION.md F4.1): todo JSON de estado nuevo se lee y
escribe por aquí — nada de open() regado. Hoy es disco local; el salto a Postgres/S3
será cambiar este módulo, no a sus consumidores."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path


def leer_json(path: Path, default=None):
    if not Path(path).is_file():
        if default is not None:
            return default
        raise FileNotFoundError(path)
    return json.loads(Path(path).read_text(encoding="utf-8"))


def escribir_json(path: Path, data) -> None:
    """Escritura atómica (tmp + replace): un crash a mitad no deja JSON corrupto."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
