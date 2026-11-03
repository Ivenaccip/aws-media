// Pestanas: `alCambiar` (E2) avisa a qué pestaña se pasó, para que quien la usa cambie lo que depende de ella (el pie de la hoja
// «Agregar videos»). Sin él, las pestañas se portan igual que siempre.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
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

  // `conservar`: una pestaña con algo en curso (una subida, un formulario escrito) sigue montada, oculta, al irse a otra
  describe('conservar', () => {
    function Contador({ alMontar }: { alMontar: () => void }) {
      const [veces, setVeces] = useState(0);
      useEffect(alMontar, [alMontar]);
      return <button onClick={() => setVeces(v => v + 1)}>Sumar {veces}</button>;
    }
    const conConservada = (alMontar: () => void) => [
      { id: 'uno', titulo: 'Resumen', contenido: <p>Lo primero</p> },
      { id: 'dos', titulo: 'Clases', contenido: <Contador alMontar={alMontar} />, conservar: true },
      { id: 'tres', titulo: 'Flujo', contenido: <p>Lo tercero</p> },
    ];

    it('no se monta hasta la primera visita, y después se queda montada (oculta) con su estado', async () => {
      const alMontar = vi.fn();
      render(<Pestanas etiqueta="Vistas" pestanas={conConservada(alMontar)} />);
      expect(alMontar).not.toHaveBeenCalled(); // lo que pide datos al abrirse sigue esperando a que se abra
      await userEvent.click(screen.getByRole('tab', { name: 'Clases' }));
      expect(alMontar).toHaveBeenCalledOnce();
      await userEvent.click(screen.getByRole('button', { name: 'Sumar 0' }));
      // se va: ya no se ve ni se lee, pero sigue en el DOM con lo que tenía
      await userEvent.click(screen.getByRole('tab', { name: 'Flujo' }));
      expect(screen.queryByRole('button', { name: /Sumar/ })).toBeNull();
      expect(screen.getByText('Lo tercero')).toBeInTheDocument();
      const panel = screen.getByText('Sumar 1').closest('[role="tabpanel"]');
      expect(panel).toHaveAttribute('hidden');
      // vuelve: el mismo contador, sin montarse otra vez
      await userEvent.click(screen.getByRole('tab', { name: 'Clases' }));
      expect(screen.getByRole('button', { name: 'Sumar 1' })).toBeInTheDocument();
      expect(panel).not.toHaveAttribute('hidden');
      expect(alMontar).toHaveBeenCalledOnce();
    });

    it('las demás pestañas se portan como siempre: solo la de ahora está montada', async () => {
      render(<Pestanas etiqueta="Vistas" pestanas={conConservada(vi.fn())} />);
      expect(screen.getByText('Lo primero')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('tab', { name: 'Flujo' }));
      expect(screen.queryByText('Lo primero')).toBeNull();
      expect(document.body).not.toHaveTextContent('Lo primero');
      await userEvent.click(screen.getByRole('tab', { name: 'Resumen' }));
      expect(screen.queryByText('Lo tercero')).toBeNull();
      // la conservada, que nunca se visitó, tampoco está
      expect(screen.queryByRole('button', { name: /Sumar/ })).toBeNull();
      // Radix deja los paneles de las otras pestañas ocultos y VACÍOS: lo único con contenido es el de ahora
      expect([...document.querySelectorAll('[role="tabpanel"]')].filter(p => p.textContent)).toHaveLength(1);
    });

    it('la que arranca abierta ya es una visita, y el teclado cambia de pestaña igual', async () => {
      const alCambiar = vi.fn();
      const alMontar = vi.fn();
      render(<Pestanas etiqueta="Vistas" inicial="dos" pestanas={conConservada(alMontar)} alCambiar={alCambiar} />);
      expect(alMontar).toHaveBeenCalledOnce();
      screen.getByRole('tab', { name: 'Clases' }).focus();
      await userEvent.keyboard('{ArrowRight}');
      expect(alCambiar).toHaveBeenLastCalledWith('tres');
      expect(screen.getByText('Lo tercero')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Sumar/ })).toBeNull();
      await userEvent.keyboard('{ArrowLeft}');
      expect(screen.getByRole('button', { name: 'Sumar 0' })).toBeInTheDocument();
      expect(alMontar).toHaveBeenCalledOnce();
    });
  });
});
