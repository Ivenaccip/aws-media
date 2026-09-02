"""Carga las claves de API desde SSM Parameter Store al entorno del proceso.

En AWS no hay .env: las claves viven como SecureString bajo SSM_ENV_PREFIX
(default /aws-media/env — las sube tools/ssm_env.py). Se llama ANTES de importar
pipeline: los clientes (openai/fal/langfuse) leen el env al crearse.

setdefault: una variable ya presente en el entorno (p. ej. de la Lambda) manda.
Hoy son claves de plataforma; C5 las vuelve por-usuario (decisión D4).
"""
from __future__ import annotations

import os


def cargar_env_ssm() -> int:
    prefijo = os.getenv("SSM_ENV_PREFIX", "")
    if not prefijo:
        return 0
    import boto3
    ssm = boto3.client("ssm")
    n = 0
    pag = ssm.get_paginator("get_parameters_by_path")
    for pagina in pag.paginate(Path=prefijo, Recursive=True, WithDecryption=True):
        for p in pagina["Parameters"]:
            nombre = p["Name"].rsplit("/", 1)[-1]
            if nombre not in os.environ:
                os.environ[nombre] = p["Value"]
                n += 1
    return n
