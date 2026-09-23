"""M26 — la sección pública de /automatizacion: qué queda abierto y qué no.

Estos tests no prueban la funcionalidad de la sección: prueban el *perímetro*.
A partir del 2026-10-10 el sitio tiene rutas sin login, y el modelo de seguridad
de este repo (server/auth.py) decide por PREFIJO de ruta. Un prefijo es una
regla que se cumple sola: cualquiera que mañana cuelgue un endpoint de
`/api/publico/` lo publica en internet, sin login, sin tocar infraestructura y
sin que nadie lo revise. Lo mismo con `static/`: app.py monta el directorio en
"/" con html=True, así que un .html nuevo queda servido a quien pase.

Por eso aquí hay dos INVENTARIOS con lista explícita. No comprueban que algo
funcione — comprueban que nadie abrió una puerta de más. Cuando fallen, la
respuesta correcta casi nunca es «agrego la ruta a la lista»: es «¿de verdad
esto va abierto a internet?».

Sin red: no se verifica ningún token, solo se mira quién llega al handler.
"""
import asyncio
from pathlib import Path

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from server import auth

REPO = Path(__file__).resolve().parent.parent
POOL = "us-east-1_TESTPOOL"


@pytest.fixture
def cognito_env(monkeypatch):
    """Con Cognito encendido — apagado el middleware no hace nada y no hay qué probar."""
    monkeypatch.setenv("COGNITO_POOL_ID", POOL)
    monkeypatch.setenv("COGNITO_CLIENT_ID", "clienteweb123")


@pytest.fixture
def cliente(cognito_env):
    from server.app import app
    return TestClient(app)


# ---------------------------------------------------------------------------
# la propiedad que sostiene todo el diseño: la barra final

def test_el_prefijo_publico_termina_en_barra():
    """Sin la barra, "/api/publico-admin/x" empieza por "/api/publico".

    Este assert parece trivial y es el que impide la fuga. Si alguien "limpia"
    la barra final creyendo que sobra, aquí se entera.
    """
    for prefijo in auth.PREFIJOS_PUBLICOS:
        assert prefijo.endswith("/"), f"{prefijo!r} sin barra final abre sus vecinos"
        assert prefijo.startswith("/api/"), f"{prefijo!r} debe colgar de /api/"


@pytest.mark.parametrize("ruta", [
    "/api/publico/automatizacion",
    "/api/publico/estado/17",
    "/api/publico/descarga/17",
    "/api/publico/lo-que-sea/con/varios/tramos",
])
def test_lo_que_cuelga_del_prefijo_no_pide_token(cliente, ruta):
    """Abierto = el middleware lo deja pasar. 404 es que pasó y no hay handler."""
    r = cliente.post(ruta) if "automatizacion" in ruta else cliente.get(ruta)
    assert r.status_code != 401, f"{ruta} debería estar abierta y pidió sesión"


@pytest.mark.parametrize("ruta", [
    "/api/publico-admin/secreto",      # el falso amigo clásico de startswith
    "/api/publicoX",                   # sin separador
    "/api/publico",                    # el prefijo pelado: NO es público
    "/api/publico2/lo-que-sea",
    "/api/proyectos",                  # la app privada de siempre
    "/editor/publico/x",               # publico en otro tramo no vale
    "/api/auth/publico",
])
def test_los_falsos_amigos_siguen_cerrados(cliente, ruta):
    """Cada una de estas empieza por "/api/publico" en alguna lectura ingenua."""
    r = cliente.get(ruta, follow_redirects=False)
    assert r.status_code == 401, f"{ruta} quedó ABIERTA: {r.status_code}"


def test_rutas_publicas_sigue_siendo_de_cadenas_exactas():
    """`ruta not in RUTAS_PUBLICAS` sobre un set compara cadenas completas.

    Si alguien lo cambia a una tupla y lo mueve a startswith, "/api/auth/config"
    pasaría a abrir "/api/auth/config-interno". El conjunto exacto es la garantía.
    """
    assert isinstance(auth.RUTAS_PUBLICAS, (set, frozenset))
    for ruta in auth.RUTAS_PUBLICAS:
        assert not ruta.endswith("/"), f"{ruta!r} con barra final no casa con ninguna ruta real"


# ---------------------------------------------------------------------------
# INVENTARIO 1 — qué endpoints cuelgan del prefijo público

# Lista explícita. Añadir algo aquí es la decisión de publicarlo en internet.
# El método importa tanto como la ruta: auth.py filtra por RUTA, no por método,
# así que declarar un DELETE bajo este prefijo lo deja abierto igual que el GET.
PUBLICAS_PERMITIDAS = {
    ("/api/publico/automatizacion", frozenset({"POST"})),
    ("/api/publico/estado/{corrida}", frozenset({"GET"})),
    ("/api/publico/descarga/{corrida}", frozenset({"GET"})),
}
METODOS_PERMITIDOS = {"GET", "POST", "HEAD"}


