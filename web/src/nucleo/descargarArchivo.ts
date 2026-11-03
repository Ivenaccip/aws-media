// Bajar un texto como archivo desde el navegador (el .json del Constructor y el del Asistente): un Blob, una URL temporal y un
// <a download> que se pulsa solo. Es la primera descarga que se genera en la propia página (las demás son enlaces a S3).
//
// Donde el navegador no puede (los tests, un navegador sin Blob o sin URL.createObjectURL, una vista incrustada que bloquea las
// descargas) devuelve false y quien llama dice qué hacer en su lugar (copiar el texto): una descarga nunca se pierde en silencio.

export interface OpcionesDescarga {
  /** El tipo del archivo. Sin esto, JSON. */
  tipo?: string;
}

/** Un nombre de archivo que cualquier sistema acepta: sin barras, sin caracteres de control, sin puntos ni espacios al borde. */
export function nombreDeArchivo(nombre: string, respaldo = 'archivo'): string {
  // eslint-disable-next-line no-control-regex -- justo lo que se quiere quitar
  const limpio = nombre.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '').trim();
  return (limpio || respaldo).slice(0, 120);
}

/** Pone el texto en un archivo y lo baja. true si el navegador aceptó empezar la descarga; false si no pudo. */
export function descargarArchivo(nombre: string, contenido: string, op: OpcionesDescarga = {}): boolean {
  if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return false;
  }
  let url = '';
  try {
    url = URL.createObjectURL(new Blob([contenido], { type: op.tipo ?? 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreDeArchivo(nombre);
    a.rel = 'noopener';
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // la URL se suelta después: algunos navegadores empiezan a leerla tras el clic
    const soltar = url;
    setTimeout(() => URL.revokeObjectURL(soltar), 10_000);
    return true;
  } catch {
    if (url) URL.revokeObjectURL(url);
    return false;
  }
}
