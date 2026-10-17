"""M13 — guardrail del brief: revisa el texto ANTES de cobrar y de lanzar el
pipeline. Los modelos generativos rechazan violencia explícita / contenido
sexual a mitad de la producción; mejor avisarle al usuario de entrada.

Falla ABIERTO: si el LLM no responde, se permite — los guardrails de los
vendors siguen atrás y un filtro caído no debe tumbar el producto.

RAG·7: en el camino público (/automatiza, internet abierto) falla CERRADO —
ahí no hay usuario con cuenta ni monedero detrás, y un filtro caído que deja
pasar todo es justo el agujero. `falla_cerrado=True` lo pide explícito y el
candado de identidad (db.en_camino_publico) lo fuerza aunque se olvide."""
from __future__ import annotations

import logging

from langfuse import observe
from pydantic import BaseModel

from . import db
from .config import load_prompt
from .llm import chat_json

log = logging.getLogger("moderacion")

MENSAJE_BASE = ("La IA no permite violencia explícita, sangre, contenido "
                "sexual ni odio. Ajusta tu texto para continuar.")


class Veredicto(BaseModel):
    permitido: bool
    motivo: str = ""
    # RAG·7: True cuando NO se pudo moderar (falla cerrado). Separa «tu texto
    # no pasa» de «ahorita no está disponible»: son mensajes distintos.
    caido: bool = False


async def _veredicto(texto: str, *, prompt: str, falla_cerrado: bool, publico: bool,
                     sin_trazas: bool) -> Veredicto:
    cerrado = falla_cerrado or db.en_camino_publico()
    texto = (texto or "").strip()
    if not texto:
        return Veredicto(permitido=True)
    try:
        # lo público con SU clave (capa 1); lo de plataforma, como siempre
        extra = {"publico": True} if publico else {}
        if sin_trazas:
            # Es una clasificación corta: con el razonamiento por defecto del modelo puede pasar de los
            # 8 s que COI le da a la moderación y dar un 504 que no era. Se pide el mismo esfuerzo bajo
            # que a COI (`COI_RAZONAMIENTO`, «minimal» por defecto); si el modelo no lo acepta, llm lo
            # reintenta sin él.
            from . import coi
            extra["sin_trazas"] = True
            extra["razonamiento"] = coi.razonamiento()
        r = await chat_json("moderar", load_prompt(prompt), texto[:4000], **extra)
    except Exception as err:  # noqa: BLE001
        # sin trazas el error se nombra por su clase y nada más: su texto podría
        # arrastrar pedazos de lo que la persona escribió
        causa = type(err).__name__ if sin_trazas else err
        if cerrado:
            log.error("moderación no disponible (%s) — se rechaza (falla cerrado)", causa)
            return Veredicto(permitido=False, caido=True)
        log.warning("moderación no disponible (%s) — se permite", causa)
        return Veredicto(permitido=True)
    r = r if isinstance(r, dict) else {}
    if cerrado:
        # Cerrado de verdad: solo un booleano JSON cuenta como veredicto. Sin
        # la llave (ni default a True), un "true" en texto o cualquier otra
        # cosa rara cuenta como no moderado.
        permitido = r.get("permitido")
        if not isinstance(permitido, bool):
            log.error("moderación respondió sin veredicto claro — se rechaza")
            return Veredicto(permitido=False, caido=True)
    else:
        permitido = bool(r.get("permitido", True))
    return Veredicto(permitido=permitido, motivo=str(r.get("motivo") or ""))


@observe(name="moderar")
async def _revisar_con_trazas(texto: str, *, prompt: str, falla_cerrado: bool,
                              publico: bool) -> Veredicto:
    return await _veredicto(texto, prompt=prompt, falla_cerrado=falla_cerrado,
                            publico=publico, sin_trazas=False)


async def revisar(texto: str, *, prompt: str = "moderar_system",
                  falla_cerrado: bool = False, publico: bool = False,
                  sin_trazas: bool = False) -> Veredicto:
    """Modera `texto`. Con `sin_trazas` la revisión NO deja nada en Langfuse:
    ni el span `moderar` (el decorador captura el texto como entrada y el
    veredicto como salida) ni la generation del modelo (va con el SDK pelón,
    ver llm.client_sin_trazas). Es el modo de COI, donde lo que la persona
    escribe no se guarda en ningún lado."""
    if sin_trazas:
        return await _veredicto(texto, prompt=prompt, falla_cerrado=falla_cerrado,
                                publico=publico, sin_trazas=True)
    return await _revisar_con_trazas(texto, prompt=prompt, falla_cerrado=falla_cerrado,
                                     publico=publico)
