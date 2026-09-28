"""Qué borraría la política de ECR, y si alguna imagen viva está en la lista.

    venv/Scripts/python tools/ecr_preview.py

No borra nada: lanza el preview de `infra/ecr-lifecycle.json` y lo cruza con los
digests que corren AHORA MISMO la Lambda del API, la del worker y la task
definition de Fargate.

Existe porque el peligro de una lifecycle policy en este repo no es obvio: las
Lambdas apuntan a un **digest**, no al tag `latest`. Si la imagen desplegada cae
fuera de las que se conservan, la función deja de poder arrancar contenedores
nuevos — y no avisa hasta el siguiente arranque en frío, que puede ser horas
después de que ECL haya hecho la limpieza.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import boto3

RAIZ = Path(__file__).resolve().parent.parent
POLITICA = RAIZ / "infra" / "ecr-lifecycle.json"
REPO = "aws-media"
REGION = "us-east-1"

# Los seis runtimes que corren una imagen de este ECR, resueltos desde
# CloudFormation y no cableados por nombre físico.
#
# Antes había dos constantes con los nombres físicos de producción
# («aws-media-api-ApiF70053CD-YeW12ZJZWsRm») y el Fargate salía de
# list_task_definitions(sort="DESC", maxResults=1) — «la más nueva de la
# cuenta». Las dos cosas se rompieron el 28-sep-2026, cuando nació el entorno
# dev: los nombres de dev no estaban en la lista, y «la más nueva» pasó a ser
# ambigua entre dos familias de task definition.
#
# El fallo no habría sido ruidoso, que es lo peor: la herramienta habría dicho
# «seguro de aplicar» con la imagen de dev en la lista de borrado.
#
# Los ids LÓGICOS sí son iguales en los dos entornos (mismo código de CDK), y
# además tests/test_entornos.py fija los de Cognito y SFN por la misma razón:
# renombrar un construct crea un recurso nuevo.
RUNTIMES = (
    ("API prod",     "aws-media-api",      "ApiF70053CD",        "lambda"),
    ("worker prod",  "aws-media-jobs",     "Worker11F36D0F",     "lambda"),
    ("Fargate prod", "aws-media-jobs",     "ProducirTd27D1DC84", "ecs"),
    ("API dev",      "aws-media-api-dev",  "ApiF70053CD",        "lambda"),
    ("worker dev",   "aws-media-jobs-dev", "Worker11F36D0F",     "lambda"),
    ("Fargate dev",  "aws-media-jobs-dev", "ProducirTd27D1DC84", "ecs"),
)


def _digest(uri: str) -> str:
    """De `…/aws-media@sha256:abc…` a `sha256:abc…`."""
    return uri.split("@")[-1] if "@" in uri else ""


NO_EXISTE = "(el stack no existe)"


def _fisico(cfn, stack: str, id_logico: str) -> str:
    """El nombre/ARN real de un recurso, o NO_EXISTE si el stack no está."""
    try:
        r = cfn.describe_stack_resource(StackName=stack, LogicalResourceId=id_logico)
        return r["StackResourceDetail"]["PhysicalResourceId"]
    except Exception as e:                                        # noqa: BLE001
        if "does not exist" in str(e):
            return NO_EXISTE
        raise


def digests_vivos() -> dict[str, str]:
    """Lo que corre cada runtime. Si algo falla, se dice — no se asume vacío.

    Un stack que NO existe sí es un ok: no hay imagen que proteger. Lo que no
    puede pasar por bueno es un stack que existe y no se deja leer."""
    vivos: dict[str, str] = {}
    cfn = boto3.client("cloudformation", region_name=REGION)
    lam = boto3.client("lambda", region_name=REGION)
    ecs = boto3.client("ecs", region_name=REGION)

    for etiqueta, stack, id_logico, tipo in RUNTIMES:
        try:
            fisico = _fisico(cfn, stack, id_logico)
            if fisico == NO_EXISTE:
                vivos[etiqueta] = NO_EXISTE
            elif tipo == "lambda":
                uri = lam.get_function(FunctionName=fisico)["Code"]["ResolvedImageUri"]
                vivos[etiqueta] = _digest(uri)
            else:
                td = ecs.describe_task_definition(taskDefinition=fisico)["taskDefinition"]
                vivos[etiqueta] = _digest(td["containerDefinitions"][0]["image"])
        except Exception as e:                                    # noqa: BLE001
            vivos[etiqueta] = f"(no se pudo leer: {type(e).__name__})"
    return vivos


def preview(ecr) -> list[dict]:
    texto = POLITICA.read_text(encoding="utf-8")
    try:
        ecr.start_lifecycle_policy_preview(repositoryName=REPO, lifecyclePolicyText=texto)
    except ecr.exceptions.LifecyclePolicyPreviewInProgressException:
        pass   # ya hay uno corriendo: nos vale ese

    for _ in range(30):
        r = ecr.get_lifecycle_policy_preview(repositoryName=REPO)
        if r["status"] == "COMPLETE":
            return r.get("previewResults", [])
        time.sleep(2)
    sys.exit("el preview no terminó en 60 s")


def main() -> int:
    ecr = boto3.client("ecr", region_name=REGION)
    reglas = json.loads(POLITICA.read_text(encoding="utf-8"))["rules"]
    conserva = reglas[0]["selection"].get("countNumber", "?")

    expira = preview(ecr)
    marcados = {x["imageDigest"] for x in expira}

    total = sum(len(p["imageDetails"]) for p in
                ecr.get_paginator("describe_images").paginate(repositoryName=REPO))
    bytes_fuera = bytes_total = 0
    for p in ecr.get_paginator("describe_images").paginate(repositoryName=REPO):
        for i in p["imageDetails"]:
            bytes_total += i["imageSizeInBytes"]
            if i["imageDigest"] in marcados:
                bytes_fuera += i["imageSizeInBytes"]

    print(f"politica: conserva las {conserva} mas recientes")
    print(f"  ahora:       {total:3d} imagenes  {bytes_total / 1e9:6.1f} GB")
    print(f"  expiraria:   {len(expira):3d} imagenes  {bytes_fuera / 1e9:6.1f} GB")
    print(f"  quedaria:    {total - len(expira):3d} imagenes  "
          f"{(bytes_total - bytes_fuera) / 1e9:6.1f} GB")
    print()

    vivos = digests_vivos()
    en_peligro = []
    for etiqueta, dig in vivos.items():
        if dig == NO_EXISTE:
            print(f"  -  {etiqueta:14s} {dig}")
        elif dig.startswith("("):
            print(f"  ?  {etiqueta:14s} {dig}")
            en_peligro.append(etiqueta)          # no poder comprobarlo NO es un ok
        elif dig in marcados:
            print(f"  !! {etiqueta:14s} {dig[:26]}...  EN LA LISTA DE BORRADO")
            en_peligro.append(etiqueta)
        else:
            print(f"  ok {etiqueta:14s} {dig[:26]}...  se conserva")

    print()
    if en_peligro:
        print("NO APLIQUES la politica: " + ", ".join(en_peligro))
        print("Despliega primero, o sube countNumber en infra/ecr-lifecycle.json.")
        return 1
    print("Seguro de aplicar: ninguna imagen viva se expira.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
