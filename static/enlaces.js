// Enlaces de las páginas públicas (la portada y /entrar), en un solo lugar.
// Los pone el dueño. Vacío = el enlace no se muestra: mejor nada que un
// enlace inventado. Solo se aceptan direcciones https://.
window.ENLACES = {
  comunidad: '',     // dónde se unen: las cuentas se dan a miembros de la comunidad
};

// <a data-enlace="comunidad" hidden> → le pone el href y lo muestra si hay
// enlace. Si el enlace va dentro de una frase, el hidden va en la frase
// (data-enlace-envoltura) para no dejar la frase a medias.
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-enlace]').forEach(a => {
    const url = window.ENLACES[a.dataset.enlace] || '';
    if (!/^https:\/\//.test(url)) return;
    a.href = url;
    a.rel = 'noopener';
    a.hidden = false;
    const env = a.closest('[data-enlace-envoltura]');
    if (env) env.hidden = false;
  });
});
