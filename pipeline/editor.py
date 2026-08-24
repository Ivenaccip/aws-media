"""Editor de continuidad: el guionista fija QUÉ pasa en cada escena; este agente hace que se lea de corrido.
Mismo número de escenas, mismos hechos; solo hilo, conectores y ritmo."""
from __future__ import annotations

import logging

from langfuse import get_client, observe

from .config import load_prompt
from .llm import chat_json
from .project import EscenaGuion
from .writer import MAX_PALABRAS_ESCENA, presupuesto

log = logging.getLogger(__name__)

MIN_PALABRAS_ESCENA = 8
TOLERANCIA_TOTAL = 1.15  # el editor puede pasarse un 15 % del total antes de descartarse


def _palabras(t: str) -> int:
    return len(t.split())


def fusionar_edicion(original: list[EscenaGuion], r: dict, duracion_s: int) -> tuple[list[EscenaGuion], list[str]]:
    """Aplica la edición escena a escena, con validación. Devuelve (guion, avisos).
    Si el editor rompe la estructura (número de escenas) se descarta entero; si una escena
    se pasa de largo o queda vacía, se conserva la original de esa escena."""
    escenas = r.get("escenas")
    if not isinstance(escenas, list) or len(escenas) != len(original):
        return original, [f"editor descartado: devolvió {len(escenas) if isinstance(escenas, list) else 'nada'} escenas para {len(original)}"]
    editadas = {str(e.get("id")): str(e.get("narracion") or "").strip() for e in escenas if isinstance(e, dict)}
    out, avisos = [], []
    for o in original:
        nueva = editadas.get(o.id, "")
        if not nueva:
            avisos.append(f"escena {o.id}: sin texto del editor, se conserva la original")
            out.append(o)
        elif _palabras(nueva) > MAX_PALABRAS_ESCENA + 2:
            avisos.append(f"escena {o.id}: {_palabras(nueva)} palabras, se conserva la original")
            out.append(o)
        else:
            out.append(EscenaGuion(id=o.id, narracion=nueva))
    total = sum(_palabras(e.narracion) for e in out)
    tope = presupuesto(duracion_s)["palabras_max"] * TOLERANCIA_TOTAL
    if total > tope:
        return original, [f"editor descartado: {total} palabras supera el tope {tope:.0f}"]
    return out, avisos


@observe(name="editor_continuidad")
async def editar_continuidad(guion: list[EscenaGuion], duracion_s: int) -> list[EscenaGuion]:
    pres = presupuesto(duracion_s)
    datos = dict(n_escenas=len(guion), palabras_max=int(pres["palabras_max"] * 1.1),  # 10 % de holgura para conectores
                 min_palabras=MIN_PALABRAS_ESCENA, max_palabras=MAX_PALABRAS_ESCENA)
    user = load_prompt("editor_user").format(guion="\n".join(f"{e.id}. {e.narracion}" for e in guion), **datos)
    r = await chat_json("editor_continuidad", load_prompt("editor_system").format(**datos), user)
    nuevo, avisos = fusionar_edicion(guion, r, duracion_s)
    for a in avisos:
        log.warning("editor: %s", a)
    cambiadas = sum(1 for a, b in zip(guion, nuevo) if a.narracion != b.narracion)
    get_client().update_current_span(
        output={"cambiadas": cambiadas, "avisos": avisos, "palabras": sum(_palabras(e.narracion) for e in nuevo)},
        level="WARNING" if avisos else "DEFAULT", status_message="; ".join(avisos)[:200] or None,
    )
    return nuevo
