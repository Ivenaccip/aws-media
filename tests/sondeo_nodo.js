// Arnés de static/sondeo.js fuera del navegador (lo corre test_rag_sondeo.py).
//
// El sondeo es lógica de TIEMPO: cuándo pregunta, cuándo se frena, cuándo se
// rinde y cuándo avisa. Probarla con timers de verdad serían minutos por caso,
// así que aquí el reloj y el fetch son de mentira: el reloj solo avanza cuando
// el arnés lo empuja, y el fetch contesta lo que el caso le diga. El
// setTimeout global se tapa mientras corren los casos: si el módulo usara uno
// real en vez del reloj inyectado, el arnés truena en vez de esperar.
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const FUENTE = fs.readFileSync(path.join(RAIZ, 'static', 'sondeo.js'), 'utf8');
const Sondeo = require(path.join(RAIZ, 'static', 'sondeo.js'));

let comprobaciones = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); comprobaciones++; };

// vacía la cola de microtareas: todo lo que el sondeo encadena con promesas
// corre antes del siguiente setImmediate (que no es un timer ni espera nada)
const vaciar = () => new Promise(r => setImmediate(r));

// --- reloj de mentira -----------------------------------------------------
function relojFalso() {
  let t = 0, orden = 0;
  const cola = [];
  const r = {
    ahora: () => t,
    esperar(ms) {
      return new Promise(res => cola.push({ hasta: t + Math.max(0, ms), res, orden: orden++ }));
    },
    // empuja el reloj `ms`, despertando en orden cada espera que se cumple
    async avanzar(ms) {
      const fin = t + ms;
      await vaciar();
      for (;;) {
        cola.sort((a, b) => a.hasta - b.hasta || a.orden - b.orden);
        if (!cola.length || cola[0].hasta > fin) break;
        const p = cola.shift();
        if (p.hasta > t) t = p.hasta;
        p.res();
        await vaciar();
      }
      t = fin;
      await vaciar();
    },
    // lleva el reloj a una hora absoluta
    ir: ms => r.avanzar(ms - t),
  };
  return r;
}

// --- servidor de mentira --------------------------------------------------
// `plan` es un arreglo (se repite el último) o una función (n, t) → respuesta.
// Respuesta: {status, cuerpo, headers} · 'red' (fetch rechaza) · 'colgada'
// (no contesta hasta que la aborten) · 'sorda' (no contesta nunca, ni abortada).
function respuesta(status, cuerpo, headers) {
  const hs = headers || {};
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(k) {
        for (const c of Object.keys(hs)) if (c.toLowerCase() === k.toLowerCase()) return hs[c];
        return null;
      },
    },
    // sin cuerpo = no es JSON (la página de error de un proxy, un portal…)
    json: async () => {
      if (cuerpo === undefined) throw new SyntaxError('Unexpected token < in JSON');
      return cuerpo;
    },
  };
}

function servidor(reloj, plan) {
  const llamadas = [], senales = [], opciones = [];
  let conReceptor = 0;
  const f = function (url, op) {
    // window.fetch llamado como método de otro objeto truena en el navegador
    // («Illegal invocation»): el sondeo tiene que llamarlo suelto
    if (this !== undefined) conReceptor++;
    const n = llamadas.length;
    llamadas.push(reloj.ahora());
    senales.push(op && op.signal);
    opciones.push({ url, op });
    const r = typeof plan === 'function' ? plan(n, reloj.ahora())
      : plan[Math.min(n, plan.length - 1)];
    if (r === 'red') return Promise.reject(new TypeError('Failed to fetch'));
    if (r === 'sorda') return new Promise(() => {});
    if (r === 'colgada') {
      return new Promise((_, no) => {
        const s = op && op.signal;
        if (s) s.addEventListener('abort', () =>
          no(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })));
      });
    }
    return Promise.resolve(respuesta(r.status || 200, r.cuerpo, r.headers));
  };
  f.llamadas = llamadas;
  f.senales = senales;
  f.opciones = opciones;
  f.conReceptor = () => conReceptor;
  return f;
}

const armando = (paso = 'armar') => ({ status: 200, cuerpo: { estado: 'armando', paso } });
const enFila = lugar => ({ status: 200, cuerpo: { estado: 'en_fila', lugar } });
const listo = { status: 200, cuerpo: { estado: 'listo', nodos: [], descarga: '/x' } };
const FINALES = ['listo', 'no_salio', 'sin_cobertura', 'rechazada'];

