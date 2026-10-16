"""Build the editor's 720p proxy of the RAW footage (all clips concatenated),
plus a timeline waveform image and a manifest with clip offsets.

Usage: python tools/make_proxy.py video-1
Writes: <project>/work/editor/proxy.mp4, waveform.png, manifest.json

E2 (unir videos): el proxy es solo para auditar, así que SIEMPRE normaliza cada
parte al mismo tamaño (1280x720, o 720x1280 si el primer clip es vertical; con
barras si el aspecto no coincide), a 30 fps y con audio AAC 48 kHz estéreo —
`concat -c copy` solo acepta partes idénticas. Un clip SIN pista de audio recibe
silencio de la duración de su video. El fps de salida no afecta los cortes: el
editor trabaja en segundos y `render_cuts.py` corta sobre el metraje original.
"""

import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import hwenc

FPS = 30   # el proxy es solo para auditar: todas las partes a la misma cadencia
SR = 48000


def _segundos(valor: object) -> float | None:
    """Una duración de ffprobe como número, o None si no hay ("N/A" llega como ausente) o no sirve."""
    try:
        n = float(valor)
    except (TypeError, ValueError):
        return None
    return n if 0 < n < float("inf") else None


def duracion_de_parte(dur: float) -> float:
    """Lo que dura el video de una parte DESPUÉS de `fps=30`: un número entero de cuadros. La duración
    del flujo de la fuente rara vez cae en la cuadrícula (un teléfono a 29,97 fps da 10,010 s y salen
    300 cuadros = 10,000 s): cortar el audio en la duración cruda lo deja hasta un cuadro más largo
    que el video y ese sobrante se suma al empalme."""
    return max(1, round(dur * FPS)) / FPS


def probar(src: Path) -> dict:
    """Ancho/alto de lo que SE VE (con la rotación del teléfono aplicada), si trae pista de audio y
    la duración del video (`dur`): la del FLUJO de video y, si el contenedor no la declara (Matroska/WebM
    dan `N/A`), la del contenedor. None solo si no hay ninguna."""
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration:stream=codec_type,width,height,duration:stream_side_data=rotation",
         "-of", "json", str(src)],
        capture_output=True, text=True, check=True)
    j = json.loads(r.stdout)
    ss = j["streams"]
    v = next(s for s in ss if s["codec_type"] == "video")
    gira = abs(int((v.get("side_data_list") or [{}])[0].get("rotation", 0))) % 180 == 90
    w, h = (v["height"], v["width"]) if gira else (v["width"], v["height"])
    dur = _segundos(v.get("duration"))
    if dur is None:
        dur = _segundos((j.get("format") or {}).get("duration"))
    return {"w": w, "h": h, "audio": any(s["codec_type"] == "audio" for s in ss), "dur": dur}


def tamano_objetivo(primero: dict) -> tuple[int, int]:
    """La orientación del primer clip manda (el servidor ya rechazó mezclar horizontales con verticales)."""
    return (720, 1280) if primero["h"] > primero["w"] else (1280, 720)


def filtro_normalizado(w: int, h: int) -> str:
    """El `-vf` de una parte normalizada. `render_cuts.py --mode preview` usa el MISMO."""
    return (f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps={FPS},format=yuv420p")


def encode_part(src: Path, out: Path, enc: list[str], hwaccel: list[str], w: int, h: int) -> None:
    """Una parte normalizada: mismo tamaño (con barras si el aspecto no coincide), mismos fps y audio 48 kHz estéreo.
    Sin pista de audio se mete silencio de la duración del video (antes `-map 0:1` reventaba con exit 234).

    El audio se rellena (`apad`, o `anullsrc`) y se CORTA donde termina el video con `-t <duración del
    video de la parte, en cuadros enteros a 30 fps>`. `-shortest` no sirve para eso con ffmpeg 5.1 (la
    imagen de producción y de la CI): deja que el relleno sobrepase al video de cada parte entre 16 y
    100 ms, y `concat -c copy` suma ese sobrante a cada empalme (aire muerto, empalmes fuera de la
    cuadrícula de 30 fps, manifiesto más largo que el video). Un contenedor que no declara la duración
    del flujo (Matroska/WebM) usa la del contenedor, que con 5.1 también deja la parte a ~3 ms (con
    `-shortest` quedaban ~77 ms de más); `-shortest` es solo el último recurso, sin ninguna duración."""
    info = probar(src)
    limite = ["-t", f"{duracion_de_parte(info['dur']):.6f}"] if info.get("dur") else ["-shortest"]
    cmd = ["ffmpeg", "-y", "-loglevel", "error", *hwaccel, "-i", str(src)]
    if info["audio"]:
        cmd += ["-map", "0:v:0", "-map", "0:a:0", "-af", f"aresample={SR}:async=1,apad", *limite]
    else:
        cmd += ["-f", "lavfi", "-i", f"anullsrc=r={SR}:cl=stereo", "-map", "0:v:0", "-map", "1:a:0", *limite]
    cmd += ["-vf", filtro_normalizado(w, h), *enc, "-c:a", "aac", "-b:a", "160k",
            "-ar", str(SR), "-ac", "2", str(out)]
    subprocess.run(cmd, check=True)


def duration_of(path: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(r.stdout.strip())


def main() -> None:
    project = Path(__file__).resolve().parent.parent / sys.argv[1]
    data = json.loads((project / "work" / "analysis" / "cuts.json").read_text(encoding="utf-8"))
    out_dir = project / "work" / "editor"
    out_dir.mkdir(parents=True, exist_ok=True)

    by_id = {c["id"]: c for c in data["clips"]}
    parts = [(cid, project / by_id[cid]["file"], out_dir / f"part-{cid}.mp4") for cid in data["clip_order"]]

    enc, hwaccel = hwenc.select("preview")
    w, h = tamano_objetivo(probar(parts[0][1]))
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda p: encode_part(p[1], p[2], enc, hwaccel, w, h), parts))
    print("parts encoded")

    list_file = out_dir / "list.txt"
    list_file.write_text("\n".join(f"file '{p[2].as_posix()}'" for p in parts), encoding="utf-8")
    proxy = out_dir / "proxy.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
                    "-i", str(list_file), "-c", "copy", str(proxy)], check=True)

    offset, manifest = 0.0, []
    for cid, _, part in parts:
        d = duration_of(part)
        manifest.append({"id": cid, "offset": round(offset, 3), "duration": round(d, 3)})
        offset += d
    (out_dir / "manifest.json").write_text(
        json.dumps({"parts": manifest, "total": round(offset, 3)}, indent=1), encoding="utf-8")

    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(proxy), "-filter_complex",
         "aformat=channel_layouts=mono,showwavespic=s=8192x140:colors=#5b8dd6",
         "-frames:v", "1", str(out_dir / "waveform.png")],
        check=True,
    )
    print(f"proxy ready: {proxy} ({offset:.0f}s)")


if __name__ == "__main__":
    main()
