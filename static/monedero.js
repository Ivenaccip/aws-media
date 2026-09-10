// M1 — cabecera compartida del monedero: el saldo se ve SIEMPRE, en todas las
// páginas. Consume GET /api/creditos; si el monedero no está activo (dev local
// con CREDITOS_BACKEND=off) no pinta nada. Las páginas escuchan el evento
// 'monedero' para pintar costos junto a sus botones, y llaman
// window.monedero.refrescar() después de cada acción que cobra.
(function () {
  const est = { activo: false, saldo: null, tarifas: {}, packs: [] };

  // Mock del dueño (Miro, 2026-09-10): boleto · píldora [＋ | N créditos] · avatar.
  // El ＋ abre la recarga; el avatar despliega el menú con «Salir».
  const el = document.createElement('div');
  el.id = 'monedero';
  el.style.cssText =
    'position:fixed;top:12px;right:14px;z-index:1000;display:none;align-items:center;gap:12px;' +
    'font:13px/1 system-ui,sans-serif;color:#e8e6e0';
  const FONDO = 'background:rgba(18,20,26,.94);border:1px solid #3a3f4a;' +
    'box-shadow:0 2px 12px rgba(0,0,0,.4);';
  const TICKET =
    '<svg viewBox="0 0 26 18" width="30" height="21" fill="currentColor" aria-hidden="true">' +
    '<path d="M1 3a2 2 0 0 1 2-2h20a2 2 0 0 1 2 2v3.2a2.8 2.8 0 0 0 0 5.6V15a2 2 0 0 1-2 2H3' +
    'a2 2 0 0 1-2-2v-3.2a2.8 2.8 0 0 0 0-5.6zM17.5 2.6v1.9h1.4V2.6zm0 3.8v1.9h1.4V6.4zm0 3.8' +
    'v1.9h1.4v-1.9zm0 3.8v1.9h1.4V14z"/></svg>';
  const PERSONA =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">' +
    '<circle cx="12" cy="8.2" r="3.6"/><path d="M4.5 19.4a7.5 7.5 0 0 1 15 0v.6h-15z"/></svg>';
  el.innerHTML =
    '<span id="mon-ticket" hidden title="tus créditos" style="display:flex;color:#e8e6e0">' + TICKET + '</span>' +
    '<span id="mon-pill" hidden style="' + FONDO + 'display:flex;align-items:center;height:38px;' +
      'border-radius:999px">' +
      // el círculo del ＋ va al ras de la píldora: mismo alto que ella (su
      // caja de 40px con bordes), sin sobresalir — feedback del dueño
      '<button id="mon-cta" title="Recargar créditos" style="' + FONDO + 'width:40px;height:40px;' +
        'box-sizing:border-box;margin:-1px 0 -1px -1px;border-radius:50%;color:#e8e6e0;cursor:pointer;font:600 20px/1 system-ui;' +
        'display:flex;align-items:center;justify-content:center;padding:0 0 2px 0">＋</button>' +
      '<span id="mon-saldo" style="font:600 14px system-ui;white-space:nowrap;padding:0 20px 0 14px"></span>' +
    '</span>' +
    // M2: el avatar despliega «Salir» (auth.salir limpia tokens y pasa por el
    // /logout del Hosted UI — clave tras un cambio de permisos: el re-login
    // trae los grupos nuevos en el token). Solo se pinta si el login está activo.
    '<span id="mon-user" hidden style="position:relative">' +
      '<button id="mon-avatar" title="tu cuenta" style="' + FONDO + 'width:38px;height:38px;' +
        'border-radius:50%;color:#e8e6e0;cursor:pointer;display:flex;align-items:center;' +
        'justify-content:center;padding:0">' + PERSONA + '</button>' +
      // OJO: sin `display` inline — un display inline le gana al atributo
      // hidden y el menú nacería abierto; toggleMenu pone flex/none
      '<span id="mon-menu" style="' + FONDO + 'position:absolute;top:46px;right:0;' +
        'border-radius:12px;padding:6px;display:none;flex-direction:column;min-width:170px">' +
        '<span id="mon-email" style="display:block;padding:8px 12px;color:#9a978f;font-size:12px;' +
          'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px"></span>' +
        '<button id="mon-salir" style="background:none;border:0;color:#e8e6e0;cursor:pointer;' +
          'font:13px system-ui;display:block;width:100%;text-align:left;padding:8px 12px;' +
          'border-radius:8px" onmouseover="this.style.background=\'#23262d\'" ' +
          'onmouseout="this.style.background=\'none\'">Cerrar sesión</button>' +
      '</span>' +
    '</span>';

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
    if (panel) { panel.remove(); panel = null; return; }
    if (!est.packs.some(p => p.link)) { alert(textoRecarga()); return; }
    panel = document.createElement('div');
    panel.id = 'mon-panel';
    panel.style.cssText =
      'position:fixed;top:60px;right:14px;z-index:1000;width:min(280px, calc(100vw - 28px));' +
      'background:rgba(18,20,26,.97);border:1px solid #3a3f4a;border-radius:14px;padding:14px;' +
      'font:13px/1.5 system-ui,sans-serif;color:#e8e6e0;box-shadow:0 4px 18px rgba(0,0,0,.5)';
    panel.innerHTML =
      '<div style="font-weight:600;margin-bottom:8px">Recargar créditos</div>' +
      est.packs.map(p => p.link
        ? `<a href="${p.link}" target="_blank" rel="noopener" style="display:block;margin-bottom:6px;` +
          'padding:8px 12px;border-radius:9px;background:#23262d;border:1px solid #3a3f4a;' +
          `text-decoration:none;color:#e8e6e0">⚡ ${p.creditos} créditos — $${p.usd.toFixed(2)} dólares</a>`
        : `<div style="margin-bottom:6px;color:#9a978f">⚡ ${p.creditos} créditos — $${p.usd.toFixed(2)} dólares</div>`
      ).join('') +
      '<div style="color:#9a978f;font-size:11.5px;margin-top:6px">El pago abre en Stripe. ' +
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

  async function intentar() {
    clearTimeout(reintentoT);
    try {
      const r = await fetch('/api/creditos');
      if (!r.ok) { programarReintento(); return; }
      const d = await r.json();
      if (!d.activo) return;
      reintento = 0;
      est.activo = true; est.saldo = d.saldo; est.tarifas = d.tarifas || {}; est.packs = d.packs || [];
      el.style.display = 'flex';
      el.querySelector('#mon-ticket').hidden = false;
      el.querySelector('#mon-pill').hidden = false;
      el.querySelector('#mon-saldo').textContent = `${d.saldo} créditos`;
      document.dispatchEvent(new CustomEvent('monedero', { detail: est }));
    } catch { programarReintento(); /* sin red: se reintenta igual */ }
  }
  function programarReintento() {
    if (reintento >= ESPERAS_MS.length) return;   // se rinde en silencio; visibilitychange lo revive
    reintentoT = setTimeout(intentar, ESPERAS_MS[reintento++]);
  }

  function emailDelToken() {
    // el id_token es un JWT: el payload trae el email (solo para mostrarlo)
    try {
      const t = localStorage.getItem('auth_id_token');
      return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || '';
    } catch { return ''; }
  }

  function montar() {
    document.body.appendChild(el);
    el.querySelector('#mon-cta').onclick = togglePanel;
    el.querySelector('#mon-avatar').onclick = toggleMenu;
    el.querySelector('#mon-salir').onclick = () => {
      if (confirm('¿Cerrar sesión?')) window.auth.salir();
    };
    if (window.auth) window.auth.config().then(c => {
      if (!c.activo) return;
      el.querySelector('#mon-user').hidden = false;   // el avatar (y su Salir)
      el.querySelector('#mon-email').textContent = emailDelToken();
      el.style.display = 'flex';   // con sesión, la cabecera se ve aunque el
      refrescar();                 // saldo tarde — el logout siempre a mano
    });
    refrescar();
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) refrescar(); });
  window.monedero = { get: () => est, refrescar, textoRecarga };
  if (document.body) montar(); else addEventListener('DOMContentLoaded', montar);
})();
