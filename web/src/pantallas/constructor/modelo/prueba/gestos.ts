// Los «gestos» al azar de las pruebas de propiedades del reductor: qué hace una persona (o un programa
// descuidado) con el Constructor, como acciones del reductor. Dos maneras, como en el fuzz del mockup
// (revision/fuzz/fuzz.cjs):
//
//   · `gestoUI`  SOLO lo que la persona puede tocar: cada gesto es «un clic» en un control que los
//                selectores ofrecen en ESE estado (cuadros, «+», patita, insignias de las flechas, opciones
//                del menú, editor de la conexión, panel de Ajustes, arrastre, teclado, Deshacer…). Hace en
//                producción lo que el mockup hacía con los `sc-if` de la plantilla.
//   · `gestoAPI` llama al reductor con lo que sea, también con ids que ya no existen o que nunca existieron,
//                valores de tipo equivocado y flujos de afuera rotos. El reductor es la ÚNICA barrera, así
//                que tiene que aguantar lo que un componente mal hecho le mande.
//
// Un gesto es UNA acción (el menú abierto, la selección y el modo «conectando» viven en el estado, así que
// elegir en el menú es otro gesto que mira el estado que dejó el anterior). Como las acciones son datos
// (llevan sus ids), una secuencia se puede volver a correr tal cual y se puede minimizar quitándole acciones.

import { ejemplo, muestras } from '../ejemplos';
import { normalizarFlujo } from '../borrador';
import { LARGO_NOMBRE_FLUJO, X_MAX, Y_MAX } from '../datos/constantes';
import {
  vistaAjustes,
  vistaElegirDisparador,
  vistaEnlace,
  vistaFlechas,
  vistaMenu,
  vistaNodos,
} from '../selectores';
import type { AccionConstructor as A, EstadoConstructor as E, Flujo, ParcheNodo, TipoArista } from '../tipos';
import { elegir, elegirConPeso, entero } from './semilla';

// ---------------------------------------------------------------- los textos que se teclean

/**
 * Las ocho formas de clave que el repo conoce (las de `pipeline/validador.py:SECRETOS`), armadas por partes
 * para que ni este archivo parezca traer una. Solo salen cuando la campaña pide `conClaves`.
 */
export const TEXTOS_CLAVE: readonly string[] = [
  `sk-${'a'.repeat(24)}`,
  `AIza${'a'.repeat(35)}`,
  'xoxb-1234567890',
  `ghp_${'a'.repeat(36)}`,
  `123456789:${'A'.repeat(35)}`,
  `Bearer ${'a'.repeat(24)}`,
  '-----BEGIN PRIVATE KEY-----',
  `AKIA${'A'.repeat(16)}`,
];

/** Nombres de app que se escriben: del catálogo, con otra forma, casi del catálogo, hostiles y vacíos. Ninguno trae «null», «undefined» ni «NaN» (los selectores se revisan contra esas palabras). */
export const TEXTOS_APP: readonly string[] = [
  'Gmail',
  'Slack',
  'HubSpot',
  'Mi app',
  "d'Ana",
  'AI Agent',
  'Webhook',
  'Schedule Trigger',
  'OpenAI Chat Model',
  'ñandú Ü',
  'Google Sheets',
  'google sheets',
  '__proto__',
  'constructor',
  '"entre comillas"',
  'a\\b',
  'Correo (SMTP)',
  'smtp',
  'Gmail Trigger',
  'When chat message received',
  'Notion',
  'Telegram',
  'x'.repeat(60),
  'y'.repeat(129),
  '',
  '   ',
  'Zendesk',
  'Atención',
  'toString',
  '}}{{ $env.X }}',
  "x'); y('",
  '{{x}}',
  'Gmail',
  'Slack',
];

/** Nombres de agente. */
export const TEXTOS_AGENTE: readonly string[] = [
  '',
  '  ',
  'Investigador',
  'Resumen',
  'AI Agent',
  'Agente 1',
  'Gmail',
  'Atención a clientes',
  "Ana's bot",
  'Ana\\',
  '}} Pérez {{',
  "x'); y('",
  '__proto__',
  'x'.repeat(60),
  'z'.repeat(61),
  'x'.repeat(90),
  'Verificador',
  'Investigador',
];

/** Tarea, instrucciones y «para qué sirve». */
export const TEXTOS_LARGO: readonly string[] = [
  '',
  ' ',
  'Resume lo importante.',
  'Haz {algo} con {{ $json }}',
  '=expresion',
  '={{ $env.X }}',
  'Línea 1\nLínea 2',
  'a'.repeat(300),
  'Investiga y resume.',
  'Para qué sirve.',
];

