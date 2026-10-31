// «¿No puedes entrar?» (static/acceso.html, server/acceso.py).
// Enseña tal cual lo que contesta el servidor. El 429 de API Gateway (la ráfaga de
// infra/entornos.py) no trae `mensaje` y una red caída no trae nada: esos dos son
// el «ahorita no» de siempre.
(() => {
  const NO_SE_PUDO = 'Ahorita no se pudo. Inténtalo más tarde.';
  const form = document.getElementById('pedir');
  const boton = document.getElementById('enviar');
  const mensaje = document.getElementById('mensaje');
  const texto = boton.textContent;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    boton.disabled = true;
    boton.textContent = 'Enviando…';
    let datos = null;
    try {
      const r = await fetch('/api/acceso/nueva-clave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo: document.getElementById('correo').value }),
      });
      datos = await r.json();
    } catch { /* sin red, o una respuesta que no es JSON */ }
    mensaje.textContent = (datos && datos.mensaje) || NO_SE_PUDO;
    mensaje.hidden = false;
    document.getElementById('volver').hidden = false;
    boton.disabled = false;
    boton.textContent = texto;
    // ya se contestó: otro clic gastaría uno de los cinco intentos del día
    if (datos && datos.estado === 'listo') {
      form.hidden = true;
      document.getElementById('lead').hidden = true;
    }
  });
})();
