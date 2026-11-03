"""E2 — `.m4v` también es metraje.

Bug previo, verificado: `/api/media/presign` acepta `.m4v` (`media_api.EXTS`) pero
`shorts_api._fuente` no, así que un `.m4v` subido daba 404 «no tiene metraje» en
`/api/editar/<p>/costo` y `/sugerir`. Con E2 la caja acepta varios archivos y
`.m4v` es lo que sale del iPhone: el desfase se vuelve a notar.
"""
import pytest
from fastapi.testclient import TestClient

from pipeline import creditos, db, jobs
from server import editar_api, media_api, shorts_api


def test_fuente_devuelve_la_key_de_una_subida_m4v():
    doc = {"subidas": [{"key": "videos/v/subidas/clip.m4v", "bytes": 5}]}
    assert shorts_api._fuente(doc, "v") == "videos/v/subidas/clip.m4v"


@pytest.mark.parametrize("archivo", ["a.mp4", "a.MOV", "a.m4v", "a.M4V", "a.mkv", "a.webm"])
def test_fuente_acepta_todas_las_extensiones_de_video(archivo):
    assert shorts_api._fuente({"subidas": [{"key": f"videos/v/subidas/{archivo}"}]}, "v").endswith(archivo)


@pytest.mark.parametrize("archivo", ["a.avi", "a.txt", "a.png", "a"])
def test_fuente_no_toma_lo_que_no_es_video(archivo):
    assert shorts_api._fuente({"subidas": [{"key": f"videos/v/subidas/{archivo}"}]}, "v") is None


def test_lo_que_el_presign_acepta_la_fuente_tambien_lo_acepta():
    """Guardián contra el desfase: ninguna extensión de subida puede quedar sin metraje."""
    assert set(media_api.EXTS) <= set(shorts_api.VIDEO_EXT)


def test_un_m4v_subido_ya_se_cotiza_y_se_edita_en_el_flujo_viejo(monkeypatch):
    doc = {"subidas": [{"key": "videos/v/subidas/clip.m4v"}]}
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setattr(db, "backend", lambda: "postgres")
    monkeypatch.setattr(db, "usuario_actual", lambda: "u1")
    monkeypatch.setattr(editar_api, "_proyecto", lambda n: doc)
    monkeypatch.setattr(editar_api, "_duracion_s", lambda k: 360.0)
    monkeypatch.setattr(editar_api, "_con_transcript", lambda n: True)
    monkeypatch.setattr(creditos, "activo", lambda: False)
    monkeypatch.setattr(db, "fijar_campo_editor", lambda *a: None)
    monkeypatch.setattr(jobs, "lanzar_editar", lambda u, n: None)
    from server.app import app
    c = TestClient(app)
    r = c.get("/api/editar/v/costo")
    assert r.status_code == 200 and r.json()["fuente"] == "videos/v/subidas/clip.m4v"
    assert c.post("/api/editar/v/sugerir").status_code == 200
