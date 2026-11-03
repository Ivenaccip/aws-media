// El Asistente de Automatizaciones sin React: los tipos de /api/automatiza, las tres llamadas, cómo se lee lo que contesta el servidor
// (sin fiarse de su forma) y lo que la pantalla calcula (el largo del pedido, la validación, el texto de cada paso, el nombre del
// archivo).
//
// Lo que la persona escribe NO se guarda en ningún lado: ni en el navegador (nada de localStorage ni sessionStorage, y por eso las
// llamadas de aquí NO usan `apartar`) ni, en el modo «prueba», en el servidor. El único almacenamiento de esta pantalla es el del
// traspaso al Constructor (traspaso.ts), y lo que escribe es el FLUJO que armamos, nunca el pedido.
//
// Contrato (server/automatiza_api.py):
//   GET  /api/automatiza/config        → {activo, modo, gratis, costo_creditos, largo_minimo, largo_maximo, cupo, texto?}
//   POST /api/automatiza/armar         → 202 {id, estado: "armando", modo, paso, costo_creditos}
//   GET  /api/automatiza/armar/{id}    → {id, estado, listo, modo, lleva_seg, …}: armando (paso entender|buscar|armar|revisar),
//                                         listo (nombre, resumen, nodos, pendientes, advertencias, flujo, grafo?),
//                                         sin_cobertura (mensaje, faltan); y, reservados para el modo real, en_fila, no_salio, rechazada.
import { ErrorApi, pedir } from '../../nucleo/api';
import { nombreDeArchivo } from '../../nucleo/descargarArchivo';
import type { PasoEspera } from '../../marca/EsperaPasos';

// ---------------------------------------------------------------------------
// Configuración

export type ModoAsistente = 'prueba' | 'real' | 'no_disponible';

export interface Config {
  /** Si se puede escribir. Es lo primero que se mira: antes que `modo`. */
  activo: boolean;
  modo: ModoAsistente;
  /** Armar no cuesta nada. Esta fase solo ofrece escribir cuando es gratis (ver `puedeOfrecer`). */
  gratis: boolean;
  /** Los límites del pedido, en caracteres: los dice el servidor, la pantalla no lleva los suyos. */
  minimo: number;
  maximo: number;
  /** La frase del servidor para cuando no se puede escribir (`activo: false`). */
  texto: string | null;
}

export const TEXTO_NO_DISPONIBLE = 'El Asistente no está disponible por ahora. Inténtalo en unos minutos.';

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const esTexto = (v: unknown): v is string => typeof v === 'string';
const esEntero = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** Lee `GET /config`. null si no trae lo indispensable (los límites y si está activo): sin eso no se ofrece nada. */
export function leerConfig(datos: unknown): Config | null {
  if (!esObjeto(datos)) return null;
  const { activo, modo, gratis, largo_minimo: minimo, largo_maximo: maximo, texto } = datos;
  if (typeof activo !== 'boolean' || !esEntero(minimo) || !esEntero(maximo) || minimo > maximo) return null;
  return {
    activo,
    modo: modo === 'prueba' || modo === 'real' ? modo : 'no_disponible',
    // `gratis` ausente o raro = NO es gratis: lo que no se sabe no se da por gratis
    gratis: gratis === true,
    minimo,
    maximo,
    texto: esTexto(texto) && texto.trim() ? texto : null,
  };
}

/**
 * ¿Se ofrece escribir? Solo si el servidor dice que está activo Y que es gratis. Esta pantalla todavía no sabe mostrar un costo: si
 * algún día el servidor cobra, ella no ofrece nada antes de que alguien le enseñe a decirlo (nada de gasto sin el costo a la vista).
 */
export const puedeOfrecer = (c: Config): boolean => c.activo && c.gratis;

// ---------------------------------------------------------------------------
// Errores: el API manda `detail = {codigo, texto, …}` y el estado HTTP distingue la familia

