"""UI·7 — server/migracion.py: qué versión de cada pantalla ve cada quien.

Se prueba sobre una app de FastAPI de juguete con un static/ falso, para cada
etapa. El registro anti-pérdida (los invariantes que web/ tiene que cubrir)
vive en tests/test_migracion_ui.py.
"""
import base64
import json
import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server import migracion
from server.migracion import Pantalla


def _app(tmp_path, etapa, montada=True, con_vieja=True):
    static = tmp_path / "static"
    static.mkdir(exist_ok=True)
    if con_vieja:
        (static / "demo.html").write_text("<!doctype html><title>vieja</title>", encoding="utf-8")
    pantallas = {"demo": Pantalla(vieja="/demo.html", nueva="/estudio/demo/", etapa=etapa)}
    app = FastAPI()
    montadas = ["/estudio/assets", "/estudio/demo"] if montada else []
    orig = migracion.PANTALLAS
    migracion.PANTALLAS = pantallas
    try:
        migracion.montar(app, montadas, static)
    finally:
        migracion.PANTALLAS = orig
    # las vistas capturan su Pantalla al montarse; /ui/* la busca en cada
    # petición, así que el dict de juguete tiene que seguir puesto
    return app, pantallas


@pytest.fixture
def cliente(tmp_path, monkeypatch):
    def hacer(etapa, **kw):
        app, pantallas = _app(tmp_path, etapa, **kw)
        monkeypatch.setattr(migracion, "PANTALLAS", pantallas)
        return TestClient(app, follow_redirects=False)
    return hacer


def _token(sub):
    # un JWT sin firma válida: el log lo lee sin verificar, a propósito
    def b64(d):
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
    return f"{b64({'alg': 'RS256', 'typ': 'JWT'})}.{b64({'sub': sub})}.ZmlybWE"


# ---------- nueva: canario, la vieja no cambia ----------

def test_nueva_sirve_la_vieja_sin_redirigir(cliente):
    r = cliente("nueva").get("/demo.html?x=1")
    assert r.status_code == 200 and "vieja" in r.text
    assert r.headers["cache-control"] == "no-cache"


# ---------- todos: 302 salvo la cookie ----------

def test_todos_redirige_conservando_el_query_y_sin_cache(cliente):
    r = cliente("todos").get("/demo.html?p=abc&editar=1")
    assert r.status_code == 302
    assert r.headers["location"] == "/estudio/demo/?p=abc&editar=1"
    assert r.headers["cache-control"] == "no-store"


def test_todos_sin_query_no_deja_un_signo_colgando(cliente):
    assert cliente("todos").get("/demo.html").headers["location"] == "/estudio/demo/"


def test_todos_con_la_cookie_clasica_sirve_la_vieja(cliente):
    c = cliente("todos")
    c.cookies.set("ui", "clasica")
    r = c.get("/demo.html")
    assert r.status_code == 200 and "vieja" in r.text


def test_todos_sin_la_pantalla_compilada_no_manda_a_un_404(cliente):
    r = cliente("todos", montada=False).get("/demo.html")
    assert r.status_code == 200 and "vieja" in r.text


def test_cada_302_deja_el_sub_en_el_log(cliente, caplog):
    c = cliente("todos")
    c.cookies.set("token", _token("sub-123"))
    with caplog.at_level(logging.INFO, logger="migracion"):
        c.get("/demo.html")
    assert "migracion 302 pantalla=demo etapa=todos sub=sub-123" in caplog.text


def test_sin_token_o_con_token_roto_el_log_no_revienta(cliente, caplog):
    c = cliente("todos")
    with caplog.at_level(logging.INFO, logger="migracion"):
        assert c.get("/demo.html").status_code == 302
        c.cookies.set("token", "basura")
        assert c.get("/demo.html").status_code == 302
    assert "sub=anonimo" in caplog.text and "sub=?" in caplog.text


# ---------- retirada: 302 siempre ----------

def test_retirada_redirige_aunque_haya_cookie_y_no_exista_la_vieja(cliente):
    c = cliente("retirada", con_vieja=False)
    c.cookies.set("ui", "clasica")
    r = c.get("/demo.html?q=1")
    assert r.status_code == 302 and r.headers["location"] == "/estudio/demo/?q=1"


# ---------- /ui/clasica y /ui/nueva ----------

