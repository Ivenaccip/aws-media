// Las regresiones de la revisión de la interfaz que se ven en la pantalla ENTERA (Constructor.tsx con todos sus componentes): el foco
// que no cae a <body>, «Deshacer» que sobrevive a mover un cuadro, los avisos que se retiran cuando ya no son ciertos, el borrador
// con dos pestañas abiertas, Esc con el foco perdido o durante una composición de teclado (IME) y la ayuda del teclado que el lector
// de pantalla sí recibe. Lo que solo se mide en un navegador (tamaños, solapes, desbordes) se verificó con Chromium y se cita en el informe.
// Cada test con ID (`constructor.<tema>.<frase>`) es un invariante registrado.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { descargarArchivo } from '../../nucleo/descargarArchivo';
import { ponerAvisos } from '../../prueba/servidor';
import { Constructor } from './Constructor';
import { CLAVE_BORRADOR, crearBorrador } from './modelo/borrador';
import { ejemplo } from './modelo/ejemplos';
import type { Nodo } from './modelo/tipos';
import { ESPERA_GUARDADO_MS } from './useBorrador';

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
const boton = (nombre: string | RegExp) => screen.getByRole('button', { name: nombre });
const posicion = (id: string) => {
  const caja = nodo(id).parentElement as HTMLElement;
  return { x: parseInt(caja.style.left, 10), y: parseInt(caja.style.top, 10) };
};
const dichos = (a: ReturnType<typeof ponerAvisos>) => a.mostrar.mock.calls.map(([texto, op]) => ({ texto, ...op }));
/** El último aviso que ofreció «Deshacer» (el del ejemplo cargado también lo ofrece: el que vale es el más nuevo). */
const ultimoConDeshacer = (a: ReturnType<typeof ponerAvisos>) => dichos(a).filter(d => d.accion).at(-1);
const guardado = () => JSON.parse(localStorage.getItem(CLAVE_BORRADOR) ?? 'null') as { nodes: Nodo[]; nombreFlujo: string; origen?: string } | null;

function abrir() {
  const avisos = ponerAvisos();
  const user = userEvent.setup();
  const r = render(<Constructor />);
  return { avisos, user, ...r };
}
async function conEjemplo() {
  const a = abrir();
  await a.user.click(boton('Cargar el ejemplo'));
  return a;
}
/** Arrastra un cuadro con el puntero de punta a punta (lo que hace Lienzo con el dedo o el ratón). */
function arrastrar(id: string, dx: number, dy: number) {
  const el = nodo(id);
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1, button: 0, buttons: 1 });
  fireEvent.pointerMove(el, { clientX: 100 + dx, clientY: 100 + dy, pointerId: 1, buttons: 1 });
  fireEvent.pointerUp(el, { clientX: 100 + dx, clientY: 100 + dy, pointerId: 1, buttons: 0 });
  fireEvent.click(el);
}

