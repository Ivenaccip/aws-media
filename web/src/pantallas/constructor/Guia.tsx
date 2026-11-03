// Todo el texto que acompaña al lienzo y no es un panel: la pista de qué sigue (`guia`), el aviso «Conectando. …» con su «Cancelar»,
// la leyenda de las dos maneras de conectar, la ayuda del teclado (una línea plegable) y el resumen del flujo («Te falta esto para
// poder descargar» / «Listo para descargar» / lo que conviene saber).
//
// Cada pieza recibe lo que ya calculó selectores.ts (`guia(estado)`, `textoConectar(estado)`, `resumenFlujo(estado)`); ninguna
// calcula nada. Constructor.tsx las coloca donde quiera.
//
// Dos ids son contrato con quien arma la pantalla:
//  · `ID_FALTAN` — la lista «Te falta esto…». «Descargar .json» (Barra) la enlaza con `aria-describedby`. NO es una región viva
//    (`role="status"` la anunciaría en cada edición): es validación junto al botón, estática (informe 03 §6.2-3).
//  · `ID_AYUDA_TECLADO` — el texto de los atajos. El lienzo lo enlaza con `aria-describedby`: así la ayuda existe para quien usa lector de
//    pantalla sin ocupar un párrafo permanente en la página (D9 del informe 03). El párrafo NO puede vivir dentro del `<details>`: cerrado
//    no se expone y la descripción del lienzo salía vacía. Está siempre en el DOM, escondido a la vista (`sr-only`) mientras el
//    desplegable está cerrado.
import { useState } from 'react';

import { Boton } from '../../ui/Boton';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import type { ResumenFlujo } from './modelo/selectores';
import type { AccionConstructor } from './modelo/tipos';
import { BOTON_44 } from './PiezasPanel';

/** El `id` de la lista «Te falta esto para poder descargar» (Barra la enlaza desde «Descargar .json»). */
export const ID_FALTAN = 'faltan';
/** El `id` del texto con los atajos del teclado (para `aria-describedby` del lienzo). */
export const ID_AYUDA_TECLADO = 'ayuda-teclado';

// ---------------------------------------------------------------- la pista de qué sigue

export interface PropsGuia {
  /** Lo que devuelve `guia(estado)`. */
  texto: string;
  className?: string;
}

/** La pista de qué hacer ahora («Paso 1: elige cómo arranca tu flujo.»). Texto fijo, sin región viva. */
export function Guia({ texto, className }: PropsGuia) {
  return <p className={unir('m-0 text-sm text-texto', className)}>{texto}</p>;
}

// ---------------------------------------------------------------- «Conectando. …»

export interface PropsAvisoConectando {
  /** Lo que devuelve `textoConectar(estado)`; vacío = no se está conectando y no se pinta nada. */
  texto: string;
  despachar: (accion: AccionConstructor) => void;
  className?: string;
}

/**
 * El aviso mientras se espera el cuadro destino: qué tocar, y «Cancelar» (`cancelarConexion`). No es una región viva: el reductor ya
 * deja el mismo texto en su aviso, que se anuncia una sola vez.
 */
export function AvisoConectando({ texto, despachar, className }: PropsAvisoConectando) {
  if (!texto) return null;
  return (
    <div
      className={unir('flex flex-wrap items-center justify-between gap-3 rounded-boton border border-ambar-hondo bg-aviso-fondo px-4 py-3 text-sm', className)}
    >
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <b className="font-semibold">Conectando.</b> {texto}
      </span>
      <Boton denso className={BOTON_44} onClick={() => despachar({ k: 'cancelarConexion' })}>
        Cancelar
      </Boton>
    </div>
  );
}

// ---------------------------------------------------------------- las dos maneras de conectar

const TRAZO_LEYENDA = 'shrink-0 stroke-secundario';

