// La copiadora de estilos, como COMPORTAMIENTO. Cada test empieza por el ID
// de su invariante (tests/test_migracion_ui.py).
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { json, llamadas, oirCobros, ponerMonedero, servidor, sinRed } from '../../prueba/servidor';
import { simularVT } from '../../prueba/transicion';
import { Estilos } from './Estilos';
import type { Listado, Perfil } from './logica';

const LISTO: Perfil = {
  id: 'ig-abc',
  estado: 'listo',
  fuente: { autor: 'lacuenta', plataforma: 'instagram' },
  metrica: { duracion_s: 12, cortes_por_min: 30 },
  paleta: [
    // un color de la PALETA M20: el guardián de colores lee también los tests
    { hex: '#0b1626', pct: 60 },
    { hex: 'red;background:url(x)', pct: 40 },
  ],
  perfil: { tipografia: 'Sans', captions: 'Grandes', iluminacion: 'Cálida', estetica: 'Film', tono: 'Íntimo', prompt_estilo: 'warm film look' },
};
const VIVO: Perfil = { id: 'tt-123', estado: 'analizando', plataforma: 'tiktok' };
const TARIFA = 7; // falsa a propósito: el botón tiene que decir la del server

const listado = (estilos: Perfil[]): Listado => ({ estilos, creditos: TARIFA });

let monedero: ReturnType<typeof ponerMonedero>;
beforeEach(() => {
  vi.unstubAllGlobals();
  monedero = ponerMonedero(100);
  document.title = 'Estudio de video · Copiadora de estilos';
});
afterEach(() => {
  vi.useRealTimers();
  delete window.monedero;
});

const escribir = (t: string) => userEvent.type(screen.getByLabelText('Liga de Instagram o TikTok'), t);

