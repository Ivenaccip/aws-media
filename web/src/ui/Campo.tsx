// Un campo con su etiqueta, su ayuda y su error (docs/DISENO.md §8: el error
// va junto al campo, antes de mandar y sin gastar créditos, y dice cómo
// arreglarlo).
//
// UI·24: cuando el error APARECE (sin error → con error), la caja tiembla una
// vez (240 ms, tokens.css): el «no» universal. No tiembla en cada tecla, ni si
// solo cambia el texto del error, ni si el campo ya nace con error. El mensaje
// y aria-invalid son los de siempre; el temblor es un extra, y con «reducir
// movimiento» no está.
import { useId, useState, type InputHTMLAttributes, type Ref } from 'react';

import { unir } from './unir';

export interface PropsCampo extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  etiqueta: string;
  ayuda?: string;
  error?: string | null;
  /** La etiqueta existe (lectores de pantalla) pero no se ve: cuando el título
   *  de la tarjeta ya dice qué va en el campo. */
  etiquetaOculta?: boolean;
  /** React 19: la ref es una prop más y llega al <input>. */
  ref?: Ref<HTMLInputElement>;
}

export function Campo({ etiqueta, etiquetaOculta, ayuda, error, className, onAnimationEnd, ...resto }: PropsCampo) {
  const id = useId();
  const idAyuda = ayuda ? id + '-ayuda' : undefined;
  const idError = error ? id + '-error' : undefined;
  const describe = [idError, idAyuda].filter(Boolean).join(' ') || undefined;

  // el error de antes va en estado y se compara en el render (el patrón de
  // React para «cambió una prop»): leer una ref en el render lo prohíbe
  // react-hooks/refs, y un efecto pintaría un cuadro quieto antes de temblar
  const [antes, setAntes] = useState(error);
  const [tiembla, setTiembla] = useState(false);
  if (error !== antes) {
    setAntes(error);
    if (!error) setTiembla(false); // se fue: la próxima vez que aparezca, tiembla
    else if (!antes) setTiembla(true);
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={etiquetaOculta ? 'sr-only' : 'text-sm font-medium'}>
        {etiqueta}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describe}
        className={unir(
          'min-h-11 rounded-medio border bg-elevada px-3 text-sm text-texto',
          error ? 'border-error' : 'border-campo',
          tiembla && 'motion-safe:animate-campo-tiembla',
          className,
        )}
        onAnimationEnd={e => {
          setTiembla(false);
          onAnimationEnd?.(e);
        }}
        {...resto}
      />
      {error && <p id={idError} className="m-0 text-xs text-error">{error}</p>}
      {ayuda && <p id={idAyuda} className="m-0 text-xs text-secundario">{ayuda}</p>}
    </div>
  );
}
