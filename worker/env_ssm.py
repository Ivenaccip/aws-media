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


# Valor de plataforma (o None si no había) de cada variable que alguna vez
# pisó la clave de un usuario. Una Lambda caliente atiende a varios usuarios
# seguidos: sin esto, el siguiente heredaba las claves del anterior (su
# CLAUDE_API_KEY, su BLOTATO_API_KEY) si él no tenía las suyas.
_BASE: dict[str, str | None] = {}


def restaurar_env_base() -> None:
    """Deja el entorno como estaba antes de cargar las claves de un usuario."""
    for nombre, valor in _BASE.items():
        if valor is None:
            os.environ.pop(nombre, None)
        else:
            os.environ[nombre] = valor


def cargar_env_usuario(user_id: str) -> int:
    """C5 (decisión D4) — claves POR-USUARIO: SecureString bajo
    SSM_USUARIOS_PREFIX/<user_id>/CLAVE (las sube tools/ssm_env.py --usuario).
    A diferencia de las de plataforma, estas PISAN el entorno: la clave del
    usuario (p. ej. su BLOTATO_API_KEY) manda sobre la de la casa. Llamar
    después de fijar DEFAULT_USER_ID y antes de importar pipeline.

    Antes de cargar, deja el entorno como estaba sin usuario (M23 C)."""
    restaurar_env_base()
    prefijo = os.getenv("SSM_USUARIOS_PREFIX", "")
    if not prefijo or not user_id:
        return 0
    import boto3
    ssm = boto3.client("ssm")
    n = 0
    pag = ssm.get_paginator("get_parameters_by_path")
    ruta = f"{prefijo.rstrip('/')}/{user_id}/"
    for pagina in pag.paginate(Path=ruta, Recursive=True, WithDecryption=True):
        for p in pagina["Parameters"]:
            nombre = p["Name"].rsplit("/", 1)[-1]
            _BASE.setdefault(nombre, os.environ.get(nombre))
            os.environ[nombre] = p["Value"]
            n += 1
    return n
