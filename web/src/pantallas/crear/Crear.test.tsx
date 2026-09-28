// Crear, como COMPORTAMIENTO. Cada test empieza por el ID de su invariante
// (tests/test_migracion_ui.py); el mapa contra las aserciones de
// static/crear.html está en docs/migracion/crear.md.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { video } from '../../nucleo/tarifas';
import { NOMBRE_MINIATURA, tocarMiniatura } from '../../nucleo/transiciones';
import { json, llamadas, oirCobros, ponerMonedero, servidor, sinRed, type Ruta } from '../../prueba/servidor';
import { Crear } from './Crear';
import { avanceDe, costoProducir, DURACIONES, precioDe, SIN_AVANCE, type Proyecto } from './logica';

const ESTILOS = [
  { id: 'animated', nombre: 'Animado', descripcion: 'Dibujo animado de colores planos' },
  { id: 'real', nombre: 'Realista', descripcion: 'Como una foto' },
  { id: 'custom', nombre: 'Personalizado', descripcion: '' },
];

const P: Proyecto = {
  id: 'p1',
  estado: 'revision',
  etapa: null,
  brief: 'Un gato en la luna',
  duracion_s: 30,
  pipeline: 'escenas',
  narracion: null,
  guion: [{ narracion: 'Había una vez un gato.' }, { narracion: 'Llegó a la luna.' }],
  personaje: {
    nombre: 'Michi',
    descripcion: 'un gato gris',
    opciones: [{ path: '/w/p1/personaje/opcion_1.jpg' }, { path: '/w/p1/personaje/opcion_2.jpg' }],
    elegida: null,
  },
  voces: [
    { id: 'Lucia', nivel: 'verde', motivo: 'Cálida, para cuentos' },
    { id: 'Mateo', nivel: 'rojo', motivo: 'Muy grave para esto' },
  ],
  voz: null,
  dossier: null,
  fuentes: [],
  progreso: {},
  resultado: null,
  error: null,
  cobrado_producir: null,
};
const PRODUCIR = costoProducir(30)!; // 90 hoy
const TOTAL_30 = precioDe(30)!;
const EST = { escenas: 2, total: 0.42, minutos: 3, creditos: PRODUCIR, creditos_saldo: 500 };

function montar(rutas: Record<string, Ruta> = {}) {
  return servidor({
    '/api/estilos': () => json(ESTILOS),
    '/api/moderar': () => json({ permitido: true }),
    '/api/proyectos': () => json({ ...P, estado: 'creado' }),
    '/api/proyectos/p1': () => json(P),
    '/api/proyectos/p1/estimacion': () => json(EST),
    '/api/proyectos/p1/guion': () => json(P),
    '/api/proyectos/p1/personaje': () => json(P),
    '/api/proyectos/p1/producir': () => json({ ...P, estado: 'produciendo', etapa: 'encolado' }),
    ...rutas,
  });
}

function ir(q = '') {
  window.history.replaceState(null, '', '/estudio/crear/' + q);
}

/** Abre ?p=p1 con el proyecto que se diga (o una función por llamada). */
function abrir(p: Proyecto | (() => Response | Promise<Response>), rutas: Record<string, Ruta> = {}) {
  ir('?p=p1');
  const f = montar({ '/api/proyectos/p1': typeof p === 'function' ? p : () => json(p), ...rutas });
  render(<Crear />);
  return f;
}

let monedero: ReturnType<typeof ponerMonedero>;
let blobs = 0;
beforeEach(() => {
  vi.unstubAllGlobals();
  monedero = ponerMonedero(500);
  ir();
  blobs = 0;
  URL.createObjectURL = vi.fn(() => 'blob:x' + blobs++);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  delete window.monedero;
});

async function avanzar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const generar = () => screen.getByRole('button', { name: 'Generar ' + '✦' + ' ' + video.preparar });
const cuerpoDe = (f: ReturnType<typeof servidor>, ruta: string, metodo = 'POST') =>
  llamadas(f, ruta, metodo).map(c => c[1]?.body);
const png = (n: string) => new File(['x'], n, { type: 'image/png' });

async function escribir(t = 'Un gato que viaja a la luna') {
  await userEvent.type(screen.getByLabelText('De qué trata tu video'), t);
}

