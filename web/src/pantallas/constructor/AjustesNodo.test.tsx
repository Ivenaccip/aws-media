// El panel de Ajustes de un cuadro como COMPORTAMIENTO, con el reductor de verdad detrás (el arnés de prueba arnesPaneles.tsx: estado,
// selectores y estos componentes): lo que se escribe edita el cuadro con `editarNodo`, los topes de largo son los del reductor, las
// tarjetas de IA y de disparador son `aria-pressed`, y el panel es `#ajustes` (tabIndex -1) con Esc que regresa al cuadro.
// Cada test con ID (`constructor.ajustes_nodo.…`) es un invariante registrado.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { montar } from './arnesPaneles';
import { ID_AJUSTES } from './PanelAjustes';
import {
  LARGO_DESC_AYUDANTE,
  LARGO_NOMBRE_AGENTE,
  LARGO_NOMBRE_APP,
  LARGO_RUTA,
  LARGO_TEXTO_AGENTE,
} from './modelo/datos/constantes';
import { ejemplo, muestras } from './modelo/ejemplos';
import { estadoInicial, reducir } from './modelo/reductor';
import type { AccionConstructor, EstadoConstructor, Flujo, Nodo } from './modelo/tipos';

const conSel = (flujo: Flujo, id: string, ...mas: AccionConstructor[]): EstadoConstructor => {
  let e = estadoInicial(flujo);
  for (const a of mas) e = reducir(e, a);
  return reducir(e, { k: 'abrirNodo', id });
};

const nodoDe = (e: EstadoConstructor, id: string): Nodo => {
  const n = e.flujo.nodes.find(x => x.id === id);
  if (!n) throw new Error(`no hay cuadro ${id}`);
  return n;
};

/** «Resumen diario»: disparador de tiempo → agente → dos apps (como paso). */
const flujoResumen = (): Flujo => {
  const m = muestras()[2];
  if (!m) throw new Error('sin muestra');
  return { nodes: m.nodes, edges: m.edges, nombreFlujo: m.nombre };
};

