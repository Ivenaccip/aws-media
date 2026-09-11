// M19 — el orbe de «la IA está trabajando», compartido por todo el producto.
// Mismo estilo que auth.js y monedero.js: IIFE, un objeto en window, sin build.
//
//   const mando = orbe.montar($('#hueco'), {texto:'Creando tu imagen · ~20 s',
//                                           tope: 32000, alAgotar: () => {...}});
//   mando.texto('Ya casi…');  mando.desmontar();
//
// montar() es SÍNCRONO: devuelve el mando ya usable y pinta AL INSTANTE la
// píldora definitiva con un núcleo CSS. El canvas WebGPU se pone encima con un
// cross-fade sólo si el device arrancó — así el ~20 % de sesiones sin WebGPU
// (iOS<26, Android viejo, Firefox, aceleración apagada) ve la misma píldora en
// la misma caja, no un hueco ni un parche feo.
//
// Reglas que impone el componente, no la página:
//   · El texto es la fuente de verdad (role=status), el canvas es decorado
//     (aria-hidden): un lector de pantalla nunca depende del orbe.
//   · Todo montaje lleva TOPE de paciencia medido contra reloj absoluto —
//     Chrome estrangula los timers en pestañas de fondo, justo donde nuestro
//     copy invita a irse. Al cruzarlo el orbe se apaga: el TRABAJO sigue, no
//     existe cancelación en el producto, y el copy jamás debe decir lo contrario.
//     En esperas alimentadas por polling, mando.latir() reinicia ese reloj en
//     cada avance real: lo que se mide entonces es el SILENCIO, no la espera.
//   · Idempotente por contenedor: dos montajes no son dos orbes.
//   · prefers-reduced-motion: sin pulso en el núcleo CSS y un frame estático
//     en el canvas.
//
// Lo que NO hace, a propósito: acompañar un error o una devolución de créditos.
// La página desmonta ANTES de pintar el fallo.
(function () {
  'use strict';

  const MOTOR_URL = '/orbe-gpu.v1.js';
  const LADO = 40;              // diámetro del orbe; la píldora mide lado+8
  const CRONO_MS = 60000;       // a partir de aquí la píldora dice cuánto lleva

  const CSS = `
.orbe-p{display:inline-flex;align-items:center;gap:11px;max-width:100%;
  background:rgba(18,20,26,.94);border:1px solid #3a3f4a;border-radius:999px;
  padding:4px 18px 4px 4px;font:13.5px/1.25 system-ui,sans-serif;color:#e8e6e0;
  box-shadow:0 2px 12px rgba(0,0,0,.35);vertical-align:middle}
.orbe-n{position:relative;flex:0 0 auto;width:var(--orbe-lado);height:var(--orbe-lado);
  border-radius:50%;overflow:hidden}
.orbe-css{position:absolute;inset:0;border-radius:50%;transition:opacity .18s ease;
  background:
    radial-gradient(circle at 32% 24%, #b28cff 0%, rgba(178,140,255,0) 58%),
    radial-gradient(circle at 68% 78%, #3ce0c0 0%, rgba(60,224,192,0) 62%),
    radial-gradient(circle at 50% 50%, #2a1e46 0%, #0d0a18 100%);
  animation:orbe-lat 2.6s ease-in-out infinite}
.orbe-c{position:absolute;inset:0;width:100%;height:100%;display:block;
  opacity:0;transition:opacity .18s ease}
.orbe-n.gpu .orbe-c{opacity:1}
.orbe-n.gpu .orbe-css{opacity:0}
.orbe-t{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.orbe-p.apagado{opacity:.55}
.orbe-p.apagado .orbe-css{animation:none;filter:saturate(.25)}
@keyframes orbe-lat{0%,100%{transform:scale(1);filter:brightness(1)}
  50%{transform:scale(1.07);filter:brightness(1.35)}}
@media (prefers-reduced-motion: reduce){.orbe-css{animation:none}}
@media (max-width:480px){.orbe-t{font-size:12.5px}}`;

  let cssPuesto = false;
  function ponerCss() {
    if (cssPuesto) return;
    cssPuesto = true;
    const s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // --- carga perezosa del motor (una sola vez por página) ---------------------
  let motorPromesa = null;
  function cargarMotor() {
    if (motorPromesa) return motorPromesa;
    motorPromesa = new Promise((ok, mal) => {
      if (window.__orbeMotor) return ok(window.__orbeMotor);
      if (!navigator.gpu) return mal(new Error('sin WebGPU'));
      const s = document.createElement('script');
      s.src = MOTOR_URL;
      s.async = true;
      s.onload = () => (window.__orbeMotor ? ok(window.__orbeMotor) : mal(new Error('motor vacío')));
      s.onerror = () => mal(new Error('no se pudo bajar el motor'));
      document.head.appendChild(s);
    });
    motorPromesa.catch(() => {});
    return motorPromesa;
  }

  // --- el reloj compartido: topes de paciencia y cronómetro -------------------
  // Un solo intervalo para todos los orbes, y una revisión extra al volver a la
  // pestaña: el intervalo puede no haber corrido, pero Date.now() no miente.
  const vivos = new Set();
  let reloj = 0;

  function revisar() {
    const ahora = Date.now();
    for (const m of Array.from(vivos)) m._tic(ahora);
    if (!vivos.size && reloj) { clearInterval(reloj); reloj = 0; }
  }
  function arrancarReloj() {
    if (!reloj) reloj = setInterval(revisar, 1000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revisar(); });

  const dosDigitos = n => (n < 10 ? '0' + n : '' + n);
  function transcurrido(ms) {
    const s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ':' + dosDigitos(s % 60);
  }

  const montados = new WeakMap();

  function montar(contenedor, opciones) {
    const o = opciones || {};
    if (!contenedor) throw new Error('orbe.montar necesita un contenedor');
    const previo = montados.get(contenedor);
    if (previo && !previo._muerto) {           // idempotente: no dos orbes
      if (o.texto != null) previo.texto(o.texto);
      if (o.estado) previo.estado(o.estado);
      return previo;
    }
    ponerCss();

    const lado = o.lado || LADO;
    const pildora = document.createElement('span');
    pildora.className = 'orbe-p';
    pildora.setAttribute('role', 'status');
    pildora.setAttribute('aria-live', 'polite');
    pildora.style.setProperty('--orbe-lado', lado + 'px');
    const nucleo = document.createElement('span');
    nucleo.className = 'orbe-n';
    const css = document.createElement('span');
    css.className = 'orbe-css';
    const canvas = document.createElement('canvas');
    canvas.className = 'orbe-c';
    canvas.setAttribute('aria-hidden', 'true');
    nucleo.appendChild(css);
    nucleo.appendChild(canvas);
    const texto = document.createElement('span');
    texto.className = 'orbe-t';
    texto.textContent = o.texto || 'Trabajando…';
    pildora.appendChild(nucleo);
    pildora.appendChild(texto);
    contenedor.appendChild(pildora);

    // el cronómetro cuelga del ÚLTIMO texto puesto, no del inicial: quien
    // espera lee «Grabando la narración · llevas 1:30», no «Trabajando…»
    let base = o.texto || 'Trabajando…';
    let desde = o.desde || Date.now();
    let limite = o.tope ? desde + o.tope : 0;
    let modo = o.estado === 'idle' ? 'idle' : 'pensando';
    let gpuCtl = null, agotado = false;

    const mando = {
      _muerto: false,
      get modo() { return modo; },
      get conGpu() { return !!gpuCtl; },

      estado(nuevo) {
        if (mando._muerto || (nuevo !== 'idle' && nuevo !== 'pensando')) return mando;
        modo = nuevo;
        if (gpuCtl) gpuCtl.estado(nuevo);
        else css.style.animationDuration = nuevo === 'pensando' ? '2.6s' : '5.2s';
        return mando;
      },

      texto(t) { if (!mando._muerto) { base = t; texto.textContent = t; } return mando; },

      // Hubo AVANCE real del trabajo: el tope vuelve a contar desde ahora.
      // En una espera alimentada por polling lo que importa no es cuánto
      // llevas esperando —una película larga tarda lo que tarda— sino cuánto
      // llevas SIN NOTICIAS. Si el orbe ya se había apagado por silencio y el
      // trabajo vuelve a dar señales, revive.
      latir() {
        if (mando._muerto) return mando;
        desde = Date.now();
        limite = o.tope ? desde + o.tope : 0;
        if (agotado) {
          agotado = false;
          pildora.classList.remove('apagado');
          texto.textContent = base;
          vivos.add(mando);
          arrancarReloj();
          pedirCanvas();
        }
        return mando;
      },

      // se cruzó el tope, o la página perdió contacto: el orbe se apaga, el
      // trabajo NO — no existe cancelación en el producto
      apagar(motivo) {
        if (mando._muerto || agotado) return mando;
        agotado = true;
        vivos.delete(mando);
        if (gpuCtl) { gpuCtl.destruir(); gpuCtl = null; }
        nucleo.classList.remove('gpu');
        pildora.classList.add('apagado');
        if (motivo) texto.textContent = motivo;
        return mando;
      },

      desmontar() {
        if (mando._muerto) return;
        mando._muerto = true;
        vivos.delete(mando);
        if (gpuCtl) { gpuCtl.destruir(); gpuCtl = null; }
        if (pildora.parentNode) pildora.parentNode.removeChild(pildora);
        if (montados.get(contenedor) === mando) montados.delete(contenedor);
      },

      _tic(ahora) {
        if (mando._muerto) return;
        if (limite && !agotado && ahora >= limite) {
          mando.apagar();
          try { o.alAgotar && o.alAgotar(mando); } catch (e) { /* nunca tumba la página */ }
          return;
        }
        if (!agotado && ahora - desde >= CRONO_MS) {
          texto.textContent = base + ' · llevas ' + transcurrido(ahora - desde);
        }
      },
    };

    montados.set(contenedor, mando);
    vivos.add(mando);
    arrancarReloj();

    // El canvas llega después, si llega; la píldora ya está completa. El
    // cross-fade espera al PRIMER FRAME PINTADO, no al adjuntar: montar con la
    // pestaña oculta o con la píldora fuera de la vista no pinta nada, y tapar
    // el núcleo CSS antes de tiempo deja un agujero vacío donde iba el orbe.
    function pedirCanvas() {
      if (gpuCtl) return;
      cargarMotor()
        .then(motor => motor.adjuntar(
          canvas, modo,
          () => { gpuCtl = null; nucleo.classList.remove('gpu'); },  // el núcleo vuelve
          () => { if (!mando._muerto && !agotado) nucleo.classList.add('gpu'); }))
        .then(ctl => {
          if (!ctl) return;
          if (mando._muerto || agotado) { ctl.destruir(); return; }
          gpuCtl = ctl;
          ctl.estado(modo);
        })
        .catch(() => { /* sin orbe: la píldora CSS ya está puesta y es suficiente */ });
    }
    pedirCanvas();

    return mando;
  }

  window.orbe = {
    montar,
    version: '1',
    // gate barato y sincrónico para decidir el layout; el de verdad es async
    soportado: () => !!navigator.gpu,
    // pide el motor en tiempo muerto para que el clic no pague el arranque en
    // frío de la Lambda que sirve los estáticos
    precargar() {
      if (!navigator.gpu) return;
      const ir = () => cargarMotor().then(m => m.precargar()).catch(() => {});
      if (window.requestIdleCallback) requestIdleCallback(ir, { timeout: 3000 });
      else setTimeout(ir, 1200);
    },
  };
})();
