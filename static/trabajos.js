// UI·15 — «Tus trabajos», el cuadro de abajo a la derecha (dueño, 25-sep).
//
// Enseña lo que corre (película, clip, shorts, corte propuesto, estilos,
// competencia), lo que terminó en las últimas 24 h con su enlace y lo que falló
// con los créditos devueltos. Va plegado; se abre solo cuando algo termina o
// falla y no lo habías visto. Lo que cierras no vuelve en este navegador.
//
// También aloja los avisos rápidos (guardado, sin conexión, un fallo sin
// campo): window.avisos.mostrar(texto, {tipo, accion, segundos}).
// Y las subidas que hace el navegador: window.trabajos.local(id, {...}).
//
// E2 — la copia que edita la IA (`tipo: "edicion"`) trae un objeto `ficha.edicion` con TODO lo que se
// pinta: los tres pasos y en cuál va, el pedido, el resumen, el enlace al editor y el error en tres
// partes con su «Reintentar». Este archivo no arma frases de esa ficha: las pinta (con esc(), como todo
// lo que viene del servidor) y nada más. Las dos únicas frases suyas son fijas: «Llevas m:ss. Puedes
// cerrar esta pestaña: sigue en la nube.» y «Ábrelo en el editor para revisar los cortes y renderizarlo.»
//
// Lee GET /api/trabajos. Solo sondea mientras algo corre y la pestaña se ve:
// la API y los trabajos comparten techo de ejecuciones (docs/OPERACION.md).
(function () {
  const HORAS_CERRADO = 48;          // lo cerrado se recuerda un poco más que lo visible
  const CLAVE_CERRADOS = 'trabajos-cerrados', CLAVE_VISTOS = 'trabajos-vistos';

  // --- lo que no toca el DOM (lo prueba tests/test_ui15_trabajos.py en node) ---
  function deEstaPantalla(url, loc) {
    try {
      const u = new URL(url, loc.origin || 'http://x');
      if (u.pathname !== loc.pathname) return false;
      if (!u.search) return true;    // /clip.html: la pantalla ya enseña su lista
      return new URLSearchParams(loc.search).get('p') === u.searchParams.get('p');
    } catch (e) { return false; }
  }
  function visibles(lista, cerrados, loc) {
    return lista.filter(t => !(t.estado !== 'corriendo' && cerrados[t.id]) && !deEstaPantalla(t.url || '', loc));
  }
  function resumen(lista) {
    const n = e => lista.filter(t => t.estado === e).length;
    const curso = n('corriendo'), listos = n('listo'), fallos = n('error');
    const partes = [];
    if (curso) partes.push(curso + ' en curso');
    if (listos) partes.push(listos + (listos === 1 ? ' listo' : ' listos'));
    if (fallos) partes.push(fallos + (fallos === 1 ? ' falló' : ' fallaron'));
    const conP = lista.filter(t => t.estado === 'corriendo' && t.progreso != null);
    const avance = conP.length ? Math.round(conP.reduce((a, t) => a + t.progreso, 0) / conP.length) : null;
    let pildora;
    if (curso) pildora = curso === 1 ? '1 trabajo en curso' : curso + ' trabajos en curso';
    else if (fallos) pildora = fallos === 1 ? 'Un trabajo falló' : fallos + ' trabajos fallaron';
    else pildora = listos === 1 ? '1 trabajo listo' : listos + ' trabajos listos';
    return { curso, listos, fallos, texto: partes.join(' · '), pildora, avance };
  }
  function nuevos(lista, vistos) {
    return lista.filter(t => t.estado !== 'corriendo' && !vistos[t.id]).map(t => t.id);
  }
  function podar(mapa, ahora) {
    const out = {};
    for (const [k, v] of Object.entries(mapa || {})) if (ahora - v < HORAS_CERRADO * 3600e3) out[k] = v;
    return out;
  }

  // E2 — la ficha de una copia: en qué paso va, cuánto lleva y cuánto falta tras un 402. Puro, y lo prueba tests/test_e2_bandeja_js.py.
  const ORDEN_PASOS = ['entender', 'editar', 'vista'];
  function pasosDe(ed) {
    const nombres = ed && Array.isArray(ed.pasos) && ed.pasos.length ? ed.pasos : ['Entender', 'Editar', 'Vista previa'];
    const actual = Math.max(0, ORDEN_PASOS.indexOf(ed && ed.paso));
    return nombres.map((texto, i) => ({ texto: String(texto), estado: i < actual ? 'hecho' : i === actual ? 'actual' : 'pendiente' }));
  }
  function transcurrido(inicio, ahora) {
    const t = Date.parse(inicio);
    if (!isFinite(t)) return '0:00';
    const s = Math.max(0, Math.floor((ahora - t) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    const dos = n => String(n).padStart(2, '0');
    return h ? h + ':' + dos(m) + ':' + dos(r) : m + ':' + dos(r);
  }
  // la misma cuenta que faltanTras402 de web/src/pantallas/inicio/edicion.ts: «…cuesta 8 créditos y tu saldo es 5.» → 3; si el texto no
  // se lee, el precio de la ficha y el saldo que se conocía; nunca menos de 1
  function faltanTras402(detalle, creditos, saldo) {
    const m = typeof detalle === 'string' ? /cuesta (\d+)\D+saldo es (\d+)/i.exec(detalle) : null;
    const cuesta = m ? Number(m[1]) : Number(creditos) || 0;
    const tiene = m ? Number(m[2]) : Number(saldo) || 0;
    return Math.max(1, cuesta - tiene);
  }

  const puro = { deEstaPantalla, visibles, resumen, nuevos, podar, pasosDe, transcurrido, faltanTras402 };
  if (typeof document === 'undefined') { globalThis.trabajosPuro = puro; return; }

  // --- estado ---
  const leer = k => { try { return podar(JSON.parse(localStorage.getItem(k) || '{}'), Date.now()); } catch (e) { return {}; } };
  const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento: solo dura la visita */ } };
  let remotos = [], locales = {}, avisos = [], abierto = false, sondeo = 15, reloj = null, tras = null, pidiendo = false;
  let cerrados = leer(CLAVE_CERRADOS), vistos = leer(CLAVE_VISTOS);
  let secuencia = 0;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ico = n => (typeof window.icono === 'function' ? window.icono(n) : '');
  const ICONO = { pelicula: 'video', clip: 'video', editar: 'cortar', edicion: 'cortar', importar: 'subir', analizar: 'shorts',
                  render: 'shorts', estilo: 'estilo', competencia: 'competencia', subida: 'subir' };

  // --- dibujo ---
  const css = document.createElement('style');
  css.textContent = `
#bandeja { position: fixed; right: 16px; bottom: 16px; z-index: 999; width: 360px; max-width: calc(100vw - 32px);
  display: flex; flex-direction: column; gap: 8px; align-items: flex-end;
  font: var(--t-sm, 15px)/1.45 var(--f-texto, system-ui, sans-serif); color: var(--c-texto, #ece8e1); }
#bandeja[hidden] { display: none; }
#bandeja > * { width: 100%; }
#bandeja .bj-caja { background: var(--c-superficie, #111f33); border: 1px solid var(--c-linea, #22354f);
  border-radius: var(--r-grande, 16px); box-shadow: 0 8px 28px rgba(4, 9, 17, .55); overflow: hidden; }
#bandeja .bj-cab { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 0 4px 0 16px;
  border-bottom: 1px solid var(--c-linea, #22354f); }
#bandeja .bj-cab b { font: 700 var(--t-sm, 15px)/1.2 var(--f-titulo, system-ui); flex: 1; }
#bandeja .bj-cab .n { color: var(--c-secundario, #93a3b8); font-variant-numeric: tabular-nums; }
#bandeja .bj-ic { width: 44px; height: 44px; flex: none; display: inline-flex; align-items: center; justify-content: center;
  border: 0; background: none; color: var(--c-secundario, #93a3b8); border-radius: var(--r-medio, 10px); cursor: pointer; }
#bandeja .bj-ic:hover { background: var(--c-elevada, #18293f); color: var(--c-texto, #ece8e1); }
#bandeja .bj-lista { display: grid; max-height: min(60vh, 420px); overflow-y: auto; }
#bandeja .bj-item { display: grid; grid-template-columns: 24px 1fr auto; column-gap: 12px; row-gap: 2px;
  padding: 12px 4px 12px 16px; align-items: start; }
#bandeja .bj-item + .bj-item { border-top: 1px solid var(--c-linea, #22354f); }
#bandeja .bj-item > .ico { color: var(--c-secundario, #93a3b8); margin-top: 1px; }
#bandeja .bj-item.listo > .ico { color: var(--c-exito, #3dd68c); }
#bandeja .bj-item.error > .ico { color: var(--c-error, #ff8080); }
#bandeja .bj-tit { grid-column: 2; font-weight: 600; overflow-wrap: anywhere; }
#bandeja .bj-sub { grid-column: 2; color: var(--c-secundario, #93a3b8); font-size: var(--t-xs, 13px);
  font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
#bandeja .bj-sub .dev { color: var(--c-texto, #ece8e1); }
#bandeja .bj-barra { grid-column: 2; height: 4px; border-radius: 4px; background: var(--c-elevada, #18293f);
  overflow: hidden; margin-top: 6px; }
#bandeja .bj-barra i { display: block; height: 100%; background: var(--c-ambar, #da8c28); border-radius: 4px; }
#bandeja .bj-barra.sin i { width: 30%; animation: bj-ir 1.6s ease-in-out infinite; }
@keyframes bj-ir { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
#bandeja .bj-ver { grid-column: 2; justify-self: start; color: var(--c-enlace, #a9c6ee); font-weight: 500;
  text-decoration: none; min-height: 32px; display: inline-flex; align-items: center; }
#bandeja .bj-ver:hover { color: var(--c-texto, #ece8e1); text-decoration: underline; text-underline-offset: 4px; }
#bandeja .bj-item.corriendo .bj-ver { grid-column: 3; grid-row: 1; min-height: 24px; padding-right: 12px; }
#bandeja .bj-item .bj-ic { grid-column: 3; grid-row: 1 / span 3; margin-top: -10px; }
/* icono · texto · cerrar; el botón de acción va en su propia fila, debajo del
   texto, para que un aviso largo no quede en una columna angosta */
#bandeja .bj-aviso { display: grid; grid-template-columns: auto 1fr auto; align-items: center;
  column-gap: 12px; row-gap: 4px; padding: 4px 4px 4px 16px; min-height: 48px; }
#bandeja .bj-aviso > .ico { color: var(--c-exito, #3dd68c); flex: none; }
#bandeja .bj-aviso.mal > .ico { color: var(--c-error, #ff8080); }
#bandeja .bj-aviso.info > .ico { color: var(--c-secundario, #93a3b8); }
#bandeja .bj-aviso span { grid-column: 2; grid-row: 1; overflow-wrap: anywhere; }
#bandeja .bj-aviso .bj-ic { grid-column: 3; grid-row: 1; }
/* las pantallas tienen sus propios .btn y button (crear les da ancho completo):
   dentro del cuadro no mandan */
#bandeja button { margin: 0; width: auto; box-sizing: border-box; }
#bandeja .bj-aviso .btn { display: inline-flex; grid-column: 2; grid-row: 2; justify-self: start;
  min-height: 36px; padding: 0 12px; margin-bottom: 8px; }
#bandeja .bj-pildora { display: flex; align-items: center; gap: 12px; min-height: 48px; width: auto;
  padding: 0 4px 0 16px; border-radius: 999px; cursor: pointer; font: inherit; color: inherit; text-align: left; }
#bandeja .bj-pildora > .ico { color: var(--c-secundario, #93a3b8); flex: none; }
#bandeja .bj-pildora.error > .ico { color: var(--c-error, #ff8080); }
#bandeja .bj-pildora.listo > .ico { color: var(--c-exito, #3dd68c); }
#bandeja .bj-pildora span { flex: 1; font-weight: 600; white-space: nowrap; }
#bandeja .bj-pildora .mini { width: 64px; height: 4px; border-radius: 4px; background: var(--c-elevada, #18293f); overflow: hidden; flex: none; }
#bandeja .bj-pildora .mini i { display: block; height: 100%; background: var(--c-ambar, #da8c28); }
#bandeja .bj-pildora .flecha { width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; color: var(--c-secundario, #93a3b8); }
#bandeja .bj-pildora:hover { border-color: var(--c-secundario, #93a3b8); }
/* E2: la copia que edita la IA (ficha.edicion): pasos, pedido, resumen, error en tres partes */
#bandeja .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
#bandeja .bj-pedido { color: var(--c-texto, #ece8e1); }
#bandeja .pasos { grid-column: 2; display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 6px 0 2px; padding: 0; list-style: none; }
#bandeja .pasos li { display: inline-flex; align-items: center; gap: 6px; color: var(--c-secundario, #93a3b8);
  font-size: var(--t-xs, 13px); }
#bandeja .pasos .pn { display: inline-grid; place-items: center; width: 20px; height: 20px; flex: none;
  border: 1px solid var(--c-secundario, #93a3b8); border-radius: 999px; font-variant-numeric: tabular-nums; }
#bandeja .pasos li.hecho { color: var(--c-texto, #ece8e1); }
#bandeja .pasos li.hecho .pn { border-color: var(--c-exito, #3dd68c); background: var(--c-exito, #3dd68c); color: var(--c-tinta, #14100a); }
#bandeja .pasos li.actual { color: var(--c-texto, #ece8e1); font-weight: 600; }
#bandeja .pasos li.actual .pn { border-color: var(--c-ambar, #da8c28); color: var(--c-ambar, #da8c28); }
#bandeja .bj-tres { grid-column: 2; display: grid; row-gap: 6px; margin: 4px 0 0; }
#bandeja .bj-tres dt { color: var(--c-secundario, #93a3b8); font-size: var(--t-xs, 13px); font-weight: 600; letter-spacing: .4px; text-transform: uppercase; }
#bandeja .bj-tres dd { margin: 0; overflow-wrap: anywhere; }
#bandeja .bj-acc { grid-column: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 0 12px; margin-top: 4px; }
#bandeja .bj-bt, #bandeja .bj-txt { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 14px;
  border-radius: var(--r-medio, 10px); font: inherit; font-weight: 600; cursor: pointer; }
#bandeja .bj-bt { border: 1px solid var(--c-campo, #55708f); background: transparent; color: var(--c-texto, #ece8e1); }
#bandeja .bj-bt:hover { border-color: var(--c-secundario, #93a3b8); background: var(--c-elevada, #18293f); }
#bandeja .bj-bt[aria-busy="true"] { cursor: progress; color: var(--c-secundario, #93a3b8); }
#bandeja .bj-txt { border: 0; background: none; padding: 0 8px; color: var(--c-enlace, #a9c6ee); font-weight: 500;
  text-decoration: underline; text-underline-offset: 4px; }
#bandeja .bj-txt:hover { color: var(--c-texto, #ece8e1); }
#bandeja .bj-item.ed .bj-ver { min-height: 44px; }
@media (max-width: 600px) {
  #bandeja { left: 12px; right: 12px; bottom: calc(12px + env(safe-area-inset-bottom, 0px)); width: auto; max-width: none; align-items: stretch; }
  #bandeja .bj-pildora { width: 100%; }
}`;

  const raiz = document.createElement('div');
  raiz.id = 'bandeja';
  raiz.hidden = true;
  let ultimoHtml = '';

  function todos() {
    return visibles(remotos, cerrados, location).concat(Object.values(locales));
  }

  // --- E2: la copia que edita la IA. Todo lo que se lee viene en `t.edicion` y se pinta con esc(); solo estas dos frases son de aquí ---
  const LINEA_LISTO = 'Ábrelo en el editor para revisar los cortes y renderizarlo.';

  function itemEdicion(t) {
    const ed = t.edicion;
    const icon = t.estado === 'listo' ? 'listo' : t.estado === 'error' ? 'aviso' : ICONO.edicion;
    const cerrar = `<button class="bj-txt" type="button" data-cerrar="${esc(t.id)}">Cerrar</button>`;
    const cabeza = `<div class="bj-tit">${esc(t.titulo)}</div>`; // HTML ya escapado: por eso no se llama «titulo»
    if (t.estado === 'corriendo') {
      // «Llevas m:ss» lo mueve un reloj aparte con textContent (afinarReloj): repintar todo cada segundo le quitaría el foco a quien lo tenga
      const pasos = pasosDe(ed).map((p, i) =>
        `<li class="${p.estado}"${p.estado === 'actual' ? ' aria-current="step"' : ''}>` +
        `<span class="pn" aria-hidden="true">${p.estado === 'hecho' ? '✓' : i + 1}</span>${esc(p.texto)}` +
        `<span class="sr-only"> (${p.estado === 'hecho' ? 'hecho' : p.estado === 'actual' ? 'en curso' : 'pendiente'})</span></li>`).join('');
      return `<div class="bj-item corriendo ed" data-k="${esc(t.id)}">${ico(icon)}${cabeza}` +
        (t.detalle ? `<div class="bj-sub">${esc(t.detalle)}</div>` : '') +
        (ed.pedido ? `<div class="bj-sub bj-pedido">Pediste: ${esc(ed.pedido)}</div>` : '') +
        `<ul class="pasos" aria-label="Pasos">${pasos}</ul>` +
        `<div class="bj-sub">Llevas <span data-llevas="${esc(ed.inicio)}"></span>. Puedes cerrar esta pestaña: sigue en la nube.</div></div>`;
    }
    if (t.estado === 'listo') {
      const verEditor = ed.enlace && ed.enlace.url ? `<a class="bj-ver" href="${esc(ed.enlace.url)}">${esc(ed.enlace.texto || 'Abrir el editor')}</a>` : '';
      return `<div class="bj-item listo ed" data-k="${esc(t.id)}">${ico(icon)}${cabeza}` +
        ((ed.resumen || t.detalle) ? `<div class="bj-sub">${esc(ed.resumen || t.detalle)}</div>` : '') +
        `<div class="bj-sub">${LINEA_LISTO}</div><div class="bj-acc">${verEditor}${cerrar}</div></div>`;
    }
    // error: qué pasó · tus créditos · qué sigue, y Reintentar (vuelve a cobrar lo que dice «Qué sigue») o Cerrar
    const e = ed.error || {};
    const partes = [['Qué pasó', e.que_paso], ['Tus créditos', e.creditos], ['Qué sigue', e.que_sigue]]
      .filter(([, texto]) => texto).map(([rotulo, texto]) => `<dt>${rotulo}</dt><dd>${esc(texto)}</dd>`).join('');
    const r = e.reintentar;
    const reintentar = r && r.ruta
      ? `<button class="bj-bt" type="button" data-reintentar="${esc(r.ruta)}"${r.creditos ? ` data-creditos="${esc(r.creditos)}"` : ''}>${esc(r.texto || 'Reintentar')}</button>` : '';
    return `<div class="bj-item error ed" data-k="${esc(t.id)}" role="alert">${ico(icon)}${cabeza}<dl class="bj-tres">${partes}</dl><div class="bj-acc">${reintentar}${cerrar}</div></div>`;
  }

  // «Llevas m:ss»: un reloj de 1 s con textContent, sin repintar nada. Vive solo mientras haya una copia corriendo a la vista
  let relojLlevas = null;
  function tic() {
    const ahora = Date.now();
    raiz.querySelectorAll('[data-llevas]').forEach(el => { el.textContent = transcurrido(el.dataset.llevas, ahora); });
  }
  function afinarReloj() {
    const hay = !!raiz.querySelector('[data-llevas]');
    if (hay) tic();
    if (hay && !relojLlevas) relojLlevas = setInterval(tic, 1000);
    else if (!hay && relojLlevas) { clearInterval(relojLlevas); relojLlevas = null; }
  }

  // El servidor aceptó el reintento y COBRÓ (INT-02). La bandeja no es la única que lo tiene que saber: la píldora del saldo no sondea y
  // Mis creaciones solo vuelve a leer sus listas mientras algo corra en la SUYA (que decía «No se pudo editar»), así que las dos se
  // quedaban viejas hasta recargar. El saldo se pone al día aquí; la pantalla se entera por `trabajos:lanzado` (Inicio relee sus listas);
  // y el «−N» vuela del botón a la píldora con lo que cobró el servidor (monedero.js lo escucha como el de «Iniciar»).
  async function reintentoAceptado(boton, ruta, r) {
    let costo = Number(boton.dataset.creditos) || 0;
    try { const d = await r.json(); if (d && Number(d.creditos) > 0) costo = Number(d.creditos); } catch (err) { /* sin cuerpo legible: el precio de la ficha */ }
    try { if (window.monedero && typeof window.monedero.refrescar === 'function') window.monedero.refrescar(); } catch (err) { /* sin monedero */ }
    try { window.dispatchEvent(new CustomEvent('trabajos:lanzado', { detail: { ruta } })); } catch (err) { /* nunca romper la bandeja */ }
    try {
      const c = boton.getBoundingClientRect();
      if (costo > 0) window.dispatchEvent(new CustomEvent('cobro', { detail: { costo, rect: { x: c.left, y: c.top, ancho: c.width, alto: c.height } } }));
    } catch (err) { /* sin animación: el saldo ya se actualiza */ }
  }

  // «Reintentar»: misma copia, cobra otra vez (el servidor decide el precio y devuelve si no puede lanzar). El fetch envuelto de abajo
  // ya vuelve a preguntar por los trabajos 2 s después de un POST que sale bien. Sin saldo (402): «Te faltan ✦ N ·» con su «Recargar»
  async function reintentar(boton) {
    const ruta = boton.dataset.reintentar;
    if (!/^\/api\//.test(ruta) || boton.getAttribute('aria-busy') === 'true') return;
    boton.setAttribute('aria-busy', 'true');
    boton.setAttribute('aria-disabled', 'true');
    try {
      const r = await fetch(ruta, { method: 'POST' });
      if (r.ok) { reintentoAceptado(boton, ruta, r); refrescar(); return; }
      let detalle = '';
      try { const d = await r.json(); detalle = d && typeof d.detail === 'string' ? d.detail : ''; } catch (err) { /* sin cuerpo legible */ }
      if (r.status === 402) {
        const m = window.monedero || {};
        const saldo = m.get && m.get() ? m.get().saldo : null;
        const falta = faltanTras402(detalle, boton.dataset.creditos, saldo);
        const texto = 'Te faltan ✦ ' + falta + ' ·';
        if (m.recarga && m.recargar) mostrar(texto, { tipo: 'mal', clave: 'caja', accion: { texto: 'Recargar', al: () => m.recargar() } });
        else mostrar(m.cta ? texto + ' ' + m.cta : texto, { tipo: 'mal', clave: 'caja' });
      } else {
        mostrar(detalle || 'No se pudo reintentar. Inténtalo de nuevo.', { tipo: 'mal', clave: 'caja' });
      }
    } catch (err) {
      mostrar('Sin conexión. Inténtalo de nuevo.', { tipo: 'mal', clave: 'caja' });
    } finally {
      boton.removeAttribute('aria-busy');
      boton.removeAttribute('aria-disabled');
    }
  }

  function item(t) {
    if (t.edicion && typeof t.edicion === 'object') return itemEdicion(t);
    const cls = t.estado === 'corriendo' ? 'corriendo' : t.estado;
    const icon = t.estado === 'listo' ? 'listo' : t.estado === 'error' ? 'aviso' : (ICONO[t.tipo] || 'espera');
    let sub = esc(t.detalle || '');
    if (t.estado === 'error' && t.devueltos) {
      sub += (!sub ? '' : /[.»]$/.test(t.detalle) ? ' ' : ' · ') + '<span class="dev">' + `Te devolvimos ✦ ${esc(t.devueltos)}.` + '</span>';
    }
    const barra = t.estado !== 'corriendo' ? ''
      : t.progreso == null ? '<div class="bj-barra sin"><i></i></div>'
      : `<div class="bj-barra"><i style="width:${Math.max(3, Math.min(100, +t.progreso || 0))}%"></i></div>`;
    const ver = !t.url ? '' : `<a class="bj-ver" href="${esc(t.url)}">${t.estado === 'error' ? 'Ver qué pasó' : 'Ver'}</a>`;
    const cerrar = t.estado === 'corriendo' ? '' : `<button class="bj-ic" type="button" data-cerrar="${esc(t.id)}" aria-label="Cerrar este aviso">${ico('cerrar')}</button>`;
    return `<div class="bj-item ${cls}" data-k="${esc(t.id)}">${ico(icon)}<div class="bj-tit">${esc(t.titulo)}</div>${sub ? `<div class="bj-sub">${sub}</div>` : ''}${barra}${ver}${cerrar}</div>`;
  }

  // --- repintar sin tirar lo que no cambió ---
  // Deja el DOM de `destino` igual al de `fuente` tocando solo lo que difiere. Los nodos con la misma clave (`data-k`: cada ficha, cada aviso,
  // la caja abierta o la píldora) se conservan y se acomodan; los demás se comparan por posición y tipo. Un nodo que se conserva mantiene su
  // foco, su selección y, si es un `role="alert"`, no se vuelve a anunciar.
  const CONSERVAR = ['aria-busy', 'aria-disabled'];   // los pone «Reintentar» mientras su POST está en el aire: no vienen en el HTML
  const claveDe = n => (n.nodeType === 1 ? n.getAttribute('data-k') : null);
  function igualarAtributos(vivo, nuevo) {
    for (const a of Array.from(vivo.attributes)) if (!nuevo.hasAttribute(a.name) && !CONSERVAR.includes(a.name)) vivo.removeAttribute(a.name);
    for (const a of Array.from(nuevo.attributes)) if (vivo.getAttribute(a.name) !== a.value) vivo.setAttribute(a.name, a.value);
  }
  function igualar(vivo, nuevo) {
    if (vivo.nodeType !== 1) { if (vivo.data !== nuevo.data) vivo.data = nuevo.data; return; }
    igualarAtributos(vivo, nuevo);
    if (vivo.hasAttribute('data-llevas')) return;    // su texto es de un reloj aparte (afinarReloj): lo que viene aquí va vacío
    igualarHijos(vivo, nuevo);
  }
  function igualarHijos(destino, fuente) {
    const nuevos = Array.from(fuente.childNodes);
    const vivosPorClave = new Map();
    for (const h of Array.from(destino.childNodes)) { const k = claveDe(h); if (k) vivosPorClave.set(k, h); }
    nuevos.forEach((nuevo, i) => {
      const k = claveDe(nuevo);
      const enSuLugar = destino.childNodes[i] || null;
      // el nodo vivo que le toca: el de su misma clave; sin clave, el que ya está en su lugar si es del mismo tipo y tampoco la tiene
      const vivo = k ? vivosPorClave.get(k)
        : enSuLugar && !claveDe(enSuLugar) && enSuLugar.nodeType === nuevo.nodeType && enSuLugar.nodeName === nuevo.nodeName ? enSuLugar : null;
      if (!vivo) { destino.insertBefore(nuevo, enSuLugar); return; }
      if (vivo !== enSuLugar) destino.insertBefore(vivo, enSuLugar);
      igualar(vivo, nuevo);
    });
    while (destino.childNodes.length > nuevos.length) destino.lastChild.remove();
  }

  function pintar() {
    const lista = todos();
    const r = resumen(lista);
    let html = avisos.map(a =>
      `<div class="bj-caja bj-aviso ${a.tipo}" data-k="a${a.id}" role="${a.tipo === 'mal' ? 'alert' : 'status'}">` +
      `${ico(a.tipo === 'mal' ? 'aviso' : a.tipo === 'info' ? 'sinred' : 'listo')}<span>${esc(a.texto)}</span>` +
      (a.accion ? `<button class="btn btn-sec" type="button" data-accion="${a.id}">${esc(a.accion.texto)}</button>` : '') +
      `<button class="bj-ic" type="button" data-quitar="${a.id}" aria-label="Cerrar aviso">${ico('cerrar')}</button></div>`).join('');
    if (lista.length && abierto) {
      html += `<div class="bj-caja" data-k="region" role="region" aria-label="Tus trabajos"><div class="bj-cab"><b>Tus trabajos</b>` +
        `<span class="n">${esc(r.texto)}</span><button class="bj-ic" type="button" data-plegar aria-expanded="true" aria-label="Plegar tus trabajos">${ico('menos')}</button></div>` +
        `<div class="bj-lista">${lista.map(item).join('')}</div></div>`;
    } else if (lista.length) {
      const tono = r.curso ? '' : r.fallos ? 'error' : 'listo';
      const icon = r.curso ? 'espera' : r.fallos ? 'aviso' : 'listo';
      html += `<button class="bj-caja bj-pildora ${tono}" data-k="pildora" type="button" data-abrir aria-expanded="false" aria-label="${esc(r.pildora)}: abrir tus trabajos">` +
        `${ico(icon)}<span>${esc(r.pildora)}</span>` +
        (r.avance != null ? `<span class="mini" aria-hidden="true"><i style="width:${r.avance}%"></i></span>` : '') +
        `<span class="flecha" aria-hidden="true">${ico('enviar')}</span></button>`;
    }
    // lo mismo de antes no se vuelve a pintar; y lo que cambia se pone al día EN SU SITIO (igualarHijos), sin reemplazar lo que no cambió:
    // repintar todo con `innerHTML` soltaba el foco de quien estuviera en «Reintentar» y volvía a insertar el `role="alert"` de un error
    // que no cambió (el lector de pantalla lo repetía) cada vez que OTRA ficha cambiaba de progreso
    if (html !== ultimoHtml) {
      const plantilla = document.createElement('template');
      plantilla.innerHTML = html;
      igualarHijos(raiz, plantilla.content);
      ultimoHtml = html;
    }
    raiz.hidden = !html;
    afinarReloj();
  }

  raiz.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-abrir')) { abierto = true; pintar(); raiz.querySelector('[data-plegar]')?.focus(); }
    else if (b.hasAttribute('data-plegar')) { abierto = false; pintar(); raiz.querySelector('[data-abrir]')?.focus(); }
    else if (b.dataset.cerrar) { cerrados[b.dataset.cerrar] = Date.now(); guardar(CLAVE_CERRADOS, cerrados); pintar(); }
    else if (b.dataset.reintentar) reintentar(b);
    else if (b.dataset.quitar) quitarAviso(+b.dataset.quitar);
    else if (b.dataset.accion) {
      const a = avisos.find(x => x.id === +b.dataset.accion);
      quitarAviso(+b.dataset.accion);
      try { a?.accion?.al?.(); } catch (err) { console.error(err); }
    }
  });

  // --- avisos rápidos ---
  function mostrar(texto, op = {}) {
    const tipo = op.tipo || 'ok';
    const a = { id: ++secuencia, texto, tipo, accion: op.accion || null, clave: op.clave || null };
    if (a.clave) avisos = avisos.filter(x => x.clave !== a.clave);
    avisos.push(a);
    avisos = avisos.slice(-3);
    // lo bueno se va solo; un fallo se queda hasta que se cierra o se resuelve
    const seg = op.segundos ?? (tipo === 'ok' ? 5 : 0);
    if (seg) setTimeout(() => quitarAviso(a.id), seg * 1000);
    pintar();
    return a.id;
  }
  function quitarAviso(id) { avisos = avisos.filter(a => a.id !== id && a.clave !== id); pintar(); }

  // --- los trabajos del servidor ---
  async function refrescar() {
    clearTimeout(reloj);
    if (pidiendo) return;
    pidiendo = true;
    try {
      const r = await fetch('/api/trabajos', { cache: 'no-store' });
      if (!r.ok) return;                 // sin sesión o sin servicio: el cuadro calla
      const d = await r.json();
      remotos = Array.isArray(d.trabajos) ? d.trabajos : [];
      sondeo = Math.max(5, +d.sondeo_s || 15);
      const frescos = nuevos(visibles(remotos, cerrados, location), vistos);
      if (frescos.length) {              // terminó o falló algo que no habías visto
        abierto = true;
        for (const id of frescos) vistos[id] = Date.now();
        guardar(CLAVE_VISTOS, vistos);
      }
      pintar();
    } catch (e) { /* sin red: lo dice el aviso de conexión */ }
    finally {
      pidiendo = false;
      if (remotos.some(t => t.estado === 'corriendo') && !document.hidden) reloj = setTimeout(refrescar, sondeo * 1000);
    }
  }

  // Tras cualquier acción que lanza algo (un POST a la API que salió bien) se
  // pregunta de nuevo: así aparece lo recién lanzado sin tocar cada pantalla.
  const fetchPrevio = window.fetch.bind(window);
  window.fetch = async function (entrada, opciones) {
    const r = await fetchPrevio(entrada, opciones);
    try {
      const url = typeof entrada === 'string' ? entrada : entrada.url;
      const metodo = (opciones?.method || entrada?.method || 'GET').toUpperCase();
      if (metodo !== 'GET' && r.ok && /\/api\//.test(url) && !/\/api\/trabajos/.test(url)) {
        // el autoguardado de crear manda un PUT cada pocos segundos: una sola
        // pregunta por ráfaga
        clearTimeout(tras);
        tras = setTimeout(refrescar, 2000);
      }
    } catch (e) { /* nunca romper el fetch de la página */ }
    return r;
  };

  document.addEventListener('visibilitychange', () => { if (!document.hidden) refrescar(); });
  addEventListener('offline', () => mostrar('Sin conexión. Reintentando…', { tipo: 'info', clave: 'red' }));
  addEventListener('online', () => { quitarAviso('red'); mostrar('Conexión recuperada', { clave: 'red' }); refrescar(); });

  // --- lo que hace el navegador (subidas): la pantalla lo informa ---
  function local(id, t) {
    if (t == null) delete locales[id];
    else locales[id] = Object.assign({ id: 'local:' + id, tipo: 'subida', estado: 'corriendo', url: '' }, t);
    pintar();
  }

  window.avisos = { mostrar, quitar: quitarAviso };
  window.trabajos = { refrescar, local, _puro: puro };

  function montar() {
    document.head.appendChild(css);
    document.body.appendChild(raiz);
    setTimeout(refrescar, 600);
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', montar);
  else montar();
})();
