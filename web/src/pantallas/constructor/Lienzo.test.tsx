// El lienzo (Lienzo.tsx): marco con scroll, cuadros, flechas y el espacio para el menú. Se prueba montado con lo que
// de verdad calculan los selectores del motor sobre el flujo de ejemplo, y devuelve eventos: aquí no hay reductor.
import { createRef, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Lienzo, type PropsLienzo } from './Lienzo';
import { ejemplo } from './modelo/ejemplos';
import { vistaFlechas, vistaLienzo, vistaNodos, type EstadoVista } from './modelo/selectores';
import type { Flujo } from './modelo/tipos';

const estado = (extra: Partial<EstadoVista> = {}, flujo: Flujo = ejemplo()): EstadoVista => ({ flujo, sel: null, selEdge: null, menu: null, conectando: null, ...extra });

function eventos() {
  return {
    alMoverNodo: vi.fn(),
    alMoverConTeclado: vi.fn(),
    alAbrirNodo: vi.fn(),
    alQuitarNodo: vi.fn(),
    alAbrirMas: vi.fn(),
    alAbrirFlecha: vi.fn(),
    alEscape: vi.fn(),
    alClicFondo: vi.fn(),
  };
}

type Eventos = ReturnType<typeof eventos>;

/** El lienzo con los datos del estado dado, como lo ensambla el Constructor. */
function Montaje({ e = estado(), ev, hijos, ...resto }: { e?: EstadoVista; ev: Eventos; hijos?: ReactNode } & Partial<PropsLienzo>) {
  const { ancho, alto } = vistaLienzo(e);
  return (
    <Lienzo nodos={vistaNodos(e)} flechas={vistaFlechas(e)} ancho={ancho} alto={alto} modoConexion={!!e.conectando} {...ev} {...resto}>
      {hijos}
    </Lienzo>
  );
}

function montar(e: EstadoVista = estado(), extra: Partial<PropsLienzo> & { hijos?: ReactNode } = {}) {
  const ev = eventos();
  const r = render(<Montaje e={e} ev={ev} {...extra} />);
  const marco = () => screen.getByRole('group', { name: 'Lienzo del flujo' });
  const lienzo = () => marco().firstElementChild as HTMLElement;
  const nodo = (id: string) => document.querySelector<HTMLElement>(`[data-nodo="${id}"]`)!;
  return { ev, r, marco, lienzo, nodo };
}

const dedo = (clientX: number, clientY: number, extra: Record<string, unknown> = {}) => ({ clientX, clientY, pointerId: 1, button: 0, buttons: 1, ...extra });

