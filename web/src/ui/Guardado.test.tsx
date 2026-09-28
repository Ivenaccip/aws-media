// UI·24 — el «listo» de un formulario: la palomita que se dibuja y «Guardado»
// que se anuncia sin llevarse el foco. jsdom no anima: aquí se mira qué se
// anuncia, dónde queda el foco y qué clases animan; el movimiento de verdad,
// en e2e/formularios.spec.ts.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Aviso } from './Aviso';
import { Boton } from './Boton';
import { Guardado } from './Guardado';

const trazo = (el: Element) => el.querySelector('svg path')!;

function Formulario() {
  const [listo, setListo] = useState(false);
  return (
    <>
      <Boton onClick={() => setListo(true)}>Guardar</Boton>
      {listo && <Guardado />}
    </>
  );
}

describe('Guardado', () => {
  it('UI·24: «Guardado» se anuncia por role=status y el foco se queda donde estaba', async () => {
    render(<Formulario />);
    const boton = screen.getByRole('button', { name: 'Guardar' });
    await userEvent.click(boton);
    const status = screen.getByRole('status');
    // role=status ya es aria-live=polite: espera a que el lector termine
    expect(status).toHaveTextContent('Guardado');
    expect(boton).toHaveFocus();
    expect(status.querySelector('[tabindex]')).toBeNull();
  });

  it('UI·24: la palomita se dibuja (el mismo trazo de «listo») y el texto llega con el resorte', () => {
    render(<Guardado />);
    const p = trazo(screen.getByRole('status'));
    expect(p).toHaveAttribute('d', 'M5 12.5l4.5 4.5L19 7');
    expect(p).toHaveAttribute('pathLength', '1');
    expect(p.getAttribute('class')).toBe('motion-safe:animate-trazo-se-dibuja');
    expect(screen.getByText('Guardado')).toHaveClass('motion-safe:animate-guardado-llega');
    // la palomita es decoración: el nombre lo dice el texto
    expect(screen.getByRole('status').querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('UI·24: quieto (ya estaba guardado) es la misma palomita, sin dibujarse ni anunciarse', () => {
    const { container } = render(<Guardado quieto>Tu Blotato está conectado</Guardado>);
    expect(screen.queryByRole('status')).toBeNull();
    const p = trazo(container);
    expect(p).not.toHaveAttribute('pathLength');
    expect(p).not.toHaveAttribute('class');
    expect(screen.getByText('Tu Blotato está conectado')).not.toHaveAttribute('class');
  });

  it('UI·24: dentro de una región que ya anuncia no abre otra (anuncia={false})', () => {
    render(
      <p role="status">
        <Guardado anuncia={false}>Guardado a las 10:30</Guardado>
      </p>,
    );
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Guardado a las 10:30');
  });
});

describe('Aviso', () => {
  it('UI·24: `dibujar` dibuja la palomita solo en un éxito; sin él, el icono de siempre', () => {
    const { rerender } = render(<Aviso tipo="exito" dibujar>Hora cambiada.</Aviso>);
    expect(trazo(screen.getByRole('status')).getAttribute('class')).toBe('motion-safe:animate-trazo-se-dibuja');
    rerender(<Aviso tipo="exito">Publicación cancelada.</Aviso>);
    expect(trazo(screen.getByRole('status'))).not.toHaveAttribute('class');
    rerender(<Aviso tipo="error" dibujar>No se pudo.</Aviso>);
    expect(trazo(screen.getByRole('alert'))).not.toHaveAttribute('class');
  });
});
