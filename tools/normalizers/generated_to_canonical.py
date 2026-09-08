"""Película generada (rama generador, ex video-pipeline) → proyecto editable.

El puente de la fusión (PLAN-FUSION.md F1.3): toma el work/<id>/ de una producción
del generador y crea un proyecto videos/<nombre> con TODO lo que las ramas de
edición esperan de metraje real:

  videos/<nombre>/pelicula.mp4                      la película como fuente cruda
  work/transcripts/pelicula.canonical.json          el contrato (docs/SCHEMA.md)
  work/analysis/cuts.json                           keep-all (sin cortes) editable
  work/audio/pelicula.wav                           16 kHz mono (AudioProbe/cutlib)
  work/edited-transcript.json                       ms sobre el master (make_subs)
  work/editor/{proxy,manifest,waveform}             vía tools/make_proxy.py

Timestamps: whisper corre POR AUDIO DE ESCENA (TTS limpio → palabras casi
perfectas) y cada palabra se desplaza al timeline de la película con la suma de
duraciones REALES de los clips finales (orden de lista.txt) + el itsoffset de
0.3 s del mux (pipeline/ffmpeg.py). La película ES la fuente cruda: master ==
fuente, por eso edited-transcript.json se deriva 1:1 del canónico.

Usage:
  python tools/normalizers/generated_to_canonical.py WORK_DIR NOMBRE \
      [--model small] [--device auto] [--skip-proxy]

Modelos permitidos: small | medium | large-v3 (multilingües — regla del repo).
"""

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))  # raíz: paquete pipeline
from common import build_canonical, dump_json, load_json, validate_canonical  # noqa: E402
from project import WORK_DIRS, project_dir  # noqa: E402

from pipeline import overlays as overlays_mod  # noqa: E402

AUDIO_OFFSET_S = 0.3   # -itsoffset del mux del generador: el audio arranca aquí dentro del clip
SOURCE_ID = "pelicula"

STYLES_DEFAULT = {
    "tight": {"internal_gap": 0.4, "min_tail": 0.14, "max_tail": 0.4,
              "head": 0.11, "soft_gap": 1.2, "soft_max_tail": 0.6, "soft_margin": 3.0},
    "natural": {"internal_gap": 0.4, "min_tail": 0.26, "max_tail": 0.45,
                "head": 0.19, "soft_gap": 1.2, "soft_max_tail": 0.6, "soft_margin": 3.0},
}


def orden_escenas(work_dir: Path) -> list[str]:
    """Ids de escena en orden de concat: lista.txt si existe (la verdad del render),
    si no, orden natural de los final_*.mp4."""
    lista = work_dir / "lista.txt"
    if lista.is_file():
        ids = []
        for line in lista.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("file"):
                name = line.split("'")[1] if "'" in line else line.split()[-1]
                ids.append(Path(name).stem.removeprefix("final_"))
        if ids:
            return ids
    finals = sorted(work_dir.glob("final_*.mp4"), key=lambda p: _natural(p.stem.removeprefix("final_")))
    return [p.stem.removeprefix("final_") for p in finals]


def _natural(s: str) -> tuple:
    num, suf = "", ""
    for ch in s:
        (num, suf) = (num + ch, suf) if ch.isdigit() and not suf else (num, suf + ch)
    return (int(num) if num else 0, suf)


