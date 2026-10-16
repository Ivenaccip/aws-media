// Copiar al portapapeles con dos reservas, como en el tablero de COI: la API moderna; si el navegador la niega (un marco sin
// permiso, una página sin https), el método de siempre; y si tampoco, `false` y quien llama deja el texto seleccionado y lo dice.

function copiarComoAntes(texto: string): boolean {
  const foco = document.activeElement;
  const ta = document.createElement('textarea');
  ta.value = texto;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let bien = false;
  try {
    bien = document.execCommand('copy');
  } catch {
    bien = false;
  }
  ta.remove();
  // seleccionar el texto de apoyo le quitó el foco al botón: se le devuelve
  if (foco instanceof HTMLElement) foco.focus();
  return bien;
}

/** true = quedó en el portapapeles. */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* sin permiso: se prueba el método de siempre */
  }
  return copiarComoAntes(texto);
}

/** Deja `el` seleccionado, para que quien no pudo copiar solo lo haga con Ctrl+C. */
export function seleccionar(el: Element | null): void {
  if (!el) return;
  try {
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(r);
  } catch {
    /* sin selección no hay nada más que hacer */
  }
}
