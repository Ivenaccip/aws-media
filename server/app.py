"""FastAPI del producto fusionado: f1/e1 + rama generador + cut-editor.

Arranque (desde la raíz del repo): uvicorn server.app:app --port 8011
Un solo worker (estado en memoria + JSON — PLAN-FUSION.md F4)."""
from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from pipeline import character, flow
from pipeline.project import (DURACION_MAX_S, EscenaGuion, OpcionPersonaje, Proyecto, Referencia,
                              cargar_proyecto, listar_proyectos, nuevo_proyecto)
from pipeline.pricing import estimar_produccion
from pipeline.styles import ESTILOS, resolver_estilo
from pipeline.voices import VOCES, VOZ_DEFAULT, STABILITY_DEFAULT
from pipeline import fal
from pipeline.config import settings
from pipeline.storage import media_root, videos_root
from pipeline import creditos, db, jobs, media_sync
from server import auth
from server.broll_api import router as broll_router
from server.editor import router as editor_router
from server.importar_api import router as importar_router
from server.media_api import router as media_router
from server.overlays_api import router as overlays_router
from server.pagos_api import router as pagos_router
from server import pagos_api
from server.publicar_api import router as publicar_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = FastAPI(title="edicion_y_generacion")
app.middleware("http")(auth.middleware)   # M2: exige el JWT en /api/* y /editor/*
app.include_router(editor_router)
app.include_router(importar_router)
app.include_router(overlays_router)
app.include_router(publicar_router)
app.include_router(broll_router)
app.include_router(media_router)
app.include_router(pagos_router)
ROOT = Path(__file__).resolve().parent.parent  # raíz del repo
MAX_REFS = 4
_tareas: dict[str, asyncio.Task] = {}


@app.get("/api/edicion/proyectos")
def proyectos_edicion():
    """Proyectos videos/video-N para la pestaña e1: estado según qué artefactos existen.
    Con backend postgres (C2/C3) se suman los proyectos registrados por subidas a S3."""
    out = []
    for d in sorted(videos_root().glob("*/")):
        if not (d / "work").is_dir():
            continue
        cuts = (d / "work" / "analysis" / "cuts.json").is_file()
        proxy = (d / "work" / "editor" / "proxy.mp4").is_file()
        canonico = any((d / "work" / "transcripts").glob("*.canonical.json"))
        generado = (d / "pelicula.mp4").is_file()
        out.append({"nombre": d.name, "generado": generado, "canonico": canonico,
                    "cuts": cuts, "editor_listo": cuts and proxy, "subidas": []})
    if db.backend() == "postgres":
        en_fs = {p["nombre"] for p in out}
        for fila in db.listar_proyectos_editor(db.usuario_actual()):
            if fila["nombre"] in en_fs:
                continue
            flags = fila["doc"].get("flags", {})   # los pone el puente (C4)
            out.append({"nombre": fila["nombre"],
                        "generado": flags.get("generado", False),
                        "canonico": flags.get("canonico", False),
                        "cuts": flags.get("cuts", False),
                        "editor_listo": False,     # el cut-editor sobre S3 es deuda C4
                        "subidas": fila["doc"].get("subidas", [])})
    return out


def _proyecto(id_: str) -> Proyecto:
    p = cargar_proyecto(id_)
    if p is None:
        raise HTTPException(404, "Proyecto no encontrado")
    return p


def _lanzar(p: Proyecto, coro) -> None:
    t = _tareas.get(p.id)
    if t and not t.done():
        coro.close()
        raise HTTPException(409, "El proyecto ya tiene una tarea en curso")
    _tareas[p.id] = asyncio.create_task(coro)


@app.get("/api/auth/config")
def auth_config():
    """Público: lo que auth.js necesita para mandar al Hosted UI (PKCE).
    En dev local (sin Cognito) devuelve activo=False y la web no exige login."""
    return {"activo": auth.activo(),
            "dominio": os.getenv("COGNITO_DOMINIO", ""),
            "client_id": os.getenv("COGNITO_CLIENT_ID", "")}


@app.get("/api/estilos")
def estilos():
    return [{"id": e.id, "nombre": e.nombre} for e in ESTILOS.values()] + [{"id": "custom", "nombre": "Custom"}]


@app.get("/api/proyectos")
def proyectos():
    return [{"id": p.id, "creado": p.creado, "estado": p.estado, "brief": p.brief[:80]} for p in listar_proyectos()]


