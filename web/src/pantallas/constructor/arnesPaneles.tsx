// SOLO PARA PRUEBAS: un «Constructor» de mentira que arma los paneles de esta carpeta (barra, guía, menú del «+», tarjeta del disparador,
// Ajustes, editor de la flecha, JSON) con el reductor y los selectores de verdad, y unos cuadros y flechas de palo (botones con los
// mismos atributos de foco que pondrán Nodo y Flechas). Sirve para probar lo que ningún panel puede probar solo: que el foco que pide
// el reductor tiene a dónde ir con los atributos del contrato, y que escribir, quitar, deshacer o limpiar de punta a punta deja la
// pantalla en un estado coherente. No lo importa ningún código de la app.
//
// El contrato de foco (el mismo que cumple Constructor.tsx): botón de cuadro `data-nodo`; × `data-quitar`; «+» de la derecha
// `data-mas="der-<id>"`, de la patita `data-mas="tool-<id>"` y «en medio» `data-mas="medio"` (en AjustesEnlace); círculo de la flecha
// `data-insignia`; panel `id="ajustes"`; primera opción del menú y del elegir-disparador `data-foco="1"`; «Un solo sentido» `data-enl="1"`.
import { render } from '@testing-library/react';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { vi } from 'vitest';

import { AjustesEnlace } from './AjustesEnlace';
import { AjustesNodo } from './AjustesNodo';
import { Barra } from './Barra';
import { ElegirDisparador } from './ElegirDisparador';
import { AvisoConectando, Guia, ResumenDelFlujo } from './Guia';
import { MenuMas } from './MenuMas';
import { construirFlujo } from './modelo/exportar';
import { estadoInicial, puedeDeshacer, reducir } from './modelo/reductor';
import {
  guia,
  panelDeAjustes,
  resumenFlujo,
  textoConectar,
  textoSinSeleccion,
  vistaAjustes,
  vistaElegirDisparador,
  vistaEnlace,
  vistaFlechas,
  vistaMenu,
  vistaNodos,
} from './modelo/selectores';
import type { AccionConstructor, EstadoConstructor, Foco } from './modelo/tipos';
import { AjustesVacio } from './PanelAjustes';
import { PanelJson } from './PanelJson';

/** El elemento al que apunta una petición de foco, con los atributos del contrato. */
export function elementoDeFoco(objetivo: Foco): HTMLElement | null {
  const q = (selector: string) => document.querySelector<HTMLElement>(selector);
  switch (objetivo.k) {
    case 'nodo':
      return q(`[data-nodo="${objetivo.id}"]`);
    case 'mas':
      return q(`[data-mas="${objetivo.clave}"]`);
    case 'insignia':
      return q(`[data-insignia="${objetivo.id}"]`);
    case 'ajustes':
      return q('#ajustes');
    case 'primeraOpcionMenu':
    case 'primeraOpcionDisparador':
      return q('[data-foco="1"]');
    case 'opcionUnSentido':
      return q('[data-enl="1"]');
    case 'primerNodo':
      return q('[data-nodo]');
  }
}

export interface PropsArnes {
  inicial: EstadoConstructor;
  alDespachar?: (accion: AccionConstructor) => void;
  alCambiar?: (estado: EstadoConstructor) => void;
  alDescargar?: () => void;
}

