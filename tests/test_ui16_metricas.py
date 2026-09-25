"""UI·16 — metricas.html manda al cuadro de avisos (trabajos.js) los fallos de
red o de Blotato de la página (antes #mtErr, con su enlace «Conectar Blotato»
en 409). El anuncio por tarjeta (mtAnunciar / #mtEstado), la nota del recorte
(#mtNota) y la caída de la lista (MTCAIDA) se quedan.
"""
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
MT = (RAIZ / "static" / "metricas.html").read_text(encoding="utf-8")


def _cuerpo(inicio, largo=900):
    i = MT.index(inicio)
    return MT[i:i + largo]


def test_la_caja_de_error_ya_no_existe():
    assert 'id="mtErr"' not in MT
    assert "#mtErr" not in MT


def test_el_aviso_de_pagina_va_al_cuadro_con_su_clave():
    f = _cuerpo("function mtAviso(msg, conectar, reintentar) {", 500)
    assert "if (!msg) { window.avisos?.quitar('metricas-error'); return; }" in f
    assert "const op = {tipo:'mal', clave:'metricas-error'};" in f
    assert ("if (conectar) op.accion = {texto:'Conectar Blotato', "
            "al: () => { location.href = MTCONECTAR; }};") in f
    assert "else if (reintentar) op.accion = {texto:'Reintentar', al: reintentar};" in f
    assert "window.avisos?.mostrar(msg, op);" in f
    assert 'const MTCONECTAR = "/estudio/?blotato=conectar";' in MT
    assert "innerHTML" not in f


def test_la_carga_ofrece_reintentar():
    f = _cuerpo("async function mtCargarYa(mas) {", 3200)
    assert f.index('mtAviso("");') < f.index("await fj(url)")
    assert "mtAviso(j.error, !!j.reconectar, () => mtCargar(mas));" in f
    assert "mtAviso(mtTexto(e), e && e.status === 409, () => mtCargar(mas));" in f
    assert "mtCaida(false, false);" in f
    assert "No pudimos traer tus publicaciones ahora. Pulsa" in MT


def test_el_anuncio_por_tarjeta_y_la_nota_se_quedan():
    assert '<p id="mtEstado" class="ok" role="status" aria-live="polite"></p>' in MT
    assert '<p id="mtNota" class="mut" hidden></p>' in MT
    assert "function mtAnunciar(msg) {" in MT
    assert "mtAnunciar(vistas ? `${it.red}: ${vistas} vistas.` : `${it.red}: ${it.motivo}`);" in MT
    # pedir los números de una tarjeta sigue limpiando y avisando igual
    f = _cuerpo("async function mtPedir(ev, it) {", 2000)
    assert 'mtAviso("");' in f and "mtAviso(mtTexto(e), e && e.status === 409);" in f


def test_siempre_con_encadenamiento_opcional():
    assert not re.search(r"window\.avisos\.(mostrar|quitar)", MT)
    assert MT.count("window.avisos?.mostrar(") == 1
    assert MT.count("window.avisos?.quitar(") == 1