/** Rutas del webhook. */
export const TEXTOS_RUTA: readonly string[] = ['', ' ', 'mi-flujo', 'Mi Flujo Ñandú!', '###', 'a/b', 'x'.repeat(50)];

/** Nombres del flujo. */
export const TEXTOS_FLUJO: readonly string[] = ['', ' ', 'Mi flujo', 'Ñandú "1"', 'x'.repeat(80), 'x'.repeat(100), 'Un nombre'];

const TIPOS_DISPARADOR = ['tiempo', 'chat', 'web', 'app'] as const;
const FRECUENCIAS = ['hora', 'dia', 'lunes'] as const;
const APPS_DISPARADOR = ['gmail', 'telegram'] as const;
const IAS = ['openai', 'anthropic', 'gemini', 'openrouter'] as const;
const DIRECCIONES = ['izquierda', 'derecha', 'arriba', 'abajo'] as const;

/** Un texto de la lista; con `conClaves`, una de cada cuatro veces una clave. */
function texto(rng: () => number, lista: readonly string[], conClaves: boolean): string {
  return conClaves && rng() < 0.25 ? elegir(rng, TEXTOS_CLAVE) : elegir(rng, lista);
}

// ---------------------------------------------------------------- lo que ya existió (para los ids fantasma)

/** Los ids de cuadros y conexiones que alguna vez estuvieron en el flujo. Los que ya no están son «fantasmas»: la prueba los usa para mandar acciones a lo que ya no existe. */
export interface Memoria {
  nodos: Set<string>;
  aristas: Set<string>;
}

export const memoriaNueva = (): Memoria => ({ nodos: new Set(), aristas: new Set() });

export function recordar(m: Memoria, e: E): void {
  for (const n of e.flujo.nodes) m.nodos.add(n.id);
  for (const x of e.flujo.edges) m.aristas.add(x.id);
}

function idNodo(rng: () => number, e: E, m: Memoria): string {
  const vivos = e.flujo.nodes.map(n => n.id);
  const fantasmas = [...m.nodos].filter(id => !vivos.includes(id));
  const x = rng();
  if (x < 0.8 && vivos.length > 0) return elegir(rng, vivos);
  if (x < 0.93 && fantasmas.length > 0) return elegir(rng, fantasmas);
  return `zz${entero(rng, 3)}`;
}

function idArista(rng: () => number, e: E, m: Memoria, soloSeq = false): string {
  const vivas = e.flujo.edges.map(x => x.id);
  const seq = e.flujo.edges.filter(x => x.tipo === 'seq').map(x => x.id);
  const fantasmas = [...m.aristas].filter(id => !vivas.includes(id));
  const x = rng();
  if (seq.length > 0 && x < (soloSeq ? 0.55 : 0.1)) return elegir(rng, seq);
  if (x < 0.85 && vivas.length > 0) return elegir(rng, vivas);
  if (x < 0.95 && fantasmas.length > 0) return elegir(rng, fantasmas);
  return `ez${entero(rng, 3)}`;
}

// ---------------------------------------------------------------- flujos de afuera (cargarFlujo)

/** Un flujo que NO cumple los invariantes (o los topes): el reductor debe rechazarlo sin tocar nada. */
export function flujoRoto(rng: () => number): Flujo {
  const f = ejemplo();
  const agente = (id: string, x: number): Flujo['nodes'][number] => ({ id, kind: 'agent', x, y: 700, nombre: id, ia: 'openai', tarea: '', instrucciones: '' });
  const app = (id: string, x: number): Flujo['nodes'][number] => ({ id, kind: 'app', x, y: 900, nombre: 'Notion' });
  switch (entero(rng, 11)) {
    case 0: // más de 4 agentes
      return { ...f, nodes: [...f.nodes, agente('a3', 0), agente('a4', 300), agente('a5', 600)] };
    case 1: // más de 8 apps
      return { ...f, nodes: [...f.nodes, ...Array.from({ length: 8 }, (_, i) => app(`p${i + 10}`, i * 240))] };
    case 2: // dos disparadores
      return { ...f, nodes: [...f.nodes, { id: 't2', kind: 'trigger', x: 8, y: 600, tipo: 'tiempo', frec: 'dia', ruta: 'x', app: 'gmail' }] };
    case 3: // un círculo de pasos
      return { ...f, edges: [...f.edges, { id: 'e9', de: 'a2', a: 'a1', tipo: 'seq' }] };
    case 4: // una conexión huérfana
      return { ...f, edges: [...f.edges, { id: 'e9', de: 'a1', a: 'nadie', tipo: 'seq' }] };
    case 5: // ids de cuadro repetidos
      return { ...f, nodes: [...f.nodes, agente('a1', 900)] };
    case 6: // una posición que no es número
      return { ...f, nodes: f.nodes.map(n => (n.id === 'a1' ? { ...n, x: Number.NaN } : n)) };
    case 7: // fuera del lienzo
      return { ...f, nodes: f.nodes.map(n => (n.id === 'p1' ? { ...n, x: X_MAX + 8, y: Y_MAX + 8 } : n)) };
    case 8: // una herramienta que sale de una app
      return { ...f, edges: [...f.edges, { id: 'e9', de: 'p1', a: 'p2', tipo: 'tool' }] };
    case 9: // algo que llega a un disparador
      return { ...f, edges: [...f.edges, { id: 'e9', de: 'a1', a: 't1', tipo: 'seq' }] };
    default: // una herramienta con dos padres
      return { ...f, edges: [...f.edges, { id: 'e9', de: 'a2', a: 'p1', tipo: 'tool' }] };
  }
}

