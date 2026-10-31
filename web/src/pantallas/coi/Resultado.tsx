// El COI que salió, como UN solo texto dentro de un cuadro con su propio scroll, con «Guardar» y «Copiar» arriba.
//
// El texto lleva los tres encabezados (#CONTEXTO, #OBJETIVO, #INSTRUCCIONES) en orden, tal cual se pegan donde se usen. Lo que el servidor
// manda es TEXTO: aquí se pinta como texto —React lo escapa, no hay HTML crudo— y lo único que se ve distinto de lo que se copia es que
// las negritas de markdown (`**`) no salen con asteriscos. Lo que se COPIA y lo que se GUARDA es el texto tal cual salió.
//
// El cuadro tiene un alto máximo y se desplaza por dentro: un COI largo no alarga la página. Se alcanza con el teclado (tabindex 0).
//
// Si la respuesta no trajo los tres bloques (`estructura_ok = false`), el cuadro lleva la respuesta completa y el aviso lo dice.
import { Fragment, type Ref } from 'react';

import { Boton } from '../../ui/Boton';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import { IconoCoi } from './IconosCoi';
import { esEncabezado, textoMostrado, type Coi } from './logica';

/** Botones de texto (nivel «enlace» de la carta) con 44 px de alto: el `<Boton nivel="enlace">` mide lo que su texto. */
export const ENLACE_BOTON =
  'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-boton border-0 bg-transparent px-2 text-sm font-medium ' +
  'text-enlace underline-offset-4 hover:text-texto hover:underline';

/** Dónde vive el texto: de aquí cuelga el «Copiar» que no pudo copiar solo (deja el texto seleccionado). */
export const ID_TEXTO = 'coi-texto';

export interface PropsResultado {
  coi: Coi;
  idioma: 'es' | 'en';
  /** El «Copiar» salió bien: durante unos segundos dice «Copiado». */
  copiado: boolean;
  alCopiar: () => void;
  /** Guardó en la Biblioteca: título con el que quedó. */
  guardado: string | null;
  /** Se está armando otro COI: «Guardar» se apaga (lo que se guardaría es el de ahora, que está por irse de la pantalla). */
  armando?: boolean;
  alGuardar: () => void;
  /** El encabezado «Tu COI»: a donde va el foco cuando llega un resultado nuevo. */
  refTitulo: Ref<HTMLHeadingElement>;
}

/** El texto, línea por línea: los encabezados de bloque en negritas y todo lo demás como llegó (los saltos y la sangría los guarda
 *  `whitespace-pre-wrap`). */
function Texto({ texto }: { texto: string }) {
  return (
    <>
      {texto.split('\n').map((linea, i) => (
        <Fragment key={i}>
          {i > 0 && '\n'}
          {esEncabezado(linea) ? <b className="font-titulo font-bold tracking-[0.02em]">{linea}</b> : linea}
        </Fragment>
      ))}
    </>
  );
}

export function Resultado({ coi, idioma, copiado, alCopiar, guardado, armando = false, alGuardar, refTitulo }: PropsResultado) {
  const tres = coi.estructura_ok;
  return (
    <section aria-labelledby="coi-res" className="mt-8">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 id="coi-res" ref={refTitulo} tabIndex={-1} className="m-0 font-titulo text-titulo-sm font-bold">
          Tu COI
        </h3>
        <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 sm:w-auto">
          <Boton
            aria-pressed={guardado !== null}
            aria-disabled={guardado !== null || armando || undefined}
            aria-describedby={armando && guardado === null ? 'coi-res-nota' : undefined}
            onClick={guardado === null && !armando ? alGuardar : undefined}
            className={unir(guardado !== null && 'cursor-default border-exito! text-exito!', armando && guardado === null && 'cursor-default text-secundario!')}
          >
            {guardado !== null ? <Icono nombre="listo" className="size-5!" /> : <IconoCoi nombre="marcador" />}
            {guardado !== null ? 'Guardado' : 'Guardar'}
          </Boton>
          <Boton aria-label={copiado ? 'Copiado: el COI' : 'Copiar el COI'} onClick={alCopiar} className={unir(copiado && 'border-exito! text-exito!')}>
            {copiado ? <Icono nombre="listo" className="size-5!" /> : <IconoCoi nombre="copiar" />}
            {copiado ? 'Copiado' : 'Copiar'}
          </Boton>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-x-3">
        <p id="coi-res-nota" className="m-0 text-xs text-secundario">
          {guardado !== null
            ? 'Guardado en tu Biblioteca. Solo tú lo ves.'
            : armando
              ? 'Estamos armando otro COI: mientras llega no se puede guardar este. Puedes copiarlo.'
              : tres
                ? 'Un solo texto, listo para pegar donde lo uses. Si es largo, desplázate dentro del cuadro. Las suposiciones que hicimos van marcadas.'
                : 'La respuesta no llegó separada en Contexto, Objetivo e Instrucciones, así que te la dejamos completa, lista para copiar.'}
        </p>
        {guardado !== null && (
          <a href="/estudio/biblioteca/?ver=mios" className={unir(ENLACE_BOTON, 'no-underline -ml-2')}>
            Ver en Míos
            <IconoCoi nombre="flecha" />
          </a>
        )}
      </div>

      {/* El cuadro: alto máximo y scroll por dentro. `tabIndex 0` para que el teclado llegue a él y pueda desplazarlo con las flechas
          (una región que se desplaza y no se enfoca deja sin leerla a quien no usa el ratón: WCAG 2.1.1, regla `scrollable-region-focusable` de axe). */}
      <div
        id={ID_TEXTO}
        role="region"
        aria-label="Texto de tu COI"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        className="max-h-[min(60dvh,32rem)] overflow-y-auto overscroll-contain rounded-grande border border-linea bg-superficie p-4 sm:p-5"
      >
        <p className="m-0 max-w-[68ch] whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">
          <Texto texto={textoMostrado(coi, idioma)} />
        </p>
      </div>
    </section>
  );
}
