// UI·21 — la lista viva sabe qué llegó nuevo y, si lo que ya estaba cambió
// de orden, pinta dentro de una View Transition «reordenar». jsdom no tiene
// View Transitions: prueba/transicion.ts pone unas de mentira, que corren el
// update en el acto o lo guardan para después (como el navegador, que pinta
// lo nuevo un cuadro más tarde).
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { simularVT } from '../prueba/transicion';
import { diferencia, NINGUNO, useListaViva, type ListaViva } from './useListaViva';

interface Fila {
  id: string;
  vivo?: boolean;
}

const filas = (...ids: string[]): Fila[] => ids.map(id => ({ id }));
const claves = (d: Fila[]) => d.map(f => f.id);
const algoVivo = (d: Fila[]) => d.some(f => f.vivo === true);
const nada = () => false;

/** Un `cargar` de mentira: devuelve lo que el test deje en `datos`. */
function fuente(inicial: Fila[]) {
  const f = { datos: inicial, cargar: vi.fn(async () => f.datos) };
  return f;
}

/** Una lista de botones con key=id, como las pantallas. */
function Lista({
  cargar,
  exponer,
  vivo = nada,
  alTerminar,
}: {
  cargar: () => Promise<Fila[]>;
  exponer: (l: ListaViva<Fila[]>) => void;
  vivo?: (d: Fila[]) => boolean;
  alTerminar?: () => void;
}) {
  const l = useListaViva(cargar, vivo, alTerminar ? { claves, alTerminar } : { claves });
  useEffect(() => exponer(l));
  return (
    <div>
      {l.datos?.map(f => (
        <button key={f.id} type="button" data-nueva={l.nuevos.has(f.id) ? 'si' : 'no'}>
          {f.id}
        </button>
      ))}
    </div>
  );
}

/** Monta <Lista> y espera la primera carga. */
async function montar(inicial: Fila[], extra: { vivo?: (d: Fila[]) => boolean; alTerminar?: () => void } = {}) {
  const f = fuente(inicial);
  const vista: { lista: ListaViva<Fila[]> | null } = { lista: null };
  const exponer = (l: ListaViva<Fila[]>) => {
    vista.lista = l;
  };
  const r = render(<Lista cargar={f.cargar} exponer={exponer} {...extra} />);
  await waitFor(() => expect(orden()).toEqual(claves(inicial)));
  const lista = () => vista.lista!;
  return { f, r, lista, exponer };
}

const orden = () => screen.queryAllByRole('button').map(b => b.textContent);

describe('UI·21 · diferencia()', () => {
  it('la primera carga (antes = null) no marca nada ni reordena', () => {
    const d = diferencia(null, ['a', 'b']);
    expect(d.nuevos).toBe(NINGUNO);
    expect(d.nuevos.size).toBe(0);
    expect(d.reordena).toBe(false);
  });

  it('un alta arriba es nueva y no reordena lo que ya estaba', () => {
    const d = diferencia(['a', 'b'], ['x', 'a', 'b']);
    expect([...d.nuevos]).toEqual(['x']);
    expect(d.reordena).toBe(false);
  });

  it('una baja no reordena ni marca nada', () => {
    const d = diferencia(['a', 'b', 'c'], ['a', 'c']);
    expect(d.nuevos.size).toBe(0);
    expect(d.reordena).toBe(false);
  });

  it('un intercambio reordena', () => {
    const d = diferencia(['a', 'b'], ['b', 'a']);
    expect(d.nuevos.size).toBe(0);
    expect(d.reordena).toBe(true);
  });

  it('el de error que se re-analiza sube a la cima: reordena', () => {
    expect(diferencia(['a', 'b', 'error'], ['error', 'a', 'b']).reordena).toBe(true);
  });

  it('sin cambios no hay nada nuevo ni reorden', () => {
    const d = diferencia(['a', 'b'], ['a', 'b']);
    expect(d.nuevos.size).toBe(0);
    expect(d.reordena).toBe(false);
  });

  it('alta y baja a la vez, con lo demás en su orden: solo el alta es nueva', () => {
    const d = diferencia(['a', 'b', 'c'], ['x', 'a', 'c']);
    expect([...d.nuevos]).toEqual(['x']);
    expect(d.reordena).toBe(false);
  });
});

