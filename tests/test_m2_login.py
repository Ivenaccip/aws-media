"""M2 — login: identidad por-request (contextvar), verificación del id_token,
middleware que exige el JWT en /api/* y /editor/* (header o cookie) y
tools/usuarios.py (alta con cortesía, suspender con revocación, adoptar).
Sin red — Cognito y la Data API van con monkeypatch; la firma RS256 es real."""
import importlib.util
import time
from pathlib import Path
from types import SimpleNamespace

import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from pipeline import db
from server import auth

REPO = Path(__file__).resolve().parent.parent
POOL = "us-east-1_TESTPOOL"
CLIENTE = "clienteweb123"


# ---------------------------------------------------------------------------
# identidad por-request

def test_usuario_actual_contextvar():
    assert db.usuario_actual() == "piloto"          # sin request: cae al default
    marca = db.fijar_usuario("sub-abc")
    assert db.usuario_actual() == "sub-abc"
    db._usuario_request.reset(marca)
    assert db.usuario_actual() == "piloto"


# ---------------------------------------------------------------------------
# verificación del id_token (firma RS256 real, JWKS falso)

@pytest.fixture
def cognito_env(monkeypatch):
    monkeypatch.setenv("COGNITO_POOL_ID", POOL)
    monkeypatch.setenv("COGNITO_CLIENT_ID", CLIENTE)


@pytest.fixture
def llave():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _token(llave, **extra):
    claims = {"sub": "sub-abc", "aud": CLIENTE, "token_use": "id",
              "iss": f"https://cognito-idp.us-east-1.amazonaws.com/{POOL}",
              "exp": int(time.time()) + 3600, "email": "x@y.com"}
    claims.update(extra)
    return pyjwt.encode(claims, llave, algorithm="RS256")


def _jwks_falso(monkeypatch, llave):
    falso = SimpleNamespace(get_signing_key_from_jwt=lambda t: SimpleNamespace(key=llave.public_key()))
    monkeypatch.setattr(auth, "_jwks", lambda: falso)


def test_verificar_acepta_id_token_valido(cognito_env, llave, monkeypatch):
    _jwks_falso(monkeypatch, llave)
    claims = auth.verificar(_token(llave))
    assert claims["sub"] == "sub-abc" and claims["email"] == "x@y.com"


@pytest.mark.parametrize("extra", [
    {"token_use": "access"},                       # solo id_token
    {"exp": int(time.time()) - 10},                # vencido
    {"aud": "otro-cliente"},                       # de otro client
    {"iss": "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_OTRO"},
])
def test_verificar_rechaza(cognito_env, llave, monkeypatch, extra):
    _jwks_falso(monkeypatch, llave)
    with pytest.raises(Exception):
        auth.verificar(_token(llave, **extra))


def test_verificar_rechaza_firma_ajena(cognito_env, llave, monkeypatch):
    _jwks_falso(monkeypatch, llave)
    otra = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(Exception):
        auth.verificar(_token(otra))


# ---------------------------------------------------------------------------
# middleware: exige token en /api/* (header o cookie), config queda público

@pytest.fixture
def cliente(cognito_env, monkeypatch):
    from server.app import app
    monkeypatch.setattr(auth, "verificar",
                        lambda t: {"sub": "sub-abc"} if t == "BUENO" else (_ for _ in ()).throw(ValueError(t)))
    return TestClient(app)


def test_api_sin_token_401(cliente):
    r = cliente.get("/api/estilos")
    assert r.status_code == 401 and "sesión" in r.json()["detail"].lower()


def test_api_con_bearer_pasa_y_fija_usuario(cliente, monkeypatch):
    from server import app as srv
    visto = {}
    monkeypatch.setattr(srv, "listar_proyectos",
                        lambda: visto.setdefault("u", db.usuario_actual()) and [] or [])
    r = cliente.get("/api/proyectos", headers={"Authorization": "Bearer BUENO"})
    assert r.status_code == 200
    assert visto["u"] == "sub-abc"                 # el sub llegó a usuario_actual()


def test_api_con_cookie_pasa(cliente):
    r = cliente.get("/api/estilos", cookies={"token": "BUENO"})
    assert r.status_code == 200


def test_api_token_invalido_401(cliente):
    r = cliente.get("/api/estilos", headers={"Authorization": "Bearer MALO"})
    assert r.status_code == 401 and "venció" in r.json()["detail"]


def test_navegacion_html_sin_token_redirige_a_portada(cliente):
    r = cliente.get("/editor/x", headers={"Accept": "text/html"}, follow_redirects=False)
    assert r.status_code in (302, 307) and r.headers["location"] == "/"


def test_auth_config_es_publico(cliente, monkeypatch):
    monkeypatch.setenv("COGNITO_DOMINIO", "media-ivenaccip.auth.us-east-1.amazoncognito.com")
    r = cliente.get("/api/auth/config")
    assert r.status_code == 200
    d = r.json()
    assert d["activo"] is True and d["client_id"] == CLIENTE and "amazoncognito" in d["dominio"]


