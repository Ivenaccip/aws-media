// Los dobles que comparten las pruebas de la caja de «Edición» (Edicion.test, EdicionUnion.test, EdicionShorts.test, Inicio.test): el
// servidor de mentira con las rutas de /api/edicion que el contrato E2 define, el PUT a S3 (XHR) que la prueba mueve a mano, y
// los videos de mentira. NADA de esto sale a la red ni cobra nada.
import { vi } from 'vitest';

import type { Cotizacion, Lanzamiento, LimitesDeEdicion } from '../pantallas/inicio/envio';
import { json, servidor, type Ruta } from './servidor';

export const TEXTO = 'Quítale las muletillas y los silencios';

/** El PUT a S3 va por XHR (para tener progreso): uno de mentira que la prueba mueve. */
export class XhrFalso {
  static todos: XhrFalso[] = [];
  metodo = '';
  url = '';
  status = 0;
  abortado = false;
  upload: { onprogress: ((ev: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    XhrFalso.todos.push(this);
  }
  open(metodo: string, url: string) {
    this.metodo = metodo;
    this.url = url;
  }
  setRequestHeader() {}
  send() {}
  abort() {
    this.abortado = true;
    this.onabort?.();
  }
  avanzar(cargados: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded: cargados, total });
  }
  terminar(status = 200) {
    this.status = status;
    this.onload?.();
  }
  /** La red se cae con el PUT en el aire. */
  fallar() {
    this.onerror?.();
  }
}
export const ultimoXhr = () => XhrFalso.todos[XhrFalso.todos.length - 1]!;

/** Pone el XHR de mentira (cada prueba lo pide en su `beforeEach`). */
export function ponerXhrFalso() {
  XhrFalso.todos = [];
  vi.stubGlobal('XMLHttpRequest', XhrFalso);
}

/** Un video de mentira: nombre, tipo y peso (el contenido no importa: el servidor de mentira no lo mira). */
export function video(nombre = 'entrevista.mp4', tipo = 'video/mp4', bytes = 824_000_000) {
  const f = new File(['x'], nombre, { type: tipo });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
}

export const LIMITES: LimitesDeEdicion = { max_s: 5400, min_solo_s: 60, max_videos: 12, max_bytes: 16106127360 };

/** Lo que contesta POST /api/edicion/cotizar para esas referencias: por omisión, videos de 12:04 sin transcripción (✦ 2 de edición
 *  + ✦ 6 de transcribir 3 bloques de 5 min = ✦ 8). `sobre` pisa lo que la prueba quiera. */
export function cotizacion(refs: string[], sobre: Partial<Cotizacion> = {}): Cotizacion {
  return {
    titulo: refs.length > 1 ? `${refs[0]!.split(':')[1]} + ${refs.length - 1} más` : (refs[0]?.split(':')[1] ?? ''),
    n_videos: refs.length,
    duracion_total_s: 724 * refs.length,
    bytes_total: 824_000_000 * refs.length,
    formato: 'horizontal',
    creditos: 8,
    desglose: { edicion: 2, transcripcion: 6 },
    ocupado: false,
    bloqueo: null,
    videos: refs.map(ref => ({
      ref,
      tipo: ref.startsWith('clip:') ? ('clip' as const) : ('edicion' as const),
      titulo: ref.split(':')[1]!,
      duracion_s: 724,
      formato: 'horizontal' as const,
      ancho: 1920,
      alto: 1080,
      audio: true,
      bytes: 824_000_000,
      con_transcript: false,
      se_transcribe: true,
    })),
    ...sobre,
  };
}

/** El mismo video que ya trae transcripción: solo la edición (✦ 2). */
export const cotizacion2 = (refs: string[]) =>
  cotizacion(refs, {
    creditos: 2,
    desglose: { edicion: 2, transcripcion: 0 },
    duracion_total_s: 72 * refs.length,
    videos: cotizacion(refs).videos.map(v => ({ ...v, duracion_s: 72, con_transcript: true, se_transcribe: false })),
  });

/** Lo que dice el servidor cuando una regla no deja editar (el mismo texto que daría «Iniciar»). */
export const cotizacionBloqueada = (refs: string[], codigo: string, texto: string) =>
  cotizacion(refs, { creditos: null, desglose: null, bloqueo: { codigo, texto } });

