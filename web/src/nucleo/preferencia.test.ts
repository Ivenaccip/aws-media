import { describe, expect, it, vi } from 'vitest';

import { guardarPreferencia, leerPreferencia } from './preferencia';

describe('preferencia', () => {
  it('guarda y lee lo mismo, y lo que no hay es null', () => {
    expect(leerPreferencia('una.clave')).toBeNull();
    guardarPreferencia('una.clave', 'sin');
    expect(leerPreferencia('una.clave')).toBe('sin');
    guardarPreferencia('una.clave', 'con');
    expect(leerPreferencia('una.clave')).toBe('con');
  });

  it('si el navegador no deja leer, es como si no hubiera nada', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(leerPreferencia('una.clave')).toBeNull();
  });

  it('si el navegador no deja guardar, no revienta', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('cuota llena');
    });
    expect(() => guardarPreferencia('una.clave', 'sin')).not.toThrow();
  });

  it('si no existe ni window.localStorage, tampoco', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(leerPreferencia('una.clave')).toBeNull();
    expect(() => guardarPreferencia('una.clave', 'sin')).not.toThrow();
  });
});