describe('crear · formulario', () => {
  it('crear.formulario.estilos_radiogroup_muestra_y_personalizado', async () => {
    montar();
    render(<Crear />);
    const grupo = await screen.findByRole('radiogroup', { name: 'Estilo visual' });
    expect(within(grupo).getByRole('radio', { name: 'Animado' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Dibujo animado de colores planos')).toBeInTheDocument();
    expect(screen.getByAltText('Ejemplo del estilo elegido')).toHaveAttribute('src', '/estilos/animated.jpg');
    await userEvent.click(within(grupo).getByRole('radio', { name: 'Personalizado' }));
    expect(within(grupo).getByRole('radio', { name: 'Personalizado' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByAltText('Ejemplo del estilo elegido')).toBeNull();
    await waitFor(() => expect(screen.getByLabelText('Describe tu estilo')).toHaveFocus());
  });

  it('crear.formulario.sin_estilos_dice_con_cual_sale', async () => {
    montar({ '/api/estilos': () => sinRed() });
    render(<Crear />);
    expect(await screen.findByText(/No pudimos cargar los estilos. Tu video saldrá en Animado/)).toBeInTheDocument();
  });

  it('crear.formulario.brief_y_modo_llegan_por_la_url', async () => {
    ir('?brief=' + encodeURIComponent('un gato en la luna') + '&modo=investigacion');
    montar();
    render(<Crear />);
    expect(screen.getByLabelText('De qué trata tu video')).toHaveValue('un gato en la luna');
    expect(screen.getByRole('button', { name: 'Investigación' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Investigamos el tema con fuentes y escribimos el guion.')).toBeInTheDocument();
    expect(screen.getByText('18/5000')).toBeInTheDocument();
  });

  it('crear.formulario.modo_segundo_clic_suelta', async () => {
    montar();
    render(<Crear />);
    const idea = screen.getByRole('button', { name: 'Tengo una idea' });
    await userEvent.click(idea);
    expect(idea).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Investigación' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(idea);
    expect(idea).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText(/se corta en escenas tal cual/)).toBeNull();
  });

  it('crear.formulario.imagenes_hasta_cuatro_y_se_quitan', async () => {
    montar();
    const { container } = render(<Crear />);
    expect(screen.queryByLabelText('Detalles del personaje (opcional)')).toBeNull();
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
    await userEvent.upload(input, [png('a.png'), png('b.png'), png('c.png')]);
    expect(screen.getAllByAltText(/de tu personaje$/)).toHaveLength(3);
    expect(screen.getByLabelText('Detalles del personaje (opcional)')).toBeInTheDocument();
    await userEvent.upload(input, [png('d.png'), png('e.png')]);
    expect(screen.getAllByAltText(/de tu personaje$/)).toHaveLength(4);
    expect(screen.getByRole('alert')).toHaveTextContent('Caben 4 imágenes del personaje; 1 se quedó fuera.');
    expect(screen.getByRole('button', { name: 'Subir la imagen de tu personaje' })).toBeDisabled();
    // soltar un archivo que no es imagen no cuenta
    const caja = screen.getByRole('region', { name: 'Tu video' });
    fireEvent.drop(caja, { dataTransfer: { files: [new File(['x'], 'n.txt', { type: 'text/plain' })], types: ['Files'] } });
    expect(screen.getAllByAltText(/de tu personaje$/)).toHaveLength(4);
    await userEvent.click(screen.getByRole('button', { name: 'Quitar b.png' }));
    expect(screen.getAllByAltText(/de tu personaje$/)).toHaveLength(3);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x1');
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Quitar a.png' })).toHaveFocus());
  });

  it('crear.formulario.duracion_de_la_tabla_con_teclado_y_limites', async () => {
    montar();
    render(<Crear />);
    const reloj = screen.getByRole('spinbutton', { name: 'Duración del video' });
    expect(reloj).toHaveAttribute('aria-valuenow', '30');
    expect(reloj).toHaveTextContent('0:30');
    await userEvent.click(screen.getByRole('button', { name: 'Sumar 5 segundos' }));
    expect(reloj).toHaveAttribute('aria-valuenow', '35');
    fireEvent.keyDown(reloj, { key: 'End' });
    expect(reloj).toHaveAttribute('aria-valuenow', String(DURACIONES[DURACIONES.length - 1]));
    expect(reloj).toHaveAttribute('aria-valuetext', '1 minuto');
    expect(screen.getByRole('button', { name: 'Sumar 5 segundos' })).toBeDisabled();
    fireEvent.keyDown(reloj, { key: 'Home' });
    expect(reloj).toHaveAttribute('aria-valuenow', String(DURACIONES[0]));
    expect(screen.getByRole('button', { name: 'Quitar 5 segundos' })).toBeDisabled();
    fireEvent.keyDown(reloj, { key: 'ArrowUp' });
    expect(reloj).toHaveAttribute('aria-valuenow', String(DURACIONES[1]));
    expect(reloj).toHaveAttribute('aria-valuetext', DURACIONES[1] + ' segundos');
  });
});

describe('crear · cobro al empezar', () => {
  it('crear.cobro.generar_dice_lo_de_ahora_y_el_total_junto_a_la_duracion', async () => {
    montar();
    render(<Crear />);
    // el botón dice lo que se cobra AL TOCARLO (el guion), no el total
    expect(generar()).toBeInTheDocument();
    expect(screen.getByText('Película de 0:30:')).toHaveTextContent('Película de 0:30: ✦ ' + precioDe(30) + ' en total');
    expect(
      screen.getByText(
        'Ahora se cobran ' + video.preparar + ' créditos por la historia y el personaje; los otros ' +
          (precioDe(30)! - video.preparar) + ', al producir, cuando apruebes el guion.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sumar 5 segundos' }));
    expect(screen.getByText('Película de 0:35:')).toHaveTextContent('✦ ' + precioDe(35) + ' en total');
    expect(generar()).toBeInTheDocument();
  });

  it('crear.cobro.generar_sin_saldo_para_el_guion_no_cobra', async () => {
    const cobros = oirCobros();
    ponerMonedero(video.preparar - 3);
    const f = montar();
    render(<Crear />);
    await escribir();
    expect(generar()).toBeDisabled();
    expect(screen.getByText(/Te faltan ✦ 3/)).toBeInTheDocument();
    await userEvent.click(generar());
    expect(llamadas(f, '/api/proyectos')).toHaveLength(0);
    expect(llamadas(f, '/api/moderar')).toHaveLength(0);
    expect(cobros).toEqual([]);
  });

  it('crear.cobro.alcanza_para_el_guion_y_no_para_producir_se_dice', async () => {
    ponerMonedero(40);
    montar();
    render(<Crear />);
    expect(generar()).toBeEnabled();
    expect(
      screen.getByText('Te alcanza para el guion; para producir te faltarán ' + (precioDe(30)! - 40) + ' créditos (saldo: 40).'),
    ).toBeInTheDocument();
  });

  it('crear.cobro.generar_doble_clic_una_pelicula', async () => {
    const cobros = oirCobros();
    let soltar!: (r: Response) => void;
    const f = montar({ '/api/proyectos': () => new Promise<Response>(r => (soltar = r)) });
    render(<Crear />);
    await escribir();
    act(() => {
      generar().click();
      generar().click();
    });
    await waitFor(() => expect(llamadas(f, '/api/proyectos')).toHaveLength(1));
    await act(async () => soltar(json({ ...P, estado: 'creado' })));
    expect(llamadas(f, '/api/proyectos')).toHaveLength(1);
    expect(monedero.refrescar).toHaveBeenCalled();
    // UI·19: un doble clic es UN cobro y un solo «−N»
    expect(cobros).toEqual([expect.objectContaining({ costo: video.preparar })]);
  });

  it('crear.cobro.el_pedido_se_arma_antes_de_moderar_y_la_rejilla_queda_inerte', async () => {
    let moderado!: (r: Response) => void;
    const f = montar({ '/api/moderar': () => new Promise<Response>(r => (moderado = r)) });
    render(<Crear />);
    await escribir('Primero');
    await userEvent.click(generar());
    await waitFor(() => expect(llamadas(f, '/api/moderar')).toHaveLength(1));
    expect(screen.getByLabelText('De qué trata tu video').closest('[inert]')).not.toBeNull();
    expect(screen.getByText('Revisando tu texto…')).toBeInTheDocument();
    // lo que se toque durante la revisión ya no cambia lo que se cobra
    fireEvent.change(screen.getByLabelText('De qué trata tu video'), { target: { value: 'Otra cosa' } });
    await act(async () => moderado(json({ permitido: true })));
    await waitFor(() => expect(llamadas(f, '/api/proyectos')).toHaveLength(1));
    const fd = llamadas(f, '/api/proyectos')[0]![1]!.body as FormData;
    expect(fd.get('brief')).toBe('Primero');
  });

  it('crear.cobro.moderacion_rechaza_sin_llamar_y_explica', async () => {
    const cobros = oirCobros();
    const f = montar({
      '/api/moderar': () => json({ permitido: false, mensaje: 'La IA no permite violencia explícita.', motivo: 'Habla de sangre.' }),
    });
    render(<Crear />);
    await escribir();
    await userEvent.click(generar());
    const d = await screen.findByRole('dialog', { name: 'Revisa tu texto' });
    expect(d).toHaveTextContent('La IA no permite violencia explícita.');
    expect(d).toHaveTextContent('Habla de sangre.');
    expect(llamadas(f, '/api/proyectos')).toHaveLength(0);
    expect(cobros).toEqual([]);
    await userEvent.click(within(d).getByRole('button', { name: 'Entendido, lo edito' }));
    await waitFor(() => expect(screen.getByLabelText('De qué trata tu video')).toHaveFocus());
    expect(generar()).toBeEnabled();
  });

  it('crear.cobro.brief_vacio_no_llama', async () => {
    const cobros = oirCobros();
    const f = montar();
    render(<Crear />);
    await userEvent.type(screen.getByLabelText('De qué trata tu video'), '   ');
    await userEvent.click(generar());
    expect(screen.getByRole('alert')).toHaveTextContent('Describe tu video primero.');
    expect(screen.getByLabelText('De qué trata tu video')).toHaveFocus();
    expect(f.mock.calls.filter(c => c[0] === '/api/moderar' || c[0] === '/api/proyectos')).toHaveLength(0);
    expect(cobros).toEqual([]);
  });

  it('crear.cobro.slots_409_avisa_y_balanceador_pregunta_y_fuerza', async () => {
    const cobros = oirCobros();
    let n = 0;
    const f = montar({
      '/api/proyectos': () =>
        n++ === 0
          ? json({ detail: { slots: 5, aviso: 'Ya tienes 5 proyectos activos. Archiva uno.' } }, 409)
          : n === 2
            ? json({ detail: { balanceador: 'Hablas de cocina y tu canal es de tecnología.', aviso: '…' } }, 409)
            : json({ ...P, estado: 'creado' }),
    });
    render(<Crear />);
    await escribir();
    await userEvent.click(generar());
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya tienes 5 proyectos activos. Archiva uno.');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await userEvent.click(generar());
    const d = await screen.findByRole('alertdialog', { name: '¿Crear de todos modos?' });
    expect(d).toHaveTextContent('Hablas de cocina y tu canal es de tecnología.');
    // lo que no se puede deshacer nunca es la opción por defecto
    expect(within(d).getByRole('button', { name: 'No, la cambio' })).toHaveFocus();
    await userEvent.click(within(d).getByRole('button', { name: 'Sí, crearla' }));
    await waitFor(() => expect(llamadas(f, '/api/proyectos')).toHaveLength(3));
    const forzado = llamadas(f, '/api/proyectos')[2]![1]!.body as FormData;
    expect(forzado.get('forzar')).toBe('true');
    // forzar ya pasó una vez por la moderación
    expect(llamadas(f, '/api/moderar')).toHaveLength(2);
    // los dos 409 no cobraron, y el forzado sale del diálogo, no del botón: no vuela nada
    expect(cobros).toEqual([]);
  });

  it('crear.cobro.un_402_dice_a_quien_escribir', async () => {
    const cobros = oirCobros();
    ponerMonedero(500, false);
    montar({
      '/api/proyectos': () => json({ detail: 'Créditos insuficientes: esta acción cuesta 10 créditos y tu saldo es 4.' }, 402),
    });
    render(<Crear />);
    await escribir();
    await userEvent.click(generar());
    const a = await screen.findByRole('alert');
    expect(a).toHaveTextContent('Créditos insuficientes: esta acción cuesta 10 créditos y tu saldo es 4.');
    expect(a).toHaveTextContent('Escríbenos por el canal de la comunidad para conseguir más.');
    expect(cobros).toEqual([]);
  });

  it('crear.crear.manda_todos_los_campos_y_pone_p_en_la_url', async () => {
    ir('?pipeline=narracion');
    const f = montar();
    const { container } = render(<Crear />);
    await userEvent.click(await screen.findByRole('radio', { name: 'Realista' }));
    await escribir('Un gato');
    await userEvent.click(screen.getByRole('button', { name: 'Tengo una idea' }));
    await userEvent.type(screen.getByLabelText('Rubro de tu canal (opcional)'), 'mascotas');
    await userEvent.click(screen.getByRole('radio', { name: /Vertical/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Quitar 5 segundos' }));
    await userEvent.upload(container.querySelector<HTMLInputElement>('input[type=file]')!, [png('michi.png')]);
    await userEvent.type(screen.getByLabelText('Detalles del personaje (opcional)'), 'con sombrero');
    await userEvent.click(generar());
    await waitFor(() => expect(llamadas(f, '/api/proyectos')).toHaveLength(1));
    const fd = llamadas(f, '/api/proyectos')[0]![1]!.body as FormData;
    expect(Object.fromEntries([...fd.entries()].filter(([k]) => k !== 'referencias'))).toEqual({
      brief: 'Un gato',
      estilo: 'real',
      estilo_custom: '',
      duracion_s: '25',
      modo: 'idea',
      rubro: 'mascotas',
      personaje_extra: 'con sombrero',
      formato: 'vertical',
      pipeline: 'narracion',
    });
    expect((fd.getAll('referencias')[0] as File).name).toBe('michi.png');
    expect(JSON.parse(String(llamadas(f, '/api/moderar')[0]![1]!.body))).toEqual({ texto: 'Un gato\ncon sombrero' });
    expect(location.search).toBe('?p=p1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Escribiendo tu guion' })).toBeInTheDocument();
  });
});

describe('crear · la espera', () => {
  it('crear.progreso.pasos_y_barra_no_retroceden', () => {
    // producir cobra el total de la duración menos el guion ya pagado
    expect(PRODUCIR).toBe(TOTAL_30 - video.preparar);
    const prep = (etapa: string) => ({ ...P, estado: 'preparando' as const, etapa });
    let a = avanceDe(prep('guion'), SIN_AVANCE);
    expect(a).toEqual({ estado: 'preparando', pct: 50, paso: 1 });
    a = avanceDe(prep('inicio'), a); // un reintento del worker no mueve la barra hacia atrás
    expect(a).toEqual({ estado: 'preparando', pct: 50, paso: 1 });
    // otra fase empieza de cero
    const prod = avanceDe({ ...P, estado: 'produciendo', etapa: 'tts' }, a);
    expect(prod).toEqual({ estado: 'produciendo', pct: 25, paso: 1 });
    const media = avanceDe({ ...P, estado: 'produciendo', etapa: 'media', progreso: { escenas_total: 4, escenas_listas: 2 } }, prod);
    expect(media).toEqual({ estado: 'produciendo', pct: 65, paso: 2 });
    // narración: el tts después del director no retrocede
    expect(avanceDe({ ...P, estado: 'produciendo', etapa: 'director' }, media).paso).toBe(2);
    // una etapa que no conocemos no se inventa un paso
    expect(avanceDe({ ...P, estado: 'produciendo', etapa: 'rara' }, SIN_AVANCE)).toEqual({ estado: 'produciendo', pct: 5, paso: 1 });
  });

  it('crear.progreso.falta_con_estimacion_y_sin_ella_nada', async () => {
    const prod: Proyecto = { ...P, estado: 'produciendo', etapa: 'media', progreso: { escenas_total: 6, escenas_listas: 2 } };
    let n = 0;
    const f = abrir(prod, { '/api/proyectos/p1/estimacion': () => (n++ ? json(EST) : json({ ...EST, minutos: 12 })) });
    expect(await screen.findByRole('heading', { level: 1, name: 'Produciendo tu película' })).toBeInTheDocument();
    // la barra: 40 + 50 · 2/6 = 56.67 %; faltan 12 · (100 − 56.67) / 100 ≈ 5 min
    expect(await screen.findByText('Faltan unos 5 min.')).toBeInTheDocument();
    const pasos = screen.getByRole('list', { name: 'Pasos' });
    expect(within(pasos).getByText('Animando las escenas · 2 de 6')).toBeInTheDocument();
    expect(within(pasos).getByText('Voz grabada')).toBeInTheDocument();
    expect(within(pasos).getByText('Unir el video')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Avance' })).toHaveAttribute('aria-valuenow', '57');
    expect(screen.getByText(/Puedes cerrar esta pestaña/)).toBeInTheDocument();
    // la estimación que manda es la del texto aprobado, y solo una vez
    expect(cuerpoDe(f, '/api/proyectos/p1/estimacion')).toEqual([
      JSON.stringify({ escenas: ['Había una vez un gato.', 'Llegó a la luna.'] }),
    ]);
  });

  it('crear.progreso.sin_estimacion_no_promete_minutos', async () => {
    abrir({ ...P, estado: 'produciendo', etapa: 'tts' }, { '/api/proyectos/p1/estimacion': () => sinRed() });
    expect(await screen.findByText('Grabando la voz')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Faltan unos|Falta alrededor/)).toBeNull());
  });

  it('crear.progreso.sondea_hasta_terminal_y_duerme_oculta', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const seq: Proyecto[] = [
      { ...P, estado: 'preparando', etapa: 'clasificar' },
      { ...P, estado: 'preparando', etapa: 'guion' },
      { ...P, estado: 'revision' },
    ];
    let i = 0;
    const f = abrir(() => json(seq[Math.min(i++, seq.length - 1)]));
    const gets = () => f.mock.calls.filter(c => c[0] === '/api/proyectos/p1' && (c[1]?.method ?? 'GET') === 'GET').length;
    expect(await screen.findByText('Entendiendo tu idea')).toBeInTheDocument();
    expect(gets()).toBe(1);
    // con la pestaña oculta el sondeo duerme
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await avanzar(10000);
    expect(gets()).toBe(1);
    // al volver se pregunta YA
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const pasos = screen.getByRole('list', { name: 'Pasos' });
    await waitFor(() => expect(within(pasos).getByText('Escribiendo el guion')).toBeInTheDocument());
    expect(within(pasos).getByText('Idea entendida')).toBeInTheDocument();
    // la etapa fina la dice el orbe (o su texto, sin orbe.js)
    expect(screen.getByRole('status')).toHaveTextContent('Escribiendo el guion');
    await avanzar(2500);
    expect(await screen.findByRole('heading', { level: 1, name: 'Revisa tu película' })).toBeInTheDocument();
    const antes = gets();
    await avanzar(10000);
    expect(gets()).toBe(antes); // en revisión la película espera al usuario: no se pregunta más
    Reflect.deleteProperty(document, 'hidden');
    cleanup();
    // abierta ya en un estado terminal, ni siquiera empieza a sondear
    const g = abrir({ ...P, estado: 'listo', progreso: { editor: 'gen-p1' } });
    expect(await screen.findByRole('heading', { level: 1, name: 'Película lista' })).toBeInTheDocument();
    await avanzar(10000);
    expect(g.mock.calls.filter(c => c[0] === '/api/proyectos/p1')).toHaveLength(1);
  });

  it('crear.progreso.sin_red_avisa_y_el_orbe_reposa', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const estados: string[] = [];
    window.orbe = {
      montar: vi.fn(() => {
        const m = { texto: () => m, estado: (e: string) => (estados.push(e), m), latir: () => m, apagar: () => m, desmontar: vi.fn() };
        return m as never;
      }),
      soportado: () => true,
      precargar: vi.fn(),
    };
    let n = 0;
    abrir(() => (n++ === 0 || n > 3 ? json({ ...P, estado: 'produciendo', etapa: 'tts' }) : sinRed()));
    await waitFor(() => expect(window.orbe!.montar).toHaveBeenCalled());
    await avanzar(2500);
    expect(screen.queryByText(/Sin conexión/)).toBeNull(); // un fallo no basta
    await avanzar(2500);
    expect(await screen.findByText('Sin conexión, reintentando… Tu trabajo sigue en la nube.')).toBeInTheDocument();
    expect(estados.at(-1)).toBe('idle');
    await avanzar(5000);
    await waitFor(() => expect(screen.queryByText(/Sin conexión/)).toBeNull());
    expect(estados.at(-1)).toBe('pensando');
    expect(window.orbe.precargar).toHaveBeenCalledTimes(1);
    delete window.orbe;
  });

  it('crear.reanudar.p_en_la_url_abre_la_pelicula_y_si_falla_reintentar', async () => {
    let n = 0;
    ir('?p=p1');
    const f = montar({ '/api/proyectos/p1': () => (n++ === 0 ? sinRed() : json(P)) });
    render(
      <StrictMode>
        <Crear />
      </StrictMode>,
    );
    const a = await screen.findByRole('alert');
    expect(a).toHaveTextContent('No pudimos abrir esa película. Revisa tu conexión e inténtalo de nuevo.');
    expect(f.mock.calls.filter(c => c[0] === '/api/proyectos/p1')).toHaveLength(1);
    await userEvent.click(within(a).getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Revisa tu película' })).toBeInTheDocument();
    expect(screen.queryByText(/No pudimos abrir/)).toBeNull();
  });
});

describe('crear · revisión', () => {
  it('crear.revision.personaje_elegir_y_crear_opciones_gratis', async () => {
    const cobros = oirCobros();
    const sin: Proyecto = { ...P, personaje: { ...P.personaje, opciones: [] } };
    const f = abrir(sin, { '/api/proyectos/p1/personaje/generar': () => json(P) });
    expect(await screen.findByText('Sin costo: va incluido en los créditos del guion.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Crear 2 opciones' }));
    const op2 = await screen.findByRole('button', { name: 'Opción 2 del personaje' });
    expect(op2.querySelector('img')).toHaveAttribute('src', '/api/proyectos/p1/archivo/personaje/opcion_2.jpg');
    expect(llamadas(f, '/api/proyectos/p1/personaje/generar')).toHaveLength(1);
    await userEvent.click(op2);
    expect(op2).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Opción 1 del personaje' })).toHaveAttribute('aria-pressed', 'false');
    expect(monedero.refrescar).not.toHaveBeenCalled();
    expect(cobros).toEqual([]);
  });

  it('crear.revision.crear_opciones_si_falla_lo_dice', async () => {
    abrir({ ...P, personaje: { ...P.personaje, opciones: [] } }, {
      '/api/proyectos/p1/personaje/generar': () => json({ detail: 'No se pudieron generar las opciones.' }, 502),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Crear 2 opciones' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron generar las opciones.');
    expect(screen.getByRole('button', { name: 'Crear 2 opciones' })).toBeEnabled();
  });

  it('crear.revision.cambiar_personaje_cobra_imagen_y_valida_antes', async () => {
    const cobros = oirCobros();
    const nuevo: Proyecto = {
      ...P,
      personaje: { ...P.personaje, opciones: [...P.personaje.opciones, { path: '/w/p1/personaje/opcion_3.jpg' }], elegida: 2 },
    };
    const f = abrir(P, { '/api/proyectos/p1/personaje/modificar': () => json(nuevo) });
    const cambiar = await screen.findByRole('button', { name: 'Cambiar ✦ ' + video.imagen });
    await userEvent.click(cambiar);
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe qué quieres cambiar.');
    await userEvent.type(screen.getByLabelText('Qué cambiar de la opción elegida'), 'ponle lentes');
    await userEvent.click(cambiar);
    expect(screen.getByRole('alert')).toHaveTextContent('Primero elige la opción a modificar.');
    expect(llamadas(f, '/api/proyectos/p1/personaje/modificar')).toHaveLength(0);
    expect(cobros).toEqual([]); // lo que se dice antes de cobrar no vuela
    await userEvent.click(screen.getByRole('button', { name: 'Opción 1 del personaje' }));
    await userEvent.click(cambiar);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Opción 3 del personaje' })).toHaveAttribute('aria-pressed', 'true'));
    expect(cuerpoDe(f, '/api/proyectos/p1/personaje/modificar')).toEqual([JSON.stringify({ instruccion: 'ponle lentes', opcion: 0 })]);
    expect(screen.getByLabelText('Qué cambiar de la opción elegida')).toHaveValue('');
    expect(monedero.refrescar).toHaveBeenCalled();
    expect(cobros).toEqual([expect.objectContaining({ costo: video.imagen })]);
  });

  it('crear.revision.voces_con_nivel_motivo_y_muestra', async () => {
    abrir({ ...P, voz: 'Mateo' });
    const sel = await screen.findByLabelText('Voz del narrador');
    expect(sel).toHaveValue('Mateo');
    expect(screen.getByRole('option', { name: 'Lucia · Encaja' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Mateo · No encaja' })).toBeInTheDocument();
    expect(screen.getByText('Muy grave para esto')).toBeInTheDocument();
    await userEvent.selectOptions(sel, 'Lucia');
    expect(screen.getByText('Cálida, para cuentos')).toBeInTheDocument();
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Escuchar' }));
    const audio = document.querySelector('audio')!;
    expect(audio).toHaveAttribute('src', '/api/voces/Lucia/muestra');
    fireEvent.canPlay(audio);
    expect(play).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Escuchar' }));
    fireEvent.error(document.querySelector('audio')!);
    expect(await screen.findByText('No se pudo cargar la muestra de voz. Intenta de nuevo.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Escuchar' })).toBeEnabled();
    play.mockRestore();
  });

  it('crear.revision.sin_voces_queda_una', async () => {
    abrir({ ...P, voces: [] });
    expect(await screen.findByLabelText('Voz del narrador')).toHaveValue('George');
    expect(screen.getByText('sin recomendación')).toBeInTheDocument();
  });

  it('crear.revision.escenas_editar_quitar_anadir_y_meta', async () => {
    abrir(P);
    const e1 = await screen.findByLabelText('Escena 1');
    expect(e1).toHaveValue('Había una vez un gato.');
    expect(screen.getAllByText('5 pal · 3 s')).toHaveLength(1);
    fireEvent.change(e1, { target: { value: 'uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince' } });
    // más de 14 palabras obliga a partir la escena: se marca
    expect(screen.getByText('15 pal · 8 s')).toHaveClass('text-ambar-claro');
    await userEvent.click(screen.getByRole('button', { name: 'Quitar escena 1' }));
    expect(screen.getByLabelText('Escena 1')).toHaveValue('Llegó a la luna.');
    expect(screen.queryByLabelText('Escena 2')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Añadir escena' }));
    expect(screen.getByLabelText('Escena 2')).toHaveValue('');
    expect(screen.getByText('1 escenas · 4 palabras · ≈ 2 s de narración (objetivo 30 s)')).toBeInTheDocument();
  });

  it('crear.revision.narracion_texto_corrido', async () => {
    const f = abrir({ ...P, pipeline: 'narracion', narracion: 'Había una vez un gato que soñaba.', guion: [] });
    const t = await screen.findByLabelText('Narración completa');
    expect(t).toHaveValue('Había una vez un gato que soñaba.');
    expect(screen.getByRole('heading', { name: 'Narración (texto corrido)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Añadir escena' })).toBeNull();
    expect(screen.getByText('7 palabras · ≈ 4 s de narración (objetivo 30 s)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Opción 1 del personaje' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Producir ✦ ' + PRODUCIR }));
    await waitFor(() => expect(llamadas(f, '/api/proyectos/p1/producir?aprobar_imagenes=false')).toHaveLength(1));
    expect(cuerpoDe(f, '/api/proyectos/p1/guion', 'PUT').at(-1)).toBe(
      JSON.stringify({ narracion: 'Había una vez un gato que soñaba.', voz: 'Lucia' }),
    );
  });

  it('crear.revision.autoguardado_no_guarda_vacio_y_reintenta', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    const f = abrir(P, { '/api/proyectos/p1/guion': () => (n++ === 0 ? sinRed() : json(P)) });
    const e1 = await screen.findByLabelText('Escena 1');
    fireEvent.change(e1, { target: { value: 'Otro comienzo.' } });
    expect(screen.getByText('Guardando…')).toBeInTheDocument();
    await avanzar(1000);
    expect(await screen.findByText('Sin guardar, reintentando…')).toBeInTheDocument();
    await avanzar(4000);
    expect(await screen.findByText(/^Guardado a las \d\d:\d\d$/)).toBeInTheDocument();
    expect(JSON.parse(String(cuerpoDe(f, '/api/proyectos/p1/guion', 'PUT').at(-1)))).toEqual({
      escenas: ['Otro comienzo.', 'Llegó a la luna.'],
      voz: 'Lucia',
    });
    // sin personaje elegido no se guarda el personaje
    expect(llamadas(f, '/api/proyectos/p1/personaje', 'PUT')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Opción 2 del personaje' }));
    await avanzar(1000);
    await waitFor(() => expect(cuerpoDe(f, '/api/proyectos/p1/personaje', 'PUT')).toEqual([JSON.stringify({ elegida: 1, nombre: 'Michi' })]));
    // jamás persistir un guion vacío
    const antes = llamadas(f, '/api/proyectos/p1/guion', 'PUT').length;
    fireEvent.change(screen.getByLabelText('Escena 1'), { target: { value: ' ' } });
    fireEvent.change(screen.getByLabelText('Escena 2'), { target: { value: '' } });
    await avanzar(3000);
    expect(llamadas(f, '/api/proyectos/p1/guion', 'PUT')).toHaveLength(antes);
  });

  it('crear.revision.cerrar_con_cambios_sin_guardar_pregunta', async () => {
    abrir(P);
    const e1 = await screen.findByLabelText('Escena 1');
    const limpio = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(limpio);
    expect(limpio.defaultPrevented).toBe(false);
    fireEvent.change(e1, { target: { value: 'Otro comienzo.' } });
    const sucio = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(sucio);
    expect(sucio.defaultPrevented).toBe(true);
  });

  it('crear.revision.fuentes_solo_http_son_enlaces', async () => {
    abrir({ ...P, dossier: 'Los gatos no viajan a la luna.', fuentes: ['https://ejemplo.org/gatos', 'javascript:alert(1)'] });
    await userEvent.click(await screen.findByText('Contexto investigado (2 fuentes)'));
    expect(screen.getByRole('link', { name: 'https://ejemplo.org/gatos' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('link', { name: 'javascript:alert(1)' })).toBeNull();
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();
  });
});

describe('crear · producir', () => {
  it('crear.cobro.producir_con_precio_del_servidor_y_guarda_antes', async () => {
    const cobros = oirCobros();
    const f = abrir({ ...P, personaje: { ...P.personaje, elegida: 1 } });
    // el precio es el del servidor (/estimacion), no una cuenta de la pantalla
    const b = await screen.findByRole('button', { name: 'Producir ✦ ' + PRODUCIR });
    expect(
      screen.getByText('Con los ' + video.preparar + ' créditos del guion, tu película suma ' + precioDe(30) + '. Te quedan 500 créditos · ~3 min.'),
    ).toBeInTheDocument();
    act(() => {
      b.click();
      b.click();
    });
    await waitFor(() => expect(llamadas(f, '/api/proyectos/p1/producir?aprobar_imagenes=false')).toHaveLength(1));
    const orden = f.mock.calls.map(c => (c[1]?.method ?? 'GET') + ' ' + c[0]).filter(x => !x.includes('estimacion') && !x.startsWith('GET'));
    expect(orden).toEqual([
      'PUT /api/proyectos/p1/guion',
      'PUT /api/proyectos/p1/personaje',
      'POST /api/proyectos/p1/producir?aprobar_imagenes=false',
    ]);
    expect(cuerpoDe(f, '/api/proyectos/p1/personaje', 'PUT')).toEqual([JSON.stringify({ elegida: 1, nombre: 'Michi' })]);
    expect(await screen.findByRole('heading', { level: 1, name: 'Produciendo tu película' })).toBeInTheDocument();
    expect(monedero.refrescar).toHaveBeenCalled();
    expect(cobros).toEqual([expect.objectContaining({ costo: PRODUCIR })]);
  });

  it('crear.cobro.producir_sin_personaje_no_cobra', async () => {
    const cobros = oirCobros();
    const f = abrir(P);
    await userEvent.click(await screen.findByRole('button', { name: 'Producir ✦ ' + PRODUCIR }));
    expect(screen.getByRole('alert')).toHaveTextContent('Elige una opción de personaje.');
    expect(f.mock.calls.filter(c => String(c[0]).includes('/producir'))).toHaveLength(0);
    expect(cobros).toEqual([]);
  });

  it('crear.cobro.producir_si_no_alcanza_no_cobra_y_un_402_lo_dice', async () => {
    ponerMonedero(20, false);
    const f = abrir(
      { ...P, personaje: { ...P.personaje, elegida: 0 } },
      { '/api/proyectos/p1/estimacion': () => json({ ...EST, creditos_saldo: 20 }) },
    );
    const b = await screen.findByRole('button', { name: 'Producir ✦ ' + PRODUCIR });
    expect(b).toBeDisabled();
    expect(screen.getByText('Te faltan ✦ ' + (PRODUCIR - 20) + ' ·', { exact: false })).toBeInTheDocument();
    // si no alcanza no se repite el saldo en la nota
    expect(screen.queryByText(/Te quedan/)).toBeNull();
    expect(f.mock.calls.filter(c => String(c[0]).includes('/producir'))).toHaveLength(0);
  });

  it('crear.cobro.producir_manual_aprueba_imagenes', async () => {
    const f = abrir({ ...P, personaje: { ...P.personaje, elegida: 0 } });
    const grupo = await screen.findByRole('radiogroup', { name: 'Cuándo revisar las imágenes' });
    expect(within(grupo).getByRole('radio', { name: 'De corrido' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(grupo).getByRole('radio', { name: 'Enséñame las imágenes antes de animar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Producir ✦ ' + PRODUCIR }));
    await waitFor(() => expect(llamadas(f, '/api/proyectos/p1/producir?aprobar_imagenes=true')).toHaveLength(1));
  });

  it('crear.cobro.producir_sin_precio_no_cobra', async () => {
    let n = 0;
    const f = abrir({ ...P, personaje: { ...P.personaje, elegida: 0 } }, {
      '/api/proyectos/p1/estimacion': () => (n++ === 0 ? sinRed() : json(EST)),
    });
    const p = await screen.findByText('No pudimos calcular el costo.', { exact: false });
    expect(screen.getByRole('button', { name: 'Producir' })).toBeDisabled();
    await userEvent.click(within(p).getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('button', { name: 'Producir ✦ ' + PRODUCIR })).toBeEnabled();
    expect(f.mock.calls.filter(c => String(c[0]).includes('/producir'))).toHaveLength(0);
  });

  it('crear.cobro.producir_sin_monedero_dice_dolares_del_servidor', async () => {
    delete window.monedero;
    abrir(
      { ...P, personaje: { ...P.personaje, elegida: 0 } },
      { '/api/proyectos/p1/estimacion': () => json({ escenas: 2, total: 0.42, minutos: 3 }) },
    );
    expect(await screen.findByText('≈ $0.42 dólares · ~3 min.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Producir' })).toBeEnabled();
  });
});

describe('crear · imágenes, resultado y error', () => {
  const IMGS: Proyecto = {
    ...P,
    estado: 'imagenes',
    progreso: {
      imagenes: [
        { id: 'e1', archivo: 'start_1.jpg', planos: 2, narracion: 'Había una vez un gato.', prompt: 'a grey cat' },
        { id: 'e3', archivo: 'start_3.jpg', planos: 1, narracion: 'Llegó a la luna.', prompt: 'a cat on the moon' },
      ],
    },
  };

  it('crear.imagenes.cambiar_una_cobra_y_refresca_la_imagen', async () => {
    const cobros = oirCobros();
    const f = abrir(IMGS, { '/api/proyectos/p1/imagenes/e3/regenerar': () => json(IMGS) });
    expect(await screen.findByRole('heading', { level: 1, name: '¿Te gustan estas imágenes?' })).toBeInTheDocument();
    expect(screen.getByAltText('Imagen de la toma 1')).toHaveAttribute('src', '/api/proyectos/p1/archivo/start_1.jpg?v=0');
    expect(screen.getByText(/Toma 1 · manda en 2 planos/)).toBeInTheDocument();
    expect(screen.getByText('2 imágenes · animar ya está pagado; pedir otra imagen cuesta ✦ ' + video.imagen + '.')).toBeInTheDocument();
    await userEvent.click(screen.getAllByText('Describir otra imagen')[1]!);
    const t = screen.getByLabelText('Descripción de la imagen de la toma 2');
    await userEvent.clear(t);
    await userEvent.type(t, 'a cat with a helmet');
    const botones = screen.getAllByRole('button', { name: 'Cambiar ✦ ' + video.imagen });
    act(() => {
      botones[1]!.click();
      botones[1]!.click();
    });
    await waitFor(() => expect(screen.getByAltText('Imagen de la toma 2')).toHaveAttribute('src', '/api/proyectos/p1/archivo/start_3.jpg?v=1'));
    expect(cuerpoDe(f, '/api/proyectos/p1/imagenes/e3/regenerar')).toEqual([
      JSON.stringify({ prompt: 'a cat with a helmet', confirmar: true }),
    ]);
    expect(monedero.refrescar).toHaveBeenCalled();
    expect(cobros).toEqual([expect.objectContaining({ costo: video.imagen })]);
  });

  it('crear.imagenes.un_402_al_cambiar_dice_a_quien_escribir', async () => {
    const cobros = oirCobros();
    ponerMonedero(500, false);
    abrir(IMGS, { '/api/proyectos/p1/imagenes/e1/regenerar': () => json({ detail: 'Créditos insuficientes.' }, 402) });
    await userEvent.click((await screen.findAllByRole('button', { name: 'Cambiar ✦ ' + video.imagen }))[0]!);
    const a = await screen.findByRole('alert');
    expect(a).toHaveTextContent('Créditos insuficientes.');
    expect(a).toHaveTextContent('Escríbenos por el canal de la comunidad');
    expect(cobros).toEqual([]);
  });

  it('crear.imagenes.animar_no_cobra', async () => {
    const f = abrir(IMGS, { '/api/proyectos/p1/animar': () => json({ ...IMGS, estado: 'produciendo', etapa: 'encolado' }) });
    const b = await screen.findByRole('button', { name: 'Animar la película' });
    expect(b.textContent).not.toContain('✦');
    await userEvent.click(b);
    expect(await screen.findByRole('heading', { level: 1, name: 'Produciendo tu película' })).toBeInTheDocument();
    expect(llamadas(f, '/api/proyectos/p1/animar')).toHaveLength(1);
    expect(screen.getByText('Guion aprobado')).toBeInTheDocument();
  });

  it('crear.imagenes.mejor_no_confirma_y_dice_lo_devuelto', async () => {
    const cobros = oirCobros();
    const f = abrir(IMGS, { '/api/proyectos/p1/cancelar': () => json({ proyecto: P, devueltos: 86 }) });
    await userEvent.click(await screen.findByRole('button', { name: 'Mejor no' }));
    const d = await screen.findByRole('alertdialog', { name: '¿Volver a revisión sin animar?' });
    expect(within(d).getByRole('button', { name: 'No, seguir aquí' })).toHaveFocus();
    await userEvent.click(within(d).getByRole('button', { name: 'No, seguir aquí' }));
    expect(llamadas(f, '/api/proyectos/p1/cancelar')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Mejor no' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Sí, volver a revisión' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Revisa tu película' })).toBeInTheDocument();
    expect(llamadas(f, '/api/proyectos/p1/cancelar')).toHaveLength(1);
    expect(monedero.refrescar).toHaveBeenCalled();
    expect(cobros).toEqual([]); // una devolución no es un cobro: no vuela «−N»
  });

  it('crear.resultado.video_descargar_editor_y_drive_http', async () => {
    abrir({
      ...P,
      estado: 'listo',
      progreso: { editor: 'gen-p1' },
      resultado: { mensaje: 'Tu película dura 31 s.', link: 'https://drive.google.com/x' },
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Película lista' })).toBeInTheDocument();
    const v = document.querySelector('video')!;
    expect(v).toHaveAttribute('src', '/api/proyectos/p1/archivo/pelicula.mp4');
    expect(v).toHaveAttribute('poster', '/api/proyectos/p1/archivo/portada.jpg');
    expect(screen.getByRole('link', { name: 'Descargar' })).toHaveAttribute('download', 'pelicula.mp4');
    expect(screen.getByRole('link', { name: 'Editor' })).toHaveAttribute('href', '/editor/gen-p1/');
    expect(screen.getByRole('link', { name: 'Abrir en Drive' })).toHaveAttribute('href', 'https://drive.google.com/x');
    expect(screen.getByText('Tu película dura 31 s.')).toBeInTheDocument();
  });

  it('crear.resultado.sin_editor_lo_explica_y_sin_http_no_hay_drive', async () => {
    abrir({ ...P, estado: 'listo', progreso: {}, resultado: { mensaje: '', link: 'javascript:alert(1)' } });
    expect(await screen.findByRole('button', { name: 'Editor' })).toBeDisabled();
    expect(screen.getByText(/El editor de esta película aún no está listo/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Abrir en Drive' })).toBeNull();
  });

  it('crear.resultado.rehacer_vuelve_a_revision_gratis', async () => {
    const cobros = oirCobros();
    let n = 0;
    const f = abrir({ ...P, estado: 'listo', progreso: { editor: 'gen-p1' } }, {
      '/api/proyectos/p1/reabrir': () => (n++ === 0 ? json({ detail: 'Solo una película lista se puede modificar' }, 409) : json(P)),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Rehacer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Solo una película lista se puede modificar');
    expect(screen.getByRole('button', { name: 'Rehacer' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Rehacer' }));
    expect(await screen.findByLabelText('Escena 1')).toHaveValue('Había una vez un gato.');
    expect(llamadas(f, '/api/proyectos/p1/reabrir')).toHaveLength(2);
    expect(monedero.refrescar).not.toHaveBeenCalled();
    expect(cobros).toEqual([]);
  });

  const ERR_PROD: Proyecto = {
    ...P,
    estado: 'error',
    etapa: 'media',
    personaje: { ...P.personaje, elegida: 0 },
    cobrado_producir: 75,
    error: 'Veo devolvió 500',
  };

  it('crear.error.al_producir_reintentar_con_precio_y_devolucion', async () => {
    const cobros = oirCobros();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    const f = abrir(ERR_PROD, {
      '/api/proyectos/p1/producir': () =>
        n++ === 0 ? json({ detail: 'Esta película ya se está produciendo' }, 409) : json({ ...P, estado: 'produciendo', etapa: 'encolado' }),
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'No pudimos terminar tu película' })).toBeInTheDocument();
    expect(screen.getByText('Se detuvo en «Animando las escenas». Tu guion, tu voz y tu personaje siguen guardados.')).toBeInTheDocument();
    // la cifra devuelta es la que se cobró, no la tabla de hoy
    expect(screen.getByText('Te devolvimos ✦ 75: no pagas por una película que no salió.')).toBeInTheDocument();
    expect(
      screen.getByText('Reintentar vuelve a producir con lo mismo que aprobaste. Cuesta ' + PRODUCIR + ' créditos y se cobran de nuevo.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Empezar de nuevo' })).toHaveClass('border-campo');
    await userEvent.click(screen.getByText('Detalles técnicos'));
    expect(screen.getByText('Veo devolvió 500')).toBeInTheDocument();
    // el saldo se pide un poco después: la devolución llega justo tras el error
    expect(monedero.refrescar).not.toHaveBeenCalled();
    await avanzar(4000);
    expect(monedero.refrescar).toHaveBeenCalledTimes(1);
    const b = screen.getByRole('button', { name: 'Reintentar ✦ ' + PRODUCIR });
    await userEvent.click(b);
    // el error de reintentar va aparte: «qué pasó» sigue contando el original
    expect(await screen.findByText('Esta película ya se está produciendo')).toBeInTheDocument();
    expect(screen.getByText(/Se detuvo en «Animando las escenas»/)).toBeInTheDocument();
    expect(cobros).toEqual([]); // ni la devolución ni el 409 vuelan
    await userEvent.click(b);
    expect(await screen.findByRole('heading', { level: 1, name: 'Produciendo tu película' })).toBeInTheDocument();
    expect(llamadas(f, '/api/proyectos/p1/producir')).toHaveLength(2);
    expect(cobros).toEqual([expect.objectContaining({ costo: PRODUCIR })]);
  });

  it('crear.error.al_producir_sin_cobrado_usa_la_tabla', async () => {
    abrir({ ...ERR_PROD, cobrado_producir: null });
    expect(await screen.findByText('Te devolvimos ✦ ' + PRODUCIR + ': no pagas por una película que no salió.')).toBeInTheDocument();
  });

  it('crear.error.narracion_con_personaje_es_de_producir', async () => {
    abrir({ ...ERR_PROD, pipeline: 'narracion', narracion: 'Había una vez.', guion: [] });
    expect(await screen.findByRole('button', { name: 'Reintentar ✦ ' + PRODUCIR })).toBeInTheDocument();
    cleanup();
    // con personaje pero sin texto, falló al preparar: no hay nada que reintentar
    abrir({ ...ERR_PROD, pipeline: 'escenas', narracion: null, guion: [{ narracion: '  ' }] });
    expect(await screen.findByRole('heading', { level: 1, name: 'No pudimos terminar tu guion' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reintentar/ })).toBeNull();
  });

  it('crear.error.al_preparar_empezar_de_nuevo_con_la_idea', async () => {
    abrir({ ...P, estado: 'error', etapa: 'guion', guion: [], personaje: { ...P.personaje, opciones: [] } });
    expect(await screen.findByRole('heading', { level: 1, name: 'No pudimos terminar tu guion' })).toBeInTheDocument();
    expect(screen.getByText('Se detuvo en «Escribiendo el guion». Tu idea no se perdió: «Empezar de nuevo» la trae escrita.')).toBeInTheDocument();
    expect(screen.getByText('Te devolvimos ✦ ' + video.preparar + ': no pagas por un guion que no salió.')).toBeInTheDocument();
    expect(screen.getByText('Empieza de nuevo con la misma idea. El guion cuesta ' + video.preparar + ' créditos, como la primera vez.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reintentar/ })).toBeNull();
    const l = screen.getByRole('link', { name: 'Empezar de nuevo' });
    expect(l).toHaveAttribute('href', '/estudio/crear/?brief=Un+gato+en+la+luna');
    expect(l).toHaveClass('bg-ambar');
    expect(screen.queryByText('Detalles técnicos')).toBeNull();
  });

  it('crear.error.sin_monedero_no_habla_de_creditos', async () => {
    delete window.monedero;
    abrir(ERR_PROD);
    expect(await screen.findByText('Reintentar vuelve a producir con lo mismo que aprobaste.')).toBeInTheDocument();
    expect(screen.queryByText('Tus créditos')).toBeNull();
    expect(screen.queryByText(/créditos/)).toBeNull();
  });
});

describe('crear · transversales', () => {
  it('crear.textos.del_servidor_como_texto', async () => {
    const malo = '<img src=x onerror="window.pwned=1">';
    abrir({
      ...P,
      dossier: malo,
      fuentes: [malo],
      personaje: { ...P.personaje, descripcion: malo },
      voces: [{ id: 'Lucia', nivel: 'verde', motivo: malo }],
      guion: [{ narracion: malo }],
    });
    await screen.findByLabelText('Escena 1');
    expect(screen.getByLabelText('Escena 1')).toHaveValue(malo);
    expect(screen.getAllByText(malo).length).toBeGreaterThan(1);
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('crear.marco.enlaces_estudio_y_version_anterior', async () => {
    montar();
    render(<Crear />);
    expect(screen.getByRole('heading', { level: 1, name: 'Crea tu video' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Estudio' })).toHaveAttribute('href', '/estudio/');
    expect(screen.getByRole('link', { name: 'Usar la versión anterior' })).toHaveAttribute('href', '/ui/clasica?pantalla=crear');
    await screen.findByRole('radio', { name: 'Animado' });
  });

  it('crear.cobro.un_solo_principal_por_vista', async () => {
    const principales = () => [...document.querySelectorAll('button, a')].filter(b => b.className.includes('bg-ambar ')).length;
    montar();
    const { unmount } = render(<Crear />);
    await screen.findByRole('radio', { name: 'Animado' });
    expect(principales()).toBe(1);
    unmount();
    for (const p of [
      { ...P, personaje: { ...P.personaje, elegida: 0 } },
      { ...P, estado: 'imagenes' as const, progreso: { imagenes: [{ id: 'e1', archivo: 'start_1.jpg' }] } },
      { ...P, estado: 'listo' as const, progreso: { editor: 'gen-p1' } },
      { ...P, estado: 'error' as const, personaje: { ...P.personaje, elegida: 0 } },
    ]) {
      abrir(p);
      await screen.findByRole('heading', { level: 1 });
      if (p.estado === 'revision') await screen.findByRole('button', { name: 'Producir ✦ ' + PRODUCIR });
      expect(principales()).toBe(p.estado === 'listo' ? 0 : 1);
      cleanup();
    }
  });
});

describe('UI·18 · la miniatura que llega del inicio', () => {
  it('mientras la película carga, su miniatura ocupa el lugar del reproductor, con el nombre de la transición', async () => {
    tocarMiniatura('p1', '/api/proyectos/p1/archivo/portada.jpg', null);
    let responder: ((r: Response) => void) | null = null;
    abrir(() => new Promise<Response>(r => (responder = r)));
    const img = document.querySelector('img')!;
    expect(img).toHaveAttribute('src', '/api/proyectos/p1/archivo/portada.jpg');
    expect(img.style.viewTransitionName).toBe(NOMBRE_MINIATURA);
    expect(screen.getByText('Abriendo tu película…')).toBeInTheDocument();
    // llega la película: el reproductor toma su lugar y el nombre se va con la miniatura
    await waitFor(() => expect(responder).not.toBeNull());
    await act(async () => responder!(json({ ...P, estado: 'listo', progreso: { editor: 'gen-p1' } })));
    expect(await screen.findByRole('heading', { level: 1, name: 'Película lista' })).toBeInTheDocument();
    expect(document.querySelector('video')).toBeInTheDocument();
    expect([...document.querySelectorAll<HTMLElement>('*')].some(n => n.style.viewTransitionName)).toBe(false);
  });

  it('sin pista (o de otra película) se abre como siempre, con el texto', () => {
    tocarMiniatura('otra', '/api/x.jpg', null);
    abrir(() => new Promise<Response>(() => undefined));
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('Abriendo tu película…')).toBeInTheDocument();
  });

  it('la pista se usa una vez: recargar la página ya no la pinta', async () => {
    tocarMiniatura('p1', '/api/a.jpg', null);
    abrir(() => new Promise<Response>(() => undefined));
    await waitFor(() => expect(sessionStorage.getItem('vt:miniatura')).toBeNull());
  });
});
