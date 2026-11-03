// La barra del Constructor como COMPORTAMIENTO, con el reductor de verdad detrás (arnesPaneles.tsx): el nombre edita con
// `renombrarFlujo`, «Deshacer» y «Descargar .json» se apagan con `aria-disabled` y siguen explicando al pulsarlos, «Limpiar»
// pregunta con `ui/Confirmar` y lo que limpia se puede deshacer, y el foco nunca cae a `<body>`.
// Cada test con ID (`constructor.barra.…`) es un invariante registrado.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { montar } from './arnesPaneles';
import { Barra } from './Barra';
import { ID_FALTAN } from './Guia';
import { LARGO_NOMBRE_FLUJO } from './modelo/datos/constantes';
import { ejemplo } from './modelo/ejemplos';
import { construirFlujo } from './modelo/exportar';
import { estadoInicial, reducir } from './modelo/reductor';
import { resumenFlujo } from './modelo/selectores';
import * as T from './modelo/textos';
import type { AccionConstructor, EstadoConstructor } from './modelo/tipos';
import { ID_PANEL_JSON } from './PanelJson';

const conEjemplo = () => estadoInicial(ejemplo());
const sinDisparador = (): EstadoConstructor => reducir(estadoInicial(ejemplo()), { k: 'quitarNodo', id: 't1' });
const descargar = () => screen.getByRole('button', { name: 'Descargar .json' });

