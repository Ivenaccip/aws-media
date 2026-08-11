"""Transcripción de doble backend (local faster-whisper / nube AssemblyAI).

Usage:
  python tools/transcribe.py videos/video-1                  # todos los clips
  python tools/transcribe.py videos/video-1 --clips 0233     # clip(s) específicos
  python tools/transcribe.py videos/video-1 --force          # re-transcribir
  python tools/transcribe.py videos/video-1 --yes            # sin confirmación de costo (nube)

El backend, modelo y device salen de .video-stack/config.json (corre
`python tools/setup.py` primero; re-ejecutable por máquina).

Lee:    <project>/work/audio/*.wav   (16 kHz mono, ver clean-cut paso 2)
Escribe por clip:
  <project>/work/<outdir>/<id>.json            formato del engine de corte de L1
                                               (words en ms — cutlib/verify lo leen tal cual)
  <project>/work/<outdir>/<id>.canonical.json  esquema canónico 1.0 (docs/SCHEMA.md)
                                               — el contrato que consumen ambas ramas

Nube: SIEMPRE muestra preview de costo antes de enviar ("este archivo dura 47 min
≈ $0.16"), con precios exclusivamente de tools/pricing.json. Nada del free tier se
promete: verifica tu crédito en el dashboard de AssemblyAI.
"""

import argparse
import json
import subprocess
import sys
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "normalizers"))
from common import build_canonical, dump_json, validate_canonical  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REPO = Path(__file__).resolve().parent.parent
PRICING = json.loads((REPO / "tools" / "pricing.json").read_text(encoding="utf-8"))
API_BASE = "https://api.assemblyai.com/v2"
SPEECH_MODELS = ["universal-3-5-pro", "universal-2"]
PROMPT = (
    "Verbatim transcription of a solo tutorial recording with multiple takes, "
    "mostly in Latin American Spanish with English technical terms (code-switching). "
    "Transcribe exactly as spoken: keep false starts, repeated words, self-corrections, "
    "and filler words — do not clean them up, do not translate English terms."
)


def load_config() -> dict:
    cfg_path = REPO / ".video-stack" / "config.json"
    if not cfg_path.exists():
        sys.exit("No hay .video-stack/config.json — corre primero: python tools/setup.py")
    return json.loads(cfg_path.read_text(encoding="utf-8"))


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / w.getframerate()


def load_keyterms(project: Path) -> list[str]:
    f = project / "work" / "keyterms.txt"
    if not f.exists():
        return []
    return [ln.strip() for ln in f.read_text(encoding="utf-8").splitlines()
            if ln.strip() and not ln.strip().startswith("#")]


def collect_jobs(project: Path, clips, outdir: str, force: bool):
    audio_dir = project / "work" / "audio"
    out_dir = project / "work" / outdir
    out_dir.mkdir(parents=True, exist_ok=True)
    jobs = []
    for wav in sorted(audio_dir.glob("*.wav")):
        cid = wav.stem
        if clips and cid not in clips:
            continue
        if not force and (out_dir / f"{cid}.json").exists():
            print(f"{cid}: transcript existe, se omite (usa --force para rehacer)")
            continue
        jobs.append((cid, wav))
    return jobs, out_dir


def write_outputs(out_dir: Path, cid: str, words_s: list[dict], language: str,
                  duration: float, backend: str, model: str) -> None:
    """words_s = palabras canónicas (segundos-float). Escribe canónico + formato engine (ms)."""
    canonical = build_canonical(source_id=cid, duration=duration, language=language,
                                backend=backend, model=model, words=words_s)
    validate_canonical(canonical)
    dump_json(canonical, out_dir / f"{cid}.canonical.json")

    engine_words = []
    for w in words_s:
        ew = {"text": w["text"], "start": int(round(w["start"] * 1000)),
              "end": int(round(w["end"] * 1000))}
        if "confidence" in w:
            ew["confidence"] = w["confidence"]
        engine_words.append(ew)
    engine = {"language_code": language, "audio_duration": round(duration, 3),
              "speech_model_used": model, "words": engine_words,
              "text": " ".join(w["text"] for w in words_s)}
    (out_dir / f"{cid}.json").write_text(json.dumps(engine, indent=1, ensure_ascii=False),
                                         encoding="utf-8")
    print(f"{cid}: {len(words_s)} palabras -> {cid}.json + {cid}.canonical.json")


