// Preguntas pequeñas sobre el grafo: quién es el padre de un cuadro, quién es ayudante, cuál es la
// raíz. Puras: reciben las listas de cuadros y conexiones y no modifican nada. Más abajo (sección
// «reglas de conexión») están `puedeEnlazar`, `hayCiclo`, `candidatos` e `invariantesDelGrafo`;
// se agregaron después sin cambiar lo de aquí. Portado de Main.dc.html:901-969, 981 y 1634 y del
// fuzz del mockup (revision/fuzz/fuzz.cjs: `invGrafo`, `hayCiclo`).
//
// Vocabulario: el PADRE de un cuadro es el agente que lo tiene por una conexión `tool` (ida y
// vuelta). Un cuadro con padre es una «herramienta» si es app, o un «ayudante» si es otro agente
// (una IA que conversa con la principal).

import { TOPE_AGENTES, TOPE_APPS, TOPE_DISPARADORES, VUELTAS_MAX, X_MAX, Y_MAX } from './datos/constantes';
import { MOTIVO_SOLO_AGENTES_TIENEN_HERRAMIENTAS } from './textos';
import { esObjeto, tituloDe } from './texto';
import type { Arista, Conectando, Nodo, NodoAgente, Resultado, TipoArista } from './tipos';

/** ¿Algún agente tiene a este cuadro por una conexión `tool`? (herramienta o ayudante) */
export function tienePadre(edges: readonly Arista[], id: string): boolean {
  return edges.some(e => e.tipo === 'tool' && e.a === id);
}

/** ¿Este cuadro entra o sale de alguna conexión de un solo sentido (`seq`)? Es lo que impide que una app que ya es un paso sea herramienta. */
export function tocaSeq(edges: readonly Arista[], id: string): boolean {
  return edges.some(e => e.tipo === 'seq' && (e.de === id || e.a === id));
}

/** El id del agente del que este cuadro es herramienta o ayudante, o null si no cuelga de nadie. */
export function padreDe(edges: readonly Arista[], id: string): string | null {
  return edges.find(e => e.tipo === 'tool' && e.a === id)?.de ?? null;
}

/**
 * El agente principal de una cadena de ayudantes: sube por los padres mientras padre e hijo sean
 * agentes (con un tope de vueltas, por si el grafo trajera un círculo). Un cuadro que no es ayudante
 * es su propia raíz. Lo que SIGUE a un ayudante sale de su raíz: en n8n solo el agente principal da la respuesta.
 * Si por error un agente tuviera dos padres (un flujo así no cumple `invariantesDelGrafo`), manda el ÚLTIMO en el orden
 * de las conexiones: es el desempate de `hayCiclo` y del exportador, así las tres cuentas dan la misma raíz.
 */
export function raiz(nodes: readonly Nodo[], edges: readonly Arista[], id: string): string {
  const agentes = new Set(nodes.filter(n => n.kind === 'agent').map(n => n.id));
  let x = id;
  for (let i = 0; i < VUELTAS_MAX; i += 1) {
    let padre: Arista | undefined;
    for (const e of edges) if (e.tipo === 'tool' && e.a === x && agentes.has(e.de) && agentes.has(x)) padre = e;
    if (!padre) break;
    x = padre.de;
  }
  return x;
}

/** ¿Es un agente que conversa con otro agente (tiene como padre a un agente)? Los que cuelgan de una app o de nadie no. */
export function esAyudante(nodes: readonly Nodo[], edges: readonly Arista[], id: string): boolean {
  const esAgente = (i: string | null) => i !== null && nodes.some(n => n.id === i && n.kind === 'agent');
  return esAgente(id) && esAgente(padreDe(edges, id));
}

/** Los agentes que conversan con este (sus ayudantes), en el orden de las conexiones. */
export function ayudantesDe(nodes: readonly Nodo[], edges: readonly Arista[], id: string): NodoAgente[] {
  const ayudantes: NodoAgente[] = [];
  for (const e of edges) {
    if (e.tipo !== 'tool' || e.de !== id) continue;
    const hijo = nodes.find(n => n.id === e.a);
    if (hijo && hijo.kind === 'agent') ayudantes.push(hijo);
  }
  return ayudantes;
}

// ================================================================ reglas de conexión

/**
 * Lo mínimo que las reglas necesitan del flujo: los cuadros y las conexiones. Un `Flujo` lo
 * cumple tal cual (el reductor pasa `estado.flujo`), y también un `{ nodes, edges }` suelto
 * (para probar «¿cómo quedaría sin esta conexión?»).
 */
