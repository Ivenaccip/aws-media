// Shorts, como COMPORTAMIENTO (docs/PLAN-UI.md §5). Cada test empieza por el
// ID de su invariante: tests/test_migracion_ui.py exige que cada ID del
// registro exista aquí.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { json, llamadas, oirCobros, ponerMonedero, servidor, sinRed, type Ruta } from '../../prueba/servidor';
import type { Candidato, Costo, Proyecto } from './logica';
import { Shorts } from './Shorts';

// precios que no existen en tarifas.json: si alguien los escribe en el cliente, fallan
const COSTO: Costo = {
  duracion_s: 1260,
  con_transcript: false,
  creditos_analizar: 7,
  creditos_por_short: 3,
  backend_listo: true,
  aviso: null,
};

const cand = (i: number): Candidato => ({
  score: 9 - i * 0.5,
  texto: `Candidato ${i + 1}`,
  razon: `Por qué ${i + 1}`,
  start: 10 * i,
  end: 10 * i + 30,
  hook_line1: `Gancho ${i + 1}`,
  hook_line2: '',
});
const CANDS = [0, 1, 2, 3].map(cand);

const SIN_ANALISIS: Proyecto = { shorts: null, fuente: 'usuarios/u/podcast/crudo.mp4', importar: null, creditos_por_short: 3, cdn: 'https://cdn.ejemplo' };
const ANALIZANDO: Proyecto = { ...SIN_ANALISIS, shorts: { estado: 'analizando' } };
const CANDIDATOS: Proyecto = {
  ...SIN_ANALISIS,
  shorts: { estado: 'candidatos', candidatos: CANDS, listo: '2026-09-26T10:00:00Z' },
};
const RENDERIZANDO: Proyecto = {
  ...CANDIDATOS,
  shorts: { ...CANDIDATOS.shorts!, render: { estado: 'corriendo' } },
};
const RENDER_LISTO: Proyecto = {
  ...CANDIDATOS,
  shorts: {
    ...CANDIDATOS.shorts!,
    render: {
      estado: 'listo',
      salidas: [
        { archivo: 'short-1.mp4', bytes: 12_400_000, url: 'https://cdn.ejemplo/usuarios/u/podcast/short-1.mp4' },
        { archivo: 'short-2.mp4', bytes: 9_000_000, url: 'javascript:alert(1)', key: 'usuarios/u/podcast/short-2.mp4' },
      ],
    },
  },
};

