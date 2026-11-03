// El editor de una flecha como COMPORTAMIENTO, con el reductor de verdad detrás (arnesPaneles.tsx): las dos maneras de conectar son
// `aria-pressed`, la que no se puede elegir se apaga con `aria-disabled` (no `disabled`), dice por qué y su clic llega al reductor,
// «Poner un cuadro en medio» abre el menú y devuelve el foco a su botón, y el foco del reductor tiene a dónde ir (`data-enl="1"`).
// Cada test con ID (`constructor.ajustes_enlace.…`) es un invariante registrado.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { montar } from './arnesPaneles';
import { ejemplo } from './modelo/ejemplos';
import { estadoInicial, reducir } from './modelo/reductor';
import type { EstadoConstructor } from './modelo/tipos';

const abierta = (id: string): EstadoConstructor => reducir(estadoInicial(ejemplo()), { k: 'abrirEnlace', id });
const panel = () => screen.getByRole('complementary', { name: 'Ajustes de la conexión' });
const conexion = (e: EstadoConstructor, id: string) => e.flujo.edges.find(x => x.id === id);

describe('AjustesEnlace', () => {
  it('constructor.ajustes_enlace.dice_de_cual_a_cual_y_el_foco_cae_en_un_solo_sentido', () => {
    const a = montar(abierta('e2'));
    const p = panel();
    expect(p).toHaveAttribute('id', 'ajustes');
    expect(p).toHaveAttribute('tabindex', '-1');
    expect(within(p).getByRole('heading', { name: 'Conexión' })).toBeInTheDocument();
    expect(p).toHaveTextContent('De «Atención a clientes» a «Revisor»');
    // el reductor pidió el foco en «Un solo sentido» (`data-enl="1"`) y ahí está
    const uno = within(p).getByRole('button', { name: /^Un solo sentido/ });
    expect(uno).toHaveAttribute('data-enl', '1');
    expect(uno).toHaveFocus();
    expect(a.estado().selEdge).toBe('e2');
  });

  it('constructor.ajustes_enlace.las_dos_maneras_son_aria_pressed_y_cambian_el_tipo_con_su_accion', async () => {
    const user = userEvent.setup();
    const a = montar(abierta('e2'));
    const grupo = screen.getByRole('group', { name: 'Cómo se conectan' });
    const uno = within(grupo).getByRole('button', { name: /^Un solo sentido/ });
    const doble = within(grupo).getByRole('button', { name: /^Ida y vuelta/ });
    expect(uno).toHaveAttribute('aria-pressed', 'true');
    expect(doble).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Poner un cuadro en medio' })).toBeInTheDocument();

    await user.click(doble);
    expect(a.acciones.at(-1)).toEqual({ k: 'cambiarTipoEnlace', id: 'e2', tipo: 'tool' });
    expect(conexion(a.estado(), 'e2')?.tipo).toBe('tool');
    expect(within(grupo).getByRole('button', { name: /^Ida y vuelta/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(grupo).getByRole('button', { name: /^Un solo sentido/ })).toHaveAttribute('aria-pressed', 'false');
    // «en medio» solo existe en un solo sentido
    expect(screen.queryByRole('button', { name: 'Poner un cuadro en medio' })).not.toBeInTheDocument();

    // y se puede volver, con la misma acción hacia el otro lado
    await user.click(within(grupo).getByRole('button', { name: /^Un solo sentido/ }));
    expect(a.acciones.at(-1)).toEqual({ k: 'cambiarTipoEnlace', id: 'e2', tipo: 'seq' });
    expect(conexion(a.estado(), 'e2')?.tipo).toBe('seq');
  });

  it('constructor.ajustes_enlace.la_opcion_que_no_se_puede_elegir_usa_aria_disabled_dice_no_se_puede_y_su_clic_llega_al_reductor', async () => {
    const user = userEvent.setup();
    // disparador → agente: el disparador no puede ser el agente que consulta, así que «ida y vuelta» no es elegible
    const a = montar(abierta('e1'));
    const doble = screen.getByRole('button', { name: /^Ida y vuelta/ });
    expect(doble).toHaveAttribute('aria-disabled', 'true');
    expect(doble).not.toBeDisabled();
    expect(doble).toHaveTextContent(/No se puede: /);
    // sigue enfocable (para leer el motivo) y la que sí vale no se apaga
    doble.focus();
    expect(doble).toHaveFocus();
    expect(screen.getByRole('button', { name: /^Un solo sentido/ })).not.toHaveAttribute('aria-disabled');

    await user.click(doble);
    // el clic llegó al reductor, que NO cambió nada y lo dijo en el aviso
    expect(a.acciones.at(-1)).toEqual({ k: 'cambiarTipoEnlace', id: 'e1', tipo: 'tool' });
    expect(conexion(a.estado(), 'e1')?.tipo).toBe('seq');
    expect(a.estado().aviso?.texto).toMatch(/^No se puede cambiar: /);
    expect(a.estado().aviso?.tipo).toBe('mal');
  });

  it('constructor.ajustes_enlace.poner_un_cuadro_en_medio_abre_el_menu_en_medio_con_el_foco_en_su_primera_opcion', async () => {
    const user = userEvent.setup();
    const a = montar(abierta('e2'));
    const medio = screen.getByRole('button', { name: 'Poner un cuadro en medio' });
    // contrato de foco: el reductor pide devolver el foco a `data-mas="medio"` al cerrar ese menú
    expect(medio).toHaveAttribute('data-mas', 'medio');
    expect(medio).toHaveAttribute('aria-haspopup', 'dialog');

    await user.click(medio);
    expect(a.acciones.at(-1)).toEqual({ k: 'abrirMenu', ancla: 'a1', tipo: 'seq', insertarEn: 'e2' });
    expect(a.estado().menu).toMatchObject({ ancla: 'a1', tipo: 'seq', insertarEn: 'e2' });
    expect(screen.getByRole('dialog', { name: 'Poner en medio' })).toBeInTheDocument();
    // el foco pasó a la primera opción del menú (no se quedó en un botón que ya no está)
    expect(document.querySelector('[data-foco="1"]')).toHaveFocus();
    // Esc lo cierra
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(a.estado().menu).toBeNull();
  });

  it('constructor.ajustes_enlace.quitar_esta_conexion_manda_quitarenlace_y_el_foco_va_al_cuadro_de_donde_salia', async () => {
    const user = userEvent.setup();
    const a = montar(abierta('e2'));
    await user.click(screen.getByRole('button', { name: 'Quitar esta conexión' }));
    expect(a.acciones.at(-1)).toEqual({ k: 'quitarEnlace', id: 'e2' });
    expect(conexion(a.estado(), 'e2')).toBeUndefined();
    // el foco no cae a <body>: va al cuadro de donde salía la conexión
    expect(document.querySelector('[data-nodo="a1"]')).toHaveFocus();
    // y el panel volvió a la pista
    expect(screen.getByRole('complementary', { name: 'Ajustes' })).toBeInTheDocument();
  });

  it('constructor.ajustes_enlace.esc_regresa_a_la_flecha_que_se_editaba', async () => {
    const user = userEvent.setup();
    montar(abierta('e3'));
    // una herramienta (ida y vuelta) no ofrece «en medio»
    expect(screen.queryByRole('button', { name: 'Poner un cuadro en medio' })).not.toBeInTheDocument();
    screen.getByRole('button', { name: 'Quitar esta conexión' }).focus();
    await user.keyboard('{Escape}');
    expect(document.querySelector('[data-insignia="e3"]')).toHaveFocus();
  });

  it('el_editor_de_la_flecha_explica_cada_manera_con_palabras_y_dibujo_decorativo', () => {
    montar(abierta('e2'));
    const uno = screen.getByRole('button', { name: /^Un solo sentido/ });
    expect(uno).toHaveTextContent('«Atención a clientes» termina y le pasa su respuesta a «Revisor», que corre después. No regresa nada. Es como pasar un recado.');
    // el dibujo de A → B no se lee: lo dice el texto
    expect(uno.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: /^Ida y vuelta/ })).toHaveTextContent(/conversan/);
  });
});