export type CodigoFallo =
  | 'vacio'
  | 'corto'
  | 'largo'
  | 'texto_invalido'
  | 'moderacion'
  | 'cuerpo'
  | 'no_encontrada'
  | 'no_disponible'
  | 'en_curso'
  | 'agotado'
  | 'sin_saldo'
  | 'no_nube'
  | 'no_salio'
  | 'rechazada'
  | 'sin_conexion'
  | 'tardo'
  | 'respuesta'
  | 'otro';

const CODIGOS: readonly CodigoFallo[] = [
  'vacio', 'corto', 'largo', 'texto_invalido', 'moderacion', 'cuerpo', 'no_encontrada', 'no_disponible', 'en_curso', 'agotado',
  'sin_saldo', 'no_nube', 'no_salio', 'rechazada',
];

export interface Fallo {
  codigo: CodigoFallo;
  /** Listo para mostrarse tal cual: ya viene escrito para la persona. */
  texto: string;
  /** El estado HTTP; 0 = sin conexión. */
  estado: number;
}

/** Los errores que se dicen junto al cuadro, porque lo que hay que arreglar es lo que se escribió. */
export const CODIGOS_DEL_CUADRO: readonly CodigoFallo[] = ['vacio', 'corto', 'largo', 'texto_invalido', 'moderacion'];

const TEXTO_SIN_CONEXION = 'No hay conexión. Revisa tu internet y vuelve a intentar.';
const TEXTO_NO_ENCONTRADA = 'No encontramos ese pedido. Escribe de nuevo qué quieres automatizar.';
export const TEXTO_TARDO = 'Esto está tardando más de lo normal. Inténtalo otra vez en unos minutos.';

/** Lo que se dice cuando el servidor no mandó un `texto` (un 404 del enrutado, un 500 de otra capa…). */
function textoDeEstado(estado: number): string {
  if (estado === 0) return TEXTO_SIN_CONEXION;
  if (estado === 404) return TEXTO_NO_ENCONTRADA;
  if (estado === 502 || estado === 503 || estado === 504) return TEXTO_NO_DISPONIBLE;
  return 'Algo salió mal de nuestro lado. Inténtalo otra vez en unos minutos.';
}

/** Un fallo ya armado, para lo que no viene de una petición (se acabó la espera, la respuesta no se entiende). */
export const fallo = (codigo: CodigoFallo, texto: string, estado = 0): Fallo => ({ codigo, texto, estado });

export function falloDe(e: unknown): Fallo {
  if (e instanceof ErrorApi) {
    const d = esObjeto(e.detalle) ? e.detalle : null;
    const codigo = d && CODIGOS.find(c => c === d.codigo);
    const texto = d && esTexto(d.texto) && d.texto.trim() ? d.texto : textoDeEstado(e.estado);
    if (e.estado === 0) return { codigo: 'sin_conexion', texto, estado: 0 };
    return { codigo: codigo || (e.estado === 404 ? 'no_encontrada' : e.estado === 503 ? 'no_disponible' : 'otro'), texto, estado: e.estado };
  }
  return { codigo: 'otro', texto: textoDeEstado(500), estado: 0 };
}

/** ¿Vale la pena seguir preguntando? Un corte de red o un 502/504 de la puerta pasan solos; lo demás no. */
export const esTransitorio = (f: Fallo): boolean => f.estado === 0 || f.estado === 502 || f.estado === 504;

export const esAbortada = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

// ---------------------------------------------------------------------------
// El pedido

/** Los caracteres como los cuenta el servidor (puntos de código, no unidades UTF-16: un emoji es uno). */
export const largo = (t: string): number => Array.from(t).length;

const TEXTO_VACIO = 'Escribe primero qué quieres automatizar, aunque sea en una frase.';

const textoCorto = (minimo: number, llevas: number): string =>
  `Cuéntanos un poco más: escribe al menos ${minimo} caracteres. Llevas ${llevas}.`;

