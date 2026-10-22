import { describe, expect, it } from 'vitest';

import { ejemplo, muestras } from './ejemplos';
import { codigoDeViolacion, invariantesDelGrafo } from './grafo';
import {
  type Almacen,
  CLAVE_BORRADOR,
  crearBorrador,
  LARGO_DESC_AYUDANTE,
  LARGO_RUTA,
  LARGO_TEXTO_AGENTE,
  leerBorrador,
  MAX_ARISTAS_BORRADOR,
  MAX_CARACTERES_BORRADOR,
  type MotivoNoCarga,
  normalizarFlujo,
  prepararTraspaso,
  serializarBorrador,
  seDescarto,
  TEXTO_NO_GUARDADO,
  TEXTO_NO_RECUPERADO,
  VERSION_BORRADOR,
} from './borrador';
import type { EstadoConstructor, Arista, Flujo, Nodo, NodoAgente, NodoApp, NodoDisparador, TipoArista } from './tipos';

// ---------------------------------------------------------------- constructores y almacenes de prueba

const agente = (id: string, x: number, y: number, nombre: string, extra: Partial<NodoAgente> = {}): NodoAgente => ({
  id,
  kind: 'agent',
  x,
  y,
  nombre,
  ia: 'openai',
  tarea: '',
  instrucciones: 'Sé breve.',
  ...extra,
});
const app = (id: string, x: number, y: number, nombre: string): NodoApp => ({ id, kind: 'app', x, y, nombre });
const disparador = (extra: Partial<NodoDisparador> = {}): NodoDisparador => ({
  id: 't1',
  kind: 'trigger',
  x: 8,
  y: 180,
  tipo: 'chat',
  frec: 'dia',
  ruta: 'mi-flujo',
  app: 'gmail',
  ...extra,
});
const arista = (id: string, de: string, a: string, tipo: TipoArista): Arista => ({ id, de, a, tipo });
const flujoDe = (nodes: Nodo[], edges: Arista[], nombreFlujo = 'Mi flujo'): Flujo => ({ nodes, edges, nombreFlujo });

/** Un almacenamiento en memoria que anota cada llamada. */
function memoria(inicial: Record<string, string> = {}) {
  const datos = new Map(Object.entries(inicial));
  const llamadas: string[] = [];
  const almacen: Almacen = {
    getItem: k => {
      llamadas.push(`get ${k}`);
      return datos.get(k) ?? null;
    },
    setItem: (k, v) => {
      llamadas.push(`set ${k}`);
      datos.set(k, v);
    },
    removeItem: k => {
      llamadas.push(`rm ${k}`);
      datos.delete(k);
    },
  };
  return { almacen, datos, llamadas };
}

/** El texto de un borrador, tal como lo escribiría `guardar`, con los cambios que se quieran. */
function crudoDe(flujo: Flujo, cambios: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: VERSION_BORRADOR, nodes: flujo.nodes, edges: flujo.edges, nombreFlujo: flujo.nombreFlujo, ...cambios });
}

