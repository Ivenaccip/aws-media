"""Tarjetas 37 y 38 — la entrada de verdad y la portada pública.

Hasta aquí el login arrancaba por accidente: «/» era el estudio, su primer
fetch daba 401 y auth.js mandaba a Cognito. Con «/» convertido en portada que
no llama a la API, esa puerta desaparece. Estos tests fijan la nueva:

  · «/» sirve la portada; «/?algo» es un enlace viejo → 302 a /estudio/?algo.
  · /estudio/ sirve el mismo index.html de siempre.
  · quien abre una pantalla sin sesión va a /entrar?volver=<ruta>.
  · /entrar solo acepta `volver` del propio dominio y no rebota sin fin.
  · auth.js hace UNA ida a Cognito aunque lleguen varios 401 juntos.
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from server import auth

RAIZ = Path(__file__).resolve().parent.parent
STATIC = RAIZ / "static"
PORTADA = (STATIC / "portada.html").read_text(encoding="utf-8")
ENTRAR = (STATIC / "entrar.html").read_text(encoding="utf-8")
CALLBACK = (STATIC / "callback.html").read_text(encoding="utf-8")
NODE = shutil.which("node")


@pytest.fixture
def local(monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    from server.app import app
    return TestClient(app)


@pytest.fixture
def nube(monkeypatch):
    monkeypatch.setenv("COGNITO_POOL_ID", "us-east-1_TESTPOOL")
    monkeypatch.setenv("COGNITO_CLIENT_ID", "clienteweb123")
    monkeypatch.setattr(auth, "verificar", lambda t: (_ for _ in ()).throw(ValueError(t)))
    from server.app import app
    return TestClient(app)


# ---------------------------------------------------------------------------
# rutas

def test_raiz_sirve_la_portada(local):
    r = local.get("/")
    assert r.status_code == 200
    assert "Tu historia, convertida en" in r.text
    assert r.headers["cache-control"] == "no-cache"


def test_raiz_con_query_es_un_enlace_viejo_al_estudio(local):
    for q in ("p=abc123", "blotato=conectar"):
        r = local.get(f"/?{q}", follow_redirects=False)
        assert r.status_code == 302 and r.headers["location"] == f"/estudio/?{q}"


def test_estudio_sirve_el_mismo_index(local):
    r = local.get("/estudio/")
    assert r.status_code == 200
    assert r.text == (STATIC / "index.html").read_text(encoding="utf-8")
    r = local.get("/estudio?p=1", follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == "/estudio/?p=1"


def test_entrar_existe(local):
    r = local.get("/entrar")
    assert r.status_code == 200 and "Entra a tu estudio" in r.text


def test_las_tres_son_publicas_con_cognito(nube):
    # sin token: ninguna de las tres puede pedir sesión, o no habría por dónde entrar
    for ruta in ("/", "/estudio/", "/entrar", "/callback.html", "/enlaces.js"):
        assert nube.get(ruta, follow_redirects=False).status_code == 200, ruta


def test_sin_sesion_va_a_entrar_con_la_ruta_y_el_query(nube):
    r = nube.get("/editor/mi-video/?v=2", headers={"Accept": "text/html"},
                 follow_redirects=False)
    assert r.status_code in (302, 307)
    assert r.headers["location"] == "/entrar?volver=%2Feditor%2Fmi-video%2F%3Fv%3D2"


def test_fetch_sin_sesion_sigue_siendo_401(nube):
    assert nube.get("/api/proyectos").status_code == 401


# ---------------------------------------------------------------------------
# portada

def test_portada_no_toca_la_api():
    # un 401 desde la portada mandaría a Cognito a un visitante que no tocó nada
    codigo = re.sub(r"<!--.*?-->", "", PORTADA, flags=re.S)   # el comentario los cita
    assert "auth.js" not in codigo and "monedero.js" not in codigo
    assert "fetch(" not in codigo and "/api/" not in codigo


def test_portada_con_sesion_salta_al_estudio():
    cab = PORTADA.split("</head>")[0]
    assert "location.replace('/estudio/')" in cab
    assert "auth_refresh_token" in cab


def test_portada_lleva_a_entrar_y_tiene_vista_previa():
    assert PORTADA.count('href="/entrar"') == 2
    assert 'property="og:title"' in PORTADA and 'property="og:description"' in PORTADA


def test_enlace_de_la_comunidad_se_esconde_si_esta_vacio():
    js = (STATIC / "enlaces.js").read_text(encoding="utf-8")
    assert "comunidad:" in js and "^https:" in js
    for html in (PORTADA, ENTRAR):
        assert re.search(r'<span data-enlace-envoltura hidden> <a data-enlace="comunidad" hidden>', html)


# ---------------------------------------------------------------------------
# /entrar y callback

def test_callback_ya_no_vuelve_a_la_portada():
    assert "|| '/estudio/'" in CALLBACK
    assert "location.replace('/')" not in CALLBACK


def test_las_pantallas_vuelven_al_estudio_no_a_la_portada():
    for f in STATIC.glob("*.html"):
        if f.name in ("portada.html", "entrar.html"):
            continue
        t = f.read_text(encoding="utf-8")
        assert 'href="/"' not in t, f.name
        assert '"/?blotato' not in t, f.name


def _destino():
    """La función destino() de entrar.html, para correrla en node."""
    m = re.search(r"(  function destino\(\) \{.*?\n  \})", ENTRAR, re.S)
    return "const ESTUDIO = '/estudio/';\n" + m.group(1)


@pytest.mark.skipif(not NODE, reason="sin node")
@pytest.mark.parametrize("volver, esperado", [
    (None, "/estudio/"),
    ("/editor/x/", "/editor/x/"),
    ("/crear.html?p=abc", "/crear.html?p=abc"),
    ("https://malo.example/robar", "/estudio/"),
    ("//malo.example/robar", "/estudio/"),
    ("javascript:alert(1)", "/estudio/"),
    ("/entrar?volver=/entrar", "/estudio/"),
    ("/callback.html?code=1", "/estudio/"),
    ("/", "/estudio/"),
])
def test_entrar_solo_vuelve_al_propio_dominio(volver, esperado):
    q = "" if volver is None else "?volver=" + __import__("urllib.parse").parse.quote(volver, safe="")
    js = (f"const location = new URL('https://irremplazables.xyz/entrar{q}');\n"
          + _destino() + "\nconsole.log(destino());")
    out = subprocess.run([NODE, "-e", js], capture_output=True, text=True, check=True)
    assert out.stdout.strip() == esperado


def test_entrar_tiene_guarda_contra_el_bucle():
    assert "entrar_visitas" in ENTRAR and "30000" in ENTRAR and ">= 3" in ENTRAR
    # rehace la cookie (que es de sesión) antes de volver: sin eso, el bucle
    assert "segundosRestantes() > 60" in ENTRAR
    assert "guardarTokens({ id_token:" in ENTRAR


# ---------------------------------------------------------------------------
# auth.js: una sola ida a Cognito

_ARNES = r"""
const cuenta = { refresh: 0, authorize: 0, verifier: 0, api: 0 };
const REFRESCA = %(refresca)s;
const ls = new Map([['auth_id_token', 'VIEJO'], ['auth_refresh_token', 'RT']]);
const ss = new Map();
globalThis.localStorage = { getItem: k => ls.has(k) ? ls.get(k) : null,
  setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) };
