// UI·21 — una fila de lista viva: si llegó nueva entra abriendo su espacio
// (clase `fila-entra`, solo al montar) y la clase se va al terminar SU
// animación, no la de un hijo (el destello de un detalle también burbujea).
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FilaViva } from './FilaViva';

const fila = () => screen.getByTestId('hijo').parentElement!;

describe('UI·21 · FilaViva', () => {
  it('la que ya estaba no entra animada, pero es fila viva', () => {
    render(
      <FilaViva nombre="perfil-a" nueva={false}>
        <span data-testid="hijo">A</span>
      </FilaViva>,
    );
    expect(fila()).toHaveClass('fila-viva');
    expect(fila()).not.toHaveClass('fila-entra');
  });

  it('la nueva entra con `fila-entra`', () => {
    render(
      <FilaViva nombre="perfil-a" nueva>
        <span data-testid="hijo">A</span>
      </FilaViva>,
    );
    expect(fila()).toHaveClass('fila-viva', 'fila-entra');
  });

  it('al terminar SU animación se quita `fila-entra`; la de un hijo que burbujea no la quita', () => {
    render(
      <FilaViva nombre="perfil-a" nueva>
        <span data-testid="hijo">A</span>
      </FilaViva>,
    );
    fireEvent.animationEnd(screen.getByTestId('hijo'));
    expect(fila()).toHaveClass('fila-entra');
    fireEvent.animationEnd(fila());
    expect(fila()).not.toHaveClass('fila-entra');
    expect(fila()).toHaveClass('fila-viva');
  });

  it('`nueva` solo cuenta al montar: volverse nueva después no la anima (ni la vuelve a animar)', () => {
    const { rerender } = render(
      <FilaViva nombre="perfil-a" nueva={false}>
        <span data-testid="hijo">A</span>
      </FilaViva>,
    );
    rerender(
      <FilaViva nombre="perfil-a" nueva>
        <span data-testid="hijo">A</span>
      </FilaViva>,
    );
    expect(fila()).not.toHaveClass('fila-entra');
  });

  it('dejar de ser nueva antes de terminar no corta la entrada (solo la corta su animationend)', () => {
    const { rerender } = render(
      <FilaViva nombre="perfil-a" nueva>
        <span data-testid="hijo">A</span>
      </FilaViva>,
    );
    rerender(
      <FilaViva nombre="perfil-a" nueva={false}>
        <span data-testid="hijo">A</span>
      </FilaViva>,
    );
    expect(fila()).toHaveClass('fila-entra');
  });

  it('lleva su nombre en la variable --vt-nombre (la CSS lo usa solo al reordenar)', () => {
    render(
      <FilaViva nombre="cuenta-in-la_2e_cuenta" nueva={false}>
        <span data-testid="hijo">A</span>
      </FilaViva>,
    );
    expect(fila().style.getPropertyValue('--vt-nombre')).toBe('cuenta-in-la_2e_cuenta');
    // nunca como view-transition-name fijo: las transiciones entre pantallas fotografiarían cada fila
    expect(fila().style.viewTransitionName ?? '').toBe('');
  });

  it('por defecto es un <div>; con como="li" pinta un <li>', () => {
    const { unmount } = render(
      <FilaViva nombre="clip-1" nueva={false}>
        <span data-testid="hijo">A</span>
      </FilaViva>,
    );
    expect(fila().tagName).toBe('DIV');
    unmount();
    render(
      <ul>
        <FilaViva nombre="cuenta-a" nueva como="li">
          <span data-testid="hijo">A</span>
        </FilaViva>
      </ul>,
    );
    expect(fila().tagName).toBe('LI');
    expect(fila()).toHaveClass('fila-viva', 'fila-entra');
  });

  it('suma la className que le pasen', () => {
    render(
      <FilaViva nombre="clip-1" nueva={false} className="mb-2">
        <span data-testid="hijo">A</span>
      </FilaViva>,
    );
    expect(fila()).toHaveClass('fila-viva', 'mb-2');
  });
});
