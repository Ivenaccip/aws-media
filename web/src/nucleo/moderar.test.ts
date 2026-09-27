import { describe, expect, it, vi } from 'vitest';

import { moderar } from './moderar';

function responder(cuerpo: unknown, ok = true) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(cuerpo), { status: ok ? 200 : 500 }),
  );
}

describe('moderar', () => {
  it('bloquea con el mensaje y el motivo del moderador', async () => {
    responder({ permitido: false, mensaje: 'No', motivo: '<b>cita</b>' });
    expect(await moderar('algo')).toEqual({ permitido: false, mensaje: 'No', motivo: '<b>cita</b>' });
  });

  it('si el filtro falla, deja pasar (un filtro caído no frena el producto)', async () => {
    responder({}, false);
    expect(await moderar('algo')).toEqual({ permitido: true });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('red'));
    expect(await moderar('algo')).toEqual({ permitido: true });
  });

  it('el texto vacío no gasta una llamada', async () => {
    const f = vi.spyOn(globalThis, 'fetch');
    expect(await moderar('   ')).toEqual({ permitido: true });
    expect(f).not.toHaveBeenCalled();
  });
});
