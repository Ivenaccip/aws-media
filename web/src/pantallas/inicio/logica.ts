// El inicio del estudio sin React: los tipos de /api/proyectos, /api/slots,
// /api/edicion/proyectos, /api/clip, /api/imagenes y /api/blotato, y lo que
// static/index.html calculaba en línea.
//
// Los precios del desplegable salen de tools/tarifas.json (nucleo/tarifas):
// la vieja los tenía ESCRITOS («30», «55–190», «2») y un test comprobaba que
// coincidieran. Aquí no hay número que pueda desfasarse.
import { ErrorApi, pedir } from '../../nucleo/api';
import { video } from '../../nucleo/tarifas';
import { PREDETERMINADO, type Tarea } from './modelos';

// ---------------------------------------------------------------------------
// la caja: qué te llevas (familia) y cuál de esas cosas (opción)

export type Familia = 'videos' | 'imagenes';

export interface Opcion {
  id: string;
  rotulo: string;
  /** Lo que se enseña en el menú de la tarea: «55–190». Vacío si la tarea elige
   *  modelo: ahí el precio es el del modelo, y el menú dice «según el modelo». */
  precio: string;
  destino: string;
  modo?: 'investigacion' | 'idea';
  editar?: boolean;
  /** Si la tarea elige modelo, de qué lista (modelos.ts). */
  modelos?: Tarea;
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
      precio: '',
      modelos: 'clip',
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
      precio: '',
      modelos: 'imagen',
      destino: '/imagenes.html',
      nota: 'Desde cero, con el estilo visual que elijas.',
      hueco: 'Describe la imagen que quieres.',
    },
    {
      id: 'imagen_editar',
      rotulo: 'Editar una imagen',
      precio: '',
      modelos: 'editar',
      destino: '/imagenes.html',
      editar: true,
      nota: 'Subes una que ya tienes y nos dices qué cambiar.',
      hueco: 'Dinos qué cambiarle a tu imagen. La subes en la pantalla siguiente.',
    },
  ],
};

/** A dónde lleva «Crear»: crear.html y clip.html leen `brief`; imagenes.html, `prompt`.
 *  `modelo` (el id, con su calidad si la tiene: `nbp-4k`) viaja SOLO si no es el
 *  predeterminado de la tarea: las direcciones de hoy no cambian, y la pantalla que
 *  cobra decide con su propia lista. */
export function destinoDe(o: Opcion, texto: string, modelo?: string): string {
  const q = new URLSearchParams();
  q.set(o.destino === '/imagenes.html' ? 'prompt' : 'brief', texto);
  if (o.modo) q.set('modo', o.modo);
  if (o.editar) q.set('editar', '1');
  if (o.modelos && modelo && modelo !== PREDETERMINADO[o.modelos]) q.set('modelo', modelo);
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
  /** UI·26: `investigacion` es un Cuento; `idea` y el viejo `auto`, un Video largo. */
  modo?: 'auto' | 'investigacion' | 'idea' | string;
}

/** UI·26: lo que el server resume de los shorts de un proyecto del editor. */
export interface ResumenShorts {
  estado: 'corriendo' | 'listo' | 'error' | 'espera' | string;
  titulo: string;
  inicio: string | null;
  cuantos: number;
}

export interface Edicion {
  nombre: string;
  generado: boolean;
  editor_listo: boolean;
  editar?: { estado?: string } | null;
  subidas?: unknown[];
  creado?: string | null;
  /** null o ausente: el proyecto nunca pasó por shorts. */
  shorts?: ResumenShorts | null;
}

/** Un clip de 8 s tal como lo lista /api/clip (solo lo que usa el inicio). */
export interface ClipCorto {
  id: string;
  estado: 'generando' | 'listo' | 'error' | string;
  texto: string;
  video?: string;
  inicio?: string | null;
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
// En local los clips no corren (503, «corre en el servicio»): ahí no hay
// ninguno, que no es lo mismo que no poder traerlos
export const cargarClips = () =>
  pedir<{ clips?: ClipCorto[] }>('/api/clip').then(
    r => r.clips ?? [],
    (e: unknown) => {
      if (e instanceof ErrorApi && e.estado === 503) return [];
      throw e;
    },
  );
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

// ---------------------------------------------------------------------------
// UI·26 — «Mis videos»: películas, clips y shorts en una sola lista, lo más
// nuevo primero, con su tipo abajo en vez del estado.

export type Tipo = 'largo' | 'corto' | 'shorts' | 'cuento';

export const ETIQUETA: Record<Tipo, string> = {
  largo: 'Video largo',
  corto: 'Video corto',
  shorts: 'Shorts',
  cuento: 'Cuento',
};

export type Video =
  | { tipo: 'largo' | 'cuento'; clave: string; fecha: number; p: Proyecto }
  | { tipo: 'corto'; clave: string; fecha: number; c: ClipCorto }
  | { tipo: 'shorts'; clave: string; fecha: number; e: Edicion & { shorts: ResumenShorts } };

export const tipoPelicula = (p: Proyecto): 'largo' | 'cuento' => (p.modo === 'investigacion' ? 'cuento' : 'largo');

// sin fecha que se entienda, al final (y entre ellas, en el orden en que llegaron)
const cuando = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return isNaN(t) ? -Infinity : t;
};

