"""RAG·10/13 — las páginas públicas de /automatiza y sus legales.

  · se sirven LLENAS: server/aviso.py pone los {{huecos}} del dueño con escape
    HTML, y un marcador sin clave revienta en vez de salir crudo;
  · con su CSP y demás cabeceras, y X-Robots-Tag según el Host (solo
    irremplazables.xyz se indexa; /automatiza/c/… nunca);
  · la plantilla cruda (/automatiza.html…) no se ve: 302 a la ruta limpia;
  · robots.txt deja pasar lo público y no el enlace para volver.

Las rutas se prueban con páginas de mentira en un directorio temporal. De las
de verdad aquí se comprueba que no piden huecos que no hay, que caben en la
CSP y —desde la bajada de main del 4-oct-2026— el marco del texto legal: quién
responde, que no cite leyes de un país que no es el del responsable y que lo
que solo vale para /automatiza no se salga de su sección. (Lo que ve el
navegador en /privacidad y /terminos, con el candado de pendientes, lo prueba
tests/test_entrar_portada.py: esas pruebas llegaron de main.)"""
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


def test_datos_dice_quien_responde_y_ya_no_trae_huecos():
    """Lo que decidió el dueño (3-oct-2026) y lo que main ya publica: si un
    dato de aquí cambia, cambia también lo que dice producción."""
    assert aviso.DATOS["responsable"] == "Fundamentos AI LLC"
    assert aviso.DATOS["domicilio"] == ("2803 Philadelphia Pike, STE B #1531, "
                                        "Claymont, DE 19703 US")
    assert aviso.DATOS["correo_privacidad"] == "hola@irremplazables.xyz"
    for clave, valor in aviso.DATOS.items():
        # ni «[POR ESCRIBIR…]» ni ningún otro hueco entre corchetes
        assert "[" not in valor and "POR DECIDIR" not in valor, clave
    # la versión y la fecha que muestran las páginas van juntas
    meses = ("enero febrero marzo abril mayo junio julio agosto septiembre "
             "octubre noviembre diciembre").split()
    a, m, d = (int(x) for x in aviso.AVISO_VERSION.split("-"))
    assert aviso.DATOS["fecha_aviso"] == f"{d} de {meses[m - 1]} de {a}"


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
# petición y cada correo guardados (automatiza_corridas.aviso_version y
# automatiza_contactos.aviso_version), así que cada versión
# queda atada a la huella de su texto: el aviso simplificado (el diálogo, con
# su casilla de aceptar), las líneas de letra chica, las casillas,
# /privacidad y /terminos, ya llenos con DATOS. Si
# cambias cualquiera de esos textos —o llenas un hueco de DATOS—, sube
# AVISO_VERSION (server/aviso.py) y AGREGA aquí su huella. Una huella que ya
# está no se edita: sería reescribir lo que aceptó alguien. (La de
# «2026-09-29-borrador» se recalculó el mismo 29-sep al pasar el aviso a un
# pop-up que se acepta antes de pedir: esa versión nunca se publicó.)
#
# «2026-10-04» es la bajada de main (PR #174): el aviso y los términos pasan a
# ser los de TODO Irremplazables —el texto del Estudio que main publicó como
# 2026-10-03, más la sección 14 de /automatiza—, con el responsable, el
# domicilio y el contacto ya escritos y sin el marco legal del borrador.
HUELLAS_AVISO = {
    "2026-09-29-borrador": "7c6700fa06e34f0b8f8db0c6e16c494b399981168fba858974303cd4e17f6827",
    "2026-10-04": "bd841e9f4bce94fe2587c2bf068db23913133bc9a116c3d626fc17f9b313dbab",
}


def _texto_visible(pagina: str) -> str:
    pagina = re.sub(r"<!--.*?-->", " ", pagina, flags=re.S)
    pagina = re.sub(r"<head\b.*?</head>", " ", pagina, flags=re.S | re.I)
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", pagina)).split())


def _huella_del_aviso() -> str:
    pagina = (RAIZ / "static" / "automatiza.html").read_text(encoding="utf-8")
    trozos = [aviso.RECONTACTO_TEXTO]
    # el aviso simplificado es UN diálogo (RAG·13), con la casilla de aceptar
    trozos += re.findall(r'<dialog id="dialogo-aviso".*?</dialog>', pagina, flags=re.S)
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
# el marco del texto legal (la bajada de main, 4-oct-2026)
#
# /privacidad y /terminos son los de TODO Irremplazables: secciones 1 a 13, el
# Estudio (el texto de main); sección 14, /automatiza. El responsable es una
# empresa de Estados Unidos y los términos se rigen por Delaware: así lo
# decidió el dueño y así lo publica main.

LEGALES = ("privacidad.html", "terminos.html")


def _real(nombre: str) -> str:
    """La página de verdad, ya llena y sin comentarios: lo que lee la gente."""
    return re.sub(r"<!--.*?-->", "", aviso.renderizar(nombre), flags=re.S)


def _parte_automatiza(pagina: str) -> str:
    m = re.search(r'<section class="parte" id="automatiza".*?</section>', pagina, flags=re.S)
    assert m, "falta la sección de /automatiza"
    return m.group(0)


