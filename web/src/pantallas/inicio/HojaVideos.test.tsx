// La hoja «Agregar videos» (E2) como COMPORTAMIENTO. Cada nombre que empieza por su ID es un invariante del registro
// (tests/test_migracion_ui.py). Nada de esto gasta dinero ni toca la red de verdad: GET /api/edicion/elegibles es un doble.
import { useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { json, llamadas, servidor, sinRed } from '../../prueba/servidor';
import type { Elegibles, VideoElegible } from './envio';
import { HojaVideos } from './HojaVideos';
import type { FichaDeVideo } from './reglasVideos';

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

// los nueve de ejemplo del lienzo, con lo que pasa con cada uno
const TREN = elegible({ ref: 'proyecto:gen-tren', titulo: 'El tren de papel', duracion_s: 30.04 });
const PERRO = elegible({ ref: 'clip:clip-20261008-101500-ab12cd', tipo: 'clip', titulo: 'Perro en la playa', duracion_s: 8, video: '/api/clip/x/video' });
const VOLCAN = elegible({ ref: 'proyecto:gen-volcan', tipo: 'cuento', titulo: 'Camino al volcán', duracion_s: 45, formato: 'vertical' });
const ENTREVISTA = elegible({ ref: 'proyecto:entrevista', tipo: 'edicion', titulo: 'Cómo edito mis videos', duracion_s: 724 });
const CURSO = elegible({ ref: 'proyecto:curso', tipo: 'edicion', titulo: 'Curso de edición', duracion_s: 78 * 60 });
const DOCUMENTAL = elegible({ ref: 'proyecto:documental', tipo: 'edicion', titulo: 'Documental completo', duracion_s: 130 * 60 });
const COPIA = elegible({
  ref: 'proyecto:ed-9f1c0a7b',
  tipo: 'edicion',
  titulo: 'El tren de papel + 2 más',
  duracion_s: null,
  formato: null,
  bytes: null,
  es_copia: true,
  copia_de: [{ ref: TREN.ref, titulo: TREN.titulo }],
  motivo: 'es_copia',
});
const TODOS = [TREN, PERRO, VOLCAN, ENTREVISTA, CURSO, DOCUMENTAL, COPIA];

const LIMITES = { max_s: 5400, min_solo_s: 60, max_videos: 12, max_bytes: 16106127360 };
const lista = (videos: VideoElegible[] = TODOS, limites = LIMITES): Elegibles => ({ videos, limites });

interface Espias {
  alUsar: ReturnType<typeof vi.fn<(e: VideoElegible[]) => void>>;
  alElegirArchivos: ReturnType<typeof vi.fn<(m: VideoElegible[]) => void>>;
  alSoltarArchivos: ReturnType<typeof vi.fn<(a: File[], m: VideoElegible[]) => void>>;
}
let espias: Espias;

/** La hoja con un «+» de mentira que la abre y recibe el foco al cerrar, como en la caja. */
function Montaje({ enCaja = [], ocupado = false }: { enCaja?: FichaDeVideo[]; ocupado?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const mas = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={mas} type="button" onClick={() => setAbierto(true)}>
        Abrir la hoja
      </button>
      <HojaVideos
        abierto={abierto}
        alCambiar={setAbierto}
        enCaja={enCaja}
        alUsar={espias.alUsar}
        alElegirArchivos={espias.alElegirArchivos}
        alSoltarArchivos={espias.alSoltarArchivos}
        focoAlCerrar={mas}
        ocupado={ocupado}
      />
    </>
  );
}

function montar(respuesta: () => Response | Promise<Response> = () => json(lista())) {
  return servidor({ '/api/edicion/elegibles': respuesta });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  espias = { alUsar: vi.fn(), alElegirArchivos: vi.fn(), alSoltarArchivos: vi.fn() };
});

afterEach(() => {
  vi.useRealTimers();
});

