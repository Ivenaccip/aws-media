"""El Asistente de Automatizaciones (Fase A, modo «prueba», GASTO 0): la puerta con sesión.

    GET  /api/automatiza/config        qué modo corre, si es gratis y los límites del pedido
    POST /api/automatiza/armar         {"texto": "…"} → 202 {id, estado, modo, paso, costo_creditos}
    GET  /api/automatiza/armar/{id}    el estado de ese pedido; terminado, el flujo de n8n

Fuera de `/api/publico/` a propósito: `/api/automatiza/*` cae en `auth.PREFIJOS_PROTEGIDOS` (401 sin token
cuando Cognito está activo) y la identidad es `db.usuario_actual()` (el `sub`). Es otra cosa que la página
pública `/automatiza`: prefijos distintos, camino distinto.

Mientras no se encienda el armado real (Fase B: exige el «sí» del dueño con el costo a la vista), todo es
«prueba»: `pipeline/asistente.py` devuelve una muestra enlatada elegida por palabras clave. Sin base, sin
cola, sin proveedor, sin créditos, y el texto de la persona no se guarda ni se registra (el log lleva solo
`muestra=…` y `chars=N`). Este archivo no importa ningún SDK ni los módulos que gastan (lo fija
`tests/test_automatiza_guardianes.py`); `db` solo se usa para saber QUIÉN pregunta.

**Contrato** (idéntico en prueba y en real; lo que cambia es `modo`):

  `GET /config` → `{activo, modo: "prueba"|"real"|"no_disponible", gratis, costo_creditos, largo_minimo,
  largo_maximo, cupo}`. En prueba: `gratis: true, costo_creditos: 0, cupo: null`. Los límites del pedido (hoy
  20 a 1500 caracteres) salen de `pipeline/publico.py`: la pantalla no lleva los suyos. `activo: false` = no
  ofrecer escribir; la pantalla decide por `activo` antes que por `modo`. `modo: "no_disponible"` es el modo
  real mal configurado (los dos interruptores puestos y algo falta) y NO se hace pasar por `"real"`. Con
  `activo: false` el cuerpo trae además `texto`, la frase lista para mostrarse (la del 503 `no_disponible`).

  `POST /armar` → 202 `{id, estado: "armando", modo, paso: "entender", costo_creditos}`. El `id` es opaco.

  `GET /armar/{id}` → `{id, estado, listo, modo, lleva_seg, …}` más, según el estado:

    armando        `paso` ∈ entender · buscar · armar · revisar
    listo          `nombre`, `resumen`, `nodos: [{tipo, nombre, etiqueta, nombre_en_flujo}]` (`nombre` es el de
                   n8n, en inglés; `etiqueta` es el chip en español para la persona; `nombre_en_flujo` es el
                   `name` del nodo en el flujo y distingue a dos nodos iguales, p. ej. dos agentes),
                   `pendientes: [str]` («Conecta tu cuenta de X en n8n y elige el destinatario.»),
                   `advertencias: [str]` (las del validador y, si el flujo abre un chat público, el aviso de
                   que cualquiera con el enlace podrá escribirle), `flujo` (el JSON de n8n, listo para
                   descargar) y, SOLO en las
                   muestras de prueba que lo traen, `grafo: {nombreFlujo, nodes, edges}` — el mismo grafo
                   del Constructor, para «Abrir en el constructor» sin un importador n8n → grafo. Es una
                   llave OPCIONAL: sin `grafo`, el botón no se ofrece.
    sin_cobertura  `mensaje`, `faltan: [str]`
    (reservados para el modo real: `en_fila` con `lugar`, `no_salio` y `rechazada` con `mensaje`)

  Nunca viajan `uso`, `modelo`, `fuentes`, `intentos`, `costo_usd`, el texto del pedido ni la IP. Los
  textos libres (`resumen`, `faltan`, `advertencias`) pasan por `validador.SECRETOS`: si alguno parece una
  clave, ese campo se omite. Un id mal formado, ajeno, caducado o de otra muestra es 404, nunca 403.

Las respuestas de las tres rutas llevan `Cache-Control: no-store`, éxitos y errores del módulo (422, 404
`no_encontrada`, 503). Lo que contesta otra capa NO lo lleva: el 404/405 del enrutado (otra ruta u otro método)
y el 401 de la sesión (`server/auth.py`); son JSON sin datos. Los errores llevan `detail` como objeto,
`{"codigo", "texto", …extras}`, con el `texto` listo para mostrarse tal cual (el cliente web ya lo lee):

    vacio 422 · corto 422 (`minimo`) · largo 422 (`maximo`) · cuerpo 422 · texto_invalido 422
    no_encontrada 404 · no_disponible 503 (también lo que ningún caso previó: la red de seguridad)
    reservados para la Fase B: moderacion 422 · en_curso 409 · agotado 429 · sin_saldo 402 · no_nube 503
"""
from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from pipeline import asistente, db

