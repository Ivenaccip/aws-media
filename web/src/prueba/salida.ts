// UI·20 — jsdom no anima, no tiene CSS.escape y su getComputedStyle es una
// foto: el Presence de Radix desmonta los diálogos al instante. Esto le hace
// ver una animación de salida en todo [data-state] cerrado y deja terminarla
// a mano, para probar lo que pasa DURANTE los 100 ms en que la caja se va.
// Solo en tests de diálogos: toca también a las pestañas (TabsContent), que
// usan el mismo Presence.
import { act } from '@testing-library/react';
import { onTestFinished, vi } from 'vitest';

export function simularSalida(): { terminar: () => void } {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    const foto = real(el, pseudo);
    return new Proxy(foto, {
      get(t, p) {
        if (p === 'animationName' && el instanceof Element && el.hasAttribute('data-state'))
          return el.getAttribute('data-state') === 'closed' ? 'prueba-sale' : 'prueba-entra';
        const v: unknown = Reflect.get(t, p);
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
  });
  // Presence escapa el nombre con CSS.escape, que jsdom no trae
  vi.stubGlobal('CSS', { escape: (s: string) => s });
  onTestFinished(() => {
    vi.unstubAllGlobals(); // restoreMocks no deshace stubGlobal
  });
  return {
    terminar() {
      for (const n of document.querySelectorAll('[data-state="closed"]')) {
        const ev = new Event('animationend');
        Object.defineProperty(ev, 'animationName', { value: 'prueba-sale' });
        act(() => {
          n.dispatchEvent(ev);
        });
      }
    },
  };
}