/** El mismo flujo con los ids renumerados desde `desde` (un flujo de afuera que ya trae ids altos): el contador de ids del reductor tiene que saltar por encima de todos. */
export function conIdsAltos(f: Flujo, desde: number): Flujo {
  const nuevo = new Map<string, string>();
  f.nodes.forEach((n, i) => nuevo.set(n.id, `${n.id.replace(/\d+$/, '')}${desde + i}`));
  const id = (viejo: string) => nuevo.get(viejo) ?? viejo;
  return {
    nombreFlujo: f.nombreFlujo,
    nodes: f.nodes.map(n => ({ ...n, id: id(n.id) })),
    edges: f.edges.map((x, i) => ({ id: `e${desde + 20 + i}`, de: id(x.de), a: id(x.a), tipo: x.tipo })),
  };
}

/** Un flujo de afuera que SÍ se puede abrir: el ejemplo, una muestra del Asistente, uno vacío, o el ejemplo estropeado y vuelto a limpiar por el borrador. */
export function flujoBueno(rng: () => number): Flujo {
  const k = entero(rng, 8);
  if (k === 6) return conIdsAltos(ejemplo(), 25 + entero(rng, 40));
  if (k === 7) return conIdsAltos({ ...elegir(rng, muestras()), nombreFlujo: 'Con ids altos' }, 30 + entero(rng, 40));
  if (k === 0) return ejemplo();
  if (k === 1) return { nodes: [], edges: [], nombreFlujo: 'Vacío' };
  if (k === 2) return { ...ejemplo(), nombreFlujo: 'x'.repeat(LARGO_NOMBRE_FLUJO + 40) };
  if (k === 3) {
    // el borrador (normalizarFlujo) es quien deja pasar los flujos de afuera: con textos largos y campos sobrantes
    const sucio = { ...ejemplo(), extra: 'ignorado', nodes: ejemplo().nodes.map(n => ({ ...n, sobra: 1, ...(n.kind === 'agent' ? { tarea: 'z'.repeat(5000) } : {}) })) };
    const r = normalizarFlujo(sucio);
    return r.ok ? r.flujo : ejemplo();
  }
  const m = elegir(rng, muestras());
  return { nodes: m.nodes, edges: m.edges, nombreFlujo: m.nombre };
}

// ---------------------------------------------------------------- gestos de la persona

/** Qué más cambia la campaña. */
export interface OpcionesGesto {
  /** Sesgo a CRECER (casi nunca borra) para llegar a los topes: 4 agentes, 8 apps, 13 cuadros. */
  grande: boolean;
  /** Entre los textos que se teclean salen claves pegadas por error. */
  conClaves: boolean;
  /** Sin mover cuadros, ni teclear en Ajustes, ni renombrar el flujo: así la pila de Deshacer (que esas acciones tiran) puede llenarse hasta 20. */
  sinEdiciones?: boolean;
}

