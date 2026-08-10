"""Local cut-editor server. Zero dependencies (Python stdlib only).

Usage: python tools/editor/server.py video-1 [port]
Then open http://localhost:8765

Endpoints:
  GET  /                    editor UI
  GET  /api/data            cuts.json + proxy manifest + canonical words per clip
  GET  /media/proxy.mp4     raw-footage proxy (HTTP range supported)
  GET  /media/waveform.png  timeline waveform
  POST /api/save            write cuts.json (previous version backed up)
  POST /api/words           apply text corrections to the canonical transcripts
                            {"edits": {clip: {word_index: "new text"}}} (backed up)
  POST /api/render          run render_cuts.py  {"style": "tight"|"natural"}
  GET  /api/render/status   poll render progress
  POST /api/chat            send a message to the embedded Claude session {"text": ...}
  GET  /api/chat/poll       chat state: availability, busy, messages, cuts.json mtime

The chat needs `pip install claude-agent-sdk` (optional — everything else works
without it) and a logged-in Claude Code CLI; see chat_agent.py.
"""

import json
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
EDITOR_DIR = Path(__file__).resolve().parent
PROJECT = ROOT / (sys.argv[1] if len(sys.argv) > 1 else "videos/video-1")
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8765

CUTS = PROJECT / "work" / "analysis" / "cuts.json"
MEDIA = {
    "/media/proxy.mp4": (PROJECT / "work" / "editor" / "proxy.mp4", "video/mp4"),
    "/media/waveform.png": (PROJECT / "work" / "editor" / "waveform.png", "image/png"),
}

render_state = {"running": False, "log": "", "ok": None}

try:
    from chat_agent import ChatAgent
    CHAT_IMPORT_ERR = None
except ImportError as e:
    ChatAgent = None
    CHAT_IMPORT_ERR = f"chat deshabilitado: {e} — pip install claude-agent-sdk"
chat = {"agent": None}          # se crea perezosamente en el primer mensaje
chat_lock = threading.Lock()


def chat_state() -> dict:
    st = (chat["agent"].state() if chat["agent"]
          else {"available": ChatAgent is not None, "busy": False,
                "error": CHAT_IMPORT_ERR, "messages": []})
    # el panel usa el mtime para recargar cuts.json cuando Claude lo modifica
    st["cuts_mtime"] = CUTS.stat().st_mtime if CUTS.exists() else 0
    return st


def load_canonical_words(cuts: dict) -> dict:
    """Per-clip word lists from the canonical transcripts (seconds-float).
    Validates schema_version before reading (docs/SCHEMA.md); a clip without a
    readable 1.x canonical gets an empty list and the UI shows a notice."""
    words = {}
    for clip in cuts.get("clips", []):
        path = PROJECT / "work" / "transcripts" / f"{clip['id']}.canonical.json"
        words[clip["id"]] = []
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            if str(data.get("schema_version", "")).startswith("1."):
                words[clip["id"]] = data.get("words", [])
    return words


