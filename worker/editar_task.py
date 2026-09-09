"""M14 — corrida de sugerencias de corte en Fargate (la lanza la state machine).

    python -m worker.editar_task <user_id> <nombre>

El flujo local de /clean-cut, versión automática: baja el metraje subido de S3,
asegura el transcript canónico (AssemblyAI si falta), el LLM propone el corte
(prompts/cortes_system.md — cortes seguros, fluff sugerido, flags de duda),
se arma cuts.json (los keeps son el complemento de los cortes: NUNCA se pierde
material) y tools/make_proxy.py genera proxy/manifest/waveform. Todo sube a S3
y el proyecto queda editor_listo: el usuario acepta o rechaza cada sugerencia
en el editor visual, como era en el proyecto local.

El estado viaja por proyectos_editor.doc.editar (la UI hace poll). Fallo
nuestro = créditos de vuelta.
"""
from __future__ import annotations

import asyncio
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
log = logging.getLogger("editar_task")

ROOT = Path(__file__).resolve().parent.parent
MAX_SEGMENTOS_LLM = 900   # mismo tope que shorts: ~90 min

CATS = {"retake", "false_start", "filler", "long_pause", "dead_air"}
CRITS = {"preamble", "evaluative-aside", "restated-idea"}


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _asegurar_canonico(destino: Path, video: Path) -> dict:
    """Canónico del proyecto; si no está (metraje recién subido), transcribe
    el archivo LOCAL con AssemblyAI y lo deja en work/transcripts/."""
    sys.path.insert(0, str(ROOT / "tools"))
    from tools.normalizers import asr_backend, common

    tdir = destino / "work" / "transcripts"
    for f in tdir.glob("*.canonical.json"):
        return json.loads(f.read_text(encoding="utf-8"))

    audio = destino / "work" / "audio" / f"{video.stem}.wav"
    audio.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video),
                    "-vn", "-ac", "1", "-ar", "16000", str(audio)],
                   check=True, timeout=1800)
    dur = asr_backend.duracion_audio_s(audio)
    transcribir = asr_backend._transcriptor_assemblyai()
    palabras = transcribir(audio)
    doc = common.build_canonical(video.stem, dur, "es", "assemblyai",
                                 asr_backend.SPEECH_MODELS[0], palabras,
                                 source_path=video.name)
    tdir.mkdir(parents=True, exist_ok=True)
    (tdir / f"{video.stem}.canonical.json").write_text(
        json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    log.info("transcrito %s: %d palabras, %.0f s", video.name, len(palabras), dur)
    return doc


def _asegurar_words(destino: Path, clip_id: str, canonico: dict) -> None:
    """work/transcripts/<clip>.json ({words} en MILISEGUNDOS): el contrato que
    lee cutlib.load_words en el render. Sin él, render_cuts no puede partir los
    keeps en corridas de habla ni ajustar las colas al piso de audio — los
    cortes caen crudos donde el LLM los puso y rebanan palabras a la mitad."""
    f = destino / "work" / "transcripts" / f"{clip_id}.json"
    if f.is_file():
        return
    words = [{"text": w["text"], "start": round(float(w["start"]) * 1000),
              "end": round(float(w["end"]) * 1000)} for w in canonico["words"]]
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps({"words": words}, ensure_ascii=False), encoding="utf-8")


def _sugerencias_llm(canonico: dict) -> dict:
    from pipeline.config import load_prompt
    from pipeline.llm import chat_json
    from tools.normalizers.canonical_to_s1_dual import convert

    dual = convert(canonico)
    segmentos = dual["segments"][:MAX_SEGMENTOS_LLM]
    lineas = [f"[{s['start']:.1f}–{s['end']:.1f}] {s['text']}" for s in segmentos]
    return asyncio.run(chat_json(
        "cortes_sugeridos", load_prompt("cortes_system"),
        "Transcript segmentado del metraje:\n" + "\n".join(lineas)))


def _spans_validos(items: list, dur: float) -> list[tuple[float, float, dict]]:
    out = []
    for it in items or []:
        try:
            s, e = float(it["s"]), float(it["e"])
        except (KeyError, TypeError, ValueError):
            continue
        s, e = max(0.0, s), min(float(dur), e)
        if e - s >= 0.15:
            out.append((round(s, 3), round(e, 3), it))
    out.sort(key=lambda x: x[0])
    return out


