import { describe, expect, it } from 'vitest';

import * as tarifas from './tarifas';

// El plugin tarifasSinNotas de vite.config.ts también corre en vitest.
describe('tarifas', () => {
  it('trae los números de tools/tarifas.json', () => {
    expect(tarifas.clip.video_8s).toBeGreaterThan(0);
    expect(tarifas.video.por_duracion['30']).toBeGreaterThan(tarifas.video.preparar);
  });

  it('sin notas: citan costos de proveedor que no son para el navegador', () => {
    const texto = JSON.stringify(tarifas);
    expect(texto).not.toMatch(/"nota/);
    expect(texto).not.toContain('dólares');
    expect(texto).not.toContain('pricing.json');
  });
});
