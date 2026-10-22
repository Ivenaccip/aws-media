// El Constructor como COMPORTAMIENTO, de punta a punta: el reductor, los selectores y todos los componentes de verdad, montados juntos,
// sin red (la pantalla no llama a ningún servicio) y con lo único externo en doble: `descargarArchivo` (jsdom no baja archivos) y
// `window.avisos` (el cuadro de abajo a la derecha de static/trabajos.js). Cada test con ID (`constructor.<tema>.<frase>`) es un
// invariante registrado en tests/test_migracion_ui.py.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { descargarArchivo } from '../../nucleo/descargarArchivo';
import { ponerAvisos } from '../../prueba/servidor';
import { Constructor } from './Constructor';
import { CLAVE_BORRADOR, crearBorrador } from './modelo/borrador';
import { ejemplo, muestras } from './modelo/ejemplos';
import { construirFlujo } from './modelo/exportar';
import type { Flujo, Nodo } from './modelo/tipos';
import { ESPERA_GUARDADO_MS, TEXTO_DEL_ASISTENTE, TEXTO_PRIVACIDAD, TEXTO_RECUPERADO } from './useBorrador';

vi.mock('../../nucleo/descargarArchivo', async importOriginal => ({
  ...(await importOriginal<typeof import('../../nucleo/descargarArchivo')>()),
  descargarArchivo: vi.fn(() => true),
}));

// ---------------------------------------------------------------- ayudas

const buscar = (atributo: string, valor: string): HTMLElement => {
  const el = Array.from(document.querySelectorAll<HTMLElement>(`[${atributo}]`)).find(e => e.getAttribute(atributo) === valor);
  if (!el) throw new Error(`no hay ningún [${atributo}="${valor}"]`);
  return el;
};
const nodo = (id: string) => buscar('data-nodo', id);
const mas = (clave: string) => buscar('data-mas', clave);
const insignia = (id: string) => buscar('data-insignia', id);
const hayNodo = (id: string) => document.querySelector(`[data-nodo="${id}"]`) !== null;
const idsDeNodos = () => Array.from(document.querySelectorAll('[data-nodo]')).map(e => e.getAttribute('data-nodo'));
const boton = (nombre: string | RegExp) => screen.getByRole('button', { name: nombre });
const ajustes = () => document.getElementById('ajustes') as HTMLElement;
const guardado = () => JSON.parse(localStorage.getItem(CLAVE_BORRADOR) ?? 'null') as { v: number; nodes: Nodo[]; edges: unknown[]; nombreFlujo: string; origen?: string } | null;
const posicion = (id: string) => {
  const caja = nodo(id).parentElement as HTMLElement;
  return { x: parseInt(caja.style.left, 10), y: parseInt(caja.style.top, 10) };
};

/** Lo que dijo la esquina (window.avisos.mostrar): texto y opciones, en orden. */
const dichos = (a: ReturnType<typeof ponerAvisos>) => a.mostrar.mock.calls.map(([texto, op]) => ({ texto, ...op }));

function abrir() {
  const avisos = ponerAvisos();
  const user = userEvent.setup();
  const r = render(<Constructor />);
  return { avisos, user, ...r };
}

/** La pantalla con el flujo de ejemplo ya cargado (con el botón del lienzo vacío). */
async function conEjemplo() {
  const a = abrir();
  await a.user.click(boton('Cargar el ejemplo'));
  return a;
}

const FLUJO_DE_EJEMPLO: Flujo = ejemplo();

