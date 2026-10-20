// El reductor del Constructor: `reducir(estado, accion) → estado`. Es la ÚNICA puerta por la que cambia
// lo que hay en el lienzo; ningún componente toca `nodes` ni `edges` por otro camino. Puro: sin DOM,
// sin temporizadores, sin azar; cada llamada con el mismo estado y la misma acción da lo mismo.
//
// Portado de las acciones de Main.dc.html:1158-1521 con las correcciones que pide el informe 04 §9.2:
//  · Los EFECTOS (poner el foco, traer un cuadro a la vista, llevar Ajustes a la vista) son PETICIONES
//    dentro del estado (`foco`, `ver`, `scrollAjustes`); un efecto de React las cumple y las apaga con
//    `limpiarPeticiones`. Así el foco se prueba aquí y nunca cae a `<body>`.
//  · Un `id` que no existe deja el estado igual (misma referencia).
//  · El reductor es la ÚNICA barrera de los topes (1 disparador · 4 agentes · 8 apps), de los invariantes del
//    grafo (`invariantesDelGrafo`) y del largo de los textos: lo que llega de afuera (`cargarFlujo`, `estadoInicial`)
//    pasa por `normalizarFlujo`, la MISMA limpieza del borrador (campos con su tipo, enumeraciones que existen, ids
//    seguros, sin claves, textos recortados), y se rechaza con un aviso lo que no la pasa. Lo que se teclea
//    (`editarNodo`, `renombrarFlujo`) se recorta a los mismos topes: lo que se ve es lo que el borrador guarda.
//  · «Poner un cuadro en medio» usa `huecoParaInsertar`; si no cabe (devuelve null) avisa y no toca nada.
//  · Deshacer es una PILA REAL de hasta 20 instantáneas (ver «Deshacer» abajo).
//  · Los ids nuevos salen de `siguiente`, que NUNCA baja (ni al deshacer).
//
// DESHACER (decisión D8 del plan). Cada acción que cambia la estructura del flujo guarda ANTES una
// instantánea (cuadros, conexiones, nombre del flujo y cuadro elegido): quitar un cuadro, quitar una
// conexión, cambiar el tipo de una conexión, poner un cuadro en medio, conectar con uno que ya está,
// agregar un cuadro o el disparador, limpiar, cargar el ejemplo o un flujo de afuera. NO la guardan las
// acciones continuas: mover un cuadro, teclear en Ajustes o renombrar el flujo. Y esas acciones
// INVALIDAN la pila entera: si se pudiera deshacer después de ellas, restaurar una instantánea más
// vieja borraría lo que la persona acaba de escribir o de mover (el defecto 9.2-a del mockup). Mover un
// cuadro a donde ya estaba, o editar un campo con el mismo valor, no cambia nada y no invalida.
// Seleccionar, abrir y cerrar menús y empezar o cancelar una conexión tampoco tocan la pila. «Deshacer»
// desde un aviso manda el `id` de ese aviso: solo vale si es el de la instantánea de arriba (si no, lo dice
// y no hace nada). El aviso de una acción ofrece «Deshacer» (`aviso.conDeshacer`) cuando QUITA o REACOMODA
// (quitar, limpiar, cambiar el tipo, poner en medio, cargar); agregar y conectar entran en la pila, pero su
// aviso no lo ofrece (el botón de la barra y Ctrl/Cmd+Z sí las deshacen).

import { normalizarFlujo } from './borrador';
import {
  CONTADOR_MAX,
  DESC_AYUDANTE_POR_DEFECTO,
  DISPARADOR_NUEVO,
  ID_INICIAL,
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
} from './datos/constantes';
import { APPS_DISPARADOR, IAS, TIPOS_DISPARADOR } from './catalogo';
import { enRango, estaALaDerecha, estaDebajo, huecoParaInsertar, lugarALaDerecha, lugarDebajo, lugarLibreCerca } from './colocacion';
import { ejemplo, NOMBRE_EJEMPLO } from './ejemplos';
import { puedeEnlazar, soloAppsPorLaPatita } from './grafo';
import * as T from './textos';
import { esFrecuencia, numeroLibre, recortar, tituloDe } from './texto';
import type {
  AccionConstructor,
  Arista,
  ClaseCambio,
  EstadoConstructor,
  Flujo,
  Foco,
  Instantanea,
  Nodo,
  NodoAgente,
  NodoApp,
  NodoDisparador,
  ParcheNodo,
  Punto,
} from './tipos';

type E = EstadoConstructor;

// ================================================================ estado inicial y contador

/**
 * El contador de ids para un flujo que llega de afuera: `max(20, mayor número que termine algún id + 1)`.
 * Con el 20 de base, los ejemplos y las muestras (ids `t1`, `a1`… `e4`) dejan al primer cuadro nuevo en
 * `…21`, como en el mockup. El `+ 1` deja un número sin usar (inofensivo) y garantiza que nada choque
 * con ningún id, de cuadro o de conexión. Los sufijos absurdos (más de 12 cifras) no cuentan.
 */
export function contadorParaFlujo(flujo: { readonly nodes: readonly Nodo[]; readonly edges: readonly Arista[] }): number {
  let mayor = 0;
  for (const x of [...flujo.nodes, ...flujo.edges]) {
    const fin = /(\d+)$/.exec(String(x.id))?.[1];
    if (fin !== undefined && fin.length <= 12) mayor = Math.max(mayor, Number(fin));
  }
  return Math.max(ID_INICIAL, mayor + 1);
}

