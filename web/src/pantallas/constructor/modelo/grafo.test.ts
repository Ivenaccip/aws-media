import { describe, expect, it } from 'vitest';

import { TOPE_AGENTES, TOPE_APPS, X_MAX, Y_MAX } from './datos/constantes';
import { ejemplo, muestras } from './ejemplos';
import {
  alcanza,
  candidatos,
  CODIGOS_VIOLACION,
  codigoDeViolacion,
  hayCiclo,
  hayCicloTotal,
  invariantesDelGrafo,
  puedeEnlazar,
  soloAppsPorLaPatita,
  violacionesDelGrafo,
  type Grafo,
} from './grafo';
import { mulberry32 } from './prueba/semilla';
import type { Arista, Flujo, Nodo, NodoAgente, NodoApp, NodoDisparador, TipoArista } from './tipos';

// ---------------------------------------------------------------- ayudas de la prueba

// (mulberry32 viene de prueba/semilla.ts: la comparten todas las pruebas con azar)
const entero = (rng: () => number, n: number) => Math.floor(rng() * n);
function elegir<T>(rng: () => number, lista: readonly T[]): T {
  const x = lista[entero(rng, lista.length)];
  if (x === undefined) throw new Error('lista vacía');
  return x;
}

/** Congela las listas y cada elemento: si una función intenta modificar algo, la prueba revienta. */
function congelar<T>(v: T): T {
  if (v !== null && typeof v === 'object') {
    for (const hijo of Object.values(v)) congelar(hijo);
    Object.freeze(v);
  }
  return v;
}

const agenteN = (id: string, nombre = id, x = 0, y = 0): NodoAgente => ({
  id,
  kind: 'agent',
  x,
  y,
  nombre,
  ia: 'openai',
  tarea: '',
  instrucciones: '',
});
const appN = (id: string, nombre = 'Slack', x = 0, y = 0): NodoApp => ({ id, kind: 'app', x, y, nombre });
const disparadorN = (id: string, x = 0, y = 0): NodoDisparador => ({
  id,
  kind: 'trigger',
  x,
  y,
  tipo: 'chat',
  frec: 'dia',
  ruta: 'mi-flujo',
  app: 'gmail',
});
const aristaN = (id: string, de: string, a: string, tipo: TipoArista): Arista => ({ id, de, a, tipo });

/** Como `base()` del harness del mockup: el ejemplo (Chat → «Atención a clientes» → «Revisor», con Google Sheets y Slack de herramientas). */
const base = (): Flujo => ejemplo();
/** `E` del harness: agrega una conexión con un id que no choca. */
const unir = (f: Flujo, de: string, a: string, tipo: TipoArista) => {
  f.edges.push(aristaN(`x${f.edges.length}${de}${a}`, de, a, tipo));
};
const ponerApp = (f: Flujo, id: string, nombre: string) => {
  f.nodes.push(appN(id, nombre, 100, 330));
};
const ponerAgente = (f: Flujo, id: string, nombre: string) => {
  f.nodes.push({ ...agenteN(id, nombre, 100, 100), desc: `Ayuda con ${nombre}.`, instrucciones: 'Sé breve.' });
};

/** Los códigos (sin el detalle) de lo que viola un flujo cualquiera. */
const codigos = (f: { nodes: unknown; edges: unknown }) =>
  invariantesDelGrafo(f.nodes as Nodo[], f.edges as Arista[]).map(codigoDeViolacion);

const MOTIVO = {
  noExiste: 'Ese cuadro ya no existe.',
  consigo: 'Un cuadro no se puede conectar consigo mismo.',
  yaConectados: 'Esos dos cuadros ya están conectados así.',
  disparador: 'Nada puede ir antes de un disparador: él es el inicio del flujo.',
  circulo: 'Eso haría un círculo: el flujo volvería a empezar solo.',
  soloAgente: 'Solo un agente de IA puede tener herramientas o conversar con otra IA.',
  alReves: 'Un agente no puede conversar con quien ya conversa con él.',
} as const;

// ---------------------------------------------------------------- puedeEnlazar

