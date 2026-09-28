"""UI·26 — «Mis videos» del inicio junta películas, clips y shorts. Lo que el
servidor pone para eso: el `modo` de cada película (Video largo o Cuento), y
de cada proyecto del editor su fecha y un resumen de sus shorts. Sin red ni
Postgres: el backend se finge con monkeypatch."""
import pytest
from fastapi.testclient import TestClient

from pipeline import db
from pipeline.project import Proyecto


@pytest.fixture
def srv():
    from server import app as srv
    return srv


def test_cada_pelicula_trae_su_modo(srv, monkeypatch):
    monkeypatch.setattr(srv, "listar_proyectos", lambda: [
        Proyecto(id="a", creado="2026-09-05T00:00:00", brief="x", modo="investigacion"),
        Proyecto(id="b", creado="2026-09-05T00:00:00", brief="y", modo="idea"),
        Proyecto(id="c", creado="2026-09-05T00:00:00", brief="z"),
    ])
    filas = TestClient(srv.app).get("/api/proyectos").json()
    assert [f["modo"] for f in filas] == ["investigacion", "idea", "auto"]


@pytest.mark.parametrize("doc,estado", [
    ({"importar": {"estado": "descargando"}}, "corriendo"),
    ({"importar": {"estado": "listo"}, "shorts": {"estado": "analizando"}}, "corriendo"),
    ({"shorts": {"estado": "candidatos", "render": {"estado": "corriendo"}}}, "corriendo"),
    ({"shorts": {"estado": "candidatos", "render": {"estado": "listo", "salidas": [{}, {}]}}}, "listo"),
    ({"importar": {"estado": "error"}}, "error"),
    ({"shorts": {"estado": "error"}}, "error"),
    ({"shorts": {"estado": "candidatos", "render": {"estado": "error"}}}, "error"),
    ({"importar": {"estado": "listo"}}, "espera"),
    ({"shorts": {"estado": "candidatos"}}, "espera"),
])
def test_resumen_de_shorts_por_estado(srv, doc, estado):
    assert srv.resumen_shorts(doc)["estado"] == estado


def test_sin_importar_ni_shorts_no_es_un_short(srv):
    """Un metraje subido solo para el corte sigue en «Mis ediciones», no aquí."""
    assert srv.resumen_shorts({"subidas": [{"key": "videos/v/a.mp4"}], "editar": {"estado": "listo"}}) is None


def test_resumen_trae_titulo_inicio_y_cuantos_sin_el_doc_entero(srv):
    r = srv.resumen_shorts({
        "importar": {"estado": "listo", "titulo": "Mi charla", "inicio": "2026-09-20T10:00:00+00:00"},
        "shorts": {"estado": "candidatos", "inicio": "2026-09-21T10:00:00+00:00",
                   "candidatos": [{"texto": "largo"}],
                   "render": {"estado": "listo", "log": "…", "salidas": [{"url": "https://x"}] * 3}},
    })
    assert r == {"estado": "listo", "titulo": "Mi charla", "inicio": "2026-09-20T10:00:00+00:00", "cuantos": 3}


def test_listado_del_editor_trae_fecha_y_shorts(monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setattr(db, "listar_proyectos_editor", lambda u: [
        {"nombre": "yt-abc", "creado": "2026-09-20T10:00:00Z",
         "doc": {"importar": {"estado": "descargando", "titulo": "Charla"}}},
        {"nombre": "video-1", "creado": "2026-09-19T10:00:00Z", "doc": {"subidas": [{"key": "k"}]}},
    ])
    from server.app import app
    filas = {p["nombre"]: p for p in TestClient(app).get("/api/edicion/proyectos").json()}
    assert filas["yt-abc"]["creado"] == "2026-09-20T10:00:00Z"
    assert filas["yt-abc"]["shorts"]["estado"] == "corriendo"
    assert filas["video-1"]["shorts"] is None


@pytest.mark.parametrize("crudo,iso", [
    ("2026-09-28 17:29:13.123", "2026-09-28T17:29:13.123Z"),
    ("2026-09-28T17:29:13+00:00", "2026-09-28T17:29:13+00:00"),
    ("2026-09-28T17:29:13Z", "2026-09-28T17:29:13Z"),
    (None, None),
    ("", None),
])
def test_la_fecha_del_data_api_sale_en_iso_con_zona(crudo, iso):
    assert db._iso(crudo) == iso


def test_listar_proyectos_editor_pide_y_entrega_la_fecha(monkeypatch):
    visto = {}

    def ejecutar(sql, params=None):
        visto["sql"] = sql
        return [{"nombre": "v", "creado": "2026-09-28 17:29:13", "doc": "{}"}]

    monkeypatch.setattr(db, "ejecutar", ejecutar)
    assert db.listar_proyectos_editor("u") == [{"nombre": "v", "creado": "2026-09-28T17:29:13Z", "doc": {}}]
    assert "creado" in visto["sql"].split("FROM")[0]
