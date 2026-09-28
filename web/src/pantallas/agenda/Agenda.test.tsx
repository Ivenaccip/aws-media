// La Agenda, como COMPORTAMIENTO. Cada test empieza por el ID de su
// invariante (tests/test_migracion_ui.py); el mapa contra las aserciones de
// static/agenda.html está en docs/migracion/agenda.md.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { simularSalida } from '../../prueba/salida';
import { json, llamadas, servidor, sinRed, type Ruta } from '../../prueba/servidor';
import { Agenda } from './Agenda';
import { validar, type Pagina, type Programada } from './logica';

const UNO: Programada = {
  id: 'sch_1',
  red: 'Instagram',
  cuenta_nombre: 'miCuenta',
  cuando: '2099-05-01T15:00:00Z',
  texto: 'Hola mundo',
  cortado: false,
  medios: 1,
};
const DOS: Programada = {
  id: 'sch_2',
  red: 'Facebook',
  cuenta_nombre: 'miMarca',
  destino: 'Página 2',
  cuando: '2099-05-02T15:00:00Z',
  texto: '',
  medios: 0,
};
const TRES: Programada = { id: 'sch_3', red: 'TikTok', cuando: '2099-05-03T15:00:00Z', texto: 'x'.repeat(200), cortado: true, medios: 3 };

const pagina = (items: Programada[], extra: Partial<Pagina> = {}): Pagina => ({
  items,
  cursor: null,
  total: items.length,
  error: null,
  reconectar: false,
  ...extra,
});

const GETS = (f: ReturnType<typeof servidor>) => f.mock.calls.filter(c => String(c[0]).startsWith('/api/agenda') && !c[1]?.method?.match(/POST/));
const cuerpo = (f: ReturnType<typeof servidor>, ruta: string, i = 0) =>
  JSON.parse(String(llamadas(f, ruta)[i]![1]!.body)) as Record<string, unknown>;

function montar(rutas: Record<string, Ruta>) {
  return servidor(rutas);
}

