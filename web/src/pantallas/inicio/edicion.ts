// «Edición» en la caja del inicio (E1), la parte que no es React: los textos exactos, las
// ideas de un toque y la regla que decide qué dice el botón principal en cada momento.
//
// E1 es: UN video subido + lo que la persona quiere + la IA propone los cortes, y se abre
// el editor de siempre. Unir videos, copiar una creación, fundidos, música y Marcas son
// piezas posteriores: aquí no hay nada de eso a medias.
//
// El precio NO se calcula aquí: sale de GET /api/editar/<p>/costo (el servidor mide la
// duración con ffprobe y sabe si ya hay transcripción). Esta pantalla solo lo enseña.
import { nombreDesde } from '../../nucleo/subida';
import type { CostoEdicion } from './envio';

/** El nombre del campo, para el lector de pantalla (el h2 de la caja sigue diciendo «¿Qué vamos a crear hoy?»). */
export const ETIQUETA_TEXTO = 'Cuéntale a la IA qué quieres';

export const HUECO_TEXTO =
  'Cuéntale a la IA qué quieres: formato, duración, estilo… Por ejemplo: quítale las muletillas, ponle subtítulos y hazlo vertical para Reels.';

/** Los atajos de un toque: ponen ese texto en el campo y le dan el foco. */
export const IDEAS_EDICION = [
  'Quita muletillas y silencios',
  'Un short vertical para Reels',
  'Resumen de 60 segundos',
  'Subtítulos grandes y un título',
] as const;

/** Es verdad: el archivo subido jamás se modifica, los cortes son versiones aparte. */
export const NOTA_COPIA = 'Se edita una copia. Tu original se queda como está.';

export const AVISO_SIN_VIDEO = 'Primero agrega el video: pulsa el «+» o arrástralo a la caja.';
export const AVISO_OCUPADO = 'Ya hay un trabajo en curso. Cuando termine puedes empezar otro.';

export const AYUDA_TEXTO = 'Escribe qué quieres hacer con tu video, o toca una idea.';
export const AYUDA_VIDEO = 'Agrega el video con el «+» o arrástralo a la caja.';
export const NOTA_SUBIENDO = 'Cuando termine de subir calculamos el precio. Hasta entonces no se cobra nada.';
export const NOTA_CALCULANDO = 'Estamos calculando el precio. Hasta entonces no se cobra nada.';
export const NOTA_SIN_PRECIO = 'No pudimos calcular el precio. Toca «Editar» para intentarlo otra vez.';
/** Cuando el servidor no manda su propio aviso pero tampoco deja editar. */
export const AVISO_NO_SE_PUEDE = 'Por ahora no podemos editar este video.';

/**
 * Lo que de verdad le llega a la IA: el texto como lo deja el servidor (server/editar_api.py: limpiar_instruccion). Sin
 * caracteres de control ni invisibles (ancho cero, marcas bidi, las «etiquetas» que esconden texto), con los saltos de
 * línea y sin espacios en los extremos. Un campo con SOLO eso («\u200b») parece lleno pero no dice nada: el servidor
 * lo vaciaría y la corrida saldría sin instrucción, cobrada. Por eso el botón se decide con esto y no con `trim()`.
 */
export function limpiarInstruccion(texto: string): string {
  return texto
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\v\f]/g, ' ')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/(?!\n)[\p{Cc}\p{Cf}\p{Cs}]/gu, '')
    .trim();
}

/**
 * El nombre del proyecto en el servidor, a partir del archivo. `nombreDesde` ya lo deja en [A-Za-z0-9_-], pero el servidor
 * exige además al menos una letra o cifra (`_.mp4` daría «_» y un 422 «nombre de proyecto inválido» sobre algo que la
 * persona nunca tecleó): en ese caso, el nombre de siempre.
 */
export function nombreDeProyecto(archivo: string): string {
  const nombre = nombreDesde(archivo);
  return /[A-Za-z0-9]/.test(nombre) ? nombre : 'mi-video';
}

