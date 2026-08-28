"""Panel Importar del editor (F3.5): listar MP4s sueltos en videos/, miniaturas,
e incorporarlos al proyecto como clips (tools/agregar_video.py en background).

Todo local y $0 (whisper CPU + ffmpeg). El modo "ia" lo resuelve la UI: tras
incorporar, manda el encargo de corte al chat de Claude del proyecto.
"""
from __future__ import annotations

import subprocess
import sys
import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
VIDEOS = ROOT / "videos"
MINIATURAS = VIDEOS / ".miniaturas"
EXTS = {".mp4", ".mov", ".m4v"}

router = APIRouter(prefix="/editor")
_jobs: dict[str, dict] = {}     # project → {running, log, ok}


class ImportarIn(BaseModel):
    archivos: list[str]


def _proyecto(name: str) -> Path:
    from server.editor import _proyecto as p
    return p(name)


def _sueltos() -> list[Path]:
    """MP4s directamente en videos/ (no dentro de proyectos) = staging del ＋."""
    return sorted(f for f in VIDEOS.iterdir() if f.is_file() and f.suffix.lower() in EXTS)


@router.get("/{name}/api/importables")
def importables(name: str):
    _proyecto(name)
    return {"archivos": [{"nombre": f.name, "mb": round(f.stat().st_size / 1e6, 1)}
                         for f in _sueltos()],
            "job": _jobs.get(name, {"running": False, "log": "", "ok": None})}


@router.get("/{name}/api/importables/miniatura/{archivo}")
def miniatura(name: str, archivo: str):
    _proyecto(name)
    src = VIDEOS / Path(archivo).name
    if not src.is_file() or src.suffix.lower() not in EXTS:
        raise HTTPException(404, "no existe")
    MINIATURAS.mkdir(exist_ok=True)
    jpg = MINIATURAS / (src.stem + ".jpg")
    if not jpg.is_file() or jpg.stat().st_mtime < src.stat().st_mtime:
        r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "1", "-i", str(src),
                            "-frames:v", "1", "-vf", "scale=180:-2", str(jpg)],
                           capture_output=True, text=True)
        if r.returncode != 0 or not jpg.is_file():
            raise HTTPException(500, f"miniatura falló: {r.stderr[:150]}")
    return FileResponse(jpg, media_type="image/jpeg")


def _run_importar(name: str, archivos: list[str]) -> None:
    st = _jobs[name]
    st.update(running=True, log="", ok=None)
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "tools" / "agregar_video.py"), f"videos/{name}", *archivos],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        encoding="utf-8", errors="replace", cwd=str(ROOT))
    for line in proc.stdout:
        st["log"] += line
    proc.wait()
    st.update(running=False, ok=proc.returncode == 0)


@router.post("/{name}/api/importar")
def importar(name: str, body: ImportarIn):
    _proyecto(name)
    st = _jobs.setdefault(name, {"running": False, "log": "", "ok": None})
    if st["running"]:
        raise HTTPException(409, "ya hay una incorporación en curso")
    nombres = [Path(a).name for a in body.archivos]
    sueltos = {f.name for f in _sueltos()}
    malos = [n for n in nombres if n not in sueltos]
    if not nombres or malos:
        raise HTTPException(422, f"archivos inválidos: {malos or 'ninguno seleccionado'}")
    threading.Thread(target=_run_importar, args=(name, nombres), daemon=True).start()
    return {"iniciado": True, "archivos": nombres}


@router.get("/{name}/api/importar/estado")
def estado(name: str):
    return _jobs.get(name, {"running": False, "log": "", "ok": None})
