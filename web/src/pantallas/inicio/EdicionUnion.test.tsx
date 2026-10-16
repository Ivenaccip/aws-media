// «Edición» con VARIOS videos (E2), como COMPORTAMIENTO: el menú del «+», la cola de subida de uno en uno, elegir de Mis creaciones, la
// lista de la unión con su orden, y lo que el contrato pide del dinero (la clave del pedido, el precio que solo sale del servidor, un
// cuerpo sin créditos ni keys). Cada nombre que empieza por su ID es un invariante del registro (tests/test_migracion_ui.py).
//
// Nada de esto gasta dinero: el servidor (web/src/prueba/edicion.ts), la subida a S3 (XHR) y el cobro son dobles.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cotizacion,
  cotizacionBloqueada,
  diferida,
  EXITO,
  LANZADO,
  LIMITES,
  montar,
  ponerXhrFalso,
  TEXTO,
  TEXTO_FORMATOS,
  ultimoXhr,
  video,
  XhrFalso,
} from '../../prueba/edicion';
import { json, llamadas, oirCobros, ponerAvisos, ponerMonedero, sinRed } from '../../prueba/servidor';
import { Caja } from './Caja';
import { AVISO_OCUPADO, huecoDe, IDEAS_EDICION, IDEAS_UNION } from './edicion';
import type { Cotizacion, VideoElegible } from './envio';
import { ERROR_DE_RED_AL_SUBIR } from './useEdicion';

let ir: ReturnType<typeof vi.fn<(url: string) => void>>;

beforeEach(() => {
  vi.unstubAllGlobals();
  ponerXhrFalso();
  ir = vi.fn<(url: string) => void>();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  history.replaceState(null, '', '/estudio/inicio/');
});

afterEach(() => {
  vi.useRealTimers();
  delete window.monedero;
});

const pintar = (props: Partial<React.ComponentProps<typeof Caja>> = {}) => render(<Caja ir={ir} {...props} />);
const entrada = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;
const campo = () => screen.getByRole('textbox', { name: 'Cuéntale a la IA qué quieres' });
const botonIniciar = () => screen.getByRole('button', { name: /^(Iniciar|Subiendo|Calculando|Iniciando)/ });
const botonMas = () => screen.getByRole('button', { name: /^(Agregar el video que quieres editar|Agregar otro video|Agregar el video largo|Cambiar el video)$/ });
const chipModo = () => screen.getByRole('button', { name: 'Editar' });
const riel = () => within(screen.getByRole('group', { name: 'Qué quieres crear' }));
const dicho = (a: ReturnType<typeof ponerAvisos>) => a.mostrar.mock.calls.map(c => ({ texto: c[0], ...c[1] }));
const cuerpoDe = (f: ReturnType<typeof montar>, ruta: string, n = 0) => JSON.parse(llamadas(f, ruta)[n]![1]!.body as string) as Record<string, unknown>;
const pedidosA = (f: ReturnType<typeof montar>, ruta: string) => llamadas(f, ruta).length;
const CLAVE_DE_PEDIDO = expect.stringMatching(/^[0-9a-f]{32}$/);

async function irAEdicion() {
  await userEvent.click(riel().getByRole('button', { name: 'Edición' }));
}

/** La lista de la unión: sus filas (`li`) con el texto que se lee de cada una. */
const filas = () => within(screen.getByRole('list', { name: 'Orden de los videos' })).getAllByRole('listitem');
const nombresEnOrden = () => filas().map(li => li.querySelector('b')!.textContent);

/** Termina el PUT que está en el aire: confirma y, si era el último de la cola, pide el precio. */
async function terminarSubida() {
  await act(async () => {
    ultimoXhr().terminar();
  });
}

/** Elige varios archivos a la vez y espera a que salga el PUT del primero (los demás esperan su turno). */
async function subirVarios(archivos: File[]) {
  const antes = XhrFalso.todos.length;
  await userEvent.upload(entrada(), archivos);
  await waitFor(() => expect(XhrFalso.todos).toHaveLength(antes + 1));
}

/** Termina las `n` subidas de la cola, una tras otra: cada una empieza cuando termina la de antes. */
async function terminarCola(n: number, desde = XhrFalso.todos.length - 1) {
  for (let i = 0; i < n; i++) {
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(desde + i + 1));
    await terminarSubida();
  }
}

/** Sube `nombres` y deja la caja con todos listos y su precio. */
async function conVideosSubidos(nombres: string[]) {
  await subirVarios(nombres.map(n => video(n)));
  await terminarCola(nombres.length);
  await waitFor(() => expect(botonIniciar().textContent).toMatch(/^Iniciar/));
}

// --- «Mis creaciones» -------------------------------------------------------------------------------------------------------------

let n = 0;
function elegible(sobre: Partial<VideoElegible> = {}): VideoElegible {
  n += 1;
  return {
    ref: `proyecto:gen-${n}`,
    tipo: 'pelicula',
    titulo: `Video ${n}`,
    duracion_s: 300,
    formato: 'horizontal',
    fecha: '2026-10-02T15:04:05+00:00',
    miniatura: null,
    video: null,
    con_transcript: true,
    audio: true,
    bytes: 50_000_000,
    es_copia: false,
    copia_de: [],
    motivo: null,
    ...sobre,
  };
}

/** Un `cotizar` que dice lo mismo que la lista de Mis creaciones (misma duración y formato), con el precio y el bloqueo que se pida. */
const cotizarComo =
  (lista: VideoElegible[], sobre: Partial<Cotizacion> = {}) =>
  (refs: string[]) => {
    const vistos = refs.map(ref => lista.find(v => v.ref === ref));
    const total = vistos.reduce((a, v) => a + (v?.duracion_s ?? 724), 0);
    return cotizacion(refs, {
      creditos: 2,
      desglose: { edicion: 2, transcripcion: 0 },
      duracion_total_s: total,
      videos: refs.map((ref, i) => ({
        ref,
        tipo: vistos[i]?.tipo ?? 'edicion',
        titulo: vistos[i]?.titulo ?? ref,
        duracion_s: vistos[i]?.duracion_s ?? 724,
        formato: vistos[i]?.formato ?? 'horizontal',
        ancho: 1280,
        alto: 720,
        audio: true,
        bytes: vistos[i]?.bytes ?? 1,
        con_transcript: true,
        se_transcribe: false,
      })),
      ...sobre,
    });
  };

