"""C2 · Publicar en la nube — la interfaz del modal de Publicar del editor.

Lo que este archivo defiende:
  * que nada de lo que llega del servidor, de Blotato o del LLM entre a un
    innerHTML sin escapar (nombres de cuentas, títulos, destinos, archivos,
    mensajes): la cookie del token es legible desde JavaScript;
  * que el botón de enviar no se pueda pulsar dos veces, y que se apague
    DESPUÉS del confirm();
  * que el cuerpo del POST lleve solo los campos de la red, con la marca de IA
    y la privacidad como decidió el dueño (16-sep);
  * que el sondeo del avance no se duplique, no muera por la red, pare al
    cerrar el modal y no borre lo que se acaba de enviar;
  * que escribir el texto del post no dispare los atajos del editor;
  * que las reglas de texto de cada red (bytes, signos, hashtags) se avisen
    antes de subir el video, y que la película final sea lo que se propone.

Sin red y sin gastar: el HTML se lee como texto y la lógica corre en node con
un DOM mínimo (se salta si no hay node).
"""
import json
import re
import shutil
import subprocess
import time
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
HTML = (RAIZ / "tools" / "editor" / "index.html").read_text(encoding="utf-8")

INICIO_B3 = "// ── b3 · Publicar (C2)"


def _tramo(desde: str, hasta: str, texto: str = HTML) -> str:
    i = texto.index(desde)
    return texto[i:texto.index(hasta, i)]


B3 = _tramo(INICIO_B3, "async function g1abrir(")          # todo el JS del modal (corre en node)
MODAL = _tramo('<div id="b3modal">', '<div id="b1modal">')  # el marcado fijo
AYUDANTES = _tramo("function esc(s)", "const fj =")         # esc y fjDetalle
TECLADO = _tramo("const MODALES_ABIERTOS", '$("tbAyuda").onclick')  # los atajos del editor


def _plano(s: str) -> str:
    return " ".join(s.split())


def _funcion(nombre: str) -> str:
    """El cuerpo de una función del tramo b3, hasta la siguiente de primer nivel."""
    i = B3.index(nombre)
    m = re.search(r"\n(?:async )?function |\nconst ", B3[i + 1:])
    return B3[i:i + 1 + m.start()] if m else B3[i:]


# ---------------------------------------------------------------------------
# XSS: todo dato externo que llega a un innerHTML pasa por esc()

def test_existe_esc_y_escapa_los_cinco_caracteres():
    assert "function esc(s)" in HTML
    for par in ('"&": "&amp;"', '"<": "&lt;"', '">": "&gt;"', "'\"': \"&quot;\"", "\"'\": \"&#39;\""):
        assert par in AYUDANTES, f"esc no escapa {par}"


@pytest.mark.parametrize("uso,que", [
    ("esc(c.fullname || c.username)", "nombre de la cuenta de Blotato"),
    ("esc(B3REDES[c.platform].nombre || c.platform)", "nombre de la red"),
    ("esc(d.nombre)", "nombre del archivo"),
    ("esc(d.mb)", "tamaño del archivo"),
    ("esc(encodeURIComponent(peli.clave))", "clave del descargable en el href"),
    ("esc(t)", "títulos del LLM"),
    ('value="${esc(x.id)}"', "id del destino"),
    ("esc(x.nombre || x.id)", "nombre del destino"),
    ("esc(val)", "valor de privacidad"),
    ("esc(etq)", "etiqueta de privacidad"),
    ("esc(st.error)", "error del estado"),
    ("esc(cu.error)", "error de las cuentas"),
    ("esc(e.message)", "mensaje de error del servidor"),
    ("esc(p.cuenta_nombre)", "cuenta de la publicación"),
    ("esc(txt)", "título o texto de la publicación"),
    ("esc(msg)", "mensaje de la publicación"),
    ('href="${esc(p.url)}"', "enlace «Ver»"),
])
def test_cada_dato_externo_pasa_por_esc(uso, que):
    assert uso in B3, f"{que} se pinta sin escapar"


# Interpolaciones que NO son datos externos: índices y constantes internas.
INTERNAS = {"i", "clase", 'o[1] ? " checked" : ""'}


def _plantillas_html() -> list[str]:
    """Cada `x.innerHTML = …;` del tramo b3, y cada línea que arma una etiqueta
    fuera de esa asignación (las filas de b3fila, las <option> de destinos)."""
    fuera = [m.group(0) for m in re.finditer(r"\.innerHTML\s*=.*?;\n", B3, re.S)]
    fuera += [linea for linea in B3.splitlines() if re.search(r"<[a-z]", linea)]
    return fuera


def test_ningun_innerhtml_interpola_datos_sin_escapar():
    plantillas = _plantillas_html()
    # las hojas: ${…} sin llaves dentro (las externas llevan un .map anidado)
    hojas = [_plano(e) for p in plantillas for e in re.findall(r"\$\{([^{}]*)\}", p)]
    assert len(hojas) >= 30, "el recorte dejó de encontrar las plantillas: la prueba no vería nada"
    for e in hojas:
        assert e.startswith("esc(") or e in INTERNAS, \
            f"interpolación sin escapar en un innerHTML: ${{{e}}}"


def test_el_enlace_ver_solo_acepta_http():
    assert r"/^https?:\/\//i.test(p.url)" in B3
    assert 'rel="noopener noreferrer"' in _funcion("function b3fila(")


def test_fj_explica_el_422_de_pydantic():
    fj = HTML[HTML.index("const fj = (url, body)"):]
    fj = fj[:fj.index("\n", fj.index(".then("))]
    assert "fjDetalle(await r.json()" in fj
    assert ".detail ||" not in fj, "vuelve el «[object Object]»"


# ---------------------------------------------------------------------------
# lo que ya no está, y lo que no se cobra

def test_programar_ya_no_llega_pronto():
    assert "llega muy pronto" not in HTML
    assert "st.agendar === false" not in HTML
    assert "st.agendar" not in HTML


@pytest.mark.parametrize("tramo", ["modal", "js"])
def test_sugerir_titulos_es_gratis(tramo):
    texto = MODAL if tramo == "modal" else B3
    assert "$0.0" not in texto
    assert "dólares" not in texto
    assert "~$" not in texto
    assert "créditos" not in texto


def test_el_boton_de_titulos_no_trae_tooltip_de_costo():
    boton = re.search(r'<button[^>]*id="b3sugerir"[^>]*>', B3).group(0)
    assert "title=" not in boton


def test_el_orbe_de_titulos_no_dice_claude():
    """Los títulos no los escribe Claude: el orbe no puede decir que sí."""
    llamada = B3[B3.index('orbeOn("orbe-b3"'):]
    llamada = llamada[:llamada.index(");")]
    assert "Claude" not in llamada
    assert "Escribiendo títulos" in llamada
    assert "api/publicar/titulos" in B3


def test_enviar_no_lleva_orbe():
    """Subir el mp4 es espera mecánica: el orbe promete que hay alguien pensando."""
    handler = B3[B3.index('$("b3agendar").onclick'):]
    handler = handler[:handler.index("\n  };")]
    assert "orbeOn(" not in handler


# ---------------------------------------------------------------------------
# el botón de enviar

def _handler_agendar() -> str:
    h = B3[B3.index('$("b3agendar").onclick'):]
    return h[:h.index("\n  };")]


def test_enviar_se_apaga_despues_del_confirm_y_antes_del_await():
    h = _handler_agendar()
    confirmar = h.index("confirm(")
    apagar = h.index('$("b3agendar").disabled = true')
    espera = h.index("await")
    assert confirmar < apagar < espera, \
        "el botón debe apagarse después del confirm y antes de la petición"
    assert h.index("b3validar(") < confirmar, "se valida antes de preguntar"


def test_enviar_vuelve_a_la_vida_aunque_falle():
    h = _handler_agendar()
    fin = h[h.index("finally {"):]
    # el botón capturado antes del await: el de un modal reabierto no es suyo
    assert "btn.disabled = false" in fin
    assert '$("b3agendar")' not in fin
    assert h.index('const btn = $("b3agendar");') < h.index("await")


def test_enviar_hace_el_post_del_contrato_y_sigue_el_avance():
    h = _handler_agendar()
    assert 'fj("api/publicar/agendar", cuerpo)' in h
    assert "const cuerpo = b3cuerpo(red, v);" in h
    assert "b3sondear();" in h
    assert "Enviado: sigue el avance abajo" in h
    assert "r.publicacion" in h
    assert "b3resumen(red, cuerpo, v)" in h


def test_sugerir_titulos_no_toca_el_boton_ni_el_orbe_de_otro_modal():
    h = B3[B3.index('$("b3sugerir").onclick'):]
    h = h[:h.index("\n  };")]
    fin = h[h.index("finally {"):]
    assert "btn.disabled = false" in fin and '$("b3sugerir")' not in fin
    assert 'if (gen === B3GEN) orbeOff("orbe-b3");' in fin
    assert h.index('const btn = $("b3sugerir");') < h.index("await")


# ---------------------------------------------------------------------------
# lo que pide al servidor

def test_abrir_pide_estado_y_cuentas_por_separado():
    abrir = _funcion("async function b3abrir()")
    assert abrir.index('fj("api/publicar/estado")') < abrir.index('fj("api/publicar/cuentas")')
    # la descarga y las publicaciones se pintan ANTES de esperar a Blotato
    assert abrir.index("b3pintarPubs(") < abrir.index('fj("api/publicar/cuentas")')
    assert abrir.index('$("b3descargas").innerHTML') < abrir.index('fj("api/publicar/cuentas")')
    assert "cargando tus redes…" in abrir
    assert "st.cuentas" not in B3 and "st.reconectar" not in B3
    # la revisión de lo viejo no se espera: las redes no dependen de ella
    assert "\n  b3revisar(gen);" in abrir
    assert "B3ARCHIVOS = b3ordenar(st.descargables, st.final);" in abrir
    assert "B3STARTER = st.max_mb_starter" in abrir


