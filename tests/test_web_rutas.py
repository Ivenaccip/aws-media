"""Las rutas por nivel bajo /estudio/ en server/web.py.

Fija lo que los tests de hoy (tests/test_web_tuberia.py) no ven: los niveles anidados, la barra final, las mayúsculas
(también las del prefijo «/Estudio/»), las barras dobles, las direcciones escritas con «%XX», lo interno («_») a cualquier
profundidad y el 404 con página (con `Vary: Accept`).

Las apps de prueba llevan, DETRÁS, el mismo montaje «/» de static/ que la app real (server/app.py, `app.mount("/", …)`):
ese montaje casa con TODO lo que no encontró un montaje antes, así que `/estudio/coi` (sin barra) cae en static/ y da 404.
Sin él Starlette redirige la barra por su cuenta (307, URL absoluta) y la prueba no vería el defecto que sí existe.

La raíz «/estudio/» (el mapa) la sirve web.py desde E5.2, junto con las entradas de antes (?prompt, ?brief,
?blotato=conectar → la página que hoy hace eso) y el alias de lo que cambió de sitio (migracion.alias_del_estudio):
ver las secciones «la raíz», «entradas viejas» y «alias» más abajo.
"""
import re
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.testclient import TestClient

from server import web

RAIZ = Path(__file__).resolve().parent.parent
HTML = {"Accept": "text/html,application/xhtml+xml"}

# «huerfano» no tiene index.html pero su hijo sí: un nivel sin página no puede dejar ciegos a sus hijos.
RUTAS = [
    "", "marketing", "marketing/distrito", "marketing/distrito/imagen", "marketing/distrito/video", "marketing/blotato",
    "marketing/blotato/agenda",
    "central", "central/distrito", "central/distrito/coi", "clip", "_vitrina", "huerfano/hijo",
]
SERVIBLES = [
    "/estudio/", "/estudio/marketing/", "/estudio/marketing/distrito/", "/estudio/marketing/distrito/imagen/",
    "/estudio/marketing/distrito/video/", "/estudio/marketing/blotato/", "/estudio/marketing/blotato/agenda/",
    "/estudio/central/", "/estudio/central/distrito/", "/estudio/central/distrito/coi/", "/estudio/clip/",
    "/estudio/_vitrina/", "/estudio/huerfano/hijo/",
]


@pytest.fixture
def dist(tmp_path):
    estudio = tmp_path / "dist" / "estudio"
    for rel in RUTAS:
        d = estudio / rel if rel else estudio
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(f"<!doctype html><title>/estudio/{rel + '/' if rel else ''}</title>", encoding="utf-8")
    (estudio / "sin-index").mkdir()
    (estudio / "assets").mkdir()
    (estudio / "assets" / "clip-Ab12.js").write_text("console.log(1)", encoding="utf-8")
    return tmp_path / "dist"


def _app(dist, alias=None, antes=None):
    """La app de prueba: lo que `antes` registre (rutas de la app), web.montar y, DETRÁS, el montaje «/» de static/."""
    app = FastAPI()
    if antes:
        antes(app)
    montadas = web.montar(app, dist, alias)
    estaticos = dist.parent / "static"
    estaticos.mkdir(exist_ok=True)
    app.mount("/", StaticFiles(directory=estaticos, html=True), name="static")   # como server/app.py: «/» se queda con lo demás
    return app, montadas


def _c(dist, alias=None, antes=None):
    return TestClient(_app(dist, alias, antes)[0], follow_redirects=False)


_IGUAL = object()


def _crudo(app, ruta, query=b"", metodo="GET", accept=None, raw=_IGUAL):
    """Una petición con el path y el query EXACTOS. TestClient (httpx) normaliza «./» y «..» y codifica el query, así que no
    sirve para lo que un cliente a mano o un servidor sin normalizar sí pueden mandar. Devuelve (estado, cabeceras, cuerpo).

    `ruta` es el `path` del scope (ya decodificado, como lo entrega uvicorn); `raw` es el `raw_path` (lo que llegó por el cable,
    con sus «%XX»): por omisión el mismo texto; `None` imita a Mangum (API Gateway), que no lo trae."""
    import asyncio
    cabeceras = [(b"host", b"testserver")] + ([(b"accept", accept.encode())] if accept else [])
    if raw is _IGUAL:
        raw = ruta.encode("utf-8", "surrogatepass")
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": metodo, "scheme": "http",
             "path": ruta, "raw_path": raw, "root_path": "", "query_string": query,
             "headers": cabeceras, "client": ("testclient", 50000), "server": ("testserver", 80), "state": {}}
    visto: dict = {"cuerpo": []}
    pedido = {"leido": False}

    async def recibir():
        # Como un servidor de verdad: el cuerpo (vacío) una vez y, después, nada hasta que el cliente se vaya. FileResponse (Starlette con
        # spec_version < 2.4, la de uvicorn) escucha `http.disconnect` mientras manda el archivo: si `recibir` contestara al instante
        # para siempre, sin ceder el turno, ese bucle no terminaría nunca (se colgaba el archivo entero con starlette 1.9). Aquí espera
        # sin fin y Starlette lo cancela al terminar de mandar.
        if not pedido["leido"]:
            pedido["leido"] = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await asyncio.Event().wait()
        return {"type": "http.disconnect"}

    async def enviar(m):
        if m["type"] == "http.response.start":
            visto["estado"] = m["status"]
            visto["cabeceras"] = {k.decode().lower(): v.decode("latin-1") for k, v in m["headers"]}
        elif m["type"] == "http.response.body":
            visto["cuerpo"].append(m.get("body", b""))

    asyncio.run(app(scope, recibir, enviar))
    return visto["estado"], visto["cabeceras"], b"".join(visto["cuerpo"]).decode("utf-8", "replace")


def test_la_app_de_prueba_imita_a_la_real():
    """Si server/app.py dejara de montar static/ en «/», estas pruebas ya no verían el 404 real."""
    fuente = (RAIZ / "server" / "app.py").read_text(encoding="utf-8")
    assert 'app.mount("/", ' in fuente and fuente.index("web.montar(app)") < fuente.index('app.mount("/", ')


# ---------------------------------------------------------------------------
# el registro

def test_el_registro_cuenta_la_raiz_y_cada_nivel_a_cualquier_profundidad_pero_no_los_assets(dist):
    r = web.rutas(dist / "estudio")
    assert r == frozenset(SERVIBLES)
    assert "/estudio/" in r, "la raíz es la página principal"
    assert not any("assets" in x for x in r)
    assert "/estudio/sin-index/" not in r and "/estudio/huerfano/" not in r


def test_montar_devuelve_las_rutas_servibles_sin_barra_final_con_las_anidadas(dist):
    montadas = _app(dist)[1]
    assert montadas == [
        "/estudio/assets",
        # la raíz: la principal
        "/estudio",
        # primer nivel con página propia (huerfano no la tiene)
        "/estudio/_vitrina", "/estudio/central", "/estudio/clip", "/estudio/marketing",
        # anidados, en orden: es lo que mira migracion.montar (`p.nueva.rstrip("/") in montadas`)
        "/estudio/central/distrito", "/estudio/central/distrito/coi", "/estudio/huerfano/hijo",
        "/estudio/marketing/blotato", "/estudio/marketing/blotato/agenda", "/estudio/marketing/distrito",
        "/estudio/marketing/distrito/imagen", "/estudio/marketing/distrito/video",
    ]
    assert not any(m.endswith("/") for m in montadas)


