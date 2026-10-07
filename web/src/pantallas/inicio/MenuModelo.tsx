// El selector de modelo de «¿Qué vamos a crear hoy?»: un chip «Modelo X ▾» y su
// menú. Los modelos van por nivel (económicos, equilibrados, máxima calidad) y
// de menor a mayor precio. Si el modelo tiene resolución (Nano Banana Pro), se
// elige en el pie; el pie lleva también el «Crear», a la mitad del ancho y
// centrado. En celular el menú sube desde abajo, con el «Crear» a todo lo ancho.
//
// No sabe de precios ni de catálogo: recibe los grupos ya filtrados (solo lo
// que se ofrece de verdad) y una función que da los créditos. Así las pruebas
// le pasan su propio catálogo y la caja le pasa el de modelos.ts.
import { useEffect, useId, useRef, useState } from 'react';

import { ESTRELLA } from '../../nucleo/estrella';
import { Boton } from '../../ui/Boton';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import { PREDETERMINADO, SUFIJO, type Grupo, type Modelo, type Tarea } from './modelos';

export interface Eleccion {
  id: string;
  calidad?: string;
}

export interface PropsMenuModelo {
  tarea: Tarea;
  grupos: Grupo[];
  elegido: Eleccion;
  alElegir: (e: Eleccion) => void;
  /** Créditos del modelo (y calidad) en esta tarea. */
  precio: (id: string, calidad?: string) => number;
  /** true si el pedido salió: el menú se cierra. false o nada: se queda abierto. */
  alCrear: () => boolean | void;
  enviando: boolean;
  /** Una línea bajo el precio (p. ej. lo que suma juntar varias imágenes). */
  nota?: string;
}

/** El «desde»: lo más barato del modelo (con resolución, la más baja). */
const desde = (m: Modelo, precio: PropsMenuModelo['precio']) =>
  Math.min(...(m.calidades ? m.calidades.map(c => precio(m.id, c.id)) : [precio(m.id)]));

export function MenuModelo({ tarea, grupos, elegido, alElegir, precio, alCrear, enviando, nota }: PropsMenuModelo) {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const filas = useRef<Record<string, HTMLButtonElement | null>>({});
  const idPanel = useId();

  const todos = grupos.flatMap(g => g.modelos);
  const actual = todos.find(m => m.id === elegido.id) ?? todos[0]!;
  const calidad = actual.calidades?.find(c => c.id === elegido.calidad) ?? actual.calidades?.[0];
  const creditos = precio(actual.id, calidad?.id);
  const nombre = calidad ? `${actual.nombre} · ${calidad.etiqueta}` : actual.nombre;

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

  function teclaFila(e: React.KeyboardEvent) {
    const i = todos.findIndex(m => m.id === actual.id);
    const paso = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    let j = -1;
    if (paso) j = Math.min(Math.max(i + paso, 0), todos.length - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = todos.length - 1;
    if (j < 0) return;
    e.preventDefault();
    const m = todos[j]!;
    alElegir({ id: m.id });
    filas.current[m.id]?.focus();
  }

  function teclaCalidad(e: React.KeyboardEvent) {
    const lista = actual.calidades;
    if (!lista) return;
    const i = Math.max(0, lista.findIndex(c => c.id === calidad?.id));
    const paso = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!paso) return;
    e.preventDefault();
    const c = lista[Math.min(Math.max(i + paso, 0), lista.length - 1)]!;
    alElegir({ id: actual.id, calidad: c.id });
    (e.currentTarget.parentElement?.querySelector(`[data-calidad="${c.id}"]`) as HTMLElement | null)?.focus();
  }

  return (
    <div ref={raiz} className="relative min-w-0">
      <button
        ref={chip}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-controls={abierto ? idPanel : undefined}
        onClick={() => setAbierto(a => !a)}
        className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-2 rounded-medio border border-linea bg-transparent px-3.5 text-sm whitespace-nowrap text-texto hover:border-campo min-[640px]:min-h-11 min-[640px]:w-auto min-[640px]:justify-start"
      >
        <span className="min-w-0 overflow-hidden text-ellipsis">
          <span className="text-secundario">Modelo</span> {nombre}
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
              'max-[639px]:fixed max-[639px]:inset-x-0 max-[639px]:top-auto max-[639px]:right-auto max-[639px]:bottom-0 max-[639px]:w-auto max-[639px]:max-w-none max-[639px]:rounded-b-none',
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

            <div
              role="radiogroup"
              aria-label="Modelos"
              className="max-h-[400px] overflow-y-auto px-1.5 pb-1.5 max-[639px]:max-h-[min(430px,50vh)]"
            >
              {grupos.map(g => (
                <div key={g.nivel}>
                  <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-superficie px-2.5 pt-3 pb-1 text-xs text-secundario">
                    <span className="font-semibold text-texto">{g.titulo}</span>
                    <span className="tabular-nums">
                      {ESTRELLA} {g.rango} {SUFIJO[tarea]}
                    </span>
                  </div>
                  {g.modelos.map(m => {
                    const sel = m.id === actual.id;
                    return (
                      <button
                        key={m.id}
                        ref={el => {
                          filas.current[m.id] = el;
                        }}
                        type="button"
                        role="radio"
                        aria-checked={sel}
                        tabIndex={sel ? 0 : -1}
                        onClick={() => alElegir({ id: m.id })}
                        onKeyDown={teclaFila}
                        className={unir(
                          'flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-medio border-0 px-2.5 py-2 text-left text-texto hover:bg-elevada',
                          sel ? 'bg-elevada' : 'bg-transparent',
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={unir(
                            'grid size-5 flex-none place-items-center rounded-pildora border-[1.5px]',
                            sel ? 'border-texto' : 'border-campo',
                          )}
                        >
                          {sel && <span className="size-2.5 rounded-pildora bg-texto" />}
                        </span>
                        <span className="min-w-0 flex-1">
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
                        <span className="text-sm whitespace-nowrap tabular-nums">
                          {m.calidades ? 'desde ' : ''}
                          {ESTRELLA} {desde(m, precio)}
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
                          onClick={() => alElegir({ id: actual.id, calidad: c.id })}
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
                  {ESTRELLA} {creditos} {SUFIJO[tarea]}
                </span>
              </div>
              {nota && <span className="-mt-1.5 text-xs text-secundario">{nota}</span>}
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
