"""Ajustes 3 — COI (Contexto · Objetivo · Instrucciones): un chat de UNA sola entrada.

La persona escribe una vez y el modelo responde una vez con el COI (tres
bloques). Es gratis por ahora (0 créditos) con tope de 3 respuestas TERMINADAS
por persona y día de México. Solo nube y con usuario.

    GET  /api/coi/estado   cuántas lleva hoy, cuántas le quedan y cuándo se renuevan
    POST /api/coi          {"texto": "…"} → el COI

Reglas que no se negocian (contrato «Ajustes 3», §0, §1 y §5):

  - **Las instrucciones son del dueño y viven SOLO aquí** (`prompts/coi_system.md`).
    Ninguna respuesta de este API las devuelve ni las cita.
  - **Lo que la persona escribe y lo que responde el modelo NO se guardan**: ni en
    la base, ni en Langfuse, ni en los logs. El log de cada respuesta lleva modelo,
    tokens, milisegundos y costo. Nada más. La moderación y la llamada al modelo
    van por el SDK de OpenAI sin el envoltorio de Langfuse (`llm.chat_texto`,
    `moderacion.revisar(sin_trazas=True)`).
  - **Solo cuentan las respuestas terminadas.** Si el modelo falla, se pasa de
    tiempo, la moderación rechaza o no se pudo sumar, no se gasta ninguna. «Terminada» es
    `finish_reason == "stop"` con texto: cualquier otro motivo de fin (`length`,
    `content_filter`, ninguno) es una respuesta incompleta.
  - **Los intentos que no cuentan tienen tope propio** (`coi.MAX_FALLOS_DIARIOS` por
    persona y día de México): no gastan un uso, pero cada uno costó una llamada. Al llegar
    al tope, 429 `demasiados_intentos` antes de llamar a nadie.
  - **Falla cerrado**: si no se puede leer o escribir el consumo, no hay COI.
  - **Una sola respuesta en curso por persona** (candado atómico en la base).
  - **Nada falla después de contar**: el resultado se arma ANTES de sumar el uso.

El orden de `POST /api/coi` ES el contrato:

    validar → leer estado (falla cerrado) → 429 si ya usó el tope (o el de intentos)
    → tomar el candado de «una en curso» (caduca a los 60 s) → moderar sin trazas
    → modelo con plazo propio (24 s, menos el margen para sumar) → armar el resultado
    → SOLO si terminó: sumar 1 y soltar el candado en UNA sentencia → responder.
    En CUALQUIER fallo el candado se suelta sin sumar un uso.

Todos los errores llevan `detail` como objeto: {"codigo", "texto", …extras}; el
`texto` está listo para mostrarse tal cual.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from pipeline import coi, db, llm, moderacion

router = APIRouter(prefix="/api/coi", tags=["coi"])
log = logging.getLogger("coi_api")

TOPE = coi.TOPE_DIARIO
_SIN_GASTAR = "No se gastó ninguno de tus usos."
_SIN_CACHE = {"Cache-Control": "no-store"}
_MAX_CUERPO = 64 * 1024          # un texto de 2000 caracteres cabe 20 veces
# U+0000 y los sustitutos sueltos (U+D800 a U+DFFF): no son texto y revientan más adelante (el SDK al
# codificar el JSON, la base al guardar). Se rechazan al entrar, con su propio mensaje.
_INVALIDO = re.compile("[\x00\ud800-\udfff]")

# ---------------------------------------------------------------------------
# el catálogo de errores: {codigo: (estado HTTP, texto para la persona)}

ERRORES: dict[str, tuple[int, str]] = {
    "vacio": (422, "Escribe qué necesitas para armar tu COI."),
    "muy_largo": (422, f"Tu texto pasa de {coi.MAX_TEXTO} caracteres. "
                       "Acórtalo un poco e inténtalo de nuevo."),
    "cuerpo": (422, "No entendimos lo que mandaste. Recarga la página e inténtalo de nuevo."),
    "texto_invalido": (422, "Tu texto trae un carácter que no se puede procesar (suele venir de "
                            "pegar desde otro programa). Bórralo e inténtalo de nuevo."),
    "en_curso": (409, "Ya estamos armando otro COI para ti, quizá en otra pestaña. "
                      "Espera a que termine."),
    "agotado": (429, f"Ya usaste tus {TOPE} de hoy. Se renuevan a la medianoche, hora de México."),
    "demasiados_intentos": (429, "Hoy ya intentaste armar tu COI muchas veces sin lograrlo. "
                                 "Vuelve mañana; no se gastó ninguno de tus usos."),
    "moderacion": (422, f"Ajusta tu texto para continuar. {_SIN_GASTAR}"),
    "modelo": (502, f"No pudimos armar tu COI ahora. {_SIN_GASTAR}"),
    "tardo": (504, f"Tardó demasiado en responder. {_SIN_GASTAR} Inténtalo de nuevo."),
    "no_disponible": (503, f"COI no está disponible por ahora. {_SIN_GASTAR} Inténtalo en unos minutos."),
    "no_nube": (503, "COI corre en el servicio, no en tu computadora."),
}


def falla(codigo: str, texto: str | None = None, **extras: Any) -> HTTPException:
    status, base = ERRORES[codigo]
    return HTTPException(status, {"codigo": codigo, "texto": texto or base, **extras})


def _usuario() -> str:
    if db.backend() != "postgres":
        raise falla("no_nube")
    return db.usuario_actual()


# ---------------------------------------------------------------------------
# el estado, tal como lo ve la web

def _vista(usos: int, renueva_en_s: int, se_renueva: str) -> dict:
    usos = max(0, min(int(usos), TOPE))
    return {"tope": TOPE, "usos": usos, "quedan": TOPE - usos,
            "renueva_en_s": int(renueva_en_s), "se_renueva": se_renueva}


def _agotado(est: dict) -> HTTPException:
    v = _vista(TOPE, est["renueva_en_s"], est["se_renueva"])
    return falla("agotado", tope=v["tope"], usos=v["usos"], quedan=0,
                 renueva_en_s=v["renueva_en_s"], se_renueva=v["se_renueva"])


def _sin_intentos(est: dict) -> HTTPException:
    """Los mismos extras que `agotado`, pero con los usos REALES: todavía tiene los suyos, lo que
    se acabó es el tope de intentos que no terminaron."""
    v = _vista(est["usos"], est["renueva_en_s"], est["se_renueva"])
    return falla("demasiados_intentos", tope=v["tope"], usos=v["usos"], quedan=v["quedan"],
                 renueva_en_s=v["renueva_en_s"], se_renueva=v["se_renueva"])


def _corte(est: dict) -> HTTPException | None:
    """El 429 que corresponde a este estado, o None si todavía puede intentar."""
    if est["usos"] >= TOPE:
        return _agotado(est)
    if est["fallos"] >= coi.MAX_FALLOS_DIARIOS:
        return _sin_intentos(est)
    return None


async def _en_hilo(fn, *args):
    """La base va por el Data API (bloqueante): fuera del bucle de eventos, para
    que otras respuestas no esperen a esta."""
    return await asyncio.to_thread(fn, *args)


@router.get("/estado")
def estado():
    """Lo que la pantalla pinta al abrir: sin gastar nada. Falla cerrado: si no
    se puede leer el consumo, 503 (la web no ofrece escribir)."""
    user = _usuario()
    try:
        est = db.coi_estado(user)
    except Exception as err:  # noqa: BLE001
        log.error("coi: no se pudo leer el estado (%s)", type(err).__name__)
        raise falla("no_disponible") from None
    return JSONResponse({**_vista(est["usos"], est["renueva_en_s"], est["se_renueva"]),
                         "en_curso": bool(est["en_curso"]), "gratis": True}, headers=_SIN_CACHE)


# ---------------------------------------------------------------------------
# validar el cuerpo

async def _leer_json(request: Request) -> Any:
    """El cuerpo como JSON, leyendo el flujo con tope: `Content-Length` puede no venir (una petición
    «chunked») o mentir, así que se cuentan los bytes que de verdad llegan y se corta al pasar
    `_MAX_CUERPO`, sin cargar el resto en memoria."""
    largo = request.headers.get("content-length")
    if largo and largo.isdigit() and int(largo) > _MAX_CUERPO:
        raise falla("muy_largo")
    crudo = bytearray()
    async for trozo in request.stream():
        crudo += trozo
        if len(crudo) > _MAX_CUERPO:
            raise falla("muy_largo")
    try:
        return json.loads(bytes(crudo))
    except Exception:  # noqa: BLE001 — JSON roto, vacío o con bytes que no son texto
        raise falla("cuerpo") from None


async def _texto_pedido(request: Request) -> str:
    """El `texto` ya recortado, o el error de formato. No se usa un modelo de
    Pydantic a propósito: su 422 por omisión trae el cuerpo recibido (el texto de
    la persona) y un `detail` que es una lista, no el objeto del contrato."""
    cuerpo = await _leer_json(request)
    if not isinstance(cuerpo, dict):
        raise falla("cuerpo")
    texto = cuerpo.get("texto")
    if texto is None:
        raise falla("vacio")
    if not isinstance(texto, str):
        raise falla("cuerpo")
    texto = texto.strip()
    if not texto:
        raise falla("vacio")
    if len(texto) > coi.MAX_TEXTO:
        raise falla("muy_largo", max=coi.MAX_TEXTO)
    if _INVALIDO.search(texto):
        raise falla("texto_invalido")
    return texto


def _es_plazo(err: BaseException) -> bool:
    """¿El error es «se pasó de tiempo»? (el nuestro, el de asyncio o el del SDK)."""
    return (isinstance(err, (asyncio.TimeoutError, TimeoutError))
            or type(err).__name__ in ("APITimeoutError", "ReadTimeout", "ConnectTimeout",
                                      "WriteTimeout", "PoolTimeout", "TimeoutException"))


async def _soltar(user: str, candado: str, fallo: bool = False) -> None:
    """Suelta el candado SIN sumar un uso. Es lo último que se intenta en cualquier fallo:
    si tampoco se puede, el candado caduca solo a los 60 s. Con `fallo` el intento queda anotado
    en el tope diario de intentos que no cuentan (costó una llamada y no terminó)."""
    try:
        await asyncio.shield(_en_hilo(db.coi_soltar, user, candado, fallo))
    except Exception as err:  # noqa: BLE001
        log.warning("coi: no se pudo soltar el candado (%s); caduca solo", type(err).__name__)


# ---------------------------------------------------------------------------
# POST /api/coi

def _resultado(respuesta: str, texto: str) -> tuple[dict, str]:
    """`(coi, idioma)` listos para responder. Se arma ANTES de sumar el uso: nada de lo que pueda
    fallar al armar la respuesta debe ocurrir después de contarla. Si separar los bloques revienta,
    la respuesta se entrega entera y sin estructura (`estructura_ok=false`: también cuenta, fue una
    respuesta terminada). Si ni siquiera se puede codificar a JSON, se lanza ValueError: quien llama
    la trata como incompleta."""
    try:
        coi_ = coi.separar_bloques(respuesta)
        idioma = coi.idioma_respuesta(respuesta, texto)
    except Exception as err:  # noqa: BLE001 — jamás un 500 con el uso ya contado
        log.warning("coi: no se pudo separar la respuesta (%s); va sin estructura", type(err).__name__)
        coi_ = {"contexto": None, "objetivo": None, "instrucciones": None,
                "completo": respuesta, "estructura_ok": False}
        idioma = coi.idioma(texto)
    try:
        json.dumps({"coi": coi_, "idioma": idioma}, ensure_ascii=False).encode("utf-8")
    except (TypeError, ValueError):       # p. ej. un sustituto suelto: no se puede escribir como UTF-8
        raise ValueError("la respuesta no se puede codificar") from None
    return coi_, idioma


def _costo(uso: dict) -> float | None:
    """El costo en dólares para el log, o None. Se calcula ANTES de contar el uso: leer la tarifa es
    un archivo, y un archivo roto no debe dar un 500 cuando el uso ya se sumó."""
    try:
        return coi.costo_usd(uso)
    except Exception as err:  # noqa: BLE001
        log.warning("coi: no se pudo calcular el costo (%s)", type(err).__name__)
        return None


@router.post("")
async def armar(request: Request):
    inicio = time.monotonic()
    user = _usuario()

    # 1 · validar
    texto = await _texto_pedido(request)
    if not os.getenv("OPENAI_API_KEY"):
        log.error("coi: falta OPENAI_API_KEY")
        raise falla("no_disponible")

    # 2 · leer el estado: falla cerrado
    try:
        est = await _en_hilo(db.coi_estado, user)
    except Exception as err:  # noqa: BLE001
        log.error("coi: no se pudo leer el consumo (%s)", type(err).__name__)
        raise falla("no_disponible") from None
    # 3 · ya usó el tope, o ya hizo demasiados intentos que no terminaron
    corte = _corte(est)
    if corte:
        raise corte

    # 4 · el candado de «una en curso»: atómico y con los dos topes adentro
    candado = uuid.uuid4().hex
    try:
        ganado = await _en_hilo(db.coi_tomar, user, candado, TOPE, coi.CADUCA_CANDADO_S,
                                coi.MAX_FALLOS_DIARIOS)
        if not ganado:
            # ¿por qué no? Otra respuesta en curso, o terminó una y ya llegó al tope
            est = await _en_hilo(db.coi_estado, user)
            if _corte(est) is None and not est["en_curso"]:
                # la otra respuesta soltó el candado (falló, o venció) entre mi intento y esta
                # lectura: un 409 «hay otra en curso» sería mentira. Un segundo intento, y ya.
                ganado = await _en_hilo(db.coi_tomar, user, candado, TOPE, coi.CADUCA_CANDADO_S,
                                        coi.MAX_FALLOS_DIARIOS)
                if not ganado:
                    est = await _en_hilo(db.coi_estado, user)
    except Exception as err:  # noqa: BLE001
        log.error("coi: no se pudo tomar el candado (%s)", type(err).__name__)
        raise falla("no_disponible") from None
    if not ganado:
        raise _corte(est) or falla("en_curso")

    contada = False
    fallo = False          # ¿el intento costó una llamada y no terminó? Cuenta contra el tope diario
    try:
        # 5 · moderar la entrada, sin dejar rastro del texto
        restante = coi.PRESUPUESTO_S - (time.monotonic() - inicio)
        try:
            veredicto = await asyncio.wait_for(
                moderacion.revisar(texto, falla_cerrado=True, sin_trazas=True),
                timeout=max(1.0, min(coi.PLAZO_MODERACION_S, restante)))
        except (asyncio.TimeoutError, TimeoutError):
            log.warning("coi: la moderación pasó de su plazo")
            raise falla("tardo") from None
        if not veredicto.permitido:
            fallo = True
            if veredicto.caido:
                log.warning("coi: la moderación no respondió; se rechaza (falla cerrado)")
                raise falla("modelo")
            motivo = coi.motivo_corto(veredicto.motivo, entrada=texto) or moderacion.MENSAJE_BASE
            raise falla("moderacion", f"{motivo} {_SIN_GASTAR}", motivo=motivo)

        # 6 · el modelo, con plazo propio: la Lambda corta a 29 s y se le guarda un margen para sumar
        # el uso y responder. Las instrucciones se leen en un hilo (con Langfuse activo son una
        # consulta de red de hasta 3 s)
        sistema = await _en_hilo(coi.instrucciones)
        plazo = min(coi.PLAZO_MODELO_S,
                    coi.PRESUPUESTO_S - coi.MARGEN_SUMAR_S - (time.monotonic() - inicio))
        if plazo < coi.MIN_MODELO_S:
            log.warning("coi: no quedó tiempo para el modelo")
            raise falla("tardo")
        try:
            respuesta, uso = await asyncio.wait_for(
                llm.chat_texto(sistema, texto, razonamiento=coi.razonamiento(),
                               max_tokens=coi.MAX_SALIDA_TOKENS, timeout=plazo,
                               modelo=coi.modelo()),
                timeout=plazo)
        except HTTPException:
            raise
        except llm.ClaveFaltante:
            log.error("coi: falta OPENAI_API_KEY")
            raise falla("no_disponible") from None
        except Exception as err:  # noqa: BLE001 — nunca el texto del error: solo su clase
            fallo = True
            if _es_plazo(err):
                log.warning("coi: el modelo pasó de su plazo (%.0f s)", plazo)
                raise falla("tardo") from None
            log.warning("coi: el modelo falló (%s, estado %s)", type(err).__name__,
                        getattr(err, "status_code", None))
            raise falla("modelo") from None
        uso = uso or {}
        if not (respuesta or "").strip() or uso.get("fin") != "stop":
            # vacía, o que no terminó (`length`, `content_filter`, sin motivo…): no es una respuesta
            # terminada, y un pedazo de COI no se entrega ni se cuenta
            fallo = True
            log.warning("coi: respuesta vacía o incompleta (fin=%s)", uso.get("fin"))
            raise falla("modelo")

        # el resultado se arma ANTES de contar: si algo falla aquí, no se gasta nada
        try:
            coi_, idioma = _resultado(respuesta, texto)
        except ValueError:
            fallo = True
            log.warning("coi: la respuesta del modelo no se puede entregar; no cuenta")
            raise falla("modelo") from None
        costo = _costo(uso)

        # 7 · SOLO si terminó: sumar 1 y soltar el candado, en UNA sentencia
        try:
            suma = await _en_hilo(db.coi_sumar, user, candado, TOPE)
        except Exception as err:  # noqa: BLE001
            log.error("coi: no se pudo sumar el uso (%s)", type(err).__name__)
            raise falla("no_disponible") from None
        if suma is None:
            # el candado ya no era nuestro (caducó) o sumar pasaría del tope
            log.error("coi: el uso no se pudo contar; la respuesta no se entrega")
            raise falla("no_disponible")
        contada = True
    except HTTPException:
        raise
    except asyncio.CancelledError:
        raise
    except Exception as err:  # noqa: BLE001 — lo inesperado: 503, sin texto en el log
        log.error("coi: error inesperado (%s)", type(err).__name__)
        raise falla("no_disponible") from None
    finally:
        if not contada:
            await _soltar(user, candado, fallo)

    # 8 · responder (y dejar en el log solo números)
    ms = round((time.monotonic() - inicio) * 1000)
    log.info("coi: respuesta terminada · modelo=%s · entrada=%s · salida=%s · en_cache=%s · "
             "ms=%d · costo_usd=%s", uso.get("modelo"), uso.get("entrada"), uso.get("salida"),
             uso.get("cache_leida"), ms, costo)
    return JSONResponse({
        "coi": coi_,
        "idioma": idioma,
        **_vista(suma["usos"], suma["renueva_en_s"], suma["se_renueva"]),
    }, headers=_SIN_CACHE)
