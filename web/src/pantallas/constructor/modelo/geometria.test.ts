import { describe, expect, it } from 'vitest';

import { anchoLienzo } from './colocacion';
import { ALTO_CUADRO, ANCHO_CUADRO, MARGEN_LIENZO_X } from './datos/constantes';
import { ejemplo, muestras } from './ejemplos';
import {
  geometriaFlecha,
  INSIGNIA_LADO,
  MENU_ALTO_APP,
  MENU_ALTO_INICIO,
  MENU_ANCHO,
  posicionMenu,
  punta,
  scrollParaVer,
  type EntradaMenu,
  type GeometriaFlecha,
} from './geometria';
import { mulberry32 } from './prueba/semilla';
import type { Nodo, NodoAgente, NodoApp, Punto, TipoArista } from './tipos';

// ---------------------------------------------------------------- ayudas de la prueba

// (mulberry32 viene de prueba/semilla.ts: la comparten todas las pruebas con azar)

const agente = (id: string, x: number, y: number): NodoAgente => ({
  id,
  kind: 'agent',
  x,
  y,
  nombre: id,
  ia: 'openai',
  tarea: '',
  instrucciones: '',
});
const app = (id: string, x: number, y: number): NodoApp => ({ id, kind: 'app', x, y, nombre: 'Slack' });

/** Cada número de un trazo SVG, en orden. */
const numeros = (trazo: string): number[] => (trazo.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g) ?? []).map(Number);
/** Un trazo limpio: solo órdenes de SVG que usamos, números y espacios. */
const TRAZO_LIMPIO = /^[MCLz0-9eE+\-. ]+$/;

