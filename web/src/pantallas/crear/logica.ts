// La lógica de /estudio/crear/ sin React: el contrato con /api/proyectos, los
// precios (de tools/tarifas.json, nunca calculados aquí aparte) y lo que se
// enseña en cada estado de la película. Paridad con static/crear.html.
import { ErrorApi, pedir } from '../../nucleo/api';
import { video } from '../../nucleo/tarifas';

// ── el proyecto, tal como lo sirve GET /api/proyectos/{id} ──────────────────
export type EstadoProyecto = 'creado' | 'preparando' | 'revision' | 'produciendo' | 'imagenes' | 'listo' | 'error';

export interface Opcion {
  path: string;
}

export interface Voz {
  id: string;
  nivel: 'verde' | 'amarillo' | 'rojo' | string;
  motivo: string;
}

export interface ImagenPorAprobar {
  id: string;
  archivo: string;
  planos?: number;
  narracion?: string;
  prompt?: string;
}

export interface Proyecto {
  id: string;
  estado: EstadoProyecto;
  etapa?: string | null;
  brief?: string;
  duracion_s?: number | null;
  pipeline?: string | null;
  narracion?: string | null;
  guion: { narracion?: string }[];
  personaje: { nombre?: string; descripcion?: string; opciones: Opcion[]; elegida?: number | null };
  voces: Voz[];
  voz?: string | null;
  dossier?: string | null;
  fuentes: string[];
  progreso: {
    escenas_total?: number;
    escenas_listas?: number;
    editor?: string | null;
    imagenes?: ImagenPorAprobar[];
  };
  resultado?: { mensaje?: string; link?: string } | null;
  error?: string | null;
  cobrado_producir?: number | null;
}

/** Lo mínimo para no romper la pantalla con un documento a medias. */
export function proyectoValido(d: unknown): Proyecto {
  if (!d || typeof d !== 'object' || typeof (d as { id?: unknown }).id !== 'string')
    throw new ErrorApi(500, 'El servidor mandó una película que no se entiende.', d);
  const p = d as Partial<Proyecto> & { id: string; estado: EstadoProyecto };
  return {
    ...p,
    guion: Array.isArray(p.guion) ? p.guion : [],
    personaje: {
      ...(p.personaje ?? {}),
      opciones: Array.isArray(p.personaje?.opciones) ? p.personaje.opciones : [],
    },
    voces: Array.isArray(p.voces) ? p.voces : [],
    fuentes: Array.isArray(p.fuentes) ? p.fuentes : [],
    progreso: p.progreso ?? {},
  };
}

export const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ── los precios: SOLO tools/tarifas.json (video.preparar, video.por_duracion)
/** Lo que cobra «Generar»: la historia y el personaje. */
export const PREPARAR: number = video.preparar;
export const TARIFA_IMAGEN: number = video.imagen;
const POR_DURACION: Record<string, number> = video.por_duracion;

/** Las duraciones que acepta el servidor: las llaves de la tabla, en orden. */
export const DURACIONES: number[] = Object.keys(POR_DURACION)
  .map(Number)
  .filter(Number.isFinite)
  .sort((a, b) => a - b);

/** El precio TOTAL (guion + producción) de una duración; null si no está en la tabla. */
export function precioDe(s: number | null | undefined): number | null {
  if (s == null) return null;
  const n = POR_DURACION[String(s)];
  return typeof n === 'number' ? n : null;
}

/** Lo que cobra producir (y reintentar): el total menos lo ya pagado del guion. */
export function costoProducir(s: number | null | undefined): number | null {
  const t = precioDe(s);
  return t == null ? null : t - PREPARAR;
}

/** La duración elegible más cercana (una tabla nueva puede mover la elegida). */
export function cercana(s: number): number {
  return DURACIONES.reduce((a, b) => (Math.abs(b - s) < Math.abs(a - s) ? b : a), DURACIONES[0]!);
}

export function moverDuracion(s: number, pasos: number): number {
  const i = DURACIONES.indexOf(cercana(s));
  return DURACIONES[Math.max(0, Math.min(DURACIONES.length - 1, i + pasos))]!;
}

export const mss = (s: number) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

