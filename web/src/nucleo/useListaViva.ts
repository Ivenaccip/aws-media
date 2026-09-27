// El prefijo «use» lo exige React (reglas de los hooks).
//
// Una lista que se trae al entrar y se sigue preguntando MIENTRAS algo de
// ella trabaja en la nube (un análisis, una revisión, un clip). Es el patrón
// de estilos, competencia y clip, con sus dos fallos distintos (M19, UI·16):
//
//   · sin red con algo vivo → `sinRed`: se sigue preguntando solo y la
//     pantalla dice «reintentando… tu trabajo sigue en la nube». Un fallo de
//     red NO mata el sondeo (antes una tarjeta se quedaba en «Analizando»
//     para siempre);
//   · sin red y nada vivo → `error`: se dice una vez, con Reintentar, y lo
//     que ya se enseñaba se queda.
//
// El sondeo usa la escalera de sondeo.ts y se duerme con la pestaña oculta.
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSondeo } from './useSondeo';

export interface ListaViva<T> {
  datos: T | null;
  /** Falló la carga sin nada vivo que esperar. */
  error: boolean;
  /** Falló la carga con algo vivo: se sigue reintentando solo. */
  sinRed: boolean;
  /** El último fallo (p. ej. un ErrorApi con el detalle del server); null al cargar bien. */
  fallo: unknown;
  /** Trae la lista ya (tras cobrar, tras Reintentar). */
  actualizar: () => Promise<void>;
  /** Cambiar los datos a mano (p. ej. con lo que devolvió un POST). */
  poner: (d: T) => void;
}

export interface OpcionesListaViva {
  /** Se llama cuando lo que trabajaba termina (p. ej. refrescar el saldo). */
  alTerminar?: () => void;
}

export function useListaViva<T>(
  cargar: () => Promise<T>,
  vivo: (d: T) => boolean,
  op: OpcionesListaViva = {},
): ListaViva<T> {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const [sinRed, setSinRed] = useState(false);
  const [fallo, setFallo] = useState<unknown>(null);
  const ref = useRef({ cargar, vivo, op, datos });
  useEffect(() => {
    ref.current = { cargar, vivo, op, datos };
  });

  const aplicar = useCallback((d: T): boolean => {
    const antes = ref.current.datos;
    ref.current.datos = d;
    setDatos(d);
    setError(false);
    setSinRed(false);
    setFallo(null);
    const sigue = ref.current.vivo(d);
    if (!sigue && antes !== null && ref.current.vivo(antes)) ref.current.op.alTerminar?.();
    return !sigue;
  }, []);

  const fallar = useCallback((e: unknown) => {
    setFallo(e);
    const d = ref.current.datos;
    if (d !== null && ref.current.vivo(d)) setSinRed(true);
    else setError(true);
  }, []);

  useEffect(() => {
    let vigente = true;
    ref.current.cargar().then(
      d => vigente && aplicar(d),
      (e: unknown) => vigente && fallar(e),
    );
    return () => {
      vigente = false;
    };
  }, [aplicar, fallar]);

  const tarea = useCallback(
    () =>
      ref.current.cargar().then(aplicar, (e: unknown) => {
        fallar(e);
        throw e;
      }),
    [aplicar, fallar],
  );

  useSondeo((datos !== null && vivo(datos)) || sinRed, tarea);

  const actualizar = useCallback(() => tarea().then(() => undefined, () => undefined), [tarea]);
  const poner = useCallback((d: T) => void aplicar(d), [aplicar]);

  return { datos, error, sinRed, fallo, actualizar, poner };
}
