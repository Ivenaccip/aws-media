"""API del popup g1/g2, subtítulos (b1) y costes — bajo /editor/{name}/api/…
(PLAN-FUSION.md F2.3-F2.5).

Gate de gasto del lado del servidor: los endpoints que cuestan dinero exigen
{"confirmar": true} en el body — la UI muestra el precio (GET …/precios) y el
clic en Generar ES la confirmación. Nada se genera sin ese campo.
"""
from __future__ import annotations

import asyncio
import logging
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from langfuse import get_client, propagate_attributes
from pydantic import BaseModel

from pipeline import db, jobs, media_fal, media_google, media_sync, overlays, storage
from pipeline.config import settings
from pipeline.pricing import estimar_regeneracion


class ImagenIn(BaseModel):
    confirmar: bool = False
    prompt: str


class VideoIn(BaseModel):
    confirmar: bool = False
    imagen: str
    prompt_movimiento: str | None = None


class ActivarIn(BaseModel):
    n: int

log = logging.getLogger("overlays_api")
ROOT = Path(__file__).resolve().parent.parent
router = APIRouter(prefix="/editor")

_ocupado: dict[str, str] = {}          # project → operación en curso (una a la vez)
_subs: dict[str, dict] = {}            # project → {running, ok, log}
N_IMAGENES = 2


def _proyecto(name: str) -> Path:
    try:
        p = storage.ruta_proyecto(name)
    except ValueError as err:
        raise HTTPException(422, str(err))
    if not p.is_dir():
        raise HTTPException(404, f"proyecto {name} no existe")
    return p


def _overlay(project: Path, oid: str) -> tuple[dict, dict]:
    data = overlays.cargar(project)
    try:
        return data, overlays.obtener(data, oid)
    except KeyError as err:
        raise HTTPException(404, str(err))


def _marcar(name: str, operacion: str) -> None:
    if name in _ocupado:
        raise HTTPException(409, f"operación en curso: {_ocupado[name]}")
    _ocupado[name] = operacion


class MuestraIn(BaseModel):
    frame: float = 10.0


@router.get("/{name}/api/overlays")
def ver_overlays(name: str):
    p = _proyecto(name)
    data = overlays.cargar(p)
    return {**data, "costo_overlays": overlays.costo_total(data),
            "backend": settings.gen_backend}


@router.get("/{name}/api/overlays/{oid}/precios")
def precios(name: str, oid: str):
    p = _proyecto(name)
    _, ov = _overlay(p, oid)
    return estimar_regeneracion(overlays.duracion_clip(ov), n_imagenes=N_IMAGENES,
                                backend=settings.gen_backend)


def _referencia_overlay(p: Path, ov: dict) -> Path:
    """Ancla visual para Nano Banana: la imagen base de la versión activa si existe;
    si no, un frame del clip activo (mantiene personaje y estilo)."""
    act = overlays.version_activa(ov)
    if act.get("imagen_base"):
        return p / "work" / act["imagen_base"]
    destino = overlays.dir_overlay(p, ov["id"]) / "ref_frame.jpg"
    if not destino.exists():
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "0.5",
                        "-i", str(p / "work" / act["video"]), "-frames:v", "1",
                        "-q:v", "2", str(destino)], check=True)
    return destino


