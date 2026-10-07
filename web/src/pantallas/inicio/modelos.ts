// El catálogo de modelos de «¿Qué vamos a crear hoy?»: qué hay, cómo se llama,
// de quién es y en qué nivel va. Los CRÉDITOS no viven aquí: salen de
// tools/tarifas.json §modelos (nucleo/tarifas), la única fuente de precios.
//
// Un modelo se OFRECE solo si dos cosas son ciertas a la vez:
//   · su marca `activo` está encendida (alguien lo probó de verdad), y
//   · tarifas.json le pone número para esa tarea.
// Si falta cualquiera de las dos, no sale en el menú: no se vende un modelo
// sin precio confirmado ni uno que nadie ha probado. Para sumar uno: su costo
// en pricing.json, su número en tarifas.json y su marca aquí, en ese orden.
//
// El servidor NO confía en lo que mande el navegador: este catálogo solo
// decide qué se enseña. Quién cobra, y cuánto, es el servidor.
import { modelos } from '../../nucleo/tarifas';

/** Las tareas que eligen modelo. Cada una tiene su propia lista y su propio precio. */
export type Tarea = 'imagen' | 'editar' | 'clip';

export type Nivel = 'economico' | 'equilibrado' | 'maxima' | 'calidad';

/** Una resolución o calidad con precio propio (Nano Banana Pro: hasta 2K o 4K). */
export interface Calidad {
  id: string;
  etiqueta: string;
}

export interface Modelo {
  id: string;
  nombre: string;
  /** «Proveedor · detalle»: lo que va bajo el nombre. */
  detalle: string;
  nivel: Nivel;
  /** Encendido solo cuando pasó una prueba pagada pequeña. */
  activo: boolean;
  /** Con calidades, el precio de cada una vive en tarifas.json como `<id>-<calidad>`. */
  calidades?: Calidad[];
}

export const TITULO_NIVEL: Record<Nivel, string> = {
  economico: 'Económicos',
  equilibrado: 'Equilibrados',
  maxima: 'Máxima calidad',
  calidad: 'Más calidad',
};

/** Qué niveles tiene cada tarea y en qué orden se enseñan. */
const NIVELES_DE: Record<Tarea, Nivel[]> = {
  imagen: ['economico', 'equilibrado', 'maxima'],
  editar: ['economico', 'equilibrado', 'maxima'],
  clip: ['economico', 'calidad'],
};

export const SUFIJO: Record<Tarea, string> = {
  imagen: 'por imagen',
  editar: 'por imagen',
  clip: 'por clip de 8 s',
};

/** El que arranca elegido: el que ya se usaba (decisión del dueño, 7-oct-2026). */
export const PREDETERMINADO: Record<Tarea, string> = { imagen: 'grok', editar: 'grok', clip: 'veo-lite' };

const HASTA_2K_Y_4K: Calidad[] = [
  { id: '2k', etiqueta: 'hasta 2K' },
  { id: '4k', etiqueta: '4K' },
];

const IMAGEN: Modelo[] = [
  { id: 'grok', nombre: 'Grok Imagine', detalle: 'xAI', nivel: 'economico', activo: true },
  { id: 'klein', nombre: 'FLUX.2 klein', detalle: 'Black Forest Labs', nivel: 'economico', activo: false },
  { id: 'zit', nombre: 'Z-Image Turbo', detalle: 'Rápido y barato', nivel: 'economico', activo: false },
  { id: 'flux2', nombre: 'FLUX.2 pro', detalle: 'Black Forest Labs', nivel: 'economico', activo: false },
  { id: 'sdf', nombre: 'Seedream 5.0 Flash', detalle: 'ByteDance', nivel: 'economico', activo: false },
  { id: 'nbl', nombre: 'Nano Banana 2 Lite', detalle: 'Google', nivel: 'equilibrado', activo: false },
  { id: 'sd45', nombre: 'Seedream 4.5', detalle: 'ByteDance', nivel: 'equilibrado', activo: false },
  { id: 'gpt2', nombre: 'GPT Image 2', detalle: 'OpenAI', nivel: 'equilibrado', activo: false },
  { id: 'gpt25', nombre: 'GPT Image 2.5', detalle: 'OpenAI', nivel: 'equilibrado', activo: false },
  { id: 'flux3', nombre: 'FLUX 3', detalle: 'Black Forest Labs', nivel: 'equilibrado', activo: false },
  { id: 'nb2', nombre: 'Nano Banana 2', detalle: 'Google', nivel: 'equilibrado', activo: false },
  {
    id: 'nbp',
    nombre: 'Nano Banana Pro',
    detalle: 'Google · elige la resolución abajo',
    nivel: 'maxima',
    activo: false,
    calidades: HASTA_2K_Y_4K,
  },
];

