"""UI·16 — el panel de admin manda sus avisos sueltos al cuadro de
trabajos.js (window.avisos).

Se mueve: el fallo de red al abrir el detalle de un usuario (antes no tenía
try/catch y el detalle se quedaba en «Cargando…»). Se quedan: #cargando (el
estado de la pantalla entera), #estado-sync junto a su botón y el «Error N»
del servidor dentro de la tarjeta de detalle.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
ADMIN = (RAIZ / "static" / "admin.html").read_text(encoding="utf-8")
JS = ADMIN[ADMIN.rindex("<script>\n"):ADMIN.rindex("</script>")]


def _funcion(firma):
    i = JS.index(firma)
    return JS[i:JS.index("\n}\n", i) + 2]


def test_detalle_envuelve_el_fetch_y_avisa_en_el_cuadro():
    d = _funcion("async function detalle(uid, nombre)")
    assert "try {\n    r = await fetch('/api/admin/usuarios/' + encodeURIComponent(uid));" in d
    assert ("window.avisos?.mostrar('No se pudo abrir el detalle — revisa tu conexión.',\n"
            "                           {tipo: 'mal', clave: 'admin-detalle', "
            "accion: {texto: 'Reintentar', al: () => detalle(uid, nombre)}});") in d
    assert "window.avisos?.quitar('admin-detalle');" in d
    # el error del servidor sigue dentro de su tarjeta
    assert "$('#detalle-cuerpo').innerHTML = `<p class=\"mut\">Error ${r.status}.</p>`;" in d


def test_lo_que_se_queda_en_su_sitio():
    c = _funcion("async function cargar()")
    assert "$('#cargando').textContent = 'No se pudo cargar — revisa tu conexión y recarga.';" in c
    assert "$('#estado-sync').textContent = 'Error: ' + e.message;" in JS
    assert 'id="cargando"' in ADMIN and 'id="estado-sync"' in ADMIN


PRELUDIO = r"""
const AVISOS = [];
const window = {avisos: {
  mostrar: (t, o) => AVISOS.push(['mostrar', t, o.tipo, o.clave, o.accion ? o.accion.texto : null]),
  quitar: c => AVISOS.push(['quitar', c]),
}};
const els = {};
const $ = s => (els[s] ??= {hidden: true, innerHTML: '', textContent: '', scrollIntoView() {}});
const esc = s => String(s ?? ''), usd4 = x => '$' + x, tiempo = s => s + ' s', icono = () => '';
let LFBASE = '', RED = true;
const fetch = async () => {
  if (RED) throw new TypeError('Failed to fetch');
  return {ok: true, json: async () => ({proyectos: [], sin_proyecto: []})};
};
"""


def test_sin_red_cierra_el_detalle_y_reintentar_lo_abre(tmp_path):
    nodo = shutil.which("node")
    if not nodo:
        pytest.skip("node no está en el PATH")
    f = tmp_path / "admin.js"
    f.write_text(PRELUDIO + _funcion("async function detalle(uid, nombre)") + r"""
(async () => {
  const out = {};
  await detalle('u1', 'ana@x.com');
  out.oculto = $('#detalle').hidden;
  RED = false;
  await detalle('u1', 'ana@x.com');
  out.visible = !$('#detalle').hidden;
  out.cuerpo = $('#detalle-cuerpo').innerHTML;
  out.avisos = AVISOS;
  console.log(JSON.stringify(out));
})().catch(e => { console.error(e); process.exit(1); });
""", encoding="utf-8")
    r = subprocess.run([nodo, str(f)], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    o = json.loads(r.stdout)
    assert o["oculto"] is True and o["visible"] is True
    assert "Cargando" not in o["cuerpo"] and "Sin proyectos." in o["cuerpo"]
    assert o["avisos"] == [["mostrar", "No se pudo abrir el detalle — revisa tu conexión.", "mal",
                            "admin-detalle", "Reintentar"],
                           ["quitar", "admin-detalle"]]
