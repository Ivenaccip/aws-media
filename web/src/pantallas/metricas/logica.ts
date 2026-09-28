// Métricas sin React: los tipos de /api/metricas y lo que static/metricas.html
// calculaba en línea. No cobra nada (server/metricas_api.py: «cero créditos»).
//
// Lo que esta pantalla no puede hacer nunca: decir «sin números» de algo que
// sí los tiene. El server manda un `medicion` por tarjeta con su motivo ya
// redactado, y solo «sin_consultar» (no lo sabemos) ofrece preguntar. Ningún
// endpoint de Blotato fuerza una medición nueva: el botón dice «Ver números»,
// no «Actualizar los números».
import { ErrorApi, pedir } from '../../nucleo/api';

export interface Numeros {
  vistas?: number | null;
  me_gusta?: number | null;
  comentarios?: number | null;
  compartidos?: number | null;
}

export interface Dato {
  clave?: string;
  etiqueta: string;
  tipo?: 'ms' | 'ratio' | string;
  valor: number | null;
}

export interface Medida {
  cuando: string;
  numeros: Numeros | null;
}

export interface Publicacion {
  id: string;
  plataforma?: string;
  red: string;
  cuando: string;
  estado: 'publicado' | 'fallido' | string;
  enlace?: string;
  error_red?: string;
  texto?: string;
  cortado?: boolean;
  medios?: number;
  numeros: Numeros | null;
  detalle: Dato[];
  medido: string;
  historial: Medida[];
  medicion?: string;
  motivo?: string;
  puede_pedir?: boolean;
}

export interface Tramo {
  items: Publicacion[];
  mejores: Publicacion[];
  cursor: string | null;
  desde: string | null;
  hasta: string | null;
  ultimo_tramo: boolean;
  hay_lista: boolean;
  hay_numeros: boolean;
  truncado?: boolean;
  /** No es un error: lo redacta el server («solo nos dio las 100…»). */
  aviso: string | null;
  error: string | null;
  reconectar: boolean;
}

export type LosNumeros = Pick<Publicacion, 'id' | 'numeros' | 'detalle' | 'medido' | 'historial' | 'medicion' | 'motivo'>;

/** «Ver más» agota primero el cursor del tramo, y solo después retrocede 30 días.
 *  Con cursor el tramo viaja entero: un cursor con otra ventana devuelve cualquier cosa. */
export function rutaTramo(mas: boolean, desde: string | null, hasta: string | null, cursor: string | null): string {
  const q = new URLSearchParams();
  if (mas && cursor && desde && hasta) {
    q.set('desde', desde);
    q.set('hasta', hasta);
    q.set('cursor', cursor);
  } else if (mas && desde) q.set('desde', desde);
  const s = q.toString();
  return '/api/metricas' + (s ? '?' + s : '');
}

export const cargar = (ruta: string) => pedir<Tramo>(ruta);
export const pedirNumeros = (id: string) =>
  pedir<LosNumeros>('/api/metricas/' + encodeURIComponent(id) + '/numeros');

export const CONECTAR = '/estudio/?blotato=conectar';
export const TOPE = 'Métricas llega hasta un año atrás.';
export const QUE_TOP = 'Ordenadas por vistas, de lo que Blotato ya midió en este tramo.';
export const QUE_REC = 'De lo más nuevo a lo más viejo.';
export const SIN_RED = 'No pudimos hablar con el servidor. Intenta de nuevo.';

export function mensaje(e: unknown): string {
  return e instanceof ErrorApi && e.estado !== 0 && e.message ? e.message : SIN_RED;
}
export const estado = (e: unknown) => (e instanceof ErrorApi ? e.estado : 0);

/** Siempre en la zona del navegador (los textos que la acompañan dicen «tu
 *  hora»), pero en español: la vieja usaba el idioma del navegador y un
 *  navegador en inglés leía «sale el May 1, 2099» a media frase. */