def _rutas_bajo_el_prefijo_publico():
    from server.app import app
    encontradas = set()
    for r in app.routes:
        if isinstance(r, APIRoute) and r.path.startswith(auth.PREFIJOS_PUBLICOS):
            encontradas.add((r.path, frozenset(r.methods) - {"HEAD", "OPTIONS"}))
    return encontradas


def test_inventario_de_endpoints_publicos():
    """Nada cuelga del prefijo público que no esté en la lista de arriba.

    Es subconjunto y no igualdad a propósito: mientras la sección se construye,
    faltarán endpoints de la lista y eso no es un fallo de seguridad. Lo que
    nunca puede pasar es lo contrario — que aparezca uno que nadie aprobó.
    """
    sobrantes = _rutas_bajo_el_prefijo_publico() - PUBLICAS_PERMITIDAS
    assert not sobrantes, (
        "endpoints ABIERTOS A INTERNET sin estar en PUBLICAS_PERMITIDAS: "
        f"{sorted(sobrantes)}")


def test_ningun_metodo_destructivo_bajo_el_prefijo_publico():
    """auth.py no mira el método: un PUT/DELETE aquí queda tan abierto como el GET."""
    for ruta, metodos in _rutas_bajo_el_prefijo_publico():
        de_mas = metodos - METODOS_PERMITIDOS
        assert not de_mas, f"{ruta} expone {sorted(de_mas)} sin login"


# ---------------------------------------------------------------------------
# INVENTARIO 2 — qué HTML sirve el mount de "/" (app.py:1075, html=True)

# Todo .html de static/ se sirve a cualquiera. Los de la app privada no son un
# agujero (sin token sus fetches dan 401), pero SÍ revelan producto: nombres de
# pantallas, campos, flujos. La lista obliga a mirarlos uno por uno.
HTML_ESPERADOS = {
    # M26: index.html ES la portada pública; la app privada se mudó a app.html
    "index.html", "app.html", "automatizacion.html",
    # callback del login (lo abre el Hosted UI, pone la cookie `token`)
    "callback.html",
    # pantallas privadas: el HTML se ve, los datos no
    "admin.html", "agenda.html", "clip.html", "competencia.html", "crear.html",
    "e1.html", "estilos.html", "imagenes.html", "metricas.html", "mix.html",
    "shorts.html",
}


def test_inventario_de_html_servidos():
    """app.py monta static/ en "/" con html=True: un .html nuevo nace público."""
    reales = {p.name for p in (REPO / "static").glob("*.html")}
    nuevos = reales - HTML_ESPERADOS
    assert not nuevos, (
        "estos .html quedaron servidos a internet sin pasar por revisión: "
        f"{sorted(nuevos)}")


# ---------------------------------------------------------------------------
# recorridos de ruta: que el prefijo no sirva de túnel

def _pedir_asgi_crudo(path: str):
    """Un cliente HTTP normaliza el ".." antes de mandar; curl --path-as-is no.

    Hablamos ASGI directo para ver qué hace el SERVIDOR con la ruta cruda, que
    es lo que puede llegarle desde Cloudflare o desde API Gateway.
    """
    from server.app import app
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
             "method": "GET", "scheme": "https", "path": path,
             "raw_path": path.encode(), "query_string": b"", "root_path": "",
             "headers": [(b"host", b"irremplazables.xyz")],
             "client": ("1.2.3.4", 1), "server": ("irremplazables.xyz", 443)}
    salida = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(m):
        salida.append(m)

    asyncio.run(app(scope, receive, send))
    return next(m["status"] for m in salida if m["type"] == "http.response.start")


@pytest.mark.parametrize("ruta", [
    "/api/publico/../proyectos",
    "/api/publico/..%2fproyectos",
    "/api/publico/x/../../proyectos",
    "/api/publico//../proyectos",
])
def test_el_prefijo_publico_no_es_un_tunel_al_api_privada(cognito_env, ruta):
    """El middleware ve la ruta cruda y la deja pasar — el router NO resuelve "..".

    Starlette casa la ruta literal: no hay handler llamado "/api/publico/../
    proyectos", así que el recorrido acaba en 404 y no en los datos de nadie.
    Si algún día se mete un normalizador de rutas delante del middleware, este
    test es el que se entera.
    """
    assert _pedir_asgi_crudo(ruta) == 404, f"{ruta} llegó a algún handler"


# ---------------------------------------------------------------------------
# PENDIENTE — la portada dejará de ser el sitio al que mandar a quien no tiene
# sesión, pero TODAVÍA NO.
#
# Aquí vivía test_sin_sesion_la_navegacion_html_va_a_la_app_no_a_la_portada, que
# exigía que _rechazo() redirigiera a "/app.html". Se retiró el 2026-09-23 porque
# ese archivo NO EXISTE: con él, la navegación sin sesión acababa en un 404 y
# nadie podía entrar. Hoy "/" sigue siendo la app privada y su 401 accidental es
# la única puerta de entrada que hay.
#
# Este test vuelve —junto con APP_PRIVADA en server/auth.py— en el MISMO commit
# que cree static/app.html y convierta index.html en portada pública. Y cuando
# vuelva, debe comprobar además que el destino responde 200, no 404.
