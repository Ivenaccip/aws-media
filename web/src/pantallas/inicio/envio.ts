// El envío directo de la caja (R4b): lo que antes hacían /clip.html e
// /imagenes.html con el texto ya puesto. La caja sube las referencias, pide el
// clip o la imagen con el MODELO elegido y se queda en el inicio: lo que se
// está generando aparece en «Mis creaciones».
//
// El servidor es quien cobra y quien decide el precio: aquí solo viajan el id
// del modelo y los segundos del clip, nunca un número de créditos.
//
// E1 suma al final lo de la caja de «Edición»: qué videos sirven, y las tres
// peticiones de /api/editar (precio, lanzar, estado). Igual: sin créditos en el cuerpo.
import { ErrorApi, pedir } from '../../nucleo/api';

/** Las extensiones que acepta el clip (server/clip_api.py) y cuántas fotos. */
export const MAX_FOTOS_CLIP = 3;
export const MAX_BYTES_CLIP = 20 * 1024 * 1024;
/** El editor de imágenes: una sola imagen, estas extensiones, 15 MB. */
export const EXTS_EDITAR = ['.jpg', '.jpeg', '.png', '.webp'];
export const MAX_BYTES_EDITAR = 15 * 1024 * 1024;
const EXTS_CLIP = [...EXTS_EDITAR, '.gif', '.avif', '.heic', '.heif'];

// Las fotos del iPhone llegan como .heic y muchos navegadores mandan file.type
// vacío: sin esto la firma se pediría con un tipo que luego no coincide con el
// del PUT, y S3 rechaza la subida con un 403 que no explica nada.
const TIPOS: Record<string, string> = {
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
};

const extension = (nombre: string) => {
  const punto = nombre.lastIndexOf('.');
  return punto >= 0 ? nombre.slice(punto).toLowerCase() : '';
};

export const tipoDe = (f: Pick<File, 'type' | 'name'>) => f.type || TIPOS[extension(f.name)] || 'application/octet-stream';

/** ¿Sirve este archivo como referencia de esta tarea? Devuelve el motivo si no. */
export function rechazo(f: File, tarea: 'clip' | 'editar'): string {
  const exts = tarea === 'clip' ? EXTS_CLIP : EXTS_EDITAR;
  if (!exts.includes(extension(f.name)))
    return `«${f.name}» no se puede usar. Sirven: ${exts.join(', ')}.`;
  const tope = tarea === 'clip' ? MAX_BYTES_CLIP : MAX_BYTES_EDITAR;
  if (f.size > tope) return `«${f.name}» pesa demasiado (máximo ${tope / 1024 / 1024} MB).`;
  return '';
}

/** De lo que se suelta o se pega, lo que es imagen (un .heic puede venir sin tipo). */
export const soloImagenes = (archivos: File[]): File[] =>
  archivos.filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));

/** Los videos que acepta «Edición»: los mismos que /api/media/presign (server/media_api.py: EXTS y MAX_BYTES). */
export const EXTS_VIDEO = ['.mp4', '.mov', '.m4v'];
export const MAX_BYTES_VIDEO = 5 * 1024 ** 3;
/** Lo que el menú, la pista del «+» y los avisos dicen que sirve. */
export const DESCRIPCION_VIDEOS = 'MP4, MOV o M4V · hasta 5 GB';

/** ¿Sirve este archivo como video a editar? Devuelve el motivo si no. */
export function rechazoVideo(f: File): string {
  if (!EXTS_VIDEO.includes(extension(f.name)))
    return `«${f.name}» no se puede usar. Sirven: ${EXTS_VIDEO.join(', ')}.`;
  // «.mp4» (o «..mp4») a secas: el servidor (os.path.splitext) lo lee como un archivo SIN extensión y contesta un 422
  // que no explica nada
  if (!/[^.]/.test(f.name.slice(0, f.name.lastIndexOf('.'))))
    return `«${f.name}» no tiene nombre, solo la extensión. Ponle un nombre y vuelve a intentar.`;
  // un archivo vacío subiría "bien" y el precio nunca llegaría (no hay nada que medir)
  if (f.size === 0) return `«${f.name}» está vacío.`;
  if (f.size > MAX_BYTES_VIDEO) return `«${f.name}» pesa demasiado (máximo ${MAX_BYTES_VIDEO / 1024 ** 3} GB).`;
  return '';
}

