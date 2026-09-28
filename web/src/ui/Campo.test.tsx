import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Campo } from './Campo';
import { TablaDatos } from './TablaDatos';

describe('Campo', () => {
  it('la etiqueta nombra el campo y el error lo describe', () => {
    render(<Campo etiqueta="Tu correo" error="Falta la arroba" ayuda="El de tu cuenta" />);
    const c = screen.getByRole('textbox', { name: 'Tu correo' });
    expect(c).toHaveAttribute('aria-invalid', 'true');
    expect(c).toHaveAccessibleDescription('Falta la arroba El de tu cuenta');
  });
});

// UI·24: jsdom no anima; lo que se mira es la clase que pone el temblor y el
// animationend que lo quita (en un navegador, e2e/formularios.spec.ts)
describe('Campo · el temblor (UI·24)', () => {
  const caja = () => screen.getByRole('textbox', { name: 'Tu correo' });
  const tiembla = () => caja().className.includes('animate-campo-tiembla');
  const campo = (valor: string, error?: string) => (
    <Campo etiqueta="Tu correo" value={valor} onChange={() => {}} {...(error ? { error } : {})} />
  );

  it('UI·24: tiembla solo al pasar de sin error a con error: ni en cada tecla ni si cambia el texto', () => {
    const { rerender } = render(campo(''));
    expect(tiembla()).toBe(false);
    rerender(campo('ana', 'Falta la arroba'));
    expect(tiembla()).toBe(true);
    fireEvent.animationEnd(caja());
    expect(tiembla()).toBe(false);
    // más teclas con el mismo error puesto
    rerender(campo('anab', 'Falta la arroba'));
    expect(tiembla()).toBe(false);
    // otro texto de error sin pasar por «sin error»: no es otra aparición
    rerender(campo('anab@', 'Falta lo de después de la arroba'));
    expect(tiembla()).toBe(false);
    // se arregla y vuelve a fallar: esa sí
    rerender(campo('anab@x.com'));
    expect(tiembla()).toBe(false);
    rerender(campo('anab@x', 'Falta el .com'));
    expect(tiembla()).toBe(true);
  });

  it('UI·24: el temblor es un extra: el mensaje y aria-invalid llegan igual, y sin error se van', () => {
    const { rerender } = render(campo('ana'));
    expect(caja()).not.toHaveAttribute('aria-invalid');
    rerender(campo('ana', 'Falta la arroba'));
    expect(caja()).toHaveAttribute('aria-invalid', 'true');
    expect(caja()).toHaveAccessibleDescription('Falta la arroba');
    rerender(campo('ana@x.com'));
    expect(caja()).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText('Falta la arroba')).toBeNull();
  });

  it('UI·24: el campo que ya nace con error no tiembla', () => {
    render(campo('ana', 'Falta la arroba'));
    expect(caja()).toHaveAttribute('aria-invalid', 'true');
    expect(tiembla()).toBe(false);
  });

  it('UI·24: se quita al terminar y el onAnimationEnd de quien lo usa también corre', () => {
    const suyo = vi.fn();
    const { rerender } = render(<Campo etiqueta="Tu correo" onAnimationEnd={suyo} />);
    rerender(<Campo etiqueta="Tu correo" onAnimationEnd={suyo} error="Falta la arroba" />);
    expect(tiembla()).toBe(true);
    fireEvent.animationEnd(caja());
    expect(tiembla()).toBe(false);
    expect(suyo).toHaveBeenCalledTimes(1);
  });

  it('UI·24: el temblor va con motion-safe: con «reducir movimiento» ni arranca', () => {
    const { rerender } = render(campo(''));
    rerender(campo('a', 'Falta la arroba'));
    expect(caja().className.split(/\s+/)).toContain('motion-safe:animate-campo-tiembla');
  });
});

describe('TablaDatos', () => {
  it('encabezados de columna de verdad y título accesible', () => {
    render(
      <TablaDatos titulo="Usuarios" filas={[{ id: 'a', n: 3 }]} claveFila={f => f.id}
        columnas={[{ clave: 'id', titulo: 'Quién', celda: f => f.id },
                   { clave: 'n', titulo: 'Saldo', celda: f => f.n, numerica: true }]} />,
    );
    expect(screen.getByRole('table', { name: 'Usuarios' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Quién', 'Saldo']);
  });
});