@app.post("/api/proyectos")
async def crear(
    brief: str = Form(...), estilo: str = Form("animated"), estilo_custom: str = Form(""),
    duracion_s: int = Form(45), referencias: list[UploadFile] = File(default=[]),
    modo: str = Form("auto"), rubro: str = Form(""), forzar: bool = Form(False),
):
    if not brief.strip():
        raise HTTPException(422, "El brief está vacío")
    if len(referencias) > MAX_REFS:
        raise HTTPException(422, f"Máximo {MAX_REFS} referencias")
    # F3.3 balanceador: valida tema vs rubro ANTES de crear (y de gastar en research).
    # "forzar" = el usuario vio el aviso y decidió continuar de todos modos.
    if rubro.strip() and modo != "idea" and not forzar:
        from pipeline import research
        veredicto = await research.balancear(brief, rubro.strip())
        if not veredicto["coincide"]:
            raise HTTPException(409, {"balanceador": veredicto["motivo"],
                                      "aviso": "El brief no parece del rubro declarado. "
                                               "Puedes reenviar con forzar=true."})
    p = nuevo_proyecto(brief, estilo, estilo_custom or None, min(duracion_s, DURACION_MAX_S),
                       modo=modo, rubro=rubro)
    refs_dir = p.workdir / "refs"
    refs_dir.mkdir(parents=True, exist_ok=True)
    for i, f in enumerate(referencias):
        if not f.filename:
            continue
        ext = Path(f.filename).suffix.lower() or ".png"
        destino = refs_dir / f"ref_{i}{ext}"
        destino.write_bytes(await f.read())
        p.referencias.append(Referencia(nombre_archivo=f.filename, path=str(destino)))
    p.guardar()
    # C5 gate duro: sin saldo no se lanza nada que cueste dinero. El cobro es
    # atómico en Postgres; si algo truena DESPUÉS del cobro, se devuelve.
    if creditos.activo():
        try:
            creditos.cobrar(creditos.costo_preparar(), f"preparar:{p.id}")
        except creditos.SinSaldo as e:
            raise HTTPException(402, str(e))
    try:
        if jobs.backend() == "aws":
            # C4: preparar corre en el worker SQS. Las refs viajan por S3 (este /tmp
            # no es el del worker); ambos comparten WORK_DIR, así que el path coincide.
            media_sync.subir_dir(p.workdir, media_sync.prefijo_work(db.usuario_actual(), p.id))
            jobs.encolar_preparar(db.usuario_actual(), p.id)
        else:
            _lanzar(p, flow.preparar(p))
    except Exception:
        if creditos.activo():
            creditos.devolver(creditos.costo_preparar(), f"preparar:{p.id}")
        raise
    return p


@app.get("/api/proyectos/{id_}")
def ver(id_: str):
    return _proyecto(id_)


class GuionIn(BaseModel):
    escenas: list[str]
    voz: str | None = None


@app.put("/api/proyectos/{id_}/guion")
def guardar_guion(id_: str, body: GuionIn):
    p = _proyecto(id_)
    if p.estado != "revision":
        raise HTTPException(409, f"El guion solo se edita en revisión (estado: {p.estado})")
    p.guion = [EscenaGuion(id=str(i + 1), narracion=t.strip()) for i, t in enumerate(body.escenas) if t.strip()]
    if body.voz:
        if body.voz not in VOCES:
            raise HTTPException(422, f"Voz desconocida: {body.voz}")
        p.voz = body.voz
    p.guardar()
    return p


@app.get("/api/voces")
def voces():
    return [{"id": v, "caracter": d} for v, d in VOCES.items()]


# M1: muestra de voz con TEXTO FIJO, cacheada GLOBAL por voz — se genera una
# sola vez en la vida (≈ $0.01) y de ahí en adelante escuchar voces es gratis.
TEXTO_MUESTRA_VOZ = "Hola, mi nombre es {nombre} y seré tu locutor."


async def _generar_muestra_voz(destino: Path, voz: str) -> None:
    destino.parent.mkdir(parents=True, exist_ok=True)
    texto = TEXTO_MUESTRA_VOZ.format(nombre=voz)
    try:
        res = await fal.llamar(settings.fal_tts, {"text": texto, "voice": voz, "stability": STABILITY_DEFAULT,
                                                  "similarity_boost": 0.75, "language_code": "es"},
                               timeout_s=120, nombre="tts", meta={"muestra_voz": voz})
        await fal.descargar(res["audio"]["url"], destino)
    except Exception as err:  # noqa: BLE001
        raise HTTPException(502, f"TTS falló: {str(err)[:200]}")


