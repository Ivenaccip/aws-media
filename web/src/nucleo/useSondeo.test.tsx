import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSondeo } from './useSondeo';

function Prueba({ activo, tarea }: { activo: boolean; tarea: () => Promise<boolean> }) {
  useSondeo(activo, tarea, { escalera: [1000] });
  return null;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useSondeo', () => {
  it('no sondea apagado, sondea encendido y se para al desmontar', async () => {
    const tarea = vi.fn(async () => false);
    const { rerender, unmount } = render(<Prueba activo={false} tarea={tarea} />);
    await vi.advanceTimersByTimeAsync(3000);
    expect(tarea).not.toHaveBeenCalled();
    rerender(<Prueba activo tarea={tarea} />);
    await vi.advanceTimersByTimeAsync(2500);
    expect(tarea).toHaveBeenCalledTimes(2);
    unmount();
    await vi.advanceTimersByTimeAsync(5000);
    expect(tarea).toHaveBeenCalledTimes(2);
  });

  it('usa la tarea más nueva sin reiniciar', async () => {
    const vieja = vi.fn(async () => false);
    const nueva = vi.fn(async () => false);
    const { rerender } = render(<Prueba activo tarea={vieja} />);
    rerender(<Prueba activo tarea={nueva} />);
    await vi.advanceTimersByTimeAsync(1000);
    expect(vieja).not.toHaveBeenCalled();
    expect(nueva).toHaveBeenCalledTimes(1);
  });
});
