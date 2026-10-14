// El cuadro donde se escribe, bien definido (dueño, 14-oct-2026: «un cuadro bien definido para que se vea que ahí
// tienen un área de escritura»). Lo usan las tres familias de la caja del inicio (Imagen, Video y Edición).
//
// Es un contenedor con el aspecto de «campo» de la carta (docs/DISENO.md §3 y §4: fondo elevada, borde de campo —NO el de
// línea, que no llega a 3:1—, radio de campos, espacios múltiplos de 4) y, adentro, el <textarea> sin borde ni fondo ni
// aro propios. El contenedor existe a propósito, y no un borde puesto al <textarea>: si algún día algo vive DENTRO del
// cuadro, debajo del texto (`children`), el borde, el fondo y el aro de foco tienen que envolver las dos cosas. (Las ideas de
// Edición, que se pensaron para ahí, terminaron siendo la pista del propio campo, 14-oct-2026: hoy nadie usa `children`.)
//
// Foco (§4: «en todo lo que se enfoca, sin excepción»): el aro ámbar de tokens.css lo dibuja el contenedor cuando algo
// de adentro tiene foco visible (`has-focus-visible`), con las mismas medidas de siempre, y el <textarea> NO dibuja el
// suyo: dos aros, uno dentro del otro, se verían como un error. Con `has-focus-visible` y no `focus-within`, un botón
// de adentro que se toque con el ratón no enciende el aro de todo el cuadro.
//
// Un clic en el relleno del cuadro (lo que no es el texto ni algo de adentro) lleva el foco al texto: el cuadro entero
// es el área de escritura, no solo las líneas que ya tienen letras.
import type { ReactNode, Ref, TextareaHTMLAttributes } from 'react';

import { unir } from './unir';

export interface PropsCuadroDeTexto extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Lo que va DENTRO del cuadro, debajo del texto (hoy nadie lo usa; la ranura queda para cuando algo lo pida). */
  children?: ReactNode;
  /** Clases del contenedor (`className` va al <textarea>: ahí viven la altura mínima y si se estira). */
  claseCuadro?: string;
  /** React 19: la ref es una prop más y llega al <textarea>. */
  ref?: Ref<HTMLTextAreaElement>;
}

const CUADRO =
  'flex flex-col gap-2 rounded-medio border border-campo bg-elevada p-3 ' +
  'has-focus-visible:outline-2 has-focus-visible:outline-offset-3 has-focus-visible:outline-ambar-claro';

const TEXTO =
  'block w-full border-0 bg-transparent p-0 text-sm text-texto outline-none placeholder:text-secundario';

export function CuadroDeTexto({ className, claseCuadro, children, ...resto }: PropsCuadroDeTexto) {
  return (
    // pulsar el relleno es un atajo con ratón: el camino accesible es el <textarea>, que se enfoca con Tab
    <div
      role="presentation"
      className={unir(CUADRO, claseCuadro)}
      onMouseDown={e => {
        // solo el relleno del propio cuadro: el texto y lo que haya dentro atienden sus clics. preventDefault evita que
        // el navegador, al no hallar nada enfocable bajo el ratón, suelte el foco que acaba de recibir el texto
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        e.currentTarget.querySelector('textarea')?.focus();
      }}
    >
      <textarea className={unir(TEXTO, className)} {...resto} />
      {children}
    </div>
  );
}
