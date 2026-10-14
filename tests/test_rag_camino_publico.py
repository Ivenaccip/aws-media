"""RAG·1 y RAG·2 — el camino público de /automatiza.

RAG·1: dentro del camino público usuario_actual() revienta; un anónimo jamás
cae en el piloto. RAG·2: /api/publico/* entra sin token, con Cognito o sin él,
y solo server/publico_api.py puede colgar rutas ahí.
Sin red: Cognito va encendido por env y ningún token se verifica."""
import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from pipeline import db
from server import auth

MODULO_PUBLICO = "server.publico_api"


@pytest.fixture(autouse=True)
def _piloto_por_default(monkeypatch):
    # otros tests dejan DEFAULT_USER_ID puesto en el proceso; aquí se fija
    monkeypatch.setenv("DEFAULT_USER_ID", "piloto")


# ---------------------------------------------------------------------------
# RAG·1 — candado de identidad

def test_fuera_del_camino_publico_sigue_igual():
    assert not db.en_camino_publico()
    assert db.usuario_actual() == "piloto"


def test_dentro_del_camino_publico_revienta():
    with db.camino_publico():
        assert db.en_camino_publico()
        with pytest.raises(db.IdentidadEnCaminoPublico):
            db.usuario_actual()
    assert db.usuario_actual() == "piloto"          # el bloque lo suelta


def test_revienta_aunque_haya_usuario_fijado():
    # un token colado no rescata la llamada: el candado va primero
    marca = db.fijar_usuario("sub-abc")
    try:
        with db.camino_publico():
            with pytest.raises(db.IdentidadEnCaminoPublico):
                db.usuario_actual()
    finally:
        db._usuario_request.reset(marca)


def test_revienta_aunque_haya_default_user_id(monkeypatch):
    monkeypatch.setenv("DEFAULT_USER_ID", "otro")
    with db.camino_publico(), pytest.raises(db.IdentidadEnCaminoPublico):
        db.usuario_actual()


def test_el_candado_se_suelta_aunque_el_bloque_explote():
    with pytest.raises(ZeroDivisionError):
        with db.camino_publico():
            1 / 0
    assert not db.en_camino_publico()


def test_el_candado_no_se_filtra_entre_tareas():
    # dos peticiones a la vez en el mismo proceso: la pública no contagia a la otra
    async def publica(listo, seguir):
        with db.camino_publico():
            listo.set()
            await seguir.wait()
            return db.en_camino_publico()

    async def privada(listo, seguir):
        await listo.wait()
        r = db.en_camino_publico()
        seguir.set()
        return r

    async def ambas():
        listo, seguir = asyncio.Event(), asyncio.Event()
        return await asyncio.gather(publica(listo, seguir), privada(listo, seguir))

    assert asyncio.run(ambas()) == [True, False]


# ---------------------------------------------------------------------------
# RAG·2 — prefijo público en el middleware

def _app_de_prueba():
    app = FastAPI()
    app.middleware("http")(auth.middleware)

    @app.get("/api/publico/corrida/{cid}")
    def corrida(cid: str):                     # sync: corre en el threadpool
        return {"cid": cid, "publico": db.en_camino_publico(),
                "admin": auth.es_admin()}

    @app.get("/api/publico/fuga")
    def fuga():
        return {"user": db.usuario_actual()}

    @app.get("/api/privado")
    def privado():
        return {"user": db.usuario_actual(), "publico": db.en_camino_publico()}

    return app


@pytest.fixture
def cognito_env(monkeypatch):
    monkeypatch.setenv("COGNITO_POOL_ID", "us-east-1_TESTPOOL")
    monkeypatch.setenv("COGNITO_CLIENT_ID", "clienteweb123")


@pytest.mark.parametrize("ruta,publica", [
    ("/api/publico/", True),
    ("/api/publico/corrida/abc", True),
    ("/api/publico", False),                   # sin barra: no es la sección
    ("/api/publicos/x", False),
    ("/api/proyectos", False),
    ("/automatiza", False),                    # la página no pasa por aquí
])
def test_es_publica(ruta, publica):
    assert auth.es_publica(ruta) is publica


def test_publico_entra_sin_token_y_con_candado(cognito_env):
    r = TestClient(_app_de_prueba()).get("/api/publico/corrida/abc")
    assert r.status_code == 200
    assert r.json() == {"cid": "abc", "publico": True, "admin": False}


def test_publico_ignora_un_token_aunque_venga(cognito_env, monkeypatch):
    def no_verificar(_):
        raise AssertionError("el camino público no debe verificar tokens")
    monkeypatch.setattr(auth, "verificar", no_verificar)
    r = TestClient(_app_de_prueba()).get(
        "/api/publico/corrida/abc", headers={"Authorization": "Bearer x"})
    assert r.status_code == 200 and r.json()["publico"] is True


def test_publico_sin_cognito_tampoco_es_admin():
    # en local (sin Cognito) es_admin() es True para el dueño; para el anónimo no
    r = TestClient(_app_de_prueba()).get("/api/publico/corrida/abc")
    assert r.json()["admin"] is False


@pytest.mark.parametrize("con_cognito", [True, False])
def test_usuario_actual_en_endpoint_publico_es_500_no_piloto(con_cognito, monkeypatch):
    if con_cognito:
        monkeypatch.setenv("COGNITO_POOL_ID", "us-east-1_TESTPOOL")
        monkeypatch.setenv("COGNITO_CLIENT_ID", "clienteweb123")
    cliente = TestClient(_app_de_prueba(), raise_server_exceptions=False)
    r = cliente.get("/api/publico/fuga")
    assert r.status_code == 500
    assert "piloto" not in r.text


def test_lo_privado_sigue_pidiendo_token(cognito_env):
    r = TestClient(_app_de_prueba()).get("/api/privado")
    assert r.status_code == 401


def test_lo_privado_no_hereda_el_candado():
    r = TestClient(_app_de_prueba()).get("/api/privado")   # sin Cognito: piloto
    assert r.json() == {"user": "piloto", "publico": False}


def test_rodeo_con_puntos_no_llega_a_lo_privado(cognito_env):
    # /api/publico/../privado no se normaliza: no casa con /api/privado
    r = TestClient(_app_de_prueba()).get("/api/publico/%2E%2E/privado")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# RAG·2 — la guardia: nadie cuelga en el prefijo público una ruta con datos

def test_prefijos_publicos_solo_bajo_api_publico():
    for p in auth.PREFIJOS_PUBLICOS:
        assert p.startswith("/api/publico/") and p.endswith("/"), p


def test_ninguna_ruta_publica_ajena_a_publico_api():
    from server.app import app
    ajenas = []
    for ruta in app.routes:
        camino = getattr(ruta, "path", "")
        if not auth.es_publica(camino if camino.endswith("/") else camino + "/"):
            continue
        modulo = getattr(getattr(ruta, "endpoint", None), "__module__", "?")
        if modulo != MODULO_PUBLICO:
            ajenas.append((camino, modulo))
    assert not ajenas, f"rutas en el prefijo público fuera de {MODULO_PUBLICO}: {ajenas}"


def test_ninguna_ruta_publica_vieja_se_solapa():
    # las excepciones exactas de antes siguen siendo exactas y fuera del prefijo
    for r in auth.RUTAS_PUBLICAS:
        assert not auth.es_publica(r), r
