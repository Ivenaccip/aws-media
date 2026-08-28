"""Incorporar metraje al proyecto (F3.5 caso B — panel Importar del editor).

Toma MP4s sueltos de videos/ (dejados ahí por el cuadro ＋ del editor), y por
cada uno: lo mueve al proyecto, lo transcribe UNA vez con faster-whisper local
(mismo fallback CUDA→CPU que el puente), escribe su canónico (docs/SCHEMA.md,
tiempos relativos a SU fuente — regla dura del contrato) y lo agrega a
cuts.json como clip keep-all. Al final regenera el proxy del editor.

Uso: python tools/agregar_video.py videos/<proyecto> archivo1.mp4 [archivo2 ...]
     (rutas de archivo relativas a videos/ o absolutas; $0 — todo local)
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "normalizers"))
from common import build_canonical, dump_json, load_json, validate_canonical  # noqa: E402


def duracion_de(path: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


def source_id_para(nombre: str, usados: set[str]) -> str:
    base = re.sub(r"[^a-zA-Z0-9_-]+", "-", Path(nombre).stem).strip("-").lower() or "clip"
    sid, n = base, 2
    while sid in usados:
        sid, n = f"{base}-{n}", n + 1
    return sid


def transcribir(model, audio: Path) -> list[dict]:
    segments, _info = model.transcribe(str(audio), language="es", word_timestamps=True)
    words = []
    for seg in segments:
        for w in seg.words or []:
            words.append({"text": w.word.strip(), "start": round(w.start, 3),
                          "end": round(w.end, 3), "confidence": round(w.probability, 4)})
    return words


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("proyecto", help="videos/<nombre>")
    ap.add_argument("archivos", nargs="+", help="MP4s a incorporar")
    ap.add_argument("--model", default="small")
    ap.add_argument("--device", default="auto")
    args = ap.parse_args()

    proj = (ROOT / args.proyecto).resolve()
    cuts_path = proj / "work" / "analysis" / "cuts.json"
    if not cuts_path.is_file():
        sys.exit(f"{args.proyecto}: sin cuts.json — no es un proyecto del editor")
    cuts = load_json(cuts_path)

    rutas = []
    for a in args.archivos:
        p = Path(a)
        if not p.is_absolute():
            p = (ROOT / "videos" / a).resolve()
        if not p.is_file():
            sys.exit(f"no existe: {p}")
        rutas.append(p)

    print(f"cargando faster-whisper {args.model} ({args.device})…", flush=True)
    from faster_whisper import WhisperModel
    model = WhisperModel(args.model, device=args.device)

    def transcribir_con_fallback(audio: Path) -> list[dict]:
        nonlocal model
        try:
            return transcribir(model, audio)
        except RuntimeError as err:
            # device=auto eligió CUDA pero faltan las DLLs (cublas/cudnn) → CPU
            if args.device != "auto" or not any(s in str(err) for s in ("cublas", "cudnn", "CUDA")):
                raise
            print(f"CUDA no disponible ({str(err)[:80]}) — reintentando en CPU", flush=True)
            model = WhisperModel(args.model, device="cpu", compute_type="int8")
            return transcribir(model, audio)

    usados = set(cuts["clip_order"])
    for ruta in rutas:
        sid = source_id_para(ruta.name, usados)
        usados.add(sid)
        destino = proj / f"{sid}.mp4"
        print(f"→ {ruta.name} como clip '{sid}'", flush=True)
        shutil.move(str(ruta), destino)
        dur = duracion_de(destino)

        print(f"  transcribiendo ({dur:.0f}s de audio, local $0)…", flush=True)
        words = transcribir_con_fallback(destino)
        doc = build_canonical(source_id=sid, duration=dur, language="es",
                              backend="faster-whisper", model=args.model,
                              words=words, source_path=destino.name)
        validate_canonical(doc)
        dump_json(doc, proj / "work" / "transcripts" / f"{sid}.canonical.json")

        resumen = " ".join(w["text"] for w in words[:10]) + ("…" if len(words) > 10 else "")
        cuts["clips"].append({
            "id": sid, "file": destino.name, "duration": round(dur, 3),
            "keeps": [{"s": 0.0, "e": round(dur, 3), "text": resumen or "clip importado — sin cortes"}],
            "cuts": [], "fluff_suggestions": [],
        })
        cuts["clip_order"].append(sid)
        print(f"  ✓ {len(words)} palabras · {dur:.1f}s", flush=True)

    backups = proj / "work" / "analysis" / "backups"
    backups.mkdir(exist_ok=True)
    shutil.copy2(cuts_path, backups / f"cuts-{time.strftime('%Y%m%d-%H%M%S')}.json")
    cuts_path.write_text(json.dumps(cuts, indent=2, ensure_ascii=False), encoding="utf-8")
    print("cuts.json actualizado (con respaldo)", flush=True)

    print("regenerando proxy del editor…", flush=True)
    rel = proj.relative_to(ROOT).as_posix()
    subprocess.run([sys.executable, str(ROOT / "tools" / "make_proxy.py"), rel],
                   check=True, cwd=str(ROOT))
    print(f"✓ listo: {len(rutas)} clip(s) incorporados a {rel}", flush=True)


if __name__ == "__main__":
    main()
