import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Confirmar } from './Confirmar';
import { Dialogo } from './Dialogo';

describe('Confirmar', () => {
  it('es un alertdialog y el foco arranca en Cancelar', () => {
    render(
      <Confirmar abierto alCambiar={() => {}} titulo="¿Borrar?" descripcion="No se deshace."
        confirmar="Borrar" peligro alConfirmar={() => {}} />,
    );
    expect(screen.getByRole('alertdialog', { name: '¿Borrar?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  });

  it('confirmar llama una vez y cierra', async () => {
    const alConfirmar = vi.fn();
    const alCambiar = vi.fn();
    render(
      <Confirmar abierto alCambiar={alCambiar} titulo="¿Apagar?" descripcion="…"
        confirmar="Apagar" alConfirmar={alConfirmar} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Apagar' }));
    expect(alConfirmar).toHaveBeenCalledOnce();
    expect(alCambiar).toHaveBeenCalledWith(false);
  });
});

describe('Dialogo', () => {
  it('Esc cierra y el texto del usuario entra como texto', async () => {
    const alCambiar = vi.fn();
    render(
      <Dialogo abierto alCambiar={alCambiar} titulo="Revisa tu texto">
        <p>{'<img src=x onerror=alert(1)>'}</p>
      </Dialogo>,
    );
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(alCambiar).toHaveBeenCalledWith(false);
  });
});

function ConBoton({ tipo }: { tipo: 'dialogo' | 'confirmar' }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button onClick={() => setAbierto(true)}>Abrir</button>
      {tipo === 'dialogo'
        ? <Dialogo abierto={abierto} alCambiar={setAbierto} titulo="Hola" />
        : <Confirmar abierto={abierto} alCambiar={setAbierto} titulo="¿Seguro?" descripcion="…"
            confirmar="Sí" alConfirmar={() => {}} />}
    </>
  );
}

describe('el foco vuelve a quien abrió', () => {
  it.each(['dialogo', 'confirmar'] as const)('%s: al cerrar con Esc', async tipo => {
    render(<ConBoton tipo={tipo} />);
    const abrir = screen.getByRole('button', { name: 'Abrir' });
    await userEvent.click(abrir);
    expect(abrir).not.toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(abrir).toHaveFocus());
  });
});
