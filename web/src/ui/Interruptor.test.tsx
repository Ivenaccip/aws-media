import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Interruptor } from './Interruptor';

const pintar = (props: Partial<React.ComponentProps<typeof Interruptor>> = {}) => {
  const alCambiar = vi.fn();
  render(
    <>
      <span id="et">Audio</span>
      <Interruptor activo={true} alCambiar={alCambiar} aria-labelledby="et" {...props} />
    </>,
  );
  return { alCambiar, sw: screen.getByRole('switch', { name: 'Audio' }) };
};

describe('Interruptor', () => {
  it('es un switch con su estado, y al tocarlo pide el contrario', async () => {
    const { alCambiar, sw } = pintar({ activo: true });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw).not.toHaveAttribute('aria-disabled');
    await userEvent.click(sw);
    expect(alCambiar).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('apagado pide encenderse, y se maneja con la barra espaciadora y con Enter', async () => {
    const { alCambiar, sw } = pintar({ activo: false });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    sw.focus();
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{Enter}');
    expect(alCambiar).toHaveBeenCalledTimes(2);
    expect(alCambiar).toHaveBeenNthCalledWith(1, true);
  });

  it('bloqueado no cambia nada pero sigue en el orden del teclado y apunta a su motivo', async () => {
    const { alCambiar, sw } = pintar({ bloqueado: true, 'aria-describedby': 'et' });
    expect(sw).toHaveAttribute('aria-disabled', 'true');
    expect(sw).not.toBeDisabled(); // un `disabled` no recibe el foco y su motivo no se leería
    expect(sw).toHaveAccessibleDescription('Audio');
    await userEvent.click(sw);
    sw.focus();
    await userEvent.keyboard(' ');
    expect(sw).toHaveFocus();
    expect(alCambiar).not.toHaveBeenCalled();
  });

  it('respeta el onClick de quien lo usa, aun bloqueado', async () => {
    const onClick = vi.fn();
    const { alCambiar, sw } = pintar({ bloqueado: true, onClick });
    await userEvent.click(sw);
    expect(onClick).toHaveBeenCalledOnce();
    expect(alCambiar).not.toHaveBeenCalled();
  });

  it('encendido NO es el ámbar del botón principal: lleva el tono de «elegido» (borde #a96716, fondo #2e2110) y la bolita en ámbar claro', () => {
    const { sw } = pintar({ activo: true });
    const pista = sw.firstElementChild!;
    expect(pista).toHaveClass('border-ambar-hondo', 'bg-aviso-fondo');
    expect(pista).not.toHaveClass('bg-ambar');
    expect(pista).not.toHaveClass('border-ambar');
    const bolita = pista.firstElementChild!;
    expect(bolita).toHaveClass('bg-ambar-claro', 'translate-x-[18px]');
    expect(bolita).not.toHaveClass('bg-ambar');
    // ni el sw ni nada de adentro usa el fondo exacto del botón principal
    expect([sw, ...sw.querySelectorAll('*')].filter(e => e.classList.contains('bg-ambar'))).toEqual([]);
  });

  it('apagado se queda en gris y la bolita, a la izquierda', () => {
    const { sw } = pintar({ activo: false });
    const pista = sw.firstElementChild!;
    expect(pista).toHaveClass('border-campo', 'bg-elevada');
    expect(pista.firstElementChild).toHaveClass('bg-secundario', 'translate-x-0');
  });
});
