// El inicio del estudio, como COMPORTAMIENTO (docs/PLAN-UI.md §5). Cada test
// empieza por el ID de su invariante: tests/test_migracion_ui.py exige que
// cada ID del registro exista aquí.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clip, video } from '../../nucleo/tarifas';
import { miniaturaQueLlega, olvidarMiniatura } from '../../nucleo/transiciones';
import { json, llamadas, servidor, sinRed, type Ruta } from '../../prueba/servidor';
import { Inicio } from './Inicio';
import type { Edicion, EstadoBlotato, Imagen, Proyecto } from './logica';

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
  blotato?: EstadoBlotato | null;
  rutas?: Record<string, Ruta>;
}

function montar({ proyectos = [P1], slots = null, imagenes = [], ediciones = [], blotato = CONECTADO, rutas = {} }: Mundo = {}) {
  return servidor({
    '/api/proyectos': () => (typeof proyectos === 'function' ? proyectos() : json(proyectos)),
    '/api/slots': () => json({ slots, activos: 0 }),
    '/api/imagenes': () => (imagenes ? json({ total: imagenes.length, imagenes }) : json({ detail: 'x' }, 500)),
    '/api/edicion/proyectos': () => (ediciones ? json(ediciones) : sinRed()),
    '/api/blotato': () => (blotato ? json(blotato) : sinRed()),
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
const botonOpcion = () => screen.getByRole('button', { name: /✦/ });
const enviar = () => screen.getByRole('button', { name: 'Crear' });

async function elegirOpcion(rotulo: string) {
  await userEvent.click(botonOpcion());
  await userEvent.click(screen.getByRole('option', { name: new RegExp(rotulo) }));
}

describe('la caja', () => {
  it('inicio.caja.arranca_en_el_clip_lo_mas_barato', async () => {
    montar();
    pintar();
    expect(screen.getByRole('button', { name: 'Videos' })).toHaveAttribute('aria-pressed', 'true');
    expect(botonOpcion()).toHaveTextContent('Un video corto ✦ ' + clip.video_8s);
    await screen.findByText('La historia del café');
  });

  it('inicio.caja.precios_de_tarifas_json', async () => {
    montar();
    pintar();
    const d = Object.values(video.por_duracion);
    const rango = `${Math.min(...d)}–${Math.max(...d)}`;
    await userEvent.click(botonOpcion());
    const opciones = screen.getAllByRole('option').map(o => o.textContent);
    expect(opciones[0]).toContain('Un video corto✦ ' + clip.video_8s);
    expect(opciones[1]).toContain('Creador de cuentos✦ ' + rango);
    expect(opciones[2]).toContain('Crea tu historia✦ ' + rango);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Imágenes' }));
    await userEvent.click(botonOpcion());
    for (const o of screen.getAllByRole('option')) expect(o).toHaveTextContent('✦ ' + video.imagen);
  });

  it('inicio.caja.cada_opcion_lleva_a_su_destino_con_su_modo', async () => {
    montar();
    pintar();
    await userEvent.type(caja(), '  un gato en la luna  ');
    const casos: Array<[string, string | null, string]> = [
      ['Un video corto', null, '/clip.html?brief=un+gato+en+la+luna'],
      ['Creador de cuentos', null, '/crear.html?brief=un+gato+en+la+luna&modo=investigacion'],
      ['Crea tu historia', null, '/crear.html?brief=un+gato+en+la+luna&modo=idea'],
      ['Crear una imagen', 'Imágenes', '/imagenes.html?prompt=un+gato+en+la+luna'],
      ['Editar una imagen', 'Imágenes', '/imagenes.html?prompt=un+gato+en+la+luna&editar=1'],
    ];
    for (const [rotulo, familia, url] of casos) {
      if (familia) await userEvent.click(screen.getByRole('button', { name: familia }));
      await elegirOpcion(rotulo);
      await userEvent.click(enviar());
      expect(ir).toHaveBeenLastCalledWith(url);
    }
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
    await userEvent.click(screen.getByRole('button', { name: 'Imágenes' }));
    expect(screen.getByRole('button', { name: 'Imágenes' })).toHaveAttribute('aria-pressed', 'true');
    expect(botonOpcion()).toHaveTextContent('Crear una imagen');
  });
});

describe('los tres caminos', () => {
  it('inicio.caminos.solo_con_las_cuatro_listas_bien_y_vacias', async () => {
    montar({ proyectos: [] });
    const { unmount } = pintar();
    expect(await screen.findByRole('heading', { name: 'Tu primer video, en tres caminos' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Mis proyectos' })).toBeNull();
    unmount();
    // una lista que falló no cuenta como vacía
    montar({ proyectos: [], imagenes: null });
    const { unmount: fuera } = pintar();
    expect(await screen.findByRole('heading', { name: 'Mis proyectos' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /tres caminos/ })).toBeNull();
    fuera();
    montar({ proyectos: [], ediciones: null });
    pintar();
    expect(await screen.findByRole('heading', { name: 'Mis proyectos' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /tres caminos/ })).toBeNull();
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
    expect(await screen.findByText(/No pudimos traer tus proyectos/)).toBeInTheDocument();
    // no se concluye que es alguien nuevo
    expect(screen.queryByRole('heading', { name: /tres caminos/ })).toBeNull();
    red = true;
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('La historia del café')).toBeInTheDocument();
    expect(screen.queryByText(/No pudimos traer tus proyectos/)).toBeNull();
  });

  it('inicio.proyectos.cada_tarjeta_lleva_a_crear', async () => {
    montar({ proyectos: [P1, P2], slots: 3 });
    pintar();
    expect(await screen.findByRole('link', { name: 'La historia del café' })).toHaveAttribute('href', '/crear.html?p=p1');
    expect(screen.getByText('2 de 3 slots')).toBeInTheDocument();
    expect(screen.getByText('lista')).toBeInTheDocument();
    expect(screen.getByText('produciéndose…')).toBeInTheDocument();
  });

  it('inicio.proyectos.nueva_pelicula_solo_si_hay_slot', async () => {
    montar({ proyectos: [P1, P2], slots: 2 });
    const { unmount } = pintar();
    await screen.findByText('La historia del café');
    expect(screen.queryByRole('button', { name: 'Nueva película' })).toBeNull();
    unmount();
    montar({ proyectos: [P1], slots: null });
    pintar();
    expect(await screen.findByText('1 activos · slots ilimitados')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Nueva película' }));
    expect(caja()).toHaveFocus();
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

  it('inicio.imagenes.cinco_y_ver_todas', async () => {
    montar({ imagenes: [1, 2, 3, 4, 5, 6, 7].map(img) });
    pintar();
    const ver = await screen.findByRole('button', { name: 'Ver todas (7)' });
    expect(screen.getAllByRole('link', { name: /Abrir tu imagen/ })).toHaveLength(5);
    expect(ver).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(ver);
    expect(screen.getAllByRole('link', { name: /Abrir tu imagen/ })).toHaveLength(7);
    expect(screen.getByRole('button', { name: 'Ver menos' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('inicio.imagenes.cada_una_abre_para_editar_y_la_rota_no_deja_icono', async () => {
    montar({ imagenes: [{ ...img(1), nombre: 'mi foto&1.jpg' }] });
    const { container } = pintar();
    const enlace = await screen.findByRole('link', { name: /Abrir tu imagen/ });
    expect(enlace).toHaveAttribute('href', '/imagenes.html?img=mi%20foto%261.jpg');
    expect(screen.getByRole('link', { name: 'Nueva imagen' })).toHaveAttribute('href', '/imagenes.html');
    const im = enlace.querySelector('img')!;
    expect(im).toHaveAttribute('loading', 'lazy');
    fireEvent.error(im);
    expect(container.querySelector('a[href^="/imagenes.html?img"] img')).toBeNull();
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

  it('inicio.listas.orden_proyectos_imagenes_ediciones', async () => {
    montar({ imagenes: [img(1)], ediciones: [ED] });
    pintar();
    await screen.findByRole('heading', { name: 'Mis ediciones' });
    const titulos = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent);
    expect(titulos.filter(t => t?.startsWith('Mis '))).toEqual(['Mis proyectos', 'Mis imágenes', 'Mis ediciones']);
  });

  it('inicio.listas.textos_del_server_como_texto', async () => {
    const malo = '<img src=x onerror=alert(1)>';
    montar({
      proyectos: [{ ...P1, brief: malo, miniatura: null, miniatura_alt: null }, { ...ARCH, brief: malo }],
      ediciones: [{ ...ED, nombre: malo }],
    });
    const { container } = pintar();
    expect(await screen.findAllByText(malo)).toHaveLength(3);
    expect(container.querySelector('img[src="x"]')).toBeNull();
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
  it('inicio.marco.version_anterior', async () => {
    montar();
    pintar();
    expect(screen.getByRole('link', { name: 'Usar la versión anterior' })).toHaveAttribute('href', '/ui/clasica?pantalla=inicio');
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

  it('una película que no está lista abre su progreso: no hay reproductor al que agrandarse', async () => {
    montar({ proyectos: [{ ...P1, estado: 'produciendo' }] });
    pintar();
    fireEvent.click(await screen.findByRole('link', { name: 'La historia del café' }));
    expect(miniaturaQueLlega('p1')).toBeNull();
  });
});
