"""UI·14 — competencia con la carta de diseño (docs/DISENO.md).

Retoque en su sitio, como crear en UI·13: carta.css (Bricolage + Geist,
botones de tres niveles, foco ámbar), iconos de trazo en vez de emojis, la
escala de seis tamaños y un solo botón ámbar («Revisar ✦ N»). El
comportamiento no cambia: mismos ids, mismas funciones, mismos endpoints.
"""
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PANTALLA = (RAIZ / "static" / "competencia.html").read_text(encoding="utf-8")
ICONOS = (RAIZ / "static" / "iconos.js").read_text(encoding="utf-8")


def _estilo():
    return PANTALLA[PANTALLA.index("<style>"):PANTALLA.index("</style>")]


def _regla(selector):
    e = _estilo()
    i = e.index(selector + " {")
    return e[i:e.index("}", i)]


def test_carga_la_carta_y_los_iconos():
    assert PANTALLA.index('href="/carta.css"') < PANTALLA.index("<style>")
    # iconos.js antes del script principal, que usa icono()
    assert PANTALLA.index('<script src="/iconos.js"></script>') < PANTALLA.index("// ── cp · Competencia (C5)")


def test_las_variables_locales_son_tokens_de_la_carta():
    raiz = _regla(":root")
    assert "--acc:var(--c-ambar)" in raiz and "--acc2:var(--c-ambar-claro)" in raiz
    assert not re.search(r"#[0-9a-fA-F]{6}", raiz)


def test_titulos_en_bricolage_y_texto_en_geist():
    assert "font: var(--t-sm)/1.5 var(--f-texto);" in _regla("body")
    h1 = _regla("h1")
    assert "font: 800 var(--t-titulo-lg)/1.1 var(--f-titulo);" in h1 and "letter-spacing: -0.02em" in h1
    assert "var(--f-titulo)" in _regla("section h2")
    assert "var(--f-titulo)" in _regla(".tarjeta h3")


def test_sin_tamanos_de_letra_fuera_de_la_escala():
    assert not re.findall(r"font-size:\s*[\d.]+(px|rem|em)", PANTALLA)
    assert not re.search(r"font:\s*(\d{3}\s+)?[\d.]+px", PANTALLA)
    for valor in re.findall(r"font-size:\s*([^;}]+)", PANTALLA):
        assert re.fullmatch(r"var\(--t-(xs|sm|md|titulo-sm|titulo-md|titulo-lg)\)", valor.strip()), valor


EMOJIS = "📡↗←✕✓✅⚠🔄👁📊🔍"


def test_sin_emojis_como_iconos():
    for e in EMOJIS:
        assert e not in PANTALLA, f"quedó {e} en competencia"
    assert "sepia(" not in PANTALLA


def test_los_iconos_que_usa_existen():
    nombres = (set(re.findall(r'data-icono="([a-z]+)"', PANTALLA))
               | set(re.findall(r'cpIco\("([a-z]+)"\)', PANTALLA)))
    assert {"volver", "sinred", "externo", "aviso"} <= nombres
    for n in nombres:
        assert f"    {n}: '" in ICONOS, n


def test_un_solo_principal_y_es_el_que_cobra():
    assert PANTALLA.count("btn-pri") == 1
    assert '<button id="btn-revisar" class="btn btn-pri" disabled>Revisar</button>' in PANTALLA
    assert '<button id="btn-agregar" class="btn btn-sec">Agregar</button>' in PANTALLA
    # quitar una cuenta es borrar: peligro; ver y recargar, secundarios
    assert 'class="btn btn-peligro quitar" data-quitar=' in PANTALLA
    assert 'class="btn btn-sec quitar" data-abrir=' in PANTALLA
    assert 'b.className = "btn btn-sec quitar";' in PANTALLA
    # sin botones propios con color: la forma y los estados son de carta.css
    assert not re.search(r"^\s*button\s*\{", _estilo(), re.M)
    assert "#2b4a75" not in PANTALLA


def test_el_ambar_solo_dice_haz_algo():
    e = _estilo()
    assert "#f0a94a" not in e and "#da8c28" not in e
    assert "var(--acc" not in e.split(":root", 1)[1].split("}", 1)[1]
    assert "color: var(--mut)" in _regla(".aviso")


def test_enlaces_campos_y_tarjetas():
    assert "color: var(--c-enlace)" in _regla("a")
    assert "#5b8dd6" not in PANTALLA
    campo = _regla("input")
    assert "var(--campo)" in campo and "var(--elev)" in campo and "var(--r-medio)" in campo
    tarjeta = _regla("section")
    assert "var(--card)" in tarjeta and "var(--line)" in tarjeta and "var(--r-grande)" in tarjeta


def test_lo_que_se_toca_mide_44():
    for regla in (".volver", "input", "a.ver"):
        assert "min-height: 44px" in _regla(regla), regla


def test_no_queda_debajo_de_la_pildora():
    """UI·12: la píldora acaba a 52 px; el contenido empieza 16 px más abajo."""
    m = re.search(r"padding: (\d+)px 24px", _regla("body"))
    assert m and int(m.group(1)) >= 52 + 16


def test_el_foco_es_el_de_la_carta():
    assert ":focus-visible" not in _estilo()