def test_lo_que_devuelve_montar_es_lo_que_la_app_sirve(dist):
    app, montadas = _app(dist)
    c = TestClient(app, follow_redirects=False)
    for m in montadas:
        if m != "/estudio/assets":
            assert c.get(m + "/").status_code == 200, m


# ---------------------------------------------------------------------------
# servir

@pytest.mark.parametrize("ruta", SERVIBLES)
def test_cada_nivel_se_sirve_en_su_url_con_html_que_revalida(dist, ruta):
    c = _c(dist)
    r = c.get(ruta)
    assert r.status_code == 200 and "text/html" in r.headers["content-type"]
    assert f"<title>{ruta}</title>" in r.text
    assert r.headers["cache-control"] == "no-cache"
    assert ("x-robots-tag" in r.headers) == ruta.startswith("/estudio/_")
    assert c.head(ruta).status_code == 200


def test_un_nivel_sin_pagina_no_deja_ciegos_a_sus_hijos_y_el_mismo_da_404(dist):
    c = _c(dist)
    assert c.get("/estudio/huerfano/hijo/").status_code == 200
    assert c.get("/estudio/huerfano/").status_code == 404
    assert c.get("/estudio/huerfano").status_code == 404, "no hay página a la que mandarlo"


def test_la_raiz_y_los_anidados_contestan_304_con_etag(dist):
    c = _c(dist)
    for ruta in ("/estudio/", "/estudio/marketing/", "/estudio/marketing/distrito/imagen/"):
        et = c.get(ruta).headers["etag"]
        r = c.get(ruta, headers={"If-None-Match": et})
        assert r.status_code == 304 and r.headers["cache-control"] == "no-cache"


def test_la_carpeta_interna_se_marca_noindex_tambien_en_lo_anidado(dist):
    d = dist / "estudio" / "_vitrina" / "sub"
    d.mkdir()
    (d / "index.html").write_text("<title>sub</title>", encoding="utf-8")
    c = _c(dist)
    assert c.get("/estudio/_vitrina/").headers["x-robots-tag"] == "noindex, nofollow"
    assert c.get("/estudio/_vitrina/sub/").headers["x-robots-tag"] == "noindex, nofollow"
    assert "x-robots-tag" not in c.get("/estudio/marketing/distrito/").headers


def test_una_carpeta_interna_anidada_bajo_un_area_publica_tambien_es_noindex(dist):
    """«_» en CUALQUIER nivel es interno (S1): `marketing/_borrador` no es de primer nivel y se sirve desde el montaje de `marketing`."""
    estudio = dist / "estudio"
    for rel in ("marketing/_borrador", "marketing/distrito/_prueba", "marketing/mi_pagina"):
        d = estudio / rel
        d.mkdir(parents=True)
        (d / "index.html").write_text(f"<title>{rel}</title>", encoding="utf-8")
    c = _c(dist)
    for interna in ("/estudio/marketing/_borrador/", "/estudio/marketing/distrito/_prueba/"):
        r = c.get(interna)
        assert r.status_code == 200 and r.headers["x-robots-tag"] == "noindex, nofollow", interna
        assert c.head(interna).headers["x-robots-tag"] == "noindex, nofollow", interna
    # el guion bajo en MEDIO del nombre no vuelve interna a la página, ni tampoco el de una hermana
    for publica in ("/estudio/marketing/mi_pagina/", "/estudio/marketing/", "/estudio/marketing/distrito/"):
        assert "x-robots-tag" not in c.get(publica).headers, publica


# ---------------------------------------------------------------------------
# la raíz (E5.2): la página principal

def test_la_raiz_se_sirve_con_html_que_revalida_y_en_head(dist):
    c = _c(dist)
    for metodo in (c.get, c.head):
        r = metodo("/estudio/")
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/html"), metodo.__name__
        assert r.headers["cache-control"] == "no-cache" and "x-robots-tag" not in r.headers
    assert "<title>/estudio/</title>" in c.get("/estudio/").text
    assert c.get("/estudio/?p=1&x=2").status_code == 200, "el query de siempre no estorba"
    # solo GET y HEAD: un POST a la raíz no se redirige ni se sirve
    r = c.post("/estudio/")
    assert r.status_code == 405 and "location" not in r.headers


def test_la_raiz_no_sirve_el_archivo_por_su_nombre(dist):
    """La principal es «/estudio/»; «/estudio/index.html» no es una dirección (ni las del montaje de static/)."""
    c = _c(dist)
    for pedido in ("/estudio/index.html", "/estudio/rutas.json"):
        r = c.get(pedido)
        assert r.status_code == 404 and r.json() == {"detail": "Not Found"} and "location" not in r.headers, pedido
        assert "<title>/estudio/</title>" not in c.get(pedido, headers=HTML).text, pedido


def test_sin_estudio_index_html_no_se_sirve_la_raiz_ni_se_redirige_a_la_nada(tmp_path):
    """Un dist sin la raíz (un build viejo): `/estudio/` da 404 y `montar` no anuncia «/estudio» (migracion.decidir lo lee: sin
    ella `/index.html` sigue sirviendo el clásico en vez de mandar a un 404). Las entradas de antes tampoco redirigen."""
    estudio = tmp_path / "dist" / "estudio"
    for rel in ("marketing/distrito/imagen", "marketing/blotato"):
        (estudio / rel).mkdir(parents=True)
        (estudio / rel / "index.html").write_text("<title>x</title>", encoding="utf-8")
    app, montadas = _app(tmp_path / "dist")
    assert "/estudio" not in montadas and "/estudio/marketing/blotato" in montadas
    c = TestClient(app, follow_redirects=False)
    for pedido in ("/estudio/", "/estudio/?prompt=x", "/estudio/?blotato=conectar"):
        r = c.get(pedido)
        assert r.status_code == 404 and "location" not in r.headers, pedido


# ---------------------------------------------------------------------------
# entradas viejas (E5.2): lo que el inicio de una sola página leía de la barra de direcciones

