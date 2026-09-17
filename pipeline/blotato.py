"""Cliente HTTP de Blotato para fn2 (PLAN-FUSION.md F3.2) — API directa, no MCP.

Auth: header `blotato-api-key`. Docs verificadas 2026-08-24 y 2026-09-16 en
help.blotato.com/api y backend.blotato.com/openapi.json:
  GET  /v2/users/me/accounts            (401 clave inválida, 403 plan sin API)
  GET  /v2/users/me/accounts/{id}/subaccounts   páginas de Facebook/LinkedIn
  GET  /v2/social/pinterest/boards      tableros de Pinterest
  POST /v2/media/uploads                subida prefirmada
  POST /v2/posts                        scheduledTime va en la RAÍZ del cuerpo:
                                        dentro de `post` se ignora y se publica
                                        al instante
  GET  /v2/posts/{id}                   in-progress | scheduled | published | failed

M23 C: cada usuario conecta SU clave. Por eso ninguna función lee una clave
global: todas la reciben, y `clave_de(user_id)` es la única forma de
obtenerla. En el servicio NUNCA cae a una clave de la plataforma: publicaría
en la cuenta equivocada. En local cae al BLOTATO_API_KEY del .env, que es la
cuenta del dueño de la máquina.
"""
from __future__ import annotations

import logging
import mimetypes
import os
import re
from collections.abc import Iterable
from pathlib import Path
from urllib.parse import quote

import httpx

from . import claves_usuario

# httpx registra en INFO cada petición con la URL completa, y la URL
# prefirmada de subida lleva su token: el worker deja el log raíz en INFO
for _ruidoso in ("httpx", "httpcore"):
    if logging.getLogger(_ruidoso).getEffectiveLevel() < logging.WARNING:
        logging.getLogger(_ruidoso).setLevel(logging.WARNING)

BASE = "https://backend.blotato.com/v2"
TIMEOUT = httpx.Timeout(30, read=120)
# lo que espera una pantalla: la Lambda de la API corta a los 29 s
TIMEOUT_CORTO = httpx.Timeout(8)
# la película viaja en streaming: lo que cuenta es el tiempo entre trozos
TIMEOUT_SUBIDA = httpx.Timeout(30, read=600, write=600)
TROZO = 1024 * 1024
NOMBRE = "BLOTATO_API_KEY"
# una clave va en una cabecera: solo ASCII visible. Con otra cosa httpx ni
# envía (y h11 repite el valor entero en su excepción).
_FORMA = re.compile(r"[\x21-\x7e]{1,512}")
# ids que mandamos en una ruta o en el cuerpo (cuentas, páginas, posts)
_ID = re.compile(r"[A-Za-z0-9_-]{1,128}")

# M23 C2 — lo que pide cada red (openapi.json y /api/publish-post/media,
# 2026-09-16). Solo se anotan los límites que la doc da sin contradecirse:
# de Facebook dice «3–90 s y 1 GB» en una página y «4 h y 512 MB» en otra.
MAX_BYTES = 1_000_000_000          # tope de subida de Blotato (Starter: 400 MB)
MAX_BYTES_STARTER = 400_000_000
_PRIV_TIKTOK = (("PUBLIC_TO_EVERYONE", "Todo el mundo"),
                ("FOLLOWER_OF_CREATOR", "Mis seguidores"),
                ("MUTUAL_FOLLOW_FRIENDS", "Amigos (se siguen mutuamente)"),
                ("SELF_ONLY", "Solo yo"))
_PRIV_YOUTUBE = (("public", "Público"), ("unlisted", "No listado"), ("private", "Privado"))


def _red(nombre: str, texto: int, *, titulo: int | None = None,
         titulo_obligatorio: bool = False, privacidad: tuple | None = None,
         destino: str | None = None, destino_obligatorio: bool = False,
         ia: bool = False, vertical: bool = False, mb: int | None = None,
         seg: int | None = None, opciones: tuple = (), sin_signos: bool = False,
         texto_bytes: bool = False, hashtags: int | None = None) -> dict:
    return {"nombre": nombre, "texto": texto, "titulo": titulo,
            "titulo_obligatorio": titulo_obligatorio,
            "privacidad": [list(p) for p in privacidad] if privacidad else None,
            "destino": destino, "destino_obligatorio": destino_obligatorio,
            "ia": ia, "vertical": vertical, "mb": mb, "seg": seg,
            "opciones": list(opciones),
            # reglas del texto: sin < ni >, límite en bytes UTF-8, tope de hashtags
            "sin_signos": sin_signos, "texto_bytes": texto_bytes, "hashtags": hashtags}


