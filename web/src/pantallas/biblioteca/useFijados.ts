// Los fijados (el top 3 de cada quien): el estado optimista y su vuelta atrás.
//
// Cambiar la lista se VE al instante y se guarda con `PUT /api/biblioteca/fijados`, que REEMPLAZA la lista entera. Tres cosas que
// ese contrato exige cuidar:
//   · UNA petición a la vez. Si la persona sube, baja y quita seguido, las tres peticiones podrían llegar al servidor en otro
//     orden y ganaría la equivocada: mientras una vuela, los cambios nuevos solo actualizan lo que se quiere (`deseada`), y al
//     volver se manda la última (las del medio nunca salen);
//   · si falla, la pantalla vuelve a lo último que el servidor confirmó (`confirmada`), incluidos los cambios que se hicieron
//     mientras tanto, y lo dice. Nada queda enseñando un fijado que no se guardó;
//   · cada PUT dice sobre qué lista se basa (`esperada` = lo último que el servidor confirmó). Si otra pestaña o aparato la cambió, el
//     servidor no escribe y contesta 409 `cambiaron` con la lista vigente: la pantalla adopta ESA lista y lo dice (sin pisar en
//     silencio lo que se fijó en otra parte).
// Lo que el servidor devuelve manda: si omitió un id (el dueño quitó ese prompt de la casa), la lista se queda sin él.
import { useCallback, useEffect, useRef, useState } from 'react';

import { guardarFijados, mismos, textoDe, vigentesDe } from './logica';

export interface MandoFijados {
  /** Lo que se ve ahora (con lo optimista). */
  ids: string[];
  /** Lo que se quiere ahora, ya al día dentro de un mismo evento: dos clics seguidos parten de aquí, no de un render viejo. */
  leer: () => string[];
  /** Pone una lista nueva: se ve ya y se guarda. */
  cambiar: (nuevos: string[]) => void;
  /** Un prompt que ya no existe (se borró): sale de la lista sin pedir nada, porque el servidor ya lo sacó. */
  olvidar: (id: string) => void;
}

/** `alFallar(texto, alDia)`: `alDia` es que no fue un fallo sino un conflicto (409): la pantalla ya adoptó la lista vigente. */
export function useFijados(inicial: string[], alFallar: (texto: string, alDia: boolean) => void): MandoFijados {
  const [ids, setIds] = useState(inicial);
  const confirmada = useRef(inicial);
  const deseada = useRef(inicial);
  const enVuelo = useRef(false);
  const vivo = useRef(true);
  const falla = useRef(alFallar);
  useEffect(() => {
    falla.current = alFallar;
  });
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const vaciar = useCallback(async () => {
    if (enVuelo.current) return;
    enVuelo.current = true;
    try {
      while (!mismos(deseada.current, confirmada.current)) {
        const mandada = deseada.current;
        try {
          const r = await guardarFijados(mandada, confirmada.current);
          confirmada.current = r.fijados;
          // nadie cambió nada mientras volaba: se queda lo que dice el servidor (que puede traer menos ids)
          if (deseada.current === mandada) {
            deseada.current = r.fijados;
            if (vivo.current) setIds(r.fijados);
          }
        } catch (e) {
          // 409: otro aparato cambió los fijados mientras tanto; se adopta lo vigente que dice el servidor, no se pisa
          const vigentes = vigentesDe(e);
          if (vigentes) confirmada.current = vigentes;
          deseada.current = confirmada.current;
          if (vivo.current) {
            setIds(confirmada.current);
            falla.current(textoDe(e), vigentes !== null);
          }
          return;
        }
      }
    } finally {
      enVuelo.current = false;
    }
  }, []);

  const cambiar = useCallback(
    (nuevos: string[]) => {
      deseada.current = nuevos;
      setIds(nuevos);
      void vaciar();
    },
    [vaciar],
  );

  const olvidar = useCallback((id: string) => {
    const sin = (l: string[]) => l.filter(i => i !== id);
    confirmada.current = sin(confirmada.current);
    deseada.current = sin(deseada.current);
    setIds(deseada.current);
  }, []);

  const leer = useCallback(() => deseada.current, []);

  return { ids, leer, cambiar, olvidar };
}
