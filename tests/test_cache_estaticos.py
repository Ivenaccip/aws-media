"""UI·3 — la caché de los estáticos es explícita, no la heurística de Cloudflare.

Medido en producción el 27-sep, ANTES de este cambio (curl -D - a
irremplazables.xyz):

  /auth.js, /monedero.js, /carta.css, /enlaces.js
      cache-control: max-age=14400 · cf-cache-status: HIT
      → sin cabecera propia, Cloudflare les ponía 4 h de navegador: un fix de
        UI tardaba hasta 4 h en llegar a quien ya había entrado. Contradice la
        tarjeta congelada «Cache-Control para auth.js y monedero.js».
  /, /entrar, /estudio/
      cache-control: no-cache · DYNAMIC → Cloudflare deja pasar el no-cache.
  /index.html (y los demás .html servidos por StaticFiles)
      sin cache-control · DYNAMIC.

La regla que fijan estos tests:

  · JS y CSS: `no-cache` para el navegador + `Cloudflare-CDN-Cache-Control:
    max-age=60` para el borde. El borde sigue sirviendo la ráfaga de ~8
    archivos de cada carga del estudio (sin esto, cada uno despierta una Lambda
    del techo de 10 que comparten API y worker) y un deploy llega en ≤ 60 s.
  · HTML: `no-cache`.
  · Imágenes y los versionados (INMUTABLES) se quedan como estaban.
"""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def cliente(monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    from server.app import app
    return TestClient(app)


REVALIDAN_EN_EL_BORDE = ["/auth.js", "/monedero.js", "/orbe.js", "/enlaces.js",
                         "/guardrail.js", "/carta.css"]
HTML = ["/index.html", "/shorts.html", "/crear.html", "/admin.html"]


@pytest.mark.parametrize("ruta", REVALIDAN_EN_EL_BORDE)
def test_js_y_css_revalidan_en_el_navegador_y_se_quedan_60s_en_el_borde(cliente, ruta):
    r = cliente.get(ruta)
    assert r.status_code == 200, ruta
    assert r.headers["cache-control"] == "no-cache", ruta
    assert r.headers["cloudflare-cdn-cache-control"] == "max-age=60", ruta
    # el ETag es lo que hace barata la revalidación: 304 sin cuerpo
    assert r.headers.get("etag"), ruta


def test_la_revalidacion_con_etag_da_304(cliente):
    etag = cliente.get("/auth.js").headers["etag"]
    r = cliente.get("/auth.js", headers={"If-None-Match": etag})
    assert r.status_code == 304


@pytest.mark.parametrize("ruta", HTML)
def test_el_html_revalida_y_no_se_cachea_en_el_borde(cliente, ruta):
    # /index.html (el inicio clásico) redirige a la principal sin la cookie de la clásica (abajo); con ella se sirve el HTML
    cookie = {"Cookie": "ui=clasica"} if ruta == "/index.html" else {}
    r = cliente.get(ruta, headers=cookie, follow_redirects=False)
    assert r.status_code == 200, ruta
    assert r.headers["cache-control"] == "no-cache", ruta
    assert "cloudflare-cdn-cache-control" not in r.headers, ruta


@pytest.mark.parametrize("ruta", ["/", "/entrar"])
def test_las_rutas_de_entrada_siguen_en_no_cache(cliente, ruta):
    r = cliente.get(ruta, follow_redirects=False)
    assert r.status_code == 200, ruta
    assert r.headers["cache-control"] == "no-cache", ruta


def _con_la_principal(cliente):
    if not any(getattr(r, "path", "") == "/estudio/" for r in cliente.app.routes):
        pytest.skip("web/dist no está compilado: sin la principal no hay /estudio/")


@pytest.mark.parametrize("ruta", ["/estudio/", "/estudio/marketing/", "/estudio/marketing/distrito/imagen/"])
def test_la_principal_y_las_paginas_por_nivel_siguen_en_no_cache(cliente, ruta):
    """/estudio/ ya no redirige: es la página (server/web.py). Esa y las anidadas revalidan con ETag, nunca se quedan en el borde."""
    _con_la_principal(cliente)
    r = cliente.get(ruta, follow_redirects=False)
    assert r.status_code == 200, ruta
    assert r.headers["cache-control"] == "no-cache", ruta
    assert "cloudflare-cdn-cache-control" not in r.headers, ruta
    assert r.headers.get("etag"), ruta
    assert cliente.get(ruta, headers={"If-None-Match": r.headers["etag"]}).status_code == 304, ruta


def test_el_302_del_index_viejo_a_la_principal_no_se_queda_en_cache(cliente):
    """Cuando /index.html (el inicio clásico, URL vieja del inicio) redirige a la principal, el 302 no se guarda: volver a `nueva`
    llega en la siguiente carga (server/migracion.py). Con la cookie de la clásica sigue sirviendo el HTML, con `no-cache`."""
    _con_la_principal(cliente)
    r = cliente.get("/index.html", follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == "/estudio/"
    assert r.headers["cache-control"] == "no-store"
    r = cliente.get("/index.html", headers={"Cookie": "ui=clasica"}, follow_redirects=False)
    assert r.status_code == 200 and r.headers["cache-control"] == "no-cache"


@pytest.mark.parametrize("pedido, destino", [
    ("/estudio/inicio/", "/estudio/"),
    ("/estudio/inicio", "/estudio/"),
    ("/estudio/inicio/?x=1", "/estudio/?x=1"),
    ("/estudio/inicio/?desde=mkt.blotato.agenda&ver=grupos", "/estudio/?desde=mkt.blotato.agenda&ver=grupos"),
])
def test_el_302_de_la_pagina_unica_a_la_principal_no_se_queda_en_cache(cliente, pedido, destino):
    """/estudio/inicio/ (la página única de antes, retirada en E5.3) ya no es una página: redirige a la principal con el query intacto,
    y ese 302 no se guarda (un marcador viejo llega a lo que haya hoy; `no-store` y no `no-cache`: nunca se queda en una caché).
    Con `?prompt=`/`?brief=`/`?blotato=conectar` el segundo salto (la entrada vieja) lo cubre tests/test_web_niveles.py."""
    _con_la_principal(cliente)
    r = cliente.get(pedido, follow_redirects=False)
    assert r.status_code == 302, (
        f"{pedido} dio {r.status_code}: ¿web/dist es de antes de retirar la página única? Compila con «cd web && npm run build»"
    )
    assert r.headers["location"] == destino
    assert r.headers["cache-control"] == "no-store"
    assert "cloudflare-cdn-cache-control" not in r.headers


def test_los_versionados_siguen_inmutables(cliente):
    for ruta in ("/orbe-gpu.v1.js", "/orbe.v1.wgsl", "/fuentes/geist-latin.v1.woff2"):
        r = cliente.get(ruta)
        assert r.headers["cache-control"] == "public, max-age=604800, immutable", ruta
        assert "cloudflare-cdn-cache-control" not in r.headers, ruta


def test_ningun_js_ni_css_se_queda_sin_cabecera(cliente):
    """Un .js o .css nuevo en static/ hereda la regla sin que nadie se acuerde."""
    from server.app import INMUTABLES, ROOT
    sueltos = []
    for f in sorted((ROOT / "static").glob("*")):
        if f.suffix not in {".js", ".css"} or f.name in INMUTABLES:
            continue
        cc = cliente.get(f"/{f.name}").headers.get("cache-control")
        if cc != "no-cache":
            sueltos.append((f.name, cc))
    assert not sueltos, sueltos
