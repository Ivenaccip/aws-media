// El chip de «qué hago» de la caja del inicio, con su lista: «Un video corto ▾», «Crear una imagen ▾», «Editar ▾».
// Estaba escrito en línea en Caja.tsx; se extrae para que Edición use EXACTAMENTE la misma pieza (el mismo teclado, el
// mismo foco, la misma posición) y no una copia que se vaya desfasando. Al extraerla se corrigieron, para las tres familias
// a la vez, dos defectos que traía desde antes (revisión del 14-oct-2026): la pista no se pintaba nunca (el botón recortaba
// con `overflow-hidden` su propio globo, que cuelga fuera de él; el recorte con «…» pasó a un <span> de adentro) y Tab con la
// lista abierta tiraba el foco a <body> (ahora vuelve al chip y el navegador sigue desde ahí).
//
// Lo que hace, y lo que prueban Inicio.test.tsx (inicio.caja.desplegable_con_teclado…) y Edicion.test.tsx:
//   · el chip es un `aria-haspopup="listbox"` con `aria-expanded` y, mientras la lista está abierta, `aria-controls` (la lista
//     solo existe montada: apuntarle cerrada sería un id sin destino); al pasar el ratón o enfocarlo dice la nota de la
//     opción de ahora (`data-pista`);
//   · la lista abre con clic o con ↓; recorre con ↑ ↓ Inicio Fin; Enter o Espacio eligen; Esc cierra y devuelve el foco al
//     chip; Tab o Shift+Tab cierran, ponen el foco en el chip y siguen desde ahí (nunca a <body>); un clic fuera cierra;
//   · elegir cierra la lista y devuelve el foco al chip (elegir la que ya estaba es solo eso: cerrar y volver);
//   · la lista es más ancha que el chip y el chip está a media fila: se mide y se sujeta dentro de la ventana.
// Cerrar desde fuera (cambiar de familia, `elegir()` del mando de la caja) es `ref.current.cerrar()`.
import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react';

import { unir } from '../../ui/unir';

// una pista al pasar el ratón o al enfocar: qué hace cada cosa (mock 2026-09-07). Su ancho máximo se descuenta de la ventana
// desde el chip, no desde el borde: por debajo de 640 px el chip empieza en x = 95 (20 de margen, 1 de borde, 16 de relleno,
// 48 del «+» y 10 de separación), y 132 = 95 + 37 deja el borde derecho de la pista dentro de la pantalla. Con `-72px` la
// pista (aun invisible, con `invisible` sigue ocupando lugar) desbordaba la página hasta 24 px a 320 px: se podía arrastrar de lado
const PISTA =
  'relative after:pointer-events-none after:absolute after:bottom-[calc(100%+10px)] after:left-0 after:z-10 ' +
  'after:w-max after:max-w-[min(250px,calc(100vw-132px))] after:rounded-medio after:border after:border-linea ' +
  'after:bg-elevada after:px-3 after:py-2 after:text-left after:text-xs after:whitespace-normal after:text-texto ' +
  'after:opacity-0 after:invisible after:transition-opacity after:content-[attr(data-pista)] ' +
  'hover:after:visible hover:after:opacity-100 focus-visible:after:visible focus-visible:after:opacity-100 ' +
  // con la lista abierta la pista sobra: la misma nota ya sale en la fila, y el globo taparía las ideas de arriba
  'aria-expanded:after:hidden';

/** Lo mínimo que una opción tiene que decir para salir en la lista. */
export interface OpcionDeSelector {
  id: string;
  rotulo: string;
  /** La pista del chip y la línea chica de su fila. */
  nota: string;
}

export interface MandoSelector {
  /** Cierra la lista (si estaba abierta) sin tocar el foco. */
  cerrar(): void;
}

export interface PropsSelectorOpcion<T extends OpcionDeSelector> {
  opciones: readonly T[];
  /** La opción de ahora: la que dice el chip y la que la lista marca. */
  elegida: T;
  /** Lo que va a la derecha del nombre en cada fila: «según el modelo», «✦ 30», «según el video»… */
  detalle: (opcion: T) => string;
  alElegir: (opcion: T) => void;
  /** React 19: la ref es una prop más. */
  ref?: Ref<MandoSelector>;
}

