import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
