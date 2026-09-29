"""RAG·5 — el freno de /automatiza: interruptor + tope diario.

Es el ÚNICO gate de gasto del camino público. El monedero no aplica —no hay
usuario (RAG·1)—, así que sin esto un bot podría gastar sin límite a cuenta
del dueño. Se consulta ANTES de aceptar una corrida (el API, RAG·8) y el
worker vuelve a mirar el interruptor antes de armar: apagar en una emergencia
corta también lo que ya estaba en la fila.

Falla CERRADO: si no se puede leer el interruptor o el consumo, la sección
está no disponible. Un tope que se abre cuando la base tose no es un tope.

El tope se cuenta al ENTRAR a la fila, no al salir (RAG·12): una corrida
aceptada ya está prometida. Con varias peticiones exactamente a la vez puede
pasarse por unas pocas —las que entren en el mismo instante—; es un tope de
presupuesto, no un contador bancario, y a cambio no hay candados.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import logging
import os
from dataclasses import dataclass

from pipeline import db

log = logging.getLogger("publico")

APAGADO = "apagado"
TOPE = "tope"
TOPE_IP = "tope_ip"
# RAG·7 — motivos de la entrada. Los dos primeros sí se le explican a la
# persona (puede corregirlos); RECHAZADA lleva el motivo que dio la moderación.
CORTO = "corto"
LARGO = "largo"
RECHAZADA = "rechazada"

# RAG·7 — largo de la descripción, en caracteres después de quitar espacios de
# las orillas. El máximo es PROVISIONAL hasta que el dueño ponga su número
# (RAG·0): sin tope, alguien pega un libro y eso son tokens de entrada pagados
# antes de que el modelo diga una palabra. El mínimo evita gastar moderación y
# una corrida en «hola».
LARGO_MINIMO = 20
LARGO_MAXIMO = 1500
PROMPT_MODERACION = "moderar_automatiza_system"

# RAG·6 — cuántas corridas al día desde una misma IP mientras el dueño no
# ponga su número (tools/automatiza.py tope --por-ip N). GENEROSO a propósito:
# una oficina o una escuela salen a internet por una sola IP, y el tope que de
# verdad frena es el global. Este solo evita que un bucle se coma el día.
TOPE_IP_PROVISIONAL = 10

# La sal vive en SSM (/<entorno>/env/AUTOMATIZA_SAL_IP, la sube
# tools/ssm_env.py) y llega al entorno al arrancar la Lambda. Nunca en el código.
VAR_SAL = "AUTOMATIZA_SAL_IP"
# Solo detrás de Cloudflare (prod, RAG·30) la IP real viene en una cabecera.
# Sin esta variable la cabecera se IGNORA: cualquiera puede mandarla a mano
# directo al execute-api y estrenar IP en cada petición.
VAR_CLOUDFLARE = "AUTOMATIZA_IP_CLOUDFLARE"


def ip_del_request(request) -> str | None:
    """La IP del visitante. Por defecto la que ve API Gateway (Mangum la pone
    en request.client); CF-Connecting-IP solo si el entorno dice que hay
    Cloudflare delante."""
    if os.getenv(VAR_CLOUDFLARE) == "1":
        cf = request.headers.get("cf-connecting-ip", "").strip()
        if cf:
            return cf
    return request.client.host if request.client else None


def hash_ip(ip: str | None) -> str | None:
    """HMAC-SHA256 con la sal de SSM; None si falta la IP o la sal.

    La IP en claro no sale de esta función: ni a la base ni a los logs. Una
    IPv6 se agrupa por su /64, que es lo que un proveedor le da a UNA casa:
    sin eso, un bot estrena dirección en cada petición sin salir de su red."""
    sal = os.getenv(VAR_SAL, "")
    if not ip or not sal:
        return None
    try:
        dir_ip = ipaddress.ip_address(ip)
        clave = (str(ipaddress.ip_network(f"{dir_ip}/64", strict=False))
                 if dir_ip.version == 6 else str(dir_ip))
    except ValueError:
        clave = ip          # no es una IP (p. ej. el cliente de pruebas): se hashea tal cual
    return hmac.new(sal.encode(), clave.encode(), hashlib.sha256).hexdigest()[:32]


def permiso(ip_hash: str | None = None, *, por_ip: bool = True) -> str | None:
    """None si se puede aceptar una corrida más; si no, el motivo interno
    ('apagado', 'tope' o 'tope_ip'). El visitante ve lo mismo en todos:
    «Ahorita no está disponible» (decisión del dueño, 28-sep).

    Con `por_ip` (el default) exige el hash: sin sal o sin IP no se puede
    contar por visitante, y eso cierra, no abre."""
    if por_ip and not ip_hash:
        log.error("sin hash de IP (¿falta %s en SSM?): cerrado", VAR_SAL)
        return APAGADO
    try:
        ajuste = db.automatiza_interruptor()
        if not ajuste or not ajuste["encendido"]:
            return APAGADO
        tope_c, tope_u = ajuste.get("tope_corridas"), ajuste.get("tope_usd")
        if tope_c is None and tope_u is None:
            # encendido sin ningún tope es justo lo que este módulo impide
            log.error("interruptor encendido sin tope: se trata como apagado")
            return APAGADO
        hoy = db.automatiza_consumo_hoy()
        de_ip = db.automatiza_corridas_de_ip_hoy(ip_hash) if por_ip else 0
    except Exception:  # noqa: BLE001 — cualquier fallo al leer = cerrado
        log.exception("no se pudo leer el freno de /automatiza: cerrado")
        return APAGADO
    if tope_c is not None and hoy["corridas"] >= tope_c:
        return TOPE
    if tope_u is not None and hoy["usd"] >= tope_u:
        return TOPE
    tope_ip = ajuste.get("tope_por_ip")
    if por_ip and de_ip >= (TOPE_IP_PROVISIONAL if tope_ip is None else tope_ip):
        return TOPE_IP
    return None


def encendido() -> bool:
    """Solo el interruptor, sin mirar el tope: lo usa el worker antes de
    armar. Lo que ya está en la fila fue aceptado dentro del tope; lo que no
    puede es seguir gastando si el dueño apagó."""
    try:
        ajuste = db.automatiza_interruptor()
    except Exception:  # noqa: BLE001
        log.exception("no se pudo leer el interruptor: cerrado")
        return False
    return bool(ajuste and ajuste["encendido"])


def limpiar_texto(texto: str | None) -> str:
    """El texto tal como se va a guardar y a mandar al modelo: sin espacios en
    las orillas y sin el carácter nulo (Postgres no lo acepta en `text`)."""
    return (texto or "").replace("\x00", "").strip()


def revisar_largo(texto: str | None) -> str | None:
    """None si el largo está bien; si no, CORTO o LARGO. Gratis: va primero."""
    n = len(limpiar_texto(texto))
    if n < LARGO_MINIMO:
        return CORTO
    if n > LARGO_MAXIMO:
        return LARGO
    return None


@dataclass(frozen=True)
class Admision:
    """Qué pasa con una petición. `motivo` None = entra a la fila."""
    motivo: str | None
    texto: str = ""
    detalle: str = ""       # para RECHAZADA: la frase de la moderación


async def admitir(texto: str | None, ip_hash: str | None) -> Admision:
    """Las tres puertas de /automatiza, de la más barata a la más cara:

    1. largo (gratis),
    2. freno —interruptor, tope diario y tope por IP— (una lectura a la base),
    3. moderación (una llamada a un modelo, que CUESTA).

    La moderación va DESPUÉS del freno a propósito: así un bot que ya se comió
    su tope, o la sección apagada, no le cuesta al dueño ni una llamada. La
    contra es que una petición rechazada por moderación sí consumió una
    lectura; es lo barato. La moderación falla CERRADO (pipeline/moderacion.py):
    si no contesta, la petición no entra y la persona ve «Ahorita no está
    disponible», igual que con el interruptor apagado."""
    from pipeline import moderacion

    limpio = limpiar_texto(texto)
    motivo = revisar_largo(limpio)
    if motivo:
        return Admision(motivo, limpio)
    motivo = permiso(ip_hash)
    if motivo:
        return Admision(motivo, limpio)
    v = await moderacion.revisar(limpio, prompt=PROMPT_MODERACION, falla_cerrado=True)
    if v.caido:
        return Admision(APAGADO, limpio)
    if not v.permitido:
        return Admision(RECHAZADA, limpio, v.motivo)
    return Admision(None, limpio)