describe('UI·21 · useListaViva con claves', () => {
  it('la primera carga deja `nuevos` vacío; actualizar con uno más lo marca nuevo', async () => {
    const f = fuente(filas('a', 'b'));
    const { result } = renderHook(() => useListaViva(f.cargar, nada, { claves }));
    await waitFor(() => expect(result.current.datos).toEqual(filas('a', 'b')));
    expect(result.current.nuevos.size).toBe(0);
    f.datos = filas('x', 'a', 'b');
    await act(() => result.current.actualizar());
    expect(result.current.datos).toEqual(filas('x', 'a', 'b'));
    expect([...result.current.nuevos]).toEqual(['x']);
    // la siguiente vuelta sin cambios (el servidor manda JSON nuevo, igual) ya no trae nada nuevo
    f.datos = filas('x', 'a', 'b');
    await act(() => result.current.actualizar());
    expect(result.current.nuevos.size).toBe(0);
  });

  it('tras un fallo de carga, la primera carga buena tampoco marca nada (un fallo no cuenta como vista)', async () => {
    let red = false;
    const cargar = vi.fn(async () => {
      if (!red) throw new TypeError('Failed to fetch');
      return filas('a', 'b');
    });
    const vt = simularVT();
    const { result } = renderHook(() => useListaViva(cargar, nada, { claves }));
    await waitFor(() => expect(result.current.error).toBe(true));
    red = true;
    await act(() => result.current.actualizar());
    expect(result.current.datos).toEqual(filas('a', 'b'));
    expect(result.current.nuevos.size).toBe(0);
    expect(vt.espia).not.toHaveBeenCalled();
  });

  it('sin `claves` nunca marca nada nuevo', async () => {
    const f = fuente(filas('a'));
    const { result } = renderHook(() => useListaViva(f.cargar, nada));
    await waitFor(() => expect(result.current.datos).not.toBeNull());
    f.datos = filas('x', 'a');
    await act(() => result.current.actualizar());
    expect(result.current.nuevos.size).toBe(0);
  });

  it('poner() también cuenta como actualización: lo que llega es nuevo', async () => {
    const f = fuente(filas('a'));
    const { result } = renderHook(() => useListaViva(f.cargar, nada, { claves }));
    await waitFor(() => expect(result.current.datos).not.toBeNull());
    act(() => result.current.poner(filas('a', 'z')));
    expect([...result.current.nuevos]).toEqual(['z']);
  });

  it('en la pantalla, la fila nueva llega marcada y las demás no', async () => {
    const { f, lista } = await montar(filas('a', 'b'));
    expect(screen.getAllByRole('button').map(b => b.dataset.nueva)).toEqual(['no', 'no']);
    f.datos = filas('x', 'a', 'b');
    await act(() => lista().actualizar());
    expect(orden()).toEqual(['x', 'a', 'b']);
    expect(screen.getAllByRole('button').map(b => b.dataset.nueva)).toEqual(['si', 'no', 'no']);
  });

  it('con View Transitions: un reordenamiento pinta dentro de una de tipo «reordenar» y no marca nuevos', async () => {
    const vt = simularVT();
    const { f, lista } = await montar(filas('a', 'b', 'c'));
    f.datos = filas('c', 'a', 'b', 'x');
    await act(() => lista().actualizar());
    expect(vt.espia).toHaveBeenCalledOnce();
    expect(vt.tipos).toEqual([['reordenar']]);
    expect(orden()).toEqual(['c', 'a', 'b', 'x']);
    // la transición ya anima lo que entra en ese turno
    expect(lista().nuevos.size).toBe(0);
  });

  it('con View Transitions: un alta NO abre transición (entra abriendo su espacio)', async () => {
    const vt = simularVT();
    const { f, lista } = await montar(filas('a', 'b'));
    f.datos = filas('x', 'a', 'b');
    await act(() => lista().actualizar());
    f.datos = filas('x', 'b');
    await act(() => lista().actualizar());
    expect(vt.espia).not.toHaveBeenCalled();
    expect(orden()).toEqual(['x', 'b']);
  });

  it('la primera carga nunca abre transición', async () => {
    const vt = simularVT();
    await montar(filas('b', 'a'));
    expect(vt.espia).not.toHaveBeenCalled();
  });
});

