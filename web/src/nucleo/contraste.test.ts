import { describe, expect, it } from 'vitest';

import { contraste, nivelAA } from './contraste';

describe('contraste', () => {
  it('reproduce las cifras de docs/DISENO.md', () => {
    expect(contraste('#5b8dd6', '#18293f')).toBeCloseTo(4.36, 1);
    expect(contraste('#14100a', '#da8c28')).toBeCloseTo(7.0, 0);
    expect(contraste('#14100a', '#a96716')).toBeCloseTo(4.19, 1);
    expect(contraste('#93a3b8', '#111f33')).toBeCloseTo(6.45, 1);
  });

  it('clasifica AA', () => {
    expect(nivelAA(7)).toBe('AA');
    expect(nivelAA(3.5)).toBe('AA grande');
    expect(nivelAA(2)).toBe('no pasa');
  });
});
