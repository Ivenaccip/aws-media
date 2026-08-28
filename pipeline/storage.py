"""Capa fina de estado (PLAN-FUSION.md F4.1): todo JSON de estado nuevo se lee y
escribe por aquí — nada de open() regado. Hoy es disco local; el salto a Postgres/S3
será cambiar este módulo, no a sus consumidores.

También resuelve las rutas de media (PLAN F4.3): MEDIA_ROOT es la raíz bajo la que
viven videos/ (proyectos del editor) y work/ (proyectos del generador). Default =
raíz del repo, así el dev local no cambia; en el servicio apuntará al volumen/S3.
Los CLIs de tools/ NO importan este módulo: reciben rutas absolutas del caller
(o leen MEDIA_ROOT del env los que derivan rutas desde un nombre)."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

_REPO = Path(__file__).resolve().parent.parent


def media_root() -> Path:
    """Se lee del env en cada llamada (no al importar): los tests pueden
    redirigirla con monkeypatch.setenv sin recargar módulos."""
    return Path(os.getenv("MEDIA_ROOT", str(_REPO))).resolve()


def videos_root() -> Path:
    """Raíz de los proyectos del editor (rama e1 / p1)."""
    return media_root() / "videos"


def ruta_proyecto(nombre: str) -> Path:
    """Carpeta de un proyecto del editor. Valida el nombre (sin separadores ni
    '..'): estas rutas se componen con input del navegador."""
    if not nombre or not nombre.replace("-", "").replace("_", "").isalnum():
        raise ValueError(f"nombre de proyecto inválido: {nombre!r}")
    return videos_root() / nombre


def work_root() -> Path:
    """Raíz de los proyectos del generador (rama crear / p2). WORK_DIR manda si
    está seteada (compat con .env existentes); si no, cuelga de MEDIA_ROOT."""
    return Path(os.getenv("WORK_DIR", str(media_root() / "work")))


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
