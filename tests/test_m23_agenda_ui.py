"""C3 · Agenda — la pantalla static/agenda.html.

Lo que este archivo defiende:
  * que nada de lo que llega de Blotato o del servidor (la red, la cuenta, el
    texto del post, los mensajes de error) entre a un innerHTML sin escapar:
    la cookie `token` se lee desde JavaScript y la pantalla es pública;
  * que la pantalla no arranque antes que /auth.js, o el primer fetch saldría
    sin Authorization y volvería 401;
  * que el <dialog> lleve margin:auto (el reset `* { margin: 0 }` se lo quita
    y el diálogo se pega arriba a la izquierda);
  * que cambiar la hora JAMÁS mande `draft`: el PATCH de Blotato no fusiona, y
    un draft parcial deja una publicación programada SIN video;
  * que el botón de cancelar se apague DESPUÉS del confirm (decir «no» no
    puede dejarlo muerto) y que «Ver más» concatene en vez de repintar;
  * que un fallo de Blotato JAMÁS borre lo ya pintado ni pise el cursor y el
    total: decirle «no tienes nada programado» a quien tiene doce es mentirle,
    y un 429 al pulsar «Ver más» no puede dejar 20 de 45 sin forma de seguir;
  * que una recarga pedida mientras hay otra en curso se encole en vez de
    tirarse (cancelar dos tarjetas seguidas perdía la segunda recarga);
  * que la ventana de la pantalla sea la MISMA que la del servidor
    (server/publicar_api.py): aceptar una hora que él rechaza gasta una llamada
    para nada;
  * que lo irreversible no pase en silencio: tras cancelar o cambiar la hora se
    anuncia en el cuadro de avisos (role="status") y el foco vuelve a un sitio con nombre;
  * que los textos que el usuario lee los escriba el servidor: la pantalla no
    copia ni un mensaje de pipeline.blotato ni de pipeline.publicaciones.

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
AGENDA = (RAIZ / "static" / "agenda.html").read_text(encoding="utf-8")
EDITOR = (RAIZ / "tools" / "editor" / "index.html").read_text(encoding="utf-8")

INICIO_AG = "// ── ag · Agenda (C3)"


def _tramo(desde: str, hasta: str, texto: str) -> str:
    i = texto.index(desde)
    return texto[i:texto.index(hasta, i)]


AG = _tramo(INICIO_AG, "</script>", AGENDA)              # todo el JS de la pantalla
AYUDANTES = _tramo("function esc(s)", "// ── ag · lógica", AG)
LOGICA = _tramo("// ── ag · lógica", "// ── ag · arranque", AG)
ARRANQUE = AG[AG.index("// ── ag · arranque"):]


def _plano(s: str) -> str:
    return " ".join(s.split())


# ---------------------------------------------------------------------------
# XSS: todo dato externo que llega a un innerHTML pasa por esc()

def test_existe_esc_y_escapa_los_cinco_caracteres():
    assert "function esc(s)" in AGENDA
    for par in ('"&": "&amp;"', '"<": "&lt;"', '">": "&gt;"', "'\"': \"&quot;\"", "\"'\": \"&#39;\""):
        assert par in AYUDANTES, f"esc no escapa {par}"


# Interpolaciones que NO son datos externos: el índice del botón es un número
# nuestro. Va escapado igual, pero si algún día deja de estarlo no es un XSS.
INTERNAS: set[str] = set()


def _plantillas_html() -> list[str]:
    """Cada `x.innerHTML = …;` del JS, y cada línea que arma una etiqueta fuera
    de esa asignación (las tarjetas de agTarjeta, la fila del diálogo)."""
    fuera = [m.group(0) for m in re.finditer(r"\.innerHTML\s*=.*?;\n", AG, re.S)]
    fuera += [linea for linea in AG.splitlines() if re.search(r"<[a-z]", linea)]
    return fuera


def test_ningun_innerhtml_interpola_datos_sin_escapar():
    plantillas = _plantillas_html()
    hojas = [_plano(e) for p in plantillas for e in re.findall(r"\$\{([^{}]*)\}", p)]
    assert len(hojas) >= 12, "el recorte dejó de encontrar las plantillas: la prueba no vería nada"
    for e in hojas:
        assert e.startswith("esc(") or e in INTERNAS, \
            f"interpolación sin escapar en un innerHTML: ${{{e}}}"


def test_la_pantalla_no_carga_nada_del_cdn_de_blotato():
    """El servidor manda el CONTEO de adjuntos, nunca sus URLs: una pantalla
    pública no tiene por qué pedirle assets a Blotato."""
    assert "profileImageUrl" not in AGENDA
    assert "mediaUrl" not in AGENDA
    assert "<img" not in AGENDA


# ---------------------------------------------------------------------------
# el orden de carga y el molde del diálogo

def test_auth_js_va_antes_del_script_inline():
    """auth.js envuelve fetch para colgarle el Authorization. Si el script
    inline va antes, su primera llamada sale sin cabecera y vuelve 401."""
    assert AGENDA.index('src="/auth.js"') < AGENDA.index(INICIO_AG)
    assert AGENDA.index('src="/monedero.js"') < AGENDA.index(INICIO_AG)


def test_todo_el_arranque_va_dentro_de_domcontentloaded():
    assert 'document.addEventListener("DOMContentLoaded"' in ARRANQUE
    # la única carga inicial vive dentro del manejador, no suelta en el script
    assert re.search(r"^agCargar\(", AG, re.M) is None


def test_el_dialogo_lleva_margin_auto():
    """El `* { margin: 0 }` del reset se lo quita al <dialog>: sin margin:auto
    el diálogo se pega a la esquina de arriba a la izquierda."""
    estilo = _tramo("#agDlg {", "}", AGENDA)
    assert "margin: auto" in estilo
    assert "#agDlg::backdrop" in AGENDA


def test_la_agenda_no_hace_poll():
    """Una llamada a Blotato por carga: el modal de Publicar ya gasta hasta 3
    GET /posts y el límite es 60/min por usuario."""
    assert "setInterval" not in AG
    assert "setTimeout" not in AG


# ---------------------------------------------------------------------------
# lo que la Agenda NO manda

def _codigo(js: str) -> str:
    """El JS sin las líneas de comentario: los comentarios SÍ hablan de lo que
    la pantalla no hace (el draft), y buscarlos ahí daría un falso positivo."""
    return "\n".join(l for l in js.splitlines() if not l.strip().startswith("//"))


def test_cambiar_la_hora_nunca_manda_draft():
    """El PATCH de Blotato no fusiona: un draft parcial borra mediaUrls y deja
    programada una publicación sin video."""
    assert "draft" not in _codigo(AG)
    cuerpo = _tramo("await fj(\"/api/agenda/reprogramar\"", ");", LOGICA)
    # `it` es el item capturado AL ABRIR el diálogo, no el AGACTUAL del momento:
    # abrir otra publicación mientras esta viaja no puede reprogramar la otra
    assert "id: it.id" in cuerpo and "cuando" in cuerpo
    assert "const it = AGACTUAL" in LOGICA
    assert cuerpo.count(":") == 2          # cuerpo: { id, cuando } y nada más


def test_cancelar_manda_el_confirmar_del_gate():
    assert "confirmar: true" in LOGICA


# ---------------------------------------------------------------------------
# los textos los escribe el servidor

def _mensajes_reales() -> dict:
    """Los mensajes que de verdad manda el servidor, no unos inventados."""
    import httpx
    from pipeline import blotato, publicaciones
    pedido = httpx.Request("DELETE", "https://backend.blotato.com/v2/schedules/sch_1")
    ya_no = httpx.HTTPStatusError("x", request=pedido,
                                  response=httpx.Response(404, request=pedido))
    return {
        "reprogramar_404": blotato.explicar_fallo(ya_no, contexto="reprogramar")[0],
        "cancelar_404": blotato.explicar_fallo(ya_no, contexto="cancelar")[0],
        "agenda_404": blotato.explicar_fallo(ya_no, contexto="agenda")[0],
        "cancelado": publicaciones.MENSAJES["cancelado"],
    }


def test_la_pantalla_no_copia_los_mensajes_del_servidor():
    """Los textos de error viven en pipeline/blotato.py y llegan en `detail`.
    Copiarlos aquí los dejaría desincronizados en cuanto cambie uno."""
    for clave, mensaje in _mensajes_reales().items():
        assert mensaje, f"{clave} se quedó sin texto"
        assert mensaje not in AGENDA, f"la pantalla copió el mensaje de {clave}"


def test_el_409_es_lo_unico_que_ofrece_conectar_blotato():
    """La pantalla no decide QUÉ decir (eso es del servidor), solo si además
    ofrece el enlace para conectar la cuenta."""
    assert "status === 409" in LOGICA
    assert '/estudio/?blotato=conectar' in LOGICA


# ---------------------------------------------------------------------------
# la lógica, en node

PRELUDIO = r"""
"use strict";
// Un DOM mínimo: los nodos se crean al pedirlos y los botones de la lista se
// leen del innerHTML que agPintar acaba de escribir (que es justo lo que hace
// el navegador con document.querySelectorAll("#agLista [data-ag]")).
const els = new Proxy({}, {
  get: (t, k) => typeof k === "string" ? (t[k] || (t[k] = new Nodo(k))) : t[k],
});
let foco = null;   // el último nodo que recibió focus()
class Nodo {
  constructor(id) {
    Object.assign(this, {id, hidden: false, disabled: false, value: "", min: "",
      open: false, dataset: {}, onclick: null, _html: "", _texto: "", _eventos: {}});
  }
  get innerHTML() { return this._html; }
  set innerHTML(h) { this._html = String(h); }
  insertAdjacentHTML(donde, h) {
    if (donde !== "beforeend") throw new Error("solo se usa beforeend: " + donde);
    this._html += String(h);
  }
  get textContent() { return this._texto; }
  set textContent(t) { this._texto = String(t); }
  addEventListener(tipo, fn) { (this._eventos[tipo] = this._eventos[tipo] || []).push(fn); }
  getBoundingClientRect() { return {left: 0, top: 0, right: 100, bottom: 100}; }
  // el <dialog> de verdad expone .open y dispara «close» al cerrarse, venga el
  // cierre del usuario (✕, Esc, el fondo) o del propio código
  showModal() { this.abierto = true; this.open = true; }
  close() {
    const estaba = this.open;
    this.abierto = false; this.open = false;
    if (estaba) (this._eventos.close || []).forEach(f => f());
  }
  disparar(tipo, ev) { (this._eventos[tipo] || []).forEach(f => f(ev)); }
  focus() { foco = this.id; }
}
const el = id => els[id];
// los botones de la lista, tal como los pintó agTarjeta
const botones = {};
function botonesDe(html) {
  return [...html.matchAll(/data-ag="([^"]+)" data-i="([^"]+)"/g)].map(m => {
    const clave = m[1] + ":" + m[2];
    const b = botones[clave] || (botones[clave] = new Nodo(null));
    b.dataset = {ag: m[1], i: m[2]};
    return b;
  });
}
let arranque = null;
const document = {
  querySelector: sel => el(String(sel).replace(/^#/, "")),
  querySelectorAll: sel => sel === "#agLista [data-ag]" ? botonesDe(el("agLista").innerHTML) : [],
  addEventListener: (tipo, fn) => { if (tipo === "DOMContentLoaded") arranque = fn; },
};
// el cuadro de avisos de trabajos.js (UI·16): se guarda lo último por clave
// y todo lo que se mostró, en orden
const vivos = {}, mostrados = [];
const location = {href: ""};
const window = {avisos: {
  mostrar(texto, op = {}) { const a = {texto, ...op}; mostrados.push(a);
                            if (a.clave) vivos[a.clave] = a; return mostrados.length; },
  quitar(c) { delete vivos[c]; },
}};
const aviso = c => (vivos[c] ? vivos[c].texto : "");
let confirmar = true;
const confirmados = [];
function confirm(texto) { confirmados.push(texto); return confirmar; }
const esperar = () => new Promise(r => setImmediate(r));
// las respuestas: una cola por URL (sin querystring) y una cola general detrás
let respuestas = [], llamadas = [], cuerpos = [];
const rutas = {};
const OK = cuerpo => ({status: 200, cuerpo});
const FALLO = (status, detail) => ({status, cuerpo: {detail}});
async function fetch(url, init) {
  llamadas.push(String(url));
  cuerpos.push(init && init.body ? JSON.parse(init.body) : null);
  const cola = rutas[String(url).split("?")[0]];
  let r = (cola && cola.length) ? cola.shift() : respuestas.shift();
  // una función puede ser async: así se deja una respuesta colgando (una
  // petición en vuelo) y se mira qué hace la pantalla mientras tanto
  if (typeof r === "function") r = await r();
  if (r instanceof Error) throw r;
  r = r || {};
  const status = r.status || 200;
  return {ok: status >= 200 && status < 300, status,
          json: async () => (r.cuerpo === undefined ? {} : r.cuerpo)};
}
// El contrato de cada item de GET /api/agenda, completo:
// {id, cuando, plataforma, red, cuenta_nombre, destino, texto, cortado, medios}
const ITEM = (extra = {}) => ({id: "sch_1", cuando: "2031-01-15T16:30:00+00:00",
  plataforma: "tiktok", red: "TikTok", cuenta_nombre: "@ana", destino: "",
  texto: "hola", cortado: false, medios: 1, ...extra});
// una puerta para dejar una petición en vuelo hasta que la prueba la suelte
function puerta() {
  let abrir;
  const p = new Promise(r => { abrir = r; });
  return {espera: p, abrir};
}
"""


def _node(escenario: str, tmp_path: Path, cabeza: str = "") -> dict:
    nodo = shutil.which("node")
    if not nodo:
        pytest.skip("node no está en el PATH")
    codigo = (PRELUDIO + cabeza + AG +
              "\n(async () => {\nconst out = {};\n" + escenario +
              "\nconsole.log(JSON.stringify(out));\n})()"
              ".catch(e => { console.error(e); process.exit(1); });\n")
    f = tmp_path / "ag.js"
    f.write_text(codigo, encoding="utf-8")
    r = subprocess.run([nodo, str(f)], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_esc_escapa_los_cinco_en_node(tmp_path):
    o = _node(r"""
out.todo = esc(`<img src="x" onerror='alert(1)'>&`);
out.nulo = esc(null); out.indef = esc(undefined); out.num = esc(3);
""", tmp_path)
    assert o["todo"] == "&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;"
    assert o["nulo"] == "" and o["indef"] == "" and o["num"] == "3"


def test_la_validacion_de_fecha_no_gasta_una_llamada(tmp_path):
    o = _node(r"""
const ahora = Date.parse("2026-09-17T12:00:00Z");
out.vacia = agValidar("", ahora);
out.ilegible = agValidar("no es una fecha", ahora);
out.pasado = agValidar("2020-01-01T10:00", ahora);
out.futuro = agValidar("2031-01-01T10:00", ahora);
// y por el camino de verdad: guardar con una hora pasada no llama a nadie
AGACTUAL = ITEM();
els.agHora.value = "2020-01-01T10:00";
await agGuardarHora({currentTarget: els.agGuardar});
out.aviso = els.agDlgErr.textContent;
out.oculto = els.agDlgErr.hidden;
out.llamadas = llamadas.length;
out.boton = els.agGuardar.disabled;
""", tmp_path)
    assert o["vacia"] == "Elige la fecha y hora."
    assert o["ilegible"] == "Esa fecha no es válida."
    assert o["pasado"] == "Esa hora ya pasó: elige una más adelante."
    assert o["futuro"] is None
    assert o["aviso"] == "Esa hora ya pasó: elige una más adelante."
    assert o["oculto"] is False
    assert o["llamadas"] == 0, "una fecha imposible no debe salir a Blotato"
    assert o["boton"] is False, "el botón se quedó apagado sin haber enviado nada"


def test_el_boton_de_cancelar_se_apaga_despues_del_confirm(tmp_path):
    o = _node(r"""
rutas["/api/agenda"] = [OK({items: [ITEM()], cursor: null, total: 1})];
await agCargar();
const btn = document.querySelectorAll("#agLista [data-ag]").find(b => b.dataset.ag === "cancelar");
out.confirmaAntes = confirmados.length;

// 1) decir «no» en el confirm: ni llamada ni botón muerto
confirmar = false;
await btn.onclick({currentTarget: btn});
out.noLlamadas = llamadas.length;         // sigue siendo 1 (la carga inicial)
out.noBoton = btn.disabled;
out.confirmado = confirmados[0];

// 2) decir «sí»: el botón está apagado MIENTRAS viaja la petición
confirmar = true;
rutas["/api/agenda/cancelar"] = [() => { out.durante = btn.disabled; return OK({}); }];
rutas["/api/agenda"] = [OK({items: [], cursor: null, total: 0})];
await btn.onclick({currentTarget: btn});
out.despues = btn.disabled;
out.cuerpo = cuerpos[llamadas.indexOf("/api/agenda/cancelar")];
out.recargo = llamadas.filter(u => u === "/api/agenda").length;
out.vacio = els.agLista.innerHTML.includes("No tienes nada programado");
""", tmp_path)
    assert o["confirmaAntes"] == 0, "el confirm no puede salir al pintar la lista"
    assert o["noLlamadas"] == 1 and o["noBoton"] is False
    assert "¿Cancelar esta publicación?" in o["confirmado"]
    assert "TikTok" in o["confirmado"] and "@ana" in o["confirmado"]
    assert o["durante"] is True, "el botón no se apagó: dos clics = dos DELETE"
    assert o["despues"] is False
    assert o["cuerpo"] == {"id": "sch_1", "confirmar": True}
    assert o["recargo"] == 2 and o["vacio"] is True


def test_ver_mas_concatena_y_no_repinta(tmp_path):
    o = _node(r"""
rutas["/api/agenda"] = [OK({items: [ITEM({id: "sch_1"})], cursor: "c1", total: 3})];
await agCargar();
out.primera = els.agLista.innerHTML;
out.masVisible = !els.agMas.hidden;
out.resumen = els.agResumen.textContent;

rutas["/api/agenda"] = [OK({items: [ITEM({id: "sch_2", cuenta_nombre: ""})],
                            cursor: null, total: 3})];
await agCargar(true);
out.segunda = els.agLista.innerHTML;
out.url = llamadas[1];
out.items = AGITEMS.map(i => i.id);
out.masOculto = els.agMas.hidden;
// los botones nuevos apuntan a SU item, no al primero
const bs = document.querySelectorAll("#agLista [data-ag]");
out.indices = bs.map(b => b.dataset.i);
""", tmp_path)
    assert o["masVisible"] is True
    assert o["resumen"] == "3 publicaciones programadas"
    assert o["segunda"].startswith(o["primera"]), "«Ver más» repintó lo ya cargado"
    assert o["segunda"].count("<li class=\"tarjeta\">") == 2
    assert o["url"] == "/api/agenda?cursor=c1"
    assert o["items"] == ["sch_1", "sch_2"]
    assert o["masOculto"] is True
    assert o["indices"] == ["0", "0", "1", "1"]


def test_el_404_al_reprogramar_cierra_el_dialogo_y_repinta(tmp_path):
    """El mensaje es el del servidor, tal cual: la pantalla no lo reescribe."""
    real = _mensajes_reales()["reprogramar_404"]
    o = _node(f"""
rutas["/api/agenda"] = [OK({{items: [ITEM()], cursor: null, total: 1}})];
await agCargar();
const btn = document.querySelectorAll("#agLista [data-ag]").find(b => b.dataset.ag === "hora");
btn.onclick();
out.abierto = !!els.agDlg.abierto;
els.agHora.value = "2031-02-01T10:00";
rutas["/api/agenda/reprogramar"] = [FALLO(404, {json.dumps(real)})];
rutas["/api/agenda"] = [OK({{items: [], cursor: null, total: 0}})];
await agGuardarHora({{currentTarget: els.agGuardar}});
out.cerrado = !els.agDlg.abierto;
out.aviso = aviso("agenda-error");
out.avisoDlg = els.agDlgErr.textContent;
out.cuerpo = cuerpos[llamadas.indexOf("/api/agenda/reprogramar")];
out.recargas = llamadas.filter(u => u === "/api/agenda").length;
""", tmp_path)
    assert o["abierto"] is True and o["cerrado"] is True
    assert o["aviso"] == real, "la pantalla reescribió el mensaje del servidor"
    assert o["avisoDlg"] == "", "el aviso va en la pantalla, no en un diálogo ya cerrado"
    assert set(o["cuerpo"]) == {"id", "cuando"}, "el PATCH llevaría algo más que la hora"
    assert o["cuerpo"]["id"] == "sch_1"
    assert o["cuerpo"]["cuando"].endswith("Z"), "la hora tiene que viajar en UTC"
    assert o["recargas"] == 2


def test_el_409_ofrece_conectar_blotato(tmp_path):
    o = _node(r"""
rutas["/api/agenda"] = [FALLO(409, "Conecta tu cuenta de Blotato primero.")];
await agCargar();
out.aviso = aviso("agenda-error");
out.accion = vivos["agenda-error"].accion.texto;
vivos["agenda-error"].accion.al();
out.destino = location.href;
out.lista = els.agLista.innerHTML;
rutas["/api/agenda"] = [FALLO(502, "Blotato no respondió a tiempo.")];
await agCargar();
out.otro = aviso("agenda-error");
out.otraAccion = vivos["agenda-error"].accion && vivos["agenda-error"].accion.texto;
""", tmp_path)
    assert o["accion"] == "Conectar Blotato" and o["destino"] == "/estudio/?blotato=conectar"
    assert "Conecta tu cuenta de Blotato primero." in o["aviso"]
    assert "Pulsa «Actualizar»" in o["lista"]
    assert o["otraAccion"] != "Conectar Blotato", "un fallo de Blotato no es una clave que falte"


def test_el_404_al_cancelar_recarga_y_luego_avisa(tmp_path):
    """Primero repintar, después el aviso: agCargar limpia el aviso al empezar,
    así que avisar antes lo borraría el repintado."""
    real = _mensajes_reales()["cancelar_404"]
    o = _node(f"""
rutas["/api/agenda"] = [OK({{items: [ITEM()], cursor: null, total: 1}})];
await agCargar();
const btn = document.querySelectorAll("#agLista [data-ag]").find(b => b.dataset.ag === "cancelar");
rutas["/api/agenda/cancelar"] = [FALLO(404, {json.dumps(real)})];
rutas["/api/agenda"] = [OK({{items: [], cursor: null, total: 0}})];
await btn.onclick({{currentTarget: btn}});
out.aviso = aviso("agenda-error");
out.recargas = llamadas.filter(u => u === "/api/agenda").length;
out.lista = els.agLista.innerHTML;
""", tmp_path)
    assert o["aviso"] == real, "el repintado se comió el aviso"
    assert o["recargas"] == 2
    assert "No tienes nada programado" in o["lista"]


# ---------------------------------------------------------------------------
# un fallo de Blotato no puede borrar lo que el usuario ya está viendo

FALLO_BLANDO = ('OK({items: [], cursor: null, total: null, '
                'error: "Blotato no respondió a tiempo."})')


def test_el_fallo_blando_no_borra_lo_ya_pintado(tmp_path):
    """El servidor responde 200 con items:[] y `error` cuando Blotato falla.
    Jurarle al usuario que no tiene nada programado cuando tiene doce es la
    peor mentira que puede decir esta pantalla."""
    o = _node(r"""
rutas["/api/agenda"] = [OK({items: [ITEM({id: "a"}), ITEM({id: "b"})],
                            cursor: "c1", total: 45})];
await agCargar();
out.antes = els.agLista.innerHTML;
out.resumenAntes = els.agResumen.textContent;

rutas["/api/agenda"] = [""" + FALLO_BLANDO + r"""];
await agCargar();
out.despues = els.agLista.innerHTML;
out.items = AGITEMS.map(i => i.id);
out.resumen = els.agResumen.textContent;
out.cursor = AGCURSOR;
out.mas = !els.agMas.hidden;
out.aviso = aviso("agenda-error");
""", tmp_path)
    assert o["despues"] == o["antes"], "el fallo blando repintó (y borró) la lista"
    assert "No tienes nada programado" not in o["despues"]
    assert "Pulsa «Actualizar»" not in o["despues"], "tapó las tarjetas con la caída"
    assert o["items"] == ["a", "b"]
    assert o["resumen"] == o["resumenAntes"] == "45 publicaciones programadas"
    assert o["cursor"] == "c1", "el total y el cursor se pisaron con los null del fallo"
    assert o["mas"] is True
    assert "Blotato no respondió a tiempo." in o["aviso"]


def test_el_fallo_blando_con_la_lista_vacia_pinta_la_caida_no_el_vacio(tmp_path):
    """AGCAIDA se escribió justo para esto: sin este camino era inalcanzable."""
    o = _node("rutas[\"/api/agenda\"] = [" + FALLO_BLANDO + r"""];
await agCargar();
out.lista = els.agLista.innerHTML;
out.aviso = aviso("agenda-error");
""", tmp_path)
    assert "Pulsa «Actualizar»" in o["lista"]
    assert "No tienes nada programado" not in o["lista"], \
        "un fallo no es una agenda vacía"
    assert "Blotato no respondió a tiempo." in o["aviso"]


def test_ver_mas_que_falla_conserva_las_tarjetas_y_el_cursor(tmp_path):
    """Un 429 pasajero al pulsar «Ver más» no puede dejar 20 de 45 sin botón
    para seguir. Se prueban los dos fallos: el blando (200 + error) y el duro."""
    o = _node(r"""
rutas["/api/agenda"] = [OK({items: [ITEM({id: "a"})], cursor: "c1", total: 45})];
await agCargar();

// 1) fallo blando al pedir la página siguiente
rutas["/api/agenda"] = [""" + FALLO_BLANDO + r"""];
await agCargar(true);
out.blandoCursor = AGCURSOR;
out.blandoMas = !els.agMas.hidden;
out.blandoTarjetas = (els.agLista.innerHTML.match(/<li class="tarjeta">/g) || []).length;
out.blandoResumen = els.agResumen.textContent;

// 2) fallo duro (429) al pedirla otra vez
rutas["/api/agenda"] = [FALLO(429, "Demasiadas peticiones. Espera un momento.")];
await agCargar(true);
out.duroCursor = AGCURSOR;
out.duroMas = !els.agMas.hidden;
out.duroTarjetas = (els.agLista.innerHTML.match(/<li class="tarjeta">/g) || []).length;
out.duroResumen = els.agResumen.textContent;
out.duroAviso = aviso("agenda-error");

// 3) y la página siguiente de verdad sigue estando a un clic
rutas["/api/agenda"] = [OK({items: [ITEM({id: "b"})], cursor: null, total: 45})];
await agCargar(true);
out.url = llamadas[llamadas.length - 1];
out.items = AGITEMS.map(i => i.id);
out.finMas = !els.agMas.hidden;
""", tmp_path)
    assert o["blandoCursor"] == "c1" and o["duroCursor"] == "c1"
    assert o["blandoMas"] is True and o["duroMas"] is True, "se quedó sin «Ver más»"
    assert o["blandoTarjetas"] == 1 and o["duroTarjetas"] == 1
    assert o["blandoResumen"] == o["duroResumen"] == "45 publicaciones programadas"
    assert "Demasiadas peticiones" in o["duroAviso"]
    assert o["url"] == "/api/agenda?cursor=c1"
    assert o["items"] == ["a", "b"]
    assert o["finMas"] is False, "una última página legítima sí apaga «Ver más»"


def test_la_ultima_pagina_vacia_sin_error_apaga_ver_mas(tmp_path):
    o = _node(r"""
rutas["/api/agenda"] = [OK({items: [ITEM({id: "a"})], cursor: "c1", total: 1})];
await agCargar();
out.antes = !els.agMas.hidden;
rutas["/api/agenda"] = [OK({items: [], cursor: null, total: 1})];
await agCargar(true);
out.despues = !els.agMas.hidden;
out.tarjetas = (els.agLista.innerHTML.match(/<li class="tarjeta">/g) || []).length;
out.vacio = els.agLista.innerHTML.includes("No tienes nada programado");
""", tmp_path)
    assert o["antes"] is True and o["despues"] is False
    assert o["tarjetas"] == 1 and o["vacio"] is False


# ---------------------------------------------------------------------------
# el candado de las recargas

def test_una_recarga_pedida_mientras_carga_se_encola(tmp_path):
    """Cancelar dos tarjetas seguidas perdía la segunda recarga (`if (AGCARGANDO)
    return;`) y la lista seguía enseñando algo que ya no existe."""
    o = _node(r"""
const p = puerta();
rutas["/api/agenda"] = [
  async () => { await p.espera; return OK({items: [ITEM({id: "vieja"})], cursor: null, total: 1}); },
  OK({items: [ITEM({id: "nueva"})], cursor: null, total: 1}),
];
const a = agCargar();
const b = agCargar();          // llega mientras la primera viaja
const c = agCargar();          // y otra más: solo se guarda la última
out.enVuelo = llamadas.length;
p.abrir();
await a; await b; await c;
out.llamadas = llamadas.filter(u => u === "/api/agenda").length;
out.items = AGITEMS.map(i => i.id);
out.html = els.agLista.innerHTML.includes("nueva") || AGITEMS[0].id;
""", tmp_path)
    assert o["enVuelo"] == 1, "la segunda recarga salió en paralelo: dos tirones a Blotato"
    assert o["llamadas"] == 2, "la recarga encolada se tiró a la basura"
    assert o["items"] == ["nueva"], "la lista se quedó con lo viejo"


def test_los_botones_se_apagan_mientras_recarga(tmp_path):
    o = _node(r"""
rutas["/api/agenda"] = [OK({items: [ITEM()], cursor: "c1", total: 2})];
await agCargar();
const btn = document.querySelectorAll("#agLista [data-ag]")[0];
out.antes = btn.disabled;

const p = puerta();
rutas["/api/agenda"] = [async () => { await p.espera;
  return OK({items: [ITEM()], cursor: null, total: 1}); }];
const carga = agCargar();
out.durante = btn.disabled;
out.refrescar = els.agRefrescar.disabled;
out.mas = els.agMas.disabled;
p.abrir();
await carga;
out.despues = document.querySelectorAll("#agLista [data-ag]")[0].disabled;
out.refrescarDespues = els.agRefrescar.disabled;
""", tmp_path)
    assert o["antes"] is False
    assert o["durante"] is True, "se puede cancelar una tarjeta que está a punto de cambiar"
    assert o["refrescar"] is True and o["mas"] is True
    assert o["despues"] is False and o["refrescarDespues"] is False


# ---------------------------------------------------------------------------
# la ventana de la pantalla es la del servidor

def _margen_servidor() -> int:
    """El margen que exige server/publicar_api.py (_cuando)."""
    src = (RAIZ / "server" / "publicar_api.py").read_text(encoding="utf-8")
    m = re.search(r"t < ahora \+ (\d+)", src)
    assert m, "cambió la validación de la hora en el servidor: revisa _cuando"
    return int(m.group(1))


def test_la_pantalla_no_acepta_una_hora_que_el_servidor_rechaza(tmp_path):
    """La pantalla aceptaba una hora a 10 segundos vista y el servidor la
    rechazaba: una llamada gastada para que le digan que no."""
    margen = _margen_servidor()
    assert f"const AGMARGEN_S = {margen};" in AG, \
        f"el servidor exige {margen} s de margen y la pantalla usa otro"
    o = _node(f"""
const ahora = Date.parse("2026-09-17T12:00:00Z");
const en = s => new Date(ahora + s * 1000).toISOString();
out.margen = AGMARGEN_S;
out.diez = agValidar(en(10), ahora);
out.justoAntes = agValidar(en({margen} - 1), ahora);
out.justo = agValidar(en({margen}), ahora);
out.holgado = agValidar(en({margen} + 60), ahora);
// y por el camino de verdad (con el reloj real): no sale ni una llamada
AGACTUAL = ITEM();
els.agHora.value = new Date(Date.now() + 10000).toISOString();
await agGuardarHora({{currentTarget: els.agGuardar}});
out.llamadas = llamadas.length;
out.aviso = els.agDlgErr.textContent;
""", tmp_path)
    assert o["margen"] == margen
    assert o["diez"] and o["justoAntes"], f"la pantalla acepta menos de {margen} s"
    assert o["justo"] is None and o["holgado"] is None, "la pantalla es más dura que el servidor"
    assert o["llamadas"] == 0
    assert o["aviso"] == o["diez"]


def test_el_minimo_del_campo_tambien_lleva_el_margen(tmp_path):
    o = _node(r"""
rutas["/api/agenda"] = [OK({items: [ITEM()], cursor: null, total: 1})];
await agCargar();
document.querySelectorAll("#agLista [data-ag]").find(b => b.dataset.ag === "hora").onclick();
out.min = els.agHora.min;
out.piso = agLocal(new Date(Date.now() + AGMARGEN_S * 1000));
out.ahora = agLocal(new Date());
""", tmp_path)
    assert o["min"] == o["piso"] >= o["ahora"]


# ---------------------------------------------------------------------------
# el diálogo: cerrarlo mientras guarda, y las respuestas tardías

def test_cerrar_el_dialogo_mientras_guarda_enseña_el_fallo_en_la_pantalla(tmp_path):
    """#agGuardar se apagaba, pero la ✕, Esc y el fondo seguían vivos y el
    mensaje acababa escrito dentro de un diálogo ya cerrado."""
    o = _node(r"""
rutas["/api/agenda"] = [OK({items: [ITEM()], cursor: null, total: 1})];
await agCargar();
document.querySelectorAll("#agLista [data-ag]").find(b => b.dataset.ag === "hora").onclick();
els.agHora.value = "2031-02-01T10:00";
const p = puerta();
rutas["/api/agenda/reprogramar"] = [async () => { await p.espera;
  return FALLO(502, "Blotato no respondió a tiempo."); }];
const guardando = agGuardarHora({currentTarget: els.agGuardar});
els.agDlg.close();            // la ✕ / Esc / el fondo, mientras viaja
p.abrir();
await guardando;
out.dlg = els.agDlgErr.textContent;
out.pantalla = aviso("agenda-error");
out.abierto = !!els.agDlg.open;
out.boton = els.agGuardar.disabled;
""", tmp_path)
    assert o["dlg"] == "", "el mensaje se escribió en un diálogo que ya no está"
    assert "Blotato no respondió a tiempo." in o["pantalla"]
    assert o["abierto"] is False and o["boton"] is False


def test_una_respuesta_tardia_no_cierra_el_dialogo_de_otra_publicacion(tmp_path):
    o = _node(r"""
rutas["/api/agenda"] = [OK({items: [ITEM({id: "a"}), ITEM({id: "b", cuando: "2031-03-01T10:00:00+00:00"})],
                            cursor: null, total: 2})];
await agCargar();
const horas = document.querySelectorAll("#agLista [data-ag]").filter(b => b.dataset.ag === "hora");
horas[0].onclick();
els.agHora.value = "2031-02-01T10:00";
const p = puerta();
rutas["/api/agenda/reprogramar"] = [async () => { await p.espera; return OK({}); }];
rutas["/api/agenda"] = [OK({items: [ITEM({id: "a"}), ITEM({id: "b"})], cursor: null, total: 2})];
const guardando = agGuardarHora({currentTarget: els.agGuardar});

els.agDlg.close();            // el usuario cierra y abre el de la OTRA
horas[1].onclick();
els.agHora.value = "2031-12-24T09:00";   // y escribe una hora nueva
p.abrir();
await guardando;
out.abierto = !!els.agDlg.open;
out.valor = els.agHora.value;
out.actual = AGACTUAL && AGACTUAL.id;
out.foco = foco;
out.cuerpo = cuerpos[llamadas.indexOf("/api/agenda/reprogramar")];
""", tmp_path)
    assert o["abierto"] is True, "la respuesta tardía cerró el diálogo de otra publicación"
    assert o["valor"] == "2031-12-24T09:00", "y tiró lo que el usuario había escrito"
    assert o["foco"] != "agRefrescar", "le robó el foco al diálogo abierto"
    assert o["actual"] == "b"
    assert o["cuerpo"]["id"] == "a", "reprogramó la publicación equivocada"


def test_el_fondo_no_cierra_el_dialogo_recien_abierto(tmp_path):
    """Doble clic en «Cambiar la hora»: el segundo clic cae sobre el backdrop
    del diálogo que el primero acaba de abrir. Parecía un botón muerto."""
    o = _node(r"""
rutas["/api/agenda"] = [OK({items: [ITEM()], cursor: null, total: 1})];
arranque();                       // los manejadores del diálogo viven ahí
await esperar(); await esperar();
document.querySelectorAll("#agLista [data-ag]").find(b => b.dataset.ag === "hora").onclick();
out.abierto = !!els.agDlg.open;

const fuera = {target: els.agDlg, clientX: 500, clientY: 500};
els.agDlg.disparar("pointerdown", fuera);
els.agDlg.disparar("click", fuera);
out.trasElSegundoClic = !!els.agDlg.open;

AGABIERTO = Date.now() - 5000;    // pasada la gracia, el fondo sí cierra
els.agDlg.disparar("pointerdown", fuera);
els.agDlg.disparar("click", fuera);
out.trasLaGracia = !!els.agDlg.open;
out.gracia = AGGRACIA_MS;
""", tmp_path)
    assert o["abierto"] is True
    assert o["trasElSegundoClic"] is True, "el segundo clic del doble clic cerró el diálogo"
    assert o["trasLaGracia"] is False, "el fondo dejó de cerrar el diálogo"
    assert 200 <= o["gracia"] <= 600


# ---------------------------------------------------------------------------
# lo irreversible se anuncia, y en español

def test_cancelar_anuncia_el_resultado_y_devuelve_el_foco(tmp_path):
    o = _node(r"""
rutas["/api/agenda"] = [OK({items: [ITEM()], cursor: null, total: 1})];
await agCargar();
const btn = document.querySelectorAll("#agLista [data-ag]").find(b => b.dataset.ag === "cancelar");
rutas["/api/agenda/cancelar"] = [OK({})];
rutas["/api/agenda"] = [OK({items: [], cursor: null, total: 0})];
foco = null;
await btn.onclick({currentTarget: btn});
out.estado = mostrados[mostrados.length - 1];
out.foco = foco;
""", tmp_path)
    assert o["estado"] == {"texto": "Publicación cancelada.", "tipo": "ok"}
    assert o["foco"] == "agRefrescar", "el foco se fue al <body>: la acción pasó en silencio"


def test_cambiar_la_hora_anuncia_el_resultado_y_devuelve_el_foco(tmp_path):
    o = _node(r"""
rutas["/api/agenda"] = [OK({items: [ITEM()], cursor: null, total: 1})];
await agCargar();
document.querySelectorAll("#agLista [data-ag]").find(b => b.dataset.ag === "hora").onclick();
els.agHora.value = "2031-02-01T10:00";
rutas["/api/agenda/reprogramar"] = [OK({})];
rutas["/api/agenda"] = [OK({items: [ITEM({cuando: "2031-02-01T10:00:00Z"})], cursor: null, total: 1})];
foco = null;
await agGuardarHora({currentTarget: els.agGuardar});
out.estado = mostrados[mostrados.length - 1];
out.foco = foco;
out.cerrado = !els.agDlg.open;
""", tmp_path)
    assert o["estado"]["texto"].startswith("Hora cambiada:") and "TikTok" in o["estado"]["texto"]
    # 'ok' se va solo a los 5 s: el anuncio viejo no se queda pegado
    assert o["estado"]["tipo"] == "ok" and "clave" not in o["estado"]
    assert o["foco"] == "agRefrescar" and o["cerrado"] is True


def test_la_region_viva_existe_en_el_html():
    # UI·16: el anuncio va al cuadro de avisos de trabajos.js, que lleva el role
    assert 'src="/trabajos.js"' in AGENDA
    assert 'id="agEstado"' not in AGENDA


def test_sin_conexion_el_mensaje_esta_en_espanol(tmp_path):
    """fetch rechaza con un TypeError que SÍ trae message («Failed to fetch»),
    en inglés y del navegador: AGSINRED era inalcanzable."""
    o = _node(r"""
rutas["/api/agenda"] = [new TypeError("Failed to fetch")];
await agCargar();
out.lista = aviso("agenda-error");

// y dentro del diálogo, igual
rutas["/api/agenda"] = [OK({items: [ITEM()], cursor: null, total: 1})];
await agCargar();
document.querySelectorAll("#agLista [data-ag]").find(b => b.dataset.ag === "hora").onclick();
els.agHora.value = "2031-02-01T10:00";
rutas["/api/agenda/reprogramar"] = [new TypeError("Failed to fetch")];
await agGuardarHora({currentTarget: els.agGuardar});
out.dlg = els.agDlgErr.textContent;
""", tmp_path)
    for donde in ("lista", "dlg"):
        assert "Failed to fetch" not in o[donde], f"{donde}: el mensaje del navegador, en inglés"
        assert "No pudimos hablar con el servidor" in o[donde]


# ---------------------------------------------------------------------------
# el contrato nuevo del item: destino, cortado y medios

def test_el_destino_se_ve_en_la_tarjeta_el_confirm_y_el_dialogo(tmp_path):
    """Sin el destino, dos páginas de la MISMA cuenta de Facebook son idénticas
    en pantalla y el usuario puede cancelar la equivocada."""
    o = _node(r"""
rutas["/api/agenda"] = [OK({items: [ITEM({red: "Facebook", cuenta_nombre: "Ana",
                                          destino: "Página 1110000001"})],
                            cursor: null, total: 1})];
await agCargar();
out.tarjeta = els.agLista.innerHTML;
const bs = document.querySelectorAll("#agLista [data-ag]");
bs.find(b => b.dataset.ag === "hora").onclick();
out.dialogo = els.agDlgQue.innerHTML;
els.agDlg.close();
confirmar = false;
await bs.find(b => b.dataset.ag === "cancelar").onclick({currentTarget: null});
out.confirm = confirmados[confirmados.length - 1];

// y sin destino no se pinta una fila vacía
rutas["/api/agenda"] = [OK({items: [ITEM()], cursor: null, total: 1})];
await agCargar();
out.sinDestino = els.agLista.innerHTML;
""", tmp_path)
    assert "Página 1110000001" in o["tarjeta"]
    assert "Página 1110000001" in o["dialogo"]
    assert "Destino: Página 1110000001" in o["confirm"]
    assert " · </span>" not in o["sinDestino"] and "Destino:" not in o["sinDestino"]


def test_los_puntos_suspensivos_los_decide_cortado(tmp_path):
    """Un texto de EXACTAMENTE 200 caracteres que no se recortó no lleva «…»."""
    o = _node(r"""
const doscientos = "x".repeat(200);
rutas["/api/agenda"] = [OK({items: [ITEM({id: "a", texto: doscientos, cortado: false}),
                                    ITEM({id: "b", texto: "hola", cortado: true}),
                                    ITEM({id: "c", texto: "", cortado: false})],
                            cursor: null, total: 3})];
await agCargar();
out.html = els.agLista.innerHTML;
out.completo = out.html.includes(doscientos + "…");
out.recortado = out.html.includes("hola…");
out.sinTexto = out.html.includes("Sin texto");
""", tmp_path)
    assert o["completo"] is False, "puso «…» a un texto que no se recortó"
    assert o["recortado"] is True, "no puso «…» a un texto que el servidor sí recortó"
    assert o["sinTexto"] is True


def test_los_adjuntos_no_se_llaman_videos(tmp_path):
    """La doc de Blotato dice «images, videos»: no son necesariamente videos."""
    o = _node(r"""
rutas["/api/agenda"] = [OK({items: [ITEM({id: "a", medios: 0}), ITEM({id: "b", medios: 1}),
                                    ITEM({id: "c", medios: 3})],
                            cursor: null, total: 3})];
await agCargar();
const tarjetas = els.agLista.innerHTML.split('<li class="tarjeta">').slice(1);
out.cero = tarjetas[0];
out.uno = tarjetas[1];
out.tres = tarjetas[2];
""", tmp_path)
    assert "archivo" not in o["cero"], "pintó los adjuntos de una publicación que no tiene"
    assert "1 archivo" in o["uno"] and "archivos" not in o["uno"]
    assert "3 archivos" in o["tres"]
    for t in (o["cero"], o["uno"], o["tres"]):
        assert "video" not in t


def test_lo_que_llega_de_blotato_va_escapado_en_node(tmp_path):
    malo = '<img src=x onerror=alert(1)>"&'
    o = _node(f"""
const malo = {json.dumps(malo)};
rutas["/api/agenda"] = [OK({{items: [ITEM({{red: malo, cuenta_nombre: malo, texto: malo}})],
                             cursor: null, total: 1}})];
await agCargar();
out.html = els.agLista.innerHTML;
""", tmp_path)
    assert "<img" not in o["html"]
    assert "&lt;img src=x onerror=alert(1)&gt;&quot;&amp;" in o["html"]


# ---------------------------------------------------------------------------
# la píldora del editor: el estado nuevo tiene nombre y color propios

def test_b3etiqueta_cancelado_en_node(tmp_path):
    """Sin la línea de «cancelado», b3etiqueta caía al fallback y pintaba la
    palabra cruda del registro, sin píldora."""
    from pipeline import publicaciones
    assert "cancelado" in publicaciones.MENSAJES
    nodo = shutil.which("node")
    if not nodo:
        pytest.skip("node no está en el PATH")
    trozo = _tramo("const B3EN_CURSO", ";", EDITOR) + ";\n" + \
        _tramo("function b3etiqueta(p)", "\n// Una fila", EDITOR)
    codigo = (trozo + "\nconst out = {};\n"
              'out.cancelado = b3etiqueta({estado: "cancelado", en_curso: false});\n'
              'out.enCurso = b3etiqueta({estado: "creando", en_curso: true});\n'
              'out.desconocido = b3etiqueta({estado: "vaya", en_curso: false});\n'
              "console.log(JSON.stringify(out));\n")
    f = tmp_path / "b3etiqueta.js"
    f.write_text(codigo, encoding="utf-8")
    r = subprocess.run([nodo, str(f)], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    o = json.loads(r.stdout)
    assert o["cancelado"] == ["Cancelada", "aviso"]
    assert o["enCurso"] == ["Enviando…", "curso"]
    assert o["desconocido"] == ["vaya", ""]


def test_la_pildora_aviso_existe_en_el_editor():
    """«aviso» tiene que ser una clase de verdad: una inventada se pinta sin
    color y nadie se entera."""
    assert ".b3pill.aviso {" in EDITOR
    assert '["Cancelada", "aviso"]' in EDITOR


# ---------------------------------------------------------------------------
# el hub ya no dice «próximamente» de la Agenda

def test_el_hub_enlaza_la_agenda():
    inicio = (RAIZ / "static" / "index.html").read_text(encoding="utf-8")
    linea = next(l for l in inicio.splitlines() if "Agenda tus publicaciones" in l)
    assert 'href="/agenda.html"' in linea and 'class="prox"' not in linea
    assert (RAIZ / "static" / "agenda.html").is_file()
