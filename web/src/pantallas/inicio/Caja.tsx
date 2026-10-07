// «¿Qué vamos a crear hoy?» (M25 · B, R4 + R4b): el riel de la izquierda dice QUÉ
// te llevas (Imagen o Video), el chip de tarea CUÁL de esas cosas, y el chip de
// modelo CON QUÉ IA. No cobra: lleva a la pantalla que cobra con el texto ya
// puesto. El precio se ve dentro del menú de modelo, junto al «Crear».
import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { ESTRELLA } from '../../nucleo/estrella';
import { Boton } from '../../ui/Boton';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import { destinoDe, OPCIONES, type Familia, type Opcion } from './logica';
import { MenuModelo, type Eleccion } from './MenuModelo';
import { grupos as gruposDe, llavePrecio, PREDETERMINADO, precioDe, type Tarea } from './modelos';

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

// el riel: dos botones con icono. En celular es una fila sobre el texto.
const RIEL = [
  { familia: 'imagenes', rotulo: 'Imagen', icono: 'imagen' },
  { familia: 'videos', rotulo: 'Video', icono: 'video' },
] as const;

export const Caja = forwardRef<MandoCaja, PropsCaja>(function Caja({ ir }, ref) {
  // Arranca en el clip a propósito: es lo que ya se usaba, así que es lo que
  // menos sorprende a quien no abra el menú de modelo (M25 · B).
  const [familia, setFamilia] = useState<Familia>('videos');
  const [opcion, setOpcion] = useState<Opcion>(OPCIONES.videos[0]!);
  // cada tarea recuerda su propio modelo
  const [elegidos, setElegidos] = useState<Partial<Record<Tarea, Eleccion>>>({});
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
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

  // «Generando…» dura hasta que la página navega. Si la persona regresa con «atrás»,
  // el navegador restaura ESTA página desde su caché con el estado que tenía:
  // sin esto, el botón se quedaría trabajando para siempre.
  useEffect(() => {
    const volvio = (e: Event) => {
      if ((e as PageTransitionEvent).persisted) setEnviando(false);
    };
    window.addEventListener('pageshow', volvio);
    return () => window.removeEventListener('pageshow', volvio);
  }, []);

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

  // el modelo de la tarea: el que eligió, o el predeterminado, o el primero que
  // se ofrezca. Si no se ofrece ninguno, la tarea no muestra chip de modelo.
  const tarea = opcion.modelos;
  const grupos = useMemo(() => (tarea ? gruposDe(tarea) : []), [tarea]);
  const ofrecidos = grupos.flatMap(g => g.modelos);
  const guardado = tarea ? elegidos[tarea] : undefined;
  const modelo = tarea ? (ofrecidos.find(m => m.id === (guardado?.id ?? PREDETERMINADO[tarea])) ?? ofrecidos[0]) : undefined;
  const calidad = modelo?.calidades ? (modelo.calidades.find(c => c.id === guardado?.calidad) ?? modelo.calidades[0]) : undefined;
  const modeloId = modelo ? llavePrecio(modelo.id, calidad?.id) : undefined;

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
    setEnviando(true); // hasta que la página navegue
    ir(destinoDe(opcion, limpio, modeloId));
  }

  const crear = (
    <Boton
      nivel="principal"
      trabajando={enviando && 'Generando…'}
      onClick={enviar}
      className={unir('w-full min-[640px]:w-auto', modelo && 'min-[640px]:hidden')}
    >
      Crear <Icono nombre="enviar" />
    </Boton>
  );

  return (
    <section className="mb-8 flex flex-col gap-4 rounded-grande border border-linea bg-superficie p-4 min-[640px]:flex-row min-[640px]:p-5 min-[861px]:mt-[82px]">
      <div
        role="group"
        aria-label="Qué quieres crear"
        className="flex flex-none gap-1 rounded-boton border border-linea p-1 min-[640px]:w-[81px] min-[640px]:flex-col min-[640px]:gap-1.5 min-[640px]:rounded-none min-[640px]:border-0 min-[640px]:border-r min-[640px]:p-0 min-[640px]:pr-4"
      >
        {RIEL.map(r => (
          <button
            key={r.familia}
            type="button"
            aria-pressed={familia === r.familia}
            onClick={() => {
              setFamilia(r.familia);
              setOpcion(OPCIONES[r.familia][0]!);
              setAbierto(false);
            }}
            className={unir(
              'flex min-h-12 flex-1 cursor-pointer flex-row items-center justify-center gap-2 rounded-medio border-0 text-sm',
              'min-[640px]:min-h-16 min-[640px]:w-16 min-[640px]:flex-none min-[640px]:flex-col min-[640px]:gap-1 min-[640px]:text-xs',
              familia === r.familia ? 'bg-elevada text-texto' : 'bg-transparent text-secundario hover:bg-elevada',
            )}
          >
            <Icono nombre={r.icono} />
            {r.rotulo}
          </button>
        ))}
      </div>

      <div className="min-w-0 flex-1">
        <h2 id={idTitulo} className="m-0 mb-2 font-titulo text-titulo-md font-bold">
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
        <div className="mt-2 flex flex-col gap-2.5 min-[640px]:flex-row min-[640px]:flex-wrap min-[640px]:items-center">
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
                'flex min-h-12 w-full cursor-pointer items-center justify-between gap-2 overflow-hidden rounded-medio border border-linea bg-transparent px-3.5 text-sm text-ellipsis whitespace-nowrap text-texto hover:border-campo',
                'min-[640px]:min-h-11 min-[640px]:max-w-full min-[640px]:w-auto min-[640px]:justify-start',
              )}
            >
              {opcion.rotulo}{' '}
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
                className="absolute top-[calc(100%+6px)] left-0 z-20 w-max max-w-[min(400px,calc(100vw-48px))] min-w-[min(290px,calc(100vw-48px))] rounded-grande border border-linea bg-superficie p-1.5"
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
                      <span className="text-xs whitespace-nowrap text-secundario">
                        {o.modelos ? 'según el modelo' : `${ESTRELLA} ${o.precio}`}
                      </span>
                    </span>
                    <small className="block text-xs text-secundario">{o.nota}</small>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2.5 min-[640px]:ml-auto min-[640px]:flex-row min-[640px]:items-center">
            {tarea && modelo && (
              <MenuModelo
                tarea={tarea}
                grupos={grupos}
                elegido={calidad ? { id: modelo.id, calidad: calidad.id } : { id: modelo.id }}
                alElegir={e => setElegidos(s => ({ ...s, [tarea]: e }))}
                precio={(id, cal) => precioDe(tarea, id, cal)!}
                alCrear={enviar}
                enviando={enviando}
              />
            )}
            {crear}
          </div>
        </div>
        {error && (
          <p role="alert" className="mt-2.5 mb-0 text-xs text-error">
            {error}
          </p>
        )}
      </div>
    </section>
  );
});
