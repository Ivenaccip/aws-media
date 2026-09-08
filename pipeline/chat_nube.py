"""M16.4 — chat editorial del editor en la nube, con la API de Claude.

El chat local (claude-agent-sdk) edita cuts.json con herramientas; en la nube
la v1 es un CONSEJERO: lee el transcript del proyecto y aconseja anclado en
segundos, sin editar nada. La clave sale de SSM por-usuario (D4:
/media-ivenaccip/usuarios/<id>/CLAUDE_API_KEY pisa a la de plataforma), el
system vive en prompts/chat_editor_system.md (sembrado en Langfuse, regla M10)
y CADA llamada se traza como generation con user_id y tokens — la tarifa es
0 créditos con tope de turnos/día mientras se mide el gasto real (decisión M7).
"""
from __future__ import annotations

import logging
import os
from functools import lru_cache

from langfuse import get_client, propagate_attributes

from .config import load_prompt

log = logging.getLogger("chat_nube")

MODELO = os.getenv("CHAT_MODEL", "claude-opus-5")
MAX_TOKENS = 1500          # respuestas de chat, cortas — y bajo el timeout del API GW
TURNOS_DIA = int(os.getenv("CHAT_TURNOS_DIA", "40"))
HISTORIAL_MAX = int(os.getenv("CHAT_HISTORIAL_MAX", "20"))  # turnos que viajan por llamada


class SinClave(Exception):
    """No hay CLAUDE_API_KEY ni en SSM del usuario ni en el entorno."""


@lru_cache(maxsize=64)
def clave_claude(user_id: str) -> str:
    """D4: la clave del usuario en SSM pisa a la de plataforma (entorno)."""
    prefijo = os.getenv("SSM_USUARIOS_PREFIX", "")
    if prefijo and user_id:
        try:
            import boto3
            r = boto3.client("ssm").get_parameter(
                Name=f"{prefijo.rstrip('/')}/{user_id}/CLAUDE_API_KEY",
                WithDecryption=True)
            return r["Parameter"]["Value"]
        except Exception:  # noqa: BLE001 — sin parámetro propio: cae a plataforma
            pass
    clave = os.getenv("CLAUDE_API_KEY") or os.getenv("ANTHROPIC_API_KEY")
    if not clave:
        raise SinClave(
            "El chat aún no está configurado: falta CLAUDE_API_KEY "
            "(súbela con: python tools/ssm_env.py --usuario <sub>)")
    return clave


def responder(name: str, user_id: str, contexto: str,
              historial: list[dict], texto: str) -> tuple[str, dict]:
    """Un turno del chat: historial [{role: user|assistant, text}] + mensaje
    nuevo → (respuesta, usage). Lanza SinClave si no hay credencial."""
    import anthropic

    system = [
        {"type": "text", "text": str(load_prompt("chat_editor_system"))},
        # el marcador de caché va en el ÚLTIMO bloque estable: cachea el
        # prefijo completo (system + transcript, miles de tokens) — con el
        # marcador en el primer bloque el transcript se pagaba entero por turno
        {"type": "text", "text": f"Contexto del proyecto «{name}»:\n{contexto}",
         "cache_control": {"type": "ephemeral"}},
    ]
    mensajes = [{"role": m["role"], "content": m["text"]}
                for m in historial if m.get("role") in ("user", "assistant") and m.get("text")]
    # techo al input en sesiones largas: solo los últimos turnos viajan
    mensajes = mensajes[-HISTORIAL_MAX:]
    mensajes.append({"role": "user", "content": texto})

    cliente = anthropic.Anthropic(api_key=clave_claude(user_id))
    with propagate_attributes(user_id=user_id, session_id=f"editor-{name}",
                              tags=["fusion", "chat", "nube"]):
        with get_client().start_as_current_observation(
                as_type="generation", name="chat_editor",
                model=MODELO, input={"texto": texto[:500], "turnos": len(mensajes)}) as gen:
            extra = {}
            if "opus" in MODELO:
                # recomendación del API: si el clasificador declina, otro modelo
                # de la casa completa el turno en la misma llamada — el parámetro
                # solo existe en Opus (Sonnet responde 400 si se manda)
                extra = {"betas": ["server-side-fallback-2026-07-01"],
                         "fallbacks": "default"}
            r = cliente.beta.messages.create(
                model=MODELO, max_tokens=MAX_TOKENS,
                # respuestas de chat: rápidas y baratas — el system pide brevedad
                output_config={"effort": "low"},
                system=system, messages=mensajes, **extra)
            if r.stop_reason == "refusal":
                respuesta = ("No puedo ayudar con eso desde este chat — "
                             "pregúntame sobre la edición de tu video.")
            else:
                respuesta = "".join(b.text for b in r.content if b.type == "text").strip()
            usage = {"input": r.usage.input_tokens, "output": r.usage.output_tokens,
                     # medir que la caché de verdad pega (0/0 = no cacheó nada)
                     "cache_write": getattr(r.usage, "cache_creation_input_tokens", 0) or 0,
                     "cache_read": getattr(r.usage, "cache_read_input_tokens", 0) or 0}
            gen.update(output=respuesta[:1000], usage_details=usage)
    get_client().flush()
    return respuesta, usage
