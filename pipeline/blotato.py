"""Cliente HTTP de Blotato para fn2 (PLAN-FUSION.md F3.2) — API directa, no MCP.

Auth: header `blotato-api-key`. Docs verificadas 2026-08-24 y 2026-09-16 en
help.blotato.com/api: GET /v2/users/me/accounts (401 clave inválida, 403 plan
sin API) · POST /v2/media/uploads (presigned) · POST /v2/posts (scheduledTime
ISO 8601).

M23 C: cada usuario conecta SU clave. Por eso ninguna función lee una clave
global: todas la reciben, y `clave_de(user_id)` es la única forma de
obtenerla. En el servicio NUNCA cae a una clave de la plataforma: publicaría
en la cuenta equivocada. En local cae al BLOTATO_API_KEY del .env, que es la
cuenta del dueño de la máquina.
"""
from __future__ import annotations

import mimetypes
import os
import re
from pathlib import Path

import httpx

from . import claves_usuario

BASE = "https://backend.blotato.com/v2"
TIMEOUT = httpx.Timeout(30, read=120)
# lo que espera una pantalla: la Lambda de la API corta a los 29 s
TIMEOUT_CORTO = httpx.Timeout(8)
NOMBRE = "BLOTATO_API_KEY"
# una clave va en una cabecera: solo ASCII visible. Con otra cosa httpx ni
# envía (y h11 repite el valor entero en su excepción).
_FORMA = re.compile(r"[\x21-\x7e]{1,512}")


class ClaveInvalida(Exception):
    """Blotato rechazó la clave; el mensaje es para el usuario."""


class RespuestaInvalida(httpx.HTTPError):
    """Blotato respondió 2xx con algo que no es la lista esperada (p. ej. una
    página de mantenimiento). Es un HTTPError: quien ya captura la red lo
    captura también."""


def forma_valida(clave: str | None) -> bool:
    return bool(clave) and bool(_FORMA.fullmatch(clave))


def explicar_fallo(err: Exception) -> tuple[str, bool]:
    """(mensaje para el usuario, ¿hay que reconectar?) de un fallo al hablar
    con Blotato. Nunca incluye el texto de la excepción."""
    if isinstance(err, httpx.HTTPStatusError):
        codigo = err.response.status_code
        if codigo in (401, 403):
            return ("Blotato ya no acepta tu clave. Quizá la regeneraste o cambió "
                    "tu plan: conéctala de nuevo.", True)
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


def cuentas(clave: str, timeout: httpx.Timeout = TIMEOUT) -> list[dict]:
    """Redes realmente conectadas del usuario: [{id, platform, fullname, username}]."""
    r = httpx.get(f"{BASE}/users/me/accounts", headers=_headers(clave), timeout=timeout)
    r.raise_for_status()
    try:
        items = r.json().get("items", [])
    except (ValueError, AttributeError):
        raise RespuestaInvalida("Blotato respondió algo que no es JSON") from None
    if not isinstance(items, list):
        raise RespuestaInvalida("Blotato respondió una lista de cuentas inválida")
    return [c for c in items if isinstance(c, dict)]


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


def subir_video(clave: str, path: Path) -> str:
    """Presigned upload (recomendado para archivos locales): devuelve la URL
    pública que va en mediaUrls."""
    r = httpx.post(f"{BASE}/media/uploads", headers=_headers(clave),
                   json={"filename": path.name}, timeout=TIMEOUT)
    r.raise_for_status()
    datos = r.json()
    mime = mimetypes.guess_type(path.name)[0] or "video/mp4"
    subida = httpx.put(datos["presignedUrl"], content=path.read_bytes(),
                       headers={"Content-Type": mime},
                       timeout=httpx.Timeout(30, read=600, write=600))
    subida.raise_for_status()
    return datos["publicUrl"]


def payload_post(account_id: str, platform: str, texto: str, media_urls: list[str],
                 scheduled_time: str | None = None) -> dict:
    """Body de POST /v2/posts (separado para poder testearlo sin red)."""
    body: dict = {"post": {
        "accountId": str(account_id),
        "content": {"text": texto, "mediaUrls": media_urls, "platform": platform},
        "target": {"targetType": platform},
    }}
    if scheduled_time:
        body["scheduledTime"] = scheduled_time
    return body


def publicar(clave: str, account_id: str, platform: str, texto: str,
             media_urls: list[str], scheduled_time: str | None = None) -> dict:
    r = httpx.post(f"{BASE}/posts", headers=_headers(clave),
                   json=payload_post(account_id, platform, texto, media_urls, scheduled_time),
                   timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()
