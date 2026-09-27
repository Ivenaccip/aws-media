"""UI·16 — mix.html manda al cuadro de avisos (trabajos.js) lo que no es de
ningún campo: los fallos de red o del servidor (antes #mxErr, con «Conectar
Blotato» en 409) y las confirmaciones de la campaña y del ejemplo (antes la
línea role="status" #mxEstado). Lo que falta para pedir el ejemplo es
validación y se queda en la página, junto al botón; el confirm() de apagar y
#mxCuentaErr también se quedan.
"""
import functools
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent


@functools.lru_cache(maxsize=None)
def _mix() -> str:
    return (RAIZ / "static" / "mix.html").read_text(encoding="utf-8")


def _cuerpo(inicio, largo=900):
    i = _mix().index(inicio)
    return _mix()[i:i + largo]


def _estilo():
    return _mix()[_mix().index("<style>"):_mix().index("</style>")]


def test_la_caja_de_error_y_la_linea_de_estado_ya_no_existen():
    for id_ in ("mxErr", "mxEstado"):
        assert f'id="{id_}"' not in _mix(), id_
        assert f"#{id_}" not in _mix(), id_
    assert "mxAnunciar" not in _mix()
    assert ".ok {" not in _estilo()
    assert "scrollIntoView" not in _mix()


def test_el_aviso_de_pagina_va_al_cuadro_con_su_clave():
    f = _cuerpo("function mxAviso(msg, conectar, reintentar) {", 500)
    assert "if (!msg) { window.avisos?.quitar('mix-error'); return; }" in f
    assert "const op = {tipo:'mal', clave:'mix-error'};" in f
    assert ("if (conectar) op.accion = {texto:'Conectar Blotato', "
            "al: () => { location.href = MXCONECTAR_A; }};") in f
    assert "window.avisos?.mostrar(msg, op);" in f
    assert 'const MXCONECTAR_A = "/estudio/?blotato=conectar";' in _mix()
    # #mxCuentaErr sigue con su enlace de siempre
    assert 'const MXCONECTAR = ` <a href="${MXCONECTAR_A}">Conectar Blotato</a>`;' in _mix()
    assert 'id="mxCuentaErr"' in _mix()


def test_cada_llamador_de_mxaviso_esta_clasificado():
    # validación: se queda en la página, junto a #mxFalta
    assert '<p class="err" id="mxVerErr" role="alert" style="margin-top:8px" hidden></p>' in _mix()
    assert _mix().index('id="mxFalta"') < _mix().index('id="mxVerErr"')
    assert "if (falta) { mxAvisoFalta(falta); return; }" in _mix()
    assert "mxAviso(falta)" not in _mix()
    assert "if (!falta) mxAvisoFalta(\"\");" in _cuerpo("function mxCambio() {", 300)
    # servidor: el error del ejemplo que murió sin nadie mirando
    assert "if (aMedias.error) { mxAviso(aMedias.error); return; }" in _mix()
    # los que quedan son limpiezas o pasan por mxFallo (red/servidor)
    llamadas = set(re.findall(r"mxAviso\(([^,)]*)", _mix()))
    assert llamadas == {'""', "aMedias.error", "mxTexto(e", "msg"}


def test_la_carga_fallida_ofrece_reintentar():
    f = _cuerpo("async function mxCargar() {", 500)
    assert "mxFallo(e, mxCargar);" in f
    assert f.index("mxFallo(e, mxCargar);") < f.index('mxAviso("");')


def test_las_confirmaciones_van_como_ok():
    assert ("`una cada día a las ${mxHoraTexto($(\"#mxHora\").value)}.`, {tipo:'ok'});") in _mix()
    f = _cuerpo("async function mxApagar() {", 900)
    assert "`Campaña apagada. Te devolvimos ${mxPl(devueltos, \"crédito\", \"créditos\")}.`" in f
    assert ': "Campaña apagada.", {tipo:\'ok\'});' in f
    assert ('window.avisos?.mostrar("Campaña reanudada. La próxima sale a su hora.", '
            "{tipo:'ok'});") in _mix()
    assert ('window.avisos?.mostrar("Listo: abajo está la publicación del primer día.",\n'
            "      {tipo:'ok', clave:'mix-ejemplo'});") in _mix()


def test_los_avisos_del_ejemplo_son_info_de_ocho_segundos():
    assert ('window.avisos?.mostrar("Estamos preparando tu ejemplo. Aparece aquí solo.",\n'
            "    {tipo:'info', segundos: 8, clave:'mix-ejemplo'});") in _mix()
    f = _cuerpo("    if (fallo) {\n      window.avisos?.quitar('mix-ejemplo');", 400)
    assert "mxFallo(fallo);" in f
    assert "Descartamos ese ejemplo porque la campaña " in f
    assert "{tipo:'info', segundos: 8, clave:'mix-ejemplo'});" in f


def test_confirm_de_apagar_sigue():
    assert "if (!confirm(mxTextoApagar(dev))) return;" in _mix()


def test_siempre_con_encadenamiento_opcional():
    assert not re.search(r"window\.avisos\.(mostrar|quitar)", _mix())
    assert _mix().count("window.avisos?.mostrar(") == 7
    assert _mix().count("window.avisos?.quitar(") == 3


def test_en_node_los_avisos_llegan_con_su_clave(tmp_path):
    nodo = shutil.which("node")
    if not nodo:
        pytest.skip("node no está en el PATH")
    i = _mix().index("// ── avisos ─")
    js = _mix()[i:_mix().index("// ── 1. la foto", i)]
    codigo = r"""
const nodos = {};
const $ = s => (nodos[s] = nodos[s] || {hidden: true, textContent: ""});
const vivos = {};
const location = {href: ""};
const window = {avisos: {mostrar(t, op) { vivos[op.clave] = {t, ...op}; },
                         quitar(c) { delete vivos[c]; }}};
const MXCONECTAR_A = "/estudio/?blotato=conectar";
const mxTexto = e => (e && typeof e.status === "number" && e.message) ? e.message : "SINRED";
""" + js + r"""
const out = {};
mxFallo(Object.assign(new Error("Conecta tu Blotato."), {status: 409}));
out.a409 = vivos["mix-error"].accion.texto;
vivos["mix-error"].accion.al();
out.destino = location.href;
const recarga = () => {};
mxFallo(new TypeError("Failed to fetch"), recarga);
out.red = [vivos["mix-error"].t, vivos["mix-error"].tipo, vivos["mix-error"].accion.texto];
mxAviso("");
out.limpio = !("mix-error" in vivos);
mxAvisoFalta("Falta la foto de tu producto.");
out.falta = [$("#mxVerErr").textContent, $("#mxVerErr").hidden, Object.keys(vivos).length];
mxAvisoFalta("");
out.sinFalta = $("#mxVerErr").hidden;
console.log(JSON.stringify(out));
"""
    f = tmp_path / "mx.js"
    f.write_text(codigo, encoding="utf-8")
    r = subprocess.run([nodo, str(f)], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    o = json.loads(r.stdout)
    assert o["a409"] == "Conectar Blotato" and o["destino"] == "/estudio/?blotato=conectar"
    assert o["red"] == ["SINRED", "mal", "Reintentar"]
    assert o["limpio"] is True
    assert o["falta"] == ["Falta la foto de tu producto.", False, 0]
    assert o["sinFalta"] is True
