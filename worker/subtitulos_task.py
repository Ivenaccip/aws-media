"""M16.1 — quemado de subtítulos del editor en Fargate (la lanza la state machine).

    python -m worker.subtitulos_task <user_id> <nombre>

Baja videos/<nombre>/ de S3 al FS efímero, corre tools/make_subs.py en modo
final sobre pelicula.mp4 (la base de los proyectos gen-* del generador) y sube
pelicula-subtitulado.mp4 + subs.srt/.ass de vuelta a S3. El estado viaja por
proyectos_editor.doc.subtitulos (la UI hace poll de /api/subtitulos/estado).

Sale con 1 si el quemado falló → la ejecución de SFN queda FAILED y el motivo
queda en el doc (cola del log de make_subs/ffmpeg).
"""
from __future__ import annotations

import json
import logging
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from worker.env_ssm import cargar_env_ssm

cargar_env_ssm()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("subtitulos_task")

ROOT = Path(__file__).resolve().parent.parent


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def main(user_id: str, nombre: str) -> int:
    import os
    t0 = time.monotonic()
    os.environ["DEFAULT_USER_ID"] = user_id
    from pipeline import costes_infra, db, media_sync
    from pipeline.storage import ruta_proyecto

    destino = ruta_proyecto(nombre)
    prefijo = f"videos/{nombre}/"
    log.info("%s: %d artefactos bajados de %s", nombre,
             media_sync.bajar_prefijo(prefijo, destino), prefijo)

    proc = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "make_subs.py"), str(destino),
         "--base", str(destino / "pelicula.mp4"), "--mode", "final"],
        cwd=str(ROOT), capture_output=True, text=True)
    cola = ((proc.stdout or "") + (proc.stderr or ""))[-600:]

    estado = {"fin": _ahora()}
    if proc.returncode == 0:
        salida = destino / "pelicula-subtitulado.mp4"
        media_sync.subir_archivo(salida, f"{prefijo}pelicula-subtitulado.mp4")
        for ext in ("srt", "ass"):
            f = destino / "work" / "subs" / f"subs.{ext}"
            if f.is_file():
                media_sync.subir_archivo(f, f"{prefijo}work/subs/subs.{ext}")
        cdn = os.getenv("CDN_BASE", "").rstrip("/")
        estado.update(estado="listo",
                      url=f"{cdn}/{prefijo}pelicula-subtitulado.mp4" if cdn else None)
        log.info("%s: subtítulos quemados → %s", nombre, estado["url"])
    else:
        estado.update(estado="error", log=cola)
        log.error("%s: quemado falló:\n%s", nombre, cola)

    db.fijar_subtitulos_editor(user_id, nombre, json.dumps(estado, ensure_ascii=False))
    # M6.1: la infra se gastó igual haya salido bien o mal
    costes_infra.registrar(user_id, nombre, "infra-subtitulos",
                           costes_infra.costo_fargate(time.monotonic() - t0))
    return 0 if proc.returncode == 0 else 1


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("uso: python -m worker.subtitulos_task <user_id> <nombre>")
    sys.exit(main(sys.argv[1], sys.argv[2]))