export const textoLargo = (maximo: number, llevas: number): string =>
  `Es muy largo: el máximo es de ${maximo} caracteres y llevas ${llevas}. Acórtalo para armar tu flujo.`;

/** null si el pedido se puede mandar; si no, qué decirle junto al cuadro. Lo mide ya recortado (el servidor también lo recorta). */
export function validarPedido(texto: string, limites: Pick<Config, 'minimo' | 'maximo'>): Fallo | null {
  const n = largo(texto.trim());
  if (n === 0) return fallo('vacio', TEXTO_VACIO);
  if (n < limites.minimo) return fallo('corto', textoCorto(limites.minimo, n));
  if (n > limites.maximo) return fallo('largo', textoLargo(limites.maximo, n));
  return null;
}

/** «12 de 1500 caracteres», y mientras falta para el mínimo, cuánto es. */
export function textoContador(texto: string, limites: Pick<Config, 'minimo' | 'maximo'>): string {
  const n = largo(texto.trim());
  const base = `${n} de ${limites.maximo} caracteres`;
  return n > 0 && n < limites.minimo ? `${base} · mínimo ${limites.minimo}` : base;
}

// ---------------------------------------------------------------------------
// Los pasos (los cuatro que informa el backend, ni uno más)

export const PASOS = ['entender', 'buscar', 'armar', 'revisar'] as const;
export type Paso = (typeof PASOS)[number];

/** Lo que se muestra de cada paso. Sirve igual en modo «prueba» y en el real: no promete lo que la prueba no hace. */
export const PASOS_ESPERA: PasoEspera[] = [
  { falta: 'Entender lo que pides', activo: 'Entendiendo lo que pides', hecho: 'Entendimos lo que pides' },
  { falta: 'Buscar ejemplos parecidos', activo: 'Buscando ejemplos parecidos', hecho: 'Encontramos ejemplos parecidos' },
  { falta: 'Armar los cuadros', activo: 'Armando los cuadros', hecho: 'Armamos los cuadros' },
  {
    falta: 'Revisar que se pueda importar en n8n',
    activo: 'Revisando que se pueda importar en n8n',
    hecho: 'Revisamos que se pueda importar en n8n',
  },
];

/** El número de paso (0 a 3) de lo que dijo el servidor; null si no es uno de los cuatro. */
export const indiceDePaso = (paso: unknown): number | null => {
  const i = PASOS.findIndex(p => p === paso);
  return i < 0 ? null : i;
};

// ---------------------------------------------------------------------------
// Lo que contesta GET /armar/{id}

interface NodoDelFlujo {
  /** El `type` de n8n. */
  tipo: string;
  /** El chip para la persona: en español, de `etiqueta`; si el servidor no la manda, el nombre de n8n. */
  nombre: string;
}

export interface FlujoListo {
  nombre: string;
  resumen: string | null;
  nodos: NodoDelFlujo[];
  pendientes: string[];
  advertencias: string[];
  /** El JSON de n8n, tal cual lo mandó el servidor: lo que se descarga. */
  flujo: Record<string, unknown>;
  /** El mismo flujo como grafo del Constructor, SOLO si el servidor lo trae: sin él no se ofrece «Abrir en el constructor». */
  grafo: unknown;
}

export type Lectura =
  | { estado: 'armando'; paso: number | null; lugar: number | null }
  | { estado: 'listo'; listo: FlujoListo }
  | { estado: 'sin_cobertura'; mensaje: string; faltan: string[] }
  | { estado: 'fallo'; fallo: Fallo };

const textos = (v: unknown): string[] => (Array.isArray(v) ? v.filter(esTexto).filter(t => t.trim() !== '') : []);

function leerNodos(v: unknown): NodoDelFlujo[] {
  if (!Array.isArray(v)) return [];
  const nodos: NodoDelFlujo[] = [];
  for (const n of v) {
    if (!esObjeto(n)) continue;
    const nombre = esTexto(n.etiqueta) && n.etiqueta.trim() ? n.etiqueta : esTexto(n.nombre) ? n.nombre : '';
    if (nombre.trim()) nodos.push({ tipo: esTexto(n.tipo) ? n.tipo : '', nombre });
  }
  return nodos;
}

