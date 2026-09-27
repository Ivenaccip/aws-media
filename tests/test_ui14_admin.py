"""UI·14 — el panel del negocio (admin) con la carta de diseño (docs/DISENO.md).

carta.css (Bricolage + Geist, botones de tres niveles, foco), iconos de trazo
en vez de emojis, la escala de seis tamaños y un solo botón ámbar por vista:
Sincronizar costes, en la de costos; ingresos y flujo solo se leen.
"""
import functools
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


@functools.lru_cache(maxsize=None)
def _admin() -> str:
    return (RAIZ / "static" / "admin.html").read_text(encoding="utf-8")


@functools.lru_cache(maxsize=None)
def _iconos() -> str:
    return (RAIZ / "static" / "iconos.js").read_text(encoding="utf-8")


def _estilo():
    return _admin()[_admin().index("<style>"):_admin().index("</style>")]


def _vista(v):
    i = _admin().index(f'<div id="v-{v}"')
    fin = _admin().find('<div id="v-', i + 1)
    return _admin()[i:fin if fin > 0 else _admin().index("</main>")]


def test_carga_la_carta_y_los_iconos():
    assert _admin().index('href="/carta.css"') < _admin().index("<style>")
    principal = _admin().index("<script>\nconst $")
    assert _admin().index('src="/iconos.js"') < principal


def test_titulos_en_bricolage_y_texto_en_geist():
    e = _estilo()
    assert "body { font: var(--t-sm)/1.5 var(--f-texto);" in e
    assert "h1 { font: 800 var(--t-titulo-lg)/1.1 var(--f-titulo); letter-spacing: -0.02em;" in e
    assert "section h2 { font: 700 var(--t-titulo-sm)/1.3 var(--f-titulo);" in e
    # las cifras que cambian, tabulares
    assert e.count("font-variant-numeric: tabular-nums") >= 2


def test_sin_tamanos_de_letra_fuera_de_la_escala():
    assert not re.findall(r"font-size:\s*[\d.]+px", _admin())
    assert not re.search(r"font:\s*(\d+\s+)?[\d.]+px", _admin())
    tokens = set(re.findall(r"var\(--t-([a-z-]+)\)", _admin()))
    assert tokens <= {"xs", "sm", "md", "titulo-sm", "titulo-md", "titulo-lg"}


EMOJIS = "🔒⏳⟳↗←✓✕🔄"


def test_sin_emojis_como_iconos():
    for e in EMOJIS:
        assert e not in _admin(), f"quedó {e} en admin"


def test_los_iconos_que_usa_admin_existen():
    nombres = set(re.findall(r'data-icono="([a-z]+)"', _admin())) | set(re.findall(r"icono\('([a-z]+)'", _admin()))
    assert {"volver", "candado", "rehacer", "espera", "listo", "externo"} <= nombres
    for n in nombres:
        assert f"    {n}: '" in _iconos(), n


def test_un_solo_principal_por_vista():
    assert _vista("costos").count("btn-pri") == 1
    assert 'class="btn btn-pri" id="sync"' in _admin()
    for v in ("ingresos", "flujo"):
        assert "btn-pri" not in _vista(v), v
    assert "button.accion" not in _admin()


def test_la_vista_elegida_no_es_ambar():
    e = _estilo()
    regla = e[e.index(".tabs button.on {"):e.index("}", e.index(".tabs button.on {"))]
    assert "var(--c-texto)" in regla and "var(--c-elevada)" in regla
    assert "ambar" not in regla
    assert "min-height: 44px" in e[e.index(".tabs button {"):e.index("}", e.index(".tabs button {"))]


def test_enlaces_en_azul_claro_y_sin_colores_sueltos():
    assert "a { color: var(--c-enlace); }" in _admin()
    assert "#5b8dd6" not in _admin()
    assert not re.search(r'style="[^"]*color', _admin())


def test_filas_tocables_de_44():
    assert "tr.usuario td { height: 44px; }" in _estilo()


def test_sin_sepia():
    assert "sepia(" not in _admin()
