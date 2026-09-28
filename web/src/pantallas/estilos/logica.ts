// La copiadora de estilos sin React: tipos de /api/estilo y lo que
// static/estilos.html calculaba en línea. La tarifa llega en el listado
// (`creditos`, de tarifas.json §estilos en el server).
import { pedir } from '../../nucleo/api';

export interface Perfil {
  id: string;
  estado: 'analizando' | 'listo' | 'error' | string;
  plataforma?: string;
  error?: string;
  fuente?: { autor?: string; plataforma?: string };
  metrica?: { duracion_s?: number; cortes_por_min?: number };
  paleta?: Array<{ hex: string; pct: number }>;
  perfil?: {
    tipografia?: string;
    captions?: string;
    iluminacion?: string;
    estetica?: string;
    tono?: string;
    prompt_estilo?: string;
  };
}

export interface Listado {
  estilos: Perfil[];
  creditos: number;
}

export const cargar = () => pedir<Listado>('/api/estilo');

export const analizar = (url: string) =>
  pedir<{ lanzado: boolean; id: string; creditos: number }>('/api/estilo/analizar', {
    cuerpo: { url },
    apartar: 'estilo-analizar',
  });

export const vivos = (l: Listado) => l.estilos.filter(e => e.estado === 'analizando');

/** Solo un color de verdad entra al style: un «hex» con otra cosa sería CSS ajeno. */
export function colorSeguro(hex: string): string | null {
  return /^#[0-9a-f]{3,8}$/i.test(hex.trim()) ? hex.trim() : null;
}

export function titulo(e: Perfil): string {
  return e.fuente?.autor ? '@' + e.fuente.autor : e.id;
}

export function detalle(e: Perfil): string {
  const m = e.metrica ?? {};
  return `${e.fuente?.plataforma ?? ''} · ${m.duracion_s || '?'} s · ${m.cortes_por_min ?? '?'} cortes/min`;
}
