"""Personaje de la sesión: referencia subida → descripción (visión) → 2 opciones con Grok en el estilo elegido."""
from __future__ import annotations

import asyncio
import base64
import logging
import mimetypes
from pathlib import Path

from langfuse import get_client, observe
from pydantic import BaseModel

from . import fal
from .config import load_prompt, settings
from .llm import chat_json, client
from .project import OpcionPersonaje, Personaje, Proyecto
from .styles import Estilo
from .utils import norm, parse_llm_json

log = logging.getLogger(__name__)

N_OPCIONES = 2
# Dos encuadres distintos para que las opciones no sean casi idénticas
VARIANTES = [
    "full-body character design, three-quarter view facing slightly to the right, standing on a simple ground plane",
    "medium shot character portrait, facing slightly to the right, gentle smile, soft rim light",
]


class Descripcion(BaseModel):
    nombre: str = "protagonista"
    especie: str = ""
    descripcion: str = ""
    mira_hacia: str = "camera"


def _data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


@observe(name="describir_referencia")
async def describir_referencia(path: Path) -> Descripcion:
    resp = await client().chat.completions.create(
        model=settings.qc_model,
        name="describir_referencia",
        messages=[
            {"role": "system", "content": load_prompt("describir_referencia_system")},
            {"role": "user", "content": [
                {"type": "text", "text": "Describe a este personaje."},
                {"type": "image_url", "image_url": {"url": _data_uri(path), "detail": "high"}},
            ]},
        ],
    )
    r = parse_llm_json(resp.choices[0].message.content or "")
    d = Descripcion(
        nombre=norm(r.get("nombre")) or "protagonista",
        especie=str(r.get("especie") or ""),
        descripcion=str(r.get("descripcion") or ""),
        mira_hacia=str(r.get("mira_hacia") or "camera"),
    )
    get_client().update_current_span(output=d.model_dump())
    return d


def prompt_opcion(d: Descripcion, estilo: Estilo, variante: str) -> str:
    return (
        f"{variante}. The character: {d.descripcion}. Keep the same character identity as the reference image. "
        f"{estilo.prompt}. Clean neutral background, no text."
    )


async def _opcion(p: Proyecto, ref_url: str, prompt: str, i: int) -> OpcionPersonaje | None:
    try:
        res = await fal.llamar(
            settings.fal_grok, {"prompt": prompt, "image_urls": [ref_url], "aspect_ratio": "1:1"},
            timeout_s=settings.grok_timeout_s, nombre="grok", meta={"personaje_opcion": i},
        )
        url = ((res.get("images") or [{}])[0]).get("url")
        if not url:
            return None
        destino = p.workdir / "personaje" / f"opcion_{i}.jpg"
        destino.parent.mkdir(parents=True, exist_ok=True)
        await fal.descargar(url, destino)
        return OpcionPersonaje(url=url, path=str(destino))
    except fal.FalError as err:
        log.warning("Grok falló en opción %d: %s", i, err)
        return None


@observe(name="personaje")
async def preparar_personaje(p: Proyecto, estilo: Estilo, d: Descripcion) -> Personaje:
    """Usa la primera referencia subida (ya descrita). Sin referencia → Personaje vacío (la UI lo avisa)."""
    if not p.referencias:
        return Personaje()
    ref = p.referencias[0]
    ref.url = ref.url or await fal.subir_archivo(Path(ref.path))
    opciones = await asyncio.gather(*(
        _opcion(p, ref.url, prompt_opcion(d, estilo, v), i) for i, v in enumerate(VARIANTES[:N_OPCIONES])
    ))
    per = Personaje(nombre=d.nombre, descripcion=d.descripcion, opciones=[o for o in opciones if o])
    get_client().update_current_span(output={"nombre": per.nombre, "opciones": len(per.opciones)})
    return per


# ---------------------------------------------------------------------------
# M1 — personaje SIN imagen de referencia: el protagonista sale del guion.
# Antes, un brief en modo idea sin imágenes terminaba en revisión con 0
# opciones y el proyecto quedaba varado con los créditos de preparar cobrados.

@observe(name="personaje_guion")
async def describir_desde_guion(historia: str) -> Descripcion:
    """Deriva nombre + descripción del protagonista a partir del guion numerado."""
    r = await chat_json("personaje_guion", load_prompt("personaje_guion_system"), historia)
    d = Descripcion(
        nombre=norm(r.get("nombre")) or "protagonista",
        especie=str(r.get("especie") or ""),
        descripcion=str(r.get("descripcion") or ""),
        mira_hacia="camera",
    )
    get_client().update_current_span(output=d.model_dump())
    return d


def prompt_opcion_sin_ref(d: Descripcion, estilo: Estilo, variante: str) -> str:
    return (
        f"{variante}. The character: {d.descripcion}. "
        f"{estilo.prompt}. Clean neutral background, no text."
    )


async def _opcion_sin_ref(p: Proyecto, prompt: str, i: int) -> OpcionPersonaje | None:
    from . import media_fal  # nano banana en fal (GEN_BACKEND=fal desde 2026-09-03)
    try:
        destino = p.workdir / "personaje" / f"opcion_{i}.jpg"
        url = await media_fal.imagen_nano(prompt, destino, meta={"personaje_opcion": i})
        return OpcionPersonaje(url=url, path=str(destino))
    except Exception as err:  # noqa: BLE001
        log.warning("Opción sin referencia %d falló: %s", i, err)
        return None


@observe(name="personaje_sin_ref")
async def preparar_personaje_sin_ref(p: Proyecto, estilo: Estilo, d: Descripcion) -> Personaje:
    """2 opciones generadas desde la descripción (Nano Banana, sin referencia)."""
    opciones = await asyncio.gather(*(
        _opcion_sin_ref(p, prompt_opcion_sin_ref(d, estilo, v), i)
        for i, v in enumerate(VARIANTES[:N_OPCIONES])
    ))
    per = Personaje(nombre=d.nombre, descripcion=d.descripcion, opciones=[o for o in opciones if o])
    get_client().update_current_span(output={"nombre": per.nombre, "opciones": len(per.opciones)})
    return per