/**
 * Un flujo que llega de afuera (el borrador, el Asistente) listo para usarse, o los códigos de por qué no. Pasa por
 * `normalizarFlujo` —la limpieza del borrador— con una diferencia: si no trae nombre, se llama como un flujo nuevo. El resultado
 * son objetos NUEVOS (nadie comparte referencias con el Asistente ni con el borrador) y con los textos ya recortados a sus topes.
 * Los códigos son los de `invariantesDelGrafo` (`invalido`), `forma` o `con-clave` (el aviso no repite el texto de la clave).
 */
function abrirFlujoAjeno(flujo: unknown): { flujo: Flujo; codigos: [] } | { flujo: null; codigos: string[] } {
  const n = normalizarFlujo(flujo, { nombrePorOmision: NOMBRE_FLUJO_INICIAL });
  if (n.ok) return { flujo: n.flujo, codigos: [] };
  return { flujo: null, codigos: n.motivo === 'invalido' ? n.detalle : [n.motivo] };
}

/**
 * El estado con el que arranca el Constructor: sin nada elegido, sin historial y sin avisos. Con `flujo`
 * (el borrador guardado, por ejemplo) arranca con ese flujo; si no pasa la limpieza de `normalizarFlujo` (ni la forma, ni los
 * invariantes, ni los topes), arranca vacío (un borrador corrupto o editado a mano se descarta).
 *
 * `siguiente` es OPCIONAL: un piso para el contador de ids, para quien quiera que no se reutilicen ids que ya se vieron (el
 * contador de un reductor anterior, por ejemplo). El borrador NO guarda el contador: al recargar sale del flujo
 * (`contadorParaFlujo`), y si se había quitado el cuadro con el id más alto, ese id se vuelve a repartir (no choca con nada
 * que exista). Un valor que no sea un entero positivo de hasta 12 cifras se ignora.
 */
export function estadoInicial(flujo?: Flujo, siguiente?: number): E {
  const abierto = flujo === undefined ? null : abrirFlujoAjeno(flujo);
  const f: Flujo = abierto?.flujo ?? { nodes: [], edges: [], nombreFlujo: NOMBRE_FLUJO_INICIAL };
  const guardado = typeof siguiente === 'number' && Number.isSafeInteger(siguiente) && siguiente > 0 && siguiente <= CONTADOR_MAX ? siguiente : 0;
  return {
    flujo: f,
    sel: null,
    selEdge: null,
    menu: null,
    conectando: null,
    historial: [],
    siguiente: Math.max(contadorParaFlujo(f), guardado),
    foco: null,
    ver: null,
    scrollAjustes: 0,
    aviso: null,
    eventos: 0,
  };
}

/** ¿Hay algo que deshacer? Lo usan el botón de la barra y Ctrl/Cmd+Z. */
export function puedeDeshacer(estado: E): boolean {
  return estado.historial.length > 0;
}

// ================================================================ ayudas

const nodoPor = (e: E, id: string): Nodo | undefined => e.flujo.nodes.find(n => n.id === id);
const aristaPor = (e: E, id: string): Arista | undefined => e.flujo.edges.find(x => x.id === id);

/** El estado con un aviso nuevo (su `id` sube: dos avisos con el mismo texto se anuncian los dos). */
function conAviso(e: E, t: T.TextoAviso, conDeshacer = false): E {
  const id = e.eventos + 1;
  return { ...e, eventos: id, aviso: { id, texto: t.texto, tipo: t.tipo, conDeshacer } };
}

/** El estado con una petición de foco nueva. */
function conFoco(e: E, objetivo: Foco): E {
  const n = e.eventos + 1;
  return { ...e, eventos: n, foco: { objetivo, n } };
}

/** El estado con una petición de «trae este cuadro a la vista». */
function conVer(e: E, id: string): E {
  const n = e.eventos + 1;
  return { ...e, eventos: n, ver: { id, n } };
}

/** El estado con una petición de llevar el panel de Ajustes a la vista. */
const conAjustes = (e: E): E => ({ ...e, scrollAjustes: e.scrollAjustes + 1 });

/**
 * Guarda en la pila el estado de `antes` (cuadros, conexiones, nombre y selección) y devuelve `despues`
 * con la pila ya crecida (se descartan las más viejas pasadas de 20). `despues.aviso` debe ser el aviso de
 * esta misma acción: su `id` queda en la instantánea.
 */
function apilar(antes: E, despues: E, clase: ClaseCambio): E {
  const inst: Instantanea = {
    nodes: antes.flujo.nodes,
    edges: antes.flujo.edges,
    sel: antes.sel,
    texto: despues.aviso?.texto ?? '',
    nombreFlujo: antes.flujo.nombreFlujo,
    avisoId: despues.aviso?.id ?? 0,
    clase,
  };
  return { ...despues, historial: [...antes.historial, inst].slice(-MAX_HISTORIAL) };
}

/**
 * Tira la pila: algo que no se guarda (un texto, una posición, el nombre) cambió el flujo, y restaurar
 * una instantánea más vieja lo borraría. El aviso que ofrecía «Deshacer» deja de ofrecerlo (conserva su `id`).
 */
function invalidar(e: E): E {
  const aviso = e.aviso !== null && e.aviso.conDeshacer ? { ...e.aviso, conDeshacer: false } : e.aviso;
  if (e.historial.length === 0 && aviso === e.aviso) return e;
  return { ...e, historial: [], aviso };
}

