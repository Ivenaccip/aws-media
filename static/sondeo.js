// RAG·11 — el sondeo de /automatiza: mira GET /api/publico/corridas/{id}
// hasta que la corrida termina, sin martillar la base y sin mentirle a quien
// espera. Mismo estilo que orbe.js: IIFE, un objeto en window, sin build.
//
//   const s = Sondeo.iniciar({
//     url: '/api/publico/corridas/' + id,
//     alCambiar: c => pintar(c),            // cada 200: la página decide qué pinta
//     esFinal: c => FINALES.has(c.estado),  // true → se detiene solo
//     alAviso: () => …,                     // una vez, a los 2 min SIN progreso
//     alTope: () => …,                      // a los 4 min sin progreso: se detiene
//     alConexion: ok => …,                  // false tras 3 fallos seguidos; true al volver
//     alError: (status, cuerpo) => …,       // 4xx que cancela (404, 410…)
//     progreso: c => c.estado + '|' + c.paso + '|' + c.lugar,
//   });
//   s.detener();  s.reanudar();   // reanudar pide YA y reinicia escalera y relojes
//   s.activo                      // false tras final, 4xx, tope o detener
//   s.siguienteEn                 // ms para el siguiente vistazo (null: pidiendo o parado)
//
// iniciar() también pide en seguida (así la llegada con el enlace se pinta sin
// esperar 5 s). Si la página ya tiene la respuesta fresca —el 202 del POST—,
// `inmediato: false` duerme el primer escalón antes del primer vistazo. Opcionales
// además: `fetch`, `reloj` ({ahora(), esperar(ms) → promesa}) y `documento`.
//
// La escalera y los plazos son los de la espera del ejemplo de MIX
// (static/mix.html, MXEJ_PASOS y mxEsperarEjemplo), que ya se probó con gente:
// empieza rápido y se va frenando, porque los primeros segundos es cuando
// puede estar a punto y a partir del minuto preguntar cada cinco solo carga la
// base. Lo que se agrega aquí, porque esta página la abre gente anónima desde
// un enlace compartido y no alguien con sesión:
//   · 429 no cancela: es API Gateway frenando. Se reintenta con su Retry-After
//     si lo manda, o duplicando la espera, siempre con techo (MAX_429_MS).
//   · 408 tampoco: es la petición la que se cansó, no la corrida.
//   · Pestaña oculta = no se pide nada. Al volver se pide en seguida: es justo
//     cuando la persona quiere ver en qué va, y la copia la invita a irse.
//   · El aviso y el tope miden SILENCIO, no espera: mientras la fila avanza
//     (cambia `progreso`), los dos vuelven a contar. Diez minutos en la fila
//     bajando de lugar no son «se pasó del tiempo».
//   · alConexion avisa tras 3 tropiezos seguidos, no al primero: Aurora se
//     duerme sola y el primer despertar tarda, y un parpadeo no merece aviso.
//
// El reloj, el fetch y el documento son inyectables para que tests/sondeo_nodo.js
// lo corra en node con un reloj de mentira, sin esperar de verdad. Por la CSP de
// /automatiza (script-src 'self'): nada de eval ni new Function, y ningún estilo.
(function (raiz) {
  'use strict';

  const Sondeo = {
    // copia exacta de MXEJ_PASOS: no decreciente (repite 5000 a propósito)
    PASOS: [5000, 5000, 5000, 10000, 10000, 20000],
    AVISO_MS: 120000,    // «Está tardando más que de costumbre»
    TOPE_MS: 240000,     // hasta cuándo se espera MIRANDO (el trabajo sigue)
    TIMEOUT_MS: 20000,   // plazo de cada petición, como el AbortSignal de MIX
    MAX_429_MS: 60000,   // techo del reintento por 429
    FALLOS_SIN_CONEXION: 3,   // tropiezos seguidos antes de alConexion(false)
  };

  // el reloj de verdad. Date.now y no un contador propio: Chrome estrangula los
  // timers en pestañas de fondo, así que lo que vale es la hora absoluta
  const RELOJ_REAL = {
    ahora: () => Date.now(),
    esperar: ms => new Promise(r => setTimeout(r, ms)),
  };

  // lo que la página considera «avanzó» si no pasa su propia firma
  const firmaPorDefecto = c => [c && c.estado, c && c.paso, c && c.lugar].join('|');

  // Retry-After en segundos. La forma de fecha HTTP no se interpreta: API
  // Gateway no la manda, y sin ella se duplica la espera, que es lo seguro
  function segundosDe(valor) {
    if (valor == null) return null;
    const s = String(valor).trim();
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    return Number(s);
  }

  // Un callback de la página que truena no puede matar la espera: el trabajo
  // sigue en la nube y el siguiente vistazo puede pintarse bien.
  function llamar(fn, ...args) {
    if (typeof fn !== 'function') return undefined;
    try { return fn(...args); }
    catch (e) {
      if (typeof console !== 'undefined' && console.error) console.error('Sondeo:', e);
      return undefined;
    }
  }

  Sondeo.iniciar = function (o) {
    o = o || {};
    if (!o.url) throw new Error('Sondeo: falta la url');
    // se guarda SUELTO y se llama sin receptor: window.fetch invocado como
    // método de `o` truena con «Illegal invocation»
    const pedirHttp = o.fetch || (typeof fetch === 'function' ? fetch : null);
    if (typeof pedirHttp !== 'function') throw new Error('Sondeo: falta fetch');
    const reloj = o.reloj || RELOJ_REAL;
    const doc = o.documento !== undefined ? o.documento
      : (typeof document !== 'undefined' ? document : null);
    const firmaDe = typeof o.progreso === 'function' ? o.progreso : firmaPorDefecto;

    // se leen al arrancar: una página (o el arnés) puede ajustarlos antes
    const PASOS = Sondeo.PASOS.slice();
    const AVISO = Sondeo.AVISO_MS, TOPE = Sondeo.TOPE_MS;
    const TIMEOUT = Sondeo.TIMEOUT_MS, MAX_429 = Sondeo.MAX_429_MS;
    const FALLOS = Sondeo.FALLOS_SIN_CONEXION;
    const paso = n => PASOS[Math.min(n, PASOS.length - 1)];

    // `turno` es la llave de cada bucle: detener/reanudar lo cambian y el
    // bucle viejo, al despertar de cualquier await, ve que ya no es el suyo y
    // se va sin tocar nada. Así nunca hay dos bucles pidiendo a la vez.
    let turno = 0, activo = false;
    let vuelta = 0;          // cuántas esperas lleva: el escalón que toca
    let ultimaEspera = 0;    // la última que se durmió (base del doble por 429)
    let desde = 0;           // desde cuándo NO hay progreso (aviso y tope)
    let avisado = false;
    let firma = null;        // el último progreso visto; sobrevive a reanudar
    let fallos = 0, sinConexion = false;   // hechos de la red, no del sondeo
    let enVuelo = null;      // AbortController de la petición en curso
    let siguiente = null;    // a qué hora (del reloj) toca el siguiente vistazo
    let escuchando = false;

    // Despertador: lo sacuden la pestaña al cambiar de visibilidad y
    // detener/reanudar. Quien duerme compite su espera contra él.
    let despertador, despertar;
    const nuevoDespertador = () => { despertador = new Promise(r => { despertar = r; }); };
    nuevoDespertador();
    const sacudir = () => { const d = despertar; nuevoDespertador(); d(); };

    const oculta = () => !!(doc && doc.hidden);
    const vivo = yo => activo && yo === turno;

    function escuchar(si) {
      if (!doc || typeof doc.addEventListener !== 'function' || si === escuchando) return;
      if (si) doc.addEventListener('visibilitychange', sacudir);
      else if (typeof doc.removeEventListener === 'function')
        doc.removeEventListener('visibilitychange', sacudir);
      escuchando = si;
    }

    function parar() {
      turno++;
      activo = false;
      siguiente = null;
      if (enVuelo) { enVuelo.abort(); enVuelo = null; }
      escuchar(false);
      sacudir();
    }

    function arrancar(inmediato) {
      parar();
      activo = true;
      vuelta = 0;
      ultimaEspera = 0;
      desde = reloj.ahora();
      avisado = false;
      escuchar(true);
      bucle(turno, inmediato);
    }

    // La conexión se mide con respuestas, no con navigator.onLine (que miente
    // detrás de un portal cautivo): cualquier cosa que conteste el servidor y
    // no sea un 5xx/408 quiere decir que hay red.
    function conexionBien() {
      fallos = 0;
      if (sinConexion) { sinConexion = false; llamar(o.alConexion, true); }
    }
    function tropiezo() {
      fallos++;
      if (fallos >= FALLOS && !sinConexion) { sinConexion = true; llamar(o.alConexion, false); }
    }

    // El aviso y el tope, contra el reloj absoluto. Devuelve false si llegó el
    // tope (y con él se detuvo) o si la página detuvo desde su callback.
    function revisarPlazos(yo) {
      const quieto = reloj.ahora() - desde;
      if (quieto >= TOPE) {
        // se detiene ANTES de avisar: si la página llama reanudar() desde
        // alTope, que encuentre el sondeo ya parado y arranque limpio
        parar();
        llamar(o.alTope);
        return false;
      }
      if (!avisado && quieto >= AVISO) {
        avisado = true;
        llamar(o.alAviso);
      }
      return vivo(yo);
    }
    const msAlPlazo = () => Math.max(1, (avisado ? TOPE : AVISO) - (reloj.ahora() - desde));

    // Duerme hasta `hasta` (hora del reloj). Despierta antes en los plazos
    // para que el aviso y el tope lleguen a su hora y no al siguiente
    // vistazo —con escalones de 20 s serían hasta 20 s tarde—, y no pide
    // nada mientras la pestaña está oculta. Devuelve true si toca pedir.
    async function dormir(yo, hasta) {
      let estuvoOculta = false;
      for (;;) {
        if (!vivo(yo)) return false;
        if (oculta()) {
          // oculta no corre ningún timer: solo se espera a que vuelva
          estuvoOculta = true;
          await despertador;
          continue;
        }
        // al volver se pide YA, antes de juzgar el silencio: lo que pasó
        // mientras no miraba puede ser justo el progreso que reinicia el tope
        if (estuvoOculta) return true;
        if (!revisarPlazos(yo)) return false;
        const ahora = reloj.ahora();
        if (ahora >= hasta) return true;
        await Promise.race([reloj.esperar(Math.min(hasta - ahora, msAlPlazo())), despertador]);
      }
    }

    // Una petición con plazo propio: una que se queda colgada sin contestar ni
    // fallar congelaría la espera entera. El plazo corre con el reloj
    // inyectado (no AbortSignal.timeout) para que el arnés lo pueda cruzar sin
    // esperar 20 s de verdad; al cruzarlo se aborta, y la carrera garantiza que
    // el bucle sigue aunque un fetch ignore la señal.
    async function pedir() {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      enVuelo = ctl;
      const AGOTADA = {};
      const plazo = reloj.esperar(TIMEOUT).then(() => AGOTADA);
      const trabajo = (async () => {
        const r = await pedirHttp(o.url, {
          signal: ctl ? ctl.signal : undefined,
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        let cuerpo = null, legible = true;
        try { cuerpo = await r.json(); } catch (e) { legible = false; }
        const h = r.headers && typeof r.headers.get === 'function' ? r.headers : null;
        return { status: r.status, cuerpo, legible,
                 reintentar: h ? h.get('Retry-After') : null };
      })();
      trabajo.catch(() => {});   // la que pierde la carrera no deja rechazos sueltos
      let res;
      try { res = await Promise.race([trabajo, plazo]); }
      catch (e) { res = { red: true }; }
      if (res === AGOTADA) {
        if (ctl) ctl.abort();
        res = { red: true, agotada: true };
      }
      if (enVuelo === ctl) enVuelo = null;
      return res;
    }

    // Qué hacer con lo que contestó. Devuelve cuánto dormir hasta el siguiente
    // vistazo, o null si el sondeo terminó (final, error o la página lo paró).
    function procesar(yo, res) {
      const st = res.red ? 0 : res.status;
      if (st >= 200 && st < 300 && res.legible) {
        conexionBien();
        if (!vivo(yo)) return null;
        let f;
        try { f = String(firmaDe(res.cuerpo)); } catch (e) { f = firma; }
        // la primera firma solo fija la base: que conteste no es que avance
        if (firma !== null && f !== firma) { desde = reloj.ahora(); avisado = false; }
        firma = f;
        llamar(o.alCambiar, res.cuerpo);
        if (!vivo(yo)) return null;
        if (llamar(o.esFinal, res.cuerpo)) { parar(); return null; }
        return paso(vuelta);
      }
      if (st === 429) {
        // es el servidor contestando: hay red, pero pide aire
        conexionBien();
        if (!vivo(yo)) return null;
        const ra = segundosDe(res.reintentar);
        const base = paso(vuelta);
        const ms = ra !== null ? Math.max(ra * 1000, base)
          : 2 * Math.max(ultimaEspera, base);
        return Math.min(ms, MAX_429);
      }
      if (st >= 400 && st < 500 && st !== 408) {
        // Un 4xx no va a mejorar por insistir: el id no existe, caducó, o ya
        // no es de nadie. Se detiene ANTES de avisar (por si la página reanuda).
        conexionBien();
        if (!vivo(yo)) return null;
        parar();
        llamar(o.alError, st, res.cuerpo);
        return null;
      }
      // sin red, plazo cruzado, 408, 5xx, o un 200 que no es JSON (un portal
      // cautivo, un proxy): pasajero. Se reintenta con la escalera.
      tropiezo();
      if (!vivo(yo)) return null;
      return paso(vuelta);
    }

    async function bucle(yo, inmediato) {
      let hasta = reloj.ahora();
      if (!inmediato) { ultimaEspera = paso(vuelta++); hasta += ultimaEspera; }
      for (;;) {
        siguiente = hasta;
        if (!(await dormir(yo, hasta))) return;
        siguiente = null;
        const res = await pedir();
        if (!vivo(yo)) return;   // detener/reanudar mientras volaba: ya no es suya
        const espera = procesar(yo, res);
        if (espera === null || !vivo(yo)) return;
        vuelta++;
        ultimaEspera = espera;
        hasta = reloj.ahora() + espera;
      }
    }

    arrancar(o.inmediato !== false);

    return {
      detener() { if (activo) parar(); },
      reanudar() { arrancar(true); },
      get activo() { return activo; },
      // para «Volvemos a preguntar en 8 s»: la página lo lee con su propio tic
      get siguienteEn() {
        return activo && siguiente !== null ? Math.max(0, siguiente - reloj.ahora()) : null;
      },
    };
  };

  if (typeof module === 'object' && module && module.exports) module.exports = Sondeo;
  if (raiz) raiz.Sondeo = Sondeo;
})(typeof window !== 'undefined' ? window : null);
