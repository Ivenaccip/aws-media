"""Utilidades compartidas por los normalizadores hacia/desde el esquema canónico.

El contrato vive en schema/transcript.schema.json (ver docs/SCHEMA.md):
segundos-float, granularidad palabra, timestamps relativos a la fuente cruda,
schema_version explícito.
"""

import json
from pathlib import Path

SCHEMA_VERSION = "1.0"
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SCHEMA_PATH = REPO_ROOT / "schema" / "transcript.schema.json"

# Pausa que cierra un segmento cuando no hay puntuación final (mismo umbral que
# usa format_transcript.py de L1 para separar takes).
SEGMENT_GAP_S = 0.8
SENTENCE_END = (".", "?", "!", "…")


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def dump_json(data, path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def segment_words(words: list[dict]) -> list[dict]:
    """Deriva segments[] (índices inclusive sobre words[]) de forma determinista:
    un segmento cierra en puntuación final de oración o en una pausa >= SEGMENT_GAP_S."""
    segments = []
    if not words:
        return segments
    first = 0
    for i, w in enumerate(words):
        is_last = i == len(words) - 1
        gap_next = (words[i + 1]["start"] - w["end"]) if not is_last else 0.0
        if is_last or w["text"].endswith(SENTENCE_END) or gap_next >= SEGMENT_GAP_S:
            segments.append({
                "first_word": first,
                "last_word": i,
                "text": " ".join(x["text"] for x in words[first:i + 1]),
            })
            first = i + 1
    return segments


def build_canonical(source_id: str, duration: float, language: str,
                    backend: str, model: str | None, words: list[dict],
                    source_path: str | None = None) -> dict:
    doc = {
        "schema_version": SCHEMA_VERSION,
        "source": {"id": source_id, "duration": round(float(duration), 3)},
        "language": language,
        "asr": {"backend": backend},
        "words": words,
        "segments": segment_words(words),
    }
    if source_path:
        doc["source"]["path"] = source_path
    if model:
        doc["asr"]["model"] = model
    return doc


def validate_canonical(doc: dict) -> None:
    """Valida contra schema/transcript.schema.json. Lanza jsonschema.ValidationError."""
    import jsonschema
    jsonschema.validate(doc, load_json(SCHEMA_PATH))
    # Coherencia que JSON Schema no expresa: orden temporal e índices de segmentos.
    words = doc["words"]
    for i, w in enumerate(words):
        if w["end"] < w["start"]:
            raise ValueError(f"words[{i}]: end < start")
        if i and w["start"] < words[i - 1]["start"]:
            raise ValueError(f"words[{i}]: fuera de orden temporal")
    for j, s in enumerate(doc["segments"]):
        if not (0 <= s["first_word"] <= s["last_word"] < len(words)):
            raise ValueError(f"segments[{j}]: índices fuera de rango")


def require_version(doc: dict) -> None:
    v = doc.get("schema_version")
    if v != SCHEMA_VERSION:
        raise SystemExit(
            f"transcript schema_version={v!r} no soportada (esperaba {SCHEMA_VERSION!r}). "
            "Regenera el canónico con los normalizadores de esta versión del repo."
        )
