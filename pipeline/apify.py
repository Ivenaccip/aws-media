"""M17 — cliente mínimo de Apify por API REST (sin SDK: dos endpoints).

Los actores que usamos y sus precios están en tools/pricing.json §apify; los
IDs viven en config.py (settings.apify_*). APIFY_TOKEN sale del entorno
(.env local / SSM en nube) y JAMÁS se imprime ni se loguea.

El token viaja en la cabecera Authorization, nunca en la URL: requests mete
la URL completa en el mensaje del HTTPError, y ese mensaje llegaba a
CloudWatch, a doc.error y a la pantalla (visto 2026-09-13: un perfil de
estilo guardó «401 Client Error … runs?token=…»). Por si algo se cuela igual,
todo error que se guarde, registre o muestre pasa por tachar().
"""
from __future__ import annotations

import logging
import os
import re
import time
import traceback

log = logging.getLogger("apify")

BASE = "https://api.apify.com/v2"
TACHADO = "[tachado]"

# el valor de token=… (también access_token=…), los tokens con el prefijo de
# Apify y lo que venga tras «Bearer » si una cabecera acaba en un repr
_SECRETOS = re.compile(r"(?<=token=)[^&\s'\"#]+"
                       r"|apify_api_\w+"
                       r"|(?<=bearer )[^\s'\"]+", re.IGNORECASE)


class ApifyError(Exception):
    """El actor falló o no devolvió lo esperado."""


def _token() -> str:
    tok = os.getenv("APIFY_TOKEN")
    if not tok:
        raise ApifyError("Falta APIFY_TOKEN (súbelo con tools/ssm_env.py)")
    return tok


def _cabeceras() -> dict:
    return {"Authorization": f"Bearer {_token()}"}


def tachar(texto) -> str:
    """El texto sin credenciales. Además de los patrones tacha el valor
    literal de APIFY_TOKEN: los tokens viejos de Apify no traen prefijo."""
    texto = str(texto)
    tok = os.getenv("APIFY_TOKEN")
    if tok and len(tok) >= 8:
        texto = texto.replace(tok, TACHADO)
    return _SECRETOS.sub(TACHADO, texto)


def describir_error(err: BaseException, largo: int = 300) -> str:
    """«Tipo: mensaje» para doc.error. Se tacha ANTES de recortar: un corte a
    media URL no puede dejar medio token a la vista."""
    return tachar(f"{type(err).__name__}: {err}")[:largo]


def resumen_error(err: BaseException) -> str:
    """Para los logs: tipo, código HTTP si lo hay, y el mensaje tachado."""
    # sin «or»: un Response con error HTTP es falsy
    codigo = getattr(getattr(err, "response", None), "status_code", None)
    http = f" HTTP {codigo}" if codigo is not None else ""
    return f"{type(err).__name__}{http}: {tachar(err)[:300]}"


def registrar_fallo(logger: logging.Logger, err: BaseException, msg: str, *args) -> None:
    """En lugar de logger.exception(), que imprime el mensaje del error tal
    cual: primera línea con tipo y código HTTP, y debajo la traza tachada."""
    traza = "".join(traceback.format_exception(type(err), err, err.__traceback__))
    logger.error(msg + " — %s\n%s", *args, resumen_error(err), tachar(traza))


def correr(actor: str, entrada: dict, timeout_s: int = 900) -> list[dict]:
    """Corre un actor y devuelve los items de su dataset. El actor va en
    formato usuario~nombre (la API no acepta '/'). Espera con poll de 5 s."""
    import requests

    cab = _cabeceras()
    r = requests.post(f"{BASE}/acts/{actor}/runs", headers=cab,
                      json=entrada, timeout=60)
    r.raise_for_status()
    run = r.json()["data"]
    run_id, inicio = run["id"], time.time()
    while run["status"] in ("READY", "RUNNING"):
        if time.time() - inicio > timeout_s:
            raise ApifyError(f"{actor}: el run {run_id} no terminó en {timeout_s}s")
        time.sleep(5)
        r = requests.get(f"{BASE}/actor-runs/{run_id}", headers=cab, timeout=60)
        r.raise_for_status()
        run = r.json()["data"]
    if run["status"] != "SUCCEEDED":
        raise ApifyError(f"{actor}: run {run_id} terminó en {run['status']}")
    r = requests.get(f"{BASE}/datasets/{run['defaultDatasetId']}/items",
                     headers=cab, params={"clean": "true"}, timeout=60)
    r.raise_for_status()
    items = r.json()
    if not items:
        raise ApifyError(f"{actor}: run {run_id} sin resultados")
    return items


def descargar_a_s3(url: str, bucket: str, key: str) -> int:
    """Baja un archivo (URL firmada del KV store del actor) directo a S3 en
    streaming — nunca toca el disco de la Lambda. Devuelve los bytes subidos.
    Sin token a propósito: la URL la escribe el actor y ya viene firmada;
    mandarle la cabecera a un host que elige un tercero sería regalarla."""
    import boto3
    import requests

    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        r.raw.decode_content = True
        boto3.client("s3").upload_fileobj(
            r.raw, bucket, key,
            ExtraArgs={"ContentType": r.headers.get("Content-Type", "video/mp4")})
    head = boto3.client("s3").head_object(Bucket=bucket, Key=key)
    return int(head["ContentLength"])
