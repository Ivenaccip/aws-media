// Botones: tres niveles y cinco estados (docs/DISENO.md §5). El principal va
// UNO por pantalla; el que cobra es <BotonCobro>, que se apoya en este.
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

import { unir } from './unir';

export type Nivel = 'principal' | 'secundario' | 'enlace' | 'peligro';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-boton text-sm font-medium ' +
  'transition-[background-color,border-color,color,transform] duration-[120ms] ease-salida ' +
  'cursor-pointer disabled:cursor-default';

const NIVEL: Record<Nivel, string> = {
  principal:
    'border-0 bg-ambar font-semibold text-tinta hover:enabled:bg-ambar-claro ' +
    'active:enabled:scale-[0.98] ' +
    // sin saldo o deshabilitado: borde discontinuo y gris, nunca ámbar apagado
    'disabled:border disabled:border-dashed disabled:border-campo ' +
    'disabled:bg-superficie disabled:text-secundario',
  secundario:
    'border border-campo bg-transparent text-texto hover:enabled:border-secundario ' +
    'hover:enabled:bg-elevada active:enabled:scale-[0.98] active:enabled:bg-activa ' +
    'disabled:text-secundario',
  enlace:
    'min-h-0 border-0 bg-transparent p-0 text-enlace hover:text-texto hover:underline ' +
    'underline-offset-4',
  peligro:
    'border border-peligro-borde bg-peligro-fondo font-semibold text-peligro-texto ' +
    'hover:enabled:border-error active:enabled:scale-[0.98] active:enabled:bg-peligro-borde ' +
    'active:enabled:text-texto',
};

function clases(nivel: Nivel, denso: boolean): string {
  const alto = nivel === 'enlace' ? '' : denso ? 'min-h-10 px-4' : 'min-h-12 px-5';
  return unir(BASE, NIVEL[nivel], alto);
}

/** Las clases de un botón para un <a>: navegar es un enlace, no un botón. */
export function claseBoton(nivel: Nivel = 'secundario', denso = false): string {
  return unir(clases(nivel, denso), 'no-underline');
}

export interface PropsBoton extends ButtonHTMLAttributes<HTMLButtonElement> {
  nivel?: Nivel;
  /** Barras densas: 40 px en vez de 48. */
  denso?: boolean;
  /** Texto mientras trabaja («Generando…»). Mientras haya, no acepta clics. */
  trabajando?: string | false;
  icono?: ReactNode;
  /** React 19: la ref es una prop más y llega al <button>. */
  ref?: Ref<HTMLButtonElement>;
}

export function Boton({
  nivel = 'secundario',
  denso = false,
  trabajando = false,
  icono,
  className,
  children,
  onClick,
  type = 'button',
  ...resto
}: PropsBoton) {
  // Trabajando NO es deshabilitado: el deshabilitado del principal se pinta
  // gris y discontinuo («te faltan créditos») y confundiría. Se queda con su
  // aspecto, dice «Generando…» y se traga los clics.
  const ocupado = Boolean(trabajando);
  return (
    <button
      type={type}
      className={unir(clases(nivel, denso), ocupado && 'cursor-progress', className)}
      aria-busy={ocupado || undefined}
      aria-disabled={ocupado || undefined}
      onClick={ocupado ? undefined : onClick}
      {...resto}
    >
      {icono}
      {trabajando || children}
    </button>
  );
}
