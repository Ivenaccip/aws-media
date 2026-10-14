// Lo que una persona prefiere y el navegador recuerda por ella (p. ej. «sin sonido» en el clip).
//
// Solo cuenta como comodidad: el navegador puede negar el almacenamiento (ventana privada, datos
// bloqueados) o traerlo vacío, y todo debe funcionar igual. Por eso toda lectura y escritura va en un
// try, y nada que importe (créditos, pedidos) se guarda aquí: el servidor decide y cobra.

/** Lo guardado bajo esa clave, o null si no hay nada o el navegador no deja leer. */
export function leerPreferencia(clave: string): string | null {
  try {
    return window.localStorage.getItem(clave);
  } catch {
    return null;
  }
}

/** Guarda el valor; si el navegador no deja, la preferencia vale solo para esta pestaña. */
export function guardarPreferencia(clave: string, valor: string): void {
  try {
    window.localStorage.setItem(clave, valor);
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}
