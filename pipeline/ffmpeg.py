"""Comandos ffmpeg (sin ffprobe ni curl, como en el contenedor de n8n)."""
from __future__ import annotations

import asyncio
import shutil
from pathlib import Path

from langfuse import observe

from .config import settings
from .models import formato_de
from .utils import parse_ffmpeg_duration


class FfmpegError(RuntimeError):
    pass


async def _run(*args: str) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        settings.ffmpeg_bin, *args,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    return proc.returncode, out.decode(errors="replace"), err.decode(errors="replace")


async def _run_ok(*args: str, contexto: str) -> None:
    code, _, err = await _run("-y", "-loglevel", "error", *args)
    if code != 0:
        raise FfmpegError(f"ffmpeg falló en {contexto}: {err.strip()[-800:]}")


async def duracion(path: Path) -> float:
    """`ffmpeg -i` y parseo de `Duration:` (Medir audio / Mux listo / Concat listo)."""
    _, _, err = await _run("-i", str(path))
    d = parse_ffmpeg_duration(err)
    if d is None:
        raise FfmpegError(f"No pude medir la duración de {path}: {err[-300:]}")
    return d


def formato_de_archivo(path: Path) -> str:
    """"horizontal" o "vertical" según lo que mida el archivo (M22 · F).

    El b-roll del editor no elige formato: lo hereda del material sobre el que
    se inserta. Antes pedía 16:9 siempre, así que en un proyecto vertical Veo
    devolvía un clip apaisado para meterlo en una película de 1080x1920.
    """
    import subprocess
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", str(path)],
            capture_output=True, text=True, timeout=30)
        ancho, alto = (int(v) for v in r.stdout.strip().split("x")[:2])
    except Exception:  # noqa: BLE001 — sin medida, el de siempre
        return "horizontal"
    return "vertical" if alto > ancho else "horizontal"


async def ultimo_frame(video: Path, destino: Path) -> None:
    await _run_ok("-sseof", "-0.5", "-i", str(video), "-update", "1", "-q:v", "2", str(destino),
                  contexto=f"extraer último frame de {video.name}")


async def portada(video: Path, destino: Path, t: float = 1.0) -> None:
    """Un frame representativo (t≈1 s, 640px) — la miniatura de la obra en el hub."""
    await _run_ok("-ss", str(t), "-i", str(video), "-frames:v", "1", "-q:v", "3",
                  "-vf", "scale=640:-2", str(destino), contexto=f"portada de {video.name}")


async def descargar_imagen(url: str, destino: Path) -> None:
    """Imagen por HTTP a disco usando ffmpeg (sin curl)."""
    await _run_ok("-i", url, "-frames:v", "1", "-q:v", "2", str(destino),
                  contexto=f"descargar imagen a {destino.name}")


def mux_duracion(duracion_video: int, duracion_real: float) -> float:
    """Recorte del clip a audio + 0.3 (itsoffset) + 0.6 (cola), sin exceder el clip."""
    return min(float(duracion_video), round(duracion_real + 0.3 + 0.6, 2))


@observe(name="mux")
async def mux(video: Path, audio: Path, final: Path, last_frame: Path, t: float) -> float:
    await _run_ok(
        "-i", str(video), "-itsoffset", "0.3", "-i", str(audio),
        "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-af", "apad",
        "-t", f"{t}", "-movflags", "+faststart", str(final),
        contexto=f"mux de {final.name}",
    )
    await ultimo_frame(final, last_frame)  # frame de continuidad desde el clip ya recortado
    return await duracion(final)


@observe(name="clip_estatico")
async def clip_estatico(imagen: Path, destino: Path, segundos: int,
                        formato: str = "horizontal") -> None:
    """El clip de respaldo cuando Veo no da un video: zoom lento sobre la imagen.

    Las medidas salen del formato del proyecto (M22 · F). Estaban cableadas a
    1920x1080, así que en un proyecto vertical este respaldo metía un clip
    apaisado en medio de una película de 1080x1920 — y el concat final, que
    re-encodea, lo habría deformado o enmarcado."""
    f = formato_de(formato)
    vf = (
        f"scale={f['w']}:{f['h']}:force_original_aspect_ratio=increase,crop={f['w']}:{f['h']},"
        "zoompan=z='min(zoom+0.0006,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
        f":d=1:s={f['w_salida']}x{f['h_salida']}:fps=24,"
        "format=yuv420p"
    )
    await _run_ok(
        "-loop", "1", "-framerate", "24", "-i", str(imagen), "-t", str(segundos), "-vf", vf,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", "24", "-an",
        "-movflags", "+faststart", str(destino),
        contexto=f"clip estático {destino.name}",
    )


@observe(name="concat")
async def concat(finales: list[Path], destino: Path) -> float:
    lista = destino.with_name("lista.txt")
    lista.write_text("".join(f"file '{p.resolve().as_posix()}'\n" for p in finales), encoding="utf-8")
    # Siempre re-encode: clips recortados con -c copy (GOP abierto) y posibles clips estáticos
    await _run_ok(
        "-f", "concat", "-safe", "0", "-i", str(lista),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "24",
        "-c:a", "copy", "-movflags", "+faststart", str(destino),
        contexto="concat",
    )
    return await duracion(destino)


# --- M11: ensamblaje pista-única (narración primero) -----------------------

@observe(name="recortar_ventana")
async def recortar_video(origen: Path, destino: Path, t: float) -> None:
    """Recorta el clip al largo EXACTO de su ventana (solo video, re-encode a
    los mismos parámetros del concat: el 'tiempo extra' del clip se corta)."""
    await _run_ok(
        "-i", str(origen), "-t", f"{t:.3f}", "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "24",
        str(destino),
        contexto=f"recortar {destino.name} a {t:.2f}s",
    )


@observe(name="concat_video")
async def concat_video(partes: list[Path], destino: Path) -> None:
    """Concat SOLO video de segmentos ya re-encodeados con parámetros idénticos
    (recortar_video) → stream copy, sin recomprimir dos veces."""
    lista = destino.with_name("lista_video.txt")
    lista.write_text("".join(f"file '{p.resolve().as_posix()}'\n" for p in partes), encoding="utf-8")
    await _run_ok("-f", "concat", "-safe", "0", "-i", str(lista),
                  "-c", "copy", "-movflags", "+faststart", str(destino),
                  contexto="concat de ventanas")


@observe(name="mux_pista_unica")
async def mux_pista_unica(video: Path, audio: Path, destino: Path) -> float:
    """La película final: el video concatenado + UNA pista de audio continua
    (la narración completa). -shortest empareja el sobrante de la última ventana."""
    await _run_ok(
        "-i", str(video), "-i", str(audio),
        "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
        "-shortest", "-movflags", "+faststart", str(destino),
        contexto=f"mux pista única de {destino.name}",
    )
    return await duracion(destino)


def comprobar_ffmpeg() -> None:
    if shutil.which(settings.ffmpeg_bin) is None and not Path(settings.ffmpeg_bin).exists():
        raise RuntimeError(f"No encuentro ffmpeg en '{settings.ffmpeg_bin}' (FFMPEG_BIN)")


async def espejar(origen: str, destino: Path) -> Path:
    """Voltea horizontalmente una imagen (URL http o ruta) con ffmpeg `hflip`."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    await _run_ok("-i", str(origen), "-vf", "hflip", "-frames:v", "1", str(destino),
                  contexto=f"espejar {destino.name}")
    return destino