export const duracionEnPalabras = (s: number) =>
  s % 60 ? s + ' segundos' : s / 60 + (s > 60 ? ' minutos' : ' minuto');

/** La nota bajo «Generar»: qué se cobra ahora y qué al producir. */
export function notaCobro(s: number): string | null {
  const total = precioDe(s);
  if (total == null) return null;
  return (
    'Ahora se cobran ' + PREPARAR + ' créditos por la historia y el personaje; los otros ' +
    (total - PREPARAR) + ', al producir, cuando apruebes el guion.'
  );
}

/** Si el saldo alcanza para el guion pero no para toda la película, se dice antes. */
export function avisoSaldo(saldo: number | null, s: number): string | null {
  const total = precioDe(s);
  if (saldo == null || total == null || saldo < PREPARAR || total <= saldo) return null;
  return 'Te alcanza para el guion; para producir te faltarán ' + (total - saldo) + ' créditos (saldo: ' + saldo + ').';
}

// ── el formulario ──────────────────────────────────────────────────────────
export type Modo = 'auto' | 'investigacion' | 'idea';
export type Formato = 'horizontal' | 'vertical';

export const MAX_BRIEF = 5000;
export const MAX_REFS = 4;
export const DURACION_INICIAL = 30;

export const MODONOTAS: Record<Modo, string> = {
  auto: 'Detectamos si tu texto es una historia lista o una idea que investigar.',
  investigacion: 'Investigamos el tema con fuentes y escribimos el guion.',
  idea: 'Tu texto se corta en escenas tal cual; tú lo revisas antes de producir.',
};

export const modoValido = (m: string | null | undefined): Modo =>
  m === 'investigacion' || m === 'idea' ? m : 'auto';

export interface Estilo {
  id: string;
  nombre: string;
  descripcion?: string;
}

export const cargarEstilos = () => pedir<Estilo[]>('/api/estilos');

export interface Pedido {
  brief: string;
  estilo: string;
  estilo_custom: string;
  duracion_s: number;
  modo: Modo;
  rubro: string;
  personaje_extra: string;
  formato: Formato;
  /** M11: el A/B del pipeline, si la URL trae ?pipeline=. */
  pipeline: string | null;
  referencias: File[];
}

export function armarForm(p: Pedido, forzar: boolean): FormData {
  const fd = new FormData();
  fd.append('brief', p.brief);
  fd.append('estilo', p.estilo);
  fd.append('estilo_custom', p.estilo_custom);
  fd.append('duracion_s', String(p.duracion_s));
  fd.append('modo', p.modo);
  fd.append('rubro', p.rubro);
  fd.append('personaje_extra', p.personaje_extra);
  fd.append('formato', p.formato);
  if (forzar) fd.append('forzar', 'true');
  if (p.pipeline) fd.append('pipeline', p.pipeline);
  p.referencias.forEach(f => fd.append('referencias', f));
  return fd;
}

/** El 409 de crear: sin espacio (hay que archivar) o el tema no es del rubro. */
export type Choque = { slots: true; aviso: string } | { slots: false; balanceador: string };

export function choqueDe(detalle: unknown): Choque {
  const d = (detalle && typeof detalle === 'object' ? detalle : {}) as { slots?: unknown; aviso?: unknown; balanceador?: unknown };
  if (d.slots) return { slots: true, aviso: typeof d.aviso === 'string' && d.aviso ? d.aviso : 'No tienes espacio para otra película.' };
  return {
    slots: false,
    balanceador: typeof d.balanceador === 'string' && d.balanceador ? d.balanceador : 'El tema no parece de tu rubro.',
  };
}

