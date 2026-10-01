"""RAG·23 — la traza de cada corrida de /automatiza en Langfuse, enmascarada.

Para que cuando alguien reporte un flujo que no sirve se pueda ver POR QUÉ:
con qué se buscó (camino y consulta), qué trozos salieron y a qué distancia,
con qué modelo se armó, cuántos intentos, qué dijo el validador y los tokens.

LO QUE SE ACORDÓ CON EL DUEÑO (30-sep):
- Solo corre si el worker público tiene SUS claves de Langfuse
  (LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY en `/publico/`, de un proyecto
  aparte con retención corta). Sin ellas no hace nada: hoy no llega nada.
- El texto del visitante es de un anónimo y puede traer datos personales:
  todo texto pasa por `enmascarar()` (correos, teléfonos) antes de salir.
- El vector de la petición NO viaja: vive en la tabla de corridas (RAG·20).
- El identificador que une ambos mundos es el número de corrida
  (`session_id` = automatiza-<id>).

Nada de esto puede tumbar una corrida: cualquier falla de Langfuse se traga.
"""
from __future__ import annotations

import contextvars
import logging
import os
import re
from contextlib import ExitStack, contextmanager

log = logging.getLogger(__name__)

_CORREO = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_TELEFONO = re.compile(r"(?<![\w/])(?:\+|\()?\d[\d\s().-]{7,}\d(?![\w/])")

# El cliente de Langfuse SOLO mientras hay una corrida abierta: las etapas
# (`etapa()`) cuelgan de ella y fuera de una corrida no mandan nada. Así la
# ingesta y el eval, que corren en la máquina del dueño con las claves de
# PLATAFORMA en el .env, nunca terminan trazados.
_EN_CORRIDA: contextvars.ContextVar = contextvars.ContextVar("trazas_rag_corrida", default=None)


def activo() -> bool:
    return bool(os.getenv("LANGFUSE_PUBLIC_KEY") and os.getenv("LANGFUSE_SECRET_KEY"))


def enmascarar(valor):
    """Correos y teléfonos fuera, en textos, listas y dicts."""
    if isinstance(valor, str):
        return _TELEFONO.sub("[teléfono]", _CORREO.sub("[correo]", valor))
    if isinstance(valor, dict):
        return {k: enmascarar(v) for k, v in valor.items()}
    if isinstance(valor, list):
        return [enmascarar(v) for v in valor]
    return valor


class _Nada:
    def update(self, **kw):
        pass


@contextmanager
def corrida(corrida_id: int, *, entrada: dict | None = None):
    """El span raíz de una corrida. Rinde un objeto con `.update(output=...,
    metadata=...)`; sin claves (o si Langfuse falla al abrir), uno que no hace
    nada. Una excepción del cuerpo SIEMPRE sale tal cual: la traza la anota,
    no la traga."""
    if not activo():
        yield _Nada()
        return
    pila = ExitStack()
    try:
        from langfuse import get_client, propagate_attributes
        cli = get_client()
        pila.enter_context(propagate_attributes(session_id=f"automatiza-{corrida_id}",
                                                tags=["automatiza", "publico"]))
        span = pila.enter_context(cli.start_as_current_observation(
            as_type="span", name="automatiza", input=enmascarar(entrada or {})))
    except Exception:  # noqa: BLE001 — la traza nunca tumba la corrida
        log.exception("corrida %s: no se pudo abrir la traza de Langfuse", corrida_id)
        pila.close()
        yield _Nada()
        return
    marca = _EN_CORRIDA.set(cli)
    try:
        with pila:
            yield _Enmascarado(span)
    finally:
        _EN_CORRIDA.reset(marca)
    try:
        cli.flush()
    except Exception:  # noqa: BLE001
        log.exception("corrida %s: no se pudo mandar la traza", corrida_id)


@contextmanager
def etapa(nombre: str, *, tipo: str = "span", entrada=None, **kw):
    """Una observación hija de la corrida abierta (reescribir, embeber,
    buscar, armar, revisar). `tipo` es el as_type de Langfuse (span,
    generation, embedding, retriever, guardrail); `kw` va tal cual (model,
    model_parameters…). Fuera de una corrida, o si Langfuse falla al abrir,
    rinde uno que no hace nada. Una excepción del cuerpo sale tal cual y queda
    anotada como ERROR."""
    cli = _EN_CORRIDA.get()
    if cli is None:
        yield _Nada()
        return
    pila = ExitStack()
    try:
        obs = pila.enter_context(cli.start_as_current_observation(
            as_type=tipo, name=nombre,
            input=enmascarar(entrada) if entrada is not None else None, **kw))
    except Exception:  # noqa: BLE001 — la traza nunca tumba la corrida
        log.exception("no se pudo abrir la etapa %s de la traza", nombre)
        pila.close()
        yield _Nada()
        return
    with pila:
        envuelta = _Enmascarado(obs)
        try:
            yield envuelta
        except Exception as e:
            envuelta.update(level="ERROR", status_message=f"{type(e).__name__}: {e}"[:300])
            raise


class _Enmascarado:
    def __init__(self, span):
        self._span = span

    def update(self, **kw):
        try:
            self._span.update(**{k: enmascarar(v) for k, v in kw.items()})
        except Exception:  # noqa: BLE001
            log.exception("no se pudo actualizar la traza")
