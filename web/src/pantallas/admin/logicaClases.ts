// La pestaña «4 · Clases» del panel, sin React: los tipos de /api/admin/clases (el contrato es la sección 5.1 del diseño de la
// Guía de clases) y las llamadas. Todo lo que llega del servidor es del dueño o de sus datos (títulos, nombres de archivo,
// ligas): aquí no se arma HTML con nada de eso; React lo pinta siempre como texto.
//
// Los LÍMITES (extensiones, tamaño, largo del título…) los dice el servidor en cada lista: la web no los inventa. La subida
// NO usa /api/media/presign (reserva nombres de proyecto del editor y metería la clase en «Mis creaciones»): el servidor
// elige la clave del video (clases/<id>/video.<ext>) y aquí nunca se ve.
import { ErrorApi, pedir } from '../../nucleo/api';
import { mb } from '../../nucleo/subida';

export type OrigenClase = 'archivo' | 'liga';

export interface Clase {
  id: string;
  numero: number;
  titulo: string;
  resumen: string | null;
  /** AAAA-MM-DD. */
  grabada_en: string | null;
  origen: OrigenClase;
  /** El nombre del archivo tal como lo vio la persona (solo para mostrar). */
  nombre_original: string | null;
  liga: string | null;
  bytes: number | null;
  duracion_s: number | null;
  /** borrador · subiendo · subido (S1). Los que vengan después se pintan tal cual. */
  estado: string;
  paso: string | null;
  error: string | null;
  publicada: boolean;
  /** Del índice de búsqueda (rebanadas siguientes): S1 no lo usa. */
  indice?: unknown;
  creado: string;
  actualizado: string;
  /** El contrato no lo nombra en la lista de campos; si el servidor lo manda, cuenta como archivada. */
  archivada_en?: string | null;
}

export interface LimitesClases {
  max_bytes: number;
  extensiones: string[];
  content_types: string[];
  presign_s: number;
  duracion_min_s: number;
  duracion_max_s: number;
  titulo_max: number;
  resumen_max: number;
  /** El servidor los manda; si algún día faltan, la web no inventa un tope. */
  numero_min?: number;
  numero_max?: number;
  liga_max?: number;
}

export interface ListaClases {
  clases: Clase[];
  limites: LimitesClases;
}

export interface Subida {
  url: string;
  content_type: string;
  expira_s: number;
  /** Identifica ESTA subida (32 hex, lo genera el servidor): confirmar y cancelar lo devuelven para que una subida vieja no toque la nueva. */
  token?: string;
}

const BASE = '/api/admin/clases';
const ruta = (id: string, sufijo = '') => `${BASE}/${encodeURIComponent(id)}${sufijo}`;

export const cargarClases = (archivadas: boolean, senal?: AbortSignal) =>
  pedir<ListaClases>(`${BASE}?archivadas=${archivadas ? 1 : 0}`, senal ? { senal } : {});

export interface NuevaClase {
  clave: string;
  numero: number;
  titulo: string;
  origen: OrigenClase;
  resumen?: string;
  grabada_en?: string;
  liga?: string;
}

/** Lo que se cambia de una clase. `null` borra el resumen o la fecha; la liga solo se cambia (no se borra) y solo en una clase que es una liga. Lo que no viaja, no cambia. */
export interface CambiosClase {
  numero?: number;
  titulo?: string;
  resumen?: string | null;
  grabada_en?: string | null;
  liga?: string;
}

export const crearClase = (c: NuevaClase) => pedir<{ clase: Clase }>(BASE, { cuerpo: c }).then(r => r.clase);

export const editarClase = (id: string, cambios: CambiosClase) =>
  pedir<{ clase: Clase }>(ruta(id), { metodo: 'PATCH', cuerpo: cambios }).then(r => r.clase);

/** El permiso de subida: el servidor elige la clave y firma el PUT. */
export const pedirSubida = (id: string, archivo: File) =>
  pedir<Subida>(ruta(id, '/subida'), {
    cuerpo: { archivo: archivo.name, content_type: archivo.type || 'video/mp4', bytes: archivo.size },
  });

/** `token`: el de la subida que se confirma. Sin él (una subida que quedó a medias y de la que aquí no se sabe nada) el servidor confirma como siempre. */
export const confirmarSubida = (id: string, nombre?: string, token?: string) =>
  pedir<{ clase: Clase }>(ruta(id, '/confirmar'), { cuerpo: { ...(nombre ? { nombre } : {}), ...(token ? { token } : {}) } }).then(r => r.clase);

export const medirClase = (id: string) =>
  pedir<{ clase: Clase }>(ruta(id, '/medir'), { metodo: 'POST' }).then(r => r.clase);

/** `token`: el de la subida propia. Una subida que quedó a medias (se cerró la pestaña) no lo conoce y se cancela sin él: el servidor lo acepta. */
export const cancelarSubida = (id: string, token?: string) =>
  pedir<{ clase: Clase }>(ruta(id, '/cancelar'), token ? { cuerpo: { token } } : { metodo: 'POST' }).then(r => r.clase);

