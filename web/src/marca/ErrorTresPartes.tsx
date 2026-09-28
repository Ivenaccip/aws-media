// UI·11 · carta §8, compartido desde UI·27: un error que ya cobró se cuenta
// en tres partes — qué pasó, qué pasó con tus créditos y qué sigue. Lo
// técnico (el texto crudo del servidor) queda plegado en «Detalles técnicos».
//
// «Tus créditos» solo sale si hay monedero (sin él no se habla de créditos,
// como en crear) y si quien lo usa sabe qué pasó con ellos: un error que no
// cobró (402, un dato mal escrito) no usa este bloque, va en su campo.
import type { ReactNode } from 'react';

import { Icono } from '../ui/Icono';
import { unir } from '../ui/unir';
import { useSaldo } from './useSaldo';

export interface PropsErrorTresPartes {
  /** Qué pasó, en palabras de persona («El render de tus shorts se detuvo.»). */
  paso: ReactNode;
  /** Qué pasó con tus créditos. Sin él (o sin monedero) no se dice nada. */
  creditos?: ReactNode;
  /** Qué sigue: lo que puedes hacer ahora. */
  sigue: ReactNode;
  /** El texto del servidor, plegado. */
  detalle?: string | null | undefined;
  /** 2 en una pantalla; 3 dentro de una tarjeta que ya tiene su h2. */
  nivel?: 2 | 3;
  /** Dentro de otra tarjeta: sin su propio borde ni fondo. */
  plano?: boolean;
  /** role="alert": para el error que llega solo (un sondeo), no el que la
   *  pantalla ya abre con él. */
  anunciar?: boolean;
  className?: string;
}

const SUBTITULO = 'm-0 mb-1 text-xs font-semibold uppercase tracking-[0.06em] text-secundario';

export function ErrorTresPartes({
  paso,
  creditos,
  sigue,
  detalle,
  nivel = 2,
  plano = false,
  anunciar = false,
  className,
}: PropsErrorTresPartes) {
  const conMonedero = useSaldo() !== null;
  const Titulo = nivel === 2 ? 'h2' : 'h3';
  const Sub = nivel === 2 ? 'h3' : 'h4';
  return (
    <section
      role={anunciar ? 'alert' : undefined}
      className={unir(!plano && 'rounded-grande border border-linea bg-superficie p-5', 'max-w-[720px]', className)}
    >
      <Titulo className="m-0 flex items-center gap-2.5 font-titulo text-titulo-sm font-bold">
        <Icono nombre="aviso" className="text-error" />
        Qué pasó
      </Titulo>
      <p className="mb-0 mt-1.5">{paso}</p>
      <div className="mt-4 grid gap-3.5">
        {creditos && conMonedero && (
          <div>
            <Sub className={SUBTITULO}>Tus créditos</Sub>
            <p className="m-0">{creditos}</p>
          </div>
        )}
        <div>
          <Sub className={SUBTITULO}>Qué sigue</Sub>
          <p className="m-0">{sigue}</p>
        </div>
      </div>
      {detalle && (
        <details className="mt-4">
          <summary className="flex min-h-11 cursor-pointer items-center text-secundario">Detalles técnicos</summary>
          <pre className="m-0 mt-2 whitespace-pre-wrap break-words rounded-medio bg-hundido p-2.5 text-xs text-secundario">
            {detalle}
          </pre>
        </details>
      )}
    </section>
  );
}
