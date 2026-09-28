// UI·18 — así se monta cada pantalla (su principal.tsx). El primer render es
// SÍNCRONO (flushSync): el módulo de la pantalla bloquea el primer pintado
// hasta que termina de correr (vite.config.ts, `blocking="render"`), y así
// la página llega al navegador ya dibujada. Con eso la View Transition entre
// pantallas funde la de antes con esta, y no con un #raiz vacío que un
// instante después se llena de golpe; y lo que llega con nombre (la
// miniatura del inicio → la película en crear) ya está ahí para agrandarse.
import { StrictMode, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

export function montar(pantalla: ReactNode): void {
  const raiz = createRoot(document.getElementById('raiz')!);
  flushSync(() => raiz.render(<StrictMode>{pantalla}</StrictMode>));
}
