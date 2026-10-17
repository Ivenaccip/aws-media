// La Biblioteca de prompts, como COMPORTAMIENTO (Ajustes 3, 16-oct-2026). Cada test empieza por el ID de su invariante: tests/test_migracion_ui.py
// exige que cada ID del registro exista aquí. El API es un doble (`servidor`): ni una petición sale de la máquina.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { json, llamadas, ponerMonedero, servidor, sinRed, type Ruta } from '../../prueba/servidor';
import { Biblioteca } from './Biblioteca';
import type { Prompt } from './logica';

const CATEGORIAS = [
  { clave: 'imagen', nombre: 'Imagen' },
  { clave: 'video', nombre: 'Video' },
  { clave: 'guion', nombre: 'Guion y texto' },
  { clave: 'investigacion', nombre: 'Investigación' },
];

const casa = (n: string, categoria: string, lleva_a: Prompt['lleva_a'], titulo: string, para_que: string, etiquetas: string[], prompt: string): Prompt => ({
  id: `casa-${n}`,
  titulo,
  para_que,
  prompt,
  categoria,
  etiquetas,
  lleva_a,
});

const RETRATO = casa('retrato', 'imagen', 'imagen', 'Retrato de estudio', 'Fotos de perfil con aspecto profesional', ['retrato', 'perfil'], 'Retrato de estudio de una persona sonriendo. Formato vertical 4:5.');
const ILUSTRACION = casa('ilustracion', 'imagen', 'imagen', 'Ilustración plana', 'Explicar una idea sin usar fotos', ['educación', 'blog'], 'Ilustración plana y colorida que explica la idea de [IDEA]. Sin texto.');
const CAFE = casa('cafe', 'video', 'video', 'Café con vapor', 'Tomas de ambiente para un video de comida', ['comida'], 'Plano cerrado de una taza de café con vapor. Duración: 5 segundos.');
const GUION = casa('guion', 'guion', null, 'Guion de 30 segundos', 'Videos cortos de venta', ['ventas', 'redes'], 'Escribe un guion de 30 segundos para presentar [PRODUCTO] a [PÚBLICO].');
const COMPETENCIA = casa('competencia', 'investigacion', null, 'Mapa de la competencia', 'Comparar rivales sin inventar cifras', ['mercado', 'ventas'], 'Actúa como analista de mercado y compara cinco rivales.');
const CASA = [RETRATO, ILUSTRACION, CAFE, GUION, COMPETENCIA];

const mio = (hex: string, titulo: string, prompt: string): Prompt => ({
  id: `mio-${hex}`,
  titulo,
  para_que: '',
  prompt,
  categoria: 'guion',
  etiquetas: [],
  lleva_a: null,
  origen: 'coi',
  creado: '2026-10-16T18:20:00Z',
});
const REEL = mio('0123456789ab', 'Reel de la semana', 'Escribe un guion de 20 segundos para [TEMA].');
const PORTADA = mio('ba9876543210', 'Ideas de portada', 'Dame cinco ideas de portada para [TEMA].');
const MIOS = [REEL, PORTADA];

interface Mundo {
  casa?: Prompt[];
  mios?: Prompt[];
  fijados?: string[];
  rutas?: Record<string, Ruta>;
}

function montar({ casa: c = CASA, mios = [], fijados = [], rutas = {} }: Mundo = {}) {
  const estado = { fijados: [...fijados] };
  return servidor({
    '/api/biblioteca': () =>
      json({ categorias: CATEGORIAS, casa: c, mios, fijados: estado.fijados, limites: { fijados: 3, mios: 100, titulo: 80, prompt: 16000 } }),
    '/api/biblioteca/fijados': (_u, init) => {
      const { ids } = JSON.parse(String(init?.body)) as { ids: string[] };
      estado.fijados = ids;
      return json({ fijados: ids });
    },
    '/api/biblioteca/mios': () => json({ ok: true }),
    ...rutas,
  });
}

const puts = (f: ReturnType<typeof servidor>) => llamadas(f, '/api/biblioteca/fijados', 'PUT').map(c => (JSON.parse(String(c[1]!.body)) as { ids: string[] }).ids);

const lista = () => screen.getByRole('list', { name: 'Prompts de la Biblioteca' });
const filas = () => within(lista()).getAllByRole('button');
const titulosDeFilas = () => filas().map(b => b.querySelector('b')!.textContent);
const esperarLista = () => screen.findByRole('list', { name: 'Prompts de la Biblioteca' });
const fila = (titulo: string) => within(lista()).getByRole('button', { name: new RegExp('^' + titulo) });
const buscador = () => screen.getByRole('searchbox', { name: 'Buscar un prompt' });
const detalle = () => document.getElementById('bib-detalle') as HTMLElement;
/** El panel de la derecha entero (el título, las acciones y sus notas). */
const panelDetalle = () => detalle().closest('section') as HTMLElement;
const franja = () => screen.getByRole('region', { name: 'Tus 3 fijados' });
const casillas = () => within(franja()).getAllByRole('listitem');
const alternador = () => screen.getByRole('button', { name: /^(Fijar|Quitar de fijados) «/ });
const ambito = (n: 'De la casa' | 'Míos') => within(screen.getByRole('group', { name: 'De quién son los prompts' })).getByRole('button', { name: new RegExp('^' + n) });
const chip = (n: string) => within(screen.getByRole('group', { name: 'Categoría' })).getByRole('button', { name: n });
const copiarBoton = () => screen.getByRole('button', { name: /^(Copiar el prompt|Copiado)/ });

/** Los botones y enlaces que de verdad son ámbar (el principal de la carta): solo puede haber uno. */
const principales = () => Array.from(document.querySelectorAll('button, a')).filter(e => e.classList.contains('bg-ambar'));