/** Las tres listas en una: las películas activas (las archivadas van aparte),
 *  los clips y los proyectos del editor que pasaron por shorts. */
export function mezclar(proyectos: Proyecto[], clips: ClipCorto[] | null, ediciones: Edicion[] | null): Video[] {
  const todos: Video[] = [
    ...proyectos
      .filter(p => !p.archivado)
      .map(p => ({ tipo: tipoPelicula(p), clave: 'p:' + p.id, fecha: cuando(p.creado), p })),
    ...(clips ?? []).map(c => ({ tipo: 'corto' as const, clave: 'c:' + c.id, fecha: cuando(c.inicio), c })),
    ...(ediciones ?? []).flatMap(e =>
      e.shorts
        ? [{ tipo: 'shorts' as const, clave: 's:' + e.nombre, fecha: cuando(e.shorts.inicio ?? e.creado), e: { ...e, shorts: e.shorts } }]
        : [],
    ),
  ];
  // sort es estable: a la misma fecha se queda el orden de llegada
  return todos.sort((a, b) => (a.fecha === b.fecha ? 0 : b.fecha > a.fecha ? 1 : -1));
}

// ---------------------------------------------------------------------------
// «Mis creaciones»: todo lo que hiciste en una sola galería, lo más nuevo
// primero. Las películas, los clips y los shorts son los `Video` de arriba; se
// suman las imágenes y las ediciones de metraje. Los filtros solo reducen la lista.

export type Creacion =
  | Video
  | { tipo: 'imagen'; clave: string; fecha: number; im: Imagen }
  | { tipo: 'edicion'; clave: string; fecha: number; e: Edicion };

export type Filtro = 'todo' | 'peliculas' | 'cortos' | 'imagenes' | 'shorts' | 'ediciones';

export const FILTROS: Array<{ id: Filtro; rotulo: string }> = [
  { id: 'todo', rotulo: 'Todo' },
  { id: 'peliculas', rotulo: 'Películas' },
  { id: 'cortos', rotulo: 'Videos cortos' },
  { id: 'imagenes', rotulo: 'Imágenes' },
  { id: 'shorts', rotulo: 'Shorts' },
  { id: 'ediciones', rotulo: 'Ediciones' },
];

export function filtroDe(c: Creacion): Exclude<Filtro, 'todo'> {
  switch (c.tipo) {
    case 'largo':
    case 'cuento':
      return 'peliculas';
    case 'corto':
      return 'cortos';
    case 'imagen':
      return 'imagenes';
    case 'shorts':
      return 'shorts';
    case 'edicion':
      return 'ediciones';
  }
}

/** Todo junto y ordenado: lo más nuevo primero; sin fecha que se entienda, al final. */
export function creaciones(
  proyectos: Proyecto[],
  clips: ClipCorto[] | null,
  ediciones: Edicion[] | null,
  imagenes: Imagen[] | null,
): Creacion[] {
  const todos: Creacion[] = [
    ...mezclar(proyectos, clips, ediciones),
    ...(imagenes ?? []).map(im => ({ tipo: 'imagen' as const, clave: 'i:' + im.nombre, fecha: im.creado * 1000, im })),
    ...(ediciones ?? []).map(e => ({ tipo: 'edicion' as const, clave: 'e:' + e.nombre, fecha: cuando(e.creado), e })),
  ];
  return todos.sort((a, b) => (a.fecha === b.fecha ? 0 : b.fecha > a.fecha ? 1 : -1));
}

type Estado = { icono: 'reloj' | 'guion' | 'listo' | 'aviso'; texto: string; tono?: 'ok' | 'mal' };

/** El estado que va junto a la etiqueta, o null si ya está listo (lista = solo
 *  la etiqueta). */
export function estadoVideo(v: Video): Estado | null {
  if (v.tipo === 'corto') {
    if (v.c.estado === 'generando') return { icono: 'reloj', texto: 'generándose…' };
    if (v.c.estado === 'error') return { icono: 'aviso', texto: 'con error', tono: 'mal' };
    return null;
  }
  if (v.tipo === 'shorts') {
    const e = v.e.shorts.estado;
    if (e === 'listo') return null;
    if (e === 'corriendo') return { icono: 'reloj', texto: 'en proceso…' };
    if (e === 'error') return { icono: 'aviso', texto: 'con error', tono: 'mal' };
    return { icono: 'guion', texto: 'te espera' };
  }
  if (v.p.estado === 'listo') return null;
  return ESTADO[v.p.estado] ?? { icono: 'reloj', texto: v.p.estado };
}

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

/** Cuántas tarjetas enseña la galería antes del «Ver más». */
export const CREACIONES_A_LA_VISTA = 12;

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
