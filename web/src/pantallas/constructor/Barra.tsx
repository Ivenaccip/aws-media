// La barra del Constructor: el nombre del flujo y los cuatro botones que actúan sobre todo el flujo, de menos a más importante:
// «Deshacer», «Limpiar», «Ver el JSON» y «Descargar .json» (el ÚNICO botón ámbar de la pantalla).
//
// Recibe lo ya calculado (`resumenFlujo`, `puedeDeshacer(estado)`) y `despachar`; lo único que hace por su cuenta es la pregunta de
// «Limpiar». El archivo y el JSON los resuelve quien arma la pantalla (`alDescargar`, `alAlternarJson`): aquí no se arma ni se
// baja nada.
//
//  · Nombre del flujo: controlado; edita con `renombrarFlujo`. `maxLength` = LARGO_NOMBRE_FLUJO, el mismo tope del reductor.
//  · Deshacer: se apaga con `aria-disabled` (no `disabled`) cuando no hay nada guardado. Pulsarlo apagado SÍ llega al reductor,
//    que contesta «Ya no hay nada que deshacer.» en el aviso (así el botón explica por qué no actúa).
//  · Limpiar: pregunta con `ui/Confirmar` (peligro; foco inicial en «Cancelar»). La acción `limpiar` es deshacible (D10), y lo dice
//    la pregunta. Con el lienzo vacío está apagado y dice por qué (`aria-describedby`). Al confirmar, el foco va a la primera opción
//    de «Elige cómo arranca tu flujo» (`[data-foco="1"]`), no de vuelta al botón: lo que la pregunta devuelve por omisión.
//  · Descargar .json: `aria-disabled` mientras haya errores y enlazado con la lista «Te falta esto…» (ID_FALTAN) cuando se ve.
//    Pulsarlo apagado llega a `alDescargar`: quien lo recibe dice el primer error. Un solo clic = un solo archivo es cosa de quien
//    descarga (candado antes del `await`), no de la barra.
//  · Ver el JSON: `aria-expanded`; enlaza la caja (ID_PANEL_JSON) con `aria-controls` solo cuando está abierta.
import { useEffect, useId, useRef, useState } from 'react';

import { Boton } from '../../ui/Boton';
import { Campo } from '../../ui/Campo';
import { Confirmar } from '../../ui/Confirmar';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import { LARGO_NOMBRE_FLUJO } from './modelo/datos/constantes';
import type { ResumenFlujo } from './modelo/selectores';
import type { AccionConstructor } from './modelo/tipos';
import { ID_FALTAN } from './Guia';
import { ID_PANEL_JSON } from './PanelJson';

export interface PropsBarra {
  /** El nombre del flujo (`estado.flujo.nombreFlujo`). */
  nombreFlujo: string;
  /** De `resumenFlujo(estado)`: si se puede descargar y si «Te falta esto…» está a la vista. */
  resumen: Pick<ResumenFlujo, 'puedeDescargar' | 'hayErrores'>;
  /** De `puedeDeshacer(estado)`. */
  puedeDeshacer: boolean;
  /** ¿Hay algún cuadro? Con el lienzo vacío no hay nada que limpiar. */
  hayCuadros: boolean;
  /** ¿Está abierta la caja del JSON? */
  jsonAbierto: boolean;
  despachar: (accion: AccionConstructor) => void;
  /** Se pulsó «Descargar .json» (también apagado: quien lo recibe dice por qué no se puede). */
  alDescargar: () => void;
  /** Se pulsó «Ver el JSON» / «Ocultar el JSON». */
  alAlternarJson: () => void;
  className?: string;
}