/** Abre la hoja desde el menú del «+», marca esos títulos (en ese orden) y pulsa «Usar». */
async function elegirDeMisCreaciones(titulos: string[]) {
  await userEvent.click(botonMas());
  await userEvent.click(screen.getByRole('menuitem', { name: /Elegir de Mis creaciones/ }));
  const hoja = within(await screen.findByRole('dialog', { name: 'Agregar videos' }));
  await hoja.findByRole('list', { name: 'Tus videos' });
  for (const t of titulos) await userEvent.click(hoja.getByRole('button', { name: new RegExp('^' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ',') }));
  await userEvent.click(hoja.getByRole('button', { name: /^Usar/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

describe('el menú del «+»', () => {
  it('inicio.union.el_mas_abre_un_menu_con_dos_opciones_y_se_porta_como_el_de_imagen', async () => {
    const f = montar();
    pintar();
    await irAEdicion();
    const mas = botonMas();
    expect(mas).toHaveAccessibleName('Agregar el video que quieres editar');
    expect(mas).toHaveAttribute('aria-haspopup', 'menu');
    expect(mas).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
    // abrirlo no pide nada a la red
    await userEvent.click(mas);
    const menu = screen.getByRole('menu', { name: 'Agregar videos' });
    expect(mas).toHaveAttribute('aria-expanded', 'true');
    expect(f).not.toHaveBeenCalled();
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map(i => i.querySelector('b')!.textContent)).toEqual(['Subir de tu computadora', 'Elegir de Mis creaciones']);
    expect(items[0]).toHaveTextContent('MP4, MOV o M4V, hasta 90 minutos en total');
    expect(items[1]).toHaveTextContent('Videos que ya hiciste con IA: elige uno o varios');
    expect(within(menu).getByText('También puedes arrastrar el video a la caja.')).toBeInTheDocument();
    // cada opción mide al menos 56 px y el foco cae en la primera
    for (const i of items) expect(i.className.split(/\s+/)).toContain('min-h-14');
    expect(items[0]).toHaveFocus();
    // flechas, Inicio y Fin recorren y dan la vuelta
    await userEvent.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(items[1]).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(items[1]).toHaveFocus();
    // Esc cierra y el foco vuelve al «+»
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(mas).toHaveFocus();
    expect(mas).toHaveAttribute('aria-expanded', 'false');
    // un clic fuera cierra; el segundo clic en el «+» también
    await userEvent.click(mas);
    await userEvent.click(campo());
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(mas);
    await userEvent.click(mas);
    expect(screen.queryByRole('menu')).toBeNull();
    // Tab lo cierra y el foco sigue desde el «+» (al chip «Editar»), no se pierde en <body>
    await userEvent.click(mas);
    await userEvent.keyboard('{Tab}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.body).not.toHaveFocus();
    expect(chipModo()).toHaveFocus();
    expect(f).not.toHaveBeenCalled(); // nada de esto pidió nada
  });

  it('«Subir de tu computadora» abre el selector de archivos, y «Elegir de Mis creaciones» abre la hoja y pide la lista UNA vez', async () => {
    const f = montar({ elegibles: () => json({ videos: [elegible()], limites: LIMITES }) });
    pintar();
    await irAEdicion();
    const clic = vi.spyOn(entrada(), 'click');
    await userEvent.click(botonMas());
    await userEvent.click(screen.getByRole('menuitem', { name: /Subir de tu computadora/ }));
    expect(clic).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(entrada()).toHaveAttribute('multiple');
    expect(pedidosA(f, '/api/edicion/elegibles')).toBe(0);
    await userEvent.click(botonMas());
    await userEvent.click(screen.getByRole('menuitem', { name: /Elegir de Mis creaciones/ }));
    const hoja = screen.getByRole('dialog', { name: 'Agregar videos' });
    expect(screen.queryByRole('menu')).toBeNull();
    await within(hoja).findByRole('list', { name: 'Tus videos' });
    expect(llamadas(f, '/api/edicion/elegibles', 'GET')).toHaveLength(1);
  });

  it('inicio.union.el_mas_ocupado_avisa_y_no_abre_el_menu', async () => {
    const avisos = ponerAvisos();
    montar();
    pintar();
    await irAEdicion();
    await subirVarios([video('uno.mp4')]);
    expect(botonMas()).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(botonMas());
    expect(screen.queryByRole('menu')).toBeNull();
    expect(dicho(avisos).at(-1)).toEqual({ texto: AVISO_OCUPADO, tipo: 'mal', clave: 'caja' });
    expect(AVISO_OCUPADO).toBe('Ya hay un trabajo en curso. Cuando termine puedes empezar otro.');
  });

  it('inicio.union.con_dos_o_mas_videos_el_menu_se_abre_hacia_arriba_y_el_mas_dice_agregar_otro_video', async () => {
    montar();
    pintar();
    await irAEdicion();
    await conVideosSubidos(['uno.mp4']);
    expect(botonMas()).toHaveAccessibleName('Agregar otro video');
    await userEvent.click(botonMas());
    // con UN video la caja es baja: el menú se abre hacia abajo, como siempre
    expect(screen.getByRole('menu').className).toContain('top-[calc(100%+8px)]');
    await userEvent.keyboard('{Escape}');
    await subirVarios([video('dos.mp4')]);
    await terminarCola(1);
    await waitFor(() => expect(botonIniciar().textContent).toMatch(/^Iniciar/));
    await userEvent.click(botonMas());
    // con dos o más la caja ya es alta: se abre hacia arriba para no salirse de la pantalla
    const menu = screen.getByRole('menu');
    expect(menu.className).toContain('bottom-[calc(100%+8px)]');
    expect(menu.className).not.toContain('top-[calc(100%+8px)]');
    // y mide lo que el de imagen: nunca más ancho que la pantalla menos sus márgenes
    expect(menu.className).toContain('w-[min(340px,calc(100vw-48px))]');
  });

  it('inicio.union.subir_de_tu_computadora_se_apaga_con_12_videos_o_90_minutos_y_dice_por_que', async () => {
    const doce = Array.from({ length: 12 }, (_, i) => elegible({ titulo: `Corto ${i + 1}`, duracion_s: 10 }));
    montar({ elegibles: () => json({ videos: doce, limites: LIMITES }), cotizar: cotizarComo(doce) });
    pintar();
    await irAEdicion();
    await elegirDeMisCreaciones(doce.map(v => v.titulo));
    expect(filas()).toHaveLength(12);
    const clic = vi.spyOn(entrada(), 'click');
    await userEvent.click(botonMas());
    const subir = screen.getByRole('menuitem', { name: /Subir de tu computadora/ });
    expect(subir).toHaveAttribute('aria-disabled', 'true');
    expect(subir).toHaveTextContent('Ya tienes 12 videos: es el máximo.');
    expect(subir).not.toHaveTextContent('MP4, MOV o M4V');
    await userEvent.click(subir);
    expect(clic).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument(); // apagado: dice por qué y el menú se queda
    // «Elegir de Mis creaciones» sigue disponible: la hoja explica lo que ya no cabe
    expect(screen.getByRole('menuitem', { name: /Elegir de Mis creaciones/ })).not.toHaveAttribute('aria-disabled');
  });

  it('inicio.union.subir_de_tu_computadora_se_apaga_al_sumar_90_minutos', async () => {
    const dos = [elegible({ titulo: 'Mitad A', duracion_s: 2700 }), elegible({ titulo: 'Mitad B', duracion_s: 2700 })];
    montar({ elegibles: () => json({ videos: dos, limites: LIMITES }), cotizar: cotizarComo(dos) });
    pintar();
    await irAEdicion();
    await elegirDeMisCreaciones(['Mitad A']);
    await userEvent.click(botonMas());
    expect(screen.getByRole('menuitem', { name: /Subir de tu computadora/ })).not.toHaveAttribute('aria-disabled');
    await userEvent.keyboard('{Escape}');
    await elegirDeMisCreaciones(['Mitad B']);
    await waitFor(() => expect(botonIniciar().textContent).toMatch(/^Iniciar/));
    await userEvent.click(botonMas());
    const subir = screen.getByRole('menuitem', { name: /Subir de tu computadora/ });
    expect(subir).toHaveAttribute('aria-disabled', 'true');
    expect(subir).toHaveTextContent('Ya llegaste a 90 minutos en total: no caben más videos.');
  });
});

describe('subir varios archivos: la cola de uno en uno', () => {
  it('inicio.union.subir_varios_archivos_van_en_cola_de_uno_en_uno_con_su_progreso_y_cotiza_al_terminar_la_cola', async () => {
    const f = montar();
    pintar();
    await irAEdicion();
    await subirVarios([video('uno.mp4'), video('dos.mov', ''), video('tres.m4v', '')]);
    // una sola subida a la vez: el primero sube, los otros dos esperan su turno
    expect(XhrFalso.todos).toHaveLength(1);
    expect(nombresEnOrden()).toEqual(['uno.mp4', 'dos.mov', 'tres.m4v']);
    expect(screen.getAllByText('En cola')).toHaveLength(2);
    expect(screen.getByText('Subiendo… 0 %. No cierres esta pestaña.')).toBeInTheDocument();
    act(() => ultimoXhr().avanzar(412_000_000, 824_000_000));
    expect(screen.getByRole('progressbar', { name: 'Subiendo “uno.mp4”' })).toHaveAttribute('aria-valuenow', '50');
    expect(botonIniciar()).toHaveTextContent(/^Subiendo…$/);
    expect(screen.getByText('Cuando termine de subir calculamos el precio. Hasta entonces no se cobra nada.')).toBeInTheDocument();
    expect(pedidosA(f, '/api/edicion/cotizar')).toBe(0);
    // termina la primera: se confirma y EMPIEZA la segunda (nunca dos a la vez, nunca un precio a medias)
    await terminarSubida();
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(2));
    expect(cuerpoDe(f, '/api/media/confirmar')).toEqual({ proyecto: 'uno', key: 'videos/uno/subidas/uno.mp4' });
    expect(screen.getAllByText('En cola')).toHaveLength(1);
    expect(pedidosA(f, '/api/edicion/cotizar')).toBe(0);
    await terminarSubida();
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(3));
    expect(pedidosA(f, '/api/edicion/cotizar')).toBe(0);
    await terminarSubida();
    // con la cola vacía y nada subiendo, UN solo precio, con las tres referencias en el orden de la cola
    await screen.findByRole('button', { name: 'Iniciar ✦ 8' });
    expect(pedidosA(f, '/api/edicion/cotizar')).toBe(1);
    expect(cuerpoDe(f, '/api/edicion/cotizar')).toEqual({ videos: ['proyecto:uno', 'proyecto:dos', 'proyecto:tres'] });
    // los permisos de subida salieron de uno en uno, en ese orden
    expect(llamadas(f, '/api/media/presign').map(c => (JSON.parse(String(c[1]!.body)) as { proyecto: string }).proyecto)).toEqual(['uno', 'dos', 'tres']);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText('En cola')).toBeNull();
  });

  it('inicio.union.cada_subida_confirmada_pasa_a_ser_el_proyecto_con_su_nombre_y_los_repetidos_estrenan_nombre', async () => {
    // dos archivos que se llaman igual no son el mismo proyecto: el segundo se sube con su nombre alterno
    const f = montar({
      subidas: p => (p === 'video' ? [{ key: 'videos/video/subidas/video.mp4' }] : []),
    });
    pintar();
    await irAEdicion();
    await subirVarios([video('video.mp4'), video('otro.mp4')]);
    await terminarCola(2);
    await screen.findByRole('button', { name: 'Iniciar ✦ 8' });
    const nombres = llamadas(f, '/api/media/presign').map(c => (JSON.parse(String(c[1]!.body)) as { proyecto: string }).proyecto);
    expect(nombres[0]).toMatch(/^video-[0-9a-f]{4}$/); // «video» ya era un proyecto tuyo con video
    expect(nombres[1]).toBe('otro');
    expect(cuerpoDe(f, '/api/edicion/cotizar')).toEqual({ videos: [`proyecto:${nombres[0]}`, 'proyecto:otro'] });
  });

  it('inicio.union.dos_archivos_con_el_mismo_nombre_en_la_misma_tanda_no_son_el_mismo_proyecto', async () => {
    const f = montar();
    pintar();
    await irAEdicion();
    // el segundo se llama igual que el primero y el servidor aún no sabe del primero cuando se pregunta: la caja ya lo sabe
    await subirVarios([video('toma.mp4'), video('toma.mov', '')]);
    await terminarCola(2);
    await screen.findByRole('button', { name: 'Iniciar ✦ 8' });
    const nombres = llamadas(f, '/api/media/presign').map(c => (JSON.parse(String(c[1]!.body)) as { proyecto: string }).proyecto);
    expect(nombres).toHaveLength(2);
    expect(nombres[0]).toBe('toma');
    expect(nombres[1]).toMatch(/^toma-[0-9a-f]{4}$/);
    expect(new Set((cuerpoDe(f, '/api/edicion/cotizar').videos as string[])).size).toBe(2);
  });

  it('inicio.union.un_archivo_que_falla_sale_y_la_cola_sigue', async () => {
    const avisos = ponerAvisos();
    const f = montar();
    pintar();
    await irAEdicion();
    await subirVarios([video('uno.mp4'), video('dos.mp4'), video('tres.mp4')]);
    // el primero falla a mitad de camino: sale de la caja, se dice por qué, y el segundo empieza
    await act(async () => {
      ultimoXhr().terminar(403);
    });
    // el aviso dice CUÁL se perdió: con varios archivos en la cola, «La subida falló» a secas no dice de quién
    await waitFor(() => expect(dicho(avisos).at(-1)).toEqual({ texto: '“uno.mp4”: La subida a la nube falló (403) — intenta de nuevo.', tipo: 'mal', clave: 'caja' }));
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(2));
    expect(nombresEnOrden()).toEqual(['dos.mp4', 'tres.mp4']);
    expect(pedidosA(f, '/api/media/confirmar')).toBe(0);
    await terminarSubida();
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(3));
    await terminarSubida();
    await screen.findByRole('button', { name: 'Iniciar ✦ 8' });
    // el precio es de los que SÍ subieron
    expect(cuerpoDe(f, '/api/edicion/cotizar')).toEqual({ videos: ['proyecto:dos', 'proyecto:tres'] });
  });

  it('inicio.union.si_se_corta_la_conexion_dice_a_que_porcentaje_que_no_se_cobro_nada_y_como_seguir', async () => {
    const avisos = ponerAvisos();
    montar();
    pintar();
    await irAEdicion();
    await subirVarios([video('uno.mp4'), video('dos.mp4')]);
    act(() => ultimoXhr().avanzar(338_000_000, 824_000_000)); // 41 %
    const xhr = ultimoXhr();
    await act(async () => {
      xhr.fallar();
    });
    // el texto de nucleo/subida que esta frase completa sigue siendo ese (si cambia, esta prueba lo dice)
    expect(ERROR_DE_RED_AL_SUBIR).toBe('La subida falló — revisa tu conexión e intenta de nuevo.');
    await waitFor(() =>
      expect(dicho(avisos).at(-1)).toEqual({
        texto: 'Se perdió la conexión con “uno.mp4” a los 41 %. No se cobró nada. Vuelve a subirlo con el «+».',
        tipo: 'mal',
        clave: 'caja',
      }),
    );
    // la cola sigue con el que esperaba
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(2));
    // queda UNO: su tarjeta, no la lista de la unión
    expect(screen.queryByRole('list', { name: 'Orden de los videos' })).toBeNull();
    expect(screen.getByText('dos.mp4')).toBeInTheDocument();
  });

  it('inicio.union.si_fallan_dos_archivos_el_aviso_dice_cuales_y_el_segundo_no_pisa_al_primero', async () => {
    const avisos = ponerAvisos();
    montar();
    pintar();
    await irAEdicion();
    await subirVarios([video('uno.mp4'), video('dos.mp4'), video('tres.mp4')]);
    // «uno» falla con un 500 del almacenamiento
    await act(async () => {
      ultimoXhr().terminar(500);
    });
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(2));
    expect(dicho(avisos).at(-1)!.texto).toBe('“uno.mp4”: La subida a la nube falló (500) — intenta de nuevo.');
    // «dos» pierde la conexión al 41 %: el aviso suma el suyo en vez de pisar el de «uno» (la caja tiene UN solo canal de avisos)
    act(() => ultimoXhr().avanzar(338_000_000, 824_000_000));
    await act(async () => {
      ultimoXhr().fallar();
    });
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(3));
    expect(dicho(avisos).at(-1)).toEqual({
      texto: '“uno.mp4”: La subida a la nube falló (500) — intenta de nuevo. Se perdió la conexión con “dos.mp4” a los 41 %. No se cobró nada. Vuelve a subirlo con el «+».',
      tipo: 'mal',
      clave: 'caja',
    });
    // «tres» sí sube: lo que falló se queda dicho
    await terminarSubida();
    await screen.findByRole('button', { name: 'Iniciar ✦ 8' });
    expect(dicho(avisos).at(-1)!.texto).toContain('“uno.mp4”');
    // quitar lo que quedó limpia el aviso Y la cuenta: el próximo fallo habla solo de sí mismo (no arrastra los de antes)
    await userEvent.click(screen.getByRole('button', { name: 'Quitar este video' }));
    await subirVarios([video('cuatro.mp4')]);
    await act(async () => {
      ultimoXhr().terminar(403);
    });
    await waitFor(() => expect(dicho(avisos).at(-1)!.texto).toBe('“cuatro.mp4”: La subida a la nube falló (403) — intenta de nuevo.'));
  });

  it('si la instalación no sube videos, con varios archivos se dice UNA vez y sin el nombre de ninguno', async () => {
    const avisos = ponerAvisos();
    montar({ config: false });
    pintar();
    await irAEdicion();
    await userEvent.upload(entrada(), [video('uno.mp4'), video('dos.mp4'), video('tres.mp4')]);
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Orden de los videos' })).toBeNull());
    await waitFor(() => expect(dicho(avisos).at(-1)).toEqual({ texto: 'Subir videos no está disponible en esta instalación.', tipo: 'mal', clave: 'caja' }));
    expect(screen.queryByText('uno.mp4')).toBeNull();
    expect(XhrFalso.todos).toHaveLength(0);
  });

  it('inicio.union.quitar_la_que_sube_la_cancela_sin_error_ni_precio_y_la_cola_sigue_con_la_siguiente', async () => {
    const avisos = ponerAvisos();
    const f = montar();
    pintar();
    await irAEdicion();
    await subirVarios([video('uno.mp4'), video('dos.mp4'), video('tres.mp4')]);
    const primero = ultimoXhr();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar la subida de “uno.mp4”' }));
    expect(primero.abortado).toBe(true);
    // cancelar no es un error de nadie, no confirma nada y la siguiente empieza
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(2));
    expect(avisos.mostrar).not.toHaveBeenCalled();
    expect(pedidosA(f, '/api/media/confirmar')).toBe(0);
    expect(pedidosA(f, '/api/edicion/cotizar')).toBe(0);
    expect(nombresEnOrden()).toEqual(['dos.mp4', 'tres.mp4']);
    expect(botonMas()).toHaveFocus();
    // quitar una que espera su turno solo la saca de la cola: la que sube no se toca
    const sube = ultimoXhr();
    await userEvent.click(screen.getByRole('button', { name: 'Quitar “tres.mp4”' }));
    expect(sube.abortado).toBe(false);
    expect(screen.getByText('dos.mp4')).toBeInTheDocument();
    expect(screen.queryByText('tres.mp4')).toBeNull();
    await terminarSubida();
    await screen.findByRole('button', { name: 'Iniciar ✦ 8' });
    expect(cuerpoDe(f, '/api/edicion/cotizar')).toEqual({ videos: ['proyecto:dos'] });
    expect(XhrFalso.todos).toHaveLength(2); // «tres» nunca subió
  });

  it('inicio.union.mas_de_12_archivos_se_recortan_a_12_y_se_dice', async () => {
    const avisos = ponerAvisos();
    montar();
    pintar();
    await irAEdicion();
    await subirVarios(Array.from({ length: 13 }, (_, i) => video(`v${i + 1}.mp4`)));
    expect(filas()).toHaveLength(12);
    expect(screen.queryByText('v13.mp4')).toBeNull();
    expect(dicho(avisos).at(-1)).toEqual({ texto: 'Como mucho 12 videos.', tipo: 'mal', clave: 'caja' });
  });

  it('inicio.union.los_archivos_que_no_sirven_se_rechazan_uno_por_uno_con_su_motivo_y_los_demas_siguen', async () => {
    const avisos = ponerAvisos();
    const f = montar();
    pintar();
    await irAEdicion();
    // fireEvent: el selector ya filtra por tipo, pero se pueden soltar o forzar otros
    fireEvent.change(entrada(), { target: { files: [video('clase.avi', 'video/x-msvideo'), video('bueno.mp4'), video('vacio.mp4', 'video/mp4', 0)] } });
    expect(dicho(avisos).at(-1)).toEqual({
      texto: '«clase.avi» no se puede usar. Sirven: .mp4, .mov, .m4v. «vacio.mp4» está vacío.',
      tipo: 'mal',
      clave: 'caja',
    });
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    expect(llamadas(f, '/api/media/presign').map(c => JSON.parse(String(c[1]!.body)).archivo)).toEqual(['bueno.mp4']);
    await terminarSubida();
    await screen.findByRole('button', { name: 'Iniciar ✦ 8' });
    expect(cuerpoDe(f, '/api/edicion/cotizar')).toEqual({ videos: ['proyecto:bueno'] });
  });

  it('inicio.union.cambiar_de_familia_y_volver_no_pierde_la_lista_ni_la_cola', async () => {
    montar();
    pintar();
    await irAEdicion();
    await subirVarios([video('uno.mp4'), video('dos.mp4')]);
    act(() => ultimoXhr().avanzar(100_000_000, 824_000_000));
    const xhr = ultimoXhr();
    await userEvent.click(riel().getByRole('button', { name: 'Video' }));
    expect(screen.queryByRole('list', { name: 'Orden de los videos' })).toBeNull();
    // la cola sigue sola mientras la persona está en otra familia
    await terminarSubida();
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(2));
    expect(xhr.abortado).toBe(false);
    await terminarSubida();
    await irAEdicion();
    expect(nombresEnOrden()).toEqual(['uno.mp4', 'dos.mp4']);
    expect(await screen.findByRole('button', { name: 'Iniciar ✦ 8' })).toBeInTheDocument();
  });

  it('desmontar la caja a mitad de la cola cancela la subida y vacía la cola', async () => {
    const f = montar();
    const { unmount } = pintar();
    await irAEdicion();
    await subirVarios([video('uno.mp4'), video('dos.mp4')]);
    const xhr = ultimoXhr();
    unmount();
    expect(xhr.abortado).toBe(true);
    await new Promise(r => setTimeout(r, 40));
    expect(XhrFalso.todos).toHaveLength(1); // la segunda nunca arrancó
    expect(pedidosA(f, '/api/media/confirmar')).toBe(0);
    expect(pedidosA(f, '/api/edicion/cotizar')).toBe(0);
  });
});

