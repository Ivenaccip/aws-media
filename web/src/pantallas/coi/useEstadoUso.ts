// El contador de COI: lo que dice el SERVIDOR (`GET /api/coi/estado`) y nada más. La web no cuenta usos por su cuenta ni calcula la
// medianoche de México con el reloj del navegador: pide el estado, y lo vuelve a pedir en los momentos en que puede haber cambiado.
//
//   · al abrir;
//   · mientras haya «otra en curso»: cada 4 s (el candado del servidor caduca solo, a los 60 s);
//   · ya usaste los 3: cada minuto con la pestaña a la vista, para que «Faltan X h Y min» lo siga diciendo el servidor;
//   · cuando se cumplen los `renueva_en_s` que dijo el servidor (es una DURACIÓN, no una hora del reloj): ahí cambia el día;
//   · al volver a la pestaña o recuperar la conexión, si hace rato que no se pregunta.
import { useCallback, useEffect, useRef, useState } from 'react';

import { cargarEstado, falloDe, type EstadoUso, type Fallo } from './logica';

const CADA_EN_CURSO_MS = 4000;
const CADA_AGOTADO_MS = 60_000;
/** Un `setTimeout` no admite más de 2^31 − 1 ms: un día entero (el tope de la renovación) cabe de sobra. */
const MARGEN_RENOVACION_MS = 1500;
/** Al volver a la pestaña no se pregunta si se preguntó hace menos que esto. */
const SIN_PREGUNTAR_MS = 30_000;

export interface EstadoDeUso {
  estado: EstadoUso | null;
  /** Por qué no se pudo leer el estado (sin conexión, no disponible); null si se leyó bien. */
  error: Fallo | null;
  cargando: boolean;
  /** Vuelve a preguntar. Devuelve el estado nuevo, o null si no se pudo leer. */
  recargar: () => Promise<EstadoUso | null>;
  /** Pone el estado que acaba de traer otra respuesta del servidor (el POST de COI lleva usos y quedan). */
  poner: (cambio: Partial<EstadoUso>) => void;
}

export function useEstadoUso(): EstadoDeUso {
  const [estado, setEstado] = useState<EstadoUso | null>(null);
  const [error, setError] = useState<Fallo | null>(null);
  const [cargando, setCargando] = useState(true);
  const ultima = useRef<number>(0);
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const recargar = useCallback(async (): Promise<EstadoUso | null> => {
    try {
      const e = await cargarEstado();
      if (!vivo.current) return null;
      ultima.current = performance.now();
      setEstado(e);
      setError(null);
      setCargando(false);
      return e;
    } catch (err) {
      if (!vivo.current) return null;
      // si ya se sabía algo, se sigue mostrando lo último que dijo el servidor; el error solo se dice cuando no hay nada
      setError(falloDe(err));
      setCargando(false);
      return null;
    }
  }, []);

  // al abrir
  useEffect(() => {
    // el primer vistazo corre fuera del render: así el setState de recargar no cae dentro del efecto
    const t = setTimeout(() => void recargar(), 0);
    return () => clearTimeout(t);
  }, [recargar]);

  const enCurso = estado?.en_curso === true;
  const agotado = estado !== null && estado.quedan <= 0;
  const renueva = estado?.renueva_en_s;

  // otra en curso: sondea hasta que el servidor suelte el candado
  useEffect(() => {
    if (!enCurso) return;
    const t = setInterval(() => void recargar(), CADA_EN_CURSO_MS);
    return () => clearInterval(t);
  }, [enCurso, recargar]);

  // ya usaste los 3: el «Faltan…» lo calcula el servidor; se le pregunta cada minuto, con la pestaña a la vista
  useEffect(() => {
    if (!agotado) return;
    const t = setInterval(() => {
      if (!document.hidden) void recargar();
    }, CADA_AGOTADO_MS);
    return () => clearInterval(t);
  }, [agotado, recargar]);

  // se cumplió lo que dijo el servidor: puede haber cambiado el día. `estado` (el objeto) cambia con cada respuesta: el plazo se rearma
  useEffect(() => {
    if (renueva === undefined) return;
    const t = setTimeout(() => void recargar(), Math.max(0, renueva) * 1000 + MARGEN_RENOVACION_MS);
    return () => clearTimeout(t);
  }, [estado, renueva, recargar]);

  // volver a la pestaña o recuperar la conexión
  useEffect(() => {
    const alVolver = () => {
      if (document.hidden) return;
      if (performance.now() - ultima.current < SIN_PREGUNTAR_MS) return;
      void recargar();
    };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('online', alVolver);
    return () => {
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('online', alVolver);
    };
  }, [recargar]);

  const poner = useCallback((cambio: Partial<EstadoUso>) => {
    ultima.current = performance.now();
    setEstado(antes => (antes ? { ...antes, ...cambio } : antes));
  }, []);

  return { estado, error, cargando, recargar, poner };
}
