"""UI·14 — la agenda con la carta de diseño (docs/DISENO.md).

La lista de lo programado y el diálogo de cambiar la hora: carta.css
(Bricolage + Geist, botones de tres niveles, foco), iconos de trazo en vez de
emojis, la escala de seis tamaños y un solo botón ámbar por vista (Guardar, en
el diálogo; la lista no cobra ni tiene acción principal).
"""
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
AGENDA = (RAIZ / "static" / "agenda.html").read_text(encoding="utf-8")
ICONOS = (RAIZ / "static" / "iconos.js").read_text(encoding="utf-8")

INICIO_AG = "// ── ag · Agenda (C3)"


def _estilo():
    return AGENDA[AGENDA.index("<style>"):AGENDA.index("</style>")]


def _regla(selector):
    e = _estilo()
    i = e.index(selector + " {")
    return e[i:e.index("}", i)]


def _main():
    return AGENDA[AGENDA.index("<main>"):AGENDA.index("</main>")]


def _dialogo():
    return AGENDA[AGENDA.index('<dialog id="agDlg"'):AGENDA.index("</dialog>")]


def _tarjeta():
    i = AGENDA.index("function agTarjeta(")
    return AGENDA[i:AGENDA.index("\n}\n", i)]


def test_carga_la_carta_y_los_iconos():
    assert AGENDA.index('href="/carta.css"') < AGENDA.index("<style>")
    assert AGENDA.index('src="/iconos.js"') < AGENDA.index(INICIO_AG)
    assert AGENDA.index('src="/iconos.js"') < AGENDA.index('src="/auth.js"')


def test_los_tokens_locales_salen_de_la_carta():
    raiz = _regla(":root")
    for local, carta in (("--bg", "--c-fondo"), ("--card", "--c-superficie"),
                         ("--line", "--c-linea"), ("--txt", "--c-texto"),
                         ("--mut", "--c-secundario"), ("--acc", "--c-ambar"),
                         ("--acc2", "--c-ambar-claro")):
        assert f"{local}: var({carta});" in raiz, local
    # el azul del hub ya no es el acento de esta pantalla
    assert "#5b8dd6" not in AGENDA and "#2b4a75" not in AGENDA


def test_titulos_en_bricolage_y_texto_en_geist():
    e = _estilo()
    assert "body { font: var(--t-sm)/1.5 var(--f-texto);" in e
    assert "h1 { font: 800 var(--t-titulo-lg)/1.1 var(--f-titulo); letter-spacing: -0.02em;" in e
    assert "#agDlg h2 { font: 700 var(--t-titulo-sm)/1.3 var(--f-titulo);" in e


def test_sin_tamanos_de_letra_fuera_de_la_escala():
    assert not re.findall(r"font-size:\s*[\d.]+(px|rem|em)", AGENDA)
    assert not re.search(r"font:\s*(\d{3}\s+)?[\d.]+px", AGENDA)
    usados = set(re.findall(r"var\(--t-([a-z-]+)\)", _estilo()))
    assert usados <= {"xs", "sm", "md", "titulo-sm", "titulo-md", "titulo-lg"}, usados


EMOJIS = "📎✕←🔄📅🗓⏰✅❌⚠🗑✏×"


def test_sin_emojis_como_iconos():
    for e in EMOJIS:
        assert e not in AGENDA, f"quedó {e} en la agenda"


def test_los_iconos_que_usa_la_agenda_existen():
    nombres = set(re.findall(r'data-icono="([a-z]+)"', AGENDA))
    assert {"volver", "cerrar", "adjunto"} <= nombres
    for n in nombres:
        assert f"    {n}: '" in ICONOS, n


def test_la_lista_pinta_los_iconos_que_escribe():
    """El clip de los adjuntos llega por innerHTML: sin pintar se quedaría
    como un <i> vacío. En node (los tests de m23) no hay window.iconos."""
    assert "if (window.iconos) window.iconos.pintar(lista);" in AGENDA


def test_la_x_de_cerrar_es_un_icono_con_nombre():
    d = _dialogo()
    assert 'aria-label="Cerrar"><i data-icono="cerrar"></i></button>' in d
    assert "width: 44px; height: 44px;" in _regla("#agDlg .cerrar")


def test_botones_con_los_niveles_de_la_carta():
    assert re.search(r'class="(sec|pri|sec peligro)"', AGENDA) is None
    e = _estilo()
    # los colores de los botones son de carta.css, no de la página
    assert re.search(r"(^|\n)\s*button[\s.{:]", e) is None
    assert 'class="btn btn-sec" data-ag="hora"' in _tarjeta()
    assert 'class="btn btn-peligro" data-ag="cancelar"' in _tarjeta()


def test_un_solo_principal_por_vista():
    # la lista no cobra ni tiene una acción que destaque: ningún ámbar
    assert "btn-pri" not in _main() and "btn-pri" not in _tarjeta()
    d = _dialogo()
    assert d.count("btn-pri") == 1
    assert 'class="btn btn-pri" id="agGuardar"' in d


def test_sin_filtro_sepia():
    assert "sepia(" not in AGENDA


def test_enlaces_en_azul_claro():
    assert "a { color: var(--c-enlace); }" in _estilo()


def test_campos_y_tarjetas_de_la_carta():
    campo = _regla("input")
    assert "border: 1px solid var(--campo);" in campo and "background: var(--elev);" in campo
    assert "border-radius: var(--r-medio);" in campo
    for sel in ("section", ".tarjeta"):
        assert "border-radius: var(--r-grande);" in _regla(sel), sel
    assert "background: var(--card);" in _regla("section")


def test_lo_que_se_toca_mide_44():
    assert "min-height: 44px;" in _regla("a.volver")
    assert "min-height: 44px;" in _regla("input")


def test_el_contenido_empieza_bajo_la_pildora():
    """monedero.js: top 12 + 40 de alto = acaba a 52 px (tests/test_ui12_pildora.py)."""
    m = re.search(r"padding: (\d+)px 24px 48px;", _regla("body"))
    assert m and int(m.group(1)) >= 52 + 16


def test_ver_mas_se_sigue_escondiendo():
    """.btn trae display:inline-flex y le ganaba al atributo hidden: «Ver más»
    salía con la agenda caída (sin cursor)."""
    assert ".btn[hidden] { display: none; }" in _estilo()
    assert 'id="agMas" class="btn btn-sec" hidden' in AGENDA
