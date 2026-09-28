// UI·21 — el destello de «acaba de quedar listo»: solo en el paso de no a
// sí con la pantalla abierta. Lo que ya estaba listo al entrar (o al llegar
// los datos: null → sí) no se enciende.
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useLlegada } from './useLlegada';

type Props = { llego: boolean | null };

const montar = (llego: boolean | null, reactStrictMode = false) =>
  renderHook(({ llego: l }: Props) => useLlegada(l), { initialProps: { llego }, reactStrictMode });

describe.each([
  ['', false],
  [' (bajo StrictMode)', true],
])('UI·21 · useLlegada%s', (_nombre, estricto) => {
  it('montar ya llegado no enciende', () => {
    const { result } = montar(true, estricto);
    expect(result.current[0]).toBe(false);
  });

  it('de no a sí se enciende', () => {
    const { result, rerender } = montar(false, estricto);
    expect(result.current[0]).toBe(false);
    rerender({ llego: true });
    expect(result.current[0]).toBe(true);
    // un render más con lo mismo no la apaga
    rerender({ llego: true });
    expect(result.current[0]).toBe(true);
  });

  it('apagar() la apaga (al terminar la animación)', () => {
    const { result, rerender } = montar(false, estricto);
    rerender({ llego: true });
    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
    rerender({ llego: true });
    expect(result.current[0]).toBe(false);
  });

  it('sí → no → sí se vuelve a encender', () => {
    const { result, rerender } = montar(true, estricto);
    rerender({ llego: false });
    expect(result.current[0]).toBe(false);
    rerender({ llego: true });
    expect(result.current[0]).toBe(true);
  });

  it('volver a «no» con la luz encendida la apaga', () => {
    const { result, rerender } = montar(false, estricto);
    rerender({ llego: true });
    rerender({ llego: false });
    expect(result.current[0]).toBe(false);
  });

  it('null → sí es la primera carga: NO enciende', () => {
    const { result, rerender } = montar(null, estricto);
    expect(result.current[0]).toBe(false);
    rerender({ llego: true });
    expect(result.current[0]).toBe(false);
  });

  it('null → no → sí sí enciende (llegó con la pantalla abierta)', () => {
    const { result, rerender } = montar(null, estricto);
    rerender({ llego: false });
    rerender({ llego: true });
    expect(result.current[0]).toBe(true);
  });

  it('apagar es la misma función en cada render (se puede pasar a onAnimationEnd sin re-crear)', () => {
    const { result, rerender } = montar(false, estricto);
    const apagar = result.current[1];
    rerender({ llego: true });
    expect(result.current[1]).toBe(apagar);
  });
});