@pytest.mark.parametrize("pedido, destino", [
    ("/estudio/?blotato=conectar", "/estudio/marketing/blotato/?blotato=conectar"),
    ("/estudio/?prompt=un%20faro&modelo=x", "/estudio/marketing/distrito/imagen/?prompt=un%20faro&modelo=x"),
    ("/estudio/?prompt=hola%20mundo", "/estudio/marketing/distrito/imagen/?prompt=hola%20mundo"),
    ("/estudio/?brief=hola", "/estudio/marketing/distrito/video/?brief=hola"),
    ("/estudio/?x=1&brief=a%26b&y=2", "/estudio/marketing/distrito/video/?x=1&brief=a%26b&y=2"),
    ("/estudio/?blotato=conectar&x=1", "/estudio/marketing/blotato/?blotato=conectar&x=1"),
    # sin parámetro, el destino sigue siendo el mismo
    ("/estudio/?prompt=", "/estudio/marketing/distrito/imagen/?prompt="),
])
def test_la_raiz_con_un_parametro_de_antes_manda_a_la_herramienta_con_el_query_intacto(dist, pedido, destino):
    c = _c(dist)
    for metodo in (c.get, c.head):
        r = metodo(pedido)
        assert r.status_code == 302 and r.headers["location"] == destino, (metodo.__name__, pedido)
        assert r.headers["cache-control"] == "no-store"
    # el destino se sirve de verdad: ni un segundo salto ni un bucle
    seguido = TestClient(_app(dist)[0], follow_redirects=True).get(pedido)
    assert seguido.status_code == 200 and len(seguido.history) == 1


@pytest.mark.parametrize("pedido", ["/estudio/", "/estudio/?p=abc", "/estudio/?blotato=otra", "/estudio/?blotato=",
                                    "/estudio/?desde=mkt.x.y&ver=mapa", "/estudio/?Prompt=x", "/estudio/?promptx=1", "/estudio/?x=prompt"])
def test_la_raiz_con_cualquier_otro_query_se_sirve_tal_cual(dist, pedido):
    r = _c(dist).get(pedido)
    assert r.status_code == 200 and "<title>/estudio/</title>" in r.text, pedido


def test_la_entrada_vieja_sin_su_destino_compilado_sirve_la_raiz_y_no_redirige_a_la_nada(dist):
    """El destino sale de la tabla y solo se usa si está en el registro: sin la Caja en Imagen, `?prompt=` no manda a un 404."""
    import shutil
    shutil.rmtree(dist / "estudio" / "marketing" / "distrito" / "imagen")
    c = _c(dist)
    assert c.get("/estudio/?prompt=x").status_code == 200
    assert c.get("/estudio/?brief=x").status_code == 302, "las demás entradas no se afectan"


def test_la_entrada_vieja_manda_a_una_pagina_que_existe_y_es_la_de_la_caja_o_la_de_blotato():
    """Cada destino de ENTRADAS_VIEJAS está en el registro de las páginas de web/estudio (lo que web/dist compila) y es la página
    que de verdad hace eso: la Caja preseleccionada en su pestaña, o el grupo Blotato. Si alguien mueve una carpeta, esto avisa
    antes que el 404 (lee las fuentes: no necesita web/dist)."""
    fuente = RAIZ / "web" / "estudio"
    registro = web.rutas(fuente)
    assert "/estudio/" in registro
    esperado = {"prompt": ("herramienta.tsx", "· Imagen"), "brief": ("herramienta.tsx", "· Video"),
                "blotato": ("nivel.tsx", "Blotato")}
    assert {p for p, _, _ in web.ENTRADAS_VIEJAS} == set(esperado)
    for param, valor, destino in web.ENTRADAS_VIEJAS:
        assert destino in registro, (param, destino)
        html = (fuente / destino.removeprefix("/estudio/") / "index.html").read_text(encoding="utf-8")
        modulo, titulo = esperado[param]
        assert f'src="/src/pantallas/inicio/{"niveles/" if modulo == "nivel.tsx" else ""}{modulo}"' in html, (param, destino)
        assert re.search(rf"<title>[^<]*{re.escape(titulo)}</title>", html), (param, destino, titulo)
        if param == "blotato":
            assert valor == "conectar"


def test_ninguna_entrada_vieja_apunta_a_la_raiz_ni_a_otra_entrada():
    """Cada destino es una página DISTINTA de la raíz: si no, `?prompt=` daría 302 a `/estudio/?prompt=` sin fin."""
    for param, _, destino in web.ENTRADAS_VIEJAS:
        assert destino.startswith("/estudio/") and destino != "/estudio/", param
        assert destino.endswith("/") and "?" not in destino


# ---------------------------------------------------------------------------
# la barra, las mayúsculas y las barras dobles

@pytest.mark.parametrize("pedido, destino", [
    ("/estudio/marketing", "/estudio/marketing/"),
    ("/estudio/marketing?x=1", "/estudio/marketing/?x=1"),
    ("/estudio/central", "/estudio/central/"),
    ("/estudio/marketing/distrito", "/estudio/marketing/distrito/"),
    ("/estudio/marketing/distrito/imagen?prompt=hola%20mundo&x=1", "/estudio/marketing/distrito/imagen/?prompt=hola%20mundo&x=1"),
    ("/estudio/central/distrito/coi", "/estudio/central/distrito/coi/"),
    ("/estudio/clip?p=abc", "/estudio/clip/?p=abc"),
    ("/estudio/clip?", "/estudio/clip/"),
    ("/estudio//marketing/", "/estudio/marketing/"),
    ("/estudio/marketing//distrito/", "/estudio/marketing/distrito/"),
    ("/estudio/Marketing/", "/estudio/marketing/"),
    ("/estudio/MARKETING/DISTRITO/IMAGEN", "/estudio/marketing/distrito/imagen/"),
    ("/estudio/marketing/Distrito/", "/estudio/marketing/distrito/"),
    ("/estudio/Marketing?a=B", "/estudio/marketing/?a=B"),
    ("/estudio/Huerfano/Hijo", "/estudio/huerfano/hijo/"),
    # el prefijo también: quien teclea «Estudio» llega igual que quien teclea «Marketing»
    ("/Estudio/marketing/", "/estudio/marketing/"),
    ("/Estudio/Marketing", "/estudio/marketing/"),
    ("/ESTUDIO/marketing/distrito?x=1", "/estudio/marketing/distrito/?x=1"),
    ("/ESTUDIO//Marketing//Distrito/Imagen", "/estudio/marketing/distrito/imagen/"),
])
def test_la_barra_las_mayusculas_y_las_barras_dobles_se_arreglan_con_302_y_el_query_intacto(dist, pedido, destino):
    c = _c(dist)
    for metodo in (c.get, c.head):
        r = metodo(pedido)
        assert r.status_code == 302 and r.headers["location"] == destino, (metodo.__name__, pedido)
        assert r.headers["cache-control"] == "no-store"
        assert not r.headers["location"].startswith(("http:", "https:", "//")), "el destino es relativo a este sitio"
    # y el destino se sirve de verdad: no hay un segundo salto
    assert c.get(destino).status_code == 200


def test_una_carpeta_con_puntos_en_el_nombre_se_sirve_y_se_corrige_como_las_demas(dist):
    d = dist / "estudio" / "marketing" / "v1.2"
    d.mkdir()
    (d / "index.html").write_text("<title>v1.2</title>", encoding="utf-8")
    c = _c(dist)
    assert c.get("/estudio/marketing/v1.2/").status_code == 200
    r = c.get("/estudio/marketing/V1.2?x=1")
    assert r.status_code == 302 and r.headers["location"] == "/estudio/marketing/v1.2/?x=1"
    assert c.get("/estudio/marketing/v1x2").status_code == 404, "el punto no es un comodín"


