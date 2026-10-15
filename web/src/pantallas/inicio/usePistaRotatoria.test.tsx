// usePistaRotatoria, solo y con un arnés: lo que Edicion.test.tsx no puede forzar desde la caja entera.
//
// El guardia `rota &&` del retorno del hook no es redundante con el reinicio que se hace al renderizar (el que devuelve la idea
// que iba saliendo a verse entera cuando `rota` cambia): ese reinicio solo corre en el render donde `rota` cambia, y un
// temporizador viejo puede vencer DESPUÉS de ese render y ANTES de que React limpie el efecto del temporizador, dejando
// `paso.saliendo` en true con `rota` en falso. Desde la caja entera esa carrera no se produce (foco, texto, pestaña y
// preferencia pasan por efectos y eventos que React ordena), así que aquí el arnés vence el temporizador a mano, en el
// efecto de layout, que corre entre el commit que para la rotación y la limpieza del efecto pasivo.
import { StrictMode, useLayoutEffect, useState } from 'react';
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
  const pista = usePistaRotatoria(IDEAS_EDICION, quieta, true);
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

// `enVista`: la caja de Edición sigue montada pero escondida (la tarjeta del inicio la esconde con `hidden` mientras se ve el mapa,
// las opciones o una lista). Sin campo a la vista no corre NINGÚN temporizador, y lo que había avanzado se olvida: al volver, la
// primera idea, sin fundido, y de ahí rota. Los nombres de estas pruebas no llevan el prefijo `inicio.` (el de los invariantes del
// registro anti-pérdida): es una función nueva, no algo que la pantalla vieja garantizara.
function Pista({ quieta = false, enVista }: { quieta?: boolean; enVista: boolean }) {
  const pista = usePistaRotatoria(IDEAS_EDICION, quieta, enVista);
  return (
    <>
      <output data-testid="saliendo">{String(pista.saliendo)}</output>
      <output data-testid="idea">{pista.idea}</output>
    </>
  );
}

const idea = () => screen.getByTestId('idea').textContent;
const saliendo = () => screen.getByTestId('saliendo').textContent === 'true';
/** Un tramo del reloj falso. El temporizador de cada paso lo arma un efecto, que corre al salir del act: de a un paso por llamada. */
const avanzar = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
const ANTES_DE_SALIR = PISTA_CADA_MS - PISTA_FUNDIDO_MS;
/** Una vuelta de la rotación: sale la idea de turno (a los 3.75 s) y entra la siguiente (a los 4 s). */
const unaIdea = () => {
  avanzar(ANTES_DE_SALIR);
  avanzar(PISTA_FUNDIDO_MS);
};

it('fuera_de_la_vista_no_arma_ningun_temporizador_por_mucho_que_pase', () => {
  render(<Pista enVista={false} />);
  expect(vi.getTimerCount()).toBe(0);
  avanzar(PISTA_CADA_MS * 40);
  expect(idea()).toBe(IDEAS_EDICION[0]);
  expect(saliendo()).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('al_salir_de_la_vista_olvida_lo_avanzado_y_al_volver_empieza_en_la_primera_sin_fundido_y_rota_desde_ahi', () => {
  const { rerender } = render(<Pista enVista />);
  expect(vi.getTimerCount()).toBe(1);
  unaIdea();
  unaIdea();
  expect(idea()).toBe(IDEAS_EDICION[2]);
  // se esconde: la pista vuelve a la primera ya (con el campo apagado) y no queda nada corriendo
  rerender(<Pista enVista={false} />);
  expect(idea()).toBe(IDEAS_EDICION[0]);
  expect(saliendo()).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  avanzar(PISTA_CADA_MS * 40);
  expect(idea()).toBe(IDEAS_EDICION[0]);
  expect(vi.getTimerCount()).toBe(0);
  // vuelve: la primera, entera y sin salir; un solo reloj; la rotación cuenta su intervalo completo desde ahora
  rerender(<Pista enVista />);
  expect(idea()).toBe(IDEAS_EDICION[0]);
  expect(saliendo()).toBe(false);
  expect(vi.getTimerCount()).toBe(1);
  avanzar(ANTES_DE_SALIR - 1);
  expect(idea()).toBe(IDEAS_EDICION[0]);
  expect(saliendo()).toBe(false);
  avanzar(1);
  expect(saliendo()).toBe(true);
  avanzar(PISTA_FUNDIDO_MS);
  expect(idea()).toBe(IDEAS_EDICION[1]);
  expect(saliendo()).toBe(false);
});

it('si_se_esconde_a_mitad_del_fundido_de_salida_vuelve_entera_en_la_primera', () => {
  const { rerender } = render(<Pista enVista />);
  unaIdea();
  avanzar(ANTES_DE_SALIR);
  expect(idea()).toBe(IDEAS_EDICION[1]);
  expect(saliendo()).toBe(true);
  rerender(<Pista enVista={false} />);
  expect(idea()).toBe(IDEAS_EDICION[0]);
  expect(saliendo()).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  rerender(<Pista enVista />);
  expect(idea()).toBe(IDEAS_EDICION[0]);
  expect(saliendo()).toBe(false);
});

it('solo_enVista_olvida_lo_avanzado_quieta_sigue_retomando_en_la_misma_idea', () => {
  const { rerender } = render(<Pista enVista />);
  unaIdea();
  expect(idea()).toBe(IDEAS_EDICION[1]);
  // el foco o el texto (quieta) congelan la pista en la idea de turno, y al soltarse retoma ahí
  rerender(<Pista enVista quieta />);
  expect(vi.getTimerCount()).toBe(0);
  avanzar(PISTA_CADA_MS * 10);
  expect(idea()).toBe(IDEAS_EDICION[1]);
  rerender(<Pista enVista />);
  expect(idea()).toBe(IDEAS_EDICION[1]);
  expect(vi.getTimerCount()).toBe(1);
  // y escondida con `quieta` también encendida, al volver (ya sin `quieta`) es la primera
  rerender(<Pista enVista={false} quieta />);
  rerender(<Pista enVista quieta={false} />);
  expect(idea()).toBe(IDEAS_EDICION[0]);
});

it('bajo_StrictMode_hay_un_solo_reloj_al_abrir_y_al_volver_a_la_vista_y_desmontar_no_deja_nada', () => {
  const { rerender, unmount } = render(
    <StrictMode>
      <Pista enVista={false} />
    </StrictMode>,
  );
  expect(vi.getTimerCount()).toBe(0);
  rerender(
    <StrictMode>
      <Pista enVista />
    </StrictMode>,
  );
  expect(vi.getTimerCount()).toBe(1);
  unaIdea();
  expect(idea(), 'una sola rotación: pasa a la segunda, no a la tercera').toBe(IDEAS_EDICION[1]);
  rerender(
    <StrictMode>
      <Pista enVista={false} />
    </StrictMode>,
  );
  expect(vi.getTimerCount()).toBe(0);
  rerender(
    <StrictMode>
      <Pista enVista />
    </StrictMode>,
  );
  expect(vi.getTimerCount()).toBe(1);
  expect(idea()).toBe(IDEAS_EDICION[0]);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
