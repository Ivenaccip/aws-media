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
from common import build_canonical, dump_json, load_json, validate_canonical  # noqa: E402
from project import WORK_DIRS, project_dir  # noqa: E402

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


def transcribir(audio: Path, model) -> list[dict]:
    segments, _info = model.transcribe(str(audio), language="es", word_timestamps=True)
    out = []
    for seg in segments:
        for w in seg.words or []:
            out.append({"text": w.word, "start": w.start, "end": w.end, "confidence": w.probability})
    return out


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


def convertir(work_dir: Path, nombre: str, transcribe_fn) -> dict:
    """Núcleo puro-orquestable (transcribe_fn inyectable para tests): arma el
    canónico desde los audios/finales de una producción del generador."""
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
                           backend="faster-whisper", model=None, words=words,
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
    args = ap.parse_args()

    work_dir = Path(args.work_dir).resolve()
    from faster_whisper import WhisperModel
    model = WhisperModel(args.model, device=args.device)
    try:
        doc = convertir(work_dir, args.nombre, lambda a: transcribir(a, model))
    except RuntimeError as err:
        # device=auto eligió CUDA pero faltan las DLLs (cublas/cudnn) → CPU
        if args.device != "auto" or not any(s in str(err) for s in ("cublas", "cudnn", "CUDA")):
            raise
        print(f"CUDA no disponible ({err}) — reintentando en CPU")
        model = WhisperModel(args.model, device="cpu", compute_type="int8")
        doc = convertir(work_dir, args.nombre, lambda a: transcribir(a, model))
    doc["asr"]["model"] = args.model
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

    if not args.skip_proxy:
        subprocess.run([sys.executable, str(Path(__file__).resolve().parent.parent / "make_proxy.py"),
                        f"videos/{args.nombre}"], check=True)

    print(f"proyecto listo: videos/{args.nombre} · {len(doc['words'])} palabras · "
          f"{doc['source']['duration']:.1f}s · {len(doc['segments'])} segmentos")
    if chequeo := verificar_contra_guion(work_dir, doc):
        print(f"verificación: {chequeo}")


if __name__ == "__main__":
    main()
