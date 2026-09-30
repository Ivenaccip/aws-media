"""RAG·20/21 — el modelo que razona en /automatiza: Claude, por el API de Anthropic.

Decisión del dueño (30-sep, casilla «Qué modelo razona» de RAG·0): Claude Opus
5.5 por ahora; Claude Sonnet 5.5 queda como candidato y se decide con el eval
(tools/eval_rag.py, RAG·26). Por eso el modelo sale de RAG_MODELO y todo lo que
se guarda de una corrida lleva con qué modelo se hizo.

LA CLAVE: `CLAUDE_API_KEY` que carga el worker público desde `/publico/` (capa
1: una clave SOLO para lo público, con su propio tope de gasto; nunca la de
plataforma). En la máquina del dueño, `CLAUDE_API_KEY_PUBLICO` gana para no
usar por accidente la del `.env`.

Lo que se cuida en cada llamada:
- Opus 5.5 no deja apagar el razonamiento: se controla con `effort`, y su
  valor por defecto es `medium`, así que siempre se manda explícito.
- `fallbacks: "default"`: si el clasificador de seguridad declina, otro modelo
  de la casa completa la llamada. Si aun así termina en `refusal`, sube como
  Declinado y la corrida no sale; jamás se lee el contenido de un refusal.
- Nada de prefill ni `tool_choice` forzado (los dos dan 400 en estos modelos).

Precio: sin precio confirmado (ningún modelo de Claude está en tools/pricing.json);
se guardan los tokens de cada llamada para calcularlo cuando esté (RAG·24).
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field

MODELO_POR_DEFECTO = "claude-opus-5-5"
CANDIDATOS = ("claude-opus-5-5", "claude-sonnet-5-5")
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class SinClave(RuntimeError):
    """No hay clave de Claude para lo público."""


class Declinado(RuntimeError):
    """El modelo (y su respaldo) declinaron la petición."""


class RespuestaInvalida(ValueError):
    """El modelo no devolvió el JSON que se le pidió."""


@dataclass
class Uso:
    """Tokens acumulados de una corrida, por modelo (RAG·24)."""
    llamadas: list[dict] = field(default_factory=list)

    def sumar(self, etapa: str, modelo: str, r) -> None:
        u = r.usage
        self.llamadas.append({
            "etapa": etapa, "modelo": getattr(r, "model", modelo) or modelo,
            "entrada": u.input_tokens, "salida": u.output_tokens,
            "cache_escrita": getattr(u, "cache_creation_input_tokens", 0) or 0,
            "cache_leida": getattr(u, "cache_read_input_tokens", 0) or 0})

    def total(self) -> dict:
        t = {"entrada": 0, "salida": 0, "cache_escrita": 0, "cache_leida": 0}
        for ll in self.llamadas:
            for k in t:
                t[k] += ll[k]
        return t


def modelo() -> str:
    return os.getenv("RAG_MODELO", MODELO_POR_DEFECTO)


def clave() -> str:
    k = os.getenv("CLAUDE_API_KEY_PUBLICO") or os.getenv("CLAUDE_API_KEY")
    if not k:
        raise SinClave("falta CLAUDE_API_KEY (en el worker sale de /publico/)")
    return k


# El worker público tiene 5 minutos (infra/stacks/jobs.py) para reescribir,
# buscar, armar y, si hace falta, reintentar: ninguna llamada puede comerse
# todo el presupuesto.
TIMEOUT_SEG = 110
REINTENTOS_SDK = 1


def cliente():
    import anthropic
    return anthropic.Anthropic(api_key=clave(), timeout=TIMEOUT_SEG, max_retries=REINTENTOS_SDK)


_BLOQUE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)


def extraer_json(texto: str) -> dict:
    """El objeto JSON de la respuesta, aunque venga entre ``` o con una frase
    antes. Si no hay un objeto válido, RespuestaInvalida."""
    candidatos = [m.group(1) for m in _BLOQUE.finditer(texto)] + [texto]
    for c in candidatos:
        c = c.strip()
        ini, fin = c.find("{"), c.rfind("}")
        if ini == -1 or fin <= ini:
            continue
        try:
            obj = json.loads(c[ini:fin + 1])
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            return obj
    raise RespuestaInvalida("la respuesta no trae un objeto JSON")


def pedir_json(system: str, mensajes: list[dict], *, etapa: str, effort: str,
               max_tokens: int, uso: Uso | None = None, modelo_: str | None = None,
               cli=None) -> dict:
    """Una llamada que debe devolver UN objeto JSON."""
    m = modelo_ or modelo()
    cli = cli or cliente()
    # el system es estable entre corridas: se cachea (la lista de nodos y las
    # reglas pesan miles de tokens y se repiten en cada petición)
    sistema = [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
    r = cli.beta.messages.create(
        model=m, max_tokens=max_tokens, system=sistema, messages=mensajes,
        output_config={"effort": effort},
        betas=[FALLBACK_BETA], fallbacks="default")
    if uso is not None:
        uso.sumar(etapa, m, r)
    if r.stop_reason == "refusal":
        raise Declinado(f"{etapa}: el modelo declinó")
    if r.stop_reason == "max_tokens":
        raise RespuestaInvalida(f"{etapa}: la respuesta se cortó en max_tokens")
    texto = "".join(b.text for b in r.content if b.type == "text")
    return extraer_json(texto)


def reescritor(uso: Uso | None = None, cli=None, modelo_: str | None = None):
    """El `reescribir(system, user)` que espera pipeline/puente.py. Tarea
    corta: effort bajo."""
    def reescribir(system: str, user: str) -> dict:
        return pedir_json(system, [{"role": "user", "content": user}],
                          etapa="reescribir", effort="low", max_tokens=2000,
                          uso=uso, cli=cli, modelo_=modelo_)
    return reescribir
