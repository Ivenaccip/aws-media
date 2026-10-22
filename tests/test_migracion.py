"""UI·7 — server/migracion.py: qué versión de cada pantalla ve cada quien.

Se prueba sobre una app de FastAPI de juguete con un static/ falso, para cada
etapa. El registro anti-pérdida (los invariantes que web/ tiene que cubrir)
vive en tests/test_migracion_ui.py.
"""
import base64
import json
import logging
from pathlib import Path

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
    raiz = Path(__file__).resolve().parent.parent
    for nombre, p in migracion.PANTALLAS.items():
        assert p.etapa in migracion.ETAPAS
        # la URL nueva es una página de /estudio/ a CUALQUIER profundidad (la principal es /estudio/ misma) y su
        # carpeta existe en web/ (las fuentes: el dist las repite tal cual)
        assert p.nueva.startswith("/estudio/") and p.nueva.endswith("/"), nombre
        assert (raiz / "web" / p.nueva.strip("/") / "index.html").is_file(), nombre
        assert p.vieja.startswith("/") and p.vieja != p.nueva, nombre
        # la vieja siempre es un .html: la que fue /estudio/ misma (el inicio) vive ahora en /index.html
        assert p.vieja.endswith(".html"), nombre
        assert p.archivo.endswith(".html")
    inicio = migracion.PANTALLAS["inicio"]
    assert (inicio.vieja, inicio.nueva, inicio.etapa) == ("/index.html", "/estudio/", "todos")
    assert inicio.archivo == "index.html" and (raiz / "static" / inicio.archivo).is_file()


# ---------- el inicio: la principal es /estudio/ y el clásico queda en /index.html ----------

def _app_inicio(tmp_path, monkeypatch, etapa, montada=True):
    static = tmp_path / "static"
    static.mkdir(exist_ok=True)
    (static / "index.html").write_text("<!doctype html><title>inicio viejo</title>", encoding="utf-8")
    pantallas = {"inicio": Pantalla(vieja="/index.html", nueva="/estudio/", etapa=etapa)}
    monkeypatch.setattr(migracion, "PANTALLAS", pantallas)
    app = FastAPI()
    # lo que web.montar anuncia cuando dist trae estudio/index.html (la principal)
    migracion.montar(app, ["/estudio/assets", "/estudio"] if montada else [], static)
    return TestClient(app, follow_redirects=False)


def test_el_inicio_en_nueva_sirve_su_index_sin_cache(tmp_path, monkeypatch):
    r = _app_inicio(tmp_path, monkeypatch, "nueva").get("/index.html")
    assert r.status_code == 200 and "inicio viejo" in r.text
    assert r.headers["cache-control"] == "no-cache"


def test_el_inicio_en_todos_lleva_el_query_a_la_principal(tmp_path, monkeypatch):
    # el query viaja en el 302; es server/web.py quien manda ?blotato=conectar (lo manda el editor) al grupo Blotato
    c = _app_inicio(tmp_path, monkeypatch, "todos")
    r = c.get("/index.html?blotato=conectar")
    assert r.status_code == 302 and r.headers["location"] == "/estudio/?blotato=conectar"
    assert r.headers["cache-control"] == "no-store"
    c.cookies.set("ui", "clasica")
    r = c.get("/index.html")
    assert r.status_code == 200 and "inicio viejo" in r.text


def test_la_version_anterior_del_inicio_vuelve_a_index_html_y_ahi_se_queda(tmp_path, monkeypatch):
    """/ui/clasica?pantalla=inicio deja la cookie y lleva a /index.html (ya no a /estudio/: ahí vive la principal); con la cookie
    esa URL sirve el clásico en vez de volver a redirigir. Sin bucle."""
    c = _app_inicio(tmp_path, monkeypatch, "todos")
    r = c.get("/ui/clasica?pantalla=inicio")
    assert r.status_code == 302 and r.headers["location"] == "/index.html"
    assert "ui=clasica" in r.headers["set-cookie"]
    seguido = c.get("/index.html")                       # el TestClient guarda la cookie de la respuesta anterior
    assert seguido.status_code == 200 and "inicio viejo" in seguido.text


def test_volver_a_la_nueva_del_inicio_lleva_a_la_principal_y_borra_la_cookie(tmp_path, monkeypatch):
    c = _app_inicio(tmp_path, monkeypatch, "todos")
    c.get("/ui/clasica?pantalla=inicio")
    r = c.get("/ui/nueva?pantalla=inicio")
    assert r.status_code == 302 and r.headers["location"] == "/estudio/"
    assert 'ui=""' in r.headers["set-cookie"] and "Max-Age=0" in r.headers["set-cookie"]
    assert c.get("/index.html").status_code == 302


