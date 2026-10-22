// Dónde cae un cuadro nuevo y qué tan grande es el lienzo. Puro: recibe los cuadros y devuelve
// puntos; no modifica nada. Portado de Main.dc.html:849-898 (rejilla, tamaño del lienzo, choque,
// lugar libre más cercano, a la derecha, debajo) y 1290-1311 (hueco para «Poner un cuadro en medio»).
//
// ORDEN DE ITERACIÓN (parte del contrato): `lugarLibreCerca` recorre la rejilla de 24 px con la
// `y` por fuera y la `x` por dentro, y se queda con el primero de los más cercanos (el empate lo
// gana el primero: la comparación es `<` estricto). `lugarDebajo` recorre 3 filas y, en cada una,
// los desplazamientos en el orden [-130, 130, -370, 370, -610, 610]. El golden de coordenadas
// depende de esto: cambiar el orden mueve cuadros que ya estaban guardados en un borrador.
//
// CONTRATO DE `huecoParaInsertar` («Poner un cuadro en medio») — AQUÍ SE CORRIGE el defecto 9.2-c
// del informe 04. El mockup, si no podía correr hacia la derecha lo que sigue, igual buscaba "el
// lugar libre más cercano", y ese podía caer a la derecha del destino: la flecha nueva salía hacia
// atrás. Ahora:
//   · primero intenta hacer lugar: si el destino queda a menos de 344 px del lugar del cuadro nuevo,
//     corre a la derecha el destino y todo lo que se alcanza desde él (solo si el origen no está
//     entre ellos, nada se sale del lienzo y lo corrido no cae sobre un cuadro que se queda);
//   · devuelve `{ nodes, lugar, corrido }` si el cuadro nuevo cabe EN MEDIO de verdad: `lugar` está
//     al menos `ANCHO_CUADRO + HOLGURA_FLECHA` a la derecha del origen, el destino (ya corrido, si
//     hizo falta) está al menos otro tanto a la derecha de `lugar`, y `lugar` no choca con nada;
//   · devuelve `null` si NO cabe: no se pudo correr lo que sigue y, sin correrlo, el cuadro nuevo
//     no queda entre los dos con las flechas hacia adelante. En ese caso NO se debe crear nada ni
//     tocar nada: el reductor avisa «No hay lugar en medio de esa conexión: mueve los cuadros de la
//     derecha y vuelve a intentarlo.»;
//   · cuando sí hay lugar, las coordenadas son idénticas a las del mockup (verificado contra su
//     código en miles de casos al azar). La única diferencia: donde el mockup dejaba la flecha
//     hacia atrás (o apretada a menos de 60 px) ahora hay `null`.

import {
  ALTO_CUADRO,
  ANCHO_CUADRO,
  HUECO_DERECHA,
  LIENZO_ALTO_MIN,
  LIENZO_ANCHO_MIN,
  MARGEN_CHOQUE,
  MARGEN_LIENZO_X,
  MARGEN_LIENZO_Y,
  REJILLA_BUSQUEDA,
  SNAP,
  X_MAX,
  Y_MAX,
} from './datos/constantes';
import type { Arista, Nodo, Punto } from './tipos';

/** Cuánto más que el ancho del cuadro debe haber entre un cuadro y el que va después para que la flecha se vea hacia adelante. */
export const HOLGURA_FLECHA = 60;
/** Cuánto más que el alto del cuadro debe haber entre un agente y su herramienta para que cuelgue debajo. */
export const HOLGURA_DEBAJO = 16;

/** Los desplazamientos (en x) con que se prueban los lugares de las herramientas de un agente, en este orden. El centro (0) se evita: lo ocupa el «+» de la patita. */
const DESPLAZAMIENTOS_HERRAMIENTA: readonly number[] = [-130, 130, -370, 370, -610, 610];
/** Cuántas filas de herramientas se prueban bajo un agente. */
const FILAS_HERRAMIENTA = 3;

const entre = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Redondea a la rejilla de 8 y deja entre 0 y el máximo del lienzo. (Un valor que no es número, `NaN`, cae en 0.) */
function aRejilla(v: number, max: number): number {
  if (Number.isNaN(v)) return 0;
  return entre(Math.round(v / SNAP) * SNAP, 0, max);
}