REDES: dict[str, dict] = {
    # `title` en TikTok solo aplica a fotos: el video no lo lleva
    "tiktok": _red("TikTok", 2200, privacidad=_PRIV_TIKTOK, ia=True, mb=4000, seg=600,
                   opciones=("comentarios", "duo", "stitch", "marca_propia", "marca_pagada")),
    # la descripción de YouTube son 5000 BYTES y no admite < ni >
    "youtube": _red("YouTube", 5000, titulo=100, titulo_obligatorio=True,
                    privacidad=_PRIV_YOUTUBE, ia=True, opciones=("notificar", "para_ninos"),
                    sin_signos=True, texto_bytes=True),
    # Blotato corta en 5 hashtags
    "instagram": _red("Instagram", 2200, vertical=True, mb=300, seg=900, hashtags=5),
    # todo video de Facebook es Reel (9:16)
    "facebook": _red("Facebook", 5000, destino="pagina", destino_obligatorio=True,
                     vertical=True),
    # sin página, LinkedIn publica en el perfil personal
    "linkedin": _red("LinkedIn", 3000, destino="pagina", mb=500, seg=1800),
    "pinterest": _red("Pinterest", 800, titulo=100, destino="tablero",
                      destino_obligatorio=True, mb=2000, seg=300),
    "threads": _red("Threads", 500, mb=1000, seg=300),
    "twitter": _red("X", 280, mb=512, seg=140),
    "bluesky": _red("Bluesky", 300),
}


class ClaveInvalida(Exception):
    """Blotato rechazó la clave; el mensaje es para el usuario."""


class RespuestaInvalida(httpx.HTTPError):
    """Blotato respondió 2xx con algo que no es lo esperado (p. ej. una
    página de mantenimiento). Es un HTTPError: quien ya captura la red lo
    captura también."""


class SubidaRechazada(httpx.HTTPError):
    """El almacenamiento de Blotato rechazó el PUT del video (tamaño del plan,
    URL vencida…). No es la clave: la clave no viaja en ese PUT."""

    def __init__(self, codigo: int, detalle: str = ""):
        super().__init__("subida rechazada")
        self.codigo, self.detalle = codigo, detalle


def forma_valida(clave: str | None) -> bool:
    return bool(clave) and bool(_FORMA.fullmatch(clave))


def id_valido(valor: str | None) -> bool:
    return bool(_ID.fullmatch(valor or ""))


def _mensaje_de(resp: httpx.Response, clave: str | None) -> str:
    """El `message` que Blotato manda en sus errores (p. ej. «target.title:
    must NOT have fewer than 1 characters»), recortado y sin la clave."""
    try:
        datos = resp.json()
    except ValueError:
        return ""
    msg = datos.get("message") if isinstance(datos, dict) else None
    if not isinstance(msg, str):
        return ""
    msg = " ".join(msg.split())[:200]
    if clave:
        msg = msg.replace(clave, "***")
    return msg


def explicar_fallo(err: Exception, clave: str | None = None) -> tuple[str, bool]:
    """(mensaje para el usuario, ¿hay que reconectar?) de un fallo al hablar
    con Blotato. Nunca incluye el texto de la excepción (lleva URLs firmadas);
    sí el `message` que Blotato explica en un 422 o un 429."""
    if isinstance(err, SubidaRechazada):
        return ("Blotato no aceptó el archivo"
                + (f": {err.detalle.rstrip('.')}." if err.detalle else f" ({err.codigo}).")
                + " Intenta de nuevo; si se repite, revisa tu plan de Blotato.", False)
    if isinstance(err, httpx.HTTPStatusError):
        codigo = err.response.status_code
        if codigo in (401, 403):
            return ("Blotato ya no acepta tu clave. Quizá la regeneraste o cambió "
                    "tu plan: conéctala de nuevo.", True)
        detalle = _mensaje_de(err.response, clave)
        if codigo == 422:
            return ("Blotato no aceptó la publicación"
                    + (f": {detalle}" if detalle else ". Revisa los datos e intenta de nuevo."),
                    False)
        if codigo == 429:
            return ("Blotato pide esperar antes de publicar otra vez"
                    + (f": {detalle}" if detalle else "."), False)
        if codigo == 404:
            return "Blotato no encontró lo que pedimos. Revisa tu cuenta de Blotato.", False
        return (f"Blotato respondió con un error ({codigo}). "
                "Intenta de nuevo en un momento.", False)
    if isinstance(err, ClaveInvalida):
        return str(err), True
    return "Blotato no respondió. Intenta de nuevo en un momento.", False


