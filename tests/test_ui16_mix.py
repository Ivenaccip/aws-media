"""UI·16 — mix.html manda al cuadro de avisos (trabajos.js) lo que no es de
ningún campo: los fallos de red o del servidor (antes #mxErr, con «Conectar
Blotato» en 409) y las confirmaciones de la campaña y del ejemplo (antes la
línea role="status" #mxEstado). Lo que falta para pedir el ejemplo es
validación y se queda en la página, junto al botón; el confirm() de apagar y
#mxCuentaErr también se quedan.
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
MIX = (RAIZ / "static" / "mix.html").read_text(encoding="utf-8")


def _cuerpo(inicio, largo=900):
    i = MIX.index(inicio)
    return MIX[i:i + largo]


def _estilo():
    return MIX[MIX.index("<style>"):MIX.index("</style>")]


def test_la_caja_de_error_y_la_linea_de_estado_ya_no_existen():
    for id_ in ("mxErr", "mxEstado"):
        assert f'id="{id_}"' not in MIX, id_
        assert f"#{id_}" not in MIX, id_
    assert "mxAnunciar" not in MIX
    assert ".ok {" not in _estilo()
    assert "scrollIntoView" not in MIX


def test_el_aviso_de_pagina_va_al_cuadro_con_su_clave():
    f = _cuerpo("function mxAviso(msg, conectar, reintentar) {", 500)
    assert "if (!msg) { window.avisos?.quitar('mix-error'); return; }" in f
    assert "const op = {tipo:'mal', clave:'mix-error'};" in f
    assert ("if (conectar) op.accion = {texto:'Conectar Blotato', "
            "al: () => { location.href = MXCONECTAR_A; }};") in f
    assert "window.avisos?.mostrar(msg, op);" in f
    assert 'const MXCONECTAR_A = "/?blotato=conectar";' in MIX
    # #mxCuentaErr sigue con su enlace de siempre
    assert 'const MXCONECTAR = ` <a href="${MXCONECTAR_A}">Conectar Blotato</a>`;' in MIX
    assert 'id="mxCuentaErr"' in MIX


def test_cada_llamador_de_mxaviso_esta_clasificado():
    # validación: se queda en la página, junto a #mxFalta
    assert '<p class="err" id="mxVerErr" role="alert" style="margin-top:8px" hidden></p>' in MIX
    assert MIX.index('id="mxFalta"') < MIX.index('id="mxVerErr"')
    assert "if (falta) { mxAvisoFalta(falta); return; }" in MIX
    assert "mxAviso(falta)" not in MIX
    assert "if (!falta) mxAvisoFalta(\"\");" in _cuerpo("function mxCambio() {", 300)
    # servidor: el error del ejemplo que murió sin nadie mirando
    assert "if (aMedias.error) { mxAviso(aMedias.error); return; }" in MIX
    # los que quedan son limpiezas o pasan por mxFallo (red/servidor)
    llamadas = set(re.findall(r"mxAviso\(([^,)]*)", MIX))
    assert llamadas == {'""', "aMedias.error", "mxTexto(e", "msg"}


def test_la_carga_fallida_ofrece_reintentar():
    f = _cuerpo("async function mxCargar() {", 500)
    assert "mxFallo(e, mxCargar);" in f
    assert f.index("mxFallo(e, mxCargar);") < f.index('mxAviso("");')


def test_las_confirmaciones_van_como_ok():
    assert ("`una cada día a las ${mxHoraTexto($(\"#mxHora\").value)}.`, {tipo:'ok'});") in MIX
    f = _cuerpo("async function mxApagar() {", 900)
    assert "`Campaña apagada. Te devolvimos ${mxPl(devueltos, \"crédito\", \"créditos\")}.`" in f
    assert ': "Campaña apagada.", {tipo:\'ok\'});' in f
    assert ('window.avisos?.mostrar("Campaña reanudada. La próxima sale a su hora.", '
            "{tipo:'ok'});") in MIX
    assert ('window.avisos?.mostrar("Listo: abajo está la publicación del primer día.",\n'
            "      {tipo:'ok', clave:'mix-ejemplo'});") in MIX


def test_los_avisos_del_ejemplo_son_info_de_ocho_segundos():
    assert ('window.avisos?.mostrar("Estamos preparando tu ejemplo. Aparece aquí solo.",\n'
            "    {tipo:'info', segundos: 8, clave:'mix-ejemplo'});") in MIX
    f = _cuerpo("    if (fallo) {\n      window.avisos?.quitar('mix-ejemplo');", 400)
    assert "mxFallo(fallo);" in f
    assert "Descartamos ese ejemplo porque la campaña " in f
    assert "{tipo:'info', segundos: 8, clave:'mix-ejemplo'});" in f


def test_confirm_de_apagar_sigue():
    assert "if (!confirm(mxTextoApagar(dev))) return;" in MIX


def test_siempre_con_encadenamiento_opcional():
    assert not re.search(r"window\.avisos\.(mostrar|quitar)", MIX)
    assert MIX.count("window.avisos?.mostrar(") == 7
    assert MIX.count("window.avisos?.quitar(") == 3


def test_en_node_los_avisos_llegan_con_su_clave(tmp_path):
    nodo = shutil.which("node")
    if not nodo:
        pytest.skip("node no está en el PATH")
    i = MIX.index("// ── avisos ─")
    js = MIX[i:MIX.index("// ── 1. la foto", i)]
    codigo = r"""
const nodos = {};
const $ = s => (nodos[s] = nodos[s] || {hidden: true, textContent: ""});
const vivos = {};
const location = {href: ""};
const window = {avisos: {mostrar(t, op) { vivos[op.clave] = {t, ...op}; },
                         quitar(c) { delete vivos[c]; }}};
const MXCONECTAR_A = "/?blotato=conectar";
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
    assert o["a409"] == "Conectar Blotato" and o["destino"] == "/?blotato=conectar"
    assert o["red"] == ["SINRED", "mal", "Reintentar"]
    assert o["limpio"] is True
    assert o["falta"] == ["Falta la foto de tu producto.", False, 0]
    assert o["sinFalta"] is True
