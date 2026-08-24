"""Backend Google (Gemini API) para el popup g1/g2: Nano Banana (imagen base) +
Veo 3.1 image-to-video. Elegido con GEN_BACKEND=google (PLAN-FUSION.md F2.3).

El audio que Veo genera se descarta siempre — la narración TTS original manda
(overlays.mux_reemplazo). Precios en tools/pricing.json → pipeline/pricing.py.
"""
from __future__ import annotations

import logging
import mimetypes
import time
from pathlib import Path

from .config import settings

log = logging.getLogger("media_google")

VEO_POLL_S = 10


def _client():
    from google import genai
    if not settings.gemini_api_key:
        raise RuntimeError("Falta GEMINI_API_KEY en el .env (backend google)")
    return genai.Client(api_key=settings.gemini_api_key)


def _mime(path: Path) -> str:
    return mimetypes.guess_type(path.name)[0] or "image/jpeg"


def generar_imagenes(prompt: str, referencias: list[Path], n: int = 2) -> list[bytes]:
    """n opciones de imagen base con Nano Banana (una llamada por imagen — el
    modelo devuelve una por request). Las referencias anclan personaje y estilo."""
    from google.genai import types
    client = _client()
    contents: list = [prompt]
    for ref in referencias:
        contents.append(types.Part.from_bytes(data=ref.read_bytes(), mime_type=_mime(ref)))
    salidas: list[bytes] = []
    for i in range(n):
        resp = client.models.generate_content(model=settings.gemini_image_model, contents=contents)
        datos = [p.inline_data.data for c in (resp.candidates or [])
                 for p in (c.content.parts or []) if getattr(p, "inline_data", None)]
        if not datos:
            raise RuntimeError(f"Nano Banana no devolvió imagen (intento {i + 1}): "
                               f"{getattr(resp, 'text', '')[:200]}")
        salidas.append(datos[0])
    return salidas


def _config_videos(segundos: int):
    """GenerateVideosConfig filtrando por los campos que soporte la versión
    instalada del SDK (google-genai fija duration/resolution según release)."""
    from google.genai import types
    deseados = {"duration_seconds": segundos, "resolution": settings.veo_resolution,
                "number_of_videos": 1}
    campos = set(getattr(types.GenerateVideosConfig, "model_fields", {}))
    return types.GenerateVideosConfig(**{k: v for k, v in deseados.items() if k in campos})


def generar_video(imagen: Path, prompt: str, segundos: int, negativo: str = "",
                  timeout_s: int | None = None) -> bytes:
    """Veo 3.1 image-to-video desde la imagen aprobada. Devuelve los bytes del mp4."""
    client = _client()
    from google.genai import types
    texto = f"{prompt}\nAvoid: {negativo}" if negativo else prompt
    op = client.models.generate_videos(
        model=settings.gemini_veo_model,
        prompt=texto,
        image=types.Image(image_bytes=imagen.read_bytes(), mime_type=_mime(imagen)),
        config=_config_videos(segundos),
    )
    limite = time.monotonic() + (timeout_s or settings.veo_timeout_s)
    while not op.done:
        if time.monotonic() > limite:
            raise TimeoutError(f"Veo ({settings.gemini_veo_model}) excedió {timeout_s or settings.veo_timeout_s}s")
        time.sleep(VEO_POLL_S)
        op = client.operations.get(op)
    if getattr(op, "error", None):
        raise RuntimeError(f"Veo falló: {op.error}")
    videos = op.response.generated_videos or []
    if not videos:
        raise RuntimeError("Veo terminó sin videos en la respuesta")
    video = videos[0].video
    client.files.download(file=video)
    if not video.video_bytes:
        raise RuntimeError("Veo no entregó bytes del video")
    return video.video_bytes
