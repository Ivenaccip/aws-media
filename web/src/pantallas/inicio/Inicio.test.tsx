// El inicio del estudio, como COMPORTAMIENTO (docs/PLAN-UI.md §5). Cada test
// empieza por el ID de su invariante: tests/test_migracion_ui.py exige que
// cada ID del registro exista aquí.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clip, modelos, video } from '../../nucleo/tarifas';
import { miniaturaQueLlega, olvidarMiniatura } from '../../nucleo/transiciones';
import { json, llamadas, servidor, sinRed, type Ruta } from '../../prueba/servidor';
import { Inicio } from './Inicio';
import type { ClipCorto, Edicion, EstadoBlotato, Imagen, Proyecto } from './logica';

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
  ediciones = [],
  clips = [],
  blotato = CONECTADO,
  rutas = {},
}: Mundo = {}) {
  return servidor({
    '/api/proyectos': () => (typeof proyectos === 'function' ? proyectos() : json(proyectos)),
    '/api/slots': () => json({ slots, activos: 0 }),
    '/api/imagenes': () => (imagenes ? json({ total: imagenes.length, imagenes }) : json({ detail: 'x' }, 500)),
    '/api/edicion/proyectos': () => (ediciones ? json(ediciones) : sinRed()),
    '/api/clip': () =>
      clips === 'local' ? json({ detail: 'corre en el servicio' }, 503) : clips ? json({ clips }) : sinRed(),
    '/api/blotato': () => (blotato ? json(blotato) : sinRed()),
    '/api/moderar': () => json({ permitido: true }),
    ...rutas,
  });
}

let ir: ReturnType<typeof vi.fn<(url: string) => void>>;

function pintar() {
  return render(<Inicio ir={ir} />);
}

beforeEach(() => {
  vi.unstubAllGlobals();
  ir = vi.fn<(url: string) => void>();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  history.replaceState(null, '', '/estudio/inicio/');
});

