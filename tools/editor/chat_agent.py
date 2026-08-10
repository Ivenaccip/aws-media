"""Puente del chat embebido del cut-editor -> Claude (claude-agent-sdk).

Sesion PERSISTENTE multi-turno: un hilo propio corre un event loop asyncio con un
ClaudeSDKClient conectado; server.py encola prompts (send) y sirve el estado
acumulado (state) al panel de chat del editor. El agente trabaja con cwd = raiz
del repo (hereda CLAUDE.md via setting_sources) y permiso acceptEdits: puede
editar cuts.json directamente ("solo toma el primer CTA del flag 2") sin pedir
confirmacion por cada Edit; Bash queda limitado a python tools/*.

Import opcional: server.py atrapa ImportError y el panel muestra como instalar
(pip install claude-agent-sdk). Autenticacion: la del CLI de Claude Code del
usuario (suscripcion); si el CLI no esta logueado, el error aparece en el chat.
"""

import asyncio
import os
import threading

SYSTEM_APPEND = """
Estas embebido como chat del CUT EDITOR local (tools/editor) de este repo, proyecto
{project}. El usuario te escribe desde el panel de chat mientras audita su corte a
oido; casi siempre te pedira aplicar decisiones editoriales sobre el corte.

Contexto operativo:
- El corte vive en {project}/work/analysis/cuts.json: keeps/cuts por clip (rangos en
  segundos del clip crudo), flags (judgment calls: id, clip, at "MM:SS", issue,
  default) y fluff_suggestions (con status).
- REGLA DURA: nada se borra de cuts.json. Quitar material = mover el rango de keeps a
  cuts con su categoria (retake|false_start|filler|long_pause|dead_air|manual);
  restaurar = moverlo de vuelta a keeps. cuts es registro de auditoria. Conserva el
  formato de los objetos existentes (s, e, text, cat...; el editor recalcula gap al
  guardar). keeps y cuts quedan ordenados por s y sin solaparse.
- Para ubicar palabras/tiempos exactos usa {project}/work/transcripts/<clip>.canonical.json
  (schema en docs/SCHEMA.md). Sus TIEMPOS son intocables; el texto solo se corrige
  desde el editor.
- El editor del usuario recarga cuts.json cuando TERMINAS tu turno: deja el archivo
  completo y consistente en cada respuesta, no a medias.
- Si el usuario dice "el flag 2" / "el 2" / "▲2", es el objeto de flags con id=2.
- Los flags llevan status "pending" | "resolved" (sin campo = pending). Cada vez que
  resuelvas uno (aplicando su default o el criterio del usuario), ademas del cambio en
  keeps/cuts pon "status": "resolved" en ese flag. NO borres ni reescribas su issue;
  si quieres dejar constancia de la decision, agrega un campo "resolution" corto.
- El editor suele mandarte VARIOS flags en un mensaje: haz una sola pasada consistente
  sobre cuts.json con todos.
- No dispares renders, transcripciones ni QA por tu cuenta — eso lo hace el usuario
  desde el editor o las skills. Solo si te lo pide explicitamente.
- Responde CORTO y en espanol: que cambiaste, en que clip y que rangos. Sin listas de
  opciones salvo que te pidan opinion.
""".strip()


