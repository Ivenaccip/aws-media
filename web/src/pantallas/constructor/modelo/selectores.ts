// Los selectores: lo que en el mockup hacía `renderVals` (Main.dc.html:1624-1906), como funciones
// PURAS que reciben el estado del Constructor y devuelven datos para los componentes. No pintan
// nada: ni colores (el guardián de paleta no admite ninguno en web/; las clases salen por NOMBRE de
// variante: `nodo-trig`, `nodo-sel`…), ni íconos (devuelven el NOMBRE del ícono de `ui/iconos.ts`),
// ni tocan el DOM, el reloj o el almacenamiento. No modifican lo que reciben.
//
// De dónde salen las cosas:
//   · `vistaNodo` / `vistaNodos`   cada cuadro: títulos, textos para lectores de pantalla, qué «+» lleva y si está en
//                                  modo «toca el cuadro destino» (Main:1667-1705).
//   · `flagsMas`                   los tres booleanos del «+» de la derecha y la patita (Main:1694-1698).
//   · `vistaFlechas`               una flecha por conexión: curva, puntas, insignia y textos (Main:1707-1747).
//   · `vistaMenu`, `vistaLienzo`   el menú flotante del «+» y el tamaño del lienzo (Main:1749-1784 y 1885).
//   · `vistaAjustes`               el panel de un cuadro elegido y su lista de conexiones (Main:1786-1836).
//   · `vistaEnlace`                el editor de la flecha elegida (Main:1838-1856).
//   · `panelDeAjustes`             cuál de los dos paneles toca (cuadro, flecha o ninguno).
//   · `guia`, `textoSinSeleccion`, `textoConectar`, `vistaElegirDisparador`, `resumenFlujo`.
//
// El estado de entrada es el del reductor (`EstadoConstructor`): el flujo va anidado en `flujo`. Se
// declara aquí solo lo que los selectores leen (`EstadoVista`), así que un `EstadoConstructor` entero
// los cumple tal cual, y las pruebas arman estados chiquitos.
//
// Cambios deliberados respecto del mockup (cada uno está probado en selectores.test.ts):
//   · La lista de conexiones de una APP que es herramienta decía «Conversa con «Agente»»; ahora dice
//     «Es herramienta de «Agente»» (el texto existía en el mockup pero era inalcanzable).
//   · Un cuadro que NO se puede elegir como destino al conectar trae el motivo (`motivoNulo`), para
//     que el componente lo marque con `aria-disabled` y lo lea (informe 04 §6.8); el mockup solo lo
//     oscurecía.
//   · Si la flecha elegida tiene un extremo que ya no existe, no hay panel de flecha (el mockup
//     abría un panel en blanco).

import { altoLienzo, anchoLienzo } from './colocacion';
import { APPS, APPS_DISPARADOR, appDe, FRECUENCIAS, ICONO_AGENTE, ICONO_APP, iaDe, IAS, tipoDeDisparador, TIPOS_DISPARADOR } from './catalogo';
import { TOPE_AGENTES, TOPE_APPS } from './datos/constantes';
import { revisarFlujo } from './exportar';
import { geometriaFlecha, posicionMenu, type FormaFlecha } from './geometria';
import { candidatos, padreDe, puedeEnlazar, soloAppsPorLaPatita, tocaSeq } from './grafo';
import * as T from './textos';
import { frecTexto, rutaLimpia, tituloDe } from './texto';
import type {
  Arista,
  AppDisparador,
  Conectando,
  Flujo,
  Frecuencia,
  IconoDisparador,
  IdIA,
  MenuMas,
  Nodo,
  NodoAgente,
  NodoApp,
  NodoDisparador,
  Punto,
  TipoArista,
  TipoDisparador,
} from './tipos';

// ================================================================ lo que entra

/** Lo que los selectores leen del estado del Constructor. Un `EstadoConstructor` lo cumple tal cual. */
export interface EstadoVista {
  /** El flujo: cuadros, conexiones y nombre. */
  readonly flujo: Flujo;
  /** El cuadro elegido. */
  readonly sel: string | null;
  /** La conexión elegida. */
  readonly selEdge: string | null;
  /** El menú del «+» abierto. */
  readonly menu: MenuMas | null;
  /** El modo «toca el cuadro destino». */
  readonly conectando: Conectando | null;
}

/** Lo que leen los selectores que solo miran el flujo. */
export type FlujoVista = Pick<EstadoVista, 'flujo'>;

// ---------------------------------------------------------------- índice interno

interface Contexto {
  readonly nodes: readonly Nodo[];
  readonly edges: readonly Arista[];
  /** id → cuadro. Un `Map`: un id como `constructor` o `__proto__` no toca el prototipo. */
  readonly por: ReadonlyMap<string, Nodo>;
}

function contexto(flujo: Pick<Flujo, 'nodes' | 'edges'>): Contexto {
  return { nodes: flujo.nodes, edges: flujo.edges, por: new Map(flujo.nodes.map(n => [n.id, n] as const)) };
}

/** El cuadro del que este es herramienta o ayudante, o null (también si el padre ya no existe). */
function padreNodo(c: Contexto, id: string): Nodo | null {
  const pid = padreDe(c.edges, id);
  return pid === null ? null : (c.por.get(pid) ?? null);
}

/** ¿Algo sigue a este cuadro (sale de él una conexión de un solo sentido)? */
const hayDespues = (c: Contexto, id: string): boolean => c.edges.some(e => e.tipo === 'seq' && e.de === id);

