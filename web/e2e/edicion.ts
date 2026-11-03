// El estudio de mentira de la caja de «Edición» (E2): las rutas de /api/edicion que el contrato define, el «S3» de mentira (el PUT
// es del mismo origen, tarda lo que la prueba diga y sube de verdad por XHR) y la bandeja (/api/trabajos) que la prueba mueve a mano.
// Lo comparten inicio-edicion.spec.ts, inicio-edicion-union.spec.ts, inicio-recorrido.spec.ts y recorrido.ts.
// NADA de esto sale a la red ni cobra: el servidor de verdad no está.
import type { Page } from '@playwright/test';

import type { Cotizacion, LimitesDeEdicion, VideoElegible } from '../src/pantallas/inicio/envio';

/** La copia que el servidor de mentira «crea» al iniciar. */
export const COPIA = 'ed-9f1c0a7b';

export const LIMITES: LimitesDeEdicion = { max_s: 5400, min_solo_s: 60, max_videos: 12, max_bytes: 16106127360 };

/** Lo que contesta POST /api/edicion/cotizar para esas referencias: por omisión videos de 12:04 sin transcripción (✦ 2 + ✦ 6 = ✦ 8). */
export function cotizacion(refs: string[], sobre: Partial<Cotizacion> = {}): Cotizacion {
  return {
    titulo: refs.length > 1 ? `${nombreDe(refs[0]!)} + ${refs.length - 1} más` : nombreDe(refs[0] ?? ''),
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
      titulo: nombreDe(ref),
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

const nombreDe = (ref: string) => ref.split(':')[1] ?? '';

/** El mismo conjunto, ya con transcripción: solo la edición (✦ 2). */
export const conTranscripcion = (refs: string[]): Cotizacion =>
  cotizacion(refs, {
    creditos: 2,
    desglose: { edicion: 2, transcripcion: 0 },
    duracion_total_s: 72 * refs.length,
    videos: cotizacion(refs).videos.map(v => ({ ...v, duracion_s: 72, con_transcript: true, se_transcribe: false })),
  });

/** Un video de «Mis creaciones» tal como lo lista GET /api/edicion/elegibles. */
export function elegible(titulo: string, sobre: Partial<VideoElegible> = {}): VideoElegible {
  return {
    ref: `proyecto:${titulo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    tipo: 'pelicula',
    titulo,
    duracion_s: 312,
    formato: 'horizontal',
    fecha: '2026-10-08T10:00:00Z',
    miniatura: null,
    video: null,
    con_transcript: true,
    audio: true,
    bytes: 90_000_000,
    es_copia: false,
    copia_de: [],
    motivo: null,
    ...sobre,
  };
}

export const RESPUESTAS_VACIAS: Record<string, unknown> = {
  '**/api/proyectos': [],
  '**/api/slots': { slots: null, activos: 0 },
  '**/api/imagenes': { total: 0, imagenes: [] },
  '**/api/edicion/proyectos': [],
  '**/api/clip': { clips: [] },
  '**/api/moderar': { permitido: true },
};

export interface OpcionesDeEdicion {
  /** El precio del conjunto: por omisión, `cotizacion(refs)`. */
  cotizar?: (refs: string[]) => Cotizacion;
  /** Lo que lista «Elegir de Mis creaciones». */
  elegibles?: VideoElegible[];
  /** Cuánto tarda el PUT a «S3» (ms), en general o por nombre de archivo. */
  subidaMs?: number | Record<string, number>;
  /** Un saldo distinto de 120. */
  saldo?: number;
  /** Lo que contesta POST /api/edicion/iniciar (un estado y un cuerpo). Por omisión, lanzado. */
  iniciar?: (cuerpo: { pedido: string; videos: string[]; instruccion: string }) => { status: number; json: unknown };
}

/** Lo que vio el servidor de mentira, en el orden en que llegó. */
export interface Visto {
  cotizar: string[][];
  iniciar: Array<{ pedido: string; videos: string[]; instruccion: string }>;
  reintentar: string[];
  presign: Array<{ proyecto: string; archivo: string }>;
  confirmar: string[];
  /** Las fichas que devuelve /api/trabajos: la prueba las cambia y la bandeja las lee en su siguiente vuelta. */
  trabajos: { lista: unknown[] };
}

export async function simularEdicion(page: Page, o: OpcionesDeEdicion = {}): Promise<Visto> {
  const visto: Visto = { cotizar: [], iniciar: [], reintentar: [], presign: [], confirmar: [], trabajos: { lista: [] } };
  for (const [ruta, json] of Object.entries(RESPUESTAS_VACIAS)) await page.route(ruta, r => r.fulfill({ json }));
  await page.route('**/api/trabajos', r => r.fulfill({ json: { trabajos: visto.trabajos.lista, sondeo_s: 15 } }));
  if (o.saldo !== undefined) await page.route('**/api/creditos', r => r.fulfill({ json: { activo: true, saldo: o.saldo, tarifas: {}, packs: [] } }));
  await page.route('**/api/blotato', r => r.fulfill({ status: 404, json: { detail: 'no' } }));
  // lo ya subido con ese nombre: nada (si lo hubiera, la caja estrenaría un nombre nuevo para no mezclar proyectos)
  // (va primero: las rutas de config, presign y confirmar se registran después y ganan)
  await page.route(/\/api\/media\/[^/?]+$/, r => r.fulfill({ json: { subidas: [] } }));
  await page.route('**/api/media/config', r => r.fulfill({ json: { activo: true, cdn: '' } }));
  await page.route('**/api/media/presign', r => {
    const b = r.request().postDataJSON() as { proyecto: string; archivo: string; content_type: string };
    visto.presign.push({ proyecto: b.proyecto, archivo: b.archivo });
    return r.fulfill({
      json: { url: `/s3-falso/subida?a=${encodeURIComponent(b.archivo)}`, key: `videos/${b.proyecto}/subidas/${b.archivo}`, content_type: b.content_type },
    });
  });
  // el PUT a «S3» es del mismo origen para no depender de CORS; tarda un poco para poder ver la barra
  await page.route('**/s3-falso/subida*', async r => {
    const archivo = new URL(r.request().url()).searchParams.get('a') ?? '';
    const ms = typeof o.subidaMs === 'object' ? (o.subidaMs[archivo] ?? 600) : (o.subidaMs ?? 600);
    await new Promise(f => setTimeout(f, ms));
    await r.fulfill({ status: 200, body: '' });
  });
  await page.route('**/api/media/confirmar', r => {
    const b = r.request().postDataJSON() as { proyecto: string; key: string };
    visto.confirmar.push(b.key);
    return r.fulfill({ json: { archivo: b.key.split('/').pop(), cdn: '' } });
  });
  await page.route('**/api/edicion/elegibles', r => r.fulfill({ json: { videos: o.elegibles ?? [], limites: LIMITES } }));
  await page.route('**/api/edicion/cotizar', r => {
    const refs = (r.request().postDataJSON() as { videos: string[] }).videos;
    visto.cotizar.push(refs);
    return r.fulfill({ json: (o.cotizar ?? cotizacion)(refs) });
  });
  await page.route('**/api/edicion/iniciar', r => {
    const cuerpo = r.request().postDataJSON() as { pedido: string; videos: string[]; instruccion: string };
    visto.iniciar.push(cuerpo);
    if (o.iniciar) {
      const { status, json } = o.iniciar(cuerpo);
      return r.fulfill({ status, json });
    }
    return r.fulfill({
      json: { lanzado: true, nombre: COPIA, titulo: cotizacion(cuerpo.videos).titulo, creditos: 8, n_videos: cuerpo.videos.length, repetido: false },
    });
  });
  await page.route(`**/api/edicion/${COPIA}/reintentar`, r => {
    visto.reintentar.push(r.request().url());
    return r.fulfill({ json: { lanzado: true, nombre: COPIA, creditos: 2 } });
  });
  await page.route(`**/api/editar/${COPIA}`, r => r.fulfill({ json: { editar: { estado: 'corriendo' } } }));
  return visto;
}
