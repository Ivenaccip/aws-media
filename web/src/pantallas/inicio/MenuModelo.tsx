// El selector de modelo de «¿Qué vamos a crear hoy?»: un chip «Modelo X ▾» y su
// menú. Los modelos van por nivel (económicos, equilibrados, máxima calidad) y
// de menor a mayor precio. Si el modelo tiene resolución (Nano Banana Pro), se
// elige en el pie; el pie lleva también el «Crear», a la mitad del ancho y
// centrado. En celular el menú sube desde abajo, con el «Crear» a todo lo ancho.
//
// El clip suma arriba la duración (4, 6 u 8 s): un grupo de radios que cambia
// los créditos de todas las filas. Un modelo que no la ofrece se atenúa, dice
// «Desde N s» en vez del precio y no se puede elegir; si era el elegido, la
// caja lo cambia por el predeterminado y el pie explica por qué.
//
// No sabe de precios ni de catálogo: recibe los grupos ya filtrados (solo lo
// que se ofrece de verdad) y una función que da los créditos. Así las pruebas
// le pasan su propio catálogo y la caja le pasa el de modelos.ts.
import { useEffect, useId, useRef, useState } from 'react';

import { ESTRELLA } from '../../nucleo/estrella';
import { Aviso } from '../../ui/Aviso';
import { Boton } from '../../ui/Boton';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import { PREDETERMINADO, sufijo, type Grupo, type Modelo, type Tarea } from './modelos';

export interface Eleccion {
  id: string;
  calidad?: string;
}

/** La duración del clip: solo la traen las tareas que cobran por segundos. */
export interface Duracion {
  /** La que rige ahora. */
  segundos: number;
  /** Las que se pueden elegir, de menor a mayor. */
  opciones: number[];
  /** Pide otra. Si por eso cambia el modelo, devuelve lo que se le dice a la persona. */
  alElegir: (segundos: number) => string | undefined;
  /** ¿El modelo tiene precio en la duración que rige? Si no, su fila se atenúa y no se elige. */
  admite: (m: Modelo) => boolean;
  /** Desde cuántos segundos tiene precio: lo que dice su fila atenuada. */
  desde: (m: Modelo) => number;
}

export interface PropsMenuModelo {
  tarea: Tarea;
  grupos: Grupo[];
  elegido: Eleccion;
  alElegir: (e: Eleccion) => void;
  /** Créditos del modelo (y calidad) en esta tarea y, en el clip, a la duración que rige. */
  precio: (id: string, calidad?: string) => number;
  /** true si el pedido salió: el menú se cierra. false o nada: se queda abierto. */
  alCrear: () => boolean | void;
  enviando: boolean;
  /** Una línea bajo el precio (p. ej. lo que suma juntar varias imágenes). */
  nota?: string;
  /** Solo el clip: el selector de duración arriba del menú. */
  duracion?: Duracion;
}

/** El «desde»: lo más barato del modelo (con resolución, la más baja). */
const desde = (m: Modelo, precio: PropsMenuModelo['precio']) =>
  Math.min(...(m.calidades ? m.calidades.map(c => precio(m.id, c.id)) : [precio(m.id)]));

/** La flecha de un grupo de radios: el índice del vecino sin salirse del grupo, o -1 si la tecla no es una flecha. */
function vecino(e: React.KeyboardEvent, i: number, largo: number): number {
  const paso = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (!paso) return -1;
  e.preventDefault();
  return Math.min(Math.max(i + paso, 0), largo - 1);
}