function montar(plan, extra) {
  const reloj = relojFalso();
  const fetch = servidor(reloj, plan);
  const ev = { cambios: [], avisos: [], topes: [], conexion: [], errores: [] };
  const s = Sondeo.iniciar(Object.assign({
    url: '/api/publico/corridas/abcdefghijklmnop',
    fetch, reloj, documento: null,
    alCambiar: c => ev.cambios.push(c),
    esFinal: c => FINALES.includes(c.estado),
    alAviso: () => ev.avisos.push(reloj.ahora()),
    alTope: () => ev.topes.push(reloj.ahora()),
    alConexion: bien => ev.conexion.push([bien, reloj.ahora()]),
    alError: (st, c) => ev.errores.push([st, c]),
    progreso: c => [c.estado, c.paso, c.lugar].join('|'),
  }, extra || {}));
  return { reloj, fetch, ev, s };
}

const intervalos = xs => xs.slice(1).map((x, i) => x - xs[i]);
const noDecreciente = xs => xs.every((x, i) => i === 0 || x >= xs[i - 1]);

function documentoFalso(oculto) {
  const oyentes = new Set();
  return {
    hidden: !!oculto,
    addEventListener(tipo, fn) { if (tipo === 'visibilitychange') oyentes.add(fn); },
    removeEventListener(tipo, fn) { if (tipo === 'visibilitychange') oyentes.delete(fn); },
    cambiar(oculto) { this.hidden = oculto; for (const fn of [...oyentes]) fn(); },
    oyentes: () => oyentes.size,
  };
}

// ==========================================================================
const casos = [];
const caso = (nombre, fn) => casos.push([nombre, fn]);

caso('las constantes son las de MIX', async () => {
  const mix = fs.readFileSync(path.join(RAIZ, 'static', 'mix.html'), 'utf8');
  const pasos = mix.match(/const MXEJ_PASOS = \[([^\]]+)\]/);
  ok(pasos, 'no encontré MXEJ_PASOS en static/mix.html');
  igual(Sondeo.PASOS, pasos[1].split(',').map(x => Number(x.trim())),
    'la escalera no es la de MIX');
  ok(noDecreciente(Sondeo.PASOS), 'la escalera decrece');
  igual(Sondeo.AVISO_MS, Number(mix.match(/const MXEJ_AVISO = (\d+)/)[1]), 'el aviso no es el de MIX');
  igual(Sondeo.TOPE_MS, Number(mix.match(/const MXEJ_TOPE = (\d+)/)[1]), 'el tope no es el de MIX');
  const cuerpoMix = mix.slice(mix.indexOf('async function mxEsperarEjemplo'));
  igual(Sondeo.TIMEOUT_MS, Number(cuerpoMix.match(/AbortSignal\.timeout\((\d+)\)/)[1]),
    'el plazo por petición no es el de MIX');
  igual(Sondeo.MAX_429_MS, 60000, 'el techo del 429 no es 60 s');
  igual(Sondeo.FALLOS_SIN_CONEXION, 3, 'alConexion no avisa al tercer fallo');
});

caso('la escalera: pide en seguida y luego se frena igual que MIX', async () => {
  const { reloj, fetch, ev, s } = montar([armando()]);
  await reloj.ir(100000);
  igual(fetch.llamadas[0], 0, 'iniciar no pidió en seguida');
  const esperado = [5000, 5000, 5000, 10000, 10000, 20000, 20000, 20000];
  igual(intervalos(fetch.llamadas), esperado, 'las esperas no siguen la escalera');
  ok(noDecreciente(intervalos(fetch.llamadas)), 'las esperas decrecen');
  igual(ev.cambios.length, fetch.llamadas.length, 'alCambiar no se llamó en cada 200');
  igual(fetch.conReceptor(), 0, 'fetch se llamó como método (Illegal invocation en el navegador)');
  const { url, op } = fetch.opciones[0];
  igual(url, '/api/publico/corridas/abcdefghijklmnop', 'no pidió la url que le dieron');
  igual(op.cache, 'no-store', 'la petición se puede servir de caché');
  s.detener();
});

caso('inmediato:false espera el primer escalón antes de pedir', async () => {
  const { reloj, fetch, s } = montar([armando()], { inmediato: false });
  await reloj.ir(60000);
  igual(fetch.llamadas, [5000, 10000, 15000, 25000, 35000, 55000],
    'sin inmediato la escalera no arranca en el escalón 0');
  s.detener();
});