const sinSuciedad = (t: string) => !/NaN|undefined|Infinity|null|\[object/.test(t);

/** Lo que está mal en una geometría de flecha, como lista de frases (vacía = todo bien). Una sola aserción por flecha: son miles. */
function problemasDe(g: GeometriaFlecha): string[] {
  const p: string[] = [];
  if (!sinSuciedad(g.d)) p.push(`d sucio: ${g.d}`);
  if (!sinSuciedad(g.puntas)) p.push(`puntas sucias: ${g.puntas}`);
  if (!TRAZO_LIMPIO.test(g.d)) p.push(`d con signos raros: ${g.d}`);
  if (!TRAZO_LIMPIO.test(g.puntas)) p.push(`puntas con signos raros: ${g.puntas}`);
  const todos = [...numeros(g.d), ...numeros(g.puntas), g.medio.x, g.medio.y, g.insignia.x, g.insignia.y];
  if (!todos.every(Number.isFinite)) p.push('algún número no es finito');
  if (!Number.isInteger(g.medio.x) || !Number.isInteger(g.medio.y)) p.push('el centro de la insignia no es entero');
  if (g.insignia.x !== g.medio.x - INSIGNIA_LADO / 2 || g.insignia.y !== g.medio.y - INSIGNIA_LADO / 2) {
    p.push('la insignia no está centrada en el medio');
  }
  if (!['paso', 'conversan', 'herramienta'].includes(g.forma)) p.push(`forma rara: ${g.forma}`);
  return p;
}

function revisar(g: GeometriaFlecha, donde: string) {
  expect(problemasDe(g), donde).toEqual([]);
}

// ---------------------------------------------------------------- punta

describe('punta', () => {
  it('constructor.geometria.punta_es_un_triangulo_de_11_de_largo_y_5_de_semiancho_en_la_direccion_dada', () => {
    // las cuatro direcciones que usan las flechas (medidas con el código del mockup)
    expect(punta(100, 50, 1, 0)).toBe('M100 50L89 55L89 45z');
    expect(punta(100, 50, -1, 0)).toBe('M100 50L111 45L111 55z');
    expect(punta(100, 50, 0, 1)).toBe('M100 50L95 39L105 39z');
    expect(punta(100, 50, 0, -1)).toBe('M100 50L105 61L95 61z');
    // la longitud del vector no importa, solo hacia dónde apunta
    expect(punta(100, 50, 7, 0)).toBe(punta(100, 50, 1, 0));
    expect(punta(100, 50, 0, -0.01)).toBe(punta(100, 50, 0, -1));
    // oblicua: el triángulo mide 11 de la punta a la mitad de la base y 10 de esquina a esquina
    const [tx = 0, ty = 0, x1 = 0, y1 = 0, x2 = 0, y2 = 0] = numeros(punta(200, 120, 3, 4));
    expect([tx, ty]).toEqual([200, 120]);
    expect(Math.hypot(tx - (x1 + x2) / 2, ty - (y1 + y2) / 2)).toBeCloseTo(11, 9);
    expect(Math.hypot(x1 - x2, y1 - y2)).toBeCloseTo(10, 9);
    // la base es perpendicular a la dirección (3, 4)
    expect((x1 - x2) * 3 + (y1 - y2) * 4).toBeCloseTo(0, 9);
  });

  it('constructor.geometria.punta_sin_direccion_o_con_numeros_rotos_no_da_nan', () => {
    expect(punta(100, 50, 0, 0)).toBe('M100 50L100 50L100 50z');
    for (const [x, y, dx, dy] of [
      [Number.NaN, 5, 1, 0],
      [5, Number.POSITIVE_INFINITY, 1, 0],
      [5, 5, Number.NaN, Number.NaN],
      [5, 5, Number.POSITIVE_INFINITY, 0],
      [5, 5, 0, Number.NEGATIVE_INFINITY],
    ] as const) {
      const t = punta(x, y, dx, dy);
      expect(sinSuciedad(t), t).toBe(true);
      expect(t).toMatch(TRAZO_LIMPIO);
      expect(numeros(t).every(Number.isFinite)).toBe(true);
    }
    // el cero negativo no se escribe como «-0»
    expect(punta(0, 0, 1, 0)).not.toContain('-0');
  });
});

// ---------------------------------------------------------------- geometriaFlecha

describe('geometriaFlecha', () => {
  const ej = ejemplo();
  const nodo = (id: string) => {
    const n = ej.nodes.find(x => x.id === id);
    if (!n) throw new Error(id);
    return n;
  };
  const flecha = (tipo: TipoArista, de: Punto, a: Nodo) => geometriaFlecha({ tipo }, de, a);

  it('constructor.geometria.flecha_de_un_solo_sentido_sale_del_costado_derecho_y_la_insignia_va_al_70_por_ciento', () => {
    // medido con el código del mockup: (d, puntas, centro de la insignia)
    const e1 = flecha('seq', nodo('t1'), nodo('a1'));
    expect(e1).toEqual<GeometriaFlecha>({
      forma: 'paso',
      d: 'M224 228C268 228 268 228 312 228',
      puntas: 'M312 228L301 233L301 223z',
      medio: { x: 282, y: 228 },
      insignia: { x: 260, y: 206 },
    });
    const e2 = flecha('seq', nodo('a1'), nodo('a2'));
    expect(e2.d).toBe('M528 228C572 228 572 228 616 228');
    expect(e2.puntas).toBe('M616 228L605 233L605 223z');
    expect(e2.medio).toEqual({ x: 586, y: 228 });
    // hacia atrás o arriba (b antes que a): la curva se arquea, nada se rompe
    const atras = flecha('seq', app('p', 600, 500), app('q', 100, 100));
    revisar(atras, 'seq hacia atrás');
    expect(atras.d.startsWith('M816 548C')).toBe(true); // 600 + 216, 500 + 48
    expect(atras.d.endsWith(' 100 148')).toBe(true); // 100, 100 + 48
    // el control horizontal es la mitad de la distancia, con un mínimo de 40
    const pegado = flecha('seq', app('p', 0, 0), app('q', 217, 0));
    expect(pegado.d).toBe('M216 48C256 48 177 48 217 48');
    expect(flecha('seq', app('p', 0, 0), app('q', 616, 0)).d).toBe('M216 48C416 48 416 48 616 48');
  });

  it('constructor.geometria.flecha_de_ida_y_vuelta_entre_agentes_lleva_dos_puntas_y_la_insignia_en_el_medio', () => {
    const c = flecha('tool', nodo('a1'), nodo('a2')); // a2 es un agente: «conversan»
    expect(c).toEqual<GeometriaFlecha>({
      forma: 'conversan',
      d: 'M528 228C572 228 572 228 616 228',
      puntas: 'M616 228L605 233L605 223zM528 228L539 223L539 233z',
      medio: { x: 572, y: 228 },
      insignia: { x: 550, y: 206 },
    });
    // el mismo trazo que el de un solo sentido: lo que cambia son las puntas y el lugar de la insignia
    expect(c.d).toBe(flecha('seq', nodo('a1'), nodo('a2')).d);
    // la insignia está en el centro exacto (t = 0,5) de la curva: el punto medio entre los dos extremos
    const A = { x: 100, y: 80 };
    const B = agente('b', 700, 300);
    const g = geometriaFlecha({ tipo: 'tool' }, A, B);
    expect(g.medio).toEqual({
      x: Math.round((A.x + ANCHO_CUADRO + B.x) / 2),
      y: Math.round((A.y + ALTO_CUADRO / 2 + B.y + ALTO_CUADRO / 2) / 2),
    });
    // dos puntas, una hacia cada extremo
    expect(g.puntas.split('z').filter(Boolean)).toHaveLength(2);
    expect(g.puntas.startsWith(`M${B.x} ${B.y + 48}`)).toBe(true);
    expect(g.puntas).toContain(`M${A.x + ANCHO_CUADRO} ${A.y + 48}`);
  });

  it('constructor.geometria.flecha_de_herramienta_cuelga_por_debajo_encima_o_de_lado_segun_donde_quede_la_app', () => {
    const agenteA = nodo('a1'); // (312, 180)
    const casos: [string, number, number, string, string, number, number][] = [
      // [dónde queda la app, x, y, d, puntas, centro x, centro y] medido con el código del mockup
      ['debajo', 176, 380, 'M420 276C420 328 284 328 284 380', 'M420 276L425 287L415 287zM284 380L279 369L289 369z', 313, 344],
      ['encima', 176, 40, 'M420 180C420 140 284 176 284 136', 'M420 180L415 169L425 169zM284 136L289 147L279 147z', 313, 156],
      ['de lado (más abajo)', 344, 250, 'M420 276C420 367 452 437 452 346', 'M420 276L425 287L415 287zM452 346L457 357L447 357z', 445, 388],
      ['de lado (más arriba, a la izquierda)', 100, 100, 'M420 276C420 372 208 292 208 196', 'M420 276L425 287L415 287zM208 196L213 207L203 207z', 254, 274],
      ['misma columna, arriba', 312, 100, 'M420 276C420 372 420 292 420 196', 'M420 276L425 287L415 287zM420 196L425 207L415 207z', 420, 274],
      ['abajo y a la derecha', 600, 400, 'M420 276C420 338 708 338 708 400', 'M420 276L425 287L415 287zM708 400L703 389L713 389z', 646, 358],
      ['casi encima de su agente', 312, 300, 'M420 276C420 316 420 260 420 300', 'M420 276L425 287L415 287zM420 300L415 289L425 289z', 420, 285],
    ];
    for (const [donde, x, y, d, puntas, mx, my] of casos) {
      const g = flecha('tool', agenteA, app('p1', x, y));
      expect(g.forma, donde).toBe('herramienta');
      expect(g.d, donde).toBe(d);
      expect(g.puntas, donde).toBe(puntas);
      expect(g.medio, donde).toEqual({ x: mx, y: my });
      revisar(g, donde);
    }
    // las flechas de herramienta del ejemplo
    expect(flecha('tool', nodo('a2'), nodo('p2'))).toMatchObject({
      d: 'M724 276C724 328 588 328 588 380',
      medio: { x: 617, y: 344 },
    });
    // el borde exacto de «debajo» (16 px de aire) y de «encima»
    expect(flecha('tool', { x: 0, y: 0 }, app('p', 0, 96 + 16)).d).toBe('M108 96C108 136 108 72 108 112'); // debajo: sale por abajo, entra por arriba
    expect(flecha('tool', { x: 0, y: 200 }, app('p', 0, 200 - 96 - 16)).d.startsWith('M108 200C108 ')).toBe(true); // encima: sale por arriba
    expect(flecha('tool', { x: 0, y: 0 }, app('p', 0, 96 + 15)).d).not.toBe(flecha('tool', { x: 0, y: 0 }, app('p', 0, 96 + 16)).d);
  });

  it('constructor.geometria.flecha_la_insignia_esta_en_el_trazo_y_dentro_de_los_extremos', () => {
    // propiedades con semilla fija: la insignia (t = 0,7 o 0,5) cae entre los extremos
    const rng = mulberry32(55);
    for (let i = 0; i < 400; i += 1) {
      const A = { x: 8 * Math.floor(rng() * 300), y: 8 * Math.floor(rng() * 300) };
      const B = { x: 8 * Math.floor(rng() * 300), y: 8 * Math.floor(rng() * 300) };
      const paso = geometriaFlecha({ tipo: 'seq' }, A, app('b', B.x, B.y));
      const y1 = A.y + 48;
      const y2 = B.y + 48;
      // curva con los dos controles en la altura de sus extremos: en y nunca se sale del intervalo
      expect(paso.medio.y).toBeGreaterThanOrEqual(Math.min(y1, y2));
      expect(paso.medio.y).toBeLessThanOrEqual(Math.max(y1, y2));
      const conv = geometriaFlecha({ tipo: 'tool' }, A, agente('b', B.x, B.y));
      expect(conv.medio.y).toBeGreaterThanOrEqual(Math.min(y1, y2));
      expect(conv.medio.y).toBeLessThanOrEqual(Math.max(y1, y2));
      // en la herramienta la x es una mezcla 21,6 % / 78,4 % de las dos columnas centrales
      const herr = geometriaFlecha({ tipo: 'tool' }, A, app('b', B.x, B.y));
      const x1 = A.x + 108;
      const x2 = B.x + 108;
      expect(Math.abs(herr.medio.x - (0.216 * x1 + 0.784 * x2))).toBeLessThanOrEqual(0.5);
      // la curva empieza y termina en los extremos que dice la geometría
      const [sx, sy, , , , , ex, ey] = numeros(paso.d);
      expect([sx, sy, ex, ey]).toEqual([A.x + 216, y1, B.x, y2]);
    }
  });

  it('constructor.geometria.flecha_nunca_da_nan_ni_undefined_en_ninguna_posicion', () => {
    // 1) todas las parejas ordenadas de las posiciones del ejemplo, las muestras y los extremos del lienzo, de las tres clases
    const posiciones: Punto[] = [
      ...ej.nodes,
      ...muestras().flatMap(m => m.nodes),
      { x: 0, y: 0 },
      { x: 2400, y: 2400 },
      { x: 0, y: 2400 },
      { x: 2400, y: 0 },
      { x: 13, y: 7 },
    ];
    let n = 0;
    for (const A of posiciones) {
      for (const B of posiciones) {
        revisar(geometriaFlecha({ tipo: 'seq' }, A, app('b', B.x, B.y)), 'seq');
        revisar(geometriaFlecha({ tipo: 'tool' }, A, agente('b', B.x, B.y)), 'conversan');
        revisar(geometriaFlecha({ tipo: 'tool' }, A, app('b', B.x, B.y)), 'herramienta');
        n += 3;
      }
    }
    expect(n).toBeGreaterThan(1000);
    // 2) una malla alrededor de un cuadro: la app en cada lugar (también tocándose, también en la misma esquina)
    const centro = { x: 600, y: 600 };
    for (let dx = -900; dx <= 900; dx += 12) {
      for (let dy = -700; dy <= 700; dy += 20) {
        const B = { x: Math.max(0, centro.x + dx), y: Math.max(0, centro.y + dy) };
        revisar(geometriaFlecha({ tipo: 'tool' }, centro, app('b', B.x, B.y)), `malla ${dx},${dy}`);
        revisar(geometriaFlecha({ tipo: 'seq' }, centro, app('b', B.x, B.y)), `malla seq ${dx},${dy}`);
      }
    }
    // 3) al azar, con decimales y con posiciones rotas (NaN, infinitos, undefined por un tipo mal leído): cuentan como 0
    const rng = mulberry32(1234);
    const raro = () => (rng() < 0.1 ? [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY][Math.floor(rng() * 3)] ?? 0 : rng() * 2500);
    for (let i = 0; i < 600; i += 1) {
      const A = { x: raro(), y: raro() };
      const B = { x: raro(), y: raro() };
      for (const tipo of ['seq', 'tool'] as const) {
        for (const destino of [app('b', B.x, B.y), agente('b', B.x, B.y)]) revisar(geometriaFlecha({ tipo }, A, destino), 'raro');
      }
    }
  });
});

// ---------------------------------------------------------------- posicionMenu

describe('posicionMenu', () => {
  const entrada = (extra: Partial<EntradaMenu> = {}): EntradaMenu => ({
    ancla: { x: 312, y: 180 },
    tipo: 'seq',
    paso: 'inicio',
    medioInsertar: null,
    hayDespues: false,
    anchoLienzo: 1000,
    ...extra,
  });

  it('constructor.geometria.posicion_del_menu_sale_a_la_derecha_bajo_la_patita_o_bajo_la_insignia_segun_el_caso', () => {
    // lo que sigue: 292 px a la derecha del cuadro (250 si ya hay algo después) y 8 por encima
    expect(posicionMenu(entrada())).toEqual({ x: 604, y: 172, alto: MENU_ALTO_INICIO, fondo: 172 + 340 });
    expect(posicionMenu(entrada({ hayDespues: true }))).toEqual({ x: 562, y: 172, alto: 340, fondo: 512 });
    // herramienta: centrado bajo el cuadro (108 - 150 = -42) y 70 por debajo de su borde inferior; la pantalla de apps es más alta
    expect(posicionMenu(entrada({ tipo: 'tool', paso: 'app' }))).toEqual({ x: 270, y: 346, alto: MENU_ALTO_APP, fondo: 346 + 580 });
    // poner en medio: bajo la insignia de la flecha (150 a su izquierda, 24 abajo)
    expect(posicionMenu(entrada({ medioInsertar: { x: 586, y: 228 } }))).toEqual({ x: 436, y: 252, alto: 340, fondo: 592 });
    // si hay insignia manda sobre el tipo
    expect(posicionMenu(entrada({ tipo: 'tool', medioInsertar: { x: 586, y: 228 } })).x).toBe(436);
    expect([MENU_ANCHO, MENU_ALTO_APP, MENU_ALTO_INICIO]).toEqual([300, 580, 340]);
  });

  it('constructor.geometria.posicion_del_menu_no_se_sale_del_lienzo_por_la_izquierda_ni_por_la_derecha_ni_por_arriba', () => {
    // a la derecha: máximo anchoLienzo - 316 (el menú mide 300 y deja 16 de aire)
    expect(posicionMenu(entrada({ ancla: { x: 900, y: 100 } })).x).toBe(1000 - 316);
    expect(posicionMenu(entrada({ ancla: { x: 900, y: 100 }, anchoLienzo: 2000 })).x).toBe(1192);
    // a la izquierda: mínimo 8
    expect(posicionMenu(entrada({ ancla: { x: 0, y: 100 }, tipo: 'tool' })).x).toBe(8);
    expect(posicionMenu(entrada({ medioInsertar: { x: 40, y: 40 } })).x).toBe(8);
    // arriba: mínimo 8
    expect(posicionMenu(entrada({ ancla: { x: 0, y: 0 } })).y).toBe(8);
    expect(posicionMenu(entrada({ ancla: { x: 0, y: 0 } })).fondo).toBe(8 + 340);
    // un lienzo más angosto que el menú: gana el mínimo de 8 (como el mockup)
    expect(posicionMenu(entrada({ anchoLienzo: 200 })).x).toBe(8);
    // el fondo le dice al lienzo hasta dónde crecer para que quepa el menú
    expect(posicionMenu(entrada({ ancla: { x: 0, y: 2000 }, paso: 'app' })).fondo).toBe(2000 - 8 + 580);
  });

  it('constructor.geometria.posicion_del_menu_con_numeros_rotos_no_da_nan_y_con_semilla_siempre_queda_dentro', () => {
    const rotos = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const r of rotos) {
      const p = posicionMenu(entrada({ ancla: { x: r, y: r }, anchoLienzo: r, medioInsertar: null }));
      expect(Object.values(p).every(Number.isFinite)).toBe(true);
      const q = posicionMenu(entrada({ medioInsertar: { x: r, y: r } }));
      expect(Object.values(q).every(Number.isFinite)).toBe(true);
    }
    const rng = mulberry32(606);
    for (let i = 0; i < 400; i += 1) {
      const ancho = anchoLienzo([{ x: Math.floor(rng() * 2400), y: 0 }]);
      const p = posicionMenu(
        entrada({
          ancla: { x: Math.floor(rng() * 2400), y: Math.floor(rng() * 2400) },
          tipo: rng() < 0.5 ? 'seq' : 'tool',
          paso: rng() < 0.5 ? 'inicio' : 'app',
          hayDespues: rng() < 0.5,
          anchoLienzo: ancho,
          medioInsertar: rng() < 0.3 ? { x: Math.floor(rng() * 2600), y: Math.floor(rng() * 2600) } : null,
        }),
      );
      expect(p.x).toBeGreaterThanOrEqual(8);
      expect(p.x).toBeLessThanOrEqual(ancho - 316);
      expect(p.y).toBeGreaterThanOrEqual(8);
      expect(p.fondo).toBe(p.y + p.alto);
    }
  });
});