export interface Grafo {
  readonly nodes: readonly Nodo[];
  readonly edges: readonly Arista[];
}

/** El mismo grafo con una conexión de más (hipotética: no se guarda en ningún lado). */
function conArista(grafo: Grafo, de: string, a: string, tipo: TipoArista): Grafo {
  return { nodes: grafo.nodes, edges: [...grafo.edges, { id: '_', de, a, tipo }] };
}

/**
 * ¿Se puede llegar de `desde` a `hasta` siguiendo SOLO conexiones de un solo sentido (`seq`)?
 * `desde === hasta` cuenta como que sí. No la usa ninguna regla: queda para probar y para quien
 * quiera preguntar «¿esto viene después de aquello?». Portada de `alcanza` (Main:903-914).
 */
export function alcanza(edges: readonly Arista[], desde: string, hasta: string): boolean {
  const visto = new Set<string>();
  const pila = [desde];
  for (let id = pila.pop(); id !== undefined; id = pila.pop()) {
    if (id === hasta) return true;
    if (visto.has(id)) continue;
    visto.add(id);
    for (const e of edges) if (e.tipo === 'seq' && e.de === id) pila.push(e.a);
  }
  return false;
}

/**
 * ¿Hay un círculo en el orden de las conexiones `seq`, donde lo que sale de un ayudante (una IA que
 * conversa con otra) cuenta como salido de su agente principal (`raiz`)? Así «a2 conversa con a1 y
 * existe a2 → a1» es un círculo: la raíz de a2 es a1, y a1 → a1 se cierra sola. Es el chequeo REAL
 * que usa `puedeEnlazar`. Busca en todo el grafo (recorrido en profundidad, sin recursión).
 * Portada de `hayCiclo` (Main:916-932).
 */
export function hayCiclo(grafo: Grafo): boolean {
  const { nodes, edges } = grafo;
  const kindDe = new Map(nodes.map(n => [n.id, n.kind] as const));
  // el padre de un agente es el agente que lo tiene por `tool`; si por error hubiera dos, manda el último
  const padre = new Map<string, string>();
  for (const e of edges) {
    if (e.tipo === 'tool' && kindDe.get(e.de) === 'agent' && kindDe.get(e.a) === 'agent') padre.set(e.a, e.de);
  }
  const raizDe = (id: string): string => {
    let x = id;
    for (let i = 0; i < VUELTAS_MAX; i += 1) {
      const p = padre.get(x);
      if (p === undefined) break;
      x = p;
    }
    return x;
  };
  const sale = new Map<string, string[]>();
  for (const e of edges) {
    if (e.tipo !== 'seq') continue;
    const u = raizDe(e.de);
    const lista = sale.get(u);
    if (lista) lista.push(e.a);
    else sale.set(u, [e.a]);
  }
  return buscaCiclo(
    nodes.map(n => n.id),
    sale,
  );
}

/**
 * ¿Hay un círculo si se cuentan TODAS las conexiones (`seq` y `tool`) como flechas de `de` a `a`?
 * Es más estricta que `hayCiclo`: es la que revisa `invariantesDelGrafo` (la del fuzz del mockup).
 * Siempre que las conexiones tengan sus dos extremos, `hayCiclo` ⇒ `hayCicloTotal` (un paso que sale
 * de un ayudante se cuenta como salido de su agente, y ese camino existe en este grafo). Las
 * conexiones con un extremo que no existe se ignoran (esas las reporta otro invariante).
 */
export function hayCicloTotal(grafo: Grafo): boolean {
  const ids = grafo.nodes.map(n => n.id);
  const existentes = new Set(ids);
  return buscaCiclo(ids, adyacencia(grafo.edges.filter(e => existentes.has(e.de) && existentes.has(e.a))));
}

function adyacencia(edges: readonly Pick<Arista, 'de' | 'a'>[]): Map<string, string[]> {
  const sale = new Map<string, string[]>();
  for (const e of edges) {
    const lista = sale.get(e.de);
    if (lista) lista.push(e.a);
    else sale.set(e.de, [e.a]);
  }
  return sale;
}

/**
 * ¿Hay un círculo en este grafo dirigido? Colores 1 (en la pila) / 2 (terminado), recorrido en
 * profundidad con pila propia: el orden de visita es el mismo del mockup (empieza por cada id en
 * orden y sigue los vecinos en el orden en que se agregaron), así que el resultado también.
 */
