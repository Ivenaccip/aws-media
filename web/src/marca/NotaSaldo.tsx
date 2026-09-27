// La nota bajo un botón que cobra: cuánto tienes y cuánto te queda después.
// El saldo en sí vive en la píldora de monedero.js (docs/DISENO.md §7); esto
// solo acompaña la decisión de gastar.
import { ESTRELLA } from '../nucleo/estrella';
import { entero } from '../nucleo/formato';

export interface PropsNotaSaldo {
  saldo: number | null;
  costo: number;
}

export function NotaSaldo({ saldo, costo }: PropsNotaSaldo) {
  if (saldo === null) return null;
  if (saldo < costo) return null;      // lo dice <BotonCobro>, no se repite
  return (
    <p className="m-0 text-xs text-secundario tabular-nums">
      Tienes {ESTRELLA} {entero(saldo)}; después te quedan {ESTRELLA} {entero(saldo - costo)}.
    </p>
  );
}
