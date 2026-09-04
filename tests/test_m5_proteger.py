"""M5 — proteger el trabajo (backend): cierre de la deuda C5-4. El claim
atómico del estado en producir garantiza que dos clics ultrarrápidos no cobren
dos veces: solo uno gana el UPDATE condicionado; el 402 y el fallo de
lanzamiento revierten el claim. Sin red — base y jobs con monkeypatch."""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from pipeline import creditos, db, jobs


# ---------------------------------------------------------------------------
# db: el UPDATE condicionado y su reversa

def test_reclamar_produccion_es_update_condicionado(monkeypatch):
    capturado = {}
    monkeypatch.setattr(db, "ejecutar",
                        lambda s, p=None: capturado.update(sql=s, params=p) or [{"id": "x"}])
    assert db.reclamar_produccion("piloto", "x") is True
    assert "estado IN ('revision', 'error')" in capturado["sql"]
    assert "RETURNING" in capturado["sql"]


def test_reclamar_produccion_perdedor_recibe_false(monkeypatch):
    monkeypatch.setattr(db, "ejecutar", lambda s, p=None: [])
    assert db.reclamar_produccion("piloto", "x") is False


def test_liberar_produccion_solo_desde_produciendo(monkeypatch):
    capturado = {}
    monkeypatch.setattr(db, "ejecutar",
                        lambda s, p=None: capturado.update(sql=s, params=p) or [])
    db.liberar_produccion("piloto", "x", "revision")
    assert "estado = 'produciendo'" in capturado["sql"]
    assert capturado["params"]["e"] == "revision"


# ---------------------------------------------------------------------------
# endpoint producir: el claim manda antes que el cobro

def _proyecto_falso():
    return SimpleNamespace(
        id="p1", estado="revision", etapa="", error=None, progreso={},
        duracion_s=30, guion=[{"n": 1}], pipeline="escenas",
        tiene_guion=lambda: True,   # M11: el gate ahora pregunta por el método
        personaje=SimpleNamespace(url_elegida="opciones/a.png"),
        guardar=lambda: None)


@pytest.fixture
def entorno(monkeypatch):
    """Producir en modo AWS+postgres con todo espiado y nada lanzado."""
    from server import app as srv
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setattr(srv, "_proyecto", lambda id_: _proyecto_falso())
    monkeypatch.setattr(jobs, "backend", lambda: "aws")
    lanzados, cobros, devueltos, liberados = [], [], [], []
    monkeypatch.setattr(jobs, "lanzar_produccion", lambda u, i: lanzados.append(i))
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", lambda n, ref: cobros.append((n, ref)) or 0)
    monkeypatch.setattr(creditos, "devolver", lambda n, ref: devueltos.append((n, ref)) or n)
    monkeypatch.setattr(db, "liberar_produccion",
                        lambda u, i, e: liberados.append((i, e)))
    return SimpleNamespace(srv=srv, lanzados=lanzados, cobros=cobros,
                           devueltos=devueltos, liberados=liberados,
                           cliente=TestClient(srv.app, raise_server_exceptions=False))


def test_doble_clic_perdedor_409_sin_cobro(entorno, monkeypatch):
    monkeypatch.setattr(db, "reclamar_produccion", lambda u, i: False)
    r = entorno.cliente.post("/api/proyectos/p1/producir")
    assert r.status_code == 409 and "produciendo" in r.json()["detail"]
    assert not entorno.cobros and not entorno.lanzados


def test_ganador_cobra_y_lanza(entorno, monkeypatch):
    monkeypatch.setattr(db, "reclamar_produccion", lambda u, i: True)
    r = entorno.cliente.post("/api/proyectos/p1/producir")
    assert r.status_code == 200
    assert entorno.cobros == [(90, "producir:p1")]      # ceil(3 × 30 s)
    assert entorno.lanzados == ["p1"] and not entorno.liberados


def test_402_revierte_el_claim(entorno, monkeypatch):
    monkeypatch.setattr(db, "reclamar_produccion", lambda u, i: True)
    def sin_saldo(n, ref):
        raise creditos.SinSaldo(n, 5)
    monkeypatch.setattr(creditos, "cobrar", sin_saldo)
    r = entorno.cliente.post("/api/proyectos/p1/producir")
    assert r.status_code == 402
    assert entorno.liberados == [("p1", "revision")]    # otro intento es posible
    assert not entorno.lanzados


def test_fallo_de_lanzamiento_devuelve_y_libera(entorno, monkeypatch):
    monkeypatch.setattr(db, "reclamar_produccion", lambda u, i: True)
    def truena(u, i):
        raise RuntimeError("SFN caída")
    monkeypatch.setattr(jobs, "lanzar_produccion", truena)
    r = entorno.cliente.post("/api/proyectos/p1/producir")
    assert r.status_code == 500
    assert entorno.devueltos == [(90, "producir:p1")]
    assert entorno.liberados == [("p1", "revision")]


def test_dev_local_json_no_reclama(entorno, monkeypatch):
    monkeypatch.setenv("STATE_BACKEND", "json")
    monkeypatch.setattr(db, "reclamar_produccion",
                        lambda u, i: pytest.fail("dev local no toca Postgres"))
    r = entorno.cliente.post("/api/proyectos/p1/producir")
    assert r.status_code == 200 and entorno.lanzados == ["p1"]