/** Para editar solo entran los que tienen versión «edit» en fal. */
const CON_EDICION = new Set(['grok', 'gpt2', 'nb2', 'nbp']);

const CLIP: Modelo[] = [
  { id: 'h3t', nombre: 'MiniMax H3 Max Turbo', detalle: 'MiniMax · 768p', nivel: 'economico', activo: false },
  { id: 'veo-lite', nombre: 'Veo 3.1 Lite', detalle: 'Google · 720p con audio', nivel: 'economico', activo: true },
  { id: 'grokv', nombre: 'Grok Imagine Video', detalle: 'xAI · 720p', nivel: 'economico', activo: false },
  { id: 'ltx', nombre: 'LTX-2.5 Fast', detalle: 'Lightricks · 720p con audio', nivel: 'economico', activo: false },
  { id: 'veo-fast', nombre: 'Veo 3.1 Fast', detalle: 'Google · 1080p con audio', nivel: 'calidad', activo: false },
  { id: 'kling', nombre: 'Kling V3 Pro', detalle: 'Kuaishou · con audio', nivel: 'calidad', activo: false },
  { id: 'seed', nombre: 'Seedance 2.0', detalle: 'ByteDance · 720p con audio', nivel: 'calidad', activo: false },
  { id: 'veo-std', nombre: 'Veo 3.1 Standard', detalle: 'Google · 1080p con audio', nivel: 'calidad', activo: false },
];

export const CATALOGO: Record<Tarea, Modelo[]> = {
  imagen: IMAGEN,
  editar: IMAGEN.filter(m => CON_EDICION.has(m.id)),
  clip: CLIP,
};

const PRECIOS = modelos as unknown as Record<Tarea, Record<string, number>>;

/** La llave del precio en tarifas.json: el modelo solo, o `<modelo>-<calidad>`. */
export const llavePrecio = (id: string, calidad?: string) => (calidad ? `${id}-${calidad}` : id);

/** Créditos de ese modelo (y calidad) en esa tarea, o null si tarifas.json no tiene número. */
export function precioDe(
  tarea: Tarea,
  id: string,
  calidad?: string,
  precios: Record<Tarea, Record<string, number>> = PRECIOS,
): number | null {
  const n: number | undefined = precios[tarea]?.[llavePrecio(id, calidad)];
  return n !== undefined && Number.isInteger(n) && n > 0 ? n : null;
}

/** ¿Hay precio para el modelo? Con calidades, para TODAS: una a medias no se ofrece. */
function conPrecio(tarea: Tarea, m: Modelo, precios: Record<Tarea, Record<string, number>>) {
  return m.calidades
    ? m.calidades.every(c => precioDe(tarea, m.id, c.id, precios) !== null)
    : precioDe(tarea, m.id, undefined, precios) !== null;
}

/** Los créditos más bajos del modelo: el «desde» cuando tiene calidades. */
export function precioMinimo(
  tarea: Tarea,
  m: Modelo,
  precios: Record<Tarea, Record<string, number>> = PRECIOS,
): number {
  const lista = m.calidades ? m.calidades.map(c => precioDe(tarea, m.id, c.id, precios)!) : [precioDe(tarea, m.id, undefined, precios)!];
  return Math.min(...lista);
}

export interface Grupo {
  nivel: Nivel;
  titulo: string;
  /** «✦ 2–3» sin el ✦: «2–3», o «2» si es uno solo. */
  rango: string;
  modelos: Modelo[];
}

/** Los modelos que de verdad se ofrecen, por nivel y de menor a mayor precio. */
export function grupos(
  tarea: Tarea,
  catalogo: Record<Tarea, Modelo[]> = CATALOGO,
  precios: Record<Tarea, Record<string, number>> = PRECIOS,
): Grupo[] {
  const ofrecidos = catalogo[tarea].filter(m => m.activo && conPrecio(tarea, m, precios));
  return NIVELES_DE[tarea]
    .map(nivel => {
      const delNivel = ofrecidos
        .filter(m => m.nivel === nivel)
        .sort((a, b) => precioMinimo(tarea, a, precios) - precioMinimo(tarea, b, precios));
      const todos = delNivel.flatMap(m =>
        m.calidades ? m.calidades.map(c => precioDe(tarea, m.id, c.id, precios)!) : [precioDe(tarea, m.id, undefined, precios)!],
      );
      const lo = Math.min(...todos);
      const hi = Math.max(...todos);
      return { nivel, titulo: TITULO_NIVEL[nivel], rango: lo === hi ? String(lo) : `${lo}–${hi}`, modelos: delNivel };
    })
    .filter(g => g.modelos.length > 0);
}
