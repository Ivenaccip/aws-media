"""Imágenes en segundo plano: el pedido, su estado y lo que sigue generándose.

`POST /api/imagenes` generaba la imagen DENTRO de la petición, y la Lambda del API
corta a los 29 s (API Gateway HTTP API: tope fijo de 30 s; un arranque en frío ya
gasta unos 16). Tres modelos tardaron más de 10 s en la prueba pagada y van por aquí —FLUX 3
hasta 25.0 s, Seedream 4.5 hasta 22.7 s y Seedream 5.0 Flash 15.0 s—, y si la petición se corta
se cobra, no se devuelve y fal cobra igual. Esos pasan por
aquí, con el mismo patrón del clip (server/clip_api.py): cobrar → doc en S3 → cola →
worker/imagen_generar.py → la pantalla sondea el doc.

Cuáles son lo dice una bandera por modelo (`Modelo.segundo_plano`); los rápidos
—FLUX.2 klein, Z-Image Turbo y FLUX.2 pro— siguen síncronos y con la respuesta de
siempre, y también Grok, el predeterminado (13 a 29 s), y Nano Banana 2 (11.7 s), por decisión
del dueño de dejarlos como están «de momento» (docs/OPERACION.md, «Imágenes en segundo plano»). Solo aplica a CREAR (editar no
se toca) y solo en la nube: en local no hay SQS ni S3 y todo sigue síncrono.

El navegador distingue las dos respuestas por la presencia de `lanzado`:
  síncrono      → {"nombre": "<12hex>.jpg", "url": "/api/imagenes/<nombre>"}
  segundo plano → {"lanzado": true, "id": "img-…", "creditos": n}

El doc vive en usuarios/<user>/imagenes-pedidos/<id>.json. La imagen terminada vive
donde viven las de siempre (imagenes/<user>/<nombre>), así que «Mis creaciones» la
encuentra sin cambios y el pedido `listo` ya no se enseña como pendiente.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from pipeline import creditos, db, jobs, media_sync, modelos_ia

router = APIRouter(prefix="/api/imagenes")
log = logging.getLogger("imagen_cola")

MAX_EN_MARCHA = 3          # un bug de la UI no puede encolar veinte imágenes
HORAS_CADUCA = 0.75        # un pedido colgado no bloquea los siguientes. 45 min y no 30: la cola
                           # reentrega a los 15 y un pedido puede esperar detrás de dos clips
HORAS_ERROR = 1            # un error se enseña una hora y luego se va
MAX_PENDIENTES = 10        # tope de lectura de lo que se enseña como pendiente
# Lo que ve el usuario si el pedido no se pudo lanzar: el detalle técnico (una traza de
# boto3, la URL de la cola) no le sirve y no se enseña; va al log
MENSAJE_NO_LANZADA = "No se pudo lanzar la imagen. Inténtalo otra vez; no se te cobró."
# Un pedido que caducó (HORAS_CADUCA) sin que el worker lo resolviera: no sabemos si se
# devolvió ni si todavía llega, así que no se afirma
MENSAJE_CADUCADO = ("Esta imagen tardó demasiado y no llegó. Si no ves tus créditos de "
                    "vuelta, escríbenos.")
_ID = re.compile(r"img-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}")


def _nube() -> bool:
    return jobs.backend() == "aws"


def en_segundo_plano(modelo_id: str | None) -> bool:
    """¿Esta imagen se genera en segundo plano? Solo en la nube y solo con un modelo que
    lo pide. Sin modelo (`None`) vale el predeterminado, que es rápido."""
    return _nube() and modelos_ia.resolver("imagen", modelo_id).segundo_plano


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _prefijo(user: str) -> str:
    return f"usuarios/{user}/imagenes-pedidos/"


def _key_doc(user: str, imagen_id: str) -> str:
    return f"{_prefijo(user)}{imagen_id}.json"


def _leer(key: str):
    try:
        return json.loads(media_sync.leer_texto(key) or "")
    except ValueError:
        return None


def _mas_viejo_que(iso, horas: float) -> bool:
    """¿Pasaron más de `horas` desde esa fecha? Una fecha que no se lee cuenta como vieja."""
    try:
        return datetime.now(timezone.utc) - datetime.fromisoformat(iso) > timedelta(hours=horas)
    except (TypeError, ValueError):
        return True


def _caducado(doc: dict) -> bool:
    return _mas_viejo_que(doc.get("inicio"), HORAS_CADUCA)


def _ficha(doc: dict, imagen_id: str) -> dict:
    """Lo que ve la UI. El prompt completo (con el estilo y las reglas que le pegamos
    para fal) NO se enseña: es plomería. Lo que el usuario escribió viaja en `texto`."""
    nombre = doc.get("nombre", "")
    return {"id": imagen_id, "estado": doc.get("estado"), "inicio": doc.get("inicio"),
            "texto": doc.get("texto", ""), "modelo": doc.get("modelo"),
            "creditos": doc.get("creditos"), "nombre": nombre,
            "url": f"/api/imagenes/{nombre}" if doc.get("estado") == "listo" else "",
            "error": doc.get("error", "")}


def _leer_mios(user: str) -> tuple[list[tuple[str, dict]], bool]:
    """Los pedidos más nuevos del usuario, del más nuevo al más viejo, y si se leyeron TODOS.

    El recorte va ANTES de leer, no después: la pantalla sondea cada pocos segundos
    mientras hay una generándose, y leer el historial entero en cada vuelta son
    decenas de GET por usuario. El id empieza por la fecha (`img-AAAAMMDD-HHMMSS-…`),
    así que ordenar las keys por nombre ya es ordenarlas por tiempo, y solo se listan
    las de hoy y las de ayer: un pedido vivo tiene menos de una hora.

    `False` si un GET falló: ese pedido no está en la lista y quien la enseña tiene que
    saberlo (un doc que no es JSON no cuenta como fallo: no se va a arreglar solo). Un
    listado que falla levanta."""
    ahora = datetime.now(timezone.utc)
    keys: set[str] = set()
    for dia in (ahora, ahora - timedelta(days=1)):
        keys.update(k for k in media_sync.listar_prefijo(f"{_prefijo(user)}img-{dia:%Y%m%d}")
                    if k.endswith(".json"))
    salida, completo = [], True
    for key in sorted(keys, reverse=True)[:MAX_PENDIENTES]:
        try:
            doc = _leer(key)
        except Exception:  # noqa: BLE001 — un doc que no se puede leer no tumba los demás
            log.warning("no se pudo leer %s", key, exc_info=True)
            completo = False
            continue
        if isinstance(doc, dict):
            salida.append((key.rsplit("/", 1)[-1][:-len(".json")], doc))
    return salida, completo


def _mios(user: str) -> list[tuple[str, dict]]:
    """Los pedidos más nuevos del usuario (hoy y ayer), sin saber si se leyeron todos: para el
    tope de `lanzar` y para «Tus trabajos». `_leer_mios` dice si faltó alguno."""
    return _leer_mios(user)[0]


def como_se_ve(doc: dict) -> dict | None:
    """El doc tal como se le enseña al usuario. Un `generando` que caducó (más de HORAS_CADUCA)
    no desaparece en silencio: durante la hora desde su inicio se enseña como `error`, con un
    mensaje que NO afirma que se devolvieron los créditos (no sabemos qué le pasó al worker, y
    `devuelto: false` lo deja dicho para quien lo lea); pasada esa hora, `None`. Los demás docs
    se enseñan tal cual."""
    if doc.get("estado") != "generando" or not _caducado(doc):
        return doc
    if _mas_viejo_que(doc.get("inicio"), HORAS_ERROR):
        return None
    return {**doc, "estado": "error", "error": MENSAJE_CADUCADO, "devuelto": False}


def pendientes(user: str) -> tuple[list[dict], bool]:
    """Lo que `GET /api/imagenes` enseña aparte de las imágenes —los pedidos que siguen
    generándose y los que fallaron (o caducaron) en la última hora, del más nuevo al más
    viejo; el `listo` no entra: ya está en las imágenes— y si se pudo leer todo.

    Es de cortesía: si S3 falla, la lista de imágenes sigue saliendo sin ellos, pero con el
    segundo valor en `False`. Un `[]` sin ese aviso se leería como «no hay pendientes» y la
    pantalla dejaría de esperar un pedido que sigue en marcha. En local no hay cola: `[]`, True."""
    if not _nube():
        return [], True
    try:
        pedidos, completo = _leer_mios(user)
        salida = []
        for imagen_id, doc in pedidos:
            doc = como_se_ve(doc)
            if doc is None:
                continue
            estado = doc.get("estado")
            if estado == "generando" or (estado == "error" and not _mas_viejo_que(
                    doc.get("listo") or doc.get("inicio"), HORAS_ERROR)):
                salida.append(_ficha(doc, imagen_id))
        return salida, completo
    except Exception:  # noqa: BLE001
        log.warning("no se pudieron leer los pedidos pendientes de %s", user, exc_info=True)
        return [], False


def lanzar(user: str, texto: str, prompt: str, aspecto: str, modelo: str, costo: int) -> dict:
    """Cobra y encola. El progreso viaja por el doc del pedido.

    Ya llega validado (prompt, formato, estilo, modelo y tarifa: lo que da 422 sin cobrar
    vive en `POST /api/imagenes`). `texto` es lo que escribió el usuario y `prompt` el que
    va a fal, con el estilo puesto si lo hay (la caja del inicio pide «ninguno» y entonces
    solo lleva el texto y las reglas de siempre; aquí da igual: llega armado). El orden
    importa: el tope, luego el cobro, luego el doc y al final la cola; si algo falla
    después de cobrar, se devuelve."""
    vivos = [d for _, d in _mios(user)
             if d.get("estado") == "generando" and not _caducado(d)]
    if len(vivos) >= MAX_EN_MARCHA:
        raise HTTPException(409, f"Ya tienes {MAX_EN_MARCHA} imágenes generándose — "
                                 "espera a que terminen.")

    imagen_id = ("img-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
                 + "-" + uuid4().hex[:6])
    if creditos.activo():
        try:
            creditos.cobrar(costo, f"imagen:{imagen_id}", user)
        except creditos.SinSaldo as e:
            raise HTTPException(402, str(e))
    doc = {"estado": "generando", "inicio": _ahora(), "creditos": costo,
           "modelo": modelo, "texto": texto, "prompt": prompt, "aspecto": aspecto,
           "nombre": f"{uuid4().hex[:12]}.jpg", "listo": None, "error": ""}
    try:
        media_sync.escribir_texto(_key_doc(user, imagen_id),
                                  json.dumps(doc, ensure_ascii=False, indent=1))
        jobs.encolar_imagen(user, imagen_id)
    except Exception:  # noqa: BLE001 — cobrado y sin job = lo peor: revertir
        log.exception("%s: no se pudo lanzar la imagen", imagen_id)
        if creditos.activo():
            creditos.devolver(costo, f"imagen:{imagen_id}", user)
        doc.update(estado="error", error=MENSAJE_NO_LANZADA, listo=_ahora())
        try:
            media_sync.escribir_texto(_key_doc(user, imagen_id),
                                      json.dumps(doc, ensure_ascii=False, indent=1))
        except Exception:  # noqa: BLE001 — la devolución y el 502 importan más que el doc
            log.exception("%s: tampoco se pudo escribir el error", imagen_id)
        raise HTTPException(502, MENSAJE_NO_LANZADA)
    return {"lanzado": True, "id": imagen_id, "creditos": costo}


@router.get("/pedidos/{imagen_id}")
def ver(imagen_id: str):
    """El estado de UN pedido, bajo el usuario del token: nunca el de otro. La pantalla
    lo sondea hasta que pasa a `listo` o `error`."""
    if not _nube() or not _ID.fullmatch(imagen_id):
        raise HTTPException(404, "no encontrado")
    doc = _leer(_key_doc(db.usuario_actual(), imagen_id))
    if not isinstance(doc, dict):
        raise HTTPException(404, "no encontrado")
    return _ficha(doc, imagen_id)