/** POST /api/proyectos es multipart (las imágenes del personaje): pedir() solo habla JSON. */
export async function crearProyecto(fd: FormData): Promise<Proyecto> {
  let r: Response;
  try {
    r = await fetch('/api/proyectos', { method: 'POST', body: fd, headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new ErrorApi(0, 'No se pudo crear la película. Revisa tu conexión e inténtalo otra vez.', e);
  }
  const tipo = r.headers.get('Content-Type') ?? '';
  const datos: unknown = tipo.includes('application/json') ? await r.json() : await r.text();
  if (!r.ok) {
    const det = datos && typeof datos === 'object' && 'detail' in datos ? (datos as { detail: unknown }).detail : datos;
    const msg = typeof det === 'string' && det.trim() ? det : 'Algo salió mal (HTTP ' + r.status + ').';
    throw new ErrorApi(r.status, msg, det);
  }
  return proyectoValido(datos);
}

/** Las imágenes que entran al cuadro: solo imágenes y hasta MAX_REFS. */
export function sumarArchivos(ya: File[], nuevos: File[]): { lista: File[]; fuera: number } {
  const imgs = nuevos.filter(f => f.type.startsWith('image/'));
  const cupo = Math.max(0, MAX_REFS - ya.length);
  return { lista: ya.concat(imgs.slice(0, cupo)), fuera: Math.max(0, imgs.length - cupo) };
}

export const avisoFuera = (fuera: number) =>
  'Caben ' + MAX_REFS + ' imágenes del personaje; ' + fuera + (fuera === 1 ? ' se quedó' : ' se quedaron') + ' fuera.';

// ── el camino del proyecto ─────────────────────────────────────────────────
const P = (id: string) => '/api/proyectos/' + encodeURIComponent(id);
const json = (d: unknown) => proyectoValido(d);

export const cargar = (id: string) => pedir<unknown>(P(id)).then(json);
export const guardarGuion = (id: string, cuerpo: CuerpoGuion) =>
  pedir<unknown>(P(id) + '/guion', { metodo: 'PUT', cuerpo });
export const guardarPersonaje = (id: string, elegida: number, nombre: string) =>
  pedir<unknown>(P(id) + '/personaje', { metodo: 'PUT', cuerpo: { elegida, nombre } });
export const generarOpciones = (id: string) => pedir<unknown>(P(id) + '/personaje/generar', { metodo: 'POST' }).then(json);
export const modificarPersonaje = (id: string, instruccion: string, opcion: number) =>
  pedir<unknown>(P(id) + '/personaje/modificar', { cuerpo: { instruccion, opcion } }).then(json);
export const producir = (id: string, aprobarImagenes: boolean | null) =>
  pedir<unknown>(P(id) + '/producir' + (aprobarImagenes == null ? '' : '?aprobar_imagenes=' + aprobarImagenes), {
    metodo: 'POST',
  }).then(json);
export const animar = (id: string) => pedir<unknown>(P(id) + '/animar', { metodo: 'POST' }).then(json);
export const cancelar = (id: string) =>
  pedir<{ proyecto: unknown; devueltos?: number }>(P(id) + '/cancelar', { metodo: 'POST' }).then(d => ({
    proyecto: json(d.proyecto),
    devueltos: typeof d.devueltos === 'number' ? d.devueltos : 0,
  }));
export const regenerarImagen = (id: string, esc: string, prompt: string) =>
  pedir<unknown>(P(id) + '/imagenes/' + encodeURIComponent(esc) + '/regenerar', {
    cuerpo: { prompt, confirmar: true },
  }).then(json);
export const reabrir = (id: string) => pedir<unknown>(P(id) + '/reabrir', { metodo: 'POST' }).then(json);

export interface Estimacion {
  creditos?: number | null;
  creditos_saldo?: number | null;
  minutos?: number | null;
  total?: number | null;
}

export const estimar = (id: string, escenas: string[], senal?: AbortSignal) =>
  pedir<Estimacion>(P(id) + '/estimacion', { cuerpo: { escenas }, ...(senal ? { senal } : {}) });

export const archivo = (id: string, ruta: string) => P(id) + '/archivo/' + ruta;
/** La ruta de una opción de personaje: las dos últimas partes de su path. */
export const rutaOpcion = (path: string) => path.split(/[\\/]/).slice(-2).join('/');
export const muestraVoz = (id: string) => '/api/voces/' + encodeURIComponent(id) + '/muestra';

/** Un href con javascript: se ejecuta al hacer clic: solo se pintan http(s). */
export const esHttp = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u);

// ── el guion ───────────────────────────────────────────────────────────────
export const esNarracion = (p: Pick<Proyecto, 'pipeline'>) => p.pipeline === 'narracion';

export type CuerpoGuion = { narracion: string; voz: string | null } | { escenas: string[]; voz: string | null };

export const limpias = (escenas: string[]) => escenas.map(t => t.trim()).filter(Boolean);

export function cuerpoGuion(narracion: boolean, textos: string[], voz: string | null): CuerpoGuion {
  const l = limpias(textos);
  return narracion ? { narracion: l[0] ?? '', voz } : { escenas: l, voz };
}

export const palabras = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** Más de 14 palabras obliga a partir la escena (y cuesta más). */
export const LIMITE_ESCENA = 14;

export function metaEscena(t: string): { texto: string; aviso: boolean } {
  const w = palabras(t);
  return { texto: w + ' pal · ' + Math.round(w / 2) + ' s', aviso: w > LIMITE_ESCENA };
}

export function textoEstimado(narracion: boolean, textos: string[], objetivo: number | null | undefined): string {
  const l = limpias(textos);
  const w = palabras(l.join(' '));
  const obj = ' (objetivo ' + (objetivo ?? '?') + ' s)';
  return narracion
    ? w + ' palabras · ≈ ' + Math.round(w / 1.9) + ' s de narración' + obj
    : l.length + ' escenas · ' + w + ' palabras · ≈ ' + Math.round(w / 2.3) + ' s de narración' + obj;
}

/** Los textos del guion que hay en el proyecto (para empezar a editar). */
export const textosDe = (p: Proyecto): string[] =>
  esNarracion(p) ? [p.narracion ?? ''] : p.guion.map(e => e.narracion ?? '');

export const NIVEL: Record<string, string> = { verde: 'Encaja', amarillo: 'Tal vez', rojo: 'No encaja' };

/** Sin recomendación del servidor queda una voz: nunca un selector vacío. */
export const vocesDe = (p: Proyecto): Voz[] =>
  p.voces.length ? p.voces : [{ id: 'George', nivel: 'amarillo', motivo: 'sin recomendación' }];

export function vozInicial(p: Proyecto): string {
  const l = vocesDe(p);
  return p.voz && l.some(v => v.id === p.voz) ? p.voz : l[0]!.id;
}

// ── el progreso ────────────────────────────────────────────────────────────
export const EN_MARCHA: EstadoProyecto[] = ['creado', 'preparando', 'produciendo'];
/** Donde el sondeo se para: la película espera al usuario o ya acabó. */
export const TERMINAL: EstadoProyecto[] = ['revision', 'imagenes', 'listo', 'error'];
export const enMarcha = (p: Proyecto) => EN_MARCHA.includes(p.estado);

const ETAPAS_PREP: Record<string, number> = { inicio: 5, clasificar: 15, research: 30, guion: 50, editor: 62, voz: 72, personaje: 85 };
// encolado, imagenes y puente faltaban en la vieja (caían al 5 % y la barra
// se quedaba quieta, que nunca retrocede): aquí van en su sitio
const ETAPAS_PROD: Record<string, number> = {
  encolado: 2, inicio: 3, casting: 8, director: 15, tts: 25, alinear: 30, imagenes: 35, media: 40, concat: 90, drive: 96, puente: 98,
};

/** M3: las etapas con nombre humano; los códigos internos no salen a la pantalla. */
export const ETAPA_TXT: Record<string, string> = {
  inicio: 'Arrancando', clasificar: 'Leyendo tu texto', research: 'Investigando fuentes',
  guion: 'Escribiendo el guion', editor: 'Puliendo las escenas', voz: 'Eligiendo voces',
  personaje: 'Dibujando las opciones de personaje', casting: 'Preparando la voz elegida',
  director: 'Planeando las tomas', tts: 'Grabando la narración', alinear: 'Sincronizando la voz',
  media: 'Generando las escenas', concat: 'Uniendo la película', drive: 'Guardando el resultado',
  encolado: 'En la fila', imagenes: 'Dibujando las imágenes', puente: 'Preparando el editor',
};

export interface Paso {
  falta: string;
  activo?: string;
  hecho?: string;
  etapas: string[];
}

// UI·11 · carta §8: cada paso agrupa etapas, así que el orden distinto de
// narración (tts antes del director) no mueve nada.
export const PASOS_PREP: Paso[] = [
  { falta: 'Entender tu idea', activo: 'Entendiendo tu idea', hecho: 'Idea entendida', etapas: ['inicio', 'clasificar', 'research'] },
  { falta: 'Escribir el guion', activo: 'Escribiendo el guion', hecho: 'Guion escrito', etapas: ['guion', 'editor'] },
  { falta: 'Elegir voz y personaje', activo: 'Eligiendo voz y personaje', hecho: 'Voz y personaje listos', etapas: ['voz', 'personaje'] },
  { falta: 'Tú revisas el guion', etapas: [] },
];
export const PASOS_PROD: Paso[] = [
  { falta: 'Aprobar el guion', hecho: 'Guion aprobado', etapas: [] },
  { falta: 'Grabar la voz', activo: 'Grabando la voz', hecho: 'Voz grabada', etapas: ['encolado', 'inicio', 'casting', 'director', 'tts', 'alinear'] },
  { falta: 'Animar las escenas', activo: 'Animando las escenas', hecho: 'Escenas animadas', etapas: ['imagenes', 'media'] },
  { falta: 'Unir el video', activo: 'Uniendo el video', hecho: 'Video unido', etapas: ['concat', 'drive', 'puente'] },
];

export const pasoDe = (pasos: Paso[], etapa: string | null | undefined) =>
  pasos.findIndex(x => x.etapas.includes(etapa ?? ''));

/** Lo que ya se enseñó en esta fase: la barra y los pasos nunca retroceden. */
export interface Avance {
  estado: string;
  pct: number;
  paso: number;
}

export const SIN_AVANCE: Avance = { estado: '', pct: 0, paso: 0 };

export function avanceDe(p: Proyecto, prev: Avance): Avance {
  const prod = p.estado === 'produciendo';
  const base = p.estado === prev.estado ? prev : SIN_AVANCE;
  let pct = (prod ? ETAPAS_PROD : ETAPAS_PREP)[p.etapa ?? ''] ?? 5;
  const total = p.progreso.escenas_total;
  if (prod && p.etapa === 'media' && total) pct = 40 + (50 * (p.progreso.escenas_listas || 0)) / total;
  const i = pasoDe(prod ? PASOS_PROD : PASOS_PREP, p.etapa);
  return {
    estado: p.estado,
    pct: Math.max(pct, base.pct),
    paso: Math.max(i < 0 ? (prod ? 1 : 0) : i, base.paso),
  };
}

export function etiquetaEtapa(p: Proyecto): string {
  const total = p.progreso.escenas_total;
  return (
    (ETAPA_TXT[p.etapa ?? ''] || p.etapa || 'Trabajando') +
    (total ? ' · ' + (p.progreso.escenas_listas || 0) + '/' + total + ' escenas' : '')
  );
}

/** «Faltan unos N min»: la estimación repartida según la barra; sin cifra, nada. */
export function textoFalta(minutos: number | null, pct: number): string | null {
  if (!minutos) return null;
  const n = Math.round((minutos * (100 - pct)) / 100);
  return n <= 1 ? 'Falta alrededor de un minuto.' : 'Faltan unos ' + n + ' min.';
}

// ── el error ───────────────────────────────────────────────────────────────
/** El mismo criterio que Proyecto.tiene_guion() + url_elegida del servidor. */
export function fallaAlProducir(p: Proyecto): boolean {
  const hayTexto =
    esNarracion(p) && (p.narracion || '').trim() ? true : p.guion.some(e => (e.narracion || '').trim());
  const e = p.personaje.elegida;
  const hayPersonaje = e != null && e < p.personaje.opciones.length;
  return !!(hayTexto && hayPersonaje);
}

/** Lo que el worker devolvió: lo cobrado al producir, o el guion. */
export function devuelto(p: Proyecto, alProducir: boolean): number | null {
  return alProducir ? (p.cobrado_producir ?? costoProducir(p.duracion_s)) : PREPARAR;
}

export function hrefEmpezar(brief: string | null | undefined): string {
  const b = (brief ?? '').slice(0, MAX_BRIEF);
  return '/estudio/crear/' + (b ? '?' + new URLSearchParams({ brief: b }).toString() : '');
}