export function Barra({ nombreFlujo, resumen, puedeDeshacer, hayCuadros, jsonAbierto, despachar, alDescargar, alAlternarJson, className }: PropsBarra) {
  const idNadaQueLimpiar = useId();
  const idNadaQueDeshacer = useId();
  const idFaltaDisparador = useId();
  const [confirmando, setConfirmando] = useState(false);
  const refLimpiar = useRef<HTMLButtonElement>(null);
  // adónde vuelve el foco al cerrar la pregunta: null = adonde estaba (el botón «Limpiar», si se cancela)
  const focoAlCerrar = useRef<HTMLElement | null>(null);
  // sube cuando se confirma «Limpiar»: el efecto de abajo busca, YA con el lienzo vacío pintado, la primera opción del disparador
  const [limpiadoN, setLimpiadoN] = useState(0);
  useEffect(() => {
    if (limpiadoN === 0) return;
    focoAlCerrar.current = document.querySelector<HTMLElement>('[data-foco="1"]') ?? refLimpiar.current;
  }, [limpiadoN]);

  return (
    <div className={unir('flex flex-wrap items-end justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0 max-w-105 flex-1 basis-60">
        <Campo
          etiqueta="Nombre del flujo"
          type="text"
          maxLength={LARGO_NOMBRE_FLUJO}
          value={nombreFlujo}
          onChange={e => despachar({ k: 'renombrarFlujo', nombre: e.target.value })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Boton
          apagado={!puedeDeshacer}
          {...(puedeDeshacer ? {} : { 'aria-describedby': idNadaQueDeshacer })}
          onClick={() => despachar({ k: 'deshacer' })}
        >
          Deshacer
        </Boton>
        {!puedeDeshacer && (
          <span id={idNadaQueDeshacer} className="sr-only">
            Todavía no hay nada que deshacer.
          </span>
        )}
        <Boton
          ref={refLimpiar}
          apagado={!hayCuadros}
          {...(hayCuadros ? {} : { 'aria-describedby': idNadaQueLimpiar })}
          onClick={() => {
            if (!hayCuadros) return;
            focoAlCerrar.current = null;
            setConfirmando(true);
          }}
        >
          Limpiar
        </Boton>
        {!hayCuadros && (
          <span id={idNadaQueLimpiar} className="sr-only">
            No hay nada que limpiar todavía.
          </span>
        )}
        <Boton
          aria-expanded={jsonAbierto}
          {...(jsonAbierto ? { 'aria-controls': ID_PANEL_JSON } : {})}
          icono={<Icono nombre="codigo" className="size-5!" />}
          onClick={alAlternarJson}
        >
          {jsonAbierto ? 'Ocultar el JSON' : 'Ver el JSON'}
        </Boton>
        <Boton
          nivel="principal"
          apagado={!resumen.puedeDescargar}
          // apagado, su motivo se lee: la lista «Te falta esto…» si ya hay cuadros; si el lienzo está vacío esa lista no se pinta (lo dice la
          // tarjeta del disparador) y el motivo es una línea escondida a la vista
          {...(resumen.hayErrores ? { 'aria-describedby': ID_FALTAN } : !resumen.puedeDescargar ? { 'aria-describedby': idFaltaDisparador } : {})}
          icono={<Icono nombre="descargar" className="size-5!" />}
          onClick={alDescargar}
        >
          Descargar .json
        </Boton>
        {!resumen.puedeDescargar && !resumen.hayErrores && (
          <span id={idFaltaDisparador} className="sr-only">
            Todavía no hay nada que descargar: primero elige cómo arranca tu flujo.
          </span>
        )}
      </div>
      <Confirmar
        abierto={confirmando}
        alCambiar={setConfirmando}
        titulo="¿Limpiar todo el flujo?"
        descripcion="Se quitan todos los cuadros y las conexiones, y el nombre se queda. Si te arrepientes, puedes volver atrás con «Deshacer» o con Ctrl+Z."
        confirmar="Limpiar todo"
        peligro
        alConfirmar={() => {
          despachar({ k: 'limpiar' });
          setLimpiadoN(n => n + 1);
        }}
        focoAlCerrar={focoAlCerrar}
        focoDeRespaldo={refLimpiar}
      />
    </div>
  );
}
