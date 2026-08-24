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
ELEVEN_V3_POR_1K_CHARS = 0.10

try:
    _g = json.loads(_PRICING_JSON.read_text(encoding="utf-8"))["generacion"]
    _veo = _g["veo31_lite_usd_por_segundo"]
    VEO_LITE_POR_SEGUNDO = {
        ("720p", False): _veo["720p_sin_audio"], ("720p", True): _veo["720p_con_audio"],
        ("1080p", False): _veo["1080p_sin_audio"], ("1080p", True): _veo["1080p_con_audio"],
    }
    GROK_EDIT_SALIDA = _g["grok_edit"]["usd_por_imagen_salida"]
    GROK_EDIT_ENTRADA = _g["grok_edit"]["usd_por_imagen_referencia"]
    ELEVEN_V3_POR_1K_CHARS = _g["eleven_v3_usd_por_1k_chars"]
except (FileNotFoundError, KeyError):
    pass  # fallback: tarifas de arriba (2026-08-22)


def costo_fal(app: str, args: dict) -> float | None:
    if "veo3.1" in app:
        seg = float(str(args.get("duration", "0")).rstrip("s") or 0)
        tarifa = VEO_LITE_POR_SEGUNDO.get((args.get("resolution", "720p"), bool(args.get("generate_audio"))), 0.03)
        return round(seg * tarifa, 4)
    if "grok-imagine-image" in app:
        return round(GROK_EDIT_SALIDA + GROK_EDIT_ENTRADA * len(args.get("image_urls") or []), 4)
    if "elevenlabs/tts" in app:
        return round(len(args.get("text", "")) / 1000 * ELEVEN_V3_POR_1K_CHARS, 4)
    return None


def unidades_fal(app: str, args: dict) -> dict | None:
    """Unidades de uso para Langfuse (se muestran junto al coste)."""
    if "veo3.1" in app:
        return {"video_seconds": int(float(str(args.get("duration", "0")).rstrip("s") or 0))}
    if "grok-imagine-image" in app:
        return {"images": 1, "reference_images": len(args.get("image_urls") or [])}
    if "elevenlabs/tts" in app:
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
