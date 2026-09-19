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
  aws-media-media: C3 "media" — bucket S3 privado (subidas prefirmadas) +
                   CloudFront con OAC para servirlo.
  aws-media-jobs : C4 "trabajos" — SQS + worker Lambda (preparar), Fargate
                   4vCPU/8GB y Step Functions (producciones). Claves de API
                   en SSM /aws-media/env (tools/ssm_env.py).

Deploy (desde infra/, con el venv del repo en PATH):
  cdk deploy aws-media-base
  cdk deploy aws-media-db
  cdk deploy aws-media-api      # requiere la imagen :latest ya en ECR (CI)
Para desplegar un commit CONCRETO (o volver atrás), nómbralo por su sha:
  IMAGE_TAG=<sha> cdk deploy aws-media-api aws-media-jobs
Tras el primer deploy de db: python tools/db_migrate.py (esquema idempotente).
"""
import os
import sys

import aws_cdk as cdk

from stacks.base import BaseStack
from stacks.api import ApiStack
from stacks.db import DbStack
from stacks.jobs import JobsStack
from stacks.media import MediaStack

ENV = cdk.Environment(account="191241816158", region="us-east-1")


# Qué imagen se despliega. Por defecto la última construida, pero se puede
# NOMBRAR un commit, que es lo que arregla el problema de fondo:
#
#   IMAGE_TAG=<sha del commit> cdk deploy aws-media-api aws-media-jobs
#
# Sin esto, `cdk deploy` significa «pon lo que haya en :latest», o sea TODO lo
# mergeado desde el último deploy. Es todo o nada: un arreglo urgente arrastra
# con él cualquier cosa que se hubiera mergeado mientras tanto, la haya probado
# alguien o no. Y volver atrás no se podía pedir, solo esperar a que el CI
# reconstruyera el commit viejo.
#
# El CI etiqueta cada imagen con el sha del commit además de con `latest`
# (.github/workflows/docker.yml), así que el tag ya existe: solo faltaba poder
# pedirlo.
IMAGE_TAG = os.getenv("IMAGE_TAG", "latest")


def _digest_de(ref: str) -> str:
    """El digest REAL de una imagen del ECR.

    CloudFormation solo actualiza el código de la Lambda si cambia la cadena
    ImageUri — y "repo:latest" nunca cambia como cadena, así que un cdk deploy
    tras subir imagen nueva NO la despliega (mordió en C2: la función siguió con
    la imagen de C1). Por eso cada synth fija el digest REAL, no el tag.

    Si el tag lo pidió una persona y no se puede resolver, esto se PARA. Caer a
    `latest` ahí sería desplegar una imagen distinta de la que pidió, sin
    avisar: el peor final posible para un arreglo urgente o para una vuelta
    atrás. Solo el default aguanta sin credenciales, para que `cdk synth` siga
    funcionando en una máquina sin AWS."""
    try:
        import boto3
        img = boto3.client("ecr", region_name="us-east-1").describe_images(
            repositoryName="aws-media", imageIds=[{"imageTag": ref}])
        return img["imageDetails"][0]["imageDigest"]
    except Exception as e:  # noqa: BLE001
        if ref != "latest":
            raise SystemExit(
                f"ERROR: no existe la imagen '{ref}' en el ECR ({e}). "
                "Comprueba el sha (el CI etiqueta cada imagen con el del "
                "commit) y que su build de GitHub Actions haya terminado.") from e
        print(f"AVISO: sin digest de :latest ({e}); se usa el tag 'latest' y "
              "CloudFormation puede NO actualizar el código", file=sys.stderr)
        return "latest"


app = cdk.App()
digest = _digest_de(IMAGE_TAG)
# que el deploy diga en voz alta qué está poniendo: el digest es ilegible y el
# tag no aparece en ninguna parte del diff
print(f"imagen: {IMAGE_TAG} -> {digest}", file=sys.stderr)
BaseStack(app, "aws-media-base", env=ENV)
db = DbStack(app, "aws-media-db", env=ENV)
media = MediaStack(app, "aws-media-media", env=ENV)
jobs = JobsStack(app, "aws-media-jobs", env=ENV, cluster_db=db.cluster,
                 media_bucket=media.bucket,
                 cdn_domain=media.cdn.distribution_domain_name, image_ref=digest)
ApiStack(app, "aws-media-api", env=ENV, cluster=db.cluster,
         media_bucket=media.bucket, cdn_domain=media.cdn.distribution_domain_name,
         jobs_queue=jobs.queue, producir_sm=jobs.state_machine, image_ref=digest)
app.synth()
