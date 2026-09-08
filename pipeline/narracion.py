"""M11 — narración primero: la imagen se corta SOBRE la voz, como en un
documental real.

Flujo (pipeline == "narracion", detrás del flag por proyecto):

  TTS ÚNICO de la narración completa (mejor prosodia, duración REAL medida —
  el gate A3 de palabras/segundo se vuelve innecesario) → alineado por palabra
  con faster-whisper (la misma pieza del puente) → VENTANAS de 4/6/8 s que
  cubren la duración total → el director escribe el plano de cada ventana
  leyendo las palabras que suenan en ella (los cortes NO caen en fin de
  oración) → imagen/video por cadenas (misma maquinaria de media.py) →
  ensamblaje PISTA ÚNICA: clips recortados al largo exacto de su ventana,
  concatenados, con la narración continua encima.
"""
from __future__ import annotations

import asyncio
import logging
import math
from pathlib import Path

from langfuse import get_client, observe

from . import fal, ffmpeg, media
from .config import load_prompt, settings
from .director import _elenco
from .llm import chat_json
from .models import Casting, Resultado, Scene
from .scenes import asignar_rutas, ordenar_cola, partir_en_cadenas
from .styles import Estilo
from .tts import OPCIONES
from .voices import STABILITY_DEFAULT, VOZ_DEFAULT

log = logging.getLogger("narracion")

VENTANA_MAX_S = 8.0
MARGEN_CLIP_S = 0.5   # el clip de Veo debe durar un pelo más que su ventana


def planear_ventanas(dur_total: float) -> list[dict]:
    """Ventanas contiguas que cubren [0, dur_total]: n = ceil(dur/8) (mínimo 2),
    todas del mismo largo, y el clip de video se pide en el slot de Veo (4/6/8)
    más chico que cubra el largo + margen."""
    n = max(2, math.ceil(dur_total / VENTANA_MAX_S))
    largo = dur_total / n
    dv = next((d for d in OPCIONES if d >= largo + MARGEN_CLIP_S), OPCIONES[-1])
    return [{"i": i, "t0": round(i * largo, 3),
             "t1": round(dur_total if i == n - 1 else (i + 1) * largo, 3),
             "video_s": dv} for i in range(n)]


def texto_por_ventana(palabras: list[dict], ventanas: list[dict]) -> list[str]:
    """Cada palabra cae en la ventana donde está su punto medio."""
    textos = [[] for _ in ventanas]
    for w in palabras:
        medio = (float(w["start"]) + float(w["end"])) / 2
        for i, v in enumerate(ventanas):
            if v["t0"] <= medio < v["t1"] or (i == len(ventanas) - 1 and medio >= v["t0"]):
                textos[i].append(w["text"])
                break
    return [" ".join(t) for t in textos]


@observe(name="tts_narracion")
async def tts_narracion(texto: str, voz: str | None, workdir: Path) -> tuple[Path, float]:
    """UNA llamada de TTS con la narración completa → prosodia continua y
    duración real medida."""
    res = await fal.llamar(
        settings.fal_tts,
        {"text": texto, "voice": voz or VOZ_DEFAULT, "stability": STABILITY_DEFAULT,
         "similarity_boost": 0.75, "language_code": "es"},
        timeout_s=300, nombre="tts", meta={"narracion": True})
    url = (res.get("audio") or {}).get("url")
    if not url:
        raise fal.FalError(f"TTS sin audio para la narración: {res}")
    path = workdir / "narracion.mp3"
    await fal.descargar(url, path)
    dur = await ffmpeg.duracion(path)
    return path, round(dur, 2)


def alinear_palabras(audio: Path) -> list[dict]:
    """faster-whisper sobre el TTS (la pieza que ya usa el puente para medir la
    tasa de habla): palabras con tiempos en segundos."""
    import os
    from faster_whisper import WhisperModel
    modelo = WhisperModel(os.getenv("ALINEADOR_MODEL", "small"), device="cpu",
                          compute_type="int8")
    segments, _ = modelo.transcribe(str(audio), language="es", word_timestamps=True)
    return [{"text": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)}
            for seg in segments for w in (seg.words or [])]


@observe(name="director_ventanas")
async def dirigir_ventanas(narracion: str, ventanas: list[dict], textos: list[str],
                           ctx: Casting) -> list[Scene]:
    lineas = [f'{v["i"] + 1}. [{v["t0"]:.1f}–{v["t1"]:.1f} s] "{t}"'
              for v, t in zip(ventanas, textos)]
    user = load_prompt("director_ventanas_user").format(
        narracion=narracion, mundo=ctx.mundo, elenco=_elenco(ctx),
        ventanas="\n".join(lineas))
    r = await chat_json("director_ventanas", load_prompt("director_ventanas_system"), user)
    crudas = r.get("escenas") if isinstance(r.get("escenas"), list) else []
    nombres = {c.nombre for c in ctx.casting}
    out = []
    for i, v in enumerate(ventanas):
        e = crudas[i] if i < len(crudas) and isinstance(crudas[i], dict) \
            else (crudas[-1] if crudas and isinstance(crudas[-1], dict) else {})
        pers = e.get("personajes") if isinstance(e.get("personajes"), list) else []
        out.append(Scene(
            id=str(i + 1),
            transicion="corte" if i == 0 else
                       ("continua" if e.get("transicion") == "continua" else "corte"),
            narracion=textos[i],
            personajes=[p for p in pers if p in nombres][:2],
            prompt_visual=str(e.get("prompt_visual") or ""),
            prompt_movimiento=str(e.get("prompt_movimiento") or ""),
            duracion_video=v["video_s"],
            duracion_real=round(v["t1"] - v["t0"], 3),
        ))
    return out