router = APIRouter(prefix="/api/automatiza", tags=["automatiza"])
log = logging.getLogger("automatiza_api")

_SIN_CACHE = {"Cache-Control": "no-store"}
_MAX_CUERPO = 64 * 1024          # un pedido de 1500 caracteres cabe 10 veces aunque sea todo emojis

# ---------------------------------------------------------------------------
# el catálogo de errores: {codigo: (estado HTTP, texto para la persona)}

ERRORES: dict[str, tuple[int, str]] = {
    "vacio": (422, "Cuéntanos qué quieres automatizar, aunque sea en una frase."),
    # los números entran por `falla(..., minimo=…)`: salen de pipeline/publico.py, no de aquí
    "corto": (422, "Cuéntanos un poco más: al menos {minimo} caracteres."),
    "largo": (422, "Es demasiado largo: máximo {maximo} caracteres."),
    "cuerpo": (422, "No entendimos lo que mandaste. Recarga la página e inténtalo de nuevo."),
    "texto_invalido": (422, "Tu texto trae un carácter que no se puede procesar (suele venir de pegar "
                            "desde otro programa). Bórralo e inténtalo de nuevo."),
    "no_encontrada": (404, "No encontramos ese pedido. Escribe de nuevo qué quieres automatizar."),
    "no_disponible": (503, "El Asistente no está disponible por ahora. Inténtalo en unos minutos."),
    # Fase B (modo real): todavía no se emiten, pero la pantalla ya puede conocerlos
    "moderacion": (422, "Esta petición no la podemos armar. Prueba describiéndola de otra forma."),
    "en_curso": (409, "Ya estamos armando otro flujo para ti, quizá en otra pestaña. Espera a que termine."),
    "agotado": (429, "Ya usaste tus armados de hoy. Se renuevan a la medianoche, hora de México."),
    "sin_saldo": (402, "No te alcanzan los créditos para armar este flujo."),
    "no_nube": (503, "El Asistente corre en el servicio, no en tu computadora."),
}


def falla(codigo: str, **extras: Any) -> HTTPException:
    status, texto = ERRORES[codigo]
    return HTTPException(status, {"codigo": codigo, "texto": texto.format(**extras), **extras},
                         headers=_SIN_CACHE)


def _servir() -> None:
    """Falla CERRADO: solo la prueba se sirve. El real mal configurado, o todavía sin implementar, es 503
    (nunca un ejemplo enlatado haciéndose pasar por el flujo de la persona)."""
    if not asistente.sirve(asistente.modo()):
        raise falla("no_disponible")


