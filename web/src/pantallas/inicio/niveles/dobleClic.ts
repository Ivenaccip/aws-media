// La guarda del doble clic de las páginas del recorrido (el mapa, cada área, cada grupo y la caja). Un doble clic en una ficha del mapa o
// en la tarjeta de un grupo carga otra página con el primer clic, y el segundo (`detail` 2) cae sobre lo que apareció donde estaba lo
// pulsado (a 390 px la ficha «Marketing» y la tarjeta «Distrito» de la página siguiente coinciden; la tarjeta «Imagen» cae sobre el chip
// de la tarea de la caja): lo activaría sin que nadie lo pidiera. Cada página cuenta desde que ELLA se cargó (PaginaNivel.tsx y
// PaginaHerramienta.tsx). Sin React ni DOM, y sin nada de la caja: viaja con las páginas de nivel.

/** La hora de un clic. Aparte, y no un `Date.now()` suelto en el componente: así la lectura del reloj vive fuera del render. */
export const ahora = (): number => Date.now();

/** Cuánto después de cargar la página un segundo clic de un doble clic se toma por accidente. */
export const VENTANA_DOBLE_CLIC_MS = 500;

/** El segundo clic (`detail > 1`) a menos de medio segundo de cargada la página no cuenta; una elección deliberada (otro clic pasado el
 *  medio segundo) y el teclado (Enter: `detail` 0) pasan. */
export const esDobleClicAccidental = (detail: number, msDesdeElCambio: number): boolean =>
  detail > 1 && msDesdeElCambio < VENTANA_DOBLE_CLIC_MS;
