"""Cliente HTTP de Blotato para fn2 (PLAN-FUSION.md F3.2) — API directa, no MCP.

Auth: header `blotato-api-key` (BLOTATO_API_KEY en .env). Docs verificadas
2026-08-24 en help.blotato.com/api: GET /v2/users/me/accounts · POST
/v2/media/uploads (presigned) · POST /v2/posts (scheduledTime ISO 8601).
"""
from __future__ import annotations

import mimetypes
from pathlib import Path

import httpx

from .config import settings

BASE = "https://backend.blotato.com/v2"
TIMEOUT = httpx.Timeout(30, read=120)


def disponible() -> bool:
    return bool(settings.blotato_api_key)


def _headers() -> dict:
    if not settings.blotato_api_key:
        raise RuntimeError("Falta BLOTATO_API_KEY en el .env (fn2)")
    return {"blotato-api-key": settings.blotato_api_key}


def cuentas() -> list[dict]:
    """Redes realmente conectadas del usuario: [{id, platform, fullname, username}]."""
    r = httpx.get(f"{BASE}/users/me/accounts", headers=_headers(), timeout=TIMEOUT)
    r.raise_for_status()
    return r.json().get("items", [])


def subir_video(path: Path) -> str:
    """Presigned upload (recomendado para archivos locales): devuelve la URL
    pública que va en mediaUrls."""
    r = httpx.post(f"{BASE}/media/uploads", headers=_headers(),
                   json={"filename": path.name}, timeout=TIMEOUT)
    r.raise_for_status()
    datos = r.json()
    mime = mimetypes.guess_type(path.name)[0] or "video/mp4"
    subida = httpx.put(datos["presignedUrl"], content=path.read_bytes(),
                       headers={"Content-Type": mime},
                       timeout=httpx.Timeout(30, read=600, write=600))
    subida.raise_for_status()
    return datos["publicUrl"]


def payload_post(account_id: str, platform: str, texto: str, media_urls: list[str],
                 scheduled_time: str | None = None) -> dict:
    """Body de POST /v2/posts (separado para poder testearlo sin red)."""
    body: dict = {"post": {
        "accountId": str(account_id),
        "content": {"text": texto, "mediaUrls": media_urls, "platform": platform},
        "target": {"targetType": platform},
    }}
    if scheduled_time:
        body["scheduledTime"] = scheduled_time
    return body


def publicar(account_id: str, platform: str, texto: str, media_urls: list[str],
             scheduled_time: str | None = None) -> dict:
    r = httpx.post(f"{BASE}/posts", headers=_headers(),
                   json=payload_post(account_id, platform, texto, media_urls, scheduled_time),
                   timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()
