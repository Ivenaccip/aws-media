"""Entrypoint de Lambda: la MISMA app FastAPI del producto, servida por API
Gateway vía Mangum. En el contenedor Lambda el filesystem es de solo lectura
salvo /tmp; el estado vive en Postgres (C2) y el media en S3 (C3).

Las claves de API se cargan desde SSM ANTES de importar la app (C4): los
clientes (fal/openai/langfuse) leen el entorno al crearse — así funcionan la
muestra de voz y la estimación también en el API.

lifespan="off": la app no usa eventos de startup/shutdown y Mangum los saltea.
"""
from worker.env_ssm import cargar_env_ssm

cargar_env_ssm()

from mangum import Mangum

from server.app import app

handler = Mangum(app, lifespan="off")
