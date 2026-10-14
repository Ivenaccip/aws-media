// useMovimientoReducido y usePestanaOculta: leen el valor de verdad, reaccionan cuando cambia y no dejan oyentes puestos.
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMovimientoReducido, usePestanaOculta } from './useAmbiente';

afterEach(() => {
  vi.unstubAllGlobals();
  delete (document as { hidden?: boolean }).hidden;
});

describe('useMovimientoReducido', () => {
  function ponerMatchMedia(inicial: boolean) {
    const oyentes = new Set<() => void>();
    let valor = inicial;
    const consultas: string[] = [];
    vi.stubGlobal('matchMedia', (consulta: string) => {
      consultas.push(consulta);
      return {
        get matches() {
          return valor;
        },
        addEventListener: (_tipo: string, f: () => void) => oyentes.add(f),
        removeEventListener: (_tipo: string, f: () => void) => oyentes.delete(f),
      };
    });
    return {
      oyentes,
      consultas,
      cambiar(nuevo: boolean) {
        valor = nuevo;
        act(() => oyentes.forEach(f => f()));
      },
    };
  }

  it('lee la preferencia del sistema y se vuelve a leer cuando cambia', () => {
    const sistema = ponerMatchMedia(true);
    const { result } = renderHook(() => useMovimientoReducido());
    expect(result.current).toBe(true);
    expect(sistema.consultas).toContain('(prefers-reduced-motion: reduce)');
    sistema.cambiar(false);
    expect(result.current).toBe(false);
    sistema.cambiar(true);
    expect(result.current).toBe(true);
  });

  it('no deja el oyente puesto al desmontar', () => {
    const sistema = ponerMatchMedia(false);
    const { unmount } = renderHook(() => useMovimientoReducido());
    expect(sistema.oyentes.size).toBe(1);
    unmount();
    expect(sistema.oyentes.size).toBe(0);
  });

  it('sin matchMedia (jsdom) nadie pide reducir nada', () => {
    expect(typeof matchMedia).toBe('undefined');
    const { result } = renderHook(() => useMovimientoReducido());
    expect(result.current).toBe(false);
  });
});

describe('usePestanaOculta', () => {
  function ponerPestana(oculta: boolean) {
    let valor = oculta;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => valor });
    return (nuevo: boolean) => {
      valor = nuevo;
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    };
  }

  it('dice si la pestaña está oculta y reacciona al cambio de visibilidad', () => {
    const ver = ponerPestana(false);
    const { result } = renderHook(() => usePestanaOculta());
    expect(result.current).toBe(false);
    ver(true);
    expect(result.current).toBe(true);
    ver(false);
    expect(result.current).toBe(false);
  });

  it('arranca oculta si ya lo estaba y suelta el oyente al desmontar', () => {
    ponerPestana(true);
    const quitar = vi.spyOn(document, 'removeEventListener');
    const { result, unmount } = renderHook(() => usePestanaOculta());
    expect(result.current).toBe(true);
    unmount();
    expect(quitar).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