def test_el_query_se_copia_tal_cual_aun_con_bytes_raros(dist):
    """Se copia el query en bruto: sin decodificar (no se duplican los %XX) y sin dejar pasar saltos de línea ni «#»."""
    app = _app(dist)[0]
    estado, cab, _ = _crudo(app, "/estudio/marketing", b"a=%C3%A9&b=%ff&c=%0d%0aX-Falso:%201&d=1+2")
    assert estado == 302 and cab["location"] == "/estudio/marketing/?a=%C3%A9&b=%ff&c=%0d%0aX-Falso:%201&d=1+2"
    assert "x-falso" not in cab
    # bytes crudos en el query (un cliente a mano): se codifican como los mandó, no como si fueran latin-1
    estado, cab, _ = _crudo(app, "/estudio/marketing", b"a=\xc3\xa9&b#c&d=\xff\r\nX-Falso: 1&e= ")
    assert estado == 302
    assert cab["location"] == "/estudio/marketing/?a=%C3%A9&b%23c&d=%FF%0D%0AX-Falso:%201&e=%20"
    assert "x-falso" not in cab and "\r" not in cab["location"] and "\n" not in cab["location"]
    # el 404 con página no se rompe con un query que no es UTF-8
    estado, _, cuerpo = _crudo(app, "/estudio/nada/", b"x=\xff\xfe", accept=HTML["Accept"])
    assert estado == 404 and "<h1>" in cuerpo


@pytest.mark.parametrize("ruta, destino", [
    ("/estudio/marketing/./distrito/", "/estudio/marketing/distrito/"),
    ("/estudio/marketing/../central/", "/estudio/central/"),
    ("/estudio/marketing/distrito/../../central", "/estudio/central/"),
    ("/estudio/../estudio/marketing", "/estudio/marketing/"),
    ("/estudio/./marketing", "/estudio/marketing/"),
    ("/estudio///marketing///distrito//", "/estudio/marketing/distrito/"),
])
def test_los_puntos_y_las_barras_que_un_cliente_a_mano_si_manda_se_normalizan(dist, ruta, destino):
    estado, cab, _ = _crudo(_app(dist)[0], ruta)
    assert estado == 302 and cab["location"] == destino and cab["cache-control"] == "no-store"


@pytest.mark.parametrize("raw, ruta, destino", [
    ("/estudio/%6Darketing/", "/estudio/marketing/", "/estudio/marketing/"),
    ("/estudio/%6darketing/", "/estudio/marketing/", "/estudio/marketing/"),
    ("/estudio/marketing%2Fdistrito/", "/estudio/marketing/distrito/", "/estudio/marketing/distrito/"),
    ("/estudio/marketing%2fdistrito%2Fimagen/", "/estudio/marketing/distrito/imagen/", "/estudio/marketing/distrito/imagen/"),
    ("/estudio/marketing/%64istrito/", "/estudio/marketing/distrito/", "/estudio/marketing/distrito/"),
    ("/estudio/central/distrito/%63oi/", "/estudio/central/distrito/coi/", "/estudio/central/distrito/coi/"),
    ("/estudio/%63lip/", "/estudio/clip/", "/estudio/clip/"),
    ("/estudio/%5Fvitrina/", "/estudio/_vitrina/", "/estudio/_vitrina/"),
])
def test_una_pantalla_escrita_con_porcentajes_redirige_a_su_forma_normal(dist, raw, ruta, destino):
    """uvicorn entrega `path` ya decodificado y `raw_path` tal cual llegó (RA-1): el servidor SIRVE `/estudio/%6Darketing/` pero la página
    lee `location.pathname` (crudo) y no reconoce el nivel. Se manda a la forma normal, con el query intacto y sin guardar el salto."""
    app = _app(dist)[0]
    for metodo in ("GET", "HEAD"):
        estado, cab, _ = _crudo(app, ruta, b"x=1&y=%41", metodo, raw=raw.encode())
        assert estado == 302 and cab["location"] == destino + "?x=1&y=%41", (raw, metodo)
        assert cab["cache-control"] == "no-store"
    # y ya en su forma normal se sirve de verdad, sin otro salto
    estado, cab, _ = _crudo(app, destino, raw=destino.encode())
    assert estado == 200 and "location" not in cab


def test_con_porcentajes_el_cliente_de_pruebas_tambien_redirige_y_los_otros_metodos_no(dist):
    c = _c(dist)
    r = c.get("/estudio/%6Darketing/?q=1")
    assert r.status_code == 302 and r.headers["location"] == "/estudio/marketing/?q=1"
    r = c.post("/estudio/%6Darketing/")
    assert r.status_code == 405 and "location" not in r.headers, "un POST no se manda a otra parte con un 302"


def test_sin_raw_path_o_con_una_ruta_tal_cual_no_hay_redireccion_ni_bucle(dist):
    """Mangum (API Gateway) manda `raw_path: None`: no hay con qué comparar y se sirve como siempre. Tampoco se redirige lo que
    llegó igual que su forma normal, ni lo que no es una ruta simple (un nombre con espacio o «&» se escribe con «%XX» o sin ellos
    según el navegador: ahí no se arriesga un bucle)."""
    app = _app(dist)[0]
    assert _crudo(app, "/estudio/marketing/", raw=None)[0] == 200
    assert _crudo(app, "/estudio/marketing/", raw=b"/estudio/marketing/")[0] == 200
    # sin pantalla compilada o con un destino que no es del registro, nada cambia
    assert _crudo(app, "/estudio/nada/", raw=b"/estudio/n%61da/")[0] == 404
    d = dist / "estudio" / "marketing" / "con espacio"
    d.mkdir()
    (d / "index.html").write_text("<title>espacio</title>", encoding="utf-8")
    app = _app(dist)[0]
    for raw in (b"/estudio/marketing/con%20espacio/", b"/estudio/marketing/con espacio/"):
        assert _crudo(app, "/estudio/marketing/con espacio/", raw=raw)[0] == 200, raw


# ---------------------------------------------------------------------------
# sin redirección abierta, sin 500

def _id_corto(valor):
    """El id de una prueba parametrizada con una dirección de 100 000 caracteres: sin esto pytest lo imprime entero (hasta 150 KB por
    id) y un fallo, un `-v` o un informe JUnit quedan ilegibles. Lo corto se deja como pytest lo escribe."""
    if isinstance(valor, (str, bytes)) and len(valor) > 60:
        return f"{valor[:30]!r}+{len(valor)}"
    return None


PERVERSAS = [
    "//", "///estudio/marketing", "/estudio//evil.com/", "/estudio///evil.com", "/estudio/%2F%2Fevil.com", "/estudio/%2f%2fevil.com/",
    "/estudio/\\evil.com", "/estudio/%5Cevil.com", "/estudio/marketing/..%2f..%2f", "/estudio/marketing/%2e%2e/central/",
    "/estudio/marketing/%2e%2e/%2e%2e/", "/estudio/..%2f", "/estudio/%2e%2e", "/estudio/%00", "/estudio/marketing%00/",
    "/estudio/marketing/%0d%0aLocation:%20http://evil.com", "/estudio/http://evil.com/", "/estudio/https:%2F%2Fevil.com",
    "/estudio/@evil.com/", "/estudio/;/", "/estudio/?//evil.com", "/estudio/marketing?next=//evil.com",
    "/estudio/Ñandú/", "/estudio/%F0%9F%98%80/", "/estudio/MARKETINİG/", "/estudio/MARKETING/",
    "/estudio/marketing/" + "a" * 5000, "/estudio/" + "a/" * 3000, "/estudio/" + "%2e/" * 500,
    "/estudio/marketing.", "/estudio/marketing%20", "/estudio/marketing/index.html/", "/estudio/marketing/index.html",
    "/estudio/.", "/estudio/./", "/estudio/assets", "/estudio/assets/", "/estudio/Assets/x.js", "/estudio/assets/../marketing",
]