// ---------------------------------------------------------------- scrollParaVer

describe('scrollParaVer', () => {
  const marco = (scrollLeft: number, clientWidth = 800) => ({ scrollLeft, clientWidth });

  it('constructor.geometria.scroll_para_ver_deja_el_cuadro_visible_con_su_mas_a_la_derecha_y_algo_de_aire_a_la_izquierda', () => {
    // ya se ve (con su «+»: x + 216 + 112): no se mueve
    expect(scrollParaVer(marco(0), { x: 312, y: 180 })).toBe(0);
    expect(scrollParaVer(marco(0), { x: 800 - 216 - 112, y: 0 })).toBe(0); // justo cabe
    expect(scrollParaVer(marco(100), { x: 200, y: 0 })).toBe(100);
    // se sale por la derecha: el borde derecho del «+» queda al borde de la ventana
    expect(scrollParaVer(marco(0), { x: 616, y: 0 })).toBe(616 + 216 + 112 - 800);
    expect(scrollParaVer(marco(0), { x: 800 - 216 - 112 + 1, y: 0 })).toBe(1);
    expect(scrollParaVer(marco(200), { x: 700, y: 0 })).toBe(700 + 328 - 800);
    // se sale por la izquierda: con 24 de aire
    expect(scrollParaVer(marco(500), { x: 100, y: 0 })).toBe(76);
    expect(scrollParaVer(marco(100), { x: 124, y: 0 })).toBe(100); // izq = 100: justo
    expect(scrollParaVer(marco(100), { x: 123, y: 0 })).toBe(99);
    // nunca negativo
    expect(scrollParaVer(marco(50), { x: 10, y: 0 })).toBe(0);
    expect(scrollParaVer(marco(0, 100), { x: 0, y: 0 })).toBe(328 - 100);
    // la derecha manda si el cuadro es más ancho que la ventana
    expect(scrollParaVer(marco(0, 200), { x: 0, y: 0 })).toBe(328 - 200);
    expect(MARGEN_LIENZO_X).toBe(112);
  });

  it('constructor.geometria.scroll_para_ver_con_numeros_rotos_da_un_numero_y_con_semilla_el_cuadro_queda_a_la_vista', () => {
    for (const r of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      for (const [s, c, x] of [
        [r, 800, 300],
        [0, r, 300],
        [0, 800, r],
      ] as const) {
        expect(Number.isFinite(scrollParaVer(marco(s, c), { x, y: 0 }))).toBe(true);
      }
    }
    const rng = mulberry32(9);
    for (let i = 0; i < 400; i += 1) {
      const cw = 320 + Math.floor(rng() * 1200);
      const x = 8 * Math.floor(rng() * 300);
      const nuevo = scrollParaVer(marco(Math.floor(rng() * 1500), cw), { x, y: 0 });
      expect(nuevo).toBeGreaterThanOrEqual(0);
      // si el cuadro cabe en la ventana (con su «+» y su aire), después de desplazar se ve completo y ya no se vuelve a mover
      // (si no cabe, gana la derecha la primera vez y la izquierda la segunda: así lo hace el mockup)
      if (328 + 24 <= cw) {
        expect(nuevo).toBeLessThanOrEqual(x - 24 > 0 ? x - 24 : 0);
        expect(nuevo + cw).toBeGreaterThanOrEqual(x + 328);
        expect(scrollParaVer(marco(nuevo, cw), { x, y: 0 })).toBe(nuevo);
      }
    }
  });
});