/** Un borrador con un cambio en el JSON ya armado (para estropear justo un campo). */
function estropeado(cambiar: (d: Record<string, unknown> & { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }) => void): string {
  const d = JSON.parse(crudoDe(ejemplo())) as Record<string, unknown> & { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
  cambiar(d);
  return JSON.stringify(d);
}

const cargarDe = (crudo: string) => crearBorrador(memoria({ [CLAVE_BORRADOR]: crudo }).almacen).cargar();

/** Cadenas armadas por pedazos: así ninguna parece una clave de verdad al revisar el repo (como en secretos.test.ts). */
const repite = (c: string, n: number) => c.repeat(n);
const CLAVES: Record<string, string> = {
  openai: `${'s'}k-${repite('a', 20)}`,
  google: `${'AI'}za${repite('b', 35)}`,
  slack: `${'x'}oxb-${repite('1', 10)}`,
  github: `${'g'}hp_${repite('c', 30)}`,
  telegram: `${repite('1', 9)}:${repite('d', 35)}`,
  bearer: `${'bea'}rer ${repite('e', 20)}`,
  pem: `-----BEGIN ${'RSA PRIV'}ATE KEY-----`,
  aws: `${'AK'}IA${repite('F', 16)}`,
};

/** Un flujo con el máximo de todo: 1 disparador, 4 agentes y 8 apps, con los textos en su tope. */
function flujoLleno(): Flujo {
  const nodes: Nodo[] = [disparador({ tipo: 'web', ruta: repite('r', LARGO_RUTA) })];
  for (let i = 1; i <= 4; i += 1) {
    nodes.push(
      agente(`a${i}`, 200 * i, 40 + 100 * i, repite('n', 60), {
        tarea: repite('t', LARGO_TEXTO_AGENTE),
        instrucciones: repite('i', LARGO_TEXTO_AGENTE),
        desc: repite('d', LARGO_DESC_AYUDANTE),
      }),
    );
  }
  for (let i = 1; i <= 8; i += 1) nodes.push(app(`p${i}`, 100 * i, 800, repite('x', 60)));
  const edges: Arista[] = [arista('e1', 't1', 'a1', 'seq')];
  for (let i = 1; i <= 7; i += 1) edges.push(arista(`e${i + 1}`, `a1`, `p${i}`, 'seq'));
  return flujoDe(nodes, edges, repite('F', 80));
}

// ---------------------------------------------------------------- guardar y cargar

describe('guardar y cargar', () => {
  it('constructor.borrador.la_llave_lleva_la_version_y_se_guardan_solo_nodes_edges_y_nombre_del_flujo', () => {
    const { almacen, datos } = memoria();
    const r = crearBorrador(almacen).guardar(ejemplo());
    expect(r).toMatchObject({ ok: true, accion: 'guardado', recortes: [] });
    expect(CLAVE_BORRADOR).toBe('constructor.borrador.v1');
    expect([...datos.keys()]).toEqual([CLAVE_BORRADOR]);
    const texto = datos.get(CLAVE_BORRADOR) ?? '';
    expect(r.ok && r.caracteres).toBe(texto.length);
    const guardado = JSON.parse(texto) as Record<string, unknown>;
    expect(Object.keys(guardado)).toEqual(['v', 'nodes', 'edges', 'nombreFlujo']);
    expect(guardado.v).toBe(1);
    expect(guardado.nombreFlujo).toBe('Atención a clientes');

    // aunque le pasen el estado entero del Constructor, solo se guardan esos tres campos
    const entero = {
      flujo: ejemplo(),
      ...ejemplo(),
      sel: 'a1',
      selEdge: 'e1',
      menu: { ancla: 'a1', tipo: 'seq', paso: 'inicio', insertarEn: null },
      conectando: null,
      historial: [{ nodes: [], edges: [], sel: null, texto: 'x' }],
      siguiente: 30,
      aviso: { id: 1, texto: 'hola', tipo: 'ok', conDeshacer: false },
    } satisfies Partial<EstadoConstructor> & Flujo;
    const { almacen: otro, datos: datos2 } = memoria();
    expect(crearBorrador(otro).guardar(entero).ok).toBe(true);
    const guardado2 = JSON.parse(datos2.get(CLAVE_BORRADOR) ?? '{}') as Record<string, unknown>;
    expect(Object.keys(guardado2)).toEqual(['v', 'nodes', 'edges', 'nombreFlujo']);
    expect(JSON.stringify(guardado2)).not.toMatch(/historial|siguiente|aviso|menu|conectando|selEdge/);
  });

  it('constructor.borrador.ida_y_vuelta_exacta_del_ejemplo_las_muestras_y_un_flujo_con_todos_los_campos_y_textos_raros', () => {
    const raro: Flujo = flujoDe(
      [
        disparador({ tipo: 'app', app: 'telegram', ruta: 'Mi Flujo Ñandú!', frec: 'lunes' }),
        agente('a1', 312, 180, 'Atención «con» acentos ñ ü 😀', {
          tarea: 'Línea 1\nLínea 2\t"entre comillas" \\ barra {{ llaves }} =igual',
          instrucciones: '',
          desc: '',
          ia: 'openrouter',
        }),
        agente('a2', 616, 180, '   espacios al borde   ', { desc: 'Revisa.', ia: 'gemini' }),
        app('p1', 0, 0, ''),
        app('p2', 2400, 2400, '__proto__'),
        app('p3', 8.5, 12.25, 'constructor'),
      ],
      [arista('e1', 't1', 'a1', 'seq'), arista('e2', 'a1', 'a2', 'tool'), arista('e3', 'a1', 'p1', 'tool')],
      '  Nombre con espacios y 😀  ',
    );
    const casos: Flujo[] = [
      ejemplo(),
      ...muestras().map(m => flujoDe(m.nodes, m.edges, m.nombre)),
      raro,
      flujoLleno(),
      flujoDe([agente('a1', 0, 0, 'Solo')], [], ''),
    ];
    for (const f of casos) {
      const b = crearBorrador(memoria().almacen);
      const g = b.guardar(f);
      expect(g.ok, f.nombreFlujo).toBe(true);
      const c = b.cargar();
      expect(c.ok, f.nombreFlujo).toBe(true);
      if (!c.ok) continue;
      expect(c.flujo).toEqual(f);
      expect(c.origen).toBeNull();
      expect(c.recortes).toEqual([]);
      // y es otro objeto: quien lo reciba puede guardarlo en su estado sin compartir nada con el borrador ni con la entrada
      expect(c.flujo).not.toBe(f);
      expect(c.flujo.nodes[0]).not.toBe(f.nodes[0]);
      // el texto que sale es idéntico al volver a guardarlo
      expect(serializarBorrador(c.flujo)).toEqual(serializarBorrador(f));
    }
    // un -0 no sobrevive a JSON: se guarda como 0 y vuelve como 0 (no se lee distinto)
    const cero = flujoDe([agente('a1', -0, -0, 'Cero')], []);
    const b = crearBorrador(memoria().almacen);
    b.guardar(cero);
    const c = b.cargar();
    expect(c.ok && Object.is(c.flujo.nodes[0]?.x, 0)).toBe(true);
  });

  it('constructor.borrador.sin_nada_guardado_no_hay_borrador_y_no_es_algo_que_avisar', () => {
    const { almacen, llamadas } = memoria();
    const r = crearBorrador(almacen).cargar();
    expect(r).toEqual({ ok: false, motivo: 'vacio', detalle: [] });
    expect(seDescarto('vacio')).toBe(false);
    expect(llamadas).toEqual([`get ${CLAVE_BORRADOR}`]);
    // un texto vacío o un borrador sin cuadros tampoco son un borrador
    expect(cargarDe('')).toMatchObject({ ok: false, motivo: 'vacio' });
    expect(cargarDe(crudoDe(flujoDe([], [])))).toMatchObject({ ok: false, motivo: 'vacio' });
  });

  it('constructor.borrador.un_json_roto_o_que_no_es_un_borrador_se_descarta_sin_lanzar', () => {
    const rotos = ['{', '{"v":1,', 'basura', 'undefined', 'null', 'true', '123', '"hola"', '[]', '[1,2,3]', '{}', '{"v":1}', 'NaN', "{'v':1}", '\u0000', '{"v":1,"nodes":'];
    for (const crudo of rotos) {
      const r = cargarDe(crudo);
      expect(r.ok, crudo).toBe(false);
      if (r.ok) continue;
      expect(['json-roto', 'forma'], crudo).toContain(r.motivo);
      expect(seDescarto(r.motivo)).toBe(true);
    }
    expect(cargarDe('{"v":1,')).toMatchObject({ motivo: 'json-roto' });
    expect(cargarDe('null')).toMatchObject({ motivo: 'forma' });
    // un anidado profundo que reviente al leerlo también se descarta
    expect(() => cargarDe('['.repeat(150_000))).not.toThrow();
    expect(cargarDe('['.repeat(150_000)).ok).toBe(false);
  });

  it('constructor.borrador.una_version_futura_o_que_no_es_un_entero_se_descarta_sin_tocar_lo_guardado', () => {
    const futuro = crudoDe(ejemplo(), { v: 2 });
    const { almacen, datos, llamadas } = memoria({ [CLAVE_BORRADOR]: futuro });
    const b = crearBorrador(almacen);
    expect(b.cargar()).toEqual({ ok: false, motivo: 'version-futura', detalle: ['v2'] });
    expect(seDescarto('version-futura')).toBe(true);
    // cargar no escribe ni borra: una versión más nueva de la herramienta aún podría necesitarlo
    expect(datos.get(CLAVE_BORRADOR)).toBe(futuro);
    expect(llamadas.every(l => l.startsWith('get '))).toBe(true);
    expect(cargarDe(crudoDe(ejemplo(), { v: 99 }))).toMatchObject({ motivo: 'version-futura' });
    for (const v of [0, -1, 1.5, '1', null, true, [], {}]) {
      expect(cargarDe(crudoDe(ejemplo(), { v })), JSON.stringify(v)).toMatchObject({ ok: false, motivo: 'forma', detalle: ['v'] });
    }
    // sin versión
    expect(cargarDe(estropeado(d => void delete d.v))).toMatchObject({ ok: false, motivo: 'forma' });
    // y un guardado normal sí pisa el futuro
    expect(b.guardar(ejemplo()).ok).toBe(true);
    expect(b.cargar().ok).toBe(true);
  });

  it('constructor.borrador.una_forma_que_no_es_la_esperada_se_descarta_diciendo_donde', () => {
    const casos: [string, (d: Parameters<Parameters<typeof estropeado>[0]>[0]) => void, string][] = [
      ['nodes no es lista', d => void (d.nodes = {} as never), 'nodes'],
      ['nodes falta', d => void delete (d as Record<string, unknown>).nodes, 'nodes'],
      ['edges no es lista', d => void ((d as Record<string, unknown>).edges = 'x'), 'edges'],
      ['un cuadro no es objeto', d => void (d.nodes[1] = 'a1' as never), 'nodes[1]'],
      ['un cuadro es null', d => void (d.nodes[0] = null as never), 'nodes[0]'],
      ['sin id', d => void delete d.nodes[0]?.id, 'nodes[0].id'],
      ['id no es texto', d => void (d.nodes[0]!.id = 5), 'nodes[0].id'],
      ['id con espacios', d => void (d.nodes[2]!.id = 'a 2'), 'nodes[2].id'],
      ['id vacío', d => void (d.nodes[2]!.id = ''), 'nodes[2].id'],
      ['id demasiado largo', d => void (d.nodes[2]!.id = repite('a', 33)), 'nodes[2].id'],
      ['id que empieza con número', d => void (d.nodes[2]!.id = '1a'), 'nodes[2].id'],
      ['kind que no existe', d => void (d.nodes[1]!.kind = 'robot'), 'nodes[1].kind'],
      ['x es texto', d => void (d.nodes[1]!.x = '312'), 'nodes[1].x'],
      ['y es null (así viaja un NaN por JSON)', d => void (d.nodes[1]!.y = null), 'nodes[1].y'],
      ['tipo de disparador que no existe', d => void (d.nodes[0]!.tipo = 'correo'), 'nodes[0].tipo'],
      ['frecuencia que no existe', d => void (d.nodes[0]!.frec = 'mes'), 'nodes[0].frec'],
      ['app de disparador que no existe', d => void (d.nodes[0]!.app = 'whatsapp'), 'nodes[0].app'],
      ['ruta no es texto', d => void (d.nodes[0]!.ruta = 7), 'nodes[0].ruta'],
      ['falta un campo del disparador', d => void delete d.nodes[0]!.ruta, 'nodes[0].ruta'],
      ['IA que no se ofrece', d => void (d.nodes[1]!.ia = 'mistral'), 'nodes[1].ia'],
      ['nombre del agente no es texto', d => void (d.nodes[1]!.nombre = 3), 'nodes[1].nombre'],
      ['tarea no es texto', d => void (d.nodes[1]!.tarea = ['x']), 'nodes[1].tarea'],
      ['instrucciones faltan', d => void delete d.nodes[1]!.instrucciones, 'nodes[1].instrucciones'],
      ['desc no es texto', d => void (d.nodes[2]!.desc = 4), 'nodes[2].desc'],
      ['nombre de la app no es texto', d => void (d.nodes[3]!.nombre = {}), 'nodes[3].nombre'],
      ['una conexión no es objeto', d => void (d.edges[0] = 7 as never), 'edges[0]'],
      ['conexión sin origen', d => void delete d.edges[1]!.de, 'edges[1].de'],
      ['conexión a un id inválido', d => void (d.edges[1]!.a = '__proto__'), 'edges[1].a'],
      ['tipo de conexión que no existe', d => void (d.edges[2]!.tipo = 'both'), 'edges[2].tipo'],
      ['id de conexión inválido', d => void (d.edges[2]!.id = 'e 3'), 'edges[2].id'],
      ['nombreFlujo no es texto', d => void ((d as Record<string, unknown>).nombreFlujo = 12), 'nombreFlujo'],
      ['nombreFlujo falta', d => void delete (d as Record<string, unknown>).nombreFlujo, 'nombreFlujo'],
    ];
    expect(casos.length).toBeGreaterThan(30);
    for (const [nombre, cambiar, lugar] of casos) {
      const r = cargarDe(estropeado(cambiar));
      expect(r, nombre).toEqual({ ok: false, motivo: 'forma', detalle: [lugar] });
    }
    // un número tan grande que JSON.parse lo lee como infinito
    const infinito = estropeado(d => void (d.nodes[1]!.x = 123456789)).replace('123456789', '1e999');
    expect(cargarDe(infinito)).toEqual({ ok: false, motivo: 'forma', detalle: ['nodes[1].x'] });
  });

  it('constructor.borrador.los_nombres_de_prototipo_como_id_y_los_campos_inyectados_no_pasan_ni_contaminan', () => {
    for (const id of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'prototype', 'isPrototypeOf']) {
      const r = cargarDe(estropeado(d => void (d.nodes[3]!.id = id)));
      // `prototype` no es un nombre de Object.prototype: es un id normal
      if (id === 'prototype') expect(r.ok, id).toBe(false); // el cuadro p1 ya no existe: la conexión e3 queda huérfana
      else expect(r, id).toEqual({ ok: false, motivo: 'forma', detalle: ['nodes[3].id'] });
    }
    // un borrador escrito a mano con `__proto__` y `constructor` como campos de la raíz, de un cuadro y de una conexión
    const texto = crudoDe(ejemplo()).replace(
      '{"v":1,',
      '{"v":1,"__proto__":{"polluted":true,"nodes":[]},"constructor":{"prototype":{"polluted":true}},',
    ).replace('"id":"t1"', '"__proto__":{"kind":"agent","polluted":true},"constructor":"x","isAdmin":true,"id":"t1"')
      .replace('"id":"e1"', '"__proto__":{"polluted":true},"id":"e1","extra":{"a":1}');
    expect(texto).toContain('"__proto__"');
    const r = cargarDe(texto);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.flujo).toEqual(ejemplo());
    for (const n of r.flujo.nodes) {
      expect(Object.hasOwn(n, '__proto__')).toBe(false);
      expect(Object.hasOwn(n, 'constructor')).toBe(false);
      expect(Object.keys(n).sort()).toEqual(Object.keys(ejemplo().nodes.find(x => x.id === n.id) ?? {}).sort());
    }
    for (const e of r.flujo.edges) expect(Object.keys(e).sort()).toEqual(['a', 'de', 'id', 'tipo']);
    expect(Object.hasOwn(r.flujo, '__proto__')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(Object.prototype)).toEqual([]);

    // un `__proto__` en la raíz SIN `nodes` propio no presta los suyos
    const sinPropios = cargarDe('{"v":1,"__proto__":{"nodes":[],"edges":[],"nombreFlujo":"x"}}');
    expect(sinPropios).toMatchObject({ ok: false, motivo: 'forma', detalle: ['nodes'] });

    // y lo heredado de Object.prototype tampoco cuenta (aunque alguien lo hubiera contaminado)
    Object.defineProperty(Object.prototype, 'nodes', { value: ejemplo().nodes, configurable: true, enumerable: false });
    try {
      expect(cargarDe('{"v":1}')).toMatchObject({ ok: false, motivo: 'forma', detalle: ['nodes'] });
      expect(normalizarFlujo({})).toMatchObject({ ok: false, motivo: 'forma' });
    } finally {
      delete (Object.prototype as Record<string, unknown>).nodes;
    }
    expect(Object.hasOwn(Object.prototype, 'nodes')).toBe(false);
  });

  it('constructor.borrador.los_textos_largos_se_recortan_a_su_tope_sin_partir_un_emoji_y_se_dice_cuales', () => {
    const largo = (n: number) => repite('z', n);
    const f = ejemplo();
    const a1 = f.nodes.find(n => n.id === 'a1');
    const p1 = f.nodes.find(n => n.id === 'p1');
    const t1 = f.nodes.find(n => n.id === 't1');
    const a2 = f.nodes.find(n => n.id === 'a2');
    if (a1?.kind !== 'agent' || p1?.kind !== 'app' || t1?.kind !== 'trigger' || a2?.kind !== 'agent') throw new Error('el ejemplo ya no es el de siempre');
    Object.assign(a1, { nombre: largo(100), tarea: largo(LARGO_TEXTO_AGENTE + 500), instrucciones: largo(LARGO_TEXTO_AGENTE * 2) });
    Object.assign(a2, { nombre: `${repite('e', 59)}😀`, desc: largo(LARGO_DESC_AYUDANTE + 1) });
    Object.assign(p1, { nombre: largo(61) });
    Object.assign(t1, { ruta: largo(LARGO_RUTA + 1) });
    f.nombreFlujo = largo(200);
    const r = cargarDe(crudoDe(f));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const n = (id: string) => r.flujo.nodes.find(x => x.id === id);
    expect(n('a1')).toMatchObject({ nombre: largo(60), tarea: largo(LARGO_TEXTO_AGENTE), instrucciones: largo(LARGO_TEXTO_AGENTE) });
    expect(n('p1')).toMatchObject({ nombre: largo(60) });
    expect(n('t1')).toMatchObject({ ruta: largo(LARGO_RUTA) });
    expect(n('a2')).toMatchObject({ desc: largo(LARGO_DESC_AYUDANTE) });
    expect(r.flujo.nombreFlujo).toBe(largo(80));
    // el emoji que caía justo en el borde se quita entero: no queda la mitad
    const cortado = (n('a2') as NodoAgente).nombre;
    expect(cortado).toBe(repite('e', 59));
    expect(cortado).not.toMatch(/[\ud800-\udbff]$/);
    expect(r.recortes.sort()).toEqual(
      ['a1.instrucciones', 'a1.nombre', 'a1.tarea', 'a2.desc', 'a2.nombre', 'nombreFlujo', 'p1.nombre', 't1.ruta'].sort(),
    );
    // lo que está justo en el tope NO se recorta
    const exacto = cargarDe(crudoDe(flujoLleno()));
    expect(exacto).toMatchObject({ ok: true, recortes: [] });
    // y al guardar también: se guarda recortado y se dice
    const { almacen } = memoria();
    const g = crearBorrador(almacen).guardar(f);
    expect(g).toMatchObject({ ok: true, accion: 'guardado' });
    expect(g.ok && g.recortes.sort()).toEqual(r.recortes.sort());
  });

  it('constructor.borrador.un_flujo_que_viola_los_invariantes_o_los_topes_se_descarta_con_los_codigos', () => {
    const base = (): Flujo => ejemplo();
    const con = (cambiar: (f: Flujo) => void): Flujo => {
      const f = base();
      cambiar(f);
      return f;
    };
    const muchos = (n: number, hacer: (i: number) => Nodo): Nodo[] => Array.from({ length: n }, (_, i) => hacer(i + 1));
    const casos: [string, Flujo, string[]][] = [
      ['ids de cuadros repetidos', con(f => void f.nodes.push(app('p1', 900, 900, 'Otra'))), ['ids-nodos-duplicados']],
      ['ids de conexiones repetidos', con(f => void f.edges.push(arista('e1', 'a1', 'p2', 'seq'))), ['ids-aristas-duplicados']],
      ['conexión huérfana', con(f => void f.edges.push(arista('e9', 'a1', 'zzz', 'seq'))), ['arista-huerfana']],
      ['una conexión a sí mismo', con(f => void f.edges.push(arista('e9', 'a2', 'a2', 'seq'))), ['arista-a-si-mismo', 'ciclo-de-pasos', 'ciclo-mixto']],
      ['algo llega al disparador', con(f => void f.edges.push(arista('e9', 'a2', 't1', 'seq'))), ['llega-al-disparador', 'ciclo-de-pasos', 'ciclo-mixto']],
      ['un círculo de pasos', con(f => void f.edges.push(arista('e9', 'a2', 'a1', 'seq'))), ['ciclo-de-pasos', 'ciclo-mixto']],
      ['dos disparadores', con(f => void f.nodes.push(disparador({ id: 't2', x: 8, y: 500 }))), ['varios-disparadores']],
      [
        'cinco agentes',
        con(f => void f.nodes.push(agente('a3', 900, 100, 'C'), agente('a4', 900, 300, 'D'), agente('a5', 900, 500, 'E'))),
        ['tope-agentes'],
      ],
      ['nueve apps', con(f => void f.nodes.push(...muchos(7, i => app(`q${i}`, 100 * i, 1000, `App ${i}`)))), ['tope-apps']],
      ['un cuadro fuera del lienzo', con(f => void Object.assign(f.nodes[1] ?? {}, { x: 2401 })), ['caja-fuera-del-lienzo']],
      ['un cuadro con coordenada negativa', con(f => void Object.assign(f.nodes[1] ?? {}, { y: -8 })), ['caja-fuera-del-lienzo']],
      ['una herramienta con dos padres', con(f => void f.edges.push(arista('e9', 'a2', 'p1', 'tool'))), ['herramienta-con-varios-padres']],
      ['una herramienta que no sale de un agente', con(f => void f.edges.push(arista('e9', 'p1', 'p2', 'tool'))), ['herramienta-de-no-agente', 'herramienta-con-varios-padres']],
    ];
    for (const [nombre, f, codigos] of casos) {
      const r = cargarDe(crudoDe(f));
      expect(r.ok, nombre).toBe(false);
      if (r.ok) continue;
      expect(r.motivo, nombre).toBe('invalido');
      for (const c of codigos) expect(r.detalle, nombre).toContain(c);
      // lo mismo que dice la validación del grafo
      const reales = new Set(invariantesDelGrafo(f.nodes, f.edges).map(codigoDeViolacion));
      expect(new Set(r.detalle), nombre).toEqual(reales);
      // y guardarlo tampoco: no escribe nada y deja lo que había
      const { almacen, datos } = memoria({ [CLAVE_BORRADOR]: crudoDe(ejemplo()) });
      const g = crearBorrador(almacen).guardar(f);
      expect(g, nombre).toMatchObject({ ok: false, motivo: 'invalido' });
      expect(datos.get(CLAVE_BORRADOR), nombre).toBe(crudoDe(ejemplo()));
    }
    // demasiados cuadros o conexiones se rechazan sin mirarlos uno por uno
    const trece = flujoDe(muchos(14, i => app(`q${i}`, 8 * i, 0, `A${i}`)), []);
    expect(cargarDe(crudoDe(trece))).toEqual({ ok: false, motivo: 'invalido', detalle: ['tope-cuadros'] });
    const aristas = Array.from({ length: MAX_ARISTAS_BORRADOR + 1 }, (_, i) => arista(`e${i}`, 'a1', 'a2', 'seq'));
    expect(cargarDe(crudoDe(flujoDe(ejemplo().nodes, aristas)))).toEqual({ ok: false, motivo: 'invalido', detalle: ['tope-conexiones'] });
    // el límite exacto sí cabe: 1 disparador, 4 agentes y 8 apps
    expect(cargarDe(crudoDe(flujoLleno())).ok).toBe(true);
  });

  it('constructor.borrador.nunca_se_guarda_un_flujo_con_texto_que_parezca_una_clave_y_el_borrador_anterior_queda_como_estaba', () => {
    const anterior = crudoDe(ejemplo());
    for (const [familia, clave] of Object.entries(CLAVES)) {
      const lugares: [string, (f: Flujo) => void, string][] = [
        ['el nombre del flujo', f => void (f.nombreFlujo = `mi ${clave} flujo`), 'nombreFlujo'],
        ['la tarea de un agente', f => void Object.assign(f.nodes[1] ?? {}, { tarea: `usa ${clave}` }), 'a1.tarea'],
        ['las instrucciones', f => void Object.assign(f.nodes[1] ?? {}, { instrucciones: clave }), 'a1.instrucciones'],
        ['el nombre de un agente', f => void Object.assign(f.nodes[2] ?? {}, { nombre: clave }), 'a2.nombre'],
        ['el nombre de una app', f => void Object.assign(f.nodes[3] ?? {}, { nombre: `x ${clave}` }), 'p1.nombre'],
        ['la ruta del disparador', f => void Object.assign(f.nodes[0] ?? {}, { ruta: clave }), 't1.ruta'],
      ];
      for (const [donde, poner, lugar] of lugares) {
        const f = ejemplo();
        poner(f);
        const { almacen, datos } = memoria({ [CLAVE_BORRADOR]: anterior });
        const r = crearBorrador(almacen).guardar(f);
        expect(r, `${familia} en ${donde}`).toMatchObject({ ok: false, motivo: 'con-clave' });
        if (r.ok) continue;
        expect(r.detalle, `${familia} en ${donde}`).toContain(lugar);
        // dice dónde, jamás el texto
        expect(JSON.stringify(r)).not.toContain(clave);
        // el borrador anterior sigue ahí, intacto
        expect(datos.get(CLAVE_BORRADOR)).toBe(anterior);
        // y el texto de serialización tampoco lo escribe
        expect(serializarBorrador(f)).toMatchObject({ ok: false, motivo: 'con-clave' });
      }
    }
    // la clave más allá del tope de largo también se detecta: se mira ANTES de recortar
    const f = ejemplo();
    Object.assign(f.nodes[1] ?? {}, { instrucciones: `${repite('x', LARGO_TEXTO_AGENTE + 10)} ${CLAVES.openai ?? ''}` });
    expect(serializarBorrador(f)).toMatchObject({ ok: false, motivo: 'con-clave', detalle: ['a1.instrucciones'] });
    // un id que parece clave también (cabe en el formato de los ids)
    const conId = flujoDe([agente(`${'s'}k-${repite('a', 20)}`, 0, 0, 'A')], []);
    expect(serializarBorrador(conId)).toMatchObject({ ok: false, motivo: 'con-clave', detalle: ['nodes[0].id'] });
    // varias a la vez: se dicen todas, sin repetir
    const varias = ejemplo();
    varias.nombreFlujo = CLAVES.google ?? '';
    Object.assign(varias.nodes[1] ?? {}, { tarea: CLAVES.slack, instrucciones: CLAVES.aws });
    const r = serializarBorrador(varias);
    expect(r).toMatchObject({ ok: false, motivo: 'con-clave' });
    expect(!r.ok && r.detalle.sort()).toEqual(['a1.instrucciones', 'a1.tarea', 'nombreFlujo']);
    // un borrador que ya trae la clave (escrito a mano) no se lee
    const mano = estropeado(d => void (d.nodes[1]!.tarea = `x ${CLAVES.github}`));
    expect(cargarDe(mano)).toMatchObject({ ok: false, motivo: 'con-clave', detalle: ['a1.tarea'] });
    expect(seDescarto('con-clave')).toBe(true);
    // texto normal que se parece pero no lo es
    const parecido = ejemplo();
    Object.assign(parecido.nodes[1] ?? {}, { tarea: 'sk-corto, AIza no, bearer poco, token: 123' });
    expect(serializarBorrador(parecido).ok).toBe(true);
  });

  it('constructor.borrador.un_borrador_o_un_flujo_demasiado_grande_se_rechaza_y_el_peor_flujo_permitido_cabe_de_sobra', () => {
    const { almacen, datos } = memoria({ [CLAVE_BORRADOR]: crudoDe(ejemplo()) });
    const chico = crearBorrador(almacen, { maxCaracteres: 500 });
    const r = chico.guardar(ejemplo());
    expect(r).toMatchObject({ ok: false, motivo: 'demasiado-grande' });
    expect(datos.get(CLAVE_BORRADOR)).toBe(crudoDe(ejemplo()));
    // al leer, un texto más grande que el tope ni se intenta leer
    expect(chico.cargar()).toMatchObject({ ok: false, motivo: 'demasiado-grande' });
    const enorme = `{"v":1,"relleno":"${repite('a', MAX_CARACTERES_BORRADOR)}"}`;
    expect(cargarDe(enorme)).toMatchObject({ ok: false, motivo: 'demasiado-grande' });
    expect(leerBorrador(enorme, { maxCaracteres: enorme.length })).toMatchObject({ ok: false, motivo: 'forma' });
    expect(seDescarto('demasiado-grande')).toBe(true);
    // el flujo más grande que las reglas dejan (13 cuadros con todos los textos en su tope) cabe en menos de la mitad del tope
    const g = serializarBorrador(flujoLleno());
    expect(g.ok).toBe(true);
    expect(g.ok && g.texto.length).toBeLessThan(MAX_CARACTERES_BORRADOR / 2);
    expect(g.ok && g.texto.length).toBeGreaterThan(30_000);
  });

  it('constructor.borrador.un_almacenamiento_que_lanza_o_no_existe_no_rompe_nada_y_se_dice_si_fue_cuota_o_modo_privado', () => {
    const lanza = (error: unknown): Almacen => ({
      getItem: () => {
        throw error;
      },
      setItem: () => {
        throw error;
      },
      removeItem: () => {
        throw error;
      },
    });
    const cuota = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    const privado = new DOMException('The operation is insecure.', 'SecurityError');
    // cuota llena en cualquiera de sus formas
    for (const e of [cuota, new DOMException('x', 'NS_ERROR_DOM_QUOTA_REACHED'), { code: 22 }, { code: 1014 }, Object.assign(new Error('x'), { name: 'QuotaExceededError' })]) {
      expect(crearBorrador(lanza(e)).guardar(ejemplo())).toEqual({ ok: false, motivo: 'cuota-llena', detalle: [] });
      expect(crearBorrador(lanza(e)).traspasar(ejemplo())).toEqual({ ok: false, motivo: 'cuota-llena', detalle: [] });
    }
    // modo privado, datos bloqueados y cualquier otro fallo
    for (const e of [privado, new Error('boom'), 'texto', 42, null, undefined, { code: 'x' }]) {
      const b = crearBorrador(lanza(e));
      expect(b.guardar(ejemplo())).toEqual({ ok: false, motivo: 'sin-almacenamiento', detalle: [] });
      expect(b.cargar()).toEqual({ ok: false, motivo: 'sin-almacenamiento', detalle: [] });
      expect(b.borrar()).toEqual({ ok: false, motivo: 'sin-almacenamiento' });
      expect(b.traspasar(ejemplo())).toEqual({ ok: false, motivo: 'sin-almacenamiento', detalle: [] });
      // un lienzo vacío intenta borrar y tampoco lanza
      expect(b.guardar(flujoDe([], []))).toEqual({ ok: false, motivo: 'sin-almacenamiento', detalle: [] });
    }
    // en algunos navegadores solo LEER window.localStorage lanza: la función que da el almacenamiento puede lanzar
    const quienLanza = () => {
      throw privado;
    };
    const b1 = crearBorrador(quienLanza);
    expect(b1.guardar(ejemplo())).toMatchObject({ ok: false, motivo: 'sin-almacenamiento' });
    expect(b1.cargar()).toMatchObject({ ok: false, motivo: 'sin-almacenamiento' });
    expect(b1.borrar()).toMatchObject({ ok: false, motivo: 'sin-almacenamiento' });
    // sin almacenamiento (null, undefined o una función que no da nada)
    for (const nada of [null, undefined, () => null, () => undefined]) {
      const b = crearBorrador(nada);
      expect(b.guardar(ejemplo())).toMatchObject({ ok: false, motivo: 'sin-almacenamiento' });
      expect(b.cargar()).toMatchObject({ ok: false, motivo: 'sin-almacenamiento' });
      expect(b.borrar()).toMatchObject({ ok: false, motivo: 'sin-almacenamiento' });
    }
    // el motivo se prioriza: una clave se dice aunque tampoco haya almacenamiento
    const conClave = ejemplo();
    conClave.nombreFlujo = CLAVES.openai ?? '';
    expect(crearBorrador(null).guardar(conClave)).toMatchObject({ ok: false, motivo: 'con-clave' });
    // un almacenamiento que contesta cosas raras
    const raro = (valor: unknown): Almacen => ({ getItem: () => valor as string | null, setItem: () => undefined, removeItem: () => undefined });
    expect(crearBorrador(raro(undefined)).cargar()).toMatchObject({ ok: false, motivo: 'vacio' });
    for (const v of [5, {}, [], true]) expect(crearBorrador(raro(v)).cargar()).toEqual({ ok: false, motivo: 'forma', detalle: ['almacen'] });
    expect(seDescarto('sin-almacenamiento')).toBe(false);
  });

  it('constructor.borrador.guardar_un_lienzo_sin_cuadros_borra_el_borrador', () => {
    const { almacen, datos } = memoria();
    const b = crearBorrador(almacen);
    expect(b.guardar(ejemplo()).ok).toBe(true);
    expect(datos.has(CLAVE_BORRADOR)).toBe(true);
    expect(b.guardar(flujoDe([], [], 'Mi automatización'))).toEqual({ ok: true, accion: 'borrado', caracteres: 0, recortes: [] });
    expect(datos.has(CLAVE_BORRADOR)).toBe(false);
    expect(b.cargar()).toMatchObject({ ok: false, motivo: 'vacio' });
    // sin cuadros pero con una conexión suelta no es un flujo: no borra lo que había
    expect(b.guardar(ejemplo()).ok).toBe(true);
    expect(b.guardar(flujoDe([], [arista('e1', 'a', 'b', 'seq')]))).toMatchObject({ ok: false, motivo: 'invalido' });
    expect(datos.has(CLAVE_BORRADOR)).toBe(true);
  });

  it('constructor.borrador.borrar_quita_solo_su_llave_y_la_ultima_escritura_manda', () => {
    const { almacen, datos } = memoria({ 'caja.sonido': 'sin', otra: 'cosa' });
    const b = crearBorrador(almacen);
    b.guardar(ejemplo());
    const m = muestras()[0];
    if (!m) throw new Error('sin muestras');
    b.guardar(flujoDe(m.nodes, m.edges, m.nombre));
    const c = b.cargar();
    expect(c.ok && c.flujo.nombreFlujo).toBe(m.nombre);
    expect(b.borrar()).toEqual({ ok: true });
    expect([...datos.keys()].sort()).toEqual(['caja.sonido', 'otra']);
    // borrar sin nada también está bien, y dos cargas dan objetos nuevos
    expect(b.borrar()).toEqual({ ok: true });
    b.guardar(ejemplo());
    const [x, y] = [b.cargar(), b.cargar()];
    expect(x).toEqual(y);
    expect(x.ok && y.ok && x.flujo !== y.flujo && x.flujo.nodes[0] !== y.flujo.nodes[0]).toBe(true);
  });

  it('constructor.borrador.cargar_no_escribe_ni_borra_nada_aunque_descarte', () => {
    for (const crudo of ['{', crudoDe(ejemplo(), { v: 3 }), estropeado(d => void (d.nodes[0]!.kind = 'x')), crudoDe(ejemplo())]) {
      const { almacen, llamadas, datos } = memoria({ [CLAVE_BORRADOR]: crudo });
      crearBorrador(almacen).cargar();
      expect(llamadas).toEqual([`get ${CLAVE_BORRADOR}`]);
      expect(datos.get(CLAVE_BORRADOR)).toBe(crudo);
    }
  });

  it('constructor.borrador.sirve_con_el_local_storage_del_navegador_y_con_una_funcion_que_lo_da', () => {
    const porFuncion = crearBorrador(() => window.localStorage);
    expect(porFuncion.guardar(ejemplo()).ok).toBe(true);
    expect(window.localStorage.getItem('constructor.borrador.v1')).toContain('"nombreFlujo":"Atención a clientes"');
    // el mismo borrador, leído con otro objeto atado al mismo almacenamiento
    const directo = crearBorrador(window.localStorage);
    const c = directo.cargar();
    expect(c.ok && c.flujo).toEqual(ejemplo());
    expect(directo.borrar()).toEqual({ ok: true });
    expect(window.localStorage.getItem(CLAVE_BORRADOR)).toBeNull();
  });
});

