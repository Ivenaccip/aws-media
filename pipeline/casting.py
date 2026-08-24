"""Casting: un protagonista, secundarios inline, faltantes (solo el protagonista bloquea)."""
from __future__ import annotations

import json

from langfuse import observe

from .config import load_prompt
from .llm import chat_json
from .models import Biblioteca, Casting, Entidad
from .utils import norm

TIPOS = {"personaje", "prop", "lugar"}


def separar_casting(r: dict, bib: Biblioteca) -> Casting:
    """Port de `Separar casting`: cruza la respuesta del LLM con la biblioteca."""
    if not isinstance(r.get("casting"), list):
        raise ValueError(f"El casting no tiene el formato esperado: {json.dumps(r)[:300]}")

    biblioteca = {b["nombre"]: b for b in bib.entidades}
    principal = next((e for e in r["casting"] if e.get("importancia") == "principal"), {})
    protagonista = norm(r.get("protagonista") or principal.get("nombre"))
    if not protagonista:
        raise ValueError("El casting no identificó protagonista")

    casting: list[Entidad] = []
    for e in r["casting"]:
        nombre = norm(e.get("nombre"))
        ref = biblioteca.get(nombre)
        existe = bool(ref and ref.get("url"))
        casting.append(Entidad(
            nombre=nombre,
            tipo=e.get("tipo") if e.get("tipo") in TIPOS else "prop",
            importancia="principal" if nombre == protagonista else "secundario",
            existe=existe,
            inline=not existe,
            descriptor=(ref.get("descriptor") or "") if existe else str(e.get("descriptor") or ""),
            url=ref["url"] if existe else None,
        ))

    faltantes, motivos = [], []
    fila = biblioteca.get(protagonista)
    if not fila:
        faltantes.append(protagonista)
        motivos.append(f'"{protagonista}" no está en la hoja Biblioteca IA (o su estado no es "activo")')
    elif not fila.get("url"):
        faltantes.append(protagonista)
        motivos.append(f'"{protagonista}" está en la hoja pero no tiene url ni drive_id')

    return Casting(
        protagonista=protagonista,
        casting=[c for c in casting if c.nombre not in faltantes],
        faltantes=faltantes,
        motivos=motivos,
        mundo=str(r.get("mundo") or ""),
    )


def mensaje_faltantes(c: Casting) -> str:
    return (
        "⛔ No puedo generar el video: el protagonista no tiene hoja de referencia.\n\n"
        + "\n".join(f"• {m}" for m in c.motivos)
        + '\n\nSube su imagen a la carpeta Biblioteca y agrégalo a la hoja "Biblioteca IA" con: '
        "nombre (sin tildes), tipo, descriptor, drive_id (o url pública) y estado = activo. "
        "Luego vuelve a enviar la historia."
    )


@observe(name="casting")
async def hacer_casting(historia: str, bib: Biblioteca) -> Casting:
    user = load_prompt("casting_user").format(
        historia=historia,
        biblioteca_json=json.dumps(
            [{"nombre": b["nombre"], "tipo": b["tipo"], "descriptor": b["descriptor"]} for b in bib.entidades],
            ensure_ascii=False,
        ),
    )
    r = await chat_json("casting", load_prompt("casting_system"), user)
    return separar_casting(r, bib)