caso('siguienteEn dice cuánto falta para el siguiente vistazo', async () => {
  const { reloj, s } = montar(['red']);
  await reloj.ir(1000);
  igual(s.siguienteEn, 4000, 'tras el primer tropiezo faltan 4 s del escalón de 5');
  await reloj.ir(4999);
  igual(s.siguienteEn, 1, 'no cuenta hacia atrás con el reloj');
  await reloj.ir(6000);
  igual(s.siguienteEn, 4000, 'tras el segundo vistazo vuelve a empezar el escalón');
  s.detener();
  igual(s.siguienteEn, null, 'parado no promete ningún vistazo');
});

caso('esFinal lo detiene solo', async () => {
  const { reloj, fetch, ev, s } = montar([armando('entender'), armando('buscar'), listo]);
  await reloj.ir(600000);
  igual(fetch.llamadas.length, 3, 'siguió pidiendo después de listo');
  igual(ev.cambios.map(c => c.estado), ['armando', 'armando', 'listo'],
    'alCambiar no recibió el final');
  igual(ev.avisos.length + ev.topes.length, 0, 'avisó o topó después de terminar');
  ok(!s.activo, 'quedó activo después del final');
});

caso('un 404 cancela y llama alError', async () => {
  const { reloj, fetch, ev, s } = montar([armando(), { status: 404, cuerpo: { detail: 'No existe' } }]);
  await reloj.ir(600000);
  igual(fetch.llamadas.length, 2, 'siguió pidiendo después del 404');
  igual(ev.errores, [[404, { detail: 'No existe' }]], 'alError no recibió status y cuerpo');
  igual(ev.cambios.length, 1, 'el 404 llegó a alCambiar');
  igual(ev.topes.length, 0, 'un 404 no es un tope');
  ok(!s.activo, 'quedó activo después del 404');
  // un 410 sin JSON (página de error de un proxy) también cancela, con cuerpo null
  const b = montar([{ status: 410 }]);
  await b.reloj.ir(60000);
  igual(b.ev.errores, [[410, null]], 'un 410 sin JSON no canceló con cuerpo null');
  igual(b.fetch.llamadas.length, 1, 'insistió después del 410');
});

caso('429 respeta Retry-After y el techo; sin él duplica la espera', async () => {
  const a = montar([{ status: 429, headers: { 'Retry-After': '30' } }, armando()]);
  await a.reloj.ir(40000);
  igual(a.fetch.llamadas.slice(0, 3), [0, 30000, 35000],
    'no esperó el Retry-After o no volvió a la escalera');
  igual(a.ev.errores.length, 0, 'un 429 canceló');

  const b = montar([{ status: 429, headers: { 'retry-after': '600' } }, armando()]);
  await b.reloj.ir(70000);
  igual(b.fetch.llamadas.slice(0, 2), [0, 60000], 'el Retry-After se saltó el techo de 60 s');

  // un Retry-After menor que el escalón no acelera la escalera
  const c = montar([{ status: 429, headers: { 'Retry-After': '1' } }, armando()]);
  await c.reloj.ir(6000);
  igual(c.fetch.llamadas, [0, 5000], 'un Retry-After corto adelantó la escalera');

  const d = montar([{ status: 429 }, { status: 429 }, { status: 429 }, { status: 429 },
                    { status: 429 }, armando()]);
  await d.reloj.ir(215000);
  igual(intervalos(d.fetch.llamadas), [10000, 20000, 40000, 60000, 60000, 20000],
    'sin Retry-After no duplica con techo, o no vuelve a la escalera');
  igual(d.ev.conexion.length, 0, 'cinco 429 se tomaron como falta de conexión');
  igual(d.ev.errores.length, 0, 'un 429 canceló');
  d.s.detener();
});

caso('5xx, 408 y red reintentan con la escalera', async () => {
  const { reloj, fetch, ev, s } = montar([{ status: 500 }, 'red', armando()]);
  await reloj.ir(12000);
  igual(fetch.llamadas, [0, 5000, 10000], '5xx o red no reintentaron con la escalera');
  igual(ev.errores.length, 0, 'un 5xx o la red cancelaron');
  igual(ev.cambios.length, 1, 'no llegó la respuesta buena');
  igual(ev.conexion.length, 0, 'dos tropiezos ya avisaron de la conexión');
  s.detener();

  const b = montar([{ status: 408 }, { status: 503, cuerpo: { detail: 'x' } }, armando()]);
  await b.reloj.ir(12000);
  igual(b.fetch.llamadas, [0, 5000, 10000], 'un 408 canceló en vez de reintentar');
  igual(b.ev.errores.length, 0, 'un 408 llegó a alError');
  b.s.detener();

  // un 200 que no es JSON es un tropiezo, no un cambio
  const c = montar([{ status: 200 }, armando()]);
  await c.reloj.ir(6000);
  igual(c.ev.cambios.length, 1, 'un 200 sin JSON llegó a alCambiar');
  igual(c.fetch.llamadas, [0, 5000], 'un 200 sin JSON no reintentó');
  c.s.detener();
});

