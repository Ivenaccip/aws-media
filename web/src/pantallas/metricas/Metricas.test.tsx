// Métricas, como COMPORTAMIENTO. Cada test empieza por el ID de su invariante
// (tests/test_migracion_ui.py); el mapa contra las aserciones de
// static/metricas.html está en docs/migracion/metricas.md.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { olvidarApariciones } from '../../nucleo/useAparecerUnaVez';
import { ponerObservador } from '../../prueba/observador';
import { json, servidor, sinRed, type Ruta } from '../../prueba/servidor';
import {
  BARRAS,
  barrasVistas,
  casillas,
  diaCorto,
  delta,
  duracion,
  num,
  rutaTramo,
  unir,
  valor,
  type Medida,
  type Publicacion,
  type Tramo,
} from './logica';
import { Metricas } from './Metricas';

const base = (id: string, red: string, extra: Partial<Publicacion> = {}): Publicacion => ({
  id,
  red,
  plataforma: red.toLowerCase(),
  cuando: '2026-09-20T15:00:00Z',
  estado: 'publicado',
  enlace: '',
  error_red: '',
  texto: 'Texto de ' + red,
  cortado: false,
  medios: 0,
  numeros: null,
  detalle: [],
  medido: '',
  historial: [],
  medicion: 'sin_consultar',
  motivo: 'Todavía no sabemos si tiene números.',
  puede_pedir: true,
  ...extra,
});

const MEDIDA = base('p1', 'Instagram', {
  numeros: { vistas: 1200, me_gusta: 30, comentarios: null, compartidos: 0 },
  detalle: [
    { clave: 'vistas', etiqueta: 'Vistas', tipo: 'entero', valor: 1200 },
    { clave: 'tiempo', etiqueta: 'Tiempo medio', tipo: 'ms', valor: 95000 },
    { clave: 'ratio', etiqueta: 'Retención', tipo: 'ratio', valor: 0.4567 },
  ],
  medido: '2026-09-22T10:00:00Z',
  historial: [
    { cuando: '2026-09-21T10:00:00Z', numeros: { vistas: 1240 } },
    { cuando: '2026-09-22T10:00:00Z', numeros: { vistas: 1200, me_gusta: 30 } },
  ],
  medicion: 'medido',
  motivo: '',
  puede_pedir: false,
  enlace: 'https://instagram.com/p/abc',
  medios: 2,
});
const SIN = base('p2', 'TikTok');
const FALLIDA = base('p3', 'Facebook', {
  estado: 'fallido',
  error_red: 'La red rechazó el video.',
  medicion: 'no_aplica',
  motivo: 'No llegó a publicarse, así que no hay números que medir.',
  puede_pedir: false,
});

const tramo = (extra: Partial<Tramo> = {}): Tramo => ({
  items: [MEDIDA, SIN, FALLIDA],
  mejores: [MEDIDA],
  cursor: null,
  desde: '2026-08-28T00:00:00Z',
  hasta: '2026-09-27T00:00:00Z',
  ultimo_tramo: false,
  hay_lista: true,
  hay_numeros: true,
  truncado: false,
  aviso: null,
  error: null,
  reconectar: false,
  ...extra,
});

const GETS = (f: ReturnType<typeof servidor>, ruta = '/api/metricas') =>
  f.mock.calls.filter(c => String(c[0]) === ruta || String(c[0]).startsWith(ruta + '?'));

const montar = (rutas: Record<string, Ruta>) => servidor(rutas);
const tarjeta = async (red: string) => (await screen.findByText(red, { selector: 'b' })).closest('li')!;