const BAJA_EN_GRANDE: Readonly<Record<string, number>> = {
  limpiar: 0.02,
  ejemplo: 0,
  cargar: 0.05,
  selQuitar: 0.15,
  conQuitar: 0.15,
  enlQuitar: 0.15,
  disp: 3,
  menuCerrar: 0.3,
  menuEsc: 0.2,
  menuAtras: 0.2,
  abrir: 0.8,
  deshacer: 0.1,
  deshacerAviso: 0.1,
};
const SUBE_EN_GRANDE: ReadonlySet<string> = new Set(['menuOpcion', 'menuApp', 'masDer']);
/** Los gestos de edición continua (mover, teclear, renombrar): tiran la pila de Deshacer. */
const EDICIONES: ReadonlySet<string> = new Set(['drag', 'trigTipo', 'trigCampo', 'ia', 'textoAg', 'textoApp', 'sugerencia', 'nombreFlujo']);
/** Gestos que, con un menú abierto o una conexión en curso, la persona deja para después. */
const DISTRACCIONES: ReadonlySet<string> = new Set(['masDer', 'masTool', 'insignia', 'abrir', 'drag', 'tecla', 'selSig', 'selHerr', 'selQuitar', 'conQuitar', 'conEditar', 'trigTipo', 'trigCampo', 'ia', 'textoAg', 'textoApp', 'sugerencia', 'limpiar']);

/**
 * Un clic en un control que los selectores ofrecen en este estado. Devuelve null si no hay nada que tocar
 * (no pasa: siempre hay algo, aunque sea Limpiar o el nombre del flujo).
 */