@pytest.mark.parametrize("pedido", PERVERSAS, ids=_id_corto)
def test_ninguna_peticion_rara_da_500_ni_redirige_fuera_del_registro(dist, pedido):
    c = _c(dist)
    registro = web.rutas(dist / "estudio")
    for cabeceras in (None, HTML):
        for metodo in (c.get, c.head):
            r = metodo(pedido, headers=cabeceras)
            assert r.status_code in (200, 307, 302, 404, 405), (pedido, r.status_code)
            if "location" in r.headers:
                loc = r.headers["location"]
                assert loc.startswith("/estudio/") and not loc.startswith("//"), (pedido, loc)
                assert loc.split("?")[0] in registro | {"/estudio/assets/"}, (pedido, loc)
                if r.status_code == 302:
                    assert r.headers["cache-control"] == "no-store"


CRUDAS = [
    ("//", b""), ("///", b""), ("//estudio/marketing", b""), ("/estudio/..", b""), ("/estudio/../", b""), ("/estudio/../..", b""),
    ("/estudio/../../etc/passwd", b""), ("/estudio/marketing/../../../etc/passwd", b""), ("/estudio/\x00", b""),
    ("/estudio/marketing\x00/", b""), ("/estudio/marketing\n/", b""), ("/estudio/marketing\r\nX-Falso: 1", b""),
    ("/estudio/marketing\ud800", b""), ("/estudio/ma\u0000rketing", b""), ("/estudio/%2e%2e/marketing", b""),
    ("/estudio/marketing", b"\xff\xfe\x00"), ("/estudio/marketing", b"a=" + b"%41" * 20_000), ("/estudio/nada", b"\x00"),
    # más largas de lo que httpx deja armar
    ("/estudio/" + "a" * 100_000, b""), ("/estudio/" + "a/" * 50_000, b""), ("/estudio/" + "../" * 50_000 + "marketing", b""),
    ("/estudio/Marketing/" + "x" * 100_000, b""),
]


@pytest.mark.parametrize("ruta, query", CRUDAS, ids=_id_corto)
def test_ninguna_peticion_cruda_da_500_ni_redirige_fuera_del_registro(dist, ruta, query):
    app = _app(dist)[0]
    registro = web.rutas(dist / "estudio")
    for accept in (None, HTML["Accept"]):
        for metodo in ("GET", "HEAD"):
            estado, cab, cuerpo = _crudo(app, ruta, query, metodo, accept)
            assert estado in (200, 302, 307, 404, 405), (ruta, estado)
            if estado == 307:
                # NO es de web.py: es el `redirect_slashes` del Router de Starlette cuando el path trae un salto de línea
                # («%0A» decodificado) y solo casa con «/» sin la barra final. Va al mismo sitio (URL absoluta con el Host
                # de la petición, la barra y el salto codificados); pasa igual con cualquier otra ruta de la app.
                assert cab["location"].startswith("http://testserver/") and "\n" not in cab["location"], (ruta, cab)
                continue
            if "location" in cab:
                loc = cab["location"]
                assert loc.startswith("/estudio/") and not loc.startswith("//"), (ruta, loc)
                assert loc.split("?")[0] in registro, (ruta, loc)
                assert "\r" not in loc and "\n" not in loc
            if estado == 404 and accept:
                assert "ZZ" not in cuerpo


# ---------------------------------------------------------------------------
# el 404

@pytest.mark.parametrize("ruta", ["/estudio/nada/", "/estudio/nada", "/estudio/marketing/nada/", "/estudio/marketing/nada",
                                  "/estudio/marketing/distrito/imagen/nada/", "/estudio/sin-index/", "/estudio/huerfano/",
                                  "/estudio/index.html", "/estudio/rutas.json", "/estudio/marketing/rutas.json"])
def test_una_ruta_que_no_existe_da_404_json_si_no_se_pide_html(dist, ruta):
    r = _c(dist).get(ruta)
    assert r.status_code == 404 and r.json() == {"detail": "Not Found"}
    assert "location" not in r.headers


def test_una_ruta_que_no_existe_da_404_con_pagina_si_se_pide_html_y_lleva_un_nivel_arriba(dist):
    c = _c(dist)
    r = c.get("/estudio/marketing/distrito/nada/", headers=HTML)
    assert r.status_code == 404 and r.headers["content-type"].startswith("text/html")
    assert r.headers["x-robots-tag"] == "noindex, nofollow" and r.headers["cache-control"] == "no-cache"
    assert 'href="/estudio/marketing/distrito/"' in r.text and 'href="/estudio/"' in r.text
    assert 'href="/estudio/"' in c.get("/estudio/nada/", headers=HTML).text
    # el nivel de arriba que EXISTE, no el que se escribió: «huerfano» no tiene página, así que se sube hasta la raíz
    assert 'href="/estudio/marketing/"' in c.get("/estudio/marketing/nada/x/", headers=HTML).text
    assert 'href="/estudio/"' in c.get("/estudio/huerfano/", headers=HTML).text
    assert 'href="/estudio/marketing/distrito/"' in c.get("/estudio/Marketing/Distrito/nada/", headers=HTML).text
    # el prefijo en mayúsculas también es «bajo /estudio/» (S3)
    r = c.get("/Estudio/marketing/nada/", headers=HTML)
    assert r.status_code == 404 and r.headers["content-type"].startswith("text/html")
    assert 'href="/estudio/marketing/"' in r.text
    # el cuerpo cambia con el Accept: ninguna caché puede servir uno por el otro (R4)
    assert r.headers["vary"] == "Accept"
    assert c.get("/estudio/nada/", headers=HTML).headers["vary"] == "Accept"


def test_el_404_json_de_un_nivel_tambien_dice_que_varia_con_el_accept(dist):
    """Las dos caras del mismo 404 (R4): la de JSON también lleva `Vary: Accept`; un asset que falta (siempre JSON) o un 404 de fuera del
    estudio no varían con nada y no lo llevan."""
    c = _c(dist)
    for ruta in ("/estudio/nada/", "/estudio/marketing/nada", "/Estudio/nada/"):
        r = c.get(ruta)
        assert r.status_code == 404 and r.json() == {"detail": "Not Found"} and r.headers["vary"] == "Accept", ruta
    for ruta in ("/estudio/assets/no-existe.js", "/api/no-existe", "/fuera-del-estudio"):
        assert "vary" not in c.get(ruta, headers=HTML).headers, ruta


