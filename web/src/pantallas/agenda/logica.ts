// La Agenda sin React: los tipos de /api/agenda y lo que static/agenda.html
// calculaba en línea. No cobra nada. La fuente de verdad es Blotato: la lista
// es SOLO lo que todavía no ha salido y se puede hacer dos cosas, cambiar la
// hora y cancelar. Nunca se manda el texto ni el video: Blotato no fusiona el
// draft, y uno parcial dejaría programada una publicación SIN video.
import { ErrorApi, pedir } from '../../nucleo/api';

export interface Programada {
  id: string;
  red: string;
  cuenta_nombre?: string;
  /** Distingue dos páginas de la MISMA cuenta: sin él se cancela la equivocada. */
  destino?: string;
  cuando: string;
  texto?: string;
  /** El «…» lo decide el server: un texto de 200 justos no se recortó. */
  cortado?: boolean;
  medios?: number;
}

export interface Pagina {
  items: Programada[];
  cursor: string | null;
  total: number | null;
  /** Blotato falló: el server responde 200 con el porqué. */
  error: string | null;
  /** La clave dejó de servir: el aviso ofrece conectarla. */
  reconectar: boolean;
}

export const cargar = (cursor: string | null) =>
  pedir<Pagina>('/api/agenda' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
export const reprogramar = (id: string, cuando: string) =>
  pedir<unknown>('/api/agenda/reprogramar', { cuerpo: { id, cuando } });
export const cancelar = (id: string) => pedir<unknown>('/api/agenda/cancelar', { cuerpo: { id, confirmar: true } });

/** Adónde lleva «Conectar Blotato» (el diálogo del inicio). */
export const CONECTAR = '/estudio/?blotato=conectar';

// El server rechaza cualquier hora a menos de 60 s (server/publicar_api.py,
// _cuando): aceptar 10 s aquí sería gastar una llamada para oír que no.
export const MARGEN_S = 60;

/** Siempre en la zona del navegador (los textos que la acompañan dicen «tu
 *  hora»), pero en español: la vieja usaba el idioma del navegador y un
 *  navegador en inglés leía «sale el May 1, 2099» a media frase. */
export function fecha(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

/** El <input datetime-local> habla en hora local y sin zona; toISOString, en UTC. */
export function local(valor: string | number | Date): string {
  const d = new Date(valor);
  if (isNaN(d.getTime())) return '';
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** `total` llega como int o null: si no se pudo contar, no se inventa un conteo. */
export function resumen(total: number | null | undefined): string {
  if (typeof total !== 'number' || !Number.isFinite(total)) return 'Tus publicaciones programadas';
  return total === 1 ? '1 publicación programada' : `${total} publicaciones programadas`;
}

/** «2 archivos», o null si no trae: la doc de Blotato dice images, videos. */
export function adjuntos(medios: unknown): string | null {
  const n = Math.trunc(Number(medios));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n === 1 ? '1 archivo' : `${n} archivos`;
}

export function texto(it: Programada): string {
  return (it.texto ?? '') + (it.texto && it.cortado ? '…' : '');
}

/** El `min` del campo: ni el pasado ni el minuto que el server rechaza. */
export const minimo = (ahora = Date.now()) => local(ahora + MARGEN_S * 1000);

/** Red · cuenta · destino: lo mismo en la tarjeta, el diálogo y la confirmación. */
export function quien(it: Programada): string {
  return [it.red, it.cuenta_nombre, it.destino].filter(Boolean).join(' · ');
}

/** Lo que impide guardar, o null. `ahora` en ms. Cero llamadas si no sirve. */
export function validar(valor: string, ahora: number): string | null {
  if (!valor) return 'Elige la fecha y hora.';
  const t = new Date(valor).getTime();
  if (isNaN(t)) return 'Esa fecha no es válida.';
  if (t <= ahora) return 'Esa hora ya pasó: elige una más adelante.';
  if (t < ahora + MARGEN_S * 1000) return 'Falta menos de un minuto para esa hora: elige una un poco más adelante.';
  return null;
}

/** El cuerpo de la confirmación: qué, dónde y cuándo, con el texto recortado. */
export function confirmacion(it: Programada): string {
  const corta = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const partes = [quien(it), `${fecha(it.cuando)} (tu hora)`];
  if (it.texto) partes.push(`«${corta(it.texto, 140)}»`);
  return partes.join(' · ') + '. No se puede deshacer: Blotato ya no la publicará.';
}

export const SIN_RED = 'No pudimos hablar con el servidor. Intenta de nuevo.';

/** El texto lo escribe el server; un fallo de red trae «Failed to fetch» en inglés. */
export function mensaje(e: unknown): string {
  return e instanceof ErrorApi && e.estado !== 0 && e.message ? e.message : SIN_RED;
}

export const estado = (e: unknown) => (e instanceof ErrorApi ? e.estado : 0);

export function zona(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}
