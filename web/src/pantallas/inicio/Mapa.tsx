// El mapa en X (paso 1 del recorrido, «Elige un área»): Central al centro y las otras cuatro áreas en las esquinas.
//
// Escritorio: una cuadrícula de 3×3 con las dos diagonales punteadas por DETRÁS de las fichas (un SVG decorativo: se lee la X en los
// huecos entre ellas y nunca tapa texto). Celular (≤ 560 px): «X compacta», dos columnas con Central como una banda de ancho
// completo en medio y un trazo corto de cada esquina a la banda; la X grande no cabe (a 390 px las fichas medirían 95 px y
// «Automatizaciones» se saldría de la suya).
//
// El orden del DOM es el de lectura, fila a fila (Marketing, Producto, Central, Ventas, Automatizaciones), no el de menu.ts: así
// Tab recorre la X como se ve. Producto, Ventas y Automatizaciones son fichas inertes: se ven («Próximamente») y no se abren, pero
// siguen en el orden de Tab con `aria-disabled` (el lector las dice, y no hay un hueco sin explicar en el mapa).
import { MENU, type AreaMenu } from '../../marca/menu';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';

interface Puesto {
  /** El lugar de la ficha en la cuadrícula: el de escritorio y, con `max-[560px]:`, el del celular. */
  clase: string;
  /** El trazo corto que la une a la banda de Central en el celular: hacia abajo (fila de arriba) o hacia arriba (fila de abajo). */
  trazo?: 'abajo' | 'arriba';
}

/** Las áreas del mapa en su orden de lectura. Un área de menu.ts sin puesto aquí no saldría en el mapa: lo vigila Mapa.test.tsx. */
export const PUESTOS: Readonly<Record<string, Puesto>> = {
  mkt: { clase: 'col-start-1 row-start-1', trazo: 'abajo' },
  producto: { clase: 'col-start-3 row-start-1 max-[560px]:col-start-2', trazo: 'abajo' },
  central: { clase: 'col-start-2 row-start-2 max-[560px]:col-start-1 max-[560px]:col-span-2' },
  ventas: { clase: 'col-start-1 row-start-3', trazo: 'arriba' },
  automatizaciones: { clase: 'col-start-3 row-start-3 max-[560px]:col-start-2', trazo: 'arriba' },
};

const EN_ORDEN = Object.keys(PUESTOS)
  .map(clave => MENU.find(a => a.clave === clave))
  .filter((a): a is AreaMenu => a !== undefined);

// Cada clase de tamaño y de espacio vive en UNA de las dos listas, nunca en las dos: dos utilidades de la misma propiedad (y la
// misma variante) las resuelve el orden del CSS generado, no el orden en que se escriben.
const ESQUINA = 'min-h-24 text-sm max-[760px]:text-xs max-[560px]:min-h-22';
// «Central» es el centro del mapa: una letra más grande y, en el celular, la banda en una fila (ícono y nombre lado a lado).
const CENTRO = 'min-h-24 text-md max-[760px]:text-sm max-[560px]:min-h-14 max-[560px]:flex-row max-[560px]:gap-2';

/** «Estás aquí» del mapa y de las tres opciones: una etiqueta que NO se parte (a 390 y 320 px cabe en su ficha). */
export function EstasAqui() {
  return (
    <span className="inline-flex min-h-6 items-center rounded-pildora bg-activa px-2 text-xs font-medium whitespace-nowrap text-texto">
      Estás aquí
    </span>
  );
}

export interface PropsMapa {
  /** El área donde estás (lleva «Estás aquí»). */
  aqui: string;
  alElegir: (area: AreaMenu) => void;
}

export function Mapa({ aqui, alElegir }: PropsMapa) {
  return (
    <div
      role="group"
      aria-label="Áreas"
      className="relative grid grid-cols-3 gap-x-3 gap-y-12 max-[560px]:grid-cols-2 max-[560px]:gap-x-2 max-[560px]:gap-y-6"
    >
      {/* las dos diagonales: la caja del SVG ES la cuadrícula (viewBox de 0 a 100, sin proporción fija), y los extremos caen
          dentro de las fichas de las esquinas para que no asomen por los bordes de la tarjeta */}
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 z-0 size-full stroke-campo opacity-70 max-[560px]:hidden"
      >
        {[
          [17, 13, 83, 87],
          [83, 13, 17, 87],
        ].map(([x1, y1, x2, y2]) => (
          <line
            key={`${x1}-${y1}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            strokeWidth={2}
            strokeDasharray="2 7"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      {EN_ORDEN.map(area => {
        const puesto = PUESTOS[area.clave]!;
        const apagada = Boolean(area.proximamente);
        const estasAqui = aqui === area.clave;
        return (
          <button
            key={area.clave}
            type="button"
            aria-current={estasAqui ? 'location' : undefined}
            aria-disabled={apagada || undefined}
            onClick={() => {
              if (!apagada) alElegir(area);
            }}
            className={unir(
              'relative z-10 flex flex-col items-center justify-center gap-1 rounded-grande border px-2 py-3 text-center leading-[1.3] font-semibold',
              'max-[560px]:px-1 max-[560px]:py-2',
              area.clave === 'central' ? CENTRO : ESQUINA,
              apagada
                ? 'cursor-default border-linea bg-hundido text-secundario'
                : unir(
                    'cursor-pointer text-texto hover:border-campo hover:bg-elevada',
                    estasAqui ? 'border-campo bg-elevada' : 'border-linea bg-superficie',
                  ),
              puesto.clase,
            )}
          >
            <Icono nombre={area.icono} className="size-6! text-secundario" />
            {/* overflow-wrap: «Automatizaciones» cabe a 390 y a 320 px; si una letra más ancha no cupiera, se parte (hyphens, lang="es"
                de la página) en vez de salirse de su ficha */}
            <span className="max-w-full [hyphens:auto] [overflow-wrap:anywhere]">{area.titulo}</span>
            {apagada && <small className="text-xs font-normal">Próximamente</small>}
            {estasAqui && <EstasAqui />}
            {puesto.trazo && (
              <span
                aria-hidden="true"
                className={unir(
                  'pointer-events-none absolute left-1/2 hidden h-6 border-l-2 border-dotted border-campo opacity-80 max-[560px]:block',
                  puesto.trazo === 'abajo' ? 'top-full' : 'bottom-full',
                )}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