/**
 * Último paso de toda acción: que nada apunte a un cuadro o a una conexión que ya no existe, que no haya
 * a la vez un cuadro y una conexión elegidos, y que no estén a la vez el menú y el modo «conectando».
 * Si ya está bien devuelve el mismo objeto.
 */
function sanear(e: E): E {
  const { nodes, edges } = e.flujo;
  const hay = (id: string) => nodes.some(n => n.id === id);
  let { sel, selEdge, menu, conectando } = e;
  if (sel !== null && !hay(sel)) sel = null;
  if (selEdge !== null && !edges.some(x => x.id === selEdge)) selEdge = null;
  if (sel !== null && selEdge !== null) selEdge = null;
  if (menu !== null) {
    const { ancla, insertarEn } = menu;
    const hayEnlace = insertarEn === null || edges.some(x => x.id === insertarEn && x.tipo === 'seq' && x.de === ancla);
    if (!hay(ancla) || !hayEnlace) menu = null;
  }
  if (conectando !== null && !hay(conectando.ancla)) conectando = null;
  if (menu !== null && conectando !== null) conectando = null;
  // las peticiones tampoco apuntan a lo que ya no existe: una que la pantalla ya no puede cumplir se apaga
  const e1: E = { ...e, sel, selEdge, menu, conectando };
  const ver = e.ver !== null && !hay(e.ver.id) ? null : e.ver;
  const foco = e.foco !== null && !focoVigente(e.foco.objetivo, e1) ? null : e.foco;
  if (sel === e.sel && selEdge === e.selEdge && menu === e.menu && conectando === e.conectando && ver === e.ver && foco === e.foco) return e;
  return { ...e1, ver, foco };
}

/**
 * ¿Tiene a dónde ir esta petición de foco? Un cuadro o una insignia que ya no existen, un menú que se cerró, una flecha que
 * ya no está elegida o un «+» de un cuadro que se quitó no se pueden enfocar. (Los «+» `medio` y el panel de Ajustes, el primer
 * cuadro y la primera opción del disparador siempre se quedan: la pantalla sabe encontrarlos o no hacer nada.)
 */
function focoVigente(f: Foco, e: E): boolean {
  const { nodes, edges } = e.flujo;
  switch (f.k) {
    case 'nodo':
      return nodes.some(n => n.id === f.id);
    case 'insignia':
      return edges.some(x => x.id === f.id);
    case 'mas': {
      const dueno = /^(?:der|tool)-(.+)$/.exec(f.clave)?.[1];
      return dueno === undefined || nodes.some(n => n.id === dueno);
    }
    case 'primeraOpcionMenu':
      return e.menu !== null;
    case 'opcionUnSentido':
      return e.selEdge !== null;
    case 'ajustes':
    case 'primerNodo':
    case 'primeraOpcionDisparador':
      return true;
  }
}

/** El primer cuadro que se elige al abrir un flujo: `a1` (el del ejemplo), si no el primer agente, si no el primer cuadro. */
function selInicial(flujo: Flujo): string | null {
  const { nodes } = flujo;
  return (nodes.find(n => n.id === 'a1') ?? nodes.find(n => n.kind === 'agent') ?? nodes[0])?.id ?? null;
}

/** A dónde va el foco cuando se queda sin su cuadro: el primero que haya, o la primera opción del disparador si el lienzo quedó vacío. */
function focoDeRespaldo(e: E): Foco {
  return e.flujo.nodes.length > 0 ? { k: 'primerNodo' } : { k: 'primeraOpcionDisparador' };
}

// ================================================================ elegir y abrir

function elegirDisparador(e: E, tipo: NodoDisparador['tipo']): E {
  if (!TIPOS_DISPARADOR.some(x => x.id === tipo)) return e;
  const { nodes, edges } = e.flujo;
  if (nodes.some(n => n.kind === 'trigger')) return conAviso(e, T.yaHayDisparador());
  let cuenta = e.siguiente + 1;
  const id = `t${cuenta}`;
  const p = lugarLibreCerca(nodes, 8, 180);
  const nodo: NodoDisparador = { id, kind: 'trigger', x: p.x, y: p.y, tipo, ...DISPARADOR_NUEVO };
  const todos = [...nodes, nodo];
  // si el flujo ya tenía cuadros (se quitó el disparador), el nuevo se conecta con el primero: el que no recibe de nadie
  // (con los que tienen un paso después primero, y luego el más a la izquierda)
  const cabezas = nodes
    .filter(n => !edges.some(x => x.a === n.id))
    .sort(
      (a, b) =>
        Number(edges.some(x => x.tipo === 'seq' && x.de === b.id)) - Number(edges.some(x => x.tipo === 'seq' && x.de === a.id)) ||
        a.x - b.x,
    );
  const cabeza = cabezas[0];
  let aristas = edges;
  let unidoCon: string | null = null;
  if (cabeza && puedeEnlazar({ nodes: todos, edges }, id, cabeza.id, 'seq').ok) {
    cuenta += 1;
    aristas = [...edges, { id: `e${cuenta}`, de: id, a: cabeza.id, tipo: 'seq' }];
    unidoCon = tituloDe(cabeza);
  }
  let s: E = { ...e, flujo: { ...e.flujo, nodes: todos, edges: aristas }, siguiente: cuenta, sel: id, selEdge: null, menu: null };
  s = conAviso(s, T.disparadorElegido(tituloDe(nodo), unidoCon));
  s = conFoco(conAjustes(s), { k: 'nodo', id });
  return apilar(e, s, 'agregar');
}

