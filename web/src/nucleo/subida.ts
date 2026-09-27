// Subir un video a S3, sin React: /api/media (config, presign, confirmar) y
// el PUT directo con XHR para tener progreso real. Lo comparten editar
// metraje (e1) y shorts, que antes tenían dos copias de lo mismo.
import { pedir } from './api';

export interface ConfigMedia {
  activo: boolean;
  /** Base de CloudFront para el video de muestra. */
  cdn: string;
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

export const cargarConfig = () =>
  pedir<ConfigMedia>('/api/media/config').then(c => ({ activo: Boolean(c.activo), cdn: (c.cdn || '').replace(/\/$/, '') }));

export const firmar = (proyecto: string, archivo: File) =>
  pedir<Firma>('/api/media/presign', {
    cuerpo: { proyecto, archivo: archivo.name, content_type: archivo.type || 'video/mp4', bytes: archivo.size },
  });

export const confirmar = (proyecto: string, key: string) =>
  pedir<Subida>('/api/media/confirmar', { cuerpo: { proyecto, key } });

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

/** Un nombre de proyecto a partir del archivo («Mi Entrevista.mp4» → «mi-entrevista»). */
export function nombreDesde(archivo: string): string {
  return (
    archivo
      .replace(/\.[^.]+$/, '')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'mi-video'
  );
}