/** El menú abierto, solo si su ancla todavía existe. */
function menuVigente(estado: EstadoVista, c: Contexto): MenuMas | null {
  const m = estado.menu;
  return m && c.por.has(m.ancla) ? m : null;
}

/** Los textos entre «» de un cuadro: «Disparador Chat», el nombre del agente o de la app. */
const nombreEntre = (n: Nodo | null | undefined): string => `«${tituloDe(n)}»`;

/** Por qué una IA no puede ir por la patita (solo van apps). Es la primera parte del aviso del mockup (la frase vive en textos.ts). */
export const MOTIVO_SOLO_APPS = T.MOTIVO_SOLO_APPS;

// ================================================================ el «+» de cada cuadro

/** Los booleanos del «+» de la derecha y de la patita de un cuadro. */
export interface FlagsMas {
  /** ¿Se le puede agregar lo que sigue? No si es una herramienta (una app con padre) ni si conversa con otra IA. */
  puedeDer: boolean;
  /** Muestra el «+» suelto de la derecha (puede, y todavía no le sigue nada). */
  stubDer: boolean;
  /** Muestra el «+» redondo, pegado al cuadro (puede, y ya le sigue algo). */
  asaDer: boolean;
  /** Tiene patita (los agentes dan herramientas). */
  patita: boolean;
  /** ¿Conversa con otra IA (es el padre de un agente)? Entonces lo que sigue se agrega desde esa IA. */
  conversaCon: boolean;
}

function flagsDe(c: Contexto, n: Nodo): FlagsMas {
  const esT = padreNodo(c, n.id) !== null;
  const conversaCon = c.edges.some(e => e.tipo === 'tool' && e.de === n.id && c.por.get(e.a)?.kind === 'agent');
  const puedeDer = (!esT || n.kind === 'agent') && !conversaCon;
  const hay = hayDespues(c, n.id);
  return { puedeDer, stubDer: puedeDer && !hay, asaDer: puedeDer && hay, patita: n.kind === 'agent', conversaCon };
}

/**
 * Los flags del «+» de un cuadro. `puedeDer = (no es herramienta o es agente) y no conversa con otra
 * IA`; `stubDer`/`asaDer` dicen cuál de los dos «+» se pinta; `patita` es «es agente».
 */
export function flagsMas(flujo: Pick<Flujo, 'nodes' | 'edges'>, nodo: Nodo): FlagsMas {
  return flagsDe(contexto(flujo), nodo);
}

// ================================================================ cada cuadro

/** De qué clase es el cuadro (decide su borde y su ícono). */
export type VarianteNodo = 'disparador' | 'agente' | 'app';

/** El ícono (de `ui/iconos.ts`) de un cuadro. */
export type IconoNodo = IconoDisparador | typeof ICONO_AGENTE;

/** En modo «toca el cuadro destino»: el cuadro del que se partió, uno al que se puede llegar, o uno al que no. */
export type ModoConexion = 'ancla' | 'destino' | 'nulo';

/** Lo que hace falta para pintar un cuadro. */
export interface VistaNodo {
  id: string;
  x: number;
  y: number;
  kind: Nodo['kind'];
  variante: VarianteNodo;
  /** ¿Es la herramienta o el ayudante de un agente? */
  esHerramienta: boolean;
  /** ¿Es el cuadro elegido? */
  seleccionado: boolean;
  /** «Disparador», «Agente de IA», «Agente de IA que conversa con «P»», «App», «App · paso del flujo»… */
  tipo: string;
  /** La versión corta de `tipo` para el cuadro («Agente · conversa»). */
  tipoCorto: string;
  /** El título: «Chat» para un disparador; el nombre del agente o de la app. */
  titulo: string;
  /** La línea de abajo: la frecuencia, la ruta, el proveedor de IA, «Lista para n8n»… */
  detalle: string;
  icono: IconoNodo;
  /** `tipo + ': ' + titulo`: el `aria-label` y el `title` del cuadro. */
  etiqueta: string;
  /** Solo en modo «conectando»: el papel de este cuadro. */
  modoConexion: ModoConexion | null;
  /** Solo si `modoConexion === 'nulo'`: por qué no se puede llegar a este cuadro (para `aria-disabled` y el lector de pantalla). */
  motivoNulo: string | null;
  /** ¿Lleva el realce de elegido? (el elegido fuera del modo conectando, o el ancla dentro de él) */
  resaltado: boolean;
  /** Las clases del mockup, por nombre: `nodo-trig|nodo-ag|nodo-app`, `nodo-tool`, `nodo-sel`, `nodo-destino|nodo-nulo`. */
  clase: string;
  puedeDer: boolean;
  stubDer: boolean;
  asaDer: boolean;
  patita: boolean;
  /** ¿Está abierto el menú de «lo que sigue» de este cuadro? */
  abiertoDer: boolean;
  /** ¿Está abierto el menú de herramientas de este cuadro? */
  abiertoTool: boolean;
  etiquetaMasDer: string;
  etiquetaMasTool: string;
  etiquetaQuitar: string;
}

const CLASE_DE: Record<VarianteNodo, string> = { disparador: 'nodo-trig', agente: 'nodo-ag', app: 'nodo-app' };

function detalleDeDisparador(n: NodoDisparador): string {
  if (n.tipo === 'tiempo') return frecTexto(n.frec);
  if (n.tipo === 'web') return `/webhook/${rutaLimpia(n.ruta) || '…'}`;
  if (n.tipo === 'app') return (APPS_DISPARADOR.find(a => a.id === n.app) ?? APPS_DISPARADOR[0])?.detalle ?? 'Gmail: correo nuevo';
  return 'Mensaje en el chat';
}