/** Ajusta un punto a la rejilla de 8 px y lo deja dentro del lienzo (0 a 2400 en cada eje). */
export function enRango(x: number, y: number): Punto {
  return { x: aRejilla(x, X_MAX), y: aRejilla(y, Y_MAX) };
}

/** El ancho que necesita el lienzo: hasta el «+» del cuadro más a la derecha (mínimo 1000). */
export function anchoLienzo(nodes: readonly Punto[]): number {
  return nodes.reduce((m, n) => Math.max(m, n.x + ANCHO_CUADRO + MARGEN_LIENZO_X), LIENZO_ANCHO_MIN);
}

/** El alto que necesita el lienzo: hasta la patita del cuadro más abajo (mínimo 780). */
export function altoLienzo(nodes: readonly Punto[]): number {
  return nodes.reduce((m, n) => Math.max(m, n.y + ALTO_CUADRO + MARGEN_LIENZO_Y), LIENZO_ALTO_MIN);
}

/** ¿Un cuadro puesto con su esquina en (x, y) pisaría a alguno de estos? (a menos de ancho+24 y alto+24). Al MOVER un cuadro que ya existe hay que quitarlo antes de la lista. */
export function choca(nodes: readonly Punto[], x: number, y: number): boolean {
  return nodes.some(n => Math.abs(n.x - x) < ANCHO_CUADRO + MARGEN_CHOQUE && Math.abs(n.y - y) < ALTO_CUADRO + MARGEN_CHOQUE);
}

/**
 * El lugar libre más cercano al punto que se quería (distancia euclídea, rejilla de 24 px; el
 * empate lo gana el primero en el recorrido: `y` por fuera, `x` por dentro). Si el punto
 * (ajustado a la rejilla de 8) ya está libre, es ese. Si no hay NINGÚN lugar libre devuelve ese
 * punto aunque choque.
 */
export function lugarLibreCerca(nodes: readonly Punto[], deseadoX: number, deseadoY: number): Punto {
  const t = enRango(deseadoX, deseadoY);
  if (!choca(nodes, t.x, t.y)) return t;
  let mejor: Punto | null = null;
  let md = Infinity;
  for (let y = 0; y <= Y_MAX; y += REJILLA_BUSQUEDA) {
    for (let x = 0; x <= X_MAX; x += REJILLA_BUSQUEDA) {
      if (choca(nodes, x, y)) continue;
      const d = (x - t.x) * (x - t.x) + (y - t.y) * (y - t.y);
      if (d < md) {
        md = d;
        mejor = { x, y };
      }
    }
  }
  return mejor ?? t;
}

/** Dónde cae lo que va DESPUÉS de `a`: 344 px a su derecha (ancho + 128), en el lugar libre más cercano. Si no hay hueco puede devolver un punto que no queda a la derecha. */
export function lugarALaDerecha(nodes: readonly Punto[], a: Punto): Punto {
  return lugarLibreCerca(nodes, a.x + HUECO_DERECHA, a.y);
}

/** ¿`b` cuelga debajo de `a` (es el caso de una herramienta de un agente)? */
export function estaDebajo(a: Punto, b: Punto): boolean {
  return b.y >= a.y + ALTO_CUADRO + HOLGURA_DEBAJO;
}

/** ¿`b` queda a la derecha de `a` con lugar para la flecha (el caso de un paso o de un ayudante)? */
export function estaALaDerecha(a: Punto, b: Punto): boolean {
  return b.x >= a.x + ANCHO_CUADRO + HOLGURA_FLECHA;
}

/**
 * Dónde cuelga una herramienta nueva de `a`: debajo de su patita, a los lados (el centro lo ocupa
 * el «+»), en la primera de 3 filas × 6 lugares que esté libre y quede debajo. Si no hay, el lugar
 * libre más cercano a (a.x + 130, a.y + 96 + 104), que puede no quedar «debajo».
 */