describe('UI·21 · el pintado diferido de la transición', () => {
  it('un re-render en medio, antes de que el navegador pinte, no pierde lo que llegó', async () => {
    const vt = simularVT({ diferir: true });
    const { f, r, lista, exponer } = await montar(filas('a', 'b'));
    f.datos = filas('b', 'a');
    await act(() => lista().actualizar());
    expect(vt.pendientes).toBe(1);
    expect(orden()).toEqual(['a', 'b']); // todavía la foto vieja
    // un render cualquiera antes de que corra el update
    r.rerender(<Lista cargar={f.cargar} exponer={exponer} />);
    expect(orden()).toEqual(['a', 'b']);
    vt.correr();
    expect(orden()).toEqual(['b', 'a']);
    // lo que llegó sigue siendo la referencia: un alta arriba es alta, no otro reorden
    f.datos = filas('c', 'b', 'a');
    await act(() => lista().actualizar());
    expect(vt.espia).toHaveBeenCalledOnce();
    expect(orden()).toEqual(['c', 'b', 'a']);
    expect(lista().nuevos).toEqual(new Set(['c']));
  });

  it('si llega otra actualización (al instante) antes de pintar la diferida, al correr la vieja se queda la última', async () => {
    const vt = simularVT({ diferir: true });
    const { f, lista } = await montar(filas('a', 'b'));
    f.datos = filas('b', 'a');
    await act(() => lista().actualizar()); // reordena: se difiere
    expect(vt.pendientes).toBe(1);
    f.datos = filas('b', 'a', 'c'); // frente a lo último que llegó es un alta: va al instante
    await act(() => lista().actualizar());
    expect(vt.espia).toHaveBeenCalledOnce();
    expect(orden()).toEqual(['b', 'a', 'c']);
    vt.correr(); // el pintado viejo llega tarde: no pisa al nuevo
    expect(orden()).toEqual(['b', 'a', 'c']);
    expect(lista().datos).toEqual(filas('b', 'a', 'c'));
    expect(lista().nuevos).toEqual(new Set(['c']));
  });

  it('re-render en medio Y otra actualización antes de pintar: se compara con lo último que llegó, no con lo pintado', async () => {
    const vt = simularVT({ diferir: true });
    const { f, r, lista, exponer } = await montar(filas('a', 'b'));
    f.datos = filas('b', 'a');
    await act(() => lista().actualizar());
    r.rerender(<Lista cargar={f.cargar} exponer={exponer} />);
    // frente a [b, a] (lo que llegó) es un alta; frente a [a, b] (lo pintado) sería otro reorden
    f.datos = filas('b', 'a', 'c');
    await act(() => lista().actualizar());
    expect(vt.espia).toHaveBeenCalledOnce();
    expect(orden()).toEqual(['b', 'a', 'c']);
    expect(lista().nuevos).toEqual(new Set(['c']));
    vt.correr();
    expect(orden()).toEqual(['b', 'a', 'c']);
  });

  it('dos reordenamientos seguidos: gana el último aunque los updates corran en orden', async () => {
    const vt = simularVT({ diferir: true });
    const { f, lista } = await montar(filas('a', 'b', 'c'));
    f.datos = filas('b', 'a', 'c');
    await act(() => lista().actualizar());
    f.datos = filas('c', 'b', 'a');
    await act(() => lista().actualizar());
    expect(vt.tipos).toEqual([['reordenar'], ['reordenar']]);
    vt.correr();
    expect(orden()).toEqual(['c', 'b', 'a']);
  });
});