export function fecha(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

export function dia(iso: string | null | undefined): string {
  const d = new Date(iso ?? '');
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
}

/** UI·23 — «20 sep»: lo que cabe bajo una barra de la gráfica en un teléfono. */
export function diaCorto(iso: string | null | undefined): string {
  const d = new Date(iso ?? '');
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

/** null NO es 0: «no lo informa» y «cero» son cosas distintas. */
export function num(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('es-MX') : '';
}

/** Los tiempos vienen en milisegundos: así no le dicen nada a nadie. */
export function duracion(ms: unknown): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m} min ${r} s` : `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function valor(d: Dato): string {
  if (d.tipo === 'ms') return duracion(d.valor);
  if (d.tipo === 'ratio')
    return typeof d.valor === 'number' && Number.isFinite(d.valor)
      ? d.valor.toLocaleString('es-MX', { maximumFractionDigits: 2 })
      : '';
  return num(d.valor);
}

export const ETIQUETAS: readonly (readonly [keyof Numeros, string])[] = [
  ['vistas', 'Vistas'],
  ['me_gusta', 'Me gusta'],
  ['comentarios', 'Comentarios'],
  ['compartidos', 'Compartidos'],
];

/** Solo las casillas que la red informó: una vacía con guion parece un cero. */
export function casillas(n: Numeros | null): [string, string][] {
  if (!n) return [];
  return ETIQUETAS.filter(([k]) => typeof n[k] === 'number' && Number.isFinite(n[k])).map(([k, et]) => [
    num(n[k]),
    et,
  ]);
}

/** Cuánto cambió desde la medición anterior. Puede BAJAR: las redes corrigen. */
export function delta(it: Pick<Publicacion, 'historial'>): string {
  const h = Array.isArray(it.historial) ? it.historial : [];
  if (h.length < 2) return h.length === 1 ? 'Una sola medición.' : '';
  const antes = h[h.length - 2]!;
  const ahora = h[h.length - 1]!;
  const a = antes.numeros?.vistas;
  const b = ahora.numeros?.vistas;
  if (typeof a !== 'number' || typeof b !== 'number') return `${h.length} mediciones.`;
  const d = b - a;
  const signo = d > 0 ? '+' : d < 0 ? '−' : '';
  return `${signo}${num(Math.abs(d))} vistas desde el ${dia(antes.cuando)} · ${h.length} mediciones.`;
}

/** UI·23 — cuántas barras se dibujan como mucho. Las demás mediciones siguen en la tabla. */
export const BARRAS = 6;

// Cuántas caben en un teléfono (≈290 px de tarjeta a 390) con su cifra encima
// sin pisar la de al lado, según los caracteres de la cifra más larga. Medido
// en Chromium con la Geist de 13 px: «12,050» mide 43 px y cabe en seis
// columnas de 45; «103,200» mide 51 y pide cinco.
const CABEN: readonly (readonly [number, number])[] = [
  [6, 6],
  [7, 5],
  [10, 4],
  [13, 3],
];
const caben = (cifras: number[]) => {
  const largo = Math.max(...cifras.map(n => num(n).length));
  return CABEN.find(([l]) => largo <= l)?.[1] ?? 2;
};

export interface Barra {
  cuando: string;
  /** null = la red no lo informó: un HUECO, no una barra en cero. */
  vistas: number | null;
  /** En % de la más alta de las que se dibujan. */
  alto: number;
}

/** UI·23 — «Cómo fue cambiando» en barras: las vistas de las últimas
 *  mediciones (las que quepan), de la más vieja a la más nueva. null si no
 *  hay al menos dos cifras que comparar; `de` es cuántas mediciones hay en total. */
export function barrasVistas(h: Medida[]): { barras: Barra[]; de: number } | null {
  const todas = Array.isArray(h) ? h : [];
  for (let cuantas = BARRAS; cuantas >= 2; cuantas--) {
    const ultimas = todas.slice(-cuantas);
    // una cuenta negativa no se puede dibujar desde la base: en la gráfica es un hueco (la tabla la enseña tal cual)
    const v = ultimas.map(f => {
      const n = f.numeros?.vistas;
      return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
    });
    const con = v.filter((n): n is number => n !== null);
    if (con.length < 2) return null;
    if (ultimas.length > caben(con)) continue;
    const max = Math.max(...con);
    return {
      barras: ultimas.map((f, i) => {
        const n = v[i]!;
        return { cuando: f.cuando, vistas: n, alto: n === null || !max ? 0 : Math.round((n / max) * 1000) / 10 };
      }),
      de: todas.length,
    };
  }
  return null;
}

export const tieneNumeros = (it: Publicacion) => !!it.numeros || (Array.isArray(it.detalle) && it.detalle.length > 0);

export function texto(it: Publicacion): string {
  return (it.texto ?? '') + (it.texto && it.cortado ? '…' : '');
}

/** Una liga que no es https no se pinta: un `javascript:` en un href corre al clic. */
export function enlaceSeguro(url: string | undefined): string | null {
  const t = String(url ?? '').trim();
  return /^https:\/\//i.test(t) ? t : null;
}

/** «Del 3 de agosto al 2 de septiembre», o '' si falta un borde. */
export function ventana(desde: string | null, hasta: string | null): string {
  if (!desde || !hasta) return '';
  return `Del ${dia(desde)} al ${dia(hasta)}`;
}

// Los tramos se encadenan por fecha y Blotato reordena por `postTime`: una
// misma publicación puede llegar dos veces. La segunda ACTUALIZA a la primera
// en su sitio, pero NO borra unos números que ya costaron una llamada.
export function unir(viejos: Publicacion[], nuevos: Publicacion[]): Publicacion[] {
  const por = new Map(viejos.map((it, i) => [it.id, i]));
  const fuera = viejos.slice();
  for (const it of nuevos) {
    const i = por.get(it.id);
    if (i === undefined) {
      por.set(it.id, fuera.length);
      fuera.push(it);
    } else if (!tieneNumeros(it) && tieneNumeros(fuera[i]!)) {
      const v = fuera[i]!;
      fuera[i] = {
        ...it,
        numeros: v.numeros,
        detalle: v.detalle,
        historial: v.historial,
        medido: v.medido,
        ...(v.medicion !== undefined ? { medicion: v.medicion } : {}),
        ...(v.motivo !== undefined ? { motivo: v.motivo } : {}),
        puede_pedir: false,
      };
    } else fuera[i] = it;
  }
  return fuera;
}

/** Lo que costó una llamada se escribe en TODAS las copias de esa publicación. */
export function conNumeros(lista: Publicacion[], j: LosNumeros, id: string): Publicacion[] {
  return lista.map(o =>
    o.id !== id
      ? o
      : {
          ...o,
          numeros: j.numeros ?? null,
          detalle: Array.isArray(j.detalle) ? j.detalle : [],
          historial: Array.isArray(j.historial) ? j.historial : [],
          medido: j.medido || '',
          medicion: j.medicion || o.medicion || '',
          motivo: j.motivo || '',
          puede_pedir: false,
        },
  );
}