def _con_muestras(fn, *args):
    """Corre `fn`; un archivo de muestras roto es «no disponible», sin detalles en la respuesta.

    Y la red de seguridad: lo que ningún caso previó (un id raro que revienta, un bug) tampoco sale como un
    500 de texto plano y sin `no-store`, sino como el mismo 503 `no_disponible`. En el log va solo el TIPO de la
    excepción: su mensaje podría traer el texto de la persona."""
    try:
        return fn(*args)
    except asistente.MuestrasInvalidas as err:
        log.error("automatiza: las muestras de prueba están rotas (%s)", err)
        raise falla("no_disponible") from None
    except asistente.ErrorAsistente as err:
        raise falla(err.codigo, **err.extras) from None
    except Exception as err:  # noqa: BLE001 — la red de seguridad
        log.error("automatiza: error inesperado (%s)", type(err).__name__)
        raise falla("no_disponible") from None


# ---------------------------------------------------------------------------
# leer el cuerpo

async def _leer_json(request: Request) -> Any:
    """El cuerpo como JSON, leyendo el flujo con tope: `Content-Length` puede no venir (una petición
    «chunked») o mentir, así que se cuentan los bytes que de verdad llegan y se corta al pasar
    `_MAX_CUERPO`, sin cargar el resto en memoria."""
    largo = request.headers.get("content-length")
    # `str.isdigit()` es verdadero para «²» y para 5000 cifras, y `int()` fallaba (ValueError → 500): solo
    # cifras ASCII, sin ceros a la izquierda y con un largo acotado antes de convertir. Una cabecera que no es
    # un número se ignora: lo que cuenta son los bytes que de verdad llegan (abajo).
    if largo and largo.isascii() and largo.isdigit():
        cifras = largo.lstrip("0")
        if len(cifras) > 12 or int(cifras or "0") > _MAX_CUERPO:
            raise falla("largo", maximo=asistente.limites()[1])
    crudo = bytearray()
    async for trozo in request.stream():
        crudo += trozo
        if len(crudo) > _MAX_CUERPO:
            raise falla("largo", maximo=asistente.limites()[1])
    try:
        return json.loads(bytes(crudo))
    except Exception:  # noqa: BLE001 — JSON roto, vacío o con bytes que no son texto
        raise falla("cuerpo") from None


async def _texto_pedido(request: Request) -> str:
    """El `texto` crudo, o el error de formato. No se usa un modelo de Pydantic a propósito: su 422 por
    omisión trae el cuerpo recibido (el texto de la persona) y un `detail` que es una lista, no el objeto
    del contrato."""
    cuerpo = await _leer_json(request)
    if not isinstance(cuerpo, dict):
        raise falla("cuerpo")
    texto = cuerpo.get("texto")
    if texto is None:
        raise falla("vacio")
    if not isinstance(texto, str):
        raise falla("cuerpo")
    return texto


def _json(cuerpo: dict, status: int = 200) -> JSONResponse:
    return JSONResponse(cuerpo, status_code=status, headers=_SIN_CACHE)


# ---------------------------------------------------------------------------
# las rutas

@router.get("/config")
def configuracion():
    """Lo que la pantalla pregunta al abrir, antes de que alguien escriba: sin gastar nada. Si no se puede
    escribir (`activo: false`), trae el `texto` para decírselo."""
    cuerpo = asistente.config(asistente.modo())
    if not cuerpo["activo"]:
        cuerpo["texto"] = ERRORES["no_disponible"][1]
    return _json(cuerpo)


@router.post("/armar")
async def armar(request: Request):
    _servir()
    user = db.usuario_actual()
    texto = await _texto_pedido(request)
    inicio = _con_muestras(asistente.iniciar, texto, user, asistente.reloj())
    # del pedido solo se registra el largo y qué muestra salió: ni una palabra de lo que escribió
    log.info("automatiza: armar · modo=prueba · muestra=%s · chars=%d", inicio.muestra, inicio.chars)
    return _json(inicio.cuerpo, 202)


@router.get("/armar/{id_}")
def consultar(id_: str):
    _servir()
    user = db.usuario_actual()
    return _json(_con_muestras(asistente.consultar, id_, user, asistente.reloj()))
