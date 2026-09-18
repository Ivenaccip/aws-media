"""M23 C5 · Competencia — la pantalla static/competencia.html.

Lo que este archivo defiende:
  * que nada de lo que llega del actor de Apify entre a un innerHTML sin
    escapar — y aquí el texto lo escribe un tercero cualquiera (el pie de foto
    de la publicación de otro) y además va DENTRO de atributos;
  * que una liga que no sea http(s) no se pinte: el href lo trae el actor y un
    `javascript:` ahí es código que corre al hacer clic;
  * que un contador que la red no informó se vea como hueco y NUNCA como cero;
  * que el índice se lea como lo que es («3× lo normal»), no como vistas;
  * que el botón enseñe el precio antes de cobrar;
  * que no haya sondeo cuando no hay ninguna revisión en marcha.

Sin red: el HTML se lee como texto y la lógica corre en node con un DOM mínimo
(se salta si no hay node)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
PANTALLA = (RAIZ / "static" / "competencia.html").read_text(encoding="utf-8")
HUB = (RAIZ / "static" / "index.html").read_text(encoding="utf-8")

INICIO = "// ── cp · Competencia (C5)"


def _tramo(desde: str, hasta: str, texto: str) -> str:
    i = texto.index(desde)
    return texto[i:texto.index(hasta, i)]


CP = _tramo(INICIO, "</script>", PANTALLA)


# ---------------------------------------------------------------------------
# la página, como texto

def test_la_pantalla_arranca_despues_de_auth():
    """Sin /auth.js cargado, el primer fetch saldría sin Authorization y el
    servidor devolvería 401 antes de pintar nada."""
    assert PANTALLA.index('src="/auth.js"') < PANTALLA.index(INICIO)
    assert PANTALLA.index('src="/monedero.js"') < PANTALLA.index(INICIO)


def test_el_menu_del_estudio_enlaza_la_pantalla():
    linea = next(l for l in HUB.splitlines() if "Investiga tu competencia" in l)
    assert 'href="/competencia.html"' in linea
    assert 'class="prox"' not in linea


def test_no_hay_sondeo_ciego():
    """El poll solo se programa si hay una revisión viva, y se apaga con la
    pestaña oculta: una pantalla abierta no puede llamar sola para siempre."""
    assert "document.hidden ? null : setTimeout" in CP
    assert 'r.estado === "analizando"' in CP
    assert 'addEventListener("visibilitychange"' in CP


def test_el_boton_dice_el_precio_antes_de_cobrar():
    assert "Revisar ✦ ${CPTARIFA * n}" in CP
    assert "créditos por cuenta" in CP


# ---------------------------------------------------------------------------
# la lógica, en node

PRELUDIO = r"""
"use strict";
// DOM mínimo: los nodos se crean al pedirlos.
class Nodo {
  constructor(id) {
    Object.assign(this, {id, hidden: false, disabled: false, dataset: {},
      onclick: null, className: "", _html: "", _texto: ""});
  }
  get innerHTML() { return this._html; }
  set innerHTML(h) { this._html = String(h); }
  get textContent() { return this._texto; }
  set textContent(t) { this._texto = String(t); }
  querySelectorAll() { return []; }
  appendChild() {}
}
const els = new Proxy({}, {
  get: (t, k) => typeof k === "string" ? (t[k] || (t[k] = new Nodo(k))) : t[k],
});
let RESPUESTA = {cuentas: [], informes: [], credito_por_cuenta: 3, max_cuentas: 5};
let LLAMADAS = [];
const document = {
  hidden: false, title: "",
  getElementById: id => els[id],
  createElement: () => new Nodo("nuevo"),
  addEventListener: () => {},
};
const window = {};
const fetch = async (url, op) => {
  LLAMADAS.push([url, (op && op.method) || "GET"]);
  return {ok: true, json: async () => RESPUESTA};
};
"""


def _node(escenario: str, tmp_path: Path) -> dict:
    nodo = shutil.which("node")
    if not nodo:
        pytest.skip("node no está en el PATH")
    codigo = (PRELUDIO + CP +
              "\n(async () => {\nconst out = {};\n" + escenario +
              "\nconsole.log(JSON.stringify(out));\n})()"
              ".catch(e => { console.error(e); process.exit(1); });\n")
    f = tmp_path / "cp.js"
    f.write_text(codigo, encoding="utf-8")
    r = subprocess.run([nodo, str(f)], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_esc_escapa_los_cinco(tmp_path):
    """Con solo & y <, una comilla en el pie de foto cerraría el atributo."""
    o = _node(r"""
