// Pestañas con flechas, Inicio/Fin y ARIA de Radix. La elegida se marca en
// blanco, no en ámbar: el ámbar solo dice «haz algo» (docs/DISENO.md §3).
import * as T from '@radix-ui/react-tabs';
import { useState, type ReactNode } from 'react';

export interface Pestana {
  id: string;
  titulo: string;
  contenido: ReactNode;
  /** Una vez abierta, sigue montada (oculta) al pasar a otra pestaña, en vez de desmontarse. Para lo que tiene algo en curso o a
   *  medias —una subida, un formulario escrito— que no debe perderse por mirar otra vista. Antes de la primera visita no se monta
   *  (lo que pide datos al abrirse sigue pidiéndolos hasta entonces). Sin esto, la pestaña de ahora es la única montada, como siempre. */
  conservar?: boolean;
}

export interface PropsPestanas {
  pestanas: Pestana[];
  /** Nombre del grupo para el lector de pantalla. */
  etiqueta: string;
  inicial?: string;
  /** Se llama con el id de la pestaña a la que se pasó (con el ratón o con el teclado). Quien lo pide la sigue por fuera —el pie de
   *  la hoja de videos cambia con la pestaña— y las pestañas siguen siendo suyas: no es un componente controlado. */
  alCambiar?: (id: string) => void;
}

export function Pestanas({ pestanas, etiqueta, inicial, alCambiar }: PropsPestanas) {
  const primera = inicial ?? pestanas[0]?.id;
  // la pestaña de ahora y las que ya se abrieron: las dos cosas hacen falta para `conservar`
  const [activa, setActiva] = useState(primera);
  const [vistas, setVistas] = useState<ReadonlySet<string>>(() => new Set(primera ? [primera] : []));
  function cambiar(id: string) {
    setActiva(id);
    setVistas(v => (v.has(id) ? v : new Set(v).add(id)));
    alCambiar?.(id);
  }
  return (
    <T.Root {...(activa ? { value: activa } : {})} onValueChange={cambiar}>
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
      {pestanas.map(p => {
        // la conservada, ya visitada: Radix no la desmonta (forceMount) y aquí se oculta mientras no es la de ahora
        const conservada = p.conservar === true && vistas.has(p.id);
        return (
          <T.Content
            key={p.id}
            value={p.id}
            className="pt-4 data-[state=inactive]:hidden"
            {...(conservada ? { forceMount: true as const, hidden: p.id !== activa } : {})}>
            {p.contenido}
          </T.Content>
        );
      })}
    </T.Root>
  );
}
