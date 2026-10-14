"""Producción no sirve /automatiza hasta RAG·30 (decisión del dueño, 14-oct-2026).

Sin esto, el dev→main del PR 160 publicaba en irremplazables.xyz la página
«gratis del 10 al 25 de octubre» (en pausa, pero indexable y con su tarjeta
para redes) y unas legales nuevas —versión 2026-10-04, con la sección 14 y tres
frases de «todavía no»— que el dueño no había decidido. Las legales publicadas
prometen anunciar en la comunidad cualquier cambio antes de que valga.

«Producción» aquí es lo que ve la Lambda del API de prod: JOBS_BACKEND=aws y
sin PUBLICO_QUEUE_URL (tests/test_entornos.py fija que prod no la trae). Ahí:
  · /automatiza, sus rutas, sus plantillas crudas y sus archivos dan 404;
  · /api/publico/* da 404 antes de leer el cuerpo, el freno o la base, y no
    sale en /openapi.json;
  · /privacidad, /terminos y /robots.txt son server/sin_automatiza/, lo que
    producción publica desde el 3-oct, byte por byte.
Donde sí se sirve (dev y local) no cambia nada.
"""
import hashlib
import re

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from pipeline import db
from pipeline import publico
from server import aviso, publico_api

PID = "AbCdEfGhIjKlMn_-"
LEGALES = ("privacidad.html", "terminos.html")
# sha256 de server/sin_automatiza/: static/privacidad.html, static/terminos.html
# y static/robots.txt de main en 98548db (versión 2026-10-03, PR 174), lo que
# producción publica desde el 3-oct-2026. Cambiar la huella de una legal es
# cambiar el texto legal de producción: se anuncia en la comunidad antes de que
# valga (términos §11, privacidad §12) y luego se cambia aquí.
HUELLAS_PRODUCCION = {
    "privacidad.html": "56dbde79635c7f7a6bd8d9be01bf69d2557439e2ecda5b542f94a65b092f1afc",
    "terminos.html": "1dafbb0ecf072e31f2270afaf89cbab4acde9aa24e2f51e95e8f178c1be1b736",
    "robots.txt": "e704c957708d31e9c3fe351e27165d4ccc14461e435c74f6d634863b4266847e",
}


def _como_produccion(monkeypatch):
    monkeypatch.setenv("JOBS_BACKEND", "aws")
    monkeypatch.delenv("PUBLICO_QUEUE_URL", raising=False)


def _cliente(monkeypatch):
    # con login exigido, como en la nube: nada de esto puede pedir sesión
    monkeypatch.setenv("COGNITO_POOL_ID", "us-east-1_TESTPOOL")
    monkeypatch.setenv("COGNITO_CLIENT_ID", "clienteweb123")
    from server.app import app
    return TestClient(app, base_url="https://irremplazables.xyz")


@pytest.fixture
def produccion(monkeypatch):
    _como_produccion(monkeypatch)
    return _cliente(monkeypatch)


@pytest.fixture
def dev(monkeypatch):
    monkeypatch.setenv("JOBS_BACKEND", "aws")
    monkeypatch.setenv("PUBLICO_QUEUE_URL", "https://sqs/publico")
    return _cliente(monkeypatch)


# ---------------------------------------------------------------------------
# quién decide

@pytest.mark.parametrize("backend, cola, se_sirve", [
    (None, None, True),                   # local: donde se escribe y se prueba
    ("local", None, True),
    ("aws", None, False),                 # la Lambda de prod hasta RAG·30
    ("aws", "https://sqs/publico", True),  # la de dev
])
def test_se_sirve_donde_la_infra_creo_la_cola_publica(monkeypatch, backend, cola, se_sirve):
    for var, valor in (("JOBS_BACKEND", backend), ("PUBLICO_QUEUE_URL", cola)):
        if valor is None:
            monkeypatch.delenv(var, raising=False)
        else:
            monkeypatch.setenv(var, valor)
    assert publico.publicado() is se_sirve


# ---------------------------------------------------------------------------
# producción: nada de /automatiza

