"""Incorporar metraje al proyecto (F3.5 caso B — panel Importar del editor).

Toma MP4s sueltos de videos/ (dejados ahí por el cuadro ＋ del editor), y por
cada uno: lo mueve al proyecto, lo transcribe UNA vez (backend según
.video-stack/config.json vía normalizers/asr_backend — sin config es
faster-whisper local con fallback CUDA→CPU, $0), escribe su canónico
(docs/SCHEMA.md, tiempos relativos a SU fuente — regla dura del contrato) y lo
agrega a cuts.json como clip keep-all. Al final regenera el proxy del editor.

Uso: python tools/agregar_video.py videos/<proyecto> archivo1.mp4 [archivo2 ...]
     (rutas de archivo relativas a videos/ o absolutas)
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
from asr_backend import crear_transcriptor  # noqa: E402
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
            # los sueltos viven en la raíz videos/ que contiene al proyecto
            p = (proj.parent / a).resolve()
        if not p.is_file():
            sys.exit(f"no existe: {p}")
        rutas.append(p)

    # A2: el backend sale de .video-stack/config.json (local | assemblyai);
    # sin config = faster-whisper local con --model/--device, como siempre.
    transcribe_fn, backend, modelo = crear_transcriptor(args.model, args.device)
    print(f"transcripción: {backend} ({modelo})", flush=True)

    usados = set(cuts["clip_order"])
    for ruta in rutas:
        sid = source_id_para(ruta.name, usados)
        usados.add(sid)
        destino = proj / f"{sid}.mp4"
        print(f"→ {ruta.name} como clip '{sid}'", flush=True)
        shutil.move(str(ruta), destino)
        dur = duracion_de(destino)

        print(f"  transcribiendo ({dur:.0f}s de audio)…", flush=True)
        words = transcribe_fn(destino)
        doc = build_canonical(source_id=sid, duration=dur, language="es",
                              backend=backend, model=modelo,
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
    subprocess.run([sys.executable, str(ROOT / "tools" / "make_proxy.py"), str(proj)],
                   check=True, cwd=str(ROOT))
    print(f"✓ listo: {len(rutas)} clip(s) incorporados a {proj.name}", flush=True)


if __name__ == "__main__":
    main()
