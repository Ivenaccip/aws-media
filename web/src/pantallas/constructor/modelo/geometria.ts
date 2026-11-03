// La geometría del lienzo: la curva y las puntas de cada flecha, dónde va su insignia, dónde se
// abre el menú del «+» y cuánto hay que desplazar el lienzo para ver un cuadro. Funciones puras
// con las fórmulas del mockup (Main.dc.html:1186-1191 y 1707-1783). SOLO geometría: los colores,
// el grosor y el punteado los pone el componente con los tokens (el guardián de paleta no
// admite ningún color suelto en web/).
//
// Nada devuelve NaN ni undefined: un número que no es finito (una posición rota) cuenta como 0.
// Todos los textos de trazo (`d`, `puntas`) son de SVG (`M x y C …`, `…z`) y se pintan en un
// <path>; las puntas van como trazo APARTE porque un `marker` de SVG solo pinta el inicio y el
// final de todo el trazo, y las flechas «conversan» llevan dos puntas.

import { ALTO_CUADRO, ANCHO_CUADRO, MARGEN_LIENZO_X } from './datos/constantes';
import { estaDebajo, HOLGURA_DEBAJO } from './colocacion';
import type { Arista, MenuMas, Nodo, Punto, TipoArista } from './tipos';

/** El lado del botón (la insignia) que se pone en el medio de cada flecha: 44 px, el objetivo táctil mínimo. */
export const INSIGNIA_LADO = 44;
/** Cuánto mide una punta de flecha, a lo largo, en px. */
export const PUNTA_LARGO = 11;
/** Cuánto mide una punta de flecha de la mitad al borde, en px. */
export const PUNTA_MEDIO_ANCHO = 5;

/** El ancho del menú del «+», en px. */
export const MENU_ANCHO = 300;
/** El menú se separa al menos esto de los bordes del lienzo. */
export const MENU_MARGEN = 8;
/** Cuánto alto se le reserva al menú en la pantalla de elegir la app (la lista larga). */
export const MENU_ALTO_APP = 580;
/** Cuánto alto se le reserva al menú en la pantalla de inicio (app o agente). */
export const MENU_ALTO_INICIO = 340;

/** Un número que no es finito (NaN, ±Infinity) cuenta como 0, para que ninguna fórmula lo propague. */
const fin = (v: number): number => (Number.isFinite(v) ? v : 0);

/**
 * El trazo de una punta de flecha: un triángulo relleno de 11 px de largo y 5 de semiancho, con la
 * punta en (x, y) apuntando hacia (dx, dy). `(0, 0)` da un triángulo sin tamaño, no `NaN`.
 */
export function punta(x: number, y: number, dx: number, dy: number): string {
  const px0 = fin(x);
  const py0 = fin(y);
  const largo = Math.hypot(fin(dx), fin(dy)) || 1;
  const ux = fin(dx) / largo;
  const uy = fin(dy) / largo;
  const bx = px0 - ux * PUNTA_LARGO;
  const by = py0 - uy * PUNTA_LARGO;
  const px = -uy * PUNTA_MEDIO_ANCHO;
  const py = ux * PUNTA_MEDIO_ANCHO;
  return `M${px0} ${py0}L${bx + px} ${by + py}L${bx - px} ${by - py}z`;
}

/**
 * Qué clase de flecha es: `paso` (un solo sentido, de un lado a otro), `conversan` (ida y vuelta
 * entre dos agentes, en línea recta a la derecha) o `herramienta` (ida y vuelta de un agente a una
 * app, por la patita). El componente elige con esto el punteado y el ícono de la insignia.
 */
export type FormaFlecha = 'paso' | 'conversan' | 'herramienta';

/** Lo que hace falta para pintar una flecha. */
export interface GeometriaFlecha {
  forma: FormaFlecha;
  /** El trazo de la curva (`M x1 y1 C …`). */
  d: string;
  /** Las puntas (una o dos), como un solo trazo relleno. */
  puntas: string;
  /** El centro de la insignia, redondeado a px enteros. Lo usa también el menú de «Poner en medio». */
  medio: Punto;
  /** La esquina superior izquierda de la insignia de 44×44 (`medio` menos 22). */
  insignia: Punto;
}

/** Las puntas de arriba: el cuadro de destino necesita saber si es agente (entonces «conversan»). */
type CuadroConClase = Punto & { readonly kind: Nodo['kind'] };

/**
 * La curva, las puntas y el lugar de la insignia de la conexión `arista` de `A` a `B`:
 *  · `seq`, o `tool` hacia un agente («conversan»): sale del costado derecho de `A` y entra al
 *    izquierdo de `B`. La insignia va al 70 % del camino (cerca de la punta) en un solo sentido, y
 *    al 50 % si conversan (que además lleva punta en el origen);
 *  · `tool` hacia una app: sale por abajo (o por arriba) de `A` y entra por arriba (o por abajo) de
 *    `B`, según dónde quede la app; si queda al lado, la curva se acomoda con un arco. La insignia
 *    va al 70 %.
 */
