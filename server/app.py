"""FastAPI del producto fusionado: f1/e1 + rama generador + cut-editor.

Arranque (desde la raíz del repo): uvicorn server.app:app --port 8011
Un solo worker (estado en memoria + JSON — PLAN-FUSION.md F4)."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from pipeline import character, flow, media
from pipeline.models import Scene
from pipeline.project import (DURACION_MAX_S, EscenaGuion, OpcionPersonaje, Proyecto, Referencia,
                              cargar_proyecto, listar_proyectos, nuevo_proyecto)
from pipeline.run import resumen_imagenes
from pipeline.scenes import asignar_rutas
from pipeline.pricing import estimar_produccion
from pipeline.styles import ESTILOS, resolver_estilo
from pipeline.voices import VOCES, VOZ_DEFAULT, STABILITY_DEFAULT
from pipeline import fal
from pipeline.config import settings
from pipeline.storage import media_root, videos_root
from pipeline import creditos, db, jobs, media_sync
from server import auth
from server.admin_api import router as admin_router
from server.agenda_api import router as agenda_router
from server.metricas_api import router as metricas_router
from server.blotato_api import router as blotato_router
from server.broll_api import router as broll_router
from server.editar_api import router as editar_router
from server.editor import router as editor_router
from server.importar_api import router as importar_router
from server.media_api import router as media_router
from server.overlays_api import router as overlays_router
from server.pagos_api import router as pagos_router
from server import pagos_api
from server.publicar_api import router as publicar_router
from server.estilos_api import router as estilos_router
from server.competencia_api import router as competencia_router
from server.mix_api import router as mix_router
from server.clip_api import router as clip_router
from server.shorts_api import router as shorts_router


def _configurar_logging() -> None:
    """Deja el root en INFO — también dentro de Lambda, que es donde no estaba.

    `basicConfig()` es no-op si el root logger ya tiene handlers, y el runtime
    de Lambda instala el suyo antes de importar este módulo: el `level=INFO`
    nunca se aplicaba, el root se quedaba en WARNING y cada `log.info()` de los
    routers se tiraba en silencio. Siete días de CloudWatch sin una sola línea
    de la aplicación, y en local todo bien — por eso nadie lo notó.

    El `setLevel()` aparte sí surte efecto en los dos sitios, y conserva el
    handler de Lambda, que es el que asocia cada línea con su requestId.
    """
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger().setLevel(logging.INFO)


_configurar_logging()
log = logging.getLogger("peticiones")

# API Gateway corta a los 30 s y la Lambda a los 29: a los 10 s una petición ya
# va camino de morir. WARNING y no INFO para que siga viéndose aunque el root
# vuelva a quedarse en su nivel por defecto.
LENTA_MS = 10_000

app = FastAPI(title="edicion_y_generacion")
app.middleware("http")(auth.middleware)   # M2: exige el JWT en /api/* y /editor/*


@app.exception_handler(jobs.SinCapacidad)
async def _sin_capacidad(request, exc: jobs.SinCapacidad):
    """M23 · D (prerrequisito) — Fargate está lleno.

    Va aquí y no en cada endpoint porque son SEIS los que lanzan a la máquina
    de estados, en cinco archivos. Todos ya envuelven su lanzamiento en un
    try/except que devuelve los créditos y relanza, así que basta con traducir
    lo que sale: 503 con el motivo en claro. Un 500 diría «se rompió algo» de
    una situación en la que no se rompió nada — solo hay que volver luego."""
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.middleware("http")
async def _registrar_peticion(request, call_next):
    """Una línea por petición: sin esto «tarda mucho» no tiene ruta ni número.

    Va registrado después de auth para quedar por fuera de él —Starlette apila
    al revés del orden de registro—, así el tiempo medido es el que espera el
    usuario, validación del token incluida. La ruta se registra sin query
    string a propósito: por ahí viajan tokens.
    """
    arranque = time.perf_counter()
    estado = "ERROR"
    try:
        respuesta = await call_next(request)
        estado = respuesta.status_code
        return respuesta
    finally:
        ms = (time.perf_counter() - arranque) * 1000
        log.log(logging.WARNING if ms >= LENTA_MS else logging.INFO,
                "peticion %s %s -> %s en %.0f ms",
                request.method, request.url.path, estado, ms)


app.include_router(editor_router)
app.include_router(importar_router)
app.include_router(overlays_router)
app.include_router(publicar_router)
app.include_router(blotato_router)
# antes del mount de static/ de más abajo: si no, /api/agenda cae en StaticFiles
# y devuelve su 404 en HTML
app.include_router(agenda_router)
app.include_router(metricas_router)
app.include_router(broll_router)
app.include_router(media_router)
app.include_router(pagos_router)
app.include_router(admin_router)
app.include_router(shorts_router)
app.include_router(estilos_router)
app.include_router(competencia_router)
app.include_router(clip_router)
app.include_router(editar_router)
app.include_router(mix_router)


# Aurora dormida (mín 0 ACU) puede tardar más en despertar que el presupuesto
# del request: 503 con Retry-After en vez de un 500 pelado — el monedero y las
# páginas ya reintentan solos.
@app.exception_handler(db.DespertandoError)
async def _despertando(request, exc):
    return JSONResponse({"detail": "El servicio está despertando — reintenta en unos segundos."},
                        status_code=503, headers={"Retry-After": "10"})


# Red de seguridad: los endpoints ya reservan el nombre antes de crear nada,
# pero cualquier guardar_proyecto_editor sobre un nombre de otra cuenta sale
# como 409 con el mensaje para elegir otro, no como 500.
@app.exception_handler(db.NombreAjeno)
async def _nombre_ajeno(request, exc):
    return JSONResponse({"detail": str(exc)}, status_code=409)


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
                        # M7: con cuts.json en S3 el editor en nube ya abre (el
                        # puente genera proxy+manifest junto con los cortes)
                        "editor_listo": flags.get("cuts", False),
                        # M14: estado de la corrida de sugerencias (poll de e1)
                        "editar": fila["doc"].get("editar"),
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
    return [{"id": e.id, "nombre": e.nombre, "descripcion": e.descripcion} for e in ESTILOS.values()] \
        + [{"id": "custom", "nombre": "Personalizado",
            "descripcion": "Descríbelo tú con tus palabras (en inglés funciona mejor)."}]


# --- M13: guardrail del brief ------------------------------------------------
# La UI modera el texto ANTES de mandar la petición que cobra: si no pasa, un
# popup pide reformular y no se gasta nada. Revisar es gratis para el usuario.

class PedidoModerar(BaseModel):
    texto: str


@app.post("/api/moderar")
async def moderar(body: PedidoModerar):
    from pipeline import moderacion
    v = await moderacion.revisar(body.texto)
    return {"permitido": v.permitido, "motivo": v.motivo,
            "mensaje": moderacion.MENSAJE_BASE}


# --- M12: crear imágenes sueltas (sidebar «Crear imágenes») -----------------
# Mismo selector de estilo que crear + un prompt libre. Cobra la tarifa de
# imagen (la misma del cambio de personaje) y guarda bajo _imagenes/ del
# usuario (S3 en la nube, work_dir local en dev).

def _dir_imagenes() -> Path:
    return Path(settings.work_dir) / "_imagenes"


def _publicar_imagen(destino: Path, nombre: str) -> None:
    """En la nube la imagen vive en S3, bajo el usuario del token, y el archivo
    local se BORRA: /tmp/work/_imagenes lo comparten todos los usuarios que
    atiende el mismo contenedor caliente, y lo que se queda ahí lo sirve
    cualquiera que conozca el nombre (M23). En local no hay S3 y el disco es
    la única copia."""
    if jobs.backend() == "aws":
        media_sync.subir_archivo(destino, f"imagenes/{db.usuario_actual()}/{nombre}")
        destino.unlink(missing_ok=True)


class PedidoImagen(BaseModel):
    prompt: str
    estilo: str = "animated"
    estilo_custom: str = ""
    formato: str = ""


# M23 — los formatos de la herramienta de imágenes. Tabla PROPIA, y no la
# FORMATOS de pipeline.models: esa alimenta a Veo, que no acepta 1:1, y sus
# tests la fijan. Una imagen suelta sí puede ser cuadrada. Sin formato se
# queda en 1:1, que es lo que ha salido siempre.
ASPECTOS_IMAGEN = {"horizontal": "16:9", "vertical": "9:16", "cuadrado": "1:1"}


@app.post("/api/imagenes")
async def crear_imagen(body: PedidoImagen):
    from uuid import uuid4
    from pipeline import media_fal
    prompt = body.prompt.strip()[:2000]
    if not prompt:
        raise HTTPException(422, "Escribe qué imagen quieres")
    if body.formato and body.formato not in ASPECTOS_IMAGEN:
        raise HTTPException(422, f"formato desconocido: {body.formato!r}")
    aspecto = ASPECTOS_IMAGEN[body.formato or "cuadrado"]
    estilo = resolver_estilo(body.estilo if body.estilo in ESTILOS or body.estilo == "custom"
                             else "animated", body.estilo_custom or None)
    costo = creditos.costo_imagen()
    if creditos.activo():
        try:
            creditos.cobrar(costo, "imagen:estudio")
        except creditos.SinSaldo as e:
            raise HTTPException(402, str(e))
    nombre = f"{uuid4().hex[:12]}.jpg"
    destino = _dir_imagenes() / nombre
    destino.parent.mkdir(parents=True, exist_ok=True)
    try:
        await media_fal.imagen_fal(f"{prompt}. {estilo.prompt}. No text, no watermark.",
                                   destino, meta={"imagen_estudio": nombre}, aspecto=aspecto)
        _publicar_imagen(destino, nombre)
    except HTTPException:
        raise
    except Exception as err:  # noqa: BLE001
        if creditos.activo():
            creditos.devolver(costo, "imagen:estudio")
        raise HTTPException(502, f"No se pudo generar la imagen: {str(err)[:200]}")
    return {"nombre": nombre, "url": f"/api/imagenes/{nombre}"}


@app.post("/api/imagenes/editar")
async def editar_imagen(prompt: str = Form(...), imagen: UploadFile = File(...),
                        marcada: UploadFile | None = File(None),
                        modo: str = Form("pincel"),
                        estilo: str = Form(""), estilo_custom: str = Form("")):
    """M15 — «Editor de imágenes». Misma tarifa de imagen.

    Dos modos, porque el editor solo sabía hacer uno y los testers pedían el
    otro (M22 · C):

    - `pincel`: el usuario pinta la zona a cambiar y el front manda la original
      + una copia con esa zona resaltada en rosa. Todo lo demás queda intacto.
    - `todo`: sin zona pintada — cambiar estilo, época o técnica sobre la imagen
      entera. Subían un boceto, pedían «pásalo a acuarela» y el modo pincel les
      devolvía el mismo boceto, porque su instrucción exige que el resto quede
      pixel-idéntico.
    """
    import tempfile
    from uuid import uuid4
    from pipeline import media_fal
    prompt = prompt.strip()[:2000]
    if not prompt:
        raise HTTPException(422, "Describe qué quieres cambiar")
    if modo not in ("pincel", "todo"):
        raise HTTPException(422, f"modo desconocido: {modo!r}")
    # M23 — el estilo es un destino, no un filtro: solo tiene sentido cuando se
    # transforma la imagen entera. En el pincel la zona nueva tiene que pegar
    # con el resto de SU imagen, así que pedirle otro estilo la delataría.
    if modo == "todo" and estilo:
        e = resolver_estilo(estilo if estilo in ESTILOS or estilo == "custom" else "animated",
                            estilo_custom or None)
        if e.prompt:
            prompt = f"{prompt}. Target look: {e.prompt}"
    datos_img = await imagen.read()
    datos_marca = await marcada.read() if marcada is not None else b""
    if not datos_img:
        raise HTTPException(422, "Sube la imagen que quieres editar")
    if modo == "pincel" and not datos_marca:
        raise HTTPException(422, "Pinta la zona a cambiar, o usa el modo de "
                                 "transformar toda la imagen")
    if len(datos_img) > 15 * 1024 * 1024:
        raise HTTPException(422, "La imagen es muy grande (máximo 15 MB)")
    costo = creditos.costo_imagen()
    if creditos.activo():
        try:
            creditos.cobrar(costo, "imagen:editor")
        except creditos.SinSaldo as e:
            raise HTTPException(402, str(e))
    nombre = f"{uuid4().hex[:12]}.jpg"
    destino = _dir_imagenes() / nombre
    destino.parent.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory() as td:
            ext = Path(imagen.filename or "").suffix.lower()
            f_img = Path(td) / f"original{ext if ext in ('.png', '.jpg', '.jpeg', '.webp') else '.png'}"
            f_img.write_bytes(datos_img)
            if modo == "pincel":
                f_marca = Path(td) / "marcada.jpg"
                f_marca.write_bytes(datos_marca)
                await media_fal.imagen_pincel(prompt, f_img, f_marca, destino,
                                              meta={"imagen_editor": nombre})
            else:
                await media_fal.imagen_transformar(prompt, f_img, destino,
                                                   meta={"imagen_editor": nombre})
        _publicar_imagen(destino, nombre)
    except HTTPException:
        raise
    except Exception as err:  # noqa: BLE001
        if creditos.activo():
            creditos.devolver(costo, "imagen:editor")
        raise HTTPException(502, f"No se pudo editar la imagen: {str(err)[:200]}")
    return {"nombre": nombre, "url": f"/api/imagenes/{nombre}"}


# M23 · «Mis imágenes» del inicio: las imágenes sueltas nunca tuvieron dónde
# verse después de cerrar la página. Solo nombres con la forma que ponen
# crear/editar (12 hex + .jpg): lo demás del prefijo no es una de ellas.
_NOMBRE_IMAGEN = re.compile(r"[0-9a-f]{12}\.jpg")
MAX_IMAGENES = 200


@app.get("/api/imagenes")
def mis_imagenes():
    """Las imágenes del usuario, de la más nueva a la más vieja. En la nube se
    leen de SU carpeta de S3 (el usuario sale del token); en local, del disco."""
    if jobs.backend() == "aws":
        prefijo = f"imagenes/{db.usuario_actual()}/"
        filas = [(k[len(prefijo):], t) for k, t in media_sync.listar_prefijo_con_fecha(prefijo)]
    else:
        d = _dir_imagenes()
        filas = [(f.name, f.stat().st_mtime) for f in d.glob("*.jpg")] if d.is_dir() else []
    filas = sorted(((n, t) for n, t in filas if _NOMBRE_IMAGEN.fullmatch(n)),
                   key=lambda f: f[1], reverse=True)
    return {"total": len(filas),
            "imagenes": [{"nombre": n, "url": f"/api/imagenes/{n}", "creado": int(t)}
                         for n, t in filas[:MAX_IMAGENES]]}


@app.get("/api/imagenes/{nombre}/archivo")
def bytes_imagen(nombre: str):
    """M23 — los bytes de una de tus imágenes, servidos por NOSOTROS.

    `ver_imagen` redirige al CDN, y el CDN no manda cabeceras CORS: una imagen
    traída de ahí ensucia el canvas y `toBlob` revienta. Sin esto, «seguir
    editando» lo que acabas de crear solo funcionaría en local, que es donde
    no hay redirección. También lo usa el botón de descargar: `download` no
    funciona entre orígenes.

    En la nube NUNCA se sirve del disco: la carpeta de imágenes es compartida
    por el contenedor. Cada petición baja SU copia —con la clave del usuario
    del token— a un temporal propio que se borra al responder.
    """
    import tempfile

    from starlette.background import BackgroundTask
    if not nombre.replace(".jpg", "").isalnum() or not nombre.endswith(".jpg"):
        raise HTTPException(404, "Imagen no encontrada")
    if jobs.backend() != "aws":
        f = _dir_imagenes() / nombre
        if not f.is_file():
            raise HTTPException(404, "Imagen no encontrada")
        return FileResponse(f, media_type="image/jpeg")
    fd, ruta = tempfile.mkstemp(suffix=".jpg")
    os.close(fd)
    tmp = Path(ruta)
    if not media_sync.bajar_archivo(f"imagenes/{db.usuario_actual()}/{nombre}", tmp):
        tmp.unlink(missing_ok=True)
        raise HTTPException(404, "Imagen no encontrada")
    return FileResponse(tmp, media_type="image/jpeg",
                        background=BackgroundTask(tmp.unlink, missing_ok=True))


@app.get("/api/imagenes/{nombre}")
def ver_imagen(nombre: str):
    if not nombre.replace(".jpg", "").isalnum() or not nombre.endswith(".jpg"):
        raise HTTPException(404, "Imagen no encontrada")
    f = _dir_imagenes() / nombre
    # en la nube el disco es compartido entre usuarios: solo el CDN, con la
    # carpeta del usuario del token (M23)
    if jobs.backend() != "aws" and f.is_file():
        return FileResponse(f)
    cdn = os.getenv("CDN_BASE", "").rstrip("/")
    if cdn:
        return RedirectResponse(f"{cdn}/imagenes/{db.usuario_actual()}/{nombre}")
    raise HTTPException(404, "Imagen no encontrada")


def _minia_personaje(p) -> str | None:
    ops = p.personaje.opciones
    if not ops:
        return None
    i = p.personaje.elegida if p.personaje.elegida is not None and p.personaje.elegida < len(ops) else 0
    return "/".join(ops[i].path.replace("\\", "/").split("/")[-2:])


def _miniatura(p) -> tuple[str | None, str | None]:
    """(principal, respaldo) — rutas relativas (para /archivo/) de la imagen que
    representa la obra. Película lista → el frame de portada, con el personaje
    elegido de respaldo (las películas anteriores a la portada no tienen el
    frame: la card cae al personaje y solo al final al placeholder); si no está
    lista → el personaje elegido, o la primera opción si aún no eligió."""
    per = _minia_personaje(p)
    if p.estado == "listo":
        return "portada.jpg", per
    return per, None


@app.get("/api/proyectos")
def proyectos():
    def fila(p):
        mini, alt = _miniatura(p)
        return {"id": p.id, "creado": p.creado, "estado": p.estado,
                "brief": p.brief[:80], "archivado": p.archivado,
                "miniatura": mini, "miniatura_alt": alt}
    return [fila(p) for p in listar_proyectos()]


# --- M12: slots de proyectos activos --------------------------------------
# El candado vive solo en la nube (postgres), como los demás de M5/M7: el dev
# local con JSON no limita nada. None = ilimitado (plan anual).

def _slots() -> int | None:
    if db.backend() != "postgres":
        return None
    return db.slots_usuario(db.usuario_actual())


def _activos() -> int:
    return sum(1 for p in listar_proyectos() if not p.archivado)


@app.get("/api/slots")
def slots():
    return {"slots": _slots(), "activos": _activos()}


@app.post("/api/proyectos/{id_}/reabrir")
def reabrir(id_: str):
    """El botón «Modificar» del resultado: la película lista vuelve a revisión
    para ajustar guion, voz o personaje. Reabrir es gratis; producir de nuevo
    cobra como siempre (el botón lo avisa antes)."""
    p = _proyecto(id_)
    if p.estado != "listo":
        raise HTTPException(409, "Solo una película lista se puede modificar")
    p.estado = "revision"
    p.guardar()
    return p


@app.post("/api/proyectos/{id_}/archivar")
def archivar(id_: str):
    """Libera el slot sin borrar NADA: el doc queda entero y los binarios se
    enfrían solos con la lifecycle del bucket (Glacier IR a los 10 días)."""
    p = _proyecto(id_)
    if p.estado in ("preparando", "produciendo"):
        raise HTTPException(409, "El proyecto tiene una tarea en curso — espera a que termine para archivarlo")
    if not p.archivado:
        p.archivado = True
        p.guardar()
    return p


@app.post("/api/proyectos/{id_}/desarchivar")
def desarchivar(id_: str):
    p = _proyecto(id_)
    if p.archivado:
        tope = _slots()
        if tope is not None and _activos() >= tope:
            raise HTTPException(409, f"No tienes slots libres ({tope} proyectos activos). "
                                     "Archiva otro proyecto para restaurar este.")
        p.archivado = False
        p.guardar()
    return p


@app.post("/api/proyectos")
async def crear(
    brief: str = Form(...), estilo: str = Form("animated"), estilo_custom: str = Form(""),
    duracion_s: int = Form(45), referencias: list[UploadFile] = File(default=[]),
    modo: str = Form("auto"), rubro: str = Form(""), forzar: bool = Form(False),
    pipeline: str = Form(""), personaje_extra: str = Form(""),
    formato: str = Form("horizontal"),
):
    if not brief.strip():
        raise HTTPException(422, "El brief está vacío")
    # M23 · V: cada duración tiene su precio en tarifas.json; una que no está en
    # la tabla no tiene precio que cobrar. Antes de gastar en nada.
    duraciones = creditos.precios_por_duracion()
    if duracion_s not in duraciones:
        raise HTTPException(422, "Elige una duración de la lista: "
                                 + ", ".join(f"{s} s" for s in duraciones) + ".")
    if len(referencias) > MAX_REFS:
        raise HTTPException(422, f"Máximo {MAX_REFS} referencias")
    # M12: tope de proyectos activos ANTES de gastar en nada (ni research).
    tope = _slots()
    if tope is not None and _activos() >= tope:
        raise HTTPException(409, {
            "slots": tope,
            "aviso": f"Ya tienes {tope} proyectos activos — es el máximo de tu plan. "
                     "Archiva alguno desde la página de inicio para liberar un slot "
                     "(no se borra nada: un proyecto archivado se puede restaurar)."})
    # F3.3 balanceador: valida tema vs rubro ANTES de crear (y de gastar en research).
    # "forzar" = el usuario vio el aviso y decidió continuar de todos modos.
    if rubro.strip() and modo != "idea" and not forzar:
        from pipeline import research
        veredicto = await research.balancear(brief, rubro.strip())
        if not veredicto["coincide"]:
            raise HTTPException(409, {"balanceador": veredicto["motivo"],
                                      "aviso": "El brief no parece del rubro declarado. "
                                               "Puedes reenviar con forzar=true."})
    # M11 (default 2026-09-07): la web escribe la narración corrida PRIMERO y
    # las escenas se planean después sobre la voz — el guion deja de nacer en
    # cajitas de 8-16 palabras. Escape: ?pipeline=escenas o PIPELINE_DEFAULT.
    if pipeline not in ("escenas", "narracion"):
        pipeline = os.getenv("PIPELINE_DEFAULT", "narracion")
    p = nuevo_proyecto(brief, estilo, estilo_custom or None, min(duracion_s, DURACION_MAX_S),
                       modo=modo, rubro=rubro, pipeline=pipeline, formato=formato)
    p.personaje_extra = personaje_extra.strip()[:500]
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
    escenas: list[str] = []
    narracion: str | None = None   # M11: pipeline narración = un solo texto
    voz: str | None = None


@app.put("/api/proyectos/{id_}/guion")
def guardar_guion(id_: str, body: GuionIn):
    p = _proyecto(id_)
    if p.estado != "revision":
        raise HTTPException(409, f"El guion solo se edita en revisión (estado: {p.estado})")
    if p.pipeline == "narracion":
        # M5: un texto vacío jamás pisa lo que hay
        if (body.narracion or "").strip():
            p.narracion = body.narracion.strip()
    else:
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
    if not p.tiene_guion():
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
        res = await fal.llamar(settings.fal_imagen_edit,
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
                        # M23 · V: el total de cada duración elegible (la pantalla
                        # de crear arma su reloj con estas llaves)
                        "video_por_duracion": creditos.precios_por_duracion(),
                        "imagen": creditos.costo_imagen()},
            "packs": packs,  # M1: la UI arma el CTA de recarga con esto
            "movimientos": db.movimientos_creditos(u, 20)}


@app.post("/api/proyectos/{id_}/producir")
async def producir(id_: str, aprobar_imagenes: bool = False):  # async: create_task necesita el loop del servidor
    """`aprobar_imagenes` es el modo manual de M22 · G: la producción se para
    a enseñar la imagen de cada cadena antes de animarla. El cobro no cambia —
    la película se paga entera aquí— y lo que cuesta aparte es pedir otra
    imagen, que sí quema dinero nuevo."""
    p = _proyecto(id_)
    if p.estado not in ("revision", "error"):  # error → reintento con el mismo guion y personaje
        raise HTTPException(409, f"Solo se produce desde revisión (estado: {p.estado})")
    p.error, p.progreso = None, {}
    if not p.tiene_guion():
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
        p.cobrado_producir = costo_cr   # lo que se devuelve si falla
    fase = "imagenes" if aprobar_imagenes else "todo"
    try:
        if jobs.backend() == "aws":
            # C4 regla dura: producciones SIEMPRE por Step Functions (→ Fargate).
            p.estado, p.etapa = "produciendo", "encolado"
            p.guardar()
            jobs.lanzar_produccion(db.usuario_actual(), p.id, fase)
        else:
            _lanzar(p, flow.producir(p, fase))
    except Exception:
        if creditos.activo():
            creditos.devolver(costo_cr, f"producir:{p.id}")
        if reclamado:
            db.liberar_produccion(db.usuario_actual(), p.id, estado_previo)
        raise
    return p


# --- M22 · G: la pausa para aprobar las imágenes ---------------------------
# La película se cobró entera al pulsar Producir, así que animar no cobra nada:
# lo único que cuesta aquí es pedir OTRA imagen, que es lo que quema dinero
# nuevo ($0.02 dólares contra los $0.24 de animar ocho segundos).

def _estado_produccion(p: Proyecto) -> dict:
    """estado.json de la producción. En la nube lo escribió Fargate y la Lambda
    no tiene ese disco: la fuente de verdad es S3."""
    if jobs.backend() == "aws":
        key = media_sync.prefijo_work(db.usuario_actual(), p.id) + "estado.json"
        txt = media_sync.leer_texto(key)
        if txt is None:
            raise HTTPException(404, "No encuentro las imágenes de esta película")
        return json.loads(txt)
    f = p.workdir / "estado.json"
    if not f.is_file():
        raise HTTPException(404, "No encuentro las imágenes de esta película")
    return json.loads(f.read_text(encoding="utf-8"))


def _guardar_estado_produccion(p: Proyecto, d: dict) -> None:
    p.workdir.mkdir(parents=True, exist_ok=True)
    texto = json.dumps(d, ensure_ascii=False, indent=2)
    (p.workdir / "estado.json").write_text(texto, encoding="utf-8")
    if jobs.backend() == "aws":
        media_sync.escribir_texto(
            media_sync.prefijo_work(db.usuario_actual(), p.id) + "estado.json", texto)


class RegenerarImagenIn(BaseModel):
    prompt: str | None = None
    confirmar: bool = False


@app.post("/api/proyectos/{id_}/imagenes/{escena}/regenerar")
async def regenerar_imagen(id_: str, escena: str, body: RegenerarImagenIn):
    """«Otra distinta»: una imagen nueva para esa cadena, con el mismo prompt o
    con el que escribió el usuario. Gate 428 con el costo antes de cobrar, como
    el popup de imágenes del editor."""
    p = _proyecto(id_)
    if p.estado != "imagenes":
        raise HTTPException(409, f"Esta película no está esperando aprobación (estado: {p.estado})")
    costo_cr = creditos.costo_imagen()
    if not body.confirmar:
        raise HTTPException(428, json.dumps({"creditos": costo_cr, "que": "imagen"}))

    d = _estado_produccion(p)
    escenas = [Scene(**e) for e in d.get("escenas", [])]
    i = next((n for n, e in enumerate(escenas) if e.id == escena and e.imagen_fija), None)
    if i is None:
        raise HTTPException(404, "Esa imagen no es de esta película")
    # la ruta guardada es del disco de Fargate: aquí la imagen se escribe en el
    # workdir de esta máquina y de ahí sube a S3
    e = asignar_rutas(escenas[i].model_copy(update={"audio_path": None}), p.workdir)

    if creditos.activo():
        try:
            creditos.cobrar(costo_cr, f"imagen:{p.id}")
        except creditos.SinSaldo as err:
            raise HTTPException(402, str(err))
    try:
        escenas[i] = await media.regenerar_imagen(e, body.prompt)
    except Exception as err:  # noqa: BLE001 — fallo nuestro = créditos de vuelta
        if creditos.activo():
            creditos.devolver(costo_cr, f"imagen:{p.id}")
        raise HTTPException(502, f"No se pudo generar otra imagen: {str(err)[:200]}")

    d["escenas"] = [x.model_dump(mode="json") for x in escenas]
    _guardar_estado_produccion(p, d)
    p.progreso["imagenes"] = resumen_imagenes(escenas)
    p.guardar()
    _sync_workdir(p)
    return p


@app.post("/api/proyectos/{id_}/animar")
async def animar(id_: str):
    """El botón «Animar»: las imágenes están decididas y arranca la segunda
    mitad. No cobra — la película se pagó entera al pulsar Producir."""
    p = _proyecto(id_)
    if p.estado != "imagenes":
        raise HTTPException(409, f"Esta película no está esperando aprobación (estado: {p.estado})")
    # mismo claim atómico que producir: dos clics seguidos lanzan una sola vez
    reclamado = db.backend() == "postgres"
    if reclamado and not db.reclamar_produccion(db.usuario_actual(), p.id, ("imagenes",)):
        raise HTTPException(409, "Esta película ya se está animando")
    try:
        if jobs.backend() == "aws":
            p.estado, p.etapa = "produciendo", "encolado"
            p.guardar()
            jobs.lanzar_produccion(db.usuario_actual(), p.id, "animar")
        else:
            _lanzar(p, flow.producir(p, "animar"))
    except Exception:
        if reclamado:
            db.liberar_produccion(db.usuario_actual(), p.id, "imagenes")
        raise
    return p


@app.post("/api/proyectos/{id_}/cancelar")
def cancelar(id_: str):
    """«Mejor no»: la película vuelve a revisión y se devuelve lo que NO se
    gastó. Se cobró la producción entera por adelantado; de eso solo se quemó
    una imagen por cadena, así que el resto —los créditos de animar, que son
    casi todos— vuelve al monedero. Nadie paga por una película que no existe."""
    p = _proyecto(id_)
    if p.estado != "imagenes":
        raise HTTPException(409, f"Esta película no está esperando aprobación (estado: {p.estado})")
    n = 0
    if creditos.activo():
        gastado = creditos.costo_imagen() * max(1, len(p.progreso.get("imagenes") or []))
        n = max(0, creditos.producir_cobrado(p) - gastado)
        if n:
            creditos.devolver(n, f"cancelar:{p.id}")
    p.estado, p.etapa = "revision", None
    p.progreso = {}
    p.guardar()
    return {"proyecto": p, "devueltos": n}


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


# M19: assets con la VERSIÓN en el nombre — cambiarlos significa publicar otro
# nombre, así que se pueden cachear a lo bruto. Son los dos pesados del orbe (el
# motor y su shader), que viajan por Lambda sin CDN: una semana de caché los
# saca del camino crítico. NO se listan aquí orbe.js ni ningún otro estático:
# esos tienen que revalidar para que un fix de UI llegue con el siguiente deploy.
INMUTABLES = {"orbe-gpu.v1.js", "orbe.v1.wgsl"}


class _StaticCacheado(StaticFiles):
    """Los assets pesados (imágenes de muestra de /estilos/) viajan por Lambda —
    sin Cache-Control el navegador los re-descarga en cada clic de estilo
    (hasta ~370 KB por imagen). Un día de caché basta: solo cambian con deploy
    y el ETag de StaticFiles revalida al vencer. El HTML/JS queda como estaba
    (revalidación por ETag en cada carga — así los fixes de UI llegan solos),
    salvo los versionados de INMUTABLES.

    El filtro de imágenes va por media_type y el de INMUTABLES por NOMBRE: todo
    el JS del repo comparte media_type, así que ahí no se puede distinguir."""

    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        if str(getattr(resp, "media_type", "")).startswith("image/"):
            resp.headers["Cache-Control"] = "public, max-age=86400"
        elif args and Path(str(args[0])).name in INMUTABLES:
            resp.headers["Cache-Control"] = "public, max-age=604800, immutable"
        return resp


# M23 · crear y editar imágenes son UNA página. Las dos viejas se quitaron;
# quien las tenga guardadas llega a la nueva (el editor, ya en modo editar).
# 302 y no 301: un 301 se queda en la caché del navegador para siempre.
@app.get("/crear-imagenes.html", include_in_schema=False)
def _crear_imagenes_viejo():
    return RedirectResponse("/imagenes.html", status_code=302)


@app.get("/editor-imagenes.html", include_in_schema=False)
def _editor_imagenes_viejo():
    return RedirectResponse("/imagenes.html?editar=1", status_code=302)


app.mount("/", _StaticCacheado(directory=ROOT / "static", html=True), name="static")