/** Las dos maneras de conectar, cada una con su flechita: un solo sentido y ida y vuelta. Texto fijo. */
export function Leyenda({ className }: { className?: string }) {
  return (
    <div className={unir('flex flex-col gap-2', className)}>
      <p className="m-0 flex items-center gap-3 text-xs text-secundario">
        <svg width="44" height="12" viewBox="0 0 44 12" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={TRAZO_LEYENDA} aria-hidden="true" focusable="false">
          <path d="M2 6h38M34 1l6 5-6 5" />
        </svg>
        <span>
          <b className="font-semibold text-texto">Un solo sentido, como pasar un recado.</b> Cuando el cuadro anterior termina, le entrega su respuesta
          al siguiente y ahí se acaba. Ejemplo: llega un correo, la IA lo contesta y el resultado se manda por Slack.
        </span>
      </p>
      <p className="m-0 flex items-center gap-3 text-xs text-secundario">
        <svg width="44" height="12" viewBox="0 0 44 12" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={TRAZO_LEYENDA} aria-hidden="true" focusable="false">
          <path d="M10 6h24" strokeDasharray="4 4" />
          <path d="M10 1L4 6l6 5M34 1l6 5-6 5" />
        </svg>
        <span>
          <b className="font-semibold text-texto">Ida y vuelta, como preguntarle algo a un compañero.</b> Una app cuelga de la patita del agente: él la
          consulta solo cuando la necesita y ella le contesta. Ejemplo: la IA le pregunta a Google Sheets «¿cuánto vendimos hoy?» y Sheets le responde.
          Dos IA también pueden conversar así, una a la derecha de la otra: se van y vienen preguntas y respuestas hasta tener un mejor resultado.
        </span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- los atajos del teclado

/**
 * Los atajos del teclado en una línea plegable («Atajos del teclado»): cerrada ocupa un renglón y abierta dice qué hace cada tecla. El
 * texto lleva `id={ID_AYUDA_TECLADO}` para que el lienzo lo enlace con `aria-describedby`, y está SIEMPRE en la página: abierto se ve debajo
 * del renglón; cerrado queda solo para el lector de pantalla.
 */
export function AyudaTeclado({ className }: { className?: string }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <div className={className}>
      <details onToggle={e => setAbierta(e.currentTarget.open)}>
        <summary className="flex min-h-11 cursor-pointer items-center text-xs text-secundario">Atajos del teclado</summary>
      </details>
      <p id={ID_AYUDA_TECLADO} className={unir('m-0 text-xs text-secundario', abierta ? 'pb-2' : 'sr-only')}>
        Tab recorre los cuadros, sus «×», los «+» y las flechas; Enter abre los ajustes; Supr quita el cuadro; las flechas del teclado mueven un cuadro
        (con Mayús, más lejos); Ctrl+Z (o Cmd+Z) deshace el último cambio; Esc cierra un menú o te regresa de los ajustes al cuadro.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- el resumen del flujo

export interface PropsResumenDelFlujo {
  /** Lo que devuelve `resumenFlujo(estado)`. */
  resumen: ResumenFlujo;
  className?: string;
}

/**
 * Lo que falta para poder descargar (con el lienzo vacío no se pinta: lo dice la tarjeta del disparador), o «Listo para descargar», y lo
 * que conviene saber aunque se pueda descargar. Estático: sin `role="status"`.
 */
export function ResumenDelFlujo({ resumen, className }: PropsResumenDelFlujo) {
  const listo = resumen.puedeDescargar && resumen.cuadros > 0;
  if (!resumen.hayErrores && !listo && !resumen.hayAvisos) return null;
  return (
    <div className={unir('flex flex-col gap-3', className)}>
      {resumen.hayErrores && (
        <div id={ID_FALTAN} className="flex gap-3 rounded-boton border border-ambar-hondo bg-aviso-fondo px-4 py-3 text-sm">
          <Icono nombre="aviso" className="mt-0.5 size-5! text-ambar-claro" />
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <b className="font-semibold">Te falta esto para poder descargar:</b>
            <ul className="m-0 mt-1 list-disc pl-5">
              {resumen.errores.map(e => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {listo && (
        <div className="flex gap-3 rounded-boton border border-linea bg-superficie px-4 py-3 text-sm">
          <Icono nombre="listo" className="mt-0.5 size-5! text-exito" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{resumen.resumenOk}</span>
        </div>
      )}
      {resumen.hayAvisos && (
        <ul className="m-0 list-disc pl-5 text-xs text-secundario [overflow-wrap:anywhere]">
          {resumen.avisos.map(a => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
