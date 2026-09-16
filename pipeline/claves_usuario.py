"""M23 C — claves de terceros que aporta cada usuario (hoy: su BLOTATO_API_KEY).

En el servicio viven en SSM como SecureString bajo
SSM_USUARIOS_PREFIX/<user_id>/<NOMBRE> (el mismo lugar que ya lee
worker/env_ssm.py, decisión D4). El `<user_id>` lo pone SIEMPRE el llamador
desde el token (db.usuario_actual()), nunca el cuerpo de la petición.

En local (sin SSM_USUARIOS_PREFIX) se guardan en un archivo bajo la carpeta de
trabajo (`work_root()/_claves`; por defecto `<repo>/work/`, que git ignora):
es la máquina del dueño, donde el .env ya tiene las claves en claro. Así el
flujo de conectar se prueba igual que en la nube.

Los valores jamás se registran en logs ni se devuelven por la API.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

# Solo estas se pueden escribir desde la web (la IAM de la Lambda también lo
# restringe a usuarios/*/BLOTATO_API_KEY).
ESCRIBIBLES = ("BLOTATO_API_KEY",)

_ID_VALIDO = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class ErrorAlmacen(Exception):
    """El almacén de claves no respondió (SSM caído, permisos, disco)."""


def _prefijo() -> str:
    return os.getenv("SSM_USUARIOS_PREFIX", "").rstrip("/")


def en_nube() -> bool:
    return bool(_prefijo())


def id_valido(user_id: str | None) -> bool:
    # el user_id termina en una ruta de SSM o del disco: nada de «..» ni «/»
    return bool(_ID_VALIDO.fullmatch(user_id or ""))


def _validar(user_id: str, nombre: str) -> None:
    if not id_valido(user_id):
        raise ValueError("usuario inválido")
    if nombre not in ESCRIBIBLES:
        raise ValueError(f"clave no permitida: {nombre}")


def _nombre_ssm(user_id: str, nombre: str) -> str:
    return f"{_prefijo()}/{user_id}/{nombre}"


def _raiz_local() -> Path:
    from .storage import work_root
    return work_root() / "_claves"


def _archivo_local(user_id: str, nombre: str) -> Path:
    return _raiz_local() / user_id / nombre


def _ssm():
    import boto3
    return boto3.client("ssm")


def _motivo(err: Exception) -> str:
    """El código de error de AWS (AccessDeniedException, ThrottlingException…)
    y nada más: el mensaje completo no hace falta en el log."""
    resp = getattr(err, "response", None)
    codigo = resp.get("Error", {}).get("Code") if isinstance(resp, dict) else None
    return str(codigo or type(err).__name__)


def leer(user_id: str, nombre: str) -> str | None:
    """La clave guardada por el usuario, o None si no guardó ninguna."""
    _validar(user_id, nombre)
    if en_nube():
        cliente = _ssm()
        try:
            r = cliente.get_parameter(Name=_nombre_ssm(user_id, nombre), WithDecryption=True)
        except cliente.exceptions.ParameterNotFound:
            return None
        except Exception as err:  # noqa: BLE001
            raise ErrorAlmacen(_motivo(err)) from None
        return r["Parameter"]["Value"] or None
    f = _archivo_local(user_id, nombre)
    try:
        return f.read_text(encoding="utf-8").strip() or None
    except FileNotFoundError:
        return None
    except OSError as err:
        raise ErrorAlmacen(type(err).__name__) from None


def guardar(user_id: str, nombre: str, valor: str) -> None:
    _validar(user_id, nombre)
    if not valor:
        raise ValueError("clave vacía")
    if en_nube():
        try:
            _ssm().put_parameter(Name=_nombre_ssm(user_id, nombre), Value=valor,
                                 Type="SecureString", Overwrite=True)
        except Exception as err:  # noqa: BLE001
            raise ErrorAlmacen(_motivo(err)) from None
        return
    f = _archivo_local(user_id, nombre)
    try:
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(valor, encoding="utf-8")
    except OSError as err:
        raise ErrorAlmacen(type(err).__name__) from None


def borrar(user_id: str, nombre: str) -> None:
    """Quita la clave del usuario. Si no había, no pasa nada."""
    _validar(user_id, nombre)
    if en_nube():
        cliente = _ssm()
        try:
            cliente.delete_parameter(Name=_nombre_ssm(user_id, nombre))
        except cliente.exceptions.ParameterNotFound:
            return
        except Exception as err:  # noqa: BLE001
            raise ErrorAlmacen(_motivo(err)) from None
        return
    try:
        _archivo_local(user_id, nombre).unlink(missing_ok=True)
    except OSError as err:
        raise ErrorAlmacen(type(err).__name__) from None
