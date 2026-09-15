"""Orquestador: historia → película. Un trace de Langfuse por película, un span por cadena y por escena."""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from pathlib import Path
from typing import Callable

from langfuse import get_client, observe, propagate_attributes

from . import db, duracion, ffmpeg, media
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


def _guardar_estado(workdir: Path, etapa: str, escenas: list[Scene], **extra) -> None:
    (workdir / "estado.json").write_text(
        json.dumps({"etapa": etapa, "escenas": [e.model_dump(mode="json") for e in escenas], **extra},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def cargar_estado(workdir: Path) -> dict:
    """M22 · G — la pausa de aprobación parte la producción en dos tareas de
    Fargate distintas: la segunda no hereda nada en memoria y reconstruye las
    escenas (y el casting) desde aquí.

    Las rutas se vuelven a apuntar al workdir de QUIEN lee: el archivo lo
    escribió otra máquina (Fargate) y lo puede leer la API (Lambda, /tmp). Las
    de dentro son absolutas, así que sin esto apuntarían a un disco ajeno.
    """
    d = json.loads((workdir / "estado.json").read_text(encoding="utf-8"))
    escenas = [asignar_rutas(Scene(**e).model_copy(update={"audio_path": None}), workdir)
               for e in d.get("escenas", [])]
    return {"etapa": d.get("etapa"), "escenas": escenas,
            "casting": Casting(**d["casting"]) if d.get("casting") else None}


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
    # M22 · G: si la imagen ya la decidió el usuario, no se vuelve a generar —
    # solo se repone su URL, que pudo caducar entre aprobar y animar.
    if e.imagen_fija:
        e = await media.reponer_imagen_fija(e)
    else:
        e = await media.imagen_inicio(e, ctx, estilo_url, prev_frame, estilo)
    e = await media.video_escena(e, prev_frame)
    e = await media.mux_escena(e)
    log.info("Escena %s lista: %s (qc=%s) / %s / %.2fs", e.id, e.start_image_origen, e.qc, e.video_origen, e.duracion_final)
    return e


async def generar_pelicula(historia: str, subir: bool = True, run_id: str | None = None) -> Resultado:
    run_id = run_id or uuid.uuid4().hex[:8]
    with propagate_attributes(session_id=run_id, user_id=db.usuario_actual(),
                              tags=["video-pipeline"], trace_name="pelicula"):
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


async def preparar_cola(escenas: list[Scene], workdir: Path, duracion_objetivo_s: int | None = None,
                        progreso: Progreso | None = None) -> list[Scene]:
    """TTS (paralelo) + gate de duración (A3.3: corregir ANTES de gastar en
    Veo) + orden + rutas. El tramo que comparten la producción de una pasada y
    la de dos (M22 · G)."""
    if progreso:
        progreso("tts", {})
    escenas = await tts_todas(escenas, workdir)
    if duracion_objetivo_s:
        escenas = await duracion.aplicar_gate(escenas, duracion_objetivo_s, workdir)
    return [asignar_rutas(e, workdir) for e in ordenar_cola(escenas)]


async def _imagen_de_cabeza(e: Scene, ctx: Casting, estilo_url: str | None,
                            estilo: Estilo | None, progreso: Progreso | None) -> Scene:
    e = await media.imagen_inicio(e, ctx, estilo_url, None, estilo)
    # al disco: es lo que el usuario mira, lo que sube a S3 y lo que la fase de
    # animar vuelve a subir a fal si la URL de la generación ya caducó
    await ffmpeg.descargar_imagen(e.start_image_url, e.start_image_path)
    if progreso:
        progreso("imagenes", {"imagen_lista": e.id})
    return e.model_copy(update={"imagen_fija": True})


async def fase_imagenes(
    escenas: list[Scene], ctx: Casting, estilo_url: str | None, workdir: Path,
    estilo: Estilo | None = None, progreso: Progreso | None = None,
    duracion_objetivo_s: int | None = None, ya_preparadas: bool = False,
) -> list[Scene]:
    """M22 · G, primera mitad: hasta la imagen de cada cadena, y ahí para.

    Solo se generan las CABEZAS de cadena porque son las únicas con imagen
    propia: una escena "continua" arranca del último frame del clip anterior,
    que no existe hasta animar. Es además el sitio donde una cadena entera se
    decide — su cabeza fija el look de todos sus planos.

    La imagen cuesta $0.02 dólares y animarla ocho segundos $0.24: enseñarla
    antes es doce veces más barato que rehacer la escena después.

    `ya_preparadas` es para el pipeline de narración, que hace su TTS de una
    sola pieza mucho antes de llegar aquí.
    """
    # las rutas se re-asignan siempre (asignar_rutas es idempotente): sin
    # start_image_path no hay dónde dejar la imagen que el usuario va a mirar
    escenas = (await preparar_cola(escenas, workdir, duracion_objetivo_s, progreso)
               if not ya_preparadas else [asignar_rutas(e, workdir) for e in escenas])
    cadenas = partir_en_cadenas(escenas)
    if progreso:
        progreso("imagenes", {"imagenes_total": len(cadenas)})
    cabezas = await asyncio.gather(*(
        _imagen_de_cabeza(c[0], ctx, estilo_url, estilo, progreso) for c in cadenas))
    hechas = {e.id: e for e in cabezas}
    escenas = [hechas.get(e.id, e) for e in escenas]
    # el casting viaja con las escenas: la fase de animar corre en OTRA tarea de
    # Fargate y no hereda nada en memoria — sin esto habría que pagar otro
    # casting, que además podría salir distinto
    _guardar_estado(workdir, "imagenes", escenas, casting=ctx.model_dump(mode="json"))
    log.info("%d imágenes listas para aprobar (%d escenas)", len(cabezas), len(escenas))
    return escenas


def resumen_imagenes(escenas: list[Scene]) -> list[dict]:
    """Lo que la pantalla de aprobación necesita de cada imagen (M22 · G).

    Viaja en el doc del proyecto, que es lo que el front ya trae con su
    polling: así la pantalla no necesita una petición aparte ni leer
    estado.json, que en la nube lo escribió otra máquina.

    `planos` es cuántas escenas cuelgan de esa cabeza de cadena: decir «esta
    imagen manda en 3 planos» es lo que explica por qué rechazarla importa.
    """
    out: list[dict] = []
    for e in escenas:
        if e.imagen_fija:
            out.append({"id": e.id, "narracion": e.narracion, "prompt": e.prompt_imagen,
                        "archivo": Path(e.start_image_path).name if e.start_image_path else None,
                        "planos": 1})
        elif out:
            out[-1]["planos"] += 1
    return out


async def producir_desde_escenas(
    escenas: list[Scene], ctx: Casting, estilo_url: str | None, workdir: Path, subir: bool,
    estilo: Estilo | None = None, progreso: Progreso | None = None,
    duracion_objetivo_s: int | None = None, ya_preparadas: bool = False,
) -> Resultado:
    """TTS → gate de duración → imagen/video/mux por cadenas → concat → Drive.
    Compartido por el CLI y por el servidor.

    `ya_preparadas` es la entrada de la segunda mitad de M22 · G: las escenas
    vienen de estado.json con su TTS hecho y su imagen aprobada, así que el
    tramo de preparación no se repite (repetirlo volvería a cobrar el TTS)."""
    lf = get_client()
    # 3. TTS (paralelo) + gate de duración + orden + cadenas
    if not ya_preparadas:
        escenas = await preparar_cola(escenas, workdir, duracion_objetivo_s, progreso)
    cadenas = partir_en_cadenas(escenas)
    # el casting va también aquí: así un reintento de «animar» tras un fallo
    # encuentra en estado.json todo lo que necesita y no paga otro casting
    _guardar_estado(workdir, "tts", escenas, casting=ctx.model_dump(mode="json"))
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
