// Un servidor de mentira para los tests de pantallas: cada ruta es un prefijo
// de URL y gana la más larga (/api/x/config antes que /api/x).
import { onTestFinished, vi } from 'vitest';

import type { DetalleCobro } from '../nucleo/globales';

export function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } });
}

export const sinRed = () => Promise.reject(new TypeError('Failed to fetch'));

export type Ruta = (url: string, init?: RequestInit) => Promise<Response> | Response;

export function servidor(rutas: Record<string, Ruta>) {
  const claves = Object.keys(rutas).sort((a, b) => b.length - a.length);
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const clave = claves.find(k => url === k || url.startsWith(k + '/') || url.startsWith(k + '?'));
    if (!clave) throw new Error('ruta no esperada: ' + url);
    return rutas[clave]!(url, init);
  });
  vi.stubGlobal('fetch', f);
  return f;
}

export const llamadas = (f: ReturnType<typeof servidor>, ruta: string, metodo = 'POST') =>
  f.mock.calls.filter(c => c[0] === ruta && (c[1]?.method ?? 'GET') === metodo);

/** window.monedero de mentira, con la recarga abierta o cerrada. */
export function ponerMonedero(saldo: number | null, recarga = true) {
  const m = {
    get: vi.fn(() => ({ saldo })),
    refrescar: vi.fn(),
    recargar: vi.fn(),
    recarga,
    cta: 'Escríbenos por el canal de la comunidad para conseguir más.',
  };
  window.monedero = m;
  return m;
}

/** UI·19: los avisos de cobro que BotonCobro manda a monedero.js (el «−N»
 *  que vuela) durante este test. Un cobro que salió bien deja uno; un 402,
 *  un veto o una validación no dejan ninguno. */
export function oirCobros(): DetalleCobro[] {
  const vistos: DetalleCobro[] = [];
  const oir = (e: CustomEvent<DetalleCobro>) => vistos.push(e.detail);
  window.addEventListener('cobro', oir);
  onTestFinished(() => window.removeEventListener('cobro', oir));
  return vistos;
}