interface TextosNodo {
  tipo: string;
  tipoCorto: string;
  titulo: string;
  detalle: string;
  icono: IconoNodo;
  variante: VarianteNodo;
}

function textosDe(c: Contexto, n: Nodo, padre: Nodo | null): TextosNodo {
  if (n.kind === 'trigger') {
    const t = tipoDeDisparador(n.tipo);
    return { tipo: 'Disparador', tipoCorto: 'Disparador', titulo: t.nombre, detalle: detalleDeDisparador(n), icono: t.icono, variante: 'disparador' };
  }
  if (n.kind === 'agent') {
    const tipo = padre ? `Agente de IA que conversa con «${tituloDe(padre)}»` : 'Agente de IA';
    return { tipo, tipoCorto: padre ? 'Agente · conversa' : tipo, titulo: tituloDe(n), detalle: iaDe(n.ia).nombre, icono: ICONO_AGENTE, variante: 'agente' };
  }
  const nombre = String(n.nombre || '').trim();
  const recibe = c.edges.some(e => e.tipo === 'seq' && e.a === n.id);
  const tipo = padre ? `App · herramienta de «${tituloDe(padre)}»` : recibe ? 'App · paso del flujo' : 'App';
  return {
    tipo,
    tipoCorto: padre ? 'App · herramienta' : tipo,
    titulo: tituloDe(n),
    detalle: nombre ? (appDe(nombre) ? 'Lista para n8n' : 'La configuras tú en n8n') : 'Ponle un nombre',
    icono: ICONO_APP,
    variante: 'app',
  };
}

