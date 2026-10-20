// La lista de «Conexiones» del panel de un cuadro como COMPORTAMIENTO: cada fila dice qué conexión es, «Editar» y «Quitar» mandan
// la acción de ESA fila con un nombre que dice de cuál, y los botones de seguir armando salen según el cuadro. Con el reductor de
// verdad detrás (arnesPaneles.tsx). Cada test con ID (`constructor.conexiones.…`) es un invariante registrado.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { montar } from './arnesPaneles';
import { Conexiones } from './Conexiones';
import { ejemplo } from './modelo/ejemplos';
import { estadoInicial, reducir } from './modelo/reductor';
import { vistaAjustes } from './modelo/selectores';
import type { AccionConstructor } from './modelo/tipos';

const abierto = (id: string) => reducir(estadoInicial(ejemplo()), { k: 'abrirNodo', id });

describe('Conexiones', () => {
  it('constructor.conexiones.cada_fila_dice_su_conexion_y_sus_botones_dicen_de_cual', () => {
    montar(abierto('a1'));
    const lista = within(screen.getByRole('complementary', { name: 'Ajustes del cuadro' })).getByRole('list');
    const filas = within(lista).getAllByRole('listitem');
    expect(filas.map(f => f.querySelector('span')?.textContent)).toEqual([
      'Viene de «Disparador Chat»',
      'Después va «Revisor»',
      'Herramienta: «Google Sheets»',
    ]);
    // «Editar» a secas no diría de cuál: el nombre accesible lleva el texto de la fila
    expect(screen.getByRole('button', { name: 'Editar la conexión: Después va «Revisor»' })).toHaveTextContent('Editar');
    expect(screen.getByRole('button', { name: 'Quitar la conexión: Después va «Revisor»' })).toHaveTextContent('Quitar');
    expect(screen.getByRole('heading', { name: 'Conexiones' })).toBeInTheDocument();
  });

  it('constructor.conexiones.editar_abre_el_editor_de_esa_flecha_y_quitar_la_quita_sin_confirmar', async () => {
    const user = userEvent.setup();
    const a = montar(abierto('a1'));
    await user.click(screen.getByRole('button', { name: 'Editar la conexión: Después va «Revisor»' }));
    expect(a.acciones.at(-1)).toEqual({ k: 'abrirEnlace', id: 'e2' });
    // se abrió el editor de la flecha, con el foco en «Un solo sentido»
    expect(screen.getByRole('complementary', { name: 'Ajustes de la conexión' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Un solo sentido/ })).toHaveFocus();

    // volver al cuadro y quitar una conexión de su lista
    await user.click(screen.getByRole('button', { name: /^Agente de IA: Atención a clientes\. / }));
    expect(screen.getByRole('complementary', { name: 'Ajustes del cuadro' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Quitar la conexión: Herramienta: «Google Sheets»' }));
    expect(a.acciones.at(-1)).toEqual({ k: 'quitarEnlace', id: 'e3' });
    expect(a.estado().flujo.edges.some(e => e.id === 'e3')).toBe(false);
    // quitarla se puede deshacer: el reductor guardó la foto
    expect(a.estado().historial.length).toBeGreaterThan(0);
  });

  it('constructor.conexiones.el_rol_con_un_nombre_largo_sin_espacios_se_parte_en_vez_de_salirse_de_su_caja', () => {
    const largo = 'Ñ'.repeat(60);
    const f = ejemplo();
    f.nodes = f.nodes.map(n => (n.id === 'p1' && n.kind === 'app' ? { ...n, nombre: largo } : n));
    const e = reducir(estadoInicial(f), { k: 'abrirNodo', id: 'p1' });
    const vista = vistaAjustes(e);
    if (!vista) throw new Error('sin vista');
    render(<Conexiones vista={vista} despachar={vi.fn()} />);
    // «Es una HERRAMIENTA del agente «ÑÑÑ…»» ensanchaba la página a 1100, 390 y 320 px
    expect(screen.getByText(vista.rolTexto).className).toContain('[overflow-wrap:anywhere]');
  });

  it('constructor.conexiones.un_cuadro_sin_conexiones_no_pinta_lista_y_sigue_ofreciendo_como_seguir', () => {
    // un agente suelto: sin conexiones, pero con «Agregar lo que sigue» y «Darle una herramienta»
    const vista = vistaAjustes(abierto('a1'));
    if (!vista) throw new Error('sin vista');
    const despachar = vi.fn<(a: AccionConstructor) => void>();
    render(<Conexiones vista={{ ...vista, conexiones: [] }} despachar={despachar} />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByText(vista.rolTexto)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar lo que sigue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Darle una herramienta' })).toBeInTheDocument();
  });

  it('constructor.conexiones.agregar_lo_que_sigue_y_darle_una_herramienta_abren_su_menu_con_el_foco_en_la_primera_opcion', async () => {
    const user = userEvent.setup();
    const a = montar(abierto('a2'));
    await user.click(screen.getByRole('button', { name: 'Agregar lo que sigue' }));
    expect(a.acciones.at(-1)).toEqual({ k: 'abrirMenu', ancla: 'a2', tipo: 'seq' });
    expect(screen.getByRole('dialog', { name: 'Agregar después de «Revisor»' })).toBeInTheDocument();
    expect(document.querySelector('[data-foco="1"]')).toHaveFocus();

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Darle una herramienta' }));
    expect(a.acciones.at(-1)).toEqual({ k: 'abrirMenu', ancla: 'a2', tipo: 'tool' });
    expect(screen.getByRole('dialog', { name: 'Darle una herramienta a «Revisor»' })).toBeInTheDocument();
    // la patita abre directo en las apps y el foco cae en la primera
    expect(document.querySelector('[data-foco="1"]')).toHaveFocus();
    expect(document.querySelector('[data-foco="1"]')).toHaveTextContent('Gmail');
  });
});