def _permite_clave_env() -> bool:
    """La clave del .env solo vale en la máquina del dueño. Cualquier señal de
    estar en AWS o con login la apaga, no solo el prefijo de SSM."""
    return not (claves_usuario.en_nube()
                or os.getenv("AWS_LAMBDA_FUNCTION_NAME")
                or os.getenv("ECS_CONTAINER_METADATA_URI_V4")
                or os.getenv("COGNITO_POOL_ID"))


def clave_y_origen(user_id: str) -> tuple[str | None, str | None]:
    """(clave, origen) con la que se habla con Blotato en nombre de este usuario.

    origen: 'propia' (la conectó desde la web), 'env' (solo en local: la del
    .env) o None si no hay ninguna. Lanza claves_usuario.ErrorAlmacen si el
    almacén no respondió: eso no es lo mismo que «no conectado»."""
    propia = claves_usuario.leer(user_id, NOMBRE)
    if propia:
        return propia, "propia"
    if _permite_clave_env() and os.getenv(NOMBRE):
        return os.getenv(NOMBRE), "env"
    return None, None


def clave_de(user_id: str) -> str | None:
    return clave_y_origen(user_id)[0]


def _headers(clave: str) -> dict:
    if not clave:
        raise ClaveInvalida("Conecta tu cuenta de Blotato primero.")
    if not forma_valida(clave):
        raise ClaveInvalida("Tu clave de Blotato tiene caracteres que no son de una "
                            "clave. Conéctala de nuevo.")
    return {"blotato-api-key": clave}


def _json(r: httpx.Response) -> dict:
    try:
        datos = r.json()
    except ValueError:
        raise RespuestaInvalida("Blotato respondió algo que no es JSON") from None
    if not isinstance(datos, dict):
        raise RespuestaInvalida("Blotato respondió algo que no es un objeto")
    return datos


def _items(r: httpx.Response) -> list[dict]:
    items = _json(r).get("items", [])
    if not isinstance(items, list):
        raise RespuestaInvalida("Blotato respondió una lista inválida")
    return [c for c in items if isinstance(c, dict)]


def cuentas(clave: str, timeout: httpx.Timeout = TIMEOUT) -> list[dict]:
    """Redes realmente conectadas del usuario: [{id, platform, fullname, username}]."""
    r = httpx.get(f"{BASE}/users/me/accounts", headers=_headers(clave), timeout=timeout)
    r.raise_for_status()
    return _items(r)


def _destinos(r: httpx.Response) -> list[dict]:
    return [{"id": str(c.get("id") or ""), "nombre": str(c.get("name") or c.get("id") or "")}
            for c in _items(r) if id_valido(str(c.get("id") or ""))]


def subcuentas(clave: str, account_id: str, timeout: httpx.Timeout = TIMEOUT_CORTO) -> list[dict]:
    """Páginas de una cuenta de Facebook o LinkedIn: [{id, nombre}]."""
    if not id_valido(account_id):
        raise ValueError("cuenta de Blotato inválida")
    r = httpx.get(f"{BASE}/users/me/accounts/{quote(account_id)}/subaccounts",
                  headers=_headers(clave), timeout=timeout)
    r.raise_for_status()
    return _destinos(r)


def tableros(clave: str, account_id: str, timeout: httpx.Timeout = TIMEOUT_CORTO) -> list[dict]:
    """Tableros de una cuenta de Pinterest: [{id, nombre}]."""
    if not id_valido(account_id):
        raise ValueError("cuenta de Blotato inválida")
    r = httpx.get(f"{BASE}/social/pinterest/boards", params={"accountId": account_id},
                  headers=_headers(clave), timeout=timeout)
    r.raise_for_status()
    return _destinos(r)


