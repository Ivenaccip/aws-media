import { describe, expect, it } from 'vitest';

import {
  ALTO_CUADRO,
  ANCHO_CUADRO,
  LIENZO_ALTO_MIN,
  LIENZO_ANCHO_MIN,
  TOPE_AGENTES,
  TOPE_APPS,
  X_MAX,
  Y_MAX,
} from './datos/constantes';
import {
  altoLienzo,
  anchoLienzo,
  choca,
  enRango,
  estaALaDerecha,
  estaDebajo,
  HOLGURA_DEBAJO,
  HOLGURA_FLECHA,
  huecoParaInsertar,
  lugarALaDerecha,
  lugarDebajo,
  lugarLibreCerca,
} from './colocacion';
import { ejemplo } from './ejemplos';
import { invariantesDelGrafo, puedeEnlazar } from './grafo';
import { mulberry32 } from './prueba/semilla';
import type { Arista, Nodo, NodoApp, Punto } from './tipos';

// ---------------------------------------------------------------- ayudas de la prueba

// (mulberry32 viene de prueba/semilla.ts: la comparten todas las pruebas con azar)
const entero = (rng: () => number, n: number) => Math.floor(rng() * n);

function congelar<T>(v: T): T {
  if (v !== null && typeof v === 'object') {
    for (const hijo of Object.values(v)) congelar(hijo);
    Object.freeze(v);
  }
  return v;
}

const app = (id: string, x: number, y: number, nombre = 'Zendesk'): NodoApp => ({ id, kind: 'app', x, y, nombre });
const aristaN = (id: string, de: string, a: string, tipo: Arista['tipo']): Arista => ({ id, de, a, tipo });
const pos = (nodes: readonly Nodo[]) => nodes.map(n => [n.id, n.x, n.y]);
const nodo = (nodes: readonly Nodo[], id: string): Nodo => {
  const n = nodes.find(x => x.id === id);
  if (!n) throw new Error(`no hay ${id}`);
  return n;
};

/** Los cuadros pegados de la rejilla de 24 que no chocan con ninguno: lo mismo que el recorrido, escrito aparte (para comparar el desempate). */
function referenciaCerca(nodes: readonly Punto[], dx: number, dy: number): Punto {
  const aRejilla = (v: number) => Math.max(0, Math.min(2400, Math.round(v / 8) * 8));
  const t = { x: aRejilla(dx), y: aRejilla(dy) };
  const libre = (x: number, y: number) => nodes.every(n => !(Math.abs(n.x - x) < 240 && Math.abs(n.y - y) < 120));
  if (libre(t.x, t.y)) return t;
  const candidatos: { x: number; y: number; d: number }[] = [];
  for (let y = 0; y <= 2400; y += 24) {
    for (let x = 0; x <= 2400; x += 24) {
      if (libre(x, y)) candidatos.push({ x, y, d: (x - t.x) ** 2 + (y - t.y) ** 2 });
    }
  }
  // menor distancia; a igual distancia, el primero del recorrido (y menor, y a igual y, x menor)
  candidatos.sort((p, q) => p.d - q.d || p.y - q.y || p.x - q.x);
  const mejor = candidatos[0];
  return mejor ? { x: mejor.x, y: mejor.y } : t;
}

// ---------------------------------------------------------------- reglas simples

