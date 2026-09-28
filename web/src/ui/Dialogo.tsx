// Diálogo con foco atrapado, Esc y ARIA de Radix. Reemplaza los modales hechos
// a mano (docs/PLAN-UI.md §2). Sin sombra: la profundidad la dan el velo y la
// superficie (docs/DISENO.md §4).
import * as D from '@radix-ui/react-dialog';
import { useRef, useState, type ReactNode, type RefObject } from 'react';

import { Icono } from './Icono';

// UI·20: entran y salen (tokens.css): 150 ms al abrir, 100 ms al cerrar.
// Mientras sale, la caja no recibe clics: caen en el velo, que sigue tapando
// la página hasta desmontarse.
export const VELO =
  'fixed inset-0 z-40 bg-[rgba(4,9,17,0.72)] ' +
  'data-[state=open]:animate-velo-entra data-[state=closed]:animate-velo-sale';
export const CAJA =
  'fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 ' +
  'rounded-grande border border-linea bg-superficie p-6 text-texto ' +
  'data-[state=open]:animate-caja-entra data-[state=closed]:animate-caja-sale ' +
  'data-[state=closed]:pointer-events-none';

// UI·20: la caja tarda 100 ms en irse, y quien la cierra suele vaciar su
// estado en el mismo clic (setVeredicto(null), setEditando(null)…). Mientras
// sale se sigue viendo lo último que tuvo abierta, en vez de encogerse a
// medio camino. Con useState y no useRef: react-hooks prohíbe leer refs al
// pintar.
export function useLoUltimoAbierto<T>(valor: T, abierto: boolean): T {
  const [visto, setVisto] = useState(valor);
  if (abierto && !Object.is(visto, valor)) setVisto(valor);
  return abierto ? valor : visto;
}

export interface PropsDialogo {
  abierto: boolean;
  alCambiar: (abierto: boolean) => void;
  titulo: string;
  /** Una frase que explica el diálogo (la lee el lector de pantalla). */
  descripcion?: string;
  children?: ReactNode;
  /** Botones del pie, de menos a más importante (el principal a la derecha). */
  acciones?: ReactNode;
  /** Dónde cae el foco al abrir; sin él, en lo primero que se toca (la equis). */
  focoInicial?: RefObject<HTMLElement | null>;
  /** Dónde vuelve el foco al cerrar; sin él, a lo que tenía el foco al abrir. */
  focoAlCerrar?: RefObject<HTMLElement | null>;
  /** Si lo que tenía el foco al abrir ya no está (o no se deja enfocar), aquí. */
  focoDeRespaldo?: RefObject<HTMLElement | null>;
}

// Radix devuelve el foco a su <Trigger> al cerrar; aquí los diálogos se abren
// con estado (sin Trigger) y el foco caía al <body>: quien navega con teclado
// perdía el sitio. Se guarda lo que tenía el foco al abrir y se le devuelve.
export function useFocoDeVuelta(respaldo?: RefObject<HTMLElement | null>) {
  const origen = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      origen.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    // UI·20: esto corre al DESMONTAR, 100 ms después de cerrar. En ese rato
    // lo que abrió pudo borrarse o deshabilitarse (en Agenda, la tarjeta que
    // se canceló): entonces va al respaldo
    onCloseAutoFocus: (e: Event) => {
      for (const destino of [origen.current, respaldo?.current]) {
        if (!destino?.isConnected) continue;
        destino.focus();
        if (document.activeElement === destino) {
          e.preventDefault();
          return;
        }
      }
    },
  };
}

// El doble clic en el botón que abre el diálogo: el segundo clic caía sobre
// el velo que el primero acababa de pintar y lo cerraba al instante — desde
// fuera parece un botón muerto (static/agenda.html, AGGRACIA_MS). Los primeros
// GRACIA_MS el velo no cierra nada. (La confirmación no lo necesita: su velo
// nunca cierra.)
export const GRACIA_MS = 300;

function useGraciaDelVelo() {
  const abierto = useRef(0);
  return {
    marcar: () => {
      abierto.current = performance.now();
    },
    onPointerDownOutside: (e: Event) => {
      if (performance.now() - abierto.current < GRACIA_MS) e.preventDefault();
    },
  };
}

export function Dialogo({
  abierto, alCambiar, focoInicial, focoAlCerrar, focoDeRespaldo, ...props
}: PropsDialogo) {
  const foco = useFocoDeVuelta(focoDeRespaldo);
  const gracia = useGraciaDelVelo();
  // campo por campo: cada uno conserva su identidad entre renders del padre
  const titulo = useLoUltimoAbierto(props.titulo, abierto);
  const descripcion = useLoUltimoAbierto(props.descripcion, abierto);
  const children = useLoUltimoAbierto(props.children, abierto);
  const acciones = useLoUltimoAbierto(props.acciones, abierto);
  return (
    <D.Root open={abierto} onOpenChange={alCambiar}>
      <D.Portal>
        <D.Overlay className={VELO} />
        <D.Content
          className={CAJA}
          // UI·20: mientras sale (100 ms) muestra lo último con sus handlers
          // de entonces; el pointer-events-none frena al ratón, esto al
          // teclado (un Enter en el campo no manda el formulario ya cerrado)
          inert={!abierto}
          onOpenAutoFocus={e => {
            gracia.marcar();
            foco.onOpenAutoFocus();
            if (focoInicial?.current) {
              e.preventDefault();
              focoInicial.current.focus();
            }
          }}
          onCloseAutoFocus={e => {
            if (focoAlCerrar?.current) {
              e.preventDefault();
              focoAlCerrar.current.focus();
            } else foco.onCloseAutoFocus(e);
          }}
          onPointerDownOutside={gracia.onPointerDownOutside}
          {...(descripcion ? {} : { 'aria-describedby': undefined })}>
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
