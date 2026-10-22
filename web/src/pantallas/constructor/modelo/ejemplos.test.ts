import { describe, expect, it } from 'vitest';

import { appDe } from './catalogo';
import {
  ANCHO_CUADRO,
  ALTO_CUADRO,
  ID_INICIAL,
  LARGO_NOMBRE_AGENTE,
  LARGO_NOMBRE_APP,
  LARGO_NOMBRE_FLUJO,
  TOPE_AGENTES,
  TOPE_APPS,
  TOPE_DISPARADORES,
  X_MAX,
  Y_MAX,
} from './datos/constantes';
import { ejemplo, EJEMPLOS, muestraDe, muestras, NOMBRE_EJEMPLO } from './ejemplos';
import { ayudantesDe, esAyudante, padreDe, tienePadre, tocaSeq } from './grafo';
import { conClave } from './secretos';
import type { Arista, Flujo, Nodo } from './tipos';

/**
 * Las reglas del grafo que debe cumplir cualquier flujo (informe 04 §1.5, G1–G11), revisadas con los
 * helpers de grafo.ts. Devuelve los códigos de lo que se viola: vacío = el flujo es válido.
 * La rejilla de 8 px no se exige: el ejemplo y las muestras traen y=180 y y=380, que no son múltiplos de 8.
 * (Cuando exista `invariantesDelGrafo` en grafo.ts, esa será la fuente; esto prueba los datos.)
 */
function violaciones(flujo: { nodes: Nodo[]; edges: Arista[] }): string[] {
  const { nodes, edges } = flujo;
  const v: string[] = [];
  const ids = nodes.map(n => n.id);
  const porId = new Map(nodes.map(n => [n.id, n]));
  if (new Set(ids).size !== ids.length) v.push('G1 ids de nodos repetidos');
  const idsE = edges.map(e => e.id);
  if (new Set(idsE).size !== idsE.length) v.push('G1 ids de aristas repetidos');
  const vistas = new Set<string>();
  for (const e of edges) {
    const de = porId.get(e.de);
    const a = porId.get(e.a);
    if (!de || !a) v.push(`G2 arista huérfana ${e.id}`);
    if (e.de === e.a) v.push(`G3 auto-arista ${e.id}`);
    if (e.tipo !== 'seq' && e.tipo !== 'tool') v.push(`G3 tipo inválido ${e.id}`);
    const clave = `${e.tipo}|${e.de}|${e.a}`;
    if (vistas.has(clave)) v.push(`G3 duplicada ${e.id}`);
    vistas.add(clave);
    if (a?.kind === 'trigger') v.push(`G4 llega algo al disparador ${e.id}`);
    if (e.tipo === 'tool' && de?.kind !== 'agent') v.push(`G5 tool.de no es agente ${e.id}`);
  }
  for (const n of nodes) {
    const padres = edges.filter(e => e.tipo === 'tool' && e.a === n.id);
    if (padres.length > 1) v.push(`G6 ${n.id} tiene ${padres.length} padres`);
    if (n.kind === 'agent' && esAyudante(nodes, edges, n.id) && edges.some(e => e.tipo === 'seq' && e.a === n.id)) {
      v.push(`G7 el ayudante ${n.id} recibe un seq`);
    }
    if (n.kind === 'app' && tienePadre(edges, n.id) && tocaSeq(edges, n.id)) v.push(`G7 la herramienta ${n.id} toca un seq`);
    if (![n.x, n.y].every(c => Number.isFinite(c) && c >= 0)) v.push(`G11 coordenadas inválidas en ${n.id}`);
    if (n.x > X_MAX || n.y > Y_MAX) v.push(`G11 fuera del lienzo ${n.id}`);
  }
  // G8: sin ciclos en seq ∪ tool (DFS con colores)
  const sale = new Map<string, string[]>();
  for (const e of edges) sale.set(e.de, [...(sale.get(e.de) ?? []), e.a]);
  const color = new Map<string, 1 | 2>();
  const visita = (u: string): boolean => {
    color.set(u, 1);
    for (const w of sale.get(u) ?? []) {
      if (color.get(w) === 1) return true;
      if (!color.has(w) && visita(w)) return true;
    }
    color.set(u, 2);
    return false;
  };
  if (nodes.some(n => !color.has(n.id) && visita(n.id))) v.push('G8 hay un ciclo');
  const cuantos = (k: Nodo['kind']) => nodes.filter(n => n.kind === k).length;
  if (cuantos('trigger') > TOPE_DISPARADORES) v.push('G9 más de un disparador');
  if (cuantos('agent') > TOPE_AGENTES) v.push('G10 más de 4 agentes');
  if (cuantos('app') > TOPE_APPS) v.push('G10 más de 8 apps');
  return v;
}

