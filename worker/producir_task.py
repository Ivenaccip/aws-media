"""C4 — tarea de producción en Fargate (la lanza la state machine de SFN).

    python -m worker.producir_task <user_id> <proyecto_id> [todo|imagenes|animar]

Corre flow.producir() completo (casting → director → TTS → gate → media → mux →
puente al editor) sobre el FS efímero de la tarea, con el estado en Postgres.

La fase (M22 · G) parte esa pasada en dos cuando el usuario pidió aprobar las
imágenes: "imagenes" llega hasta la imagen de cada cadena y termina sin
película (código 0, proyecto en `imagenes`); "animar" la retoma desde
estado.json. Sin argumento es "todo", el modo automático de siempre.
Al final sube los artefactos a S3 (work/<user>/<id>/ y videos/gen-*/) y registra
el proyecto del editor en proyectos_editor para que aparezca en e1.

Sale con código 1 si la producción terminó en error → la ejecución de SFN
queda FAILED y se ve en la consola; el detalle ya está en Postgres (p.error).
"""
from __future__ import annotations

import asyncio
import json
import logging
import subprocess
import sys

from worker.env_ssm import cargar_env_ssm, cargar_env_usuario

cargar_env_ssm()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("producir_task")


def _meta_pelicula(pelicula, key: str) -> dict | None:
    """E2 (CONTRATO §4.4): la medición de la película, para que `/api/edicion/elegibles` y
    `cotizar` no tengan que medirla con `ffprobe` sobre una URL (1–8 s por video, y la
    Lambda corta a 29 s). La película ya está en el disco de esta tarea, así que medirla
    aquí es gratis. Vale solo mientras `key` y `bytes` coincidan con la subida del doc.
    Cualquier fallo = sin `meta` (el API la mide perezosamente): NUNCA tumba la producción."""
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries",
             "format=duration:stream=codec_type,width,height:stream_side_data=rotation",
             "-of", "json", str(pelicula)], capture_output=True, text=True, check=True, timeout=60)
        j = json.loads(r.stdout)
        ss = j.get("streams") or []
        v = next(s for s in ss if s.get("codec_type") == "video")
        gira = abs(int((v.get("side_data_list") or [{}])[0].get("rotation", 0))) % 180 == 90
        ancho, alto = (v["height"], v["width"]) if gira else (v["width"], v["height"])
        dur = float(j["format"]["duration"])
        if not dur > 0:
            return None
        from datetime import datetime, timezone
        return {"key": key, "bytes": pelicula.stat().st_size, "duracion_s": round(dur, 3),
                "ancho": int(ancho), "alto": int(alto),
                "audio": any(s.get("codec_type") == "audio" for s in ss),
                "medido": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    except Exception:  # noqa: BLE001 — opcional: si no se pudo medir, se mide después
        log.warning("%s: no se pudo medir la película para el caché", key, exc_info=True)
        return None


def main(user_id: str, proyecto_id: str, fase: str = "todo") -> int:
    import os
    import time
    t0 = time.monotonic()
    os.environ["DEFAULT_USER_ID"] = user_id
    cargar_env_usuario(user_id)   # C5: claves por-usuario pisan a las de plataforma
    from pipeline import costes_infra, creditos, db, flow, media_sync
    from pipeline.project import cargar_proyecto
    from pipeline.storage import videos_root

    p = cargar_proyecto(proyecto_id)
    if p is None:
        log.error("proyecto %s no existe para %s", proyecto_id, user_id)
        return 1
    prefijo = media_sync.prefijo_work(user_id, proyecto_id)
    log.info("%s: %d artefactos bajados", proyecto_id, media_sync.bajar_prefijo(prefijo, p.workdir))

    asyncio.run(flow.producir(p, fase))

    log.info("%s: %d artefactos subidos a %s", proyecto_id,
             media_sync.subir_dir(p.workdir, prefijo), prefijo)

    # M22 · G: la fase de imágenes termina BIEN sin película. Los artefactos
    # (las imágenes y estado.json) ya subieron arriba — que es justo lo que la
    # pantalla de aprobación y la fase de animar necesitan. Si en cambio FALLÓ,
    # se sigue de largo hasta la devolución de créditos de abajo.
    if p.estado == "imagenes":
        costes_infra.registrar(user_id, proyecto_id, "infra-producir",
                               costes_infra.costo_fargate(time.monotonic() - t0))
        log.info("%s: imágenes listas, esperando al usuario", proyecto_id)
        return 0

    nombre = p.progreso.get("editor")          # puente F1.3: videos/gen-<id>
    if nombre:
        editor_dir = videos_root() / nombre
        subidos = media_sync.subir_dir(editor_dir, f"videos/{nombre}/")
        log.info("%s: puente %s con %d artefactos en S3", proyecto_id, nombre, subidos)
        doc = {
            "origen": {"generador": proyecto_id, "user_id": user_id},
            "flags": {
                "generado": (editor_dir / "pelicula.mp4").is_file(),
                "canonico": any((editor_dir / "work" / "transcripts").glob("*.canonical.json")),
                "cuts": (editor_dir / "work" / "analysis" / "cuts.json").is_file(),
            },
            "subidas": [{
                "key": f"videos/{nombre}/pelicula.mp4", "archivo": "pelicula.mp4",
                "bytes": (editor_dir / "pelicula.mp4").stat().st_size
                if (editor_dir / "pelicula.mp4").is_file() else 0,
                # sin `cdn`: `videos/` ya no lo sirve el CDN y la URL firmada
                # caducaría guardada. La arma refrescar_urls al entregar.
            }] if (editor_dir / "pelicula.mp4").is_file() else [],
        }
        if doc["subidas"]:
            meta = _meta_pelicula(editor_dir / "pelicula.mp4", doc["subidas"][0]["key"])
            if meta:
                doc["meta"] = meta
        db.guardar_proyecto_editor(user_id, nombre, json.dumps(doc, ensure_ascii=False))

    log.info("%s: estado final %s", proyecto_id, p.estado)
    # M6.1: línea estimada de infra — el gasto de Fargate ocurrió igual haya
    # terminado bien o mal (los créditos sí se devuelven; la infra es nuestra)
    costes_infra.registrar(user_id, proyecto_id, "infra-producir",
                           costes_infra.costo_fargate(time.monotonic() - t0))
    # M22 · G: la condición era `!= "listo"`, que con la pausa de aprobación
    # habría devuelto la producción entera cada vez que un proyecto se para a
    # enseñar imágenes. Lo que se devuelve es el FALLO, y eso es "error".
    if p.estado == "error" and creditos.activo():
        # C5: fallo nuestro = créditos de vuelta. M23 · V: lo que se cobró
        # en el API, no la tabla de precios que traiga esta imagen
        n = creditos.producir_cobrado(p)
        creditos.devolver(n, f"producir:{proyecto_id}", user_id)
        log.info("%s: %d créditos devueltos por producción fallida", proyecto_id, n)
    return 0 if p.estado == "listo" else 1


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        sys.exit("uso: python -m worker.producir_task <user_id> <proyecto_id> [todo|imagenes|animar]")
    sys.exit(main(*sys.argv[1:4]))
