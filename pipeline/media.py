"""Imagen de inicio (Grok / frame previo) y video (Veo / clip estático) por escena."""
from __future__ import annotations

import base64
import logging
import shutil
from pathlib import Path

from langfuse import get_client, observe

from . import fal, ffmpeg
from .config import settings
from .models import Casting, Scene, formato_de
from .qc import prompt_con_correccion, qc_imagen
from .scenes import VEO_NEGATIVE, prompt_veo, resolver_referencias
from .styles import Estilo

log = logging.getLogger(__name__)


def _frame_previo_data_uri(path: Path | None) -> str | None:
    if path and path.exists():
        return "data:image/jpeg;base64," + base64.b64encode(path.read_bytes()).decode()
    return None


@observe(name="imagen_inicio")
async def imagen_inicio(e: Scene, ctx: Casting, estilo_url: str | None, prev_frame: Path | None,
                        estilo: Estilo | None = None) -> Scene:
    prev_data = _frame_previo_data_uri(prev_frame)
    e = resolver_referencias(e, ctx, estilo_url, hay_prev=prev_data is not None, estilo=estilo)

    if e.modo_inicio == "continua":
        return e.model_copy(update={"start_image_url": prev_data, "start_image_origen": "frame_previo"})

    # corte → Grok solo desde biblioteca, con QC de orientación antes de Veo
    url, qc_estado, qc_motivo = await _grok_con_qc(e, estilo_url)
    if url:
        return e.model_copy(update={
            "start_image_url": url, "start_image_origen": "grok", "qc": qc_estado, "qc_motivo": qc_motivo,
        })
    if prev_data:  # Fallback: frame previo
        return e.model_copy(update={
            "start_image_url": prev_data, "start_image_origen": "frame_previo_fallback", "modo_inicio": "continua",
        })
    raise RuntimeError(f"Escena {e.id}: Grok no generó imagen y no hay frame previo para usar de respaldo.")


async def _grok(e: Scene, prompt: str, intento: int, image_urls: list[str] | None = None) -> str | None:
    try:
        res = await fal.llamar(
            settings.fal_imagen_edit,
            {"prompt": prompt, "image_urls": image_urls or e.image_urls,
             "aspect_ratio": formato_de(e.formato)["aspecto"]},
            timeout_s=settings.grok_timeout_s, nombre="grok",
            meta={"escena": e.id, "intento": intento, "refs_espejadas": image_urls is not None},
        )
        return ((res.get("images") or [{}])[0]).get("url")
    except fal.FalError as err:
        log.warning("Grok falló en %s (intento %d): %s", e.id, intento, err)
        return None


async def _referencias_espejadas(e: Scene, estilo_url: str | None) -> list[str]:
    """Misma lista que e.image_urls, con las referencias de personaje volteadas (hflip) y subidas a fal.
    La referencia de estilo no se toca."""
    out = []
    for i, url in enumerate(e.image_urls):
        if url == estilo_url:
            out.append(url)
            continue
        destino = e.start_image_path.parent / "refs" / f"espejo_{e.id}_{i}.png"
        try:
            await ffmpeg.espejar(url, destino)
            out.append(await fal.subir_archivo(destino))
        except Exception as err:  # noqa: BLE001 — si no se puede espejar, se usa la original
            log.warning("No pude espejar la referencia %s: %s", url, err)
            out.append(url)
    return out


async def _grok_con_qc(e: Scene, estilo_url: str | None) -> tuple[str | None, str, str | None]:
    """Grok → QC de visión → (si falla) Grok con corrección → QC. Devuelve (url, estado_qc, motivo)."""
    url = await _grok(e, e.prompt_imagen, 1)
    if not url:
        return None, "omitido", None
    if not settings.qc_enabled:
        return url, "omitido", None

    veredicto = await qc_imagen(e, url, 1)
    if veredicto.ok:
        return url, "ok", veredicto.motivo
    log.warning("QC escena %s: %s → regenerando con corrección", e.id, veredicto.motivo)

    # Grok copia la pose de la referencia del personaje (p. ej. oso de perfil mirando a la izquierda) y el
    # texto no basta para vencerla → en el reintento se le pasan las referencias de personaje ESPEJADAS.
    refs = await _referencias_espejadas(e, estilo_url)
    for intento in range(2, settings.qc_max_retries + 2):
        nueva = await _grok(e, prompt_con_correccion(e.prompt_imagen, veredicto.correccion), intento, refs)
        if not nueva:
            break
        url = nueva
        veredicto = await qc_imagen(e, url, intento)
        if veredicto.ok:
            return url, "corregido", veredicto.motivo
    # Se agotan los reintentos: seguimos con la última imagen y avisamos
    return url, "fallido", veredicto.motivo


