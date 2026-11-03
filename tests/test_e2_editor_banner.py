"""E2 — el editor de cortes dice que se edita una COPIA (tools/editor/index.html, contrato E2 §6.9 y regla R1).

El dueño pidió que el encabezado del editor lo diga: «Copia de «{titulo}». Tu original no se toca.» (o, con varios,
«Copia de «{primero}» y N más. Tus originales no se tocan.»). Un proyecto que NO es copia trae `copia: null` y el editor se ve igual que antes.

Dos defensas:
- LEER el HTML como texto: `id="copiaDe"` con `role="note"` y `hidden`, `init()` que usa `j.copia`, ni una asignación con `innerHTML` (el título es
  texto de la persona), letra ≥ 13 px, y solo colores que el archivo ya usaba (la paleta la vigila `test_m20_paleta.py`);
- CORRER la página de verdad en jsdom (el de web/node_modules, el mismo de vitest) con un `fetch` de mentira que contesta `api/data`: lo que
  queda en el DOM para una copia con uno y con varios originales, para un proyecto que no es copia, y para un título con HTML (debe quedar como texto).
Nada sale a la red.
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
HTML = RAIZ / "tools" / "editor" / "index.html"
JSDOM = RAIZ / "web" / "node_modules" / "jsdom"


def _fuente() -> str:
    return HTML.read_text(encoding="utf-8")


def _init(fuente: str) -> str:
    """El cuerpo de `async function init()` (hasta la siguiente declaración al margen izquierdo)."""
    i = fuente.index("async function init()")
    f = fuente.index("\nconst sortEvents", i)
    return fuente[i:f]


def _regla_copiade(fuente: str) -> str:
    m = re.search(r"#copiaDe[^{]*\{[^}]*\}", fuente)
    assert m, "no hay regla CSS para #copiaDe"
    return m.group(0)


# ---------------------------------------------------------------------------------------------------- el HTML como texto
def test_el_encabezado_tiene_un_aviso_oculto_con_rol_de_nota():
    f = _fuente()
    m = re.search(r"<span\b[^>]*\bid=\"copiaDe\"[^>]*>", f)
    assert m, 'falta <span id="copiaDe">'
    etiqueta = m.group(0)
    assert 'role="note"' in etiqueta
    assert re.search(r"\bhidden\b", etiqueta), "sin `hidden` el aviso se vería en todo proyecto, también en los que no son copia"
    # en el encabezado, DESPUÉS del nombre del proyecto
    encabezado = f[f.index("<header>"):f.index("</header>")]
    assert encabezado.index('id="projName"') < encabezado.index('id="copiaDe"')


def test_init_lee_la_copia_y_pone_el_texto_sin_innerhtml():
    f = _fuente()
    cuerpo = _init(f)
    assert "j.copia" in cuerpo, "init() no mira `j.copia`"
    assert "j.titulo" in cuerpo
    assert '$("copiaDe").textContent' in cuerpo
    # el título es texto de la persona: ni el aviso ni el nombre del proyecto se asignan con innerHTML (en ningún lado del archivo)
    for m in re.finditer(r"innerHTML\s*[+]?=", f):
        linea = f[f.rfind("\n", 0, m.start()) + 1 : f.find("\n", m.end())]
        assert "copiaDe" not in linea and "projName" not in linea, f"asignación peligrosa: {linea.strip()}"
    assert not re.search(r"(copiaDe|projName)[^;\n]*innerHTML", f)
    assert not re.search(r"insertAdjacentHTML[^;\n]*(copiaDe|projName)", f)


def test_el_aviso_dice_las_dos_frases_del_contrato():
    cuerpo = _init(_fuente())
    assert "Copia de «" in cuerpo
    assert "Tu original no se toca." in cuerpo
    assert "Tus originales no se tocan." in cuerpo
    assert " más." in cuerpo or '" más' in cuerpo


def test_la_regla_css_no_empuja_el_encabezado_ni_inventa_colores():
    f = _fuente()
    regla = _regla_copiade(f)
    # un `display` de autor le ganaría al atributo hidden: la regla solo vale cuando NO está oculto
    assert "#copiaDe:not([hidden])" in regla
    # su PROPIA fila del encabezado (medido a 1100 px: en la misma fila de los botones los mandaba a una fila nueva)
    assert re.search(r"flex:\s*0 0 100%", regla)
    assert "text-overflow: ellipsis" in regla and "white-space: nowrap" in regla
    tam = re.search(r"font-size:\s*(\d+)px", regla)
    assert tam and int(tam.group(1)) >= 13, "la letra del aviso debe ser de 13 px o más"
    # el título de la copia (lo escribe la persona) se corta para no empujar los botones; solo cuando es copia
    nombre = re.search(r"#projName\.titulo\s*\{[^}]*\}", f)
    assert nombre, "falta la regla que corta el título largo de la copia"
    assert re.search(r"max-width:\s*\d+px", nombre.group(0)) and "text-overflow: ellipsis" in nombre.group(0)
    assert not re.search(r"(^|[\s,}])#projName\s*\{", f), "una regla sobre #projName a secas cambiaría también los proyectos que no son copia"
    # los colores: solo los que el archivo ya usaba fuera de esta regla
    resto = f.replace(regla, "")
    for color in set(re.findall(r"#[0-9a-fA-F]{3,8}\b", regla)):
        assert color.lower() in resto.lower(), f"{color} es un color nuevo en el editor"
    for var in set(re.findall(r"var\((--[\w-]+)\)", regla)):
        assert re.search(rf"{re.escape(var)}\s*:", f), f"{var} no está definida"


# ---------------------------------------------------------------------------------------------------- la página corriendo
NODO = r"""
const {JSDOM} = require(__JSDOM__);
const fs = require('fs');
const html = fs.readFileSync(__HTML__, 'utf8');