caso('alConexion: false al tercer fallo seguido, true al recuperarse', async () => {
  const { reloj, fetch, ev, s } = montar([
    { status: 500 }, 'red', { status: 503 },   // 0, 5000, 10000 → false aquí
    'red', armando(),                          // 15000, 25000 → true aquí
    { status: 502 }, 'red', armando(),         // 35000, 55000, 75000 → nada
  ]);
  await reloj.ir(80000);
  igual(fetch.llamadas.slice(0, 8), [0, 5000, 10000, 15000, 25000, 35000, 55000, 75000],
    'la escalera no siguió durante los tropiezos');
  igual(ev.conexion, [[false, 10000], [true, 25000]],
    'alConexion no avisó al tercer fallo, repitió, o no avisó al volver');
  s.detener();

  const b = montar([{ status: 408 }, { status: 408 }, { status: 408 }]);
  await b.reloj.ir(11000);
  igual(b.ev.conexion, [[false, 10000]], 'tres 408 seguidos no avisaron de la conexión');
  b.s.detener();

  // un 4xx que cancela también es el servidor contestando: la conexión volvió
  const c = montar(['red', 'red', 'red', { status: 404, cuerpo: {} }]);
  await c.reloj.ir(60000);
  igual(c.ev.conexion.map(x => x[0]), [false, true], 'el 404 no avisó que la conexión volvió');
  igual(c.ev.errores.map(x => x[0]), [404], 'el 404 tras la caída no llegó a alError');
});

caso('el aviso llega una sola vez, a su hora, sin pedir de más', async () => {
  const { reloj, fetch, ev, s } = montar([armando()]);
  await reloj.ir(239000);
  igual(ev.avisos, [120000], 'el aviso no llegó una sola vez a los 120 s');
  igual(ev.topes.length, 0, 'topó antes de tiempo');
  ok(!fetch.llamadas.includes(120000), 'despertar para el aviso hizo una petición de más');
  ok(s.activo, 'se detuvo antes del tope');
});

caso('el tope sin progreso detiene; mientras la fila avanza no llega', async () => {
  const { reloj, fetch, ev, s } = montar([armando()]);
  await reloj.ir(240000);
  igual(ev.topes, [240000], 'el tope no llegó a los 240 s');
  ok(!s.activo, 'el tope no detuvo el sondeo');
  const pedidas = fetch.llamadas.length;
  await reloj.ir(900000);
  igual(fetch.llamadas.length, pedidas, 'siguió pidiendo después del tope');
  igual(ev.avisos.length, 1, 'el aviso se repitió');

  // la fila baja un lugar por minuto durante 10 min y luego se queda quieta
  let visto = null, ultimoCambio = null;
  const b = montar((n, t) => {
    const lugar = t < 600000 ? 30 - Math.floor(t / 60000) : 20;
    if (visto !== null && lugar !== visto) ultimoCambio = t;
    visto = lugar;
    return enFila(lugar);
  });
  await b.reloj.ir(600000);
  igual(b.ev.avisos.length + b.ev.topes.length, 0,
    'avisó o topó mientras la fila avanzaba');
  ok(b.s.activo, 'se detuvo mientras la fila avanzaba');
  await b.reloj.ir(1200000);
  ok(ultimoCambio > 590000, 'el caso no llegó a ver el último cambio');
  igual(b.ev.avisos, [ultimoCambio + 120000], 'el aviso no contó desde el último progreso');
  igual(b.ev.topes, [ultimoCambio + 240000], 'el tope no contó desde el último progreso');

  // tras un progreso, un silencio nuevo vuelve a merecer aviso
  const c = montar((n, t) => armando(t < 150000 ? 'buscar' : 'armar'));
  await c.reloj.ir(300000);
  ok(c.ev.avisos.length === 2 && c.ev.avisos[0] === 120000,
    'el aviso no se rearmó después del progreso');
  ok(c.ev.avisos[1] > 150000 + 120000 - 1, 'el segundo aviso no contó desde el progreso');
  c.s.detener();
});