describe('la caja con varios videos: la lista de la unión', () => {
  it('inicio.union.la_union_dice_cuantos_videos_y_cuanto_duran_con_una_fila_por_video_y_la_nota_en_plural', async () => {
    montar();
    pintar();
    await irAEdicion();
    await conVideosSubidos(['uno.mp4', 'dos.mp4', 'tres.mp4']);
    const grupo = screen.getByRole('group', { name: 'Videos que se unen' });
    // 3 × 12:04 = 36:12, tal como lo midió el servidor al cotizar
    expect(within(grupo).getByText('3 videos · 36:12')).toBeInTheDocument();
    expect(grupo).toHaveTextContent('3 videos · 36:12 · se unen en este orden');
    expect(within(grupo).getByText('3 videos · 36:12').tagName).toBe('B');
    expect(within(grupo).getByText('Se edita una copia. Tus originales se quedan como están.')).toBeInTheDocument();
    // una fila por video: su número (decorativo), su nombre y su meta en una línea
    const lista = filas();
    expect(lista).toHaveLength(3);
    expect(lista.map(li => li.firstElementChild!.textContent)).toEqual(['1', '2', '3']);
    expect(lista.map(li => li.firstElementChild!.getAttribute('aria-hidden'))).toEqual(['true', 'true', 'true']);
    expect(within(lista[0]!).getByText('12:04 · MP4 · 824 MB')).toBeInTheDocument();
    // ya no es la tarjeta de UN video
    expect(screen.queryByRole('button', { name: 'Quitar este video' })).toBeNull();
    expect(screen.queryByText('Se edita una copia. Tu original se queda como está.')).toBeNull();
    // cada fila mide al menos 44 px y sus tres botones, 44 × 44
    for (const li of lista) {
      expect(li.className.split(/\s+/)).toContain('min-h-14');
      for (const b of within(li).getAllByRole('button')) expect(b.className.split(/\s+/)).toContain('size-11');
    }
  });

  it('inicio.union.subir_y_bajar_cambian_el_orden_con_nombres_exactos_extremos_apagados_foco_en_su_boton_y_anuncio', async () => {
    const f = montar();
    pintar();
    await irAEdicion();
    await conVideosSubidos(['a.mp4', 'b.mp4', 'c.mp4']);
    const cotizaciones = pedidosA(f, '/api/edicion/cotizar');
    const subir = (n: string) => screen.getByRole('button', { name: `Subir “${n}”` });
    const bajar = (n: string) => screen.getByRole('button', { name: `Bajar “${n}”` });
    // los extremos: la primera no sube y la última no baja (apagadas pero enfocables, sin disabled)
    expect(subir('a.mp4')).toHaveAttribute('aria-disabled', 'true');
    expect(subir('a.mp4')).not.toBeDisabled();
    expect(bajar('c.mp4')).toHaveAttribute('aria-disabled', 'true');
    expect(subir('b.mp4')).not.toHaveAttribute('aria-disabled');
    expect(bajar('a.mp4')).not.toHaveAttribute('aria-disabled');
    await userEvent.click(subir('a.mp4'));
    expect(nombresEnOrden()).toEqual(['a.mp4', 'b.mp4', 'c.mp4']);
    // bajar «a»: queda en el lugar 2, el foco se queda en el MISMO botón y el lector oye dónde quedó
    await userEvent.click(bajar('a.mp4'));
    expect(nombresEnOrden()).toEqual(['b.mp4', 'a.mp4', 'c.mp4']);
    expect(bajar('a.mp4')).toHaveFocus();
    expect(screen.getByText('“a.mp4” ahora es el número 2 de 3.')).toBeInTheDocument();
    expect(screen.getByText('“a.mp4” ahora es el número 2 de 3.').closest('[role="status"]')).not.toBeNull();
    expect(filas().map(li => li.firstElementChild!.textContent)).toEqual(['1', '2', '3']);
    // subir «c» dos veces: llega al primer lugar y su «Subir» se apaga, con el foco intacto
    await userEvent.click(subir('c.mp4'));
    await userEvent.click(subir('c.mp4'));
    expect(nombresEnOrden()).toEqual(['c.mp4', 'b.mp4', 'a.mp4']);
    expect(subir('c.mp4')).toHaveFocus();
    expect(subir('c.mp4')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('“c.mp4” ahora es el número 1 de 3.')).toBeInTheDocument();
    // reordenar no cobra ni vuelve a cotizar: el orden no cambia ni el precio ni la validez
    expect(pedidosA(f, '/api/edicion/cotizar')).toBe(cotizaciones);
    expect(pedidosA(f, '/api/edicion/iniciar')).toBe(0);
    expect(screen.getByRole('button', { name: 'Iniciar ✦ 8' })).toBeInTheDocument();
  });

  it('inicio.union.lo_que_se_manda_es_el_orden_nuevo_y_mover_no_cobro_nada', async () => {
    ponerMonedero(100);
    const cobros = oirCobros();
    const f = montar({ iniciar: () => json({ ...LANZADO, n_videos: 3 }) });
    pintar();
    await irAEdicion();
    await conVideosSubidos(['a.mp4', 'b.mp4', 'c.mp4']);
    await userEvent.click(screen.getByRole('button', { name: 'Bajar “a.mp4”' }));
    await userEvent.click(screen.getByRole('button', { name: 'Subir “c.mp4”' }));
    expect(nombresEnOrden()).toEqual(['b.mp4', 'c.mp4', 'a.mp4']);
    expect(cobros).toHaveLength(0);
    // reordenar no es agregar ni quitar: el precio del conjunto no se vuelve a pedir (sigue siendo UNA sola cotización)
    expect(pedidosA(f, '/api/edicion/cotizar')).toBe(1);
    await userEvent.type(campo(), TEXTO);
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar ✦ 8' }));
    await waitFor(() => expect(pedidosA(f, '/api/edicion/iniciar')).toBe(1));
    expect(cuerpoDe(f, '/api/edicion/iniciar')).toEqual({
      pedido: CLAVE_DE_PEDIDO,
      videos: ['proyecto:b', 'proyecto:c', 'proyecto:a'],
      instruccion: TEXTO,
    });
    await waitFor(() => expect(cobros.map(c => c.costo)).toEqual([8]));
  });

  it('inicio.union.reordenar_no_hace_ninguna_peticion_ni_apaga_el_precio_ni_siquiera_un_instante', async () => {
    // el contrato dice que el orden NO cambia ni el precio ni la validez: Subir/Bajar nunca vuelven a cotizar. No basta con contar el
    // `cotizar` justo después del clic: uno que se pidiera tarde, o por otra ruta, pasaría. Se cuentan TODAS las peticiones, de cualquier
    // ruta, y se mira que el botón no pase por «Calculando…» (un `cotizar` nuevo lo apaga hasta que contesta)
    const f = montar();
    pintar();
    await irAEdicion();
    await conVideosSubidos(['a.mp4', 'b.mp4', 'c.mp4']);
    const peticiones = () => f.mock.calls.length;
    const antes = peticiones();
    const cotizaciones = pedidosA(f, '/api/edicion/cotizar');
    expect(botonIniciar()).toHaveTextContent('Iniciar ✦ 8');
    for (const [accion, nombre] of [['Bajar', 'a.mp4'], ['Subir', 'c.mp4'], ['Bajar', 'b.mp4'], ['Subir', 'a.mp4']] as const) {
      await userEvent.click(screen.getByRole('button', { name: `${accion} “${nombre}”` }));
      // en cuanto se mueve, SIN esperar nada: el precio sigue ahí, no «Calculando…»
      expect(botonIniciar()).toHaveTextContent('Iniciar ✦ 8');
      expect(screen.queryByRole('button', { name: /^Calculando/ })).toBeNull();
    }
    expect(nombresEnOrden()).toEqual(['c.mp4', 'a.mp4', 'b.mp4']);
    // y nada llega después: una petición que saliera con retraso caería aquí
    await act(async () => {
      await new Promise(r => setTimeout(r, 80));
    });
    expect(peticiones()).toBe(antes);
    expect(pedidosA(f, '/api/edicion/cotizar')).toBe(cotizaciones);
    expect(botonIniciar()).toHaveTextContent('Iniciar ✦ 8');
  });

  it('inicio.union.quitar_recorre_los_numeros_vuelve_a_cotizar_manda_el_foco_al_mas_y_con_uno_queda_su_tarjeta', async () => {
    const f = montar();
    pintar();
    await irAEdicion();
    await conVideosSubidos(['a.mp4', 'b.mp4', 'c.mp4']);
    expect(pedidosA(f, '/api/edicion/cotizar')).toBe(1);
    await userEvent.click(screen.getByRole('button', { name: 'Quitar “b.mp4”' }));
    expect(nombresEnOrden()).toEqual(['a.mp4', 'c.mp4']);
    expect(filas().map(li => li.firstElementChild!.textContent)).toEqual(['1', '2']);
    expect(botonMas()).toHaveFocus();
    // quitar cambia QUÉ hay en la caja: se vuelve a pedir el precio, con los que quedan
    await waitFor(() => expect(pedidosA(f, '/api/edicion/cotizar')).toBe(2));
    expect(cuerpoDe(f, '/api/edicion/cotizar', 1)).toEqual({ videos: ['proyecto:a', 'proyecto:c'] });
    await userEvent.click(screen.getByRole('button', { name: 'Quitar “a.mp4”' }));
    // con UNO queda su tarjeta de siempre, con la nota en singular
    expect(screen.queryByRole('list', { name: 'Orden de los videos' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Quitar este video' })).toBeInTheDocument();
    expect(screen.getByText('Se edita una copia. Tu original se queda como está.')).toBeInTheDocument();
    await waitFor(() => expect(pedidosA(f, '/api/edicion/cotizar')).toBe(3));
    expect(cuerpoDe(f, '/api/edicion/cotizar', 2)).toEqual({ videos: ['proyecto:c'] });
    // sin ninguno, no hay nada que cotizar
    await userEvent.click(screen.getByRole('button', { name: 'Quitar este video' }));
    expect(pedidosA(f, '/api/edicion/cotizar')).toBe(3);
    expect(botonIniciar()).toHaveTextContent(/^Iniciar$/);
  });

  it('inicio.union.desde_la_quinta_fila_la_lista_se_desplaza_por_dentro_con_alto_de_cuatro', async () => {
    const lista = Array.from({ length: 5 }, (_, i) => elegible({ titulo: `Peli ${i + 1}`, duracion_s: 60 }));
    montar({ elegibles: () => json({ videos: lista, limites: LIMITES }), cotizar: cotizarComo(lista) });
    pintar();
    await irAEdicion();
    await elegirDeMisCreaciones(['Peli 1', 'Peli 2', 'Peli 3', 'Peli 4']);
    const ul = () => screen.getByRole('list', { name: 'Orden de los videos' });
    expect(filas()).toHaveLength(4);
    expect(ul().className).not.toContain('overflow-y-auto');
    await elegirDeMisCreaciones(['Peli 5']);
    expect(filas()).toHaveLength(5);
    expect(ul().className.split(/\s+/)).toEqual(expect.arrayContaining(['max-h-[15.125rem]', 'overflow-y-auto']));
  });

  it('inicio.union.con_dos_o_mas_videos_la_pista_suma_la_idea_de_unir_como_primera', async () => {
    // con «reducir movimiento» la pista se queda en la primera idea: la prueba no depende de cuánto tarde
    vi.stubGlobal('matchMedia', (consulta: string) => ({
      matches: consulta.includes('prefers-reduced-motion'),
      media: consulta,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const lista = [elegible({ titulo: 'Uno' }), elegible({ titulo: 'Dos' })];
    montar({ elegibles: () => json({ videos: lista, limites: LIMITES }), cotizar: cotizarComo(lista) });
    pintar();
    await irAEdicion();
    expect(IDEAS_UNION[0]).toBe('Únelos en este orden y quita los silencios');
    expect(IDEAS_UNION.slice(1)).toEqual([...IDEAS_EDICION]);
    expect(campo()).toHaveAttribute('placeholder', huecoDe(IDEAS_EDICION[0]));
    await elegirDeMisCreaciones(['Uno']);
    // con UN video, igual que siempre
    expect(campo()).toHaveAttribute('placeholder', huecoDe(IDEAS_EDICION[0]));
    await elegirDeMisCreaciones(['Dos']);
    expect(campo()).toHaveAttribute('placeholder', huecoDe('Únelos en este orden y quita los silencios'));
    // el motor no hace fundidos: la pista no promete lo que no hay
    expect(campo().getAttribute('placeholder')).not.toMatch(/fundido/i);
    await userEvent.click(screen.getByRole('button', { name: 'Quitar “Dos”' }));
    expect(campo()).toHaveAttribute('placeholder', huecoDe(IDEAS_EDICION[0]));
  });
});

describe('elegir de Mis creaciones', () => {
  it('inicio.union.las_creaciones_elegidas_se_agregan_al_final_sin_repetir_y_el_precio_sale_del_servidor', async () => {
    const lista = [
      elegible({ titulo: 'La peli', duracion_s: 30.04 }),
      elegible({ titulo: 'El clip', tipo: 'clip', ref: 'clip:clip-20261008-101500-ab12cd', duracion_s: 8 }),
      elegible({ titulo: 'El cuento', tipo: 'cuento', duracion_s: 45 }),
    ];
    const f = montar({ elegibles: () => json({ videos: lista, limites: LIMITES }), cotizar: cotizarComo(lista) });
    pintar();
    await irAEdicion();
    // primero El clip y luego La peli: entran en el orden en que se marcaron
    await elegirDeMisCreaciones(['El clip', 'La peli']);
    expect(nombresEnOrden()).toEqual(['El clip', 'La peli']);
    expect(filas().map(li => li.querySelector('small')!.textContent)).toEqual(['Clip · 0:08 · 16:9', 'Película · 0:30 · 16:9']);
    await screen.findByRole('button', { name: 'Iniciar ✦ 2' });
    expect(cuerpoDe(f, '/api/edicion/cotizar')).toEqual({ videos: ['clip:clip-20261008-101500-ab12cd', lista[0]!.ref] });
    // agregar otro: va AL FINAL (no reemplaza), y lo que ya está en la caja no se puede volver a marcar
    await userEvent.click(botonMas());
    await userEvent.click(screen.getByRole('menuitem', { name: /Elegir de Mis creaciones/ }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Agregar videos' }));
    await hoja.findByRole('list', { name: 'Tus videos' });
    expect(hoja.getByRole('button', { name: /^El clip.*no disponible: En la caja$/ })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(hoja.getByRole('button', { name: /^El cuento,/ }));
    // la numeración sigue la cuenta de la caja: con 2 en la caja, el primero marcado es el 3
    expect(hoja.getByRole('button', { name: /^El cuento.*elegido, número 3$/ })).toBeInTheDocument();
    await userEvent.click(hoja.getByRole('button', { name: 'Usar este video' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(nombresEnOrden()).toEqual(['El clip', 'La peli', 'El cuento']);
    expect(botonMas()).toHaveFocus();
    await waitFor(() => expect(pedidosA(f, '/api/edicion/cotizar')).toBe(2));
    expect(cuerpoDe(f, '/api/edicion/cotizar', 1)).toEqual({ videos: ['clip:clip-20261008-101500-ab12cd', lista[0]!.ref, lista[2]!.ref] });
  });

  it('inicio.union.la_hoja_mezcla_lo_elegido_con_lo_subido_y_manda_las_referencias_en_el_orden_de_la_caja', async () => {
    ponerMonedero(100);
    const lista = [elegible({ titulo: 'La peli', duracion_s: 300 })];
    const f = montar({ elegibles: () => json({ videos: lista, limites: LIMITES }), cotizar: cotizarComo(lista) });
    pintar();
    await irAEdicion();
    await elegirDeMisCreaciones(['La peli']);
    await subirVarios([video('mi-video.mp4')]);
    await terminarCola(1);
    await waitFor(() => expect(botonIniciar().textContent).toMatch(/^Iniciar/));
    await userEvent.type(campo(), TEXTO);
    await userEvent.click(screen.getByRole('button', { name: /^Iniciar ✦/ }));
    await waitFor(() => expect(pedidosA(f, '/api/edicion/iniciar')).toBe(1));
    expect(cuerpoDe(f, '/api/edicion/iniciar').videos).toEqual([lista[0]!.ref, 'proyecto:mi-video']);
  });

  it('inicio.union.mi_computadora_de_la_hoja_agrega_primero_lo_marcado_y_luego_sube_los_archivos', async () => {
    const lista = [elegible({ titulo: 'La peli' }), elegible({ titulo: 'Otra peli' })];
    const f = montar({ elegibles: () => json({ videos: lista, limites: LIMITES }), cotizar: cotizarComo(lista) });
    pintar();
    await irAEdicion();
    const clic = vi.spyOn(entrada(), 'click');
    await userEvent.click(botonMas());
    await userEvent.click(screen.getByRole('menuitem', { name: /Elegir de Mis creaciones/ }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Agregar videos' }));
    await hoja.findByRole('list', { name: 'Tus videos' });
    await userEvent.click(hoja.getByRole('button', { name: /^La peli,/ }));
    await userEvent.click(hoja.getByRole('tab', { name: 'Mi computadora' }));
    // «Elegir archivos…» no pierde lo marcado: se agrega primero, y luego se abre el selector
    await userEvent.click(hoja.getByRole('button', { name: 'Elegir archivos…' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(clic).toHaveBeenCalledTimes(1);
    expect(screen.getByText('La peli')).toBeInTheDocument();
    expect(botonMas()).toHaveFocus();
    // y soltar archivos en la hoja hace lo mismo: lo marcado primero, los archivos detrás
    await userEvent.click(botonMas());
    await userEvent.click(screen.getByRole('menuitem', { name: /Elegir de Mis creaciones/ }));
    const hoja2 = within(await screen.findByRole('dialog', { name: 'Agregar videos' }));
    await hoja2.findByRole('list', { name: 'Tus videos' });
    await userEvent.click(hoja2.getByRole('button', { name: /^Otra peli,/ }));
    await userEvent.click(hoja2.getByRole('tab', { name: 'Mi computadora' }));
    const zona = hoja2.getByText('Arrastra tus videos aquí').parentElement!;
    fireEvent.drop(zona, { dataTransfer: { files: [video('soltado.mp4')], types: ['Files'] } });
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    expect(nombresEnOrden()).toEqual(['La peli', 'Otra peli', 'soltado.mp4']);
    await terminarSubida();
    await waitFor(() => expect(botonIniciar().textContent).toMatch(/^Iniciar/));
    expect(cuerpoDe(f, '/api/edicion/cotizar', pedidosA(f, '/api/edicion/cotizar') - 1)).toEqual({
      videos: [lista[0]!.ref, lista[1]!.ref, 'proyecto:soltado'],
    });
  });

  it('inicio.union.un_bloqueo_del_servidor_apaga_iniciar_con_su_texto_y_se_quita_al_agregar_otro_video', async () => {
    const lista = [elegible({ titulo: 'Corto', duracion_s: 8 }), elegible({ titulo: 'Otro' })];
    // el servidor es la autoridad: un solo video de 8 s no se edita solo; con otro, sí
    const f = montar({
      elegibles: () => json({ videos: lista, limites: LIMITES }),
      cotizar: refs => (refs.length === 1 ? cotizacionBloqueada(refs, 'corto_solo', 'Un video de menos de 1 min no se puede editar solo. Agrega otro para unirlos, o sube uno de 1 a 90 min.') : cotizarComo(lista)(refs)),
    });
    pintar();
    await irAEdicion();
    await subirVarios([video('corto.mp4')]);
    await terminarCola(1);
    await waitFor(() => expect(screen.getByText(/^Un video de menos de 1 min no se puede editar solo/)).toBeInTheDocument());
    // el texto sale TAL CUAL del servidor, y «Iniciar» sigue dorado y enfocable, sin precio
    expect(botonIniciar()).toHaveTextContent(/^Iniciar$/);
    expect(botonIniciar()).toHaveAttribute('aria-disabled', 'true');
    await userEvent.type(campo(), TEXTO);
    await userEvent.click(botonIniciar());
    expect(botonMas()).toHaveFocus();
    expect(pedidosA(f, '/api/edicion/iniciar')).toBe(0);
    // agrega otro para unirlos: el bloqueo se va y aparece el precio
    await elegirDeMisCreaciones(['Otro']);
    await screen.findByRole('button', { name: 'Iniciar ✦ 2' });
    expect(screen.queryByText(/^Un video de menos de 1 min/)).toBeNull();
  });

  it('inicio.union.formatos_distintos_lo_dice_el_servidor_tal_cual_y_la_caja_no_lo_repite', async () => {
    const lista = [elegible({ titulo: 'Horizontal' }), elegible({ titulo: 'Vertical', formato: 'vertical' })];
    montar({
      elegibles: () => json({ videos: lista, limites: LIMITES }),
      // la hoja no apaga lo que no se conoce (un archivo subido): lo dice el servidor al cotizar
      cotizar: refs => (refs.length > 1 ? cotizacionBloqueada(refs, 'formatos_distintos', TEXTO_FORMATOS) : cotizarComo(lista)(refs)),
    });
    pintar();
    await irAEdicion();
    await subirVarios([video('subido.mp4')]);
    await terminarCola(1);
    await waitFor(() => expect(botonIniciar().textContent).toMatch(/^Iniciar/));
    await elegirDeMisCreaciones(['Horizontal']);
    await waitFor(() => expect(screen.getByText(TEXTO_FORMATOS)).toBeInTheDocument());
    expect(screen.getAllByText(TEXTO_FORMATOS)).toHaveLength(1);
    expect(botonIniciar()).toHaveTextContent(/^Iniciar$/);
    expect(botonIniciar()).toHaveAccessibleDescription(expect.stringContaining(TEXTO_FORMATOS));
  });

  it('inicio.union.sin_saldo_dice_estos_videos_en_plural_y_cuanto_falta', async () => {
    ponerMonedero(5);
    montar();
    pintar();
    await irAEdicion();
    await conVideosSubidos(['a.mp4', 'b.mp4']);
    await userEvent.type(campo(), TEXTO);
    expect(screen.getByText('Tienes ✦ 5: no alcanza para editar estos videos.')).toBeInTheDocument();
    expect(screen.getByText(/Te faltan ✦ 3/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar ✦ 8' })).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('Shorts no cambia', () => {
  it('inicio.union.el_modo_shorts_sigue_con_un_solo_video_sin_menu_ni_hoja_y_el_mas_abre_el_selector_directo', async () => {
    const f = montar();
    pintar();
    await irAEdicion();
    await userEvent.click(chipModo());
    await userEvent.click(screen.getByRole('option', { name: /De videos a Shorts/ }));
    const mas = screen.getByRole('button', { name: 'Agregar el video largo' });
    expect(mas).not.toHaveAttribute('aria-haspopup');
    expect(mas).not.toHaveAttribute('aria-expanded');
    expect(entrada()).not.toHaveAttribute('multiple');
    const clic = vi.spyOn(entrada(), 'click');
    await userEvent.click(mas);
    expect(clic).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(f).not.toHaveBeenCalled();
    // un video subido: su tarjeta de siempre y «Cambiar el video»; otro archivo lo REEMPLAZA (no se suma)
    await userEvent.upload(entrada(), video('largo.mp4'));
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(1));
    await terminarSubida();
    await waitFor(() => expect(botonIniciar()).toHaveTextContent(/^Iniciar$/));
    expect(screen.getByRole('button', { name: 'Cambiar el video' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Orden de los videos' })).toBeNull();
    await userEvent.upload(entrada(), video('otro-largo.mp4'));
    await waitFor(() => expect(XhrFalso.todos).toHaveLength(2));
    expect(screen.queryByText('largo.mp4')).toBeNull();
    expect(screen.getByText('otro-largo.mp4')).toBeInTheDocument();
  });
});

describe('el dinero: la clave del pedido, el precio del servidor y lo que se avisa', () => {
  /** Hasta tener un video listo, el texto escrito y «Iniciar ✦ 8» a punto de pulsarse. */
  async function listaParaLanzar() {
    await irAEdicion();
    await conVideosSubidos(['entrevista.mp4']);
    await userEvent.type(campo(), TEXTO);
  }

  it('inicio.edicion.el_pedido_se_conserva_tras_una_red_caida_y_se_renueva_tras_cualquier_respuesta_del_servidor', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ponerMonedero(100);
    const cobros = oirCobros();
    const respuestas: Array<() => Response | Promise<Response>> = [
      () => sinRed(), // 1. la red se cae con el pedido en el aire
      () => sinRed(), // 2. otra vez
      () => json({ detail: 'Entre todos suman 95 min · el máximo es 90 min.' }, 413), // 3. contesta de verdad: un error
      () => json({ detail: 'No se pudo lanzar la edición: sin capacidad. Se te devolvió lo cobrado.' }, 502), // 4. y otro
      () => new Response('<html>Gateway Timeout</html>', { status: 504, headers: { 'Content-Type': 'text/html' } }), // 5. ni se sabe si salió
      () => json({ ...LANZADO, repetido: true }), // 6. el servidor lo reconoce: no cobra otra vez
    ];
    const f = montar({ iniciar: () => respuestas.shift()!(), estado: () => json({ editar: { estado: 'listo' } }) });
    pintar();
    await listaParaLanzar();
    const claves = () => llamadas(f, '/api/edicion/iniciar').map(c => (JSON.parse(String(c[1]!.body)) as { pedido: string }).pedido);
    const pulsar = async (vez: number) => {
      await userEvent.click(botonIniciar());
      await waitFor(() => expect(pedidosA(f, '/api/edicion/iniciar')).toBe(vez));
      await waitFor(() => expect(botonIniciar()).not.toHaveAttribute('aria-busy'));
    };
    await pulsar(1);
    await pulsar(2);
    // sin respuesta dos veces: es el MISMO pedido (si el servidor sí lo recibió, lo reconoce y no cobra de nuevo)
    expect(claves()[1]).toBe(claves()[0]);
    expect(claves()[0]).toMatch(/^[0-9a-f]{32}$/);
    await pulsar(3);
    expect(claves()[2]).toBe(claves()[0]);
    // el servidor contestó (413): lo que se pida después es OTRO pedido
    await pulsar(4);
    expect(claves()[3]).not.toBe(claves()[2]);
    // y tras otro error con respuesta (502), otro más
    await pulsar(5);
    expect(claves()[4]).not.toBe(claves()[3]);
    // un 504 de la puerta de enlace no dice si salió: se conserva
    await pulsar(6);
    expect(claves()[5]).toBe(claves()[4]);
    // el servidor dice que ya lo tenía: la caja se vacía y NO vuela otro «−N» (esta petición no cobró nada)
    await waitFor(() => expect(campo()).toHaveValue(''));
    expect(cobros).toHaveLength(0);
    // la copia termina (el sondeo la ve lista) y la caja queda libre: la siguiente composición estrena clave
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    await conVideosSubidos(['segundo.mp4']);
    await userEvent.type(campo(), TEXTO);
    respuestas.push(() => json(LANZADO));
    await userEvent.click(botonIniciar());
    await waitFor(() => expect(pedidosA(f, '/api/edicion/iniciar')).toBe(7));
    expect(claves()[6]).not.toBe(claves()[5]);
  });

  it('inicio.edicion.otra_lista_otro_orden_u_otro_texto_es_otro_pedido', async () => {
    ponerMonedero(100);
    // cada intento termina sin respuesta (red caída): la clave solo cambia si cambia lo que se pide
    const f = montar({ iniciar: () => sinRed() });
    pintar();
    await irAEdicion();
    await conVideosSubidos(['a.mp4', 'b.mp4']);
    await userEvent.type(campo(), TEXTO);
    const claves = () => llamadas(f, '/api/edicion/iniciar').map(c => (JSON.parse(String(c[1]!.body)) as { pedido: string }).pedido);
    const pulsar = async (vez: number) => {
      await userEvent.click(botonIniciar());
      await waitFor(() => expect(pedidosA(f, '/api/edicion/iniciar')).toBe(vez));
      await waitFor(() => expect(botonIniciar()).not.toHaveAttribute('aria-busy'));
    };
    await pulsar(1);
    await pulsar(2);
    expect(claves()[1]).toBe(claves()[0]);
    // otro texto
    await userEvent.type(campo(), ' y ponle música');
    await pulsar(3);
    expect(claves()[2]).not.toBe(claves()[1]);
    // el mismo texto otra vez, ahora con otro ORDEN de videos
    await pulsar(4);
    expect(claves()[3]).toBe(claves()[2]);
    await userEvent.click(screen.getByRole('button', { name: 'Bajar “a.mp4”' }));
    await pulsar(5);
    expect(claves()[4]).not.toBe(claves()[3]);
    // y con un video menos
    await userEvent.click(screen.getByRole('button', { name: 'Quitar “b.mp4”' }));
    await waitFor(() => expect(botonIniciar().textContent).toMatch(/^Iniciar ✦/));
    await pulsar(6);
    expect(claves()[5]).not.toBe(claves()[4]);
    expect(cuerpoDe(f, '/api/edicion/iniciar', 5).videos).toEqual(['proyecto:a']);
  });

  it('inicio.edicion.el_precio_solo_sale_de_cotizar_y_el_cliente_no_lo_calcula', async () => {
    const lista = [elegible({ titulo: 'Uno' }), elegible({ titulo: 'Dos' }), elegible({ titulo: 'Tres' })];
    // cifras que no están en ninguna tarifa: si el botón dijera otra cosa, la caja estaría calculando
    const precios = [7, 11, 13];
    let vez = 0;
    montar({
      elegibles: () => json({ videos: lista, limites: LIMITES }),
      cotizar: refs => cotizarComo(lista, { creditos: precios[vez++] ?? 99 })(refs),
    });
    pintar();
    await irAEdicion();
    await elegirDeMisCreaciones(['Uno']);
    expect(await screen.findByRole('button', { name: 'Iniciar ✦ 7' })).toBeInTheDocument();
    await elegirDeMisCreaciones(['Dos']);
    expect(await screen.findByRole('button', { name: 'Iniciar ✦ 11' })).toBeInTheDocument();
    await elegirDeMisCreaciones(['Tres']);
    expect(await screen.findByRole('button', { name: 'Iniciar ✦ 13' })).toBeInTheDocument();
    // quitar uno: el precio nuevo es el que diga el servidor (aquí ya no hay más cifras: 99)
    await userEvent.click(screen.getByRole('button', { name: 'Quitar “Dos”' }));
    expect(await screen.findByRole('button', { name: 'Iniciar ✦ 99' })).toBeInTheDocument();
  });

  it('inicio.edicion.un_repetido_del_servidor_vacia_la_caja_sin_dibujar_otro_menos_n_y_pone_al_dia_el_saldo', async () => {
    const monedero = ponerMonedero(100);
    const cobros = oirCobros();
    const avisos = ponerAvisos();
    montar({ iniciar: () => json({ ...LANZADO, repetido: true }) });
    pintar();
    await irAEdicion();
    await conVideosSubidos(['entrevista.mp4']);
    await userEvent.type(campo(), TEXTO);
    await userEvent.click(botonIniciar());
    await waitFor(() => expect(campo()).toHaveValue(''));
    expect(cobros).toEqual([]);
    expect(monedero.refrescar).toHaveBeenCalled();
    expect(dicho(avisos).at(-1)).toEqual({ texto: 'Ya estamos editando tu video. Sigue el avance en «Tus trabajos».', tipo: 'ok', clave: 'caja' });
    // y la copia sigue contando como en curso
    avisos.mostrar.mockClear();
    await userEvent.click(botonMas());
    expect(dicho(avisos)).toEqual([{ texto: AVISO_OCUPADO, tipo: 'mal', clave: 'caja' }]);
  });

  it('inicio.edicion.un_413_o_422_del_servidor_se_dice_tal_cual_no_cobra_y_se_vuelve_a_cotizar', async () => {
    const avisos = ponerAvisos();
    const cobros = oirCobros();
    ponerMonedero(100);
    const f = montar({ iniciar: () => json({ detail: 'Entre todos suman 95 min · el máximo es 90 min.' }, 413) });
    pintar();
    await listaParaLanzar();
    expect(pedidosA(f, '/api/edicion/cotizar')).toBe(1);
    await userEvent.click(botonIniciar());
    await waitFor(() => expect(dicho(avisos).at(-1)).toEqual({ texto: 'Entre todos suman 95 min · el máximo es 90 min.', tipo: 'mal', clave: 'caja' }));
    // la regla que la caja no conocía: se vuelve a pedir el precio, que traería su aviso
    await waitFor(() => expect(pedidosA(f, '/api/edicion/cotizar')).toBe(2));
    expect(cobros).toEqual([]);
    expect(campo()).toHaveValue(TEXTO);
    expect(screen.getByText('entrevista.mp4')).toBeInTheDocument();
  });

  it('inicio.edicion.el_aviso_de_exito_dice_si_se_edita_un_video_o_se_unen_varios', async () => {
    const avisos = ponerAvisos();
    ponerMonedero(100);
    montar();
    pintar();
    await irAEdicion();
    await conVideosSubidos(['a.mp4', 'b.mp4', 'c.mp4']);
    await userEvent.type(campo(), TEXTO);
    await userEvent.click(botonIniciar());
    await waitFor(() => expect(campo()).toHaveValue(''));
    expect(dicho(avisos)).toEqual([{ texto: 'Ya estamos uniendo y editando tus 3 videos. Sigue el avance en «Tus trabajos».', tipo: 'ok', clave: 'caja' }]);
    // la caja queda vacía: ni lista, ni nota de copia
    expect(screen.queryByRole('list', { name: 'Orden de los videos' })).toBeNull();
    expect(screen.queryByText(/Se edita una copia/)).toBeNull();
  });

  it('inicio.edicion.avisa_a_la_pantalla_cuando_el_servidor_acepto_para_que_mis_creaciones_muestre_la_copia', async () => {
    ponerMonedero(100);
    const alEditar = vi.fn();
    const f = montar({ iniciar: () => json({ detail: 'No se pudo lanzar la edición: sin capacidad. Se te devolvió lo cobrado.' }, 502) });
    pintar({ alEditar });
    await listaParaLanzar();
    await userEvent.click(botonIniciar());
    await waitFor(() => expect(pedidosA(f, '/api/edicion/iniciar')).toBe(1));
    await waitFor(() => expect(botonIniciar()).not.toHaveAttribute('aria-busy'));
    expect(alEditar).not.toHaveBeenCalled(); // un error no deja copia que mostrar
    montar({ iniciar: EXITO });
    await userEvent.click(botonIniciar());
    await waitFor(() => expect(alEditar).toHaveBeenCalledTimes(1));
  });

  it('inicio.edicion.si_otra_edicion_ya_corre_el_409_bloquea_hasta_que_la_lista_diga_que_termino', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ponerMonedero(100);
    const avisos = ponerAvisos();
    let corriendo = true;
    const f = montar({
      iniciar: () => json({ detail: 'Ya hay un trabajo en curso. Cuando termine puedes empezar otro.' }, 409),
      proyectos: () => json(corriendo ? [{ nombre: 'ed-viejo', generado: false, editor_listo: false, editar: { estado: 'corriendo' } }] : []),
    });
    pintar();
    await listaParaLanzar();
    await userEvent.click(botonIniciar());
    await waitFor(() => expect(dicho(avisos).at(-1)!.texto).toBe(AVISO_OCUPADO));
    // no se sabe cuál es: la caja pregunta por la lista de ediciones (no por una copia que no conoce)
    expect(botonMas()).toHaveAttribute('aria-disabled', 'true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(llamadas(f, '/api/edicion/proyectos', 'GET').length).toBeGreaterThanOrEqual(1);
    expect(botonMas()).toHaveAttribute('aria-disabled', 'true'); // sigue corriendo
    corriendo = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(botonMas()).not.toHaveAttribute('aria-disabled');
  });

  it('un 409 de «esta edición ya falló» no bloquea la caja: dice su texto y se puede pulsar «Iniciar» otra vez', async () => {
    ponerMonedero(100);
    const avisos = ponerAvisos();
    const respuestas = [
      () => json({ detail: 'Esta edición ya falló y se te devolvió lo cobrado. Pulsa Iniciar otra vez para empezar de nuevo.' }, 409),
      () => json(LANZADO),
    ];
    const f = montar({ iniciar: () => respuestas.shift()!() });
    pintar();
    await listaParaLanzar();
    await userEvent.click(botonIniciar());
    await waitFor(() =>
      expect(dicho(avisos).at(-1)!.texto).toBe('Esta edición ya falló y se te devolvió lo cobrado. Pulsa Iniciar otra vez para empezar de nuevo.'),
    );
    expect(botonMas()).not.toHaveAttribute('aria-disabled');
    const primera = (JSON.parse(String(llamadas(f, '/api/edicion/iniciar')[0]![1]!.body)) as { pedido: string }).pedido;
    await userEvent.click(botonIniciar());
    await waitFor(() => expect(pedidosA(f, '/api/edicion/iniciar')).toBe(2));
    // «empezar de nuevo» es otra clave, no la que el servidor ya cerró
    expect((JSON.parse(String(llamadas(f, '/api/edicion/iniciar')[1]![1]!.body)) as { pedido: string }).pedido).not.toBe(primera);
  });

  it('inicio.edicion.una_pregunta_de_la_copia_sondea_por_su_nombre_cada_5_s_y_se_libera_al_terminar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ponerMonedero(100);
    let estado = 'corriendo';
    const f = montar({ iniciar: () => json({ ...LANZADO, nombre: 'ed-aaaa1111' }), estado: () => json({ editar: { estado } }) });
    pintar();
    await listaParaLanzar();
    await userEvent.click(botonIniciar());
    await waitFor(() => expect(campo()).toHaveValue(''));
    expect(llamadas(f, '/api/editar/ed-aaaa1111', 'GET')).toHaveLength(0); // perezoso
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(llamadas(f, '/api/editar/ed-aaaa1111', 'GET')).toHaveLength(1);
    estado = 'error';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(botonMas()).not.toHaveAttribute('aria-disabled');
  });

  it('un 402 con varios videos dice cuánto falta, no vacía la caja y deja el mismo pedido para reintentar', async () => {
    ponerMonedero(100);
    const cobros = oirCobros();
    const pedidos: string[] = [];
    const respuestas = [() => json({ detail: 'Créditos insuficientes: esta acción cuesta 8 créditos y tu saldo es 5.' }, 402), () => json(LANZADO)];
    montar({
      iniciar: (_u, init) => {
        pedidos.push((JSON.parse(String(init?.body)) as { pedido: string }).pedido);
        return respuestas.shift()!();
      },
    });
    pintar();
    await irAEdicion();
    await conVideosSubidos(['a.mp4', 'b.mp4']);
    await userEvent.type(campo(), TEXTO);
    await userEvent.click(botonIniciar());
    expect(await screen.findByText(/Te faltan ✦ 3/)).toBeInTheDocument();
    expect(nombresEnOrden()).toEqual(['a.mp4', 'b.mp4']);
    expect(cobros).toEqual([]);
    // el 402 es una respuesta de verdad (no cobró): el siguiente intento es un pedido nuevo
    await userEvent.click(botonIniciar());
    await waitFor(() => expect(cobros.map(c => c.costo)).toEqual([8]));
    expect(pedidos).toHaveLength(2);
    expect(pedidos[1]).not.toBe(pedidos[0]);
  });

  it('una respuesta que tarda no deja pulsar «Iniciar» dos veces con videos mezclados', async () => {
    ponerMonedero(100);
    const espera = diferida<Response>();
    const f = montar({ iniciar: () => espera.promesa });
    pintar();
    await irAEdicion();
    await conVideosSubidos(['a.mp4', 'b.mp4']);
    await userEvent.type(campo(), TEXTO);
    const boton = screen.getByRole('button', { name: 'Iniciar ✦ 8' });
    act(() => {
      boton.click();
      boton.click();
    });
    await waitFor(() => expect(pedidosA(f, '/api/edicion/iniciar')).toBe(1));
    // mientras sale el pedido, la lista no se toca: ni subir, ni bajar, ni quitar
    for (const nombre of ['Subir “b.mp4”', 'Bajar “a.mp4”', 'Quitar “a.mp4”']) {
      expect(screen.getByRole('button', { name: nombre })).toHaveAttribute('aria-disabled', 'true');
      await userEvent.click(screen.getByRole('button', { name: nombre }));
    }
    expect(nombresEnOrden()).toEqual(['a.mp4', 'b.mp4']);
    espera.resolver(EXITO());
    await waitFor(() => expect(campo()).toHaveValue(''));
    expect(pedidosA(f, '/api/edicion/iniciar')).toBe(1);
  });
});