@router.post("/{name}/api/overlays/{oid}/imagen")
def generar_imagenes(name: str, oid: str, body: ImagenIn):
    """g2 paso 1: opciones de imagen base nueva con el prompt editado (Nano Banana).
    def (threadpool): la generación bloquea y no debe congelar el event loop."""
    p = _proyecto(name)
    _, ov = _overlay(p, oid)
    if body.confirmar is not True:
        raise HTTPException(428, "Falta confirmar:true — el gate de gasto es obligatorio")
    prompt = body.prompt.strip()
    if not prompt:
        raise HTTPException(422, "prompt vacío")
    _marcar(name, f"imagen {oid}")
    cand_dir = overlays.dir_overlay(p, oid) / "candidatos"
    cand_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%H%M%S")
    rutas = []
    try:
        data = overlays.cargar(p)
        completo = f"{prompt}, {data['estilo_prompt']}" if data.get("estilo_prompt") else prompt
        ref = _referencia_overlay(p, ov)
        with propagate_attributes(session_id=f"editor-{name}", tags=["fusion", "g2"]):
            with get_client().start_as_current_observation(
                    name="g2_imagenes", as_type="span", input={"overlay": oid, "prompt": prompt[:300]}):
                if settings.gen_backend == "google":
                    for k, img in enumerate(media_google.generar_imagenes(completo, [ref], n=N_IMAGENES)):
                        f = cand_dir / f"{stamp}-{k}.jpg"
                        f.write_bytes(img)
                        rutas.append(f"overlays/{oid}/candidatos/{f.name}")
                else:
                    # fal (default): nano banana edit con la misma ancla visual.
                    # asyncio.run es válido aquí: endpoint def → threadpool sin loop.
                    for k in range(N_IMAGENES):
                        f = cand_dir / f"{stamp}-{k}.jpg"
                        asyncio.run(media_fal.imagen_nano(completo, f, referencia=ref,
                                                          meta={"overlay": oid, "candidato": k}))
                        rutas.append(f"overlays/{oid}/candidatos/{f.name}")
    except Exception as err:  # noqa: BLE001
        raise HTTPException(502, f"Nano Banana falló: {str(err)[:300]}")
    finally:
        _ocupado.pop(name, None)
        get_client().flush()
    costo = estimar_regeneracion(0, n_imagenes=len(rutas), backend=settings.gen_backend)["imagen"]
    overlays.registrar_gasto(p, "imagenes", oid, costo)
    return {"candidatos": rutas, "prompt": prompt, "costo_imagenes": costo}


@router.post("/{name}/api/overlays/{oid}/video")
def regenerar_video(name: str, oid: str, body: VideoIn):
    """g2 paso 2: Veo anima la imagen elegida → mux con el audio original →
    versión nueva activa → película rearmada. def (threadpool): Veo tarda minutos."""
    p = _proyecto(name)
    _, ov = _overlay(p, oid)
    if body.confirmar is not True:
        raise HTTPException(428, "Falta confirmar:true — el gate de gasto es obligatorio")
    imagen = (p / "work" / body.imagen).resolve()
    if (p / "work").resolve() not in imagen.parents or not imagen.is_file():
        raise HTTPException(422, f"imagen no válida: {body.imagen}")
    prompt = (body.prompt_movimiento or ov.get("prompt_movimiento") or ov["narracion"]).strip()
    dur = overlays.duracion_clip(ov)
    est = estimar_regeneracion(dur, n_imagenes=0, backend=settings.gen_backend)
    _marcar(name, f"video {oid}")
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False,
                                         dir=overlays.dir_overlay(p, oid)) as tmp:
            crudo = Path(tmp.name)
        with propagate_attributes(session_id=f"editor-{name}", tags=["fusion", "g2"]):
            with get_client().start_as_current_observation(
                    name="g2_video", as_type="span", input={"overlay": oid, "imagen": body.imagen}):
                if settings.gen_backend == "google":
                    crudo.write_bytes(media_google.generar_video(
                        imagen, prompt, est["veo_segundos"], negativo=ov.get("veo_negativo", "")))
                else:
                    # fal (default): veo3.1 lite 720p sin audio (el audio original manda)
                    asyncio.run(media_fal.video_veo(imagen, prompt, est["veo_segundos"], crudo,
                                                    negativo=ov.get("veo_negativo", ""),
                                                    meta={"overlay": oid}))
        mux = crudo.with_suffix(".mux.mp4")
        overlays.mux_reemplazo(crudo, overlays.dir_overlay(p, oid) / "audio.mp3", mux, dur)
        crudo.unlink()
        version = overlays.agregar_version(p, oid, mux, imagen, est["video"])
        overlays.registrar_gasto(p, "video", oid, est["video"])
        dur_total = overlays.rearmar_pelicula(p)
    except HTTPException:
        raise
    except Exception as err:  # noqa: BLE001
        log.exception("regeneración %s/%s falló", name, oid)
        raise HTTPException(502, f"regeneración falló: {str(err)[:300]}")
    finally:
        _ocupado.pop(name, None)
        get_client().flush()
    return {"version": version, "duracion_pelicula": dur_total, "costo_video": est["video"]}


