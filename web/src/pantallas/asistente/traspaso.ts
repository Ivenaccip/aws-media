// Del Asistente al Constructor: el Asistente escribe el flujo como BORRADOR del Constructor (con la marca `origen: 'asistente'`) y navega;
// el Constructor lo lee al abrir (pantallas/constructor/modelo/borrador.ts). Es el mismo almacenamiento de siempre del borrador
// (localStorage), no uno nuevo. Aquí solo va lo que le toca al Asistente: ver si hay algo que se reemplazaría, escribir, y decir en
// palabras de persona por qué no se pudo.
//
// Todo se INYECTA (el almacenamiento y la navegación): en producción son `window.localStorage` y `location.assign`; las pruebas pasan
// los suyos. Nada aquí lanza.
import {
  crearBorrador,
  prepararTraspaso,
  type FuenteAlmacen,
  type MotivoNoGuardar,
} from '../constructor/modelo/borrador';

/** Dónde vive el Constructor: su lugar en el mapa, Automatizaciones › Distrito (desde E7.3). */
export const URL_CONSTRUCTOR = '/estudio/automatizaciones/distrito/constructor/';

export type Navegar = (url: string) => void;

/** La navegación de verdad. Se lee `window` al llamarla, no al importar. */
export const navegarA: Navegar = url => window.location.assign(url);

/** El almacenamiento de verdad: una función, porque en algunos navegadores solo LEER `window.localStorage` lanza. */
export const almacenDelNavegador: FuenteAlmacen = () => window.localStorage;

/** ¿Este grafo se puede abrir en el Constructor? (forma, claves, topes e invariantes). Puro: no escribe nada. */
export const sePuedeAbrir = (grafo: unknown): boolean => prepararTraspaso(grafo).ok;

/** ¿Ya hay un flujo con cuadros guardado en el Constructor? Si lo hay, abrir este lo reemplazaría y hay que preguntar. */
export const hayBorrador = (fuente: FuenteAlmacen): boolean => crearBorrador(fuente).cargar().ok;

const NO_ABRIO: Record<MotivoNoGuardar, string> = {
  'con-clave':
    'No pudimos abrir el flujo en el constructor porque trae algo que parece una clave. Descarga el .json y ábrelo en n8n.',
  invalido: 'No pudimos abrir este flujo en el constructor. Descarga el .json y ábrelo en n8n.',
  'demasiado-grande': 'No pudimos abrir este flujo en el constructor: es demasiado grande. Descarga el .json y ábrelo en n8n.',
  'cuota-llena': 'Tu navegador no tiene espacio para pasar el flujo al constructor. Descarga el .json y ábrelo en n8n.',
  'sin-almacenamiento':
    'Tu navegador no deja pasar el flujo al constructor (¿ventana privada?). Descarga el .json y ábrelo en n8n.',
};

type ResultadoTraspaso = { ok: true } | { ok: false; texto: string };

/**
 * Escribe el grafo como borrador del Constructor (reemplazando el que hubiera: quien llama ya preguntó) y, si se pudo, navega.
 * Si no se pudo, no navega y dice por qué.
 */
export function pasarAlConstructor(grafo: unknown, fuente: FuenteAlmacen, ir: Navegar): ResultadoTraspaso {
  const r = crearBorrador(fuente).traspasar(grafo);
  if (!r.ok) return { ok: false, texto: NO_ABRIO[r.motivo] };
  ir(URL_CONSTRUCTOR);
  return { ok: true };
}