function buscaCiclo(ids: readonly string[], sale: ReadonlyMap<string, readonly string[]>): boolean {
  const color = new Map<string, 1 | 2>();
  for (const inicio of ids) {
    if (color.has(inicio)) continue;
    color.set(inicio, 1);
    const pila: { id: string; i: number }[] = [{ id: inicio, i: 0 }];
    for (let tope = pila[pila.length - 1]; tope; tope = pila[pila.length - 1]) {
      const vecinos = sale.get(tope.id) ?? [];
      const w = vecinos[tope.i];
      if (w === undefined) {
        color.set(tope.id, 2);
        pila.pop();
        continue;
      }
      tope.i += 1;
      const c = color.get(w);
      if (c === 1) return true;
      if (c === undefined) {
        color.set(w, 1);
        pila.push({ id: w, i: 0 });
      }
    }
  }
  return false;
}

const no = (motivo: string): Resultado => ({ ok: false, motivo });

/**
 * ¿Se puede conectar `de` → `a` con este tipo de conexión? `seq` = un solo sentido (lo que sigue);
 * `tool` = ida y vuelta (un agente consulta una app o conversa con otra IA y recibe lo que
 * responde). Si no se puede, el `motivo` está escrito para la persona y sale tal cual en el aviso.
 *
 * Las 12 reglas se evalúan en este orden y GANA LA PRIMERA que falla (el orden es parte del
 * contrato: cambia qué motivo ve la persona):
 *  1. alguno de los dos cuadros no existe · 2. es el mismo cuadro · 3. ya están conectados así ·
 *  4. el destino es un disparador · y luego, según el tipo:
 *  `seq`: 5. el origen es herramienta/ayudante y no es agente · 6. el destino es herramienta o
 *  ayudante · 7. se cierra un círculo (`hayCiclo`).
 *  `tool`: 8. el origen no es agente · 9. el destino ya es un paso del flujo (si es agente: le
 *  llega un `seq`; si es app: toca algún `seq`) · 10. el destino ya tiene padre · 11. el destino
 *  es antecesor del origen por la cadena de padres · 12. el destino es agente y se cierra un círculo.
 *
 * NO incluye «por la patita solo van apps» (ver `soloAppsPorLaPatita`): `puedeEnlazar(…, 'tool')`
 * sí acepta agente → agente, que es la vía «Ida y vuelta» del editor de la flecha.
 * Portada de `puedeEnlazar` (Main:935-964).
 */
export function puedeEnlazar(grafo: Grafo, de: string, a: string, tipo: TipoArista): Resultado {
  const { nodes, edges } = grafo;
  const nd = nodes.find(n => n.id === de);
  const na = nodes.find(n => n.id === a);
  if (!nd || !na) return no('Ese cuadro ya no existe.');
  if (de === a) return no('Un cuadro no se puede conectar consigo mismo.');
  if (edges.some(e => e.tipo === tipo && e.de === de && e.a === a)) {
    return no('Esos dos cuadros ya están conectados así.');
  }
  if (na.kind === 'trigger') return no('Nada puede ir antes de un disparador: él es el inicio del flujo.');
  if (tipo === 'seq') {
    if (tienePadre(edges, de) && nd.kind !== 'agent') {
      return no(`«${tituloDe(nd)}» es herramienta de un agente: no puede tener pasos después.`);
    }
    if (tienePadre(edges, a)) {
      const quien = na.kind === 'agent' ? 'conversa con otra IA' : 'es herramienta de un agente';
      return no(`«${tituloDe(na)}» ${quien}: no puede ser un paso del flujo.`);
    }
    if (hayCiclo(conArista(grafo, de, a, 'seq'))) return no('Eso haría un círculo: el flujo volvería a empezar solo.');
    return { ok: true };
  }
  if (nd.kind !== 'agent') return no(MOTIVO_SOLO_AGENTES_TIENEN_HERRAMIENTAS);
  if (na.kind === 'agent') {
    if (edges.some(e => e.tipo === 'seq' && e.a === a)) {
      return no(
        `«${tituloDe(na)}» ya es un paso del flujo (le llega una conexión): no puede ser también la IA con la que conversa «${tituloDe(nd)}».`,
      );
    }
  } else if (tocaSeq(edges, a)) {
    return no(`«${tituloDe(na)}» ya es un paso del flujo: no puede ser también herramienta. Agrega otro cuadro igual.`);
  }
  if (tienePadre(edges, a)) return no(`«${tituloDe(na)}» ya es herramienta o ayudante de otro agente.`);
  // si `a` es antecesor de `de` (por la cadena de padres), `de` ya conversa con él: no puede ser al revés
  let p: string | null = de;
  for (let vueltas = 0; p !== null && vueltas < VUELTAS_MAX; vueltas += 1) {
    if (p === a) return no('Un agente no puede conversar con quien ya conversa con él.');
    p = padreDe(edges, p);
  }
  if (na.kind === 'agent' && hayCiclo(conArista(grafo, de, a, 'tool'))) {
    return no('Eso haría un círculo: el flujo volvería a empezar solo.');
  }
  return { ok: true };
}

