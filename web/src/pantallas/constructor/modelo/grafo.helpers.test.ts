import { describe, expect, it } from 'vitest';

import { ayudantesDe, esAyudante, padreDe, raiz, tienePadre, tocaSeq } from './grafo';
import { ejemplo } from './ejemplos';
import type { Arista, Nodo, NodoAgente, NodoApp } from './tipos';

const agente = (id: string, nombre = id): NodoAgente => ({
  id,
  kind: 'agent',
  x: 0,
  y: 0,
  nombre,
  ia: 'openai',
  tarea: '',
  instrucciones: '',
});
const app = (id: string, nombre = 'Slack'): NodoApp => ({ id, kind: 'app', x: 0, y: 0, nombre });
const arista = (id: string, de: string, a: string, tipo: 'seq' | 'tool'): Arista => ({ id, de, a, tipo });

/** Congela las listas y cada elemento: si un helper intenta modificar algo, la prueba revienta. */
function congelar<T>(v: T): T {
  if (v !== null && typeof v === 'object') {
    for (const hijo of Object.values(v)) congelar(hijo);
    Object.freeze(v);
  }
  return v;
}

// a1 conversa con a2, que conversa con a3; a1 tiene la app p1 de herramienta; a3 tiene p2; luego a1 → p3 (paso)
const nodos: Nodo[] = congelar([agente('a1'), agente('a2'), agente('a3'), app('p1'), app('p2'), app('p3')]);
const aristas: Arista[] = congelar([
  arista('e1', 'a1', 'a2', 'tool'),
  arista('e2', 'a2', 'a3', 'tool'),
  arista('e3', 'a1', 'p1', 'tool'),
  arista('e4', 'a3', 'p2', 'tool'),
  arista('e5', 'a1', 'p3', 'seq'),
]);

describe('tienePadre y tocaSeq', () => {
  it('constructor.grafo.tiene_padre_dice_si_un_agente_lo_tiene_por_ida_y_vuelta_ayudantes_incluidos', () => {
    const ej = ejemplo();
    expect(tienePadre(ej.edges, 'p1')).toBe(true);
    expect(tienePadre(ej.edges, 'p2')).toBe(true);
    expect(tienePadre(ej.edges, 'a1')).toBe(false);
    expect(tienePadre(ej.edges, 'a2')).toBe(false); // llega por seq, no por tool
    expect(tienePadre(ej.edges, 't1')).toBe(false);
    expect(tienePadre(ej.edges, 'zzz')).toBe(false);
    expect(tienePadre([], 'a1')).toBe(false);
    // un ayudante también tiene padre
    expect(tienePadre(aristas, 'a2')).toBe(true);
    expect(tienePadre(aristas, 'a3')).toBe(true);
    expect(tienePadre(aristas, 'a1')).toBe(false);
    expect(tienePadre(aristas, 'p3')).toBe(false); // solo la toca un seq
  });

  it('constructor.grafo.toca_seq_dice_si_entra_o_sale_de_una_conexion_de_un_solo_sentido', () => {
    const ej = ejemplo();
    expect(tocaSeq(ej.edges, 't1')).toBe(true);
    expect(tocaSeq(ej.edges, 'a1')).toBe(true);
    expect(tocaSeq(ej.edges, 'a2')).toBe(true);
    expect(tocaSeq(ej.edges, 'p1')).toBe(false); // solo es herramienta
    expect(tocaSeq(ej.edges, 'p2')).toBe(false);
    expect(tocaSeq(ej.edges, 'zzz')).toBe(false);
    expect(tocaSeq([], 'a1')).toBe(false);
    expect(tocaSeq(aristas, 'p3')).toBe(true); // entra
    expect(tocaSeq(aristas, 'a1')).toBe(true); // sale
    expect(tocaSeq(aristas, 'a2')).toBe(false); // solo tool
  });
});

