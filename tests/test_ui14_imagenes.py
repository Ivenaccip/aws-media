"""UI·14 — imágenes (crear y editar) con la carta de diseño (docs/DISENO.md).

Retoque en su sitio, como crear en UI·13: carta.css (Bricolage + Geist,
botones de tres niveles, foco), iconos de trazo en vez de emojis, la escala
de seis tamaños y un solo botón ámbar (Generar / Cambiar / Transformar ✦ N).
Cambia el aspecto, no el comportamiento: esta pantalla cobra.
"""
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
IMG = (RAIZ / "static" / "imagenes.html").read_text(encoding="utf-8")
ICONOS = (RAIZ / "static" / "iconos.js").read_text(encoding="utf-8")


def _estilo():
    return IMG[IMG.index("<style>"):IMG.index("</style>")]


def _regla(selector):
    """La regla de nivel superior (dos espacios de sangría)."""
    e = _estilo()
    i = e.index("\n  " + selector + " {") + 3
    return e[i:e.index("}", i)]


def _seccion(id_):
    i = IMG.index(f'<section id="{id_}"')
    return IMG[i:IMG.index("</section>", i)]


def test_carga_la_carta_y_los_iconos():
    assert IMG.index('href="/carta.css"') < IMG.index("<style>")
    # iconos.js antes del guardrail y del script principal
    ico = IMG.index('<script src="/iconos.js"></script>')
    assert ico < IMG.index('<script src="/guardrail.js"></script>')
    assert ico < IMG.index("<script>\n")
    assert "--acc:var(--c-ambar); --acc2:var(--c-ambar-claro);" in IMG


def test_titulos_en_bricolage_y_texto_en_geist():
    assert "font:var(--t-sm)/1.5 var(--f-texto)" in _regla("body")
    assert "font:800 var(--t-titulo-lg)/1.1 var(--f-titulo); letter-spacing:-.02em;" in _regla("h1")
    assert "font:700 var(--t-titulo-sm)/1.3 var(--f-titulo)" in _regla("h2")
    assert "system-ui, Segoe UI" not in IMG


ESCALA = {"var(--t-xs)", "var(--t-sm)", "var(--t-md)",
          "var(--t-titulo-sm)", "var(--t-titulo-md)", "var(--t-titulo-lg)"}


def test_sin_tamanos_de_letra_fuera_de_la_escala():
    assert not re.findall(r"font-size:\s*[\d.]+(px|em|rem)", IMG)
    assert not re.search(r"font:\s*(\d+\s+)?[\d.]+px", IMG)
    for t in re.findall(r"font-size:\s*([^;}]+)[;}]", IMG):
        assert t.strip() in ESCALA, t


EMOJIS = "✨📐🖌🖼✏⬇✕←⏳🎨"


def test_sin_emojis_como_iconos():
    for e in EMOJIS:
        assert e not in IMG, f"quedó {e} en imágenes"
    assert "sepia(" not in IMG
    assert ">+</button>" not in IMG and "＋ Nueva" not in IMG


def test_los_iconos_que_usa_imagenes_existen():
    nombres = set(re.findall(r'data-icono="([a-z]+)"', IMG)) | set(re.findall(r"icono\('([a-z]+)'", IMG))
    assert {"volver", "estilo", "pincel", "formato", "imagen", "cerrar",
            "descargar", "editar", "mas"} <= nombres
    for n in nombres:
        assert f"    {n}: '" in ICONOS, n


def test_los_iconos_de_los_titulos_van_en_gris():
    assert "color:var(--mut)" in _regla("h2 .ico")


def test_un_solo_principal_y_es_el_que_cobra():
    form = _seccion("form")
    assert form.count("btn-pri") == 1
    assert IMG.count("btn btn-pri") == 1
    assert '<button class="btn btn-pri generar" id="enviar">Generar</button>' in IMG
    # el precio sigue diciéndose «Verbo ✦ N» (M21)
    for verbo in ("Generar", "Cambiar", "Transformar"):
        assert f"`{verbo} ✦ ${{n}}`" in IMG
    # el degradado propio se fue: la forma y los estados son de carta.css
    assert "linear-gradient(90deg, var(--acc), var(--acc2)); }" not in _regla(".generar")
    assert "min-height:48px" in _regla(".generar")


def test_el_resto_son_secundarios_o_enlace():
    assert "btn2" not in IMG
    for id_ in ("borrar", "ver-original", "ver-resultado", "quitar", "descargar", "seguir", "limpiar"):
        i = IMG.index(f'id="{id_}"')
        assert 'class="btn btn-sec"' in IMG[i - 30:i], id_
    assert 'class="btn-enlace" id="a-crear"' in IMG


def test_elegir_no_es_ambar():
    """Carta §3: el ámbar dice «haz algo». Lo elegido (estilo, formato, modo,
    el atajo de la paleta) se marca en neutro; el hover, en gris."""
    for regla in (".chip.on", ".fmt.on", ".modo.activo"):
        cuerpo = _regla(regla)
        assert "border-color:var(--txt)" in cuerpo and "background:var(--elev)" in cuerpo, regla
    for regla in (".chip:hover", ".fmt:hover", ".modo:hover"):
        assert "border-color:var(--mut)" in _regla(regla), regla
    assert "border-color:var(--acc)" not in _estilo()
    assert "#2e2110" not in IMG
    assert "--acc" not in _regla(".paleta b")


def test_enlaces_campos_y_tarjetas_de_la_carta():
    assert "color:var(--c-enlace)" in _regla("a")
    assert "#5b8dd6" not in IMG
    campo = _regla("input[type=text]")
    assert "border:1px solid var(--campo)" in campo and "border-radius:var(--r-medio)" in campo
    assert "border-radius:var(--r-grande)" in _regla(".card")


def test_lo_que_se_toca_mide_44():
    assert "width:44px; height:44px;" in _regla(".mas")
    assert "min-height:44px" in _regla(".inicio")
    assert "min-height:44px" in _regla(".modo")
    assert "min-height:44px" in _regla("#vacio .btn-enlace")


def test_el_foco_es_el_de_la_carta():
    """carta.css pone el anillo ámbar claro; la página no lo pisa."""
    assert ":focus-visible" not in _estilo()


def test_nada_queda_debajo_de_la_pildora():
    """UI·12: la píldora acaba a 52 px. En el teléfono el contenido baja a 64;
    en escritorio el título deja libre la franja con su margen simétrico."""
    movil = IMG[IMG.index("@media (max-width: 900px)"):]
    assert "main { padding-top:64px; }" in movil[:200]
    assert "padding-inline:max(0px, min(300px, calc(50% - 230px)))" in _regla(".cabeza")