const caso = (nodes: Nodo[], edges: Arista[]) => ({ nodes, edges });

describe('el verificador de invariantes de esta prueba', () => {
  it('constructor.ejemplos.el_verificador_de_invariantes_detecta_cada_violacion_si_no_las_pruebas_de_abajo_no_probarian_nada', () => {
    const base = ejemplo();
    expect(violaciones(base)).toEqual([]);
    const con = (cambio: (f: Flujo) => void) => {
      const f = ejemplo();
      cambio(f);
      return violaciones(f);
    };
    const nuevaApp = (id: string, x = 8): Nodo => ({ id, kind: 'app', x, y: 8, nombre: 'Slack' });
    const nuevoAgente = (id: string): Nodo => ({
      id,
      kind: 'agent',
      x: 8,
      y: 8,
      nombre: id,
      ia: 'openai',
      tarea: '',
      instrucciones: '',
    });
    expect(con(f => f.nodes.push(nuevaApp('p1')))).toContain('G1 ids de nodos repetidos');
    expect(con(f => f.edges.push({ id: 'e1', de: 'a2', a: 'p2', tipo: 'seq' }))).toContain('G1 ids de aristas repetidos');
    expect(con(f => f.edges.push({ id: 'x', de: 'a1', a: 'zzz', tipo: 'seq' }))).toContain('G2 arista huérfana x');
    expect(con(f => f.edges.push({ id: 'x', de: 'a1', a: 'a1', tipo: 'seq' }))).toContain('G3 auto-arista x');
    expect(con(f => f.edges.push({ id: 'x', de: 't1', a: 'a1', tipo: 'seq' }))).toContain('G3 duplicada x');
    expect(con(f => f.edges.push({ id: 'x', de: 'a2', a: 't1', tipo: 'seq' }))).toContain('G4 llega algo al disparador x');
    expect(con(f => f.edges.push({ id: 'x', de: 'p1', a: 'p2', tipo: 'tool' }))).toContain('G5 tool.de no es agente x');
    expect(con(f => f.edges.push({ id: 'x', de: 'a2', a: 'p1', tipo: 'tool' }))).toContain('G6 p1 tiene 2 padres');
    expect(con(f => f.edges.push({ id: 'x', de: 'a1', a: 'p2', tipo: 'seq' }))).toContain('G7 la herramienta p2 toca un seq');
    expect(
      con(f => {
        f.edges.push({ id: 'x', de: 'a1', a: 'a2', tipo: 'tool' });
        f.edges = f.edges.filter(e => e.id !== 'e2');
        f.edges.push({ id: 'y', de: 'a2', a: 'a1', tipo: 'seq' });
      }),
    ).toContain('G8 hay un ciclo');
    expect(
      con(f => {
        f.nodes.push(nuevoAgente('a9'));
        f.edges.push({ id: 'x', de: 'a1', a: 'a9', tipo: 'tool' });
        f.edges.push({ id: 'y', de: 't1', a: 'a9', tipo: 'seq' });
      }),
    ).toContain('G7 el ayudante a9 recibe un seq');
    expect(con(f => f.nodes.push(...[3, 4, 5].map(n => nuevoAgente(`a${n}`))))).toContain('G10 más de 4 agentes');
    expect(con(f => f.nodes.push(...Array.from({ length: 7 }, (_, i) => nuevaApp(`p${i + 3}`))))).toContain('G10 más de 8 apps');
    expect(
      con(f =>
        f.nodes.push({ id: 't2', kind: 'trigger', x: 8, y: 8, tipo: 'chat', frec: 'dia', ruta: '', app: 'gmail' }),
      ),
    ).toContain('G9 más de un disparador');
    const colocar = (x: number, y: number) => (f: Flujo) => {
      const a1 = f.nodes.find(n => n.id === 'a1');
      if (a1) Object.assign(a1, { x, y });
    };
    expect(con(colocar(Number.NaN, 180))).toContain('G11 coordenadas inválidas en a1');
    expect(con(colocar(-8, 180))).toContain('G11 coordenadas inválidas en a1');
    // la rejilla de 8 NO es un invariante duro: el ejemplo trae y=180 y y=380 (no son múltiplos de 8)
    expect(con(colocar(13, 180))).toEqual([]);
    expect(con(colocar(312, 2408))).toContain('G11 fuera del lienzo a1');
    expect(violaciones(caso([], []))).toEqual([]);
  });
});

