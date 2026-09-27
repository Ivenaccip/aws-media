// El inicio del estudio sin React: los tipos de /api/proyectos, /api/slots,
// /api/edicion/proyectos, /api/imagenes y /api/blotato, y lo que
// static/index.html calculaba en línea.
//
// Los precios del desplegable salen de tools/tarifas.json (nucleo/tarifas):
// la vieja los tenía ESCRITOS («30», «55–190», «2») y un test comprobaba que
// coincidieran. Aquí no hay número que pueda desfasarse.
import { pedir } from '../../nucleo/api';
import { clip, video } from '../../nucleo/tarifas';

// ---------------------------------------------------------------------------
// la caja: qué te llevas (familia) y cuál de esas cosas (opción)

export type Familia = 'videos' | 'imagenes';

export interface Opcion {
  id: string;
  rotulo: string;
  /** El precio tal cual se enseña: «30» o «55–190». */
  precio: string;
  destino: string;
  modo?: 'investigacion' | 'idea';
  editar?: boolean;
  nota: string;
  hueco: string;
}

const duraciones = Object.values(video.por_duracion);
const historias = `${Math.min(...duraciones)}–${Math.max(...duraciones)}`;

export const OPCIONES: Record<Familia, Opcion[]> = {
  videos: [
    {
      id: 'clip',
      rotulo: 'Un video corto',
      precio: String(clip.video_8s),
      destino: '/clip.html',
      nota: 'Ocho segundos con sonido, de una sola toma. Puedes subir hasta 3 fotos.',
      hueco: 'Escribe qué quieres ver. Ejemplo: «mi perro corriendo en la playa al atardecer».',
    },
    {
      id: 'investigacion',
      rotulo: 'Creador de cuentos',
      precio: historias,
      destino: '/crear.html',
      modo: 'investigacion',
      nota: 'Buscamos las fuentes y escribimos el guion por ti. Lo revisas antes de producir.',
      hueco: 'Cuéntanos el tema. Ejemplo: «cómo empezó la Segunda Guerra Mundial».',
    },
    {
      id: 'historia',
      rotulo: 'Crea tu historia',
      precio: historias,
      destino: '/crear.html',
      modo: 'idea',
      nota: 'Usamos tu texto tal cual, sin investigar. Lo revisas antes de producir.',
      hueco: 'Pega tu historia completa — la respetamos como la escribiste.',
    },
  ],
  imagenes: [
    {
      id: 'imagen',
      rotulo: 'Crear una imagen',
      precio: String(video.imagen),
      destino: '/imagenes.html',
      nota: 'Desde cero, con el estilo visual que elijas.',
      hueco: 'Describe la imagen que quieres.',
    },
    {
      id: 'imagen_editar',
      rotulo: 'Editar una imagen',
      precio: String(video.imagen),
      destino: '/imagenes.html',
      editar: true,
      nota: 'Subes una que ya tienes y nos dices qué cambiar.',
      hueco: 'Dinos qué cambiarle a tu imagen. La subes en la pantalla siguiente.',
    },
  ],
};

/** A dónde lleva «Crear»: crear.html y clip.html leen `brief`; imagenes.html, `prompt`. */
export function destinoDe(o: Opcion, texto: string): string {
  const q = new URLSearchParams();
  q.set(o.destino === '/imagenes.html' ? 'prompt' : 'brief', texto);
  if (o.modo) q.set('modo', o.modo);
  if (o.editar) q.set('editar', '1');
  return o.destino + '?' + q.toString();
}

// ---------------------------------------------------------------------------
// las listas

export type EstadoProyecto = 'creado' | 'preparando' | 'revision' | 'produciendo' | 'listo' | 'error' | string;

export interface Proyecto {
  id: string;
  creado: string;
  estado: EstadoProyecto;
  brief: string;
  archivado: boolean;
  miniatura: string | null;
  miniatura_alt: string | null;
}

export interface Edicion {
  nombre: string;
  generado: boolean;
  editor_listo: boolean;
  editar?: { estado?: string } | null;
  subidas?: unknown[];
}

export interface Imagen {
  nombre: string;
  url: string;
  /** Segundos desde 1970. */
  creado: number;
}

