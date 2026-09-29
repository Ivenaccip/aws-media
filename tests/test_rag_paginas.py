"""RAG·10/13 — las páginas públicas de /automatiza y sus legales.

  · se sirven LLENAS: server/aviso.py pone los {{huecos}} del dueño con escape
    HTML, y un marcador sin clave revienta en vez de salir crudo;
  · con su CSP y demás cabeceras, y X-Robots-Tag según el Host (solo
    irremplazables.xyz se indexa; /automatiza/c/… nunca);
  · la plantilla cruda (/automatiza.html…) no se ve: 302 a la ruta limpia;
  · robots.txt deja pasar lo público y no el enlace para volver.

Las rutas se prueban con páginas de mentira en un directorio temporal: las
de verdad las escribe otra tarjeta y su propio test las revisa; aquí solo se
comprueba, si ya existen, que no piden huecos que no hay."""
import hashlib
import html
import os
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pipeline import publico
from server import aviso

RAIZ = Path(__file__).resolve().parent.parent
PAGINAS = ("automatiza.html", "privacidad.html", "terminos.html")
CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
       "font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; "
       "frame-ancestors 'none'; manifest-src 'self'")
PID = "AbCdEfGhIjKlMn_-"


# ---------------------------------------------------------------------------
# la plantilla

def test_los_largos_salen_del_freno_no_se_escriben_a_mano():
    assert aviso.DATOS["largo_maximo"] == str(publico.LARGO_MAXIMO)
    assert aviso.DATOS["largo_minimo"] == str(publico.LARGO_MINIMO)


def test_datos_trae_lo_que_se_guarda_con_el_correo():
    assert aviso.DATOS["recontacto_texto"] == aviso.RECONTACTO_TEXTO
    assert aviso.DATOS["aviso_version"] == aviso.AVISO_VERSION
    for clave in ("responsable", "domicilio", "correo_privacidad", "plazo_peticion",
                  "plazo_correo", "proveedor_correo", "fecha_aviso"):
        assert aviso.DATOS[clave], clave
    assert all(isinstance(v, str) for v in aviso.DATOS.values())


def test_llenar_escapa_el_html():
    lleno = aviso.llenar("<p>{{responsable}} · {{x}}</p>",
                         {"responsable": 'Ana & "Beto" <SA>', "x": "1"})
    assert lleno == "<p>Ana &amp; &quot;Beto&quot; &lt;SA&gt; · 1</p>"


@pytest.mark.parametrize("texto", ["{{no_existe}}", "hola {{responsable}} {{respnsable}}"])
def test_un_marcador_sin_clave_revienta(texto):
    with pytest.raises(aviso.MarcadorDesconocido, match="sin clave"):
        aviso.llenar(texto)


@pytest.mark.parametrize("texto", ["{{ responsable }}", "{{responsable}", "{{Responsable-X}}"])
def test_un_marcador_mal_escrito_tampoco_sale_crudo(texto):
    with pytest.raises(aviso.MarcadorDesconocido):
        aviso.llenar(texto)


def test_renderizar_lee_del_directorio_que_le_den_y_cachea(tmp_path):
    f = tmp_path / "p.html"
    f.write_text("<h1>{{largo_maximo}}</h1>", encoding="utf-8")
    assert aviso.renderizar("p.html", tmp_path) == f"<h1>{publico.LARGO_MAXIMO}</h1>"
    # mismo archivo sin cambiar de fecha: sale de la caché, no del disco
    antes = f.stat().st_mtime_ns
    f.write_text("<h1>otra cosa</h1>", encoding="utf-8")
    os.utime(f, ns=(antes, antes))
    assert aviso.renderizar("p.html", tmp_path) == f"<h1>{publico.LARGO_MAXIMO}</h1>"
    # si el archivo cambia (local), se vuelve a leer
    os.utime(f, ns=(antes + 10**9, antes + 10**9))
    assert aviso.renderizar("p.html", tmp_path) == "<h1>otra cosa</h1>"


def test_renderizar_por_defecto_lee_static():
    assert aviso.ESTATICOS == RAIZ / "static"


@pytest.mark.parametrize("nombre", PAGINAS)
def test_las_paginas_reales_solo_piden_huecos_que_existen(nombre):
    ruta = RAIZ / "static" / nombre
    if not ruta.is_file():
        pytest.skip(f"static/{nombre} todavía no existe")
    lleno = aviso.renderizar(nombre)                  # revienta si falta una clave
    assert "{{" not in lleno and "}}" not in lleno