# ------------------------------------------------------------------ local

LOCAL_SNIPPET = r"""
import json, sys
from faster_whisper import WhisperModel
wav, model_size, device, compute = sys.argv[1:5]
model = WhisperModel(model_size, device=device, compute_type=compute)
segments, info = model.transcribe(wav, beam_size=5, word_timestamps=True,
                                  vad_filter=True,
                                  vad_parameters=dict(min_silence_duration_ms=500, speech_pad_ms=200))
words = []
for seg in segments:
    for w in (seg.words or []):
        item = {"text": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)}
        if w.probability is not None:
            item["confidence"] = round(w.probability, 4)
        words.append(item)
print(json.dumps({"language": info.language, "duration": info.duration, "words": words}))
"""


def run_local(cfg: dict, jobs, out_dir: Path) -> None:
    py = cfg.get("venv_python")
    if not py or not Path(py).exists():
        sys.exit("config.venv_python no apunta a un python con faster-whisper — re-corre tools/setup.py")
    model, device, compute = cfg["model"], cfg["device"], cfg["compute_type"]
    if model.endswith(".en") or model.startswith("distil"):
        sys.exit(f"modelo {model!r} es English-only — prohibido para contenido en español "
                 "(usa small/medium/large-v3 multilingües)")
    print(f"backend local: faster-whisper {model} ({device}/{compute}) — costo $0")
    for cid, wav in jobs:
        t0 = time.perf_counter()
        r = subprocess.run([py, "-c", LOCAL_SNIPPET, str(wav), model, device, compute],
                           capture_output=True, text=True)
        if r.returncode != 0:
            print(f"{cid}: ERROR — {r.stderr.strip().splitlines()[-1] if r.stderr.strip() else '?'}")
            continue
        data = json.loads(r.stdout.strip().splitlines()[-1])
        dur = data["duration"] or wav_duration(wav)
        print(f"{cid}: transcrito en {time.perf_counter() - t0:.1f}s "
              f"({dur / max(time.perf_counter() - t0, 0.01):.1f}x tiempo real)")
        write_outputs(out_dir, cid, data["words"], data["language"] or "es", dur,
                      "faster-whisper", model)


# ------------------------------------------------------------------ nube

def cost_preview(jobs, keyterms: bool) -> float:
    aai = PRICING["assemblyai"]
    rate = aai["models"]["universal-3-5-pro"]["usd_per_hour"]
    if keyterms:
        rate += aai["addons"]["keyterms_prompt"]["usd_per_hour"]
    total = 0.0
    print(f"Preview de costo (AssemblyAI Universal-3.5 Pro, ${rate:.2f} dólares por hora, "
          "facturación por segundo):")
    for cid, wav in jobs:
        d = wav_duration(wav)
        c = d / 3600 * rate
        total += c
        mins = f"{d / 60:.0f} min" if d >= 60 else f"{d:.0f} s"
        print(f"  {cid}: este archivo dura {mins} ≈ ${c:.2f}")
    print(f"  TOTAL estimado: ${total:.2f} dólares. "
          "(Free tier: verifica tu crédito en el dashboard de AssemblyAI.)")
    return total


def load_env_key(name: str) -> str:
    env = REPO / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line.startswith(name + "="):
                v = line.split("=", 1)[1].strip().strip('"').strip("'")
                if v:
                    return v
    sys.exit(f"{name} no está en .env (copia .env.example)")


