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

M23 C3 (Agenda) — lo que todavía NO ha salido, verificado 2026-09-17:
  GET    /v2/schedules                  SOLO futuros; página con `cursor` y un
                                        `count` que llega como STRING ("12")
  GET    /v2/schedules/{id}             la respuesta va ENVUELTA en {"schedule": …},
                                        al revés que /posts/{id}
  PATCH  /v2/schedules/{id}             {"patch": {...}} → 204 SIN cuerpo; el
                                        patch NO hace merge
  DELETE /v2/schedules/{id}             → 204 SIN cuerpo

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
    URL vencida…). No es la clave: la clave no viaja en ese PUT. `codigo` 0 =
    la conexión se cortó a mitad (un almacenamiento que rechaza un archivo
    grande suele cerrar sin esperar el cuerpo, y el 413 nunca llega)."""

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


# M23 C3 — un 404 de /schedules no es «revisa tu cuenta»: significa que eso ya
# salió o ya no existe, y cada pantalla lo cuenta a su manera.
CONTEXTOS = ("publicacion", "agenda", "reprogramar", "cancelar")

# Ninguno manda «Actualiza la lista»: la pantalla ya recarga sola al recibir el
# 404, así que pedirlo sería mandar a hacer algo que acaba de pasar.
_YA_NO_ESTA = {
    "agenda": "Esa publicación programada ya no está en Blotato: puede que ya se "
              "haya publicado. La lista ya está al día.",
    "reprogramar": "No pudimos cambiar la hora: esa publicación ya no está programada "
                   "en Blotato. Puede que ya se haya publicado. La lista ya está al día.",
    "cancelar": "Esa publicación ya no estaba programada en Blotato. Si ya se publicó, "
                "tienes que borrarla desde la red. La lista ya está al día.",
}


def explicar_fallo(err: Exception, clave: str | None = None, *,
                   contexto: str = "publicacion") -> tuple[str, bool]:
    """(mensaje para el usuario, ¿hay que reconectar?) de un fallo al hablar
    con Blotato. Nunca incluye el texto de la excepción (lleva URLs firmadas);
    sí el `message` que Blotato explica en un 422 o un 429.

    `contexto` (CONTEXTOS) es keyword-only y su default deja los textos
    byte-idénticos a los de C2: los llamadores de publicar pasan todo
    posicional y no se tocan. En la Agenda no se publica nada, así que «espera
    antes de publicar otra vez» ahí desconcierta."""
    if isinstance(err, SubidaRechazada) and err.codigo == 0:
        return ("La subida a Blotato se cortó antes de terminar. Intenta de nuevo; "
                "si se repite, revisa el tamaño que permite tu plan de Blotato.", False)
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
            if contexto == "reprogramar":
                return ("Blotato no aceptó la hora nueva"
                        + (f": {detalle}" if detalle
                           else ". Elige una fecha futura e intenta de nuevo."), False)
            return ("Blotato no aceptó la publicación"
                    + (f": {detalle}" if detalle else ". Revisa los datos e intenta de nuevo."),
                    False)
        if codigo == 429:
            if contexto == "agenda":
                espera = "Blotato pide esperar un momento antes de volver a consultar"
            elif contexto in ("reprogramar", "cancelar"):
                espera = "Blotato pide esperar un momento antes de intentarlo otra vez"
            else:
                espera = "Blotato pide esperar antes de publicar otra vez"
            return espera + (f": {detalle}" if detalle else "."), False
        if codigo == 404:
            if contexto in _YA_NO_ESTA:
                return _YA_NO_ESTA[contexto], False
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


def _sub(datos, clave: str) -> dict:
    """El sub-objeto `clave`, o {} si Blotato manda null (o cualquier otra cosa).

    `account` llega NULO en muchos schedules y un item['account']['name']
    tumbaría la pantalla entera con un TypeError."""
    valor = datos.get(clave) if isinstance(datos, dict) else None
    return valor if isinstance(valor, dict) else {}


def _pagina(r: httpx.Response) -> tuple[list[dict], str | None, int | None]:
    """(items, cursor, total) de una respuesta paginada.

    _items() se queda solo con `items` y tira el resto: con él, una Agenda de
    40 publicaciones enseñaría 20 jurando que no hay más. Y `count` llega como
    STRING ("12"), así que compararlo con un int no falla: miente."""
    datos = _json(r)
    items = datos.get("items", [])
    if not isinstance(items, list):
        raise RespuestaInvalida("Blotato respondió una lista inválida")
    cursor = datos.get("cursor")
    try:
        total = int(str(datos.get("count")))
    except (TypeError, ValueError):
        total = None
    return ([c for c in items if isinstance(c, dict)],
            cursor if isinstance(cursor, str) and cursor else None, total)


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
    try:
        subida = httpx.put(firmada, content=partes,
                           headers={"Content-Type": mime, "Content-Length": str(tam)},
                           timeout=TIMEOUT_SUBIDA)
    except (httpx.WriteError, httpx.ReadError, httpx.RemoteProtocolError):
        raise SubidaRechazada(0) from None
    # un 3xx tampoco es una subida: httpx no sigue redirecciones (ni podría
    # reenviar un cuerpo en streaming)
    if not subida.is_success:
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


# ---------------------------------------------------------------------------
# M23 C3 — la Agenda: lo programado que todavía no ha salido (/v2/schedules).
# Cada item trae su propio id sch_…, y ese mismo id viaja al PATCH y al DELETE:
# por eso reprogramar y cancelar no necesitan ningún registro nuestro.

def programados(clave: str, *, limite: int = 20, cursor: str | None = None,
                timeout: httpx.Timeout = TIMEOUT_CORTO) -> dict:
    """UNA página de lo que Blotato aún no ha publicado.

    {'items': [… crudos …], 'cursor': str|None, 'total': int|None}. Una página
    por llamada a propósito: TIMEOUT_CORTO son 8 s POR FASE y la Lambda de la
    API corta a los 29 s, así que encadenar páginas aquí dentro devuelve un 502
    mudo. Quien llama decide si pide la siguiente con el cursor."""
    cabeceras = _headers(clave)
    params: dict = {"limit": max(1, min(50, int(limite)))}
    if cursor is not None:
        if not isinstance(cursor, str) or not 1 <= len(cursor) <= 512:
            raise ValueError("cursor de Blotato inválido")
        params["cursor"] = cursor
    r = httpx.get(f"{BASE}/schedules", params=params, headers=cabeceras, timeout=timeout)
    r.raise_for_status()
    items, siguiente, total = _pagina(r)
    return {"items": items, "cursor": siguiente, "total": total}


def programado(clave: str, sch_id: str, timeout: httpx.Timeout = TIMEOUT_CORTO) -> dict:
    """Un schedule suelto. La respuesta va ENVUELTA en {"schedule": …}: copiar
    estado_post() tal cual devolvería un dict vacío en silencio, no un error."""
    cabeceras = _headers(clave)
    if not id_valido(sch_id):
        raise ValueError("publicación programada de Blotato inválida")
    r = httpx.get(f"{BASE}/schedules/{quote(sch_id)}", headers=cabeceras, timeout=timeout)
    r.raise_for_status()
    sch = _json(r).get("schedule")
    if not isinstance(sch, dict):
        raise RespuestaInvalida("Blotato no devolvió la publicación programada")
    return sch


def reprogramar(clave: str, sch_id: str, *, cuando: str | None = None,
                draft: dict | None = None, timeout: httpx.Timeout = TIMEOUT_CORTO) -> None:
    """Cambia lo que se le mande de un schedule (la Agenda: solo la hora).

    OJO: el PATCH no hace merge. Un `draft` parcial BORRA mediaUrls y target y
    deja programada una publicación sin video, y el usuario no se entera hasta
    que sale. Por eso ningún endpoint expone `draft`: el kwarg existe para no
    mentir sobre lo que la API acepta, y nadie lo usa."""
    cabeceras = _headers(clave)
    if not id_valido(sch_id):
        raise ValueError("publicación programada de Blotato inválida")
    patch: dict = {}
    if cuando:
        patch["scheduledTime"] = cuando
    if draft:
        patch["draft"] = draft
    # un patch vacío es un 422 seguro: no vale la pena gastar la red
    if not patch:
        raise ValueError("No hay nada que cambiar: elige una hora nueva.")
    r = httpx.patch(f"{BASE}/schedules/{quote(sch_id)}", headers=cabeceras,
                    json={"patch": patch}, timeout=timeout)
    # 204 SIN cuerpo: _json(r) lanzaría RespuestaInvalida sobre un cuerpo vacío
    r.raise_for_status()


def cancelar(clave: str, sch_id: str, timeout: httpx.Timeout = TIMEOUT_CORTO) -> None:
    """Blotato deja de tener esa publicación: no la publicará y no se deshace."""
    cabeceras = _headers(clave)
    if not id_valido(sch_id):
        raise ValueError("publicación programada de Blotato inválida")
    r = httpx.delete(f"{BASE}/schedules/{quote(sch_id)}", headers=cabeceras, timeout=timeout)
    r.raise_for_status()      # 204 SIN cuerpo, igual que el PATCH: nada de _json


def media_de(sch: dict) -> str:
    """La publicUrl del video de un schedule, o ''.

    Es lo único que empareja un schedule con NUESTRO registro: Blotato acuña
    una URL nueva en cada subida, así que es única por publicación (el worker
    la guarda al crear el post). Sin ella, cancelar deja el modal de Publicar
    diciendo «programado» para algo que ya no va a salir."""
    urls = _sub(_sub(sch, "draft"), "content").get("mediaUrls")
    primera = urls[0] if isinstance(urls, list) and urls else None
    return primera if isinstance(primera, str) and primera.startswith("https://") else ""


TEXTO_MAX = 200        # lo que la Agenda enseña de cada publicación

# De dónde sale el `destino` de un schedule, EN ORDEN, y con qué etiqueta.
# Blotato no lo devuelve resuelto: lo único que suele ser un nombre legible es
# `subaccountName`; el resto son ids opacos («1110000001»), y resolverlos
# costaría una llamada por fila — la Agenda entera cuesta UNA.
_DE_DESTINO = (("account", "subaccountName", ""),
               ("account", "subaccountId", "Página "),
               ("account", "subId", "Página "),
               ("target", "pageId", "Página "),
               ("target", "boardId", "Tablero "))
DESTINO_MAX = 80


def destino_de(item: dict) -> str:
    """La página o el tablero al que va un schedule, listo para enseñar ("" si
    no hay). Los ids son numéricos en Facebook: str() antes de nada."""
    donde = {"account": _sub(item, "account"),
             "target": _sub(_sub(item, "draft"), "target")}
    for fuente, campo, etiqueta in _DE_DESTINO:
        valor = donde[fuente].get(campo)
        # bool es un int: True daría el destino «Página True». Y un 0 no es una
        # página de nadie: sale por el `not valor`, igual que "" y que None.
        if not valor or isinstance(valor, bool) or not isinstance(valor, (str, int)):
            continue
        texto = " ".join(str(valor).split())[:DESTINO_MAX]
        if texto:
            return etiqueta + texto
    return ""


def identidad_de(sch: dict) -> tuple[str, str]:
    """(plataforma, cuenta) de un schedule: con esto se corrobora que NUESTRO
    registro habla de esta misma publicación antes de escribirlo.

    "" en lo que Blotato no mande: la ausencia no contradice nada (muchos
    schedules llegan sin accountId)."""
    draft = _sub(sch, "draft")
    plataforma = _sub(draft, "content").get("platform")
    cuenta = draft.get("accountId")
    return (plataforma.strip().lower() if isinstance(plataforma, str) else "",
            str(cuenta).strip() if isinstance(cuenta, (str, int))
            and not isinstance(cuenta, bool) else "")


def vista_programado(item: dict) -> dict:
    """Lo que la Agenda enseña de un schedule, ya normalizado:
    {id, cuando, plataforma, red, cuenta_nombre, destino, texto, cortado, medios}.

    `destino` (destino_de) es la página o el tablero al que va. Sin él, dos
    publicaciones de la MISMA cuenta a DOS páginas de Facebook se ven idénticas
    en la lista y en el «¿seguro?» de cancelar: el usuario cancela la que no
    era, y eso no se deshace.

    `cortado` dice si el texto se recortó de verdad, para que la pantalla ponga
    «…» solo cuando falta texto: con >= 200 le pondría puntos suspensivos a un
    texto de exactamente 200 caracteres, que está entero.

    `medios` es el CONTEO de adjuntos del post PRINCIPAL, no sus URLs: la
    pantalla es pública y no tiene por qué cargar assets del CDN de Blotato. No
    son necesariamente videos — la doc de Blotato dice «images, videos» —, así
    que la pantalla los llama «archivos». Un hilo (`additionalPosts`) trae sus
    propios adjuntos y aquí NO se cuentan ni se enseñan: la Agenda sirve para
    reconocer y cancelar una publicación, no para revisarla entera.

    Y nada de REDES[p] ni de revisar_texto: la lista de redes de Blotato es más
    larga que nuestras 9 y una desconocida daría un KeyError → 500 en una
    pantalla de solo mirar."""
    item = item if isinstance(item, dict) else {}
    contenido = _sub(_sub(item, "draft"), "content")
    plataforma = str(contenido.get("platform") or "")
    texto = contenido.get("text")
    texto = texto if isinstance(texto, str) else ""
    urls = contenido.get("mediaUrls")
    cuenta = _sub(item, "account")
    return {"id": str(item.get("id") or ""),
            "cuando": str(item.get("scheduledAt") or ""),
            "plataforma": plataforma,
            "red": (REDES.get(plataforma) or {}).get("nombre") or plataforma,
            "cuenta_nombre": str(cuenta.get("name") or cuenta.get("username") or ""),
            "destino": destino_de(item),
            "texto": texto[:TEXTO_MAX],
            "cortado": len(texto) > TEXTO_MAX,
            "medios": len([u for u in urls if isinstance(u, str)])
            if isinstance(urls, list) else 0}
