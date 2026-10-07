// El menú de modelo con un catálogo de PRUEBA que sí trae lo que todavía no
// está activo (varios niveles, un modelo con resolución): así se prueba el
// comportamiento completo aunque hoy solo haya un modelo por tarea.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MenuModelo, type Eleccion } from './MenuModelo';
import type { Grupo } from './modelos';

const GRUPOS: Grupo[] = [
  {
    nivel: 'economico',
    titulo: 'Económicos',
    rango: '2–3',
    modelos: [
      { id: 'grok', nombre: 'Grok Imagine', detalle: 'xAI', nivel: 'economico', activo: true },
      { id: 'flux2', nombre: 'FLUX.2 pro', detalle: 'Black Forest Labs', nivel: 'economico', activo: true },
    ],
  },
  {
    nivel: 'maxima',
    titulo: 'Máxima calidad',
    rango: '14–27',
    modelos: [
      {
        id: 'nbp',
        nombre: 'Nano Banana Pro',
        detalle: 'Google',
        nivel: 'maxima',
        activo: true,
        calidades: [
          { id: '2k', etiqueta: 'hasta 2K' },
          { id: '4k', etiqueta: '4K' },
        ],
      },
    ],
  },
];
const PRECIOS: Record<string, number> = { grok: 2, flux2: 3, 'nbp-2k': 14, 'nbp-4k': 27 };
const precio = (id: string, cal?: string) => PRECIOS[cal ? `${id}-${cal}` : id]!;

function Montado({ alCrear = () => {}, enviando = false, alElegir }: { alCrear?: () => void; enviando?: boolean; alElegir?: (e: Eleccion) => void }) {
  const [e, setE] = useState<Eleccion>({ id: 'grok' });
  return (
    <>
      <button type="button">fuera</button>
      <MenuModelo
        tarea="imagen"
        grupos={GRUPOS}
        elegido={e}
        alElegir={x => {
          setE(x);
          alElegir?.(x);
        }}
        precio={precio}
        alCrear={alCrear}
        enviando={enviando}
      />
    </>
  );
}

const chip = () => screen.getByRole('button', { name: /^Modelo / });
const menu = () => screen.getByRole('dialog', { name: 'Elegir modelo' });

describe('el menú de modelo', () => {
  it('inicio.menumodelo.niveles_precios_y_predeterminado', async () => {
    render(<Montado />);
    expect(chip()).toHaveTextContent('Modelo Grok Imagine');
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(chip());
    const m = within(menu());
    expect(m.getByText('Económicos')).toBeInTheDocument();
    expect(m.getByText('Máxima calidad')).toBeInTheDocument();
    expect(menu()).toHaveTextContent('✦ 2–3 por imagen');
    expect(m.getByRole('radio', { name: /Grok Imagine/ })).toHaveTextContent('Predeterminado');
    expect(m.getByRole('radio', { name: /FLUX\.2 pro/ })).not.toHaveTextContent('Predeterminado');
    // con resolución, el precio de la fila es el «desde»
    expect(m.getByRole('radio', { name: /Nano Banana Pro/ })).toHaveTextContent('desde ✦ 14');
    // el pie dice el modelo elegido y su precio
    expect(menu()).toHaveTextContent('Grok Imagine✦ 2 por imagen');
  });

  it('inicio.menumodelo.la_resolucion_solo_aparece_en_el_modelo_que_la_tiene', async () => {
    const alElegir = vi.fn();
    render(<Montado alElegir={alElegir} />);
    await userEvent.click(chip());
    expect(within(menu()).queryByRole('radiogroup', { name: 'Resolución' })).toBeNull();
    await userEvent.click(within(menu()).getByRole('radio', { name: /Nano Banana Pro/ }));
    const res = within(menu()).getByRole('radiogroup', { name: 'Resolución' });
    expect(within(res).getByRole('radio', { name: /hasta 2K/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(res).getByRole('radio', { name: /4K/ })).toHaveTextContent('✦ 27');
    expect(chip()).toHaveTextContent('Modelo Nano Banana Pro · hasta 2K');
    expect(menu()).toHaveTextContent('✦ 14 por imagen');
    await userEvent.click(within(res).getByRole('radio', { name: /4K/ }));
    expect(alElegir).toHaveBeenLastCalledWith({ id: 'nbp', calidad: '4k' });
    expect(chip()).toHaveTextContent('Modelo Nano Banana Pro · 4K');
    expect(menu()).toHaveTextContent('✦ 27 por imagen');
    // volver a un modelo sin resolución la quita
    await userEvent.click(within(menu()).getByRole('radio', { name: /FLUX\.2 pro/ }));
    expect(within(menu()).queryByRole('radiogroup', { name: 'Resolución' })).toBeNull();
    expect(menu()).toHaveTextContent('✦ 3 por imagen');
  });

  it('inicio.menumodelo.crear_va_en_el_pie_y_no_acepta_dos_clics_mientras_trabaja', async () => {
    const alCrear = vi.fn();
    const { rerender } = render(<Montado alCrear={alCrear} />);
    await userEvent.click(chip());
    await userEvent.click(within(menu()).getByRole('button', { name: 'Crear' }));
    expect(alCrear).toHaveBeenCalledTimes(1);
    rerender(<Montado alCrear={alCrear} enviando />);
    const boton = within(menu()).getByRole('button', { name: 'Generando…' });
    await userEvent.click(boton);
    expect(alCrear).toHaveBeenCalledTimes(1);
  });

  it('inicio.menumodelo.teclado_y_cierres', async () => {
    render(<Montado />);
    chip().focus();
    await userEvent.keyboard('{Enter}');
    // al abrir, el foco va al modelo elegido
    expect(within(menu()).getByRole('radio', { name: /Grok Imagine/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(menu()).getByRole('radio', { name: /FLUX\.2 pro/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(menu()).getByRole('radio', { name: /FLUX\.2 pro/ })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(within(menu()).getByRole('radio', { name: /Nano Banana Pro/ })).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{Home}');
    expect(within(menu()).getByRole('radio', { name: /Grok Imagine/ })).toHaveAttribute('aria-checked', 'true');
    // Esc cierra y devuelve el foco al chip
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(chip()).toHaveFocus();
    // un clic fuera también
    await userEvent.click(chip());
    await userEvent.click(screen.getByRole('button', { name: 'fuera' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
