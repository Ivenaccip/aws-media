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
//
// UI·21: con `claves`, la lista sabe qué llegó nuevo (`nuevos`, para que
// entre abriendo su espacio en vez de empujar todo de golpe) y, si lo que ya
// estaba cambió de orden, pinta el cambio dentro de una View Transition de
// tipo «reordenar» (cada fila viaja de su lugar viejo al nuevo). La primera
// carga no anima nada.
import { useCallback, useEffect, useRef, useState } from 'react';

import { transicionar } from './transiciones';
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
  /** UI·21: las claves que llegaron en la última actualización (nunca en la primera carga). */
  nuevos: ReadonlySet<string>;
}

export interface OpcionesListaViva<T> {
  /** Se llama cuando lo que trabajaba termina (p. ej. refrescar el saldo). */
  alTerminar?: () => void;
  /** UI·21: la clave estable de cada fila, en el orden en que se pinta. */
  claves?: (d: T) => readonly string[];
}

export const NINGUNO: ReadonlySet<string> = new Set();

/** UI·21: qué filas son nuevas y si las que ya estaban cambiaron de orden.
 *  `antes` null es la primera carga: nada entra animado. */
export function diferencia(antes: readonly string[] | null, despues: readonly string[]) {
  if (antes === null) return { nuevos: NINGUNO, reordena: false };
  const estaban = new Set(antes);
  const quedan = new Set(despues);
  const a = antes.filter(id => quedan.has(id));
  const b = despues.filter(id => estaban.has(id));
  return { nuevos: new Set(despues.filter(id => !estaban.has(id))), reordena: a.some((id, i) => id !== b[i]) };
}

export function useListaViva<T>(
  cargar: () => Promise<T>,
  vivo: (d: T) => boolean,
  op: OpcionesListaViva<T> = {},
): ListaViva<T> {
  const [datos, setDatos] = useState<T | null>(null);
  const [nuevos, setNuevos] = useState<ReadonlySet<string>>(NINGUNO);
  const [error, setError] = useState(false);
  const [sinRed, setSinRed] = useState(false);
  const [fallo, setFallo] = useState<unknown>(null);
  const ref = useRef({ cargar, vivo, op });
  useEffect(() => {
    ref.current = { cargar, vivo, op };
  });
  // lo último que llegó. Aparte, y solo lo escribe aplicar: con el pintado
  // diferido de una transición, un render en medio no puede devolverlo a lo
  // viejo (el efecto de arriba corre tras cada render)
  const ultimo = useRef<T | null>(null);
  const turno = useRef(0);

  const aplicar = useCallback((d: T): boolean => {
    const antes = ultimo.current;
    ultimo.current = d;
    const t = ++turno.current;
    setError(false);
    setSinRed(false);
    setFallo(null);
    const claves = ref.current.op.claves;
    const dif = claves ? diferencia(antes === null ? null : claves(antes), claves(d)) : null;
    // con reordenamiento la transición anima también lo que entra: ese turno
    // no marca nuevos
    const pintar = () => {
      if (t !== turno.current) return; // lo pisó otro que llegó después
      setDatos(d);
      setNuevos(dif && !dif.reordena ? dif.nuevos : NINGUNO);
    };
    if (dif?.reordena) transicionar(pintar, ['reordenar']);
    else pintar();
    const sigue = ref.current.vivo(d);
    if (!sigue && antes !== null && ref.current.vivo(antes)) ref.current.op.alTerminar?.();
    return !sigue;
  }, []);

  const fallar = useCallback((e: unknown) => {
    setFallo(e);
    const d = ultimo.current;
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

  return { datos, error, sinRed, fallo, actualizar, poner, nuevos };
}
