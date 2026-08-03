"""Transcript canónico → JSON dual de S1 (claude-shorts).

Usage:
  python tools/normalizers/canonical_to_s1_dual.py IN.canonical.json OUT.json

Produce el formato que consume la rama shorts SIN tocar S1 por dentro:
- segments[] estilo-WhisperX ({start, end, text, words:[{word, start, end}]}) —
  lo leen snap_boundaries.py y el paso de análisis de la skill
- captions[] nativo de Remotion ({text, startMs, endMs}) — lo consume
  createTikTokStyleCaptions() vía render.mjs (ver DECISIONES pendiente #3: no
  se usa SRT en ninguna parte del pipeline)

Convención de espacios: faster-whisper conserva el espacio inicial en cada token
("faster-whisper preserves leading spaces", scripts/transcribe.py:107 de S1) y las
páginas TikTok concatenan los tokens tal cual — así que toda palabra que no abre
segmento lleva " " antepuesto.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import dump_json, load_json, require_version


def convert(doc: dict) -> dict:
    words = doc["words"]
    segments = []
    captions = []

    for seg in doc["segments"]:
        seg_words = words[seg["first_word"]:seg["last_word"] + 1]
        segments.append({
            "start": seg_words[0]["start"],
            "end": seg_words[-1]["end"],
            "text": seg.get("text") or " ".join(w["text"] for w in seg_words),
            "words": [{"word": w["text"], "start": w["start"], "end": w["end"]}
                      for w in seg_words],
        })
        for i, w in enumerate(seg_words):
            captions.append({
                "text": w["text"] if i == 0 else " " + w["text"],
                "startMs": int(round(w["start"] * 1000)),
                "endMs": int(round(w["end"] * 1000)),
            })

    return {
        "language": doc["language"],
        "duration": doc["source"]["duration"],
        "word_count": len(words),
        "model": doc["asr"].get("model", ""),
        "segments": segments,
        "captions": captions,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("input", help="transcript canónico (schema 1.0)")
    ap.add_argument("output", help="JSON dual estilo S1")
    args = ap.parse_args()

    doc = load_json(args.input)
    require_version(doc)
    out = convert(doc)
    dump_json(out, args.output)
    print(f"s1-dual: {len(out['segments'])} segmentos, {len(out['captions'])} captions -> {args.output}")


if __name__ == "__main__":
    main()
