// Los avisos rápidos de las pantallas React: el cuadro de abajo a la derecha que
// ya trae static/trabajos.js (UI·15), el mismo de «Tus trabajos». Ahí se dice
// «ya lo estamos creando» y ahí caen los errores de lo que se pide.
//
// Donde trabajos.js no se cargó (los tests, la vitrina), `avisar` devuelve false
// y quien llama dice lo mismo en su propia pantalla: un aviso nunca se pierde.
//
// Todo lo que lleva la misma `clave` se reemplaza: un pedido nuevo quita el aviso
// anterior de ese pedido.

export type TipoAvisoRapido = 'ok' | 'mal' | 'info';

export interface OpcionesAvisoRapido {
  /** `ok` (verde, se va solo a los 5 s), `mal` (rojo, se queda hasta cerrarlo) o `info`. */
  tipo?: TipoAvisoRapido;
  /** Cuánto dura; 0, hasta cerrarlo. Sin esto, lo que dice trabajos.js según el tipo. */
  segundos?: number;
  /** Lo que comparte clave se reemplaza. */
  clave?: string;
}

/** Pone el aviso en el cuadro. false si el cuadro no existe en esta página. */
export function avisar(texto: string, op: OpcionesAvisoRapido = {}): boolean {
  const cuadro = typeof window === 'undefined' ? undefined : window.avisos;
  if (!cuadro) return false;
  cuadro.mostrar(texto, op);
  return true;
}

/** Quita el aviso con esa clave, si está. */
export function quitarAviso(clave: string): void {
  if (typeof window !== 'undefined') window.avisos?.quitar(clave);
}
