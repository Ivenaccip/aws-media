"""Catálogo de voces de ElevenLabs (endpoint eleven-v3 en fal) y recomendación por guion."""
from __future__ import annotations

from typing import Literal

from langfuse import get_client, observe
from pydantic import BaseModel

from .config import load_prompt
from .llm import chat_json

Nivel = Literal["verde", "amarillo", "rojo"]

# Carácter según la biblioteca por defecto de ElevenLabs.
VOCES: dict[str, str] = {
    "George": "hombre, cálido, británico; narrador clásico de cuentos y documentales",
    "Brian": "hombre, grave y tranquilo, estadounidense; documental, serio",
    "Lily": "mujer, cálida, británica; narración de cuentos, cercana",
    "Sarah": "mujer, suave y joven; serena, íntima",
    "Bill": "hombre mayor, confiable y reposado; narración, sabiduría",
    "Matilda": "mujer, amable y profesional; explicativa",
    "Daniel": "hombre, autoritario, británico; noticiero, institucional",
    "Roger": "hombre, seguro y claro; corporativo",
    "Eric": "hombre de mediana edad, amable; conversacional",
    "Liam": "hombre joven, articulado; energía contenida",
    "Will": "hombre joven, amigable; relajado",
    "Chris": "hombre, casual; charla informal",
    "Callum": "hombre, intenso y teatral; suspenso, villanos",
    "Aria": "mujer, expresiva e intensa; muy dramática",
    "Jessica": "mujer joven, expresiva; comercial, enérgica",
    "Laura": "mujer joven, optimista; anuncios",
    "Alice": "mujer, segura, británica; formativa",
    "Charlotte": "mujer, seductora, acento sueco; personajes",
    "Charlie": "hombre, natural, australiano; acento marcado",
    "River": "voz neutra, relajada; conversacional",
}
VOZ_DEFAULT = "George"
STABILITY_DEFAULT = 0.7  # 0 = Creative, 0.5 = Natural, 1 = Robust


class VozRank(BaseModel):
    id: str
    nivel: Nivel
    motivo: str = ""


def catalogo_texto() -> str:
    return "\n".join(f"- {v}: {d}" for v, d in VOCES.items())


def interpretar_ranking(r: dict) -> list[VozRank]:
    """Ordena verde → amarillo → rojo conservando el orden del LLM dentro de cada nivel; completa las que falten."""
    vistos: dict[str, VozRank] = {}
    for item in r.get("voces") or []:
        if not isinstance(item, dict):
            continue
        vid = str(item.get("id") or "").strip()
        nivel = item.get("nivel")
        if vid in VOCES and nivel in ("verde", "amarillo", "rojo") and vid not in vistos:
            vistos[vid] = VozRank(id=vid, nivel=nivel, motivo=str(item.get("motivo") or "")[:140])
    for vid in VOCES:
        vistos.setdefault(vid, VozRank(id=vid, nivel="amarillo", motivo="sin evaluar"))
    orden = {"verde": 0, "amarillo": 1, "rojo": 2}
    return sorted(vistos.values(), key=lambda v: orden[v.nivel])


@observe(name="recomendar_voz")
async def recomendar_voces(guion: str, estilo: str) -> list[VozRank]:
    user = load_prompt("voz_user").format(guion=guion, estilo=estilo, catalogo=catalogo_texto())
    r = await chat_json("recomendar_voz", load_prompt("voz_system"), user)
    rank = interpretar_ranking(r)
    get_client().update_current_span(output={"verde": [v.id for v in rank if v.nivel == "verde"]})
    return rank