function abrirNodo(e: E, id: string, teclado: boolean): E {
  if (!nodoPor(e, id)) return e;
  if (e.conectando) return intentarConexion(e, id);
  let s: E = conAjustes({ ...e, sel: id, selEdge: null, menu: null });
  // con Enter o Espacio (un clic sin ratón) el foco pasa a Ajustes; Esc ahí regresa al cuadro
  if (teclado) s = conFoco(s, { k: 'ajustes' });
  return s;
}

function abrirEnlace(e: E, id: string): E {
  const ed = aristaPor(e, id);
  if (!ed) return e;
  const s = conAviso(
    { ...e, selEdge: id, sel: null, menu: null, conectando: null },
    T.abrirEnlace(tituloDe(nodoPor(e, ed.de)), tituloDe(nodoPor(e, ed.a))),
  );
  return conFoco(conAjustes(s), { k: 'opcionUnSentido' });
}

// ================================================================ el menú del «+»

function abrirMenu(e: E, ancla: string, tipo: Arista['tipo'], insertarEn: string | null): E {
  const A = nodoPor(e, ancla);
  if (!A) return e;
  if (tipo !== 'seq' && tipo !== 'tool') return e;
  if (insertarEn !== null) {
    // poner un cuadro en medio solo es de una conexión de un solo sentido que sale de este cuadro
    if (tipo !== 'seq') return e;
    if (!e.flujo.edges.some(x => x.id === insertarEn && x.tipo === 'seq' && x.de === ancla)) return e;
  }
  const m = e.menu;
  if (m && m.ancla === ancla && m.tipo === tipo && m.insertarEn === insertarEn) {
    return conAviso({ ...e, menu: null }, T.menuCerrado());
  }
  if (tipo === 'tool' && A.kind !== 'agent') return conAviso(e, T.soloAgentesTienenHerramientas());
  const nombre = tituloDe(A);
  const aviso = insertarEn !== null ? T.menuEnMedio() : tipo === 'tool' ? T.menuHerramienta(nombre) : T.menuDespues(nombre);
  const s = conAviso(
    { ...e, menu: { ancla, tipo, paso: tipo === 'tool' ? 'app' : 'inicio', insertarEn }, sel: ancla, selEdge: null, conectando: null },
    aviso,
  );
  return conFoco(s, { k: 'primeraOpcionMenu' });
}

function cerrarMenu(e: E): E {
  const m = e.menu;
  if (!m) return e;
  // el foco vuelve al «+» que abrió el menú
  const clave = m.insertarEn !== null ? 'medio' : `${m.tipo === 'tool' ? 'tool' : 'der'}-${m.ancla}`;
  return conFoco(conAviso({ ...e, menu: null }, T.menuCerrado()), { k: 'mas', clave });
}

function pasoMenu(e: E, paso: 'inicio' | 'app'): E {
  const m = e.menu;
  if (!m) return e;
  if (paso !== 'inicio' && paso !== 'app') return e;
  // la patita no tiene «Atrás»: solo ofrece apps
  if (m.tipo === 'tool' && paso === 'inicio') return e;
  return conFoco({ ...e, menu: { ...m, paso } }, { k: 'primeraOpcionMenu' });
}

