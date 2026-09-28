// El marco de cada pantalla migrada (UI·7, docs/PLAN-UI.md §3): arriba
// «← Estudio», el título y su bajada.
//
// «Usar la versión anterior» ya no se enseña (decisión del dueño, 28-sep): la
// ruta /ui/clasica sigue en server/migracion.py por si hace falta volver a una
// pantalla vieja a mano, pero ninguna pantalla la anuncia.
// 64 px arriba: la píldora del monedero (fija, arriba a la derecha) acaba a
// 52 px (UI·12).
import type { ReactNode } from 'react';

import { Icono } from '../ui/Icono';

export interface PropsMarco {
  /** El nombre de la pantalla en server/migracion.py (p. ej. «admin»). Hoy no se
   *  enseña: queda para identificar la pantalla. */
  pantalla: string;
  /** Casi siempre un texto; imágenes pasa su título con la palabra que gira. */
  titulo: ReactNode;
  /** Una línea bajo el título: qué hay en esta pantalla. */
  bajada?: ReactNode;
  children: ReactNode;
}

const ENLACE =
  'inline-flex min-h-11 items-center gap-2 text-sm text-enlace no-underline ' +
  'hover:text-texto hover:underline underline-offset-4';

export function Marco({ titulo, bajada, children }: PropsMarco) {
  return (
    <div className="mx-auto max-w-[1080px] px-4 pt-16 pb-10 sm:px-6">
      <nav aria-label="Navegación" className="flex flex-wrap items-center justify-between gap-x-6">
        <a className={ENLACE} href="/estudio/">
          <Icono nombre="volver" />
          Estudio
        </a>
      </nav>
      <main>
        <h1 className="mt-2 mb-2 font-titulo text-titulo-lg font-extrabold tracking-[-0.02em]">{titulo}</h1>
        {bajada && <div className="mb-6 max-w-[75ch] text-secundario">{bajada}</div>}
        {children}
      </main>
    </div>
  );
}
