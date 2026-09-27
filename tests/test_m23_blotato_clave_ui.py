"""M23 C — las pantallas de «cada usuario conecta SU cuenta de Blotato».

Separado de test_m23_blotato_clave.py (UI·1, Fase 0 de docs/PLAN-UI.md): aquí
solo vive lo que lee static/index.html o tools/editor/index.html, para que
retirar un HTML viejo no tumbe los tests del servidor.
"""
import functools
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# las pantallas

@functools.lru_cache(maxsize=None)
def _inicio() -> str:
    return (RAIZ / "static" / "index.html").read_text(encoding="utf-8")


@functools.lru_cache(maxsize=None)
def _editor() -> str:
    return (RAIZ / "tools" / "editor" / "index.html").read_text(encoding="utf-8")


def test_el_mas_de_blotato_abre_el_modal_y_no_un_alert():
    assert "Muy pronto" not in _inicio()
    assert '<dialog id="dlg-blotato"' in _inicio()
    assert "$('#blotato-mas').onclick = abrirBlotato;" in _inicio()


def test_el_campo_de_la_clave_no_se_ve_ni_se_autocompleta():
    campo = _inicio()[_inicio().index('<input id="blt-clave"'):]
    campo = campo[:campo.index(">")]
    assert 'type="password"' in campo and 'autocomplete="off"' in campo
    assert 'spellcheck="false"' in campo


def test_la_clave_se_borra_del_campo_al_conectar_y_al_cerrar():
    assert _inicio().count("$('#blt-clave').value = '';") >= 3


def test_el_modal_avisa_del_cobro_de_blotato_con_el_precio_del_servidor():
    aviso = _inicio()[_inicio().index('class="blt-aviso"'):]
    aviso = aviso[:aviso.index("</p>")]
    assert "prueba gratis" in aviso and "no nuestro" in aviso
    assert "$29" not in _inicio() and "29 dólares" not in _inicio(), "el precio sale de pricing.json"
    assert "d.plan.usd_por_mes" in _inicio() and "dólares al mes" in _inicio()


def test_el_modal_lleva_a_la_pagina_de_la_api_de_blotato():
    assert 'href="https://my.blotato.com/settings"' in _inicio()
    assert 'rel="noopener noreferrer"' in _inicio()


def test_el_menu_pregunta_sin_gastar_llamadas_a_blotato():
    assert "'?redes=0'" in _inicio()


def test_la_clave_del_env_no_se_ofrece_desconectar():
    assert "$('#blt-quitar').hidden = env;" in _inicio()


def test_el_inicio_abre_el_modal_si_viene_del_editor():
    assert "get('blotato') === 'conectar'" in _inicio()


def test_ya_no_queda_ninguna_seccion_proximamente():
    """C5 estrenó Competencia, la última que quedaba: el menú de Blotato ya no
    promete nada que no exista (el « · próximamente» lo pone el CSS de
    nav .prox small::after, así que basta con que no quede ningún .prox)."""
    assert 'class="prox"' not in _inicio(), "una sección del menú sigue sin existir"


def test_la_competencia_es_un_enlace_y_ya_no_dice_proximamente():
    # la línea del <a>, no la primera que mencione el nombre: los comentarios
    # del menú también lo nombran (M25 · B)
    linea = next(l for l in _inicio().splitlines()
                 if "Investiga tu competencia" in l and l.lstrip().startswith("<a "))
    assert 'class="prox"' not in linea, "el CSS le seguiría poniendo « · próximamente»"
    assert 'href="/competencia.html"' in linea
    assert linea.lstrip().startswith("<a ")


def test_la_agenda_es_un_enlace_y_ya_no_dice_proximamente():
    linea = next(l for l in _inicio().splitlines() if "Agenda tus publicaciones" in l)
    assert 'class="prox"' not in linea, "el CSS le seguiría poniendo « · próximamente»"
    assert 'href="/agenda.html"' in linea
    assert linea.lstrip().startswith("<a ")


def test_el_modal_ya_no_dice_que_programar_llega_pronto():
    """C2: programar corre en local y en el servicio. El único aviso antes de
    generar la clave es el cobro de Blotato."""
    assert "blt-pronto" not in _inicio()
    assert "d.agendar" not in _inicio()
    assert "llega en los próximos días" not in _inicio()
    form = _inicio()[_inicio().index('<form id="blt-form"'):]
    assert form.index('class="blt-aviso"') < form.index('id="blt-clave"')


def test_arrastrar_desde_el_campo_no_cierra_el_modal():
    assert "addEventListener('pointerdown'" in _inicio()
    assert "if (bajoFuera && fueraDe(ev)) cerrarBlotato();" in _inicio()


def test_el_editor_deja_reconectar_una_clave_revocada():
    # C2: conectado/reconectar salen de api/publicar/cuentas, no del estado
    assert "const conectar = !conectado || reconectar;" in _editor()
    assert "b3mascota(!!cu.conectado, !!cu.reconectar);" in _editor()
    assert "reconectar Blotato" in _editor()


def test_el_editor_manda_a_conectar_en_el_inicio():
    assert 'window.open("/estudio/?blotato=conectar"' in _editor()
    assert "my.blotato.com/settings/api" not in _editor()


def test_el_editor_ofrece_programar_en_todas_partes():
    """C2: ya no hay rama «llega muy pronto» que esconda el formulario."""
    assert "st.agendar" not in _editor()
    assert "llega muy pronto" not in _editor()
    assert 'id="b3agendar"' in _editor()


def test_en_el_telefono_el_inicio_no_se_desplaza_de_lado():
    """Visto 2026-09-16 a 375 px: la página medía 1044 px (el menú de secciones
    ensanchaba la columna) y, arreglado eso, 439 px (el tooltip oculto de
    «Tengo una idea» salía por la derecha)."""
    movil = _inicio()[_inicio().index("@media (max-width: 860px)"):]
    movil = movil[:movil.index("</style>")]
    assert ".layout > * { min-width: 0; }" in movil
    # M25 · B: «Tengo una idea» ya no existe — el botón de en medio de la fila
    # es ahora el desplegable, y hereda el mismo tooltip que se salía.
    assert "#btn-opcion[data-tip]::after { left: 50%; transform: translateX(-50%); }" in movil
    # Y la fila se parte antes que apretarse: apretada, el rótulo del botón se
    # cortaba en dos líneas y el ▾ quedaba suelto debajo (visto 2026-09-18).
    assert ".prompt .acciones { flex-wrap: wrap; row-gap: 10px; }" in movil
    assert "max-width: min(250px, calc(100vw - 72px))" in movil


def test_el_modal_se_centra_pese_al_reset_de_margenes():
    assert "* { box-sizing: border-box; margin: 0; }" in _inicio()
    regla = _inicio()[_inicio().index("#dlg-blotato {"):]
    assert regla[:regla.index("}")].count("margin: auto") == 1
