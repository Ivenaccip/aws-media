"""Imágenes en segundo plano en la página vieja (static/imagenes.html): el sondeo y su aviso.

La pantalla React (web/src/pantallas/imagenes/) lo prueba en vitest; esta página no
tiene bundler, así que el bloque `esperarImagen` se saca del HTML y corre en node
con un fetch de mentira y un reloj que avanza solo al esperar (se salta si no hay
node). Lo que se fija:

  · el pedido ya está cobrado y en marcha: SOLO un 404 (el pedido no existe) corta
    la espera. Un 429, un 408, un 401/403 intermitente, un 5xx o la red caída se
    toleran hasta el tope de 5 min;
  · pasado el tope no es un error: el aviso de «sigue en camino» no sale por #gerr
    (role=alert, clase err) sino por un elemento de estado (role=status), y se
    limpia donde se limpia #gerr.
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
HTML = (RAIZ / "static" / "imagenes.html").read_text(encoding="utf-8")


def _bloque_sondeo() -> str:
    ini = HTML.index("// ---------- imágenes en segundo plano ----------")
    fin = HTML.index("// ---------- enviar ----------")
    return HTML[ini:fin]


def _err_txt() -> str:
    return re.search(r"^async function errTxt\(r\).*$", HTML, re.M).group(0)


def _node(escenario: str, tmp_path: Path) -> dict:
    nodo = shutil.which("node")
    if not nodo:
        pytest.skip("node no está en el PATH")
    codigo = (
        "let reloj = 0, refrescos = 0;\n"
        "globalThis.window = { monedero: { refrescar() { refrescos++; } } };\n"
        # esperar es avanzar el reloj: 150 preguntas de 2 s son los 5 min
        "globalThis.setTimeout = (f, ms) => { reloj += ms; f(); return 0; };\n"
        "Date.now = () => reloj;\n"
        "const respuesta = (estado, cuerpo) => ({ ok: estado < 400, status: estado,\n"
        "  json: async () => cuerpo, text: async () => JSON.stringify(cuerpo) });\n"
        "const FICHA = (estado, extra = {}) => ({ id: 'img-x', estado, nombre: '', url: '', error: '', ...extra });\n"
        "const LISTA = FICHA('listo', { nombre: 'aaaaaaaaaaaa.jpg', url: '/api/imagenes/aaaaaaaaaaaa.jpg' });\n"
        "let preguntas = 0;\n"
        # el guion: cada pregunta saca el siguiente paso; sin guion, el pedido sigue generándose
        "function guion(pasos) {\n"
        "  preguntas = 0;\n"
        "  globalThis.fetch = async () => {\n"
        "    preguntas++;\n"
        "    const p = pasos.length ? pasos.shift() : { estado: 200, cuerpo: FICHA('generando') };\n"
        "    if (p === 'red') throw new TypeError('Failed to fetch');\n"
        "    return respuesta(p.estado, p.cuerpo);\n"
        "  };\n"
        "}\n"
        + _err_txt() + "\n" + _bloque_sondeo() +
        "\n(async () => {\nconst out = {};\n" + escenario +
        "\nconsole.log(JSON.stringify(out));\n})()"
        ".catch(e => { console.error(e); process.exit(1); });\n"
    )
    f = tmp_path / "vieja.js"
    f.write_text(codigo, encoding="utf-8")
    r = subprocess.run([nodo, str(f)], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_solo_un_404_corta_el_sondeo_de_un_pedido_ya_cobrado(tmp_path):
    o = _node(r"""
// ya se cobró y sigue en marcha: nada de esto es del pedido, es del camino
guion([429, 408, 401, 403, 400, 409, 422, 503, 504].map(e => ({ estado: e, cuerpo: { detail: 'x' } }))
  .concat(['red', { estado: 200, cuerpo: LISTA }]));
try { out.hecha = await esperarImagen('img-x'); } catch (e) { out.corto = String(e.message); }
out.preguntas = preguntas;