// ---------------------------------------------------------------- traspaso Asistente → Constructor

describe('traspaso', () => {
  const grafoAjeno = () => {
    const m = muestras()[1];
    if (!m) throw new Error('sin muestras');
    return { nombreFlujo: m.nombre, nodes: m.nodes, edges: m.edges, fuentes: m.fuentes, chips: ['a'], claves: m.claves };
  };

  it('constructor.borrador.el_traspaso_escribe_un_flujo_ajeno_como_borrador_con_su_origen_y_el_guardado_normal_lo_quita', () => {
    const { almacen, datos } = memoria({ [CLAVE_BORRADOR]: crudoDe(ejemplo()) });
    const b = crearBorrador(almacen);
    const ajeno = grafoAjeno();
    const antes = JSON.stringify(ajeno);
    const r = b.traspasar(ajeno);
    expect(r).toMatchObject({ ok: true, accion: 'guardado', recortes: [] });
    // lo ajeno no se tocó, y reemplazó al borrador que había
    expect(JSON.stringify(ajeno)).toBe(antes);
    const crudo = JSON.parse(datos.get(CLAVE_BORRADOR) ?? '{}') as Record<string, unknown>;
    expect(Object.keys(crudo)).toEqual(['v', 'nodes', 'edges', 'nombreFlujo', 'origen']);
    expect(crudo.origen).toBe('asistente');
    // el Constructor lo lee, ve de dónde viene y recibe copias
    const c = b.cargar();
    expect(c).toMatchObject({ ok: true, origen: 'asistente', recortes: [] });
    if (!c.ok) return;
    expect(c.flujo).toEqual({ nodes: ajeno.nodes, edges: ajeno.edges, nombreFlujo: ajeno.nombreFlujo });
    expect(c.flujo.nodes[0]).not.toBe(ajeno.nodes[0]);
    // el guardado normal quita la marca
    expect(b.guardar(c.flujo).ok).toBe(true);
    expect(b.cargar()).toMatchObject({ ok: true, origen: null });
    expect(Object.keys(JSON.parse(datos.get(CLAVE_BORRADOR) ?? '{}') as object)).toEqual(['v', 'nodes', 'edges', 'nombreFlujo']);
  });

  it('constructor.borrador.preparar_el_traspaso_es_pura_acepta_nombre_en_vez_de_nombre_flujo_y_no_acepta_lo_que_no_se_puede_abrir', () => {
    const m = muestras()[0];
    if (!m) throw new Error('sin muestras');
    // una muestra tal cual (tiene `nombre`, no `nombreFlujo`)
    const deMuestra = prepararTraspaso(m);
    expect(deMuestra).toMatchObject({ ok: true });
    expect(deMuestra.ok && deMuestra.flujo.nombreFlujo).toBe(m.nombre);
    expect(deMuestra.ok && (JSON.parse(deMuestra.texto) as { origen: string }).origen).toBe('asistente');
    expect(leerBorrador(deMuestra.ok ? deMuestra.texto : null)).toMatchObject({ ok: true, origen: 'asistente' });
    // si trae las dos, manda nombreFlujo
    expect(prepararTraspaso({ ...grafoAjeno(), nombre: 'otro' })).toMatchObject({ ok: true, flujo: { nombreFlujo: grafoAjeno().nombreFlujo } });

    // sin cuadros no hay nada que abrir
    expect(prepararTraspaso({ nodes: [], edges: [], nombreFlujo: 'Vacío' })).toEqual({ ok: false, motivo: 'invalido', detalle: ['sin-cuadros'] });
    // lo que no es un flujo, o es un flujo roto, o rompe las reglas
    for (const raro of [null, undefined, 5, 'flujo', [], {}, { nodes: 'x', edges: [], nombreFlujo: 'x' }, { n8n: 'Json de n8n' }]) {
      expect(prepararTraspaso(raro), JSON.stringify(raro)).toMatchObject({ ok: false, motivo: 'invalido' });
    }
    const dosDisparadores = grafoAjeno();
    dosDisparadores.nodes = [...dosDisparadores.nodes, disparador({ id: 't2', y: 600 })];
    expect(prepararTraspaso(dosDisparadores)).toMatchObject({ ok: false, motivo: 'invalido', detalle: ['varios-disparadores'] });
    // con una clave no se escribe nada
    const conClave = grafoAjeno();
    conClave.nombreFlujo = `flujo ${CLAVES.telegram}`;
    expect(prepararTraspaso(conClave)).toEqual({ ok: false, motivo: 'con-clave', detalle: ['nombreFlujo'] });
    const { almacen, datos } = memoria({ [CLAVE_BORRADOR]: crudoDe(ejemplo()) });
    expect(crearBorrador(almacen).traspasar(conClave)).toMatchObject({ ok: false, motivo: 'con-clave' });
    expect(datos.get(CLAVE_BORRADOR)).toBe(crudoDe(ejemplo()));
    // y lo demasiado grande tampoco
    expect(prepararTraspaso(grafoAjeno(), { maxCaracteres: 100 })).toMatchObject({ ok: false, motivo: 'demasiado-grande' });
  });

  it('constructor.borrador.una_marca_de_origen_que_no_es_la_conocida_se_ignora', () => {
    for (const origen of ['usuario', 'ASISTENTE', 1, null, ['asistente'], { x: 1 }]) {
      expect(cargarDe(crudoDe(ejemplo(), { origen })), JSON.stringify(origen)).toMatchObject({ ok: true, origen: null });
    }
    expect(cargarDe(crudoDe(ejemplo(), { origen: 'asistente' }))).toMatchObject({ ok: true, origen: 'asistente' });
  });
});

