// El borrador del Constructor: el flujo que se está armando, guardado en el navegador para que no se
// pierda al ir al Asistente y volver, al recargar la página o cuando la sesión caduca a media edición
// (decisión D3 del plan; informe 04 §9.5).
//
// Es un módulo PURO: el almacenamiento se INYECTA (`getItem`/`setItem`/`removeItem`; en producción,
// `window.localStorage`) y aquí no se toca `window`, `document` ni el reloj. Sigue las reglas de
// `nucleo/preferencia.ts`: es una comodidad, así que el navegador puede negar el almacenamiento (ventana
// privada, datos bloqueados, cuota llena) o traerlo vacío, y NADA aquí lanza: toda operación devuelve un
// resultado que dice qué pasó y la pantalla funciona igual sin borrador.
//
//   const borrador = crearBorrador(() => window.localStorage);   // el hook, no este módulo, toca window
//   const previo = borrador.cargar();                            // ANTES de guardar (ver abajo)
//   borrador.guardar(estado.flujo);                              // diferido, y de inmediato en `auth:saliendo` y `pagehide`
//   borrador.traspasar(grafoDelAsistente);                       // Asistente → Constructor
//
// Qué se guarda: SOLO `nodes`, `edges` y `nombreFlujo` (más `v`, la versión, y `origen` si lo escribió el
// Asistente). Nada de selección, menú, historial ni avisos. La llave lleva la versión
// (`constructor.borrador.v1`) y el contenido también: una versión futura se ignora sin tocarla.
//
// Garantías (todas se prueban en borrador.test.ts):
//   · NUNCA se guarda un flujo con texto que parezca una clave (`conClave`: sk-…, AIza…, token de
//     Telegram…). `guardar` devuelve `motivo: 'con-clave'` y dónde (ids y campos, jamás el texto); el
//     borrador anterior queda como estaba. La revisión mira el texto ANTES de recortarlo.
//   · `cargar` valida versión y forma, deja pasar el flujo por `invariantesDelGrafo` (ids únicos, sin
//     huérfanas, sin círculos, topes 1/4/8…), recorta los textos largos y descarta lo que no sirva.
//     Los cuadros se arman campo por campo, con una lista fija de campos: lo demás que traiga el JSON
//     (`__proto__`, `constructor`, campos de otra versión) se ignora, y un id con nombre de prototipo se rechaza.
//   · Ida y vuelta exacta: lo que `guardar` acepta, `cargar` lo devuelve igual (ver `recortes` para el
//     único caso en que no: textos más largos que los topes de abajo).
//   · Un lienzo SIN cuadros no es un borrador: `guardar` lo trata como «borra el borrador». Por eso hay
//     que CARGAR antes de empezar a guardar (si no, el primer guardado del lienzo vacío borraría el borrador
//     que todavía no se leyó).
//
// Traspaso Asistente → Constructor (`prepararTraspaso` / `traspasar`): el Asistente escribe el flujo
// como borrador (con `origen: 'asistente'`) y navega; el Constructor lo lee con `cargar` y, al verlo, avisa
// «Abrimos tu flujo del Asistente», elige el primer agente y vuelve a guardar (el guardado normal quita
// la marca). Antes de reemplazar un borrador que ya tenga cuadros hay que pedir confirmación:
// `cargar().ok` dice si lo hay.

import {
  LARGO_DESC_AYUDANTE,
  LARGO_NOMBRE_AGENTE,
  LARGO_NOMBRE_APP,
  LARGO_NOMBRE_FLUJO,
  LARGO_RUTA,
  LARGO_TEXTO_AGENTE,
  TOPE_CUADROS,
} from './datos/constantes';
import { APPS_DISPARADOR, FRECUENCIAS, TIPOS_DISPARADOR } from './datos/disparadores';
import { IAS } from './datos/ias';
import { codigoDeViolacion, invariantesDelGrafo } from './grafo';
import { conClave } from './secretos';
import { esObjeto, recortar } from './texto';
import type { Arista, Flujo, Nodo, TipoArista } from './tipos';

