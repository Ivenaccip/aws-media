"""Inserta clips de b-roll sobre un video base, en ventanas del timeline master.

Uso:
  python tools/insert_broll.py videos/video-N/work/broll/broll-plan.json --print
  python tools/insert_broll.py videos/video-N/work/broll/broll-plan.json [--mode preview|final] [--out RUTA]

El plan (broll-plan.json) es la fuente de verdad — mismo patrón que sfx-plan.json:
ventanas en ms sobre el MISMO reloj que edited-transcript.json. El b-roll cubre el
cuadro completo (scale + crop a la resolución del base) mientras la narración sigue.

El audio del base se COPIA bit a bit (-c:a copy): aquí jamás se recodifica ni
normaliza — regla de loudness del repo. Solo el video se recodifica, con el
encoder de hwenc (NVENC → Quick Sync → AMF → CPU).

Al final verifica solo (v:0 == a:0 == duración del base) y escribe un still del
punto medio de cada inserción en <plan_dir>/verify/ para el ojo humano.
"""

import argparse
import json
import subprocess
import sys
from fractions import Fraction
from pathlib import Path

import hwenc

ROOT = Path(__file__).resolve().parent.parent
DRIFT_TOL_S = 0.15


def probe(path: Path) -> dict:
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                        "-show_entries", "stream=width,height,avg_frame_rate:format=duration",
                        "-of", "json", str(path)], capture_output=True, text=True, check=True)
    d = json.loads(r.stdout)
    st = d["streams"][0]
    return {"w": st["width"], "h": st["height"],
            "fps": float(Fraction(st["avg_frame_rate"])),
            "dur": float(d["format"]["duration"])}


def stream_duration(path: Path, stream: str) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", stream,
                        "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


def load_plan(plan_path: Path) -> tuple[dict, list[dict]]:
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    moments = sorted(plan["moments"], key=lambda m: m["start_ms"])
    prev_end = -1
    for m in moments:
        if m["start_ms"] < prev_end:
            sys.exit(f"plan inválido: la ventana de '{m['id']}' se encima con la anterior")
        if m["end_ms"] <= m["start_ms"]:
            sys.exit(f"plan inválido: '{m['id']}' tiene end_ms <= start_ms")
        prev_end = m["end_ms"]
    return plan, moments


def resolve_windows(moments: list[dict], base_dur: float) -> list[dict]:
    """Ventana efectiva por momento: recortada a la duración real del clip (si el
    clip es más corto, la ventana se ACORTA — nunca congelamos el último frame)."""
    rows = []
    for m in moments:
        clip = ROOT / m["clip"]
        if not clip.is_file():
            sys.exit(f"'{m['id']}': no existe el clip {m['clip']} — ¿falta generar?")
        clip_dur = probe(clip)["dur"]
        start = m["start_ms"] / 1000
        want = m["end_ms"] / 1000 - start
        dur = min(want, clip_dur)
        if dur < want - 0.05:
            print(f"  aviso '{m['id']}': clip de {clip_dur:.2f}s < ventana de {want:.2f}s — "
                  f"la ventana se acorta a {dur:.2f}s")
        if start + dur > base_dur:
            sys.exit(f"'{m['id']}': la ventana termina en {start + dur:.2f}s pero el base "
                     f"dura {base_dur:.2f}s")
        rows.append({**m, "clip_path": clip, "start_s": start, "dur_s": dur})
    return rows


def print_sheet(rows: list[dict]) -> None:
    print(f"{'id':6} {'ventana':>17} {'dur':>6}  {'clip':40} cita")
    for r in rows:
        win = f"{r['start_s']:7.2f}-{r['start_s'] + r['dur_s']:7.2f}s"
        print(f"{r['id']:6} {win:>17} {r['dur_s']:5.2f}s  {r['clip']:40} \"{r.get('quote', '')[:50]}\"")


def build_filter(rows: list[dict], base: dict) -> str:
    parts, last = [], "0:v"
    for i, r in enumerate(rows, start=1):
        s, e = r["start_s"], r["start_s"] + r["dur_s"]
        parts.append(
            f"[{i}:v]trim=duration={r['dur_s']:.3f},fps={base['fps']:.6f},"
            f"scale={base['w']}:{base['h']}:force_original_aspect_ratio=increase,"
            f"crop={base['w']}:{base['h']},setpts=PTS-STARTPTS+{s:.3f}/TB[b{i}]")
        out = f"v{i}"
        parts.append(f"[{last}][b{i}]overlay=eof_action=pass:"
                     f"enable='between(t,{s:.3f},{e:.3f})'[{out}]")
        last = out
    return ";".join(parts), last


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("plan")
    ap.add_argument("--print", action="store_true", dest="print_only",
                    help="imprime la hoja de inserciones (artefacto de auditoría) y sale")
    ap.add_argument("--mode", choices=["preview", "final"], default="final")
    ap.add_argument("--out", help="override de plan.out")
    args = ap.parse_args()

    plan_path = Path(args.plan).resolve()
    plan, moments = load_plan(plan_path)
    base_path = ROOT / plan["base"]
    if not base_path.is_file():
        sys.exit(f"no existe el video base: {plan['base']}")
    base = probe(base_path)
    rows = resolve_windows(moments, base["dur"])

    print(f"base: {plan['base']} — {base['w']}x{base['h']} @ {base['fps']:.3f}fps, "
          f"{base['dur']:.1f}s; {len(rows)} inserciones")
    print_sheet(rows)
    if args.print_only:
        return

    out_path = ROOT / (args.out or plan["out"])
    out_path.parent.mkdir(parents=True, exist_ok=True)
    enc, hwaccel = hwenc.select(args.mode)
    graph, last = build_filter(rows, base)

    cmd = ["ffmpeg", "-y", "-loglevel", "error", *hwaccel, "-i", str(base_path)]
    for r in rows:
        cmd += ["-i", str(r["clip_path"])]
    cmd += ["-filter_complex", graph, "-map", f"[{last}]", "-map", "0:a?",
            "-c:a", "copy", *enc, str(out_path)]
    subprocess.run(cmd, check=True)

    # gate: misma duración que el base, y v:0 == a:0
    v_dur = stream_duration(out_path, "v:0")
    a_dur = stream_duration(out_path, "a:0")
    drift_base = abs(v_dur - base["dur"])
    drift_av = abs(v_dur - a_dur)
    ok = drift_base <= DRIFT_TOL_S and drift_av <= DRIFT_TOL_S
    print(f"verify: out v={v_dur:.2f}s a={a_dur:.2f}s base={base['dur']:.2f}s "
          f"(drift base {drift_base * 1000:.0f}ms, a/v {drift_av * 1000:.0f}ms) "
          f"{'OK' if ok else 'FALLÓ'}")

    # stills del punto medio de cada inserción, para el ojo humano
    verify_dir = plan_path.parent / "verify"
    verify_dir.mkdir(exist_ok=True)
    for r in rows:
        mid = r["start_s"] + r["dur_s"] / 2
        still = verify_dir / f"{r['id']}.jpg"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{mid:.3f}",
                        "-i", str(out_path), "-frames:v", "1", str(still)], check=True)
    print(f"stills de verificación en {verify_dir}")

    if not ok:
        sys.exit("la salida no pasó el gate de duración — no la uses; revisa el plan")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