@observe(name="cadena_ventanas")
async def _procesar_cadena(cadena: list[Scene], ctx: Casting, estilo_url: str | None,
                           estilo: Estilo | None, ventanas: list[dict], progreso) -> list[Scene]:
    """Como run._procesar_cadena, pero SIN mux por escena: el clip se recorta
    al largo exacto de su ventana (video-only) y de ahí sale el frame de
    continuidad — el audio es una sola pista aparte."""
    get_client().update_current_span(metadata={"escenas": [e.id for e in cadena]})
    hechas: list[Scene] = []
    prev_frame: Path | None = None
    for e in cadena:
        e = await media.imagen_inicio(e, ctx, estilo_url, prev_frame, estilo)
        e = await media.video_escena(e, prev_frame)
        largo = ventanas[int(e.id) - 1]["t1"] - ventanas[int(e.id) - 1]["t0"]
        await ffmpeg.recortar_video(e.video_path, e.final_path, largo)
        await ffmpeg.ultimo_frame(e.final_path, e.last_frame_path)
        e = e.model_copy(update={"duracion_final": round(largo, 3)})
        hechas.append(e)
        prev_frame = e.last_frame_path
        if progreso:
            progreso("media", {"escena_lista": e.id})
    return hechas


@observe(name="pelicula_narracion", capture_output=False)
async def producir_pelicula(p, ctx: Casting, estilo: Estilo | None, progreso) -> Resultado:
    """La fase 4 del pipeline narración-primero. `p` es el Proyecto (con
    narracion y voz elegidas); el casting ya viene resuelto por flow."""
    from .deliver import mensaje_final, subir_drive

    workdir = p.workdir
    workdir.mkdir(parents=True, exist_ok=True)
    lf = get_client()

    if progreso:
        progreso("tts", {})
    audio, dur = await tts_narracion(p.narracion, p.voz, workdir)
    log.info("%s: narración de %.1f s (objetivo %d s)", p.id, dur, p.duracion_s)

    if progreso:
        progreso("alinear", {})
    palabras = await asyncio.to_thread(alinear_palabras, audio)
    # el alineado se PERSISTE: el puente al editor (generated_to_canonical)
    # arma el canónico de aquí — esta ruta no tiene audio_N.mp3 por escena y
    # los tiempos ya son absolutos sobre la pista única
    import json as _json
    (workdir / "alineado.json").write_text(
        _json.dumps({"words": palabras}, ensure_ascii=False), encoding="utf-8")
    ventanas = planear_ventanas(dur)
    textos = texto_por_ventana(palabras, ventanas)

    if progreso:
        progreso("director", {})
    escenas = await dirigir_ventanas(p.narracion, ventanas, textos, ctx)
    escenas = [asignar_rutas(e, workdir) for e in ordenar_cola(escenas)]
    cadenas = partir_en_cadenas(escenas)
    log.info("%s: %d ventanas en %d cadenas", p.id, len(escenas), len(cadenas))
    if progreso:
        progreso("media", {"escenas_total": len(escenas)})

    lotes = await asyncio.gather(*(
        _procesar_cadena(c, ctx, p.personaje.url_elegida, estilo, ventanas, progreso)
        for c in cadenas))
    escenas = sorted((e for lote in lotes for e in lote), key=lambda s: s.orden)
    # M16.2: el puente arma la pista 2 del editor con los prompts REALES de
    # cada ventana — misma persistencia que la ruta escenas
    from .run import _guardar_estado
    _guardar_estado(workdir, "ventanas_listas", escenas)

    if progreso:
        progreso("concat", {})
    video = workdir / "video_ventanas.mp4"
    await ffmpeg.concat_video([e.final_path for e in escenas], video)
    pelicula = workdir / "pelicula.mp4"
    dur_final = await ffmpeg.mux_pista_unica(video, audio, pelicula)

    drive_id = link = None
    nombre = pelicula.name
    if progreso:
        progreso("drive", {})
    try:
        drive_id, nombre, link = await asyncio.to_thread(subir_drive, pelicula)
    except Exception as err:  # noqa: BLE001 — la película ya existe en disco
        log.error("Subida a Drive falló (la película está en %s): %s", pelicula, str(err)[:300])
        lf.update_current_span(level="WARNING", status_message=f"drive: {str(err)[:200]}")

    msg = mensaje_final(nombre, link or str(pelicula), dur_final, escenas)
    lf.update_current_span(output={
        "duracion": dur_final, "duracion_voz": dur, "objetivo_s": p.duracion_s,
        "n_ventanas": len(escenas),
        "n_fallback": sum(1 for e in escenas if e.es_fallback),
    })
    return Resultado(pelicula_path=pelicula, drive_id=drive_id, link=link,
                     duracion_pelicula=dur_final, escenas=escenas, mensaje=msg)
