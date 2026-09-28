"""Qué prefijos puede servir el CDN, en un solo lugar.

El bucket es privado (`BLOCK_ALL`), pero CloudFront lo lee con un Origin Access
Control y hasta hoy ese OAC tenía permiso sobre `<bucket>/*`: **el bucket
entero, servido a quien adivinara una clave**. Y las de `videos/` se adivinan,
porque su primer segmento es el nombre que el usuario le puso al proyecto:

    GET /videos/1/work/editor/proxy.mp4  ->  200, 1 109 965 bytes, sin login

Este módulo es la lista de lo que SÍ se sirve. Vive en `pipeline/`, en Python
puro y sin dependencias, porque lo leen dos mundos que no se hablan:

  - `infra/stacks/media.py`, para escribir la política del bucket —la que de
    verdad manda—;
  - `pipeline/media_sync.url_media()`, para que el servidor no le entregue al
    navegador una URL de CDN que va a contestar 403.

Si los dos dejaran de decir lo mismo, el síntoma no sería un error de deploy:
sería media rota en la cara del usuario. Por eso `tests/test_cdn_lista_blanca.py`
compara esta lista contra el template sintetizado.

**LA REGLA ES «DENEGAR SALVO LO LISTADO», y es deliberado.** El primer diseño
cortaba por extensión y fallaba ABIERTO: cualquier clave nueva que acabara en
`.mp4` nacía pública sola y ningún test se enteraba. Así no: un prefijo nuevo
nace CERRADO, y lo que se rompa se ve el primer día en vez de filtrarse callado.

**LO QUE ESTO NO RESUELVE, y queda escrito para que nadie lo lea como cerrado:**
`usuarios/<sub>/` y `work/<sub>/<proyecto>/` los sigue sirviendo el CDN sin
firma. No se adivinan —el `<sub>` es el UUID de Cognito— pero tampoco están
autenticados: quien tenga la URL, entra. Es seguridad por URL impronunciable, y
es deuda conocida, no un descuido.
"""
from __future__ import annotations

# Todos van indexados por el `sub` de Cognito, o son material compartido que no
# es de nadie (`voces/`). `videos/` NO está, y no debe volver: es el único cuyo
# primer segmento lo elige el usuario.
SERVIBLES_CDN: tuple[str, ...] = (
    "imagenes/",    # imagenes/<sub>/<12hex>.jpg
    "usuarios/",    # usuarios/<sub>/{clips,estilos,competencia}/
    "voces/",       # voces/<voz>.mp3 — muestras del catálogo
    "work/",        # work/<sub>/<proyecto>/ — artefactos del generador
)


def servible_por_cdn(key: str) -> bool:
    """¿Esta clave la sirve el CDN, o hay que firmarla?

    Es exactamente la misma pregunta que contesta la política del bucket, y por
    eso la contesta un solo sitio.
    """
    return key.lstrip("/").startswith(SERVIBLES_CDN)


def clave_desde_url(url: str, cdn_base: str) -> str | None:
    """La clave S3 que hay detrás de una URL de CDN ya guardada.

    Hace falta porque hay URLs absolutas del CDN **persistidas en Postgres**
    desde antes de la lista blanca (los ejecutores de render, subtítulos y
    producir las guardaban dentro del documento del editor). Esas URLs pasan a
    contestar 403, y la única forma de recuperarlas es volver a la clave y
    firmarla. El navegador ya hacía este mismo destripado en `shorts.html`.

    Devuelve None si la URL no es de este CDN: entonces no hay nada que
    reescribir y se deja como está.
    """
    if not url or not cdn_base:
        return None
    base = cdn_base.rstrip("/") + "/"
    return url[len(base):] if url.startswith(base) else None
