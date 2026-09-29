"""RAG·5 — interruptor y tope diario de /automatiza.

El freno falla CERRADO (sin fila, sin tope, o sin base = no disponible), el
interruptor es una fila que se agrega sin desplegar, el worker no gasta si
se apagó, y /api/publico/estado no dice por qué está cerrado."""
import pytest
from fastapi.testclient import TestClient

from pipeline import db, publico
from worker import publico as worker_publico


def _base(monkeypatch, ajuste, corridas=0, usd=0.0, de_ip=0):
    monkeypatch.setattr(db, "automatiza_interruptor", lambda: ajuste)
    monkeypatch.setattr(db, "automatiza_consumo_hoy",
                        lambda: {"corridas": corridas, "usd": usd})
    monkeypatch.setattr(db, "automatiza_corridas_de_ip_hoy", lambda h: de_ip)


def _ajuste(encendido=True, corridas=10, usd=None):
    return {"encendido": encendido, "tope_corridas": corridas, "tope_usd": usd,
            "nota": None, "creado": "x"}


# ---------------------------------------------------------------------------
# permiso()

def test_sin_fila_esta_apagado(monkeypatch):
    _base(monkeypatch, None)
    assert publico.permiso("h") == publico.APAGADO


def test_apagado(monkeypatch):
    _base(monkeypatch, _ajuste(encendido=False))
    assert publico.permiso("h") == publico.APAGADO


def test_encendido_sin_ningun_tope_cuenta_como_apagado(monkeypatch):
    _base(monkeypatch, _ajuste(corridas=None, usd=None))
    assert publico.permiso("h") == publico.APAGADO


@pytest.mark.parametrize("corridas,esperado", [(9, None), (10, "tope"), (11, "tope")])
def test_tope_de_corridas(monkeypatch, corridas, esperado):
    _base(monkeypatch, _ajuste(corridas=10), corridas=corridas)
    assert publico.permiso("h") == esperado


def test_tope_en_dolares(monkeypatch):
    _base(monkeypatch, _ajuste(corridas=None, usd=5.0), corridas=999, usd=4.99)
    assert publico.permiso("h") is None
    _base(monkeypatch, _ajuste(corridas=None, usd=5.0), usd=5.0)
    assert publico.permiso("h") == publico.TOPE


def test_cualquiera_de_los_dos_topes_frena(monkeypatch):
    _base(monkeypatch, _ajuste(corridas=100, usd=1.0), corridas=3, usd=1.5)
    assert publico.permiso("h") == publico.TOPE


@pytest.mark.parametrize("donde", ["interruptor", "consumo"])
def test_si_la_base_falla_se_cierra(monkeypatch, donde):
    _base(monkeypatch, _ajuste())

    def truena():
        raise db.DespertandoError("la base de datos sigue despertando")
    monkeypatch.setattr(db, "automatiza_interruptor" if donde == "interruptor"
                        else "automatiza_consumo_hoy", truena)
    assert publico.permiso("h") == publico.APAGADO


def test_encendido_del_worker_falla_cerrado(monkeypatch):
    def truena():
        raise RuntimeError("x")
    monkeypatch.setattr(db, "automatiza_interruptor", truena)
    assert publico.encendido() is False
    monkeypatch.setattr(db, "automatiza_interruptor", lambda: None)
    assert publico.encendido() is False


# ---------------------------------------------------------------------------
# la fila: se agrega, hereda lo no dicho, y sin previa nace apagada

@pytest.fixture
def sql(monkeypatch):
    llamadas, vigente = [], {"fila": None}

    def falso(q, params=None):
        q = " ".join(q.split())
        llamadas.append((q, params or {}))
        if q.startswith("SELECT encendido"):
            return [vigente["fila"]] if vigente["fila"] else []
        return []
    monkeypatch.setattr(db, "ejecutar", falso)
    return llamadas, vigente


def test_ajustar_sin_fila_previa_nace_apagada(sql):
    llamadas, _ = sql
    db.automatiza_ajustar(tope_corridas=5)
    ins = next(p for q, p in llamadas if q.startswith("INSERT INTO automatiza_interruptor"))
    assert ins == {"e": False, "c": 5, "u": None, "i": None, "n": None}


