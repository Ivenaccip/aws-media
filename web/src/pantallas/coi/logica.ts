// COI (Contexto · Objetivo · Instrucciones) sin React: los tipos de /api/coi y lo que la pantalla calcula (contador,
// cuánto falta para que se renueve, el título que se propone al guardar, el texto que se copia, cómo se lee el error).
//
// Lo que la persona escribe y lo que la IA responde NO se guardan en ningún lado: ni en el navegador (nada de
// localStorage ni sessionStorage, y por eso las llamadas de aquí NO usan `apartar`) ni en el servidor. Ver docs/migracion/coi.md.
import { ErrorApi, pedir } from '../../nucleo/api';

/** Lo que dice `GET /api/coi/estado`. `renueva_en_s` lo calcula el SERVIDOR (hasta la medianoche de México): la web nunca lo
 *  saca del reloj ni de la zona horaria del navegador. */
export interface EstadoUso {
  tope: number;
  usos: number;
  quedan: number;
  renueva_en_s: number;
  se_renueva: string;
  en_curso: boolean;
  gratis: boolean;
}

export interface Coi {
  /** Cada bloque va SIN su encabezado. Los tres son null cuando la respuesta no trajo la estructura. */
  contexto: string | null;
  objetivo: string | null;
  instrucciones: string | null;
  /** Lo que respondió el modelo, entero. */
  completo: string;
  estructura_ok: boolean;
}

export interface RespuestaCoi {
  coi: Coi;
  idioma: 'es' | 'en';
  tope: number;
  usos: number;
  quedan: number;
  renueva_en_s: number;
  se_renueva: string;
}

/** Los textos máximos del contrato (server/coi_api.py y server/biblioteca_api.py). */
export const MAX_TEXTO = 2000;
export const MAX_TITULO = 80;

export const CATEGORIAS = [
  { clave: 'guion', nombre: 'Guion y texto' },
  { clave: 'imagen', nombre: 'Imagen' },
  { clave: 'video', nombre: 'Video' },
  { clave: 'investigacion', nombre: 'Investigación' },
] as const;
export type Categoria = (typeof CATEGORIAS)[number]['clave'];

export const cargarEstado = (senal?: AbortSignal) =>
  pedir<EstadoUso>('/api/coi/estado', senal ? { senal } : {});

export const armarCoi = (texto: string, senal?: AbortSignal) =>
  pedir<RespuestaCoi>('/api/coi', { metodo: 'POST', cuerpo: { texto }, ...(senal ? { senal } : {}) });

export interface PromptGuardado {
  id: string;
  titulo: string;
  categoria: string;
}

export interface Guardado {
  titulo: string;
  prompt: string;
  categoria: Categoria;
  /** 32 hex por intento: repetir la misma no crea otro registro (doble clic, reintento). */
  clave: string;
}

export const guardarEnMios = (g: Guardado) =>
  pedir<{ prompt: PromptGuardado }>('/api/biblioteca/mios', {
    metodo: 'POST',
    cuerpo: { titulo: g.titulo, prompt: g.prompt, para_que: '', categoria: g.categoria, etiquetas: [], origen: 'coi', clave: g.clave },
  });

