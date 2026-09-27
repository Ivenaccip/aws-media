// El botón que gasta créditos: «Verbo ✦ N» y nada más (M21, docs/DISENO.md §5).
//
// Invariantes de dinero que este componente impone para todas las pantallas:
//   · cobro.boton_apagado_antes_de_await — el candado se cierra en el MISMO
//     tic del clic, antes de cualquier await: un doble clic es UNA petición.
//   · cobro.sin_saldo_no_cobra — si el saldo conocido no alcanza, el botón se
//     deshabilita y dice cuánto falta, con <Recarga> al lado.
import { useRef, useState } from 'react';

import { Boton } from '../ui/Boton';
import { ESTRELLA } from '../nucleo/estrella';
import { entero } from '../nucleo/formato';
import { Recarga } from './Recarga';
import type { Verbo } from './verbos';

export interface PropsBotonCobro {
  verbo: Verbo;
  costo: number;
  /** Saldo conocido. `null` = aún no se sabe: no se bloquea por él. */
  saldo?: number | null;
  /** Lo que cobra. El botón queda «trabajando» hasta que la promesa termine. */
  alCobrar: () => Promise<unknown>;
  /** Texto mientras trabaja. */
  trabajando?: string;
  deshabilitado?: boolean;
  /** Un solo principal por pantalla: el resto de lo que cobra va en secundario. */
  nivel?: 'principal' | 'secundario';
}

export function BotonCobro({
  verbo,
  costo,
  saldo = null,
  alCobrar,
  trabajando = 'Trabajando…',
  deshabilitado = false,
  nivel = 'principal',
}: PropsBotonCobro) {
  const candado = useRef(false);
  const [ocupado, setOcupado] = useState(false);
  const faltan = saldo !== null && saldo < costo ? costo - saldo : 0;

  async function cobrar() {
    if (candado.current || faltan || deshabilitado) return;
    candado.current = true;          // antes de cualquier await
    setOcupado(true);
    try {
      await alCobrar();
    } finally {
      candado.current = false;
      setOcupado(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Boton
        nivel={nivel}
        onClick={() => void cobrar()}
        disabled={deshabilitado || faltan > 0}
        trabajando={ocupado && trabajando}
      >
        {verbo} {ESTRELLA} {entero(costo)}
      </Boton>
      {faltan > 0 && (
        <span className="text-xs text-secundario">
          Te faltan {ESTRELLA} {entero(faltan)} · <Recarga className="text-xs" />
        </span>
      )}
    </span>
  );
}