beforeEach(() => {
  vi.mocked(descargarArchivo).mockReset();
  vi.mocked(descargarArchivo).mockReturnValue(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ================================================================ Deshacer sobrevive a mover y a teclear

describe('Constructor · Deshacer sobrevive a mover y a teclear', () => {
  it('constructor.deshacer_pantalla.mover_un_cuadro_despues_de_quitar_otro_no_apaga_deshacer_y_este_lo_repone_sin_mover_lo_movido', async () => {
    const { user, avisos } = await conEjemplo();
    await user.click(boton('Quitar «Slack»'));
    expect(boton('Deshacer')).not.toHaveAttribute('aria-disabled');
    const quitoSlack = dichos(avisos).at(-1);
    expect(quitoSlack?.accion).toBeDefined();
    const quitados = avisos.quitar.mock.calls.length;
    // acomodar OTRO cuadro (con el ratón, y luego con el teclado) no borra la red de seguridad ni retira el aviso
    arrastrar('p1', 40, 30);
    expect(posicion('p1')).toEqual({ x: 216, y: 408 });
    nodo('a1').focus();
    await user.keyboard('{ArrowRight}');
    expect(boton('Deshacer')).not.toHaveAttribute('aria-disabled');
    expect(avisos.quitar.mock.calls.length).toBe(quitados);
    // el «Deshacer» del aviso repone a «Slack» y deja los cuadros donde la persona los puso
    act(() => quitoSlack?.accion?.al());
    expect(hayNodo('p2')).toBe(true);
    expect(posicion('p1')).toEqual({ x: 216, y: 408 });
    expect(posicion('a1').x).toBe(320);
  });

  it('constructor.deshacer_pantalla.teclear_en_ajustes_despues_de_quitar_deja_el_deshacer_encendido_y_no_pisa_lo_escrito', async () => {
    const { user, avisos } = await conEjemplo();
    await user.click(boton('Quitar «Slack»'));
    const aviso = ultimoConDeshacer(avisos);
    expect(aviso?.accion).toBeDefined();
    await user.click(nodo('a1'));
    await user.type(screen.getByRole('textbox', { name: 'Nombre del agente' }), '!');
    // lo que se quitó se puede devolver: teclear no tira la red de seguridad (y el aviso de la esquina no se retira)
    expect(boton('Deshacer')).not.toHaveAttribute('aria-disabled');
    expect(avisos.quitar).not.toHaveBeenCalledWith('constructor');
    act(() => aviso?.accion?.al());
    expect(hayNodo('p2')).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Nombre del agente' })).toHaveValue('Atención a clientes!');
  });
});

// ================================================================ el foco nunca cae a <body>

describe('Constructor · el foco', () => {
  it('constructor.foco.volver_a_pulsar_el_mas_cierra_el_menu_y_el_foco_queda_en_ese_mas_aunque_el_clic_no_enfoque_botones', async () => {
    await conEjemplo();
    // Safari, Firefox en macOS e iOS no enfocan un botón al hacerle clic: `fireEvent.click` tampoco
    fireEvent.click(mas('der-a2'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement));
    fireEvent.click(mas('der-a2'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(mas('der-a2')).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
  });

  it('constructor.foco.cerrar_el_menu_de_poner_un_cuadro_en_medio_deja_el_foco_en_ese_boton_y_el_panel_sigue_siendo_el_de_la_flecha', async () => {
    const { user } = await conEjemplo();
    await user.click(insignia('e2'));
    const enMedio = boton('Poner un cuadro en medio');
    expect(enMedio).toHaveAttribute('aria-expanded', 'false');
    await user.click(enMedio);
    // con el menú abierto la flecha sigue elegida: el panel no cambia de contexto en silencio
    expect(screen.getByRole('complementary', { name: 'Ajustes de la conexión' })).toBeInTheDocument();
    expect(insignia('e2')).toHaveAttribute('aria-pressed', 'true');
    expect(boton('Poner un cuadro en medio')).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // sin esto el foco caía al primer cuadro del lienzo
    expect(document.activeElement).toBe(boton('Poner un cuadro en medio'));
    expect(boton('Poner un cuadro en medio')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('complementary', { name: 'Ajustes de la conexión' })).toBeInTheDocument();
    // lo mismo con el botón «Cerrar el menú»
    await user.click(boton('Poner un cuadro en medio'));
    await user.click(boton('Cerrar el menú'));
    expect(document.activeElement).toBe(boton('Poner un cuadro en medio'));
  });

  it('constructor.foco.quitar_una_herramienta_con_supr_manda_el_foco_a_su_agente_y_deshacer_al_cuadro_que_volvio', async () => {
    const { user, avisos } = await conEjemplo();
    nodo('p2').focus(); // «Slack» es herramienta de «Revisor»
    await user.keyboard('{Delete}');
    expect(hayNodo('p2')).toBe(false);
    await waitFor(() => expect(nodo('a2')).toHaveFocus());
    // «Deshacer» desde el aviso lleva el foco al cuadro que volvió, no al que estaba elegido
    act(() => ultimoConDeshacer(avisos)?.accion?.al());
    expect(hayNodo('p2')).toBe(true);
    await waitFor(() => expect(nodo('p2')).toHaveFocus());
  });
});

// ================================================================ mover con el teclado trae el cuadro a la vista

describe('Constructor · mover con el teclado', () => {
  it('constructor.teclado.mover_un_cuadro_con_las_flechas_lo_trae_a_la_vista_y_arrastrarlo_con_el_puntero_no_scrollea', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      await conEjemplo();
      scroll.mockClear();
      nodo('a1').focus();
      fireEvent.keyDown(nodo('a1'), { key: 'ArrowRight', shiftKey: true });
      // el cuadro sigue al foco: el marco se desplaza para que no quede recortado fuera de su vista
      await waitFor(() => expect(scroll).toHaveBeenCalled());
      expect(scroll.mock.contexts.at(-1)).toBe(nodo('a1'));
      expect(scroll.mock.calls.at(-1)?.[0]).toEqual({ block: 'nearest', inline: 'nearest' });
      scroll.mockClear();
      arrastrar('p1', 24, 8);
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});

// ================================================================ la ayuda de teclado llega al lector de pantalla

describe('Constructor · la ayuda del teclado', () => {
  it('constructor.guia.la_ayuda_de_teclado_que_describe_al_lienzo_no_esta_dentro_de_un_details_cerrado', () => {
    abrir();
    const lienzo = screen.getByRole('group', { name: 'Lienzo del flujo' });
    const idAyuda = lienzo.getAttribute('aria-describedby');
    expect(idAyuda).toBe('ayuda-teclado');
    const ayuda = document.getElementById(idAyuda as string) as HTMLElement;
    // sin esto la descripción del lienzo salía vacía: un details cerrado no se expone y el lector de pantalla nunca oía las teclas
    expect(ayuda.closest('details')).toBeNull();
    expect(ayuda).toHaveTextContent(/Tab recorre los cuadros/);
    expect(lienzo).toHaveAccessibleDescription(/Tab recorre los cuadros/);
  });
});

// ================================================================ los avisos que ya no son ciertos se retiran

describe('Constructor · los avisos se retiran cuando ya no son ciertos', () => {
  it('constructor.avisos.el_aviso_de_no_se_puede_descargar_se_retira_cuando_ya_se_puede_y_uno_de_descargado_no', async () => {
    const { user, avisos } = await conEjemplo();
    // sin disparador no se puede descargar: «Todavía no se puede descargar…» sale en rojo y no se cierra solo
    await user.click(boton('Quitar «Disparador Chat»'));
    await user.click(boton('Descargar .json'));
    expect(dichos(avisos).at(-1)).toMatchObject({ tipo: 'mal', clave: 'constructor-archivo' });
    // el flujo se completa (se vuelve a poner el disparador): el aviso ya no es cierto y se va solo (antes costaba decenas de Tab cerrarlo)
    await user.click(boton('Deshacer'));
    expect(avisos.quitar).toHaveBeenCalledWith('constructor-archivo');
    // y el «Listo: …» de una descarga que sí salió sigue ahí hasta cerrarlo (es lo que dice cómo importarlo en n8n)
    avisos.quitar.mockClear();
    await user.click(boton('Descargar .json'));
    expect(dichos(avisos).at(-1)).toMatchObject({ clave: 'constructor-archivo', segundos: 0 });
    await user.click(nodo('a1'));
    await user.type(screen.getByRole('textbox', { name: 'Nombre del agente' }), '!');
    expect(avisos.quitar).not.toHaveBeenCalledWith('constructor-archivo');
  });

  it('constructor.avisos.sin_cuadro_de_avisos_el_mensaje_de_no_se_puede_descargar_tambien_se_va_cuando_ya_se_puede', async () => {
    const user = userEvent.setup();
    render(<Constructor />);
    await user.click(boton('Cargar el ejemplo'));
    await user.click(boton('Quitar «Disparador Chat»'));
    await user.click(boton('Descargar .json'));
    expect(screen.getByRole('status')).toHaveTextContent(/Todavía no se puede descargar/);
    await user.click(boton('Deshacer'));
    expect(screen.queryByText(/Todavía no se puede descargar/)).not.toBeInTheDocument();
  });

  it('constructor.avisos.el_aviso_rojo_de_borrador_sin_guardar_se_retira_en_cuanto_el_guardado_vuelve_a_funcionar', async () => {
    vi.useFakeTimers();
    const avisos = ponerAvisos();
    render(<Constructor />);
    fireEvent.click(boton('Cargar el ejemplo'));
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    fireEvent.click(nodo('a1'));
    const instrucciones = screen.getByRole('textbox', { name: /Instrucciones/ });
    fireEvent.change(instrucciones, { target: { value: 'usa sk-abcdefghijklmnopqrstuvwxyz0123456789 para entrar' } });
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    expect(dichos(avisos).filter(d => d.clave === 'constructor-borrador' && d.tipo === 'mal')).toHaveLength(1);
    expect(avisos.quitar).not.toHaveBeenCalledWith('constructor-borrador');
    // se quita la clave y el borrador se guarda bien: el rojo (que pide «Quítala») ya no es cierto y se retira
    fireEvent.change(instrucciones, { target: { value: 'Responde con claridad.' } });
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    expect(guardado()?.nodes.find(n => n.id === 'a1')).toMatchObject({ instrucciones: 'Responde con claridad.' });
    expect(avisos.quitar).toHaveBeenCalledWith('constructor-borrador');
  });

  it('constructor.avisos.sin_cuadro_de_avisos_el_mensaje_de_borrador_sin_guardar_tambien_se_va_cuando_se_guarda', () => {
    vi.useFakeTimers();
    render(<Constructor />);
    fireEvent.click(boton('Cargar el ejemplo'));
    fireEvent.click(nodo('a1'));
    const instrucciones = screen.getByRole('textbox', { name: /Instrucciones/ });
    fireEvent.change(instrucciones, { target: { value: 'usa sk-abcdefghijklmnopqrstuvwxyz0123456789 para entrar' } });
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    expect(screen.getByRole('status')).toHaveTextContent(/No guardamos tu borrador/);
    fireEvent.change(instrucciones, { target: { value: 'Responde con claridad.' } });
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    expect(screen.queryByText(/No guardamos tu borrador/)).not.toBeInTheDocument();
  });
});

// ================================================================ descargar cuando el navegador no deja

describe('Constructor · si el navegador no deja descargar', () => {
  it('constructor.descarga.si_el_navegador_bloquea_la_descarga_el_foco_pasa_a_copiar_el_json_que_ahora_esta_abajo', async () => {
    vi.mocked(descargarArchivo).mockReturnValue(false);
    const { user } = await conEjemplo();
    await user.click(boton('Descargar .json'));
    await screen.findByRole('region', { name: 'JSON del flujo para n8n' });
    // «Dejamos el JSON abierto abajo»: quien usa lector de pantalla o teclado llega a él sin 21 Tab
    await waitFor(() => expect(document.activeElement).toBe(boton('Copiar el JSON')));
  });
});

// ================================================================ Esc y el clic en el fondo con el foco perdido

describe('Constructor · Esc y clic en el fondo', () => {
  async function conectando() {
    const a = await conEjemplo();
    // «Slack» queda suelta: el menú de lo que sigue ofrece conectarla
    await a.user.click(insignia('e4'));
    await a.user.click(boton('Quitar esta conexión'));
    await a.user.click(mas('der-a2'));
    await a.user.click(boton(/^Uno que ya está en el lienzo/));
    expect(screen.getByText('Conectando.')).toBeInTheDocument();
    return a;
  }

  it('constructor.teclado.esc_cancela_el_modo_conectar_aunque_el_foco_este_en_el_body', async () => {
    await conectando();
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByText('Conectando.')).not.toBeInTheDocument();
  });

  it('constructor.teclado.esc_con_el_foco_en_el_body_cierra_el_menu_abierto', async () => {
    const { user } = await conEjemplo();
    await user.click(mas('der-a2'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('constructor.teclado.el_clic_en_el_fondo_vacio_tambien_cancela_el_modo_conectar', async () => {
    await conectando();
    fireEvent.click(screen.getByRole('group', { name: 'Lienzo del flujo' }).firstElementChild as HTMLElement);
    expect(screen.queryByText('Conectando.')).not.toBeInTheDocument();
    expect(nodo('a2')).toHaveFocus();
  });

  it('constructor.teclado.esc_no_se_atiende_dos_veces_si_el_menu_ya_lo_atendio_y_no_se_mete_con_un_dialogo_modal', async () => {
    const { user, avisos } = await conEjemplo();
    await user.click(mas('der-a2'));
    const antes = dichos(avisos).length;
    await user.keyboard('{Escape}');
    // un solo «Cerramos el menú» y el foco vuelve al «+»
    expect(dichos(avisos).length).toBe(antes + 1);
    expect(mas('der-a2')).toHaveFocus();
    // con la pregunta de «Limpiar» abierta, Esc es de ella: no toca nada más del lienzo
    await user.click(boton('Limpiar'));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(hayNodo('a1')).toBe(true);
  });
});

// ================================================================ teclados con composición (IME)

describe('Constructor · composición de teclado', () => {
  it('constructor.teclado.esc_o_enter_durante_una_composicion_ime_no_cierra_el_menu_ni_agrega_la_app_ni_saca_de_ajustes', async () => {
    const { user } = await conEjemplo();
    await user.click(mas('tool-a1'));
    const otra = screen.getByRole('textbox', { name: '¿Otra app? Escribe su nombre' });
    await user.type(otra, 'ほ');
    // el Esc que cancela una composición y el Enter que la confirma son del método de entrada, no de la pantalla
    fireEvent.keyDown(otra, { key: 'Escape', isComposing: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(otra).toHaveValue('ほ');
    fireEvent.keyDown(otra, { key: 'Enter', isComposing: true });
    expect(hayNodo('p3')).toBe(false);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // sin composición, el comportamiento de siempre
    fireEvent.keyDown(otra, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // lo mismo en Ajustes: Esc con composición no regresa al cuadro
    await user.click(nodo('a1'));
    const nombre = screen.getByRole('textbox', { name: 'Nombre del agente' });
    nombre.focus();
    fireEvent.keyDown(nombre, { key: 'Escape', isComposing: true });
    expect(nombre).toHaveFocus();
    fireEvent.keyDown(nombre, { key: 'Escape' });
    expect(nodo('a1')).toHaveFocus();
  });
});

// ================================================================ Ajustes a la vista en pantallas anchas

describe('Constructor · Ajustes visible', () => {
  it('constructor.foco.en_pantalla_ancha_ajustes_se_trae_a_la_vista_si_al_elegir_un_cuadro_su_encabezado_quedo_arriba_fuera_de_la_ventana', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      const { user } = await conEjemplo();
      // el contenedor que Constructor.tsx mide (el que envuelve al panel `#ajustes`)
      const panel = document.getElementById('ajustes')!.parentElement!.parentElement as HTMLElement;
      const marco = screen.getByRole('group', { name: 'Lienzo del flujo' });
      // pantalla ancha: Ajustes junto al lienzo (su top no está debajo de su borde inferior), pero la página se desplazó y el panel quedó
      // con la mitad de arriba fuera de la ventana
      vi.spyOn(marco, 'getBoundingClientRect').mockReturnValue({ top: -300, bottom: 400, left: 0, right: 800, width: 800, height: 700, x: 0, y: -300, toJSON: () => ({}) });
      vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ top: -329, bottom: 300, left: 820, right: 1160, width: 340, height: 629, x: 820, y: -329, toJSON: () => ({}) });
      scroll.mockClear();
      await user.click(nodo('p1'));
      expect(scroll).toHaveBeenCalled();
      expect(scroll.mock.contexts.at(-1)).toBe(panel);
      // con el panel entero a la vista no hay nada que hacer
      scroll.mockClear();
      vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ top: 20, bottom: 500, left: 820, right: 1160, width: 340, height: 480, x: 820, y: 20, toJSON: () => ({}) });
      await user.click(nodo('a2'));
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});

// ================================================================ dos pestañas con el mismo borrador

describe('Constructor · dos pestañas', () => {
  const otraPestana = (nombre: string) => {
    const flujo = { ...ejemplo(), nombreFlujo: nombre };
    crearBorrador(() => window.localStorage).traspasar(flujo);
    return localStorage.getItem(CLAVE_BORRADOR) as string;
  };

  it('constructor.persistencia.si_otra_pestana_cambio_el_borrador_esta_no_lo_pisa_y_lo_dice_una_sola_vez', () => {
    vi.useFakeTimers();
    const avisos = ponerAvisos();
    render(<Constructor />);
    fireEvent.click(boton('Cargar el ejemplo'));
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    const nombreCampo = screen.getByRole('textbox', { name: 'Nombre del flujo' });
    // la pestaña B escribe su versión (y el navegador le avisa a ésta con el evento `storage`)
    const deB = otraPestana('Editado en B');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: CLAVE_BORRADOR, newValue: deB }));
    });
    fireEvent.change(nombreCampo, { target: { value: 'Editado en A' } });
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    expect(localStorage.getItem(CLAVE_BORRADOR)).toBe(deB);
    const textoConflicto = (a: ReturnType<typeof ponerAvisos>) => dichos(a).filter(d => d.clave === 'constructor-borrador' && /otra pestaña/i.test(d.texto));
    expect(textoConflicto(avisos)).toHaveLength(1);
    expect(textoConflicto(avisos)[0]?.tipo).toBe('mal');
    // más cambios, y el cierre de la pestaña, no vuelven a pisarlo ni a decirlo
    fireEvent.change(nombreCampo, { target: { value: 'Editado en A otra vez' } });
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(localStorage.getItem(CLAVE_BORRADOR)).toBe(deB);
    expect(textoConflicto(avisos)).toHaveLength(1);
  });

  it('constructor.persistencia.aunque_el_evento_storage_no_llegue_se_nota_al_guardar_que_el_borrador_ya_no_es_el_que_esta_pestana_escribio', () => {
    vi.useFakeTimers();
    const avisos = ponerAvisos();
    render(<Constructor />);
    fireEvent.click(boton('Cargar el ejemplo'));
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    const deB = otraPestana('Flujo del Asistente');
    // sin evento: es lo que pasa si la otra pestaña escribió justo antes de que esta guardara
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre del flujo' }), { target: { value: 'Mi cambio' } });
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    expect(localStorage.getItem(CLAVE_BORRADOR)).toBe(deB);
    expect(JSON.parse(deB).nombreFlujo).toBe('Flujo del Asistente');
    expect(dichos(avisos).filter(d => /otra pestaña/i.test(d.texto))).toHaveLength(1);
  });

  it('constructor.persistencia.una_sola_pestana_sigue_guardando_como_siempre_y_limpiar_borra_sin_creer_que_es_un_conflicto', () => {
    vi.useFakeTimers();
    const avisos = ponerAvisos();
    render(<Constructor />);
    fireEvent.click(boton('Cargar el ejemplo'));
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre del flujo' }), { target: { value: 'Uno' } });
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    expect(guardado()?.nombreFlujo).toBe('Uno');
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre del flujo' }), { target: { value: 'Dos' } });
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    expect(guardado()?.nombreFlujo).toBe('Dos');
    // un `storage` de otra llave (cualquier otra cosa del sitio) no es un conflicto
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'otra.cosa', newValue: 'x' }));
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre del flujo' }), { target: { value: 'Tres' } });
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    expect(guardado()?.nombreFlujo).toBe('Tres');
    expect(dichos(avisos).filter(d => /otra pestaña/i.test(d.texto))).toHaveLength(0);
  });

  it('constructor.persistencia.un_guardado_que_fallo_se_reintenta_al_salir_y_al_ocultarse_la_pagina', () => {
    vi.useFakeTimers();
    const avisos = ponerAvisos();
    render(<Constructor />);
    fireEvent.click(boton('Cargar el ejemplo'));
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    // el almacenamiento se llena un momento: el guardado diferido falla
    const real = Storage.prototype.setItem;
    let lleno = true;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (lleno) throw new DOMException('lleno', 'QuotaExceededError');
      return real.call(this, k, v);
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre del flujo' }), { target: { value: 'Importante' } });
    act(() => {
      vi.advanceTimersByTime(ESPERA_GUARDADO_MS + 10);
    });
    expect(guardado()?.nombreFlujo).not.toBe('Importante');
    expect(dichos(avisos).filter(d => d.clave === 'constructor-borrador')).toHaveLength(1);
    // vuelve el espacio y la sesión caduca (o la pestaña se cierra): ahora sí se guarda, sin repetir el aviso
    lleno = false;
    act(() => {
      window.dispatchEvent(new Event('auth:saliendo'));
    });
    expect(guardado()?.nombreFlujo).toBe('Importante');
    expect(dichos(avisos).filter(d => d.clave === 'constructor-borrador' && d.tipo === 'mal')).toHaveLength(1);
  });
});

// ================================================================ a 320 px con la letra grande o un nombre larguísimo

describe('Constructor · el encabezado en pantallas angostas', () => {
  it('constructor.pantalla.el_titulo_parte_una_palabra_larga_y_las_migas_no_dejan_un_separador_solo_al_inicio_de_la_segunda_linea', () => {
    abrir();
    const h2 = screen.getByRole('heading', { level: 2, name: 'Arma tu automatización' });
    // con el texto al doble, «automatización» (48 px) no cabía en 320 px y ensanchaba la página; el h1 ya llevaba esta clase
    expect(h2.className).toContain('[overflow-wrap:anywhere]');
    // en un celular las tres migas se parten en dos renglones y el «›» de la segunda quedaba solo, pegado al borde izquierdo: ahí no se pintan
    const migas = screen.getByRole('navigation', { name: 'Dónde estás' });
    expect(migas.className).toContain('max-[480px]:[&_li>span[aria-hidden=true]]:hidden');
    expect(migas.querySelectorAll('li > span[aria-hidden="true"]')).toHaveLength(2);
  });
});
