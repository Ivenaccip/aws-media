// Imágenes, como COMPORTAMIENTO. Cada test empieza por el ID de su invariante
// (tests/test_migracion_ui.py); el mapa contra las aserciones de
// static/imagenes.html está en docs/migracion/imagenes.md.
//
// jsdom no tiene canvas ni decodifica imágenes: el contexto 2D es de mentira
// y `decodificar` devuelve medidas fijas.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { video } from '../../nucleo/tarifas';
import { json, llamadas, oirCobros, ponerMonedero, servidor, sinRed, type Ruta } from '../../prueba/servidor';
import { decodificar } from './decodificar';
import { Imagenes } from './Imagenes';
import { formatoDe, paleta, quiereEditar, type Estilo } from './logica';

vi.mock('./decodificar', () => ({
  decodificar: vi.fn(async () => ({ ancho: 1200, alto: 800, fuente: {} })),
}));
const deco = vi.mocked(decodificar);

const P = video.imagen;
const ESTILOS: Estilo[] = [
  { id: 'animated', nombre: 'Animado', descripcion: 'Como una película animada.' },
  { id: 'watercolor', nombre: 'Acuarela', descripcion: 'Pinceladas suaves.' },
  { id: 'custom', nombre: 'Personalizado', descripcion: 'Descríbelo tú.' },
];
const HECHA = { nombre: 'aaaaaaaaaaaa.jpg', url: '/api/imagenes/aaaaaaaaaaaa.jpg' };
const OTRA = { nombre: 'bbbbbbbbbbbb.jpg', url: '/api/imagenes/bbbbbbbbbbbb.jpg' };
const jpg = () => new Response(new Blob(['x'], { type: 'image/jpeg' }), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });

function montar(rutas: Record<string, Ruta> = {}) {
  return servidor({
    '/api/estilos': () => json(ESTILOS),
    '/api/moderar': () => json({ permitido: true }),
    '/api/imagenes': () => json(HECHA),
    '/api/imagenes/editar': () => json(OTRA),
    '/api/imagenes/aaaaaaaaaaaa.jpg': () => jpg(),
    '/api/imagenes/bbbbbbbbbbbb.jpg': () => jpg(),
    ...rutas,
  });
}

const ctx = () =>
  new Proxy(
    {},
    {
      get: (o: Record<string, unknown>, k: string) => (k in o ? o[k] : () => undefined),
      set: (o: Record<string, unknown>, k: string, v: unknown) => ((o[k] = v), true),
    },
  );

let monedero: ReturnType<typeof ponerMonedero>;
beforeEach(() => {
  vi.unstubAllGlobals();
  deco.mockClear();
  deco.mockImplementation(async () => ({ ancho: 1200, alto: 800, fuente: {} as CanvasImageSource }));
  monedero = ponerMonedero(100);
  history.replaceState(null, '', '/estudio/imagenes/');
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx() as never);
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob(['jpg'], { type: 'image/jpeg' }));
  };
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,eA==';
  document.title = 'Estudio de video · Imágenes';
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete window.monedero;
});

const caja = () => screen.getByRole('textbox', { name: 'Qué quieres' });
// sin plantilla con la estrella: el guardián M21 las lee como etiquetas de botón
const conPrecio = (verbo: string) => verbo + ' ✦ ' + P;
const boton = (verbo: string) => screen.getByRole('button', { name: conPrecio(verbo) });
const posts = (f: ReturnType<typeof servidor>, ruta = '/api/imagenes') => llamadas(f, ruta);
const cuerpoForm = (f: ReturnType<typeof servidor>) => posts(f, '/api/imagenes/editar')[0]![1]!.body as FormData;
const archivo = (tipo = 'image/png', bytes = 10) => new File([new Uint8Array(bytes)], 'foto.png', { type: tipo });

async function subir(f: File = archivo()) {
  await userEvent.upload(document.querySelector('input[type=file]') as HTMLInputElement, f);
  await screen.findByRole('img', { name: 'Tu imagen' });
}
const pintar = () => fireEvent.pointerDown(screen.getByTestId('zona'), { clientX: 5, clientY: 5, pointerId: 1 });
async function escribir(t: string) {
  await userEvent.clear(caja());
  await userEvent.type(caja(), t);
}