export const cargarProyectos = () => pedir<Proyecto[]>('/api/proyectos');
export const cargarSlots = () => pedir<{ slots: number | null }>('/api/slots');
export const cargarEdiciones = () => pedir<Edicion[]>('/api/edicion/proyectos');
export const cargarImagenes = () => pedir<{ imagenes?: Imagen[] }>('/api/imagenes').then(r => r.imagenes ?? []);

export const archivar = (id: string) =>
  pedir<Proyecto>('/api/proyectos/' + encodeURIComponent(id) + '/archivar', { metodo: 'POST' });
export const desarchivar = (id: string) =>
  pedir<Proyecto>('/api/proyectos/' + encodeURIComponent(id) + '/desarchivar', { metodo: 'POST' });

export const archivo = (id: string, nombre: string) =>
  '/api/proyectos/' + encodeURIComponent(id) + '/archivo/' + encodeURIComponent(nombre);

// El icono y el tono de cada estado (carta §6). El color solo marca los dos
// finales: listo (verde) y con error (rojo).
export const ESTADO: Record<string, { icono: 'reloj' | 'guion' | 'listo' | 'aviso'; texto: string; tono?: 'ok' | 'mal' }> = {
  creado: { icono: 'reloj', texto: 'en preparación' },
  preparando: { icono: 'reloj', texto: 'en preparación' },
  revision: { icono: 'guion', texto: 'en revisión — te espera' },
  produciendo: { icono: 'reloj', texto: 'produciéndose…' },
  listo: { icono: 'listo', texto: 'lista', tono: 'ok' },
  error: { icono: 'aviso', texto: 'con error', tono: 'mal' },
};

/** Mientras corre una tarea el server no deja archivar (409): ni se ofrece. */
export const archivable = (p: Proyecto) => !['preparando', 'produciendo'].includes(p.estado);

// proyectos viejos pueden traer `creado` en un formato raro: sin fecha antes que «Invalid Date»
export function fechaCorta(creado: string): string {
  const d = new Date(creado);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-MX');
}

export function textoSlots(activos: number, slots: number | null): string {
  if (slots === null) return activos ? `${activos} activos · slots ilimitados` : '';
  return `${activos} de ${slots} slots`;
}

export function estadoEdicion(e: Edicion): { icono?: 'reloj' | 'aviso' | 'cortar'; texto: string; tono?: 'ok' | 'mal' } {
  const st = e.editar ?? {};
  if (st.estado === 'corriendo') return { icono: 'reloj', texto: 'sugerencias en curso…' };
  if (st.estado === 'error') return { icono: 'aviso', texto: 'la corrida falló', tono: 'mal' };
  if (e.editor_listo) return { icono: 'cortar', texto: 'corte listo — ábrelo en el editor', tono: 'ok' };
  if (e.subidas?.length) return { texto: 'metraje subido — pide el corte' };
  return { texto: e.generado ? 'película generada' : 'sin metraje aún' };
}

export const IMG_A_LA_VISTA = 5;

export function diaImagen(creado: number): string {
  const d = new Date(creado * 1000);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

// la forma sale de la imagen misma: los nombres no la guardan
export const forma = (w: number, h: number) => (w > h * 1.15 ? 'Horizontal' : h > w * 1.15 ? 'Vertical' : 'Cuadrada');

// ---------------------------------------------------------------------------
// Blotato (M23 · C). La clave solo viaja en el POST; ninguna respuesta la trae.

export interface CuentaBlotato {
  id: string;
  platform: string;
  fullname: string;
  username: string;
}

export interface EstadoBlotato {
  conectado: boolean;
  origen: 'usuario' | 'env' | string | null;
  cuentas: CuentaBlotato[];
  error: string | null;
  plan: { nombre: string; usd_por_mes: number } | null;
}

export const leerBlotato = (ligero = false) => pedir<EstadoBlotato>('/api/blotato' + (ligero ? '?redes=0' : ''));
export const conectarBlotato = (clave: string) => pedir<EstadoBlotato>('/api/blotato', { cuerpo: { clave } });
export const quitarBlotato = () => pedir<EstadoBlotato>('/api/blotato', { metodo: 'DELETE' });

export const RED: Record<string, string> = {
  twitter: 'X',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  pinterest: 'Pinterest',
  threads: 'Threads',
  bluesky: 'Bluesky',
  youtube: 'YouTube',
};