describe('puedeEnlazar', () => {
  it('constructor.grafo.puede_enlazar_porta_las_26_reglas_del_harness_con_su_motivo_exacto', () => {
    type Caso = [nombre: string, preparar: (f: Flujo) => void, de: string, a: string, tipo: TipoArista, motivo: string | null];
    // null = se puede; un texto = el motivo EXACTO (los mismos que da el mockup, medidos con su harness)
    const casos: Caso[] = [
      ['seq: a sí mismo', () => {}, 'a1', 'a1', 'seq', MOTIVO.consigo],
      ['seq: duplicado', () => {}, 'a1', 'a2', 'seq', MOTIVO.yaConectados],
      ['seq: hacia el disparador', () => {}, 'a1', 't1', 'seq', MOTIVO.disparador],
      ['seq: ciclo directo', () => {}, 'a2', 'a1', 'seq', MOTIVO.circulo],
      [
        'seq: ciclo de 3',
        f => {
          ponerAgente(f, 'a3', 'Tres');
          unir(f, 'a2', 'a3', 'seq');
        },
        'a3',
        'a1',
        'seq',
        MOTIVO.circulo,
      ],
      [
        'seq: desde una herramienta',
        () => {},
        'p1',
        'p2',
        'seq',
        '«Google Sheets» es herramienta de un agente: no puede tener pasos después.',
      ],
      [
        'seq: hacia una herramienta',
        () => {},
        'a2',
        'p1',
        'seq',
        '«Google Sheets» es herramienta de un agente: no puede ser un paso del flujo.',
      ],
      ['seq: una IA después de otra IA', f => ponerAgente(f, 'a3', 'Tres'), 'a2', 'a3', 'seq', null],
      ['seq: nuevo paso válido', f => ponerApp(f, 'z', 'Notion'), 'a2', 'z', 'seq', null],
      ['seq: disparador a app', f => ponerApp(f, 'z', 'Notion'), 't1', 'z', 'seq', null],
      ['tool: de una app', f => ponerApp(f, 'z', 'Notion'), 'p1', 'z', 'tool', MOTIVO.soloAgente],
      ['tool: del disparador', f => ponerApp(f, 'z', 'Notion'), 't1', 'z', 'tool', MOTIVO.soloAgente],
      ['tool: hacia el disparador', () => {}, 'a1', 't1', 'tool', MOTIVO.disparador],
      ['tool: duplicado', () => {}, 'a1', 'p1', 'tool', MOTIVO.yaConectados],
      [
        'tool: la app ya es paso',
        f => {
          ponerApp(f, 'z', 'Notion');
          unir(f, 'a2', 'z', 'seq');
        },
        'a1',
        'z',
        'tool',
        '«Notion» ya es un paso del flujo: no puede ser también herramienta. Agrega otro cuadro igual.',
      ],
      ['tool: ya es herramienta de otro', () => {}, 'a2', 'p1', 'tool', '«Google Sheets» ya es herramienta o ayudante de otro agente.'],
      ['tool: una IA sí puede conversar con otra IA', f => ponerAgente(f, 'a3', 'Tres'), 'a1', 'a3', 'tool', null],
      [
        'tool: la IA que ya es un paso (le llega una conexión) no',
        () => {},
        'a1',
        'a2',
        'tool',
        '«Revisor» ya es un paso del flujo (le llega una conexión): no puede ser también la IA con la que conversa «Atención a clientes».',
      ],
      [
        'tool: no se conversa en círculo',
        f => {
          ponerAgente(f, 'a3', 'Tres');
          unir(f, 'a1', 'a3', 'tool');
        },
        'a3',
        'a1',
        'tool',
        '«Atención a clientes» ya es un paso del flujo (le llega una conexión): no puede ser también la IA con la que conversa «Tres».',
      ],
      [
        'tool: la IA que conversa puede tener pasos después',
        f => {
          ponerAgente(f, 'a3', 'Tres');
          ponerApp(f, 'z', 'Notion');
          unir(f, 'a3', 'z', 'seq');
        },
        'a1',
        'a3',
        'tool',
        null,
      ],
      [
        'seq: lo que sigue puede salir de la IA que conversa',
        f => {
          ponerAgente(f, 'a3', 'Tres');
          unir(f, 'a1', 'a3', 'tool');
          ponerApp(f, 'z', 'Notion');
        },
        'a3',
        'z',
        'seq',
        null,
      ],
      [
        'seq: la IA que conversa no puede ser un paso',
        f => {
          ponerAgente(f, 'a3', 'Tres');
          unir(f, 'a1', 'a3', 'tool');
        },
        'a2',
        'a3',
        'seq',
        '«Tres» conversa con otra IA: no puede ser un paso del flujo.',
      ],
      [
        'seq: la IA que conversa no puede volver a su agente (círculo)',
        f => {
          ponerAgente(f, 'a3', 'Tres');
          unir(f, 'a1', 'a3', 'tool');
        },
        'a3',
        'a1',
        'seq',
        MOTIVO.circulo,
      ],
      [
        'seq: círculo a través de la pareja',
        f => {
          ponerAgente(f, 'a3', 'Tres');
          unir(f, 'a2', 'a3', 'tool');
          ponerApp(f, 'z', 'Notion');
          unir(f, 'a3', 'z', 'seq');
        },
        'z',
        'a1',
        'seq',
        MOTIVO.circulo,
      ],
      ['tool: app nueva', f => ponerApp(f, 'z', 'Notion'), 'a2', 'z', 'tool', null],
      ['tool: nodo inexistente', () => {}, 'a1', 'zzz', 'tool', MOTIVO.noExiste],
    ];
    expect(casos).toHaveLength(26);
    for (const [nombre, preparar, de, a, tipo, motivo] of casos) {
      const f = base();
      preparar(f);
      const r = puedeEnlazar(f, de, a, tipo);
      expect(r, nombre).toEqual(motivo === null ? { ok: true } : { ok: false, motivo });
    }
  });

  it('constructor.grafo.puede_enlazar_da_el_motivo_de_cada_una_de_las_12_reglas_de_rechazo', () => {
    // un caso mínimo por regla (y las dos variantes de las reglas 6 y 9); el texto sale tal cual al aviso
    const f1 = base();
    expect(puedeEnlazar(f1, 'zzz', 'a1', 'seq')).toEqual({ ok: false, motivo: MOTIVO.noExiste }); // 1 (origen)
    expect(puedeEnlazar(f1, 'a1', 'zzz', 'seq')).toEqual({ ok: false, motivo: MOTIVO.noExiste }); // 1 (destino)
    expect(puedeEnlazar(f1, 'a1', 'a1', 'tool')).toEqual({ ok: false, motivo: MOTIVO.consigo }); // 2
    expect(puedeEnlazar(f1, 'a1', 'p1', 'tool')).toEqual({ ok: false, motivo: MOTIVO.yaConectados }); // 3
    expect(puedeEnlazar(f1, 'a2', 't1', 'seq')).toEqual({ ok: false, motivo: MOTIVO.disparador }); // 4
    // 5: el origen es una app-herramienta (y no es agente); el título de una app sin nombre
    const sinNombre = base();
    sinNombre.nodes.push(appN('z', '   '));
    sinNombre.edges.push(aristaN('ez', 'a1', 'z', 'tool'));
    expect(puedeEnlazar(sinNombre, 'z', 'p2', 'seq')).toEqual({
      ok: false,
      motivo: '«App sin nombre» es herramienta de un agente: no puede tener pasos después.',
    });
    // 6a: el destino es un ayudante (agente con padre) / 6b: el destino es una app-herramienta
    const conPareja = base();
    conPareja.nodes.push(agenteN('a3', 'Tres'));
    conPareja.edges.push(aristaN('ep', 'a1', 'a3', 'tool'));
    expect(puedeEnlazar(conPareja, 'a2', 'a3', 'seq')).toEqual({
      ok: false,
      motivo: '«Tres» conversa con otra IA: no puede ser un paso del flujo.',
    });
    expect(puedeEnlazar(conPareja, 'a2', 'p1', 'seq')).toEqual({
      ok: false,
      motivo: '«Google Sheets» es herramienta de un agente: no puede ser un paso del flujo.',
    });
    // 7: círculo de pasos
    expect(puedeEnlazar(f1, 'a2', 'a1', 'seq')).toEqual({ ok: false, motivo: MOTIVO.circulo });
    // 8: la herramienta o el ayudante solo los tiene un agente
    expect(puedeEnlazar(f1, 'p2', 'p1', 'tool')).toEqual({ ok: false, motivo: MOTIVO.soloAgente });
    expect(puedeEnlazar(f1, 't1', 'a2', 'tool')).toEqual({ ok: false, motivo: MOTIVO.soloAgente });
    // 9a: la IA con la que se conversa ya es un paso / 9b: la app ya es un paso (entrante o saliente)
    expect(puedeEnlazar(f1, 'a1', 'a2', 'tool').ok).toBe(false);
    const appPaso = base();
    appPaso.nodes.push(appN('z', 'Notion'));
    appPaso.edges.push(aristaN('es', 'z', 'a2', 'seq')); // z sale por un seq (no le entra nada)
    expect(puedeEnlazar(appPaso, 'a1', 'z', 'tool')).toEqual({
      ok: false,
      motivo: '«Notion» ya es un paso del flujo: no puede ser también herramienta. Agrega otro cuadro igual.',
    });
    // 10: ya tiene padre
    expect(puedeEnlazar(f1, 'a2', 'p1', 'tool')).toEqual({
      ok: false,
      motivo: '«Google Sheets» ya es herramienta o ayudante de otro agente.',
    });
    // 11: el destino es antecesor del origen por la cadena de padres (a1 conversa con a2; a2 no puede conversar con a1)
    const cadena: Grafo = { nodes: [agenteN('a1'), agenteN('a2')], edges: [aristaN('e1', 'a1', 'a2', 'tool')] };
    expect(puedeEnlazar(cadena, 'a2', 'a1', 'tool')).toEqual({ ok: false, motivo: MOTIVO.alReves });
    // 12: círculo al conversar (a1 → a2 → a3 en pasos; a3 no puede tener a a1 como ayudante: a1 sale por a3)
    const pasos: Grafo = {
      nodes: [agenteN('a1'), agenteN('a2'), agenteN('a3')],
      edges: [aristaN('e1', 'a1', 'a2', 'seq'), aristaN('e2', 'a2', 'a3', 'seq')],
    };
    expect(puedeEnlazar(pasos, 'a3', 'a1', 'tool')).toEqual({ ok: false, motivo: MOTIVO.circulo });
    // y la contraparte: con una app como destino la regla 12 no aplica (la app no es agente)
    expect(puedeEnlazar({ ...pasos, nodes: [...pasos.nodes, appN('p1')] }, 'a3', 'p1', 'tool')).toEqual({ ok: true });
  });

  it('constructor.grafo.puede_enlazar_evalua_en_orden_y_gana_la_primera_regla_que_falla', () => {
    // cada caso rompe DOS reglas a la vez (grafos que no deberían existir pero pueden llegar de afuera);
    // el motivo tiene que ser el de la regla de número menor
    const trig: Nodo = disparadorN('t1');
    const g = (nodes: Nodo[], edges: Arista[]): Grafo => ({ nodes, edges });
    const motivo = (grafo: Grafo, de: string, a: string, tipo: TipoArista) => {
      const r = puedeEnlazar(grafo, de, a, tipo);
      return r.ok ? null : r.motivo;
    };
    // 1 antes que 2: un cuadro que no existe consigo mismo
    expect(motivo(g([], []), 'zzz', 'zzz', 'seq')).toBe(MOTIVO.noExiste);
    // 2 antes que 3: una conexión a sí mismo que ya existe
    expect(motivo(g([agenteN('a1')], [aristaN('e1', 'a1', 'a1', 'seq')]), 'a1', 'a1', 'seq')).toBe(MOTIVO.consigo);
    // 3 antes que 4: ya existe una conexión hacia el disparador
    expect(motivo(g([trig, agenteN('a1')], [aristaN('e1', 'a1', 't1', 'seq')]), 'a1', 't1', 'seq')).toBe(MOTIVO.yaConectados);
    // 4 antes que 5/6/8: hacia un disparador, desde una app-herramienta, por tool y por seq
    const herr = g([trig, agenteN('a1'), appN('p1')], [aristaN('e1', 'a1', 'p1', 'tool')]);
    expect(motivo(herr, 'p1', 't1', 'seq')).toBe(MOTIVO.disparador);
    expect(motivo(herr, 'p1', 't1', 'tool')).toBe(MOTIVO.disparador);
    // 5 antes que 6: una app-herramienta hacia otra app-herramienta
    const dos = g(
      [agenteN('a1'), appN('p1', 'Uno'), appN('p2', 'Dos')],
      [aristaN('e1', 'a1', 'p1', 'tool'), aristaN('e2', 'a1', 'p2', 'tool')],
    );
    expect(motivo(dos, 'p1', 'p2', 'seq')).toBe('«Uno» es herramienta de un agente: no puede tener pasos después.');
    // 6 antes que 7: el destino es herramienta y además cerraría un círculo
    const circ = g(
      [agenteN('a1'), agenteN('a2'), agenteN('a3', 'Tres')],
      [aristaN('e1', 'a1', 'a2', 'seq'), aristaN('e2', 'a2', 'a3', 'tool'), aristaN('e3', 'a1', 'a3', 'tool')],
    );
    expect(motivo(circ, 'a2', 'a3', 'seq')).toBe('«Tres» conversa con otra IA: no puede ser un paso del flujo.');
    // 8 antes que 9 y 10: el origen no es agente, el destino ya es herramienta
    expect(motivo(dos, 'p1', 'p2', 'tool')).toBe(MOTIVO.soloAgente);
    // 9a antes que 10: el destino es agente con un paso entrante Y ya tiene padre
    const raro = g(
      [agenteN('a1'), agenteN('a2', 'Dos'), agenteN('a3', 'Tres')],
      [aristaN('e1', 'a1', 'a2', 'tool'), aristaN('e2', 'a3', 'a2', 'seq')],
    );
    expect(motivo(raro, 'a1', 'a2', 'tool')).toBe(MOTIVO.yaConectados); // (3 va antes que todo)
    expect(motivo({ ...raro, nodes: [...raro.nodes, agenteN('a4', 'Cuatro')] }, 'a4', 'a2', 'tool')).toBe(
      '«Dos» ya es un paso del flujo (le llega una conexión): no puede ser también la IA con la que conversa «Cuatro».',
    );
    // 9b antes que 10: la app ya toca un seq Y ya tiene padre
    const appRara = g(
      [agenteN('a1'), agenteN('a2'), appN('p1', 'Notion')],
      [aristaN('e1', 'a1', 'p1', 'tool'), aristaN('e2', 'p1', 'a2', 'seq')],
    );
    expect(motivo(appRara, 'a2', 'p1', 'tool')).toBe(
      '«Notion» ya es un paso del flujo: no puede ser también herramienta. Agrega otro cuadro igual.',
    );
    // 10 antes que 11: el destino es antecesor del origen Y tiene padre (a2 es el ayudante de a1 y a3 es el de a2)
    const abuelo = g(
      [agenteN('a1'), agenteN('a2', 'Dos'), agenteN('a3'), agenteN('a0')],
      [aristaN('e1', 'a1', 'a2', 'tool'), aristaN('e2', 'a2', 'a3', 'tool'), aristaN('e0', 'a0', 'a1', 'tool')],
    );
    expect(motivo(abuelo, 'a3', 'a2', 'tool')).toBe('«Dos» ya es herramienta o ayudante de otro agente.');
    // 11 antes que 12: el destino es la raíz de la cadena Y cerraría un círculo
    const raiz = g(
      [agenteN('a1'), agenteN('a2'), agenteN('a3')],
      [aristaN('e1', 'a1', 'a2', 'tool'), aristaN('e2', 'a2', 'a3', 'tool')],
    );
    expect(motivo(raiz, 'a3', 'a1', 'tool')).toBe(MOTIVO.alReves);
  });

  it('constructor.grafo.puede_enlazar_acepta_exactamente_lo_que_deja_el_grafo_valido', () => {
    // propiedad (semilla fija): en un flujo que cumple los invariantes, «puedeEnlazar dice que sí» equivale a
    // «con esa conexión de más los invariantes se siguen cumpliendo». Es el oráculo diferencial del fuzz del mockup
    // (que solo exigía la ida) y además la vuelta: ninguna regla rechaza algo que sería válido.
    const rng = mulberry32(20261020);
    let pares = 0;
    let aceptados = 0;
    let rechazados = 0;
    const formas = new Set<string>();
    for (let corrida = 0; corrida < 24; corrida += 1) {
      let nodes: Nodo[] = [];
      let edges: Arista[] = [];
      let n = 0;
      let ne = 0;
      for (let paso = 0; paso < 45; paso += 1) {
        const r = rng();
        if (r < 0.35) {
          const kind = elegir(rng, ['trigger', 'agent', 'agent', 'app', 'app'] as const);
          const cuantos = nodes.filter(x => x.kind === kind).length;
          if ((kind === 'trigger' && cuantos >= 1) || (kind === 'agent' && cuantos >= TOPE_AGENTES) || (kind === 'app' && cuantos >= TOPE_APPS)) continue;
          n += 1;
          const x = 8 * entero(rng, 300);
          const y = 8 * entero(rng, 300);
          nodes = [...nodes, kind === 'trigger' ? disparadorN(`t${n}`, x, y) : kind === 'agent' ? agenteN(`a${n}`, `a${n}`, x, y) : appN(`p${n}`, 'Slack', x, y)];
        } else if (r < 0.9 && nodes.length > 1) {
          const de = elegir(rng, nodes).id;
          const a = elegir(rng, nodes).id;
          const tipo = elegir(rng, ['seq', 'tool'] as const);
          if (puedeEnlazar({ nodes, edges }, de, a, tipo).ok) {
            ne += 1;
            edges = [...edges, aristaN(`e${ne}`, de, a, tipo)];
          }
        } else if (edges.length > 0) {
          const k = entero(rng, edges.length);
          edges = edges.filter((_, i) => i !== k);
        } else if (nodes.length > 0) {
          const k = entero(rng, nodes.length);
          const id = nodes[k]?.id;
          nodes = nodes.filter((_, i) => i !== k);
          edges = edges.filter(e => e.de !== id && e.a !== id);
        }
        // lo que se construye con puedeEnlazar (y quitando) siempre es válido
        expect(invariantesDelGrafo(nodes, edges)).toEqual([]);
        if (paso % 3 !== 0) continue;
        for (const A of nodes) {
          for (const B of nodes) {
            for (const tipo of ['seq', 'tool'] as const) {
              const r2 = puedeEnlazar({ nodes, edges }, A.id, B.id, tipo);
              const queda = invariantesDelGrafo(nodes, [...edges, aristaN('__hipotetica', A.id, B.id, tipo)]);
              pares += 1;
              if (r2.ok) aceptados += 1;
              else {
                rechazados += 1;
                formas.add(r2.motivo.replace(/«[^»]*»/g, '«…»'));
              }
              expect(r2.ok, `${A.id} → ${B.id} (${tipo}): ${queda.join(' | ')}`).toBe(queda.length === 0);
            }
          }
        }
      }
    }
    // que la prueba de verdad explore: muchos pares, de los dos lados y con casi todos los motivos distintos
    expect(pares).toBeGreaterThan(5000);
    expect(aceptados).toBeGreaterThan(300);
    expect(rechazados).toBeGreaterThan(1000);
    expect(formas.size).toBeGreaterThanOrEqual(10);
  });

  it('constructor.grafo.puede_enlazar_no_lanza_ni_ensucia_el_motivo_en_flujos_cualesquiera', () => {
    const rng = mulberry32(777);
    const motivosConocidos = [
      /^Ese cuadro ya no existe\.$/,
      /^Un cuadro no se puede conectar consigo mismo\.$/,
      /^Esos dos cuadros ya están conectados así\.$/,
      /^Nada puede ir antes de un disparador: él es el inicio del flujo\.$/,
      /^«[^»]*» es herramienta de un agente: no puede tener pasos después\.$/,
      /^«[^»]*» (conversa con otra IA|es herramienta de un agente): no puede ser un paso del flujo\.$/,
      /^Eso haría un círculo: el flujo volvería a empezar solo\.$/,
      /^Solo un agente de IA puede tener herramientas o conversar con otra IA\.$/,
      /^«[^»]*» ya es un paso del flujo \(le llega una conexión\): no puede ser también la IA con la que conversa «[^»]*»\.$/,
      /^«[^»]*» ya es un paso del flujo: no puede ser también herramienta\. Agrega otro cuadro igual\.$/,
      /^«[^»]*» ya es herramienta o ayudante de otro agente\.$/,
      /^Un agente no puede conversar con quien ya conversa con él\.$/,
    ];
    for (let i = 0; i < 150; i += 1) {
      // flujos al azar, también inválidos (conexiones cualesquiera, ids repetidos, sin nombre…)
      const nodes: Nodo[] = [];
      for (let k = 0; k < entero(rng, 14); k += 1) {
        const kind = elegir(rng, ['trigger', 'agent', 'app'] as const);
        nodes.push(kind === 'trigger' ? disparadorN(`t${k}`) : kind === 'agent' ? agenteN(`a${k}`, rng() < 0.3 ? '' : `Ag ${k}`) : appN(`p${k}`, rng() < 0.3 ? ' ' : 'Slack'));
      }
      const edges: Arista[] = [];
      if (nodes.length > 0) {
        for (let k = 0; k < entero(rng, 20); k += 1) {
          edges.push(aristaN(`e${k}`, elegir(rng, nodes).id, elegir(rng, nodes).id, elegir(rng, ['seq', 'tool'] as const)));
        }
      }
      congelar({ nodes, edges });
      const ids = [...nodes.map(x => x.id), 'fantasma'];
      for (const de of ids) {
        for (const a of ids) {
          for (const tipo of ['seq', 'tool'] as const) {
            const r = puedeEnlazar({ nodes, edges }, de, a, tipo);
            if (r.ok) {
              expect(r).toEqual({ ok: true });
              continue;
            }
            expect(Object.keys(r).sort()).toEqual(['motivo', 'ok']);
            expect(r.motivo).not.toMatch(/undefined|NaN|\[object|null/);
            expect(motivosConocidos.some(re => re.test(r.motivo)), r.motivo).toBe(true);
          }
        }
      }
    }
  });

  it('constructor.grafo.puede_enlazar_no_modifica_lo_que_recibe_ni_comparte_la_conexion_hipotetica', () => {
    const f = congelar(base());
    // si hubiera una escritura sobre nodos o conexiones, lanzaría (todo está congelado)
    expect(() => {
      for (const de of f.nodes) for (const a of f.nodes) for (const tipo of ['seq', 'tool'] as const) puedeEnlazar(f, de.id, a.id, tipo);
      candidatos(f, 'a1', 'seq');
      hayCiclo(f);
      hayCicloTotal(f);
    }).not.toThrow();
    expect(f.edges).toHaveLength(4);
  });
});

// ---------------------------------------------------------------- hayCiclo, hayCicloTotal, alcanza

describe('círculos y alcance', () => {
  it('constructor.grafo.hay_ciclo_detecta_circulos_de_pasos_y_cuenta_lo_que_sale_de_un_ayudante_como_de_su_agente', () => {
    const f = base();
    expect(hayCiclo(f)).toBe(false);
    expect(hayCiclo({ nodes: [], edges: [] })).toBe(false);
    expect(hayCiclo({ nodes: [agenteN('a1')], edges: [] })).toBe(false);
    const con = (...extra: Arista[]): Grafo => ({ nodes: [...f.nodes, agenteN('a3'), appN('z')], edges: [...f.edges, ...extra] });
    // un círculo de pasos: a2 → a1
    expect(hayCiclo(con(aristaN('x', 'a2', 'a1', 'seq')))).toBe(true);
    // consigo mismo
    expect(hayCiclo(con(aristaN('x', 'a1', 'a1', 'seq')))).toBe(true);
    // de 3
    expect(hayCiclo(con(aristaN('x', 'a2', 'a3', 'seq'), aristaN('y', 'a3', 'a1', 'seq')))).toBe(true);
    // un camino que se junta de nuevo NO es un círculo (rombo): a1 → a2, a1 → a3, a2 → z, a3 → z
    expect(
      hayCiclo({
        nodes: [agenteN('a1'), agenteN('a2'), agenteN('a3'), appN('z')],
        edges: [aristaN('1', 'a1', 'a2', 'seq'), aristaN('2', 'a1', 'a3', 'seq'), aristaN('3', 'a2', 'z', 'seq'), aristaN('4', 'a3', 'z', 'seq')],
      }),
    ).toBe(false);
    // las conexiones de ida y vuelta (tool) solas no hacen círculo de pasos
    expect(hayCiclo({ nodes: [agenteN('a1'), agenteN('a2')], edges: [aristaN('1', 'a1', 'a2', 'tool'), aristaN('2', 'a2', 'a1', 'tool')] })).toBe(false);
    // lo que sale de un ayudante cuenta como salido de su agente principal: a1 conversa con a2 y a2 → a1
    expect(hayCiclo({ nodes: [agenteN('a1'), agenteN('a2')], edges: [aristaN('1', 'a1', 'a2', 'tool'), aristaN('2', 'a2', 'a1', 'seq')] })).toBe(true);
    // ...y el mismo seq a2 → a1 SIN la conversación es otra cosa: no hay círculo
    expect(hayCiclo({ nodes: [agenteN('a1'), agenteN('a2')], edges: [aristaN('2', 'a2', 'a1', 'seq')] })).toBe(false);
    // a través de la pareja y de una app: a2 conversa con a3, a3 → z, z → a1 (a1 → a2 de pasos viene del ejemplo)
    expect(
      hayCiclo({
        nodes: [...f.nodes, agenteN('a3'), appN('z')],
        edges: [...f.edges, aristaN('x', 'a2', 'a3', 'tool'), aristaN('y', 'a3', 'z', 'seq'), aristaN('w', 'z', 'a1', 'seq')],
      }),
    ).toBe(true);
    // una herramienta (app) con padre agente no sube: su seq no se cuenta como del agente
    expect(hayCiclo({ nodes: [agenteN('a1'), appN('p1'), agenteN('a2')], edges: [aristaN('1', 'a1', 'p1', 'tool'), aristaN('2', 'p1', 'a1', 'seq')] })).toBe(false);
  });

  it('constructor.grafo.hay_ciclo_no_se_desborda_con_cadenas_largas_ni_se_cuelga_con_circulos_de_ayudantes', () => {
    // el recorrido no usa recursión: una cadena de 30 000 pasos no desborda la pila
    const largo = 30000;
    const nodes = Array.from({ length: largo }, (_, i) => appN(`p${i}`));
    const cadena = nodes.slice(1).map((n, i) => aristaN(`e${i}`, `p${i}`, n.id, 'seq'));
    expect(hayCiclo({ nodes, edges: cadena })).toBe(false);
    expect(hayCiclo({ nodes, edges: [...cadena, aristaN('cierre', `p${largo - 1}`, 'p0', 'seq')] })).toBe(true);
    expect(hayCicloTotal({ nodes, edges: cadena })).toBe(false);
    expect(hayCicloTotal({ nodes, edges: [...cadena, aristaN('cierre', `p${largo - 1}`, 'p0', 'seq')] })).toBe(true);
    // un círculo de ayudantes (grafo roto) termina: sube 20 vueltas y se rinde
    const circulo = { nodes: [agenteN('a1'), agenteN('a2'), appN('z')], edges: [aristaN('1', 'a1', 'a2', 'tool'), aristaN('2', 'a2', 'a1', 'tool'), aristaN('3', 'a1', 'z', 'seq')] };
    expect(typeof hayCiclo(circulo)).toBe('boolean');
    expect(hayCicloTotal(circulo)).toBe(true);
  });

  it('constructor.grafo.hay_ciclo_total_cuenta_pasos_y_herramientas_como_flechas_y_ignora_las_huerfanas', () => {
    const f = base();
    expect(hayCicloTotal(f)).toBe(false);
    expect(hayCicloTotal({ nodes: [], edges: [] })).toBe(false);
    // a1 conversa con a3 y a3 → a1 de pasos: círculo mixto (hayCiclo también lo ve por la raíz)
    const mixto: Grafo = {
      nodes: [agenteN('a1'), agenteN('a3')],
      edges: [aristaN('1', 'a1', 'a3', 'tool'), aristaN('2', 'a3', 'a1', 'seq')],
    };
    expect(hayCicloTotal(mixto)).toBe(true);
    expect(hayCiclo(mixto)).toBe(true);
    // dos tool que se cierran
    expect(hayCicloTotal({ nodes: [agenteN('a1'), agenteN('a2')], edges: [aristaN('1', 'a1', 'a2', 'tool'), aristaN('2', 'a2', 'a1', 'tool')] })).toBe(true);
    // una conexión con un extremo que no existe se ignora (el círculo pasaría por un fantasma)
    expect(hayCicloTotal({ nodes: [agenteN('a1')], edges: [aristaN('1', 'a1', 'fantasma', 'seq'), aristaN('2', 'fantasma', 'a1', 'seq')] })).toBe(false);
  });

  it('constructor.grafo.hay_ciclo_implica_hay_ciclo_total_y_quitar_pasos_no_crea_circulos', () => {
    // propiedades con semilla fija sobre grafos al azar con extremos que existen (válidos o no)
    const rng = mulberry32(31337);
    let conCirculo = 0;
    for (let i = 0; i < 400; i += 1) {
      const nodes: Nodo[] = [];
      const cuantos = 2 + entero(rng, 10);
      for (let k = 0; k < cuantos; k += 1) {
        nodes.push(elegir(rng, [agenteN(`a${k}`), agenteN(`a${k}`), appN(`p${k}`)]));
      }
      const edges: Arista[] = [];
      for (let k = 0; k < entero(rng, cuantos * 2); k += 1) {
        edges.push(aristaN(`e${k}`, elegir(rng, nodes).id, elegir(rng, nodes).id, elegir(rng, ['seq', 'tool', 'seq'] as const)));
      }
      const g: Grafo = { nodes, edges };
      const efectivo = hayCiclo(g);
      const total = hayCicloTotal(g);
      if (efectivo) {
        conCirculo += 1;
        expect(total, JSON.stringify(g)).toBe(true);
      }
      for (let k = 0; k < edges.length; k += 1) {
        const sin: Grafo = { nodes, edges: edges.filter((_, j) => j !== k) };
        // quitar un paso nunca crea un círculo; quitar una `tool` sí podría cambiar de quién cuelga un ayudante,
        // así que para `hayCiclo` solo se prueba con los pasos (el total sí es monótono con cualquier conexión)
        if (!efectivo && edges[k]?.tipo === 'seq') expect(hayCiclo(sin)).toBe(false);
        if (!total) expect(hayCicloTotal(sin)).toBe(false);
      }
    }
    expect(conCirculo).toBeGreaterThan(40);
  });

  it('constructor.grafo.los_ids_como_proto_constructor_y_to_string_no_confunden_a_las_reglas', () => {
    // el mockup guardaba los colores del recorrido en un objeto: con estos ids se daba por visitado un cuadro que no lo
    // estaba y no veía algunos círculos. Aquí los ids son claves de un Map y valen como cualquier otro.
    const nombres = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];
    const nodes = nombres.map(id => agenteN(id));
    const cadena = nombres.slice(1).map((id, i) => aristaN(`e${i}`, nombres[i] ?? '', id, 'seq'));
    const grafo: Grafo = { nodes, edges: cadena };
    expect(hayCiclo(grafo)).toBe(false);
    expect(hayCicloTotal(grafo)).toBe(false);
    expect(invariantesDelGrafo(nodes, cadena)).toEqual([]);
    // cerrar la cadena es un círculo, lo vean la regla, el chequeo y los invariantes
    const cierre = aristaN('cierre', 'hasOwnProperty', '__proto__', 'seq');
    expect(hayCiclo({ nodes, edges: [...cadena, cierre] })).toBe(true);
    expect(hayCicloTotal({ nodes, edges: [...cadena, cierre] })).toBe(true);
    expect(puedeEnlazar(grafo, 'hasOwnProperty', '__proto__', 'seq')).toEqual({ ok: false, motivo: MOTIVO.circulo });
    expect(puedeEnlazar(grafo, '__proto__', 'hasOwnProperty', 'seq')).toEqual({ ok: true });
    expect(codigos({ nodes, edges: [...cadena, cierre] })).toEqual(['ciclo-de-pasos', 'ciclo-mixto']);
    // ayudantes con esos ids: la raíz sube por la cadena y el círculo a través de la pareja se ve
    const pareja: Grafo = { nodes: [agenteN('constructor'), agenteN('__proto__')], edges: [aristaN('p', 'constructor', '__proto__', 'tool')] };
    expect(puedeEnlazar(pareja, '__proto__', 'constructor', 'seq')).toEqual({ ok: false, motivo: MOTIVO.circulo });
    expect(puedeEnlazar(pareja, '__proto__', 'constructor', 'tool')).toEqual({ ok: false, motivo: MOTIVO.alReves });
    // ids repetidos con esos nombres
    expect(codigos({ nodes: [agenteN('constructor'), agenteN('constructor')], edges: [] })).toEqual(['ids-nodos-duplicados']);
    // y un cuadro que no existe con ese nombre no se confunde con uno del prototipo
    expect(puedeEnlazar({ nodes: [agenteN('a1')], edges: [] }, 'a1', 'constructor', 'seq')).toEqual({ ok: false, motivo: MOTIVO.noExiste });
    expect(alcanza([], 'toString', 'toString')).toBe(true);
    expect(candidatos({ nodes: [agenteN('a1')], edges: [] }, 'toString', 'seq')).toEqual([]);
  });

  it('constructor.grafo.alcanza_sigue_solo_las_conexiones_de_un_solo_sentido', () => {
    const f = base();
    expect(alcanza(f.edges, 't1', 'a2')).toBe(true); // t1 → a1 → a2
    expect(alcanza(f.edges, 't1', 'a1')).toBe(true);
    expect(alcanza(f.edges, 'a2', 'a1')).toBe(false);
    expect(alcanza(f.edges, 'a1', 't1')).toBe(false);
    // las herramientas (tool) no son un camino
    expect(alcanza(f.edges, 'a1', 'p1')).toBe(false);
    expect(alcanza(f.edges, 't1', 'p2')).toBe(false);
    // uno mismo, aunque no esté en el flujo
    expect(alcanza(f.edges, 'a1', 'a1')).toBe(true);
    expect(alcanza([], 'zzz', 'zzz')).toBe(true);
    expect(alcanza([], 'a1', 'a2')).toBe(false);
    // no se cuelga con un círculo
    const circ = [aristaN('1', 'a', 'b', 'seq'), aristaN('2', 'b', 'a', 'seq'), aristaN('3', 'b', 'c', 'seq')];
    expect(alcanza(circ, 'a', 'c')).toBe(true);
    expect(alcanza(circ, 'a', 'zzz')).toBe(false);
    // ids con nombres de prototipo
    expect(alcanza([aristaN('1', '__proto__', 'constructor', 'seq')], '__proto__', 'constructor')).toBe(true);
    expect(alcanza([], 'toString', 'valueOf')).toBe(false);
  });
});

