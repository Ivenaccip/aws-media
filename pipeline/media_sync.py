"""C4 — sincronización de artefactos entre el FS efímero de un ejecutor y S3.

El layout de claves espeja MEDIA_ROOT (regla de C3):
  work/<user_id>/<proyecto>/...   artefactos del generador (refs, clips, película)
  videos/<nombre>/...             proyectos del editor (los crea el puente)

Sin MEDIA_BUCKET estas funciones son no-op: en local los archivos ya viven
donde deben. Nunca se borra nada de S3 desde aquí (las versiones no se borran).
"""
from __future__ import annotations

import mimetypes
import os
from functools import lru_cache
from pathlib import Path


def _bucket() -> str | None:
    return os.getenv("MEDIA_BUCKET") or None


@lru_cache(maxsize=1)
def _s3():
    import boto3
    return boto3.client("s3")


def prefijo_work(user_id: str, proyecto_id: str) -> str:
    return f"work/{user_id}/{proyecto_id}/"


def subir_dir(dir_local: Path, prefijo: str) -> int:
    """Sube el árbol completo bajo el prefijo. Devuelve cuántos archivos subió."""
    bucket = _bucket()
    dir_local = Path(dir_local)
    if not bucket or not dir_local.is_dir():
        return 0
    n = 0
    for f in sorted(dir_local.rglob("*")):
        if not f.is_file():
            continue
        key = prefijo + f.relative_to(dir_local).as_posix()
        tipo = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        _s3().upload_file(str(f), bucket, key, ExtraArgs={"ContentType": tipo})
        n += 1
    return n


def leer_texto(key: str) -> str | None:
    """Contenido de un objeto (UTF-8) o None si no existe / no hay bucket."""
    bucket = _bucket()
    if not bucket:
        return None
    try:
        r = _s3().get_object(Bucket=bucket, Key=key)
    except _s3().exceptions.NoSuchKey:
        return None
    return r["Body"].read().decode("utf-8")


def escribir_texto(key: str, texto: str, tipo: str = "application/json") -> None:
    _s3().put_object(Bucket=_bucket(), Key=key,
                     Body=texto.encode("utf-8"), ContentType=tipo)


def respaldar(key: str, key_respaldo: str) -> None:
    """Copia dentro del bucket ANTES de sobreescribir (las versiones no se
    borran: el original queda bajo el prefijo de respaldos)."""
    bucket = _bucket()
    _s3().copy_object(Bucket=bucket, Key=key_respaldo,
                      CopySource={"Bucket": bucket, "Key": key})


def subir_archivo(local: Path, key: str) -> None:
    tipo = mimetypes.guess_type(str(local))[0] or "application/octet-stream"
    _s3().upload_file(str(local), _bucket(), key, ExtraArgs={"ContentType": tipo})


def bajar_prefijo(prefijo: str, dir_local: Path) -> int:
    """Baja todo lo que haya bajo el prefijo al directorio local."""
    bucket = _bucket()
    if not bucket:
        return 0
    dir_local = Path(dir_local)
    n = 0
    pag = _s3().get_paginator("list_objects_v2")
    for pagina in pag.paginate(Bucket=bucket, Prefix=prefijo):
        for obj in pagina.get("Contents", []):
            rel = obj["Key"][len(prefijo):]
            if not rel or rel.endswith("/"):
                continue
            destino = dir_local / rel
            destino.parent.mkdir(parents=True, exist_ok=True)
            _s3().download_file(bucket, obj["Key"], str(destino))
            n += 1
    return n
