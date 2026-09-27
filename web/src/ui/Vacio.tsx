// Pantalla o lista vacía: enseña el primer paso (docs/DISENO.md §8).
import type { ReactNode } from 'react';

import { Icono } from './Icono';
import type { NombreIcono } from './iconos';

export interface PropsVacio {
  icono: NombreIcono;
  titulo: string;
  texto: string;
  /** El primer paso: normalmente un <Boton> o un enlace. */
  accion?: ReactNode;
}

export function Vacio({ icono, titulo, texto, accion }: PropsVacio) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-grande border border-dashed border-linea px-6 py-12 text-center">
      <Icono nombre={icono} className="size-8 text-secundario" />
      <h2 className="m-0 text-titulo-sm font-bold">{titulo}</h2>
      <p className="m-0 max-w-[65ch] text-md text-secundario">{texto}</p>
      {accion}
    </div>
  );
}