@pytest.mark.parametrize("accept, pagina", [
    ("text/html", True), ("TEXT/HTML;q=0.9", True), ("application/json, text/html;q=0.1", True),
    ("*/*", False), ("application/json", False), ("", False), ("text/plain", False),
    # el tipo entero, no una subcadena (S7), y q=0 es «no lo quiero»
    ("text/html;q=0", False), ("text/html; q=0.0", False), ("text/html;q=0.000, */*", False), ("text/htmlx", False), ("x/text/html", False),
    ("text/*", False), ("application/xhtml+xml", False), ("*/*;q=0.8,text/html;q=0.1", True), ("  text/html  ,  */*", True),
    ("text/html;level=1;q=0.5", True), ("text/html;q=abc", True),
])
def test_la_pagina_solo_sale_si_el_accept_pide_text_html(dist, accept, pagina):
    r = _c(dist).get("/estudio/nada/", headers={"Accept": accept})
    assert r.status_code == 404
    assert (r.headers["content-type"].startswith("text/html")) is pagina
    if not pagina:
        assert r.json() == {"detail": "Not Found"}


def test_el_404_no_refleja_lo_que_se_pidio(dist):
    c = _c(dist)
    marca = "ZZmarcaZZ"
    for pedido in (f"/estudio/<script>alert('{marca}')</script>/x/", f"/estudio/{marca}/", f"/estudio/marketing/{marca}",
                   f"/estudio/marketing/{marca}/?q={marca}&z=<b>", f"/estudio/%22%3E%3Cimg%20src=x%20onerror={marca}%3E/",
                   f"/estudio/Marketing/{marca}/", f"/estudio/{marca}ñ/‮/", f"/estudio/{marca}/" + "x" * 3000):
        for cabeceras in (HTML, None):
            r = c.get(pedido, headers=cabeceras)
            assert r.status_code == 404, pedido
            assert marca not in r.text and "alert(" not in r.text and "onerror" not in r.text, pedido
            assert marca not in "".join(r.headers.values()), pedido


def test_buscar_el_nivel_de_arriba_no_es_cuadratico_en_el_largo_de_lo_pedido(dist):
    """Una dirección de 50 000 tramos no puede costar segundos: el 404 con página mira solo tantos niveles como tiene la pantalla
    más profunda. (Cota holgada: la versión que rearmaba el prefijo en cada paso tardaba más de 5 s.)"""
    import time
    registro = web.rutas(dist / "estudio")
    t0 = time.perf_counter()
    assert web._arriba("/estudio/marketing/" + "a/" * 50_000, registro) == "/estudio/marketing/"
    assert web._arriba("/estudio/" + "a/" * 50_000, registro) == "/estudio/"
    assert time.perf_counter() - t0 < 1.0


def test_el_404_con_pagina_solo_enlaza_a_niveles_del_registro(dist):
    import re
    registro = web.rutas(dist / "estudio") | {"/estudio/"}
    for pedido in ("/estudio/nada/", "/estudio/marketing/x/y/z/", "/estudio/CENTRAL/zzz", "/estudio/%2e%2e/"):
        enlaces = set(re.findall(r'<a href="([^"]*)"', _c(dist).get(pedido, headers=HTML).text))
        assert enlaces and enlaces <= registro, (pedido, enlaces)


def test_un_asset_que_no_existe_sigue_siendo_404_json_aunque_pida_html(dist):
    c = _c(dist)
    for pedido in ("/estudio/assets/no-existe.js", "/estudio/Assets/no-existe.js", "/estudio/assets/x/y/z.css", "/estudio/assets/",
                   "/estudio/assets", "/estudio/ASSETS"):
        r = c.get(pedido, headers=HTML)
        assert r.status_code == 404 and r.json() == {"detail": "Not Found"}, pedido
    ok = c.get("/estudio/assets/clip-Ab12.js")
    assert ok.status_code == 200 and ok.headers["cache-control"] == web.INMUTABLE


@pytest.mark.parametrize("pedido", [
    "/estudio//assets/no.js", "/estudio/./assets/no.js", "/estudio/x/../assets/no.js", "/estudio/./Assets/no.js",
    "/estudio/assets/./no.js", "/estudio/assets/../assets/no.js", "/estudio/marketing/../assets/no.js", "/estudio///assets//no.js",
    "/Estudio/assets/no.js", "/ESTUDIO/ASSETS/no.js", "/estudio/%2e/assets/no.js",
])
def test_un_asset_inexistente_escrito_sin_normalizar_sigue_siendo_404_json_aunque_pida_html(dist, pedido):
    """La regla de «un asset que falta es JSON, nunca el HTML» (S2) vale también para quien manda «//», «./» o «x/../» a mano:
    la decisión se toma sobre la ruta NORMALIZADA, la misma con la que se busca el destino de un 302."""
    ruta = pedido.replace("%2e", ".")
    estado, cab, cuerpo = _crudo(_app(dist)[0], ruta, accept=HTML["Accept"], raw=pedido.encode())
    assert estado == 404 and cab["content-type"].startswith("application/json"), (pedido, cab)
    assert cuerpo == '{"detail":"Not Found"}'


def test_otros_404_de_la_app_no_cambian(dist):
    def rutas_de_la_app(app):
        @app.get("/api/falta")
        def _falta():
            raise HTTPException(404, "Imagen no encontrada")

        @app.get("/estudio/hoja-con-api")
        def _hoja():
            raise HTTPException(404, "No hay hoja")

    c = _c(dist, antes=rutas_de_la_app)
    assert c.get("/api/no-existe", headers=HTML).json() == {"detail": "Not Found"}
    assert c.get("/fuera-del-estudio", headers=HTML).json() == {"detail": "Not Found"}
    assert c.get("/estudiofalso/", headers=HTML).json() == {"detail": "Not Found"}
    assert c.get("/api/falta", headers=HTML).json() == {"detail": "Imagen no encontrada"}
    # un 404 con detalle propio, aun bajo /estudio/, no se disfraza de «no encontramos esa página»
    r = c.get("/estudio/hoja-con-api", headers=HTML)
    assert r.status_code == 404 and r.json() == {"detail": "No hay hoja"}


def test_si_la_app_ya_tenia_un_manejador_de_404_se_le_delega_lo_que_no_es_del_estudio(dist):
    from fastapi.responses import PlainTextResponse

    def previo(app):
        async def mio(request, exc):
            return PlainTextResponse("el de la app", status_code=404)
        app.add_exception_handler(404, mio)

    c = _c(dist, antes=previo)
    assert c.get("/fuera-del-estudio").text == "el de la app"
    assert c.get("/estudio/marketing").headers["location"] == "/estudio/marketing/"
    assert c.get("/estudio/nada/", headers=HTML).headers["content-type"].startswith("text/html")
    assert c.get("/estudio/nada/").text == "el de la app"


# ---------------------------------------------------------------------------
# lo que ya no está en disco y lo que el registro no debe contar

