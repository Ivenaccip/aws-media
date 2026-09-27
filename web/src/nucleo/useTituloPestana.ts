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
}