beforeEach(() => {
  vi.mocked(descargarArchivo).mockReset();
  vi.mocked(descargarArchivo).mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ================================================================ la pantalla

describe('Constructor: la pantalla', () => {
  it('constructor.pantalla.irremplazables_en_dorado_migas_hasta_el_constructor_y_un_solo_h1', () => {
    abrir();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const h1 = screen.getByRole('heading', { level: 1, name: 'Irremplazables' });
    expect(h1.querySelector('.texto-oro')).toHaveTextContent('Irremplazables');
    const migas = screen.getByRole('navigation', { name: 'Dónde estás' });
    expect(within(migas).getByRole('link', { name: 'Ir al mapa para cambiar de área (ahora: Automatizaciones)' })).toHaveAttribute(
      'href',
      '/estudio/inicio/?desde=automatizaciones.distrito.constructor&ver=mapa',
    );
    expect(within(migas).getByRole('link', { name: 'Ir a las opciones de Automatizaciones (ahora: Distrito)' })).toHaveAttribute(
      'href',
      '/estudio/inicio/?desde=automatizaciones.distrito.constructor&ver=grupos',
    );
    // la última miga es donde estás: un chip quieto
    const actual = migas.querySelector('[aria-current="step"]');
    expect(actual).toHaveTextContent('Constructor');
    expect(actual?.closest('a')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Arma tu automatización' })).toBeInTheDocument();
  });

  it('constructor.pantalla.arranca_vacia_con_la_tarjeta_del_disparador_y_sin_nada_que_descargar_ni_limpiar', () => {
    abrir();
    expect(screen.getByText('Paso 1: elige cómo arranca tu flujo.')).toBeInTheDocument();
    const grupo = screen.getByRole('group', { name: 'Disparador del flujo' });
    expect(within(grupo).getAllByRole('button')).toHaveLength(4);
    expect(idsDeNodos()).toEqual([]);
    expect(boton('Descargar .json')).toHaveAttribute('aria-disabled', 'true');
    expect(boton('Limpiar')).toHaveAttribute('aria-disabled', 'true');
    expect(boton('Deshacer')).toHaveAttribute('aria-disabled', 'true');
    // sin nada elegido, Ajustes dice qué tocar
    expect(ajustes()).toHaveTextContent('Empieza eligiendo el disparador en el lienzo.');
    // con la tarjeta del disparador adentro el marco ya tiene controles que enfocar: no necesita tabindex propio
    expect(screen.getByRole('group', { name: 'Lienzo del flujo' })).not.toHaveAttribute('tabindex');
  });

  it('constructor.pantalla.un_solo_boton_ambar_y_es_descargar_json', async () => {
    const { container } = await conEjemplo();
    const ambar = () => [...container.querySelectorAll('button')].filter(b => b.className.split(/\s+/).includes('bg-ambar')).map(b => b.textContent?.trim());
    // con el flujo listo, «Descargar .json» es el único; con el lienzo vacío está apagado y no hay ninguno
    expect(ambar()).toEqual(['Descargar .json']);
  });

  it('constructor.pantalla.el_orden_del_dom_es_guia_barra_lienzo_leyenda_y_al_final_ajustes', async () => {
    await conEjemplo();
    const marco = screen.getByRole('group', { name: 'Lienzo del flujo' });
    const precede = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const guia = screen.getByText(/^Toca el círculo de una flecha|^Para que un agente consulte/);
    const descargar = boton('Descargar .json');
    expect(precede(guia, descargar)).toBe(true);
    expect(precede(descargar, marco)).toBe(true);
    expect(precede(marco, screen.getByText(/^Un solo sentido, como pasar un recado/))).toBe(true);
    expect(precede(screen.getByText(/^Un solo sentido, como pasar un recado/), ajustes())).toBe(true);
    // el orden de Tab de los cuadros es el de su flujo en el DOM, no el del arrastre
    expect(idsDeNodos()).toEqual(['t1', 'a1', 'a2', 'p1', 'p2']);
  });

  it('constructor.pantalla.dice_que_el_borrador_se_guarda_solo_en_este_navegador_y_como_abrir_el_archivo_en_n8n', () => {
    abrir();
    expect(screen.getByText(TEXTO_PRIVACIDAD)).toBeInTheDocument();
    expect(screen.getByText(/menú «⋯» de arriba a la derecha, elige «Import from File»/)).toBeInTheDocument();
  });

  it('constructor.pantalla.no_llama_a_ningun_servicio_ni_cobra_en_todo_lo_que_hace', async () => {
    const f = vi.fn(() => Promise.reject(new Error('el Constructor no debe llamar a la red')));
    vi.stubGlobal('fetch', f);
    const { user } = await conEjemplo();
    await user.click(mas('der-a2'));
    await user.click(boton(/^Un agente de IA/));
    await user.click(boton('Ver el JSON'));
    await user.click(boton('Descargar .json'));
    await user.click(boton('Deshacer'));
    await user.click(boton('Limpiar'));
    await user.click(await screen.findByRole('button', { name: 'Limpiar todo' }));
    expect(f).not.toHaveBeenCalled();
    expect(document.querySelector('a[href^="http"]')).toBeNull();
  });
});

// ================================================================ armar el flujo

describe('Constructor: armar el flujo', () => {
  it('constructor.flujo.elegir_el_disparador_lo_crea_lo_elige_y_pasa_el_foco_al_cuadro', async () => {
    const { user, avisos } = abrir();
    await user.click(boton(/^Chat/));
    expect(idsDeNodos()).toHaveLength(1);
    const id = idsDeNodos()[0] as string;
    expect(nodo(id)).toHaveAccessibleName('Disparador: Chat. Mensaje en el chat');
    expect(nodo(id)).toHaveAttribute('aria-pressed', 'true');
    expect(nodo(id)).toHaveFocus();
    expect(screen.queryByRole('group', { name: 'Disparador del flujo' })).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Ajustes del cuadro' })).toBeInTheDocument();
    expect(screen.getByText('Paso 2: toca el + junto al disparador y elige qué sigue: una app o un agente de IA.')).toBeInTheDocument();
    expect(dichos(avisos).at(-1)).toMatchObject({ texto: 'Listo: el flujo arranca con «Disparador Chat». Ahora toca el + para agregar lo que sigue.', tipo: 'ok' });
  });

  it('constructor.flujo.agregar_un_agente_con_el_mas_lo_pone_a_la_derecha_lo_conecta_y_lo_enfoca', async () => {
    const { user, avisos } = abrir();
    await user.click(boton(/^Chat/));
    const t1 = idsDeNodos()[0] as string;
    await user.click(mas(`der-${t1}`));
    // el menú se abre pegado al «+», el foco cae en su primera opción
    expect(screen.getByRole('dialog', { name: 'Agregar después de «Disparador Chat»' })).toBeInTheDocument();
    expect(document.activeElement).toHaveAttribute('data-foco', '1');
    await user.click(boton(/^Un agente de IA/));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const ids = idsDeNodos();
    expect(ids).toHaveLength(2);
    const a = ids[1] as string;
    expect(nodo(a)).toHaveAccessibleName('Agente de IA: Agente 1. OpenAI (GPT)');
    expect(nodo(a)).toHaveFocus();
    expect(posicion(a).x).toBeGreaterThan(posicion(t1).x + 216);
    // la flecha del disparador al agente existe, con su círculo
    expect(screen.getByRole('button', { name: 'Conexión de «Disparador Chat» a «Agente 1»: un solo sentido. Editar' })).toBeInTheDocument();
    expect(dichos(avisos).at(-1)?.texto).toBe('Agregamos el agente «Agente 1» después de «Disparador Chat». Sus ajustes están en el panel de Ajustes.');
    // sus ajustes están en el panel
    expect(screen.getByRole('textbox', { name: 'Nombre del agente' })).toHaveValue('Agente 1');
  });

  it('constructor.flujo.la_patita_de_un_agente_solo_ofrece_apps_y_la_app_queda_colgada_como_herramienta', async () => {
    const { user } = abrir();
    await user.click(boton(/^Chat/));
    await user.click(mas(`der-${idsDeNodos()[0]}`));
    await user.click(boton(/^Un agente de IA/));
    const a1 = idsDeNodos()[1] as string;
    await user.click(mas(`tool-${a1}`));
    const menu = screen.getByRole('dialog', { name: 'Darle una herramienta a «Agente 1»' });
    // abre directo en las apps: ni «Un agente de IA» ni «Atrás»
    expect(within(menu).queryByRole('button', { name: /^Un agente de IA/ })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('button', { name: 'Atrás' })).not.toBeInTheDocument();
    expect(document.activeElement).toHaveAttribute('data-foco', '1');
    await user.click(within(menu).getByRole('button', { name: 'Gmail' }));
    const ids = idsDeNodos();
    expect(ids).toHaveLength(3);
    const p = ids[2] as string;
    expect(nodo(p)).toHaveAccessibleName('App · herramienta: Gmail. Lista para n8n');
    expect(nodo(p)).toHaveAccessibleDescription('App · herramienta de «Agente 1»');
    expect(nodo(p)).toHaveFocus();
    // cuelga DEBAJO de su agente, en ida y vuelta
    expect(posicion(p).y).toBeGreaterThanOrEqual(posicion(a1).y + 96 + 16);
    expect(screen.getByRole('button', { name: 'Conexión de «Agente 1» a «Gmail»: ida y vuelta. Editar' })).toBeInTheDocument();
  });

  it('constructor.flujo.la_flecha_entre_dos_ia_pasa_a_ida_y_vuelta_y_conversan_y_se_vuelve_atras_con_deshacer', async () => {
    const { user, avisos } = await conEjemplo();
    await user.click(insignia('e2'));
    const panel = screen.getByRole('complementary', { name: 'Ajustes de la conexión' });
    // el editor de la flecha: el foco cae en «Un solo sentido»
    expect(within(panel).getByRole('button', { name: /^Un solo sentido/ })).toHaveFocus();
    expect(insignia('e2')).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(panel).getByRole('button', { name: /^Ida y vuelta/ }));
    expect(within(panel).getByRole('button', { name: /^Ida y vuelta/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Conexión de «Atención a clientes» a «Revisor»: ida y vuelta. Editar' })).toBeInTheDocument();
    expect(dichos(avisos).at(-1)).toMatchObject({
      texto: '«Atención a clientes» y «Revisor» ahora conversan: ida y vuelta. Revisa en sus ajustes para qué le sirve «Revisor».',
      accion: { texto: 'Deshacer' },
    });
    // «Revisor» ahora es ayudante: su cuadro lo dice y su panel pide «¿Para qué le sirve…?»
    expect(nodo('a2')).toHaveAccessibleName(/^Agente · conversa: Revisor\. /);
    expect(nodo('a2')).toHaveAccessibleDescription('Agente de IA que conversa con «Atención a clientes»');
    // y se vuelve atrás
    await user.click(boton('Deshacer'));
    expect(screen.getByRole('button', { name: 'Conexión de «Atención a clientes» a «Revisor»: un solo sentido. Editar' })).toBeInTheDocument();
    expect(nodo('a2')).toHaveAccessibleName(/^Agente de IA: Revisor\. /);
  });

  it('constructor.flujo.una_app_pasa_de_herramienta_a_paso_del_flujo_y_vuelve_con_el_editor_de_la_flecha', async () => {
    const { user, avisos } = await conEjemplo();
    // «Google Sheets» cuelga de la patita de «Atención a clientes»: ida y vuelta
    expect(nodo('p1')).toHaveAccessibleName('App · herramienta: Google Sheets. Lista para n8n');
    await user.click(insignia('e3'));
    const panel = screen.getByRole('complementary', { name: 'Ajustes de la conexión' });
    expect(within(panel).getByRole('button', { name: /^Ida y vuelta/ })).toHaveAttribute('aria-pressed', 'true');
    // un solo sentido: pasa a ser un paso, a la derecha de su agente
    await user.click(within(panel).getByRole('button', { name: /^Un solo sentido/ }));
    expect(dichos(avisos).at(-1)?.texto).toBe('«Google Sheets» ahora va después de «Atención a clientes»: un solo sentido.');
    expect(nodo('p1')).toHaveAccessibleName('App · paso del flujo: Google Sheets. Lista para n8n');
    expect(posicion('p1').x).toBeGreaterThan(posicion('a1').x + 216);
    expect(screen.getByRole('button', { name: 'Conexión de «Atención a clientes» a «Google Sheets»: un solo sentido. Editar' })).toBeInTheDocument();
    // y de vuelta a ida y vuelta: otra vez cuelga debajo de su agente
    await user.click(within(screen.getByRole('complementary', { name: 'Ajustes de la conexión' })).getByRole('button', { name: /^Ida y vuelta/ }));
    expect(nodo('p1')).toHaveAccessibleName('App · herramienta: Google Sheets. Lista para n8n');
    expect(posicion('p1').y).toBeGreaterThanOrEqual(posicion('a1').y + 96 + 16);
    expect(screen.getByRole('button', { name: 'Conexión de «Atención a clientes» a «Google Sheets»: ida y vuelta. Editar' })).toBeInTheDocument();
  });

  it('constructor.flujo.poner_un_cuadro_en_medio_de_una_flecha_reemplaza_la_conexion_y_enfoca_el_cuadro_nuevo', async () => {
    const { user } = await conEjemplo();
    await user.click(insignia('e1'));
    await user.click(boton('Poner un cuadro en medio'));
    const menu = screen.getByRole('dialog', { name: 'Poner en medio' });
    expect(document.activeElement).toHaveAttribute('data-foco', '1');
    await user.click(within(menu).getByRole('button', { name: /^Un agente de IA/ }));
    const ids = idsDeNodos();
    expect(ids).toHaveLength(6);
    const nuevo = ids[5] as string;
    expect(nodo(nuevo)).toHaveFocus();
    // t1 → nuevo → a1: la conexión vieja ya no está
    expect(screen.queryByRole('button', { name: 'Conexión de «Disparador Chat» a «Atención a clientes»: un solo sentido. Editar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conexión de «Disparador Chat» a «Agente 1»: un solo sentido. Editar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conexión de «Agente 1» a «Atención a clientes»: un solo sentido. Editar' })).toBeInTheDocument();
    // queda entre los dos
    expect(posicion(nuevo).x).toBeGreaterThan(posicion('t1').x);
    expect(posicion(nuevo).x).toBeLessThan(posicion('a1').x);
  });

  it('constructor.flujo.cargar_el_ejemplo_arma_el_flujo_elige_el_primer_agente_y_se_puede_deshacer', async () => {
    const { user } = abrir();
    await user.click(boton('Cargar el ejemplo'));
    expect(idsDeNodos()).toEqual(['t1', 'a1', 'a2', 'p1', 'p2']);
    expect(screen.getByRole('textbox', { name: 'Nombre del flujo' })).toHaveValue('Atención a clientes');
    expect(nodo('a1')).toHaveFocus();
    expect(nodo('a1')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('group', { name: 'Disparador del flujo' })).not.toBeInTheDocument();
    expect(screen.getByText(/^Listo para descargar: 5 cuadros\./)).toBeInTheDocument();
    await user.click(boton('Deshacer'));
    expect(idsDeNodos()).toEqual([]);
    expect(screen.getByRole('group', { name: 'Disparador del flujo' })).toBeInTheDocument();
  });

  it('constructor.flujo.los_topes_los_pone_el_reductor_y_la_opcion_bloqueada_dice_el_motivo_sin_perder_el_foco', async () => {
    // 1 disparador, 4 agentes y 8 apps: los 13 cuadros que caben, en una cadena
    const nodes: Nodo[] = [{ id: 't1', kind: 'trigger', x: 8, y: 180, tipo: 'chat', frec: 'dia', ruta: 'mi-flujo', app: 'gmail' }];
    for (let i = 1; i <= 4; i++) nodes.push({ id: `a${i}`, kind: 'agent', x: 8 + i * 300, y: 180, nombre: `Agente ${i}`, ia: 'openai', tarea: '', instrucciones: 'Ayuda.' });
    for (let i = 1; i <= 8; i++) nodes.push({ id: `p${i}`, kind: 'app', x: 8 + Math.ceil(i / 2) * 300, y: 380 + (i % 2) * 120, nombre: `App ${i}` });
    const edges = [
      { id: 'e1', de: 't1', a: 'a1', tipo: 'seq' },
      { id: 'e2', de: 'a1', a: 'a2', tipo: 'seq' },
      { id: 'e3', de: 'a2', a: 'a3', tipo: 'seq' },
      { id: 'e4', de: 'a3', a: 'a4', tipo: 'seq' },
      ...[1, 2, 3, 4].flatMap(i => [
        { id: `e${4 + 2 * i - 1}`, de: `a${i}`, a: `p${2 * i - 1}`, tipo: 'tool' },
        { id: `e${4 + 2 * i}`, de: `a${i}`, a: `p${2 * i}`, tipo: 'tool' },
      ]),
    ];
    localStorage.setItem(CLAVE_BORRADOR, JSON.stringify({ v: 1, nodes, edges, nombreFlujo: 'Lleno' }));
    const { user, avisos } = abrir();
    expect(idsDeNodos()).toHaveLength(13);
    await user.click(mas('der-a4'));
    // ni una app ni un agente caben, y nada más se puede conectar: no hay primera opción
    const menu = screen.getByRole('dialog', { name: 'Agregar después de «Agente 4»' });
    const bloqueada = within(menu).getByRole('button', { name: /^Una aplicación/ });
    expect(bloqueada).toHaveAttribute('aria-disabled', 'true');
    await user.click(bloqueada);
    expect(dichos(avisos).at(-1)).toMatchObject({ texto: 'Por ahora son hasta 8 apps por flujo.', tipo: 'mal' });
    expect(idsDeNodos()).toHaveLength(13);
    expect(screen.getByRole('dialog', { name: 'Agregar después de «Agente 4»' })).toBeInTheDocument();
    expect(bloqueada).toHaveFocus();
  });

  it('constructor.flujo.arrastrar_un_cuadro_lo_mueve_no_abre_sus_ajustes_y_no_tira_el_deshacer', async () => {
    const { user } = await conEjemplo();
    // quitar algo deja un Deshacer disponible
    await user.click(boton('Quitar «Slack»'));
    expect(boton('Deshacer')).not.toHaveAttribute('aria-disabled');
    const antes = posicion('p1');
    const el = nodo('p1');
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1, button: 0, buttons: 1 });
    fireEvent.pointerMove(el, { clientX: 140, clientY: 130, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(el, { clientX: 140, clientY: 130, pointerId: 1, buttons: 0 });
    fireEvent.click(el);
    // se movió y quedó en la rejilla de 8 px: (176+40, 380+30) → (216, 408)
    expect(posicion('p1')).toEqual({ x: 216, y: 408 });
    expect(antes).toEqual({ x: 176, y: 380 });
    // el clic que cierra un arrastre no elige el cuadro
    expect(el).toHaveAttribute('aria-pressed', 'false');
    // y mover NO tira la pila: Deshacer sigue encendido y, al usarlo, devuelve «Slack» sin mover este cuadro de donde se dejó
    expect(boton('Deshacer')).not.toHaveAttribute('aria-disabled');
    await user.click(boton('Deshacer'));
    expect(hayNodo('p2')).toBe(true);
    expect(posicion('p1')).toEqual({ x: 216, y: 408 });
  });
});

// ================================================================ quitar y deshacer

describe('Constructor: quitar y deshacer', () => {
  it('constructor.deshacer_pantalla.quitar_con_la_x_ofrece_deshacer_en_el_aviso_y_su_accion_repone_el_cuadro', async () => {
    const { user, avisos } = await conEjemplo();
    await user.click(boton('Quitar «Revisor»'));
    expect(hayNodo('a2')).toBe(false);
    const ultimo = dichos(avisos).at(-1);
    expect(ultimo).toMatchObject({ tipo: 'ok', clave: 'constructor', segundos: 10, accion: { texto: 'Deshacer' } });
    expect(ultimo?.texto).toMatch(/^Quitamos «Revisor»/);
    // el foco no cayó a <body>: fue al cuadro de donde venía el flujo
    expect(nodo('a1')).toHaveFocus();
    // la acción del aviso repone el cuadro y el foco va a ese cuadro que volvió (no al que estaba elegido: «Atención a clientes»)
    act(() => ultimo?.accion?.al());
    expect(hayNodo('a2')).toBe(true);
    expect(nodo('a2')).toHaveFocus();
    expect(dichos(avisos).at(-1)?.texto).toBe('Listo: volvimos a poner lo que quitaste.');
  });

  it('constructor.deshacer_pantalla.el_boton_de_la_barra_y_ctrl_z_hacen_lo_mismo_que_el_aviso', async () => {
    const { user } = await conEjemplo();
    await user.click(boton('Quitar «Revisor»'));
    await user.click(boton('Deshacer'));
    expect(hayNodo('a2')).toBe(true);
    await user.click(boton('Quitar «Slack»'));
    expect(hayNodo('p2')).toBe(false);
    await user.keyboard('{Control>}z{/Control}');
    expect(hayNodo('p2')).toBe(true);
    await user.click(boton('Quitar «Slack»'));
    await user.keyboard('{Meta>}z{/Meta}');
    expect(hayNodo('p2')).toBe(true);
    // Ctrl+Mayús+Z (rehacer) no deshace
    await user.click(boton('Quitar «Slack»'));
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(hayNodo('p2')).toBe(false);
  });

  it('constructor.deshacer_pantalla.ctrl_z_en_un_campo_de_texto_es_del_navegador_y_no_deshace_el_flujo', async () => {
    const { user } = await conEjemplo();
    await user.click(boton('Quitar «Slack»'));
    const nombre = screen.getByRole('textbox', { name: 'Nombre del flujo' });
    await user.click(nombre);
    const evento = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    nombre.dispatchEvent(evento);
    expect(evento.defaultPrevented).toBe(false);
    expect(hayNodo('p2')).toBe(false);
  });

  it('constructor.deshacer_pantalla.editar_algo_despues_deja_el_deshacer_encendido_y_el_aviso_viejo_de_un_cambio_posterior_si_se_rechaza', async () => {
    const { user, avisos } = await conEjemplo();
    await user.click(boton('Quitar «Slack»'));
    expect(dichos(avisos).at(-1)?.accion).toBeDefined();
    expect(boton('Deshacer')).not.toHaveAttribute('aria-disabled');
    // teclear en Ajustes NO tira lo que se quitó: el botón de la barra y el aviso de la esquina siguen valiendo (el aviso no se retira)
    await user.click(nodo('a1'));
    await user.type(screen.getByRole('textbox', { name: 'Nombre del agente' }), '!');
    expect(boton('Deshacer')).not.toHaveAttribute('aria-disabled');
    expect(avisos.quitar).not.toHaveBeenCalledWith('constructor');
    // pero un cambio ESTRUCTURAL posterior sí reemplaza a ese aviso: el viejo «Deshacer» ya no deshace nada y lo dice
    const viejo = dichos(avisos).filter(d => d.accion).at(-1);
    await user.click(boton('Quitar «Revisor»'));
    act(() => viejo?.accion?.al());
    expect(hayNodo('a2')).toBe(false);
    expect(dichos(avisos).at(-1)?.texto).toBe('Eso ya no se puede deshacer: cambiaste algo después.');
    // y el del botón de la barra devuelve lo último que se quitó sin pisar lo escrito
    await user.click(boton('Deshacer'));
    expect(hayNodo('a2')).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Nombre del agente' })).toHaveValue('Atención a clientes!');
  });

  it('constructor.deshacer_pantalla.limpiar_pregunta_cancelar_no_borra_confirmar_vacia_y_el_foco_va_al_disparador', async () => {
    const { user } = await conEjemplo();
    await user.click(boton('Limpiar'));
    const pregunta = await screen.findByRole('alertdialog', { name: '¿Limpiar todo el flujo?' });
    await user.click(within(pregunta).getByRole('button', { name: 'Cancelar' }));
    expect(idsDeNodos()).toHaveLength(5);
    await waitFor(() => expect(boton('Limpiar')).toHaveFocus());

    await user.click(boton('Limpiar'));
    await user.click(await screen.findByRole('button', { name: 'Limpiar todo' }));
    expect(idsDeNodos()).toEqual([]);
    // el nombre se queda y el foco no cae a <body>: va a la primera opción de elegir el disparador
    expect(screen.getByRole('textbox', { name: 'Nombre del flujo' })).toHaveValue('Atención a clientes');
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-foco', '1'));
    expect(screen.getByRole('group', { name: 'Disparador del flujo' })).toContainElement(document.activeElement as HTMLElement);
    // limpiar también se deshace
    await user.click(boton('Deshacer'));
    expect(idsDeNodos()).toHaveLength(5);
  });
});

// ================================================================ descargar y ver el JSON

describe('Constructor: descargar', () => {
  it('constructor.descarga.apagado_explica_por_que_al_pulsarlo_y_no_baja_nada', async () => {
    const { user, avisos } = abrir();
    await user.click(boton(/^Chat/));
    const descargar = boton('Descargar .json');
    expect(descargar).toHaveAttribute('aria-disabled', 'true');
    // la lista de lo que falta está junto al botón y lo describe
    const faltan = document.getElementById('faltan');
    expect(faltan).toHaveTextContent('Te falta esto para poder descargar:');
    expect(faltan).toHaveTextContent('Toca el + junto al disparador para agregar el primer paso.');
    expect(descargar).toHaveAccessibleDescription(/Te falta esto para poder descargar/);
    expect(faltan).not.toHaveAttribute('role');
    await user.click(descargar);
    expect(descargarArchivo).not.toHaveBeenCalled();
    expect(dichos(avisos).at(-1)).toMatchObject({
      texto: 'Todavía no se puede descargar. Toca el + junto al disparador para agregar el primer paso.',
      tipo: 'mal',
    });
  });

  it('constructor.descarga.baja_un_archivo_con_el_nombre_del_flujo_y_un_json_que_se_importa_en_n8n', async () => {
    const { user, avisos } = await conEjemplo();
    await user.click(boton('Descargar .json'));
    expect(descargarArchivo).toHaveBeenCalledTimes(1);
    const [nombre, contenido] = vi.mocked(descargarArchivo).mock.calls[0] as [string, string];
    expect(nombre).toBe('atencion-a-clientes.json');
    // es el mismo archivo que arma el exportador, y se lee como JSON de n8n
    const esperado = construirFlujo(FLUJO_DE_EJEMPLO, { zona: undefined });
    const flujo = JSON.parse(contenido) as { name: string; nodes: unknown[]; connections: object };
    expect(flujo.name).toBe('Atención a clientes');
    expect(flujo.nodes).toHaveLength((esperado.flujo?.nodes ?? []).length);
    expect(Object.keys(flujo.connections).length).toBeGreaterThan(0);
    // y le dice cómo abrirlo en n8n; el aviso se queda hasta cerrarlo (es una instrucción que se necesita después)
    expect(dichos(avisos).at(-1)).toMatchObject({
      texto: 'Listo: atencion-a-clientes.json. En n8n, abre el menú «⋯» de arriba a la derecha y elige «Import from File».',
      tipo: 'ok',
      clave: 'constructor-archivo',
      segundos: 0,
    });
  });

  it('constructor.descarga.un_nombre_vacio_baja_flujo_json_y_el_doble_clic_baja_un_solo_archivo', async () => {
    const { user } = await conEjemplo();
    const nombre = screen.getByRole('textbox', { name: 'Nombre del flujo' });
    await user.clear(nombre);
    await user.dblClick(boton('Descargar .json'));
    expect(descargarArchivo).toHaveBeenCalledTimes(1);
    expect(vi.mocked(descargarArchivo).mock.calls[0]?.[0]).toBe('flujo.json');
  });

  it('constructor.descarga.el_candado_del_doble_clic_se_suelta_y_se_puede_bajar_otra_vez', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    ponerAvisos();
    render(<Constructor />);
    await user.click(boton('Cargar el ejemplo'));
    await user.click(boton('Descargar .json'));
    await user.click(boton('Descargar .json'));
    expect(descargarArchivo).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    await user.click(boton('Descargar .json'));
    expect(descargarArchivo).toHaveBeenCalledTimes(2);
  });

  it('constructor.descarga.si_el_navegador_no_puede_bajar_el_archivo_muestra_el_json_y_lo_dice', async () => {
    vi.mocked(descargarArchivo).mockReturnValue(false);
    const { user, avisos } = await conEjemplo();
    await user.click(boton('Descargar .json'));
    const region = await screen.findByRole('region', { name: 'JSON del flujo para n8n' });
    expect(region).toHaveTextContent('"nodes"');
    expect(boton('Ocultar el JSON')).toHaveAttribute('aria-expanded', 'true');
    expect(dichos(avisos).at(-1)).toMatchObject({
      texto: 'Tu navegador no nos dejó descargar el archivo. Dejamos el JSON abierto abajo: cópialo y guárdalo como un archivo .json.',
      tipo: 'mal',
    });
  });

  it('constructor.descarga.ver_el_json_abre_y_cierra_la_caja_y_solo_la_arma_si_esta_abierta', async () => {
    const { user } = await conEjemplo();
    const ver = boton('Ver el JSON');
    expect(ver).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'JSON del flujo para n8n' })).not.toBeInTheDocument();
    await user.click(ver);
    const region = screen.getByRole('region', { name: 'JSON del flujo para n8n' });
    expect(boton('Ocultar el JSON')).toHaveAttribute('aria-controls', 'json-caja');
    const json = JSON.parse(region.textContent ?? '') as { name: string };
    expect(json.name).toBe('Atención a clientes');
    // cambiar el nombre del flujo cambia el JSON que se ve
    await user.type(screen.getByRole('textbox', { name: 'Nombre del flujo' }), ' 2');
    expect((JSON.parse(screen.getByRole('region', { name: 'JSON del flujo para n8n' }).textContent ?? '') as { name: string }).name).toBe('Atención a clientes 2');
    await user.click(boton('Ocultar el JSON'));
    expect(screen.queryByRole('region', { name: 'JSON del flujo para n8n' })).not.toBeInTheDocument();
    expect(boton('Ver el JSON')).toHaveFocus();
  });

  it('constructor.descarga.el_json_de_un_flujo_incompleto_dice_que_te_falta', async () => {
    const { user } = abrir();
    await user.click(boton(/^Chat/));
    await user.click(boton('Ver el JSON'));
    expect(screen.getByRole('region', { name: 'JSON del flujo para n8n' })).toHaveTextContent(
      'Todavía no hay JSON. Te falta: Toca el + junto al disparador para agregar el primer paso.',
    );
  });
});

// ================================================================ el foco

describe('Constructor: el foco', () => {
  it('constructor.foco.nunca_cae_a_body_despues_de_cada_accion_que_cambia_la_estructura', async () => {
    const { user } = await conEjemplo();
    const enUnLugar = () => {
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).not.toBeNull();
    };
    await user.click(boton('Quitar «Revisor»'));
    enUnLugar();
    await user.click(boton('Deshacer'));
    enUnLugar();
    await user.click(mas('der-a2'));
    enUnLugar();
    await user.keyboard('{Escape}');
    enUnLugar();
    expect(mas('der-a2')).toHaveFocus();
    await user.click(insignia('e2'));
    enUnLugar();
    await user.click(boton('Quitar esta conexión'));
    enUnLugar();
    await user.click(boton('Deshacer'));
    enUnLugar();
    await user.click(boton('Quitar «Disparador Chat»'));
    enUnLugar();
    await user.click(boton('Limpiar'));
    await user.click(await screen.findByRole('button', { name: 'Limpiar todo' }));
    await waitFor(enUnLugar);
    await user.click(boton('Deshacer'));
    enUnLugar();
  });

  it('constructor.foco.si_no_hay_una_primera_opcion_en_el_menu_el_foco_cae_a_su_boton_de_cerrar', async () => {
    // 4 agentes y 8 apps sin nada más que conectar: las dos opciones están bloqueadas y no hay «Uno que ya está en el lienzo»
    const nodes: Nodo[] = [{ id: 't1', kind: 'trigger', x: 8, y: 180, tipo: 'chat', frec: 'dia', ruta: 'mi-flujo', app: 'gmail' }];
    for (let i = 1; i <= 4; i++) nodes.push({ id: `a${i}`, kind: 'agent', x: 8 + i * 300, y: 180, nombre: `Agente ${i}`, ia: 'openai', tarea: '', instrucciones: 'Ayuda.' });
    for (let i = 1; i <= 8; i++) nodes.push({ id: `p${i}`, kind: 'app', x: 8 + Math.ceil(i / 2) * 300, y: 380 + (i % 2) * 120, nombre: `App ${i}` });
    const edges = [
      { id: 'e1', de: 't1', a: 'a1', tipo: 'seq' },
      { id: 'e2', de: 'a1', a: 'a2', tipo: 'seq' },
      { id: 'e3', de: 'a2', a: 'a3', tipo: 'seq' },
      { id: 'e4', de: 'a3', a: 'a4', tipo: 'seq' },
      ...[1, 2, 3, 4].flatMap(i => [
        { id: `e${4 + 2 * i - 1}`, de: `a${i}`, a: `p${2 * i - 1}`, tipo: 'tool' },
        { id: `e${4 + 2 * i}`, de: `a${i}`, a: `p${2 * i}`, tipo: 'tool' },
      ]),
    ];
    localStorage.setItem(CLAVE_BORRADOR, JSON.stringify({ v: 1, nodes, edges, nombreFlujo: 'Lleno' }));
    const { user } = abrir();
    await user.click(mas('der-a4'));
    const menu = screen.getByRole('dialog', { name: 'Agregar después de «Agente 4»' });
    expect(menu.querySelector('[data-foco="1"]')).toBeNull();
    await waitFor(() => expect(within(menu).getByRole('button', { name: 'Cerrar el menú' })).toHaveFocus());
  });

  it('constructor.foco.con_el_menu_y_la_tarjeta_del_disparador_a_la_vez_el_foco_va_al_menu', async () => {
    // un flujo con cuadros pero sin disparador: la tarjeta «Falta el disparador» y el menú de un «+» conviven
    const f = ejemplo();
    const sinTrigger: Flujo = { ...f, nodes: f.nodes.filter(n => n.id !== 't1'), edges: f.edges.filter(e => e.de !== 't1') };
    localStorage.setItem(CLAVE_BORRADOR, JSON.stringify({ v: 1, ...sinTrigger }));
    const { user } = abrir();
    expect(screen.getByRole('group', { name: 'Disparador del flujo' })).toBeInTheDocument();
    await user.click(mas('der-a2'));
    const menu = screen.getByRole('dialog', { name: 'Agregar después de «Revisor»' });
    expect(menu).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(mas('der-a2')).toHaveFocus();
  });

  it('constructor.foco.al_quitar_el_ultimo_cuadro_el_foco_va_a_elegir_el_disparador', async () => {
    const { user } = abrir();
    await user.click(boton(/^Tiempo/));
    const t = idsDeNodos()[0] as string;
    await user.click(boton('Quitar «Disparador Tiempo»'));
    expect(hayNodo(t)).toBe(false);
    expect(document.activeElement).toHaveAttribute('data-foco', '1');
    expect(screen.getByRole('group', { name: 'Disparador del flujo' })).toContainElement(document.activeElement as HTMLElement);
  });

  it('constructor.foco.al_elegir_un_cuadro_en_una_pantalla_angosta_ajustes_se_trae_a_la_vista_sin_animacion', async () => {
    const { user } = await conEjemplo();
    const trae = vi.fn();
    // jsdom no trae scrollIntoView ni layout: Ajustes (rect en cero) queda «debajo» del lienzo (rect en cero), como en un celular
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: trae });
    try {
      await user.click(nodo('a2'));
      expect(trae).toHaveBeenCalledWith({ block: 'nearest' });
      // sin `behavior`: nada de scroll animado
      expect(trae.mock.calls.at(-1)?.[0]).not.toHaveProperty('behavior');
      expect(trae.mock.instances.at(-1)).toBe(ajustes().parentElement?.parentElement);
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  });
});

