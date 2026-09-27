// Cómo se escriben los números en la interfaz (CLAUDE.md y docs/DISENO.md):
//   dólares → "$0.21 dólares" (jamás «centavos»)
//   créditos → enteros, con la estrella: "✦ 100"
import { ESTRELLA } from './estrella';

const ENTERO = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

export function dolares(usd: number): string {
  if (!Number.isFinite(usd)) throw new RangeError('dolares(): no es un número');
  return '$' + usd.toFixed(2) + ' dólares';
}

export function entero(n: number): string {
  return ENTERO.format(Math.round(n));
}

// Sin plantilla con la estrella a propósito: el guardián M21 lee las
// plantillas con la estrella como etiquetas de botón («Verbo ✦ N»), y esto no lo es.
export function creditos(n: number): string {
  return ESTRELLA + ' ' + entero(n);
}

export function duracion(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? m + ' min ' + r + ' s' : m + ' min';
}