beforeEach(() => {
  vi.unstubAllGlobals();
  olvidarApariciones();
  document.title = 'Estudio de video · Métricas';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('metricas', () => {
  it('metricas.carga.una_llamada_al_abrir_y_ningun_sondeo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = montar({ '/api/metricas': () => json(tramo()) });
    render(
      <StrictMode>
        <Metricas />
      </StrictMode>,
    );
    await tarjeta('Instagram');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120000);
    });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('metricas.numeros.un_contador_que_no_llego_es_un_hueco_y_no_un_cero', async () => {
    expect(num(null)).toBe('');
    expect(num('306')).toBe('');
    expect(num(NaN)).toBe('');
    expect(num(0)).toBe('0');
    expect(num(12345)).toBe('12,345');
    expect(casillas({ vistas: 5, me_gusta: null, compartidos: 0 })).toEqual([
      ['5', 'Vistas'],
      ['0', 'Compartidos'],
    ]);
    montar({ '/api/metricas': () => json(tramo()) });
    render(<Metricas />);
    const li = await tarjeta('Instagram');
    expect(li).toHaveTextContent('1,200Vistas');
    expect(li).toHaveTextContent('30Me gusta');
    expect(li).toHaveTextContent('0Compartidos');
    expect(li).not.toHaveTextContent('Comentarios');
  });

  it('metricas.numeros.una_bajada_se_ensena_como_bajada', () => {
    expect(delta(MEDIDA)).toMatch(/^−40 vistas desde el .+ · 2 mediciones\.$/);
    expect(
      delta({ historial: [{ cuando: '2026-09-01', numeros: { vistas: 10 } }, { cuando: '2026-09-02', numeros: { vistas: 50 } }] }),
    ).toMatch(/^\+40 vistas/);
    expect(delta({ historial: [{ cuando: '2026-09-01', numeros: { vistas: 10 } }] })).toBe('Una sola medición.');
    expect(delta({ historial: [] })).toBe('');
  });

  it('metricas.numeros.los_milisegundos_no_se_ensenan_como_numero', () => {
    expect(duracion(95000)).toBe('1 min 35 s');
    expect(duracion(4000)).toBe('4 s');
    expect(duracion(3_720_000)).toBe('1 h 2 min');
    expect(duracion(-1)).toBe('');
    expect(valor({ etiqueta: 'R', tipo: 'ratio', valor: 0.4567 })).toBe('0.46');
    expect(valor({ etiqueta: 'V', tipo: 'entero', valor: null })).toBe('');
  });

  it('metricas.detalle.ver_el_resto_despliega_sin_llamar', async () => {
    const f = montar({ '/api/metricas': () => json(tramo()) });
    render(<Metricas />);
    const li = await tarjeta('Instagram');
    const b = within(li).getByRole('button', { name: 'Ver el resto' });
    expect(b).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(b);
    expect(within(li).getByRole('button', { name: 'Ocultar el resto' })).toHaveAttribute('aria-expanded', 'true');
    expect(li).toHaveTextContent('Todo lo que informó Instagram');
    expect(li).toHaveTextContent('Tiempo medio1 min 35 s');
    expect(li).toHaveTextContent('Retención0.46');
    expect(within(li).getByRole('table')).toBeInTheDocument();
    expect(within(li).getAllByRole('row')).toHaveLength(3);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('metricas.ver_numeros.solo_para_lo_que_no_sabemos_y_no_promete_actualizar', async () => {
    montar({ '/api/metricas': () => json(tramo()) });
    render(<Metricas />);
    expect(within(await tarjeta('TikTok')).getByRole('button', { name: 'Ver números' })).toBeInTheDocument();
    expect(within(await tarjeta('Facebook')).queryByRole('button')).toBeNull();
    expect(screen.queryByText(/Actualizar los números/)).toBeNull();
  });

  it('metricas.ver_numeros.escribe_en_las_dos_listas_y_el_boton_no_vuelve', async () => {
    const f = montar({
      '/api/metricas': () => json(tramo({ mejores: [MEDIDA, SIN] })),
      '/api/metricas/p2/numeros': () =>
        json({ id: 'p2', medicion: 'medido', motivo: '', numeros: { vistas: 77 }, detalle: [], medido: '2026-09-23T00:00:00Z', historial: [] }),
    });
    render(<Metricas />);
    await userEvent.click(within(await tarjeta('TikTok')).getByRole('button', { name: 'Ver números' }));
    expect(await screen.findByText('TikTok: 77 vistas.')).toBeInTheDocument();
    expect(await tarjeta('TikTok')).toHaveTextContent('77Vistas');
    expect(within(await tarjeta('TikTok')).queryByRole('button', { name: 'Ver números' })).toBeNull();
    // cambiar de vista no vuelve a preguntar: ya está escrito en las dos
    await userEvent.click(screen.getByRole('button', { name: 'Las más vistas' }));
    expect(await tarjeta('TikTok')).toHaveTextContent('77Vistas');
    expect(GETS(f, '/api/metricas/p2/numeros')).toHaveLength(1);
  });

  it('metricas.ver_numeros.no_se_pulsa_dos_veces_aunque_se_repinte', async () => {
    let soltar!: (r: Response) => void;
    const f = montar({
      '/api/metricas': () => json(tramo()),
      '/api/metricas/p2/numeros': () => new Promise<Response>(r => (soltar = r)),
    });
    render(<Metricas />);
    const li = await tarjeta('TikTok');
    await userEvent.click(within(li).getByRole('button', { name: 'Ver números' }));
    const b = within(li).getByRole('button', { name: 'Preguntando…' });
    expect(b).toBeDisabled();
    // repintar (desplegar otra tarjeta, cambiar de vista y volver) no lo revive
    await userEvent.click(within(await tarjeta('Instagram')).getByRole('button', { name: 'Ver el resto' }));
    await userEvent.click(screen.getByRole('button', { name: 'Las más vistas' }));
    await userEvent.click(screen.getByRole('button', { name: 'Recientes' }));
    expect(within(await tarjeta('TikTok')).getByRole('button', { name: 'Preguntando…' })).toBeDisabled();
    expect(GETS(f, '/api/metricas/p2/numeros')).toHaveLength(1);
    await act(async () =>
      soltar(json({ id: 'p2', medicion: 'aun_no', motivo: 'Blotato aún no la ha medido.', numeros: null, detalle: [], medido: '', historial: [] })),
    );
    expect(await screen.findByText('TikTok: Blotato aún no la ha medido.')).toBeInTheDocument();
  });

  it('metricas.ver_numeros.un_fallo_de_verdad_se_puede_reintentar', async () => {
    let n = 0;
    montar({
      '/api/metricas': () => json(tramo()),
      '/api/metricas/p2/numeros': () =>
        n++ === 0
          ? json({ detail: 'Blotato te pidió una pausa: vuelve a consultar en un minuto.' }, 429)
          : json({ id: 'p2', medicion: 'medido', numeros: { vistas: 3 }, detalle: [], medido: '', historial: [] }),
    });
    render(<Metricas />);
    await userEvent.click(within(await tarjeta('TikTok')).getByRole('button', { name: 'Ver números' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Blotato te pidió una pausa');
    await userEvent.click(within(await tarjeta('TikTok')).getByRole('button', { name: 'Ver números' }));
    expect(await screen.findByText('TikTok: 3 vistas.')).toBeInTheDocument();
  });

  it('metricas.vistas.cambiar_de_vista_no_llama_y_numera_el_top', async () => {
    const f = montar({ '/api/metricas': () => json(tramo({ mejores: [MEDIDA, SIN] })) });
    render(<Metricas />);
    await tarjeta('Instagram');
    const top = screen.getByRole('button', { name: 'Las más vistas' });
    expect(screen.getByRole('button', { name: 'Recientes' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(top);
    expect(top).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('listitem').map(li => li.textContent!.slice(0, 2))).toEqual(['1.', '2.']);
    expect(screen.getByText(/^Ordenadas por vistas/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ver más|Ver 30 días/ })).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
    // elegir no es ámbar
    expect(top.className).not.toMatch(/bg-ambar/);
  });

  it('metricas.tramo.ver_mas_manda_el_tramo_pegado_al_cursor', async () => {
    expect(rutaTramo(false, 'a', 'b', 'c')).toBe('/api/metricas');
    expect(rutaTramo(true, 'a', 'b', 'c/d')).toBe('/api/metricas?desde=a&hasta=b&cursor=c%2Fd');
    expect(rutaTramo(true, 'a', 'b', null)).toBe('/api/metricas?desde=a');
    // un cursor sin su tramo es un cursor de otra consulta: no viaja
    expect(rutaTramo(true, null, null, 'c')).toBe('/api/metricas');
    const f = montar({
      '/api/metricas': url =>
        url.includes('cursor=')
          ? json(tramo({ items: [FALLIDA], cursor: null }))
          : json(tramo({ items: [MEDIDA, SIN], cursor: 'k1' })),
    });
    render(<Metricas />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver más' }));
    await tarjeta('Facebook');
    expect(GETS(f)[1]![0]).toBe(
      '/api/metricas?desde=2026-08-28T00%3A00%3A00Z&hasta=2026-09-27T00%3A00%3A00Z&cursor=k1',
    );
    // sin cursor, retrocede 30 días desde el borde viejo
    await userEvent.click(screen.getByRole('button', { name: 'Ver 30 días más atrás' }));
    await waitFor(() => expect(GETS(f)).toHaveLength(3));
    expect(GETS(f)[2]![0]).toBe('/api/metricas?desde=2026-08-28T00%3A00%3A00Z');
  });

  it('metricas.tramo.ver_mas_se_apaga_en_el_ultimo_tramo_y_dice_el_tope', async () => {
    montar({ '/api/metricas': () => json(tramo({ ultimo_tramo: true })) });
    render(<Metricas />);
    await tarjeta('Instagram');
    expect(screen.queryByRole('button', { name: /Ver más|Ver 30 días/ })).toBeNull();
    expect(screen.getByText(/Métricas llega hasta un año atrás\./)).toBeInTheDocument();
  });

  it('metricas.tramo.la_misma_publicacion_en_dos_tramos_no_se_duplica', async () => {
    const otra = { ...SIN, texto: 'nuevo texto' };
    expect(unir([MEDIDA, SIN], [otra]).map(p => p.texto)).toEqual(['Texto de Instagram', 'nuevo texto']);
    // la repetición sin números NO pisa unos números que ya costaron una llamada
    const vacia = { ...MEDIDA, numeros: null, detalle: [], historial: [], medido: '', puede_pedir: true };
    const [u] = unir([MEDIDA], [vacia]);
    expect(u!.numeros).toEqual(MEDIDA.numeros);
    expect(u!.puede_pedir).toBe(false);
    montar({
      '/api/metricas': url =>
        url.includes('cursor=') ? json(tramo({ items: [vacia, FALLIDA] })) : json(tramo({ items: [MEDIDA], cursor: 'k' })),
    });
    render(<Metricas />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver más' }));
    await tarjeta('Facebook');
    expect(screen.getAllByText('Instagram', { selector: 'b' })).toHaveLength(1);
    expect(await tarjeta('Instagram')).toHaveTextContent('1,200Vistas');
  });

  it('metricas.fallos.un_fallo_blando_no_borra_lo_pintado_ni_el_cursor', async () => {
    let n = 0;
    montar({
      '/api/metricas': () =>
        n++ === 0
          ? json(tramo({ cursor: 'k' }))
          : json(
              tramo({ items: [], mejores: [], cursor: null, hay_lista: false, hay_numeros: false, error: 'Blotato no respondió.' }),
            ),
    });
    render(<Metricas />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver más' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Blotato no respondió.');
    expect(await tarjeta('Instagram')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver más' })).toBeEnabled();
  });

  it('metricas.fallos.un_fallo_duro_tampoco_y_nunca_en_ingles', async () => {
    let n = 0;
    montar({ '/api/metricas': () => (n++ === 0 ? json(tramo({ cursor: 'k' })) : sinRed()) });
    render(<Metricas />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver más' }));
    const a = await screen.findByRole('alert');
    expect(a).toHaveTextContent('No pudimos hablar con el servidor. Intenta de nuevo.');
    expect(a).not.toHaveTextContent(/fetch/i);
    expect(await tarjeta('Instagram')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver más' })).toBeEnabled();
  });

  it('metricas.fallos.sin_nada_pintado_dice_que_no_pudo', async () => {
    let n = 0;
    const f = montar({ '/api/metricas': () => (n++ === 0 ? json({ detail: 'Blotato falló.' }, 500) : json(tramo())) });
    render(<Metricas />);
    const a = await screen.findByRole('alert');
    expect(screen.getByText(/No pudimos traer tus publicaciones ahora/)).toBeInTheDocument();
    await userEvent.click(within(a).getByRole('button', { name: 'Reintentar' }));
    await tarjeta('Instagram');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('metricas.fallos.solo_el_409_o_reconectar_ofrecen_conectar', async () => {
    montar({ '/api/metricas': () => json({ detail: 'Conecta tu cuenta de Blotato.' }, 409) });
    const { unmount } = render(<Metricas />);
    expect(within(await screen.findByRole('alert')).getByRole('link', { name: 'Conectar Blotato' })).toHaveAttribute(
      'href',
      '/estudio/?blotato=conectar',
    );
    unmount();
    montar({
      '/api/metricas': () => json(tramo({ items: [], mejores: [], hay_lista: false, hay_numeros: false, error: 'Tu clave ya no sirve.', reconectar: true })),
    });
    render(<Metricas />);
    expect(within(await screen.findByRole('alert')).getByRole('link', { name: 'Conectar Blotato' })).toBeInTheDocument();
  });

  it('metricas.fallos.si_falla_una_llamada_la_otra_vista_conserva_lo_suyo', async () => {
    let n = 0;
    montar({
      '/api/metricas': () =>
        [
          json(tramo()),
          // fallan los números: «Las más vistas» se queda con lo que tenía
          json(tramo({ items: [SIN], mejores: [], hay_numeros: false, error: 'Los números fallaron.' })),
          // falla la lista: «Recientes» se queda con lo que tenía
          json(tramo({ items: [], hay_lista: false, mejores: [SIN], error: 'La lista falló.' })),
        ][n++]!,
    });
    render(<Metricas />);
    await tarjeta('Instagram');
    await userEvent.click(screen.getByRole('button', { name: 'Las más vistas' }));
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Los números fallaron.');
    expect(await tarjeta('Instagram')).toBeInTheDocument();
    expect(screen.queryByText(/No pudimos traer/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Recientes' }));
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La lista falló.');
    expect(await tarjeta('TikTok')).toBeInTheDocument();
    expect(screen.queryByText('Instagram', { selector: 'b' })).toBeNull();
  });

  it('metricas.tramo.las_mas_vistas_llevan_su_propio_tramo', async () => {
    let n = 0;
    montar({
      '/api/metricas': () =>
        n++ === 0
          ? json(tramo({ cursor: null }))
          : json(tramo({ desde: '2026-07-29T00:00:00Z', hasta: '2026-08-28T00:00:00Z', hay_numeros: false, mejores: [] })),
    });
    render(<Metricas />);
    await tarjeta('Instagram');
    await userEvent.click(screen.getByRole('button', { name: 'Ver 30 días más atrás' }));
    await waitFor(() => expect(screen.getByText(/^De lo más nuevo a lo más viejo\. Del 29 de julio al 28 de agosto\.$/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Las más vistas' }));
    // los números siguen siendo del tramo anterior: no se les pone la fecha nueva
    expect(screen.getByText(/^Ordenadas por vistas.+ Del 28 de agosto al 27 de septiembre\.$/)).toBeInTheDocument();
  });

  it('metricas.nota.el_recorte_no_es_un_error_y_lo_escribe_el_servidor', async () => {
    const aviso = 'Blotato solo nos dio los números de las 100 más vistas de este tramo.';
    montar({ '/api/metricas': () => json(tramo({ aviso, truncado: true })) });
    render(<Metricas />);
    const p = await screen.findByText(aviso);
    expect(p.closest('[role="alert"]')).toBeNull();
    expect(p.className).toMatch(/text-secundario/);
  });

  it('metricas.tarjeta.fallida_dice_no_salio_con_el_error_de_la_red_como_texto', async () => {
    const malo = '<img src=x onerror="alert(1)">';
    montar({ '/api/metricas': () => json(tramo({ items: [{ ...FALLIDA, error_red: malo, texto: malo, red: malo }], mejores: [] })) });
    const { container } = render(<Metricas />);
    const li = (await screen.findAllByText(malo, { exact: false }))[0]!.closest('li')!;
    expect(li).toHaveTextContent('No salió');
    expect(li).toHaveTextContent('No llegó a publicarse');
    expect(container.querySelector('img')).toBeNull();
  });

  it('metricas.tarjeta.el_enlace_solo_https_y_sin_regalar_la_pestana', async () => {
    montar({
      '/api/metricas': () =>
        json(tramo({ items: [MEDIDA, { ...SIN, enlace: 'javascript:alert(1)' }], mejores: [{ ...MEDIDA, id: 'p9', red: 'YouTube', enlace: 'http://x.com' }] })),
    });
    render(<Metricas />);
    const a = within(await tarjeta('Instagram')).getByRole('link', { name: 'Ver la publicación' });
    expect(a).toHaveAttribute('href', 'https://instagram.com/p/abc');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    expect(a).toHaveAttribute('target', '_blank');
    expect(within(await tarjeta('TikTok')).queryByRole('link')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Las más vistas' }));
    expect(within(await tarjeta('YouTube')).queryByRole('link')).toBeNull();
  });

  it('metricas.tarjeta.adjuntos_y_motivo_del_servidor', async () => {
    montar({ '/api/metricas': () => json(tramo()) });
    render(<Metricas />);
    expect(await tarjeta('Instagram')).toHaveTextContent('2 archivos');
    expect(await tarjeta('TikTok')).toHaveTextContent('Todavía no sabemos si tiene números.');
    expect(await tarjeta('TikTok')).not.toHaveTextContent('archivo');
  });

  it('metricas.carga.una_carga_a_la_vez', async () => {
    // mientras una carga viaja no sale otra: todo lo que carga se apaga (y lo
    // que llegara a pedirse igual se encolaría detrás)
    let soltar!: (r: Response) => void;
    let n = 0;
    const f = montar({
      '/api/metricas': () => (n++ === 0 ? json(tramo({ cursor: 'k' })) : new Promise<Response>(r => (soltar = r))),
    });
    render(<Metricas />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver más' }));
    for (const nombre of ['Actualizar', 'Ver más', 'Recientes', 'Las más vistas'])
      expect(screen.getByRole('button', { name: nombre })).toBeDisabled();
    expect(within(await tarjeta('Instagram')).getByRole('button', { name: 'Ver el resto' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(f).toHaveBeenCalledTimes(2);
    await act(async () => soltar(json(tramo())));
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeEnabled();
  });

  it('metricas.cobro.no_cobra_ni_pinta_ambar', async () => {
    montar({ '/api/metricas': () => json(tramo()) });
    render(<Metricas />);
    await tarjeta('Instagram');
    expect([...document.querySelectorAll('button')].filter(b => b.className.includes('bg-ambar'))).toHaveLength(0);
    expect(document.body).not.toHaveTextContent('✦');
  });

  it('metricas.marco.enlaces_estudio_y_version_anterior', async () => {
    montar({ '/api/metricas': () => json(tramo()) });
    render(<Metricas />);
    expect(screen.getByRole('link', { name: 'Usar la versión anterior' })).toHaveAttribute('href', '/ui/clasica?pantalla=metricas');
    expect(screen.getByRole('link', { name: 'Estudio' })).toHaveAttribute('href', '/estudio/');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Cómo rinden tus publicaciones');
    await tarjeta('Instagram');
  });
});

// UI·23 — la gráfica de «Cómo fue cambiando». jsdom no anima ni tiene
// IntersectionObserver: sin él, la gráfica tiene que estar COMPLETA.
describe('UI·23 · las barras de «Cómo fue cambiando»', () => {
  const medidas = (...vistas: (number | null)[]): Medida[] =>
    vistas.map((v, i) => ({ cuando: `2026-09-${String(10 + i).padStart(2, '0')}T10:00:00Z`, numeros: v === null ? null : { vistas: v } }));
  const grafica = (li: HTMLElement) => li.querySelector<HTMLElement>('[data-grafica]');
  const barras = (g: HTMLElement) => [...g.querySelectorAll<HTMLElement>('[data-barra]')];
  const abrir = async (red = 'Instagram') => {
    const li = await tarjeta(red);
    await userEvent.click(within(li).getByRole('button', { name: 'Ver el resto' }));
    return li;
  };

  it('UI·23: 500 ms por barra y 50 ms entre una y otra, con su porqué al lado', () => {
    // vitest no procesa CSS: se lee tal cual del disco
    const tokens = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../estilos/tokens.css'), 'utf8');
    expect(tokens).toMatch(/UI·23:[^*]+\*\/\s*--dur-grafica: 500ms;\s*--escalon-grafica: 50ms;/);
    expect(tokens).toContain('--animate-barra-crece: barra-crece var(--dur-grafica) var(--ease-salida)');
    expect(tokens).toContain('calc(var(--dur-grafica) + var(--i, 0) * var(--escalon-grafica)) both');
  });

  it('UI·23: un hueco no es una barra en cero, y solo se dibujan las últimas', () => {
    expect(barrasVistas(medidas(50, null, 100, 0))).toEqual({
      barras: [
        { cuando: '2026-09-10T10:00:00Z', vistas: 50, alto: 50 },
        { cuando: '2026-09-11T10:00:00Z', vistas: null, alto: 0 },
        { cuando: '2026-09-12T10:00:00Z', vistas: 100, alto: 100 },
        { cuando: '2026-09-13T10:00:00Z', vistas: 0, alto: 0 },
      ],
      de: 4,
    });
    // con una sola cifra no hay nada que comparar
    expect(barrasVistas(medidas(null, 7))).toBeNull();
    expect(barrasVistas([])).toBeNull();
    expect(barrasVistas(medidas(0, 0))!.barras.map(b => b.alto)).toEqual([0, 0]);
    // una cuenta negativa no se dibuja desde la base: hueco
    expect(barrasVistas(medidas(-3, 4, 8))!.barras.map(b => b.vistas)).toEqual([null, 4, 8]);
    const muchas = barrasVistas(medidas(1, 2, 3, 4, 5, 6, 7, 8, 9))!;
    expect(muchas.barras).toHaveLength(BARRAS);
    expect(muchas.barras.map(b => b.vistas)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(muchas.de).toBe(9);
  });

  it('UI·23: con cifras largas se dibujan menos barras, para que ninguna cifra pise a otra', () => {
    // «99,999» cabe en seis columnas de teléfono; «103,200» ya pide cinco
    expect(barrasVistas(medidas(10, 20, 30, 40, 50, 60, 99_999))!.barras).toHaveLength(6);
    const grandes = barrasVistas(medidas(1, 103_200, 245_100, 318_740, 412_050, 515_800, 998_230))!;
    expect(grandes.barras.map(b => b.vistas)).toEqual([245_100, 318_740, 412_050, 515_800, 998_230]);
    expect(grandes.de).toBe(7);
    expect(barrasVistas(medidas(1, 2, 3, 4, 5, 12_345_678))!.barras).toHaveLength(4);
    // lo que decide es la más larga de las que quedan: al soltar la de 7 caracteres vuelven a caber más
    expect(barrasVistas(medidas(1_000_000, 1, 2, 3, 4, 5))!.barras.map(b => b.vistas)).toEqual([1, 2, 3, 4, 5]);
  });

  it('UI·23: las barras tienen su altura final sin depender de la animación', async () => {
    montar({ '/api/metricas': () => json(tramo()) });
    render(<Metricas />);
    const li = await abrir();
    const g = grafica(li)!;
    // sin IntersectionObserver no hay marca: es el estado de una captura o de un lector
    expect(g).not.toHaveAttribute('data-entra');
    expect(g).toHaveAttribute('aria-hidden', 'true');
    const [a, b] = barras(g);
    // de la más vieja (1,240) a la más nueva (1,200): el alto es el final, no 0
    expect(a!.style.height).toBe('100%');
    expect(b!.style.height).toBe('96.8%');
    expect(a!.style.getPropertyValue('--i')).toBe('0');
    expect(b!.style.getPropertyValue('--i')).toBe('1');
    expect(a).toHaveTextContent('1,240');
    expect(b).toHaveTextContent('1,200');
    // y bajo cada una, su día
    expect(diaCorto('2026-09-21T10:00:00Z')).toMatch(/^21 sep/);
    expect(g).toHaveTextContent(diaCorto(MEDIDA.historial[0]!.cuando) + diaCorto(MEDIDA.historial[1]!.cuando));
    // la animación solo mueve scale y opacity, y solo bajo la marca y motion-safe
    expect(a!.firstElementChild!.className).toContain('motion-safe:in-data-entra:animate-barra-crece');
    expect(b!.querySelector('[data-final]')!.className).toContain('motion-safe:in-data-entra:animate-cifra-asoma');
    // la tabla se queda como estaba
    expect(within(li).getAllByRole('row')).toHaveLength(3);
  });

  it('UI·23: marcada para crecer, el alto sigue siendo el final', async () => {
    const IO = ponerObservador();
    montar({ '/api/metricas': () => json(tramo()) });
    render(<Metricas />);
    const li = await abrir();
    const g = grafica(li)!;
    IO.ultimo().cruzar();
    expect(g).toHaveAttribute('data-entra');
    expect(barras(g).map(b => b.style.height)).toEqual(['100%', '96.8%']);
  });

  it('UI·23: crece una sola vez: ni al cerrar y abrir, ni en «Las más vistas»', async () => {
    const IO = ponerObservador();
    montar({ '/api/metricas': () => json(tramo()) });
    render(<Metricas />);
    const li = await abrir();
    IO.ultimo().cruzar();
    expect(grafica(li)).toHaveAttribute('data-entra');
    const antes = IO.todos.length;
    await userEvent.click(within(li).getByRole('button', { name: 'Ocultar el resto' }));
    await userEvent.click(within(li).getByRole('button', { name: 'Ver el resto' }));
    expect(grafica(li)).not.toHaveAttribute('data-entra');
    // ya vista: ni siquiera se vuelve a mirar
    expect(IO.todos).toHaveLength(antes);
    await userEvent.click(screen.getByRole('button', { name: 'Las más vistas' }));
    expect(grafica(await tarjeta('Instagram'))).not.toHaveAttribute('data-entra');
    expect(IO.todos).toHaveLength(antes);
  });

  it('UI·23: sin dos cifras que comparar no hay gráfica, y la tabla sigue', async () => {
    const una = { ...MEDIDA, historial: medidas(null, 1200) };
    montar({ '/api/metricas': () => json(tramo({ items: [una], mejores: [] })) });
    render(<Metricas />);
    const li = await abrir();
    expect(li).toHaveTextContent('Cómo fue cambiando');
    expect(grafica(li)).toBeNull();
    expect(within(li).getByRole('table')).toBeInTheDocument();
  });

  it('UI·23: con más de seis mediciones dice cuáles dibuja', async () => {
    const larga = { ...MEDIDA, historial: medidas(10, 20, 30, 40, 50, 60, null, 80, 90) };
    montar({ '/api/metricas': () => json(tramo({ items: [larga], mejores: [] })) });
    render(<Metricas />);
    const g = grafica(await abrir())!;
    expect(g).toHaveTextContent('(las 6 más recientes de 9)');
    const b = barras(g);
    expect(b).toHaveLength(6);
    expect(b.map(x => x.style.getPropertyValue('--i'))).toEqual(['0', '1', '2', '3', '4', '5']);
    // el hueco no lleva ni barra ni cifra
    expect(b[3]!.childElementCount).toBe(0);
    // lo último que se mueve es la cifra de la última barra
    expect(g.querySelectorAll('[data-final]')).toHaveLength(1);
    expect(b[5]!.querySelector('[data-final]')).toHaveTextContent('90');
  });
});