def test_usar_la_version_anterior_deja_la_cookie_y_lleva_a_la_vieja(cliente):
    c = cliente("todos")
    r = c.get("/ui/clasica?pantalla=demo")
    assert r.status_code == 302 and r.headers["location"] == "/demo.html"
    assert r.headers["cache-control"] == "no-store"
    galleta = r.headers["set-cookie"]
    assert "ui=clasica" in galleta and "HttpOnly" in galleta and "Path=/" in galleta
    assert f"Max-Age={7 * 24 * 3600}" in galleta
    # y con ella, la URL vieja ya no redirige
    r = c.get("/demo.html")
    assert r.status_code == 200 and "vieja" in r.text


def test_en_retirada_no_hay_version_anterior(cliente):
    r = cliente("retirada").get("/ui/clasica?pantalla=demo")
    assert r.headers["location"] == "/estudio/demo/"
    assert "set-cookie" not in r.headers


def test_una_pantalla_desconocida_va_al_estudio(cliente):
    c = cliente("todos")
    assert c.get("/ui/clasica?pantalla=nada").headers["location"] == "/estudio/"
    assert c.get("/ui/clasica").headers["location"] == "/estudio/"
    assert c.get("/ui/nueva?pantalla=nada").headers["location"] == "/estudio/"


def test_volver_a_la_nueva_borra_la_cookie(cliente):
    c = cliente("todos")
    c.get("/ui/clasica?pantalla=demo")
    r = c.get("/ui/nueva?pantalla=demo")
    assert r.headers["location"] == "/estudio/demo/"
    assert 'ui=""' in r.headers["set-cookie"] and "Max-Age=0" in r.headers["set-cookie"]
    assert c.get("/demo.html").status_code == 302


def test_una_etapa_mal_escrita_revienta_al_arrancar(tmp_path):
    with pytest.raises(ValueError, match="etapa desconocida"):
        _app(tmp_path, "todas")


# ---------- la app real ----------

def test_en_la_app_real_la_migracion_va_antes_que_la_raiz():
    import inspect

    from server import app as modulo
    fuente = inspect.getsource(modulo)
    assert fuente.index("migracion.montar(app, web.montar(app)") < fuente.index('app.mount("/", _StaticCacheado')


def test_las_pantallas_reales_estan_bien_escritas():
    for nombre, p in migracion.PANTALLAS.items():
        assert p.etapa in migracion.ETAPAS
        assert p.nueva == f"/estudio/{nombre}/"
        assert p.vieja.startswith("/")
        # la única URL vieja que no es un .html es el inicio: /estudio/
        assert p.vieja.endswith(".html") or (nombre == "inicio" and p.vieja == "/estudio/")
        assert p.archivo.endswith(".html")


# ---------- el inicio: su URL vieja es un directorio ----------

def _app_inicio(tmp_path, monkeypatch, etapa):
    static = tmp_path / "static"
    static.mkdir(exist_ok=True)
    (static / "index.html").write_text("<!doctype html><title>inicio viejo</title>", encoding="utf-8")
    pantallas = {"inicio": Pantalla(vieja="/estudio/", nueva="/estudio/inicio/", etapa=etapa,
                                    fichero="index.html")}
    monkeypatch.setattr(migracion, "PANTALLAS", pantallas)
    app = FastAPI()
    migracion.montar(app, ["/estudio/assets", "/estudio/inicio"], static)
    return TestClient(app, follow_redirects=False)


def test_el_inicio_en_nueva_sirve_su_index_sin_cache(tmp_path, monkeypatch):
    r = _app_inicio(tmp_path, monkeypatch, "nueva").get("/estudio/")
    assert r.status_code == 200 and "inicio viejo" in r.text
    assert r.headers["cache-control"] == "no-cache"


def test_el_inicio_en_todos_lleva_el_query_a_la_nueva(tmp_path, monkeypatch):
    # ?blotato=conectar (lo manda el editor) no se puede perder en el 302
    c = _app_inicio(tmp_path, monkeypatch, "todos")
    r = c.get("/estudio/?blotato=conectar")
    assert r.status_code == 302 and r.headers["location"] == "/estudio/inicio/?blotato=conectar"
    c.cookies.set("ui", "clasica")
    assert c.get("/estudio/").status_code == 200


def test_la_version_anterior_del_inicio_vuelve_a_estudio(tmp_path, monkeypatch):
    r = _app_inicio(tmp_path, monkeypatch, "todos").get("/ui/clasica?pantalla=inicio")
    assert r.status_code == 302 and r.headers["location"] == "/estudio/"
    assert "ui=clasica" in r.headers["set-cookie"]
