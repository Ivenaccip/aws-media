// El clip de 8 segundos, como COMPORTAMIENTO (docs/PLAN-UI.md §5). Cada test
// empieza por el ID de su invariante: tests/test_migracion_ui.py exige que
// cada ID del registro exista aquí.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { oirCobros } from '../../prueba/servidor';
import { Clip } from './Clip';
import type { Clip as FichaClip, Config } from './logica';

const CFG: Config = {
  activo: true,
  creditos: 30,
  creditos_con_composicion: 34,
  max_imagenes: 3,
  segundos: 8,
  extensiones: ['.heic', '.jpg', '.png'],
  max_bytes: 20 * 1024 * 1024,
};

const LISTO: FichaClip = {
  id: 'clip-1',
  estado: 'listo',
  texto: 'Un perro en la playa',
  imagenes: 1,
  segundos: 8,
  creditos: 30,
  video: '/api/clip/clip-1/video',
  recorte: '',
};
const VIVO: FichaClip = { ...LISTO, id: 'clip-2', estado: 'generando', video: '' };

function json(cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } });
}

type Ruta = (url: string, init?: RequestInit) => Promise<Response> | Response;

function servidor(rutas: Record<string, Ruta>) {
  const base: Record<string, Ruta> = {
    '/api/clip/config': () => json(CFG),
    '/api/clip/presign': (_u, init) => {
      const b = JSON.parse(String(init?.body)) as { content_type: string };
      return json({ url: 'https://s3.ejemplo/subida?firma=1', key: 'usuarios/u/clips/subidas/abc.jpg', content_type: b.content_type });
    },
    'https://s3.ejemplo/': () => new Response(null, { status: 200 }),
    '/api/clip': () => json({ clips: [] }),
    ...rutas,
  };
  // la más larga primero: /api/clip/config antes que /api/clip
  const claves = Object.keys(base).sort((a, b) => b.length - a.length);
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const clave = claves.find(k => url.startsWith(k));
    if (!clave) throw new Error('ruta no esperada: ' + url);
    return base[clave]!(url, init);
  });
  vi.stubGlobal('fetch', f);
  return f;
}

const posts = (f: ReturnType<typeof servidor>, ruta: string) =>
  f.mock.calls.filter(c => c[0] === ruta && c[1]?.method === 'POST');

const sinRed = () => Promise.reject(new TypeError('Failed to fetch'));

function foto(nombre = 'perro.jpg', tipo = 'image/jpeg', bytes = 1000) {
  const f = new File(['x'], nombre, { type: tipo });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
}

async function subir(f: File) {
  const input = screen.getByTestId('archivo');
  await act(async () => {
    fireEvent.change(input, { target: { files: [f] } });
  });
}

const monedero = {
  get: vi.fn(() => ({ saldo: 100 as number | null })),
  refrescar: vi.fn(),
  recargar: vi.fn(),
  recarga: true,
  cta: 'Escríbenos por el canal de la comunidad para conseguir más.',
};

beforeEach(() => {
  vi.unstubAllGlobals();
  URL.createObjectURL = vi.fn(() => 'blob:foto');
  URL.revokeObjectURL = vi.fn();
  window.monedero = monedero;
  monedero.refrescar.mockClear();
  monedero.recargar.mockClear();
  monedero.get.mockReturnValue({ saldo: 100 });
  monedero.recarga = true;
  history.replaceState(null, '', '/estudio/clip/');
});

afterEach(() => {
  vi.useRealTimers();
  delete window.monedero;
});

async function escribir(t: string) {
  await userEvent.type(screen.getByLabelText('Qué quieres ver'), t);
}

