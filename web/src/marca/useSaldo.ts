// El prefijo «use» lo exige React (reglas de los hooks), no es spanglish gratuito.
// El saldo que conoce /monedero.js (la píldora de arriba). monedero.js avisa
// con el evento «monedero» cada vez que lo trae; aquí solo se escucha.
// null = todavía no se sabe (o los créditos están apagados): nadie bloquea
// por un saldo que no conoce.
import { useSyncExternalStore } from 'react';

function suscribir(avisar: () => void): () => void {
  document.addEventListener('monedero', avisar);
  return () => document.removeEventListener('monedero', avisar);
}

function leer(): number | null {
  const s = window.monedero?.get()?.saldo;
  return typeof s === 'number' ? s : null;
}

export function useSaldo(): number | null {
  return useSyncExternalStore(suscribir, leer, () => null);
}

/** Pide a monedero.js el saldo nuevo (después de cobrar o devolver). */
export function refrescarSaldo(): void {
  window.monedero?.refrescar();
}
