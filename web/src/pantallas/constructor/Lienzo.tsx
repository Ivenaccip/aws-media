// La zona del lienzo del Constructor: el marco con scroll propio, la rejilla de puntos, los cuadros, las flechas y
// el espacio donde quien ensambla pone el menú flotante del «+» y la tarjeta de elegir el disparador (`children`).
//
// NO conoce el reductor ni las reglas del flujo: recibe lo que calculan los selectores (`vistaNodos`, `vistaFlechas`,
// `vistaLienzo`) y devuelve eventos. Constructor.tsx los traduce en acciones y cumple el foco con el contrato de
// atributos `data-*` (cuadro `data-nodo`, × `data-quitar`, «+» `data-mas`, círculo de la flecha `data-insignia`).
//
// El DOM, de abajo hacia arriba (también el orden de Tab y de lectura):
//
//   <div role="group" aria-label="Lienzo del flujo">     el marco: `overflow-auto`, `max-w-full`; la página nunca se
//     │                                                  ensancha, el lienzo se desplaza ADENTRO. Con cuadros, «+»
//     │                                                  y tarjetas enfocables adentro no necesita tabIndex propio
//     │                                                  (axe: scrollable-region-focusable); SOLO si no hay nada
//     │                                                  adentro (ni cuadros ni `children`) se vuelve enfocable,
//     │                                                  para que un lienzo que se desplaza sin nada que tocar
//     │                                                  se pueda desplazar con el teclado
//     └ <div role="presentation">                        el lienzo (ancho × alto): aquí viven el clic de fondo y Esc
//         <svg> por flecha                               debajo de todo, sin eventos
//         cuadros (cada uno con su ×, «+» y patita)      en el orden que llegan, nunca el del arrastre
//         círculos de las flechas                        botones de 44 × 44, encima de los cuadros
//         children                                       el menú y la tarjeta, en su sitio absoluto
//
// Props (el contrato con Constructor.tsx, afinado del encargo):
//   nodos, flechas, ancho, alto, modoConexion   lo que se pinta (el modo solo pone `data-conectando`: cada cuadro ya
//                                               sabe su papel en `VistaNodo.modoConexion`)
//   alMoverNodo(id, x, y)                       arrastre con el puntero; px de lienzo SIN ajustar (el reductor ajusta)
//   alMoverConTeclado(id, direccion, grande)    flechas (Mayús = grande)
//   alAbrirNodo(id, conTeclado)                 clic o Enter/Espacio; `conTeclado` manda el foco a Ajustes
//   alQuitarNodo(id)                            la × o Supr/Retroceso
//   alAbrirMas(ancla, tipo, insertarEn?)        el «+» de la derecha (`seq`) o el de la patita (`tool`). `insertarEn`
//                                               está en la firma por el contrato del encargo; el lienzo nunca lo pasa
//                                               (poner un cuadro en medio sale del panel de la flecha)
//   alAbrirFlecha(id)                           el círculo de una flecha
//   alEscape(id | null)                         Esc sobre un cuadro (su id) o sobre su ×, un «+» o un círculo (null).
//                                               Esc dentro de `children` NO llega aquí: es del menú
//   alClicFondo()                               clic en el fondo vacío del lienzo
//   marcoRef                                    el marco, para `scrollParaVer` (opcional)
//   ayudaId                                     id del texto de ayuda de teclado que describe el lienzo (opcional)
//
// Dos cosas que debe saber quien lo ensambla:
//   · El marco tiene margen interno (8 px, y 20 arriba) para que el aro de foco de lo que quede pegado al borde y la ×
//     de un cuadro en y = 0 no se recorten. El origen del lienzo queda, pues, a 9 px del borde izquierdo y a 21 del
//     superior del marco (con el borde de 1 px): `scrollParaVer` sigue sirviendo, sus holguras lo absorben.
//   · El marco es `max-w-full min-w-0 overflow-auto`, pero eso solo evita que la PÁGINA se ensanche si su padre también
//     deja encogerse: dentro de una columna flex, esa columna necesita `min-w-0`.

