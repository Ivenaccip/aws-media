// UI·22 — el calendario de Mix cambia de mes con dirección. jsdom no tiene
// View Transitions: sin ellas el mes cambia al instante (lo de hoy), y con un
// stub se comprueba qué tipo pide cada flecha y que el tope aguanta dos clics.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Calendario, nombreMes } from './Calendario';

const hoy = new Date();
const mes = (n: number) => nombreMes(new Date(hoy.getFullYear(), hoy.getMonth() + n, 1));
const aLaVista = () => document.querySelector('[data-cal="mes-0"]')?.textContent;

function pintar() {
  return render(<Calendario ini={null} fin={null} maxDias={60} alElegir={() => {}} alLimpiar={() => {}} />);
}

// un startViewTransition de mentira: anota los tipos y, si se pide, deja el
// cambio pendiente (como el navegador, que pinta un cuadro después)
function conTransiciones(diferir = false) {
  const tipos: string[][] = [];
  const pendientes: Array<() => void> = [];
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: (o: StartViewTransitionOptions) => {
      tipos.push([...(o.types ?? [])]);
      const correr = () => o.update?.();
      if (diferir) pendientes.push(correr);
      else correr();
      const hecho = Promise.resolve();
      return { ready: hecho, finished: hecho, updateCallbackDone: hecho, skipTransition() {}, types: new Set() };
    },
  });
  vi.stubGlobal('ViewTransition', class { get types() { return null; } });
  return { tipos, pendientes };
}

afterEach(() => {
  Reflect.deleteProperty(document, 'startViewTransition');
  vi.unstubAllGlobals();
});

describe('UI·22 · el calendario tiene dirección', () => {
  it('sin View Transitions (jsdom, navegadores viejos) las flechas cambian el mes al instante', () => {
    pintar();
    expect(aLaVista()).toBe(mes(0));
    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    expect(aLaVista()).toBe(mes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Mes anterior' }));
    expect(aLaVista()).toBe(mes(0));
    // no se retrocede antes del mes en curso
    expect(screen.getByRole('button', { name: 'Mes anterior' })).toBeDisabled();
  });

  it('«Mes siguiente» pide el tipo adelante y «Mes anterior» el tipo atras', () => {
    const { tipos } = conTransiciones();
    pintar();
    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mes anterior' }));
    expect(tipos).toEqual([['adelante'], ['atras']]);
    expect(aLaVista()).toBe(mes(0));
  });

  it('con el cambio diferido, dos clics en «Mes anterior» no pasan del mes en curso', () => {
    const { pendientes } = conTransiciones(true);
    pintar();
    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    act(() => pendientes.shift()!());
    expect(aLaVista()).toBe(mes(1));
    // el botón sigue habilitado hasta que la transición pinta: dos clics
    const anterior = screen.getByRole('button', { name: 'Mes anterior' });
    fireEvent.click(anterior);
    fireEvent.click(anterior);
    act(() => {
      while (pendientes.length) pendientes.shift()!();
    });
    expect(aLaVista()).toBe(mes(0));
  });

  it('con «reducir movimiento» no hay transición: al instante', () => {
    const { tipos } = conTransiciones();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
    pintar();
    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    expect(tipos).toEqual([]);
    expect(aLaVista()).toBe(mes(1));
  });

  it('el mes a la vista se anuncia por aria-live (antes nadie lo decía)', () => {
    pintar();
    const vivo = document.querySelector('[aria-live="polite"]');
    expect(vivo).toHaveTextContent(mes(0));
    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    expect(vivo).toHaveTextContent(mes(1));
  });

  it('las dos casillas llevan su marca para la transición (mes y días)', () => {
    pintar();
    for (const m of ['mes-0', 'dias-0', 'mes-1', 'dias-1']) expect(document.querySelector(`[data-cal="${m}"]`)).not.toBeNull();
  });
});