// ================================================================ teclado

describe('Constructor: el teclado', () => {
  it('constructor.teclado.enter_en_un_cuadro_lleva_el_foco_a_ajustes_y_esc_lo_regresa_al_cuadro', async () => {
    const { user } = await conEjemplo();
    nodo('a2').focus();
    await user.keyboard('{Enter}');
    expect(ajustes()).toHaveFocus();
    expect(ajustes()).toHaveAccessibleName('Ajustes del cuadro');
    expect(screen.getByRole('textbox', { name: 'Nombre del agente' })).toHaveValue('Revisor');
    await user.keyboard('{Escape}');
    expect(nodo('a2')).toHaveFocus();
    // con el ratón el foco se queda donde está (el cuadro) y Ajustes se llena igual
    await user.click(nodo('a1'));
    expect(nodo('a1')).toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Nombre del agente' })).toHaveValue('Atención a clientes');
  });

  it('constructor.teclado.esc_en_un_campo_de_ajustes_regresa_a_la_flecha_que_se_estaba_editando', async () => {
    const { user } = await conEjemplo();
    await user.click(insignia('e2'));
    await user.keyboard('{Escape}');
    expect(insignia('e2')).toHaveFocus();
  });

  it('constructor.teclado.las_flechas_mueven_un_cuadro_8_px_y_con_mayus_24_sin_desplazar_la_pagina', async () => {
    const { user } = await conEjemplo();
    nodo('p1').focus();
    // la primera flecha ajusta el cuadro a la rejilla de 8 px (380 → 384) y lo mueve
    await user.keyboard('{ArrowRight}');
    const antes = { x: 184, y: 384 };
    expect(posicion('p1')).toEqual(antes);
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    expect(posicion('p1')).toEqual({ x: antes.x, y: antes.y + 24 });
    const evento = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
    act(() => {
      nodo('p1').dispatchEvent(evento);
    });
    expect(evento.defaultPrevented).toBe(true);
    expect(posicion('p1')).toEqual({ x: antes.x, y: antes.y + 16 });
    // mover con el teclado no abre otro panel ni pierde el foco
    expect(nodo('p1')).toHaveFocus();
  });

  it('constructor.teclado.supr_quita_el_cuadro_enfocado_y_el_foco_pasa_al_cuadro_de_donde_venia', async () => {
    const { user, avisos } = await conEjemplo();
    nodo('a2').focus();
    await user.keyboard('{Delete}');
    expect(hayNodo('a2')).toBe(false);
    expect(nodo('a1')).toHaveFocus();
    expect(dichos(avisos).at(-1)?.accion).toMatchObject({ texto: 'Deshacer' });
    await user.keyboard('{Control>}z{/Control}');
    expect(hayNodo('a2')).toBe(true);
    // el foco va al cuadro que volvió (no a <body>)
    expect(nodo('a2')).toHaveFocus();
  });

  it('constructor.teclado.esc_en_un_cuadro_cancela_el_modo_conectar_y_el_boton_cancelar_tambien', async () => {
    const { user } = await conEjemplo();
    // «Slack» queda suelta: el menú de lo que sigue ofrece conectarla
    await user.click(insignia('e4'));
    await user.click(boton('Quitar esta conexión'));
    await user.click(mas('der-a2'));
    await user.click(boton(/^Uno que ya está en el lienzo/));
    expect(screen.getByText('Conectando.')).toBeInTheDocument();
    expect(nodo('a2')).toHaveFocus();
    // los cuadros que no sirven de destino se apagan con aria-disabled y dicen por qué
    expect(nodo('t1')).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Conectando.')).not.toBeInTheDocument();
    // «Cancelar» devuelve el foco al cuadro del que se partió
    await user.click(mas('der-a2'));
    await user.click(boton(/^Uno que ya está en el lienzo/));
    await user.click(boton('Cancelar'));
    expect(screen.queryByText('Conectando.')).not.toBeInTheDocument();
    expect(nodo('a2')).toHaveFocus();
  });

  it('constructor.teclado.esc_sin_nada_abierto_no_hace_nada_y_el_clic_en_el_fondo_cierra_el_menu', async () => {
    const { user, avisos } = await conEjemplo();
    nodo('a1').focus();
    const antes = dichos(avisos).length;
    await user.keyboard('{Escape}');
    expect(dichos(avisos)).toHaveLength(antes);
    expect(nodo('a1')).toHaveFocus();
    await user.click(mas('der-a2'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('group', { name: 'Lienzo del flujo' }).firstElementChild as HTMLElement);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mas('der-a2')).toHaveFocus();
  });
});

