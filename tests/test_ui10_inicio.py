"""UI·10 — el inicio con la carta de diseño (docs/DISENO.md).

Lo que se defiende aquí:
- la carta se sirve desde el propio dominio (fuentes incluidas) y el inicio la carga;
- el ámbar es el único acento y queda en un solo botón: el de enviar;
- los emojis de la interfaz pasaron a iconos de trazo;
- quien no tiene nada ve los tres caminos, y solo cuando las listas llegaron bien;
- el saldo se queda arriba, en la píldora de monedero.js (decisión del dueño).
"""
import re
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
ESTATICOS = RAIZ / "static"
INICIO = (ESTATICOS / "index.html").read_text(encoding="utf-8")
CARTA = (ESTATICOS / "carta.css").read_text(encoding="utf-8")
ICONOS = (ESTATICOS / "iconos.js").read_text(encoding="utf-8")
MONEDERO = (ESTATICOS / "monedero.js").read_text(encoding="utf-8")


def _estilo(html: str) -> str:
    return html[html.index("<style>"):html.index("</style>")]


def _js(html: str) -> str:
    return html[html.index("<script>\nconst $") + len("<script>"):html.rindex("</script>\n<script src=\"/auth.js\">")]


# ---------------------------------------------------------------------------
# la carta, servida desde casa

def test_las_fuentes_son_propias_y_con_licencia():
    for fuente in ("geist-latin.v1.woff2", "bricolage-latin.v1.woff2"):
        f = ESTATICOS / "fuentes" / fuente
        assert f.is_file() and f.read_bytes()[:4] == b"wOF2", fuente
        assert f"url(/fuentes/{fuente})" in CARTA
    for licencia in ("OFL-geist.txt", "OFL-bricolage.txt"):
        assert "SIL Open Font License" in (ESTATICOS / "fuentes" / licencia).read_text(encoding="utf-8")


def test_sin_recursos_externos():
    for nombre, texto in (("carta.css", CARTA), ("iconos.js", ICONOS), ("index.html", INICIO)):
        assert "fonts.googleapis" not in texto and "fonts.gstatic" not in texto, nombre
        assert "cdn" not in texto.lower().replace("cdns", ""), nombre


def test_las_fuentes_se_cachean_como_inmutables():
    app = (RAIZ / "server" / "app.py").read_text(encoding="utf-8")
    assert '"geist-latin.v1.woff2", "bricolage-latin.v1.woff2"' in app
    assert 'mimetypes.add_type("font/woff2", ".woff2")' in app


@pytest.fixture
def cliente():
    from fastapi.testclient import TestClient
    from server.app import app
    return TestClient(app)


def test_las_fuentes_llegan_con_su_tipo(cliente):
    r = cliente.get("/fuentes/geist-latin.v1.woff2")
    assert r.status_code == 200
    assert r.headers["content-type"] == "font/woff2"
    assert "immutable" in r.headers["cache-control"]
    r = cliente.get("/carta.css")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/css")
    assert "immutable" not in r.headers.get("cache-control", ""), "la carta tiene que revalidar"


def test_la_carta_usa_la_escala_de_seis_tamanos():
    tamanos = set(re.findall(r"--t-[a-z-]+:\s*(\d+)px", CARTA))
    assert tamanos == {"13", "15", "17", "20", "24", "32"}


def test_la_carta_respeta_reducir_movimiento():
    assert "@media (prefers-reduced-motion: reduce)" in CARTA


def test_el_ambar_apretado_no_baja_del_contraste():
    """#a96716 con la tinta da 4.19:1: el principal no lo usa de fondo."""
    pri = CARTA[CARTA.index(".btn-pri {"):CARTA.index(".btn-sec {")]
    assert "#a96716" not in pri


# ---------------------------------------------------------------------------
# el inicio

def test_el_inicio_carga_la_carta_antes_que_su_estilo():
    assert INICIO.index('href="/carta.css"') < INICIO.index("<style>")
    assert INICIO.index('src="/iconos.js"') < INICIO.index("<script>\nconst $")


def test_un_solo_acento_y_en_un_solo_boton():
    estilo = _estilo(INICIO)
    assert "--acc: var(--c-ambar)" in estilo
    assert "#5b8dd6" not in INICIO, "el azul ya no es el acento del inicio"
    # los bordes al pasar el ratón ya no se pintan de acento
    assert "border-color: var(--acc)" not in estilo
    # el ámbar de fondo solo en el botón de enviar (y en el principal del diálogo)
    fondos = re.findall(r"([^{}]+)\{[^}]*background: var\(--c-ambar\)", estilo)
    selectores = {f.strip().split("\n")[-1].strip() for f in fondos}
    assert selectores == {".prompt .enviar", ".blt-acciones .pri"}, selectores


def test_titulos_en_bricolage_y_texto_en_geist():
    estilo = _estilo(INICIO)
    assert "body { font: var(--t-sm)/1.6 var(--f-texto);" in estilo
    for sel in (".prompt h2", ".cabecera-grid h2", ".caminos h2", "aside h1"):
        regla = estilo[estilo.index(sel):]
        assert "var(--f-titulo)" in regla[:regla.index("}")], sel


