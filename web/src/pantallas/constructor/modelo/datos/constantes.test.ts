import { describe, expect, it } from 'vitest';

import * as c from './constantes';

describe('constantes', () => {
  it('constructor.constantes.los_numeros_del_lienzo_y_los_topes_son_los_del_mockup', () => {
    // informe 04 §1.4: cambiar uno mueve los cuadros nuevos o rompe el golden de posiciones
    expect([c.ANCHO_CUADRO, c.ALTO_CUADRO]).toEqual([216, 96]);
    expect([c.LIENZO_ANCHO_MIN, c.LIENZO_ALTO_MIN]).toEqual([1000, 780]);
    expect([c.MARGEN_LIENZO_X, c.MARGEN_LIENZO_Y]).toEqual([112, 168]);
    expect([c.X_MAX, c.Y_MAX, c.SNAP]).toEqual([2400, 2400, 8]);
    expect([c.PASO_TECLA, c.PASO_TECLA_MAYUS, c.UMBRAL_ARRASTRE]).toEqual([8, 24, 6]);
    expect([c.MARGEN_CHOQUE, c.REJILLA_BUSQUEDA, c.HUECO_DERECHA]).toEqual([24, 24, 344]);
    // D7: 1 disparador, 4 agentes, 8 apps, 13 cuadros en total
    expect([c.TOPE_DISPARADORES, c.TOPE_AGENTES, c.TOPE_APPS, c.TOPE_CUADROS]).toEqual([1, 4, 8, 13]);
    expect([c.VUELTAS_MAX, c.MAX_HISTORIAL, c.ID_INICIAL]).toEqual([20, 20, 20]);
    expect([c.LARGO_NOMBRE_FLUJO, c.LARGO_NOMBRE_AGENTE, c.LARGO_NOMBRE_APP, c.LARGO_NOMBRE_N8N]).toEqual([
      80, 60, 60, 100,
    ]);
    // la rejilla de búsqueda cabe en el lienzo y el paso de teclado en la rejilla
    expect(c.X_MAX % c.REJILLA_BUSQUEDA).toBe(0);
    expect(c.PASO_TECLA % c.SNAP).toBe(0);
    expect(c.PASO_TECLA_MAYUS % c.SNAP).toBe(0);
  });

  it('constructor.constantes.los_textos_con_que_nace_lo_nuevo_son_los_del_mockup', () => {
    expect(c.NOMBRE_FLUJO_INICIAL).toBe('Mi automatización');
    expect(c.INSTRUCCIONES_AGENTE_NUEVO).toBe('Eres un asistente útil. Responde en español, con claridad.');
    expect(c.DESC_AYUDANTE_POR_DEFECTO).toBe(
      'Un colega que revisa lo que le mandes, señala qué mejorar y responde con su propuesta.',
    );
    expect(c.DISPARADOR_NUEVO).toEqual({ frec: 'dia', ruta: 'mi-flujo', app: 'gmail' });
    expect(c.NOMBRE_FLUJO_INICIAL.length).toBeLessThanOrEqual(c.LARGO_NOMBRE_FLUJO);
  });
});