describe('ejemplo', () => {
  it('constructor.ejemplos.el_ejemplo_es_chat_atencion_a_clientes_revisor_con_sheets_y_slack_como_herramientas', () => {
    const e = ejemplo();
    expect(e.nombreFlujo).toBe('Atención a clientes');
    expect(NOMBRE_EJEMPLO).toBe(e.nombreFlujo);
    expect(e.nodes.map(n => [n.id, n.kind, n.x, n.y])).toEqual([
      ['t1', 'trigger', 8, 180],
      ['a1', 'agent', 312, 180],
      ['a2', 'agent', 616, 180],
      ['p1', 'app', 176, 380],
      ['p2', 'app', 480, 380],
    ]);
    expect(e.nodes[0]).toEqual({ id: 't1', kind: 'trigger', x: 8, y: 180, tipo: 'chat', frec: 'dia', ruta: 'mi-flujo', app: 'gmail' });
    expect(e.nodes[1]).toMatchObject({ nombre: 'Atención a clientes', ia: 'openai', tarea: '' });
    expect(e.nodes[2]).toMatchObject({ nombre: 'Revisor', ia: 'anthropic', tarea: '' });
    expect(e.nodes[1]).toHaveProperty('instrucciones', expect.stringContaining('hoja de Google Sheets'));
    expect(e.nodes[2]).toHaveProperty('instrucciones', expect.stringContaining('avisa al equipo en Slack'));
    expect(e.nodes[3]).toEqual({ id: 'p1', kind: 'app', x: 176, y: 380, nombre: 'Google Sheets' });
    expect(e.nodes[4]).toEqual({ id: 'p2', kind: 'app', x: 480, y: 380, nombre: 'Slack' });
    expect(e.edges).toEqual([
      { id: 'e1', de: 't1', a: 'a1', tipo: 'seq' },
      { id: 'e2', de: 'a1', a: 'a2', tipo: 'seq' },
      { id: 'e3', de: 'a1', a: 'p1', tipo: 'tool' },
      { id: 'e4', de: 'a2', a: 'p2', tipo: 'tool' },
    ]);
    // los ayudantes y las herramientas que se ven en el lienzo
    expect(padreDe(e.edges, 'p1')).toBe('a1');
    expect(padreDe(e.edges, 'p2')).toBe('a2');
    expect(e.nodes.some(n => esAyudante(e.nodes, e.edges, n.id))).toBe(false);
    expect(ayudantesDe(e.nodes, e.edges, 'a1')).toEqual([]);
  });

  it('constructor.ejemplos.cada_llamada_arma_objetos_nuevos_que_no_se_comparten', () => {
    const a = ejemplo();
    const b = ejemplo();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.nodes).not.toBe(b.nodes);
    expect(a.edges).not.toBe(b.edges);
    a.nodes.forEach((n, i) => expect(n).not.toBe(b.nodes[i]));
    a.edges.forEach((e, i) => expect(e).not.toBe(b.edges[i]));
    // cambiar uno no toca al otro ni a la siguiente llamada
    a.nodes.length = 0;
    a.edges.length = 0;
    a.nombreFlujo = 'otro';
    expect(ejemplo().nodes).toHaveLength(5);
    expect(ejemplo().nombreFlujo).toBe('Atención a clientes');
    const m1 = muestras();
    const m2 = muestras();
    expect(m1).toEqual(m2);
    m1[0]?.nodes.splice(0);
    m1[0]?.fuentes.push('x');
    expect(muestras()[0]?.nodes).toHaveLength(4);
    expect(muestras()[0]?.fuentes).toHaveLength(4);
    expect(muestraDe('correo').nodes).not.toBe(muestraDe('correo').nodes);
  });

  it('constructor.ejemplos.el_ejemplo_y_las_muestras_cumplen_los_invariantes_del_grafo', () => {
    expect(violaciones(ejemplo())).toEqual([]);
    for (const m of muestras()) expect(violaciones(m), m.nombre).toEqual([]);
  });

  it('constructor.ejemplos.los_ids_son_bajos_para_no_chocar_con_el_contador_y_los_textos_caben_en_sus_topes', () => {
    const flujos = [ejemplo(), ...muestras().map(m => ({ nodes: m.nodes, edges: m.edges, nombreFlujo: m.nombre }))];
    for (const f of flujos) {
      for (const id of [...f.nodes.map(n => n.id), ...f.edges.map(e => e.id)]) {
        const n = Number(id.slice(1));
        expect(Number.isInteger(n) && n >= 1 && n < ID_INICIAL, `${f.nombreFlujo}: ${id}`).toBe(true);
      }
      expect(f.nombreFlujo.length).toBeLessThanOrEqual(LARGO_NOMBRE_FLUJO);
      expect(f.nombreFlujo.trim()).not.toBe('');
      for (const n of f.nodes) {
        if (n.kind === 'agent') expect(n.nombre.length).toBeLessThanOrEqual(LARGO_NOMBRE_AGENTE);
        if (n.kind === 'app') expect(n.nombre.length).toBeLessThanOrEqual(LARGO_NOMBRE_APP);
        // ningún texto parece una clave
        const textos = n.kind === 'agent' ? [n.nombre, n.tarea, n.instrucciones] : n.kind === 'app' ? [n.nombre] : [n.ruta];
        for (const t of textos) expect(conClave(t), `${f.nombreFlujo}/${n.id}`).toBe(false);
      }
    }
  });

  it('constructor.ejemplos.en_el_ejemplo_y_las_muestras_ningun_cuadro_se_encima_con_otro', () => {
    const flujos = [ejemplo(), ...muestras()];
    for (const f of flujos) {
      for (const [i, a] of f.nodes.entries()) {
        for (const b of f.nodes.slice(i + 1)) {
          const encima = Math.abs(a.x - b.x) < ANCHO_CUADRO && Math.abs(a.y - b.y) < ALTO_CUADRO;
          expect(encima, `${a.id} y ${b.id}`).toBe(false);
        }
      }
    }
  });

  it('constructor.ejemplos.todas_las_apps_de_las_muestras_tienen_conector_y_todas_las_ia_existen', () => {
    for (const f of [ejemplo(), ...muestras()]) {
      for (const n of f.nodes) {
        if (n.kind === 'app') expect(appDe(n.nombre), n.nombre).not.toBeNull();
        if (n.kind === 'agent') expect(['openai', 'anthropic', 'gemini', 'openrouter']).toContain(n.ia);
        if (n.kind === 'trigger') {
          expect(['tiempo', 'chat', 'web', 'app']).toContain(n.tipo);
          expect(['hora', 'dia', 'lunes']).toContain(n.frec);
          expect(['gmail', 'telegram']).toContain(n.app);
        }
      }
    }
  });
});

