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
// El clip cobra por DURACIÓN (4, 6 u 8 s): su número en tarifas.json es un
// objeto `{ "4": 18, "6": 28, "8": 36 }`. El modelo se ofrece si tiene número
// para al menos una duración, y en el menú solo se puede elegir en las que lo
// tiene. Una duración sin número no cuesta cero ni cae en otra: no existe para
// ese modelo (el servidor la rechaza con 422). Imagen y editar no tienen
// duración y siguen con un entero.
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

/**
 * Qué pasa con el sonido de un modelo de clip (solo el clip lo tiene):
 *  · `opcional`: su endpoint deja pedirlo con o sin sonido (Veo, LTX, Kling, Seedance). Se puede apagar con el
 *    interruptor «Audio» si tarifas.json trae su número `clip_sin_audio` para esa duración;
 *  · `incluido`: trae una pista que no se puede quitar y se oye bien (MiniMax);
 *  · `bajo`: trae una pista que no se puede quitar y casi no se oye (Grok y Grok 1.5 Lite).
 * Es el espejo de `Modelo.audio_opcional` del servidor (tests/test_r4_ola4.py lo compara); el servidor es quien decide.
 */
export type Sonido = 'opcional' | 'incluido' | 'bajo';

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
  /** Solo el clip: ver `Sonido`. */
  sonido?: Sonido;
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

/** Las duraciones del clip que el producto sabe pedir, en segundos (decisión del dueño, 9-oct-2026). */
export const DURACIONES = [4, 6, 8];
/** La que arranca elegida: la que el producto ya prometía (36 créditos). */
export const DURACION_PREDETERMINADA = 8;
/** ¿El precio de esta tarea depende de la duración? Hoy solo el clip. */
const CON_DURACION: Record<Tarea, boolean> = { imagen: false, editar: false, clip: true };

/** Lo que sigue al precio: «por imagen», «por clip de 6 s». */
export function sufijo(tarea: Tarea, segundos = DURACION_PREDETERMINADA): string {
  return tarea === 'clip' ? `por clip de ${segundos} s` : 'por imagen';
}

/** El que arranca elegido: el que ya se usaba (decisión del dueño, 7-oct-2026). */
export const PREDETERMINADO: Record<Tarea, string> = { imagen: 'grok', editar: 'grok', clip: 'veo-lite' };

const HASTA_2K_Y_4K: Calidad[] = [
  { id: '2k', etiqueta: 'hasta 2K' },
  { id: '4k', etiqueta: '4K' },
];

const IMAGEN: Modelo[] = [
  { id: 'grok', nombre: 'Grok Imagine', detalle: 'xAI', nivel: 'economico', activo: true },
  { id: 'klein', nombre: 'FLUX.2 klein', detalle: 'Black Forest Labs', nivel: 'economico', activo: true },
  { id: 'zit', nombre: 'Z-Image Turbo', detalle: 'Rápido y barato', nivel: 'economico', activo: true },
  { id: 'flux2', nombre: 'FLUX.2 pro', detalle: 'Black Forest Labs', nivel: 'economico', activo: true },
  { id: 'sdf', nombre: 'Seedream 5.0 Flash', detalle: 'ByteDance', nivel: 'economico', activo: true },
  { id: 'nbl', nombre: 'Nano Banana 2 Lite', detalle: 'Google', nivel: 'equilibrado', activo: false },
  { id: 'sd45', nombre: 'Seedream 4.5', detalle: 'ByteDance', nivel: 'equilibrado', activo: true },
  { id: 'gpt2', nombre: 'GPT Image 2', detalle: 'OpenAI', nivel: 'equilibrado', activo: false },
  { id: 'gpt25', nombre: 'GPT Image 2.5', detalle: 'OpenAI', nivel: 'equilibrado', activo: false },
  { id: 'flux3', nombre: 'FLUX 3', detalle: 'Black Forest Labs', nivel: 'equilibrado', activo: true },
  { id: 'nb2', nombre: 'Nano Banana 2', detalle: 'Google', nivel: 'equilibrado', activo: true },
  {
    id: 'nbp',
    nombre: 'Nano Banana Pro',
    detalle: 'Google · elige la resolución abajo',
    nivel: 'maxima',
    activo: true,
    calidades: HASTA_2K_Y_4K,
  },
];

