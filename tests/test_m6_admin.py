"""M6 — dashboard admin: gate por grupo de Cognito, agregados del resumen,
drill-down por corrida, sync de costes (CLI importable, worker programado y
botón del dashboard) y el alta de admins por CLI. Sin red."""
import importlib.util
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import tools.costes as costes_mod
from pipeline import db
from server import auth

REPO = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# es_admin: dev local abierto; en AWS manda el grupo del token

def test_es_admin_sin_cognito_dev_local(monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    assert auth.es_admin() is True


def test_es_admin_exige_grupo(monkeypatch):
    monkeypatch.setenv("COGNITO_POOL_ID", "us-east-1_TESTPOOL")
    marca = auth._grupos_request.set(())
    try:
        assert auth.es_admin() is False
    finally:
        auth._grupos_request.reset(marca)
    marca = auth._grupos_request.set(("admin",))
    try:
        assert auth.es_admin() is True
    finally:
        auth._grupos_request.reset(marca)


def test_middleware_fija_grupos_del_token(monkeypatch):
    monkeypatch.setenv("COGNITO_POOL_ID", "us-east-1_TESTPOOL")
    monkeypatch.setenv("COGNITO_CLIENT_ID", "clienteweb123")
    monkeypatch.setattr(auth, "verificar",
                        lambda t: {"sub": "sub-abc", "cognito:groups": ["admin"]})
    from server import app as srv
    visto = {}
    monkeypatch.setattr(srv, "listar_proyectos",
                        lambda: visto.setdefault("admin", auth.es_admin()) and [] or [])
    r = TestClient(srv.app).get("/api/proyectos", headers={"Authorization": "Bearer X"})
    assert r.status_code == 200 and visto["admin"] is True


# ---------------------------------------------------------------------------
# /api/admin/resumen — agregados y margen

def _ejecutar_resumen(sql, p=None):
    if "FROM monedero_movimientos" in sql:
        return [{"user_id": "a", "cargos": 100, "devoluciones": 10,
                 "comprados": 500, "cortesia": 200}]
    if "FROM monedero" in sql:
        return [{"user_id": "a", "saldo": 610}]
    if "FROM proyectos_gen" in sql:
        return [{"user_id": "a", "n": 3}]
    if "FROM costes" in sql:
        # el resumen agrupa por concepto: IA + la línea de infra de M6.1
        return [{"user_id": "a", "concepto": "run-llm", "usd": 1.0277},
                {"user_id": "a", "concepto": "infra-producir", "usd": 0.0223}]
    if "FROM usuarios" in sql:
        return [{"id": "a", "email": "a@x.com"}]
    raise AssertionError(f"query inesperada: {sql}")


@pytest.fixture
def cliente(monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)   # dev local: admin
    monkeypatch.delenv("MEDIA_BUCKET", raising=False)      # sin S3
    monkeypatch.setenv("STATE_BACKEND", "postgres")        # el dashboard lo exige
    from server.app import app
    return TestClient(app)


def test_dev_local_json_responde_503_explicado(monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.delenv("STATE_BACKEND", raising=False)
    from server.app import app
    r = TestClient(app).get("/api/admin/resumen")
    assert r.status_code == 503 and "Postgres" in r.json()["detail"]


def test_resumen_agrega_y_calcula_margen(cliente, monkeypatch):
    monkeypatch.setattr(db, "ejecutar", _ejecutar_resumen)
    d = cliente.get("/api/admin/resumen").json()
    u = d["usuarios"][0]
    assert u["email"] == "a@x.com" and u["saldo"] == 610
    assert u["gastados"] == 90                     # cargos 100 − devoluciones 10
    assert u["comprados"] == 500 and u["cortesia"] == 200 and u["peliculas"] == 3
    assert u["costo_usd"] == 1.05
    assert u["margen_usd"] == round(90 * d["piso_venta_usd"] - 1.05, 4)
    # el tiempo de Fargate se deriva de la línea infra-producir ($0.0223 ≈ 407 s)
    assert 400 <= u["fargate_s"] <= 410
    assert d["totales"]["gastados"] == 90
    assert d["totales"]["fargate_s"] == u["fargate_s"]


def test_trazas_sin_usuario_se_muestran_como_claude(cliente, monkeypatch):
    """Las trazas pre-C6 (user '?') son nuestras corridas de desarrollo."""
    def ejecutar(sql, p=None):
        if "FROM costes" in sql:
            return [{"user_id": "?", "usd": 3.31}]
        return []
    monkeypatch.setattr(db, "ejecutar", ejecutar)
    u = cliente.get("/api/admin/resumen").json()["usuarios"][0]
    assert u["user_id"] == "?" and u["email"] == "Claude IA (desarrollo)"
    assert u["margen_usd"] == -3.31          # puro costo nuestro, sin créditos


def test_resumen_403_sin_grupo(cliente, monkeypatch):
    monkeypatch.setattr(auth, "es_admin", lambda: False)
    assert cliente.get("/api/admin/resumen").status_code == 403
    assert cliente.get("/api/admin/usuarios/a").status_code == 403
    assert cliente.post("/api/admin/costes/sync").status_code == 403


def test_detalle_por_corrida(cliente, monkeypatch):
    def ejecutar(sql, p=None):
        if "FROM proyectos_gen" in sql:
            return [{"id": "p1", "creado": "2026-09-01", "estado": "listo",
                     "brief": "tesla", "duracion_s": "30"}]
        if "FROM monedero_movimientos" in sql:
            return [{"pid": "p1", "neto": 100}]
        if "FROM costes" in sql:
            return [{"proyecto_id": "p1", "concepto": "run", "costo_usd": 0.9,
                     "traza": "tr-1", "creado": "2026-09-01"},
                    {"proyecto_id": "p1", "concepto": "infra-producir",
                     "costo_usd": 0.0223, "traza": None, "creado": "2026-09-01"},
                    {"proyecto_id": None, "concepto": "suelta", "costo_usd": 0.1,
                     "traza": "tr-2", "creado": "2026-09-01"}]
        raise AssertionError(sql)
    monkeypatch.setattr(db, "ejecutar", ejecutar)
    d = cliente.get("/api/admin/usuarios/a").json()
    p = d["proyectos"][0]
    assert p["creditos"] == 100 and p["costo_usd"] == 0.9223
    assert p["trazas"][0]["traza"] == "tr-1"
    # la línea de infra trae el tiempo de cómputo de ESTA tarea; las de IA no
    assert p["trazas"][0]["segundos"] is None
    assert 400 <= p["trazas"][1]["segundos"] <= 410
    assert d["sin_proyecto"][0]["traza"] == "tr-2"


def test_boton_sync_llama_sincronizar(cliente, monkeypatch):
    monkeypatch.setattr(costes_mod, "sincronizar", lambda dias: 4)
    r = cliente.post("/api/admin/costes/sync?dias=7")
    assert r.status_code == 200 and r.json()["nuevas"] == 4


# ---------------------------------------------------------------------------
# sincronizar: idempotente por trace id, ignora trazas sin costo

def test_sincronizar_idempotente(monkeypatch):
    insertadas = []
    def ejecutar(sql, p=None):
        if sql.startswith("SELECT traza"):
            return [{"traza": "vieja"}]
        insertadas.append(p)
        return []
    monkeypatch.setattr(db, "ejecutar", ejecutar)
    trazas = [
        {"id": "vieja", "totalCost": 1.0, "userId": "a"},        # ya en la tabla
        {"id": "gratis", "totalCost": 0, "userId": "a"},         # sin costo
        {"id": "nueva", "totalCost": 0.5, "userId": "a", "sessionId": "p1", "name": "run"},
    ]
    assert costes_mod.sincronizar(trazas=trazas) == 1
    assert insertadas == [{"u": "a", "p": "p1", "c": "run", "usd": 0.5, "t": "nueva"}]


def test_worker_despacha_sync_costes(monkeypatch):
    from worker import lambda_worker
    llamado = {}
    monkeypatch.setattr(costes_mod, "sincronizar",
                        lambda dias: llamado.setdefault("dias", dias) or 2)
    assert lambda_worker.handler({"tipo": "sync_costes", "dias": 5}, None) == {"ok": True}
    assert llamado["dias"] == 5


# ---------------------------------------------------------------------------
# tools/usuarios.py admin <correo>

def test_usuarios_admin_agrega_al_grupo(monkeypatch):
    spec = importlib.util.spec_from_file_location("usuarios_m6", REPO / "tools" / "usuarios.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    llamadas = []
    class Falso:
        def admin_add_user_to_group(self, **kw):
            llamadas.append(kw)
    monkeypatch.setattr(mod, "_cognito", lambda pool=None: Falso())
    mod.admin("us-east-1_TESTPOOL", "x@y.com")
    assert llamadas == [{"UserPoolId": "us-east-1_TESTPOOL",
                         "Username": "x@y.com", "GroupName": "admin"}]
