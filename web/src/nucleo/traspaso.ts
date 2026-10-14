// Pasar archivos de una página a otra del mismo origen (p. ej. la foto del personaje que la caja del inicio le
// entrega a Crear). La URL solo lleva TEXTO, y sessionStorage también (y unos 5 MB): un archivo no cabe en ninguno.
// IndexedDB sí guarda un `File` tal cual, así que la página que se va lo deja ahí bajo un token y la que llega lo
// recoge con ese token.
//
// Es una comodidad, igual que nucleo/preferencia: el navegador puede negar IndexedDB (ventana privada, datos
// bloqueados, cuota llena) o no contestar nunca, y la persona debe seguir su camino. Por eso NADA lanza hacia
// afuera: guardar da `null` si no pudo, tomar da `[]`, olvidar no dice nada, y cada operación tiene un plazo.
//
// Lo guardado vive 10 minutos (VIGENCIA_MS) y se barre al guardar y al tomar. Tomar NO borra: si la persona
// recarga la página de destino, el archivo sigue ahí hasta que venza o quien lo recogió lo olvide (`olvidarArchivos`,
// p. ej. cuando la película ya se creó). Nada que importe vive aquí: el dinero y los pedidos son del servidor.

/** La clave de la URL por donde viaja el token: `/estudio/crear/?refs=<token>`. */
export const PARAM_TRASPASO = 'refs';
/** Lo que viaja en `refs` cuando la página de origen NO pudo dejar los archivos: el destino avisa y sigue. */
export const TRASPASO_PERDIDO = 'perdida';

/** El token que se acepta: lo que genera `nuevoToken` (un UUID, o el de respaldo). Se valida antes de tocar la base. */
const FORMA_TOKEN = /^[A-Za-z0-9-]{8,64}$/;
export const tokenValido = (t: unknown): t is string => typeof t === 'string' && FORMA_TOKEN.test(t);

/** Cuánto vive lo guardado. */
export const VIGENCIA_MS = 10 * 60 * 1000;
/** Cuántos archivos caben en un traspaso (al guardar y al leer). */
export const MAX_ARCHIVOS = 8;
/** Plazo de cada operación: algunos navegadores dejan una apertura de IndexedDB colgada sin error. Pasado esto
 *  se da por no hecha, para no dejar a la persona esperando. */
export const PLAZO_MS = 4000;

const BASE = 'traspaso';
const TIENDA = 'archivos';

interface Registro {
  token: string;
  vence: number;
  archivos: File[];
}

/** El IndexedDB del navegador, o null si no hay (o si ni preguntarlo se deja). */
function fabrica(): IDBFactory | null {
  try {
    return globalThis.indexedDB ?? null;
  } catch {
    return null;
  }
}

/** El token de un traspaso. `randomUUID` (36 caracteres) cuando el navegador lo trae; si no, bytes aleatorios del
 *  navegador; y solo si tampoco hay, el de respaldo con fecha y `Math.random` (no protege nada: solo no repetirse). */
function nuevoToken(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (c && typeof c.getRandomValues === 'function') {
    const b = c.getRandomValues(new Uint8Array(16));
    return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12).padEnd(10, '0');
}

/** Abre la base (la crea la primera vez). null si no se pudo. Cierra la conexión que llegue tarde. */
function abrir(): Promise<IDBDatabase | null> {
  return new Promise(resolver => {
    const f = fabrica();
    if (!f) return resolver(null);
    let hecho = false;
    const fin = (db: IDBDatabase | null) => {
      if (hecho) {
        db?.close(); // llegó cuando ya se había dado por perdida
        return;
      }
      hecho = true;
      resolver(db);
    };
    try {
      const pedido = f.open(BASE, 1);
      pedido.onupgradeneeded = () => {
        try {
          if (!pedido.result.objectStoreNames.contains(TIENDA)) pedido.result.createObjectStore(TIENDA, { keyPath: 'token' });
        } catch {
          fin(null);
        }
      };
      pedido.onsuccess = () => fin(pedido.result);
      pedido.onerror = () => fin(null);
      pedido.onblocked = () => fin(null);
    } catch {
      fin(null);
    }
  });
}

/** Hace `trabajo` con la base abierta y la cierra al terminar. Se resuelve con `si_falla` si no hubo base, si el
 *  trabajo falló o si pasó el plazo. Nunca rechaza. */
