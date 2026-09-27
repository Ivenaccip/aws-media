// MIX sin React: la API de /api/mix y lo que static/mix.html calculaba en
// línea (M23 · D, publicidad automática: una imagen al día).
//
// La pantalla no decide NADA de dinero:
//   · el costo que enseña sale SIEMPRE de la respuesta de /api/mix/borrador,
//     que es el mismo `mix.resumen_costo` que después cobra /encender;
//   · lo que se devolvería al apagar sale de `devolucion`, que manda
//     GET /api/mix ya topado en lo que de verdad se cobró.
// Aquí no se multiplica ni se resta un solo crédito: si ese campo no viene,
// se enseña el aviso SIN cifra antes que inventar una.
//
// La otra regla: lo que el usuario VIO en el ejemplo es lo que va a salir. Si
// después cambia el motivo, el tono, la foto o el día de inicio, el ejemplo
// deja de valer y hay que pedir otro (es gratis).
import { ErrorApi, pedir } from '../../nucleo/api';

export type EstadoCampana = 'borrador' | 'activa' | 'pausada' | 'terminada' | 'cancelada' | string;

export interface Campana {
  id: string;
  motivo?: string;
  tono?: string;
  canal_id?: string;
  canal_red?: string;
  canal_nombre?: string;
  hora?: string;
  zona?: string;
  empieza: string;
  termina: string;
  estado: EstadoCampana;
  nota?: string | null;
  creditos_cobrados?: number | null;
  creditos_devueltos?: number | null;
  imagen?: string | null;
}

export interface Corrida {
  dia: string;
  estado: 'preparando' | 'ejemplo' | 'corriendo' | 'publicada' | 'error' | 'incierta' | string;
  texto?: string | null;
  imagen?: string | null;
  error?: string | null;
}

export interface Ultima {
  empieza: string;
  termina: string;
  estado: string;
  salieron?: number;
  creditos_devueltos?: number | null;
}

export interface EstadoMix {
  campana: Campana | null;
  ultima: Ultima | null;
  corridas: Corrida[];
  /** null = el monedero está apagado en este despliegue: no hay nada que cobrar. */
  saldo: number | null;
  tarifa: number;
  tonos: string[];
  atajos: Record<string, number>;
  max_dias: number;
  tiene_blotato: boolean;
  devolucion: number | null;
}

export interface Costo {
  dias: number;
  publicaciones: number;
  creditos: number;
  saldo: number;
  alcanza: boolean;
  faltan: number;
}

export interface Cuenta {
  id: string | number;
  platform?: string;
  fullname?: string;
  username?: string;
}

export const cargar = (senal?: AbortSignal) => pedir<EstadoMix>('/api/mix', senal ? { senal } : {});
export const cargarCuentas = () => pedir<{ cuentas?: Cuenta[]; fuera?: string[] }>('/api/mix/cuentas');
export const pedirEjemplo = () => pedir<{ dia: string; estado: string }>('/api/mix/ejemplo', { cuerpo: {} });
export const encender = (id: string) =>
  pedir<{ ok: boolean; id: string; dias: number; creditos: number }>('/api/mix/encender', { cuerpo: { id } });
export const apagar = () => pedir<{ ok: boolean; salieron: number; devueltos: number }>('/api/mix/apagar', { cuerpo: { confirmar: true } });
export const reanudar = (id: string) => pedir<{ ok: boolean }>('/api/mix/reanudar', { cuerpo: { id } });

