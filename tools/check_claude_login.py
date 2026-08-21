"""Chequeo de sesion de Claude para el chat embebido del cut-editor.

El chat del editor (tools/editor/chat_agent.py) usa claude-agent-sdk, que se
autentica con la sesion del CLI de Claude Code del usuario (su suscripcion) o,
como respaldo, con ANTHROPIC_API_KEY en el .env del repo. Este tool SOLO
diagnostica: dice si hay una via de autenticacion valida y, si no, imprime los
pasos del login OFICIAL (`claude /login` — las skills lo despliegan como bloque
clickeable con boton Run). NUNCA refresca ni toca tokens (eso lo hace el CLI
solo, con su refresh token) y NUNCA imprime valores de credenciales.

Uso:
  python tools/check_claude_login.py            # humano: diagnostico + pasos
  python tools/check_claude_login.py --json     # maquina: {"ok", "method", ...}

Exit code: 0 = hay autenticacion; 1 = falta login (o falta el CLI).

Nota de historia: hubo un modo --login que replicaba el flujo OAuth interno del
CLI (liga + callback localhost:54545). Se elimino: el intercambio final del
code lo rechaza el servidor (403) para clientes no oficiales, y mantener
ingenieria inversa de un flujo no documentado rompe en silencio. El login es
SIEMPRE con el CLI oficial.
"""

import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def find_claude_cli() -> str | None:
    """Ruta del CLI de Claude Code, o None si no esta instalado."""
    for name in ("claude", "claude.cmd", "claude.ps1", "claude.exe"):
        hit = shutil.which(name)
        if hit:
            return hit
    home = Path.home()
    for cand in (home / ".local" / "bin" / "claude",
                 home / "AppData" / "Roaming" / "npm" / "claude.cmd"):
        if cand.exists():
            return str(cand)
    return None


def _dotenv_has_api_key() -> bool:
    path = ROOT / ".env"
    if not path.is_file():
        return False
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if line.startswith("ANTHROPIC_API_KEY=") and line.split("=", 1)[1].strip().strip("'\""):
            return True
    return False


def _cli_credentials_exist() -> bool:
    """Sesion guardada del CLI (login con suscripcion). No valida expiry: el CLI
    la refresca solo mientras exista el refresh token."""
    cred = Path.home() / ".claude" / ".credentials.json"
    if cred.is_file():
        try:
            data = json.loads(cred.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return False
        return bool(data.get("claudeAiOauth"))
    if platform.system() == "Darwin":  # macOS guarda en el Keychain, no en archivo
        try:
            r = subprocess.run(
                ["security", "find-generic-password", "-s", "Claude Code-credentials"],
                capture_output=True, timeout=10)
            return r.returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            return False
    return False


def credential_status() -> dict:
    """Primera via de autenticacion disponible, en el orden en que el SDK las usa."""
    cli = find_claude_cli()
    if not cli:
        return {"ok": False, "method": None, "cli": None}
    if _cli_credentials_exist():
        return {"ok": True, "method": "cli_login", "cli": cli}
    if os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        return {"ok": True, "method": "oauth_token_env", "cli": cli}
    if os.environ.get("ANTHROPIC_API_KEY"):
        return {"ok": True, "method": "api_key_env", "cli": cli}
    if _dotenv_has_api_key():
        return {"ok": True, "method": "api_key_dotenv", "cli": cli}
    return {"ok": False, "method": None, "cli": cli}


LABELS = {
    "cli_login": "sesion del CLI de Claude Code (tu suscripcion)",
    "oauth_token_env": "token de CLAUDE_CODE_OAUTH_TOKEN (claude setup-token)",
    "api_key_env": "ANTHROPIC_API_KEY del entorno",
    "api_key_dotenv": "ANTHROPIC_API_KEY del .env del repo",
}

LOGIN_STEPS = """\
Para iniciar sesion (una vez por maquina), el flujo oficial:
  1. Corre:  claude /login   (en el chat de Claude Code sale como boton Run —
     un click; o pegalo en una terminal nueva)
  2. Se abre el navegador: autoriza con tu cuenta de Claude.
  3. Listo — la sesion queda guardada y se refresca sola; no hay que repetir
     esto salvo que cierres sesion o cambies de maquina.

Alternativa sin suscripcion: pega ANTHROPIC_API_KEY en el .env del repo
(copia .env.example). Nunca compartas ni pegues la key en un chat."""


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    st = credential_status()
    if "--json" in sys.argv:
        print(json.dumps(st))
        return 0 if st["ok"] else 1
    if not st["cli"]:
        print("[FALTA] No encontre el CLI de Claude Code en esta maquina.")
        print("        Instalalo primero:  npm install -g @anthropic-ai/claude-code")
        print("        (y luego corre este chequeo de nuevo)")
        return 1
    if st["ok"]:
        print(f"[OK] Sesion de Claude lista - via: {LABELS[st['method']]}")
        print("     El chat del editor de cortes va a funcionar.")
        return 0
    print("[FALTA] No hay sesion de Claude iniciada en esta maquina.")
    print("        El editor de cortes abre igual, pero su chat con Claude")
    print("        (el que aplica tus decisiones sobre los flags) no va a responder.")
    print()
    print(LOGIN_STEPS)
    return 1


if __name__ == "__main__":
    sys.exit(main())
