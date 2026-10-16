// El COI que salió, como TRES TARJETAS apiladas y plegables (#CONTEXTO, #OBJETIVO, #INSTRUCCIONES), cada una con su «Copiar», y arriba
// «Plegar todo», «Guardar» y «Copiar todo» (dirección A del lienzo, COI-A.dc.html).
//
// Lo que el servidor manda es TEXTO (los tres bloques ya sin su encabezado): aquí se pinta como texto —React lo escapa, no hay HTML
// crudo— y se ordena un poco para leerlo (las partes numeradas de #INSTRUCCIONES, las «Suposición:» marcadas). Lo que se COPIA y lo
// que se GUARDA es el texto tal cual salió, no lo que se ve.
//
// Si la respuesta no trajo los tres bloques (`estructura_ok = false`) sale UNA sola tarjeta con la respuesta completa y «Copiar».
import type { Ref } from 'react';

import { Boton } from '../../ui/Boton';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import { IconoCoi } from './IconosCoi';
import {
  cuerpoDe,
  encabezado,
  lineasDe,
  ORDEN,
  partesDe,
  type ClaveBloque,
  type Coi,
  type Linea,
} from './logica';

export type Plegados = Record<ClaveBloque, boolean>;

const SUBTITULO: Record<ClaveBloque, string> = {
  ctx: 'La situación: lo que la IA necesita saber',
  obj: 'Lo que quieres lograr',
  ins: 'Cómo debe hacerlo la IA, en siete partes',
};

/** Botones de texto (nivel «enlace» de la carta) con 44 px de alto: el `<Boton nivel="enlace">` mide lo que su texto. */
export const ENLACE_BOTON =
  'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-boton border-0 bg-transparent px-2 text-sm font-medium ' +
  'text-enlace underline-offset-4 hover:text-texto hover:underline';

export interface PropsResultado {
  coi: Coi;
  idioma: 'es' | 'en';
  /** `true` = el bloque está abierto. */
  abiertos: Plegados;
  alAlternar: (clave: ClaveBloque) => void;
  alPlegarTodo: () => void;
  /** La clave del último botón de copiar que se pulsó y salió bien; durante unos segundos dice «Copiado». */
  copiado: string;
  alCopiar: (clave: ClaveBloque | 'todo') => void;
  /** Guardó en la Biblioteca: título con el que quedó. */
  guardado: string | null;
  alGuardar: () => void;
  /** El encabezado «Tu COI»: a donde va el foco cuando llega un resultado nuevo. */
  refTitulo: Ref<HTMLHeadingElement>;
}

function Parrafos({ lineas }: { lineas: Linea[] }) {
  return (
    <>
      {lineas.map((l, i) =>
        l.tipo === 'suposicion' ? (
          <p key={i} className="m-0 flex items-baseline [overflow-wrap:anywhere]">
            <span className="mr-2 inline-flex min-h-6 shrink-0 items-center rounded-chico border border-campo px-2 text-xs font-medium text-secundario">
              Suposición
            </span>
            <span>{l.texto}</span>
          </p>
        ) : (
          <p key={i} className="m-0 max-w-[65ch] [overflow-wrap:anywhere]">
            {l.texto}
          </p>
        ),
      )}
    </>
  );
}

function Instrucciones({ texto }: { texto: string }) {
  const partes = partesDe(texto);
  if (!partes)
    return (
      <div className="flex flex-col gap-2.5">
        <Parrafos lineas={lineasDe(texto)} />
      </div>
    );
  return (
    <ol className="m-0 flex max-w-[65ch] list-none flex-col gap-3.5 p-0">
      {partes.map(p => (
        <li key={`${p.n}-${p.titulo}`}>
          <h5 className="m-0 flex gap-2 font-texto text-sm font-semibold">
            <span className="min-w-[1.2em] shrink-0 text-secundario">{p.n}</span>
            <span className="[overflow-wrap:anywhere]">{p.titulo}</span>
          </h5>
          {p.lineas.map((l, i) => (
            <p key={i} className="m-0 mt-0.5 pl-[calc(1.2em+8px)] [overflow-wrap:anywhere]">
              {l}
            </p>
          ))}
        </li>
      ))}
    </ol>
  );
}

function BotonCopiar({
  etiqueta,
  etiquetaHecha,
  hecho,
  texto,
  alPulsar,
  soloIcono = false,
}: {
  etiqueta: string;
  /** El nombre accesible mientras dice «Copiado». */
  etiquetaHecha: string;
  hecho: boolean;
  texto: string;
  alPulsar: () => void;
  /** En 320–360 px de ancho el rótulo se esconde (queda el ícono, de 44 px y con su nombre). */
  soloIcono?: boolean;
}) {
  return (
    <Boton
      aria-label={hecho ? etiquetaHecha : etiqueta}
      onClick={alPulsar}
      className={unir(hecho && 'border-exito! text-exito!', soloIcono && 'max-[360px]:w-11 max-[360px]:px-0')}
    >
      {hecho ? <Icono nombre="listo" className="size-5!" /> : <IconoCoi nombre="copiar" />}
      <span className={unir(soloIcono && 'max-[360px]:sr-only')}>{hecho ? 'Copiado' : texto}</span>
    </Boton>
  );
}

