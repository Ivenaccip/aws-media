// El panel del negocio sin React: los tipos de /api/admin/* y las cuentas que
// static/admin.html hacía en línea. Lo que llega del server es de TODOS los
// usuarios (correos, ids, conceptos de Langfuse): aquí no se arma HTML con
// ello; React lo pinta siempre como texto.
import { pedir } from '../../nucleo/api';

export type Proveedor = 'openai' | 'fal' | 'claude' | 'otros';

export interface UsuarioResumen {
  user_id: string;
  email: string | null;
  saldo: number;
  cortesia: number;
  comprados: number;
  gastados: number;
  peliculas: number;
  s3_bytes: number | null;
  fargate_s?: number;
  costo_usd: number;
  costo_aws_usd?: number;
  aurora_usd?: number;
  costo_ia_usd?: number;
  costo_ia_prov?: Partial<Record<Proveedor, number>>;
  ingresos_usd?: number;
  margen_usd: number;
}

export interface Totales {
  costo_usd: number;
  costo_aws_usd?: number;
  costo_ia_usd?: number;
  costo_ia_prov?: Partial<Record<Proveedor, number>>;
  ingresos_usd?: number;
  margen_usd: number;
  gastados: number;
  peliculas: number;
}

export interface Resumen {
  usuarios: UsuarioResumen[];
  aurora: { acu_horas: number; usd: number } | null;
  piso_venta_usd: number;
  totales: Totales;
  langfuse_base: string;
}

export interface Traza {
  concepto: string;
  costo_usd: number;
  segundos: number | null;
  traza: string | null;
}

export interface Proyecto {
  id: string;
  creado: string;
  estado: string;
  brief: string | null;
  duracion_s: string | null;
  creditos: number;
  costo_usd: number;
  trazas: Traza[];
}

export interface Detalle {
  user_id: string;
  proyectos: Proyecto[];
  sin_proyecto: Traza[];
  langfuse_base: string;
}

export const cargarResumen = (senal?: AbortSignal) =>
  pedir<Resumen>('/api/admin/resumen', senal ? { senal } : {});

export const cargarDetalle = (uid: string) =>
  pedir<Detalle>('/api/admin/usuarios/' + encodeURIComponent(uid));

export const sincronizar = () =>
  pedir<{ ok: boolean; nuevas: number }>('/api/admin/costes/sync?dias=7', { metodo: 'POST' });

// Las cifras por usuario son muy pequeñas (fracciones de dólar): cuatro decimales,
// igual que la pantalla vieja. Los totales van con formato.dolares. El signo
// va delante del «$» (la vieja escribía «$-0.3000»).
export function dolares4(x: number): string {
  return (x < 0 ? '-$' : '$') + Math.abs(x).toFixed(4);
}

export function megas(b: number | null | undefined): string {
  if (b == null) return '—';
  return b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(1) + ' MB';
}

export function tiempo(s: number | null | undefined): string {
  if (!s) return '—';
  return s >= 90 ? (s / 60).toFixed(1) + ' min' : Math.round(s) + ' s';
}

/** Lo que el server manda, o lo que se puede derivar si aún no lo manda. */
export const ingresos = (u: UsuarioResumen, piso: number) => u.ingresos_usd ?? u.gastados * piso;
export const ingresosTotales = (r: Resumen) => r.totales.ingresos_usd ?? r.totales.gastados * r.piso_venta_usd;
export const costoIA = (x: { costo_ia_usd?: number; costo_usd: number }) => x.costo_ia_usd ?? x.costo_usd;
export const proveedor = (x: { costo_ia_prov?: Partial<Record<Proveedor, number>> }, p: Proveedor) =>
  x.costo_ia_prov?.[p] ?? 0;
export const awsTotal = (u: UsuarioResumen) => (u.aurora_usd ?? 0) + (u.costo_aws_usd ?? 0);

export const nombreDe = (u: UsuarioResumen) => u.email || u.user_id;

/** El enlace a la traza en Langfuse, con el id codificado. */
export function enlaceTraza(base: string, traza: string): string {
  return base + '/trace/' + encodeURIComponent(traza);
}