describe('imagenes', () => {
  it('imagenes.cobro.precio_de_tarifas_json_y_verbo_segun_el_modo', async () => {
    montar();
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    expect(boton('Generar')).toBeInTheDocument();
    await subir();
    expect(boton('Cambiar')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Transformar toda la imagen/ }));
    expect(boton('Transformar')).toBeInTheDocument();
  });

  it('imagenes.cobro.crear_manda_texto_estilo_y_formato', async () => {
    const f = montar();
    render(<Imagenes />);
    await userEvent.click(await screen.findByRole('button', { name: 'Acuarela' }));
    await userEvent.click(screen.getByRole('radio', { name: /Vertical/ }));
    await escribir('un faro al atardecer');
    await userEvent.click(boton('Generar'));
    await waitFor(() => expect(posts(f)).toHaveLength(1));
    expect(JSON.parse(String(posts(f)[0]![1]!.body))).toEqual({
      prompt: 'un faro al atardecer',
      estilo: 'watercolor',
      estilo_custom: '',
      formato: 'vertical',
    });
  });

  it('imagenes.cobro.doble_clic_un_solo_envio', async () => {
    let soltar!: (r: Response) => void;
    const f = montar({ '/api/imagenes': () => new Promise<Response>(r => (soltar = r)) });
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await escribir('un faro');
    await userEvent.dblClick(boton('Generar'));
    await userEvent.click(screen.getByRole('button', { name: 'Creando…' }));
    await waitFor(() => expect(posts(f)).toHaveLength(1));
    // monedero.js refresca el saldo a media petición: el botón no revive
    await act(async () => document.dispatchEvent(new CustomEvent('monedero')));
    await userEvent.click(screen.getByRole('button', { name: 'Creando…' }));
    expect(posts(f)).toHaveLength(1);
    await act(async () => soltar(json(HECHA)));
  });

  it('imagenes.cobro.el_guardarrail_corta_antes_de_cobrar', async () => {
    const cobros = oirCobros();
    const f = montar({
      '/api/moderar': () =>
        json({ permitido: false, mensaje: 'La IA no permite violencia explícita.', motivo: '<b>sangre</b> en «tu texto»' }),
    });
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await escribir('algo violento');
    await userEvent.click(boton('Generar'));
    const d = await screen.findByRole('dialog', { name: 'Revisa tu texto' });
    expect(d).toHaveTextContent('La IA no permite violencia explícita.');
    expect(within(d).getByText('<b>sangre</b> en «tu texto»')).toBeInTheDocument();
    expect(posts(f)).toHaveLength(0);
    expect(cobros).toEqual([]);
    await userEvent.click(within(d).getByRole('button', { name: 'Entendido, lo edito' }));
    await waitFor(() => expect(caja()).toHaveFocus());
    expect(boton('Generar')).toBeEnabled();
  });

  it('imagenes.cobro.con_el_guardarrail_caido_se_sigue', async () => {
    const f = montar({ '/api/moderar': () => json({ detail: 'caído' }, 500) });
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await escribir('un faro');
    await userEvent.click(boton('Generar'));
    await waitFor(() => expect(posts(f)).toHaveLength(1));
  });

  it('imagenes.cobro.el_pedido_se_arma_antes_de_moderar', async () => {
    let soltar!: (r: Response) => void;
    const f = montar({ '/api/moderar': () => new Promise<Response>(r => (soltar = r)) });
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await escribir('un faro');
    await userEvent.click(boton('Generar'));
    // durante la revisión se toca la pantalla: lo que se cobra ya no cambia
    fireEvent.change(caja(), { target: { value: 'otra cosa' } });
    await userEvent.click(screen.getByRole('button', { name: 'Acuarela' }));
    await userEvent.click(screen.getByRole('radio', { name: /Horizontal/ }));
    await act(async () => soltar(json({ permitido: true })));
    await waitFor(() => expect(posts(f)).toHaveLength(1));
    expect(JSON.parse(String(posts(f)[0]![1]!.body))).toMatchObject({ prompt: 'un faro', estilo: 'animated', formato: 'cuadrado' });
  });

  it('imagenes.cobro.lo_que_se_dice_antes_no_se_cobra', async () => {
    const cobros = oirCobros();
    const f = montar();
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    // el texto vacío
    await userEvent.click(boton('Generar'));
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe qué imagen quieres.');
    // un atajo a medio escribir
    await escribir('/xyz');
    await userEvent.click(boton('Generar'));
    expect(screen.getByRole('alert')).toHaveTextContent('Eso es un atajo');
    // «edítala» sin imagen nunca crea una nueva
    // (el botón aún dice «Generar»: la intención se lee al dejar de escribir y al enviar)
    await escribir('edita mi foto con más luz');
    await userEvent.click(boton('Generar'));
    expect(screen.getByRole('alert')).toHaveTextContent('Primero sube la imagen que quieres editar');
    expect(f.mock.calls.filter(c => String(c[0]).startsWith('/api/imagenes') || c[0] === '/api/moderar')).toHaveLength(0);
    expect(cobros).toEqual([]);
  });

  it('imagenes.cobro.el_pincel_sin_zona_no_cobra', async () => {
    const cobros = oirCobros();
    const f = montar();
    render(<Imagenes />);
    await subir();
    await escribir('una ventana con plantas');
    await userEvent.click(boton('Cambiar'));
    expect(screen.getByRole('alert')).toHaveTextContent('Pinta sobre tu imagen la zona que quieres cambiar');
    expect(posts(f, '/api/imagenes/editar')).toHaveLength(0);
    expect(cobros).toEqual([]);
  });

  it('imagenes.cobro.el_pincel_manda_la_imagen_y_la_zona_sin_estilo', async () => {
    const f = montar();
    render(<Imagenes />);
    await subir();
    pintar();
    await escribir('una ventana con plantas');
    await userEvent.click(boton('Cambiar'));
    await waitFor(() => expect(posts(f, '/api/imagenes/editar')).toHaveLength(1));
    const fd = cuerpoForm(f);
    expect(fd.get('prompt')).toBe('una ventana con plantas');
    expect(fd.get('modo')).toBe('pincel');
    expect(fd.get('imagen')).toBeInstanceOf(Blob);
    expect(fd.get('marcada')).toBeInstanceOf(Blob);
    expect(fd.has('estilo')).toBe(false);
  });

  it('imagenes.cobro.transformar_solo_manda_el_estilo_que_se_eligio', async () => {
    const f = montar();
    render(<Imagenes />);
    await subir();
    await userEvent.click(screen.getByRole('radio', { name: /Transformar toda la imagen/ }));
    // el «Animado» de crear no viaja: el destino empieza vacío
    expect(within(screen.getByRole('group', { name: 'Estilo al que se convierte' })).getByRole('button', { name: 'Animado' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await escribir('pásala a acuarela');
    await userEvent.click(boton('Transformar'));
    await waitFor(() => expect(posts(f, '/api/imagenes/editar')).toHaveLength(1));
    expect(cuerpoForm(f).get('modo')).toBe('todo');
    expect(cuerpoForm(f).has('estilo')).toBe(false);
    expect(cuerpoForm(f).has('marcada')).toBe(false);
    // con un estilo elegido, viaja; tocarlo otra vez lo suelta
    await userEvent.click(screen.getByRole('button', { name: 'Tu imagen' }));
    const acuarela = within(screen.getByRole('group', { name: 'Estilo al que se convierte' })).getByRole('button', { name: 'Acuarela' });
    await userEvent.click(acuarela);
    expect(screen.getByText('Tu imagen se convierte a este estilo. Tócalo otra vez para quitarlo.')).toBeInTheDocument();
    await userEvent.click(boton('Transformar'));
    await waitFor(() => expect(posts(f, '/api/imagenes/editar')).toHaveLength(2));
    expect((posts(f, '/api/imagenes/editar')[1]![1]!.body as FormData).get('estilo')).toBe('watercolor');
    await userEvent.click(acuarela);
    expect(acuarela).toHaveAttribute('aria-pressed', 'false');
  });

  it('imagenes.cobro.sin_saldo_dice_a_quien_escribir', async () => {
    const cobros = oirCobros();
    montar({ '/api/imagenes': () => json({ detail: 'Créditos insuficientes: esta acción cuesta 2 créditos y tu saldo es 1.' }, 402) });
    ponerMonedero(null, false);
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await escribir('un faro');
    await userEvent.click(boton('Generar'));
    const a = await screen.findByRole('alert');
    expect(a).toHaveTextContent('Créditos insuficientes');
    expect(a).toHaveTextContent('Escríbenos por el canal de la comunidad');
    expect(within(a).queryByRole('button', { name: 'Recargar' })).toBeNull();
    expect(cobros).toEqual([]);
  });

  it('imagenes.cobro.saldo_conocido_que_no_alcanza_no_cobra', async () => {
    ponerMonedero(1);
    const f = montar();
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await escribir('un faro');
    expect(boton('Generar')).toBeDisabled();
    expect(screen.getByText(/Te faltan/)).toBeInTheDocument();
    expect(posts(f)).toHaveLength(0);
  });

  it('imagenes.cobro.refresca_el_saldo_tras_cobrar', async () => {
    const cobros = oirCobros();
    montar();
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await escribir('un faro');
    await userEvent.click(boton('Generar'));
    await waitFor(() => expect(monedero.refrescar).toHaveBeenCalled());
    // el «−N» sale cuando lo creado ya pasó a editarse
    await waitFor(() => expect(cobros).toEqual([expect.objectContaining({ costo: P })]));
  });

  it('imagenes.cobro.en_vuelo_nada_cambia_la_imagen_ni_el_modo', async () => {
    let soltar!: (r: Response) => void;
    montar({ '/api/imagenes/editar': () => new Promise<Response>(r => (soltar = r)) });
    render(<Imagenes />);
    await subir();
    pintar();
    await escribir('una ventana');
    await userEvent.click(boton('Cambiar'));
    await waitFor(() => expect(screen.getByRole('radio', { name: /Transformar toda/ })).toBeDisabled());
    for (const n of ['Quitar imagen', 'Nueva imagen', 'Borrar zona']) expect(screen.getByRole('button', { name: n })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Grosor del pincel' })).toBeDisabled();
    // soltar o pegar otra imagen no la cambia bajo la petición
    const antes = deco.mock.calls.length;
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(drop, { dataTransfer: { types: ['Files'], files: [archivo()] } });
    document.dispatchEvent(drop);
    expect(deco.mock.calls.length).toBe(antes);
    await act(async () => soltar(json(OTRA)));
    expect(await screen.findByRole('img', { name: 'Tu imagen nueva' })).toBeInTheDocument();
  });

  it('imagenes.cobro.mientras_abre_una_imagen_no_se_envia', async () => {
    let abrir!: (d: { ancho: number; alto: number; fuente: CanvasImageSource }) => void;
    deco.mockImplementation(() => new Promise(r => (abrir = r)));
    montar();
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await userEvent.upload(document.querySelector('input[type=file]') as HTMLInputElement, archivo());
    expect(await screen.findByText('Abriendo tu imagen…')).toBeInTheDocument();
    expect(boton('Cambiar')).toBeDisabled();
    await act(async () => abrir({ ancho: 800, alto: 800, fuente: {} as CanvasImageSource }));
    expect(await screen.findByRole('img', { name: 'Tu imagen' })).toBeInTheDocument();
    expect(boton('Cambiar')).toBeEnabled();
  });

  it('imagenes.cobro.una_respuesta_sin_imagen_valida_no_se_pinta', async () => {
    montar({ '/api/imagenes': () => json({ nombre: 'x.jpg', url: 'javascript:alert(1)' }) });
    const { container } = render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await escribir('un faro');
    await userEvent.click(boton('Generar'));
    expect(await screen.findByRole('alert')).toHaveTextContent('no trae una imagen válida');
    expect(container.innerHTML).not.toContain('javascript:');
  });

  it('imagenes.cobro.un_solo_principal_por_vista', async () => {
    const ambar = () =>
      [...document.querySelectorAll('button')].filter(b => b.className.includes('bg-ambar')).map(b => b.textContent);
    montar();
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    expect(ambar()).toEqual([conPrecio('Generar')]);
    await subir();
    expect(ambar()).toEqual([conPrecio('Cambiar')]);
  });

  it('imagenes.espera.revisando_y_luego_trabajando_y_nunca_junto_al_error', async () => {
    let moderado!: (r: Response) => void;
    let soltar!: (r: Response) => void;
    montar({
      '/api/moderar': () => new Promise<Response>(r => (moderado = r)),
      '/api/imagenes': () => new Promise<Response>(r => (soltar = r)),
    });
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await escribir('un faro');
    await userEvent.click(boton('Generar'));
    expect(await screen.findByText('Revisando tu texto…')).toBeInTheDocument();
    await act(async () => moderado(json({ permitido: true })));
    expect(await screen.findByText('Creando tu imagen · ~20 s')).toBeInTheDocument();
    await act(async () => soltar(json({ detail: 'No se pudo generar la imagen: fal caído' }, 502)));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo generar la imagen');
    expect(screen.queryByText('Creando tu imagen · ~20 s')).toBeNull();
  });

  it('imagenes.resultado.lo_creado_pasa_a_editarse', async () => {
    const f = montar();
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await escribir('un faro');
    await userEvent.click(boton('Generar'));
    // la imagen de trabajo se pide a NUESTRO origen, nunca a la URL del CDN
    await waitFor(() => expect(f.mock.calls.some(c => c[0] === '/api/imagenes/aaaaaaaaaaaa.jpg/archivo')).toBe(true));
    expect(await screen.findByRole('img', { name: 'Tu imagen' })).toBeInTheDocument();
    expect(caja()).toHaveValue('');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Edita tu imagen');
    expect(screen.getByRole('link', { name: 'Descargar' })).toHaveAttribute('href', '/api/imagenes/aaaaaaaaaaaa.jpg/archivo');
    // «Nueva imagen» vuelve a crear con el texto de la que se creó
    await userEvent.click(screen.getByRole('button', { name: 'Nueva imagen' }));
    expect(caja()).toHaveValue('un faro');
    expect(boton('Generar')).toBeInTheDocument();
  });

  it('imagenes.resultado.quitar_no_tira_el_resultado_pagado', async () => {
    montar();
    render(<Imagenes />);
    await subir();
    pintar();
    await escribir('una ventana');
    await userEvent.click(boton('Cambiar'));
    await screen.findByRole('img', { name: 'Tu imagen nueva' });
    expect(screen.getByText('Enviar otra vez vuelve a aplicar el cambio sobre tu imagen.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tu imagen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Quitar imagen' }));
    expect(screen.getByRole('img', { name: 'Tu imagen nueva' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seguir editando' })).toBeInTheDocument();
  });

  it('imagenes.resultado.seguir_editando_no_pinta_una_version_vieja', async () => {
    let bajar!: (r: Response) => void;
    let n = 0;
    montar({ '/api/imagenes/bbbbbbbbbbbb.jpg': () => (n++ === 0 ? new Promise<Response>(r => (bajar = r)) : jpg()) });
    render(<Imagenes />);
    await subir();
    pintar();
    await escribir('una ventana');
    await userEvent.click(boton('Cambiar'));
    await screen.findByRole('img', { name: 'Tu imagen nueva' });
    const antes = deco.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Seguir editando' }));
    // mientras baja, se vuelve a la original: lo que llegue ya es viejo
    await userEvent.click(screen.getByRole('button', { name: 'Tu imagen' }));
    await act(async () => bajar(jpg()));
    expect(deco.mock.calls.length).toBe(antes);
  });

  it('imagenes.formato.con_imagen_lo_pone_ella_y_al_quitarla_vuelve_el_elegido', async () => {
    expect(formatoDe(1200, 800)).toBe('horizontal');
    expect(formatoDe(800, 1200)).toBe('vertical');
    expect(formatoDe(1000, 1100)).toBe('cuadrado');
    const f = montar();
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await userEvent.click(screen.getByRole('radio', { name: /Vertical/ }));
    await subir();
    await userEvent.click(screen.getByRole('button', { name: 'Quitar imagen' }));
    // sin imagen ni resultado, vuelve la cuadrícula de crear
    expect(screen.getByRole('radio', { name: /Vertical/ })).toHaveAttribute('aria-checked', 'true');
    await escribir('un faro');
    await userEvent.click(boton('Generar'));
    await waitFor(() => expect(posts(f)).toHaveLength(1));
    expect(JSON.parse(String(posts(f)[0]![1]!.body)).formato).toBe('vertical');
  });

  it('imagenes.vista.pedir_editar_en_el_texto_abre_el_editor', async () => {
    for (const s of ['edítala con más luz', 'retoca mi foto', 'quiero editar mis bocetos', 'EDITALO']) expect(quiereEditar(s)).toBe(true);
    for (const s of ['un editor de video', 'una foto de un gato', 'crédito']) expect(quiereEditar(s)).toBe(false);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    montar();
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await userEvent.type(caja(), 'edita mi foto');
    // no cambia a media palabra: espera a que deje de escribir
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('tu imagen');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(screen.getByText('Sube la imagen o el boceto que quieres editar')).toBeInTheDocument();
    expect(caja()).toHaveValue('edita mi foto');
    await userEvent.click(screen.getByRole('button', { name: 'No, quiero crear una imagen nueva' }));
    expect(boton('Generar')).toBeInTheDocument();
  });

  it('imagenes.paleta.atajos_sin_llm_y_el_comando_no_viaja', async () => {
    const f = montar();
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await userEvent.type(caja(), '/ver');
    const lista = screen.getByRole('listbox', { name: 'Atajos' });
    expect(within(lista).getByRole('option', { selected: true })).toHaveTextContent('/vertical');
    expect(screen.getByText(/1 atajos\. Flechas para elegir, Enter para usar\./)).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(caja()).toHaveValue('');
    expect(screen.getByRole('radio', { name: /Vertical/ })).toHaveAttribute('aria-checked', 'true');
    // los estilos también son atajos
    await userEvent.type(caja(), '/acu');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Acuarela' })).toHaveAttribute('aria-pressed', 'true');
    // «24/7» o una URL no abren la paleta
    await userEvent.type(caja(), 'abierto 24/7');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(f.mock.calls.filter(c => c[0] === '/api/moderar')).toHaveLength(0);
  });

  it('imagenes.paleta.nuevo_nunca_sale_marcado_y_las_flechas_se_anuncian', async () => {
    const e = paleta('/', ESTILOS, true, true);
    expect(e.sel).toBe(-1);
    expect(e.lista.at(-1)!.cmd).toBe('/nuevo');
    expect(paleta('/n', ESTILOS, true, true).sel).toBe(-1);
    expect(paleta('/n', ESTILOS, false, false).lista).toEqual([]);
    montar();
    render(<Imagenes />);
    await subir();
    await userEvent.type(caja(), '/');
    expect(caja()).not.toHaveAttribute('aria-activedescendant');
    // Enter con nada marcado no hace nada: la imagen sigue
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('img', { name: 'Tu imagen' })).toBeInTheDocument();
    await userEvent.keyboard('{ArrowDown}');
    const marcado = caja().getAttribute('aria-activedescendant')!;
    expect(document.getElementById(marcado)).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Escape}');
    expect(caja()).toHaveValue('');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('imagenes.enlace.solo_abre_una_imagen_con_nombre_valido', async () => {
    history.replaceState(null, '', '/estudio/imagenes/?img=../otro.jpg');
    const f = montar();
    const { unmount } = render(<Imagenes />);
    await screen.findByRole('button', { name: 'Elegir una imagen' });
    expect(f.mock.calls.some(c => String(c[0]).includes('otro'))).toBe(false);
    unmount();
    history.replaceState(null, '', '/estudio/imagenes/?img=aaaaaaaaaaaa.jpg');
    const g = montar();
    render(<Imagenes />);
    expect(await screen.findByRole('img', { name: 'Tu imagen' })).toBeInTheDocument();
    expect(g.mock.calls.some(c => c[0] === '/api/imagenes/aaaaaaaaaaaa.jpg/archivo')).toBe(true);
    expect(screen.getByRole('link', { name: 'Descargar' })).toHaveAttribute('href', '/api/imagenes/aaaaaaaaaaaa.jpg/archivo');
  });

  it('imagenes.enlace.si_no_abre_avisa_fuera_del_formulario', async () => {
    history.replaceState(null, '', '/estudio/imagenes/?img=aaaaaaaaaaaa.jpg');
    montar({ '/api/imagenes/aaaaaaaaaaaa.jpg': () => new Response('', { status: 404 }) });
    render(<Imagenes />);
    const a = await screen.findByRole('alert');
    expect(a).toHaveTextContent('No pude abrir tu imagen: Imagen no encontrada');
    // al cargar otra, el aviso sobra
    await subir();
    expect(screen.queryByText(/No pude abrir tu imagen/)).toBeNull();
  });

  it('imagenes.enlace.el_texto_del_inicio_llega_recortado', async () => {
    history.replaceState(null, '', '/estudio/imagenes/?prompt=' + 'a'.repeat(2500));
    montar();
    render(<Imagenes />);
    await waitFor(() => expect(caja()).toHaveValue('a'.repeat(2000)));
    expect(screen.getByText('2000/2000')).toBeInTheDocument();
  });

  it('imagenes.enlace.editar_abre_el_editor', async () => {
    history.replaceState(null, '', '/estudio/imagenes/?editar=1');
    montar();
    render(<Imagenes />);
    expect(await screen.findByText('Sube la imagen o el boceto que quieres editar')).toBeInTheDocument();
  });

  it('imagenes.estilos.si_no_llegan_se_avisa_y_se_sigue', async () => {
    const f = montar({ '/api/estilos': () => sinRed() });
    render(<Imagenes />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar los estilos. Recarga la página para elegir otro.');
    await escribir('un faro');
    await userEvent.click(boton('Generar'));
    await waitFor(() => expect(posts(f)).toHaveLength(1));
    expect(JSON.parse(String(posts(f)[0]![1]!.body)).estilo).toBe('animated');
  });

  it('imagenes.archivo.pegar_texto_gana_a_la_imagen', async () => {
    montar();
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    const pegar = (types: string[]) => {
      const e = new Event('paste', { bubbles: true, cancelable: true });
      Object.assign(e, { clipboardData: { types, files: [archivo()] } });
      act(() => {
        document.dispatchEvent(e);
      });
    };
    pegar(['text/plain', 'Files']);
    expect(deco).not.toHaveBeenCalled();
    pegar(['Files']);
    await waitFor(() => expect(deco).toHaveBeenCalledTimes(1));
  });

  it('imagenes.archivo.tipo_y_tamano_antes_de_abrir', async () => {
    montar();
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [archivo('image/gif')] } });
    expect(screen.getByRole('alert')).toHaveTextContent('Elige una imagen JPG, PNG o WebP.');
    fireEvent.change(input, { target: { files: [archivo('image/png', 15 * 1024 * 1024 + 1)] } });
    expect(screen.getByRole('alert')).toHaveTextContent('La imagen pasa de 15 MB.');
    expect(deco).not.toHaveBeenCalled();
  });

  it('imagenes.teclado.ctrl_enter_envia', async () => {
    const f = montar();
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await userEvent.type(caja(), 'un faro');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(posts(f)).toHaveLength(1));
  });

  it('imagenes.titulo.el_lector_oye_el_titulo_fijo', async () => {
    montar();
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName('Crea tu imagen');
    await subir();
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName('Edita tu imagen');
  });

  it('imagenes.textos.del_servidor_como_texto', async () => {
    const malo = '<img src=x onerror=alert(1)>';
    montar({ '/api/estilos': () => json([{ id: 'animated', nombre: malo, descripcion: malo }]) });
    const { container } = render(<Imagenes />);
    expect(await screen.findByRole('button', { name: malo })).toBeInTheDocument();
    expect(container.querySelector('img[onerror]')).toBeNull();
  });

  it('imagenes.marco.enlace_estudio_sin_version_anterior', async () => {
    montar();
    render(<Imagenes />);
    expect(screen.queryByRole('link', { name: 'Usar la versión anterior' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Estudio' })).toHaveAttribute('href', '/estudio/');
    await screen.findByRole('button', { name: 'Animado' });
  });
});