/**
 * Para editar solo entran los que tienen versión «edit» en fal y que el servidor sabe editar. Nano Banana Pro tiene
 * `/edit` en fal, pero editar con él no se ofrece todavía (no cabe en la petición: necesita su propio camino en segundo
 * plano), así que no entra mientras tanto: encendido para crear, no debe aparecer en «Editar» sin fila ni número allí.
 */
const CON_EDICION = new Set(['grok', 'gpt2', 'nb2']);

const CLIP: Modelo[] = [
  { id: 'h3t', nombre: 'MiniMax H3 Max Turbo', detalle: 'MiniMax · 768p', nivel: 'economico', activo: true, sonido: 'incluido' },
  { id: 'veo-lite', nombre: 'Veo 3.1 Lite', detalle: 'Google · 720p con audio', nivel: 'economico', activo: true, sonido: 'opcional' },
  { id: 'grokv', nombre: 'Grok Imagine Video', detalle: 'xAI · 720p', nivel: 'economico', activo: true, sonido: 'bajo' },
  { id: 'grokl', nombre: 'Grok Imagine Video 1.5 Lite', detalle: 'xAI · 720p', nivel: 'economico', activo: true, sonido: 'bajo' },
  { id: 'ltx', nombre: 'LTX-2.5 Fast', detalle: 'Lightricks · 720p con audio', nivel: 'economico', activo: false, sonido: 'opcional' },
  { id: 'veo-fast', nombre: 'Veo 3.1 Fast', detalle: 'Google · 720p con audio', nivel: 'calidad', activo: true, sonido: 'opcional' },
  { id: 'kling', nombre: 'Kling V3 Pro', detalle: 'Kuaishou · con audio', nivel: 'calidad', activo: false, sonido: 'opcional' },
  { id: 'seed', nombre: 'Seedance 2.0', detalle: 'ByteDance · 720p con audio', nivel: 'calidad', activo: false, sonido: 'opcional' },
  { id: 'veo-std', nombre: 'Veo 3.1 Standard', detalle: 'Google · 720p con audio', nivel: 'calidad', activo: false, sonido: 'opcional' },
];

export const CATALOGO: Record<Tarea, Modelo[]> = {
  imagen: IMAGEN,
  editar: IMAGEN.filter(m => CON_EDICION.has(m.id)),
  clip: CLIP,
};

/** Los créditos de un modelo de clip, por duración: las llaves son los segundos como texto. */
export type PorDuracion = Record<string, number>;
/** tarifas.json §modelos: un entero por modelo, o (clip) un objeto por duración. `clip_sin_audio` es la tabla del
 *  clip SIN sonido (solo los modelos que lo permiten); puede faltar, y sin ella nada se puede apagar. */
export type TablaPrecios = Record<Tarea, Record<string, number | PorDuracion>> & {
  clip_sin_audio?: Record<string, PorDuracion>;
};

export const PRECIOS = modelos as unknown as TablaPrecios;

/** La llave del precio en tarifas.json: el modelo solo, o `<modelo>-<calidad>`. */
export const llavePrecio = (id: string, calidad?: string) => (calidad ? `${id}-${calidad}` : id);

const esCredito = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;

/** Los créditos del clip SIN sonido en esa duración, o null si tarifas.json no trae el número (no se puede apagar). */
function precioSinSonido(id: string, precios: TablaPrecios, segundos: number): number | null {
  const n = precios.clip_sin_audio?.[id]?.[String(segundos)];
  return esCredito(n) ? n : null;
}

/**
 * Créditos de ese modelo (y calidad) en esa tarea, o null si tarifas.json no tiene número.
 * En el clip el número es el de esa duración; en imagen y editar la duración no cuenta.
 * `sonido` (solo el clip, con sonido por defecto): con `false` y un modelo que se puede apagar, el número es el de
 * «sin sonido»; un modelo que no se puede apagar sigue costando lo de con sonido, porque siempre lo trae.
 */