/** Los cuadros que ya están en el lienzo y a los que `desde` se podría conectar con este tipo (los mismos objetos, en el orden del lienzo). */
export function candidatos(grafo: Grafo, desde: string, tipo: TipoArista): Nodo[] {
  return grafo.nodes.filter(n => n.id !== desde && puedeEnlazar(grafo, desde, n.id, tipo).ok);
}

/**
 * La regla «por la patita solo van apps», que NO está en `puedeEnlazar`: devuelve `true` si esta
 * conexión se debe RECHAZAR por eso. Pasa cuando es de ida y vuelta (`tool`), se empezó desde el
 * agente (`rol: 'origen'`: el cuadro al que se llega es el que va en la patita) y el cuadro de
 * destino no es una app (o no existe). Con `rol: 'destino'` (se empezó desde el cuadro que va a
 * colgar) nunca se rechaza por esto. Hay que aplicarla ADEMÁS de `puedeEnlazar` en las tres
 * puertas: conectar con un cuadro que ya está en el lienzo, pintar los destinos válidos, y
 * crear desde el menú de la patita (donde `destino` es el cuadro que se iba a crear).
 */
export function soloAppsPorLaPatita(
  tipo: TipoArista,
  rol: Conectando['rol'],
  destino: { readonly kind: Nodo['kind'] } | null | undefined,
): boolean {
  return tipo === 'tool' && rol === 'origen' && destino?.kind !== 'app';
}

// ================================================================ invariantes de un flujo

/**
 * Los códigos de lo que puede estar mal en un flujo. Estables: las pruebas, el reductor y el
 * borrador los comparan por nombre. (Los cuatro primeros son de forma: un flujo que llega de
 * afuera —borrador, Asistente— puede no ser ni siquiera una lista de cuadros.)
 */
export const CODIGOS_VIOLACION = [
  'nodos-no-es-lista',
  'aristas-no-es-lista',
  'nodo-malformado',
  'arista-malformada',
  'ids-nodos-duplicados',
  'ids-aristas-duplicados',
  'arista-huerfana',
  'arista-a-si-mismo',
  'arista-tipo-invalido',
  'arista-duplicada',
  'llega-al-disparador',
  'herramienta-de-no-agente',
  'herramienta-con-varios-padres',
  'ayudante-con-paso-entrante',
  'herramienta-y-paso',
  'ciclo-de-pasos',
  'ciclo-de-herramientas',
  'ciclo-mixto',
  'varios-disparadores',
  'tope-agentes',
  'tope-apps',
  'caja-no-finita',
  'caja-fuera-del-lienzo',
] as const;

/** Uno de los códigos de `CODIGOS_VIOLACION`. */
export type CodigoViolacion = (typeof CODIGOS_VIOLACION)[number];

/** Una cosa que está mal en un flujo. El `detalle` lleva ids para depurar: NO es un texto para la persona. */
export interface Violacion {
  codigo: CodigoViolacion;
  detalle: string;
}

const esTexto = (v: unknown): v is string => typeof v === 'string' && v !== '';

/**
 * Un valor desconocido como texto para un `detalle`, SIN poder lanzar: `String(v)` truena con un objeto cuyo `toString` no es
 * una función (`{"toString":null}` es JSON válido). Un texto se queda como está; un número, un booleano o `null` se escriben
 * como siempre; un objeto, una lista o una función se nombran por su tipo.
 */
function comoTexto(v: unknown): string {
  if (typeof v === 'object' && v !== null) return Array.isArray(v) ? 'lista' : 'objeto';
  if (typeof v === 'function') return 'función';
  return String(v);
}

