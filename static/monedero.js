// M1 — cabecera compartida del monedero: el saldo se ve SIEMPRE, en todas las
// páginas. Consume GET /api/creditos; si el monedero no está activo (dev local
// con CREDITOS_BACKEND=off) no pinta nada. Las páginas escuchan el evento
// 'monedero' para pintar costos junto a sus botones, y llaman
// window.monedero.refrescar() después de cada acción que cobra.
//
// UI·19: cuando el saldo cambia, el número rueda hasta el nuevo y la píldora
// se tiñe un instante. Si además llega el evento 'cobro' en window
// ({ costo, rect: { x, y, ancho, alto } }, lo manda BotonCobro de web/ solo
// cuando el cobro salió bien), un «−N» vuela del botón a la píldora.
//
// UI·25: si /api/creditos trae `avisos_sin_leer` (el buzón de UI·17), un
// punto aparece sobre el boleto: crece con un rebote y suelta UNA onda, solo
// cuando el número sube (al cargar o al volver a la pestaña), nunca en cada
// refresco con el mismo número. La base de «ya lo vi» vive con el último
// saldo de la pestaña (UI·18), para que cambiar de pantalla no la repita.
// Hoy el servidor no lo manda: el punto no se pinta. El panel del buzón y
// sus animaciones (#mon-buzon) son de UI·17.
(function () {
  const est = { activo: false, saldo: null, tarifas: {}, packs: [] };

  // M4 · recarga CERRADA (decisión del dueño, 2026-09-26). Mientras los
  // Payment Links de Stripe no estén firmes, NADA de la interfaz manda a
  // comprar: ni el ＋ de la píldora ni los botones «Recargar» de las pantallas
  // se pintan, y el aviso de «te faltan créditos» manda al canal de la
  // comunidad en vez de a una liga. Un botón que lleva a una liga que falla es
  // peor que no tener botón.
  //
  // Este es el ÚNICO interruptor: ponerlo en true vuelve a encender de golpe
  // los siete puntos de entrada (el ＋, los cuatro botones «Recargar» de
  // competencia/estilos/mix/shorts y los avisos de crear/imágenes). Las
  // pantallas lo leen en window.monedero.recarga; el texto, en .cta
  const RECARGA = false;
  const CTA = RECARGA
    ? 'Pulsa ＋ arriba a la derecha para ver cómo conseguir más.'
    : 'Escríbenos por el canal de la comunidad para conseguir más.';

  // Mock del dueño (Miro, 2026-09-10): boleto · píldora [＋ | N créditos] · avatar.
  // El ＋ abre la recarga; el avatar despliega el menú con «Salir».
  // UI·18: `view-transition-name` igual en todas las pantallas. Entre dos
  // pantallas de web/ el navegador funde el resto y a esta la deja quieta.
  const el = document.createElement('div');
  el.id = 'monedero';
  el.style.cssText =
    'position:fixed;top:12px;right:14px;z-index:1000;display:none;align-items:center;gap:12px;' +
    'font:13px/1 system-ui,sans-serif;color:#ece8e1;view-transition-name:monedero';
  const FONDO = 'background:rgba(18,20,26,.94);border:1px solid #22354f;' +
    'box-shadow:0 2px 12px rgba(0,0,0,.4);';
  const TICKET =
    '<svg viewBox="0 0 26 18" width="30" height="21" fill="currentColor" aria-hidden="true">' +
    '<path d="M1 3a2 2 0 0 1 2-2h20a2 2 0 0 1 2 2v3.2a2.8 2.8 0 0 0 0 5.6V15a2 2 0 0 1-2 2H3' +
    'a2 2 0 0 1-2-2v-3.2a2.8 2.8 0 0 0 0-5.6zM17.5 2.6v1.9h1.4V2.6zm0 3.8v1.9h1.4V6.4zm0 3.8' +
    'v1.9h1.4v-1.9zm0 3.8v1.9h1.4V14z"/></svg>';
  const PERSONA =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">' +
    '<circle cx="12" cy="8.2" r="3.6"/><path d="M4.5 19.4a7.5 7.5 0 0 1 15 0v.6h-15z"/></svg>';
  // el círculo del ＋ va al ras de la píldora: mismo alto que ella (su caja de
  // 40px con bordes), sin sobresalir — feedback del dueño. Con la recarga
  // cerrada no se pinta en absoluto: marcarlo `hidden` NO bastaría, porque su
  // display:flex inline le gana al atributo (la misma trampa que documenta
  // #mon-menu más abajo) y el ＋ nacería visible igual.
  const MAS = RECARGA
    ? '<button id="mon-cta" title="Recargar créditos" style="' + FONDO + 'width:40px;height:40px;' +
        'box-sizing:border-box;margin:-1px 0 -1px -1px;border-radius:50%;color:#ece8e1;cursor:pointer;font:600 20px/1 system-ui;' +
        'display:flex;align-items:center;justify-content:center;padding:0 0 2px 0">＋</button>'
    : '';
  // sin el ＋ pegado a la izquierda, el saldo se centra en la píldora
  const PAD_SALDO = RECARGA ? '0 20px 0 14px' : '0 18px';
  el.innerHTML =
    // nacen con display:none (el `hidden` no basta contra un display inline):
    // antes del primer saldo, counter() pintaría «0 créditos», un saldo falso.
    // pintarSaldo los enciende
    // UI·25: el punto va sobre el boleto. Sin display en ningún lado: su
    // `hidden` tiene que ganar (la misma trampa que el menú de abajo)
    '<span id="mon-ticket" hidden title="tus créditos" style="display:none;position:relative;color:#ece8e1">' + TICKET +
      '<span id="mon-punto" hidden aria-hidden="true"></span><span id="mon-sin-leer" class="mon-oculto"></span></span>' +
    '<span id="mon-pill" hidden style="' + FONDO + 'display:none;align-items:center;height:38px;' +
      'border-radius:999px">' + MAS +
      // UI·19: lo que se ve rueda y no se lee (#mon-cifra); lo que se lee es
      // el texto de verdad (#mon-real), y los cambios se anuncian en #mon-aviso
      '<span id="mon-saldo" style="font:600 14px system-ui;white-space:nowrap;padding:' + PAD_SALDO + '">' +
        '<span id="mon-cifra" aria-hidden="true"></span><span id="mon-real" class="mon-oculto"></span>' +
      '</span>' +
    '</span>' +
    '<span id="mon-aviso" class="mon-oculto" role="status"></span>' +
    // M2: el avatar despliega «Salir» (auth.salir limpia tokens y pasa por el
    // /logout del Hosted UI — clave tras un cambio de permisos: el re-login
    // trae los grupos nuevos en el token). Solo se pinta si el login está activo.
    '<span id="mon-user" hidden style="position:relative">' +
      '<button id="mon-avatar" title="tu cuenta" style="' + FONDO + 'width:38px;height:38px;' +
        'border-radius:50%;color:#ece8e1;cursor:pointer;display:flex;align-items:center;' +
        'justify-content:center;padding:0">' + PERSONA + '</button>' +
      // OJO: sin `display` inline — un display inline le gana al atributo
      // hidden y el menú nacería abierto; toggleMenu pone flex/none
      '<span id="mon-menu" style="' + FONDO + 'position:absolute;top:46px;right:0;' +
        'border-radius:12px;padding:6px;display:none;flex-direction:column;min-width:170px">' +
        '<span id="mon-email" style="display:block;padding:8px 12px;color:#93a3b8;font-size:12px;' +
          'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px"></span>' +
        '<button id="mon-salir" style="background:none;border:0;color:#ece8e1;cursor:pointer;' +
          'font:13px system-ui;display:block;width:100%;text-align:left;padding:8px 12px;' +
          'border-radius:8px" onmouseover="this.style.background=\'#18293f\'" ' +
          'onmouseout="this.style.background=\'none\'">Cerrar sesión</button>' +
      '</span>' +
    '</span>';

  // UI·19: el número rueda con una propiedad registrada como entero, que el
  // navegador sabe interpolar, pintada con counter(). Registrarla es a la vez
  // la prueba de soporte: sin CSS.registerProperty (Firefox < 128, Safari <
  // 16.4) la transición no interpola y el número cambia de golpe, como antes.
  try {
    CSS.registerProperty({ name: '--mon-saldo', syntax: '<integer>', inherits: false, initialValue: '0' });
  } catch { /* sin la API, o ya registrada por otra copia de este archivo */ }
  // UI·25: 300 ms la llegada, 900 ms la onda; la onda sale cuando el punto
  // ya casi llegó (250 ms). Una sola vez: después, quieto. RESORTE es una
  // copia de --curva-resorte (web/src/estilos/tokens.css), porque las
  // pantallas viejas no cargan tokens.css; monedero.test.ts vigila que sean
  // iguales
  const LLEGA_MS = 300, ONDA_ESPERA_MS = 250, ONDA_MS = 900;
  const RESORTE = 'linear(0, 0.074, 0.244, 0.45, 0.649, 0.817, 0.944, 1.028, 1.075, 1.094, ' +
    '1.092, 1.078, 1.06, 1.04, 1.023, 1.009, 1, 0.994, 0.992, 0.991, 0.992, 0.994, 0.996, 0.997, 1)';
  const ESTILO = document.createElement('style');
  ESTILO.textContent =
    // 700 ms: lo bastante lento para leer que bajó, no tanto como para esperar
    '#mon-cifra{counter-reset:mon-saldo var(--mon-saldo);font-variant-numeric:tabular-nums;' +
      'transition:--mon-saldo 700ms cubic-bezier(0,0,.2,1)}' +
    '#mon-cifra::after{content:counter(mon-saldo) " créditos ✦"}' +
    // 900 ms: el tinte llega rápido (20 %) y se va despacio
    '#mon-pill.mon-tinte{animation:mon-tinte 900ms cubic-bezier(0,0,.2,1)}' +
    '@keyframes mon-tinte{20%{background-color:#2e2110}}' +   // --color-aviso-fondo
    // 600 ms: el «−N» sale del botón y se apaga al llegar a la píldora
    '.mon-vuelo{position:fixed;z-index:1001;pointer-events:none;font:600 14px system-ui,sans-serif;' +
      'color:#f0a94a;transform:translate(-50%,-50%);opacity:0;' +
      'animation:mon-vuela 600ms cubic-bezier(.4,0,.2,1) forwards}' +
    '@keyframes mon-vuela{20%{opacity:1}100%{opacity:0;' +
      'transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy))) scale(.85)}}' +
    // lo guardado que el servidor no pudo confirmar (sin red, base
    // despertando): se ve más apagado hasta que conteste
    '#mon-pill.mon-sin-confirmar{opacity:.6}' +
    '.mon-oculto{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;' +
      'overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}' +
    // las pantallas viejas no cargan tokens.css: la regla de quietud va aquí
    // también (carta.css trae la suya, igual que tokens.css)
    // UI·25: el punto ámbar con un aro del color del fondo, para que se
    // despegue del boleto
    '#mon-punto{position:absolute;top:-3px;right:-3px;width:9px;height:9px;border-radius:50%;' +
      'background:#f0a94a;box-shadow:0 0 0 2px #0b1626;pointer-events:none}' +
    // sin linear() (Safari < 17.2) la segunda declaración no se entiende y
    // queda la primera, un rebote parecido
    '#mon-punto.mon-llega{animation:mon-punto-llega ' + LLEGA_MS + 'ms cubic-bezier(.34,1.56,.64,1);' +
      'animation:mon-punto-llega ' + LLEGA_MS + 'ms ' + RESORTE + '}' +
    '@keyframes mon-punto-llega{from{scale:0}}' +
    '#mon-punto::after{content:"";position:absolute;inset:0;border-radius:50%;border:2px solid #f0a94a;opacity:0}' +
    '#mon-punto.mon-onda::after{animation:mon-onda ' + ONDA_MS + 'ms cubic-bezier(0,0,.2,1) ' + ONDA_ESPERA_MS + 'ms 1}' +
    '@keyframes mon-onda{from{opacity:.7;scale:1}to{opacity:0;scale:3}}' +
    '@media (prefers-reduced-motion: reduce){#mon-cifra{transition:none}' +
      '#mon-pill.mon-tinte{animation:none}.mon-vuelo{display:none}' +
      '#mon-punto.mon-llega,#mon-punto.mon-onda::after{animation:none}}';
  (document.head || document.documentElement).appendChild(ESTILO);

  function sinMovimiento() {
    try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  }

  function textoRecarga() {
    const packs = est.packs.map(p => `${p.creditos} créditos — $${p.usd.toFixed(2)} dólares`).join('\n· ');
    return 'Para recargar créditos escríbenos por el canal de la comunidad.\n\nPacks:\n· ' +
      (packs || 'consulta los packs en el canal') +
      '\n\nLos créditos comprados no caducan.';
  }

  // M4: si el servidor manda Payment Links, el CTA abre un panel de compra;
  // sin links (dev local o Stripe aún no configurado) cae al aviso concierge.
  let panel = null;
  function togglePanel() {
    if (!RECARGA) return;   // recarga cerrada: ni panel ni aviso concierge
    if (panel) { panel.remove(); panel = null; return; }
    if (!est.packs.some(p => p.link)) { alert(textoRecarga()); return; }
    panel = document.createElement('div');
    panel.id = 'mon-panel';
    panel.style.cssText =
      'position:fixed;top:60px;right:14px;z-index:1000;width:min(280px, calc(100vw - 28px));' +
      'background:rgba(18,20,26,.97);border:1px solid #22354f;border-radius:14px;padding:14px;' +
      'font:13px/1.5 system-ui,sans-serif;color:#ece8e1;box-shadow:0 4px 18px rgba(0,0,0,.5)';
    panel.innerHTML =
      '<div style="font-weight:600;margin-bottom:8px">Recargar créditos</div>' +
      est.packs.map(p => p.link
        ? `<a href="${p.link}" target="_blank" rel="noopener" style="display:block;margin-bottom:6px;` +
          'padding:8px 12px;border-radius:9px;background:#18293f;border:1px solid #22354f;' +
          `text-decoration:none;color:#ece8e1">⚡ ${p.creditos} créditos — $${p.usd.toFixed(2)} dólares</a>`
        : `<div style="margin-bottom:6px;color:#93a3b8">⚡ ${p.creditos} créditos — $${p.usd.toFixed(2)} dólares</div>`
      ).join('') +
      '<div style="color:#93a3b8;font-size:11.5px;margin-top:6px">El pago abre en Stripe. ' +
      'Al volver a esta pestaña, tu saldo se actualiza solo (puede tardar unos segundos). ' +
      'Los créditos comprados no caducan.</div>';
    document.body.appendChild(panel);
    setTimeout(() => addEventListener('click', cerrarFuera), 0);
  }
  function cerrarFuera(e) {
    if (panel && !panel.contains(e.target) && !el.contains(e.target)) {
      panel.remove(); panel = null;
    }
    if (!panel) removeEventListener('click', cerrarFuera);
  }

  function toggleMenu() {
    const menu = el.querySelector('#mon-menu');
    const abrir = menu.style.display === 'none';
    menu.style.display = abrir ? 'flex' : 'none';
    if (abrir) setTimeout(() => addEventListener('click', cerrarMenuFuera), 0);
  }
  function cerrarMenuFuera(e) {
    const user = el.querySelector('#mon-user');
    if (!user.contains(e.target)) {
      el.querySelector('#mon-menu').style.display = 'none';
      removeEventListener('click', cerrarMenuFuera);
    }
  }

  // M3: la primera petición tras la pausa de la base puede dar 503/504 mientras
  // despierta (~15-30 s) — reintenta con backoff en vez de dejar la pastilla
  // invisible hasta la siguiente navegación.
  const ESPERAS_MS = [2000, 4000, 8000, 15000, 30000];
  let reintento = 0, reintentoT = null;

  function refrescar() { reintento = 0; return intentar(); }

  // UI·18: el último saldo de ESTA pestaña. La pantalla siguiente pinta la
  // píldora con él desde el primer cuadro, antes de que /api/creditos
  // conteste; sin eso la píldora no existe cuando el navegador fotografía la
  // pantalla nueva, y en vez de quedarse quieta se apaga y vuelve a salir.
  // Lleva el `sub` del token: otra cuenta en la misma pestaña no lo ve.
  // Caduca a los 15 min (la pantalla anterior lo renueva en cada respuesta
  // buena): más viejo, mejor esperar al servidor. Mientras el servidor no lo
  // confirme, es provisional (ver sinConfirmar).
  const ULTIMO = 'monedero:ultimo', VIGENCIA_MS = 15 * 60 * 1000;
  let saliendo = false;   // una respuesta que llega tras «Cerrar sesión» no se guarda
  function guardarUltimo(saldo) {
    if (saliendo) return;
    try {
      sessionStorage.setItem(ULTIMO, JSON.stringify({ quien: delToken().sub || '', saldo, t: Date.now(),
        sesion: !el.querySelector('#mon-user').hidden, avisos: avisosVistos }));
    } catch { /* sin sessionStorage: se pinta al llegar el saldo, como antes */ }
  }
  function olvidarUltimo() {
    try { sessionStorage.removeItem(ULTIMO); } catch { /* nada que olvidar */ }
  }
  function pintarUltimo() {
    let u = null;
    try { u = JSON.parse(sessionStorage.getItem(ULTIMO)); } catch { return; }
    if (!u || typeof u.saldo !== 'number' || u.quien !== (delToken().sub || '')) return;
    // con sesión siempre hay `sub`: sin él, lo guardó una respuesta tardía de
    // la cuenta que acaba de salir
    if (u.sesion && !u.quien) return;
    if (!(Date.now() - u.t < VIGENCIA_MS)) return;
    pintarSaldo(u.saldo);
    pintarAvisos(u.avisos, true);   // quieto, y fija la base de «ya lo vi»
    if (u.sesion) {
      el.querySelector('#mon-user').hidden = false;
      el.querySelector('#mon-email').textContent = delToken().email || '';
    }
  }

  // si el monedero resultó apagado (CREDITOS_BACKEND=off) después de pintar
  // el guardado. `hidden` no bastaría: el display:flex inline le gana
  function ocultarSaldo() {
    pintado = null;
    avisosVistos = null;
    est.activo = false; est.saldo = null;
    anunciar('');
    el.querySelector('#mon-punto').hidden = true;
    el.querySelector('#mon-ticket').style.display = 'none';
    el.querySelector('#mon-pill').style.display = 'none';
    if (el.querySelector('#mon-user').hidden) el.style.display = 'none';
  }

  // UI·19: el último número pintado en ESTA página (el guardado de UI·18
  // cuenta). null = nada todavía: lo primero que se pinta no rueda.
  let pintado = null, tinteT = null;

  function pintarSaldo(saldo) {
    el.style.display = 'flex';
    el.querySelector('#mon-ticket').hidden = false;
    el.querySelector('#mon-pill').hidden = false;
    el.querySelector('#mon-ticket').style.display = el.querySelector('#mon-pill').style.display = 'flex';
    el.querySelector('#mon-real').textContent = `${saldo} créditos ✦`;
    const n = Math.trunc(Number(saldo)) || 0, antes = pintado;
    const cifra = el.querySelector('#mon-cifra');
    pintado = n;
    sinConfirmar(false);
    if (antes === null) {
      // sin transición: fija el valor antes de devolvérsela
      cifra.style.transition = 'none';
      cifra.style.setProperty('--mon-saldo', String(n));
      void getComputedStyle(cifra).getPropertyValue('--mon-saldo');
      cifra.style.transition = '';
      return '';
    }
    if (n === antes) return '';
    cifra.style.setProperty('--mon-saldo', String(n));
    tintar();
    // el número real, al instante, para quien no ve la animación
    return 'Tu saldo: ' + n + ' créditos';
  }

  // #mon-aviso (role=status) dice lo que cambió y se vacía a los 5 s: si se
  // quedara, quien recorre la cabecera leería el saldo dos veces (este y
  // #mon-real), con dos redacciones
  let avisoT = null;
  function anunciar(texto) {
    const aviso = el.querySelector('#mon-aviso');
    aviso.textContent = texto;
    clearTimeout(avisoT);
    if (texto) avisoT = setTimeout(() => { aviso.textContent = ''; }, 5000);
  }

  // lo pintado desde lo guardado, cuando el servidor no contesta: la píldora
  // se apaga un poco y se lee «sin confirmar». La primera respuesta buena lo
  // quita (pintarSaldo). Solo después de un fallo: en el camino feliz
  // contesta en milisegundos y la píldora no cambia entre pantallas
  const SIN_CONFIRMAR = ' (sin confirmar)';
  function sinConfirmar(si) {
    const pill = el.querySelector('#mon-pill'), real = el.querySelector('#mon-real');
    pill.classList.toggle('mon-sin-confirmar', si);
    if (si) {
      pill.title = 'Sin conexión: este saldo puede no estar al día';
      if (!real.textContent.endsWith(SIN_CONFIRMAR)) real.textContent += SIN_CONFIRMAR;
    } else pill.removeAttribute('title');
  }

  // UI·25: `avisosVistos` es el último avisos_sin_leer que ESTA pestaña ya
  // enseñó (lo guardado cuenta; null vale 0). La onda sale solo si el
  // servidor trae MÁS.
  let avisosVistos = null;
  const quitarT = {};
  function reanimar(nodo, clase, ms) {
    nodo.classList.remove(clase);
    void nodo.offsetWidth;   // reinicia la animación
    nodo.classList.add(clase);
    clearTimeout(quitarT[clase]);
    quitarT[clase] = setTimeout(() => nodo.classList.remove(clase), ms);
  }
  // Devuelve lo que hay que anunciar: los avisos nuevos se dicen también con
  // «reducir movimiento», aunque el punto no se mueva.
  function pintarAvisos(n, quieto) {
    if (!Number.isInteger(n) || n < 0) return '';   // hoy /api/creditos no lo trae
    if (!quieto && document.hidden) return '';       // la onda no se gasta sin nadie mirando
    const punto = el.querySelector('#mon-punto');
    const antes = avisosVistos ?? 0, estaba = !punto.hidden;
    avisosVistos = n;
    el.querySelector('#mon-sin-leer').textContent =
      n === 0 ? '' : n === 1 ? '1 aviso sin leer' : n + ' avisos sin leer';
    punto.hidden = n === 0;
    if (n === 0) { punto.classList.remove('mon-llega', 'mon-onda'); return ''; }
    if (quieto || n <= antes) return '';
    if (!sinMovimiento()) {
      if (!estaba) reanimar(punto, 'mon-llega', LLEGA_MS);
      reanimar(punto, 'mon-onda', ONDA_ESPERA_MS + ONDA_MS);
    }
    return 'Tienes ' + el.querySelector('#mon-sin-leer').textContent;
  }

  function tintar() {
    const p = el.querySelector('#mon-pill');
    p.classList.remove('mon-tinte');
    void p.offsetWidth;   // reinicia la animación si ya estaba corriendo
    p.classList.add('mon-tinte');
    clearTimeout(tinteT);
    tinteT = setTimeout(() => p.classList.remove('mon-tinte'), 900);
  }

  // UI·19: el «−N» del botón que cobró a la píldora. Va a <body>, fuera de
  // #monedero, y no se enfoca ni se lee: el aviso de #mon-aviso ya lo dice.
  function volar(e) {
    const d = (e && e.detail) || {};
    const costo = Math.trunc(Number(d.costo)), r = d.rect;
    if (pintado === null || !el.isConnected || !(costo > 0) || !r || !(r.ancho > 0) || sinMovimiento()) return;
    const destino = el.querySelector('#mon-cifra').getBoundingClientRect();
    const x = r.x + r.ancho / 2, y = r.y + r.alto / 2;
    const n = document.createElement('span');
    n.className = 'mon-vuelo';
    n.setAttribute('aria-hidden', 'true');
    n.textContent = '−' + costo;
    n.style.left = x + 'px';
    n.style.top = y + 'px';
    n.style.setProperty('--dx', (destino.left + destino.width / 2 - x) + 'px');
    n.style.setProperty('--dy', (destino.top + destino.height / 2 - y) + 'px');
    const quitar = () => n.remove();
    n.addEventListener('animationend', quitar);
    setTimeout(quitar, 1000);   // por si la animación no llega a correr
    document.body.appendChild(n);
  }

  // Cada petición lleva su número y solo cuenta la última que se PIDIÓ: una
  // respuesta vieja que llega tarde (un refresco lento que salió antes del
  // cobro) no regresa el saldo, ni rueda, ni se guarda.
  let pedido = 0;
  async function intentar() {
    clearTimeout(reintentoT);
    const mio = ++pedido;
    try {
      const r = await fetch('/api/creditos');
      if (mio !== pedido) return;
      if (!r.ok) { fallo(); return; }
      const d = await r.json();
      if (mio !== pedido) return;
      if (!d.activo) { olvidarUltimo(); ocultarSaldo(); return; }
      reintento = 0;
      est.activo = true; est.saldo = d.saldo; est.tarifas = d.tarifas || {}; est.packs = d.packs || [];
      const dice = [pintarSaldo(d.saldo), pintarAvisos(d.avisos_sin_leer)].filter(Boolean);
      if (dice.length) anunciar(dice.join('. '));
      guardarUltimo(d.saldo);
      document.dispatchEvent(new CustomEvent('monedero', { detail: est }));
    } catch { if (mio === pedido) fallo(); /* sin red: se reintenta igual */ }
  }
  function fallo() {
    // lo que se ve vino de lo guardado y nadie lo ha confirmado aquí
    if (pintado !== null && est.saldo === null) sinConfirmar(true);
    programarReintento();
  }
  function programarReintento() {
    if (reintento >= ESPERAS_MS.length) return;   // se rinde en silencio; visibilitychange lo revive
    reintentoT = setTimeout(intentar, ESPERAS_MS[reintento++]);
  }

  function delToken() {
    // el id_token es un JWT: el payload trae el email y el sub (solo para
    // mostrarlos y para no enseñarle a una cuenta el saldo de otra)
    try {
      const t = localStorage.getItem('auth_id_token');
      return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) || {};
    } catch { return {}; }
  }

  function montar() {
    document.body.appendChild(el);
    const mas = el.querySelector('#mon-cta');
    if (mas) mas.onclick = togglePanel;   // no existe con la recarga cerrada
    el.querySelector('#mon-avatar').onclick = toggleMenu;
    el.querySelector('#mon-salir').onclick = () => {
      if (confirm('¿Cerrar sesión?')) { saliendo = true; olvidarUltimo(); window.auth.salir(); }
    };
    pintarUltimo();
    if (window.auth) window.auth.config().then(c => {
      if (!c.activo) return;
      el.querySelector('#mon-user').hidden = false;   // el avatar (y su Salir)
      el.querySelector('#mon-email').textContent = delToken().email || '';
      el.style.display = 'flex';   // con sesión, la cabecera se ve aunque el
      refrescar();                 // saldo tarde — el logout siempre a mano
    });
    refrescar();
  }

  // UI·18: se monta en DOMContentLoaded o en `pagereveal`, lo que llegue
  // primero. pagereveal va justo antes del primer cuadro: si la pantalla
  // tarda en cargar sus módulos, DOMContentLoaded llega tarde y la píldora
  // no saldría en la foto de la View Transition (se apagaría y volvería).
  let montado = false;
  function montarUnaVez() {
    if (montado || !document.body) return;
    montado = true;
    montar();
  }

  // UI·18: la transición entre pantallas fotografía la nueva en pagereveal.
  // Chromium espera al módulo (blocking="render") y #raiz ya trae la
  // pantalla; donde no se espera (Safari), #raiz sigue vacío y el fundido
  // iría hacia una página en blanco: mejor navegar como antes. Las viejas
  // no tienen #raiz
  addEventListener('pagereveal', e => {
    const raiz = document.getElementById('raiz');
    if (e.viewTransition && raiz && !raiz.firstElementChild) e.viewTransition.skipTransition();
  });

  document.addEventListener('visibilitychange', () => { if (!document.hidden) refrescar(); });
  addEventListener('cobro', volar);
  // recargar(): lo mismo que pulsar el ＋ de la cabecera. Existe porque los
  // avisos de «te faltan créditos» de otras pantallas enlazaban a
  // /monedero.html, que NUNCA ha existido: el CTA del 402 era un 404 duro.
  window.monedero = { get: () => est, refrescar, textoRecarga, recargar: togglePanel,
                      recarga: RECARGA, cta: CTA };
  if (document.body) montarUnaVez();
  else {
    addEventListener('DOMContentLoaded', montarUnaVez);
    addEventListener('pagereveal', montarUnaVez);
  }
})();
