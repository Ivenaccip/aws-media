"""Deriva work/edited-transcript.json remapeando el transcript CANÓNICO al timeline
del master — sin re-transcribir (paso 13 de /clean-cut, versión determinística).

Uso:
  python tools/edited_transcript.py videos/video-N [--style tight] [--mode final]

Lee work/render/<style>-<mode>/segments.json (lo escribe render_cuts.py: rango crudo
[s,e] por segmento + duración REAL codificada) y el canónico de cada clip. Dentro de
un segmento la posición de cada palabra se conserva tal cual (el segmento ES el rango
crudo re-codificado); lo único que difiere del plan es el largo total por redondeo a
frame — por eso el offset acumulado usa las duraciones reales probadas, no las
planeadas. Cero ASR, timestamps exactos, y las correcciones de texto hechas al
canónico (editor de cortes) llegan aquí intactas.

Salida: {words:[{text,start,end}]} en MILISEGUNDOS sobre el timeline del master —
el contrato que consumen make_subs.py y /broll-ai.
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOL = 0.03  # tolerancia de pertenencia palabra→segmento (misma clase que cutlib)


def canonical_words(project: Path, clip: str) -> list[dict]:
    path = project / "work" / "transcripts" / f"{clip}.canonical.json"
    if not path.is_file():
        sys.exit(f"no existe {path} — el canónico es obligatorio (docs/SCHEMA.md)")
    data = json.loads(path.read_text(encoding="utf-8"))
    ver = str(data.get("schema_version", ""))
    if not ver.startswith("1."):
        sys.exit(f"{path.name}: schema_version {ver!r} no soportada (se espera 1.x)")
    return data["words"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--style", default="tight")
    ap.add_argument("--mode", choices=["preview", "final"], default="final")
    args = ap.parse_args()

    project = ROOT / args.project
    seg_path = project / "work" / "render" / f"{args.style}-{args.mode}" / "segments.json"
    if not seg_path.is_file():
        sys.exit(f"no existe {seg_path} — renderiza primero con render_cuts.py "
                 "(las corridas viejas no lo traen: re-renderiza)")
    meta = json.loads(seg_path.read_text(encoding="utf-8"))

    words_cache: dict[str, list[dict]] = {}
    out_words: list[dict] = []
    offset = 0.0
    for seg in meta["segments"]:
        cid, s, e, dur = seg["clip"], seg["s"], seg["e"], seg["dur"]
        if cid not in words_cache:
            words_cache[cid] = canonical_words(project, cid)
        for w in words_cache[cid]:
            if w["start"] >= s - TOL and w["end"] <= e + TOL:
                start = offset + max(w["start"] - s, 0.0)
                end = min(offset + (w["end"] - s), offset + dur)
                out_words.append({"text": w["text"],
                                  "start": round(start * 1000), "end": round(end * 1000)})
        offset += dur
    total_ms = round(offset * 1000)

    if not out_words:
        sys.exit("0 palabras mapeadas — ¿cuts.json y el render corresponden al mismo corte?")
    for a, b in zip(out_words, out_words[1:]):
        if b["start"] < a["start"]:
            sys.exit(f"mapeo no monotónico en '{a['text']}'→'{b['text']}' — no uses la salida")
    if out_words[-1]["end"] > total_ms:
        sys.exit("última palabra rebasa el master — no uses la salida")

    out_path = project / "work" / "edited-transcript.json"
    out_path.write_text(json.dumps({
        "words": out_words,
        "source": {"method": "canonical-remap", "style": meta["style"], "mode": meta["mode"],
                   "segments": len(meta["segments"]), "total_ms": total_ms},
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    n_src = sum(len(v) for v in words_cache.values())
    print(f"{len(out_words)}/{n_src} palabras mapeadas sobre {len(meta['segments'])} "
          f"segmentos -> {total_ms/1000:.2f}s de master")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
