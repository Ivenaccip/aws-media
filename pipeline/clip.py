"""M25 · A/F — el clip de 8 segundos: una sola llamada a Veo, con audio.

Es el producto corto: el usuario escribe qué quiere, sube de cero a tres
imágenes (ninguna obligatoria) y se lleva un video. Sin guionista, sin TTS, sin
whisper, sin alineado, sin director, sin casting, sin concat ni mux, sin
pantalla de revisión y sin proyecto — o sea, sin nada de lo que existe para que
una película de 45 segundos tenga ritmo. Ocho segundos no es un recorte
arbitrario: es el slot máximo de Veo, así que un clip cabe en UNA llamada.

Tres caminos, según cuántas imágenes llegaron:

  0 imágenes → text-to-video (`fal_veo_t2v`)
  1 imagen   → image-to-video, se anima directo
  2 o 3      → Grok las junta en una sola y ESA es el cuadro inicial

El tercero es la idea del dueño (18-sep) y existe porque Veo recibe UNA imagen:
componer antes de animar es lo único que cabe en la tarifa (los modelos que
aceptan varias cuestan ~$0.37 dólares por segundo, siete veces lo que se cobra).

Lo que este módulo NO reusa, a propósito:

- `prompt_veo` y `VEO_NEGATIVE` (`pipeline/scenes.py`), que prohíben
  `photorealistic, humans, people, person, face` porque el otro producto son
  cortos animados. Con la foto de un perro o de una cara ese negativo le pelea
  al modelo. Aquí no hay prompt negativo: el usuario manda.
- `resolver_referencias`, que cuelga el estilo del proyecto y «Keep EXACTLY the
  same character design». La composición del clip va limpia: junta sujetos, no
  los rediseña.
"""
from __future__ import annotations

import logging

from langfuse import get_client, observe

from . import fal
from .config import load_prompt, settings
from .llm import chat_json
from .models import formato_de

log = logging.getLogger(__name__)

MAX_IMAGENES = 3
MAX_TEXTO = 2000
DURACION_S = 8                 # el slot máximo de Veo; un clip = una llamada
RESOLUCION = "720p"
CON_AUDIO = True               # es lo que se cobra: 30 créditos son la tarifa CON audio

# Extensiones que acepta Veo (verificado en fal el 2026-09-18). El `.heic` no
# es adorno: es con lo que salen las fotos de un iPhone, y un validador que no
# lo contemple rechaza fotos perfectamente buenas.
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic", ".heif"}
MAX_BYTES_IMAGEN = 20 * 1024**2


class ClipError(RuntimeError):
    """El clip no se pudo generar. Lo que llega aquí se devuelve en créditos."""


def valida_texto(texto: str) -> str:
    t = (texto or "").strip()
    if not t:
        raise ClipError("Escribe qué quieres ver en el video")
    return t[:MAX_TEXTO]


@observe(name="clip_prompt")
async def escribir_prompt(texto: str, n_imagenes: int = 0,
                          formato: str = "horizontal") -> dict:
    """Español suelto → prompt de Veo en inglés y ordenado.

    Todo el pipeline le habla a Veo en inglés y estructurado; los usuarios
    escriben en español y de corrido. Cuesta ~$0.001 dólares, y de la misma
    llamada sale el prompt de composición cuando hay varias imágenes: son la
    misma decisión (qué se ve y dónde), no dos.
    """
    orientacion = "vertical (9:16)" if formato == "vertical" else "horizontal (16:9)"
    pedido = (f"PETICIÓN DEL USUARIO:\n{texto}\n\n"
              f"IMÁGENES QUE SUBIÓ: {n_imagenes}\n"
              f"ORIENTACIÓN: {orientacion}")
    try:
        r = await chat_json("clip_prompt", load_prompt("clip_system"), pedido)
    except Exception as err:  # noqa: BLE001 — sin prompt no hay clip que animar
        raise ClipError(f"No se pudo preparar el prompt: {str(err)[:200]}") from err
    video = (r.get("video") or "").strip()
    if not video:
        raise ClipError("No se pudo preparar el prompt del video")
    return {"video": video,
            "composicion": (r.get("composicion") or "").strip(),
            "recorte": (r.get("recorte") or "").strip()}


