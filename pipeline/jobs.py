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


def encolar_shorts_importar(user_id: str, proyecto: str, url: str) -> None:
    """M17: bajar un video de YouTube (Apify) a S3 como subida del proyecto —
    trabajo corto en el worker Lambda; el progreso viaja por doc.importar."""
    _sqs().send_message(
        QueueUrl=os.environ["JOBS_QUEUE_URL"],
        MessageBody=json.dumps({"tipo": "shorts_importar", "user_id": user_id,
                                "proyecto": proyecto, "url": url}))


def encolar_estilo_analizar(user_id: str, estilo_id: str, url: str,
                            plataforma: str) -> None:
    """M18: perfil de estilo de un reel/TikTok (Apify + ffmpeg + visión) —
    trabajo corto en el worker Lambda; el progreso viaja por el doc en S3."""
    _sqs().send_message(
        QueueUrl=os.environ["JOBS_QUEUE_URL"],
        MessageBody=json.dumps({"tipo": "estilo_analizar", "user_id": user_id,
                                "estilo_id": estilo_id, "url": url,
                                "plataforma": plataforma}))


def encolar_competencia(user_id: str, informe_id: str, cuentas: list[dict]) -> None:
    """M23 C5: traer las últimas publicaciones de las cuentas vigiladas (Apify,
    una corrida por cuenta) y leerlas con el LLM — trabajo corto en el worker
    Lambda; el progreso viaja por el doc del informe en S3."""
    _sqs().send_message(
        QueueUrl=os.environ["JOBS_QUEUE_URL"],
        MessageBody=json.dumps({"tipo": "competencia", "user_id": user_id,
                                "informe_id": informe_id, "cuentas": cuentas}))


def encolar_clip(user_id: str, clip_id: str) -> None:
    """M25 A: el clip de 8 s — trabajo corto en el worker Lambda, NO una
    producción de Fargate. Así no consume slot de proyecto (nadie se topa con
    el 409 de server/app.py por pedir un clip), no hay estado `revision` ni
    Step Functions, y el cobro y la devolución son uno solo. El mensaje lleva
    solo ids: el pedido vive en el doc del clip en S3."""
    _sqs().send_message(
        QueueUrl=os.environ["JOBS_QUEUE_URL"],
        MessageBody=json.dumps({"tipo": "clip", "user_id": user_id,
                                "clip_id": clip_id}))


def encolar_publicar(user_id: str, proyecto: str, pub_id: str) -> None:
    """M23 C2: subir la película a Blotato y crear el post. El mensaje solo
    lleva ids: la clave del usuario la lee el worker, y el texto vive en la
    publicación (pipeline/publicaciones.py)."""
    _sqs().send_message(
        QueueUrl=os.environ["JOBS_QUEUE_URL"],
        MessageBody=json.dumps({"tipo": "publicar", "user_id": user_id,
                                "proyecto": proyecto, "id": pub_id}))


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


def lanzar_subtitulos(user_id: str, nombre: str) -> str:
    """M16.1: quemado de subtítulos del editor — el re-encode del video completo
    va a Fargate (regla dura: nada de ffmpeg largo en la Lambda del API)."""
    r = _sfn().start_execution(
        stateMachineArn=os.environ["PRODUCIR_SM_ARN"],
        name=f"subs-{nombre}-{int(time.time())}",
        input=json.dumps({
            "user_id": user_id, "proyecto_id": nombre,
            "command": ["python", "-m", "worker.subtitulos_task", user_id, nombre],
        }))
    return r["executionArn"]


def lanzar_overlay(user_id: str, nombre: str) -> str:
    """M16.3: regenerar/activar una versión de la pista 2 — Veo tarda minutos y
    rearmar la película es ffmpeg largo: Fargate por la SM de siempre. Los
    parámetros del job viajan por proyectos_editor.doc.overlay_job."""
    r = _sfn().start_execution(
        stateMachineArn=os.environ["PRODUCIR_SM_ARN"],
        name=f"overlay-{nombre}-{int(time.time())}",
        input=json.dumps({
            "user_id": user_id, "proyecto_id": nombre,
            "command": ["python", "-m", "worker.overlay_task", user_id, nombre],
        }))
    return r["executionArn"]


def lanzar_produccion(user_id: str, proyecto_id: str, fase: str = "todo") -> str:
    """Arranca la state machine. El nombre lleva timestamp: reintentar tras un
    error crea una ejecución nueva (los nombres de SFN son únicos 90 días).

    `fase` (M22 · G) viaja como un argumento más del comando, que se arma aquí
    mismo: partir la producción en dos NO toca la definición de la state
    machine ni el task definition, así que no necesita deploy de CDK."""
    r = _sfn().start_execution(
        stateMachineArn=os.environ["PRODUCIR_SM_ARN"],
        name=f"{proyecto_id}-{int(time.time())}",
        # command viene armado desde aquí: SFN no interpola JsonPath en arrays
        input=json.dumps({
            "user_id": user_id, "proyecto_id": proyecto_id,
            "command": ["python", "-m", "worker.producir_task", user_id, proyecto_id, fase],
        }))
    return r["executionArn"]