out.todo = cpEsc(`<img src="x" onerror='alert(1)'>&`);
out.nulo = cpEsc(null); out.cero = cpEsc(0);
""", tmp_path)
    assert o["todo"] == "&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;"
    assert o["nulo"] == "" and o["cero"] == "0"


def test_una_liga_que_no_es_http_no_se_pinta(tmp_path):
    o = _node(r"""
out.js = cpHref("javascript:alert(1)");
out.datos = cpHref("data:text/html,<script>");
out.buena = cpHref("https://www.tiktok.com/@natgeo/video/7683891628230315295");
out.tarjeta = cpPublicacion({red: "tiktok", cuenta: "natgeo", cuando: "2026-09-10T13:00:00Z",
  enlace: "javascript:alert(1)", texto: "hola", vistas: 10, me_gusta: 1,
  comentarios: 0, compartidos: null, indice: 1});
""", tmp_path)
    assert o["js"] == "" and o["datos"] == ""
    assert o["buena"].startswith("https://")
    assert "javascript:" not in o["tarjeta"], "una liga ejecutable llegó al HTML"
    assert "<a class=\"ver\"" not in o["tarjeta"]


def test_un_contador_que_no_llego_es_un_hueco_y_no_un_cero(tmp_path):
    """Instagram no informa compartidos. Un 0 ahí le diría al usuario que nadie
    compartió la publicación, que es una afirmación que no tenemos."""
    o = _node(r"""
out.nulo = cpNum(null); out.indef = cpNum(undefined);
out.cero = cpNum(0); out.mil = cpNum(2962604);
out.tarjeta = cpPublicacion({red: "instagram", cuenta: "natgeo",
  cuando: "2026-09-10T13:00:00Z", enlace: "https://instagram.com/p/x/", texto: "",
  vistas: 2962604, me_gusta: 70864, comentarios: 512, compartidos: null, indice: null});
""", tmp_path)
    assert o["nulo"] == "—" and o["indef"] == "—"
    assert o["cero"] == "0", "un cero de verdad sigue siendo cero"
    assert o["mil"] == "2,962,604"
    assert "Compartidos <b>—</b>" in o["tarjeta"]
    assert "Vistas <b>2,962,604</b>" in o["tarjeta"]


def test_la_duracion_se_lee_en_su_escala(tmp_path):
    """En la misma lista conviven un reel de 10 s y un episodio de dos horas:
    «131:46 min» era verdad y no se entendía."""
    o = _node(r"""
out.corto = cpDuracion(10); out.medio = cpDuracion(95);
out.largo = cpDuracion(7906); out.redondo = cpDuracion(7200);
out.sin = cpDuracion(null);
""", tmp_path)
    assert o["corto"] == "10 s" and o["medio"] == "1:35 min"
    assert o["largo"] == "2 h 12 min" and o["redondo"] == "2 h"
    assert o["sin"] == ""


def test_el_indice_se_lee_como_lo_que_es(tmp_path):
    """«5× lo normal» se entiende; un 5 suelto se confundiría con vistas."""
    o = _node(r"""
out.alto = cpIndice(5); out.normal = cpIndice(1); out.sin = cpIndice(null);
""", tmp_path)
    assert "5× lo normal" in o["alto"]
    assert "lo normal de su cuenta" in o["alto"], "falta explicar qué es el índice"
    assert o["sin"] == ""
    assert 'class="indice bajo"' in o["normal"]


def test_el_texto_de_otro_no_puede_inyectar(tmp_path):
    """El pie de foto lo escribe la competencia del usuario, no nosotros."""
    o = _node(r"""
