// Pestanas: `alCambiar` (E2) avisa a qué pestaña se pasó, para que quien la usa cambie lo que depende de ella (el pie de la hoja
// «Agregar videos»). Sin él, las pestañas se portan igual que siempre.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Pestanas } from './Pestanas';

const PESTANAS = [
  { id: 'uno', titulo: 'Mis creaciones', contenido: <p>Lo primero</p> },
  { id: 'dos', titulo: 'Mi computadora', contenido: <p>Lo segundo</p> },
];

describe('Pestanas', () => {
  it('alCambiar se llama con el id de la pestaña a la que se pasa, con el ratón y con las flechas', async () => {
    const alCambiar = vi.fn();
    render(<Pestanas etiqueta="De dónde vienen" pestanas={PESTANAS} alCambiar={alCambiar} />);
    expect(alCambiar).not.toHaveBeenCalled(); // abrir no es cambiar
    await userEvent.click(screen.getByRole('tab', { name: 'Mi computadora' }));
    expect(alCambiar).toHaveBeenLastCalledWith('dos');
    expect(screen.getByText('Lo segundo')).toBeInTheDocument();
    screen.getByRole('tab', { name: 'Mi computadora' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(alCambiar).toHaveBeenLastCalledWith('uno');
    expect(alCambiar).toHaveBeenCalledTimes(2);
  });

  it('sin alCambiar se porta como siempre: cambia de pestaña y no pide nada', async () => {
    render(<Pestanas etiqueta="De dónde vienen" pestanas={PESTANAS} />);
    expect(screen.getByRole('tab', { name: 'Mis creaciones' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: 'Mi computadora' }));
    expect(screen.getByRole('tab', { name: 'Mi computadora' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Lo segundo')).toBeInTheDocument();
  });

  it('volver a tocar la pestaña de ahora no avisa de un cambio que no hubo', async () => {
    const alCambiar = vi.fn();
    render(<Pestanas etiqueta="De dónde vienen" pestanas={PESTANAS} alCambiar={alCambiar} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Mis creaciones' }));
    expect(alCambiar).not.toHaveBeenCalled();
  });
});
