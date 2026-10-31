// Las piezas chicas que comparten los paneles del Constructor (el menú del «+», Ajustes, el editor de la flecha y la tarjeta de
// «Elige cómo arranca tu flujo»): la tarjeta de opción de las cuatro IA y de los dos modos de conectar, la pastilla de una app,
// el cuadro de texto con su etiqueta y el selector nativo. Nada de esto sabe del flujo: reciben textos y devuelven clics.
//
// Reglas del repo que cumplen todas (docs/DISENO.md, informe 03):
//  · Solo clases de tokens.css, escritas enteras (el tema es cerrado: `text-lg` o `bg-red-500` no generan CSS) y ningún color suelto.
//  · Lo que se toca mide ≥ 44 px (`min-h-11`, `min-h-14`) y la letra nunca baja de 13 px (`text-xs`).
//  · Un botón que no se puede usar todavía se apaga con `aria-disabled` (NO `disabled`): sigue en el orden de Tab y al pulsarlo
//    quien lo recibe dice por qué (el reductor avisa el motivo). Se ve como el apagado de la carta: borde discontinuo y gris.
//  · Lo elegido se dice con `aria-pressed` y se ve por forma (borde ámbar hondo + palomita), no solo por color.
import { useId, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode, type TextareaHTMLAttributes } from 'react';

import { CuadroDeTexto } from '../../ui/CuadroDeTexto';
import { Icono } from '../../ui/Icono';
import type { NombreIcono } from '../../ui/iconos';
import { unir } from '../../ui/unir';

/**
 * Un botón de la carta que tiene que medir 44 px y no 40: «denso» da 40 y el objetivo táctil mínimo es 44 (la `!` pesa más que
 * el `min-h-10` de `denso`, sin depender del orden en que Tailwind escriba las dos clases).
 */
export const BOTON_44 = 'min-h-11!';

/**
 * ¿Esta tecla es parte de una composición del método de entrada (IME, teclas muertas)? El Esc que la cancela y el Enter que la confirma son del
 * método de entrada, no de la pantalla: cerrar el menú o agregar la app con ellos tiraría lo que se estaba escribiendo. Safari manda la tecla
 * que cierra la composición ya sin `isComposing` pero con `keyCode` 229.
 */
export const esComposicion = (e: KeyboardEvent): boolean => e.nativeEvent.isComposing || e.keyCode === 229;

// ================================================================ la tarjeta de opción

const OPCION_BASE =
  'flex min-h-14 w-full cursor-pointer items-start justify-between gap-3 rounded-boton border p-3 text-left text-sm text-texto transition-colors';
const OPCION_NORMAL = 'border-campo bg-transparent hover:border-secundario hover:bg-elevada';
const OPCION_ELEGIDA = 'border-ambar-hondo bg-elevada';
const OPCION_BLOQUEADA = 'cursor-default border-dashed border-campo bg-superficie text-secundario';

export interface PropsOpcion extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title'> {
  titulo: string;
  /** La frase de abajo, en gris. */
  detalle?: string;
  /** Una nota con filo ámbar (el motivo de una opción bloqueada, o «No se puede: …»). */
  nota?: string | null;
  /** Un ícono en su cajita a la izquierda (el menú y la tarjeta del disparador). */
  icono?: NombreIcono;
  /** Es la que está elegida hoy: palomita y borde más fuerte. Quien la usa pone además `aria-pressed`. */
  elegida?: boolean;
  /** No se puede elegir: `aria-disabled` + el aspecto apagado. El clic SÍ llega a `onClick`. */
  bloqueada?: boolean;
  /** Algo entre el título y el detalle (el dibujo A → B del editor de la flecha). */
  children?: ReactNode;
}

/**
 * El botón-tarjeta de una opción: título, detalle y, si hace falta, un ícono, una palomita de «elegida», un dibujo y una nota.
 * El nombre accesible es todo su texto (título, detalle y nota), así que lo que se ve es lo que se oye.
 */