/**
 * Todo lo que viola los invariantes de un flujo, en un orden fijo (el de `invGrafo` del fuzz del
 * mockup). Lista vacía = el flujo es válido. Acepta CUALQUIER cosa en tiempo de ejecución (un JSON
 * recién leído, por ejemplo): lo que no es una lista o un cuadro bien formado se reporta, no truena.
 *
 * Los invariantes (informe 04 §1.5):
 *  · ids de cuadros únicos e ids de conexiones únicos;
 *  · ninguna conexión huérfana (los dos extremos existen), ni a sí misma, ni de tipo raro, ni repetida
 *    (mismo tipo, mismo origen, mismo destino);
 *  · nada llega a un disparador;
 *  · una conexión `tool` sale siempre de un agente;
 *  · un cuadro tiene a lo sumo UN padre `tool`;
 *  · un ayudante (agente con padre) no recibe `seq`; una herramienta (app con padre) no toca ningún `seq`;
 *  · sin círculos: ni solo con `seq`, ni solo con `tool`, ni mezclando las dos;
 *  · a lo sumo 1 disparador (0 es válido: se quitó con la ×), 4 agentes y 8 apps;
 *  · cada cuadro con `x` e `y` finitos y entre 0 y 2400 (la rejilla de 8 NO se exige).
 *
 * Qué NO revisa: los campos de cada cuadro (nombres, `ia`, `tipo`…); eso lo normaliza quien lee el
 * flujo, y el catálogo y el exportador tienen valores de reserva para lo desconocido.
 */
export function violacionesDelGrafo(nodes: unknown, edges: unknown): Violacion[] {
  return revisarGrafo(nodes, edges);
}

/**
 * Lo mismo que `violacionesDelGrafo`, como texto: cada elemento es `<código>: <detalle>` (el código
 * es uno de `CODIGOS_VIOLACION`; ver también `codigoDeViolacion`). Lista vacía = el flujo es válido.
 * Es la ÚNICA validación de grafo de cualquier flujo que entre desde fuera (borrador, Asistente,
 * ejemplos): quien lo use solo necesita `invariantesDelGrafo(nodes, edges).length === 0` y, para
 * explicarlo, mostrar un aviso propio (el texto de aquí es para registros y pruebas).
 */
export function invariantesDelGrafo(nodes: unknown, edges: unknown): string[] {
  return violacionesDelGrafo(nodes, edges).map(v => `${v.codigo}: ${v.detalle}`);
}

/** El código de un elemento de `invariantesDelGrafo` («ciclo-de-pasos: hay un círculo…» → «ciclo-de-pasos»). */
export function codigoDeViolacion(texto: string): string {
  const i = texto.indexOf(': ');
  return i < 0 ? texto : texto.slice(0, i);
}

