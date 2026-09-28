// «¿Qué vamos a crear hoy?» (M25 · B): el segmentado dice QUÉ te llevas y el
// desplegable CUÁL de esas cosas. No cobra: lleva a la pantalla que cobra con
// el texto ya puesto, y el precio se ve en el desplegable antes de enviar.
import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';

import { ESTRELLA } from '../../nucleo/estrella';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import { destinoDe, OPCIONES, type Familia, type Opcion } from './logica';

export interface MandoCaja {
  /** Pone la familia y la opción, enfoca el texto y sube la página. */
  elegir(familia: Familia, id?: string): void;
}

export interface PropsCaja {
  /** A dónde ir. En la página es location.assign; en los tests, un espía. */
  ir: (url: string) => void;
}

// una pista al pasar el ratón o al enfocar: qué hace cada cosa (mock 2026-09-07)
const PISTA =
  'relative after:pointer-events-none after:absolute after:bottom-[calc(100%+10px)] after:left-0 after:z-10 ' +
  'after:w-max after:max-w-[min(250px,calc(100vw-72px))] after:rounded-medio after:border after:border-linea ' +
  'after:bg-elevada after:px-3 after:py-2 after:text-left after:text-xs after:whitespace-normal after:text-texto ' +
  'after:opacity-0 after:invisible after:transition-opacity after:content-[attr(data-pista)] ' +
  'hover:after:visible hover:after:opacity-100 focus-visible:after:visible focus-visible:after:opacity-100';

export const Caja = forwardRef<MandoCaja, PropsCaja>(function Caja({ ir }, ref) {
  // Arranca en el clip a propósito: es lo más barato, así que es lo que menos
  // daño hace a quien no abra el desplegable (M25 · B).
  const [familia, setFamilia] = useState<Familia>('videos');
  const [opcion, setOpcion] = useState<Opcion>(OPCIONES.videos[0]!);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [marcada, setMarcada] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const idLista = useId();
  const idTitulo = useId();

  useImperativeHandle(ref, () => ({
    elegir(f, id) {
      setFamilia(f);
      setOpcion(OPCIONES[f].find(o => o.id === id) ?? OPCIONES[f][0]!);
      setAbierto(false);
      area.current?.focus();
      window.scrollTo?.({ top: 0, behavior: 'smooth' });
    },
  }));

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

  const opciones = OPCIONES[familia];

  function abrir() {
    setMarcada(Math.max(0, opciones.findIndex(o => o.id === opcion.id)));
    setAbierto(true);
  }

  function elegir(o: Opcion) {
    setOpcion(o);
    setAbierto(false);
    boton.current?.focus();
  }

  function teclaLista(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') setMarcada(i => Math.min(i + 1, opciones.length - 1));
    else if (e.key === 'ArrowUp') setMarcada(i => Math.max(i - 1, 0));
    else if (e.key === 'Home') setMarcada(0);
    else if (e.key === 'End') setMarcada(opciones.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') elegir(opciones[marcada]!);
    else if (e.key === 'Escape') {
      setAbierto(false);
      boton.current?.focus();
    } else if (e.key === 'Tab') setAbierto(false);
    else return;
    e.preventDefault();
  }

  function enviar() {
    const limpio = texto.trim();
    if (!limpio) {
      setError('Cuéntanos qué quieres primero — o entra por el menú de la izquierda para ver el formulario completo.');
      area.current?.focus();
      return;
    }
    setError('');
    ir(destinoDe(opcion, limpio));
  }

  return (
    <section className="mb-8 rounded-grande border border-linea bg-superficie p-5 min-[861px]:mt-[82px]">
      <h2 id={idTitulo} className="m-0 mb-2 text-titulo-md font-bold">
        ¿Qué vamos a crear hoy?
      </h2>
      <textarea
        ref={area}
        aria-labelledby={idTitulo}
        maxLength={5000}
        value={texto}
        onChange={e => setTexto(e.target.value)}
        placeholder={opcion.hueco}
        className="min-h-22 w-full resize-y border-0 bg-transparent p-0 text-sm text-texto outline-none"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2.5">
        <div role="group" aria-label="Qué quieres crear" className="inline-flex overflow-hidden rounded-medio border border-linea">
          {(['imagenes', 'videos'] as const).map(f => (
            <button
              key={f}
              type="button"
              aria-pressed={familia === f}
              onClick={() => {
                setFamilia(f);
                setOpcion(OPCIONES[f][0]!);
                setAbierto(false);
              }}
              className={unir(
                'min-h-11 cursor-pointer border-0 px-3.5 text-sm whitespace-nowrap',
                familia === f ? 'bg-elevada text-texto' : 'bg-transparent text-secundario hover:text-texto',
              )}
            >
              {f === 'imagenes' ? 'Imágenes' : 'Videos'}
            </button>
          ))}
        </div>

        <div ref={menu} className="relative min-w-0">
          <button
            ref={boton}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={abierto}
            aria-controls={idLista}
            data-pista={opcion.nota}
            onClick={() => (abierto ? setAbierto(false) : abrir())}
            onKeyDown={e => {
              if (e.key === 'ArrowDown' && !abierto) {
                e.preventDefault();
                abrir();
              }
            }}
            className={unir(
              PISTA,
              'min-h-11 max-w-full cursor-pointer overflow-hidden rounded-medio border border-linea bg-transparent px-3.5 text-sm text-ellipsis whitespace-nowrap text-texto hover:border-campo',
            )}
          >
            {opcion.rotulo}{' '}
            <span className="text-secundario">
              {ESTRELLA} {opcion.precio}
            </span>{' '}
            <span aria-hidden="true" className="text-secundario">
              ▾
            </span>
          </button>
          {abierto && (
            <div
              ref={lista}
              id={idLista}
              role="listbox"
              aria-label="Opciones"
              className="absolute top-[calc(100%+6px)] left-0 z-20 w-max max-w-[min(340px,calc(100vw-48px))] min-w-[min(290px,calc(100vw-48px))] rounded-grande border border-linea bg-superficie p-1.5"
            >
              {opciones.map((o, i) => (
                <div
                  key={o.id}
                  role="option"
                  aria-selected={o.id === opcion.id}
                  tabIndex={i === marcada ? 0 : -1}
                  onClick={() => elegir(o)}
                  onKeyDown={teclaLista}
                  onMouseEnter={() => setMarcada(i)}
                  className={unir(
                    'cursor-pointer rounded-medio px-2.5 py-2 outline-offset-0',
                    (i === marcada || o.id === opcion.id) && 'bg-elevada',
                  )}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <b className="text-sm font-semibold">{o.rotulo}</b>
                    <span className="text-xs text-secundario">
                      {ESTRELLA} {o.precio}
                    </span>
                  </span>
                  <small className="block text-xs text-secundario">{o.nota}</small>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          aria-label="Crear"
          data-pista="Crear. Puedes cambiar de opción arriba antes de enviar."
          onClick={enviar}
          className={unir(
            PISTA,
            'ml-auto grid size-11 cursor-pointer place-items-center rounded-pildora border-0 bg-ambar text-tinta transition-[background-color,transform] hover:bg-ambar-claro active:scale-[0.96] after:right-0 after:left-auto',
          )}
        >
          <Icono nombre="enviar" />
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2.5 mb-0 text-xs text-error">
          {error}
        </p>
      )}
    </section>
  );
});
