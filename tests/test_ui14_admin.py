"""UI·14 — el panel del negocio (admin) con la carta de diseño (docs/DISENO.md).

carta.css (Bricolage + Geist, botones de tres niveles, foco), iconos de trazo
en vez de emojis, la escala de seis tamaños y un solo botón ámbar por vista:
Sincronizar costes, en la de costos; ingresos y flujo solo se leen.
"""
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ADMIN = (RAIZ / "static" / "admin.html").read_text(encoding="utf-8")
ICONOS = (RAIZ / "static" / "iconos.js").read_text(encoding="utf-8")


def _estilo():
    return ADMIN[ADMIN.index("<style>"):ADMIN.index("</style>")]


def _vista(v):
    i = ADMIN.index(f'<div id="v-{v}"')
    fin = ADMIN.find('<div id="v-', i + 1)
    return ADMIN[i:fin if fin > 0 else ADMIN.index("</main>")]


def test_carga_la_carta_y_los_iconos():
    assert ADMIN.index('href="/carta.css"') < ADMIN.index("<style>")
    principal = ADMIN.index("<script>\nconst $")
    assert ADMIN.index('src="/iconos.js"') < principal


def test_titulos_en_bricolage_y_texto_en_geist():
    e = _estilo()
    assert "body { font: var(--t-sm)/1.5 var(--f-texto);" in e
    assert "h1 { font: 800 var(--t-titulo-lg)/1.1 var(--f-titulo); letter-spacing: -0.02em;" in e
    assert "section h2 { font: 700 var(--t-titulo-sm)/1.3 var(--f-titulo);" in e
    # las cifras que cambian, tabulares
    assert e.count("font-variant-numeric: tabular-nums") >= 2


def test_sin_tamanos_de_letra_fuera_de_la_escala():
    assert not re.findall(r"font-size:\s*[\d.]+px", ADMIN)
    assert not re.search(r"font:\s*(\d+\s+)?[\d.]+px", ADMIN)
    tokens = set(re.findall(r"var\(--t-([a-z-]+)\)", ADMIN))
    assert tokens <= {"xs", "sm", "md", "titulo-sm", "titulo-md", "titulo-lg"}


EMOJIS = "🔒⏳⟳↗←✓✕🔄"


def test_sin_emojis_como_iconos():
    for e in EMOJIS:
        assert e not in ADMIN, f"quedó {e} en admin"


def test_los_iconos_que_usa_admin_existen():
    nombres = set(re.findall(r'data-icono="([a-z]+)"', ADMIN)) | set(re.findall(r"icono\('([a-z]+)'", ADMIN))
    assert {"volver", "candado", "rehacer", "espera", "listo", "externo"} <= nombres
    for n in nombres:
        assert f"    {n}: '" in ICONOS, n


def test_un_solo_principal_por_vista():
    assert _vista("costos").count("btn-pri") == 1
    assert 'class="btn btn-pri" id="sync"' in ADMIN
    for v in ("ingresos", "flujo"):
        assert "btn-pri" not in _vista(v), v
    assert "button.accion" not in ADMIN


def test_la_vista_elegida_no_es_ambar():
    e = _estilo()
    regla = e[e.index(".tabs button.on {"):e.index("}", e.index(".tabs button.on {"))]
    assert "var(--c-texto)" in regla and "var(--c-elevada)" in regla
    assert "ambar" not in regla
    assert "min-height: 44px" in e[e.index(".tabs button {"):e.index("}", e.index(".tabs button {"))]


def test_enlaces_en_azul_claro_y_sin_colores_sueltos():
    assert "a { color: var(--c-enlace); }" in ADMIN
    assert "#5b8dd6" not in ADMIN
    assert not re.search(r'style="[^"]*color', ADMIN)


def test_filas_tocables_de_44():
    assert "tr.usuario td { height: 44px; }" in _estilo()


def test_sin_sepia():
    assert "sepia(" not in ADMIN
