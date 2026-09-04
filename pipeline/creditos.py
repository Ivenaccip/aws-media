"""C5 — monedero de créditos: el gate duro de gasto por usuario.

Pieza de PLATAFORMA (docs/ECONOMIA.md): toda herramienta que queme dinero pasa
por aquí — estimar → saldo → ejecutar → liquidar. La tarifa en créditos vive en
tools/tarifas.json (tarifa de negocio; los dólares de vendors siguen SOLO en
tools/pricing.json).

Selección por env `CREDITOS_BACKEND`: "off" (default — dev local sigue igual
que siempre, sin monedero ni gates) | "postgres" (el servicio en AWS). Reglas
de la spec: se cobra la estimación redondeada hacia arriba ANTES de lanzar; un
fallo nuestro devuelve los créditos; lo que no quema dinero no gasta créditos.
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path

from . import db

_TARIFAS_JSON = Path(__file__).resolve().parent.parent / "tools" / "tarifas.json"

# Fallback si el JSON no existe (p. ej. tests aislados del paquete)
PREPARAR_CR = 10
VIDEO_CR_POR_SEGUNDO = 3
VIDEO_PREMIUM_CR_POR_SEGUNDO = 4
IMAGEN_CR = 2

PACKS: list[dict] = []  # M1: la UI enseña los packs en el CTA de recarga

try:
    _t = json.loads(_TARIFAS_JSON.read_text(encoding="utf-8"))
    _v = _t["video"]
    PREPARAR_CR = _v["preparar"]
    VIDEO_CR_POR_SEGUNDO = _v["por_segundo"]
    VIDEO_PREMIUM_CR_POR_SEGUNDO = _v["por_segundo_premium"]
    IMAGEN_CR = _v["imagen"]
    PACKS = _t.get("packs_usd", [])
except (FileNotFoundError, KeyError):
    pass  # fallback: tarifa de arriba (2026-09-02)


class SinSaldo(Exception):
    """El cobro no procede: saldo insuficiente (o monedero inexistente)."""

    def __init__(self, costo: int, saldo: int):
        self.costo, self.saldo = costo, saldo
        super().__init__(
            f"Créditos insuficientes: esta acción cuesta {costo} créditos "
            f"y tu saldo es {saldo}. Recarga créditos para continuar.")


def backend() -> str:
    return os.getenv("CREDITOS_BACKEND", "off")


def activo() -> bool:
    return backend() == "postgres"


# ---------------------------------------------------------------------------
# tarifa (créditos por acción)

def costo_preparar() -> int:
    return PREPARAR_CR


def costo_producir(duracion_s: int | float) -> int:
    """Producir se cobra por duración OBJETIVO: la estimación hacia arriba."""
    return math.ceil(VIDEO_CR_POR_SEGUNDO * float(duracion_s))


def costo_imagen() -> int:
    """Imagen estándar (M1: modificar la opción de personaje)."""
    return IMAGEN_CR


# ---------------------------------------------------------------------------
# operaciones del monedero (backend postgres; user = DEFAULT_USER_ID hoy)

def saldo(user_id: str | None = None) -> int:
    return db.saldo_creditos(user_id or db.usuario_actual())


def cobrar(creditos: int, referencia: str, user_id: str | None = None) -> int:
    """Debita ANTES de lanzar. Atómico (UPDATE condicionado en Postgres): si el
    saldo no alcanza, levanta SinSaldo y no pasa nada. Devuelve el saldo nuevo."""
    u = user_id or db.usuario_actual()
    nuevo = db.cobrar_creditos(u, int(creditos), referencia)
    if nuevo is None:
        raise SinSaldo(int(creditos), db.saldo_creditos(u))
    return nuevo


def abonar(creditos: int, tipo: str, referencia: str | None = None,
           user_id: str | None = None) -> int:
    return db.abonar_creditos(user_id or db.usuario_actual(), int(creditos),
                              tipo, referencia)


def devolver(creditos: int, referencia: str, user_id: str | None = None) -> int:
    """Fallo nuestro = créditos de vuelta (regla 3 de la spec)."""
    return abonar(int(creditos), "devolucion", referencia, user_id)
