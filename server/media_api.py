"""C3 — media en S3: subidas prefirmadas navegador→S3 y servido por CloudFront.

Flujo: la UI pide un presign (PUT de 15 min), sube el archivo DIRECTO a S3 (el
video nunca pasa por la Lambda — el límite de payload de API Gateway es 10 MB y
un MP4 no cabe), y confirma; recién ahí se registra la subida en Postgres
(`proyectos_editor`, esquema C2) y se devuelve la URL de CloudFront.

Solo está activo con MEDIA_BUCKET en el env (el servicio en AWS). En local el
flujo de importar sigue siendo el de siempre: archivos en videos/ (F3.5).
El layout de claves espeja MEDIA_ROOT: videos/<proyecto>/subidas/<archivo> —
en C4 los ejecutores sincronizan ese prefijo a su FS local.
"""
from __future__ import annotations

import json
import os
import re
from functools import lru_cache

from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from pipeline import db

router = APIRouter(prefix="/api/media")

EXTS = {".mp4", ".mov", ".m4v"}
MAX_BYTES = 5 * 1024**3          # tope del PUT prefirmado de una sola parte
PRESIGN_S = 15 * 60


def _bucket() -> str:
    b = os.getenv("MEDIA_BUCKET", "")
    if not b:
        raise HTTPException(409, "subidas a S3 no disponibles en esta instalación "
                                 "(local: deja los archivos en videos/)")
    return b


@lru_cache(maxsize=1)
def _s3():
    import boto3
    return boto3.client("s3")


def _cdn(key: str) -> str:
    base = os.getenv("CDN_BASE", "").rstrip("/")
    return f"{base}/{key}" if base else key


def _validar_nombre(nombre: str) -> str:
    # misma regla que storage.ruta_proyecto: viene del navegador
    if not nombre or not nombre.replace("-", "").replace("_", "").isalnum():
        raise HTTPException(422, f"nombre de proyecto inválido: {nombre!r}")
    return nombre


def _sanear_archivo(archivo: str) -> str:
    nombre = os.path.basename(archivo.replace("\\", "/"))
    raiz, ext = os.path.splitext(nombre)
    if ext.lower() not in EXTS:
        raise HTTPException(422, f"extensión no soportada: {ext!r} (usa {sorted(EXTS)})")
    raiz = re.sub(r"[^A-Za-z0-9._-]+", "_", raiz).strip("._") or "video"
    return raiz + ext.lower()


class PresignIn(BaseModel):
    proyecto: str
    archivo: str
    content_type: str = "video/mp4"
    bytes: int = 0


class ConfirmarIn(BaseModel):
    proyecto: str
    key: str


@router.get("/config")
def config():
    """La UI decide si muestra la sección de subida según esto."""
    return {"activo": bool(os.getenv("MEDIA_BUCKET")), "cdn": os.getenv("CDN_BASE", "")}


@router.post("/presign")
def presign(body: PresignIn):
    bucket = _bucket()
    proyecto = _validar_nombre(body.proyecto)
    archivo = _sanear_archivo(body.archivo)
    if body.bytes > MAX_BYTES:
        raise HTTPException(422, "archivo demasiado grande (máx 5 GB por subida)")
    key = f"videos/{proyecto}/subidas/{archivo}"
    url = _s3().generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": body.content_type},
        ExpiresIn=PRESIGN_S)
    # el navegador debe mandar el mismo Content-Type: va dentro de la firma
    return {"url": url, "key": key, "content_type": body.content_type}


def _mio(key: str) -> None:
    """La key la manda el navegador: sin esto, cualquiera pediría la de otro."""
    if ".." in key or key.startswith("/"):
        raise HTTPException(422, "key inválida")
    partes = key.split("/")
    if len(partes) < 3:
        raise HTTPException(404, "no encontrado")
    if partes[0] == "videos":
        proyecto = _validar_nombre(partes[1])
        if db.cargar_proyecto_editor(db.usuario_actual(), proyecto) is None:
            raise HTTPException(404, "no encontrado")
        return
    if partes[0] == "imagenes" and partes[1] == db.usuario_actual():
        return
    raise HTTPException(404, "no encontrado")


@router.get("/descarga")
def descarga(key: str, nombre: str = ""):
    """Un enlace que DESCARGA, en vez de abrirse en una pestaña.

    El atributo `download` de un `<a>` lo IGNORA el navegador cuando el archivo
    vive en otro origen, y todo lo nuestro vive en el CDN: por eso «abrir /
    descargar» abría el mp4 en una pestaña y había que saber hacer clic derecho
    → guardar como. Lo reportaron los testers como «no hay botón de descargar»
    (M22 · D), y tenían razón: el botón estaba, pero no descargaba.

    La instrucción no puede viajar en el enlace, así que viaja en el archivo:
    S3 firma la URL con `Content-Disposition: attachment` y el navegador ya no
    tiene nada que decidir.
    """
    _mio(key)
    return RedirectResponse(url_firmada_descarga(key, nombre))


def url_firmada_descarga(key: str, nombre: str = "") -> str:
    """La URL de S3 que fuerza la descarga. NO valida pertenencia: quien llame
    ya tiene que haber comprobado que la key es de este usuario."""
    bucket = _bucket()
    archivo = re.sub(r"[^A-Za-z0-9._-]+", "-",
                     (nombre or key.rsplit("/", 1)[-1]))[:120] or "descarga"
    return _s3().generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key,
                "ResponseContentDisposition": f'attachment; filename="{archivo}"'},
        ExpiresIn=PRESIGN_S)


@router.post("/confirmar")
def confirmar(body: ConfirmarIn):
    bucket = _bucket()
    proyecto = _validar_nombre(body.proyecto)
    prefijo = f"videos/{proyecto}/subidas/"
    if not body.key.startswith(prefijo) or "/" in body.key[len(prefijo):]:
        raise HTTPException(422, "key fuera del proyecto declarado")
    try:
        head = _s3().head_object(Bucket=bucket, Key=body.key)
    except Exception:  # noqa: BLE001 — NoSuchKey/403 dan lo mismo hacia la UI
        raise HTTPException(404, "la subida no está en S3 (¿el PUT terminó bien?)")

    usuario = db.usuario_actual()
    doc = db.cargar_proyecto_editor(usuario, proyecto) or {"subidas": []}
    subida = {"key": body.key, "archivo": body.key.rsplit("/", 1)[-1],
              "bytes": head["ContentLength"], "cdn": _cdn(body.key)}
    doc["subidas"] = [s for s in doc.get("subidas", []) if s["key"] != body.key] + [subida]
    db.guardar_proyecto_editor(usuario, proyecto, json.dumps(doc, ensure_ascii=False))
    return subida


@router.get("/{proyecto}")
def subidas(proyecto: str):
    _bucket()
    doc = db.cargar_proyecto_editor(db.usuario_actual(), _validar_nombre(proyecto))
    return {"subidas": (doc or {}).get("subidas", [])}