def test_el_inicio_sin_la_principal_compilada_sirve_el_clasico_y_no_redirige_a_un_404(tmp_path, monkeypatch):
    """Sin web/dist (o con uno sin estudio/index.html) `todos` no redirige: mandaría a un 404."""
    r = _app_inicio(tmp_path, monkeypatch, "todos", montada=False).get("/index.html")
    assert r.status_code == 200 and "inicio viejo" in r.text


def test_el_inicio_en_retirada_redirige_siempre_y_no_hace_bucle(tmp_path, monkeypatch):
    """Con vieja == nueva (el modelo de antes, /estudio/) `retirada` daba un 302 a sí misma. Ahora la vieja es otra URL."""
    c = _app_inicio(tmp_path, monkeypatch, "retirada")
    c.cookies.set("ui", "clasica")
    r = c.get("/index.html")
    assert r.status_code == 302 and r.headers["location"] == "/estudio/"
    r = c.get("/ui/clasica?pantalla=inicio")
    assert r.headers["location"] == "/estudio/" and "set-cookie" not in r.headers


# ---------- UI_ETAPA_MINIMA: dev navega por las nuevas sin tocar PANTALLAS ----------

def test_con_la_minima_todos_el_inicio_en_nueva_tambien_va_a_la_principal(tmp_path, monkeypatch):
    monkeypatch.setenv("UI_ETAPA_MINIMA", "todos")
    c = _app_inicio(tmp_path, monkeypatch, "nueva")
    r = c.get("/index.html?x=1")
    assert r.status_code == 302 and r.headers["location"] == "/estudio/?x=1"
    c.cookies.set("ui", "clasica")
    assert c.get("/index.html").status_code == 200, "y la salida de emergencia sigue en pie"


def test_la_minima_todos_redirige_una_pantalla_en_nueva(cliente, monkeypatch):
    monkeypatch.setenv("UI_ETAPA_MINIMA", "todos")
    r = cliente("nueva").get("/demo.html?x=1")
    assert r.status_code == 302
    assert r.headers["location"] == "/estudio/demo/?x=1"


def test_con_la_minima_la_cookie_clasica_sigue_siendo_la_salida(cliente, monkeypatch):
    monkeypatch.setenv("UI_ETAPA_MINIMA", "todos")
    c = cliente("nueva")
    r = c.get("/ui/clasica", params={"pantalla": "demo"})
    assert r.status_code == 302 and r.headers["location"] == "/demo.html"
    c.cookies.set("ui", "clasica")
    r = c.get("/demo.html")
    assert r.status_code == 200 and "vieja" in r.text


def test_la_minima_no_baja_una_pantalla_retirada(cliente, monkeypatch):
    monkeypatch.setenv("UI_ETAPA_MINIMA", "todos")
    c = cliente("retirada", con_vieja=False)
    c.cookies.set("ui", "clasica")
    assert c.get("/demo.html").headers["location"] == "/estudio/demo/"


def test_la_minima_sin_la_pantalla_compilada_no_manda_a_un_404(cliente, monkeypatch):
    monkeypatch.setenv("UI_ETAPA_MINIMA", "todos")
    r = cliente("nueva", montada=False).get("/demo.html")
    assert r.status_code == 200 and "vieja" in r.text


def test_sin_la_variable_nada_cambia(cliente, monkeypatch):
    monkeypatch.delenv("UI_ETAPA_MINIMA", raising=False)
    assert cliente("nueva").get("/demo.html").status_code == 200


@pytest.mark.parametrize("valor", ["retirada", "nueva", "TODOS", "si"])
def test_una_minima_que_no_sea_todos_revienta_al_arrancar(tmp_path, monkeypatch, valor):
    monkeypatch.setenv("UI_ETAPA_MINIMA", valor)
    with pytest.raises(ValueError, match="UI_ETAPA_MINIMA"):
        _app(tmp_path, "nueva")


def test_el_log_dice_la_etapa_que_rige(cliente, monkeypatch, caplog):
    monkeypatch.setenv("UI_ETAPA_MINIMA", "todos")
    with caplog.at_level(logging.INFO, logger="migracion"):
        cliente("nueva").get("/demo.html")
    assert "pantalla=demo etapa=todos" in caplog.text

