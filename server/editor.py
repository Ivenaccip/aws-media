"""Cut-editor como router FastAPI — port 1:1 de tools/editor/server.py (stdlib),
ahora multi-proyecto bajo /editor/{project}/ (PLAN-FUSION.md F1.2).

La UI (tools/editor/index.html) usa URLs relativas, así que funciona igual servida
por el server stdlib original en "/" que aquí bajo /editor/{project}/. El estado
(render en curso, agente de chat) es por proyecto y en memoria — un solo worker,
misma limitación conocida que el resto del server (PLAN-FUSION.md F4).
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response, StreamingResponse

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
    if not name.replace("-", "").replace("_", "").isalnum():
        raise HTTPException(422, f"nombre de proyecto inválido: {name}")
    p = ROOT / "videos" / name
    if not (p / "work" / "analysis" / "cuts.json").is_file():
        raise HTTPException(404, f"{name}: sin work/analysis/cuts.json — corre /clean-cut o el puente del generador")
    return p


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
    _proyecto(name)
    return (EDITOR_DIR / "index.html").read_text(encoding="utf-8")


@router.get("/{name}/api/data")
def data(name: str):
    p = _proyecto(name)
    cuts = json.loads(_cuts_path(p).read_text(encoding="utf-8"))
    return {
        "cuts": cuts,
        "manifest": json.loads((p / "work" / "editor" / "manifest.json").read_text(encoding="utf-8")),
        "words": _load_canonical_words(p, cuts),
        "project": name,
    }


@router.get("/{name}/media/{archivo}")
def media(name: str, archivo: str, request: Request):
    if archivo not in MEDIA:
        raise HTTPException(404, "not found")
    path = _proyecto(name) / "work" / "editor" / archivo
    if not path.exists():
        raise HTTPException(404, f"{archivo} no existe — corre tools/make_proxy.py primero")
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
                             media_type=MEDIA[archivo], headers=headers)


@router.post("/{name}/api/save")
async def save(name: str, request: Request):
    p = _proyecto(name)
    body = await request.json()
    data_ = body.get("cuts")
    if not data_ or "clips" not in data_:
        raise HTTPException(400, "invalid cuts payload")
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
    p = _proyecto(name)
    edits = (await request.json()).get("edits") or {}
    if not edits:
        raise HTTPException(400, "no edits")
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


def _run_render(name: str, style: str) -> None:
    st = _render[name]
    st.update(running=True, log=f"rendering {style} preview...\n", ok=None)
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "tools" / "render_cuts.py"), f"videos/{name}",
         "--style", style, "--mode", "preview"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=str(ROOT),
    )
    for line in proc.stdout:
        st["log"] += line
    proc.wait()
    st.update(running=False, ok=proc.returncode == 0)


@router.post("/{name}/api/render")
async def render(name: str, request: Request):
    _proyecto(name)
    st = _render.setdefault(name, {"running": False, "log": "", "ok": None})
    if st["running"]:
        raise HTTPException(409, "render already running")
    style = (await request.json()).get("style", "tight")
    threading.Thread(target=_run_render, args=(name, style), daemon=True).start()
    return {"started": True}


@router.get("/{name}/api/render/status")
def render_status(name: str):
    return _render.get(name, {"running": False, "log": "", "ok": None})


@router.get("/{name}/api/chat/poll")
def chat_poll(name: str):
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
    p = _proyecto(name)
    text = ((await request.json()).get("text") or "").strip()
    if not text:
        raise HTTPException(400, "empty message")
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
