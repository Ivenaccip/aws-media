"""UI·16 — el inicio manda sus avisos sueltos al cuadro de trabajos.js
(window.avisos).

Se mueven: el resultado de archivar/restaurar (antes en #err, que ya no
existe) y el fallo al traer la lista de proyectos (antes se callaba). Se
quedan: #perr junto a la caja de la idea, #blt-err del diálogo de Blotato y
el confirm() de archivar.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
INICIO = (RAIZ / "static" / "index.html").read_text(encoding="utf-8")
JS = INICIO[INICIO.rindex("<script>\n"):INICIO.rindex("</script>")]


def _funcion(firma):
    i = JS.index(firma)
    return JS[i:JS.index("\n}\n", i) + 2]


def test_el_err_suelto_ya_no_existe():
    assert 'id="err"' not in INICIO
    assert "$('#err')" not in INICIO


def test_lo_que_se_queda_en_su_sitio():
    assert 'id="perr"' in INICIO and 'id="blt-err"' in INICIO
    assert "$('#perr').textContent = 'Cuéntanos qué quieres primero" in JS
    assert "$('#blt-err').textContent = 'Pega tu clave de Blotato primero.';" in JS
    assert "if (!confirm('¿Archivar este proyecto?" in JS
    assert "if (!confirm('¿Desconectar tu cuenta de Blotato?" in JS


def test_accion_va_al_cuadro_con_su_clave():
    a = _funcion("async function accion(id, verbo)")
    assert ("window.avisos?.mostrar(typeof d === 'string' ? d : (d?.aviso || 'No se pudo — intenta de nuevo.'),\n"
            "                             {tipo: 'mal', clave: 'inicio-accion'});") in a
    assert "window.avisos?.mostrar('Sin conexión — intenta de nuevo.', {tipo: 'mal', clave: 'inicio-accion'});" in a
    assert a.index("window.avisos?.quitar('inicio-accion');") < a.index("cargar();")


def test_cargar_avisa_con_reintentar_y_quita_al_cargar_bien():
    av = _funcion("function avisarCarga()")
    assert ("window.avisos?.mostrar('No pudimos traer tus proyectos. Revisa tu conexión e inténtalo de nuevo.',\n"
            "                         {tipo: 'mal', clave: 'inicio-carga', accion: {texto: 'Reintentar', al: cargar}});") in av
    c = _funcion("async function cargar()")
    assert "if (!rp.ok) { avisarCarga(); return; }" in c
    assert "} catch { avisarCarga();" in c
    assert c.index("window.avisos?.quitar('inicio-carga');") < c.index("render(ps);")


PRELUDIO = r"""
const AVISOS = [];
const window = {avisos: {
  mostrar: (t, o) => AVISOS.push(['mostrar', t, o.tipo, o.clave, o.accion ? o.accion.texto : null]),
  quitar: c => AVISOS.push(['quitar', c]),
}};
let MODO = 'bien', CARGAS = 0;
const $ = () => ({hidden: false, textContent: ''});
let slots = null, imagenes = [];
const render = () => {}, renderImagenes = () => {}, renderEdiciones = () => {};
const fetch = async url => {
  if (url.includes('/archivar')) {
    if (MODO === 'red') throw new TypeError('Failed to fetch');
    if (MODO === 'lleno') return {ok: false, json: async () => ({detail: {aviso: 'Ya no tienes slots.'}})};
    return {ok: true, json: async () => ({})};
  }
  if (MODO === 'red') throw new TypeError('Failed to fetch');
  if (url === '/api/proyectos') CARGAS++;
  if (MODO === '500' && url === '/api/proyectos') return {ok: false, json: async () => ({})};
  return {ok: true, json: async () => (url === '/api/slots' ? {slots: 3} : [])};
};
"""


def _node(escenario, tmp_path):
    nodo = shutil.which("node")
    if not nodo:
        pytest.skip("node no está en el PATH")
    codigo = (PRELUDIO + _funcion("function avisarCarga()") + _funcion("async function cargar()")
              + _funcion("async function accion(id, verbo)")
              + "\n(async () => {\nconst out = {};\n" + escenario
              + "\nout.avisos = AVISOS;\nconsole.log(JSON.stringify(out));\n})()"
              ".catch(e => { console.error(e); process.exit(1); });\n")
    f = tmp_path / "inicio.js"
    f.write_text(codigo, encoding="utf-8")
    r = subprocess.run([nodo, str(f)], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_la_carga_que_falla_avisa_una_vez_por_clave_y_reintentar_la_quita(tmp_path):
    o = _node(r"""
MODO = 'red'; await cargar();
MODO = '500'; await cargar();
MODO = 'bien'; await cargar();
""", tmp_path)
    texto = "No pudimos traer tus proyectos. Revisa tu conexión e inténtalo de nuevo."
    assert o["avisos"] == [["mostrar", texto, "mal", "inicio-carga", "Reintentar"],
                           ["mostrar", texto, "mal", "inicio-carga", "Reintentar"],
                           ["quitar", "inicio-carga"]]


def test_archivar_avisa_el_motivo_y_en_exito_lo_quita(tmp_path):
    o = _node(r"""
MODO = 'lleno'; await accion('p1', 'archivar');
MODO = 'red'; await accion('p1', 'archivar');
MODO = 'bien'; await accion('p1', 'archivar');
await new Promise(r => setTimeout(r, 0));
""", tmp_path)
    assert o["avisos"][0] == ["mostrar", "Ya no tienes slots.", "mal", "inicio-accion", None]
    assert o["avisos"][1] == ["mostrar", "Sin conexión — intenta de nuevo.", "mal", "inicio-accion", None]
    assert o["avisos"][2] == ["quitar", "inicio-accion"]
