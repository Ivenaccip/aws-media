"""Fase 2 — «¿No puedes entrar?»: POST /api/acceso/nueva-clave, sin sesión.

Cognito no deja usar «¿Olvidaste tu contraseña?» a quien está en
FORCE_CHANGE_PASSWORD, o sea a quien nunca entró: la pantalla responde «Could not
reset password for the account». Con la clave provisional vencida (dura 7 días)
esa persona no tenía salida sin escribirle al dueño. Aquí la pide ella misma, y lo
que sale es lo MISMO que manda el bot: `tools.usuarios.reenviar_provisional`, un
RESEND con clave nueva. Nunca `alta()`: esta ruta jamás crea cuentas ni abona
créditos, la pida quien la pida. Quien SÍ entró alguna vez sigue por «¿Olvidaste
tu contraseña?», que en su caso funciona.

El orden es parte del diseño:

  1. Correo inválido: 400. Eso no revela nada.
  2. Límite por IP (TOPE_POR_IP al día de Cognito, con la IP en hash). Sin sal
     (AUTOMATIZA_SAL_IP) o sin IP no se puede contar por visitante, y eso cierra:
     503, igual que /automatiza (pipeline/publico.py `permiso`).
  3. Cupo: el interruptor del bot (su MODO no apaga esta página; tope 0 sí) contra
     lo que salió hoy. Va ANTES de mirar la cuenta para no revelar nada.
  4. Lo que se lee de la base va antes de Cognito: si la base falla es 503 para
     todos, con cuenta o sin ella.
  5. La cuenta y sus condiciones (pipeline/invitaciones.py `motivo_para_no_mandar`).
  6. Se anota 'enviando' y después se manda, como el bot. Lo que venga después
     de esa decisión se contesta igual.

Para los pasos 5 y 6 la respuesta es EXACTAMENTE la misma, exista la cuenta o no,
se haya mandado o no, y tarda lo mismo (DURACION_MINIMA_S). Lo que pasó de verdad
queda en el log, con una huella del correo; ni el correo ni la IP llegan al log.

Un hueco que se acepta a sabiendas: con UN solo correo libre en el día, probar un
correo X y luego uno inventado delata a X (el inventado recibe «sin_cupo» si a X sí
se le mandó). Da como mucho un positivo al día, solo cerca del tope; cerrarlo
obligaría a contestar «listo» sin cupo, y entonces nadie sabría que debe volver mañana.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import ipaddress
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from pipeline import db
from pipeline import invitaciones as inv
from pipeline import publico as freno

log = logging.getLogger("acceso")
router = APIRouter()

TOPE_POR_IP = 5
# Lo mínimo que tarda una respuesta «listo». Un RESEND son unos cientos de
# milisegundos: si esto queda por debajo de lo que tarda en mandarse, el tiempo
# vuelve a delatar quién tiene cuenta.
DURACION_MINIMA_S = 2.0
LARGO_MAXIMO_CUERPO = 2048
LARGO_MAXIMO_CORREO = 254

MENSAJE_CORREO = "Escribe un correo válido, como nombre@ejemplo.com."
MENSAJE_LIMITE = "Ya hiciste varios intentos hoy. Inténtalo mañana."
MENSAJE_SIN_CUPO = "Hoy ya se enviaron todos los correos disponibles. Inténtalo mañana."
MENSAJE_NO_SE_PUDO = "Ahorita no se pudo. Inténtalo más tarde."
MENSAJE_LISTO = ("Si tu cuenta aún no se activa, te enviamos una contraseña nueva: revisa tu "
                 "correo y spam en unos minutos. Si ya habías entrado antes, usa "
                 "«¿Olvidaste tu contraseña?» en la pantalla de entrar.")

# Desde dónde entra Cloudflare (cloudflare.com/ips, leído el 30-oct-2026). El
# dominio de prod pasa por Cloudflare y API Gateway ve la IP del BORDE, no la del
# visitante: contar por esa juntaría a todo un país en cinco intentos. La cabecera
# CF-Connecting-IP solo vale si la conexión viene de uno de estos rangos; de
# cualquier otro lado (directo al execute-api) cualquiera podría inventarla y
# estrenar IP en cada petición. Por eso no depende de AUTOMATIZA_IP_CLOUDFLARE, que
# confía en la cabecera venga de donde venga. Si Cloudflare suma un rango y esta
# lista se queda vieja, quien entre por él cuenta por borde: sobra prudencia, no falta.
_CLOUDFLARE = tuple(ipaddress.ip_network(r) for r in (
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
    "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
    "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
    "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
    "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
    "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"))

_dormir = asyncio.sleep     # aparte, para que las pruebas midan sin esperar


def _es_ip(texto: str | None) -> bool:
    try:
        ipaddress.ip_address(texto or "")
        return True
    except ValueError:
        return False


def _de_cloudflare(ip: str | None) -> bool:
    if not _es_ip(ip):
        return False
    direccion = ipaddress.ip_address(ip)
    return any(direccion in red for red in _CLOUDFLARE if red.version == direccion.version)


def ip_del_visitante(request: Request) -> str | None:
    """La IP de quien pregunta: la cabecera de Cloudflare solo si de verdad viene
    de Cloudflare; si no, la que ve API Gateway (Mangum la pone en request.client)."""
    directa = request.client.host if request.client else None
    if _de_cloudflare(directa):
        cabecera = request.headers.get("cf-connecting-ip", "").strip()
        if _es_ip(cabecera):
            return cabecera
    return directa


def _huella(correo: str) -> str:
    """Lo único del correo que llega al log: alcanza para seguir a una persona
    si escribe al soporte (se calcula con su correo) y no dice quién es."""
    sal = os.getenv(freno.VAR_SAL, "")
    return hmac.new(sal.encode(), correo.encode(), hashlib.sha256).hexdigest()[:12]


def _codigo(err: Exception) -> str:
    """El código de botocore o la clase; nunca el texto, que puede traer la dirección."""
    return (getattr(err, "response", None) or {}).get("Error", {}).get("Code", type(err).__name__)


def _respuesta(estado_http: int, estado: str, mensaje: str) -> tuple[int, dict]:
    return estado_http, {"estado": estado, "mensaje": mensaje}


def _no_se_pudo() -> tuple[int, dict]:
    return _respuesta(503, "no_se_pudo", MENSAJE_NO_SE_PUDO)


def _leer_cuenta(pool: str, correo: str) -> dict | None:
    """La cuenta, o None si no existe. Otro error de Cognito sube tal cual."""
    from tools import usuarios
    try:
        return inv.usuario_de_cognito(
            usuarios._cognito(pool).admin_get_user(UserPoolId=pool, Username=correo))
    except Exception as err:                        # noqa: BLE001 — se distingue abajo
        if _codigo(err) == "UserNotFoundException":
            return None
        raise


def _intentar(correo: str, envios: list[dict], estado_miembro: str | None, *,
              ahora: datetime, corte: str, tope: int) -> str:
    """Decide y, si toca, manda. → qué pasó, solo para el log: quien llama contesta
    lo mismo sea lo que sea. Nada de aquí puede reventar hacia afuera."""
    from tools import usuarios
    pool = os.getenv("COGNITO_POOL_ID")
    if not pool:
        return "sin_pool"
    try:
        motivo = inv.motivo_para_no_mandar(_leer_cuenta(pool, correo), envios, estado_miembro, ahora)
    except Exception as err:                        # noqa: BLE001 — no se manda a ciegas
        return f"cognito_al_leer:{_codigo(err)}"
    if motivo:
        return motivo
    desde = ahora - timedelta(hours=inv.HORAS_ENTRE_CORREOS_PAGINA)
    try:
        id_ = db.invitaciones_reclamar_pagina(correo, inv.paso_de_pagina(envios, correo), corte=corte,
                                              tope=tope, desde=desde.isoformat())
    except Exception as err:                        # noqa: BLE001 — sin fila no se manda
        return f"base_al_anotar:{_codigo(err)}"
    if id_ is None:
        return "gano_otra_solicitud"
    resultado = "enviado"
    try:
        usuarios.reenviar_provisional(pool, correo)
    except Exception as err:                        # noqa: BLE001 — incluye CODIGOS_DE_TOPE
        resultado = f"fallo:{_codigo(err)}"
    try:
        db.invitaciones_marcar(id_, resultado)
    except Exception as err:                        # noqa: BLE001 — queda en 'enviando':
        # cuenta como mandado, que es lo prudente; el correo pudo haber salido
        return f"{resultado}+base_al_marcar:{_codigo(err)}"
    return resultado


def atender(correo: str, ip_hash: str | None, ahora: datetime | None = None) -> tuple[int, dict]:
    """Los pasos del docstring, de la IP en adelante. → (estado HTTP, cuerpo)."""
    ahora = inv.fecha(ahora or datetime.now(timezone.utc))
    corte = inv.corte_del_dia(ahora).isoformat()
    if not ip_hash:
        log.error("acceso: sin hash de IP (¿falta %s en SSM?): cerrado", freno.VAR_SAL)
        return _no_se_pudo()
    huella = _huella(correo)
    # el candado de identidad, igual que lo público: aquí no hay usuario
    with db.camino_publico():
        try:
            if db.invitaciones_contar_solicitud(ip_hash, corte, TOPE_POR_IP) >= TOPE_POR_IP:
                log.info("acceso: %s límite por IP", huella)
                return _respuesta(429, "limite", MENSAJE_LIMITE)
            tope = inv.tope_de(db.invitaciones_interruptor())
            if db.invitaciones_gastado_desde(corte) >= tope:
                log.info("acceso: %s sin cupo (tope %s)", huella, tope)
                return _respuesta(200, "sin_cupo", MENSAJE_SIN_CUPO)
            envios = db.invitaciones_envios_de(correo)
            estado_miembro = db.invitaciones_estado_miembro(correo)
        except Exception as err:                    # noqa: BLE001 — se dice y no se manda nada
            log.error("acceso: %s la base falló: %s", huella, _codigo(err))
            return _no_se_pudo()
        que_paso = _intentar(correo, envios, estado_miembro, ahora=ahora, corte=corte, tope=tope)
    log.info("acceso: %s %s", huella, que_paso)
    return _respuesta(200, "listo", MENSAJE_LISTO)


def correo_del_cuerpo(crudo: bytes, tipo: str) -> str | None:
    """El correo normalizado, o None si no hay uno válido. Exigir JSON hace que otro
    sitio no pueda mandar esto desde el navegador de sus visitas, cada una con su
    IP: un formulario no puede poner ese Content-Type, y un fetch pediría permiso
    (CORS) que aquí nadie da. Se compara el tipo EXACTO: «text/plain; x=application/json»
    trae el texto, pero para el navegador sigue siendo text/plain, sin preflight."""
    from tools import usuarios
    esencial = tipo.split(";")[0].strip().lower()
    if len(crudo) > LARGO_MAXIMO_CUERPO or esencial != "application/json":
        return None
    try:
        cuerpo = json.loads(crudo)
    except (ValueError, RecursionError):            # RecursionError: «[[[[…» muy anidado
        return None
    valor = cuerpo.get("correo") if isinstance(cuerpo, dict) else None
    if not isinstance(valor, str):
        return None
    correo, rechazo, _ = usuarios.revisar(valor)
    return None if rechazo or len(correo) > LARGO_MAXIMO_CORREO else correo


@router.post("/api/acceso/nueva-clave", include_in_schema=False)
async def nueva_clave(request: Request):
    inicio = time.monotonic()
    correo = correo_del_cuerpo(await request.body(), request.headers.get("content-type", ""))
    if correo is None:
        estado_http, cuerpo = _respuesta(400, "correo_invalido", MENSAJE_CORREO)
        return JSONResponse(cuerpo, status_code=estado_http)
    ip_hash = freno.hash_ip(ip_del_visitante(request))
    estado_http, cuerpo = await run_in_threadpool(atender, correo, ip_hash)
    if cuerpo["estado"] == "listo":
        faltan = DURACION_MINIMA_S - (time.monotonic() - inicio)
        if faltan > 0:
            await _dormir(faltan)
    return JSONResponse(cuerpo, status_code=estado_http, headers={"Cache-Control": "no-store"})