export function precioDe(
  tarea: Tarea,
  id: string,
  calidad?: string,
  precios: TablaPrecios = PRECIOS,
  segundos = DURACION_PREDETERMINADA,
  sonido = true,
): number | null {
  if (tarea === 'clip' && !sonido) {
    const sin = precioSinSonido(id, precios, segundos);
    if (sin !== null) return sin;
  }
  const e = precios[tarea]?.[llavePrecio(id, calidad)];
  const n = CON_DURACION[tarea] ? (e && typeof e === 'object' ? e[String(segundos)] : undefined) : e;
  return esCredito(n) ? n : null;
}

/** ¿Se puede pedir este clip sin sonido? Su endpoint lo permite Y tarifas.json trae su número «sin sonido» a esa duración. */
export function puedeApagar(m: Modelo, segundos = DURACION_PREDETERMINADA, precios: TablaPrecios = PRECIOS): boolean {
  return m.sonido === 'opcional' && precioSinSonido(m.id, precios, segundos) !== null;
}

/** Lo que se ahorra sin sonido, en créditos; 0 si no se puede apagar. */
export function ahorroSinSonido(m: Modelo, segundos = DURACION_PREDETERMINADA, precios: TablaPrecios = PRECIOS): number {
  if (!puedeApagar(m, segundos, precios)) return 0;
  const con = precioDe('clip', m.id, undefined, precios, segundos);
  const sin = precioSinSonido(m.id, precios, segundos);
  return con !== null && sin !== null ? Math.max(0, con - sin) : 0;
}

/** Lo que dice el interruptor de un modelo que NO se puede apagar: el estado corto y el motivo. */
export function textoSonido(m: Modelo): { estado: string; motivo: string } {
  return m.sonido === 'bajo'
    ? { estado: 'Sonido muy bajo', motivo: `El sonido de ${m.nombre} es muy bajo y no se puede apagar.` }
    : { estado: 'Sonido incluido', motivo: `${m.nombre} trae su propio sonido y no se puede apagar.` };
}

/** Lo que va bajo el nombre de la fila: «… con audio», o «… sin audio» si el clip es mudo y el modelo lo permite. */
export function detalleDe(m: Modelo, segundos: number, sonido: boolean, precios: TablaPrecios = PRECIOS): string {
  return !sonido && puedeApagar(m, segundos, precios) ? m.detalle.replace('con audio', 'sin audio') : m.detalle;
}

/** Las calidades del modelo, o `undefined` una vez si no tiene: así se recorren igual. */
const calidadesDe = (m: Modelo) => (m.calidades ? m.calidades.map(c => c.id) : [undefined]);

/** ¿Hay precio para el modelo en esa duración? Con calidades, para TODAS: una a medias no se ofrece. */
export function admite(tarea: Tarea, m: Modelo, segundos = DURACION_PREDETERMINADA, precios: TablaPrecios = PRECIOS) {
  return calidadesDe(m).every(c => precioDe(tarea, m.id, c, precios, segundos) !== null);
}

/** Las duraciones (de menor a mayor) en que el modelo tiene precio. Sin duración que elegir (imagen, editar): ninguna. */
export function duracionesDe(tarea: Tarea, m: Modelo, precios: TablaPrecios = PRECIOS): number[] {
  return CON_DURACION[tarea] ? DURACIONES.filter(s => admite(tarea, m, s, precios)) : [];
}

/**
 * Los créditos más bajos del modelo: el «desde» cuando tiene calidades. Con
 * `segundos`, los de esa duración; sin ellos, los de la duración más barata.
 * null si no hay ninguno.
 */
export function precioMinimo(
  tarea: Tarea,
  m: Modelo,
  precios: TablaPrecios = PRECIOS,
  segundos?: number,
): number | null {
  const duraciones = !CON_DURACION[tarea] ? [DURACION_PREDETERMINADA] : segundos === undefined ? DURACIONES : [segundos];
  const lista = duraciones.flatMap(s => calidadesDe(m).map(c => precioDe(tarea, m.id, c, precios, s)));
  const hay = lista.filter((n): n is number => n !== null);
  return hay.length ? Math.min(...hay) : null;
}

export interface Grupo {
  nivel: Nivel;
  titulo: string;
  /** «✦ 2–3» sin el ✦: «2–3», o «2» si es uno solo. Vacío si ningún modelo del grupo lo admite en esa duración. */
  rango: string;
  modelos: Modelo[];
}