function ponerPortapapeles(escribir: (t: string) => Promise<void>) {
  const writeText = vi.fn(escribir);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

let monedero: ReturnType<typeof ponerMonedero>;
beforeEach(() => {
  vi.unstubAllGlobals();
  monedero = ponerMonedero(100);
  history.replaceState(null, '', '/estudio/biblioteca/');
});
afterEach(() => {
  delete window.monedero;
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(document, 'execCommand');
  Reflect.deleteProperty(window, 'matchMedia');
  window.getSelection()?.removeAllRanges();
});

describe('biblioteca', () => {
  // ---- la carga ----

  it('biblioteca.carga.una_sola_lectura_con_conteos_por_categoria', async () => {
    const f = montar({ mios: MIOS });
    render(<Biblioteca />);
    await esperarLista();
    // una carga y listo: lo demás se filtra en el navegador
    expect(llamadas(f, '/api/biblioteca', 'GET')).toHaveLength(1);
    expect(titulosDeFilas()).toEqual(CASA.map(p => p.titulo));
    expect(chip('Todos 5')).toBeInTheDocument();
    expect(chip('Imagen 2')).toBeInTheDocument();
    expect(chip('Video 1')).toBeInTheDocument();
    expect(chip('Guion y texto 1')).toBeInTheDocument();
    expect(chip('Investigación 1')).toBeInTheDocument();
    expect(screen.getByText('5 prompts')).toBeInTheDocument();
    // el primero se ve elegido, con su prompt completo
    expect(fila('Retrato de estudio')).toHaveAttribute('aria-current', 'true');
    expect(detalle()).toHaveTextContent('Retrato de estudio');
    expect(screen.getByText(RETRATO.prompt)).toBeInTheDocument();
  });

  it('biblioteca.carga.cargando_y_error_con_reintentar', async () => {
    let intento = 0;
    const f = montar({
      rutas: {
        '/api/biblioteca': () => {
          intento += 1;
          return intento === 1
            ? json({ detail: { codigo: 'no_disponible', texto: 'No se pudo leer la Biblioteca.' } }, 503)
            : json({ categorias: CATEGORIAS, casa: CASA, mios: [], fijados: [], limites: { fijados: 3, mios: 100, titulo: 80, prompt: 16000 } });
        },
      },
    });
    render(<Biblioteca />);
    // mientras llega: un estado que se dice, y lo que se ve es el esqueleto de la lista
    expect(screen.getByText('Cargando la Biblioteca…')).toBeInTheDocument();
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No pudimos cargar la Biblioteca');
    expect(alerta).toHaveTextContent('No pudimos traer los prompts. Puede ser algo pasajero: inténtalo otra vez en unos segundos.');
    expect(screen.queryByText('Cargando la Biblioteca…')).toBeNull();
    await userEvent.click(within(alerta).getByRole('button', { name: 'Reintentar' }));
    await esperarLista();
    expect(llamadas(f, '/api/biblioteca', 'GET')).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('biblioteca.carga.sin_red_pide_revisar_la_conexion', async () => {
    montar({ rutas: { '/api/biblioteca': sinRed } });
    render(<Biblioteca />);
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No hay conexión. Revisa tu internet y vuelve a intentar.');
    expect(within(alerta).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('biblioteca.carga.vacia_manda_a_coi', async () => {
    montar({ casa: [] });
    render(<Biblioteca />);
    expect(await screen.findByRole('heading', { name: 'Aún no hay prompts en la Biblioteca' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Diseñar un prompt con COI/ })).toHaveAttribute('href', '/estudio/coi/');
    expect(screen.queryByRole('list', { name: 'Prompts de la Biblioteca' })).toBeNull();
  });

  // ---- buscar y filtrar ----

  it('biblioteca.buscar.sin_acentos_ni_mayusculas_sobre_titulo_para_que_etiquetas_y_categoria', async () => {
    montar();
    render(<Biblioteca />);
    await esperarLista();
    // el título, sin acento y en mayúsculas
    await userEvent.type(buscador(), 'ILUSTRACION');
    expect(titulosDeFilas()).toEqual(['Ilustración plana']);
    // «para qué sirve»
    await userEvent.clear(buscador());
    await userEvent.type(buscador(), 'comida');
    expect(titulosDeFilas()).toEqual(['Café con vapor']);
    // una etiqueta con tilde, buscada sin ella
    await userEvent.clear(buscador());
    await userEvent.type(buscador(), 'educacion');
    expect(titulosDeFilas()).toEqual(['Ilustración plana']);
    // la categoría: «investigacion» (sin tilde) trae lo de Investigación
    await userEvent.clear(buscador());
    await userEvent.type(buscador(), 'investigacion');
    expect(titulosDeFilas()).toEqual(['Mapa de la competencia']);
    // varias palabras: todas tienen que estar
    await userEvent.clear(buscador());
    await userEvent.type(buscador(), 'ventas guion');
    expect(titulosDeFilas()).toEqual(['Guion de 30 segundos']);
    expect(screen.getByText('1 resultado para «ventas guion»')).toBeInTheDocument();
  });

  it('biblioteca.buscar.sin_resultados_ofrece_coi_y_quitar_filtros', async () => {
    montar();
    render(<Biblioteca />);
    await esperarLista();
    await userEvent.type(buscador(), 'zapatos de baile');
    expect(screen.queryByRole('list', { name: 'Prompts de la Biblioteca' })).toBeNull();
    expect(screen.getByText('Sin resultados para «zapatos de baile»')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No encontramos ese prompt' })).toBeInTheDocument();
    const ofertas = screen.getAllByRole('link', { name: /COI/ });
    expect(ofertas.every(a => a.getAttribute('href') === '/estudio/coi/')).toBe(true);
    // el único ámbar de la pantalla es «Diseñar uno con COI»
    expect(principales().map(e => e.textContent)).toEqual(['Diseñar uno con COI']);
    await userEvent.click(within(panelDetalle()!).getByRole('button', { name: 'Quitar filtros' }));
    expect(titulosDeFilas()).toHaveLength(5);
    expect(buscador()).toHaveValue('');
  });

  it('biblioteca.buscar.chips_con_conteo_que_siguen_a_la_busqueda_y_filtran_por_categoria', async () => {
    montar();
    render(<Biblioteca />);
    await esperarLista();
    await userEvent.click(chip('Video 1'));
    expect(chip('Video 1')).toHaveAttribute('aria-pressed', 'true');
    expect(titulosDeFilas()).toEqual(['Café con vapor']);
    expect(screen.getByText('1 resultado en Video')).toBeInTheDocument();
    // el prompt elegido sigue a la lista: el primero de lo filtrado
    expect(detalle()).toHaveTextContent('Café con vapor');
    // la búsqueda cambia los números de TODAS las categorías (y no los de la elegida pierde el resto)
    await userEvent.click(chip('Todos 5'));
    await userEvent.type(buscador(), 'ventas');
    expect(chip('Todos 2')).toBeInTheDocument();
    expect(chip('Guion y texto 1')).toBeInTheDocument();
    expect(chip('Investigación 1')).toBeInTheDocument();
    expect(chip('Imagen 0')).toBeInTheDocument();
    await userEvent.click(chip('Guion y texto 1'));
    expect(titulosDeFilas()).toEqual(['Guion de 30 segundos']);
    expect(screen.getByText('1 resultado para «ventas» en Guion y texto')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect(titulosDeFilas()).toHaveLength(5);
  });

  it('biblioteca.buscar.una_etiqueta_del_detalle_filtra_y_se_quita', async () => {
    montar();
    render(<Biblioteca />);
    await esperarLista();
    // el prompt elegido es Retrato: sus etiquetas son #retrato y #perfil
    await userEvent.click(screen.getByRole('button', { name: '#retrato: ver los prompts con esa etiqueta' }));
    expect(titulosDeFilas()).toEqual(['Retrato de estudio']);
    expect(screen.getByText('1 resultado con #retrato')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Quitar la etiqueta retrato' }));
    expect(titulosDeFilas()).toHaveLength(5);
    // con #ventas desde el detalle del guion
    await userEvent.click(fila('Guion de 30 segundos'));
    await userEvent.click(screen.getByRole('button', { name: '#ventas: ver los prompts con esa etiqueta' }));
    expect(titulosDeFilas()).toEqual(['Guion de 30 segundos', 'Mapa de la competencia']);
  });

  it('biblioteca.buscar.quitar_filtros_y_quitar_la_etiqueta_dejan_el_foco_en_el_buscador', async () => {
    montar();
    render(<Biblioteca />);
    await esperarLista();
    // estos botones solo existen mientras hay filtro: al pulsarlos se desmontan con el foco puesto, y debe pasar al buscador, no a <body>
    // 1 · «Quitar filtros» de arriba de la lista
    await userEvent.type(buscador(), 'retrato');
    await userEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect(buscador()).toHaveValue('');
    expect(buscador()).toHaveFocus();
    // 2 · «Quitar filtros» del panel «No encontramos ese prompt»
    await userEvent.type(buscador(), 'zapatos de baile');
    await userEvent.click(within(panelDetalle()).getByRole('button', { name: 'Quitar filtros' }));
    expect(titulosDeFilas()).toHaveLength(5);
    expect(buscador()).toHaveFocus();
    // 3 · «Quitar la etiqueta»
    await userEvent.click(screen.getByRole('button', { name: '#retrato: ver los prompts con esa etiqueta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Quitar la etiqueta retrato' }));
    expect(titulosDeFilas()).toHaveLength(5);
    expect(buscador()).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  // ---- la lista: una parada de Tab ----

  it('biblioteca.lista.una_parada_de_tab_con_flechas_inicio_y_fin', async () => {
    montar();
    render(<Biblioteca />);
    await esperarLista();
    // una sola fila tiene la parada: la elegida
    expect(filas().filter(b => b.tabIndex === 0)).toEqual([fila('Retrato de estudio')]);
    fila('Retrato de estudio').focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(fila('Ilustración plana')).toHaveFocus();
    // la parada de Tab sigue al foco
    expect(filas().filter(b => b.tabIndex === 0)).toEqual([fila('Ilustración plana')]);
    await userEvent.keyboard('{End}');
    expect(fila('Mapa de la competencia')).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}'); // en el extremo se queda
    expect(fila('Mapa de la competencia')).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(fila('Retrato de estudio')).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(fila('Retrato de estudio')).toHaveFocus();
    // mover el foco no elige: Enter elige
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(fila('Retrato de estudio')).toHaveAttribute('aria-current', 'true');
    await userEvent.keyboard('{Enter}');
    expect(fila('Café con vapor')).toHaveAttribute('aria-current', 'true');
    expect(detalle()).toHaveTextContent('Café con vapor');
    // Tab sale de la lista de una vez (no recorre las 5 filas)
    await userEvent.tab();
    expect(lista().contains(document.activeElement)).toBe(false);
  });

  // ---- copiar ----

  it('biblioteca.copiar.usa_el_portapapeles_y_confirma_sin_mover_el_foco', async () => {
    montar();
    const escribir = ponerPortapapeles(async () => undefined);
    render(<Biblioteca />);
    await esperarLista();
    const boton = copiarBoton();
    boton.focus();
    await userEvent.click(boton);
    expect(escribir).toHaveBeenCalledWith(RETRATO.prompt);
    // confirma en el propio botón y en la región de avisos; el foco no se movió
    const listo = await screen.findByRole('button', { name: 'Copiado: Retrato de estudio' });
    expect(listo).toBe(boton);
    expect(listo).toHaveTextContent('Copiado');
    expect(boton).toHaveFocus();
    await waitFor(() => expect(document.querySelector('[aria-live="polite"][aria-atomic="true"]')).toHaveTextContent('Copiado: Retrato de estudio.'));
    // y vuelve a «Copiar» solo, sin que nadie lo toque
    await waitFor(() => expect(copiarBoton()).toHaveAccessibleName('Copiar el prompt «Retrato de estudio»'), { timeout: 3500 });
    expect(boton).toHaveFocus();
  });

  it('biblioteca.copiar.reserva_con_el_metodo_viejo_si_el_navegador_niega_la_api', async () => {
    montar();
    ponerPortapapeles(() => Promise.reject(new DOMException('negado', 'NotAllowedError')));
    const viejo = vi.fn(() => true);
    document.execCommand = viejo;
    render(<Biblioteca />);
    await esperarLista();
    await userEvent.click(copiarBoton());
    expect(await screen.findByRole('button', { name: 'Copiado: Retrato de estudio' })).toBeInTheDocument();
    expect(viejo).toHaveBeenCalledWith('copy');
  });

  it('biblioteca.copiar.ultima_reserva_deja_el_prompt_seleccionado_y_lo_dice', async () => {
    montar();
    ponerPortapapeles(() => Promise.reject(new DOMException('negado', 'NotAllowedError')));
    document.execCommand = vi.fn(() => false);
    render(<Biblioteca />);
    await esperarLista();
    await userEvent.click(copiarBoton());
    await waitFor(() => expect(window.getSelection()?.toString()).toBe(RETRATO.prompt));
    expect(document.querySelector('[aria-live="polite"][aria-atomic="true"]')).toHaveTextContent('No se pudo copiar solo. El prompt quedó seleccionado: cópialo con Ctrl y C.');
    // no se dijo «Copiado»: no se copió
    expect(screen.queryByRole('button', { name: /^Copiado/ })).toBeNull();
  });

  // ---- llevar a la caja ----

  it('biblioteca.llevar.imagen_y_video_van_al_inicio_con_el_texto_codificado', async () => {
    montar();
    render(<Biblioteca />);
    await esperarLista();
    // Imagen → ?prompt=
    const imagen = screen.getByRole('link', { name: 'Llevar a la caja' });
    expect(imagen).toHaveAttribute('href', '/estudio/inicio/?prompt=' + encodeURIComponent(RETRATO.prompt));
    expect(new URL(imagen.getAttribute('href')!, 'http://x').searchParams.get('prompt')).toBe(RETRATO.prompt);
    expect(panelDetalle()).toHaveTextContent('en la pestaña Imagen');
    // un prompt con huecos y tildes viaja entero
    await userEvent.click(fila('Ilustración plana'));
    const conHuecos = screen.getByRole('link', { name: 'Llevar a la caja' });
    expect(conHuecos.getAttribute('href')).toContain('%5BIDEA%5D');
    expect(new URL(conHuecos.getAttribute('href')!, 'http://x').searchParams.get('prompt')).toBe(ILUSTRACION.prompt);
    // Video → ?brief=
    await userEvent.click(fila('Café con vapor'));
    const video = screen.getByRole('link', { name: 'Llevar a la caja' });
    expect(video).toHaveAttribute('href', '/estudio/inicio/?brief=' + encodeURIComponent(CAFE.prompt));
    expect(panelDetalle()).toHaveTextContent('en la pestaña Video');
  });

  it('biblioteca.llevar.guion_e_investigacion_y_los_mios_solo_se_copian', async () => {
    montar({ mios: MIOS });
    render(<Biblioteca />);
    await esperarLista();
    await userEvent.click(fila('Guion de 30 segundos'));
    expect(screen.queryByRole('link', { name: 'Llevar a la caja' })).toBeNull();
    expect(panelDetalle()).toHaveTextContent('Cópialo y pégalo donde lo vayas a usar.');
    await userEvent.click(fila('Mapa de la competencia'));
    expect(screen.queryByRole('link', { name: 'Llevar a la caja' })).toBeNull();
    await userEvent.click(ambito('Míos'));
    expect(screen.queryByRole('link', { name: 'Llevar a la caja' })).toBeNull();
    expect(copiarBoton()).toBeInTheDocument();
  });

  it('biblioteca.llevar.el_ambar_es_llevar_si_existe_y_copiar_si_no_y_nunca_hay_dos', async () => {
    montar({ mios: MIOS });
    render(<Biblioteca />);
    await esperarLista();
    // Imagen: «Llevar a la caja» es el ámbar y «Copiar» el de borde
    expect(principales().map(e => e.textContent)).toEqual(['Llevar a la caja']);
    expect(copiarBoton().classList.contains('bg-ambar')).toBe(false);
    // Guion: «Copiar» pasa a ser el ámbar
    await userEvent.click(fila('Guion de 30 segundos'));
    expect(principales().map(e => e.textContent)).toEqual(['Copiar']);
    // con un fijado, el pin no es ámbar (es un interruptor): sigue habiendo uno solo
    await userEvent.click(alternador());
    expect(principales().map(e => e.textContent)).toEqual(['Copiar']);
    await userEvent.click(ambito('Míos'));
    expect(principales().map(e => e.textContent)).toEqual(['Copiar']);
  });

  it('biblioteca.llevar.mas_de_1800_caracteres_solo_se_copian', async () => {
    const largo = casa('largo', 'imagen', 'imagen', 'Un prompt larguísimo', 'Muy detallado', [], 'x'.repeat(1801));
    const justo = casa('justo', 'imagen', 'imagen', 'Un prompt justo', 'Muy detallado', [], 'y'.repeat(1800));
    montar({ casa: [largo, justo] });
    render(<Biblioteca />);
    await esperarLista();
    // 1801: no se lleva; lo dice y «Copiar» es el ámbar
    expect(screen.queryByRole('link', { name: 'Llevar a la caja' })).toBeNull();
    expect(panelDetalle()).toHaveTextContent('Es muy largo para llevarlo a la caja: cópialo y pégalo donde lo vayas a usar.');
    expect(principales().map(e => e.textContent)).toEqual(['Copiar']);
    // 1800: se lleva
    await userEvent.click(fila('Un prompt justo'));
    expect(screen.getByRole('link', { name: 'Llevar a la caja' })).toHaveAttribute('href', '/estudio/inicio/?prompt=' + 'y'.repeat(1800));
  });

  it('biblioteca.llevar.el_texto_es_texto_nunca_html', async () => {
    const malo = casa('malo', 'imagen', 'imagen', '<b>negritas</b> en el título', 'Con <i>cursivas</i>', ['<u>x</u>'], '<img src=x onerror="window.__roto=1"> y [HUECO] & "comillas"');
    montar({ casa: [malo] });
    const { container } = render(<Biblioteca />);
    await esperarLista();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b:not(.block)')).toBeNull();
    expect(container.querySelector('i')).toBeNull();
    expect(container.querySelector('u')).toBeNull();
    expect(screen.getByText(/<img src=x onerror="window.__roto=1">/)).toBeInTheDocument();
    expect((window as unknown as { __roto?: number }).__roto).toBeUndefined();
    // y en la dirección va codificado, sin romper la URL
    const href = screen.getByRole('link', { name: 'Llevar a la caja' }).getAttribute('href')!;
    expect(href.startsWith('/estudio/inicio/?prompt=')).toBe(true);
    expect(href).not.toMatch(/[<>"\s]/);
  });

  // ---- fijar ----

  it('biblioteca.fijar.interruptor_con_aria_pressed_que_se_guarda_en_el_servidor', async () => {
    const f = montar();
    render(<Biblioteca />);
    await esperarLista();
    const pin = alternador();
    expect(pin).toHaveAttribute('aria-pressed', 'false');
    expect(pin).toHaveAccessibleName('Fijar «Retrato de estudio»');
    expect(pin).toHaveTextContent('Fijar');
    await userEvent.click(pin);
    // el mismo botón, ahora encendido, y con su nombre al día
    expect(pin).toHaveAttribute('aria-pressed', 'true');
    expect(pin).toHaveAccessibleName('Quitar de fijados «Retrato de estudio»');
    expect(pin).toHaveTextContent('Quitar de fijados');
    await waitFor(() => expect(puts(f)).toEqual([['casa-retrato']]));
    // la lista lo marca y la franja lo muestra en la casilla 1
    expect(within(fila('Retrato de estudio')).getByText('Fijado')).toBeInTheDocument();
    expect(within(casillas()[0]!).getByRole('button', { name: 'Retrato de estudio' })).toBeInTheDocument();
    // quitarlo
    await userEvent.click(pin);
    expect(pin).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(puts(f)).toEqual([['casa-retrato'], []]));
    expect(within(casillas()[0]!).getByText('Fija aquí un prompt que quieras recordar')).toBeInTheDocument();
  });

  it('biblioteca.fijar.el_estado_viene_del_servidor_y_lo_que_ya_no_existe_no_se_ensena', async () => {
    montar({ fijados: ['casa-cafe', 'casa-que-ya-no-existe', 'casa-retrato'] });
    render(<Biblioteca />);
    await esperarLista();
    // un fijado huérfano no abre nada ni ocupa casilla; el orden es el del servidor
    const nombres = casillas().map(c => within(c).queryAllByRole('button')[0]?.textContent ?? c.textContent!.replace(/^\d/, ''));
    expect(nombres).toEqual(['Café con vapor', 'Retrato de estudio', 'Fija aquí un prompt que quieras recordar']);
    await userEvent.click(fila('Café con vapor'));
    expect(alternador()).toHaveAttribute('aria-pressed', 'true');
  });

  it('biblioteca.fijar.es_optimista_y_vuelve_atras_si_el_servidor_falla', async () => {
    let soltar!: (r: Response) => void;
    const f = montar({ rutas: { '/api/biblioteca/fijados': () => new Promise<Response>(r => (soltar = r)) } });
    render(<Biblioteca />);
    await esperarLista();
    await userEvent.click(alternador());
    // se ve YA, con la petición todavía en vuelo
    expect(alternador()).toHaveAttribute('aria-pressed', 'true');
    expect(within(casillas()[0]!).getByRole('button', { name: 'Retrato de estudio' })).toBeInTheDocument();
    expect(puts(f)).toHaveLength(1);
    await act(async () => soltar(json({ detail: { codigo: 'no_disponible', texto: 'No se pudo guardar tus fijados ahora.' } }, 503)));
    // vuelve atrás y lo dice, con el texto del servidor
    await waitFor(() => expect(alternador()).toHaveAttribute('aria-pressed', 'false'));
    expect(within(casillas()[0]!).queryByRole('button', { name: 'Retrato de estudio' })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo guardar tus fijados ahora. Tus fijados quedaron como estaban.');
  });

  it('biblioteca.fijar.desde_una_pantalla_vieja_no_pisa_lo_fijado_en_otro_aparato', async () => {
    // otro aparato ya fijó «Café con vapor»; esta pantalla se abrió con la lista vacía y fija «Retrato de estudio»
    let otroYaFijo = true;
    const f = montar({
      rutas: {
        '/api/biblioteca/fijados': (_u, init) => {
          const { ids, esperada } = JSON.parse(String(init?.body)) as { ids: string[]; esperada?: string[] };
          if (otroYaFijo && esperada?.length === 0) {
            otroYaFijo = false;
            return json(
              { detail: { codigo: 'cambiaron', texto: 'Tus fijados cambiaron en otra pestaña o aparato. Ya los actualizamos.', fijados: ['casa-cafe'] } },
              409,
            );
          }
          return json({ fijados: ids });
        },
      },
    });
    render(<Biblioteca />);
    await esperarLista();
    const pin = alternador();
    pin.focus();
    await userEvent.click(pin);
    const cuerpo = (n: number) => JSON.parse(String(llamadas(f, '/api/biblioteca/fijados', 'PUT')[n]![1]!.body)) as { ids: string[]; esperada: string[] };
    // cada PUT dice sobre qué lista se basa
    expect(cuerpo(0)).toEqual({ ids: ['casa-retrato'], esperada: [] });
    // el servidor no deja pisar: la pantalla adopta lo vigente (el fijado del otro aparato) y lo dice, sin mover el foco
    await waitFor(() => expect(within(casillas()[0]!).getByRole('button', { name: 'Café con vapor' })).toBeInTheDocument());
    expect(alternador()).toHaveAttribute('aria-pressed', 'false');
    const nota = within(panelDetalle()).getByRole('status');
    expect(nota).toHaveTextContent('Tus fijados cambiaron en otra pestaña o aparato. Ya los actualizamos.');
    // no es "tus fijados quedaron como estaban": quedaron como están en el servidor
    expect(nota).not.toHaveTextContent('quedaron como estaban');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(alternador()).toHaveFocus();
    // al volver a fijar parte de lo vigente: suma, no reemplaza
    await userEvent.click(alternador());
    await waitFor(() => expect(puts(f)).toHaveLength(2));
    expect(cuerpo(1)).toEqual({ ids: ['casa-cafe', 'casa-retrato'], esperada: ['casa-cafe'] });
  });

  it('biblioteca.fijar.sin_red_tambien_vuelve_atras', async () => {
    montar({ fijados: ['casa-cafe'], rutas: { '/api/biblioteca/fijados': sinRed } });
    render(<Biblioteca />);
    await esperarLista();
    await userEvent.click(alternador());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No hay conexión. Revisa tu internet y vuelve a intentar. Tus fijados quedaron como estaban.'));
    expect(alternador()).toHaveAttribute('aria-pressed', 'false');
    expect(within(casillas()[0]!).getByRole('button', { name: 'Café con vapor' })).toBeInTheDocument();
  });

  it('biblioteca.fijar.con_tres_ya_fijados_no_sustituye_en_silencio_y_no_mueve_el_foco', async () => {
    const f = montar({ fijados: ['casa-retrato', 'casa-cafe', 'casa-guion'] });
    render(<Biblioteca />);
    await esperarLista();
    await userEvent.click(fila('Ilustración plana'));
    const pin = alternador();
    pin.focus();
    await userEvent.click(pin);
    // avisa con el texto del contrato, no pide nada al servidor y no cambia nada
    expect(await screen.findByText('Ya tienes 3 fijados. Quita uno para fijar este.')).toBeInTheDocument();
    expect(puts(f)).toEqual([]);
    expect(pin).toHaveAttribute('aria-pressed', 'false');
    expect(pin).toHaveFocus();
    const nombres = casillas().map(c => within(c).getAllByRole('button')[0]!.textContent);
    expect(nombres).toEqual(['Retrato de estudio', 'Café con vapor', 'Guion de 30 segundos']);
    // al elegir otro prompt, el aviso se va; y quitando uno ya se puede fijar
    await userEvent.click(within(casillas()[1]!).getByRole('button', { name: 'Quitar «Café con vapor» de fijados' }));
    await userEvent.click(fila('Ilustración plana'));
    await userEvent.click(alternador());
    await waitFor(() => expect(puts(f).at(-1)).toEqual(['casa-retrato', 'casa-guion', 'casa-ilustracion']));
  });

  it('biblioteca.fijar.la_franja_siempre_tiene_tres_casillas_numeradas_y_las_vacias_dicen_como_llenarse', async () => {
    montar({ fijados: ['casa-guion'] });
    render(<Biblioteca />);
    await esperarLista();
    expect(casillas()).toHaveLength(3);
    expect(casillas().map(c => c.textContent?.trim().charAt(0))).toEqual(['1', '2', '3']);
    expect(franja()).toHaveTextContent('Tus 3 fijados');
    expect(within(casillas()[0]!).getByRole('button', { name: 'Guion de 30 segundos' })).toBeInTheDocument();
    for (const c of casillas().slice(1)) expect(c).toHaveTextContent('Fija aquí un prompt que quieras recordar');
    // las vacías no son botones ni tienen controles
    expect(within(casillas()[1]!).queryByRole('button')).toBeNull();
    // cada casilla llena abre su prompt
    await userEvent.click(within(casillas()[0]!).getByRole('button', { name: 'Guion de 30 segundos' }));
    expect(detalle()).toHaveTextContent('Guion de 30 segundos');
    expect(fila('Guion de 30 segundos')).toHaveAttribute('aria-current', 'true');
  });

  it('biblioteca.fijar.subir_bajar_y_quitar_guardan_el_orden_y_el_foco_se_queda_en_el_mismo_boton', async () => {
    const f = montar({ fijados: ['casa-retrato', 'casa-cafe', 'casa-guion'] });
    render(<Biblioteca />);
    await esperarLista();
    const orden = () => casillas().map(c => within(c).queryAllByRole('button')[0]?.textContent ?? c.textContent!.replace(/^\d/, ''));
    expect(orden()).toEqual(['Retrato de estudio', 'Café con vapor', 'Guion de 30 segundos']);
    // subir el 2.º
    const subir = within(franja()).getByRole('button', { name: 'Subir «Café con vapor»' });
    subir.focus();
    await userEvent.click(subir);
    expect(orden()).toEqual(['Café con vapor', 'Retrato de estudio', 'Guion de 30 segundos']);
    await waitFor(() => expect(puts(f).at(-1)).toEqual(['casa-cafe', 'casa-retrato', 'casa-guion']));
    // el foco sigue en «Subir» de ese mismo prompt, aunque la casilla cambió de lugar
    expect(within(franja()).getByRole('button', { name: 'Subir «Café con vapor»' })).toHaveFocus();
    // «Subir» del primero y «Bajar» del último están apagados pero se pueden enfocar, y no hacen nada
    const primero = within(franja()).getByRole('button', { name: 'Subir «Café con vapor»' });
    expect(primero).toHaveAttribute('aria-disabled', 'true');
    const llamadasAntes = puts(f).length;
    await userEvent.click(primero);
    const ultimo = within(franja()).getByRole('button', { name: 'Bajar «Guion de 30 segundos»' });
    expect(ultimo).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(ultimo);
    expect(puts(f)).toHaveLength(llamadasAntes);
    expect(orden()).toEqual(['Café con vapor', 'Retrato de estudio', 'Guion de 30 segundos']);
    // bajar el 1.º
    const bajar = within(franja()).getByRole('button', { name: 'Bajar «Café con vapor»' });
    bajar.focus();
    await userEvent.click(bajar);
    expect(orden()).toEqual(['Retrato de estudio', 'Café con vapor', 'Guion de 30 segundos']);
    expect(within(franja()).getByRole('button', { name: 'Bajar «Café con vapor»' })).toHaveFocus();
    // quitar el 2.º: los demás suben y el foco no cae a <body>
    await userEvent.click(within(franja()).getByRole('button', { name: 'Quitar «Café con vapor» de fijados' }));
    expect(orden()).toEqual(['Retrato de estudio', 'Guion de 30 segundos', 'Fija aquí un prompt que quieras recordar']);
    await waitFor(() => expect(puts(f).at(-1)).toEqual(['casa-retrato', 'casa-guion']));
    expect(document.body).not.toHaveFocus();
    expect(franja().contains(document.activeElement)).toBe(true);
  });

  it('biblioteca.fijar.una_peticion_a_la_vez_y_gana_el_ultimo_cambio', async () => {
    const pendientes: Array<{ ids: string[]; soltar: (r: Response) => void }> = [];
    const f = montar({
      rutas: {
        '/api/biblioteca/fijados': (_u, init) =>
          new Promise<Response>(soltar => pendientes.push({ ids: (JSON.parse(String(init?.body)) as { ids: string[] }).ids, soltar })),
      },
    });
    render(<Biblioteca />);
    await esperarLista();
    // tres cambios seguidos mientras la primera petición no vuelve
    await userEvent.click(alternador()); // fija Retrato
    await userEvent.click(fila('Café con vapor'));
    await userEvent.click(alternador()); // fija Café
    await userEvent.click(fila('Guion de 30 segundos'));
    await userEvent.click(alternador()); // fija Guion
    expect(puts(f)).toEqual([['casa-retrato']]);
    // la pantalla ya muestra los tres
    expect(casillas().map(c => within(c).getAllByRole('button')[0]!.textContent)).toEqual(['Retrato de estudio', 'Café con vapor', 'Guion de 30 segundos']);
    await act(async () => pendientes[0]!.soltar(json({ fijados: ['casa-retrato'] })));
    // vuelve la primera: sale UNA más, con el estado final (la del medio nunca sale)
    await waitFor(() => expect(puts(f)).toEqual([['casa-retrato'], ['casa-retrato', 'casa-cafe', 'casa-guion']]));
    await act(async () => pendientes[1]!.soltar(json({ fijados: ['casa-retrato', 'casa-cafe', 'casa-guion'] })));
    expect(puts(f)).toHaveLength(2);
    expect(casillas().map(c => within(c).getAllByRole('button')[0]!.textContent)).toEqual(['Retrato de estudio', 'Café con vapor', 'Guion de 30 segundos']);
  });

  it('biblioteca.fijar.lo_que_el_servidor_omite_no_se_queda_en_la_pantalla', async () => {
    montar({
      rutas: {
        // el dueño quitó un prompt de la casa entre una cosa y otra: el servidor devuelve la lista sin él
        '/api/biblioteca/fijados': () => json({ fijados: [] }),
      },
    });
    render(<Biblioteca />);
    await esperarLista();
    await userEvent.click(alternador());
    await waitFor(() => expect(alternador()).toHaveAttribute('aria-pressed', 'false'));
    expect(within(casillas()[0]!).getByText('Fija aquí un prompt que quieras recordar')).toBeInTheDocument();
  });

  it('biblioteca.fijar.un_mio_tambien_se_fija_y_su_casilla_lo_abre_desde_la_casa', async () => {
    const f = montar({ mios: MIOS });
    render(<Biblioteca />);
    await esperarLista();
    await userEvent.click(ambito('Míos'));
    expect(titulosDeFilas()).toEqual(['Reel de la semana', 'Ideas de portada']);
    await userEvent.click(alternador());
    await waitFor(() => expect(puts(f)).toEqual([['mio-0123456789ab']]));
    // y uno de la casa, en la misma franja
    await userEvent.click(ambito('De la casa'));
    await userEvent.click(alternador());
    await waitFor(() => expect(puts(f).at(-1)).toEqual(['mio-0123456789ab', 'casa-retrato']));
    // la franja es de toda la Biblioteca: desde «De la casa», la casilla de un «mío» abre ese prompt en «Míos»
    await userEvent.click(within(casillas()[0]!).getByRole('button', { name: 'Reel de la semana' }));
    expect(ambito('Míos')).toHaveAttribute('aria-pressed', 'true');
    expect(fila('Reel de la semana')).toHaveAttribute('aria-current', 'true');
    expect(detalle()).toHaveTextContent('Reel de la semana');
    expect(alternador()).toHaveAttribute('aria-pressed', 'true');
  });

  // ---- «Míos» ----

  it('biblioteca.mios.el_conmutador_cambia_de_lista_y_sin_ninguno_manda_a_coi', async () => {
    montar();
    render(<Biblioteca />);
    await esperarLista();
    expect(ambito('De la casa')).toHaveAttribute('aria-pressed', 'true');
    expect(ambito('De la casa')).toHaveTextContent('5');
    expect(ambito('Míos')).toHaveTextContent('0');
    await userEvent.click(ambito('Míos'));
    expect(ambito('Míos')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Todavía no guardas ninguno. Arma uno con COI y pulsa «Guardar».')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Prompts de la Biblioteca' })).toBeNull();
    // sin ninguno no hay con qué buscar: ni buscador ni categorías
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(within(panelDetalle()!).getByRole('link', { name: /Ir a COI/ })).toHaveAttribute('href', '/estudio/coi/');
    // y la franja de fijados sigue ahí: es de toda la Biblioteca
    expect(casillas()).toHaveLength(3);
  });

  it('con «?ver=mios» (el enlace «Ver en Míos» de COI) abre en «Míos» y sin esa dirección abre «De la casa»', async () => {
    history.replaceState(null, '', '/estudio/biblioteca/?ver=mios');
    montar({ mios: MIOS });
    const { unmount } = render(<Biblioteca />);
    await esperarLista();
    expect(ambito('Míos')).toHaveAttribute('aria-pressed', 'true');
    expect(titulosDeFilas()).toEqual(['Reel de la semana', 'Ideas de portada']);
    unmount();
    history.replaceState(null, '', '/estudio/biblioteca/');
    render(<Biblioteca />);
    await esperarLista();
    expect(ambito('De la casa')).toHaveAttribute('aria-pressed', 'true');
  });

  it('biblioteca.mios.borrar_pide_confirmar_y_lo_quita_tambien_de_los_fijados', async () => {
    const f = montar({ mios: MIOS, fijados: ['mio-0123456789ab', 'casa-retrato'] });
    render(<Biblioteca />);
    await esperarLista();
    // un prompt de la casa no se borra
    expect(screen.queryByRole('button', { name: /^Borrar/ })).toBeNull();
    await userEvent.click(ambito('Míos'));
    await userEvent.click(screen.getByRole('button', { name: 'Borrar «Reel de la semana»' }));
    const dialogo = await screen.findByRole('alertdialog', { name: '¿Borrar este prompt?' });
    expect(dialogo).toHaveTextContent('«Reel de la semana» se quita de tu Biblioteca y de tus fijados. No se puede deshacer.');
    // cancelar no borra nada
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    expect(llamadas(f, '/api/biblioteca/mios/mio-0123456789ab', 'DELETE')).toHaveLength(0);
    expect(titulosDeFilas()).toEqual(['Reel de la semana', 'Ideas de portada']);
    // confirmar sí: pide el borrado de ESE id, lo quita de la lista y de la franja, y no manda un PUT de más
    await userEvent.click(screen.getByRole('button', { name: 'Borrar «Reel de la semana»' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Borrar' }));
    await waitFor(() => expect(titulosDeFilas()).toEqual(['Ideas de portada']));
    expect(llamadas(f, '/api/biblioteca/mios/mio-0123456789ab', 'DELETE')).toHaveLength(1);
    expect(casillas().map(c => within(c).queryAllByRole('button')[0]?.textContent ?? null)).toEqual(['Retrato de estudio', null, null]);
    expect(puts(f)).toEqual([]);
    // el foco no cae a <body>
    await waitFor(() => expect(document.body).not.toHaveFocus());
    // y lo borrado no se queda en la lista que se manda después: el siguiente cambio de fijados no lo lleva (el servidor lo rechazaría como «desconocido»)
    await userEvent.click(ambito('De la casa'));
    await userEvent.click(fila('Café con vapor'));
    await userEvent.click(alternador());
    await waitFor(() => expect(puts(f)).toEqual([['casa-retrato', 'casa-cafe']]));
  });

  it('biblioteca.mios.si_no_se_pudo_borrar_lo_dice_y_el_prompt_se_queda', async () => {
    const f = montar({
      mios: MIOS,
      rutas: { '/api/biblioteca/mios': () => json({ detail: { codigo: 'no_disponible', texto: 'No se pudo conectar con tu Biblioteca.' } }, 503) },
    });
    render(<Biblioteca />);
    await esperarLista();
    await userEvent.click(ambito('Míos'));
    await userEvent.click(screen.getByRole('button', { name: 'Borrar «Reel de la semana»' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Borrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos borrarlo. No se pudo conectar con tu Biblioteca.');
    expect(titulosDeFilas()).toEqual(['Reel de la semana', 'Ideas de portada']);
    expect(llamadas(f, '/api/biblioteca/mios/mio-0123456789ab', 'DELETE')).toHaveLength(1);
  });

  it('biblioteca.mios.un_404_no_es_tuyo_es_que_ya_no_estaba_y_se_quita_igual', async () => {
    montar({
      mios: MIOS,
      rutas: { '/api/biblioteca/mios': () => json({ detail: { codigo: 'no_es_tuyo', texto: 'Ese prompt no es tuyo.' } }, 404) },
    });
    render(<Biblioteca />);
    await esperarLista();
    await userEvent.click(ambito('Míos'));
    await userEvent.click(screen.getByRole('button', { name: 'Borrar «Reel de la semana»' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Borrar' }));
    await waitFor(() => expect(titulosDeFilas()).toEqual(['Ideas de portada']));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // ---- celular ----

  it('biblioteca.celular.dos_pasos_elegir_pasa_al_segundo_con_el_foco_en_el_titulo_y_volver_regresa_a_la_fila', async () => {
    window.matchMedia = vi.fn((q: string) => ({ matches: q === '(max-width: 959px)', media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
    montar();
    render(<Biblioteca />);
    await esperarLista();
    const pasos = within(screen.getByRole('group', { name: 'Pasos' }));
    expect(pasos.getByRole('button', { name: /Elige/ })).toHaveAttribute('aria-current', 'step');
    expect(pasos.getByRole('button', { name: /Úsalo/ })).not.toHaveAttribute('aria-current');
    await userEvent.click(fila('Café con vapor'));
    expect(pasos.getByRole('button', { name: /Úsalo/ })).toHaveAttribute('aria-current', 'step');
    expect(detalle()).toHaveFocus();
    expect(detalle()).toHaveTextContent('Café con vapor');
    // el panel de la lista se esconde (clase `hidden`) y el del prompt se ve
    expect(lista().closest('section')!.className).toContain('hidden');
    await userEvent.click(screen.getByRole('button', { name: 'Volver a la lista' }));
    expect(pasos.getByRole('button', { name: /Elige/ })).toHaveAttribute('aria-current', 'step');
    expect(fila('Café con vapor')).toHaveFocus();
    // los pasos también se pulsan
    await userEvent.click(pasos.getByRole('button', { name: /Úsalo/ }));
    expect(pasos.getByRole('button', { name: /Úsalo/ })).toHaveAttribute('aria-current', 'step');
  });

  it('biblioteca.celular.elegir_una_etiqueta_del_detalle_lleva_el_foco_a_quitarla_y_no_a_body', async () => {
    window.matchMedia = vi.fn((q: string) => ({ matches: q === '(max-width: 959px)', media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
    montar();
    render(<Biblioteca />);
    await esperarLista();
    await userEvent.click(fila('Retrato de estudio'));
    expect(detalle()).toHaveFocus();
    // en un celular la etiqueta está en el paso 2 y filtrar vuelve al paso 1: el botón que se pulsó se esconde con el foco puesto
    await userEvent.click(screen.getByRole('button', { name: '#retrato: ver los prompts con esa etiqueta' }));
    expect(titulosDeFilas()).toEqual(['Retrato de estudio']);
    expect(screen.getByRole('button', { name: 'Quitar la etiqueta retrato' })).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  // ---- el marco ----

  it('biblioteca.marco.irremplazables_arriba_y_migas_de_tres_niveles_que_reabren_su_nivel', async () => {
    montar();
    render(<Biblioteca />);
    await esperarLista();
    // el único h1 es «Irremplazables»; el nombre de la pantalla es un h2
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Irremplazables');
    expect(screen.getByRole('heading', { level: 2, name: 'Biblioteca de prompts' })).toBeInTheDocument();
    const migas = within(screen.getByRole('navigation', { name: 'Dónde estás' }));
    const enlaces = migas.getAllByRole('link');
    expect(enlaces.map(a => a.textContent)).toEqual(['Central', 'Distrito', 'Biblioteca de prompts']);
    // «Central» abre el mapa y «Distrito» las opciones de Central, «desde» esta pantalla (el contrato con el inicio)
    expect(enlaces[0]).toHaveAttribute('href', '/estudio/inicio/?desde=central.distrito.biblioteca&ver=mapa');
    expect(enlaces[1]).toHaveAttribute('href', '/estudio/inicio/?desde=central.distrito.biblioteca&ver=grupos');
    expect(enlaces[2]).toHaveAttribute('aria-current', 'step');
    expect(enlaces[2]).toHaveAttribute('href', '/estudio/biblioteca/');
    // el h1 no tiene ícono ni está dentro de una tarjeta
    expect(screen.getByRole('heading', { level: 1 }).querySelector('svg')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).closest('section')).toBeNull();
  });

  it('biblioteca.marco.los_enlaces_a_coi_son_enlaces_a_su_pantalla', async () => {
    montar();
    render(<Biblioteca />);
    await esperarLista();
    expect(screen.getByText('¿No encuentras el tuyo?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ir a COI/ })).toHaveAttribute('href', '/estudio/coi/');
  });

  // ---- lo que NO hace ----

  it('biblioteca.seguridad.no_guarda_nada_en_el_navegador', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem');
    const f = montar({ mios: MIOS });
    ponerPortapapeles(async () => undefined);
    render(<Biblioteca />);
    await esperarLista();
    await userEvent.type(buscador(), 'retrato');
    await userEvent.click(alternador());
    await userEvent.click(copiarBoton());
    await userEvent.click(ambito('Míos'));
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    // ni localStorage ni sessionStorage (los dos son Storage): ni un prompt, ni una búsqueda, ni un fijado
    expect(local).not.toHaveBeenCalled();
  });

  it('biblioteca.dinero.nada_cobra_ni_crea_solo_lecturas_el_put_de_fijados_y_el_delete_de_un_mio', async () => {
    const f = montar({ mios: MIOS });
    ponerPortapapeles(async () => undefined);
    render(<Biblioteca />);
    await esperarLista();
    await userEvent.click(alternador());
    await userEvent.click(copiarBoton());
    await userEvent.click(ambito('Míos'));
    await userEvent.click(screen.getByRole('button', { name: 'Borrar «Reel de la semana»' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Borrar' }));
    await waitFor(() => expect(llamadas(f, '/api/biblioteca/mios/mio-0123456789ab', 'DELETE')).toHaveLength(1));
    const escrituras = f.mock.calls.filter(c => (c[1]?.method ?? 'GET') !== 'GET').map(c => `${c[1]?.method} ${String(c[0])}`);
    expect(escrituras.sort()).toEqual(['DELETE /api/biblioteca/mios/mio-0123456789ab', 'PUT /api/biblioteca/fijados']);
    // ningún cobro: el saldo no se pide de nuevo ni se anuncia
    expect(monedero.refrescar).not.toHaveBeenCalled();
    // y «Llevar a la caja» es un enlace, no una acción: no navegó
    expect(location.pathname).toBe('/estudio/biblioteca/');
  });

  it('biblioteca.accesibilidad.los_avisos_van_a_una_region_viva_y_cada_boton_dice_sobre_que_actua', async () => {
    montar({ fijados: ['casa-retrato'] });
    render(<Biblioteca />);
    await esperarLista();
    expect(document.querySelector('[role="status"][aria-live="polite"][aria-atomic="true"]')).toBeInTheDocument();
    // la lista tiene nombre; cada botón de la franja y el interruptor llevan el título de su prompt
    for (const nombre of ['Subir «Retrato de estudio»', 'Bajar «Retrato de estudio»', 'Quitar «Retrato de estudio» de fijados']) {
      expect(within(franja()).getByRole('button', { name: nombre })).toBeInTheDocument();
    }
    expect(alternador()).toHaveAccessibleName('Quitar de fijados «Retrato de estudio»');
    // elegir otro lo anuncia sin mover el foco de la lista
    fila('Café con vapor').focus();
    fireEvent.click(fila('Café con vapor'));
    await waitFor(() => expect(document.querySelector('[aria-live="polite"][aria-atomic="true"]')).toHaveTextContent('Mostrando «Café con vapor».'));
  });
});