def construir_cuts(nombre: str, clip_id: str, archivo: str, dur: float,
                   salida: dict) -> dict:
    """cuts.json del contrato de clean-cut: keeps = complemento de los cortes
    (el material jamás se pierde), fluff `suggested`, flags `pending`."""
    cortes = [(s, e, it) for s, e, it in _spans_validos(salida.get("cortes"), dur)
              if str(it.get("cat")) in CATS]
    # fusionar cortes solapados para que el complemento salga limpio
    fusion: list[list[float]] = []
    for s, e, _ in cortes:
        if fusion and s <= fusion[-1][1]:
            fusion[-1][1] = max(fusion[-1][1], e)
        else:
            fusion.append([s, e])
    keeps, t = [], 0.0
    for s, e in fusion:
        if s - t >= 0.15:
            keeps.append({"s": round(t, 3), "e": round(s, 3), "text": ""})
        t = e
    if dur - t >= 0.15:
        keeps.append({"s": round(t, 3), "e": round(dur, 3), "text": ""})
    if not keeps:   # el LLM cortó todo — imposible: se conserva completo
        keeps = [{"s": 0.0, "e": round(dur, 3), "text": ""}]

    sys.path.insert(0, str(ROOT / "tools"))
    from tools.normalizers.generated_to_canonical import STYLES_DEFAULT
    return {
        "project": nombre,
        "clip_order": [clip_id],
        "clips": [{
            "id": clip_id, "file": archivo, "duration": round(dur, 3),
            "keeps": keeps,
            "cuts": [{"s": s, "e": e, "cat": it["cat"],
                      "text": str(it.get("text") or "")[:300],
                      "note": str(it.get("note") or "")[:300]}
                     for s, e, it in cortes],
            "fluff_suggestions": [
                {"s": s, "e": e, "text": str(it.get("text") or "")[:300],
                 "crit": it["crit"], "status": "suggested"}
                for s, e, it in _spans_validos(salida.get("fluff"), dur)
                if str(it.get("crit")) in CRITS],
        }],
        "styles": STYLES_DEFAULT,
        "flags": [{"id": i + 1, "clip": clip_id,
                   "at": str(f.get("at") or "")[:12],
                   "issue": str(f.get("issue") or "")[:300],
                   "default": str(f.get("default") or "keep both")[:60],
                   "status": "pending"}
                  for i, f in enumerate(salida.get("flags") or [])
                  if f.get("issue")],
    }


def main(user_id: str, nombre: str) -> int:
    import os
    t0 = time.monotonic()
    os.environ["DEFAULT_USER_ID"] = user_id
    from pipeline import costes_infra, creditos, db, media_sync
    from pipeline.storage import ruta_proyecto

    doc = db.cargar_proyecto_editor(user_id, nombre) or {}
    st = doc.get("editar") or {}
    prefijo = f"videos/{nombre}/"
    try:
        destino = ruta_proyecto(nombre)
        log.info("%s: %d artefactos bajados", nombre,
                 media_sync.bajar_prefijo(prefijo, destino))
        fuente = st.get("fuente") or ""
        video = destino / Path(fuente).relative_to(f"videos/{nombre}") if fuente \
            else next(iter((destino / "subidas").glob("*.*")), None)
        if not video or not video.is_file():
            raise RuntimeError(f"no encontré el metraje ({fuente or 'sin subida'})")

        canonico = _asegurar_canonico(destino, video)
        _asegurar_words(destino, video.stem, canonico)
        salida = _sugerencias_llm(canonico)
        cuts = construir_cuts(nombre, video.stem, str(video.relative_to(destino)).replace("\\", "/"),
                              float(canonico["source"]["duration"]), salida)
        (destino / "work" / "analysis").mkdir(parents=True, exist_ok=True)
        (destino / "work" / "analysis" / "cuts.json").write_text(
            json.dumps(cuts, ensure_ascii=False, indent=2), encoding="utf-8")

        subprocess.run([sys.executable, str(ROOT / "tools" / "make_proxy.py"),
                        str(destino)], check=True, cwd=str(ROOT / "tools"))

        subidos = media_sync.subir_dir(destino, prefijo)
        log.info("%s: %d artefactos subidos", nombre, subidos)

        flags = dict(doc.get("flags") or {})
        flags.update(canonico=True, cuts=True)
        db.fijar_campo_editor(user_id, nombre, "flags", json.dumps(flags))
        clip = cuts["clips"][0]
        st.update(estado="listo", fin=_ahora(),
                  cortes=len(clip["cuts"]), fluff=len(clip["fluff_suggestions"]),
                  flags=len(cuts["flags"]))
        db.fijar_campo_editor(user_id, nombre, "editar", json.dumps(st, ensure_ascii=False))
        log.info("%s: corte sugerido — %d cortes, %d fluff, %d flags",
                 nombre, st["cortes"], st["fluff"], st["flags"])
        rc = 0
    except Exception as err:  # noqa: BLE001 — estado y devolución a Postgres
        log.exception("%s: la corrida de sugerencias falló", nombre)
        st.update(estado="error", error=f"{type(err).__name__}: {str(err)[:300]}")
        db.fijar_campo_editor(user_id, nombre, "editar", json.dumps(st, ensure_ascii=False))
        n = int(st.get("creditos") or 0)
        if n and creditos.activo():
            creditos.devolver(n, f"editar-sugerir:{nombre}", user_id)
            log.info("%s: %d créditos devueltos", nombre, n)
        rc = 1
    finally:
        costes_infra.registrar(user_id, nombre, "infra-editar",
                               costes_infra.costo_fargate(time.monotonic() - t0))
    return rc


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("uso: python -m worker.editar_task <user_id> <nombre>")
    sys.exit(main(sys.argv[1], sys.argv[2]))
