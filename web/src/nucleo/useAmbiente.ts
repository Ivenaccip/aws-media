// Dos cosas del entorno que cambian solas mientras la pantalla está abierta y que todo lo que se mueve con un reloj tiene que
// respetar:
//   · «reducir movimiento» del sistema (docs/DISENO.md §4: con la preferencia encendida todo queda quieto). La regla global de
//     tokens.css acorta las animaciones y transiciones de CSS, pero NO un reloj que cambia un texto cada cuatro segundos: eso
//     lo tiene que preguntar quien lo corre, y volver a preguntarlo si la persona cambia la preferencia con la pantalla abierta;
//   · si la pestaña está oculta. Un reloj que sigue corriendo donde nadie mira gasta batería y, al volver, deja la pantalla
//     en un cambio a medias.
// Las dos son `useSyncExternalStore`: leen el valor de verdad en cada render (nada se copia a un estado que pueda quedarse
// viejo) y se desuscriben solas al desmontar.
import { useSyncExternalStore } from 'react';

import { reduceMovimiento } from './transiciones';

function seguirMovimiento(avisar: () => void): () => void {
  // jsdom no tiene matchMedia: ahí nadie pide reducir nada y no hay a quién oír
  if (typeof matchMedia !== 'function') return () => undefined;
  const consulta = matchMedia('(prefers-reduced-motion: reduce)');
  consulta.addEventListener('change', avisar);
  return () => consulta.removeEventListener('change', avisar);
}

/** ¿El sistema pide reducir movimiento? Se vuelve a leer si la persona cambia la preferencia con la pantalla abierta. */
export function useMovimientoReducido(): boolean {
  return useSyncExternalStore(seguirMovimiento, reduceMovimiento, () => false);
}

function seguirPestana(avisar: () => void): () => void {
  document.addEventListener('visibilitychange', avisar);
  return () => document.removeEventListener('visibilitychange', avisar);
}

/** ¿La pestaña está oculta (otra pestaña al frente, ventana minimizada)? */
export function usePestanaOculta(): boolean {
  return useSyncExternalStore(seguirPestana, () => document.hidden, () => false);
}
