"""Precios de fal (USD) para registrar coste en Langfuse.

Fuente única del repo: tools/pricing.json, sección "generacion" (regla de video-stack:
ninguna skill ni módulo hardcodea precios). Los valores literales de abajo son solo
el fallback si el JSON no existe (p. ej. tests aislados del paquete)."""
from __future__ import annotations

import json
from pathlib import Path

_PRICING_JSON = Path(__file__).resolve().parent.parent / "tools" / "pricing.json"

VEO_LITE_POR_SEGUNDO = {  # (resolución, con_audio) → $/s
    ("720p", False): 0.03, ("720p", True): 0.05,
    ("1080p", False): 0.05, ("1080p", True): 0.08,
}
GROK_EDIT_SALIDA = 0.02      # por imagen generada
GROK_EDIT_ENTRADA = 0.002    # por imagen de referencia
NANO_BANANA_FAL = 0.04       # por imagen (~1 MP a 1:1; fal cobra $0.0398/MP)
ELEVEN_V3_POR_1K_CHARS = 0.10

# Backend google (Gemini API) — popup g1/g2. Fallback si el JSON no existe.
GOOGLE_VEO_LITE_720P = 0.05          # $/s, audio incluido (se descarta en el mux)
GOOGLE_NANO_BANANA = 0.039           # $/imagen

# Endpoints con costo CONOCIDO, por nombre exacto. Antes se casaba por trozo
# ("veo3.1" in app), y eso cobraría Veo 3.1 Fast o Standard con la tabla de Lite
# sin avisar: el costo de un modelo que no registramos es «no se sabe», nunca el
# de su vecino. Un endpoint nuevo entra por tools/pricing.json §generacion.endpoints.
ENDPOINTS_VEO_LITE = ("fal-ai/veo3.1/lite", "fal-ai/veo3.1/lite/image-to-video")
ENDPOINTS_GROK_IMAGEN = ("xai/grok-imagine-image", "xai/grok-imagine-image/edit")
ENDPOINTS_NANO_BANANA_VIEJO = ("fal-ai/nano-banana", "fal-ai/nano-banana/edit")
ENDPOINT_ELEVEN = "fal-ai/elevenlabs/tts/eleven-v3"

ENDPOINTS_JSON: dict[str, dict] = {}   # §generacion.endpoints: {endpoint: ficha}

try:
    _g = json.loads(_PRICING_JSON.read_text(encoding="utf-8"))["generacion"]
    ENDPOINTS_JSON = {k: v for k, v in (_g.get("endpoints") or {}).items()
                      if isinstance(v, dict)}
    _veo = _g["veo31_lite_usd_por_segundo"]
    VEO_LITE_POR_SEGUNDO = {
        ("720p", False): _veo["720p_sin_audio"], ("720p", True): _veo["720p_con_audio"],
        ("1080p", False): _veo["1080p_sin_audio"], ("1080p", True): _veo["1080p_con_audio"],
    }
    GROK_EDIT_SALIDA = _g["grok_edit"]["usd_por_imagen_salida"]
    GROK_EDIT_ENTRADA = _g["grok_edit"]["usd_por_imagen_referencia"]
    NANO_BANANA_FAL = _g.get("nano_banana_fal_usd_por_imagen", NANO_BANANA_FAL)
    ELEVEN_V3_POR_1K_CHARS = _g["eleven_v3_usd_por_1k_chars"]
    GOOGLE_VEO_LITE_720P = _g["google"]["veo31_usd_por_segundo"]["lite_720p"]
    GOOGLE_NANO_BANANA = _g["google"]["nano_banana_usd_por_imagen"]
except (FileNotFoundError, KeyError):
    pass  # fallback: tarifas de arriba (2026-08-22 fal / 2026-08-24 google)


def estimar_regeneracion(duracion_clip_s: float, n_imagenes: int = 1, backend: str = "google") -> dict:
    """Precio ANTES del botón Generar del popup g1 (PLAN-FUSION.md F2.3).
    Veo se pide en pasos de 4/6/8 s: el primero que cubra la duración del clip."""
    segundos = next((s for s in (4, 6, 8) if s >= duracion_clip_s), 8)
    if backend == "google":
        imagen, video = GOOGLE_NANO_BANANA * n_imagenes, segundos * GOOGLE_VEO_LITE_720P
    else:
        # fal (default desde 2026-09-03): el modelo de imagen + veo lite 720p
        # sin audio. M23 · B (18-sep): esto decía NANO_BANANA_FAL y se quedó
        # ahí cuando las imágenes pasaron a Grok — el popup habría seguido
        # cotizando $0.04 de un modelo que ya no se llama, y ese número no solo
        # se enseña: se guarda en el libro de gastos del proyecto. El b-roll
        # manda SIEMPRE una referencia (server/overlays_api.py), así que la
        # entrada va en el precio.
        imagen = (GROK_EDIT_SALIDA + GROK_EDIT_ENTRADA) * n_imagenes
        video = segundos * VEO_LITE_POR_SEGUNDO[("720p", False)]
    return {"backend": backend, "imagenes": n_imagenes, "imagen": round(imagen, 3),
            "veo_segundos": segundos, "video": round(video, 3),
            "total": round(imagen + video, 3)}


