"""M7 — render de un corte del editor en Fargate (la lanza la state machine).

    python -m worker.render_task <user_id> <nombre> <estilo>

Baja videos/<nombre>/ de S3 al FS efímero, pisa cuts.json con la ÚLTIMA versión
guardada en Postgres (la verdad del editor en nube), corre tools/render_cuts.py
en modo preview y sube el resultado + segments.json de vuelta a S3. El estado
viaja por proyectos_editor.doc.render (la UI hace poll de /api/render/status).

Sale con 1 si el render falló → la ejecución de SFN queda FAILED y el motivo
queda en el doc (cola del log de ffmpeg).

E2: el preview pasa la compuerta del repo antes de subirse (CLAUDE.md, «QA no es
opcional»): `ffprobe` de v:0 y a:0 y, si difieren más de `DRIFT_TOL_S` (0,15 s, la de
make_subs.py/insert_broll.py), el render queda en `error` y NO se sube como listo. No
cobra, así que no hay nada que devolver.
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
DRIFT_TOL_S = 0.15     # la misma tolerancia de tools/make_subs.py y tools/insert_broll.py


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _cuadran_av(salida: Path) -> tuple[bool, str]:
    """Gate `ffprobe` v:0 == a:0 sobre el preview recién renderizado: (cuadra, detalle).
    Un archivo sin audio o ilegible tampoco cuadra: el preview siempre lleva las dos pistas."""
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,duration",
             "-of", "json", str(salida)], capture_output=True, text=True, check=True, timeout=120)
        durs = {}
        for st in json.loads(r.stdout).get("streams") or []:
            durs.setdefault(st.get("codec_type"), float(st["duration"]))
        dv, da = durs["video"], durs["audio"]
    except Exception as err:  # noqa: BLE001 — cualquier cosa rara = no cuadra
        return False, f"no pude medir el video y el audio ({type(err).__name__})"
    if abs(dv - da) > DRIFT_TOL_S:
        return False, f"video {dv:.3f} s contra audio {da:.3f} s"
    return True, ""


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
    cuadra, desajuste = (True, "")
    if proc.returncode == 0:
        salida = destino / "output" / f"preview-{estilo}.mp4"
        cuadra, desajuste = _cuadran_av(salida)
    if proc.returncode == 0 and cuadra:
        media_sync.subir_archivo(salida, f"{prefijo}output/preview-{estilo}.mp4")
        segmentos = destino / "work" / "render" / f"{estilo}-preview" / "segments.json"
        if segmentos.is_file():
            media_sync.subir_archivo(
                segmentos, f"{prefijo}work/render/{estilo}-preview/segments.json")
        # metraje SUBIDO: el corte renderizado ES el master — derivar el
        # edited-transcript sobre su timeline (subtítulos/b-roll/publicar lo
        # consumen). Los gen-* conservan el del puente (timeline de pelicula.mp4).
        if not (destino / "pelicula.mp4").is_file():
            et = subprocess.run(
                [sys.executable, str(ROOT / "tools" / "edited_transcript.py"),
                 str(destino), "--style", estilo, "--mode", "preview"],
                cwd=str(ROOT), capture_output=True, text=True)
            if et.returncode == 0:
                media_sync.subir_archivo(destino / "work" / "edited-transcript.json",
                                         f"{prefijo}work/edited-transcript.json")
            else:
                log.warning("%s: edited-transcript no derivado:\n%s", nombre,
                            ((et.stdout or "") + (et.stderr or ""))[-400:])
        key = f"{prefijo}output/preview-{estilo}.mp4"
        # Solo la `key`. La URL se arma al entregar el documento
        # (media_sync.refrescar_urls): `videos/` ya no lo sirve el CDN y una
        # URL firmada guardada aquí caducaría dentro de Postgres.
        render.update(estado="listo", key=key, url=None)
        log.info("%s: render %s listo → %s", nombre, estilo, render["url"])
    elif proc.returncode == 0:
        # el render salió pero el video y el audio no cuadran: no se sube como listo
        render.update(estado="error",
                      log=f"El video y el audio no cuadran ({desajuste}). Vuelve a renderizar; "
                          "si se repite, avísanos.")
        log.error("%s: render %s descuadrado: %s", nombre, estilo, desajuste)
    else:
        render.update(estado="error", log=cola)
        log.error("%s: render %s falló:\n%s", nombre, estilo, cola)

    db.fijar_render_editor(user_id, nombre, json.dumps(render, ensure_ascii=False))
    # M6.1: la infra se gastó igual haya salido bien o mal
    costes_infra.registrar(user_id, nombre, "infra-render",
                           costes_infra.costo_fargate(time.monotonic() - t0))
    return 0 if proc.returncode == 0 and cuadra else 1


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("uso: python -m worker.render_task <user_id> <nombre> <estilo>")
    sys.exit(main(sys.argv[1], sys.argv[2], sys.argv[3]))
