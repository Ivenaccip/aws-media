"""Orquestador: historia → película. Un trace de Langfuse por película, un span por cadena y por escena."""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from pathlib import Path
from typing import Callable

from langfuse import get_client, observe, propagate_attributes

from . import duracion, ffmpeg, media
from .casting import hacer_casting, mensaje_faltantes
from .config import settings
from .deliver import mensaje_final, subir_drive
from .director import dirigir
from .library import leer_biblioteca
from .models import Casting, Resultado, Scene
from .scenes import asignar_rutas, ordenar_cola, partir_en_cadenas
from .styles import Estilo
from .tts import tts_todas

Progreso = Callable[[str, dict], None]  # (etapa, datos)

log = logging.getLogger("pipeline")


class FaltaProtagonista(Exception):
    pass


def _guardar_estado(workdir: Path, etapa: str, escenas: list[Scene]) -> None:
    (workdir / "estado.json").write_text(
        json.dumps({"etapa": etapa, "escenas": [e.model_dump(mode="json") for e in escenas]}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


@observe(name="cadena")
async def _procesar_cadena(cadena: list[Scene], ctx: Casting, estilo_url: str | None,
                           estilo: Estilo | None = None, progreso: Progreso | None = None) -> list[Scene]:
    """Secuencial dentro de la cadena: cada 'continua' arranca del último frame del clip anterior."""
    get_client().update_current_span(metadata={"escenas": [e.id for e in cadena]})
    hechas: list[Scene] = []
    prev_frame: Path | None = None
    for e in cadena:
        e = await _procesar_escena(e, ctx, estilo_url, prev_frame, estilo)
        hechas.append(e)
        prev_frame = e.last_frame_path
        if progreso:
            progreso("media", {"escena_lista": e.id})
    return hechas


@observe(name="escena")
async def _procesar_escena(e: Scene, ctx: Casting, estilo_url: str | None, prev_frame: Path | None,
                           estilo: Estilo | None = None) -> Scene:
    get_client().update_current_span(metadata={"id": e.id, "transicion": e.transicion})
    e = await media.imagen_inicio(e, ctx, estilo_url, prev_frame, estilo)
    e = await media.video_escena(e, prev_frame)
    e = await media.mux_escena(e)
    log.info("Escena %s lista: %s (qc=%s) / %s / %.2fs", e.id, e.start_image_origen, e.qc, e.video_origen, e.duracion_final)
    return e


async def generar_pelicula(historia: str, subir: bool = True, run_id: str | None = None) -> Resultado:
    run_id = run_id or uuid.uuid4().hex[:8]
    with propagate_attributes(session_id=run_id, tags=["video-pipeline"], trace_name="pelicula"):
        return await _generar_pelicula(historia, subir, run_id)


@observe(name="pelicula", capture_output=False)
async def _generar_pelicula(historia: str, subir: bool, run_id: str) -> Resultado:
    workdir = settings.work_dir / run_id
    workdir.mkdir(parents=True, exist_ok=True)
    ffmpeg.comprobar_ffmpeg()
    lf = get_client()
    lf.update_current_span(input={"historia": historia, "run_id": run_id})
    log.info("run_id=%s workdir=%s", run_id, workdir)

    # 1. Biblioteca + casting
    bib = await asyncio.to_thread(leer_biblioteca)
    ctx = await hacer_casting(historia, bib)
    if ctx.faltantes:
        msg = mensaje_faltantes(ctx)
        lf.update_current_span(output={"error": "falta_protagonista", "faltantes": ctx.faltantes})
        raise FaltaProtagonista(msg)

    # 2. Director
    escenas = await dirigir(historia, ctx)
    _guardar_estado(workdir, "director", escenas)
    return await producir_desde_escenas(escenas, ctx, bib.estilo_url, workdir, subir)


async def producir_desde_escenas(
    escenas: list[Scene], ctx: Casting, estilo_url: str | None, workdir: Path, subir: bool,
    estilo: Estilo | None = None, progreso: Progreso | None = None,
    duracion_objetivo_s: int | None = None,
) -> Resultado:
    """TTS → gate de duración → imagen/video/mux por cadenas → concat → Drive.
    Compartido por el CLI y por el servidor."""
    lf = get_client()
    if progreso:
        progreso("tts", {})
    # 3. TTS (paralelo) + gate de duración (A3.3: corregir ANTES de gastar en Veo) + orden + cadenas
    escenas = await tts_todas(escenas, workdir)
    if duracion_objetivo_s:
        escenas = await duracion.aplicar_gate(escenas, duracion_objetivo_s, workdir)
    escenas = [asignar_rutas(e, workdir) for e in ordenar_cola(escenas)]
    cadenas = partir_en_cadenas(escenas)
    _guardar_estado(workdir, "tts", escenas)
    log.info("%d escenas en %d cadenas: %s", len(escenas), len(cadenas), [[e.id for e in c] for c in cadenas])
    if progreso:
        progreso("media", {"escenas_total": len(escenas)})

    # 4. Imagen + video + mux, cadenas en paralelo
    lotes = await asyncio.gather(*(_procesar_cadena(c, ctx, estilo_url, estilo, progreso) for c in cadenas))
    escenas = sorted((e for lote in lotes for e in lote), key=lambda s: s.orden)
    _guardar_estado(workdir, "mux", escenas)

    # 5. Concat + entrega
    if progreso:
        progreso("concat", {})
    pelicula = workdir / "pelicula.mp4"
    dur = await ffmpeg.concat([e.final_path for e in escenas], pelicula)

    drive_id = link = None
    nombre = pelicula.name
    if subir:
        if progreso:
            progreso("drive", {})
        try:
            drive_id, nombre, link = await asyncio.to_thread(subir_drive, pelicula)
        except Exception as err:  # noqa: BLE001 — la película ya existe en disco; no perder la corrida
            log.error("Subida a Drive falló (la película está en %s): %s", pelicula, str(err)[:300])
            lf.update_current_span(level="WARNING", status_message=f"drive: {str(err)[:200]}")

    msg = mensaje_final(nombre, link or str(pelicula), dur, escenas)
    lf.update_current_span(output={
        "mensaje": msg, "duracion": dur, "objetivo_s": duracion_objetivo_s, "n_escenas": len(escenas),
        "n_fallback": sum(1 for e in escenas if e.es_fallback), "drive_id": drive_id,
    })
    return Resultado(pelicula_path=pelicula, drive_id=drive_id, link=link, duracion_pelicula=dur, escenas=escenas, mensaje=msg)


async def main(historia: str, subir: bool) -> int:
    try:
        r = await generar_pelicula(historia, subir=subir)
        print(r.mensaje)
        return 0
    except FaltaProtagonista as e:
        print(e)
        return 2
    finally:
        get_client().flush()
