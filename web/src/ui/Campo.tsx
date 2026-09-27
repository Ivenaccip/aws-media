// Un campo con su etiqueta, su ayuda y su error (docs/DISENO.md §8: el error
// va junto al campo, antes de mandar y sin gastar créditos, y dice cómo
// arreglarlo).
import { useId, type InputHTMLAttributes, type Ref } from 'react';

import { unir } from './unir';

export interface PropsCampo extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  etiqueta: string;
  ayuda?: string;
  error?: string | null;
  /** React 19: la ref es una prop más y llega al <input>. */
  ref?: Ref<HTMLInputElement>;
}

export function Campo({ etiqueta, ayuda, error, className, ...resto }: PropsCampo) {
  const id = useId();
  const idAyuda = ayuda ? id + '-ayuda' : undefined;
  const idError = error ? id + '-error' : undefined;
  const describe = [idError, idAyuda].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">{etiqueta}</label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describe}
        className={unir(
          'min-h-11 rounded-medio border bg-elevada px-3 text-sm text-texto',
          error ? 'border-error' : 'border-campo',
          className,
        )}
        {...resto}
      />
      {error && <p id={idError} className="m-0 text-xs text-error">{error}</p>}
      {ayuda && <p id={idAyuda} className="m-0 text-xs text-secundario">{ayuda}</p>}
    </div>
  );
}