export function Resultado({
  coi,
  idioma,
  abiertos,
  alAlternar,
  alPlegarTodo,
  copiado,
  alCopiar,
  guardado,
  alGuardar,
  refTitulo,
}: PropsResultado) {
  const tres = coi.estructura_ok;
  const todoAbierto = ORDEN.every(c => abiertos[c]);
  return (
    <section aria-labelledby="coi-res" className="mt-8">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 id="coi-res" ref={refTitulo} tabIndex={-1} className="m-0 font-titulo text-titulo-sm font-bold">
          Tu COI
        </h3>
        <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 sm:w-auto">
          {tres && (
            <button type="button" className={ENLACE_BOTON} onClick={alPlegarTodo}>
              {todoAbierto ? 'Plegar todo' : 'Abrir todo'}
            </button>
          )}
          <Boton
            aria-pressed={guardado !== null}
            aria-disabled={guardado !== null || undefined}
            onClick={guardado === null ? alGuardar : undefined}
            className={unir(guardado !== null && 'cursor-default border-exito! text-exito!')}
          >
            {guardado !== null ? <Icono nombre="listo" className="size-5!" /> : <IconoCoi nombre="marcador" />}
            {guardado !== null ? 'Guardado' : 'Guardar'}
          </Boton>
          {tres ? (
            <BotonCopiar
              etiqueta="Copiar todo el COI"
              etiquetaHecha="Copiado: todo el COI"
              texto="Copiar todo"
              hecho={copiado === 'todo'}
              alPulsar={() => alCopiar('todo')}
            />
          ) : (
            <BotonCopiar
              etiqueta="Copiar el COI completo"
              etiquetaHecha="Copiado: el COI completo"
              texto="Copiar"
              hecho={copiado === 'todo'}
              alPulsar={() => alCopiar('todo')}
            />
          )}
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-x-3">
        <p className="m-0 text-xs text-secundario">
          {guardado !== null
            ? 'Guardado en tu Biblioteca. Solo tú lo ves.'
            : tres
              ? 'Tres bloques, listos para pegar donde los uses. Las suposiciones que hicimos van marcadas.'
              : 'La respuesta no llegó separada en tres bloques, así que te la dejamos completa, lista para copiar.'}
        </p>
        {guardado !== null && (
          <a href="/estudio/biblioteca/?ver=mios" className={unir(ENLACE_BOTON, 'no-underline -ml-2')}>
            Ver en Míos
            <IconoCoi nombre="flecha" />
          </a>
        )}
      </div>

      {tres ? (
        <div className="flex flex-col gap-3">
          {ORDEN.map(c => {
            const abierto = abiertos[c];
            const nombre = encabezado(c, idioma);
            const id = `coi-bq-${c}`;
            return (
              <article key={c} data-bloque={c} className="overflow-hidden rounded-grande border border-linea bg-superficie">
                <div className="flex items-center gap-2 pr-2 sm:pr-3">
                  <h4 className="m-0 min-w-0 flex-1 font-texto">
                    <button
                      type="button"
                      aria-expanded={abierto}
                      aria-controls={id}
                      onClick={() => alAlternar(c)}
                      className="flex min-h-16 w-full cursor-pointer items-center gap-2 border-0 bg-transparent py-2 pl-3 pr-2 text-left text-texto hover:bg-elevada sm:gap-3 sm:pl-4 focus-visible:-outline-offset-3"
                    >
                      <IconoCoi
                        nombre="chevron"
                        className={unir('size-6! text-secundario motion-safe:transition-transform', abierto && 'rotate-180')}
                      />
                      <span className="min-w-0">
                        <b className="block font-titulo text-md font-bold tracking-[0.02em] [overflow-wrap:anywhere]">{nombre}</b>
                        <small className="block text-xs font-normal leading-snug text-secundario">{SUBTITULO[c]}</small>
                      </span>
                    </button>
                  </h4>
                  <BotonCopiar
                    etiqueta={`Copiar el bloque ${nombre}`}
                    etiquetaHecha={`Copiado: el bloque ${nombre}`}
                    texto="Copiar"
                    hecho={copiado === c}
                    soloIcono
                    alPulsar={() => alCopiar(c)}
                  />
                </div>
                <div id={id} hidden={!abierto} className="px-4 pb-4 pt-1 sm:pr-5 sm:pb-5 sm:pl-[52px]">
                  {c === 'ins' ? (
                    <Instrucciones texto={cuerpoDe(coi, c)} />
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      <Parrafos lineas={lineasDe(cuerpoDe(coi, c))} />
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <article data-bloque="completo" className="rounded-grande border border-linea bg-superficie p-4 sm:p-5">
          <div className="flex flex-col gap-2.5">
            <Parrafos lineas={lineasDe(coi.completo)} />
          </div>
        </article>
      )}
    </section>
  );
}
