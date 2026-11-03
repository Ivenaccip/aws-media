// El arrastre de un cuadro (useArrastre.ts). jsdom no tiene setPointerCapture, ni layout: se prueba con el PointerEvent
// que sí tiene, con un botón de juguete que cuelga los manejadores igual que Nodo.tsx, y con las coordenadas del
// puntero (el hook trabaja con desplazamientos, no con medidas).
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { PointerEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Punto } from './modelo/tipos';
import { useArrastre } from './useArrastre';

interface Registro {
  mueve: Array<[string, number, number]>;
  clics: number;
}

// aparte del componente: el registro es del arnés de la prueba y react-hooks no deja mutar lo que entra por props
function contarClic(reg: Registro) {
  reg.clics += 1;
}

function Caja({ x = 100, y = 50, reg, scroll }: { x?: number; y?: number; reg: Registro; scroll?: () => Punto }) {
  const arrastre = useArrastre({
    alMover: (id, nx, ny) => reg.mueve.push([id, nx, ny]),
    ...(scroll ? { leerScroll: scroll } : {}),
  });
  return (
    <button
      type="button"
      onPointerDown={e => arrastre.presionar(e, { id: 'a1', x, y })}
      onPointerMove={arrastre.mover}
      onPointerUp={arrastre.soltar}
      onPointerCancel={arrastre.soltar}
      onLostPointerCapture={arrastre.soltar}
      onClick={() => {
        if (arrastre.clicSuprimido()) return;
        contarClic(reg);
      }}
    >
      cuadro
    </button>
  );
}

const nuevo = (): Registro => ({ mueve: [], clics: 0 });
const caja = () => screen.getByRole('button', { name: 'cuadro' });
/** Un evento de puntero primario y con el botón principal apretado, como un ratón o un dedo en contacto. */
const dedo = (clientX: number, clientY: number, extra: Record<string, unknown> = {}) => ({ clientX, clientY, pointerId: 1, button: 0, buttons: 1, ...extra });