describe('muestras', () => {
  it('constructor.ejemplos.las_tres_muestras_son_las_del_mockup_con_sus_coordenadas', () => {
    const lista = muestras();
    expect(lista.map(m => m.nombre)).toEqual([
      'Responder correos de clientes',
      'Asistente de preguntas frecuentes',
      'Resumen diario',
    ]);
    expect(lista.map(m => m.claves)).toEqual([
      ['correo', 'gmail', 'email', 'mail'],
      ['chat', 'preguntas', 'whatsapp', 'telegram', 'investig'],
      [],
    ]);
    const [correos, preguntas, resumen] = lista;
    expect(correos?.nodes.map(n => [n.id, n.kind, n.x, n.y])).toEqual([
      ['t1', 'trigger', 8, 180],
      ['a1', 'agent', 312, 180],
      ['p1', 'app', 176, 380],
      ['p2', 'app', 616, 180],
    ]);
    expect(correos?.nodes[0]).toMatchObject({ tipo: 'app', app: 'gmail' });
    expect(correos?.edges).toEqual([
      { id: 'e1', de: 't1', a: 'a1', tipo: 'seq' },
      { id: 'e2', de: 'a1', a: 'p2', tipo: 'seq' },
      { id: 'e3', de: 'a1', a: 'p1', tipo: 'tool' },
    ]);
    expect(correos?.fuentes).toEqual([
      'Llega un correo (Gmail)',
      'Agente de IA',
      'Google Sheets (lo consulta el agente)',
      'Gmail (paso final)',
    ]);
    expect(preguntas?.nodes.map(n => [n.id, n.kind, n.x, n.y])).toEqual([
      ['t1', 'trigger', 8, 180],
      ['a1', 'agent', 312, 180],
      ['a2', 'agent', 616, 180],
      ['p1', 'app', 176, 380],
    ]);
    expect(preguntas?.nodes[0]).toMatchObject({ tipo: 'chat' });
    expect(preguntas?.nodes[1]).toMatchObject({ nombre: 'Atención', ia: 'anthropic' });
    expect(preguntas?.nodes[2]).toMatchObject({ nombre: 'Revisor', ia: 'openai' });
    expect(preguntas?.nodes[3]).toMatchObject({ nombre: 'Notion' });
    expect(preguntas?.edges).toEqual([
      { id: 'e1', de: 't1', a: 'a1', tipo: 'seq' },
      { id: 'e2', de: 'a1', a: 'a2', tipo: 'seq' },
      { id: 'e3', de: 'a1', a: 'p1', tipo: 'tool' },
    ]);
    expect(preguntas?.fuentes).toEqual([
      'Alguien escribe en el chat',
      'Agente de IA',
      'Otro agente de IA (va después)',
      'Notion (lo consulta el agente)',
    ]);
    expect(resumen?.nodes.map(n => [n.id, n.kind, n.x, n.y])).toEqual([
      ['t1', 'trigger', 8, 180],
      ['a1', 'agent', 312, 180],
      ['p1', 'app', 616, 80],
      ['p2', 'app', 616, 288],
    ]);
    expect(resumen?.nodes[0]).toMatchObject({ tipo: 'tiempo', frec: 'dia' });
    expect(resumen?.nodes[1]).toMatchObject({ nombre: 'Resumidor', ia: 'openai', tarea: 'Prepara un resumen de lo importante del día.' });
    expect(resumen?.nodes[2]).toMatchObject({ nombre: 'Gmail' });
    expect(resumen?.nodes[3]).toMatchObject({ nombre: 'Slack' });
    expect(resumen?.edges).toEqual([
      { id: 'e1', de: 't1', a: 'a1', tipo: 'seq' },
      { id: 'e2', de: 'a1', a: 'p1', tipo: 'seq' },
      { id: 'e3', de: 'a1', a: 'p2', tipo: 'seq' },
    ]);
    expect(resumen?.fuentes).toEqual(['Cada día', 'Agente de IA', 'Gmail (paso)', 'Slack (paso)']);
  });

  it('constructor.ejemplos.muestra_de_elige_por_palabras_clave_sin_mayusculas_ni_acentos_y_cae_en_la_ultima', () => {
    const nombre = (t: unknown) => muestraDe(t).nombre;
    expect(nombre('Quiero responder un CORREO de un cliente')).toBe('Responder correos de clientes');
    expect(nombre('mi gmail')).toBe('Responder correos de clientes');
    expect(nombre('un EMAIL')).toBe('Responder correos de clientes');
    expect(nombre('Chat')).toBe('Asistente de preguntas frecuentes');
    expect(nombre('preguntas de clientes')).toBe('Asistente de preguntas frecuentes');
    expect(nombre('por WhatsApp')).toBe('Asistente de preguntas frecuentes');
    expect(nombre('Telegram')).toBe('Asistente de preguntas frecuentes');
    expect(nombre('Investigar a la competencia')).toBe('Asistente de preguntas frecuentes');
    // gana la primera de la lista: «correo» y «chat» juntos eligen la de correos
    expect(nombre('un chat y un correo')).toBe('Responder correos de clientes');
    // sin palabra clave (o sin texto), la de reserva
    for (const raro of ['', '   ', 'Hola mundo', 'nada que ver', null, undefined, 0]) {
      expect(nombre(raro), String(raro)).toBe('Resumen diario');
    }
    // las claves se buscan dentro de las palabras (como en el mockup): «correos» y «chats» también valen
    expect(nombre('mis correos')).toBe('Responder correos de clientes');
    expect(nombre('nombres como __proto__ o constructor')).toBe('Resumen diario');
    // la muestra elegida es un flujo válido
    expect(violaciones(muestraDe('chat'))).toEqual([]);
  });

  it('constructor.ejemplos.las_frases_de_ejemplo_del_asistente_son_tres_y_caben_en_los_limites_de_la_api', () => {
    expect(EJEMPLOS).toEqual([
      'Cuando me llegue un correo de un cliente, que una IA le conteste y lo anote en una hoja de cálculo',
      'Un chat donde mis clientes pregunten lo de siempre, una IA les responda y otra IA revise la respuesta',
      'Cada mañana, un resumen de lo importante por correo y por Slack',
    ]);
    // la API del Asistente pide entre 20 y 1500 caracteres
    for (const frase of EJEMPLOS) {
      expect(frase.length).toBeGreaterThanOrEqual(20);
      expect(frase.length).toBeLessThanOrEqual(1500);
    }
    // cada frase elige una muestra (la tercera, por tener «correo», elige la de correos: es el comportamiento del mockup)
    expect(EJEMPLOS.map(f => muestraDe(f).nombre)).toEqual([
      'Responder correos de clientes',
      'Asistente de preguntas frecuentes',
      'Responder correos de clientes',
    ]);
  });
});