export function SelectorOpcion<T extends OpcionDeSelector>({ opciones, elegida, detalle, alElegir, ref }: PropsSelectorOpcion<T>) {
  const [abierto, setAbierto] = useState(false);
  const [marcada, setMarcada] = useState(0);
  const boton = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const idLista = useId();

  useImperativeHandle(ref, () => ({ cerrar: () => setAbierto(false) }));

  // fuera del menú o Esc: se cierra
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);

  useEffect(() => {
    if (abierto) (lista.current?.children[marcada] as HTMLElement | undefined)?.focus();
  }, [abierto, marcada]);

  // El menú es más ancho que su botón, y el botón está a media fila: anclado a
  // un lado se salía por el otro. Se mide y se sujeta dentro de la ventana.
  useLayoutEffect(() => {
    if (!abierto) return;
    const ubicar = () => {
      const l = lista.current;
      const b = boton.current;
      if (!l || !b) return;
      l.style.left = '0px';
      const margen = 12;
      const izq = b.getBoundingClientRect().left;
      const tope = document.documentElement.clientWidth - margen - l.getBoundingClientRect().width;
      l.style.left = Math.max(margen, Math.min(izq, tope)) - izq + 'px';
    };
    ubicar();
    window.addEventListener('resize', ubicar);
    return () => window.removeEventListener('resize', ubicar);
  }, [abierto]);

  function abrir() {
    setMarcada(Math.max(0, opciones.findIndex(o => o.id === elegida.id)));
    setAbierto(true);
  }

  function elegir(o: T) {
    alElegir(o);
    setAbierto(false);
    boton.current?.focus();
  }

  function teclaLista(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') setMarcada(i => Math.min(i + 1, opciones.length - 1));
    else if (e.key === 'ArrowUp') setMarcada(i => Math.max(i - 1, 0));
    else if (e.key === 'Home') setMarcada(0);
    else if (e.key === 'End') setMarcada(opciones.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') elegir(opciones[marcada]!);
    else if (e.key === 'Escape') {
      setAbierto(false);
      boton.current?.focus();
    } else if (e.key === 'Tab') {
      // Tab no se traga: al cerrar se desmonta la opción que tiene el foco y, si el Tab se cancelara, el foco caería en
      // <body> (y la siguiente pulsación empezaría desde el principio de la página). Se pasa el foco al chip y el
      // navegador sigue desde ahí: Tab va a lo que viene después del chip, Shift+Tab a lo que viene antes.
      boton.current?.focus();
      setAbierto(false);
      return;
    } else return;
    e.preventDefault();
  }

  return (
    <div ref={menu} className="relative min-w-0 flex-1 min-[640px]:flex-none">
      <button
        ref={boton}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-controls={abierto ? idLista : undefined}
        data-pista={elegida.nota}
        onClick={() => (abierto ? setAbierto(false) : abrir())}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' && !abierto) {
            e.preventDefault();
            abrir();
          }
        }}
        className={unir(
          PISTA,
          // sin `overflow-hidden`: recortaría la pista (su ::after cuelga fuera del botón). El recorte con «…» va en el <span> del rótulo
          'flex min-h-12 w-full cursor-pointer items-center justify-between gap-2 rounded-medio border border-linea bg-transparent px-3.5 text-sm whitespace-nowrap text-texto hover:border-campo',
          'min-[640px]:min-h-11 min-[640px]:max-w-full min-[640px]:w-auto min-[640px]:justify-start',
        )}
      >
        <span className="min-w-0 truncate">{elegida.rotulo}</span>{' '}
        <span aria-hidden="true" className="shrink-0 text-secundario">
          ▾
        </span>
      </button>
      {abierto && (
        <div
          ref={lista}
          id={idLista}
          role="listbox"
          aria-label="Opciones"
          className="absolute top-[calc(100%+6px)] left-0 z-20 w-max max-w-[min(400px,calc(100vw-48px))] min-w-[min(290px,calc(100vw-48px))] rounded-grande border border-linea bg-superficie p-1.5"
        >
          {opciones.map((o, i) => (
            <div
              key={o.id}
              role="option"
              aria-selected={o.id === elegida.id}
              tabIndex={i === marcada ? 0 : -1}
              onClick={() => elegir(o)}
              onKeyDown={teclaLista}
              onMouseEnter={() => setMarcada(i)}
              className={unir(
                'cursor-pointer rounded-medio px-2.5 py-2 outline-offset-0',
                (i === marcada || o.id === elegida.id) && 'bg-elevada',
              )}
            >
              <span className="flex items-baseline justify-between gap-3">
                <b className="text-sm font-semibold">{o.rotulo}</b>
                <span className="text-xs whitespace-nowrap text-secundario">{detalle(o)}</span>
              </span>
              <small className="block text-xs text-secundario">{o.nota}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
