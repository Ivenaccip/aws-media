// UI·21 — jsdom no tiene View Transitions. Esto pone unas de mentira para
// que nucleo/transiciones.ts → transicionar() tome el camino animado:
//
//   · un ViewTransition con `types` en su prototype (Chrome 125+, Safari
//     18.2+). Con `sinTipos` es un Chrome 111-124, que solo acepta una
//     función: ahí transicionar() tiene que ir al instante;
//   · un document.startViewTransition espía que corre el `update` en el acto
//     o, con `diferir`, lo guarda hasta que el test llama a correr(): el
//     navegador primero fotografía la pantalla vieja y pinta la nueva un
//     cuadro después, y en ese hueco pueden pasar otras cosas.
//
// Se quita sola al terminar el test; quitarVT() lo hace a mano.
import { act } from '@testing-library/react';
import { onTestFinished, vi } from 'vitest';

export interface OpcionesVT {
  /** Guarda cada `update` hasta que el test llame a correr(). */
  diferir?: boolean;
  /** La transición se salta (otra la pisó): sus tres promesas se rechazan. */
  saltada?: boolean;
  /** ViewTransition sin `types` en el prototype. */
  sinTipos?: boolean;
  /** Corre justo después de cada `update`, antes de que el espía vuelva. */
  trasUpdate?: () => void;
}

type Iniciar = (arg?: ViewTransitionUpdateCallback | StartViewTransitionOptions) => ViewTransition;

export interface VTFalsa {
  espia: ReturnType<typeof vi.fn<Iniciar>>;
  /** Los `types` de cada llamada a startViewTransition, en orden. */
  tipos: string[][];
  /** Cuántos `update` diferidos siguen esperando. */
  readonly pendientes: number;
  /** Corre (dentro de act) los `update` diferidos, en orden. */
  correr(): void;
}

export function quitarVT(): void {
  Reflect.deleteProperty(document, 'startViewTransition');
  vi.unstubAllGlobals();
}

export function simularVT(op: OpcionesVT = {}): VTFalsa {
  class ViewTransitionFalsa {}
  if (!op.sinTipos)
    Object.defineProperty(ViewTransitionFalsa.prototype, 'types', { get: () => new Set<string>(), configurable: true });
  vi.stubGlobal('ViewTransition', ViewTransitionFalsa);

  const tipos: string[][] = [];
  const cola: Array<() => void> = [];

  const espia = vi.fn<Iniciar>(arg => {
    const opciones: StartViewTransitionOptions = typeof arg === 'function' ? { update: arg } : (arg ?? {});
    tipos.push([...(opciones.types ?? [])]);
    const update = () => {
      void opciones.update?.();
      op.trasUpdate?.();
    };
    let hecho: Promise<void>;
    if (op.diferir) {
      hecho = new Promise<void>((listo, mal) =>
        cola.push(() => {
          try {
            update();
            listo();
          } catch (e) {
            mal(e);
          }
        }),
      );
    } else {
      update();
      hecho = Promise.resolve();
    }
    const saltada = () => Promise.reject(new DOMException('Transition was skipped', 'AbortError'));
    return {
      ready: op.saltada ? saltada() : Promise.resolve(),
      finished: op.saltada ? saltada() : hecho,
      updateCallbackDone: op.saltada ? saltada() : hecho,
      types: new Set(opciones.types ?? []),
      skipTransition: () => undefined,
    } as unknown as ViewTransition;
  });
  Object.defineProperty(document, 'startViewTransition', { value: espia, configurable: true, writable: true });
  onTestFinished(quitarVT);

  return {
    espia,
    tipos,
    get pendientes() {
      return cola.length;
    },
    correr() {
      act(() => {
        while (cola.length) cola.shift()!();
      });
    },
  };
}
