// Las campañas de las pruebas de propiedades del reductor: una SESIÓN (un estado que va recibiendo acciones y
// que revisa todo tras cada una), una SECUENCIA al azar con semilla, una CAMPAÑA de muchas secuencias, y el
// MINIMIZADOR que reduce una secuencia que falla a unas pocas acciones (el `minimizar` del fuzz del mockup).
//
// Todo es determinista: la misma semilla, la misma campaña y el mismo índice dan siempre la misma secuencia de
// acciones. Como las acciones son datos con sus ids, una secuencia se reproduce tal cual, y quitándole acciones
// sigue siendo una secuencia válida (las que apuntan a algo que ya no existe no hacen nada).
//
// Solo para pruebas: nada de producción lo importa.

import { leerBorrador, serializarBorrador } from '../borrador';
import { construirFlujo } from '../exportar';
import { estadoInicial, reducir } from '../reductor';
import type { AccionConstructor as A, EstadoConstructor as E, TipoDisparador } from '../tipos';
import { gesto, memoriaNueva, recordar, type Modo } from './gestos';
import {
  contarCasos,
  cuenta,
  revisarBorrador,
  revisarDiferencial,
  revisarEstado,
  revisarExportacion,
  revisarTransicion,
  revisarVistas,
  sondearAcuerdos,
  sondearDeshacer,
  vio,
  type Contexto,
  type Dependencias,
  type Grupo,
  type Violacion,
} from './oraculos';
import { elegir, entero, mulberry32, semillaDeSecuencia } from './semilla';

/** El reductor y el exportador de verdad. */
export const DEPS_REALES: Dependencias = { reducir, construirFlujo };

/** Congela a fondo: si algo intenta modificar lo congelado, lanza (y la sesión lo cuenta como una violación). */
export function congelar<V>(v: V): V {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    for (const hijo of Object.values(v)) congelar(hijo);
    Object.freeze(v);
  }
  return v;
}

const mensaje = (x: unknown): string => (x instanceof Error ? x.message : String(x)).split('\n')[0] ?? '';

/** Cuánto se muestrea (de 0 a 1) cuando no se revisa todo: lo caro se hace en parte de los pasos. */
const P_ACUERDOS = 0.15;
const P_DIFERENCIAL = 0.25;
/** Qué tanto se recarga la página en medio de una sesión. */
const P_RECARGA = 0.015;

/**
 * Un paso de una sesión: una acción del reductor o RECARGAR la página (el estado vuelve a nacer del borrador guardado:
 * sin historial, sin selección y con el contador de ids calculado de nuevo). Recargar no es del reductor, pero es la
 * otra manera de que un estado exista, así que las secuencias también la llevan.
 */
export type Paso = A | { k: 'recargar' };

export interface OpcionesSesion {
  deps?: Dependencias;
  /** Revisar TODO en cada paso (para reproducir y minimizar). */
  completo?: boolean;
  /** La semilla del azar de los muestreos (no la de las acciones). */
  semillaMuestreo?: number;
  cobertura?: Map<string, number>;
  suaves?: Map<string, number>;
  /** Si se da, se suma aquí cuántos ms tarda cada comprobación (para ver cuál es la cara). */
  tiempos?: Map<string, number>;
  inicial?: E;
}

/** Un estado que va recibiendo acciones; tras cada una revisa todo y devuelve lo que salió mal. */
export class Sesion {
  estado: E;
  readonly ctx: Contexto;
  readonly acciones: Paso[] = [];

  constructor(op: OpcionesSesion = {}) {
    this.estado = congelar(op.inicial ?? estadoInicial());
    this.ctx = {
      deps: op.deps ?? DEPS_REALES,
      memoria: memoriaNueva(),
      instantaneas: new WeakMap(),
      validadas: new WeakSet(),
      rng: mulberry32(op.semillaMuestreo ?? 1),
      completo: op.completo ?? false,
      cobertura: op.cobertura ?? new Map(),
      suaves: op.suaves ?? new Map(),
      ...(op.tiempos ? { tiempos: op.tiempos } : {}),
    };
    recordar(this.ctx.memoria, this.estado);
  }