@pytest.mark.parametrize("nombre", PAGINAS)
def test_las_paginas_reales_caben_en_la_csp(nombre):
    """Con script-src/style-src 'self', lo que vaya en línea el navegador
    simplemente no lo corre: la página se vería rota sin ningún error."""
    ruta = RAIZ / "static" / nombre
    if not ruta.is_file():
        pytest.skip(f"static/{nombre} todavía no existe")
    html = re.sub(r"<!--.*?-->", "", ruta.read_text(encoding="utf-8"), flags=re.S)
    assert not re.search(r"<script(?![^>]*\bsrc=)[^>]*>", html, re.I), "<script> en línea"
    assert not re.search(r"<style\b", html, re.I), "<style>"
    assert not re.search(r"\sstyle\s*=", html, re.I), "atributo style="
    assert not re.search(r"\son[a-z]+\s*=", html, re.I), "manejador on…= en línea"
    assert "challenges.cloudflare.com" not in html


# RAG·13 — la versión del aviso es lo ÚNICO que dice qué texto aceptó cada
# correo guardado (automatiza_contactos.aviso_version), así que cada versión
# queda atada a la huella de su texto: el aviso simplificado, las líneas de
# letra chica, la casilla, /privacidad y /terminos, ya llenos con DATOS. Si
# cambias cualquiera de esos textos —o llenas un hueco de DATOS—, sube
# AVISO_VERSION (server/aviso.py) y AGREGA aquí su huella. Una huella que ya
# está no se edita: sería reescribir lo que aceptó alguien.
HUELLAS_AVISO = {
    "2026-09-29-borrador": "399d7881c48c7beb66c41bfa5ed544cbf67d4847965388fd094ff8cb088c4e2f",
}


def _texto_visible(pagina: str) -> str:
    pagina = re.sub(r"<!--.*?-->", " ", pagina, flags=re.S)
    pagina = re.sub(r"<head\b.*?</head>", " ", pagina, flags=re.S | re.I)
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", pagina)).split())


def _huella_del_aviso() -> str:
    pagina = (RAIZ / "static" / "automatiza.html").read_text(encoding="utf-8")
    trozos = [aviso.RECONTACTO_TEXTO]
    trozos += re.findall(r'<template id="plantilla-aviso[^"]*">.*?</template>', pagina, flags=re.S)
    trozos += re.findall(r'<p class="chica letra-chica">.*?</p>', pagina, flags=re.S)
    trozos += re.findall(r'<label class="casilla">.*?</label>', pagina, flags=re.S)
    trozos += [(RAIZ / "static" / n).read_text(encoding="utf-8")
               for n in ("privacidad.html", "terminos.html")]
    texto = "\n".join(_texto_visible(aviso.llenar(t)) for t in trozos)
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def test_cada_version_del_aviso_tiene_un_solo_texto():
    huella = _huella_del_aviso()
    assert aviso.AVISO_VERSION in HUELLAS_AVISO, (
        f"AVISO_VERSION «{aviso.AVISO_VERSION}» no tiene huella: agrega "
        f"\"{aviso.AVISO_VERSION}\": \"{huella}\" a HUELLAS_AVISO")
    assert HUELLAS_AVISO[aviso.AVISO_VERSION] == huella, (
        "cambió el texto del aviso, de la casilla o de los términos (o un hueco "
        "de DATOS) sin subir AVISO_VERSION: súbela en server/aviso.py y agrega "
        f"su huella «{huella}». La de «{aviso.AVISO_VERSION}» no se toca.")


def test_la_huella_cambia_con_el_texto(monkeypatch):
    antes = _huella_del_aviso()
    monkeypatch.setitem(aviso.DATOS, "plazo_correo", "12 meses")
    assert _huella_del_aviso() != antes
    monkeypatch.setattr(aviso, "RECONTACTO_TEXTO", aviso.RECONTACTO_TEXTO + " y ofertas")
    assert _huella_del_aviso() != antes


# ---------------------------------------------------------------------------
# las rutas (con páginas de mentira)

@pytest.fixture
def paginas(tmp_path, monkeypatch):
    for nombre in PAGINAS:
        (tmp_path / nombre).write_text(
            f"<!doctype html><title>{nombre}</title><p>{{{{responsable}}}}</p>"
            f"<p>{{{{recontacto_texto}}}}</p><p>0 / {{{{largo_maximo}}}}</p>",
            encoding="utf-8")
    monkeypatch.setattr(aviso, "ESTATICOS", tmp_path)
    return tmp_path


@pytest.fixture
def cliente(paginas, monkeypatch):
    # con login exigido: ninguna de estas páginas puede pedir sesión
    monkeypatch.setenv("COGNITO_POOL_ID", "us-east-1_TESTPOOL")
    monkeypatch.setenv("COGNITO_CLIENT_ID", "clienteweb123")
    from server.app import app
    return TestClient(app)


