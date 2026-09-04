"""Backend fal para imagen (Nano Banana) y video (Veo 3.1 lite) FUERA del
pipeline principal de escenas: el popup g1/g2 del editor y las opciones de
personaje de M1. Elegido con GEN_BACKEND=fal (default desde 2026-09-03: los
créditos del Studio de Google se agotaron; media_google queda como alternativa).

Los costes los registra pipeline.fal en cada llamada (pricing.py → Langfuse).
"""
from __future__ import annotations

from pathlib import Path

from . import fal
from .config import settings


async def imagen_nano(prompt: str, destino: Path, referencia: Path | None = None,
                      meta: dict | None = None) -> str:
    """Una imagen con Nano Banana en fal — texto puro, o edit si hay referencia.
    Descarga a `destino` y devuelve la URL en fal (aguas abajo el pipeline
    referencia por URL)."""
    args: dict = {"prompt": prompt, "num_images": 1}
    app = settings.fal_nano
    if referencia is not None:
        app = settings.fal_nano_edit
        args["image_urls"] = [await fal.subir_archivo(referencia)]
    res = await fal.llamar(app, args, timeout_s=settings.grok_timeout_s,
                           nombre="nano_banana", meta=meta or {})
    url = ((res.get("images") or [{}])[0]).get("url")
    if not url:
        raise RuntimeError("Nano Banana (fal) no devolvió imagen")
    await fal.descargar(url, destino)
    return url


async def video_veo(imagen: Path, prompt: str, segundos: int, destino: Path,
                    negativo: str = "", meta: dict | None = None) -> None:
    """Veo 3.1 lite image-to-video en fal (720p sin audio — la tarifa del popup;
    el audio original manda en el mux). Descarga el mp4 a `destino`."""
    args = {
        "prompt": prompt,
        "image_url": await fal.subir_archivo(imagen),
        "aspect_ratio": "16:9",
        "duration": f"{segundos}s",
        "resolution": "720p",
        "generate_audio": False,
        "safety_tolerance": "6",
    }
    if negativo:
        args["negative_prompt"] = negativo
    res = await fal.llamar(settings.fal_veo, args, timeout_s=settings.veo_timeout_s,
                           nombre="veo", meta=meta or {})
    url = (res.get("video") or {}).get("url")
    if not url:
        raise RuntimeError("Veo (fal) no devolvió video")
    await fal.descargar(url, destino)
