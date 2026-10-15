// «Edición» en la caja del inicio (E1), la parte que no es React: los textos exactos, las
// ideas que rotan como pista del campo y la regla que decide qué dice el botón principal en cada momento.
//
// E1 es: UN video subido + lo que la persona quiere + la IA propone los cortes, y se abre
// el editor de siempre. Unir videos, copiar una creación, fundidos, música y Marcas son
// piezas posteriores: aquí no hay nada de eso a medias.
//
// El precio NO se calcula aquí: sale de GET /api/editar/<p>/costo (el servidor mide la
// duración con ffprobe y sabe si ya hay transcripción). Esta pantalla solo lo enseña.
import { nombreDesde } from '../../nucleo/subida';
import { conLiga, conP, esLigaDeYoutube, RUTA_SHORTS } from '../shorts/logica';
import type { CostoEdicion } from './envio';

/** El nombre del campo, para el lector de pantalla (el h2 de la caja sigue diciendo «¿Qué vamos a crear hoy?»). */
export const ETIQUETA_TEXTO = 'Cuéntale a la IA qué quieres';

/**
 * La pista del campo vacío (su `placeholder`): una idea de turno de IDEAS_EDICION, que va rotando (usePistaRotatoria). La
 * frase es la misma con las cuatro y sin punto final: unas ideas son verbos («Quita muletillas y silencios») y otras
 * nombres («Resumen de 60 segundos»), y con «Ejemplo: «…»» leen igual de natural todas.
 */
export function huecoDe(idea: string): string {
  return `Cuéntale a la IA qué quieres. Ejemplo: «${idea}»`;
}

/**
 * El ejemplo que NO rota, para quien usa lector de pantalla: la pista que cambia sola no es el nombre del campo ni se
 * anuncia (a propósito: nada de aria-live), así que el campo lo lleva como descripción, escondido a la vista porque lo que
 * se ve ya es la pista rotando. Es el ejemplo que traía el campo antes de que las ideas fueran botones.
 */
export const EJEMPLO_FIJO = 'Por ejemplo: quítale las muletillas, ponle subtítulos y hazlo vertical para Reels.';

/**
 * Lo que se puede hacer con el video, el chip «Editar ▾» junto al «+» (como «Un video corto ▾» en Video): editar el
 * metraje con la IA, o sacarle shorts a un video largo. El botón principal («Iniciar») es el mismo para las dos: lo que
 * cambia es el cuerpo de la caja y a dónde lleva el botón.
 */
export type IdModo = 'editar' | 'shorts';

export interface ModoEdicion {
  id: IdModo;
  rotulo: string;
  nota: string;
  /** Lo que va a la derecha de su fila en la lista: el precio de esta tarea sale del video, no de una tarifa fija. */
  detalle: string;
}

export const MODOS_EDICION: readonly [ModoEdicion, ...ModoEdicion[]] = [
  {
    id: 'editar',
    rotulo: 'Editar',
    nota: 'Sube tu metraje y la IA te propone el corte. Se edita una copia: tu original se queda como está.',
    detalle: 'según el video',
  },
  {
    id: 'shorts',
    rotulo: 'De videos a Shorts',
    nota: 'Sube un video largo y te daremos los mejores momentos.',
    detalle: 'según el video',
  },
];

/** El modo con ese id (si no existe, el primero: Editar). */
export const modoDe = (id: IdModo): ModoEdicion => MODOS_EDICION.find(m => m.id === id) ?? MODOS_EDICION[0];

/**
 * Las ideas que rotan solas como pista dentro del campo (dueño, 14-oct-2026: «Rotan solas como pista»). Antes eran cuatro
 * botones debajo del campo que ponían su texto; ahora son solo una pista, una a la vez, y desaparecen al escribir como
 * cualquier texto de pista. La primera es SIEMPRE la que se ve al abrir.
 */
export const IDEAS_EDICION = [
  'Quita muletillas y silencios',
  'Un short vertical para Reels',
  'Resumen de 60 segundos',
  'Subtítulos grandes y un título',
] as const;

/**
 * Cada cuánto cambia la idea: del momento en que una empieza a salir al momento en que empieza a salir la siguiente. Cuatro
 * segundos son los que hacen falta para leer una frase de cuatro a seis palabras sin que se sienta lenta, y a quien va a
 * escribir se le deja la pista quieta de todos modos (con el foco, con texto, con la pestaña oculta).
 */
export const PISTA_CADA_MS = 4000;

/**
 * Lo que dura cada fundido (salida y entrada). Es el `--dur-media` de tokens.css («algo que entra, sale o cambia de lugar»,
 * docs/DISENO.md §4): el reloj necesita el número, y Edicion.test.tsx vigila que siga siendo el del token.
 */
export const PISTA_FUNDIDO_MS = 250;

/** Es verdad: el archivo subido jamás se modifica, los cortes son versiones aparte. */
export const NOTA_COPIA = 'Se edita una copia. Tu original se queda como está.';

export const AVISO_SIN_VIDEO = 'Primero agrega el video: pulsa el «+» o arrástralo a la caja.';
export const AVISO_OCUPADO = 'Ya hay un trabajo en curso. Cuando termine puedes empezar otro.';

