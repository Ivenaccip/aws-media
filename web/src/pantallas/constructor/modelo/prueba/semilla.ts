// Azar con SEMILLA para las pruebas de propiedades del reductor (reductor.propiedades.test.ts). Sin
// `Math.random`: la misma semilla da siempre la misma corrida, así un fallo se repite con solo
// volver a pasar la semilla (y el número de secuencia). Solo para pruebas: nada de producción lo importa.

/** Un generador con semilla (mulberry32). Devuelve números en [0, 1). */
export function mulberry32(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Un entero en [0, n). Con `n <= 0` devuelve 0. */
export function entero(rng: () => number, n: number): number {
  return n <= 0 ? 0 : Math.floor(rng() * n);
}

/** Un elemento al azar de una lista que no está vacía. */
export function elegir<V>(rng: () => number, lista: readonly V[]): V {
  if (lista.length === 0) throw new Error('elegir: la lista está vacía');
  return lista[entero(rng, lista.length)] as V;
}

/** Un elemento de una lista con pesos `[valor, peso]` (los pesos pueden ser decimales; los que valen 0 o menos no salen). */
export function elegirConPeso<V>(rng: () => number, lista: readonly (readonly [V, number])[]): V {
  const util = lista.filter(([, peso]) => peso > 0);
  const ultimo = util[util.length - 1];
  if (!ultimo) throw new Error('elegirConPeso: no hay nada con peso');
  const total = util.reduce((suma, [, peso]) => suma + peso, 0);
  let r = rng() * total;
  for (const [valor, peso] of util) {
    r -= peso;
    if (r < 0) return valor;
  }
  return ultimo[0];
}

/** La semilla de la secuencia número `indice` de una campaña (cada campaña y cada secuencia tienen la suya, siempre la misma). */
export function semillaDeSecuencia(semilla: number, campana: number, indice: number): number {
  return (semilla + indice * 7919 + (campana + 1) * 104729) >>> 0;
}