@pytest.mark.parametrize("ruta", [
    "/automatiza", "/automatiza/", "/automatiza?utm_source=x",
    f"/automatiza/c/{PID}", "/automatiza/c/raro",
    "/automatiza/baja/x", f"/automatiza/baja/{PID}",
    "/automatiza.css", "/automatiza.js", "/sondeo.js", "/automatiza-og.png",
    # las plantillas crudas: ni siquiera un 302 que nombre /automatiza
    "/automatiza.html", "/automatiza.html?x=1", "/baja.html", "/baja-hecha.html",
    # los rodeos que el montaje de static/ normaliza al mismo archivo
    "//automatiza.js", "/%2E/automatiza-og.png", "/fuentes/%2E%2E/sondeo.js",
    "//automatiza.html", "/%2E/baja.html",
])
def test_en_produccion_automatiza_no_existe(produccion, ruta):
    # URL completa: «//x» a secas, httpx lo lee como otro host. Sin seguir
    # redirecciones: un 302 hacia /automatiza tampoco vale.
    r = produccion.get("https://irremplazables.xyz" + ruta, follow_redirects=False)
    assert r.status_code == 404, (ruta, r.status_code, r.headers.get("location"))
    assert "Gratis" not in r.text and "gratis" not in r.text, ruta


def test_en_produccion_la_baja_por_post_tampoco_existe(produccion, monkeypatch):
    monkeypatch.setattr(db, "automatiza_dar_baja",
                        lambda *a, **k: pytest.fail("en producción no se toca la base"))
    assert produccion.post(f"/automatiza/baja/{PID}").status_code == 404


def _rutas_publicas():
    for ruta in publico_api.router.routes:
        if isinstance(ruta, APIRoute):
            for metodo in ruta.methods:
                yield metodo, ruta.path.replace("{publico_id}", PID)


@pytest.mark.parametrize("metodo, ruta", sorted(_rutas_publicas()))
def test_en_produccion_api_publico_es_404_antes_del_freno_y_la_base(produccion, monkeypatch,
                                                                     metodo, ruta):
    """TODAS las rutas del router, no una lista escrita a mano: una nueva queda
    cubierta sola. El 404 llega antes del freno (que antes contestaba «no
    disponible») y antes de la base (la consulta de una corrida llegaba hasta
    Aurora, anónima y sin throttling propio)."""
    prohibido = lambda *a, **k: pytest.fail("en producción /api/publico no toca nada")
    monkeypatch.setattr(publico, "permiso", prohibido)
    monkeypatch.setattr(db, "automatiza_corrida", prohibido)
    cuerpo = {"texto": "x" * 40, "correo": "a@b.co", "aviso_version": aviso.AVISO_VERSION}
    r = produccion.request(metodo, ruta, json=cuerpo if metodo == "POST" else None)
    assert r.status_code == 404, (metodo, ruta, r.status_code, r.text[:200])
    assert r.json() == {"detail": "Not Found"}


def test_el_router_publico_no_perdio_rutas():
    # si alguien vacía el router, la prueba de arriba pasaría sin probar nada
    assert len(list(_rutas_publicas())) >= 5


@pytest.mark.parametrize("ruta", ["/api/publico/corridas", f"/api/publico/corridas/{PID}/correo"])
def test_en_produccion_un_json_roto_tambien_es_404(produccion, ruta):
    # sin el corte de server/auth.py, FastAPI leía el cuerpo antes que la
    # dependencia del router y contestaba 422: la ruta se delataba
    r = produccion.post(ruta, content=b"{", headers={"content-type": "application/json"})
    assert r.status_code == 404 and r.json() == {"detail": "Not Found"}


def test_api_publico_no_sale_en_openapi(produccion):
    """Prod sirve /openapi.json y /docs sin sesión: ahí se anunciaban las
    rutas y sus modelos aunque dieran 404."""
    esquema = produccion.get("/openapi.json").json()
    assert not [p for p in esquema["paths"] if p.startswith("/api/publico")]
    modelos = esquema.get("components", {}).get("schemas", {})
    assert "Peticion" not in modelos and "Correo" not in modelos


# ---------------------------------------------------------------------------
# producción: las legales de siempre

def test_la_carpeta_trae_solo_las_copias_con_huella():
    assert sorted(p.name for p in aviso.SIN_AUTOMATIZA.iterdir()) == sorted(HUELLAS_PRODUCCION)


