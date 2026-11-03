// «Tus 3 fijados» (dueño, 16-oct-2026: «un pin para los top 3 prompts que quieren recordar»): arriba de la lista, tres casillas
// numeradas 1·2·3 con lo que la persona quiere tener a la mano. Una casilla vacía dice cómo se llena; una llena abre su prompt y
// trae «Subir», «Bajar» y «Quitar» (el orden importa: es el orden del top).
//
// Los tres botones llevan el título del prompt en su nombre («Subir «Retrato…»»): leídos de uno en uno, dicen sobre qué actúan. «Subir»
// en la primera y «Bajar» en la última quedan APAGADOS PERO ENFOCABLES (`aria-disabled`, no `disabled`): el foco no se pierde al
// mover un prompt hasta el extremo, y el lector de pantalla puede decir por qué no hace nada.
//
// Esta pieza solo pinta: quien manda (Taller) cambia la lista, la guarda y devuelve el foco donde estaba (cada casilla trae
// `data-fijado` y cada botón `data-accion`, que es por donde se vuelve a encontrar tras reordenar).
import type { Ref } from 'react';

import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import type { Prompt } from './logica';

export interface PropsFijados {
  /** Los fijados que existen, en orden. */
  items: readonly Prompt[];
  tope: number;
  /** El prompt que está abierto en el detalle (su casilla se marca). */
  abierto: string | null;
  alAbrir: (p: Prompt) => void;
  alMover: (p: Prompt, paso: -1 | 1) => void;
  alQuitar: (p: Prompt) => void;
  /** Un aviso o error de lo que se hizo aquí (ya trae su rol). */
  nota?: React.ReactNode;
  tituloRef?: Ref<HTMLHeadingElement>;
}

const ICONO_BOTON =
  'grid size-11 shrink-0 cursor-pointer place-items-center rounded-boton border-0 bg-transparent p-0 text-secundario ' +
  'hover:bg-activa hover:text-texto aria-disabled:cursor-default aria-disabled:text-apagado aria-disabled:hover:bg-transparent aria-disabled:hover:text-apagado';

export function Fijados({ items, tope, abierto, alAbrir, alMover, alQuitar, nota, tituloRef }: PropsFijados) {
  const casillas = Array.from({ length: tope }, (_, i) => items[i] ?? null);
  return (
    <section aria-labelledby="bib-fijados" className="mb-4 rounded-grande border border-linea bg-hundido p-3">
      <h4
        id="bib-fijados"
        ref={tituloRef}
        tabIndex={-1}
        className="m-0 mb-2 flex items-center gap-2 text-sm font-semibold text-texto"
      >
        <Icono nombre="fijar" className="size-5 text-ambar-claro" />
        Tus {tope} fijados
      </h4>
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {casillas.map((p, i) =>
          p ? (
            <li
              key={p.id}
              data-fijado={p.id}
              className={unir(
                'flex flex-wrap items-center gap-x-1 rounded-boton border pl-2',
                abierto === p.id ? 'border-campo bg-elevada' : 'border-linea bg-superficie',
              )}
            >
              <span
                aria-hidden="true"
                className="grid size-6 shrink-0 place-items-center rounded-pildora border border-campo text-xs font-bold text-secundario"
              >
                {i + 1}
              </span>
              <button
                type="button"
                data-accion="abrir"
                aria-current={abierto === p.id ? 'true' : undefined}
                onClick={() => alAbrir(p)}
                className="min-h-11 min-w-0 flex-[1_1_9rem] cursor-pointer border-0 bg-transparent px-2 py-1 text-left text-sm font-medium text-texto"
              >
                <span className="line-clamp-2">{p.titulo}</span>
              </button>
              <span className="ml-auto flex shrink-0">
                <button
                  type="button"
                  data-accion="subir"
                  aria-label={`Subir «${p.titulo}»`}
                  aria-disabled={i === 0 || undefined}
                  onClick={() => i > 0 && alMover(p, -1)}
                  className={ICONO_BOTON}
                >
                  <Icono nombre="arriba" />
                </button>
                <button
                  type="button"
                  data-accion="bajar"
                  aria-label={`Bajar «${p.titulo}»`}
                  aria-disabled={i === items.length - 1 || undefined}
                  onClick={() => i < items.length - 1 && alMover(p, 1)}
                  className={ICONO_BOTON}
                >
                  <Icono nombre="abajo" />
                </button>
                <button
                  type="button"
                  data-accion="quitar"
                  aria-label={`Quitar «${p.titulo}» de fijados`}
                  onClick={() => alQuitar(p)}
                  className={ICONO_BOTON}
                >
                  <Icono nombre="cerrar" />
                </button>
              </span>
            </li>
          ) : (
            <li
              key={`vacia-${i}`}
              className="flex min-h-11 items-center gap-2 rounded-boton border border-dashed border-linea pl-2 pr-3 text-xs text-secundario"
            >
              <span
                aria-hidden="true"
                className="grid size-6 shrink-0 place-items-center rounded-pildora border border-linea text-xs font-bold text-secundario"
              >
                {i + 1}
              </span>
              Fija aquí un prompt que quieras recordar
            </li>
          ),
        )}
      </ol>
      {nota}
    </section>
  );
}
