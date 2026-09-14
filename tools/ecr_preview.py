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

FN_API = "aws-media-api-ApiF70053CD-YeW12ZJZWsRm"
FN_WORKER = "aws-media-jobs-Worker11F36D0F-kpu3w964xy7A"


def _digest(uri: str) -> str:
    """De `…/aws-media@sha256:abc…` a `sha256:abc…`."""
    return uri.split("@")[-1] if "@" in uri else ""


def digests_vivos() -> dict[str, str]:
    """Lo que corre cada runtime. Si algo falla, se dice — no se asume vacío."""
    vivos: dict[str, str] = {}
    lam = boto3.client("lambda", region_name=REGION)
    for etiqueta, fn in (("Lambda API", FN_API), ("Lambda worker", FN_WORKER)):
        try:
            uri = lam.get_function(FunctionName=fn)["Code"]["ResolvedImageUri"]
            vivos[etiqueta] = _digest(uri)
        except Exception as e:                                    # noqa: BLE001
            vivos[etiqueta] = f"(no se pudo leer: {type(e).__name__})"

    ecs = boto3.client("ecs", region_name=REGION)
    try:
        arns = ecs.list_task_definitions(sort="DESC", maxResults=1)["taskDefinitionArns"]
        td = ecs.describe_task_definition(taskDefinition=arns[0])["taskDefinition"]
        vivos["Fargate"] = _digest(td["containerDefinitions"][0]["image"])
    except Exception as e:                                        # noqa: BLE001
        vivos["Fargate"] = f"(no se pudo leer: {type(e).__name__})"
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
        if dig.startswith("("):
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
