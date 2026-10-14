// nucleo/traspaso: archivos de una página a otra por IndexedDB. jsdom no trae IndexedDB y el proyecto no suma
// `fake-indexeddb` (no se toca package.json): el de aquí es un doble mínimo, escrito con la forma del real, o sea
// con las peticiones y las transacciones contestando DESPUÉS (setTimeout), no al instante.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  guardarArchivos,
  MAX_ARCHIVOS,
  olvidarArchivos,
  PARAM_TRASPASO,
  PLAZO_MS,
  tokenValido,
  tomarArchivos,
  TRASPASO_PERDIDO,
  VIGENCIA_MS,
} from './traspaso';

// ── el IndexedDB de mentira ─────────────────────────────────────────────────

interface Fallas {
  /** open(): 'error' contesta onerror; 'bloqueada' contesta onblocked; 'colgada' no contesta nunca; 'tarde' contesta
   *  pasado el plazo; 'lanza' lanza. */
  abrir?: 'error' | 'bloqueada' | 'colgada' | 'tarde' | 'lanza';
  /** transaction(): lanza (la base ya estaba cerrada). */
  transaccion?: boolean;
  /** put(): la transacción se aborta con QuotaExceededError. */
  cuota?: boolean;
  /** get(): la petición falla. */
  lectura?: boolean;
}

const luego = (f: () => void) => setTimeout(f, 0);

function falso(datos: Map<string, unknown>, fallas: Fallas = {}) {
  const estado = { aperturas: 0, abiertas: 0, cerradas: 0, creada: false };

  class Transaccion {
    oncomplete: (() => void) | null = null;
    onabort: (() => void) | null = null;
    onerror: (() => void) | null = null;
    error: unknown = null;
    pendientes = 0;
    private terminada = false;

    constructor(readonly modo: string) {
      luego(() => this.revisar());
    }

    revisar() {
      if (this.terminada || this.pendientes > 0) return;
      this.terminada = true;
      this.oncomplete?.();
    }

    abortar(error: unknown) {
      if (this.terminada) return;
      this.terminada = true;
      this.error = error;
      this.onerror?.();
      this.onabort?.();
    }

    /** Una petición: contesta en otro turno, y la transacción termina cuando ya no queda ninguna. */
    pedir<T>(ejecutar: () => T, falla?: unknown) {
      const p: { result: T | undefined; error: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null } = {
        result: undefined,
        error: null,
        onsuccess: null,
        onerror: null,
      };
      this.pendientes++;
      luego(() => {
        if (this.terminada) return;
        if (falla) {
          p.error = falla;
          p.onerror?.();
          this.pendientes--;
          this.abortar(falla);
          return;
        }
        p.result = ejecutar();
        p.onsuccess?.();
        this.pendientes--;
        luego(() => this.revisar());
      });
      return p;
    }

    objectStore() {
      return {
        get: (clave: string) => this.pedir(() => datos.get(clave), fallas.lectura ? new Error('lectura') : undefined),
        put: (valor: { token: string }) =>
          this.pedir(
            () => {
              datos.set(valor.token, valor);
              return valor.token;
            },
            fallas.cuota ? new DOMException('sin espacio', 'QuotaExceededError') : undefined,
          ),
        delete: (clave: string) => this.pedir(() => void datos.delete(clave)),
        openCursor: () => {
          const claves = [...datos.keys()];
          let i = 0;
          const p: { result: unknown; onsuccess: (() => void) | null } = { result: null, onsuccess: null };
          const paso = () => {
            this.pendientes++;
            luego(() => {
              const clave = claves[i++];
              p.result =
                clave === undefined
                  ? null
                  : {
                      value: datos.get(clave),
                      delete: () => void datos.delete(clave),
                      continue: paso,
                    };
              p.onsuccess?.();
              this.pendientes--;
              luego(() => this.revisar());
            });
          };
          paso();
          return p;
        },
      };
    }
  }

  const base = () => ({
    objectStoreNames: { contains: () => estado.creada },
    createObjectStore: () => {
      estado.creada = true;
    },
    transaction: (_tienda: string, modo: string) => {
      if (fallas.transaccion) throw new DOMException('cerrada', 'InvalidStateError');
      return new Transaccion(modo);
    },
    close: () => {
      estado.cerradas++;
    },
  });

  const fabrica = {
    open: () => {
      estado.aperturas++;
      if (fallas.abrir === 'lanza') throw new DOMException('no hay', 'SecurityError');
      const db = base();
      const p: {
        result: unknown;
        error: unknown;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
        onblocked: (() => void) | null;
        onupgradeneeded: (() => void) | null;
      } = { result: db, error: null, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null };
      const contestar = () => {
        if (fallas.abrir === 'error') return p.onerror?.();
        if (fallas.abrir === 'bloqueada') return p.onblocked?.();
        if (!estado.creada) p.onupgradeneeded?.();
        estado.abiertas++;
        p.onsuccess?.();
      };
      if (fallas.abrir === 'tarde') setTimeout(contestar, PLAZO_MS + 100);
      else if (fallas.abrir !== 'colgada') luego(contestar);
      return p;
    },
  };
  return { fabrica, estado };
}

