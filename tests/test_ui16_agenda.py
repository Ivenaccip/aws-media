"""UI·16 — agenda.html manda al cuadro de avisos (trabajos.js) lo que no es de
ningún campo: los fallos de red o de Blotato de la página (antes #agErr, con su
enlace «Conectar Blotato» en 409) y las confirmaciones de cancelar y cambiar la
hora (antes la línea role="status" #agEstado). El error del diálogo sigue junto
a su campo, el confirm() sigue y la caída de la lista (AGCAIDA) se queda.
"""
import functools
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


@functools.lru_cache(maxsize=None)
def _agenda() -> str:
    return (RAIZ / "static" / "agenda.html").read_text(encoding="utf-8")


def _cuerpo(inicio, largo=900):
    i = _agenda().index(inicio)
    return _agenda()[i:i + largo]


def _estilo():
    return _agenda()[_agenda().index("<style>"):_agenda().index("</style>")]


def test_la_caja_de_error_y_la_linea_de_estado_ya_no_existen():
    for id_ in ("agErr", "agEstado"):
        assert f'id="{id_}"' not in _agenda(), id_
        assert f"#{id_}" not in _agenda(), id_
    assert "function agAnunciar" not in _agenda() and "agAnunciar(" not in _agenda()
    # sin la línea verde, la clase .ok ya no la usa nadie
    assert ".ok {" not in _estilo()


def test_el_aviso_de_pagina_va_al_cuadro_con_su_clave():
    f = _cuerpo("function agAviso(msg, conectar, reintentar) {", 500)
    assert "if (!msg) { window.avisos?.quitar('agenda-error'); return; }" in f
    assert "const op = {tipo:'mal', clave:'agenda-error'};" in f
    assert ("if (conectar) op.accion = {texto:'Conectar Blotato', "
            "al: () => { location.href = AGCONECTAR; }};") in f
    assert "else if (reintentar) op.accion = {texto:'Reintentar', al: reintentar};" in f
    assert "window.avisos?.mostrar(msg, op);" in f
    # el destino de «Conectar Blotato» es el mismo que tenía el enlace
    assert 'const AGCONECTAR = "/estudio/?blotato=conectar";' in _agenda()
    # el texto va plano: el cuadro lo escapa, aquí no se arma HTML
    assert "innerHTML" not in f


def test_la_carga_ofrece_reintentar_y_limpia_al_empezar():
    f = _cuerpo("async function agCargarYa(mas) {", 2200)
    assert f.index('agAviso("");') < f.index("await fj(")
    assert "agAviso(j.error, !!j.reconectar, () => agCargar(mas));" in f
    assert "agFallo(e, () => agCargar(mas));" in f
    # la caída de la lista sigue: sin nada pintado se explica el hueco
    assert f.count('$("#agLista").innerHTML = AGCAIDA;') == 2
    assert "No pudimos traer tu agenda ahora. Pulsa «Actualizar»" in _agenda()


def test_las_confirmaciones_van_como_ok():
    assert ("window.avisos?.mostrar(`Hora cambiada: ${it.red} sale el ${agFecha(cuando)} "
            "(tu hora).`, {tipo:'ok'});") in _agenda()
    assert 'window.avisos?.mostrar("Publicación cancelada.", {tipo:\'ok\'});' in _agenda()
    # y el foco sigue volviendo a un sitio con nombre
    assert _agenda().count('agFoco("#agRefrescar");') >= 3


def test_el_comentario_dice_quien_lleva_el_role():
    assert "cuadro de avisos de trabajos.js, que lleva el role=\"status\"" in _agenda()
    assert 'src="/trabajos.js"' in _agenda()


def test_siempre_con_encadenamiento_opcional():
    assert not re.search(r"window\.avisos\.(mostrar|quitar)", _agenda())
    assert _agenda().count("window.avisos?.mostrar(") == 3
    assert _agenda().count("window.avisos?.quitar(") == 1


def test_confirm_y_el_error_del_dialogo_siguen_en_su_sitio():
    assert "if (!confirm(agConfirmarTexto(it))) return;" in _agenda()
    assert '<p class="err" id="agDlgErr" role="alert" hidden></p>' in _agenda()
    assert "if (malo) { agDlgAviso(malo); return; }" in _agenda()
    assert "} else if (agVigente(gen)) agDlgAviso(agTexto(e));" in _agenda()


def test_en_node_reintentar_recarga_y_el_aviso_se_quita_al_recuperarse(tmp_path):
    # un aviso 'mal' que sobrevive a una carga buena mentiría: se comprueba con
    # la pantalla de verdad (el mismo arnés de node de test_m23_agenda_ui)
    from tests.test_m23_agenda_ui import _node
    o = _node(r"""
rutas["/api/agenda"] = [FALLO(502, "Blotato no respondió a tiempo.")];
await agCargar();
out.antes = aviso("agenda-error");
out.accion = vivos["agenda-error"].accion.texto;
rutas["/api/agenda"] = [OK({items: [], cursor: null, total: 0})];
await vivos["agenda-error"].accion.al();
out.despues = aviso("agenda-error");
out.recargas = llamadas.filter(u => u === "/api/agenda").length;
""", tmp_path)
    assert o["antes"] == "Blotato no respondió a tiempo."
    assert o["accion"] == "Reintentar"
    assert o["recargas"] == 2, "«Reintentar» no volvió a pedir la agenda"
    assert o["despues"] == "", "el aviso de error sobrevivió a una carga buena"