def test_blotato_sin_redes_lo_dice_y_no_muestra_formulario():
    abrir = _plano(_funcion("async function b3abrir()"))
    assert ("Tu Blotato no tiene redes conectadas todavía. "
            "Conéctalas en Blotato y vuelve a abrir Publicar.") in abrir
    i = abrir.index("if (!todas.length)")
    assert abrir.index("return;", i) < abrir.index("b3formulario(gen);")


def test_solo_se_ofrecen_redes_con_reglas():
    assert "B3CUENTAS = todas.filter(c => B3REDES[c.platform]);" in B3


def test_destinos_se_piden_al_cambiar_de_cuenta():
    dest = _funcion("async function b3destinos(")
    assert "api/publicar/destinos?cuenta_id=${encodeURIComponent(c.id)}" in dest
    assert "&plataforma=${encodeURIComponent(c.platform)}" in dest
    assert '<option value="">Mi perfil personal</option>' in dest
    # una respuesta vieja no pisa la cuenta que se eligió después
    assert "pedido !== B3DESTGEN" in dest
    assert "b3destinos(gen);" in _funcion("function b3cambioCuenta(")
    assert '$("b3cuenta").onchange = () => b3cambioCuenta(gen);' in B3


def test_el_formulario_sigue_las_reglas_de_la_red():
    red = _funcion("function b3cambioCuenta(")
    assert '$("b3titulo").maxLength = red.titulo;' in red
    assert '$("b3texto").maxLength = red.texto;' in red
    assert '<option value="" selected>Elige quién puede verlo</option>' in red
    assert '<input type="checkbox" id="b3ia" checked> Hecho con IA' in red
    assert "B3OPCIONES[k]" in red
    assert '$("b3vertical").hidden = !red.vertical;' in red
    assert "Esta red solo acepta video vertical (9:16)." in B3
    assert '${n} / ${max}' in _funcion("function b3contar(")
    assert "b3largo(red, " in _funcion("function b3contar(")


def test_programar_sigue_siendo_el_default_con_la_zona_a_la_vista():
    form = _funcion("function b3formulario(")
    assert 'value="programar" checked' in form
    assert 'type="datetime-local" id="b3cuando"' in form
    assert "La hora es de tu zona: ${esc(tz)}." in form
    assert "new Date(v.fecha).toISOString()" in _funcion("function b3cuerpo(")


# ---------------------------------------------------------------------------
# el sondeo

def test_el_sondeo_consulta_publicaciones_cada_4_segundos():
    sondeo = _funcion("function b3sondear(")
    assert 'fj("api/publicar/publicaciones")' in sondeo
    assert "const B3SONDEO_MS = 4000;" in B3
    assert "if (B3SONDEO ||" in sondeo, "podría haber dos intervalos a la vez"
    assert "catch { return; }" in sondeo, "la red caída cortaría el sondeo"


def test_cerrar_el_modal_para_el_sondeo():
    assert 'onclick="b3cerrar()"' in MODAL
    assert "classList.remove('abierto')" not in MODAL, "el ✕ cierra sin parar el sondeo"
    cerrar = _funcion("function b3cerrar(")
    assert "b3parar();" in cerrar and "B3GEN++" in cerrar
    abrir = _funcion("async function b3abrir()")
    assert abrir.index("b3parar();") < abrir.index("await")


# ---------------------------------------------------------------------------
# el marcado: pantallas chicas y foco

def test_el_modal_cabe_en_pantallas_chicas():
    regla = HTML[HTML.index("#b3card {"):]
    regla = regla[:regla.index("}")]
    assert "max-height: 92vh" in regla and "overflow-y: auto" in regla
    assert "@media (max-width: 420px)" in HTML


def test_cerrar_es_un_boton_con_foco():
    assert '<button type="button" class="b3cerrar" onclick="b3cerrar()" aria-label="Cerrar">' in MODAL
    assert ":focus-visible { outline: 2px solid var(--accent)" in HTML


def test_la_lista_de_publicaciones_tiene_su_titulo():
    assert "Tus publicaciones de este video" in MODAL
    assert 'id="b3lista"' in MODAL
    assert 'role="status"' in MODAL


# ---------------------------------------------------------------------------
# en node, contra un DOM mínimo

_SIN_REGLAS = {"sin_signos": False, "texto_bytes": False, "hashtags": None}
REDES = {
    "youtube": {"nombre": "YouTube", "texto": 5000, "titulo": 100, "titulo_obligatorio": True,
                "privacidad": [["public", "Público"], ["unlisted", "No listado"], ["private", "Privado"]],
                "destino": None, "destino_obligatorio": False, "ia": True, "vertical": False,
                "mb": None, "seg": None, "opciones": ["notificar", "para_ninos"],
                "sin_signos": True, "texto_bytes": True, "hashtags": None},
    "tiktok": {"nombre": "TikTok", "texto": 2200, "titulo": None, "titulo_obligatorio": False,
               "privacidad": [["PUBLIC_TO_EVERYONE", "Todos"], ["SELF_ONLY", "Solo yo"]],
               "destino": None, "destino_obligatorio": False, "ia": True, "vertical": True,
               "mb": 287, "seg": 600,
               "opciones": ["comentarios", "duo", "stitch", "marca_propia", "marca_pagada"],
               **_SIN_REGLAS},
    "instagram": {"nombre": "Instagram", "texto": 2200, "titulo": None, "titulo_obligatorio": False,
                  "privacidad": None, "destino": None, "destino_obligatorio": False,
                  "ia": False, "vertical": True, "mb": 300, "seg": 900, "opciones": [],
                  "sin_signos": False, "texto_bytes": False, "hashtags": 5},
    "facebook": {"nombre": "Facebook", "texto": 63206, "titulo": None, "titulo_obligatorio": False,
                 "privacidad": None, "destino": "pagina", "destino_obligatorio": True,
                 "ia": False, "vertical": False, "mb": None, "seg": None, "opciones": [],
                 **_SIN_REGLAS},
    "linkedin": {"nombre": "LinkedIn", "texto": 3000, "titulo": None, "titulo_obligatorio": False,
                 "privacidad": None, "destino": "pagina", "destino_obligatorio": False,
                 "ia": False, "vertical": False, "mb": None, "seg": None, "opciones": [],
                 **_SIN_REGLAS},
    "pinterest": {"nombre": "Pinterest", "texto": 500, "titulo": 100, "titulo_obligatorio": False,
                  "privacidad": None, "destino": "tablero", "destino_obligatorio": True,
                  "ia": False, "vertical": False, "mb": None, "seg": None, "opciones": [],
                  **_SIN_REGLAS},
}

PRELUDIO = r"""
"use strict";
// Un DOM mínimo. Como en el navegador, lo que estaba dentro de #b3fn2 deja de
// existir cuando se reescribe: $() de un id que ya no está devuelve null, y el
// botón nuevo es otro objeto que el viejo.
const els = {};
const FIJOS = new Set(["b3modal", "b3msg", "b3pubs", "b3lista", "b3descargas",
                       "b3masWrap", "b3masTxt", "b3fn2"]);
let VIVOS = null;              // null: cualquier id existe (se crea al pedirlo)
class Nodo {
  constructor(id, tag = "DIV") {
    Object.assign(this, {id, tagName: tag, hidden: false, disabled: false, className: "",
      value: "", style: {}, children: [], hijos: [], atributos: {}, _html: "", _texto: ""});
    this.classList = {abierto: true, remove(c) { this[c] = false; }, add(c) { this[c] = true; }};
  }
  get innerHTML() { return this._html; }
  set innerHTML(h) {
    this._html = String(h);
    const ids = [...this._html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    if (this.id === "b3fn2") {
      for (const k of Object.keys(els)) if (!FIJOS.has(k)) delete els[k];
      VIVOS = new Set(ids);
    } else if (VIVOS) ids.forEach(i => VIVOS.add(i));
  }
  get textContent() {
    return this._texto + this.hijos.map(h => typeof h === "string" ? h : h.textContent).join("");
  }
  set textContent(t) { this._texto = String(t); this.hijos = []; }
  append(...xs) { this.hijos.push(...xs); }
  setAttribute(k, v) { this.atributos[k] = v; }
  removeAttribute(k) { delete this.atributos[k]; }
  focus() {}
  scrollIntoView() {}
}
const el = id => els[id] || (els[id] = new Nodo(id));
const $ = id => (VIVOS === null || FIJOS.has(id) || VIVOS.has(id)) ? el(id) : null;
let MODO = "programar";
const document = {
  getElementById: id => $(id),
  createElement: tag => new Nodo(null, tag.toUpperCase()),
  querySelector: sel => sel === 'input[name="b3modo"]:checked' ? {value: MODO} : null,
  querySelectorAll: () => [],
};
const window = {open() {}};
const ORBES = {};
let orbesApagados = 0;
function orbeOn(hueco, opciones) { return (ORBES[hueco] = {opciones}); }
function orbeOff(hueco) { orbesApagados++; delete ORBES[hueco]; }
let confirmar = true;
const confirmados = [];
function confirm(texto) { confirmados.push(texto); return confirmar; }
const esperar = () => new Promise(r => setImmediate(r));
// temporizadores de mentira: el test decide cuándo corre cada vuelta
const timers = [];
function setInterval(fn, ms) { timers.push({fn, ms, vivo: true}); return timers.length; }
function clearInterval(id) { if (timers[id - 1]) timers[id - 1].vivo = false; }
const vivos = () => timers.filter(t => t.vivo);
// respuestas: una cola en orden; rutas[url]: una cola por URL (va primero)
let respuestas = [], llamadas = [], cuerpos = [];
const rutas = {};
async function fj(url, body) {
  llamadas.push(url);
  cuerpos.push(body);
  const cola = rutas[url];
  const r = cola && cola.length ? cola.shift() : respuestas.shift();
  if (typeof r === 'function') return r();
  if (r instanceof Error) throw r;
  return r;
}
"""

