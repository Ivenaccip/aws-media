"""b3 — publicar (PLAN-FUSION.md F3.2): fn1 descargar · fn2 Blotato API.

fn2 usa la clave de Blotato del usuario (M23 C: la conecta desde el inicio; en
local cae al .env). M23 C2: funciona igual en local y en el servicio.

    GET  api/publicar/estado          descargas, publicaciones y reglas por red
                                      (no llama a Blotato: nunca tumba la descarga)
    GET  api/publicar/cuentas         las redes conectadas en Blotato
    GET  api/publicar/destinos        páginas (Facebook, LinkedIn) o tableros (Pinterest)
    POST api/publicar/titulos         3 títulos desde el transcript (gratis)
    POST api/publicar/agendar         crea la publicación y la encola (202)
    GET  api/publicar/publicaciones   cómo va cada una (pregunta a Blotato por
                                      las que siguen en camino)

Gate duro: nada se publica sin confirmar:true. La subida y el post los hace
worker/publicar_task.py: en el servicio, el worker SQS (la Lambda de la API
corta a los 29 s); en local, una tarea en segundo plano de este proceso.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from pipeline import blotato, claves_usuario, jobs, publicaciones
from pipeline.config import load_prompt
from pipeline.db import usuario_actual
from pipeline.llm import chat_json
from pipeline.storage import leer_json, ruta_proyecto

log = logging.getLogger("publicar_api")
ROOT = Path(__file__).resolve().parent.parent
router = APIRouter(prefix="/editor")

TITULOS_TIMEOUT_S = 20          # la Lambda de la API corta a los 29 s
TITULOS_MAX_CHARS = 2500
TITULO_MAX = 100
HORIZONTE_S = 270 * 86400       # Blotato programa hasta 9 meses adelante
ERROR_ALMACEN = "No pudimos leer tu conexión con Blotato. Intenta de nuevo en un momento."


class TitulosIn(BaseModel):
    plataformas: list[str] = []


class AgendarIn(BaseModel):
    confirmar: bool = False
    cuenta_id: str = Field("", max_length=128)
    cuenta_nombre: str = Field("", max_length=300)
    plataforma: str = Field("", max_length=32)
    archivo: str = Field("", max_length=300)          # clave de descargables()
    texto: str = Field("", max_length=20000)
    titulo: str | None = Field(None, max_length=1000)
    privacidad: str | None = Field(None, max_length=64)
    destino: str | None = Field(None, max_length=128)
    cuando: str | None = Field(None, max_length=64)   # ISO 8601 con zona; None = ya
    ia: bool = True
    notificar: bool = True
    para_ninos: bool = False
    comentarios: bool = True
    duo: bool = True
    stitch: bool = True
    marca_propia: bool = False
    marca_pagada: bool = False


OPCIONES = ("titulo", "privacidad", "destino", "ia", "notificar", "para_ninos",
            "comentarios", "duo", "stitch", "marca_propia", "marca_pagada")


def _proyecto(name: str) -> Path:
    try:
        p = ruta_proyecto(name)
    except ValueError as err:
        raise HTTPException(422, str(err))
    if not p.is_dir():
        raise HTTPException(404, f"proyecto {name} no existe")
    return p


def _nube() -> bool:
    from server.editor import _nube as n
    return n()


def _validar_proyecto(name: str) -> None:
    """Nombre válido y proyecto de este usuario (en el servicio, su fila)."""
    if _nube():
        from server.editor import _proyecto_nube
        _proyecto_nube(name)
    else:
        _proyecto(name)


def _usuario() -> str:
    user = usuario_actual()
    if not claves_usuario.id_valido(user):
        raise HTTPException(400, "No pudimos identificar tu cuenta. Vuelve a iniciar sesión.")
    return user


def descargables_nube(name: str) -> dict[str, tuple[str, int]]:
    """Lo mismo que `descargables`, contra S3: clave estable → (key, bytes).

    En el servicio el proyecto NO está en el disco de la Lambda, así que la
    versión de abajo devolvía 404 «proyecto no existe» y el modal de Publicar
    no enseñaba nada: la película estaba hecha y no había forma de bajarla.
    Es la mitad grande de lo que los testers llamaron «no hay botón de
    descargar» (M22 · D).

    Las claves espejan las locales, incluido que `output/` NO se recorre hacia
    dentro: los shorts tienen su propia página y su propio botón.
    """
    from pipeline import media_sync
    pre = f"videos/{name}/"
    out: dict[str, tuple[str, int]] = {}
    for key, tam in media_sync.listar_prefijo_con_bytes(pre):
        rel = key[len(pre):]
        if rel == "pelicula.mp4":
            out["pelicula"] = (key, tam)
        elif rel == "pelicula-subtitulado.mp4":
            out["subtitulado"] = (key, tam)
        elif rel.startswith("output/") and rel.endswith(".mp4") and rel.count("/") == 1:
            out[rel[len("output/"):-len(".mp4")]] = (key, tam)
        elif rel == "work/subs/subs.srt":
            out["srt"] = (key, tam)
    return out


def descargables(p: Path) -> dict[str, Path]:
    """Qué se puede descargar/publicar de un proyecto, por clave estable."""
    out: dict[str, Path] = {}
    if (p / "pelicula.mp4").is_file():
        out["pelicula"] = p / "pelicula.mp4"
    if (p / "pelicula-subtitulado.mp4").is_file():   # make_subs escribe junto al base
        out["subtitulado"] = p / "pelicula-subtitulado.mp4"
    for f in sorted((p / "output").glob("*.mp4")) if (p / "output").is_dir() else []:
        out[f.stem] = f
    if (p / "work" / "subs" / "subs.srt").is_file():
        out["srt"] = p / "work" / "subs" / "subs.srt"
    return out


def _archivos(name: str) -> dict[str, tuple[str, int, str | None]]:
    """clave → (nombre, bytes, key de S3 o None en local)."""
    if _nube():
        return {k: (key.rsplit("/", 1)[-1], tam, key)
                for k, (key, tam) in descargables_nube(name).items()}
    return {k: (f.name, f.stat().st_size, None)
            for k, f in descargables(_proyecto(name)).items()}


def _vistas(user: str, name: str) -> list[dict]:
    try:
        return [publicaciones.vista(r) for r, _ in publicaciones.listar(user, name)]
    except Exception as err:  # noqa: BLE001 — el modal se abre igual
        log.error("listar publicaciones de %s: %s", name, type(err).__name__)
        return []


@router.get("/{name}/api/publicar/estado")
def estado(name: str):
    _validar_proyecto(name)
    user = usuario_actual()
    archivos = [{"clave": k, "nombre": nombre, "mb": round(tam / 1e6, 1)}
                for k, (nombre, tam, _) in _archivos(name).items()]
    clave, error = None, None
    try:
        clave = blotato.clave_de(user)
    except (claves_usuario.ErrorAlmacen, ValueError):
        error = ERROR_ALMACEN
    # sin llamar a Blotato: las redes las pide la pantalla aparte (/cuentas),
    # para que un Blotato lento no se lleve la descarga por delante
    return {"descargables": archivos, "blotato": bool(clave), "error": error,
            "agendar": True, "publicaciones": _vistas(user, name),
            "redes": blotato.REDES}


@router.get("/{name}/api/publicar/cuentas")
def cuentas(name: str):
    from server.blotato_api import _limpias
    _validar_proyecto(name)
    try:
        clave = blotato.clave_de(usuario_actual())
    except (claves_usuario.ErrorAlmacen, ValueError):
        return {"conectado": False, "cuentas": [], "error": ERROR_ALMACEN, "reconectar": False}
    if not clave:
        return {"conectado": False, "cuentas": [], "error": None, "reconectar": False}
    try:
        lista = blotato.cuentas(clave, timeout=blotato.TIMEOUT_CORTO)
    except Exception as err:  # noqa: BLE001 — el modal no se cae por Blotato
        error, reconectar = blotato.explicar_fallo(err)
        return {"conectado": True, "cuentas": [], "error": error, "reconectar": reconectar}
    return {"conectado": True, "cuentas": _limpias(lista), "error": None, "reconectar": False}


def _clave_o_error(user: str) -> str:
    try:
        clave = blotato.clave_de(user)
    except claves_usuario.ErrorAlmacen:
        raise HTTPException(503, ERROR_ALMACEN)
    if not clave:
        raise HTTPException(409, "Conecta tu cuenta de Blotato primero: es el «+» "
                                 "junto a Blotato, en el menú del inicio.")
    return clave


@router.get("/{name}/api/publicar/destinos")
def destinos(name: str, cuenta_id: str = "", plataforma: str = ""):
    _validar_proyecto(name)
    red = blotato.REDES.get(plataforma)
    if not red or not red["destino"]:
        raise HTTPException(422, "Esa red no necesita elegir página ni tablero.")
    if not blotato.id_valido(cuenta_id):
        raise HTTPException(422, "Cuenta de Blotato inválida. Vuelve a abrir Publicar.")
    clave = _clave_o_error(_usuario())
    try:
        if red["destino"] == "tablero":
            lista = blotato.tableros(clave, cuenta_id)
        else:
            lista = blotato.subcuentas(clave, cuenta_id)
    except Exception as err:  # noqa: BLE001
        return {"destinos": [], "error": blotato.explicar_fallo(err, clave)[0]}
    return {"destinos": lista, "error": None}


@router.get("/{name}/descarga/{clave}")
def descargar(name: str, clave: str):
    if _nube():
        from fastapi.responses import RedirectResponse

        from server.editor import _proyecto_nube
        from server.media_api import url_firmada_descarga
        _proyecto_nube(name)
        par = descargables_nube(name).get(clave)
        if not par:
            raise HTTPException(404, f"no hay descargable {clave!r}")
        key = par[0]
        return RedirectResponse(
            url_firmada_descarga(key, f"{name}-{key.rsplit('/', 1)[-1]}"))
    p = _proyecto(name)
    f = descargables(p).get(clave)
    if not f:
        raise HTTPException(404, f"no hay descargable {clave!r}")
    return FileResponse(f, filename=f"{name}-{f.name}",
                        media_type="video/mp4" if f.suffix == ".mp4" else "text/plain")


# --- títulos -------------------------------------------------------------------

def _palabras(doc) -> str:
    if not isinstance(doc, dict):
        return ""
    return " ".join(str(w.get("text", "")) for w in doc.get("words") or []
                    if isinstance(w, dict)).strip()


def _texto_nube(name: str) -> str:
    """El transcript editado; si el video aún no se renderizó, el canónico."""
    from pipeline import media_sync
    from server.editor import _leer_json_s3

    def leer(key: str):
        try:
            return _leer_json_s3(key)
        except ValueError:
            return None

    base = f"videos/{name}/work/"
    texto = _palabras(leer(base + "edited-transcript.json"))
    if texto:
        return texto
    for key in sorted(media_sync.listar_prefijo(base + "transcripts/")):
        if key.endswith(".canonical.json") and "/" not in key[len(base + "transcripts/"):]:
            texto = _palabras(leer(key))
            if texto:
                return texto
    return ""


def _texto_local(p: Path) -> str:
    texto = _palabras(leer_json(p / "work" / "edited-transcript.json", default=None))
    if texto:
        return texto
    carpeta = p / "work" / "transcripts"
    for f in sorted(carpeta.glob("*.canonical.json")) if carpeta.is_dir() else []:
        texto = _palabras(leer_json(f, default=None))
        if texto:
            return texto
    return ""


def limpiar_titulo(t: str) -> str:
    return " ".join(re.sub(r"[<>]", "", t).split())[:TITULO_MAX].rstrip()


@router.post("/{name}/api/publicar/titulos")
async def titulos(name: str, body: TitulosIn):
    """3 títulos sugeridos desde el transcript. Gratis para el usuario (decisión
    del 16-sep): es un modelo pequeño y el texto se corta en 2500 caracteres."""
    _validar_proyecto(name)
    texto = _texto_nube(name) if _nube() else _texto_local(_proyecto(name))
    if not texto:
        raise HTTPException(409, "Este video todavía no tiene transcript. Termina el "
                                 "corte o el render y vuelve a intentarlo.")
    redes = [blotato.REDES[p]["nombre"] for p in body.plataformas if p in blotato.REDES]
    from langfuse import get_client, propagate_attributes
    try:
        with propagate_attributes(user_id=usuario_actual(), session_id=f"editor-{name}",
                                  tags=["publicar", "titulos"]):
            r = await asyncio.wait_for(
                chat_json("titulos_publicar", load_prompt("titulos_system"),
                          f"Plataformas: {', '.join(redes) or 'generales'}\n\n"
                          f"Guion:\n{texto[:TITULOS_MAX_CHARS]}"),
                TITULOS_TIMEOUT_S)
    except asyncio.TimeoutError:
        raise HTTPException(504, "Los títulos tardaron demasiado. Intenta de nuevo.")
    except Exception as err:  # noqa: BLE001
        log.error("titulos %s: %s", name, type(err).__name__)
        raise HTTPException(502, "No pudimos sugerir títulos. Intenta de nuevo.")
    finally:
        try:
            get_client().flush()
        except Exception:  # noqa: BLE001
            pass
    lista = [limpiar_titulo(t) for t in (r.get("titulos") or []) if isinstance(t, str)]
    lista = [t for t in lista if t][:3]
    if not lista:
        raise HTTPException(502, "No pudimos sugerir títulos. Intenta de nuevo.")
    return {"titulos": lista}


# --- agendar ---------------------------------------------------------------------

def _cuando(valor: str | None) -> str | None:
    if not valor:
        return None
    try:
        dt = datetime.fromisoformat(valor.strip().replace("Z", "+00:00"))
    except ValueError:
        dt = None
    if dt is None or dt.tzinfo is None:
        raise HTTPException(422, "No entendimos la fecha. Elígela de nuevo.")
    t, ahora = dt.timestamp(), time.time()
    if t < ahora + 60:
        raise HTTPException(422, "Esa hora ya pasó o falta menos de un minuto. Elige una "
                                 "más adelante o usa «Publicar ahora».")
    if t > ahora + HORIZONTE_S:
        raise HTTPException(422, "Blotato programa hasta 9 meses adelante. "
                                 "Elige una fecha más cercana.")
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds")


def _publicar_local(user: str, name: str, pub_id: str) -> None:
    from worker.publicar_task import ejecutar, video_local

    def video_de(reg: dict):
        f = descargables(ruta_proyecto(name)).get(reg.get("archivo"))
        if not f or f.suffix != ".mp4":
            raise ValueError("No encontramos el video de esta publicación.")
        return video_local(f)

    ejecutar(user, name, pub_id, video_de)


@router.post("/{name}/api/publicar/agendar", status_code=202)
def agendar(name: str, body: AgendarIn, tareas: BackgroundTasks):
    """Valida, deja la publicación en `pendiente` y la encola. La subida y el
    post los hace worker/publicar_task.py."""
    _validar_proyecto(name)
    if body.confirmar is not True:
        raise HTTPException(428, "Falta confirmar:true — el gate de publicación es obligatorio")
    user = _usuario()
    _clave_o_error(user)

    red = blotato.REDES.get(body.plataforma)
    if red is None:
        raise HTTPException(422, "Esa red no se puede usar desde aquí todavía.")
    if not blotato.id_valido(body.cuenta_id):
        raise HTTPException(422, "Elige la cuenta donde se publica.")

    par = _archivos(name).get(body.archivo)
    if not par or not par[0].endswith(".mp4"):
        raise HTTPException(422, "Elige un video para publicar.")
    nombre, tam, key = par
    mb = tam / 1e6
    if tam > blotato.MAX_BYTES:
        raise HTTPException(422, f"El video pesa {mb:.0f} MB y Blotato acepta hasta "
                                 f"{blotato.MAX_BYTES // 1_000_000} MB.")
    if red["mb"] and mb > red["mb"]:
        raise HTTPException(422, f"{red['nombre']} acepta videos de hasta {red['mb']} MB "
                                 f"y este pesa {mb:.0f} MB.")

    opciones = {k: getattr(body, k) for k in OPCIONES}
    try:
        target = blotato.target_de(body.plataforma, opciones)
    except ValueError as err:
        raise HTTPException(422, str(err))
    texto = body.texto.strip() or target.get("title", "")
    if not texto:
        raise HTTPException(422, "Escribe el texto de la publicación.")
    if len(texto) > red["texto"]:
        raise HTTPException(422, f"{red['nombre']} acepta hasta {red['texto']} caracteres "
                                 f"y el texto tiene {len(texto)}.")
    cuando = _cuando(body.cuando)

    try:
        filas = publicaciones.listar(user, name)
    except Exception as err:  # noqa: BLE001
        log.error("listar publicaciones de %s: %s", name, type(err).__name__)
        raise HTTPException(503, "No pudimos revisar tus publicaciones. Intenta de nuevo.")
    for reg, _ in filas:
        if (reg.get("archivo"), reg.get("cuenta_id"), reg.get("plataforma")) == (
                body.archivo, body.cuenta_id, body.plataforma) \
                and publicaciones.vista(reg)["en_curso"]:
            raise HTTPException(409, "Esa publicación ya se está enviando. "
                                     "Espera a que termine.")

    datos = {"plataforma": body.plataforma, "cuenta_id": body.cuenta_id,
             "cuenta_nombre": " ".join(body.cuenta_nombre.split())[:80],
             "archivo": body.archivo, "archivo_nombre": nombre, "bytes": tam,
             "texto": texto, "titulo": target.get("title"), "cuando": cuando,
             "opciones": opciones}
    if key:
        datos["archivo_key"] = key
    try:
        reg = publicaciones.crear(user, name, datos)
    except Exception as err:  # noqa: BLE001
        log.error("crear publicación en %s: %s", name, type(err).__name__)
        raise HTTPException(503, "No pudimos guardar la publicación. Intenta de nuevo.")

    if _nube():
        try:
            jobs.encolar_publicar(user, name, reg["id"])
        except Exception as err:  # noqa: BLE001
            log.error("encolar publicar %s: %s", name, type(err).__name__)
            reg.update(estado="error",
                       error="No pudimos poner la publicación en la fila. Intenta de nuevo.")
            try:
                publicaciones.guardar(user, name, reg)
            except Exception as err2:  # noqa: BLE001
                log.error("marcar error en %s: %s", reg["id"], type(err2).__name__)
            raise HTTPException(502, "No pudimos poner la publicación en la fila. "
                                     "Intenta de nuevo.")
    else:
        tareas.add_task(_publicar_local, user, name, reg["id"])
    return {"publicacion": publicaciones.vista(reg)}


@router.get("/{name}/api/publicar/publicaciones")
def lista(name: str):
    _validar_proyecto(name)
    user = _usuario()
    try:
        filas = publicaciones.listar(user, name)
    except Exception as err:  # noqa: BLE001
        log.error("listar publicaciones de %s: %s", name, type(err).__name__)
        raise HTTPException(503, "No pudimos leer tus publicaciones. Intenta de nuevo.")
    t = publicaciones.ahora()
    if any(publicaciones.por_consultar(r, t) for r, _ in filas):
        try:
            clave = blotato.clave_de(user)
        except (claves_usuario.ErrorAlmacen, ValueError):
            clave = None
        if clave:
            publicaciones.refrescar(user, name, clave, filas)
    return {"publicaciones": [publicaciones.vista(r) for r, _ in filas]}

