// El contenedor del panel de Ajustes: el mismo para un cuadro elegido (AjustesNodo), una flecha elegida (AjustesEnlace) y
// «no hay nada elegido» (AjustesVacio). Siempre hay UNO en la página, con `id="ajustes"` y `tabIndex={-1}`: es adonde el reductor
// manda el foco cuando se abre un cuadro con Enter o Espacio (`foco: { k: 'ajustes' }`), y Constructor.tsx lo busca por ese id.
//
// Esc dentro del panel regresa al cuadro o a la flecha que se estaba editando (`volverDeAjustes`), salvo si el foco está en un
// `<select>`: ahí Esc cierra su lista y no debe sacar a la persona del campo.
//
// El teclado va en un `<div role="presentation">` que envuelve al `<aside>`: jsx-a11y no deja un `onKeyDown` en un aside, y los
// eventos de todo lo de adentro suben hasta el envoltorio.
import type { ReactNode } from 'react';

import { unir } from '../../ui/unir';
import type { AccionConstructor } from './modelo/tipos';
import { esComposicion, TituloDePanel } from './PiezasPanel';

/** El `id` del panel de Ajustes (el foco del reductor lo busca por aquí). */
export const ID_AJUSTES = 'ajustes';

export interface PropsPanelAjustes {
  /** El nombre del panel para el lector de pantalla: «Ajustes del cuadro», «Ajustes de la conexión»… */
  etiqueta: string;
  despachar: (accion: AccionConstructor) => void;
  /** Clases del envoltorio (el ancho y el lugar en la página los pone quien arma la pantalla). */
  className?: string;
  children: ReactNode;
}

export function PanelAjustes({ etiqueta, despachar, className, children }: PropsPanelAjustes) {
  return (
    <div
      role="presentation"
      className={unir('min-w-0', className)}
      onKeyDown={e => {
        if (e.key !== 'Escape' || e.defaultPrevented || esComposicion(e)) return;
        if (e.target instanceof HTMLSelectElement) return;
        e.preventDefault();
        despachar({ k: 'volverDeAjustes' });
      }}
    >
      <aside
        id={ID_AJUSTES}
        tabIndex={-1}
        aria-label={etiqueta}
        className="flex min-w-0 flex-col gap-4 rounded-grande border border-linea bg-superficie p-6"
      >
        {children}
      </aside>
    </div>
  );
}

export interface PropsAjustesVacio {
  /** Lo que dice `textoSinSeleccion(estado)`. */
  texto: string;
  despachar: (accion: AccionConstructor) => void;
  className?: string;
}

/** El panel cuando no hay nada elegido: el título y la pista de qué tocar. */
export function AjustesVacio({ texto, despachar, className }: PropsAjustesVacio) {
  return (
    <PanelAjustes etiqueta="Ajustes" despachar={despachar} {...(className ? { className } : {})}>
      <TituloDePanel>Ajustes</TituloDePanel>
      <p className="m-0 text-sm text-secundario">{texto}</p>
    </PanelAjustes>
  );
}