// ---------------------------------------------------------------- candidatos y la regla de la patita

describe('candidatos y soloAppsPorLaPatita', () => {
  it('constructor.grafo.candidatos_son_los_cuadros_a_los_que_puede_enlazar_en_el_orden_del_lienzo', () => {
    const f = base();
    f.nodes.push(appN('z', 'Notion', 100, 330), agenteN('a3', 'Tres', 100, 100));
    // desde a2 en un solo sentido: nada que vaya antes de un disparador, ni herramientas, ni él mismo, ni a quien ya tiene
    expect(candidatos(f, 'a2', 'seq').map(n => n.id)).toEqual(['z', 'a3']);
    // desde a1 por ida y vuelta: a2 ya es un paso (no), p1 ya es suya (no), p2 es de a2 (no)
    expect(candidatos(f, 'a1', 'tool').map(n => n.id)).toEqual(['z', 'a3']);
    // de un cuadro que no existe, o de una app por ida y vuelta: ninguno
    expect(candidatos(f, 'zzz', 'seq')).toEqual([]);
    expect(candidatos(f, 'p1', 'tool')).toEqual([]);
    // son los objetos mismos
    expect(candidatos(f, 'a2', 'seq')[0]).toBe(f.nodes[5]);
    // el disparador puede ir a cualquier cuadro que sea un paso (no a las herramientas ni a a1, que ya recibe su conexión)
    expect(candidatos(f, 't1', 'seq').map(n => n.id)).toEqual(['a2', 'z', 'a3']);
    // todo candidato cumple puedeEnlazar y todo lo demás no
    for (const n of f.nodes) {
      for (const tipo of ['seq', 'tool'] as const) {
        const ids = candidatos(f, n.id, tipo).map(c => c.id);
        for (const otro of f.nodes) expect(ids.includes(otro.id), `${n.id}→${otro.id} ${tipo}`).toBe(otro.id !== n.id && puedeEnlazar(f, n.id, otro.id, tipo).ok);
      }
    }
  });

  it('constructor.grafo.solo_apps_por_la_patita_rechaza_agentes_y_disparadores_solo_desde_el_agente', () => {
    const app: Nodo = appN('p1');
    const agente: Nodo = agenteN('a1');
    const disparador: Nodo = disparadorN('t1');
    // por la patita (tool) empezando desde el agente (origen): solo van apps
    expect(soloAppsPorLaPatita('tool', 'origen', app)).toBe(false);
    expect(soloAppsPorLaPatita('tool', 'origen', agente)).toBe(true);
    expect(soloAppsPorLaPatita('tool', 'origen', disparador)).toBe(true);
    expect(soloAppsPorLaPatita('tool', 'origen', undefined)).toBe(true);
    expect(soloAppsPorLaPatita('tool', 'origen', null)).toBe(true);
    // lo que se crea desde el menú: solo importa el tipo del cuadro que se iba a crear
    expect(soloAppsPorLaPatita('tool', 'origen', { kind: 'agent' })).toBe(true);
    expect(soloAppsPorLaPatita('tool', 'origen', { kind: 'app' })).toBe(false);
    // empezando desde el cuadro que va a colgar (destino): no se rechaza por esto
    for (const d of [app, agente, disparador, undefined, null]) expect(soloAppsPorLaPatita('tool', 'destino', d)).toBe(false);
    // un solo sentido: la regla no aplica
    for (const d of [app, agente, disparador, undefined, null]) {
      expect(soloAppsPorLaPatita('seq', 'origen', d)).toBe(false);
      expect(soloAppsPorLaPatita('seq', 'destino', d)).toBe(false);
    }
    // y no está dentro de puedeEnlazar: ida y vuelta de un agente a otro agente SÍ se puede (es el «Ida y vuelta» del editor)
    const f = base();
    f.nodes.push(agenteN('a3', 'Tres'));
    expect(puedeEnlazar(f, 'a1', 'a3', 'tool')).toEqual({ ok: true });
    expect(soloAppsPorLaPatita('tool', 'origen', f.nodes.find(n => n.id === 'a3'))).toBe(true);
  });
});