describe('rejilla, tamaño del lienzo y choque', () => {
  it('constructor.colocacion.en_rango_ajusta_a_la_rejilla_de_8_y_limita_al_lienzo', () => {
    const casos: [number, number, number, number][] = [
      [0, 0, 0, 0],
      [3, 4, 0, 8], // 4/8 = 0,5 sube
      [180, 180, 184, 184], // 22,5 sube a 23
      [179, 183, 176, 184],
      [312, 380, 312, 384],
      [-50, -3, 0, 0],
      [-4, -4, 0, 0],
      [2399, 2399, 2400, 2400],
      [2404, 2412, 2400, 2400],
      [5000, 9999, 2400, 2400],
      [2396, 2395, 2400, 2392],
      [Number.NaN, Number.NaN, 0, 0],
      [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2400, 0],
      [7.9999, 8.0001, 8, 8],
    ];
    for (const [x, y, ex, ey] of casos) {
      const r = enRango(x, y);
      expect(r, `enRango(${x}, ${y})`).toEqual({ x: ex, y: ey });
      // ni -0 ni NaN: los valores se pueden comparar y escribir sin sorpresas
      expect(Object.is(r.x, -0) || Object.is(r.y, -0)).toBe(false);
    }
    // idempotente y siempre múltiplo de 8 dentro del lienzo (propiedad con semilla fija)
    const rng = mulberry32(8);
    for (let i = 0; i < 500; i += 1) {
      const p = enRango((rng() - 0.2) * 3000, (rng() - 0.2) * 3000);
      expect(enRango(p.x, p.y)).toEqual(p);
      expect(p.x % 8).toBe(0);
      expect(p.y % 8).toBe(0);
      expect(p.x >= 0 && p.x <= X_MAX && p.y >= 0 && p.y <= Y_MAX).toBe(true);
    }
  });

  it('constructor.colocacion.ancho_y_alto_del_lienzo_crecen_hasta_el_ultimo_cuadro_con_minimos_de_1000_y_780', () => {
    expect(anchoLienzo([])).toBe(LIENZO_ANCHO_MIN);
    expect(altoLienzo([])).toBe(LIENZO_ALTO_MIN);
    expect([anchoLienzo([]), altoLienzo([])]).toEqual([1000, 780]);
    // el ejemplo cabe en el mínimo: a2 llega a 616 + 216 + 112 = 944; p1/p2 a 380 + 96 + 168 = 644
    const ej = ejemplo().nodes;
    expect(anchoLienzo(ej)).toBe(1000);
    expect(altoLienzo(ej)).toBe(780);
    // crece a la derecha: el «+» de la derecha del cuadro más lejano (x + 216 + 112) y la patita (y + 96 + 168)
    expect(anchoLienzo([...ej, app('q', 800, 0)])).toBe(1128);
    expect(altoLienzo([...ej, app('q', 0, 600)])).toBe(864);
    expect(anchoLienzo([app('q', 2400, 0)])).toBe(2728);
    expect(altoLienzo([app('q', 0, 2400)])).toBe(2664);
    // justo en el límite no crece
    expect(anchoLienzo([app('q', 1000 - 216 - 112, 0)])).toBe(1000);
    expect(altoLienzo([app('q', 0, 780 - 96 - 168)])).toBe(780);
    expect(anchoLienzo([app('q', 1000 - 216 - 112 + 1, 0)])).toBe(1001);
  });

  it('constructor.colocacion.choca_compara_con_menor_estricto_ancho_mas_24_y_alto_mas_24', () => {
    const uno: Punto[] = [{ x: 100, y: 100 }];
    expect(choca([], 0, 0)).toBe(false);
    expect(choca(uno, 100, 100)).toBe(true);
    expect(choca(uno, 100 + 239, 100 + 119)).toBe(true);
    expect(choca(uno, 100 - 239, 100 - 119)).toBe(true);
    // a 240 de ancho o a 120 de alto ya no choca (los dos ejes tienen que estar cerca)
    expect(choca(uno, 100 + 240, 100)).toBe(false);
    expect(choca(uno, 100 - 240, 100)).toBe(false);
    expect(choca(uno, 100, 100 + 120)).toBe(false);
    expect(choca(uno, 100, 100 - 120)).toBe(false);
    expect(choca(uno, 100 + 239, 100 + 120)).toBe(false);
    expect(choca(uno, 100 + 240, 100 + 119)).toBe(false);
    // basta con uno de varios
    expect(choca([{ x: 0, y: 0 }, { x: 900, y: 900 }], 800, 850)).toBe(true);
    // el ejemplo está bien repartido: ningún cuadro choca con otro
    const ej = ejemplo().nodes;
    for (const n of ej) expect(choca(ej.filter(o => o.id !== n.id), n.x, n.y), n.id).toBe(false);
    expect([ANCHO_CUADRO + 24, ALTO_CUADRO + 24]).toEqual([240, 120]);
  });

  it('constructor.colocacion.esta_debajo_y_esta_a_la_derecha_marcan_los_limites_de_16_y_60', () => {
    expect([HOLGURA_DEBAJO, HOLGURA_FLECHA]).toEqual([16, 60]);
    const a = { x: 312, y: 180 };
    expect(estaDebajo(a, { x: 0, y: 180 + 96 + 16 })).toBe(true);
    expect(estaDebajo(a, { x: 0, y: 180 + 96 + 15 })).toBe(false);
    expect(estaDebajo(a, { x: 312, y: 180 })).toBe(false);
    expect(estaALaDerecha(a, { x: 312 + 216 + 60, y: 0 })).toBe(true);
    expect(estaALaDerecha(a, { x: 312 + 216 + 59, y: 0 })).toBe(false);
    expect(estaALaDerecha(a, { x: 100, y: 180 })).toBe(false);
  });
});

