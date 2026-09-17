"""M23 C — cada usuario conecta SU cuenta de Blotato.

    GET    /api/blotato   ¿conectado?, desde dónde y qué redes tiene
                          (?redes=0: sin preguntarle a Blotato, para el menú)
    POST   /api/blotato   {clave}: la prueba contra Blotato y, si sirve, la guarda
    DELETE /api/blotato   la quita

Cada respuesta dice también si programar desde la web funciona aquí
(`agendar`): desde C2 funciona en local y en el servicio.

La clave se guarda con el usuario del token (db.usuario_actual()), nunca con
uno que venga en el cuerpo, y ninguna respuesta la devuelve. Tampoco se
registra: el log de peticiones solo lleva método y ruta.

Conectar tiene un costo que NO es nuestro: Blotato no da la API en su prueba
gratis, y generar la clave la termina. La respuesta trae ese precio desde
tools/pricing.json para que la pantalla lo avise antes.
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from pipeline import blotato, claves_usuario, db

log = logging.getLogger("blotato_api")
router = APIRouter(prefix="/api/blotato")

_PRICING = Path(__file__).resolve().parent.parent / "tools" / "pricing.json"
CAMPOS_CUENTA = ("id", "platform", "fullname", "username")


class ConectarIn(BaseModel):
    clave: str = ""


@lru_cache(maxsize=1)
def plan_minimo() -> dict | None:
    """{nombre, usd_por_mes} del plan de Blotato más barato con API."""
    try:
        datos = json.loads(_PRICING.read_text(encoding="utf-8"))["blotato_suscripcion"]
        plan = datos["plan_minimo"]
        return {"nombre": str(plan["nombre"]), "usd_por_mes": plan["usd_por_mes"]}
    except (OSError, KeyError, TypeError, ValueError):
        return None


def _usuario() -> str:
    user = db.usuario_actual()
    if not claves_usuario.id_valido(user):
        raise HTTPException(400, "No pudimos identificar tu cuenta. Vuelve a iniciar sesión.")
    return user


def _limpias(cuentas: list[dict]) -> list[dict]:
    """Solo lo que la pantalla enseña, sin lo demás que mande Blotato."""
    return [{k: str(c.get(k) or "") for k in CAMPOS_CUENTA}
            for c in cuentas if isinstance(c, dict)]


def _agendar() -> bool:
    # M23 C2: programar corre en local y en el servicio (worker SQS)
    return True


def _respuesta(conectado: bool, origen: str | None, cuentas: list[dict],
               error: str | None, reconectar: bool = False) -> dict:
    return {"conectado": conectado, "origen": origen, "cuentas": _limpias(cuentas),
            "error": error, "reconectar": reconectar, "agendar": _agendar(),
            "plan": plan_minimo()}


def _estado(user: str, redes: bool = True) -> dict:
    try:
        clave, origen = blotato.clave_y_origen(user)
    except claves_usuario.ErrorAlmacen:
        raise HTTPException(503, "No pudimos revisar tu conexión con Blotato. "
                                 "Intenta de nuevo en un momento.")
    if not clave:
        return _respuesta(False, None, [], None)
    if not redes:
        return _respuesta(True, origen, [], None)
    try:
        cuentas = blotato.cuentas(clave, timeout=blotato.TIMEOUT_CORTO)
    except (httpx.HTTPError, blotato.ClaveInvalida) as err:
        error, reconectar = blotato.explicar_fallo(err)
        return _respuesta(True, origen, [], error, reconectar)
    return _respuesta(True, origen, cuentas, None)


@router.get("")
def estado(redes: bool = True):
    return _estado(_usuario(), redes)


@router.post("")
def conectar(body: ConectarIn):
    user = _usuario()
    clave = body.clave.strip()
    if not blotato.forma_valida(clave):
        raise HTTPException(422, "Pega la clave completa, sin espacios ni comillas. "
                                 "La encuentras en Blotato, en Settings → API.")
    try:
        cuentas = blotato.validar(clave)
    except blotato.ClaveInvalida as err:
        raise HTTPException(422, str(err))
    except (httpx.HTTPError, ValueError) as err:
        # ni el mensaje ni la petición: la clave viaja en la cabecera
        log.warning("validar la clave de Blotato falló: %s", type(err).__name__)
        raise HTTPException(502, "Blotato no respondió y tu clave no se guardó. "
                                 "Intenta de nuevo en un momento.")
    try:
        claves_usuario.guardar(user, blotato.NOMBRE, clave)
    except claves_usuario.ErrorAlmacen as err:
        log.error("guardar la clave de Blotato falló: %s", err)
        raise HTTPException(503, "Blotato aceptó tu clave, pero no pudimos guardarla. "
                                 "Intenta de nuevo en un momento.")
    return _respuesta(True, "propia", cuentas, None)


@router.delete("")
def desconectar(redes: bool = True):
    user = _usuario()
    try:
        claves_usuario.borrar(user, blotato.NOMBRE)
    except claves_usuario.ErrorAlmacen as err:
        log.error("borrar la clave de Blotato falló: %s", err)
        raise HTTPException(503, "No pudimos desconectar tu cuenta. "
                                 "Intenta de nuevo en un momento.")
    if claves_usuario.en_nube():
        # en la nube no hay reserva que mirar, y releer justo después de
        # borrar podría devolver el valor viejo
        return _respuesta(False, None, [], None)
    return _estado(user, redes)
