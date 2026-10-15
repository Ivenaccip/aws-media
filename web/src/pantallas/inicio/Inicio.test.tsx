// El inicio del estudio, como COMPORTAMIENTO (docs/PLAN-UI.md §5). Cada test
// empieza por el ID de su invariante: tests/test_migracion_ui.py exige que
// cada ID del registro exista aquí.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clip, modelos, video } from '../../nucleo/tarifas';
import { guardarArchivos } from '../../nucleo/traspaso';
import { miniaturaQueLlega, olvidarMiniatura } from '../../nucleo/transiciones';
import { json, llamadas, ponerAvisos, ponerMonedero, servidor, sinRed, type Ruta } from '../../prueba/servidor';
import { Biblioteca } from './Biblioteca';
import { Inicio } from './Inicio';
import { destinoDe, OPCIONES, type ClipCorto, type Edicion, type EstadoBlotato, type Imagen, type PedidoImagen, type Proyecto } from './logica';
import { CATALOGO, PRECIOS } from './modelos';

// La caja le deja la foto del personaje a Crear por nucleo/traspaso (IndexedDB, que jsdom no trae). Aquí se envuelve la
// real —los demás tests la siguen usando tal cual— y los de la foto del personaje le ponen la respuesta que necesiten.
// El traspaso de verdad se prueba en nucleo/traspaso.test.ts.
vi.mock('../../nucleo/traspaso', async importOriginal => {
  const real = await importOriginal<typeof import('../../nucleo/traspaso')>();
  return { ...real, guardarArchivos: vi.fn(real.guardarArchivos) };
});

const P1: Proyecto = {
  id: 'p1',
  creado: '2026-09-20T10:00:00Z',
  estado: 'listo',
  brief: 'La historia del café',
  archivado: false,
  miniatura: 'portada.jpg',
  miniatura_alt: 'personaje.png',
};
const P2: Proyecto = { ...P1, id: 'p2', estado: 'produciendo', brief: 'Roma en 60 segundos', miniatura: null, miniatura_alt: null };
const ARCH: Proyecto = { ...P1, id: 'p9', archivado: true, brief: 'Un proyecto viejo' };

const img = (i: number): Imagen => ({ nombre: `img-${i}.jpg`, url: `/api/imagenes/img-${i}.jpg`, creado: 1758000000 + i });
const ED: Edicion = { nombre: 'podcast', generado: false, editor_listo: true, editar: { estado: 'listo' }, subidas: [{}] };
// UI·26: un clip de 8 s y unos shorts sacados de YouTube
const C1: ClipCorto = {
  id: 'clip-20260925-100000-ab',
  estado: 'listo',
  texto: 'Mi perro en la playa',
  video: '/api/clip/clip-20260925-100000-ab/video',
  inicio: '2026-09-25T10:00:00Z',
};
const S1: Edicion = {
  nombre: 'yt-charla',
  generado: false,
  editor_listo: false,
  subidas: [{}],
  creado: '2026-09-21T10:00:00Z',
  shorts: { estado: 'listo', titulo: 'Mi charla en el foro', inicio: '2026-09-22T10:00:00Z', cuantos: 3 },
};

// una imagen que el servidor hace en segundo plano (los modelos que tardan): sale en `pendientes` de /api/imagenes
const PEDIDO: PedidoImagen = {
  id: 'img-20261011-120000-abc123',
  estado: 'generando',
  inicio: '2026-10-11T12:00:00+00:00',
  texto: 'un faro de noche',
  modelo: 'nb2',
  creditos: modelos.imagen.nb2,
  nombre: '',
  url: '',
  error: '',
};
const SE_DEVOLVIERON = 'La imagen no se pudo generar. Se te devolvieron los créditos.';

const CONECTADO: EstadoBlotato = {
  conectado: true,
  origen: 'usuario',
  cuentas: [{ id: '1', platform: 'instagram', fullname: 'Estudio Norte', username: 'estudio.norte' }],
  error: null,
  plan: { nombre: 'Starter', usd_por_mes: 29 },
};
const SIN_CLAVE: EstadoBlotato = { ...CONECTADO, conectado: false, origen: null, cuentas: [] };

interface Mundo {
  proyectos?: Proyecto[] | (() => Response | Promise<Response>);
  slots?: number | null;
  imagenes?: Imagen[] | null;
  /** Las imágenes en segundo plano. Sin esto la llave `pendientes` ni viaja (un servidor local o anterior). */
  pedidos?: PedidoImagen[];
  ediciones?: Edicion[] | null;
  /** 'local': el 503 de «corre en el servicio». */
  clips?: ClipCorto[] | null | 'local';
  blotato?: EstadoBlotato | null;
  rutas?: Record<string, Ruta>;
}

function montar({
  proyectos = [P1],
  slots = null,
  imagenes = [],
  pedidos,
  ediciones = [],
  clips = [],
  blotato = CONECTADO,
  rutas = {},
}: Mundo = {}) {
  return servidor({
    '/api/proyectos': () => (typeof proyectos === 'function' ? proyectos() : json(proyectos)),
    '/api/slots': () => json({ slots, activos: 0 }),
    '/api/imagenes': () =>
      imagenes ? json({ total: imagenes.length, imagenes, ...(pedidos ? { pendientes: pedidos } : {}) }) : json({ detail: 'x' }, 500),
    '/api/edicion/proyectos': () => (ediciones ? json(ediciones) : sinRed()),
    '/api/clip': () =>
      clips === 'local' ? json({ detail: 'corre en el servicio' }, 503) : clips ? json({ clips }) : sinRed(),
    '/api/blotato': () => (blotato ? json(blotato) : sinRed()),
    '/api/moderar': () => json({ permitido: true }),
    ...rutas,
  });
}

let ir: ReturnType<typeof vi.fn<(url: string) => void>>;