// el 404 sí corta: el pedido no existe, no hay nada que esperar
guion([{ estado: 404, cuerpo: { detail: 'Pedido no encontrado' } }]);
try { await esperarImagen('img-x'); out.sin404 = true; } catch (e) { out.mensaje404 = e.message; }
out.preguntas404 = preguntas;
""", tmp_path)
    assert "corto" not in o, f"un 4xx que no es 404 cortó la espera de un pedido ya cobrado: {o}"
    assert o["hecha"] == {"nombre": "aaaaaaaaaaaa.jpg", "url": "/api/imagenes/aaaaaaaaaaaa.jpg"}
    assert o["preguntas"] == 11
    assert o["mensaje404"] == "Pedido no encontrado" and o["preguntas404"] == 1
    assert "sin404" not in o


def test_pasado_el_tope_no_devuelve_un_error_sino_un_aviso_de_que_sigue_en_camino(tmp_path):
    o = _node(r"""
guion([]);   // siempre generándose
try { await esperarImagen('img-x'); out.hecha = true; }
catch (e) { out.enCamino = e.enCamino === true; out.mensaje = e.message; }
out.preguntas = preguntas;
out.reloj = reloj;

// un 429 todo el rato tampoco es un error: al tope, lo mismo
guion(Array.from({ length: 400 }, () => ({ estado: 429, cuerpo: { message: 'Too Many Requests' } })));
try { await esperarImagen('img-x'); } catch (e) { out.enCamino429 = e.enCamino === true; }
""", tmp_path)
    assert "hecha" not in o
    assert o["enCamino"] is True and o["enCamino429"] is True
    assert "sigue en camino" in o["mensaje"] and "no hace falta pedirla otra vez" in o["mensaje"]
    assert o["preguntas"] == 150 and o["reloj"] == 5 * 60 * 1000


def test_un_error_de_verdad_del_pedido_no_lleva_la_marca_de_en_camino(tmp_path):
    o = _node(r"""
guion([{ estado: 200, cuerpo: FICHA('error', { error: 'La imagen no se pudo generar.' }) }]);
try { await esperarImagen('img-x'); } catch (e) { out.enCamino = e.enCamino === true; out.mensaje = e.message; }
out.refrescos = refrescos;   // uno al lanzar y otro al fallar: el worker ya devolvió los créditos
""", tmp_path)
    assert o["enCamino"] is False and o["mensaje"] == "La imagen no se pudo generar."
    assert o["refrescos"] == 2


def _elemento(id_: str) -> str:
    m = re.search(rf'<[a-z]+ [^>]*id="{id_}"[^>]*>', HTML)
    assert m, f"falta #{id_}"
    return m.group(0)


def test_el_aviso_de_en_camino_es_un_estado_informativo_y_no_el_error_del_formulario():
    aviso = _elemento("gaviso")
    assert 'role="status"' in aviso and 'role="alert"' not in aviso
    assert not re.search(r'class="[^"]*\berr\b', aviso), "un aviso informativo no lleva el rojo del error"
    # y #gerr sigue siendo el error: role=alert
    assert 'role="alert"' in _elemento("gerr")
    # el click de «Generar» manda el tope a #gaviso y lo demás a #gerr
    cuerpo = HTML[HTML.index("$('#enviar').onclick"):]
    atrapa = cuerpo[cuerpo.index("} catch (e) {"):]
    assert atrapa.index("e.enCamino") < atrapa.index("$('#gaviso').textContent = e.message")
    assert atrapa.index("$('#gaviso').textContent = e.message") < atrapa.index("$('#gerr').textContent = e.message")
    assert "mando.desmontar()" in atrapa[:atrapa.index("$('#gaviso')")]


def test_el_aviso_se_limpia_donde_se_limpia_el_error_del_formulario():
    limpia_error = len(re.findall(r"\$\('#gerr'\)\.textContent = '';", HTML))
    limpia_aviso = len(re.findall(r"\$\('#gaviso'\)\.textContent = '';", HTML))
    assert limpia_error >= 4
    assert limpia_aviso == limpia_error, "un aviso viejo no puede quedarse junto a una acción nueva"
