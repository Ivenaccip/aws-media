"""FastAPI del producto fusionado: f1/e1 + rama generador + cut-editor.

Arranque (desde la raíz del repo): uvicorn server.app:app --port 8011
Un solo worker (estado en memoria + JSON — PLAN-FUSION.md F4)."""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from pipeline import flow
from pipeline.project import (DURACION_MAX_S, EscenaGuion, Proyecto, Referencia, cargar_proyecto,
                              listar_proyectos, nuevo_proyecto)
from pipeline.pricing import estimar_produccion
from pipeline.styles import ESTILOS
from pipeline.voices import VOCES, VOZ_DEFAULT, STABILITY_DEFAULT
from pipeline import fal
from pipeline.config import settings
from server.broll_api import router as broll_router
from server.editor import router as editor_router
from server.overlays_api import router as overlays_router
from server.publicar_api import router as publicar_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = FastAPI(title="edicion_y_generacion")
app.include_router(editor_router)
app.include_router(overlays_router)
app.include_router(publicar_router)
app.include_router(broll_router)
ROOT = Path(__file__).resolve().parent.parent  # raíz del repo
MAX_REFS = 4
_tareas: dict[str, asyncio.Task] = {}


@app.get("/api/edicion/proyectos")
def proyectos_edicion():
    """Proyectos videos/video-N para la pestaña e1: estado según qué artefactos existen."""
    out = []
    for d in sorted((ROOT / "videos").glob("*/")):
        if not (d / "work").is_dir():
            continue
        cuts = (d / "work" / "analysis" / "cuts.json").is_file()
        proxy = (d / "work" / "editor" / "proxy.mp4").is_file()
        canonico = any((d / "work" / "transcripts").glob("*.canonical.json"))
        generado = (d / "pelicula.mp4").is_file()
        out.append({"nombre": d.name, "generado": generado, "canonico": canonico,
                    "cuts": cuts, "editor_listo": cuts and proxy})
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
    _lanzar(p, flow.preparar(p))
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


class MuestraIn(BaseModel):
    voz: str
    texto: str


@app.post("/api/proyectos/{id_}/voz/muestra")
async def muestra_voz(id_: str, body: MuestraIn):
    """Sintetiza un texto corto con la voz pedida (≈ $0.01) y lo cachea en work/<id>/voces/."""
    p = _proyecto(id_)
    if body.voz not in VOCES:
        raise HTTPException(422, "Voz desconocida")
    texto = body.texto.strip()[:300]
    if not texto:
        raise HTTPException(422, "Texto vacío")
    import hashlib
    nombre = f"voces/{body.voz}_{hashlib.md5(texto.encode()).hexdigest()[:8]}.mp3"
    destino = p.workdir / nombre
    if not destino.exists():
        destino.parent.mkdir(parents=True, exist_ok=True)
        try:
            res = await fal.llamar(settings.fal_tts, {"text": texto, "voice": body.voz, "stability": STABILITY_DEFAULT,
                                                      "similarity_boost": 0.75, "language_code": "es"},
                                   timeout_s=120, nombre="tts", meta={"muestra_voz": body.voz, "proyecto": p.id})
            await fal.descargar(res["audio"]["url"], destino)
        except Exception as err:  # noqa: BLE001
            raise HTTPException(502, f"TTS falló: {str(err)[:200]}")
    return {"url": f"/api/proyectos/{p.id}/archivo/{nombre}"}


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


class EstimacionIn(BaseModel):
    escenas: list[str]


@app.post("/api/proyectos/{id_}/estimacion")
def estimacion(id_: str, body: EstimacionIn):
    _proyecto(id_)
    return estimar_produccion([t for t in body.escenas if t.strip()])


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
    _lanzar(p, flow.producir(p))
    return p


@app.get("/api/proyectos/{id_}/archivo/{nombre:path}")
def archivo(id_: str, nombre: str):
    p = _proyecto(id_)
    f = (p.workdir / nombre).resolve()
    if p.workdir.resolve() not in f.parents or not f.is_file():
        raise HTTPException(404, "Archivo no encontrado")
    return FileResponse(f)


app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")