describe('clip', () => {
  it('clip.cobro.precio_del_servidor_en_el_boton', async () => {
    servidor({});
    render(<Clip />);
    expect(await screen.findByRole('button', { name: 'Generar ✦ 30' })).toBeInTheDocument();
    expect(screen.getByText('30 créditos · 8 segundos con sonido')).toBeInTheDocument();
    await subir(foto('a.jpg'));
    await subir(foto('b.jpg'));
    expect(await screen.findByRole('button', { name: 'Generar ✦ 34' })).toBeInTheDocument();
    expect(screen.getByText('30 créditos + 4 por juntar tus 2 fotos en una')).toBeInTheDocument();
  });

  it('clip.cobro.doble_clic_un_solo_post', async () => {
    let soltar!: (r: Response) => void;
    const f = servidor({ '/api/clip/generar': () => new Promise<Response>(r => (soltar = r)) });
    render(<Clip />);
    await escribir('Un gato');
    const boton = await screen.findByRole('button', { name: 'Generar ✦ 30' });
    await userEvent.dblClick(boton);
    await userEvent.click(boton);
    expect(posts(f, '/api/clip/generar')).toHaveLength(1);
    await act(async () => soltar(json({ lanzado: true, id: 'clip-3', creditos: 30 })));
  });

  it('clip.cobro.manda_texto_formato_y_fotos', async () => {
    const f = servidor({ '/api/clip/generar': () => json({ lanzado: true, id: 'c', creditos: 30 }) });
    render(<Clip />);
    await escribir('  Un gato  ');
    await subir(foto());
    await userEvent.click(screen.getByRole('button', { name: 'Vertical' }));
    await userEvent.click(await screen.findByRole('button', { name: /Generar ✦/ }));
    await waitFor(() => expect(posts(f, '/api/clip/generar')).toHaveLength(1));
    expect(JSON.parse(String(posts(f, '/api/clip/generar')[0]![1]!.body))).toEqual({
      texto: 'Un gato',
      formato: 'vertical',
      imagenes: ['usuarios/u/clips/subidas/abc.jpg'],
    });
  });

  it('clip.cobro.sin_texto_no_cobra', async () => {
    const cobros = oirCobros();
    const f = servidor({});
    render(<Clip />);
    await userEvent.click(await screen.findByRole('button', { name: 'Generar ✦ 30' }));
    expect(screen.getByText('Escribe qué quieres ver primero.')).toBeInTheDocument();
    expect(posts(f, '/api/clip/generar')).toHaveLength(0);
    expect(cobros).toEqual([]);
  });

  it('clip.cobro.fotos_subiendo_no_cobra', async () => {
    const cobros = oirCobros();
    let soltarPut!: (r: Response) => void;
    const f = servidor({ 'https://s3.ejemplo/': () => new Promise<Response>(r => (soltarPut = r)) });
    render(<Clip />);
    await escribir('Un gato');
    await subir(foto());
    expect(screen.getByText('Subiendo…')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /Generar ✦/ }));
    expect(screen.getByText('Espera a que terminen de subir tus fotos.')).toBeInTheDocument();
    expect(posts(f, '/api/clip/generar')).toHaveLength(0);
    expect(cobros).toEqual([]);
    await act(async () => soltarPut(new Response(null, { status: 200 })));
  });

  it('clip.cobro.error_junto_al_boton_y_se_puede_reintentar', async () => {
    const cobros = oirCobros();
    let intentos = 0;
    const f = servidor({
      '/api/clip/generar': () =>
        ++intentos === 1
          ? json({ detail: 'Ya tienes 3 clips generándose — espera a que terminen.' }, 409)
          : json({ lanzado: true, id: 'c', creditos: 30 }),
    });
    render(<Clip />);
    await escribir('Un gato');
    await userEvent.click(await screen.findByRole('button', { name: 'Generar ✦ 30' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya tienes 3 clips generándose — espera a que terminen.');
    expect(cobros).toEqual([]);
    // el texto sigue ahí para volver a intentarlo
    expect(screen.getByLabelText('Qué quieres ver')).toHaveValue('Un gato');
    await userEvent.click(screen.getByRole('button', { name: 'Generar ✦ 30' }));
    await waitFor(() => expect(posts(f, '/api/clip/generar')).toHaveLength(2));
  });

  it('clip.cobro.sin_saldo_402_ofrece_recargar', async () => {
    const cobros = oirCobros();
    servidor({ '/api/clip/generar': () => json({ detail: 'Te faltan 10 créditos' }, 402) });
    render(<Clip />);
    await escribir('Un gato');
    await userEvent.click(await screen.findByRole('button', { name: 'Generar ✦ 30' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Te faltan 10 créditos');
    expect(cobros).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Recargar' }));
    expect(monedero.recargar).toHaveBeenCalled();
  });

  it('clip.cobro.recarga_cerrada_dice_a_quien_escribir', async () => {
    const cobros = oirCobros();
    monedero.recarga = false;
    servidor({ '/api/clip/generar': () => json({ detail: 'Te faltan 10 créditos' }, 402) });
    render(<Clip />);
    await escribir('Un gato');
    await userEvent.click(await screen.findByRole('button', { name: 'Generar ✦ 30' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Escríbenos por el canal de la comunidad');
    expect(screen.queryByRole('button', { name: 'Recargar' })).not.toBeInTheDocument();
    expect(cobros).toEqual([]);
  });

  it('clip.cobro.saldo_conocido_que_no_alcanza_no_cobra', async () => {
    const cobros = oirCobros();
    monedero.get.mockReturnValue({ saldo: 12 });
    const f = servidor({});
    render(<Clip />);
    await escribir('Un gato');
    const boton = await screen.findByRole('button', { name: 'Generar ✦ 30' });
    expect(boton).toBeDisabled();
    expect(screen.getByText(/Te faltan ✦ 18/)).toBeInTheDocument();
    await userEvent.click(boton);
    expect(posts(f, '/api/clip/generar')).toHaveLength(0);
    expect(cobros).toEqual([]);
  });

  it('clip.cobro.refresca_el_saldo_y_limpia_tras_cobrar', async () => {
    const cobros = oirCobros();
    servidor({ '/api/clip/generar': () => json({ lanzado: true, id: 'c', creditos: 30 }) });
    render(<Clip />);
    await escribir('Un gato');
    await subir(foto());
    await userEvent.click(await screen.findByRole('button', { name: /Generar ✦/ }));
    await waitFor(() => expect(screen.getByLabelText('Qué quieres ver')).toHaveValue(''));
    expect(screen.queryByRole('button', { name: 'Quitar foto' })).not.toBeInTheDocument();
    expect(monedero.refrescar).toHaveBeenCalled();
    // con una foto se cobra la tarifa sin composición
    await waitFor(() => expect(cobros).toEqual([expect.objectContaining({ costo: CFG.creditos })]));
  });

  it('clip.cobro.espera_a_que_termine_antes_de_otro', async () => {
    let lista: FichaClip[] = [];
    servidor({
      '/api/clip/generar': () => {
        lista = [VIVO];
        return json({ lanzado: true, id: VIVO.id, creditos: 30 });
      },
      '/api/clip': () => json({ clips: lista }),
    });
    render(<Clip />);
    await escribir('Un gato');
    await userEvent.click(await screen.findByRole('button', { name: 'Generar ✦ 30' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generar ✦ 30' })).toBeDisabled());
  });

  it('clip.fotos.pesada_no_se_sube', async () => {
    const f = servidor({});
    render(<Clip />);
    await screen.findByRole('button', { name: /Generar ✦/ });
    await subir(foto('grande.jpg', 'image/jpeg', 21 * 1024 * 1024));
    expect(screen.getByText('Esa foto pesa demasiado (máximo 20 MB).')).toBeInTheDocument();
    expect(posts(f, '/api/clip/presign')).toHaveLength(0);
  });

  it('clip.fotos.heic_sin_tipo_firma_y_sube_con_image_heic', async () => {
    const f = servidor({});
    render(<Clip />);
    await screen.findByRole('button', { name: /Generar ✦/ });
    await subir(foto('IMG_0001.HEIC', ''));
    await screen.findByRole('button', { name: 'Quitar foto' });
    expect(JSON.parse(String(posts(f, '/api/clip/presign')[0]![1]!.body))).toMatchObject({
      archivo: 'IMG_0001.HEIC',
      content_type: 'image/heic',
    });
    const put = f.mock.calls.find(c => c[1]?.method === 'PUT')!;
    expect(put[0]).toBe('https://s3.ejemplo/subida?firma=1');
    expect((put[1]!.headers as Record<string, string>)['Content-Type']).toBe('image/heic');
  });

  it('clip.fotos.fallo_de_subida_la_quita_y_avisa', async () => {
    servidor({ 'https://s3.ejemplo/': () => new Response(null, { status: 403 }) });
    render(<Clip />);
    await screen.findByRole('button', { name: /Generar ✦/ });
    await subir(foto());
    expect(await screen.findByText('No se pudo subir la foto — inténtalo otra vez.')).toBeInTheDocument();
    expect(screen.queryByText('Subiendo…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar foto (0 de 3)' })).toBeInTheDocument();
  });

  it('clip.fotos.tope_oculta_agregar_y_quitar_la_devuelve', async () => {
    servidor({});
    render(<Clip />);
    await screen.findByRole('button', { name: /Generar ✦/ });
    for (const n of ['a.jpg', 'b.jpg', 'c.jpg']) await subir(foto(n));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Quitar foto' })).toHaveLength(3));
    expect(screen.queryByRole('button', { name: /Agregar foto/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Quitar foto' })[0]!);
    expect(screen.getByRole('button', { name: 'Agregar foto (2 de 3)' })).toBeInTheDocument();
  });

  it('clip.formato.horizontal_por_defecto', async () => {
    servidor({});
    render(<Clip />);
    expect(screen.getByRole('button', { name: 'Horizontal' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Vertical' })).toHaveAttribute('aria-pressed', 'false');
    await screen.findByRole('button', { name: /Generar ✦/ });
  });

  it('clip.entrada.brief_rellena_el_texto_y_se_limpia_la_url', async () => {
    history.replaceState(null, '', '/estudio/clip/?brief=' + encodeURIComponent('mi perro en la playa'));
    servidor({});
    render(<Clip />);
    expect(screen.getByLabelText('Qué quieres ver')).toHaveValue('mi perro en la playa');
    expect(location.search).toBe('');
    await screen.findByRole('button', { name: /Generar ✦/ });
  });

  it('clip.entrada.recupera_lo_apartado_si_la_sesion_vencio', async () => {
    sessionStorage.setItem(
      'apartado:clip-generar',
      JSON.stringify({ ruta: '/api/clip/generar', metodo: 'POST', cuerpo: { texto: 'lo que escribí' }, cuando: 1 }),
    );
    servidor({});
    render(<Clip />);
    expect(screen.getByLabelText('Qué quieres ver')).toHaveValue('lo que escribí');
    await screen.findByRole('button', { name: /Generar ✦/ });
  });

  it('clip.lista.textos_del_usuario_como_texto', async () => {
    servidor({ '/api/clip': () => json({ clips: [{ ...LISTO, texto: '<img src=x onerror=alert(1)>', video: '' }] }) });
    const { container } = render(<Clip />);
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img[src="x"]')).toBeNull();
  });

  it('clip.lista.listo_con_video_detalle_y_recorte', async () => {
    servidor({ '/api/clip': () => json({ clips: [{ ...LISTO, recorte: 'Recortamos tu foto al formato.' }] }) });
    const { container } = render(<Clip />);
    expect(await screen.findByText('8 s · 1 foto tuya · ✦ 30')).toBeInTheDocument();
    expect(screen.getByText('Recortamos tu foto al formato.')).toBeInTheDocument();
    expect(container.querySelector('video')).toHaveAttribute('src', '/api/clip/clip-1/video');
  });

  it('clip.lista.error_dice_que_los_creditos_volvieron', async () => {
    servidor({ '/api/clip': () => json({ clips: [{ ...LISTO, estado: 'error', error: 'Veo no respondió' }] }) });
    render(<Clip />);
    expect(await screen.findByText('Veo no respondió')).toBeInTheDocument();
    expect(screen.getByText('Los créditos volvieron a tu saldo.')).toBeInTheDocument();
  });

  it('clip.lista.vacia_invita_al_primero', async () => {
    servidor({});
    render(<Clip />);
    expect(await screen.findByText('Todavía no has hecho ninguno.')).toBeInTheDocument();
  });

  it('clip.lista.sondea_mientras_genera_y_para_al_terminar', async () => {
    const cobros = oirCobros();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let lista: FichaClip[] = [VIVO];
    const f = servidor({ '/api/clip': () => json({ clips: lista }) });
    render(<Clip />);
    await screen.findByText('Generando tu clip…', undefined, { timeout: 3000 }).catch(() => undefined);
    const listados = () => f.mock.calls.filter(c => c[0] === '/api/clip').length;
    const antes = listados();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(listados()).toBe(antes + 1);
    lista = [{ ...VIVO, estado: 'listo', video: '/api/clip/clip-2/video' }];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    const alTerminar = listados();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(listados()).toBe(alTerminar);
    // al terminar, el saldo se vuelve a pedir (por si hubo devolución)
    expect(monedero.refrescar).toHaveBeenCalled();
    expect(cobros).toEqual([]); // una devolución no vuela como un cobro
  });

  it('clip.lista.fallo_de_carga_avisa_reintenta_y_sigue_solo', async () => {
    let red = false;
    servidor({ '/api/clip': () => (red ? json({ clips: [LISTO] }) : sinRed()) });
    render(<Clip />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos traer tus clips.');
    expect(screen.queryByText('Cargando…')).not.toBeInTheDocument();
    red = true;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Un perro en la playa')).toBeInTheDocument();
    expect(screen.queryByText(/No pudimos traer tus clips/)).not.toBeInTheDocument();
  });

  it('clip.espera.titulo_de_la_pestana_dice_generando', async () => {
    servidor({ '/api/clip': () => json({ clips: [VIVO] }) });
    render(<Clip />);
    await waitFor(() => expect(document.title).toBe('Generando tu clip · Estudio de video · Clip de 8 segundos'));
  });

  it('clip.marco.enlace_estudio_sin_version_anterior', async () => {
    servidor({});
    render(<Clip />);
    expect(screen.getByRole('link', { name: 'Estudio' })).toHaveAttribute('href', '/estudio/');
    expect(screen.queryByRole('link', { name: 'Usar la versión anterior' })).toBeNull();
    await screen.findByRole('button', { name: /Generar ✦/ });
  });
});

// UI·21 — la lista de clips crece sin saltar. Los nombres NO son IDs de
// invariante (tests/test_migracion_ui.py): empiezan por «UI·21: ».
describe('UI·21 · la lista de clips', () => {
  const OTRO: FichaClip = { ...LISTO, id: 'clip-0', texto: 'Una ola rompiendo', imagenes: 0, video: '' };
  const fila = (texto: string) => screen.getByText(texto).closest('.fila-viva');

  it('UI·21: en la primera carga ningún clip entra animado', async () => {
    servidor({ '/api/clip': () => json({ clips: [LISTO, OTRO] }) });
    const { container } = render(<Clip />);
    await screen.findByText('Una ola rompiendo');
    expect(container.querySelectorAll('.fila-viva')).toHaveLength(2);
    expect(container.querySelectorAll('.fila-entra')).toHaveLength(0);
  });

  it('UI·21: tras generar, solo el clip nuevo entra abriendo su espacio', async () => {
    const NUEVO: FichaClip = { ...VIVO, id: 'clip-3', texto: 'Un gato en la luna' };
    let lista: FichaClip[] = [LISTO, OTRO];
    servidor({
      '/api/clip/generar': () => {
        lista = [NUEVO, LISTO, OTRO];
        return json({ lanzado: true, id: NUEVO.id, creditos: 30 });
      },
      '/api/clip': () => json({ clips: lista }),
    });
    const { container } = render(<Clip />);
    await screen.findByText('Una ola rompiendo');
    await escribir('Un gato');
    await userEvent.click(await screen.findByRole('button', { name: 'Generar ✦ 30' }));
    await waitFor(() => expect(container.querySelectorAll('.fila-viva')).toHaveLength(3));
    expect(fila('Un gato en la luna')).toHaveClass('fila-entra');
    expect(fila('Un perro en la playa')).not.toHaveClass('fila-entra');
    expect(fila('Una ola rompiendo')).not.toHaveClass('fila-entra');
    // la clase se va al terminar su animación
    fireEvent.animationEnd(fila('Un gato en la luna')!);
    expect(fila('Un gato en la luna')).not.toHaveClass('fila-entra');
  });

  it('UI·21: un clip que trae el sondeo entra animado; los que ya estaban no', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let lista: FichaClip[] = [VIVO];
    servidor({ '/api/clip': () => json({ clips: lista }) });
    const { container } = render(<Clip />);
    await waitFor(() => expect(container.querySelectorAll('.fila-viva')).toHaveLength(1));
    // desde otra pestaña se pidió otro: llega en la siguiente vuelta
    lista = [OTRO, VIVO];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(container.querySelectorAll('.fila-viva')).toHaveLength(2);
    expect(fila('Una ola rompiendo')).toHaveClass('fila-entra');
    expect(container.querySelectorAll('.fila-entra')).toHaveLength(1);
  });

  it('UI·21: tras un fallo de carga, la primera carga buena tampoco anima', async () => {
    let red = false;
    servidor({ '/api/clip': () => (red ? json({ clips: [LISTO, OTRO] }) : sinRed()) });
    const { container } = render(<Clip />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos traer tus clips.');
    red = true;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByText('Una ola rompiendo');
    expect(container.querySelectorAll('.fila-viva')).toHaveLength(2);
    expect(container.querySelectorAll('.fila-entra')).toHaveLength(0);
  });

  it('UI·21: el clip que queda listo con la página abierta enciende su detalle; el que ya estaba listo no', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let lista: FichaClip[] = [VIVO, OTRO];
    servidor({ '/api/clip': () => json({ clips: lista }) });
    render(<Clip />);
    // el que ya estaba listo al entrar no se enciende
    expect(await screen.findByText('8 s · sin fotos · ✦ 30')).not.toHaveClass('destello');
    lista = [{ ...VIVO, estado: 'listo', video: '/api/clip/clip-2/video' }, OTRO];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    const recien = await screen.findByText('8 s · 1 foto tuya · ✦ 30');
    expect(recien).toHaveClass('destello');
    expect(screen.getByText('8 s · sin fotos · ✦ 30')).not.toHaveClass('destello');
    // al terminar el destello se apaga
    fireEvent.animationEnd(recien);
    expect(recien).not.toHaveClass('destello');
  });

  it('UI·21: un clip que ya estaba listo al entrar no enciende su detalle', async () => {
    servidor({ '/api/clip': () => json({ clips: [LISTO] }) });
    render(<Clip />);
    expect(await screen.findByText('8 s · 1 foto tuya · ✦ 30')).not.toHaveClass('destello');
  });

  it('UI·21: un clip que falla no enciende nada', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let lista: FichaClip[] = [VIVO];
    servidor({ '/api/clip': () => json({ clips: lista }) });
    const { container } = render(<Clip />);
    await waitFor(() => expect(container.querySelectorAll('.fila-viva')).toHaveLength(1));
    lista = [{ ...VIVO, estado: 'error', error: 'Veo no respondió' }];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(await screen.findByText('Veo no respondió')).toBeInTheDocument();
    expect(container.querySelectorAll('.destello')).toHaveLength(0);
  });
});
