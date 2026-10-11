"""La imagen de un modelo lento, en segundo plano (worker Lambda, de 10 a 30 segundos):

  1. el doc que dejó el API lleva el pedido completo: el prompt ya con el estilo,
     el aspecto, el modelo y los créditos que se cobraron;
  2. fal genera la imagen en un directorio temporal PROPIO (el de imágenes del API
     lo comparten todos los usuarios que atiende un mismo contenedor);
  3. la imagen se sube donde viven las de siempre: imagenes/<user>/<nombre>.jpg, así
     «Mis creaciones» y /api/imagenes/<nombre> la encuentran sin cambios;
  4. el doc queda listo: usuarios/<user>/imagenes-pedidos/<id>.json

Por qué existe: `POST /api/imagenes` generaba dentro de la petición, y la Lambda del
API corta a los 29 s (API Gateway: tope fijo de 30 s; un arranque en frío ya gasta
unos 16). FLUX 3 tardó de 21.8 a 25.0 s en la prueba pagada y Seedream 4.5 hasta
22.7 s. Cortada la petición se cobraba, no se devolvía y fal cobraba igual. Los
modelos con `Modelo.segundo_plano` pasan por aquí; los rápidos siguen síncronos.

La regla que gobierna este worker, la misma de worker/clip_generar.py: **no relanza
nunca la generación.** Un reintento de la cola pagaría una segunda imagen en fal —que
nadie pidió y que el usuario no vería—. Por eso todo error de la generación se atrapa
aquí: el doc queda en `error`, los créditos vuelven y la Lambda termina bien para que SQS
borre el mensaje. Lo que sí sale de aquí, a propósito, son dos cosas que no cuestan otra
imagen: no poder LEER el doc o el reclamo (todavía no se llamó a fal ni se cobró nada
más) y no poder DEVOLVER los créditos (ver abajo).

La reentrega de SQS tampoco paga dos veces. SQS estándar entrega al menos una vez, a
veces dos a la vez, así que el estado del doc no basta: antes de generar se RECLAMA el
pedido con una escritura condicional de S3 (`.reclamo`, If-None-Match). Quien pierde el
reclamo no hace nada —ni fal ni devolución—. Un reclamo de 14 minutos o más es de un
worker que ya murió (la visibilidad de la cola es de 15) y se toma con If-Match.
Después, el trabajo solo corre con el doc en `generando`; uno `listo` o `error` significa
que otra entrega ya lo resolvió: no se llama a fal ni se devuelve nada.

La devolución es de LO COBRADO: el número sale del doc (`creditos`, que el API escribió
al cobrar), no de recalcularlo con la tarifa de hoy. Se devuelve PRIMERO y el doc `error`
se escribe DESPUÉS, para que el mensaje solo diga «se te devolvieron» si es verdad, y el
doc guarda `devuelto: true|false`. Si devolver falla, el doc dice que no se pudo y el
worker LEVANTA: SQS reentrega, y esa entrega (doc `error` con `devuelto: false`) reintenta
SOLO la devolución, nunca regenera. Si falla otra vez, el mensaje llega a la DLQ, que
tiene alarma (infra/stacks/alertas.py: DlqConMensajes).

Si la imagen ya está subida a la galería pero no se puede escribir el doc `listo`, no se
devuelve nada ni se marca `error`: el usuario tiene su imagen. Se reintenta la escritura y,
si sigue fallando, queda en el log.

Si el worker muere dos veces seguidas (la cola reentrega una vez y luego manda el
mensaje a la DLQ), el doc se queda en `generando` y los créditos cobrados sin devolver:
lo mismo que hoy pasa con el clip. Ver docs/OPERACION.md.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("imagen_generar")

# Lo que ve el usuario cuando falla: sin detalles internos (una traza de boto3 o el
# mensaje de fal no le dicen nada y lo asustan). Lo que necesita saber es si perdió sus
# créditos, y el mensaje solo dice que volvieron cuando la devolución salió bien.
MENSAJE_ERROR = "La imagen no se pudo generar. Se te devolvieron los créditos."
MENSAJE_SIN_COBRO = "La imagen no se pudo generar. No se te cobró."
MENSAJE_SIN_DEVOLUCION = ("La imagen no se pudo generar y no pudimos devolverte los créditos "
                          "automáticamente; ya quedó avisado.")

RECLAMO_VIVE_S = 14 * 60     # la visibilidad de la cola es de 15 min: más viejo, el worker murió
ESCRITURAS = 3               # intentos de escribir un doc en S3
PAUSA_ESCRITURA_S = 0.5


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _key_reclamo(user_id: str, imagen_id: str) -> str:
    return f"usuarios/{user_id}/imagenes-pedidos/{imagen_id}.reclamo"


def _reclamo_vencido(texto: str | None) -> bool:
    """¿El reclamo es de hace 14 minutos o más? Uno que no se lee cuenta como vencido."""
    try:
        desde = datetime.fromisoformat(json.loads(texto or "")["reclamado"])
        return (datetime.now(timezone.utc) - desde).total_seconds() >= RECLAMO_VIVE_S
    except (TypeError, ValueError, KeyError):
        return True


def _reclamar(key: str) -> bool:
    """¿Este pedido es de esta entrega? SQS estándar entrega al menos una vez y a veces dos a
    la vez: el reclamo es una escritura condicional de S3, así que de dos entregas
    simultáneas solo una lo gana. Si ya existe y es reciente, otra entrega lo está
    resolviendo; si venció, se toma con If-Match de la etiqueta que se leyó."""
    from pipeline import media_sync
    for _ in range(2):
        nuevo = json.dumps({"reclamado": _ahora()})
        if media_sync.escribir_texto_si(key, nuevo) is not None:
            return True
        texto, etag = media_sync.leer_texto_con_etag(key)
        if texto is None:       # se borró entre las dos llamadas: otra vuelta lo crea
            continue
        if not _reclamo_vencido(texto):
            return False
        return media_sync.escribir_texto_si(key, nuevo, etag=etag) is not None
    return False


def _soltar_reclamo(key: str) -> None:
    """Deja el reclamo como vencido para que la reentrega que sigue a un fallo de la
    devolución no dependa de que hayan pasado los 14 minutos justos (la cola reentrega a los
    15 menos lo que tardó este worker en arrancar). Si no se puede, la reentrega espera."""
    from pipeline import media_sync
    try:
        media_sync.escribir_texto(key, json.dumps({"reclamado": datetime.fromtimestamp(
            0, timezone.utc).isoformat(timespec="seconds")}))
    except Exception:  # noqa: BLE001
        log.exception("%s: no se pudo soltar el reclamo", key)


def _escribir_doc(key_doc: str, doc: dict) -> bool:
    """Escribe el doc con ESCRITURAS intentos cortos; False si ninguno salió."""
    from pipeline import media_sync
    for intento in range(1, ESCRITURAS + 1):
        try:
            media_sync.escribir_texto(key_doc, json.dumps(doc, ensure_ascii=False, indent=1))
            return True
        except Exception:  # noqa: BLE001 — un S3 con un mal momento no debe tumbar nada más
            log.exception("%s: no se pudo escribir el doc (intento %d de %d)", key_doc,
                          intento, ESCRITURAS)
            if intento < ESCRITURAS:
                time.sleep(PAUSA_ESCRITURA_S)
    return False


def _fallar(user_id: str, imagen_id: str, key_doc: str, doc: dict, n: int) -> None:
    """La imagen no salió: primero se devuelve, después se escribe el doc `error`.

    El orden es lo que hace honesto el mensaje. Si devolver falla, el doc lo dice
    (`devuelto: false`) y esto LEVANTA: SQS reentrega y esa entrega reintenta solo la
    devolución. Una vez devuelto no se levanta jamás, aunque el doc no se pueda escribir:
    reentregar devolvería dos veces."""
    from pipeline import creditos
    sin_devolver = None
    if not (n and creditos.activo()):       # nada se cobró: nada que devolver
        doc.update(devuelto=True, error=MENSAJE_SIN_COBRO)
    else:
        try:
            creditos.devolver(n, f"imagen:{imagen_id}", user_id)
            log.info("%s: %d créditos devueltos", imagen_id, n)
            doc.update(devuelto=True, error=MENSAJE_ERROR)
        except Exception as err:  # noqa: BLE001
            log.exception("%s: NO se pudieron devolver %d créditos a %s — se reintentará "
                          "en la reentrega; si llega a la DLQ, devolverlos a mano",
                          imagen_id, n, user_id)
            doc.update(devuelto=False, error=MENSAJE_SIN_DEVOLUCION)
            sin_devolver = err
    doc.update(estado="error", listo=doc.get("listo") or _ahora())
    if not _escribir_doc(key_doc, doc):
        log.error("%s: tampoco se pudo escribir el doc `error`; devuelto=%s",
                  imagen_id, doc["devuelto"])
    if sin_devolver is not None:
        _soltar_reclamo(_key_reclamo(user_id, imagen_id))
        raise sin_devolver


def generar(user_id: str, imagen_id: str) -> None:
    t0 = time.monotonic()
    os.environ["DEFAULT_USER_ID"] = user_id
    from pipeline import costes_infra, media_fal, media_sync

    key_doc = f"usuarios/{user_id}/imagenes-pedidos/{imagen_id}.json"
    try:
        doc = json.loads(media_sync.leer_texto(key_doc) or "{}")
    except ValueError:      # un doc ilegible no dice qué se cobró: no hay nada que resolver
        doc = {}
    if not isinstance(doc, dict):
        doc = {}
    # un `error` cuya devolución falló es el único estado terminado que aún tiene trabajo
    solo_devolver = doc.get("estado") == "error" and doc.get("devuelto") is False
    if doc.get("estado") != "generando" and not solo_devolver:
        log.info("%s: el pedido no está generando (%s), no se hace nada", imagen_id,
                 doc.get("estado"))
        return
    if not _reclamar(_key_reclamo(user_id, imagen_id)):
        log.info("%s: otra entrega tiene el pedido, no se hace nada", imagen_id)
        return
    n = int(doc.get("creditos") or 0)

    try:
        if solo_devolver:       # nunca regenerar: la imagen ya falló, solo faltan los créditos
            log.info("%s: reintento de la devolución de %d créditos", imagen_id, n)
            _fallar(user_id, imagen_id, key_doc, doc, n)
            return
        try:
            nombre = doc["nombre"]
            with tempfile.TemporaryDirectory() as td:
                destino = Path(td) / nombre
                asyncio.run(media_fal.imagen_fal(doc["prompt"], destino,
                                                 meta={"imagen_estudio": nombre},
                                                 aspecto=doc["aspecto"], modelo=doc["modelo"]))
                media_sync.subir_archivo(destino, f"imagenes/{user_id}/{nombre}")
        except Exception:  # noqa: BLE001 — la generación se atrapa TODA: relanzarla pagaría otra imagen
            log.exception("%s: la imagen falló", imagen_id)
            _fallar(user_id, imagen_id, key_doc, doc, n)
            return

        # la imagen ya está en la galería del usuario: de aquí en adelante un fallo NO devuelve
        # créditos ni marca `error`, porque la tiene
        doc.update(estado="listo", listo=_ahora())
        if _escribir_doc(key_doc, doc):
            log.info("%s: imagen lista (%s)", imagen_id, doc["modelo"])
        else:
            log.error("%s: la imagen quedó en la galería (imagenes/%s/%s) pero no se pudo "
                      "escribir el doc `listo`; el pedido se verá colgado", imagen_id, user_id,
                      doc["nombre"])
    finally:
        costes_infra.registrar(user_id, imagen_id, "infra-imagen",
                               costes_infra.costo_lambda(time.monotonic() - t0))
