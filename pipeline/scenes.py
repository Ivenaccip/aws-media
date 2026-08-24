"""Ordenar cola, partir en cadenas, resolver referencias y rutas."""
from __future__ import annotations

from pathlib import Path

from .models import Casting, Scene
from .styles import Estilo

ESTILO_SUFIJO = (
    " Render EXACTLY in the flat 2D cartoon illustration style of the first reference image: "
    "same line weight, same flat colors, same simplified shapes, same character proportions. "
    "No photorealism, no 3D render, no humans, no text, no watermark."
)


def ordenar_cola(escenas: list[Scene]) -> list[Scene]:
    """Port de `Ordenar cola`: orden natural, prev_id, 'continua' solo si mismos personajes."""
    from .utils import natural_key

    escenas = sorted(escenas, key=lambda e: natural_key(e.id))
    total = len(escenas)
    out = []
    for i, e in enumerate(escenas):
        prev = escenas[i - 1] if i > 0 else None
        tr = e.transicion
        if prev is None:
            tr = "corte"
        elif tr == "continua" and sorted(prev.personajes) != sorted(e.personajes):
            tr = "corte"
        out.append(e.model_copy(update={
            "transicion": tr, "orden": i, "total": total,
            "prev_id": prev.id if prev else None, "es_ultima": i == total - 1,
            "modo_inicio": "continua" if (prev and tr == "continua") else "corte",
        }))
    return out


def partir_en_cadenas(escenas: list[Scene]) -> list[list[Scene]]:
    """Cada 'corte' abre una cadena nueva; las 'continua' se encolan en la actual.
    Las cadenas son independientes entre sí → se ejecutan en paralelo."""
    cadenas: list[list[Scene]] = []
    for e in escenas:
        if e.transicion == "corte" or not cadenas:
            cadenas.append([e])
        else:
            cadenas[-1].append(e)
    return cadenas


def asignar_rutas(e: Scene, workdir: Path) -> Scene:
    return e.model_copy(update={
        "audio_path": e.audio_path or workdir / f"audio_{e.id}.mp3",
        "video_path": workdir / f"video_{e.id}.mp4",
        "last_frame_path": workdir / f"last_{e.id}.jpg",
        "start_image_path": workdir / f"start_{e.id}.jpg",
        "final_path": workdir / f"final_{e.id}.mp4",
    })


def resolver_referencias(e: Scene, ctx: Casting, estilo_url: str | None, hay_prev: bool,
                         estilo: Estilo | None = None) -> Scene:
    """Port de `Resolver referencias`: refs SOLO de biblioteca (estilo + personajes con imagen)."""
    modo = e.modo_inicio if hay_prev else "corte"
    personajes = [c for p in e.personajes for c in ctx.casting if c.nombre == p]
    refs = [c.url for c in personajes if c.existe and c.url]
    image_urls = list(dict.fromkeys(u for u in [estilo_url, *refs] if isinstance(u, str) and u.strip()))[:4]

    desc = [c.descriptor for c in personajes if c.descriptor]
    prompt = f"{e.prompt_visual}. {ctx.mundo}."
    if desc:
        prompt += " Characters that MUST appear clearly and fully visible in the frame: " + "; ".join(desc) + "."
    if estilo is not None:
        prompt += f" Visual style: {estilo.prompt}."
        if refs:
            prompt += " Keep EXACTLY the same character design as the reference image."
        else:
            prompt += " Match the rendering style and palette of the reference image; the reference character does NOT appear."
        prompt += " No text, no watermark."
    else:
        prompt += ESTILO_SUFIJO
    return e.model_copy(update={
        "modo_inicio": modo, "image_urls": image_urls, "prompt_imagen": prompt,
        "estilo_prompt": estilo.prompt if estilo else None, "veo_negativo": estilo.negativo if estilo else None,
    })


def prompt_veo(e: Scene) -> str:
    if e.estilo_prompt:
        return (
            f"{e.prompt_visual}. {e.prompt_movimiento}. Keep EXACTLY the same character design, proportions and "
            f"visual style as the first frame throughout the whole clip ({e.estilo_prompt}). No text."
        )
    return (
        f"{e.prompt_visual}. {e.prompt_movimiento}. Keep EXACTLY the same character design, proportions and "
        "flat 2D cartoon illustration style as the first frame throughout the whole clip. No humans, no people, no text."
    )


VEO_NEGATIVE = (
    "photorealistic, realistic, 3D render, CGI, humans, people, person, man, woman, face, "
    "text, watermark, logo, style change"
)