// ================================================================ constantes

/** La llave del borrador. Lleva la versión: si el formato cambia, la llave nueva no pisa la vieja. */
export const CLAVE_BORRADOR = 'constructor.borrador.v1';
/** La versión del formato que escribe y entiende este módulo. */
export const VERSION_BORRADOR = 1;
/** El borrador más grande que se guarda o se lee, en caracteres del texto ya serializado (el almacenamiento del navegador da unos 5 millones). */
export const MAX_CARACTERES_BORRADOR = 200_000;
/** Cuántas conexiones se aceptan como máximo antes de mirar nada (con 13 cuadros caben unas 90 distintas). */
export const MAX_ARISTAS_BORRADOR = 200;

// Los topes de largo de los textos viven en `datos/constantes.ts` (el reductor los aplica al teclear y al abrir un flujo,
// el borrador al guardar y al leer) y se re-exportan aquí porque este módulo ya los exportaba.
export { LARGO_DESC_AYUDANTE, LARGO_RUTA, LARGO_TEXTO_AGENTE };

/** Quién escribió el borrador, cuando no fue la persona armando en el lienzo. */
export type OrigenBorrador = 'asistente';

/** Lo mínimo que se necesita del almacenamiento. Un `Storage` del navegador lo cumple. */
export interface Almacen {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
  removeItem(clave: string): void;
}

/**
 * De dónde sale el almacenamiento: el objeto, o una función que lo da (se llama en CADA operación y puede
 * lanzar: en algunos navegadores solo LEER `window.localStorage` lanza). `null`/`undefined` = no hay.
 */
export type FuenteAlmacen = Almacen | (() => Almacen | null | undefined) | null | undefined;

// ================================================================ textos para la persona

/** Por qué no se pudo guardar, en palabras de persona. Para el aviso del Constructor. */
export const TEXTO_NO_GUARDADO = {
  'con-clave':
    'No guardamos tu borrador porque parece que hay una clave pegada en el flujo. Quítala: las claves se ponen en n8n al conectar la cuenta.',
  invalido: 'No pudimos guardar tu borrador porque el flujo no es válido. Descarga el .json para no perder tu trabajo.',
  'demasiado-grande': 'Tu flujo es demasiado grande para guardarlo como borrador en este navegador. Descarga el .json para no perder tu trabajo.',
  'cuota-llena': 'Tu navegador no tiene espacio para guardar el borrador. Descarga el .json para no perder tu trabajo.',
  'sin-almacenamiento':
    'Tu navegador no deja guardar el borrador (¿ventana privada?). Descarga el .json para no perder tu trabajo.',
} as const;

/** Lo que se dice cuando había un borrador y no se pudo recuperar. */
export const TEXTO_NO_RECUPERADO = 'No pudimos recuperar tu borrador anterior, así que empezamos de cero.';

// ================================================================ resultados

/** Por qué `guardar` no guardó. */
export type MotivoNoGuardar = 'con-clave' | 'invalido' | 'demasiado-grande' | 'cuota-llena' | 'sin-almacenamiento';

/**
 * Lo que devuelve `guardar` / `traspasar`. `accion: 'borrado'` = el lienzo no tenía cuadros y se borró el
 * borrador. `recortes`: los textos que pasaban de su tope y se guardaron recortados («a1.instrucciones»).
 * `detalle` (solo si falla): ids y campos (`con-clave`: «a1.tarea», «nombreFlujo») o códigos (`invalido`).
 * Nunca lleva el texto de la persona.
 */
export type ResultadoGuardar =
  | { ok: true; accion: 'guardado' | 'borrado'; caracteres: number; recortes: string[] }
  | { ok: false; motivo: MotivoNoGuardar; detalle: string[] };