// ---------------------------------------------------------------------------
// Por qué falló una llamada

/** El `codigo` del error del servidor (`{codigo, texto}`), si lo trae. */
export function codigoDe(e: unknown): string | undefined {
  if (!(e instanceof ErrorApi) || typeof e.detalle !== 'object' || e.detalle === null) return undefined;
  const codigo = (e.detalle as { codigo?: unknown }).codigo;
  return typeof codigo === 'string' ? codigo : undefined;
}

/** Confirmar dice que el video que llegó NO sirve: reintentar no lo arregla, hay que soltar la subida y subir otro. Todo lo demás
 *  (red, 5xx, `s3_fallo`, una base dormida) es pasajero: el video ya está en la nube y basta con volver a confirmar. */
const RECHAZOS_DE_CONFIRMAR = new Set(['archivo_no_esta', 'video_vacio', 'tamano_invalido', 'tipo_no_soportado']);

export const esRechazoDefinitivo = (e: unknown) => RECHAZOS_DE_CONFIRMAR.has(codigoDe(e) ?? '');

/** 409: esta subida ya no es la vigente (se empezó otra o se canceló). El servidor no tocó nada. */
export const esSubidaCambio = (e: unknown) => codigoDe(e) === 'subida_cambio';

/** Una respuesta que no dice si el servidor llegó a cambiar algo: sin red o un 5xx. */
export const esFalloAmbiguo = (e: unknown) => e instanceof ErrorApi && (e.estado === 0 || e.estado >= 500);

/** La vista previa del dueño: una URL firmada que caduca. No se guarda en ningún lado ni se muestra como texto. */
export const urlDeVideo = (id: string) => pedir<{ url: string; expira_s: number }>(ruta(id, '/video'));

/** Archivar es un borrado suave: el servidor marca la clase y no toca el video. */
export const archivarClase = (id: string) => pedir<{ ok: boolean }>(ruta(id), { metodo: 'DELETE' });

export const restaurarClase = (id: string) =>
  pedir<{ clase: Clase }>(ruta(id, '/restaurar'), { metodo: 'POST' }).then(r => r.clase);

// ---------------------------------------------------------------------------
// Lo que se enseña

const ESTADOS: Record<string, string> = {
  borrador: 'Borrador',
  subiendo: 'Subiendo',
  subido: 'Subido',
  error: 'Falló',
};

/** La palabra del chip. Un estado que esta pestaña todavía no conoce se pinta tal cual (como texto). */
export const etiquetaEstado = (c: Clase) => (estaArchivada(c) ? 'Archivada' : (ESTADOS[c.estado] ?? c.estado));

export const estaArchivada = (c: Clase) => Boolean(c.archivada_en) || c.estado === 'archivada';

/** Una clase sube su video solo desde borrador; con el video ya subido (o en proceso) se puede ver. */
export const tieneVideo = (c: Clase) => c.origen === 'archivo' && c.estado !== 'borrador' && c.estado !== 'subiendo' && (c.bytes ?? 0) > 0;

/** «1 h 02 min» · «45 min» · «50 s». */
export function duracionLarga(segundos: number): string {
  const total = Math.max(0, Math.round(segundos));
  if (total < 60) return `${total} s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h === 0 ? `${m} min` : `${h} h ${String(m).padStart(2, '0')} min`;
}

/** «824.0 MB» · «1.4 GB» (decimales, como `mb` de la subida). */
export const tamano = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${mb(bytes)} MB`);

const FECHA = new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeZone: 'UTC' });