  /** Recarga la página: lo único que sobrevive es el borrador (si se pudo guardar). Revisa el estado que nace. */
  private recargar(): Violacion[] {
    const { ctx } = this;
    const antes = this.estado;
    this.acciones.push({ k: 'recargar' });
    const V: Violacion[] = [];
    const guardado = antes.flujo.nodes.length > 0 ? serializarBorrador(antes.flujo) : null;
    const leido = guardado?.ok ? leerBorrador(guardado.texto) : null;
    const despues = congelar(leido?.ok ? estadoInicial(leido.flujo) : estadoInicial());
    if (leido?.ok && guardado?.ok && guardado.recortes.length === 0 && JSON.stringify(despues.flujo) !== JSON.stringify(antes.flujo)) {
      V.push(vio('borrador', 'recargar-cambia-el-flujo', 'lo que vuelve del borrador no es lo que había'));
    }
    if (despues.historial.length > 0 || despues.sel !== null || despues.menu !== null || despues.conectando !== null) V.push(vio('estado', 'recargar-deja-restos', 'un estado recién nacido trae selección, menú o historial'));
    // otra vida de la página: los ids que ya no están pueden volver a salir
    ctx.memoria = memoriaNueva();
    ctx.flujoRevisado = undefined;
    ctx.flujoGuardado = undefined;
    const seguro = (nombre: string, f: () => Violacion[]) => {
      try {
        V.push(...f());
      } catch (x) {
        V.push(vio('accion', 'oraculo-lanza', `${nombre}: ${mensaje(x)}`));
      }
    };
    seguro('revisarEstado', () => revisarEstado(despues, ctx));
    seguro('revisarVistas', () => revisarVistas(despues));
    seguro('revisarExportacion', () => revisarExportacion(despues, ctx));
    seguro('revisarBorrador', () => revisarBorrador(despues, ctx));
    seguro('sondearDeshacer', () => sondearDeshacer(despues, ctx));
    cuenta(ctx.cobertura, 'recargar la página (el estado nace del borrador)');
    recordar(ctx.memoria, despues);
    this.estado = despues;
    return V;
  }

  /** Aplica un paso (una acción, o recargar) y revisa el resultado. Lista vacía = todo bien. */
  aplicar(paso: Paso): Violacion[] {
    if (paso.k === 'recargar') return this.recargar();
    const a: A = paso;
    const { ctx } = this;
    const antes = this.estado;
    this.acciones.push(a);
    congelar(a);
    let despues: E;
    try {
      despues = congelar(ctx.deps.reducir(antes, a));
    } catch (x) {
      return [vio('accion', 'accion-lanza', `${a.k}: ${mensaje(x)}`)];
    }
    const V: Violacion[] = [];
    const seguro = (nombre: string, f: () => Violacion[]) => {
      const t0 = ctx.tiempos ? performance.now() : 0;
      try {
        V.push(...f());
      } catch (x) {
        V.push(vio('accion', 'oraculo-lanza', `${nombre}: ${mensaje(x)}`));
      }
      if (ctx.tiempos) ctx.tiempos.set(nombre, (ctx.tiempos.get(nombre) ?? 0) + performance.now() - t0);
    };
    seguro('revisarEstado', () => revisarEstado(despues, ctx));
    seguro('revisarTransicion', () => revisarTransicion(antes, a, despues, ctx));
    seguro('revisarVistas', () => revisarVistas(despues));
    seguro('revisarExportacion', () => revisarExportacion(despues, ctx));
    seguro('revisarBorrador', () => revisarBorrador(despues, ctx));
    seguro('sondearDeshacer', () => sondearDeshacer(despues, ctx));
    if (ctx.completo || ctx.rng() < P_ACUERDOS) seguro('sondearAcuerdos', () => sondearAcuerdos(despues, ctx));
    if (ctx.completo || ctx.rng() < P_DIFERENCIAL) seguro('revisarDiferencial', () => revisarDiferencial(despues, ctx));
    // contar y recordar ids solo tiene sentido en un estado sano (uno roto ya quedó reportado arriba y puede no dejarse recorrer)
    if (V.length === 0) {
      contarCasos(antes, a, despues, ctx);
      recordar(ctx.memoria, despues);
    }
    this.estado = despues;
    return V;
  }
}

