"""faster-whisper (JSON dual de S1, segundos-float) → transcript canónico.

Usage:
  python tools/normalizers/fasterwhisper_to_canonical.py IN.json OUT.json \
      --source-id raw [--source-path input.mp4]

La entrada es el output de scripts/transcribe.py de S1 (vendor claude-shorts):
{language, duration, model, segments:[{start, end, text, words:[{word, start, end}]}], captions:[...]}.
Las palabras ya están en segundos-float; aquí solo se renombra word→text, se
aplana y se deriva la estructura canónica versionada.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import build_canonical, dump_json, load_json, validate_canonical


def convert(fw: dict, source_id: str, source_path: str | None = None) -> dict:
    words = []
    for seg in fw.get("segments", []):
        for w in seg.get("words", []):
            item = {
                "text": w["word"].strip(),
                "start": round(float(w["start"]), 3),
                "end": round(float(w["end"]), 3),
            }
            if w.get("probability") is not None:
                item["confidence"] = round(float(w["probability"]), 4)
            words.append(item)

    duration = fw.get("duration") or (words[-1]["end"] if words else 0.001)

    return build_canonical(
        source_id=source_id,
        duration=duration,
        language=fw.get("language") or "es",
        backend="faster-whisper",
        model=fw.get("model"),
        words=words,
        source_path=source_path,
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--source-id", required=True)
    ap.add_argument("--source-path")
    args = ap.parse_args()

    doc = convert(load_json(args.input), args.source_id, args.source_path)
    validate_canonical(doc)
    dump_json(doc, args.output)
    print(f"canonical: {len(doc['words'])} palabras, {len(doc['segments'])} segmentos -> {args.output}")


if __name__ == "__main__":
    main()
