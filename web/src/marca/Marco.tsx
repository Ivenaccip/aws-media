// El marco de cada pantalla migrada (UI·7, docs/PLAN-UI.md §3): arriba
// «← Estudio» y, mientras la vieja exista, «Usar la versión anterior».
//
// Ese enlace va a /ui/clasica, que decide server/migracion.py: deja la cookie
// `ui=clasica` y lleva a la URL vieja. Si la pantalla ya está `retirada`, el
// server lo devuelve aquí mismo; por eso el enlace no necesita saber la etapa.
import type { ReactNode } from 'react';

import { Icono } from '../ui/Icono';

export interface PropsMarco {
  /** El nombre de la pantalla en server/migracion.py (p. ej. «admin»). */
  pantalla: string;
  titulo: string;
  /** Una línea bajo el título: qué hay en esta pantalla. */
  bajada?: ReactNode;
  children: ReactNode;
}

const ENLACE =
  'inline-flex min-h-11 items-center gap-2 text-sm text-enlace no-underline ' +
  'hover:text-texto hover:underline underline-offset-4';

export function enlaceClasica(pantalla: string): string {
  return '/ui/clasica?' + new URLSearchParams({ pantalla }).toString();
}

export function Marco({ pantalla, titulo, bajada, children }: PropsMarco) {
  return (
    <div className="mx-auto max-w-[1080px] px-4 py-8 sm:px-6 sm:py-10">
      <nav aria-label="Navegación" className="flex flex-wrap items-center justify-between gap-x-6">
        <a className={ENLACE} href="/estudio/">
          <Icono nombre="volver" />
          Estudio
        </a>
        <a className={ENLACE} href={enlaceClasica(pantalla)}>
          Usar la versión anterior
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