/** Por qué `cargar` no devolvió un flujo. `vacio` y `sin-almacenamiento` no son avisos: simplemente no hay nada. */
export type MotivoNoCarga =
  | 'vacio'
  | 'sin-almacenamiento'
  | 'json-roto'
  | 'forma'
  | 'version-futura'
  | 'invalido'
  | 'con-clave'
  | 'demasiado-grande';

/** Lo que devuelve `cargar` / `leerBorrador`. `origen`: quién lo escribió, si no fue el lienzo. */
export type ResultadoCargar =
  | { ok: true; flujo: Flujo; origen: OrigenBorrador | null; recortes: string[] }
  | { ok: false; motivo: MotivoNoCarga; detalle: string[] };

/** Lo que devuelve `borrar`. */
export type ResultadoBorrar = { ok: true } | { ok: false; motivo: 'sin-almacenamiento' };

/**
 * ¿Había algo guardado que se descartó? (para decir «No pudimos recuperar tu borrador»). Falso con `vacio`
 * (no había nada) y con `sin-almacenamiento` (no se pudo ni mirar; el aviso de «no guardamos» lo dirá al guardar).
 */
export function seDescarto(motivo: MotivoNoCarga): boolean {
  return motivo !== 'vacio' && motivo !== 'sin-almacenamiento';
}

// ================================================================ validar y limpiar un flujo que viene de fuera

/** Lo que se puede pedir a `normalizarFlujo`. */
export interface OpcionesNormalizar {
  /**
   * Si el flujo no trae `nombreFlujo` (o no es texto), usar este nombre en vez de rechazarlo. Lo usa el reductor al abrir
   * un flujo de afuera; el borrador no lo pasa: un borrador sin nombre está dañado.
   */
  nombrePorOmision?: string | undefined;
}

/** Por qué no se pudo limpiar un flujo. */
export type ResultadoNormalizar =
  | { ok: true; flujo: Flujo; recortes: string[] }
  | { ok: false; motivo: 'forma' | 'con-clave' | 'invalido'; detalle: string[] };

/** La parte del trabajo que no tiene remedio: algo no tiene la forma que debe. `ruta` dice dónde. */
class ErrorDeForma extends Error {
  constructor(readonly ruta: string) {
    super(ruta);
  }
}

/** Un id: letra y hasta 31 letras, números, «_» o «-». Rechaza `__proto__`, `constructor`, `toString`… (nombres de prototipo). */
const ID_SEGURO = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

const TIPOS_DE_CUADRO = ['trigger', 'agent', 'app'] as const;
const TIPOS_DE_ARISTA: readonly TipoArista[] = ['seq', 'tool'];
const IDS_TIPO = TIPOS_DISPARADOR.map(t => t.id);
const IDS_FRECUENCIA = FRECUENCIAS.map(f => f.id);
const IDS_APP_DISPARADOR = APPS_DISPARADOR.map(a => a.id);
const IDS_IA = IAS.map(i => i.id);

/** El valor de un campo PROPIO del objeto (jamás uno heredado del prototipo). */
const propio = (o: object, clave: string): unknown => (Object.hasOwn(o, clave) ? (o as Record<string, unknown>)[clave] : undefined);

/** Lo que se va juntando mientras se limpia un flujo. */
interface Acumulado {
  /** Dónde había texto que parece una clave («a1.tarea»). Nunca el texto. */
  claves: string[];
  /** Qué textos se recortaron. */
  recortes: string[];
}

function textoDe(o: object, campo: string, ruta: string, lugar: string, max: number, acc: Acumulado): string {
  const v = propio(o, campo);
  if (typeof v !== 'string') throw new ErrorDeForma(ruta);
  if (conClave(v)) acc.claves.push(lugar);
  if (v.length > max) acc.recortes.push(lugar);
  return recortar(v, max);
}

