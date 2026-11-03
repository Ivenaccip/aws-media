// La caja del JSON como COMPORTAMIENTO: muestra el archivo tal cual, se lee con el teclado, «Copiar el JSON» copia el texto exacto y
// lo dice (en la esquina, o en la página si no hay cuadro de avisos), y si el navegador no deja copiar, deja el texto seleccionado.
// Sin red ni almacenamiento. Cada test con ID (`constructor.panel_json.…`) es un invariante registrado.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ponerAvisos } from '../../prueba/servidor';
import { ID_PANEL_JSON, PanelJson } from './PanelJson';
import { ejemplo } from './modelo/ejemplos';
import { construirFlujo } from './modelo/exportar';
import * as T from './modelo/textos';

const JSON_EJEMPLO = construirFlujo(ejemplo()).json;
const SIN_JSON = 'Todavía no hay JSON. Te falta: elige cómo arranca el flujo.';

describe('PanelJson', () => {
  it('constructor.panel_json.muestra_el_archivo_tal_cual_en_una_region_que_se_enfoca_con_el_teclado', () => {
    render(<PanelJson json={JSON_EJEMPLO} textoSinJson={SIN_JSON} />);
    const region = screen.getByRole('region', { name: 'JSON del flujo para n8n' });
    // el texto es exactamente el que se bajaría, sin adornos
    expect(region.textContent).toBe(JSON_EJEMPLO);
    expect(region.querySelector('pre')).not.toBeNull();
    // la caja se desplaza por dentro: sin esto quien no usa ratón no podría leerla
    expect(region).toHaveAttribute('tabindex', '0');
    region.focus();
    expect(region).toHaveFocus();
    // y es la que enlaza el botón «Ver el JSON» de la barra
    expect(document.getElementById(ID_PANEL_JSON)).toContainElement(region);
  });

  it('constructor.panel_json.copiar_el_json_deja_el_texto_exacto_en_el_portapapeles_y_lo_dice_en_la_esquina', async () => {
    const user = userEvent.setup();
    const avisos = ponerAvisos();
    render(<PanelJson json={JSON_EJEMPLO} textoSinJson={SIN_JSON} />);
    await user.click(screen.getByRole('button', { name: 'Copiar el JSON' }));
    expect(await navigator.clipboard.readText()).toBe(JSON_EJEMPLO);
    // lo dice una sola vez, en la caja de avisos (con su clave, para que se reemplace y no se apile)
    expect(avisos.mostrar).toHaveBeenCalledTimes(1);
    expect(avisos.mostrar).toHaveBeenCalledWith(T.jsonCopiado().texto, { tipo: 'ok', clave: 'constructor-json' });
    // sin repetirlo en la página
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // el botón lo confirma con su nombre y con la palomita
    expect(screen.getByRole('button', { name: 'Copiado: el JSON' })).toHaveTextContent('Copiado');
  });

  it('constructor.panel_json.sin_cuadro_de_avisos_lo_dice_en_una_linea_de_la_propia_pagina', async () => {
    const user = userEvent.setup();
    expect(window.avisos).toBeUndefined();
    render(<PanelJson json={JSON_EJEMPLO} textoSinJson={SIN_JSON} />);
    await user.click(screen.getByRole('button', { name: 'Copiar el JSON' }));
    expect(await screen.findByRole('status')).toHaveTextContent(T.jsonCopiado().texto);
  });

  it('constructor.panel_json.si_el_navegador_no_deja_copiar_deja_el_texto_seleccionado_y_dice_como_seguir', async () => {
    const user = userEvent.setup();
    const avisos = ponerAvisos();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('sin permiso'));
    render(<PanelJson json={JSON_EJEMPLO} textoSinJson={SIN_JSON} />);
    await user.click(screen.getByRole('button', { name: 'Copiar el JSON' }));
    await vi.waitFor(() => expect(avisos.mostrar).toHaveBeenCalledTimes(1));
    expect(avisos.mostrar).toHaveBeenCalledWith(T.noSeCopio().texto, { tipo: 'mal', clave: 'constructor-json' });
    // el texto quedó seleccionado para Ctrl+C
    expect(window.getSelection()?.toString()).toContain('"nodes"');
    // y el botón NO dice «Copiado»
    expect(screen.getByRole('button', { name: 'Copiar el JSON' })).toBeInTheDocument();
  });

  it('constructor.panel_json.sin_json_dice_que_falta_apaga_copiar_con_aria_disabled_y_no_copia_nada', async () => {
    const user = userEvent.setup();
    const avisos = ponerAvisos();
    const escribir = vi.spyOn(navigator.clipboard, 'writeText');
    render(<PanelJson json={null} textoSinJson={SIN_JSON} />);
    expect(screen.getByRole('region', { name: 'JSON del flujo para n8n' })).toHaveTextContent(SIN_JSON);
    const copiar = screen.getByRole('button', { name: 'Copiar el JSON' });
    expect(copiar).toHaveAttribute('aria-disabled', 'true');
    expect(copiar).not.toBeDisabled();
    await user.click(copiar);
    expect(escribir).not.toHaveBeenCalled();
    // al pulsarlo dice por qué: el mismo texto de la caja
    expect(avisos.mostrar).toHaveBeenCalledWith(SIN_JSON, { tipo: 'mal', clave: 'constructor-json' });
  });

  it('el_boton_vuelve_a_decir_copiar_si_el_json_cambia', async () => {
    const user = userEvent.setup();
    ponerAvisos();
    const { rerender } = render(<PanelJson json={JSON_EJEMPLO} textoSinJson={SIN_JSON} />);
    await user.click(screen.getByRole('button', { name: 'Copiar el JSON' }));
    expect(await screen.findByRole('button', { name: 'Copiado: el JSON' })).toBeInTheDocument();
    // el flujo cambió: lo copiado ya no es lo que se ve
    rerender(<PanelJson json={JSON_EJEMPLO + ' '} textoSinJson={SIN_JSON} />);
    expect(screen.getByRole('button', { name: 'Copiar el JSON' })).toBeInTheDocument();
  });

  it('el_json_entra_como_texto_nunca_como_html', () => {
    const raro = '{"nombre":"<img src=x onerror=alert(1)>"}';
    render(<PanelJson json={raro} textoSinJson={SIN_JSON} />);
    expect(screen.getByRole('region', { name: 'JSON del flujo para n8n' })).toHaveTextContent(raro);
    expect(document.querySelector('img')).toBeNull();
  });
});