import { Children, useRef, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';

import './constructor.css';
import { InsigniasFlechas, LineasFlechas } from './Flechas';
import type { VistaFlecha, VistaNodo } from './modelo/selectores';
import type { DireccionTecla, TipoArista } from './modelo/tipos';
import { Nodo } from './Nodo';
import { esComposicion } from './PiezasPanel';
import { useArrastre } from './useArrastre';

export interface PropsLienzo {
  nodos: readonly VistaNodo[];
  flechas: readonly VistaFlecha[];
  /** El ancho del lienzo en px (`vistaLienzo`): lo que piden los cuadros. */
  ancho: number;
  /** El alto del lienzo en px (`vistaLienzo`): lo que piden los cuadros y el menú abierto. */
  alto: number;
  /** ¿Está el modo «toca el cuadro destino»? */
  modoConexion: boolean;
  alMoverNodo: (id: string, x: number, y: number) => void;
  alMoverConTeclado: (id: string, direccion: DireccionTecla, grande: boolean) => void;
  alAbrirNodo: (id: string, conTeclado: boolean) => void;
  alQuitarNodo: (id: string) => void;
  alAbrirMas: (ancla: string, tipo: TipoArista, insertarEn?: string | null) => void;
  alAbrirFlecha: (id: string) => void;
  alEscape: (id: string | null) => void;
  alClicFondo: () => void;
  marcoRef?: RefObject<HTMLDivElement | null>;
  ayudaId?: string;
  /** El menú flotante y la tarjeta de elegir disparador: se pintan DENTRO del lienzo, en su sitio absoluto. */
  children?: ReactNode;
}

/** Lo que cuenta como un control propio del lienzo (el contrato de foco): sobre esos, Esc llega a `alEscape`. */
const CONTROLES = '[data-nodo],[data-quitar],[data-mas],[data-insignia]';

export function Lienzo({
  nodos,
  flechas,
  ancho,
  alto,
  modoConexion,
  alMoverNodo,
  alMoverConTeclado,
  alAbrirNodo,
  alQuitarNodo,
  alAbrirMas,
  alAbrirFlecha,
  alEscape,
  alClicFondo,
  marcoRef,
  ayudaId,
  children,
}: PropsLienzo) {
  const propio = useRef<HTMLDivElement>(null);
  const marco = marcoRef ?? propio;
  // Sin cuadros y sin nada adentro no hay un solo control enfocable: el marco, que se desplaza, tiene que serlo él.
  // `toArray` descarta los null y los false: `{tarjeta}{menu}` con los dos apagados llega aquí como un arreglo de dos huecos
  const vacio = nodos.length === 0 && Children.toArray(children).length === 0;

  const arrastre = useArrastre({
    alMover: alMoverNodo,
    // el marco puede desplazarse mientras se arrastra (la rueda): el cuadro tiene que seguir al puntero
    leerScroll: () => ({ x: marco.current?.scrollLeft ?? 0, y: marco.current?.scrollTop ?? 0 }),
  });

  // clic en el fondo VACÍO: el que cae sobre un cuadro, un botón o el menú no cuenta (el `target` no es el lienzo)
  const alClicEnElFondo = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (arrastre.clicSuprimido()) return;
    alClicFondo();
  };

  // Esc sobre un control del lienzo. Los `children` (el menú) atienden su propio Esc: si el evento ya se atendió, o no
  // viene de un control nuestro, no se toca.
  const alTeclear = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented || esComposicion(e) || !(e.target instanceof Element)) return;
    const control = e.target.closest(CONTROLES);
    if (!control || !e.currentTarget.contains(control)) return;
    alEscape(control.getAttribute('data-nodo'));
  };

  return (
    <div
      ref={marco}
      role="group"
      aria-label="Lienzo del flujo"
      {...(ayudaId ? { 'aria-describedby': ayudaId } : {})}
      // un marco que se desplaza y no tiene ningún control adentro solo se puede mover con el teclado si él mismo recibe el foco
      // (axe: scrollable-region-focusable); con cuadros o tarjetas adentro NO hace falta y no se pone
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={vacio ? 0 : undefined}
      data-conectando={modoConexion ? 'true' : undefined}
      className="cn-marco isolate max-w-full min-w-0 overflow-auto rounded-grande border border-linea bg-hundido px-2 pt-5 pb-2"
    >
      <div
        role="presentation"
        className="cn-lienzo"
        style={{ width: ancho, height: alto }}
        onClick={alClicEnElFondo}
        onKeyDown={alTeclear}
      >
        <LineasFlechas flechas={flechas} />
        {nodos.map(v => (
          <Nodo
            key={v.id}
            vista={v}
            arrastre={arrastre}
            alAbrir={alAbrirNodo}
            alQuitar={alQuitarNodo}
            alAbrirMas={(ancla, tipo) => alAbrirMas(ancla, tipo)}
            alMoverConTeclado={alMoverConTeclado}
          />
        ))}
        <InsigniasFlechas flechas={flechas} alAbrir={alAbrirFlecha} />
        {children}
      </div>
    </div>
  );
}
