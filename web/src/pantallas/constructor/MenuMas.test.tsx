// El menú del «+» como COMPORTAMIENTO: cada clic manda a `despachar` la acción exacta, las opciones bloqueadas se apagan con
// `aria-disabled` (no `disabled`) y dicen su motivo, el foco tiene a quién ir (`data-foco="1"`) y Esc lo cierra desde cualquier parte.
// El estado sale del reductor de verdad y la vista de `vistaMenu`: así se prueba también que el reductor contesta lo que el menú pide.
// Cada test con ID (`constructor.menu_mas.…`) es un invariante registrado.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MenuMas } from './MenuMas';
import { LARGO_NOMBRE_APP, TOPE_AGENTES, TOPE_APPS } from './modelo/datos/constantes';
import { ejemplo } from './modelo/ejemplos';
import { estadoInicial, reducir } from './modelo/reductor';
import { vistaMenu } from './modelo/selectores';
import * as T from './modelo/textos';
import type { AccionConstructor, Arista, EstadoConstructor, Flujo, Nodo } from './modelo/tipos';

// ---------------------------------------------------------------- ayudas

const disparador = (): Nodo => ({ id: 't1', kind: 'trigger', x: 8, y: 180, tipo: 'chat', frec: 'dia', ruta: 'mi-flujo', app: 'gmail' });
const agente = (n: number, x: number): Nodo => ({ id: `a${n}`, kind: 'agent', x, y: 180, nombre: `Agente ${n}`, ia: 'openai', tarea: '', instrucciones: 'Ayuda.' });
const app = (n: number, x: number, y: number, nombre = `App ${n}`): Nodo => ({ id: `p${n}`, kind: 'app', x, y, nombre });
const seq = (n: number, de: string, a: string): Arista => ({ id: `e${n}`, de, a, tipo: 'seq' });

/** Disparador → «Agente 1», con una app suelta («App 1») que se puede conectar después. */
const conAppSuelta = (): Flujo => ({
  nodes: [disparador(), agente(1, 312), app(1, 616, 380)],
  edges: [seq(1, 't1', 'a1')],
  nombreFlujo: 'Mi flujo',
});

function estadoCon(flujo: Flujo, ...acciones: AccionConstructor[]): EstadoConstructor {
  let e = estadoInicial(flujo);
  for (const a of acciones) e = reducir(e, a);
  return e;
}

function pintar(estado: EstadoConstructor) {
  const vista = vistaMenu(estado);
  if (!vista) throw new Error('el estado de la prueba no tiene un menú abierto');
  const despachar = vi.fn<(a: AccionConstructor) => void>();
  const r = render(<MenuMas vista={vista} despachar={despachar} />);
  return { vista, despachar, ...r };
}

const abrirDerecha = (flujo: Flujo, ancla = 'a1') => estadoCon(flujo, { k: 'abrirMenu', ancla, tipo: 'seq' });