describe('Lienzo: estructura', () => {
  it('constructor.lienzo.el_marco_es_un_grupo_con_nombre_y_el_lienzo_adentro_mide_lo_que_dicen_los_selectores', () => {
    const e = estado();
    const { ancho, alto } = vistaLienzo(e);
    const { marco, lienzo } = montar(e);
    expect(marco()).toBeInTheDocument();
    expect(lienzo().style.width).toBe(`${ancho}px`);
    expect(lienzo().style.height).toBe(`${alto}px`);
    expect(lienzo().getAttribute('role')).toBe('presentation');
    expect(lienzo().className).toContain('cn-lienzo');
  });

  it('constructor.lienzo.el_lienzo_crece_con_ancho_y_alto_y_el_marco_desplaza_adentro_sin_ensanchar_la_pagina', () => {
    const ev = eventos();
    const { rerender } = render(<Lienzo nodos={[]} flechas={[]} ancho={1000} alto={780} modoConexion={false} {...ev} />);
    const marco = screen.getByRole('group', { name: 'Lienzo del flujo' });
    const lienzo = marco.firstElementChild as HTMLElement;
    expect(lienzo.style.width).toBe('1000px');
    rerender(<Lienzo nodos={[]} flechas={[]} ancho={2512} alto={1800} modoConexion={false} {...ev} />);
    expect(lienzo.style.width).toBe('2512px');
    expect(lienzo.style.height).toBe('1800px');
    // el marco es el que se desplaza y nunca pide más ancho que su caja
    for (const clase of ['overflow-auto', 'max-w-full', 'min-w-0', 'isolate']) expect(marco.className).toContain(clase);
    expect(marco.style.width).toBe('');
  });

  it('constructor.lienzo.las_flechas_van_debajo_de_los_cuadros_los_circulos_encima_y_lo_de_adentro_al_final', () => {
    const { lienzo } = montar(estado(), { hijos: <button type="button">menú</button> });
    const hijos = Array.from(lienzo().children);
    const tipo = (el: Element) => (el.tagName.toLowerCase() === 'svg' ? 'linea' : el.matches('.cn-caja-nodo') ? 'cuadro' : el.matches('[data-insignia]') ? 'insignia' : 'hijo');
    const secuencia = hijos.map(tipo);
    expect(secuencia).toEqual(['linea', 'linea', 'linea', 'linea', 'cuadro', 'cuadro', 'cuadro', 'cuadro', 'cuadro', 'insignia', 'insignia', 'insignia', 'insignia', 'hijo']);
  });

  it('constructor.lienzo.el_menu_y_la_tarjeta_se_pintan_dentro_del_lienzo_en_su_sitio_absoluto', () => {
    const { lienzo } = montar(estado(), {
      hijos: (
        <div role="dialog" aria-label="Agregar" style={{ position: 'absolute', left: 292, top: 172 }}>
          <button type="button">Una aplicación</button>
        </div>
      ),
    });
    const menu = screen.getByRole('dialog', { name: 'Agregar' });
    expect(lienzo().contains(menu)).toBe(true);
    expect(menu.style.left).toBe('292px');
    expect(lienzo().className).toContain('cn-lienzo'); // la hoja le da position: relative: el sitio absoluto es el del lienzo
  });

  it('constructor.lienzo.el_orden_de_tab_es_cuadros_con_su_x_y_sus_mas_luego_las_flechas_y_al_final_lo_de_adentro', async () => {
    montar(estado(), { hijos: <button type="button">Una aplicación</button> });
    const user = userEvent.setup();
    const visitados: string[] = [];
    for (let i = 0; i < 40; i++) {
      await user.tab();
      const el = document.activeElement as HTMLElement;
      visitados.push(el.getAttribute('data-nodo') ?? (el.getAttribute('data-quitar') ? `x:${el.getAttribute('data-quitar')}` : null) ?? el.getAttribute('data-mas') ?? (el.getAttribute('data-insignia') ? `flecha:${el.getAttribute('data-insignia')}` : (el.textContent ?? '')));
      if (el.textContent === 'Una aplicación') break;
    }
    expect(visitados).toEqual([
      't1', 'x:t1', 'der-t1',
      'a1', 'x:a1', 'der-a1', 'tool-a1',
      'a2', 'x:a2', 'der-a2', 'tool-a2',
      'p1', 'x:p1',
      'p2', 'x:p2',
      'flecha:e1', 'flecha:e2', 'flecha:e3', 'flecha:e4',
      'Una aplicación',
    ]);
  });

  it('constructor.lienzo.el_marco_no_pide_tabindex_porque_ya_tiene_hijos_enfocables_y_solo_se_vuelve_enfocable_si_esta_vacio', () => {
    const { marco, r } = montar();
    expect(marco().hasAttribute('tabindex')).toBe(false);
    expect(marco().querySelectorAll('button').length).toBeGreaterThan(5); // axe: scrollable-region-focusable
    r.unmount();
    // la tarjeta de «¿Cómo arranca tu flujo?» ya es enfocable: tampoco hace falta
    const ev = eventos();
    const conTarjeta = render(
      <Lienzo nodos={[]} flechas={[]} ancho={1000} alto={780} modoConexion={false} {...ev}>
        <button type="button">Chat</button>
      </Lienzo>,
    );
    expect(screen.getByRole('group', { name: 'Lienzo del flujo' }).hasAttribute('tabindex')).toBe(false);
    conTarjeta.unmount();
    // sin nada adentro y con scroll, el marco mismo tiene que poder recibir el foco para desplazarse con el teclado
    render(<Lienzo nodos={[]} flechas={[]} ancho={1000} alto={780} modoConexion={false} {...ev} />);
    expect(screen.getByRole('group', { name: 'Lienzo del flujo' })).toHaveAttribute('tabindex', '0');
  });

  it('constructor.lienzo.dos_hijos_apagados_con_null_o_false_cuentan_como_nada_adentro', () => {
    // el Constructor pasa `{tarjeta}{menu}`: con los dos apagados llega un arreglo de dos huecos, que es «nada»
    const ev = eventos();
    const sinNada = render(
      <Lienzo nodos={[]} flechas={[]} ancho={1000} alto={780} modoConexion={false} {...ev}>
        {null}
        {false}
      </Lienzo>,
    );
    expect(screen.getByRole('group', { name: 'Lienzo del flujo' })).toHaveAttribute('tabindex', '0');
    sinNada.unmount();
    render(
      <Lienzo nodos={[]} flechas={[]} ancho={1000} alto={780} modoConexion={false} {...ev}>
        {null}
        <button type="button">Chat</button>
      </Lienzo>,
    );
    expect(screen.getByRole('group', { name: 'Lienzo del flujo' }).hasAttribute('tabindex')).toBe(false);
  });

  it('constructor.lienzo.la_ayuda_de_teclado_describe_el_lienzo_si_se_pasa_su_id', () => {
    const { marco, r } = montar(estado(), { ayudaId: 'ayuda-lienzo' });
    expect(marco()).toHaveAttribute('aria-describedby', 'ayuda-lienzo');
    r.unmount();
    expect(montar().marco()).not.toHaveAttribute('aria-describedby');
  });

  it('constructor.lienzo.el_modo_conectando_se_marca_en_el_marco_y_el_marco_se_entrega_por_ref', () => {
    const ref = createRef<HTMLDivElement>();
    const { marco, r } = montar(estado({ conectando: { ancla: 'a1', rol: 'origen', tipo: 'seq' } }), { marcoRef: ref });
    expect(marco()).toHaveAttribute('data-conectando', 'true');
    expect(ref.current).toBe(marco());
    r.unmount();
    expect(montar().marco()).not.toHaveAttribute('data-conectando');
  });

  it('constructor.lienzo.cada_cuadro_conserva_su_elemento_al_moverse_el_orden_del_dom_no_cambia_con_el_arrastre', () => {
    const flujo = ejemplo();
    const ev = eventos();
    const { rerender } = render(<Montaje e={estado({}, flujo)} ev={ev} />);
    const antes = Array.from(document.querySelectorAll('[data-nodo]'));
    const movido: Flujo = { ...flujo, nodes: flujo.nodes.map(n => (n.id === 'a1' ? { ...n, x: 800, y: 40 } : n)) };
    rerender(<Montaje e={estado({}, movido)} ev={ev} />);
    const despues = Array.from(document.querySelectorAll('[data-nodo]'));
    expect(despues).toEqual(antes); // mismos elementos, mismo orden
    expect((document.querySelector('[data-nodo="a1"]')!.parentElement as HTMLElement).style.left).toBe('800px');
    expect((document.querySelector('[data-nodo="a1"]')!.parentElement as HTMLElement).style.top).toBe('40px');
  });

  it('constructor.lienzo.un_lienzo_vacio_no_pinta_cuadros_ni_flechas_pero_si_deja_lo_que_se_le_ponga_adentro', () => {
    const ev = eventos();
    render(
      <Lienzo nodos={[]} flechas={[]} ancho={1000} alto={780} modoConexion={false} {...ev}>
        <button type="button">Chat</button>
      </Lienzo>,
    );
    expect(document.querySelectorAll('[data-nodo]')).toHaveLength(0);
    expect(document.querySelectorAll('svg')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Chat' })).toBeInTheDocument();
  });
});

describe('Lienzo: eventos que devuelve', () => {
  it('constructor.lienzo.cada_gesto_sale_como_evento_con_el_id_del_cuadro_o_de_la_flecha', async () => {
    const { ev, nodo } = montar();
    const user = userEvent.setup();
    await user.click(nodo('a2'));
    expect(ev.alAbrirNodo).toHaveBeenLastCalledWith('a2', false);
    await user.click(document.querySelector('[data-quitar="p1"]')!);
    expect(ev.alQuitarNodo).toHaveBeenLastCalledWith('p1');
    await user.click(document.querySelector('[data-insignia="e3"]')!);
    expect(ev.alAbrirFlecha).toHaveBeenLastCalledWith('e3');
    nodo('a1').focus();
    await user.keyboard('{Enter}');
    expect(ev.alAbrirNodo).toHaveBeenLastCalledWith('a1', true);
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}{ArrowUp}');
    expect(ev.alMoverConTeclado).toHaveBeenNthCalledWith(1, 'a1', 'derecha', true);
    expect(ev.alMoverConTeclado).toHaveBeenNthCalledWith(2, 'a1', 'arriba', false);
    await user.keyboard('{Delete}');
    expect(ev.alQuitarNodo).toHaveBeenLastCalledWith('a1');
  });

  it('constructor.lienzo.los_mas_piden_el_menu_de_lo_que_sigue_o_el_de_herramientas_sin_conexion_donde_insertar', async () => {
    const { ev } = montar();
    const user = userEvent.setup();
    await user.click(document.querySelector('[data-mas="der-a2"]')!);
    await user.click(document.querySelector('[data-mas="tool-a2"]')!);
    expect(ev.alAbrirMas).toHaveBeenNthCalledWith(1, 'a2', 'seq');
    expect(ev.alAbrirMas).toHaveBeenNthCalledWith(2, 'a2', 'tool');
    // poner un cuadro en medio sale del panel de la flecha, no del lienzo: nunca se pasa `insertarEn`
    for (const llamada of ev.alAbrirMas.mock.calls) expect(llamada).toHaveLength(2);
  });

  it('constructor.lienzo.esc_sobre_un_cuadro_avisa_su_id_y_sobre_la_x_un_mas_o_un_circulo_avisa_null', async () => {
    const { ev, nodo } = montar();
    const user = userEvent.setup();
    nodo('a1').focus();
    await user.keyboard('{Escape}');
    expect(ev.alEscape).toHaveBeenLastCalledWith('a1');
    document.querySelector<HTMLElement>('[data-quitar="a1"]')!.focus();
    await user.keyboard('{Escape}');
    expect(ev.alEscape).toHaveBeenLastCalledWith(null);
    document.querySelector<HTMLElement>('[data-mas="tool-a1"]')!.focus();
    await user.keyboard('{Escape}');
    expect(ev.alEscape).toHaveBeenLastCalledWith(null);
    document.querySelector<HTMLElement>('[data-insignia="e1"]')!.focus();
    await user.keyboard('{Escape}');
    expect(ev.alEscape).toHaveBeenLastCalledWith(null);
    expect(ev.alEscape).toHaveBeenCalledTimes(4);
  });

  it('constructor.lienzo.el_esc_de_lo_que_hay_adentro_del_lienzo_como_el_menu_no_llega_a_alescape', async () => {
    const { ev } = montar(estado(), {
      hijos: (
        <div role="dialog" aria-label="Agregar">
          <button type="button">Atrás</button>
        </div>
      ),
    });
    screen.getByRole('button', { name: 'Atrás' }).focus();
    await userEvent.setup().keyboard('{Escape}');
    expect(ev.alEscape).not.toHaveBeenCalled();
  });

  it('constructor.lienzo.un_esc_que_alguien_ya_atendio_no_se_avisa_otra_vez', () => {
    const ev = eventos();
    render(
      <div
        role="presentation"
        onKeyDownCapture={e => {
          if (e.key === 'Escape') e.preventDefault(); // un menú hermano lo atiende primero, en la captura
        }}
      >
        <Montaje ev={ev} />
      </div>,
    );
    fireEvent.keyDown(document.querySelector('[data-nodo="a1"]')!, { key: 'Escape' });
    expect(ev.alEscape).not.toHaveBeenCalled();
  });

  it('constructor.lienzo.un_clic_en_el_fondo_vacio_avisa_y_uno_sobre_un_cuadro_un_boton_o_lo_de_adentro_no', async () => {
    const { ev, lienzo } = montar(estado(), { hijos: <div role="dialog" aria-label="Agregar"><button type="button">Atrás</button></div> });
    const user = userEvent.setup();
    await user.click(lienzo()); // el fondo
    expect(ev.alClicFondo).toHaveBeenCalledTimes(1);
    await user.click(document.querySelector('[data-nodo="a1"]')!);
    await user.click(document.querySelector('[data-quitar="a1"]')!);
    await user.click(document.querySelector('[data-insignia="e1"]')!);
    await user.click(screen.getByRole('button', { name: 'Atrás' }));
    await user.click(screen.getByRole('dialog', { name: 'Agregar' })); // el cuerpo del menú tampoco es el fondo
    expect(ev.alClicFondo).toHaveBeenCalledTimes(1);
  });

  it('constructor.lienzo.el_lienzo_no_se_pone_a_escuchar_clics_con_un_div_con_onclick_sino_con_role_presentation', () => {
    // jsx-a11y strict: un div con onClick falla el lint; role="presentation" es lo que acepta
    const { lienzo } = montar();
    expect(lienzo().tagName).toBe('DIV');
    expect(lienzo().getAttribute('role')).toBe('presentation');
  });
});

