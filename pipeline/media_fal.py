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


async def imagen_pincel(prompt: str, imagen: Path, marcada: Path, destino: Path,
                        meta: dict | None = None) -> str:
    """«Editor de imágenes» del sidebar con Nano Banana edit (decisión del
    usuario 2026-09-08: el resultado de Flux Fill no convenció). Recibe la
    imagen original y una copia con la zona a cambiar resaltada en rosa (la
    pinta el front); la instrucción le pide tocar SOLO esa zona. Descarga a
    `destino`."""
    instruccion = (
        "You get two images: the FIRST is the original photo, the SECOND is the same "
        "photo with a pink highlight marking the only region to edit. Apply this change "
        f"to the highlighted region: {prompt}. Keep every other part of the original "
        "pixel-identical. Return the full edited image with no pink marking, no text, "
        "no watermark.")
    args = {
        "prompt": instruccion,
        "image_urls": [await fal.subir_archivo(imagen), await fal.subir_archivo(marcada)],
        "num_images": 1,
    }
    res = await fal.llamar(settings.fal_nano_edit, args, timeout_s=settings.grok_timeout_s,
                           nombre="nano_banana_pincel", meta=meta or {})
    url = ((res.get("images") or [{}])[0]).get("url")
    if not url:
        raise RuntimeError("Nano Banana (fal) no devolvió imagen")
    await fal.descargar(url, destino)
    return url


async def imagen_transformar(prompt: str, imagen: Path, destino: Path,
                             meta: dict | None = None) -> str:
    """El otro modo del editor: cambiar la imagen ENTERA, sin zona pintada.

    `imagen_pincel` le ordena al modelo «keep every other part pixel-identical»,
    y esa frase es exactamente lo que impedía lo que pedían los testers: subían
    un boceto, escribían «pásalo a acuarela» y recibían el mismo boceto con un
    retoque local. No es que Nano Banana no supiera cambiar de estilo — se lo
    estábamos prohibiendo, y encima el endpoint exigía pintar una zona.

    Aquí la instrucción dice lo contrario: aplica el cambio a toda la imagen.
    Lo que se conserva es el CONTENIDO (sujeto, composición, encuadre), que es
    lo que hace que siga siendo su boceto y no un dibujo nuevo.
    """
    instruccion = (
        "Transform the whole image as follows: "
        f"{prompt}. "
        "Apply the change across the ENTIRE picture, not to one region. Keep "
        "the same subject, composition and framing as the original — this is a "
        "transformation of this image, not a new one. Return the full image "
        "with no text and no watermark.")
    args = {
        "prompt": instruccion,
        "image_urls": [await fal.subir_archivo(imagen)],
        "num_images": 1,
    }
    res = await fal.llamar(settings.fal_nano_edit, args, timeout_s=settings.grok_timeout_s,
                           nombre="nano_banana_transformar", meta=meta or {})
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