@pytest.mark.parametrize("nombre", LEGALES)
def test_las_legales_dicen_quien_responde_y_su_version(nombre):
    texto = _texto_visible(_real(nombre))
    for dato in ("Fundamentos AI LLC",
                 "2803 Philadelphia Pike, STE B #1531, Claymont, DE 19703 US",
                 "hola@irremplazables.xyz"):
        assert dato in texto, (nombre, dato)
    assert (f"Versión {aviso.AVISO_VERSION} · última actualización "
            f"{aviso.DATOS['fecha_aviso']}") in texto


def test_los_terminos_se_rigen_por_delaware():
    texto = _texto_visible(_real("terminos.html"))
    assert "se rigen por las leyes del estado de Delaware, Estados Unidos" in texto


@pytest.mark.parametrize("nombre", PAGINAS)
def test_el_texto_no_trae_restos_del_borrador_de_marco_mexicano(nombre):
    """El borrador del 29-sep citaba la ley mexicana de datos, sus derechos
    por su sigla, su autoridad y sus tribunales. Nada de eso es del
    responsable: si vuelve, vuelve por una fusión mal resuelta."""
    texto = _texto_visible(_real(nombre))
    for resto in (r"\bLFPDPPP\b", r"\bARCO\b", r"\bINAI\b", r"\bPROFECO\b", r"Secretar[ií]a",
                  r"M[eé]xic", r"Mexican", r"remisi[oó]n", r"\bencargados\b"):
        assert not re.search(resto, texto), (nombre, resto)
    for resto in ("aviso de privacidad integral", "aviso de privacidad simplificado",
                  "borrador para revisión", "falta por escribir"):
        assert resto not in texto.lower(), (nombre, resto)


def test_cada_legal_tiene_sus_catorce_secciones_y_la_ultima_es_automatiza():
    for nombre in LEGALES:
        pagina = _real(nombre)
        titulos = re.findall(r'<h2 id="[a-z-]+-t">(\d+)\. ', pagina)
        assert titulos == [str(n) for n in range(1, 15)], (nombre, titulos)
        assert '<h2 id="automatiza-t">14. /automatiza' in _parte_automatiza(pagina)
        # el índice lleva las mismas catorce, y la de /automatiza se alcanza
        indice = re.search(r'<nav class="indice".*?</nav>', pagina, flags=re.S).group(0)
        assert len(re.findall(r'<li><a href="#', indice)) == 14, nombre
        assert 'href="#automatiza"' in indice, nombre


# Lo que es cierto de /automatiza y FALSO del Estudio, que sí tiene cuenta,
# créditos y cookies de sesión. Fuera de la sección 14 cualquiera de estas
# frases contradice al resto del documento.
SOLO_DE_AUTOMATIZA = ("no necesitas cuenta", "no te pedimos tu nombre",
                      "no pone cookies propias", "gratis")


@pytest.mark.parametrize("nombre", LEGALES)
def test_lo_que_solo_vale_para_automatiza_no_se_sale_de_su_seccion(nombre):
    pagina = _real(nombre)
    parte = _parte_automatiza(pagina)
    fuera = _texto_visible(pagina.replace(parte, "")).lower()
    for frase in SOLO_DE_AUTOMATIZA:
        assert frase not in fuera, (nombre, frase)
    # y dentro sí lo dice: la sección no se quedó sin lo suyo
    assert "no necesitas cuenta" in _texto_visible(parte).lower(), nombre


def test_el_aviso_no_promete_un_plazo_ni_un_proveedor_que_nadie_decidio():
    """Los plazos de /automatiza (RAG·0) y su proveedor de envío (RAG·14)
    siguen sin decidir y ningún código borra ni manda nada: el aviso lo dice
    así. Cuando el dueño decida, cambia DATOS, este test y AVISO_VERSION."""
    parte = _texto_visible(_parte_automatiza(_real("privacidad.html")))
    sin_fijar = "un plazo que todavía no está fijado"
    assert aviso.DATOS["plazo_peticion"] == aviso.DATOS["plazo_correo"] == sin_fijar
    assert parte.count(f"Durante {sin_fijar}.") == 2
    assert "no los borra por sí sola" in parte
    assert "Todavía no hay un proveedor conectado" in parte
    fuente = (RAIZ / "pipeline" / "db.py").read_text(encoding="utf-8")
    assert not re.search(r"DELETE FROM\s+automatiza_", fuente), (
        "ya hay código que borra corridas o correos: el aviso tiene que decir el plazo")


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
    # el hueco del responsable sale lleno con lo que dice DATOS, no crudo
    assert "<p>Fundamentos AI LLC</p>" in r.text


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


@pytest.mark.parametrize("ruta", ["/privacidad", "/terminos"])
def test_las_legales_contestan_head_con_las_cabeceras_del_get(cliente, ruta):
    """`curl -I` y los verificadores de enlaces preguntan con HEAD. En main
    estas dos rutas lo contestan (FileResponse); aquí también, con las mismas
    cabeceras que el GET —CSP incluida— y sin cuerpo."""
    g = cliente.get(ruta)
    h = cliente.head(ruta)
    assert h.status_code == 200 and h.content == b""
    _cabeceras_comunes(h)
    assert h.headers["etag"] == g.headers["etag"]
    assert h.headers["content-type"] == g.headers["content-type"]
    assert h.headers["content-length"] == str(len(g.content))
    assert h.headers.get("x-robots-tag") == g.headers.get("x-robots-tag")
    # y revalida igual que el GET
    r = cliente.head(ruta, headers={"If-None-Match": g.headers["etag"]})
    assert r.status_code == 304 and r.content == b""


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
