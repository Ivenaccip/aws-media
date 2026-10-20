// Los OJOS de las pruebas de propiedades del reductor: qué se comprueba tras CADA acción de una secuencia
// al azar. Portan, sobre el reductor puro y los selectores, lo que el fuzz del mockup comprobaba sobre
// `renderVals` (revision/fuzz/fuzz.cjs: `invGrafo`, `chequear`, `transicion`, `chequearFlujo`,
// `diferencial`) y suman lo que el mockup no tenía: Deshacer contra una instantánea, ids que no existen,
// y que los selectores y el reductor digan lo mismo.
//
// Cada comprobación devuelve una lista de `Violacion` (vacía = bien). Nada aquí lanza por una violación: el que
// corre las secuencias decide qué hacer (parar, minimizar, contar). Son SOLO para pruebas.
//
// Lo que NO es una violación (informe 04 §8.3): que un cuadro nuevo quede a la izquierda de su origen o que una
// herramienta no cuelgue debajo cuando no cabe, que un trazo salga del lienzo. Eso es colocación «objetivo»: se
// CUENTA en `suaves` y no se exige. Lo que `huecoParaInsertar` prometió arreglar (poner en medio sin dejar una
// flecha hacia atrás) sí se exige.

import { leerBorrador, normalizarFlujo, serializarBorrador } from '../borrador';
import { enRango } from '../colocacion';
import { APPS_DISPARADOR, FRECUENCIAS, IAS, TIPOS_DISPARADOR } from '../catalogo';
import {
  ALTO_CUADRO,
  ANCHO_CUADRO,
  DESC_AYUDANTE_POR_DEFECTO,
  INSTRUCCIONES_AGENTE_NUEVO,
  LARGO_DESC_AYUDANTE,
  LARGO_NOMBRE_AGENTE,
  LARGO_NOMBRE_APP,
  LARGO_NOMBRE_FLUJO,
  LARGO_RUTA,
  LARGO_TEXTO_AGENTE,
  MAX_HISTORIAL,
  NOMBRE_FLUJO_INICIAL,
  PASO_TECLA,
  PASO_TECLA_MAYUS,
  TOPE_AGENTES,
  TOPE_APPS,
  TOPE_CUADROS,
  TOPE_DISPARADORES,
  VUELTAS_MAX,
  X_MAX,
  Y_MAX,
} from '../datos/constantes';
import { ejemplo, NOMBRE_EJEMPLO } from '../ejemplos';
import { claveEnFlujo, construirN8n, revisarFlujo, type FlujoN8n, type ResultadoFlujo } from '../exportar';
import { expresionesDelFlujo, violacionesDelFlujo } from '../golden/invariantes';
import { puedeEnlazar, violacionesDelGrafo } from '../grafo';
import { estadoInicial } from '../reductor';
import { SECRETOS } from '../secretos';
import {
  guia,
  panelDeAjustes,
  resumenFlujo,
  textoConectar,
  textoSinSeleccion,
  vistaAjustes,
  vistaElegirDisparador,
  vistaEnlace,
  vistaFlechas,
  vistaLienzo,
  vistaMenu,
  vistaNodos,
} from '../selectores';
import * as T from '../textos';
import { recortar } from '../texto';
import type { AccionConstructor as A, Arista, EstadoConstructor as E, Instantanea, Nodo, TipoArista } from '../tipos';
import { elegir } from './semilla';
import type { Memoria } from './gestos';

// ================================================================ tipos

/** De qué familia es una violación (para que cada `it` de la prueba mire solo la suya). */
export type Grupo =
  | 'accion'
  | 'grafo'
  | 'punteros'
  | 'estado'
  | 'ids'
  | 'exportacion'
  | 'selectores'
  | 'deshacer'
  | 'id-inexistente'
  | 'transicion'
  | 'acuerdo'
  | 'diferencial'
  | 'borrador';

/** Algo que no debería pasar. El `detalle` lleva ids y textos para depurar. */
export interface Violacion {
  grupo: Grupo;
  codigo: string;
  detalle: string;
}

export const vio = (grupo: Grupo, codigo: string, detalle: string): Violacion => ({ grupo, codigo, detalle });

/** Lo que las pruebas pueden cambiar para ver si los ojos se dan cuenta (mutantes): el reductor y el exportador. */
export interface Dependencias {
  reducir: (estado: E, accion: A) => E;
  construirFlujo: (est: E['flujo'], opciones?: { zona?: string | undefined }) => ResultadoFlujo;
}

/** Lo que se arrastra de un paso al siguiente. */
export interface Contexto {
  deps: Dependencias;
  /** Los ids que alguna vez estuvieron en el flujo (desde la última vez que la página nació). */
  memoria: Memoria;
  /** Lo que cada instantánea de la pila DEBE restaurar, escrito el día que se apiló (y no cambia nunca). */
  instantaneas: WeakMap<Instantanea, string>;
  /** Las instantáneas que ya se revisaron como flujo válido. */
  validadas: WeakSet<Instantanea>;
  /** El azar de los muestreos (solo cuando `completo` es falso). */
  rng: () => number;
  /** Revisar TODO en cada paso, sin muestrear (se usa al reproducir y minimizar). */
  completo: boolean;
  /** Cuántas veces ocurrió cada caso difícil (para saber que «cero violaciones» no es «cero cobertura»). */
  cobertura: Map<string, number>;
  /** Cuántas veces se dio lo que NO es un invariante duro (colocación «objetivo»; reglas más estrictas que los invariantes). */
  suaves: Map<string, number>;
  /** Cuántos ms tarda cada comprobación (solo si alguien lo pide). */
  tiempos?: Map<string, number>;
  /** El último flujo cuya exportación se revisó: si el flujo no cambió (una acción solo de interfaz), el archivo tampoco. */
  flujoRevisado?: E['flujo'] | undefined;
  /** Lo mismo para el borrador. */
  flujoGuardado?: E['flujo'] | undefined;
}

export const cuenta = (m: Map<string, number>, k: string): void => {
  m.set(k, (m.get(k) ?? 0) + 1);
};

const mensaje = (x: unknown): string => (x instanceof Error ? x.message : String(x)).split('\n')[0] ?? '';

// ================================================================ utilidades

const jsonDe = (v: unknown): string => JSON.stringify(v);

/** Lo que una instantánea debe restaurar, como texto: cuadros, conexiones, nombre del flujo y cuadro elegido. */
export function huellaDeEstado(nodes: readonly Nodo[], edges: readonly Arista[], nombreFlujo: string, sel: string | null): string {
  return jsonDe([nodes, edges, nombreFlujo, sel]);
}

/**
 * Lo que Deshacer debe dejar al aplicar una instantánea sobre el flujo de AHORA: la foto, salvo los cuadros que la persona movió o escribió
 * después de apilarla (y que siguen en pie, del mismo tipo), que conservan lo de ahora, y el nombre del flujo si se renombró. Una foto de
 * clase `cargar` se devuelve entera. Es la especificación escrita aparte del reductor.
 */
export function huellaEsperadaAlDeshacer(inst: Instantanea, actual: { nodes: readonly Nodo[]; nombreFlujo: string }): string {
  const entera = inst.clase === 'cargar';
  const tocados = entera ? [] : (inst.tocados ?? []);
  const nodes = inst.nodes.map(n => (tocados.includes(n.id) ? (actual.nodes.find(x => x.id === n.id && x.kind === n.kind) ?? n) : n));
  const nombre = !entera && inst.nombreTocado === true ? actual.nombreFlujo : (inst.nombreFlujo ?? actual.nombreFlujo);
  return huellaDeEstado(nodes, inst.edges, nombre, inst.sel);
}

function recorrer(v: unknown, ruta: string, cb: (ruta: string, v: unknown) => void, vistos: WeakSet<object>): void {
  if (typeof v === 'function') return;
  if (v !== null && typeof v === 'object') {
    if (vistos.has(v)) return;
    vistos.add(v);
    if (Array.isArray(v)) v.forEach((x, i) => recorrer(x, `${ruta}[${i}]`, cb, vistos));
    else for (const [k, x] of Object.entries(v)) recorrer(x, `${ruta}.${k}`, cb, vistos);
    return;
  }
  cb(ruta, v);
}