function revisarGrafo(nodesEntrada: unknown, edgesEntrada: unknown): Violacion[] {
  const V: Violacion[] = [];
  const add = (codigo: CodigoViolacion, detalle: string) => {
    V.push({ codigo, detalle });
  };
  if (!Array.isArray(nodesEntrada)) add('nodos-no-es-lista', typeof nodesEntrada);
  if (!Array.isArray(edgesEntrada)) add('aristas-no-es-lista', typeof edgesEntrada);
  const listaN: readonly unknown[] = Array.isArray(nodesEntrada) ? (nodesEntrada as unknown[]) : [];
  const listaE: readonly unknown[] = Array.isArray(edgesEntrada) ? (edgesEntrada as unknown[]) : [];

  // ---- forma: lo que no se puede leer como cuadro o conexión se reporta y se deja fuera de lo demás
  const nodos: { id: string; kind: Nodo['kind']; x: unknown; y: unknown }[] = [];
  listaN.forEach((n, i) => {
    if (!esObjeto(n)) return add('nodo-malformado', `#${i} no es un objeto`);
    if (!esTexto(n.id)) return add('nodo-malformado', `#${i} no tiene id`);
    if (n.kind !== 'trigger' && n.kind !== 'agent' && n.kind !== 'app') {
      return add('nodo-malformado', `${n.id}: su tipo de cuadro no existe`);
    }
    nodos.push({ id: n.id, kind: n.kind, x: n.x, y: n.y });
  });
  const aristas: { id: string; de: string; a: string; tipo: unknown }[] = [];
  listaE.forEach((e, i) => {
    if (!esObjeto(e)) return add('arista-malformada', `#${i} no es un objeto`);
    if (!esTexto(e.id) || !esTexto(e.de) || !esTexto(e.a)) {
      return add('arista-malformada', `#${i} no tiene id, origen o destino`);
    }
    aristas.push({ id: e.id, de: e.de, a: e.a, tipo: e.tipo });
  });

  // ---- ids únicos
  const porId = new Map<string, (typeof nodos)[number]>();
  for (const n of nodos) {
    if (porId.has(n.id)) add('ids-nodos-duplicados', n.id);
    porId.set(n.id, n);
  }
  const idsE = new Set<string>();
  for (const e of aristas) {
    if (idsE.has(e.id)) add('ids-aristas-duplicados', e.id);
    idsE.add(e.id);
  }

  // ---- conexiones, una por una
  const vistas = new Set<string>();
  const padres = new Map<string, string[]>(); // destino → ids de las `tool` que le llegan
  const seqToca = new Set<string>();
  const seqEntra = new Set<string>();
  const pasos: { de: string; a: string }[] = [];
  const herramientas: { de: string; a: string }[] = [];
  for (const e of aristas) {
    const origen = porId.get(e.de);
    const destino = porId.get(e.a);
    if (!origen || !destino) {
      add('arista-huerfana', `${e.id}: ${e.de} → ${e.a}`);
      continue;
    }
    if (e.de === e.a) add('arista-a-si-mismo', e.id);
    if (e.tipo !== 'seq' && e.tipo !== 'tool') {
      add('arista-tipo-invalido', `${e.id}: ${comoTexto(e.tipo)}`);
      continue;
    }
    const clave = `${e.tipo}|${e.de}|${e.a}`;
    if (vistas.has(clave)) add('arista-duplicada', clave);
    vistas.add(clave);
    if (destino.kind === 'trigger') add('llega-al-disparador', `${e.id} ${e.tipo}`);
    if (e.tipo === 'tool') {
      padres.set(e.a, [...(padres.get(e.a) ?? []), e.de]);
      herramientas.push({ de: e.de, a: e.a });
      if (origen.kind !== 'agent') add('herramienta-de-no-agente', `${e.id}: el padre ${e.de} es ${origen.kind}`);
    } else {
      seqToca.add(e.de);
      seqToca.add(e.a);
      seqEntra.add(e.a);
      pasos.push({ de: e.de, a: e.a });
    }
  }
  for (const [id, quienes] of padres) {
    if (quienes.length > 1) add('herramienta-con-varios-padres', id);
    if (porId.get(id)?.kind === 'agent') {
      if (seqEntra.has(id)) add('ayudante-con-paso-entrante', `${id} conversa con otra IA y además le llega un paso`);
    } else if (seqToca.has(id)) {
      add('herramienta-y-paso', `${id} es herramienta y además toca una conexión de pasos`);
    }
  }

  // ---- sin círculos
  const ids = nodos.map(n => n.id);
  if (buscaCiclo(ids, adyacencia(pasos))) add('ciclo-de-pasos', 'hay un círculo de pasos');
  if (buscaCiclo(ids, adyacencia(herramientas))) add('ciclo-de-herramientas', 'hay un círculo de herramientas');
  if (buscaCiclo(ids, adyacencia([...pasos, ...herramientas]))) {
    add('ciclo-mixto', 'hay un círculo entre pasos y herramientas');
  }

  // ---- topes (0 disparadores es válido)
  const cuantos = (k: Nodo['kind']) => nodos.filter(n => n.kind === k).length;
  if (cuantos('trigger') > TOPE_DISPARADORES) add('varios-disparadores', `${cuantos('trigger')} disparadores`);
  if (cuantos('agent') > TOPE_AGENTES) add('tope-agentes', `${cuantos('agent')} agentes (hasta ${TOPE_AGENTES})`);
  if (cuantos('app') > TOPE_APPS) add('tope-apps', `${cuantos('app')} apps (hasta ${TOPE_APPS})`);

  // ---- dónde está cada cuadro
  for (const n of nodos) {
    if (typeof n.x !== 'number' || typeof n.y !== 'number' || !Number.isFinite(n.x) || !Number.isFinite(n.y)) {
      add('caja-no-finita', `${n.id} ${comoTexto(n.x)},${comoTexto(n.y)}`);
    } else if (n.x < 0 || n.x > X_MAX || n.y < 0 || n.y > Y_MAX) {
      add('caja-fuera-del-lienzo', `${n.id} ${n.x},${n.y}`);
    }
  }
  return V;
}
