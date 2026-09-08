"""Cut-editor como router FastAPI — port 1:1 de tools/editor/server.py (stdlib),
ahora multi-proyecto bajo /editor/{project}/ (PLAN-FUSION.md F1.2).

La UI (tools/editor/index.html) usa URLs relativas, así que funciona igual servida
por el server stdlib original en "/" que aquí bajo /editor/{project}/. El estado
(render en curso, agente de chat) es por proyecto y en memoria — un solo worker,
misma limitación conocida que el resto del server (PLAN-FUSION.md F4).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response, StreamingResponse

from pipeline import db, jobs, media_sync
from pipeline.storage import ruta_proyecto, videos_root

ROOT = Path(__file__).resolve().parent.parent
EDITOR_DIR = ROOT / "tools" / "editor"

sys.path.insert(0, str(ROOT / "tools" / "editor"))
sys.path.insert(0, str(ROOT / "tools"))
try:
    from chat_agent import ChatAgent
    CHAT_IMPORT_ERR = None
except ImportError as e:  # claude-agent-sdk es opcional
    ChatAgent = None
    CHAT_IMPORT_ERR = f"chat deshabilitado: {e} — pip install claude-agent-sdk"
try:
    from check_claude_login import credential_status
except ImportError:
    credential_status = None

router = APIRouter(prefix="/editor")

_render: dict[str, dict] = {}     # project → {running, log, ok}
_chat: dict[str, object] = {}     # project → ChatAgent
_chat_lock = threading.Lock()
_login_seen_missing: dict[str, bool] = {}

MEDIA = {"proxy.mp4": "video/mp4", "waveform.png": "image/png"}


def _proyecto(name: str) -> Path:
    try:
        p = ruta_proyecto(name)
    except ValueError as err:
        raise HTTPException(422, str(err))
    if not (p / "work" / "analysis" / "cuts.json").is_file():
        raise HTTPException(404, f"{name}: sin work/analysis/cuts.json — corre /clean-cut o el puente del generador")
    return p


# ---------------------------------------------------------------------------
# M7 — modo nube: los artefactos viven en S3 (los subió el puente de C4), el
# corte versionado en Postgres y el render corre como job en Fargate. El chat
# editorial NO viaja: sigue siendo exclusivo de quien corre Claude Code local.

# M16.4: el chat editorial en nube es un CONSEJERO con la API de Claude — no
# edita cuts.json (eso sigue siendo del chat local con claude-agent-sdk)
CHAT_NUBE_NOTA = ("Consejero editorial: te digo QUÉ cortar y con qué botón — "
                  "los cambios los aplicas tú en el timeline.")


def _nube() -> bool:
    return db.backend() == "postgres"


def _proyecto_nube(name: str) -> dict:
    """Valida nombre y pertenencia (el proyecto debe estar registrado para el
    usuario del request) y devuelve su doc de proyectos_editor."""
    try:
        ruta_proyecto(name)   # misma validación de nombre que en local
    except ValueError as err:
        raise HTTPException(422, str(err))
    doc = db.cargar_proyecto_editor(db.usuario_actual(), name)
    if doc is None:
        raise HTTPException(404, f"{name}: no está entre tus proyectos")
    return doc


def _cdn(key: str) -> str:
    base = os.getenv("CDN_BASE", "").rstrip("/")
    if not base:
        raise HTTPException(503, "CDN_BASE no configurada — sin ella no hay media en nube")
    return f"{base}/{key}"


def _leer_json_s3(key: str) -> dict | None:
    crudo = media_sync.leer_texto(key)
    return json.loads(crudo) if crudo else None


def _cuts_path(project: Path) -> Path:
    return project / "work" / "analysis" / "cuts.json"


def _load_canonical_words(project: Path, cuts: dict) -> dict:
    words = {}
    for clip in cuts.get("clips", []):
        path = project / "work" / "transcripts" / f"{clip['id']}.canonical.json"
        words[clip["id"]] = []
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            if str(data.get("schema_version", "")).startswith("1."):
                words[clip["id"]] = data.get("words", [])
    return words


def _login_state(name: str) -> dict | None:
    if _chat.get(name) or ChatAgent is None or credential_status is None:
        return None
    if credential_status()["ok"]:
        return {"status": "ok"} if _login_seen_missing.get(name) else None
    _login_seen_missing[name] = True
    return {"status": "missing"}


@router.get("/{name}")
def editor_sin_barra(name: str):
    return RedirectResponse(f"/editor/{name}/")


@router.get("/{name}/", response_class=HTMLResponse)
def editor_ui(name: str):
    if _nube():
        _proyecto_nube(name)
    else:
        _proyecto(name)
    return (EDITOR_DIR / "index.html").read_text(encoding="utf-8")


@router.get("/{name}/api/data")
def data(name: str):
    if _nube():
        return _data_nube(name)
    p = _proyecto(name)
    cuts = json.loads(_cuts_path(p).read_text(encoding="utf-8"))
    return {
        "cuts": cuts,
        "manifest": json.loads((p / "work" / "editor" / "manifest.json").read_text(encoding="utf-8")),
        "words": _load_canonical_words(p, cuts),
        "project": name,
    }


def _data_nube(name: str) -> dict:
    user = db.usuario_actual()
    _proyecto_nube(name)
    fila = db.cortes_ultima(user, name)
    if fila is None:
        # primera apertura: sembrar la v1 con el cuts.json que subió el puente
        crudo = media_sync.leer_texto(f"videos/{name}/work/analysis/cuts.json")
        if crudo is None:
            raise HTTPException(404, f"{name}: sin cuts.json en S3 — el puente del generador no lo dejó listo")
        db.guardar_cortes(user, name, 0, crudo)   # si otra pestaña ganó, da igual
        fila = db.cortes_ultima(user, name)
    manifest = _leer_json_s3(f"videos/{name}/work/editor/manifest.json")
    if manifest is None:
        raise HTTPException(404, f"{name}: sin manifest.json en S3 — el proxy del editor no está listo")
    cuts = fila["doc"]
    words = {}
    for clip in cuts.get("clips", []):
        doc = _leer_json_s3(f"videos/{name}/work/transcripts/{clip['id']}.canonical.json")
        ok = doc and str(doc.get("schema_version", "")).startswith("1.")
        words[clip["id"]] = doc.get("words", []) if ok else []
    return {"cuts": cuts, "manifest": manifest, "words": words,
            "project": name, "version": fila["version"]}


@router.get("/{name}/ver/{clave}")
def ver(name: str, clave: str, request: Request):
    """Reproducir un export en el player del editor (con seek). Mismo streaming
    con Range que media(); el archivo sale de los descargables de b3."""
    from server.publicar_api import descargables
    if _nube():
        raise HTTPException(404, "en la nube los exports se abren por su enlace de CDN")
    p = _proyecto(name)
    f = descargables(p).get(clave)
    if not f or f.suffix != ".mp4":
        raise HTTPException(404, f"no hay export {clave!r}")
    return _rango(f, "video/mp4", request)


@router.get("/{name}/asset/{archivo}")
def asset(name: str, archivo: str):
    """Imágenes estáticas de la UI (p.ej. la mascota de Blotato en b3)."""
    _proyecto_nube(name) if _nube() else _proyecto(name)
    f = EDITOR_DIR / Path(archivo).name
    if f.suffix.lower() not in {".png", ".jpg", ".jpeg", ".svg", ".webp"} or not f.is_file():
        raise HTTPException(404, "asset no existe")
    return FileResponse(f)


@router.post("/{name}/api/abrir-carpeta")
def abrir_carpeta(name: str):
    """Importar (＋): abre la carpeta videos/ en el explorador del sistema —
    el server es local, así que importar metraje = dejar archivos ahí."""
    if _nube():
        raise HTTPException(400, "El editor corre en la nube — el metraje se sube desde e1 (botón Subir)")
    _proyecto(name)
    carpeta = videos_root()
    try:
        if sys.platform == "win32":
            os.startfile(carpeta)  # noqa: S606
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(carpeta)])
        else:
            subprocess.Popen(["xdg-open", str(carpeta)])
    except Exception as err:  # noqa: BLE001
        raise HTTPException(500, f"no se pudo abrir {carpeta}: {err}")
    return {"abierto": str(carpeta)}


@router.get("/{name}/media/{archivo}")
def media(name: str, archivo: str, request: Request):
    if archivo not in MEDIA:
        raise HTTPException(404, "not found")
    if _nube():
        # CloudFront sirve el rango (seek) directo del bucket; el navegador
        # llegó aquí autenticado por la cookie de M2 y se va con un 302
        _proyecto_nube(name)
        return RedirectResponse(_cdn(f"videos/{name}/work/editor/{archivo}"))
    path = _proyecto(name) / "work" / "editor" / archivo
    if not path.exists():
        raise HTTPException(404, f"{archivo} no existe — corre tools/make_proxy.py primero")
    return _rango(path, MEDIA[archivo], request)


def _rango(path: Path, media_type: str, request: Request):
    size = path.stat().st_size
    start, end = 0, size - 1
    rng = request.headers.get("range")
    if rng and rng.startswith("bytes="):
        a, _, b = rng[6:].partition("-")
        start = int(a) if a else max(0, size - int(b))
        if a and b:
            end = min(int(b), size - 1)

    def stream():
        with open(path, "rb") as f:
            f.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk = f.read(min(1 << 20, remaining))
                if not chunk:
                    break
                yield chunk
                remaining -= len(chunk)

    headers = {"Accept-Ranges": "bytes", "Content-Length": str(end - start + 1)}
    if rng:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    return StreamingResponse(stream(), status_code=206 if rng else 200,
                             media_type=media_type, headers=headers)


@router.post("/{name}/api/save")
async def save(name: str, request: Request):
    body = await request.json()
    data_ = body.get("cuts")
    if not data_ or "clips" not in data_:
        raise HTTPException(400, "invalid cuts payload")
    if _nube():
        # control de concurrencia: la UI manda la versión que abrió y solo se
        # guarda si sigue siendo la última (resuelve el P1 "Claude vs usuario")
        _proyecto_nube(name)
        base = int(body.get("base") or 0)
        nueva = db.guardar_cortes(db.usuario_actual(), name,
                                  base, json.dumps(data_, ensure_ascii=False))
        if nueva is None:
            raise HTTPException(409, "El corte cambió en otra pestaña o dispositivo — recarga la página para traer la última versión")
        return {"saved": True, "version": nueva, "backup": f"versión {nueva}"}
    p = _proyecto(name)
    cuts = _cuts_path(p)
    backups = p / "work" / "analysis" / "backups"
    backups.mkdir(exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    shutil.copy2(cuts, backups / f"cuts-{stamp}.json")
    cuts.write_text(json.dumps(data_, indent=2, ensure_ascii=False), encoding="utf-8")
    if changes := body.get("changes") or []:
        with open(p / "work" / "analysis" / "changes.log", "a", encoding="utf-8") as f:
            for c in changes:
                f.write(f"{stamp} {c}\n")
    return {"saved": True, "backup": f"backups/cuts-{stamp}.json"}


@router.post("/{name}/api/words")
async def words(name: str, request: Request):
    edits = (await request.json()).get("edits") or {}
    if not edits:
        raise HTTPException(400, "no edits")
    if _nube():
        return _words_nube(name, edits)
    p = _proyecto(name)
    backups = p / "work" / "transcripts" / "backups"
    backups.mkdir(exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    applied = 0
    for clip, per_word in edits.items():
        path = p / "work" / "transcripts" / f"{Path(clip).name}.canonical.json"
        if not path.exists():
            continue
        doc = json.loads(path.read_text(encoding="utf-8"))
        if not str(doc.get("schema_version", "")).startswith("1."):
            continue
        shutil.copy2(path, backups / f"{Path(clip).name}.canonical-{stamp}.json")
        ws = doc.get("words", [])
        for idx, text in per_word.items():
            i = int(idx)
            if 0 <= i < len(ws) and isinstance(text, str) and text.strip():
                ws[i]["text"] = text.strip()
                applied += 1
        for seg in doc.get("segments", []):
            seg["text"] = " ".join(w["text"] for w in ws[seg["first_word"]:seg["last_word"] + 1])
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    return {"saved": True, "applied": applied, "backup_stamp": stamp}


def _words_nube(name: str, edits: dict) -> dict:
    """Correcciones de texto sobre los canónicos en S3: respaldo del objeto
    (las versiones no se borran) y reescritura. Mismo contrato que en local."""
    _proyecto_nube(name)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    applied = 0
    for clip, per_word in edits.items():
        clip = Path(clip).name
        key = f"videos/{name}/work/transcripts/{clip}.canonical.json"
        doc = _leer_json_s3(key)
        if not doc or not str(doc.get("schema_version", "")).startswith("1."):
            continue
        media_sync.respaldar(key, f"videos/{name}/work/transcripts/backups/{clip}.canonical-{stamp}.json")
        ws = doc.get("words", [])
        for idx, text in per_word.items():
            i = int(idx)
            if 0 <= i < len(ws) and isinstance(text, str) and text.strip():
                ws[i]["text"] = text.strip()
                applied += 1
        for seg in doc.get("segments", []):
            seg["text"] = " ".join(w["text"] for w in ws[seg["first_word"]:seg["last_word"] + 1])
        media_sync.escribir_texto(key, json.dumps(doc, ensure_ascii=False, indent=1))
    return {"saved": True, "applied": applied, "backup_stamp": stamp}


def _run_render(name: str, style: str) -> None:
    st = _render[name]
    st.update(running=True, log=f"rendering {style} preview...\n", ok=None)
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "tools" / "render_cuts.py"), str(ruta_proyecto(name)),
         "--style", style, "--mode", "preview"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=str(ROOT),
    )
    for line in proc.stdout:
        st["log"] += line
    proc.wait()
    st.update(running=False, ok=proc.returncode == 0)


@router.post("/{name}/api/render")
async def render(name: str, request: Request):
    style = (await request.json()).get("style", "tight")
    if _nube():
        return _render_nube(name, style)
    _proyecto(name)
    st = _render.setdefault(name, {"running": False, "log": "", "ok": None})
    if st["running"]:
        raise HTTPException(409, "render already running")
    threading.Thread(target=_run_render, args=(name, style), daemon=True).start()
    return {"started": True}


def _render_caducado(r: dict) -> bool:
    """Un "corriendo" de hace más de 2 h está muerto (timeout de la state
    machine): no puede bloquear renders nuevos para siempre."""
    from datetime import datetime, timedelta, timezone
    try:
        inicio = datetime.fromisoformat(r["inicio"])
    except (KeyError, TypeError, ValueError):
        return True
    return datetime.now(timezone.utc) - inicio > timedelta(hours=2)


def _render_nube(name: str, style: str) -> dict:
    from datetime import datetime, timezone
    user = db.usuario_actual()
    doc = _proyecto_nube(name)
    r = doc.get("render") or {}
    if r.get("estado") == "corriendo" and not _render_caducado(r):
        raise HTTPException(409, "render already running")
    fila = db.cortes_ultima(user, name)
    if fila and style not in (fila["doc"].get("styles") or {}):
        raise HTTPException(400, f"estilo desconocido: {style!r}")
    db.fijar_render_editor(user, name, json.dumps(
        {"estilo": style, "estado": "corriendo",
         "inicio": datetime.now(timezone.utc).isoformat(timespec="seconds")}))
    try:
        jobs.lanzar_render(user, name, style)
    except Exception as err:  # noqa: BLE001 — sin SFN a mano, el estado no puede quedar "corriendo"
        db.fijar_render_editor(user, name, json.dumps(
            {"estilo": style, "estado": "error",
             "log": f"no se pudo lanzar el job: {err}"[:400]}))
        raise HTTPException(502, f"No se pudo lanzar el render: {str(err)[:200]}")
    return {"started": True}


@router.get("/{name}/api/render/status")
def render_status(name: str):
    if _nube():
        r = _proyecto_nube(name).get("render") or {}
        estado = r.get("estado")
        return {"running": estado == "corriendo" and not _render_caducado(r),
                "log": r.get("log", ""),
                "ok": True if estado == "listo" else False if estado == "error" else None,
                "url": r.get("url")}
    return _render.get(name, {"running": False, "log": "", "ok": None})


def _chat_contexto(name: str) -> str:
    """Transcript condensado + duración, desde S3 — lo que el consejero lee."""
    from server.broll_api import _condensar
    manifest = _leer_json_s3(f"videos/{name}/work/editor/manifest.json") or {}
    et = _leer_json_s3(f"videos/{name}/work/edited-transcript.json")
    try:
        transcript = _condensar(et, max_chars=4000)
    except HTTPException:
        transcript = "(sin transcript disponible)"
    return f"Duración del video: {manifest.get('total', '?')} s\nTranscript:\n{transcript}"


def _chat_nube(name: str, texto: str) -> dict:
    from datetime import datetime, timezone

    from pipeline import chat_nube
    user = db.usuario_actual()
    doc = _proyecto_nube(name)
    mensajes = (doc.get("chat") or {}).get("mensajes") or []
    hoy = datetime.now(timezone.utc).date().isoformat()
    turnos_hoy = sum(1 for m in mensajes
                     if m.get("role") == "user" and str(m.get("ts", "")).startswith(hoy))
    if turnos_hoy >= chat_nube.TURNOS_DIA:
        raise HTTPException(429, f"Llegaste al tope de {chat_nube.TURNOS_DIA} turnos de chat "
                                 "por día — mañana se renueva")
    try:
        respuesta, usage = chat_nube.responder(
            name, user, _chat_contexto(name), mensajes, texto)
    except chat_nube.SinClave as err:
        raise HTTPException(503, str(err))
    except Exception as err:  # noqa: BLE001 — el turno falló: nada se persiste
        raise HTTPException(502, f"El chat no pudo responder: {str(err)[:200]}")
    ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
    mensajes += [{"role": "user", "text": texto, "ts": ts},
                 {"role": "assistant", "text": respuesta, "ts": ts,
                  "usage": usage}]
    db.fijar_chat_editor(user, name, json.dumps({"mensajes": mensajes}, ensure_ascii=False))
    return {"sent": True}


@router.get("/{name}/api/chat/poll")
def chat_poll(name: str):
    if _nube():
        doc = _proyecto_nube(name)
        mensajes = (doc.get("chat") or {}).get("mensajes") or []
        vista = [{"role": m["role"], "text": m["text"]} for m in mensajes]
        if not vista:
            vista = [{"role": "assistant", "text": CHAT_NUBE_NOTA}]
        return {"available": True, "busy": False, "messages": vista,
                "error": None, "cuts_mtime": 0}
    p = _proyecto(name)
    agent = _chat.get(name)
    st = (agent.state() if agent
          else {"available": ChatAgent is not None, "busy": False,
                "error": CHAT_IMPORT_ERR, "messages": []})
    if ls := _login_state(name):
        st["login"] = ls
    cuts = _cuts_path(p)
    st["cuts_mtime"] = cuts.stat().st_mtime if cuts.exists() else 0
    return st


@router.post("/{name}/api/chat")
async def chat(name: str, request: Request):
    text = ((await request.json()).get("text") or "").strip()
    if not text:
        raise HTTPException(400, "empty message")
    if _nube():
        # def-in-thread no aplica: el handler es async — la llamada a Claude
        # bloquea, así que va a un thread para no congelar el event loop
        import asyncio
        return await asyncio.to_thread(_chat_nube, name, text)
    p = _proyecto(name)
    if ChatAgent is None:
        raise HTTPException(503, CHAT_IMPORT_ERR)
    with _chat_lock:
        if name not in _chat:
            _chat[name] = ChatAgent(ROOT, p)
    agent = _chat[name]
    if agent.state()["busy"]:
        raise HTTPException(409, "Claude sigue trabajando — espera su respuesta")
    if not agent.send(text):
        raise HTTPException(503, agent.fatal or "chat no disponible")
    return {"sent": True}
