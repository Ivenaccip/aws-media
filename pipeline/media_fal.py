"""Backend fal para imagen (Grok) y video (Veo 3.1 lite) FUERA del
pipeline principal de escenas: el popup g1/g2 del editor y las opciones de
personaje de M1. Elegido con GEN_BACKEND=fal (default desde 2026-09-03: los
créditos del Studio de Google se agotaron; media_google queda como alternativa).

Los costes los registra pipeline.fal en cada llamada (pricing.py → Langfuse).
"""
from __future__ import annotations

from pathlib import Path

from . import fal
from .config import settings
from .models import formato_de


async def imagen_fal(prompt: str, destino: Path, referencia: Path | None = None,
                     meta: dict | None = None, aspecto: str | None = None) -> str:
    """Una imagen en fal — texto puro, o edición si hay referencia. Descarga a
    `destino` y devuelve la URL en fal (aguas abajo el pipeline referencia por
    URL).

    **Sin referencia va al modelo de crear y con referencia al de editar, y eso
    no es un detalle de estilo.** El de editar define su encuadre como «el de la
    primera imagen de entrada»: sin imagen de entrada no tiene encuadre que
    copiar. Y quien más lo sufriría es el camino que menos se ve — las dos
    opciones de personaje sin referencia, que atrapan toda excepción y devuelven
    None (pipeline/character.py), dejando el proyecto varado sin opciones y sin
    error a la vista.

    `aspecto` es el que pide la herramienta de imágenes (M23). Cuando no llega
    se manda "1:1" explícito: es lo que M1 y el b-roll han visto siempre, pero
    por el valor por defecto del modelo y no por decisión de nadie. Escrito, deja
    de depender de con qué modelo estemos hoy.
    """
    args: dict = {"prompt": prompt, "num_images": 1,
                  "aspect_ratio": aspecto or "1:1"}
    app = settings.fal_imagen
    if referencia is not None:
        app = settings.fal_imagen_edit
        args["image_urls"] = [await fal.subir_archivo(referencia)]
    res = await fal.llamar(app, args, timeout_s=settings.grok_timeout_s,
                           nombre="imagen", meta=meta or {})
    url = ((res.get("images") or [{}])[0]).get("url")
    if not url:
        raise RuntimeError("El modelo de imagen no devolvió imagen")
    await fal.descargar(url, destino)
    return url


async def imagen_pincel(prompt: str, imagen: Path, marcada: Path, destino: Path,
                        meta: dict | None = None) -> str:
    """«Editor de imágenes» del sidebar (decisión del usuario 2026-09-08: el
    resultado de Flux Fill no convenció). Recibe la imagen original y una
    copia con la zona a cambiar resaltada (la pinta el front); la instrucción
    le pide tocar SOLO esa zona. Descarga a `destino`.

    **Aquí no hay máscara y nunca la hubo**: ningún endpoint de los que usa
    el repo acepta una. Que se respete la zona es una propiedad del modelo,
    no del código, así que cambiar de modelo obliga a volver a comprobarlo.
    Con Grok se comprobó el 2026-09-18: fuera de la zona marcada la imagen
    cambia 3.5 sobre 255 de media, que es ruido de recompresión."""
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
    res = await fal.llamar(settings.fal_imagen_edit, args, timeout_s=settings.grok_timeout_s,
                           nombre="imagen_pincel", meta=meta or {})
    url = ((res.get("images") or [{}])[0]).get("url")
    if not url:
        raise RuntimeError("El modelo de imagen no devolvió imagen")
    await fal.descargar(url, destino)
    return url


async def imagen_transformar(prompt: str, imagen: Path, destino: Path,
                             meta: dict | None = None) -> str:
    """El otro modo del editor: cambiar la imagen ENTERA, sin zona pintada.

    `imagen_pincel` le ordena al modelo «keep every other part pixel-identical»,
    y esa frase es exactamente lo que impedía lo que pedían los testers: subían
    un boceto, escribían «pásalo a acuarela» y recibían el mismo boceto con un
    retoque local. No es que el modelo no supiera cambiar de estilo — se lo
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
    res = await fal.llamar(settings.fal_imagen_edit, args, timeout_s=settings.grok_timeout_s,
                           nombre="imagen_transformar", meta=meta or {})
    url = ((res.get("images") or [{}])[0]).get("url")
    if not url:
        raise RuntimeError("El modelo de imagen no devolvió imagen")
    await fal.descargar(url, destino)
    return url


async def video_veo(imagen: Path, prompt: str, segundos: int, destino: Path,
                    negativo: str = "", meta: dict | None = None,
                    formato: str | None = None) -> None:
    """Veo 3.1 lite image-to-video en fal (720p sin audio — la tarifa del popup;
    el audio original manda en el mux). Descarga el mp4 a `destino`.

    Sin `formato`, lo deduce de la imagen de entrada: el b-roll del editor no
    elige aspecto, lo hereda del material (M22 · F). Estaba clavado en 16:9,
    así que sobre un video vertical devolvía un clip apaisado."""
    from .ffmpeg import formato_de_archivo
    args = {
        "prompt": prompt,
        "image_url": await fal.subir_archivo(imagen),
        "aspect_ratio": formato_de(formato or formato_de_archivo(imagen))["aspecto"],
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
