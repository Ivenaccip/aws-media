"""E2 — la bandeja «Tus trabajos» pinta la copia que edita la IA (static/trabajos.js), en un DOM de verdad.

`tests/test_ui15_trabajos.py` prueba lo PURO del cuadro con `node` solo; aquí se carga el archivo entero en jsdom (el de web/node_modules, el
mismo de vitest) con un `fetch` y un reloj de mentira, y se mira lo que dibuja. Nada sale a la red ni cobra: «Reintentar» llama a un fetch falso.

Lo que se defiende (contrato E2, §3.6.1 y §6.7):
- la bandeja no arma frases de la ficha `edicion`: pinta los tres pasos, «Pediste: …», el resumen, el enlace y el error en tres partes TAL CUAL
  llegan (y como texto: un título con HTML no crea elementos);
- «Llevas m:ss» lo mueve un reloj de 1 s con `textContent`, sin repintar (repintar le quitaría el foco a quien esté en el cuadro), y el reloj se
  detiene cuando ya no hay una copia corriendo;
- listo: «Abrir el editor» y «Cerrar» (sin la ✕ de siempre); error: `role="alert"`, tres partes, «Reintentar» y «Cerrar»;
- «Reintentar» llama a la ruta del servidor con POST y, sin saldo (402), dice «Te faltan ✦ N ·» con «Recargar» solo si la recarga está abierta;
- las fichas de siempre no cambian (la línea «Te devolvimos ✦ N.» de una película que falló sigue ahí).
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
JS = RAIZ / "static" / "trabajos.js"
JSDOM = RAIZ / "web" / "node_modules" / "jsdom"

NODO = r"""
const {JSDOM} = require(__JSDOM__);
const fs = require('fs');
const codigo = fs.readFileSync(__JS__, 'utf8');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://x/estudio/inicio/', runScripts: 'outside-only', pretendToBeVisual: true});
const w = dom.window;
const doc = w.document;

// --- el reloj y los intervalos de mentira: la prueba los mueve a mano
let AHORA = Date.parse('2026-10-15T18:04:21+00:00');
w.Date.now = () => AHORA;
const intervalos = new Map();
let sigId = 1;
w.setInterval = (f, ms) => { const id = sigId++; intervalos.set(id, {f, ms}); return id; };
w.clearInterval = id => { intervalos.delete(id); };
// los temporizadores sueltos (el primer refrescar a los 600 ms, los avisos que se van solos) tampoco corren solos: no ensucian la prueba
const temporizadores = new Map();
w.setTimeout = (f, ms) => { const id = sigId++; temporizadores.set(id, {f, ms}); return id; };
w.clearTimeout = id => { temporizadores.delete(id); };
const avanzar = ms => { AHORA += ms; for (const {f} of [...intervalos.values()]) f(); };

// --- el servidor de mentira
const estado = {trabajos: [], llamadas: []};
let respuestaReintento = {ok: true, status: 200, cuerpo: {lanzado: true}};
w.fetch = async (url, op) => {
  estado.llamadas.push({url: String(url), metodo: (op && op.method) || 'GET'});
  if (String(url).startsWith('/api/trabajos')) return {ok: true, status: 200, json: async () => ({trabajos: estado.trabajos, sondeo_s: 15})};
  if (respuestaReintento === 'red') throw new TypeError('Failed to fetch');
  return {ok: respuestaReintento.ok, status: respuestaReintento.status, json: async () => respuestaReintento.cuerpo};
};
w.icono = n => '<svg data-i="' + n + '"></svg>';
w.monedero = {get: () => ({saldo: 5}), recarga: true, recargar() { w.__recargado = (w.__recargado || 0) + 1; }, cta: 'Escríbenos por el canal de la comunidad para conseguir más.'};

w.eval(codigo);
const cargada = new Promise(r => (doc.readyState === 'complete' ? r() : w.addEventListener('load', () => r())));
let raiz = null;
const P = w.trabajos._puro;
const esperar = () => new Promise(r => setImmediate(r));
async function traer(trabajos) { estado.trabajos = trabajos; await w.trabajos.refrescar(); await esperar(); }
const abrir = () => { const b = raiz.querySelector('[data-abrir]'); if (b) b.click(); };
const textos = sel => [...raiz.querySelectorAll(sel)].map(e => e.textContent);

