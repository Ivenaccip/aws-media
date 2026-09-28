// UI·23 — jsdom no tiene IntersectionObserver. Este es uno de mentira al que
// se le dice a mano cuándo entra algo en pantalla: se instala con
// ponerObservador() y la prueba lo quita al terminar (vi.unstubAllGlobals no
// hace falta llamarlo: onTestFinished lo hace).
import { act } from '@testing-library/react';
import { onTestFinished, vi } from 'vitest';

export class ObservadorFalso {
  static todos: ObservadorFalso[] = [];
  objetivos = new Set<Element>();
  readonly opciones: IntersectionObserverInit | undefined;
  private readonly cb: IntersectionObserverCallback;

  constructor(cb: IntersectionObserverCallback, opciones?: IntersectionObserverInit) {
    this.cb = cb;
    this.opciones = opciones;
    ObservadorFalso.todos.push(this);
  }
  observe(el: Element) {
    this.objetivos.add(el);
  }
  unobserve(el: Element) {
    this.objetivos.delete(el);
  }
  disconnect() {
    this.objetivos.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  /** Avisa a los que sigue mirando de que entraron (o de que no). */
  cruzar(entra = true) {
    act(() => {
      for (const t of [...this.objetivos])
        this.cb([{ target: t, isIntersecting: entra } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    });
  }
  /** El último que se creó: en StrictMode, el que sobrevive. */
  static ultimo(): ObservadorFalso {
    return ObservadorFalso.todos[ObservadorFalso.todos.length - 1]!;
  }
}

export function ponerObservador(): typeof ObservadorFalso {
  ObservadorFalso.todos = [];
  vi.stubGlobal('IntersectionObserver', ObservadorFalso);
  onTestFinished(() => {
    vi.unstubAllGlobals();
    ObservadorFalso.todos = [];
  });
  return ObservadorFalso;
}
