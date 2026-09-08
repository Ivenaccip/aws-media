"""M16.3 — regeneración/activación de una versión de la pista 2 en Fargate.

    python -m worker.overlay_task <user_id> <nombre>

Los parámetros del job viajan por proyectos_editor.doc.overlay_job:
  {"accion": "generar", "overlay": oid, "imagen": "overlays/…/cand.jpg",
   "prompt": "...", "creditos": n, ...}   → Veo + versión nueva + rearmado
  {"accion": "activar", "overlay": oid, "n": 2, ...}  → activar + rearmado

Baja videos/<nombre>/ de S3, opera sobre overlays.py (pista única o por escena),
rearma la película (con proxy/waveform) y sube el proyecto de vuelta. En fallo
DEVUELVE los créditos cobrados al lanzar y deja el motivo en el doc.
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from worker.env_ssm import cargar_env_ssm

cargar_env_ssm()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("overlay_task")

ROOT = Path(__file__).resolve().parent.parent


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _generar(destino: Path, job: dict) -> dict:
    """Veo anima la imagen elegida → versión nueva activa. La variante pista
    única (narración) va sin audio propio; la de escenas muxea su audio.mp3."""
    from langfuse import get_client, propagate_attributes

    from pipeline import media_fal, overlays
    from pipeline.pricing import estimar_regeneracion

    oid = job["overlay"]
    data = overlays.cargar(destino)
    ov = overlays.obtener(data, oid)
    dur = overlays.duracion_clip(ov)
    est = estimar_regeneracion(dur, n_imagenes=0, backend="fal")
    imagen = (destino / "work" / job["imagen"]).resolve()
    if (destino / "work").resolve() not in imagen.parents or not imagen.is_file():
        raise RuntimeError(f"imagen no válida: {job['imagen']}")
    prompt = (job.get("prompt") or ov.get("prompt_movimiento") or ov["narracion"]).strip()

    crudo = overlays.dir_overlay(destino, oid) / "veo_crudo.mp4"
    with propagate_attributes(session_id=f"editor-{destino.name}", tags=["fusion", "g2", "nube"]):
        asyncio.run(media_fal.video_veo(imagen, prompt, est["veo_segundos"], crudo,
                                        negativo=ov.get("veo_negativo", ""),
                                        meta={"overlay": oid}))
    get_client().flush()
    mux = crudo.with_suffix(".mux.mp4")
    if data.get("pista_unica"):
        overlays.recorte_reemplazo(crudo, mux, dur)
    else:
        overlays.mux_reemplazo(crudo, overlays.dir_overlay(destino, oid) / "audio.mp3", mux, dur)
    crudo.unlink()
    version = overlays.agregar_version(destino, oid, mux, imagen, est["video"])
    overlays.registrar_gasto(destino, "video", oid, est["video"])
    return version


def main(user_id: str, nombre: str) -> int:
    import os
    t0 = time.monotonic()
    os.environ["DEFAULT_USER_ID"] = user_id
    from pipeline import costes_infra, creditos, db, media_sync, overlays
    from pipeline.storage import ruta_proyecto

    doc = db.cargar_proyecto_editor(user_id, nombre) or {}
    job = doc.get("overlay_job") or {}
    if job.get("estado") != "corriendo":
        log.error("%s: overlay_job no está corriendo (%s)", nombre, job.get("estado"))
        return 1

    destino = ruta_proyecto(nombre)
    prefijo = f"videos/{nombre}/"
    log.info("%s: %d artefactos bajados de %s", nombre,
             media_sync.bajar_prefijo(prefijo, destino), prefijo)

    try:
        version = None
        if job.get("accion") == "activar":
            overlays.activar_version(destino, job["overlay"], int(job["n"]))
        else:
            version = _generar(destino, job)
        dur_total = overlays.rearmar_pelicula(destino)
        subidos = media_sync.subir_dir(destino, prefijo)
        log.info("%s: película rearmada (%.1f s), %d artefactos subidos",
                 nombre, dur_total, subidos)
        job.update(estado="listo", fin=_ahora(), duracion_pelicula=round(dur_total, 2))
        if version:
            job["version"] = version["n"]
    except Exception as err:  # noqa: BLE001 — cobrado al lanzar: devolver
        log.exception("%s: overlay_job falló", nombre)
        if creditos.activo() and job.get("creditos"):
            creditos.devolver(int(job["creditos"]), f"overlay:{nombre}", user_id)
        job.update(estado="error", fin=_ahora(), log=str(err)[:400])

    db.fijar_overlay_job_editor(user_id, nombre, json.dumps(job, ensure_ascii=False))
    # M6.1: la infra se gastó igual haya salido bien o mal
    costes_infra.registrar(user_id, nombre, "infra-overlay",
                           costes_infra.costo_fargate(time.monotonic() - t0))
    return 0 if job.get("estado") == "listo" else 1


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("uso: python -m worker.overlay_task <user_id> <nombre>")
    sys.exit(main(sys.argv[1], sys.argv[2]))
