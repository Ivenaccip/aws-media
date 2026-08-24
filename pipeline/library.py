"""Biblioteca IA: lectura de la hoja y normalización (Preparar biblioteca)."""
from __future__ import annotations

from langfuse import observe

from .config import settings
from .models import Biblioteca
from .utils import drive_public_url, norm


def preparar_biblioteca(filas: list[dict]) -> Biblioteca:
    activas = [f for f in filas if norm(f.get("estado")) == "activo"]
    estilo = next((f for f in activas if norm(f.get("tipo")) == "estilo"), None)
    entidades = [
        {
            "nombre": norm(f.get("nombre")),
            "tipo": norm(f.get("tipo")),
            "descriptor": f.get("descriptor", ""),
            "url": drive_public_url(f),
        }
        for f in activas
        if norm(f.get("tipo")) != "estilo"
    ]
    return Biblioteca(entidades=entidades, estilo_url=drive_public_url(estilo) if estilo else None)


def _sheets_service():
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    creds = service_account.Credentials.from_service_account_file(
        settings.google_sa_file,
        scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
    )
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


@observe(name="leer_biblioteca")
def leer_biblioteca() -> Biblioteca:
    """Lee la hoja completa y devuelve la biblioteca normalizada."""
    svc = _sheets_service()
    res = svc.spreadsheets().values().get(
        spreadsheetId=settings.sheet_id, range=settings.sheet_range
    ).execute()
    valores = res.get("values", [])
    if not valores:
        return Biblioteca(entidades=[], estilo_url=None)
    cab = [norm(c) for c in valores[0]]
    filas = [dict(zip(cab, fila + [""] * (len(cab) - len(fila)))) for fila in valores[1:]]
    return preparar_biblioteca(filas)
