// M13 — guardrail del brief: modera el texto ANTES de mandar la petición que
// cobra. Si no pasa, popup con el motivo y la petición NO sale; el usuario
// edita y reintenta. Si /api/moderar falla, se permite (los guardrails de los
// vendors siguen atrás — un filtro caído no debe frenar el producto).
(function () {
  function popup(mensaje, motivo) {
    const fondo = document.createElement('div');
    fondo.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px';
    fondo.innerHTML = `
      <div style="background:var(--card,#111f33);color:inherit;border:1px solid var(--borde,#22354f);border-radius:14px;max-width:460px;width:100%;padding:26px;text-align:center">
        <div style="font-size:38px">🛑</div>
        <h3 style="margin:10px 0 8px">Revisa tu texto</h3>
        <p class="gMensaje" style="margin:0 0 10px;opacity:.9"></p>
        ${motivo ? `<p class="gMotivo" style="margin:0 0 14px;font-size:14px;opacity:.7"></p>` : ''}
        <button class="btn" style="min-width:200px">Entendido, lo edito</button>
      </div>`;
    // el motivo lo redacta el moderador y puede citar el texto del usuario:
    // entra como TEXTO, nunca dentro del innerHTML
    fondo.querySelector('.gMensaje').textContent = mensaje;
    if (motivo) fondo.querySelector('.gMotivo').textContent = motivo;
    fondo.querySelector('button').onclick = () => fondo.remove();
    fondo.onclick = ev => { if (ev.target === fondo) fondo.remove(); };
    document.body.appendChild(fondo);
  }

  // true = pasa (o el filtro no está disponible); false = bloqueado y ya se mostró el popup
  window.guardrail = async function (texto) {
    if (!texto.trim()) return true;
    try {
      const r = await fetch('/api/moderar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto }) });
      if (!r.ok) return true;
      const d = await r.json();
      if (d.permitido) return true;
      popup(d.mensaje || 'La IA no permite violencia explícita, sangre o implicaciones sexuales.', d.motivo || '');
      return false;
    } catch { return true; }
  };
})();