def test_una_pantalla_del_registro_que_da_404_no_se_redirige_a_si_misma(dist):
    """La guardia anti-bucle de `destino_de` (S5): si el deploy borra `marketing/index.html` con el servidor vivo (un `vite build` con
    emptyOutDir), `/estudio/marketing/` sigue en el registro pero ya no se sirve. Debe dar 404, no un 302 a sí misma sin fin."""
    app = _app(dist)[0]
    (dist / "estudio" / "marketing" / "index.html").unlink()
    c = TestClient(app, follow_redirects=False)
    for cabeceras in (None, HTML):
        r = c.get("/estudio/marketing/", headers=cabeceras)
        assert r.status_code == 404 and "location" not in r.headers, cabeceras
    # sin barra: un salto a la forma con barra (que SÍ está en el registro) y ahí el 404; nunca un ciclo
    r = c.get("/estudio/marketing")
    assert r.status_code == 302 and r.headers["location"] == "/estudio/marketing/"
    assert c.get(r.headers["location"]).status_code == 404
    # y un cliente que SÍ sigue redirecciones termina, no se queda dando vueltas
    assert TestClient(app, follow_redirects=True, base_url="http://testserver").get("/estudio/marketing").status_code == 404
    # el resto del área no se ve afectado
    assert c.get("/estudio/marketing/distrito/").status_code == 200


def test_el_registro_no_cuenta_un_directorio_que_se_llama_index_html(dist):
    """`rutas` pide un ARCHIVO index.html (`is_file`): una carpeta con ese nombre no es una pantalla."""
    (dist / "estudio" / "marketing" / "falso" / "index.html").mkdir(parents=True)
    assert "/estudio/marketing/falso/" not in web.rutas(dist / "estudio")
    assert _c(dist).get("/estudio/marketing/falso/").status_code == 404


def test_el_enlace_del_404_con_pagina_va_escapado(dist):
    """El destino sale del registro, pero un nombre de carpeta puede traer «&» (o comillas): en el HTML va escapado."""
    d = dist / "estudio" / "a&b"
    d.mkdir()
    (d / "index.html").write_text("<title>a&b</title>", encoding="utf-8")
    r = _c(dist).get("/estudio/a&b/nada/", headers=HTML)
    assert r.status_code == 404 and 'href="/estudio/a&amp;b/"' in r.text and 'href="/estudio/a&b/"' not in r.text


def test_un_nivel_intermedio_sin_pagina_deja_un_aviso_en_el_log(dist, caplog):
    """Un nivel sin index.html pero con hijos (S6) no deja ciegos a los hijos, pero tampoco puede pasar callado: el 404 del nivel solo se
    descubre al pedirlo. Una vez por nivel, con su ruta; nada si el árbol está completo."""
    import logging
    caplog.set_level(logging.WARNING, logger="web")
    _app(dist)
    avisos = [r.getMessage() for r in caplog.records if r.name == "web"]
    assert len(avisos) == 1 and "/estudio/huerfano/" in avisos[0] and "index.html" in avisos[0], avisos

    # varios hijos y varios niveles perdidos: un aviso por NIVEL, no por hijo
    caplog.clear()
    estudio = dist / "estudio"
    for rel in ("huerfano/otro", "perdido/medio/hoja"):
        (estudio / rel).mkdir(parents=True)
        (estudio / rel / "index.html").write_text("<title>x</title>", encoding="utf-8")
    _app(dist)
    avisos = sorted(r.getMessage() for r in caplog.records if r.name == "web")
    assert [a.split()[1] for a in avisos] == ["/estudio/huerfano/", "/estudio/perdido/", "/estudio/perdido/medio/"], avisos

    # con todo en su lugar no se dice nada
    import shutil
    caplog.clear()
    shutil.rmtree(estudio / "huerfano")
    shutil.rmtree(estudio / "perdido")
    _app(dist)
    assert [r for r in caplog.records if r.name == "web"] == []


# ---------------------------------------------------------------------------
# otros métodos

@pytest.mark.parametrize("metodo", ["post", "put", "delete", "patch", "options"])
@pytest.mark.parametrize("ruta", ["/estudio/marketing/", "/estudio/marketing", "/estudio/Marketing/", "/estudio/nada/",
                                  "/estudio/marketing/distrito", "/estudio/marketing/Distrito/", "/estudio/marketing//distrito/"])
def test_solo_get_y_head_se_redirigen_lo_demas_no_se_toca(dist, metodo, ruta):
    r = getattr(_c(dist), metodo)(ruta, headers=HTML)
    assert "location" not in r.headers, "un POST no se manda a otra parte con un 302"
    assert r.status_code == 405 and r.json() == {"detail": "Method Not Allowed"}


def test_head_de_un_404_con_pagina_lleva_las_mismas_cabeceras(dist):
    r = _c(dist).head("/estudio/nada/", headers=HTML)
    assert r.status_code == 404 and r.headers["cache-control"] == "no-cache" and r.headers["x-robots-tag"] == "noindex, nofollow"


# ---------------------------------------------------------------------------
# alias (E5.2): las direcciones de pantallas que cambiaron de sitio.
# `_c(dist, alias)` con `alias=None` usa el REAL (migracion.alias_del_estudio); estas pruebas pasan el suyo.

ALIAS = {"/estudio/coi/": "/estudio/central/distrito/coi/", "/estudio/agenda/": "/estudio/marketing/blotato/agenda/"}


@pytest.mark.parametrize("pedido, destino", [
    ("/estudio/coi/", "/estudio/central/distrito/coi/"),
    ("/estudio/coi", "/estudio/central/distrito/coi/"),
    ("/estudio/coi/?x=1", "/estudio/central/distrito/coi/?x=1"),
    ("/estudio/Agenda", "/estudio/marketing/blotato/agenda/"),
])
def test_las_urls_viejas_van_a_la_nueva_con_302_sin_cache_y_con_el_query(dist, pedido, destino):
    r = _c(dist, ALIAS).get(pedido)
    assert r.status_code == 302 and r.headers["location"] == destino and r.headers["cache-control"] == "no-store"


def test_sin_alias_las_urls_viejas_son_404(dist):
    assert _c(dist, {}).get("/estudio/coi/").status_code == 404
    assert _c(dist, {}).get("/estudio/coi").status_code == 404


def test_el_alias_no_pisa_a_una_carpeta_que_todavia_existe(dist):
    viejo = dist / "estudio" / "coi"
    viejo.mkdir()
    (viejo / "index.html").write_text("<title>PLANO</title>", encoding="utf-8")
    c = _c(dist, ALIAS)
    r = c.get("/estudio/coi/")
    assert r.status_code == 200 and "PLANO" in r.text
    r = c.get("/estudio/coi?x=1")
    assert r.status_code == 302 and r.headers["location"] == "/estudio/coi/?x=1"


def test_un_alias_a_un_destino_que_no_esta_compilado_da_404_y_no_redirige_a_la_nada(dist):
    c = _c(dist, {"/estudio/viejo/": "/estudio/no-compilado/", "/estudio/otro/": "//evil.com/"})
    for pedido in ("/estudio/viejo/", "/estudio/viejo", "/estudio/otro/"):
        r = c.get(pedido, headers=HTML)
        assert r.status_code == 404 and "location" not in r.headers, pedido


