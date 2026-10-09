"""M25 · A/F — el clip de 4, 6 u 8 segundos: una sola llamada a Veo, con audio.

Es el producto corto: el usuario escribe qué quiere, sube de cero a tres
imágenes (ninguna obligatoria) y se lleva un video. Sin guionista, sin TTS, sin
whisper, sin alineado, sin director, sin casting, sin concat ni mux, sin
pantalla de revisión y sin proyecto — o sea, sin nada de lo que existe para que
una película de 45 segundos tenga ritmo. Ocho segundos no es un recorte
arbitrario: es el slot máximo de Veo, así que un clip cabe en UNA llamada. Es la
duración por defecto; R4 deja elegir 4 o 6 (cada modelo declara las suyas en
`modelos_ia` y cada una trae su precio en tarifas.json §modelos).

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

from . import fal, modelos_ia
from .config import load_prompt, settings
from .llm import chat_json
from .models import formato_de

log = logging.getLogger(__name__)

MAX_IMAGENES = 3
MAX_TEXTO = 2000
# Solo el valor por defecto (8 s, el slot máximo de Veo): la duración real viaja
# en cada pedido y la admitida la declara cada modelo en modelos_ia.
DURACION_S = modelos_ia.DURACION_PREDETERMINADA_S
RESOLUCION = "720p"
CON_AUDIO = True               # es lo que se cobra: la tarifa en créditos es la CON audio

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
                 formato: str = "horizontal", modelo: str | None = None,
                 segundos: int = DURACION_S) -> str:
    """La llamada a Veo. Con imagen es image-to-video; sin ella, el endpoint
    hermano de la misma familia, al mismo precio.

    `segundos` es la duración que se cobró (4, 6 u 8): se valida contra lo que el
    modelo admite y viaja como «<n>s». Una que no admite levanta
    DuracionNoAdmitida, nunca se cambia en silencio a otra.

    Los timeouts son los del clip, NO los de la película: 720 s × 2 intentos
    son 24 minutos y la Lambda del worker muere a los 15.

    Los intentos son min(settings.clip_max_attempts, Modelo.max_intentos) cuando el
    modelo trae un tope (0 = los de settings). Un timeout de cliente se vuelve
    FalError en `fal.llamar`, pero NO cancela el trabajo en fal: el primero puede
    seguir vivo y cobrado cuando sale el segundo. Con Lite sale barato (hasta $0.40
    dólares); Veo 3.1 Standard son $3.20 dólares por intento a 8 s, así que Fast y
    Standard hacen uno solo.
    """
    m = modelos_ia.resolver("clip", modelo)
    segundos = modelos_ia.valida_duracion("clip", m.id, segundos)
    args = {
        "prompt": prompt,
        "aspect_ratio": formato_de(formato)["aspecto"],
        "duration": f"{segundos}s",
        "resolution": RESOLUCION,
        "generate_audio": CON_AUDIO,
        "safety_tolerance": "6",
    }
    # Sin prompt negativo a propósito: el del otro producto prohíbe
    # `photorealistic, humans, people, person, face`, que es justo lo que la
    # gente sube aquí.
    if image_url:
        args["image_url"] = image_url
    # R4: el endpoint sale de la tabla de modelos. Los argumentos de arriba son
    # los de la familia Veo; un modelo de otra familia trae su propio juego (se
    # suma aquí junto con su fila en modelos_ia, y se prueba antes de activarlo).
    app = m.endpoint_para(bool(image_url))
    intentos = settings.clip_max_attempts
    if m.max_intentos > 0:
        intentos = min(intentos, m.max_intentos)       # el modelo pide menos, nunca más
    ultimo = ""
    for intento in range(1, intentos + 1):
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


def costo_usd(n_imagenes: int = 0, modelo: str | None = None,
              segundos: int = DURACION_S) -> float:
    """Lo que nos cuesta el clip, para dejarlo escrito junto al cobro.

    Los números salen de pricing.json vía pipeline.pricing — aquí no se
    hardcodea ninguno. Va con la duración REAL: `costo_fal` lee los segundos de
    los argumentos y cobra por segundo, así que un clip de 4 s no se anota como
    uno de 8.
    """
    from .pricing import GROK_EDIT_ENTRADA, GROK_EDIT_SALIDA, costo_fal
    m = modelos_ia.resolver("clip", modelo)
    segundos = modelos_ia.valida_duracion("clip", m.id, segundos)
    # el endpoint exacto que se llama: con imagen (una o la compuesta) o sin ella
    total = costo_fal(m.endpoint_para(int(n_imagenes) >= 1),
                      {"duration": f"{segundos}s", "resolution": RESOLUCION,
                       "generate_audio": CON_AUDIO})
    # sin costo conocido es un error, no un cero que parezca gratis
    if not total:
        raise ClipError(f"Sin costo conocido para el modelo {m.id}")
    if int(n_imagenes) >= 2:
        total += GROK_EDIT_SALIDA + GROK_EDIT_ENTRADA * int(n_imagenes)
    return round(total, 4)


@observe(name="clip")
async def generar(texto: str, image_urls: list[str] | None = None,
                  formato: str = "horizontal", modelo: str | None = None,
                  segundos: int = DURACION_S) -> dict:
    """El clip completo: prompt → (composición) → Veo. Lanza ClipError.

    La duración se valida ANTES de gastar nada (el LLM y Grok cuestan): una que
    el modelo no admite no llega ni a escribir el prompt."""
    segundos = modelos_ia.valida_duracion(
        "clip", modelos_ia.resolver("clip", modelo).id, segundos)
    urls = list(image_urls or [])[:MAX_IMAGENES]
    texto = valida_texto(texto)
    plan = await escribir_prompt(texto, len(urls), formato)

    inicial, origen = (urls[0] if urls else None), ("subida" if urls else "sin_imagen")
    if len(urls) >= 2:
        inicial = await componer(urls, plan["composicion"], formato)
        origen = "compuesta"

    video = await animar(plan["video"], inicial, formato, modelo, segundos)
    get_client().update_current_span(
        output={"imagenes": len(urls), "origen_inicial": origen, "formato": formato,
                "segundos": segundos})
    return {"video_url": video, "imagen_inicial": inicial, "origen_inicial": origen,
            "prompt": plan["video"], "prompt_composicion": plan["composicion"],
            "recorte": plan["recorte"], "segundos": segundos}
