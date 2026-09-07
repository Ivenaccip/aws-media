"""C4 — despacho de trabajos. Backend por env `JOBS_BACKEND`:

- "local" (default): el server lanza el trabajo en su propio proceso, como
  siempre (asyncio en app.py). Dev local intacto.
- "aws": preparar se ENCOLA en SQS (lo toma el worker Lambda, <10 min) y una
  producción ARRANCA la máquina de estados que corre Fargate (reglas duras del
  plan: producciones por Step Functions, renders largos por Fargate — la Lambda
  corta a los 15 min y una producción tarda 10-30).

El progreso no viaja por la cola: cada etapa hace p.guardar() → Postgres, y la
UI lo ve con el mismo polling de /api/proyectos/{id} de siempre.
"""
from __future__ import annotations

import json
import os
import time
from functools import lru_cache


def backend() -> str:
    return os.getenv("JOBS_BACKEND", "local")


@lru_cache(maxsize=1)
def _sqs():
    import boto3
    return boto3.client("sqs")


@lru_cache(maxsize=1)
def _sfn():
    import boto3
    return boto3.client("stepfunctions")


def mensaje_preparar(user_id: str, proyecto_id: str) -> dict:
    return {"tipo": "preparar", "user_id": user_id, "proyecto_id": proyecto_id}


def encolar_preparar(user_id: str, proyecto_id: str) -> None:
    _sqs().send_message(
        QueueUrl=os.environ["JOBS_QUEUE_URL"],
        MessageBody=json.dumps(mensaje_preparar(user_id, proyecto_id)))


def encolar_shorts_analizar(user_id: str, proyecto: str) -> None:
    """M8: transcripción (si falta) + candidatos LLM — trabajo corto en el
    worker Lambda; el progreso viaja por proyectos_editor.doc.shorts."""
    _sqs().send_message(
        QueueUrl=os.environ["JOBS_QUEUE_URL"],
        MessageBody=json.dumps({"tipo": "shorts_analizar",
                                "user_id": user_id, "proyecto": proyecto}))


def lanzar_shorts_render(user_id: str, proyecto: str) -> str:
    """M8: render de shorts (snap → extract → Remotion → export) en Fargate —
    misma state machine que la producción, otro comando. Los segmentos
    aprobados viajan por Postgres (doc.shorts.render), no por el input."""
    r = _sfn().start_execution(
        stateMachineArn=os.environ["PRODUCIR_SM_ARN"],
        name=f"shorts-{proyecto}-{int(time.time())}",
        input=json.dumps({
            "user_id": user_id, "proyecto_id": proyecto,
            "command": ["python", "-m", "worker.shorts_task", user_id, proyecto],
        }))
    return r["executionArn"]


def lanzar_editar(user_id: str, nombre: str) -> str:
    """M14: corrida de sugerencias de corte (transcribir si falta + LLM +
    proxy/manifest) — Fargate vía la state machine de siempre, otro comando
    (el proxy re-encodea el metraje completo: no cabe en la Lambda)."""
    r = _sfn().start_execution(
        stateMachineArn=os.environ["PRODUCIR_SM_ARN"],
        name=f"editar-{nombre}-{int(time.time())}",
        input=json.dumps({
            "user_id": user_id, "proyecto_id": nombre,
            "command": ["python", "-m", "worker.editar_task", user_id, nombre],
        }))
    return r["executionArn"]


def lanzar_render(user_id: str, nombre: str, estilo: str) -> str:
    """M7: render de un corte del editor — misma state machine y misma imagen
    que la producción (regla dura: renders largos por Fargate, nada de ffmpeg
    en la Lambda del API), solo cambia el comando."""
    r = _sfn().start_execution(
        stateMachineArn=os.environ["PRODUCIR_SM_ARN"],
        name=f"render-{nombre}-{int(time.time())}",
        input=json.dumps({
            "user_id": user_id, "proyecto_id": nombre,
            "command": ["python", "-m", "worker.render_task", user_id, nombre, estilo],
        }))
    return r["executionArn"]


def lanzar_produccion(user_id: str, proyecto_id: str) -> str:
    """Arranca la state machine. El nombre lleva timestamp: reintentar tras un
    error crea una ejecución nueva (los nombres de SFN son únicos 90 días)."""
    r = _sfn().start_execution(
        stateMachineArn=os.environ["PRODUCIR_SM_ARN"],
        name=f"{proyecto_id}-{int(time.time())}",
        # command viene armado desde aquí: SFN no interpola JsonPath en arrays
        input=json.dumps({
            "user_id": user_id, "proyecto_id": proyecto_id,
            "command": ["python", "-m", "worker.producir_task", user_id, proyecto_id],
        }))
    return r["executionArn"]