async function conBase<T>(trabajo: (db: IDBDatabase) => Promise<T>, siFalla: T): Promise<T> {
  let abierta: IDBDatabase | null = null;
  let vencido = false;
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const plazo = new Promise<T>(resolver => {
    reloj = setTimeout(() => {
      vencido = true;
      resolver(siFalla);
    }, PLAZO_MS);
  });
  const hecho = (async () => {
    const db = await abrir();
    if (!db) return siFalla;
    if (vencido) {
      db.close(); // se abrió cuando ya se había dado por perdida: nadie la va a usar
      return siFalla;
    }
    abierta = db;
    return trabajo(db);
  })().catch(() => siFalla);
  try {
    return await Promise.race([hecho, plazo]);
  } finally {
    clearTimeout(reloj);
    try {
      (abierta as IDBDatabase | null)?.close();
    } catch {
      /* ya estaba cerrada */
    }
  }
}

/** Corre `usar` dentro de una transacción y espera a que ESA transacción termine (no solo la petición): una cuota
 *  llena o un aborto llegan como `abort`, y rechazan. Devuelve lo que `usar` haya anotado. */
function transaccion<T>(db: IDBDatabase, modo: IDBTransactionMode, usar: (tienda: IDBObjectStore, guardar: (v: T) => void) => void): Promise<T | undefined> {
  return new Promise((resolver, rechazar) => {
    let dato: T | undefined;
    const t = db.transaction(TIENDA, modo);
    t.oncomplete = () => resolver(dato);
    t.onabort = () => rechazar(t.error ?? new Error('transacción abortada'));
    t.onerror = () => rechazar(t.error ?? new Error('transacción con error'));
    usar(t.objectStore(TIENDA), v => {
      dato = v;
    });
  });
}

/** Borra lo vencido. Mejor esfuerzo: si algo falla se ignora (no debe estorbar a guardar ni a tomar). */
async function barrer(db: IDBDatabase): Promise<void> {
  try {
    await transaccion<void>(db, 'readwrite', tienda => {
      const ahora = Date.now();
      const recorrido = tienda.openCursor();
      recorrido.onsuccess = () => {
        const cursor = recorrido.result;
        if (!cursor) return;
        const r = cursor.value as Partial<Registro> | null;
        // lo que no se entiende (otra versión, basura) también se va
        if (!r || typeof r.vence !== 'number' || r.vence <= ahora) cursor.delete();
        cursor.continue();
      };
    });
  } catch {
    /* sin barrido: vencerá la próxima vez */
  }
}

/**
 * Deja los archivos en el navegador y devuelve el token con que otra página del mismo origen los recoge, o `null`
 * si no se pudo (sin IndexedDB, ventana privada, cuota llena, plazo vencido, nada que guardar). No lanza.
 */
export async function guardarArchivos(archivos: File[]): Promise<string | null> {
  try {
    const lista = archivos.filter(a => a instanceof File).slice(0, MAX_ARCHIVOS);
    if (!lista.length) return null;
    return await conBase<string | null>(async db => {
      await barrer(db);
      const token = nuevoToken();
      const registro: Registro = { token, vence: Date.now() + VIGENCIA_MS, archivos: lista };
      await transaccion<void>(db, 'readwrite', tienda => {
        tienda.put(registro);
      });
      return token;
    }, null);
  } catch {
    return null;
  }
}

/**
 * Los archivos que dejó `guardarArchivos` con ese token, o `[]` si el token no es de los nuestros, no existe,
 * venció o algo falló. Valida el token ANTES de tocar la base y lo leído DESPUÉS (solo `File`, hasta MAX_ARCHIVOS).
 * No borra lo leído: recargar la página de destino debe encontrarlo otra vez. No lanza.
 */
export async function tomarArchivos(token: string): Promise<File[]> {
  try {
    if (!tokenValido(token)) return [];
    return await conBase<File[]>(async db => {
      await barrer(db);
      const leido = await transaccion<unknown>(db, 'readonly', (tienda, guardar) => {
        const p = tienda.get(token);
        p.onsuccess = () => guardar(p.result);
      });
      if (!leido || typeof leido !== 'object') return [];
      const r = leido as Partial<Registro>;
      if (r.token !== token || typeof r.vence !== 'number' || r.vence <= Date.now() || !Array.isArray(r.archivos)) return [];
      return (r.archivos as unknown[]).filter((a): a is File => a instanceof File).slice(0, MAX_ARCHIVOS);
    }, []);
  } catch {
    return [];
  }
}

/** Borra lo guardado con ese token (ya no hace falta: la película se creó). Mejor esfuerzo; no lanza. */
export async function olvidarArchivos(token: string): Promise<void> {
  try {
    if (!tokenValido(token)) return;
    await conBase<void>(async db => {
      await transaccion<void>(db, 'readwrite', tienda => {
        tienda.delete(token);
      });
    }, undefined);
  } catch {
    /* si no se pudo, vence solo */
  }
}
