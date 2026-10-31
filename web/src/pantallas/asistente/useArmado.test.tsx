// useArmado: mandar el pedido y preguntar cómo va con la escalera del repo, con el API de mentira y relojes falsos. Sin red, sin gasto.
// Los tests con ID (`asistente.armado.…`) son invariantes registrados (tests/test_migracion_ui.py).
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { json, sinRed } from '../../prueba/servidor';
import { INICIO, armandoEn, asistente, consultas, cuerpoDe, falla, listo, pedidos } from './arnes';
import { ESPERA_MAX_MS, useArmado } from './useArmado';

const TEXTO = 'Cuando me llegue un correo de un cliente, que una IA le conteste';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Deja pasar `ms` del reloj falso, con todo lo que ocurra en medio (fetch, setState, el siguiente paso de la escalera). */
const pasar = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** Monta el hook, espera la configuración y manda el pedido. */
async function armando(g: Parameters<typeof asistente>[0] = {}) {
  const f = asistente(g);
  const r = renderHook(() => useArmado());
  await pasar(10);
  expect(r.result.current.config).not.toBeNull();
  act(() => {
    expect(r.result.current.armar(TEXTO)).toBe(true);
  });
  await pasar(10);
  return { f, ...r };
}

describe('useArmado', () => {
  it('asistente.armado.el_sondeo_usa_la_escalera_de_5_5_5_10_10_20_segundos', async () => {
    const { f } = await armando({ consultar: () => json(armandoEn('buscar')) });
    const t0 = Date.now();
    // el instante de cada pregunta, contado desde que empezó el sondeo: 5, +5, +5, +10, +10, +20, +20
    const instantes = [5000, 10000, 15000, 25000, 35000, 55000, 75000];
    expect(consultas(f)).toHaveLength(0);
    for (const [i, t] of instantes.entries()) {
      await pasar(t - 100 - (Date.now() - t0));
      expect(consultas(f), `antes de ${t} ms`).toHaveLength(i);
      await pasar(200);
      expect(consultas(f), `a los ${t} ms`).toHaveLength(i + 1);
    }
    // todas las preguntas son al mismo pedido
    expect(new Set(consultas(f).map(c => c[0]))).toEqual(new Set([`/api/automatiza/armar/${encodeURIComponent(INICIO.id)}`]));
  });

  it('asistente.armado.el_sondeo_se_limpia_al_desmontar', async () => {
    const quitar = vi.spyOn(document, 'removeEventListener');
    const { f, unmount } = await armando({ consultar: () => json(armandoEn('buscar')) });
    await pasar(5100);
    expect(consultas(f)).toHaveLength(1);
    unmount();
    // no queda ningún reloj corriendo y el oyente de la pestaña se quitó
    expect(vi.getTimerCount()).toBe(0);
    expect(quitar.mock.calls.some(c => c[0] === 'visibilitychange')).toBe(true);
    await pasar(120_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await pasar(1000);
    expect(consultas(f)).toHaveLength(1);
  });

  it('asistente.armado.al_desmontar_se_cancela_lo_que_vuela', async () => {
    const f = asistente({ armar: () => new Promise<Response>(() => undefined) });
    const { result, unmount } = renderHook(() => useArmado());
    await pasar(10);
    act(() => {
      result.current.armar(TEXTO);
    });
    await pasar(10);
    const senal = pedidos(f)[0]![1]!.signal as AbortSignal;
    expect(senal.aborted).toBe(false);
    unmount();
    expect(senal.aborted).toBe(true);
  });

  it('asistente.armado.el_doble_envio_en_el_mismo_tic_manda_un_solo_pedido', async () => {
    const f = asistente();
    const { result } = renderHook(() => useArmado());
    await pasar(10);
    let primero = false;
    let segundo = true;
    act(() => {
      primero = result.current.armar(TEXTO);
      segundo = result.current.armar(TEXTO);
    });
    expect(primero).toBe(true);
    expect(segundo).toBe(false);
    await pasar(10);
    expect(pedidos(f)).toHaveLength(1);
    expect(cuerpoDe(pedidos(f)[0]!)).toEqual({ texto: TEXTO });
    // mientras arma no se acepta otro
    act(() => {
      expect(result.current.armar(TEXTO)).toBe(false);
    });
    expect(pedidos(f)).toHaveLength(1);
  });

  it('asistente.armado.sin_conexion_mientras_pregunta_sigue_intentando_y_lo_dice', async () => {
    let n = 0;
    const { f, result } = await armando({
      consultar: () => (++n === 1 ? sinRed() : n === 2 ? falla(502, 'no_disponible', 'x') : json(listo())),
    });
    await pasar(5100);
    expect(consultas(f)).toHaveLength(1);
    expect(result.current.sinConexion).toBe(true);
    expect(result.current.fase.tipo).toBe('armando');
    await pasar(5000);
    // un 502 de la puerta también pasa solo
    expect(consultas(f)).toHaveLength(2);
    expect(result.current.sinConexion).toBe(true);
    expect(result.current.fase.tipo).toBe('armando');
    await pasar(5000);
    expect(consultas(f)).toHaveLength(3);
    expect(result.current.sinConexion).toBe(false);
    expect(result.current.fase.tipo).toBe('listo');
  });

  it('asistente.armado.pasada_la_espera_maxima_deja_de_preguntar_y_lo_dice', async () => {
    const { f, result } = await armando({ consultar: () => json(armandoEn('revisar')) });
    await pasar(ESPERA_MAX_MS + 60_000);
    expect(result.current.fase).toMatchObject({ tipo: 'fallo', fallo: { codigo: 'tardo' } });
    const hasta = consultas(f).length;
    expect(hasta).toBeGreaterThan(5);
    await pasar(10 * 60_000);
    expect(consultas(f)).toHaveLength(hasta);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('asistente.armado.una_pestana_oculta_mas_de_diez_minutos_no_tira_un_flujo_que_el_servidor_ya_termino', async () => {
    // la pestaña se oculta (el sondeo se duerme), pasan 11 minutos y el servidor ya terminó: al volver se PREGUNTA antes de rendirse
    let oculto = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => oculto });
    try {
      let terminado = false;
      const { f, result } = await armando({ consultar: () => json(terminado ? listo() : armandoEn('buscar')) });
      await pasar(5100);
      expect(consultas(f)).toHaveLength(1);
      oculto = true;
      document.dispatchEvent(new Event('visibilitychange'));
      await pasar(ESPERA_MAX_MS + 60_000);
      expect(consultas(f)).toHaveLength(1); // dormido: nadie pregunta
      terminado = true;
      oculto = false;
      document.dispatchEvent(new Event('visibilitychange'));
      await pasar(100);
      // sin esto el tope se comprobaba ANTES de preguntar y el resultado ya hecho se tiraba con «tardó más de lo normal»
      expect(consultas(f)).toHaveLength(2);
      expect(result.current.fase.tipo).toBe('listo');
    } finally {
      delete (document as { hidden?: boolean }).hidden;
    }
  });

  it('asistente.armado.pasada_la_espera_maxima_si_el_servidor_sigue_armando_se_rinde_despues_de_preguntar_una_ultima_vez', async () => {
    let oculto = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => oculto });
    try {
      const { f, result } = await armando({ consultar: () => json(armandoEn('revisar')) });
      await pasar(5100);
      oculto = true;
      document.dispatchEvent(new Event('visibilitychange'));
      await pasar(ESPERA_MAX_MS + 60_000);
      oculto = false;
      document.dispatchEvent(new Event('visibilitychange'));
      await pasar(100);
      // preguntó (y siguió «armando»): ahora sí se rinde, y no vuelve a preguntar
      expect(consultas(f)).toHaveLength(2);
      expect(result.current.fase).toMatchObject({ tipo: 'fallo', fallo: { codigo: 'tardo' } });
      await pasar(5 * 60_000);
      expect(consultas(f)).toHaveLength(2);
    } finally {
      delete (document as { hidden?: boolean }).hidden;
    }
  });

  it('un error que no se arregla esperando (404) para el sondeo y libera el candado para escribir de nuevo', async () => {
    let n = 0;
    const { f, result } = await armando({
      consultar: () => (++n === 1 ? falla(404, 'no_encontrada', 'No encontramos ese pedido. Escribe de nuevo qué quieres automatizar.') : json(listo())),
    });
    await pasar(5100);
    expect(result.current.fase).toMatchObject({ tipo: 'fallo', fallo: { codigo: 'no_encontrada', estado: 404 } });
    await pasar(60_000);
    expect(consultas(f)).toHaveLength(1);
    // el candado se abrió: se puede mandar otro pedido
    act(() => {
      expect(result.current.armar(TEXTO)).toBe(true);
    });
    await pasar(10);
    expect(pedidos(f)).toHaveLength(2);
  });

  it('los pasos solo avanzan: una respuesta vieja que llega tarde no los regresa', async () => {
    const orden = ['revisar', 'buscar'];
    const { result } = await armando({ consultar: () => json(armandoEn(orden.shift() ?? 'entender')) });
    await pasar(5100);
    expect(result.current.fase).toMatchObject({ tipo: 'armando', paso: 3 });
    await pasar(5000);
    expect(result.current.fase).toMatchObject({ tipo: 'armando', paso: 3 });
  });

  it('el 202 sin id, o con un id raro, es una respuesta que no se entiende: no se pregunta por nada', async () => {
    const { f, result } = await armando({ armar: () => json({ estado: 'armando', paso: 'entender' }, 202) });
    expect(result.current.fase).toMatchObject({ tipo: 'fallo', fallo: { codigo: 'respuesta' } });
    await pasar(30_000);
    expect(consultas(f)).toHaveLength(0);
  });

  it('un error al mandar el pedido (503, sin conexión) deja el hook libre y dice qué pasó', async () => {
    let n = 0;
    const { result } = await armando({
      armar: () => (++n === 1 ? falla(503, 'no_disponible', 'El Asistente no está disponible por ahora. Inténtalo en unos minutos.') : sinRed()),
    });
    expect(result.current.fase).toMatchObject({ tipo: 'fallo', fallo: { codigo: 'no_disponible', estado: 503 } });
    act(() => {
      expect(result.current.armar(TEXTO)).toBe(true);
    });
    await pasar(10);
    expect(result.current.fase).toMatchObject({ tipo: 'fallo', fallo: { codigo: 'sin_conexion', estado: 0 } });
  });

  it('un 404 al pedir la configuración o al mandar el pedido es «no disponible», no «no encontramos ese pedido»', async () => {
    const f = asistente({ config: () => falla(404, 'no_encontrada', 'Not Found'), armar: () => json({ detail: 'Not Found' }, 404) });
    const { result } = renderHook(() => useArmado());
    await pasar(10);
    expect(result.current.config).toBeNull();
    expect(result.current.errorConfig).toMatchObject({ codigo: 'no_disponible', estado: 404 });
    expect(result.current.errorConfig?.texto).toBe('El Asistente no está disponible por ahora. Inténtalo en unos minutos.');
    expect(f.mock.calls.length).toBe(1);
    // y al mandar el pedido (con una configuración buena)
    const g = asistente({ armar: () => json({ detail: 'Not Found' }, 404) });
    const otro = renderHook(() => useArmado());
    await pasar(10);
    act(() => {
      otro.result.current.armar(TEXTO);
    });
    await pasar(10);
    expect(otro.result.current.fase).toMatchObject({ tipo: 'fallo', fallo: { codigo: 'no_disponible', estado: 404 } });
    expect(pedidos(g)).toHaveLength(1);
  });

  it('descartarFallo quita un fallo de la vista pero no toca un resultado', async () => {
    const { result } = await armando({ armar: () => falla(503, 'no_disponible', 'x') });
    expect(result.current.fase.tipo).toBe('fallo');
    act(() => result.current.descartarFallo());
    expect(result.current.fase.tipo).toBe('libre');
    const otro = await armando({ armar: () => json({ ...INICIO, estado: 'listo' }, 202), consultar: () => json(listo()) });
    act(() => otro.result.current.descartarFallo());
    expect(otro.result.current.fase.tipo).not.toBe('fallo');
  });

  it('la configuración falla cerrada: sin conexión o ilegible no hay config, y recargarConfig vuelve a preguntar', async () => {
    let ok = false;
    const f = asistente({ config: () => (ok ? json({ activo: true, modo: 'prueba', gratis: true, largo_minimo: 20, largo_maximo: 1500 }) : sinRed()) });
    const { result } = renderHook(() => useArmado());
    await pasar(10);
    expect(result.current.config).toBeNull();
    expect(result.current.errorConfig).toMatchObject({ codigo: 'sin_conexion' });
    ok = true;
    let c: unknown = null;
    await act(async () => {
      c = await result.current.recargarConfig();
    });
    expect(c).toMatchObject({ activo: true, minimo: 20, maximo: 1500 });
    expect(result.current.errorConfig).toBeNull();
    expect(f.mock.calls.filter(x => x[0] === '/api/automatiza/config')).toHaveLength(2);
  });

  it('una configuración que no trae los límites no se acepta', async () => {
    asistente({ config: () => json({ activo: true, modo: 'prueba', gratis: true }) });
    const { result } = renderHook(() => useArmado());
    await pasar(10);
    expect(result.current.config).toBeNull();
    expect(result.current.errorConfig).toMatchObject({ codigo: 'respuesta' });
  });
});
