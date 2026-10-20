// Los paneles JUNTOS, con el reductor y los selectores de verdad (arnesPaneles.tsx): lo que ningún panel prueba solo. El foco que pide
// el reductor tiene a dónde ir con los atributos del contrato (`data-foco`, `data-enl`, `data-mas`, `#ajustes`…) y nunca cae a
// `<body>`, y escribir en un campo no le quita el foco. Cada test con ID (`constructor.paneles.…`) es un invariante registrado.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { montar } from './arnesPaneles';
import { TOPE_APPS } from './modelo/datos/constantes';
import { ejemplo } from './modelo/ejemplos';
import { estadoInicial } from './modelo/reductor';
import * as T from './modelo/textos';
import type { Flujo, Nodo } from './modelo/tipos';

const soloDisparador = (): Flujo => ({
  nodes: [{ id: 't1', kind: 'trigger', x: 8, y: 180, tipo: 'chat', frec: 'dia', ruta: 'mi-flujo', app: 'gmail' } as Nodo],
  edges: [],
  nombreFlujo: 'Solo el disparador',
});

const mas = (clave: string) => {
  const el = document.querySelector<HTMLElement>(`[data-mas="${clave}"]`);
  if (!el) throw new Error(`no hay «+» ${clave}`);
  return el;
};

