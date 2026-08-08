"""Subtítulos quemados desde edited-transcript.json (rama longform).

Uso:
  python tools/make_subs.py videos/video-N [--frame 12.5]        # frame de muestra (gate de estilo)
  python tools/make_subs.py videos/video-N [--mode final]        # quema el video completo
  python tools/make_subs.py videos/video-N --solo-archivos       # solo .ass + .srt, sin render

Lee P/work/edited-transcript.json ({words:[{text,start,end}]} en ms, timeline del
master) y el video base (--base, default: el master/preview más reciente de output/).
Escribe P/work/subs/subs.ass + subs.srt SIEMPRE (el .srt sirve para subir a YouTube
como subtítulos suaves), y con render: <base>-subtitulado.mp4.

El audio se copia bit a bit (jamás se toca loudness aquí); el video se recodifica
con el encoder de hwenc. La fuente debe existir EN EL SISTEMA (libass no lee
@remotion/google-fonts): default Arial; para fuente de marca, instalar su .ttf.
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

# segmentación
MAX_CHARS_LINE = 38   # tope de legibilidad en 16:9; en vertical manda el ancho real
MAX_LINES = 2
GAP_MS = 600          # pausa que cierra el subtítulo
MAX_DUR_MS = 5000     # duración máxima de un subtítulo
PAD_MS = 150          # respiro tras la última palabra (recortado al siguiente inicio)
GLYPH_W = 0.52        # ancho promedio de glifo vs fontsize (Arial y afines)


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


def segment(words: list[dict], max_chars: int = MAX_CHARS_LINE) -> list[dict]:
    """Agrupa palabras en subtítulos de 1-2 líneas, cerrando en pausas, puntuación
    fuerte, tope de caracteres o duración. Devuelve [{start,end,lines:[str,...]}]."""
    caps: list[dict] = []
    lines: list[list[dict]] = []  # líneas ya cerradas del subtítulo en curso
    cur: list[dict] = []          # línea en construcción

    def close() -> None:
        nonlocal lines, cur
        if cur:
            lines.append(cur)
        if lines:
            wds = [w for li in lines for w in li]
            caps.append({"start": wds[0]["start"], "end": wds[-1]["end"],
                         "lines": [" ".join(w["text"] for w in li) for li in lines]})
        lines, cur = [], []

    for i, w in enumerate(words):
        cur_len = len(" ".join(x["text"] for x in cur))
        if cur and cur_len + 1 + len(w["text"]) > max_chars:
            lines.append(cur)
            cur = []
            if len(lines) >= MAX_LINES:
                close()
        cur.append(w)
        cap_start = lines[0][0]["start"] if lines else cur[0]["start"]
        nxt = words[i + 1] if i + 1 < len(words) else None
        gap = (nxt["start"] - w["end"]) if nxt else GAP_MS + 1
        strong_punct = w["text"].rstrip()[-1:] in ".?!…"
        if gap >= GAP_MS or w["end"] - cap_start > MAX_DUR_MS \
                or (strong_punct and w["end"] - cap_start > 1200):
            close()
    close()

    for i, c in enumerate(caps):  # respiro sin pisar al siguiente
        limit = caps[i + 1]["start"] if i + 1 < len(caps) else c["end"] + PAD_MS
        c["end"] = min(c["end"] + PAD_MS, limit)
    return caps


def t_ass(ms: int) -> str:
    cs = round(ms / 10)
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, cs = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def t_srt(ms: int) -> str:
    h, rem = divmod(ms, 3600000)
    m, rem = divmod(rem, 60000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def hex_to_ass(rgb: str) -> str:
    """'RRGGBB' → '&H00BBGGRR' (ASS es BGR)."""
    rgb = rgb.lstrip("#")
    return f"&H00{rgb[4:6]}{rgb[2:4]}{rgb[0:2]}".upper()


def write_ass(caps: list[dict], out: Path, base: dict, args) -> None:
    size = round(args.size * base["h"] / 1080)
    margin_v = round(args.margin_v * base["h"] / 1080)
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {base['w']}
PlayResY: {base['h']}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,{args.font},{size},{hex_to_ass(args.text_color)},&H000000FF,{hex_to_ass(args.outline_color)},&H80000000,{-1 if args.bold else 0},0,0,0,100,100,0,0,1,{args.outline},1,2,60,60,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [header]
    for c in caps:
        text = "\\N".join(c["lines"])
        lines.append(f"Dialogue: 0,{t_ass(c['start'])},{t_ass(c['end'])},Sub,,0,0,0,,{text}\n")
    out.write_text("".join(lines), encoding="utf-8-sig")


def write_srt(caps: list[dict], out: Path) -> None:
    blocks = [f"{i}\n{t_srt(c['start'])} --> {t_srt(c['end'])}\n" + "\n".join(c["lines"]) + "\n"
              for i, c in enumerate(caps, 1)]
    out.write_text("\n".join(blocks), encoding="utf-8")


def newest_base(project: Path) -> Path:
    cands = [p for p in (project / "output").glob("*.mp4") if "subtitulado" not in p.stem]
    if not cands:
        sys.exit("no hay video en output/ — corre el render de /clean-cut primero, o pasa --base")
    return max(cands, key=lambda p: p.stat().st_mtime)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--base", help="video sobre el que se queman (default: el más reciente de output/)")
    ap.add_argument("--out")
    ap.add_argument("--mode", choices=["preview", "final"], default="final")
    ap.add_argument("--frame", type=float, help="solo renderiza un frame de muestra en ese segundo (gate de estilo)")
    ap.add_argument("--solo-archivos", action="store_true", help="genera .ass y .srt sin render")
    ap.add_argument("--font", default="Arial")
    ap.add_argument("--size", type=int, default=52, help="tamaño a 1080p (se escala a la resolución del base)")
    ap.add_argument("--margin-v", type=int, default=56, dest="margin_v")
    ap.add_argument("--outline", type=float, default=3.0)
    ap.add_argument("--bold", action="store_true")
    ap.add_argument("--text-color", default="FFFFFF", dest="text_color")
    ap.add_argument("--outline-color", default="14141E", dest="outline_color")
    args = ap.parse_args()

    project = ROOT / args.project
    tr_path = project / "work" / "edited-transcript.json"
    if not tr_path.is_file():
        sys.exit(f"no existe {tr_path} — /clean-cut lo produce al final de su pipeline")
    words = json.loads(tr_path.read_text(encoding="utf-8"))["words"]
    base_path = (ROOT / args.base) if args.base else newest_base(project)
    base = probe(base_path)

    # el largo de línea lo limita el ANCHO real del video (clave en vertical 9:16):
    # con fuente escalada por altura, 38 chars no caben en 1080 de ancho.
    size_px = round(args.size * base["h"] / 1080)
    usable_px = base["w"] - 2 * 60  # MarginL/R del estilo ASS
    max_chars = min(MAX_CHARS_LINE, int(usable_px / (GLYPH_W * size_px)))
    caps = segment(words, max_chars)
    subs_dir = project / "work" / "subs"
    subs_dir.mkdir(parents=True, exist_ok=True)
    ass, srt = subs_dir / "subs.ass", subs_dir / "subs.srt"
    write_ass(caps, ass, base, args)
    write_srt(caps, srt)
    print(f"{len(words)} palabras -> {len(caps)} subtítulos; escritos {ass} y {srt}")
    if args.solo_archivos:
        return

    # el filtro ass es quisquilloso con rutas Windows: correr con cwd=subs_dir
    vf = f"ass={ass.name}"
    if args.frame is not None:
        sample = subs_dir / f"muestra-{args.frame:.1f}s.png"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{args.frame:.3f}",
                        "-copyts", "-i", str(base_path), "-vf", vf, "-frames:v", "1",
                        str(sample)], check=True, cwd=subs_dir)
        print(f"frame de muestra: {sample}")
        return

    enc, hwaccel = hwenc.select(args.mode)
    out_path = ROOT / args.out if args.out else base_path.with_name(base_path.stem + "-subtitulado.mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *hwaccel, "-i", str(base_path),
                    "-vf", vf, "-map", "0:v", "-map", "0:a?", "-c:a", "copy",
                    *enc, str(out_path)], check=True, cwd=subs_dir)

    v_dur, a_dur = stream_duration(out_path, "v:0"), stream_duration(out_path, "a:0")
    ok = abs(v_dur - base["dur"]) <= DRIFT_TOL_S and abs(v_dur - a_dur) <= DRIFT_TOL_S
    print(f"verify: v={v_dur:.2f}s a={a_dur:.2f}s base={base['dur']:.2f}s {'OK' if ok else 'FALLÓ'}")
    if not ok:
        sys.exit("la salida no pasó el gate de duración — no la uses")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