caso('pestaña oculta no pide; al volver pide ya', async () => {
  const doc = documentoFalso(false);
  const { reloj, fetch, ev, s } = montar(
    (n, t) => armando(t < 300000 ? 'armar' : 'revisar'), { documento: doc });
  await reloj.ir(12000);
  igual(fetch.llamadas, [0, 5000, 10000], 'no arrancó normal');
  igual(doc.oyentes(), 1, 'no escucha visibilitychange');
  doc.cambiar(true);
  await reloj.ir(312000);
  igual(fetch.llamadas.length, 3, 'pidió con la pestaña oculta');
  igual(ev.avisos.length + ev.topes.length, 0, 'avisó o topó con la pestaña oculta');
  doc.cambiar(false);
  await vaciar();
  igual(fetch.llamadas[3], 312000, 'al volver no pidió en seguida');
  igual(ev.cambios[3].paso, 'revisar', 'lo nuevo no llegó a la página');
  await reloj.avanzar(0);
  igual(ev.topes.length, 0, 'topó aunque al volver había progreso');
  // la que se hizo al volver era la cuarta vuelta: le sigue el escalón de 10 s
  await reloj.ir(323000);
  igual(fetch.llamadas[4], 322000, 'al volver no siguió la escalera');
  s.detener();
  igual(doc.oyentes(), 0, 'detener no soltó visibilitychange');

  // volver sin progreso: primero se pide, y solo después se juzga el silencio
  const doc2 = documentoFalso(false);
  const b = montar([armando()], { documento: doc2 });
  await b.reloj.ir(1000);
  doc2.cambiar(true);
  await b.reloj.ir(300000);
  doc2.cambiar(false);
  await vaciar();
  await b.reloj.avanzar(0);
  igual(b.fetch.llamadas[b.fetch.llamadas.length - 1], 300000, 'no pidió antes de juzgar');
  igual(b.ev.topes, [300000], 'sin progreso tras cinco minutos no topó al volver');

  // abierta en una pestaña de fondo: no pide hasta que la miran
  const doc3 = documentoFalso(true);
  const c = montar([armando()], { documento: doc3 });
  await c.reloj.ir(60000);
  igual(c.fetch.llamadas.length, 0, 'pidió sin que nadie mirara');
  doc3.cambiar(false);
  await vaciar();
  igual(c.fetch.llamadas, [60000], 'al mirarla no pidió en seguida');
  c.s.detener();
});

caso('reanudar pide ya y reinicia escalera y relojes; detener detiene', async () => {
  const { reloj, fetch, ev, s } = montar([armando()]);
  await reloj.ir(240000);
  igual(ev.topes, [240000], 'no topó');
  await reloj.ir(300000);
  const antes = fetch.llamadas.length;
  s.reanudar();
  ok(s.activo, 'reanudar no lo reactivó');
  await vaciar();
  await reloj.ir(326000);
  igual(fetch.llamadas.slice(antes), [300000, 305000, 310000, 315000, 325000],
    'reanudar no pidió ya o no reinició la escalera');
  await reloj.ir(600000);
  igual(ev.avisos, [120000, 420000], 'reanudar no reinició el reloj del aviso');
  igual(ev.topes, [240000, 540000], 'reanudar no reinició el reloj del tope');

  // detener a media escalera: nada más; reanudar lo vuelve a poner en marcha
  const b = montar([armando()]);
  await b.reloj.ir(60000);
  b.s.detener();
  ok(!b.s.activo, 'detener no lo detuvo');
  const n = b.fetch.llamadas.length;
  await b.reloj.ir(900000);
  igual(b.fetch.llamadas.length, n, 'siguió pidiendo después de detener');
  igual(b.ev.avisos.length + b.ev.topes.length, 0, 'avisó o topó ya detenido');
  b.s.reanudar();
  await vaciar();
  igual(b.fetch.llamadas[n], 900000, 'reanudar tras detener no pidió ya');
  b.s.detener();

  // detener con una petición en vuelo la aborta, sin contarla como tropiezo
  const c = montar(['colgada']);
  await c.reloj.ir(1000);
  c.s.detener();
  await c.reloj.ir(100000);
  ok(c.fetch.senales[0].aborted, 'detener no abortó la petición en vuelo');
  igual(c.fetch.llamadas.length, 1, 'pidió después de detener');
  igual(c.ev.conexion.length + c.ev.errores.length, 0, 'el aborto de detener se tomó como fallo');

  // reanudar desde alTope (el botón «Volver a mirar» puede ser inmediato)
  let d;
  d = montar([armando()], { alTope: () => d.s.reanudar() });
  await d.reloj.ir(250000);
  ok(d.s.activo, 'reanudar desde alTope no lo dejó andando');
  ok(d.fetch.llamadas.includes(240000), 'reanudar desde alTope no pidió ya');
  d.s.detener();
});