/** Lo que no debe salir en nada que se pinte. */
const SUCIO = /NaN|undefined|\[object |Infinity|\bnull\b/;

/** Un número que no es número, un `undefined` o un texto con «NaN», «undefined», «[object …», «Infinity» o «null» dentro de lo que devuelve un selector. */
export interface Suciedad {
  codigo: 'selector-numero-no-finito' | 'selector-texto-sucio' | 'selector-undefined';
  ruta: string;
  valor: string;
}

/** Recorre un valor (objetos y listas, sin seguir ciclos) y devuelve todo lo sucio que encuentra. */
export function buscarSuciedad(valor: unknown, raiz = 'valor'): Suciedad[] {
  const out: Suciedad[] = [];
  recorrer(
    valor,
    raiz,
    (ruta, v) => {
      if (typeof v === 'number' && !Number.isFinite(v)) out.push({ codigo: 'selector-numero-no-finito', ruta, valor: String(v) });
      else if (typeof v === 'string' && SUCIO.test(v)) out.push({ codigo: 'selector-texto-sucio', ruta, valor: JSON.stringify(v.slice(0, 120)) });
      else if (v === undefined) out.push({ codigo: 'selector-undefined', ruta, valor: 'undefined' });
    },
    new WeakSet(),
  );
  return out;
}

/** El número que termina un id (`a21` → 21), o 0. */
const sufijo = (id: string): number => Number(/(\d+)$/.exec(id)?.[1] ?? 0);

const solapa = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
  Math.abs(a.x - b.x) < ANCHO_CUADRO && Math.abs(a.y - b.y) < ALTO_CUADRO;

interface Dif {
  nuevos: string[];
  quitados: string[];
  cambiados: { id: string; claves: string[] }[];
}

function dif<T extends { id: string }>(antes: readonly T[], despues: readonly T[]): Dif {
  const A = new Map(antes.map(x => [x.id, x] as const));
  const B = new Map(despues.map(x => [x.id, x] as const));
  const cambiados: Dif['cambiados'] = [];
  for (const [id, b] of B) {
    const a = A.get(id);
    if (!a) continue;
    const ra = a as unknown as Record<string, unknown>;
    const rb = b as unknown as Record<string, unknown>;
    const claves = [...new Set([...Object.keys(ra), ...Object.keys(rb)])].filter(k => jsonDe(ra[k]) !== jsonDe(rb[k]));
    if (claves.length > 0) cambiados.push({ id, claves });
  }
  return { nuevos: [...B.keys()].filter(i => !A.has(i)), quitados: [...A.keys()].filter(i => !B.has(i)), cambiados };
}

// ================================================================ 1 · el estado

/** Un texto que termina en la mitad de un emoji (un sustituto alto sin su pareja). */
const SUSTITUTO_ALTO_AL_FINAL = /[\ud800-\udbff]$/;

/** Los códigos de `violacionesDelGrafo` que dicen que el flujo ni siquiera tiene la forma de un flujo. */
const FORMA_ROTA: ReadonlySet<string> = new Set(['nodos-no-es-lista', 'aristas-no-es-lista', 'nodo-malformado', 'arista-malformada']);

/** Lo que todo estado alcanzable cumple: invariantes del grafo, topes, punteros, contadores, avisos y pila. */
export function revisarEstado(e: E, ctx: Contexto): Violacion[] {
  const out: Violacion[] = [];
  const { nodes, edges } = e.flujo;
  const hay = new Set(nodes.map(n => n.id));
  const hayE = new Map(edges.map(x => [x.id, x] as const));

  // ---- el grafo (invGrafo del fuzz) y los topes, dichos otra vez con números propios
  for (const v of violacionesDelGrafo(nodes, edges)) out.push(vio('grafo', v.codigo, v.detalle));
  // si ni siquiera son listas de cuadros y conexiones bien formados, no hay más que revisar
  if (out.some(v => FORMA_ROTA.has(v.codigo))) return out;
  const cuantos = (k: Nodo['kind']) => nodes.filter(n => n.kind === k).length;
  if (cuantos('trigger') > TOPE_DISPARADORES) out.push(vio('grafo', 'tope-disparadores', `${cuantos('trigger')}`));
  if (cuantos('agent') > TOPE_AGENTES) out.push(vio('grafo', 'tope-agentes', `${cuantos('agent')}`));
  if (cuantos('app') > TOPE_APPS) out.push(vio('grafo', 'tope-apps', `${cuantos('app')}`));
  if (nodes.length > TOPE_CUADROS) out.push(vio('grafo', 'tope-cuadros', `${nodes.length}`));

  // ---- cada cuadro trae campos que existen (un proveedor de IA que se ofrece, un tipo de disparador que existe…) y nombres dentro de su tope
  for (const n of nodes) {
    const malo = (campo: string) => out.push(vio('estado', 'nodo-con-campo-invalido', `${n.id}.${campo}`));
    if (n.kind === 'trigger') {
      if (!TIPOS_DISPARADOR.some(t => t.id === n.tipo)) malo('tipo');
      if (!FRECUENCIAS.some(f => f.id === n.frec)) malo('frec');
      if (!APPS_DISPARADOR.some(a => a.id === n.app)) malo('app');
      if (typeof n.ruta !== 'string' || n.ruta.length > LARGO_RUTA) malo('ruta');
    } else if (n.kind === 'agent') {
      if (!IAS.some(i => i.id === n.ia)) malo('ia');
      if (typeof n.nombre !== 'string' || n.nombre.length > LARGO_NOMBRE_AGENTE) malo('nombre');
      if (typeof n.tarea !== 'string' || typeof n.instrucciones !== 'string' || (n.desc !== undefined && typeof n.desc !== 'string')) malo('texto');
      else if (n.tarea.length > LARGO_TEXTO_AGENTE || n.instrucciones.length > LARGO_TEXTO_AGENTE || (n.desc !== undefined && n.desc.length > LARGO_DESC_AYUDANTE)) malo('texto-largo');
    } else if (typeof n.nombre !== 'string' || n.nombre.length > LARGO_NOMBRE_APP) malo('nombre');
    // ningún texto termina en la mitad de un emoji
    for (const [campo, valor] of Object.entries(n)) {
      if (typeof valor === 'string' && SUSTITUTO_ALTO_AL_FINAL.test(valor)) malo(`${campo}-medio-emoji`);
    }
  }
  if (typeof e.flujo.nombreFlujo !== 'string' || e.flujo.nombreFlujo.length > LARGO_NOMBRE_FLUJO || SUSTITUTO_ALTO_AL_FINAL.test(e.flujo.nombreFlujo)) out.push(vio('estado', 'nodo-con-campo-invalido', 'nombreFlujo'));

  // ---- punteros sin fantasmas
  if (e.sel !== null && !hay.has(e.sel)) out.push(vio('punteros', 'sel-fantasma', e.sel));
  if (e.selEdge !== null && !hayE.has(e.selEdge)) out.push(vio('punteros', 'selEdge-fantasma', e.selEdge));
  if (e.sel !== null && e.selEdge !== null) out.push(vio('punteros', 'sel-y-selEdge', `${e.sel} + ${e.selEdge}`));
  if (e.menu) {
    const A = nodes.find(n => n.id === e.menu?.ancla);
    if (!A) out.push(vio('punteros', 'menu-ancla-fantasma', e.menu.ancla));
    if (e.menu.insertarEn !== null) {
      const x = hayE.get(e.menu.insertarEn);
      if (!x) out.push(vio('punteros', 'menu-insertarEn-fantasma', e.menu.insertarEn));
      else if (x.tipo !== 'seq' || x.de !== e.menu.ancla || e.menu.tipo !== 'seq') {
        out.push(vio('punteros', 'menu-insertar-incoherente', `${x.id} ${x.tipo} de ${x.de}; menú ${e.menu.tipo} desde ${e.menu.ancla}`));
      }
    }
    if (e.menu.tipo === 'tool' && A && A.kind !== 'agent') out.push(vio('punteros', 'menu-herramienta-de-no-agente', e.menu.ancla));
    if (e.menu.tipo === 'tool' && e.menu.paso !== 'app') out.push(vio('punteros', 'menu-patita-en-inicio', e.menu.ancla));
    if (e.menu.paso !== 'inicio' && e.menu.paso !== 'app') out.push(vio('punteros', 'menu-paso-raro', String(e.menu.paso)));
  }
  if (e.conectando) {
    const A = nodes.find(n => n.id === e.conectando?.ancla);
    if (!A) out.push(vio('punteros', 'conectando-fantasma', e.conectando.ancla));
    else if (e.conectando.tipo === 'tool' && e.conectando.rol === 'origen' && A.kind !== 'agent') {
      out.push(vio('punteros', 'conectando-herramienta-de-no-agente', A.id));
    }
  }
  if (e.menu && e.conectando) out.push(vio('punteros', 'menu-y-conectando', 'ambos abiertos'));

  // ---- contadores, avisos y peticiones
  if (e.siguiente < 20) out.push(vio('estado', 'contador-menor-que-20', String(e.siguiente)));
  for (const x of [...nodes, ...edges]) {
    if (sufijo(x.id) > e.siguiente) out.push(vio('estado', 'id-pasa-del-contador', `${x.id} > ${e.siguiente}`));
  }
  // ni el aviso que se anuncia a lectores de pantalla lleva «undefined», «NaN» o «[object …»
  if (e.aviso) for (const x of buscarSuciedad(e.aviso, 'aviso')) out.push(vio('estado', 'aviso-sucio', `${x.ruta} = ${x.valor}`));
  if (e.aviso && e.aviso.id > e.eventos) out.push(vio('estado', 'aviso-con-id-mayor-que-eventos', `${e.aviso.id} > ${e.eventos}`));
  if (e.foco && e.foco.n > e.eventos) out.push(vio('estado', 'foco-con-n-mayor-que-eventos', `${e.foco.n} > ${e.eventos}`));
  if (e.ver && e.ver.n > e.eventos) out.push(vio('estado', 'ver-con-n-mayor-que-eventos', `${e.ver.n} > ${e.eventos}`));
  // las peticiones que la pantalla aún no cumplió no apuntan a lo que ya no existe
  if (e.ver && !hay.has(e.ver.id)) out.push(vio('punteros', 'ver-fantasma', e.ver.id));
  if (e.foco) {
    const f = e.foco.objetivo;
    const dueno = f.k === 'mas' ? /^(?:der|tool)-(.+)$/.exec(f.clave)?.[1] : undefined;
    if (f.k === 'nodo' && !hay.has(f.id)) out.push(vio('punteros', 'foco-nodo-fantasma', f.id));
    else if (f.k === 'insignia' && !hayE.has(f.id)) out.push(vio('punteros', 'foco-insignia-fantasma', f.id));
    else if (dueno !== undefined && !hay.has(dueno)) out.push(vio('punteros', 'foco-mas-fantasma', f.k === 'mas' ? f.clave : ''));
    else if (f.k === 'primeraOpcionMenu' && e.menu === null) out.push(vio('punteros', 'foco-en-un-menu-cerrado', 'primeraOpcionMenu'));
    else if (f.k === 'opcionUnSentido' && e.selEdge === null) out.push(vio('punteros', 'foco-en-una-flecha-no-elegida', 'opcionUnSentido'));
  }
  if (e.historial.length > MAX_HISTORIAL) out.push(vio('estado', 'pila-de-mas-de-20', String(e.historial.length)));
  const cima = e.historial[e.historial.length - 1];
  if (e.aviso?.conDeshacer && cima?.avisoId !== e.aviso.id) {
    out.push(vio('estado', 'aviso-ofrece-deshacer-sin-ser-el-de-la-cima', `aviso ${e.aviso.id}, cima ${cima?.avisoId ?? 'vacía'}`));
  }
  // toda instantánea de la pila es un flujo válido (si no, Deshacer entregaría un estado roto)
  for (const inst of e.historial) {
    if (ctx.validadas.has(inst)) continue;
    ctx.validadas.add(inst);
    for (const v of violacionesDelGrafo(inst.nodes, inst.edges)) out.push(vio('estado', 'instantanea-invalida', `${v.codigo}: ${v.detalle}`));
  }
  return out;
}

// ================================================================ 2 · los selectores

/** Lo que los selectores dicen de un estado: sin NaN ni undefined, y de acuerdo con el grafo (el «lo pintado dice lo mismo que el grafo» del fuzz). */
export function revisarVistas(e: E): Violacion[] {
  const out: Violacion[] = [];
  const add = (codigo: string, detalle: string) => out.push(vio('selectores', codigo, detalle));
  const { nodes, edges } = e.flujo;
  let vn: ReturnType<typeof vistaNodos>;
  let vf: ReturnType<typeof vistaFlechas>;
  let vm: ReturnType<typeof vistaMenu>;
  let vl: ReturnType<typeof vistaLienzo>;
  let va: ReturnType<typeof vistaAjustes>;
  let ve: ReturnType<typeof vistaEnlace>;
  let panel: ReturnType<typeof panelDeAjustes>;
  let vd: ReturnType<typeof vistaElegirDisparador>;
  let rf: ReturnType<typeof resumenFlujo>;
  let textos: string[];
  try {
    vn = vistaNodos(e);
    vf = vistaFlechas(e);
    vm = vistaMenu(e);
    vl = vistaLienzo(e);
    va = vistaAjustes(e);
    ve = vistaEnlace(e);
    panel = panelDeAjustes(e);
    vd = vistaElegirDisparador(e);
    rf = resumenFlujo(e);
    textos = [guia(e), textoSinSeleccion(e), textoConectar(e)];
  } catch (x) {
    add('selector-lanza', mensaje(x));
    return out;
  }

  // ---- ni NaN, ni undefined, ni textos sucios en nada de lo que devuelven
  for (const x of buscarSuciedad({ vn, vf, vm, vl, va, ve, panel, vd, rf, textos }, 'vistas')) add(x.codigo, `${x.ruta} = ${x.valor}`);

  // ---- los cuadros
  const porId = new Map(nodes.map(n => [n.id, n] as const));
  const padre = new Map<string, string>();
  for (const x of edges) if (x.tipo === 'tool') padre.set(x.a, x.de);
  if (vn.length !== nodes.length) add('vista-nodos-no-igualan', `${vn.length} de ${nodes.length}`);
  const vistos = new Set<string>();
  for (const v of vn) {
    if (vistos.has(v.id)) add('vista-id-repetido', v.id);
    vistos.add(v.id);
    const n = porId.get(v.id);
    if (!n) {
      add('vista-cuadro-sin-nodo', v.id);
      continue;
    }
    if (v.x !== n.x || v.y !== n.y) add('vista-posicion-distinta', v.id);
    const esT = padre.has(n.id);
    if (v.esHerramienta !== esT || /\bnodo-tool\b/.test(v.clase) !== esT) add('vista-herramienta-incoherente', `${v.id}: «${v.clase}» y herramienta=${esT}`);
    if (n.kind !== 'trigger' && esT !== (n.kind === 'agent' ? /conversa con/ : /herramienta de/).test(v.tipo)) {
      add('vista-herramienta-incoherente', `${v.id}: etiqueta «${v.tipo}»`);
    }
    const hayDespues = edges.some(x => x.tipo === 'seq' && x.de === n.id);
    const conversaCon = edges.some(x => x.tipo === 'tool' && x.de === n.id && porId.get(x.a)?.kind === 'agent');
    const puedeDer = (!esT || n.kind === 'agent') && !conversaCon;
    if (v.stubDer !== (puedeDer && !hayDespues) || v.asaDer !== (puedeDer && hayDespues) || v.patita !== (n.kind === 'agent') || v.puedeDer !== puedeDer) {
      add('vista-mas-incoherente', `${v.id}: stub=${v.stubDer} asa=${v.asaDer} patita=${v.patita} esT=${esT} hay=${hayDespues} conversa=${conversaCon}`);
    }
    if (v.stubDer && v.asaDer) add('vista-mas-incoherente', `${v.id}: los dos «+» de la derecha`);
    if (v.seleccionado !== (e.sel === n.id)) add('vista-seleccion-incoherente', v.id);
    if (v.abiertoDer !== (e.menu?.ancla === n.id && e.menu.tipo === 'seq' && e.menu.insertarEn === null)) add('vista-menu-incoherente', `${v.id} abiertoDer`);
    if (v.abiertoTool !== (e.menu?.ancla === n.id && e.menu.tipo === 'tool')) add('vista-menu-incoherente', `${v.id} abiertoTool`);
    if (e.conectando) {
      if ((v.id === e.conectando.ancla) !== (v.modoConexion === 'ancla')) add('vista-conectando-incoherente', `${v.id} ancla`);
      if (v.modoConexion === null) add('vista-conectando-incoherente', `${v.id} sin modo`);
      if ((v.modoConexion === 'nulo') !== (v.motivoNulo !== null)) add('vista-conectando-incoherente', `${v.id} motivo`);
      if (v.motivoNulo !== null && v.motivoNulo.trim() === '') add('vista-conectando-incoherente', `${v.id} motivo vacío`);
    } else if (v.modoConexion !== null || v.motivoNulo !== null) add('vista-conectando-incoherente', `${v.id} fuera del modo conectando`);
  }

  // ---- las flechas
  const validas = edges.filter(x => porId.has(x.de) && porId.has(x.a));
  if (vf.length !== validas.length) add('vista-flechas-no-igualan', `${vf.length} de ${validas.length}`);
  const flechasVistas = new Set<string>();
  for (const f of vf) {
    if (flechasVistas.has(f.id)) add('vista-id-repetido', f.id);
    flechasVistas.add(f.id);
    const x = edges.find(y => y.id === f.id);
    if (!x) {
      add('vista-flecha-sin-conexion', f.id);
      continue;
    }
    const B = porId.get(x.a);
    if (f.tipo !== x.tipo || f.punteada !== (x.tipo === 'tool') || f.icono !== (x.tipo === 'seq' ? 'unSentido' : 'idaYVuelta')) add('vista-flecha-incoherente', f.id);
    if (f.forma !== (x.tipo === 'seq' ? 'paso' : B?.kind === 'agent' ? 'conversan' : 'herramienta')) add('vista-flecha-incoherente', `${f.id}: forma ${f.forma}`);
    if (f.activa !== (e.selEdge === x.id) || f.ancho !== (f.activa ? 3 : 2)) add('vista-flecha-incoherente', `${f.id}: activa`);
    if (!/^M-?\d+(\.\d+)?[ ,]-?\d+(\.\d+)?C/.test(f.d) || (f.d.match(/-?\d+(?:\.\d+)?/g) ?? []).length !== 8) add('vista-flecha-incoherente', `${f.id}: trazo «${f.d}»`);
    if (!Number.isInteger(f.medio.x) || !Number.isInteger(f.medio.y) || f.insignia.x !== f.medio.x - 22 || f.insignia.y !== f.medio.y - 22) add('vista-flecha-incoherente', `${f.id}: insignia`);
  }

  // ---- el lienzo cubre todos los cuadros
  const maxX = nodes.reduce((m, n) => Math.max(m, n.x), 0);
  const maxY = nodes.reduce((m, n) => Math.max(m, n.y), 0);
  if (vl.ancho < maxX + ANCHO_CUADRO + 112 || vl.alto < maxY + ALTO_CUADRO + 168) add('vista-lienzo-no-cubre', `${vl.ancho}x${vl.alto} con un cuadro en ${maxX},${maxY}`);

  // ---- el menú
  const menuVivo = e.menu !== null && porId.has(e.menu.ancla);
  if ((vm !== null) !== menuVivo) add('vista-menu-incoherente', `menu=${e.menu !== null} vista=${vm !== null}`);
  if (vm) {
    if (vm.esInicio === vm.esApp) add('vista-menu-incoherente', 'esInicio y esApp');
    if (vm.x < 8 || vm.y < 8 || vl.alto < vm.fondo) add('vista-menu-incoherente', `x=${vm.x} y=${vm.y} fondo=${vm.fondo} lienzo=${vl.alto}`);
    const ids = vm.opciones.map(o => o.id);
    if (new Set(ids).size !== ids.length) add('vista-menu-incoherente', 'opciones repetidas');
    if (vm.tipo === 'tool' && ids.includes('agente')) add('vista-menu-incoherente', 'la patita ofrece un agente');
    const libres = vm.opciones.filter(o => !o.bloqueada);
    if (vm.opciones.filter(o => o.primera).length !== (libres.length > 0 ? 1 : 0) || vm.opciones.some(o => o.primera && o.bloqueada)) add('vista-menu-incoherente', 'la primera opción');
    if (vm.opciones.some(o => o.bloqueada !== (o.motivo !== null))) add('vista-menu-incoherente', 'motivo y bloqueo');
  }

  // ---- los paneles
  if ((va !== null) !== (e.sel !== null && porId.has(e.sel))) add('vista-ajustes-incoherente', `sel=${e.sel} ajustes=${va !== null}`);
  if (va) {
    const n = porId.get(va.id);
    const esperado = n?.kind === 'trigger' ? 'disparador' : n?.kind === 'agent' ? 'agente' : 'app';
    if (!n || va.panel !== esperado || va.id !== e.sel) add('vista-ajustes-incoherente', `${va.id}: panel ${va.panel}`);
    const tocan = edges.filter(x => x.de === va.id || x.a === va.id).map(x => x.id);
    if (jsonDe(va.conexiones.map(c => c.id).sort()) !== jsonDe([...tocan].sort())) add('vista-ajustes-incoherente', `${va.id}: conexiones`);
    const esT = padre.has(va.id);
    const nAyud = edges.filter(x => x.tipo === 'tool' && x.de === va.id && porId.get(x.a)?.kind === 'agent').length;
    if (va.btnSig !== ((!esT || n?.kind === 'agent') && nAyud === 0) || va.btnHerr !== (n?.kind === 'agent')) add('vista-ajustes-incoherente', `${va.id}: botones`);
    if (va.panel === 'agente' && va.esAyudante !== (esT && porId.get(padre.get(va.id) ?? '')?.kind === 'agent')) add('vista-ajustes-incoherente', `${va.id}: ayudante`);
  }
  if ((ve !== null) !== (e.sel === null && e.selEdge !== null && edges.some(x => x.id === e.selEdge && porId.has(x.de) && porId.has(x.a)))) {
    add('vista-enlace-incoherente', `sel=${e.sel} selEdge=${e.selEdge} vista=${ve !== null}`);
  }
  if (ve) {
    const x = edges.find(y => y.id === ve.id);
    if (!x || ve.uno.activa === ve.doble.activa || ve.uno.activa !== (x.tipo === 'seq') || ve.esUno !== (x.tipo === 'seq')) add('vista-enlace-incoherente', `${ve.id}: la opción activa`);
    for (const o of [ve.uno, ve.doble]) {
      if (o.activa && o.noElegible) add('vista-enlace-incoherente', `${ve.id}: la activa no es elegible`);
      if (o.noElegible !== (o.nota !== null)) add('vista-enlace-incoherente', `${ve.id}: nota y elegibilidad`);
    }
    if (ve.puedeMedio !== ve.esUno) add('vista-enlace-incoherente', `${ve.id}: poner en medio`);
  }
  const panelEsperado = e.sel !== null && porId.has(e.sel) ? 'cuadro' : ve !== null ? 'enlace' : 'ninguno';
  if (panel !== panelEsperado) add('vista-panel-incoherente', `${panel} y se esperaba ${panelEsperado}`);

  // ---- la tarjeta del disparador, el resumen y los textos
  if (vd.visible !== !nodes.some(n => n.kind === 'trigger') || vd.puedeEjemplo !== (nodes.length === 0)) add('vista-disparador-incoherente', `visible=${vd.visible}`);
  const rev = revisarFlujo(e.flujo);
  if (jsonDe(rf.errores) !== jsonDe(rev.errores) || jsonDe(rf.avisos) !== jsonDe(rev.avisos)) add('vista-resumen-incoherente', 'errores o avisos');
  if (rf.puedeDescargar !== (rev.errores.length === 0) || rf.cuadros !== nodes.length) add('vista-resumen-incoherente', 'puedeDescargar');
  if (textos.some((t, i) => (i < 2 || e.conectando !== null) && t.trim() === '') || (e.conectando === null && textos[2] !== '')) add('vista-textos-incoherentes', jsonDe(textos));
  return out;
}

// ================================================================ 3 · la exportación

const MODELO_DE_CADA_AGENTE = 'ai_languageModel';

/**
 * Lo que sale de `construirFlujo` y `construirN8n` para este flujo: no lanzan, el JSON es estable y equivale al
 * objeto, `flujo === null` si y solo si hay errores, ninguna clave llega al archivo, el archivo cumple los
 * invariantes del golden y sus conexiones son EXACTAMENTE las que el lienzo dibuja (ni una más, ni una menos).
 */
export function revisarExportacion(e: E, ctx: Contexto): Violacion[] {
  const out: Violacion[] = [];
  const add = (codigo: string, detalle: string) => out.push(vio('exportacion', codigo, detalle));
  // un flujo que ya se revisó (la acción fue solo de interfaz) da el mismo archivo: no se repite
  if (!ctx.completo && ctx.flujoRevisado === e.flujo) return out;
  ctx.flujoRevisado = e.flujo;
  let r1: ResultadoFlujo;
  let rev: ReturnType<typeof revisarFlujo>;
  try {
    r1 = ctx.deps.construirFlujo(e.flujo, { zona: 'UTC' });
    rev = revisarFlujo(e.flujo);
  } catch (x) {
    add('flujo-lanza', mensaje(x));
    return out;
  }
  if ((r1.errores.length > 0) !== (r1.flujo === null) || (r1.flujo === null) !== (r1.json === '')) add('flujo-errores-vs-nulo', `errores=${r1.errores.length} flujo=${r1.flujo === null ? 'null' : 'objeto'}`);
  // la revisión barata (la que usa el lienzo en cada pulsación) y el armado dicen lo mismo
  if (jsonDe(rev.errores) !== jsonDe(r1.errores) || jsonDe(rev.avisos) !== jsonDe(r1.avisos)) add('revision-distinta-del-armado', `${jsonDe(rev.errores)} y ${jsonDe(r1.errores)}`);

  // lo que se le dice a la persona («Te falta esto…») también va limpio
  for (const x of buscarSuciedad({ errores: r1.errores, avisos: r1.avisos }, 'revision')) add('revision-texto-sucio', `${x.ruta} = ${x.valor}`);

  // construirN8n: lanza cuando hay errores y, si no, da lo mismo que construirFlujo
  let n8n: FlujoN8n | null = null;
  try {
    n8n = construirN8n(e.flujo, { zona: 'UTC' });
    if (r1.errores.length > 0) add('construirN8n-no-lanza-con-errores', r1.errores[0] ?? '');
  } catch {
    if (r1.errores.length === 0) add('construirN8n-lanza-sin-errores', 'revisarFlujo no vio errores');
  }
  if (r1.flujo === null) {
    cuenta(ctx.cobertura, 'exportación bloqueada por errores');
    return out;
  }
  cuenta(ctx.cobertura, 'exportación sin errores');
  // dos armados independientes del mismo flujo dan el mismo archivo, byte a byte (el JSON es estable)
  if (n8n && JSON.stringify(n8n, null, 2) !== r1.json) add('flujo-json-inestable', 'construirN8n y construirFlujo dieron archivos distintos');
  if (r1.json !== JSON.stringify(r1.flujo, null, 2) || jsonDe(JSON.parse(r1.json)) !== jsonDe(r1.flujo)) add('flujo-json-distinto', 'el texto no equivale al objeto');
  if (claveEnFlujo(r1.flujo) || SECRETOS.some(re => re.test(r1.json))) add('flujo-con-clave', 'el archivo lleva algo que parece una clave');
  for (const v of violacionesDelFlujo(r1.flujo)) add('flujo-invariante', v);
  out.push(...conexionesEsperadas(e, r1.flujo));
  out.push(...expresionesSeguras(r1.flujo));
  return out;
}

/**
 * Nada de lo que escribe la persona se vuelve expresión de n8n. En cada valor que n8n evalúa (el que empieza con «=»): a lo sumo UN
 * `{{ … }}` (el del propio exportador, nunca unas llaves de la persona), y todo `$('nombre')` es una cadena bien cerrada (la comilla, la
 * barra y las llaves de un nombre van escapadas a \uXXXX) que dice el nombre de un nodo que existe.
 */
function expresionesSeguras(f: FlujoN8n): Violacion[] {
  const out: Violacion[] = [];
  const nombres = new Set(f.nodes.map(n => n.name));
  for (const { ruta, texto } of expresionesDelFlujo(f)) {
    const abre = (texto.match(/\{\{/g) ?? []).length;
    const cierra = (texto.match(/\}\}/g) ?? []).length;
    // lo que la persona escribe como instrucciones o «para qué sirve» no lleva ninguna plantilla del exportador: ni una llave doble
    const soloTexto = /systemMessage|toolDescription/.test(ruta);
    if (abre > (soloTexto ? 0 : 1) || cierra > (soloTexto ? 0 : 1) || abre !== cierra) out.push(vio('exportacion', 'flujo-llaves-del-usuario-en-una-expresion', `${ruta}: ${abre} «{{» y ${cierra} «}}»`));
    const refs = (texto.match(/\$\(/g) ?? []).length;
    const buenas = [...texto.matchAll(/\$\('((?:[^'\\\r\n]|\\u[0-9a-fA-F]{4})*)'\)/g)];
    if (refs !== buenas.length) out.push(vio('exportacion', 'flujo-referencia-a-nodo-mal-cerrada', `${ruta}: ${JSON.stringify(texto.slice(0, 120))}`));
    for (const b of buenas) {
      const nombre = (b[1] ?? '').replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
      if (!nombres.has(nombre)) out.push(vio('exportacion', 'flujo-referencia-a-nodo-inexistente', `${ruta}: «${nombre}»`));
    }
  }
  return out;
}

/** La exportación contra el lienzo (`chequearFlujo` del fuzz): cada cuadro tiene su nodo, y las conexiones son exactamente las esperadas. */
function conexionesEsperadas(e: E, f: FlujoN8n): Violacion[] {
  const out: Violacion[] = [];
  const add = (codigo: string, detalle: string) => out.push(vio('exportacion', codigo, detalle));
  const { nodes, edges } = e.flujo;
  const lista = f.nodes;
  // el disparador va primero; después los demás en su orden; cada agente va seguido del nodo de su modelo
  const orden = [...nodes.filter(n => n.kind === 'trigger'), ...nodes.filter(n => n.kind !== 'trigger')];
  const nombre = new Map<string, string>();
  const modelo = new Map<string, string>();
  const nodoDe = new Map<string, FlujoN8n['nodes'][number]>();
  let i = 0;
  for (const n of orden) {
    const nd = lista[i];
    if (!nd) {
      add('flujo-desalineado', `faltan nodos para ${n.id}`);
      return out;
    }
    nombre.set(n.id, nd.name);
    nodoDe.set(n.id, nd);
    i += 1;
    if (n.kind === 'agent') {
      const mo = lista[i];
      if (!mo) {
        add('flujo-desalineado', `falta el modelo de ${n.id}`);
        return out;
      }
      modelo.set(n.id, mo.name);
      i += 1;
    }
  }
  if (i !== lista.length) add('flujo-desalineado', `sobran ${lista.length - i} nodos`);
  const nombres = lista.map(x => x.name);
  if (new Set(nombres).size !== nombres.length) add('flujo-nombres-repetidos', nombres.join(' | '));

  const padre = new Map<string, string>();
  for (const x of edges) if (x.tipo === 'tool') padre.set(x.a, x.de);
  const porId = new Map(nodes.map(n => [n.id, n] as const));
  const raiz = (id: string): string => {
    let x = id;
    for (let v = 0; v < VUELTAS_MAX; v += 1) {
      const pa = padre.get(x);
      if (pa !== undefined && porId.get(pa)?.kind === 'agent' && porId.get(x)?.kind === 'agent') x = pa;
      else break;
    }
    return x;
  };
  const esperado = new Set<string>();
  for (const x of edges) {
    if (x.tipo === 'seq') esperado.add(`main|${nombre.get(raiz(x.de)) ?? '?'}|${nombre.get(x.a) ?? '?'}`);
    else esperado.add(`ai_tool|${nombre.get(x.a) ?? '?'}|${nombre.get(x.de) ?? '?'}`);
  }
  for (const n of nodes) if (n.kind === 'agent') esperado.add(`${MODELO_DE_CADA_AGENTE}|${modelo.get(n.id) ?? '?'}|${nombre.get(n.id) ?? '?'}`);
  const real = new Set<string>();
  for (const [origen, salidas] of Object.entries(f.connections)) {
    for (const [tipo, ramas] of Object.entries(salidas)) {
      for (const rama of ramas ?? []) for (const dst of rama) real.add(`${tipo}|${origen}|${dst.node}`);
    }
  }
  for (const x of esperado) if (!real.has(x)) add('flujo-conexion-falta', x);
  for (const x of real) if (!esperado.has(x)) add('flujo-conexion-sobra', x);
  // el tipo del nodo según su papel
  for (const n of nodes) {
    const nd = nodoDe.get(n.id);
    if (!nd) continue;
    const esT = padre.has(n.id);
    if (n.kind === 'agent' && nd.type !== (esT ? '@n8n/n8n-nodes-langchain.agentTool' : '@n8n/n8n-nodes-langchain.agent')) add('flujo-tipo-agente', `${n.id} → ${nd.type}`);
    if (n.kind === 'app' && esT !== /Tool$/.test(nd.type)) add('flujo-tipo-app-herramienta', `${n.id} → ${nd.type}`);
    // el modelo ve las herramientas por el nombre del nodo y n8n cambia lo que no sea letra, número, espacio, «_» o «-» por «_»: se manda ya limpio
    if (esT && !/^[A-Za-z0-9 _-]+$/.test(nd.name)) add('flujo-nombre-de-herramienta-inseguro', `${n.id} → «${nd.name}»`);
  }
  return out;
}

// ================================================================ 3b · el borrador

/**
 * Todo estado alcanzable se puede GUARDAR como borrador y RECUPERAR igual (así lo que la persona armó sobrevive a
 * recargar la página o a que caduque la sesión), salvo que traiga algo que parece una clave: entonces NO se guarda,
 * jamás. Lo recuperado, además, es un estado inicial válido.
 */
export function revisarBorrador(e: E, ctx: Contexto): Violacion[] {
  const out: Violacion[] = [];
  const add = (codigo: string, detalle: string) => out.push(vio('borrador', codigo, detalle));
  if (!ctx.completo && ctx.flujoGuardado === e.flujo) return out;
  ctx.flujoGuardado = e.flujo;
  if (e.flujo.nodes.length === 0) return out;
  const s = serializarBorrador(e.flujo);
  if (claveEnFlujo(e.flujo)) {
    cuenta(ctx.cobertura, 'borrador: se negó a guardar una clave');
    if (s.ok || s.motivo !== 'con-clave') add('borrador-guarda-una-clave', s.ok ? 'se guardó' : s.motivo);
    return out;
  }
  if (!s.ok) {
    add('borrador-rechaza-un-estado-valido', `${s.motivo}: ${s.detalle.join(',')}`);
    return out;
  }
  const l = leerBorrador(s.texto);
  if (!l.ok) {
    add('borrador-no-recupera', `${l.motivo}: ${l.detalle.join(',')}`);
    return out;
  }
  cuenta(ctx.cobertura, 'borrador: ida y vuelta');
  if (s.recortes.length === 0 && jsonDe(l.flujo) !== jsonDe(e.flujo)) add('borrador-no-es-ida-y-vuelta', 'lo recuperado no es lo guardado');
  if (jsonDe(l.flujo) !== jsonDe(s.flujo)) add('borrador-lee-distinto-de-lo-que-escribe', 'serializar y leer no coinciden');
  const vuelta = estadoInicial(l.flujo);
  if (vuelta.flujo.nodes.length !== e.flujo.nodes.length) add('borrador-arranca-vacio', 'un estado inicial con lo recuperado se descartó');
  return out;
}

// ================================================================ 4 · una acción no cambia más de lo que dice

/** ¿La acción apunta a un cuadro o a una conexión que no existe? Entonces no debe cambiar NADA (ni la referencia del estado). */
export function apuntaAlVacio(e: E, a: A): boolean {
  const hayN = (id: unknown) => e.flujo.nodes.some(n => n.id === id);
  const hayE = (id: unknown) => e.flujo.edges.some(x => x.id === id);
  switch (a.k) {
    case 'abrirNodo':
    case 'intentarConexion':
    case 'quitarNodo':
    case 'moverNodo':
    case 'moverConTeclado':
    case 'editarNodo':
      return !hayN(a.id);
    case 'abrirEnlace':
    case 'cambiarTipoEnlace':
    case 'quitarEnlace':
      return !hayE(a.id);
    case 'iniciarConexion':
      return !hayN(a.ancla);
    case 'abrirMenu': {
      if (!hayN(a.ancla)) return true;
      const ins = a.insertarEn ?? null;
      return ins !== null && !e.flujo.edges.some(x => x.id === ins && x.tipo === 'seq' && x.de === a.ancla);
    }
    default:
      return false;
  }
}

const SOLO_INTERFAZ: ReadonlySet<string> = new Set([
  'abrirEnlace',
  'abrirMenu',
  'cerrarMenu',
  'pasoMenu',
  'iniciarConexion',
  'cancelarConexion',
  'cerrarTodo',
  'volverDeAjustes',
  'limpiarPeticiones',
]);
const ESTRUCTURALES: ReadonlySet<string> = new Set([
  'elegirDisparador',
  'crearDesdeMenu',
  'intentarConexion',
  'cambiarTipoEnlace',
  'quitarEnlace',
  'quitarNodo',
  'limpiar',
  'cargarEjemplo',
  'cargarFlujo',
]);
const CONTINUAS: ReadonlySet<string> = new Set(['moverNodo', 'moverConTeclado', 'editarNodo', 'renombrarFlujo']);

/** Los que crean ids nuevos por su cuenta (los que traen los suyos de afuera, o los restauran, no). */
const CREAN_IDS: ReadonlySet<string> = new Set(['elegirDisparador', 'crearDesdeMenu', 'intentarConexion', 'quitarNodo']);

/** Todo lo que sigue a `desde` por cualquier conexión (menos `salvo`): lo que «Poner en medio» puede correr a la derecha. */
function alcanzables(edges: readonly Arista[], desde: string, salvo: string): Set<string> {
  const sigue = new Set([desde]);
  for (let crece = true; crece; ) {
    crece = false;
    for (const x of edges) {
      if (x.id !== salvo && sigue.has(x.de) && !sigue.has(x.a)) {
        sigue.add(x.a);
        crece = true;
      }
    }
  }
  return sigue;
}

/**
 * El flujo de afuera tal como lo deja el reductor al abrirlo, o null si lo rechaza. El reductor es la única barrera: lo que
 * llega pasa por la limpieza del borrador (campos con su tipo, enumeraciones, ids seguros, sin claves, textos recortados, invariantes del
 * grafo y topes); un flujo sin nombre se llama como uno nuevo.
 */
function flujoDeAfuera(f: unknown): { nodes: Nodo[]; edges: Arista[]; nombreFlujo: string } | null {
  const n = normalizarFlujo(f, { nombrePorOmision: NOMBRE_FLUJO_INICIAL });
  return n.ok ? n.flujo : null;
}

/**
 * Cada acción cambia SOLO lo que dice que cambia (`transicion` del fuzz): qué se creó, qué se quitó, qué se movió,
 * en qué historial quedó, y que un id que no existe no toca nada. `antes` y `despues` son los estados que separa esa acción.
 */
export function revisarTransicion(antes: E, a: A, despues: E, ctx: Contexto): Violacion[] {
  const out: Violacion[] = [];
  const m = (codigo: string, detalle: string) => out.push(vio('transicion', codigo, `${a.k}: ${detalle}`));
  const fa = antes.flujo;
  const fd = despues.flujo;
  const mismoFlujo = fd === fa;

  // un estado sin la forma de un flujo no se puede comparar con nada (revisarEstado ya lo reporta)
  const bien = (f: E['flujo']) => f !== null && typeof f === 'object' && [f.nodes, f.edges].every(l => Array.isArray(l) && l.every(x => typeof x === 'object' && x !== null));
  if (!bien(despues.flujo)) return [vio('transicion', 'flujo-sin-forma', a.k)];

  // ---- un id que no existe no cambia nada
  if (apuntaAlVacio(antes, a) && despues !== antes) out.push(vio('id-inexistente', 'id-inexistente-cambia-el-estado', `${a.k}: ${jsonDe(a)}`));
  if (despues === antes) return out;

  // ---- los contadores nunca bajan
  if (despues.siguiente < antes.siguiente) m('contador-baja', `${antes.siguiente} → ${despues.siguiente}`);
  if (despues.eventos < antes.eventos) m('eventos-baja', `${antes.eventos} → ${despues.eventos}`);
  if (despues.scrollAjustes < antes.scrollAjustes) m('scroll-ajustes-baja', `${antes.scrollAjustes} → ${despues.scrollAjustes}`);

  // ---- qué cuenta como acción de qué clase (tocar un cuadro con el modo «conectando» es intentar la conexión)
  const efectiva = a.k === 'abrirNodo' && antes.conectando !== null ? 'intentarConexion' : a.k;
  const dn = dif(fa.nodes, fd.nodes);
  const de = dif(fa.edges, fd.edges);

  // ---- la pila de Deshacer
  const hCrece = despues.historial.length > antes.historial.length;
  const empuja = efectiva !== 'deshacer' && !mismoFlujo && ESTRUCTURALES.has(efectiva);
  if (efectiva === 'deshacer') {
    // se revisa más abajo
  } else if (mismoFlujo) {
    if (despues.historial !== antes.historial) m('historial-cambia-sin-cambiar-el-flujo', `${antes.historial.length} → ${despues.historial.length}`);
  } else if (empuja) {
    const esperado = Math.min(antes.historial.length + 1, MAX_HISTORIAL);
    if (despues.historial.length !== esperado) m('cambio-estructural-sin-instantanea', `pila ${antes.historial.length} → ${despues.historial.length}`);
    else if (despues.historial.slice(0, -1).some((x, i) => x !== antes.historial[antes.historial.length - (esperado - 1) + i])) m('pila-se-reescribe', 'las instantáneas viejas cambiaron');
    if (despues.historial[despues.historial.length - 1]?.avisoId !== despues.aviso?.id) m('instantanea-con-otro-aviso', 'el avisoId no es el del aviso de esta acción');
  } else if (CONTINUAS.has(efectiva)) {
    // mover, teclear y renombrar NO tiran la pila: queda del mismo tamaño, con las mismas fotos, y el aviso conserva su «Deshacer»
    if (despues.historial.length !== antes.historial.length) m('edicion-cambia-el-tamano-de-la-pila', `${antes.historial.length} → ${despues.historial.length} instantáneas`);
    if (despues.aviso?.conDeshacer !== antes.aviso?.conDeshacer) m('edicion-cambia-el-deshacer-del-aviso', `conDeshacer ${antes.aviso?.conDeshacer} → ${despues.aviso?.conDeshacer}`);
    antes.historial.forEach((foto, i) => {
      const f2 = despues.historial[i];
      if (!f2 || f2.nodes !== foto.nodes || f2.edges !== foto.edges || f2.nombreFlujo !== foto.nombreFlujo || f2.sel !== foto.sel || f2.avisoId !== foto.avisoId || f2.clase !== foto.clase) {
        m('edicion-reescribe-una-foto', `la foto ${i} de la pila ya no es la que se apiló`);
      }
    });
    // y cada foto aprende qué se tocó después de ella: así Deshacer no lo pisa
    const tocados = dn.cambiados.map(c => c.id);
    if (tocados.length > 0 && despues.historial.some(foto => tocados.some(id => !(foto.tocados ?? []).includes(id)))) {
      m('edicion-no-marca-lo-tocado', `se tocó ${tocados.join(', ')} y alguna foto no lo sabe`);
    }
    if (fa.nombreFlujo !== fd.nombreFlujo && despues.historial.some(foto => foto.nombreTocado !== true)) m('edicion-no-marca-el-nombre', 'se renombró el flujo y alguna foto no lo sabe');
  } else {
    m('accion-de-interfaz-toca-el-flujo', 'cambió el flujo y no es una acción que lo cambie');
  }
  if (hCrece && !empuja) m('pila-crece-sin-cambio', 'se apiló sin que una acción estructural cambiara el flujo');

  // ---- la instantánea nueva es EXACTAMENTE el estado de antes
  if (empuja) {
    const inst = despues.historial[despues.historial.length - 1];
    if (inst) {
      const esperado = huellaDeEstado(fa.nodes, fa.edges, fa.nombreFlujo, antes.sel);
      if (huellaDeEstado(inst.nodes, inst.edges, inst.nombreFlujo ?? '', inst.sel) !== esperado) m('instantanea-distinta-del-estado-previo', 'la foto no es lo que había antes de la acción');
      ctx.instantaneas.set(inst, esperado);
    }
  }

  // ---- los ids nuevos salen del contador y no se repiten en toda la sesión
  if (CREAN_IDS.has(efectiva)) {
    for (const id of [...dn.nuevos, ...de.nuevos]) {
      if (sufijo(id) <= antes.siguiente) m('id-nuevo-no-supera-el-contador', `${id} con el contador en ${antes.siguiente}`);
      if (ctx.memoria.nodos.has(id) || ctx.memoria.aristas.has(id)) m('id-repetido-en-la-sesion', `${id} ya había existido`);
    }
  }

  // ---- el foco que se pide tiene a dónde ir (jamás a `<body>`)
  if (despues.foco !== null && despues.foco !== antes.foco) {
    const f = despues.foco.objetivo;
    const hayId = (id: string) => fd.nodes.some(n => n.id === id);
    let ok = true;
    if (f.k === 'nodo') ok = hayId(f.id);
    else if (f.k === 'mas') ok = f.clave === 'medio' ? (despues.menu?.insertarEn ?? antes.menu?.insertarEn ?? null) !== null : hayId(f.clave.replace(/^(der|tool)-/, ''));
    else if (f.k === 'insignia') ok = fd.edges.some(x => x.id === f.id);
    else if (f.k === 'primerNodo') ok = fd.nodes.length > 0;
    else if (f.k === 'primeraOpcionDisparador') ok = fd.nodes.length === 0;
    else if (f.k === 'primeraOpcionMenu') ok = despues.menu !== null;
    else if (f.k === 'opcionUnSentido') ok = despues.selEdge !== null;
    else ok = despues.sel !== null; // ajustes
    if (!ok) m('foco-sin-destino', jsonDe(f));
  }

  // ---- lo que cambia cada acción, y solo eso
  const hist = antes.historial[antes.historial.length - 1];
  switch (a.k) {
    case 'abrirNodo':
      if (antes.conectando === null && fd.nodes.some(n => n.id === a.id) && (despues.sel !== a.id || despues.selEdge !== null || despues.menu !== null)) m('abrir-no-elige', `sel=${despues.sel}`);
      break;
    case 'abrirEnlace':
      if (despues.selEdge !== a.id || despues.sel !== null || despues.menu !== null || despues.conectando !== null) m('abrir-enlace-no-elige', `selEdge=${despues.selEdge}`);
      break;
    default:
      break;
  }
  if (SOLO_INTERFAZ.has(a.k) || (a.k === 'abrirNodo' && antes.conectando === null)) {
    if (!mismoFlujo) m('accion-de-interfaz-toca-el-flujo', 'cambió el flujo');
    if (despues.historial !== antes.historial) m('accion-de-interfaz-toca-la-pila', 'cambió la pila');
    if (despues.siguiente !== antes.siguiente) m('accion-de-interfaz-gasta-ids', `${antes.siguiente} → ${despues.siguiente}`);
  }

  switch (efectiva) {
    case 'elegirDisparador': {
      if (mismoFlujo || a.k !== 'elegirDisparador') break;
      const nuevo = fd.nodes[fd.nodes.length - 1];
      if (dn.nuevos.length !== 1 || dn.quitados.length > 0 || dn.cambiados.length > 0 || nuevo?.kind !== 'trigger' || nuevo.id !== dn.nuevos[0]) m('crea-lo-que-no-debe', `nuevos ${dn.nuevos.join(',')} cambiados ${jsonDe(dn.cambiados)}`);
      else if (nuevo.tipo !== a.tipo || nuevo.frec !== 'dia' || nuevo.ruta !== 'mi-flujo' || nuevo.app !== 'gmail' || despues.sel !== nuevo.id) m('disparador-mal-armado', jsonDe(nuevo));
      if (de.quitados.length > 0 || de.cambiados.length > 0 || de.nuevos.length > 1) m('conecta-lo-que-no-debe', jsonDe(de));
      else if (de.nuevos.length === 1) {
        const x = fd.edges.find(y => y.id === de.nuevos[0]);
        if (x?.de !== nuevo?.id || x?.tipo !== 'seq') m('conecta-lo-que-no-debe', jsonDe(x));
      }
      // si se había quitado el disparador y quedaron cuadros sin entrada, el nuevo se conecta con el PRIMERO de ellos
      // (el que tiene un paso después; si hay empate, el más a la izquierda). Con ninguno sin entrada, no se conecta con nadie.
      const cabezas = fa.nodes
        .filter(n => !fa.edges.some(y => y.a === n.id))
        .sort((p, q) => Number(fa.edges.some(y => y.tipo === 'seq' && y.de === q.id)) - Number(fa.edges.some(y => y.tipo === 'seq' && y.de === p.id)) || p.x - q.x);
      const primero = cabezas[0];
      if (de.nuevos.length !== (primero ? 1 : 0)) m('disparador-no-se-conecta-como-debe', `cabezas ${cabezas.map(n => n.id).join(',') || 'ninguna'}; conexiones nuevas ${de.nuevos.join(',') || 'ninguna'}`);
      else if (primero && fd.edges.find(y => y.id === de.nuevos[0])?.a !== primero.id) m('disparador-no-se-conecta-como-debe', `esperaba ${primero.id}`);
      break;
    }
    case 'crearDesdeMenu': {
      if (mismoFlujo || a.k !== 'crearDesdeMenu') break;
      const menu = antes.menu;
      const nuevo = fd.nodes[fd.nodes.length - 1];
      if (!menu || !nuevo || dn.nuevos.length !== 1 || dn.quitados.length > 0 || nuevo.id !== dn.nuevos[0]) {
        m('crea-lo-que-no-debe', `menú ${menu !== null} nuevos ${dn.nuevos.join(',')} quitados ${dn.quitados.join(',')}`);
        break;
      }
      if (nuevo.kind !== (a.que === 'agente' ? 'agent' : 'app') || despues.sel !== nuevo.id || despues.menu !== null) m('cuadro-nuevo-mal-armado', jsonDe(nuevo));
      if (nuevo.kind === 'app' && nuevo.nombre !== recortar(String(a.nombreApp ?? '').trim(), LARGO_NOMBRE_APP).trim()) m('cuadro-nuevo-mal-armado', `app «${nuevo.nombre}»`);
      if (nuevo.kind === 'agent') {
        const otros = fa.nodes.flatMap(n => (n.kind === 'agent' ? [n.nombre.trim()] : []));
        if (!/^Agente \d+$/.test(nuevo.nombre) || otros.includes(nuevo.nombre) || nuevo.ia !== 'openai' || nuevo.tarea !== '' || nuevo.instrucciones !== INSTRUCCIONES_AGENTE_NUEVO) m('cuadro-nuevo-mal-armado', jsonDe(nuevo));
      }
      if (nuevo.x % 8 !== 0 || nuevo.y % 8 !== 0 || nuevo.x < 0 || nuevo.x > X_MAX || nuevo.y < 0 || nuevo.y > Y_MAX) m('cuadro-nuevo-fuera-de-la-rejilla', `${nuevo.x},${nuevo.y}`);
      const encima = fd.nodes.find(o => o.id !== nuevo.id && solapa(nuevo, o));
      if (encima) m('cuadro-encimado', `${nuevo.id} (${nuevo.x},${nuevo.y}) cae sobre ${encima.id} (${encima.x},${encima.y})`);
      const viejo = menu.insertarEn === null ? undefined : fa.edges.find(x => x.id === menu.insertarEn);
      if (viejo) {
        // poner en medio: A → nuevo → B en lugar de A → B; solo se corre a la derecha B y lo que sigue
        const sigue = alcanzables(fa.edges, viejo.a, viejo.id);
        const corridos = dn.cambiados.filter(c => !sigue.has(c.id) || c.claves.some(k => k !== 'x' && k !== 'y'));
        if (corridos.length > 0) m('corre-lo-que-no-debe', jsonDe(corridos));
        const nuevas = fd.edges.filter(x => de.nuevos.includes(x.id));
        const okPar =
          de.quitados.length === 1 &&
          de.quitados[0] === viejo.id &&
          de.cambiados.length === 0 &&
          nuevas.length === 2 &&
          nuevas.some(x => x.de === viejo.de && x.a === nuevo.id && x.tipo === 'seq') &&
          nuevas.some(x => x.de === nuevo.id && x.a === viejo.a && x.tipo === 'seq');
        if (!okPar) m('insertar-en-medio-incorrecto', `quitadas ${de.quitados.join(',')} nuevas ${jsonDe(nuevas)}`);
        const A = fd.nodes.find(n => n.id === viejo.de);
        const D = fd.nodes.find(n => n.id === viejo.a);
        // lo que huecoParaInsertar prometió: las dos flechas nuevas van hacia adelante
        if (A && D && !(nuevo.x >= A.x + ANCHO_CUADRO + 60 && D.x >= nuevo.x + ANCHO_CUADRO + 60)) m('insertar-deja-una-flecha-hacia-atras', `A.x=${A.x} nuevo.x=${nuevo.x} B.x=${D.x}`);
        if (despues.siguiente !== antes.siguiente + 2) m('contador-mal-gastado', `${antes.siguiente} → ${despues.siguiente}`);
      } else {
        if (dn.cambiados.length > 0) m('mueve-lo-que-no-debe', jsonDe(dn.cambiados));
        const nueva = fd.edges.find(x => x.id === de.nuevos[0]);
        if (de.quitados.length > 0 || de.cambiados.length > 0 || de.nuevos.length !== 1 || nueva?.de !== menu.ancla || nueva.a !== nuevo.id || nueva.tipo !== menu.tipo) m('crear-conexion-incorrecta', `esperaba ${menu.ancla}>${nuevo.id}:${menu.tipo} y hubo ${jsonDe(nueva)}`);
        if (despues.siguiente !== antes.siguiente + 1) m('contador-mal-gastado', `${antes.siguiente} → ${despues.siguiente}`);
      }
      break;
    }
    case 'intentarConexion': {
      if (mismoFlujo) break;
      const c = antes.conectando;
      const id = a.k === 'abrirNodo' || a.k === 'intentarConexion' ? a.id : '';
      if (!c || dn.nuevos.length > 0 || dn.quitados.length > 0 || dn.cambiados.length > 0 || de.nuevos.length !== 1 || de.quitados.length > 0 || de.cambiados.length > 0) {
        m('conecta-lo-que-no-debe', `nodos ${jsonDe(dn)} conexiones ${jsonDe(de)}`);
        break;
      }
      const x = fd.edges.find(y => y.id === de.nuevos[0]);
      const [d, aa] = c.rol === 'origen' ? [c.ancla, id] : [id, c.ancla];
      if (x?.de !== d || x.a !== aa || x.tipo !== c.tipo || despues.conectando !== null || despues.sel !== c.ancla) m('conectar-conexion-incorrecta', `esperaba ${d}>${aa}:${c.tipo} y hubo ${jsonDe(x)}`);
      if (despues.siguiente !== antes.siguiente + 1) m('contador-mal-gastado', `${antes.siguiente} → ${despues.siguiente}`);
      break;
    }
    case 'cambiarTipoEnlace': {
      if (mismoFlujo || a.k !== 'cambiarTipoEnlace') break;
      const x0 = fa.edges.find(y => y.id === a.id);
      const x1 = fd.edges.find(y => y.id === a.id);
      if (!x0 || !x1 || x0.tipo === a.tipo || x1.tipo !== a.tipo || x1.de !== x0.de || x1.a !== x0.a || de.nuevos.length > 0 || de.quitados.length > 0 || de.cambiados.length !== 1 || de.cambiados[0]?.claves.join() !== 'tipo') {
        m('cambiarTipo-incorrecto', `${jsonDe(x0)} → ${jsonDe(x1)}`);
        break;
      }
      // solo se acomoda el destino (y se le rellena «para qué sirve» si pasa a conversar)
      const malos = dn.cambiados.filter(c => c.id !== x0.a || c.claves.some(k => k !== 'x' && k !== 'y' && k !== 'desc'));
      if (dn.nuevos.length > 0 || dn.quitados.length > 0 || malos.length > 0) m('mueve-lo-que-no-debe', jsonDe(dn));
      const B = fd.nodes.find(n => n.id === x0.a);
      const B0 = fa.nodes.find(n => n.id === x0.a);
      if (B && B0 && B.kind === 'agent' && B0.kind === 'agent' && a.tipo === 'tool' && !(B.desc ?? '').trim()) m('ayudante-sin-descripcion', B.id);
      if (B && B0 && B.kind === 'agent' && B0.kind === 'agent' && B0.desc !== undefined && B0.desc.trim() !== '' && B.desc !== B0.desc) m('pisa-la-descripcion', B.id);
      if (B && B0 && B.kind === 'agent' && B0.kind === 'agent' && B.desc !== B0.desc && B.desc !== DESC_AYUDANTE_POR_DEFECTO) m('descripcion-rara', jsonDe(B.desc));
      if (B && B0 && (B.x !== B0.x || B.y !== B0.y)) {
        const otro = fd.nodes.find(o => o.id !== B.id && solapa(B, o) && !solapa(B0, o));
        if (otro) m('cuadro-encimado', `${B.id} (${B.x},${B.y}) cae sobre ${otro.id}`);
      }
      break;
    }
    case 'quitarEnlace': {
      if (mismoFlujo) break;
      if (dn.nuevos.length > 0 || dn.quitados.length > 0 || dn.cambiados.length > 0 || de.quitados.length !== 1 || de.quitados[0] !== (a.k === 'quitarEnlace' ? a.id : '') || de.nuevos.length > 0 || de.cambiados.length > 0) m('quitarEnlace-incorrecto', jsonDe({ dn, de }));
      break;
    }
    case 'quitarNodo': {
      if (mismoFlujo || a.k !== 'quitarNodo') break;
      const debian = fa.edges.filter(x => x.de === a.id || x.a === a.id).map(x => x.id).sort();
      if (dn.quitados.length !== 1 || dn.quitados[0] !== a.id || dn.nuevos.length > 0 || dn.cambiados.length > 0) m('quitar-no-quita-el-cuadro', jsonDe(dn));
      if (jsonDe([...de.quitados].sort()) !== jsonDe(debian)) m('quitar-no-quita-sus-conexiones', `debían irse ${debian.join(',')} y se fueron ${de.quitados.join(',')}`);
      if (de.cambiados.length > 0) m('quitar-cambia-conexiones', jsonDe(de.cambiados));
      // lo único que puede aparecer son uniones de un solo sentido entre lo de antes y lo de después (o entre el agente principal y lo de después)
      const antesQ = fa.edges.filter(x => x.tipo === 'seq' && x.a === a.id).map(x => x.de);
      const despuesQ = fa.edges.filter(x => x.tipo === 'seq' && x.de === a.id).map(x => x.a);
      const padreQ = fa.edges.find(x => x.tipo === 'tool' && x.a === a.id)?.de;
      const permitidos = new Set<string>();
      for (const p of antesQ) for (const q of despuesQ) permitidos.add(`${p}>${q}`);
      if (padreQ !== undefined && fa.nodes.find(n => n.id === a.id)?.kind === 'agent') for (const q of despuesQ) permitidos.add(`${padreQ}>${q}`);
      for (const id of de.nuevos) {
        const x = fd.edges.find(y => y.id === id);
        if (!x || x.tipo !== 'seq' || !permitidos.has(`${x.de}>${x.a}`)) m('quitar-une-lo-que-no-debe', jsonDe(x));
        else if (fa.edges.some(y => y.tipo === 'seq' && y.de === x.de && y.a === x.a && y.id !== id && !de.quitados.includes(y.id))) m('quitar-une-por-duplicado', jsonDe(x));
      }
      // y TODO lo que había que unir quedó unido: lo de antes con lo de después, y el agente principal con lo que seguía a su IA
      for (const par of permitidos) {
        const [p, q] = par.split('>');
        if (p !== undefined && q !== undefined && p !== q && !fd.edges.some(y => y.tipo === 'seq' && y.de === p && y.a === q)) m('quitar-no-une', `falta ${p} → ${q}`);
      }
      if (despues.sel === a.id) m('quitar-deja-sel', a.id);
      break;
    }
    case 'moverNodo': {
      if (mismoFlujo || a.k !== 'moverNodo') break;
      const p = enRango(a.x, a.y);
      const c = dn.cambiados[0];
      if (dn.nuevos.length > 0 || dn.quitados.length > 0 || dn.cambiados.length !== 1 || c?.id !== a.id || c.claves.some(k => k !== 'x' && k !== 'y') || fd.edges !== fa.edges) m('mover-cambia-lo-que-no-debe', jsonDe({ dn, a }));
      const n = fd.nodes.find(x => x.id === a.id);
      if (n && (n.x !== p.x || n.y !== p.y)) m('mover-no-va-a-la-rejilla', `esperaba ${p.x},${p.y} y quedó ${n.x},${n.y}`);
      break;
    }
    case 'moverConTeclado': {
      if (mismoFlujo || a.k !== 'moverConTeclado') break;
      const paso = a.grande === true ? PASO_TECLA_MAYUS : PASO_TECLA;
      const n0 = fa.nodes.find(x => x.id === a.id);
      const n1 = fd.nodes.find(x => x.id === a.id);
      const dx = a.direccion === 'izquierda' ? -paso : a.direccion === 'derecha' ? paso : 0;
      const dy = a.direccion === 'arriba' ? -paso : a.direccion === 'abajo' ? paso : 0;
      const p = n0 ? enRango(n0.x + dx, n0.y + dy) : null;
      if (dn.nuevos.length > 0 || dn.quitados.length > 0 || dn.cambiados.length !== 1 || fd.edges !== fa.edges || !n1 || !p || n1.x !== p.x || n1.y !== p.y) m('tecla-mueve-mal', jsonDe({ dn, a, p }));
      if (despues.sel !== a.id) m('tecla-no-elige', `sel=${despues.sel}`);
      break;
    }
    case 'editarNodo': {
      if (mismoFlujo || a.k !== 'editarNodo') break;
      const c = dn.cambiados[0];
      const permitidas = Object.keys(a.parche as object);
      if (dn.nuevos.length > 0 || dn.quitados.length > 0 || dn.cambiados.length !== 1 || c?.id !== a.id || c.claves.some(k => !permitidas.includes(k) || k === 'id' || k === 'kind' || k === 'x' || k === 'y') || fd.edges !== fa.edges) m('editar-cambia-lo-que-no-debe', jsonDe({ dn, parche: a.parche }));
      break;
    }
    case 'renombrarFlujo': {
      if (mismoFlujo || a.k !== 'renombrarFlujo') break;
      if (fd.nodes !== fa.nodes || fd.edges !== fa.edges || fd.nombreFlujo !== recortar(a.nombre, LARGO_NOMBRE_FLUJO)) m('renombrar-cambia-lo-que-no-debe', `«${fd.nombreFlujo}»`);
      break;
    }
    case 'limpiar': {
      if (mismoFlujo) break;
      if (fd.nodes.length > 0 || fd.edges.length > 0 || fd.nombreFlujo !== fa.nombreFlujo || despues.sel !== null || despues.selEdge !== null || despues.menu !== null || despues.conectando !== null) m('limpiar-incorrecto', jsonDe(fd));
      break;
    }
    case 'cargarEjemplo': {
      if (mismoFlujo) break;
      if (jsonDe(fd) !== jsonDe({ ...ejemplo(), nombreFlujo: NOMBRE_EJEMPLO }) || despues.sel !== 'a1' || despues.siguiente < Math.max(20, antes.siguiente)) m('cargar-ejemplo-incorrecto', jsonDe(fd.nombreFlujo));
      break;
    }
    case 'cargarFlujo': {
      if (a.k !== 'cargarFlujo') break;
      const abierto = flujoDeAfuera(a.flujo);
      if (abierto === null) {
        if (!mismoFlujo || despues.historial !== antes.historial || despues.aviso?.tipo !== 'mal') m('flujo-roto-se-acepta-o-no-avisa', `${mismoFlujo ? 'sin cambio' : 'cambió el flujo'}; aviso ${despues.aviso?.tipo}`);
        break;
      }
      if (mismoFlujo) {
        m('flujo-valido-se-rechaza', despues.aviso?.texto ?? '');
        break;
      }
      const f = a.flujo;
      // lo que entra es una COPIA ya limpia: lo mandado con los textos recortados a sus topes, ni un objeto compartido con quien lo mandó
      if (jsonDe(fd.nodes) !== jsonDe(abierto.nodes) || jsonDe(fd.edges) !== jsonDe(abierto.edges) || fd.nombreFlujo !== abierto.nombreFlujo) m('cargar-flujo-distinto', 'lo abierto no es lo mandado');
      if (fd.nodes === f.nodes || fd.edges === f.edges || fd.nodes.some((n, i) => n === f.nodes[i]) || fd.edges.some((x, i) => x === f.edges[i])) m('cargar-flujo-comparte-objetos', 'el estado comparte cuadros o conexiones con el flujo de afuera');
      break;
    }
    case 'deshacer': {
      if (a.k !== 'deshacer') break;
      const rechazado = hist === undefined || (a.avisoId !== undefined && hist.avisoId !== a.avisoId);
      if (rechazado) {
        if (!mismoFlujo || despues.historial !== antes.historial) m('deshacer-rechazado-cambia-algo', hist === undefined ? 'sin pila' : 'aviso viejo');
        break;
      }
      const sel = hist.sel !== null && hist.nodes.some(n => n.id === hist.sel) ? hist.sel : null;
      if (huellaDeEstado(fd.nodes, fd.edges, fd.nombreFlujo, hist.sel) !== huellaEsperadaAlDeshacer(hist, fa)) m('deshacer-no-restaura', 'el flujo restaurado no es el de la instantánea (con lo movido o escrito después)');
      if (despues.sel !== sel || despues.selEdge !== null || despues.menu !== null || despues.conectando !== null) m('deshacer-deja-punteros', `sel=${despues.sel} esperaba ${sel}`);
      if (despues.historial.length !== antes.historial.length - 1 || despues.historial.some((x, i) => x !== antes.historial[i])) m('deshacer-gasta-mal-la-pila', `${antes.historial.length} → ${despues.historial.length}`);
      if (despues.siguiente !== antes.siguiente) m('deshacer-toca-el-contador', `${antes.siguiente} → ${despues.siguiente}`);
      if (despues.aviso?.conDeshacer) m('deshacer-ofrece-deshacer', 'el aviso de «Listo» no ofrece Deshacer');
      break;
    }
    default:
      break;
  }
  return out;
}

// ================================================================ 5 · Deshacer, probado en cualquier momento

/**
 * Sin cambiar la corrida, se prueba qué pasaría si la persona pulsara Deshacer AHORA: restaura exactamente lo
 * que la instantánea de arriba guardó el día que se apiló, deja el estado sano, y no gasta más que esa instantánea.
 * También se prueba desde un aviso viejo (no debe hacer nada) y con la pila vacía.
 */
export function sondearDeshacer(e: E, ctx: Contexto): Violacion[] {
  const out: Violacion[] = [];
  const add = (codigo: string, detalle: string) => out.push(vio('deshacer', codigo, detalle));
  const r = ctx.deps.reducir;
  const cima = e.historial[e.historial.length - 1];
  if (cima === undefined) {
    const s = r(e, { k: 'deshacer' });
    if (s.flujo !== e.flujo || s.historial !== e.historial || s.aviso?.tipo !== 'info') add('deshacer-con-pila-vacia', 'cambió algo o no avisó');
    return out;
  }
  const esperado = ctx.instantaneas.get(cima);
  // la foto no se ha movido desde que se apiló
  if (esperado !== undefined && huellaDeEstado(cima.nodes, cima.edges, cima.nombreFlujo ?? '', cima.sel) !== esperado) add('instantanea-mutada', 'la foto de la cima cambió con el tiempo');
  const s = r(e, { k: 'deshacer' });
  const sel = cima.sel !== null && cima.nodes.some(n => n.id === cima.sel) ? cima.sel : null;
  if (huellaDeEstado(s.flujo.nodes, s.flujo.edges, s.flujo.nombreFlujo, cima.sel) !== huellaEsperadaAlDeshacer(cima, e.flujo)) add('deshacer-no-restaura', 'el flujo restaurado no es el de la instantánea (con lo movido o escrito después)');
  if (s.sel !== sel) add('deshacer-no-restaura', `sel ${s.sel} y esperaba ${sel}`);
  if (s.historial.length !== e.historial.length - 1 || s.historial.some((x, i) => x !== e.historial[i])) add('deshacer-gasta-mal-la-pila', `${e.historial.length} → ${s.historial.length}`);
  if (s.siguiente !== e.siguiente) add('deshacer-toca-el-contador', `${e.siguiente} → ${s.siguiente}`);
  if (s.menu !== null || s.conectando !== null || s.selEdge !== null) add('deshacer-deja-punteros', 'quedó un menú, una conexión en curso o una flecha elegida');
  if (ctx.completo || ctx.rng() < 0.3) {
    for (const v of revisarEstado(s, { ...ctx, validadas: new WeakSet() })) add('deshacer-deja-un-estado-roto', `${v.codigo}: ${v.detalle}`);
  }
  // desde un aviso viejo no vale
  const viejo = r(e, { k: 'deshacer', avisoId: (cima.avisoId ?? 0) + 1000 });
  if (viejo.flujo !== e.flujo || viejo.historial !== e.historial) add('deshacer-viejo-aplicado', 'un aviso que ya no era el de la cima deshizo algo');
  return out;
}

// ================================================================ 6 · los selectores y el reductor dicen lo mismo

/** `motivo` que pone la insignia → lo que dice el aviso del reductor. */
const sinNota = (nota: string | null): string => (nota ?? '').replace(/^No se puede: /, '');

/**
 * Lo que la interfaz OFRECE, el reductor lo CUMPLE (y lo que marca como imposible, lo rechaza con el mismo motivo):
 * un destino válido del modo «conectando» se conecta; uno nulo se rechaza con su motivo; todo «+» que se pinta
 * crea lo que ofrece mientras no haya tope; la patita nunca crea una IA; la insignia ofrece cambiar de tipo solo si se puede;
 * «Poner en medio» crea o avisa por qué no; y «Uno que ya está» deja al menos un destino.
 */
export function sondearAcuerdos(e: E, ctx: Contexto): Violacion[] {
  const out: Violacion[] = [];
  const add = (codigo: string, detalle: string) => out.push(vio('acuerdo', codigo, detalle));
  const r = ctx.deps.reducir;
  const vn = vistaNodos(e);
  const nAgentes = e.flujo.nodes.filter(n => n.kind === 'agent').length;
  const nApps = e.flujo.nodes.filter(n => n.kind === 'app').length;
  const base = e.menu ? r(e, { k: 'cerrarMenu' }) : e;

  // 1 · el modo «conectando» (siempre que esté; es barato)
  if (e.conectando) {
    for (const v of vn) {
      if (v.modoConexion !== 'destino' && v.modoConexion !== 'nulo') continue;
      const s = r(e, { k: 'intentarConexion', id: v.id });
      const creo = s.flujo.edges.length === e.flujo.edges.length + 1;
      if (v.modoConexion === 'destino') {
        if (!creo || s.aviso?.tipo !== 'ok') add('destino-valido-no-conecta', `${v.id}: ${s.aviso?.texto ?? 'sin aviso'}`);
      } else if (creo || s.flujo !== e.flujo) add('destino-nulo-conecta', v.id);
      else if (s.aviso?.tipo !== 'mal' || s.aviso.texto !== `${v.motivoNulo ?? ''} Elige otro cuadro, o cancela.`) add('destino-nulo-motivo-distinto', `${v.id}: «${s.aviso?.texto ?? ''}» y la vista dice «${v.motivoNulo ?? ''}»`);
    }
  }

  // lo demás es más caro (crea cuadros, y buscar lugar libre barre la rejilla): sin `completo`, una sola prueba al azar
  const pruebas: (() => void)[] = [];

  // 2 · los «+» que se pintan crean lo que ofrecen
  for (const v of vn.filter(n => n.stubDer || n.asaDer)) {
    for (const que of ['app', 'agente'] as const) {
      pruebas.push(() => {
        const s1 = r(base, { k: 'abrirMenu', ancla: v.id, tipo: 'seq' });
        if (s1.menu?.ancla !== v.id) return add('mas-no-abre-el-menu', v.id);
        const s2 = r(s1, que === 'app' ? { k: 'crearDesdeMenu', que, nombreApp: 'Gmail' } : { k: 'crearDesdeMenu', que });
        const creo = s2.flujo.nodes.length === e.flujo.nodes.length + 1;
        const tope = que === 'app' ? nApps >= TOPE_APPS : nAgentes >= TOPE_AGENTES;
        if (tope === creo) add(tope ? 'tope-ignorado' : 'mas-ofrecido-rechazado', `${v.id} con «${que}»: ${s2.aviso?.texto ?? 'sin aviso'}`);
      });
    }
  }
  for (const v of vn.filter(n => n.patita)) {
    pruebas.push(() => {
      const s1 = r(base, { k: 'abrirMenu', ancla: v.id, tipo: 'tool' });
      if (s1.menu?.ancla !== v.id || s1.menu.paso !== 'app') return add('patita-no-abre-la-lista-de-apps', v.id);
      const s2 = r(s1, { k: 'crearDesdeMenu', que: 'app', nombreApp: 'Notion' });
      if ((s2.flujo.nodes.length === e.flujo.nodes.length + 1) === nApps >= TOPE_APPS) add(nApps >= TOPE_APPS ? 'tope-ignorado' : 'patita-rechaza-una-app', `${v.id}: ${s2.aviso?.texto ?? 'sin aviso'}`);
      const s3 = r(s1, { k: 'crearDesdeMenu', que: 'agente' });
      if (s3.flujo !== e.flujo || s3.aviso?.tipo !== 'mal') add('patita-crea-una-ia', v.id);
    });
  }

  // 3 · el editor de la flecha: lo que marca como imposible se rechaza con el mismo motivo, lo demás se hace
  const ve = vistaEnlace(e);
  if (ve) {
    pruebas.push(() => {
      const otra = ve.esUno ? ve.doble : ve.uno;
      const s = r(e, { k: 'cambiarTipoEnlace', id: ve.id, tipo: otra.tipo });
      const cambio = s.flujo !== e.flujo;
      if (otra.noElegible === cambio) add('enlace-selector-y-reductor-discrepan', `${ve.id} → ${otra.tipo}: la vista dice noElegible=${otra.noElegible}`);
      else if (!cambio && s.aviso?.texto !== T.noSePuedeCambiar(sinNota(otra.nota)).texto) add('enlace-motivo-distinto', `«${s.aviso?.texto ?? ''}» y la vista dice «${otra.nota ?? ''}»`);
    });
    // «Poner un cuadro en medio»: o se crea, o se avisa por qué no
    const x = e.flujo.edges.find(y => y.id === ve.id);
    if (ve.puedeMedio && x) {
      for (const que of ['app', 'agente'] as const) {
        pruebas.push(() => {
          const s1 = r(base, { k: 'abrirMenu', ancla: x.de, tipo: 'seq', insertarEn: x.id });
          if (s1.menu?.insertarEn !== x.id) return add('medio-no-abre-el-menu', x.id);
          const s2 = r(s1, que === 'app' ? { k: 'crearDesdeMenu', que, nombreApp: 'Slack' } : { k: 'crearDesdeMenu', que });
          const creo = s2.flujo.nodes.length === e.flujo.nodes.length + 1;
          const tope = que === 'app' ? nApps >= TOPE_APPS : nAgentes >= TOPE_AGENTES;
          const motivos = [T.sinLugarEnMedio().texto, que === 'app' ? T.topeApps().texto : T.topeAgentes().texto];
          if (tope && creo) add('tope-ignorado', `en medio con «${que}»`);
          else if (!creo && !motivos.includes(s2.aviso?.texto ?? '')) add('insertar-rechazado-sin-motivo', `${x.id} con «${que}»: ${s2.aviso?.texto ?? 'sin aviso'}`);
        });
      }
    }
  }

  // 4 · «Uno que ya está en el lienzo» deja al menos un destino
  const vm = vistaMenu(e);
  if (vm && (vm.opciones.some(o => o.id === 'existente') || vm.hayExistente)) {
    pruebas.push(() => {
      const s = r(e, { k: 'iniciarConexion', ancla: vm.ancla, rol: 'origen', tipo: vm.tipo });
      if (s.conectando === null || !vistaNodos(s).some(n => n.modoConexion === 'destino')) add('existente-sin-destinos', `${vm.ancla} ${vm.tipo}`);
    });
  }

  if (ctx.completo) for (const p of pruebas) p();
  else if (pruebas.length > 0) elegir(ctx.rng, pruebas)();
  return out;
}

// ================================================================ 7 · puedeEnlazar contra los invariantes

const MOTIVOS_DE_PUEDE_ENLAZAR: readonly RegExp[] = [
  /^Ese cuadro ya no existe\.$/,
  /^Un cuadro no se puede conectar consigo mismo\.$/,
  /^Esos dos cuadros ya están conectados así\.$/,
  /^Nada puede ir antes de un disparador: él es el inicio del flujo\.$/,
  /^«.*» es herramienta de un agente: no puede tener pasos después\.$/,
  /^«.*» (conversa con otra IA|es herramienta de un agente): no puede ser un paso del flujo\.$/,
  /^Eso haría un círculo: el flujo volvería a empezar solo\.$/,
  /^Solo un agente de IA puede tener herramientas o conversar con otra IA\.$/,
  /^«.*» ya es un paso del flujo \(le llega una conexión\): no puede ser también la IA con la que conversa «.*»\.$/,
  /^«.*» ya es un paso del flujo: no puede ser también herramienta\. Agrega otro cuadro igual\.$/,
  /^«.*» ya es herramienta o ayudante de otro agente\.$/,
  /^Un agente no puede conversar con quien ya conversa con él\.$/,
];

/**
 * El oráculo de `puedeEnlazar` (`diferencial` del fuzz): si dice que sí, el grafo con esa conexión de más cumple
 * todos los invariantes. Si dice que no, el motivo es uno de los 12 de la tabla. (Que rechace algo que no
 * rompería nada es más estricto que los invariantes, no un error: se cuenta en `suaves`.)
 */
export function revisarDiferencial(e: E, ctx: Contexto): Violacion[] {
  const out: Violacion[] = [];
  const { nodes, edges } = e.flujo;
  if (nodes.length < 2) return out;
  const pares: [string, string, TipoArista][] = [];
  for (const A of nodes) for (const B of nodes) for (const t of ['seq', 'tool'] as const) pares.push([A.id, B.id, t]);
  const elegidos = ctx.completo ? pares : Array.from({ length: Math.min(10, pares.length) }, () => elegir(ctx.rng, pares));
  for (const [de, a, tipo] of elegidos) {
    let r: ReturnType<typeof puedeEnlazar>;
    try {
      r = puedeEnlazar(e.flujo, de, a, tipo);
    } catch (x) {
      out.push(vio('diferencial', 'puedeEnlazar-lanza', `${de}→${a}:${tipo} ${mensaje(x)}`));
      continue;
    }
    const hipotesis = violacionesDelGrafo(nodes, [...edges, { id: '__h', de, a, tipo }]);
    cuenta(ctx.cobertura, 'diferencial: pares evaluados');
    if (r.ok) {
      cuenta(ctx.cobertura, 'diferencial: puedeEnlazar dijo sí');
      if (hipotesis.length > 0) out.push(vio('diferencial', 'puedeEnlazar-acepta-lo-invalido', `${de}→${a}:${tipo} deja ${hipotesis.map(v => v.codigo).join(',')}`));
    } else {
      cuenta(ctx.cobertura, 'diferencial: puedeEnlazar dijo no');
      if (!MOTIVOS_DE_PUEDE_ENLAZAR.some(re => re.test(r.motivo))) out.push(vio('diferencial', 'puedeEnlazar-motivo-desconocido', r.motivo));
      if (hipotesis.length === 0) cuenta(ctx.suaves, `puedeEnlazar rechaza lo que no rompería nada (${tipo})`);
    }
  }
  return out;
}

// ================================================================ 8 · cobertura y colocación «objetivo»

/** Cuenta los casos difíciles que alcanzó la corrida y lo que NO es invariante duro (informe 04 §8.3). No devuelve violaciones. */
export function contarCasos(antes: E, a: A, despues: E, ctx: Contexto): void {
  const c = ctx.cobertura;
  const s = ctx.suaves;
  const fa = antes.flujo;
  const fd = despues.flujo;
  cuenta(c, `acción: ${a.k}`);
  const cambio = fd !== fa;
  const efectiva = a.k === 'abrirNodo' && antes.conectando !== null ? 'intentarConexion' : a.k;
  if (despues.aviso !== antes.aviso && despues.aviso?.tipo === 'mal') cuenta(c, `rechazo con aviso: ${a.k}`);
  if (a.k === 'crearDesdeMenu') {
    if (cambio) {
      const n = fd.nodes[fd.nodes.length - 1];
      cuenta(c, `crearDesdeMenu creó ${n?.kind === 'agent' ? 'un agente' : 'una app'}`);
      if (antes.menu?.insertarEn) cuenta(c, 'poner en medio con éxito');
      if (antes.menu?.tipo === 'tool') cuenta(c, 'herramienta creada por la patita');
    } else cuenta(c, 'crearDesdeMenu sin crear nada');
  }
  if (efectiva === 'intentarConexion') cuenta(c, cambio ? 'conectar con uno que ya está: éxito' : 'conectar con uno que ya está: rechazado');
  if (a.k === 'cambiarTipoEnlace') {
    const x1 = fd.edges.find(y => y.id === a.id);
    const x0 = fa.edges.find(y => y.id === a.id);
    if (x0 && x1 && x0.tipo !== x1.tipo) cuenta(c, `cambiarTipoEnlace con cambio real (${x0.tipo} → ${x1.tipo})`);
    else if (x0) cuenta(c, 'cambiarTipoEnlace rechazado o igual');
  }
  if (a.k === 'quitarNodo' && cambio) {
    const q = fa.nodes.find(n => n.id === a.id);
    cuenta(c, `quitar un ${q?.kind ?? '?'}`);
    if (fa.edges.some(x => x.tipo === 'tool' && x.de === a.id)) cuenta(c, 'quitar un agente con herramientas');
    if (fd.edges.length > fa.edges.length - fa.edges.filter(x => x.de === a.id || x.a === a.id).length) cuenta(c, 'quitar uniendo lo de antes con lo de después');
  }
  if (a.k === 'quitarEnlace' && cambio) cuenta(c, 'quitarEnlace con éxito');
  if (a.k === 'deshacer' && despues.historial.length < antes.historial.length) cuenta(c, 'Deshacer real');
  if (a.k === 'deshacer' && a.avisoId !== undefined && cambio === false && antes.historial.length > 0) cuenta(c, 'Deshacer desde un aviso viejo (rechazado)');
  if (a.k === 'cargarFlujo') cuenta(c, cambio ? 'cargarFlujo aceptado' : 'cargarFlujo rechazado');
  if (despues.historial.length === MAX_HISTORIAL) cuenta(c, 'pila llena (20)');
  if (antes.historial.length > 0 && cambio && CONTINUAS.has(a.k) && despues.historial.length === antes.historial.length) cuenta(c, 'una edición dejó la pila intacta');
  if (a.k === 'deshacer' && despues.historial.length < antes.historial.length && (antes.historial[antes.historial.length - 1]?.tocados?.length ?? 0) > 0) cuenta(c, 'Deshacer conservó lo movido o escrito después');
  const ag = fd.nodes.filter(n => n.kind === 'agent').length;
  const ap = fd.nodes.filter(n => n.kind === 'app').length;
  if (ag >= TOPE_AGENTES) cuenta(c, 'estado con 4 agentes (tope)');
  if (ap >= TOPE_APPS) cuenta(c, 'estado con 8 apps (tope)');
  if (fd.nodes.length >= 10) cuenta(c, 'estado con 10 o más cuadros');
  if (fd.nodes.length >= TOPE_CUADROS) cuenta(c, 'estado con 13 cuadros');
  const padre = new Map<string, string>();
  for (const x of fd.edges) if (x.tipo === 'tool') padre.set(x.a, x.de);
  if (fd.nodes.some(n => n.kind === 'agent' && padre.has(n.id))) cuenta(c, 'hay un ayudante (una IA que conversa con otra)');
  if (fd.nodes.some(n => n.kind === 'app' && padre.has(n.id))) cuenta(c, 'hay una herramienta (app colgada de un agente)');
  if ([...padre.values()].some(p => padre.has(p))) cuenta(c, 'herramientas anidadas (el padre también cuelga de alguien)');
  const seqs = fd.edges.filter(x => x.tipo === 'seq');
  if (seqs.some(x => seqs.filter(y => y.de === x.de).length > 1)) cuenta(c, 'abanico de pasos (un cuadro con 2 o más siguientes)');
  if (seqs.some(x => seqs.filter(y => y.a === x.a).length > 1)) cuenta(c, 'confluencia (un cuadro con 2 o más anteriores)');
  if (fd.nodes.length > 0 && !fd.nodes.some(n => n.kind === 'trigger')) cuenta(c, 'flujo sin disparador (se quitó con la ×)');
  if (despues.conectando) cuenta(c, 'modo conectando abierto');
  if (despues.menu?.insertarEn) cuenta(c, 'menú de poner en medio abierto');

  // ---- un trazo que sale del dibujo y se recorta: tampoco es un invariante duro, se cuenta
  if (cambio || despues.menu !== antes.menu) {
    const lienzo = vistaLienzo(despues);
    for (const f of vistaFlechas(despues)) {
      const n = (f.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      const [x0, y0, x1, y1, x2, y2, x3, y3] = n;
      if (n.length !== 8 || x0 === undefined || y0 === undefined || x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined || x3 === undefined || y3 === undefined) continue;
      let fuera = false;
      for (let i = 0; i <= 20 && !fuera; i += 1) {
        const t = i / 20;
        const u = 1 - t;
        const px = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
        const py = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
        fuera = px < -1 || px > lienzo.ancho + 1 || py > lienzo.alto + 1;
      }
      if (fuera) {
        cuenta(s, 'trazo que sale del lienzo y se recortaría');
        break;
      }
    }
  }

  // ---- colocación «objetivo»: NO son invariantes duros (informe 04 §8.3). Se cuenta cuántas veces una acción automática dejó la flecha mal
  if (['crearDesdeMenu', 'cambiarTipoEnlace', 'elegirDisparador'].includes(a.k) || efectiva === 'intentarConexion') {
    const antesE = new Map(fa.edges.map(x => [x.id, x] as const));
    const auto = a.k !== 'abrirNodo' && a.k !== 'intentarConexion';
    for (const x of fd.edges) {
      const p = antesE.get(x.id);
      if (p && p.tipo === x.tipo) continue;
      const A = fd.nodes.find(n => n.id === x.de);
      const B = fd.nodes.find(n => n.id === x.a);
      if (!A || !B) continue;
      const pre = auto ? '' : 'al conectar, ';
      if (x.tipo === 'seq' && !(B.x >= A.x + ANCHO_CUADRO + 60)) cuenta(s, `${pre}paso que no queda a la derecha de su origen`);
      if (x.tipo === 'tool' && B.kind === 'agent' && !(B.x >= A.x + ANCHO_CUADRO + 60)) cuenta(s, `${pre}ayudante que no queda a la derecha de su agente`);
      if (x.tipo === 'tool' && B.kind === 'app' && !(B.y >= A.y + ALTO_CUADRO + 16)) cuenta(s, `${pre}herramienta que no cuelga debajo de su agente`);
    }
  }
}