# El flujo completo: abrir el modal con un estado y unas cuentas de mentira.
FLUJO = r"""
const PELI = {clave: "pelicula", nombre: "pelicula.mp4", mb: 42.1};
const ESTADO = (extra = {}) => ({descargables: [PELI], final: "pelicula", blotato: true,
  error: null, agendar: true, publicaciones: [], redes: B3REDES, max_mb_starter: 400, ...extra});
const CUENTA = {id: "Y1", platform: "youtube", fullname: "Mi canal", username: "mican"};
const CUENTAS = (cuentas = [CUENTA]) => ({conectado: true, cuentas, error: null, reconectar: false});
async function abrir(estado = ESTADO(), cuentas = CUENTAS()) {
  rutas["api/publicar/estado"] = [estado];
  rutas["api/publicar/cuentas"] = [cuentas];
  await b3abrir();
  await esperar();
}
// el formulario de YouTube, completo y en «Publicar ahora»
function llenar() {
  els.b3titulo.value = "Mi título";
  els.b3texto.value = "Mi descripción";
  els.b3privacidad.value = "public";
  MODO = "ahora";
}
const VISTA = {id: "a", plataforma: "youtube", cuenta_nombre: "yo", archivo: "pelicula",
  titulo: null, texto: "x", cuando: null, estado: "pendiente", en_curso: true, revisar: false,
  creado: 1, url: null, mensaje: null};
const ids = () => B3PUBS.map(p => p.id);
const consultas = () => llamadas.filter(u => u === "api/publicar/publicaciones").length;
const posts = () => llamadas.filter(u => u === "api/publicar/agendar").length;
"""