describe('MenuMas', () => {
  it('constructor.menu_mas.dos_pasos_inicio_y_apps_con_su_titulo_y_sin_trampa_de_foco', () => {
    const { vista } = pintar(abrirDerecha(conAppSuelta()));
    // el paso de inicio: el diálogo se llama como su título y tiene las tres opciones
    const dialogo = screen.getByRole('dialog', { name: vista.titulo });
    expect(vista.titulo).toBe('Agregar después de «Agente 1»');
    expect(screen.getByRole('heading', { name: vista.titulo })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Una aplicación/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Un agente de IA/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Uno que ya está en el lienzo/ })).toBeInTheDocument();
    // no es modal: no atrapa el foco ni dice que el resto de la página esté inerte
    expect(dialogo).not.toHaveAttribute('aria-modal');
    // y se coloca donde dice la vista, dentro del lienzo
    expect(dialogo.parentElement).toHaveStyle({ left: `${vista.x}px`, top: `${vista.y}px` });
  });

  it('constructor.menu_mas.mide_300_pero_nunca_mas_que_la_ventana_para_caber_en_el_marco_a_320_px', () => {
    const { vista } = pintar(abrirDerecha(conAppSuelta()));
    const caja = screen.getByRole('dialog', { name: vista.titulo }).parentElement as HTMLElement;
    // a 320 px el marco visible del lienzo mide 288 y un menú de 300 se quedaba sin un borde; `max-w-full` se medía contra el lienzo entero
    expect(caja.className).toContain('w-75');
    expect(caja.className).toContain('max-w-[calc(100vw-48px)]');
    expect(caja.className).not.toContain('max-w-full');
  });

  it('constructor.menu_mas.la_nota_con_un_nombre_largo_sin_espacios_se_parte_en_vez_de_salirse_del_menu', () => {
    const largo = 'Ñ'.repeat(60);
    const f = conAppSuelta();
    f.nodes = f.nodes.map(n => (n.id === 'a1' && n.kind === 'agent' ? { ...n, nombre: largo } : n));
    const { vista } = pintar(estadoCon(f, { k: 'abrirMenu', ancla: 'a1', tipo: 'tool' }));
    if (vista.hayNota) expect(screen.getByText(vista.nota).className).toContain('[overflow-wrap:anywhere]');
    expect(screen.getByRole('heading', { name: vista.titulo }).className).toContain('[overflow-wrap:anywhere]');
  });

  it('constructor.menu_mas.cada_opcion_del_inicio_manda_su_accion', async () => {
    const user = userEvent.setup();
    const { despachar } = pintar(abrirDerecha(conAppSuelta()));

    await user.click(screen.getByRole('button', { name: /^Una aplicación/ }));
    expect(despachar).toHaveBeenLastCalledWith({ k: 'pasoMenu', paso: 'app' });

    await user.click(screen.getByRole('button', { name: /^Un agente de IA/ }));
    expect(despachar).toHaveBeenLastCalledWith({ k: 'crearDesdeMenu', que: 'agente' });

    await user.click(screen.getByRole('button', { name: /^Uno que ya está en el lienzo/ }));
    expect(despachar).toHaveBeenLastCalledWith({ k: 'iniciarConexion', ancla: 'a1', rol: 'origen', tipo: 'seq' });
    expect(despachar).toHaveBeenCalledTimes(3);
  });

  it('constructor.menu_mas.una_opcion_bloqueada_usa_aria_disabled_dice_el_motivo_y_su_clic_llega_al_reductor', async () => {
    const user = userEvent.setup();
    // ocho apps ya puestas: «Una aplicación» queda bloqueada por el tope
    const apps = Array.from({ length: TOPE_APPS }, (_, i) => app(i + 1, 616, 20 + i * 100));
    const flujo: Flujo = {
      nodes: [disparador(), agente(1, 312), ...apps],
      edges: [seq(1, 't1', 'a1'), ...apps.map((p, i) => seq(i + 2, 'a1', p.id))],
      nombreFlujo: 'Lleno de apps',
    };
    const estado = abrirDerecha(flujo);
    const { despachar } = pintar(estado);

    const bloqueada = screen.getByRole('button', { name: /^Una aplicación/ });
    // apagada SIN `disabled`: sigue en el orden de Tab y se puede enfocar para leerla
    expect(bloqueada).toHaveAttribute('aria-disabled', 'true');
    expect(bloqueada).not.toBeDisabled();
    expect(bloqueada).toHaveTextContent(T.topeApps().texto);
    bloqueada.focus();
    expect(bloqueada).toHaveFocus();

    // el clic llega y el reductor contesta con el tope (no avanza al paso de las apps)
    await user.click(bloqueada);
    expect(despachar).toHaveBeenCalledTimes(1);
    const accion = despachar.mock.calls[0]?.[0];
    expect(accion).toEqual({ k: 'crearDesdeMenu', que: 'app' });
    const despues = reducir(estado, accion as AccionConstructor);
    expect(despues.aviso?.texto).toBe(T.topeApps().texto);
    expect(despues.aviso?.tipo).toBe('mal');
    expect(despues.menu).toEqual(estado.menu);

    // los agentes sí tienen lugar: esa opción no está bloqueada
    expect(screen.getByRole('button', { name: /^Un agente de IA/ })).not.toHaveAttribute('aria-disabled');
  });

  it('constructor.menu_mas.un_agente_bloqueado_por_su_tope_dice_el_motivo_igual', async () => {
    const user = userEvent.setup();
    const agentes = Array.from({ length: TOPE_AGENTES }, (_, i) => agente(i + 1, 312 + i * 304));
    const flujo: Flujo = {
      nodes: [disparador(), ...agentes],
      edges: [seq(1, 't1', 'a1'), seq(2, 'a1', 'a2'), seq(3, 'a2', 'a3'), seq(4, 'a3', 'a4')],
      nombreFlujo: 'Cuatro agentes',
    };
    const estado = abrirDerecha(flujo, 'a4');
    const { despachar } = pintar(estado);
    const bloqueado = screen.getByRole('button', { name: /^Un agente de IA/ });
    expect(bloqueado).toHaveAttribute('aria-disabled', 'true');
    expect(bloqueado).toHaveTextContent(T.topeAgentes().texto);
    await user.click(bloqueado);
    expect(reducir(estado, despachar.mock.calls[0]?.[0] as AccionConstructor).aviso?.texto).toBe(T.topeAgentes().texto);
  });

  it('constructor.menu_mas.la_primera_opcion_no_bloqueada_y_la_primera_app_llevan_data_foco', async () => {
    const user = userEvent.setup();
    // con «Una aplicación» bloqueada, la que lleva el foco es «Un agente de IA»
    const apps = Array.from({ length: TOPE_APPS }, (_, i) => app(i + 1, 616, 20 + i * 100));
    const lleno: Flujo = { nodes: [disparador(), agente(1, 312), ...apps], edges: [seq(1, 't1', 'a1')], nombreFlujo: 'Lleno' };
    const a = pintar(abrirDerecha(lleno));
    const conFoco = a.container.querySelectorAll('[data-foco="1"]');
    expect(conFoco).toHaveLength(1);
    expect(conFoco[0]).toHaveTextContent(/^Un agente de IA/);
    a.unmount();

    // sin bloqueos, la primera es «Una aplicación»; y al pasar a las apps, la primera pastilla (Gmail)
    const b = pintar(abrirDerecha(conAppSuelta()));
    expect(b.container.querySelectorAll('[data-foco="1"]')).toHaveLength(1);
    expect(b.container.querySelector('[data-foco="1"]')).toHaveTextContent(/^Una aplicación/);
    b.unmount();

    const c = pintar(estadoCon(conAppSuelta(), { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' }, { k: 'pasoMenu', paso: 'app' }));
    const primera = c.container.querySelectorAll('[data-foco="1"]');
    expect(primera).toHaveLength(1);
    expect(primera[0]).toHaveTextContent('Gmail');
    expect(c.vista.apps[0]?.primera).toBe(true);
    // el foco que pide el reductor tiene a dónde ir: nada de lo que se toca aquí lo hace caer a <body>
    await user.tab();
    expect(document.body).not.toHaveFocus();
  });

  it('constructor.menu_mas.las_apps_son_pastillas_y_otra_app_se_agrega_con_el_boton_o_con_enter', async () => {
    const user = userEvent.setup();
    const { despachar, vista } = pintar(estadoCon(conAppSuelta(), { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' }, { k: 'pasoMenu', paso: 'app' }));
    expect(vista.esApp).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Elige la aplicación' })).toBeInTheDocument();
    // las diez apps con conector listo, una pastilla cada una
    const grupo = screen.getByRole('group', { name: 'Apps con conector listo' });
    expect(grupo.querySelectorAll('button')).toHaveLength(10);

    await user.click(screen.getByRole('button', { name: 'Slack' }));
    expect(despachar).toHaveBeenLastCalledWith({ k: 'crearDesdeMenu', que: 'app', nombreApp: 'Slack' });

    // «¿Otra app?»: el campo respeta el tope de largo del reductor y se agrega con el botón…
    const campo = screen.getByRole('textbox', { name: '¿Otra app? Escribe su nombre' });
    expect(campo).toHaveAttribute('maxlength', String(LARGO_NOMBRE_APP));
    await user.type(campo, 'HubSpot');
    await user.click(screen.getByRole('button', { name: 'Agregar' }));
    expect(despachar).toHaveBeenLastCalledWith({ k: 'crearDesdeMenu', que: 'app', nombreApp: 'HubSpot' });

    // …o con Enter, sin mandar nada más (el Enter no cierra ni manda un formulario)
    await user.clear(campo);
    await user.type(campo, 'Pipedrive{Enter}');
    expect(despachar).toHaveBeenLastCalledWith({ k: 'crearDesdeMenu', que: 'app', nombreApp: 'Pipedrive' });

    // sin escribir nada el botón también manda la acción: el reductor es quien dice «Escribe el nombre de la app.»
    await user.clear(campo);
    await user.click(screen.getByRole('button', { name: 'Agregar' }));
    expect(despachar).toHaveBeenLastCalledWith({ k: 'crearDesdeMenu', que: 'app', nombreApp: '' });
  });

  it('constructor.menu_mas.atras_vuelve_al_inicio_y_el_texto_de_otra_app_no_pasa_a_otro_menu', async () => {
    const user = userEvent.setup();
    const estado = estadoCon(conAppSuelta(), { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' }, { k: 'pasoMenu', paso: 'app' });
    const { despachar, rerender } = pintar(estado);
    await user.click(screen.getByRole('button', { name: 'Atrás' }));
    expect(despachar).toHaveBeenLastCalledWith({ k: 'pasoMenu', paso: 'inicio' });
    // el menú de lo que sigue no ofrece «Una app que ya está en el lienzo» en el paso de las apps (está en el inicio)
    expect(screen.queryByRole('button', { name: 'Una app que ya está en el lienzo' })).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '¿Otra app? Escribe su nombre' }), 'Algo');
    // el «+» cambia con el menú abierto (otra ancla): el campo nace vacío
    const otro = vistaMenu(estadoCon(conAppSuelta(), { k: 'abrirMenu', ancla: 't1', tipo: 'seq' }, { k: 'pasoMenu', paso: 'app' }));
    if (!otro) throw new Error('sin menú');
    rerender(<MenuMas vista={otro} despachar={despachar} />);
    expect(screen.getByRole('textbox', { name: '¿Otra app? Escribe su nombre' })).toHaveValue('');
  });

  it('constructor.menu_mas.esc_cierra_el_menu_desde_cualquier_parte_y_la_x_tambien', async () => {
    const user = userEvent.setup();
    const { despachar } = pintar(estadoCon(conAppSuelta(), { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' }, { k: 'pasoMenu', paso: 'app' }));
    // Esc con el foco en una pastilla
    screen.getByRole('button', { name: 'Gmail' }).focus();
    await user.keyboard('{Escape}');
    expect(despachar).toHaveBeenLastCalledWith({ k: 'cerrarMenu' });
    // Esc con el foco escribiendo en «¿Otra app?»
    await user.click(screen.getByRole('textbox', { name: '¿Otra app? Escribe su nombre' }));
    await user.keyboard('{Escape}');
    expect(despachar).toHaveBeenCalledTimes(2);
    expect(despachar).toHaveBeenLastCalledWith({ k: 'cerrarMenu' });
    // la X de 44 px
    const x = screen.getByRole('button', { name: 'Cerrar el menú' });
    await user.click(x);
    expect(despachar).toHaveBeenCalledTimes(3);
    expect(despachar).toHaveBeenLastCalledWith({ k: 'cerrarMenu' });
    // cualquier otra tecla no cierra
    await user.keyboard('{Tab}');
    expect(despachar).toHaveBeenCalledTimes(3);
  });

  it('constructor.menu_mas.el_menu_de_herramientas_abre_directo_en_apps_sin_atras_y_con_uno_que_ya_esta', async () => {
    const user = userEvent.setup();
    const { despachar, vista } = pintar(estadoCon(conAppSuelta(), { k: 'abrirMenu', ancla: 'a1', tipo: 'tool' }));
    expect(vista.tipo).toBe('tool');
    expect(screen.getByRole('dialog', { name: 'Darle una herramienta a «Agente 1»' })).toBeInTheDocument();
    // por la patita solo van apps: sin «Un agente de IA», sin «Atrás» y con la nota que lo explica
    expect(screen.queryByRole('button', { name: /^Un agente de IA/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Atrás' })).not.toBeInTheDocument();
    expect(screen.getByText(/Aquí solo van apps/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Una app que ya está en el lienzo' }));
    expect(despachar).toHaveBeenLastCalledWith({ k: 'iniciarConexion', ancla: 'a1', rol: 'origen', tipo: 'tool' });
  });

  it('constructor.menu_mas.se_trae_completo_a_la_vista_al_abrirse_y_sin_scroll_animado', () => {
    // jsdom no trae `scrollIntoView`: se pone uno de mentira solo durante esta prueba
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollIntoView });
    try {
      const a = pintar(abrirDerecha(conAppSuelta()));
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      // `nearest` en los dos ejes y SIN `behavior`: con «reducir movimiento» el desplazamiento no puede ser animado
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
      expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('dialog').parentElement);
      a.unmount();
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  });

  it('el menu de poner_en_medio_no_lleva_nota_ni_uno_que_ya_esta', () => {
    const estado = estadoCon(ejemplo(), { k: 'abrirMenu', ancla: 'a1', tipo: 'seq', insertarEn: 'e2' });
    const { vista } = pintar(estado);
    expect(vista.insertarEn).toBe('e2');
    expect(screen.getByRole('dialog', { name: 'Poner en medio' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Uno que ya está en el lienzo/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Una aplicación/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Un agente de IA/ })).toBeInTheDocument();
  });
});