const abrir = () => screen.getByRole('button', { name: 'Abrir la hoja' });
const hoja = () => screen.getByRole('dialog', { name: 'Agregar videos' });
/** Abre la hoja y espera a que la lista llegue. */
async function abierta() {
  await userEvent.click(abrir());
  await within(hoja()).findByRole('list', { name: 'Tus videos' });
  return within(hoja());
}
/** El botón de un video por el principio de su nombre accesible (la etiqueta completa se prueba aparte). */
const video = (h: ReturnType<typeof within>, titulo: string | RegExp) =>
  h.getByRole('button', { name: typeof titulo === 'string' ? new RegExp('^' + titulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : titulo });
const textoDelPie = () => hoja().querySelector('[role="status"]')!.textContent ?? '';

describe('la hoja «Agregar videos»: carga y estados', () => {
  it('inicio.hojavideos.pide_la_lista_al_abrir_dice_que_carga_y_la_pinta', async () => {
    let soltar!: (r: Response) => void;
    const f = montar(() => new Promise<Response>(r => (soltar = r)));
    render(<Montaje />);
    // abrir la caja de Edición no pide nada: la lista se pide cuando se abre la hoja
    expect(llamadas(f, '/api/edicion/elegibles', 'GET')).toHaveLength(0);
    await userEvent.click(abrir());
    expect(hoja()).toBeInTheDocument();
    expect(within(hoja()).getByText('Cargando tus videos…')).toBeInTheDocument();
    expect(within(hoja()).getByText('Cargando tus videos…').closest('[role="status"]')).not.toBeNull();
    expect(llamadas(f, '/api/edicion/elegibles', 'GET')).toHaveLength(1);
    // sin lista aún: nada que usar ni que contar
    expect(within(hoja()).queryByRole('button', { name: /^Usar/ })).toBeNull();
    await act(async () => soltar(json(lista())));
    expect(await within(hoja()).findByRole('list', { name: 'Tus videos' })).toBeInTheDocument();
    expect(within(hoja()).queryByText('Cargando tus videos…')).toBeNull();
    // el título, las dos pestañas y la nota fija
    expect(within(hoja()).getByRole('tab', { name: 'Mis creaciones' })).toHaveAttribute('aria-selected', 'true');
    expect(within(hoja()).getByRole('tab', { name: 'Mi computadora' })).toBeInTheDocument();
    expect(
      within(hoja()).getByText(
        'Para editar un solo video, debe durar de 1 a 90 min. Al unir varios no hay mínimo y el total llega hasta 90 min. Los videos horizontales y los verticales no se mezclan.',
      ),
    ).toBeInTheDocument();
  });

  it('inicio.hojavideos.si_la_lista_no_llega_lo_dice_adentro_y_reintentar_la_vuelve_a_pedir', async () => {
    let falla = true;
    const f = montar(() => (falla ? sinRed() : json(lista())));
    render(<Montaje />);
    await userEvent.click(abrir());
    const alerta = await within(hoja()).findByRole('alert');
    // adentro de la hoja: el cuadro de avisos queda tapado por el diálogo
    expect(hoja()).toContainElement(alerta);
    expect(alerta).toHaveTextContent('No pudimos traer tus videos. Revisa tu conexión e inténtalo de nuevo.');
    falla = false;
    await userEvent.click(within(alerta).getByRole('button', { name: 'Reintentar' }));
    expect(await within(hoja()).findByRole('list', { name: 'Tus videos' })).toBeInTheDocument();
    expect(within(hoja()).queryByRole('alert')).toBeNull();
    expect(llamadas(f, '/api/edicion/elegibles', 'GET')).toHaveLength(2);
    // una respuesta que no es la lista tampoco se pinta
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    montar(() => json({ videos: 'no' }));
    await userEvent.click(abrir());
    expect(await within(hoja()).findByRole('alert')).toHaveTextContent('No pudimos traer tus videos');
    // un 500 del servidor, igual
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    montar(() => json({ detail: 'Algo salió mal' }, 500));
    await userEvent.click(abrir());
    expect(await within(hoja()).findByRole('alert')).toHaveTextContent('No pudimos traer tus videos');
  });

  it('inicio.hojavideos.sin_videos_hechos_con_ia_ofrece_subir_de_la_computadora_y_no_ofrece_usar', async () => {
    montar(() => json(lista([])));
    render(<Montaje />);
    await userEvent.click(abrir());
    const h = within(hoja());
    expect(await h.findByText('Todavía no tienes videos hechos con IA.')).toBeInTheDocument();
    expect(h.getByText('Cuando hagas una película, un cuento o un clip, lo encuentras aquí para editarlo o unirlo con otros.')).toBeInTheDocument();
    // sin nada que filtrar ni que usar; el único ámbar es «Subir de mi computadora»
    expect(h.queryByRole('group', { name: 'Filtrar por tipo' })).toBeNull();
    expect(h.queryByRole('button', { name: /^Usar/ })).toBeNull();
    expect(textoDelPie()).toBe('Aquí aparecen los videos que hagas con IA.');
    await userEvent.click(h.getByRole('button', { name: 'Subir de mi computadora' }));
    expect(espias.alElegirArchivos).toHaveBeenCalledExactlyOnceWith([]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('inicio.hojavideos.la_lista_es_la_de_esta_apertura_y_se_vuelve_a_pedir_en_cada_una', async () => {
    let vez = 0;
    const f = montar(() => json(lista(++vez === 1 ? [TREN] : [TREN, PERRO])));
    render(<Montaje />);
    const h = await abierta();
    expect(h.getAllByRole('listitem')).toHaveLength(1);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const h2 = await abierta();
    expect(h2.getAllByRole('listitem')).toHaveLength(2);
    expect(llamadas(f, '/api/edicion/elegibles', 'GET')).toHaveLength(2);
  });

  it('inicio.hojavideos.cerrar_aborta_la_peticion_y_una_lista_que_llega_tarde_no_se_pinta', async () => {
    let soltar!: (r: Response) => void;
    const f = montar(() => new Promise<Response>(r => (soltar = r)));
    render(<Montaje />);
    await userEvent.click(abrir());
    const init = f.mock.calls[0]![1]!;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal!.aborted).toBe(false);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(init.signal!.aborted).toBe(true);
    await act(async () => soltar(json(lista())));
    expect(screen.queryByRole('list', { name: 'Tus videos' })).toBeNull();
  });
});

describe('la hoja «Agregar videos»: la cuadrícula y los filtros', () => {
  it('inicio.hojavideos.cada_video_dice_su_nombre_con_duracion_formato_y_lo_que_aplica_exacto', async () => {
    montar();
    render(<Montaje />);
    const h = await abierta();
    // el nombre accesible: «{título}, {reloj}, {16:9}» y solo si aplica «, solo para unir», «, elegido, número N», «, no disponible: …»
    expect(h.getByRole('button', { name: 'El tren de papel, 0:30, 16:9, solo para unir' })).toBeInTheDocument();
    expect(h.getByRole('button', { name: 'Perro en la playa, 0:08, 16:9, solo para unir' })).toBeInTheDocument();
    expect(h.getByRole('button', { name: 'Camino al volcán, 0:45, 9:16, solo para unir' })).toBeInTheDocument();
    expect(h.getByRole('button', { name: 'Cómo edito mis videos, 12:04, 16:9' })).toBeInTheDocument();
    expect(h.getByRole('button', { name: 'Curso de edición, 1:18:00, 16:9' })).toBeInTheDocument();
    await userEvent.click(h.getByRole('button', { name: 'Cómo edito mis videos, 12:04, 16:9' }));
    expect(h.getByRole('button', { name: 'Cómo edito mis videos, 12:04, 16:9, elegido, número 1' })).toBeInTheDocument();
    await userEvent.click(h.getByRole('button', { name: 'El tren de papel, 0:30, 16:9, solo para unir' }));
    expect(h.getByRole('button', { name: 'El tren de papel, 0:30, 16:9, solo para unir, elegido, número 2' })).toBeInTheDocument();
    // el apagado por la selección lo dice en su nombre
    expect(h.getByRole('button', { name: 'Camino al volcán, 0:45, 9:16, solo para unir, no disponible: Vertical · no se une con horizontales' })).toBeInTheDocument();
    // lo que dura más de 90 min y las copias, también
    expect(h.getByRole('button', { name: 'Documental completo, 2:10:00, 16:9, no disponible: Dura 130 min · máximo 90 min' })).toBeInTheDocument();
    expect(h.getByRole('button', { name: 'El tren de papel + 2 más, no disponible: Ya es una edición · ábrela en su editor' })).toBeInTheDocument();
    // cada video dice de qué es y de cuándo; los de menos de 1 min llevan su etiqueta de TEXTO
    const tarjeta = h.getByText('Perro en la playa').closest('li')!;
    expect(tarjeta.textContent).toContain('Clip · 2/10');
    expect(within(tarjeta).getByText('Solo para unir')).toBeInTheDocument();
    // la insignia de formato y la de duración se ven en el video
    const boton = h.getByRole('button', { name: 'Cómo edito mis videos, 12:04, 16:9, elegido, número 1' });
    expect(within(boton).getByText('16:9')).toBeInTheDocument();
    expect(within(boton).getByText('12:04')).toBeInTheDocument();
    expect(within(boton).getByText('1')).toBeInTheDocument();
  });

  it('inicio.hojavideos.los_cinco_filtros_traen_su_cuenta_y_un_filtro_en_cero_lo_dice', async () => {
    montar(() => json(lista([TREN, PERRO, VOLCAN, ENTREVISTA, CURSO, DOCUMENTAL, COPIA, elegible({ tipo: 'pelicula', titulo: 'Otra' })])));
    render(<Montaje />);
    const h = await abierta();
    const grupo = within(h.getByRole('group', { name: 'Filtrar por tipo' }));
    const filtros = grupo.getAllByRole('button').map(b => b.textContent);
    // las cuentas incluyen lo que no se puede editar
    expect(filtros).toEqual(['Todo8', 'Películas2', 'Cuentos1', 'Clips1', 'Ediciones4']);
    expect(grupo.getByRole('button', { name: /^Todo/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(grupo.getByRole('button', { name: /^Clips/ }));
    expect(grupo.getByRole('button', { name: /^Clips/ })).toHaveAttribute('aria-pressed', 'true');
    expect(grupo.getByRole('button', { name: /^Todo/ })).toHaveAttribute('aria-pressed', 'false');
    expect(h.getAllByRole('listitem').map(li => li.textContent)).toEqual([expect.stringContaining('Perro en la playa')]);
    // el aparte también se filtra: «Documental completo» es una edición
    await userEvent.click(grupo.getByRole('button', { name: /^Ediciones/ }));
    expect(h.getByRole('list', { name: 'Videos que no se pueden editar' })).toBeInTheDocument();
    await userEvent.click(grupo.getByRole('button', { name: /^Cuentos/ }));
    expect(h.queryByRole('list', { name: 'Videos que no se pueden editar' })).toBeNull();
    expect(h.getAllByRole('listitem')).toHaveLength(1);
    // un filtro en cero se ve igual y dice por qué
    montar(() => json(lista([TREN])));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const h2 = await abierta();
    expect(within(h2.getByRole('group', { name: 'Filtrar por tipo' })).getByRole('button', { name: /^Clips/ })).toHaveTextContent('Clips0');
    await userEvent.click(h2.getByRole('button', { name: /^Clips/ }));
    expect(h2.getByText('Aquí no hay videos de este tipo todavía.')).toBeInTheDocument();
    expect(h2.queryByRole('list', { name: 'Tus videos' })).toBeNull();
  });

  it('la cuadrícula es de dos columnas en celular y de tres desde 640 px', async () => {
    montar();
    render(<Montaje />);
    const h = await abierta();
    const clases = h.getByRole('list', { name: 'Tus videos' }).className.split(/\s+/);
    expect(clases).toEqual(expect.arrayContaining(['grid-cols-2', 'min-[640px]:grid-cols-3']));
    expect(clases).not.toContain('min-[640px]:grid-cols-4');
    // los que no se pueden editar van en su propia lista, con el mismo aspecto
    expect(h.getByRole('list', { name: 'Videos que no se pueden editar' }).className).toContain('grid-cols-2');
  });
});

describe('la hoja «Agregar videos»: marcar, numerar y apagar', () => {
  it('inicio.hojavideos.marcar_numera_en_el_orden_de_marcado_y_desmarcar_recorre_los_numeros', async () => {
    montar();
    render(<Montaje />);
    const h = await abierta();
    const marca = (b: HTMLElement) => b.getAttribute('aria-label');
    await userEvent.click(video(h, 'Cómo edito mis videos'));
    await userEvent.click(video(h, 'El tren de papel,'));
    await userEvent.click(video(h, 'Perro en la playa'));
    expect(marca(video(h, 'Cómo edito mis videos'))).toMatch(/número 1$/);
    expect(marca(video(h, 'El tren de papel,'))).toMatch(/número 2$/);
    expect(marca(video(h, 'Perro en la playa'))).toMatch(/número 3$/);
    expect(video(h, 'Perro en la playa')).toHaveAttribute('aria-pressed', 'true');
    // quitar el primero recorre los números
    await userEvent.click(video(h, 'Cómo edito mis videos'));
    expect(video(h, 'Cómo edito mis videos')).toHaveAttribute('aria-pressed', 'false');
    expect(marca(video(h, 'Cómo edito mis videos'))).not.toMatch(/elegido/);
    expect(marca(video(h, 'El tren de papel,'))).toMatch(/número 1$/);
    expect(marca(video(h, 'Perro en la playa'))).toMatch(/número 2$/);
    // y el botón principal cuenta lo marcado
    expect(h.getByRole('button', { name: 'Usar 2 videos' })).not.toHaveAttribute('aria-disabled');
  });

  it('inicio.hojavideos.el_orden_numerico_continua_la_cuenta_de_la_caja_y_lo_que_esta_en_ella_se_apaga', async () => {
    montar();
    const enCaja: FichaDeVideo[] = [
      { ref: TREN.ref, duracion_s: 30.04, formato: 'horizontal', bytes: 1 },
      { ref: 'proyecto:subida', duracion_s: 12, formato: 'horizontal', bytes: 1 },
      { ref: 'proyecto:otra', duracion_s: 12, formato: 'horizontal', bytes: 1 },
    ];
    render(<Montaje enCaja={enCaja} />);
    const h = await abierta();
    // «En la caja»: apagado, con palomita, y no se puede marcar
    const enLaCaja = video(h, 'El tren de papel,');
    expect(enLaCaja).toHaveAttribute('aria-disabled', 'true');
    expect(enLaCaja.getAttribute('aria-label')).toMatch(/no disponible: En la caja$/);
    expect(within(enLaCaja.closest('li')!).getByText('En la caja')).toBeInTheDocument();
    await userEvent.click(enLaCaja);
    expect(enLaCaja).toHaveAttribute('aria-pressed', 'false');
    // con 3 en la caja, el primero marcado es el 4
    await userEvent.click(video(h, 'Cómo edito mis videos'));
    expect(video(h, 'Cómo edito mis videos').getAttribute('aria-label')).toMatch(/número 4$/);
    await userEvent.click(video(h, 'Perro en la playa'));
    expect(video(h, 'Perro en la playa').getAttribute('aria-label')).toMatch(/número 5$/);
    // el pie suma lo marcado y dice cuántos serán con los de la caja
    expect(textoDelPie()).toBe('2 videos · 12:12 en total · Con los de la caja serán 5 (13:06). Se edita una copia; tus originales no se tocan.');
  });

  it('inicio.hojavideos.con_un_horizontal_marcado_los_verticales_se_apagan_con_su_texto_y_al_reves', async () => {
    montar();
    render(<Montaje />);
    const h = await abierta();
    await userEvent.click(video(h, 'Cómo edito mis videos'));
    const vertical = video(h, 'Camino al volcán');
    expect(vertical).toHaveAttribute('aria-disabled', 'true');
    expect(within(vertical.closest('li')!).getByText('Vertical · no se une con horizontales')).toBeInTheDocument();
    await userEvent.click(vertical);
    expect(vertical).toHaveAttribute('aria-pressed', 'false');
    // los horizontales siguen disponibles; al desmarcar el horizontal, el vertical vuelve
    expect(video(h, 'Perro en la playa')).not.toHaveAttribute('aria-disabled');
    await userEvent.click(video(h, 'Cómo edito mis videos'));
    expect(video(h, 'Camino al volcán')).not.toHaveAttribute('aria-disabled');
    // al revés: con un vertical marcado, los horizontales dicen que no se unen con verticales
    await userEvent.click(video(h, 'Camino al volcán'));
    const horizontal = video(h, 'Perro en la playa');
    expect(horizontal).toHaveAttribute('aria-disabled', 'true');
    expect(within(horizontal.closest('li')!).getByText('Horizontal · no se une con verticales')).toBeInTheDocument();
  });

  it('inicio.hojavideos.el_formato_de_lo_que_ya_esta_en_la_caja_tambien_apaga', async () => {
    montar();
    render(<Montaje enCaja={[{ ref: 'proyecto:subida', duracion_s: 600, formato: 'vertical', bytes: 1 }]} />);
    const h = await abierta();
    const horizontal = video(h, 'Cómo edito mis videos');
    expect(horizontal).toHaveAttribute('aria-disabled', 'true');
    expect(within(horizontal.closest('li')!).getByText('Horizontal · no se une con verticales')).toBeInTheDocument();
    expect(video(h, 'Camino al volcán')).not.toHaveAttribute('aria-disabled');
  });

  it('inicio.hojavideos.se_pasa_de_90_min_apaga_lo_que_no_cabe_y_el_curso_solo_se_apaga_por_la_suma', async () => {
    montar();
    render(<Montaje />);
    const h = await abierta();
    // el curso (78 min) se puede marcar solo; lo que no se puede es sumarle otros 12 minutos
    const curso = video(h, 'Curso de edición');
    expect(curso).not.toHaveAttribute('aria-disabled');
    await userEvent.click(video(h, 'Cómo edito mis videos'));
    await userEvent.click(video(h, 'El tren de papel,'));
    expect(curso).toHaveAttribute('aria-disabled', 'true');
    expect(within(curso.closest('li')!).getByText('Se pasa de 90 min')).toBeInTheDocument();
    await userEvent.click(curso);
    expect(curso).toHaveAttribute('aria-pressed', 'false');
    // quitar lo marcado lo vuelve a encender
    await userEvent.click(video(h, 'Cómo edito mis videos'));
    await userEvent.click(video(h, 'El tren de papel,'));
    expect(curso).not.toHaveAttribute('aria-disabled');
  });

  it('inicio.hojavideos.lo_que_dura_mas_de_90_min_y_las_copias_van_aparte_en_no_se_pueden_editar', async () => {
    montar();
    render(<Montaje />);
    const h = await abierta();
    const aparte = within(h.getByRole('list', { name: 'Videos que no se pueden editar' }));
    expect(h.getByText('No se pueden editar').tagName).toBe('P');
    expect(aparte.getAllByRole('listitem').map(li => li.querySelector('span.block, span')?.textContent)).toBeTruthy();
    expect(aparte.getByText('Documental completo')).toBeInTheDocument();
    expect(aparte.getByText('Dura 130 min · máximo 90 min')).toBeInTheDocument();
    expect(aparte.getByText('El tren de papel + 2 más')).toBeInTheDocument();
    expect(aparte.getByText('Ya es una edición · ábrela en su editor')).toBeInTheDocument();
    // sin botón de usarlos, y marcar no hace nada
    const documental = aparte.getByRole('button', { name: /^Documental completo/ });
    expect(documental).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(documental);
    expect(documental).toHaveAttribute('aria-pressed', 'false');
    // los demás NO están en esa lista
    expect(aparte.queryByText('Curso de edición')).toBeNull();
    const aqui = within(h.getByRole('list', { name: 'Tus videos' }));
    expect(aqui.queryByText('Documental completo')).toBeNull();
    expect(aqui.queryByText('El tren de papel + 2 más')).toBeNull();
  });

  it('inicio.hojavideos.los_motivos_del_servidor_se_leen_tal_cual_y_un_video_midiendose_dice_que_calcula', async () => {
    montar(() =>
      json(
        lista([
          elegible({ titulo: 'Se edita ahora', motivo: 'en_curso' }),
          elegible({ titulo: 'Sin metraje', motivo: 'sin_metraje', duracion_s: null, formato: null }),
          elegible({ titulo: 'Midiendo', motivo: 'midiendo', duracion_s: null, formato: null, bytes: null }),
        ]),
      ),
    );
    render(<Montaje />);
    await userEvent.click(abrir());
    const aparte = within(await within(hoja()).findByRole('list', { name: 'Videos que no se pueden editar' }));
    expect(aparte.getByText('Se está editando ahora')).toBeInTheDocument();
    expect(aparte.getByText('No tiene video para editar')).toBeInTheDocument();
    expect(aparte.getByText('Calculando su duración…')).toBeInTheDocument();
    // sin duración no hay insignia de reloj ni se inventa una
    expect(within(aparte.getByRole('button', { name: /^Midiendo/ })).queryByText(/:/)).toBeNull();
    // y no hay nada que marcar: la lista de arriba ni se pinta
    expect(within(hoja()).queryByRole('list', { name: 'Tus videos' })).toBeNull();
  });

  it('inicio.hojavideos.el_tope_de_12_videos_y_de_15_gb_apagan_lo_que_ya_no_cabe', async () => {
    const doce = Array.from({ length: 12 }, (_, i) => elegible({ titulo: `Corto ${i + 1}`, duracion_s: 5, bytes: 1000 }));
    const pesado = elegible({ titulo: 'Pesado', duracion_s: 5, bytes: 10 * 1024 ** 3 });
    const otroPesado = elegible({ titulo: 'Otro pesado', duracion_s: 5, bytes: 6 * 1024 ** 3 });
    montar(() => json(lista([...doce, pesado, otroPesado])));
    render(<Montaje />);
    const h = await abierta();
    // peso: 10 GB + 6 GB pasan de 15 GB
    await userEvent.click(video(h, 'Pesado'));
    const otro = video(h, 'Otro pesado');
    expect(otro).toHaveAttribute('aria-disabled', 'true');
    expect(within(otro.closest('li')!).getByText('Pesan demasiado juntos · máximo 15 GB')).toBeInTheDocument();
    await userEvent.click(video(h, 'Pesado'));
    // 12 marcados: el 13.º dice que es el máximo
    for (const v of doce) await userEvent.click(video(h, v.titulo + ','));
    const trece = video(h, 'Pesado');
    expect(trece).toHaveAttribute('aria-disabled', 'true');
    expect(within(trece.closest('li')!).getByText('Ya son 12 videos · es el máximo')).toBeInTheDocument();
    expect(h.getByRole('button', { name: 'Usar 12 videos' })).toBeInTheDocument();
  });

  it('inicio.hojavideos.los_limites_que_manda_el_servidor_ganan_a_los_de_respaldo', async () => {
    montar(() => json(lista([elegible({ titulo: 'Uno', duracion_s: 2000 }), elegible({ titulo: 'Dos', duracion_s: 2000 })], { ...LIMITES, max_s: 3600 })));
    render(<Montaje />);
    const h = await abierta();
    await userEvent.click(video(h, 'Uno'));
    expect(video(h, 'Dos')).toHaveAttribute('aria-disabled', 'true');
    expect(within(video(h, 'Dos').closest('li')!).getByText('Se pasa de 60 min')).toBeInTheDocument();
    expect(h.getByText(/debe durar de 1 a 60 min/)).toBeInTheDocument();
  });

  it('tocar uno apagado no hace nada y sigue enfocable, sin disabled', async () => {
    montar();
    render(<Montaje />);
    const h = await abierta();
    await userEvent.click(video(h, 'Cómo edito mis videos'));
    const vertical = video(h, 'Camino al volcán');
    expect(vertical).not.toBeDisabled();
    expect(vertical).toHaveAttribute('aria-disabled', 'true');
    vertical.focus();
    expect(vertical).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(vertical).toHaveAttribute('aria-pressed', 'false');
    expect(h.getByRole('button', { name: 'Usar este video' })).toBeInTheDocument(); // sigue siendo UNO
  });
});

describe('la hoja «Agregar videos»: el pie y los botones', () => {
  it('inicio.hojavideos.un_solo_video_corto_apaga_usar_este_video_y_dice_que_hace_falta_otro', async () => {
    montar();
    render(<Montaje />);
    const h = await abierta();
    expect(textoDelPie()).toBe('Elige uno o varios videos. Se unen en el orden en que los marques.');
    const usar = h.getByRole('button', { name: 'Usar videos' });
    expect(usar).toHaveAttribute('aria-disabled', 'true');
    expect(usar).not.toBeDisabled();
    await userEvent.click(video(h, 'Perro en la playa'));
    const usarUno = h.getByRole('button', { name: 'Usar este video' });
    expect(usarUno).toHaveAttribute('aria-disabled', 'true');
    expect(textoDelPie()).toBe('1 video · 0:08 en total.Un video de menos de 1 min no se puede editar solo. Marca otro para unirlos.');
    expect(usarUno).toHaveAccessibleDescription(expect.stringContaining('Un video de menos de 1 min no se puede editar solo. Marca otro para unirlos.'));
    await userEvent.click(usarUno);
    expect(espias.alUsar).not.toHaveBeenCalled();
    expect(hoja()).toBeInTheDocument();
    // con otro video se unen: ya se puede usar
    await userEvent.click(video(h, 'El tren de papel,'));
    expect(h.getByRole('button', { name: 'Usar 2 videos' })).not.toHaveAttribute('aria-disabled');
    // un video de 60,0 s alcanza solo (mínimo de 1 min): ni alerta ni apagado
    await userEvent.click(video(h, 'El tren de papel,'));
    await userEvent.click(video(h, 'Perro en la playa'));
    await userEvent.click(video(h, 'Cómo edito mis videos'));
    expect(h.getByRole('button', { name: 'Usar este video' })).not.toHaveAttribute('aria-disabled');
  });

  it('un solo video corto se junta con lo que ya hay en la caja: ahí son dos y se pueden unir', async () => {
    montar();
    render(<Montaje enCaja={[{ ref: 'proyecto:subida', duracion_s: 600, formato: 'horizontal', bytes: 1 }]} />);
    const h = await abierta();
    await userEvent.click(video(h, 'Perro en la playa'));
    expect(h.getByRole('button', { name: 'Usar este video' })).not.toHaveAttribute('aria-disabled');
    expect(textoDelPie()).toBe('1 video · 0:08 en total · Con los de la caja serán 2 (10:08). Se edita una copia; tus originales no se tocan.');
  });

  it('inicio.hojavideos.usar_n_videos_los_entrega_en_el_orden_de_marcado_cierra_y_devuelve_el_foco_al_mas', async () => {
    montar();
    render(<Montaje />);
    const h = await abierta();
    await userEvent.click(video(h, 'Cómo edito mis videos'));
    await userEvent.click(video(h, 'Perro en la playa'));
    await userEvent.click(video(h, 'El tren de papel,'));
    await userEvent.click(h.getByRole('button', { name: 'Usar 3 videos' }));
    // el orden en que se marcaron, con sus datos del servidor
    expect(espias.alUsar).toHaveBeenCalledTimes(1);
    expect(espias.alUsar.mock.calls[0]![0].map(v => v.ref)).toEqual([ENTREVISTA.ref, PERRO.ref, TREN.ref]);
    expect(espias.alUsar.mock.calls[0]![0][0]).toEqual(ENTREVISTA);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(abrir()).toHaveFocus();
  });

  it('inicio.hojavideos.cerrar_por_donde_sea_olvida_lo_marcado_y_devuelve_el_foco_al_mas', async () => {
    montar();
    render(<Montaje />);
    const cerradores: Array<[string, () => Promise<void>]> = [
      ['Cancelar', async () => void (await userEvent.click(within(hoja()).getByRole('button', { name: 'Cancelar' })))],
      ['Esc', async () => void (await userEvent.keyboard('{Escape}'))],
      ['la equis', async () => void (await userEvent.click(within(hoja()).getByRole('button', { name: 'Cerrar' })))],
      [
        'el velo',
        async () => {
          // la gracia del velo (300 ms desde que se abre) no deja que un clic recién abierto lo cierre: se espera
          await new Promise(r => setTimeout(r, 350));
          await userEvent.pointer({ keys: '[MouseLeft]', target: document.querySelector('.fixed.inset-0')! });
        },
      ],
    ];
    for (const [cual, cerrar] of cerradores) {
      const h = await abierta();
      await userEvent.click(video(h, 'Cómo edito mis videos'));
      expect(video(h, 'Cómo edito mis videos')).toHaveAttribute('aria-pressed', 'true');
      await cerrar();
      await waitFor(() => expect(screen.queryByRole('dialog'), cual).toBeNull());
      expect(abrir(), cual).toHaveFocus();
      expect(espias.alUsar).not.toHaveBeenCalled();
      // al volver a abrir no queda nada marcado
      const h2 = await abierta();
      expect(video(h2, 'Cómo edito mis videos'), cual).toHaveAttribute('aria-pressed', 'false');
      expect(textoDelPie(), cual).toBe('Elige uno o varios videos. Se unen en el orden en que los marques.');
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
  });

  it('el foco entra a la hoja, no sale de ella con Tab y el orden es filtros, videos, no se pueden editar, pie y botones', async () => {
    montar();
    render(<Montaje />);
    await abierta();
    expect(hoja().contains(document.activeElement)).toBe(true);
    const enfocables = () =>
      Array.from(hoja().querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])')).filter(
        e => !e.closest('[aria-hidden="true"]') && !['tabpanel', 'tablist'].includes(e.getAttribute('role') ?? ''),
      );
    const nombres = enfocables().map(e => e.getAttribute('aria-label') ?? e.textContent);
    // pestañas, filtros, los videos que se pueden elegir, los que no, y los botones del pie
    expect(nombres.slice(0, 2)).toEqual(['Cerrar', 'Mis creaciones']);
    const iFiltro = nombres.findIndex(t => /^Todo/.test(t ?? ''));
    const iVideo = nombres.findIndex(t => /^El tren de papel, 0:30/.test(t ?? ''));
    const iAparte = nombres.findIndex(t => /^Documental completo/.test(t ?? ''));
    const iCancelar = nombres.indexOf('Cancelar');
    expect(iFiltro).toBeGreaterThan(1);
    expect(iVideo).toBeGreaterThan(iFiltro);
    expect(iAparte).toBeGreaterThan(iVideo);
    expect(iCancelar).toBeGreaterThan(iAparte);
    expect(nombres.at(-1)).toBe('Usar videos');
  });

  it('Espacio y Enter alternan un video, y las flechas recorren las pestañas', async () => {
    montar();
    render(<Montaje />);
    const h = await abierta();
    const uno = video(h, 'Cómo edito mis videos');
    uno.focus();
    await userEvent.keyboard(' ');
    expect(uno).toHaveAttribute('aria-pressed', 'true');
    await userEvent.keyboard('{Enter}');
    expect(uno).toHaveAttribute('aria-pressed', 'false');
    h.getByRole('tab', { name: 'Mis creaciones' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(h.getByRole('tab', { name: 'Mi computadora' })).toHaveAttribute('aria-selected', 'true');
  });

  it('mientras hay un trabajo en curso «Usar» y los archivos no agregan nada', async () => {
    montar();
    render(<Montaje ocupado />);
    const h = await abierta();
    await userEvent.click(video(h, 'Cómo edito mis videos'));
    await userEvent.click(h.getByRole('button', { name: 'Usar este video' }));
    expect(espias.alUsar).not.toHaveBeenCalled();
    await userEvent.click(h.getByRole('tab', { name: 'Mi computadora' }));
    await userEvent.click(h.getByRole('button', { name: 'Elegir archivos…' }));
    expect(espias.alElegirArchivos).not.toHaveBeenCalled();
    expect(hoja()).toBeInTheDocument();
  });
});

describe('la hoja «Agregar videos»: Mi computadora', () => {
  const archivo = (nombre: string, tipo = 'video/mp4') => new File(['x'], nombre, { type: tipo });

  it('inicio.hojavideos.mi_computadora_agrega_primero_lo_marcado_y_luego_los_archivos', async () => {
    montar();
    render(<Montaje />);
    const h = await abierta();
    await userEvent.click(video(h, 'Cómo edito mis videos'));
    await userEvent.click(video(h, 'Perro en la playa'));
    await userEvent.click(h.getByRole('tab', { name: 'Mi computadora' }));
    expect(h.getByText('Arrastra tus videos aquí')).toBeInTheDocument();
    expect(
      h.getByText('MP4, MOV o M4V, hasta 90 minutos en total. Para editar un solo video, debe durar al menos 1 minuto; para unir varios no hay mínimo.'),
    ).toBeInTheDocument();
    expect(h.getByText('Se agregan junto con los 2 videos que marcaste en Mis creaciones.')).toBeInTheDocument();
    // «Elegir archivos…» entrega lo marcado (en su orden), cierra y deja que la caja abra el selector
    await userEvent.click(h.getByRole('button', { name: 'Elegir archivos…' }));
    expect(espias.alElegirArchivos).toHaveBeenCalledTimes(1);
    expect(espias.alElegirArchivos.mock.calls[0]![0].map(v => v.ref)).toEqual([ENTREVISTA.ref, PERRO.ref]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(abrir()).toHaveFocus();
    expect(espias.alUsar).not.toHaveBeenCalled();
    // soltar videos hace lo mismo con los archivos
    const h2 = await abierta();
    await userEvent.click(video(h2, 'El tren de papel,'));
    await userEvent.click(h2.getByRole('tab', { name: 'Mi computadora' }));
    expect(h2.getByText('Se agrega junto con el video que marcaste en Mis creaciones.')).toBeInTheDocument();
    const zona = h2.getByText('Arrastra tus videos aquí').parentElement!;
    const mp4 = archivo('entrevista.mp4');
    fireEvent.drop(zona, { dataTransfer: { files: [mp4, archivo('b.mov', '')], types: ['Files'] } });
    expect(espias.alSoltarArchivos).toHaveBeenCalledTimes(1);
    expect(espias.alSoltarArchivos.mock.calls[0]![0].map(f => f.name)).toEqual(['entrevista.mp4', 'b.mov']);
    expect(espias.alSoltarArchivos.mock.calls[0]![1].map(v => v.ref)).toEqual([TREN.ref]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('inicio.hojavideos.soltar_algo_que_no_es_video_no_cierra_la_hoja_y_lo_dice_adentro', async () => {
    montar();
    render(<Montaje />);
    const h = await abierta();
    await userEvent.click(h.getByRole('tab', { name: 'Mi computadora' }));
    const zona = h.getByText('Arrastra tus videos aquí').parentElement!;
    fireEvent.drop(zona, { dataTransfer: { files: [archivo('foto.png', 'image/png')], types: ['Files'] } });
    const alerta = h.getByRole('alert');
    expect(alerta).toHaveTextContent('Solo sirven videos: MP4, MOV o M4V · hasta 5 GB.');
    expect(hoja()).toContainElement(alerta);
    expect(espias.alSoltarArchivos).not.toHaveBeenCalled();
    expect(hoja()).toBeInTheDocument();
    // un video después quita el aviso
    fireEvent.drop(zona, { dataTransfer: { files: [archivo('ok.mp4')], types: ['Files'] } });
    expect(espias.alSoltarArchivos).toHaveBeenCalledTimes(1);
  });

  it('inicio.hojavideos.el_pie_cambia_con_la_pestana_y_la_zona_se_marca_al_arrastrar', async () => {
    montar();
    render(<Montaje />);
    const h = await abierta();
    expect(textoDelPie()).toBe('Elige uno o varios videos. Se unen en el orden en que los marques.');
    await userEvent.click(h.getByRole('tab', { name: 'Mi computadora' }));
    expect(textoDelPie()).toBe('Se sube de tu computadora y no cuesta créditos. Puedes subir varios.');
    // sin «Usar» en esta pestaña: solo Cancelar
    expect(h.queryByRole('button', { name: /^Usar/ })).toBeNull();
    expect(h.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    const zona = h.getByText('Arrastra tus videos aquí').parentElement!;
    expect(zona.className).toContain('border-campo');
    fireEvent.dragOver(zona, { dataTransfer: { types: ['Files'] } });
    expect(zona.className).toContain('border-ambar');
    fireEvent.dragLeave(zona, { relatedTarget: document.body });
    expect(zona.className).toContain('border-campo');
    await userEvent.click(h.getByRole('tab', { name: 'Mis creaciones' }));
    expect(textoDelPie()).toBe('Elige uno o varios videos. Se unen en el orden en que los marques.');
  });
});

describe('la hoja «Agregar videos»: lo tocable mide al menos 44 px y el texto 13 px', () => {
  it('filtros, videos, pestañas y botones tienen al menos 44 px de alto y ninguna letra baja de 13 px', async () => {
    montar();
    render(<Montaje />);
    const h = await abierta();
    const ALTO = /^(min-h-(11|12|14|16)|size-(11|12)|h-(11|12))$/;
    const mide44 = (el: HTMLElement) => el.className.split(/\s+/).some(c => ALTO.test(c));
    for (const f of within(h.getByRole('group', { name: 'Filtrar por tipo' })).getAllByRole('button')) expect(mide44(f), f.textContent ?? '').toBe(true);
    for (const t of h.getAllByRole('tab')) expect(mide44(t), t.textContent ?? '').toBe(true);
    expect(mide44(h.getByRole('button', { name: 'Cancelar' }))).toBe(true);
    expect(mide44(h.getByRole('button', { name: 'Usar videos' }))).toBe(true);
    expect(mide44(h.getByRole('button', { name: 'Cerrar' }))).toBe(true);
    // los videos son botones de toda la tarjeta (16:9 a todo el ancho de su columna): nunca más chicos que un dedo
    for (const b of h.getAllByRole('button', { name: /, \d+:\d\d/ })) expect(b.className).toContain('w-full');
    // nada usa una letra de menos de 13 px (`text-xs` es 13 px en la carta; ningún `text-[11px]`…)
    expect(hoja().innerHTML).not.toMatch(/text-\[(\d|1[0-2])px\]/);
  });
});