function idDe(o: object, campo: string, ruta: string, acc: Acumulado): string {
  const v = propio(o, campo);
  if (typeof v !== 'string' || !ID_SEGURO.test(v) || v in Object.prototype) throw new ErrorDeForma(ruta);
  if (conClave(v)) acc.claves.push(ruta);
  return v;
}

function numeroDe(o: object, campo: string, ruta: string): number {
  const v = propio(o, campo);
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ErrorDeForma(ruta);
  return v === 0 ? 0 : v; // -0 no sobrevive a JSON: se normaliza para que la ida y vuelta sea exacta
}

function unoDe<T extends string>(o: object, campo: string, ruta: string, validos: readonly T[]): T {
  const v = propio(o, campo);
  const hallado = validos.find(x => x === v);
  if (hallado === undefined) throw new ErrorDeForma(ruta);
  return hallado;
}

function limpiarNodo(v: unknown, i: number, acc: Acumulado): Nodo {
  const r = `nodes[${i}]`;
  if (!esObjeto(v)) throw new ErrorDeForma(r);
  const id = idDe(v, 'id', `${r}.id`, acc);
  const kind = unoDe(v, 'kind', `${r}.kind`, TIPOS_DE_CUADRO);
  const x = numeroDe(v, 'x', `${r}.x`);
  const y = numeroDe(v, 'y', `${r}.y`);
  const en = (campo: string) => `${id}.${campo}`;
  if (kind === 'trigger') {
    return {
      id,
      kind,
      x,
      y,
      tipo: unoDe(v, 'tipo', `${r}.tipo`, IDS_TIPO),
      frec: unoDe(v, 'frec', `${r}.frec`, IDS_FRECUENCIA),
      ruta: textoDe(v, 'ruta', `${r}.ruta`, en('ruta'), LARGO_RUTA, acc),
      app: unoDe(v, 'app', `${r}.app`, IDS_APP_DISPARADOR),
    };
  }
  if (kind === 'agent') {
    const agente = {
      id,
      kind,
      x,
      y,
      nombre: textoDe(v, 'nombre', `${r}.nombre`, en('nombre'), LARGO_NOMBRE_AGENTE, acc),
      ia: unoDe(v, 'ia', `${r}.ia`, IDS_IA),
      tarea: textoDe(v, 'tarea', `${r}.tarea`, en('tarea'), LARGO_TEXTO_AGENTE, acc),
      instrucciones: textoDe(v, 'instrucciones', `${r}.instrucciones`, en('instrucciones'), LARGO_TEXTO_AGENTE, acc),
    };
    // `desc` es opcional: ausente, undefined o null = no hay
    const d = propio(v, 'desc');
    if (d === undefined || d === null) return agente;
    return { ...agente, desc: textoDe(v, 'desc', `${r}.desc`, en('desc'), LARGO_DESC_AYUDANTE, acc) };
  }
  return { id, kind, x, y, nombre: textoDe(v, 'nombre', `${r}.nombre`, en('nombre'), LARGO_NOMBRE_APP, acc) };
}

function limpiarArista(v: unknown, i: number, acc: Acumulado): Arista {
  const r = `edges[${i}]`;
  if (!esObjeto(v)) throw new ErrorDeForma(r);
  return {
    id: idDe(v, 'id', `${r}.id`, acc),
    de: idDe(v, 'de', `${r}.de`, acc),
    a: idDe(v, 'a', `${r}.a`, acc),
    tipo: unoDe(v, 'tipo', `${r}.tipo`, TIPOS_DE_ARISTA),
  };
}

