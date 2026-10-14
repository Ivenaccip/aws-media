// usePistaRotatoria, solo y con un arnés: lo que Edicion.test.tsx no puede forzar desde la caja entera.
//
// El guardia `rota &&` del retorno del hook no es redundante con el reinicio que se hace al renderizar (el que devuelve la idea
// que iba saliendo a verse entera cuando `rota` cambia): ese reinicio solo corre en el render donde `rota` cambia, y un
// temporizador viejo puede vencer DESPUÉS de ese render y ANTES de que React limpie el efecto del temporizador, dejando
// `paso.saliendo` en true con `rota` en falso. Desde la caja entera esa carrera no se produce (foco, texto, pestaña y
// preferencia pasan por efectos y eventos que React ordena), así que aquí el arnés vence el temporizador a mano, en el
// efecto de layout, que corre entre el commit que para la rotación y la limpieza del efecto pasivo.
import { useLayoutEffect, useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { IDEAS_EDICION, PISTA_CADA_MS, PISTA_FUNDIDO_MS } from './edicion';
import { usePistaRotatoria } from './usePistaRotatoria';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function Arnes() {
  const [quieta, setQuieta] = useState(false);
  const pista = usePistaRotatoria(IDEAS_EDICION, quieta);
  // al parar la rotación, el temporizador que seguía armado vence justo aquí (antes de que se limpie su efecto)
  useLayoutEffect(() => {
    if (quieta) vi.advanceTimersByTime(PISTA_CADA_MS - PISTA_FUNDIDO_MS);
  }, [quieta]);
  return (
    <>
      <output data-testid="saliendo">{String(pista.saliendo)}</output>
      <output data-testid="idea">{pista.idea}</output>
      <button type="button" onClick={() => setQuieta(true)}>
        parar
      </button>
    </>
  );
}

it('inicio.edicion.un_temporizador_viejo_que_vence_al_parar_la_rotacion_no_deja_la_pista_a_medio_apagar', () => {
  render(<Arnes />);
  expect(screen.getByTestId('saliendo').textContent).toBe('false');
  expect(vi.getTimerCount()).toBe(1);
  // se para la rotación (el foco, p. ej.) y el temporizador de la idea vence en ese mismo commit: aunque el hook ya guardó
  // `saliendo`, la pista NO se devuelve apagada (opacidad 0 con el campo enfocado = un campo sin pista)
  act(() => {
    screen.getByRole('button', { name: 'parar' }).click();
  });
  expect(screen.getByTestId('saliendo').textContent).toBe('false');
  expect(screen.getByTestId('idea').textContent).toBe(IDEAS_EDICION[0]);
  // y no queda nada corriendo
  expect(vi.getTimerCount()).toBe(0);
});