describe('Paneles juntos', () => {
  it('constructor.paneles.el_menu_lleva_el_foco_a_su_primera_opcion_y_esc_lo_devuelve_al_mas_que_lo_abrio', async () => {
    const user = userEvent.setup();
    montar(estadoInicial(ejemplo()));
    await user.click(mas('der-a2'));
    expect(screen.getByRole('dialog', { name: 'Agregar después de «Revisor»' })).toBeInTheDocument();
    expect(document.querySelector('[data-foco="1"]')).toHaveFocus();
    expect(document.body).not.toHaveFocus();
    // Esc lo cierra y el foco vuelve al «+» que lo abrió
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mas('der-a2')).toHaveFocus();
  });

  it('constructor.paneles.la_patita_abre_directo_en_apps_y_esc_devuelve_el_foco_a_la_patita', async () => {
    const user = userEvent.setup();
    montar(estadoInicial(ejemplo()));
    await user.click(mas('tool-a2'));
    expect(screen.getByRole('dialog', { name: 'Darle una herramienta a «Revisor»' })).toBeInTheDocument();
    expect(document.querySelector('[data-foco="1"]')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(mas('tool-a2')).toHaveFocus();
  });

  it('constructor.paneles.agregar_una_app_desde_el_menu_crea_el_cuadro_y_el_foco_y_los_ajustes_van_a_el', async () => {
    const user = userEvent.setup();
    const a = montar(estadoInicial(ejemplo()));
    await user.click(mas('der-a2'));
    await user.click(screen.getByRole('button', { name: /^Una aplicación/ }));
    // el paso de las apps: el foco va a la primera pastilla
    expect(screen.getByRole('dialog', { name: 'Elige la aplicación' })).toBeInTheDocument();
    expect(document.querySelector('[data-foco="1"]')).toHaveFocus();
    expect(document.querySelector('[data-foco="1"]')).toHaveTextContent('Gmail');

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Notion' }));
    // el menú se cerró, el cuadro nuevo existe, está elegido, tiene el foco y su panel dice «App» con su nombre
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const nuevo = a.estado().flujo.nodes.at(-1);
    expect(nuevo).toMatchObject({ kind: 'app', nombre: 'Notion' });
    expect(a.estado().sel).toBe(nuevo?.id);
    expect(document.querySelector(`[data-nodo="${nuevo?.id}"]`)).toHaveFocus();
    expect(screen.getByRole('complementary', { name: 'Ajustes del cuadro' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Nombre de la app' })).toHaveValue('Notion');
  });

  it('constructor.paneles.otra_app_vacia_no_crea_nada_dice_el_motivo_y_el_menu_sigue_con_el_foco_donde_estaba', async () => {
    const user = userEvent.setup();
    const a = montar(estadoInicial(ejemplo()));
    await user.click(mas('tool-a2'));
    const antes = a.estado().flujo.nodes.length;
    await user.click(screen.getByRole('button', { name: 'Agregar' }));
    expect(a.estado().flujo.nodes).toHaveLength(antes);
    expect(a.estado().aviso?.texto).toBe(T.escribeNombreApp().texto);
    expect(screen.getByRole('dialog', { name: 'Darle una herramienta a «Revisor»' })).toBeInTheDocument();
    // el foco sigue dentro del menú (en el botón que se pulsó), no cayó a <body>
    expect(screen.getByRole('button', { name: 'Agregar' })).toHaveFocus();

    // escribir el nombre y Enter sí la crea
    await user.type(screen.getByRole('textbox', { name: '¿Otra app? Escribe su nombre' }), 'HubSpot{Enter}');
    expect(a.estado().flujo.nodes).toHaveLength(antes + 1);
    expect(a.estado().flujo.nodes.at(-1)).toMatchObject({ kind: 'app', nombre: 'HubSpot' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('constructor.paneles.escribir_en_un_campo_de_ajustes_no_le_quita_el_foco', async () => {
    const user = userEvent.setup();
    montar(estadoInicial(ejemplo()));
    await user.click(document.querySelector<HTMLElement>('[data-nodo="a2"]') as HTMLElement);
    const nombre = screen.getByRole('textbox', { name: 'Nombre del agente' });
    await user.clear(nombre);
    await user.type(nombre, 'Mi revisor');
    // el mismo campo (no se volvió a montar), con el texto completo y el foco puesto
    expect(screen.getByRole('textbox', { name: 'Nombre del agente' })).toBe(nombre);
    expect(nombre).toHaveValue('Mi revisor');
    expect(nombre).toHaveFocus();
    // y lo escrito se ve en el cuadro
    expect(document.querySelector('[data-nodo="a2"]')).toHaveTextContent('Mi revisor');
  });

  it('constructor.paneles.con_el_tope_de_apps_la_opcion_bloqueada_dice_el_aviso_y_el_foco_no_se_pierde', async () => {
    const user = userEvent.setup();
    const apps: Nodo[] = Array.from({ length: TOPE_APPS }, (_, i) => ({ id: `p${i + 1}`, kind: 'app', x: 616, y: 20 + i * 100, nombre: `App ${i + 1}` }));
    const flujo: Flujo = {
      nodes: [
        { id: 't1', kind: 'trigger', x: 8, y: 180, tipo: 'chat', frec: 'dia', ruta: 'mi-flujo', app: 'gmail' },
        { id: 'a1', kind: 'agent', x: 312, y: 180, nombre: 'Agente', ia: 'openai', tarea: '', instrucciones: 'Ayuda.' },
        ...apps,
      ],
      edges: [{ id: 'e1', de: 't1', a: 'a1', tipo: 'seq' }],
      nombreFlujo: 'Lleno',
    };
    const a = montar(estadoInicial(flujo));
    await user.click(mas('der-a1'));
    // la primera opción no bloqueada recibe el foco: «Un agente de IA»
    expect(document.querySelector('[data-foco="1"]')).toHaveFocus();
    expect(document.querySelector('[data-foco="1"]')).toHaveTextContent(/^Un agente de IA/);
    const bloqueada = screen.getByRole('button', { name: /^Una aplicación/ });
    await user.click(bloqueada);
    expect(a.estado().aviso?.texto).toBe(T.topeApps().texto);
    expect(a.estado().flujo.nodes).toHaveLength(2 + TOPE_APPS);
    // el menú sigue abierto en el paso de inicio
    expect(screen.getByRole('dialog', { name: 'Agregar después de «Agente»' })).toBeInTheDocument();
    expect(bloqueada).toHaveFocus();
  });

  it('constructor.paneles.al_vaciar_el_lienzo_la_tarjeta_del_disparador_recibe_el_foco', async () => {
    const user = userEvent.setup();
    const a = montar(estadoInicial(soloDisparador()));
    expect(screen.queryByRole('group', { name: 'Disparador del flujo' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Quitar «Disparador Chat»' }));
    expect(a.estado().flujo.nodes).toHaveLength(0);
    expect(screen.getByRole('group', { name: 'Disparador del flujo' })).toBeInTheDocument();
    expect(document.querySelector('[data-foco="1"]')).toHaveFocus();
    // elegir uno lo crea, lo elige y el foco sigue sin caer a <body>
    await user.click(screen.getByRole('button', { name: /^Web/ }));
    expect(a.estado().flujo.nodes).toHaveLength(1);
    expect(a.estado().flujo.nodes[0]).toMatchObject({ kind: 'trigger', tipo: 'web' });
    expect(document.body).not.toHaveFocus();
    expect(screen.queryByRole('group', { name: 'Disparador del flujo' })).not.toBeInTheDocument();
  });

  it('constructor.paneles.conectar_con_uno_que_ya_esta_pone_el_aviso_con_cancelar_y_el_foco_en_el_cuadro_ancla', async () => {
    const user = userEvent.setup();
    const a = montar(estadoInicial({ ...ejemplo(), edges: ejemplo().edges.filter(e => e.id !== 'e4') }));
    // «Slack» quedó suelta: el menú de lo que sigue ofrece conectarla
    await user.click(mas('der-a2'));
    await user.click(screen.getByRole('button', { name: /^Uno que ya está en el lienzo/ }));
    expect(a.estado().conectando).toMatchObject({ ancla: 'a2', rol: 'origen', tipo: 'seq' });
    expect(screen.getByText('Conectando.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('[data-nodo="a2"]')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(a.estado().conectando).toBeNull();
    expect(screen.queryByText('Conectando.')).not.toBeInTheDocument();
  });
});