const INICIO = '2026-10-15T18:02:11+00:00';
const corriendo = (extra = {}) => ({
  id: 'edicion:ed-9f1c0a7b:1792087331', tipo: 'edicion', estado: 'corriendo', titulo: 'La IA edita El tren de papel + 2 más',
  detalle: 'Ordenando tus 3 videos…', progreso: null, url: '', cuando: INICIO, devueltos: null,
  edicion: {nombre: 'ed-9f1c0a7b', paso: 'entender', pasos: ['Entender', 'Editar', 'Vista previa'], pedido: 'Quita muletillas y silencios. Es para YouTube.',
            inicio: INICIO, resumen: null, enlace: null, error: null},
  ...extra,
});
const out = {};

// ---------------------------------------------------------------- corriendo
(async () => {
  await cargada;
  await esperar();
  raiz = doc.getElementById('bandeja');
  await traer([corriendo()]);
  // plegada: la píldora dice que hay un trabajo en curso; se abre con el botón
  out.pildora = textos('.bj-pildora span')[0];
  abrir();
  const item = raiz.querySelector('.bj-item.corriendo');
  out.corriendo = {
    titulo: item.querySelector('.bj-tit').textContent,
    icono: item.querySelector(':scope > svg').getAttribute('data-i'),
    subs: textos('.bj-sub'),
    pasos: [...raiz.querySelectorAll('ul.pasos li')].map(li => ({clase: li.className, actual: li.getAttribute('aria-current'), texto: li.textContent})),
    etiquetaPasos: raiz.querySelector('ul.pasos').getAttribute('aria-label'),
    cerrar: raiz.querySelectorAll('[data-cerrar]').length,
    llevas: raiz.querySelector('[data-llevas]').textContent,
    llevasInicio: raiz.querySelector('[data-llevas]').getAttribute('data-llevas'),
  };
  // el reloj: UN intervalo de 1 s, y mueve el texto SIN repintar (los nodos son los mismos)
  out.intervalos = [...intervalos.values()].map(i => i.ms);
  const span = raiz.querySelector('[data-llevas]');
  const ul = raiz.querySelector('ul.pasos');
  avanzar(1000);
  out.reloj = {mismoSpan: raiz.querySelector('[data-llevas]') === span, mismaLista: raiz.querySelector('ul.pasos') === ul, texto: span.textContent};
  avanzar(59000);
  out.reloj.texto2 = span.textContent;
  // más de una hora
  avanzar(3600 * 1000);
  out.reloj.texto3 = span.textContent;

  // otra lectura con lo mismo NO repinta (no suelta el foco ni vuelve a anunciar)
  await traer([corriendo()]);
  out.sinRepintar = raiz.querySelector('ul.pasos') === ul && raiz.querySelector('[data-llevas]') === span;

  // el paso avanza: cambian los estados de los tres pasos
  await traer([corriendo({detalle: 'La IA está uniendo tus videos…', edicion: {...corriendo().edicion, paso: 'editar'}})]);
  out.pasosEditar = [...raiz.querySelectorAll('ul.pasos li')].map(li => li.className + (li.getAttribute('aria-current') ? '!' : ''));
  await traer([corriendo({detalle: 'Preparando la vista previa…', edicion: {...corriendo().edicion, paso: 'vista'}})]);
  out.pasosVista = [...raiz.querySelectorAll('ul.pasos li')].map(li => li.className + (li.getAttribute('aria-current') ? '!' : ''));
  out.srPasos = textos('ul.pasos li .sr-only');

  // lo que viene del servidor es TEXTO: ni el título, ni el pedido, ni el detalle crean elementos
  await traer([corriendo({titulo: 'La IA edita <img src=x onerror=alert(1)>', detalle: '<b>hola</b>',
                          edicion: {...corriendo().edicion, pedido: '<script>alert(1)</script> quita todo'}})]);
  out.escapado = {
    imgs: raiz.querySelectorAll('img').length, bs: raiz.querySelectorAll('.bj-sub b').length, scripts: raiz.querySelectorAll('script').length,
    titulo: raiz.querySelector('.bj-tit').textContent, pedido: textos('.bj-pedido')[0],
  };

  // ------------------------------------------------------------ listo
  const listo = (extra = {}) => ({
    id: 'edicion:ed-9f1c0a7b:1792087900', tipo: 'edicion', estado: 'listo', titulo: 'Tu video editado está listo',
    detalle: 'Unimos 3 videos · 12:04 → 12:00', progreso: null, url: '/editor/ed-9f1c0a7b/', cuando: INICIO, devueltos: null,
    edicion: {nombre: 'ed-9f1c0a7b', paso: 'vista', pasos: ['Entender', 'Editar', 'Vista previa'], pedido: 'x', inicio: INICIO,
              resumen: 'Unimos 3 videos · 12:04 → 12:00', enlace: {texto: 'Abrir el editor', url: '/editor/ed-9f1c0a7b/'}, error: null},
    ...extra,
  });
  await traer([listo()]);
  // algo terminó y no lo habías visto: la bandeja se abre sola, y el reloj se apaga (ya no hay copia corriendo)
  out.intervalosListo = intervalos.size;
  const il = raiz.querySelector('.bj-item.listo');
  out.listo = {
    abierta: !!raiz.querySelector('[role="region"]'),
    titulo: il.querySelector('.bj-tit').textContent,
    subs: textos('.bj-item .bj-sub'),
    enlace: [...il.querySelectorAll('a')].map(a => [a.textContent, a.getAttribute('href')]),
    cerrar: [...il.querySelectorAll('button')].map(b => [b.textContent, b.hasAttribute('data-cerrar')]),
    equis: il.querySelectorAll('.bj-ic').length,
    icono: il.querySelector(':scope > svg').getAttribute('data-i'),
    pasos: il.querySelectorAll('.pasos').length,
  };
  // «Cerrar» la quita (y no vuelve)
  il.querySelector('button[data-cerrar]').click();
  out.cerrado = raiz.querySelectorAll('.bj-item').length;
  // sin cortes: otro título y la devolución dentro del detalle que manda el servidor (no se anexa dos veces)
  await traer([listo({id: 'edicion:ed-1:1', titulo: 'Tu copia está lista, sin cortes', detalle: 'La IA no encontró nada que cortar. Te devolvimos ✦ 2.',
                      devueltos: 2, edicion: {...listo().edicion, resumen: 'La IA no encontró nada que cortar. Te devolvimos ✦ 2.'}})]);
  out.sinCortes = textos('.bj-item .bj-sub');

  // ------------------------------------------------------------ error
  const error = (extra = {}, err = {}) => ({
    id: 'edicion:ed-9f1c0a7b:1792088000', tipo: 'edicion', estado: 'error', titulo: 'No se pudo editar la unión de tus videos',
    detalle: '', progreso: null, url: '', cuando: INICIO, devueltos: 2,
    edicion: {nombre: 'ed-9f1c0a7b', paso: 'editar', pasos: ['Entender', 'Editar', 'Vista previa'], pedido: 'x', inicio: INICIO, resumen: null, enlace: null,
              error: {que_paso: 'Falló el paso «Editar» al unir tus 3 videos, de nuestro lado.', creditos: 'Te devolvimos ✦ 2.',
                      que_sigue: 'Tus videos originales no se tocaron. Reintentar vuelve a cobrar ✦ 2.',
                      reintentar: {texto: 'Reintentar', ruta: '/api/edicion/ed-9f1c0a7b/reintentar', creditos: 2}, ...err}},
    ...extra,
  });
  await traer([error()]);
  const ie = raiz.querySelector('.bj-item.error');
  out.error = {
    alerta: ie.getAttribute('role'),
    titulo: ie.querySelector('.bj-tit').textContent,
    rotulos: [...ie.querySelectorAll('dt')].map(e => e.textContent),
    partes: [...ie.querySelectorAll('dd')].map(e => e.textContent),
    botones: [...ie.querySelectorAll('button')].map(b => [b.textContent, b.dataset.reintentar || (b.hasAttribute('data-cerrar') ? 'cerrar' : '')]),
    subs: textos('.bj-item > .bj-sub'),          // la línea «Te devolvimos» de las fichas viejas NO se anexa: va en su bloque
    devAnexado: raiz.querySelectorAll('.dev').length,
  };
  // sin monedero (nada devuelto): solo dos partes, sin «Tus créditos»
  await traer([error({devueltos: null}, {creditos: undefined, que_sigue: 'Tus videos originales no se tocaron.', reintentar: {texto: 'Reintentar', ruta: '/api/edicion/ed-9f1c0a7b/reintentar'}})]);
  out.errorSinCreditos = [...raiz.querySelectorAll('.bj-item.error dt')].map(e => e.textContent);

  // ------------------------------------------------------------ reintentar
  await traer([error()]);
  const reint = () => raiz.querySelector('[data-reintentar]');
  const avisosAhora = () => [...raiz.querySelectorAll('.bj-aviso')].map(a => ({texto: a.querySelector('span').textContent, accion: [...a.querySelectorAll('[data-accion]')].map(b => b.textContent)}));
  // 402 con la recarga abierta: «Te faltan ✦ 3 ·» + «Recargar» (que llama al monedero)
  respuestaReintento = {ok: false, status: 402, cuerpo: {detail: 'Créditos insuficientes: esta acción cuesta 8 créditos y tu saldo es 5.'}};
  estado.llamadas = [];
  reint().click(); await esperar(); await esperar();
  out.r402 = {llamada: estado.llamadas.filter(l => l.metodo === 'POST'), avisos: avisosAhora(), alerta: raiz.querySelector('.bj-aviso').getAttribute('role'),
              libre: !reint().hasAttribute('aria-busy')};
  raiz.querySelector('[data-accion]').click();
  out.r402.recargo = w.__recargado || 0;
  // 402 con la recarga CERRADA: el texto de la comunidad, sin botón
  w.monedero.recarga = false;
  reint().click(); await esperar(); await esperar();
  out.r402Cerrada = avisosAhora();
  w.monedero.recarga = true;
  // otro error con cuerpo: su detalle tal cual
  respuestaReintento = {ok: false, status: 409, cuerpo: {detail: 'Esta edición ya se está reintentando.'}};
  reint().click(); await esperar(); await esperar();
  out.r409 = avisosAhora().at(-1);
  // sin red
  respuestaReintento = 'red';
  reint().click(); await esperar(); await esperar();
  out.rRed = avisosAhora().at(-1);
  // salió bien: no dice nada y vuelve a preguntar por los trabajos
  respuestaReintento = {ok: true, status: 200, cuerpo: {lanzado: true, nombre: 'ed-9f1c0a7b', creditos: 2}};
  estado.llamadas = [];
  const avisosAntes = avisosAhora().length;
  reint().click(); await esperar(); await esperar();
  out.rOk = {post: estado.llamadas.filter(l => l.metodo === 'POST').map(l => l.url), preguntoTrabajos: estado.llamadas.some(l => l.url.startsWith('/api/trabajos')),
             avisosNuevos: avisosAhora().length - avisosAntes};
  // una ruta que no es /api/ no se llama
  const mala = error({}, {reintentar: {texto: 'Reintentar', ruta: 'https://ajeno.example/x'}});
  await traer([mala]);
  estado.llamadas = [];
  reint().click(); await esperar(); await esperar();
  out.rajena = estado.llamadas.filter(l => l.metodo === 'POST').length;

  // ------------------------------------------------------------ las fichas de siempre no cambian
  await traer([{id: 'pelicula:p1:1', tipo: 'pelicula', estado: 'error', titulo: 'No se pudo producir', detalle: 'En «Animando las escenas».', devueltos: 90, url: '/crear.html?p=p1'},
               {id: 'clip:c1', tipo: 'clip', estado: 'corriendo', titulo: 'Generando tu clip de 8 segundos', detalle: 'En camino', progreso: 40, url: ''}]);
  abrir();
  out.viejas = {sub: textos('.bj-item.error .bj-sub')[0], dev: raiz.querySelectorAll('.dev').length, equis: raiz.querySelectorAll('.bj-item .bj-ic').length,
                barra: raiz.querySelectorAll('.bj-barra').length, iconoClip: raiz.querySelector('.bj-item.corriendo > svg').getAttribute('data-i')};

  // ------------------------------------------------------------ lo puro
  out.puro = {
    pasos: P.pasosDe({paso: 'editar', pasos: ['Entender', 'Editar', 'Vista previa']}),
    pasosSinPaso: P.pasosDe({}).map(p => p.estado),
    pasosRaro: P.pasosDe({paso: 'algo'}).map(p => p.estado),
    t: [P.transcurrido(INICIO, Date.parse(INICIO)), P.transcurrido(INICIO, Date.parse(INICIO) + 130000), P.transcurrido(INICIO, Date.parse(INICIO) + 3725000),
        P.transcurrido(INICIO, Date.parse(INICIO) - 5000), P.transcurrido('no es fecha', Date.now())],
    f: [P.faltanTras402('Créditos insuficientes: esta acción cuesta 8 créditos y tu saldo es 5.', 2, 100), P.faltanTras402('otro texto', 8, 5),
        P.faltanTras402('otro texto', 8, null), P.faltanTras402(undefined, 8, 20), P.faltanTras402(undefined, undefined, undefined)],
  };
  console.log(JSON.stringify(out));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
"""


@pytest.fixture(scope="module")
def vista(tmp_path_factory):
    node = shutil.which("node")
    if not node:
        pytest.skip("node no está instalado")
    if not JSDOM.is_dir():
        pytest.skip("web/node_modules no está instalado (npm ci en web/)")
    f = tmp_path_factory.mktemp("e2bandeja") / "b.js"
    f.write_text(NODO.replace("__JSDOM__", json.dumps(str(JSDOM))).replace("__JS__", json.dumps(str(JS))), encoding="utf-8")
    r = subprocess.run([node, str(f)], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1])


def test_corriendo_pinta_el_titulo_la_frase_del_paso_el_pedido_y_los_tres_pasos(vista):
    assert vista["pildora"] == "1 trabajo en curso"
    c = vista["corriendo"]
    assert c["titulo"] == "La IA edita El tren de papel + 2 más" and c["icono"] == "cortar"
    # lo del servidor tal cual, más las dos frases fijas de aquí
    assert c["subs"] == [
        "Ordenando tus 3 videos…",
        "Pediste: Quita muletillas y silencios. Es para YouTube.",
        "Llevas 2:10. Puedes cerrar esta pestaña: sigue en la nube.",
    ]
    assert [p["texto"] for p in c["pasos"]] == ["1Entender (en curso)", "2Editar (pendiente)", "3Vista previa (pendiente)"]
    assert [p["clase"] for p in c["pasos"]] == ["actual", "pendiente", "pendiente"]
    assert [p["actual"] for p in c["pasos"]] == ["step", None, None]
    assert c["etiquetaPasos"] == "Pasos"
    assert c["cerrar"] == 0          # una copia que corre no se cierra
    assert c["llevasInicio"] == "2026-10-15T18:02:11+00:00"


def test_el_paso_avanza_y_cada_estado_se_dice_con_texto_y_no_solo_con_color(vista):
    assert vista["pasosEditar"] == ["hecho", "actual!", "pendiente"]
    assert vista["pasosVista"] == ["hecho", "hecho", "actual!"]
    assert vista["srPasos"] == [" (hecho)", " (hecho)", " (en curso)"]


def test_llevas_lo_mueve_un_reloj_de_un_segundo_con_textcontent_sin_repintar(vista):
    assert vista["intervalos"] == [1000]            # UN solo reloj
    r = vista["reloj"]
    assert r["mismoSpan"] and r["mismaLista"], "repintar cada segundo le quitaría el foco a quien esté en el cuadro"
    assert r["texto"] == "2:11" and r["texto2"] == "3:10"
    assert r["texto3"] == "1:03:10"                 # pasada una hora, con horas
    assert vista["sinRepintar"], "una lectura idéntica no vuelve a pintar (ni re-anuncia un role=alert)"


def test_el_reloj_se_detiene_cuando_ya_no_hay_copia_corriendo(vista):
    assert vista["intervalosListo"] == 0


def test_lo_que_llega_del_servidor_es_texto_nunca_html(vista):
    e = vista["escapado"]
    assert e["imgs"] == 0 and e["bs"] == 0 and e["scripts"] == 0
    assert e["titulo"] == "La IA edita <img src=x onerror=alert(1)>"
    assert e["pedido"] == "Pediste: <script>alert(1)</script> quita todo"


def test_listo_abre_el_editor_y_se_cierra_con_su_boton_sin_la_equis_de_siempre(vista):
    li = vista["listo"]
    assert li["abierta"], "algo terminó y no lo habías visto: la bandeja se abre sola"
    assert li["titulo"] == "Tu video editado está listo" and li["icono"] == "listo"
    assert li["subs"] == ["Unimos 3 videos · 12:04 → 12:00", "Ábrelo en el editor para revisar los cortes y renderizarlo."]
    assert li["enlace"] == [["Abrir el editor", "/editor/ed-9f1c0a7b/"]]
    assert li["cerrar"] == [["Cerrar", True]]
    assert li["equis"] == 0 and li["pasos"] == 0
    assert vista["cerrado"] == 0


def test_una_copia_sin_cortes_dice_lo_que_manda_el_servidor_y_no_anexa_la_devolucion_dos_veces(vista):
    assert vista["sinCortes"] == ["La IA no encontró nada que cortar. Te devolvimos ✦ 2.", "Ábrelo en el editor para revisar los cortes y renderizarlo."]


def test_error_en_tres_partes_con_reintentar_y_cerrar(vista):
    e = vista["error"]
    assert e["alerta"] == "alert" and e["titulo"] == "No se pudo editar la unión de tus videos"
    assert e["rotulos"] == ["Qué pasó", "Tus créditos", "Qué sigue"]
    assert e["partes"] == [
        "Falló el paso «Editar» al unir tus 3 videos, de nuestro lado.",
        "Te devolvimos ✦ 2.",
        "Tus videos originales no se tocaron. Reintentar vuelve a cobrar ✦ 2.",
    ]
    assert e["botones"] == [["Reintentar", "/api/edicion/ed-9f1c0a7b/reintentar"], ["Cerrar", "cerrar"]]
    assert e["devAnexado"] == 0 and e["subs"] == []
    # sin monedero no se habla de créditos
    assert vista["errorSinCreditos"] == ["Qué pasó", "Qué sigue"]


def test_reintentar_llama_a_la_ruta_del_servidor_y_dice_cuanto_falta_sin_saldo(vista):
    r = vista["r402"]
    assert r["llamada"] == [{"url": "/api/edicion/ed-9f1c0a7b/reintentar", "metodo": "POST"}]
    assert r["avisos"] == [{"texto": "Te faltan ✦ 3 ·", "accion": ["Recargar"]}]
    assert r["alerta"] == "alert" and r["libre"]
    assert r["recargo"] == 1
    # con la recarga cerrada: el texto del monedero, y ningún botón que no haga nada
    assert vista["r402Cerrada"][-1] == {
        "texto": "Te faltan ✦ 3 · Escríbenos por el canal de la comunidad para conseguir más.",
        "accion": [],
    }


def test_otros_fallos_de_reintentar_se_dicen_tal_cual_y_uno_que_sale_bien_solo_vuelve_a_preguntar(vista):
    assert vista["r409"]["texto"] == "Esta edición ya se está reintentando."
    assert vista["rRed"]["texto"] == "Sin conexión. Inténtalo de nuevo."
    ok = vista["rOk"]
    assert ok["post"] == ["/api/edicion/ed-9f1c0a7b/reintentar"] and ok["preguntoTrabajos"] and ok["avisosNuevos"] == 0


def test_reintentar_solo_llama_a_rutas_de_la_api_del_propio_sitio(vista):
    assert vista["rajena"] == 0


def test_las_fichas_de_siempre_no_cambian(vista):
    v = vista["viejas"]
    assert v["sub"] == "En «Animando las escenas». Te devolvimos ✦ 90."
    assert v["dev"] == 1 and v["barra"] == 1 and v["iconoClip"] == "video"
    assert v["equis"] == 1          # la película que falló conserva su ✕ (el clip que corre no tiene)


def test_lo_puro_pasos_reloj_y_lo_que_falta_tras_un_402(vista):
    p = vista["puro"]
    assert [x["estado"] for x in p["pasos"]] == ["hecho", "actual", "pendiente"]
    assert [x["texto"] for x in p["pasos"]] == ["Entender", "Editar", "Vista previa"]
    assert p["pasosSinPaso"] == ["actual", "pendiente", "pendiente"]
    assert p["pasosRaro"] == ["actual", "pendiente", "pendiente"]
    assert p["t"] == ["0:00", "2:10", "1:02:05", "0:00", "0:00"]
    assert p["f"] == [3, 3, 8, 1, 1]


def test_el_archivo_sigue_cuidando_lo_que_las_demas_pruebas_miran():
    js = JS.read_text(encoding="utf-8")
    # lo que viene del servidor pasa SIEMPRE por esc(); y nada de innerHTML con la ficha sin escapar
    assert "${esc(t.titulo)}" in js and "esc(t.detalle" in js
    assert "esc(ed.pedido)" in js and "esc(texto)" in js and "esc(ed.inicio)" in js
    # ningún texto con ✦ en una plantilla de comillas invertidas que no sea «Te devolvimos» (lo vigila test_m21_botones)
    assert "'Te faltan ✦ '" in js
    # el reloj se mueve con textContent, no repintando
    assert "el.textContent = transcurrido(" in js