@app.get("/api/voces/{voz}/muestra")
async def muestra_voz(voz: str):
    """Audio de muestra de una voz. Caché: S3 (`voces/<voz>.mp3`) en AWS, media/voces/ en local."""
    if voz not in VOCES:
        raise HTTPException(404, "Voz desconocida")
    bucket = os.getenv("MEDIA_BUCKET", "")
    if bucket:
        import boto3
        import tempfile
        s3, key = boto3.client("s3"), f"voces/{voz}.mp3"
        try:
            s3.head_object(Bucket=bucket, Key=key)
        except Exception:  # noqa: BLE001 — no existe aún: generar una vez
            tmp = Path(tempfile.gettempdir()) / f"muestra_{voz}.mp3"
            await _generar_muestra_voz(tmp, voz)
            s3.put_object(Bucket=bucket, Key=key, Body=tmp.read_bytes(), ContentType="audio/mpeg")
        cdn = os.getenv("CDN_BASE", "").rstrip("/")
        if cdn:
            return RedirectResponse(f"{cdn}/{key}")
        return RedirectResponse(s3.generate_presigned_url(
            "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=3600))
    destino = media_root() / "media" / "voces" / f"{voz}.mp3"
    if not destino.exists():
        await _generar_muestra_voz(destino, voz)
    return FileResponse(destino, media_type="audio/mpeg")


class PersonajeIn(BaseModel):
    elegida: int
    nombre: str | None = None


@app.put("/api/proyectos/{id_}/personaje")
def elegir_personaje(id_: str, body: PersonajeIn):
    p = _proyecto(id_)
    if p.estado != "revision":
        raise HTTPException(409, f"Solo en revisión (estado: {p.estado})")
    if not 0 <= body.elegida < len(p.personaje.opciones):
        raise HTTPException(422, "Opción inválida")
    p.personaje.elegida = body.elegida
    if body.nombre:
        p.personaje.nombre = body.nombre.strip()
    p.guardar()
    return p


def _sync_workdir(p: Proyecto) -> None:
    """C4: en AWS los archivos generados por la API viajan a S3 (el /tmp de la
    Lambda es efímero); /archivo/{nombre} los sirve por CDN si ya no están."""
    if jobs.backend() == "aws":
        media_sync.subir_dir(p.workdir, media_sync.prefijo_work(db.usuario_actual(), p.id))


@app.post("/api/proyectos/{id_}/personaje/generar")
async def generar_personaje(id_: str):
    """M1: 2 opciones SIN imagen de referencia, derivadas del guion. Gratis —
    está incluido en los créditos de preparar (repara proyectos varados)."""
    p = _proyecto(id_)
    if p.estado != "revision":
        raise HTTPException(409, f"Solo en revisión (estado: {p.estado})")
    if p.personaje.opciones:
        raise HTTPException(409, "Este proyecto ya tiene opciones de personaje")
    if not p.guion:
        raise HTTPException(422, "El guion está vacío")
    d = await character.describir_desde_guion(flow.guion_numerado(p))
    per = await character.preparar_personaje_sin_ref(p, resolver_estilo(p.estilo, p.estilo_custom), d)
    if not per.opciones:
        raise HTTPException(502, "No se pudieron generar las opciones — vuelve a intentarlo")
    p.personaje = per
    p.guardar()
    _sync_workdir(p)
    return p


class ModificarPersonajeIn(BaseModel):
    instruccion: str
    opcion: int | None = None  # default: la elegida


@app.post("/api/proyectos/{id_}/personaje/modificar")
async def modificar_personaje(id_: str, body: ModificarPersonajeIn):
    """M1: edita una opción con una instrucción («ponle lentes»). Tarifa de
    imagen estándar; la versión nueva se AGREGA (las versiones no se borran)."""
    p = _proyecto(id_)
    if p.estado != "revision":
        raise HTTPException(409, f"Solo en revisión (estado: {p.estado})")
    idx = body.opcion if body.opcion is not None else p.personaje.elegida
    if idx is None or not 0 <= idx < len(p.personaje.opciones):
        raise HTTPException(422, "Elige primero la opción que quieres modificar")
    instruccion = body.instruccion.strip()
    if not instruccion:
        raise HTTPException(422, "Escribe qué quieres cambiar")
    base = p.personaje.opciones[idx]
    costo_cr = creditos.costo_imagen()
    if creditos.activo():
        try:
            creditos.cobrar(costo_cr, f"imagen:{p.id}")
        except creditos.SinSaldo as e:
            raise HTTPException(402, str(e))
    try:
        prompt = (f"{instruccion}. Keep the same character identity as the reference image. "
                  f"{resolver_estilo(p.estilo, p.estilo_custom).prompt}. Clean neutral background, no text.")
        res = await fal.llamar(settings.fal_grok,
                               {"prompt": prompt, "image_urls": [base.url], "aspect_ratio": "1:1"},
                               timeout_s=settings.grok_timeout_s, nombre="grok",
                               meta={"personaje_mod": p.id})
        url = ((res.get("images") or [{}])[0]).get("url")
        if not url:
            raise RuntimeError("el modelo no devolvió imagen")
        i = len(p.personaje.opciones)
        destino = p.workdir / "personaje" / f"opcion_{i}.jpg"
        await fal.descargar(url, destino)
        p.personaje.opciones.append(OpcionPersonaje(url=url, path=str(destino)))
        p.personaje.elegida = i
        p.guardar()
        _sync_workdir(p)
    except Exception as err:  # noqa: BLE001 — fallo nuestro = créditos de vuelta
        if creditos.activo():
            creditos.devolver(costo_cr, f"imagen:{p.id}")
        raise HTTPException(502, f"No se pudo modificar la imagen: {str(err)[:200]}")
    return p


class EstimacionIn(BaseModel):
    escenas: list[str]


@app.post("/api/proyectos/{id_}/estimacion")
def estimacion(id_: str, body: EstimacionIn):
    p = _proyecto(id_)
    est = estimar_produccion([t for t in body.escenas if t.strip()])
    if creditos.activo():
        # el cobro real de producir es por duración OBJETIVO (docs/ECONOMIA.md)
        est["creditos"] = creditos.costo_producir(p.duracion_s)
        est["creditos_saldo"] = creditos.saldo()
    return est


@app.get("/api/creditos")
def creditos_estado():
    """Saldo y movimientos del monedero (C5). Sin backend: {"activo": False}."""
    if not creditos.activo():
        return {"activo": False}
    u = db.usuario_actual()
    # M4: cada pack lleva su Payment Link con el user_id incrustado (si el
    # dueño ya configuró los links); sin links la UI cae al modo concierge
    links = pagos_api.links_packs(u)
    packs = [{**p, **({"link": links[p["creditos"]]} if p["creditos"] in links else {})}
             for p in creditos.PACKS]
    return {"activo": True, "saldo": creditos.saldo(u),
            "tarifas": {"preparar": creditos.costo_preparar(),
                        "video_por_segundo": creditos.VIDEO_CR_POR_SEGUNDO,
                        "imagen": creditos.costo_imagen()},
            "packs": packs,  # M1: la UI arma el CTA de recarga con esto
            "movimientos": db.movimientos_creditos(u, 20)}


@app.post("/api/proyectos/{id_}/producir")
async def producir(id_: str):  # async: create_task necesita el loop del servidor
    p = _proyecto(id_)
    if p.estado not in ("revision", "error"):  # error → reintento con el mismo guion y personaje
        raise HTTPException(409, f"Solo se produce desde revisión (estado: {p.estado})")
    p.error, p.progreso = None, {}
    if not p.guion:
        raise HTTPException(422, "El guion está vacío")
    if p.personaje.url_elegida is None:
        raise HTTPException(422, "Elige una opción de personaje")
    # M5 (deuda C5-4): claim ATÓMICO del estado antes de cobrar — dos clics
    # ultrarrápidos ya no pueden pasar ambos el check y cobrar dos veces.
    # Solo aplica con estado en Postgres; en dev local (json) no hay carrera
    # que importe (un solo usuario, un solo proceso).
    estado_previo = p.estado
    reclamado = db.backend() == "postgres"
    if reclamado and not db.reclamar_produccion(db.usuario_actual(), p.id):
        raise HTTPException(409, "Esta película ya se está produciendo")
    # C5: se cobra la duración objetivo ANTES de lanzar (estimación hacia
    # arriba); si la producción falla, el worker devuelve los créditos.
    costo_cr = creditos.costo_producir(p.duracion_s)
    if creditos.activo():
        try:
            creditos.cobrar(costo_cr, f"producir:{p.id}")
        except creditos.SinSaldo as e:
            if reclamado:
                db.liberar_produccion(db.usuario_actual(), p.id, estado_previo)
            raise HTTPException(402, str(e))
    try:
        if jobs.backend() == "aws":
            # C4 regla dura: producciones SIEMPRE por Step Functions (→ Fargate).
            p.estado, p.etapa = "produciendo", "encolado"
            p.guardar()
            jobs.lanzar_produccion(db.usuario_actual(), p.id)
        else:
            _lanzar(p, flow.producir(p))
    except Exception:
        if creditos.activo():
            creditos.devolver(costo_cr, f"producir:{p.id}")
        if reclamado:
            db.liberar_produccion(db.usuario_actual(), p.id, estado_previo)
        raise
    return p


@app.get("/api/proyectos/{id_}/archivo/{nombre:path}")
def archivo(id_: str, nombre: str):
    p = _proyecto(id_)
    f = (p.workdir / nombre).resolve()
    if p.workdir.resolve() not in f.parents:
        raise HTTPException(404, "Archivo no encontrado")
    if f.is_file():
        return FileResponse(f)
    # C4: el archivo puede haberlo escrito OTRO ejecutor — está en S3 vía CDN
    cdn = os.getenv("CDN_BASE", "").rstrip("/")
    if cdn:
        prefijo = media_sync.prefijo_work(db.usuario_actual(), p.id)
        return RedirectResponse(f"{cdn}/{prefijo}{nombre}")
    raise HTTPException(404, "Archivo no encontrado")


app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")
