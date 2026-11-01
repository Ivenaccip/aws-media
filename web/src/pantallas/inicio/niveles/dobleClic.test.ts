// La guarda del doble clic de las páginas del recorrido (dobleClic.ts), sin React. Sin el prefijo `inicio.`: no es un invariante del
// registro de migración (docs/migracion/inicio.md); en una página la prueban PaginaNivel.test.tsx y Herramienta.test.tsx, y en un
// navegador de verdad niveles.spec.ts e inicio-recorrido.spec.ts.
import { describe, expect, it } from 'vitest';

import { VENTANA_DOBLE_CLIC_MS, esDobleClicAccidental } from './dobleClic';

describe('niveles · esDobleClicAccidental: el segundo clic de un doble clic que acaba de cargar otra página', () => {
  it('niveles.doble_clic.se_ignora_un_segundo_clic_a_menos_de_medio_segundo: detail > 1', () => {
    expect(esDobleClicAccidental(2, 0)).toBe(true);
    expect(esDobleClicAccidental(2, VENTANA_DOBLE_CLIC_MS - 1)).toBe(true);
    expect(esDobleClicAccidental(3, 120)).toBe(true);
  });

  it('niveles.doble_clic.una_eleccion_deliberada_pasa: el primer clic, el teclado (detail 0) y un doble clic pasado el medio segundo', () => {
    expect(esDobleClicAccidental(1, 0)).toBe(false);
    expect(esDobleClicAccidental(0, 0)).toBe(false);
    expect(esDobleClicAccidental(2, VENTANA_DOBLE_CLIC_MS)).toBe(false);
    expect(esDobleClicAccidental(2, 5000)).toBe(false);
  });

  it('niveles.doble_clic.la_ventana_es_de_medio_segundo: la que miden los e2e (499 ms todavía cuenta, 500 ya no)', () => {
    expect(VENTANA_DOBLE_CLIC_MS).toBe(500);
  });
});