def test_ajustar_hereda_lo_no_dicho(sql):
    llamadas, vigente = sql
    vigente["fila"] = {"encendido": True, "tope_corridas": 50, "tope_usd": "10.00",
                       "nota": None, "creado": "x"}
    db.automatiza_ajustar(encendido=False, nota="bots")
    ins = next(p for q, p in llamadas if q.startswith("INSERT INTO automatiza_interruptor"))
    assert ins == {"e": False, "c": 50, "u": 10.0, "i": None, "n": "bots"}


def test_ajustar_puede_quitar_el_tope_en_dolares(sql):
    llamadas, vigente = sql
    vigente["fila"] = {"encendido": True, "tope_corridas": 50, "tope_usd": "10.00",
                       "nota": None, "creado": "x"}
    db.automatiza_ajustar(sin_tope_usd=True)
    ins = next(p for q, p in llamadas if q.startswith("INSERT INTO automatiza_interruptor"))
    assert ins["u"] is None and ins["c"] == 50


def test_el_interruptor_nunca_se_edita():
    import re
    fuente = open(db.__file__, encoding="utf-8").read()
    assert not re.search(r"(UPDATE|DELETE FROM)\s+automatiza_interruptor", fuente)


def test_consumo_cuenta_el_dia_de_mexico_sin_rechazadas(sql):
    llamadas, _ = sql
    db.automatiza_consumo_hoy()
    q = llamadas[0][0]
    assert "estado <> 'rechazada'" in q
    assert "AT TIME ZONE 'America/Mexico_City'" in q
    assert "sum(costo_usd)" in q                    # gasto real, nada inventado


# ---------------------------------------------------------------------------
# el worker no gasta si se apagó con la corrida en la fila

def test_worker_apagado_cierra_sin_armar(monkeypatch):
    cerradas = []
    monkeypatch.setattr(db, "automatiza_tomar", lambda i: True)
    monkeypatch.setattr(db, "automatiza_cerrar",
                        lambda i, e, **kw: cerradas.append((e, kw)) or True)
    monkeypatch.setattr(publico, "encendido", lambda: False)
    monkeypatch.setattr(worker_publico, "armar",
                        lambda c: pytest.fail("no debe armar con el interruptor apagado"))
    assert worker_publico.procesar(1) == "apagado"
    assert cerradas == [("no_salio", {"motivo": "apagado"})]


def test_worker_encendido_arma(monkeypatch):
    monkeypatch.setattr(db, "automatiza_tomar", lambda i: True)
    monkeypatch.setattr(db, "automatiza_cerrar", lambda i, e, **kw: True)
    monkeypatch.setattr(publico, "encendido", lambda: True)
    assert worker_publico.procesar(1) == "listo"


# ---------------------------------------------------------------------------
# GET /api/publico/estado

@pytest.fixture
def cliente(monkeypatch):
    monkeypatch.setenv("COGNITO_POOL_ID", "us-east-1_TESTPOOL")   # con login exigido
    monkeypatch.setenv("COGNITO_CLIENT_ID", "clienteweb123")
    from server.app import app
    return TestClient(app)


@pytest.mark.parametrize("motivo,disponible", [(None, True), ("apagado", False), ("tope", False)])
def test_estado_publico_sin_token_y_sin_motivo(cliente, monkeypatch, motivo, disponible):
    monkeypatch.setattr(publico, "permiso", lambda *a, **k: motivo)
    r = cliente.get("/api/publico/estado")
    assert r.status_code == 200
    assert r.json() == {"disponible": disponible}     # nunca dice cuál tope ni cuánto


def test_rutas_de_publico_api_son_las_conocidas():
    # una ruta pública nueva es una decisión, no un efecto secundario: RAG·8
    # agregó el recorrido de la corrida; la siguiente se anota aquí a propósito
    from server.publico_api import router
    assert sorted((r.path, tuple(sorted(r.methods))) for r in router.routes) == [
        ("/api/publico/corridas", ("POST",)),
        ("/api/publico/corridas/{publico_id}", ("GET",)),
        ("/api/publico/corridas/{publico_id}/flujo.json", ("GET",)),
        ("/api/publico/estado", ("GET",)),
    ]