class ChatAgent:
    """Un agente por servidor; se crea perezosamente en el primer mensaje."""

    def __init__(self, root, project):
        self.root = root
        self.project = project
        self.messages = []          # [{role: user|assistant|tool|result|error, ...}]
        self.busy = False
        self.fatal = None           # error de arranque/conexion (chat inutilizable)
        self._loop = None
        self._queue = None
        self._ready = threading.Event()
        threading.Thread(target=self._run, daemon=True, name="chat-agent").start()

    # -- API para server.py (hilos HTTP) --------------------------------------
    def send(self, text: str) -> bool:
        self._ready.wait(timeout=15)
        if self.fatal or self._loop is None:
            return False
        self.busy = True
        self.messages.append({"role": "user", "text": text})
        self._loop.call_soon_threadsafe(self._queue.put_nowait, text)
        return True

    def state(self) -> dict:
        return {"available": self.fatal is None, "busy": self.busy,
                "error": self.fatal, "messages": list(self.messages)}

    # -- hilo del agente -------------------------------------------------------
    def _run(self):
        try:
            asyncio.run(self._main())
        except Exception as e:  # incluye fallo de conexion/CLI sin login
            self.fatal = f"{type(e).__name__}: {e}"
            self.busy = False
        finally:
            self._ready.set()

    async def _main(self):
        from claude_agent_sdk import (AssistantMessage, ClaudeAgentOptions,
                                      ClaudeSDKClient, ResultMessage)
        from claude_agent_sdk.types import TextBlock, ToolUseBlock

        # el server puede haber sido lanzado DESDE una sesion de Claude Code;
        # vaciamos las marcas de anidamiento (vaciar y no omitir: si el SDK
        # fusiona este dict con os.environ, la clave omitida sobreviviria)
        env = dict(os.environ)
        for k in list(env):
            if k.startswith(("CLAUDECODE", "CLAUDE_CODE_")):
                env[k] = ""
        # auth: por default la sesion del CLI (suscripcion); si no la hay,
        # ANTHROPIC_API_KEY del .env del repo (convencion: keys solo en .env)
        if not env.get("ANTHROPIC_API_KEY"):
            key = _env_api_key(self.root)
            if key:
                env["ANTHROPIC_API_KEY"] = key

        rel = self.project.relative_to(self.root).as_posix()
        options = ClaudeAgentOptions(
            cwd=str(self.root),
            permission_mode="acceptEdits",
            allowed_tools=["Read", "Grep", "Glob", "Edit", "Write",
                           "Bash(python tools/*)"],
            setting_sources=["project"],   # carga CLAUDE.md del repo
            system_prompt={"type": "preset", "preset": "claude_code",
                           "append": SYSTEM_APPEND.format(project=rel)},
            max_turns=40,
            env=env,
        )
        self._loop = asyncio.get_running_loop()
        self._queue = asyncio.Queue()

        async with ClaudeSDKClient(options=options) as client:
            self._ready.set()
            while True:
                prompt = await self._queue.get()
                try:
                    await client.query(prompt)
                    async for msg in client.receive_response():
                        if isinstance(msg, AssistantMessage):
                            for block in msg.content:
                                if isinstance(block, TextBlock) and block.text.strip():
                                    self.messages.append(
                                        {"role": "assistant", "text": block.text})
                                    if "Failed to authenticate" in block.text:
                                        self.messages.append(
                                            {"role": "error", "text":
                                             "El CLI de Claude no tiene sesion valida: "
                                             "corre `claude /login` en una terminal, o pon "
                                             "ANTHROPIC_API_KEY en el .env del repo y "
                                             "reinicia el server del editor."})
                                elif isinstance(block, ToolUseBlock):
                                    self.messages.append(
                                        {"role": "tool", "name": block.name,
                                         "detail": _tool_detail(block)})
                        elif isinstance(msg, ResultMessage):
                            self.messages.append(
                                {"role": "result",
                                 "ok": msg.subtype == "success",
                                 "subtype": msg.subtype,
                                 "cost": getattr(msg, "total_cost_usd", None)})
                except Exception as e:
                    self.messages.append(
                        {"role": "error", "text": f"{type(e).__name__}: {e}"})
                finally:
                    self.busy = False


def _env_api_key(root) -> str | None:
    """ANTHROPIC_API_KEY desde el .env de la raiz del repo, si existe."""
    path = root / ".env"
    if not path.is_file():
        return None
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if line.startswith("ANTHROPIC_API_KEY="):
            return line.split("=", 1)[1].strip().strip("'\"") or None
    return None


def _tool_detail(block) -> str:
    """Resumen corto y legible del tool call para el chip del chat."""
    inp = block.input or {}
    for key in ("file_path", "path", "pattern", "command", "description"):
        if key in inp:
            val = str(inp[key]).replace("\\", "/")
            if "/" in val and key in ("file_path", "path"):
                val = val.split("/")[-1]
            return val[:80]
    return ""