export function gestoUI(rng: () => number, e: E, op: OpcionesGesto): A | null {
  const nodos = vistaNodos(e);
  const flechas = vistaFlechas(e);
  const menu = vistaMenu(e);
  const ajustes = vistaAjustes(e);
  const enlace = vistaEnlace(e);
  const disp = vistaElegirDisparador(e);
  const con = e.conectando;
  const conAgente = ajustes?.panel === 'agente' ? ajustes : null;
  const conApp = ajustes?.panel === 'app' ? ajustes : null;
  const conDisp = ajustes?.panel === 'disparador' ? ajustes : null;

  const cats: [string, number][] = [];
  // con un menú abierto, tocar OTRO «+» o un cuadro lo cambia o lo cierra: se sigue tocando, pero la persona suele terminar lo que empezó
  const distrae = menu !== null || con !== null ? (op.grande ? 0.15 : 0.5) : 1;
  const add = (c: string, w: number, ok: unknown = true) => {
    if (!ok || (op.sinEdiciones === true && EDICIONES.has(c))) return;
    const ajustado = DISTRACCIONES.has(c) ? w * distrae : w;
    cats.push([c, op.grande ? ajustado * (BAJA_EN_GRANDE[c] ?? 1) * (SUBE_EN_GRANDE.has(c) ? 1.6 : 1) : ajustado]);
  };
  add('disp', 12, disp.visible);
  add('ejemplo', 1.2, disp.puedeEjemplo);
  add('abrir', con ? 8 : 5, nodos.length > 0);
  add('abrirValido', 30, con && nodos.some(n => n.modoConexion === 'destino'));
  add('masDer', 15, nodos.some(n => n.stubDer || n.asaDer));
  add('masTool', 13, nodos.some(n => n.patita));
  add('insignia', 6, flechas.length > 0);
  add('menuOpcion', 24, menu?.esInicio);
  add('menuApp', 13, menu?.esApp);
  add('menuOtra', 3, menu?.esApp);
  add('menuAtras', 0.7, menu?.esApp && menu.hayAtras);
  add('menuCerrar', 1.2, menu !== null);
  add('menuEsc', 0.8, menu !== null);
  add('enlUno', 6, enlace);
  add('enlDoble', 6, enlace);
  add('enlMedio', 7, enlace?.puedeMedio);
  add('enlQuitar', 2, enlace);
  add('selSig', 4, ajustes?.btnSig);
  add('selHerr', 4, ajustes?.btnHerr);
  add('selQuitar', 3, ajustes);
  add('conEditar', 3, ajustes && ajustes.conexiones.length > 0);
  add('conQuitar', 3, ajustes && ajustes.conexiones.length > 0);
  add('trigTipo', 2, conDisp);
  add('trigCampo', 1.5, conDisp);
  add('ia', 1.5, conAgente);
  add('textoAg', 2.5, conAgente);
  add('textoApp', 2.5, conApp);
  add('sugerencia', 1.5, conApp);
  add('cancelarConectar', 2, con);
  add('drag', 5, nodos.length > 0);
  add('tecla', 3, nodos.length > 0);
  add('limpiar', 0.35);
  add('nombreFlujo', 0.3);
  add('deshacer', 3, e.historial.length > 0);
  add('deshacerAviso', 1.5, e.aviso?.conDeshacer);
  add('cargar', 0.3);
  add('volverAjustes', 0.5, ajustes !== null || enlace !== null);
  add('limpiarPeticiones', 0.5);

  const c = elegirConPeso(rng, cats);
  switch (c) {
    case 'disp':
      return { k: 'elegirDisparador', tipo: elegir(rng, disp.opciones).id };
    case 'ejemplo':
      return { k: 'cargarEjemplo' };
    case 'abrir':
      return { k: 'abrirNodo', id: elegir(rng, nodos).id, teclado: rng() < 0.3 };
    case 'abrirValido':
      return { k: 'abrirNodo', id: elegir(rng, nodos.filter(n => n.modoConexion === 'destino')).id, teclado: rng() < 0.2 };
    case 'masDer':
      return { k: 'abrirMenu', ancla: elegir(rng, nodos.filter(n => n.stubDer || n.asaDer)).id, tipo: 'seq' };
    case 'masTool':
      return { k: 'abrirMenu', ancla: elegir(rng, nodos.filter(n => n.patita)).id, tipo: 'tool' };
    case 'insignia':
      return { k: 'abrirEnlace', id: elegir(rng, flechas).id };
    case 'menuOpcion': {
      if (!menu) return null;
      // en «grande» casi siempre «Una aplicación» (la primera opción)
      const o = op.grande && rng() < 0.65 ? (menu.opciones[0] ?? elegir(rng, menu.opciones)) : elegir(rng, menu.opciones);
      if (o.id === 'app') return { k: 'pasoMenu', paso: 'app' };
      if (o.id === 'agente') return { k: 'crearDesdeMenu', que: 'agente' };
      return { k: 'iniciarConexion', ancla: menu.ancla, rol: 'origen', tipo: menu.tipo };
    }
    case 'menuApp':
      return menu ? { k: 'crearDesdeMenu', que: 'app', nombreApp: elegir(rng, menu.apps).nombre } : null;
    case 'menuOtra':
      return { k: 'crearDesdeMenu', que: 'app', nombreApp: texto(rng, TEXTOS_APP, op.conClaves) };
    case 'menuAtras':
      return { k: 'pasoMenu', paso: 'inicio' };
    case 'menuCerrar':
      return { k: 'cerrarMenu' };
    case 'menuEsc':
      return { k: 'cerrarTodo' };
    case 'enlUno':
      return enlace ? { k: 'cambiarTipoEnlace', id: enlace.id, tipo: 'seq' } : null;
    case 'enlDoble':
      return enlace ? { k: 'cambiarTipoEnlace', id: enlace.id, tipo: 'tool' } : null;
    case 'enlMedio':
      return enlace ? { k: 'abrirMenu', ancla: enlace.de, tipo: 'seq', insertarEn: enlace.id } : null;
    case 'enlQuitar':
      return enlace ? { k: 'quitarEnlace', id: enlace.id } : null;
    case 'selSig':
      return ajustes ? { k: 'abrirMenu', ancla: ajustes.id, tipo: 'seq' } : null;
    case 'selHerr':
      return ajustes ? { k: 'abrirMenu', ancla: ajustes.id, tipo: 'tool' } : null;
    case 'selQuitar':
      return ajustes ? { k: 'quitarNodo', id: ajustes.id } : null;
    case 'conEditar':
      return ajustes ? { k: 'abrirEnlace', id: elegir(rng, ajustes.conexiones).id } : null;
    case 'conQuitar':
      return ajustes ? { k: 'quitarEnlace', id: elegir(rng, ajustes.conexiones).id } : null;
    case 'trigTipo':
      return conDisp ? { k: 'editarNodo', id: conDisp.id, parche: { tipo: elegir(rng, conDisp.tipos).id } } : null;
    case 'trigCampo': {
      if (!conDisp) return null;
      const k = entero(rng, 3);
      if (k === 0 && conDisp.tiempo) return { k: 'editarNodo', id: conDisp.id, parche: { frec: elegir(rng, FRECUENCIAS) } };
      if (k === 1 && conDisp.web) return { k: 'editarNodo', id: conDisp.id, parche: { ruta: texto(rng, TEXTOS_RUTA, op.conClaves) } };
      if (conDisp.deApp) return { k: 'editarNodo', id: conDisp.id, parche: { app: elegir(rng, APPS_DISPARADOR) } };
      return null;
    }
    case 'ia':
      return conAgente ? { k: 'editarNodo', id: conAgente.id, parche: { ia: elegir(rng, conAgente.ias).id } } : null;
    case 'textoAg': {
      if (!conAgente) return null;
      const k = entero(rng, 4);
      const t = texto(rng, TEXTOS_LARGO, op.conClaves);
      // el campo «para qué sirve» solo está en un ayudante y la tarea solo donde se pide (como en el panel)
      if (k === 0) return { k: 'editarNodo', id: conAgente.id, parche: { nombre: texto(rng, TEXTOS_AGENTE, op.conClaves) } };
      if (k === 1 && conAgente.esAyudante) return { k: 'editarNodo', id: conAgente.id, parche: { desc: t } };
      if (k === 2 && conAgente.pideTarea) return { k: 'editarNodo', id: conAgente.id, parche: { tarea: t } };
      return { k: 'editarNodo', id: conAgente.id, parche: { instrucciones: t } };
    }
    case 'textoApp':
      return conApp ? { k: 'editarNodo', id: conApp.id, parche: { nombre: texto(rng, TEXTOS_APP, op.conClaves) } } : null;
    case 'sugerencia':
      return conApp ? { k: 'editarNodo', id: conApp.id, parche: { nombre: elegir(rng, conApp.sugerencias) } } : null;
    case 'cancelarConectar':
      return { k: 'cancelarConexion' };
    case 'drag': {
      const n = elegir(rng, nodos);
      // un arrastre sale a donde sea, también fuera del lienzo; el reductor lo acomoda
      if (rng() < 0.15) return { k: 'moverNodo', id: n.id, x: elegir(rng, [-500, 0, X_MAX, X_MAX + 900]), y: elegir(rng, [-500, 0, Y_MAX, Y_MAX + 900]) };
      const dx = (entero(rng, 41) - 20) * 40;
      const dy = (entero(rng, 41) - 20) * 40;
      return { k: 'moverNodo', id: n.id, x: n.x + dx, y: n.y + dy };
    }
    case 'tecla': {
      const n = elegir(rng, nodos);
      if (rng() < 0.17 || op.sinEdiciones === true) return { k: 'cerrarTodo' }; // Esc
      return { k: 'moverConTeclado', id: n.id, direccion: elegir(rng, DIRECCIONES), grande: rng() < 0.5 };
    }
    case 'limpiar':
      return { k: 'limpiar' };
    case 'nombreFlujo':
      return { k: 'renombrarFlujo', nombre: texto(rng, TEXTOS_FLUJO, op.conClaves) };
    case 'deshacer':
      return { k: 'deshacer' };
    case 'deshacerAviso':
      // el botón del aviso manda el id de su aviso; a veces el aviso ya es viejo
      return { k: 'deshacer', avisoId: (e.aviso?.id ?? 0) - (rng() < 0.15 ? 1 : 0) };
    case 'cargar':
      return { k: 'cargarFlujo', flujo: rng() < 0.4 ? flujoRoto(rng) : flujoBueno(rng) };
    case 'volverAjustes':
      return { k: 'volverDeAjustes' };
    case 'limpiarPeticiones':
      return rng() < 0.5 ? { k: 'limpiarPeticiones' } : { k: 'limpiarPeticiones', hasta: e.eventos - entero(rng, 3) };
    default:
      return null;
  }
}

