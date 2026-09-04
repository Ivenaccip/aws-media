"""M7 — render de un corte del editor en Fargate (la lanza la state machine).

    python -m worker.render_task <user_id> <nombre> <estilo>

Baja videos/<nombre>/ de S3 al FS efímero, pisa cuts.json con la ÚLTIMA versión
guardada en Postgres (la verdad del editor en nube), corre tools/render_cuts.py
en modo preview y sube el resultado + segments.json de vuelta a S3. El estado
viaja por proyectos_editor.doc.render (la UI hace poll de /api/render/status).

Sale con 1 si el render falló → la ejecución de SFN queda FAILED y el motivo
queda en el doc (cola del log de ffmpeg).
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
log = logging.getLogger("render_task")

ROOT = Path(__file__).resolve().parent.parent


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def main(user_id: str, nombre: str, estilo: str) -> int:
    import os
    t0 = time.monotonic()
    os.environ["DEFAULT_USER_ID"] = user_id
    from pipeline import costes_infra, db, media_sync
    from pipeline.storage import ruta_proyecto

    destino = ruta_proyecto(nombre)
    prefijo = f"videos/{nombre}/"
    log.info("%s: %d artefactos bajados de %s", nombre,
             media_sync.bajar_prefijo(prefijo, destino), prefijo)

    # la última versión guardada en el editor manda sobre el cuts.json de S3
    ultima = db.cortes_ultima(user_id, nombre)
    cuts_path = destino / "work" / "analysis" / "cuts.json"
    if ultima:
        cuts_path.parent.mkdir(parents=True, exist_ok=True)
        cuts_path.write_text(json.dumps(ultima["doc"], indent=2, ensure_ascii=False),
                             encoding="utf-8")
        log.info("%s: cuts.json v%d desde Postgres", nombre, ultima["version"])

    proc = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "render_cuts.py"), str(destino),
         "--style", estilo, "--mode", "preview"],
        cwd=str(ROOT), capture_output=True, text=True)
    cola = ((proc.stdout or "") + (proc.stderr or ""))[-600:]

    render = {"estilo": estilo, "fin": _ahora()}
    if proc.returncode == 0:
        salida = destino / "output" / f"preview-{estilo}.mp4"
        media_sync.subir_archivo(salida, f"{prefijo}output/preview-{estilo}.mp4")
        segmentos = destino / "work" / "render" / f"{estilo}-preview" / "segments.json"
        if segmentos.is_file():
            media_sync.subir_archivo(
                segmentos, f"{prefijo}work/render/{estilo}-preview/segments.json")
        cdn = os.getenv("CDN_BASE", "").rstrip("/")
        render.update(estado="listo",
                      url=f"{cdn}/{prefijo}output/preview-{estilo}.mp4" if cdn else None)
        log.info("%s: render %s listo → %s", nombre, estilo, render["url"])
    else:
        render.update(estado="error", log=cola)
        log.error("%s: render %s falló:\n%s", nombre, estilo, cola)

    db.fijar_render_editor(user_id, nombre, json.dumps(render, ensure_ascii=False))
    # M6.1: la infra se gastó igual haya salido bien o mal
    costes_infra.registrar(user_id, nombre, "infra-render",
                           costes_infra.costo_fargate(time.monotonic() - t0))
    return 0 if proc.returncode == 0 else 1


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("uso: python -m worker.render_task <user_id> <nombre> <estilo>")
    sys.exit(main(sys.argv[1], sys.argv[2], sys.argv[3]))