def _cabeceras_comunes(r):
    assert r.headers["content-security-policy"] == CSP
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert r.headers["permissions-policy"] == "camera=(), microphone=(), geolocation=()"
    assert r.headers["cache-control"] == "no-cache"


@pytest.mark.parametrize("ruta", ["/automatiza", "/privacidad", "/terminos"])
def test_las_tres_paginas_se_sirven_llenas_y_con_su_csp(cliente, ruta):
    r = cliente.get(ruta, follow_redirects=False)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    _cabeceras_comunes(r)
    assert "{{" not in r.text
    assert aviso.RECONTACTO_TEXTO in r.text
    assert f"0 / {publico.LARGO_MAXIMO}" in r.text
    assert "[POR ESCRIBIR: nombre o razón social del responsable]" in r.text


@pytest.mark.parametrize("host,se_indexa", [
    ("irremplazables.xyz", True),
    ("IRREMPLAZABLES.XYZ", True),
    ("irremplazables.xyz:443", True),
    ("irremplazables.xyz.", True),
    ("2ecset5i94.execute-api.us-east-1.amazonaws.com", False),
    ("www.irremplazables.xyz", False),
    ("irremplazables.xyz.otro.com", False),
    ("localhost:8011", False),
    ("testserver", False),
])
@pytest.mark.parametrize("ruta", ["/automatiza", "/privacidad", "/terminos"])
def test_x_robots_tag_segun_el_host(cliente, ruta, host, se_indexa):
    r = cliente.get(ruta, headers={"Host": host})
    assert r.status_code == 200
    if se_indexa:
        assert "x-robots-tag" not in r.headers
    else:
        assert r.headers["x-robots-tag"] == "noindex, nofollow"


def test_el_enlace_para_volver_es_la_misma_pagina_y_nunca_se_indexa(cliente):
    limpia = cliente.get("/automatiza", headers={"Host": "irremplazables.xyz"})
    r = cliente.get(f"/automatiza/c/{PID}", headers={"Host": "irremplazables.xyz"})
    assert r.status_code == 200 and r.text == limpia.text
    _cabeceras_comunes(r)
    assert r.headers["x-robots-tag"] == "noindex, nofollow"


@pytest.mark.parametrize("raro", ["corto", "x" * 17, "AAAAAAAAAAAAAAA.", "AAAAAAAAAAAAAAAA%0A",
                                  "AAAAAAAAAAAAAAA%20"])
def test_el_enlace_para_volver_con_id_raro_es_404(cliente, raro):
    """Un enlace que un chat cortó: 404, pero con la MISMA página (llena, con
    su CSP y sin indexar), no una hoja en blanco sin estilos ni lang. El JS
    ve que la ruta no trae un id y enseña «No encontramos esa petición»."""
    limpia = cliente.get("/automatiza", headers={"Host": "irremplazables.xyz"})
    r = cliente.get(f"/automatiza/c/{raro}", headers={"Host": "irremplazables.xyz"})
    assert r.status_code == 404
    _cabeceras_comunes(r)
    assert r.headers["x-robots-tag"] == "noindex, nofollow"
    assert "etag" not in r.headers
    assert "{{" not in r.text and r.text == limpia.text