describe('Barra', () => {
  it('constructor.barra.el_nombre_del_flujo_edita_con_renombrarflujo_y_respeta_el_tope', async () => {
    const user = userEvent.setup();
    const a = montar(conEjemplo());
    const campo = screen.getByRole('textbox', { name: 'Nombre del flujo' });
    expect(campo).toHaveValue('Atención a clientes');
    expect(campo).toHaveAttribute('maxlength', String(LARGO_NOMBRE_FLUJO));
    await user.clear(campo);
    await user.type(campo, 'Mi flujo');
    expect(a.acciones.filter(x => x.k === 'renombrarFlujo').at(-1)).toEqual({ k: 'renombrarFlujo', nombre: 'Mi flujo' });
    expect(a.estado().flujo.nombreFlujo).toBe('Mi flujo');
    expect(campo).toHaveValue('Mi flujo');
  });

  it('constructor.barra.deshacer_se_apaga_sin_disabled_explica_al_pulsarlo_y_se_enciende_tras_quitar', async () => {
    const user = userEvent.setup();
    const a = montar(conEjemplo());
    const deshacer = screen.getByRole('button', { name: 'Deshacer' });
    // nada que deshacer: apagado con aria-disabled, no con disabled (sigue en el orden de Tab)
    expect(deshacer).toHaveAttribute('aria-disabled', 'true');
    expect(deshacer).not.toBeDisabled();
    await user.click(deshacer);
    expect(a.acciones.at(-1)).toEqual({ k: 'deshacer' });
    expect(a.estado().aviso?.texto).toBe(T.nadaQueDeshacer().texto);

    // tras quitar un cuadro hay una foto: se enciende y repone lo quitado
    await user.click(screen.getByRole('button', { name: 'Quitar «Revisor»' }));
    expect(a.estado().flujo.nodes.some(n => n.id === 'a2')).toBe(false);
    expect(screen.getByRole('button', { name: 'Deshacer' })).not.toHaveAttribute('aria-disabled');
    await user.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(a.estado().flujo.nodes.some(n => n.id === 'a2')).toBe(true);
    expect(screen.getByRole('button', { name: 'Deshacer' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('constructor.barra.deshacer_y_descargar_apagados_con_el_lienzo_vacio_dicen_su_motivo_sin_pulsarlos', () => {
    // con el lienzo vacío «Te falta esto…» no se pinta (lo dice la tarjeta del disparador) y los dos botones apagados no explicaban nada
    montar(estadoInicial());
    expect(screen.getByRole('button', { name: 'Deshacer' })).toHaveAccessibleDescription('Todavía no hay nada que deshacer.');
    expect(descargar()).toHaveAccessibleDescription('Todavía no hay nada que descargar: primero elige cómo arranca tu flujo.');
    expect(descargar()).toHaveAttribute('aria-disabled', 'true');
  });

  it('constructor.barra.con_el_flujo_listo_o_con_algo_que_deshacer_los_botones_ya_no_traen_esas_descripciones', () => {
    // flujo completo y con algo que deshacer (se quitó «Slack»): ninguno de los dos está apagado, y no llevan descripción
    const listo = montar(reducir(conEjemplo(), { k: 'quitarNodo', id: 'p2' }));
    expect(descargar()).not.toHaveAttribute('aria-describedby');
    expect(screen.getByRole('button', { name: 'Deshacer' })).not.toHaveAttribute('aria-describedby');
    listo.unmount();
    // con cuadros pero sin disparador sí hay lista de lo que falta, y es la que describe a «Descargar .json» (no la línea escondida)
    montar(sinDisparador());
    expect(descargar()).toHaveAccessibleDescription(/Te falta esto para poder descargar/);
    expect(screen.queryByText('Todavía no hay nada que descargar: primero elige cómo arranca tu flujo.')).not.toBeInTheDocument();
  });

  it('constructor.barra.limpiar_pregunta_con_confirmar_y_cancelar_no_borra_nada', async () => {
    const user = userEvent.setup();
    const a = montar(conEjemplo());
    const limpiar = screen.getByRole('button', { name: 'Limpiar' });
    await user.click(limpiar);
    // la pregunta es de ui/Confirmar: un alertdialog con el foco en «Cancelar» y la acción como peligro
    const pregunta = await screen.findByRole('alertdialog', { name: '¿Limpiar todo el flujo?' });
    expect(within(pregunta).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    expect(pregunta).toHaveTextContent(/Deshacer/);
    // ninguna acción de limpiar salió todavía
    expect(a.acciones.some(x => x.k === 'limpiar')).toBe(false);

    await user.click(within(pregunta).getByRole('button', { name: 'Cancelar' }));
    expect(a.acciones.some(x => x.k === 'limpiar')).toBe(false);
    expect(a.estado().flujo.nodes).toHaveLength(5);
    // el foco vuelve al botón que preguntó
    await waitFor(() => expect(screen.getByRole('button', { name: 'Limpiar' })).toHaveFocus());

    // Esc tampoco borra
    await user.click(screen.getByRole('button', { name: 'Limpiar' }));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    expect(a.acciones.some(x => x.k === 'limpiar')).toBe(false);
    expect(a.estado().flujo.nodes).toHaveLength(5);
  });

  it('constructor.barra.confirmar_limpia_el_foco_va_a_elegir_el_disparador_y_se_puede_deshacer', async () => {
    const user = userEvent.setup();
    const a = montar(conEjemplo());
    await user.click(screen.getByRole('button', { name: 'Limpiar' }));
    await user.click(await screen.findByRole('button', { name: 'Limpiar todo' }));
    expect(a.acciones.filter(x => x.k === 'limpiar')).toHaveLength(1);
    expect(a.estado().flujo.nodes).toHaveLength(0);
    // el nombre se queda y el foco no cae a <body>: va a la primera opción de «Elige cómo arranca tu flujo»
    expect(a.estado().flujo.nombreFlujo).toBe('Atención a clientes');
    await waitFor(() => expect(document.querySelector('[data-foco="1"]')).toHaveFocus());
    expect(document.querySelector('[data-foco="1"]')).toHaveTextContent(/^Tiempo/);

    // limpiar se puede deshacer (D10): el botón de la barra lo repone
    await user.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(a.estado().flujo.nodes).toHaveLength(5);
  });

  it('constructor.barra.con_el_lienzo_vacio_limpiar_esta_apagado_y_dice_por_que', async () => {
    const user = userEvent.setup();
    const a = montar(estadoInicial());
    const limpiar = screen.getByRole('button', { name: 'Limpiar' });
    expect(limpiar).toHaveAttribute('aria-disabled', 'true');
    expect(limpiar).not.toBeDisabled();
    expect(limpiar).toHaveAccessibleDescription('No hay nada que limpiar todavía.');
    await user.click(limpiar);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(a.acciones.some(x => x.k === 'limpiar')).toBe(false);
  });

  it('constructor.barra.descargar_es_el_unico_boton_ambar_se_apaga_con_aria_disabled_y_enlaza_lo_que_falta', async () => {
    const user = userEvent.setup();
    // sin disparador: no se puede descargar y la lista «Te falta esto…» está a la vista
    const a = montar(sinDisparador());
    const boton = descargar();
    expect(boton).toHaveAttribute('aria-disabled', 'true');
    expect(boton).not.toBeDisabled();
    const faltan = document.getElementById(ID_FALTAN);
    expect(faltan).not.toBeNull();
    expect(boton).toHaveAttribute('aria-describedby', ID_FALTAN);
    expect(boton).toHaveAccessibleDescription(/Te falta esto para poder descargar/);
    // la lista es validación estática: no es una región viva (se anunciaría en cada edición)
    expect(faltan?.closest('[role="status"],[aria-live]')).toBeNull();
    // pulsarlo apagado llega a quien descarga, que es quien dice el primer error
    await user.click(boton);
    expect(a.alDescargar).toHaveBeenCalledTimes(1);
  });

  it('constructor.barra.descargar_listo_llama_una_vez_por_clic_y_es_el_principal', async () => {
    const user = userEvent.setup();
    const a = montar(conEjemplo());
    expect(resumenFlujo(a.estado()).puedeDescargar).toBe(true);
    const boton = descargar();
    expect(boton).not.toHaveAttribute('aria-disabled');
    expect(boton).not.toHaveAttribute('aria-describedby');
    expect(boton.className).toContain('bg-ambar');
    // los demás botones de la barra no son ámbar: uno solo por pantalla
    expect(document.querySelectorAll('button.bg-ambar')).toHaveLength(1);
    await user.click(boton);
    expect(a.alDescargar).toHaveBeenCalledTimes(1);
  });

  it('constructor.barra.ver_el_json_alterna_con_aria_expanded_y_enlaza_la_caja_solo_cuando_esta_abierta', async () => {
    const user = userEvent.setup();
    const a = montar(conEjemplo());
    const ver = screen.getByRole('button', { name: 'Ver el JSON' });
    expect(ver).toHaveAttribute('aria-expanded', 'false');
    expect(ver).not.toHaveAttribute('aria-controls');
    expect(document.getElementById(ID_PANEL_JSON)).toBeNull();

    await user.click(ver);
    const ocultar = screen.getByRole('button', { name: 'Ocultar el JSON' });
    expect(ocultar).toHaveAttribute('aria-expanded', 'true');
    expect(ocultar).toHaveAttribute('aria-controls', ID_PANEL_JSON);
    // la caja muestra el archivo que se bajaría
    const region = screen.getByRole('region', { name: 'JSON del flujo para n8n' });
    expect(document.getElementById(ID_PANEL_JSON)).toContainElement(region);
    expect(region.textContent).toBe(construirFlujo(a.estado().flujo).json);

    await user.click(ocultar);
    expect(screen.getByRole('button', { name: 'Ver el JSON' })).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(ID_PANEL_JSON)).toBeNull();
  });

  it('cada_boton_de_la_barra_manda_solo_lo_suyo', async () => {
    const user = userEvent.setup();
    const despachar = vi.fn<(a: AccionConstructor) => void>();
    const alDescargar = vi.fn();
    const alAlternarJson = vi.fn();
    render(
      <Barra
        nombreFlujo="Mi flujo"
        resumen={{ puedeDescargar: true, hayErrores: false }}
        puedeDeshacer
        hayCuadros
        jsonAbierto={false}
        despachar={despachar}
        alDescargar={alDescargar}
        alAlternarJson={alAlternarJson}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(despachar).toHaveBeenCalledTimes(1);
    expect(despachar).toHaveBeenLastCalledWith({ k: 'deshacer' });
    await user.click(screen.getByRole('button', { name: 'Ver el JSON' }));
    expect(alAlternarJson).toHaveBeenCalledTimes(1);
    await user.click(descargar());
    expect(alDescargar).toHaveBeenCalledTimes(1);
    expect(despachar).toHaveBeenCalledTimes(1);
  });
});