// ---------------------------------------------------------------- gestos de un programa descuidado

const tipoAlAzar = (rng: () => number): TipoArista => (rng() < 0.5 ? 'seq' : 'tool');
const malo = (v: unknown): never => v as never;

/** Un parche de `editarNodo` cualquiera: de todos los tipos de cuadro y con valores buenos, malos y de tipo equivocado. */
function parcheAlAzar(rng: () => number, conClaves: boolean): ParcheNodo {
  switch (entero(rng, 13)) {
    case 0:
      return { nombre: texto(rng, TEXTOS_AGENTE, conClaves) };
    case 1:
      return { desc: texto(rng, TEXTOS_LARGO, conClaves) };
    case 2:
      return { tarea: texto(rng, TEXTOS_LARGO, conClaves) };
    case 3:
      return { instrucciones: texto(rng, TEXTOS_LARGO, conClaves) };
    case 4:
      return { ia: elegir(rng, IAS) };
    case 5:
      return { tipo: elegir(rng, TIPOS_DISPARADOR) };
    case 6:
      return { frec: elegir(rng, FRECUENCIAS) };
    case 7:
      return { ruta: texto(rng, TEXTOS_RUTA, conClaves) };
    case 8:
      return { app: elegir(rng, APPS_DISPARADOR) };
    case 9:
      return { nombre: texto(rng, TEXTOS_APP, conClaves) };
    case 10: // valores que no existen o de otro tipo: se ignoran
      return malo(elegir(rng, [{ ia: 'otra' }, { tipo: 'raro' }, { frec: 'cada-hora' }, { app: 'otra' }, { nombre: 42 }, { nombre: null }, { ruta: ['x'] }, { desc: false }]));
    case 11: // campos que no se editan a mano (y un `__proto__` PROPIO, como el que trae un JSON hostil)
      return malo(elegir(rng, [{ id: 'zz9' }, { kind: 'trigger' }, { x: 5 }, { y: 5 }, JSON.parse('{"__proto__":{"nombre":"x"}}') as object]));
    default: // dos campos a la vez
      return malo({ nombre: texto(rng, TEXTOS_AGENTE, conClaves), instrucciones: texto(rng, TEXTOS_LARGO, conClaves), ia: elegir(rng, IAS) });
  }
}