def test_la_barra_final_redirige_sin_perder_los_utm(cliente):
    r = cliente.get("/automatiza/?utm_source=ig&utm_campaign=oct", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == "/automatiza?utm_source=ig&utm_campaign=oct"
    r = cliente.get("/automatiza/", follow_redirects=False)
    assert r.headers["location"] == "/automatiza"


@pytest.mark.parametrize("cruda,limpia", [
    ("/automatiza.html", "/automatiza"), ("/privacidad.html", "/privacidad"),
    ("/terminos.html", "/terminos"),
])
def test_la_plantilla_cruda_nunca_se_ve(cliente, cruda, limpia):
    r = cliente.get(cruda, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == limpia
    r = cliente.get(cruda + "?utm_source=x", follow_redirects=False)
    assert r.headers["location"] == limpia + "?utm_source=x"


@pytest.mark.parametrize("rodeo", ["//automatiza.html", "/%2E/terminos.html",
                                   "/fuentes/%2E%2E/privacidad.html"])
def test_ni_por_un_rodeo_sale_la_plantilla_cruda(cliente, rodeo):
    # el montaje «/» normaliza la ruta al mismo archivo que la redirección no ve
    # (URL completa: «//x» a secas, httpx lo lee como otro host)
    r = cliente.get("http://testserver" + rodeo, follow_redirects=False)
    assert r.status_code == 302 and "{{" not in r.text
    assert r.headers["location"] in ("/automatiza", "/privacidad", "/terminos")


def test_las_redirecciones_van_antes_que_el_montaje_de_static():
    from server.app import app
    caminos = [getattr(r, "path", None) for r in app.routes]
    raiz = next(i for i, r in enumerate(app.routes)
                if type(r).__name__ == "Mount" and r.path == "")
    for c in ("/automatiza", "/automatiza/", "/automatiza/c/{publico_id}", "/privacidad",
              "/terminos", "/automatiza.html", "/privacidad.html", "/terminos.html"):
        assert caminos.index(c) < raiz, c


def test_revalidar_con_etag_da_304(cliente):
    r = cliente.get("/automatiza")
    etag = r.headers["etag"]
    r2 = cliente.get("/automatiza", headers={"If-None-Match": etag})
    assert r2.status_code == 304 and r2.content == b""
    assert r2.headers["content-security-policy"] == CSP


def test_si_la_pagina_no_existe_es_404_no_500(cliente, paginas):
    (paginas / "terminos.html").unlink()
    r = cliente.get("/terminos")
    assert r.status_code == 404 and r.headers["x-robots-tag"] == "noindex, nofollow"


def test_una_pagina_con_marcador_desconocido_no_sale_cruda(paginas, monkeypatch):
    (paginas / "privacidad.html").write_text("<p>{{responsabel}}</p>", encoding="utf-8")
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    from server.app import app
    r = TestClient(app, raise_server_exceptions=False).get("/privacidad")
    assert r.status_code == 500 and "responsabel" not in r.text


def test_el_dominio_que_se_indexa_es_el_de_la_infra():
    from server.app import DOMINIO_INDEXABLE
    infra = (RAIZ / "infra" / "stacks" / "dominio.py").read_text(encoding="utf-8")
    assert re.search(r'^DOMINIO = "([^"]+)"', infra, re.M).group(1) == DOMINIO_INDEXABLE


# ---------------------------------------------------------------------------
# robots.txt

def _robots() -> str:
    return (RAIZ / "static" / "robots.txt").read_text(encoding="utf-8")


def test_robots_deja_pasar_lo_publico_de_automatiza():
    reglas = {l.strip() for l in _robots().splitlines() if not l.startswith("#")}
    for ruta in ("/automatiza$", "/privacidad$", "/terminos$", "/automatiza.css",
                 "/automatiza.js", "/sondeo.js", "/legal.css", "/automatiza-og.png"):
        assert f"Allow: {ruta}" in reglas, ruta
    assert "Disallow: /" in reglas


def test_robots_no_deja_pasar_el_enlace_para_volver():
    reglas = [l for l in _robots().splitlines() if l.startswith("Allow:")]
    # «Allow: /automatiza» sin $ dejaría pasar /automatiza/c/… por prefijo
    assert all(not r.split(":", 1)[1].strip().startswith("/automatiza/") for r in reglas)
    assert "Allow: /automatiza\n" not in _robots()


def _robots_permite(url: str) -> bool:
    """Como Googlebot y Twitterbot (RFC 9309): la regla se compara con la ruta
    MÁS el query, «$» es el fin de toda la URL y «*» cualquier cosa; gana la
    regla más larga que case y, a igual largo, Allow."""
    mejor = None
    for linea in _robots().splitlines():
        clave, _, patron = linea.partition(":")
        clave, patron = clave.strip().lower(), patron.strip()
        if clave not in ("allow", "disallow") or not patron:
            continue
        rx = re.escape(patron).replace(r"\*", ".*")
        rx = rx[:-2] + "$" if rx.endswith(r"\$") else rx
        if re.match(rx, url):
            peso = (len(patron), clave == "allow")
            if mejor is None or peso > mejor[0]:
                mejor = (peso, clave)
    return mejor is None or mejor[1] == "allow"


@pytest.mark.parametrize("url,pasa", [
    ("/automatiza", True),
    # los enlaces que se reparten por canal (RAG·10/28): sin esto X y LinkedIn
    # no leen la página y no enseñan la tarjeta con la imagen
    ("/automatiza?utm_source=x&utm_medium=social", True),
    ("/automatiza?utm_source=whatsapp", True),
    ("/privacidad", True), ("/terminos", True), ("/automatiza-og.png", True),
    ("/automatiza.css", True), ("/sondeo.js", True),
    (f"/automatiza/c/{PID}", False), (f"/automatiza/c/{PID}?utm_source=x", False),
    ("/automatizacion", False), ("/estudio/", False), ("/api/publico/estado", False),
])
def test_robots_como_lo_lee_un_buscador(url, pasa):
    assert _robots_permite(url) is pasa


def test_robots_se_sirve(cliente):
    r = cliente.get("/robots.txt")
    assert r.status_code == 200 and "Allow: /automatiza$" in r.text
