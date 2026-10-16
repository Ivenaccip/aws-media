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

from pipeline import media_rutas


def _bucket() -> str | None:
    return os.getenv("MEDIA_BUCKET") or None


@lru_cache(maxsize=1)
def _s3():
    import boto3
    return boto3.client("s3")


def prefijo_work(user_id: str, proyecto_id: str) -> str:
    return f"work/{user_id}/{proyecto_id}/"


def url_media(key: str, expira: int = 3600) -> str | None:
    """La URL con la que alguien de fuera —el navegador, ffmpeg, Blotato— puede
    leer `key`.

    CDN si el prefijo está en la lista blanca de `media_rutas`; si no, una URL
    firmada de S3 que caduca. Devuelve None cuando no hay ni CDN ni bucket, que
    es la instalación local: ahí los archivos se sirven del disco y quien llama
    ya tiene ese camino.

    **Nadie debería armar `f"{CDN_BASE}/{key}"` a mano.** Esa es justo la forma
    que dejó ocho sitios sirviendo `videos/` sin login, y la que ahora devolvería
    403 sin que nada avise.

    OJO CON GUARDARLA: la firmada caduca. Lo que se persiste es la `key`, y la
    URL se arma al leer. Una URL firmada dentro de Postgres es una liga que
    funciona hasta que un día deja de funcionar y nadie sabe por qué.
    """
    key = key.lstrip("/")
    base = os.getenv("CDN_BASE", "").rstrip("/")
    if base and media_rutas.servible_por_cdn(key):
        return f"{base}/{key}"
    bucket = _bucket()
    if not bucket:
        return None
    return _s3().generate_presigned_url(
        "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=expira)


# Los campos donde los ejecutores dejaban una URL absoluta del CDN dentro del
# documento del editor. `cdn` es el de producir_task; `url` el de render,
# subtítulos y shorts.
_CAMPOS_URL = ("url", "cdn")


def refrescar_urls(doc):
    """Reescribe, sobre una COPIA, las URLs de media del documento del editor.

    Existe por una razón concreta: hasta hoy tres ejecutores guardaban en
    Postgres la URL absoluta del CDN (`f"{cdn}/videos/..."`). Con la lista
    blanca esas URLs pasan a contestar 403 — y son filas que ya existen, así
    que no basta con dejar de escribirlas.

    La regla es: **la clave se persiste, la URL se arma al leer.** Para las
    filas viejas que solo guardaron la URL, la clave se recupera destripándola
    (`media_rutas.clave_desde_url`), que es lo que el navegador ya hacía a mano
    en shorts.html.

    Se aplica al ENTREGAR el documento al navegador, nunca al cargarlo de la
    base: los ejecutores hacen cargar → modificar → guardar, y meter aquí una
    URL firmada la dejaría persistida con su caducidad dentro.
    """
    base = os.getenv("CDN_BASE", "").rstrip("/")

    def paso(nodo):
        if isinstance(nodo, list):
            return [paso(x) for x in nodo]
        if not isinstance(nodo, dict):
            return nodo
        fuera = {k: paso(v) for k, v in nodo.items()}
        key = fuera.get("key")
        if not key:
            # fila vieja sin `key`: la que guardaba subtitulos_task
            for campo in _CAMPOS_URL:
                key = media_rutas.clave_desde_url(fuera.get(campo) or "", base)
                if key:
                    break
        if not key or not isinstance(key, str):
            return fuera
        # la clave rescatada se deja puesta: `shorts.html` la prefiere sobre la
        # URL, y así las filas viejas dejan de depender de destriparla en JS
        fuera.setdefault("key", key)
        fresca = url_media(key)
        if fresca:
            for campo in _CAMPOS_URL:
                if fuera.get(campo):
                    fuera[campo] = fresca
        return fuera

    return paso(doc)


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


def listar_prefijo(prefijo: str) -> list[str]:
    """Claves bajo el prefijo (vacío sin bucket)."""
    return [k for k, _ in listar_prefijo_con_bytes(prefijo)]


def listar_prefijo_con_bytes(prefijo: str) -> list[tuple[str, int]]:
    """Igual, pero con el tamaño: la lista de descargables lo enseña y pedirlo
    objeto por objeto serían tantos HEAD como archivos."""
    bucket = _bucket()
    if not bucket:
        return []
    claves = []
    pag = _s3().get_paginator("list_objects_v2")
    for pagina in pag.paginate(Bucket=bucket, Prefix=prefijo):
        claves += [(obj["Key"], obj["Size"]) for obj in pagina.get("Contents", [])]
    return claves


def listar_prefijo_con_fecha(prefijo: str) -> list[tuple[str, float]]:
    """Claves con su última modificación (epoch): «Mis imágenes» las ordena de
    la más nueva a la más vieja sin pedir un HEAD por objeto."""
    bucket = _bucket()
    if not bucket:
        return []
    claves = []
    pag = _s3().get_paginator("list_objects_v2")
    for pagina in pag.paginate(Bucket=bucket, Prefix=prefijo):
        claves += [(obj["Key"], obj["LastModified"].timestamp())
                   for obj in pagina.get("Contents", [])]
    return claves


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


def leer_texto_con_etag(key: str) -> tuple[str | None, str | None]:
    """(contenido, etiqueta) de un objeto, o (None, None) si no existe / no hay bucket.
    La etiqueta es la que pide `escribir_texto_si` para saber que nadie lo cambió."""
    bucket = _bucket()
    if not bucket:
        return None, None
    try:
        r = _s3().get_object(Bucket=bucket, Key=key)
    except _s3().exceptions.NoSuchKey:
        return None, None
    return r["Body"].read().decode("utf-8"), r["ETag"]


def escribir_texto_si(key: str, texto: str, etag: str | None = None,
                      tipo: str = "application/json") -> str | None:
    """Escritura condicional de S3, la misma de pipeline/publicaciones.py: sin `etag`
    solo si el objeto NO existe (If-None-Match: *); con `etag`, solo si nadie lo cambió
    desde que se leyó (If-Match). Devuelve la etiqueta nueva, o None si otro llegó antes
    (cualquier otro error de S3 se levanta)."""
    s3 = _s3()
    extra = {"IfMatch": etag} if etag else {"IfNoneMatch": "*"}
    try:
        r = s3.put_object(Bucket=_bucket(), Key=key, Body=texto.encode("utf-8"),
                          ContentType=tipo, **extra)
    except s3.exceptions.ClientError as err:
        if err.response.get("Error", {}).get("Code") in ("PreconditionFailed",
                                                         "ConditionalRequestConflict"):
            return None
        raise
    return r["ETag"]


def respaldar(key: str, key_respaldo: str) -> None:
    """Copia dentro del bucket ANTES de sobreescribir (las versiones no se
    borran: el original queda bajo el prefijo de respaldos)."""
    bucket = _bucket()
    _s3().copy_object(Bucket=bucket, Key=key_respaldo,
                      CopySource={"Bucket": bucket, "Key": key})


def tamano(key: str) -> int | None:
    """ContentLength de un objeto (`head_object`), o None si no existe / no hay
    bucket. E2: el worker lo usa para no recopiar lo que ya está en la copia
    (un reintento reutiliza `videos/<copia>/clips/`). Solo es una optimización:
    si S3 contesta cualquier error del cliente (404, o un 403 sin permiso de
    listar), se trata como «no está» y el `copiar` que sigue dirá el error de
    verdad. Los fallos de red SÍ se propagan."""
    bucket = _bucket()
    if not bucket:
        return None
    s3 = _s3()
    try:
        r = s3.head_object(Bucket=bucket, Key=key)
    except s3.exceptions.ClientError:
        return None
    return int(r["ContentLength"])


def copiar(origen: str, destino: str, etag: str | None = None) -> None:
    """Copia `origen` → `destino` DENTRO del bucket, de servidor a servidor: no
    baja nada al ejecutor. Usa la copia gestionada del cliente (`s3.copy`):
    una sola pieza hasta el umbral y multiparte por encima, así que un video de
    más de 5 GB también pasa (`copy_object` de una pieza no lo admite).

    Levanta si el origen no existe (el HEAD previo da 404) y, de paso, FIJA el
    ETag del original: la copia se pide con `CopySourceIfMatch`, así que si
    alguien reemplazó el objeto entre que se midió y se copió, falla en vez de
    entregar una mezcla. Por defecto se fija el ETag que tiene el objeto AHORA;
    con `etag` (el que vio quien midió y cobró) se fija ese, y la ventana entre
    cotizar y copiar también queda cerrada. Nunca escribe en `origen`; el tipo
    de contenido se conserva (la copia multiparte lo preserva). Sin bucket no
    hay dónde copiar."""
    bucket = _bucket()
    if not bucket:
        raise RuntimeError("no hay MEDIA_BUCKET: no hay dónde copiar")
    s3 = _s3()
    cabecera = s3.head_object(Bucket=bucket, Key=origen)     # también levanta si el origen no existe
    s3.copy({"Bucket": bucket, "Key": origen}, bucket, destino,
            ExtraArgs={"CopySourceIfMatch": etag or cabecera["ETag"]})


def bajar_archivo(key: str, destino: Path) -> bool:
    """Baja UN objeto a un archivo local (para jobs que no necesitan el
    prefijo completo, p.ej. la muestra de subtítulos en la Lambda).
    Devuelve False si no existe o no hay bucket."""
    bucket = _bucket()
    if not bucket:
        return False
    destino = Path(destino)
    destino.parent.mkdir(parents=True, exist_ok=True)
    try:
        _s3().download_file(bucket, key, str(destino))
    except Exception:  # noqa: BLE001 — 404 de S3 llega como ClientError
        return False
    return True


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