/** Crea el cuadro que se eligió en el menú abierto y lo conecta (después, como herramienta o en medio de otra conexión). */
function crearDesdeMenu(e: E, que: 'agente' | 'app', nombreApp: string | undefined): E {
  const m = e.menu;
  if (!m) return e;
  if (que !== 'agente' && que !== 'app') return e;
  const { nodes, edges } = e.flujo;
  const A = nodes.find(n => n.id === m.ancla);
  if (!A) return { ...e, menu: null };
  const esAgente = que === 'agente';
  const kind = esAgente ? 'agent' : 'app';
  if (nodes.filter(n => n.kind === kind).length >= (esAgente ? TOPE_AGENTES : TOPE_APPS)) {
    return conAviso(e, esAgente ? T.topeAgentes() : T.topeApps());
  }
  if (soloAppsPorLaPatita(m.tipo, 'origen', { kind })) return conAviso(e, T.soloAppsEnElMenu());
  const nombre = esAgente ? '' : recortar(String(nombreApp ?? '').trim(), LARGO_NOMBRE_APP).trim();
  if (!esAgente && nombre === '') return conAviso(e, T.escribeNombreApp());

  // dónde cae: en medio de una conexión (se hace lugar corriendo lo que sigue), debajo del agente o a la derecha
  const viejo = m.insertarEn === null ? undefined : edges.find(x => x.id === m.insertarEn && x.tipo === 'seq');
  const D = viejo ? nodes.find(n => n.id === viejo.a) : undefined;
  let base: readonly Nodo[] = nodes;
  let p: Punto;
  if (m.insertarEn !== null) {
    if (!viejo || !D || viejo.de !== A.id) return conAviso({ ...e, menu: null }, T.conexionYaNoExiste());
    const hueco = huecoParaInsertar(nodes, edges, A, D, viejo);
    if (!hueco) return conAviso(e, T.sinLugarEnMedio());
    base = hueco.nodes;
    p = hueco.lugar;
  } else {
    p = m.tipo === 'tool' ? lugarDebajo(nodes, A) : lugarALaDerecha(nodes, A);
  }

  let cuenta = e.siguiente + 1;
  const id = `${esAgente ? 'a' : 'p'}${cuenta}`;
  const nuevo: NodoAgente | NodoApp = esAgente
    ? {
        id,
        kind: 'agent',
        x: p.x,
        y: p.y,
        nombre: `Agente ${numeroLibre(nodes)}`,
        ia: 'openai',
        tarea: '',
        instrucciones: INSTRUCCIONES_AGENTE_NUEVO,
      }
    : { id, kind: 'app', x: p.x, y: p.y, nombre };
  const todos: Nodo[] = [...base, nuevo];

  // se valida DESPUÉS de crear, con el cuadro ya puesto: si alguna regla lo rechaza, no cambia nada (ni el contador)
  let aristas: Arista[];
  if (viejo && D) {
    const sinViejo = edges.filter(x => x.id !== viejo.id);
    const v1 = puedeEnlazar({ nodes: todos, edges: sinViejo }, A.id, id, 'seq');
    if (!v1.ok) return conAviso(e, T.motivoDeRechazo(v1.motivo));
    const e1: Arista = { id: `e${cuenta}`, de: A.id, a: id, tipo: 'seq' };
    cuenta += 1;
    const e2: Arista = { id: `e${cuenta}`, de: id, a: D.id, tipo: 'seq' };
    const v2 = puedeEnlazar({ nodes: todos, edges: [...sinViejo, e1] }, id, D.id, 'seq');
    if (!v2.ok) return conAviso(e, T.motivoDeRechazo(v2.motivo));
    aristas = [...sinViejo, e1, e2];
  } else {
    const v = puedeEnlazar({ nodes: todos, edges }, A.id, id, m.tipo);
    if (!v.ok) return conAviso(e, T.motivoDeRechazo(v.motivo));
    aristas = [...edges, { id: `e${cuenta}`, de: A.id, a: id, tipo: m.tipo }];
  }

  const lugar: T.LugarAgregado = viejo ? 'medio' : m.tipo === 'tool' ? { herramientaDe: tituloDe(A) } : { despuesDe: tituloDe(A) };
  let s: E = {
    ...e,
    flujo: { ...e.flujo, nodes: todos, edges: aristas },
    siguiente: cuenta,
    sel: id,
    selEdge: null,
    menu: null,
    conectando: null,
  };
  // poner en medio reacomoda y reemplaza una conexión: su aviso ofrece «Deshacer»; agregar al final, no (pero sí entra en la pila)
  s = conAviso(s, T.agregado(tituloDe(nuevo), esAgente, lugar), viejo !== undefined);
  s = conVer(conFoco(s, { k: 'nodo', id }), id);
  return apilar(e, s, viejo ? 'cambiar' : 'agregar');
}

// ================================================================ conectar con uno que ya está

function iniciarConexion(e: E, ancla: string, rol: 'origen' | 'destino', tipo: Arista['tipo']): E {
  const A = nodoPor(e, ancla);
  if (!A) return e;
  if ((rol !== 'origen' && rol !== 'destino') || (tipo !== 'seq' && tipo !== 'tool')) return e;
  const c = e.conectando;
  if (c && c.ancla === ancla && c.rol === rol && c.tipo === tipo) {
    return conAviso({ ...e, conectando: null }, T.conexionCancelada());
  }
  // solo un agente tiene patita
  if (tipo === 'tool' && rol === 'origen' && A.kind !== 'agent') return conAviso(e, T.soloAgentesTienenHerramientas());
  const s = conAviso(
    { ...e, conectando: { ancla, rol, tipo }, sel: ancla, selEdge: null, menu: null },
    T.textoConectar(tipo, rol, tituloDe(A)),
  );
  return conFoco(s, { k: 'nodo', id: ancla });
}

function intentarConexion(e: E, id: string): E {
  const c = e.conectando;
  if (!c) return e;
  if (!nodoPor(e, id)) return e;
  if (id === c.ancla) return conAviso({ ...e, conectando: null }, T.conexionCancelada());
  const de = c.rol === 'origen' ? c.ancla : id;
  const a = c.rol === 'origen' ? id : c.ancla;
  const v = puedeEnlazar(e.flujo, de, a, c.tipo);
  if (!v.ok) return conAviso(e, T.elegirOtro(v.motivo));
  // «por la patita solo van apps» no está en puedeEnlazar: es de la interfaz y se pone además
  if (soloAppsPorLaPatita(c.tipo, c.rol, nodoPor(e, a))) return conAviso(e, T.soloAppsAlConectar());
  const cuenta = e.siguiente + 1;
  const edge: Arista = { id: `e${cuenta}`, de, a, tipo: c.tipo };
  const s = conAviso(
    {
      ...e,
      flujo: { ...e.flujo, edges: [...e.flujo.edges, edge] },
      siguiente: cuenta,
      conectando: null,
      sel: c.ancla,
      selEdge: null,
    },
    T.conectados(tituloDe(nodoPor(e, de)), tituloDe(nodoPor(e, a))),
  );
  return apilar(e, s, 'cambiar');
}

function cancelarConexion(e: E): E {
  const c = e.conectando;
  if (!c) return e;
  // el botón «Cancelar» desaparece: el foco vuelve al cuadro desde el que se empezó
  return conFoco(conAviso({ ...e, conectando: null }, T.conexionCancelada()), { k: 'nodo', id: c.ancla });
}

