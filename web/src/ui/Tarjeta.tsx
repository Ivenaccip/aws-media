import type { ReactNode } from 'react';

import { unir } from './unir';

export interface PropsTarjeta {
  titulo?: string;
  children?: ReactNode;
  className?: string;
}

/** Superficie con línea: la unidad de las pantallas (docs/DISENO.md §3-§4). */
export function Tarjeta({ titulo, children, className }: PropsTarjeta) {
  return (
    <section className={unir('rounded-grande border border-linea bg-superficie p-6', className)}>
      {titulo && <h2 className="m-0 mb-3 text-titulo-sm font-bold">{titulo}</h2>}
      {children}
    </section>
  );
}