def run_cloud(cfg: dict, jobs, out_dir: Path, project: Path, assume_yes: bool) -> None:
    import requests
    keyterms = load_keyterms(project)
    cost_preview(jobs, bool(keyterms))
    if not assume_yes:
        try:
            ok = input("¿Enviar a AssemblyAI? (yes/no) [yes]: ").strip() or "yes"
        except EOFError:
            ok = "yes"
        if ok != "yes":
            sys.exit("cancelado — también existe la ruta local: python tools/setup.py")

    headers = {"authorization": load_env_key("ASSEMBLYAI_API_KEY")}
    print(f"keyterms: {len(keyterms)}" if keyterms
          else "keyterms: ninguno (work/keyterms.txt) — agrégalos para mejor precisión")
    pending = {}
    for cid, wav in jobs:
        with open(wav, "rb") as f:
            up = requests.post(f"{API_BASE}/upload", headers=headers, data=f, timeout=300)
        up.raise_for_status()
        payload = {"audio_url": up.json()["upload_url"], "speech_models": SPEECH_MODELS,
                   "language_detection": True, "punctuate": True, "format_text": True,
                   "disfluencies": True, "prompt": PROMPT}
        if keyterms:
            payload["keyterms_prompt"] = keyterms
        r = requests.post(f"{API_BASE}/transcript", headers=headers, json=payload, timeout=60)
        if r.status_code == 400:
            payload.pop("disfluencies")
            r = requests.post(f"{API_BASE}/transcript", headers=headers, json=payload, timeout=60)
        r.raise_for_status()
        pending[cid] = (r.json()["id"], wav)
        print(f"{cid}: enviado ({pending[cid][0]})")

    while pending:
        time.sleep(5)
        for cid, (tid, wav) in list(pending.items()):
            r = requests.get(f"{API_BASE}/transcript/{tid}", headers=headers, timeout=60)
            r.raise_for_status()
            data = r.json()
            if data["status"] == "completed":
                (out_dir / f"{cid}.json").write_text(json.dumps(data, indent=1), encoding="utf-8")
                words_s = []
                for w in data.get("words") or []:
                    item = {"text": w["text"], "start": round(w["start"] / 1000, 3),
                            "end": round(w["end"] / 1000, 3)}
                    if w.get("confidence") is not None:
                        item["confidence"] = round(w["confidence"], 4)
                    words_s.append(item)
                dur = data.get("audio_duration") or wav_duration(wav)
                lang = (data.get("language_code") or "es").split("_")[0]
                model = data.get("speech_model_used") or data.get("speech_model") or "universal-3-5-pro"
                canonical = build_canonical(cid, dur, lang, "assemblyai", model, words_s)
                validate_canonical(canonical)
                dump_json(canonical, out_dir / f"{cid}.canonical.json")
                print(f"{cid}: completado, {len(words_s)} palabras, modelo={model}")
                del pending[cid]
            elif data["status"] == "error":
                print(f"{cid}: ERROR {data.get('error')}")
                del pending[cid]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--clips", nargs="*")
    ap.add_argument("--outdir", default="transcripts")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--yes", action="store_true", help="no pedir confirmación de costo (nube)")
    args = ap.parse_args()

    cfg = load_config()
    project = (REPO / args.project) if not Path(args.project).is_absolute() else Path(args.project)
    if not (project / "work" / "audio").exists():
        sys.exit(f"no existe {project}/work/audio — corre tools/project.py new y extrae los WAV")

    jobs, out_dir = collect_jobs(project, args.clips, args.outdir, args.force)
    if not jobs:
        # distinguir "faltan los WAV" de "ya esta todo transcrito" (el mensaje
        # ambiguo costo un primer intento fallido en /empezar — docs/BROLL-RUTAS.md)
        if not any((project / "work" / "audio").glob("*.wav")):
            sys.exit(f"no hay WAVs en {project}/work/audio — extrae el audio primero:\n"
                     f"  ffmpeg -i {project}/<clip>.MP4 -vn -ac 1 -ar 16000 "
                     f"{project}/work/audio/<id>.wav")
        print("nada que transcribir: todos los clips ya tienen transcript "
              "(usa --force para rehacer)")
        return
    if cfg["asr"] == "local":
        run_local(cfg, jobs, out_dir)
    else:
        run_cloud(cfg, jobs, out_dir, project, args.yes)
    print("listo — el canónico es el contrato de ambas ramas (docs/SCHEMA.md)")


if __name__ == "__main__":
    main()