describe('useArrastre', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('constructor.arrastre.bajo_el_umbral_de_6_manhattan_es_un_clic_y_no_mueve_nada', () => {
    const reg = nuevo();
    render(<Caja reg={reg} />);
    fireEvent.pointerDown(caja(), dedo(10, 10));
    fireEvent.pointerMove(caja(), dedo(13, 12)); // 3 + 2 = 5 < 6
    fireEvent.pointerMove(caja(), dedo(10, 15)); // 0 + 5 = 5 < 6
    fireEvent.pointerUp(caja(), dedo(10, 15, { buttons: 0 }));
    fireEvent.click(caja());
    expect(reg.mueve).toEqual([]);
    expect(reg.clics).toBe(1); // sigue siendo un clic: nada lo suprimió
  });

  it('constructor.arrastre.al_llegar_a_6_manhattan_empieza_y_cada_movimiento_avisa_origen_mas_desplazamiento', () => {
    const reg = nuevo();
    render(<Caja x={100} y={50} reg={reg} />);
    fireEvent.pointerDown(caja(), dedo(10, 10));
    fireEvent.pointerMove(caja(), dedo(14, 12)); // 4 + 2 = 6: justo el umbral
    fireEvent.pointerMove(caja(), dedo(30, 5));
    fireEvent.pointerMove(caja(), dedo(0, 40));
    expect(reg.mueve).toEqual([
      ['a1', 104, 52],
      ['a1', 120, 45],
      ['a1', 90, 80],
    ]);
  });

  it('constructor.arrastre.una_vez_empezado_ya_no_se_vuelve_a_pedir_el_umbral', () => {
    const reg = nuevo();
    render(<Caja x={0} y={0} reg={reg} />);
    fireEvent.pointerDown(caja(), dedo(50, 50));
    fireEvent.pointerMove(caja(), dedo(60, 50)); // empieza
    fireEvent.pointerMove(caja(), dedo(51, 50)); // vuelve a 1 px del origen: sigue arrastrando
    expect(reg.mueve).toEqual([
      ['a1', 10, 0],
      ['a1', 1, 0],
    ]);
  });

  it('constructor.arrastre.el_clic_que_sigue_a_un_arrastre_se_suprime_una_vez_y_el_siguiente_si_pasa', () => {
    const reg = nuevo();
    render(<Caja reg={reg} />);
    fireEvent.pointerDown(caja(), dedo(10, 10));
    fireEvent.pointerMove(caja(), dedo(60, 10));
    fireEvent.pointerUp(caja(), dedo(60, 10, { buttons: 0 }));
    fireEvent.click(caja()); // el que cierra el arrastre
    expect(reg.clics).toBe(0);
    fireEvent.click(caja()); // otro clic de inmediato: ese sí es de la persona
    expect(reg.clics).toBe(1);
  });

  it('constructor.arrastre.la_marca_de_supresion_se_apaga_sola_si_el_clic_nunca_llega', () => {
    const reg = nuevo();
    render(<Caja reg={reg} />);
    fireEvent.pointerDown(caja(), dedo(10, 10));
    fireEvent.pointerMove(caja(), dedo(60, 10));
    fireEvent.pointerUp(caja(), dedo(60, 10, { buttons: 0 }));
    vi.advanceTimersByTime(0); // termina el turno de eventos: ya no habrá clic de ese gesto
    fireEvent.click(caja());
    expect(reg.clics).toBe(1);
  });

  it('constructor.arrastre.un_clic_sin_arrastre_no_deja_marca_y_el_siguiente_clic_pasa', () => {
    const reg = nuevo();
    render(<Caja reg={reg} />);
    fireEvent.pointerDown(caja(), dedo(10, 10));
    fireEvent.pointerUp(caja(), dedo(10, 10, { buttons: 0 }));
    fireEvent.click(caja());
    fireEvent.click(caja());
    expect(reg.clics).toBe(2);
  });

  it('constructor.arrastre.si_el_boton_ya_no_esta_apretado_el_arrastre_se_cancela_y_no_mueve_mas', () => {
    const reg = nuevo();
    render(<Caja reg={reg} />);
    fireEvent.pointerDown(caja(), dedo(10, 10));
    fireEvent.pointerMove(caja(), dedo(40, 10));
    expect(reg.mueve).toHaveLength(1);
    fireEvent.pointerMove(caja(), dedo(80, 10, { buttons: 0 })); // se soltó fuera de la ventana
    fireEvent.pointerMove(caja(), dedo(120, 10)); // aunque ahora haya botón de nuevo, el gesto ya murió
    expect(reg.mueve).toHaveLength(1);
  });

  it('constructor.arrastre.solo_el_boton_principal_inicia_el_gesto', () => {
    const reg = nuevo();
    render(<Caja reg={reg} />);
    fireEvent.pointerDown(caja(), dedo(10, 10, { button: 2, buttons: 2 }));
    fireEvent.pointerMove(caja(), dedo(60, 10, { buttons: 2 }));
    fireEvent.pointerDown(caja(), dedo(10, 10, { button: 1, buttons: 4 }));
    fireEvent.pointerMove(caja(), dedo(60, 10, { buttons: 4 }));
    expect(reg.mueve).toEqual([]);
  });

  it('constructor.arrastre.pide_la_captura_del_puntero_al_presionar_y_sin_captura_no_falla', () => {
    const reg = nuevo();
    render(<Caja reg={reg} />);
    // jsdom no tiene setPointerCapture: presionar y mover no debe lanzar
    expect(() => {
      fireEvent.pointerDown(caja(), dedo(10, 10));
      fireEvent.pointerMove(caja(), dedo(60, 10));
    }).not.toThrow();
    expect(reg.mueve).toHaveLength(1);

    const captura = vi.fn();
    caja().setPointerCapture = captura;
    fireEvent.pointerUp(caja(), dedo(60, 10, { buttons: 0 }));
    fireEvent.pointerDown(caja(), dedo(10, 10, { pointerId: 7 }));
    expect(captura).toHaveBeenCalledWith(7);
  });

  it('constructor.arrastre.un_puntero_que_ya_no_existe_al_pedir_la_captura_no_rompe_el_gesto', () => {
    const reg = nuevo();
    render(<Caja reg={reg} />);
    caja().setPointerCapture = () => {
      throw new DOMException('no existe', 'NotFoundError');
    };
    expect(() => fireEvent.pointerDown(caja(), dedo(10, 10))).not.toThrow();
    fireEvent.pointerMove(caja(), dedo(60, 10));
    expect(reg.mueve).toHaveLength(1);
  });

  it('constructor.arrastre.si_el_marco_se_desplaza_durante_el_arrastre_el_cuadro_sigue_al_puntero', () => {
    const reg = nuevo();
    const marco: Punto = { x: 30, y: 0 };
    render(<Caja x={100} y={50} reg={reg} scroll={() => ({ ...marco })} />); // como el marco real: un objeto nuevo en cada lectura
    fireEvent.pointerDown(caja(), dedo(10, 10)); // el marco ya estaba en 30
    fireEvent.pointerMove(caja(), dedo(40, 10)); // sin desplazarse más: +30 del puntero
    marco.x = 80; // la rueda mueve el marco 50 px
    marco.y = 12;
    fireEvent.pointerMove(caja(), dedo(40, 10)); // el puntero no se movió, el lienzo sí: el cuadro va con él
    expect(reg.mueve).toEqual([
      ['a1', 130, 50],
      ['a1', 180, 62],
    ]);
  });

  it('constructor.arrastre.pointercancel_y_la_captura_perdida_terminan_el_gesto', () => {
    const reg = nuevo();
    render(<Caja reg={reg} />);
    fireEvent.pointerDown(caja(), dedo(10, 10));
    fireEvent.pointerMove(caja(), dedo(40, 10));
    fireEvent.pointerCancel(caja(), dedo(40, 10));
    fireEvent.pointerMove(caja(), dedo(90, 10));
    expect(reg.mueve).toHaveLength(1);

    fireEvent.pointerDown(caja(), dedo(10, 10));
    fireEvent.pointerMove(caja(), dedo(40, 10));
    fireEvent.lostPointerCapture(caja(), dedo(40, 10));
    fireEvent.pointerMove(caja(), dedo(90, 10));
    expect(reg.mueve).toHaveLength(2);
  });

  it('constructor.arrastre.un_segundo_dedo_no_secuestra_el_arrastre_en_curso_ni_lo_termina', () => {
    const reg = nuevo();
    render(<Caja x={0} y={0} reg={reg} />);
    fireEvent.pointerDown(caja(), dedo(10, 10, { pointerId: 1 }));
    fireEvent.pointerDown(caja(), dedo(200, 200, { pointerId: 2 })); // otro dedo
    fireEvent.pointerMove(caja(), dedo(300, 300, { pointerId: 2 })); // se mueve el otro: ignorado
    fireEvent.pointerUp(caja(), dedo(300, 300, { pointerId: 2, buttons: 0 })); // y se levanta: no termina el primero
    fireEvent.pointerMove(caja(), dedo(40, 10, { pointerId: 1 }));
    expect(reg.mueve).toEqual([['a1', 30, 0]]);
  });

  it('constructor.arrastre.un_gesto_huerfano_no_deja_muerto_el_arrastre_de_otro_dedo_primario_del_mismo_tipo', () => {
    // el primer dedo se perdió (su pointerup nunca llegó: el cuadro se desmontó a mitad del gesto, un gesto del sistema)
    const reg = nuevo();
    render(<Caja x={0} y={0} reg={reg} />);
    fireEvent.pointerDown(caja(), dedo(10, 10, { pointerId: 5, isPrimary: true, pointerType: 'touch' }));
    // un dedo nuevo llega cuando NO hay otro apoyado (es primario): el anterior ya no existe y este arrastra
    fireEvent.pointerDown(caja(), dedo(100, 100, { pointerId: 6, isPrimary: true, pointerType: 'touch' }));
    fireEvent.pointerMove(caja(), dedo(130, 100, { pointerId: 6, isPrimary: true, pointerType: 'touch' }));
    expect(reg.mueve).toEqual([['a1', 30, 0]]);
    // el dedo viejo, si volviera a hablar, ya no manda
    fireEvent.pointerMove(caja(), dedo(500, 500, { pointerId: 5, isPrimary: true, pointerType: 'touch' }));
    expect(reg.mueve).toHaveLength(1);
  });

  it('constructor.arrastre.un_dedo_que_no_es_primario_o_un_puntero_de_otro_tipo_siguen_sin_secuestrar_el_arrastre', () => {
    const reg = nuevo();
    render(<Caja x={0} y={0} reg={reg} />);
    fireEvent.pointerDown(caja(), dedo(10, 10, { pointerId: 1, isPrimary: true, pointerType: 'touch' }));
    // el segundo dedo mientras el primero sigue apoyado NO es primario; un ratón es primario de su propio tipo
    fireEvent.pointerDown(caja(), dedo(200, 200, { pointerId: 2, isPrimary: false, pointerType: 'touch' }));
    fireEvent.pointerDown(caja(), dedo(300, 300, { pointerId: 3, isPrimary: true, pointerType: 'mouse' }));
    fireEvent.pointerMove(caja(), dedo(400, 400, { pointerId: 2, isPrimary: false, pointerType: 'touch' }));
    fireEvent.pointerMove(caja(), dedo(500, 500, { pointerId: 3, isPrimary: true, pointerType: 'mouse' }));
    expect(reg.mueve).toEqual([]);
    fireEvent.pointerMove(caja(), dedo(40, 10, { pointerId: 1, isPrimary: true, pointerType: 'touch' }));
    expect(reg.mueve).toEqual([['a1', 30, 0]]);
  });

  it('constructor.arrastre.unas_coordenadas_que_no_son_numeros_no_inician_ni_mueven_nada', () => {
    // un navegador real nunca las produce (y jsdom ni deja construir el evento): se llama al manejador con un evento a mano
    const reg = nuevo();
    const { result } = renderHook(() => useArrastre({ alMover: (id, x, y) => reg.mueve.push([id, x, y]) }));
    const evento = (clientX: number, clientY: number) =>
      ({ clientX, clientY, pointerId: 1, button: 0, buttons: 1, currentTarget: document.body }) as unknown as PointerEvent<HTMLElement>;
    result.current.presionar(evento(Number.NaN, 10), { id: 'a1', x: 0, y: 0 });
    result.current.mover(evento(60, 10));
    expect(reg.mueve).toEqual([]);

    result.current.presionar(evento(10, 10), { id: 'a1', x: 0, y: 0 });
    result.current.mover(evento(Number.POSITIVE_INFINITY, 10));
    expect(reg.mueve).toEqual([]);
    result.current.mover(evento(30, 10)); // y con un número de verdad el gesto sigue vivo
    expect(reg.mueve).toEqual([['a1', 20, 0]]);
  });

  it('constructor.arrastre.el_arrastre_no_elige_el_cuadro_ni_abre_nada_por_si_solo', () => {
    // el hook solo avisa posiciones: ni selecciona ni dispara el clic
    const reg = nuevo();
    render(<Caja reg={reg} />);
    fireEvent.pointerDown(caja(), dedo(10, 10));
    fireEvent.pointerMove(caja(), dedo(70, 40));
    fireEvent.pointerUp(caja(), dedo(70, 40, { buttons: 0 }));
    expect(reg.clics).toBe(0);
    expect(reg.mueve).toEqual([['a1', 160, 80]]);
  });
});