def run_render(style: str) -> None:
    render_state.update(running=True, log=f"rendering {style} preview...\n", ok=None)
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "tools" / "render_cuts.py"),
         PROJECT.relative_to(ROOT).as_posix(),
         "--style", style, "--mode", "preview"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=str(ROOT),
    )
    for line in proc.stdout:
        render_state["log"] += line
    proc.wait()
    render_state.update(running=False, ok=proc.returncode == 0)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # quiet
        pass

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file_ranged(self, path: Path, ctype: str):
        if not path.exists():
            self.send_json({"error": f"{path.name} not found — run tools/make_proxy.py first"}, 404)
            return
        size = path.stat().st_size
        start, end = 0, size - 1
        rng = self.headers.get("Range")
        if rng and rng.startswith("bytes="):
            a, _, b = rng[6:].partition("-")
            start = int(a) if a else max(0, size - int(b))
            if a and b:
                end = min(int(b), size - 1)
        self.send_response(206 if rng else 200)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        if rng:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk = f.read(min(1 << 20, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
                    return
                remaining -= len(chunk)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            body = (EDITOR_DIR / "index.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/api/data":
            cuts = json.loads(CUTS.read_text(encoding="utf-8"))
            self.send_json({
                "cuts": cuts,
                "manifest": json.loads((PROJECT / "work" / "editor" / "manifest.json").read_text(encoding="utf-8")),
                "words": load_canonical_words(cuts),
                "project": PROJECT.name,
            })
        elif self.path == "/api/render/status":
            self.send_json(render_state)
        elif self.path == "/api/chat/poll":
            self.send_json(chat_state())
        elif self.path in MEDIA:
            self.send_file_ranged(*MEDIA[self.path])
        else:
            self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        if self.path == "/api/save":
            data = body.get("cuts")
            if not data or "clips" not in data:
                self.send_json({"error": "invalid cuts payload"}, 400)
                return
            backups = PROJECT / "work" / "analysis" / "backups"
            backups.mkdir(exist_ok=True)
            stamp = time.strftime("%Y%m%d-%H%M%S")
            shutil.copy2(CUTS, backups / f"cuts-{stamp}.json")
            CUTS.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
            changes = body.get("changes") or []
            if changes:
                log = PROJECT / "work" / "analysis" / "changes.log"
                with open(log, "a", encoding="utf-8") as f:
                    for c in changes:
                        f.write(f"{stamp} {c}\n")
            self.send_json({"saved": True, "backup": f"backups/cuts-{stamp}.json"})
        elif self.path == "/api/words":
            # Text-only corrections to the canonical transcript (ASR typos, names).
            # Times are never touched here; segments[].text is derived, so regenerate.
            edits = body.get("edits") or {}
            if not edits:
                self.send_json({"error": "no edits"}, 400)
                return
            backups = PROJECT / "work" / "transcripts" / "backups"
            backups.mkdir(exist_ok=True)
            stamp = time.strftime("%Y%m%d-%H%M%S")
            applied = 0
            for clip, per_word in edits.items():
                path = PROJECT / "work" / "transcripts" / f"{clip}.canonical.json"
                if not path.exists():
                    continue
                data = json.loads(path.read_text(encoding="utf-8"))
                if not str(data.get("schema_version", "")).startswith("1."):
                    continue
                shutil.copy2(path, backups / f"{clip}.canonical-{stamp}.json")
                words = data.get("words", [])
                for idx, text in per_word.items():
                    i = int(idx)
                    if 0 <= i < len(words) and isinstance(text, str) and text.strip():
                        words[i]["text"] = text.strip()
                        applied += 1
                for seg in data.get("segments", []):
                    seg["text"] = " ".join(
                        w["text"] for w in words[seg["first_word"]:seg["last_word"] + 1])
                path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
            self.send_json({"saved": True, "applied": applied, "backup_stamp": stamp})
        elif self.path == "/api/chat":
            text = (body.get("text") or "").strip()
            if not text:
                self.send_json({"error": "empty message"}, 400)
                return
            if ChatAgent is None:
                self.send_json({"error": CHAT_IMPORT_ERR}, 503)
                return
            with chat_lock:
                if chat["agent"] is None:
                    chat["agent"] = ChatAgent(ROOT, PROJECT)
            agent = chat["agent"]
            if agent.state()["busy"]:
                self.send_json({"error": "Claude sigue trabajando — espera su respuesta"}, 409)
                return
            if not agent.send(text):
                self.send_json({"error": agent.fatal or "chat no disponible"}, 503)
                return
            self.send_json({"sent": True})
        elif self.path == "/api/render":
            if render_state["running"]:
                self.send_json({"error": "render already running"}, 409)
                return
            style = body.get("style", "tight")
            threading.Thread(target=run_render, args=(style,), daemon=True).start()
            self.send_json({"started": True})
        else:
            self.send_json({"error": "not found"}, 404)


if __name__ == "__main__":
    print(f"Cut editor for {PROJECT.name}  ->  http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