// ================================================================ avisos

describe('Constructor: avisos', () => {
  it('constructor.avisos.cada_aviso_nuevo_se_dice_una_vez_en_la_esquina_y_editar_no_repite_ninguno', async () => {
    const { user, avisos } = await conEjemplo();
    const antes = dichos(avisos).length;
    await user.click(mas('der-a2'));
    expect(dichos(avisos)).toHaveLength(antes + 1);
    // `info` sale como `ok` (la esquina le pone a `info` el ícono de «sin conexión» y lo deja fijo) y se va solo
    expect(dichos(avisos).at(-1)).toMatchObject({ texto: 'Elige qué va después de «Revisor»: una app o un agente.', tipo: 'ok', clave: 'constructor' });
    expect(dichos(avisos).at(-1)).not.toHaveProperty('segundos');
    await user.keyboard('{Escape}');
    expect(dichos(avisos).at(-1)?.texto).toBe('Cerramos el menú.');
    // dos avisos con el mismo texto seguidos se dicen los dos (su id es distinto)
    await user.click(mas('der-a2'));
    await user.keyboard('{Escape}');
    expect(dichos(avisos).filter(d => d.texto === 'Cerramos el menú.')).toHaveLength(2);
    // teclear en un campo no es un aviso
    const n = dichos(avisos).length;
    await user.click(nodo('a1'));
    await user.type(screen.getByRole('textbox', { name: 'Nombre del agente' }), 'x');
    expect(dichos(avisos)).toHaveLength(n);
  });

  it('constructor.avisos.un_rechazo_sale_como_mal_se_queda_hasta_cerrarlo_y_reemplaza_al_anterior', async () => {
    const { user, avisos } = await conEjemplo();
    await user.click(mas('tool-a1'));
    await user.click(screen.getByRole('button', { name: 'Agregar' }));
    // sin nombre no se crea nada: el motivo sale como `mal` (sin `segundos`: se queda hasta cerrarlo) con la misma clave del reductor
    expect(dichos(avisos).at(-1)).toMatchObject({ texto: 'Escribe el nombre de la app.', tipo: 'mal', clave: 'constructor' });
    expect(dichos(avisos).at(-1)).not.toHaveProperty('segundos');
    expect(idsDeNodos()).toHaveLength(5);
    // y el aviso siguiente (que no es un fallo) reemplaza al rojo con su propio tono
    await user.keyboard('{Escape}');
    expect(dichos(avisos).at(-1)?.texto).toBe('Cerramos el menú.');
    expect(dichos(avisos).at(-1)?.tipo).toBe('ok');
  });

  it('constructor.avisos.sin_cuadro_de_avisos_se_dicen_en_una_region_de_la_pantalla_y_con_el_boton_deshacer', async () => {
    // sin window.avisos (las pruebas, la vitrina): un solo mecanismo, y es la región de la propia pantalla
    const user = userEvent.setup();
    render(<Constructor />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(boton('Cargar el ejemplo'));
    expect(screen.getByRole('status')).toHaveTextContent('Cargamos el ejemplo.');
    await user.click(boton('Quitar «Revisor»'));
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent(/^Quitamos «Revisor»/);
    // su «Deshacer» repone el cuadro
    await user.click(within(region).getByRole('button', { name: 'Deshacer' }));
    expect(hayNodo('a2')).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent('Listo: volvimos a poner lo que quitaste.');
  });

  it('constructor.avisos.con_cuadro_de_avisos_no_se_repite_en_la_pantalla_para_no_anunciar_doble', async () => {
    const { user } = await conEjemplo();
    await user.click(boton('Quitar «Revisor»'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// ================================================================ el borrador

describe('Constructor: el borrador del navegador', () => {
  it('constructor.persistencia.guarda_diferido_a_los_500_ms_del_ultimo_cambio_y_no_antes', () => {
    vi.useFakeTimers();
    ponerAvisos();
    render(<Constructor />);
    fireEvent.click(boton('Cargar el ejemplo'));
    expect(guardado()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS - 100);
    });
    expect(guardado()).toBeNull();
    // otro cambio reinicia la espera
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre del flujo' }), { target: { value: 'Mi flujo' } });
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS - 100);
    });
    expect(guardado()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    const b = guardado();
    expect(b).toMatchObject({ v: 1, nombreFlujo: 'Mi flujo' });
    expect(b?.nodes).toHaveLength(5);
    // solo el flujo: nada de selección, menú ni historial
    expect(Object.keys(b ?? {}).sort()).toEqual(['edges', 'nodes', 'nombreFlujo', 'v']);
  });

  it('constructor.persistencia.guarda_de_inmediato_en_auth_saliendo_y_en_pagehide', () => {
    vi.useFakeTimers();
    ponerAvisos();
    render(<Constructor />);
    fireEvent.click(boton('Cargar el ejemplo'));
    expect(guardado()).toBeNull();
    act(() => {
      window.dispatchEvent(new Event('auth:saliendo'));
    });
    expect(guardado()?.nodes).toHaveLength(5);

    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre del flujo' }), { target: { value: 'Otro nombre' } });
    expect(guardado()?.nombreFlujo).toBe('Atención a clientes');
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(guardado()?.nombreFlujo).toBe('Otro nombre');
    // y la espera pendiente ya no escribe otra vez
    const antes = vi.spyOn(Storage.prototype, 'setItem');
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS * 2);
    });
    expect(antes).not.toHaveBeenCalled();
  });

  it('constructor.persistencia.no_guarda_un_texto_que_parece_una_clave_y_lo_dice_una_sola_vez', async () => {
    vi.useFakeTimers();
    const avisos = ponerAvisos();
    render(<Constructor />);
    fireEvent.click(boton('Cargar el ejemplo'));
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    const bueno = localStorage.getItem(CLAVE_BORRADOR);
    expect(bueno).not.toBeNull();

    fireEvent.click(nodo('a1'));
    const instrucciones = screen.getByRole('textbox', { name: /Instrucciones/ });
    fireEvent.change(instrucciones, { target: { value: 'usa sk-abcdefghijklmnopqrstuvwxyz0123456789 para entrar' } });
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    // el borrador anterior queda como estaba y la clave no se escribió en ningún lado
    expect(localStorage.getItem(CLAVE_BORRADOR)).toBe(bueno);
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain('sk-abcdefgh');
    const textoClave = 'No guardamos tu borrador porque parece que hay una clave pegada en el flujo. Quítala: las claves se ponen en n8n al conectar la cuenta.';
    expect(dichos(avisos).filter(d => d.texto === textoClave)).toHaveLength(1);
    expect(dichos(avisos).find(d => d.texto === textoClave)).toMatchObject({ tipo: 'mal', clave: 'constructor-borrador' });

    // otro cambio con la clave todavía puesta no vuelve a decirlo
    fireEvent.change(instrucciones, { target: { value: 'usa sk-abcdefghijklmnopqrstuvwxyz0123456789 para entrar!' } });
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    expect(dichos(avisos).filter(d => d.texto === textoClave)).toHaveLength(1);

    // al quitarla, se guarda; y si vuelve a pasar, se vuelve a decir
    fireEvent.change(instrucciones, { target: { value: 'Responde con claridad.' } });
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    expect(localStorage.getItem(CLAVE_BORRADOR)).not.toBe(bueno);
    expect(guardado()?.nodes.find(n => n.id === 'a1')).toMatchObject({ instrucciones: 'Responde con claridad.' });
    fireEvent.change(instrucciones, { target: { value: 'sk-abcdefghijklmnopqrstuvwxyz0123456789' } });
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    expect(dichos(avisos).filter(d => d.texto === textoClave)).toHaveLength(2);
  });

  it('constructor.persistencia.recupera_el_borrador_al_abrir_lo_dice_y_no_lo_reescribe_sin_cambios', () => {
    vi.useFakeTimers();
    const guardar = crearBorrador(() => window.localStorage).guardar(ejemplo());
    expect(guardar.ok).toBe(true);
    const escribe = vi.spyOn(Storage.prototype, 'setItem');
    const avisos = ponerAvisos();
    render(<Constructor />);
    expect(idsDeNodos()).toEqual(['t1', 'a1', 'a2', 'p1', 'p2']);
    expect(screen.getByRole('textbox', { name: 'Nombre del flujo' })).toHaveValue('Atención a clientes');
    expect(dichos(avisos)).toHaveLength(1);
    expect(dichos(avisos)[0]).toMatchObject({ texto: TEXTO_RECUPERADO, tipo: 'ok' });
    // sin tarjeta de elegir el disparador: el flujo ya lo tiene
    expect(screen.queryByRole('group', { name: 'Disparador del flujo' })).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS * 3);
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(escribe).not.toHaveBeenCalled();
  });

  it('constructor.persistencia.limpiar_borra_tambien_el_borrador_y_deshacer_lo_vuelve_a_guardar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    crearBorrador(() => window.localStorage).guardar(ejemplo());
    ponerAvisos();
    render(<Constructor />);
    await user.click(boton('Limpiar'));
    await user.click(await screen.findByRole('button', { name: 'Limpiar todo' }));
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    expect(localStorage.getItem(CLAVE_BORRADOR)).toBeNull();
    await user.click(boton('Deshacer'));
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    expect(guardado()?.nodes).toHaveLength(5);
  });

  it('constructor.persistencia.un_borrador_roto_se_descarta_y_se_dice_y_uno_de_una_version_futura_no_se_toca', () => {
    vi.useFakeTimers();
    localStorage.setItem(CLAVE_BORRADOR, '{esto no es json');
    const a1 = ponerAvisos();
    const r1 = render(<Constructor />);
    expect(idsDeNodos()).toEqual([]);
    expect(dichos(a1)[0]).toMatchObject({ texto: 'No pudimos recuperar tu borrador anterior, así que empezamos de cero.', tipo: 'ok' });
    r1.unmount();

    const futuro = JSON.stringify({ v: 99, nodes: [], edges: [], nombreFlujo: 'del futuro' });
    localStorage.setItem(CLAVE_BORRADOR, futuro);
    const a2 = ponerAvisos();
    render(<Constructor />);
    expect(idsDeNodos()).toEqual([]);
    expect(dichos(a2)).toHaveLength(1);
    // abrir con un lienzo vacío no borra lo que no entendió
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS * 3);
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(localStorage.getItem(CLAVE_BORRADOR)).toBe(futuro);
  });

  it('constructor.persistencia.sin_almacenamiento_la_pantalla_funciona_y_lo_dice_una_sola_vez', () => {
    vi.useFakeTimers();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('sin almacenamiento');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('sin almacenamiento');
    });
    const avisos = ponerAvisos();
    render(<Constructor />);
    fireEvent.click(boton('Cargar el ejemplo'));
    expect(idsDeNodos()).toHaveLength(5);
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre del flujo' }), { target: { value: 'Otro' } });
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    const dicho = dichos(avisos).filter(d => d.texto.startsWith('Tu navegador no deja guardar el borrador'));
    expect(dicho).toHaveLength(1);
    expect(dicho[0]).toMatchObject({ tipo: 'mal', clave: 'constructor-borrador' });
  });

  it('constructor.persistencia.sin_cuadro_de_avisos_lo_que_no_se_pudo_guardar_se_dice_en_la_pantalla', () => {
    vi.useFakeTimers();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('lleno', 'QuotaExceededError');
    });
    render(<Constructor />);
    fireEvent.click(boton('Cargar el ejemplo'));
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Tu navegador no tiene espacio para guardar el borrador. Descarga el .json para no perder tu trabajo.');
  });
});