out.html = cpPublicacion({red: "tiktok", cuenta: '"><img src=x onerror=alert(1)>',
  cuando: "2026-09-10T13:00:00Z", enlace: "https://www.tiktok.com/@x/video/1",
  texto: "<script>alert(1)</script>", vistas: 10, me_gusta: 1, comentarios: 0,
  compartidos: 0, indice: 2});
""", tmp_path)
    # lo que importa no es que el texto desaparezca, sino que ninguna etiqueta
    # llegue viva: el `<` escapado lo vuelve texto que se lee, no HTML que corre
    assert "<script" not in o["html"] and "<img" not in o["html"]
    assert "&lt;script&gt;" in o["html"]
    # y la comilla del nombre de la cuenta no pudo cerrar ningún atributo
    assert '"><img' not in o["html"] and "&quot;&gt;&lt;img" in o["html"]


def test_sin_patron_lo_dice_en_vez_de_rellenar(tmp_path):
    """El prompt permite devolver cero patrones cuando la muestra no da; la
    pantalla tiene que saber enseñar eso sin parecer rota."""
    o = _node(r"""
out.vacia = cpLectura({patrones: [], ganchos: "", formato: "algo"}, []);
out.nada = cpLectura(null, []);
out.con = cpLectura({patrones: [{que: "los largos rinden", ids: ["a", "b"]}],
  ganchos: "arrancan con pregunta", formato: "vertical",
  probar: ["un gancho de pregunta"], advertencia: "solo 10 publicaciones"},
  [{id: "a"}, {id: "b"}]);
""", tmp_path)
    assert "No hay un patrón" in o["vacia"]
    assert o["nada"] == ""
    assert "los largos rinden" in o["con"] and "(2 publicaciones)" in o["con"]
    assert "solo 10 publicaciones" in o["con"], "la advertencia del LLM no se pintó"


def test_lo_que_no_se_pudo_traer_se_dice_con_los_creditos(tmp_path):
    """Se cobró por cuenta: si una no llegó, el usuario tiene que ver que se le
    devolvió y no solo que faltan publicaciones."""
    o = _node(r"""
out.uno = cpFallidas({fallidas: [{cuenta: "natgeo", motivo: "No devolvió publicaciones."}],
  devueltos: 3});
out.cero = cpFallidas({fallidas: [], devueltos: 0});
""", tmp_path)
    assert "@natgeo" in o["uno"] and "3 créditos" in o["uno"]
    assert o["cero"] == ""


def test_al_cargar_pide_una_sola_vez(tmp_path):
    """El arranque hace una llamada: la pantalla no puede gastar el cupo del
    usuario repitiendo la misma petición."""
    o = _node(r"""
await new Promise(r => setTimeout(r, 30));
out.llamadas = LLAMADAS.map(l => l[0] + " " + l[1]);
""", tmp_path)
    assert o["llamadas"] == ["/api/competencia GET"]


def test_el_boton_enseña_el_precio_de_las_cuentas_que_hay(tmp_path):
    o = _node(r"""
CPTARIFA = 3;
cpPintarCuentas([{id: "ig-uno", red: "instagram", cuenta: "uno"},
                 {id: "tt-dos", red: "tiktok", cuenta: "dos"}], 5);
out.boton = document.getElementById("btn-revisar").textContent;
out.precio = document.getElementById("precio").textContent;
out.vacio_boton = (cpPintarCuentas([], 5),
  document.getElementById("btn-revisar").textContent);
out.deshabilitado = document.getElementById("btn-revisar").disabled;
""", tmp_path)
    assert o["boton"] == "Revisar ✦ 6"
    assert "2 de 5" in o["precio"]
    assert o["vacio_boton"] == "Revisar" and o["deshabilitado"] is True
