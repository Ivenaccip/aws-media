"""Gate de duración post-TTS (plan AWS, A3.3): el TTS cuesta centavos y Veo es
~85% del costo de una película, así que el momento de corregir un guion pasado
de largo es DESPUÉS del audio y ANTES de generar imágenes/video.

La película final dura la suma de los slots de video (4/6/8 s por escena), no
la del audio. Si esa suma excede el objetivo en más del 10%, se eligen las
escenas más largas, un LLM les recorta la narración al presupuesto de la voz
(pipeline.voices.tasa_habla) y SOLO esas escenas regeneran su TTS (~$0.01 c/u).

A3.4: pase lo que pase, el span `gate_duracion` registra presupuesto vs real en
Langfuse — si la tasa deriva (cambio de modelo de voz, etc.), se ve ahí."""
from __future__ import annotations

import asyncio
import logging
import math
from pathlib import Path

from langfuse import get_client, observe

from .config import load_prompt
from .llm import chat_json
from .models import Scene
from .tts import MARGEN, OPCIONES, tts_escena
from .voices import tasa_habla

TOLERANCIA = 0.10   # exceso permitido sobre el objetivo antes de recortar
PASO_SLOT = 2       # bajar una escena al slot anterior (8→6, 6→4) ahorra ~2 s

log = logging.getLogger("duracion")


def total_video_s(escenas: list[Scene]) -> int:
    return sum(e.duracion_video or 0 for e in escenas)


def elegir_recortes(escenas: list[Scene], objetivo_s: int) -> list[Scene]:
    """Escenas a acortar: las de slot más largo (y más palabras) primero, tantas
    como pasos de slot hagan falta para volver al rango. Las de 4 s no bajan más."""
    exceso = total_video_s(escenas) - objetivo_s * (1 + TOLERANCIA)
    if exceso <= 0:
        return []
    n = math.ceil(exceso / PASO_SLOT)
    candidatas = sorted((e for e in escenas if (e.duracion_video or 0) > OPCIONES[0]),
                        key=lambda e: ((e.duracion_video or 0), len(e.narracion.split())),
                        reverse=True)
    return candidatas[:n]


def palabras_objetivo(e: Scene) -> int:
    """Palabras que caben en el slot inmediatamente menor, a la tasa de SU voz."""
    slot_menor = max(OPCIONES[0], (e.duracion_video or OPCIONES[-1]) - PASO_SLOT)
    return max(4, int(tasa_habla(e.voz) * (slot_menor - MARGEN)))


def interpretar_recorte(r: dict, original: str, palabras_max: int) -> str:
    """Narración recortada del LLM, con red de seguridad: vacía → se queda la
    original; pasada del límite → corte duro por palabras."""
    txt = str((r or {}).get("narracion") or "").strip()
    if not txt:
        return original
    palabras = txt.split()
    if len(palabras) > palabras_max + 2:
        txt = " ".join(palabras[:palabras_max])
    return txt


@observe(name="recorte_escena")
async def recortar_escena(e: Scene, workdir: Path) -> list[Scene]:
    palabras_max = palabras_objetivo(e)
    user = load_prompt("recorte_user").format(
        id=e.id, palabras=len(e.narracion.split()),
        narracion=e.narracion, palabras_max=palabras_max)
    r = await chat_json("recorte", load_prompt("recorte_system"), user)
    nueva = interpretar_recorte(r, e.narracion, palabras_max)
    get_client().update_current_span(output={
        "antes": len(e.narracion.split()), "despues": len(nueva.split()), "max": palabras_max})
    log.info("escena %s recortada: %d → %d palabras (máx %d)",
             e.id, len(e.narracion.split()), len(nueva.split()), palabras_max)
    e2 = e.model_copy(update={"narracion": nueva, "intentos": 0, "ya_ajustado": False,
                              "duration_seconds": None, "duracion_video": None})
    return await tts_escena(e2, workdir)


@observe(name="gate_duracion")
async def aplicar_gate(escenas: list[Scene], objetivo_s: int, workdir: Path) -> list[Scene]:
    lf = get_client()
    antes = total_video_s(escenas)
    lf.update_current_span(input={
        "objetivo_s": objetivo_s, "estimado_s": antes,
        "desvio": round(antes / objetivo_s - 1, 3)})
    recortes = elegir_recortes(escenas, objetivo_s)
    if not recortes:
        lf.update_current_span(output={"recortadas": 0, "final_s": antes})
        log.info("gate: %ds para objetivo %ds — dentro de rango", antes, objetivo_s)
        return escenas
    log.info("gate: %ds estimados para objetivo %ds (+%.0f%%) — recortando %s",
             antes, objetivo_s, (antes / objetivo_s - 1) * 100, [e.id for e in recortes])
    lotes = await asyncio.gather(*(recortar_escena(e, workdir) for e in recortes))
    por_id = {e.id: lote for e, lote in zip(recortes, lotes)}
    salida: list[Scene] = []
    for e in escenas:
        salida.extend(por_id.get(e.id, [e]))
    despues = total_video_s(salida)
    lf.update_current_span(output={"recortadas": len(recortes), "final_s": despues})
    if despues > objetivo_s * (1 + TOLERANCIA):
        lf.update_current_span(level="WARNING",
                               status_message=f"sigue {despues / objetivo_s - 1:+.0%} sobre objetivo tras recortar")
        log.warning("gate: tras recortar sigue en %ds (objetivo %ds) — se continúa", despues, objetivo_s)
    return salida