@pytest.mark.parametrize("nombre", LEGALES)
def test_las_copias_son_el_texto_que_produccion_ya_publica(nombre):
    datos = (aviso.SIN_AUTOMATIZA / nombre).read_bytes()
    assert hashlib.sha256(datos).hexdigest() == HUELLAS_PRODUCCION[nombre], (
        f"{nombre} ya no es el texto que publica producción: eso es un cambio legal "
        "que se anuncia antes de que valga (ver la cabecera de este archivo)")
    texto = datos.decode("utf-8")
    assert "automatiza" not in texto.lower()
    assert "{{" not in texto
    assert "Versión 2026-10-03" in texto
    assert "Fundamentos AI LLC" in texto


def test_en_produccion_robots_es_el_de_siempre(produccion):
    """El de main: solo la portada y la entrada. Ni /automatiza ni sus archivos,
    y las legales siguen fuera de los buscadores, como hasta hoy."""
    r = produccion.get("/robots.txt")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/plain")
    assert hashlib.sha256(r.content).hexdigest() == HUELLAS_PRODUCCION["robots.txt"]
    assert "automatiza" not in r.text.split("User-agent:")[1]
    assert "Allow: /privacidad" not in r.text and r.text.rstrip().endswith("Disallow: /")


def test_en_dev_robots_es_el_de_static(dev):
    r = dev.get("/robots.txt")
    assert r.content == (aviso.ESTATICOS / "robots.txt").read_bytes()
    assert "Allow: /automatiza$" in r.text


@pytest.mark.parametrize("ruta, nombre", [("/privacidad", "privacidad.html"),
                                          ("/terminos", "terminos.html")])
def test_en_produccion_las_legales_son_las_de_hoy(produccion, ruta, nombre):
    r = produccion.get(ruta)
    assert r.status_code == 200
    assert r.text == (aviso.SIN_AUTOMATIZA / nombre).read_text(encoding="utf-8")
    for frase in ("todavía no está fijado", "Todavía no hay un proveedor", "/automatiza",
                  "sección 14", aviso.AVISO_VERSION):
        assert frase not in r.text, (ruta, frase)
    # las mismas cabeceras que en dev: CSP estricta y sin caché. Sin
    # X-Robots-Tag, como hoy: a los buscadores los frena robots.txt
    assert r.headers["content-security-policy"].startswith("default-src 'none'")
    assert r.headers["cache-control"] == "no-cache"
    assert "x-robots-tag" not in r.headers
    # y contestan HEAD, como las de main
    h = produccion.head(ruta)
    assert h.status_code == 200 and h.content == b""
    assert h.headers["etag"] == r.headers["etag"]


# ---------------------------------------------------------------------------
# donde sí se sirve, nada cambia

@pytest.mark.parametrize("ruta", ["/automatiza", f"/automatiza/c/{PID}", "/automatiza.js",
                                  "/sondeo.js", "/automatiza-og.png"])
def test_en_dev_automatiza_se_sirve(dev, ruta):
    assert dev.get(ruta).status_code == 200, ruta


@pytest.mark.parametrize("ruta", ["/privacidad", "/terminos"])
def test_en_dev_las_legales_traen_la_seccion_de_automatiza(dev, ruta):
    r = dev.get(ruta)
    assert r.status_code == 200
    assert 'id="automatiza"' in r.text
    assert f"Versión {aviso.AVISO_VERSION}" in r.text


def test_en_produccion_y_en_dev_las_secciones_comunes_se_llaman_igual(monkeypatch):
    """Las secciones 1 a 13 llevan los mismos títulos en los dos; dev solo les
    suma las frases que remiten a la 14. Si una cambia de nombre en la
    plantilla, la copia de producción se queda atrás y hay que decidir (y
    anunciar) el cambio, no descubrirlo en el siguiente release."""
    def titulos(html: str) -> list[str]:
        return [re.sub(r"<[^>]+>", "", t).strip()
                for t in re.findall(r"<h2[^>]*>(.*?)</h2>", html, flags=re.S)]
    cliente = _cliente(monkeypatch)
    for ruta in ("/privacidad", "/terminos"):
        _como_produccion(monkeypatch)
        de_prod = titulos(cliente.get(ruta).text)
        monkeypatch.setenv("PUBLICO_QUEUE_URL", "https://sqs/publico")
        de_dev = titulos(cliente.get(ruta).text)
        assert len(de_prod) == 13, (ruta, de_prod)
        assert de_dev[:13] == de_prod, ruta
        assert len(de_dev) == 14, ruta   # la 14, la de /automatiza
