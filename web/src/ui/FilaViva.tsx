// UI·21 — una fila de una lista viva (nucleo/useListaViva.ts). Si llegó
// nueva, entra abriendo su espacio de 0 a su altura (240 ms) en vez de
// empujar todo de golpe; donde el navegador no sabe animar hacia `auto`
// (antes de Chrome 129), solo se funde. Su `nombre` solo se vuelve
// view-transition-name mientras la lista se reordena (tokens.css): así cada
// fila viaja de su lugar viejo al nuevo, y las transiciones entre pantallas
// (UI·18) no fotografían cada fila.
import { useState, type AnimationEvent, type CSSProperties, type ReactNode } from 'react';

import { unir } from './unir';

export interface PropsFilaViva {
  /** Único en la pantalla: nucleo/transiciones.ts → nombreVT(). */
  nombre: string;
  /** Llegó en la última actualización (useListaViva → `nuevos`). Solo cuenta al montar. */
  nueva: boolean;
  como?: 'div' | 'li';
  className?: string;
  children: ReactNode;
}

export function FilaViva({ nombre, nueva, como: Como = 'div', className, children }: PropsFilaViva) {
  const [entrando, setEntrando] = useState(nueva);
  // al terminar se quita la clase: si React mueve el nodo, la animación CSS
  // volvería a empezar
  const fin = (e: AnimationEvent<HTMLElement>) => {
    if (e.target === e.currentTarget) setEntrando(false);
  };
  return (
    <Como
      className={unir('fila-viva', entrando && 'fila-entra', className)}
      style={{ '--vt-nombre': nombre } as CSSProperties}
      onAnimationEnd={fin}
    >
      {children}
    </Como>
  );
}