export function ArnesPaneles({ inicial, alDespachar, alCambiar, alDescargar }: PropsArnes) {
  const [estado, dispatch] = useReducer(reducir, inicial);
  const [jsonAbierto, setJsonAbierto] = useState(false);
  const despachar = useCallback(
    (a: AccionConstructor) => {
      alDespachar?.(a);
      dispatch(a);
    },
    [alDespachar],
  );

  // lo que hará Constructor.tsx: cumplir la petición de foco y apagarla
  useEffect(() => {
    alCambiar?.(estado);
    const p = estado.foco;
    if (!p) return;
    elementoDeFoco(p.objetivo)?.focus();
    dispatch({ k: 'limpiarPeticiones', hasta: p.n });
  }, [estado, alCambiar]);

  const resumen = resumenFlujo(estado);
  const menu = vistaMenu(estado);
  const ajustes = vistaAjustes(estado);
  const enlace = vistaEnlace(estado);
  const cual = panelDeAjustes(estado);
  const json = jsonAbierto && resumen.puedeDescargar ? construirFlujo(estado.flujo).json : null;

  return (
    <div>
      <Guia texto={guia(estado)} />
      <Barra
        nombreFlujo={estado.flujo.nombreFlujo}
        resumen={resumen}
        puedeDeshacer={puedeDeshacer(estado)}
        hayCuadros={estado.flujo.nodes.length > 0}
        jsonAbierto={jsonAbierto}
        despachar={despachar}
        alDescargar={() => alDescargar?.()}
        alAlternarJson={() => setJsonAbierto(v => !v)}
      />
      <AvisoConectando texto={textoConectar(estado)} despachar={despachar} />
      {/* el lienzo de palo: cuadros, sus «+», y los círculos de las flechas */}
      <div className="relative" data-lienzo="1">
        {vistaNodos(estado).map(n => (
          <span key={n.id}>
            <button type="button" data-nodo={n.id} aria-pressed={n.seleccionado} onClick={() => despachar({ k: 'abrirNodo', id: n.id })}>
              {n.etiqueta}
            </button>
            <button type="button" data-quitar={n.id} aria-label={n.etiquetaQuitar} onClick={() => despachar({ k: 'quitarNodo', id: n.id })}>
              ×
            </button>
            {n.puedeDer && (
              <button type="button" data-mas={`der-${n.id}`} aria-label={n.etiquetaMasDer} onClick={() => despachar({ k: 'abrirMenu', ancla: n.id, tipo: 'seq' })}>
                +
              </button>
            )}
            {n.patita && (
              <button type="button" data-mas={`tool-${n.id}`} aria-label={n.etiquetaMasTool} onClick={() => despachar({ k: 'abrirMenu', ancla: n.id, tipo: 'tool' })}>
                +
              </button>
            )}
          </span>
        ))}
        {vistaFlechas(estado).map(f => (
          <button key={f.id} type="button" data-insignia={f.id} aria-label={f.etiqueta} aria-pressed={f.activa} onClick={() => despachar({ k: 'abrirEnlace', id: f.id })}>
            {f.id}
          </button>
        ))}
        <ElegirDisparador vista={vistaElegirDisparador(estado)} despachar={despachar} />
        {menu && <MenuMas vista={menu} despachar={despachar} />}
      </div>
      {cual === 'cuadro' && ajustes && <AjustesNodo vista={ajustes} despachar={despachar} />}
      {cual === 'enlace' && enlace && <AjustesEnlace vista={enlace} despachar={despachar} />}
      {cual === 'ninguno' && <AjustesVacio texto={textoSinSeleccion(estado)} despachar={despachar} />}
      <ResumenDelFlujo resumen={resumen} />
      {jsonAbierto && <PanelJson json={json} textoSinJson={resumen.textoSinJson} />}
    </div>
  );
}

export interface Montado {
  /** Todo lo que los componentes mandaron a `despachar`, en orden. */
  acciones: AccionConstructor[];
  /** El estado de ahora (el del último render). */
  estado: () => EstadoConstructor;
  /** Cuántas veces se pidió descargar. */
  alDescargar: ReturnType<typeof vi.fn<() => void>>;
  rerender: ReturnType<typeof render>['rerender'];
  unmount: () => void;
}

/** Pinta el arnés con ese estado y devuelve cómo mirarlo. */
export function montar(inicial: EstadoConstructor): Montado {
  const acciones: AccionConstructor[] = [];
  let actual = inicial;
  const alDescargar = vi.fn<() => void>();
  const r = render(
    <ArnesPaneles
      inicial={inicial}
      alDespachar={a => acciones.push(a)}
      alCambiar={e => {
        actual = e;
      }}
      alDescargar={alDescargar}
    />,
  );
  return { acciones, estado: () => actual, alDescargar, rerender: r.rerender, unmount: r.unmount };
}

export { estadoInicial };