/** De lo que se suelta, lo que es video (un .mov puede venir sin tipo). */
export const soloVideos = (archivos: File[]): File[] =>
  archivos.filter(f => f.type.startsWith('video/') || EXTS_VIDEO.includes(extension(f.name)));

/** Qué archivos sirven para esa tarea, en una frase para el menú del «+»: «JPG, PNG o WebP · hasta 15 MB». */
export const descripcionDeArchivos = (tarea: 'clip' | 'editar'): string =>
  tarea === 'clip'
    ? `JPG, PNG, WebP, GIF, AVIF o HEIC · hasta ${MAX_BYTES_CLIP / 1024 / 1024} MB`
    : `JPG, PNG o WebP · hasta ${MAX_BYTES_EDITAR / 1024 / 1024} MB`;

/** Una imagen de «Mis creaciones» como archivo, para usarla de referencia: se trae del servidor y se envuelve.
 *  Los bytes se piden a NUESTRO endpoint (`/archivo`) y no a `im.url`: en la nube esa URL redirige al CDN, que no manda
 *  cabeceras CORS, y el `fetch` fallaría con toda imagen (la miniatura sí carga: es un <img>, no un fetch). */
export async function traerImagen(im: { nombre: string }, signal?: AbortSignal): Promise<File> {
  const r = await fetch('/api/imagenes/' + encodeURIComponent(im.nombre) + '/archivo', signal ? { signal } : {});
  if (!r.ok) throw new Error('no se pudo traer');
  const blob = await r.blob();
  return new File([blob], im.nombre, { type: blob.type || 'image/jpeg' });
}

// La extensión que corresponde a cada tipo de imagen: una captura pegada llega como «image.png» o sin nombre.
const EXTENSION_DE_TIPO: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/heic': '.heic',
  'image/heif': '.heif',
};

/** El nombre con que se enseña y se valida una imagen pegada: el suyo si es un archivo de verdad (copiado del
 *  explorador), y si es una captura («image.png», o sin nombre) uno que dice qué es. */
function nombrePegada(f: File, posicion: number, total: number): string {
  const generico = !f.name || /^image\.[a-z0-9]+$/i.test(f.name);
  if (!generico) return f.name;
  const ext = EXTENSION_DE_TIPO[f.type] || extension(f.name) || '.png';
  return `imagen-pegada${total > 1 ? '-' + posicion : ''}${ext}`;
}

const normal = (s: string) => s.normalize('NFC').toLowerCase();
const sinExtension = (s: string) => s.replace(/\.[^./\\]+$/, '');

/** ¿Todo ese texto son nombres de los archivos que vienen en el portapapeles? El Finder de macOS (con Chrome, Edge o
 *  Brave) pone el NOMBRE del archivo —o su ruta, o su file:///— como texto junto al archivo: es el mismo pegado, no
 *  letras que alguien copió. Se compara sin mayúsculas, con o sin extensión y normalizando los acentos (macOS guarda
 *  el nombre del archivo descompuesto y el texto compuesto). */
