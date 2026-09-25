"""UI·14 — la copiadora de estilos con la carta de diseño (docs/DISENO.md).

Retoque en su sitio: carta.css (Bricolage + Geist, botones de tres niveles,
foco), iconos de trazo en vez de emojis, la escala de seis tamaños y un solo
botón ámbar («Analizar ✦ N»). El comportamiento no cambia.
"""
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ESTILOS = (RAIZ / "static" / "estilos.html").read_text(encoding="utf-8")
ICONOS = (RAIZ / "static" / "iconos.js").read_text(encoding="utf-8")


def _estilo():
    return ESTILOS[ESTILOS.index("<style>"):ESTILOS.index("</style>")]


def test_carga_la_carta_y_los_iconos():
    assert ESTILOS.index('href="/carta.css"') < ESTILOS.index("<style>")
    i = ESTILOS.index('<script src="/iconos.js"></script>')
    assert i < ESTILOS.index("<script>\n")   # antes del script de la página
    assert "--mut:var(--c-secundario);" in _estilo()


def test_titulos_en_bricolage_y_texto_en_geist():
    e = _estilo()
    assert "body { background: var(--bg); color: var(--txt); font: var(--t-sm)/1.5 var(--f-texto);" in e
    assert "h1 { font: 800 var(--t-titulo-lg)/1.1 var(--f-titulo); letter-spacing: -0.02em;" in e
    assert "section h2 { font: 700 var(--t-titulo-md)/1.2 var(--f-titulo);" in e
    assert ".tarjeta h3 { font: 700 var(--t-titulo-sm)/1.3 var(--f-titulo);" in e


def test_sin_tamanos_de_letra_fuera_de_la_escala():
    assert not re.findall(r"font-size:\s*[\d.]+(px|em|rem)", ESTILOS)
    assert not re.search(r"font:\s*[^;]*\d+(\.\d+)?px", ESTILOS)
    for t in re.findall(r"var\(--t-([a-z-]+)\)", ESTILOS):
        assert t in {"xs", "sm", "md", "titulo-sm", "titulo-md", "titulo-lg"}, t


EMOJIS = "📡✓✔←✕✨🎨📋"


def test_sin_emojis_como_iconos():
    for e in EMOJIS:
        assert e not in ESTILOS, f"quedó {e} en estilos"


def test_los_iconos_que_usa_existen():
    nombres = set(re.findall(r'data-icono="([a-z]+)"', ESTILOS)) | set(re.findall(r"icono\('([a-z]+)'", ESTILOS))
    # UI·16: «sin red» y «copiado» se fueron al cuadro de avisos (trabajos.js)
    assert nombres == {"volver"}
    for n in nombres:
        assert f"    {n}: '" in ICONOS, n


def test_un_solo_principal_y_es_el_que_cobra():
    assert ESTILOS.count("btn-pri") == 1
    assert '<button id="btn-analizar" class="btn btn-pri" disabled>' in ESTILOS
    assert "$(\"btn-analizar\").textContent = `Analizar ✦ ${TARIFA}`;" in ESTILOS
    # copiar y Recargar son secundarios; el viejo relleno azul se fue
    assert ESTILOS.count("btn btn-sec copiar") == 2
    assert "#2b4a75" not in ESTILOS and "#5b8dd6" not in ESTILOS


def test_sin_filtro_sepia():
    assert "sepia(" not in ESTILOS


def test_enlaces_campos_y_tarjetas_de_la_carta():
    e = _estilo()
    assert "a { color: var(--c-enlace); }" in e
    assert "border: 1px solid var(--campo);" in e and "--campo:var(--c-campo);" in e
    assert "border-radius: var(--r-medio)" in e
    assert "border-radius: var(--r-grande)" in e


def test_lo_que_se_toca_mide_44():
    e = _estilo()
    assert ".volver { display: inline-flex; align-items: center; gap: 8px; min-height: 44px;" in e
    assert "input { min-height: 44px;" in e
    # los .copiar son .btn: carta les da min-height 44 y aquí no se les quita
    cuerpo = e[e.index(".copiar {"):e.index("}", e.index(".copiar {"))]
    assert "min-height" not in cuerpo and "height" not in cuerpo


def test_sin_colores_sueltos():
    """Todo sale de los tokens de carta: ni un hex en el estilo de la página."""
    assert not re.search(r"#[0-9a-fA-F]{3,8}\b", _estilo())


def test_la_pildora_no_tapa_nada():
    """La píldora acaba a 52 px (test_ui12_pildora): el contenido empieza abajo."""
    m = re.search(r"body \{[^}]*padding: (\d+)px 24px 40px; \}", _estilo())
    assert m and int(m.group(1)) >= 52 + 12