const RESPUESTA_ROTA = fallo('respuesta', 'Recibimos una respuesta que no entendemos. Inténtalo otra vez.');

/** Lee lo que contestó `GET /armar/{id}` (o el 202 de `POST /armar`) sin fiarse de su forma. */
export function leerArmado(datos: unknown): Lectura {
  if (!esObjeto(datos)) return { estado: 'fallo', fallo: RESPUESTA_ROTA };
  switch (datos.estado) {
    case 'armando':
      return { estado: 'armando', paso: indiceDePaso(datos.paso), lugar: null };
    case 'en_fila':
      return { estado: 'armando', paso: 0, lugar: esEntero(datos.lugar) ? datos.lugar : null };
    case 'listo': {
      if (!esObjeto(datos.flujo) || !esTexto(datos.nombre) || !datos.nombre.trim()) return { estado: 'fallo', fallo: RESPUESTA_ROTA };
      return {
        estado: 'listo',
        listo: {
          nombre: datos.nombre,
          resumen: esTexto(datos.resumen) && datos.resumen.trim() ? datos.resumen : null,
          nodos: leerNodos(datos.nodos),
          pendientes: textos(datos.pendientes),
          advertencias: textos(datos.advertencias),
          flujo: datos.flujo,
          grafo: datos.grafo ?? null,
        },
      };
    }
    case 'sin_cobertura':
      return {
        estado: 'sin_cobertura',
        mensaje: esTexto(datos.mensaje) && datos.mensaje.trim() ? datos.mensaje : 'Todavía no sabemos armar esto con n8n.',
        faltan: textos(datos.faltan),
      };
    case 'no_salio':
    case 'rechazada': {
      const texto = esTexto(datos.mensaje) && datos.mensaje.trim() ? datos.mensaje : 'Esta vez no pudimos armar tu flujo.';
      return { estado: 'fallo', fallo: fallo(datos.estado, texto) };
    }
    default:
      return { estado: 'fallo', fallo: RESPUESTA_ROTA };
  }
}

/** El `id` del 202 de `POST /armar`: un texto, sin espacios ni barras (va en la ruta del GET). null si no sirve. */
export function leerId(datos: unknown): string | null {
  if (!esObjeto(datos) || !esTexto(datos.id)) return null;
  return datos.id.length > 0 && datos.id.length <= 200 && !/[\s/?#]/.test(datos.id) ? datos.id : null;
}

// ---------------------------------------------------------------------------
// Las llamadas (todas por `pedir`, sin `apartar`: el pedido no se aparta en ningún almacenamiento)

export const cargarConfig = (senal?: AbortSignal): Promise<unknown> =>
  pedir<unknown>('/api/automatiza/config', senal ? { senal } : {});

export const pedirArmado = (texto: string, senal?: AbortSignal): Promise<unknown> =>
  pedir<unknown>('/api/automatiza/armar', { metodo: 'POST', cuerpo: { texto }, ...(senal ? { senal } : {}) });

export const consultarArmado = (id: string, senal?: AbortSignal): Promise<unknown> =>
  pedir<unknown>(`/api/automatiza/armar/${encodeURIComponent(id)}`, senal ? { senal } : {});

// ---------------------------------------------------------------------------
// El archivo

/** El nombre del archivo que se baja: el del flujo, limpio y acotado (para que «.json» nunca se corte), más «.json». */
export const nombreDelArchivo = (nombreFlujo: string): string =>
  Array.from(nombreDeArchivo(nombreFlujo, 'flujo')).slice(0, 100).join('').trim() + '.json';

/** El JSON tal como se descarga y se copia: con sangría, para leerlo. */
export const jsonDelFlujo = (flujo: unknown): string => JSON.stringify(flujo, null, 2);
