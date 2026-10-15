// Las reglas de «Agregar videos» (E2) sin React: por qué un video no se puede elegir, cuándo uno solo es demasiado corto, qué dice
// el pie de la hoja, cómo se numeran y se reordenan los videos de la caja. Son las del lienzo (Elegir-videos-estados.dc.html:
// motivoHoja, unicoCorto, cuentaHoja) MÁS lo que el lienzo no tiene: el tope de videos, el de peso y los motivos que manda el
// servidor (copia, en curso, sin metraje, midiendo).
//
// La UI AVISA y apaga; el SERVIDOR GARANTIZA (docs: contrato E2, regla «la UI nunca es la única barrera»). Por eso las cuatro
// constantes de abajo son de RESPALDO: la hoja usa las que trae GET /api/edicion/elegibles (`limites`), y estas solo valen mientras
// no llega la respuesta. tests/test_e2_limites.py compara estas cuatro líneas, con una regex, contra las del servidor: cada
// una va en UNA línea y con este formato exacto.
import { reloj } from './edicion';
import type { FormatoVideo, LimitesDeEdicion, TipoVideo, VideoElegible } from './envio';

export type { FormatoVideo, TipoVideo, VideoElegible } from './envio';

/** 90 minutos en total (la suma de todo lo elegido). */
export const MAX_S = 5400;
/** Un video solo, para editarse solo, debe durar al menos 1 minuto. Al unir dos o más no hay mínimo. */
export const MIN_SOLO_S = 60;
/** Como mucho 12 videos a la vez. */
export const MAX_VIDEOS = 12;
/** 15 GB en total: el disco del servicio que une los videos. */
export const MAX_BYTES = 16106127360;

export const LIMITES_DE_RESPALDO: LimitesDeEdicion = { max_s: MAX_S, min_solo_s: MIN_SOLO_S, max_videos: MAX_VIDEOS, max_bytes: MAX_BYTES };

/** Lo que las reglas necesitan saber de un video que ya está en la caja o marcado en la hoja. Todo puede faltar: de un archivo
 *  recién subido la duración y el formato llegan con el primer `cotizar`. */
export interface FichaDeVideo {
  ref: string | null;
  duracion_s: number | null;
  formato: FormatoVideo | null;
  bytes: number | null;
}

// ---------------------------------------------------------------------------
// rótulos

const ETIQUETA_DE_TIPO: Record<TipoVideo, string> = { pelicula: 'Película', cuento: 'Cuento', clip: 'Clip', edicion: 'Edición' };

export const rotuloDeTipo = (tipo: TipoVideo): string => ETIQUETA_DE_TIPO[tipo];

/** La proporción tal como la lee una persona: `16:9` o `9:16`. Sin formato (aún no se mide), nada. */
export const rotuloDeFormato = (formato: FormatoVideo | null | undefined): string =>
  formato === 'horizontal' ? '16:9' : formato === 'vertical' ? '9:16' : '';

/** `d/m` en es-MX («2/10»): la fecha corta de la hoja. Una que no se entiende, vacía. */
export function fechaDeLaHoja(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString('es-MX', { day: 'numeric', month: 'numeric' }) : '';
}

const minutos = (segundos: number) => Math.round(segundos / 60);
const gigas = (bytes: number) => Math.round((bytes / 1024 ** 3) * 10) / 10;

// ---------------------------------------------------------------------------
// sumas

/** Lo que duran juntos: los que aún no se miden cuentan cero (se sabe con el primer `cotizar`). */
export const sumar = (fichas: ReadonlyArray<{ duracion_s: number | null }>): number => fichas.reduce((a, f) => a + (f.duracion_s ?? 0), 0);

const pesar = (fichas: ReadonlyArray<{ bytes: number | null }>): number => fichas.reduce((a, f) => a + (f.bytes ?? 0), 0);

/** ¿Se sabe cuánto dura TODO? Si a alguno le falta la duración, una suma sería una mentira a medias. */
export const duracionCompleta = (fichas: ReadonlyArray<{ duracion_s: number | null }>): boolean => fichas.every(f => f.duracion_s !== null);

// ---------------------------------------------------------------------------
// la hoja: por qué un video no se puede elegir

export type CodigoDeMotivo = 'larga' | 'es_copia' | 'en_curso' | 'sin_metraje' | 'midiendo' | 'en_caja' | 'formato' | 'se_pasa' | 'maximo' | 'peso';

export interface Motivo {
  codigo: CodigoDeMotivo;
  texto: string;
  /** Va en «No se pueden editar»: es del video, no de la selección (los demás se apagan en su lugar y se pueden volver a encender). */
  aparte: boolean;
}