// ================================================================ secuencias y campañas

/** Una campaña: cuántas secuencias, de qué largo y con qué gestos. */
export interface Campana {
  /** Cómo se llama en los informes. */
  nombre: string;
  modo: Modo;
  /** Entre los textos que se teclean salen claves pegadas por error. */
  conClaves?: boolean;
  /** Cuántas secuencias por semilla. */
  n: number;
  /** El largo mínimo y máximo de cada secuencia, en acciones. */
  largo: readonly [number, number];
}

/** Algo que salió mal, con todo lo que hace falta para repetirlo. */
export interface Hallazgo {
  grupo: Grupo;
  codigo: string;
  detalle: string;
  semilla: number;
  campana: string;
  indice: number;
  /** El número (desde 1) de la acción que lo causó. */
  paso: number;
  /** Las acciones, hasta la que lo causó. */
  acciones: Paso[];
}

const TIPOS_DISPARADOR: readonly TipoDisparador[] = ['tiempo', 'chat', 'web', 'app'];

/** Corre UNA secuencia de una campaña. Se detiene en la primera acción que rompe algo. */
export function correrSecuencia(
  semilla: number,
  c: Campana,
  indiceCampana: number,
  indice: number,
  compartido: { deps?: Dependencias; cobertura: Map<string, number>; suaves: Map<string, number> },
): { pasos: number; hallazgos: Hallazgo[]; acciones: Paso[]; estadoFinal: E } {
  const rng = mulberry32(semillaDeSecuencia(semilla, indiceCampana, indice));
  const largo = c.largo[0] + entero(rng, c.largo[1] - c.largo[0] + 1);
  const s = new Sesion({
    ...(compartido.deps ? { deps: compartido.deps } : {}),
    semillaMuestreo: semillaDeSecuencia(semilla ^ 0x5eed, indiceCampana, indice),
    cobertura: compartido.cobertura,
    suaves: compartido.suaves,
  });
  const hallar = (V: Violacion[]): Hallazgo[] =>
    V.map(v => ({ ...v, semilla, campana: c.nombre, indice, paso: s.acciones.length, acciones: [...s.acciones] }));
  // la mayoría de las sesiones reales empieza igual: se elige el disparador
  if (c.modo !== 'api' && rng() < 0.85) {
    const V = s.aplicar({ k: 'elegirDisparador', tipo: elegir(rng, TIPOS_DISPARADOR) });
    if (V.length > 0) return resultado(hallar(V));
  }
  for (let i = 0; i < largo; i += 1) {
    // de vez en cuando la página se recarga: el estado vuelve a nacer del borrador
    const V = rng() < P_RECARGA ? s.aplicar({ k: 'recargar' }) : s.aplicar(gesto(rng, s.estado, s.ctx.memoria, c.modo, c.conClaves === true));
    if (V.length > 0) return resultado(hallar(V));
  }
  return resultado([]);

  function resultado(hallazgos: Hallazgo[]) {
    return { pasos: s.acciones.length, hallazgos, acciones: [...s.acciones], estadoFinal: s.estado };
  }
}

/** Lo que dejó una corrida de campañas. */
export interface ResultadoCampanas {
  hallazgos: Hallazgo[];
  cobertura: Map<string, number>;
  suaves: Map<string, number>;
  secuencias: number;
  pasos: number;
}

