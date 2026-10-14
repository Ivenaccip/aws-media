"""Estilos visuales: sufijo de prompt (Grok + Veo) y negativo (Veo) por estilo."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Estilo:
    id: str
    nombre: str
    prompt: str
    negativo: str
    descripcion: str = ""   # lo que ve el usuario al elegir (español, con ejemplo)


_BASE_NEG = "text, watermark, logo, subtitles, extra limbs, deformed hands, distorted face, duplicate character"

ESTILOS: dict[str, Estilo] = {
    "cinematic": Estilo(
        "cinematic", "Cinemático",
        "cinematic live-action look, anamorphic lens, shallow depth of field, volumetric light, film grain, color graded",
        f"{_BASE_NEG}, cartoon, anime, flat shading, low resolution",
        "Look de película real: lente de cine, luz dramática. Ej.: un documental de historia.",
    ),
    "animated": Estilo(
        "animated", "Animado",
        "3D animated film style, Pixar-like, soft global illumination, expressive characters, clean shapes, vibrant palette",
        f"{_BASE_NEG}, photorealistic, live action, gritty, dark horror",
        "Animación 3D tipo Pixar: personajes expresivos, colores vivos. Ej.: una fábula para todo público.",
    ),
    "monochrome": Estilo(
        "monochrome", "Monocromático",
        "black and white, high contrast, film noir lighting, deep shadows, fine grain, classic cinema framing",
        f"{_BASE_NEG}, color, saturated, neon",
        "Blanco y negro de cine clásico: alto contraste, sombras profundas. Ej.: cine negro, épocas pasadas.",
    ),
    "experimental": Estilo(
        "experimental", "Experimental",
        "experimental art film, surreal composition, mixed media textures, bold unusual framing, dreamlike",
        f"{_BASE_NEG}, generic stock footage look, flat lighting",
        "Arte experimental: composición surrealista, texturas mezcladas, onírico. Ej.: un video conceptual.",
    ),
    "artistic": Estilo(
        "artistic", "Artístico",
        "painterly illustration, visible brush strokes, watercolor and gouache textures, storybook look",
        f"{_BASE_NEG}, photorealistic, 3D render, glossy plastic",
        "Ilustración pictórica: pinceladas visibles, acuarela, look de libro de cuentos. Ej.: una leyenda.",
    ),
}


# «Sin estilo» (dueño, 14-oct-2026): la caja del inicio dibuja lo que la persona escribe,
# sin pegarle un look. Es un id APARTE y a propósito NO vive en ESTILOS: ese dict alimenta
# `/api/estilos` y, por ahí, los selectores de Imágenes y de Crear (y el estilo de las
# películas, que sí lo necesitan). Si entrara a ESTILOS, «ninguno» aparecería como una
# opción más en esas pantallas y una película podría nacer sin estilo. Se acepta aquí, en
# `resolver_estilo`; lo pide `POST /api/imagenes` (la caja) y `POST /api/proyectos` lo
# rechaza con 422. Su negativo es el base, como el de «custom»: cuida manos y marcas de
# agua, no impone ningún look.
NINGUNO = "ninguno"

_SIN_ESTILO = Estilo(NINGUNO, "Sin estilo", "", _BASE_NEG,
                     "Lo que escribes es lo que se dibuja: no se le agrega ningún estilo.")


def resolver_estilo(id_: str, custom: str | None = None) -> Estilo:
    if id_ == NINGUNO:
        return _SIN_ESTILO     # `custom` se ignora: sin estilo no hay a qué añadirle texto
    if id_ == "custom":
        return Estilo("custom", "Personalizado", (custom or "").strip(), _BASE_NEG,
                      "Descríbelo tú con tus palabras (en inglés funciona mejor).")
    if id_ not in ESTILOS:
        raise ValueError(f"Estilo desconocido: {id_}")
    return ESTILOS[id_]
