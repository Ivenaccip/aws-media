// Sondeo escalonado: pregunta seguido al principio y cada vez menos después,
// y se duerme con la pestaña oculta (Chrome estrangula los timers de fondo y
// nadie mira). Es la escalera de static/mix.html (MXEJ_PASOS) hecha módulo.
//
// La escalera tiene que ser NO decreciente: repetir un paso vale (5000, 5000),
// bajar no. El último paso se repite hasta que la tarea diga «ya».

export const ESCALERA = [5000, 5000, 5000, 10000, 10000, 20000] as const;

/** La tarea devuelve true cuando ya no hace falta seguir preguntando. */
export type Tarea = () => Promise<boolean>;

export interface Reloj {
  poner(fn: () => void, ms: number): unknown;
  quitar(id: unknown): void;
}

export interface Opciones {
  escalera?: readonly number[];
  reloj?: Reloj;
  doc?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
  /** Un fallo de red no para el sondeo; se avisa y se sigue. */
  alFallar?: (e: unknown) => void;
}

export interface Sondeo {
  parar(): void;
}

const RELOJ_REAL: Reloj = {
  poner: (fn, ms) => setTimeout(fn, ms),
  quitar: id => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export function validarEscalera(escalera: readonly number[]): void {
  if (!escalera.length) throw new RangeError('la escalera está vacía');
  escalera.forEach((ms, i) => {
    if (!(ms > 0)) throw new RangeError(`paso ${i} no es positivo`);
    if (i && ms < escalera[i - 1]!) throw new RangeError(`la escalera baja en el paso ${i}`);
  });
}

export function sondear(tarea: Tarea, op: Opciones = {}): Sondeo {
  const escalera = op.escalera ?? ESCALERA;
  validarEscalera(escalera);
  const reloj = op.reloj ?? RELOJ_REAL;
  const doc = op.doc ?? document;

  let paso = 0;
  let id: unknown = null;
  let enVuelo = false;
  let parado = false;

  const siguiente = () => escalera[Math.min(paso, escalera.length - 1)]!;

  function programar() {
    if (parado || doc.hidden || id !== null) return;
    id = reloj.poner(correr, siguiente());
  }

  async function correr() {
    id = null;
    if (parado || enVuelo) return;
    enVuelo = true;
    try {
      if (await tarea()) { parar(); return; }
    } catch (e) {
      op.alFallar?.(e);
    } finally {
      enVuelo = false;
    }
    paso += 1;
    programar();
  }

  function alCambiarVisibilidad() {
    if (doc.hidden) {
      if (id !== null) { reloj.quitar(id); id = null; }
    } else if (!enVuelo) {
      // al volver se pregunta YA: lo que pasó en la otra pestaña se ve al instante
      void correr();
    }
  }

  function parar() {
    parado = true;
    if (id !== null) { reloj.quitar(id); id = null; }
    doc.removeEventListener('visibilitychange', alCambiarVisibilidad);
  }

  doc.addEventListener('visibilitychange', alCambiarVisibilidad);
  programar();
  return { parar };
}