function cerrarTodo(e: E): E {
  if (!e.conectando && !e.menu) return e;
  return conAviso({ ...e, conectando: null, menu: null }, T.cerramosTodo());
}

// ================================================================ el editor de la flecha

function cambiarTipoEnlace(e: E, id: string, tipo: Arista['tipo']): E {
  const ed = aristaPor(e, id);
  if (!ed || ed.tipo === tipo) return e;
  if (tipo !== 'seq' && tipo !== 'tool') return e;
  const { nodes, edges } = e.flujo;
  // se prueba sobre el grafo SIN esa conexión (si no, ya estaría «conectado así» o chocaría consigo misma)
  const v = puedeEnlazar({ nodes, edges: edges.filter(x => x.id !== id) }, ed.de, ed.a, tipo);
  if (!v.ok) return conAviso(e, T.noSePuedeCambiar(v.motivo));
  const A = nodoPor(e, ed.de);
  const B = nodoPor(e, ed.a);
  if (!A || !B) return e;
  // el destino se acomoda para que el dibujo cuente lo mismo que la conexión: una herramienta cuelga debajo; un paso va a la derecha
  const otros = nodes.filter(n => n.id !== B.id);
  const colgada = tipo === 'tool' && B.kind !== 'agent';
  const quedaBien = colgada ? estaDebajo(A, B) : estaALaDerecha(A, B);
  const p: Punto = quedaBien ? { x: B.x, y: B.y } : colgada ? lugarDebajo(otros, A) : lugarALaDerecha(otros, A);
  const conversan = tipo === 'tool' && B.kind === 'agent';
  const sinDesc = conversan && String(B.kind === 'agent' ? (B.desc ?? '') : '').trim() === '';
  const nuevos = nodes.map<Nodo>(n => {
    if (n.id !== B.id) return n;
    const movido: Nodo = { ...n, x: p.x, y: p.y };
    return sinDesc && movido.kind === 'agent' ? { ...movido, desc: DESC_AYUDANTE_POR_DEFECTO } : movido;
  });
  const a = tituloDe(A);
  const b = tituloDe(B);
  const aviso = conversan ? T.ahoraConversan(a, b) : tipo === 'tool' ? T.ahoraEsHerramienta(a, b) : T.ahoraVaDespues(a, b);
  const s = conAviso(
    {
      ...e,
      flujo: { ...e.flujo, nodes: nuevos, edges: edges.map(x => (x.id === id ? { ...x, tipo } : x)) },
      menu: e.menu?.insertarEn === id ? null : e.menu,
    },
    aviso,
    true,
  );
  return apilar(e, s, 'cambiar');
}

function quitarEnlace(e: E, id: string): E {
  const ed = aristaPor(e, id);
  if (!ed) return e;
  const s = conAviso(
    {
      ...e,
      flujo: { ...e.flujo, edges: e.flujo.edges.filter(x => x.id !== id) },
      selEdge: e.selEdge === id ? null : e.selEdge,
      menu: e.menu?.insertarEn === id ? null : e.menu,
    },
    T.conexionQuitada(),
    true,
  );
  return apilar(e, conFoco(s, { k: 'nodo', id: ed.de }), 'quitar');
}

// ================================================================ quitar, limpiar, cargar

function quitarNodo(e: E, id: string): E {
  const n = nodoPor(e, id);
  if (!n) return e;
  const { nodes, edges } = e.flujo;
  // si el cuadro iba en medio de una cadena, lo de antes se une con lo de después (A → B → C pasa a A → C)
  const antes = edges.filter(x => x.tipo === 'seq' && x.a === n.id);
  const despues = edges.filter(x => x.tipo === 'seq' && x.de === n.id);
  let aristas = edges.filter(x => x.de !== n.id && x.a !== n.id);
  let cuenta = e.siguiente;
  let unidos = 0;
  const unir = (de: string, a: string) => {
    if (de === a || aristas.some(x => x.tipo === 'seq' && x.de === de && x.a === a)) return;
    cuenta += 1;
    aristas = [...aristas, { id: `e${cuenta}`, de, a, tipo: 'seq' }];
    unidos += 1;
  };
  for (const p of antes) for (const q of despues) unir(p.de, q.a);
  // si era una IA que conversa con otra, lo que le seguía pasa a su agente principal
  const padre = edges.find(x => x.tipo === 'tool' && x.a === n.id)?.de;
  if (padre !== undefined && n.kind === 'agent') for (const q of despues) unir(padre, q.a);

  const quedan = nodes.filter(x => x.id !== n.id);
  const aviso = T.quitamos({
    titulo: tituloDe(n),
    unidos: unidos > 0,
    sueltas: edges.filter(x => x.tipo === 'tool' && x.de === n.id).length,
    esDisparador: n.kind === 'trigger',
  });
  const s = conAviso(
    {
      ...e,
      flujo: { ...e.flujo, nodes: quedan, edges: aristas },
      siguiente: cuenta,
      sel: e.sel === n.id ? null : e.sel,
      menu: null,
      conectando: null,
    },
    aviso,
    true,
  );
  // el foco va al cuadro de donde venía el flujo; si no hay, al primero; si el lienzo quedó vacío, a elegir disparador
  const previo = antes[0]?.de;
  const foco: Foco = previo !== undefined && quedan.some(x => x.id === previo) ? { k: 'nodo', id: previo } : focoDeRespaldo(s);
  return apilar(e, conFoco(s, foco), 'quitar');
}

