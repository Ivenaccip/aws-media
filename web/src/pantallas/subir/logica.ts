// Editar metraje sin React: los tipos de /api/media y /api/editar y lo que
// static/e1.html calculaba en línea. El precio del Editor IA SIEMPRE sale de
// /api/editar/<p>/costo (tarifas.json §editar en el server): aquí no se
// escribe ningún número de créditos.
import { pedir } from '../../nucleo/api';

export interface ConfigMedia {
  activo: boolean;
  /** Base de CloudFront para el video de muestra. */
  cdn: string;
}

export interface Corrida {
  estado?: 'corriendo' | 'listo' | 'error' | string;
  cortes?: number;
  fluff?: number;
  flags?: number;
  devueltos?: number;
  error?: string;
}

export interface EstadoEditar {
  editar: Corrida | null;
  fuente: string | null;
  editor_listo: boolean;
}

export interface Costo {
  fuente: string;
  duracion_s: number;
  con_transcript: boolean;
  creditos: number;
  backend_listo: boolean;
  aviso: string | null;
}

export interface Firma {
  url: string;
  key: string;
  content_type: string;
}

export interface Subida {
  archivo: string;
  cdn: string;
}

const ruta = (p: string) => '/api/editar/' + encodeURIComponent(p);

export const cargarConfig = () =>
  pedir<ConfigMedia>('/api/media/config').then(c => ({ activo: Boolean(c.activo), cdn: (c.cdn || '').replace(/\/$/, '') }));
export const cargarEstado = (p: string) => pedir<EstadoEditar>(ruta(p));
export const cargarCosto = (p: string) => pedir<Costo>(ruta(p) + '/costo');
export const sugerir = (p: string) => pedir<{ lanzado: boolean; creditos: number }>(ruta(p) + '/sugerir', { metodo: 'POST' });

export const firmar = (proyecto: string, archivo: File) =>
  pedir<Firma>('/api/media/presign', {
    cuerpo: { proyecto, archivo: archivo.name, content_type: archivo.type || 'video/mp4', bytes: archivo.size },
  });

export const confirmar = (proyecto: string, key: string) =>
  pedir<Subida>('/api/media/confirmar', { cuerpo: { proyecto, key } });

export const corriendo = (st: EstadoEditar | null) => st?.editar?.estado === 'corriendo';

/** La misma regla que el backend (_validar_nombre): el 422 llega ANTES de subir. */
export function nombreValido(nombre: string): boolean {
  return nombre.length > 0 && [...nombre].every(c => /[\p{L}\p{N}_-]/u.test(c));
}

// El nombre es único entre TODAS las cuentas: el video vive en la nube bajo
// ese nombre. Si otra ya lo usa (409), el campo se queda con una variante
// casi seguro libre y basta con volver a pulsar Subir.
export function nombreAlterno(nombre: string, azar: () => number = () => crypto.getRandomValues(new Uint16Array(1))[0]!): string {
  return `${nombre.slice(0, 35)}-${azar().toString(16).padStart(4, '0')}`;
}

export const mb = (bytes: number) => (bytes / 1e6).toFixed(1);

export interface Avance {
  pct: number;
  cargados: number;
  total: number;
}

/**
 * El PUT directo a S3 con XHR: fetch no da progreso de subida, y un video
 * pesa cientos de MB (M5). Va fuera de pedir(): no es /api ni lleva token.
 */
export function subirConProgreso(
  firma: Firma,
  archivo: File,
  alAvanzar: (a: Avance) => void,
): { hecho: Promise<void>; cancelar: () => void } {
  const xhr = new XMLHttpRequest();
  const hecho = new Promise<void>((resolver, rechazar) => {
    xhr.open('PUT', firma.url);
    xhr.setRequestHeader('Content-Type', firma.content_type);
    xhr.upload.onprogress = ev => {
      if (!ev.lengthComputable) return;
      alAvanzar({ pct: Math.round((100 * ev.loaded) / ev.total), cargados: ev.loaded, total: ev.total });
    };
    xhr.onload = () =>
      xhr.status < 300
        ? resolver()
        : rechazar(new Error(`La subida a la nube falló (${xhr.status}) — intenta de nuevo.`));
    xhr.onerror = () => rechazar(new Error('La subida falló — revisa tu conexión e intenta de nuevo.'));
    xhr.onabort = () => rechazar(new Error('Subida cancelada — nada quedó a medias en tu proyecto.'));
    xhr.send(archivo);
  });
  return { hecho, cancelar: () => xhr.abort() };
}

/** Lo que dice el panel bajo el video cuando el corte ya está propuesto. */
export function resumenListo(ed: Corrida | null): { texto: string; nada: boolean } {
  const e = ed ?? {};
  // Cero sugerencias no es un corte propuesto: decirlo así —y decir que los
  // créditos volvieron— en vez de anunciar «propuso 0 cortes, 0 sugerencias».
  const nada = e.estado === 'listo' && !e.cortes && !e.fluff && !e.flags;
  if (nada) {
    return {
      nada,
      texto:
        'Tu video ya está apretado: no encontramos relleno que quitar' +
        (e.devueltos ? ` — te devolvimos ${e.devueltos} créditos.` : '.') +
        ' Puedes abrir el editor y cortar a mano.',
    };
  }
  const resumen =
    e.estado === 'listo' ? `propuso ${e.cortes ?? 0} cortes, ${e.fluff ?? 0} sugerencias y ${e.flags ?? 0} dudas.` : '';
  return { nada, texto: `Corte propuesto${resumen ? ': ' + resumen : '.'}` };
}

export function notaMetraje(c: Costo): string {
  return (
    `Metraje de ${(c.duracion_s / 60).toFixed(1)} min` +
    (c.con_transcript ? ' (ya trae transcript).' : ' (la corrida del editor incluye la transcripción).')
  );
}

export const aShorts = (p: string) => '/shorts.html?p=' + encodeURIComponent(p);
export const alEditor = (p: string) => '/editor/' + encodeURIComponent(p) + '/';
