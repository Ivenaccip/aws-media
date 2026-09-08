"""M17 — cliente mínimo de Apify por API REST (sin SDK: dos endpoints).

Los actores que usamos y sus precios están en tools/pricing.json §apify; los
IDs viven en config.py (settings.apify_*). APIFY_TOKEN sale del entorno
(.env local / SSM en nube) y JAMÁS se imprime ni se loguea.
"""
from __future__ import annotations

import logging
import os
import time

log = logging.getLogger("apify")

BASE = "https://api.apify.com/v2"


class ApifyError(Exception):
    """El actor falló o no devolvió lo esperado."""


def _token() -> str:
    tok = os.getenv("APIFY_TOKEN")
    if not tok:
        raise ApifyError("Falta APIFY_TOKEN (súbelo con tools/ssm_env.py)")
    return tok


def correr(actor: str, entrada: dict, timeout_s: int = 900) -> list[dict]:
    """Corre un actor y devuelve los items de su dataset. El actor va en
    formato usuario~nombre (la API no acepta '/'). Espera con poll de 5 s."""
    import requests

    tok = _token()
    r = requests.post(f"{BASE}/acts/{actor}/runs", params={"token": tok},
                      json=entrada, timeout=60)
    r.raise_for_status()
    run = r.json()["data"]
    run_id, inicio = run["id"], time.time()
    while run["status"] in ("READY", "RUNNING"):
        if time.time() - inicio > timeout_s:
            raise ApifyError(f"{actor}: el run {run_id} no terminó en {timeout_s}s")
        time.sleep(5)
        r = requests.get(f"{BASE}/actor-runs/{run_id}", params={"token": tok}, timeout=60)
        r.raise_for_status()
        run = r.json()["data"]
    if run["status"] != "SUCCEEDED":
        raise ApifyError(f"{actor}: run {run_id} terminó en {run['status']}")
    r = requests.get(f"{BASE}/datasets/{run['defaultDatasetId']}/items",
                     params={"token": tok, "clean": "true"}, timeout=60)
    r.raise_for_status()
    items = r.json()
    if not items:
        raise ApifyError(f"{actor}: run {run_id} sin resultados")
    return items


def descargar_a_s3(url: str, bucket: str, key: str) -> int:
    """Baja un archivo (URL firmada del KV store del actor) directo a S3 en
    streaming — nunca toca el disco de la Lambda. Devuelve los bytes subidos."""
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
