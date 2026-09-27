// «La IA está trabajando»: el orbe de static/orbe.js (M19) dentro de React.
// El orbe se queda como está (docs/PLAN-UI.md §4, fuera del alcance); esto
// solo lo monta, le pasa el texto y lo desmonta. Si la página no cargó
// /orbe.js, queda el texto con role=status: nadie depende del dibujo.
import { useEffect, useRef } from 'react';

import type { MandoOrbe } from '../nucleo/globales';

export interface PropsEsperaIA {
  texto: string;
  /** Milisegundos de silencio tras los que el orbe se apaga (el trabajo no). */
  tope?: number;
  /** Cambia cada vez que hay avance real: el orbe «late» y el tope reinicia. */
  latido?: number;
  heroe?: boolean;
}

export function EsperaIA({ texto, tope, latido, heroe = false }: PropsEsperaIA) {
  const hueco = useRef<HTMLSpanElement>(null);
  const mando = useRef<MandoOrbe | null>(null);
  const hayOrbe = typeof window !== 'undefined' && Boolean(window.orbe);

  useEffect(() => {
    if (!hueco.current || !window.orbe) return;
    const m = window.orbe.montar(hueco.current, {
      texto,
      ...(tope ? { tope } : {}),
      ...(heroe ? { forma: 'heroe' as const } : {}),
    });
    mando.current = m;
    return () => { m.desmontar(); mando.current = null; };
    // se monta una vez; el texto y el latido van por los efectos de abajo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroe, tope]);

  useEffect(() => { mando.current?.texto(texto); }, [texto]);
  useEffect(() => { if (latido !== undefined) mando.current?.latir(); }, [latido]);

  if (!hayOrbe) return <span role="status">{texto}</span>;
  return <span ref={hueco} />;
}