export function MenuModelo({ tarea, grupos, elegido, alElegir, precio, alCrear, enviando, nota, duracion }: PropsMenuModelo) {
  const [abierto, setAbierto] = useState(false);
  // por qué cambió el modelo al cambiar la duración; se va al elegir otra cosa y al reabrir
  const [aviso, setAviso] = useState('');
  const raiz = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const filas = useRef<Record<string, HTMLButtonElement | null>>({});
  const idPanel = useId();

  const todos = grupos.flatMap(g => g.modelos);
  // las flechas solo pasan por los que se pueden elegir con esta duración
  const libres = todos.filter(m => !duracion || duracion.admite(m));
  const actual = todos.find(m => m.id === elegido.id) ?? todos[0]!;
  const calidad = actual.calidades?.find(c => c.id === elegido.calidad) ?? actual.calidades?.[0];
  const creditos = precio(actual.id, calidad?.id);
  const nombre = calidad ? `${actual.nombre} · ${calidad.etiqueta}` : actual.nombre;
  // el chip dice también la duración del clip: «Veo 3.1 Lite · 8 s»
  const rotulo = duracion ? `${nombre} · ${duracion.segundos} s` : nombre;
  // con una sola duración no hay nada que elegir: el chip y el pie ya dicen los segundos
  const conSelector = !!duracion && duracion.opciones.length > 1;

  // clic fuera o Esc: se cierra (y con Esc el foco vuelve al chip)
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAbierto(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setAbierto(false);
      chip.current?.focus();
    };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', esc);
    };
  }, [abierto]);

  // al abrir, el foco va al modelo elegido
  useEffect(() => {
    if (abierto) filas.current[actual.id]?.focus();
    // solo al abrir: elegir otra fila no debe volver a mover el foco desde aquí
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  function cerrar() {
    setAbierto(false);
    chip.current?.focus();
  }

  function elegir(e: Eleccion) {
    setAviso('');
    alElegir(e);
  }

  function elegirDuracion(segundos: number) {
    if (!duracion || segundos === duracion.segundos) return;
    setAviso(duracion.alElegir(segundos) ?? '');
  }

  function teclaFila(e: React.KeyboardEvent) {
    const i = libres.findIndex(m => m.id === actual.id);
    const paso = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    let j = -1;
    if (paso) j = Math.min(Math.max(i + paso, 0), libres.length - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = libres.length - 1;
    const m = j < 0 ? undefined : libres[j];
    if (!m) return;
    e.preventDefault();
    elegir({ id: m.id });
    filas.current[m.id]?.focus();
  }

  function teclaCalidad(e: React.KeyboardEvent) {
    const lista = actual.calidades;
    if (!lista) return;
    const j = vecino(e, Math.max(0, lista.findIndex(c => c.id === calidad?.id)), lista.length);
    if (j < 0) return;
    const c = lista[j]!;
    elegir({ id: actual.id, calidad: c.id });
    (e.currentTarget.parentElement?.querySelector(`[data-calidad="${c.id}"]`) as HTMLElement | null)?.focus();
  }

  function teclaDuracion(e: React.KeyboardEvent) {
    if (!duracion) return;
    const j = vecino(e, duracion.opciones.indexOf(duracion.segundos), duracion.opciones.length);
    const s = j < 0 ? undefined : duracion.opciones[j];
    if (s === undefined) return;
    elegirDuracion(s);
    (e.currentTarget.parentElement?.querySelector(`[data-duracion="${s}"]`) as HTMLElement | null)?.focus();
  }

  return (
    <div ref={raiz} className="relative min-w-0">
      <button
        ref={chip}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-controls={abierto ? idPanel : undefined}
        onClick={() => {
          setAviso('');
          setAbierto(a => !a);
        }}
        className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-2 rounded-medio border border-linea bg-transparent px-3.5 text-sm whitespace-nowrap text-texto hover:border-campo min-[640px]:min-h-11 min-[640px]:w-auto min-[640px]:justify-start"
      >
        <span className="min-w-0 overflow-hidden text-ellipsis">
          <span className="text-secundario">Modelo</span> {rotulo}
        </span>
        <span aria-hidden="true" className="text-secundario">
          ▾
        </span>
      </button>

      {abierto && (
        <>
          {/* celular: lo de atrás se apaga y un toque fuera cierra */}
          <div aria-hidden="true" className="fixed inset-0 z-20 bg-hundido/80 min-[640px]:hidden" />
          <div
            id={idPanel}
            role="dialog"
            aria-label="Elegir modelo"
            className={unir(
              'absolute top-[calc(100%+6px)] right-0 z-30 w-[420px] max-w-[calc(100vw-24px)] overflow-hidden rounded-grande border border-linea bg-superficie',
              // celular: hoja que sube desde abajo
              'max-[639px]:fixed max-[639px]:inset-x-0 max-[639px]:top-auto max-[639px]:bottom-0 max-[639px]:w-auto max-[639px]:max-w-none max-[639px]:rounded-b-none',
            )}
          >
            <div className="flex min-h-12 items-center justify-between pr-2 pl-4 min-[640px]:hidden">
              <h3 className="m-0 text-md font-semibold">Modelo</h3>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={cerrar}
                className="grid size-11 cursor-pointer place-items-center rounded-medio border-0 bg-transparent text-secundario hover:bg-elevada"
              >
                <Icono nombre="cerrar" />
              </button>
            </div>

            {conSelector && (
              <div className="border-b border-linea px-3.5 py-3">
                <div className="mb-2 flex items-baseline justify-between gap-2 text-xs text-secundario">
                  <span id={idPanel + '-dur'}>Duración del clip</span>
                  <span id={idPanel + '-dur-pista'}>Más corto, más barato</span>
                </div>
                <div
                  role="radiogroup"
                  aria-labelledby={idPanel + '-dur'}
                  aria-describedby={idPanel + '-dur-pista'}
                  className="flex gap-2"
                >
                  {duracion.opciones.map(s => {
                    const sel = s === duracion.segundos;
                    return (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={sel}
                        data-duracion={s}
                        tabIndex={sel ? 0 : -1}
                        onClick={() => elegirDuracion(s)}
                        onKeyDown={teclaDuracion}
                        className={unir(
                          'inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-medio border text-sm font-semibold whitespace-nowrap tabular-nums hover:border-secundario',
                          sel ? 'border-texto bg-elevada text-texto' : 'border-campo bg-transparent text-secundario',
                        )}
                      >
                        {s} s
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div
              role="radiogroup"
              aria-label="Modelos"
              className={unir(
                'overflow-y-auto px-1.5 pb-1.5',
                // con el selector de duración arriba, la lista cede su alto
                conSelector ? 'max-h-[330px] max-[639px]:max-h-[min(250px,40vh)]' : 'max-h-[400px] max-[639px]:max-h-[min(430px,50vh)]',
              )}
            >
              {grupos.map(g => (
                <div key={g.nivel}>
                  <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-superficie px-2.5 pt-3 pb-1 text-xs text-secundario">
                    <span className="font-semibold text-texto">{g.titulo}</span>
                    {g.rango && (
                      <span className="tabular-nums">
                        {ESTRELLA} {g.rango} {sufijo(tarea, duracion?.segundos)}
                      </span>
                    )}
                  </div>
                  {g.modelos.map(m => {
                    const sel = m.id === actual.id;
                    // sin precio en esta duración: atenuado, sin elegir y con su «Desde N s»
                    const desdeS = duracion && !duracion.admite(m) ? duracion.desde(m) : null;
                    const libre = desdeS === null;
                    return (
                      <button
                        key={m.id}
                        ref={el => {
                          filas.current[m.id] = el;
                        }}
                        type="button"
                        role="radio"
                        aria-checked={sel}
                        aria-disabled={libre ? undefined : true}
                        tabIndex={sel ? 0 : -1}
                        onClick={() => {
                          if (libre) elegir({ id: m.id });
                        }}
                        onKeyDown={teclaFila}
                        className={unir(
                          'flex min-h-14 w-full items-center gap-3 rounded-medio border-0 px-2.5 py-2 text-left text-texto',
                          libre ? 'cursor-pointer hover:bg-elevada' : 'cursor-not-allowed',
                          sel ? 'bg-elevada' : 'bg-transparent',
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={unir(
                            'grid size-5 flex-none place-items-center rounded-pildora border-[1.5px]',
                            sel ? 'border-texto' : 'border-campo',
                            !libre && 'opacity-45',
                          )}
                        >
                          {sel && <span className="size-2.5 rounded-pildora bg-texto" />}
                        </span>
                        <span className={unir('min-w-0 flex-1', !libre && 'opacity-45')}>
                          <span className="block text-sm font-semibold">
                            {m.nombre}
                            {m.id === PREDETERMINADO[tarea] && (
                              <span className="ml-2 rounded-pildora border border-campo px-2 py-px text-xs font-medium whitespace-nowrap text-secundario">
                                Predeterminado
                              </span>
                            )}
                          </span>
                          <small className="block text-xs text-secundario">{m.detalle}</small>
                        </span>
                        <span className={unir('text-sm whitespace-nowrap tabular-nums', !libre && 'text-secundario')}>
                          {libre ? (
                            <>
                              {m.calidades ? 'desde ' : ''}
                              {ESTRELLA} {desde(m, precio)}
                            </>
                          ) : (
                            <>Desde {desdeS} s</>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3 border-t border-linea px-3.5 pt-3 pb-3.5">
              {actual.calidades && (
                <div className="flex flex-col gap-1.5">
                  <span id={idPanel + '-res'} className="text-xs text-secundario">
                    Resolución
                  </span>
                  <div role="radiogroup" aria-labelledby={idPanel + '-res'} className="flex gap-2">
                    {actual.calidades.map(c => {
                      const sel = c.id === calidad?.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          role="radio"
                          aria-checked={sel}
                          data-calidad={c.id}
                          tabIndex={sel ? 0 : -1}
                          onClick={() => elegir({ id: actual.id, calidad: c.id })}
                          onKeyDown={teclaCalidad}
                          className={unir(
                            'inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-medio border text-sm whitespace-nowrap hover:border-secundario',
                            sel ? 'border-texto bg-elevada text-texto' : 'border-campo bg-transparent text-secundario',
                          )}
                        >
                          {c.etiqueta}
                          <span className="text-xs text-secundario tabular-nums">
                            {ESTRELLA} {precio(actual.id, c.id)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold">{nombre}</span>
                <span className="text-xs whitespace-nowrap text-secundario tabular-nums">
                  {ESTRELLA} {creditos} {sufijo(tarea, duracion?.segundos)}
                </span>
              </div>
              {nota && <span className="-mt-1.5 text-xs text-secundario">{nota}</span>}
              {aviso && (
                <Aviso>
                  <span className="text-xs">{aviso}</span>
                </Aviso>
              )}
              <Boton
                nivel="principal"
                trabajando={enviando && 'Generando…'}
                onClick={() => {
                  if (alCrear() === true) setAbierto(false);
                }}
                className="mx-auto w-full min-[640px]:w-1/2"
              >
                Crear <Icono nombre="enviar" />
              </Boton>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
