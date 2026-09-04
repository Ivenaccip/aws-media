"""M6.1 — línea estimada de infra AWS por corrida.

AWS no factura por usuario final, así que el número fino se ESTIMA aquí:
segundos reales de cómputo × tarifa (tools/pricing.json, sección aws_infra) y
se escribe en la tabla `costes` con proveedor 'aws'. Como el dashboard admin
suma esa tabla, la infra aparece sola en el costo y el margen de cada usuario
y cada corrida — sin tocar la página.

Es una estimación deliberadamente conservadora del cómputo (Fargate/Lambda):
S3 ya se muestra aparte por prefijo en el dashboard, y Aurora/CloudFront/API
Gateway son compartidos y ruido a esta escala (Cost Explorer para el total).
Registrar jamás tumba una corrida: cualquier fallo aquí solo se loguea.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from . import db

log = logging.getLogger("costes_infra")

_PRICING_JSON = Path(__file__).resolve().parent.parent / "tools" / "pricing.json"

# Fallback si el JSON no existe (tests aislados) — us-east-1, 2026-09-04
FARGATE_USD_VCPU_HORA = 0.04048
FARGATE_USD_GB_HORA = 0.004445
LAMBDA_USD_GB_SEGUNDO = 0.0000166667

try:
    _aws = json.loads(_PRICING_JSON.read_text(encoding="utf-8"))["aws_infra"]
    FARGATE_USD_VCPU_HORA = _aws["fargate"]["usd_por_vcpu_hora"]
    FARGATE_USD_GB_HORA = _aws["fargate"]["usd_por_gb_hora"]
    LAMBDA_USD_GB_SEGUNDO = _aws["lambda"]["usd_por_gb_segundo"]
except (FileNotFoundError, KeyError):
    pass


def costo_fargate(segundos: float, vcpu: float = 4.0, gb: float = 8.0) -> float:
    """La tarea de producción corre en 4 vCPU / 8 GB (infra/stacks/jobs.py)."""
    horas = segundos / 3600
    return round((vcpu * FARGATE_USD_VCPU_HORA + gb * FARGATE_USD_GB_HORA) * horas, 4)


def costo_lambda(segundos: float, mb: int | None = None) -> float:
    """El runtime expone la memoria configurada; fallback = el worker (3008 MB)."""
    mb = mb or int(os.getenv("AWS_LAMBDA_FUNCTION_MEMORY_SIZE") or 3008)
    return round((mb / 1024) * segundos * LAMBDA_USD_GB_SEGUNDO, 4)


def registrar(user_id: str, proyecto_id: str, concepto: str, costo_usd: float) -> None:
    """Una fila en `costes` (proveedor 'aws'). Solo con estado en Postgres; un
    fallo aquí no puede costarle la corrida al usuario — se loguea y ya."""
    if db.backend() != "postgres" or costo_usd <= 0:
        return
    try:
        db.ejecutar(
            """INSERT INTO costes (user_id, proyecto_id, concepto, proveedor, costo_usd)
               VALUES (:u, :p, :c, 'aws', :usd)""",
            {"u": user_id, "p": proyecto_id, "c": concepto, "usd": costo_usd})
        log.info("%s: %s ≈ $%.4f de infra", proyecto_id, concepto, costo_usd)
    except Exception as err:  # noqa: BLE001
        log.warning("no se pudo registrar la infra de %s: %s", proyecto_id, err)