describe('padreDe y raiz', () => {
  it('constructor.grafo.padre_de_da_el_id_del_agente_del_que_cuelga_o_null', () => {
    const ej = ejemplo();
    expect(padreDe(ej.edges, 'p1')).toBe('a1');
    expect(padreDe(ej.edges, 'p2')).toBe('a2');
    expect(padreDe(ej.edges, 'a1')).toBeNull();
    expect(padreDe(ej.edges, 'a2')).toBeNull();
    expect(padreDe(ej.edges, 't1')).toBeNull();
    expect(padreDe(ej.edges, 'zzz')).toBeNull();
    expect(padreDe(aristas, 'a2')).toBe('a1');
    expect(padreDe(aristas, 'a3')).toBe('a2');
    expect(padreDe(aristas, 'p2')).toBe('a3');
    // si por error hubiera dos padres, manda la primera conexión
    expect(padreDe([arista('x', 'b', 'c', 'tool'), arista('y', 'a', 'c', 'tool')], 'c')).toBe('b');
  });

  it('constructor.grafo.raiz_sube_por_la_cadena_de_ayudantes_hasta_el_agente_principal', () => {
    expect(raiz(nodos, aristas, 'a3')).toBe('a1');
    expect(raiz(nodos, aristas, 'a2')).toBe('a1');
    expect(raiz(nodos, aristas, 'a1')).toBe('a1');
    // una app no sube: su padre es un agente pero ella no es ayudante
    expect(raiz(nodos, aristas, 'p1')).toBe('p1');
    expect(raiz(nodos, aristas, 'p2')).toBe('p2');
    expect(raiz(nodos, aristas, 'p3')).toBe('p3');
    // un id que no existe es su propia raíz
    expect(raiz(nodos, aristas, 'zzz')).toBe('zzz');
    expect(raiz([], [], 'a1')).toBe('a1');
    // el ejemplo no tiene ayudantes
    const ej = ejemplo();
    for (const n of ej.nodes) expect(raiz(ej.nodes, ej.edges, n.id), n.id).toBe(n.id);
  });

  it('constructor.grafo.raiz_con_dos_padres_manda_el_ultimo_igual_que_hay_ciclo_y_el_exportador', () => {
    // un flujo así no cumple `invariantesDelGrafo` (herramienta-con-varios-padres), pero las tres cuentas de «quién es la
    // raíz» deben dar lo mismo si alguna vez lo ven: aquí, la conexión que llega al final de la lista
    const g = [agente('a1'), agente('a2'), agente('a3')];
    const dosPadres = [arista('x', 'a1', 'a3', 'tool'), arista('y', 'a2', 'a3', 'tool')];
    expect(raiz(g, dosPadres, 'a3')).toBe('a2');
    expect(raiz(g, [...dosPadres].reverse(), 'a3')).toBe('a1');
  });

  it('constructor.grafo.raiz_no_se_cuelga_si_el_grafo_trae_un_circulo_de_ayudantes', () => {
    const circulo = [arista('e1', 'a1', 'a2', 'tool'), arista('e2', 'a2', 'a1', 'tool')];
    const r = raiz([agente('a1'), agente('a2')], circulo, 'a1');
    expect(['a1', 'a2']).toContain(r);
    // y una cadena larga se corta en 20 vueltas, no antes
    const largos = Array.from({ length: 30 }, (_, i) => agente(`n${i}`));
    const cadena = largos.slice(1).map((n, i) => arista(`c${i}`, `n${i}`, n.id, 'tool'));
    expect(raiz(largos, cadena, 'n29')).toBe('n9');
  });
});