/** «12 de marzo de 2026». La fecha viene sin hora: se lee en UTC para que no baje un día. */
export function fechaLarga(iso: string | null): string | null {
  const dia = iso?.slice(0, 10) ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  const d = new Date(dia + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? null : FECHA.format(d);
}

/** La liga solo se vuelve enlace si es https: `javascript:`, `file:` o `http:` se quedan como texto. */
export function ligaSegura(liga: string | null): string | null {
  if (!liga) return null;
  try {
    const u = new URL(liga);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export const ordenar = (clases: Clase[]) =>
  [...clases].sort((a, b) => a.numero - b.numero || a.creado.localeCompare(b.creado));

/** Los puntos de código que cuenta el servidor (un emoji es uno, no dos). */
export const largo = (s: string) => [...s].length;

// ---------------------------------------------------------------------------
// El formulario

export interface Campos {
  numero: string;
  titulo: string;
  grabada_en: string;
  resumen: string;
  liga: string;
}

export const CAMPOS_VACIOS: Campos = { numero: '', titulo: '', grabada_en: '', resumen: '', liga: '' };

export const camposDe = (c: Clase): Campos => ({
  numero: String(c.numero),
  titulo: c.titulo,
  grabada_en: c.grabada_en?.slice(0, 10) ?? '',
  resumen: c.resumen ?? '',
  liga: c.liga ?? '',
});

export type ErroresCampos = Partial<Record<keyof Campos, string>>;

/** Lo mínimo que se revisa antes de molestar al servidor (que haya número y título, y la liga si la clase es una liga); los
 *  límites de verdad (largo, repetidos, ligas) son del servidor, que vuelve a revisar y manda. */
export function validar(c: Campos, l: LimitesClases, ligaObligatoria = false): ErroresCampos {
  const e: ErroresCampos = {};
  const n = c.numero.trim();
  const min = l.numero_min ?? 1;
  const max = l.numero_max;
  if (!/^\d+$/.test(n)) e.numero = 'Escribe el número de la clase: un número entero, como 5.';
  else if (Number(n) < min || (max !== undefined && Number(n) > max)) {
    e.numero = max !== undefined ? `El número de la clase va de ${min} a ${max}.` : `El número de la clase empieza en ${min}.`;
  }
  if (!c.titulo.trim()) e.titulo = 'Escribe el título de la clase.';
  if (ligaObligatoria && !c.liga.trim()) e.liga = 'Pega la liga de la clase.';
  return e;
}

/** El cuerpo de «Guardar clase» para una clase nueva. El servidor no deja que una clase con archivo lleve liga: con liga, la clase es
 *  una liga de referencia (sin video que subir); sin ella, es una clase con archivo. Lo opcional que quedó vacío no viaja. */
export function cuerpoNuevo(c: Campos, clave: string): NuevaClase {
  const resumen = c.resumen.trim();
  const liga = c.liga.trim();
  return {
    clave,
    numero: Number(c.numero.trim()),
    titulo: c.titulo.trim(),
    origen: liga ? 'liga' : 'archivo',
    ...(resumen ? { resumen } : {}),
    ...(c.grabada_en ? { grabada_en: c.grabada_en } : {}),
    ...(liga ? { liga } : {}),
  };
}

/** Solo lo que la persona cambió; el resumen y la fecha que dejó vacíos siendo antes algo viajan como `null`. Vacío = nada cambió. */
export function cuerpoCambios(antes: Clase, c: Campos): CambiosClase {
  const cambios: CambiosClase = {};
  const numero = Number(c.numero.trim());
  if (numero !== antes.numero) cambios.numero = numero;
  if (c.titulo.trim() !== antes.titulo) cambios.titulo = c.titulo.trim();
  const opcional = (nuevo: string, viejo: string | null): string | null | undefined =>
    nuevo === (viejo ?? '') ? undefined : nuevo === '' ? null : nuevo;
  const resumen = opcional(c.resumen.trim(), antes.resumen);
  if (resumen !== undefined) cambios.resumen = resumen;
  const fecha = opcional(c.grabada_en, antes.grabada_en?.slice(0, 10) ?? null);
  if (fecha !== undefined) cambios.grabada_en = fecha;
  // la liga solo se edita en una clase que ES una liga (el servidor no deja ligas en las de archivo) y no se puede dejar vacía
  if (antes.origen === 'liga' && c.liga.trim() !== (antes.liga ?? '')) cambios.liga = c.liga.trim();
  return cambios;
}

/** El campo del formulario al que pertenece cada error del servidor (los demás van en un aviso general). */
export const CAMPO_DEL_ERROR: Record<string, keyof Campos> = {
  numero_invalido: 'numero',
  numero_repetido: 'numero',
  titulo_invalido: 'titulo',
  resumen_largo: 'resumen',
  fecha_invalida: 'grabada_en',
  liga_invalida: 'liga',
};

/** La «clave» que hace idempotente el doble clic: un UUID del navegador. */
export function claveNueva(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c && typeof c.getRandomValues === 'function' ? c.getRandomValues(new Uint8Array(16)) : Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------------------------------------------------------------------------
// El archivo, contra los límites que dijo el servidor

export const extensionDe = (nombre: string) => {
  const i = nombre.lastIndexOf('.');
  return i < 0 ? '' : nombre.slice(i).toLowerCase();
};

/** El valor de `accept` del selector de archivos, con lo que el servidor admite. */
export const aceptar = (l: LimitesClases) => [...(l.extensiones ?? []), ...(l.content_types ?? [])].join(',') || undefined;

/** Por qué este archivo no se puede subir, o null. Es una cortesía: el servidor vuelve a revisar y manda. */
export function motivoDeRechazo(archivo: File, l: LimitesClases): string | null {
  const permitidas = l.extensiones ?? [];
  if (permitidas.length && !permitidas.includes(extensionDe(archivo.name))) {
    return `Ese archivo no es de un tipo que se pueda subir. Elige un video ${permitidas.join(', ')}.`;
  }
  if (archivo.size <= 0) return 'Ese archivo está vacío. Elige otro video.';
  if (l.max_bytes && archivo.size > l.max_bytes) {
    return `Ese video pesa ${tamano(archivo.size)} y lo máximo es ${tamano(l.max_bytes)}.`;
  }
  return null;
}
