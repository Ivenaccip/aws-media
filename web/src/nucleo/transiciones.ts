// UI·18 — lo que une dos pantallas durante una View Transition entre
// documentos (tokens.css la enciende con @view-transition).
//
// La miniatura que se toca en el inicio y la película que abre comparten el
// nombre `miniatura`, y el navegador la agranda hasta su sitio nuevo. Un
// view-transition-name tiene que ser ÚNICO en cada página: se le pone solo a
// la tocada, en el último momento (pageswap), y nunca a todas.
//
// La pantalla nueva todavía no tiene la película cuando el navegador la
// fotografía (llega por fetch), así que se lleva la dirección de la miniatura
// en sessionStorage y la pinta en el lugar del reproductor mientras carga.
//
// Donde no hay View Transitions nada de esto se nota: la miniatura se pinta
// igual como «cargando», que es mejor que una línea de texto.

export const NOMBRE_MINIATURA = 'miniatura';

const CLAVE = 'vt:miniatura';
// una pista más vieja que esto no viene del clic de hace un momento
const VIGENCIA_MS = 10_000;

// `proporcion` es la de la miniatura ya cargada (ancho/alto de la portada, que
// es un cuadro de la película): la pantalla nueva reserva esa caja antes de
// que la imagen cargue. Sin ella la caja mediría 0 de alto en la foto.
type Pista = { id: string; src: string; proporcion: number | null; t: number };

export type Llegada = { src: string; proporcion: number | null };

type ConTransicion = Event & { viewTransition?: ViewTransition | null };
// pageswap trae a dónde se va (Chrome 123+; en Safari no)
type Salida = ConTransicion & { activation?: { entry?: { url?: string } } | null };

let tocada: { id: string; img: HTMLElement } | null = null;
let nombrada: HTMLElement | null = null;
let escuchando = false;

// ── la pantalla que se va
function alIrse(e: Event) {
  const { viewTransition: vt, activation } = e as Salida;
  const t = tocada;
  tocada = null;
  if (!vt || !t?.img.isConnected) return;
  // si se sabe a dónde va y no es a esa película, no se nombra nada
  const destino = activation?.entry?.url;
  if (destino && new URL(destino, location.href).searchParams.get('p') !== t.id) return;
  t.img.style.viewTransitionName = NOMBRE_MINIATURA;
  nombrada = t.img;
}

// al volver con «atrás» la página sale de la caché con el nombre puesto: se
// le quita antes de que el navegador la fotografíe otra vez
function alVolver() {
  if (nombrada) nombrada.style.viewTransitionName = '';
  nombrada = null;
}

/** El inicio avisa qué miniatura tocó, justo antes de navegar a su película. */
export function tocarMiniatura(id: string, src: string, img: HTMLImageElement | null): void {
  const proporcion = img && img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : null;
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify({ id, src, proporcion, t: Date.now() } satisfies Pista));
  } catch {
    return; // sin sessionStorage la pantalla nueva no sabría qué pintar
  }
  tocada = img ? { id, img } : null;
  if (!escuchando) {
    escuchando = true;
    addEventListener('pageswap', alIrse);
    addEventListener('pagereveal', alVolver);
  }
}

// ── la pantalla que llega

/** La miniatura con la que el inicio abrió la película `id` hace un momento,
 *  o null. Solo lee: `olvidarMiniatura()` la borra (en un efecto, porque
 *  StrictMode llama dos veces al inicializador de useState). */
export function miniaturaQueLlega(id: string | null): Llegada | null {
  if (!id) return null;
  try {
    const p = JSON.parse(sessionStorage.getItem(CLAVE) ?? 'null') as Partial<Pista> | null;
    if (!p || p.id !== id || typeof p.src !== 'string' || typeof p.t !== 'number') return null;
    // solo una dirección de la API: la pista viaja por sessionStorage
    if (!p.src.startsWith('/api/')) return null;
    if (Date.now() - p.t > VIGENCIA_MS) return null;
    const proporcion = typeof p.proporcion === 'number' && p.proporcion > 0 ? p.proporcion : null;
    return { src: p.src, proporcion };
  } catch {
    return null;
  }
}

export function olvidarMiniatura(): void {
  try {
    sessionStorage.removeItem(CLAVE);
  } catch {
    // nada que olvidar
  }
}

// Quitar el elemento nombrado a mitad de la transición la corta en seco:
// la pantalla que llega deja su miniatura hasta que el navegador termina de
// agrandarla. Se escucha desde que se carga este módulo, antes del primer
// cuadro (el módulo bloquea el pintado, vite.config.ts): si llega
// `pagereveal`, trae la transición o null; si antes llega un cuadro sin él,
// la página ya se había revelado (Safari sin blocking="render", o un
// navegador sin el evento) y no hay nada que esperar.
const revelada: Promise<ViewTransition | null> = new Promise(listo => {
  if (typeof window === 'undefined') return listo(null);
  addEventListener('pagereveal', e => listo((e as ConTransicion).viewTransition ?? null), { once: true });
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => listo(null));
  else listo(null);
});

/** Se cumple cuando la transición que trajo a esta pantalla terminó (o si no
 *  hubo ninguna). Nunca se rechaza. */
export function trasLaLlegada(): Promise<void> {
  return revelada
    .then(vt => vt?.finished)
    .then(
      () => undefined,
      () => undefined,
    );
}