export const TEXTO_CORTO_SOLO = 'Un video de menos de 1 min no se puede editar solo. Agrega otro para unirlos, o sube uno de 1 a 90 min.';
export const TEXTO_FORMATOS = 'Los videos horizontales y los verticales no se mezclan. Quita los verticales o edítalos aparte.';

export const COSTO_8: Cotizacion = cotizacion(['proyecto:entrevista']);
export const COSTO_2: Cotizacion = cotizacion2(['proyecto:entrevista']);
export const FUERA: Cotizacion = cotizacionBloqueada(['proyecto:entrevista'], 'corto_solo', TEXTO_CORTO_SOLO);

/** Lo que contesta POST /api/edicion/iniciar. */
export const LANZADO: Lanzamiento = { lanzado: true, nombre: 'ed-9f1c0a7b', titulo: 'entrevista', creditos: 8, n_videos: 1, repetido: false };
/** La copia que sondea la caja tras lanzar (GET /api/editar/<copia>). */
export const COPIA = 'ed-9f1c0a7b';

export const EXITO = () => json(LANZADO);
export const SIN_SALDO = () => json({ detail: 'Créditos insuficientes: esta acción cuesta 8 créditos y tu saldo es 5.' }, 402);

/** Lo que el servidor de mentira sabe contestar. Todo lo que no se pise responde lo de siempre. */
export interface Mundo {
  /** El precio por referencias; o el servidor responde otra cosa (o tarda: una promesa). */
  cotizar?: (refs: string[]) => Cotizacion | Response | Promise<Cotizacion | Response>;
  /** Lo que el servidor ya tiene subido en ese proyecto (GET /api/media/<p>): vacío si el nombre es nuevo. */
  subidas?: (proyecto: string) => unknown[] | Response;
  presign?: Ruta;
  confirmar?: Ruta;
  /** POST /api/edicion/iniciar. */
  iniciar?: Ruta;
  /** GET /api/editar/<copia>: la corrida. */
  estado?: Ruta;
  /** GET /api/edicion/elegibles. */
  elegibles?: Ruta;
  /** GET /api/edicion/proyectos (lo que lee el sondeo cuando no se sabe la copia). */
  proyectos?: Ruta;
  moderar?: Ruta;
  config?: boolean;
}

export function montar(m: Mundo = {}) {
  return servidor({
    '/api/media/config': () => json({ activo: m.config ?? true, cdn: '' }),
    '/api/media/presign':
      m.presign ??
      ((_u, init) => {
        const b = JSON.parse(String(init?.body)) as { proyecto: string; archivo: string; content_type: string };
        return json({ url: 'https://s3.ejemplo/subida?firma=1', key: `videos/${b.proyecto}/subidas/${b.archivo}`, content_type: b.content_type });
      }),
    '/api/media/confirmar': m.confirmar ?? (() => json({ archivo: 'entrevista.mp4', cdn: '' })),
    // GET /api/media/<proyecto>: lo ya subido (la ruta más corta pierde ante config, presign y confirmar)
    '/api/media': url => {
      const r = (m.subidas ?? (() => []))(decodeURIComponent(url.split('/')[3]!));
      return r instanceof Response ? r : json({ subidas: r });
    },
    '/api/moderar': m.moderar ?? (() => json({ permitido: true })),
    '/api/edicion/elegibles': m.elegibles ?? (() => json({ videos: [], limites: LIMITES })),
    '/api/edicion/proyectos': m.proyectos ?? (() => json([])),
    '/api/edicion/cotizar': async (_u, init) => {
      const refs = (JSON.parse(String(init?.body)) as { videos: string[] }).videos;
      const c = await (m.cotizar ?? cotizacion)(refs);
      return c instanceof Response ? c : json(c);
    },
    '/api/edicion/iniciar': (u, init) => (m.iniciar ?? EXITO)(u, init),
    '/api/editar': (u, init) => (m.estado ?? (() => json({ editar: { estado: 'corriendo' } })))(u, init),
  });
}

/** Una respuesta que la prueba suelta cuando quiere (el servidor "tarda"). */
export function diferida<T>() {
  let resolver!: (v: T) => void;
  const promesa = new Promise<T>(r => (resolver = r));
  return { promesa, resolver };
}