@observe(name="clip_componer")
async def componer(image_urls: list[str], prompt: str,
                   formato: str = "horizontal") -> str:
    """Dos o tres imágenes → una sola, que será el cuadro inicial del video.

    Es la misma llamada que ya compone referencias de personaje en la película
    (`_grok` recibe `image_urls` en plural), con un prompt propio y sin el
    estilo del proyecto encima.
    """
    if not image_urls:
        raise ClipError("No hay imágenes que componer")
    try:
        res = await fal.llamar(
            settings.fal_imagen_edit,
            {"prompt": prompt or "Combine the subjects of the reference images "
                                 "into a single natural scene, keeping each one "
                                 "exactly as it looks.",
             "image_urls": image_urls,
             "aspect_ratio": formato_de(formato)["aspecto"]},
            timeout_s=settings.clip_componer_timeout_s, nombre="grok",
            meta={"clip": True, "referencias": len(image_urls)},
        )
    except fal.FalError as err:
        raise ClipError(f"No se pudieron juntar las imágenes: {err}") from err
    url = ((res.get("images") or [{}])[0]).get("url")
    if not url:
        raise ClipError("No se pudieron juntar las imágenes")
    return url


@observe(name="clip_animar")
async def animar(prompt: str, image_url: str | None = None,
                 formato: str = "horizontal") -> str:
    """La llamada a Veo. Con imagen es image-to-video; sin ella, el endpoint
    hermano de la misma familia, al mismo precio.

    Los timeouts son los del clip, NO los de la película: 720 s × 2 intentos
    son 24 minutos y la Lambda del worker muere a los 15.
    """
    args = {
        "prompt": prompt,
        "aspect_ratio": formato_de(formato)["aspecto"],
        "duration": f"{DURACION_S}s",
        "resolution": RESOLUCION,
        "generate_audio": CON_AUDIO,
        "safety_tolerance": "6",
    }
    # Sin prompt negativo a propósito: el del otro producto prohíbe
    # `photorealistic, humans, people, person, face`, que es justo lo que la
    # gente sube aquí.
    if image_url:
        args["image_url"] = image_url
    app = settings.fal_veo if image_url else settings.fal_veo_t2v
    ultimo = ""
    for intento in range(1, settings.clip_max_attempts + 1):
        try:
            res = await fal.llamar(app, args, timeout_s=settings.clip_timeout_s,
                                   nombre="veo", meta={"clip": True, "intento": intento})
        except fal.FalError as err:
            ultimo = str(err)
            log.warning("Veo falló en el clip (intento %d): %s", intento, err)
            continue
        url = (res.get("video") or {}).get("url")
        if url:
            return url
        ultimo = "Veo no devolvió video"
        log.warning("Veo no devolvió video en el clip (intento %d)", intento)
    raise ClipError(f"No se pudo generar el video: {ultimo[:200]}")


def costo_usd(n_imagenes: int = 0) -> float:
    """Lo que nos cuesta el clip, para dejarlo escrito junto al cobro.

    Los números salen de pricing.json vía pipeline.pricing — aquí no se
    hardcodea ninguno.
    """
    from .pricing import GROK_EDIT_ENTRADA, GROK_EDIT_SALIDA, VEO_LITE_POR_SEGUNDO
    total = DURACION_S * VEO_LITE_POR_SEGUNDO[(RESOLUCION, CON_AUDIO)]
    if int(n_imagenes) >= 2:
        total += GROK_EDIT_SALIDA + GROK_EDIT_ENTRADA * int(n_imagenes)
    return round(total, 4)


@observe(name="clip")
async def generar(texto: str, image_urls: list[str] | None = None,
                  formato: str = "horizontal") -> dict:
    """El clip completo: prompt → (composición) → Veo. Lanza ClipError."""
    urls = list(image_urls or [])[:MAX_IMAGENES]
    texto = valida_texto(texto)
    plan = await escribir_prompt(texto, len(urls), formato)

    inicial, origen = (urls[0] if urls else None), ("subida" if urls else "sin_imagen")
    if len(urls) >= 2:
        inicial = await componer(urls, plan["composicion"], formato)
        origen = "compuesta"

    video = await animar(plan["video"], inicial, formato)
    get_client().update_current_span(
        output={"imagenes": len(urls), "origen_inicial": origen, "formato": formato})
    return {"video_url": video, "imagen_inicial": inicial, "origen_inicial": origen,
            "prompt": plan["video"], "prompt_composicion": plan["composicion"],
            "recorte": plan["recorte"], "segundos": DURACION_S}
