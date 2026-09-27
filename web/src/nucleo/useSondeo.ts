// El prefijo «use» lo exige React (reglas de los hooks), no es spanglish gratuito.
// sondear() dentro de React: sondea mientras `activo` sea true y se para solo
// al desmontar o al apagarse. La tarea puede cambiar en cada render; el
// sondeo usa siempre la última sin reiniciar la escalera.
import { useEffect, useRef } from 'react';

import { sondear, type Opciones, type Tarea } from './sondeo';

export function useSondeo(activo: boolean, tarea: Tarea, op: Omit<Opciones, 'doc'> = {}): void {
  const ultima = useRef(tarea);
  const opciones = useRef(op);
  useEffect(() => {
    ultima.current = tarea;
    opciones.current = op;
  });

  useEffect(() => {
    if (!activo) return;
    const s = sondear(() => ultima.current(), {
      ...opciones.current,
      alFallar: e => opciones.current.alFallar?.(e),
    });
    return () => s.parar();
  }, [activo]);
}