/**
 * Deja un flujo que viene de FUERA (un borrador leído, la respuesta del Asistente, lo que recibe `cargarFlujo`) listo
 * para usarse, o dice por qué no. Acepta cualquier cosa y no lanza. En orden:
 *  1. `forma` — lo que no sea `{ nodes: lista, edges: lista, nombreFlujo: texto }` con cuadros y conexiones
 *     bien formados (campo por campo; lo que sobre se ignora; ids sin nombres de prototipo). `detalle` = dónde.
 *  2. `con-clave` — texto que parezca una clave (se mira ANTES de recortar). `detalle` = ids y campos.
 *  3. `invalido` — viola `invariantesDelGrafo` (duplicados, huérfanas, círculos, topes 1/4/8, fuera del lienzo…).
 *     `detalle` = los códigos. Más de 13 cuadros o 200 conexiones se rechazan sin mirarlos uno por uno.
 * Si todo está bien: el flujo limpio (objetos NUEVOS: no comparte nada con la entrada) y los textos recortados
 * a sus topes (`recortes`).
 */
export function normalizarFlujo(entrada: unknown, opciones: OpcionesNormalizar = {}): ResultadoNormalizar {
  try {
    if (!esObjeto(entrada)) return { ok: false, motivo: 'forma', detalle: ['flujo'] };
    const nodos = propio(entrada, 'nodes');
    const aristas = propio(entrada, 'edges');
    if (!Array.isArray(nodos)) return { ok: false, motivo: 'forma', detalle: ['nodes'] };
    if (!Array.isArray(aristas)) return { ok: false, motivo: 'forma', detalle: ['edges'] };
    if (nodos.length > TOPE_CUADROS) return { ok: false, motivo: 'invalido', detalle: ['tope-cuadros'] };
    if (aristas.length > MAX_ARISTAS_BORRADOR) return { ok: false, motivo: 'invalido', detalle: ['tope-conexiones'] };

    const acc: Acumulado = { claves: [], recortes: [] };
    const nodes = nodos.map((n, i) => limpiarNodo(n, i, acc));
    const edges = aristas.map((e, i) => limpiarArista(e, i, acc));
    // el nombre del flujo es lo único que se puede dar por omisión (el borrador lo exige; quien abre un flujo de afuera, no)
    const nombreFlujo =
      typeof propio(entrada, 'nombreFlujo') !== 'string' && opciones.nombrePorOmision !== undefined
        ? opciones.nombrePorOmision
        : textoDe(entrada, 'nombreFlujo', 'nombreFlujo', 'nombreFlujo', LARGO_NOMBRE_FLUJO, acc);

    if (acc.claves.length > 0) return { ok: false, motivo: 'con-clave', detalle: [...new Set(acc.claves)].slice(0, 20) };
    const violaciones = invariantesDelGrafo(nodes, edges);
    if (violaciones.length > 0) {
      return { ok: false, motivo: 'invalido', detalle: [...new Set(violaciones.map(codigoDeViolacion))] };
    }
    return { ok: true, flujo: { nodes, edges, nombreFlujo }, recortes: acc.recortes };
  } catch (e) {
    // lo único que se espera aquí es ErrorDeForma; cualquier otra cosa también se descarta antes que lanzar
    return { ok: false, motivo: 'forma', detalle: [e instanceof ErrorDeForma ? e.ruta : 'inesperado'] };
  }
}

// ================================================================ texto ⇄ flujo (puro, sin almacenamiento)

/** Opciones de lo que escribe/lee el borrador. Todas son para las pruebas o para quien quiera otro tope. */
export interface OpcionesBorrador {
  /** Cuántos caracteres admite el borrador ya serializado. Por omisión `MAX_CARACTERES_BORRADOR`. */
  maxCaracteres?: number | undefined;
}

/** Lo que devuelve `serializarBorrador` / `prepararTraspaso`: el texto que se escribiría y el flujo limpio. */
export type ResultadoSerializar =
  | { ok: true; texto: string; flujo: Flujo; recortes: string[] }
  | { ok: false; motivo: 'con-clave' | 'invalido' | 'demasiado-grande'; detalle: string[] };

