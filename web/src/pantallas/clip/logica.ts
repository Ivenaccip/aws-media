// El clip de 8 segundos sin React: los tipos de /api/clip y lo que
// static/clip.html calculaba en línea. El precio SIEMPRE sale de
// /api/clip/config (que lo lee de tarifas.json en el server): aquí no se
// escribe ningún número de créditos.
import { pedir } from '../../nucleo/api';

export type Formato = 'horizontal' | 'vertical';

export interface Config {
  activo: boolean;
  creditos: number;
  creditos_con_composicion: number;
  max_imagenes: number;
  segundos: number;
  extensiones: string[];
  max_bytes: number;
}

export interface Clip {
  id: string;
  estado: 'generando' | 'listo' | 'error' | string;
  texto: string;
  formato?: Formato;
  imagenes: number;
  segundos: number;
  creditos: number;
  recorte?: string;
  video?: string;
  error?: string;
  /** ISO del servidor: cuándo empezó a generarse (UI·27, «Llevas 0:45»). */
  inicio?: string | null;
}

export interface Firma {
  url: string;
  key: string;
  content_type: string;
}

export const cargarConfig = () => pedir<Config>('/api/clip/config');
export const cargarClips = () => pedir<{ clips: Clip[] }>('/api/clip').then(r => r.clips ?? []);

export const firmar = (archivo: File, tipo: string) =>
  pedir<Firma>('/api/clip/presign', {
    cuerpo: { archivo: archivo.name, content_type: tipo, bytes: archivo.size },
  });

export const generar = (texto: string, formato: Formato, imagenes: string[]) =>
  pedir<{ lanzado: boolean; id: string; creditos: number }>('/api/clip/generar', {
    cuerpo: { texto, formato, imagenes },
    // si la sesión vence a mitad, el texto no se pierde (docs/PLAN-UI.md §6)
    apartar: 'clip-generar',
  });

/** El PUT directo a S3. Va fuera de pedir(): no es /api ni lleva token. */
export async function subirDirecto(firma: Firma, archivo: File): Promise<void> {
  const r = await fetch(firma.url, {
    method: 'PUT',
    body: archivo,
    headers: { 'Content-Type': firma.content_type },
  });
  if (!r.ok) throw new Error('No se pudo subir la foto — inténtalo otra vez.');
}

// Las fotos del iPhone llegan como .heic y MUCHOS navegadores mandan
// file.type vacío para ese formato: sin esto la firma se pediría con un tipo
// que luego no coincide con el del PUT, y S3 rechaza la subida con un 403 que
// no explica nada.
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

export function tipoDe(archivo: Pick<File, 'type' | 'name'>): string {
  if (archivo.type) return archivo.type;
  const punto = archivo.name.lastIndexOf('.');
  return (punto >= 0 && TIPOS[archivo.name.slice(punto).toLowerCase()]) || 'application/octet-stream';
}

/** Con dos fotos o más se juntan en una antes de animar, y eso se cobra. */
export function costo(cfg: Config, fotos: number): number {
  return fotos >= 2 ? cfg.creditos_con_composicion : cfg.creditos;
}

export function notaPrecio(cfg: Config, fotos: number): string {
  const cr = costo(cfg, fotos);
  return fotos >= 2
    ? `${cfg.creditos} créditos + ${cr - cfg.creditos} por juntar tus ${fotos} fotos en una`
    : `${cfg.creditos} créditos · ${cfg.segundos} segundos con sonido`;
}

export function detalleClip(c: Clip): string {
  const fotos = c.imagenes ? c.imagenes + (c.imagenes === 1 ? ' foto tuya' : ' fotos tuyas') : 'sin fotos';
  return `${c.segundos} s · ${fotos}`;
}

export const generando = (clips: Clip[]) => clips.filter(c => c.estado === 'generando');

/** Lee `?brief=` (lo manda la caja del inicio) y lo quita de la URL. */
export function tomarBrief(loc: Location = location, hist: History = history): string {
  const brief = new URLSearchParams(loc.search).get('brief');
  if (brief === null) return '';
  hist.replaceState(null, '', loc.pathname);
  return brief.slice(0, 2000);
}

// UI·27 — la espera de un clip: el servidor no cuenta fases (es UNA llamada a
// la IA), así que son pocos pasos y lo demás es el reloj.
export const PASOS_CLIP = [
  { falta: 'Recibir tu idea', hecho: 'Recibimos tu idea' },
  { falta: 'Generar el video', activo: 'Generando el video', hecho: 'Video generado' },
  { falta: 'Tu clip, listo para ver' },
];
/** Lo que suele tardar un clip: el tope de «1-2 min», para que la barra no corra de más. */
export const ESTIMADO_CLIP_MS = 120_000;
