"""Entrypoint de Lambda (Fase 5 C1): la MISMA app FastAPI del producto, servida
por API Gateway vía Mangum. En el contenedor Lambda el filesystem es de solo
lectura salvo /tmp — C1 no escribe nada (MEDIA_ROOT=/data horneado vacío en la
imagen); las escrituras llegan con C2 (Postgres) y C3 (S3).

lifespan="off": la app no usa eventos de startup/shutdown y Mangum los saltea.
"""
from mangum import Mangum

from server.app import app

handler = Mangum(app, lifespan="off")
