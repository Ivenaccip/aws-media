// UI·23 — «Cómo fue cambiando», dibujado: una barra de vistas por medición,
// de la más vieja a la más nueva, con su cifra encima. La primera vez que
// entra en pantalla las barras crecen desde la base, 50 ms una detrás de otra,
// y la cifra de cada una asoma cuando su barra termina (barra-crece y
// cifra-asoma en tokens.css). Lo que se pinta sin la marca `data-entra` de
// useAparecerUnaVez es la gráfica COMPLETA: la animación solo mueve `scale` y
// `opacity`, nunca el alto.
//
// Va aria-hidden: lo mismo, con todas las mediciones y sus fechas, está en la
// tabla de abajo, que es lo que lee un lector de pantalla. Nada de <li>, <b>
// ni filas aquí: las pruebas de la pantalla cuentan esos.
import { useRef, type CSSProperties } from 'react';

import { useAparecerUnaVez } from '../../nucleo/useAparecerUnaVez';
import { diaCorto, fecha, num, type Barra } from './logica';

// las custom properties no están en el tipo de `style`
const vars = (v: Record<string, string | number>) => v as CSSProperties;

export function GraficaVistas({ id, barras, de }: { id: string; barras: Barra[]; de: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // por publicación: cerrar y volver a abrir, o encontrarla en «Las más vistas», no la repite
  useAparecerUnaVez(ref, 'vistas:' + id);
  // lo último que se mueve: la cifra de la última barra que tiene cifra
  const ultima = barras.map(b => b.vistas !== null).lastIndexOf(true);
  return (
    <div ref={ref} data-grafica="vistas" aria-hidden="true" className="mb-4">
      <p className="m-0 mb-2 text-xs text-secundario">
        Vistas en cada medición, de la más vieja a la más nueva
        {de > barras.length ? ` (las ${barras.length} más recientes de ${de})` : ''}
      </p>
      {/* Cada columna mide 64 px y encoge en un teléfono; la barra, 24 px como
          mucho. Las barras y sus fechas van en dos filas con las mismas
          columnas: el w-fit de fuera les da el mismo ancho a las dos */}
      <div className="w-fit max-w-full">
        {/* pt-6: el sitio de la cifra de la barra más alta */}
        <div className="flex h-28 items-end gap-1 border-b border-linea pt-6">
          {barras.map((b, i) => (
            <div
              key={b.cuando + '#' + i}
              data-barra=""
              className="relative flex w-16 min-w-0 shrink justify-center"
              style={vars({ height: `${b.alto}%`, '--i': i })}
              title={b.vistas === null ? undefined : `${fecha(b.cuando)}: ${num(b.vistas)} vistas`}
            >
              {/* un hueco no lleva ni barra ni cifra: la red no lo informó, no es un cero */}
              {b.vistas !== null && (
                <>
                  <span className="block h-full w-full max-w-6 origin-bottom rounded-t-chico bg-azul motion-safe:in-data-entra:animate-barra-crece" />
                  <span
                    data-final={i === ultima ? '' : undefined}
                    className="absolute bottom-full mb-1 whitespace-nowrap text-xs text-texto tabular-nums motion-safe:in-data-entra:animate-cifra-asoma"
                  >
                    {num(b.vistas)}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
        <div data-fechas="" className="mt-1 flex gap-1 text-xs text-secundario tabular-nums">
          {barras.map((b, i) => (
            <span key={b.cuando + '#' + i} className="flex w-16 min-w-0 shrink justify-center whitespace-nowrap">
              {diaCorto(b.cuando)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
