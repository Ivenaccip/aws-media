"""Director de escenas + normalización."""
from __future__ import annotations

from langfuse import observe

from .config import load_prompt
from .llm import chat_json
from .models import Casting, Scene
from .utils import norm


def normalizar_escenas(r: dict, ctx: Casting) -> list[Scene]:
    escenas = r.get("escenas")
    if not isinstance(escenas, list) or not escenas:
        raise ValueError("El director no devolvió escenas")
    nombres = {c.nombre for c in ctx.casting}
    out = []
    for i, e in enumerate(escenas):
        pers = e.get("personajes") if isinstance(e.get("personajes"), list) else []
        out.append(Scene(
            id=str(e.get("id") or i + 1),
            transicion="corte" if i == 0 else ("continua" if e.get("transicion") == "continua" else "corte"),
            narracion=str(e.get("narracion") or ""),
            personajes=[p for p in map(norm, pers) if p in nombres][:2],
            prompt_visual=str(e.get("prompt_visual") or ""),
            prompt_movimiento=str(e.get("prompt_movimiento") or ""),
        ))
    return out


def _elenco(ctx: Casting) -> str:
    lineas = []
    for c in ctx.casting:
        extra = (
            f' — SIN imagen de referencia, describir siempre como: "{c.descriptor}"'
            if c.inline else " — con imagen de referencia"
        )
        lineas.append(f"- {c.nombre} ({c.tipo}, {c.importancia}){extra}")
    return "\n".join(lineas)


@observe(name="director")
async def dirigir(historia: str, ctx: Casting) -> list[Scene]:
    user = load_prompt("director_user").format(historia=historia, mundo=ctx.mundo, elenco=_elenco(ctx))
    r = await chat_json("director", load_prompt("director_system"), user)
    return normalizar_escenas(r, ctx)
