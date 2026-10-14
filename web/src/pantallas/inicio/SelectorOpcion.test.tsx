// SelectorOpcion es el chip + lista que comparten Imagen, Video y Edición. Inicio.test.tsx y Edicion.test.tsx lo prueban
// desde la caja, pero con una o dos opciones, donde Inicio/Fin, la marca de la elegida y el reposicionamiento no se pueden
// distinguir. Aquí se prueba solo, con TRES opciones, para que quien lo toque tenga red de seguridad en todo lo que hace.
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SelectorOpcion } from './SelectorOpcion';

const OPCIONES = [
  { id: 'a', rotulo: 'Uno', nota: 'nota uno' },
  { id: 'b', rotulo: 'Dos', nota: 'nota dos' },
  { id: 'c', rotulo: 'Tres', nota: 'nota tres' },
] as const;

function montar(elegidaId: 'a' | 'b' | 'c' = 'b') {
  const alElegir = vi.fn();
  render(
    <>
      <button type="button">antes</button>
      <SelectorOpcion
        opciones={OPCIONES}
        elegida={OPCIONES.find(o => o.id === elegidaId)!}
        detalle={o => 'detalle ' + o.id}
        alElegir={alElegir}
      />
      <button type="button">después</button>
    </>,
  );
  return alElegir;
}
// el nombre accesible del chip es solo el rótulo (la ▾ es decoración), así que se busca por su rol y su pista
const chip = () => document.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;
const lista = () => screen.queryByRole('listbox');
const opcion = (n: RegExp) => within(screen.getByRole('listbox')).getByRole('option', { name: n });

afterEach(() => {
  // clientWidth es global: lo que una prueba fije no puede contaminar a las demás
  delete (document.documentElement as { clientWidth?: number }).clientWidth;
  vi.restoreAllMocks();
});

describe('SelectorOpcion (con 3 opciones, que es donde se distinguen)', () => {
  it('inicio.caja.selector_el_chip_dice_la_opcion_elegida_y_su_pista_y_no_recorta_su_propia_pista', () => {
    montar('b');
    expect(chip()).toHaveTextContent(/^Dos ▾$/);
    expect(chip()).toHaveAttribute('data-pista', 'nota dos');
    expect(chip()).toHaveAttribute('aria-expanded', 'false');
    // La pista es el ::after del propio chip, que cuelga FUERA de él (arriba). Con `overflow-hidden` en el botón nunca se
    // vería (jsdom no pinta: el atributo data-pista estaba bien y la pista no salía). El recorte con «…» va en el rótulo.
    const clases = chip().className.split(/\s+/);
    expect(clases).not.toContain('overflow-hidden');
    expect(clases).not.toContain('overflow-clip');
    expect(clases).not.toContain('text-ellipsis');
    // y con la lista abierta el globo se quita (la nota ya sale en la fila)
    expect(clases).toContain('aria-expanded:after:hidden');
    const rotulo = within(chip()).getByText('Dos');
    expect(rotulo.className.split(/\s+/)).toEqual(expect.arrayContaining(['truncate', 'min-w-0']));
    expect(rotulo).not.toHaveAttribute('aria-hidden');
  });

  it('inicio.caja.selector_abre_marcando_la_elegida_y_solo_ella_lleva_aria_selected', async () => {
    montar('b');
    // cerrada, la lista no existe en el DOM: el chip no apunta a un id sin destino (`aria-controls` solo mientras está abierta)
    expect(lista()).toBeNull();
    expect(chip()).not.toHaveAttribute('aria-controls');
    await userEvent.click(chip());
    const filas = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(filas.map(f => f.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(opcion(/Dos/)).toHaveFocus();
    // abierta, `aria-controls` apunta a la lista que sí existe
    const id = chip().getAttribute('aria-controls');
    expect(id).toBeTruthy();
    expect(screen.getByRole('listbox').id).toBe(id);
    // y al cerrarla se quita otra vez
    await userEvent.keyboard('{Escape}');
    expect(lista()).toBeNull();
    expect(chip()).not.toHaveAttribute('aria-controls');
  });

  it('inicio.caja.selector_flechas_inicio_y_fin_recorren_y_enter_elige_la_marcada', async () => {
    const alElegir = montar('b');
    await userEvent.click(chip());
    await userEvent.keyboard('{Home}');
    expect(opcion(/Uno/)).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(opcion(/Uno/)).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(opcion(/Tres/)).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(opcion(/Tres/)).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(opcion(/Dos/)).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(alElegir).toHaveBeenCalledWith(OPCIONES[1]);
    expect(lista()).toBeNull();
    expect(chip()).toHaveFocus();
  });

  it('inicio.caja.selector_pasar_el_raton_marca_la_fila', async () => {
    montar('a');
    await userEvent.click(chip());
    await userEvent.hover(opcion(/Tres/));
    expect(opcion(/Tres/)).toHaveFocus();
  });

  it('inicio.caja.selector_tab_y_mayus_tab_cierran_y_el_foco_sigue_desde_el_chip_nunca_a_body', async () => {
    montar('b');
    // Tab: cierra y sigue con lo que viene DESPUÉS del chip
    await userEvent.click(chip());
    expect(lista()).not.toBeNull();
    await userEvent.keyboard('{Tab}');
    expect(lista()).toBeNull();
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole('button', { name: 'después' })).toHaveFocus();
    // Shift+Tab: cierra y sigue con lo que viene ANTES del chip
    await userEvent.click(chip());
    expect(lista()).not.toBeNull();
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(lista()).toBeNull();
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole('button', { name: 'antes' })).toHaveFocus();
    // y no eligió nada
    expect(chip()).toHaveTextContent(/^Dos ▾$/);
  });

  it('inicio.caja.selector_esc_y_clic_fuera_cierran_y_esc_devuelve_el_foco_al_chip', async () => {
    montar('b');
    await userEvent.click(chip());
    await userEvent.keyboard('{Escape}');
    expect(lista()).toBeNull();
    expect(chip()).toHaveFocus();
    await userEvent.click(chip());
    await userEvent.click(screen.getByRole('button', { name: 'después' }));
    expect(lista()).toBeNull();
  });

  it('inicio.caja.selector_se_sujeta_dentro_de_la_ventana_al_abrir_y_al_girar_el_telefono', async () => {
    montar('a');
    await userEvent.click(chip());
    const abierta = screen.getByRole('listbox');
    // jsdom mide todo en 0: el margen de 12 es lo único que la sujeta (un `left:0px` fijo no lo cumpliría)
    expect(abierta.style.left).toBe('12px');
    vi.spyOn(chip(), 'getBoundingClientRect').mockReturnValue({ left: 300, width: 100 } as DOMRect);
    vi.spyOn(abierta, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 400 } as DOMRect);
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 500 });
    fireEvent(window, new Event('resize'));
    // tope = 500 - 12 - 400 = 88; el chip está en 300 → se corre a 88 - 300 = -212
    expect(abierta.style.left).toBe('-212px');
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1000 });
    fireEvent(window, new Event('resize'));
    expect(abierta.style.left).toBe('0px'); // cabe: 1000 - 12 - 400 = 588 ≥ 300 → izq - izq = 0
  });
});
