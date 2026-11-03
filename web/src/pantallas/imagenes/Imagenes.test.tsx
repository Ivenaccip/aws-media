// Imágenes, como COMPORTAMIENTO. Cada test empieza por el ID de su invariante
// (tests/test_migracion_ui.py); el mapa contra las aserciones de
// static/imagenes.html está en docs/migracion/imagenes.md.
//
// jsdom no tiene canvas ni decodifica imágenes: el contexto 2D es de mentira
// y `decodificar` devuelve medidas fijas.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { urlDeCaja } from '../../marca/rutas';
import { ErrorApi } from '../../nucleo/api';
import { video } from '../../nucleo/tarifas';
import { json, llamadas, oirCobros, ponerMonedero, servidor, sinRed, type Ruta } from '../../prueba/servidor';
import { decodificar } from './decodificar';
import { Imagenes } from './Imagenes';
import { esperarImagen, formatoDe, paleta, quiereEditar, SigueEnCamino, type Estilo } from './logica';

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
    // UI·27: los pasos de verdad, y aquí no se cierra la pestaña (la espera es del navegador)
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Revisando tu texto');
    expect(screen.queryByText(/cerrar esta pestaña/)).toBeNull();
    await act(async () => moderado(json({ permitido: true })));
    expect(await screen.findByText('Creando tu imagen · ~20 s')).toBeInTheDocument();
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Creando tu imagen');
    expect(screen.getByText('Texto revisado')).toBeInTheDocument();
    await act(async () => soltar(json({ detail: 'No se pudo generar la imagen: fal caído' }, 502)));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo generar la imagen');
    expect(screen.queryByText('Creando tu imagen · ~20 s')).toBeNull();
  });

  it('UI·27: la imagen que se cobró y falló (502) se cuenta en tres partes; el texto se queda', async () => {
    montar({ '/api/imagenes': () => json({ detail: 'No se pudo generar la imagen: fal caído' }, 502) });
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await escribir('un faro');
    await userEvent.click(boton('Generar'));
    const falla = await screen.findByRole('alert');
    expect(falla).toHaveTextContent('Qué pasóNo pudimos crear tu imagen.');
    expect(falla).toHaveTextContent('Tus créditosTe devolvimos ✦ ' + video.imagen + ': no pagas por una imagen que no salió.');
    expect(falla).toHaveTextContent('Qué sigueTu texto sigue en la caja: vuelve a pulsar «Generar».');
    expect(screen.getByText('No se pudo generar la imagen: fal caído').closest('details')).not.toBeNull();
    expect(caja()).toHaveValue('un faro');
  });

  it('UI·27: lo que no cobró (402) no habla de devolver: sigue en una línea', async () => {
    montar({ '/api/imagenes': () => json({ detail: 'Créditos insuficientes: esta acción cuesta 2 créditos y tu saldo es 1.' }, 402) });
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await escribir('un faro');
    await userEvent.click(boton('Generar'));
    const a = await screen.findByRole('alert');
    expect(a).toHaveTextContent('Créditos insuficientes');
    expect(screen.queryByText('Qué pasó')).toBeNull();
    expect(screen.queryByText(/Te devolvimos/)).toBeNull();
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

// ── imágenes en segundo plano: los modelos que tardan contestan `lanzado` (ya se
// cobró) y la pantalla pregunta por el pedido cada 2 s hasta que sale
const ID = 'img-20261011-120000-abc123';
const RUTA_PEDIDO = '/api/imagenes/pedidos/' + ID;
const LANZADA = { lanzado: true, id: ID, creditos: P };
const ficha = (estado: string, extra: Record<string, unknown> = {}) => ({
  id: ID,
  estado,
  inicio: '2026-10-11T12:00:00+00:00',
  texto: 'un faro',
  modelo: 'nb2',
  creditos: P,
  nombre: '',
  url: '',
  error: '',
  ...extra,
});
const LISTA = ficha('listo', { nombre: HECHA.nombre, url: HECHA.url });
const preguntas = (f: ReturnType<typeof servidor>) => llamadas(f, RUTA_PEDIDO, 'GET').length;
const avanzar = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
// una Response sin streams: con los relojes de mentira el cuerpo de una real no siempre avanza
const rapida = (cuerpo: unknown, estado = 200) =>
  ({
    ok: estado < 400,
    status: estado,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
  }) as unknown as Response;

describe('imagenes en segundo plano', () => {
  it('imagenes.segundo_plano.lanzado_sondea_y_al_estar_lista_sigue_como_la_de_siempre', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const cobros = oirCobros();
    let estado = 'generando';
    const f = montar({
      '/api/imagenes': () => json(LANZADA),
      [RUTA_PEDIDO]: () => json(estado === 'listo' ? LISTA : ficha('generando')),
    });
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await escribir('un faro');
    await userEvent.click(boton('Generar'));
    await waitFor(() => expect(posts(f)).toHaveLength(1));
    // ya se cobró: el «−N» sale y la píldora se pone al día aunque la imagen aún no esté
    await waitFor(() => expect(cobros).toEqual([expect.objectContaining({ costo: P })]));
    expect(monedero.refrescar).toHaveBeenCalled();
    // mientras tanto, su espera de siempre
    expect(screen.getByText('Creando tu imagen · ~20 s')).toBeInTheDocument();
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Creando tu imagen');
    await avanzar(2100);
    expect(preguntas(f)).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('img', { name: 'Tu imagen' })).toBeNull();
    estado = 'listo';
    await avanzar(2100);
    // igual que si el POST hubiera devuelto {nombre, url}: la imagen pasa a editarse
    await waitFor(() => expect(f.mock.calls.some(c => c[0] === '/api/imagenes/aaaaaaaaaaaa.jpg/archivo')).toBe(true));
    expect(await screen.findByRole('img', { name: 'Tu imagen' })).toBeInTheDocument();
    expect(caja()).toHaveValue('');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Edita tu imagen');
    expect(screen.getByRole('link', { name: 'Descargar' })).toHaveAttribute('href', '/api/imagenes/aaaaaaaaaaaa.jpg/archivo');
    expect(cobros).toHaveLength(1);
    // y deja de preguntar
    const alFinal = preguntas(f);
    await avanzar(10000);
    expect(preguntas(f)).toBe(alFinal);
  });

  it('imagenes.segundo_plano.el_sondeo_es_cada_2_s_y_un_tropiezo_de_red_no_lo_corta', async () => {
    vi.useFakeTimers();
    let n = 0;
    const f = vi.fn(async () => {
      n++;
      if (n === 2) throw new TypeError('Failed to fetch'); // la red parpadea
      if (n === 3) return rapida({ detail: 'caído' }, 503); // y el servidor también
      return rapida(n < 4 ? ficha('generando') : LISTA);
    });
    vi.stubGlobal('fetch', f);
    const hecha = esperarImagen(ID);
    await avanzar(1999);
    expect(f).not.toHaveBeenCalled();
    await avanzar(1);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenLastCalledWith(RUTA_PEDIDO, expect.objectContaining({ method: 'GET' }));
    await avanzar(2000);
    expect(f).toHaveBeenCalledTimes(2);
    await avanzar(2000);
    expect(f).toHaveBeenCalledTimes(3);
    await avanzar(2000);
    await expect(hecha).resolves.toEqual(HECHA);
    expect(f).toHaveBeenCalledTimes(4);
    // el 404 de un pedido que no existe sí corta: no hay nada que esperar
    vi.stubGlobal('fetch', vi.fn(async () => rapida({ detail: 'no encontrado' }, 404)));
    const nada = expect(esperarImagen(ID)).rejects.toBeInstanceOf(ErrorApi);
    await avanzar(2000);
    await nada;
  });

  it('imagenes.segundo_plano.solo_un_404_corta_la_espera_de_un_pedido_ya_cobrado', async () => {
    vi.useFakeTimers();
    // ya se cobró y la imagen sigue en marcha: un 429, un 408, un 401/403 intermitente… son del camino,
    // no del pedido. Todos se toleran, como los 5xx y la red caída, hasta el tope.
    const tropiezos = [429, 408, 401, 403, 400, 409, 422];
    let n = 0;
    const f = vi.fn(async () => (n < tropiezos.length ? rapida({ detail: 'x' }, tropiezos[n++]) : rapida(LISTA)));
    vi.stubGlobal('fetch', f);
    let fin: unknown = null;
    void esperarImagen(ID).then(
      v => (fin = v),
      e => (fin = e),
    );
    for (let i = 0; i < tropiezos.length; i++) await avanzar(2000);
    expect(fin).toBeNull();
    expect(f).toHaveBeenCalledTimes(tropiezos.length);
    await avanzar(2000);
    expect(fin).toEqual(HECHA);
    expect(f).toHaveBeenCalledTimes(tropiezos.length + 1);

    // el único que corta es el 404 (el pedido no existe)
    vi.stubGlobal('fetch', vi.fn(async () => rapida({ detail: 'Pedido no encontrado' }, 404)));
    fin = null;
    void esperarImagen(ID).then(
      v => (fin = v),
      e => (fin = e),
    );
    await avanzar(2000);
    expect(fin).toBeInstanceOf(ErrorApi);
    expect((fin as ErrorApi).estado).toBe(404);
    vi.useRealTimers();

    // y en la pantalla: un 429 a media espera no suelta un error sobre una imagen ya cobrada; sigue esperando
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const cobros = oirCobros();
    let estado = 429;
    const g = montar({
      '/api/imagenes': () => json(LANZADA),
      [RUTA_PEDIDO]: () => (estado === 429 ? json({ message: 'Too Many Requests' }, 429) : json(LISTA)),
    });
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await escribir('un faro');
    await userEvent.click(boton('Generar'));
    await waitFor(() => expect(posts(g)).toHaveLength(1));
    await avanzar(2100);
    expect(preguntas(g)).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Creando tu imagen · ~20 s')).toBeInTheDocument();
    estado = 200;
    await avanzar(2100);
    expect(await screen.findByRole('img', { name: 'Tu imagen' })).toBeInTheDocument();
    // un solo cobro: nadie tuvo que pedirla otra vez
    expect(posts(g)).toHaveLength(1);
    expect(cobros).toHaveLength(1);
  });

  it('imagenes.segundo_plano.un_cuerpo_ilegible_en_el_sondeo_se_tolera_como_la_red_caida', async () => {
    vi.useFakeTimers();
    // el cuerpo de la respuesta no se pudo leer (un 502 con JSON vacío, un JSON a medias, la red que cae a
    // media lectura): sale de pedir() como SyntaxError o TypeError, no como ErrorApi. Es un tropiezo del camino
    // igual que la red caída: el pedido ya está cobrado y la imagen sigue en marcha.
    const ilegible = (estado: number, error: Error) =>
      ({
        ok: estado < 400,
        status: estado,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => {
          throw error;
        },
        text: async () => '',
      }) as unknown as Response;
    const tropiezos = [
      ilegible(502, new SyntaxError('Unexpected end of JSON input')),
      ilegible(200, new SyntaxError('Unexpected end of JSON input')),
      ilegible(200, new TypeError('network error')),
      ilegible(504, new TypeError('terminated')),
    ];
    let n = 0;
    const f = vi.fn(async () => (n < tropiezos.length ? tropiezos[n++]! : rapida(LISTA)));
    vi.stubGlobal('fetch', f);
    let fin: unknown = null;
    void esperarImagen(ID).then(
      v => (fin = v),
      e => (fin = e),
    );
    for (let i = 0; i < tropiezos.length; i++) await avanzar(2000);
    expect(fin).toBeNull();
    expect(f).toHaveBeenCalledTimes(tropiezos.length);
    await avanzar(2000);
    expect(fin).toEqual(HECHA);
    expect(f).toHaveBeenCalledTimes(tropiezos.length + 1);

    // lo que sí corta sigue cortando: el 404 (el pedido no existe)…
    vi.stubGlobal('fetch', vi.fn(async () => rapida({ detail: 'Pedido no encontrado' }, 404)));
    fin = null;
    void esperarImagen(ID).then(
      v => (fin = v),
      e => (fin = e),
    );
    await avanzar(2000);
    expect(fin).toBeInstanceOf(ErrorApi);
    expect((fin as ErrorApi).estado).toBe(404);

    // …y que la pantalla se cierre en mitad de la pregunta (no es un tropiezo: nadie espera ya)
    const control = new AbortController();
    const colgada = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_ok, mal) => {
          init?.signal?.addEventListener('abort', () => mal(new DOMException('Cancelado', 'AbortError')));
        }),
    );
    vi.stubGlobal('fetch', colgada);
    fin = null;
    void esperarImagen(ID, control.signal).then(
      v => (fin = v),
      e => (fin = e),
    );
    await avanzar(2000);
    expect(colgada).toHaveBeenCalledTimes(1);
    control.abort();
    await avanzar(0);
    expect(fin).toBeInstanceOf(DOMException);
    expect((fin as DOMException).name).toBe('AbortError');
    expect(colgada).toHaveBeenCalledTimes(1);
    vi.useRealTimers();

    // y en la pantalla: un cuerpo ilegible a media espera no suelta un error técnico sobre una imagen ya cobrada
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const cobros = oirCobros();
    let roto = true;
    const g = montar({
      '/api/imagenes': () => json(LANZADA),
      [RUTA_PEDIDO]: () => (roto ? ilegible(502, new SyntaxError('Unexpected end of JSON input')) : json(LISTA)),
    });
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await escribir('un faro');
    await userEvent.click(boton('Generar'));
    await waitFor(() => expect(posts(g)).toHaveLength(1));
    await avanzar(2100);
    expect(preguntas(g)).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Unexpected end of JSON input/)).toBeNull();
    expect(screen.getByText('Creando tu imagen · ~20 s')).toBeInTheDocument();
    roto = false;
    await avanzar(2100);
    expect(await screen.findByRole('img', { name: 'Tu imagen' })).toBeInTheDocument();
    // un solo cobro: nadie tuvo que pedirla otra vez
    expect(posts(g)).toHaveLength(1);
    expect(cobros).toHaveLength(1);
  });

  it('imagenes.segundo_plano.pasado_el_tope_de_5_min_dice_que_sigue_en_camino_sin_devolver_nada', async () => {
    // el tope exacto, sin pantalla: ni un segundo antes
    vi.useFakeTimers();
    const siempre = vi.fn(async () => rapida(ficha('generando')));
    vi.stubGlobal('fetch', siempre);
    let fin: unknown = null;
    void esperarImagen(ID).catch(e => (fin = e));
    await avanzar(5 * 60 * 1000 - 1);
    expect(fin).toBeNull();
    await avanzar(1);
    expect(fin).toBeInstanceOf(SigueEnCamino);
    expect((fin as Error).message).toMatch(/sigue en camino/);
    expect(siempre).toHaveBeenCalledTimes(150);
    vi.useRealTimers();

    // y en la pantalla: un aviso (no un error) que lleva al inicio; nada se devuelve
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const cobros = oirCobros();
    const f = montar({ '/api/imagenes': () => json(LANZADA), [RUTA_PEDIDO]: () => json(ficha('generando')) });
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await escribir('un faro');
    await userEvent.click(boton('Generar'));
    await waitFor(() => expect(posts(f)).toHaveLength(1));
    await avanzar(5 * 60 * 1000 + 5000);
    expect(await screen.findByText(/sigue en camino y está tardando más de lo normal\. Aparecerá en «Mis creaciones»/)).toBeInTheDocument();
    // «Mis creaciones» ya no está en el mapa (/estudio/): el enlace lleva a la caja, en la pestaña Imagen
    const inicio = screen.getByRole('link', { name: 'Ir al inicio' });
    expect(inicio).toHaveAttribute('href', urlDeCaja('imagenes'));
    expect(inicio).toHaveAttribute('href', '/estudio/marketing/distrito/imagen/');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Te devolvimos/)).toBeNull();
    expect(screen.queryByText('Creando tu imagen · ~20 s')).toBeNull();
    expect(boton('Generar')).toBeEnabled();
    expect(cobros).toHaveLength(1);
    const tras = preguntas(f);
    await avanzar(20000);
    expect(preguntas(f)).toBe(tras);
  });

  it('imagenes.segundo_plano.si_falla_se_cuenta_en_tres_partes_y_se_refresca_el_saldo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mensaje = 'La imagen no se pudo generar. Se te devolvieron los créditos.';
    montar({ '/api/imagenes': () => json(LANZADA), [RUTA_PEDIDO]: () => json(ficha('error', { error: mensaje })) });
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await escribir('un faro');
    await userEvent.click(boton('Generar'));
    await waitFor(() => expect(monedero.refrescar).toHaveBeenCalled());
    const antes = monedero.refrescar.mock.calls.length;
    await avanzar(2100);
    // el mismo camino de error que el 502 de siempre: tres partes y el texto se queda
    const falla = await screen.findByRole('alert');
    expect(falla).toHaveTextContent('Qué pasóNo pudimos crear tu imagen.');
    expect(falla).toHaveTextContent('Tus créditosTe devolvimos ✦ ' + video.imagen + ': no pagas por una imagen que no salió.');
    expect(falla).toHaveTextContent('Qué sigueTu texto sigue en la caja: vuelve a pulsar «Generar».');
    expect(screen.getByText(mensaje).closest('details')).not.toBeNull();
    expect(caja()).toHaveValue('un faro');
    expect(screen.queryByText('Creando tu imagen · ~20 s')).toBeNull();
    expect(boton('Generar')).toBeEnabled();
    // el worker ya devolvió: la píldora vuelve a subir
    expect(monedero.refrescar.mock.calls.length).toBeGreaterThan(antes);
  });

  it('imagenes.segundo_plano.al_cerrar_la_pantalla_se_deja_de_preguntar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = montar({ '/api/imagenes': () => json(LANZADA), [RUTA_PEDIDO]: () => json(ficha('generando')) });
    const { unmount } = render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await escribir('un faro');
    await userEvent.click(boton('Generar'));
    await waitFor(() => expect(posts(f)).toHaveLength(1));
    await avanzar(2100);
    expect(preguntas(f)).toBeGreaterThanOrEqual(1);
    unmount();
    const alCerrar = preguntas(f);
    await avanzar(30000);
    expect(preguntas(f)).toBe(alCerrar);
  });

  it('imagenes.segundo_plano.la_respuesta_de_siempre_no_sondea', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = montar(); // POST /api/imagenes contesta {nombre, url}
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await escribir('un faro');
    await userEvent.click(boton('Generar'));
    expect(await screen.findByRole('img', { name: 'Tu imagen' })).toBeInTheDocument();
    await avanzar(20000);
    expect(f.mock.calls.filter(c => String(c[0]).startsWith('/api/imagenes/pedidos'))).toHaveLength(0);
    // un `lanzado` sin id no es una imagen: no se sondea nada y se dice
    const g = montar({ '/api/imagenes': () => json({ lanzado: true }) });
    await userEvent.click(screen.getByRole('button', { name: 'Nueva imagen' }));
    await userEvent.click(boton('Generar'));
    expect(await screen.findByRole('alert')).toHaveTextContent('no trae una imagen válida');
    expect(g.mock.calls.filter(c => String(c[0]).startsWith('/api/imagenes/pedidos'))).toHaveLength(0);
  });

  it('imagenes.segundo_plano.tres_en_marcha_se_dice_sin_hablar_de_devolver', async () => {
    const cobros = oirCobros();
    montar({ '/api/imagenes': () => json({ detail: 'Ya tienes 3 imágenes generándose — espera a que terminen.' }, 409) });
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await escribir('un faro');
    await userEvent.click(boton('Generar'));
    const a = await screen.findByRole('alert');
    expect(a).toHaveTextContent('Ya tienes 3 imágenes generándose — espera a que terminen.');
    // nada se cobró: no hay «Qué pasó» ni «Te devolvimos»
    expect(screen.queryByText('Qué pasó')).toBeNull();
    expect(screen.queryByText(/Te devolvimos/)).toBeNull();
    expect(cobros).toEqual([]);
    expect(caja()).toHaveValue('un faro');
  });

  it('imagenes.segundo_plano.el_orbe_no_manda_a_pedirla_otra_vez', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const textos: string[] = [];
    let alAgotar: (() => void) | undefined;
    window.orbe = {
      montar: vi.fn((_el, op) => {
        alAgotar = op.alAgotar;
        const m = { texto: (t: string) => (textos.push(t), m), estado: () => m, latir: () => m, apagar: () => m, desmontar: vi.fn() };
        return m as never;
      }),
      soportado: () => true,
      precargar: vi.fn(),
    };
    montar({ '/api/imagenes': () => json(LANZADA), [RUTA_PEDIDO]: () => json(ficha('generando')) });
    render(<Imagenes />);
    await screen.findByRole('button', { name: 'Animado' });
    await escribir('un faro');
    await userEvent.click(boton('Generar'));
    await waitFor(() => expect(window.orbe!.montar).toHaveBeenCalled());
    await avanzar(2100);
    // el orbe se agota estando la imagen en camino: ya se cobró, no hay que repetirla
    alAgotar!();
    expect(textos.at(-1)).toMatch(/No la pidas otra vez/);
    expect(textos.at(-1)).not.toMatch(/inténtalo otra vez/);
    delete window.orbe;
  });
});
