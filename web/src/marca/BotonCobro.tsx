// El botón que gasta créditos: «Verbo ✦ N» y nada más (M21, docs/DISENO.md §5).
//
// Invariantes de dinero que este componente impone para todas las pantallas:
//   · cobro.boton_apagado_antes_de_await — el candado se cierra en el MISMO
//     tic del clic, antes de cualquier await: un doble clic es UNA petición.
//   · cobro.sin_saldo_no_cobra — si el saldo conocido no alcanza, el botón se
//     deshabilita y dice cuánto falta, con <Recarga> al lado.
//
// UI·19: si `alCobrar` resuelve `true` (el servidor aceptó el cobro), avisa a
// monedero.js, que dibuja «−N» saliendo de este botón hacia la píldora. Con
// cualquier otra cosa (un 402, un veto, una validación) no vuela nada: un
// «−N» que no se cobró sería mentir sobre dinero. Si después del cobro la
// pantalla todavía espera algo lento (bajar la imagen, releer la lista),
// llama al `cobrado()` que recibe justo cuando el servidor acepta: el «−N»
// sale entonces, a la par del saldo que baja, y no segundos después.
import { useRef, useState } from 'react';

import { Boton } from '../ui/Boton';
import { ESTRELLA } from '../nucleo/estrella';
import { entero } from '../nucleo/formato';
import { Recarga } from './Recarga';
import { avisarCobro } from './useSaldo';
import type { Verbo } from './verbos';

export interface PropsBotonCobro {
  verbo: Verbo;
  costo: number;
  /** Saldo conocido. `null` = aún no se sabe: no se bloquea por él. */
  saldo?: number | null;
  /** Lo que cobra. El botón queda «trabajando» hasta que la promesa termine.
   *  Resuelve `true` SOLO si el servidor aceptó el cobro (UI·19); o llama a
   *  `cobrado()` en cuanto lo acepte, si aún le falta algo lento. */
  alCobrar: (cobrado: () => void) => Promise<boolean | void>;
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
  const boton = useRef<HTMLButtonElement>(null);
  const [ocupado, setOcupado] = useState(false);
  const faltan = saldo !== null && saldo < costo ? costo - saldo : 0;

  async function cobrar() {
    if (candado.current || faltan || deshabilitado) return;
    candado.current = true;          // antes de cualquier await
    // dónde estaba al tocarlo: si el cobro lo desmonta, el «−N» sale de ahí
    const antes = boton.current?.getBoundingClientRect() ?? null;
    setOcupado(true);
    let volo = false;   // un cobro, un «−N»
    const cobrado = () => {
      if (volo) return;
      volo = true;
      const b = boton.current;
      avisarCobro(costo, b?.isConnected ? b.getBoundingClientRect() : antes);
    };
    try {
      if ((await alCobrar(cobrado)) === true) cobrado();
    } finally {
      candado.current = false;
      setOcupado(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Boton
        ref={boton}
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