function serializar(flujo: unknown, origen: OrigenBorrador | null, opciones: OpcionesBorrador): ResultadoSerializar {
  const n = normalizarFlujo(flujo);
  if (!n.ok) return { ok: false, motivo: n.motivo === 'forma' ? 'invalido' : n.motivo, detalle: n.detalle };
  const sobre: Record<string, unknown> = {
    v: VERSION_BORRADOR,
    nodes: n.flujo.nodes,
    edges: n.flujo.edges,
    nombreFlujo: n.flujo.nombreFlujo,
  };
  if (origen) sobre.origen = origen;
  const texto = JSON.stringify(sobre);
  const max = opciones.maxCaracteres ?? MAX_CARACTERES_BORRADOR;
  if (texto.length > max) return { ok: false, motivo: 'demasiado-grande', detalle: [`${texto.length}>${max}`] };
  return { ok: true, texto, flujo: n.flujo, recortes: n.recortes };
}

/**
 * El texto que `guardar` escribiría para este flujo: `{ v, nodes, edges, nombreFlujo }`, compacto, o por qué
 * no se puede (`con-clave`, `invalido` — también si no tiene la forma —, `demasiado-grande`). No escribe nada.
 */
export function serializarBorrador(flujo: unknown, opciones: OpcionesBorrador = {}): ResultadoSerializar {
  return serializar(flujo, null, opciones);
}

/**
 * El texto que escribiría el traspaso Asistente → Constructor para un flujo AJENO (el `grafo` que devuelve el
 * Asistente): igual que `serializarBorrador` más la marca `origen: 'asistente'`, y sin aceptar un flujo sin
 * cuadros. Acepta `nombre` en lugar de `nombreFlujo` (como las muestras). No escribe nada.
 */
export function prepararTraspaso(ajeno: unknown, opciones: OpcionesBorrador = {}): ResultadoSerializar {
  try {
    let flujo = ajeno;
    if (esObjeto(ajeno) && propio(ajeno, 'nombreFlujo') === undefined && typeof propio(ajeno, 'nombre') === 'string') {
      flujo = { nodes: propio(ajeno, 'nodes'), edges: propio(ajeno, 'edges'), nombreFlujo: propio(ajeno, 'nombre') };
    }
    const r = serializar(flujo, 'asistente', opciones);
    if (r.ok && r.flujo.nodes.length === 0) return { ok: false, motivo: 'invalido', detalle: ['sin-cuadros'] };
    return r;
  } catch {
    // un objeto exótico (un Proxy, un getter que lanza) no es un flujo: nada aquí lanza
    return { ok: false, motivo: 'invalido', detalle: ['inesperado'] };
  }
}

/**
 * Lee el texto de un borrador (lo que devolvió `getItem`). No lanza: devuelve el flujo limpio o el motivo
 * por el que se descarta. Un borrador sin cuadros cuenta como `vacio`.
 */
export function leerBorrador(crudo: unknown, opciones: OpcionesBorrador = {}): ResultadoCargar {
  if (crudo === null || crudo === undefined || crudo === '') return { ok: false, motivo: 'vacio', detalle: [] };
  if (typeof crudo !== 'string') return { ok: false, motivo: 'forma', detalle: ['almacen'] };
  if (crudo.length > (opciones.maxCaracteres ?? MAX_CARACTERES_BORRADOR)) {
    return { ok: false, motivo: 'demasiado-grande', detalle: [`${crudo.length}`] };
  }
  let datos: unknown;
  try {
    datos = JSON.parse(crudo);
  } catch {
    return { ok: false, motivo: 'json-roto', detalle: [] };
  }
  if (!esObjeto(datos)) return { ok: false, motivo: 'forma', detalle: ['borrador'] };
  const v = propio(datos, 'v');
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return { ok: false, motivo: 'forma', detalle: ['v'] };
  if (v > VERSION_BORRADOR) return { ok: false, motivo: 'version-futura', detalle: [`v${v}`] };
  const n = normalizarFlujo(datos);
  if (!n.ok) return { ok: false, motivo: n.motivo, detalle: n.detalle };
  if (n.flujo.nodes.length === 0) return { ok: false, motivo: 'vacio', detalle: [] };
  return { ok: true, flujo: n.flujo, origen: propio(datos, 'origen') === 'asistente' ? 'asistente' : null, recortes: n.recortes };
}

