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

import logging
import os
import re
from contextlib import ExitStack, contextmanager

log = logging.getLogger(__name__)

_CORREO = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_TELEFONO = re.compile(r"(?<![\w/])(?:\+|\()?\d[\d\s().-]{7,}\d(?![\w/])")


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
    with pila:
        yield _Enmascarado(span)
    try:
        cli.flush()
    except Exception:  # noqa: BLE001
        log.exception("corrida %s: no se pudo mandar la traza", corrida_id)


class _Enmascarado:
    def __init__(self, span):
        self._span = span

    def update(self, **kw):
        try:
            self._span.update(**{k: enmascarar(v) for k, v in kw.items()})
        except Exception:  # noqa: BLE001
            log.exception("no se pudo actualizar la traza")
