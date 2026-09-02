"""C4 — worker de trabajos cortos (<10 min): consume la cola SQS.

Hoy despacha:
  preparar : research → guion → voces → personaje (LLM + imágenes, 2-5 min).
             El estado avanza por Postgres (p.guardar() en cada etapa) y la UI
             lo ve con su polling de siempre.
  smoke    : verificación sin costo de que el worker alcanza Postgres y S3.

El env de claves se carga desde SSM ANTES de importar pipeline (los clientes
leen el entorno al crearse). Un mensaje que truena reintenta una vez y cae a
la DLQ (maxReceiveCount=2): preparar es re-ejecutable (sobrescribe etapas).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os

from worker.env_ssm import cargar_env_ssm

cargar_env_ssm()

# force=True: el runtime de Lambda ya instala un handler en el root logger y
# sin esto basicConfig es no-op (los INFO quedaban invisibles bajo WARNING)
logging.basicConfig(level=logging.INFO, force=True)
log = logging.getLogger("worker")


def _preparar(user_id: str, proyecto_id: str) -> None:
    os.environ["DEFAULT_USER_ID"] = user_id
    from pipeline import flow, media_sync
    from pipeline.project import cargar_proyecto

    p = cargar_proyecto(proyecto_id)
    if p is None:
        raise RuntimeError(f"proyecto {proyecto_id} no existe para {user_id}")
    prefijo = media_sync.prefijo_work(user_id, proyecto_id)
    bajados = media_sync.bajar_prefijo(prefijo, p.workdir)   # refs subidas por el API
    log.info("%s: %d artefactos bajados de S3", proyecto_id, bajados)
    asyncio.run(flow.preparar(p))
    subidos = media_sync.subir_dir(p.workdir, prefijo)       # personaje, cachés
    log.info("%s: preparar -> %s (%d artefactos a S3)", proyecto_id, p.estado, subidos)
    if p.estado == "error":
        # el estado ya quedó registrado en Postgres para la UI; no relanzamos
        # el mensaje (un guion fallido no mejora por reintentarse en la DLQ)
        log.error("%s: preparar terminó en error: %s", proyecto_id, p.error)


def _smoke() -> None:
    from pipeline import db, media_sync
    filas = db.ejecutar("SELECT count(*) AS n FROM proyectos_gen")
    ok_s3 = bool(media_sync._bucket())
    if ok_s3:
        media_sync._s3().head_bucket(Bucket=media_sync._bucket())
    log.info("smoke OK: postgres respondió (%s proyectos), s3 %s",
             filas[0]["n"], "accesible" if ok_s3 else "sin bucket")


def handler(event, context):  # noqa: ANN001 — firma de Lambda
    for rec in event.get("Records", []):
        j = json.loads(rec["body"])
        log.info("trabajo: %s", j.get("tipo"))
        if j["tipo"] == "preparar":
            _preparar(j["user_id"], j["proyecto_id"])
        elif j["tipo"] == "smoke":
            _smoke()
        else:
            raise ValueError(f"tipo de trabajo desconocido: {j['tipo']!r}")
    return {"ok": True}