def test_sin_tamanos_de_letra_fuera_de_la_escala():
    """Los px sueltos que quedan son de iconos (20 y 28), no de texto."""
    estilo = _estilo(INICIO)
    sueltos = re.findall(r"font-size:\s*([\d.]+)px", estilo)
    assert set(sueltos) <= {"20", "28"}, sueltos
    assert not re.search(r"font:\s*[\d.]+px", estilo)


EMOJIS = "🎬🎞🖼✅❌⏳✂✕✓＋"


def test_sin_emojis_como_iconos():
    for e in EMOJIS:
        assert e not in INICIO, f"quedó {e} en el inicio"


def test_cada_entrada_del_menu_lleva_icono():
    menu = INICIO[INICIO.index('<nav aria-label="Secciones">'):INICIO.index("</nav>")]
    entradas = re.findall(r"<a href=\"[^\"]+\"[^>]*>(.{0,40})", menu)
    assert len(entradas) == 7
    for e in entradas:
        assert e.startswith("<i data-icono="), e


def test_los_iconos_que_usa_el_inicio_existen():
    nombres = set(re.findall(r"data-icono=\"([a-z]+)\"", INICIO))
    nombres |= set(re.findall(r"icono\('([a-z]+)'", INICIO))
    estado = INICIO[INICIO.index("const ESTADO = {"):INICIO.index("const estadoHTML")]
    nombres |= set(re.findall(r"\['([a-z]+)', '", estado))
    for n in nombres:
        assert f"    {n}: '" in ICONOS, n


def test_el_saldo_se_queda_en_la_pildora_de_arriba():
    """El dueño probó el saldo al pie del menú y prefirió la píldora de arriba
    (25-sep). El inicio no trae hueco propio y monedero.js pinta como siempre."""
    assert "saldo-menu" not in INICIO
    assert "saldo-menu" not in MONEDERO
    assert "el.querySelector('#mon-pill').hidden = false;" in MONEDERO

def test_los_tres_caminos():
    caminos = INICIO[INICIO.index('<section class="caminos"'):INICIO.index("</section>", INICIO.index('<section class="caminos"'))]
    assert 'hidden' in caminos.split(">")[0]
    assert caminos.count('<article class="camino">') == 3
    assert 'href="/shorts.html"' in caminos and 'href="/e1.html"' in caminos
    assert 'id="camino-idea"' in caminos
    # secundarios: el único ámbar de la pantalla es el de enviar
    assert "btn-pri" not in caminos
    # los caminos van debajo de la caja: la caja sigue en el centro
    assert INICIO.index('<section class="prompt">') < INICIO.index('<section class="caminos"')


def test_los_caminos_solo_con_las_cuatro_listas_bien_y_vacias():
    js = _js(INICIO)
    carga = js[js.index("async function cargar()"):js.index("function render(ps)")]
    assert "const nuevo = !ps.length && ri && ri.ok && !imagenes.length && eds && !eds.length;" in carga
    assert "if (!rp.ok) { avisarCarga(); return; }" in carga
    assert carga.index("if (!rp.ok) { avisarCarga(); return; }") < carga.index("const nuevo")


def test_desde_una_idea_no_cobra_solo_elige():
    js = _js(INICIO)
    idea = js[js.index("$('#camino-idea').onclick"):js.index("let slots = null;")]
    assert "fetch(" not in idea and "location.href" not in idea
    assert "o.id === 'investigacion'" in idea and "$('#idea').focus();" in idea


def test_el_js_del_inicio_y_los_iconos_son_validos(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("node no está instalado")
    for nombre, codigo in (("inicio.js", _js(INICIO)), ("iconos.js", ICONOS)):
        f = tmp_path / nombre
        f.write_text(codigo, encoding="utf-8")
        r = subprocess.run([node, "--check", str(f)], capture_output=True, text=True)
        assert r.returncode == 0, (nombre, r.stderr)


def test_los_iconos_escapan_nada_porque_no_reciben_texto(tmp_path):
    """icono() solo acepta nombres de su tabla: un nombre desconocido lanza en
    vez de meter texto en el SVG."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node no está instalado")
    prueba = tmp_path / "prueba.js"
    prueba.write_text(
        "const document = {readyState: 'complete', querySelectorAll: () => []};\n"
        "const window = {};\n" + ICONOS +
        "\nconst svg = window.icono('video', 'ok');\n"
        "if (!svg.startsWith('<svg class=\"ico ok\"') || !svg.includes('aria-hidden=\"true\"')) throw new Error(svg);\n"
        "let lanzo = false; try { window.icono('<img>'); } catch { lanzo = true; }\n"
        "if (!lanzo) throw new Error('aceptó un nombre desconocido');\n",
        encoding="utf-8")
    r = subprocess.run([node, str(prueba)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
