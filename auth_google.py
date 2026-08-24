"""Autorización OAuth de Drive (una sola vez). Abre el navegador, inicias sesión con tu cuenta de Google
y guarda el token en GOOGLE_OAUTH_TOKEN_FILE (por defecto ./token_drive.json).

Requisito: un "ID de cliente OAuth" de tipo *Aplicación de escritorio* en Google Cloud Console
(APIs y servicios → Credenciales → Crear credenciales → ID de cliente OAuth), descargado como JSON y
referenciado en .env como GOOGLE_OAUTH_CLIENT_FILE.
"""
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from pipeline.deliver import OAUTH_CLIENT, OAUTH_TOKEN, SCOPES  # noqa: E402

if not OAUTH_CLIENT or not Path(OAUTH_CLIENT).exists():
    raise SystemExit("Define GOOGLE_OAUTH_CLIENT_FILE en .env apuntando al JSON del cliente OAuth de escritorio.")

from google_auth_oauthlib.flow import InstalledAppFlow  # noqa: E402

creds = InstalledAppFlow.from_client_secrets_file(OAUTH_CLIENT, SCOPES).run_local_server(port=0)
Path(OAUTH_TOKEN).write_text(creds.to_json(), encoding="utf-8")
print(f"Token guardado en {OAUTH_TOKEN}. Ya puedes subir a Drive como tu usuario.")