afterEach(() => {
  vi.useRealTimers();
});

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
    // el clip: el menú de modelo enseña lo mismo que cobra la pantalla del clip
    expect(clip.video_8s).toBe(modelos.clip['veo-lite']);
    await userEvent.click(botonModelo());
    const menu = screen.getByRole('dialog', { name: 'Elegir modelo' });
    expect(within(menu).getByRole('radio', { name: /Veo 3\.1 Lite/ })).toHaveTextContent('✦ ' + modelos.clip['veo-lite']);
    expect(menu).toHaveTextContent('✦ ' + modelos.clip['veo-lite'] + ' por clip de 8 s');
    await userEvent.keyboard('{Escape}');
    // la imagen: el menú dice lo que dice tarifas.json, y es lo que ya valía
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    await userEvent.click(botonModelo());
    const imagen = screen.getByRole('dialog', { name: 'Elegir modelo' });
    expect(imagen).toHaveTextContent('✦ ' + modelos.imagen.grok + ' por imagen');
    expect(modelos.imagen.grok).toBe(video.imagen);
  });

  it('inicio.caja.el_envio_va_en_el_pie_del_menu_de_modelo', async () => {
    const f = montar({ rutas: { '/api/clip/generar': () => json({ lanzado: true, id: 'clip-1', creditos: modelos.clip['veo-lite'] }) } });
    pintar();
    await userEvent.type(caja(), 'un gato en la luna');
    await userEvent.click(botonModelo());
    const menu = screen.getByRole('dialog', { name: 'Elegir modelo' });
    await userEvent.click(within(menu).getByRole('button', { name: 'Crear' }));
    // el video corto se pide aquí, con el modelo elegido, y la página no navega
    await waitFor(() => expect(llamadas(f, '/api/clip/generar')).toHaveLength(1));
    expect(cuerpoDe(f, '/api/clip/generar')).toEqual({
      texto: 'un gato en la luna',
      formato: 'horizontal',
      imagenes: [],
      modelo: 'veo-lite',
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
    // hoy solo hay un modelo ofrecido por tarea: el predeterminado, y vuelve al regresar
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    expect(botonModelo()).toHaveTextContent('Modelo Grok Imagine');
    await elegirOpcion('Editar una imagen');
    expect(botonModelo()).toHaveTextContent('Modelo Grok Imagine');
    await userEvent.click(screen.getByRole('button', { name: 'Video' }));
    expect(botonModelo()).toHaveTextContent('Modelo Veo 3.1 Lite');
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
    expect(cuerpoDe(f, '/api/imagenes')).toEqual({ prompt: 'un gato en la luna', estilo: 'animated', estilo_custom: '', modelo: 'grok' });
    expect(ir).not.toHaveBeenCalled();
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

  it('inicio.caja.el_mas_agrega_quita_y_respeta_el_tope', async () => {
    const { container } = (montar(), pintar());
    expect(screen.getByRole('button', { name: 'Agregar imágenes de referencia' })).toBeInTheDocument();
    // «Crear una historia» no usa imágenes: no hay «+»
    await elegirOpcion('Crea tu historia');
    expect(screen.queryByRole('button', { name: /Agregar/ })).toBeNull();
    await elegirOpcion('Un video corto');
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
    await userEvent.click(within(menu).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(llamadas(f, '/api/clip/generar')).toHaveLength(1));
    expect(llamadas(f, '/api/clip/presign')).toHaveLength(2);
    expect(cuerpoDe(f, '/api/clip/generar').imagenes).toEqual(['usuarios/u/clips/subidas/1.png', 'usuarios/u/clips/subidas/2.png']);
  });

  it('inicio.caja.arrastrar_imagenes_a_la_caja_las_agrega', async () => {
    montar();
    pintar();
    const seccion = caja().closest('section')!;
    fireEvent.dragOver(seccion, { dataTransfer: { files: [] } });
    fireEvent.drop(seccion, { dataTransfer: { files: [foto('arrastrada.png')] } });
    expect(await screen.findByRole('button', { name: 'Quitar «arrastrada.png»' })).toBeInTheDocument();
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
    montar({ imagenes: [img(1)], rutas: { '/api/imagenes/img-1.jpg': () => new Response('x', { status: 200, headers: { 'Content-Type': 'image/jpeg' } }) } });
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
    expect(caja()).toHaveAttribute('placeholder', 'Pega tu historia completa — la respetamos como la escribiste.');
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
  });

  it('inicio.caja.cambiar_de_familia_elige_la_primera', async () => {
    montar();
    pintar();
    await elegirOpcion('Crea tu historia');
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    expect(screen.getByRole('button', { name: 'Imagen' })).toHaveAttribute('aria-pressed', 'true');
    expect(botonOpcion()).toHaveTextContent('Crear una imagen');
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

describe('el menú', () => {
  it('inicio.menu.entradas_y_grupos_en_orden', async () => {
    montar();
    pintar();
    const menu = screen.getByRole('navigation', { name: 'Secciones' });
    expect(within(menu).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual([
      '/e1.html',
      '/shorts.html',
      '/estilos.html',
      '/agenda.html',
      '/competencia.html',
      '/metricas.html',
      '/mix.html',
    ]);
    const texto = menu.textContent ?? '';
    // MIX tiene grupo propio, debajo de Blotato (su requisito)
    expect(texto.indexOf('Estudio de Contenido')).toBeLessThan(texto.indexOf('Blotato'));
    expect(texto.indexOf('Blotato')).toBeLessThan(texto.indexOf('Publicidad Automática'));
    expect(texto).not.toMatch(/próximamente/);
    await screen.findByText('La historia del café');
  });

  it('inicio.menu.sin_clave_se_apagan_las_cuatro_de_blotato_y_ofrecen_conectar', async () => {
    montar({ blotato: SIN_CLAVE });
    pintar();
    const menu = screen.getByRole('navigation', { name: 'Secciones' });
    await waitFor(() => expect(within(menu).getAllByRole('link', { name: /Conecta tu Blotato/ })).toHaveLength(4));
    const apagadas = within(menu).getAllByRole('link').filter(a => a.getAttribute('aria-disabled') === 'true');
    expect(apagadas.map(a => a.getAttribute('href'))).toEqual(['/agenda.html', '/competencia.html', '/metricas.html', '/mix.html']);
    // el clic no lleva a un callejón: abre conectar
    const clic = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      apagadas[0]!.dispatchEvent(clic);
    });
    expect(clic.defaultPrevented).toBe(true);
    expect(await screen.findByRole('dialog', { name: 'Conecta tu Blotato' })).toBeInTheDocument();
  });

  it('inicio.menu.si_no_se_sabe_no_se_apaga_nada', async () => {
    montar({ blotato: null });
    pintar();
    await screen.findByText('La historia del café');
    const menu = screen.getByRole('navigation', { name: 'Secciones' });
    expect(within(menu).getAllByRole('link').filter(a => a.hasAttribute('aria-disabled'))).toHaveLength(0);
  });

  it('inicio.menu.pregunta_ligero', async () => {
    const f = montar();
    pintar();
    await waitFor(() => expect(llamadas(f, '/api/blotato?redes=0', 'GET')).toHaveLength(1));
    expect(llamadas(f, '/api/blotato', 'GET')).toHaveLength(0);
  });
});

describe('Blotato', () => {
  const abrir = async () => {
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
    // y el menú se apaga
    const menu = screen.getByRole('navigation', { name: 'Secciones', hidden: true });
    await waitFor(() =>
      expect(within(menu).getAllByRole('link', { hidden: true }).filter(a => a.getAttribute('aria-disabled') === 'true')).toHaveLength(4),
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
    const menu = screen.getByRole('navigation', { name: 'Secciones' });
    await waitFor(() => expect(within(menu).getAllByRole('link', { name: /Conecta tu Blotato/ })).toHaveLength(4));
    await abrir();
    await userEvent.type(await screen.findByLabelText('Tu clave de API de Blotato'), 'buena');
    await userEvent.click(screen.getByRole('button', { name: 'Conectar' }));
    await screen.findByText('Tu Blotato está conectado');
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(within(menu).queryAllByRole('link', { name: /Conecta tu Blotato/ })).toHaveLength(0);
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
  const abrir = async () => {
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
