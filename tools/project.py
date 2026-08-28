"""Scaffold y resolución de rutas de un proyecto videos/video-N.

Usage:
  python tools/project.py new video-1        # crea el árbol work/ estable
  python tools/project.py shorts-tmp video-1 # imprime el SHORTS_TMP del proyecto

La capa compartida de carpetas (handoff §4.3): todo el estado de ambas ramas vive
bajo el árbol work/ de L1. La rama shorts NO escribe a /tmp: SHORTS_TMP se cablea a
videos/video-N/work/shorts — lo setea la skill orquestadora vía este tool, nunca el
usuario a mano.

Árbol por proyecto:
  videos/video-N/
  ├── *.MP4 / *.mov          ← metraje crudo (gitignored)
  ├── work/
  │   ├── audio/             ← WAVs 16 kHz mono por clip
  │   ├── transcripts/       ← <id>.json crudo del backend + <id>.canonical.json
  │   ├── analysis/          ← cuts.json, qa-report.md, verify-report.md
  │   ├── editor/            ← proxy + manifest del cut-editor UI
  │   ├── render/            ← segmentos intermedios del render longform
  │   └── shorts/            ← SHORTS_TMP del proyecto (clips, render, snapped_segments)
  └── output/                ← masters, previews y shorts exportados
"""

import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

WORK_DIRS = ["work/audio", "work/transcripts", "work/analysis",
             "work/editor", "work/render", "work/shorts", "output"]


def project_dir(name: str) -> Path:
    # F4.3: MEDIA_ROOT redirige dónde viven los proyectos; default = raíz del repo.
    # Mismo contrato que pipeline/storage.py (los tools no importan pipeline).
    media_root = Path(os.environ.get("MEDIA_ROOT", str(REPO))).resolve()
    p = media_root / "videos" / name
    if not name.replace("-", "").replace("_", "").isalnum():
        sys.exit(f"nombre de proyecto inválido: {name}")
    return p


def shorts_tmp(name: str) -> Path:
    return project_dir(name) / "work" / "shorts"


def new(name: str) -> None:
    p = project_dir(name)
    for d in WORK_DIRS:
        (p / d).mkdir(parents=True, exist_ok=True)
    print(f"proyecto listo: {p}")
    print(f"SHORTS_TMP del proyecto: {shorts_tmp(name)}")


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in ("new", "shorts-tmp"):
        sys.exit(__doc__)
    cmd, name = sys.argv[1], sys.argv[2]
    if cmd == "new":
        new(name)
    else:
        # ruta absoluta con forward slashes — consumible por Git Bash en Windows
        print(shorts_tmp(name).as_posix())


if __name__ == "__main__":
    main()
