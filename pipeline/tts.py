"""TTS por escena con la máquina de estados ok / ajustar / cortar (todas las escenas en paralelo)."""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Literal

from langfuse import observe

from . import fal, ffmpeg
from .config import load_prompt, settings
from .voices import STABILITY_DEFAULT, VOZ_DEFAULT
from .llm import chat_json
from .models import Scene

MAX_INTENTOS = 2
MARGEN = 0.3 + 0.5  # itsoffset + cola para no cortar la última palabra
OPCIONES = (4, 6, 8)

Accion = Literal["ok", "ajustar", "cortar"]


def decidir_duracion(duracion_real: float, intentos: int, ya_ajustado: bool) -> tuple[Accion, int | None]:
    """Port exacto de `Decidir duración`."""
    dv = next((d for d in OPCIONES if d >= duracion_real + MARGEN), None)
    if dv is not None:
        return "ok", dv
    if duracion_real <= 9.5 and not ya_ajustado:
        return "ajustar", None
    if intentos < MAX_INTENTOS:
        return "cortar", None
    return "ok", 8


def armar_sub_escenas(r: dict, original: Scene) -> list[Scene]:
    subs = r.get("sub_escenas")
    if not isinstance(subs, list) or len(subs) < 2:
        raise ValueError(f"Splitter no devolvió 2 sub-escenas para {original.id}")
    out = []
    for i, s in enumerate(subs):
        out.append(Scene(
            id=str(s.get("id") or f"{original.id}{chr(97 + i)}"),
            narracion=str(s.get("narracion") or ""),
            prompt_visual=str(s.get("prompt_visual") or original.prompt_visual),
            prompt_movimiento=str(s.get("prompt_movimiento") or original.prompt_movimiento),
            personajes=list(original.personajes),
            transicion=original.transicion if i == 0 else "continua",
            intentos=original.intentos + 1,
            ya_ajustado=False,
            duration_seconds=None,
        ))
    return out


@observe(name="splitter")
async def dividir(e: Scene) -> list[Scene]:
    user = load_prompt("splitter_user").format(
        duracion_real=e.duracion_real, narracion=e.narracion,
        prompt_visual=e.prompt_visual, prompt_movimiento=e.prompt_movimiento, id=e.id,
    )
    r = await chat_json("splitter", load_prompt("splitter_system"), user)
    return armar_sub_escenas(r, e)


async def _sintetizar(e: Scene, workdir: Path) -> Scene:
    args = {"text": e.narracion, "voice": e.voz or VOZ_DEFAULT, "stability": STABILITY_DEFAULT,
            "similarity_boost": 0.75, "language_code": "es"}
    if e.duration_seconds:
        args["duration_seconds"] = e.duration_seconds
    res = await fal.llamar(settings.fal_tts, args, timeout_s=180, nombre="tts", meta={"escena": e.id})
    url = (res.get("audio") or {}).get("url")
    if not url:
        raise fal.FalError(f"TTS sin audio para la escena {e.id}: {res}")
    path = workdir / f"audio_{e.id}.mp3"
    await fal.descargar(url, path)
    real = await ffmpeg.duracion(path)
    return e.model_copy(update={"audio_url": url, "audio_path": path, "duracion_real": round(real, 1)})


@observe(name="tts_escena")
async def tts_escena(e: Scene, workdir: Path) -> list[Scene]:
    """Una escena → 1 o más escenas con audio listo (reintentos reentran aquí mismo)."""
    e = await _sintetizar(e, workdir)
    accion, dv = decidir_duracion(e.duracion_real, e.intentos, e.ya_ajustado)
    if accion == "ok":
        return [e.model_copy(update={"duracion_video": dv})]
    if accion == "ajustar":
        return await tts_escena(e.model_copy(update={"ya_ajustado": True, "duration_seconds": 7}), workdir)
    # cortar
    subs = await dividir(e)
    partes = await asyncio.gather(*(tts_escena(s, workdir) for s in subs))
    return [s for lote in partes for s in lote]


@observe(name="tts")
async def tts_todas(escenas: list[Scene], workdir: Path) -> list[Scene]:
    lotes = await asyncio.gather(*(tts_escena(e, workdir) for e in escenas))
    return [s for lote in lotes for s in lote]
