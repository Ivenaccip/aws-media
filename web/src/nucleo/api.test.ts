import { describe, expect, it, vi } from 'vitest';

import { ErrorApi, pedir, recuperarApartado } from './api';

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

describe('api', () => {
  it('solo habla con /api del propio sitio', async () => {
    await expect(pedir('https://otro.com/api/x')).rejects.toThrow(/solo rutas/);
  });

  it('manda JSON por el fetch global (el que envuelve auth.js)', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ ok: 1 }));
    expect(await pedir('/api/x', { cuerpo: { a: 1 } })).toEqual({ ok: 1 });
    const [ruta, init] = f.mock.calls[0]!;
    expect(ruta).toBe('/api/x');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"a":1}');
  });

  it('un 402 es «sin saldo» con el detalle de FastAPI', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ detail: 'Te faltan créditos' }, 402));
    const e = (await pedir('/api/x', { cuerpo: {} }).catch(x => x)) as ErrorApi;
    expect(e).toBeInstanceOf(ErrorApi);
    expect(e.sinSaldo).toBe(true);
    expect(e.message).toBe('Te faltan créditos');
  });

  it('sin red dice qué hacer, no «TypeError: Failed to fetch»', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const e = (await pedir('/api/x').catch(x => x)) as ErrorApi;
    expect(e.estado).toBe(0);
    expect(e.message).toMatch(/conexión/);
  });

  it('el borrador apartado se suelta al recibir respuesta', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({}));
    await pedir('/api/guion', { cuerpo: { texto: 'hola' }, apartar: 'guion' });
    expect(recuperarApartado('guion')).toBeNull();
  });

  it('si la página se va a mitad (401 → Cognito), el borrador se recupera al volver', async () => {
    // auth.js deja la promesa sin resolver mientras navega a Cognito
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));
    void pedir('/api/guion', { cuerpo: { texto: 'mi guion' }, apartar: 'guion' });
    await Promise.resolve();
    const a = recuperarApartado('guion');
    expect(a?.cuerpo).toEqual({ texto: 'mi guion' });
    expect(a?.ruta).toBe('/api/guion');
    expect(recuperarApartado('guion')).toBeNull();
  });
});