// ---------------------------------------------------------------- normalizar un flujo de afuera

describe('normalizarFlujo', () => {
  it('constructor.borrador.normalizar_devuelve_copias_nuevas_ignora_los_campos_de_mas_y_no_modifica_la_entrada', () => {
    const entrada = congelar({
      nodes: [
        { ...disparador(), sobrante: 1, ['__proto__']: undefined },
        { ...agente('a1', 312, 180, 'A'), desc: null, historial: ['x'] },
        { ...agente('a2', 616, 180, 'B', { desc: '' }), otro: true },
        { ...app('p1', -0, 380, 'Gmail') },
      ] as unknown[],
      edges: [{ ...arista('e1', 't1', 'a1', 'seq'), peso: 3 }, arista('e2', 'a1', 'a2', 'seq')],
      nombreFlujo: 'Mi flujo',
      sel: 'a1',
    });
    const antes = JSON.stringify(entrada);
    const r = normalizarFlujo(entrada);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(entrada)).toBe(antes);
    expect(r.flujo.nodes).toHaveLength(4);
    expect(Object.keys(r.flujo)).toEqual(['nodes', 'edges', 'nombreFlujo']);
    // los campos de más no pasan; `desc` nulo cuenta como ausente y `desc` vacío se conserva
    expect(Object.keys(r.flujo.nodes[0] ?? {}).sort()).toEqual(['app', 'frec', 'id', 'kind', 'ruta', 'tipo', 'x', 'y']);
    expect('desc' in (r.flujo.nodes[1] ?? {})).toBe(false);
    expect((r.flujo.nodes[2] as NodoAgente).desc).toBe('');
    expect(Object.is(r.flujo.nodes[3]?.x, 0)).toBe(true);
    expect(r.flujo.edges.map(e => Object.keys(e))).toEqual([
      ['id', 'de', 'a', 'tipo'],
      ['id', 'de', 'a', 'tipo'],
    ]);
    // objetos nuevos: cambiarlos no cambia la entrada
    expect(r.flujo.nodes[0]).not.toBe(entrada.nodes[0]);
    expect(r.flujo.edges[0]).not.toBe(entrada.edges[0]);
    // un flujo que se valida bien vuelve a validarse igual
    expect(normalizarFlujo(r.flujo)).toEqual({ ok: true, flujo: r.flujo, recortes: [] });
  });

  it('constructor.borrador.cualquier_texto_deformado_se_lee_sin_lanzar_y_lo_que_pasa_cumple_los_invariantes', () => {
    // un generador con semilla (mulberry32): estropea un borrador bueno de mil maneras
    const semilla = (a: number) => () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const azar = semilla(20261020);
    const entero = (n: number) => Math.floor(azar() * n);
    const buenos = [crudoDe(ejemplo()), crudoDe(flujoLleno()), ...muestras().map(m => crudoDe(flujoDe(m.nodes, m.edges, m.nombre)))];
    const trocitos = ['"', '{', '}', '[', ']', ',', ':', 'null', '"a1"', '"__proto__"', '-1', '1e999', '"seq"', '"tool"', '"agent"', '9', '""', '{}', '[]'];
    let validos = 0;
    let descartados = 0;
    const motivos = new Set<MotivoNoCarga>();
    for (let i = 0; i < 4000; i += 1) {
      let t = buenos[entero(buenos.length)] ?? '';
      const golpes = 1 + entero(4);
      for (let g = 0; g < golpes; g += 1) {
        const pos = entero(t.length);
        const modo = entero(4);
        if (modo === 0) t = t.slice(0, pos) + t.slice(pos + 1 + entero(8));
        else if (modo === 1) t = t.slice(0, pos) + (trocitos[entero(trocitos.length)] ?? '') + t.slice(pos);
        else if (modo === 2) t = t.slice(0, pos) + (trocitos[entero(trocitos.length)] ?? '') + t.slice(pos + 1 + entero(6));
        else t = t.slice(0, Math.max(0, t.length - entero(40)));
      }
      let r: ReturnType<typeof leerBorrador>;
      expect(() => {
        r = leerBorrador(t);
      }, t.slice(0, 120)).not.toThrow();
      r = leerBorrador(t);
      if (r.ok) {
        validos += 1;
        expect(invariantesDelGrafo(r.flujo.nodes, r.flujo.edges), t.slice(0, 200)).toEqual([]);
        expect(r.flujo.nodes.length).toBeGreaterThan(0);
        expect(r.flujo.nodes.length).toBeLessThanOrEqual(13);
        expect(Object.keys(r.flujo)).toEqual(['nodes', 'edges', 'nombreFlujo']);
        // y lo que pasa se vuelve a guardar y a leer igual
        const otra = serializarBorrador(r.flujo);
        expect(otra.ok).toBe(true);
        if (otra.ok) expect(leerBorrador(otra.texto)).toMatchObject({ ok: true, flujo: r.flujo });
      } else {
        descartados += 1;
        motivos.add(r.motivo);
        expect(seDescarto(r.motivo) || r.motivo === 'vacio').toBe(true);
      }
    }
    // la prueba mira de verdad los dos lados
    expect(validos).toBeGreaterThan(100);
    expect(descartados).toBeGreaterThan(1000);
    for (const m of ['json-roto', 'forma', 'invalido'] as const) expect(motivos.has(m), m).toBe(true);
  });
});

