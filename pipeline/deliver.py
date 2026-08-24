"""Subida a Drive y mensaje final.

Drive: Google no da cuota de almacenamiento a las service accounts en "Mi unidad", así que la subida
usa OAuth de usuario si existe `GOOGLE_OAUTH_CLIENT_FILE` (token cacheado en `GOOGLE_OAUTH_TOKEN_FILE`,
generado una vez con `python auth_google.py`). Si no, cae a la service account (solo sirve con unidades compartidas).
"""
from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path

from langfuse import observe

from .config import settings
from .models import Scene

SCOPES = ["https://www.googleapis.com/auth/drive.file"]
OAUTH_CLIENT = os.getenv("GOOGLE_OAUTH_CLIENT_FILE", "")
OAUTH_TOKEN = os.getenv("GOOGLE_OAUTH_TOKEN_FILE", "./token_drive.json")


def resumen_escenas(escenas: list[Scene]) -> str:
    lineas = []
    for e in sorted(escenas, key=lambda s: s.orden):
        t = "↪ continua" if e.transicion == "continua" else "✂ corte"
        avisos = []
        if e.video_origen == "estatico":
            avisos.append("⚠ clip estático (Veo falló)")
        if e.start_image_origen == "frame_previo_fallback":
            avisos.append("⚠ imagen de respaldo (Grok falló)")
        if e.qc == "corregido":
            avisos.append("↻ orientación corregida por QC")
        if e.qc == "fallido":
            avisos.append(f"⚠ QC de orientación no superado ({e.qc_motivo})")
        lineas.append(f"{e.id}: {t} · {e.duracion_final or e.duracion_video}s" + (" · " + ", ".join(avisos) if avisos else ""))
    return "\n".join(lineas)


def mensaje_final(nombre: str, link: str | None, duracion: float | None, escenas: list[Scene]) -> str:
    n_cont = sum(1 for e in escenas if e.transicion == "continua")
    n_fb = sum(1 for e in escenas if e.es_fallback)
    dur = f"{round(duracion)} s" if duracion else f"~{round(sum(e.duracion_final or e.duracion_video or 0 for e in escenas))} s"
    lineas = [
        f"🎬 Película lista: {nombre}",
        link or "(sin enlace)",
        "",
        f"Duración: {dur} · {len(escenas)} escenas ({n_cont} continuas, {len(escenas) - n_cont} cortes)",
    ]
    if n_fb:
        lineas.append(f"⚠ {n_fb} escena(s) con respaldo; revisa las marcadas abajo.")
    lineas += ["", resumen_escenas(escenas)]
    return "\n".join(lineas)


def credenciales_drive():
    """OAuth de usuario (preferido) o service account."""
    if OAUTH_CLIENT:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials

        if not Path(OAUTH_TOKEN).exists():
            raise RuntimeError(f"No existe {OAUTH_TOKEN}; ejecuta una vez `python auth_google.py` para autorizar Drive.")
        creds = Credentials.from_authorized_user_file(OAUTH_TOKEN, SCOPES)
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            Path(OAUTH_TOKEN).write_text(creds.to_json(), encoding="utf-8")
        return creds
    from google.oauth2 import service_account

    return service_account.Credentials.from_service_account_file(
        settings.google_sa_file, scopes=["https://www.googleapis.com/auth/drive"]
    )


@observe(name="subir_drive")
def subir_drive(path: Path) -> tuple[str, str, str]:
    """Devuelve (id, nombre, link)."""
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload

    svc = build("drive", "v3", credentials=credenciales_drive(), cache_discovery=False)
    nombre = f"pelicula_{datetime.now():%Y%m%d_%H%M}.mp4"
    meta = {"name": nombre, "parents": [settings.drive_folder_id]}
    media = MediaFileUpload(str(path), mimetype="video/mp4", resumable=True)
    f = svc.files().create(body=meta, media_body=media, fields="id,name,webViewLink", supportsAllDrives=True).execute()
    return f["id"], f["name"], f.get("webViewLink") or f"https://drive.google.com/file/d/{f['id']}/view"
