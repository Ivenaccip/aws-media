// «Guardado» (UI·24): el «listo» de un formulario, en el lugar donde se
// guardó (el botón, la nota de al lado), no en un aviso que flota en una
// esquina. La palomita se dibuja trazo a trazo y el texto llega con el
// resorte; con «reducir movimiento» aparecen ya terminados.
//
// Se anuncia (role=status) y no toca el foco. Dentro de una región que ya
// anuncia (una nota role=status que cambia de «Guardando…» a «Guardado»),
// va con anuncia={false}: dos regiones anidadas leen dos veces.
import type { ReactNode } from 'react';

import { Icono } from './Icono';
import { unir } from './unir';

export interface PropsGuardado {
  children?: ReactNode;
  /** Ya estaba guardado (al abrir, al volver): el mismo «listo», quieto y
   *  callado. Lo que se dibuja y se anuncia es lo que se acaba de guardar. */
  quieto?: boolean;
  /** false si ya está dentro de una región role=status. */
  anuncia?: boolean;
  className?: string;
}

export function Guardado({ children = 'Guardado', quieto = false, anuncia = !quieto, className }: PropsGuardado) {
  return (
    <span role={anuncia ? 'status' : undefined} className={unir('inline-flex items-center gap-2', className)}>
      <Icono nombre="listo" dibujar={!quieto} className="text-exito" />
      <span className={quieto ? undefined : 'motion-safe:animate-guardado-llega'}>{children}</span>
    </span>
  );
}
