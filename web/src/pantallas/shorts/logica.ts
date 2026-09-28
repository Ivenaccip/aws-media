// Shorts sin React: los tipos de /api/shorts y lo que static/shorts.html
// calculaba en línea. Cobra tres cosas y los tres precios salen del server:
//   · importar de YouTube: /api/shorts/importar/cotizar → `creditos`;
//   · analizar: /api/shorts/<p>/costo → `creditos_analizar`;
//   · renderizar: `creditos_por_short` × shorts marcados.
// La vieja caía a un 2 escrito a mano si faltaba `creditos_por_short`; aquí,
// sin precio del server no hay botón.
import { pedir } from '../../nucleo/api';

export interface Candidato {
  score: number;
  texto: string;
  razon: string;
  start: number;
  end: number;
  hook_line1: string;
  hook_line2: string;
}

export interface Salida {
  archivo: string;
  bytes: number;
  url?: string;
  key?: string;
}

export interface Render {
  estado?: 'corriendo' | 'listo' | 'error' | string;
  /** ISO del servidor: cuándo se lanzó (UI·27, «Llevas…»). */
  inicio?: string;
  salidas?: Salida[];
  log?: string;
}

export interface EstadoShorts {
  estado?: 'analizando' | 'candidatos' | 'error' | string;
  /** ISO del servidor: cuándo empezó el análisis (UI·27). */
  inicio?: string;
  candidatos?: Candidato[];
  listo?: string;
  error?: string;
  render?: Render;
}

export interface Importacion {
  estado?: 'descargando' | 'listo' | 'error' | string;
  inicio?: string;
  titulo?: string;
  error?: string;
}

export interface Proyecto {
  shorts: EstadoShorts | null;
  fuente: string | null;
  importar: Importacion | null;
  creditos_por_short?: number;
  cdn?: string;
}

export interface Costo {
  duracion_s: number;
  con_transcript: boolean;
  creditos_analizar: number;
  creditos_por_short: number;
  backend_listo: boolean;
  aviso: string | null;
}

export interface Cotizacion {
  titulo: string;
  duracion_s: number;
  nombre: string;
  creditos: number;
}

export interface Corte {
  start: number;
  end: number;
  hook_line1: string;
  hook_line2: string;
}

export interface EdicionConMetraje {
  nombre: string;
  generado: boolean;
  subidas?: unknown[];
}

const ruta = (p: string) => '/api/shorts/' + encodeURIComponent(p);

export const cargar = (p: string) => pedir<Proyecto>(ruta(p));
export const cargarCosto = (p: string) => pedir<Costo>(ruta(p) + '/costo');
export const analizar = (p: string) => pedir<{ lanzado: boolean; creditos: number }>(ruta(p) + '/analizar', { cuerpo: {} });
export const renderizar = (p: string, cuerpo: { shorts: Corte[]; estilo: string; plataforma: string; tipo: string }) =>
  pedir<{ lanzado: boolean; creditos: number }>(ruta(p) + '/render', { cuerpo });
// la misma regla que server/shorts_api.py `_YT_ID`: así una liga que no es de
// YouTube se corrige en el campo, sin ir al servidor
const ID_YOUTUBE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
export const LIGA_INVALIDA =
  'Esa no parece una liga de YouTube. Cópiala desde «Compartir» del video (youtube.com/watch?v=…, youtu.be/… o /shorts/…).';
export const esLigaDeYoutube = (url: string) => ID_YOUTUBE.test(url);

export const cotizar = (url: string) => pedir<Cotizacion>('/api/shorts/importar/cotizar', { cuerpo: { url } });
export const importar = (url: string) =>
  pedir<{ lanzado: boolean; nombre: string; creditos: number }>('/api/shorts/importar', { cuerpo: { url } });
export const cargarProyectos = () =>
  pedir<EdicionConMetraje[]>('/api/edicion/proyectos').then(ps => ps.filter(p => p.subidas?.length || p.generado));

/** Algo corre en la nube: la descarga de YouTube, el análisis o el render. */
export function vivo(d: Proyecto): boolean {
  return (
    d.importar?.estado === 'descargando' || d.shorts?.estado === 'analizando' || d.shorts?.render?.estado === 'corriendo'
  );
}

export const ESTILOS = ['bold', 'bounce', 'clean'] as const;
export const PLATAFORMAS = [
  ['all', 'todas'],
  ['youtube', 'youtube'],
  ['tiktok', 'tiktok'],
  ['instagram', 'instagram'],
] as const;
export const TIPOS = [
  ['auto', 'detectar solo'],
  ['talking-head', 'persona a cámara'],
  ['screen', 'pantalla'],
  ['podcast', 'podcast'],
] as const;

/** Los límites del server (PedidoRender): se dicen ANTES de cobrar, no con un 400. */
export const MAX_SHORTS = 10;
export const DURACION_MIN = 5;
export const DURACION_MAX = 90;

export function problemaDe(c: Corte): string | null {
  if (!Number.isFinite(c.start) || !Number.isFinite(c.end)) return 'Inicio y fin tienen que ser números.';
  if (c.start < 0) return 'El inicio no puede ser negativo.';
  const d = c.end - c.start;
  if (d < DURACION_MIN || d > DURACION_MAX)
    return `Cada short dura entre ${DURACION_MIN} y ${DURACION_MAX} s (este dura ${d.toFixed(1)} s).`;
  return null;
}

export const minutos = (s: number) => (s >= 90 ? (s / 60).toFixed(1) + ' min' : Math.round(s) + ' s');

export const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

/** Una liga que no es http(s) no se pinta: un `javascript:` en un href corre al clic. */
export function hrefSeguro(url: string | undefined): string | null {
  const t = String(url ?? '').trim();
  return /^https?:\/\//i.test(t) ? t : null;
}

// M22 · D — el atributo `download` no sirve entre orígenes y los shorts viven
// en el CDN: la descarga de verdad pasa por el servicio, que firma el archivo
// con Content-Disposition. Los renders nuevos traen `key`; los de antes, se
// saca de su URL.
export function keyDe(s: Salida, cdn: string | undefined): string {
  if (s.key) return s.key;
  const base = (cdn ?? '') + '/';
  return s.url && base !== '/' && s.url.startsWith(base) ? s.url.slice(base.length) : '';
}

export const urlDescarga = (key: string, nombre: string) =>
  '/api/media/descarga?' + new URLSearchParams({ key, nombre }).toString();

export const conP = (p: string) => '?p=' + encodeURIComponent(p);

// UI·27 — el camino entero de un short, con la misma espera que crear. Son
// pasos de verdad: el servidor dice en cuál va (descargando, analizando, el
// render) y «tú eliges» es la pausa en la que manda la persona. Dentro de cada
// paso no cuenta fases, así que la barra va por pasos y el resto es el reloj.
export const PASOS_SHORTS = [
  { falta: 'Traer tu video', activo: 'Trayendo tu video', hecho: 'Video listo' },
  { falta: 'Analizar el video', activo: 'Analizando: transcript y candidatos', hecho: 'Video analizado' },
  { falta: 'Tú eliges los cortes', hecho: 'Cortes elegidos' },
  { falta: 'Renderizar los shorts', activo: 'Renderizando tus shorts', hecho: 'Shorts listos' },
];