// ================================================================ del Asistente al Constructor

describe('Constructor: el traspaso desde el Asistente', () => {
  it('constructor.traspaso.un_flujo_del_asistente_abre_con_su_aviso_el_primer_agente_elegido_y_con_el_foco', () => {
    vi.useFakeTimers();
    const muestra = muestras()[0];
    expect(crearBorrador(() => window.localStorage).traspasar(muestra).ok).toBe(true);
    expect(guardado()?.origen).toBe('asistente');
    const avisos = ponerAvisos();
    render(<Constructor />);
    expect(idsDeNodos()).toEqual(['t1', 'a1', 'p1', 'p2']);
    expect(screen.getByRole('textbox', { name: 'Nombre del flujo' })).toHaveValue('Responder correos de clientes');
    expect(dichos(avisos)).toHaveLength(1);
    expect(dichos(avisos)[0]).toMatchObject({ texto: TEXTO_DEL_ASISTENTE, tipo: 'ok' });
    // el primer agente queda elegido, con el foco y sus ajustes a la vista; la tarjeta del disparador no sale
    expect(nodo('a1')).toHaveAttribute('aria-pressed', 'true');
    expect(nodo('a1')).toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Nombre del agente' })).toHaveValue('Atención por correo');
    expect(screen.queryByRole('group', { name: 'Disparador del flujo' })).not.toBeInTheDocument();
    // «Deshacer» no existe todavía: venir del Asistente no es un cambio que se deshaga
    expect(boton('Deshacer')).toHaveAttribute('aria-disabled', 'true');
    // el guardado normal le quita la marca: al recargar ya es «tu borrador»
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    expect(guardado()?.origen).toBeUndefined();
    expect(guardado()?.nodes).toHaveLength(4);
  });

  it('constructor.traspaso.un_flujo_del_asistente_que_no_pasa_la_limpieza_no_se_abre_y_lo_dice', () => {
    // un borrador con una clave pegada (editado a mano): se descarta, no se abre
    const muestra = muestras()[0] as { nodes: Nodo[]; edges: unknown[] };
    const nodes = muestra.nodes.map(n => (n.kind === 'agent' ? { ...n, instrucciones: 'sk-abcdefghijklmnopqrstuvwxyz0123456789' } : n));
    localStorage.setItem(CLAVE_BORRADOR, JSON.stringify({ v: 1, nodes, edges: muestra.edges, nombreFlujo: 'x', origen: 'asistente' }));
    const avisos = ponerAvisos();
    render(<Constructor />);
    expect(idsDeNodos()).toEqual([]);
    expect(dichos(avisos)[0]?.texto).toBe('No pudimos recuperar tu borrador anterior, así que empezamos de cero.');
    expect(JSON.stringify(Array.from(document.querySelectorAll('input,textarea')).map(e => (e as HTMLInputElement).value))).not.toContain('sk-abcdefgh');
  });
});