def _node(escenario: str, tmp_path: Path, redes: dict | None = None):
    nodo = shutil.which("node")
    if not nodo:
        pytest.skip("node no está en el PATH")
    codigo = (PRELUDIO + AYUDANTES + B3 +
              f"\nB3REDES = {json.dumps(redes if redes is not None else REDES)};\n" +
              "(async () => {\nconst out = {};\n" + FLUJO + escenario +
              "\nconsole.log(JSON.stringify(out));\n})().catch(e => { console.error(e); process.exit(1); });\n")
    f = tmp_path / "b3.js"
    f.write_text(codigo, encoding="utf-8")
    r = subprocess.run([nodo, str(f)], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_esc_escapa_los_cinco_en_node(tmp_path):
    o = _node(r"""
out.todo = esc(`<img src="x" onerror='alert(1)'>&`);
out.nulo = esc(null); out.indef = esc(undefined); out.num = esc(42.5);
""", tmp_path)
    assert o["todo"] == "&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;"
    assert o["nulo"] == "" and o["indef"] == "" and o["num"] == "42.5"


def test_fj_detalle_en_node(tmp_path):
    o = _node(r"""
out.texto = fjDetalle({detail: "Falta confirmar"}, 428);
out.lista = fjDetalle({detail: [{loc: ["body", "plataforma"], msg: "Field required"},
                                {loc: ["body", "texto"], msg: "String too long"}]}, 422);
out.sinLoc = fjDetalle({detail: [{msg: "algo"}]}, 422);
out.vacio = fjDetalle({}, 500);
out.nada = fjDetalle(null, 502);
out.objeto = fjDetalle({detail: {msg: "raro"}}, 400);
""", tmp_path)
    assert o["texto"] == "Falta confirmar"
    assert o["lista"] == "plataforma: Field required · texto: String too long"
    assert o["sinLoc"] == "algo"
    assert o["vacio"] == "el servidor respondió 500"
    assert o["nada"] == "el servidor respondió 502"
    assert o["objeto"] == "raro"
    assert all("[object Object]" not in v for v in o.values())


# valores de un formulario completo; cada caso cambia lo suyo
BASE = {"cuenta_id": "123", "plataforma": "youtube", "cuenta_nombre": "Mi canal",
        "archivo": "pelicula", "mb": 42.1, "texto": "  Mi descripción  ", "titulo": "Mi título",
        "privacidad": "public", "destino": "", "destino_nombre": "", "estado_destinos": "ok",
        "ia": True, "opciones": {}, "modo": "programar", "fecha": "2031-01-15T10:30"}


def _validar(tmp_path, casos):
    esc_ = json.dumps([[red, {**BASE, **cambios}] for red, cambios in casos])
    o = _node(f"""
const AHORA = new Date("2030-06-01T12:00").getTime();
out.r = {esc_}.map(([red, v]) => b3validar(B3REDES[red], v, AHORA));
""", tmp_path)
    return o["r"]


def test_validar_en_node(tmp_path):
    casos = [
        ("youtube", {}),                                                    # 0 completo
        ("tiktok", {"plataforma": "tiktok", "privacidad": ""}),             # 1 sin privacidad
        ("youtube", {"titulo": "   "}),                                     # 2 sin título
        ("facebook", {"plataforma": "facebook", "destino": ""}),            # 3 sin página
        ("facebook", {"plataforma": "facebook", "estado_destinos": "vacio"}),  # 4 sin páginas en Blotato
        ("linkedin", {"plataforma": "linkedin", "destino": ""}),            # 5 perfil personal
        ("pinterest", {"plataforma": "pinterest", "destino": ""}),          # 6 sin tablero
        ("youtube", {"fecha": "2020-01-01T10:00"}),                         # 7 hora pasada
        ("youtube", {"fecha": ""}),                                         # 8 programar sin fecha
        ("youtube", {"fecha": "", "modo": "ahora"}),                        # 9 ahora sin fecha
        ("tiktok", {"plataforma": "tiktok", "texto": "x" * 2201}),          # 10 texto largo
        ("tiktok", {"plataforma": "tiktok", "mb": 300}),                    # 11 muy pesado
        ("youtube", {"texto": "   "}),                                      # 12 sin texto
        ("youtube", {"archivo": ""}),                                       # 13 sin película
        ("facebook", {"plataforma": "facebook", "destino": "", "estado_destinos": "cargando"}),  # 14
        ("pinterest", {"plataforma": "pinterest", "destino": "b1", "titulo": ""}),  # 15 título opcional
        ("youtube", {"titulo": "t" * 101}),                                 # 16 título largo
        ("facebook", {"plataforma": "facebook", "destino": "999"}),         # 17 con página
        ("tiktok", {"plataforma": "tiktok", "mb": 287}),                    # 18 justo en el tope
        # LinkedIn: mientras cargan, «Mi perfil personal» no es una elección
        ("linkedin", {"plataforma": "linkedin", "destino": "",
                      "estado_destinos": "cargando"}),                      # 19
        ("linkedin", {"plataforma": "linkedin", "destino": "",
                      "estado_destinos": "error"}),                         # 20 al perfil
        ("facebook", {"plataforma": "facebook", "destino": "",
                      "estado_destinos": "error"}),                         # 21 → Reintentar
        ("pinterest", {"plataforma": "pinterest", "destino": "",
                       "estado_destinos": "error"}),                        # 22
        # Starter (400 MB) solo avisa: aquí no bloquea
        ("youtube", {"mb": 950}),                                           # 23
    ]
    r = _validar(tmp_path, casos)
    assert r[0] is None
    assert "quién puede ver" in r[1]
    assert "título" in r[2] and "YouTube" in r[2]
    assert r[3] == "Elige la página donde publicar."
    assert "no tiene páginas conectadas en Blotato" in r[4] and "Facebook" in r[4]
    assert r[5] is None, "LinkedIn sin página publica en el perfil personal"
    assert r[6] == "Elige el tablero donde publicar."
    assert "ya pasó" in r[7]
    assert "fecha y hora" in r[8]
    assert r[9] is None
    assert "2201 de 2200" in r[10]
    assert "300 MB" in r[11] and "287 MB" in r[11]
    assert r[12] == "Escribe la descripción."
    assert "no hay un video" in r[13]
    assert "Espera a que carguen tus páginas" in r[14]
    assert r[15] is None
    assert "100 caracteres" in r[16]
    assert r[17] is None
    assert r[18] is None
    assert r[19] == "Espera a que carguen tus páginas."
    assert r[20] is None
    assert r[21] == "No pudimos traer tus páginas: toca el botón «Reintentar», debajo de la lista."
    assert r[22] == "No pudimos traer tus tableros: toca el botón «Reintentar», debajo de la lista."
    assert r[23] is None, "el aviso de Starter no puede bloquear a Creator ni a Agency"
    assert all("vuelve a elegir la cuenta" not in (x or "") for x in r)


def test_reglas_de_texto_en_node(tmp_path):
    ig = {"plataforma": "instagram", "privacidad": "", "titulo": ""}
    tt = {"plataforma": "tiktok", "privacidad": "SELF_ONLY"}
    casos = [
        ("youtube", {"texto": "Tips -> suscríbete <3"}),                    # 0 signos
        ("youtube", {"texto": "á" * 2501}),                                 # 1 5002 bytes
        ("youtube", {"texto": "á" * 2500}),                                 # 2 5000 bytes justos
        ("youtube", {"texto": "a" * 5000}),                                 # 3
        ("youtube", {"texto": "😀" * 1251}),                                # 4 5004 bytes
        ("youtube", {"titulo": "Hola <b>mundo</b>"}),                      # 5 título con signos
        ("tiktok", {**tt, "texto": "<3 " + "á" * 2000}),                    # 6 sin reglas: pasa
        ("pinterest", {"plataforma": "pinterest", "destino": "b1",
                       "titulo": "a > b"}),                                 # 7 título en otra red
        ("instagram", {**ig, "texto": "#a #b #c #d #e #f"}),                # 8 seis hashtags
        ("instagram", {**ig, "texto": "#uno #dos #tres #cuatro #cinco "
                                      "C# correo#algo ##doble #"}),         # 9 cinco de verdad
        ("instagram", {**ig, "texto": "¡#Épico! (#año) #日本 #x_1 #tag😀#otro"}),  # 10 seis
        ("tiktok", {**tt, "texto": "#a #b #c #d #e #f #g"}),                # 11 sin tope
    ]
    r = _validar(tmp_path, casos)
    assert r[0] == "El texto de YouTube no puede llevar los signos < ni >."
    assert r[1] == ("El texto pasa del máximo de YouTube: 5002 de 5000 bytes "
                    "(las tildes y los emojis cuentan doble o más).")
    assert r[2] is None and r[3] is None
    assert "5004 de 5000 bytes" in r[4]
    assert r[5] == "El título no puede llevar los signos < ni >."
    assert r[6] is None
    assert r[7] == "El título no puede llevar los signos < ni >."
    assert r[8] == "Instagram acepta hasta 5 hashtags y el texto lleva 6."
    assert r[9] is None
    assert r[10] == "Instagram acepta hasta 5 hashtags y el texto lleva 6."
    assert r[11] is None


HASHTAGS = ["#a #b", "#a#b", "x#y", "(#hola)", "#123", "#_x", "¡#Épico!", "#日本", "#١٢٣",
            "emoji😀#tag", "#tag😀#otro", "##doble", "C# y F#", "#", "a #b, #c. #d;#e",
            "línea\n#nueva", "#ñandú-#río"]


def test_hashtags_se_cuentan_como_en_el_servidor(tmp_path):
    from pipeline import blotato
    o = _node(f"out.n = {json.dumps(HASHTAGS)}.map(b3hashtags);", tmp_path)
    assert o["n"] == [len(blotato._HASHTAG.findall(t)) for t in HASHTAGS]


def test_reglas_de_texto_coinciden_con_el_servidor(tmp_path):
    """Con las reglas REALES de pipeline/blotato.py: lo que la pantalla deja
    pasar, el servidor lo acepta, y lo que la pantalla frena, el servidor
    también lo rechazaría (pero después de gastar la subida)."""
    from pipeline import blotato
    muestras = [
        ("youtube", "Tips -> suscríbete <3"), ("youtube", "á" * 2501), ("youtube", "á" * 2500),
        ("youtube", "a" * 5001), ("youtube", "😀" * 1250), ("youtube", "😀" * 1251),
        ("instagram", "#a #b #c #d #e #f"), ("instagram", "#a #b #c #d #e"),
        ("instagram", "#a#b#c#d#e#f"), ("twitter", "x" * 281), ("twitter", "<3 " * 90),
        ("tiktok", "<b>hola</b> #a #b #c #d #e #f"), ("facebook", "á" * 5000),
    ]
    casos = []
    for plat, texto in muestras:
        red = blotato.REDES[plat]
        casos.append([plat, {**BASE, "plataforma": plat, "texto": texto, "destino": "123",
                             "privacidad": (red["privacidad"] or [[""]])[0][0]}])
    o = _node(f"""
const AHORA = new Date("2030-06-01T12:00").getTime();
out.r = {json.dumps(casos)}.map(([red, v]) => b3validar(B3REDES[red], v, AHORA));
""", tmp_path, redes=blotato.REDES)
    for (plat, texto), ui in zip(muestras, o["r"]):
        try:
            blotato.revisar_texto(plat, texto)
            servidor = None
        except ValueError as err:
            servidor = str(err)
        assert (ui is None) == (servidor is None), (plat, texto[:30], ui, servidor)


def _cuerpos(tmp_path, casos):
    esc_ = json.dumps([[red, {**BASE, **cambios}] for red, cambios in casos])
    return _node(f"""
out.r = {esc_}.map(([red, v]) => b3cuerpo(B3REDES[red], v));
out.iso = new Date("{BASE['fecha']}").toISOString();
""", tmp_path)


BASICOS = {"confirmar", "cuenta_id", "plataforma", "cuenta_nombre", "archivo", "texto", "cuando"}


def test_cuerpo_en_node(tmp_path):
    todas = {"notificar": False, "para_ninos": True, "comentarios": False, "duo": True,
             "stitch": False, "marca_propia": True, "marca_pagada": False}
    o = _cuerpos(tmp_path, [
        ("youtube", {"opciones": todas}),                                           # 0
        ("tiktok", {"plataforma": "tiktok", "modo": "ahora", "ia": False,
                    "privacidad": "SELF_ONLY", "opciones": todas}),                 # 1
        ("facebook", {"plataforma": "facebook", "destino": "999", "opciones": todas}),  # 2
        ("linkedin", {"plataforma": "linkedin", "destino": ""}),                    # 3
        ("pinterest", {"plataforma": "pinterest", "destino": "b1", "titulo": "  "}),  # 4
        ("youtube", {"ia": False, "opciones": {"notificar": True}}),                # 5
    ])
    yt, tt, fb, li, pi, yt2 = o["r"]

    assert set(yt) == BASICOS | {"titulo", "privacidad", "ia", "notificar", "para_ninos"}
    assert yt["confirmar"] is True
    assert yt["texto"] == "Mi descripción"
    assert yt["titulo"] == "Mi título" and yt["privacidad"] == "public"
    assert yt["ia"] is True
    assert yt["notificar"] is False and yt["para_ninos"] is True
    assert yt["cuando"] == o["iso"] and yt["cuando"].endswith("Z")
    assert yt["cuenta_nombre"] == "Mi canal" and yt["archivo"] == "pelicula"

    assert set(tt) == BASICOS | {"privacidad", "ia", "comentarios", "duo", "stitch",
                                 "marca_propia", "marca_pagada"}
    assert tt["cuando"] is None, "«Publicar ahora» manda cuando=null"
    assert tt["ia"] is False, "el usuario desmarcó «Hecho con IA»"
    assert tt["privacidad"] == "SELF_ONLY"
    assert (tt["comentarios"], tt["duo"], tt["stitch"]) == (False, True, False)

    assert set(fb) == BASICOS | {"destino"}
    assert fb["destino"] == "999"

    assert set(li) == BASICOS | {"destino"}
    assert li["destino"] is None, "«Mi perfil personal» viaja como destino null"

    assert set(pi) == BASICOS | {"titulo", "destino"}
    assert pi["titulo"] is None and pi["destino"] == "b1"

    # solo las opciones que se pintaron (y que son de la red) viajan
    assert set(yt2) == BASICOS | {"titulo", "privacidad", "ia", "notificar"}
    assert yt2["ia"] is False


def test_las_casillas_nacen_como_decidio_el_dueno(tmp_path):
    o = _node("out.op = B3OPCIONES;", tmp_path)["op"]
    assert o == {
        "comentarios": ["Permitir comentarios", True],
        "duo": ["Permitir dúos", True],
        "stitch": ["Permitir stitch", True],
        "marca_propia": ["Promociono mi propia marca", False],
        "marca_pagada": ["Contenido pagado por una marca", False],
        "notificar": ["Avisar a mis suscriptores", True],
        "para_ninos": ["Hecho para niños", False],
    }
    # y cada opción que el contrato nombra tiene su casilla
    for red in REDES.values():
        assert set(red["opciones"]) <= set(o)


def test_resumen_del_confirm_en_node(tmp_path):
    o = _node(r"""
const fb = {confirmar: true, cuenta_id: "1", plataforma: "facebook", cuenta_nombre: "Yo",
            archivo: "pelicula", texto: "a".repeat(300), cuando: null, destino: "999"};
out.fb = b3resumen(B3REDES.facebook, fb,
                   {destino_nombre: "Mi página", archivo_nombre: "pelicula.mp4", mb: 42.1});
const yt = {...fb, plataforma: "youtube", titulo: "Hola", cuando: "2031-01-15T16:30:00.000Z",
            archivo: "preview-tight"};
const vyt = {destino_nombre: "", archivo_nombre: "preview-tight.mp4", mb: 612.5};
out.ytSinTope = b3resumen(B3REDES.youtube, yt, vyt);
B3STARTER = 400;
out.yt = b3resumen(B3REDES.youtube, yt, vyt);
out.liviano = b3resumen(B3REDES.youtube, yt, {...vyt, mb: 400});
""", tmp_path)
    assert o["fb"].startswith("¿Publicar este video?")
    assert "Red: Facebook\nCuenta: Yo\nVideo: pelicula.mp4 (42.1 MB)\nPágina: Mi página" in o["fb"]
    assert "AHORA" in o["fb"]
    assert "a" * 139 + "…" in o["fb"] and "a" * 141 not in o["fb"], "el texto va recortado"
    assert "Ojo" not in o["fb"]
    assert o["yt"].startswith("¿Programar este video?")
    assert "Video: preview-tight.mp4 (612.5 MB)" in o["yt"]
    assert "Título: «Hola»" in o["yt"] and "(tu hora)" in o["yt"]
    assert "Página:" not in o["yt"]
    assert o["yt"].endswith("\n\nOjo: Pesa 612.5 MB: con el plan Starter de Blotato el límite "
                            "es 400 MB (Creator y Agency: 1 GB).")
    assert "Ojo" not in o["ytSinTope"], "sin max_mb_starter del servidor no se inventa el tope"
    assert "Ojo" not in o["liviano"]


def test_aviso_starter_en_node(tmp_path):
    o = _node(r"""
out.pesado = b3msgStarter(450.5, 400);
out.justo = b3msgStarter(400, 400);
out.sinTope = b3msgStarter(900, null);
""", tmp_path)
    assert o["pesado"] == ("Pesa 450.5 MB: con el plan Starter de Blotato el límite es 400 MB "
                           "(Creator y Agency: 1 GB).")
    assert o["justo"] is None and o["sinTope"] is None


def test_ordenar_archivos_en_node(tmp_path):
    def d(clave, ext="mp4"):
        return {"clave": clave, "nombre": f"{clave}.{ext}", "mb": 1}
    natural, tight, tsub = d("preview-natural"), d("preview-tight"), d("preview-tight-subtitulado")
    peli, sub, srt = d("pelicula"), d("subtitulado"), d("srt", "srt")
    casos = [
        ([natural, tsub, tight], "preview-tight-subtitulado"),   # 0 S3 en orden alfabético
        ([natural, peli, tight], "pelicula"),                    # 1 generado con render de corte
        ([natural, peli, sub, tight, srt], None),                # 2 sin final: la cadena de antes
        ([natural, tight], "inexistente"),                       # 3 final que no está: el orden llegado
        ([srt, natural], "srt"),                                 # 4 un final que no es mp4
        ([], "pelicula"),                                        # 5
        (None, None),                                            # 6
    ]
    o = _node(f"out.r = {json.dumps(casos)}.map(([des, fin]) => b3ordenar(des, fin).map(a => a.clave));",
              tmp_path)
    assert o["r"] == [
        ["preview-tight-subtitulado", "preview-natural", "preview-tight"],
        ["pelicula", "preview-natural", "preview-tight"],
        ["subtitulado", "pelicula", "preview-natural", "preview-tight"],
        ["preview-natural", "preview-tight"],
        ["preview-natural"],
        [],
        [],
    ]


def _mensajes_reales() -> dict:
    """Los mensajes que de verdad manda el servidor, no unos inventados."""
    import httpx
    from pipeline import blotato, publicaciones
    t = time.time()
    viejo = t - 10 ** 6
    fallido = {"estado": "enviado"}
    publicaciones.aplicar_estado(fallido, {"status": "failed", "errorMessage": "Video too long."})
    pedido = httpx.Request("GET", "https://backend.blotato.com/v2/posts")
    revocada = httpx.HTTPStatusError("x", request=pedido,
                                     response=httpx.Response(401, request=pedido))
    return {
        "fallido": fallido["error"],
        "vencido": publicaciones.vista({"id": "g", "estado": "pendiente",
                                        "creado": viejo, "actualizado": viejo}, t),
        "clave": blotato.explicar_fallo(revocada)[0],
        "enviado": publicaciones.vista({"id": "i", "estado": "enviado", "post_id": "abc123",
                                        "creado": viejo, "actualizado": viejo}, t),
    }


def test_filas_de_publicaciones_en_node(tmp_path):
    malo = "<img src=x onerror=alert(1)>"
    real = _mensajes_reales()
    assert real["vencido"]["estado"] == "error" and real["vencido"]["mensaje"]
    assert real["enviado"]["estado"] == "enviado" and real["enviado"]["en_curso"] is False
    comun = {"plataforma": "youtube", "cuenta_nombre": "yo", "titulo": None, "texto": "x",
             "cuando": None, "url": None}
    vistas = [
        {"id": "a", "plataforma": "youtube", "cuenta_nombre": malo, "titulo": malo, "texto": "t",
         "cuando": None, "estado": "publicado", "en_curso": False,
         "url": "https://youtube.com/watch?v=1", "mensaje": malo},
        {"id": "b", "plataforma": "tiktok", "cuenta_nombre": "yo", "titulo": None, "texto": "hola",
         "cuando": "2031-01-15T16:30:00+00:00", "estado": "programado", "en_curso": False,
         "url": "javascript:alert(1)", "mensaje": None},
        {"id": "c", "plataforma": "facebook", "cuenta_nombre": "yo", "titulo": None, "texto": "x",
         "cuando": None, "estado": "subiendo", "en_curso": True, "url": None,
         "mensaje": "Subiendo el video…"},
        {"id": "d", "plataforma": "linkedin", "cuenta_nombre": "yo", "titulo": None, "texto": "x",
         "cuando": None, "estado": "incierto", "en_curso": False, "url": None, "mensaje": None},
        {"id": "e", "plataforma": malo, "cuenta_nombre": "yo", "titulo": None, "texto": "x",
         "cuando": None, "estado": "fallido", "en_curso": False, "url": None,
         "mensaje": real["fallido"]},
        {"id": "f", "plataforma": "youtube", "cuenta_nombre": "yo", "titulo": None, "texto": "x",
         "cuando": None, "estado": "error", "en_curso": False, "url": None, "mensaje": None},
        {**comun, "id": "g", "estado": "error", "en_curso": False,
         "mensaje": real["vencido"]["mensaje"]},
        {**comun, "id": "h", "estado": "error", "en_curso": False, "mensaje": real["clave"]},
        {**real["enviado"], **comun, "id": "i"},
        {**comun, "id": "j", "estado": "enviado", "en_curso": True,
         "mensaje": "Blotato la está publicando…"},
    ]
    o = _node(f"""
const vistas = {json.dumps(vistas)};
out.filas = vistas.map(p => b3fila(p, B3REDES));
out.etiquetas = vistas.map(p => b3etiqueta(p));
out.fecha = b3fecha("2031-01-15T16:30:00+00:00");
b3pintarPubs(vistas);
out.oculta = els.b3pubs.hidden;
out.html = els.b3lista.innerHTML;
b3pintarPubs([]);
out.ocultaVacia = els.b3pubs.hidden;
""", tmp_path)
    pub, prog, curso, incierto, fallido, error, vencido, clave, enviado, enviando = o["filas"]
    for fila in o["filas"]:
        assert "<img" not in fila, fila
    assert "&lt;img src=x onerror=alert(1)&gt;" in pub
    assert '<a href="https://youtube.com/watch?v=1" target="_blank" rel="noopener noreferrer">Ver</a>' in pub
    assert "javascript:" not in prog and ">Ver<" not in prog
    assert o["etiquetas"] == [
        ["Publicada", "ok"], [f"Programada para {o['fecha']}", "ok"], ["Enviando…", "curso"],
        ["Sin confirmar", "aviso"], ["Blotato la rechazó", "err"], ["No se envió", "err"],
        ["No se envió", "err"], ["No se envió", "err"],
        ["Sin confirmar", "aviso"], ["Enviando…", "curso"],
    ]
    assert o["fecha"] and "2031" in o["fecha"]
    assert "<b>YouTube</b>" in pub and "<b>TikTok</b>" in prog
    assert "Subiendo el video…" in curso
    assert "No sabemos si llegó: revisa tu calendario de Blotato antes de intentar de nuevo." in incierto

    def mensaje(fila):
        return re.search(r'<div class="b3pubMsg">(.*?)</div>', fila).group(1)

    # el mensaje del servidor va tal cual: nada de «Intenta de nuevo. Puedes intentarlo de nuevo.»
    assert mensaje(fallido) == real["fallido"]
    assert mensaje(fallido).count("de nuevo") == 1
    assert mensaje(error) == "Puedes intentarlo de nuevo.", "sin mensaje, se invita a reintentar"
    assert mensaje(vencido) == real["vencido"]["mensaje"]
    assert mensaje(vencido).count("de nuevo") == 1
    # con la clave revocada reintentar no sirve: no se invita
    assert mensaje(clave) == real["clave"] and "Puedes intentarlo" not in clave
    # «enviado» que ya no se sigue: su propio mensaje, sin «Enviando…»
    assert mensaje(enviado) == real["enviado"]["mensaje"]
    assert "Enviando…" not in enviado
    assert mensaje(enviando) == "Blotato la está publicando…"
    assert o["oculta"] is False and o["ocultaVacia"] is True
    assert o["html"] == "".join(o["filas"])


def test_destinos_en_node(tmp_path):
    o = _node(r"""
const cuentas = {
  li: {id: "L1", platform: "linkedin", fullname: "Yo"},
  fb: {id: "a&b", platform: "facebook", fullname: "Yo"},
  pi: {id: "P1", platform: "pinterest", fullname: "Yo"},
  yt: {id: "Y1", platform: "youtube", fullname: "Yo"},
};
$("b3cuenta").value = "0";
const boton = () => els.b3destNota.hijos.find(h => h.tagName === "BUTTON") || null;
const foto = () => ({html: els.b3destino.innerHTML, off: els.b3destino.disabled,
  nota: els.b3destNota.hidden ? null : els.b3destNota._texto,
  boton: boton() && boton().textContent,
  oculto: els.b3destWrap.hidden, etiqueta: els.b3destLbl.textContent, estado: B3DEST.estado});
const correr = async (c, r) => { B3CUENTAS = [c]; respuestas.push(r); await b3destinos(B3GEN); return foto(); };
const paginas = {destinos: [{id: "p1", nombre: "<b>Mi página</b>"}, {id: "p2", nombre: "Otra"}], error: null};

out.liDos = await correr(cuentas.li, paginas);
out.liError = await correr(cuentas.li, new Error("Blotato no respondió."));

// Facebook con UNA sola cuenta: volver a elegirla no dispara nada; el botón sí
out.fbError = await correr(cuentas.fb, new Error("Blotato no respondió."));
const reintentar = boton();
out.fbBotonTipo = reintentar.type;
let n0 = llamadas.length;
respuestas.push(new Error("Sigue caído."));
await reintentar.onclick();
out.fbOtraVez = {...foto(), pidio: llamadas.slice(n0)};
n0 = llamadas.length;
respuestas.push(paginas);
await boton().onclick();
out.fbReintento = {...foto(), pidio: llamadas.slice(n0)};
out.piError = await correr(cuentas.pi, {destinos: [], error: "Blotato respondió con un error (500)."});

out.fbVacio = await correr(cuentas.fb, {destinos: [], error: null});
out.fbUna = await correr(cuentas.fb, {destinos: [{id: "p1", nombre: "Única"}], error: null});
out.fbDos = await correr(cuentas.fb, paginas);
out.piDos = await correr(cuentas.pi, paginas);
out.urls = llamadas.slice();
const n = llamadas.length;
out.yt = await correr(cuentas.yt, undefined);
out.ytPidio = llamadas.length - n;
respuestas.length = 0;

// una respuesta vieja no pisa la cuenta que se eligió después
let soltar;
B3CUENTAS = [cuentas.fb];
respuestas.push(() => new Promise(r => soltar = r));
const vieja = b3destinos(B3GEN);
B3CUENTAS = [cuentas.li];
respuestas.push({destinos: [], error: null});
await b3destinos(B3GEN);
soltar(paginas);
await vieja;
out.carrera = foto();
""", tmp_path)
    li = o["liDos"]
    assert li["html"].startswith('<option value="">Mi perfil personal</option>')
    assert '<option value="p1">&lt;b&gt;Mi página&lt;/b&gt;</option>' in li["html"]
    assert (li["off"], li["nota"], li["oculto"], li["estado"]) == (False, None, False, "ok")
    assert li["etiqueta"] == "Página"

    assert o["liError"]["html"] == '<option value="">Mi perfil personal</option>'
    assert o["liError"]["off"] is False
    assert o["liError"]["nota"] == ("Blotato no respondió. Por ahora puedes publicar "
                                    "en tu perfil personal.")
    assert o["liError"]["estado"] == "error"
    assert o["liError"]["boton"] == "Reintentar", "LinkedIn también puede volver a pedir sus páginas"
    assert o["liDos"]["boton"] is None

    fbe = o["fbError"]
    assert (fbe["nota"], fbe["boton"], fbe["estado"], fbe["off"]) == \
        ("Blotato no respondió.", "Reintentar", "error", True)
    assert o["fbBotonTipo"] == "button"
    # reintentar vuelve a pedir la MISMA lista, y la nota vieja no se acumula
    url_fb = "api/publicar/destinos?cuenta_id=a%26b&plataforma=facebook"
    otra = o["fbOtraVez"]
    assert otra["pidio"] == [url_fb]
    assert (otra["nota"], otra["boton"], otra["estado"]) == ("Sigue caído.", "Reintentar", "error")
    bien = o["fbReintento"]
    assert bien["pidio"] == [url_fb]
    assert (bien["nota"], bien["boton"], bien["estado"], bien["off"]) == (None, None, "ok", False)
    assert bien["html"].startswith('<option value="">Elige la página</option>')
    assert o["piError"]["boton"] == "Reintentar" and o["piError"]["estado"] == "error"

    fb = o["fbVacio"]
    assert fb["html"] == '<option value="">sin páginas</option>' and fb["off"] is True
    assert fb["nota"] == ("Tu cuenta de Facebook no tiene páginas conectadas en Blotato. "
                          "Conecta tu página en Blotato y vuelve a abrir Publicar.")
    assert fb["estado"] == "vacio"
    assert fb["boton"] is None, "sin error no hay nada que reintentar"

    assert o["fbUna"]["html"] == '<option value="p1">Única</option>', "una sola página va elegida"
    assert o["fbDos"]["html"].startswith('<option value="">Elige la página</option>')
    assert o["piDos"]["etiqueta"] == "Tablero"
    assert o["piDos"]["html"].startswith('<option value="">Elige el tablero</option>')

    assert o["urls"][2] == "api/publicar/destinos?cuenta_id=a%26b&plataforma=facebook"
    assert o["urls"][0] == "api/publicar/destinos?cuenta_id=L1&plataforma=linkedin"

    assert o["yt"]["oculto"] is True and o["yt"]["html"] == "" and o["ytPidio"] == 0

    assert o["carrera"]["html"] == '<option value="">Mi perfil personal</option>', \
        "la respuesta de Facebook llegó tarde y pisó la de LinkedIn"


EN_CURSO = {"id": "a", "plataforma": "youtube", "cuenta_nombre": "yo", "titulo": None,
            "texto": "x", "cuando": None, "estado": "pendiente", "en_curso": True,
            "url": None, "mensaje": None}
LISTA = {**EN_CURSO, "estado": "publicado", "en_curso": False}


def test_sondeo_en_node(tmp_path):
    o = _node(f"""
const curso = {json.dumps(EN_CURSO)}, lista = {json.dumps(LISTA)};
const vuelta = () => Promise.all(vivos().map(t => t.fn()));

// sin nada en curso no arranca
b3pintarPubs([lista]); b3sondear();
out.sinCurso = timers.length;

// con algo en curso arranca UNO, aunque se pida dos veces
b3pintarPubs([curso]); b3sondear(); b3sondear();
out.uno = vivos().length;
out.ms = timers[0].ms;

// la red caída no corta el sondeo ni borra la lista
respuestas.push(new Error("sin red"));
await vuelta();
out.trasError = {{vivos: vivos().length, pubs: B3PUBS.length}};

// una respuesta rara tampoco
respuestas.push({{}});
await vuelta();
out.trasRara = {{vivos: vivos().length, pubs: B3PUBS.length}};

// sigue en curso: pinta y sigue
respuestas.push({{publicaciones: [{{...curso, estado: "subiendo"}}]}});
await vuelta();
out.sigue = {{vivos: vivos().length, estado: B3PUBS[0].estado}};

// dos vueltas encimadas: una sola petición
let soltar;
respuestas.push(() => new Promise(r => soltar = r));
const antes = llamadas.length;
const p1 = timers[0].fn();
const p2 = timers[0].fn();
out.encimadas = llamadas.length - antes;
soltar({{publicaciones: [curso]}});
await Promise.all([p1, p2]);

// ya ninguna en curso: para
respuestas.push({{publicaciones: [lista]}});
await vuelta();
out.paro = {{vivos: vivos().length, sondeo: B3SONDEO, estado: B3PUBS[0].estado}};
out.urls = [...new Set(llamadas)];

// cerrar con una vuelta en camino: lo que llega tarde no se pinta
b3pintarPubs([curso]); b3sondear();
respuestas.push(() => new Promise(r => soltar = r));
const tarde = vivos()[0].fn();
b3cerrar();
out.cerrado = {{vivos: vivos().length, sondeo: B3SONDEO, modal: els.b3modal.classList.abierto,
               orbe: orbesApagados}};
soltar({{publicaciones: [lista]}});
await tarde;
out.tarde = B3PUBS[0].estado;

// un intervalo de un modal viejo que aún corriera se apaga solo
B3SONDEO = null;
b3sondear();
const viejo = vivos()[0];
B3GEN++;
const n = llamadas.length;
await viejo.fn();
out.viejo = {{vivo: viejo.vivo, sondeo: B3SONDEO, llamo: llamadas.length - n}};

// al reabrir, un solo intervalo
b3sondear();
out.reabierto = vivos().length;
""", tmp_path)
    assert o["sinCurso"] == 0
    assert o["uno"] == 1 and o["ms"] == 4000
    assert o["trasError"] == {"vivos": 1, "pubs": 1}
    assert o["trasRara"] == {"vivos": 1, "pubs": 1}
    assert o["sigue"] == {"vivos": 1, "estado": "subiendo"}
    assert o["encimadas"] == 1
    assert o["paro"] == {"vivos": 0, "sondeo": None, "estado": "publicado"}
    assert o["urls"] == ["api/publicar/publicaciones"]
    assert o["cerrado"] == {"vivos": 0, "sondeo": None, "modal": False, "orbe": 1}
    assert o["tarde"] == "pendiente", "una respuesta tardía pintó un modal cerrado"
    assert o["viejo"] == {"vivo": False, "sondeo": None, "llamo": 0}
    assert o["reabierto"] == 1



# ---------------------------------------------------------------------------
# el flujo completo en node: abrir, llenar, enviar, reabrir

def test_sondeo_viejo_no_borra_lo_recien_enviado(tmp_path):
    o = _node(r"""
const A = {...VISTA, id: "a", estado: "enviado", en_curso: true};
await abrir(ESTADO({publicaciones: [A]}));
out.sondeo = vivos().length;
llenar();

// una vuelta sale y lee la lista ANTES de que exista B
let soltar;
rutas["api/publicar/publicaciones"] = [() => new Promise(r => soltar = r)];
const vuelta = vivos()[0].fn();

// el POST de B vuelve primero
const B = {...VISTA, id: "b", estado: "pendiente", en_curso: true};
rutas["api/publicar/agendar"] = [{publicacion: B}];
await els.b3agendar.onclick();
out.trasPost = ids();

// y la respuesta vieja llega tarde, sin B y con A ya publicada
soltar({publicaciones: [{...A, estado: "publicado", en_curso: false}]});
await vuelta;
out.trasVieja = {ids: ids(), vivos: vivos().length, sondeo: B3SONDEO !== null};

// la vuelta siguiente (que ya ve a B) sí se pinta, y el sondeo sigue por B
rutas["api/publicar/publicaciones"] = [{publicaciones: [{...B, estado: "subiendo"},
                                                       {...A, estado: "publicado", en_curso: false}]}];
await vivos()[0].fn();
out.siguiente = {pubs: B3PUBS.map(p => [p.id, p.estado]), vivos: vivos().length};
""", tmp_path)
    assert o["sondeo"] == 1
    assert o["trasPost"] == ["b", "a"]
    assert o["trasVieja"] == {"ids": ["b", "a"], "vivos": 1, "sondeo": True}, \
        "una vuelta vieja borró lo recién enviado o apagó el seguimiento"
    assert o["siguiente"] == {"pubs": [["b", "subiendo"], ["a", "publicado"]], "vivos": 1}


def test_la_pelicula_final_va_primero_y_el_confirm_la_nombra(tmp_path):
    o = _node(r"""
const des = [
  {clave: "preview-natural", nombre: "preview-natural.mp4", mb: 10},
  {clave: "preview-tight-subtitulado", nombre: "preview-tight-subtitulado.mp4", mb: 12.5},
  {clave: "preview-tight", nombre: "preview-tight.mp4", mb: 11},
  {clave: "srt", nombre: "subtitulos.srt", mb: 0.1},
];
await abrir(ESTADO({descargables: des, final: "preview-tight-subtitulado"}));
out.orden = B3ARCHIVOS.map(a => a.clave);
out.descarga = els.b3descargas.innerHTML;
out.form = els.b3fn2.innerHTML;
llenar();
rutas["api/publicar/agendar"] = [{publicacion: {...VISTA, id: "n"}}];
await els.b3agendar.onclick();
out.confirm = confirmados.at(-1);
out.archivo = cuerpos[llamadas.lastIndexOf("api/publicar/agendar")].archivo;

// sin «final» (un servidor viejo): la subtitulada, luego la base, luego el resto
await abrir(ESTADO({descargables: [des[0], PELI, {clave: "subtitulado", nombre: "subtitulado.mp4", mb: 43}],
                    final: undefined}));
out.sinFinal = B3ARCHIVOS.map(a => a.clave);
out.descargaSinFinal = els.b3descargas.innerHTML;
""", tmp_path)
    assert o["orden"] == ["preview-tight-subtitulado", "preview-natural", "preview-tight"]
    assert 'href="descarga/preview-tight-subtitulado"' in o["descarga"]
    primera = re.search(r'<select id="b3archivo"><option value="0">([^<]*)</option>', o["form"])
    assert primera.group(1) == "preview-tight-subtitulado.mp4 · 12.5 MB"
    assert "\nVideo: preview-tight-subtitulado.mp4 (12.5 MB)\n" in o["confirm"]
    assert o["archivo"] == "preview-tight-subtitulado"
    assert o["sinFinal"] == ["subtitulado", "pelicula", "preview-natural"]
    assert 'href="descarga/subtitulado"' in o["descargaSinFinal"]


def test_linkedin_no_envia_mientras_cargan_sus_paginas(tmp_path):
    o = _node(r"""
let soltar;
const LI = {id: "L1", platform: "linkedin", fullname: "Yo", username: "yo"};
rutas["api/publicar/destinos?cuenta_id=L1&plataforma=linkedin"] = [() => new Promise(r => soltar = r)];
await abrir(ESTADO(), CUENTAS([LI]));
els.b3texto.value = "Hola"; MODO = "ahora";
await els.b3agendar.onclick();
out.cargando = {msg: els.b3msg.textContent, err: els.b3msg.className, posts: posts(),
                confirms: confirmados.length, off: els.b3agendar.disabled};
soltar({destinos: [{id: "p1", nombre: "Mi empresa"}], error: null});
await esperar();
rutas["api/publicar/agendar"] = [{publicacion: {...VISTA, id: "l", plataforma: "linkedin"}}];
await els.b3agendar.onclick();
out.cargado = {posts: posts(), destino: cuerpos.at(-1).destino};
""", tmp_path)
    assert o["cargando"] == {"msg": "Espera a que carguen tus páginas.", "err": "err",
                             "posts": 0, "confirms": 0, "off": False}
    assert o["cargado"] == {"posts": 1, "destino": None}, "ya cargadas, «Mi perfil personal» vale"


def test_los_finally_no_tocan_el_modal_reabierto(tmp_path):
    o = _node(r"""
await abrir();

// «Sugerir títulos» → cerrar → reabrir → «Sugerir títulos» → vuelve la primera
let soltar1, soltar2;
rutas["api/publicar/titulos"] = [() => new Promise(r => soltar1 = r),
                                 () => new Promise(r => soltar2 = r)];
const viejo = els.b3sugerir;
const p1 = viejo.onclick();
b3cerrar();
await abrir();
const nuevo = els.b3sugerir;
out.otroBoton = nuevo !== viejo;
const p2 = nuevo.onclick();
const orbe = ORBES["orbe-b3"];
soltar1({titulos: ["del modal viejo"]});
await p1;
out.trasViejo = {nuevoOff: nuevo.disabled, orbeVivo: !!orbe && ORBES["orbe-b3"] === orbe,
                 titulos: $("b3titulos").innerHTML, viejoOff: viejo.disabled};
soltar2({titulos: ["nuevo"]});
await p2;
out.trasNuevo = {nuevoOff: nuevo.disabled, orbe: "orbe-b3" in ORBES,
                 titulos: $("b3titulos").innerHTML};

// lo mismo con Publicar: el POST viejo no revive el botón del POST nuevo
let soltarA, soltarB;
rutas["api/publicar/agendar"] = [() => new Promise(r => soltarA = r),
                                 () => new Promise(r => soltarB = r)];
llenar();
const envioViejo = els.b3agendar;
const pa = envioViejo.onclick();
b3cerrar();
await abrir();
llenar();
const envioNuevo = els.b3agendar;
const pb = envioNuevo.onclick();
out.dosPosts = posts();
soltarA({publicacion: {...VISTA, id: "viejo"}});
await pa;
out.trasPostViejo = {nuevoOff: envioNuevo.disabled, pubs: ids()};
soltarB({publicacion: {...VISTA, id: "nuevo"}});
await pb;
out.trasPostNuevo = {nuevoOff: envioNuevo.disabled, pubs: ids()};

// si el modal reabierto no tiene formulario, la respuesta vieja no revienta
let soltar3;
rutas["api/publicar/titulos"] = [() => new Promise(r => soltar3 = r)];
const p3 = els.b3sugerir.onclick();
b3cerrar();
await abrir(ESTADO({blotato: false}));
out.sinFormulario = $("b3sugerir") === null && $("b3agendar") === null;
soltar3({titulos: ["x"]});
await p3;
out.sinError = true;
""", tmp_path)
    assert o["otroBoton"] is True
    assert o["trasViejo"] == {"nuevoOff": True, "orbeVivo": True, "titulos": "", "viejoOff": False}, \
        "la petición vieja rehabilitó el botón nuevo o apagó su orbe"
    assert o["trasNuevo"] == {"nuevoOff": False, "orbe": False,
                              "titulos": '<button type="button">nuevo</button>'}
    assert o["dosPosts"] == 2
    assert o["trasPostViejo"] == {"nuevoOff": True, "pubs": []}
    assert o["trasPostNuevo"] == {"nuevoOff": False, "pubs": ["nuevo"]}
    assert o["sinFormulario"] is True and o["sinError"] is True


@pytest.mark.parametrize("detalle", [
    "Ya tienes 2 publicaciones subiéndose. Espera a que terminen y vuelve a intentarlo.",  # 429
    "Esa cuenta no está conectada en tu Blotato. Vuelve a abrir Publicar.",                # 422
])
def test_un_rechazo_del_servidor_se_lee_y_deja_el_boton_listo(tmp_path, detalle):
    o = _node(f"""
await abrir();
llenar();
rutas["api/publicar/agendar"] = [new Error({json.dumps(detalle)}),
                                 {{publicacion: {{...VISTA, id: "ok"}}}}];
await els.b3agendar.onclick();
out.rechazo = {{msg: els.b3msg.textContent, err: els.b3msg.className,
               off: els.b3agendar.disabled, pubs: ids(), vivos: vivos().length}};
await els.b3agendar.onclick();
out.otraVez = {{posts: posts(), pubs: ids(), msg: els.b3msg.textContent}};
""", tmp_path)
    assert o["rechazo"] == {"msg": detalle, "err": "err", "off": False, "pubs": [], "vivos": 0}
    assert o["otraVez"] == {"posts": 2, "pubs": ["ok"], "msg": "Enviado: sigue el avance abajo"}


def test_el_aviso_de_starter_no_bloquea(tmp_path):
    o = _node(r"""
const PESADA = {clave: "pelicula", nombre: "pelicula.mp4", mb: 612.5};
await abrir(ESTADO({descargables: [PESADA]}));
out.aviso = {oculto: els.b3peso.hidden, texto: els.b3peso.textContent};
llenar();
rutas["api/publicar/agendar"] = [{publicacion: {...VISTA, id: "p"}}];
await els.b3agendar.onclick();
out.envio = {posts: posts(), msg: els.b3msg.textContent, confirm: confirmados.at(-1)};

// una liviana no avisa
await abrir();
out.liviana = {oculto: els.b3peso.hidden, texto: els.b3peso.textContent};

// si la red tiene su propio tope, ese manda (y ese sí bloquea)
const TT = {id: "T1", platform: "tiktok", fullname: "Yo", username: "yo"};
await abrir(ESTADO({descargables: [PESADA]}), CUENTAS([TT]));
out.red = els.b3peso.textContent;

// un servidor sin max_mb_starter no inventa el tope
await abrir(ESTADO({descargables: [PESADA], max_mb_starter: undefined}));
out.sinTope = els.b3peso.hidden;
""", tmp_path)
    starter = ("Pesa 612.5 MB: con el plan Starter de Blotato el límite es 400 MB "
               "(Creator y Agency: 1 GB).")
    assert o["aviso"] == {"oculto": False, "texto": starter}
    assert o["envio"]["posts"] == 1, "el aviso de Starter no puede impedir el envío"
    assert o["envio"]["msg"] == "Enviado: sigue el avance abajo"
    assert o["envio"]["confirm"].endswith("Ojo: " + starter)
    assert o["liviana"] == {"oculto": True, "texto": ""}
    assert o["red"] == "Este video pesa 612.5 MB y TikTok acepta hasta 287 MB: elige otro archivo."
    assert o["sinTope"] is True


def test_el_contador_cuenta_bytes_donde_la_red_los_cuenta(tmp_path):
    o = _node(r"""
const TT = {id: "T1", platform: "tiktok", fullname: "Yo", username: "yo"};
await abrir(ESTADO(), CUENTAS([CUENTA, TT]));
out.techo = els.b3texto.maxLength;
els.b3texto.value = "ñandú 😀";
els.b3texto.oninput();
out.yt = {texto: els.b3contador.textContent, clase: els.b3contador.className};
els.b3texto.value = "á".repeat(2501);
els.b3texto.oninput();
out.ytLargo = {texto: els.b3contador.textContent, clase: els.b3contador.className};
els.b3cuenta.value = "1";
els.b3cuenta.onchange();
out.tt = {texto: els.b3contador.textContent, clase: els.b3contador.className,
          techo: els.b3texto.maxLength};
""", tmp_path)
    assert o["techo"] == 5000, "el límite en caracteres queda solo como techo"
    assert o["yt"] == {"texto": "12 / 5000 bytes", "clase": ""}
    assert o["ytLargo"] == {"texto": "5002 / 5000 bytes", "clase": "err"}
    assert o["tt"] == {"texto": "2501 / 2200", "clase": "err", "techo": 2200}


def test_al_abrir_revisa_una_sola_vez_lo_que_pide_revision(tmp_path):
    o = _node(r"""
// una programada de hace días: /estado no pregunta a Blotato
const P = {...VISTA, id: "p", estado: "programado", en_curso: false, revisar: true,
           cuando: "2026-09-10T15:00:00+00:00"};
const Q = {...VISTA, id: "q", estado: "publicado", en_curso: false, revisar: false};
rutas["api/publicar/publicaciones"] = [{publicaciones: [
  {...P, estado: "fallido", revisar: false, mensaje: "Blotato no pudo publicarla. Puedes intentarlo de nuevo."}, Q]}];
await abrir(ESTADO({publicaciones: [P, Q]}));
out.una = {consultas: consultas(), vivos: vivos().length, pubs: B3PUBS.map(p => [p.id, p.estado]),
           html: els.b3lista.innerHTML, redes: llamadas.includes("api/publicar/cuentas")};

// nada que revisar: ninguna consulta
let c0 = consultas();
await abrir(ESTADO({publicaciones: [Q]}));
out.nada = consultas() - c0;

// algo en curso: ya pregunta el sondeo, no se consulta aparte
c0 = consultas();
await abrir(ESTADO({publicaciones: [{...VISTA, id: "c"}, P]}));
out.enCurso = {consultas: consultas() - c0, vivos: vivos().length};
b3cerrar();

// la red caída no revienta ni deja nada vivo
c0 = consultas();
rutas["api/publicar/publicaciones"] = [new Error("sin red")];
await abrir(ESTADO({publicaciones: [P]}));
out.caida = {consultas: consultas() - c0, vivos: vivos().length, pubs: ids()};

// si lo revisado quedó en curso, se sigue como siempre
rutas["api/publicar/publicaciones"] = [{publicaciones: [{...P, estado: "enviado", en_curso: true}]}];
await abrir(ESTADO({publicaciones: [P]}));
out.quedoEnCurso = vivos().length;
b3cerrar();

// un envío que vuelve mientras tanto gana: la revisión vieja no lo borra
let soltar;
rutas["api/publicar/publicaciones"] = [() => new Promise(r => soltar = r)];
await abrir(ESTADO({publicaciones: [P]}));
llenar();
rutas["api/publicar/agendar"] = [{publicacion: {...VISTA, id: "b"}}];
await els.b3agendar.onclick();
soltar({publicaciones: [{...P, estado: "publicado", revisar: false}]});
await esperar();
out.envioGana = {ids: ids(), vivos: vivos().length};
b3cerrar();

// y un modal cerrado no se pinta
rutas["api/publicar/publicaciones"] = [() => new Promise(r => soltar = r)];
await abrir(ESTADO({publicaciones: [P]}));
b3cerrar();
soltar({publicaciones: []});
await esperar();
out.cerrado = ids();
""", tmp_path)
    assert o["una"]["consultas"] == 1
    assert o["una"]["vivos"] == 0, "la revisión no deja un intervalo vivo"
    assert o["una"]["pubs"] == [["p", "fallido"], ["q", "publicado"]]
    assert "Blotato la rechazó" in o["una"]["html"]
    assert o["una"]["redes"] is True, "la revisión no frena la carga de las redes"
    assert o["nada"] == 0
    assert o["enCurso"] == {"consultas": 0, "vivos": 1}
    assert o["caida"] == {"consultas": 1, "vivos": 0, "pubs": ["p"]}
    assert o["quedoEnCurso"] == 1
    assert o["envioGana"] == {"ids": ["b", "p"], "vivos": 1}
    assert o["cerrado"] == ["p"]


# ---------------------------------------------------------------------------
# los atajos del editor no se comen lo que se escribe

TECLADO_STUBS = r"""
"use strict";
let handler = null, abierto = null;
const hechos = [];
const document = {
  addEventListener: (tipo, fn) => { if (tipo === "keydown") handler = fn; },
  querySelector: sel => abierto && sel.split(",").map(s => s.trim()).includes(`#${abierto}.abierto`)
    ? {id: abierto} : null,
};
const vid = {paused: true, currentTime: 5,
             play() { hechos.push("play"); }, pause() { hechos.push("pause"); }};
const undo = () => hechos.push("undo"), redo = () => hechos.push("redo");
const seek = () => hechos.push("seek"), cutSelection = () => hechos.push("corte");
const drawSelMarks = () => hechos.push("marca"), setStatus = () => {}, g2 = x => x;
let selIn = null, selOut = null, pps = 7;
const rebuildZoom = () => hechos.push("zoom");
const $ = id => ({click: () => hechos.push("click " + id),
                  set value(v) { hechos.push("valor " + id); },
                  classList: {toggle: () => hechos.push("ayuda"), remove: () => hechos.push("ayuda")}});
"""

TECLADO_ESCENARIO = r"""
const TECLAS = [" ", "c", "C", "i", "o", "e", "E", "ArrowLeft", "ArrowRight", ",", ".", "+", "=",
                "-", "?", "Escape", {key: "z", ctrlKey: true}, {key: "Z", ctrlKey: true, shiftKey: true},
                {key: "y", ctrlKey: true}, {key: "z", metaKey: true}];
const pulsar = target => TECLAS.flatMap(t => {
  const antes = hechos.length;
  handler({target, ctrlKey: false, metaKey: false, shiftKey: false,
           ...(typeof t === "string" ? {key: t} : t),
           preventDefault() { hechos.push("preventDefault"); }});
  return hechos.slice(antes);
});
const out = {};
out.cuerpo = pulsar({tagName: "BODY"});
out.textarea = pulsar({tagName: "TEXTAREA"});
out.input = pulsar({tagName: "INPUT"});
out.editable = pulsar({tagName: "SPAN", isContentEditable: true});
for (const m of ["b3modal", "b1modal", "g1modal"]) {
  abierto = m;
  out[m] = {boton: pulsar({tagName: "BUTTON"}), mascota: pulsar({tagName: "DIV"}),
            cuerpo: pulsar({tagName: "BODY"}), textarea: pulsar({tagName: "TEXTAREA"})};
}
abierto = "otroModal";
out.otro = pulsar({tagName: "BODY"}).length;
console.log(JSON.stringify(out));
"""


def test_el_teclado_respeta_los_campos_y_los_modales(tmp_path):
    nodo = shutil.which("node")
    if not nodo:
        pytest.skip("node no está en el PATH")
    assert ('const MODALES_ABIERTOS = "#b3modal.abierto, #b1modal.abierto, #g1modal.abierto";'
            in TECLADO)
    f = tmp_path / "teclado.js"
    f.write_text(TECLADO_STUBS + TECLADO + TECLADO_ESCENARIO, encoding="utf-8")
    r = subprocess.run([nodo, str(f)], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    o = json.loads(r.stdout)
    # el arnés funciona: sin campo ni modal, los atajos actúan
    assert {"preventDefault", "play", "corte", "undo", "redo", "seek", "ayuda",
            "click modeBtn", "zoom"} <= set(o["cuerpo"])
    for campo in ("textarea", "input", "editable"):
        assert o[campo] == [], f"en un {campo} las teclas dispararon {o[campo]}"
    for m in ("b3modal", "b1modal", "g1modal"):
        assert o[m] == {"boton": [], "mascota": [], "cuerpo": [], "textarea": []}, \
            f"con {m} abierto las teclas llegaron al editor: {o[m]}"
    assert o["otro"] > 0