/** Segundos como se lee un reloj: «12:04», «1:18:00». (nucleo/formato.duracion da «12 min 4 s».) */
export function reloj(segundos: number): string {
  if (!Number.isFinite(segundos)) return '';
  const s = Math.max(0, Math.round(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const dos = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${dos(m)}:${dos(r)}` : `${m}:${dos(r)}`;
}

/** Lo que pesa el archivo, como lo diría una persona: «824 MB», «1.4 GB». */
export function tamano(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  return Math.max(1, Math.round(bytes / 1e6)) + ' MB';
}

/** El video de la caja, de la subida a tener precio. */
export type FaseVideo =
  /** Firmando, subiendo o confirmando: aún no existe el proyecto completo en el servidor. */
  | 'subiendo'
  /** Ya subió: se le pregunta al servidor cuánto dura y cuánto cuesta. */
  | 'calculando'
  | 'listo'
  /** El precio no llegó (red caída…): tocar «Editar» lo vuelve a pedir. */
  | 'sin_precio';

/** Qué muestra y qué hace el botón principal. UN botón, siempre el mismo elemento: aquí solo cambia lo que dice. */
export type EstadoBoton =
  /** Sin video: «Editar» sin precio. */
  | { tipo: 'sin_video' }
  | { tipo: 'subiendo' }
  | { tipo: 'calculando' }
  | { tipo: 'sin_precio' }
  /** El servidor puso un aviso (fuera de 1–90 min, falta la transcripción en nube…): sin precio, y el foco va al «+». */
  | { tipo: 'fuera'; aviso: string }
  /** Con video y precio, pero sin texto: apagado, y el foco va al campo. */
  | { tipo: 'sin_texto'; creditos: number }
  | { tipo: 'sin_saldo'; creditos: number; faltan: number }
  | { tipo: 'listo'; creditos: number };

export interface EntradaBoton {
  video: { fase: FaseVideo; costo: CostoEdicion | null } | null;
  /** Hay algo escrito (sin contar espacios). */
  hayTexto: boolean;
  /** El saldo que conoce monedero.js; null = aún no se sabe y nadie se bloquea por él. */
  saldo: number | null;
}

/**
 * En este orden: sin video, subiendo, calculando, sin precio, aviso del servidor, sin texto, sin saldo, listo. El
 * orden importa: un video fuera de rango no se enciende aunque haya texto, y sin texto no se pide el saldo.
 */
export function estadoDelBoton({ video, hayTexto, saldo }: EntradaBoton): EstadoBoton {
  if (!video) return { tipo: 'sin_video' };
  if (video.fase === 'subiendo') return { tipo: 'subiendo' };
  if (video.fase === 'calculando') return { tipo: 'calculando' };
  const costo = video.costo;
  if (video.fase === 'sin_precio' || !costo) return { tipo: 'sin_precio' };
  if (costo.aviso || !costo.backend_listo) return { tipo: 'fuera', aviso: costo.aviso || AVISO_NO_SE_PUEDE };
  // un precio que no es un entero (null, texto, NaN…) no se enseña ni se deja cobrar: «Editar ✦ 0» o «✦ NaN» mentiría
  // sobre dinero. Es como si el precio no hubiera llegado: tocar «Editar» lo vuelve a pedir
  if (!Number.isInteger(costo.creditos) || costo.creditos < 0) return { tipo: 'sin_precio' };
  if (!hayTexto) return { tipo: 'sin_texto', creditos: costo.creditos };
  if (saldo !== null && saldo < costo.creditos) {
    return { tipo: 'sin_saldo', creditos: costo.creditos, faltan: costo.creditos - saldo };
  }
  return { tipo: 'listo', creditos: costo.creditos };
}

/**
 * Cuánto le falta cuando el servidor dijo 402. El detalle trae «…cuesta 8 créditos y tu saldo es 5.»; si no se puede
 * leer (otro texto), se usa el saldo que ya se conocía y, sin él, el precio entero. Nunca menos de 1.
 */
export function faltanTras402(detalle: unknown, creditos: number, saldo: number | null): number {
  const m = typeof detalle === 'string' ? /cuesta (\d+)\D+saldo es (\d+)/i.exec(detalle) : null;
  const cuesta = m ? Number(m[1]) : creditos;
  const tiene = m ? Number(m[2]) : (saldo ?? 0);
  return Math.max(1, cuesta - tiene);
}
