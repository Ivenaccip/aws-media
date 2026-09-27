// La caja de aviso (docs/DISENO.md §3): algo que conviene notar, sin ser error
// ni acción. Nunca texto ámbar suelto, que se confunde con el botón principal.
// El error va en rojo y solo para estados; el éxito, en verde.
import type { ReactNode } from 'react';

import { Icono } from './Icono';
import { unir } from './unir';

export type TipoAviso = 'aviso' | 'error' | 'exito';

const TIPO: Record<TipoAviso, { caja: string; icono: string; nombre: 'aviso' | 'listo' }> = {
  aviso: { caja: 'border-ambar-hondo bg-aviso-fondo', icono: 'text-ambar-claro', nombre: 'aviso' },
  error: { caja: 'border-peligro-borde bg-peligro-fondo', icono: 'text-error', nombre: 'aviso' },
  exito: { caja: 'border-linea bg-exito-fondo', icono: 'text-exito', nombre: 'listo' },
};

export function Aviso({ tipo = 'aviso', children }: { tipo?: TipoAviso; children: ReactNode }) {
  const t = TIPO[tipo];
  return (
    <div
      role={tipo === 'error' ? 'alert' : 'status'}
      className={unir('flex w-fit max-w-full items-start gap-2 rounded-medio border px-3 py-2', t.caja)}
    >
      <Icono nombre={t.nombre} className={unir('mt-[0.1em]', t.icono)} />
      <div>{children}</div>
    </div>
  );
}