const EDICIONES_API: ReadonlySet<string> = new Set(['moverNodo', 'moverConTeclado', 'editarNodo', 'renombrarFlujo']);
const DESTRUCTIVOS: ReadonlySet<string> = new Set(['limpiar', 'cargarEjemplo', 'cargarFlujo', 'quitarNodo', 'quitarEnlace', 'deshacer']);

const METODOS_API: readonly (readonly [string, number])[] = [
  ['elegirDisparador', 3],
  ['abrirMenu', 14],
  ['pasoMenu', 4],
  ['crearDesdeMenu', 15],
  ['iniciarConexion', 6],
  ['intentarConexion', 8],
  ['cambiarTipoEnlace', 9],
  ['abrirEnlace', 5],
  ['quitarEnlace', 3],
  ['quitarNodo', 4],
  ['abrirNodo', 6],
  ['limpiar', 0.4],
  ['cargarEjemplo', 1],
  ['cargarFlujo', 1.2],
  ['editarNodo', 7],
  ['moverNodo', 3],
  ['moverConTeclado', 3],
  ['renombrarFlujo', 1],
  ['deshacer', 4],
  ['cerrarMenu', 1],
  ['cerrarTodo', 1],
  ['cancelarConexion', 1],
  ['volverDeAjustes', 0.5],
  ['limpiarPeticiones', 0.5],
];