// ---------------------------------------------------------------- lugar libre más cercano

describe('lugarLibreCerca, lugarALaDerecha y lugarDebajo', () => {
  const ej = ejemplo().nodes;
  const conQ = [...ej, app('q', 500, 200)];

  it('constructor.colocacion.lugar_libre_cerca_da_el_punto_ajustado_si_esta_libre_y_los_goldens_del_mockup_si_no', () => {
    // si el punto (ajustado a la rejilla de 8) está libre, es ese
    expect(lugarLibreCerca([], 3, 4)).toEqual({ x: 0, y: 8 });
    expect(lugarLibreCerca(ej, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(lugarLibreCerca(ej, 2400, 2400)).toEqual({ x: 2400, y: 2400 });
    expect(lugarLibreCerca(ej, 1000, 500)).toEqual({ x: 1000, y: 504 }); // 1000 está libre: no se mueve de columna
    // si choca, el libre más cercano de la rejilla de 24 (coordenadas medidas con el código del mockup)
    const goldens: [string, readonly Nodo[], number, number, number, number][] = [
      ['ejemplo', ej, 312, 180, 312, 48],
      ['ejemplo', ej, 616, 180, 624, 48],
      ['ejemplo', ej, 8, 180, 0, 48],
      ['ejemplo', ej, 700, 300, 720, 312],
      ['ejemplo', ej, 500, 200, 504, 48],
      ['ejemplo', ej, 180, 380, 192, 504],
      ['ejemplo+q', conQ, 700, 300, 720, 336],
      ['ejemplo+q', conQ, 500, 200, 504, 48],
      ['ejemplo+q', conQ, 312, 180, 312, 48],
    ];
    for (const [nombre, nodes, x, y, ex, ey] of goldens) {
      expect(lugarLibreCerca(nodes, x, y), `${nombre} (${x}, ${y})`).toEqual({ x: ex, y: ey });
    }
  });

  it('constructor.colocacion.lugar_libre_cerca_desempata_con_el_primero_del_recorrido_y_coincide_con_una_busqueda_aparte', () => {
    // empate real (medido en el mockup): un cuadro solo; arriba y abajo hay un libre a la misma distancia.
    // Gana el de la fila de arriba (y menor): el recorrido tiene la y por fuera y el empate no reemplaza
    expect(lugarLibreCerca([{ x: 304, y: 192 }], 304, 192)).toEqual({ x: 312, y: 72 });
    expect(lugarLibreCerca([{ x: 320, y: 192 }], 320, 192)).toEqual({ x: 312, y: 72 });
    expect(lugarLibreCerca([{ x: 1200, y: 1200 }], 1200, 1200)).toEqual({ x: 1200, y: 1080 });
    // empates entre puntos que difieren en x Y en y (medidos en el mockup): gana el de la fila de arriba aunque
    // el otro esté más a la izquierda; con el recorrido al revés (x por fuera) saldría el otro
    expect(lugarLibreCerca([{ x: 192, y: 24 }], 312, 24)).toEqual({ x: 432, y: 24 }); // empata con (312, 144)
    expect(lugarLibreCerca([{ x: 168, y: 192 }, { x: 192, y: 0 }], 264, 168)).toEqual({ x: 408, y: 168 }); // con (264, 312)
    expect(lugarLibreCerca([{ x: 192, y: 264 }, { x: 192, y: 48 }, { x: 144, y: 144 }], 216, 168)).toEqual({ x: 432, y: 168 }); // con (216, 384)
    // sin empate: el único más cercano
    expect(lugarLibreCerca([{ x: 312, y: 180 }], 312, 180)).toEqual({ x: 312, y: 312 });
    expect(lugarLibreCerca([{ x: 0, y: 0 }], 0, 0)).toEqual({ x: 0, y: 120 });
    // y contra una búsqueda escrita aparte (menor distancia, luego y menor, luego x menor), con semilla fija
    const rng = mulberry32(2024);
    for (let i = 0; i < 40; i += 1) {
      const nodes: Punto[] = Array.from({ length: 1 + entero(rng, 13) }, () => ({ x: 8 * entero(rng, 120), y: 8 * entero(rng, 100) }));
      const dx = 8 * entero(rng, 130) - 20 + (rng() < 0.3 ? 3 : 0);
      const dy = 8 * entero(rng, 110) - 20;
      expect(lugarLibreCerca(nodes, dx, dy), JSON.stringify([nodes, dx, dy])).toEqual(referenciaCerca(nodes, dx, dy));
    }
  });

  it('constructor.colocacion.lugar_libre_cerca_devuelve_el_punto_deseado_aunque_choque_si_el_lienzo_esta_lleno', () => {
    // 11 columnas × 21 filas de cuadros a 240 × 120: ningún punto de la rejilla queda libre
    const lleno: Punto[] = [];
    for (let x = 0; x <= 2400; x += 240) for (let y = 0; y <= 2400; y += 120) lleno.push({ x, y });
    expect(lleno).toHaveLength(231);
    expect(lugarLibreCerca(lleno, 500, 700)).toEqual({ x: 504, y: 704 });
    expect(lugarLibreCerca(lleno, -100, 9999)).toEqual({ x: 0, y: 2400 });
  });

  it('constructor.colocacion.lugar_a_la_derecha_cae_344_px_a_la_derecha_en_el_lugar_libre_mas_cercano', () => {
    expect(lugarALaDerecha(ej, nodo(ej, 'a2'))).toEqual({ x: 960, y: 184 });
    // pisado por a2/p2: el más cercano libre (medido en el mockup)
    expect(lugarALaDerecha(ej, nodo(ej, 'a1'))).toEqual({ x: 648, y: 48 });
    expect(lugarALaDerecha(ej, nodo(ej, 't1'))).toEqual({ x: 360, y: 48 });
    expect(lugarALaDerecha(ej, nodo(ej, 'p2'))).toEqual({ x: 824, y: 384 });
    // el cuadro desde el que se parte ni siquiera tiene que estar en la lista
    expect(lugarALaDerecha([], { x: 312, y: 180 })).toEqual({ x: 656, y: 184 });
  });

  it('constructor.colocacion.lugar_debajo_prueba_3_filas_por_6_lugares_en_orden_y_cae_en_el_mas_cercano_si_no_hay', () => {
    const a1 = nodo(ej, 'a1');
    expect(lugarDebajo(ej, a1)).toEqual({ x: 920, y: 384 });
    expect(lugarDebajo(ej, nodo(ej, 'a2'))).toEqual({ x: 744, y: 384 });
    expect(lugarDebajo([], { x: 312, y: 180 })).toEqual({ x: 184, y: 384 });
    // el orden de los primeros 12 lugares (3 filas × 6 menos los repetidos por el límite), medido en el mockup:
    // se van llenando de a uno y cada nuevo cuadro ocupa el siguiente
    const esperados: [number, number][] = [
      [184, 384],
      [440, 384],
      [680, 384],
      [920, 384],
      [184, 576],
      [440, 576],
      [680, 576],
      [920, 576],
      [184, 768],
      [440, 768],
      [680, 768],
      [920, 768],
      // con las 3 filas llenas ya no hay "debajo": cae en el libre más cercano a (a.x + 130, a.y + 200)
      [552, 264],
      [552, 144],
      [312, 48],
      [792, 264],
      [552, 24],
      [72, 264],
      [792, 144],
      [72, 144],
    ];
    let nodes: Nodo[] = [a1];
    const obtenidos: [number, number][] = [];
    for (let i = 0; i < esperados.length; i += 1) {
      const p = lugarDebajo(nodes, a1);
      obtenidos.push([p.x, p.y]);
      nodes = [...nodes, app(`h${i}`, p.x, p.y)];
    }
    expect(obtenidos).toEqual(esperados);
    // cada uno de los primeros 12 cuelga debajo de su agente
    for (const [, y] of esperados.slice(0, 12)) expect(estaDebajo(a1, { x: 0, y })).toBe(true);
  });

  it('constructor.colocacion.crecer_hasta_los_topes_deja_los_cuadros_donde_los_dejo_el_mockup_y_sin_encimar', () => {
    // la secuencia del harness del mockup (sección 4): desde a1, 6 veces «agente a la derecha» y 12 veces «app debajo»,
    // con los topes de 4 agentes y 8 apps (los ids no importan aquí)
    let nodes: Nodo[] = ejemplo().nodes;
    const a1 = nodo(nodes, 'a1');
    let cuenta = 20;
    for (let i = 0; i < 6; i += 1) {
      if (nodes.filter(n => n.kind === 'agent').length >= TOPE_AGENTES) continue;
      cuenta += 1;
      const p = lugarALaDerecha(nodes, a1);
      nodes = [...nodes, { id: `a${cuenta}`, kind: 'agent', ...p, nombre: '', ia: 'openai', tarea: '', instrucciones: '' }];
    }
    for (let i = 0; i < 12; i += 1) {
      if (nodes.filter(n => n.kind === 'app').length >= TOPE_APPS) continue;
      cuenta += 1;
      nodes = [...nodes, app(`p${cuenta}`, lugarDebajo(nodes, a1).x, lugarDebajo(nodes, a1).y, 'Notion')];
    }
    expect(pos(nodes)).toEqual([
      ['t1', 8, 180],
      ['a1', 312, 180],
      ['a2', 616, 180],
      ['p1', 176, 380],
      ['p2', 480, 380],
      ['a21', 648, 48],
      ['a22', 720, 312],
      ['p23', 184, 576],
      ['p24', 440, 576],
      ['p25', 680, 576],
      ['p26', 920, 576],
      ['p27', 184, 768],
      ['p28', 440, 768],
    ]);
    // 13 cuadros, ninguno encima de otro y todos dentro del lienzo
    expect(nodes).toHaveLength(13);
    for (const n of nodes) {
      expect(choca(nodes.filter(o => o.id !== n.id), n.x, n.y), n.id).toBe(false);
      expect(n.x >= 0 && n.x <= X_MAX && n.y >= 0 && n.y <= Y_MAX).toBe(true);
    }
    expect(altoLienzo(nodes)).toBeGreaterThanOrEqual(768 + 96 + 168);
  });

  it('constructor.colocacion.no_modifica_lo_que_recibe', () => {
    const f = congelar(ejemplo());
    expect(() => {
      lugarLibreCerca(f.nodes, 312, 180);
      lugarALaDerecha(f.nodes, f.nodes[1] ?? { x: 0, y: 0 });
      lugarDebajo(f.nodes, f.nodes[1] ?? { x: 0, y: 0 });
      anchoLienzo(f.nodes);
      altoLienzo(f.nodes);
      choca(f.nodes, 0, 0);
      huecoParaInsertar(f.nodes, f.edges, nodo(f.nodes, 'a1'), nodo(f.nodes, 'a2'), { id: 'e2' });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------- poner un cuadro en medio

describe('huecoParaInsertar', () => {
  const ej = ejemplo();
  const hueco = (nodes: Nodo[], edges: Arista[], id: string) => {
    const e = edges.find(x => x.id === id);
    if (!e) throw new Error(`no hay la conexión ${id}`);
    return huecoParaInsertar(nodes, edges, nodo(nodes, e.de), nodo(nodes, e.a), e);
  };

  it('constructor.colocacion.hueco_para_insertar_corre_lo_que_sigue_y_da_las_coordenadas_del_mockup', () => {
    // t1 → a1 → a2 con p1 (herramienta de a1) y p2 (herramienta de a2). Insertar entre a1 y a2:
    // el nuevo va 344 px a la derecha de a1 (656) y a2 y su herramienta se corren 384
    const h1 = hueco(ej.nodes, ej.edges, 'e2');
    expect(h1).not.toBeNull();
    expect(h1?.lugar).toEqual({ x: 656, y: 184 });
    expect(h1?.corrido).toBe(384);
    expect(pos(h1?.nodes ?? [])).toEqual([
      ['t1', 8, 180],
      ['a1', 312, 180],
      ['a2', 1000, 180],
      ['p1', 176, 380],
      ['p2', 864, 380],
    ]);
    // insertar entre el disparador y a1: se corre TODO lo que cuelga de a1 (a2, y las herramientas de los dos)
    const h2 = hueco(ej.nodes, ej.edges, 'e1');
    expect(h2?.lugar).toEqual({ x: 352, y: 184 });
    expect(h2?.corrido).toBe(384);
    expect(pos(h2?.nodes ?? [])).toEqual([
      ['t1', 8, 180],
      ['a1', 696, 180],
      ['a2', 1000, 180],
      ['p1', 560, 380],
      ['p2', 864, 380],
    ]);
    // si el destino ya está lejos no hace falta correr nada
    const lejos: Nodo[] = [ej.nodes[0] as Nodo, { ...(ej.nodes[1] as Nodo), x: 1000 }];
    const h3 = hueco(lejos, [aristaN('e1', 't1', 'a1', 'seq')], 'e1');
    expect(h3?.lugar).toEqual({ x: 352, y: 184 });
    expect(h3?.corrido).toBe(0);
    expect(pos(h3?.nodes ?? [])).toEqual([
      ['t1', 8, 180],
      ['a1', 1000, 180],
    ]);
    // un destino a la izquierda (flecha ya hacia atrás) se corrige: se corre 900 y la flecha queda hacia adelante
    const atras = ej.nodes.map(n => (n.id === 'a2' ? { ...n, x: 100, y: 500 } : n));
    const h8 = hueco(atras, ej.edges, 'e2');
    expect(h8?.lugar).toEqual({ x: 656, y: 184 });
    expect(h8?.corrido).toBe(900);
    expect(pos(h8?.nodes ?? [])).toEqual([
      ['t1', 8, 180],
      ['a1', 312, 180],
      ['a2', 1000, 500],
      ['p1', 176, 380],
      ['p2', 1384, 380],
    ]);
    // una cadena larga detrás del destino se corre completa y por parejo
    const largo: Nodo[] = [
      ej.nodes[0] as Nodo,
      { ...(ej.nodes[1] as Nodo), id: 'a1' },
      { ...(ej.nodes[2] as Nodo), id: 'a2', x: 400 },
      app('p1', 800, 180, 'Slack'),
      app('p2', 1200, 180, 'Gmail'),
    ];
    const cadena = [
      aristaN('e1', 't1', 'a1', 'seq'),
      aristaN('e2', 'a1', 'a2', 'seq'),
      aristaN('e3', 'a2', 'p1', 'seq'),
      aristaN('e4', 'p1', 'p2', 'seq'),
    ];
    const h9 = hueco(largo, cadena, 'e2');
    expect(h9?.lugar).toEqual({ x: 656, y: 184 });
    expect(h9?.corrido).toBe(600);
    expect(pos(h9?.nodes ?? [])).toEqual([
      ['t1', 8, 180],
      ['a1', 312, 180],
      ['a2', 1000, 180],
      ['p1', 1400, 180],
      ['p2', 1800, 180],
    ]);
    // solo se mueven los cuadros que cambiaron; los demás son los mismos objetos
    expect(h1?.nodes[0]).toBe(ej.nodes[0]);
    expect(h1?.nodes[1]).toBe(ej.nodes[1]);
    expect(h1?.nodes[3]).toBe(ej.nodes[3]);
    expect(h1?.nodes[2]).not.toBe(ej.nodes[2]);
    expect(h1?.nodes).not.toBe(ej.nodes);
    // y la lista de entrada queda como estaba
    expect(pos(ej.nodes)[2]).toEqual(['a2', 616, 180]);
  });

  it('constructor.colocacion.hueco_para_insertar_devuelve_null_si_no_se_puede_correr_lo_que_sigue_y_no_cabe_en_medio', () => {
    // CORRECCIÓN del defecto 9.2-c. En cada caso el mockup creaba el cuadro igual y lo dejaba a la derecha de su
    // destino (flecha hacia atrás); aquí no se hace nada y el reductor avisa.
    // (1) una app suelta impide correr a2: el mockup dejaba el cuadro nuevo en (648, 48) con a2 en 616
    const bloqueada = [...ej.nodes, app('q', 1000, 280)];
    expect(hueco(bloqueada, ej.edges, 'e2')).toBeNull();
    // (2) lo mismo con la suelta pegada a la derecha de a2
    expect(hueco([...ej.nodes, app('q', 1000, 310)], ej.edges, 'e2')).toBeNull();
    // (3) algo de lo que sigue se saldría del lienzo: el mockup dejaba el nuevo en (648, 312)
    const sinLugar = ej.nodes.map(n => (n.id === 'p2' ? { ...n, x: 2100 } : n));
    expect(hueco(sinLugar, ej.edges, 'e2')).toBeNull();
    // (4) el origen es parte de lo que habría que correr (un grafo que no debería existir, pero puede llegar de afuera)
    expect(hueco(ej.nodes, [...ej.edges, aristaN('ex', 'a2', 'a1', 'tool')], 'e2')).toBeNull();
    // sin el obstáculo, sí hay hueco
    expect(hueco(ej.nodes, ej.edges, 'e2')).not.toBeNull();
  });

  it('constructor.colocacion.hueco_para_insertar_acepta_el_caso_apretado_si_igual_queda_hacia_adelante', () => {
    // a2 en 956: faltan 44 px para el hueco completo y una app suelta impide correrlo, pero el nuevo (656) igual
    // queda a 300 de a2 (≥ 276): las dos flechas van hacia adelante. El mockup hacía lo mismo.
    const apretado = [...ej.nodes.map(n => (n.id === 'a2' ? { ...n, x: 956 } : n)), app('q', 1000, 260)];
    const h = hueco(apretado, ej.edges, 'e2');
    expect(h?.lugar).toEqual({ x: 656, y: 184 });
    expect(h?.corrido).toBe(0);
    expect(h?.nodes.find(n => n.id === 'a2')?.x).toBe(956);
    // a 1 px de lo apretado (a2 en 931 → 275 de separación) ya no cabe
    const demasiado = [...ej.nodes.map(n => (n.id === 'a2' ? { ...n, x: 931 } : n)), app('q', 1000, 260)];
    expect(hueco(demasiado, ej.edges, 'e2')).toBeNull();
  });

  it('constructor.colocacion.hueco_para_insertar_siempre_deja_las_dos_flechas_hacia_adelante_y_sin_encimar', () => {
    // propiedad con semilla fija: el flujo se arma con las mismas funciones de colocación que usará el reductor
    // (agregar después, agregar herramienta, poner en medio). Después de cada «poner en medio» que sí se hace:
    // las dos flechas nuevas van hacia adelante, ningún cuadro choca con otro, los invariantes se cumplen y lo
    // que se movió es solo lo que sigue al destino, por parejo.
    const rng = mulberry32(99);
    let hechos = 0;
    let rechazados = 0;
    let corridos = 0;
    for (let corrida = 0; corrida < 60; corrida += 1) {
      let nodes: Nodo[] = ejemplo().nodes;
      let edges: Arista[] = ejemplo().edges;
      let n = 20;
      for (let paso = 0; paso < 14; paso += 1) {
        const pasos = edges.filter(e => e.tipo === 'seq');
        const accion = rng();
        if (accion < 0.4 && pasos.length > 0) {
          // poner un cuadro en medio de un paso al azar
          const vieja = pasos[entero(rng, pasos.length)] as Arista;
          const A = nodo(nodes, vieja.de);
          const D = nodo(nodes, vieja.a);
          if (nodes.filter(x => x.kind === 'app').length >= TOPE_APPS) continue;
          const antes = nodes;
          const antesEdges = edges;
          congelar(antes);
          congelar(antesEdges);
          const h = huecoParaInsertar(nodes, edges, A, D, vieja);
          if (!h) {
            rechazados += 1;
            continue;
          }
          hechos += 1;
          if (h.corrido > 0) corridos += 1;
          n += 1;
          const nuevo = app(`p${n}`, h.lugar.x, h.lugar.y, 'Gmail');
          nodes = [...h.nodes, nuevo];
          edges = [...edges.filter(e => e.id !== vieja.id), aristaN(`e${n}`, A.id, nuevo.id, 'seq'), aristaN(`f${n}`, nuevo.id, D.id, 'seq')];
          const a2 = nodo(nodes, A.id);
          const d2 = nodo(nodes, D.id);
          expect(estaALaDerecha(a2, nuevo), 'origen → nuevo hacia adelante').toBe(true);
          expect(estaALaDerecha(nuevo, d2), 'nuevo → destino hacia adelante').toBe(true);
          expect(invariantesDelGrafo(nodes, edges)).toEqual([]);
          // el origen no se mueve; todo lo movido se corrió a la derecha lo mismo (salvo el ajuste a la rejilla), sin tocar la y
          for (const viejo of antes) {
            const nuevoN = nodo(nodes, viejo.id);
            expect(nuevoN.y).toBe(viejo.y);
            if (nuevoN === viejo) continue;
            expect(nuevoN.x).toBe(enRango(viejo.x + h.corrido, viejo.y).x);
          }
          expect(nodo(nodes, A.id)).toBe(A);
        } else if (accion < 0.7) {
          // agregar lo que sigue a un cuadro que pueda tener algo después
          const origen = nodes[entero(rng, nodes.length)] as Nodo;
          const kind = rng() < 0.5 ? 'agent' : 'app';
          if ((kind === 'agent' && nodes.filter(x => x.kind === 'agent').length >= TOPE_AGENTES) || (kind === 'app' && nodes.filter(x => x.kind === 'app').length >= TOPE_APPS)) continue;
          const p = lugarALaDerecha(nodes, origen);
          n += 1;
          const nuevo: Nodo = kind === 'agent' ? { id: `a${n}`, kind, ...p, nombre: `A${n}`, ia: 'openai', tarea: '', instrucciones: '' } : app(`p${n}`, p.x, p.y);
          if (!puedeEnlazar({ nodes: [...nodes, nuevo], edges }, origen.id, nuevo.id, 'seq').ok) continue;
          nodes = [...nodes, nuevo];
          edges = [...edges, aristaN(`e${n}`, origen.id, nuevo.id, 'seq')];
        } else {
          // una herramienta para un agente
          const agentes = nodes.filter(x => x.kind === 'agent');
          const origen = agentes[entero(rng, agentes.length)];
          if (!origen || nodes.filter(x => x.kind === 'app').length >= TOPE_APPS) continue;
          const p = lugarDebajo(nodes, origen);
          n += 1;
          const nuevo = app(`p${n}`, p.x, p.y);
          if (!puedeEnlazar({ nodes: [...nodes, nuevo], edges }, origen.id, nuevo.id, 'tool').ok) continue;
          nodes = [...nodes, nuevo];
          edges = [...edges, aristaN(`e${n}`, origen.id, nuevo.id, 'tool')];
        }
        // las posiciones automáticas nunca encimaron nada
        for (const x of nodes) expect(choca(nodes.filter(o => o.id !== x.id), x.x, x.y), `${x.id} choca`).toBe(false);
        expect(invariantesDelGrafo(nodes, edges)).toEqual([]);
      }
    }
    // la prueba tiene que haber pasado por los tres caminos: hacer, hacer corriendo, y rechazar
    expect(hechos).toBeGreaterThan(40);
    expect(corridos).toBeGreaterThan(15);
    expect(rechazados).toBeGreaterThan(5);
  });
});