def test_sin_pasar_alias_montar_usa_el_de_migracion(dist):
    """`web.montar(app, dist)` (como lo llama server/app.py) trae `migracion.alias_del_estudio()`: el inicio de una sola página
    (/estudio/inicio/, retirada en E5.3) va a la principal. `{}` es «ninguno» y no se confunde con `None`."""
    from server import migracion
    assert migracion.alias_del_estudio().get("/estudio/inicio/") == "/estudio/"
    c = _c(dist)                                  # dist sin carpeta `inicio`
    for pedido, destino in (("/estudio/inicio/", "/estudio/"), ("/estudio/inicio", "/estudio/"),
                            ("/estudio/inicio/?desde=mkt.blotato.agenda&ver=grupos", "/estudio/?desde=mkt.blotato.agenda&ver=grupos"),
                            ("/estudio/Inicio/?x=1", "/estudio/?x=1")):
        r = c.get(pedido)
        assert r.status_code == 302 and r.headers["location"] == destino and r.headers["cache-control"] == "no-store", pedido
    assert _c(dist, {}).get("/estudio/inicio/").status_code == 404


def _dist_de_las_fuentes(tmp_path):
    """Un dist falso con una página (con su ruta de título) por cada ruta que registran las FUENTES reales de web/estudio:
    lo que `npm run build` compila, sin necesitar el build."""
    estudio = tmp_path / "dist" / "estudio"
    for ruta in web.rutas(RAIZ / "web" / "estudio"):
        d = estudio / ruta.removeprefix("/estudio/")
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(f"<!doctype html><title>{ruta}</title>", encoding="utf-8")
    (estudio / "assets").mkdir()
    return tmp_path / "dist"


def test_la_pagina_unica_del_inicio_ya_no_esta_en_las_fuentes_y_su_alias_manda(tmp_path):
    """E5.3 retiró web/estudio/inicio/: el registro de las fuentes ya no la cuenta, así que el alias del inicio (inerte mientras la
    carpeta existía) es el que contesta. Con un dist hecho de las fuentes reales, /estudio/inicio/ es un 302 a la principal, con el
    query intacto y sin guardarse en caché, con o sin barra y en cualquier método de lectura."""
    registro = web.rutas(RAIZ / "web" / "estudio")
    assert "/estudio/" in registro and "/estudio/inicio/" not in registro
    c = _c(_dist_de_las_fuentes(tmp_path))
    for pedido, destino in (("/estudio/inicio/", "/estudio/"), ("/estudio/inicio", "/estudio/"),
                            ("/estudio/inicio/?x=1&y=a%20b", "/estudio/?x=1&y=a%20b"), ("/estudio/Inicio/", "/estudio/"),
                            ("/estudio/inicio/?desde=mkt.blotato.agenda&ver=grupos", "/estudio/?desde=mkt.blotato.agenda&ver=grupos")):
        for metodo in (c.get, c.head):
            r = metodo(pedido)
            assert r.status_code == 302 and r.headers["location"] == destino, (metodo.__name__, pedido)
            assert r.headers["cache-control"] == "no-store", pedido
    # y la principal a la que llegan sí se sirve (no es un 302 a la nada)
    r = c.get("/estudio/")
    assert r.status_code == 200 and "<title>/estudio/</title>" in r.text


@pytest.mark.parametrize("pedido, saltos", [
    ("/estudio/inicio/?prompt=x",
     ["/estudio/?prompt=x", "/estudio/marketing/distrito/imagen/?prompt=x"]),
    ("/estudio/inicio?prompt=un%20faro",                              # sin barra: el alias también la cubre, sigue siendo un salto
     ["/estudio/?prompt=un%20faro", "/estudio/marketing/distrito/imagen/?prompt=un%20faro"]),
    ("/estudio/inicio/?brief=hola",
     ["/estudio/?brief=hola", "/estudio/marketing/distrito/video/?brief=hola"]),
    ("/estudio/inicio/?blotato=conectar",
     ["/estudio/?blotato=conectar", "/estudio/marketing/blotato/?blotato=conectar"]),
    ("/estudio/inicio/?x=1", ["/estudio/?x=1"]),                  # sin entrada vieja termina en la principal, en un solo salto
])
def test_un_marcador_de_la_pagina_unica_llega_a_la_herramienta_sin_bucles(tmp_path, pedido, saltos):
    """Un marcador de /estudio/inicio/?prompt=x (la Caja abierta con un texto) hace dos 302 —uno de alias, otro de entrada vieja— y
    termina en la Caja en Imagen con el texto puesto (con o sin barra final); sin parámetro de antes, uno solo, a la principal. `saltos`
    son los `Location` de cada 302, en orden. Nunca un 404 ni un bucle, y ningún salto se guarda en caché."""
    c = TestClient(_app(_dist_de_las_fuentes(tmp_path))[0], follow_redirects=True)
    r = c.get(pedido)
    assert r.status_code == 200, pedido
    assert [h.headers["location"] for h in r.history] == saltos, pedido
    assert all(h.status_code == 302 and h.headers["cache-control"] == "no-store" for h in r.history)
    assert r.url.raw_path.decode() == saltos[-1]
    assert f"<title>{saltos[-1].split('?')[0]}</title>" in r.text


def test_ningun_alias_apunta_a_otro_alias_ni_a_si_mismo():
    from server import migracion
    a = migracion.alias_del_estudio()
    assert a and not (set(a) & set(a.values())), "cadena de alias"
    assert all(k != v for k, v in a.items())
    assert all(k.startswith("/estudio/") and k.endswith("/") and v.startswith("/estudio/") and v.endswith("/") for k, v in a.items())


def test_los_destinos_de_los_alias_son_paginas_que_existen():
    """Cada destino del alias real está en las páginas de web/estudio (lee las fuentes: no necesita web/dist)."""
    from server import migracion
    registro = web.rutas(RAIZ / "web" / "estudio")
    for viejo, nuevo in migracion.alias_del_estudio().items():
        assert nuevo in registro, (viejo, nuevo)


# ---------------------------------------------------------------------------
# sin dist

def test_sin_dist_no_se_registra_nada_ni_se_toca_el_404(tmp_path):
    app = FastAPI()
    assert web.montar(app, tmp_path / "no-existe") == []
    assert 404 not in app.exception_handlers
    (tmp_path / "vacio").mkdir()
    assert web.montar(app, tmp_path / "vacio") == [] and 404 not in app.exception_handlers


def test_con_dist_pero_sin_pantallas_solo_se_montan_los_assets_la_raiz_y_el_404(tmp_path):
    (tmp_path / "estudio" / "assets").mkdir(parents=True)
    (tmp_path / "estudio" / "index.html").write_text("<title>raiz</title>", encoding="utf-8")
    app = FastAPI()
    assert web.montar(app, tmp_path) == ["/estudio/assets", "/estudio"]
    assert 404 in app.exception_handlers
    # y sin siquiera la raíz, solo los assets
    (tmp_path / "estudio" / "index.html").unlink()
    assert web.montar(FastAPI(), tmp_path) == ["/estudio/assets"]
    assert web.rutas(tmp_path / "estudio") == frozenset()
