import { describe, expect, it } from 'vitest';

import { creditos, dolares, duracion, entero } from './formato';

describe('formato', () => {
  it('los dólares se escriben "$X.XX dólares", jamás centavos', () => {
    expect(dolares(0.21)).toBe('$0.21 dólares');
    expect(dolares(1.5)).toBe('$1.50 dólares');
    expect(dolares(0.005)).toBe('$0.01 dólares');
    expect(() => dolares(Number.NaN)).toThrow();
  });

  it('los créditos son enteros con la estrella ✦ (U+2726)', () => {
    expect(creditos(100)).toBe('✦ 100');
    expect(creditos(1200)).toBe('✦ 1,200');
    expect(entero(99.6)).toBe('100');
  });

  it('las duraciones en español', () => {
    expect(duracion(45)).toBe('45 s');
    expect(duracion(60)).toBe('1 min');
    expect(duracion(80)).toBe('1 min 20 s');
  });
});