@router.post("/{name}/api/overlays/{oid}/activar")
def activar(name: str, oid: str, body: ActivarIn):
    p = _proyecto(name)
    n = body.n
    _marcar(name, f"activar {oid}")
    try:
        ov = overlays.activar_version(p, oid, n)
        dur = overlays.rearmar_pelicula(p)
    except KeyError as err:
        raise HTTPException(404, str(err))
    finally:
        _ocupado.pop(name, None)
    return {"overlay": ov, "duracion_pelicula": dur}


@router.get("/{name}/api/costes")
def costes(name: str):
    p = _proyecto(name)
    data = overlays.cargar(p)
    return {"overlays": overlays.costo_total(data),
            "nota": "regeneraciones de este proyecto; el coste de la producción original vive en Langfuse"}


@router.get("/{name}/archivo/{ruta:path}")
def archivo(name: str, ruta: str):
    from server.editor import _cdn, _nube, _proyecto_nube
    if _nube():
        # los artefactos viven en S3 — CloudFront los sirve tras un 302
        _proyecto_nube(name)
        if Path(ruta).suffix.lower() not in (".jpg", ".png", ".mp4", ".srt", ".ass") \
                or ".." in ruta:
            raise HTTPException(404, "no encontrado")
        from fastapi.responses import RedirectResponse
        return RedirectResponse(_cdn(f"videos/{name}/work/{ruta}"))
    p = _proyecto(name)
    f = (p / "work" / ruta).resolve()
    if (p / "work").resolve() not in f.parents:
        raise HTTPException(404, "no encontrado")
    if not f.is_file() or f.suffix.lower() not in (".jpg", ".png", ".mp4", ".srt", ".ass"):
        raise HTTPException(404, "no encontrado")
    return FileResponse(f)


# ---------- b1: subtítulos ----------

def _subs_muestra_nube(name: str, frame: float) -> dict:
    """M16.1: la muestra (1 frame) sí cabe en la Lambda contenedor — baja lo
    mínimo de S3 al FS efímero, corre make_subs --frame y sube el PNG (la UI lo
    pide por /archivo/…, que en nube redirige al CDN)."""
    import tempfile
    base_dir = Path(tempfile.mkdtemp(prefix="subs-")) / name
    for rel in ("pelicula.mp4", "work/edited-transcript.json"):
        if not media_sync.bajar_archivo(f"videos/{name}/{rel}", base_dir / rel):
            raise HTTPException(404, f"{name}: falta {rel} en S3 — el puente del generador no lo dejó listo")
    r = subprocess.run([sys.executable, str(ROOT / "tools" / "make_subs.py"),
                        str(base_dir), "--base", str(base_dir / "pelicula.mp4"),
                        "--frame", str(frame)],
                       capture_output=True, text=True, cwd=str(ROOT))
    if r.returncode != 0:
        raise HTTPException(502, f"make_subs falló: {(r.stdout + r.stderr)[-300:]}")
    for f in (base_dir / "work" / "subs").iterdir():
        media_sync.subir_archivo(f, f"videos/{name}/work/subs/{f.name}")
    return {"muestra": f"subs/muestra-{frame}s.png"}


@router.post("/{name}/api/subtitulos/muestra")
def subs_muestra(name: str, body: MuestraIn):
    from server.editor import _nube, _proyecto_nube
    frame = body.frame
    if _nube():
        _proyecto_nube(name)
        return _subs_muestra_nube(name, frame)
    p = _proyecto(name)
    r = subprocess.run([sys.executable, str(ROOT / "tools" / "make_subs.py"),
                        str(p), "--base", str(p / "pelicula.mp4"),
                        "--frame", str(frame)],
                       capture_output=True, text=True, cwd=str(ROOT))
    if r.returncode != 0:
        raise HTTPException(502, f"make_subs falló: {(r.stdout + r.stderr)[-300:]}")
    return {"muestra": f"subs/muestra-{frame}s.png"}


