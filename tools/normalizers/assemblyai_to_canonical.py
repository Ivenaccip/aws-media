"""AssemblyAI (respuesta completa del API, ms) → transcript canónico (segundos-float).

Usage:
  python tools/normalizers/assemblyai_to_canonical.py IN.json OUT.json \
      --source-id 0233 [--source-path DJI_0233.MP4] [--source-duration 245.3]

La respuesta de AssemblyAI trae words[{text, start, end, confidence}] en MILISEGUNDOS
enteros y audio_duration en segundos. El id de fuente no viene en la respuesta — se
pasa por CLI (los tools de L1 nombran el JSON por el id del clip).
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import build_canonical, dump_json, load_json, validate_canonical


def convert(aai: dict, source_id: str, source_path: str | None = None,
            source_duration: float | None = None) -> dict:
    raw_words = aai.get("words") or []
    words = []
    for w in raw_words:
        item = {
            "text": w["text"],
            "start": round(w["start"] / 1000.0, 3),
            "end": round(w["end"] / 1000.0, 3),
        }
        if w.get("confidence") is not None:
            item["confidence"] = round(float(w["confidence"]), 4)
        words.append(item)

    duration = source_duration or aai.get("audio_duration")
    if not duration:
        duration = words[-1]["end"] if words else 0.001

    return build_canonical(
        source_id=source_id,
        duration=duration,
        language=(aai.get("language_code") or "es").split("_")[0],
        backend="assemblyai",
        model=aai.get("speech_model_used") or aai.get("speech_model"),
        words=words,
        source_path=source_path,
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--source-id", required=True)
    ap.add_argument("--source-path")
    ap.add_argument("--source-duration", type=float)
    args = ap.parse_args()

    doc = convert(load_json(args.input), args.source_id, args.source_path, args.source_duration)
    validate_canonical(doc)
    dump_json(doc, args.output)
    print(f"canonical: {len(doc['words'])} palabras, {len(doc['segments'])} segmentos -> {args.output}")


if __name__ == "__main__":
    main()