describe('AjustesNodo', () => {
  it('constructor.ajustes_nodo.el_panel_es_ajustes_con_tabindex_menos_uno_y_el_foco_del_reductor_llega_a_el', () => {
    const e = reducir(estadoInicial(ejemplo()), { k: 'abrirNodo', id: 'a1', teclado: true });
    // con Enter o Espacio el reductor pide el foco en «ajustes»…
    expect(e.foco?.objetivo).toEqual({ k: 'ajustes' });
    montar(e);
    // …y ese panel existe, se llama como pide la carta, no entra en el orden de Tab y recibe el foco que se pidió
    const panel = screen.getByRole('complementary', { name: 'Ajustes del cuadro' });
    expect(panel).toHaveAttribute('id', ID_AJUSTES);
    expect(panel).toHaveAttribute('tabindex', '-1');
    expect(document.getElementById('ajustes')).toBe(panel);
    expect(panel).toHaveFocus();
    expect(document.querySelectorAll('#ajustes')).toHaveLength(1);
  });

  it('constructor.ajustes_nodo.los_campos_de_texto_usan_los_mismos_topes_que_el_reductor', () => {
    // un agente conversador: nombre, descripción de ayudante, tarea e instrucciones a la vez
    const ayudante = conSel(ejemplo(), 'a2', { k: 'cambiarTipoEnlace', id: 'e2', tipo: 'tool' });
    const a = montar(ayudante);
    expect(a.estado().sel).toBe('a2');
    expect(screen.getByRole('textbox', { name: 'Nombre del agente' })).toHaveAttribute('maxlength', String(LARGO_NOMBRE_AGENTE));
    expect(screen.getByRole('textbox', { name: /^¿Para qué le sirve a «Atención a clientes»\?/ })).toHaveAttribute('maxlength', String(LARGO_DESC_AYUDANTE));
    expect(screen.getByRole('textbox', { name: 'Instrucciones del agente' })).toHaveAttribute('maxlength', String(LARGO_TEXTO_AGENTE));
  });

  it('constructor.ajustes_nodo.la_tarea_de_un_agente_que_recibe_lo_de_otro_respeta_el_mismo_tope', () => {
    // «Revisor» recibe lo del agente de antes (no un chat directo): pide su instrucción, con el mismo tope
    const revisor = montar(conSel(ejemplo(), 'a2'));
    expect(screen.getByRole('textbox', { name: /^Instrucción para este paso/ })).toHaveAttribute('maxlength', String(LARGO_TEXTO_AGENTE));
    expect(revisor.estado().sel).toBe('a2');
  });

  it('constructor.ajustes_nodo.el_nombre_de_una_app_respeta_el_tope_y_la_nota_dice_si_hay_conector', async () => {
    const user = userEvent.setup();
    const a = montar(conSel(ejemplo(), 'p1'));
    const campo = screen.getByRole('textbox', { name: 'Nombre de la app' });
    expect(campo).toHaveAttribute('maxlength', String(LARGO_NOMBRE_APP));
    expect(campo).toHaveAccessibleDescription('n8n ya sabe conectarse a esta app.');
    await user.clear(campo);
    await user.type(campo, 'HubSpot');
    expect(nodoDe(a.estado(), 'p1')).toMatchObject({ nombre: 'HubSpot' });
    expect(campo).toHaveAccessibleDescription(/no trae un conector listo/);
  });

  it('constructor.ajustes_nodo.escribir_en_un_campo_edita_el_cuadro_con_editarnodo', async () => {
    const user = userEvent.setup();
    const a = montar(conSel(ejemplo(), 'a1'));
    const nombre = screen.getByRole('textbox', { name: 'Nombre del agente' });
    await user.clear(nombre);
    await user.type(nombre, 'Soporte');
    // cada tecla mandó un editarNodo del cuadro elegido; el último trae el texto completo
    const ediciones = a.acciones.filter(x => x.k === 'editarNodo');
    expect(ediciones.length).toBeGreaterThan(1);
    expect(ediciones.every(x => x.k === 'editarNodo' && x.id === 'a1')).toBe(true);
    expect(ediciones.at(-1)).toEqual({ k: 'editarNodo', id: 'a1', parche: { nombre: 'Soporte' } });
    expect(nodoDe(a.estado(), 'a1')).toMatchObject({ nombre: 'Soporte' });
    expect(nombre).toHaveValue('Soporte');

    const instr = screen.getByRole('textbox', { name: 'Instrucciones del agente' });
    await user.clear(instr);
    await user.type(instr, 'Sé breve');
    expect(nodoDe(a.estado(), 'a1')).toMatchObject({ instrucciones: 'Sé breve' });
  });

  it('constructor.ajustes_nodo.las_cuatro_ia_son_tarjetas_con_aria_pressed_y_cambian_la_ia', async () => {
    const user = userEvent.setup();
    const a = montar(conSel(ejemplo(), 'a1'));
    const grupo = screen.getByRole('group', { name: 'IA del agente' });
    const tarjetas = within(grupo).getAllByRole('button');
    expect(tarjetas).toHaveLength(4);
    const abierta = within(grupo).getByRole('button', { name: /^OpenAI/ });
    expect(abierta).toHaveAttribute('aria-pressed', 'true');
    expect(within(grupo).getByRole('button', { name: /^Gemini/ })).toHaveAttribute('aria-pressed', 'false');

    await user.click(within(grupo).getByRole('button', { name: /^Gemini/ }));
    expect(a.acciones.at(-1)).toEqual({ k: 'editarNodo', id: 'a1', parche: { ia: 'gemini' } });
    expect(nodoDe(a.estado(), 'a1')).toMatchObject({ ia: 'gemini' });
    expect(within(grupo).getByRole('button', { name: /^Gemini/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(grupo).getByRole('button', { name: /^OpenAI/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('constructor.ajustes_nodo.tarea_solo_si_no_llega_un_chat_ni_es_ayudante_y_el_ayudante_pide_para_que_sirve', () => {
    // «Atención a clientes» recibe el chat directo: sin tarea
    const a = montar(conSel(ejemplo(), 'a1'));
    expect(screen.queryByRole('textbox', { name: /Instrucción para este paso|¿Qué debe hacer/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Conversa con otra IA')).not.toBeInTheDocument();
    expect(a.estado().sel).toBe('a1');
  });

  it('constructor.ajustes_nodo.un_ayudante_dice_que_conversa_pide_para_que_sirve_y_no_pide_tarea', async () => {
    const user = userEvent.setup();
    const a = montar(conSel(ejemplo(), 'a2', { k: 'cambiarTipoEnlace', id: 'e2', tipo: 'tool' }));
    expect(screen.getByText('Conversa con otra IA')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Instrucción para este paso|¿Qué debe hacer/ })).not.toBeInTheDocument();
    const desc = screen.getByRole('textbox', { name: /^¿Para qué le sirve a «Atención a clientes»\?/ });
    await user.clear(desc);
    await user.type(desc, 'Revisa el tono');
    expect(nodoDe(a.estado(), 'a2')).toMatchObject({ desc: 'Revisa el tono' });
  });

  it('constructor.ajustes_nodo.tras_un_disparador_que_no_es_chat_la_tarea_se_pregunta_con_su_propia_etiqueta', async () => {
    const user = userEvent.setup();
    const a = montar(conSel(flujoResumen(), 'a1'));
    const tarea = screen.getByRole('textbox', { name: '¿Qué debe hacer cada vez que se dispare?' });
    await user.clear(tarea);
    await user.type(tarea, 'Resume');
    expect(nodoDe(a.estado(), 'a1')).toMatchObject({ tarea: 'Resume' });
  });

  it('constructor.ajustes_nodo.el_disparador_cambia_de_tipo_y_cada_tipo_pide_lo_suyo', async () => {
    const user = userEvent.setup();
    const a = montar(conSel(flujoResumen(), 't1'));
    // de tiempo: pide la frecuencia (selector nativo) y nada más
    const tipos = screen.getByRole('group', { name: 'Tipo de disparador' });
    expect(within(tipos).getAllByRole('button')).toHaveLength(4);
    expect(within(tipos).getByRole('button', { name: /^Tiempo/ })).toHaveAttribute('aria-pressed', 'true');
    const frec = screen.getByRole('combobox', { name: '¿Cada cuánto?' });
    expect(frec).toHaveValue('dia');
    await user.selectOptions(frec, 'lunes');
    expect(a.acciones.at(-1)).toEqual({ k: 'editarNodo', id: 't1', parche: { frec: 'lunes' } });
    expect(nodoDe(a.estado(), 't1')).toMatchObject({ frec: 'lunes' });

    // aviso web: la ruta, con el enlace que va a quedar a la vista
    await user.click(within(tipos).getByRole('button', { name: /^Web/ }));
    expect(a.acciones.at(-1)).toEqual({ k: 'editarNodo', id: 't1', parche: { tipo: 'web' } });
    expect(screen.queryByRole('combobox', { name: '¿Cada cuánto?' })).not.toBeInTheDocument();
    const ruta = screen.getByRole('textbox', { name: /^Ruta del enlace/ });
    // el mismo tope del reductor: si fuera otro, el borrador recortaría en silencio
    expect(ruta).toHaveAttribute('maxlength', String(LARGO_RUTA));
    expect(ruta).toHaveAccessibleDescription('Tu enlace quedará así: https://tu-n8n.com/webhook/mi-flujo');
    await user.clear(ruta);
    await user.type(ruta, 'Mis Ventas');
    expect(nodoDe(a.estado(), 't1')).toMatchObject({ ruta: 'Mis Ventas' });
    expect(ruta).toHaveAccessibleDescription('Tu enlace quedará así: https://tu-n8n.com/webhook/mis-ventas');

    // de una app: pide cuál (Gmail o Telegram)
    await user.click(within(tipos).getByRole('button', { name: /^App/ }));
    const app = screen.getByRole('combobox', { name: '¿En qué app tiene que pasar algo?' });
    expect(within(app).getAllByRole('option')).toHaveLength(2);
    await user.selectOptions(app, 'telegram');
    expect(a.acciones.at(-1)).toEqual({ k: 'editarNodo', id: 't1', parche: { app: 'telegram' } });
    expect(nodoDe(a.estado(), 't1')).toMatchObject({ app: 'telegram', tipo: 'app' });

    // un chat no pide nada más; y volver a «a una hora» recuerda la frecuencia de antes
    await user.click(within(tipos).getByRole('button', { name: /^Chat/ }));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    await user.click(within(tipos).getByRole('button', { name: /^Tiempo/ }));
    expect(screen.getByRole('combobox', { name: '¿Cada cuánto?' })).toHaveValue('lunes');
  });

  it('constructor.ajustes_nodo.las_apps_con_conector_son_pastillas_que_ponen_el_nombre', async () => {
    const user = userEvent.setup();
    const a = montar(conSel(ejemplo(), 'p2'));
    const grupo = screen.getByRole('group', { name: 'Apps con conector listo' });
    expect(within(grupo).getAllByRole('button')).toHaveLength(10);
    expect(within(grupo).getByRole('button', { name: 'Slack' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(grupo).getByRole('button', { name: 'Gmail' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(within(grupo).getByRole('button', { name: 'Gmail' }));
    expect(a.acciones.at(-1)).toEqual({ k: 'editarNodo', id: 'p2', parche: { nombre: 'Gmail' } });
    expect(screen.getByRole('textbox', { name: 'Nombre de la app' })).toHaveValue('Gmail');
    expect(within(grupo).getByRole('button', { name: 'Gmail' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('constructor.ajustes_nodo.quitar_este_cuadro_agregar_lo_que_sigue_y_darle_una_herramienta_mandan_su_accion', async () => {
    const user = userEvent.setup();
    const a = montar(conSel(ejemplo(), 'a2'));
    // el agente puede recibir lo que sigue y una herramienta
    await user.click(screen.getByRole('button', { name: 'Agregar lo que sigue' }));
    expect(a.acciones.at(-1)).toEqual({ k: 'abrirMenu', ancla: 'a2', tipo: 'seq' });
    await user.click(screen.getByRole('button', { name: 'Darle una herramienta' }));
    expect(a.acciones.at(-1)).toEqual({ k: 'abrirMenu', ancla: 'a2', tipo: 'tool' });
    await user.click(screen.getByRole('button', { name: 'Quitar este cuadro' }));
    expect(a.acciones.at(-1)).toEqual({ k: 'quitarNodo', id: 'a2' });
    // lo quitó el reductor de verdad: ya no hay cuadro elegido y el panel vuelve a la pista
    expect(a.estado().flujo.nodes.some(n => n.id === 'a2')).toBe(false);
    expect(screen.getByRole('complementary', { name: 'Ajustes' })).toHaveTextContent(/Toca un cuadro/);
  });

  it('constructor.ajustes_nodo.una_app_no_ofrece_herramienta_y_el_disparador_ofrece_el_primer_paso', () => {
    // una app que es herramienta: ni «lo que sigue» ni «una herramienta»
    const a = montar(conSel(ejemplo(), 'p1'));
    expect(screen.queryByRole('button', { name: 'Agregar lo que sigue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Darle una herramienta' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitar este cuadro' })).toBeInTheDocument();
    expect(a.estado().sel).toBe('p1');
  });

  it('el_disparador_ofrece_agregar_el_primer_paso_y_no_darle_una_herramienta', () => {
    montar(conSel(ejemplo(), 't1'));
    expect(screen.getByRole('button', { name: 'Agregar el primer paso' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Darle una herramienta' })).not.toBeInTheDocument();
  });

  it('constructor.ajustes_nodo.esc_regresa_al_cuadro_salvo_dentro_de_un_selector', async () => {
    const user = userEvent.setup();
    const a = montar(conSel(flujoResumen(), 't1'));
    // Esc con el foco en un botón del panel: el foco regresa al cuadro elegido
    const unTipo = screen.getByRole('button', { name: /^Tiempo/ });
    unTipo.focus();
    await user.keyboard('{Escape}');
    expect(a.acciones.at(-1)).toEqual({ k: 'volverDeAjustes' });
    expect(document.querySelector('[data-nodo="t1"]')).toHaveFocus();

    // Esc con el foco en el selector nativo NO regresa: cierra su lista y nada más
    const antes = a.acciones.length;
    const frec = screen.getByRole('combobox', { name: '¿Cada cuánto?' });
    frec.focus();
    await user.keyboard('{Escape}');
    expect(a.acciones).toHaveLength(antes);
  });

  it('constructor.ajustes_nodo.sin_cuadro_elegido_el_panel_sigue_siendo_ajustes_y_dice_que_tocar', () => {
    const a = montar(estadoInicial(ejemplo()));
    const panel = screen.getByRole('complementary', { name: 'Ajustes' });
    expect(panel).toHaveAttribute('id', 'ajustes');
    expect(panel).toHaveAttribute('tabindex', '-1');
    expect(within(panel).getByRole('heading', { name: 'Ajustes' })).toBeInTheDocument();
    expect(panel).toHaveTextContent('Toca un cuadro para ver y cambiar sus ajustes');
    expect(a.estado().sel).toBeNull();
  });
});