def _costo_ficha(f: dict, args: dict) -> float | None:
    """Costo de un endpoint registrado en pricing.json §generacion.endpoints.
    Una ficha a medias da None: nunca se inventa la parte que falta."""
    try:
        if f.get("unidad") == "imagen":
            return round(float(f["usd"]) * int(args.get("num_images", 1))
                         + float(f.get("usd_referencia", 0))
                         * len(args.get("image_urls") or []), 4)
        if f.get("unidad") == "segundo":
            seg = float(str(args.get("duration", "0")).rstrip("s") or 0)
            res = args.get("resolution") or f.get("resolucion_base") or ""
            audio = "con_audio" if args.get("generate_audio") else "sin_audio"
            tabla = f["usd_por_segundo"]
            tarifa = tabla.get(f"{res}_{audio}", tabla.get(res))
            return None if tarifa is None else round(seg * float(tarifa), 4)
    except (KeyError, TypeError, ValueError):
        return None
    return None


def costo_fal(app: str, args: dict) -> float | None:
    if app in ENDPOINTS_JSON:
        return _costo_ficha(ENDPOINTS_JSON[app], args)
    if app in ENDPOINTS_VEO_LITE:
        seg = float(str(args.get("duration", "0")).rstrip("s") or 0)
        tarifa = VEO_LITE_POR_SEGUNDO.get((args.get("resolution", "720p"), bool(args.get("generate_audio"))), 0.03)
        return round(seg * tarifa, 4)
    if app in ENDPOINTS_GROK_IMAGEN:
        # casa los dos endpoints de la familia (crear y editar): la salida
        # cuesta igual y las referencias se cuentan de los argumentos, así que
        # una lista vacía da el precio de crear
        return round(GROK_EDIT_SALIDA * int(args.get("num_images", 1))
                     + GROK_EDIT_ENTRADA * len(args.get("image_urls") or []), 4)
    if app in ENDPOINTS_NANO_BANANA_VIEJO:
        return round(NANO_BANANA_FAL * int(args.get("num_images", 1)), 4)
    if app == ENDPOINT_ELEVEN:
        return round(len(args.get("text", "")) / 1000 * ELEVEN_V3_POR_1K_CHARS, 4)
    return None


def unidades_fal(app: str, args: dict) -> dict | None:
    """Unidades de uso para Langfuse (se muestran junto al coste)."""
    f = ENDPOINTS_JSON.get(app)
    if f and f.get("unidad") == "segundo" or app in ENDPOINTS_VEO_LITE:
        return {"video_seconds": int(float(str(args.get("duration", "0")).rstrip("s") or 0))}
    if f and f.get("unidad") == "imagen" or app in ENDPOINTS_GROK_IMAGEN + ENDPOINTS_NANO_BANANA_VIEJO:
        return {"images": int(args.get("num_images", 1)),
                "reference_images": len(args.get("image_urls") or [])}
    if app == ENDPOINT_ELEVEN:
        return {"characters": len(args.get("text", ""))}
    return None


def estimar_produccion(escenas: list[str]) -> dict:
    """Estimación ANTES de producir: por escena Grok (1 ref) + QC + Veo (6-8 s a 720p) + TTS; más LLMs."""
    n = len(escenas)
    chars = sum(len(t) for t in escenas)
    veo = n * 7 * VEO_LITE_POR_SEGUNDO[("720p", False)]           # ~7 s de media por clip
    grok = n * (GROK_EDIT_SALIDA + GROK_EDIT_ENTRADA) * 1.3         # ~30 % de reintentos por QC
    tts = chars / 1000 * ELEVEN_V3_POR_1K_CHARS * 1.3
    llm = 0.05 + n * 0.015                                          # casting/director + QC gpt-5 por escena
    total = veo + grok + tts + llm
    return {"escenas": n, "veo": round(veo, 2), "grok": round(grok, 2), "tts": round(tts, 2), "llm": round(llm, 2),
            "total": round(total, 2), "minutos": round(2 + n * 0.5)}
