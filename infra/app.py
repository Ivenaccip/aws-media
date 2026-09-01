"""Infra del servicio (Fase 5) — CDK en Python, us-east-1.

Stacks:
  aws-media-base : rol OIDC para que GitHub Actions empuje la imagen a ECR
                   (sin access keys en GitHub). Se despliega UNA vez, primero.
  aws-media-api  : C1 "API viva" — Lambda contenedor (imagen de A4 en ECR,
                   Mangum) detrás de API Gateway HTTP + Cognito (pool creado;
                   la exigencia de login se cablea cuando el frontend tenga
                   pantalla de auth). reserved_concurrency=1: la app sigue
                   siendo single-worker hasta C2/C4 (regla dura del plan).
  aws-media-db   : C2 "estado" — Aurora Serverless v2 Postgres (mín 0 ACU con
                   auto-pausa, Data API). La Lambda queda fuera de la VPC.

Deploy (desde infra/, con el venv del repo en PATH):
  cdk deploy aws-media-base
  cdk deploy aws-media-db
  cdk deploy aws-media-api      # requiere la imagen :latest ya en ECR (CI)
Tras el primer deploy de db: python tools/db_migrate.py (esquema idempotente).
"""
import aws_cdk as cdk

from stacks.base import BaseStack
from stacks.api import ApiStack
from stacks.db import DbStack

ENV = cdk.Environment(account="191241816158", region="us-east-1")

app = cdk.App()
BaseStack(app, "aws-media-base", env=ENV)
db = DbStack(app, "aws-media-db", env=ENV)
ApiStack(app, "aws-media-api", env=ENV, cluster=db.cluster)
app.synth()
