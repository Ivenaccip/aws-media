"""C2 — backend de estado: selección json|postgres y repo sobre Data API.
Sin AWS real: se monkeypatchea pipeline.db.ejecutar / el repo completo."""
import json
from types import SimpleNamespace

import pytest

from pipeline import db, project


# ---------------------------------------------------------------------------
# _param: mapeo de tipos Python → parámetros del Data API

@pytest.mark.parametrize("valor,esperado", [
    (None, {"isNull": True}),
    (True, {"booleanValue": True}),
    (7, {"longValue": 7}),
    (1.5, {"doubleValue": 1.5}),
    ("hola", {"stringValue": "hola"}),
])
def test_param_tipos(valor, esperado):
    assert db._param("x", valor) == {"name": "x", "value": esperado}


def test_param_dict_serializa_json():
    p = db._param("doc", {"a": 1})
    assert json.loads(p["value"]["stringValue"]) == {"a": 1}


# ---------------------------------------------------------------------------
# backend: default json; postgres solo si el env lo pide

def test_backend_default_json(monkeypatch):
    monkeypatch.delenv("STATE_BACKEND", raising=False)
    assert db.backend() == "json"


def test_usuario_piloto_por_defecto(monkeypatch):
    monkeypatch.delenv("DEFAULT_USER_ID", raising=False)
    assert db.usuario_actual() == "piloto"


# ---------------------------------------------------------------------------
# repo: guardar hace upsert con user_id y asegura la fila de usuario

def test_guardar_proyecto_upsert(monkeypatch):
    llamadas = []
    monkeypatch.setattr(db, "ejecutar", lambda sql, params=None: llamadas.append((sql, params)) or [])
    db.guardar_proyecto("piloto", "abc123", "2026-09-01T10:00:00", "creado", "un brief", "{}")
    assert len(llamadas) == 2
    assert "ON CONFLICT (id) DO NOTHING" in llamadas[0][0]      # asegura usuario
    sql, params = llamadas[1]
    assert "ON CONFLICT (user_id, id) DO UPDATE" in sql
    assert params["u"] == "piloto" and params["i"] == "abc123"


# ---------------------------------------------------------------------------
# project.py: con postgres la fuente de verdad es el repo db

def _proyecto(tmp_path, monkeypatch):
    monkeypatch.setattr(project, "settings", SimpleNamespace(work_dir=tmp_path))
    return project.Proyecto(id="abc123", creado="2026-09-01T10:00:00",
                            brief="un brief", estado="creado")


def test_guardar_postgres_escribe_archivo_y_db(tmp_path, monkeypatch):
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    guardados = []
    monkeypatch.setattr(db, "guardar_proyecto", lambda *a: guardados.append(a))
    p = _proyecto(tmp_path, monkeypatch)
    p.guardar()
    assert (tmp_path / "abc123" / "proyecto.json").is_file()  # artefacto del pipeline
    (user_id, id_, _creado, estado, _brief, doc) = guardados[0]
    assert (user_id, id_, estado) == ("piloto", "abc123", "creado")
    assert json.loads(doc)["brief"] == "un brief"


def test_guardar_json_no_toca_db(tmp_path, monkeypatch):
    monkeypatch.delenv("STATE_BACKEND", raising=False)
    monkeypatch.setattr(db, "guardar_proyecto",
                        lambda *a: pytest.fail("no debe llamarse con backend json"))
    _proyecto(tmp_path, monkeypatch).guardar()


def test_cargar_y_listar_postgres(tmp_path, monkeypatch):
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    doc = _proyecto(tmp_path, monkeypatch).model_dump(mode="json")
    monkeypatch.setattr(db, "cargar_proyecto",
                        lambda u, i: doc if (u, i) == ("piloto", "abc123") else None)
    monkeypatch.setattr(db, "listar_proyectos", lambda u: [doc])
    assert project.cargar_proyecto("abc123").brief == "un brief"
    assert project.cargar_proyecto("nope") is None
    assert [p.id for p in project.listar_proyectos()] == ["abc123"]