beforeEach(() => {
  vi.unstubAllGlobals();
  document.title = 'Estudio de video · Agenda';
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const tarjeta = async (red: string) => (await screen.findByText(red)).closest('li')!;

async function abrirHora(red = 'Instagram') {
  await userEvent.click(within(await tarjeta(red)).getByRole('button', { name: 'Cambiar la hora' }));
  return screen.findByRole('dialog', { name: 'Cambiar la hora' });
}

function ponerHora(valor: string) {
  fireEvent.change(screen.getByLabelText('Nueva fecha y hora'), { target: { value: valor } });
}

describe('agenda', () => {
  it('agenda.carga.una_sola_llamada_al_abrir_y_ningun_sondeo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = montar({ '/api/agenda': () => json(pagina([UNO])) });
    render(
      <StrictMode>
        <Agenda />
      </StrictMode>,
    );
    await tarjeta('Instagram');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120000);
    });
    expect(GETS(f)).toHaveLength(1);
  });

  it('agenda.lista.resumen_con_el_total_del_servidor', async () => {
    montar({ '/api/agenda': () => json(pagina([UNO, DOS], { total: 12 })) });
    render(<Agenda />);
    expect(await screen.findByText('12 publicaciones programadas')).toBeInTheDocument();
  });

  it('agenda.lista.ver_mas_agrega_al_final_con_el_cursor', async () => {
    const f = montar({
      '/api/agenda': url =>
        url.includes('cursor=') ? json(pagina([TRES], { total: 3 })) : json(pagina([UNO, DOS], { cursor: 'c/1', total: 3 })),
    });
    render(<Agenda />);
    await tarjeta('Facebook');
    await userEvent.click(screen.getByRole('button', { name: 'Ver más' }));
    await tarjeta('TikTok');
    expect(GETS(f).map(c => c[0])).toEqual(['/api/agenda', '/api/agenda?cursor=c%2F1']);
    expect(screen.getAllByRole('listitem').map(li => li.querySelector('b')!.textContent)).toEqual([
      'Instagram',
      'Facebook',
      'TikTok',
    ]);
    // sin cursor en la última página, «Ver más» se va
    expect(screen.queryByRole('button', { name: 'Ver más' })).toBeNull();
  });

  it('agenda.lista.ultima_pagina_vacia_apaga_ver_mas', async () => {
    montar({
      '/api/agenda': url => (url.includes('cursor=') ? json(pagina([], { total: 1 })) : json(pagina([UNO], { cursor: 'c1' }))),
    });
    render(<Agenda />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver más' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ver más' })).toBeNull());
    expect(await tarjeta('Instagram')).toBeInTheDocument();
  });

  it('agenda.lista.fallo_blando_conserva_tarjetas_total_y_cursor', async () => {
    montar({
      '/api/agenda': url =>
        url.includes('cursor=')
          ? json({ items: [], cursor: null, total: null, error: 'Blotato está saturado. Intenta en un minuto.', reconectar: false })
          : json(pagina([UNO], { cursor: 'c1', total: 5 })),
    });
    render(<Agenda />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver más' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Blotato está saturado. Intenta en un minuto.');
    expect(await tarjeta('Instagram')).toBeInTheDocument();
    expect(screen.getByText('5 publicaciones programadas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver más' })).toBeEnabled();
  });

  it('agenda.lista.fallo_sin_nada_pintado_dice_que_no_pudo_no_que_no_hay', async () => {
    montar({ '/api/agenda': () => json({ items: [], cursor: null, total: null, error: 'Blotato no respondió.', reconectar: false }) });
    render(<Agenda />);
    expect(await screen.findByText(/No pudimos traer tu agenda ahora/)).toBeInTheDocument();
    expect(screen.queryByText(/No tienes nada programado/)).toBeNull();
    expect(screen.getByText('Tus publicaciones programadas')).toBeInTheDocument();
  });

  it('agenda.lista.vacia_dice_como_programar', async () => {
    montar({ '/api/agenda': () => json(pagina([])) });
    render(<Agenda />);
    expect(await screen.findByText(/No tienes nada programado. Cuando programes un video desde el editor/)).toBeInTheDocument();
  });

  it('agenda.lista.recarga_pedida_durante_otra_se_encola', async () => {
    // cancelar dos seguidas: la recarga de la segunda llega con la de la
    // primera en vuelo. Se encola (no sale en paralelo ni se pierde)
    const gets: ((r: Response) => void)[] = [];
    const posts: ((r: Response) => void)[] = [];
    let n = 0;
    const f = montar({
      '/api/agenda': () => (n++ === 0 ? json(pagina([UNO, DOS])) : new Promise<Response>(r => gets.push(r))),
      '/api/agenda/cancelar': () => new Promise<Response>(r => posts.push(r)),
    });
    render(<Agenda />);
    for (const red of ['Instagram', 'Facebook']) {
      await userEvent.click(within(await tarjeta(red)).getByRole('button', { name: 'Cancelar' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Sí, cancelarla' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    }
    expect(posts).toHaveLength(2);
    await act(async () => posts[0]!(json({ cancelado: true })));
    await waitFor(() => expect(gets).toHaveLength(1));
    await act(async () => posts[1]!(json({ cancelado: true })));
    // la segunda recarga espera su turno
    expect(GETS(f)).toHaveLength(2);
    await act(async () => gets[0]!(json(pagina([DOS]))));
    await waitFor(() => expect(gets).toHaveLength(2));
    await act(async () => gets[1]!(json(pagina([]))));
    expect(await screen.findByText(/No tienes nada programado/)).toBeInTheDocument();
    expect(GETS(f)).toHaveLength(3);
  });

  it('agenda.lista.botones_apagados_mientras_recarga', async () => {
    let soltar: ((r: Response) => void) | null = null;
    let n = 0;
    montar({
      '/api/agenda': () => (n++ === 0 ? json(pagina([UNO], { cursor: 'c1' })) : new Promise<Response>(r => (soltar = r))),
    });
    render(<Agenda />);
    const li = await tarjeta('Instagram');
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ver más' })).toBeDisabled();
    expect(within(li).getByRole('button', { name: 'Cambiar la hora' })).toBeDisabled();
    expect(within(li).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await act(async () => soltar!(json(pagina([UNO]))));
    expect(within(await tarjeta('Instagram')).getByRole('button', { name: 'Cancelar' })).toBeEnabled();
  });

  it('agenda.lista.textos_de_blotato_como_texto', async () => {
    const malo = '<img src=x onerror="alert(1)">';
    montar({ '/api/agenda': () => json(pagina([{ ...UNO, red: malo, cuenta_nombre: malo, destino: malo, texto: malo }])) });
    const { container } = render(<Agenda />);
    expect((await screen.findAllByText(malo, { exact: false })).length).toBeGreaterThan(0);
    expect(container.querySelector('img')).toBeNull();
    // y nada del CDN de Blotato: ni una imagen, ni una URL
    expect(container.innerHTML).not.toMatch(/https?:\/\//);
  });

  it('agenda.tarjeta.destino_en_la_tarjeta_el_dialogo_y_la_confirmacion', async () => {
    montar({ '/api/agenda': () => json(pagina([UNO, DOS])) });
    render(<Agenda />);
    const li = await tarjeta('Facebook');
    expect(li).toHaveTextContent('Facebook · miMarca · Página 2');
    // sin destino no queda un « · » colgando
    expect(await tarjeta('Instagram')).not.toHaveTextContent(/miCuenta ·\s*·/);
    const dlg = await abrirHora('Facebook');
    expect(dlg).toHaveTextContent('Facebook · miMarca · Página 2');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Volver' }));
    await userEvent.click(within(li).getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Facebook · miMarca · Página 2');
  });

  it('agenda.tarjeta.puntos_suspensivos_los_decide_cortado', async () => {
    montar({ '/api/agenda': () => json(pagina([UNO, DOS, TRES])) });
    render(<Agenda />);
    expect(await tarjeta('TikTok')).toHaveTextContent('x'.repeat(200) + '…');
    expect(await tarjeta('Instagram')).toHaveTextContent('Hola mundo');
    expect(await tarjeta('Instagram')).not.toHaveTextContent('Hola mundo…');
    expect(await tarjeta('Facebook')).toHaveTextContent('Sin texto');
  });

  it('agenda.tarjeta.adjuntos_se_llaman_archivos_y_cero_no_se_pinta', async () => {
    montar({ '/api/agenda': () => json(pagina([UNO, DOS, TRES])) });
    render(<Agenda />);
    expect(await tarjeta('Instagram')).toHaveTextContent('1 archivo');
    expect(await tarjeta('TikTok')).toHaveTextContent('3 archivos');
    expect(await tarjeta('Facebook')).not.toHaveTextContent('archivo');
    expect(document.body).not.toHaveTextContent(/video/i);
  });

  it('agenda.errores.solo_el_409_ofrece_conectar_blotato', async () => {
    montar({ '/api/agenda': () => json({ detail: 'Conecta tu cuenta de Blotato para ver tu agenda.' }, 409) });
    const { unmount } = render(<Agenda />);
    const a = await screen.findByRole('alert');
    expect(a).toHaveTextContent('Conecta tu cuenta de Blotato para ver tu agenda.');
    expect(within(a).getByRole('link', { name: 'Conectar Blotato' })).toHaveAttribute('href', '/estudio/?blotato=conectar');
    unmount();
    montar({ '/api/agenda': () => json({ detail: 'Blotato falló.' }, 502) });
    render(<Agenda />);
    const b = await screen.findByRole('alert');
    expect(within(b).queryByRole('link', { name: 'Conectar Blotato' })).toBeNull();
    expect(within(b).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(screen.getByText(/No pudimos traer tu agenda ahora/)).toBeInTheDocument();
  });

  it('agenda.errores.clave_rechazada_al_listar_ofrece_conectar', async () => {
    montar({ '/api/agenda': () => json({ items: [], cursor: null, total: null, error: 'Blotato rechazó tu clave.', reconectar: true }) });
    render(<Agenda />);
    const a = await screen.findByRole('alert');
    expect(within(a).getByRole('link', { name: 'Conectar Blotato' })).toBeInTheDocument();
  });

  it('agenda.errores.sin_red_en_espanol_y_reintentar_recarga', async () => {
    let n = 0;
    const f = montar({ '/api/agenda': () => (n++ === 0 ? sinRed() : json(pagina([UNO]))) });
    render(<Agenda />);
    const a = await screen.findByRole('alert');
    expect(a).toHaveTextContent('No pudimos hablar con el servidor. Intenta de nuevo.');
    expect(a).not.toHaveTextContent(/fetch/i);
    await userEvent.click(within(a).getByRole('button', { name: 'Reintentar' }));
    await tarjeta('Instagram');
    expect(GETS(f)).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('agenda.hora.solo_manda_id_y_cuando_en_utc', async () => {
    const f = montar({ '/api/agenda': () => json(pagina([UNO])), '/api/agenda/reprogramar': () => json({ id: 'sch_1' }) });
    render(<Agenda />);
    await abrirHora();
    ponerHora('2099-06-01T10:30');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(llamadas(f, '/api/agenda/reprogramar')).toHaveLength(1));
    const c = cuerpo(f, '/api/agenda/reprogramar');
    expect(Object.keys(c).sort()).toEqual(['cuando', 'id']);
    expect(c.id).toBe('sch_1');
    expect(c.cuando).toBe(new Date('2099-06-01T10:30').toISOString());
    expect(String(c.cuando)).toMatch(/Z$/);
  });

  it('agenda.hora.fecha_vacia_o_pasada_no_llama_y_no_apaga_guardar', async () => {
    const f = montar({ '/api/agenda': () => json(pagina([UNO])), '/api/agenda/reprogramar': () => json({}) });
    render(<Agenda />);
    const dlg = await abrirHora();
    ponerHora('');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Guardar' }));
    expect(within(dlg).getByText('Elige la fecha y hora.')).toBeInTheDocument();
    ponerHora('2001-01-01T10:00');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Guardar' }));
    expect(within(dlg).getByText('Esa hora ya pasó: elige una más adelante.')).toBeInTheDocument();
    expect(screen.getByLabelText('Nueva fecha y hora')).toHaveAttribute('aria-invalid', 'true');
    expect(within(dlg).getByRole('button', { name: 'Guardar' })).toBeEnabled();
    expect(llamadas(f, '/api/agenda/reprogramar')).toHaveLength(0);
  });

  it('agenda.hora.menos_de_un_minuto_no_llama', () => {
    const ahora = new Date('2099-01-01T10:00:00').getTime();
    expect(validar('2099-01-01T10:00', ahora)).toMatch(/ya pasó/);
    expect(validar('2099-01-01T10:00:30', ahora)).toMatch(/menos de un minuto/);
    expect(validar('2099-01-01T10:01', ahora)).toBeNull();
    expect(validar('no-es-fecha', ahora)).toBe('Esa fecha no es válida.');
  });

  it('agenda.hora.el_minimo_del_campo_lleva_el_margen', async () => {
    montar({ '/api/agenda': () => json(pagina([UNO])) });
    render(<Agenda />);
    const antes = Date.now();
    await abrirHora();
    const min = new Date(screen.getByLabelText('Nueva fecha y hora').getAttribute('min')!).getTime();
    // truncado al minuto: entre (ahora + 60 s − 1 min) y (ahora + 60 s)
    expect(min).toBeGreaterThan(antes + 60000 - 60000 - 1);
    expect(min).toBeLessThanOrEqual(Date.now() + 60000);
    expect(screen.getByLabelText('Nueva fecha y hora')).toHaveValue(
      new Date(new Date(UNO.cuando).getTime() - new Date(UNO.cuando).getTimezoneOffset() * 60000).toISOString().slice(0, 16),
    );
    expect(screen.getByLabelText('Nueva fecha y hora')).toHaveFocus();
  });

  it('agenda.hora.el_404_cierra_repinta_y_avisa_con_el_texto_del_servidor', async () => {
    let n = 0;
    const f = montar({
      '/api/agenda': () => json(pagina(n++ === 0 ? [UNO, DOS] : [DOS])),
      '/api/agenda/reprogramar': () => json({ detail: 'Esa publicación ya salió o ya no está programada.' }, 404),
    });
    render(<Agenda />);
    await abrirHora();
    ponerHora('2099-06-01T10:30');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('alert')).toHaveTextContent('Esa publicación ya salió o ya no está programada.');
    expect(screen.queryByText('Instagram')).toBeNull();
    expect(GETS(f)).toHaveLength(2);
  });

  it('agenda.hora.otro_fallo_se_queda_en_el_dialogo', async () => {
    montar({
      '/api/agenda': () => json(pagina([UNO])),
      '/api/agenda/reprogramar': () => json({ detail: 'Blotato no aceptó esa hora.' }, 502),
    });
    render(<Agenda />);
    const dlg = await abrirHora();
    ponerHora('2099-06-01T10:30');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Guardar' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Blotato no aceptó esa hora.');
    expect(within(dlg).getByRole('button', { name: 'Guardar' })).toBeEnabled();
  });

  it('agenda.hora.cerrar_mientras_guarda_el_fallo_va_a_la_pantalla', async () => {
    let soltar!: (r: Response) => void;
    montar({
      '/api/agenda': () => json(pagina([UNO])),
      '/api/agenda/reprogramar': () => new Promise<Response>(r => (soltar = r)),
    });
    render(<Agenda />);
    const dlg = await abrirHora();
    ponerHora('2099-06-01T10:30');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Guardar' }));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await act(async () => soltar(json({ detail: 'Blotato no respondió.' }, 502)));
    expect(await screen.findByRole('alert')).toHaveTextContent('Blotato no respondió.');
  });

  it('agenda.hora.una_respuesta_tardia_no_cierra_el_dialogo_de_otra', async () => {
    const sueltas: ((r: Response) => void)[] = [];
    const f = montar({
      '/api/agenda': () => json(pagina([UNO, DOS])),
      '/api/agenda/reprogramar': () => new Promise<Response>(r => sueltas.push(r)),
    });
    render(<Agenda />);
    await abrirHora('Instagram');
    ponerHora('2099-06-01T10:30');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const dlg = await abrirHora('Facebook');
    ponerHora('2099-07-07T07:07');
    // llega tarde la de Instagram: el diálogo de Facebook sigue, con lo escrito
    await act(async () => sueltas[0]!(json({ id: 'sch_1' })));
    expect(screen.getByRole('dialog', { name: 'Cambiar la hora' })).toBe(dlg);
    expect(screen.getByLabelText('Nueva fecha y hora')).toHaveValue('2099-07-07T07:07');
    expect(cuerpo(f, '/api/agenda/reprogramar').id).toBe('sch_1');
  });

  it('agenda.hora.el_doble_clic_no_cierra_el_dialogo_recien_abierto', async () => {
    montar({ '/api/agenda': () => json(pagina([UNO])) });
    render(<Agenda />);
    let t = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    await abrirHora();
    const velo = () => document.querySelector('.fixed.inset-0')!;
    // el segundo clic cae en el velo a los 100 ms: no cierra
    t += 100;
    await userEvent.pointer({ keys: '[MouseLeft]', target: velo() });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // un clic de verdad en el velo, más tarde, sí
    t += 1000;
    await userEvent.pointer({ keys: '[MouseLeft]', target: velo() });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('agenda.hora.el_exito_se_anuncia_y_el_foco_no_cae_al_body', async () => {
    montar({ '/api/agenda': () => json(pagina([UNO])), '/api/agenda/reprogramar': () => json({ id: 'sch_1' }) });
    render(<Agenda />);
    await abrirHora();
    ponerHora('2099-06-01T10:30');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    const ok = await screen.findByText(/^Hora cambiada: Instagram sale el .+ \(tu hora\)\.$/);
    expect(ok.closest('[role="status"]')).not.toBeNull();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('agenda.cancelar.la_confirmacion_arranca_en_no_y_decir_no_no_llama', async () => {
    const f = montar({ '/api/agenda': () => json(pagina([UNO])), '/api/agenda/cancelar': () => json({}) });
    render(<Agenda />);
    const li = await tarjeta('Instagram');
    await userEvent.click(within(li).getByRole('button', { name: 'Cancelar' }));
    const c = await screen.findByRole('alertdialog', { name: '¿Cancelar esta publicación?' });
    expect(c).toHaveTextContent('Instagram · miCuenta');
    expect(c).toHaveTextContent('(tu hora)');
    expect(c).toHaveTextContent('«Hola mundo»');
    expect(c).toHaveTextContent('No se puede deshacer');
    expect(within(c).getByRole('button', { name: 'No, dejarla' })).toHaveFocus();
    await userEvent.click(within(c).getByRole('button', { name: 'No, dejarla' }));
    expect(llamadas(f, '/api/agenda/cancelar')).toHaveLength(0);
    expect(within(li).getByRole('button', { name: 'Cancelar' })).toBeEnabled();
  });

  it('agenda.cancelar.manda_confirmar_true_anuncia_y_devuelve_el_foco', async () => {
    let n = 0;
    let soltar!: (r: Response) => void;
    const f = montar({
      '/api/agenda': () => json(pagina(n++ === 0 ? [UNO] : [])),
      '/api/agenda/cancelar': () => new Promise<Response>(r => (soltar = r)),
    });
    render(<Agenda />);
    const li = await tarjeta('Instagram');
    await userEvent.click(within(li).getByRole('button', { name: 'Cancelar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sí, cancelarla' }));
    // mientras viaja, esa tarjeta no se puede volver a cancelar
    await waitFor(() => expect(within(li).getByRole('button', { name: 'Cancelar' })).toBeDisabled());
    expect(cuerpo(f, '/api/agenda/cancelar')).toEqual({ id: 'sch_1', confirmar: true });
    await act(async () => soltar(json({ id: 'sch_1', cancelado: true })));
    const ok = await screen.findByText('Publicación cancelada.');
    expect(ok.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByText('Instagram')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actualizar' })).toHaveFocus());
  });

  it('agenda.cancelar.el_404_recarga_y_despues_avisa', async () => {
    let n = 0;
    montar({
      '/api/agenda': () => json(pagina(n++ === 0 ? [UNO] : [])),
      '/api/agenda/cancelar': () => json({ detail: 'La lista ya está al día.' }, 404),
    });
    render(<Agenda />);
    await userEvent.click(within(await tarjeta('Instagram')).getByRole('button', { name: 'Cancelar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sí, cancelarla' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La lista ya está al día.');
    expect(screen.queryByText('Instagram')).toBeNull();
  });

  it('agenda.cancelar.el_409_ofrece_conectar', async () => {
    montar({
      '/api/agenda': () => json(pagina([UNO])),
      '/api/agenda/cancelar': () => json({ detail: 'Blotato rechazó tu clave: conéctala de nuevo.' }, 409),
    });
    render(<Agenda />);
    await userEvent.click(within(await tarjeta('Instagram')).getByRole('button', { name: 'Cancelar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sí, cancelarla' }));
    const a = await screen.findByRole('alert');
    expect(within(a).getByRole('link', { name: 'Conectar Blotato' })).toBeInTheDocument();
  });

  it('agenda.cobro.no_cobra_ni_pinta_ambar_fuera_del_dialogo', async () => {
    montar({ '/api/agenda': () => json(pagina([UNO])) });
    render(<Agenda />);
    await tarjeta('Instagram');
    const ambar = [...document.querySelectorAll('button')].filter(b => b.className.includes('bg-ambar'));
    expect(ambar).toHaveLength(0);
    expect(document.body).not.toHaveTextContent('✦');
    const dlg = await abrirHora();
    expect([...dlg.querySelectorAll('button')].filter(b => b.className.includes('bg-ambar')).map(b => b.textContent)).toEqual([
      'Guardar',
    ]);
  });

  it('agenda.marco.enlaces_estudio_y_version_anterior', async () => {
    montar({ '/api/agenda': () => json(pagina([])) });
    render(<Agenda />);
    expect(screen.getByRole('link', { name: 'Usar la versión anterior' })).toHaveAttribute('href', '/ui/clasica?pantalla=agenda');
    expect(screen.getByRole('link', { name: 'Estudio' })).toHaveAttribute('href', '/estudio/');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Agenda tus publicaciones');
    await screen.findByText(/No tienes nada programado/);
  });
});

describe('UI·20 · el diálogo tarda 100 ms en irse', () => {
  it('cancelar con respuesta instantánea: al terminar la salida, el foco va a «Actualizar» y no al body', async () => {
    const salida = simularSalida();
    let n = 0;
    montar({
      '/api/agenda': () => json(pagina(n++ === 0 ? [UNO] : [])),
      '/api/agenda/cancelar': () => json({ id: 'sch_1', cancelado: true }),
    });
    render(<Agenda />);
    await userEvent.click(within(await tarjeta('Instagram')).getByRole('button', { name: 'Cancelar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sí, cancelarla' }));
    await screen.findByText('Publicación cancelada.');
    // la tarjeta que abrió el diálogo ya no existe cuando la caja termina de irse
    salida.terminar();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actualizar' })).toHaveFocus());
  });
});