/**
 * Por qué ese video no se puede marcar ahora, o null si se puede. El PRIMERO que aplique, en este orden: más de 90 min, es una
 * edición (copia), se está editando ahora, sin metraje, midiéndose; y los que dependen de lo ya elegido: ya está en la caja, formato
 * distinto, se pasaría de 90 min, ya son 12, pesarían demasiado juntos.
 *
 * `base` es lo marcado en la hoja; `enCaja`, lo que ya tiene la caja. Uno ya marcado nunca se apaga (se puede desmarcar).
 */
export function motivoHoja(
  v: VideoElegible,
  base: readonly FichaDeVideo[],
  enCaja: readonly FichaDeVideo[],
  lim: LimitesDeEdicion = LIMITES_DE_RESPALDO,
): Motivo | null {
  if (v.duracion_s !== null && v.duracion_s > lim.max_s) {
    return { codigo: 'larga', texto: `Dura ${minutos(v.duracion_s)} min · máximo ${minutos(lim.max_s)} min`, aparte: true };
  }
  if (v.es_copia || v.motivo === 'es_copia') {
    return { codigo: 'es_copia', texto: 'Ya es una edición · ábrela en su editor', aparte: true };
  }
  if (v.motivo === 'en_curso') return { codigo: 'en_curso', texto: 'Se está editando ahora', aparte: true };
  if (v.motivo === 'sin_metraje') return { codigo: 'sin_metraje', texto: 'No tiene video para editar', aparte: true };
  if (v.motivo === 'midiendo' || v.duracion_s === null) {
    return { codigo: 'midiendo', texto: 'Calculando su duración…', aparte: true };
  }
  if (base.some(b => b.ref === v.ref)) return null; // ya marcado: nada lo apaga
  if (enCaja.some(c => c.ref === v.ref)) return { codigo: 'en_caja', texto: 'En la caja', aparte: false };
  // lo que ya hay manda: el formato del primero que lo sepa (las subidas lo saben después del primer `cotizar`)
  const elegido = [...enCaja, ...base].find(f => f.formato !== null);
  if (elegido && v.formato && elegido.formato !== v.formato) {
    return {
      codigo: 'formato',
      texto: v.formato === 'vertical' ? 'Vertical · no se une con horizontales' : 'Horizontal · no se une con verticales',
      aparte: false,
    };
  }
  const ya = [...enCaja, ...base];
  if (sumar(ya) + v.duracion_s > lim.max_s) return { codigo: 'se_pasa', texto: `Se pasa de ${minutos(lim.max_s)} min`, aparte: false };
  if (ya.length >= lim.max_videos) return { codigo: 'maximo', texto: `Ya son ${lim.max_videos} videos · es el máximo`, aparte: false };
  if (v.bytes !== null && pesar(ya) + v.bytes > lim.max_bytes) {
    return { codigo: 'peso', texto: `Pesan demasiado juntos · máximo ${gigas(lim.max_bytes)} GB`, aparte: false };
  }
  return null;
}

/** ¿Lo que se va a editar es UN solo video de menos de 1 min? Solo no se edita: hace falta otro para unirlos. Uno de 60,0 s sí
 *  alcanza; uno cuya duración aún no se sabe no se juzga (el servidor lo dirá al cotizar). */
export function unicoCorto(lista: ReadonlyArray<{ duracion_s: number | null }>, lim: LimitesDeEdicion = LIMITES_DE_RESPALDO): boolean {
  const solo = lista.length === 1 ? lista[0] : undefined;
  return solo !== undefined && solo.duracion_s !== null && solo.duracion_s < lim.min_solo_s;
}

/** La etiqueta de texto de los de menos de 1 min (no solo color): se ven normales y se pueden marcar. */
export const soloParaUnir = (v: { duracion_s: number | null }, lim: LimitesDeEdicion = LIMITES_DE_RESPALDO): boolean =>
  v.duracion_s !== null && v.duracion_s < lim.min_solo_s;

/** El número de orden de un marcado: sigue la cuenta de la caja (con 3 en la caja, el primero marcado es el 4). */
export const ordenEnLaHoja = (enCaja: number, posicionEntreMarcados: number): number => enCaja + posicionEntreMarcados + 1;

/** El nombre accesible EXACTO de un video de la hoja: «{título}, {reloj}, {16:9}», y solo si aplica «, solo para unir»,
 *  «, elegido, número N» y «, no disponible: {motivo}». */
export function etiquetaDelVideo(e: {
  titulo: string;
  duracion_s: number | null;
  formato: FormatoVideo | null;
  soloUnir: boolean;
  orden: number;
  motivo: string;
}): string {
  const partes = [e.titulo, e.duracion_s === null ? '' : reloj(e.duracion_s), rotuloDeFormato(e.formato)].filter(Boolean);
  let texto = partes.join(', ');
  if (e.soloUnir) texto += ', solo para unir';
  if (e.orden > 0) texto += `, elegido, número ${e.orden}`;
  if (e.motivo) texto += `, no disponible: ${e.motivo}`;
  return texto;
}

// ---------------------------------------------------------------------------
// el pie y los botones de la hoja

