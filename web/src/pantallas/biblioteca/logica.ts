// La Biblioteca de prompts sin React (Ajustes 3, 16-oct-2026): lo que habla con /api/biblioteca, lo que busca, filtra y cuenta, lo
// que fija y ordena (el top 3 de cada quien), y la dirección de «Llevar a la caja». Todo lo que se puede probar sin pintar vive aquí
// (Biblioteca.test.tsx y useFijados.test.tsx lo ejercitan por la pantalla; este archivo no sabe de React).
//
// El API (contrato, §2): UNA carga trae todo —las categorías, «De la casa», «Míos» y el orden de los fijados—, y con decenas de
// prompts la búsqueda se hace en el navegador. Los errores traen `detail` como OBJETO {codigo, texto}: el `texto` ya está listo
// para mostrarse (nucleo/api.ts lo lee), y el `codigo` es el caso.
import { ErrorApi, pedir } from '../../nucleo/api';

export type Llevable = 'imagen' | 'video';
export type Ambito = 'casa' | 'mios';

/** Con qué lista abre la pantalla: COI enlaza a `?ver=mios` («Ver en Míos» tras Guardar); cualquier otra cosa es «De la casa». */
export const ambitoDeLaDireccion = (busqueda: string): Ambito => (new URLSearchParams(busqueda).get('ver') === 'mios' ? 'mios' : 'casa');

export interface Categoria {
  clave: string;
  nombre: string;
}

export interface Prompt {
  id: string;
  titulo: string;
  /** Vacío en los «Míos» (se guardan con título y prompt nada más). */
  para_que: string;
  prompt: string;
  categoria: string;
  etiquetas: string[];
  /** A qué caja se puede llevar: solo Imagen y Video; Guion e Investigación solo se copian. Siempre null en los «Míos». */
  lleva_a: Llevable | null;
  /** Solo en los «Míos»: de dónde salió (`coi`) y cuándo. */
  origen?: string;
  creado?: string;
}

export interface Limites {
  fijados: number;
  mios: number;
  titulo: number;
  prompt: number;
}

export interface Listado {
  categorias: Categoria[];
  casa: Prompt[];
  mios: Prompt[];
  fijados: string[];
  limites: Limites;
}

/** Lo que dice el contrato si la respuesta no trae los límites. */
const LIMITES: Limites = { fijados: 3, mios: 100, titulo: 80, prompt: 16000 };

// ---------------------------------------------------------------------------
// leer lo que llega: el servidor manda, pero un campo que falta no tira la pantalla

const texto = (v: unknown): string => (typeof v === 'string' ? v : '');
const lista = <T>(v: unknown, quien: (x: unknown) => T | null): T[] =>
  Array.isArray(v) ? v.flatMap(x => { const r = quien(x); return r ? [r] : []; }) : [];

function leerPrompt(x: unknown): Prompt | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const id = texto(o.id);
  if (!id || !texto(o.prompt)) return null;
  const lleva = o.lleva_a === 'imagen' || o.lleva_a === 'video' ? o.lleva_a : null;
  const p: Prompt = {
    id,
    titulo: texto(o.titulo) || 'Sin título',
    para_que: texto(o.para_que),
    prompt: texto(o.prompt),
    categoria: texto(o.categoria),
    etiquetas: lista(o.etiquetas, e => (typeof e === 'string' && e.trim() ? e.trim() : null)),
    lleva_a: lleva,
  };
  if (typeof o.origen === 'string') p.origen = o.origen;
  if (typeof o.creado === 'string') p.creado = o.creado;
  return p;
}

function leerCategoria(x: unknown): Categoria | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  return texto(o.clave) ? { clave: texto(o.clave), nombre: texto(o.nombre) || texto(o.clave) } : null;
}

export function leerListado(crudo: unknown): Listado {
  const o = (crudo && typeof crudo === 'object' ? crudo : {}) as Record<string, unknown>;
  const l = (o.limites && typeof o.limites === 'object' ? o.limites : {}) as Record<string, unknown>;
  const num = (v: unknown, defecto: number) => (typeof v === 'number' && v > 0 ? v : defecto);
  const casa = lista(o.casa, leerPrompt);
  const mios = lista(o.mios, leerPrompt).map(p => ({ ...p, lleva_a: null }));
  const ids = new Set([...casa, ...mios].map(p => p.id));
  const vistos = new Set<string>();
  return {
    categorias: lista(o.categorias, leerCategoria),
    casa,
    mios,
    // solo ids que existen y sin repetir: un fijado huérfano no abre nada
    fijados: lista(o.fijados, i => {
      if (typeof i !== 'string' || !ids.has(i) || vistos.has(i)) return null;
      vistos.add(i);
      return i;
    }),
    limites: {
      fijados: num(l.fijados, LIMITES.fijados),
      mios: num(l.mios, LIMITES.mios),
      titulo: num(l.titulo, LIMITES.titulo),
      prompt: num(l.prompt, LIMITES.prompt),
    },
  };
}

