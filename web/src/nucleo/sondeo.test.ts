import { describe, expect, it, vi } from 'vitest';

import { ESCALERA, sondear, validarEscalera, type Reloj } from './sondeo';

function relojFalso() {
  const pendientes = new Map<number, { fn: () => void; ms: number }>();
  let n = 0;
  const reloj: Reloj = {
    poner: (fn, ms) => { pendientes.set(++n, { fn, ms }); return n; },
    quitar: id => { pendientes.delete(id as number); },
  };
  return {
    reloj,
    pendientes,
    async disparar() {
      const [id, p] = [...pendientes.entries()][0]!;
      pendientes.delete(id);
      p.fn();
      await new Promise(r => setTimeout(r, 0));
    },
    esperas: () => [...pendientes.values()].map(p => p.ms),
  };
}

function docFalso() {
  const oyentes: Array<() => void> = [];
  return {
    hidden: false,
    addEventListener: (_: string, fn: () => void) => { oyentes.push(fn); },
    removeEventListener: (_: string, fn: () => void) => {
      const i = oyentes.indexOf(fn);
      if (i >= 0) oyentes.splice(i, 1);
    },
    cambiar(oculto: boolean) { this.hidden = oculto; oyentes.forEach(f => f()); },
    oyentes,
  };
}

describe('sondeo', () => {
  it('la escalera de fábrica es la de mix.html y no baja', () => {
    expect([...ESCALERA]).toEqual([5000, 5000, 5000, 10000, 10000, 20000]);
    expect(() => validarEscalera(ESCALERA)).not.toThrow();
    expect(() => validarEscalera([5000, 3000])).toThrow(/baja/);
    expect(() => validarEscalera([])).toThrow();
  });

  it('sube por la escalera y se queda en el último paso', async () => {
    const r = relojFalso();
    const doc = docFalso();
    const tarea = vi.fn(async () => false);
    sondear(tarea, { escalera: [1, 2, 3], reloj: r.reloj, doc: doc as never });
    const vistos: number[] = [];
    for (let i = 0; i < 5; i++) { vistos.push(r.esperas()[0]!); await r.disparar(); }
    expect(vistos).toEqual([1, 2, 3, 3, 3]);
    expect(tarea).toHaveBeenCalledTimes(5);
  });

  it('para cuando la tarea dice «ya»', async () => {
    const r = relojFalso();
    const doc = docFalso();
    sondear(async () => true, { reloj: r.reloj, doc: doc as never });
    await r.disparar();
    expect(r.pendientes.size).toBe(0);
    expect(doc.oyentes).toHaveLength(0);
  });

  it('con la pestaña oculta se duerme; al volver pregunta al instante', async () => {
    const r = relojFalso();
    const doc = docFalso();
    const tarea = vi.fn(async () => false);
    sondear(tarea, { reloj: r.reloj, doc: doc as never });
    doc.cambiar(true);
    expect(r.pendientes.size).toBe(0);
    doc.cambiar(false);
    await new Promise(res => setTimeout(res, 0));
    expect(tarea).toHaveBeenCalledTimes(1);
    expect(r.pendientes.size).toBe(1);
  });

  it('un fallo de red no para el sondeo', async () => {
    const r = relojFalso();
    const alFallar = vi.fn();
    sondear(async () => { throw new Error('red'); }, { reloj: r.reloj, doc: docFalso() as never, alFallar });
    await r.disparar();
    expect(alFallar).toHaveBeenCalledOnce();
    expect(r.pendientes.size).toBe(1);
  });
});