describe('UI·21 · el foco sobrevive al reordenamiento', () => {
  it('al instante (sin View Transitions): el mismo botón sigue enfocado', async () => {
    const { f, lista } = await montar(filas('a', 'b', 'c'));
    const b = screen.getByRole('button', { name: 'b' });
    act(() => b.focus());
    f.datos = filas('c', 'a', 'b'); // «b» es de los que React mueve
    await act(() => lista().actualizar());
    expect(orden()).toEqual(['c', 'a', 'b']);
    expect(screen.getByRole('button', { name: 'b' })).toBe(b);
    expect(b).toHaveFocus();
  });

  it('dentro de la transición (flushSync): el mismo botón sigue enfocado', async () => {
    const vt = simularVT();
    const { f, lista } = await montar(filas('a', 'b', 'c'));
    const b = screen.getByRole('button', { name: 'b' });
    act(() => b.focus());
    f.datos = filas('b', 'c', 'a');
    await act(() => lista().actualizar());
    expect(vt.espia).toHaveBeenCalledOnce();
    expect(orden()).toEqual(['b', 'c', 'a']);
    expect(screen.getByRole('button', { name: 'b' })).toBe(b);
    expect(b).toHaveFocus();
  });

  it('con el pintado diferido: el mismo botón sigue enfocado al pintar', async () => {
    const vt = simularVT({ diferir: true });
    const { f, lista } = await montar(filas('a', 'b', 'c'));
    const b = screen.getByRole('button', { name: 'b' });
    act(() => b.focus());
    f.datos = filas('c', 'b', 'a');
    await act(() => lista().actualizar());
    vt.correr();
    expect(orden()).toEqual(['c', 'b', 'a']);
    expect(screen.getByRole('button', { name: 'b' })).toBe(b);
    expect(b).toHaveFocus();
  });
});

describe('UI·21 · alTerminar', () => {
  it('se llama UNA vez, en el paso de vivo a terminado', async () => {
    const alTerminar = vi.fn();
    const { f, lista } = await montar([{ id: 'a', vivo: true }, { id: 'b' }], { vivo: algoVivo, alTerminar });
    expect(alTerminar).not.toHaveBeenCalled();
    await act(() => lista().actualizar()); // sigue vivo
    expect(alTerminar).not.toHaveBeenCalled();
    f.datos = filas('a', 'b');
    await act(() => lista().actualizar()); // terminó
    expect(alTerminar).toHaveBeenCalledOnce();
    await act(() => lista().actualizar()); // ya estaba terminado
    await act(() => lista().actualizar());
    expect(alTerminar).toHaveBeenCalledOnce();
  });

  it('no se llama si ya estaba terminado al entrar', async () => {
    const alTerminar = vi.fn();
    const { lista } = await montar(filas('a'), { vivo: algoVivo, alTerminar });
    await act(() => lista().actualizar());
    expect(alTerminar).not.toHaveBeenCalled();
  });

  it('también una sola vez si el turno que termina reordena (y el pintado se difiere)', async () => {
    const vt = simularVT({ diferir: true });
    const alTerminar = vi.fn();
    const { f, lista } = await montar([{ id: 'a' }, { id: 'b', vivo: true }], { vivo: algoVivo, alTerminar });
    f.datos = filas('b', 'a');
    await act(() => lista().actualizar());
    expect(alTerminar).toHaveBeenCalledOnce();
    vt.correr();
    await act(() => lista().actualizar());
    expect(alTerminar).toHaveBeenCalledOnce();
    expect(orden()).toEqual(['b', 'a']);
  });
});

describe('UI·21 · dos actualizaciones en el mismo lote de React', () => {
  it('la segunda no borra la marca de «nuevo» que trajo la primera', async () => {
    const { result } = renderHook(() => useListaViva(async () => filas('a'), nada, { claves }));
    await waitFor(() => expect(result.current.datos).toEqual(filas('a')));
    act(() => {
      result.current.poner(filas('x', 'a'));
      result.current.poner(filas('x', 'a'));
    });
    expect([...result.current.nuevos]).toEqual(['x']);
  });
});