export function geometriaFlecha(arista: Pick<Arista, 'tipo'>, A: Punto, B: CuadroConClase): GeometriaFlecha {
  const ax = fin(A.x);
  const ay = fin(A.y);
  const bxn = fin(B.x);
  const byn = fin(B.y);
  const conversan = arista.tipo === 'tool' && B.kind === 'agent';
  let d: string;
  let puntas: string;
  let mx: number;
  let my: number;
  if (arista.tipo === 'seq' || conversan) {
    const x1 = ax + ANCHO_CUADRO;
    const y1 = ay + ALTO_CUADRO / 2;
    const x2 = bxn;
    const y2 = byn + ALTO_CUADRO / 2;
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    d = `M${x1} ${y1}C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
    puntas = punta(x2, y2, 1, 0) + (conversan ? punta(x1, y1, -1, 0) : '');
    const tt = conversan ? 0.5 : 0.7;
    const u = 1 - tt;
    mx = u * u * u * x1 + 3 * u * u * tt * (x1 + dx) + 3 * u * tt * tt * (x2 - dx) + tt * tt * tt * x2;
    my = u * u * u * y1 + 3 * u * u * tt * y1 + 3 * u * tt * tt * y2 + tt * tt * tt * y2;
  } else {
    const debajo = estaDebajo({ x: ax, y: ay }, { x: bxn, y: byn });
    const encima = byn + ALTO_CUADRO + HOLGURA_DEBAJO <= ay;
    const nA = encima ? -1 : 1;
    const nB = debajo ? -1 : 1;
    const x1 = ax + ANCHO_CUADRO / 2;
    const y1 = encima ? ay : ay + ALTO_CUADRO;
    const x2 = bxn + ANCHO_CUADRO / 2;
    const y2 = encima ? byn + ALTO_CUADRO : debajo ? byn : byn + ALTO_CUADRO;
    const dd = debajo || encima ? Math.max(40, Math.abs(y2 - y1) / 2) : 56 + Math.abs(y2 - y1) / 2;
    d = `M${x1} ${y1}C${x1} ${y1 + nA * dd} ${x2} ${y2 + nB * dd} ${x2} ${y2}`;
    puntas = punta(x1, y1, 0, -nA) + punta(x2, y2, 0, -nB);
    mx = 0.216 * x1 + 0.784 * x2;
    my = 0.027 * y1 + 0.189 * (y1 + nA * dd) + 0.441 * (y2 + nB * dd) + 0.343 * y2;
  }
  const medio: Punto = { x: Math.round(fin(mx)), y: Math.round(fin(my)) };
  const forma: FormaFlecha = conversan ? 'conversan' : arista.tipo === 'seq' ? 'paso' : 'herramienta';
  return { forma, d, puntas, medio, insignia: { x: medio.x - INSIGNIA_LADO / 2, y: medio.y - INSIGNIA_LADO / 2 } };
}

/** Lo que hace falta para colocar el menú del «+». */
export interface EntradaMenu {
  /** El cuadro del que sale lo nuevo. */
  ancla: Punto;
  /** `seq` = lo que va después; `tool` = una herramienta del agente. */
  tipo: TipoArista;
  /** En qué pantalla del menú está (decide cuánto alto se le reserva). */
  paso: MenuMas['paso'];
  /** El `medio` de la flecha en cuyo medio se inserta (de `geometriaFlecha`), o null si no se inserta. */
  medioInsertar: Punto | null;
  /** ¿El ancla ya tiene algo que le sigue (una conexión `seq` saliente)? */
  hayDespues: boolean;
  /** El ancho del lienzo (de `anchoLienzo`), para que el menú no se salga por la derecha. */
  anchoLienzo: number;
}

/** Dónde queda el menú. */
export interface PosicionMenu {
  /** La esquina superior izquierda, entre 8 y `anchoLienzo − 316`. */
  x: number;
  /** Nunca menos de 8. */
  y: number;
  /** El alto reservado (580 en la pantalla de apps, 340 en la de inicio). */
  alto: number;
  /** Hasta dónde necesita llegar el lienzo hacia abajo para que quepa el menú (`y + alto`). */
  fondo: number;
}

/**
 * Dónde se abre el menú del «+»: al insertar en medio, debajo de la insignia (150 px a su izquierda,
 * 24 abajo); para una herramienta, bajo la patita del agente; para lo que sigue, a la derecha del
 * cuadro (292 px, o 250 si ya hay algo después, porque el «+» se vuelve un círculo más cerca).
 */
export function posicionMenu(entrada: EntradaMenu): PosicionMenu {
  const { ancla, tipo, paso, medioInsertar: m1 } = entrada;
  const ax = fin(ancla.x);
  const ay = fin(ancla.y);
  let px: number;
  let py: number;
  if (m1) {
    px = fin(m1.x) - 150;
    py = fin(m1.y) + 24;
  } else if (tipo === 'tool') {
    px = ax + ANCHO_CUADRO / 2 - 150;
    py = ay + ALTO_CUADRO + 70;
  } else {
    px = ax + (entrada.hayDespues ? 250 : 292);
    py = ay - 8;
  }
  const x = Math.max(MENU_MARGEN, Math.min(fin(entrada.anchoLienzo) - (MENU_ANCHO + 16), px));
  const y = Math.max(MENU_MARGEN, py);
  const alto = paso === 'app' ? MENU_ALTO_APP : MENU_ALTO_INICIO;
  return { x, y, alto, fondo: y + alto };
}

/**
 * Cuánto debe valer `scrollLeft` del marco del lienzo para que se vea el cuadro `nodo` (con su «+»
 * a la derecha y un poco de aire a la izquierda). Solo es horizontal. Si ya se ve, devuelve el
 * `scrollLeft` actual: quien lo llama solo asigna si cambió.
 */
export function scrollParaVer(marco: { readonly scrollLeft: number; readonly clientWidth: number }, nodo: Punto): number {
  const actual = fin(marco.scrollLeft);
  const visible = fin(marco.clientWidth);
  const der = fin(nodo.x) + ANCHO_CUADRO + MARGEN_LIENZO_X;
  const izq = fin(nodo.x) - 24;
  if (der > actual + visible) return Math.max(0, der - visible);
  if (izq < actual) return Math.max(0, izq);
  return actual;
}