describe('estilos', () => {
  it('estilos.cobro.precio_del_servidor_en_el_boton', async () => {
    servidor({ '/api/estilo': () => json(listado([])) });
    render(<Estilos />);
    expect(await screen.findByRole('button', { name: `Analizar ✦ ${TARIFA}` })).toBeInTheDocument();
  });

  it('estilos.cobro.doble_clic_un_solo_post', async () => {
    let soltar!: (r: Response) => void;
    const f = servidor({
      '/api/estilo': () => json(listado([])),
      '/api/estilo/analizar': () => new Promise<Response>(r => (soltar = r)),
    });
    render(<Estilos />);
    await escribir('https://www.instagram.com/reel/abcdef');
    const b = await screen.findByRole('button', { name: /Analizar ✦/ });
    await userEvent.dblClick(b);
    await userEvent.click(b);
    expect(llamadas(f, '/api/estilo/analizar')).toHaveLength(1);
    expect(JSON.parse(String(llamadas(f, '/api/estilo/analizar')[0]![1]!.body))).toEqual({
      url: 'https://www.instagram.com/reel/abcdef',
    });
    await act(async () => soltar(json({ lanzado: true, id: 'ig-abcdef', creditos: TARIFA })));
  });

  it('estilos.cobro.el_sondeo_no_reabre_el_boton_con_el_cobro_en_vuelo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let soltar!: (r: Response) => void;
    const f = servidor({
      '/api/estilo': () => json(listado([VIVO])),
      '/api/estilo/analizar': () => new Promise<Response>(r => (soltar = r)),
    });
    render(<Estilos />);
    await escribir('https://www.tiktok.com/@a/video/123456789');
    const b = await screen.findByRole('button', { name: /Analizar ✦/ });
    await userEvent.click(b);
    // pasan varias vueltas del sondeo mientras el POST sigue sin respuesta
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(screen.getByRole('button', { name: 'Analizando…' })).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Analizando…' }));
    expect(llamadas(f, '/api/estilo/analizar')).toHaveLength(1);
    await act(async () => soltar(json({ lanzado: true, id: 'x', creditos: TARIFA })));
  });

  it('estilos.cobro.sin_liga_no_cobra', async () => {
    const cobros = oirCobros();
    const f = servidor({ '/api/estilo': () => json(listado([])) });
    render(<Estilos />);
    await userEvent.click(await screen.findByRole('button', { name: /Analizar ✦/ }));
    expect(screen.getByText('Pega la liga primero.')).toBeInTheDocument();
    expect(llamadas(f, '/api/estilo/analizar')).toHaveLength(0);
    expect(cobros).toEqual([]);
  });

  it('estilos.cobro.error_junto_al_boton', async () => {
    const cobros = oirCobros();
    servidor({
      '/api/estilo': () => json(listado([])),
      '/api/estilo/analizar': () => json({ detail: 'Ese video ya tiene su perfil de estilo — está en tu lista' }, 409),
    });
    render(<Estilos />);
    await escribir('https://www.instagram.com/reel/abcdef');
    await userEvent.click(await screen.findByRole('button', { name: /Analizar ✦/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ese video ya tiene su perfil de estilo');
    expect(screen.getByLabelText('Liga de Instagram o TikTok')).toHaveValue('https://www.instagram.com/reel/abcdef');
    expect(cobros).toEqual([]);
  });

  it('estilos.cobro.sin_saldo_con_la_recarga_cerrada_dice_a_quien_escribir', async () => {
    const cobros = oirCobros();
    monedero.recarga = false;
    servidor({
      '/api/estilo': () => json(listado([])),
      '/api/estilo/analizar': () => json({ detail: 'Te faltan 2 créditos' }, 402),
    });
    render(<Estilos />);
    await escribir('https://www.instagram.com/reel/abcdef');
    await userEvent.click(await screen.findByRole('button', { name: /Analizar ✦/ }));
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Te faltan 2 créditos');
    expect(alerta).toHaveTextContent('Escríbenos por el canal de la comunidad');
    expect(screen.queryByRole('button', { name: 'Recargar' })).not.toBeInTheDocument();
    expect(cobros).toEqual([]);
  });

  it('estilos.cobro.limpia_y_refresca_el_saldo_tras_cobrar', async () => {
    const cobros = oirCobros();
    servidor({
      '/api/estilo': () => json(listado([])),
      '/api/estilo/analizar': () => json({ lanzado: true, id: 'x', creditos: TARIFA }),
    });
    render(<Estilos />);
    await escribir('https://www.instagram.com/reel/abcdef');
    await userEvent.click(await screen.findByRole('button', { name: /Analizar ✦/ }));
    await waitFor(() => expect(screen.getByLabelText('Liga de Instagram o TikTok')).toHaveValue(''));
    expect(monedero.refrescar).toHaveBeenCalled();
    await waitFor(() => expect(cobros).toEqual([expect.objectContaining({ costo: TARIFA })]));
  });

  it('estilos.lista.perfil_listo_con_sus_campos', async () => {
    servidor({ '/api/estilo': () => json(listado([LISTO])) });
    render(<Estilos />);
    expect(await screen.findByText('@lacuenta')).toBeInTheDocument();
    expect(screen.getByText('instagram · 12 s · 30 cortes/min')).toBeInTheDocument();
    expect(screen.getByText('Film')).toBeInTheDocument();
    expect(screen.getByText('warm film look')).toBeInTheDocument();
  });

  it('estilos.lista.solo_colores_de_verdad_entran_al_style', async () => {
    servidor({ '/api/estilo': () => json(listado([LISTO])) });
    render(<Estilos />);
    const paleta = await screen.findByRole('img', { name: 'Paleta' });
    const franjas = paleta.querySelectorAll('span');
    expect(franjas).toHaveLength(1);
    expect(franjas[0]!.getAttribute('title')).toBe('#0b1626 · 60%');
  });

  it('estilos.lista.textos_del_server_como_texto', async () => {
    servidor({ '/api/estilo': () => json(listado([{ ...LISTO, fuente: { autor: '<img src=x onerror=alert(1)>' } }])) });
    const { container } = render(<Estilos />);
    expect(await screen.findByText('@<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img[src="x"]')).toBeNull();
  });

  it('estilos.lista.error_dice_que_los_creditos_volvieron', async () => {
    servidor({ '/api/estilo': () => json(listado([{ id: 'ig-x', estado: 'error', plataforma: 'instagram', error: 'privado' }])) });
    render(<Estilos />);
    expect(await screen.findByText('El análisis falló (privado) — tus créditos se devolvieron.')).toBeInTheDocument();
  });

  it('estilos.lista.copiar_el_prompt_y_su_fallo', async () => {
    servidor({ '/api/estilo': () => json(listado([LISTO])) });
    const escribirPortapapeles = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escribirPortapapeles }, configurable: true });
    render(<Estilos />);
    await userEvent.click(await screen.findByRole('button', { name: 'Copiar' }));
    expect(escribirPortapapeles).toHaveBeenCalledWith('warm film look');
    expect(await screen.findByText('Copiado')).toBeInTheDocument();
    escribirPortapapeles.mockRejectedValueOnce(new Error('no'));
    await userEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    expect(await screen.findByText('No se pudo copiar. Selecciona el texto y cópialo a mano.')).toBeInTheDocument();
  });

  it('estilos.lista.sondea_mientras_analiza_y_para_al_terminar', async () => {
    const cobros = oirCobros();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let estilos: Perfil[] = [VIVO];
    const f = servidor({ '/api/estilo': () => json(listado(estilos)) });
    render(<Estilos />);
    await screen.findByText(/Analizando el estilo/);
    const gets = () => llamadas(f, '/api/estilo', 'GET').length;
    const antes = gets();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(gets()).toBe(antes + 1);
    estilos = [{ ...LISTO, id: VIVO.id }];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    const alTerminar = gets();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(gets()).toBe(alTerminar);
    expect(monedero.refrescar).toHaveBeenCalled();
    expect(cobros).toEqual([]); // una devolución no vuela como un cobro
  });

  it('estilos.lista.sin_red_con_un_analisis_vivo_sigue_reintentando', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let red = true;
    const f = servidor({ '/api/estilo': () => (red ? json(listado([VIVO])) : sinRed()) });
    render(<Estilos />);
    await screen.findByText(/Analizando el estilo/);
    red = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByText('Sin conexión — reintentando… Tu análisis sigue en la nube.')).toBeInTheDocument();
    // la tarjeta sigue ahí y el sondeo no murió
    expect(screen.getByText(/Analizando el estilo/)).toBeInTheDocument();
    const antes = llamadas(f, '/api/estilo', 'GET').length;
    red = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(llamadas(f, '/api/estilo', 'GET').length).toBeGreaterThan(antes);
    expect(screen.queryByText(/Sin conexión/)).not.toBeInTheDocument();
  });

  it('estilos.lista.fallo_de_carga_avisa_y_reintenta', async () => {
    let red = false;
    servidor({ '/api/estilo': () => (red ? json(listado([LISTO])) : sinRed()) });
    render(<Estilos />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos traer tus perfiles de estilo.');
    expect(screen.queryByText('Cargando…')).not.toBeInTheDocument();
    red = true;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('@lacuenta')).toBeInTheDocument();
  });

  it('estilos.espera.titulo_de_la_pestana_dice_analizando', async () => {
    servidor({ '/api/estilo': () => json(listado([VIVO])) });
    render(<Estilos />);
    await waitFor(() => expect(document.title).toBe('Analizando el estilo · Estudio de video · Copiadora de estilos'));
  });

  it('estilos.marco.enlace_estudio_sin_version_anterior', async () => {
    servidor({ '/api/estilo': () => json(listado([])) });
    render(<Estilos />);
    expect(screen.queryByRole('link', { name: 'Usar la versión anterior' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Estudio' })).toHaveAttribute('href', '/estudio/');
    await screen.findByRole('button', { name: /Analizar ✦/ });
  });
});

// UI·21 — re-analizar un perfil lo sube a la cima: viaja, no salta. Los
// nombres NO son IDs de invariante (tests/test_migracion_ui.py).
describe('UI·21 · la lista de perfiles', () => {
  const FALLIDO: Perfil = { id: 'tt-999', estado: 'error', plataforma: 'tiktok', error: 'privado' };
  const filas = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('.fila-viva'));
  // el primer texto del título: «@autor» si está listo, el id si no
  const orden = (c: HTMLElement) => filas(c).map(f => f.querySelector('h3')?.firstChild?.textContent);

  it('UI·21: re-analizar sube el perfil a la cima dentro de UNA transición «reordenar», sin filas que entren', async () => {
    let estilos: Perfil[] = [LISTO, FALLIDO];
    servidor({
      '/api/estilo': () => json(listado(estilos)),
      '/api/estilo/analizar': () => {
        estilos = [{ id: 'tt-999', estado: 'analizando', plataforma: 'tiktok' }, LISTO];
        return json({ lanzado: true, id: 'tt-999', creditos: TARIFA });
      },
    });
    const vt = simularVT();
    const { container } = render(<Estilos />);
    await screen.findByText('@lacuenta');
    expect(orden(container)).toEqual(['@lacuenta', 'tt-999']);
    const filaFallida = filas(container)[1];
    await escribir('https://www.tiktok.com/@a/video/999');
    await userEvent.click(await screen.findByRole('button', { name: /Analizar ✦/ }));
    await waitFor(() => expect(orden(container)).toEqual(['tt-999', '@lacuenta']));
    expect(vt.espia).toHaveBeenCalledOnce();
    expect(vt.tipos).toEqual([['reordenar']]);
    expect(container.querySelectorAll('.fila-entra')).toHaveLength(0);
    // es la MISMA fila (viaja), no una que se desmonta y vuelve a montar
    expect(filas(container)[0]).toBe(filaFallida);
    expect(screen.getByText(/Analizando el estilo/)).toBeInTheDocument();
  });

  it('UI·21: sin View Transitions el reorden se pinta igual, al instante', async () => {
    let estilos: Perfil[] = [LISTO, FALLIDO];
    servidor({
      '/api/estilo': () => json(listado(estilos)),
      '/api/estilo/analizar': () => {
        estilos = [{ id: 'tt-999', estado: 'analizando', plataforma: 'tiktok' }, LISTO];
        return json({ lanzado: true, id: 'tt-999', creditos: TARIFA });
      },
    });
    const { container } = render(<Estilos />);
    await screen.findByText('@lacuenta');
    await escribir('https://www.tiktok.com/@a/video/999');
    await userEvent.click(await screen.findByRole('button', { name: /Analizar ✦/ }));
    await waitFor(() => expect(orden(container)).toEqual(['tt-999', '@lacuenta']));
    expect(container.querySelectorAll('.fila-entra')).toHaveLength(0);
  });

  it('UI·21: un perfil nuevo arriba entra abriendo su espacio, sin transición', async () => {
    let estilos: Perfil[] = [LISTO];
    servidor({
      '/api/estilo': () => json(listado(estilos)),
      '/api/estilo/analizar': () => {
        estilos = [VIVO, LISTO];
        return json({ lanzado: true, id: VIVO.id, creditos: TARIFA });
      },
    });
    const vt = simularVT();
    const { container } = render(<Estilos />);
    await screen.findByText('@lacuenta');
    expect(container.querySelectorAll('.fila-entra')).toHaveLength(0);
    await escribir('https://www.tiktok.com/@a/video/123');
    await userEvent.click(await screen.findByRole('button', { name: /Analizar ✦/ }));
    await waitFor(() => expect(orden(container)).toEqual(['tt-123', '@lacuenta']));
    expect(vt.espia).not.toHaveBeenCalled();
    expect(filas(container)[0]).toHaveClass('fila-entra');
    expect(filas(container)[1]).not.toHaveClass('fila-entra');
  });

  it('UI·21: el perfil que queda listo con la página abierta enciende su detalle; el que ya estaba no', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const OTRO: Perfil = { ...LISTO, id: 'ig-otro', fuente: { autor: 'otra', plataforma: 'instagram' }, metrica: { duracion_s: 9, cortes_por_min: 12 } };
    let estilos: Perfil[] = [VIVO, OTRO];
    servidor({ '/api/estilo': () => json(listado(estilos)) });
    render(<Estilos />);
    expect(await screen.findByText('instagram · 9 s · 12 cortes/min')).not.toHaveClass('destello');
    estilos = [{ ...LISTO, id: VIVO.id }, OTRO];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(await screen.findByText('instagram · 12 s · 30 cortes/min')).toHaveClass('destello');
    expect(screen.getByText('instagram · 9 s · 12 cortes/min')).not.toHaveClass('destello');
  });
});
