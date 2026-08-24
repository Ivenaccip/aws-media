"""Estilos visuales: sufijo de prompt (Grok + Veo) y negativo (Veo) por estilo."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Estilo:
    id: str
    nombre: str
    prompt: str
    negativo: str


_BASE_NEG = "text, watermark, logo, subtitles, extra limbs, deformed hands, distorted face, duplicate character"

ESTILOS: dict[str, Estilo] = {
    "cinematic": Estilo(
        "cinematic", "Cinematic",
        "cinematic live-action look, anamorphic lens, shallow depth of field, volumetric light, film grain, color graded",
        f"{_BASE_NEG}, cartoon, anime, flat shading, low resolution",
    ),
    "animated": Estilo(
        "animated", "Animated",
        "3D animated film style, Pixar-like, soft global illumination, expressive characters, clean shapes, vibrant palette",
        f"{_BASE_NEG}, photorealistic, live action, gritty, dark horror",
    ),
    "monochrome": Estilo(
        "monochrome", "Monochrome",
        "black and white, high contrast, film noir lighting, deep shadows, fine grain, classic cinema framing",
        f"{_BASE_NEG}, color, saturated, neon",
    ),
    "experimental": Estilo(
        "experimental", "Experimental",
        "experimental art film, surreal composition, mixed media textures, bold unusual framing, dreamlike",
        f"{_BASE_NEG}, generic stock footage look, flat lighting",
    ),
    "artistic": Estilo(
        "artistic", "Artistic",
        "painterly illustration, visible brush strokes, watercolor and gouache textures, storybook look",
        f"{_BASE_NEG}, photorealistic, 3D render, glossy plastic",
    ),
}


def resolver_estilo(id_: str, custom: str | None = None) -> Estilo:
    if id_ == "custom":
        return Estilo("custom", "Custom", (custom or "").strip(), _BASE_NEG)
    if id_ not in ESTILOS:
        raise ValueError(f"Estilo desconocido: {id_}")
    return ESTILOS[id_]
