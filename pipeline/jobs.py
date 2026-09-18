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
import logging
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


# M23 · D (prerrequisito) — el freno de capacidad.
#
# La cuota es de 30 vCPU de Fargate on-demand y cada tarea pide 4, así que
# caben 7. El tope es 6 a propósito: una tarea que acaba de terminar puede
# seguir contando unos segundos, y pasarse del filo no falla suave — falla al
# ARRANCAR, que es justo el caso en el que el `creditos.devolver` vive dentro
# de un contenedor que nunca corrió (lo cura `worker/barredor.py`, pero curar
# es peor que no cortarse).
#
# Esto NO es la cola que pide el plan: es un freno. La diferencia importa. Una
# cola sirve cuando el trabajo puede esperar sin que nadie mire —MIX, cuando
# exista— y es lo peor que se le puede hacer a alguien que está frente a la
# pantalla esperando su película: prefiere un «ahorita no» inmediato a un
# «encolado» que no sabe cuánto dura.
TOPE_TAREAS = int(os.getenv("FARGATE_TOPE_TAREAS", "6"))


class SinCapacidad(RuntimeError):
    """No hay sitio en Fargate ahora mismo. `server/app.py` la traduce a 503."""


def _hay_sitio() -> bool:
    """Cuenta las ejecuciones vivas. Falla ABIERTO: si no se puede contar
    (throttling de SFN, permisos), se deja pasar. Bloquear a quien sí pagó
    porque una llamada de control no respondió es peor que pasarse del tope —
    y si se pasa, el barredor devuelve el dinero."""
    try:
        r = _sfn().list_executions(
            stateMachineArn=os.environ["PRODUCIR_SM_ARN"],
            statusFilter="RUNNING", maxResults=TOPE_TAREAS + 1)
        return len(r.get("executions", [])) < TOPE_TAREAS
    except Exception as e:
        # que se vea: un freno que falla abierto para siempre (permisos, por
        # ejemplo) no frena nada y desde fuera se comporta igual que uno sano
        logging.getLogger("jobs").warning("no se pudo contar la capacidad: %s", e)
        return True


def _arrancar(nombre: str, user_id: str, proyecto_id: str,
              command: list[str]) -> str:
    """Todo lo que va a Fargate pasa por aquí: una sola máquina de estados, un
    solo freno. El nombre lleva timestamp — reintentar tras un error crea una
    ejecución nueva (los nombres de SFN son únicos 90 días)."""
    if not _hay_sitio():
        raise SinCapacidad(
            "Ahorita hay mucha gente produciendo y no se te cobró. "
            "Vuelve a intentarlo en unos minutos.")
    r = _sfn().start_execution(
        stateMachineArn=os.environ["PRODUCIR_SM_ARN"],
        name=f"{nombre}-{int(time.time())}",
        # command viene armado desde aquí: SFN no interpola JsonPath en arrays
        input=json.dumps({"user_id": user_id, "proyecto_id": proyecto_id,
                          "command": command}))
    return r["executionArn"]


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
    return _arrancar(f"shorts-{proyecto}", user_id, proyecto,
                     ["python", "-m", "worker.shorts_task", user_id, proyecto])


def lanzar_editar(user_id: str, nombre: str) -> str:
    """M14: corrida de sugerencias de corte (transcribir si falta + LLM +
    proxy/manifest) — Fargate vía la state machine de siempre, otro comando
    (el proxy re-encodea el metraje completo: no cabe en la Lambda)."""
    return _arrancar(f"editar-{nombre}", user_id, nombre,
                     ["python", "-m", "worker.editar_task", user_id, nombre])


def lanzar_render(user_id: str, nombre: str, estilo: str) -> str:
    """M7: render de un corte del editor — misma state machine y misma imagen
    que la producción (regla dura: renders largos por Fargate, nada de ffmpeg
    en la Lambda del API), solo cambia el comando."""
    return _arrancar(f"render-{nombre}", user_id, nombre,
                     ["python", "-m", "worker.render_task", user_id, nombre, estilo])


def lanzar_subtitulos(user_id: str, nombre: str) -> str:
    """M16.1: quemado de subtítulos del editor — el re-encode del video completo
    va a Fargate (regla dura: nada de ffmpeg largo en la Lambda del API)."""
    return _arrancar(f"subs-{nombre}", user_id, nombre,
                     ["python", "-m", "worker.subtitulos_task", user_id, nombre])


def lanzar_overlay(user_id: str, nombre: str) -> str:
    """M16.3: regenerar/activar una versión de la pista 2 — Veo tarda minutos y
    rearmar la película es ffmpeg largo: Fargate por la SM de siempre. Los
    parámetros del job viajan por proyectos_editor.doc.overlay_job."""
    return _arrancar(f"overlay-{nombre}", user_id, nombre,
                     ["python", "-m", "worker.overlay_task", user_id, nombre])


def lanzar_produccion(user_id: str, proyecto_id: str, fase: str = "todo") -> str:
    """Arranca la state machine. El nombre lleva timestamp: reintentar tras un
    error crea una ejecución nueva (los nombres de SFN son únicos 90 días).

    `fase` (M22 · G) viaja como un argumento más del comando, que se arma aquí
    mismo: partir la producción en dos NO toca la definición de la state
    machine ni el task definition, así que no necesita deploy de CDK."""
    return _arrancar(proyecto_id, user_id, proyecto_id,
                     ["python", "-m", "worker.producir_task", user_id, proyecto_id, fase])
