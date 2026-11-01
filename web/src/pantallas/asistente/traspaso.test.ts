// El traspaso Asistente → Constructor sin pantalla: escribe el grafo como borrador del Constructor y navega solo si pudo.
import { describe, expect, it, vi } from 'vitest';

import { CLAVE_BORRADOR, crearBorrador, leerBorrador } from '../constructor/modelo/borrador';
import { ejemplo } from '../constructor/modelo/ejemplos';
import { grafo, memoria } from './arnes';
import { URL_CONSTRUCTOR, hayBorrador, pasarAlConstructor, sePuedeAbrir } from './traspaso';

describe('traspaso', () => {
  it('un grafo válido se puede abrir; uno sin cuadros, roto o con una clave pegada, no', () => {
    expect(sePuedeAbrir(grafo())).toBe(true);
    expect(sePuedeAbrir({ nombreFlujo: 'x', nodes: [], edges: [] })).toBe(false);
    expect(sePuedeAbrir({ nodes: 'no', edges: [] })).toBe(false);
    expect(sePuedeAbrir(null)).toBe(false);
    expect(sePuedeAbrir('texto')).toBe(false);
    const conClave = grafo();
    const agente = conClave.nodes.find(n => n.kind === 'agent')!;
    if (agente.kind === 'agent') agente.instrucciones = 'usa la llave sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD';
    expect(sePuedeAbrir(conClave)).toBe(false);
  });

  it('hayBorrador dice si hay un flujo con cuadros guardado, y no escribe nada', () => {
    const m = memoria();
    expect(hayBorrador(m)).toBe(false);
    crearBorrador(m).guardar(ejemplo());
    const antes = m.datos.get(CLAVE_BORRADOR);
    expect(hayBorrador(m)).toBe(true);
    expect(m.datos.get(CLAVE_BORRADOR)).toBe(antes);
    expect(hayBorrador(null)).toBe(false);
  });

  it('pasarAlConstructor escribe el grafo con la marca del Asistente y navega al Constructor', () => {
    const m = memoria();
    const ir = vi.fn();
    expect(pasarAlConstructor(grafo(), m, ir)).toEqual({ ok: true });
    expect(ir).toHaveBeenCalledExactlyOnceWith(URL_CONSTRUCTOR);
    expect(URL_CONSTRUCTOR).toBe('/estudio/automatizaciones/distrito/constructor/');
    const leido = leerBorrador(m.datos.get(CLAVE_BORRADOR));
    expect(leido.ok && leido.origen).toBe('asistente');
    expect(leido.ok && leido.flujo.nodes).toHaveLength(5);
  });

  it('si no se pudo escribir no navega y dice por qué, en palabras de persona', () => {
    const ir = vi.fn();
    const sinEspacio = {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw Object.assign(new Error('lleno'), { name: 'QuotaExceededError' });
      },
    };
    const r1 = pasarAlConstructor(grafo(), sinEspacio, ir);
    expect(r1).toMatchObject({ ok: false });
    expect(!r1.ok && r1.texto).toContain('no tiene espacio');
    const r2 = pasarAlConstructor(grafo(), null, ir);
    expect(!r2.ok && r2.texto).toContain('ventana privada');
    const r3 = pasarAlConstructor({ nodes: [], edges: [], nombreFlujo: 'x' }, memoria(), ir);
    expect(!r3.ok && r3.texto).toContain('No pudimos abrir este flujo en el constructor');
    expect(ir).not.toHaveBeenCalled();
  });

  it('un almacenamiento que lanza al leerlo (algunos navegadores) tampoco rompe: no hay borrador', () => {
    const lanza = () => {
      throw new Error('bloqueado');
    };
    expect(hayBorrador(lanza)).toBe(false);
    expect(pasarAlConstructor(grafo(), lanza, vi.fn())).toMatchObject({ ok: false });
  });
});