// ---------------------------------------------------------------------------
// el API

export const cargar = async (): Promise<Listado> => leerListado(await pedir<unknown>('/api/biblioteca'));

/** REEMPLAZA la lista de fijados; el orden importa (es el orden del top 3). `esperada` es la lista que esta pantalla cree vigente: si
 *  otra pestaña o aparato la cambió, el servidor no escribe y contesta 409 `cambiaron` con la lista vigente (ver `vigentesDe`). */
export const guardarFijados = (ids: string[], esperada: string[]) =>
  pedir<{ fijados: string[] }>('/api/biblioteca/fijados', { metodo: 'PUT', cuerpo: { ids, esperada } });

/** La lista vigente que trae un 409 `cambiaron`, o null si el error es de otra cosa (o no trae una lista legible). */
export function vigentesDe(e: unknown): string[] | null {
  if (codigoDe(e) !== 'cambiaron') return null;
  const f = ((e as ErrorApi).detalle as { fijados?: unknown }).fijados;
  return Array.isArray(f) && f.every(i => typeof i === 'string') ? (f as string[]) : null;
}

export const borrarMio = (id: string) =>
  pedir<{ ok: boolean }>(`/api/biblioteca/mios/${encodeURIComponent(id)}`, { metodo: 'DELETE' });

/** El `codigo` de un error del API de la Biblioteca (`detail.codigo`), o null si no trae uno. */
export function codigoDe(e: unknown): string | null {
  if (!(e instanceof ErrorApi) || !e.detalle || typeof e.detalle !== 'object') return null;
  const c = (e.detalle as { codigo?: unknown }).codigo;
  return typeof c === 'string' ? c : null;
}

export const textoDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------
// buscar y filtrar: sin acentos ni mayúsculas, sobre título, para qué sirve, etiquetas y categoría

/** «Ilustración» y «ilustracion» son la misma palabra. */
export const normalizar = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const TODAS = 'todas';

export interface Filtro {
  q: string;
  /** La clave de una categoría, o `TODAS`. */
  categoria: string;
  /** Una etiqueta (se llega a ella desde el detalle), o ''. */
  etiqueta: string;
}

export const SIN_FILTRO: Filtro = { q: '', categoria: TODAS, etiqueta: '' };

export const hayFiltro = (f: Filtro): boolean => Boolean(f.q.trim() || f.categoria !== TODAS || f.etiqueta);

/** Lo que pasa la búsqueda y la etiqueta, MIRANDO TODAS las categorías: de aquí salen los números de los chips. */
export function porTexto(items: readonly Prompt[], f: Filtro, categorias: readonly Categoria[]): Prompt[] {
  const palabras = normalizar(f.q).split(/\s+/).filter(Boolean);
  const etiqueta = normalizar(f.etiqueta);
  const nombre = (clave: string) => categorias.find(c => c.clave === clave)?.nombre ?? '';
  return items.filter(p => {
    if (etiqueta && !p.etiquetas.some(e => normalizar(e) === etiqueta)) return false;
    if (!palabras.length) return true;
    const pajar = normalizar([p.titulo, p.para_que, p.etiquetas.join(' '), nombre(p.categoria), p.categoria].join(' '));
    return palabras.every(w => pajar.includes(w));
  });
}

export function filtrar(items: readonly Prompt[], f: Filtro, categorias: readonly Categoria[]): Prompt[] {
  return porTexto(items, f, categorias).filter(p => f.categoria === TODAS || p.categoria === f.categoria);
}

/** «14 prompts» · «3 resultados para «mesa» en Video con #producto» · «Sin resultados para «x»». */
export function resumenDeLista(n: number, f: Filtro, categorias: readonly Categoria[]): string {
  if (!hayFiltro(f)) return n === 1 ? '1 prompt' : `${n} prompts`;
  let t = n === 0 ? 'Sin resultados' : n === 1 ? '1 resultado' : `${n} resultados`;
  if (f.q.trim()) t += ` para «${f.q.trim()}»`;
  if (f.categoria !== TODAS) t += ` en ${categorias.find(c => c.clave === f.categoria)?.nombre ?? f.categoria}`;
  if (f.etiqueta) t += ` con #${f.etiqueta}`;
  return t;
}

