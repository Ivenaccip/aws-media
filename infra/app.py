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


def _avisar_si_no_es_la_mas_nueva(ref: str, digest: str) -> None:
    """Grita cuando la imagen FIJADA no es la última que subió el CI.

    El 20-sep-2026 un deploy contestó `(no changes)` en los cuatro stacks y la
    lectura natural fue «ya estaba todo al día». Era lo contrario: un
    `set IMAGE_TAG=<sha>` de un deploy anterior seguía vivo en esa ventana de
    cmd —`set` dura lo que dure la ventana, no lo que dure el comando— así que
    CloudFormation recibió una imagen de dos merges atrás, que resultó ser
    justo la que ya estaba puesta. El arreglo de MIX no salió, y nadie lo supo
    hasta releer los logs.

    El dato que lo delataba SÍ se imprimía (la línea `imagen:` de arriba), pero
    es una línea gris entre cincuenta y se la lleva el scroll. Así que aquí no
    se decide nada, se dice en voz alta: fijar una imagen vieja es legítimo
    —es la vuelta atrás— y nada que impida desplegar a dos días del lanzamiento
    merece la pena. Lo que no es legítimo es no enterarse.

    El recuadro va con `=` y `>>>` a propósito: justo encima, jsii imprime el
    aviso de fin de vida de Node 20 con rayas de `!`, y dos recuadros iguales
    se leen como el mismo ruido de siempre.

    Silencioso si el ECR no contesta: esto es un aviso, no una comprobación de
    la que dependa el deploy."""
    try:
        import boto3
        imgs = boto3.client("ecr", region_name="us-east-1").describe_images(
            repositoryName="aws-media")["imageDetails"]
        ultima = max(imgs, key=lambda i: i["imagePushedAt"])
        if ultima["imageDigest"] == digest:
            return
        tags = [t for t in ultima.get("imageTags", []) if t != "latest"]
        nombre = tags[0] if tags else ultima["imageDigest"][:19]
        cuando = ultima["imagePushedAt"].strftime("%d-%b %H:%M UTC")
    except Exception:  # noqa: BLE001 — sin ECR no hay aviso, y ya está
        return

    raya = "=" * 70
    for linea in (
        "", raya,
        f">>> OJO: la imagen fijada ({ref[:12]}) NO es la más nueva del ECR.",
        f">>> La más nueva es {nombre}, subida el {cuando}.",
        ">>>",
        ">>> Si estás volviendo atrás a propósito, perfecto, sigue.",
        ">>> Si no: IMAGE_TAG viene heredado de esta ventana y este deploy",
        ">>> REVIERTE lo que ya está puesto (o no hace nada y dice",
        ">>> '(no changes)', que es igual de malo porque parece que sí).",
        ">>>",
        ">>> Para soltarlo:  cmd -> set IMAGE_TAG=",
        ">>>                 PowerShell -> Remove-Item Env:IMAGE_TAG",
        raya, "",
    ):
        print(linea, file=sys.stderr)


app = cdk.App()
digest = _digest_de(IMAGE_TAG)
# que el deploy diga en voz alta qué está poniendo: el digest es ilegible y el
# tag no aparece en ninguna parte del diff
print(f"imagen: {IMAGE_TAG} -> {digest}", file=sys.stderr)
# y el aviso DESPUÉS, para que sea lo último que se lee antes del deploy
if IMAGE_TAG != "latest":
    _avisar_si_no_es_la_mas_nueva(IMAGE_TAG, digest)
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