// ---------------------------------------------------------------- invariantesDelGrafo

describe('invariantesDelGrafo', () => {
  it('constructor.grafo.invariantes_aceptan_el_ejemplo_las_muestras_y_los_flujos_sin_disparador_o_vacios', () => {
    expect(invariantesDelGrafo(ejemplo().nodes, ejemplo().edges)).toEqual([]);
    for (const m of muestras()) expect(invariantesDelGrafo(m.nodes, m.edges), m.nombre).toEqual([]);
    expect(invariantesDelGrafo([], [])).toEqual([]);
    // sin disparador es válido (se quitó con la ×); sin conexiones también
    const sinDisparador = base();
    sinDisparador.nodes = sinDisparador.nodes.filter(n => n.kind !== 'trigger');
    sinDisparador.edges = sinDisparador.edges.filter(e => e.de !== 't1');
    expect(invariantesDelGrafo(sinDisparador.nodes, sinDisparador.edges)).toEqual([]);
    expect(invariantesDelGrafo(base().nodes, [])).toEqual([]);
    // una cadena de ayudantes, con pasos que salen del último
    const cadena: Grafo = {
      nodes: [disparadorN('t1'), agenteN('a1'), agenteN('a2'), agenteN('a3'), appN('p1'), appN('p2')],
      edges: [
        aristaN('e1', 't1', 'a1', 'seq'),
        aristaN('e2', 'a1', 'a2', 'tool'),
        aristaN('e3', 'a2', 'a3', 'tool'),
        aristaN('e4', 'a3', 'p1', 'seq'),
        aristaN('e5', 'a1', 'p2', 'tool'),
      ],
    };
    expect(invariantesDelGrafo(cadena.nodes, cadena.edges)).toEqual([]);
    // los extremos del lienzo y de los topes valen; la rejilla de 8 NO se exige
    const justo: Nodo[] = [
      disparadorN('t1', 0, 0),
      ...Array.from({ length: TOPE_AGENTES }, (_, i) => agenteN(`a${i}`, `a${i}`, X_MAX, Y_MAX)),
      ...Array.from({ length: TOPE_APPS }, (_, i) => appN(`p${i}`, 'Slack', 13, 7)),
    ];
    expect(invariantesDelGrafo(justo, [])).toEqual([]);
  });

  it('constructor.grafo.invariantes_detectan_cada_una_de_las_violaciones_con_su_codigo', () => {
    type Caso = [codigo: string, preparar: (f: Flujo) => void];
    const casos: Caso[] = [
      ['ids-nodos-duplicados', f => f.nodes.push(appN('p1'))],
      ['ids-aristas-duplicados', f => f.edges.push(aristaN('e1', 'a2', 'a1', 'tool'))],
      ['arista-huerfana', f => f.edges.push(aristaN('x', 'a1', 'zzz', 'seq'))],
      ['arista-huerfana', f => f.edges.push(aristaN('x', 'zzz', 'a1', 'seq'))],
      ['arista-a-si-mismo', f => f.edges.push(aristaN('x', 'a1', 'a1', 'seq'))],
      ['arista-tipo-invalido', f => f.edges.push({ id: 'x', de: 'a1', a: 'a2', tipo: 'raro' as TipoArista })],
      ['arista-duplicada', f => f.edges.push(aristaN('x', 'a1', 'a2', 'seq'))],
      ['llega-al-disparador', f => f.edges.push(aristaN('x', 'a2', 't1', 'seq'))],
      ['llega-al-disparador', f => f.edges.push(aristaN('x', 'a2', 't1', 'tool'))],
      ['herramienta-de-no-agente', f => f.edges.push(aristaN('x', 'p1', 'p2', 'tool'))],
      ['herramienta-de-no-agente', f => f.edges.push(aristaN('x', 't1', 'p2', 'tool'))],
      ['herramienta-con-varios-padres', f => f.edges.push(aristaN('x', 'a2', 'p1', 'tool'))],
      ['ayudante-con-paso-entrante', f => f.edges.push(aristaN('x', 'a1', 'a2', 'tool'))],
      ['herramienta-y-paso', f => f.edges.push(aristaN('x', 'a1', 'p2', 'seq'))],
      ['herramienta-y-paso', f => f.edges.push(aristaN('x', 'p2', 'a1', 'seq'))],
      ['ciclo-de-pasos', f => f.edges.push(aristaN('x', 'a2', 'a1', 'seq'))],
      [
        'ciclo-de-herramientas',
        f => {
          f.nodes.push(agenteN('a3'));
          f.edges.push(aristaN('x', 'a2', 'a3', 'tool'), aristaN('y', 'a3', 'a2', 'tool'));
        },
      ],
      [
        'ciclo-mixto',
        f => {
          f.nodes.push(agenteN('a3'));
          f.edges.push(aristaN('x', 'a1', 'a3', 'tool'), aristaN('y', 'a3', 'a1', 'seq'));
        },
      ],
      ['varios-disparadores', f => f.nodes.push(disparadorN('t2'))],
      ['tope-agentes', f => f.nodes.push(agenteN('a3'), agenteN('a4'), agenteN('a5'))],
      ['tope-apps', f => f.nodes.push(...Array.from({ length: 7 }, (_, i) => appN(`z${i}`)))],
      ['caja-no-finita', f => void Object.assign(f.nodes[1] ?? {}, { x: Number.NaN })],
      ['caja-no-finita', f => void Object.assign(f.nodes[1] ?? {}, { y: Number.POSITIVE_INFINITY })],
      ['caja-no-finita', f => void Object.assign(f.nodes[1] ?? {}, { x: '312' })],
      ['caja-fuera-del-lienzo', f => void Object.assign(f.nodes[1] ?? {}, { x: -8 })],
      ['caja-fuera-del-lienzo', f => void Object.assign(f.nodes[1] ?? {}, { x: X_MAX + 8 })],
      ['caja-fuera-del-lienzo', f => void Object.assign(f.nodes[1] ?? {}, { y: Y_MAX + 1 })],
    ];
    const vistos = new Set<string>();
    for (const [codigo, preparar] of casos) {
      const f = base();
      preparar(f);
      expect(codigos(f), codigo).toContain(codigo);
      vistos.add(codigo);
    }
    // el texto: «<código>: <detalle>», con el detalle dicho en ids
    const huerfana = base();
    huerfana.edges.push(aristaN('x', 'a1', 'zzz', 'seq'));
    expect(invariantesDelGrafo(huerfana.nodes, huerfana.edges)).toEqual(['arista-huerfana: x: a1 → zzz']);
    // casos de UNA sola violación: la lista trae exactamente esa
    const sola = base();
    sola.nodes.push(agenteN('a3'));
    sola.edges.push(aristaN('x', 'a1', 'a3', 'tool'), aristaN('y', 'a3', 'a1', 'seq'));
    expect(codigos(sola)).toEqual(['ciclo-mixto']);
    const dosTope = base();
    dosTope.nodes.push(disparadorN('t2'));
    expect(codigos(dosTope)).toEqual(['varios-disparadores']);
    // todo código (de los de grafo) tiene un caso en esta tabla
    const deForma = ['nodos-no-es-lista', 'aristas-no-es-lista', 'nodo-malformado', 'arista-malformada'];
    for (const c of CODIGOS_VIOLACION) if (!deForma.includes(c)) expect(vistos.has(c), `sin caso para ${c}`).toBe(true);
  });

  it('constructor.grafo.invariantes_reportan_lo_malformado_sin_lanzar_nunca', () => {
    const basura: unknown[] = [null, undefined, 0, 7, 'x', true, {}, [], [[]], { id: 'a' }];
    for (const n of basura) {
      for (const e of basura) {
        expect(() => violacionesDelGrafo(n as Nodo[], e as Arista[])).not.toThrow();
        expect(() => invariantesDelGrafo(n as Nodo[], e as Arista[])).not.toThrow();
      }
    }
    // lo que no es una lista
    expect(codigos({ nodes: null, edges: [] })).toEqual(['nodos-no-es-lista']);
    expect(codigos({ nodes: [], edges: 'x' })).toEqual(['aristas-no-es-lista']);
    expect(codigos({ nodes: { 0: {} }, edges: undefined })).toEqual(['nodos-no-es-lista', 'aristas-no-es-lista']);
    // cuadros que no se pueden leer
    expect(codigos({ nodes: [null, 3, 'x', [], {}, { id: '' }, { id: 7 }], edges: [] })).toEqual(Array<string>(7).fill('nodo-malformado'));
    expect(codigos({ nodes: [{ id: 'a1', kind: 'robot', x: 0, y: 0 }], edges: [] })).toEqual(['nodo-malformado']);
    expect(codigos({ nodes: [{ id: 'a1', x: 0, y: 0 }], edges: [] })).toEqual(['nodo-malformado']);
    // conexiones que no se pueden leer
    const ns = [agenteN('a1'), agenteN('a2')];
    expect(codigos({ nodes: ns, edges: [null, 3, {}, { id: 'e', de: 'a1' }, { id: 'e', de: 'a1', a: 2 }] })).toEqual(Array<string>(5).fill('arista-malformada'));
    // un cuadro ilegible deja huérfanas las conexiones que lo nombran (y lo demás se sigue revisando)
    expect(codigos({ nodes: [agenteN('a1'), { id: 'z', kind: '?' }], edges: [aristaN('e1', 'a1', 'z', 'seq')] })).toEqual(['nodo-malformado', 'arista-huerfana']);
    // un flujo leído de JSON con números como texto o extras
    const json = JSON.parse(JSON.stringify(base())) as { nodes: unknown[]; edges: unknown[]; extra?: number };
    json.extra = 1;
    expect(codigos(json)).toEqual([]);
  });

  it('constructor.grafo.invariantes_no_modifican_lo_que_reciben_y_dan_el_mismo_resultado_siempre', () => {
    const f = congelar(base());
    const a = invariantesDelGrafo(f.nodes, f.edges);
    const b = invariantesDelGrafo(f.nodes, f.edges);
    expect(a).toEqual(b);
    const roto = congelar({ nodes: [...base().nodes, agenteN('a3')], edges: [...base().edges, aristaN('x', 'a3', 'a1', 'seq'), aristaN('y', 'a1', 'a3', 'tool')] });
    const r1 = invariantesDelGrafo(roto.nodes, roto.edges);
    expect(r1.length).toBeGreaterThan(0);
    expect(invariantesDelGrafo(roto.nodes, roto.edges)).toEqual(r1);
    expect(violacionesDelGrafo(roto.nodes, roto.edges).map(v => `${v.codigo}: ${v.detalle}`)).toEqual(r1);
  });

  it('constructor.grafo.invariantes_codigo_de_violacion_y_la_lista_de_codigos_son_consistentes', () => {
    expect(codigoDeViolacion('ciclo-de-pasos: hay un círculo de pasos')).toBe('ciclo-de-pasos');
    expect(codigoDeViolacion('arista-huerfana: x: a1 → zzz')).toBe('arista-huerfana');
    expect(codigoDeViolacion('sin-detalle')).toBe('sin-detalle');
    expect(new Set(CODIGOS_VIOLACION).size).toBe(CODIGOS_VIOLACION.length);
    for (const c of CODIGOS_VIOLACION) expect(c).toMatch(/^[a-z]+(-[a-z]+)*$/);
    // los códigos que salen de una corrida al azar con cualquier cosa están todos declarados
    const rng = mulberry32(4242);
    const visto = new Set<string>();
    for (let i = 0; i < 400; i += 1) {
      const nodes: Nodo[] = [];
      for (let k = 0; k < entero(rng, 16); k += 1) {
        const kind = elegir(rng, ['trigger', 'agent', 'agent', 'app', 'app'] as const);
        const x = rng() < 0.05 ? elegir(rng, [-8, X_MAX + 8, Number.NaN]) : 8 * entero(rng, 300);
        const id = rng() < 0.05 ? 'a1' : `${kind[0]}${k}`;
        nodes.push(kind === 'trigger' ? disparadorN(id, x, 0) : kind === 'agent' ? agenteN(id, id, x, 0) : appN(id, 'Slack', x, 0));
      }
      const edges: Arista[] = [];
      for (let k = 0; k < entero(rng, 30); k += 1) {
        const alguno = () => (nodes.length > 0 && rng() > 0.05 ? elegir(rng, nodes).id : 'zzz');
        edges.push(aristaN(rng() < 0.05 ? 'e1' : `e${k}`, alguno(), alguno(), rng() < 0.03 ? ('raro' as TipoArista) : elegir(rng, ['seq', 'tool'] as const)));
      }
      for (const v of violacionesDelGrafo(nodes, edges)) {
        expect(CODIGOS_VIOLACION).toContain(v.codigo);
        expect(v.detalle.length).toBeGreaterThan(0);
        visto.add(v.codigo);
      }
    }
    expect(visto.size).toBeGreaterThanOrEqual(17);
  });
});