def duracion_video(path: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(r.stdout.strip())


def ensamblar_palabras(escenas: list[tuple[str, float, list[dict]]]) -> list[dict]:
    """(id, duracion_clip, palabras_locales) por escena, en orden de concat →
    palabras absolutas sobre la película. Cada palabra local se desplaza por el
    offset acumulado + AUDIO_OFFSET_S y se recorta al final de su clip."""
    words, offset = [], 0.0
    for _id, dur, locales in escenas:
        tope = offset + dur
        for w in locales:
            start = min(offset + AUDIO_OFFSET_S + float(w["start"]), tope)
            end = min(offset + AUDIO_OFFSET_S + float(w["end"]), tope)
            item = {"text": w["text"].strip(), "start": round(start, 3), "end": round(max(end, start), 3)}
            if w.get("confidence") is not None:
                item["confidence"] = round(float(w["confidence"]), 4)
            if item["text"]:
                words.append(item)
        offset = tope
    return words


def cuts_keep_all(nombre: str, duracion: float) -> dict:
    return {
        "project": nombre,
        "clip_order": [SOURCE_ID],
        "clips": [{
            "id": SOURCE_ID, "file": "pelicula.mp4", "duration": round(duracion, 3),
            "keeps": [{"s": 0.0, "e": round(duracion, 3), "text": "película generada — sin cortes"}],
            "cuts": [], "fluff_suggestions": [],
        }],
        "styles": STYLES_DEFAULT,
        "flags": [],
    }


def edited_transcript_ms(words: list[dict]) -> dict:
    """Master == fuente (sin cortes): el contrato de make_subs sale 1:1 del canónico."""
    return {"words": [{"text": w["text"], "start": round(w["start"] * 1000),
                       "end": round(w["end"] * 1000)} for w in words]}


def _palabras_norm(crudas: list[dict], tope: float) -> list[dict]:
    """Palabras ya ABSOLUTAS sobre la película (ruta narración: pista única que
    arranca en 0) → formato del canónico, recortadas a la duración."""
    words = []
    for w in crudas:
        start = min(float(w["start"]), tope)
        end = min(float(w["end"]), tope)
        item = {"text": str(w["text"]).strip(), "start": round(start, 3),
                "end": round(max(end, start), 3)}
        if w.get("confidence") is not None:
            item["confidence"] = round(float(w["confidence"]), 4)
        if item["text"]:
            words.append(item)
    return words


def convertir(work_dir: Path, nombre: str, transcribe_fn,
              backend: str = "faster-whisper", model: str | None = None) -> dict:
    """Núcleo puro-orquestable (transcribe_fn inyectable para tests): arma el
    canónico desde los audios/finales de una producción del generador."""
    # M11 (narración primero): NO hay audio_N.mp3 por escena — la voz es una
    # pista única. Preferencia: el alineado que la producción ya persistió
    # (alineado.json, gratis); si falta, se transcribe narracion.mp3 completo.
    alineado, narracion = work_dir / "alineado.json", work_dir / "narracion.mp3"
    if alineado.is_file() or narracion.is_file():
        total = round(duracion_video(work_dir / "pelicula.mp4"), 3)
        if alineado.is_file():
            crudas = json.loads(alineado.read_text(encoding="utf-8"))["words"]
            # procedencia real: el alineado lo hizo faster-whisper (ALINEADOR_MODEL)
            backend, model = "faster-whisper", model or "small"
        else:
            crudas = transcribe_fn(narracion)
        return build_canonical(source_id=SOURCE_ID, duration=total, language="es",
                               backend=backend, model=model,
                               words=_palabras_norm(crudas, total),
                               source_path="pelicula.mp4")
    ids = orden_escenas(work_dir)
    if not ids:
        sys.exit(f"{work_dir}: no hay final_*.mp4 ni lista.txt — ¿es una producción terminada?")
    escenas = []
    for i in ids:
        final, audio = work_dir / f"final_{i}.mp4", work_dir / f"audio_{i}.mp3"
        if not final.is_file() or not audio.is_file():
            sys.exit(f"escena {i}: falta {final.name if not final.is_file() else audio.name}")
        escenas.append((i, duracion_video(final), transcribe_fn(audio)))
    words = ensamblar_palabras(escenas)
    total = round(sum(d for _, d, _ in escenas), 3)
    return build_canonical(source_id=SOURCE_ID, duration=total, language="es",
                           backend=backend, model=model, words=words,
                           source_path="pelicula.mp4")


def verificar_contra_guion(work_dir: Path, doc: dict) -> str | None:
    proyecto = work_dir / "proyecto.json"
    if not proyecto.is_file():
        return None
    guion = json.loads(proyecto.read_text(encoding="utf-8")).get("guion") or []
    esperadas = sum(len(e.get("narracion", "").split()) for e in guion)
    obtenidas = len(doc["words"])
    if not esperadas:
        return None
    desvio = abs(obtenidas - esperadas) / esperadas
    veredicto = "OK" if desvio <= 0.05 else "REVISAR"
    return f"palabras guion={esperadas} whisper={obtenidas} desvío={desvio:.1%} → {veredicto}"


def main() -> None:
    if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # consola cp1252 de Windows
    ap = argparse.ArgumentParser()
    ap.add_argument("work_dir", help="work/<id> de una producción terminada del generador")
    ap.add_argument("nombre", help="nombre del proyecto destino (p. ej. gen-tesla)")
    ap.add_argument("--model", default="small", choices=["small", "medium", "large-v3"])
    ap.add_argument("--device", default="auto")
    ap.add_argument("--skip-proxy", action="store_true", help="no generar proxy/manifest/waveform")
    ap.add_argument("--solo-overlays", action="store_true",
                    help="solo registrar overlays (pista 2) en un proyecto ya convertido")
    args = ap.parse_args()

    work_dir = Path(args.work_dir).resolve()
    if args.solo_overlays:
        proj = project_dir(args.nombre)
        ids = orden_escenas(work_dir)
        durs = {i: duracion_video(work_dir / f"final_{i}.mp4") for i in ids}
        data = overlays_mod.crear_desde_produccion(
            proj, work_dir, ids, durs,
            pista_unica=(work_dir / "narracion.mp3").is_file())
        print(f"overlays: {len(data['overlays'])} escenas registradas en videos/{args.nombre}")
        return
    # A2: el backend sale de .video-stack/config.json (local | assemblyai);
    # sin config = faster-whisper local con --model/--device, como siempre.
    from asr_backend import crear_transcriptor
    transcribe_fn, backend, modelo = crear_transcriptor(args.model, args.device)
    print(f"transcripción: {backend} ({modelo})", flush=True)
    doc = convertir(work_dir, args.nombre, transcribe_fn, backend=backend, model=modelo)
    validate_canonical(doc)

    proj = project_dir(args.nombre)
    for d in WORK_DIRS:
        (proj / d).mkdir(parents=True, exist_ok=True)
    shutil.copy2(work_dir / "pelicula.mp4", proj / "pelicula.mp4")
    dump_json(doc, proj / "work" / "transcripts" / f"{SOURCE_ID}.canonical.json")
    dump_json(cuts_keep_all(args.nombre, doc["source"]["duration"]),
              proj / "work" / "analysis" / "cuts.json")
    dump_json(edited_transcript_ms(doc["words"]), proj / "work" / "edited-transcript.json")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(proj / "pelicula.mp4"),
                    "-ar", "16000", "-ac", "1",
                    str(proj / "work" / "audio" / f"{SOURCE_ID}.wav")], check=True)

    # M16.2: la ruta narración también arma la pista 2 — clips video-only por
    # ventana (final_N.mp4) con la voz continua aparte (pista_unica)
    pista_unica = (work_dir / "narracion.mp3").is_file()
    ids = orden_escenas(work_dir)
    if ids:
        durs = {i: duracion_video(work_dir / f"final_{i}.mp4") for i in ids}
        data_ov = overlays_mod.crear_desde_produccion(proj, work_dir, ids, durs,
                                                      pista_unica=pista_unica)
        print(f"overlays: {len(data_ov['overlays'])} escenas en la pista 2"
              + (" (pista única)" if pista_unica else ""))
    else:
        print("overlays: sin final_*.mp4 — pista 2 vacía")

    if not args.skip_proxy:
        subprocess.run([sys.executable, str(Path(__file__).resolve().parent.parent / "make_proxy.py"),
                        str(proj)], check=True)

    print(f"proyecto listo: {proj} · {len(doc['words'])} palabras · "
          f"{doc['source']['duration']:.1f}s · {len(doc['segments'])} segmentos")
    if chequeo := verificar_contra_guion(work_dir, doc):
        print(f"verificación: {chequeo}")


if __name__ == "__main__":
    main()
