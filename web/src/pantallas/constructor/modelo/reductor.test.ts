// Pruebas del reductor: las secciones de acciones del harness del mockup (prueba/harness.cjs, secciones 0 a 12;
// la 13 es el recorrido mapa → grupos → lista y no se porta) hechas sobre `reducir(estado, accion)`, más lo que el
// mockup no probaba: el foco, los topes en todas las puertas, un id que no existe, que nada se modifica, que el
// contador nunca baja y que un recorrido al azar jamás rompe un invariante.
//
// Cada `it` lleva su nombre literal `constructor.reductor.…` (registro anti-pérdida: los `it.each` no cuentan).
// Todo estado que sale del reductor se CONGELA a fondo antes de la acción siguiente: si una acción intentara
// modificar algo de lo que recibió, la prueba revienta.

import { describe, expect, it } from 'vitest';

import { altoLienzo, anchoLienzo } from './colocacion';
import {
  DESC_AYUDANTE_POR_DEFECTO,
  ID_INICIAL,
  LARGO_NOMBRE_AGENTE,
  LARGO_NOMBRE_APP,
  LARGO_NOMBRE_FLUJO,
  MAX_HISTORIAL,
  NOMBRE_FLUJO_INICIAL,
  TOPE_AGENTES,
  TOPE_APPS,
  X_MAX,
  Y_MAX,
} from './datos/constantes';
import { ejemplo, muestras, NOMBRE_EJEMPLO } from './ejemplos';
import { construirFlujo, revisarFlujo } from './exportar';
import { alcanza, hayCiclo, invariantesDelGrafo } from './grafo';
import { contadorParaFlujo, estadoInicial, puedeDeshacer, reducir } from './reductor';
import * as T from './textos';
import type {
  AccionConstructor as A,
  Arista,
  EstadoConstructor as E,
  Flujo,
  Foco,
  Nodo,
  NodoAgente,
  NodoApp,
  TipoArista,
} from './tipos';

// ---------------------------------------------------------------- ayudas

/** Congela a fondo: si algo intenta modificar lo congelado, lanza. */
function congelar<V>(v: V): V {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    for (const hijo of Object.values(v)) congelar(hijo);
    Object.freeze(v);
  }
  return v;
}

/** Aplica las acciones una por una, congelando cada estado que sale. */
function ir(e: E, ...acciones: A[]): E {
  let s = e;
  for (const a of acciones) s = congelar(reducir(s, a));
  return s;
}

const vacio = (): E => congelar(estadoInicial());
/** El ejemplo (`nuevo(true)` del harness): el flujo de Atención a clientes con `a1` elegido. */
const conEjemplo = (): E => congelar({ ...estadoInicial(ejemplo()), sel: 'a1' });
/** Un estado con el flujo que se le dé. */
const conFlujo = (f: Flujo, sel: string | null = null): E => congelar({ ...estadoInicial(f), sel });

function nodo(e: E, id: string): Nodo {
  const n = e.flujo.nodes.find(x => x.id === id);
  if (!n) throw new Error(`no hay cuadro ${id}`);
  return n;
}
function arista(e: E, id: string): Arista {
  const x = e.flujo.edges.find(y => y.id === id);
  if (!x) throw new Error(`no hay conexión ${id}`);
  return x;
}
function ultimoNodo(e: E): Nodo {
  const n = e.flujo.nodes[e.flujo.nodes.length - 1];
  if (!n) throw new Error('no hay cuadros');
  return n;
}
function ultimaArista(e: E): Arista {
  const x = e.flujo.edges[e.flujo.edges.length - 1];
  if (!x) throw new Error('no hay conexiones');
  return x;
}
const foco = (e: E): Foco | null => e.foco?.objetivo ?? null;

/** El aviso del estado es exactamente este (texto, tono y si trae «Deshacer»). */
function avisoEs(e: E, t: T.TextoAviso, conDeshacer = false): void {
  expect(e.aviso).not.toBeNull();
  expect(e.aviso?.texto).toBe(t.texto);
  expect(e.aviso?.tipo).toBe(t.tipo);
  expect(e.aviso?.conDeshacer).toBe(conDeshacer);
}

const agenteSuelto = (id: string, x: number, y: number, extra: Partial<NodoAgente> = {}): NodoAgente => ({
  id,
  kind: 'agent',
  x,
  y,
  nombre: 'Libre',
  ia: 'openai',
  tarea: '',
  desc: 'x',
  instrucciones: '',
  ...extra,
});
const appSuelta = (id: string, x: number, y: number, nombre = 'Notion'): NodoApp => ({ id, kind: 'app', x, y, nombre });

/** El ejemplo con cuadros sueltos de más. */
const ejemploMas = (...extra: Nodo[]): Flujo => {
  const f = ejemplo();
  return { ...f, nodes: [...f.nodes, ...extra] };
};

/** ¿Algún par de cuadros se pisa (más que tocarse)? */
const hayEncimados = (nodes: readonly Nodo[]): boolean =>
  nodes.some((a, i) => nodes.some((b, j) => j > i && Math.abs(a.x - b.x) < 216 && Math.abs(a.y - b.y) < 96));

/** Lo que todo estado alcanzable cumple (informe 04 §1.5). */
function invariantesDelEstado(e: E): string[] {
  const fallas: string[] = [];
  const ids = new Set(e.flujo.nodes.map(n => n.id));
  const eids = new Set(e.flujo.edges.map(x => x.id));
  fallas.push(...invariantesDelGrafo(e.flujo.nodes, e.flujo.edges));
  if (e.sel !== null && !ids.has(e.sel)) fallas.push(`sel fantasma ${e.sel}`);
  if (e.selEdge !== null && !eids.has(e.selEdge)) fallas.push(`selEdge fantasma ${e.selEdge}`);
  if (e.sel !== null && e.selEdge !== null) fallas.push('sel y selEdge a la vez');
  if (e.menu && !ids.has(e.menu.ancla)) fallas.push('menu.ancla fantasma');
  if (e.menu?.insertarEn && !eids.has(e.menu.insertarEn)) fallas.push('menu.insertarEn fantasma');
  if (e.menu && e.menu.insertarEn !== null && e.menu.tipo !== 'seq') fallas.push('insertar con tipo tool');
  if (e.conectando && !ids.has(e.conectando.ancla)) fallas.push('conectando.ancla fantasma');
  if (e.menu && e.conectando) fallas.push('menu y conectando a la vez');
  if (e.historial.length > MAX_HISTORIAL) fallas.push('pila de más de 20');
  if (e.aviso?.conDeshacer && e.historial[e.historial.length - 1]?.avisoId !== e.aviso.id) {
    fallas.push('el aviso ofrece Deshacer pero no es el de la instantánea de arriba');
  }
  if (e.aviso && e.aviso.id > e.eventos) fallas.push('aviso con id mayor que eventos');
  if (e.foco && e.foco.n > e.eventos) fallas.push('foco con n mayor que eventos');
  for (const x of [...e.flujo.nodes, ...e.flujo.edges]) {
    const k = Number(/(\d+)$/.exec(x.id)?.[1] ?? 0);
    if (k > e.siguiente) fallas.push(`el id ${x.id} pasa del contador ${e.siguiente}`);
  }
  return fallas;
}

// ---------------------------------------------------------------- 0 · arranque vacío: se elige el disparador

describe('reductor · el lienzo vacío y el disparador', () => {
  it('constructor.reductor.el_estado_inicial_esta_vacio_con_el_contador_en_20_y_sin_peticiones', () => {
    const e = vacio();
    expect(e.flujo).toEqual({ nodes: [], edges: [], nombreFlujo: NOMBRE_FLUJO_INICIAL });
    expect(e).toMatchObject({
      sel: null,
      selEdge: null,
      menu: null,
      conectando: null,
      historial: [],
      siguiente: ID_INICIAL,
      foco: null,
      ver: null,
      scrollAjustes: 0,
      aviso: null,
      eventos: 0,
    });
    expect(puedeDeshacer(e)).toBe(false);
  });

  it('constructor.reductor.elegir_disparador_crea_uno_solo_con_sus_valores_por_defecto_y_pide_foco', () => {
    const e0 = vacio();
    const e1 = ir(e0, { k: 'elegirDisparador', tipo: 'web' });
    expect(e1.flujo.nodes).toEqual([
      // la rejilla de 8 acomoda el 180 del mockup a 184 (como `enRango` en el mockup)
      { id: 't21', kind: 'trigger', x: 8, y: 184, tipo: 'web', frec: 'dia', ruta: 'mi-flujo', app: 'gmail' },
    ]);
    expect(e1.flujo.edges).toEqual([]);
    expect(e1.sel).toBe('t21');
    expect(e1.siguiente).toBe(21);
    avisoEs(e1, T.disparadorElegido('Disparador Web', null));
    expect(e1.aviso?.texto).toBe('Listo: el flujo arranca con «Disparador Web». Ahora toca el + para agregar lo que sigue.');
    expect(foco(e1)).toEqual({ k: 'nodo', id: 't21' });
    expect(e1.scrollAjustes).toBe(1);
    // un segundo disparador no se crea (el tope de 1 lo pone el reductor, no la interfaz)
    const e2 = ir(e1, { k: 'elegirDisparador', tipo: 'chat' });
    expect(e2.flujo).toBe(e1.flujo);
    avisoEs(e2, T.yaHayDisparador());
    // un tipo que no existe no crea nada
    expect(reducir(e0, { k: 'elegirDisparador', tipo: 'otro' as never })).toBe(e0);
  });

  it('constructor.reductor.sin_disparador_el_nuevo_se_conecta_con_el_primer_cuadro_que_no_recibe_de_nadie', () => {
    // se quita el disparador del ejemplo: «Atención a clientes» queda sin entrada
    let e = ir(conEjemplo(), { k: 'quitarNodo', id: 't1' });
    expect(e.flujo.nodes.some(n => n.kind === 'trigger')).toBe(false);
    e = ir(e, { k: 'elegirDisparador', tipo: 'tiempo' });
    const t = e.flujo.nodes.find(n => n.kind === 'trigger');
    expect(t?.id).toBe('t21');
    expect(e.flujo.edges.some(x => x.de === 't21' && x.a === 'a1' && x.tipo === 'seq')).toBe(true);
    avisoEs(e, T.disparadorElegido('Disparador Tiempo', 'Atención a clientes'));
    expect(e.aviso?.texto).toBe('Listo: el flujo arranca con «Disparador Tiempo» y lo conectamos con «Atención a clientes».');
    // el disparador nuevo va AL FINAL de la lista de cuadros, como en el mockup
    expect(ultimoNodo(e).id).toBe('t21');
    expect(ultimaArista(e)).toEqual({ id: 'e22', de: 't21', a: 'a1', tipo: 'seq' });
    // el disparador creado no es un cuadro suelto más: el flujo vuelve a ser válido
    expect(invariantesDelEstado(e)).toEqual([]);
  });

  it('constructor.reductor.el_disparador_nuevo_tambien_se_conecta_con_una_app_suelta_y_el_flujo_queda_valido', () => {
    // un solo cuadro suelto (una app): es la cabeza del flujo, el disparador nuevo se conecta con ella
    const f: Flujo = { nodes: [appSuelta('p1', 700, 400, 'Notion')], edges: [], nombreFlujo: 'x' };
    const e = ir(conFlujo(f), { k: 'elegirDisparador', tipo: 'chat' });
    expect(e.flujo.edges).toEqual([{ id: 'e22', de: 't21', a: 'p1', tipo: 'seq' }]);
    avisoEs(e, T.disparadorElegido('Disparador Chat', 'Notion'));
    expect(invariantesDelEstado(e)).toEqual([]);
    // con dos cabezas se elige la que ya tiene un paso después y, a igualdad, la más a la izquierda
    const g = ejemplo();
    const sueltas: Flujo = {
      nodes: [...g.nodes.filter(n => n.kind !== 'trigger'), appSuelta('z', 8, 700, 'Slack'), appSuelta('y', 1500, 700, 'Notion')],
      edges: g.edges.filter(x => x.de !== 't1'),
      nombreFlujo: 'x',
    };
    const h = ir(conFlujo(sueltas), { k: 'elegirDisparador', tipo: 'chat' });
    // las cabezas son a1 (tiene seq saliente), z e y: gana a1
    expect(ultimaArista(h)).toMatchObject({ de: 't21', a: 'a1', tipo: 'seq' });
    const sinSeq: Flujo = { nodes: [appSuelta('y', 1500, 700, 'Notion'), appSuelta('z', 8, 700, 'Slack')], edges: [], nombreFlujo: 'x' };
    expect(ultimaArista(ir(conFlujo(sinSeq), { k: 'elegirDisparador', tipo: 'chat' }))).toMatchObject({ a: 'z' });
  });
});

// ---------------------------------------------------------------- 1 y 2 · el «+» de la derecha