caso('cada petición tiene su plazo y se aborta al cruzarlo', async () => {
  const { reloj, fetch, ev, s } = montar(['colgada', armando()]);
  await reloj.ir(19999);
  ok(!fetch.senales[0].aborted, 'abortó antes de los 20 s');
  igual(fetch.llamadas.length, 1, 'no esperó a la petición colgada');
  await reloj.ir(20000);
  ok(fetch.senales[0].aborted, 'a los 20 s no abortó la petición');
  await reloj.ir(26000);
  igual(fetch.llamadas, [0, 25000], 'tras el plazo no siguió la escalera');
  igual(ev.cambios.length, 1, 'la respuesta tras el plazo no llegó');
  s.detener();

  const b = montar(['colgada']);
  await b.reloj.ir(71000);
  igual(b.fetch.llamadas, [0, 25000, 50000], 'tres plazos no siguieron la escalera');
  igual(b.ev.conexion, [[false, 70000]], 'tres plazos cruzados no avisaron de la conexión');
  b.s.detener();

  // un fetch que ignora la señal no congela la espera
  const c = montar(['sorda', armando()]);
  await c.reloj.ir(26000);
  igual(c.fetch.llamadas, [0, 25000], 'un fetch sordo congeló el sondeo');
  c.s.detener();
});

caso('un callback que truena no mata la espera', async () => {
  const errorOriginal = console.error;
  let reportados = 0;
  console.error = () => { reportados++; };
  try {
    const { reloj, fetch, s } = montar([armando()], {
      alCambiar: () => { throw new Error('la página se equivocó'); },
    });
    await reloj.ir(16000);
    igual(fetch.llamadas, [0, 5000, 10000, 15000], 'un alCambiar roto detuvo el sondeo');
    ok(reportados === 4, 'el error del callback no se reportó en consola');
    s.detener();
  } finally {
    console.error = errorOriginal;
  }
});

caso('se expone en window y en module.exports, sin eval', async () => {
  const caja = { console };
  caja.window = caja;
  vm.createContext(caja);
  vm.runInContext(FUENTE, caja);
  ok(caja.window.Sondeo && typeof caja.window.Sondeo.iniciar === 'function',
    'window.Sondeo no quedó expuesto');
  ok(typeof Sondeo.iniciar === 'function', 'module.exports no expone iniciar');
  // la CSP de /automatiza no permite 'unsafe-eval' (los comentarios sí lo nombran)
  const codigo = FUENTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok(!/\beval\s*\(|new\s+Function\b|\bFunction\s*\(/.test(codigo), 'usa eval o new Function');
  ok(!/\brequire\s*\(|\bimport\b/.test(codigo), 'tiene dependencias');
  assert.throws(() => Sondeo.iniciar({ fetch: () => {} }), /url/);
  comprobaciones++;
});

// ==========================================================================
(async () => {
  const setTimeoutReal = global.setTimeout;
  // si el módulo usara un timer real con el reloj inyectado, esto lo delata
  global.setTimeout = () => { throw new Error('el sondeo usó setTimeout real con reloj inyectado'); };
  try {
    for (const [nombre, fn] of casos) {
      try { await fn(); }
      catch (e) { e.message = `[${nombre}] ${e.message}`; throw e; }
    }
  } finally {
    global.setTimeout = setTimeoutReal;
  }

  // y con el reloj de verdad (el de la página): pide en seguida y se detiene solo
  const cambios = [];
  const real = Sondeo.iniciar({
    url: '/x',
    fetch: async () => respuesta(200, { estado: 'listo' }),
    documento: null,
    alCambiar: c => cambios.push(c.estado),
    esFinal: c => c.estado === 'listo',
  });
  await vaciar();
  igual(cambios, ['listo'], 'con el reloj real no pidió en seguida');
  ok(!real.activo, 'con el reloj real no se detuvo en el final');

  console.log(`sondeo: ${casos.length} casos, ${comprobaciones} comprobaciones OK`);
  // el plazo de 20 s de esa última petición es un timer real: no se espera
  process.exit(0);
})().catch(e => {
  console.error(e && e.stack || e);
  process.exit(1);
});
