"""UI·16 — shorts manda sus avisos sueltos al cuadro de trabajos.js
(window.avisos).

Se mueven: el fallo al cargar el proyecto (antes pintado en #aviso con clase
err) y el fallo al traer la lista de proyectos en elegirProyecto(), que antes
se disfrazaba de «Todavía no tienes videos con metraje…». #aviso sigue con sus
usos legítimos: el selector de proyectos, «Cargando…», la descarga de YouTube
en curso y la importación fallida con sus créditos devueltos.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
SHORTS = (RAIZ / "static" / "shorts.html").read_text(encoding="utf-8")
JS = SHORTS[SHORTS.rindex("<script>\n"):SHORTS.rindex("</script>")]
RED = "No pudimos traer tus proyectos. Revisa tu conexión e inténtalo de nuevo."


def _funcion(firma):
    i = JS.index(firma)
    return JS[i:JS.index("\n}\n", i) + 2]


def test_cargar_ya_no_pinta_el_error_en_el_aviso():
    c = _funcion("async function cargar()")
    assert '$("aviso").className = "err"' not in SHORTS
    assert '$("aviso").textContent = e.message' not in SHORTS
    assert ('{ tipo: "mal", clave: "shorts-carga", accion: { texto: "Reintentar", al: cargar } });') in c
    assert '"No pudimos cargar tu proyecto. Revisa tu conexión e inténtalo de nuevo."' in c
    assert c.index('window.avisos?.quitar("shorts-carga");') < c.index("pintar();")
    # la liga sigue revelándose con proyecto abierto (M22)
    assert '$("sec-importar").hidden = false;' in c


def test_los_otros_usos_de_aviso_siguen():
    assert '<div id="aviso" class="mut">Cargando…</div>' in SHORTS
    assert "Trayendo «${esc(imp.titulo" in SHORTS
    assert "La importación falló${imp.error ? ` (${esc(imp.error)})` : \"\"} — tus créditos se devolvieron." in SHORTS


def test_los_errores_junto_a_su_boton_se_quedan():
    assert '$("imp-estado").innerHTML = `<span class="err">${esc(e.message)}</span> `;' in SHORTS
    assert '$("imp-estado").appendChild(botonRecargar());' in SHORTS
    assert '$("analisis-info").className = "err";' in SHORTS


PRELUDIO = r"""
const AVISOS = [];
const window = {avisos: {
  mostrar: (t, o) => AVISOS.push(['mostrar', t, o.tipo, o.clave, o.accion ? o.accion.texto : null]),
  quitar: c => AVISOS.push(['quitar', c]),
}};
const els = {};
const $ = id => (els[id] ??= {hidden: false, innerHTML: '', textContent: '', className: ''});
const esc = s => String(s ?? ''), icono = () => '';
let P = null, EST = null, MODO = 'red';
const pintar = () => { out.pintado = true; };
const fetch = async url => {
  if (url === '/api/media/config') return {ok: true, json: async () => ({activo: false})};
  if (MODO === 'red') throw new TypeError('Failed to fetch');
  if (MODO === '500') return {ok: false, status: 500, json: async () => ({})};
  if (MODO === '404') return {ok: false, status: 404, json: async () => ({detail: 'Ese proyecto no existe.'})};
  if (MODO === 'vacio') return {ok: true, json: async () => []};
  if (url.startsWith('/api/shorts/')) return {ok: true, json: async () => ({shorts: {}})};
  return {ok: true, json: async () => [{nombre: 'mi-video', subidas: ['a.mp4']}]};
};
let out = {};
"""


def _node(escenario, tmp_path):
    nodo = shutil.which("node")
    if not nodo:
        pytest.skip("node no está en el PATH")
    codigo = (PRELUDIO + _funcion("async function fj(url, body)")
              + _funcion("async function elegirProyecto()") + _funcion("async function cargar()")
              + "\n(async () => {\n" + escenario
              + "\nout.avisos = AVISOS;\nconsole.log(JSON.stringify(out));\n})()"
              ".catch(e => { console.error(e); process.exit(1); });\n")
    f = tmp_path / "shorts.js"
    f.write_text(codigo, encoding="utf-8")
    r = subprocess.run([nodo, str(f)], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_sin_red_no_dice_que_no_tienes_videos(tmp_path):
    o = _node(r"""
MODO = 'red'; await elegirProyecto(); out.red = $('aviso').innerHTML + $('aviso').textContent;
MODO = '500'; await elegirProyecto(); out.s500 = $('aviso').innerHTML + $('aviso').textContent;
MODO = 'vacio'; await elegirProyecto(); out.vacio = $('aviso').innerHTML;
MODO = 'bien'; await elegirProyecto(); out.lista = $('aviso').innerHTML;
""", tmp_path)
    assert "Todavía no tienes" not in o["red"] and "Todavía no tienes" not in o["s500"]
    assert "Cargando" not in o["red"]
    assert o["vacio"].startswith("Todavía no tienes videos con metraje")
    assert "mi-video" in o["lista"]
    assert o["avisos"] == [["mostrar", RED, "mal", "shorts-carga", "Reintentar"],
                           ["mostrar", RED, "mal", "shorts-carga", "Reintentar"],
                           ["quitar", "shorts-carga"], ["quitar", "shorts-carga"]]


def test_cargar_un_proyecto_que_falla_avisa_y_reintentar_lo_abre(tmp_path):
    o = _node(r"""
P = 'mi-video';
MODO = 'red'; await cargar(); out.oculto = $('aviso').hidden; out.clase = $('aviso').className;
MODO = '404'; await cargar();
MODO = 'bien'; await cargar();
""", tmp_path)
    assert o["oculto"] is True and o["clase"] != "err"
    assert o["avisos"] == [
        ["mostrar", "No pudimos cargar tu proyecto. Revisa tu conexión e inténtalo de nuevo.", "mal",
         "shorts-carga", "Reintentar"],
        ["mostrar", "Ese proyecto no existe.", "mal", "shorts-carga", "Reintentar"],
        ["quitar", "shorts-carga"]]
    assert o["pintado"] is True
