"""UI·16 — competencia manda sus avisos sueltos al cuadro de trabajos.js
(window.avisos).

Se mueven: el «sin conexión» del poll, el fallo al traer cuentas e informes,
el fallo al abrir un informe (antes callaba) y el fallo al quitar una cuenta
(antes se escribía en la nota del campo de agregar). Se quedan: la validación
y el error de «Agregar» en #est-cuenta, y el 402 junto a «Revisar».
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
PANTALLA = (RAIZ / "static" / "competencia.html").read_text(encoding="utf-8")
CP = PANTALLA[PANTALLA.index("// ── cp · Competencia (C5)"):PANTALLA.rindex("</script>")]


def _funcion(nombre):
    i = CP.index(f"async function {nombre}(")
    return CP[i:CP.index("\n}\n", i)]


def test_el_banner_local_de_sin_red_ya_no_existe():
    assert 'id="red"' not in PANTALLA
    assert "#red" not in PANTALLA
    assert '$("red")' not in PANTALLA
    assert "sinred" not in PANTALLA


def test_sin_red_va_al_cuadro_con_la_clave_red():
    c = _funcion("cpCargar")
    assert ('window.avisos?.mostrar("Sin conexión — reintentando… Tu revisión sigue en la nube.",\n'
            '                             { tipo: "info", clave: "red" });') in c
    assert "cpProgramarPoll();" in c
    assert 'window.avisos?.quitar("red");' in c


def test_el_fallo_de_carga_va_al_cuadro_con_reintentar():
    c = _funcion("cpCargar")
    assert re.search(r'window\.avisos\?\.mostrar\("No pudimos traer tus cuentas y revisiones\.[^"]*",\s*'
                     r'\{ tipo: "mal", clave: "competencia-carga", accion: \{ texto: "Reintentar", al: cpCargar \} \}\);', c)
    assert 'window.avisos?.quitar("competencia-carga");' in c
    assert '$("informes").innerHTML = `<span class="err">' not in PANTALLA


def test_abrir_un_informe_ya_no_calla():
    c = _funcion("cpAbrir")
    assert ('window.avisos?.mostrar("No pudimos abrir ese informe. Inténtalo de nuevo.",\n'
            '        { tipo: "mal", clave: "competencia-abrir"') in c
    # ya no se guarda un informe vacío que haría pasar el fallo por «sin datos»
    assert "CPDETALLE[id] = { publicaciones: [], lectura: {}, fallidas: [] }" not in c


def test_quitar_una_cuenta_avisa_en_el_cuadro_y_no_en_el_campo():
    c = _funcion("cpQuitar")
    assert 'window.avisos?.mostrar("No pudimos quitar esa cuenta. Inténtalo de nuevo.",' in c
    assert '{ tipo: "mal", clave: "competencia-quitar"' in c
    catch = c[c.index("} catch (e) {"):]
    assert "est-cuenta" not in catch


def test_la_validacion_y_el_402_siguen_en_su_sitio():
    assert 'if (!url) { $("est-cuenta").textContent = "Pega la liga del perfil primero."; return; }' in CP
    assert "} catch (e) { $(\"est-cuenta\").innerHTML = `<span class=\"err\">${cpEsc(e.message)}</span>`; }" in CP
    assert '$("estado").appendChild(cpBotonRecargar());' in CP


def test_todas_las_llamadas_usan_encadenamiento_opcional():
    assert not re.search(r"window\.avisos\.(mostrar|quitar)", PANTALLA)


# ---------------------------------------------------------------------------
# en node: qué ve el usuario cuando falla

PRELUDIO = r"""
"use strict";
class Nodo {
  constructor(id) { Object.assign(this, {id, hidden: false, disabled: false, dataset: {},
    onclick: null, _html: "", _texto: ""}); }
  get innerHTML() { return this._html; }  set innerHTML(h) { this._html = String(h); }
  get textContent() { return this._texto; }  set textContent(t) { this._texto = String(t); }
  querySelectorAll() { return []; }  appendChild() {}
}
const els = new Proxy({}, { get: (t, k) => typeof k === "string" ? (t[k] || (t[k] = new Nodo(k))) : t[k] });
const document = { hidden: false, title: "", getElementById: id => els[id],
                   createElement: () => new Nodo("nuevo"), addEventListener: () => {} };