def validar(clave: str, timeout: httpx.Timeout = TIMEOUT_CORTO) -> list[dict]:
    """Prueba la clave contra Blotato antes de guardarla; devuelve sus redes.

    ClaveInvalida si Blotato la rechaza; cualquier otro fallo (red, 5xx,
    respuesta rara) se propaga como httpx.HTTPError: no es culpa de la clave."""
    try:
        return cuentas(clave, timeout)
    except httpx.HTTPStatusError as err:
        codigo = err.response.status_code
        if codigo == 401:
            raise ClaveInvalida(
                "Blotato no reconoce esa clave. Cópiala otra vez desde "
                "Settings → API, completa (a veces termina en «=»).") from None
        if codigo == 403:
            raise ClaveInvalida(
                "Blotato aceptó la clave pero no deja usar su API con tu plan. "
                "La API no viene en la prueba gratis: revisa tu suscripción "
                "en Blotato.") from None
        raise


def subir_stream(clave: str, nombre: str, partes: Iterable[bytes], tam: int) -> str:
    """Subida prefirmada sin cargar el archivo en memoria ni en disco: devuelve
    la URL de Blotato que va en mediaUrls.

    El Content-Length explícito hace que httpx mande el cuerpo por trozos SIN
    `Transfer-Encoding: chunked`, que una URL prefirmada no acepta. La URL
    prefirmada caduca pronto: se pide justo antes de subir."""
    r = httpx.post(f"{BASE}/media/uploads", headers=_headers(clave),
                   json={"filename": nombre}, timeout=TIMEOUT)
    r.raise_for_status()
    datos = _json(r)
    firmada, publica = datos.get("presignedUrl"), datos.get("publicUrl")
    if not (isinstance(firmada, str) and firmada.startswith("https://")
            and isinstance(publica, str) and publica.startswith("https://")):
        raise RespuestaInvalida("Blotato no devolvió dónde subir el video")
    mime = mimetypes.guess_type(nombre)[0] or "video/mp4"
    subida = httpx.put(firmada, content=partes,
                       headers={"Content-Type": mime, "Content-Length": str(tam)},
                       timeout=TIMEOUT_SUBIDA)
    if subida.is_error:
        raise SubidaRechazada(subida.status_code, _mensaje_de(subida, clave))
    return publica


def trozos(f, tam: int = TROZO) -> Iterable[bytes]:
    return iter(lambda: f.read(tam), b"")


def subir_video(clave: str, path: Path) -> str:
    """Lo mismo desde un archivo local."""
    _headers(clave)                       # sin clave no se abre nada
    with path.open("rb") as f:
        return subir_stream(clave, path.name, trozos(f), path.stat().st_size)


_HASHTAG = re.compile(r"(?<![\w#])#\w+")


def revisar_texto(plataforma: str, texto: str) -> None:
    """ValueError (para el usuario) si el texto rompe una regla de la red que
    solo se descubriría después de subir el video."""
    red = REDES[plataforma]
    nombre = red["nombre"]
    if len(texto) > red["texto"]:
        raise ValueError(f"{nombre} acepta hasta {red['texto']} caracteres "
                         f"y el texto tiene {len(texto)}.")
    if red["texto_bytes"] and len(texto.encode("utf-8")) > red["texto"]:
        raise ValueError(f"El texto es muy largo para {nombre}: admite {red['texto']} "
                         "bytes, y los acentos y emojis cuentan doble o más.")
    if red["sin_signos"] and ("<" in texto or ">" in texto):
        raise ValueError(f"El texto de {nombre} no puede llevar los signos < ni >.")
    if red["hashtags"] and len(_HASHTAG.findall(texto)) > red["hashtags"]:
        raise ValueError(f"{nombre} acepta hasta {red['hashtags']} hashtags.")


