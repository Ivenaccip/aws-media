// M1 — cabecera compartida del monedero: el saldo se ve SIEMPRE, en todas las
// páginas. Consume GET /api/creditos; si el monedero no está activo (dev local
// con CREDITOS_BACKEND=off) no pinta nada. Las páginas escuchan el evento
// 'monedero' para pintar costos junto a sus botones, y llaman
// window.monedero.refrescar() después de cada acción que cobra.
(function () {
  const est = { activo: false, saldo: null, tarifas: {}, packs: [] };

  const el = document.createElement('div');
  el.id = 'monedero';
  el.style.cssText =
    'position:fixed;top:12px;right:14px;z-index:1000;display:none;align-items:center;gap:12px;' +
    'background:rgba(18,20,26,.94);border:1px solid #3a3f4a;border-radius:999px;padding:8px 16px;' +
    'font:13px/1 system-ui,sans-serif;color:#e8e6e0;box-shadow:0 2px 12px rgba(0,0,0,.4)';
  el.innerHTML =
    '<span id="mon-saldo" style="font-weight:600;white-space:nowrap"></span>' +
    '<button id="mon-cta" style="background:none;border:0;color:#8ab4e8;cursor:pointer;font:12px system-ui;padding:0">Recargar</button>';

  function textoRecarga() {
    const packs = est.packs.map(p => `${p.creditos} créditos — $${p.usd.toFixed(2)} dólares`).join('\n· ');
    return 'Para recargar créditos escríbenos por el canal de la comunidad.\n\nPacks:\n· ' +
      (packs || 'consulta los packs en el canal') +
      '\n\nLos créditos comprados no caducan.';
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
      el.querySelector('#mon-saldo').textContent = `⚡ ${d.saldo} créditos`;
      document.dispatchEvent(new CustomEvent('monedero', { detail: est }));
    } catch { programarReintento(); /* sin red: se reintenta igual */ }
  }
  function programarReintento() {
    if (reintento >= ESPERAS_MS.length) return;   // se rinde en silencio; visibilitychange lo revive
    reintentoT = setTimeout(intentar, ESPERAS_MS[reintento++]);
  }

  function montar() {
    document.body.appendChild(el);
    el.querySelector('#mon-cta').onclick = () => alert(textoRecarga());
    refrescar();
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) refrescar(); });
  window.monedero = { get: () => est, refrescar, textoRecarga };
  if (document.body) montar(); else addEventListener('DOMContentLoaded', montar);
})();