function esNombreDeArchivo(texto: string, archivos: File[]): boolean {
  const nombres = new Set(archivos.flatMap(f => [normal(f.name), normal(sinExtension(f.name))]));
  const lineas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return (
    lineas.length > 0 &&
    lineas.every(linea => {
      let ultimo = linea.split(/[\\/]/).filter(Boolean).pop() ?? '';
      try {
        if (/^file:\/\//i.test(linea)) ultimo = decodeURIComponent(ultimo);
      } catch {
        return false; // un % suelto: no es una dirección de archivo
      }
      return nombres.has(normal(ultimo));
    })
  );
}

/**
 * Las imágenes que trae un pegado (Ctrl+V): un archivo copiado del explorador o una captura. Si el pegado trae
 * TEXTO no se toca (Word o Excel mandan las letras y además una foto de ellas: ganan las letras), salvo que ese texto
 * sea solo el nombre de los mismos archivos (el Finder de macOS). Lo que no sea imagen se deja pasar. Devuelve `[]`
 * cuando no hay nada que agregar.
 */
export function imagenesPegadas(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  const archivos = Array.from(dt.files ?? []);
  // algunos navegadores solo las traen como elementos del portapapeles
  if (!archivos.length) {
    for (const el of Array.from(dt.items ?? [])) {
      const f = el.kind === 'file' ? el.getAsFile() : null;
      if (f) archivos.push(f);
    }
  }
  const imagenes = archivos.filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
  if (!imagenes.length) return [];
  const texto = dt.getData('text/plain').trim();
  if (texto && !esNombreDeArchivo(texto, archivos)) return [];
  return imagenes.map((f, i) => {
    const nombre = nombrePegada(f, i + 1, imagenes.length);
    return nombre === f.name ? f : new File([f], nombre, { type: f.type });
  });
}

interface Firma {
  url: string;
  key: string;
  content_type: string;
}

/** Sube DIRECTO a S3 (tres fotos de teléfono pasan del límite de API Gateway). */
async function subir(f: File): Promise<string> {
  const firma = await pedir<Firma>('/api/clip/presign', {
    cuerpo: { archivo: f.name, content_type: tipoDe(f), bytes: f.size },
  });
  // fuera de pedir(): no es /api ni lleva token
  const r = await fetch(firma.url, { method: 'PUT', body: f, headers: { 'Content-Type': firma.content_type } });
  if (!r.ok) throw new Error('No se pudo subir la foto — inténtalo otra vez.');
  return firma.key;
}

/**
 * `segundos` es la duración del clip (4, 6 u 8): el servidor la busca en su tarifa y rechaza la que el modelo no tiene.
 * `audio` es si lleva sonido (por defecto sí): `false` solo vale en los modelos que se pueden apagar, con su propio precio
 * en el servidor; en cualquier otro el servidor lo rechaza, así que la caja manda `true` si el modelo no se puede apagar.
 */
export async function pedirClip(texto: string, modelo: string, fotos: File[], segundos: number, audio = true): Promise<{ id: string }> {
  const imagenes = await Promise.all(fotos.map(subir));
  return pedir<{ id: string }>('/api/clip/generar', {
    // `puerta` es lo que el servidor anota en su registro de clics
    cuerpo: { texto, formato: 'horizontal', imagenes, modelo, segundos, audio, puerta: 'caja' },
    // si la sesión vence a mitad, el texto no se pierde (docs/PLAN-UI.md §6)
    apartar: 'clip-generar',
  });
}

/** Lo que contesta crear una imagen: la de siempre (`nombre` y `url`, los modelos rápidos) o `lanzado`
 *  (los que tardan: el servidor ya cobró y la hace en segundo plano; aparece en «Mis creaciones»). */
export type RespuestaImagen = { nombre: string; url: string } | { lanzado: true; id: string; creditos: number };

/** ¿El servidor dejó la imagen en marcha? Solo entonces no hay imagen todavía y la lista de «Mis creaciones» es la única que la trae. */
export const esLanzada = (r: unknown): boolean => typeof r === 'object' && r !== null && 'lanzado' in r && r.lanzado === true;

/** Crear: el estilo y el formato son los que traía la pantalla de imágenes (animado, cuadrada). */
export const pedirImagen = (texto: string, modelo: string) =>
  pedir<RespuestaImagen>('/api/imagenes', {
    cuerpo: { prompt: texto, estilo: 'animated', estilo_custom: '', modelo },
  });

/** Editar: «transformar toda la imagen» (el modo sin zona pintada). */
export async function pedirEdicion(texto: string, modelo: string, foto: File): Promise<{ nombre: string; url: string }> {
  const fd = new FormData();
  fd.append('prompt', texto);
  fd.append('modo', 'todo');
  fd.append('modelo', modelo);
  fd.append('imagen', foto, foto.name);
  const r = await fetch('/api/imagenes/editar', { method: 'POST', body: fd, headers: { Accept: 'application/json' } });
  const tipo = r.headers.get('Content-Type') ?? '';
  const datos: unknown = tipo.includes('application/json') ? await r.json() : await r.text();
  if (!r.ok) {
    const det = datos && typeof datos === 'object' && 'detail' in datos ? (datos as { detail: unknown }).detail : datos;
    const msg = typeof det === 'string' && det.trim() ? det : 'Algo salió mal (HTTP ' + r.status + ').';
    throw new ErrorApi(r.status, msg, det);
  }
  return datos as { nombre: string; url: string };
}

// ---------------------------------------------------------------------------
// «Edición» (E1): las tres peticiones de /api/editar. El proyecto ya existe en el servidor
// (lo creó la subida); ni el precio ni el cobro se calculan aquí.

/** Lo que contesta GET /api/editar/<p>/costo. Si viene `aviso` (el video no está en el rango de 1 a 90 min, falta la
 *  transcripción en la nube…) `backend_listo` es false y el aviso se enseña tal cual. */
export interface CostoEdicion {
  fuente: string;
  duracion_s: number;
  con_transcript: boolean;
  creditos: number;
  backend_listo: boolean;
  aviso: string | null;
}

/** Lo que la caja necesita del estado de una corrida: GET /api/editar/<p>. */
export interface EstadoCorrida {
  editar: { estado?: 'corriendo' | 'listo' | 'error' | string } | null;
}

const rutaEditar = (proyecto: string) => '/api/editar/' + encodeURIComponent(proyecto);

/** El precio ANTES del botón: el servidor lo calcula (duración medida con ffprobe y si ya hay transcripción). */
export const pedirCostoEdicion = (proyecto: string) => pedir<CostoEdicion>(rutaEditar(proyecto) + '/costo');

/** Lo que cobra y lanza: el servidor decide el precio, cobra antes de lanzar y devuelve si no pudo lanzar. SOLO viaja
 *  la instrucción (entrada de la persona): nunca un número de créditos. */
export const lanzarEdicion = (proyecto: string, instruccion: string) =>
  pedir<{ lanzado: boolean; creditos: number }>(rutaEditar(proyecto) + '/sugerir', { cuerpo: { instruccion } });

/** ¿Sigue corriendo? Solo se pregunta después de lanzar: nunca al montar la pantalla. */
export const pedirEstadoEdicion = (proyecto: string) => pedir<EstadoCorrida>(rutaEditar(proyecto));

/**
 * ¿Este nombre ya es un proyecto TUYO con un video subido? (GET /api/media/<p>: vacío si no existe o es de otra cuenta.)
 * Se pregunta antes de subir porque el servidor deja reusar un nombre propio, y ahí el video nuevo quedaría junto a la
 * transcripción y los cortes del viejo: el precio saldría más barato (ya hay transcripción) y la corrida editaría sobre
 * tiempos que no son de este video. Si la respuesta no llega, se sigue con el nombre: preguntar no puede frenar la subida.
 */
export async function nombreYaTieneVideo(proyecto: string): Promise<boolean> {
  try {
    const r = await pedir<{ subidas?: unknown }>('/api/media/' + encodeURIComponent(proyecto));
    return Array.isArray(r?.subidas) && r.subidas.length > 0;
  } catch {
    return false;
  }
}