export const AYUDA_TEXTO = 'Escribe qué quieres hacer con tu video.';
export const AYUDA_VIDEO = 'Agrega el video con el «+» o arrástralo a la caja.';
export const NOTA_SUBIENDO = 'Cuando termine de subir calculamos el precio. Hasta entonces no se cobra nada.';
export const NOTA_CALCULANDO = 'Estamos calculando el precio. Hasta entonces no se cobra nada.';
export const NOTA_SIN_PRECIO = 'No pudimos calcular el precio. Toca «Iniciar» para intentarlo otra vez.';
/** Cuando el servidor no manda su propio aviso pero tampoco deja editar. */
export const AVISO_NO_SE_PUEDE = 'Por ahora no podemos editar este video.';

// «De videos a Shorts» (el segundo modo del chip). Aquí no se cobra nada ni se calcula ningún precio: «Iniciar» lleva a la
// pantalla de Shorts (/estudio/shorts/), que es la que muestra cada precio y cobra con su propio botón. La caja solo junta
// la fuente (una liga de YouTube o un video subido) y se la entrega a esa pantalla.

/** El nombre del campo de la liga, para el lector de pantalla y para el rótulo que no se ve. */
export const ETIQUETA_LIGA = 'Liga de YouTube';
export const HUECO_LIGA = 'Pega la liga de YouTube';
export const APOYO_SHORTS = 'Sube un video largo o pega la liga de YouTube y te proponemos los mejores momentos como shorts.';
export const AVISO_SIN_FUENTE = 'Primero pega la liga de YouTube o agrega el video con el «+».';
/** Sin nada a donde ir (la caja vacía, el video subiendo o una liga que no es de YouTube): lo único que se puede prometer es que subir es gratis. */
export const NOTA_SHORTS_VACIA = 'Subirlo no cuesta nada: el precio aparece cuando termina de subir.';
/** Con una fuente que sirve: «Iniciar» no cobra, y quien lo pulsa tiene que saber que cambia de pantalla. */
export const NOTA_SHORTS_SIGUE = 'Te llevamos a Shorts: ahí ves el precio antes de que se cobre algo.';

/** Qué muestra y qué hace el botón principal en Shorts. Es el mismo botón que en Editar: aquí solo cambia lo que dice. */
export type EstadoBotonShorts =
  /** Ni liga ni video: «Iniciar» sigue ámbar y explica qué falta. */
  | { tipo: 'sin_fuente' }
  /** El video aún sube: ocupado, y el clic avisa que hay un trabajo en curso. */
  | { tipo: 'subiendo' }
  /** Hay una liga o un video ya subido: «Iniciar» navega. */
  | { tipo: 'listo' };

/**
 * Con un video en la caja manda él (es lo que se ve: su tarjeta), y la liga que hubiera se queda escrita pero no cuenta.
 * La liga solo se mira sin espacios: no se decide aquí si es de YouTube (eso lo dice «Iniciar», junto al campo).
 */
export function estadoDeShorts({ video, liga }: { video: { fase: FaseVideo } | null; liga: string }): EstadoBotonShorts {
  if (video) return video.fase === 'subiendo' ? { tipo: 'subiendo' } : { tipo: 'listo' };
  return liga.trim() ? { tipo: 'listo' } : { tipo: 'sin_fuente' };
}

/**
 * La nota de debajo de la caja de Shorts. «Te llevamos a Shorts» es una promesa y solo se cumple si «Iniciar» navega: con un video
 * subido (manda él) o con una liga que de verdad es de YouTube. Una liga que no lo es (la que aún se escribe, o la que «Iniciar» acaba
 * de rechazar junto al campo) no lleva a ningún lado, y ahí la nota no puede decir lo contrario de lo que el campo dice.
 */
export function notaDeShorts({ video, liga }: { video: { fase: FaseVideo } | null; liga: string }): string {
  const navega = estadoDeShorts({ video, liga }).tipo === 'listo' && (video !== null || esLigaDeYoutube(liga.trim()));
  return navega ? NOTA_SHORTS_SIGUE : NOTA_SHORTS_VACIA;
}

/**
 * A dónde lleva «Iniciar» en Shorts: el video ya subido abre su proyecto (`?p=`) y una liga queda puesta en «Importar de
 * YouTube» (`?url=`), sin importar ni cobrar. Lo que se ponga en la URL lo lee la pantalla de Shorts (shorts/logica.ts).
 */
export function destinoShorts(fuente: { proyecto: string } | { liga: string }): string {
  return RUTA_SHORTS + ('proyecto' in fuente ? conP(fuente.proyecto) : conLiga(fuente.liga));
}

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
  /** El precio no llegó (red caída…): tocar «Iniciar» lo vuelve a pedir. */
  | 'sin_precio';

/** Qué muestra y qué hace el botón principal. UN botón, siempre el mismo elemento: aquí solo cambia lo que dice. */
export type EstadoBoton =
  /** Sin video: «Iniciar» sin precio. */
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
  // un precio que no es un entero (null, texto, NaN…) no se enseña ni se deja cobrar: «Iniciar ✦ 0» o «✦ NaN» mentiría
  // sobre dinero. Es como si el precio no hubiera llegado: tocar «Iniciar» lo vuelve a pedir
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
