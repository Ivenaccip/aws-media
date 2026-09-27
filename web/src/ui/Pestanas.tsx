// Pestañas con flechas, Inicio/Fin y ARIA de Radix. La elegida se marca en
// blanco, no en ámbar: el ámbar solo dice «haz algo» (docs/DISENO.md §3).
import * as T from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';

export interface Pestana {
  id: string;
  titulo: string;
  contenido: ReactNode;
}

export interface PropsPestanas {
  pestanas: Pestana[];
  /** Nombre del grupo para el lector de pantalla. */
  etiqueta: string;
  inicial?: string;
}

export function Pestanas({ pestanas, etiqueta, inicial }: PropsPestanas) {
  const primera = inicial ?? pestanas[0]?.id;
  return (
    <T.Root {...(primera ? { defaultValue: primera } : {})}>
      <T.List aria-label={etiqueta} className="flex gap-1 border-b border-linea">
        {pestanas.map(p => (
          <T.Trigger
            key={p.id}
            value={p.id}
            className={
              'min-h-11 cursor-pointer border-0 border-b-2 border-transparent bg-transparent px-4 ' +
              'text-sm font-medium text-secundario hover:text-texto ' +
              'data-[state=active]:border-texto data-[state=active]:text-texto data-[state=active]:font-semibold'
            }
          >
            {p.titulo}
          </T.Trigger>
        ))}
      </T.List>
      {pestanas.map(p => (
        <T.Content key={p.id} value={p.id} className="pt-4">
          {p.contenido}
        </T.Content>
      ))}
    </T.Root>
  );
}