function limpiar(e: E): E {
  const { nodes, edges } = e.flujo;
  if (nodes.length === 0 && edges.length === 0) return e;
  // el nombre del flujo se queda
  const s = conAviso(
    { ...e, flujo: { ...e.flujo, nodes: [], edges: [] }, sel: null, selEdge: null, menu: null, conectando: null },
    T.limpiado(),
    true,
  );
  return apilar(e, conFoco(s, { k: 'primeraOpcionDisparador' }), 'quitar');
}

/** Reemplaza todo el flujo (el ejemplo o uno de afuera). El contador no baja: sube a lo que pida el flujo nuevo. */
function reemplazarFlujo(e: E, flujo: Flujo, aviso: T.TextoAviso): E {
  const sel = selInicial(flujo);
  const s = conAviso(
    {
      ...e,
      flujo,
      sel,
      selEdge: null,
      menu: null,
      conectando: null,
      siguiente: Math.max(e.siguiente, contadorParaFlujo(flujo)),
    },
    aviso,
    true,
  );
  return apilar(e, conFoco(s, sel === null ? { k: 'primeraOpcionDisparador' } : { k: 'nodo', id: sel }), 'cargar');
}

function cargarEjemplo(e: E): E {
  return reemplazarFlujo(e, { ...ejemplo(), nombreFlujo: NOMBRE_EJEMPLO }, T.ejemploCargado());
}

function cargarFlujo(e: E, flujo: Flujo): E {
  const abierto = abrirFlujoAjeno(flujo);
  if (abierto.flujo === null) return conAviso(e, T.flujoRechazado(abierto.codigos));
  return reemplazarFlujo(e, abierto.flujo, T.flujoAbierto());
}

function deshacer(e: E, avisoId: number | undefined): E {
  const inst = e.historial[e.historial.length - 1];
  // desde un aviso solo vale si ese aviso es el de la instantánea de arriba
  if (avisoId !== undefined && inst?.avisoId !== avisoId) return conAviso(e, T.yaNoSePuedeDeshacer());
  if (!inst) return conAviso(e, T.nadaQueDeshacer());
  const sel = inst.sel !== null && inst.nodes.some(n => n.id === inst.sel) ? inst.sel : null;
  const s = conAviso(
    {
      ...e,
      flujo: { nodes: inst.nodes, edges: inst.edges, nombreFlujo: inst.nombreFlujo ?? e.flujo.nombreFlujo },
      sel,
      selEdge: null,
      menu: null,
      conectando: null,
      historial: e.historial.slice(0, -1),
    },
    T.deshecho(inst.clase ?? 'cambiar'),
  );
  // el botón «Deshacer» del aviso desapareció: el foco va al cuadro restaurado
  return conFoco(s, sel !== null ? { k: 'nodo', id: sel } : focoDeRespaldo(s));
}

// ================================================================ mover y editar (no entran en la pila: la tiran)

/** Pone un cuadro en `p`. Si ya estaba ahí devuelve el mismo estado. */
function ponerEn(e: E, id: string, p: Punto): E {
  const n = nodoPor(e, id);
  if (!n || (n.x === p.x && n.y === p.y)) return e;
  const nodes = e.flujo.nodes.map<Nodo>(x => (x.id === id ? { ...x, x: p.x, y: p.y } : x));
  return invalidar({ ...e, flujo: { ...e.flujo, nodes } });
}

function moverNodo(e: E, id: string, x: number, y: number): E {
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return e;
  return ponerEn(e, id, enRango(x, y));
}

function moverConTeclado(e: E, id: string, direccion: string, grande: boolean): E {
  const n = nodoPor(e, id);
  if (!n) return e;
  const paso = grande ? PASO_TECLA_MAYUS : PASO_TECLA;
  const dx = direccion === 'izquierda' ? -paso : direccion === 'derecha' ? paso : 0;
  const dy = direccion === 'arriba' ? -paso : direccion === 'abajo' ? paso : 0;
  if (dx === 0 && dy === 0) return e;
  const movido = ponerEn(e, id, enRango(n.x + dx, n.y + dy));
  // mover con el teclado también elige el cuadro
  if (movido.sel === id && movido.selEdge === null) return movido;
  return { ...movido, sel: id, selEdge: null };
}

const esTipoDisparador = (v: unknown): v is NodoDisparador['tipo'] => TIPOS_DISPARADOR.some(x => x.id === v);
const esAppDisparador = (v: unknown): v is NodoDisparador['app'] => APPS_DISPARADOR.some(x => x.id === v);
const esIdIA = (v: unknown): v is NodoAgente['ia'] => IAS.some(x => x.id === v);