export function Opcion({ titulo, detalle, nota, icono, elegida = false, bloqueada = false, children, className, type = 'button', ...resto }: PropsOpcion) {
  return (
    <button
      type={type}
      aria-disabled={bloqueada || undefined}
      className={unir(OPCION_BASE, bloqueada ? OPCION_BLOQUEADA : elegida ? OPCION_ELEGIDA : OPCION_NORMAL, className)}
      {...resto}
    >
      <span className="flex min-w-0 flex-1 items-start gap-3">
        {icono && (
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-medio border border-linea bg-fondo text-texto">
            <Icono nombre={icono} className="size-5!" />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="block text-sm font-semibold [overflow-wrap:anywhere]">{titulo}</span>
          {children}
          {detalle && <span className="block text-xs font-normal text-secundario [overflow-wrap:anywhere]">{detalle}</span>}
          {nota && <span className="mt-1 block border-l-2 border-ambar-hondo pl-2 text-xs font-normal text-texto [overflow-wrap:anywhere]">{nota}</span>}
        </span>
      </span>
      {elegida && <Icono nombre="listo" className="mt-0.5 size-5! text-ambar-claro" />}
    </button>
  );
}

// ================================================================ la pastilla

const PASTILLA = 'inline-flex min-h-11 cursor-pointer items-center rounded-pildora border px-4 text-sm text-texto transition-colors';

export interface PropsPastilla extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  texto: string;
  /** Es la que está elegida hoy (con `aria-pressed` puesto por quien la usa). */
  elegida?: boolean;
}

/** Una pastilla de 44 px: una app del menú, o una sugerencia en Ajustes. */
export function Pastilla({ texto, elegida = false, className, type = 'button', ...resto }: PropsPastilla) {
  return (
    <button
      type={type}
      className={unir(PASTILLA, elegida ? 'border-ambar-hondo bg-elevada' : 'border-campo bg-transparent hover:border-secundario hover:bg-elevada', className)}
      {...resto}
    >
      {texto}
    </button>
  );
}

// ================================================================ cuadro de texto con etiqueta

export interface PropsAreaDeTexto extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  etiqueta: string;
  /** Una frase de ayuda debajo, enlazada con `aria-describedby`. */
  ayuda?: string;
}

/**
 * Un `<textarea>` con su etiqueta visible (el de ui/CuadroDeTexto no la trae). Controlado: quien lo usa pasa `value` y `onChange`.
 * Siempre lleva `maxLength`: tiene que ser el MISMO tope que aplica el reductor (datos/constantes.ts), o el borrador recortaría
 * en silencio lo que la persona escribió.
 */
export function AreaDeTexto({ etiqueta, ayuda, rows = 3, ...resto }: PropsAreaDeTexto) {
  const id = useId();
  const idAyuda = ayuda ? `${id}-ayuda` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium [overflow-wrap:anywhere]">
        {etiqueta}
      </label>
      <CuadroDeTexto id={id} rows={rows} className="resize-y" {...(idAyuda ? { 'aria-describedby': idAyuda } : {})} {...resto} />
      {ayuda && (
        <p id={idAyuda} className="m-0 text-xs text-secundario">
          {ayuda}
        </p>
      )}
    </div>
  );
}

// ================================================================ selector nativo

export interface OpcionDeSelector<T extends string> {
  id: T;
  texto: string;
}

export interface PropsSelector<T extends string> {
  etiqueta: string;
  valor: T;
  opciones: readonly OpcionDeSelector<T>[];
  alCambiar: (valor: T) => void;
  ayuda?: string;
}

/**
 * Un `<select>` nativo con etiqueta (decisión D13: no hay un Select propio ni dependencia nueva). Solo deja salir valores que están
 * en `opciones`. Su lista abierta se cierra con Esc sin que eso «regrese al cuadro» (lo cuida PanelAjustes).
 */
export function Selector<T extends string>({ etiqueta, valor, opciones, alCambiar, ayuda }: PropsSelector<T>) {
  const id = useId();
  const idAyuda = ayuda ? `${id}-ayuda` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium [overflow-wrap:anywhere]">
        {etiqueta}
      </label>
      <select
        id={id}
        value={valor}
        {...(idAyuda ? { 'aria-describedby': idAyuda } : {})}
        onChange={e => {
          const elegida = opciones.find(o => o.id === e.target.value);
          if (elegida) alCambiar(elegida.id);
        }}
        className="min-h-11 w-full rounded-medio border border-campo bg-elevada px-3 text-sm text-texto"
      >
        {opciones.map(o => (
          <option key={o.id} value={o.id}>
            {o.texto}
          </option>
        ))}
      </select>
      {ayuda && (
        <p id={idAyuda} className="m-0 text-xs text-secundario">
          {ayuda}
        </p>
      )}
    </div>
  );
}

// ================================================================ títulos de panel

/** El título de un panel (Ajustes, Conexión, menú, tarjeta del disparador): un `h3` con la letra de títulos. */
export function TituloDePanel({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={unir('m-0 font-titulo text-titulo-sm font-bold [overflow-wrap:anywhere]', className)}>{children}</h3>;
}
