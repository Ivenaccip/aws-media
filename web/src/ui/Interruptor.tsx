// Un interruptor de sí o no (`role="switch"`): una pista y una bolita. El estado se dice con palabras junto a él
// (quien lo usa escribe «Con sonido» o «Sin sonido»): el color solo no basta.
//
// `bloqueado` no cambia nada, pero el botón sigue en el orden del teclado y puede apuntar a su motivo con
// `aria-describedby`. Un `disabled` no recibe el foco y su motivo no se lee: por eso se usa `aria-disabled`.
//
// El botón mide 44 px de alto (el área que se toca); la pista dibujada es más baja y no empuja el diseño.
import type { ButtonHTMLAttributes } from 'react';

import { unir } from './unir';

export interface PropsInterruptor extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'type'> {
  activo: boolean;
  alCambiar: (activo: boolean) => void;
  bloqueado?: boolean;
}

export function Interruptor({ activo, alCambiar, bloqueado = false, className, onClick, ...resto }: PropsInterruptor) {
  return (
    <button
      {...resto}
      type="button"
      role="switch"
      aria-checked={activo}
      aria-disabled={bloqueado || undefined}
      onClick={e => {
        onClick?.(e);
        if (!bloqueado) alCambiar(!activo);
      }}
      className={unir(
        // `relative`: el botón se pinta encima de lo que lo rodea, para que sus 44 px se toquen enteros (el margen negativo lo mete bajo el texto de al lado)
        'relative -my-2 inline-flex min-h-11 flex-none items-center border-0 bg-transparent p-0',
        bloqueado ? 'cursor-not-allowed' : 'cursor-pointer',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={unir(
          'flex h-6.5 w-11 items-center rounded-pildora border p-0.5 transition-colors duration-[120ms] motion-reduce:transition-none',
          activo ? 'border-ambar bg-ambar' : 'border-campo bg-elevada',
          bloqueado && 'opacity-45',
        )}
      >
        <span
          className={unir(
            'block size-5 rounded-pildora transition-transform duration-[120ms] motion-reduce:transition-none',
            activo ? 'translate-x-[18px] bg-tinta' : 'translate-x-0 bg-secundario',
          )}
        />
      </span>
    </button>
  );
}