// El inicio abre en el MAPA (dueño, 15-oct-2026: «el mapa es el inicio»), pero casi todo lo de este archivo es de la caja, así que `pintar`
// llega a ella por el camino de siempre —Marketing → Distrito— antes de devolver. Con `fireEvent` y no con `userEvent`: es síncrono, y
// algunas pruebas lo llaman con el reloj falso puesto (con él `userEvent` se cuelga). El mapa, las opciones y lo que pasa antes de
// llegar a la caja están en Recorrido.test.tsx.
function pintar() {
  const r = render(<Inicio ir={ir} />);
  fireEvent.click(within(screen.getByRole('group', { name: 'Áreas' })).getByRole('button', { name: /^Marketing/ }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Marketing' })).getByRole('button', { name: /^Distrito/ }));
  return r;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(guardarArchivos).mockReset();
  ir = vi.fn<(url: string) => void>();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  history.replaceState(null, '', '/estudio/inicio/');
});

afterEach(() => {
  vi.useRealTimers();
  restaurarCatalogo?.();
  restaurarCatalogo = undefined;
  delete window.monedero;
});

// El catálogo real enciende, para crear imágenes, Grok, FLUX.2 klein, Z-Image Turbo,
// FLUX.2 pro, Seedream 5.0 Flash, Seedream 4.5, FLUX 3, Nano Banana 2 y Nano Banana Pro (para editar,
// solo Grok: Nano Banana 2 salió de editar el 14-oct-2026), y Veo Lite y Veo Fast (clip, los dos con 4, 6 y 8 s).
// Para ver qué pasa con un modelo que no tiene todas las duraciones se enciende LTX
// (sin 4 s) mientras dura la prueba, con números de PRUEBA (no son los de
// tarifas.json), y después se deja como estaba.
let restaurarCatalogo: (() => void) | undefined;
function encenderLtx() {
  const ltx = CATALOGO.clip.find(m => m.id === 'ltx')!;
  const antes = { activo: ltx.activo, precio: PRECIOS.clip.ltx };
  ltx.activo = true;
  PRECIOS.clip.ltx = { '6': 10, '8': 12 };
  restaurarCatalogo = () => {
    ltx.activo = antes.activo;
    if (antes.precio === undefined) delete PRECIOS.clip.ltx;
    else PRECIOS.clip.ltx = antes.precio;
  };
}

// Editar con Nano Banana 2 se apagó el 14-oct-2026 quitándole su número de tarifas.json (sigue en el catálogo
// de editar). Las pruebas que necesitan DOS modelos que editan se lo ponen mientras corren, con su número de
// crear, y después se deja como estaba.
function nb2EditaEnLaPrueba() {
  const antes = PRECIOS.editar.nb2;
  const previa = restaurarCatalogo; // si la prueba también encendió otro, se restaura el suyo
  PRECIOS.editar.nb2 = modelos.imagen.nb2;
  restaurarCatalogo = () => {
    if (antes === undefined) delete PRECIOS.editar.nb2;
    else PRECIOS.editar.nb2 = antes;
    previa?.();
  };
}

const caja = () => screen.getByRole('textbox', { name: '¿Qué vamos a crear hoy?' });
// el chip de TAREA (sin precio) y el de MODELO; son los dos menús de la caja
const botonOpcion = () =>
  screen.getAllByRole('button').find(b => b.getAttribute('aria-haspopup') === 'listbox')!;
const botonModelo = () => screen.getByRole('button', { name: /^Modelo / });
const enviar = () => screen.getByRole('button', { name: 'Crear' });
const cuerpoDe = (f: ReturnType<typeof montar>, ruta: string) => JSON.parse(llamadas(f, ruta)[0]![1]!.body as string);
const foto = (nombre = 'perro.png', tipo = 'image/png') => new File(['x'], nombre, { type: tipo });
const entradaDeFotos = (c: HTMLElement) => c.querySelector('input[type="file"]') as HTMLInputElement;

async function elegirOpcion(rotulo: string) {
  await userEvent.click(botonOpcion());
  await userEvent.click(screen.getByRole('option', { name: new RegExp(rotulo) }));
}

// la caja pide una imagen y el servidor la deja en segundo plano (contesta `lanzado`). El servidor real solo
// lo hace con FLUX 3, Seedream 5.0 Flash y Seedream 4.5; aquí es un doble que contesta `lanzado` con cualquier modelo
async function pedirImagenLenta(texto: string) {
  await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
  await userEvent.type(caja(), texto);
  await userEvent.click(botonModelo());
  const menu = screen.getByRole('dialog', { name: 'Elegir modelo' });
  await userEvent.click(within(menu).getByRole('radio', { name: /Nano Banana 2/ }));
  await userEvent.click(within(menu).getByRole('button', { name: 'Crear' }));
}
const generando = () => screen.queryAllByRole('article').filter(a => a.getAttribute('aria-busy') === 'true');
const lecturasDeImagenes = (f: ReturnType<typeof montar>) => llamadas(f, '/api/imagenes', 'GET').length;
// 200 sin poder leer los pedidos: `pendientes` viene vacía pero NO quiere decir «no hay» (pendientes_ok: false)
const DEGRADADA = { imagenes: [], pendientes: [], pendientes_ok: false };

describe('la caja', () => {
  it('inicio.caja.arranca_en_el_clip_lo_mas_barato', async () => {
    montar();
    pintar();
    expect(screen.getByRole('button', { name: 'Video' })).toHaveAttribute('aria-pressed', 'true');
    // R4: el chip de la tarea ya no lleva precio; el modelo predeterminado es el que ya se usaba
    expect(botonOpcion()).toHaveTextContent('Un video corto');
    expect(botonOpcion()).not.toHaveTextContent('✦');
    expect(botonModelo()).toHaveTextContent('Modelo Veo 3.1 Lite');
    await screen.findByText('La historia del café');
  });

  it('inicio.caja.precios_de_tarifas_json', async () => {
    montar();
    pintar();
    const d = Object.values(video.por_duracion);
    const rango = `${Math.min(...d)}–${Math.max(...d)}`;
    await userEvent.click(botonOpcion());
    const opciones = screen.getAllByRole('option').map(o => o.textContent);
    // las tareas que eligen modelo dicen «según el modelo»; las demás, su rango de tarifas.json
    expect(opciones[0]).toContain('Un video cortosegún el modelo');
    expect(opciones[1]).toContain('Creador de cuentos✦ ' + rango);
    expect(opciones[2]).toContain('Crea tu historia✦ ' + rango);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    await userEvent.click(botonOpcion());
    for (const o of screen.getAllByRole('option')) expect(o).toHaveTextContent('según el modelo');
  });

  it('inicio.caja.el_modelo_se_paga_con_tarifas_json', async () => {
    montar();
    pintar();
    // el clip: el menú de modelo enseña lo mismo que cobra la pantalla del clip (el de 8 s, que arranca elegido)
    expect(clip.video_8s).toBe(modelos.clip['veo-lite']['8']);
    await userEvent.click(botonModelo());
    const menu = screen.getByRole('dialog', { name: 'Elegir modelo' });
    expect(within(menu).getByRole('radio', { name: /Veo 3\.1 Lite/ })).toHaveTextContent('✦ ' + modelos.clip['veo-lite']['8']);
    expect(menu).toHaveTextContent('✦ ' + modelos.clip['veo-lite']['8'] + ' por clip de 8 s');
    await userEvent.keyboard('{Escape}');
    // la imagen: el menú dice lo que dice tarifas.json, y es lo que ya valía
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    await userEvent.click(botonModelo());
    const imagen = screen.getByRole('dialog', { name: 'Elegir modelo' });
    expect(imagen).toHaveTextContent('✦ ' + modelos.imagen.grok + ' por imagen');
    expect(modelos.imagen.grok).toBe(video.imagen);
  });

  it('inicio.caja.el_envio_va_en_el_pie_del_menu_de_modelo', async () => {
    const f = montar({ rutas: { '/api/clip/generar': () => json({ lanzado: true, id: 'clip-1', creditos: modelos.clip['veo-lite']['8'] }) } });
    pintar();
    await userEvent.type(caja(), 'un gato en la luna');
    await userEvent.click(botonModelo());
    const menu = screen.getByRole('dialog', { name: 'Elegir modelo' });
    await userEvent.click(within(menu).getByRole('button', { name: 'Crear' }));
    // el video corto se pide aquí, con el modelo elegido, y la página no navega
    await waitFor(() => expect(llamadas(f, '/api/clip/generar')).toHaveLength(1));
    // sin tocar la duración van los 8 s de siempre
    expect(cuerpoDe(f, '/api/clip/generar')).toEqual({
      texto: 'un gato en la luna',
      formato: 'horizontal',
      imagenes: [],
      modelo: 'veo-lite',
      segundos: 8,
      audio: true,
      puerta: 'caja',
    });
    expect(ir).not.toHaveBeenCalled();
    // el menú se cierra, el texto se vacía y se avisa dónde mirar
    expect(screen.queryByRole('dialog', { name: 'Elegir modelo' })).toBeNull();
    expect(await screen.findByRole('status')).toHaveTextContent('Mis creaciones');
    expect(caja()).toHaveValue('');
  });

  it('inicio.caja.el_servidor_decide_el_precio_y_un_error_se_dice', async () => {
    const f = montar({
      rutas: { '/api/clip/generar': () => json({ detail: 'Créditos insuficientes: esta acción cuesta 36 créditos y tu saldo es 2.' }, 402) },
    });
    pintar();
    await userEvent.type(caja(), 'un gato en la luna');
    await userEvent.click(botonModelo());
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Elegir modelo' })).getByRole('button', { name: 'Crear' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Créditos insuficientes');
    // nada se vació: el texto sigue ahí para reintentar
    expect(caja()).toHaveValue('un gato en la luna');
    expect(llamadas(f, '/api/clip/generar')).toHaveLength(1);
    // y el cuerpo nunca trae un precio: el servidor lo calcula con el id del modelo
    expect(Object.keys(cuerpoDe(f, '/api/clip/generar'))).not.toContain('creditos');
  });

  it('inicio.caja.un_texto_vetado_no_se_pide', async () => {
    const f = montar({
      rutas: { '/api/moderar': () => json({ permitido: false, mensaje: 'La IA no permite violencia explícita.', motivo: 'violencia' }) },
    });
    pintar();
    await userEvent.type(caja(), 'algo muy violento');
    await userEvent.click(botonModelo());
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Elegir modelo' })).getByRole('button', { name: 'Crear' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('violencia explícita');
    expect(llamadas(f, '/api/clip/generar')).toHaveLength(0);
  });

  it('inicio.caja.las_tareas_sin_modelo_no_traen_chip_de_modelo', async () => {
    montar();
    pintar();
    await elegirOpcion('Creador de cuentos');
    expect(screen.queryByRole('button', { name: /^Modelo / })).toBeNull();
    // su «Crear» está en la barra y no depende de ningún menú
    await userEvent.type(caja(), 'la Segunda Guerra');
    await userEvent.click(enviar());
    expect(ir).toHaveBeenLastCalledWith('/crear.html?brief=la+Segunda+Guerra&modo=investigacion');
  });

  it('inicio.caja.cada_tarea_recuerda_su_modelo', async () => {
    montar();
    pintar();
    // cada tarea arranca en su predeterminado y recuerda el que se elija, sin contagiar a las demás
    const elegirModelo = async (nombre: RegExp) => {
      await userEvent.click(botonModelo());
      const menu = screen.getByRole('dialog', { name: 'Elegir modelo' });
      await userEvent.click(within(menu).getByRole('radio', { name: nombre }));
      await userEvent.keyboard('{Escape}');
    };
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    expect(botonModelo()).toHaveTextContent('Modelo Grok Imagine');
    await elegirModelo(/Nano Banana 2/);
    expect(botonModelo()).toHaveTextContent('Modelo Nano Banana 2');
    await elegirOpcion('Editar una imagen');
    expect(botonModelo()).toHaveTextContent('Modelo Grok Imagine'); // editar no heredó el de crear
    await userEvent.click(screen.getByRole('button', { name: 'Video' }));
    expect(botonModelo()).toHaveTextContent('Modelo Veo 3.1 Lite');
    await elegirModelo(/Veo 3\.1 Fast/);
    expect(botonModelo()).toHaveTextContent('Modelo Veo 3.1 Fast');
    // y al regresar cada una conserva el suyo
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    expect(botonModelo()).toHaveTextContent('Modelo Nano Banana 2');
    await userEvent.click(screen.getByRole('button', { name: 'Video' }));
    expect(botonModelo()).toHaveTextContent('Modelo Veo 3.1 Fast');
  });

  it('inicio.caja.cada_opcion_lleva_a_su_destino_con_su_modo', async () => {
    montar();
    pintar();
    await userEvent.type(caja(), '  un gato en la luna  ');
    // las que NO eligen modelo siguen llevando a su pantalla con el texto puesto
    const casos: Array<[string, string]> = [
      ['Creador de cuentos', '/crear.html?brief=un+gato+en+la+luna&modo=investigacion'],
      ['Crea tu historia', '/crear.html?brief=un+gato+en+la+luna&modo=idea'],
    ];
    for (const [rotulo, url] of casos) {
      await elegirOpcion(rotulo);
      await userEvent.click(enviar());
      expect(ir).toHaveBeenLastCalledWith(url);
      // la persona regresa con «atrás»: el navegador restaura la página desde su caché
      act(() => {
        window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
      });
    }
    // y el destino con modelo sigue existiendo para quien lo use (lo arma destinoDe)
  });

  it('inicio.caja.crear_una_imagen_se_pide_aqui', async () => {
    const f = montar({ rutas: { '/api/imagenes': (_url, init) => (init?.method === 'POST' ? json({ nombre: 'n.jpg', url: '/api/imagenes/n.jpg' }) : json({ imagenes: [] })) } });
    pintar();
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    await userEvent.type(caja(), 'un gato en la luna');
    await userEvent.click(botonModelo());
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Elegir modelo' })).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(llamadas(f, '/api/imagenes')).toHaveLength(1));
    expect(cuerpoDe(f, '/api/imagenes')).toEqual({ prompt: 'un gato en la luna', estilo: 'ninguno', estilo_custom: '', modelo: 'grok' });
    expect(ir).not.toHaveBeenCalled();
  });

  it('inicio.caja.crear_una_imagen_manda_nano_banana_2', async () => {
    const f = montar({ rutas: { '/api/imagenes': (_url, init) => (init?.method === 'POST' ? json({ nombre: 'n.jpg', url: '/api/imagenes/n.jpg' }) : json({ imagenes: [] })) } });
    pintar();
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    await userEvent.type(caja(), 'un gato en la luna');
    await userEvent.click(botonModelo());
    const menu = screen.getByRole('dialog', { name: 'Elegir modelo' });
    const fila = within(menu).getByRole('radio', { name: /Nano Banana 2/ });
    // el precio de la fila es el de tarifas.json
    expect(fila).toHaveTextContent('✦ ' + modelos.imagen.nb2);
    await userEvent.click(fila);
    await userEvent.click(within(menu).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(llamadas(f, '/api/imagenes')).toHaveLength(1));
    expect(cuerpoDe(f, '/api/imagenes')).toEqual({ prompt: 'un gato en la luna', estilo: 'ninguno', estilo_custom: '', modelo: 'nb2' });
  });

  it('inicio.caja.crear_una_imagen_no_promete_un_estilo', async () => {
    // dueño, 14-oct-2026: la caja no tiene selector de estilo y manda `ninguno`; su nota ya no ofrece uno que no hay
    montar();
    pintar();
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    expect(screen.queryByRole('combobox', { name: /estilo/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /estilo/i })).not.toBeInTheDocument();
    await userEvent.click(botonOpcion());
    const opcion = screen.getByRole('option', { name: /Crear una imagen/ });
    expect(opcion).toHaveTextContent('Desde cero: dibujamos lo que escribas, tal cual.');
    expect(opcion).toHaveTextContent('Si le agregas una imagen con el +, la editamos.');
    expect(opcion).not.toHaveTextContent(/estilo/i);
  });

  it('inicio.caja.una_imagen_lanzada_dice_que_va_en_camino_y_refresca_el_saldo', async () => {
    const monedero = ponerMonedero(100);
    // el servidor cobra, deja la imagen en marcha y contesta `lanzado`; desde entonces la lista la trae generándose
    let pedidos: PedidoImagen[] = [];
    const f = montar({
      rutas: {
        '/api/imagenes': (_url, init) =>
          init?.method === 'POST'
            ? ((pedidos = [PEDIDO]), json({ lanzado: true, id: PEDIDO.id, creditos: PEDIDO.creditos }))
            : json({ imagenes: [], pendientes: pedidos }),
      },
    });
    pintar();
    await screen.findByText('La historia del café');
    expect(monedero.refrescar).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    await userEvent.type(caja(), 'un faro de noche');
    await userEvent.click(botonModelo());
    const menu = screen.getByRole('dialog', { name: 'Elegir modelo' });
    await userEvent.click(within(menu).getByRole('radio', { name: /Nano Banana 2/ }));
    await userEvent.click(within(menu).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(llamadas(f, '/api/imagenes')).toHaveLength(1));
    expect(cuerpoDe(f, '/api/imagenes')).toMatchObject({ prompt: 'un faro de noche', modelo: 'nb2' });
    // para la caja es un pedido que salió: lo dice, se vacía y el saldo (que ya bajó) se pone al día
    expect(await screen.findByText('Listo, ya va. Míralo abajo, en «Mis creaciones».')).toBeInTheDocument();
    expect(caja()).toHaveValue('');
    expect(monedero.refrescar).toHaveBeenCalled();
    expect(ir).not.toHaveBeenCalled();
    // y «Mis creaciones» la enseña generándose: una sola tarjeta, la del servidor
    await waitFor(() => expect(screen.getAllByRole('article').filter(a => a.getAttribute('aria-busy') === 'true')).toHaveLength(1));
    expect(screen.getAllByRole('article')[0]).toHaveTextContent('un faro de noche');
  });

  it('inicio.caja.la_respuesta_de_siempre_de_una_imagen_sigue_igual', async () => {
    const monedero = ponerMonedero(100);
    const f = montar({
      rutas: { '/api/imagenes': (_url, init) => (init?.method === 'POST' ? json({ nombre: 'n.jpg', url: '/api/imagenes/n.jpg' }) : json({ imagenes: [] })) },
    });
    pintar();
    await screen.findByText('La historia del café');
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    await userEvent.type(caja(), 'un gato en la luna');
    await userEvent.click(botonModelo());
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Elegir modelo' })).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(llamadas(f, '/api/imagenes')).toHaveLength(1));
    // el modelo rápido contesta {nombre, url}: el mismo aviso, el mismo saldo, y nada queda generándose
    expect(await screen.findByText('Listo, ya va. Míralo abajo, en «Mis creaciones».')).toBeInTheDocument();
    expect(monedero.refrescar).toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByRole('article').filter(a => a.getAttribute('aria-busy') === 'true')).toHaveLength(0));
  });

  it('inicio.caja.si_falla_la_primera_relectura_tras_lanzar_la_tarjeta_se_conserva_y_se_reintenta', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ponerMonedero(100);
    // el servidor cobra y contesta `lanzado`; las dos primeras lecturas de la lista tras eso fallan
    let lanzado = false;
    let caidas = 2;
    const f = montar({
      rutas: {
        '/api/imagenes': (_url, init) => {
          if (init?.method === 'POST') {
            lanzado = true;
            return json({ lanzado: true, id: PEDIDO.id, creditos: PEDIDO.creditos });
          }
          if (lanzado && caidas > 0) {
            caidas--;
            return caidas === 1 ? json({ detail: 'x' }, 503) : sinRed();
          }
          return json({ imagenes: [], pendientes: lanzado ? [PEDIDO] : [] });
        },
      },
    });
    pintar();
    await screen.findByText('La historia del café');
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    await userEvent.type(caja(), 'un faro de noche');
    await userEvent.click(botonModelo());
    const menu = screen.getByRole('dialog', { name: 'Elegir modelo' });
    await userEvent.click(within(menu).getByRole('radio', { name: /Nano Banana 2/ }));
    await userEvent.click(within(menu).getByRole('button', { name: 'Crear' }));
    expect(await screen.findByText('Listo, ya va. Míralo abajo, en «Mis creaciones».')).toBeInTheDocument();
    const lecturas = () => llamadas(f, '/api/imagenes', 'GET').length;
    const generando = () => screen.queryAllByRole('article').filter(a => a.getAttribute('aria-busy') === 'true');
    // la relectura tras el POST cayó (503): la tarjeta de lo recién pedido es lo único que dice que va en camino
    await waitFor(() => expect(lecturas()).toBe(2));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000); // que la lectura fallida termine de asentarse (aún no toca el reintento)
    });
    expect(generando()).toHaveLength(1);
    expect(generando()[0]).toHaveTextContent('un faro de noche');
    // se sigue intentando cada 5 s y, mientras no salga bien, la tarjeta se queda (aquí cae la red)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(lecturas()).toBe(3);
    expect(generando()).toHaveLength(1);
    // sale bien: queda UNA tarjeta, la del servidor, y como sigue generándose se sigue preguntando solo
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(lecturas()).toBe(4);
    expect(generando()).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(lecturas()).toBe(5);
    expect(generando()).toHaveLength(1);
  });

  it('inicio.caja.un_pedido_que_el_servidor_rechazo_no_deja_su_tarjeta_aunque_la_lista_no_llegue', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ponerMonedero(100);
    // el POST da 500 (nada quedó en marcha) y la lista tampoco responde: no hay nada que conservar
    let pedido = false;
    const f = montar({
      rutas: {
        '/api/imagenes': (_url, init) => {
          if (init?.method === 'POST') {
            pedido = true;
            return json({ detail: 'Algo falló' }, 500);
          }
          return pedido ? json({ detail: 'x' }, 503) : json({ imagenes: [] });
        },
      },
    });
    pintar();
    await screen.findByText('La historia del café');
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    await userEvent.type(caja(), 'un faro de noche');
    await userEvent.click(botonModelo());
    const menu = screen.getByRole('dialog', { name: 'Elegir modelo' });
    await userEvent.click(within(menu).getByRole('radio', { name: /Nano Banana 2/ }));
    await userEvent.click(within(menu).getByRole('button', { name: 'Crear' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Algo falló');
    await waitFor(() => expect(llamadas(f, '/api/imagenes', 'GET').length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.queryAllByRole('article').filter(a => a.getAttribute('aria-busy') === 'true')).toHaveLength(0));
    // y no se queda preguntando por algo que no existe
    const despues = llamadas(f, '/api/imagenes', 'GET').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11000);
    });
    expect(llamadas(f, '/api/imagenes', 'GET').length).toBe(despues);
  });

  it('inicio.caja.una_lectura_con_los_pedidos_sin_leer_no_cuenta_como_buena_y_la_tarjeta_se_queda', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ponerMonedero(100);
    // el servidor cobra y contesta `lanzado`; la primera lectura tras eso sale 200 pero sin poder leer los pedidos
    // (pendientes_ok: false, pendientes vacía), y la siguiente ya los trae
    let lanzado = false;
    let degradadas = 1;
    const f = montar({
      rutas: {
        '/api/imagenes': (_url, init) => {
          if (init?.method === 'POST') {
            lanzado = true;
            return json({ lanzado: true, id: PEDIDO.id, creditos: PEDIDO.creditos });
          }
          if (lanzado && degradadas > 0) {
            degradadas--;
            return json(DEGRADADA);
          }
          return json({ imagenes: [], pendientes: lanzado ? [PEDIDO] : [], pendientes_ok: true });
        },
      },
    });
    pintar();
    await screen.findByText('La historia del café');
    await pedirImagenLenta('un faro de noche');
    expect(await screen.findByText('Listo, ya va. Míralo abajo, en «Mis creaciones».')).toBeInTheDocument();
    await waitFor(() => expect(lecturasDeImagenes(f)).toBe(2));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000); // que la lectura degradada termine de asentarse
    });
    // «no pude leer tus pedidos» no es «no tienes pedidos»: la tarjeta de lo recién pedido sigue, es lo único que dice que va en camino
    expect(generando()).toHaveLength(1);
    expect(generando()[0]).toHaveTextContent('un faro de noche');
    // y se vuelve a preguntar: la siguiente sale bien y queda UNA tarjeta, la del servidor
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(lecturasDeImagenes(f)).toBe(3);
    expect(generando()).toHaveLength(1);
    // como esa sigue generándose, se sigue preguntando sola
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(lecturasDeImagenes(f)).toBe(4);
    expect(generando()).toHaveLength(1);
  });

  it('inicio.caja.si_la_lista_no_sale_bien_en_2_min_se_suelta_la_tarjeta_y_se_avisa', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ponerMonedero(100);
    // desde que se pide, el servidor contesta 200 pero sin poder leer los pedidos, todas las veces
    let lanzado = false;
    let sano = false;
    const f = montar({
      rutas: {
        '/api/imagenes': (_url, init) => {
          if (init?.method === 'POST') {
            lanzado = true;
            return json({ lanzado: true, id: PEDIDO.id, creditos: PEDIDO.creditos });
          }
          if (lanzado && !sano) return json(DEGRADADA);
          return json({ imagenes: [], pendientes: lanzado ? [PEDIDO] : [], pendientes_ok: true });
        },
      },
    });
    pintar();
    await screen.findByText('La historia del café');
    await pedirImagenLenta('un faro de noche');
    expect(await screen.findByText('Listo, ya va. Míralo abajo, en «Mis creaciones».')).toBeInTheDocument();
    await waitFor(() => expect(lecturasDeImagenes(f)).toBe(2));
    // durante los 2 min la tarjeta se queda y no hay aviso: se sigue intentando cada 5 s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(110_000);
    });
    expect(generando()).toHaveLength(1);
    expect(screen.queryByText(/No pudimos traer tus videos/)).toBeNull();
    expect(lecturasDeImagenes(f)).toBeGreaterThan(15);
    // pasados los 2 min sin una lectura buena: la tarjeta se suelta y sale el aviso de siempre, con su «Reintentar»
    await act(async () => {
      await vi.advanceTimersByTimeAsync(21_000);
    });
    expect(await screen.findByText(/No pudimos traer tus videos/)).toBeInTheDocument();
    expect(generando()).toHaveLength(0);
    // y ya no gira ni sigue preguntando: nada queda esperando
    const alSoltar = lecturasDeImagenes(f);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(lecturasDeImagenes(f)).toBe(alSoltar);
    expect(screen.getByText(/No pudimos traer tus videos/)).toBeInTheDocument();
    // «Reintentar» con la lista ya sana: el aviso se va y la imagen sale de la lista del servidor
    sano = true;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.queryByText(/No pudimos traer tus videos/)).toBeNull());
    expect(generando()).toHaveLength(1);
    expect(generando()[0]).toHaveTextContent('un faro de noche');
  });

  it('inicio.caja.el_aviso_de_no_poder_confirmar_se_queda_aunque_otra_imagen_siga_preguntando', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ponerMonedero(100);
    const OTRA: PedidoImagen = { ...PEDIDO, id: 'img-20261011-110000-def456', texto: 'una luna de queso' };
    // otra imagen ya iba generándose (la lista la trajo bien); desde que se pide la nueva, la lista sale 200
    // sin poder leer los pedidos, todas las veces
    let lanzado = false;
    const f = montar({
      rutas: {
        '/api/imagenes': (_url, init) => {
          if (init?.method === 'POST') {
            lanzado = true;
            return json({ lanzado: true, id: PEDIDO.id, creditos: PEDIDO.creditos });
          }
          return json(lanzado ? DEGRADADA : { imagenes: [], pendientes: [OTRA], pendientes_ok: true });
        },
      },
    });
    pintar();
    await screen.findByText('una luna de queso');
    await pedirImagenLenta('un faro de noche');
    expect(await screen.findByText('Listo, ya va. Míralo abajo, en «Mis creaciones».')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(131_000);
    });
    // la tarjeta local se soltó y el aviso sale; la otra imagen sigue a la vista y se sigue preguntando
    expect(await screen.findByText(/No pudimos traer tus videos/)).toBeInTheDocument();
    expect(generando()).toHaveLength(1);
    expect(generando()[0]).toHaveTextContent('una luna de queso');
    const alSoltar = lecturasDeImagenes(f);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
    expect(lecturasDeImagenes(f)).toBeGreaterThan(alSoltar);
    // y el aviso no se va solo con esas lecturas: sigue sin haber una buena
    expect(screen.getByText(/No pudimos traer tus videos/)).toBeInTheDocument();
  });

  it('inicio.caja.una_imagen_que_el_servidor_ya_hizo_no_deja_una_tarjeta_girando_si_la_lista_no_llega', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ponerMonedero(100);
    // el modelo rápido y la edición contestan {nombre, url}: la imagen ya está hecha. Si la lista no llega, no hay
    // nada que esperar ni que girar (solo lo que el servidor dijo que sigue en marcha, `lanzado`, se conserva)
    let pedido = false;
    const f = montar({
      rutas: {
        '/api/imagenes': (_url, init) => {
          if (init?.method === 'POST') {
            pedido = true;
            return json({ nombre: 'n.jpg', url: '/api/imagenes/n.jpg' });
          }
          return pedido ? json({ detail: 'x' }, 503) : json({ imagenes: [] });
        },
        '/api/imagenes/editar': () => {
          pedido = true;
          return json({ nombre: 'e.jpg', url: '/api/imagenes/e.jpg' });
        },
      },
    });
    const { container } = pintar();
    await screen.findByText('La historia del café');
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    await userEvent.type(caja(), 'un gato en la luna');
    await userEvent.click(botonModelo());
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Elegir modelo' })).getByRole('button', { name: 'Crear' }));
    expect(await screen.findByText('Listo, ya va. Míralo abajo, en «Mis creaciones».')).toBeInTheDocument();
    await waitFor(() => expect(lecturasDeImagenes(f)).toBe(2));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(generando()).toHaveLength(0);
    // y no se queda preguntando por algo que ya está hecho
    const despues = lecturasDeImagenes(f);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11000);
    });
    expect(lecturasDeImagenes(f)).toBe(despues);
    // lo mismo con la edición, que es síncrona
    await elegirOpcion('Editar una imagen');
    await userEvent.upload(entradaDeFotos(container), foto('gato.png'));
    await userEvent.type(caja(), 'ponle un sombrero');
    await userEvent.click(botonModelo());
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Elegir modelo' })).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(llamadas(f, '/api/imagenes/editar')).toHaveLength(1));
    await waitFor(() => expect(lecturasDeImagenes(f)).toBe(despues + 1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(generando()).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11000);
    });
    expect(lecturasDeImagenes(f)).toBe(despues + 1);
  });

  it('inicio.caja.si_la_lista_se_cae_del_todo_tambien_se_suelta_la_tarjeta_a_los_2_min', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ponerMonedero(100);
    // el POST sale bien y desde ahí GET /api/imagenes da 500 siempre
    let lanzado = false;
    const f = montar({
      rutas: {
        '/api/imagenes': (_url, init) => {
          if (init?.method === 'POST') {
            lanzado = true;
            return json({ lanzado: true, id: PEDIDO.id, creditos: PEDIDO.creditos });
          }
          return lanzado ? json({ detail: 'x' }, 500) : json({ imagenes: [] });
        },
      },
    });
    pintar();
    await screen.findByText('La historia del café');
    await pedirImagenLenta('un faro de noche');
    expect(await screen.findByText('Listo, ya va. Míralo abajo, en «Mis creaciones».')).toBeInTheDocument();
    await waitFor(() => expect(lecturasDeImagenes(f)).toBe(2));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(110_000);
    });
    expect(generando()).toHaveLength(1);
    expect(screen.queryByText(/No pudimos traer tus videos/)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(21_000);
    });
    expect(await screen.findByText(/No pudimos traer tus videos/)).toBeInTheDocument();
    expect(generando()).toHaveLength(0);
    const alSoltar = lecturasDeImagenes(f);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(lecturasDeImagenes(f)).toBe(alSoltar);
  });

  it('inicio.caja.quien_empieza_ve_su_tarjeta_aunque_la_lista_no_traiga_los_pedidos', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ponerMonedero(100);
    // sin nada hecho todavía (los tres caminos), su primera imagen se pide y la lectura sale sin poder leer los pedidos:
    // listas vacías no es lo mismo que «no pidió nada», y la tarjeta es lo único que dice que va en camino
    let lanzado = false;
    montar({
      proyectos: [],
      rutas: {
        '/api/imagenes': (_url, init) => {
          if (init?.method === 'POST') {
            lanzado = true;
            return json({ lanzado: true, id: PEDIDO.id, creditos: PEDIDO.creditos });
          }
          return json(lanzado ? DEGRADADA : { imagenes: [], pendientes: [], pendientes_ok: true });
        },
      },
    });
    pintar();
    expect(await screen.findByRole('heading', { name: 'Tu primer video, en tres caminos' })).toBeInTheDocument();
    await pedirImagenLenta('un faro de noche');
    expect(await screen.findByText('Listo, ya va. Míralo abajo, en «Mis creaciones».')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.queryByRole('heading', { name: /tres caminos/ })).toBeNull();
    expect(generando()).toHaveLength(1);
    expect(generando()[0]).toHaveTextContent('un faro de noche');
  });

  it('inicio.caja.dos_pedidos_seguidos_con_la_primera_lectura_degradada_no_dejan_tarjetas_de_mas', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ponerMonedero(100);
    const SEGUNDO: PedidoImagen = { ...PEDIDO, id: 'img-20261011-120100-def456', texto: 'una luna de queso' };
    // el primer pedido sale y su relectura es degradada (la tarjeta se queda); el segundo sale antes del siguiente
    // intento y su relectura sí es buena: trae los dos pedidos
    let lanzados: PedidoImagen[] = [];
    let degradadas = 1;
    const f = montar({
      rutas: {
        '/api/imagenes': (_url, init) => {
          if (init?.method === 'POST') {
            const p = lanzados.length ? SEGUNDO : PEDIDO;
            lanzados = [...lanzados, p];
            return json({ lanzado: true, id: p.id, creditos: p.creditos });
          }
          if (lanzados.length && degradadas > 0) {
            degradadas--;
            return json(DEGRADADA);
          }
          return json({ imagenes: [], pendientes: lanzados, pendientes_ok: true });
        },
      },
    });
    pintar();
    await screen.findByText('La historia del café');
    await pedirImagenLenta('un faro de noche');
    await screen.findByText('Listo, ya va. Míralo abajo, en «Mis creaciones».');
    await waitFor(() => expect(lecturasDeImagenes(f)).toBe(2));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(generando()).toHaveLength(1);
    // el segundo pedido, antes de que toque el siguiente intento
    await userEvent.type(caja(), 'una luna de queso');
    await userEvent.click(enviar());
    await waitFor(() => expect(lecturasDeImagenes(f)).toBe(3));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    // la lectura buena trajo los dos: quedan dos tarjetas (las del servidor), no tres con una repetida
    expect(generando()).toHaveLength(2);
    expect(generando().map(a => a.textContent).join('|')).toMatch(/una luna de queso/);
    expect(generando().filter(a => a.textContent?.includes('un faro de noche'))).toHaveLength(1);
  });

  it('inicio.caja.editar_pide_la_imagen_con_el_mas', async () => {
    const f = montar({ rutas: { '/api/imagenes/editar': () => json({ nombre: 'e.jpg', url: '/api/imagenes/e.jpg' }) } });
    const { container } = pintar();
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    await elegirOpcion('Editar una imagen');
    await userEvent.type(caja(), 'ponle un sombrero');
    await userEvent.click(botonModelo());
    const crearEnMenu = () => within(screen.getByRole('dialog', { name: 'Elegir modelo' })).getByRole('button', { name: 'Crear' });
    // sin imagen no sale, y dice cómo agregarla
    await userEvent.click(crearEnMenu());
    expect(screen.getByRole('alert')).toHaveTextContent('Agrega con el + la imagen');
    expect(llamadas(f, '/api/imagenes/editar')).toHaveLength(0);
    // con imagen sí: va como formulario, en modo «toda la imagen», con el modelo
    await userEvent.upload(entradaDeFotos(container), foto('gato.png'));
    await userEvent.click(botonModelo()); // el clic de subir cerró el menú
    await userEvent.click(crearEnMenu());
    await waitFor(() => expect(llamadas(f, '/api/imagenes/editar')).toHaveLength(1));
    const fd = llamadas(f, '/api/imagenes/editar')[0]![1]!.body as FormData;
    expect(fd.get('prompt')).toBe('ponle un sombrero');
    expect(fd.get('modo')).toBe('todo');
    expect(fd.get('modelo')).toBe('grok');
    expect((fd.get('imagen') as File).name).toBe('gato.png');
  });

  it('inicio.caja.editar_no_ofrece_nano_banana_2', async () => {
    // 14-oct-2026: editar con Nano Banana 2 pasaba de los 29 s de la Lambda con un arranque en frío y podía cobrar
    // sin entregar; salió de editar (sin número en tarifas.json). Crear con él sigue
    const f = montar({ rutas: { '/api/imagenes/editar': () => json({ nombre: 'e.jpg', url: '/api/imagenes/e.jpg' }) } });
    const { container } = pintar();
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    await elegirOpcion('Editar una imagen');
    await userEvent.type(caja(), 'ponle un sombrero');
    await userEvent.upload(entradaDeFotos(container), foto('gato.png'));
    await userEvent.click(botonModelo());
    const menu = screen.getByRole('dialog', { name: 'Elegir modelo' });
    expect(within(menu).queryByRole('radio', { name: /Nano Banana 2/ })).toBeNull();
    expect(within(menu).getByRole('radio', { name: /Grok Imagine/ })).toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(llamadas(f, '/api/imagenes/editar')).toHaveLength(1));
    const fd = llamadas(f, '/api/imagenes/editar')[0]![1]!.body as FormData;
    expect(fd.get('modelo')).toBe('grok');
    expect(fd.get('modo')).toBe('todo');
    expect((fd.get('imagen') as File).name).toBe('gato.png');
  });

  it('inicio.caja.el_mas_agrega_quita_y_respeta_el_tope', async () => {
    const { container } = (montar(), pintar());
    expect(screen.getByRole('button', { name: 'Agregar imágenes de referencia' })).toBeInTheDocument();
    // «Edición» no usa imágenes: su «+» es del video, y el de imágenes no está (cuentos e historias SÍ lo tienen:
    // dueño, 14-oct-2026; ver inicio.caja.cuentos_e_historia_tienen_el_mas...)
    await userEvent.click(screen.getByRole('button', { name: 'Edición' }));
    expect(screen.queryByRole('button', { name: /^Agregar (imágenes|una imagen|la imagen|la foto)/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Video' }));
    expect(botonOpcion()).toHaveTextContent('Un video corto');
    await userEvent.upload(entradaDeFotos(container), [foto('a.png'), foto('b.png'), foto('c.png'), foto('d.png')]);
    const lista = screen.getByRole('list', { name: 'Imágenes de referencia' });
    expect(within(lista).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('alert')).toHaveTextContent('Como mucho 3');
    await userEvent.click(within(lista).getByRole('button', { name: 'Quitar «b.png»' }));
    expect(within(lista).getAllByRole('listitem')).toHaveLength(2);
    // un archivo que el clip no lee se rechaza con su motivo
    await userEvent.upload(entradaDeFotos(container), new File(['x'], 'nota.txt', { type: 'image/png' }));
    expect(screen.getByRole('alert')).toHaveTextContent('«nota.txt» no se puede usar');
    expect(within(lista).getAllByRole('listitem')).toHaveLength(2);
  });

  it('inicio.caja.el_clip_con_fotos_las_sube_y_suma_el_juntarlas', async () => {
    let n = 0;
    const f = montar({
      rutas: {
        '/api/clip/presign': () => json({ url: 'https://s3.test/subida/' + ++n, key: `usuarios/u/clips/subidas/${n}.png`, content_type: 'image/png' }),
        'https://s3.test/subida': () => new Response('', { status: 200 }),
        '/api/clip/generar': () => json({ lanzado: true, id: 'clip-2', creditos: 38 }),
      },
    });
    const { container } = pintar();
    await userEvent.type(caja(), 'mis dos perros juntos');
    await userEvent.upload(entradaDeFotos(container), [foto('uno.png'), foto('dos.png')]);
    await userEvent.click(botonModelo());
    const menu = screen.getByRole('dialog', { name: 'Elegir modelo' });
    // con dos fotos se juntan en una, y eso suma lo que dice tarifas.json
    expect(menu).toHaveTextContent('+ ✦ ' + clip.componer_imagenes + ' por juntar tus 2 imágenes en una');
    // y no depende de la duración del clip
    await userEvent.click(within(menu).getByRole('radio', { name: '4 s' }));
    expect(menu).toHaveTextContent('+ ✦ ' + clip.componer_imagenes + ' por juntar tus 2 imágenes en una');
    await userEvent.click(within(menu).getByRole('radio', { name: '8 s' }));
    await userEvent.click(within(menu).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(llamadas(f, '/api/clip/generar')).toHaveLength(1));
    expect(llamadas(f, '/api/clip/presign')).toHaveLength(2);
    expect(cuerpoDe(f, '/api/clip/generar').imagenes).toEqual(['usuarios/u/clips/subidas/1.png', 'usuarios/u/clips/subidas/2.png']);
  });

  it('inicio.caja.arrastrar_imagenes_a_la_caja_las_agrega', async () => {
    montar();
    pintar();
    const seccion = caja().closest('section')!;
    fireEvent.dragOver(seccion, { dataTransfer: { files: [], types: ['Files'] } });
    fireEvent.drop(seccion, { dataTransfer: { files: [foto('arrastrada.png')], types: ['Files'] } });
    expect(await screen.findByRole('button', { name: 'Quitar «arrastrada.png»' })).toBeInTheDocument();
  });

  it('inicio.caja.arrastrar_una_imagen_a_crear_una_imagen_pasa_a_editar_y_un_texto_arrastrado_no_se_corta', async () => {
    montar();
    pintar();
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    expect(botonOpcion()).toHaveTextContent('Crear una imagen');
    const seccion = caja().closest('section')!;
    // mover un texto seleccionado dentro de la caja (no trae archivos) sigue su camino normal: nadie lo cancela
    expect(fireEvent.dragOver(seccion, { dataTransfer: { files: [], types: ['text/plain'] } })).toBe(true);
    expect(fireEvent.drop(seccion, { dataTransfer: { files: [], types: ['text/plain'] } })).toBe(true);
    expect(seccion).not.toHaveClass('border-dashed');
    expect(botonOpcion()).toHaveTextContent('Crear una imagen');
    // un archivo sí: se acepta el arrastre y, al soltarlo, la caja pasa a editar
    expect(fireEvent.dragOver(seccion, { dataTransfer: { files: [], types: ['Files'] } })).toBe(false);
    expect(seccion).toHaveClass('border-dashed');
    fireEvent.drop(seccion, { dataTransfer: { files: [foto('arrastrada.png')], types: ['Files'] } });
    expect(await screen.findByRole('button', { name: 'Quitar «arrastrada.png»' })).toBeInTheDocument();
    expect(botonOpcion()).toHaveTextContent('Editar una imagen');
  });

  it('en modo de alto contraste la caja incrustada no pinta un segundo marco dentro de la tarjeta; al arrastrar archivos sí (discontinuo)', async () => {
    montar();
    pintar();
    const seccion = caja().closest('section')!;
    // el borde transparente existe para que nada se mueva al arrastrar; con `forced-colors` el navegador lo pinta del color del sistema
    // aunque sea transparente, y se vería un marco dentro del marco de la tarjeta
    expect(seccion).toHaveClass('border', 'border-transparent', 'forced-colors:border-0');
    expect(seccion).not.toHaveClass('border-dashed');
    // el «suelta aquí» SÍ es un marco que hay que ver, también en alto contraste
    fireEvent.dragOver(seccion, { dataTransfer: { files: [], types: ['Files'] } });
    expect(seccion).toHaveClass('border-dashed', 'border-ambar');
    expect(seccion).not.toHaveClass('border-transparent');
    expect(seccion).not.toHaveClass('forced-colors:border-0');
  });

  it('inicio.caja.crear_una_imagen_tambien_tiene_el_mas_y_con_una_imagen_la_caja_edita', async () => {
    nb2EditaEnLaPrueba(); // para ver que el modelo de crear se lleva cuando también edita
    const f = montar({ rutas: { '/api/imagenes/editar': () => json({ nombre: 'e.jpg', url: '/api/imagenes/e.jpg' }) } });
    const { container } = pintar();
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    expect(botonOpcion()).toHaveTextContent('Crear una imagen');
    // el «+» ya está en «Crear una imagen», aunque todavía no haya miniatura
    expect(screen.getByRole('button', { name: 'Agregar una imagen para editarla' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Imágenes de referencia' })).toBeNull();
    await userEvent.type(caja(), 'ponle un sombrero');
    await userEvent.click(botonModelo());
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Elegir modelo' })).getByRole('radio', { name: /Nano Banana 2/ }));
    await userEvent.keyboard('{Escape}');
    await userEvent.upload(entradaDeFotos(container), foto('gato.png'));
    // con una imagen la tarea es editarla: la caja pasa sola, con su miniatura, su texto y el mismo modelo (aquí nb2 también edita)
    expect(botonOpcion()).toHaveTextContent('Editar una imagen');
    expect(await screen.findByRole('button', { name: 'Quitar «gato.png»' })).toBeInTheDocument();
    expect(botonModelo()).toHaveTextContent('Modelo Nano Banana 2');
    expect(screen.getByRole('status')).toHaveTextContent('pasamos a «Editar una imagen»');
    expect(caja()).toHaveValue('ponle un sombrero');
    await userEvent.click(botonModelo());
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Elegir modelo' })).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(llamadas(f, '/api/imagenes/editar')).toHaveLength(1));
    expect(llamadas(f, '/api/imagenes')).toHaveLength(0); // no se pidió una imagen desde cero
    const fd = llamadas(f, '/api/imagenes/editar')[0]![1]!.body as FormData;
    expect(fd.get('modelo')).toBe('nb2');
    expect(fd.get('modo')).toBe('todo');
    expect((fd.get('imagen') as File).name).toBe('gato.png');
  });

  it('inicio.caja.si_el_modelo_de_crear_no_edita_la_caja_edita_con_el_predeterminado', async () => {
    montar();
    const { container } = pintar();
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    await userEvent.click(botonModelo());
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Elegir modelo' })).getByRole('radio', { name: /FLUX\.2 klein/ }));
    await userEvent.keyboard('{Escape}');
    expect(botonModelo()).toHaveTextContent('Modelo FLUX.2 klein');
    await userEvent.upload(entradaDeFotos(container), foto('gato.png'));
    expect(botonOpcion()).toHaveTextContent('Editar una imagen');
    // klein no tiene versión que edite: no se le pide editar, queda el de siempre
    expect(botonModelo()).toHaveTextContent('Modelo Grok Imagine');
  });

  it('inicio.caja.una_imagen_que_no_sirve_no_saca_a_crear_una_imagen_de_su_tarea', async () => {
    montar();
    const { container } = pintar();
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    await userEvent.upload(entradaDeFotos(container), new File(['x'], 'nota.txt', { type: 'image/png' }));
    expect(screen.getByRole('alert')).toHaveTextContent('«nota.txt» no se puede usar');
    // un .gif lo lee el clip pero NO el editor: en «Crear una imagen» rige la lista del editor
    await userEvent.upload(entradaDeFotos(container), foto('animada.gif', 'image/gif'));
    expect(screen.getByRole('alert')).toHaveTextContent('«animada.gif» no se puede usar. Sirven: .jpg, .jpeg, .png, .webp.');
    // la caja sigue donde estaba y sin miniatura
    expect(botonOpcion()).toHaveTextContent('Crear una imagen');
    expect(screen.queryByRole('list', { name: 'Imágenes de referencia' })).toBeNull();
  });

  // el portapapeles de mentira: jsdom no trae DataTransfer
  const pegar = (
    destino: Element,
    { archivos = [], texto = '', elementos }: { archivos?: File[]; texto?: string; elementos?: Array<{ kind: string; getAsFile: () => File | null }> } = {},
  ) =>
    // true si nadie cortó el pegado (si se pegó como texto, el navegador sigue con lo suyo)
    fireEvent.paste(destino, { clipboardData: { files: archivos, items: elementos ?? [], getData: () => texto } });

  it('inicio.caja.pegar_una_imagen_la_agrega_igual_que_el_mas', async () => {
    montar();
    pintar();
    // una captura llega como «image.png»: se le pone un nombre que diga qué es, y el pegado no sigue como texto
    expect(pegar(caja(), { archivos: [foto('image.png')] })).toBe(false);
    expect(await screen.findByRole('button', { name: 'Quitar «imagen-pegada.png»' })).toBeInTheDocument();
    // un archivo copiado del explorador conserva su nombre
    pegar(caja(), { archivos: [foto('vacaciones.jpg', 'image/jpeg')] });
    expect(await screen.findByRole('button', { name: 'Quitar «vacaciones.jpg»' })).toBeInTheDocument();
    // dos capturas juntas no se llaman igual
    pegar(caja(), { archivos: [foto('image.png'), foto('image.png')] });
    expect(await screen.findByRole('alert')).toHaveTextContent('Como mucho 3');
    expect(screen.getByRole('button', { name: 'Quitar «imagen-pegada-1.png»' })).toBeInTheDocument();
    // da igual dónde esté el foco de la página: con un lugar libre, el pegado sobre el body suma
    await userEvent.click(screen.getByRole('button', { name: 'Quitar «vacaciones.jpg»' }));
    pegar(document.body, { archivos: [foto('suelta.webp', 'image/webp')] });
    expect(await screen.findByRole('button', { name: 'Quitar «suelta.webp»' })).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Imágenes de referencia' })).getAllByRole('listitem')).toHaveLength(3);
  });

  it('inicio.caja.pegar_trae_la_imagen_aunque_el_navegador_solo_la_ofrezca_como_elemento', async () => {
    montar();
    pintar();
    const archivo = new File(['x'], 'image.png', { type: 'image/png' });
    pegar(caja(), { elementos: [{ kind: 'string', getAsFile: () => null }, { kind: 'file', getAsFile: () => archivo }] });
    expect(await screen.findByRole('button', { name: 'Quitar «imagen-pegada.png»' })).toBeInTheDocument();
  });

  it('inicio.caja.pegar_un_archivo_del_finder_cuenta_aunque_el_texto_sea_su_nombre', async () => {
    montar();
    pintar();
    // el Finder de macOS (con Chrome) pone el NOMBRE del archivo como texto junto al archivo: es la imagen, no letras
    expect(pegar(caja(), { archivos: [foto('Foto del gato.png')], texto: 'Foto del gato.png' })).toBe(false);
    expect(await screen.findByRole('button', { name: 'Quitar «Foto del gato.png»' })).toBeInTheDocument();
    // pero un texto que no es el nombre del archivo sigue siendo texto
    expect(pegar(caja(), { archivos: [foto('otra.png')], texto: 'una tabla de Excel' })).toBe(true);
    expect(screen.queryByRole('button', { name: 'Quitar «otra.png»' })).toBeNull();
  });

  it('inicio.caja.pegar_texto_o_lo_que_no_es_imagen_no_se_toca', async () => {
    montar();
    pintar();
    // Word y Excel mandan las letras y una foto de ellas: ganan las letras
    expect(pegar(caja(), { texto: 'una tabla', archivos: [foto('image.png')] })).toBe(true);
    // un PDF no es una imagen
    expect(pegar(caja(), { archivos: [new File(['x'], 'cuenta.pdf', { type: 'application/pdf' })] })).toBe(true);
    expect(pegar(caja())).toBe(true);
    expect(screen.queryByRole('list', { name: 'Imágenes de referencia' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('inicio.caja.pegar_solo_agrega_donde_la_caja_usa_imagenes_y_a_la_vista', async () => {
    montar();
    const { container } = pintar();
    // «Edición» no usa imágenes (lo que se pega ahí es de su campo; el video se agrega con su «+»)
    await userEvent.click(screen.getByRole('button', { name: 'Edición' }));
    expect(pegar(document.body, { archivos: [foto('image.png')] })).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Video' }));
    expect(botonOpcion()).toHaveTextContent('Un video corto');
    expect(screen.queryByRole('list', { name: 'Imágenes de referencia' })).toBeNull();
    // en otro campo de la página (la clave de Blotato…) lo pegado es de ese campo
    const otro = document.createElement('input');
    document.body.appendChild(otro);
    try {
      expect(pegar(otro, { archivos: [foto('image.png')] })).toBe(true);
    } finally {
      otro.remove();
    }
    // con un diálogo abierto la caja queda detrás (la biblioteca la oculta con aria-hidden): no se le agrega nada
    container.setAttribute('aria-hidden', 'true');
    expect(pegar(document.body, { archivos: [foto('image.png')] })).toBe(true);
    container.removeAttribute('aria-hidden');
    expect(screen.queryByRole('list', { name: 'Imágenes de referencia' })).toBeNull();
    // y con la caja a la vista, sí
    expect(pegar(document.body, { archivos: [foto('image.png')] })).toBe(false);
    expect(await screen.findByRole('list', { name: 'Imágenes de referencia' })).toBeInTheDocument();
  });

  it('pegar con la caja escondida por la tarjeta (el mapa, las opciones o una lista a la vista) no agrega nada ni corta el pegado', async () => {
    montar();
    pintar();
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    // el mapa (y las tres opciones, y la lista de un grupo) esconden la caja con `hidden`, sin aria-hidden: sigue montada, pero no se ve
    await userEvent.click(screen.getByRole('button', { name: /^Volver al mapa para cambiar de área/ }));
    expect(screen.queryByRole('textbox', { name: '¿Qué vamos a crear hoy?' })).toBeNull();
    // nadie corta el pegado (no hay otro campo que lo reciba, pero tampoco es de la caja) y no se le agrega nada sin que se vea
    expect(pegar(document.body, { archivos: [foto('image.png')] })).toBe(true);
    await irALaLista('Blotato');
    expect(pegar(document.body, { archivos: [foto('image.png')] })).toBe(true);
    await irALaLista('Distrito');
    // la caja está como la dejó: ni una referencia que no vio entrar, ni el cambio a «Editar una imagen»
    expect(screen.queryByRole('list', { name: 'Imágenes de referencia' })).toBeNull();
    expect(botonOpcion()).toHaveTextContent('Crear una imagen');
    expect(screen.queryByRole('status')).toBeNull();
    // y con la caja de nuevo a la vista, pegar vuelve a funcionar
    expect(pegar(document.body, { archivos: [foto('image.png')] })).toBe(false);
    expect(await screen.findByRole('list', { name: 'Imágenes de referencia' })).toBeInTheDocument();
  });

  it('inicio.caja.pegar_una_imagen_en_crear_una_imagen_pasa_a_editar', async () => {
    montar();
    pintar();
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    expect(botonOpcion()).toHaveTextContent('Crear una imagen');
    pegar(caja(), { archivos: [foto('image.png')] });
    expect(await screen.findByRole('button', { name: 'Quitar «imagen-pegada.png»' })).toBeInTheDocument();
    expect(botonOpcion()).toHaveTextContent('Editar una imagen');
  });

  it('inicio.caja.lo_que_la_caja_dice_sale_en_el_cuadro_de_abajo_a_la_derecha', async () => {
    const avisos = ponerAvisos();
    const f = montar({
      rutas: {
        '/api/clip/generar': () => json({ detail: 'Créditos insuficientes: esta acción cuesta 36 créditos y tu saldo es 2.' }, 402),
      },
    });
    const { container } = pintar();
    const dicho = () => avisos.mostrar.mock.calls.map(c => ({ texto: c[0], ...c[1] }));
    const crearEnMenu = async () => {
      await userEvent.click(botonModelo());
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Elegir modelo' })).getByRole('button', { name: 'Crear' }));
    };
    // sin texto: el error va al cuadro, no junto a la caja
    await crearEnMenu();
    expect(dicho()).toEqual([{ texto: expect.stringContaining('Cuéntanos qué quieres primero'), tipo: 'mal', clave: 'caja' }]);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    // un archivo que no sirve
    await userEvent.upload(entradaDeFotos(container), new File(['x'], 'nota.txt', { type: 'image/png' }));
    expect(dicho().at(-1)).toEqual({ texto: expect.stringContaining('«nota.txt» no se puede usar'), tipo: 'mal', clave: 'caja' });
    // al pedirlo: «ya lo estamos creando» sale en cuanto sale el pedido, con los segundos del clip, y lo rechaza el servidor
    await userEvent.type(caja(), 'un gato en la luna');
    await crearEnMenu();
    await waitFor(() => expect(llamadas(f, '/api/clip/generar')).toHaveLength(1));
    const creando = dicho().find(d => d.tipo === 'ok');
    expect(creando).toEqual({ texto: 'Ya estamos creando tu clip de 8 segundos. Míralo abajo, en «Mis creaciones».', tipo: 'ok', clave: 'caja' });
    // y el 402 lo reemplaza (misma clave): el aviso de «creando» no se queda mintiendo
    await waitFor(() => expect(dicho().at(-1)).toEqual({ texto: expect.stringContaining('Créditos insuficientes'), tipo: 'mal', clave: 'caja' }));
    expect(screen.queryByRole('alert')).toBeNull();
    // el texto sigue ahí para reintentar
    expect(caja()).toHaveValue('un gato en la luna');
  });

  it('inicio.caja.un_pedido_que_salio_bien_avisa_una_vez_en_el_cuadro_y_no_junto_a_la_caja', async () => {
    const avisos = ponerAvisos();
    montar({ rutas: { '/api/clip/generar': () => json({ lanzado: true, id: 'clip-2', creditos: 38 }) } });
    pintar();
    await userEvent.type(caja(), 'un gato en la luna');
    await userEvent.click(botonModelo());
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Elegir modelo' })).getByRole('radio', { name: '4 s' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Elegir modelo' })).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(caja()).toHaveValue(''));
    expect(avisos.mostrar).toHaveBeenCalledTimes(1);
    expect(avisos.mostrar).toHaveBeenCalledWith('Ya estamos creando tu clip de 4 segundos. Míralo abajo, en «Mis creaciones».', { tipo: 'ok', clave: 'caja' });
    // el «Listo, ya va» de siempre es de las páginas sin cuadro: aquí sería decir lo mismo dos veces
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('inicio.caja.una_imagen_y_una_edicion_dicen_que_se_estan_creando_o_editando', async () => {
    const avisos = ponerAvisos();
    montar({
      rutas: {
        '/api/imagenes': (_url, init) => (init?.method === 'POST' ? json({ nombre: 'n.jpg', url: '/api/imagenes/n.jpg' }) : json({ imagenes: [] })),
        '/api/imagenes/editar': () => json({ nombre: 'e.jpg', url: '/api/imagenes/e.jpg' }),
      },
    });
    const { container } = pintar();
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    await userEvent.type(caja(), 'un gato en la luna');
    await userEvent.click(botonModelo());
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Elegir modelo' })).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(avisos.mostrar).toHaveBeenCalledWith('Ya estamos creando tu imagen. Míralo abajo, en «Mis creaciones».', { tipo: 'ok', clave: 'caja' }));
    await waitFor(() => expect(caja()).toHaveValue(''));
    // con una imagen agregada, la edición
    await userEvent.type(caja(), 'ponle un sombrero');
    await userEvent.upload(entradaDeFotos(container), foto('gato.png'));
    await userEvent.click(botonModelo());
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Elegir modelo' })).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(avisos.mostrar).toHaveBeenCalledWith('Ya estamos editando tu imagen. Míralo abajo, en «Mis creaciones».', { tipo: 'ok', clave: 'caja' }));
  });

  it('inicio.caja.un_texto_vetado_se_dice_en_el_cuadro', async () => {
    const avisos = ponerAvisos();
    montar({ rutas: { '/api/moderar': () => json({ permitido: false, mensaje: 'La IA no permite violencia explícita.', motivo: 'violencia' }) } });
    pintar();
    await userEvent.type(caja(), 'algo muy violento');
    await userEvent.click(botonModelo());
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Elegir modelo' })).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(avisos.mostrar).toHaveBeenCalledWith('La IA no permite violencia explícita.', { tipo: 'mal', clave: 'caja' }));
    expect(screen.queryByRole('alert')).toBeNull();
    // un veto no es «ya lo estamos creando»
    expect(avisos.mostrar).toHaveBeenCalledTimes(1);
  });

  it('inicio.caja.al_corregir_lo_que_faltaba_el_error_del_cuadro_se_quita_y_el_creando_no', async () => {
    const avisos = ponerAvisos();
    montar({ rutas: { '/api/imagenes/editar': () => json({ nombre: 'e.jpg', url: '/api/imagenes/e.jpg' }) } });
    const { container } = pintar();
    const dicho = () => avisos.mostrar.mock.calls.map(c => ({ texto: c[0], ...c[1] }));
    const crearEnMenu = async () => {
      await userEvent.click(botonModelo());
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Elegir modelo' })).getByRole('button', { name: 'Crear' }));
    };
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    await elegirOpcion('Editar una imagen');
    await userEvent.type(caja(), 'ponle un sombrero');
    await crearEnMenu();
    expect(dicho().at(-1)).toEqual({ texto: 'Agrega con el + la imagen que quieres editar.', tipo: 'mal', clave: 'caja' });
    // el aviso cae abajo a la derecha, donde está el «Crear» del menú: el menú se cierra para no quedar tapado
    expect(screen.queryByRole('dialog', { name: 'Elegir modelo' })).toBeNull();
    expect(avisos.quitar).not.toHaveBeenCalled();
    // agregada la imagen, «Agrega con el +» ya no dice la verdad: sale del cuadro
    await userEvent.upload(entradaDeFotos(container), foto('gato.png'));
    expect(avisos.quitar).toHaveBeenCalledTimes(1);
    expect(avisos.quitar).toHaveBeenCalledWith('caja');
    // y se pide: «ya estamos editando» (verde)
    await crearEnMenu();
    await waitFor(() => expect(dicho().at(-1)).toEqual({ texto: expect.stringContaining('Ya estamos editando tu imagen'), tipo: 'ok', clave: 'caja' }));
    await waitFor(() => expect(caja()).toHaveValue(''));
    // lo verde NO es un error: agregar otra imagen no lo quita
    await userEvent.upload(entradaDeFotos(container), foto('perro.png'));
    expect(avisos.quitar).toHaveBeenCalledTimes(1);
  });

  it('inicio.caja.un_lote_con_una_imagen_buena_y_otra_mala_conserva_el_aviso_de_la_mala', async () => {
    const avisos = ponerAvisos();
    montar();
    const { container } = pintar();
    await userEvent.upload(entradaDeFotos(container), [foto('buena.png'), new File(['x'], 'nota.txt', { type: 'image/png' })]);
    expect(await screen.findByRole('button', { name: 'Quitar «buena.png»' })).toBeInTheDocument();
    // la buena se agrega y la mala se dice (y no se quita después)
    expect(avisos.mostrar).toHaveBeenLastCalledWith(expect.stringContaining('«nota.txt» no se puede usar'), { tipo: 'mal', clave: 'caja' });
    expect(avisos.quitar).not.toHaveBeenCalled();
  });

  it('inicio.caja.los_avisos_de_agregar_tambien_van_al_cuadro', async () => {
    const avisos = ponerAvisos();
    montar();
    const { container } = pintar();
    // el tope de fotos del clip
    await userEvent.upload(entradaDeFotos(container), [foto('a.png'), foto('b.png'), foto('c.png'), foto('d.png')]);
    expect(avisos.mostrar).toHaveBeenLastCalledWith('Como mucho 3 imágenes.', { tipo: 'mal', clave: 'caja' });
    // «Crear una imagen» recibe una imagen y pasa a editar: lo dice en el cuadro, en verde
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    await userEvent.upload(entradaDeFotos(container), foto('gato.png'));
    expect(avisos.mostrar).toHaveBeenLastCalledWith('Con una imagen, la caja la edita: pasamos a «Editar una imagen».', { tipo: 'ok', clave: 'caja' });
    // y nada de eso aparece junto a la caja
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('inicio.caja.el_modelo_de_editar_que_ya_se_eligio_no_se_pisa_al_pasar_desde_crear', async () => {
    nb2EditaEnLaPrueba(); // hacen falta dos modelos que editan
    montar();
    const { container } = pintar();
    const elegirModelo = async (nombre: RegExp) => {
      await userEvent.click(botonModelo());
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Elegir modelo' })).getByRole('radio', { name: nombre }));
      await userEvent.keyboard('{Escape}');
    };
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    await elegirOpcion('Editar una imagen');
    await elegirModelo(/Nano Banana 2/);
    await elegirOpcion('Crear una imagen');
    await elegirModelo(/Grok Imagine/); // elegido a propósito para crear
    await userEvent.upload(entradaDeFotos(container), foto('gato.png'));
    expect(botonOpcion()).toHaveTextContent('Editar una imagen');
    // el de editar se respeta: no se le pisa con el de crear
    expect(botonModelo()).toHaveTextContent('Modelo Nano Banana 2');
  });

  it('inicio.caja.la_duracion_recalcula_los_precios_el_chip_y_el_pie', async () => {
    montar();
    pintar();
    const tabla = modelos.clip['veo-lite'];
    // los otros económicos (13-oct-2026): MiniMax, Grok Video y Grok 1.5 Lite; el encabezado del grupo da el rango de los cuatro
    const otros = { minimax: modelos.clip.h3t, grok: modelos.clip.grokv, lite: modelos.clip.grokl };
    // más corto, más barato
    for (const t of [tabla, ...Object.values(otros)]) {
      expect(t['4']).toBeLessThan(t['6']);
      expect(t['6']).toBeLessThan(t['8']);
    }
    expect(botonModelo()).toHaveTextContent('Modelo Veo 3.1 Lite · 8 s');
    await userEvent.click(botonModelo());
    const menu = screen.getByRole('dialog', { name: 'Elegir modelo' });
    const grupo = within(menu).getByRole('radiogroup', { name: 'Duración del clip' });
    expect(within(grupo).getAllByRole('radio').map(r => r.textContent)).toEqual(['4 s', '6 s', '8 s']);
    expect(within(grupo).getByRole('radio', { name: '8 s' })).toHaveAttribute('aria-checked', 'true');
    for (const s of ['6', '4', '8'] as const) {
      await userEvent.click(within(grupo).getByRole('radio', { name: s + ' s' }));
      expect(within(grupo).getByRole('radio', { name: s + ' s' })).toHaveAttribute('aria-checked', 'true');
      // el chip, la fila, el encabezado del grupo y el pie dicen los créditos de ESA duración
      expect(botonModelo()).toHaveTextContent('Modelo Veo 3.1 Lite · ' + s + ' s');
      expect(within(menu).getByRole('radio', { name: /Veo 3\.1 Lite/ })).toHaveTextContent('✦ ' + tabla[s]);
      expect(within(menu).getByRole('radio', { name: /MiniMax/ })).toHaveTextContent('✦ ' + otros.minimax[s]);
      expect(within(menu).getByRole('radio', { name: /Grok Imagine Video(?! 1\.5)/ })).toHaveTextContent('✦ ' + otros.grok[s]);
      expect(within(menu).getByRole('radio', { name: /Grok Imagine Video 1\.5 Lite/ })).toHaveTextContent('✦ ' + otros.lite[s]);
      const economicos = [tabla[s], otros.minimax[s], otros.grok[s], otros.lite[s]];
      expect(menu).toHaveTextContent(
        'Económicos✦ ' + Math.min(...economicos) + '–' + Math.max(...economicos) + ' por clip de ' + s + ' s',
      );
      expect(menu).toHaveTextContent('Veo 3.1 Lite✦ ' + tabla[s] + ' por clip de ' + s + ' s');
    }
    // y en la caja queda la última
    await userEvent.click(within(grupo).getByRole('radio', { name: '4 s' }));
    await userEvent.keyboard('{Escape}');
    expect(botonModelo()).toHaveTextContent('Modelo Veo 3.1 Lite · 4 s');
  });

  it('inicio.caja.el_clip_manda_los_segundos_elegidos', async () => {
    const f = montar({
      rutas: { '/api/clip/generar': () => json({ lanzado: true, id: 'clip-6', creditos: modelos.clip['veo-lite']['6'] }) },
    });
    pintar();
    await userEvent.type(caja(), 'un gato en la luna');
    await userEvent.click(botonModelo());
    const menu = screen.getByRole('dialog', { name: 'Elegir modelo' });
    await userEvent.click(within(menu).getByRole('radio', { name: '6 s' }));
    await userEvent.click(within(menu).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(llamadas(f, '/api/clip/generar')).toHaveLength(1));
    // viajan el modelo y los segundos; el precio lo calcula el servidor
    expect(cuerpoDe(f, '/api/clip/generar')).toEqual({
      texto: 'un gato en la luna',
      formato: 'horizontal',
      imagenes: [],
      modelo: 'veo-lite',
      segundos: 6,
      audio: true,
      puerta: 'caja',
    });
    expect(Object.keys(cuerpoDe(f, '/api/clip/generar'))).not.toContain('creditos');
    expect(await screen.findByRole('status')).toHaveTextContent('Mis creaciones');
    // la duración se queda para el próximo
    expect(botonModelo()).toHaveTextContent('Modelo Veo 3.1 Lite · 6 s');
  });

  it('inicio.caja.el_clip_manda_veo_fast_y_sus_segundos', async () => {
    const f = montar({
      rutas: { '/api/clip/generar': () => json({ lanzado: true, id: 'clip-fast', creditos: modelos.clip['veo-fast']['4'] }) },
    });
    pintar();
    await userEvent.type(caja(), 'un gato en la luna');
    await userEvent.click(botonModelo());
    const menu = screen.getByRole('dialog', { name: 'Elegir modelo' });
    await userEvent.click(within(menu).getByRole('radio', { name: /Veo 3\.1 Fast/ }));
    await userEvent.click(within(menu).getByRole('radio', { name: '4 s' }));
    // la fila enseña lo que dice tarifas.json a esa duración, y el servidor es quien cobra
    expect(within(menu).getByRole('radio', { name: /Veo 3\.1 Fast/ })).toHaveTextContent('✦ ' + modelos.clip['veo-fast']['4']);
    await userEvent.click(within(menu).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(llamadas(f, '/api/clip/generar')).toHaveLength(1));
    expect(cuerpoDe(f, '/api/clip/generar')).toEqual({
      texto: 'un gato en la luna',
      formato: 'horizontal',
      imagenes: [],
      modelo: 'veo-fast',
      segundos: 4,
      audio: true,
      puerta: 'caja',
    });
    expect(Object.keys(cuerpoDe(f, '/api/clip/generar'))).not.toContain('creditos');
  });

  it('inicio.caja.un_modelo_sin_esa_duracion_se_atenua_y_se_vuelve_al_predeterminado', async () => {
    encenderLtx();
    const f = montar({ rutas: { '/api/clip/generar': () => json({ lanzado: true, id: 'clip-ltx', creditos: 10 }) } });
    pintar();
    await userEvent.type(caja(), 'un gato en la luna');
    await userEvent.click(botonModelo());
    const menu = screen.getByRole('dialog', { name: 'Elegir modelo' });
    const ltx = () => within(menu).getByRole('radio', { name: /LTX-2\.5 Fast/ });
    const duracion = (s: string) => within(menu).getByRole('radio', { name: s + ' s' });
    await userEvent.click(ltx());
    expect(botonModelo()).toHaveTextContent('Modelo LTX-2.5 Fast · 8 s');
    // a 4 s LTX no existe: vuelve el predeterminado, se atenúa y el pie dice por qué
    await userEvent.click(duracion('4'));
    expect(within(menu).getByRole('status')).toHaveTextContent('LTX-2.5 Fast empieza en 6 s. Te dejamos Veo 3.1 Lite.');
    expect(botonModelo()).toHaveTextContent('Modelo Veo 3.1 Lite · 4 s');
    expect(ltx()).toHaveAttribute('aria-disabled', 'true');
    expect(ltx()).toHaveTextContent('Desde 6 s');
    expect(ltx()).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(ltx());
    expect(botonModelo()).toHaveTextContent('Modelo Veo 3.1 Lite · 4 s');
    // de vuelta a 8 s se puede elegir, pero no se elige solo
    await userEvent.click(duracion('8'));
    expect(within(menu).queryByRole('status')).toBeNull();
    expect(ltx()).not.toHaveAttribute('aria-disabled');
    expect(ltx()).toHaveAttribute('aria-checked', 'false');
    expect(botonModelo()).toHaveTextContent('Modelo Veo 3.1 Lite · 8 s');
    // con 6 s sí: se elige y es lo que viaja
    await userEvent.click(duracion('6'));
    await userEvent.click(ltx());
    expect(botonModelo()).toHaveTextContent('Modelo LTX-2.5 Fast · 6 s');
    await userEvent.click(within(menu).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(llamadas(f, '/api/clip/generar')).toHaveLength(1));
    expect(cuerpoDe(f, '/api/clip/generar')).toMatchObject({ modelo: 'ltx', segundos: 6 });
  });

  it('inicio.caja.imagen_y_editar_no_tienen_selector_de_duracion', async () => {
    montar();
    pintar();
    await userEvent.click(botonModelo());
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Elegir modelo' })).getByRole('radio', { name: '6 s' }));
    await userEvent.keyboard('{Escape}');
    for (const tarea of ['Crear una imagen', 'Editar una imagen']) {
      await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
      if (tarea.startsWith('Editar')) await elegirOpcion(tarea);
      // el chip no habla de segundos y el menú no trae el selector, ni lo del clip
      expect(botonModelo()).toHaveTextContent('Modelo Grok Imagine');
      expect(botonModelo().textContent).not.toMatch(/\d s/);
      await userEvent.click(botonModelo());
      const menu = screen.getByRole('dialog', { name: 'Elegir modelo' });
      expect(within(menu).queryByRole('radiogroup', { name: 'Duración del clip' })).toBeNull();
      expect(within(menu).queryByRole('radio', { name: /\d s$/ })).toBeNull();
      expect(menu).toHaveTextContent('✦ ' + modelos.imagen.grok + ' por imagen');
      expect(menu).not.toHaveTextContent('por clip');
      await userEvent.keyboard('{Escape}');
    }
    // al volver al video, la duración que se eligió sigue ahí
    await userEvent.click(screen.getByRole('button', { name: 'Video' }));
    expect(botonModelo()).toHaveTextContent('Modelo Veo 3.1 Lite · 6 s');
  });

  it('inicio.caja.el_aviso_de_duracion_no_sobrevive_al_cambio_de_tarea', async () => {
    encenderLtx();
    montar();
    pintar();
    await userEvent.click(botonModelo());
    const menu = screen.getByRole('dialog', { name: 'Elegir modelo' });
    await userEvent.click(within(menu).getByRole('radio', { name: /LTX-2\.5 Fast/ }));
    await userEvent.click(within(menu).getByRole('radio', { name: '4 s' }));
    expect(within(menu).getByRole('status')).toHaveTextContent('LTX-2.5 Fast empieza en 6 s');
    // con el teclado el menú no se cierra solo: se pasa a Imagen sin cerrarlo
    screen.getByRole('button', { name: 'Imagen' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(botonModelo()).toHaveTextContent('Modelo Grok Imagine');
    expect(screen.queryByRole('status', { name: '' })).toBeNull();
    await userEvent.click(botonModelo());
    const imagen = screen.getByRole('dialog', { name: 'Elegir modelo' });
    expect(imagen).not.toHaveTextContent('empieza en');
    expect(within(imagen).queryByRole('status')).toBeNull();
  });

  it('inicio.galeria.lo_recien_pedido_aparece_generando_y_se_relee', async () => {
    let clips: ClipCorto[] = [];
    let suelta: (r: Response) => void = () => undefined;
    const f = montar({
      rutas: {
        '/api/clip': () => json({ clips }),
        '/api/clip/generar': () =>
          new Promise<Response>(res => {
            suelta = res;
          }),
      },
    });
    pintar();
    await screen.findByText('La historia del café');
    await userEvent.type(caja(), 'un gato en la luna');
    await userEvent.click(botonModelo());
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Elegir modelo' })).getByRole('button', { name: 'Crear' }));
    // mientras el servidor contesta, ya hay una tarjeta «Generando…» al principio de la galería
    await waitFor(() => expect(screen.getAllByRole('article')[0]).toHaveTextContent('Generando…'));
    expect(screen.getAllByRole('article')[0]).toHaveTextContent('un gato en la luna');
    clips = [{ ...C1, id: 'clip-nuevo', texto: 'un gato en la luna', estado: 'generando', video: '' }];
    suelta(json({ lanzado: true, id: 'clip-nuevo', creditos: 36 }));
    // contestó: la lista se relee y la tarjeta del servidor reemplaza a la local
    expect(await screen.findByText('generándose…', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByRole('article').filter(a => a.getAttribute('aria-busy') === 'true')).toHaveLength(0);
    expect(llamadas(f, '/api/clip', 'GET').length).toBeGreaterThan(1);
  });

  it('inicio.galeria.usar_como_referencia_lleva_la_imagen_a_la_caja', async () => {
    montar({ imagenes: [img(1)], rutas: { '/api/imagenes/img-1.jpg/archivo': () => new Response('x', { status: 200, headers: { 'Content-Type': 'image/jpeg' } }) } });
    pintar();
    await userEvent.click(await screen.findByRole('button', { name: /Abrir tu imagen/ }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Tu imagen' })).getByRole('button', { name: 'Usar como referencia' }));
    // la caja pasa a «Un video corto» con esa imagen como referencia
    expect(await screen.findByRole('button', { name: 'Quitar «img-1.jpg»' })).toBeInTheDocument();
    expect(botonOpcion()).toHaveTextContent('Un video corto');
  });

  it('inicio.caja.sin_texto_no_navega', async () => {
    montar();
    pintar();
    await userEvent.type(caja(), '   ');
    await userEvent.click(enviar());
    expect(screen.getByRole('alert')).toHaveTextContent('Cuéntanos qué quieres primero');
    expect(caja()).toHaveFocus();
    expect(ir).not.toHaveBeenCalled();
  });

  it('inicio.caja.cada_opcion_cambia_el_ejemplo', async () => {
    montar();
    pintar();
    expect(caja()).toHaveAttribute('placeholder', expect.stringContaining('mi perro corriendo'));
    await elegirOpcion('Crea tu historia');
    expect(caja()).toHaveAttribute(
      'placeholder',
      'Pega tu historia completa — la respetamos como la escribiste. Con el + puedes agregar la foto de tu personaje.',
    );
  });

  it('inicio.caja.imagen_y_video_escriben_en_un_cuadro_con_borde_de_campo_y_fondo_elevada', async () => {
    montar();
    pintar();
    const cuadroDe = () => caja().parentElement!;
    const clases = (el: Element) => el.className.split(/\s+/);
    for (const familia of ['Video', 'Imagen', 'Video']) {
      await userEvent.click(screen.getByRole('button', { name: familia }));
      // un cuadro bien definido (dueño, 14-oct-2026): borde de campo (no el de línea, que no llega a 3:1), fondo de campo y radio 10
      expect(clases(cuadroDe()), familia).toEqual(expect.arrayContaining(['border', 'border-campo', 'bg-elevada', 'rounded-medio', 'p-3']));
      expect(clases(cuadroDe()), familia).not.toContain('border-linea');
      // el aro de foco lo dibuja el cuadro y no el texto (antes la caja de Imagen y Video no tenía aro: `outline-none` a secas)
      expect(clases(cuadroDe()), familia).toEqual(expect.arrayContaining(['has-focus-visible:outline-2', 'has-focus-visible:outline-ambar-claro']));
      expect(clases(caja()), familia).toEqual(expect.arrayContaining(['outline-none', 'border-0', 'bg-transparent', 'p-0', 'text-sm']));
      // el ejemplo con el gris secundario y no con el 50 % del texto
      expect(clases(caja()), familia).toContain('placeholder:text-secundario');
      // un clic en el relleno del cuadro lleva el foco al texto
      act(() => (document.activeElement as HTMLElement).blur());
      expect(fireEvent.mouseDown(cuadroDe())).toBe(false);
      expect(caja(), familia).toHaveFocus();
    }
    // conserva lo que ya tenía: se estira hacia abajo y mide al menos 88 px de alto desde 360 px de ancho; por debajo (320 px)
    // el piso es de 112 px, para que con el relleno del cuadro no se corte la última línea del ejemplo más largo
    expect(clases(caja())).toEqual(expect.arrayContaining(['min-h-28', 'min-[360px]:min-h-22', 'resize-y']));
  });

  it('inicio.caja.el_cuadro_y_el_chip_de_tarea_son_los_mismos_en_las_tres_familias', async () => {
    montar();
    pintar();
    const cuadroVideo = caja().parentElement!;
    const chipVideo = botonOpcion();
    await userEvent.click(screen.getByRole('button', { name: 'Edición' }));
    const cuadroEdicion = screen.getByRole('textbox', { name: 'Cuéntale a la IA qué quieres' }).parentElement!;
    const chipEdicion = botonOpcion();
    // UN solo componente para cada cosa: el mismo cuadro de escritura y el mismo chip con su lista, no copias que se desfasen
    expect(cuadroEdicion.className).toBe(cuadroVideo.className);
    expect(chipEdicion.className).toBe(chipVideo.className);
    expect([...chipEdicion.attributes].map(a => a.name).sort()).toEqual([...chipVideo.attributes].map(a => a.name).sort());
    await userEvent.click(chipEdicion);
    const listaEdicion = screen.getByRole('listbox', { name: 'Opciones' }).className;
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Video' }));
    await userEvent.click(botonOpcion());
    expect(screen.getByRole('listbox', { name: 'Opciones' }).className).toBe(listaEdicion);
  });

  it('inicio.caja.cambiar_de_familia_o_elegir_desde_fuera_cierra_la_lista_de_opciones_abierta', async () => {
    montar({ proyectos: [], imagenes: [], ediciones: [], clips: [] });
    pintar();
    // el clic del riel sin «mousedown» (con teclado o con un lector de pantalla): la lista no se queda abierta sobre otra familia
    await userEvent.click(botonOpcion());
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(botonOpcion()).toHaveAttribute('aria-expanded', 'false');
    expect(botonOpcion()).toHaveTextContent('Crear una imagen');
    // y el mando de la caja (la tarjeta «Crear un video» de quien empieza) también la cierra al elegir
    await userEvent.click(botonOpcion());
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Crear un video' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(botonOpcion()).toHaveTextContent('Creador de cuentos');
    expect(caja()).toHaveFocus();
  });

  it('inicio.caja.desplegable_con_teclado', async () => {
    montar();
    pintar();
    botonOpcion().focus();
    await userEvent.keyboard('{ArrowDown}');
    const lista = screen.getByRole('listbox', { name: 'Opciones' });
    expect(botonOpcion()).toHaveAttribute('aria-expanded', 'true');
    expect(within(lista).getByRole('option', { name: /Un video corto/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(botonOpcion()).toHaveTextContent('Creador de cuentos');
    expect(botonOpcion()).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(botonOpcion()).toHaveTextContent('Creador de cuentos');
    // y un clic fuera lo cierra
    await userEvent.click(botonOpcion());
    await userEvent.click(caja());
    expect(screen.queryByRole('listbox')).toBeNull();
    // Tab con la lista abierta la cierra y el foco sigue desde el chip (a «Crear», que viene después; «Creador de cuentos» no
    // trae chip de modelo): no cae en <body>
    await userEvent.click(botonOpcion());
    await userEvent.keyboard('{Tab}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.body).not.toHaveFocus();
    expect(enviar()).toHaveFocus();
    // Shift+Tab, hacia atrás: al «+» (aquí, el de la foto del personaje)
    await userEvent.click(botonOpcion());
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole('button', { name: 'Agregar la foto de tu personaje' })).toHaveFocus();
  });

  it('inicio.caja.cambiar_de_familia_elige_la_primera', async () => {
    montar();
    pintar();
    await elegirOpcion('Crea tu historia');
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    expect(screen.getByRole('button', { name: 'Imagen' })).toHaveAttribute('aria-pressed', 'true');
    expect(botonOpcion()).toHaveTextContent('Crear una imagen');
    // E1: son tres familias. Edición no tiene opciones que elegir, y Video e Imagen siguen volviendo a la primera
    await userEvent.click(screen.getByRole('button', { name: 'Edición' }));
    expect(screen.getByRole('button', { name: 'Edición' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Imagen' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Video' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Video' }));
    expect(screen.getByRole('button', { name: 'Video' })).toHaveAttribute('aria-pressed', 'true');
    expect(botonOpcion()).toHaveTextContent('Un video corto');
    await elegirOpcion('Crea tu historia');
    await userEvent.click(screen.getByRole('button', { name: 'Edición' }));
    await userEvent.click(screen.getByRole('button', { name: 'Video' }));
    expect(botonOpcion()).toHaveTextContent('Un video corto');
  });
});

// Cuentos e historias llevan «+» para la foto del personaje (dueño, 14-oct-2026). La foto se deja en el navegador y
// «Crear» navega con `refs=<token>`; Crear la recoge (crear/Crear.test.tsx).
describe('la caja · la foto del personaje en cuentos e historias', () => {
  const TOKEN = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  const diferido = <T,>() => {
    let resolver!: (v: T) => void;
    const promesa = new Promise<T>(r => (resolver = r));
    return { promesa, resolver };
  };
  const listaDelPersonaje = () => screen.getByRole('list', { name: 'Foto de tu personaje' });
  const sinListaDelPersonaje = () => expect(screen.queryByRole('list', { name: 'Foto de tu personaje' })).toBeNull();
  // lo que NO es del personaje: Edición, donde el «+» es del video
  const botonesDeImagenes = () => screen.queryAllByRole('button', { name: /^Agregar (imágenes|una imagen|la imagen|la foto)/ });

  it('inicio.caja.cuentos_e_historia_tienen_el_mas_con_textos_de_la_foto_del_personaje', async () => {
    montar();
    const { container } = pintar();
    // las que ya lo tenían dicen lo de siempre, carácter por carácter
    const clipMas = screen.getByRole('button', { name: 'Agregar imágenes de referencia' });
    expect(clipMas).toHaveAttribute('title', 'Agregar imágenes, arrástralas a la caja o pégalas con Ctrl+V');
    expect(entradaDeFotos(container)).toHaveAttribute('multiple');
    // cuentos
    await elegirOpcion('Creador de cuentos');
    const mas = screen.getByRole('button', { name: 'Agregar la foto de tu personaje' });
    expect(mas).toHaveAttribute('title', 'Agrega la foto de tu personaje, arrástrala a la caja o pégala con Ctrl+V');
    expect(botonesDeImagenes()).toHaveLength(1);
    expect(entradaDeFotos(container)).not.toHaveAttribute('multiple'); // UNA foto: el motor solo usa la primera
    expect(caja()).toHaveAttribute('placeholder', expect.stringContaining('Con el + puedes agregar la foto de tu personaje.'));
    await userEvent.click(botonOpcion());
    expect(screen.getByRole('option', { name: /Creador de cuentos/ })).toHaveTextContent('Con el + puedes agregar la foto de tu personaje.');
    expect(screen.getByRole('option', { name: /Crea tu historia/ })).toHaveTextContent('Con el + puedes agregar la foto de tu personaje.');
    // las demás opciones NO lo dicen
    expect(screen.getByRole('option', { name: /Un video corto/ })).not.toHaveTextContent('foto de tu personaje');
    await userEvent.keyboard('{Escape}');
    // historia
    await elegirOpcion('Crea tu historia');
    expect(screen.getByRole('button', { name: 'Agregar la foto de tu personaje' })).toBeInTheDocument();
    expect(caja()).toHaveAttribute('placeholder', expect.stringContaining('Con el + puedes agregar la foto de tu personaje.'));
    // y las de imagen conservan sus textos
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    expect(screen.getByRole('button', { name: 'Agregar una imagen para editarla' })).toHaveAttribute(
      'title',
      'Agregar imágenes, arrástralas a la caja o pégalas con Ctrl+V',
    );
    await elegirOpcion('Editar una imagen');
    expect(screen.getByRole('button', { name: 'Agregar la imagen que quieres editar' })).toBeInTheDocument();
    expect(caja()).not.toHaveAttribute('placeholder', expect.stringContaining('personaje'));
    // Edición no usa imágenes: ahí el «+» es del video
    await userEvent.click(screen.getByRole('button', { name: 'Edición' }));
    expect(botonesDeImagenes()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Agregar el video que quieres editar' })).toBeInTheDocument();
  });

  it('inicio.caja.la_foto_del_personaje_se_agrega_se_reemplaza_se_quita_y_viaja_con_la_opcion', async () => {
    montar();
    const { container } = pintar();
    await elegirOpcion('Creador de cuentos');
    sinListaDelPersonaje();
    await userEvent.upload(entradaDeFotos(container), foto('perro.png'));
    expect(within(listaDelPersonaje()).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByRole('list', { name: 'Imágenes de referencia' })).toBeNull();
    // una segunda REEMPLAZA a la primera (tope 1), sin decir «Como mucho»
    await userEvent.upload(entradaDeFotos(container), foto('gato.jpg', 'image/jpeg'));
    expect(within(listaDelPersonaje()).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Quitar «gato.jpg»' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar «perro.png»' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // cambiar de opción la conserva (en historia, y en el clip como una de sus referencias) y al volver sigue ahí
    await elegirOpcion('Crea tu historia');
    expect(screen.getByRole('button', { name: 'Quitar «gato.jpg»' })).toBeInTheDocument();
    await elegirOpcion('Un video corto');
    expect(within(screen.getByRole('list', { name: 'Imágenes de referencia' })).getAllByRole('listitem')).toHaveLength(1);
    await elegirOpcion('Creador de cuentos');
    expect(screen.getByRole('button', { name: 'Quitar «gato.jpg»' })).toBeInTheDocument();
    // quitarla la saca
    await userEvent.click(screen.getByRole('button', { name: 'Quitar «gato.jpg»' }));
    sinListaDelPersonaje();
  });

  it('inicio.caja.una_foto_que_no_sirve_se_rechaza_con_la_regla_del_editor_y_lo_dice_en_el_cuadro', async () => {
    const avisos = ponerAvisos();
    montar();
    const { container } = pintar();
    await elegirOpcion('Crea tu historia');
    const dicho = () => avisos.mostrar.mock.calls.at(-1);
    // HEIC, GIF y AVIF los lee el clip pero NO el editor: aquí rige la lista más conservadora (JPG, PNG o WebP)
    for (const [nombre, tipo] of [
      ['selfie.heic', 'image/heic'],
      ['animada.gif', 'image/gif'],
      ['foto.avif', 'image/avif'],
      ['nota.txt', 'image/png'],
    ] as const) {
      await userEvent.upload(entradaDeFotos(container), foto(nombre, tipo));
      expect(dicho()![0]).toBe(`«${nombre}» no se puede usar. Sirven: .jpg, .jpeg, .png, .webp.`);
      expect(dicho()![1]).toEqual({ tipo: 'mal', clave: 'caja' });
      sinListaDelPersonaje();
    }
    // el peso: más de 15 MB
    const grande = foto('enorme.png');
    Object.defineProperty(grande, 'size', { value: 15 * 1024 * 1024 + 1 });
    await userEvent.upload(entradaDeFotos(container), grande);
    expect(dicho()![0]).toBe('«enorme.png» pesa demasiado (máximo 15 MB).');
    sinListaDelPersonaje();
    // y una buena después entra y se lleva el aviso
    await userEvent.upload(entradaDeFotos(container), foto('buena.webp', 'image/webp'));
    expect(screen.getByRole('button', { name: 'Quitar «buena.webp»' })).toBeInTheDocument();
    expect(avisos.quitar).toHaveBeenCalledWith('caja');
    // nada de eso junto a la caja
    expect(screen.queryByRole('alert')).toBeNull();
    // arrastrada o pegada, la misma regla
    avisos.mostrar.mockClear();
    fireEvent.drop(caja().closest('section')!, { dataTransfer: { files: [foto('arrastrada.gif', 'image/gif')], types: ['Files'] } });
    expect(dicho()![0]).toContain('«arrastrada.gif» no se puede usar');
    fireEvent.paste(caja(), { clipboardData: { files: [foto('pegada.heic', 'image/heic')], items: [], getData: () => '' } });
    expect(dicho()![0]).toContain('«pegada.heic» no se puede usar');
    expect(screen.getByRole('button', { name: 'Quitar «buena.webp»' })).toBeInTheDocument(); // la buena sigue
  });

  it('inicio.caja.la_foto_del_personaje_se_arrastra_y_se_pega', async () => {
    montar();
    pintar();
    await elegirOpcion('Creador de cuentos');
    const seccion = caja().closest('section')!;
    // un archivo que se arrastra pinta el borde de «suelta aquí» y, al soltarlo, queda de foto
    expect(fireEvent.dragOver(seccion, { dataTransfer: { files: [], types: ['Files'] } })).toBe(false);
    expect(seccion).toHaveClass('border-dashed');
    fireEvent.drop(seccion, { dataTransfer: { files: [foto('arrastrada.png')], types: ['Files'] } });
    expect(await screen.findByRole('button', { name: 'Quitar «arrastrada.png»' })).toBeInTheDocument();
    expect(within(listaDelPersonaje()).getAllByRole('listitem')).toHaveLength(1);
    // un texto que se mueve dentro de la caja no se corta
    expect(fireEvent.dragOver(seccion, { dataTransfer: { files: [], types: ['text/plain'] } })).toBe(true);
    // pegar con Ctrl+V la reemplaza (en historia)
    await elegirOpcion('Crea tu historia');
    expect(fireEvent.paste(caja(), { clipboardData: { files: [foto('image.png')], items: [], getData: () => '' } })).toBe(false);
    expect(await screen.findByRole('button', { name: 'Quitar «imagen-pegada.png»' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar «arrastrada.png»' })).toBeNull();
    // un texto pegado sigue siendo texto
    expect(fireEvent.paste(caja(), { clipboardData: { files: [], items: [], getData: () => 'mi historia' } })).toBe(true);
  });

  it('inicio.caja.crear_con_foto_la_deja_en_el_navegador_y_navega_con_refs_sin_cobrar_ni_vaciar', async () => {
    const f = montar();
    const { container } = pintar();
    // el clip trae dos fotos; en historia solo cabe la primera, y SOLO esa viaja
    await userEvent.upload(entradaDeFotos(container), [foto('uno.png'), foto('dos.png')]);
    await elegirOpcion('Crea tu historia');
    await userEvent.type(caja(), '  Mi historia  ');
    vi.mocked(guardarArchivos).mockResolvedValueOnce(TOKEN);
    await userEvent.click(enviar());
    await waitFor(() => expect(ir).toHaveBeenCalledTimes(1));
    expect(ir).toHaveBeenCalledWith('/estudio/crear/?brief=Mi+historia&modo=idea&refs=' + TOKEN);
    expect(guardarArchivos).toHaveBeenCalledTimes(1);
    expect(vi.mocked(guardarArchivos).mock.calls[0]![0].map(a => a.name)).toEqual(['uno.png']);
    // navegar no cobra ni pide nada, y no se vacía ni el texto ni la foto (si regresa con «atrás», ahí siguen)
    expect(f.mock.calls.filter(c => (c[1]?.method ?? 'GET') !== 'GET')).toEqual([]);
    expect(caja()).toHaveValue('  Mi historia  ');
    expect(screen.getByRole('button', { name: 'Quitar «uno.png»' })).toBeInTheDocument();
    // lo mismo en cuentos, con su modo
    act(() => {
      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    });
    await elegirOpcion('Creador de cuentos');
    vi.mocked(guardarArchivos).mockResolvedValueOnce(TOKEN);
    await userEvent.click(enviar());
    await waitFor(() => expect(ir).toHaveBeenCalledTimes(2));
    expect(ir).toHaveBeenLastCalledWith('/estudio/crear/?brief=Mi+historia&modo=investigacion&refs=' + TOKEN);
  });

  it('inicio.caja.crear_con_foto_con_doble_clic_guarda_una_sola_vez_y_navega_una_sola_vez', async () => {
    montar();
    const { container } = pintar();
    await elegirOpcion('Crea tu historia');
    await userEvent.type(caja(), 'Mi historia');
    await userEvent.upload(entradaDeFotos(container), foto('gato.png'));
    const guardando = diferido<string | null>();
    vi.mocked(guardarArchivos).mockReturnValueOnce(guardando.promesa);
    await userEvent.dblClick(enviar());
    // el candado se puso ANTES de esperar: sigue guardando, el botón trabaja y nadie navegó
    expect(guardarArchivos).toHaveBeenCalledTimes(1);
    expect(ir).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Generando…' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Generando…' }));
    await act(async () => guardando.resolver(TOKEN));
    await waitFor(() => expect(ir).toHaveBeenCalledTimes(1));
    expect(guardarArchivos).toHaveBeenCalledTimes(1);
    expect(ir).toHaveBeenCalledWith('/estudio/crear/?brief=Mi+historia&modo=idea&refs=' + TOKEN);
  });

  it('inicio.caja.sin_foto_la_direccion_es_la_de_siempre_y_no_se_toca_el_navegador', async () => {
    montar();
    pintar();
    await userEvent.type(caja(), 'un gato en la luna');
    for (const [rotulo, url] of [
      ['Creador de cuentos', '/crear.html?brief=un+gato+en+la+luna&modo=investigacion'],
      ['Crea tu historia', '/crear.html?brief=un+gato+en+la+luna&modo=idea'],
    ] as const) {
      await elegirOpcion(rotulo);
      await userEvent.click(enviar());
      expect(ir).toHaveBeenLastCalledWith(url); // byte a byte la de hoy: ni `refs` ni nada
      act(() => {
        window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
      });
    }
    expect(guardarArchivos).not.toHaveBeenCalled();
    // la dirección: `refs` solo si hay token
    const cuento = OPCIONES.videos.find(o => o.id === 'investigacion')!;
    const clipOpc = OPCIONES.videos.find(o => o.id === 'clip')!;
    expect(destinoDe(cuento, 'tema')).toBe('/crear.html?brief=tema&modo=investigacion');
    expect(destinoDe(cuento, 'tema', undefined, '')).toBe('/crear.html?brief=tema&modo=investigacion');
    expect(destinoDe(cuento, 'tema', undefined, TOKEN)).toBe('/estudio/crear/?brief=tema&modo=investigacion&refs=' + TOKEN);
    expect(destinoDe(cuento, 'tema', undefined, 'perdida')).toBe('/estudio/crear/?brief=tema&modo=investigacion&refs=perdida');
    expect(destinoDe(clipOpc, 'hola', 'kling')).toBe('/clip.html?brief=hola&modelo=kling');
  });

  it('inicio.caja.si_el_navegador_no_deja_guardar_la_foto_se_navega_igual_con_refs_perdida', async () => {
    const f = montar();
    const { container } = pintar();
    await elegirOpcion('Creador de cuentos');
    await userEvent.type(caja(), 'Roma');
    await userEvent.upload(entradaDeFotos(container), foto('gato.png'));
    // sin IndexedDB, ventana privada, cuota…: guardarArchivos contesta null
    vi.mocked(guardarArchivos).mockResolvedValueOnce(null);
    await userEvent.click(enviar());
    await waitFor(() => expect(ir).toHaveBeenCalledTimes(1));
    expect(ir).toHaveBeenCalledWith('/estudio/crear/?brief=Roma&modo=investigacion&refs=perdida');
    // y si alguna vez lanzara, lo mismo: la persona nunca se queda sin camino ni con el botón trabajando para siempre
    act(() => {
      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    });
    vi.mocked(guardarArchivos).mockRejectedValueOnce(new Error('boom'));
    await userEvent.click(enviar());
    await waitFor(() => expect(ir).toHaveBeenCalledTimes(2));
    expect(ir).toHaveBeenLastCalledWith('/estudio/crear/?brief=Roma&modo=investigacion&refs=perdida');
    expect(f.mock.calls.filter(c => (c[1]?.method ?? 'GET') !== 'GET')).toEqual([]);
  });

  it('inicio.caja.con_foto_va_directo_a_la_pantalla_nueva_de_crear_sin_pasar_por_crear_html', async () => {
    // `/crear.html` solo redirige si su etapa lo dice (en `nueva` sirve la pantalla vieja, que ignora `refs`): con foto
    // la dirección no depende del interruptor. Sin foto es la de siempre, por /crear.html.
    const cuento = OPCIONES.videos.find(o => o.id === 'investigacion')!;
    const historia = OPCIONES.videos.find(o => o.id === 'historia')!;
    expect(destinoDe(cuento, 'tema', undefined, TOKEN)).toMatch(/^\/estudio\/crear\/\?brief=tema&modo=investigacion&refs=/);
    expect(destinoDe(historia, 'tema', undefined, 'perdida')).toBe('/estudio/crear/?brief=tema&modo=idea&refs=perdida');
    expect(destinoDe(historia, 'tema')).toBe('/crear.html?brief=tema&modo=idea');
    // y es la que usa «Crear» de verdad
    montar();
    const { container } = pintar();
    await elegirOpcion('Crea tu historia');
    await userEvent.type(caja(), 'Mi historia');
    await userEvent.upload(entradaDeFotos(container), foto('gato.png'));
    vi.mocked(guardarArchivos).mockResolvedValueOnce(TOKEN);
    await userEvent.click(enviar());
    await waitFor(() => expect(ir).toHaveBeenCalledTimes(1));
    expect(vi.mocked(ir).mock.calls[0]![0]).not.toContain('/crear.html');
    expect(vi.mocked(ir).mock.calls[0]![0]).toMatch(/^\/estudio\/crear\/\?/);
  });

  it('inicio.caja.una_foto_heredada_del_clip_pasa_por_la_regla_de_editar_antes_de_dejarla_y_navegar', async () => {
    const avisos = ponerAvisos();
    montar();
    const { container } = pintar();
    // el clip acepta HEIC (hasta 20 MB); el motor de cuentos no: la regla es la de «editar»
    await userEvent.upload(entradaDeFotos(container), foto('iphone.heic', 'image/heic'));
    await elegirOpcion('Creador de cuentos');
    await userEvent.type(caja(), 'Roma');
    await userEvent.click(enviar());
    expect(avisos.mostrar.mock.calls.at(-1)![0]).toBe('«iphone.heic» no se puede usar. Sirven: .jpg, .jpeg, .png, .webp.');
    expect(avisos.mostrar.mock.calls.at(-1)![1]).toEqual({ tipo: 'mal', clave: 'caja' });
    // ni se dejó en el navegador ni se navegó, y la caja sigue lista (la foto se quita o se reemplaza)
    expect(guardarArchivos).not.toHaveBeenCalled();
    expect(ir).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Generando…' })).toBeNull();
    // reemplazarla por una buena abre el camino
    await userEvent.upload(entradaDeFotos(container), foto('buena.png'));
    vi.mocked(guardarArchivos).mockResolvedValueOnce(TOKEN);
    await userEvent.click(enviar());
    await waitFor(() => expect(ir).toHaveBeenCalledTimes(1));
    expect(vi.mocked(guardarArchivos).mock.calls[0]![0].map(a => a.name)).toEqual(['buena.png']);
  });

  it('inicio.caja.reemplazar_la_foto_del_personaje_no_borra_las_del_clip', async () => {
    montar();
    const { container } = pintar();
    await userEvent.upload(entradaDeFotos(container), [foto('a.png'), foto('b.png'), foto('c.png')]);
    await elegirOpcion('Creador de cuentos');
    expect(screen.getByRole('button', { name: 'Quitar «a.png»' })).toBeInTheDocument(); // la primera es la del personaje
    await userEvent.upload(entradaDeFotos(container), foto('nueva.png'));
    expect(screen.getByRole('button', { name: 'Quitar «nueva.png»' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar «a.png»' })).toBeNull();
    // al volver al clip siguen sus otras dos
    await elegirOpcion('Un video corto');
    const lista = within(screen.getByRole('list', { name: 'Imágenes de referencia' }));
    expect(lista.getAllByRole('listitem')).toHaveLength(3);
    for (const n of ['nueva.png', 'b.png', 'c.png']) expect(lista.getByRole('button', { name: `Quitar «${n}»` })).toBeInTheDocument();
  });

  it('inicio.caja.una_foto_sin_tipo_se_completa_al_aceptarla_para_que_crear_no_la_descarte', async () => {
    montar();
    const { container } = pintar();
    await elegirOpcion('Crea tu historia');
    await userEvent.type(caja(), 'Mi historia');
    // WebP sin registrar en el sistema, o un archivo que viene de Drive: `type` vacío. La caja acepta por extensión, pero
    // Crear filtra por `type.startsWith('image/')`: sin completarlo allí diría «no alcanzó a llegar» con la foto guardada.
    const sinTipo = new File(['x'], 'retrato.webp', { type: '' });
    fireEvent.change(entradaDeFotos(container), { target: { files: [sinTipo] } });
    expect(await screen.findByRole('button', { name: 'Quitar «retrato.webp»' })).toBeInTheDocument();
    vi.mocked(guardarArchivos).mockResolvedValueOnce(TOKEN);
    await userEvent.click(enviar());
    await waitFor(() => expect(guardarArchivos).toHaveBeenCalledTimes(1));
    const guardada = vi.mocked(guardarArchivos).mock.calls[0]![0][0]!;
    expect(guardada.name).toBe('retrato.webp');
    expect(guardada.type).toBe('image/webp');
    expect(guardada.type.startsWith('image/')).toBe(true); // lo que pide Crear (sumarArchivos / Formulario)
    // y una que ya trae tipo viaja tal cual
    const conTipo = foto('perro.png');
    act(() => {
      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    });
    fireEvent.change(entradaDeFotos(container), { target: { files: [conTipo] } });
    vi.mocked(guardarArchivos).mockResolvedValueOnce(TOKEN);
    await userEvent.click(enviar());
    await waitFor(() => expect(guardarArchivos).toHaveBeenCalledTimes(2));
    expect(vi.mocked(guardarArchivos).mock.calls[1]![0][0]).toBe(conTipo);
  });
});

describe('la hoja «Elegir de Mis creaciones»', () => {
  const imagenesDe = (n: number) => Array.from({ length: n }, (_, i) => img(i + 1));
  const archivosDeImagenes = (n: number): Record<string, Ruta> =>
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => [
        `/api/imagenes/img-${i + 1}.jpg/archivo`,
        () => new Response('x', { status: 200, headers: { 'Content-Type': 'image/jpeg' } }),
      ]),
    );
  // el «+» solo ofrece Mis creaciones cuando la lista ya llegó
  const esperarLista = () => screen.findAllByRole('button', { name: /Abrir tu imagen/ });
  const botonMas = (nombre = 'Agregar imágenes de referencia') => screen.getByRole('button', { name: nombre });
  async function abrirLaHoja(nombreMas?: string) {
    await userEvent.click(botonMas(nombreMas));
    await userEvent.click(screen.getByRole('menuitem', { name: /Elegir de Mis creaciones/ }));
    return screen.findByRole('dialog', { name: 'Agregar imágenes' });
  }
  const tiles = (hoja: HTMLElement) => within(hoja).getAllByRole('button', { name: /^Tu imagen del/ });

  it('inicio.biblioteca.el_mas_ofrece_subir_o_elegir_de_mis_creaciones', async () => {
    montar({ imagenes: imagenesDe(4), rutas: archivosDeImagenes(4) });
    const { container } = pintar();
    await esperarLista();
    const clic = vi.spyOn(entradaDeFotos(container), 'click');
    expect(botonMas()).toHaveAttribute('aria-haspopup', 'menu');
    expect(botonMas()).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(botonMas());
    const menu = screen.getByRole('menu', { name: 'Agregar imágenes' });
    expect(botonMas()).toHaveAttribute('aria-expanded', 'true');
    // cada opción dice qué sirve / cuántas hay; el foco cae en la primera
    const subir = within(menu).getByRole('menuitem', { name: /Subir de tu computadora/ });
    expect(subir).toHaveTextContent('JPG, PNG, WebP, GIF, AVIF o HEIC · hasta 20 MB');
    expect(within(menu).getByRole('menuitem', { name: /Elegir de Mis creaciones/ })).toHaveTextContent('4 imágenes tuyas');
    expect(menu).toHaveTextContent('pegarlas con Ctrl+V');
    expect(subir).toHaveFocus();
    expect(clic).not.toHaveBeenCalled();
    await userEvent.click(subir);
    expect(clic).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('inicio.biblioteca.sin_imagenes_el_mas_abre_el_selector_de_siempre', async () => {
    montar({ imagenes: [] });
    const { container } = pintar();
    const clic = vi.spyOn(entradaDeFotos(container), 'click');
    await userEvent.click(botonMas());
    expect(clic).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(botonMas()).not.toHaveAttribute('aria-haspopup');
  });

  it('inicio.biblioteca.elegir_trae_las_imagenes_a_la_caja_en_el_orden_marcado', async () => {
    const f = montar({ imagenes: imagenesDe(4), rutas: archivosDeImagenes(4) });
    pintar();
    await esperarLista();
    const hoja = await abrirLaHoja();
    // más ancha que un diálogo común, con sus dos pestañas y lo más nuevo primero
    expect(hoja.className).toContain('760px');
    expect(within(hoja).getByRole('tab', { name: 'Mis creaciones' })).toHaveAttribute('aria-selected', 'true');
    expect(within(hoja).getByRole('tab', { name: 'Mi computadora' })).toBeInTheDocument();
    expect(within(hoja).getByRole('status')).toHaveTextContent('0 de 3 seleccionadas');
    const antes = tiles(hoja);
    expect(antes).toHaveLength(4);
    expect(within(hoja).getByRole('button', { name: 'Agregar' })).toBeDisabled();
    // se eligen la 1.ª (img-4, la más nueva) y la 3.ª (img-2): llevan su número, en el orden en que se marcaron
    await userEvent.click(antes[2]!);
    await userEvent.click(antes[0]!);
    expect(within(tiles(hoja)[2]!).getByText('1')).toBeInTheDocument();
    expect(within(tiles(hoja)[0]!).getByText('2')).toBeInTheDocument();
    expect(tiles(hoja)[0]).toHaveAttribute('aria-pressed', 'true');
    expect(within(hoja).getByRole('status')).toHaveTextContent('2 de 3 seleccionadas');
    // elegir de nuevo la quita
    await userEvent.click(tiles(hoja)[1]!);
    await userEvent.click(tiles(hoja)[1]!);
    expect(tiles(hoja)[1]).toHaveAttribute('aria-pressed', 'false');
    // se agregan (con su nombre de archivo) y la hoja se cierra
    await userEvent.click(within(hoja).getByRole('button', { name: 'Agregar 2' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agregar imágenes' })).toBeNull());
    const lista = screen.getByRole('list', { name: 'Imágenes de referencia' });
    expect(within(lista).getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual([
      'Quitar «img-2.jpg»',
      'Quitar «img-4.jpg»',
    ]);
    // cada una se trajo una sola vez, y la que no se eligió (img-3) ni se tocó
    expect(f.mock.calls.filter(c => c[0] === '/api/imagenes/img-2.jpg/archivo')).toHaveLength(1);
    expect(f.mock.calls.filter(c => c[0] === '/api/imagenes/img-4.jpg/archivo')).toHaveLength(1);
    expect(f.mock.calls.filter(c => c[0] === '/api/imagenes/img-3.jpg/archivo')).toHaveLength(0);
  });

  it('inicio.biblioteca.el_tope_sale_de_lo_que_le_cabe_a_la_caja', async () => {
    montar({ imagenes: imagenesDe(4), rutas: archivosDeImagenes(4) });
    const { container } = pintar();
    await esperarLista();
    // con 2 fotos ya puestas solo cabe 1 más: las demás se apagan y no se pueden sumar
    await userEvent.upload(entradaDeFotos(container), [foto('a.png'), foto('b.png')]);
    const hoja = await abrirLaHoja();
    expect(within(hoja).getByRole('status')).toHaveTextContent('0 de 1 seleccionadas');
    await userEvent.click(tiles(hoja)[0]!);
    await userEvent.click(tiles(hoja)[1]!);
    expect(tiles(hoja)[0]).toHaveAttribute('aria-pressed', 'true');
    expect(tiles(hoja)[1]).toHaveAttribute('aria-pressed', 'false');
    expect(tiles(hoja)[1]).toHaveAttribute('aria-disabled', 'true');
    expect(within(hoja).getByRole('status')).toHaveTextContent('1 de 1 seleccionadas');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Agregar 1' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agregar imágenes' })).toBeNull());
    expect(within(screen.getByRole('list', { name: 'Imágenes de referencia' })).getAllByRole('listitem')).toHaveLength(3);
    // con las 3 puestas ya no cabe ninguna, y la hoja lo dice
    const llena = await abrirLaHoja();
    expect(within(llena).getByRole('status')).toHaveTextContent('Ya tienes todas las que caben');
    expect(tiles(llena)[0]).toHaveAttribute('aria-disabled', 'true');
    expect(within(llena).getByRole('button', { name: 'Agregar' })).toBeDisabled();
  });

  it('inicio.biblioteca.en_crear_una_imagen_elige_una_y_la_caja_pasa_a_editar', async () => {
    montar({ imagenes: imagenesDe(4), rutas: archivosDeImagenes(4) });
    pintar();
    await esperarLista();
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    expect(botonOpcion()).toHaveTextContent('Crear una imagen');
    const hoja = await abrirLaHoja('Agregar una imagen para editarla');
    // editar admite una sola: elegir otra reemplaza a la anterior
    expect(within(hoja).getByRole('status')).toHaveTextContent('0 de 1 seleccionadas');
    await userEvent.click(tiles(hoja)[0]!);
    await userEvent.click(tiles(hoja)[1]!);
    expect(tiles(hoja)[0]).toHaveAttribute('aria-pressed', 'false');
    expect(tiles(hoja)[1]).toHaveAttribute('aria-pressed', 'true');
    // sus archivos son los del editor, no los del clip
    await userEvent.click(within(hoja).getByRole('tab', { name: 'Mi computadora' }));
    expect(within(hoja).getByText('JPG, PNG o WebP · hasta 15 MB.')).toBeInTheDocument();
    await userEvent.click(within(hoja).getByRole('tab', { name: 'Mis creaciones' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Agregar 1' }));
    expect(await screen.findByRole('button', { name: 'Quitar «img-3.jpg»' })).toBeInTheDocument();
    expect(botonOpcion()).toHaveTextContent('Editar una imagen');
    expect(screen.getByRole('status')).toHaveTextContent('pasamos a «Editar una imagen»');
  });

  it('inicio.biblioteca.en_cuentos_e_historia_el_mas_habla_de_la_foto_del_personaje_y_elige_una', async () => {
    montar({ imagenes: imagenesDe(4), rutas: archivosDeImagenes(4) });
    pintar();
    await esperarLista();
    await elegirOpcion('Crea tu historia');
    const mas = botonMas('Agregar la foto de tu personaje');
    expect(mas).toHaveAttribute('aria-haspopup', 'menu');
    await userEvent.click(mas);
    const menu = screen.getByRole('menu', { name: 'Agregar la foto de tu personaje' });
    // lo que sirve es lo del editor (la regla más conservadora), y el recordatorio habla de UNA foto
    expect(within(menu).getByRole('menuitem', { name: /Subir de tu computadora/ })).toHaveTextContent('JPG, PNG o WebP · hasta 15 MB');
    expect(within(menu).getByRole('menuitem', { name: /Elegir de Mis creaciones/ })).toHaveTextContent('4 imágenes tuyas');
    expect(menu).toHaveTextContent('También puedes arrastrarla a la caja o pegarla con Ctrl+V.');
    expect(menu).not.toHaveTextContent('arrastrarlas');
    // la hoja admite UNA: elegir otra reemplaza a la anterior
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Elegir de Mis creaciones/ }));
    const hoja = await screen.findByRole('dialog', { name: 'Agregar imágenes' });
    expect(within(hoja).getByRole('status')).toHaveTextContent('0 de 1 seleccionadas');
    await userEvent.click(tiles(hoja)[0]!);
    await userEvent.click(tiles(hoja)[1]!);
    expect(tiles(hoja)[0]).toHaveAttribute('aria-pressed', 'false');
    expect(tiles(hoja)[1]).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Agregar 1' }));
    expect(await screen.findByRole('button', { name: 'Quitar «img-3.jpg»' })).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Foto de tu personaje' })).getAllByRole('listitem')).toHaveLength(1);
    // sigue siendo «Crea tu historia»: no pasó a nada (eso es de «Crear una imagen»)
    expect(botonOpcion()).toHaveTextContent('Crea tu historia');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('inicio.biblioteca.si_una_no_se_puede_traer_la_hoja_se_queda_y_lo_dice', async () => {
    const avisos = ponerAvisos();
    montar({ imagenes: imagenesDe(4), rutas: { ...archivosDeImagenes(4), '/api/imagenes/img-4.jpg/archivo': () => new Response('no', { status: 404 }) } });
    pintar();
    await esperarLista();
    const hoja = await abrirLaHoja();
    await userEvent.click(tiles(hoja)[0]!); // img-4, la que no llega
    await userEvent.click(tiles(hoja)[1]!);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Agregar 2' }));
    // el error se dice DENTRO de la hoja (el cuadro de abajo a la derecha queda tapado por el diálogo: aria-hidden, y en un
    // celular cubre los botones) y la hoja sigue abierta, con lo elegido y sin nada agregado a la caja
    expect(await within(hoja).findByRole('alert')).toHaveTextContent('No pudimos traer esa imagen — inténtalo de nuevo.');
    expect(avisos.mostrar).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Agregar imágenes' })).toBeInTheDocument();
    expect(tiles(hoja)[0]).toHaveAttribute('aria-pressed', 'true');
    expect(within(hoja).getByRole('button', { name: 'Agregar 2' })).toBeEnabled();
    expect(screen.queryByRole('list', { name: 'Imágenes de referencia' })).toBeNull();
    // cambiar lo elegido quita el error
    await userEvent.click(tiles(hoja)[0]!);
    expect(within(hoja).queryByRole('alert')).toBeNull();
  });

  it('inicio.biblioteca.los_bytes_se_piden_a_nuestro_endpoint_y_no_a_la_url_del_cdn', async () => {
    // en la nube la `url` de cada imagen redirige a un CDN que no manda cabeceras CORS: un fetch ahí falla, aunque la
    // miniatura (un <img>) cargue. El servidor de prueba rechaza cualquier ruta que no espera, así que pedir esa URL rompería
    const delCdn = (i: number): Imagen => ({ ...img(i), url: `https://cdn.test/imagenes/img-${i}.jpg` });
    const f = montar({ imagenes: [delCdn(1), delCdn(2)], rutas: archivosDeImagenes(2) });
    pintar();
    await esperarLista();
    const hoja = await abrirLaHoja();
    await userEvent.click(tiles(hoja)[0]!);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Agregar 1' }));
    expect(await screen.findByRole('button', { name: 'Quitar «img-2.jpg»' })).toBeInTheDocument();
    expect(f.mock.calls.map(c => c[0])).toContain('/api/imagenes/img-2.jpg/archivo');
    expect(f.mock.calls.some(c => String(c[0]).includes('cdn.test'))).toBe(false);
  });

  it('inicio.biblioteca.cerrar_olvida_lo_elegido', async () => {
    montar({ imagenes: imagenesDe(4), rutas: archivosDeImagenes(4) });
    pintar();
    await esperarLista();
    const hoja = await abrirLaHoja();
    await userEvent.click(tiles(hoja)[0]!);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agregar imágenes' })).toBeNull());
    expect(screen.queryByRole('list', { name: 'Imágenes de referencia' })).toBeNull();
    // al volver a abrirla no queda nada marcado
    const otra = await abrirLaHoja();
    expect(within(otra).getByRole('status')).toHaveTextContent('0 de 3 seleccionadas');
    expect(tiles(otra).every(t => t.getAttribute('aria-pressed') === 'false')).toBe(true);
    // Esc también cierra y también olvida
    await userEvent.click(tiles(otra)[1]!);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agregar imágenes' })).toBeNull());
    const tercera = await abrirLaHoja();
    expect(within(tercera).getByRole('status')).toHaveTextContent('0 de 3 seleccionadas');
  });

  it('inicio.biblioteca.mi_computadora_elige_o_suelta_archivos', async () => {
    montar({ imagenes: imagenesDe(2), rutas: archivosDeImagenes(2) });
    const { container } = pintar();
    await esperarLista();
    const clic = vi.spyOn(entradaDeFotos(container), 'click');
    const hoja = await abrirLaHoja();
    await userEvent.click(within(hoja).getByRole('tab', { name: 'Mi computadora' }));
    expect(within(hoja).getByText('Arrastra tus imágenes aquí')).toBeInTheDocument();
    expect(within(hoja).getByText('JPG, PNG, WebP, GIF, AVIF o HEIC · hasta 20 MB.')).toBeInTheDocument();
    // «Elegir archivos…» cierra la hoja y abre el selector de archivos
    await userEvent.click(within(hoja).getByRole('button', { name: 'Elegir archivos…' }));
    expect(clic).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agregar imágenes' })).toBeNull());
    // soltar archivos en la hoja: un texto arrastrado no se corta; una imagen se agrega a la caja y la hoja se cierra
    const otra = await abrirLaHoja();
    await userEvent.click(within(otra).getByRole('tab', { name: 'Mi computadora' }));
    const zona = within(otra).getByText('Arrastra tus imágenes aquí').parentElement!;
    expect(fireEvent.dragOver(zona, { dataTransfer: { files: [], types: ['text/plain'] } })).toBe(true);
    expect(fireEvent.dragOver(zona, { dataTransfer: { files: [], types: ['Files'] } })).toBe(false);
    expect(zona).toHaveClass('border-ambar');
    fireEvent.drop(zona, { dataTransfer: { files: [foto('soltada.png'), new File(['x'], 'nota.txt', { type: 'text/plain' })], types: ['Files'] } });
    expect(await screen.findByRole('button', { name: 'Quitar «soltada.png»' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agregar imágenes' })).toBeNull());
    // lo soltado en la hoja no se agrega dos veces (la caja de atrás no lo oye)
    expect(within(screen.getByRole('list', { name: 'Imágenes de referencia' })).getAllByRole('listitem')).toHaveLength(1);
  });

  it('inicio.biblioteca.cerrar_olvida_lo_elegido_por_cualquier_camino', async () => {
    montar({ imagenes: imagenesDe(4), rutas: archivosDeImagenes(4) });
    const { container } = pintar();
    await esperarLista();
    const sinMarcar = (h: HTMLElement, caben: number) => {
      expect(within(h).getByRole('status')).toHaveTextContent(`0 de ${caben} seleccionadas`);
      expect(tiles(h).every(t => t.getAttribute('aria-pressed') === 'false')).toBe(true);
    };
    // «Elegir archivos…» cierra la hoja sin pasar por Cancelar, y lo marcado no se queda esperando
    const clic = vi.spyOn(entradaDeFotos(container), 'click');
    let hoja = await abrirLaHoja();
    await userEvent.click(tiles(hoja)[0]!);
    await userEvent.click(tiles(hoja)[1]!);
    await userEvent.click(within(hoja).getByRole('tab', { name: 'Mi computadora' }));
    await userEvent.click(within(hoja).getByRole('button', { name: 'Elegir archivos…' }));
    expect(clic).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agregar imágenes' })).toBeNull());
    hoja = await abrirLaHoja();
    sinMarcar(hoja, 3);
    // soltar una imagen tampoco: se agrega 1 y al reabrir caben 2, sin nada marcado
    await userEvent.click(tiles(hoja)[2]!);
    await userEvent.click(within(hoja).getByRole('tab', { name: 'Mi computadora' }));
    const zona = within(hoja).getByText('Arrastra tus imágenes aquí').parentElement!;
    fireEvent.drop(zona, { dataTransfer: { files: [foto('soltada.png')], types: ['Files'] } });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agregar imágenes' })).toBeNull());
    sinMarcar(await abrirLaHoja(), 2);
  });

  it('inicio.biblioteca.cerrar_mientras_trae_cancela_y_no_agrega_nada', async () => {
    let llega!: () => void;
    const espera = new Promise<void>(r => {
      llega = r;
    });
    const f = montar({
      imagenes: imagenesDe(2),
      rutas: {
        '/api/imagenes/img-2.jpg/archivo': async () => {
          await espera;
          return new Response('x', { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
        },
      },
    });
    pintar();
    await esperarLista();
    const hoja = await abrirLaHoja();
    await userEvent.click(tiles(hoja)[0]!);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Agregar 1' }));
    expect(within(hoja).getByText('Agregando…')).toBeInTheDocument();
    // la petición lleva una señal, y cerrar la hoja la aborta
    const init = f.mock.calls.find(c => c[0] === '/api/imagenes/img-2.jpg/archivo')![1]!;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal!.aborted).toBe(false);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agregar imágenes' })).toBeNull());
    expect(init.signal!.aborted).toBe(true);
    // cuando la imagen llega ya no hay a quién dársela: la caja no cambia (ni de tarea, ni de imágenes)
    llega();
    await act(async () => {
      await new Promise(r => setTimeout(r, 20));
    });
    expect(screen.queryByRole('list', { name: 'Imágenes de referencia' })).toBeNull();
    expect(botonOpcion()).toHaveTextContent('Un video corto');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('inicio.biblioteca.soltar_algo_que_no_es_imagen_no_cierra_la_hoja_y_lo_dice', async () => {
    montar({ imagenes: imagenesDe(2), rutas: archivosDeImagenes(2) });
    pintar();
    await esperarLista();
    const hoja = await abrirLaHoja();
    await userEvent.click(within(hoja).getByRole('tab', { name: 'Mi computadora' }));
    const zona = within(hoja).getByText('Arrastra tus imágenes aquí').parentElement!;
    fireEvent.drop(zona, { dataTransfer: { files: [new File(['x'], 'guia.pdf', { type: 'application/pdf' })], types: ['Files'] } });
    expect(within(hoja).getByRole('alert')).toHaveTextContent('Solo sirven imágenes: JPG, PNG, WebP, GIF, AVIF o HEIC · hasta 20 MB.');
    expect(screen.getByRole('dialog', { name: 'Agregar imágenes' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Imágenes de referencia' })).toBeNull();
    // una imagen sí: se agrega y la hoja se cierra
    fireEvent.drop(zona, { dataTransfer: { files: [foto('soltada.png')], types: ['Files'] } });
    expect(await screen.findByRole('button', { name: 'Quitar «soltada.png»' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agregar imágenes' })).toBeNull());
  });

  it('inicio.biblioteca.la_lista_no_se_mueve_mientras_esta_abierta', async () => {
    // una imagen nueva que llega del sondeo entraría al principio y movería las miniaturas bajo el puntero
    const props = {
      alCambiar: vi.fn(),
      disponibles: 3,
      reemplaza: false,
      alAgregar: vi.fn(async () => null),
      alElegirArchivos: vi.fn(),
      alSoltarArchivos: vi.fn(),
      descripcionArchivos: 'JPG',
    };
    const orden = () =>
      Array.from(screen.getByRole('dialog').querySelectorAll('img')).map(i => i.getAttribute('src'));
    const { rerender } = render(<Biblioteca abierto imagenes={[img(1), img(2)]} {...props} />);
    expect(orden()).toEqual(['/api/imagenes/img-2.jpg', '/api/imagenes/img-1.jpg']);
    rerender(<Biblioteca abierto imagenes={[img(1), img(2), img(3)]} {...props} />);
    expect(orden()).toEqual(['/api/imagenes/img-2.jpg', '/api/imagenes/img-1.jpg']);
    // al cerrarla y volver a abrirla sí aparece, la más nueva primero
    rerender(<Biblioteca abierto={false} imagenes={[img(1), img(2), img(3)]} {...props} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    rerender(<Biblioteca abierto imagenes={[img(1), img(2), img(3)]} {...props} />);
    expect(orden()).toEqual(['/api/imagenes/img-3.jpg', '/api/imagenes/img-2.jpg', '/api/imagenes/img-1.jpg']);
  });

  it('inicio.biblioteca.cada_miniatura_dice_si_esta_elegida_y_con_que_numero', async () => {
    montar({ imagenes: imagenesDe(3), rutas: archivosDeImagenes(3) });
    pintar();
    await esperarLista();
    const hoja = await abrirLaHoja();
    expect(tiles(hoja).map(t => t.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(/^Tu imagen del [^,]+$/),
      expect.stringMatching(/^Tu imagen del [^,]+$/),
      expect.stringMatching(/^Tu imagen del [^,]+$/),
    ]);
    await userEvent.click(tiles(hoja)[2]!);
    await userEvent.click(tiles(hoja)[0]!);
    // el número de orden es lo central de la selección: va en el nombre, no solo en el dibujo
    expect(tiles(hoja)[2]).toHaveAccessibleName(/, elegida: número 1$/);
    expect(tiles(hoja)[0]).toHaveAccessibleName(/, elegida: número 2$/);
    expect(tiles(hoja)[1]).not.toHaveAccessibleName(/elegida/);
  });

  it('inicio.biblioteca.al_cerrar_la_hoja_el_foco_vuelve_al_mas', async () => {
    // la hoja se abre desde un menú que ya se desmontó: sin esto el foco caía al <body>
    montar({ imagenes: imagenesDe(2), rutas: archivosDeImagenes(2) });
    pintar();
    await esperarLista();
    const hoja = await abrirLaHoja();
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(botonMas()).toHaveFocus());
    await abrirLaHoja();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agregar imágenes' })).toBeNull());
    await waitFor(() => expect(botonMas()).toHaveFocus());
  });

  it('inicio.biblioteca.el_menu_se_recorre_con_flechas_y_tab_lo_cierra', async () => {
    montar({ imagenes: imagenesDe(2), rutas: archivosDeImagenes(2) });
    pintar();
    await esperarLista();
    await userEvent.click(botonMas());
    const subir = screen.getByRole('menuitem', { name: /Subir de tu computadora/ });
    const elegir = screen.getByRole('menuitem', { name: /Elegir de Mis creaciones/ });
    expect(subir).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(elegir).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}'); // da la vuelta
    expect(subir).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(elegir).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(subir).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(elegir).toHaveFocus();
    // Tab cierra el menú y el foco sigue al control que viene después del «+»: no queda un menú abierto detrás del foco
    await userEvent.tab();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(botonMas()).toHaveAttribute('aria-expanded', 'false');
    expect(botonMas()).not.toHaveFocus();
  });

  it('inicio.biblioteca.abrir_el_menu_quita_el_error_del_cuadro_de_avisos', async () => {
    // en un celular chico el aviso de abajo a la derecha (z-999) tapaba el menú y se llevaba sus toques
    const avisos = ponerAvisos();
    montar({ imagenes: imagenesDe(2), rutas: archivosDeImagenes(2) });
    pintar();
    await esperarLista();
    await userEvent.click(enviar()); // sin texto: sale el error
    expect(avisos.mostrar).toHaveBeenCalledWith(expect.stringContaining('Cuéntanos qué quieres primero'), expect.objectContaining({ tipo: 'mal', clave: 'caja' }));
    expect(avisos.quitar).not.toHaveBeenCalled();
    await userEvent.click(botonMas());
    expect(avisos.quitar).toHaveBeenCalledWith('caja');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('inicio.biblioteca.el_menu_se_cierra_con_esc_y_fuera', async () => {
    montar({ imagenes: imagenesDe(2), rutas: archivosDeImagenes(2) });
    pintar();
    await esperarLista();
    await userEvent.click(botonMas());
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(botonMas()).toHaveFocus(); // el foco vuelve al «+»
    await userEvent.click(botonMas());
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.click(caja());
    expect(screen.queryByRole('menu')).toBeNull();
    // el «+» abre y cierra
    await userEvent.click(botonMas());
    await userEvent.click(botonMas());
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('los tres caminos', () => {
  it('inicio.caminos.solo_con_todas_las_listas_bien_y_vacias', async () => {
    montar({ proyectos: [] });
    const { unmount } = pintar();
    expect(await screen.findByRole('heading', { name: 'Tu primer video, en tres caminos' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Mis creaciones' })).toBeNull();
    unmount();
    // una lista que falló no cuenta como vacía
    for (const falla of [{ imagenes: null }, { ediciones: null }, { clips: null }] as const) {
      montar({ proyectos: [], ...falla });
      const { unmount: fuera } = pintar();
      expect(await screen.findByRole('heading', { name: 'Mis creaciones' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /tres caminos/ })).toBeNull();
      fuera();
    }
    // en local los clips no corren (503): no hay ninguno, y eso sí es vacío
    montar({ proyectos: [], clips: 'local' });
    pintar();
    expect(await screen.findByRole('heading', { name: /tres caminos/ })).toBeInTheDocument();
  });

  it('inicio.caminos.desde_una_idea_no_cobra_solo_elige', async () => {
    const f = montar({ proyectos: [] });
    pintar();
    await userEvent.click(await screen.findByRole('button', { name: 'Crear un video' }));
    expect(botonOpcion()).toHaveTextContent('Creador de cuentos');
    expect(caja()).toHaveFocus();
    expect(ir).not.toHaveBeenCalled();
    expect(f.mock.calls.every(c => (c[1]?.method ?? 'GET') === 'GET')).toBe(true);
  });

  it('inicio.caminos.enlaces_a_shorts_y_metraje', async () => {
    montar({ proyectos: [] });
    pintar();
    expect(await screen.findByRole('link', { name: 'Hacer shorts' })).toHaveAttribute('href', '/shorts.html');
    expect(screen.getByRole('link', { name: 'Subir metraje' })).toHaveAttribute('href', '/e1.html');
  });
});

describe('las listas', () => {
  it('inicio.carga.sin_proyectos_avisa_y_reintentar', async () => {
    let red = false;
    montar({ proyectos: () => (red ? json([P1]) : (sinRed() as Promise<Response>)) });
    pintar();
    expect(await screen.findByText(/No pudimos traer tus videos/)).toBeInTheDocument();
    // no se concluye que es alguien nuevo
    expect(screen.queryByRole('heading', { name: /tres caminos/ })).toBeNull();
    red = true;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('La historia del café')).toBeInTheDocument();
    expect(screen.queryByText(/No pudimos traer tus videos/)).toBeNull();
  });

  it('inicio.proyectos.cada_tarjeta_lleva_a_crear', async () => {
    montar({ proyectos: [P1, P2], slots: 3 });
    pintar();
    expect(await screen.findByRole('link', { name: 'La historia del café' })).toHaveAttribute('href', '/crear.html?p=p1');
    expect(screen.getByText('2 de 3 slots')).toBeInTheDocument();
    // UI·26: la lista ya no dice «lista»; la que produce sí dice su estado
    expect(screen.queryByText('lista')).toBeNull();
    expect(screen.getByText('produciéndose…')).toBeInTheDocument();
  });

  it('inicio.galeria.los_slots_se_ven_junto_al_titulo_y_no_hay_tarjetas_de_nuevo', async () => {
    montar({ proyectos: [P1, P2], slots: 2 });
    const { unmount } = pintar();
    await screen.findByText('La historia del café');
    expect(screen.getByText('2 de 2 slots')).toBeInTheDocument();
    // la caja ya es la puerta de entrada: no hay tarjetas «Nuevo…» que saquen de la página
    expect(screen.queryByRole('button', { name: 'Nuevo video' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Nueva imagen' })).toBeNull();
    unmount();
    montar({ proyectos: [P1], slots: null });
    pintar();
    expect(await screen.findByText('1 activos · slots ilimitados')).toBeInTheDocument();
  });

  it('inicio.proyectos.miniatura_rota_cae_al_personaje_y_al_hueco', async () => {
    montar();
    const { container } = pintar();
    await screen.findByText('La historia del café');
    const miniatura = () => container.querySelector('article img');
    expect(miniatura()).toHaveAttribute('src', '/api/proyectos/p1/archivo/portada.jpg');
    fireEvent.error(miniatura()!);
    expect(miniatura()).toHaveAttribute('src', '/api/proyectos/p1/archivo/personaje.png');
    fireEvent.error(miniatura()!);
    expect(miniatura()).toBeNull();
  });

  it('inicio.proyectos.archivar_pide_confirmar', async () => {
    let lista = [P1];
    const f = montar({
      proyectos: () => json(lista),
      rutas: {
        '/api/proyectos/p1/archivar': () => {
          lista = [{ ...P1, archivado: true }];
          return json({ ...P1, archivado: true });
        },
      },
    });
    pintar();
    await userEvent.click(await screen.findByRole('button', { name: 'Archivar «La historia del café»' }));
    expect(screen.getByRole('alertdialog', { name: '¿Archivar este proyecto?' })).toHaveTextContent('No se borra nada');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(llamadas(f, '/api/proyectos/p1/archivar')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Archivar «La historia del café»' }));
    await userEvent.click(screen.getByRole('button', { name: 'Archivar' }));
    expect(await screen.findByText(/Proyectos archivados \(1\)/)).toBeInTheDocument();
    expect(llamadas(f, '/api/proyectos/p1/archivar')).toHaveLength(1);
  });

  it('inicio.proyectos.no_se_ofrece_archivar_mientras_corre', async () => {
    montar({ proyectos: [P2, { ...P1, id: 'p3', estado: 'preparando', brief: 'Otro' }] });
    pintar();
    await screen.findByText('Roma en 60 segundos');
    expect(screen.queryByRole('button', { name: /Archivar/ })).toBeNull();
  });

  it('inicio.proyectos.error_al_archivar_dice_el_motivo', async () => {
    let veces = 0;
    montar({
      rutas: {
        '/api/proyectos/p1/archivar': () =>
          ++veces === 1
            ? json({ detail: 'El proyecto tiene una tarea en curso — espera a que termine para archivarlo' }, 409)
            : (sinRed() as Promise<Response>),
      },
    });
    pintar();
    for (const esperado of ['El proyecto tiene una tarea en curso', 'Sin conexión — intenta de nuevo.']) {
      await userEvent.click(await screen.findByRole('button', { name: /Archivar «/ }));
      await userEvent.click(screen.getByRole('button', { name: 'Archivar' }));
      expect(await screen.findByText(new RegExp(esperado))).toBeInTheDocument();
    }
  });

  it('inicio.proyectos.restaurar_desde_archivados', async () => {
    let lista = [P1, ARCH];
    const f = montar({
      proyectos: () => json(lista),
      rutas: {
        '/api/proyectos/p9/desarchivar': () => {
          lista = [P1, { ...ARCH, archivado: false }];
          return json({ ...ARCH, archivado: false });
        },
      },
    });
    pintar();
    await userEvent.click(await screen.findByText(/Proyectos archivados \(1\)/));
    await userEvent.click(screen.getByRole('button', { name: 'Restaurar' }));
    await waitFor(() => expect(screen.queryByText(/Proyectos archivados/)).toBeNull());
    expect(llamadas(f, '/api/proyectos/p9/desarchivar')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Un proyecto viejo' })).toBeInTheDocument();
  });

  it('inicio.galeria.doce_y_ver_mas', async () => {
    montar({ imagenes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(img) });
    pintar();
    // 13 imágenes y 1 película: se ven 12 y quedan 2
    const ver = await screen.findByRole('button', { name: 'Ver más (2)' });
    expect(screen.getAllByRole('button', { name: /Abrir tu imagen/ })).toHaveLength(11);
    await userEvent.click(ver);
    expect(screen.getAllByRole('button', { name: /Abrir tu imagen/ })).toHaveLength(13);
    expect(screen.queryByRole('button', { name: /Ver más/ })).toBeNull();
  });

  it('inicio.imagenes.cada_una_abre_en_el_visor_y_la_rota_no_deja_icono', async () => {
    montar({ imagenes: [{ ...img(1), nombre: 'mi foto&1.jpg' }] });
    const { container } = pintar();
    const tarjeta = await screen.findByRole('button', { name: /Abrir tu imagen/ });
    const im = tarjeta.querySelector('img')!;
    expect(im).toHaveAttribute('loading', 'lazy');
    await userEvent.click(tarjeta);
    // el visor ofrece bajarla y editarla; no cambia de página
    const visor = await screen.findByRole('dialog', { name: 'Tu imagen' });
    expect(within(visor).getByRole('link', { name: 'Editar' })).toHaveAttribute('href', '/imagenes.html?img=mi%20foto%261.jpg');
    expect(within(visor).getByRole('link', { name: /Descargar/ })).toHaveAttribute('href', '/api/imagenes/img-1.jpg');
    expect(ir).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.error(im);
    expect(container.querySelector('button[aria-label^="Abrir tu imagen"] img')).toBeNull();
  });

  it('inicio.imagenes.si_falla_la_lista_no_se_rompe', async () => {
    montar({ imagenes: null });
    pintar();
    await screen.findByText('La historia del café');
    expect(screen.queryByRole('heading', { name: 'Mis imágenes' })).toBeNull();
  });

  it('inicio.ediciones.estado_y_enlace_a_e1', async () => {
    montar({ ediciones: [ED, { ...ED, nombre: 'año nuevo', editor_listo: false, editar: { estado: 'corriendo' } }] });
    pintar();
    expect(await screen.findByRole('link', { name: /podcast/ })).toHaveAttribute('href', '/e1.html?p=podcast');
    expect(screen.getByText('corte listo — ábrelo en el editor')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /año nuevo/ })).toHaveAttribute('href', '/e1.html?p=a%C3%B1o%20nuevo');
    expect(screen.getByText('sugerencias en curso…')).toBeInTheDocument();
  });

  it('inicio.galeria.una_sola_galeria_lo_mas_nuevo_primero', async () => {
    montar({ proyectos: [P1], clips: [C1], ediciones: [S1, ED], imagenes: [img(1)] });
    pintar();
    const seccion = (await screen.findByRole('heading', { name: 'Mis creaciones' })).closest('section')!;
    // ya no hay tres secciones: Mis videos / Mis imágenes / Mis ediciones desaparecen
    const titulos = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent);
    expect(titulos.filter(t => t?.startsWith('Mis '))).toEqual(['Mis creaciones']);
    // clip 25-sep, shorts 22-sep, edición de esos shorts 21-sep, película 20-sep, imagen de 2025,
    // y la edición sin fecha al final
    const tarjetas = [...seccion.querySelector('.grid')!.children].map(c => c.textContent ?? '');
    const esperado = ['Mi perro en la playa', 'Mi charla en el foro', 'yt-charla', 'La historia del café', 'Imagen', 'podcast'];
    expect(tarjetas).toHaveLength(esperado.length);
    esperado.forEach((t, i) => expect(tarjetas[i]).toContain(t));
  });

  it('inicio.galeria.los_filtros_solo_ofrecen_lo_que_hay', async () => {
    montar({ imagenes: [img(1)] });
    pintar();
    const grupo = await screen.findByRole('group', { name: 'Filtrar' });
    const nombres = within(grupo).getAllByRole('button').map(b => b.textContent);
    expect(nombres).toEqual(['Todo 2', 'Películas 1', 'Imágenes 1']);
    expect(within(grupo).getByRole('button', { name: /^Todo/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(grupo).getByRole('button', { name: /^Imágenes/ }));
    expect(screen.queryByText('La historia del café')).toBeNull();
    expect(screen.getByRole('button', { name: /Abrir tu imagen/ })).toBeInTheDocument();
    expect(within(grupo).getByRole('button', { name: /^Imágenes/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('inicio.galeria.se_actualiza_sola_mientras_un_clip_se_genera', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let listo = false;
    const f = montar({
      rutas: {
        '/api/clip': () =>
          json({ clips: [listo ? C1 : { ...C1, estado: 'generando', video: '' }] }),
      },
    });
    pintar();
    await screen.findByText('generándose…', { exact: false });
    const antes = llamadas(f, '/api/clip', 'GET').length;
    listo = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    await waitFor(() => expect(screen.queryByText('generándose…', { exact: false })).toBeNull());
    expect(llamadas(f, '/api/clip', 'GET').length).toBeGreaterThan(antes);
    // ya listo, deja de preguntar
    const despues = llamadas(f, '/api/clip', 'GET').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11000);
    });
    expect(llamadas(f, '/api/clip', 'GET').length).toBe(despues);
  });

  it('inicio.galeria.una_imagen_en_segundo_plano_aparece_generando', async () => {
    // sin nada más: solo ella basta para que no se quede en «Tu primer video, en tres caminos»
    montar({ proyectos: [], pedidos: [PEDIDO] });
    pintar();
    const grupo = await screen.findByRole('group', { name: 'Filtrar' });
    expect(screen.queryByRole('heading', { name: 'Tu primer video, en tres caminos' })).toBeNull();
    const tarjeta = screen.getAllByRole('article')[0]!;
    expect(tarjeta).toHaveAttribute('aria-busy', 'true');
    expect(tarjeta).toHaveTextContent('Generando…');
    expect(tarjeta).toHaveTextContent('un faro de noche');
    expect(tarjeta).toHaveTextContent('Imagen');
    // cuenta como imagen en los filtros
    expect(within(grupo).getAllByRole('button').map(b => b.textContent)).toEqual(['Todo 1', 'Imágenes 1']);
    await userEvent.click(within(grupo).getByRole('button', { name: /^Imágenes/ }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it('inicio.galeria.una_imagen_que_fallo_dice_por_que', async () => {
    const monedero = ponerMonedero(100);
    montar({ pedidos: [{ ...PEDIDO, estado: 'error', error: SE_DEVOLVIERON }, { ...PEDIDO, id: 'img-20261011-110000-def456', texto: '<b>otra</b>' }] });
    pintar();
    await screen.findByText(SE_DEVOLVIERON);
    const falla = screen.getByText(SE_DEVOLVIERON).closest('article')!;
    // ya no gira: dice que falló y por qué, con el texto que se pidió
    expect(falla).not.toHaveAttribute('aria-busy');
    expect(falla).not.toHaveTextContent('Generando…');
    expect(falla).toHaveTextContent('Con error');
    expect(falla).toHaveTextContent('un faro de noche');
    // la otra sigue generándose, y su texto es texto
    expect(screen.getByText('<b>otra</b>').closest('article')).toHaveAttribute('aria-busy', 'true');
    // un error que ya estaba al abrir la página no es una novedad: el saldo se lee solo
    expect(monedero.refrescar).not.toHaveBeenCalled();
  });

  it('inicio.galeria.se_actualiza_sola_mientras_una_imagen_se_hace', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let hecha = false;
    const f = montar({
      proyectos: [],
      rutas: {
        '/api/imagenes': () => json(hecha ? { imagenes: [img(1)], pendientes: [] } : { imagenes: [], pendientes: [PEDIDO] }),
      },
    });
    pintar();
    await screen.findByText('Generando…');
    const antes = llamadas(f, '/api/imagenes', 'GET').length;
    hecha = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    // ya está en «Mis creaciones» como cualquier imagen, y la tarjeta que giraba se fue
    expect(await screen.findByRole('button', { name: /Abrir tu imagen/ })).toBeInTheDocument();
    expect(screen.queryByText('Generando…')).toBeNull();
    expect(llamadas(f, '/api/imagenes', 'GET').length).toBeGreaterThan(antes);
    // ya no hay nada generándose: deja de preguntar
    const despues = llamadas(f, '/api/imagenes', 'GET').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11000);
    });
    expect(llamadas(f, '/api/imagenes', 'GET').length).toBe(despues);
  });

  it('inicio.galeria.una_imagen_que_pasa_a_error_refresca_el_saldo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const monedero = ponerMonedero(100);
    let fallo = false;
    // además, una que falló hace un rato: sola no es una novedad
    const vieja = { ...PEDIDO, id: 'img-20261011-110000-def456', estado: 'error', error: 'Esta falló antes.' };
    const f = montar({
      rutas: {
        '/api/imagenes': () =>
          json({ imagenes: [], pendientes: [fallo ? { ...PEDIDO, estado: 'error', error: SE_DEVOLVIERON } : PEDIDO, vieja] }),
      },
    });
    pintar();
    await screen.findByText('Generando…');
    expect(screen.getByText('Esta falló antes.')).toBeInTheDocument();
    expect(monedero.refrescar).not.toHaveBeenCalled();
    fallo = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    // el worker ya devolvió los créditos: el saldo vuelve a subir
    expect(await screen.findByText(SE_DEVOLVIERON)).toBeInTheDocument();
    expect(monedero.refrescar).toHaveBeenCalledTimes(1);
    // y el error que se queda a la vista no vuelve a refrescar ni a preguntar
    const despues = llamadas(f, '/api/imagenes', 'GET').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11000);
    });
    expect(llamadas(f, '/api/imagenes', 'GET').length).toBe(despues);
    expect(monedero.refrescar).toHaveBeenCalledTimes(1);
  });

  it('inicio.galeria.una_imagen_que_pasa_a_error_se_anuncia', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let fallo = false;
    montar({
      rutas: {
        '/api/imagenes': () =>
          json({ imagenes: [], pendientes: [fallo ? { ...PEDIDO, estado: 'error', error: SE_DEVOLVIERON } : PEDIDO] }),
      },
    });
    pintar();
    await screen.findByText('Generando…');
    // la región viva ya está en la página mientras gira: un lector solo anuncia lo que CAMBIA en una que ya existía
    const region = screen.getByText('Generando…').closest('article')!.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region).not.toHaveTextContent(SE_DEVOLVIERON);
    fallo = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    await screen.findByText(SE_DEVOLVIERON);
    // el mismo nodo, ahora con el mensaje del servidor; amable (polite): el fallo ya se devolvió, no hay prisa
    expect(screen.getByText(SE_DEVOLVIERON).closest('[aria-live]')).toBe(region);
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('inicio.galeria.si_falla_la_lista_de_imagenes_a_media_espera_no_se_pierde_el_pedido', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let cae = false;
    const f = montar({
      proyectos: [],
      rutas: { '/api/imagenes': () => (cae ? json({ detail: 'x' }, 500) : json({ imagenes: [], pendientes: [PEDIDO] })) },
    });
    pintar();
    await screen.findByText('Generando…');
    cae = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    // la lista no llegó, pero el pedido sigue ahí y se sigue preguntando
    const fallida = llamadas(f, '/api/imagenes', 'GET').length;
    expect(screen.getByText('Generando…')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(llamadas(f, '/api/imagenes', 'GET').length).toBeGreaterThan(fallida);
    expect(screen.getByText('Generando…')).toBeInTheDocument();
  });

  it('inicio.galeria.una_lectura_con_los_pedidos_sin_leer_a_media_espera_no_borra_el_pedido_ni_apaga_el_sondeo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // el pedido va generándose; una lectura sale 200 sin poder leer los pedidos (pendientes_ok: false) pero con las
    // imágenes ya terminadas; la siguiente ya trae todo
    let paso: 'bien' | 'degradada' | 'hecha' = 'bien';
    const f = montar({
      proyectos: [],
      rutas: {
        '/api/imagenes': () =>
          paso === 'bien'
            ? json({ imagenes: [], pendientes: [PEDIDO], pendientes_ok: true })
            : paso === 'degradada'
              ? json({ imagenes: [img(1)], pendientes: [], pendientes_ok: false })
              : json({ imagenes: [img(1), img(2)], pendientes: [], pendientes_ok: true }),
      },
    });
    pintar();
    await screen.findByText('Generando…');
    paso = 'degradada';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    // las imágenes que sí vinieron se ven; el pedido no se pierde por una lectura que no pudo leerlo
    expect(await screen.findByRole('button', { name: /Abrir tu imagen/ })).toBeInTheDocument();
    expect(generando()).toHaveLength(1);
    expect(generando()[0]).toHaveTextContent('un faro de noche');
    // y se sigue preguntando: no se apagó el sondeo
    const degradada = lecturasDeImagenes(f);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(lecturasDeImagenes(f)).toBeGreaterThan(degradada);
    expect(generando()).toHaveLength(1);
    // la lectura buena dice que ya no hay pedidos: ahí sí se va la tarjeta y se deja de preguntar
    paso = 'hecha';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    await waitFor(() => expect(generando()).toHaveLength(0));
    expect(screen.getAllByRole('button', { name: /Abrir tu imagen/ })).toHaveLength(2);
    const fin = lecturasDeImagenes(f);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11000);
    });
    expect(lecturasDeImagenes(f)).toBe(fin);
  });

  it('inicio.listas.textos_del_server_como_texto', async () => {
    const malo = '<img src=x onerror=alert(1)>';
    montar({
      proyectos: [{ ...P1, brief: malo, miniatura: null, miniatura_alt: null }, { ...ARCH, brief: malo }],
      ediciones: [{ ...ED, nombre: malo }, { ...S1, shorts: { ...S1.shorts!, titulo: malo } }],
      clips: [{ ...C1, texto: malo }],
    });
    const { container } = pintar();
    expect(await screen.findAllByText(malo)).toHaveLength(5);
    expect(container.querySelector('img[src="x"]')).toBeNull();
  });
});

describe('Mis creaciones: los videos', () => {
  // el título de cada tarjeta de video (el atributo title lo llevan el enlace, el botón y el texto que aún no abre)
  const titulos = () =>
    screen
      .getAllByRole('article')
      .map(a => a.querySelector('[title]:not([title^="Archivar"])')?.getAttribute('title'))
      .filter(Boolean);
  const tarjeta = async (titulo: string) => (await screen.findByTitle(titulo)).closest('article')!;

  it('inicio.videos.mezcla_peliculas_clips_y_shorts_lo_mas_nuevo_primero', async () => {
    montar({ proyectos: [P1], clips: [C1], ediciones: [S1] });
    pintar();
    await screen.findByText('Mi perro en la playa');
    // clip 25-sep, shorts 22-sep, película 20-sep
    expect(titulos()).toEqual(['Mi perro en la playa', 'Mi charla en el foro', 'La historia del café']);
  });

  it('inicio.videos.las_cuatro_etiquetas', async () => {
    montar({
      proyectos: [
        { ...P1, id: 'a', brief: 'Idea', modo: 'idea' },
        { ...P1, id: 'b', brief: 'Vieja', modo: 'auto' },
        { ...P1, id: 'c', brief: 'Sin modo' },
        { ...P1, id: 'd', brief: 'Investigada', modo: 'investigacion' },
      ],
      clips: [C1],
      ediciones: [S1],
    });
    pintar();
    const etiqueta = async (titulo: string) =>
      (await tarjeta(titulo)).querySelector('p')!.textContent;
    expect(await etiqueta('Idea')).toMatch(/^Video largo · /);
    expect(await etiqueta('Vieja')).toMatch(/^Video largo · /);
    expect(await etiqueta('Sin modo')).toMatch(/^Video largo · /);
    expect(await etiqueta('Investigada')).toMatch(/^Cuento · /);
    expect(await etiqueta('Mi perro en la playa')).toMatch(/^Video corto · /);
    expect(await etiqueta('Mi charla en el foro')).toMatch(/^Shorts · /);
  });

  it('inicio.videos.el_estado_solo_si_no_esta_listo', async () => {
    montar({
      proyectos: [{ ...P1, estado: 'revision', modo: 'investigacion' }],
      clips: [
        { ...C1, id: 'c1', texto: 'Generándose', estado: 'generando' },
        { ...C1, id: 'c2', texto: 'Fallido', estado: 'error' },
        { ...C1, id: 'c3', texto: 'Listo' },
      ],
      ediciones: [
        { ...S1, nombre: 's1', shorts: { ...S1.shorts!, titulo: 'Corriendo', estado: 'corriendo' } },
        { ...S1, nombre: 's2', shorts: { ...S1.shorts!, titulo: 'Esperando', estado: 'espera' } },
        { ...S1, nombre: 's3', shorts: { ...S1.shorts!, titulo: 'Listos' } },
      ],
    });
    pintar();
    const leyenda = async (titulo: string) =>
      (await tarjeta(titulo)).querySelector('p')!.textContent ?? '';
    expect(await leyenda('La historia del café')).toMatch(/^Cuento · en revisión — te espera · /);
    expect(await leyenda('Generándose')).toMatch(/^Video corto · generándose… · /);
    expect(await leyenda('Fallido')).toMatch(/^Video corto · con error · /);
    expect(await leyenda('Listo')).toMatch(/^Video corto · \d/);
    expect(await leyenda('Corriendo')).toMatch(/^Shorts · en proceso… · /);
    expect(await leyenda('Esperando')).toMatch(/^Shorts · te espera · /);
    expect(await leyenda('Listos')).toMatch(/^Shorts · \d/);
  });

  it('inicio.videos.cada_uno_abre_su_pantalla', async () => {
    montar({ proyectos: [P1], clips: [C1, { ...C1, id: 'c-gen', texto: 'En camino', estado: 'generando', video: '' }], ediciones: [S1] });
    const { container } = pintar();
    // el clip listo abre en el visor (no cambia de página); el que se genera no abre nada todavía
    const clipListo = await screen.findByRole('button', { name: 'Mi perro en la playa' });
    expect(screen.queryByRole('button', { name: 'En camino' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Mi charla en el foro' })).toHaveAttribute('href', '/shorts.html?p=yt-charla');
    expect(screen.getByRole('link', { name: 'La historia del café' })).toHaveAttribute('href', '/crear.html?p=p1');
    // el clip listo enseña su primer cuadro, callado y fuera del tabulador; el que se genera, el hueco
    const videos = container.querySelectorAll('article video');
    expect(videos).toHaveLength(1);
    expect(videos[0]).toHaveAttribute('src', C1.video + '#t=0.5');
    expect((videos[0] as HTMLVideoElement).muted).toBe(true);
    expect(videos[0]).toHaveAttribute('tabindex', '-1');
    // un video que no carga cae al hueco
    fireEvent.error(videos[0]!);
    expect(container.querySelectorAll('article video')).toHaveLength(0);
    // el visor: el video con controles y la descarga
    await userEvent.click(clipListo);
    const visor = await screen.findByRole('dialog', { name: 'Mi perro en la playa' });
    expect(visor.querySelector('video')).toHaveAttribute('src', C1.video);
    expect(visor.querySelector('video')).toHaveAttribute('controls');
    expect(within(visor).getByRole('link', { name: /Descargar/ })).toHaveAttribute('href', C1.video);
    expect(ir).not.toHaveBeenCalled();
  });

  it('inicio.videos.los_slots_cuentan_solo_peliculas', async () => {
    montar({ proyectos: [P1], slots: 3, clips: [C1, { ...C1, id: 'otro' }], ediciones: [S1] });
    pintar();
    expect(await screen.findByText('1 de 3 slots')).toBeInTheDocument();
    // archivar sigue siendo solo de películas
    expect(screen.getAllByRole('button', { name: /^Archivar/ })).toHaveLength(1);
  });

  it('inicio.galeria.las_ediciones_van_en_su_filtro_y_los_shorts_en_el_suyo', async () => {
    montar({ ediciones: [ED, S1] });
    pintar();
    const grupo = await screen.findByRole('group', { name: 'Filtrar' });
    // Todo: la película, los shorts, la edición de esos shorts y la otra edición
    expect(within(grupo).getByRole('button', { name: /^Todo/ })).toHaveTextContent('4');
    await userEvent.click(within(grupo).getByRole('button', { name: /^Shorts/ }));
    expect(screen.getByText('Mi charla en el foro')).toBeInTheDocument();
    expect(screen.queryByText('podcast')).toBeNull();
    await userEvent.click(within(grupo).getByRole('button', { name: /^Ediciones/ }));
    expect(screen.getByText('podcast')).toBeInTheDocument();
    expect(screen.getByText('yt-charla')).toBeInTheDocument();
    expect(screen.queryByText('La historia del café')).toBeNull();
  });

  it('inicio.videos.sin_los_clips_avisa_y_reintenta', async () => {
    let red = false;
    montar({ rutas: { '/api/clip': () => (red ? json({ clips: [C1] }) : (sinRed() as Promise<Response>)) } });
    pintar();
    expect(await screen.findByText(/No pudimos traer tus videos cortos/)).toBeInTheDocument();
    // las películas sí se ven
    expect(screen.getByText('La historia del café')).toBeInTheDocument();
    red = true;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Mi perro en la playa')).toBeInTheDocument();
    expect(screen.queryByText(/No pudimos traer tus videos cortos/)).toBeNull();
  });
});

// Desde el 15-oct-2026 (dueño, «Mapa con Irremplazables») no hay menú a la izquierda: las pantallas de cada grupo salen en la tarjeta,
// después de abrir el mapa (la miga del área) y las tres opciones (la ficha del área). El recorrido sin la caja está en
// Recorrido.test.tsx, y la lista de pantallas sola en Pantallas.test.tsx; aquí, lo que el menú de la izquierda ya cubría, por la ruta nueva.
async function irALaLista(grupo: string, area = 'Marketing') {
  // desde la caja la miga del área abre el mapa; si ya se está en una lista (otra vuelta) también sirve
  if (!screen.queryByRole('group', { name: 'Áreas' }))
    await userEvent.click(screen.getByRole('button', { name: /^Volver al mapa para cambiar de área/ }));
  await userEvent.click(within(screen.getByRole('group', { name: 'Áreas' })).getByRole('button', { name: new RegExp(`^${area}`) }));
  await userEvent.click(within(screen.getByRole('group', { name: area })).getByRole('button', { name: new RegExp(`^${grupo}`) }));
}
// la lista de pantallas del grupo (las migas son otra lista, dentro de su <nav>)
const listaDePantallas = (opciones: { hidden?: boolean } = {}) =>
  screen.getAllByRole('list', opciones).find(l => !l.closest('nav'))!;
const enlacesDeLaLista = (opciones: { hidden?: boolean } = {}) => within(listaDePantallas(opciones)).getAllByRole('link', opciones);

describe('el menú', () => {
  it('inicio.menu.entradas_y_grupos_en_orden', async () => {
    montar();
    pintar();
    // ya no hay menú: ni «Secciones», ni sus grupos (MIX tuvo el suyo debajo de Blotato; ahora vive en Avanzado)
    expect(screen.queryByRole('navigation', { name: 'Secciones' })).toBeNull();
    expect(screen.queryByText('Estudio de Contenido')).toBeNull();
    expect(screen.queryByText('Publicidad Automática')).toBeNull();
    // las pantallas de cada grupo, en su orden y con sus destinos
    await irALaLista('Blotato');
    expect(enlacesDeLaLista().map(a => a.getAttribute('href'))).toEqual(['/agenda.html', '/competencia.html', '/metricas.html']);
    await irALaLista('Avanzado');
    // MIX, con Blotato como requisito (se apaga sin su clave), y la Copiadora de estilos, que se queda aquí hasta que exista «Marcas»
    expect(enlacesDeLaLista().map(a => a.getAttribute('href'))).toEqual(['/mix.html', '/estilos.html']);
    // «De videos a Shorts» salió de las listas: vive en «Editar ▾»
    expect(screen.queryByText('De videos a Shorts')).toBeNull();
    // nada de Marketing dice «próximamente»; lo de Central, sí
    expect(listaDePantallas().textContent).not.toMatch(/próximamente/i);
    await irALaLista('Distrito', 'Central');
    expect(listaDePantallas().textContent).toMatch(/próximamente/i);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('inicio.menu.editor_de_videos_salio_y_las_otras_dos_de_su_grupo_se_quedan', async () => {
    montar();
    pintar();
    // «Editor de videos» (/e1.html) salió el 14-oct-2026 (dueño): editar metraje es la pestaña «Edición» de la caja. Sigue sin salir
    // en ninguna lista del recorrido, ni su texto, ni un enlace a /e1.html
    for (const [area, grupo] of [['Marketing', 'Blotato'], ['Marketing', 'Avanzado'], ['Central', 'Distrito']] as const) {
      await irALaLista(grupo, area);
      expect(screen.queryByText('Editor de videos')).toBeNull();
      expect(screen.queryByText('Sube tu metraje y la IA te propone el corte.')).toBeNull();
      expect(document.querySelector('a[href^="/e1.html"]')).toBeNull();
    }
    // la Copiadora de estilos se queda donde estaba su puerta (Avanzado), con su texto tal cual; «De videos a Shorts» pasó a «Editar ▾»
    await irALaLista('Avanzado');
    const estilos = enlacesDeLaLista().find(a => a.getAttribute('href') === '/estilos.html')!;
    expect(estilos.querySelector('b')?.textContent).toBe('Copiadora de estilos');
    expect(estilos).toHaveTextContent('Recrea el estilo visual de un contenido que te guste');
    expect(enlacesDeLaLista().some(a => a.getAttribute('href') === '/shorts.html')).toBe(false);
  });

  it('inicio.menu.el_titulo_dice_irremplazables_en_dorado_sin_icono', async () => {
    montar();
    pintar();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent(/^Irremplazables$/);
    // el dorado del título (dueño, 15-oct-2026): un degradado que solo usa este título, de la clase `texto-oro` de tokens.css; mismo
    // tamaño de pantalla y peso de título que las demás pantallas (`text-titulo-lg`, extrabold, Bricolage por `h1`)
    expect(h1.className.split(/\s+/)).toEqual(expect.arrayContaining(['text-titulo-lg', 'font-extrabold']));
    // el degradado es un FONDO recortado a la letra (`texto-oro`): en el h1, solo cubriría la caja del h1, y la letra que se desbordara
    // (espaciado de texto de WCAG 1.4.12 a 320 px, letra más grande) quedaría transparente y desaparecería. Va en un <span> en línea, cuya
    // caja mide lo que el texto; y el h1 parte la palabra en vez de dejarla salirse de la región
    expect(h1.className.split(/\s+/)).not.toContain('texto-oro');
    expect(h1.className.split(/\s+/)).toContain('[overflow-wrap:anywhere]');
    expect(h1.children).toHaveLength(1);
    const marca = h1.children[0]!;
    expect(marca.tagName).toBe('SPAN');
    expect(marca).toHaveClass('texto-oro');
    expect(marca).toHaveTextContent(/^Irremplazables$/);
    // el ámbar claro de antes ya no pinta el nombre
    expect(h1.className.split(/\s+/)).not.toContain('text-ambar-claro');
    expect(marca.className.split(/\s+/)).not.toContain('text-ambar-claro');
    // sin icono: ni un dibujo dentro del título
    expect(h1.querySelector('svg, img, i')).toBeNull();
    // el nombre de antes ya no sale en la pantalla, y es el único h1
    expect(screen.queryByText(/Estudio de video/)).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    await screen.findByText('La historia del café');
  });

  it('inicio.menu.sin_clave_se_apagan_las_cuatro_de_blotato_y_ofrecen_conectar', async () => {
    montar({ blotato: SIN_CLAVE });
    pintar();
    await irALaLista('Blotato');
    await waitFor(() => expect(within(listaDePantallas()).getAllByRole('link', { name: /Conecta tu Blotato/ })).toHaveLength(3));
    const apagadas = enlacesDeLaLista().filter(a => a.getAttribute('aria-disabled') === 'true');
    expect(apagadas.map(a => a.getAttribute('href'))).toEqual(['/agenda.html', '/competencia.html', '/metricas.html']);
    // el clic no lleva a un callejón: abre conectar
    const clic = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      apagadas[0]!.dispatchEvent(clic);
    });
    expect(clic.defaultPrevented).toBe(true);
    expect(await screen.findByRole('dialog', { name: 'Conecta tu Blotato' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    // la cuarta es MIX (en Avanzado); la Copiadora de estilos, que no depende de Blotato, no se apaga
    await irALaLista('Avanzado');
    const avanzadas = enlacesDeLaLista();
    expect(avanzadas.map(a => [a.getAttribute('href'), a.getAttribute('aria-disabled')])).toEqual([
      ['/mix.html', 'true'],
      ['/estilos.html', null],
    ]);
  });

  it('inicio.menu.si_no_se_sabe_no_se_apaga_nada', async () => {
    montar({ blotato: null });
    pintar();
    await screen.findByText('La historia del café');
    for (const grupo of ['Blotato', 'Avanzado']) {
      await irALaLista(grupo);
      expect(enlacesDeLaLista().filter(a => a.hasAttribute('aria-disabled'))).toHaveLength(0);
    }
  });

  it('inicio.menu.pregunta_ligero', async () => {
    const f = montar();
    pintar();
    await waitFor(() => expect(llamadas(f, '/api/blotato?redes=0', 'GET')).toHaveLength(1));
    expect(llamadas(f, '/api/blotato', 'GET')).toHaveLength(0);
  });
});

describe('Blotato', () => {
  // el botón vive en la lista de Blotato (antes, el «+» del menú de la izquierda): si no se está ahí, se va
  const abrir = async () => {
    if (!screen.queryByRole('button', { name: /Blotato conectado|Conecta tu cuenta de Blotato/ })) await irALaLista('Blotato');
    await userEvent.click(await screen.findByRole('button', { name: /Blotato conectado|Conecta tu cuenta de Blotato/ }));
  };

  it('inicio.blotato.mas_abre_el_dialogo_con_las_redes', async () => {
    montar();
    pintar();
    await abrir();
    const dlg = await screen.findByRole('dialog', { name: 'Tu Blotato' });
    expect(within(dlg).getByText('Tu Blotato está conectado')).toBeInTheDocument();
    expect(within(dlg).getByRole('list', { name: 'Redes conectadas en tu Blotato' })).toHaveTextContent(
      'InstagramEstudio Norte · @estudio.norte',
    );
  });

  it('inicio.blotato.aviso_del_cobro_con_el_precio_del_server_antes_del_campo', async () => {
    montar({ blotato: SIN_CLAVE });
    pintar();
    await abrir();
    const dlg = await screen.findByRole('dialog', { name: 'Conecta tu Blotato' });
    const nota = within(dlg).getByRole('note');
    expect(nota).toHaveTextContent('la API no viene en la prueba gratis de Blotato');
    expect(nota).toHaveTextContent('desde $29 dólares al mes con Starter');
    expect(nota).toHaveTextContent('Ese cobro es de Blotato, no nuestro.');
    const campo = within(dlg).getByLabelText('Tu clave de API de Blotato');
    expect(nota.compareDocumentPosition(campo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('inicio.blotato.clave_password_sin_autocompletar', async () => {
    montar({ blotato: SIN_CLAVE });
    pintar();
    await abrir();
    const campo = await screen.findByLabelText('Tu clave de API de Blotato');
    expect(campo).toHaveAttribute('type', 'password');
    expect(campo).toHaveAttribute('autocomplete', 'off');
    expect(campo).toHaveAttribute('spellcheck', 'false');
    expect(campo).toHaveAttribute('autocapitalize', 'off');
  });

  it('inicio.blotato.la_clave_se_borra_al_conectar_cancelar_y_cerrar', async () => {
    let estado = SIN_CLAVE;
    const f = montar({
      rutas: {
        '/api/blotato': (_u, init) => {
          if (init?.method === 'POST') estado = CONECTADO;
          return json(estado);
        },
      },
    });
    pintar();
    await abrir();
    // cerrar la vacía
    await userEvent.type(await screen.findByLabelText('Tu clave de API de Blotato'), 'secreta-1');
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    await abrir();
    expect(await screen.findByLabelText('Tu clave de API de Blotato')).toHaveValue('');
    // conectar la manda una vez y la vacía
    await userEvent.type(screen.getByLabelText('Tu clave de API de Blotato'), '  secreta-2 ');
    await userEvent.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByText('Tu Blotato está conectado')).toBeInTheDocument();
    const posts = llamadas(f, '/api/blotato');
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]![1]!.body))).toEqual({ clave: 'secreta-2' });
    // cambiar y cancelar la vacía
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar clave' }));
    await userEvent.type(screen.getByLabelText('Tu clave de API de Blotato'), 'secreta-3');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar clave' }));
    expect(screen.getByLabelText('Tu clave de API de Blotato')).toHaveValue('');
    // y ninguna clave quedó escrita en la página
    expect(document.body.innerHTML).not.toMatch(/secreta/);
  });

  it('inicio.blotato.sin_clave_no_manda_nada', async () => {
    const f = montar({ blotato: SIN_CLAVE });
    pintar();
    await abrir();
    await userEvent.click(await screen.findByRole('button', { name: 'Conectar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Pega tu clave de Blotato primero.');
    expect(llamadas(f, '/api/blotato')).toHaveLength(0);
  });

  it('inicio.blotato.error_del_server_se_dice_en_el_dialogo', async () => {
    montar({
      blotato: SIN_CLAVE,
      rutas: {
        '/api/blotato': (_u, init) =>
          init?.method === 'POST' ? json({ detail: 'Blotato no reconoce esa clave.' }, 400) : json(SIN_CLAVE),
      },
    });
    pintar();
    await abrir();
    await userEvent.type(await screen.findByLabelText('Tu clave de API de Blotato'), 'mala');
    await userEvent.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Blotato no reconoce esa clave.');
    expect(screen.getByRole('button', { name: 'Conectar' })).toBeEnabled();
  });

  it('inicio.blotato.clave_del_env_no_se_ofrece_desconectar', async () => {
    montar({ blotato: { ...CONECTADO, origen: 'env' } });
    pintar();
    await abrir();
    expect(await screen.findByText(/clave del/)).toHaveTextContent('Estás usando la clave del .env de esta máquina.');
    expect(screen.queryByRole('button', { name: 'Desconectar' })).toBeNull();
  });

  it('inicio.blotato.desconectar_pide_confirmar', async () => {
    const f = montar({
      rutas: { '/api/blotato': (_u, init) => json(init?.method === 'DELETE' ? SIN_CLAVE : CONECTADO) },
    });
    pintar();
    await abrir();
    await userEvent.click(await screen.findByRole('button', { name: 'Desconectar' }));
    expect(screen.getByRole('alertdialog', { name: '¿Desconectar tu cuenta de Blotato?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(llamadas(f, '/api/blotato', 'DELETE')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Desconectar' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Desconectar' }));
    await waitFor(() => expect(llamadas(f, '/api/blotato', 'DELETE')).toHaveLength(1));
    // y las pantallas de Blotato se apagan (el diálogo todavía las tapa: por eso `hidden`)
    await waitFor(() =>
      expect(enlacesDeLaLista({ hidden: true }).filter(a => a.getAttribute('aria-disabled') === 'true')).toHaveLength(3),
    );
  });

  it('inicio.blotato.viene_del_editor_con_blotato_conectar', async () => {
    history.replaceState(null, '', '/estudio/inicio/?blotato=conectar');
    const f = montar({ blotato: SIN_CLAVE });
    pintar();
    expect(await screen.findByRole('dialog', { name: 'Conecta tu Blotato' })).toBeInTheDocument();
    // con el diálogo abierto se pide el estado completo, no el ligero
    expect(llamadas(f, '/api/blotato', 'GET')).toHaveLength(1);
  });

  it('inicio.blotato.enlace_a_la_api_con_noopener', async () => {
    montar({ blotato: SIN_CLAVE });
    pintar();
    await abrir();
    const a = await screen.findByRole('link', { name: 'Blotato → Settings → API' });
    expect(a).toHaveAttribute('href', 'https://my.blotato.com/settings');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    expect(a).toHaveAttribute('target', '_blank');
  });

  it('inicio.blotato.conectar_enciende_el_menu', async () => {
    // (el «menú» son ahora las pantallas de la lista de Blotato)
    let estado = SIN_CLAVE;
    montar({
      rutas: {
        '/api/blotato': (_u, init) => {
          if (init?.method === 'POST') estado = CONECTADO;
          return json(estado);
        },
      },
    });
    pintar();
    await irALaLista('Blotato');
    await waitFor(() => expect(within(listaDePantallas()).getAllByRole('link', { name: /Conecta tu Blotato/ })).toHaveLength(3));
    await abrir();
    await userEvent.type(await screen.findByLabelText('Tu clave de API de Blotato'), 'buena');
    await userEvent.click(screen.getByRole('button', { name: 'Conectar' }));
    await screen.findByText('Tu Blotato está conectado');
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(within(listaDePantallas()).queryAllByRole('link', { name: /Conecta tu Blotato/ })).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Blotato conectado: ver o cambiar' })).toBeInTheDocument();
  });
});

describe('el marco', () => {
  it('inicio.marco.sin_version_anterior', async () => {
    montar();
    pintar();
    expect(screen.queryByRole('link', { name: 'Usar la versión anterior' })).toBeNull();
    await screen.findByText('La historia del café');
  });
});

describe('UI·18 · la miniatura se agranda hasta su película', () => {
  // jsdom no navega: el clic se queda en la página
  const sinNavegar = (e: Event) => e.preventDefault();
  beforeEach(() => document.addEventListener('click', sinNavegar));
  afterEach(() => document.removeEventListener('click', sinNavegar));

  it('tocar una película lista deja dicho qué miniatura llevar (la que se ve)', async () => {
    montar({ proyectos: [P1] });
    const { container } = pintar();
    fireEvent.click(await screen.findByRole('link', { name: 'La historia del café' }));
    expect(miniaturaQueLlega('p1')?.src).toBe('/api/proyectos/p1/archivo/portada.jpg');
    // si la portada falló, viaja la que quedó a la vista
    olvidarMiniatura();
    fireEvent.error(container.querySelector('article img')!);
    fireEvent.click(screen.getByRole('link', { name: 'La historia del café' }));
    expect(miniaturaQueLlega('p1')?.src).toBe('/api/proyectos/p1/archivo/personaje.png');
  });

  it('con Ctrl, ⌘, Shift, Alt o la rueda se abre en otra pestaña: no se deja nada dicho', async () => {
    montar({ proyectos: [P1] });
    pintar();
    const liga = await screen.findByRole('link', { name: 'La historia del café' });
    for (const tecla of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      fireEvent.click(liga, tecla);
      expect(miniaturaQueLlega('p1')).toBeNull();
    }
    // un clic normal, sí
    fireEvent.click(liga);
    expect(miniaturaQueLlega('p1')).not.toBeNull();
  });

  it('una película que no está lista abre su progreso: no hay reproductor al que agrandarse', async () => {
    montar({ proyectos: [{ ...P1, estado: 'produciendo' }] });
    pintar();
    fireEvent.click(await screen.findByRole('link', { name: 'La historia del café' }));
    expect(miniaturaQueLlega('p1')).toBeNull();
  });
});

describe('UI·24 · conectar Blotato dice «listo» con la palomita', () => {
  // el botón vive en la lista de Blotato (antes, el «+» del menú de la izquierda): si no se está ahí, se va
  const abrir = async () => {
    if (!screen.queryByRole('button', { name: /Blotato conectado|Conecta tu cuenta de Blotato/ })) await irALaLista('Blotato');
    await userEvent.click(await screen.findByRole('button', { name: /Blotato conectado|Conecta tu cuenta de Blotato/ }));
  };
  const palomita = (texto: HTMLElement) => texto.parentElement!.querySelector('svg path')!;

  it('UI·24: la clave recién guardada dibuja la palomita y se anuncia; al volver a abrir, quieta y callada', async () => {
    let estado = SIN_CLAVE;
    montar({
      rutas: {
        '/api/blotato': (_u, init) => {
          if (init?.method === 'POST') estado = CONECTADO;
          return json(estado);
        },
      },
    });
    pintar();
    await abrir();
    await userEvent.type(await screen.findByLabelText('Tu clave de API de Blotato'), 'buena');
    await userEvent.click(screen.getByRole('button', { name: 'Conectar' }));
    const listo = await screen.findByText('Tu Blotato está conectado');
    expect(listo.closest('[role="status"]')).not.toBeNull();
    expect(palomita(listo).getAttribute('class')).toBe('motion-safe:animate-trazo-se-dibuja');
    // «Guardado» no se lleva el foco: sigue dentro del diálogo
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    // Cambiar clave y Cancelar no guardó nada nuevo: quieta
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar clave' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(palomita(screen.getByText('Tu Blotato está conectado'))).not.toHaveAttribute('class');
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    await abrir();
    const quieta = await screen.findByText('Tu Blotato está conectado');
    expect(quieta.closest('[role="status"]')).toBeNull();
    expect(palomita(quieta)).not.toHaveAttribute('class');
  });
});


// El interruptor «Audio» del pie del menú de modelos (13-oct-2026): el clip con o sin sonido. Solo Veo Lite y Veo Fast se
// pueden apagar (su endpoint trae `generate_audio` y tarifas.json trae su número «sin sonido»); MiniMax y los dos Grok
// traen la pista que traen: el interruptor queda bloqueado y dice por qué. El precio que se ve es el de tarifas.json.
describe('el audio del clip', () => {
  const con = modelos.clip;
  const sin = modelos.clip_sin_audio;
  const ORDEN = ['Grok Imagine Video 1.5 Lite', 'MiniMax H3 Max Turbo', 'Veo 3.1 Lite', 'Grok Imagine Video', 'Veo 3.1 Fast'];
  const generar = { '/api/clip/generar': () => json({ lanzado: true, id: 'clip-1', creditos: 1 }) };

  async function abrirMenu() {
    await userEvent.click(botonModelo());
    return screen.getByRole('dialog', { name: 'Elegir modelo' });
  }
  const interruptor = (menu: HTMLElement) => within(menu).getByRole('switch', { name: 'Audio' });
  const fila = (menu: HTMLElement, nombre: RegExp) => within(menu).getByRole('radio', { name: nombre });
  const nombresDeFilas = (menu: HTMLElement) =>
    within(within(menu).getByRole('radiogroup', { name: 'Modelos' }))
      .getAllByRole('radio')
      .map(r => /^(Grok Imagine Video 1\.5 Lite|MiniMax H3 Max Turbo|Veo 3\.1 Lite|Grok Imagine Video|Veo 3\.1 Fast)/.exec(r.textContent!)![1]);

  it('inicio.audio.el_pie_trae_el_interruptor_con_sonido_y_el_precio', async () => {
    montar();
    pintar();
    const menu = await abrirMenu();
    // el pie guarda el modelo y su precio a la izquierda y el interruptor a la derecha; arranca con sonido, como siempre
    expect(menu).toHaveTextContent('Veo 3.1 Lite✦ ' + con['veo-lite']['8'] + ' por clip de 8 s');
    const sw = interruptor(menu);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw).not.toHaveAttribute('aria-disabled');
    expect(menu).toHaveTextContent('Con sonido');
    expect(menu).not.toHaveTextContent('ahorras');
    expect(fila(menu, /Veo 3\.1 Lite/)).toHaveTextContent('Google · 720p con audio');
  });

  it('inicio.audio.apagarlo_baja_el_precio_del_pie_las_filas_y_el_rango_y_dice_cuanto_se_ahorra', async () => {
    montar();
    pintar();
    const menu = await abrirMenu();
    await userEvent.click(interruptor(menu));
    expect(interruptor(menu)).toHaveAttribute('aria-checked', 'false');
    expect(menu).toHaveTextContent('Sin sonido');
    const ahorro = con['veo-lite']['8']! - sin['veo-lite']['8']!;
    expect(menu).toHaveTextContent('Veo 3.1 Lite✦ ' + sin['veo-lite']['8'] + ' por clip de 8 s · ahorras ✦ ' + ahorro);
    // la fila de Veo Lite baja y dice «sin audio»; Veo Fast también
    expect(fila(menu, /Veo 3\.1 Lite/)).toHaveTextContent('✦ ' + sin['veo-lite']['8']);
    expect(fila(menu, /Veo 3\.1 Lite/)).toHaveTextContent('Google · 720p sin audio');
    expect(fila(menu, /Veo 3\.1 Fast/)).toHaveTextContent('✦ ' + sin['veo-fast']['8']);
    // los que no se pueden apagar no cambian: siempre traen su sonido
    expect(fila(menu, /MiniMax/)).toHaveTextContent('✦ ' + con.h3t['8']);
    expect(fila(menu, /Grok Imagine Video 1\.5 Lite/)).toHaveTextContent('✦ ' + con.grokl['8']);
    // el rango de «Económicos» sale de lo que se paga ahora
    const economicos = [con.grokl['8']!, con.h3t['8']!, sin['veo-lite']['8']!, con.grokv['8']!];
    expect(menu).toHaveTextContent('Económicos✦ ' + Math.min(...economicos) + '–' + Math.max(...economicos) + ' por clip de 8 s');
    expect(menu).toHaveTextContent('Más calidad✦ ' + sin['veo-fast']['8'] + ' por clip de 8 s');
    // y al volver a encenderlo, todo vuelve
    await userEvent.click(interruptor(menu));
    expect(menu).toHaveTextContent('Veo 3.1 Lite✦ ' + con['veo-lite']['8'] + ' por clip de 8 s');
    expect(menu).not.toHaveTextContent('ahorras');
  });

  it('inicio.audio.las_filas_no_se_mueven_al_apagar_el_sonido', async () => {
    montar();
    pintar();
    const menu = await abrirMenu();
    expect(nombresDeFilas(menu)).toEqual(ORDEN);
    await userEvent.click(interruptor(menu));
    // Veo Lite pasa a costar menos que Grok Lite, pero no salta de lugar: el orden es por el precio con sonido
    expect(sin['veo-lite']['8']).toBeLessThan(con.grokl['8']!);
    expect(nombresDeFilas(menu)).toEqual(ORDEN);
  });

  it('inicio.audio.cambiar_la_duracion_con_el_sonido_apagado_usa_el_numero_sin_sonido_de_esa_duracion', async () => {
    montar();
    pintar();
    const menu = await abrirMenu();
    await userEvent.click(interruptor(menu));
    for (const s of ['4', '6', '8'] as const) {
      await userEvent.click(within(menu).getByRole('radio', { name: s + ' s' }));
      expect(interruptor(menu)).toHaveAttribute('aria-checked', 'false');
      // y el «ahorras» de ESA duración: con sonido menos sin sonido
      const ahorro = con['veo-lite'][s]! - sin['veo-lite'][s]!;
      expect(menu).toHaveTextContent('Veo 3.1 Lite✦ ' + sin['veo-lite'][s] + ' por clip de ' + s + ' s · ahorras ✦ ' + ahorro);
    }
  });

  it('inicio.audio.el_chip_dice_sin_audio_solo_cuando_el_clip_va_mudo', async () => {
    montar();
    pintar();
    expect(botonModelo()).toHaveTextContent('Modelo Veo 3.1 Lite · 8 s');
    expect(botonModelo()).not.toHaveTextContent('sin audio');
    const menu = await abrirMenu();
    await userEvent.click(interruptor(menu));
    await userEvent.keyboard('{Escape}');
    expect(botonModelo()).toHaveTextContent('Modelo Veo 3.1 Lite · 8 s · sin audio');
    // un modelo que no se puede apagar no dice «sin audio»: su clip lleva sonido aunque se haya elegido mudo antes
    await userEvent.click(botonModelo());
    await userEvent.click(fila(screen.getByRole('dialog', { name: 'Elegir modelo' }), /MiniMax/));
    await userEvent.keyboard('{Escape}');
    expect(botonModelo()).toHaveTextContent('Modelo MiniMax H3 Max Turbo · 8 s');
    expect(botonModelo()).not.toHaveTextContent('sin audio');
  });

  it('inicio.audio.el_pedido_manda_audio_false_si_se_apago_y_el_aviso_lo_dice', async () => {
    const avisos = ponerAvisos();
    const f = montar({ rutas: generar });
    pintar();
    await userEvent.type(caja(), 'un gato en la luna');
    const menu = await abrirMenu();
    await userEvent.click(interruptor(menu));
    await userEvent.click(within(menu).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(llamadas(f, '/api/clip/generar')).toHaveLength(1));
    expect(cuerpoDe(f, '/api/clip/generar')).toEqual({
      texto: 'un gato en la luna',
      formato: 'horizontal',
      imagenes: [],
      modelo: 'veo-lite',
      segundos: 8,
      audio: false,
      puerta: 'caja',
    });
    expect(avisos.mostrar).toHaveBeenCalledWith('Ya estamos creando tu clip de 8 segundos sin sonido. Míralo abajo, en «Mis creaciones».', {
      tipo: 'ok',
      clave: 'caja',
    });
  });

  it('inicio.audio.un_modelo_que_no_se_puede_apagar_bloquea_el_interruptor_y_dice_por_que', async () => {
    const f = montar({ rutas: generar });
    pintar();
    await userEvent.type(caja(), 'un gato en la luna');
    const menu = await abrirMenu();
    for (const [nombre, estado, motivo] of [
      [/MiniMax/, 'Sonido incluido', 'MiniMax H3 Max Turbo trae su propio sonido y no se puede apagar.'],
      [/Grok Imagine Video 1\.5 Lite/, 'Sonido muy bajo', 'El sonido de Grok Imagine Video 1.5 Lite es muy bajo y no se puede apagar.'],
      [/^Grok Imagine Video(?! 1)/, 'Sonido muy bajo', 'El sonido de Grok Imagine Video es muy bajo y no se puede apagar.'],
    ] as const) {
      await userEvent.click(fila(menu, nombre));
      const sw = interruptor(menu);
      // sigue en el orden del teclado (no es `disabled`), dice que está bloqueado y su estado y su motivo se leen con él
      expect(sw).toHaveAttribute('aria-disabled', 'true');
      expect(sw).toHaveAttribute('aria-checked', 'true');
      expect(menu).toHaveTextContent(estado);
      expect(menu).toHaveTextContent(motivo);
      const leidos = sw.getAttribute('aria-describedby')!.split(' ').map(id => document.getElementById(id)?.textContent);
      expect(leidos).toEqual([estado, motivo]);
      await userEvent.click(sw);
      expect(sw).toHaveAttribute('aria-checked', 'true'); // tocarlo no cambia nada
      expect(menu).not.toHaveTextContent('ahorras');
    }
    // y el pedido va con sonido
    await userEvent.click(within(menu).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(llamadas(f, '/api/clip/generar')).toHaveLength(1));
    expect(cuerpoDe(f, '/api/clip/generar')).toMatchObject({ modelo: 'grokv', audio: true });
  });

  it('inicio.audio.apagado_y_luego_un_modelo_sin_interruptor_pide_con_sonido_y_al_volver_sigue_apagado', async () => {
    const f = montar({ rutas: generar });
    pintar();
    await userEvent.type(caja(), 'un gato en la luna');
    const menu = await abrirMenu();
    await userEvent.click(interruptor(menu)); // Veo Lite sin sonido
    await userEvent.click(fila(menu, /MiniMax/));
    expect(menu).toHaveTextContent('MiniMax H3 Max Turbo✦ ' + con.h3t['8'] + ' por clip de 8 s'); // el precio de con sonido
    expect(menu).not.toHaveTextContent('Sin sonido');
    await userEvent.click(within(menu).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(llamadas(f, '/api/clip/generar')).toHaveLength(1));
    expect(cuerpoDe(f, '/api/clip/generar')).toMatchObject({ modelo: 'h3t', audio: true });
    // la elección de la persona no se perdió: Veo Lite vuelve a estar sin sonido
    await userEvent.click(botonModelo());
    const otra = screen.getByRole('dialog', { name: 'Elegir modelo' });
    await userEvent.click(fila(otra, /Veo 3\.1 Lite/));
    expect(interruptor(otra)).toHaveAttribute('aria-checked', 'false');
    expect(otra).toHaveTextContent('Veo 3.1 Lite✦ ' + sin['veo-lite']['8'] + ' por clip de 8 s');
  });

  it('inicio.audio.se_recuerda_en_el_navegador_y_si_el_navegador_no_deja_igual_funciona', async () => {
    montar();
    const primera = pintar();
    let menu = await abrirMenu();
    await userEvent.click(interruptor(menu));
    expect(localStorage.getItem('caja.sonido')).toBe('sin');
    primera.unmount();
    // otra visita: la caja arranca sin sonido, con el chip y el precio al día
    pintar();
    expect(botonModelo()).toHaveTextContent('· sin audio');
    menu = await abrirMenu();
    expect(interruptor(menu)).toHaveAttribute('aria-checked', 'false');
    expect(menu).toHaveTextContent('Veo 3.1 Lite✦ ' + sin['veo-lite']['8'] + ' por clip de 8 s');
    await userEvent.click(interruptor(menu));
    expect(localStorage.getItem('caja.sonido')).toBe('con');
  });

  it('inicio.audio.un_navegador_sin_almacenamiento_no_rompe_la_caja', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('almacenamiento bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('almacenamiento bloqueado');
    });
    montar();
    pintar();
    const menu = await abrirMenu();
    expect(interruptor(menu)).toHaveAttribute('aria-checked', 'true'); // sin lo guardado, con sonido
    await userEvent.click(interruptor(menu));
    expect(interruptor(menu)).toHaveAttribute('aria-checked', 'false'); // vale para esta visita aunque no se pueda guardar
  });

  it('inicio.audio.el_interruptor_se_usa_con_teclado', async () => {
    montar();
    pintar();
    const menu = await abrirMenu();
    const sw = interruptor(menu);
    sw.focus();
    await userEvent.keyboard(' ');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.keyboard('{Enter}');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw).toHaveFocus(); // sigue enfocado: el menú no se vuelve a montar
    // su estado se lee con él
    const leidos = sw.getAttribute('aria-describedby')!.split(' ').map(id => document.getElementById(id)?.textContent);
    expect(leidos).toEqual(['Con sonido']);
  });

  it('inicio.audio.imagen_y_editar_no_traen_interruptor', async () => {
    montar();
    pintar();
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    for (const tarea of ['Crear una imagen', 'Editar una imagen']) {
      await elegirOpcion(tarea);
      expect(botonOpcion()).toHaveTextContent(tarea);
      const menu = await abrirMenu();
      expect(within(menu).queryByRole('switch'), tarea).toBeNull();
      expect(menu, tarea).not.toHaveTextContent('Audio');
      await userEvent.keyboard('{Escape}');
    }
  });
});
