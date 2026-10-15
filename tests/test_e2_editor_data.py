"""E2 — el editor sabe que está abriendo una COPIA.

`GET /editor/<n>/api/data` trae `titulo` y `copia` para que el encabezado del
editor diga «Copia de …» (R1: el original no se toca). Un proyecto que NO es
copia trae `copia: null` y el editor se ve igual que siempre.
"""
import json

import pytest
from fastapi.testclient import TestClient

from pipeline import db, media_sync

CUTS = {"clips": [{"id": "c01", "file": "clips/c01.mp4", "keeps": [], "cuts": []}],
        "clip_order": ["c01"], "styles": {"tight": {}}}
MANIFEST = {"parts": [{"id": "c01", "offset": 0.0, "duration": 10.0}], "total": 10.0}


@pytest.fixture
def nube(monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setattr(db, "backend", lambda: "postgres")
    monkeypatch.setattr(db, "usuario_actual", lambda: "u1")
    docs = {}
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: docs.get(n))
    monkeypatch.setattr(db, "cortes_ultima", lambda u, p: {"version": 3, "doc": CUTS})
    objetos = {"videos/ed-9f1c0a7b/work/editor/manifest.json": json.dumps(MANIFEST),
               "videos/gen-abc/work/editor/manifest.json": json.dumps(MANIFEST),
               "videos/ed-9f1c0a7b/work/transcripts/c01.canonical.json": json.dumps(
                   {"schema_version": "1.0", "words": [{"text": "hola"}]})}
    monkeypatch.setattr(media_sync, "leer_texto", lambda k: objetos.get(k))
    from server.app import app
    c = TestClient(app)
    c.docs = docs
    return c


def test_una_copia_trae_el_titulo_y_los_originales_en_orden(nube):
    nube.docs["ed-9f1c0a7b"] = {
        "titulo": "El tren de papel + 2 más",
        "copia": {"version": 1, "de": [
            {"orden": 1, "ref": "proyecto:gen-1", "tipo": "pelicula", "titulo": "El tren de papel", "clip_id": "c01"},
            {"orden": 2, "ref": "clip:clip-1", "tipo": "clip", "titulo": "Perro en la playa", "clip_id": "c02"},
            {"orden": 3, "ref": "proyecto:e", "tipo": "edicion", "titulo": "entrevista", "clip_id": "c03"}]}}
    j = nube.get("/editor/ed-9f1c0a7b/api/data").json()
    assert j["titulo"] == "El tren de papel + 2 más"
    assert j["copia"] == [{"titulo": "El tren de papel", "tipo": "pelicula"},
                          {"titulo": "Perro en la playa", "tipo": "clip"},
                          {"titulo": "entrevista", "tipo": "edicion"}]
    # y lo de siempre sigue ahí
    assert j["project"] == "ed-9f1c0a7b" and j["version"] == 3 and j["cuts"] == CUTS
    assert j["words"]["c01"] == [{"text": "hola"}] and j["manifest"]["total"] == 10.0


def test_un_proyecto_normal_trae_copia_null(nube):
    nube.docs["gen-abc"] = {"flags": {"cuts": True}}
    j = nube.get("/editor/gen-abc/api/data").json()
    assert j["copia"] is None and j["titulo"] is None
    assert j["project"] == "gen-abc"


def test_una_copia_con_un_solo_original(nube):
    nube.docs["ed-9f1c0a7b"] = {"titulo": "Una charla", "copia": {"version": 1, "de": [
        {"orden": 1, "ref": "proyecto:charla", "tipo": "edicion", "titulo": "Una charla", "clip_id": "c01"}]}}
    assert nube.get("/editor/ed-9f1c0a7b/api/data").json()["copia"] == [{"titulo": "Una charla", "tipo": "edicion"}]


def test_el_titulo_de_la_persona_sale_como_texto_tal_cual(nube):
    """El título es texto de la persona: el servidor lo manda sin tocar y el editor lo asigna con textContent."""
    nube.docs["ed-9f1c0a7b"] = {"titulo": "<img src=x onerror=alert(1)>", "copia": {"version": 1, "de": []}}
    j = nube.get("/editor/ed-9f1c0a7b/api/data").json()
    assert j["titulo"] == "<img src=x onerror=alert(1)>" and j["copia"] == []


def test_una_copia_ajena_sigue_siendo_404(nube):
    assert nube.get("/editor/ed-de-otra/api/data").status_code == 404
