// El prefijo «use» lo exige React (reglas de los hooks).
//
// La pestaña dice lo que pasa mientras la IA trabaja («Analizando el estilo ·
// …»): quien se fue a otra pestaña lo ve sin volver. null = el título de
// siempre, el del <title> de la página.
import { useEffect, useRef } from 'react';

export function useTituloPestana(estado: string | null): void {
  const base = useRef<string | null>(null);
  useEffect(() => {
    base.current ??= document.title;
    document.title = estado ? `${estado} · ${base.current}` : base.current;
  }, [estado]);
  // al desmontar, el título de siempre: si no, quien monte después (otro
  // proyecto en shorts) tomaría «Analizando… · Estudio…» como su base
  useEffect(
    () => () => {
      if (base.current !== null) document.title = base.current;
    },
    [],
  );
}