describe('esAyudante y ayudantesDe', () => {
  it('constructor.grafo.es_ayudante_solo_para_un_agente_que_cuelga_de_otro_agente', () => {
    expect(esAyudante(nodos, aristas, 'a2')).toBe(true);
    expect(esAyudante(nodos, aristas, 'a3')).toBe(true);
    expect(esAyudante(nodos, aristas, 'a1')).toBe(false);
    expect(esAyudante(nodos, aristas, 'p1')).toBe(false); // herramienta, no ayudante
    expect(esAyudante(nodos, aristas, 'p3')).toBe(false);
    expect(esAyudante(nodos, aristas, 'zzz')).toBe(false);
    const ej = ejemplo();
    for (const n of ej.nodes) expect(esAyudante(ej.nodes, ej.edges, n.id), n.id).toBe(false);
    // un agente cuyo "padre" no es un agente (grafo roto) no es ayudante
    expect(esAyudante([app('p1'), agente('a1')], [arista('e1', 'p1', 'a1', 'tool')], 'a1')).toBe(false);
  });

  it('constructor.grafo.ayudantes_de_da_los_agentes_que_conversan_con_este_en_orden_y_sin_apps', () => {
    expect(ayudantesDe(nodos, aristas, 'a1').map(n => n.id)).toEqual(['a2']);
    expect(ayudantesDe(nodos, aristas, 'a2').map(n => n.id)).toEqual(['a3']);
    expect(ayudantesDe(nodos, aristas, 'a3')).toEqual([]); // su herramienta es una app
    expect(ayudantesDe(nodos, aristas, 'p1')).toEqual([]);
    expect(ayudantesDe(nodos, aristas, 'zzz')).toEqual([]);
    const varios = [agente('a1'), agente('a2'), agente('a3'), app('p1')];
    const e = [
      arista('e1', 'a1', 'a3', 'tool'),
      arista('e2', 'a1', 'p1', 'tool'),
      arista('e3', 'a1', 'a2', 'tool'),
      arista('e4', 'a1', 'a2', 'seq'),
    ];
    expect(ayudantesDe(varios, e, 'a1').map(n => n.id)).toEqual(['a3', 'a2']);
    // devuelve los cuadros mismos, no copias
    expect(ayudantesDe(varios, e, 'a1')[0]).toBe(varios[2]);
    const ej = ejemplo();
    expect(ayudantesDe(ej.nodes, ej.edges, 'a1')).toEqual([]);
  });
});

describe('casos borde', () => {
  it('constructor.grafo.ids_como_proto_constructor_y_to_string_no_rompen_los_helpers', () => {
    const raros = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];
    const ns: Nodo[] = [agente('__proto__'), agente('constructor'), app('toString'), agente('hasOwnProperty')];
    const es: Arista[] = [
      arista('e1', '__proto__', 'constructor', 'tool'),
      arista('e2', '__proto__', 'toString', 'tool'),
      arista('e3', 'constructor', 'hasOwnProperty', 'tool'),
    ];
    expect(padreDe(es, 'constructor')).toBe('__proto__');
    expect(padreDe(es, 'toString')).toBe('__proto__');
    expect(padreDe(es, '__proto__')).toBeNull();
    expect(raiz(ns, es, 'hasOwnProperty')).toBe('__proto__');
    expect(raiz(ns, es, 'toString')).toBe('toString');
    expect(esAyudante(ns, es, 'constructor')).toBe(true);
    expect(esAyudante(ns, es, 'toString')).toBe(false);
    expect(ayudantesDe(ns, es, '__proto__').map(n => n.id)).toEqual(['constructor']);
    expect(tienePadre(es, 'toString')).toBe(true);
    expect(tocaSeq(es, 'toString')).toBe(false);
    // y un id inexistente con esos nombres no encuentra nada
    for (const r of raros) {
      expect(padreDe([], r)).toBeNull();
      expect(raiz([], [], r)).toBe(r);
      expect(esAyudante([], [], r)).toBe(false);
      expect(ayudantesDe([], [], r)).toEqual([]);
      expect(tienePadre([], r)).toBe(false);
      expect(tocaSeq([], r)).toBe(false);
    }
  });

  it('constructor.grafo.los_helpers_no_modifican_lo_que_reciben', () => {
    // nodos y aristas están congelados arriba: cualquier escritura habría lanzado
    expect(() => {
      for (const n of nodos) {
        tienePadre(aristas, n.id);
        tocaSeq(aristas, n.id);
        padreDe(aristas, n.id);
        raiz(nodos, aristas, n.id);
        esAyudante(nodos, aristas, n.id);
        ayudantesDe(nodos, aristas, n.id);
      }
    }).not.toThrow();
    expect(Object.isFrozen(nodos)).toBe(true);
  });
});