/** Corre todas las campañas con cada semilla. Con `parar`, se detiene en la primera secuencia que rompe algo (para los mutantes). */
export function correrCampanas(
  semillas: readonly number[],
  campanas: readonly Campana[],
  deps?: Dependencias,
  parar = false,
): ResultadoCampanas {
  const r: ResultadoCampanas = { hallazgos: [], cobertura: new Map(), suaves: new Map(), secuencias: 0, pasos: 0 };
  const compartido = { ...(deps ? { deps } : {}), cobertura: r.cobertura, suaves: r.suaves };
  for (const semilla of semillas) {
    for (const [ic, c] of campanas.entries()) {
      for (let i = 0; i < c.n; i += 1) {
        const s = correrSecuencia(semilla, c, ic, i, compartido);
        r.secuencias += 1;
        r.pasos += s.pasos;
        r.hallazgos.push(...s.hallazgos);
        if (parar && r.hallazgos.length > 0) return r;
      }
    }
  }
  return r;
}

// ================================================================ reproducir y minimizar

/** Repite una secuencia revisando TODO en cada paso. Devuelve la violación con ese código si vuelve a salir, o null. */
export function reproducir(acciones: readonly Paso[], codigo: string, deps?: Dependencias): Violacion | null {
  const s = new Sesion({ ...(deps ? { deps } : {}), completo: true });
  for (const a of acciones) {
    const hallada = s.aplicar(a).find(v => v.codigo === codigo);
    if (hallada) return hallada;
  }
  return null;
}

/** La secuencia más corta que encontramos que todavía hace salir ese código (delta debugging: se le quitan trozos y luego acciones sueltas). */
export function minimizar(acciones: readonly Paso[], codigo: string, deps?: Dependencias, maxIntentos = 400): Paso[] {
  let intentos = 0;
  const repite = (l: readonly Paso[]): boolean => {
    intentos += 1;
    return reproducir(l, codigo, deps) !== null;
  };
  let cur = [...acciones];
  if (!repite(cur)) return cur; // no determinista (no debería pasar)
  let n = 2;
  while (cur.length >= 2 && intentos < maxIntentos) {
    const trozo = Math.ceil(cur.length / n);
    let reducido = false;
    for (let i = 0; i < cur.length && intentos < maxIntentos; i += trozo) {
      const cand = [...cur.slice(0, i), ...cur.slice(i + trozo)];
      if (cand.length > 0 && repite(cand)) {
        cur = cand;
        n = Math.max(n - 1, 2);
        reducido = true;
        break;
      }
    }
    if (!reducido) {
      if (n >= cur.length) break;
      n = Math.min(cur.length, n * 2);
    }
  }
  for (let sigue = true; sigue && intentos < maxIntentos; ) {
    sigue = false;
    for (let i = 0; i < cur.length && intentos < maxIntentos; i += 1) {
      const cand = [...cur.slice(0, i), ...cur.slice(i + 1)];
      if (cand.length > 0 && repite(cand)) {
        cur = cand;
        sigue = true;
        break;
      }
    }
  }
  return cur;
}

const recorta = (t: string, max = 260): string => (t.length > max ? `${t.slice(0, max)}…` : t);

/** El hallazgo como texto: qué pasó, de dónde sale la secuencia y la secuencia mínima que lo repite. */
export function describir(h: Hallazgo, deps?: Dependencias): string {
  const minima = minimizar(h.acciones, h.codigo, deps);
  const v = reproducir(minima, h.codigo, deps);
  return [
    `[${h.grupo}] ${h.codigo}: ${v?.detalle ?? h.detalle}`,
    `  semilla ${h.semilla}, campaña «${h.campana}», secuencia ${h.indice}, acción ${h.paso} (de ${h.acciones.length} hasta ahí)`,
    `  secuencia mínima (${minima.length} acciones):`,
    ...minima.map((a, i) => `    ${i + 1}. ${recorta(JSON.stringify(a))}`),
  ].join('\n');
}

/** De cada código, el hallazgo con la secuencia más corta (para no minimizar lo mismo cien veces). */
export function distintos(hs: readonly Hallazgo[]): Hallazgo[] {
  const por = new Map<string, Hallazgo>();
  for (const h of hs) {
    const p = por.get(h.codigo);
    if (!p || h.acciones.length < p.acciones.length) por.set(h.codigo, h);
  }
  return [...por.values()];
}