// ---------------------------------------------------------------- textos

describe('textos para la persona', () => {
  it('constructor.borrador.hay_un_texto_para_cada_motivo_de_no_guardar_y_estan_en_espanol_latam_con_tuteo', () => {
    expect(Object.keys(TEXTO_NO_GUARDADO).sort()).toEqual(['con-clave', 'cuota-llena', 'demasiado-grande', 'invalido', 'sin-almacenamiento']);
    for (const t of [...Object.values(TEXTO_NO_GUARDADO), TEXTO_NO_RECUPERADO]) {
      expect(t.length).toBeGreaterThan(20);
      expect(t).not.toMatch(/\.\.\./);
      expect(t).not.toMatch(/¡/);
      expect(t).not.toMatch(/\b(ordenador|móvil|fichero|vosotros|centavos?|workflow|localStorage)\b/i);
      expect(t).toMatch(/[.?)]$/);
    }
    // los que pueden perder trabajo mandan a descargar el .json
    for (const k of ['invalido', 'demasiado-grande', 'cuota-llena', 'sin-almacenamiento'] as const) expect(TEXTO_NO_GUARDADO[k]).toContain('Descarga el .json');
    // el de la clave dice qué hacer y dónde van las claves, sin repetir ninguna
    expect(TEXTO_NO_GUARDADO['con-clave']).toContain('Quítala');
    expect(TEXTO_NO_GUARDADO['con-clave']).toContain('n8n');
    // cuándo hay que avisar que no se recuperó algo
    const motivos: MotivoNoCarga[] = ['vacio', 'sin-almacenamiento', 'json-roto', 'forma', 'version-futura', 'invalido', 'con-clave', 'demasiado-grande'];
    expect(motivos.filter(seDescarto)).toEqual(['json-roto', 'forma', 'version-futura', 'invalido', 'con-clave', 'demasiado-grande']);
  });
});

/** Congela el valor y todo lo que contiene: si el módulo intentara modificarlo, lanzaría. */
function congelar<T>(valor: T): T {
  if (valor !== null && typeof valor === 'object' && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const v of Object.values(valor)) congelar(v);
  }
  return valor;
}