const base = {
  cuts: {styles: {tight: {internal_gap: 0.5, head: 0.1, soft_gap: 0.4, soft_max_tail: 0.3, min_tail: 0.1}}, clip_order: ['c1'],
         clips: [{id: 'c1', keeps: [{s: 0, e: 10, text: 'hola'}], cuts: []}]},
  manifest: {parts: [{id: 'c1', offset: 0, dur: 10}], total: 10}, words: {c1: []}, project: 'ed-9f1c0a7b', version: 1,
};
const casos = {
  varios: {...base, titulo: 'Mi <b>unión</b>', copia: [{titulo: 'Uno <img src=x onerror=alert(1)>', tipo: 'pelicula'}, {titulo: 'Dos', tipo: 'clip'}, {titulo: 'Tres', tipo: 'clip'}]},
  uno: {...base, titulo: 'La entrevista', copia: [{titulo: 'entrevista', tipo: 'pelicula'}]},
  no_es_copia: {...base, titulo: null, copia: null},
  vacia: {...base, titulo: 'x', copia: []},
  viejo: {...base},
  sin_titulos: {...base, titulo: 'Unión', copia: [{titulo: null, tipo: 'pelicula'}, {titulo: null, tipo: 'clip'}]},
};

async function abrir(datos) {
  const dom = new JSDOM(html, {url: 'http://x/editor/ed-9f1c0a7b/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = async url => {
        const u = String(url);
        const cuerpo = u.includes('api/data') ? datos : u.includes('api/chat/poll') ? {messages: []} : u.includes('api/overlays') ? {overlays: [], propuestas: []}
          : u.includes('api/subtitulos/estado') ? {segmentos: []} : null;
        return {ok: cuerpo !== null, status: cuerpo !== null ? 200 : 404, json: async () => cuerpo || {}};
      };
      w.HTMLMediaElement.prototype.load = () => {};
      w.HTMLMediaElement.prototype.pause = () => {};
    }});
  await new Promise(r => setTimeout(r, 400));
  const d = dom.window.document;
  const aviso = d.getElementById('copiaDe');
  const r = {
    proyecto: d.getElementById('projName').textContent, claseNombre: d.getElementById('projName').className, tituloNombre: d.getElementById('projName').getAttribute('title'),
    texto: aviso.textContent, titulo: aviso.getAttribute('title'), oculto: aviso.hidden, atributoHidden: aviso.hasAttribute('hidden'),
    rol: aviso.getAttribute('role'),
    // si algún título se hubiera tratado como HTML habría elementos nuevos dentro de la miga
    hijosDelAviso: aviso.children.length, hijosDelNombre: d.getElementById('projName').children.length,
    imagenesEnLaMiga: d.querySelectorAll('#miga img').length,
  };
  dom.window.close();
  return r;
}

