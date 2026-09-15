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
import sys

from worker.env_ssm import cargar_env_ssm, cargar_env_usuario

cargar_env_ssm()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("producir_task")


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
        cdn = os.getenv("CDN_BASE", "").rstrip("/")
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
                "cdn": f"{cdn}/videos/{nombre}/pelicula.mp4",
            }] if (editor_dir / "pelicula.mp4").is_file() else [],
        }
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
        # C5: fallo nuestro = créditos de vuelta (el cobro fue por duración
        # objetivo en el API; se recalcula con la misma tarifa)
        n = creditos.costo_producir(p.duracion_s)
        creditos.devolver(n, f"producir:{proyecto_id}", user_id)
        log.info("%s: %d créditos devueltos por producción fallida", proyecto_id, n)
    return 0 if p.estado == "listo" else 1


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        sys.exit("uso: python -m worker.producir_task <user_id> <proyecto_id> [todo|imagenes|animar]")
    sys.exit(main(*sys.argv[1:4]))
