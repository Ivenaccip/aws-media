"""M25 · A/F — el clip de 8 segundos: la puerta sencilla.

Hay gente que no quiere una película: quiere subir una foto, escribir una línea
y llevarse un video. Esta es esa puerta, y a propósito no comparte casi nada con
la de crear proyectos:

- **No crea proyecto.** Así nadie se topa con el 409 de slots por pedir un clip,
  no hay estado `revision` que aprobar ni Step Functions que esperar.
- **Un solo cobro.** La película cobra `preparar` al empezar y el resto al
  producir; aquí se cobra una vez y se devuelve entera si falla.
- **Sin duraciones que elegir.** Ocho segundos es el slot máximo de Veo: no es
  una opción de producto, es la unidad.

Las mismas reglas duras de la copiadora de estilos y de la competencia: preview
de costo antes de cobrar (la tarifa sale de tarifas.json §clip y la UI la enseña
en el botón), cobrar antes de encolar, y devolver en fallo nuestro.

Las imágenes suben prefirmadas a S3 y no por el formulario: tres fotos de
teléfono pasan de los 10 MB de payload que admite API Gateway, y el `.heic` con
el que salen las del iPhone pesa lo suyo.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from pipeline import clip, creditos, db, jobs, media_sync

router = APIRouter(prefix="/api/clip")

MAX_CLIPS = 40             # tope de lectura del listado
MAX_EN_MARCHA = 3          # un bug de la UI no puede encolar veinte videos
HORAS_CADUCA = 0.5         # un clip colgado no bloquea los siguientes
PRESIGN_S = 15 * 60
_ID = re.compile(r"^clip-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$")


def _nube() -> None:
    if db.backend() != "postgres" or not media_sync._bucket():
        raise HTTPException(503, "El clip de 8 segundos corre en el servicio")


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _prefijo(user: str) -> str:
    return f"usuarios/{user}/clips/"


def _key_doc(user: str, clip_id: str) -> str:
    return f"{_prefijo(user)}{clip_id}.json"


def _leer(key: str):
    try:
        return json.loads(media_sync.leer_texto(key) or "")
    except ValueError:
        return None


def _caducado(doc: dict) -> bool:
    try:
        inicio = datetime.fromisoformat(doc["inicio"])
    except (KeyError, TypeError, ValueError):
        return True
    return datetime.now(timezone.utc) - inicio > timedelta(hours=HORAS_CADUCA)


def _ficha(doc: dict, clip_id: str) -> dict:
    """Lo que ve la UI. El prompt en inglés que salió del LLM NO se enseña: es
    plomería, y enseñarlo invita a pelearse con él en vez de con la petición."""
    return {"id": clip_id, "estado": doc.get("estado"), "inicio": doc.get("inicio"),
            "listo": doc.get("listo"), "creditos": doc.get("creditos"),
            "texto": doc.get("texto", ""), "formato": doc.get("formato"),
            "imagenes": len(doc.get("imagenes") or []),
            "segundos": doc.get("segundos") or clip.DURACION_S,
            "recorte": doc.get("recorte", ""),
            "video": f"/api/clip/{clip_id}/video" if doc.get("key") else "",
            "error": doc.get("error", "")}


def _mios(user: str) -> list[tuple[str, dict]]:
    """Los clips del usuario, del más nuevo al más viejo.

    El recorte va ANTES de leer, no después: la página sondea cada 5 segundos
    mientras hay uno generándose, y leer cuarenta documentos de S3 en cada
    vuelta son cuarenta GET por usuario cada cinco segundos. El id empieza por
    la fecha (`clip-AAAAMMDD-HHMMSS-…`), así que ordenar las keys por nombre ya
    es ordenarlas por tiempo — sin abrir ninguna."""
    keys = sorted((k for k in media_sync.listar_prefijo(_prefijo(user))
                   if k.endswith(".json")), reverse=True)[:MAX_CLIPS]
    salida = []
    for key in keys:
        doc = _leer(key)
        if isinstance(doc, dict):
            salida.append((key.rsplit("/", 1)[-1][:-len(".json")], doc))
    return salida


class PresignIn(BaseModel):
    archivo: str = Field(min_length=1, max_length=200)
    content_type: str = "image/jpeg"
    bytes: int = 0


class PedidoClip(BaseModel):
    texto: str = Field(min_length=1, max_length=clip.MAX_TEXTO)
    formato: str = "horizontal"
    imagenes: list[str] = Field(default_factory=list, max_length=clip.MAX_IMAGENES)
    # M25 · E: lo que eligió arriba y si abrió el desplegable viajan con el
    # pedido para que la fila del registro de clics quede completa.
    puerta: str = ""
    desplegado: bool = False


@router.get("/config")
def config():
    """Lo que la UI necesita para pintar el botón con su precio antes de cobrar."""
    return {"activo": db.backend() == "postgres" and bool(media_sync._bucket()),
            "creditos": creditos.costo_clip(0),
            "creditos_con_composicion": creditos.costo_clip(2),
            "max_imagenes": clip.MAX_IMAGENES,
            "segundos": clip.DURACION_S,
            "extensiones": sorted(clip.EXTS),
            "max_bytes": clip.MAX_BYTES_IMAGEN}


@router.post("/presign")
def presign(body: PresignIn):
    """Una firma por imagen: el navegador sube DIRECTO a S3."""
    _nube()
    ext = os.path.splitext(body.archivo.replace("\\", "/"))[1].lower()
    if ext not in clip.EXTS:
        raise HTTPException(422, f"Esa imagen no se puede usar ({ext or 'sin extensión'}). "
                                 f"Sirven: {', '.join(sorted(clip.EXTS))}.")
    if body.bytes > clip.MAX_BYTES_IMAGEN:
        raise HTTPException(422, "Esa imagen pesa demasiado (máximo 20 MB).")
    user = db.usuario_actual()
    key = f"{_prefijo(user)}subidas/{uuid4().hex[:12]}{ext}"
    url = media_sync._s3().generate_presigned_url(
        "put_object",
        Params={"Bucket": media_sync._bucket(), "Key": key,
                "ContentType": body.content_type},
        ExpiresIn=PRESIGN_S)
    # el navegador debe mandar el mismo Content-Type: va dentro de la firma
    return {"url": url, "key": key, "content_type": body.content_type}


@router.post("/generar")
def generar(pedido: PedidoClip):
    """Cobra y encola. El progreso viaja por el doc del clip."""
    _nube()
    user = db.usuario_actual()
    texto = pedido.texto.strip()
    if not texto:
        raise HTTPException(422, "Escribe qué quieres ver en el video")
    if pedido.formato not in ("horizontal", "vertical"):
        raise HTTPException(422, f"formato desconocido: {pedido.formato!r}")
    if len(pedido.imagenes) > clip.MAX_IMAGENES:
        raise HTTPException(422, f"Como mucho {clip.MAX_IMAGENES} imágenes por clip")
    # las keys las manda el navegador: sin esto, cualquiera pediría la de otro
    propio = f"{_prefijo(user)}subidas/"
    for key in pedido.imagenes:
        if not key.startswith(propio) or ".." in key:
            raise HTTPException(422, "Esa imagen no es tuya")

    vivos = [d for _, d in _mios(user)
             if d.get("estado") == "generando" and not _caducado(d)]
    if len(vivos) >= MAX_EN_MARCHA:
        raise HTTPException(409, f"Ya tienes {MAX_EN_MARCHA} clips generándose — "
                                 "espera a que terminen.")

    n = creditos.costo_clip(len(pedido.imagenes))
    clip_id = ("clip-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
               + "-" + uuid4().hex[:6])
    if creditos.activo():
        try:
            creditos.cobrar(n, f"clip:{clip_id}", user)
        except creditos.SinSaldo as e:
            raise HTTPException(402, str(e))
    doc = {"estado": "generando", "inicio": _ahora(), "creditos": n,
           "texto": texto, "formato": pedido.formato,
           "imagenes": list(pedido.imagenes),
           "segundos": clip.DURACION_S}
    media_sync.escribir_texto(_key_doc(user, clip_id),
                              json.dumps(doc, ensure_ascii=False, indent=1))
    try:
        jobs.encolar_clip(user, clip_id)
    except Exception as err:  # noqa: BLE001 — cobrado y sin job = lo peor: revertir
        if creditos.activo():
            creditos.devolver(n, f"clip:{clip_id}", user)
        doc.update(estado="error", error=f"no se pudo encolar: {err}"[:300])
        media_sync.escribir_texto(_key_doc(user, clip_id),
                                  json.dumps(doc, ensure_ascii=False, indent=1))
        raise HTTPException(502, f"No se pudo lanzar el clip: {str(err)[:200]}")
    return {"lanzado": True, "id": clip_id, "creditos": n}


@router.get("")
def listar():
    _nube()
    return {"clips": [_ficha(d, i) for i, d in _mios(db.usuario_actual())]}


@router.get("/{clip_id}")
def ver(clip_id: str):
    _nube()
    if not _ID.match(clip_id):
        raise HTTPException(404, "no encontrado")
    doc = _leer(_key_doc(db.usuario_actual(), clip_id))
    if not isinstance(doc, dict):
        raise HTTPException(404, "no encontrado")
    return _ficha(doc, clip_id)


@router.get("/{clip_id}/video")
def video(clip_id: str):
    _nube()
    if not _ID.match(clip_id):
        raise HTTPException(404, "no encontrado")
    doc = _leer(_key_doc(db.usuario_actual(), clip_id))
    if not isinstance(doc, dict) or not doc.get("key"):
        raise HTTPException(404, "no encontrado")
    base = os.getenv("CDN_BASE", "").rstrip("/")
    if not base:
        raise HTTPException(503, "CDN_BASE no configurada — sin ella no hay media en nube")
    return RedirectResponse(f"{base}/{doc['key']}")
