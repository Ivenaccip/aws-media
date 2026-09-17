"""M8 — análisis de shorts en el worker Lambda (<15 min):

  1. transcript canónico: si el proyecto no lo trae en S3, se extrae el audio
     del CDN con ffmpeg (16 kHz mono — nunca se baja el video completo al /tmp
     de la Lambda) y se transcribe con AssemblyAI (asr_backend ya imprime el
     preview de costo y traza en Langfuse).
  2. candidatos: el LLM puntúa los segmentos (prompts/shorts_candidatos_system)
     con la ponderación de la rúbrica del canal.

El resultado vive en proyectos_editor.doc.shorts (la UI hace poll). Un fallo
nuestro devuelve los créditos del análisis.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("shorts_analizar")

MAX_SEGMENTOS_LLM = 900   # ~90 min; más sería contexto desperdiciado


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _asegurar_canonico(nombre: str, fuente_key: str) -> dict:
    """Devuelve el canónico del proyecto; si no existe, transcribe y lo sube."""
    from pipeline import media_sync
    from tools.normalizers import asr_backend, common

    prefijo = f"videos/{nombre}/work/transcripts/"
    for k in media_sync.listar_prefijo(prefijo):
        if k.endswith(".canonical.json"):
            return json.loads(media_sync.leer_texto(k))

    cdn = os.getenv("CDN_BASE", "").rstrip("/")
    with tempfile.TemporaryDirectory(dir="/tmp") as tmp:
        audio = Path(tmp) / "audio.wav"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", f"{cdn}/{fuente_key}",
             "-vn", "-ac", "1", "-ar", "16000", str(audio)],
            check=True, timeout=600)
        dur = asr_backend.duracion_audio_s(audio)
        transcribir = asr_backend._transcriptor_assemblyai()
        palabras = transcribir(audio)
    stem = Path(fuente_key).stem
    doc = common.build_canonical(stem, dur, "es", "assemblyai",
                                 asr_backend.SPEECH_MODELS[0], palabras,
                                 source_path=fuente_key)
    media_sync.escribir_texto(f"{prefijo}{stem}.canonical.json",
                              json.dumps(doc, ensure_ascii=False, indent=1))
    log.info("%s: transcrito %s (%d palabras, %.0f s)", nombre, stem, len(palabras), dur)
    return doc


def _candidatos_llm(canonico: dict) -> list[dict]:
    from pipeline.config import load_prompt
    from pipeline.llm import chat_json
    from tools.normalizers.canonical_to_s1_dual import convert

    dual = convert(canonico)
    segmentos = dual["segments"][:MAX_SEGMENTOS_LLM]
    lineas = [f"[{s['start']:.1f}–{s['end']:.1f}] {s['text']}" for s in segmentos]
    salida = asyncio.run(chat_json(
        "shorts_candidatos", load_prompt("shorts_candidatos_system"),
        "Transcript segmentado del video:\n" + "\n".join(lineas)))
    dur_total = float(dual.get("duration") or 0) or None
    limpios = []
    for c in salida.get("candidatos", []):
        try:
            start, end = float(c["start"]), float(c["end"])
            score = float(c.get("score", 0))
        except (KeyError, TypeError, ValueError):
            continue
        if not 10 <= end - start <= 90 or start < 0:
            continue
        if dur_total and end > dur_total + 1:
            continue
        limpios.append({
            "start": round(start, 2), "end": round(end, 2),
            "score": round(score, 1),
            "hook_line1": str(c.get("hook_line1") or "")[:40],
            "hook_line2": str(c.get("hook_line2") or "")[:40],
            "razon": str(c.get("razon") or "")[:200],
            "texto": str(c.get("texto") or "")[:200],
        })
    limpios.sort(key=lambda c: -c["score"])
    return limpios[:10]


def analizar(user_id: str, nombre: str) -> None:
    t0 = time.monotonic()
    os.environ["DEFAULT_USER_ID"] = user_id
    from pipeline import apify, costes_infra, creditos, db

    doc = db.cargar_proyecto_editor(user_id, nombre) or {}
    st = doc.get("shorts") or {}
    try:
        canonico = _asegurar_canonico(nombre, st.get("fuente") or f"videos/{nombre}/pelicula.mp4")
        candidatos = _candidatos_llm(canonico)
        if not candidatos:
            raise RuntimeError("el análisis no encontró candidatos válidos")
        st.update(estado="candidatos", candidatos=candidatos, listo=_ahora())
        db.fijar_campo_editor(user_id, nombre, "shorts",
                              json.dumps(st, ensure_ascii=False))
        log.info("%s: %d candidatos listos", nombre, len(candidatos))
    except Exception as err:  # noqa: BLE001 — el estado y la devolución van a Postgres
        # este error también sale en pantalla: tachado como los de Apify
        apify.registrar_fallo(log, err, "%s: análisis de shorts falló", nombre)
        st.update(estado="error", error=apify.describir_error(err))
        db.fijar_campo_editor(user_id, nombre, "shorts",
                              json.dumps(st, ensure_ascii=False))
        n = int(st.get("creditos") or 0)
        if n and creditos.activo():   # fallo nuestro = créditos de vuelta
            creditos.devolver(n, f"shorts-analizar:{nombre}", user_id)
            log.info("%s: %d créditos devueltos", nombre, n)
    finally:
        costes_infra.registrar(user_id, nombre, "infra-shorts-analizar",
                               costes_infra.costo_lambda(time.monotonic() - t0))