def target_de(plataforma: str, datos: dict) -> dict:
    """`post.target` con lo que exige cada red. `datos` es lo que eligió el
    usuario: titulo, privacidad, destino, ia, notificar, para_ninos,
    comentarios, duo, stitch, marca_propia, marca_pagada.

    ValueError con un mensaje para el usuario si falta algo: sin estos campos
    Blotato responde 422 (TikTok pide siete, YouTube tres, Facebook la página
    y Pinterest el tablero)."""
    red = REDES.get(plataforma)
    if red is None:
        raise ValueError("Esa red no se puede usar desde aquí todavía.")
    nombre = red["nombre"]
    target: dict = {"targetType": plataforma}

    titulo = " ".join(str(datos.get("titulo") or "").split())
    if red["titulo"] and titulo:
        if len(titulo) > red["titulo"]:
            raise ValueError(f"El título de {nombre} admite hasta {red['titulo']} caracteres.")
        if "<" in titulo or ">" in titulo:
            raise ValueError("El título no puede llevar los signos < ni >.")
        target["title"] = titulo
    elif red["titulo_obligatorio"]:
        raise ValueError(f"{nombre} pide un título.")

    privacidad = datos.get("privacidad")
    if red["privacidad"] and privacidad not in [v for v, _ in red["privacidad"]]:
        raise ValueError(f"Elige quién puede ver el video en {nombre}.")

    destino = str(datos.get("destino") or "").strip()
    if red["destino"]:
        que = "la página" if red["destino"] == "pagina" else "el tablero"
        if destino:
            if not id_valido(destino) or (plataforma == "facebook" and not destino.isdigit()):
                raise ValueError(f"No reconocemos {que} elegida. Vuelve a abrir Publicar.")
            target["pageId" if red["destino"] == "pagina" else "boardId"] = destino
        elif red["destino_obligatorio"]:
            raise ValueError(f"Elige {que} de {nombre} donde se publica.")

    ia = bool(datos.get("ia", True))
    if plataforma == "tiktok":
        pagada = bool(datos.get("marca_pagada", False))
        # regla de TikTok: el contenido pagado por una marca no puede ser privado
        if pagada and privacidad == "SELF_ONLY":
            raise ValueError("En TikTok, el contenido pagado por una marca no puede "
                             "ser «Solo yo». Elige otra privacidad.")
        target.update(privacyLevel=privacidad,
                      disabledComments=not datos.get("comentarios", True),
                      disabledDuet=not datos.get("duo", True),
                      disabledStitch=not datos.get("stitch", True),
                      isBrandedContent=pagada,
                      isYourBrand=bool(datos.get("marca_propia", False)),
                      isAiGenerated=ia)
    elif plataforma == "youtube":
        target.update(privacyStatus=privacidad,
                      shouldNotifySubscribers=bool(datos.get("notificar", True)),
                      isMadeForKids=bool(datos.get("para_ninos", False)),
                      containsSyntheticMedia=ia)
    elif plataforma in ("facebook", "instagram"):
        target["mediaType"] = "reel"
    return target


def payload_post(account_id: str, platform: str, texto: str, media_urls: list[str],
                 scheduled_time: str | None = None, target: dict | None = None) -> dict:
    """Body de POST /v2/posts (separado para poder testearlo sin red)."""
    body: dict = {"post": {
        "accountId": str(account_id),
        "content": {"text": texto, "mediaUrls": media_urls, "platform": platform},
        "target": {**(target or {}), "targetType": platform},
    }}
    if scheduled_time:
        body["scheduledTime"] = scheduled_time
    return body


def publicar(clave: str, account_id: str, platform: str, texto: str,
             media_urls: list[str], scheduled_time: str | None = None,
             target: dict | None = None) -> dict:
    r = httpx.post(f"{BASE}/posts", headers=_headers(clave),
                   json=payload_post(account_id, platform, texto, media_urls,
                                     scheduled_time, target),
                   timeout=TIMEOUT)
    r.raise_for_status()
    return _json(r)


ESTADOS_POST = ("in-progress", "scheduled", "published", "failed")


def estado_post(clave: str, post_id: str, timeout: httpx.Timeout = TIMEOUT_CORTO) -> dict:
    """{status, publicUrl, errorMessage, scheduledTime} de una publicación."""
    if not id_valido(post_id):
        raise ValueError("publicación de Blotato inválida")
    r = httpx.get(f"{BASE}/posts/{quote(post_id)}", headers=_headers(clave), timeout=timeout)
    r.raise_for_status()
    datos = _json(r)
    if datos.get("status") not in ESTADOS_POST:
        raise RespuestaInvalida("Blotato devolvió un estado desconocido")
    return {k: datos.get(k) for k in ("status", "publicUrl", "errorMessage", "scheduledTime")}