async def _veo(e: Scene, intento: int) -> str | None:
    try:
        res = await fal.llamar(
            settings.fal_veo,
            {
                "prompt": prompt_veo(e),
                "negative_prompt": e.veo_negativo or VEO_NEGATIVE,
                "image_url": e.start_image_url,
                "aspect_ratio": formato_de(e.formato)["aspecto"],
                "duration": f"{e.duracion_video}s",
                "resolution": "720p",
                "generate_audio": False,
                "safety_tolerance": "6",
            },
            timeout_s=settings.veo_timeout_s, nombre="veo", meta={"escena": e.id, "intento": intento},
        )
        return (res.get("video") or {}).get("url")
    except fal.FalError as err:
        log.warning("Veo falló en %s (intento %d): %s", e.id, intento, err)
        return None


@observe(name="regenerar_imagen")
async def regenerar_imagen(e: Scene, prompt: str | None = None) -> Scene:
    """M22 · G — el botón «otra distinta» de la pantalla de aprobación.

    Una llamada a Grok con el mismo prompt (o con el que escribió el usuario) y
    a disco. SIN QC a propósito: el QC de visión existe para no gastar en Veo
    sobre una imagen mal encuadrada, y aquí el que está juzgando el encuadre es
    el usuario, que la tiene delante. Correrlo sería pagar un juez de más.
    """
    prompt = (prompt or "").strip() or e.prompt_imagen
    url = await _grok(e, prompt, 1)
    if not url:
        raise RuntimeError("El generador de imágenes no devolvió nada. Vuelve a intentarlo.")
    await ffmpeg.descargar_imagen(url, e.start_image_path)
    return e.model_copy(update={
        "start_image_url": url, "start_image_origen": "grok", "prompt_imagen": prompt,
        "qc": "omitido", "qc_motivo": None, "imagen_fija": True,
    })


@observe(name="imagen_fija")
async def reponer_imagen_fija(e: Scene) -> Scene:
    """M22 · G — la imagen que el usuario ya aprobó no se regenera: se re-sube.

    Entre aprobar y animar pueden pasar días, y la URL con que fal devolvió la
    imagen caduca. El archivo sí sigue ahí (workdir → S3), así que se vuelve a
    subir: es gratis y cierra la única vía por la que animar podría entregar
    una imagen distinta de la aprobada. Si la subida falla se sigue con la URL
    vieja — puede estar viva, y si no, Veo cae al clip estático de siempre.
    """
    p = Path(e.start_image_path) if e.start_image_path else None
    if not (p and p.is_file()):
        return e
    try:
        return e.model_copy(update={"start_image_url": await fal.subir_archivo(p)})
    except Exception as err:  # noqa: BLE001 — nunca fatal: es una reposición
        log.warning("Escena %s: no pude re-subir la imagen aprobada: %s", e.id, err)
        return e


async def _guardar_imagen_inicio(e: Scene, prev_frame: Path | None) -> None:
    # M22 · G: la imagen aprobada ya está en el workdir — bajarla otra vez de
    # una URL que pudo caducar es justo lo que rompería el clip de respaldo
    if e.start_image_path and Path(e.start_image_path).is_file():
        return
    if str(e.start_image_url).startswith("data:"):
        shutil.copy(prev_frame, e.start_image_path)
    else:
        await ffmpeg.descargar_imagen(e.start_image_url, e.start_image_path)


@observe(name="video_escena")
async def video_escena(e: Scene, prev_frame: Path | None) -> Scene:
    """Veo con reintentos; si agota intentos → clip estático con zoom."""
    for intento in range(1, settings.veo_max_attempts + 1):
        url = await _veo(e, intento)
        if url:
            await fal.descargar(url, e.video_path)
            await ffmpeg.ultimo_frame(e.video_path, e.last_frame_path)
            return e.model_copy(update={"video_url": url, "video_origen": "veo", "veo_intento": intento})

    await _guardar_imagen_inicio(e, prev_frame)
    await ffmpeg.clip_estatico(e.start_image_path, e.video_path, e.duracion_video, e.formato)
    shutil.copy(e.start_image_path, e.last_frame_path)
    get_client().update_current_span(level="WARNING", status_message="clip estático")
    return e.model_copy(update={"video_url": None, "video_origen": "estatico", "veo_intento": settings.veo_max_attempts})


@observe(name="mux_escena")
async def mux_escena(e: Scene) -> Scene:
    t = ffmpeg.mux_duracion(e.duracion_video, e.duracion_real)
    dur = await ffmpeg.mux(e.video_path, e.audio_path, e.final_path, e.last_frame_path, t)
    return e.model_copy(update={"duracion_final": dur})