/** Los modelos que de verdad se ofrecen: activos y con precio (en el clip, en al menos una duración). */
export function ofrecidosDe(
  tarea: Tarea,
  catalogo: Record<Tarea, Modelo[]> = CATALOGO,
  precios: TablaPrecios = PRECIOS,
): Modelo[] {
  return catalogo[tarea].filter(
    m => m.activo && (CON_DURACION[tarea] ? duracionesDe(tarea, m, precios).length > 0 : admite(tarea, m, undefined, precios)),
  );
}

/** Las duraciones que se pueden elegir: las que al menos un modelo ofrecido admite. */
export function duracionesOfrecidas(tarea: Tarea, modelos: Modelo[], precios: TablaPrecios = PRECIOS): number[] {
  return CON_DURACION[tarea] ? DURACIONES.filter(s => modelos.some(m => admite(tarea, m, s, precios))) : [];
}

/** La duración que rige: la pedida si se puede elegir; si no, la de siempre o la más larga que sí. */
export function duracionVigente(opciones: number[], pedida: number): number {
  if (!opciones.length || opciones.includes(pedida)) return pedida;
  return opciones.includes(DURACION_PREDETERMINADA) ? DURACION_PREDETERMINADA : opciones[opciones.length - 1]!;
}

/** Los modelos que se ofrecen, por nivel y de menor a mayor precio; los créditos del rango son los de esa duración. */
export function grupos(
  tarea: Tarea,
  catalogo: Record<Tarea, Modelo[]> = CATALOGO,
  precios: TablaPrecios = PRECIOS,
  segundos = DURACION_PREDETERMINADA,
  sonido = true,
): Grupo[] {
  const ofrecidos = ofrecidosDe(tarea, catalogo, precios);
  return NIVELES_DE[tarea]
    .map(nivel => {
      // el orden NO mira la duración elegida ni el sonido: al cambiarlos, las filas no se mueven.
      // Se compara a la duración más larga de cada modelo (8 s en casi todos), con sonido
      const largo = (m: Modelo) => precioMinimo(tarea, m, precios, duracionesDe(tarea, m, precios).at(-1))!;
      const delNivel = ofrecidos.filter(m => m.nivel === nivel).sort((a, b) => largo(a) - largo(b));
      const todos = delNivel
        .filter(m => admite(tarea, m, segundos, precios))
        .flatMap(m => calidadesDe(m).map(c => precioDe(tarea, m.id, c, precios, segundos, sonido)!));
      const lo = Math.min(...todos);
      const hi = Math.max(...todos);
      const rango = !todos.length ? '' : lo === hi ? String(lo) : `${lo}–${hi}`;
      return { nivel, titulo: TITULO_NIVEL[nivel], rango, modelos: delNivel };
    })
    .filter(g => g.modelos.length > 0);
}

/**
 * El modelo que rige para esa duración: el elegido si la admite; si no, el
 * predeterminado de la tarea; si ese tampoco, el primero que sí.
 */
export function modeloPara(
  tarea: Tarea,
  modelos: Modelo[],
  id: string | undefined,
  segundos = DURACION_PREDETERMINADA,
  precios: TablaPrecios = PRECIOS,
): Modelo | undefined {
  for (const quiero of [id, PREDETERMINADO[tarea]]) {
    const m = modelos.find(x => x.id === quiero);
    if (m && admite(tarea, m, segundos, precios)) return m;
  }
  return modelos.find(m => admite(tarea, m, segundos, precios));
}

/**
 * Al pedir otra duración: si el modelo elegido no la admite, cuál queda y qué se
 * le dice a la persona. null si el elegido sirve (o no hay con qué sustituirlo).
 */
export function cambioPorDuracion(
  tarea: Tarea,
  modelos: Modelo[],
  actual: Modelo,
  segundos: number,
  precios: TablaPrecios = PRECIOS,
): { queda: Modelo; aviso: string } | null {
  if (admite(tarea, actual, segundos, precios)) return null;
  const queda = modeloPara(tarea, modelos, undefined, segundos, precios);
  const desde = duracionesDe(tarea, actual, precios)[0];
  if (!queda || desde === undefined) return null;
  return { queda, aviso: `${actual.nombre} empieza en ${desde} s. Te dejamos ${queda.nombre}.` };
}
