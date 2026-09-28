// Una tabla de datos: encabezados de verdad (<th scope>), título para el
// lector de pantalla y los números alineados a la derecha con cifras
// tabulares (docs/DISENO.md §2).
import type { ReactNode } from 'react';

export interface Columna<F> {
  clave: string;
  titulo: string;
  celda: (fila: F) => ReactNode;
  numerica?: boolean;
}

export interface PropsTablaDatos<F> {
  titulo: string;
  columnas: Columna<F>[];
  filas: F[];
  claveFila: (fila: F) => string;
  vacio?: ReactNode;
}

export function TablaDatos<F>({ titulo, columnas, filas, claveFila, vacio }: PropsTablaDatos<F>) {
  if (!filas.length && vacio) return <>{vacio}</>;
  // las cifras y los encabezados no se parten: «2.5 MB» en dos renglones no se lee
  const alinear = (c: Columna<F>) => (c.numerica ? 'text-right tabular-nums whitespace-nowrap' : 'text-left');
  return (
    <div className="overflow-x-auto rounded-grande border border-linea">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{titulo}</caption>
        <thead className="bg-superficie">
          <tr>
            {columnas.map(c => (
              <th key={c.clave} scope="col" className={'px-3 py-3 font-semibold whitespace-nowrap text-secundario ' + alinear(c)}>
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map(f => (
            <tr key={claveFila(f)} className="border-t border-linea">
              {columnas.map(c => (
                <td key={c.clave} className={'px-3 py-3 ' + alinear(c)}>{c.celda(f)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
