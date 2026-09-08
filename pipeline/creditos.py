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
PISO_VENTA_USD = 0.015  # M6: valor de venta por crédito — base del margen

# M8 — shorts en la web (fallbacks espejo de tarifas.json §shorts)
SHORTS_TRANSCRIPCION_CR_5MIN = 2
SHORTS_ANALISIS_CR = 2
SHORTS_RENDER_CR = 2

# M14 — editar en la web (fallback espejo de tarifas.json §editar)
EDITAR_SUGERENCIAS_CR = 2

# M16.3 — b-roll del editor en la web (fallback espejo de tarifas.json §editar)
BROLL_SUGERENCIAS_CR = 2

try:
    _t = json.loads(_TARIFAS_JSON.read_text(encoding="utf-8"))
    _v = _t["video"]
    PREPARAR_CR = _v["preparar"]
    VIDEO_CR_POR_SEGUNDO = _v["por_segundo"]
    VIDEO_PREMIUM_CR_POR_SEGUNDO = _v["por_segundo_premium"]
    IMAGEN_CR = _v["imagen"]
    PACKS = _t.get("packs_usd", [])
    PISO_VENTA_USD = _t.get("economia", {}).get("piso_venta_usd_por_credito", PISO_VENTA_USD)
    _s = _t.get("shorts", {})
    SHORTS_TRANSCRIPCION_CR_5MIN = _s.get("transcripcion_por_5min", SHORTS_TRANSCRIPCION_CR_5MIN)
    SHORTS_ANALISIS_CR = _s.get("analisis", SHORTS_ANALISIS_CR)
    SHORTS_RENDER_CR = _s.get("render_por_short", SHORTS_RENDER_CR)
    EDITAR_SUGERENCIAS_CR = _t.get("editar", {}).get("sugerencias", EDITAR_SUGERENCIAS_CR)
    BROLL_SUGERENCIAS_CR = _t.get("editar", {}).get("broll_sugerencias", BROLL_SUGERENCIAS_CR)
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


def costo_shorts_analizar(duracion_s: float, con_transcript: bool) -> int:
    """M8: análisis de candidatos (LLM) + transcripción si el proyecto no trae
    canónico — 2 cr por cada 5 min empezados (cubre AssemblyAI de pricing.json)."""
    costo = SHORTS_ANALISIS_CR
    if not con_transcript:
        costo += SHORTS_TRANSCRIPCION_CR_5MIN * math.ceil(float(duracion_s) / 300)
    return costo


def costo_editar_sugerencias(duracion_s: float, con_transcript: bool) -> int:
    """M14: corrida de sugerencias de corte (LLM) + transcripción si el metraje
    no trae canónico — misma tarifa de transcripción que shorts (mismo vendor)."""
    costo = EDITAR_SUGERENCIAS_CR
    if not con_transcript:
        costo += SHORTS_TRANSCRIPCION_CR_5MIN * math.ceil(float(duracion_s) / 300)
    return costo


def costo_broll_sugerencias() -> int:
    """M16.3: propuestas de recursos visuales (LLM, no genera nada)."""
    return BROLL_SUGERENCIAS_CR


def costo_regen_imagenes(n: int) -> int:
    """M16.3: candidatos de imagen del popup g2 — tarifa de imagen × candidato."""
    return IMAGEN_CR * int(n)


def costo_regen_video(veo_segundos: int | float) -> int:
    """M16.3: animar una ventana con Veo — la regla de tarifas.json §video:
    're-generar una escena = por_segundo × segundos' (del clip de Veo 4/6/8)."""
    return math.ceil(VIDEO_CR_POR_SEGUNDO * float(veo_segundos))


def costo_shorts_render(n_shorts: int) -> int:
    """M8: Remotion + export en Fargate, por short aprobado."""
    return SHORTS_RENDER_CR * int(n_shorts)


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
