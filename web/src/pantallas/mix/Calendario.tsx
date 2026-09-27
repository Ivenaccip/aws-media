// El calendario de la campaña: dos meses, un clic marca el inicio y el
// siguiente el fin, con la banda en medio. Lunes primero, que es como se lee
// un calendario en español.
//
// Mientras falta el día de fin, lo que pasa del tope no se puede pulsar: es
// más honesto que dejarlo elegir y contestarle «son 74 días» después.
import { useEffect, useRef, useState } from 'react';

import { Boton } from '../../ui/Boton';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import { fechaLarga, hoy as hoyIso, iso, mesMas, primeroDeMes, suma } from './logica';

export interface PropsCalendario {
  ini: string | null;
  fin: string | null;
  maxDias: number;
  alElegir: (dia: string) => void;
  alLimpiar: () => void;
}

const SEMANA = (() => {
  const lunes = new Date(2024, 0, 1); // un lunes cualquiera
  return Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, lunes.getDate() + i).toLocaleDateString('es-MX', { weekday: 'short' }).replace(/\.$/, ''),
  );
})();

/** «Septiembre de 2026»: solo la primera en mayúscula. */
function nombreMes(d: Date): string {
  const t = d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function Calendario({ ini, fin, maxDias, alElegir, alLimpiar }: PropsCalendario) {
  const hoy = hoyIso();
  const [mes, setMes] = useState(() => primeroDeMes(ini && ini >= hoy ? ini : hoy));
  const [encima, setEncima] = useState<string | null>(null);
  // la banda tentativa se apaga al salir del calendario con el mouse
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = caja.current;
    const fuera = () => setEncima(null);
    el?.addEventListener('mouseleave', fuera);
    return () => el?.removeEventListener('mouseleave', fuera);
  }, []);
  const hasta = fin ?? (ini && encima && encima > ini ? encima : ini);
  const tope = ini && !fin ? suma(ini, maxDias - 1) : null;
  // no se retrocede más allá del mes en curso: ahí ya no hay nada que elegir
  const primero = iso(mes) <= iso(primeroDeMes(hoy));

  function mesVista(inicio: Date, segundo = false) {
    const y = inicio.getFullYear();
    const m = inicio.getMonth();
    const cuantos = new Date(y, m + 1, 0).getDate();
    const arranque = (new Date(y, m, 1).getDay() + 6) % 7; // 0 = lunes
    return (
      <div className={unir('min-w-0 flex-1', segundo && 'hidden md:block')}>
        <h3 className="m-0 mb-2 text-center text-sm font-semibold">{nombreMes(inicio)}</h3>
        <div className="grid grid-cols-7 gap-y-1 text-center text-xs text-secundario" aria-hidden="true">
          {SEMANA.map(d => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-y-1">
          {Array.from({ length: arranque }, (_, i) => (
            <span key={'h' + i} />
          ))}
          {Array.from({ length: cuantos }, (_, i) => {
            const d = iso(new Date(y, m, i + 1));
            const esIni = d === ini;
            const esFin = !!hasta && d === hasta;
            const dentro = !!ini && !!hasta && d > ini && d < hasta;
            const apagado = d < hoy || (!!tope && d > tope);
            return (
              <button
                key={d}
                type="button"
                aria-label={fechaLarga(d)}
                aria-pressed={esIni || esFin || dentro}
                disabled={apagado}
                onClick={() => {
                  setEncima(null);
                  alElegir(d);
                }}
                onMouseEnter={() => ini && !fin && setEncima(d)}
                // elegir no es ámbar: los extremos en blanco y la banda en gris
                className={unir(
                  'h-11 cursor-pointer border-0 text-sm tabular-nums disabled:cursor-default',
                  esIni || esFin
                    ? 'rounded-medio bg-texto font-semibold text-fondo'
                    : dentro
                      ? 'bg-elevada text-texto'
                      : 'bg-transparent text-texto hover:enabled:bg-elevada disabled:text-campo',
                  d === hoy && !esIni && !esFin && 'underline underline-offset-4',
                )}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div ref={caja}>
      <div className="mb-3 flex items-center gap-2">
        <Boton nivel="secundario" denso aria-label="Mes anterior" disabled={primero} onClick={() => setMes(x => mesMas(x, -1))}>
          <Icono nombre="izquierda" />
        </Boton>
        <Boton nivel="secundario" denso aria-label="Mes siguiente" onClick={() => setMes(x => mesMas(x, 1))}>
          <Icono nombre="derecha" />
        </Boton>
        <span className="flex-1" />
        <Boton nivel="secundario" denso onClick={alLimpiar}>
          Borrar las fechas
        </Boton>
      </div>
      <div className="flex gap-6">
        {mesVista(mes)}
        {mesVista(mesMas(mes, 1), true)}
      </div>
    </div>
  );
}