export function lugarDebajo(nodes: readonly Punto[], a: Punto): Punto {
  for (let fila = 0; fila < FILAS_HERRAMIENTA; fila += 1) {
    for (const dx of DESPLAZAMIENTOS_HERRAMIENTA) {
      const p = enRango(a.x + dx, a.y + ALTO_CUADRO + 104 + fila * (ALTO_CUADRO + 96));
      if (estaDebajo(a, p) && !choca(nodes, p.x, p.y)) return p;
    }
  }
  return lugarLibreCerca(nodes, a.x + 130, a.y + ALTO_CUADRO + 104);
}

/**
 * Los cuadros con `sigue` corridos `corre` px a la derecha, o null si no se puede: el origen
 * (`origenId`) es parte de lo que se correría, algo se saldría del lienzo, o lo corrido caería
 * sobre un cuadro que se queda.
 */
function correrLoQueSigue(
  nodes: readonly Nodo[],
  sigue: ReadonlySet<string>,
  origenId: string,
  corre: number,
): Nodo[] | null {
  if (sigue.has(origenId)) return null;
  if (nodes.some(n => sigue.has(n.id) && n.x + corre > X_MAX)) return null;
  const movidos = nodes.map<Nodo>(n => (sigue.has(n.id) ? { ...n, x: enRango(n.x + corre, n.y).x } : n));
  const quietos = movidos.filter(n => !sigue.has(n.id));
  if (movidos.some(n => sigue.has(n.id) && choca(quietos, n.x, n.y))) return null;
  return movidos;
}

/** Lo que devuelve `huecoParaInsertar` cuando sí hay lugar en medio. */
export interface HuecoParaInsertar {
  /** Los cuadros con el destino (y todo lo que cuelga de él) ya corridos a la derecha. Lista nueva; los cuadros que no se movieron son los mismos objetos. */
  nodes: Nodo[];
  /** Dónde va el cuadro nuevo. */
  lugar: Punto;
  /** Cuántos px se corrió lo que sigue (0 si no hizo falta). */
  corrido: number;
}

/**
 * Hace lugar para poner un cuadro nuevo EN MEDIO de la conexión `seq` `aristaVieja` (de `A` a `D`):
 * lo ubica 344 px a la derecha de `A` y, si `D` queda a menos de 344 px de ahí, corre a la derecha
 * `D` y todo lo que se alcanza desde él por cualquier conexión (menos la vieja). Ver el contrato en
 * el encabezado: devuelve `null` si el cuadro nuevo no cabe entre los dos con las flechas hacia
 * adelante (el reductor avisa y no crea nada). `edges` debe incluir la conexión vieja; `nodes`
 * incluye a `A` y a `D`.
 */
export function huecoParaInsertar(
  nodes: readonly Nodo[],
  edges: readonly Arista[],
  A: Punto & { readonly id: string },
  D: Punto & { readonly id: string },
  aristaVieja: Pick<Arista, 'id'>,
): HuecoParaInsertar | null {
  const x0 = enRango(A.x + HUECO_DERECHA, A.y).x;
  const corre = Math.max(0, x0 + HUECO_DERECHA - D.x);
  // todo lo que sigue a D: él y lo que se alcanza desde él por cualquier conexión, salvo la que se reemplaza
  const sigue = new Set([D.id]);
  for (let crece = true; crece; ) {
    crece = false;
    for (const e of edges) {
      if (e.id !== aristaVieja.id && sigue.has(e.de) && !sigue.has(e.a)) {
        sigue.add(e.a);
        crece = true;
      }
    }
  }
  let base: readonly Nodo[] = nodes;
  let corrido = 0;
  if (corre > 0) {
    const movidos = correrLoQueSigue(nodes, sigue, A.id, corre);
    if (movidos) {
      base = movidos;
      corrido = corre;
    }
  }
  const lugar = lugarLibreCerca(base, x0, A.y);
  const destino = base.find(n => n.id === D.id) ?? D;
  const enMedio = estaALaDerecha(A, lugar) && estaALaDerecha(lugar, destino);
  if (!enMedio || choca(base, lugar.x, lugar.y)) return null;
  return { nodes: [...base], lugar, corrido };
}
