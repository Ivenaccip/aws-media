// El foco nunca cae al <body>. Una tarjeta de clase cambia de forma sola (empieza una subida, termina, se cancela): el control
// que tenía el foco —el selector del video, «Cancelar», «Medir duración»— se desmonta, y el navegador deja el foco en <body>:
// quien navega con teclado o con lector de pantalla pierde su lugar y tiene que tabular desde arriba.
//
// Se pone el ref que devuelve este hook en cada control que puede desaparecer. Al desmontarse un control que TENÍA el foco, el foco
// pasa a `destino` (el título de la tarjeta, que no se desmonta). Si el foco estaba en otra parte —la persona ya se fue a otra
// tarjeta, o usa el ratón y nunca lo tuvo— no se toca: aquí no se le roba el foco a nadie.
//
// El aviso va en la limpieza del ref y no en un `blur`: al quitar un nodo del DOM los navegadores no mandan `blur`, y en ese
// momento el nodo todavía está puesto, así que `document.activeElement` aún lo señala.
import { useCallback, useEffect, useRef, type RefObject } from 'react';

export function useSalvarFoco(destino: RefObject<HTMLElement | null>) {
  const perdido = useRef(false);

  // después de cada pintado: si un control con el foco se fue, el foco va al destino (solo si de verdad cayó al body)
  useEffect(() => {
    if (!perdido.current) return;
    perdido.current = false;
    const ahora = document.activeElement;
    if (!ahora || ahora === document.body) destino.current?.focus();
  });

  return useCallback((el: HTMLElement | null) => {
    if (!el) return undefined;
    return () => {
      if (document.activeElement === el) perdido.current = true;
    };
  }, []);
}
