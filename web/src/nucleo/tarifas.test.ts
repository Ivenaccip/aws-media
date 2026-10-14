import { describe, expect, it } from 'vitest';

import * as tarifas from './tarifas';

// El plugin tarifasSinNotas de vite.config.ts también corre en vitest.
describe('tarifas', () => {
  it('trae los números de tools/tarifas.json', () => {
    expect(tarifas.clip.video_8s).toBeGreaterThan(0);
    expect(tarifas.video.por_duracion['30']).toBeGreaterThan(tarifas.video.preparar);
  });

  it('el clip llega con su número por duración: un objeto de segundos a créditos', () => {
    // el plugin deja pasar los objetos anidados; solo quita notas, comentarios y economía
    const porDuracion = tarifas.modelos.clip['veo-lite'];
    const segundos = Object.keys(porDuracion);
    expect(segundos.length).toBeGreaterThan(0);
    for (const s of segundos) {
      expect(s).toMatch(/^\d+$/);
      const n = (porDuracion as Record<string, number>)[s]!;
      expect(Number.isInteger(n) && n > 0, `${s} s`).toBe(true);
    }
    // imagen y editar siguen con un entero por modelo
    expect(Number.isInteger(tarifas.modelos.imagen.grok)).toBe(true);
    expect(Number.isInteger(tarifas.modelos.editar.grok)).toBe(true);
  });

  it('sin notas: citan costos de proveedor que no son para el navegador', () => {
    const texto = JSON.stringify(tarifas);
    expect(texto).not.toMatch(/"nota/);
    expect(texto).not.toContain('dólares');
    expect(texto).not.toContain('pricing.json');
  });
});
