// Editar metraje sin React: los tipos de /api/editar y lo que
// static/e1.html calculaba en línea. El precio del Editor IA SIEMPRE sale de
// /api/editar/<p>/costo (tarifas.json §editar en el server): aquí no se
// escribe ningún número de créditos.
import { pedir } from '../../nucleo/api';

// la subida (media API + XHR) la comparte con shorts: nucleo/subida.ts
export { cargarConfig, type ConfigMedia } from '../../nucleo/subida';

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

const ruta = (p: string) => '/api/editar/' + encodeURIComponent(p);

export const cargarEstado = (p: string) => pedir<EstadoEditar>(ruta(p));
export const cargarCosto = (p: string) => pedir<Costo>(ruta(p) + '/costo');
export const sugerir = (p: string) => pedir<{ lanzado: boolean; creditos: number }>(ruta(p) + '/sugerir', { metodo: 'POST' });

export const corriendo = (st: EstadoEditar | null) => st?.editar?.estado === 'corriendo';

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
