// Los avisos rápidos: el cuadro de abajo a la derecha de static/trabajos.js. Aquí solo se comprueba lo que le pasamos
// (la acción «Deshacer» incluida) y que, sin cuadro, `avisar` lo diga en vez de perder el aviso.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { avisar, quitarAviso } from './avisos';

afterEach(() => {
  delete window.avisos;
});

describe('avisos', () => {
  it('sin el cuadro de la página, avisar devuelve false y quitarAviso no truena', () => {
    expect(avisar('Hola')).toBe(false);
    expect(() => quitarAviso('x')).not.toThrow();
  });

  it('le pasa al cuadro el texto, la clave y la acción «Deshacer»', () => {
    const mostrar = vi.fn(() => 1);
    const quitar = vi.fn();
    window.avisos = { mostrar, quitar };
    const al = vi.fn();
    expect(avisar('Quitamos «Slack».', { clave: 'constructor', accion: { texto: 'Deshacer', al } })).toBe(true);
    expect(mostrar).toHaveBeenCalledWith('Quitamos «Slack».', { clave: 'constructor', accion: { texto: 'Deshacer', al } });
    quitarAviso('constructor');
    expect(quitar).toHaveBeenCalledWith('constructor');
  });
});