globalThis.sessionStorage = { getItem: k => ss.get(k) ?? null,
  setItem: (k, v) => { if (k === 'auth_verifier') cuenta.verifier++; ss.set(k, v); },
  removeItem: k => ss.delete(k) };
const loc = { origin: 'https://irremplazables.xyz', pathname: '/estudio/', search: '', protocol: 'https:' };
Object.defineProperty(loc, 'href', { set: u => { if (u.includes('/oauth2/authorize')) cuenta.authorize++; } });
globalThis.location = loc;
globalThis.document = { cookie: '', body: null };
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
const espera = ms => new Promise(r => setTimeout(r, ms));
globalThis.fetch = async (url, init) => {
  if (url === '/api/auth/config') return { ok: true, status: 200,
    json: async () => ({ activo: true, dominio: 'x.auth', client_id: 'c' }) };
  if (String(url).includes('/oauth2/token')) {
    cuenta.refresh++;
    await espera(20);
    return REFRESCA ? { ok: true, json: async () => ({ id_token: 'NUEVO' }) } : { ok: false };
  }
  cuenta.api++;
  const t = init && init.headers && init.headers.get('Authorization');
  return { status: t === 'Bearer NUEVO' ? 200 : 401 };
};
require(process.argv[1]);
(async () => {
  const rs = Array.from({ length: 5 }, () => Promise.race([window.fetch('/api/x'), espera(300)]));
  const fin = await Promise.all(rs);
  await espera(50);
  cuenta.ok = fin.filter(r => r && r.status === 200).length;
  console.log(JSON.stringify(cuenta));
})();
"""


def _correr(refresca):
    js = _ARNES % {"refresca": "true" if refresca else "false"}
    out = subprocess.run([NODE, "-e", js, str(STATIC / "auth.js")],
                         capture_output=True, text=True, check=True, timeout=30)
    return json.loads(out.stdout.strip().splitlines()[-1])


@pytest.mark.skipif(not NODE, reason="sin node")
def test_cinco_401_sin_refresco_dan_un_solo_login():
    c = _correr(refresca=False)
    assert (c["refresh"], c["authorize"], c["verifier"]) == (1, 1, 1), c


@pytest.mark.skipif(not NODE, reason="sin node")
def test_cinco_401_con_refresco_dan_un_solo_refresh_y_reintentan():
    c = _correr(refresca=True)
    assert c["refresh"] == 1 and c["authorize"] == 0 and c["ok"] == 5, c


def test_la_caja_de_aviso_respeta_hidden():
    # .aviso-caja pone display:flex, que le ganaba al atributo hidden: /entrar
    # enseñaba «No pudimos recuperar tu sesión» en la primera visita
    css = (STATIC / "carta.css").read_text(encoding="utf-8")
    assert ".aviso-caja[hidden] { display: none; }" in css
