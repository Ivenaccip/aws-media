// «¿Qué hace que tu flujo arranque?»: la tarjeta que sale sobre el lienzo mientras no hay disparador (con el lienzo vacío, o si se
// quitó el que había). Cuatro opciones —a una hora, un mensaje de chat, un aviso web, algo que pasa en una app— y, solo con el
// lienzo vacío, «Cargar el ejemplo».
//
// Va DENTRO del lienzo (su contenedor es `relative`): se coloca sola, a 24 px de la esquina de arriba a la izquierda y por encima
// de los cuadros pero por debajo del menú del «+». Recibe el objeto de `vistaElegirDisparador` y `despachar`.
//
// Foco: la primera opción lleva `data-foco="1"`, que es lo que busca Constructor.tsx cuando el reductor pide `primeraOpcionDisparador`
// (tras limpiar el lienzo o quitar el disparador): el foco nunca cae a `<body>`.
import { Boton } from '../../ui/Boton';
import { unir } from '../../ui/unir';
import type { VistaElegirDisparador } from './modelo/selectores';
import type { AccionConstructor } from './modelo/tipos';
import { BOTON_44, Opcion } from './PiezasPanel';

export interface PropsElegirDisparador {
  vista: VistaElegirDisparador;
  despachar: (accion: AccionConstructor) => void;
  /** Clases extra del contenedor (la posición se puede mover sin tocar este archivo). */
  className?: string;
}

export function ElegirDisparador({ vista, despachar, className }: PropsElegirDisparador) {
  if (!vista.visible) return null;
  return (
    <div className={unir('absolute left-6 top-6 z-4 w-[min(520px,calc(100vw-96px))]', className)}>
      <div className="flex flex-col gap-4 rounded-grande border border-linea bg-superficie p-6">
        <div>
          <span className="inline-flex min-h-6 items-center rounded-chico border border-campo px-2 text-xs text-secundario">{vista.etiqueta}</span>
        </div>
        <h3 className="m-0 font-titulo text-titulo-md font-bold [overflow-wrap:anywhere]">{vista.titulo}</h3>
        <div role="group" aria-label="Disparador del flujo" className="flex flex-col gap-2">
          {vista.opciones.map((o, i) => (
            <Opcion
              key={o.id}
              titulo={o.nombre}
              detalle={o.detalle}
              icono={o.icono}
              data-foco={i === 0 ? '1' : undefined}
              onClick={() => despachar({ k: 'elegirDisparador', tipo: o.id })}
            />
          ))}
        </div>
        {vista.puedeEjemplo && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-secundario">¿Prefieres ver uno armado?</span>
            <Boton denso className={BOTON_44} onClick={() => despachar({ k: 'cargarEjemplo' })}>
              Cargar el ejemplo
            </Boton>
          </div>
        )}
      </div>
    </div>
  );
}