/** Una clave de 32 hex, aleatoria, para un intento de guardar. */
export function claveAleatoria(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Contador

export function contadorTexto(quedan: number, tope: number): string {
  if (quedan <= 0) return `Ya usaste tus ${tope} de hoy`;
  if (quedan === 1) return `Te queda 1 de ${tope} hoy`;
  return `Te quedan ${quedan} de ${tope} hoy`;
}

/** «Faltan 5 h 20 min» a partir de los segundos que dice el servidor. Los minutos se redondean hacia ARRIBA: nunca dice «0 min»
 *  con medio minuto por delante. */
export function faltanTexto(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  if (s < 60) return 'Falta menos de 1 min';
  const total = Math.ceil(s / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `Faltan ${m} min`;
  return m === 0 ? `Faltan ${h} h` : `Faltan ${h} h ${m} min`;
}

/** ¿Dos `se_renueva` del servidor hablan de la misma medianoche? Se comparan como instantes, no como texto («-06:00» y «Z» pueden decir lo
 *  mismo); si alguno no se puede leer, como texto. No consulta el reloj del navegador. */
export function mismaRenovacion(a: string, b: string): boolean {
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isNaN(x) || Number.isNaN(y) ? a === b : x === y;
}

/** Cuántos «usos» se pintan llenos en los puntitos del contador. */
export const puntitos = (quedan: number, tope: number): boolean[] =>
  Array.from({ length: tope }, (_, i) => i < Math.max(0, quedan));

/** Los caracteres como los cuenta el servidor (puntos de código, no unidades UTF-16: un emoji es uno). */
export const largo = (t: string): number => Array.from(t).length;

// ---------------------------------------------------------------------------
// Errores: el API manda `detail = {codigo, texto, …}` y el estado HTTP distingue la familia

export type CodigoFallo =
  | 'en_curso'
  | 'agotado'
  | 'demasiados_intentos'
  | 'moderacion'
  | 'texto_invalido'
  | 'modelo'
  | 'tardo'
  | 'no_disponible'
  | 'muy_largo'
  | 'vacio'
  | 'sin_conexion'
  | 'otro';

const CODIGOS: readonly CodigoFallo[] = [
  'en_curso',
  'agotado',
  'demasiados_intentos',
  'moderacion',
  'texto_invalido',
  'modelo',
  'tardo',
  'no_disponible',
  'muy_largo',
  'vacio',
];

export interface Fallo {
  codigo: CodigoFallo;
  /** Listo para mostrarse tal cual. */
  texto: string;
  /** Lo que el 429 (`agotado` y `demasiados_intentos`) trae: cuándo se renuevan. */
  renueva_en_s?: number;
  se_renueva?: string;
}

export function falloDe(e: unknown): Fallo {
  if (!(e instanceof ErrorApi)) return { codigo: 'otro', texto: e instanceof Error ? e.message : String(e) };
  if (e.estado === 0) return { codigo: 'sin_conexion', texto: e.message };
  const d = e.detalle;
  if (d && typeof d === 'object') {
    const o = d as Record<string, unknown>;
    const codigo = CODIGOS.find(c => c === o.codigo);
    if (codigo) {
      const f: Fallo = { codigo, texto: e.message };
      if (typeof o.renueva_en_s === 'number') f.renueva_en_s = o.renueva_en_s;
      if (typeof o.se_renueva === 'string') f.se_renueva = o.se_renueva;
      return f;
    }
  }
  return { codigo: 'otro', texto: e.message };
}

// ---------------------------------------------------------------------------
// Qué se copia y qué se propone guardar

export type ClaveBloque = 'ctx' | 'obj' | 'ins';

export const ORDEN: readonly ClaveBloque[] = ['ctx', 'obj', 'ins'];

/** Los encabezados siguen el idioma en que salió el COI: el modelo responde en el de la persona. */
export function encabezado(clave: ClaveBloque, idioma: 'es' | 'en'): string {
  const es = { ctx: '#CONTEXTO', obj: '#OBJETIVO', ins: '#INSTRUCCIONES' };
  const en = { ctx: '#CONTEXT', obj: '#OBJECTIVE', ins: '#INSTRUCTIONS' };
  return (idioma === 'en' ? en : es)[clave];
}

export function cuerpoDe(coi: Coi, clave: ClaveBloque): string {
  const t = clave === 'ctx' ? coi.contexto : clave === 'obj' ? coi.objetivo : coi.instrucciones;
  return (t ?? '').trim();
}

/** Un bloque con su encabezado (#OBJETIVO, un salto y su texto). */
export const textoDeBloque = (coi: Coi, clave: ClaveBloque, idioma: 'es' | 'en'): string =>
  `${encabezado(clave, idioma)}\n${cuerpoDe(coi, clave)}`;

/** Lo que copian «Copiar» y «Guardar»: los tres bloques en un solo texto, o lo que respondió el modelo si no trajo la estructura. */
export function textoTodo(coi: Coi, idioma: 'es' | 'en'): string {
  if (!coi.estructura_ok) return coi.completo.trim();
  return ORDEN.map(c => textoDeBloque(coi, c, idioma)).join('\n\n');
}

const SIN_MARCAS = (t: string) => t.replace(/\*\*/g, '').replace(/^[\s#*_>-]+/, '').trim();

/** El título que se propone al guardar: la primera frase del objetivo, de hasta `max` caracteres (con «…» si hubo que cortarla). */
export function primeraFrase(coi: Coi, max = MAX_TITULO): string {
  const fuente = coi.estructura_ok ? (coi.objetivo ?? '') : coi.completo;
  const linea = fuente.split('\n').map(SIN_MARCAS).find(l => l.length > 0) ?? '';
  const frase = /^.*?[.!?…](?=\s|$)/u.exec(linea)?.[0] ?? linea;
  const letras = Array.from(frase.replace(/[.\s]+$/u, '').trim());
  if (letras.length <= max) return letras.join('');
  const corte = letras.slice(0, max - 1);
  const ultimoEspacio = corte.lastIndexOf(' ');
  // corta en la última palabra entera, salvo que eso deje casi nada
  const hasta = ultimoEspacio > max * 0.5 ? corte.slice(0, ultimoEspacio) : corte;
  return hasta.join('').replace(/[\s,;:.-]+$/u, '') + '…';
}

// ---------------------------------------------------------------------------
// Cómo se ve el texto: lo que se COPIA y lo que se GUARDA es el texto tal cual salió; lo que se ve solo pierde las negritas de markdown

/** Lo que se ve en el cuadro: el texto que se copia, sin los `**` de las negritas (ahí no hay markdown que las pinte). Dentro de un
 *  bloque de código (```…```) no se toca nada: un `**kwargs` es código. */
export function textoMostrado(coi: Coi, idioma: 'es' | 'en'): string {
  let dentro = false;
  return textoTodo(coi, idioma)
    .split('\n')
    .map(l => {
      if (/^\s*```/.test(l)) {
        dentro = !dentro;
        return l;
      }
      return dentro ? l : l.replace(/\*\*/g, '');
    })
    .join('\n');
}

const ENCABEZADO = /^#(?:CONTEXTO|OBJETIVO|INSTRUCCIONES|CONTEXT|OBJECTIVE|INSTRUCTIONS)$/;

/** ¿Esta línea es el encabezado de un bloque (#CONTEXTO, #OBJECTIVE…)? Esas se pintan en negritas. */
export const esEncabezado = (linea: string): boolean => ENCABEZADO.test(linea.trim());
