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

from langfuse import get_client

from .config import settings
from .pricing import GOOGLE_NANO_BANANA, GOOGLE_VEO_LITE_720P

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
        with get_client().start_as_current_observation(
            name="nano_banana", as_type="generation", model=settings.gemini_image_model,
            input={"prompt": prompt[:500], "referencias": len(referencias)},
            metadata={"backend": "google", "intento": i + 1},
        ) as span:
            try:
                resp = client.models.generate_content(model=settings.gemini_image_model, contents=contents)
            except Exception as e:  # noqa: BLE001
                span.update(level="ERROR", status_message=str(e)[:500])
                raise
            datos = [p.inline_data.data for c in (resp.candidates or [])
                     for p in (c.content.parts or []) if getattr(p, "inline_data", None)]
            if not datos:
                span.update(level="ERROR", status_message="sin imagen en la respuesta")
                raise RuntimeError(f"Nano Banana no devolvió imagen (intento {i + 1}): "
                                   f"{getattr(resp, 'text', '')[:200]}")
            span.update(output={"bytes": len(datos[0])},
                        usage_details={"images": 1},
                        cost_details={"total": GOOGLE_NANO_BANANA})
            salidas.append(datos[0])
    return salidas


def _config_videos(segundos: int):
    """Solo duration_seconds: la Gemini API rechaza `resolution` (verificado
    2026-08-24 — 'resolution parameter is not supported in Gemini API'); veo-3.1
    lite sale a 720p por defecto, que es la tarifa registrada en pricing.json."""
    from google.genai import types
    deseados = {"duration_seconds": segundos}
    campos = set(getattr(types.GenerateVideosConfig, "model_fields", {}))
    return types.GenerateVideosConfig(**{k: v for k, v in deseados.items() if k in campos})


def generar_video(imagen: Path, prompt: str, segundos: int, negativo: str = "",
                  timeout_s: int | None = None) -> bytes:
    """Veo 3.1 image-to-video desde la imagen aprobada. Devuelve los bytes del mp4."""
    client = _client()
    from google.genai import types
    texto = f"{prompt}\nAvoid: {negativo}" if negativo else prompt
    costo = round(segundos * GOOGLE_VEO_LITE_720P, 3) if settings.veo_resolution == "720p" else None
    with get_client().start_as_current_observation(
        name="veo", as_type="generation", model=settings.gemini_veo_model,
        input={"prompt": texto[:500], "segundos": segundos, "resolution": settings.veo_resolution},
        metadata={"backend": "google"},
    ) as span:
        t0 = time.monotonic()
        try:
            try:
                op = client.models.generate_videos(
                    model=settings.gemini_veo_model,
                    prompt=texto,
                    image=types.Image(image_bytes=imagen.read_bytes(), mime_type=_mime(imagen)),
                    config=_config_videos(segundos),
                )
            except Exception as e:  # noqa: BLE001 — la API rechaza algún parámetro del config
                if "not supported" not in str(e):
                    raise
                log.warning("Veo rechazó el config (%s) — reintento sin config", e)
                op = client.models.generate_videos(
                    model=settings.gemini_veo_model,
                    prompt=texto,
                    image=types.Image(image_bytes=imagen.read_bytes(), mime_type=_mime(imagen)),
                )
            limite = time.monotonic() + (timeout_s or settings.veo_timeout_s)
            while not op.done:
                if time.monotonic() > limite:
                    raise TimeoutError(f"Veo ({settings.gemini_veo_model}) excedió {timeout_s or settings.veo_timeout_s}s")
                time.sleep(VEO_POLL_S)
                op = client.operations.get(op)
            if getattr(op, "error", None):
                raise RuntimeError(f"Veo falló: {op.error}")
            data = _extraer_video(op, client)
        except Exception as e:  # noqa: BLE001
            span.update(level="ERROR", status_message=str(e)[:500])
            raise
        span.update(output={"bytes": len(data)},
                    metadata={"segundos_reloj": round(time.monotonic() - t0, 1)},
                    usage_details={"video_seconds": segundos},
                    cost_details={"total": costo} if costo is not None else None)
        return data


def _extraer_video(op, client) -> bytes:
    """op.response puede venir tipado (generated_videos) o como dict crudo según
    la versión del SDK. El video YA está pagado a estas alturas: antes de rendirnos
    se vuelca la respuesta a disco para poder recuperarlo a mano."""
    resp = op.response
    video = None
    vids = getattr(resp, "generated_videos", None)
    if vids:
        video = vids[0].video
    elif isinstance(resp, dict):
        muestras = (resp.get("generateVideoResponse", {}).get("generatedSamples")
                    or resp.get("generatedVideos") or resp.get("generated_videos") or [])
        if muestras:
            video = muestras[0].get("video") if isinstance(muestras[0], dict) else getattr(muestras[0], "video", None)
    if video is None:
        _volcar_debug(resp)
        raise RuntimeError(f"Veo: no encontré el video en la respuesta (volcada a veo_debug.json): {str(resp)[:300]}")
    if not isinstance(video, dict):
        try:
            client.files.download(file=video)
            if video.video_bytes:
                return video.video_bytes
        except Exception as e:  # noqa: BLE001
            log.warning("files.download falló (%s) — intento por URI", e)
    uri = video.get("uri") if isinstance(video, dict) else getattr(video, "uri", None)
    if not uri:
        _volcar_debug(resp)
        raise RuntimeError("Veo: video sin bytes ni uri (respuesta volcada a veo_debug.json)")
    import urllib.request
    req = urllib.request.Request(uri, headers={"x-goog-api-key": settings.gemini_api_key})
    return urllib.request.urlopen(req, timeout=300).read()


def _volcar_debug(resp) -> None:
    import json
    import tempfile
    try:
        destino = Path(tempfile.gettempdir()) / "veo_debug.json"
        destino.write_text(json.dumps(resp, default=str)[:200000], encoding="utf-8")
        log.warning("respuesta de Veo volcada en %s", destino)
    except Exception:  # noqa: BLE001
        log.warning("no pude volcar la respuesta de Veo: %r", str(resp)[:1000])
