"""UI·14 — Métricas con la carta de diseño (docs/DISENO.md).

carta.css (Bricolage + Geist, botones de tres niveles, foco), iconos de trazo
en vez de emojis, la escala de seis tamaños y ningún botón ámbar: esta
pantalla no cobra ni «hace» nada, solo enseña. Lo elegido (el conmutador) se
marca en neutro, no en ámbar.
"""
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
METRICAS = (RAIZ / "static" / "metricas.html").read_text(encoding="utf-8")
ICONOS = (RAIZ / "static" / "iconos.js").read_text(encoding="utf-8")


def _estilo():
    return METRICAS[METRICAS.index("<style>"):METRICAS.index("</style>")]


def _regla(selector):
    e = _estilo()
    i = e.index(selector)
    return e[i:e.index("}", i)]


def test_carga_la_carta_y_los_iconos():
    assert METRICAS.index('href="/carta.css"') < METRICAS.index("<style>")
    inicio = METRICAS.index("// ── mt · Métricas (C4)")
    assert METRICAS.index('src="/iconos.js"') < METRICAS.index('src="/auth.js"') < inicio


def test_titulos_en_bricolage_y_texto_en_geist():
    e = _estilo()
    assert "body { font: var(--t-sm)/1.5 var(--f-texto);" in e
    assert "h1 { font: 800 var(--t-titulo-lg)/1.1 var(--f-titulo); letter-spacing: -0.02em;" in e
    assert "font: 700 var(--t-titulo-sm)/1.3 var(--f-titulo)" in _regla(".mtCab b {")


def test_sin_tamanos_de_letra_fuera_de_la_escala():
    assert not re.findall(r"font-size:\s*[\d.]+(px|rem|em)", METRICAS)
    assert not re.search(r"font:\s*[^;]*\d+(\.\d+)?px", METRICAS)
    tamanos = set(re.findall(r"var\(--t-([a-z-]+)\)", _estilo()))
    assert tamanos <= {"xs", "sm", "md", "titulo-sm", "titulo-md", "titulo-lg"}


def test_los_numeros_van_en_tabular_nums():
    for regla in (".mtNums {", ".mtNums b {", ".mtDet dl {", ".mtDet table {", ".mtPill {"):
        assert "tabular-nums" in _regla(regla), regla


EMOJIS = "📎↗←✕✓×⚠🔄📊📈"


def test_sin_emojis_como_iconos():
    for e in EMOJIS:
        assert e not in METRICAS, f"quedó {e} en métricas"


def test_los_iconos_que_usa_existen():
    nombres = set(re.findall(r'data-icono="([a-z]+)"', METRICAS)) | \
        set(re.findall(r"icono\('([a-z]+)'", METRICAS))
    assert {"volver", "externo", "adjunto"} <= nombres
    for n in nombres:
        assert f"    {n}: '" in ICONOS, n


def test_los_iconos_de_la_lista_se_pintan_tras_el_innerhtml():
    """La lista se rehace con innerHTML: sus <i data-icono> se dibujan ahí."""
    assert 'if (window.iconos) window.iconos.pintar($("#mtLista"));' in METRICAS


def test_botones_con_los_niveles_de_la_carta():
    assert 'class="sec"' not in METRICAS
    assert "button {" not in _estilo()
    for id_ in ("mtVerRec", "mtVerTop", "mtRefrescar", "mtMas"):
        i = METRICAS.index(f'id="{id_}"')
        assert 'class="btn btn-sec"' in METRICAS[i:i + 60], id_
    assert METRICAS.count('class="btn btn-sec" data-mt=') == 2
    # «Ver más» se esconde con [hidden]; .btn es inline-flex y le ganaría
    assert ".btn[hidden] { display: none; }" in _estilo()


def test_ningun_boton_ambar():
    """Nada aquí cobra: a lo sumo un principal, y hoy ninguno."""
    assert METRICAS.count("btn-pri") <= 1
    assert "btn-pri" not in METRICAS


def test_elegir_no_es_ambar():
    cuerpo = _regla('.conmutador .btn[aria-pressed="true"] {')
    assert "border-color: var(--c-texto)" in cuerpo
    assert "background: var(--c-elevada)" in cuerpo
    assert "ambar" not in cuerpo


def test_enlaces_en_azul_claro_y_sin_el_azul_de_datos():
    assert "a { color: var(--c-enlace); }" in _estilo()
    assert "#5b8dd6" not in METRICAS   # no hay gráficas: el azul de datos no hace falta
    assert "#2b4a75" not in METRICAS


def test_tarjetas_de_la_carta():
    s = _regla("section {")
    assert "background: var(--c-superficie)" in s and "border: 1px solid var(--c-linea)" in s
    assert "border-radius: var(--r-grande)" in s


def test_lo_que_se_toca_mide_44():
    assert "min-height: 44px" in _regla("a.volver {")
    assert "min-height: 44px" in _regla("  .mtPie a { display")


def test_deja_libre_la_franja_de_la_pildora():
    m = re.search(r"body \{[^}]*padding: (\d+)px", _estilo())
    assert m and int(m.group(1)) >= 52 + 12


def test_sin_sepia():
    assert "sepia(" not in METRICAS