describe('reductor · el menú del «+» de la derecha', () => {
  it('constructor.reductor.el_mas_de_la_derecha_abre_el_menu_y_crear_una_app_la_conecta_en_un_solo_sentido', () => {
    let e = ir(vacio(), { k: 'elegirDisparador', tipo: 'web' });
    const t = e.flujo.nodes[0]?.id ?? '';
    e = ir(e, { k: 'abrirMenu', ancla: t, tipo: 'seq' });
    expect(e.menu).toEqual({ ancla: t, tipo: 'seq', paso: 'inicio', insertarEn: null });
    expect(e.sel).toBe(t);
    expect(e.selEdge).toBeNull();
    expect(foco(e)).toEqual({ k: 'primeraOpcionMenu' });
    avisoEs(e, T.menuDespues('Disparador Web'));
    expect(e.aviso?.texto).toBe('Elige qué va después de «Disparador Web»: una app o un agente.');

    e = ir(e, { k: 'pasoMenu', paso: 'app' });
    expect(e.menu?.paso).toBe('app');
    expect(foco(e)).toEqual({ k: 'primeraOpcionMenu' });

    e = ir(e, { k: 'crearDesdeMenu', que: 'app', nombreApp: 'Slack' });
    expect(e.flujo.nodes).toHaveLength(2);
    expect(e.flujo.edges).toHaveLength(1);
    expect(ultimaArista(e)).toMatchObject({ de: t, tipo: 'seq' });
    expect(ultimoNodo(e)).toEqual({ id: 'p22', kind: 'app', x: 352, y: 184, nombre: 'Slack' });
    expect(e.menu).toBeNull();
    expect(e.sel).toBe('p22');
    avisoEs(e, T.agregado('Slack', false, { despuesDe: 'Disparador Web' }));
    expect(e.aviso?.texto).toBe('Agregamos «Slack» después de «Disparador Web». Sus ajustes están en el panel de Ajustes.');
    expect(foco(e)).toEqual({ k: 'nodo', id: 'p22' });
    expect(e.ver?.id).toBe('p22');
  });

  it('constructor.reductor.una_app_sin_nombre_no_se_crea_y_el_nombre_se_recorta_a_60', () => {
    let e = ir(vacio(), { k: 'elegirDisparador', tipo: 'web' });
    const t = e.flujo.nodes[0]?.id ?? '';
    e = ir(e, { k: 'abrirMenu', ancla: t, tipo: 'seq' }, { k: 'crearDesdeMenu', que: 'app', nombreApp: '   ' });
    expect(e.flujo.nodes).toHaveLength(1);
    avisoEs(e, T.escribeNombreApp());
    expect(e.aviso?.texto).toBe('Escribe el nombre de la app.');
    expect(e.menu).not.toBeNull(); // el menú sigue abierto
    expect(e.siguiente).toBe(21); // y el fallo no gastó ningún número
    e = ir(e, { k: 'crearDesdeMenu', que: 'app' }); // sin nombre
    expect(e.flujo.nodes).toHaveLength(1);
    e = ir(e, { k: 'crearDesdeMenu', que: 'app', nombreApp: 'HubSpot' });
    expect(e.flujo.nodes).toHaveLength(2);
    expect(ultimoNodo(e)).toMatchObject({ nombre: 'HubSpot' });
    // el nombre se recorta (el campo de la interfaz ya lo limita; el reductor es la barrera de verdad)
    e = ir(e, { k: 'abrirMenu', ancla: 'p22', tipo: 'seq' }, { k: 'crearDesdeMenu', que: 'app', nombreApp: `  ${'x'.repeat(100)}  ` });
    expect((ultimoNodo(e) as NodoApp).nombre).toBe('x'.repeat(LARGO_NOMBRE_APP));
  });

  it('constructor.reductor.tocar_el_mismo_mas_otra_vez_cierra_el_menu_y_cerrar_devuelve_el_foco_al_mas', () => {
    let e = conEjemplo();
    e = ir(e, { k: 'abrirMenu', ancla: 'a1', tipo: 'tool' });
    expect(e.menu).not.toBeNull();
    const n = e.foco?.n ?? 0;
    e = ir(e, { k: 'abrirMenu', ancla: 'a1', tipo: 'tool' }); // el mismo «+»: cierra
    expect(e.menu).toBeNull();
    avisoEs(e, T.menuCerrado());
    // no pide foco: ya está en el «+». Y la petición vieja (la primera opción de un menú que ya se cerró) se apaga
    expect(e.foco).toBeNull();
    expect(n).toBeGreaterThan(0);
    // la X, Esc o el clic en el fondo: cerrarMenu devuelve el foco al «+» que lo abrió
    const casos: [A, string][] = [
      [{ k: 'abrirMenu', ancla: 'a1', tipo: 'tool' }, 'tool-a1'],
      [{ k: 'abrirMenu', ancla: 'a1', tipo: 'seq' }, 'der-a1'],
      [{ k: 'abrirMenu', ancla: 'a1', tipo: 'seq', insertarEn: 'e2' }, 'medio'],
    ];
    for (const [abrir, clave] of casos) {
      const abierto = ir(conEjemplo(), abrir);
      const cerrado = ir(abierto, { k: 'cerrarMenu' });
      expect(cerrado.menu).toBeNull();
      expect(foco(cerrado)).toEqual({ k: 'mas', clave });
      avisoEs(cerrado, T.menuCerrado());
    }
    // sin menú abierto no hay nada que cerrar
    const sinMenu = conEjemplo();
    expect(reducir(sinMenu, { k: 'cerrarMenu' })).toBe(sinMenu);
  });

  it('constructor.reductor.abrir_un_menu_cierra_el_modo_conectando_y_solo_hay_uno_a_la_vez', () => {
    let e = ir(conEjemplo(), { k: 'iniciarConexion', ancla: 'a2', rol: 'origen', tipo: 'seq' });
    expect(e.conectando).not.toBeNull();
    e = ir(e, { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' });
    expect(e.conectando).toBeNull();
    expect(e.menu).not.toBeNull();
    e = ir(e, { k: 'iniciarConexion', ancla: 'a2', rol: 'origen', tipo: 'seq' });
    expect(e.menu).toBeNull();
    expect(e.conectando).not.toBeNull();
  });

  it('constructor.reductor.el_paso_poner_en_medio_exige_una_conexion_de_un_solo_sentido_que_salga_del_cuadro', () => {
    const e = conEjemplo();
    // e2 sale de a1; e3 es una herramienta; e1 sale de t1
    for (const [ancla, tipo, insertarEn] of [
      ['a1', 'seq', 'e1'], // sale de otro cuadro
      ['a1', 'seq', 'e3'], // es de ida y vuelta
      ['a1', 'tool', 'e2'], // no se inserta con el menú de la patita
      ['a1', 'seq', 'zzz'], // no existe
    ] as const) {
      expect(reducir(e, { k: 'abrirMenu', ancla, tipo, insertarEn })).toBe(e);
    }
    const bien = ir(e, { k: 'abrirMenu', ancla: 'a1', tipo: 'seq', insertarEn: 'e2' });
    expect(bien.menu).toEqual({ ancla: 'a1', tipo: 'seq', paso: 'inicio', insertarEn: 'e2' });
    avisoEs(bien, T.menuEnMedio());
    expect(bien.aviso?.texto).toBe('Elige qué poner en medio de la conexión.');
  });

  it('constructor.reductor.el_paso_del_menu_cambia_y_la_patita_no_vuelve_al_inicio', () => {
    const e = ir(conEjemplo(), { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' });
    expect(ir(e, { k: 'pasoMenu', paso: 'app' }).menu?.paso).toBe('app');
    expect(ir(e, { k: 'pasoMenu', paso: 'app' }, { k: 'pasoMenu', paso: 'inicio' }).menu?.paso).toBe('inicio');
    const patita = ir(conEjemplo(), { k: 'abrirMenu', ancla: 'a1', tipo: 'tool' });
    expect(patita.menu?.paso).toBe('app');
    expect(reducir(patita, { k: 'pasoMenu', paso: 'inicio' })).toBe(patita); // sin «Atrás»
    const sinMenu = conEjemplo();
    expect(reducir(sinMenu, { k: 'pasoMenu', paso: 'app' })).toBe(sinMenu);
  });
});

// ---------------------------------------------------------------- 3 · la patita: SOLO apps

describe('reductor · la patita solo ofrece apps', () => {
  it('constructor.reductor.la_patita_abre_directo_la_lista_de_apps_y_no_crea_una_ia', () => {
    let e = ir(conEjemplo(), { k: 'abrirMenu', ancla: 'a2', tipo: 'tool' });
    expect(e.menu?.paso).toBe('app');
    avisoEs(e, T.menuHerramienta('Revisor'));
    expect(e.aviso?.texto).toBe('Elige la app que le das a «Revisor» como herramienta.');
    const antes = e.flujo;
    e = ir(e, { k: 'crearDesdeMenu', que: 'agente' });
    expect(e.flujo).toBe(antes);
    avisoEs(e, T.soloAppsEnElMenu());
    expect(e.aviso?.texto).toMatch(/solo van apps/);
    expect(e.menu).not.toBeNull(); // el menú sigue abierto
    expect(puedeDeshacer(e)).toBe(false);
  });

  it('constructor.reductor.una_app_por_la_patita_cuelga_debajo_de_su_agente_en_ida_y_vuelta', () => {
    let e = ir(conEjemplo(), { k: 'abrirMenu', ancla: 'a2', tipo: 'tool' });
    const antes = e.flujo.nodes.length;
    e = ir(e, { k: 'crearDesdeMenu', que: 'app', nombreApp: 'Notion' });
    expect(e.flujo.nodes).toHaveLength(antes + 1);
    const nueva = ultimoNodo(e);
    expect(ultimaArista(e)).toEqual({ id: 'e21', de: 'a2', a: nueva.id, tipo: 'tool' });
    expect(nueva.id).toBe('p21');
    expect(nueva.y).toBeGreaterThan(nodo(e, 'a2').y + 96); // cuelga debajo
    avisoEs(e, T.agregado('Notion', false, { herramientaDe: 'Revisor' }));
    expect(e.aviso?.texto).toBe('Agregamos «Notion» como herramienta de «Revisor». Sus ajustes están en el panel de Ajustes.');
  });

  it('constructor.reductor.una_app_no_tiene_patita_ni_se_abre_su_menu_de_herramientas', () => {
    const e = conEjemplo();
    const r = ir(e, { k: 'abrirMenu', ancla: 'p2', tipo: 'tool' });
    expect(r.menu).toBeNull();
    avisoEs(r, T.soloAgentesTienenHerramientas());
    // y aunque se intente crear sin menú, no pasa nada
    const antes = r.flujo;
    expect(ir(r, { k: 'crearDesdeMenu', que: 'app', nombreApp: 'Gmail' }).flujo).toBe(antes);
    // lo mismo por el modo «conectando»: solo un agente tiene patita
    const c = ir(e, { k: 'iniciarConexion', ancla: 'p2', rol: 'origen', tipo: 'tool' });
    expect(c.conectando).toBeNull();
    avisoEs(c, T.soloAgentesTienenHerramientas());
  });

  it('constructor.reductor.la_ia_que_sigue_va_a_la_derecha_como_paso_y_el_flujo_no_pide_descripcion', () => {
    const e = ir(
      conEjemplo(),
      { k: 'abrirMenu', ancla: 'a2', tipo: 'seq' },
      { k: 'crearDesdeMenu', que: 'agente' },
    );
    const ag3 = ultimoNodo(e);
    expect(ag3).toMatchObject({
      kind: 'agent',
      nombre: 'Agente 1',
      ia: 'openai',
      tarea: '',
      instrucciones: 'Eres un asistente útil. Responde en español, con claridad.',
    });
    expect((ag3 as NodoAgente).desc).toBeUndefined();
    expect(ultimaArista(e)).toMatchObject({ de: 'a2', a: ag3.id, tipo: 'seq' });
    expect(ag3.x).toBeGreaterThanOrEqual(nodo(e, 'a2').x + 216);
    expect(revisarFlujo(e.flujo).errores).toEqual([]);
    avisoEs(e, T.agregado('Agente 1', true, { despuesDe: 'Revisor' }));
    expect(e.aviso?.texto).toBe('Agregamos el agente «Agente 1» después de «Revisor». Sus ajustes están en el panel de Ajustes.');
  });

  it('constructor.reductor.el_nombre_de_un_agente_nuevo_es_el_primer_agente_n_libre', () => {
    // el ejemplo no tiene «Agente k»: el primero es 1; si se quita el 1 y se agrega otro, no se repite el 2
    let e = conEjemplo();
    for (let i = 0; i < 2; i += 1) e = ir(e, { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' }, { k: 'crearDesdeMenu', que: 'agente' });
    expect(e.flujo.nodes.filter(n => n.kind === 'agent').map(n => (n as NodoAgente).nombre)).toEqual([
      'Atención a clientes',
      'Revisor',
      'Agente 1',
      'Agente 2',
    ]);
    const primero = e.flujo.nodes.find(n => n.kind === 'agent' && n.nombre === 'Agente 1');
    e = ir(e, { k: 'quitarNodo', id: primero?.id ?? '' });
    // sobran 3 agentes: se puede agregar otro, y toma el hueco
    e = ir(e, { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' }, { k: 'crearDesdeMenu', que: 'agente' });
    expect((ultimoNodo(e) as NodoAgente).nombre).toBe('Agente 1');
  });
});

// ---------------------------------------------------------------- 4 y 5 · topes y sin encimados

describe('reductor · los topes de 4 agentes y 8 apps', () => {
  it('constructor.reductor.hay_hasta_4_agentes_y_8_apps_con_su_aviso_y_sin_cuadros_encimados', () => {
    let e = conEjemplo();
    for (let i = 0; i < 6; i += 1) e = ir(e, { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' }, { k: 'crearDesdeMenu', que: 'agente' });
    expect(e.flujo.nodes.filter(n => n.kind === 'agent')).toHaveLength(TOPE_AGENTES);
    // (un «+» tocado con el menú abierto lo cierra: se deja el menú cerrado para abrirlo de verdad)
    if (e.menu) e = ir(e, { k: 'cerrarMenu' });
    e = ir(e, { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' }, { k: 'crearDesdeMenu', que: 'agente' });
    avisoEs(e, T.topeAgentes());
    expect(e.aviso?.texto).toBe('Por ahora son hasta 4 agentes por flujo.');
    for (let i = 0; i < 12; i += 1) {
      e = ir(e, { k: 'abrirMenu', ancla: 'a1', tipo: 'tool' }, { k: 'crearDesdeMenu', que: 'app', nombreApp: 'Notion' });
    }
    expect(e.flujo.nodes.filter(n => n.kind === 'app')).toHaveLength(TOPE_APPS);
    if (e.menu) e = ir(e, { k: 'cerrarMenu' });
    e = ir(e, { k: 'abrirMenu', ancla: 'a1', tipo: 'tool' }, { k: 'crearDesdeMenu', que: 'app', nombreApp: 'Notion' });
    avisoEs(e, T.topeApps());
    expect(e.aviso?.texto).toBe('Por ahora son hasta 8 apps por flujo.');
    // sin cuadros encimados y dentro del lienzo
    const pos = e.flujo.nodes.map(n => `${n.x},${n.y}`);
    expect(new Set(pos).size).toBe(pos.length);
    expect(hayEncimados(e.flujo.nodes)).toBe(false);
    for (const n of e.flujo.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(X_MAX);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(Y_MAX);
    }
    // el lienzo crece lo justo para que quepan todos y el «+» del último
    expect(altoLienzo(e.flujo.nodes)).toBeGreaterThanOrEqual(Math.max(...e.flujo.nodes.map(n => n.y)) + 96 + 72);
    expect(anchoLienzo(e.flujo.nodes)).toBeGreaterThanOrEqual(Math.max(...e.flujo.nodes.map(n => n.x)) + 216 + 112);
    expect(invariantesDelEstado(e)).toEqual([]);
    expect(e.flujo.nodes).toHaveLength(1 + TOPE_AGENTES + TOPE_APPS);
  });

  it('constructor.reductor.un_tope_alcanzado_no_cambia_el_flujo_ni_gasta_un_numero_de_id', () => {
    let e = conEjemplo();
    for (let i = 0; i < 2; i += 1) e = ir(e, { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' }, { k: 'crearDesdeMenu', que: 'agente' });
    e = ir(e, { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' });
    const antes = e;
    const tras = ir(e, { k: 'crearDesdeMenu', que: 'agente' });
    expect(tras.flujo).toBe(antes.flujo);
    expect(tras.siguiente).toBe(antes.siguiente);
    expect(tras.historial).toBe(antes.historial);
    expect(tras.menu).toBe(antes.menu);
  });
});

// ---------------------------------------------------------------- 6 · el editor de la flecha

describe('reductor · el editor de la flecha', () => {
  it('constructor.reductor.tocar_una_flecha_la_elige_y_suelta_el_cuadro_y_al_reves', () => {
    let e = ir(conEjemplo(), { k: 'abrirEnlace', id: 'e2' });
    expect(e.selEdge).toBe('e2');
    expect(e.sel).toBeNull();
    expect(e.menu).toBeNull();
    expect(e.conectando).toBeNull();
    avisoEs(e, T.abrirEnlace('Atención a clientes', 'Revisor'));
    expect(e.aviso?.texto).toBe(
      'Elegiste la conexión de «Atención a clientes» a «Revisor». En el panel de Ajustes puedes cambiarla.',
    );
    expect(foco(e)).toEqual({ k: 'opcionUnSentido' });
    expect(e.scrollAjustes).toBe(1);
    // elegir un cuadro suelta la flecha (y no cambia el aviso)
    const aviso = e.aviso;
    e = ir(e, { k: 'abrirNodo', id: 'a1' });
    expect(e.selEdge).toBeNull();
    expect(e.sel).toBe('a1');
    expect(e.aviso).toBe(aviso);
    e = ir(e, { k: 'abrirEnlace', id: 'e1' });
    expect(e.sel).toBeNull();
    expect(e.selEdge).toBe('e1');
  });

  it('constructor.reductor.dos_ia_pueden_conversar_en_linea_recta_con_su_descripcion_y_volver_a_un_sentido', () => {
    let e = ir(conEjemplo(), { k: 'abrirEnlace', id: 'e2' }, { k: 'cambiarTipoEnlace', id: 'e2', tipo: 'tool' });
    expect(arista(e, 'e2').tipo).toBe('tool');
    const A = nodo(e, 'a1');
    const B = nodo(e, 'a2');
    expect(B.x).toBeGreaterThanOrEqual(A.x + 216 + 60);
    expect(Math.abs(B.y - A.y)).toBeLessThan(96);
    expect((B as NodoAgente).desc).toBe(DESC_AYUDANTE_POR_DEFECTO);
    avisoEs(e, T.ahoraConversan('Atención a clientes', 'Revisor'), true);
    expect(e.aviso?.texto).toBe(
      '«Atención a clientes» y «Revisor» ahora conversan: ida y vuelta. Revisa en sus ajustes para qué le sirve «Revisor».',
    );
    expect(e.selEdge).toBe('e2'); // la flecha sigue elegida
    expect(revisarFlujo(e.flujo).errores).toEqual([]);

    e = ir(e, { k: 'cambiarTipoEnlace', id: 'e2', tipo: 'seq' });
    expect(arista(e, 'e2').tipo).toBe('seq');
    avisoEs(e, T.ahoraVaDespues('Atención a clientes', 'Revisor'), true);
    expect(e.aviso?.texto).toBe('«Revisor» ahora va después de «Atención a clientes»: un solo sentido.');
    // la descripción que se rellenó se queda (no estorba)
    expect((nodo(e, 'a2') as NodoAgente).desc).toBe(DESC_AYUDANTE_POR_DEFECTO);
  });

  it('constructor.reductor.una_descripcion_que_ya_estaba_escrita_no_se_pisa_al_volverse_ayudante', () => {
    const f = ejemplo();
    const a2 = f.nodes.find(n => n.id === 'a2');
    if (a2?.kind !== 'agent') throw new Error('a2');
    a2.desc = 'Mi descripción';
    const e = ir(conFlujo(f), { k: 'cambiarTipoEnlace', id: 'e2', tipo: 'tool' });
    expect((nodo(e, 'a2') as NodoAgente).desc).toBe('Mi descripción');
  });

  it('constructor.reductor.una_herramienta_pasa_a_ser_paso_a_la_derecha_y_un_paso_vuelve_a_colgar_debajo', () => {
    let e = ir(conEjemplo(), { k: 'cambiarTipoEnlace', id: 'e4', tipo: 'seq' }); // a2 → Slack: de herramienta a paso
    expect(arista(e, 'e4').tipo).toBe('seq');
    const a2 = nodo(e, 'a2');
    expect(nodo(e, 'p2').x).toBeGreaterThanOrEqual(a2.x + 216 + 60);
    avisoEs(e, T.ahoraVaDespues('Revisor', 'Slack'), true);
    e = ir(e, { k: 'cambiarTipoEnlace', id: 'e4', tipo: 'tool' }); // y de vuelta
    expect(arista(e, 'e4').tipo).toBe('tool');
    expect(nodo(e, 'p2').y).toBeGreaterThanOrEqual(a2.y + 96 + 16);
    avisoEs(e, T.ahoraEsHerramienta('Revisor', 'Slack'), true);
    expect(e.aviso?.texto).toBe('«Slack» ahora es herramienta de «Revisor»: ida y vuelta.');
    // solo se mueve el destino
    const moved = e.flujo.nodes.filter(n => !conEjemplo().flujo.nodes.some(o => o.x === n.x && o.y === n.y && o.id === n.id));
    expect(moved.map(n => n.id)).toEqual(['p2']);
    expect(invariantesDelEstado(e)).toEqual([]);
  });

  it('constructor.reductor.si_la_regla_lo_rechaza_el_tipo_no_cambia_y_el_motivo_sale_en_el_aviso', () => {
    const e0 = conEjemplo();
    // el disparador no es un agente: no puede ser ida y vuelta
    const e = ir(e0, { k: 'cambiarTipoEnlace', id: 'e1', tipo: 'tool' });
    expect(e.flujo).toBe(e0.flujo);
    avisoEs(e, T.noSePuedeCambiar('Solo un agente de IA puede tener herramientas o conversar con otra IA.'));
    expect(e.aviso?.texto).toMatch(/^No se puede cambiar: /);
    // cambiar al mismo tipo no hace nada, ni siquiera avisa
    expect(reducir(e0, { k: 'cambiarTipoEnlace', id: 'e1', tipo: 'seq' })).toBe(e0);
    // y un tipo que no existe tampoco
    expect(reducir(e0, { k: 'cambiarTipoEnlace', id: 'e1', tipo: 'raro' as TipoArista })).toBe(e0);
  });

  it('constructor.reductor.cambiar_el_tipo_de_la_conexion_donde_iba_a_insertar_cierra_ese_menu', () => {
    const e = ir(
      conEjemplo(),
      { k: 'abrirMenu', ancla: 'a1', tipo: 'seq', insertarEn: 'e2' },
      { k: 'cambiarTipoEnlace', id: 'e2', tipo: 'tool' },
    );
    expect(e.menu).toBeNull();
    // quitar esa conexión también lo cierra
    const q = ir(conEjemplo(), { k: 'abrirMenu', ancla: 'a1', tipo: 'seq', insertarEn: 'e2' }, { k: 'quitarEnlace', id: 'e2' });
    expect(q.menu).toBeNull();
  });

  it('constructor.reductor.quitar_una_conexion_la_suelta_cierra_su_menu_y_manda_el_foco_a_su_origen', () => {
    let e = ir(conEjemplo(), { k: 'abrirEnlace', id: 'e2' });
    e = ir(e, { k: 'quitarEnlace', id: 'e2' });
    expect(e.flujo.edges.some(x => x.id === 'e2')).toBe(false);
    expect(e.flujo.edges).toHaveLength(3);
    expect(e.selEdge).toBeNull();
    avisoEs(e, T.conexionQuitada(), true);
    expect(e.aviso?.texto).toBe('Quitamos la conexión.');
    expect(foco(e)).toEqual({ k: 'nodo', id: 'a1' });
    // quitar otra conexión no suelta la elegida
    const e2 = ir(conEjemplo(), { k: 'abrirEnlace', id: 'e2' }, { k: 'quitarEnlace', id: 'e4' });
    expect(e2.selEdge).toBe('e2');
  });
});

// ---------------------------------------------------------------- 7 · poner un cuadro en medio

describe('reductor · poner un cuadro en medio de una conexión', () => {
  it('constructor.reductor.en_medio_reemplaza_la_conexion_vieja_por_a_nuevo_b_y_corre_lo_que_sigue', () => {
    let e = ir(conEjemplo(), { k: 'abrirEnlace', id: 'e2' });
    e = ir(
      e,
      { k: 'abrirMenu', ancla: 'a1', tipo: 'seq', insertarEn: 'e2' },
      { k: 'pasoMenu', paso: 'app' },
      { k: 'crearDesdeMenu', que: 'app', nombreApp: 'Gmail' },
    );
    expect(e.flujo.edges.some(x => x.id === 'e2')).toBe(false);
    const gm = ultimoNodo(e);
    expect(gm).toMatchObject({ kind: 'app', nombre: 'Gmail' });
    expect(e.flujo.edges.some(x => x.de === 'a1' && x.a === gm.id && x.tipo === 'seq')).toBe(true);
    expect(e.flujo.edges.some(x => x.de === gm.id && x.a === 'a2' && x.tipo === 'seq')).toBe(true);
    expect(alcanza(e.flujo.edges, 'a2', 'a1')).toBe(false);
    expect(revisarFlujo(e.flujo).errores).toEqual([]);
    // las coordenadas son las del mockup: el nuevo a 344 de a1 y lo que sigue corrido para hacerle lugar
    expect(gm.x).toBe(656);
    expect(gm.y).toBe(184);
    expect(nodo(e, 'a2').x).toBe(1000);
    expect(nodo(e, 'p2').x).toBe(864); // la herramienta de a2 se corre con él
    expect(nodo(e, 'a1').x).toBe(312); // y lo de antes no se mueve
    avisoEs(e, T.agregado('Gmail', false, 'medio'), true);
    expect(e.aviso?.texto).toBe('Agregamos «Gmail» en medio. Sus ajustes están en el panel de Ajustes.');
    expect(e.menu).toBeNull();
    expect(e.siguiente).toBe(22); // e21 (a1 → nuevo) y e22 (nuevo → a2)
    expect(e.flujo.edges.map(x => x.id)).toEqual(['e1', 'e3', 'e4', 'e21', 'e22']);
    expect(invariantesDelEstado(e)).toEqual([]);
  });

  it('constructor.reductor.si_no_cabe_en_medio_avisa_y_no_toca_nada', () => {
    // a1 y su destino están tan a la derecha que no se puede correr nada y el cuadro nuevo no queda entre los dos
    const f: Flujo = {
      nodes: [
        { id: 't1', kind: 'trigger', x: 8, y: 180, tipo: 'chat', frec: 'dia', ruta: 'mi-flujo', app: 'gmail' },
        agenteSuelto('a1', 1800, 180, { nombre: 'Uno' }),
        agenteSuelto('a2', 2000, 180, { nombre: 'Dos' }),
      ],
      edges: [
        { id: 'e1', de: 't1', a: 'a1', tipo: 'seq' },
        { id: 'e2', de: 'a1', a: 'a2', tipo: 'seq' },
      ],
      nombreFlujo: 'x',
    };
    const abierto = ir(conFlujo(f), { k: 'abrirMenu', ancla: 'a1', tipo: 'seq', insertarEn: 'e2' }, { k: 'pasoMenu', paso: 'app' });
    const e = ir(abierto, { k: 'crearDesdeMenu', que: 'app', nombreApp: 'Gmail' });
    expect(e.flujo).toBe(abierto.flujo);
    expect(e.siguiente).toBe(abierto.siguiente);
    expect(e.historial).toBe(abierto.historial);
    expect(e.menu).toBe(abierto.menu); // el menú sigue abierto
    avisoEs(e, T.sinLugarEnMedio());
    expect(e.aviso?.texto).toBe('No hay lugar en medio de esa conexión: mueve los cuadros de la derecha y vuelve a intentarlo.');
  });

  it('constructor.reductor.si_la_conexion_ya_no_existe_al_crear_se_cierra_el_menu_y_se_dice', () => {
    // el menú se abre para insertar en e2 y la conexión desaparece antes de elegir (por un estado armado a mano)
    const abierto = ir(conEjemplo(), { k: 'abrirMenu', ancla: 'a1', tipo: 'seq', insertarEn: 'e2' });
    const sinE2: E = congelar({ ...abierto, flujo: { ...abierto.flujo, edges: abierto.flujo.edges.filter(x => x.id !== 'e2') } });
    const e = ir(sinE2, { k: 'crearDesdeMenu', que: 'agente' });
    expect(e.menu).toBeNull();
    expect(e.flujo).toBe(sinE2.flujo); // no se creó nada
    avisoEs(e, T.conexionYaNoExiste());
    expect(e.aviso?.texto).toBe('Esa conexión ya no existe.');
  });
});

// ---------------------------------------------------------------- 8 · la × de cada cuadro y quitar con unión

describe('reductor · quitar un cuadro', () => {
  it('constructor.reductor.quitar_el_disparador_lo_dice_y_pide_otro_y_el_nuevo_se_reconecta', () => {
    let e = ir(conEjemplo(), { k: 'quitarNodo', id: 't1' });
    expect(e.flujo.nodes.some(n => n.id === 't1')).toBe(false);
    expect(e.flujo.edges.some(x => x.de === 't1' || x.a === 't1')).toBe(false);
    avisoEs(e, T.quitamos({ titulo: 'Disparador Chat', unidos: false, sueltas: 0, esDisparador: true }), true);
    expect(e.aviso?.texto).toBe(
      'Quitamos «Disparador Chat» y sus conexiones. Elige otro disparador para que el flujo vuelva a arrancar.',
    );
    expect(e.flujo.nodes.some(n => n.kind === 'trigger')).toBe(false);
    expect(e.sel).toBe('a1'); // quitar otro cuadro no cambia el elegido
    expect(foco(e)).toEqual({ k: 'primerNodo' });
    e = ir(e, { k: 'elegirDisparador', tipo: 'tiempo' });
    expect(e.flujo.edges.some(x => x.a === 'a1' && x.tipo === 'seq' && x.de === 't21')).toBe(true);
    expect(e.aviso?.conDeshacer).toBe(false); // otro aviso: ya no ofrece deshacer lo anterior
  });

  it('constructor.reductor.quitar_un_cuadro_en_medio_une_lo_de_antes_con_lo_de_despues_y_deja_sueltas_sus_herramientas', () => {
    const e = ir(conEjemplo(), { k: 'quitarNodo', id: 'a1' });
    expect(e.flujo.edges.some(x => x.de === 't1' && x.a === 'a2' && x.tipo === 'seq')).toBe(true);
    expect(e.flujo.edges.some(x => x.de === 'a1' || x.a === 'a1')).toBe(false);
    expect(e.flujo.nodes.some(n => n.id === 'p1')).toBe(true); // la herramienta queda suelta, no se borra
    expect(e.flujo.edges.map(x => x.id)).toEqual(['e4', 'e21']);
    expect(e.siguiente).toBe(21);
    avisoEs(e, T.quitamos({ titulo: 'Atención a clientes', unidos: true, sueltas: 1, esDisparador: false }), true);
    expect(e.aviso?.texto).toBe(
      'Quitamos «Atención a clientes» y unimos lo de antes con lo de después. Su herramienta quedó suelta en el lienzo: quítala también si ya no la necesitas.',
    );
    expect(e.sel).toBeNull(); // era el elegido
    expect(foco(e)).toEqual({ k: 'nodo', id: 't1' }); // el foco va al cuadro de donde venía el flujo
    expect(invariantesDelEstado(e)).toEqual([]);
  });

  it('constructor.reductor.varias_herramientas_sueltas_se_cuentan_en_plural', () => {
    const f = ejemplo();
    f.nodes.push(appSuelta('p3', 480, 520, 'Notion'));
    f.edges.push({ id: 'e5', de: 'a1', a: 'p3', tipo: 'tool' });
    const e = ir(conFlujo(f), { k: 'quitarNodo', id: 'a1' });
    expect(e.aviso?.texto).toBe(
      'Quitamos «Atención a clientes» y unimos lo de antes con lo de después. Sus 2 herramientas quedaron sueltas en el lienzo: quítalas también si ya no las necesitas.',
    );
  });

  it('constructor.reductor.quitar_un_agente_sin_nada_antes_ni_despues_dice_solo_sus_conexiones', () => {
    const e = ir(conEjemplo(), { k: 'quitarNodo', id: 'p2' });
    expect(e.aviso?.texto).toBe('Quitamos «Slack» y sus conexiones.');
    expect(e.flujo.nodes).toHaveLength(4);
    expect(e.flujo.edges.map(x => x.id)).toEqual(['e1', 'e2', 'e3']);
    expect(e.sel).toBe('a1'); // quitar otro cuadro no cambia el elegido
    // quitar el elegido (el botón del panel) lo suelta
    const q = ir(conEjemplo(), { k: 'quitarNodo', id: 'a1' });
    expect(q.sel).toBeNull();
    const q2 = ir({ ...conEjemplo(), sel: 'a2' }, { k: 'quitarNodo', id: 'a2' });
    expect(q2.flujo.nodes.some(n => n.id === 'a2')).toBe(false);
    expect(q2.sel).toBeNull();
  });

  it('constructor.reductor.quitar_cierra_el_menu_y_el_modo_conectando_y_conserva_la_flecha_elegida_si_sobrevive', () => {
    let e = ir(conEjemplo(), { k: 'abrirEnlace', id: 'e4' }, { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' });
    e = ir(e, { k: 'quitarNodo', id: 'p1' });
    expect(e.menu).toBeNull();
    // la flecha e4 sobrevive, pero abrirMenu ya había soltado la selección de flecha
    expect(e.selEdge).toBeNull();
    let c = ir(conEjemplo(), { k: 'abrirEnlace', id: 'e4' }, { k: 'quitarNodo', id: 'p1' });
    expect(c.selEdge).toBe('e4');
    c = ir(c, { k: 'quitarNodo', id: 'p2' });
    expect(c.selEdge).toBeNull(); // su conexión se fue con el cuadro
    const m = ir(conEjemplo(), { k: 'iniciarConexion', ancla: 'a2', rol: 'origen', tipo: 'seq' }, { k: 'quitarNodo', id: 'p1' });
    expect(m.conectando).toBeNull();
  });

  it('constructor.reductor.quitar_lo_ultimo_manda_el_foco_a_elegir_el_disparador_y_nunca_al_body', () => {
    let e = ir(conEjemplo(), { k: 'quitarNodo', id: 'p2' }, { k: 'quitarNodo', id: 'p1' }, { k: 'quitarNodo', id: 'a2' });
    expect(foco(e)).toEqual({ k: 'nodo', id: 'a1' }); // a1 era de donde venía a2
    e = ir(e, { k: 'quitarNodo', id: 'a1' });
    expect(foco(e)).toEqual({ k: 'nodo', id: 't1' });
    e = ir(e, { k: 'quitarNodo', id: 't1' });
    expect(e.flujo.nodes).toEqual([]);
    expect(foco(e)).toEqual({ k: 'primeraOpcionDisparador' });
  });

  it('constructor.reductor.quitar_una_ia_que_conversa_pasa_lo_que_le_seguia_a_su_agente', () => {
    // a1 y a2 conversan; después de a2 se agrega Gmail (sale del agente principal en n8n)
    let e = ir(
      conEjemplo(),
      { k: 'cambiarTipoEnlace', id: 'e2', tipo: 'tool' },
      { k: 'abrirMenu', ancla: 'a2', tipo: 'seq' },
      { k: 'crearDesdeMenu', que: 'app', nombreApp: 'Gmail' },
    );
    const gm = ultimoNodo(e);
    expect(e.flujo.edges.some(x => x.de === 'a2' && x.a === gm.id && x.tipo === 'seq')).toBe(true);
    const r = construirFlujo(e.flujo, { zona: 'UTC' });
    expect(r.errores).toEqual([]);
    expect(r.flujo?.connections['Atención a clientes']?.main?.[0]?.some(x => x.node === 'Gmail')).toBe(true);
    expect(r.flujo?.connections.Revisor?.main).toBeUndefined();
    e = ir(e, { k: 'quitarNodo', id: 'a2' });
    expect(e.flujo.nodes.some(n => n.id === 'a2')).toBe(false);
    expect(e.flujo.edges.some(x => x.de === 'a1' && x.a === gm.id && x.tipo === 'seq')).toBe(true);
    expect(invariantesDelEstado(e)).toEqual([]);
  });
});

// ---------------------------------------------------------------- 9 y 12 · conectar con uno que ya está

describe('reductor · conectar con un cuadro que ya está', () => {
  it('constructor.reductor.conectar_con_uno_suelto_valida_y_rechaza_con_el_motivo_mas_elige_otro', () => {
    let e = conFlujo(ejemploMas(appSuelta('z', 700, 400, 'Notion')), 'a1');
    e = ir(e, { k: 'iniciarConexion', ancla: 'a2', rol: 'origen', tipo: 'seq' });
    expect(e.conectando).toEqual({ ancla: 'a2', rol: 'origen', tipo: 'seq' });
    expect(e.menu).toBeNull();
    expect(e.sel).toBe('a2');
    avisoEs(e, T.textoConectar('seq', 'origen', 'Revisor'));
    expect(e.aviso?.texto).toBe('Toca el cuadro que irá DESPUÉS de «Revisor».');
    expect(foco(e)).toEqual({ k: 'nodo', id: 'a2' });

    // p1 es herramienta: no puede ser un paso
    const rechazado = ir(e, { k: 'intentarConexion', id: 'p1' });
    expect(rechazado.flujo).toBe(e.flujo);
    expect(rechazado.conectando).toEqual(e.conectando); // sigue esperando otro cuadro
    avisoEs(rechazado, T.elegirOtro('«Google Sheets» es herramienta de un agente: no puede ser un paso del flujo.'));
    expect(rechazado.aviso?.texto).toBe(
      '«Google Sheets» es herramienta de un agente: no puede ser un paso del flujo. Elige otro cuadro, o cancela.',
    );

    const hecho = ir(rechazado, { k: 'intentarConexion', id: 'z' });
    expect(hecho.flujo.edges).toHaveLength(5);
    expect(ultimaArista(hecho)).toEqual({ id: 'e21', de: 'a2', a: 'z', tipo: 'seq' });
    expect(hecho.conectando).toBeNull();
    expect(hecho.sel).toBe('a2');
    avisoEs(hecho, T.conectados('Revisor', 'Notion'));
    expect(hecho.aviso?.texto).toBe('Conectamos «Revisor» con «Notion».');
  });

  it('constructor.reductor.tocar_el_cuadro_de_origen_o_el_mismo_boton_cancela_y_cancelar_devuelve_el_foco', () => {
    const c = ir(conEjemplo(), { k: 'iniciarConexion', ancla: 'a2', rol: 'origen', tipo: 'seq' });
    // el mismo cuadro
    const mismo = ir(c, { k: 'intentarConexion', id: 'a2' });
    expect(mismo.conectando).toBeNull();
    avisoEs(mismo, T.conexionCancelada());
    expect(mismo.aviso?.texto).toBe('Cancelamos la conexión.');
    // el mismo botón otra vez
    const otra = ir(c, { k: 'iniciarConexion', ancla: 'a2', rol: 'origen', tipo: 'seq' });
    expect(otra.conectando).toBeNull();
    avisoEs(otra, T.conexionCancelada());
    // el botón «Cancelar» del aviso
    const x = ir(c, { k: 'cancelarConexion' });
    expect(x.conectando).toBeNull();
    avisoEs(x, T.conexionCancelada());
    expect(foco(x)).toEqual({ k: 'nodo', id: 'a2' });
    // sin modo conectando no hay nada que cancelar ni intentar
    const sin = conEjemplo();
    expect(reducir(sin, { k: 'cancelarConexion' })).toBe(sin);
    expect(reducir(sin, { k: 'intentarConexion', id: 'a1' })).toBe(sin);
  });

  it('constructor.reductor.tocar_un_cuadro_en_modo_conectando_intenta_la_conexion_y_no_abre_ajustes', () => {
    let e = conFlujo(ejemploMas(appSuelta('z', 700, 400, 'Notion')), 'a1');
    e = ir(e, { k: 'iniciarConexion', ancla: 'a2', rol: 'origen', tipo: 'seq' });
    const scroll = e.scrollAjustes;
    e = ir(e, { k: 'abrirNodo', id: 'z' });
    expect(e.flujo.edges).toHaveLength(5);
    expect(e.scrollAjustes).toBe(scroll);
    expect(e.conectando).toBeNull();
  });

  it('constructor.reductor.la_patita_tambien_conecta_con_una_app_que_ya_esta_pero_no_con_una_ia', () => {
    let e = conFlujo(ejemploMas(appSuelta('z', 700, 400, 'Notion'), agenteSuelto('q', 700, 500)), 'a1');
    e = ir(e, { k: 'iniciarConexion', ancla: 'a2', rol: 'origen', tipo: 'tool' });
    expect(e.conectando).toEqual({ ancla: 'a2', rol: 'origen', tipo: 'tool' });
    avisoEs(e, T.textoConectar('tool', 'origen', 'Revisor'));
    expect(e.aviso?.texto).toBe('Toca la app que «Revisor» podrá usar como herramienta.');
    // una IA que ya es paso del flujo no se puede conectar como herramienta (lo dice la regla de enlace)
    const aIa = ir(e, { k: 'intentarConexion', id: 'a1' });
    expect(aIa.flujo.edges).toHaveLength(4);
    // una IA libre pasa la regla de enlace pero «por la patita solo van apps»
    const libre = ir(e, { k: 'intentarConexion', id: 'q' });
    expect(libre.flujo.edges).toHaveLength(4);
    avisoEs(libre, T.soloAppsAlConectar());
    expect(libre.aviso?.texto).toMatch(/solo van apps/);
    expect(libre.conectando).not.toBeNull();
    // una app suelta sí
    const hecho = ir(e, { k: 'intentarConexion', id: 'z' });
    expect(hecho.flujo.edges).toHaveLength(5);
    expect(ultimaArista(hecho)).toMatchObject({ de: 'a2', a: 'z', tipo: 'tool' });
  });

  it('constructor.reductor.el_rol_destino_conecta_al_reves_y_cambia_los_textos', () => {
    let e = conFlujo(ejemploMas(appSuelta('z', 700, 400, 'Notion')));
    e = ir(e, { k: 'iniciarConexion', ancla: 'a2', rol: 'destino', tipo: 'seq' });
    expect(e.aviso?.texto).toBe('Toca el cuadro que irá ANTES de «Revisor».');
    e = ir(e, { k: 'intentarConexion', id: 'z' }); // z → a2
    expect(ultimaArista(e)).toMatchObject({ de: 'z', a: 'a2', tipo: 'seq' });
    const t = ir(conEjemplo(), { k: 'iniciarConexion', ancla: 'p1', rol: 'destino', tipo: 'tool' });
    expect(t.aviso?.texto).toBe('Toca el agente que podrá usar «Google Sheets» como herramienta.');
    // con rol destino la regla de la patita no aplica: a2 → p... ya conectado así por e4
    const sinPatita = ir(t, { k: 'intentarConexion', id: 'a2' });
    expect(sinPatita.aviso?.tipo).toBe('mal'); // p1 ya es herramienta de a1
  });

  it('constructor.reductor.volver_al_principio_o_al_disparador_se_rechaza_por_las_reglas', () => {
    // a1 y a2 conversan; se rechaza cualquier paso de a2 hacia a1 (círculo)
    let e = ir(conEjemplo(), { k: 'cambiarTipoEnlace', id: 'e2', tipo: 'tool' });
    e = ir(e, { k: 'iniciarConexion', ancla: 'a2', rol: 'origen', tipo: 'seq' }, { k: 'intentarConexion', id: 'a1' });
    avisoEs(e, T.elegirOtro('Eso haría un círculo: el flujo volvería a empezar solo.'));
    expect(e.flujo.edges).toHaveLength(4);
    // la regla de enlace de verdad lo ve como círculo
    expect(hayCiclo({ nodes: e.flujo.nodes, edges: [...e.flujo.edges, { id: 'ez', de: 'a2', a: 'a1', tipo: 'seq' }] })).toBe(true);
    // un paso después de la IA que conversa no puede volver a su agente
    let f = ir(
      conEjemplo(),
      { k: 'cambiarTipoEnlace', id: 'e2', tipo: 'tool' },
      { k: 'abrirMenu', ancla: 'a2', tipo: 'seq' },
      { k: 'pasoMenu', paso: 'app' },
      { k: 'crearDesdeMenu', que: 'app', nombreApp: 'Notion' },
    );
    const nt = ultimoNodo(f).id;
    f = ir(f, { k: 'iniciarConexion', ancla: nt, rol: 'origen', tipo: 'seq' }, { k: 'intentarConexion', id: 'a1' });
    expect(f.flujo.edges).toHaveLength(5);
    expect(f.aviso?.tipo).toBe('mal');
    // nada puede ir antes de un disparador
    const g = ir(conEjemplo(), { k: 'iniciarConexion', ancla: 'a2', rol: 'origen', tipo: 'seq' }, { k: 'intentarConexion', id: 't1' });
    expect(g.aviso?.texto).toBe('Nada puede ir antes de un disparador: él es el inicio del flujo. Elige otro cuadro, o cancela.');
  });

  it('constructor.reductor.por_la_patita_la_ia_libre_se_rechaza_y_la_ia_que_sigue_se_agrega_desde_la_que_conversa', () => {
    let e = conFlujo(ejemploMas(agenteSuelto('q', 700, 500)));
    e = ir(e, { k: 'iniciarConexion', ancla: 'a2', rol: 'origen', tipo: 'tool' }, { k: 'intentarConexion', id: 'q' });
    expect(e.aviso?.texto).toMatch(/solo van apps/);
    expect(e.flujo.edges).toHaveLength(4);
  });
});

// ---------------------------------------------------------------- 10 y 11 · selección y Esc

describe('reductor · seleccionar y cerrar', () => {
  it('constructor.reductor.tocar_un_cuadro_lo_elige_cierra_el_menu_y_lleva_ajustes_a_la_vista', () => {
    const base = ir(conEjemplo(), { k: 'abrirMenu', ancla: 'a1', tipo: 'tool' });
    const aviso = base.aviso;
    const e = ir(base, { k: 'abrirNodo', id: 'p2' });
    expect(e.sel).toBe('p2');
    expect(e.selEdge).toBeNull();
    expect(e.menu).toBeNull();
    expect(e.scrollAjustes).toBe(base.scrollAjustes + 1);
    expect(e.aviso).toBe(aviso); // no cambia el aviso
    // con ratón no se pide foco: se queda donde está. La petición de la primera opción del menú, que ya se cerró, se apaga
    expect(foco(base)).toEqual({ k: 'primeraOpcionMenu' });
    expect(e.foco).toBeNull();
    // con Enter o Espacio el foco pasa al panel de Ajustes
    const k = ir(base, { k: 'abrirNodo', id: 'p2', teclado: true });
    expect(foco(k)).toEqual({ k: 'ajustes' });
    // volver de Ajustes: a la flecha elegida o al cuadro
    expect(foco(ir(k, { k: 'volverDeAjustes' }))).toEqual({ k: 'nodo', id: 'p2' });
    expect(foco(ir(conEjemplo(), { k: 'abrirEnlace', id: 'e1' }, { k: 'volverDeAjustes' }))).toEqual({ k: 'insignia', id: 'e1' });
    const nada = vacio();
    expect(reducir(nada, { k: 'volverDeAjustes' })).toBe(nada);
  });

  it('constructor.reductor.esc_sobre_un_cuadro_cierra_el_menu_y_el_modo_conectando_y_si_no_hay_nada_no_hace_nada', () => {
    const m = ir(conEjemplo(), { k: 'abrirMenu', ancla: 'a1', tipo: 'tool' });
    const a = ir(m, { k: 'cerrarTodo' });
    expect(a.menu).toBeNull();
    avisoEs(a, T.cerramosTodo());
    expect(a.aviso?.texto).toBe('Cerramos lo que estaba abierto.');
    const c = ir(conEjemplo(), { k: 'iniciarConexion', ancla: 'a2', rol: 'origen', tipo: 'seq' }, { k: 'cerrarTodo' });
    expect(c.conectando).toBeNull();
    const sin = conEjemplo();
    expect(reducir(sin, { k: 'cerrarTodo' })).toBe(sin);
  });
});

// ---------------------------------------------------------------- mover y editar

describe('reductor · mover y editar', () => {
  it('constructor.reductor.mover_un_cuadro_lo_ajusta_a_la_rejilla_de_8_y_al_lienzo_y_solo_mueve_ese', () => {
    const e0 = conEjemplo();
    const e = ir(e0, { k: 'moverNodo', id: 'p1', x: 203, y: 411 });
    expect(nodo(e, 'p1')).toMatchObject({ x: 200, y: 408 });
    // (el ejemplo trae y=180 y y=380, que no están en la rejilla: el primer movimiento los acomoda)
    expect(ir(e0, { k: 'moverNodo', id: 'p1', x: 176, y: 380 }).flujo.nodes.find(n => n.id === 'p1')).toMatchObject({ x: 176, y: 384 });
    // los demás cuadros son los mismos objetos
    for (const n of e.flujo.nodes) if (n.id !== 'p1') expect(n).toBe(nodo(e0, n.id));
    expect(e.flujo.edges).toBe(e0.flujo.edges);
    expect(e.sel).toBe(e0.sel);
    expect(e.aviso).toBe(e0.aviso);
    expect(ir(e0, { k: 'moverNodo', id: 'p1', x: -50, y: 9999 }).flujo.nodes.find(n => n.id === 'p1')).toMatchObject({ x: 0, y: 2400 });
    expect(ir(e0, { k: 'moverNodo', id: 'p1', x: 99999, y: -1 }).flujo.nodes.find(n => n.id === 'p1')).toMatchObject({ x: 2400, y: 0 });
    // moverlo a donde ya está no cambia nada (misma referencia)
    const enRejilla = ir(e0, { k: 'moverNodo', id: 'p1', x: 176, y: 384 });
    expect(reducir(enRejilla, { k: 'moverNodo', id: 'p1', x: 176, y: 384 })).toBe(enRejilla);
    expect(reducir(enRejilla, { k: 'moverNodo', id: 'p1', x: 179, y: 387 })).toBe(enRejilla);
    // un valor que no es número no mueve el cuadro a 0
    for (const malo of [Number.NaN, Infinity, -Infinity]) {
      expect(reducir(e0, { k: 'moverNodo', id: 'p1', x: malo, y: 10 })).toBe(e0);
      expect(reducir(e0, { k: 'moverNodo', id: 'p1', x: 10, y: malo })).toBe(e0);
    }
    expect(reducir(e0, { k: 'moverNodo', id: 'p1', x: '5' as unknown as number, y: 10 })).toBe(e0);
  });

  it('constructor.reductor.mover_con_el_teclado_8_px_o_24_con_mayus_elige_el_cuadro_y_no_avisa', () => {
    const e0 = ir(conEjemplo(), { k: 'abrirEnlace', id: 'e1' }); // hay una flecha elegida
    const pasos: [A, number, number][] = [
      // a1 está en (312, 180); la rejilla de 8 acomoda el 180 del ejemplo al primer movimiento (172 → 176, 188 → 192, 204 → 208)
      [{ k: 'moverConTeclado', id: 'a1', direccion: 'izquierda' }, 304, 184],
      [{ k: 'moverConTeclado', id: 'a1', direccion: 'derecha' }, 320, 184],
      [{ k: 'moverConTeclado', id: 'a1', direccion: 'arriba' }, 312, 176],
      [{ k: 'moverConTeclado', id: 'a1', direccion: 'abajo' }, 312, 192],
      [{ k: 'moverConTeclado', id: 'a1', direccion: 'izquierda', grande: true }, 288, 184],
      [{ k: 'moverConTeclado', id: 'a1', direccion: 'abajo', grande: true }, 312, 208],
    ];
    for (const [accion, x, y] of pasos) {
      const e = ir(e0, accion);
      expect(nodo(e, 'a1')).toMatchObject({ x, y });
      expect(e.sel).toBe('a1');
      expect(e.selEdge).toBeNull();
      expect(e.aviso).toBe(e0.aviso);
      // no pide foco (ya está en el cuadro); la petición de la flecha, que ya no está elegida, se apaga
      expect(foco(e0)).toEqual({ k: 'opcionUnSentido' });
      expect(e.foco).toBeNull();
    }
    // contra el borde se queda, pero igual elige el cuadro
    const borde = ir({ ...conEjemplo(), sel: null }, { k: 'moverNodo', id: 'p1', x: 0, y: 0 });
    const alBorde = ir(borde, { k: 'moverConTeclado', id: 'p1', direccion: 'izquierda' });
    expect(nodo(alBorde, 'p1')).toMatchObject({ x: 0, y: 0 });
    expect(alBorde.sel).toBe('p1');
    expect(alBorde.flujo).toBe(borde.flujo);
    const quieto = ir(alBorde, { k: 'moverConTeclado', id: 'p1', direccion: 'arriba' });
    expect(quieto).toBe(alBorde); // ya estaba elegido y no se movió
    expect(reducir(e0, { k: 'moverConTeclado', id: 'zzz', direccion: 'arriba' })).toBe(e0);
    expect(reducir(e0, { k: 'moverConTeclado', id: 'a1', direccion: 'adentro' as never })).toBe(e0);
  });

  it('constructor.reductor.editar_un_cuadro_mezcla_solo_los_campos_de_su_tipo_con_valores_que_existen', () => {
    const e0 = conEjemplo();
    // agente
    let e = ir(e0, {
      k: 'editarNodo',
      id: 'a1',
      parche: { nombre: 'Nuevo nombre', ia: 'gemini', tarea: 'Haz algo', instrucciones: 'Sé breve', desc: 'Sirve para algo' },
    });
    expect(nodo(e, 'a1')).toMatchObject({
      nombre: 'Nuevo nombre',
      ia: 'gemini',
      tarea: 'Haz algo',
      instrucciones: 'Sé breve',
      desc: 'Sirve para algo',
      x: 312,
      y: 180,
    });
    expect(e.aviso).toBe(e0.aviso); // editar no avisa
    // un proveedor que no se ofrece, un campo de otro tipo y las posiciones se ignoran
    expect(reducir(e0, { k: 'editarNodo', id: 'a1', parche: { ia: 'otro' } as never })).toBe(e0);
    expect(reducir(e0, { k: 'editarNodo', id: 'a1', parche: { ruta: 'x', frec: 'hora', x: 5, y: 5, id: 'q', kind: 'app' } as never })).toBe(e0);
    // los mismos valores no cambian nada
    expect(reducir(e0, { k: 'editarNodo', id: 'a1', parche: { nombre: 'Atención a clientes' } })).toBe(e0);
    expect(reducir(e0, { k: 'editarNodo', id: 'a1', parche: {} })).toBe(e0);
    // nombres con tope
    e = ir(e0, { k: 'editarNodo', id: 'a1', parche: { nombre: 'x'.repeat(99) } });
    expect((nodo(e, 'a1') as NodoAgente).nombre).toHaveLength(LARGO_NOMBRE_AGENTE);
    e = ir(e0, { k: 'editarNodo', id: 'p1', parche: { nombre: 'y'.repeat(99) } });
    expect((nodo(e, 'p1') as NodoApp).nombre).toHaveLength(LARGO_NOMBRE_APP);
    // disparador
    e = ir(e0, { k: 'editarNodo', id: 't1', parche: { tipo: 'web', ruta: 'mi-ruta', frec: 'lunes', app: 'telegram' } });
    expect(nodo(e, 't1')).toMatchObject({ tipo: 'web', ruta: 'mi-ruta', frec: 'lunes', app: 'telegram' });
    expect(reducir(e0, { k: 'editarNodo', id: 't1', parche: { tipo: 'raro' } as never })).toBe(e0);
    expect(reducir(e0, { k: 'editarNodo', id: 't1', parche: { frec: 'cada-mes' } as never })).toBe(e0);
    expect(reducir(e0, { k: 'editarNodo', id: 't1', parche: { app: 'whatsapp' } as never })).toBe(e0);
    expect(reducir(e0, { k: 'editarNodo', id: 'a1', parche: null as never })).toBe(e0);
  });

  it('constructor.reductor.al_cambiar_de_tipo_el_disparador_conserva_los_campos_que_ya_no_usa', () => {
    let e = ir(conEjemplo(), { k: 'editarNodo', id: 't1', parche: { frec: 'lunes', ruta: 'otra' } });
    e = ir(e, { k: 'editarNodo', id: 't1', parche: { tipo: 'tiempo' } });
    e = ir(e, { k: 'editarNodo', id: 't1', parche: { tipo: 'web' } });
    expect(nodo(e, 't1')).toMatchObject({ tipo: 'web', frec: 'lunes', ruta: 'otra', app: 'gmail' });
  });

  it('constructor.reductor.renombrar_el_flujo_recorta_a_80_sin_quitar_espacios_y_lo_igual_no_cambia', () => {
    const e0 = conEjemplo();
    const e = ir(e0, { k: 'renombrarFlujo', nombre: 'Mi flujo ' });
    expect(e.flujo.nombreFlujo).toBe('Mi flujo '); // quien teclea debe poder escribir el espacio
    expect(e.flujo.nodes).toBe(e0.flujo.nodes);
    expect(ir(e0, { k: 'renombrarFlujo', nombre: 'z'.repeat(200) }).flujo.nombreFlujo).toHaveLength(LARGO_NOMBRE_FLUJO);
    expect(reducir(e0, { k: 'renombrarFlujo', nombre: e0.flujo.nombreFlujo })).toBe(e0);
    expect(reducir(e0, { k: 'renombrarFlujo', nombre: 5 as unknown as string })).toBe(e0);
    expect(ir(e0, { k: 'renombrarFlujo', nombre: '' }).flujo.nombreFlujo).toBe('');
  });
});

// ---------------------------------------------------------------- limpiar, ejemplo, cargar

describe('reductor · limpiar, el ejemplo y los flujos de afuera', () => {
  it('constructor.reductor.limpiar_borra_cuadros_y_conexiones_conserva_el_nombre_y_pide_el_foco_al_disparador', () => {
    const e = ir(conEjemplo(), { k: 'renombrarFlujo', nombre: 'Mi nombre' }, { k: 'abrirMenu', ancla: 'a1', tipo: 'tool' }, { k: 'limpiar' });
    expect(e.flujo).toEqual({ nodes: [], edges: [], nombreFlujo: 'Mi nombre' });
    expect(e.sel).toBeNull();
    expect(e.selEdge).toBeNull();
    expect(e.menu).toBeNull();
    expect(e.conectando).toBeNull();
    avisoEs(e, T.limpiado(), true);
    expect(e.aviso?.texto).toBe('Empezamos de cero. Elige cómo arranca tu flujo.');
    expect(foco(e)).toEqual({ k: 'primeraOpcionDisparador' });
    // con el lienzo vacío no hay nada que limpiar
    const v = vacio();
    expect(reducir(v, { k: 'limpiar' })).toBe(v);
    // el contador no se reinicia: los ids de antes no se repiten
    expect(e.siguiente).toBe(conEjemplo().siguiente);
  });

  it('constructor.reductor.cargar_el_ejemplo_pone_el_flujo_el_nombre_el_cuadro_a1_y_pide_su_foco', () => {
    const e = ir(vacio(), { k: 'cargarEjemplo' });
    expect(e.flujo.nodes).toEqual(ejemplo().nodes);
    expect(e.flujo.edges).toEqual(ejemplo().edges);
    expect(e.flujo.nombreFlujo).toBe(NOMBRE_EJEMPLO);
    expect(e.flujo.nombreFlujo).toBe('Atención a clientes');
    expect(e.sel).toBe('a1');
    expect(e.selEdge).toBeNull();
    avisoEs(e, T.ejemploCargado(), true);
    expect(e.aviso?.texto).toBe('Cargamos el ejemplo.');
    expect(foco(e)).toEqual({ k: 'nodo', id: 'a1' });
    expect(e.siguiente).toBe(ID_INICIAL);
    // dos veces: cada una arma objetos nuevos (no comparten nada)
    const dos = ir(e, { k: 'cargarEjemplo' });
    expect(dos.flujo.nodes).not.toBe(e.flujo.nodes);
    expect(invariantesDelEstado(dos)).toEqual([]);
  });

  it('constructor.reductor.cargar_un_flujo_valido_lo_copia_elige_a1_y_el_contador_pasa_al_mayor_id_mas_uno', () => {
    const muestra = muestras()[1];
    if (!muestra) throw new Error('muestra');
    const original: Flujo = { nodes: muestra.nodes, edges: muestra.edges, nombreFlujo: muestra.nombre };
    const e = ir(vacio(), { k: 'cargarFlujo', flujo: original });
    expect(e.flujo).toEqual(original);
    // no comparte nada con lo que se le dio (el Asistente puede seguir usando su resultado)
    expect(e.flujo.nodes).not.toBe(original.nodes);
    expect(e.flujo.edges).not.toBe(original.edges);
    for (const [i, n] of e.flujo.nodes.entries()) expect(n).not.toBe(original.nodes[i]);
    expect(e.sel).toBe('a1');
    avisoEs(e, T.flujoAbierto(), true);
    expect(e.aviso?.texto).toBe('Abrimos tu flujo en el constructor.');
    expect(foco(e)).toEqual({ k: 'nodo', id: 'a1' });
    expect(e.siguiente).toBe(ID_INICIAL);
    // con ids altos el contador sube por encima de todos
    const alto: Flujo = {
      nodes: [{ id: 't1', kind: 'trigger', x: 8, y: 180, tipo: 'chat', frec: 'dia', ruta: 'r', app: 'gmail' }, agenteSuelto('a57', 312, 180)],
      edges: [{ id: 'e61', de: 't1', a: 'a57', tipo: 'seq' }],
      nombreFlujo: 'Alto',
    };
    const f = ir(vacio(), { k: 'cargarFlujo', flujo: alto });
    expect(f.siguiente).toBe(62);
    expect(f.sel).toBe('a57'); // no hay a1: el primer agente
    // y el contador nunca baja al cargar un flujo con ids bajos
    const g = ir(f, { k: 'cargarFlujo', flujo: original });
    expect(g.siguiente).toBe(62);
  });

  it('constructor.reductor.cargar_un_flujo_que_rompe_un_tope_o_un_invariante_se_rechaza_con_su_aviso_y_no_toca_nada', () => {
    const e0 = conEjemplo();
    const trigger = (id: string): Nodo => ({ id, kind: 'trigger', x: 8, y: 180, tipo: 'chat', frec: 'dia', ruta: 'r', app: 'gmail' });
    const muchos = <V extends Nodo>(n: number, f: (i: number) => V): V[] => Array.from({ length: n }, (_, i) => f(i));
    const casos: [nombre: string, flujo: unknown, aviso: T.TextoAviso][] = [
      [
        'dos disparadores',
        { nodes: [trigger('t1'), trigger('t2')], edges: [], nombreFlujo: 'x' },
        T.flujoRechazado(['varios-disparadores']),
      ],
      [
        'cinco agentes',
        { nodes: muchos(TOPE_AGENTES + 1, i => agenteSuelto(`a${i + 1}`, 8 + i * 300, 180)), edges: [], nombreFlujo: 'x' },
        T.flujoRechazado(['tope-agentes']),
      ],
      [
        'nueve apps',
        { nodes: muchos(TOPE_APPS + 1, i => appSuelta(`p${i + 1}`, 8 + i * 300, 180)), edges: [], nombreFlujo: 'x' },
        T.flujoRechazado(['tope-apps']),
      ],
      [
        'una conexión huérfana',
        { nodes: [trigger('t1')], edges: [{ id: 'e1', de: 't1', a: 'zzz', tipo: 'seq' }], nombreFlujo: 'x' },
        T.flujoRechazado(['arista-huerfana']),
      ],
      [
        'un círculo',
        {
          nodes: [agenteSuelto('a1', 8, 180), agenteSuelto('a2', 312, 180)],
          edges: [
            { id: 'e1', de: 'a1', a: 'a2', tipo: 'seq' },
            { id: 'e2', de: 'a2', a: 'a1', tipo: 'seq' },
          ],
          nombreFlujo: 'x',
        },
        T.flujoRechazado(['ciclo-de-pasos']),
      ],
      ['nodes que no es una lista', { nodes: 'no', edges: [], nombreFlujo: 'x' }, T.flujoRechazado(['nodos-no-es-lista'])],
      ['algo que no es un flujo', null, T.flujoRechazado(['nodos-no-es-lista'])],
      ['un cuadro fuera del lienzo', { nodes: [{ ...agenteSuelto('a1', 5000, 0) }], edges: [], nombreFlujo: 'x' }, T.flujoRechazado(['caja-fuera-del-lienzo'])],
    ];
    for (const [nombre, flujo, aviso] of casos) {
      const e = ir(e0, { k: 'cargarFlujo', flujo: flujo as Flujo });
      expect(e.flujo, nombre).toBe(e0.flujo);
      expect(e.historial, nombre).toBe(e0.historial);
      expect(e.siguiente, nombre).toBe(e0.siguiente);
      expect(e.sel, nombre).toBe(e0.sel);
      avisoEs(e, aviso);
      expect(e.aviso?.tipo, nombre).toBe('mal');
    }
    expect(T.flujoRechazado(['varios-disparadores']).texto).toBe(
      'No pudimos abrir ese flujo: tiene más de un disparador y por ahora el Constructor admite uno.',
    );
    expect(T.flujoRechazado(['tope-agentes']).texto).toBe(
      'No pudimos abrir ese flujo: tiene más de 4 agentes de IA y por ahora el Constructor admite hasta 4.',
    );
    expect(T.flujoRechazado(['tope-apps']).texto).toBe(
      'No pudimos abrir ese flujo: tiene más de 8 apps y por ahora el Constructor admite hasta 8.',
    );
    expect(T.flujoRechazado(['ciclo-de-pasos']).texto).toBe('No pudimos abrir ese flujo: no se puede dibujar en el Constructor.');
  });

  it('constructor.reductor.un_flujo_de_afuera_con_nombre_largo_o_sin_nombre_se_normaliza', () => {
    const f = ejemplo();
    const largo = ir(vacio(), { k: 'cargarFlujo', flujo: { ...f, nombreFlujo: 'n'.repeat(200) } });
    expect(largo.flujo.nombreFlujo).toHaveLength(LARGO_NOMBRE_FLUJO);
    const sin = ir(vacio(), { k: 'cargarFlujo', flujo: { nodes: f.nodes, edges: f.edges } as Flujo });
    expect(sin.flujo.nombreFlujo).toBe(NOMBRE_FLUJO_INICIAL);
  });
});

// ---------------------------------------------------------------- estado inicial y contador

describe('reductor · estado inicial y contador de ids', () => {
  it('constructor.reductor.estado_inicial_con_un_flujo_lo_copia_y_uno_invalido_arranca_vacio', () => {
    const f = ejemplo();
    const e = estadoInicial(f);
    expect(e.flujo).toEqual(f);
    expect(e.flujo.nodes).not.toBe(f.nodes);
    expect(e.siguiente).toBe(20);
    expect(e.sel).toBeNull();
    expect(e.historial).toEqual([]);
    // un borrador corrupto se descarta
    const malo = { ...f, nodes: [...f.nodes, ...Array.from({ length: 5 }, (_, i) => agenteSuelto(`z${i}`, 0, 0))] };
    expect(estadoInicial(malo).flujo).toEqual({ nodes: [], edges: [], nombreFlujo: NOMBRE_FLUJO_INICIAL });
    expect(estadoInicial(null as unknown as Flujo).flujo.nodes).toEqual([]);
    // el contador que se guardó con el borrador se respeta si es mayor
    expect(estadoInicial(f, 35).siguiente).toBe(35);
    expect(estadoInicial(f, 5).siguiente).toBe(20);
    expect(estadoInicial(f, Number.NaN).siguiente).toBe(20);
    expect(estadoInicial(f, -3).siguiente).toBe(20);
  });

  it('constructor.reductor.el_contador_para_un_flujo_es_max_20_y_el_mayor_sufijo_mas_uno', () => {
    const f = (...ids: string[]): Flujo => ({
      nodes: ids.filter(i => /^[tap]/.test(i)).map(i => agenteSuelto(i, 0, 0)),
      edges: ids.filter(i => i.startsWith('e')).map(i => ({ id: i, de: 'a', a: 'b', tipo: 'seq' as const })),
      nombreFlujo: 'x',
    });
    const tabla: [Flujo, number][] = [
      [f(), 20],
      [f('t1', 'a1', 'a2', 'p1', 'p2', 'e1', 'e4'), 20],
      [f('a19'), 20],
      [f('a20'), 21],
      [f('a57', 'e61'), 62],
      [f('e100'), 101],
      [f('sinnumero'), 20],
      [f(`a${'9'.repeat(30)}`), 20], // un sufijo absurdo no cuenta
    ];
    for (const [flujo, esperado] of tabla) expect(contadorParaFlujo(flujo)).toBe(esperado);
  });

  it('constructor.reductor.el_contador_nunca_baja_y_los_ids_no_se_repiten_ni_al_quitar_ni_al_deshacer', () => {
    let e = conEjemplo();
    const vistos = new Set(e.flujo.nodes.map(n => n.id).concat(e.flujo.edges.map(x => x.id)));
    let previo = e.siguiente;
    const pasos: A[] = [
      { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' },
      { k: 'crearDesdeMenu', que: 'agente' },
      { k: 'abrirMenu', ancla: 'a2', tipo: 'tool' },
      { k: 'crearDesdeMenu', que: 'app', nombreApp: 'Notion' },
      { k: 'quitarNodo', id: 'a1' },
      { k: 'deshacer' },
      { k: 'deshacer' },
      { k: 'cambiarTipoEnlace', id: 'e2', tipo: 'tool' },
      { k: 'abrirMenu', ancla: 'a1', tipo: 'seq', insertarEn: 'e2' },
      { k: 'limpiar' },
      { k: 'deshacer' },
      { k: 'cargarEjemplo' },
      { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' },
      { k: 'crearDesdeMenu', que: 'agente' },
    ];
    for (const accion of pasos) {
      e = ir(e, accion);
      expect(e.siguiente).toBeGreaterThanOrEqual(previo);
      previo = e.siguiente;
      expect(invariantesDelEstado(e)).toEqual([]);
    }
    // todo lo que se creó tiene un número que nadie usó antes en este recorrido (salvo los del ejemplo, que se recargan)
    const creados = [...e.flujo.nodes.map(n => n.id), ...e.flujo.edges.map(x => x.id)].filter(i => Number(/(\d+)$/.exec(i)?.[1]) > 20);
    expect(new Set(creados).size).toBe(creados.length);
    expect(vistos.size).toBeGreaterThan(0);
  });

  it('constructor.reductor.nodo_y_conexion_creados_juntos_comparten_el_numero_y_poner_en_medio_gasta_dos', () => {
    const a = ir(conEjemplo(), { k: 'abrirMenu', ancla: 'a2', tipo: 'tool' }, { k: 'crearDesdeMenu', que: 'app', nombreApp: 'Notion' });
    expect([ultimoNodo(a).id, ultimaArista(a).id, a.siguiente]).toEqual(['p21', 'e21', 21]);
    const b = ir(a, { k: 'abrirMenu', ancla: 'a1', tipo: 'seq', insertarEn: 'e2' }, { k: 'crearDesdeMenu', que: 'agente' });
    expect(ultimoNodo(b).id).toBe('a22');
    expect(b.flujo.edges.slice(-2).map(x => x.id)).toEqual(['e22', 'e23']);
    expect(b.siguiente).toBe(23);
    // quitar con unión gasta un número por conexión nueva
    const c = ir(b, { k: 'quitarNodo', id: 'a22' });
    expect(c.flujo.edges.slice(-1)[0]).toMatchObject({ id: 'e24', de: 'a1', a: 'a2', tipo: 'seq' });
    expect(c.siguiente).toBe(24);
  });
});

// ---------------------------------------------------------------- peticiones: el foco y «hazme visible»

describe('reductor · peticiones de foco', () => {
  it('constructor.reductor.cada_accion_pide_el_foco_que_dice_la_tabla_y_nunca_queda_en_body', () => {
    type Caso = [nombre: string, estado: E, accion: A, esperado: Foco | null];
    const sinDisparador = ir(conEjemplo(), { k: 'quitarNodo', id: 't1' });
    const casos: Caso[] = [
      ['abrirNodo con ratón', conEjemplo(), { k: 'abrirNodo', id: 'a2' }, null],
      ['abrirNodo con teclado', conEjemplo(), { k: 'abrirNodo', id: 'a2', teclado: true }, { k: 'ajustes' }],
      ['abrirEnlace', conEjemplo(), { k: 'abrirEnlace', id: 'e2' }, { k: 'opcionUnSentido' }],
      ['elegirDisparador', vacio(), { k: 'elegirDisparador', tipo: 'chat' }, { k: 'nodo', id: 't21' }],
      ['abrirMenu', conEjemplo(), { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' }, { k: 'primeraOpcionMenu' }],
      [
        'pasoMenu',
        ir(conEjemplo(), { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' }),
        { k: 'pasoMenu', paso: 'app' },
        { k: 'primeraOpcionMenu' },
      ],
      [
        'cerrarMenu',
        ir(conEjemplo(), { k: 'abrirMenu', ancla: 'a1', tipo: 'tool' }),
        { k: 'cerrarMenu' },
        { k: 'mas', clave: 'tool-a1' },
      ],
      [
        'crearDesdeMenu',
        ir(conEjemplo(), { k: 'abrirMenu', ancla: 'a2', tipo: 'seq' }),
        { k: 'crearDesdeMenu', que: 'agente' },
        { k: 'nodo', id: 'a21' },
      ],
      [
        'crearDesdeMenu que falla',
        ir(conEjemplo(), { k: 'abrirMenu', ancla: 'a2', tipo: 'seq' }),
        { k: 'crearDesdeMenu', que: 'app', nombreApp: '' },
        null,
      ],
      ['iniciarConexion', conEjemplo(), { k: 'iniciarConexion', ancla: 'a2', rol: 'origen', tipo: 'seq' }, { k: 'nodo', id: 'a2' }],
      [
        'cancelarConexion',
        ir(conEjemplo(), { k: 'iniciarConexion', ancla: 'a2', rol: 'origen', tipo: 'seq' }),
        { k: 'cancelarConexion' },
        { k: 'nodo', id: 'a2' },
      ],
      ['quitarEnlace', conEjemplo(), { k: 'quitarEnlace', id: 'e2' }, { k: 'nodo', id: 'a1' }],
      ['quitarNodo con cuadro antes', conEjemplo(), { k: 'quitarNodo', id: 'a2' }, { k: 'nodo', id: 'a1' }],
      ['quitarNodo sin cuadro antes', conEjemplo(), { k: 'quitarNodo', id: 't1' }, { k: 'primerNodo' }],
      ['quitarNodo de lo ultimo', conFlujo({ nodes: [ejemplo().nodes[0] as Nodo], edges: [], nombreFlujo: 'x' }), { k: 'quitarNodo', id: 't1' }, { k: 'primeraOpcionDisparador' }],
      ['limpiar', conEjemplo(), { k: 'limpiar' }, { k: 'primeraOpcionDisparador' }],
      ['cargarEjemplo', vacio(), { k: 'cargarEjemplo' }, { k: 'nodo', id: 'a1' }],
      ['deshacer', sinDisparador, { k: 'deshacer' }, { k: 'nodo', id: 'a1' }],
      ['volverDeAjustes al cuadro', conEjemplo(), { k: 'volverDeAjustes' }, { k: 'nodo', id: 'a1' }],
    ];
    for (const [nombre, estado, accion, esperado] of casos) {
      const antes = estado.foco;
      const e = ir(estado, accion);
      if (esperado === null) expect(e.foco, nombre).toBe(antes);
      else expect(foco(e), nombre).toEqual(esperado);
    }
  });

  it('constructor.reductor.pedir_el_mismo_foco_dos_veces_sube_n_y_limpiar_peticiones_respeta_las_mas_nuevas', () => {
    let e = ir(conEjemplo(), { k: 'abrirEnlace', id: 'e2' });
    const n1 = e.foco?.n ?? 0;
    e = ir(e, { k: 'abrirEnlace', id: 'e2' });
    expect(e.foco?.n).toBeGreaterThan(n1);
    expect(e.foco?.objetivo).toEqual({ k: 'opcionUnSentido' });
    // cuadro nuevo: foco y «hazme visible»
    e = ir(e, { k: 'abrirMenu', ancla: 'a2', tipo: 'seq' }, { k: 'crearDesdeMenu', que: 'agente' });
    expect(e.ver).toEqual({ id: 'a21', n: expect.any(Number) as number });
    // consumirlas
    const sin = ir(e, { k: 'limpiarPeticiones' });
    expect(sin.foco).toBeNull();
    expect(sin.ver).toBeNull();
    expect(reducir(sin, { k: 'limpiarPeticiones' })).toBe(sin);
    // con `hasta` no se pisa una petición más nueva que la que se cumplió
    const vieja = e.ver?.n ?? 0;
    const nueva = ir(e, { k: 'abrirEnlace', id: 'e1' });
    expect(nueva.foco?.n).toBeGreaterThan(vieja);
    const parcial = ir(nueva, { k: 'limpiarPeticiones', hasta: vieja });
    expect(parcial.foco).toBe(nueva.foco); // el foco más nuevo se queda
    expect(parcial.ver).toBeNull(); // el «hazme visible» ya cumplido se va
    const todo = ir(nueva, { k: 'limpiarPeticiones', hasta: nueva.foco?.n ?? 0 });
    expect(todo.foco).toBeNull();
  });

  it('constructor.reductor.cada_aviso_lleva_un_id_nuevo_aunque_el_texto_sea_el_mismo', () => {
    let e = conEjemplo();
    e = ir(e, { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' }, { k: 'cerrarMenu' });
    const a = e.aviso;
    e = ir(e, { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' }, { k: 'cerrarMenu' });
    expect(e.aviso?.texto).toBe(a?.texto);
    expect(e.aviso?.id).toBeGreaterThan(a?.id ?? 0);
  });
});

// ---------------------------------------------------------------- barreras: ids que no existen y nada se modifica

describe('reductor · barreras', () => {
  it('constructor.reductor.un_id_que_no_existe_deja_el_estado_exactamente_igual', () => {
    const e = ir(conEjemplo(), { k: 'iniciarConexion', ancla: 'a2', rol: 'origen', tipo: 'seq' });
    const m = ir(conEjemplo(), { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' });
    const acciones: A[] = [
      { k: 'abrirNodo', id: 'zzz' },
      { k: 'abrirEnlace', id: 'zzz' },
      { k: 'abrirMenu', ancla: 'zzz', tipo: 'seq' },
      { k: 'iniciarConexion', ancla: 'zzz', rol: 'origen', tipo: 'seq' },
      { k: 'intentarConexion', id: 'zzz' },
      { k: 'cambiarTipoEnlace', id: 'zzz', tipo: 'tool' },
      { k: 'quitarEnlace', id: 'zzz' },
      { k: 'quitarNodo', id: 'zzz' },
      { k: 'moverNodo', id: 'zzz', x: 0, y: 0 },
      { k: 'moverConTeclado', id: 'zzz', direccion: 'arriba' },
      { k: 'editarNodo', id: 'zzz', parche: { nombre: 'x' } },
    ];
    for (const a of acciones) {
      // `intentarConexion` solo existe con el modo conectando activo
      const base = a.k === 'intentarConexion' ? e : conEjemplo();
      expect(reducir(base, a), a.k).toBe(base);
    }
    // acciones que no vienen al caso: sin menú, sin conexión en curso, sin pedidos
    const v = conEjemplo();
    for (const a of [
      { k: 'cerrarMenu' },
      { k: 'pasoMenu', paso: 'app' },
      { k: 'crearDesdeMenu', que: 'app', nombreApp: 'x' },
      { k: 'cancelarConexion' },
      { k: 'cerrarTodo' },
      { k: 'limpiarPeticiones' },
    ] satisfies A[]) {
      expect(reducir(v, a), a.k).toBe(v);
    }
    // una acción que no existe (de un componente mal escrito) tampoco rompe nada
    expect(reducir(v, { k: 'inventada' } as unknown as A)).toBe(v);
    expect(m.menu).not.toBeNull();
  });

  it('constructor.reductor.un_menu_cuyo_cuadro_ya_no_existe_se_cierra_y_nada_apunta_a_un_fantasma', () => {
    // estado armado a mano con el menú, la conexión en curso y la selección apuntando a cosas que no están
    const base = conEjemplo();
    const roto: E = {
      ...base,
      flujo: { ...base.flujo, nodes: base.flujo.nodes.filter(n => n.id !== 'a2'), edges: base.flujo.edges.filter(x => x.de !== 'a2' && x.a !== 'a2') },
      sel: 'a2',
      selEdge: 'e2',
      menu: { ancla: 'a2', tipo: 'seq', paso: 'inicio', insertarEn: null },
      conectando: { ancla: 'a2', rol: 'origen', tipo: 'seq' },
    };
    // cualquier acción que sí cambie algo deja el estado limpio
    const e = reducir(roto, { k: 'renombrarFlujo', nombre: 'otro' });
    expect(e.sel).toBeNull();
    expect(e.selEdge).toBeNull();
    expect(e.menu).toBeNull();
    expect(e.conectando).toBeNull();
    // y si hay a la vez una flecha y un cuadro elegidos, o un menú y la conexión, se queda con uno de cada par
    const doble = reducir({ ...base, sel: 'a1', selEdge: 'e2', menu: { ancla: 'a1', tipo: 'seq', paso: 'inicio', insertarEn: null }, conectando: { ancla: 'a1', rol: 'origen', tipo: 'seq' } }, { k: 'renombrarFlujo', nombre: 'otro' });
    expect([doble.sel !== null && doble.selEdge !== null, doble.menu !== null && doble.conectando !== null]).toEqual([false, false]);
  });

  it('constructor.reductor.ninguna_accion_modifica_el_estado_ni_las_listas_que_recibe', () => {
    // `ir` ya congela cada estado: aquí se recorre una larga secuencia con todas las acciones
    let e = vacio();
    const pasos: A[] = [
      { k: 'elegirDisparador', tipo: 'app' },
      { k: 'abrirMenu', ancla: 't21', tipo: 'seq' },
      { k: 'crearDesdeMenu', que: 'agente' },
      { k: 'abrirMenu', ancla: 'a22', tipo: 'tool' },
      { k: 'crearDesdeMenu', que: 'app', nombreApp: 'Gmail' },
      { k: 'abrirMenu', ancla: 'a22', tipo: 'seq' },
      { k: 'crearDesdeMenu', que: 'agente' },
      { k: 'cambiarTipoEnlace', id: 'e24', tipo: 'tool' },
      { k: 'abrirEnlace', id: 'e22' },
      { k: 'moverNodo', id: 'a22', x: 400, y: 300 },
      { k: 'moverConTeclado', id: 'a22', direccion: 'derecha', grande: true },
      { k: 'editarNodo', id: 'a22', parche: { tarea: 'Hazlo' } },
      { k: 'renombrarFlujo', nombre: 'Prueba' },
      { k: 'iniciarConexion', ancla: 'a22', rol: 'origen', tipo: 'seq' },
      { k: 'cancelarConexion' },
      { k: 'quitarEnlace', id: 'e22' },
      { k: 'quitarNodo', id: 'a22' },
      { k: 'deshacer' },
      { k: 'limpiar' },
      { k: 'cargarEjemplo' },
      { k: 'cargarFlujo', flujo: ejemplo() },
      { k: 'volverDeAjustes' },
      { k: 'limpiarPeticiones' },
    ];
    for (const a of pasos) e = ir(e, a);
    expect(invariantesDelEstado(e)).toEqual([]);
  });
});

// ---------------------------------------------------------------- los textos

describe('reductor · textos de aviso', () => {
  it('constructor.reductor.los_textos_de_aviso_son_los_del_apendice_a_con_su_tono', () => {
    const tabla: [T.TextoAviso, string, string][] = [
      [T.abrirEnlace('A', 'B'), 'Elegiste la conexión de «A» a «B». En el panel de Ajustes puedes cambiarla.', 'info'],
      [T.disparadorElegido('Disparador Chat', null), 'Listo: el flujo arranca con «Disparador Chat». Ahora toca el + para agregar lo que sigue.', 'ok'],
      [T.disparadorElegido('Disparador Chat', 'X'), 'Listo: el flujo arranca con «Disparador Chat» y lo conectamos con «X».', 'ok'],
      [T.menuEnMedio(), 'Elige qué poner en medio de la conexión.', 'info'],
      [T.menuHerramienta('A'), 'Elige la app que le das a «A» como herramienta.', 'info'],
      [T.menuDespues('A'), 'Elige qué va después de «A»: una app o un agente.', 'info'],
      [T.menuCerrado(), 'Cerramos el menú.', 'info'],
      [T.topeAgentes(), 'Por ahora son hasta 4 agentes por flujo.', 'mal'],
      [T.topeApps(), 'Por ahora son hasta 8 apps por flujo.', 'mal'],
      [
        T.soloAppsEnElMenu(),
        'Por la patita solo van apps. Para que dos IA conversen, ponlas una después de otra con el + de la derecha y toca su flecha.',
        'mal',
      ],
      [T.escribeNombreApp(), 'Escribe el nombre de la app.', 'mal'],
      [T.conexionYaNoExiste(), 'Esa conexión ya no existe.', 'mal'],
      [T.agregado('X', true, 'medio'), 'Agregamos el agente «X» en medio. Sus ajustes están en el panel de Ajustes.', 'ok'],
      [T.agregado('X', false, { herramientaDe: 'A' }), 'Agregamos «X» como herramienta de «A». Sus ajustes están en el panel de Ajustes.', 'ok'],
      [T.textoConectar('seq', 'origen', 'A'), 'Toca el cuadro que irá DESPUÉS de «A».', 'info'],
      [T.textoConectar('seq', 'destino', 'A'), 'Toca el cuadro que irá ANTES de «A».', 'info'],
      [T.textoConectar('tool', 'origen', 'A'), 'Toca la app que «A» podrá usar como herramienta.', 'info'],
      [T.textoConectar('tool', 'destino', 'A'), 'Toca el agente que podrá usar «A» como herramienta.', 'info'],
      [T.conexionCancelada(), 'Cancelamos la conexión.', 'info'],
      [T.elegirOtro('Motivo.'), 'Motivo. Elige otro cuadro, o cancela.', 'mal'],
      [
        T.soloAppsAlConectar(),
        'Por la patita solo van apps. Para que dos IA conversen, ponlas una después de otra y toca su flecha. Elige otro cuadro, o cancela.',
        'mal',
      ],
      [T.conectados('A', 'B'), 'Conectamos «A» con «B».', 'ok'],
      [T.noSePuedeCambiar('Motivo.'), 'No se puede cambiar: Motivo.', 'mal'],
      [
        T.ahoraConversan('A', 'B'),
        '«A» y «B» ahora conversan: ida y vuelta. Revisa en sus ajustes para qué le sirve «B».',
        'ok',
      ],
      [T.ahoraEsHerramienta('A', 'B'), '«B» ahora es herramienta de «A»: ida y vuelta.', 'ok'],
      [T.ahoraVaDespues('A', 'B'), '«B» ahora va después de «A»: un solo sentido.', 'ok'],
      [T.conexionQuitada(), 'Quitamos la conexión.', 'info'],
      [T.cerramosTodo(), 'Cerramos lo que estaba abierto.', 'info'],
      [T.deshecho('quitar'), 'Listo: volvimos a poner lo que quitaste.', 'ok'],
      [T.limpiado(), 'Empezamos de cero. Elige cómo arranca tu flujo.', 'info'],
      [T.ejemploCargado(), 'Cargamos el ejemplo.', 'ok'],
      [T.flujoAbierto(), 'Abrimos tu flujo en el constructor.', 'ok'],
      [T.descargaNoPosible('Falta un disparador: dile al flujo cuándo arrancar.'), 'Todavía no se puede descargar. Falta un disparador: dile al flujo cuándo arrancar.', 'mal'],
      [
        T.descargado('mi-flujo.json'),
        'Listo: mi-flujo.json. En n8n, abre el menú «⋯» de arriba a la derecha y elige «Import from File».',
        'ok',
      ],
      [T.noSeDescargo(), 'No se descargó. Cuando quieras, vuelve a pulsar «Descargar .json».', 'info'],
      [T.jsonNoDisponible('Falta un disparador.'), 'Todavía no hay JSON: Falta un disparador.', 'mal'],
      [T.jsonCopiado(), 'Copiamos el JSON.', 'ok'],
      [T.noSeCopio(), 'No pudimos copiar solos. Selecciona el texto y usa Ctrl+C.', 'mal'],
    ];
    for (const [t, texto, tipo] of tabla) {
      expect(t.texto).toBe(texto);
      expect(t.tipo).toBe(tipo);
    }
    // nada de voseo, de «centavos» ni de España en lo que se le dice a la persona
    for (const [t] of tabla) expect(t.texto).not.toMatch(/\b(vos|elegí|podés|ordenador|móvil|fichero|centavos)\b/i);
  });
});

// ---------------------------------------------------------------- recorridos al azar

/** Un generador con semilla (mulberry32): mismas semillas, mismas corridas. */
function mulberry32(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lo que la persona hace en un paso: a veces es una sola acción y a veces un gesto de varias (abrir el menú y elegir). */
function pasoAlAzar(rng: () => number, e: E): A[] {
  const entero = (n: number) => Math.floor(rng() * n);
  const de = <V>(l: readonly V[]): V => l[entero(l.length)] as V;
  const ids = e.flujo.nodes.map(n => n.id);
  const eids = e.flujo.edges.map(x => x.id);
  const id = () => (ids.length > 0 && rng() > 0.04 ? de(ids) : 'zzz');
  const eid = () => (eids.length > 0 && rng() > 0.04 ? de(eids) : 'zzz');
  const tipo = (): TipoArista => (rng() < 0.5 ? 'seq' : 'tool');
  const malo: Flujo = { nodes: Array.from({ length: 5 }, (_, i) => agenteSuelto(`a${i + 1}`, i * 300, 0)), edges: [], nombreFlujo: 'x' };
  const r = rng() * 100;
  const hayDisparador = e.flujo.nodes.some(n => n.kind === 'trigger');
  if (r < (hayDisparador ? 2 : 25)) return [{ k: 'elegirDisparador', tipo: de(['tiempo', 'chat', 'web', 'app'] as const) }];
  if (r < 40) {
    // agregar algo: abrir el «+» (a la derecha, la patita o en medio) y elegir
    const que = rng() < 0.5 ? ({ k: 'crearDesdeMenu', que: 'agente' } as const) : ({ k: 'crearDesdeMenu', que: 'app', nombreApp: rng() < 0.1 ? '' : 'Notion' } as const);
    const cierra: A[] = e.menu ? [{ k: 'cerrarMenu' }] : []; // tocar el «+» con el menú abierto lo cierra
    const abrir: A =
      rng() < 0.3 && eids.length > 0
        ? { k: 'abrirMenu', ancla: id(), tipo: 'seq', insertarEn: eid() }
        : { k: 'abrirMenu', ancla: id(), tipo: tipo() };
    return [...cierra, abrir, ...(rng() < 0.5 ? [{ k: 'pasoMenu', paso: 'app' } as const] : []), que];
  }
  if (r < 52) {
    const cierra: A[] = e.conectando ? [{ k: 'cancelarConexion' }] : [];
    return [...cierra, { k: 'iniciarConexion', ancla: id(), rol: rng() < 0.8 ? 'origen' : 'destino', tipo: tipo() }, { k: 'intentarConexion', id: id() }];
  }
  if (r < 60) return [{ k: 'cambiarTipoEnlace', id: eid(), tipo: tipo() }];
  if (r < 63) return [{ k: 'quitarEnlace', id: eid() }];
  if (r < 68) return [{ k: 'quitarNodo', id: id() }];
  if (r < 75) return [{ k: 'moverNodo', id: id(), x: rng() * 3000 - 300, y: rng() * 3000 - 300 }];
  if (r < 79) return [{ k: 'moverConTeclado', id: id(), direccion: de(['izquierda', 'derecha', 'arriba', 'abajo'] as const), grande: rng() < 0.5 }];
  if (r < 83) {
    const parche = de<Record<string, unknown>>([{ nombre: 'Hola' }, { tarea: 'x' }, { tipo: 'web' }, { ia: 'gemini' }, { desc: 'd' }]);
    return [{ k: 'editarNodo', id: id(), parche: parche as never }];
  }
  if (r < 84) return [{ k: 'renombrarFlujo', nombre: rng() < 0.5 ? 'Un nombre' : 'Otro nombre más largo' }];
  if (r < 88) return [{ k: 'abrirNodo', id: id(), teclado: rng() < 0.3 }];
  if (r < 91) return [{ k: 'abrirEnlace', id: eid() }];
  if (r < 96) return [rng() < 0.6 ? { k: 'deshacer' } : { k: 'deshacer', avisoId: e.aviso?.id ?? 0 }];
  if (r < 97) return [{ k: 'limpiar' }];
  if (r < 98) return [rng() < 0.5 ? { k: 'cargarEjemplo' } : { k: 'cargarFlujo', flujo: rng() < 0.5 ? malo : (de(muestras()) as unknown as Flujo) }];
  return [
    de<A>([
      { k: 'cerrarMenu' },
      { k: 'pasoMenu', paso: 'inicio' },
      { k: 'cancelarConexion' },
      { k: 'cerrarTodo' },
      { k: 'volverDeAjustes' },
      { k: 'limpiarPeticiones', hasta: e.eventos },
    ]),
  ];
}

describe('reductor · recorridos al azar', () => {
  it('constructor.reductor.recorridos_al_azar_jamas_rompen_un_invariante_ni_el_contador_ni_la_pila', () => {
    const SECUENCIAS = 80;
    const PASOS = 60;
    const vistos = new Set<string>();
    const exitos = { crear: 0, insertar: 0, deshacer: 0, tipo: 0, quitar: 0, conectar: 0, rechazos: 0 };
    let maxCuadros = 0;
    let maxPila = 0;
    for (let s = 0; s < SECUENCIAS; s += 1) {
      const rng = mulberry32(1000 + s);
      let e = rng() < 0.5 ? conEjemplo() : vacio();
      const traza: string[] = [];
      for (let p = 0; p < PASOS; p += 1) {
        for (const accion of pasoAlAzar(rng, e)) {
          traza.push(JSON.stringify(accion));
          const antes = e;
          const despues = congelar(reducir(e, accion));
          const fallas = invariantesDelEstado(despues);
          if (fallas.length > 0) throw new Error(`secuencia ${s}, paso ${p}: ${fallas.join(' | ')}\n${traza.slice(-12).join('\n')}`);
          expect(despues.siguiente).toBeGreaterThanOrEqual(antes.siguiente);
          expect(despues.eventos).toBeGreaterThanOrEqual(antes.eventos);
          expect(despues.scrollAjustes).toBeGreaterThanOrEqual(antes.scrollAjustes);
          // lo que no se guarda tira la pila: nunca queda una instantánea más vieja que un cambio sin guardar
          if (accion.k === 'moverNodo' || accion.k === 'editarNodo' || accion.k === 'renombrarFlujo' || accion.k === 'moverConTeclado') {
            if (despues.flujo !== antes.flujo) expect(despues.historial).toEqual([]);
          }
          // lo que sí se guarda crece de uno en uno (hasta 20) y Deshacer lo gasta de uno en uno
          if (despues.historial.length > antes.historial.length) {
            expect(despues.historial.length).toBe(Math.min(antes.historial.length + 1, MAX_HISTORIAL));
          }
          if (accion.k === 'crearDesdeMenu' && despues.flujo.nodes.length > antes.flujo.nodes.length) {
            exitos.crear += 1;
            if (antes.menu?.insertarEn) exitos.insertar += 1;
          }
          if (accion.k === 'deshacer' && despues.historial.length < antes.historial.length) exitos.deshacer += 1;
          if (accion.k === 'cambiarTipoEnlace' && despues.flujo !== antes.flujo) exitos.tipo += 1;
          if (accion.k === 'quitarNodo' && despues.flujo.nodes.length < antes.flujo.nodes.length) exitos.quitar += 1;
          if (accion.k === 'intentarConexion' && despues.flujo.edges.length > antes.flujo.edges.length) exitos.conectar += 1;
          if (despues.aviso !== antes.aviso && despues.aviso?.tipo === 'mal') exitos.rechazos += 1;
          maxCuadros = Math.max(maxCuadros, despues.flujo.nodes.length);
          maxPila = Math.max(maxPila, despues.historial.length);
          vistos.add(accion.k);
          e = despues;
        }
      }
    }
    // el recorrido tocó todas las acciones y llegó a flujos grandes, con agregar, insertar, conectar, quitar y deshacer de verdad
    expect(vistos.size).toBe(24);
    expect(maxCuadros).toBeGreaterThanOrEqual(10);
    expect(maxPila).toBeGreaterThanOrEqual(8);
    expect(exitos.crear).toBeGreaterThanOrEqual(150);
    expect(exitos.insertar).toBeGreaterThanOrEqual(10);
    expect(exitos.deshacer).toBeGreaterThanOrEqual(100);
    expect(exitos.tipo).toBeGreaterThanOrEqual(50);
    expect(exitos.quitar).toBeGreaterThanOrEqual(50);
    expect(exitos.conectar).toBeGreaterThanOrEqual(30);
    expect(exitos.rechazos).toBeGreaterThanOrEqual(100);
  });
});