def _quemar(name: str, p: Path) -> None:
    st = _subs[name]
    proc = subprocess.Popen([sys.executable, str(ROOT / "tools" / "make_subs.py"),
                             str(p), "--base", str(p / "pelicula.mp4"), "--mode", "final"],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=str(ROOT))
    for line in proc.stdout:
        st["log"] += line
    proc.wait()
    st.update(running=False, ok=proc.returncode == 0)


def _subs_quemar_nube(name: str) -> dict:
    """M16.1: el quemado re-encodea el video completo — a Fargate por la state
    machine de siempre; el estado viaja por proyectos_editor.doc.subtitulos."""
    import json as _json
    from datetime import datetime, timezone

    from server.editor import _proyecto_nube, _render_caducado
    user = db.usuario_actual()
    doc = _proyecto_nube(name)
    s = doc.get("subtitulos") or {}
    if s.get("estado") == "corriendo" and not _render_caducado(s):
        raise HTTPException(409, "quemado en curso")
    db.fijar_subtitulos_editor(user, name, _json.dumps(
        {"estado": "corriendo",
         "inicio": datetime.now(timezone.utc).isoformat(timespec="seconds")}))
    try:
        jobs.lanzar_subtitulos(user, name)
    except Exception as err:  # noqa: BLE001 — sin SFN a mano, no puede quedar "corriendo"
        db.fijar_subtitulos_editor(user, name, _json.dumps(
            {"estado": "error", "log": f"no se pudo lanzar el job: {err}"[:400]}))
        raise HTTPException(502, f"No se pudo lanzar el quemado: {str(err)[:200]}")
    return {"started": True}


@router.post("/{name}/api/subtitulos/quemar")
def subs_quemar(name: str):
    from server.editor import _nube
    if _nube():
        return _subs_quemar_nube(name)
    p = _proyecto(name)
    st = _subs.setdefault(name, {"running": False, "log": "", "ok": None})
    if st["running"]:
        raise HTTPException(409, "quemado en curso")
    st.update(running=True, log="", ok=None)
    threading.Thread(target=_quemar, args=(name, p), daemon=True).start()
    return {"started": True}


def _parsear_srt(crudo: str) -> list[dict]:
    segmentos, bloque = [], {}
    for linea in crudo.splitlines() + [""]:
        linea = linea.strip()
        if "-->" in linea:
            a, _, b = linea.partition("-->")
            bloque = {"start": _srt_s(a), "end": _srt_s(b), "text": ""}
        elif linea and bloque:
            bloque["text"] = (bloque["text"] + " " + linea).strip()
        elif not linea and bloque:
            segmentos.append(bloque)
            bloque = {}
    return segmentos


@router.get("/{name}/api/subtitulos/estado")
def subs_estado(name: str):
    from server.editor import _nube, _proyecto_nube, _render_caducado
    if _nube():
        s = _proyecto_nube(name).get("subtitulos") or {}
        estado = s.get("estado")
        crudo = media_sync.leer_texto(f"videos/{name}/work/subs/subs.srt")
        return {"running": estado == "corriendo" and not _render_caducado(s),
                "log": s.get("log", ""),
                "ok": True if estado == "listo" else False if estado == "error" else None,
                "url": s.get("url"),
                "segmentos": _parsear_srt(crudo) if crudo else []}
    p = _proyecto(name)
    srt = p / "work" / "subs" / "subs.srt"
    segmentos = _parsear_srt(srt.read_text(encoding="utf-8")) if srt.is_file() else []
    return {**_subs.get(name, {"running": False, "log": "", "ok": None}), "segmentos": segmentos}


def _srt_s(t: str) -> float:
    t = t.strip().replace(",", ".")
    h, m, s = t.split(":")
    return round(int(h) * 3600 + int(m) * 60 + float(s), 3)