class XhrFalso {
  static todos: XhrFalso[] = [];
  status = 0;
  upload: { onprogress: ((ev: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    XhrFalso.todos.push(this);
  }
  open() {}
  setRequestHeader() {}
  send() {}
  abort() {
    this.onabort?.();
  }
  terminar(status = 200) {
    this.status = status;
    this.onload?.();
  }
}

interface Mundo {
  proyecto?: () => Proyecto | Promise<Response>;
  costo?: () => Costo | Promise<Response>;
  proyectos?: unknown[] | null;
  rutas?: Record<string, Ruta>;
}

function montar({ proyecto = () => SIN_ANALISIS, costo = () => COSTO, proyectos = [], rutas = {} }: Mundo = {}) {
  const r = (x: unknown) => (x instanceof Promise ? x : json(x));
  return servidor({
    '/api/media/config': () => json({ activo: true, cdn: 'https://cdn.ejemplo' }),
    '/api/media/presign': (_u, init) => {
      const b = JSON.parse(String(init?.body)) as { proyecto: string; content_type: string };
      return json({ url: 'https://s3.ejemplo/x', key: `usuarios/u/${b.proyecto}/crudo.mp4`, content_type: b.content_type });
    },
    '/api/media/confirmar': () => json({ archivo: 'crudo.mp4', cdn: 'https://cdn.ejemplo/crudo.mp4' }),
    '/api/edicion/proyectos': () => (proyectos ? json(proyectos) : sinRed()),
    '/api/shorts': () => r(proyecto()),
    '/api/shorts/podcast/costo': () => r(costo()),
    '/api/shorts/importar/cotizar': () =>
      json({ titulo: 'Entrevista larga', duracion_s: 1800, nombre: 'yt-abc123', creditos: 11 }),
    ...rutas,
  });
}

function irA(p: string | null) {
  history.replaceState(null, '', p === null ? '/estudio/shorts/' : '/estudio/shorts/?p=' + encodeURIComponent(p));
}

const esperar = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

let monedero: ReturnType<typeof ponerMonedero>;

beforeEach(() => {
  vi.unstubAllGlobals();
  XhrFalso.todos = [];
  vi.stubGlobal('XMLHttpRequest', XhrFalso);
  monedero = ponerMonedero(100);
  irA('podcast');
  document.title = 'Estudio de video · Shorts';
});

afterEach(() => {
  vi.useRealTimers();
  delete window.monedero;
});

async function cotizarLiga(url = 'https://www.youtube.com/watch?v=abc123') {
  await userEvent.type(await screen.findByLabelText('Liga de YouTube'), url);
  await userEvent.click(screen.getByRole('button', { name: 'Cotizar' }));
}

describe('analizar', () => {
  it('shorts.cobro.analizar_con_el_precio_del_servidor', async () => {
    montar();
    render(<Shorts />);
    expect(await screen.findByRole('button', { name: 'Analizar ✦ 7' })).toBeInTheDocument();
    expect(screen.getByText(/El video dura 21.0 min/)).toHaveTextContent('Incluye la transcripción en nube');
  });

  it('shorts.cobro.analizar_doble_clic_un_solo_post', async () => {
    let soltar!: (r: Response) => void;
    const f = montar({ rutas: { '/api/shorts/podcast/analizar': () => new Promise<Response>(r => (soltar = r)) } });
    render(<Shorts />);
    const b = await screen.findByRole('button', { name: 'Analizar ✦ 7' });
    await userEvent.dblClick(b);
    await userEvent.click(b);
    expect(llamadas(f, '/api/shorts/podcast/analizar')).toHaveLength(1);
    await act(async () => soltar(json({ lanzado: true, creditos: 7 })));
  });

  it('shorts.cobro.el_sondeo_no_reabre_analizar_con_el_cobro_en_vuelo', async () => {
    // con un render corriendo hay sondeo; la vieja volvía a encender
    // «Re-analizar» en cada vuelta aunque su cobro siguiera en vuelo
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = montar({
      proyecto: () => RENDERIZANDO,
      rutas: { '/api/shorts/podcast/analizar': () => new Promise<Response>(() => undefined) },
    });
    render(<Shorts />);
    fireEvent.click(await screen.findByRole('button', { name: 'Re-analizar ✦ 7' }));
    await esperar(5000);
    await esperar(5000);
    fireEvent.click(screen.getByRole('button', { name: /Lanzando/ }));
    expect(llamadas(f, '/api/shorts/podcast/analizar')).toHaveLength(1);
  });

  it('shorts.cobro.sin_backend_listo_analizar_apagado_con_el_aviso', async () => {
    montar({ costo: () => ({ ...COSTO, backend_listo: false, aviso: 'un video tan corto no da para shorts' }) });
    render(<Shorts />);
    expect(await screen.findByRole('button', { name: 'Analizar ✦ 7' })).toBeDisabled();
    expect(screen.getByText(/un video tan corto no da para shorts/)).toBeInTheDocument();
  });

  it('shorts.cobro.sin_precio_no_hay_boton_de_analizar', async () => {
    montar({ costo: () => Promise.resolve(json({ detail: 'Este proyecto no tiene metraje' }, 404)) });
    render(<Shorts />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Este proyecto no tiene metraje');
    expect(screen.queryByRole('button', { name: /Analizar/ })).toBeNull();
  });

  it('shorts.analisis.orbe_solo_en_el_analisis', async () => {
    montar({ proyecto: () => ANALIZANDO });
    const { unmount } = render(<Shorts />);
    expect(await screen.findByText('Analizando tu video · transcript y candidatos')).toBeInTheDocument();
    expect(screen.getByText('Puedes cerrar la página: el análisis sigue en la nube.')).toBeInTheDocument();
    unmount();
    // el render es Remotion componiendo, no la IA pensando: sin orbe
    montar({ proyecto: () => RENDERIZANDO });
    render(<Shorts />);
    expect(await screen.findByText(/Renderizando en la nube/)).toBeInTheDocument();
    expect(screen.queryByText(/Analizando tu video/)).toBeNull();
  });

  it('shorts.analisis.error_dice_que_los_creditos_volvieron_sin_orbe', async () => {
    montar({ proyecto: () => ({ ...SIN_ANALISIS, shorts: { estado: 'error', error: 'sin audio' } }) });
    render(<Shorts />);
    expect(await screen.findByText('El análisis falló (sin audio) — tus créditos se devolvieron.')).toBeInTheDocument();
    expect(screen.queryByText(/Analizando tu video/)).toBeNull();
    expect(await screen.findByRole('button', { name: 'Analizar ✦ 7' })).toBeEnabled();
  });
});

describe('renderizar', () => {
  it('shorts.cobro.renderizar_n_por_el_precio_del_servidor', async () => {
    montar({ proyecto: () => CANDIDATOS });
    render(<Shorts />);
    // los tres mejores marcados de entrada: 3 × 3
    expect(await screen.findByRole('button', { name: 'Renderizar ✦ 9' })).toBeInTheDocument();
    expect(screen.getByText('3 shorts marcados.')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Usar el candidato 1'));
    expect(screen.getByRole('button', { name: 'Renderizar ✦ 6' })).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Usar el candidato 2'));
    await userEvent.click(screen.getByLabelText('Usar el candidato 3'));
    expect(screen.getByRole('button', { name: 'Renderizar' })).toBeDisabled();
    expect(screen.getByText('Marca al menos un candidato.')).toBeInTheDocument();
  });

  it('shorts.cobro.renderizar_sin_precio_del_servidor_no_cobra', async () => {
    montar({ proyecto: () => ({ ...CANDIDATOS, creditos_por_short: undefined }) as unknown as Proyecto });
    render(<Shorts />);
    await screen.findByText('Candidato 1');
    expect(screen.queryByRole('button', { name: /Renderizar ✦/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Renderizar' })).toBeDisabled();
  });

  it('shorts.cobro.renderizar_manda_lo_elegido_y_ajustado', async () => {
    const f = montar({ proyecto: () => CANDIDATOS, rutas: { '/api/shorts/podcast/render': () => json({ lanzado: true, creditos: 6 }) } });
    render(<Shorts />);
    await screen.findByRole('button', { name: 'Renderizar ✦ 9' });
    await userEvent.click(screen.getByLabelText('Usar el candidato 3'));
    const fin = screen.getByLabelText('fin del candidato 2');
    await userEvent.clear(fin);
    await userEvent.type(fin, '42.5');
    const gancho = screen.getByLabelText('gancho del candidato 1');
    await userEvent.clear(gancho);
    await userEvent.type(gancho, 'Nadie te lo dice');
    await userEvent.selectOptions(screen.getByLabelText('Estilo'), 'clean');
    await userEvent.selectOptions(screen.getByLabelText('Plataforma'), 'tiktok');
    await userEvent.selectOptions(screen.getByLabelText('Contenido'), 'podcast');
    await userEvent.click(screen.getByRole('button', { name: 'Renderizar ✦ 6' }));
    await waitFor(() => expect(llamadas(f, '/api/shorts/podcast/render')).toHaveLength(1));
    expect(JSON.parse(String(llamadas(f, '/api/shorts/podcast/render')[0]![1]!.body))).toEqual({
      shorts: [
        { start: 0, end: 30, hook_line1: 'Nadie te lo dice', hook_line2: '' },
        { start: 10, end: 42.5, hook_line1: 'Gancho 2', hook_line2: '' },
      ],
      estilo: 'clean',
      plataforma: 'tiktok',
      tipo: 'podcast',
    });
  });

  it('shorts.cobro.renderizar_doble_clic_un_solo_post', async () => {
    let soltar!: (r: Response) => void;
    const f = montar({ proyecto: () => CANDIDATOS, rutas: { '/api/shorts/podcast/render': () => new Promise<Response>(r => (soltar = r)) } });
    render(<Shorts />);
    const b = await screen.findByRole('button', { name: 'Renderizar ✦ 9' });
    await userEvent.dblClick(b);
    await userEvent.click(b);
    expect(llamadas(f, '/api/shorts/podcast/render')).toHaveLength(1);
    await act(async () => soltar(json({ lanzado: true, creditos: 9 })));
  });

  it('shorts.cobro.tiempos_fuera_de_rango_no_cobran', async () => {
    const cobros = oirCobros();
    const f = montar({ proyecto: () => CANDIDATOS });
    render(<Shorts />);
    await screen.findByRole('button', { name: 'Renderizar ✦ 9' });
    const fin = screen.getByLabelText('fin del candidato 1');
    await userEvent.clear(fin);
    await userEvent.type(fin, '3');
    expect(screen.getByText('Cada short dura entre 5 y 90 s (este dura 3.0 s).')).toBeInTheDocument();
    expect(fin).toHaveAttribute('aria-invalid', 'true');
    const b = screen.getByRole('button', { name: 'Renderizar ✦ 9' });
    expect(b).toBeDisabled();
    await userEvent.click(b);
    expect(llamadas(f, '/api/shorts/podcast/render')).toHaveLength(0);
    expect(cobros).toEqual([]);
  });

  it('shorts.cobro.mas_de_diez_no_cobra', async () => {
    const once = Array.from({ length: 11 }, (_, i) => cand(i));
    montar({ proyecto: () => ({ ...CANDIDATOS, shorts: { estado: 'candidatos', candidatos: once, listo: 'x' } }) });
    render(<Shorts />);
    await screen.findByRole('button', { name: 'Renderizar ✦ 9' });
    for (let i = 4; i <= 11; i++) await userEvent.click(screen.getByLabelText(`Usar el candidato ${i}`));
    expect(screen.getByText('Son 11 marcados: el máximo por render es 10.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Renderizar ✦ 33' })).toBeDisabled();
  });

  it('shorts.cobro.sin_saldo_con_la_recarga_cerrada_dice_a_quien_escribir', async () => {
    const cobros = oirCobros();
    monedero = ponerMonedero(null, false);
    montar({ proyecto: () => CANDIDATOS, rutas: { '/api/shorts/podcast/render': () => json({ detail: 'Te faltan créditos.' }, 402) } });
    render(<Shorts />);
    await userEvent.click(await screen.findByRole('button', { name: 'Renderizar ✦ 9' }));
    expect(await screen.findByText(/Te faltan créditos\./)).toHaveTextContent(monedero.cta);
    expect(screen.queryByRole('button', { name: 'Recargar' })).toBeNull();
    expect(cobros).toEqual([]);
  });

  it('shorts.cobro.saldo_conocido_que_no_alcanza_no_cobra', async () => {
    const cobros = oirCobros();
    monedero = ponerMonedero(4);
    const f = montar({ proyecto: () => CANDIDATOS });
    render(<Shorts />);
    const b = await screen.findByRole('button', { name: 'Renderizar ✦ 9' });
    expect(b).toBeDisabled();
    expect(screen.getAllByText(/Te faltan ✦ 5/).length).toBeGreaterThan(0);
    await userEvent.click(b);
    expect(llamadas(f, '/api/shorts/podcast/render')).toHaveLength(0);
    expect(cobros).toEqual([]);
  });

  it('shorts.cobro.refresca_el_saldo_tras_cobrar_y_al_terminar', async () => {
    const cobros = oirCobros();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let estado: Proyecto = CANDIDATOS;
    montar({
      proyecto: () => estado,
      rutas: {
        '/api/shorts/podcast/render': () => {
          estado = RENDERIZANDO;
          return json({ lanzado: true, creditos: 9 });
        },
      },
    });
    render(<Shorts />);
    fireEvent.click(await screen.findByRole('button', { name: 'Renderizar ✦ 9' }));
    expect(await screen.findByText(/Renderizando en la nube/)).toBeInTheDocument();
    expect(monedero.refrescar).toHaveBeenCalledTimes(1);
    expect(cobros).toEqual([expect.objectContaining({ costo: 9 })]);
    estado = RENDER_LISTO;
    await esperar(5000);
    expect(await screen.findByRole('heading', { name: '3 · Tus shorts' })).toBeInTheDocument();
    // al terminar puede haber devolución: se vuelve a refrescar
    expect(monedero.refrescar).toHaveBeenCalledTimes(2);
    expect(cobros).toHaveLength(1); // …pero una devolución no vuela como un cobro
  });

  it('shorts.candidatos.lo_elegido_sobrevive_al_sondeo', async () => {
    // la vieja repintaba la lista en cada vuelta y borraba lo ajustado
    vi.useFakeTimers({ shouldAdvanceTime: true });
    montar({ proyecto: () => RENDERIZANDO });
    render(<Shorts />);
    const gancho = await screen.findByLabelText('gancho del candidato 1');
    fireEvent.change(gancho, { target: { value: 'Mi gancho' } });
    fireEvent.click(screen.getByLabelText('Usar el candidato 4'));
    await esperar(5000);
    await esperar(5000);
    expect(screen.getByLabelText('gancho del candidato 1')).toHaveValue('Mi gancho');
    expect(screen.getByLabelText('Usar el candidato 4')).toBeChecked();
  });
});

describe('importar de YouTube', () => {
  it('shorts.cobro.importar_cotiza_antes_de_cobrar', async () => {
    irA(null);
    const f = montar();
    render(<Shorts />);
    expect(await screen.findByLabelText('Liga de YouTube')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Importar/ })).toBeNull();
    await cotizarLiga();
    expect(await screen.findByText('«Entrevista larga» · 30.0 min')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importar ✦ 11' })).toBeInTheDocument();
    expect(llamadas(f, '/api/shorts/importar')).toHaveLength(0);
  });

  it('shorts.cobro.cambiar_la_liga_anula_la_cotizacion', async () => {
    // la vieja cobraba la liga que hubiera en el campo, aunque la cotización fuera de otra
    irA(null);
    montar();
    render(<Shorts />);
    await cotizarLiga();
    await screen.findByRole('button', { name: 'Importar ✦ 11' });
    await userEvent.type(screen.getByLabelText('Liga de YouTube'), 'otro');
    expect(screen.queryByRole('button', { name: /Importar/ })).toBeNull();
  });

  it('shorts.cobro.importar_doble_clic_un_solo_post', async () => {
    irA(null);
    let soltar!: (r: Response) => void;
    const f = montar({ rutas: { '/api/shorts/importar': () => new Promise<Response>(r => (soltar = r)) } });
    render(<Shorts />);
    await cotizarLiga();
    const b = await screen.findByRole('button', { name: 'Importar ✦ 11' });
    await userEvent.dblClick(b);
    expect(llamadas(f, '/api/shorts/importar')).toHaveLength(1);
    expect(JSON.parse(String(llamadas(f, '/api/shorts/importar')[0]![1]!.body))).toEqual({
      url: 'https://www.youtube.com/watch?v=abc123',
    });
    await act(async () => soltar(json({ lanzado: true, nombre: 'yt-abc123', creditos: 11 })));
  });

  it('shorts.cobro.importado_abre_el_proyecto', async () => {
    const cobros = oirCobros();
    irA(null);
    montar({
      rutas: {
        '/api/shorts/importar': () => json({ lanzado: true, nombre: 'yt-abc123', creditos: 11 }),
        '/api/shorts/yt-abc123': () => json({ ...SIN_ANALISIS, fuente: null, importar: { estado: 'descargando', titulo: 'Entrevista larga' } }),
      },
    });
    render(<Shorts />);
    await cotizarLiga();
    await userEvent.click(await screen.findByRole('button', { name: 'Importar ✦ 11' }));
    expect(await screen.findByText(/Trayendo «Entrevista larga» de YouTube/)).toBeInTheDocument();
    expect(location.search).toBe('?p=yt-abc123');
    expect(monedero.refrescar).toHaveBeenCalled();
    expect(cobros).toEqual([expect.objectContaining({ costo: 11 })]);
  });

  it('shorts.cobro.importar_409_abre_el_que_ya_existe', async () => {
    const cobros = oirCobros();
    irA(null);
    montar({
      rutas: {
        '/api/shorts/importar': () => json({ detail: 'Ese video ya está importado' }, 409),
        '/api/shorts/yt-abc123': () => json(CANDIDATOS),
      },
    });
    render(<Shorts />);
    await cotizarLiga();
    await userEvent.click(await screen.findByRole('button', { name: 'Importar ✦ 11' }));
    expect(await screen.findByText('Candidato 1')).toBeInTheDocument();
    expect(location.search).toBe('?p=yt-abc123');
    expect(cobros).toEqual([]); // abrir el que ya existía no cobró
  });

  it('shorts.importacion.descargando_sin_orbe_y_sin_la_liga', async () => {
    montar({ proyecto: () => ({ ...SIN_ANALISIS, fuente: null, importar: { estado: 'descargando', titulo: '<b>Mi video</b>' } }) });
    render(<Shorts />);
    expect(await screen.findByText(/Trayendo «<b>Mi video<\/b>» de YouTube/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Liga de YouTube')).toBeNull();
    expect(screen.queryByRole('heading', { name: '1 · Analizar el video' })).toBeNull();
    await waitFor(() => expect(document.title).toBe('Trayendo el video · Estudio de video · Shorts'));
  });

  it('shorts.importacion.fallida_dice_que_los_creditos_volvieron', async () => {
    montar({ proyecto: () => ({ ...SIN_ANALISIS, fuente: null, importar: { estado: 'error', error: 'video privado' } }) });
    render(<Shorts />);
    expect(await screen.findByRole('alert')).toHaveTextContent('La importación falló (video privado) — tus créditos se devolvieron.');
    expect(screen.queryByRole('heading', { name: '1 · Analizar el video' })).toBeNull();
  });
});

describe('el proyecto', () => {
  it('shorts.cobro.un_solo_principal_por_vista', async () => {
    const ambar = () =>
      [...document.querySelectorAll('button')].filter(b => b.className.includes('bg-ambar') && !b.disabled).map(b => b.textContent);
    irA(null);
    montar({ proyecto: () => SIN_ANALISIS });
    const { unmount: u1 } = render(<Shorts />);
    await cotizarLiga();
    await screen.findByRole('button', { name: 'Importar ✦ 11' });
    expect(ambar()).toEqual(['Importar ✦ 11']);
    u1();
    irA('podcast');
    const { unmount: u2 } = render(<Shorts />);
    await screen.findByRole('button', { name: 'Analizar ✦ 7' });
    await cotizarLiga();
    await screen.findByRole('button', { name: 'Importar ✦ 11' });
    expect(ambar()).toEqual(['Analizar ✦ 7']);
    u2();
    montar({ proyecto: () => CANDIDATOS });
    render(<Shorts />);
    await screen.findByRole('button', { name: 'Re-analizar ✦ 7' });
    expect(ambar()).toEqual(['Renderizar ✦ 9']);
  });

  it('shorts.eleccion.lista_los_proyectos_con_metraje', async () => {
    irA(null);
    montar({
      proyectos: [
        { nombre: 'podcast', generado: false, subidas: [{}] },
        { nombre: 'película', generado: true, subidas: [] },
        { nombre: 'vacío', generado: false, subidas: [] },
      ],
    });
    render(<Shorts />);
    expect(await screen.findByRole('link', { name: 'podcast' })).toHaveAttribute('href', '?p=podcast');
    expect(screen.getByRole('link', { name: 'película' })).toHaveAttribute('href', '?p=pel%C3%ADcula');
    expect(screen.queryByRole('link', { name: 'vacío' })).toBeNull();
  });

  it('shorts.eleccion.sin_red_no_dice_que_no_tienes_videos', async () => {
    irA(null);
    montar({ proyectos: null });
    const { unmount } = render(<Shorts />);
    expect(await screen.findByText(/No pudimos traer tus proyectos/)).toBeInTheDocument();
    expect(screen.queryByText(/Todavía no tienes videos/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    unmount();
    montar({ proyectos: [] });
    render(<Shorts />);
    expect(await screen.findByText(/Todavía no tienes videos con metraje/)).toBeInTheDocument();
  });

  it('shorts.carga.fallo_avisa_con_reintentar', async () => {
    let paso = 0;
    montar({
      proyecto: () => {
        paso++;
        if (paso === 1) return sinRed() as Promise<Response>;
        if (paso === 2) return Promise.resolve(json({ detail: 'Proyecto no encontrado' }, 404));
        return SIN_ANALISIS;
      },
    });
    render(<Shorts />);
    expect(await screen.findByText(/No pudimos cargar tu proyecto/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText(/Proyecto no encontrado/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('button', { name: 'Analizar ✦ 7' })).toBeInTheDocument();
    expect(screen.queryByText(/Proyecto no encontrado/)).toBeNull();
  });

  it('shorts.render.corriendo_sondea_y_al_terminar_muestra_las_salidas', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let estado: Proyecto = RENDERIZANDO;
    const f = montar({ proyecto: () => estado });
    render(<Shorts />);
    await screen.findByText(/Renderizando en la nube/);
    await waitFor(() => expect(document.title).toBe('Renderizando · Estudio de video · Shorts'));
    const gets = () => llamadas(f, '/api/shorts/podcast', 'GET').length;
    const antes = gets();
    await esperar(5000);
    expect(gets()).toBe(antes + 1);
    estado = RENDER_LISTO;
    await esperar(5000);
    expect(await screen.findByText('short-1.mp4')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('✓ Shorts listos · Estudio de video · Shorts'));
    const alTerminar = gets();
    await esperar(60000);
    expect(gets()).toBe(alTerminar);
  });

  it('shorts.render.error_dice_que_los_creditos_volvieron', async () => {
    montar({ proyecto: () => ({ ...CANDIDATOS, shorts: { ...CANDIDATOS.shorts!, render: { estado: 'error', log: 'ffmpeg: sin espacio' } } }) });
    render(<Shorts />);
    expect(await screen.findByText(/El render falló \(ffmpeg: sin espacio\) — tus créditos se devolvieron/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Renderizar ✦ 9' })).toBeEnabled();
  });

  it('shorts.salidas.descargar_por_el_servicio_y_ver_solo_http', async () => {
    montar({ proyecto: () => RENDER_LISTO });
    render(<Shorts />);
    const lista = within((await screen.findByText('short-1.mp4')).closest('ul')!);
    const descargas = lista.getAllByRole('link', { name: /Descargar/ });
    // el primero no trae key: se saca de su URL del CDN
    expect(descargas[0]).toHaveAttribute('href', '/api/media/descarga?key=usuarios%2Fu%2Fpodcast%2Fshort-1.mp4&nombre=short-1.mp4');
    expect(descargas[1]).toHaveAttribute('href', '/api/media/descarga?key=usuarios%2Fu%2Fpodcast%2Fshort-2.mp4&nombre=short-2.mp4');
    const ver = lista.getAllByRole('link', { name: /Ver/ });
    expect(ver).toHaveLength(1);
    expect(ver[0]).toHaveAttribute('rel', 'noopener noreferrer');
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it('shorts.salidas.textos_del_server_como_texto', async () => {
    const malo = '<img src=x onerror=alert(1)>';
    montar({
      proyecto: () => ({
        ...CANDIDATOS,
        shorts: { estado: 'candidatos', candidatos: [{ ...cand(0), texto: malo, razon: malo }], listo: 'x' },
      }),
    });
    const { container } = render(<Shorts />);
    expect(await screen.findAllByText(malo)).toHaveLength(2);
    expect(container.querySelector('img')).toBeNull();
  });

  it('shorts.espera.sin_red_con_algo_vivo_sigue_reintentando', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let red = true;
    montar({ proyecto: () => (red ? ANALIZANDO : (sinRed() as Promise<Response>)) });
    render(<Shorts />);
    await screen.findByText('Analizando tu video · transcript y candidatos');
    red = false;
    await esperar(5000);
    expect(await screen.findByText(/Sin conexión — reintentando/)).toBeInTheDocument();
    expect(screen.getByText('Analizando tu video · transcript y candidatos')).toBeInTheDocument();
    red = true;
    await esperar(20000);
    await waitFor(() => expect(screen.queryByText(/Sin conexión/)).toBeNull());
  });

  it('shorts.espera.titulo_de_la_pestana', async () => {
    montar({ proyecto: () => ANALIZANDO });
    const { unmount } = render(<Shorts />);
    await waitFor(() => expect(document.title).toBe('Analizando tu video · Estudio de video · Shorts'));
    unmount();
    montar({ proyecto: () => CANDIDATOS });
    render(<Shorts />);
    await waitFor(() => expect(document.title).toBe('✓ Análisis listo · Estudio de video · Shorts'));
  });
});

describe('subir y marco', () => {
  it('shorts.subida.sube_y_abre_el_proyecto', async () => {
    irA(null);
    montar({ rutas: { '/api/shorts/mi-entrevista': () => json(SIN_ANALISIS), '/api/shorts/mi-entrevista/costo': () => json(COSTO) } });
    render(<Shorts />);
    const archivo = new File(['x'], 'Mi Entrevista.mp4', { type: 'video/mp4' });
    fireEvent.change(await screen.findByLabelText('Archivo de video'), { target: { files: [archivo] } });
    // con el nombre vacío, se propone uno desde el archivo
    expect(screen.getByLabelText('Nombre del proyecto')).toHaveValue('mi-entrevista');
    // subir no es el principal: lo es importar (o analizar, ya con proyecto)
    expect(screen.getByRole('button', { name: 'Subir' }).className).not.toContain('bg-ambar');
    await userEvent.click(screen.getByRole('button', { name: 'Subir' }));
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    await act(async () => XhrFalso.todos[0]!.terminar());
    expect(await screen.findByRole('button', { name: 'Analizar ✦ 7' })).toBeInTheDocument();
    expect(location.search).toBe('?p=mi-entrevista');
  });

  it('shorts.marco.enlaces_estudio_y_version_anterior', async () => {
    montar();
    render(<Shorts />);
    expect(screen.getByRole('link', { name: 'Usar la versión anterior' })).toHaveAttribute('href', '/ui/clasica?pantalla=shorts');
    expect(screen.getByRole('link', { name: 'Estudio' })).toHaveAttribute('href', '/estudio/');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Shorts · podcast');
    await screen.findByRole('button', { name: 'Analizar ✦ 7' });
  });
});
