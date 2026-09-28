// Investiga tu competencia sin React: tipos de /api/competencia y lo que
// static/competencia.html calculaba en línea. La tarifa por cuenta llega en
// el listado (`credito_por_cuenta`, de tarifas.json §competencia); revisar N
// cuentas cuesta N veces eso (pipeline/creditos.py: costo_competencia).
import { pedir } from '../../nucleo/api';

export type Red = 'instagram' | 'tiktok' | 'youtube' | string;

export interface Cuenta {
  id: string;
  red: Red;
  cuenta: string;
}

export interface Resumen {
  id: string;
  estado: 'analizando' | 'listo' | 'error' | string;
  inicio?: string;
  creditos?: number;
  devueltos?: number;
  cuentas: Array<{ cuenta: string }>;
  n_publicaciones: number;
  error?: string;
}

export interface Listado {
  cuentas: Cuenta[];
  informes: Resumen[];
  credito_por_cuenta: number;
  max_cuentas: number;
}

export interface Publicacion {
  id: string;
  red: Red;
  cuenta: string;
  cuando?: string;
  duracion_s?: number | null;
  indice?: number | null;
  enlace?: string;
  texto?: string;
  vistas?: number | null;
  me_gusta?: number | null;
  comentarios?: number | null;
  compartidos?: number | null;
}

export interface Lectura {
  patrones?: Array<{ que: string; ids?: string[] }>;
  ganchos?: string;
  formato?: string;
  probar?: string[];
  advertencia?: string;
}

export interface Informe {
  id: string;
  publicaciones?: Publicacion[];
  lectura?: Lectura | null;
  fallidas?: Array<{ cuenta: string; motivo?: string }>;
  devueltos?: number;
}

export const cargar = () => pedir<Listado>('/api/competencia');
export const agregar = (url: string) => pedir<{ cuentas: Cuenta[] }>('/api/competencia/cuentas', { cuerpo: { url } });
export const quitar = (id: string) =>
  pedir<{ cuentas: Cuenta[] }>('/api/competencia/cuentas/' + encodeURIComponent(id), { metodo: 'DELETE' });
export const revisar = () =>
  pedir<{ lanzado: boolean; id: string; creditos: number }>('/api/competencia/analizar', { cuerpo: {} });
export const abrirInforme = (id: string) => pedir<Informe>('/api/competencia/informes/' + encodeURIComponent(id));

export const vivos = (l: Listado) => l.informes.filter(r => r.estado === 'analizando');

export function nombreRed(red: Red): string {
  return red === 'instagram' ? 'Instagram' : red === 'tiktok' ? 'TikTok' : 'YouTube';
}

/** Una liga que no es http(s) no se pinta: un `javascript:` en un href corre al clic. */
export function hrefSeguro(url: string | undefined): string | null {
  const t = String(url ?? '').trim();
  return /^https?:\/\//i.test(t) ? t : null;
}

/** Un número que no vino NO es cero: «—». Los que vinieron, agrupados en es-MX. */
export function numero(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : Number(v).toLocaleString('es-MX');
}

// Siempre en español: con el idioma del navegador salía «September 25».
export function dia(iso: string | undefined): string {
  const d = new Date(iso ?? '');
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
}

// Un episodio de YouTube dura horas y un reel, segundos: «131:46 min» era
// verdad y no se entendía.
export function duracionLarga(s: number | null | undefined): string {
  if (!s && s !== 0) return '';
  const t = Math.round(Number(s));
  if (t < 60) return `${t} s`;
  if (t < 3600) return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} min`;
  const m = Math.round((t % 3600) / 60);
  return m ? `${Math.floor(t / 3600)} h ${m} min` : `${Math.floor(t / 3600)} h`;
}

/** El índice es la única comparación honesta entre cuentas de tamaños distintos. */
export function indice(v: number | null | undefined): { texto: string; alto: boolean } | null {
  if (v === null || v === undefined) return null;
  return {
    texto: Number(v).toLocaleString('es-MX', { maximumFractionDigits: 1 }) + '× lo normal',
    alto: v >= 1.3,
  };
}

export const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

export function precioNota(tarifa: number, n: number, max: number): string {
  return n ? `${tarifa} créditos por cuenta · ${n} de ${max}` : `${tarifa} créditos por cuenta, hasta ${max} cuentas`;
}