/** Una acción cualquiera con ids vivos, fantasmas o que nunca existieron, y a veces con valores raros. */
export function gestoAPI(rng: () => number, e: E, m: Memoria, op: OpcionesGesto): A {
  // en «grande» casi nunca se borra ni se reemplaza el flujo: se quiere llegar a los topes
  const metodo = elegirConPeso(
    rng,
    METODOS_API.map(([k, w]) => [k, op.sinEdiciones === true && EDICIONES_API.has(k) ? 0 : op.grande && DESTRUCTIVOS.has(k) ? w * 0.1 : w] as const),
  );
  switch (metodo) {
    case 'elegirDisparador':
      return rng() < 0.9 ? { k: 'elegirDisparador', tipo: elegir(rng, TIPOS_DISPARADOR) } : malo({ k: 'elegirDisparador', tipo: 'raro' });
    case 'abrirMenu': {
      const ancla = idNodo(rng, e, m);
      const tipo: TipoArista = tipoAlAzar(rng);
      if (rng() < 0.5) return { k: 'abrirMenu', ancla, tipo };
      // «poner en medio»: la conexión de un solo sentido que sale del ancla (si hay), o cualquiera
      const salientes = e.flujo.edges.filter(x => x.tipo === 'seq' && x.de === ancla).map(x => x.id);
      const insertarEn = salientes.length > 0 && rng() < 0.7 ? elegir(rng, salientes) : idArista(rng, e, m, true);
      return rng() < 0.05 ? malo({ k: 'abrirMenu', ancla, tipo: 'raro', insertarEn }) : { k: 'abrirMenu', ancla, tipo, insertarEn };
    }
    case 'pasoMenu':
      return rng() < 0.85 ? { k: 'pasoMenu', paso: elegir(rng, ['app', 'inicio'] as const) } : malo({ k: 'pasoMenu', paso: 'raro' });
    case 'crearDesdeMenu': {
      if (rng() < 0.05) return malo({ k: 'crearDesdeMenu', que: 'raro' });
      if (rng() < 0.45) return { k: 'crearDesdeMenu', que: 'agente' };
      return rng() < 0.08 ? malo({ k: 'crearDesdeMenu', que: 'app', nombreApp: elegir(rng, [undefined, null, 42, ['Gmail']]) }) : { k: 'crearDesdeMenu', que: 'app', nombreApp: texto(rng, TEXTOS_APP, op.conClaves) };
    }
    case 'iniciarConexion': {
      const ancla = idNodo(rng, e, m);
      const rol = rng() < 0.5 ? 'origen' : 'destino';
      return rng() < 0.04 ? malo({ k: 'iniciarConexion', ancla, rol: 'raro', tipo: 'seq' }) : { k: 'iniciarConexion', ancla, rol, tipo: tipoAlAzar(rng) };
    }
    case 'intentarConexion':
      return { k: 'intentarConexion', id: idNodo(rng, e, m) };
    case 'cambiarTipoEnlace':
      return rng() < 0.04 ? malo({ k: 'cambiarTipoEnlace', id: idArista(rng, e, m), tipo: 'raro' }) : { k: 'cambiarTipoEnlace', id: idArista(rng, e, m), tipo: tipoAlAzar(rng) };
    case 'abrirEnlace':
      return { k: 'abrirEnlace', id: idArista(rng, e, m) };
    case 'quitarEnlace':
      return { k: 'quitarEnlace', id: idArista(rng, e, m) };
    case 'quitarNodo':
      return { k: 'quitarNodo', id: idNodo(rng, e, m) };
    case 'abrirNodo':
      return { k: 'abrirNodo', id: idNodo(rng, e, m), teclado: rng() < 0.3 };
    case 'limpiar':
      return { k: 'limpiar' };
    case 'cargarEjemplo':
      return { k: 'cargarEjemplo' };
    case 'cargarFlujo': {
      const k = entero(rng, 4);
      if (k === 0) return { k: 'cargarFlujo', flujo: flujoBueno(rng) };
      if (k === 1) return { k: 'cargarFlujo', flujo: flujoRoto(rng) };
      // lo que no es ni un flujo
      return malo({ k: 'cargarFlujo', flujo: elegir(rng, [null, undefined, 'texto', 7, [], {}, { nodes: 'x', edges: [] }, { nodes: [], edges: null }, { nodes: [null, 3], edges: [] }]) });
    }
    case 'editarNodo':
      return rng() < 0.03 ? malo({ k: 'editarNodo', id: idNodo(rng, e, m), parche: elegir(rng, [null, undefined, 'x', 3, []]) }) : { k: 'editarNodo', id: idNodo(rng, e, m), parche: parcheAlAzar(rng, op.conClaves) };
    case 'moverNodo': {
      const id = idNodo(rng, e, m);
      if (rng() < 0.2) return malo({ k: 'moverNodo', id, x: elegir(rng, [Number.NaN, Infinity, -Infinity, '40', null, undefined]), y: 40 });
      return { k: 'moverNodo', id, x: (entero(rng, 400) - 50) * 8, y: (entero(rng, 400) - 50) * 8 };
    }
    case 'moverConTeclado':
      return rng() < 0.1
        ? malo({ k: 'moverConTeclado', id: idNodo(rng, e, m), direccion: 'raro' })
        : { k: 'moverConTeclado', id: idNodo(rng, e, m), direccion: elegir(rng, DIRECCIONES), grande: rng() < 0.5 };
    case 'renombrarFlujo':
      return rng() < 0.08 ? malo({ k: 'renombrarFlujo', nombre: elegir(rng, [null, undefined, 5]) }) : { k: 'renombrarFlujo', nombre: texto(rng, TEXTOS_FLUJO, op.conClaves) };
    case 'deshacer': {
      const r = rng();
      if (r < 0.6) return { k: 'deshacer' };
      return { k: 'deshacer', avisoId: r < 0.85 ? (e.aviso?.id ?? 0) : entero(rng, e.eventos + 3) };
    }
    case 'cerrarMenu':
      return { k: 'cerrarMenu' };
    case 'cerrarTodo':
      return { k: 'cerrarTodo' };
    case 'cancelarConexion':
      return { k: 'cancelarConexion' };
    case 'volverDeAjustes':
      return { k: 'volverDeAjustes' };
    default:
      return { k: 'limpiarPeticiones', hasta: e.eventos - entero(rng, 4) };
  }
}

/** Los modos de una campaña. */
export type Modo = 'ui' | 'api' | 'mixto' | 'grande' | 'larga';

/** El siguiente gesto de una campaña. */
export function gesto(rng: () => number, e: E, m: Memoria, modo: Modo, conClaves: boolean): A {
  const op: OpcionesGesto = { grande: modo === 'grande', conClaves, sinEdiciones: modo === 'larga' };
  if (modo === 'api') return gestoAPI(rng, e, m, op);
  if (modo === 'ui') return gestoUI(rng, e, op) ?? gestoAPI(rng, e, m, op);
  if (modo === 'grande') return rng() < 0.12 ? gestoAPI(rng, e, m, op) : (gestoUI(rng, e, op) ?? gestoAPI(rng, e, m, op));
  return rng() < 0.7 ? (gestoUI(rng, e, op) ?? gestoAPI(rng, e, m, op)) : gestoAPI(rng, e, m, op);
}
