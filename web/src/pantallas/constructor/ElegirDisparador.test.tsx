// «¿Qué hace que tu flujo arranque?» como COMPORTAMIENTO: las cuatro opciones mandan `elegirDisparador` con su tipo, el ejemplo solo
// sale con el lienzo vacío, y la primera opción lleva `data-foco="1"` (adonde cae el foco al limpiar o al quitar el disparador).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ElegirDisparador } from './ElegirDisparador';
import { ejemplo } from './modelo/ejemplos';
import { estadoInicial, reducir } from './modelo/reductor';
import { vistaElegirDisparador } from './modelo/selectores';
import type { AccionConstructor } from './modelo/tipos';

function pintar(vista = vistaElegirDisparador(estadoInicial())) {
  const despachar = vi.fn<(a: AccionConstructor) => void>();
  const r = render(<ElegirDisparador vista={vista} despachar={despachar} />);
  return { vista, despachar, ...r };
}

describe('ElegirDisparador', () => {
  it('constructor.elegir_disparador.las_cuatro_opciones_mandan_su_tipo_y_nada_mas', async () => {
    const user = userEvent.setup();
    const { despachar, vista } = pintar();
    expect(vista.opciones.map(o => o.id)).toEqual(['tiempo', 'chat', 'web', 'app']);
    const grupo = screen.getByRole('group', { name: 'Disparador del flujo' });
    expect(grupo.querySelectorAll('button')).toHaveLength(4);
    for (const o of vista.opciones) {
      await user.click(screen.getByRole('button', { name: new RegExp(`^${o.nombre}`) }));
      expect(despachar).toHaveBeenLastCalledWith({ k: 'elegirDisparador', tipo: o.id });
    }
    expect(despachar).toHaveBeenCalledTimes(4);
  });

  it('constructor.elegir_disparador.con_el_lienzo_vacio_ofrece_el_ejemplo_y_dice_paso_1', async () => {
    const user = userEvent.setup();
    const { despachar } = pintar();
    expect(screen.getByText('Paso 1')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '¿Qué hace que tu flujo arranque?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cargar el ejemplo' }));
    expect(despachar).toHaveBeenCalledWith({ k: 'cargarEjemplo' });
  });

  it('constructor.elegir_disparador.sin_disparador_pero_con_cuadros_no_ofrece_el_ejemplo_y_dice_que_falta', () => {
    // se quitó el disparador de un flujo con cuadros: la tarjeta vuelve, sin el ejemplo (reemplazaría lo que hay)
    const sin = reducir(estadoInicial(ejemplo()), { k: 'quitarNodo', id: 't1' });
    pintar(vistaElegirDisparador(sin));
    expect(screen.getByText('Falta el disparador')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Elige qué hace que tu flujo arranque' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cargar el ejemplo' })).not.toBeInTheDocument();
  });

  it('constructor.elegir_disparador.solo_la_primera_opcion_lleva_data_foco_y_con_disparador_no_se_pinta', () => {
    const a = pintar();
    const conFoco = a.container.querySelectorAll('[data-foco="1"]');
    expect(conFoco).toHaveLength(1);
    expect(conFoco[0]).toBe(a.container.querySelector('button'));
    expect(conFoco[0]).toHaveTextContent(/^Tiempo/);
    a.unmount();

    // con un disparador puesto la tarjeta no existe
    const b = pintar(vistaElegirDisparador(estadoInicial(ejemplo())));
    expect(b.vista.visible).toBe(false);
    expect(b.container).toBeEmptyDOMElement();
  });

  it('la_primera_opcion_se_puede_enfocar_y_activar_con_el_teclado', async () => {
    const user = userEvent.setup();
    const { despachar, container } = pintar();
    const primera = container.querySelector<HTMLElement>('[data-foco="1"]');
    expect(primera).not.toBeNull();
    primera?.focus();
    expect(primera).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(despachar).toHaveBeenLastCalledWith({ k: 'elegirDisparador', tipo: 'tiempo' });
    await user.keyboard(' ');
    expect(despachar).toHaveBeenCalledTimes(2);
  });
});