// ================================================================ con almacenamiento

function resolver(fuente: FuenteAlmacen): Almacen | null {
  try {
    const a = typeof fuente === 'function' ? fuente() : fuente;
    return a ?? null;
  } catch {
    return null;
  }
}

/** ¿El error es «no hay espacio»? (`QuotaExceededError`, o el de Firefox, o los códigos viejos 22 y 1014) */
function esCuota(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const { name, code } = e as { name?: unknown; code?: unknown };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

/** Las cuatro operaciones del borrador, atadas a un almacenamiento. Ninguna lanza. */
export interface Borrador {
  /**
   * Guarda el flujo (solo `nodes`, `edges` y `nombreFlujo`). Sin cuadros: borra el borrador. Si no se puede
   * (clave, flujo inválido, muy grande, sin espacio, sin almacenamiento) no cambia lo que había y lo dice.
   */
  guardar(flujo: Flujo): ResultadoGuardar;
  /** Lee el borrador y lo deja limpio y validado, o dice por qué no hay. No escribe nada. */
  cargar(): ResultadoCargar;
  /** Borra el borrador. */
  borrar(): ResultadoBorrar;
  /** Escribe un flujo ajeno (el del Asistente) como borrador, con `origen: 'asistente'`, reemplazando el que hubiera. */
  traspasar(ajeno: unknown): ResultadoGuardar;
}

/** Ata las operaciones del borrador a un almacenamiento (ver `FuenteAlmacen`). */
export function crearBorrador(fuente: FuenteAlmacen, opciones: OpcionesBorrador = {}): Borrador {
  const escribir = (s: ResultadoSerializar): ResultadoGuardar => {
    if (!s.ok) return { ok: false, motivo: s.motivo, detalle: s.detalle };
    const almacen = resolver(fuente);
    if (!almacen) return { ok: false, motivo: 'sin-almacenamiento', detalle: [] };
    try {
      almacen.setItem(CLAVE_BORRADOR, s.texto);
    } catch (e) {
      return { ok: false, motivo: esCuota(e) ? 'cuota-llena' : 'sin-almacenamiento', detalle: [] };
    }
    return { ok: true, accion: 'guardado', caracteres: s.texto.length, recortes: s.recortes };
  };

  const borrar = (): ResultadoBorrar => {
    const almacen = resolver(fuente);
    if (!almacen) return { ok: false, motivo: 'sin-almacenamiento' };
    try {
      almacen.removeItem(CLAVE_BORRADOR);
    } catch {
      return { ok: false, motivo: 'sin-almacenamiento' };
    }
    return { ok: true };
  };

  return {
    guardar(flujo) {
      const s = serializarBorrador(flujo, opciones);
      if (s.ok && s.flujo.nodes.length === 0) {
        const b = borrar();
        return b.ok ? { ok: true, accion: 'borrado', caracteres: 0, recortes: [] } : { ok: false, motivo: b.motivo, detalle: [] };
      }
      return escribir(s);
    },
    cargar() {
      const almacen = resolver(fuente);
      if (!almacen) return { ok: false, motivo: 'sin-almacenamiento', detalle: [] };
      let crudo: unknown;
      try {
        crudo = almacen.getItem(CLAVE_BORRADOR);
      } catch {
        return { ok: false, motivo: 'sin-almacenamiento', detalle: [] };
      }
      return leerBorrador(crudo, opciones);
    },
    borrar,
    traspasar(ajeno) {
      return escribir(prepararTraspaso(ajeno, opciones));
    },
  };
}
