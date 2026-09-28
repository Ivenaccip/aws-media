// UI·23 — la marca de «la primera vez que entra en pantalla». jsdom no tiene
// IntersectionObserver ni matchMedia, y todo mide 0: aquí se ponen a mano.
import { fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ponerObservador } from '../prueba/observador';
import { olvidarApariciones, useAparecerUnaVez } from './useAparecerUnaVez';

function Prueba({ clave = 'a' }: { clave?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useAparecerUnaVez(ref, clave);
  return (
    <div ref={ref} data-testid="g">
      <span data-testid="otra" />
      <span data-testid="fin" data-final="" />
    </div>
  );
}

const marcada = () => screen.getByTestId('g').hasAttribute('data-entra');

// getBoundingClientRect de algo que se ve entero en la ventana
function aLaVista() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 100, bottom: 200, height: 100, left: 0, right: 100, width: 100, x: 0, y: 100, toJSON() {},
  } as DOMRect);
}

beforeEach(() => olvidarApariciones());
afterEach(() => vi.unstubAllGlobals());

describe('useAparecerUnaVez', () => {
  it('UI·23: sin IntersectionObserver no marca nada: se ve completo', () => {
    render(<Prueba />);
    expect(marcada()).toBe(false);
  });

  it('UI·23: fuera de la pantalla espera a que entre, y entonces deja de mirar', () => {
    const IO = ponerObservador();
    render(<Prueba />);
    expect(IO.todos).toHaveLength(1);
    // con margen: la marca llega justo antes de asomar
    expect(IO.ultimo().opciones?.rootMargin).toMatch(/^\d+px 0px$/);
    IO.ultimo().cruzar(false);
    expect(marcada()).toBe(false);
    IO.ultimo().cruzar();
    expect(marcada()).toBe(true);
    expect(IO.ultimo().objetivos.size).toBe(0);
  });

  it('UI·23: si ya está a la vista marca antes de pintar, sin observador', () => {
    const IO = ponerObservador();
    aLaVista();
    render(<Prueba />);
    expect(marcada()).toBe(true);
    expect(IO.todos).toHaveLength(0);
  });

  it('UI·23: solo la primera vez por clave', () => {
    ponerObservador();
    aLaVista();
    const { unmount } = render(<Prueba clave="a" />);
    expect(marcada()).toBe(true);
    unmount();
    const otra = render(<Prueba clave="a" />);
    expect(marcada()).toBe(false);
    otra.unmount();
    render(<Prueba clave="b" />);
    expect(marcada()).toBe(true);
  });

  it('UI·23: al volver con el scroll no se repite', () => {
    const IO = ponerObservador();
    render(<Prueba />);
    IO.ultimo().cruzar();
    fireEvent.animationEnd(screen.getByTestId('fin'));
    expect(marcada()).toBe(false);
    // ya no hay a quién avisar: el observador se desconectó al entrar
    IO.ultimo().cruzar(false);
    IO.ultimo().cruzar();
    expect(marcada()).toBe(false);
  });

  it('UI·23: la marca se va cuando acaba lo último (data-final), no antes', () => {
    ponerObservador();
    aLaVista();
    render(<Prueba />);
    fireEvent.animationEnd(screen.getByTestId('otra'));
    expect(marcada()).toBe(true);
    fireEvent.animationEnd(screen.getByTestId('fin'));
    expect(marcada()).toBe(false);
  });

  it('UI·23: en StrictMode (efectos dobles) marca una vez y el oyente sigue puesto', () => {
    const IO = ponerObservador();
    const fuera = render(
      <StrictMode>
        <Prueba clave="fuera" />
      </StrictMode>,
    );
    // el primer observador se desconectó en la limpieza; manda el segundo
    expect(IO.todos).toHaveLength(2);
    expect(IO.todos[0]!.objetivos.size).toBe(0);
    IO.ultimo().cruzar();
    expect(marcada()).toBe(true);
    fuera.unmount();

    aLaVista();
    render(
      <StrictMode>
        <Prueba clave="dentro" />
      </StrictMode>,
    );
    expect(marcada()).toBe(true);
    fireEvent.animationEnd(screen.getByTestId('fin'));
    expect(marcada()).toBe(false);
  });

  it('UI·23: con «reducir movimiento» no marca, aunque esté a la vista', () => {
    const IO = ponerObservador();
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }));
    aLaVista();
    render(<Prueba />);
    expect(marcada()).toBe(false);
    expect(IO.todos).toHaveLength(0);
  });
});