// ---------------------------------------------------------------------------
// fijar: el top de cada quien. Nada sustituye en silencio.

export const textoTope = (tope: number): string =>
  `Ya tienes ${tope} ${tope === 1 ? 'fijado' : 'fijados'}. Quita uno para fijar este.`;

export type Fijar = { ok: true; ids: string[] } | { ok: false; texto: string };

/** Agrega `id` al final de los fijados. Con el tope lleno NO cambia nada: avisa. Fijar uno que ya está lo deja como está. */
export function fijar(ids: readonly string[], id: string, tope: number): Fijar {
  if (ids.includes(id)) return { ok: true, ids: [...ids] };
  if (ids.length >= tope) return { ok: false, texto: textoTope(tope) };
  return { ok: true, ids: [...ids, id] };
}

export const quitar = (ids: readonly string[], id: string): string[] => ids.filter(i => i !== id);

/** Sube (-1) o baja (+1) un fijado un lugar; en los extremos, no cambia nada. */
export function mover(ids: readonly string[], id: string, paso: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + paso;
  if (i < 0 || j < 0 || j >= ids.length) return [...ids];
  const nueva = [...ids];
  [nueva[i], nueva[j]] = [nueva[j]!, nueva[i]!];
  return nueva;
}

export const mismos = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------------------------------------------------------------------------
// llevar a la caja: nunca crea ni cobra, solo abre el Inicio con el texto puesto

/** Más largo que esto solo se copia (contrato, §4). */
export const MAX_LLEVAR = 1800;
/** Y la dirección entera no pasa de esto (con tildes, cada letra pesa hasta 6 al escribirla en una URL). */
const MAX_URL = 6000;

/** A dónde lleva cada caja. Plan B del contrato, si el Inicio no pudiera leerlo: `/estudio/imagenes/` con `prompt` y `/estudio/clip/` con `brief`. */
const DESTINO: Record<Llevable, { ruta: string; param: string; pestana: string }> = {
  imagen: { ruta: '/estudio/inicio/', param: 'prompt', pestana: 'Imagen' },
  video: { ruta: '/estudio/inicio/', param: 'brief', pestana: 'Video' },
};

export const pestanaDe = (l: Llevable): string => DESTINO[l].pestana;

/** La dirección de «Llevar a la caja», o null si ese prompt solo se copia (Guion, Investigación, los «Míos», o uno demasiado largo). */
export function urlDeLlevar(p: Pick<Prompt, 'lleva_a' | 'prompt'>): string | null {
  if (!p.lleva_a || !p.prompt.trim() || p.prompt.length > MAX_LLEVAR) return null;
  const d = DESTINO[p.lleva_a];
  const url = `${d.ruta}?${d.param}=${encodeURIComponent(p.prompt)}`;
  return url.length > MAX_URL ? null : url;
}

/** ¿Tiene a dónde llevarse en principio, aunque por el largo ya no? Para decir por qué falta el botón. */
export const sePuedeLlevar = (p: Pick<Prompt, 'lleva_a'>): boolean => p.lleva_a !== null;

/** El prompt partido en lo que es texto y lo que es hueco por llenar: lo que va entre [corchetes]. */
export function partesDe(prompt: string): { texto: string; hueco: boolean }[] {
  return prompt
    .split(/(\[[^\]\n]+\])/)
    .filter(Boolean)
    .map(t => ({ texto: t, hueco: /^\[[^\]\n]+\]$/.test(t) }));
}

// ---------------------------------------------------------------------------
// copiar: la API moderna, el método viejo y, si ninguno, el texto queda seleccionado (lo dice quien llama)

export async function copiarTexto(contenido: string): Promise<boolean> {
  try {
    // sin contexto seguro `navigator.clipboard` no existe
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(contenido);
      return true;
    }
  } catch {
    /* el navegador la negó: se prueba el método viejo */
  }
  return copiarComoAntes(contenido);
}

function copiarComoAntes(contenido: string): boolean {
  const foco = document.activeElement;
  const ta = document.createElement('textarea');
  ta.value = contenido;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
  document.body.appendChild(ta);
  try {
    ta.select();
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
    if (foco instanceof HTMLElement) foco.focus();
  }
}
