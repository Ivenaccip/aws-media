"""M16.2 — pista 2 (recursos IA) del editor en la nube: /api/overlays lee
work/overlays.json de S3 en vez de resolver el proyecto en disco local."""
import json

import pytest
from fastapi.testclient import TestClient

from pipeline import db, media_sync


@pytest.fixture
def nube(monkeypatch, tmp_path):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setenv("CDN_BASE", "https://cdn.example.com")
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    docs = {"gen-abc": {"flags": {"cuts": True}}}
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: docs.get(n))
    from server.app import app
    return TestClient(app)


OVERLAYS = {"version": 1, "estilo_prompt": "flat", "pista_unica": True,
            "overlays": [{"id": "1", "t_in": 0.0, "t_out": 7.0,
                          "narracion": "uno", "version_activa": 1,
                          "versiones": [{"n": 1, "video": "overlays/1/v1.mp4"}]}],
            "gastos": [{"tipo": "video", "overlay": "1", "usd": 0.4}]}


def test_overlays_nube_desde_s3(nube, monkeypatch):
    monkeypatch.setattr(media_sync, "leer_texto",
                        lambda key: json.dumps(OVERLAYS)
                        if key == "videos/gen-abc/work/overlays.json" else None)
    j = nube.get("/editor/gen-abc/api/overlays").json()
    assert j["pista_unica"] is True and len(j["overlays"]) == 1
    assert j["costo_overlays"] == 0.4 and "backend" in j


def test_overlays_nube_sin_json_pista_vacia(nube, monkeypatch):
    monkeypatch.setattr(media_sync, "leer_texto", lambda key: None)
    j = nube.get("/editor/gen-abc/api/overlays").json()
    assert j["overlays"] == [] and j["costo_overlays"] == 0.0


def test_overlays_nube_404_proyecto_ajeno(nube):
    assert nube.get("/editor/gen-otro/api/overlays").status_code == 404