export const ALERTA_UNICO_CORTO = 'Un video de menos de 1 min no se puede editar solo. Marca otro para unirlos.';
export const PIE_COMPUTADORA = 'Se sube de tu computadora y no cuesta créditos. Puedes subir varios.';
export const PIE_SIN_VIDEOS = 'Aquí aparecen los videos que hagas con IA.';
export const PIE_NADA_MARCADO = 'Elige uno o varios videos. Se unen en el orden en que los marques.';
export const NOTA_DE_COPIA_EN_LA_HOJA = 'Se edita una copia; tus originales no se tocan.';

const cuantos = (n: number) => `${n} ${n === 1 ? 'video' : 'videos'}`;

export interface EntradaCuenta {
  pestana: 'creaciones' | 'computadora';
  /** El servidor contestó con la lista vacía. */
  sinVideos: boolean;
  marcados: readonly FichaDeVideo[];
  enCaja: readonly FichaDeVideo[];
  lim?: LimitesDeEdicion;
}

/** Lo que dice el pie (`role="status"`) y, si hace falta, su línea de alerta: los seis textos de la hoja. */
export function cuentaDeLaHoja({ pestana, sinVideos, marcados, enCaja, lim = LIMITES_DE_RESPALDO }: EntradaCuenta): { texto: string; alerta: string | null } {
  if (pestana === 'computadora') return { texto: PIE_COMPUTADORA, alerta: null };
  if (sinVideos) return { texto: PIE_SIN_VIDEOS, alerta: null };
  if (!marcados.length) return { texto: PIE_NADA_MARCADO, alerta: null };
  // UN solo video de menos de 1 min (contando lo que ya hay en la caja) no se edita solo
  if (unicoCorto([...enCaja, ...marcados], lim)) {
    return { texto: `1 video · ${reloj(sumar(marcados))} en total.`, alerta: ALERTA_UNICO_CORTO };
  }
  let texto = `${cuantos(marcados.length)} · ${reloj(sumar(marcados))} en total · `;
  if (enCaja.length) {
    const todos = [...enCaja, ...marcados];
    texto += `Con los de la caja serán ${todos.length}${duracionCompleta(todos) ? ` (${reloj(sumar(todos))})` : ''}. `;
  }
  return { texto: texto + NOTA_DE_COPIA_EN_LA_HOJA, alerta: null };
}

/** El botón principal de la hoja: «Usar videos» (0), «Usar este video» (1), «Usar N videos» (2 o más). */
export const rotuloDeUsar = (marcados: number): string => (marcados === 0 ? 'Usar videos' : marcados === 1 ? 'Usar este video' : `Usar ${marcados} videos`);

/** «Usar» está apagado (aria-disabled) con nada marcado o con un solo video corto. */
export const usarApagado = (marcados: readonly FichaDeVideo[], enCaja: readonly FichaDeVideo[], lim: LimitesDeEdicion = LIMITES_DE_RESPALDO): boolean =>
  marcados.length === 0 || unicoCorto([...enCaja, ...marcados], lim);

// ---------------------------------------------------------------------------
// el menú del «+» (Editar): lo que apaga «Subir de tu computadora»

export const descripcionDeSubir = (lim: LimitesDeEdicion = LIMITES_DE_RESPALDO) =>
  `MP4, MOV o M4V, hasta ${minutos(lim.max_s)} minutos en total`;

/** Por qué «Subir de tu computadora» no cabe ahora (la caja ya está llena), o null. La orientación de un archivo no se conoce
 *  antes de subirlo: si no cuadra, lo dice `cotizar` después. */
export function bloqueoDeSubir(enCaja: readonly FichaDeVideo[], lim: LimitesDeEdicion = LIMITES_DE_RESPALDO): string | null {
  if (enCaja.length >= lim.max_videos) return `Ya tienes ${lim.max_videos} videos: es el máximo.`;
  if (duracionCompleta(enCaja) && sumar(enCaja) >= lim.max_s) return `Ya llegaste a ${minutos(lim.max_s)} minutos en total: no caben más videos.`;
  return null;
}

// ---------------------------------------------------------------------------
// la lista de la caja

/** Mueve el de la posición `i` un lugar (`d` = -1 sube, +1 baja). Fuera de rango, la misma lista. No modifica la que recibe. */
export function mover<T>(lista: readonly T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (i < 0 || i >= lista.length || j < 0 || j >= lista.length) return [...lista];
  const salida = [...lista];
  const [uno] = salida.splice(i, 1);
  salida.splice(j, 0, uno as T);
  return salida;
}

/** Sin el de la posición `i`. No modifica la que recibe. */
export const quitarDe = <T>(lista: readonly T[], i: number): T[] => lista.filter((_, j) => j !== i);

/** La referencia de un video subido desde la computadora: cada subida confirmada es un proyecto del editor. */
export const claveDeSubida = (proyecto: string): string => `proyecto:${proyecto}`;
