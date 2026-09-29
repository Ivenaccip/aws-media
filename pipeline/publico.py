"""RAG·5 — el freno de /automatiza: interruptor + tope diario.

Es el ÚNICO gate de gasto del camino público. El monedero no aplica —no hay
usuario (RAG·1)—, así que sin esto un bot podría gastar sin límite a cuenta
del dueño. Se consulta ANTES de aceptar una corrida (el API, RAG·8) y el
worker vuelve a mirar el interruptor antes de armar: apagar en una emergencia
corta también lo que ya estaba en la fila.

Falla CERRADO: si no se puede leer el interruptor o el consumo, la sección
está no disponible. Un tope que se abre cuando la base tose no es un tope.

El tope se cuenta al ENTRAR a la fila, no al salir (RAG·12): una corrida
aceptada ya está prometida. Con varias peticiones exactamente a la vez puede
pasarse por unas pocas —las que entren en el mismo instante—; es un tope de
presupuesto, no un contador bancario, y a cambio no hay candados.
"""
from __future__ import annotations

import logging

from pipeline import db

log = logging.getLogger("publico")

APAGADO = "apagado"
TOPE = "tope"


def permiso() -> str | None:
    """None si se puede aceptar una corrida más; si no, el motivo interno
    ('apagado' o 'tope'). El visitante ve lo mismo en los dos casos:
    «Ahorita no está disponible» (decisión del dueño, 28-sep)."""
    try:
        ajuste = db.automatiza_interruptor()
        if not ajuste or not ajuste["encendido"]:
            return APAGADO
        tope_c, tope_u = ajuste.get("tope_corridas"), ajuste.get("tope_usd")
        if tope_c is None and tope_u is None:
            # encendido sin ningún tope es justo lo que este módulo impide
            log.error("interruptor encendido sin tope: se trata como apagado")
            return APAGADO
        hoy = db.automatiza_consumo_hoy()
    except Exception:  # noqa: BLE001 — cualquier fallo al leer = cerrado
        log.exception("no se pudo leer el freno de /automatiza: cerrado")
        return APAGADO
    if tope_c is not None and hoy["corridas"] >= tope_c:
        return TOPE
    if tope_u is not None and hoy["usd"] >= tope_u:
        return TOPE
    return None


def encendido() -> bool:
    """Solo el interruptor, sin mirar el tope: lo usa el worker antes de
    armar. Lo que ya está en la fila fue aceptado dentro del tope; lo que no
    puede es seguir gastando si el dueño apagó."""
    try:
        ajuste = db.automatiza_interruptor()
    except Exception:  # noqa: BLE001
        log.exception("no se pudo leer el interruptor: cerrado")
        return False
    return bool(ajuste and ajuste["encendido"])
