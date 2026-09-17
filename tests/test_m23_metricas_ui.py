"""M23 C4 · Métricas — la pantalla static/metricas.html (paso 3 de 3).

Lo que este archivo defiende:
  * que nada de lo que llega de Blotato o del servidor entre a un innerHTML sin
    escapar — y aquí hay un texto peor que los de la Agenda: `error_red`, que
    lo redacta la red social y no Blotato;
  * que la pantalla no arranque antes que /auth.js, o el primer fetch saldría
    sin Authorization y volvería 401;
  * que no haya sondeo: el cupo del usuario son 60 llamadas por minuto y el
    modal de Publicar ya gasta hasta 3 por carga;
  * que cambiar entre «Recientes» y «Las más vistas» NO gaste una llamada: las
    dos vienen de la misma respuesta;
  * que «Ver más» mande el tramo junto al cursor (un cursor con otra ventana
    devuelve cualquier cosa) y que se apague cuando ya no se puede retroceder;
  * que un fallo no borre lo ya pintado ni pise el cursor;
  * que la misma publicación repetida entre dos tramos ACTUALICE su tarjeta en
    vez de añadir otra igual debajo;
  * que un contador que no llegó se vea como un hueco y NUNCA como un cero;
  * que los textos que el usuario lee los escriba el servidor.

Sin red: el HTML se lee como texto y la lógica corre en node con un DOM mínimo
(se salta si no hay node).
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
PANTALLA = (RAIZ / "static" / "metricas.html").read_text(encoding="utf-8")
HUB = (RAIZ / "static" / "index.html").read_text(encoding="utf-8")

INICIO = "// ── mt · Métricas (C4)"


def _tramo(desde: str, hasta: str, texto: str) -> str:
    i = texto.index(desde)
    return texto[i:texto.index(hasta, i)]


MT = _tramo(INICIO, "</script>", PANTALLA)
AYUDANTES = _tramo("function esc(s)", "// ── mt · textos", MT)
ARRANQUE = MT[MT.index("// ── mt · arranque"):]


def _plano(s: str) -> str:
    return " ".join(s.split())


# ---------------------------------------------------------------------------
# XSS

def test_existe_esc_y_escapa_los_cinco_caracteres():
    assert "function esc(s)" in PANTALLA
    for par in ('"&": "&amp;"', '"<": "&lt;"', '">": "&gt;"', "'\"': \"&quot;\"",
                "\"'\": \"&#39;\""):
        assert par in AYUDANTES, f"esc no escapa {par}"


def _plantillas_html() -> list[str]:
    fuera = [m.group(0) for m in re.finditer(r"\.innerHTML\s*=.*?;\n", MT, re.S)]
    fuera += [linea for linea in MT.splitlines() if re.search(r"<[a-z]", linea)]
    return fuera


# Interpolaciones que NO son datos externos: HTML que estas mismas funciones
# acaban de armar (y cuyas hojas ya pasaron por esc), y una clase que depende
# de un booleano nuestro. Si alguna vez dejan de estarlo, la prueba de arriba
# no las vería: por eso van enumeradas y no por un patrón.
INTERNAS = {"casillas",                      # mtNumeros: casillas ya escapadas
            "cuando",                        # mtNumeros: lleva esc(mtFecha(…)) dentro
            "filas",                         # mtTabla: filas ya escapadas
            "pares",                         # mtDetalle: pares ya escapados
            "mtDetalle(it)",                 # HTML de esta misma pantalla
            'fallida ? " mtFallo" : ""'}     # una clase, no un dato


def test_ningun_innerhtml_interpola_datos_sin_escapar():
    plantillas = _plantillas_html()
    hojas = [_plano(e) for p in plantillas for e in re.findall(r"\$\{([^{}]*)\}", p)]
    assert len(hojas) >= 12, "el recorte dejó de encontrar las plantillas: no vería nada"
    for e in hojas:
        assert e.startswith("esc(") or e in INTERNAS, \
            f"interpolación sin escapar en un innerHTML: ${{{e}}}"


def test_el_error_que_redacta_la_red_va_escapado():
    """Es el texto menos fiable de la pantalla: no lo escribe Blotato, lo
    escribe la red social."""
    assert "${esc(it.error_red)}" in MT


def test_la_pantalla_no_carga_nada_del_cdn_de_blotato():
    """El servidor manda el CONTEO de adjuntos, nunca sus URLs."""
    assert "mediaUrl" not in PANTALLA
    assert "<img" not in PANTALLA


def test_el_enlace_a_la_publicacion_no_le_regala_la_pestaña_a_nadie():
    assert 'rel="noopener noreferrer"' in PANTALLA


# ---------------------------------------------------------------------------
# el orden de carga y el cupo

def test_auth_js_va_antes_del_script_inline():
    assert PANTALLA.index('src="/auth.js"') < PANTALLA.index(INICIO)
    assert PANTALLA.index('src="/monedero.js"') < PANTALLA.index(INICIO)


def test_todo_el_arranque_va_dentro_de_domcontentloaded():
    assert 'document.addEventListener("DOMContentLoaded"' in ARRANQUE
    assert re.search(r"^mtCargar\(", MT, re.M) is None


def test_la_pantalla_no_hace_poll():
    """Sin sondeo: el cupo son 60 llamadas por minuto y esta pantalla no tiene
    nada que esperar — Blotato mide por tandas, no porque se lo pidamos."""
    assert "setInterval" not in MT
    assert "setTimeout" not in MT


def _codigo(js: str) -> str:
    """El JS sin las líneas de comentario: los comentarios SÍ hablan de lo que
    la pantalla no hace, y buscarlos ahí daría un falso positivo."""
    return "\n".join(l for l in js.splitlines() if not l.strip().startswith("//"))


def test_el_boton_no_promete_actualizar_los_numeros():
    """Ningún endpoint de Blotato fuerza una medición nueva: un botón que
    dijera «Actualizar los números» mentiría."""
    assert "Ver números" in MT
    assert "Actualizar los números" not in _codigo(MT)


# ---------------------------------------------------------------------------
# el menú del hub

def test_el_hub_enlaza_metricas_y_ya_no_dice_proximamente():
    linea = next(l for l in HUB.splitlines() if "Ver mis métricas" in l)
    assert 'href="/metricas.html"' in linea
    assert 'class="prox"' not in linea


# ---------------------------------------------------------------------------
# la lógica, en node

PRELUDIO = r"""
"use strict";
// Un DOM mínimo: los nodos se crean al pedirlos y los botones de la lista se
// leen del innerHTML que mtPintar acaba de escribir.
const els = new Proxy({}, {
  get: (t, k) => typeof k === "string" ? (t[k] || (t[k] = new Nodo(k))) : t[k],
});
class Nodo {
  constructor(id) {
    Object.assign(this, {id, hidden: false, disabled: false, dataset: {},
      onclick: null, _html: "", _texto: "", _attrs: {}});
  }
  get innerHTML() { return this._html; }
  set innerHTML(h) { this._html = String(h); }
  get textContent() { return this._texto; }
  set textContent(t) { this._texto = String(t); }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return this._attrs[k]; }
}
const el = id => els[id];
const botones = {};
function botonesDe(html) {
  return [...html.matchAll(/data-mt="([^"]+)" data-i="([^"]+)"/g)].map(m => {
    const clave = m[1] + ":" + m[2];
    const b = botones[clave] || (botones[clave] = new Nodo(null));
    b.dataset = {mt: m[1], i: m[2]};
    return b;
  });
}
let arranque = null;
const document = {
  querySelector: sel => el(String(sel).replace(/^#/, "")),
  querySelectorAll: sel => sel === "#mtLista [data-mt]"
    ? botonesDe(el("mtLista").innerHTML) : [],
  addEventListener: (tipo, fn) => { if (tipo === "DOMContentLoaded") arranque = fn; },
};
const window = {};
let respuestas = [], llamadas = [];
const OK = cuerpo => ({status: 200, cuerpo});
const FALLO = (status, detail) => ({status, cuerpo: {detail}});
async function fetch(url) {
  llamadas.push(String(url));
  let r = respuestas.shift();
  if (typeof r === "function") r = await r();
  if (r instanceof Error) throw r;
  r = r || {};
  const status = r.status || 200;
  return {ok: status >= 200 && status < 300, status,
          json: async () => (r.cuerpo === undefined ? {} : r.cuerpo)};
}
// El contrato de cada item de GET /api/metricas, completo
const ITEM = (extra = {}) => ({id: "1", plataforma: "instagram", red: "Instagram",
  cuando: "2026-09-12T00:50:49Z", estado: "publicado", enlace: "https://x/1",
  error_red: "", texto: "hola", cortado: false, medios: 1, numeros: null,
  detalle: [], medido: "", historial: [], medicion: "no_medido",
  motivo: "Blotato no guardó números de esta publicación.", puede_pedir: false,
  ...extra});
const NUMS = {vistas: 306, me_gusta: 9, comentarios: 2, compartidos: 1};
const PAGINA = (extra = {}) => ({items: [], mejores: [], cursor: null,
  desde: "2026-08-18T00:00:00Z", hasta: "2026-09-17T00:00:00Z",
  ultimo_tramo: false, hay_lista: true, hay_numeros: true, truncado: false,
  error: null, reconectar: false, ...extra});
"""


def _node(escenario: str, tmp_path: Path) -> dict:
    nodo = shutil.which("node")
    if not nodo:
        pytest.skip("node no está en el PATH")
    codigo = (PRELUDIO + MT +
              "\n(async () => {\nconst out = {};\n" + escenario +
              "\nconsole.log(JSON.stringify(out));\n})()"
              ".catch(e => { console.error(e); process.exit(1); });\n")
    f = tmp_path / "mt.js"
    f.write_text(codigo, encoding="utf-8")
    r = subprocess.run([nodo, str(f)], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_esc_escapa_los_cinco_en_node(tmp_path):
    o = _node(r"""
out.todo = esc(`<img src="x" onerror='alert(1)'>&`);
out.nulo = esc(null); out.num = esc(3);
""", tmp_path)
    assert o["todo"] == "&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;"
    assert o["nulo"] == "" and o["num"] == "3"


def test_un_contador_que_no_llego_es_un_hueco_y_no_un_cero(tmp_path):
    """«No lo informa» y «cero» son cosas distintas: un 0 inventado le diría al
    usuario que su publicación no gustó a nadie."""
    o = _node(r"""
out.mil = mtNum(1234567); out.cero = mtNum(0);
out.nulo = mtNum(null); out.texto = mtNum("306"); out.nan = mtNum(NaN);
""", tmp_path)
    assert o["mil"].replace(" ", " ").replace("\xa0", " ") == "1,234,567"
    assert o["cero"] == "0"
    assert o["nulo"] == "" and o["texto"] == "" and o["nan"] == ""


def test_las_casillas_vacias_no_se_pintan(tmp_path):
    """Una casilla con un guion parece un cero. La red que no informó un
    contador simplemente no tiene esa casilla."""
    o = _node(r"""
out.con = mtNumeros(ITEM({numeros: {vistas: 306, me_gusta: null,
                                    comentarios: null, compartidos: null}}));
out.sin = mtNumeros(ITEM({numeros: null}));
""", tmp_path)
    assert "Vistas" in o["con"] and "Me gusta" not in o["con"]
    assert o["sin"] == ""


def test_una_bajada_se_enseña_como_bajada(tmp_path):
    """Las redes corrigen sus conteos hacia abajo: taparlo sería enseñar algo
    que la red no dijo."""
    o = _node(r"""
const h = c => ITEM({historial: c.map(([cuando, vistas]) =>
  ({cuando, numeros: {vistas}}))});
out.sube = mtDelta(h([["2026-09-01T00:00:00Z", 100], ["2026-09-10T00:00:00Z", 140]]));
out.baja = mtDelta(h([["2026-09-01T00:00:00Z", 140], ["2026-09-10T00:00:00Z", 100]]));
out.una = mtDelta(h([["2026-09-01T00:00:00Z", 100]]));
out.ninguna = mtDelta(ITEM());
""", tmp_path)
    assert o["sube"].startswith("+40 vistas")
    assert o["baja"].startswith("−40 vistas")
    assert o["una"] == "Una sola medición." and o["ninguna"] == ""


def test_los_milisegundos_no_se_enseñan_como_numero(tmp_path):
    o = _node(r"""
out.seg = mtDuracion(10074); out.min = mtDuracion(2055192);
out.nada = mtDuracion(null);
out.ratio = mtValor({tipo: "ratio", valor: 0.125});
""", tmp_path)
    assert o["seg"] == "10 s" and "min" in o["min"]
    assert o["nada"] == "" and o["ratio"].startswith("0")


def test_ver_mas_manda_el_tramo_pegado_al_cursor(tmp_path):
    """Pedirle a Blotato otra ventana con el cursor de la anterior devuelve
    cualquier cosa."""
    o = _node(r"""
respuestas = [OK(PAGINA({items: [ITEM()], cursor: "c2"})),
              OK(PAGINA({items: [ITEM({id: "2"})], cursor: null})),
              OK(PAGINA({items: [], cursor: null}))];
await mtCargar();
await mtCargar(true);      // con cursor: mismo tramo
await mtCargar(true);      // sin cursor: retrocede
out.llamadas = llamadas;
""", tmp_path)
    assert o["llamadas"][0] == "/api/metricas"
    assert "cursor=c2" in o["llamadas"][1] and "hasta=" in o["llamadas"][1]
    assert "cursor" not in o["llamadas"][2] and "desde=" in o["llamadas"][2]


def test_ver_mas_se_apaga_en_el_ultimo_tramo(tmp_path):
    o = _node(r"""
respuestas = [OK(PAGINA({items: [ITEM()], cursor: null, ultimo_tramo: true}))];
await mtCargar();
out.oculto = el("mtMas").hidden;
""", tmp_path)
    assert o["oculto"] is True


def test_la_misma_publicacion_en_dos_tramos_no_se_duplica(tmp_path):
    """Los tramos se encadenan por fecha y Blotato reordena por postTime: la
    segunda vez ACTUALIZA la tarjeta, no añade otra igual debajo."""
    o = _node(r"""
out.unido = mtUnir([ITEM({id: "1", texto: "viejo"}), ITEM({id: "2"})],
                   [ITEM({id: "1", texto: "nuevo"}), ITEM({id: "3"})])
  .map(it => [it.id, it.texto]);
""", tmp_path)
    assert o["unido"] == [["1", "nuevo"], ["2", "hola"], ["3", "hola"]]


def test_un_fallo_no_borra_lo_ya_pintado_ni_pisa_el_cursor(tmp_path):
    o = _node(r"""
respuestas = [OK(PAGINA({items: [ITEM()], cursor: "c2"})),
              OK(PAGINA({items: [], cursor: null, hay_lista: false,
                         hay_numeros: false, error: "Blotato no respondió."}))];
await mtCargar();
await mtCargar();
out.items = MTREC.length; out.cursor = MTCURSOR;
out.aviso = el("mtErr").innerHTML;
""", tmp_path)
    assert o["items"] == 1 and o["cursor"] == "c2"
    assert "Blotato no respondió." in o["aviso"]


def test_cambiar_de_vista_no_gasta_una_llamada(tmp_path):
    """«Las más vistas» y «Recientes» vienen de la MISMA respuesta."""
    o = _node(r"""
respuestas = [OK(PAGINA({items: [ITEM()], mejores: [ITEM({id: "9"})]}))];
await mtCargar();
const antes = llamadas.length;
mtVer("top"); mtVer("rec"); mtVer("top");
out.extra = llamadas.length - antes;
out.pintado = el("mtLista").innerHTML.includes("1.");
""", tmp_path)
    assert o["extra"] == 0 and o["pintado"] is True


def test_una_carga_pedida_mientras_hay_otra_se_encola(tmp_path):
    o = _node(r"""
let abrir; const puerta = new Promise(r => { abrir = r; });
respuestas = [async () => { await puerta; return OK(PAGINA({items: [ITEM()]})); },
              OK(PAGINA({items: [ITEM({id: "2"})]}))];
const a = mtCargar();
const b = mtCargar();          // llega mientras la primera está en vuelo
abrir();
await a; await b;
out.llamadas = llamadas.length;
out.ids = MTREC.map(i => i.id);
""", tmp_path)
    assert o["llamadas"] == 2 and o["ids"] == ["2"]


def test_pedir_numeros_escribe_en_las_dos_listas_y_apaga_el_boton(tmp_path):
    """La misma publicación puede estar en las dos vistas: lo que costó una
    llamada no se pierde al cambiar de vista."""
    o = _node(r"""
respuestas = [OK(PAGINA({items: [ITEM({id: "7", puede_pedir: true,
                                       medicion: "sin_consultar"})],
                         mejores: [ITEM({id: "7", puede_pedir: true,
                                         medicion: "sin_consultar"})]})),
              OK({id: "7", medicion: "medido", numeros: NUMS, detalle: [],
                  historial: [], medido: "2026-09-13T01:41:40Z", motivo: ""})];
await mtCargar();
await mtPedir({}, MTREC[0]);
out.rec = MTREC[0].numeros.vistas;
out.top = MTTOP[0].numeros.vistas;
out.pedir = MTREC[0].puede_pedir;
out.llamadas = llamadas.length;
""", tmp_path)
    assert o["rec"] == 306 and o["top"] == 306
    assert o["pedir"] is False and o["llamadas"] == 2


def test_ver_numeros_no_se_puede_pulsar_dos_veces_aunque_se_repinte(tmp_path):
    """Apagar el botón en el nodo no basta: cambiar de pestaña o desplegar otra
    tarjeta repinta la lista y lo revivía. El usuario impaciente se ganaba un
    429 que se había provocado él, sobre números que ya venían en camino."""
    o = _node(r"""
let abrir; const puerta = new Promise(r => { abrir = r; });
respuestas = [OK(PAGINA({items: [ITEM({id: "7", puede_pedir: true,
                                       medicion: "sin_consultar"})]})),
              async () => { await puerta; return OK({id: "7", medicion: "medido",
                numeros: NUMS, detalle: [], historial: [], medido: "", motivo: ""}); }];
await mtCargar();
const p = mtPedir({}, MTREC[0]);      // en vuelo
mtVer("top"); mtVer("rec");           // dos repintados a mitad de camino
out.apagado = botonesDe(el("mtLista").innerHTML).every(b => b.disabled);
out.leyenda = el("mtLista").innerHTML.includes("Preguntando…");
await mtPedir({}, MTREC[0]);          // un segundo clic no puede salir
abrir(); await p;
out.llamadas = llamadas.length;
""", tmp_path)
    assert o["apagado"] is True and o["leyenda"] is True
    assert o["llamadas"] == 2, "el segundo clic gastó otra llamada"


def test_la_pantalla_no_redacta_los_mensajes_del_servidor(tmp_path):
    """Los motivos los escribe server/metricas_api.py (MOTIVOS). Si la pantalla
    los copiara, habría dos verdades que mantener."""
    for texto in ("Blotato no guardó", "aún no la ha medido", "no recoge números de LinkedIn"):
        assert texto not in PANTALLA


def test_un_fallo_duro_tampoco_borra_lo_ya_pintado_ni_el_cursor(tmp_path):
    """El 500 de la Lambda y el «Failed to fetch» del navegador entran por el
    catch, no por `hay_lista`: sin prueba, ese camino podía tirar la lista."""
    o = _node(r"""
respuestas = [OK(PAGINA({items: [ITEM()], cursor: "c2"})),
              FALLO(500, "Se rompió algo."),
              new TypeError("Failed to fetch")];
await mtCargar();
await mtCargar();
out.tras500 = {items: MTREC.length, cursor: MTCURSOR, aviso: el("mtErr").innerHTML};
await mtCargar();
out.trasRed = {items: MTREC.length, cursor: MTCURSOR, aviso: el("mtErr").innerHTML};
""", tmp_path)
    assert o["tras500"]["items"] == 1 and o["tras500"]["cursor"] == "c2"
    assert "Se rompió algo." in o["tras500"]["aviso"]
    assert o["trasRed"]["items"] == 1 and o["trasRed"]["cursor"] == "c2"
    # el «Failed to fetch» del navegador viene en inglés: no se le enseña a nadie
    assert "Failed to fetch" not in o["trasRed"]["aviso"]


def test_un_fallo_de_la_lista_no_vacia_las_mas_vistas(tmp_path):
    """Quien está mirando sus diez mejores no puede quedarse en blanco porque
    fallara la OTRA llamada: son dos y fallan por separado."""
    o = _node(r"""
respuestas = [OK(PAGINA({items: [ITEM()], mejores: [ITEM({id: "9"})]})),
              OK(PAGINA({items: [], mejores: [], hay_lista: false, hay_numeros: false,
                         error: "Blotato no respondió."}))];
await mtCargar();
mtVer("top");
await mtCargar();
out.lista = el("mtLista").innerHTML;
out.top = MTTOP.length;
""", tmp_path)
    assert o["top"] == 1
    assert "No pudimos traer" not in o["lista"], "vació una vista que sí tenía datos"


def test_las_mas_vistas_llevan_su_propio_tramo(tmp_path):
    """Si los números fallan mientras la lista retrocede, el rótulo seguiría al
    tramo nuevo y les pondría la fecha de otro mes a unos números que no son
    de ahí."""
    o = _node(r"""
respuestas = [OK(PAGINA({items: [ITEM()], mejores: [ITEM({id: "9"})]})),
              OK(PAGINA({items: [ITEM({id: "2"})], hay_numeros: false, mejores: [],
                         desde: "2026-07-18T00:00:00Z", hasta: "2026-08-18T00:00:00Z"}))];
await mtCargar();
await mtCargar(true);
mtVer("top");
out.top = el("mtVentana").textContent;
mtVer("rec");
out.rec = el("mtVentana").textContent;
""", tmp_path)
    # las fechas se pintan en la zona del navegador, así que se compara el mes
    assert "de julio" not in o["top"], "los números del tramo viejo con fecha del nuevo"
    assert "de julio" in o["rec"]


def test_ver_mas_no_borra_unos_numeros_que_ya_se_pagaron(tmp_path):
    """La misma publicación vuelve en la página siguiente sin números (por eso
    tenía botón). Pisarla dejaba un detalle abierto diciendo que no hay nada
    que enseñar, y el botón para volver a pagar lo mismo."""
    o = _node(r"""
out.unido = mtUnir(
  [ITEM({id: "1", numeros: {vistas: 306, me_gusta: 9, comentarios: 2, compartidos: 1},
         medicion: "medido", motivo: "", detalle: [{etiqueta: "Vistas", valor: 306}]})],
  [ITEM({id: "1", numeros: null, detalle: [], medicion: "sin_consultar",
         puede_pedir: true})])
  .map(it => [it.id, it.numeros && it.numeros.vistas, it.puede_pedir, it.medicion]);
""", tmp_path)
    assert o["unido"] == [["1", 306, False, "medido"]]


def test_el_aviso_del_recorte_no_es_un_error_y_lo_escribe_el_servidor(tmp_path):
    """Iba en rojo, con role="alert", y con el «100» escrito en la pantalla. Y
    con un `else if` desaparecía justo cuando además había un error, que es
    cuando más falta hace explicar por qué hay tarjetas sin números."""
    o = _node(r"""
respuestas = [OK(PAGINA({items: [ITEM()], truncado: true,
                         aviso: "Blotato solo nos dio los números de las 100 más vistas.",
                         error: "Blotato pide esperar un momento."}))];
await mtCargar();
out.nota = el("mtNota").textContent;
out.err = el("mtErr").innerHTML;
""", tmp_path)
    assert "100 más vistas" in o["nota"]
    assert "esperar" in o["err"] and "100" not in o["err"]


def test_la_pantalla_no_escribe_el_tope_de_blotato():
    """El 100 es del servidor (blotato.ANALITICAS_MAX). Duplicarlo aquí deja dos
    verdades que mantener."""
    assert "100 más vistas" not in _codigo(MT)
