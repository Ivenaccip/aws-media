// El envío directo de la caja (R4b): lo que antes hacían /clip.html e
// /imagenes.html con el texto ya puesto. La caja sube las referencias, pide el
// clip o la imagen con el MODELO elegido y se queda en el inicio: lo que se
// está generando aparece en «Mis creaciones».
//
// El servidor es quien cobra y quien decide el precio: aquí solo viaja el id
// del modelo, nunca un número de créditos.
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

export async function pedirClip(texto: string, modelo: string, fotos: File[]): Promise<{ id: string }> {
  const imagenes = await Promise.all(fotos.map(subir));
  return pedir<{ id: string }>('/api/clip/generar', {
    // `puerta` es lo que el servidor anota en su registro de clics
    cuerpo: { texto, formato: 'horizontal', imagenes, modelo, puerta: 'caja' },
    // si la sesión vence a mitad, el texto no se pierde (docs/PLAN-UI.md §6)
    apartar: 'clip-generar',
  });
}

/** Crear: el estilo y el formato son los que traía la pantalla de imágenes (animado, cuadrada). */
export const pedirImagen = (texto: string, modelo: string) =>
  pedir<{ nombre: string; url: string }>('/api/imagenes', {
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
