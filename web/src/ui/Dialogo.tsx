// Diálogo con foco atrapado, Esc y ARIA de Radix. Reemplaza los modales hechos
// a mano (docs/PLAN-UI.md §2). Sin sombra: la profundidad la dan el velo y la
// superficie (docs/DISENO.md §4).
import * as D from '@radix-ui/react-dialog';
import { useRef, type ReactNode } from 'react';

import { Icono } from './Icono';

export const VELO = 'fixed inset-0 z-40 bg-[rgba(4,9,17,0.72)]';
export const CAJA =
  'fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 ' +
  'rounded-grande border border-linea bg-superficie p-6 text-texto';

export interface PropsDialogo {
  abierto: boolean;
  alCambiar: (abierto: boolean) => void;
  titulo: string;
  /** Una frase que explica el diálogo (la lee el lector de pantalla). */
  descripcion?: string;
  children?: ReactNode;
  /** Botones del pie, de menos a más importante (el principal a la derecha). */
  acciones?: ReactNode;
}

// Radix devuelve el foco a su <Trigger> al cerrar; aquí los diálogos se abren
// con estado (sin Trigger) y el foco caía al <body>: quien navega con teclado
// perdía el sitio. Se guarda lo que tenía el foco al abrir y se le devuelve.
export function useFocoDeVuelta() {
  const origen = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      origen.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (e: Event) => {
      if (!origen.current?.isConnected) return;
      e.preventDefault();
      origen.current.focus();
    },
  };
}

export function Dialogo({ abierto, alCambiar, titulo, descripcion, children, acciones }: PropsDialogo) {
  const foco = useFocoDeVuelta();
  return (
    <D.Root open={abierto} onOpenChange={alCambiar}>
      <D.Portal>
        <D.Overlay className={VELO} />
        <D.Content className={CAJA} {...foco} {...(descripcion ? {} : { 'aria-describedby': undefined })}>
          <div className="flex items-start justify-between gap-4">
            <D.Title className="m-0 font-titulo text-titulo-sm font-bold">{titulo}</D.Title>
            <D.Close
              className="-m-2 inline-flex size-11 items-center justify-center rounded-medio text-secundario hover:bg-elevada hover:text-texto"
              aria-label="Cerrar"
            >
              <Icono nombre="cerrar" />
            </D.Close>
          </div>
          {descripcion && (
            <D.Description className="mb-0 mt-2 text-md text-secundario">{descripcion}</D.Description>
          )}
          {children && <div className="mt-4">{children}</div>}
          {acciones && <div className="mt-6 flex flex-wrap justify-end gap-3">{acciones}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