const archivo = (nombre = 'perro.png', tipo = 'image/png') => new File(['contenido de ' + nombre], nombre, { type: tipo });
const vencido = () => ({ token: 'viejo-0001', vence: Date.now() - 1, archivos: [archivo('viejo.png')] });

let datos: Map<string, unknown>;
function poner(fallas: Fallas = {}) {
  const f = falso(datos, fallas);
  vi.stubGlobal('indexedDB', f.fabrica);
  return f.estado;
}

beforeEach(() => {
  datos = new Map();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ── lo que sí funciona ──────────────────────────────────────────────────────

describe('traspaso · guardar y tomar', () => {
  it('lo guardado se recoge igual, y recogerlo no lo borra (recargar la página de destino lo encuentra otra vez)', async () => {
    const e = poner();
    const foto = archivo('gato.png');
    const token = await guardarArchivos([foto]);
    expect(token).not.toBeNull();
    expect(tokenValido(token)).toBe(true);
    const una = await tomarArchivos(token!);
    expect(una).toHaveLength(1);
    expect(una[0]).toBe(foto); // el File tal cual, no un texto
    expect(una[0]!.name).toBe('gato.png');
    const otra = await tomarArchivos(token!);
    expect(otra).toHaveLength(1);
    expect(datos.has(token!)).toBe(true);
    // y cada operación cierra la conexión que abrió
    expect(e.cerradas).toBe(e.abiertas);
    expect(e.abiertas).toBe(3);
  });

  it('cada traspaso tiene su token, y uno no recoge los archivos de otro', async () => {
    poner();
    const a = await guardarArchivos([archivo('a.png')]);
    const b = await guardarArchivos([archivo('b.png')]);
    expect(a).not.toEqual(b);
    expect((await tomarArchivos(a!)).map(f => f.name)).toEqual(['a.png']);
    expect((await tomarArchivos(b!)).map(f => f.name)).toEqual(['b.png']);
  });

  it('vive 10 minutos: pasado ese tiempo ya no hay nada, y se borra', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    poner();
    const token = (await guardarArchivos([archivo()]))!;
    vi.setSystemTime(Date.now() + VIGENCIA_MS - 1000);
    expect(await tomarArchivos(token)).toHaveLength(1);
    vi.setSystemTime(Date.now() + 2000);
    expect(await tomarArchivos(token)).toEqual([]);
    expect(datos.size).toBe(0); // el barrido de tomar lo quitó
  });

  it('al guardar se barren las entradas vencidas y la basura que no se entiende; las vigentes se quedan', async () => {
    poner();
    datos.set('viejo-0001', vencido());
    datos.set('basura-001', 'no soy un registro');
    datos.set('sin-fecha-1', { token: 'sin-fecha-1', archivos: [] });
    const vigente = { token: 'vigente-01', vence: Date.now() + 60000, archivos: [archivo('v.png')] };
    datos.set('vigente-01', vigente);
    const token = (await guardarArchivos([archivo('nuevo.png')]))!;
    expect([...datos.keys()].sort()).toEqual([token, 'vigente-01'].sort());
  });

  it('olvidar borra solo ese token', async () => {
    poner();
    const a = (await guardarArchivos([archivo('a.png')]))!;
    const b = (await guardarArchivos([archivo('b.png')]))!;
    await olvidarArchivos(a);
    expect(await tomarArchivos(a)).toEqual([]);
    expect(await tomarArchivos(b)).toHaveLength(1);
  });

  it('la cantidad tiene tope: al guardar y al leer', async () => {
    poner();
    const muchas = Array.from({ length: MAX_ARCHIVOS + 3 }, (_, i) => archivo(`f${i}.png`));
    const token = (await guardarArchivos(muchas))!;
    expect(await tomarArchivos(token)).toHaveLength(MAX_ARCHIVOS);
    // y un registro escrito por otro con más de la cuenta tampoco se lee entero
    datos.set('de-otro-001', { token: 'de-otro-001', vence: Date.now() + 60000, archivos: muchas });
    expect(await tomarArchivos('de-otro-001')).toHaveLength(MAX_ARCHIVOS);
  });

  it('lo leído se valida: solo entran File; lo demás se descarta', async () => {
    poner();
    const bueno = archivo('bueno.png');
    datos.set('mezcla-0001', {
      token: 'mezcla-0001',
      vence: Date.now() + 60000,
      archivos: ['texto', { name: 'falso.png', size: 3 }, null, new Blob(['x']), bueno],
    });
    expect(await tomarArchivos('mezcla-0001')).toEqual([bueno]);
    datos.set('no-lista-01', { token: 'no-lista-01', vence: Date.now() + 60000, archivos: 'nada' });
    expect(await tomarArchivos('no-lista-01')).toEqual([]);
    // un registro que dice ser de otro token tampoco vale
    datos.set('suplanta-01', { token: 'otro-token-1', vence: Date.now() + 60000, archivos: [bueno] });
    expect(await tomarArchivos('suplanta-01')).toEqual([]);
    datos.set('sin-fecha-2', { token: 'sin-fecha-2', archivos: [bueno] });
    expect(await tomarArchivos('sin-fecha-2')).toEqual([]);
  });

  it('un token que no existe da una lista vacía', async () => {
    poner();
    expect(await tomarArchivos('no-existe-1')).toEqual([]);
  });
});

describe('traspaso · el token', () => {
  it('solo letras, números y guiones, de 8 a 64; lo demás ni toca la base', async () => {
    const e = poner();
    const malos = ['', 'corto', TRASPASO_PERDIDO, 'a'.repeat(65), '../../etc', 'con espacio-1', 'ñandú-0001', "x'; drop-1", 'a/b/c/d/e/f', 'abcdefg.h'];
    for (const t of malos) {
      expect(tokenValido(t)).toBe(false);
      expect(await tomarArchivos(t)).toEqual([]);
      await olvidarArchivos(t);
    }
    expect(e.aperturas).toBe(0);
    expect(tokenValido('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(true);
    expect(tokenValido('abcdefgh')).toBe(true);
    expect(tokenValido('a'.repeat(64))).toBe(true);
    expect(tokenValido(undefined)).toBe(false);
    expect(tokenValido(12345678)).toBe(false);
  });

  it('el nombre del parámetro y el de «se perdió» son los que usan las dos páginas', () => {
    expect(PARAM_TRASPASO).toBe('refs');
    expect(TRASPASO_PERDIDO).toBe('perdida');
  });

  it('sin randomUUID se genera otro con bytes del navegador; sin crypto, el de respaldo: los dos son válidos', async () => {
    poner();
    vi.stubGlobal('crypto', { getRandomValues: (b: Uint8Array) => b.fill(171) });
    const t1 = await guardarArchivos([archivo()]);
    expect(t1).toBe('ab'.repeat(16));
    expect(tokenValido(t1)).toBe(true);
    vi.stubGlobal('crypto', undefined);
    const t2 = await guardarArchivos([archivo()]);
    expect(tokenValido(t2)).toBe(true);
    expect(t2).not.toBe(t1);
    expect((await tomarArchivos(t2!)).length).toBe(1);
  });
});

// ── los caminos de fallo: nada lanza hacia afuera ───────────────────────────

describe('traspaso · cuando el navegador no deja', () => {
  it('sin indexedDB (o ni preguntarlo se deja): guardar da null, tomar da [] y olvidar no dice nada', async () => {
    vi.stubGlobal('indexedDB', undefined);
    expect(await guardarArchivos([archivo()])).toBeNull();
    expect(await tomarArchivos('token-valido-1')).toEqual([]);
    await expect(olvidarArchivos('token-valido-1')).resolves.toBeUndefined();
    vi.unstubAllGlobals();
    // ni preguntarlo se deja (algunos navegadores lanzan SecurityError al LEER window.indexedDB)
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      get: () => {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(await guardarArchivos([archivo()])).toBeNull();
      expect(await tomarArchivos('token-valido-1')).toEqual([]);
      await expect(olvidarArchivos('token-valido-1')).resolves.toBeUndefined();
    } finally {
      delete (globalThis as { indexedDB?: unknown }).indexedDB;
    }
  });

  it('open() rechaza (ventana privada de Firefox), lanza o queda bloqueada', async () => {
    for (const abrir of ['error', 'bloqueada', 'lanza'] as const) {
      const e = poner({ abrir });
      expect(await guardarArchivos([archivo()])).toBeNull();
      expect(await tomarArchivos('token-valido-1')).toEqual([]);
      await expect(olvidarArchivos('token-valido-1')).resolves.toBeUndefined();
      expect(e.abiertas).toBe(0);
    }
    expect(datos.size).toBe(0);
  });

  it('la transacción se aborta (cuota llena): guardar da null, no deja nada a medias y cierra la conexión', async () => {
    const e = poner({ cuota: true });
    expect(await guardarArchivos([archivo()])).toBeNull();
    expect(datos.size).toBe(0);
    expect(e.abiertas).toBeGreaterThan(0);
    expect(e.cerradas).toBe(e.abiertas);
  });

  it('transaction() lanza (la base se cerró sola): guardar null, tomar [] y olvidar sin ruido', async () => {
    const e = poner({ transaccion: true });
    expect(await guardarArchivos([archivo()])).toBeNull();
    expect(await tomarArchivos('token-valido-1')).toEqual([]);
    await expect(olvidarArchivos('token-valido-1')).resolves.toBeUndefined();
    expect(e.cerradas).toBe(e.abiertas);
  });

  it('una lectura que falla da []', async () => {
    const e = poner({ lectura: true });
    datos.set('token-valido-1', { token: 'token-valido-1', vence: Date.now() + 60000, archivos: [archivo()] });
    expect(await tomarArchivos('token-valido-1')).toEqual([]);
    expect(e.cerradas).toBe(e.abiertas);
  });

  it('una apertura que nunca contesta se da por perdida al pasar el plazo, y si llega tarde se cierra sin usarse', async () => {
    vi.useFakeTimers();
    const e = poner({ abrir: 'colgada' });
    let listo: string | null | undefined;
    void guardarArchivos([archivo()]).then(t => (listo = t));
    await vi.advanceTimersByTimeAsync(PLAZO_MS - 1);
    expect(listo).toBeUndefined(); // todavía espera
    await vi.advanceTimersByTimeAsync(2);
    expect(listo).toBeNull();
    expect(datos.size).toBe(0);
    expect(e.aperturas).toBe(1);
  });

  it('una apertura lenta que contesta DESPUÉS del plazo no guarda nada y suelta su conexión', async () => {
    vi.useFakeTimers();
    const e = poner({ abrir: 'tarde' });
    let listo: string | null | undefined;
    void guardarArchivos([archivo()]).then(t => (listo = t));
    await vi.advanceTimersByTimeAsync(PLAZO_MS + 10);
    expect(listo).toBeNull();
    expect(e.abiertas).toBe(0); // todavía no contesta
    await vi.advanceTimersByTimeAsync(500); // llega tarde
    expect(e.abiertas).toBe(1);
    expect(e.cerradas).toBe(1); // nadie la usa: se suelta
    expect(datos.size).toBe(0);
  });

  it('nada que guardar (lista vacía o cosas que no son File) no abre la base', async () => {
    const e = poner();
    expect(await guardarArchivos([])).toBeNull();
    expect(await guardarArchivos(['texto' as unknown as File, new Blob(['x']) as unknown as File])).toBeNull();
    expect(e.aperturas).toBe(0);
  });
});