const AVISOS = [];
const window = { avisos: {
  mostrar: (texto, op) => { AVISOS.push(["mostrar", texto, op.tipo, op.clave, op.accion && op.accion.texto]); return 1; },
  quitar: c => { AVISOS.push(["quitar", c]); },
} };
let FALLA = {};
let RESPUESTA = {cuentas: [{id: "ig-uno", red: "instagram", cuenta: "uno"}], informes: [],
                 credito_por_cuenta: 3, max_cuentas: 5};
const fetch = async (url, op) => {
  if (FALLA[url]) throw new TypeError("Failed to fetch");
  return {ok: true, json: async () => RESPUESTA};
};
"""


def _node(escenario, tmp_path):
    nodo = shutil.which("node")
    if not nodo:
        pytest.skip("node no está en el PATH")
    f = tmp_path / "cp.js"
    f.write_text(PRELUDIO + CP + "\n(async () => {\nconst out = {};\n" + escenario
                 + "\nout.avisos = AVISOS;\nconsole.log(JSON.stringify(out));\n})()"
                 ".catch(e => { console.error(e); process.exit(1); });\n", encoding="utf-8")
    r = subprocess.run([nodo, str(f)], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_fallo_de_carga_no_pinta_el_error_y_reintentar_lo_arregla(tmp_path):
    o = _node(r"""
await new Promise(r => setTimeout(r, 0));   // la carga inicial
AVISOS.length = 0;
FALLA["/api/competencia"] = true;
cpFirma = null;
await cpCargar();
out.informes = els.informes.innerHTML;
out.cuentas = els.cuentas.innerHTML;
FALLA = {};
await cpCargar();
""", tmp_path)
    assert o["avisos"][0] == ["mostrar", "No pudimos traer tus cuentas y revisiones. Revisa tu conexión "
                              "e inténtalo de nuevo.", "mal", "competencia-carga", "Reintentar"]
    # ya había cargado una vez: lo de antes se queda, sin el error adentro
    assert "Failed to fetch" not in o["informes"] and "err" not in o["informes"]
    assert "@uno" in o["cuentas"]
    assert ["quitar", "competencia-carga"] in o["avisos"][1:]


def test_abrir_que_falla_avisa_y_no_deja_un_informe_vacio(tmp_path):
    o = _node(r"""
FALLA["/api/competencia/informes/r1"] = true;
await cpAbrir("r1");
out.abierto = cpAbierto;
out.cache = "r1" in CPDETALLE;
""", tmp_path)
    assert o["abierto"] is None and o["cache"] is False
    assert ["mostrar", "No pudimos abrir ese informe. Inténtalo de nuevo.", "mal",
            "competencia-abrir", "Reintentar"] in o["avisos"]


def test_quitar_que_luego_sale_bien_quita_el_aviso(tmp_path):
    o = _node(r"""
await new Promise(r => setTimeout(r, 0));   // la carga inicial
AVISOS.length = 0;
FALLA["/api/competencia/cuentas/ig-uno"] = true;
await cpQuitar("ig-uno");
FALLA = {};
await cpQuitar("ig-uno");
""", tmp_path)
    assert o["avisos"][0][:4] == ["mostrar", "No pudimos quitar esa cuenta. Inténtalo de nuevo.",
                                  "mal", "competencia-quitar"]
    assert ["quitar", "competencia-quitar"] in o["avisos"][1:]


def test_reintentar_abrir_no_cierra_un_informe_ya_abierto():
    c = _funcion("cpAbrir")
    assert 'al: () => { if (cpAbierto !== id) cpAbrir(id); }' in c