def test_estaticos_quedan_publicos(cliente):
    assert cliente.get("/callback.html").status_code == 200


def test_sin_cognito_todo_pasa_como_piloto(monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    from server.app import app
    r = TestClient(app).get("/api/estilos")
    assert r.status_code == 200                    # dev local: sin login, como siempre


# ---------------------------------------------------------------------------
# tools/usuarios.py

@pytest.fixture
def usuarios_mod():
    spec = importlib.util.spec_from_file_location("usuarios_m2", REPO / "tools" / "usuarios.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class CognitoFalso:
    def __init__(self):
        self.llamadas = []

    def admin_create_user(self, **kw):
        self.llamadas.append(("create", kw))
        return {"User": {"Attributes": [{"Name": "sub", "Value": "sub-nuevo"}]}}

    def admin_get_user(self, **kw):
        self.llamadas.append(("get", kw))
        return {"UserAttributes": [{"Name": "sub", "Value": "sub-nuevo"}]}

    def admin_disable_user(self, **kw):
        self.llamadas.append(("disable", kw))

    def admin_user_global_sign_out(self, **kw):
        self.llamadas.append(("signout", kw))


@pytest.mark.parametrize("plan,esperado", [("mensual", 100), ("anual", 200)])
def test_alta_crea_en_cognito_y_abona_cortesia(usuarios_mod, monkeypatch, plan, esperado):
    falso = CognitoFalso()
    monkeypatch.setattr(usuarios_mod, "_cognito", lambda pool=None: falso)
    abonos, sqls = [], []
    monkeypatch.setattr(db, "ejecutar", lambda sql, p=None: sqls.append(sql) or [])
    monkeypatch.setattr(db, "abonar_creditos",
                        lambda u, n, t, r=None: abonos.append((u, n, t, r)) or n)
    sub = usuarios_mod.alta(POOL, "nuevo@x.com", plan)
    assert sub == "sub-nuevo"
    kw = falso.llamadas[0][1]
    assert kw["Username"] == "nuevo@x.com" and kw["DesiredDeliveryMediums"] == ["EMAIL"]
    assert "MessageAction" not in kw               # invitación nueva, no RESEND
    assert abonos == [("sub-nuevo", esperado, "cortesia", f"alta-{plan}")]
    assert any("INSERT INTO usuarios" in s for s in sqls)


def test_alta_reenviar_no_vuelve_a_abonar(usuarios_mod, monkeypatch):
    falso = CognitoFalso()
    monkeypatch.setattr(usuarios_mod, "_cognito", lambda pool=None: falso)
    monkeypatch.setattr(db, "abonar_creditos",
                        lambda *a, **k: pytest.fail("reenviar NO re-abona cortesía"))
    usuarios_mod.alta(POOL, "nuevo@x.com", "mensual", reenviar=True)
    assert falso.llamadas[0][1]["MessageAction"] == "RESEND"


def test_suspender_deshabilita_y_revoca_sesiones(usuarios_mod, monkeypatch):
    falso = CognitoFalso()
    monkeypatch.setattr(usuarios_mod, "_cognito", lambda pool=None: falso)
    usuarios_mod.suspender(POOL, "churn@x.com")
    assert [n for n, _ in falso.llamadas] == ["disable", "signout"]


def test_adoptar_migra_tablas_y_saldo(usuarios_mod, monkeypatch):
    falso = CognitoFalso()
    monkeypatch.setattr(usuarios_mod, "_cognito", lambda pool=None: falso)
    sqls, abonos = [], []
    monkeypatch.setattr(db, "ejecutar", lambda sql, p=None: sqls.append((sql, p)) or [])
    monkeypatch.setattr(db, "saldo_creditos", lambda u: 70 if u == "piloto" else 170)
    monkeypatch.setattr(db, "abonar_creditos",
                        lambda u, n, t, r=None: abonos.append((u, n, t, r)) or n)
    usuarios_mod.adoptar(POOL, "ivenaccip@gmail.com", "piloto")
    actualizadas = [p for s, p in sqls if s.startswith("UPDATE")]
    assert len(actualizadas) == 6 and all(p == {"n": "sub-nuevo", "v": "piloto"} for p in actualizadas)
    # las reservas de nombre viajan con los proyectos del editor
    assert any("UPDATE nombres_editor" in s for s, _ in sqls)
    assert ("sub-nuevo", 70, "ajuste", "adopcion:piloto") in abonos
    assert ("piloto", -70, "ajuste", "adopcion:sub-nuevo") in abonos


def test_cortesia_sale_de_tarifas_json(usuarios_mod):
    import json
    tarifas = json.loads((REPO / "tools" / "tarifas.json").read_text(encoding="utf-8"))
    assert usuarios_mod.cortesia("mensual") == tarifas["cortesia_mensual"]["mensual"]
    assert usuarios_mod.cortesia("anual") == tarifas["cortesia_mensual"]["anual"]