function vistaDeNodo(estado: EstadoVista, c: Contexto, n: Nodo): VistaNodo {
  const padre = padreNodo(c, n.id);
  const esT = padre !== null;
  const con = estado.conectando;
  const menuSt = menuVigente(estado, c);
  const txt = textosDe(c, n, padre);
  const seleccionado = n.id === estado.sel;

  let modoConexion: ModoConexion | null = null;
  let motivoNulo: string | null = null;
  if (con) {
    if (n.id === con.ancla) modoConexion = 'ancla';
    else {
      const de = con.rol === 'origen' ? con.ancla : n.id;
      const a = con.rol === 'origen' ? n.id : con.ancla;
      const regla = puedeEnlazar(estado.flujo, de, a, con.tipo);
      const soloApps = soloAppsPorLaPatita(con.tipo, con.rol, n);
      if (regla.ok && !soloApps) modoConexion = 'destino';
      else {
        modoConexion = 'nulo';
        // si el rechazo viene de las dos reglas a la vez, manda la de las 12 (es la primera que se evalúa)
        motivoNulo = regla.ok ? MOTIVO_SOLO_APPS : regla.motivo;
      }
    }
  }
  const resaltado = (seleccionado && !con) || modoConexion === 'ancla';
  const clase = [
    CLASE_DE[txt.variante],
    esT ? 'nodo-tool' : '',
    seleccionado && !con ? 'nodo-sel' : '',
    modoConexion === 'ancla' ? 'nodo-sel' : modoConexion === 'destino' ? 'nodo-destino' : modoConexion === 'nulo' ? 'nodo-nulo' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const f = flagsDe(c, n);
  const nombreCorto = tituloDe(n);
  return {
    id: n.id,
    x: n.x,
    y: n.y,
    kind: n.kind,
    variante: txt.variante,
    esHerramienta: esT,
    seleccionado,
    tipo: txt.tipo,
    tipoCorto: txt.tipoCorto,
    titulo: txt.titulo,
    detalle: txt.detalle,
    icono: txt.icono,
    etiqueta: `${txt.tipo}: ${txt.titulo}`,
    modoConexion,
    motivoNulo,
    resaltado,
    clase,
    puedeDer: f.puedeDer,
    stubDer: f.stubDer,
    asaDer: f.asaDer,
    patita: f.patita,
    abiertoDer: !!menuSt && menuSt.ancla === n.id && menuSt.tipo === 'seq' && !menuSt.insertarEn,
    abiertoTool: !!menuSt && menuSt.ancla === n.id && menuSt.tipo === 'tool',
    etiquetaMasDer: `Agregar lo que sigue después de «${nombreCorto}»: una app o un agente de IA`,
    etiquetaMasTool: `Darle una herramienta a «${nombreCorto}»: una app`,
    etiquetaQuitar: `Quitar «${nombreCorto}»`,
  };
}

/** Todos los cuadros, en el orden del flujo. Arma el índice una sola vez: es lo que usa el lienzo. */
export function vistaNodos(estado: EstadoVista): VistaNodo[] {
  const c = contexto(estado.flujo);
  return c.nodes.map(n => vistaDeNodo(estado, c, n));
}

/** Un solo cuadro (el que se pasa debe ser del flujo del estado). */
export function vistaNodo(estado: EstadoVista, nodo: Nodo): VistaNodo {
  return vistaDeNodo(estado, contexto(estado.flujo), nodo);
}

// ================================================================ las flechas

/** El nombre del ícono (de `ui/iconos.ts`) de la insignia de una flecha. */
export type IconoFlecha = 'unSentido' | 'idaYVuelta';

/** Lo que hace falta para pintar una conexión y el botón que la edita. */
export interface VistaFlecha {
  id: string;
  de: string;
  a: string;
  tipo: TipoArista;
  /** `paso` (un solo sentido), `conversan` (dos agentes) o `herramienta` (la patita). */
  forma: FormaFlecha;
  /** ¿Es la conexión elegida? */
  activa: boolean;
  /** El grueso del trazo: 3 si está elegida, 2 si no. */
  ancho: 2 | 3;
  /** ¿Va punteada? (`tool`: 6 6; `seq`: continua) */
  punteada: boolean;
  /** El trazo de la curva. */
  d: string;
  /** Las puntas (una o dos) como un solo trazo relleno. */
  puntas: string;
  /** El centro de la insignia, en px enteros. */
  medio: Punto;
  /** La esquina superior izquierda de la insignia de 44×44. */
  insignia: Punto;
  icono: IconoFlecha;
  /** «Conexión de «A» a «B»: un solo sentido. Editar» (el `aria-label` del botón). */
  etiqueta: string;
  /** «Un solo sentido. Toca para editarla.» (el `title`; distinto de la etiqueta a propósito). */
  titulo: string;
}

/** Una por conexión cuyos dos extremos existen, en el orden de las conexiones. */
export function vistaFlechas(estado: EstadoVista): VistaFlecha[] {
  const c = contexto(estado.flujo);
  const salida: VistaFlecha[] = [];
  for (const e of c.edges) {
    const A = c.por.get(e.de);
    const B = c.por.get(e.a);
    if (!A || !B) continue;
    const g = geometriaFlecha(e, A, B);
    const activa = estado.selEdge === e.id;
    const uno = e.tipo === 'seq';
    salida.push({
      id: e.id,
      de: e.de,
      a: e.a,
      tipo: e.tipo,
      forma: g.forma,
      activa,
      ancho: activa ? 3 : 2,
      punteada: !uno,
      d: g.d,
      puntas: g.puntas,
      medio: g.medio,
      insignia: g.insignia,
      icono: uno ? 'unSentido' : 'idaYVuelta',
      etiqueta: `Conexión de «${tituloDe(A)}» a «${tituloDe(B)}»: ${uno ? 'un solo sentido' : 'ida y vuelta'}. Editar`,
      titulo: uno ? 'Un solo sentido. Toca para editarla.' : 'Ida y vuelta. Toca para editarla.',
    });
  }
  return salida;
}

// ================================================================ el menú del «+»

/** Una de las opciones de la pantalla de inicio del menú. */
export interface OpcionMenu {
  id: 'app' | 'agente' | 'existente';
  titulo: string;
  detalle: string;
  /** El ícono de `ui/iconos.ts`. */
  icono: 'app' | 'magia' | 'enlace';
  /** Bloqueada por un tope: se pinta con `aria-disabled` y, al pulsarla, AVISA el motivo (no se apaga con `disabled`, para poder enfocarla y leerla). */
  bloqueada: boolean;
  /** El motivo, solo si está bloqueada. */
  motivo: string | null;
  /** ¿Es la primera no bloqueada? Ahí va el foco al abrir. */
  primera: boolean;
}

/** Una app de la lista del menú. */
export interface AppDelMenu {
  nombre: string;
  /** ¿Es la primera de la lista? Ahí va el foco al pasar a esta pantalla. */
  primera: boolean;
}

/** Lo que hace falta para pintar el menú flotante del «+». */
export interface VistaMenu {
  /** El cuadro del que sale lo nuevo. */
  ancla: string;
  tipo: TipoArista;
  paso: MenuMas['paso'];
  /** La conexión en cuyo medio se inserta, o null. */
  insertarEn: string | null;
  titulo: string;
  nota: string;
  /** ¿Se pinta la nota? (en la pantalla de inicio, o siempre en el menú de herramientas) */
  hayNota: boolean;
  esInicio: boolean;
  esApp: boolean;
  opciones: OpcionMenu[];
  apps: AppDelMenu[];
  /** ¿Hay botón «Atrás» en la pantalla de apps? (no en el menú de herramientas, que abre directo ahí) */
  hayAtras: boolean;
  /** ¿Se ofrece «Uno que ya está en el lienzo» en la pantalla de apps? (solo en el menú de herramientas) */
  hayExistente: boolean;
  /** La esquina superior izquierda, en px de lienzo. */
  x: number;
  y: number;
  /** El alto que se le reserva (580 en la lista de apps, 340 en la de inicio). */
  alto: number;
  /** Hasta dónde necesita llegar el lienzo hacia abajo para que quepa. */
  fondo: number;
}

/** El menú del «+», o null si no hay uno abierto (o si su ancla ya no existe). */
export function vistaMenu(estado: EstadoVista): VistaMenu | null {
  const c = contexto(estado.flujo);
  const m = menuVigente(estado, c);
  const A = m ? c.por.get(m.ancla) : undefined;
  if (!m || !A) return null;
  const { tipo, paso, insertarEn } = m;
  const nombreA = tituloDe(A);

  let medioInsertar: Punto | null = null;
  if (insertarEn) {
    const e = c.edges.find(x => x.id === insertarEn);
    const De = e ? c.por.get(e.de) : undefined;
    const Ad = e ? c.por.get(e.a) : undefined;
    if (e && De && Ad) medioInsertar = geometriaFlecha(e, De, Ad).medio;
  }
  const conDespues = hayDespues(c, A.id);
  const pos = posicionMenu({ ancla: A, tipo, paso, medioInsertar, hayDespues: conDespues, anchoLienzo: anchoLienzo(c.nodes) });

  const nApps = c.nodes.filter(n => n.kind === 'app').length;
  const nAgentes = c.nodes.filter(n => n.kind === 'agent').length;
  const bloqApp = nApps >= TOPE_APPS;
  const bloqAgente = nAgentes >= TOPE_AGENTES;
  // por la patita solo van apps: los candidatos de herramienta se filtran a apps
  const hayCand = !insertarEn && candidatos(estado.flujo, A.id, tipo).some(n => tipo !== 'tool' || n.kind === 'app');

  const opciones: OpcionMenu[] = [
    {
      id: 'app',
      titulo: 'Una aplicación',
      detalle:
        tipo === 'tool'
          ? 'Gmail, Google Sheets, Slack… El agente la usa cuando la necesita y recibe lo que responde.'
          : `Gmail, Slack, Google Sheets… Hace algo con la respuesta de «${nombreA}».`,
      icono: 'app',
      bloqueada: bloqApp,
      motivo: bloqApp ? T.topeApps().texto : null,
      primera: false,
    },
  ];
  // otra IA siempre va como el paso que sigue: la patita (herramientas) solo ofrece apps
  if (tipo !== 'tool') {
    opciones.push({
      id: 'agente',
      titulo: 'Un agente de IA',
      detalle: 'Piensa y decide qué responder con lo que recibe.',
      icono: 'magia',
      bloqueada: bloqAgente,
      motivo: bloqAgente ? T.topeAgentes().texto : null,
      primera: false,
    });
  }
  if (hayCand) {
    opciones.push({
      id: 'existente',
      titulo: 'Uno que ya está en el lienzo',
      detalle: 'Conecta con un cuadro que ya pusiste, en vez de crear uno nuevo.',
      icono: 'enlace',
      bloqueada: false,
      motivo: null,
      primera: false,
    });
  }
  const primero = opciones.find(o => !o.bloqueada);
  if (primero) primero.primera = true;

  const nota = insertarEn
    ? ''
    : tipo === 'tool'
      ? `Una herramienta no va después de nada: «${nombreA}» la consulta solo cuando la necesita y recibe lo que ella responde. Aquí solo van apps; si quieres que otra IA converse con esta, ponla como el paso que sigue (el + de la derecha) y toca su flecha.`
      : conDespues
        ? 'Esto se suma a lo que ya sigue: los dos correrán a la vez. Para meter un cuadro entre ellos, toca la flecha y elige «Poner un cuadro en medio».'
        : '';
  const titulo =
    paso === 'app'
      ? tipo === 'tool'
        ? `Darle una herramienta a «${nombreA}»`
        : 'Elige la aplicación'
      : insertarEn
        ? 'Poner en medio'
        : tipo === 'tool'
          ? `Darle una herramienta a «${nombreA}»`
          : `Agregar después de «${nombreA}»`;

  return {
    ancla: m.ancla,
    tipo,
    paso,
    insertarEn,
    titulo,
    nota,
    hayNota: !!nota && (paso === 'inicio' || tipo === 'tool'),
    esInicio: paso === 'inicio',
    esApp: paso === 'app',
    opciones,
    apps: APPS.map((a, i) => ({ nombre: a.nombre, primera: i === 0 })),
    hayAtras: tipo !== 'tool',
    hayExistente: tipo === 'tool' && hayCand,
    x: pos.x,
    y: pos.y,
    alto: pos.alto,
    fondo: pos.fondo,
  };
}

/** El tamaño del lienzo: lo que piden los cuadros, y también lo que pide el menú abierto para que quepa. */
export function vistaLienzo(estado: EstadoVista): { ancho: number; alto: number } {
  const menu = vistaMenu(estado);
  return { ancho: anchoLienzo(estado.flujo.nodes), alto: Math.max(altoLienzo(estado.flujo.nodes), menu ? menu.fondo : 0) };
}

// ================================================================ el panel de Ajustes de un cuadro

/** Una conexión del cuadro elegido, para la lista del panel. */
export interface ConexionDeLista {
  /** El id de la conexión. */
  id: string;
  /** «Después va «X»», «Viene de «X»», «Conversa con «X»», «Herramienta: «X»» o «Es herramienta de «X»». */
  texto: string;
  /** El `aria-label` del botón de editarla. */
  etiquetaEditar: string;
  /** El `aria-label` del botón de quitarla. */
  etiquetaQuitar: string;
}

/** Lo que tienen en común los tres paneles. */
export interface AjustesComunes {
  id: string;
  /** ¿Es la herramienta o el ayudante de otro cuadro? */
  esHerramienta: boolean;
  /** El título del cuadro del que cuelga, o '' si no cuelga de ninguno. */
  padreNombre: string;
  /** La frase que explica qué papel juega este cuadro. */
  rolTexto: string;
  /** ¿Se ofrece «Agregar lo que sigue»? */
  btnSig: boolean;
  /** «Agregar el primer paso» (disparador) o «Agregar lo que sigue». */
  textoSig: string;
  /** ¿Se ofrece «Darle una herramienta»? (solo agentes) */
  btnHerr: boolean;
  conexiones: ConexionDeLista[];
}

/** Una de las IA que se pueden elegir para un agente. */
export interface OpcionIA {
  id: IdIA;
  nombre: string;
  detalle: string;
  activa: boolean;
}

/** El panel de un agente. */
export interface AjustesAgente extends AjustesComunes {
  panel: 'agente';
  nodo: NodoAgente;
  /** ¿Conversa con otro agente (es su ayudante)? Entonces pide «¿Para qué le sirve a «P»?» y no pide tarea. */
  esAyudante: boolean;
  /** ¿Se pide la tarea? No si le llega un chat directo ni si es ayudante. */
  pideTarea: boolean;
  /** El rótulo del campo de la tarea. */
  etiquetaTarea: string;
  ias: OpcionIA[];
}

/** Un tipo de disparador que se puede elegir. */
export interface OpcionTipoDisparador {
  id: TipoDisparador;
  nombre: string;
  detalle: string;
  activa: boolean;
}

/** El panel de un disparador. */
export interface AjustesDisparador extends AjustesComunes {
  panel: 'disparador';
  nodo: NodoDisparador;
  tipos: OpcionTipoDisparador[];
  /** ¿Es de tiempo (pide frecuencia)? */
  tiempo: boolean;
  /** ¿Es web (pide la ruta)? */
  web: boolean;
  /** ¿Es de una app (pide cuál)? */
  deApp: boolean;
  /** La frecuencia elegida (`dia` si no hay). */
  frecuencia: Frecuencia;
  /** La ruta tal como la escribió la persona. */
  ruta: string;
  /** La app elegida (`gmail` si no hay). */
  appDisparador: AppDisparador;
  /** «https://tu-n8n.com/webhook/<ruta limpia>» */
  enlace: string;
  opcionesFrecuencia: { id: Frecuencia; texto: string }[];
  opcionesApp: { id: AppDisparador; texto: string }[];
}

/** El panel de una app. */
export interface AjustesApp extends AjustesComunes {
  panel: 'app';
  nodo: NodoApp;
  /** Si n8n sabe conectarse a ella, si no, o si falta el nombre. */
  notaApp: string;
  /** Los nombres de las apps con conector listo, para elegir de un toque. */
  sugerencias: string[];
}

/** El panel del cuadro elegido. */
export type VistaAjustes = AjustesAgente | AjustesDisparador | AjustesApp;

function textoDeConexion(e: Arista, elegido: Nodo, otro: Nodo): string {
  const nombre = nombreEntre(otro);
  if (e.tipo === 'seq') return e.de === elegido.id ? `Después va ${nombre}` : `Viene de ${nombre}`;
  if (e.de === elegido.id) return otro.kind === 'agent' ? `Conversa con ${nombre}` : `Herramienta: ${nombre}`;
  // el elegido es el que cuelga: un ayudante conversa con su agente; una app es su herramienta
  return elegido.kind === 'agent' ? `Conversa con ${nombre}` : `Es herramienta de ${nombre}`;
}

/** El panel del cuadro elegido, o null si no hay uno (o si ya no existe). */
export function vistaAjustes(estado: EstadoVista): VistaAjustes | null {
  const c = contexto(estado.flujo);
  const n = estado.sel === null ? undefined : c.por.get(estado.sel);
  if (!n) return null;
  const id = n.id;
  const padre = padreNodo(c, id);
  const esT = padre !== null;
  const padreNombre = padre ? tituloDe(padre) : '';
  const nAyudantes = c.edges.filter(e => e.tipo === 'tool' && e.de === id && c.por.get(e.a)?.kind === 'agent').length;
  const conexiones: ConexionDeLista[] = [];
  for (const e of c.edges) {
    if (e.de !== id && e.a !== id) continue;
    const otro = c.por.get(e.de === id ? e.a : e.de);
    if (!otro) continue;
    const texto = textoDeConexion(e, n, otro);
    conexiones.push({ id: e.id, texto, etiquetaEditar: `Editar la conexión: ${texto}`, etiquetaQuitar: `Quitar la conexión: ${texto}` });
  }
  const base = {
    id,
    esHerramienta: esT,
    padreNombre,
    btnSig: (!esT || n.kind === 'agent') && nAyudantes === 0,
    textoSig: n.kind === 'trigger' ? 'Agregar el primer paso' : 'Agregar lo que sigue',
    btnHerr: n.kind === 'agent',
    conexiones,
  };

  if (n.kind === 'agent') {
    const antes = c.edges
      .filter(e => e.tipo === 'seq' && e.a === id)
      .map(e => c.por.get(e.de))
      .filter((x): x is Nodo => x !== undefined);
    const chatDirecto = antes.some(p => p.kind === 'trigger' && p.tipo === 'chat');
    const trasDisparador = antes.some(p => p.kind === 'trigger' && p.tipo !== 'chat');
    const rolTexto = esT
      ? `Esta IA conversa con «${padreNombre}»: ella le pide algo, esta responde, y así van y vienen hasta quedar conformes. Lo que siga después recibe la respuesta final de «${padreNombre}». Toca el + de la derecha para agregar ese paso, o el + de su patita para darle apps.`
      : nAyudantes > 0
        ? 'Este agente conversa con otra IA (a su derecha). Lo que siga después se agrega con el + de esa IA y recibe la respuesta final de este agente.'
        : 'Toca el + que está a la derecha del cuadro para agregar lo que sigue (una app u otra IA), o el + de su patita (abajo) para darle apps como herramientas, que él consulta solo cuando las necesita. Para que dos IA conversen, ponlas una después de otra y toca su flecha.';
    return {
      ...base,
      panel: 'agente',
      nodo: n,
      rolTexto,
      esAyudante: esT,
      pideTarea: !chatDirecto && !esT,
      etiquetaTarea: trasDisparador
        ? '¿Qué debe hacer cada vez que se dispare?'
        : 'Instrucción para este paso (opcional: recibe lo que salió del paso anterior)',
      ias: IAS.map(ia => ({ id: ia.id, nombre: ia.nombre, detalle: ia.detalle, activa: n.ia === ia.id })),
    };
  }

  if (n.kind === 'trigger') {
    return {
      ...base,
      panel: 'disparador',
      nodo: n,
      rolTexto:
        'El disparador es el inicio del flujo: nada puede ir antes de él. Toca el + que está a la derecha del cuadro para agregar el primer paso. Si lo quitas con la ×, tendrás que elegir otro para que el flujo arranque.',
      tipos: TIPOS_DISPARADOR.map(t => ({ id: t.id, nombre: t.nombre, detalle: t.detalle, activa: n.tipo === t.id })),
      tiempo: n.tipo === 'tiempo',
      web: n.tipo === 'web',
      deApp: n.tipo === 'app',
      frecuencia: n.frec || 'dia',
      ruta: n.ruta || '',
      appDisparador: n.app || 'gmail',
      enlace: `https://tu-n8n.com/webhook/${rutaLimpia(n.ruta) || 'mi-flujo'}`,
      opcionesFrecuencia: FRECUENCIAS.map(f => ({ id: f.id, texto: f.opcion })),
      opcionesApp: APPS_DISPARADOR.map(a => ({ id: a.id, texto: a.opcion })),
    };
  }

  const nombre = String(n.nombre || '').trim();
  return {
    ...base,
    panel: 'app',
    nodo: n,
    notaApp: !nombre
      ? 'Escribe el nombre de la app que quieres usar.'
      : appDe(nombre)
        ? 'n8n ya sabe conectarse a esta app.'
        : 'n8n no trae un conector listo para esta app: la conexión la configuras tú dentro de n8n.',
    rolTexto: esT
      ? `Es una HERRAMIENTA del agente «${padreNombre}»: ida y vuelta. El agente decide cuándo usarla y recibe su respuesta. Para que sea un paso del flujo, edita la conexión (botón Editar).`
      : tocaSeq(c.edges, id)
        ? 'Es un PASO del flujo: corre después de la respuesta del cuadro anterior (un solo sentido). Para que un agente la use como herramienta, edita la conexión (botón Editar).'
        : 'Sin conectar todavía. Toca el + de otro cuadro para ponerla después, o el + de la patita de un agente para dársela como herramienta.',
    sugerencias: APPS.map(a => a.nombre),
  };
}

// ================================================================ el editor de una flecha

/** Una de las dos maneras de conectar: un solo sentido o ida y vuelta. */
export interface OpcionEnlace {
  tipo: TipoArista;
  /** ¿Es la que tiene hoy la conexión? */
  activa: boolean;
  /** ¿No se puede elegir? Nunca la activa. Se pinta con `aria-disabled` y su nota (no se apaga con `disabled`). */
  noElegible: boolean;
  /** «No se puede: <motivo>», solo si `noElegible`. */
  nota: string | null;
}

/** Lo que hace falta para pintar el editor de la conexión elegida. */
export interface VistaEnlace {
  id: string;
  de: string;
  a: string;
  deNombre: string;
  aNombre: string;
  /** ¿Es hoy de un solo sentido? */
  esUno: boolean;
  uno: OpcionEnlace;
  doble: OpcionEnlace;
  /** Lo que significa «Ida y vuelta» para ESTE par (distinto si el destino es un agente). */
  textoDoble: string;
  /** ¿Se ofrece «Poner un cuadro en medio»? (solo en un solo sentido) */
  puedeMedio: boolean;
}

/**
 * El editor de la conexión elegida, o null si no hay una, si ya no existe, si le falta un extremo, o si
 * además hay un cuadro elegido (manda el cuadro). La opción que NO es la actual se prueba sobre el flujo
 * SIN esta conexión: si con ella fuera de en medio no se puede, queda como no elegible con su motivo.
 */
export function vistaEnlace(estado: EstadoVista): VistaEnlace | null {
  const c = contexto(estado.flujo);
  if (estado.sel !== null && c.por.has(estado.sel)) return null;
  const e = estado.selEdge === null ? undefined : c.edges.find(x => x.id === estado.selEdge);
  const A = e ? c.por.get(e.de) : undefined;
  const B = e ? c.por.get(e.a) : undefined;
  if (!e || !A || !B) return null;

  const resto = { nodes: c.nodes, edges: c.edges.filter(x => x.id !== e.id) };
  const esUno = e.tipo === 'seq';
  const otro = (tipo: TipoArista): OpcionEnlace => {
    const activa = e.tipo === tipo;
    if (activa) return { tipo, activa, noElegible: false, nota: null };
    const r = puedeEnlazar(resto, A.id, B.id, tipo);
    return r.ok ? { tipo, activa, noElegible: false, nota: null } : { tipo, activa, noElegible: true, nota: `No se puede: ${r.motivo}` };
  };
  const nA = tituloDe(A);
  const nB = tituloDe(B);
  return {
    id: e.id,
    de: A.id,
    a: B.id,
    deNombre: nA,
    aNombre: nB,
    esUno,
    uno: otro('seq'),
    doble: otro('tool'),
    textoDoble:
      B.kind === 'agent'
        ? `«${nA}» y «${nB}» conversan: «${nA}» le pide algo a «${nB}» cuantas veces haga falta (por ejemplo, un borrador y su revisión) y «${nB}» le responde, hasta quedar conformes. Lo que siga después recibe la respuesta final de «${nA}».`
        : `«${nA}» (un agente) le pide algo a «${nB}» solo cuando lo necesita, y «${nB}» le regresa el resultado. Es como preguntarle algo a un compañero. Queda colgada de su patita como herramienta.`,
    puedeMedio: esUno,
  };
}

/**
 * Qué panel de Ajustes toca: el del cuadro elegido, el de la conexión elegida (solo si no hay un cuadro
 * elegido y la conexión existe con sus dos extremos) o ninguno (el texto de «toca un cuadro»).
 */
export function panelDeAjustes(estado: EstadoVista): 'cuadro' | 'enlace' | 'ninguno' {
  const c = contexto(estado.flujo);
  if (estado.sel !== null && c.por.has(estado.sel)) return 'cuadro';
  const e = estado.selEdge === null ? undefined : c.edges.find(x => x.id === estado.selEdge);
  return e && c.por.has(e.de) && c.por.has(e.a) ? 'enlace' : 'ninguno';
}

// ================================================================ guía, textos sueltos y resumen

/**
 * La pista de qué sigue, según cómo va el flujo: sin cuadros (paso 1), sin conexiones (paso 2), con
 * agentes pero sin herramientas (la patita) o la de la flecha.
 */
export function guia(estado: FlujoVista): string {
  const { nodes, edges } = estado.flujo;
  const hayHerr = edges.some(e => e.tipo === 'tool');
  const hayAgente = nodes.some(n => n.kind === 'agent');
  if (nodes.length === 0) return 'Paso 1: elige cómo arranca tu flujo.';
  if (edges.length === 0) return 'Paso 2: toca el + junto al disparador y elige qué sigue: una app o un agente de IA.';
  if (hayAgente && !hayHerr) {
    return 'Para que un agente consulte una app mientras piensa, toca el + de su patita (abajo del cuadro). Para cambiar cómo viaja la información, toca el círculo de una flecha.';
  }
  return 'Toca el círculo de una flecha para elegir si la información va en un solo sentido (como un recado) o de ida y vuelta (una pregunta y su respuesta).';
}

/** Lo que dice el panel de Ajustes cuando no hay nada elegido. */
export function textoSinSeleccion(estado: FlujoVista): string {
  return estado.flujo.nodes.length === 0
    ? 'Empieza eligiendo el disparador en el lienzo.'
    : 'Toca un cuadro para ver y cambiar sus ajustes, o toca una flecha para decidir cómo se conectan.';
}

/**
 * La instrucción del banner «Conectando» («Toca el cuadro que irá DESPUÉS de «A».»…), o '' si no se está
 * conectando. Con rol `destino` los textos se invierten.
 */
export function textoConectar(estado: Pick<EstadoVista, 'flujo' | 'conectando'>): string {
  const con = estado.conectando;
  if (!con) return '';
  const a = estado.flujo.nodes.find(n => n.id === con.ancla);
  return T.textoConectar(con.tipo, con.rol, tituloDe(a)).texto;
}

/** La tarjeta «Elige cómo arranca tu flujo». */
export interface VistaElegirDisparador {
  /** Se pinta cuando no hay disparador (con el lienzo vacío o si se quitó el que había). */
  visible: boolean;
  /** «Paso 1» (lienzo vacío) o «Falta el disparador». */
  etiqueta: string;
  titulo: string;
  opciones: { id: TipoDisparador; nombre: string; detalle: string; icono: IconoDisparador }[];
  /** «¿Prefieres ver uno armado? [Cargar el ejemplo]»: solo con el lienzo vacío. */
  puedeEjemplo: boolean;
}

/** La tarjeta de elegir el disparador. */
export function vistaElegirDisparador(estado: FlujoVista): VistaElegirDisparador {
  const { nodes } = estado.flujo;
  const vacio = nodes.length === 0;
  return {
    visible: !nodes.some(n => n.kind === 'trigger'),
    etiqueta: vacio ? 'Paso 1' : 'Falta el disparador',
    titulo: vacio ? '¿Qué hace que tu flujo arranque?' : 'Elige qué hace que tu flujo arranque',
    opciones: TIPOS_DISPARADOR.map(t => ({ id: t.id, nombre: t.nombre, detalle: t.detalle, icono: t.icono })),
    puedeEjemplo: vacio,
  };
}

/** Lo que dice «Te falta esto…» / «Listo para descargar…» y los avisos. */
export interface ResumenFlujo {
  /** Lo que impide descargar (de `revisarFlujo`, en su orden). */
  errores: string[];
  /** Lo que conviene saber (no impide descargar). */
  avisos: string[];
  /** Se pinta «Te falta esto para poder descargar:». No con el lienzo vacío (ahí lo dice la tarjeta del disparador). */
  hayErrores: boolean;
  /** ¿Se puede descargar? (no hay errores) */
  puedeDescargar: boolean;
  /** Se pintan los avisos (hay y hay cuadros). */
  hayAvisos: boolean;
  /** El primer error, para el aviso «Todavía no se puede descargar…» al pulsar el botón apagado. */
  primerError: string | null;
  /** «Listo para descargar: N cuadros. Al abrirlo en n8n…» */
  resumenOk: string;
  /** Lo que dice el panel JSON mientras no hay JSON («Todavía no hay JSON. Te falta: …»). */
  textoSinJson: string;
  /** Cuántos cuadros tiene el flujo. */
  cuadros: number;
}

/** La revisión del flujo con los textos. Es barata (no arma el archivo): se puede llamar en cada render. */
export function resumenFlujo(estado: FlujoVista): ResumenFlujo {
  const { errores, avisos } = revisarFlujo(estado.flujo);
  const n = estado.flujo.nodes.length;
  return {
    errores,
    avisos,
    hayErrores: errores.length > 0 && n > 0,
    puedeDescargar: errores.length === 0,
    hayAvisos: avisos.length > 0 && n > 0,
    primerError: errores[0] ?? null,
    resumenOk: `Listo para descargar: ${n} ${n === 1 ? 'cuadro' : 'cuadros'}. Al abrirlo en n8n tendrás que conectar tus cuentas (Gmail, OpenAI…) y elegir hojas, canales y destinatarios.`,
    textoSinJson: `Todavía no hay JSON. Te falta: ${errores[0] ?? ''}`,
    cuadros: n,
  };
}
