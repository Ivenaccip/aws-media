"""UI·14 — MIX (publicidad automática) con la carta de diseño (docs/DISENO.md).

Retoque en su sitio, como crear en UI·13: carta.css (Bricolage + Geist,
botones de tres niveles, foco ámbar), iconos de trazo en vez de glifos, la
escala de seis tamaños y un solo botón ámbar por vista. El comportamiento
(ids, endpoints, cobro) no cambia.
"""
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
MIX = (RAIZ / "static" / "mix.html").read_text(encoding="utf-8")
ICONOS = (RAIZ / "static" / "iconos.js").read_text(encoding="utf-8")


def _estilo():
    return MIX[MIX.index("<style>"):MIX.index("</style>")]


def _markup():
    return MIX[MIX.index("<body>"):MIX.index("<script")]


def _regla(selector):
    e = _estilo()
    i = e.index(selector)
    return e[i:e.index("}", i)]


def test_carga_la_carta_y_los_iconos():
    assert MIX.index('href="/carta.css"') < MIX.index("<style>")
    inline = MIX.index("<script>\n")
    assert MIX.index('<script src="/iconos.js"></script>') < inline
    assert "--acc: var(--c-ambar); --acc2: var(--c-ambar-claro);" in MIX


def test_titulos_en_bricolage_y_texto_en_geist():
    e = _estilo()
    assert "font: var(--t-sm)/1.5 var(--f-texto);" in _regla("body {")
    assert "h1 { font: 800 var(--t-titulo-lg)/1.1 var(--f-titulo); letter-spacing: -0.02em;" in e
    assert "section h2 { font: 700 var(--t-titulo-sm)/1.3 var(--f-titulo);" in e


def test_sin_tamanos_de_letra_fuera_de_la_escala():
    assert not re.findall(r"font-size:\s*[\d.]+(px|em|rem)", MIX)
    assert not re.search(r"font:\s*(\d{3}\s+)?[\d.]+px", MIX)
    for t in re.findall(r"font-size:\s*([^;]+);", MIX):
        assert t.strip() in {"var(--t-xs)", "var(--t-sm)", "var(--t-md)", "inherit"}, t


def test_los_numeros_que_cambian_no_bailan():
    assert "tabular-nums" in _regla(".dia {")
    assert "tabular-nums" in _regla(".fila .cuando {")


GLIFOS = "←→‹›✕✓×⟳🔄✨📅📷🖼"


def test_sin_glifos_como_iconos():
    m = _markup()
    for g in GLIFOS:
        assert g not in m, f"quedó {g} en el markup de mix"
    js = MIX[MIX.index("<script>\n"):]
    for g in "‹›✕✓×":
        assert g not in js, f"quedó {g} en el JS de mix"


def test_los_iconos_que_usa_mix_existen():
    nombres = set(re.findall(r'data-icono="([a-z]+)"', MIX)) | set(re.findall(r"icono\('([a-z]+)'", MIX))
    assert {"volver", "izquierda", "derecha", "subir"} <= nombres
    for n in nombres:
        assert f"    {n}: '" in ICONOS, n


def test_las_flechas_del_mes_dicen_que_son():
    for id_, rotulo in (("mxMesAntes", "Mes anterior"), ("mxMesDespues", "Mes siguiente")):
        i = MIX.index(f'id="{id_}"')
        boton = MIX[MIX.rindex("<button", 0, i):MIX.index("</button>", i)]
        assert f'aria-label="{rotulo}"' in boton
        assert "data-icono=" in boton


def test_botones_con_los_niveles_de_la_carta():
    assert not re.search(r'class="(sec|pri)[ "]', MIX)
    assert 'class="sec ' not in MIX and "button.pri" not in MIX
    assert 'class="btn btn-peligro" id="mxApagar"' in MIX
    # los colores del botón son de carta.css; aquí no queda el azul del hub
    assert "#5b8dd6" not in MIX and "#2b4a75" not in MIX


def test_un_solo_principal_por_vista():
    m = _markup()
    formulario = m[m.index('<div id="mxCapa"'):m.index('<section id="mxViva"')]
    viva = m[m.index('<section id="mxViva"'):]
    assert formulario.count("btn-pri") == 1
    assert 'class="btn btn-pri" id="mxVer"' in formulario
    assert "btn-pri" not in viva
    # cuando aparece el costo, el principal pasa a ser «Encender la campaña»
    costo = MIX[MIX.index("function mxPintarCosto"):MIX.index("async function mxGuardar")]
    assert '$("#mxVer").className = (mxEjemploVigente() && mxCosto) ? "btn btn-sec" : "btn btn-pri";' in costo
    assert costo.count("btn-pri") == 2   # el de encender y la vuelta de mxVer


def test_encender_sigue_diciendo_lo_mismo():
    assert '"Encender la campaña</button>"' in MIX


def test_elegir_no_es_ambar():
    """Carta §3: el ámbar dice «haz algo». El tono elegido y el rango del
    calendario se marcan en neutro."""
    for regla in ('.tonos .btn[aria-pressed="true"] {', ".dia.dentro, .dia.ini, .dia.fin {",
                  ".dia.ini, .dia.fin {", ".dia:not(:disabled):hover {"):
        cuerpo = _regla(regla)
        assert "--acc" not in cuerpo and "ambar" not in cuerpo, regla
    assert "var(--txt)" in _regla('.tonos .btn[aria-pressed="true"] {')


def test_enlaces_en_azul_claro_y_campos_de_la_carta():
    assert "a { color: var(--c-enlace); }" in _estilo()
    campos = _regla("select, textarea {")
    assert "border: 1px solid var(--campo)" in campos and "var(--r-medio)" in campos
    assert "var(--r-grande)" in _regla("section {")


def test_lo_que_se_toca_mide_44():
    assert "min-height: 44px" in _regla(".dia {")
    assert "width: 44px" in _regla(".calCab .flecha {")
    assert "min-height: 44px" in _regla("a.volver {")
    assert "min-height: 44px" in _regla("select {")


def test_la_pildora_no_tapa_el_contenido():
    """La píldora del monedero termina en ~52 px: el contenido empieza abajo."""
    assert "padding: 64px" in _regla("body {")
    movil = _estilo()[_estilo().index("@media (max-width: 640px)"):]
    assert "body { padding: 64px 16px" in movil


def test_sin_sepia_y_sin_foco_propio():
    assert "sepia(" not in MIX
    # el foco lo pone carta.css, igual en todas las pantallas
    assert ":focus-visible" not in _estilo()