describe('Lienzo: arrastrar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('constructor.lienzo.arrastrar_un_cuadro_avisa_las_coordenadas_de_lienzo_y_no_abre_sus_ajustes_al_soltar', () => {
    const { ev, nodo } = montar(); // «a1» está en 312, 180
    fireEvent.pointerDown(nodo('a1'), dedo(500, 300));
    fireEvent.pointerMove(nodo('a1'), dedo(540, 330));
    expect(ev.alMoverNodo).toHaveBeenLastCalledWith('a1', 352, 210);
    fireEvent.pointerMove(nodo('a1'), dedo(470, 280));
    expect(ev.alMoverNodo).toHaveBeenLastCalledWith('a1', 282, 160);
    fireEvent.pointerUp(nodo('a1'), dedo(470, 280, { buttons: 0 }));
    fireEvent.click(nodo('a1'), { detail: 1 });
    expect(ev.alAbrirNodo).not.toHaveBeenCalled();
    // y el siguiente clic de verdad sí abre
    fireEvent.click(nodo('a1'), { detail: 1 });
    expect(ev.alAbrirNodo).toHaveBeenCalledWith('a1', false);
  });

  it('constructor.lienzo.el_clic_que_cierra_un_arrastre_tampoco_cuenta_como_clic_de_fondo', () => {
    const { ev, lienzo, nodo } = montar();
    fireEvent.pointerDown(nodo('a1'), dedo(500, 300));
    fireEvent.pointerMove(nodo('a1'), dedo(700, 300));
    fireEvent.pointerUp(nodo('a1'), dedo(700, 300, { buttons: 0 }));
    // si el navegador mandara el clic al fondo (el puntero se soltó fuera del cuadro), igual se descarta
    fireEvent.click(lienzo());
    expect(ev.alClicFondo).not.toHaveBeenCalled();
    fireEvent.click(lienzo());
    expect(ev.alClicFondo).toHaveBeenCalledTimes(1);
  });

  it('constructor.lienzo.si_el_marco_se_desplaza_en_pleno_arrastre_el_cuadro_va_con_el_puntero', () => {
    const { ev, marco, nodo } = montar();
    fireEvent.pointerDown(nodo('a1'), dedo(500, 300));
    fireEvent.pointerMove(nodo('a1'), dedo(520, 300));
    expect(ev.alMoverNodo).toHaveBeenLastCalledWith('a1', 332, 180);
    Object.defineProperty(marco(), 'scrollLeft', { value: 100, configurable: true });
    Object.defineProperty(marco(), 'scrollTop', { value: 36, configurable: true });
    fireEvent.pointerMove(nodo('a1'), dedo(520, 300)); // el puntero está quieto, el lienzo corrió
    expect(ev.alMoverNodo).toHaveBeenLastCalledWith('a1', 432, 216);
  });

  it('constructor.lienzo.arrastrar_con_el_dedo_no_mueve_los_demas_cuadros_ni_selecciona_nada', () => {
    const { ev, nodo } = montar();
    fireEvent.pointerDown(nodo('a2'), dedo(700, 200, { pointerType: 'touch' }));
    fireEvent.pointerMove(nodo('a2'), dedo(760, 200, { pointerType: 'touch' }));
    expect(ev.alMoverNodo).toHaveBeenCalledTimes(1);
    expect(ev.alMoverNodo.mock.calls[0]![0]).toBe('a2');
    expect(ev.alAbrirNodo).not.toHaveBeenCalled();
    expect(ev.alMoverConTeclado).not.toHaveBeenCalled();
  });

  it('constructor.lienzo.un_cuadro_no_arrastra_a_otro_y_un_gesto_a_la_vez_es_de_un_solo_cuadro', () => {
    const { ev, nodo } = montar();
    fireEvent.pointerDown(nodo('a1'), dedo(500, 300, { pointerId: 1 }));
    fireEvent.pointerDown(nodo('a2'), dedo(800, 300, { pointerId: 2 })); // otro dedo sobre otro cuadro
    fireEvent.pointerMove(nodo('a2'), dedo(900, 300, { pointerId: 2 }));
    expect(ev.alMoverNodo).not.toHaveBeenCalled();
    fireEvent.pointerMove(nodo('a1'), dedo(520, 300, { pointerId: 1 }));
    expect(ev.alMoverNodo).toHaveBeenCalledWith('a1', 332, 180);
  });
});

describe('Lienzo: aviso a lectores de pantalla', () => {
  it('constructor.lienzo.cada_cuadro_y_cada_flecha_traen_su_etiqueta_de_los_selectores_y_nada_interactivo_va_oculto', () => {
    const e = estado();
    montar(e);
    for (const v of vistaNodos(e)) expect(screen.getByRole('button', { name: v.etiqueta })).toBeInTheDocument();
    for (const f of vistaFlechas(e)) expect(screen.getByRole('button', { name: f.etiqueta })).toBeInTheDocument();
    // lo único oculto a lectores son las líneas, los íconos y el rótulo de la patita
    for (const oculto of document.querySelectorAll('[aria-hidden="true"]')) {
      expect(oculto.matches('button') || oculto.querySelector('button')).toBeFalsy();
    }
  });
});
