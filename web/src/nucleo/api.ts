// La única puerta a /api desde web/. Va SOBRE el fetch que envuelve
// /auth.js (el token, el refresco y el login): por eso aquí no hay axios ni
// otro cliente, que se saltarían ese envoltorio (docs/PLAN-UI.md §2).
//
// Borradores: cuando la sesión no se puede refrescar, auth.js se lleva al
// usuario a Cognito y la página se pierde con lo que había escrito. Una
// petición con `apartar` deja su cuerpo en sessionStorage ANTES de salir y lo
// borra al recibir respuesta; si la página se fue a mitad, al volver
// `recuperarApartado(clave)` lo devuelve para que la pantalla lo reponga.

export type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Pedido {
  metodo?: Metodo;
  cuerpo?: unknown;
  /** Clave para apartar el cuerpo mientras la petición vuela. */
  apartar?: string;
  senal?: AbortSignal;
}

export class ErrorApi extends Error {
  readonly estado: number;
  readonly detalle: unknown;

  constructor(estado: number, mensaje: string, detalle: unknown) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.estado = estado;
    this.detalle = detalle;
  }

  /** 402: el servidor dice que no alcanzan los créditos. */
  get sinSaldo(): boolean {
    return this.estado === 402;
  }
}

const PREFIJO = 'apartado:';

export interface Apartado {
  ruta: string;
  metodo: Metodo;
  cuerpo: unknown;
  cuando: number;
}

function mensajeDe(estado: number, detalle: unknown): string {
  if (typeof detalle === 'string' && detalle.trim()) return detalle;
  if (detalle && typeof detalle === 'object' && 'mensaje' in detalle) {
    const m = (detalle as { mensaje: unknown }).mensaje;
    if (typeof m === 'string' && m.trim()) return m;
  }
  if (estado === 0) return 'No hay conexión. Revisa tu internet y vuelve a intentar.';
  // el 422 de validación de FastAPI trae una lista técnica en `detail`: se
  // traduce a lo que la persona puede hacer, sin el código
  if (estado === 422) return 'Revisa lo que escribiste: hay un dato que no es válido.';
  return 'Algo salió mal (HTTP ' + estado + ').';
}

export async function pedir<T>(ruta: string, p: Pedido = {}): Promise<T> {
  if (!ruta.startsWith('/api/')) throw new Error('pedir(): solo rutas /api/… del propio sitio');
  const metodo = p.metodo ?? (p.cuerpo === undefined ? 'GET' : 'POST');
  const init: RequestInit = { method: metodo, headers: { Accept: 'application/json' } };
  if (p.senal) init.signal = p.senal;
  if (p.cuerpo !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(p.cuerpo);
  }
  if (p.apartar) apartar(p.apartar, { ruta, metodo, cuerpo: p.cuerpo, cuando: Date.now() });

  let r: Response;
  try {
    r = await fetch(ruta, init);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ErrorApi(0, mensajeDe(0, null), e);
  }
  // hubo respuesta: el borrador ya no corre peligro (un 401 sin refresco no
  // llega aquí: auth.js navega a Cognito y deja esta promesa sin resolver)
  if (p.apartar) soltar(p.apartar);

  const tipo = r.headers.get('Content-Type') ?? '';
  const datos: unknown = r.status === 204 ? undefined
    : tipo.includes('application/json') ? await r.json() : await r.text();
  if (!r.ok) {
    const detalle = datos && typeof datos === 'object' && 'detail' in datos
      ? (datos as { detail: unknown }).detail : datos;
    throw new ErrorApi(r.status, mensajeDe(r.status, detalle), detalle);
  }
  return datos as T;
}

function apartar(clave: string, a: Apartado): void {
  try { sessionStorage.setItem(PREFIJO + clave, JSON.stringify(a)); } catch { /* lleno o bloqueado */ }
}

function soltar(clave: string): void {
  try { sessionStorage.removeItem(PREFIJO + clave); } catch { /* bloqueado */ }
}

/** Devuelve (y borra) lo que quedó apartado bajo `clave`, si algo quedó. */
export function recuperarApartado(clave: string): Apartado | null {
  try {
    const crudo = sessionStorage.getItem(PREFIJO + clave);
    if (!crudo) return null;
    sessionStorage.removeItem(PREFIJO + clave);
    return JSON.parse(crudo) as Apartado;
  } catch {
    return null;
  }
}