/** El cuadro con el parche aplicado. Solo entran los campos que son de ese tipo de cuadro y que traen un valor que existe; si no cambia nada, el mismo cuadro. */
function aplicarParche(n: Nodo, p: Readonly<Record<string, unknown>>): Nodo {
  if (n.kind === 'trigger') {
    const tipo = esTipoDisparador(p.tipo) ? p.tipo : n.tipo;
    const frec = esFrecuencia(p.frec) ? p.frec : n.frec;
    const ruta = typeof p.ruta === 'string' ? recortar(p.ruta, LARGO_RUTA) : n.ruta;
    const app = esAppDisparador(p.app) ? p.app : n.app;
    if (tipo === n.tipo && frec === n.frec && ruta === n.ruta && app === n.app) return n;
    return { ...n, tipo, frec, ruta, app };
  }
  if (n.kind === 'agent') {
    const nombre = typeof p.nombre === 'string' ? recortar(p.nombre, LARGO_NOMBRE_AGENTE) : n.nombre;
    const ia = esIdIA(p.ia) ? p.ia : n.ia;
    const tarea = typeof p.tarea === 'string' ? recortar(p.tarea, LARGO_TEXTO_AGENTE) : n.tarea;
    const instrucciones = typeof p.instrucciones === 'string' ? recortar(p.instrucciones, LARGO_TEXTO_AGENTE) : n.instrucciones;
    const desc = typeof p.desc === 'string' ? recortar(p.desc, LARGO_DESC_AYUDANTE) : n.desc;
    if (nombre === n.nombre && ia === n.ia && tarea === n.tarea && instrucciones === n.instrucciones && desc === n.desc) return n;
    return { ...n, nombre, ia, tarea, instrucciones, ...(desc === undefined ? {} : { desc }) };
  }
  const nombre = typeof p.nombre === 'string' ? recortar(p.nombre, LARGO_NOMBRE_APP) : n.nombre;
  return nombre === n.nombre ? n : { ...n, nombre };
}

function editarNodo(e: E, id: string, parche: ParcheNodo): E {
  const n = nodoPor(e, id);
  if (!n || typeof parche !== 'object' || parche === null) return e;
  const nuevo = aplicarParche(n, parche as Readonly<Record<string, unknown>>);
  if (nuevo === n) return e;
  return invalidar({ ...e, flujo: { ...e.flujo, nodes: e.flujo.nodes.map(x => (x.id === id ? nuevo : x)) } });
}

function renombrarFlujo(e: E, nombre: string): E {
  if (typeof nombre !== 'string') return e;
  // sin recortar espacios: quien teclea necesita poder escribir «Mi flujo»; el exportador ya los recorta
  const recortado = recortar(nombre, LARGO_NOMBRE_FLUJO);
  if (recortado === e.flujo.nombreFlujo) return e;
  return invalidar({ ...e, flujo: { ...e.flujo, nombreFlujo: recortado } });
}

// ================================================================ foco

function volverDeAjustes(e: E): E {
  if (e.selEdge !== null) return conFoco(e, { k: 'insignia', id: e.selEdge });
  if (e.sel !== null) return conFoco(e, { k: 'nodo', id: e.sel });
  return e;
}

function limpiarPeticiones(e: E, hasta: number | undefined): E {
  const quitaFoco = e.foco !== null && (hasta === undefined || e.foco.n <= hasta);
  const quitaVer = e.ver !== null && (hasta === undefined || e.ver.n <= hasta);
  if (!quitaFoco && !quitaVer) return e;
  return { ...e, foco: quitaFoco ? null : e.foco, ver: quitaVer ? null : e.ver };
}

// ================================================================ la puerta

function sinAccion(_accion: never, e: E): E {
  return e;
}

function paso(e: E, a: AccionConstructor): E {
  switch (a.k) {
    case 'elegirDisparador':
      return elegirDisparador(e, a.tipo);
    case 'abrirNodo':
      return abrirNodo(e, a.id, a.teclado === true);
    case 'abrirEnlace':
      return abrirEnlace(e, a.id);
    case 'abrirMenu':
      return abrirMenu(e, a.ancla, a.tipo, a.insertarEn ?? null);
    case 'cerrarMenu':
      return cerrarMenu(e);
    case 'pasoMenu':
      return pasoMenu(e, a.paso);
    case 'crearDesdeMenu':
      return crearDesdeMenu(e, a.que, a.nombreApp);
    case 'iniciarConexion':
      return iniciarConexion(e, a.ancla, a.rol, a.tipo);
    case 'intentarConexion':
      return intentarConexion(e, a.id);
    case 'cancelarConexion':
      return cancelarConexion(e);
    case 'cerrarTodo':
      return cerrarTodo(e);
    case 'cambiarTipoEnlace':
      return cambiarTipoEnlace(e, a.id, a.tipo);
    case 'quitarEnlace':
      return quitarEnlace(e, a.id);
    case 'quitarNodo':
      return quitarNodo(e, a.id);
    case 'moverNodo':
      return moverNodo(e, a.id, a.x, a.y);
    case 'moverConTeclado':
      return moverConTeclado(e, a.id, a.direccion, a.grande === true);
    case 'editarNodo':
      return editarNodo(e, a.id, a.parche);
    case 'renombrarFlujo':
      return renombrarFlujo(e, a.nombre);
    case 'limpiar':
      return limpiar(e);
    case 'cargarEjemplo':
      return cargarEjemplo(e);
    case 'cargarFlujo':
      return cargarFlujo(e, a.flujo);
    case 'deshacer':
      return deshacer(e, a.avisoId);
    case 'volverDeAjustes':
      return volverDeAjustes(e);
    case 'limpiarPeticiones':
      return limpiarPeticiones(e, a.hasta);
    default:
      return sinAccion(a, e);
  }
}

/**
 * Aplica una acción. Devuelve el MISMO objeto si no pasó nada (un id que no existe, una acción que no
 * viene al caso). Nunca modifica el estado que recibe ni las listas que contiene.
 */
export function reducir(estado: EstadoConstructor, accion: AccionConstructor): EstadoConstructor {
  const siguiente = paso(estado, accion);
  return siguiente === estado ? estado : sanear(siguiente);
}
