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
    r = cliente.get(ruta)
    assert r.status_code == 200, ruta
    assert r.headers["cache-control"] == "no-cache", ruta
    assert "cloudflare-cdn-cache-control" not in r.headers, ruta


@pytest.mark.parametrize("ruta", ["/", "/entrar", "/estudio/"])
def test_las_rutas_de_entrada_siguen_en_no_cache(cliente, ruta):
    r = cliente.get(ruta, follow_redirects=False)
    if r.status_code == 302:
        # /estudio/ es la URL vieja del inicio: con `inicio` en `todos` lleva al
        # nuevo (server/migracion.py), y ese 302 no lo guarda nadie
        assert ruta == "/estudio/" and r.headers["location"] == "/estudio/inicio/", ruta
        assert r.headers["cache-control"] == "no-store", ruta
        r = cliente.get(r.headers["location"], follow_redirects=False)
    assert r.status_code == 200, ruta
    assert r.headers["cache-control"] == "no-cache", ruta


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