(async () => {
  const out = {};
  for (const [k, v] of Object.entries(casos)) out[k] = await abrir(v);
  console.log(JSON.stringify(out));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
"""


@pytest.fixture(scope="module")
def pagina(tmp_path_factory):
    node = shutil.which("node")
    if not node:
        pytest.skip("node no está instalado")
    if not JSDOM.is_dir():
        pytest.skip("web/node_modules no está instalado (npm ci en web/)")
    f = tmp_path_factory.mktemp("e2editor") / "e.js"
    f.write_text(NODO.replace("__JSDOM__", json.dumps(str(JSDOM))).replace("__HTML__", json.dumps(str(HTML))), encoding="utf-8")
    r = subprocess.run([node, str(f)], capture_output=True, text=True, encoding="utf-8", timeout=90)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1])


def test_una_copia_de_varios_dice_el_primero_y_cuantos_mas_y_guarda_la_lista_en_title(pagina):
    p = pagina["varios"]
    assert p["oculto"] is False and not p["atributoHidden"]
    assert p["rol"] == "note"
    assert p["texto"] == "Copia de «Uno <img src=x onerror=alert(1)>» y 2 más. Tus originales no se tocan."
    assert p["titulo"] == "Originales: Uno <img src=x onerror=alert(1)> · Dos · Tres"
    # el nombre que se ve es el título de la copia, no el nombre técnico
    assert p["proyecto"] == "Mi <b>unión</b>"
    # y se corta con puntos suspensivos si es largo (con el título completo al pasar el cursor)
    assert p["claseNombre"] == "titulo" and p["tituloNombre"] == "Mi <b>unión</b>"


def test_los_titulos_de_la_gente_quedan_como_texto_y_no_crean_elementos(pagina):
    p = pagina["varios"]
    assert p["hijosDelAviso"] == 0 and p["hijosDelNombre"] == 0 and p["imagenesEnLaMiga"] == 0


def test_una_copia_de_un_solo_original_usa_el_singular(pagina):
    p = pagina["uno"]
    assert p["oculto"] is False
    assert p["texto"] == "Copia de «entrevista». Tu original no se toca."
    assert p["proyecto"] == "La entrevista"
    # sin plural en ninguna parte
    assert "originales" not in p["texto"] and " más" not in p["texto"]


def test_un_proyecto_que_no_es_copia_se_ve_igual_que_antes(pagina):
    for caso in ("no_es_copia", "vacia", "viejo"):
        p = pagina[caso]
        assert p["oculto"] is True and p["atributoHidden"], caso
        assert p["texto"] == "", caso
        # el nombre sigue siendo el del proyecto, aunque venga un `titulo`
        assert p["proyecto"] == "ed-9f1c0a7b", caso
        assert p["claseNombre"] == "" and p["tituloNombre"] is None, caso


def test_si_el_servidor_no_manda_los_titulos_el_aviso_no_dice_null_ni_undefined(pagina):
    p = pagina["sin_titulos"]
    assert p["oculto"] is False
    assert p["texto"] == "Copia de «un video» y 1 más. Tus originales no se tocan."
    assert "null" not in p["texto"] and "undefined" not in p["texto"]
    assert p["titulo"] and "null" not in p["titulo"] and "undefined" not in p["titulo"]
