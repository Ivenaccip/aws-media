// Bajar un texto como archivo: lo que jsdom no tiene (URL.createObjectURL) se simula; sin eso, la función devuelve false en vez de fallar.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { descargarArchivo, nombreDeArchivo } from './descargarArchivo';

describe('descargarArchivo', () => {
  const original = { crear: URL.createObjectURL, soltar: URL.revokeObjectURL };
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    URL.createObjectURL = original.crear;
    URL.revokeObjectURL = original.soltar;
    vi.restoreAllMocks();
  });

  it('sin URL.createObjectURL (jsdom, vistas que bloquean descargas) devuelve false sin lanzar', () => {
    URL.createObjectURL = undefined as unknown as typeof URL.createObjectURL;
    expect(descargarArchivo('flujo.json', '{}')).toBe(false);
  });

  it('crea el archivo con el nombre y el tipo, pulsa un enlace oculto y suelta la URL después', () => {
    const crear = vi.fn(() => 'blob:prueba');
    const soltar = vi.fn();
    URL.createObjectURL = crear;
    URL.revokeObjectURL = soltar;
    const pulsados: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      pulsados.push(this);
    });
    expect(descargarArchivo('atencion-a-clientes.json', '{"a":1}')).toBe(true);
    expect(crear).toHaveBeenCalledTimes(1);
    const blob = (crear.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toBe('application/json');
    expect(pulsados).toHaveLength(1);
    expect(pulsados[0]!.download).toBe('atencion-a-clientes.json');
    expect(pulsados[0]!.getAttribute('href')).toBe('blob:prueba');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(soltar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(soltar).toHaveBeenCalledWith('blob:prueba');
  });

  it('si el navegador lanza al crear la URL o al pulsar, devuelve false y no deja una URL colgada', () => {
    const soltar = vi.fn();
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = soltar;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(descargarArchivo('x.json', '{}')).toBe(false);
    expect(soltar).toHaveBeenCalledWith('blob:x');
  });
});

describe('nombreDeArchivo', () => {
  it('quita barras, caracteres de control y puntos o espacios al borde, y recorta', () => {
    expect(nombreDeArchivo('../a/b\\c:d*e?.json')).toBe('a b c d e .json');
    expect(nombreDeArchivo('  ..  ')).toBe('archivo');
    expect(nombreDeArchivo('', 'flujo')).toBe('flujo');
    expect(nombreDeArchivo('x'.repeat(300)).length).toBe(120);
    expect(nombreDeArchivo('con\u0000nulo\u001f.json')).toBe('con nulo .json');
  });
});
