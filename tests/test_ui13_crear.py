"""UI·13 — el resto de crear con la carta de diseño (docs/DISENO.md).

Formulario, revisión, imágenes y resultado: carta.css (Bricolage + Geist,
botones de tres niveles, foco), iconos de trazo en vez de emojis, la escala
de seis tamaños y un solo botón ámbar por estado de la pantalla.
"""
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CREAR = (RAIZ / "static" / "crear.html").read_text(encoding="utf-8")
ICONOS = (RAIZ / "static" / "iconos.js").read_text(encoding="utf-8")


def _estilo():
    return CREAR[CREAR.index("<style>"):CREAR.index("</style>")]


def _seccion(id_):
    i = CREAR.index(f'<section id="{id_}"')
    return CREAR[i:CREAR.index("</section>", i)]


def test_carga_la_carta_antes_que_su_estilo():
    assert CREAR.index('href="/carta.css"') < CREAR.index("<style>")
    assert "--acc:var(--c-ambar); --acc2:var(--c-ambar-claro);" in CREAR


def test_titulos_en_bricolage_y_texto_en_geist():
    e = _estilo()
    assert "body { margin:0; background:var(--bg); color:var(--txt); font:var(--t-sm)/1.5 var(--f-texto); }" in e
    assert "h1 { font:800 var(--t-titulo-lg)/1.1 var(--f-titulo);" in e
    assert "h2 { font:700 var(--t-titulo-sm)/1.3 var(--f-titulo);" in e


def test_sin_tamanos_de_letra_fuera_de_la_escala():
    assert not re.findall(r"font-size:\s*[\d.]+px", CREAR)
    assert not re.search(r"font:\s*[\d.]+px", CREAR)


EMOJIS = "✨📐⏱🧑🎙📝📚⚡🖼🎬✅⬇✂🔁▶📡🟢🟡🔴✕🔄⚖●✓×"


def test_sin_emojis_como_iconos():
    for e in EMOJIS:
        assert e not in CREAR, f"quedó {e} en crear"


def test_los_iconos_que_usa_crear_existen():
    nombres = set(re.findall(r'data-icono="([a-z]+)"', CREAR)) | set(re.findall(r"icono\('([a-z]+)'", CREAR))
    assert len(nombres) >= 15
    for n in nombres:
        assert f"    {n}: '" in ICONOS, n


def test_botones_con_los_niveles_de_la_carta():
    assert 'class="btn sec"' not in CREAR and "class=\"btn\"" not in CREAR
    assert "linear-gradient(90deg,var(--acc),var(--acc2)); margin-top" not in CREAR
    # la forma y los estados son de carta.css; aquí solo el acomodo
    assert ".btn { display:flex; width:100%; min-height:48px; margin-top:18px; }" in _estilo()


def test_un_solo_principal_por_estado():
    for sec, boton in (("form", "enviar"), ("revision", "producir"), ("imagenes", "animar"), ("error", "reintentar")):
        html = _seccion(sec)
        assert html.count("btn-pri") == 1, sec
        assert f'class="btn btn-pri' in html[html.index(f'id="{boton}"') - 40:html.index(f'id="{boton}"')], sec
    assert "btn-pri" not in _seccion("resultado")


def test_elegir_no_es_ambar():
    """Carta §3: el ámbar dice «haz algo». Lo elegido (chips, formato, la
    opción de personaje) y el hover se marcan en neutro."""
    e = _estilo()
    for regla in (".chip.on {", ".fmt.on {", ".opciones img.on {"):
        cuerpo = e[e.index(regla):e.index("}", e.index(regla))]
        assert "--acc" not in cuerpo and "#2e2110" not in cuerpo, regla
    assert "border-color:var(--acc)" not in e


def test_enlaces_en_azul_claro():
    assert "a { color:var(--c-enlace); }" in CREAR
    assert "#5b8dd6" not in CREAR


def test_lo_que_se_toca_mide_44():
    e = _estilo()
    for regla in (".mas {", ".paso {", ".escena button {"):
        assert "width:44px; height:44px;" in e[e.index(regla):e.index("}", e.index(regla))], regla


def test_las_voces_dicen_su_nivel_en_palabras():
    assert "const NIVEL = {verde:'Encaja', amarillo:'Tal vez', rojo:'No encaja'};" in CREAR


def test_los_iconos_de_los_titulos_van_en_gris():
    """Decisión del dueño (25-sep). El color queda para los estados."""
    e = _estilo()
    assert "  h2 .ico { color:var(--mut); }" in e
    assert "#resultado h2 .ico { color:#3dd68c; }" in e
    assert "#error h2 .ico { color:#ff8080; }" in e