/** El borrador es multipart (la foto viaja UNA vez): pedir() solo habla JSON. */
export async function guardarBorrador(fd: FormData): Promise<{ id: string; costo: Costo | null }> {
  let r: Response;
  try {
    r = await fetch('/api/mix/borrador', { method: 'POST', body: fd, headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new ErrorApi(0, SIN_RED, e);
  }
  let d: unknown = null;
  try {
    d = await r.json();
  } catch {
    /* cuerpo vacío */
  }
  if (!r.ok) {
    const det = d && typeof d === 'object' && 'detail' in d ? (d as { detail: unknown }).detail : null;
    throw new ErrorApi(r.status, typeof det === 'string' && det.trim() ? det : 'Algo salió mal (HTTP ' + r.status + ').', det);
  }
  const j = (d ?? {}) as { id?: string; costo?: Costo };
  return { id: j.id ?? '', costo: j.costo ?? null };
}

export const SIN_RED = 'No pudimos hablar con el servidor. Intenta de nuevo.';
/** El texto lo escribe el server; un fallo de red trae «Failed to fetch» en inglés. */
export const mensaje = (e: unknown) => (e instanceof ErrorApi && e.estado !== 0 && e.message ? e.message : SIN_RED);
export const estadoDe = (e: unknown) => (e instanceof ErrorApi ? e.estado : 0);
/** 409 en MIX significa dos cosas y solo una se arregla conectando: lo distingue el mensaje. */
export const pideConectar = (e: unknown) => estadoDe(e) === 409 && /Blotato/i.test(e instanceof Error ? e.message : '');

export const CONECTAR = '/estudio/?blotato=conectar';
export const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_BYTES = 12 * 1024 * 1024;

export function problemaFoto(f: File): string | null {
  if (!TIPOS.includes(f.type)) return 'Esa foto no la podemos leer. Tiene que ser JPG, PNG o WebP.';
  if (f.size > MAX_BYTES) return 'Esa foto pesa demasiado: el máximo son 12 MB.';
  return null;
}

// El estado, la red y el tono los escribe el server: buscarlos con obj[clave]
// a secas haría que «constructor» devolviera una función en vez de un rótulo.
export function rotulo<T>(mapa: Record<string, T>, clave: unknown, porDefecto: T): T {
  const k = String(clave ?? '');
  return Object.prototype.hasOwnProperty.call(mapa, k) ? mapa[k]! : porDefecto;
}

export const REDES: Record<string, string> = {
  twitter: 'X',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  pinterest: 'Pinterest',
  threads: 'Threads',
  bluesky: 'Bluesky',
  youtube: 'YouTube',
};
export const TONOS: Record<string, string> = { vender: 'Vender', informar: 'Informar', recordar: 'Recordar' };

export const nombreCuenta = (c: Cuenta) => String(c.fullname || c.username || c.id || '');
export const etiquetaCuenta = (c: Cuenta) => `${rotulo(REDES, c.platform, c.platform || 'Red')} · ${nombreCuenta(c)}`;

// ── fechas: SIEMPRE en la zona del navegador ─────────────────────────────
// toISOString habla en UTC y a las 7 de la tarde en México devuelve el día
// siguiente: por eso el ISO se arma a mano.
export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function deIso(s: string): Date {
  const p = String(s || '').slice(0, 10).split('-').map(Number);
  return new Date(p[0]!, (p[1] || 1) - 1, p[2] || 1);
}
export const hoy = () => iso(new Date());
export function suma(s: string, n: number): string {
  const d = deIso(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}
/** Cuenta los DOS extremos, igual que mix.dias_de: del 1 al 3 son tres días. */
export const dias = (a: string, b: string) => Math.round((deIso(b).getTime() - deIso(a).getTime()) / 86400000) + 1;
export const primeroDeMes = (s: string) => {
  const d = deIso(s);
  d.setDate(1);
  return d;
};
export const mesMas = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

export const fechaLarga = (s: string) =>
  deIso(s).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const fechaCorta = (s: string) => deIso(s).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
export const fechaFila = (s: string) => deIso(s).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });

/** «09:00» se lee «las 9:00»: el cero de delante es del <select>, no del habla. */
export function horaTexto(hhmm: string | undefined): string {
  const p = String(hhmm || '09:00').split(':');
  return `${Number(p[0]) || 0}:${p[1] || '00'}`;
}

/** Los créditos se escriben SIEMPRE como enteros. */
export const n = (v: unknown) => String(Math.trunc(Number(v) || 0));
export const pl = (v: unknown, uno: string, varios: string) => `${n(v)} ${Math.trunc(Number(v) || 0) === 1 ? uno : varios}`;

// ── el formulario ──────────────────────────────────────────────────────────
export interface Borrador {
  tieneFoto: boolean;
  motivo: string;
  ini: string | null;
  fin: string | null;
  cuenta: Cuenta | null;
}

/** Lo primero que falta, con el nombre que el dueño le da en la pantalla. */
export function queFalta(b: Borrador): string {
  if (!b.tieneFoto) return 'Falta la foto de tu producto.';
  if (!b.motivo.trim()) return 'Falta contarnos para qué es la campaña.';
  if (!b.ini || !b.fin) return 'Faltan las fechas: marca el primer día y el último.';
  if (!b.cuenta) return 'Falta elegir en qué cuenta va a salir.';
  return '';
}

/** Qué vio el usuario. La hora o el último día cambian el COSTO, no la publicación. */
export const firma = (motivo: string, tono: string, ini: string | null, imagenId: string) =>
  JSON.stringify([motivo.trim(), tono, ini, imagenId]);

/** Un clic marca el inicio, el siguiente el fin; antes del inicio vuelve a empezar. */
export function clicDia(ini: string | null, fin: string | null, dia: string): { ini: string; fin: string | null } {
  if (!ini || fin || dia < ini) return { ini: dia, fin: null };
  return { ini, fin: dia };
}

// ── el ejemplo: se pide y se espera mirando GET /api/mix ─────────────────
// Empieza rápido y se va frenando: GET /api/mix no es barato (campaña,
// corridas, saldo, Blotato).
export const PASOS_MS = [5000, 5000, 5000, 10000, 10000, 20000];
export const AVISO_MS = 120000; // cuándo se dice que está tardando más de lo normal
export const TOPE_MS = 240000; // hasta cuándo se espera MIRANDO (el trabajo sigue)
export const pausa = (vuelta: number) => PASOS_MS[Math.min(vuelta, PASOS_MS.length - 1)]!;

export type Veredicto =
  | { tipo: 'listo'; fila: Corrida }
  | { tipo: 'seguir' }
  | { tipo: 'descartado' }
  | { tipo: 'fallo'; texto: string };

/** Qué dice una vuelta de GET /api/mix sobre el ejemplo del día `dia`. */
export function leerEjemplo(j: EstadoMix, dia: string): Veredicto {
  // encendió mientras se esperaba: ya no es el formulario de un borrador
  if (j.campana && j.campana.estado !== 'borrador') return { tipo: 'descartado' };
  const fila = (j.corridas || []).find(x => String(x.dia).slice(0, 10) === dia);
  // movió las fechas y el server tiró el ejemplo huérfano: no es un error
  if (!fila) return { tipo: 'descartado' };
  if (fila.estado === 'ejemplo') return { tipo: 'listo', fila };
  if (fila.estado !== 'preparando') return { tipo: 'descartado' };
  // sigue en 'preparando' con algo escrito: ese intento murió
  if (fila.error) return { tipo: 'fallo', texto: fila.error };
  return { tipo: 'seguir' };
}

// ── la campaña encendida ──────────────────────────────────────────────────
export interface Devolucion {
  dias: number;
  /** null = el server no lo dijo, NO cero. */
  creditos: number | null;
}

export function devolucion(m: EstadoMix): Devolucion {
  const c = m.campana;
  if (!c) return { dias: 0, creditos: null };
  const total = dias(c.empieza, c.termina);
  const salieron = (m.corridas || []).filter(x => x.estado === 'publicada').length;
  const crudo = m.devolucion as unknown;
  const hay = crudo !== null && crudo !== undefined && crudo !== '' && Number.isFinite(Number(crudo));
  const cr = hay ? Math.trunc(Number(crudo)) : null;
  // los días salen de los créditos cuando el server los dijo: un día que
  // falló ya se devolvió en el acto y no se promete dos veces
  const tarifa = Math.max(1, Math.trunc(Number(m.tarifa) || 0));
  return { dias: cr === null ? Math.max(0, total - salieron) : Math.round(cr / tarifa), creditos: cr };
}

/** La MISMA frase en el pie del panel y en la confirmación. */
export function fraseDevolucion(d: Devolucion): string {
  const ds = pl(d.dias, 'día', 'días');
  if (d.creditos === null)
    return d.dias
      ? `Si la apagas ahora dejan de salir los ${ds} que faltan y te devolvemos sus créditos.`
      : 'Ya salieron todas las publicaciones de esta campaña.';
  if (d.creditos <= 0) return 'Ya salieron todas las publicaciones que pagaste: apagarla no devuelve nada.';
  const cr = pl(d.creditos, 'crédito', 'créditos');
  return d.dias ? `Si la apagas ahora te devolvemos ${cr}, los ${ds} que no salieron.` : `Si la apagas ahora te devolvemos ${cr}.`;
}

export const PILDORAS: Record<string, [tono: 'buena' | 'viva' | 'mala' | '', texto: string]> = {
  publicada: ['buena', 'Publicada'],
  corriendo: ['viva', 'Preparándose'],
  ejemplo: ['viva', 'Lista'],
  preparando: ['viva', 'Preparándose'],
  error: ['mala', 'No salió'],
  // se mandó a Blotato y no confirmó: por eso no se devuelven sus créditos
  incierta: ['', 'Sin confirmar'],
  // apagaste la campaña mientras ese día se preparaba (ya se devolvió al apagar)
  cancelada: ['', 'Cancelada'],
};

/** La próxima que va a salir. El día del ejemplo NO cuenta como hecho. */
export function proxima(c: Campana, porDia: Record<string, Corrida>, hoyIso: string): string {
  if (c.estado !== 'activa') return '';
  const total = dias(c.empieza, c.termina);
  for (let i = 0; i < total; i++) {
    const d = suma(c.empieza, i);
    if (d < hoyIso) continue;
    const x = porDia[d];
    if (x && x.estado !== 'ejemplo' && x.estado !== 'preparando') continue;
    return `La próxima sale ${fechaFila(d)} a las ${horaTexto(c.hora)}.`;
  }
  return 'Ya salieron todos los días. La campaña se cierra sola.';
}

export const hrefImagen = (u: string | null | undefined) => {
  const t = String(u ?? '');
  return t.startsWith('/api/') || /^https:\/\//.test(t) ? t : null;
};

export function zona(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}
