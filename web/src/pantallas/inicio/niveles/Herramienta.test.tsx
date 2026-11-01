// Las tres páginas de la caja (…/distrito/imagen/, …/video/, …/edicion/; PaginaHerramienta): la caja de siempre, en la pestaña de su
// dirección, con su marco (el título fuera y arriba de la tarjeta, la tarjeta con las migas y la caja, lo de debajo), las migas como
// enlaces, y la dirección y el título siguiendo a la pestaña. Sin el prefijo `inicio.`: no son invariantes del registro de migración
// (docs/migracion/inicio.md · «Rutas por nivel»). Ninguna prueba sale a la red: `servidor()` contesta todo y no gasta nada.
//
// Casos límite que se cubren aquí (y por qué los otros no aplican):
//   · la pestaña Edición (la única que no está en OPCIONES): abre sin romperse y la dirección no se mueve;
//   · un `lugar` que no es una pestaña de la caja (una hoja, una clave inventada, `constructor`): dice «No encontramos esa página», nunca
//     una página en blanco;
//   · StrictMode (cada efecto corre dos veces): la dirección se corrige UNA vez;
//   · recargar con el query: la entrada se lee una vez y la dirección ya no la trae;
//   · «atrás»: jsdom no navega, así que se prueba lo que lo garantiza: ningún `pushState` y el `history.state` intacto.
import { StrictMode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Lugar } from '../../../marca/menu';
import { json, servidor } from '../../../prueba/servidor';
import type { Proyecto } from '../logica';
import { Inicio } from '../Inicio';
import { NoEncontrada } from './NoEncontrada';
import { PaginaHerramienta } from './PaginaHerramienta';

// herramienta.tsx monta la página al cargarse: aquí `montar` es un espía (no hay #raiz) y se mira con qué lo llamó
vi.mock('../../../nucleo/montar', () => ({ montar: vi.fn() }));

const IMAGEN = '/estudio/marketing/distrito/imagen/';
const VIDEO = '/estudio/marketing/distrito/video/';
const EDICION = '/estudio/marketing/distrito/edicion/';
/** El `<title>` que trae cada página (lo mismo que dice rutasDelRecorrido en marca/rutas.ts). */
const TITULO = {
  imagen: 'Estudio de video · Marketing · Distrito · Imagen',
  video: 'Estudio de video · Marketing · Distrito · Video',
  edicion: 'Estudio de video · Marketing · Distrito · Edición',
} as const;

let ir: ReturnType<typeof vi.fn<(url: string) => void>>;
let f: ReturnType<typeof servidor>;

beforeEach(() => {
  vi.unstubAllGlobals();
  ir = vi.fn<(url: string) => void>();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  f = servidor({
    '/api/proyectos': () => json([]),
    '/api/slots': () => json({ slots: null, activos: 0 }),
    '/api/imagenes': () => json({ total: 0, imagenes: [] }),
    '/api/edicion/proyectos': () => json([]),
    '/api/clip': () => json({ clips: [] }),
    '/api/blotato': () => json({ conectado: true, origen: 'usuario', cuentas: [], error: null, plan: null }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // jsdom conserva la dirección, el título y la historia entre pruebas
  history.replaceState(null, '', '/');
  document.title = '';
});

const lugar = (pantalla: string): Lugar => ({ area: 'mkt', grupo: 'distrito', pantalla });
const riel = () => within(screen.getByRole('group', { name: 'Qué quieres crear' }));
const pestana = () => riel().getByRole('button', { pressed: true }).textContent;
const alRiel = (nombre: string) => fireEvent.click(riel().getByRole('button', { name: nombre }));
const textoCaja = () => screen.getByRole('textbox', { name: '¿Qué vamos a crear hoy?' }) as HTMLTextAreaElement;
const direccion = () => location.pathname + location.search + location.hash;
const migas = () => screen.getByRole('navigation', { name: 'Dónde estás' });

/** Abre el navegador en `url`, con un `history.state` que se pueda reconocer si algo lo pisa. */
function abrirEn(url: string, estado: unknown = null) {
  history.replaceState(estado, '', url);
}

/** Lo que el servidor de mentira ya contestó: las listas de «Mis creaciones» llegaron (todas vacías → «Tu primer video, en tres caminos»).
 *  Se espera para no dejar actualizaciones de estado colgando al terminar la prueba. */
const cargada = () => screen.findByRole('heading', { name: 'Tu primer video, en tres caminos', hidden: true });

describe('niveles · la página de una herramienta de la caja', () => {
  for (const { pantalla, nombre, url } of [
    { pantalla: 'imagen', nombre: 'Imagen', url: IMAGEN },
    { pantalla: 'video', nombre: 'Video', url: VIDEO },
    { pantalla: 'edicion', nombre: 'Edición', url: EDICION },
  ]) {
    it(`niveles.herramienta.la_pagina_de_${pantalla}_abre_la_caja_en_su_pestana_y_la_deja_a_la_vista`, async () => {
      abrirEn(url);
      render(<PaginaHerramienta lugar={lugar(pantalla)} ir={ir} />);
      expect(pestana()).toBe(nombre);
      // la caja está a la vista desde el primer cuadro: no hay mapa ni opciones por delante
      expect(screen.getByRole('heading', { level: 2, name: '¿Qué vamos a crear hoy?' })).toBeVisible();
      expect(screen.queryByRole('group', { name: 'Áreas' })).toBeNull();
      // la dirección ya era la de la pestaña: no se toca
      expect(direccion()).toBe(url);
      await cargada();
    });
  }

  it('niveles.herramienta.las_migas_son_enlaces_el_area_al_mapa_y_el_grupo_a_las_opciones_del_area: lo de siempre, navegando', async () => {
    abrirEn(VIDEO);
    render(<PaginaHerramienta lugar={lugar('video')} ir={ir} />);
    const nav = migas();
    // no son botones que cambian de paso: son enlaces a otras PÁGINAS
    expect(within(nav).queryAllByRole('button')).toEqual([]);
    const enlaces = within(nav).getAllByRole('link');
    expect(enlaces.map(a => a.getAttribute('href'))).toEqual(['/estudio/', '/estudio/marketing/']);
    // y dicen lo que decían: a dónde llevan y dónde estás
    expect(enlaces.map(a => a.getAttribute('aria-label'))).toEqual([
      'Volver al mapa para cambiar de área (ahora: Marketing)',
      'Volver a las opciones de Marketing (ahora: Distrito)',
    ]);
    expect(enlaces.map(a => a.getAttribute('aria-current'))).toEqual([null, 'step']);
    expect(enlaces.map(a => a.textContent)).toEqual(['Marketing', 'Distrito']);
    await cargada();
  });

  // La página de una herramienta es NUEVA en cada carga, como las de nivel: el primer clic de un doble clic en la tarjeta «Imagen» o
  // «Video» de Distrito la cargó, y el segundo (detail 2) cae sobre lo que la caja pinta en ese punto (a 390 px, el chip de la tarea o el
  // selector de modelo). Se descarta durante el medio segundo que sigue a montarse; pasado ese rato, la misma pulsación vale.
  it('niveles.herramienta.el_segundo_clic_recien_cargada_la_pagina_se_descarta: no abre lo que la caja pinta donde estaba la tarjeta', async () => {
    abrirEn(IMAGEN);
    render(<PaginaHerramienta lugar={lugar('imagen')} ir={ir} />);
    const chip = () => screen.getAllByRole('button').find(b => b.getAttribute('aria-haspopup') === 'listbox')!;
    expect(chip()).toHaveTextContent('Crear una imagen');
    // cancelado (y detenido en la captura): la lista no se abre
    expect(fireEvent.click(chip(), { detail: 2 })).toBe(false);
    expect(chip()).toHaveAttribute('aria-expanded', 'false');
    // un clic suelto (detail 1) es deliberado aunque llegue enseguida
    expect(fireEvent.click(chip(), { detail: 1 })).toBe(true);
    expect(chip()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(chip(), { detail: 1 });
    expect(chip()).toHaveAttribute('aria-expanded', 'false');
    // el control: pasado el medio segundo, el mismo doble clic sí la abre
    const ahora = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(ahora + 600);
    expect(fireEvent.click(chip(), { detail: 2 })).toBe(true);
    expect(chip()).toHaveAttribute('aria-expanded', 'true');
    await cargada();
  });

  it('niveles.herramienta.cambiar_de_pestana_con_el_riel_es_de_la_pagina_y_conserva_lo_escrito: no navega ni recarga', async () => {
    abrirEn(IMAGEN);
    render(<PaginaHerramienta lugar={lugar('imagen')} ir={ir} />);
    fireEvent.change(textoCaja(), { target: { value: 'un gato astronauta' } });
    alRiel('Video');
    // la misma caja, con el texto: no se recargó ni se desmontó
    expect(pestana()).toBe('Video');
    expect(textoCaja().value).toBe('un gato astronauta');
    alRiel('Edición');
    expect(pestana()).toBe('Edición');
    expect(await screen.findByRole('textbox', { name: /Cuéntale a la IA/ })).toBeInTheDocument();
    alRiel('Imagen');
    expect(textoCaja().value).toBe('un gato astronauta');
    // el riel no manda a ninguna parte: ni `ir` (location.assign en la página) ni un enlace
    expect(ir).not.toHaveBeenCalled();
    await cargada();
  });

  it('niveles.herramienta.sin_lugar_el_inicio_es_el_de_siempre: abre en el mapa, con su recorrido en la página y la dirección quieta', async () => {
    abrirEn('/estudio/inicio/');
    document.title = 'Estudio de video';
    const reemplazar = vi.spyOn(history, 'replaceState');
    render(<Inicio ir={ir} />);
    expect(screen.getByRole('group', { name: 'Áreas' })).toBeInTheDocument();
    // la caja está montada pero escondida (`hidden`): ni se ve ni la lee un lector de pantalla
    expect(screen.queryByRole('group', { name: 'Qué quieres crear' })).toBeNull();
    // llega a la caja por el camino de siempre (Marketing → Distrito: botones que cambian de paso, no enlaces) y cambia de pestaña
    fireEvent.click(within(screen.getByRole('group', { name: 'Áreas' })).getByRole('button', { name: /^Marketing/ }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Marketing' })).getByRole('button', { name: /^Distrito/ }));
    expect(within(migas()).queryAllByRole('link')).toEqual([]);
    expect(within(migas()).getAllByRole('button').map(b => b.textContent)).toEqual(['Marketing', 'Distrito']);
    expect(pestana()).toBe('Video');
    alRiel('Imagen');
    alRiel('Edición');
    expect(pestana()).toBe('Edición');
    // sin `lugar` la caja no avisa a nadie: ni la dirección ni el título se mueven
    expect(reemplazar).not.toHaveBeenCalled();
    expect(direccion()).toBe('/estudio/inicio/');
    expect(document.title).toBe('Estudio de video');
    await cargada();
  });
});

// El marco de la caja (lo que antes le ponía Recorrido.tsx, y que los e2e de la caja y del layout miden): el título fuera y arriba de la
// tarjeta, la tarjeta con las migas y la caja, y lo de debajo del mismo ancho. La geometría (posición, centrado, ancho) no se puede medir en
// jsdom: la miden inicio-recorrido.spec.ts y niveles.spec.ts.
describe('niveles · el marco de la caja', () => {
  const P1: Proyecto = {
    id: 'p1',
    creado: '2026-09-20T10:00:00Z',
    estado: 'listo',
    brief: 'La historia del café',
    archivado: false,
    miniatura: null,
    miniatura_alt: null,
  };
  /** La región de la página: el título, y la tarjeta con las migas y la caja. */
  const region = () => screen.getByRole('region', { name: 'Irremplazables' });
  /** La tarjeta (borde, fondo y relleno). */
  const tarjeta = () => region().querySelector<HTMLElement>('[data-limite-lista]')!;

  it('niveles.herramienta.irremplazables_es_el_unico_h1_en_dorado_y_va_fuera_y_arriba_de_la_tarjeta: es lo primero de la region', async () => {
    abrirEn(VIDEO);
    render(<PaginaHerramienta lugar={lugar('video')} ir={ir} />);
    expect(screen.getAllByRole('heading', { level: 1 }).map(h => h.textContent)).toEqual(['Irremplazables']);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveClass('text-center', 'font-titulo', 'text-titulo-lg', 'font-extrabold', '[overflow-wrap:anywhere]');
    // el dorado va en un <span> en línea (un fondo recortado a la letra mide lo que su caja)
    expect(h1.firstElementChild?.tagName).toBe('SPAN');
    expect(h1.firstElementChild).toHaveClass('texto-oro');
    expect(tarjeta().contains(h1)).toBe(false);
    expect(h1.compareDocumentPosition(tarjeta()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region().firstElementChild).toBe(h1);
    await cargada();
  });

  it('niveles.herramienta.la_tarjeta_lleva_borde_fondo_y_relleno_con_las_migas_a_la_izquierda_y_la_caja_adentro', async () => {
    abrirEn(VIDEO);
    render(<PaginaHerramienta lugar={lugar('video')} ir={ir} />);
    expect(tarjeta()).toHaveClass('border', 'border-linea', 'bg-superficie', 'p-6');
    const fila = within(tarjeta()).getByRole('navigation', { name: 'Dónde estás' }).parentElement!;
    // las migas van arriba, dentro de la tarjeta y a la izquierda (centradas solo en las páginas de nivel, sin tarjeta)
    expect(fila).not.toHaveClass('justify-center');
    expect(fila.compareDocumentPosition(textoCaja()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(tarjeta()).getByRole('textbox', { name: '¿Qué vamos a crear hoy?' })).toBeInTheDocument();
    // un solo h2 en la región, el de la caja, y ningún «Volver a …»: subir de nivel son las migas
    expect(within(region()).getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['¿Qué vamos a crear hoy?']);
    expect(screen.queryAllByRole('link', { name: /^Volver a (?!las opciones)/ })).toEqual([]);
    expect(screen.queryAllByRole('button', { name: /^Volver a (?!las opciones)/ })).toEqual([]);
    await cargada();
  });

  it('niveles.herramienta.la_tarjeta_es_el_limite_de_las_listas_de_la_caja: data_limite_lista, que SelectorOpcion busca con closest', async () => {
    abrirEn(IMAGEN);
    render(<PaginaHerramienta lugar={lugar('imagen')} ir={ir} />);
    expect(tarjeta()).toHaveAttribute('data-limite-lista');
    expect(document.querySelector('button[aria-haspopup="listbox"]')!.closest('[data-limite-lista]')).toBe(tarjeta());
    await cargada();
  });

  it('niveles.herramienta.debajo_de_la_tarjeta_mis_creaciones_a_la_vista_y_del_mismo_ancho_que_la_region: 820 px como mucho, centrada', async () => {
    servidor({
      '/api/proyectos': () => json([P1]),
      '/api/slots': () => json({ slots: null, activos: 0 }),
      '/api/imagenes': () => json({ total: 0, imagenes: [] }),
      '/api/edicion/proyectos': () => json([]),
      '/api/clip': () => json({ clips: [] }),
    });
    abrirEn(VIDEO);
    const { container } = render(<PaginaHerramienta lugar={lugar('video')} ir={ir} />);
    expect(await screen.findByRole('heading', { name: 'Mis creaciones' })).toBeVisible();
    expect(region().className).toContain('max-w-[820px]');
    expect(region().className).toContain('mx-auto');
    const envoltura = container.querySelector('#creaciones-titulo')!.closest('div.mx-auto')!;
    expect(envoltura.className).toContain('max-w-[820px]');
    expect(envoltura).not.toHaveAttribute('hidden');
    // va DEBAJO de la región, no dentro de la tarjeta
    expect(region().contains(envoltura)).toBe(false);
    expect(region().compareDocumentPosition(envoltura) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('niveles.herramienta.en_una_cuenta_nueva_los_tres_caminos_se_ven_con_la_caja', async () => {
    abrirEn(VIDEO);
    render(<PaginaHerramienta lugar={lugar('video')} ir={ir} />);
    expect(await screen.findByRole('heading', { name: 'Tu primer video, en tres caminos' })).toBeVisible();
  });

  it('niveles.herramienta.esc_no_hace_nada_en_la_caja: ni navega ni borra lo escrito (D12)', async () => {
    abrirEn(VIDEO);
    render(<PaginaHerramienta lugar={lugar('video')} ir={ir} />);
    fireEvent.change(textoCaja(), { target: { value: 'un gato astronauta' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(textoCaja(), { key: 'Escape' });
    expect(ir).not.toHaveBeenCalled();
    expect(textoCaja().value).toBe('un gato astronauta');
    expect(direccion()).toBe(VIDEO);
    await cargada();
  });

  it('niveles.herramienta.sin_blotato_conectar_la_pagina_no_le_pregunta_nada_a_blotato: solo lee sus listas', async () => {
    abrirEn(VIDEO);
    render(<PaginaHerramienta lugar={lugar('video')} ir={ir} />);
    await cargada();
    const urls = f.mock.calls.map(c => String(c[0]));
    expect(urls.filter(u => u.startsWith('/api/blotato'))).toEqual([]);
    expect(urls.sort()).toEqual(['/api/clip', '/api/edicion/proyectos', '/api/imagenes', '/api/proyectos', '/api/slots']);
  });
});

describe('niveles · la dirección y el título siguen a la pestaña', () => {
  it('niveles.herramienta.cambiar_de_pestana_llama_a_replaceState_y_cambia_el_titulo: Imagen, Edición y de vuelta a Video', async () => {
    abrirEn(VIDEO);
    document.title = TITULO.video;
    const reemplazar = vi.spyOn(history, 'replaceState');
    render(<PaginaHerramienta lugar={lugar('video')} ir={ir} />);
    await cargada();
    // al montar la dirección ya era la de la pestaña: nada que corregir, y el <title> de la página ya es el suyo
    expect(reemplazar).not.toHaveBeenCalled();
    expect(document.title).toBe(TITULO.video);

    alRiel('Imagen');
    expect(reemplazar).toHaveBeenCalledTimes(1);
    expect(reemplazar).toHaveBeenLastCalledWith(null, '', IMAGEN);
    expect(direccion()).toBe(IMAGEN);
    expect(document.title).toBe(TITULO.imagen);

    alRiel('Edición');
    expect(reemplazar).toHaveBeenCalledTimes(2);
    expect(direccion()).toBe(EDICION);
    expect(document.title).toBe(TITULO.edicion);

    alRiel('Video');
    expect(reemplazar).toHaveBeenCalledTimes(3);
    expect(direccion()).toBe(VIDEO);
    expect(document.title).toBe(TITULO.video);
    // pulsar la pestaña en la que ya se está no cambia nada (no hay cambio de familia, ni replaceState de más)
    alRiel('Video');
    expect(reemplazar).toHaveBeenCalledTimes(3);
  });

  for (const { de, desde, param, pestana: esperada, destino, titulo } of [
    { de: 'video', desde: VIDEO, param: 'prompt', pestana: 'Imagen', destino: IMAGEN, titulo: TITULO.imagen },
    { de: 'imagen', desde: IMAGEN, param: 'brief', pestana: 'Video', destino: VIDEO, titulo: TITULO.video },
    { de: 'edicion', desde: EDICION, param: 'prompt', pestana: 'Imagen', destino: IMAGEN, titulo: TITULO.imagen },
    { de: 'edicion', desde: EDICION, param: 'brief', pestana: 'Video', destino: VIDEO, titulo: TITULO.video },
  ]) {
    it(`niveles.herramienta.${de}_con_${param}_abre_la_pestana_${esperada.toLowerCase()}_segun_el_origen_del_texto_y_la_direccion_pasa_a_ella`, async () => {
      abrirEn(`${desde}?${param}=${encodeURIComponent('un gato [COLOR]')}`);
      document.title = `Estudio de video · Marketing · Distrito · ${de}`;
      const reemplazar = vi.spyOn(history, 'replaceState');
      render(<PaginaHerramienta lugar={lugar(de)} ir={ir} />);
      // el texto que llega manda sobre la pestaña de la dirección: ?prompt= es una imagen y ?brief= un video
      expect(pestana()).toBe(esperada);
      expect(textoCaja().value).toBe('un gato [COLOR]');
      expect(screen.getByText('Te trajimos el prompt. Cambia lo que va entre [corchetes] y pulsa Crear.')).toBeInTheDocument();
      // y la dirección dice lo que se ve: la de esa pestaña, sin el query (ya se leyó, recargar no lo repite)
      expect(direccion()).toBe(destino);
      expect(document.title).toBe(titulo);
      expect(reemplazar).toHaveBeenCalledTimes(1);
      await cargada();
    });
  }

  it('niveles.herramienta.cambiar_de_pestana_no_agrega_historia: atras_sigue_subiendo_al_grupo', async () => {
    abrirEn(VIDEO, { guardado: true });
    const antes = history.length;
    const apilar = vi.spyOn(history, 'pushState');
    render(<PaginaHerramienta lugar={lugar('video')} ir={ir} />);
    alRiel('Imagen');
    alRiel('Edición');
    alRiel('Video');
    alRiel('Imagen');
    // replaceState, nunca pushState: la historia no crece y lo que la página guardó en ella se conserva
    expect(apilar).not.toHaveBeenCalled();
    expect(history.length).toBe(antes);
    expect(history.state).toEqual({ guardado: true });
    expect(direccion()).toBe(IMAGEN);
    // y «atrás» sigue siendo subir: la miga del grupo lleva a las opciones del área, no a una pestaña de antes
    expect(within(migas()).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual(['/estudio/', '/estudio/marketing/']);
    await cargada();
  });

  it('niveles.herramienta.una_direccion_escrita_de_otra_manera_se_lleva_a_la_canonica: con porcentajes o con index.html', async () => {
    for (const escrita of ['/estudio/marketing/distrito/%76ideo/', '/estudio/marketing/distrito/video/index.html']) {
      abrirEn(escrita);
      document.title = 'otro';
      const { unmount } = render(<PaginaHerramienta lugar={lugar('video')} ir={ir} />);
      expect(direccion(), escrita).toBe(VIDEO);
      expect(document.title, escrita).toBe(TITULO.video);
      unmount();
    }
    await vi.waitFor(() => expect(f).toHaveBeenCalled());
  });

  it('niveles.herramienta.la_pestana_que_cambia_por_dentro_tambien_mueve_la_direccion: el atajo «Crear un video» de los tres caminos', async () => {
    abrirEn(IMAGEN);
    render(<PaginaHerramienta lugar={lugar('imagen')} ir={ir} />);
    // «Desde una idea → Crear un video» elige la pestaña Video desde fuera del riel (MandoCaja.elegir)
    fireEvent.click(await screen.findByRole('button', { name: 'Crear un video' }));
    expect(pestana()).toBe('Video');
    expect(direccion()).toBe(VIDEO);
    expect(document.title).toBe(TITULO.video);
  });
});

describe('niveles · casos límite de la página de una herramienta', () => {
  it('niveles.herramienta.la_pestana_edicion_abre_sin_romperse_y_la_direccion_no_se_mueve: no esta_en_OPCIONES', async () => {
    abrirEn(EDICION);
    document.title = TITULO.edicion;
    const reemplazar = vi.spyOn(history, 'replaceState');
    render(<PaginaHerramienta lugar={lugar('edicion')} ir={ir} />);
    expect(pestana()).toBe('Edición');
    expect(await screen.findByRole('textbox', { name: /Cuéntale a la IA/ })).toBeInTheDocument();
    expect(reemplazar).not.toHaveBeenCalled();
    expect(direccion()).toBe(EDICION);
    // de Edición a Imagen y a Video: cada una con su primera opción de siempre
    alRiel('Imagen');
    expect(screen.getByRole('button', { name: /Crear una imagen/ })).toBeInTheDocument();
    alRiel('Video');
    expect(screen.getByRole('button', { name: /Un video corto/ })).toBeInTheDocument();
    expect(direccion()).toBe(VIDEO);
    await cargada();
  });

  for (const { que, lugar: l } of [
    { que: 'una_hoja_de_otra_area', lugar: { area: 'central', grupo: 'distrito', pantalla: 'coi' } },
    { que: 'una_hoja_de_blotato', lugar: { area: 'mkt', grupo: 'blotato', pantalla: 'agenda' } },
    { que: 'una_pantalla_que_no_existe_en_el_grupo_de_la_caja', lugar: { area: 'mkt', grupo: 'distrito', pantalla: 'nada' } },
    { que: 'la_pantalla_llamada_constructor', lugar: { area: 'mkt', grupo: 'distrito', pantalla: 'constructor' } },
    { que: 'un_area_que_no_existe', lugar: { area: 'nada', grupo: 'x', pantalla: 'y' } },
    { que: 'claves_de_object_prototype', lugar: { area: '__proto__', grupo: 'toString', pantalla: 'constructor' } },
  ]) {
    it(`niveles.herramienta.un_lugar_que_es_${que}_no_es_una_herramienta_de_la_caja: dice_que_no_encontramos_esa_pagina`, async () => {
      abrirEn(VIDEO);
      document.title = 'Estudio de video';
      const reemplazar = vi.spyOn(history, 'replaceState');
      // no se rompe ni queda en blanco: lo dice, con un enlace a la principal, como las entradas
      render(<PaginaHerramienta lugar={l} ir={ir} />);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('No encontramos esa página');
      expect(screen.getAllByRole('link').map(a => a.getAttribute('href'))).toEqual(['/estudio/']);
      expect(screen.queryByRole('group', { name: 'Qué quieres crear' })).toBeNull();
      // ni la dirección ni el título se tocan (no es una herramienta: no puede decir que la dirección es la de una pestaña)
      expect(reemplazar).not.toHaveBeenCalled();
      expect(direccion()).toBe(VIDEO);
      expect(document.title).toBe('Estudio de video');
      // y no pide nada: sin la caja no hay listas que leer
      await new Promise(r => setTimeout(r, 0));
      expect(f).not.toHaveBeenCalled();
    });
  }

  it('niveles.herramienta.strictmode_corrige_la_direccion_una_sola_vez: el efecto doble no repite el replaceState', async () => {
    // el texto abre otra pestaña que la de la dirección → una sola corrección
    abrirEn(`${VIDEO}?prompt=hola`);
    const reemplazar = vi.spyOn(history, 'replaceState');
    const { unmount } = render(
      <StrictMode>
        <PaginaHerramienta lugar={lugar('video')} ir={ir} />
      </StrictMode>,
    );
    expect(pestana()).toBe('Imagen');
    expect(reemplazar).toHaveBeenCalledTimes(1);
    expect(reemplazar).toHaveBeenCalledWith(null, '', IMAGEN);
    expect(direccion()).toBe(IMAGEN);
    expect(document.title).toBe(TITULO.imagen);
    await cargada();
    unmount();

    // el texto abre la pestaña de la dirección → solo se limpia el query, también una sola vez
    abrirEn(`${IMAGEN}?prompt=hola`);
    reemplazar.mockClear();
    const otra = render(
      <StrictMode>
        <PaginaHerramienta lugar={lugar('imagen')} ir={ir} />
      </StrictMode>,
    );
    expect(reemplazar).toHaveBeenCalledTimes(1);
    expect(direccion()).toBe(IMAGEN);
    await cargada();
    otra.unmount();

    // sin query y con la pestaña de la dirección: no hay nada que escribir en la historia
    abrirEn(VIDEO);
    reemplazar.mockClear();
    render(
      <StrictMode>
        <PaginaHerramienta lugar={lugar('video')} ir={ir} />
      </StrictMode>,
    );
    expect(reemplazar).not.toHaveBeenCalled();
    await cargada();
  });

  it('niveles.herramienta.recargar_con_el_query_no_repite_la_llegada: la entrada se lee una vez y la direccion ya no la trae', async () => {
    abrirEn(`${VIDEO}?prompt=${encodeURIComponent('un faro al amanecer')}`);
    const primera = render(<PaginaHerramienta lugar={lugar('video')} ir={ir} />);
    expect(pestana()).toBe('Imagen');
    expect(textoCaja().value).toBe('un faro al amanecer');
    expect(direccion()).toBe(IMAGEN);
    await cargada();
    primera.unmount();

    // «recargar»: la página se abre en la dirección que quedó (la herramienta que dice, `imagen`, vuelve a montarse)
    const reemplazar = vi.spyOn(history, 'replaceState');
    render(<PaginaHerramienta lugar={lugar('imagen')} ir={ir} />);
    expect(pestana()).toBe('Imagen');
    expect(textoCaja().value).toBe('');
    expect(screen.queryByText(/Te trajimos el prompt/)).toBeNull();
    expect(reemplazar).not.toHaveBeenCalled();
    expect(direccion()).toBe(IMAGEN);
    await cargada();
  });

  it('niveles.herramienta.con_el_query_en_la_pestana_de_la_direccion_solo_se_limpia_el_query: ?prompt= en …/imagen/ y ?brief= en …/video/', async () => {
    for (const [url, param, esperada] of [
      [IMAGEN, 'prompt', 'Imagen'],
      [VIDEO, 'brief', 'Video'],
    ] as const) {
      abrirEn(`${url}?${param}=hola&otro=1#ancla`);
      const reemplazar = vi.spyOn(history, 'replaceState');
      const { unmount } = render(<PaginaHerramienta lugar={lugar(url === IMAGEN ? 'imagen' : 'video')} ir={ir} />);
      expect(pestana(), url).toBe(esperada);
      expect(textoCaja().value, url).toBe('hola');
      // lo de siempre del inicio: se quitan prompt/brief y se conserva lo demás
      expect(direccion(), url).toBe(`${url}?otro=1#ancla`);
      expect(reemplazar, url).toHaveBeenCalledTimes(1);
      reemplazar.mockRestore();
      unmount();
    }
    await vi.waitFor(() => expect(f).toHaveBeenCalled());
  });
});

describe('niveles · corregir la dirección no pierde lo que la página no puso', () => {
  /** El servidor de mentira de siempre, pero con Blotato SIN clave: con `?blotato=conectar` el inicio abre «Conecta tu Blotato». */
  function sinBlotato() {
    return servidor({
      '/api/proyectos': () => json([]),
      '/api/slots': () => json({ slots: null, activos: 0 }),
      '/api/imagenes': () => json({ total: 0, imagenes: [] }),
      '/api/edicion/proyectos': () => json([]),
      '/api/clip': () => json({ clips: [] }),
      '/api/blotato': () => json({ conectado: false, origen: null, cuentas: [], error: null, plan: null }),
    });
  }

  // La caja (hija) corrige la dirección al montarse ANTES de que el efecto de carga de la página lea `?blotato=conectar`: si lo reescribía
  // entero (sin query ni ancla), el diálogo de conectar no se abría. Pasa en tres casos que no necesitan `?prompt`: la dirección no es la
  // canónica con `index.html`, viene con porcentajes, o el texto que llega abre otra pestaña. [hallazgos CAJA-1 y RUTA-1]
  for (const { que, escrita, pestana: esperada, destino } of [
    { que: 'con_index_html', escrita: `${IMAGEN}index.html?blotato=conectar`, pestana: 'Imagen', destino: `${IMAGEN}?blotato=conectar` },
    { que: 'con_porcentajes', escrita: '/estudio/marketing/distrito/%69magen/?blotato=conectar', pestana: 'Imagen', destino: `${IMAGEN}?blotato=conectar` },
    { que: 'con_un_prompt_que_abre_otra_pestana', escrita: `${VIDEO}?prompt=hola&blotato=conectar`, pestana: 'Imagen', destino: `${IMAGEN}?blotato=conectar` },
    { que: 'con_un_brief_que_abre_otra_pestana', escrita: `${IMAGEN}?brief=hola&blotato=conectar`, pestana: 'Video', destino: `${VIDEO}?blotato=conectar` },
  ]) {
    it(`niveles.herramienta.blotato_conectar_${que}_abre_el_dialogo_aunque_la_direccion_se_corrija_al_montar`, async () => {
      sinBlotato();
      abrirEn(escrita);
      render(<PaginaHerramienta lugar={lugar(esperada === 'Imagen' ? 'imagen' : 'video')} ir={ir} />);
      // (la pestaña se mira antes: con el diálogo abierto, Radix esconde el resto de la página a los lectores)
      expect(pestana()).toBe(esperada);
      expect(await screen.findByRole('dialog', { name: 'Conecta tu Blotato' })).toBeInTheDocument();
      // la dirección quedó en la canónica de la pestaña y conserva el parámetro (como el inicio de siempre, que no lo limpia)
      expect(direccion()).toBe(destino);
    });
  }

  it('niveles.herramienta.al_corregir_la_direccion_se_conservan_los_otros_parametros_y_el_ancla: utm_* y #ancla', async () => {
    abrirEn(`${VIDEO}?prompt=hola&utm_source=correo&utm_campaign=otono#ancla`);
    document.title = TITULO.video;
    render(<PaginaHerramienta lugar={lugar('video')} ir={ir} />);
    expect(pestana()).toBe('Imagen');
    // prompt ya se leyó (se va); lo que la página no puso (utm_*, el ancla) se queda
    expect(direccion()).toBe(`${IMAGEN}?utm_source=correo&utm_campaign=otono#ancla`);
    expect(document.title).toBe(TITULO.imagen);
    await cargada();
  });

  it('niveles.herramienta.cambiar_de_pestana_con_el_riel_conserva_el_query_y_el_ancla: no hay que reabrir lo que la persona traía', async () => {
    abrirEn(`${VIDEO}?utm_source=correo#ancla`);
    render(<PaginaHerramienta lugar={lugar('video')} ir={ir} />);
    await cargada();
    alRiel('Imagen');
    expect(direccion()).toBe(`${IMAGEN}?utm_source=correo#ancla`);
    alRiel('Edición');
    expect(direccion()).toBe(`${EDICION}?utm_source=correo#ancla`);
    alRiel('Video');
    expect(direccion()).toBe(`${VIDEO}?utm_source=correo#ancla`);
  });

  it('niveles.herramienta.sin_lugar_blotato_conectar_abre_el_dialogo_como_siempre', async () => {
    sinBlotato();
    abrirEn('/estudio/inicio/?blotato=conectar');
    render(<Inicio ir={ir} />);
    expect(await screen.findByRole('dialog', { name: 'Conecta tu Blotato' })).toBeInTheDocument();
    expect(direccion()).toBe('/estudio/inicio/?blotato=conectar');
  });
});

describe('niveles · sincronizar la dirección es cosmético y no puede tumbar la caja', () => {
  /** Lo que lanza Safari cuando se pasa de 100 `replaceState` en 30 s. */
  const bloqueada = () => new DOMException('Attempt to use history.replaceState() more than 100 times per 30 seconds', 'SecurityError');

  it('niveles.herramienta.si_replacestate_lanza_al_cambiar_de_pestana_la_caja_sigue_viva_y_conserva_lo_escrito', async () => {
    abrirEn(VIDEO);
    document.title = TITULO.video;
    render(<PaginaHerramienta lugar={lugar('video')} ir={ir} />);
    fireEvent.change(textoCaja(), { target: { value: 'un gato astronauta' } });
    const reemplazar = vi.spyOn(history, 'replaceState').mockImplementation(() => {
      throw bloqueada();
    });
    alRiel('Imagen');
    // no se desmontó nada: la caja sigue ahí, en la pestaña nueva y con el texto
    expect(reemplazar).toHaveBeenCalled();
    expect(pestana()).toBe('Imagen');
    expect(textoCaja().value).toBe('un gato astronauta');
    // la dirección se quedó donde estaba (desfasada, sin remedio), pero el título sigue a lo que se ve
    expect(direccion()).toBe(VIDEO);
    expect(document.title).toBe(TITULO.imagen);
    // y cuando vuelve a dejar escribir, la siguiente pestaña sí corrige la dirección
    reemplazar.mockRestore();
    alRiel('Edición');
    expect(direccion()).toBe(EDICION);
    alRiel('Imagen');
    expect(direccion()).toBe(IMAGEN);
    expect(textoCaja().value).toBe('un gato astronauta');
    await cargada();
  });

  it('niveles.herramienta.si_replacestate_lanza_al_montar_con_un_texto_que_abre_otra_pestana_la_caja_se_monta_igual', async () => {
    abrirEn(`${VIDEO}?prompt=hola`);
    const reemplazar = vi.spyOn(history, 'replaceState').mockImplementation(() => {
      throw bloqueada();
    });
    render(<PaginaHerramienta lugar={lugar('video')} ir={ir} />);
    // ni la corrección de la pestaña ni la limpieza del query (las dos escriben en la historia) pueden dejar la página en blanco
    expect(reemplazar).toHaveBeenCalled();
    expect(pestana()).toBe('Imagen');
    expect(textoCaja().value).toBe('hola');
    await cargada();
  });
});

describe('niveles · herramienta.tsx, la entrada de las 3 páginas de la caja', () => {
  /** Carga la entrada como si el navegador abriera `url`; devuelve lo que se montó (o undefined si no se montó nada). */
  async function abrir(url: string) {
    history.replaceState({ guardado: true }, '', url);
    vi.resetModules();
    const { montar } = await import('../../../nucleo/montar');
    // el espía es el mismo en cada carga (la fábrica del mock no se repite): se vacía para contar solo esta
    vi.mocked(montar).mockClear();
    await import('../herramienta');
    const llamada = vi.mocked(montar).mock.calls[0];
    return { montar: vi.mocked(montar), pagina: llamada?.[0] as { type: { name: string }; props: { lugar?: Lugar } } | undefined };
  }

  it('niveles.herramienta.la_entrada_monta_la_pagina_de_la_herramienta_que_dice_la_direccion', async () => {
    for (const [url, pantalla] of [
      [IMAGEN, 'imagen'],
      [VIDEO, 'video'],
      [EDICION, 'edicion'],
      [`${VIDEO}index.html`, 'video'],
    ] as const) {
      const { montar, pagina } = await abrir(url);
      expect(montar, url).toHaveBeenCalledTimes(1);
      // (la entrada se cargó con los módulos reiniciados: es la MISMA página, no la misma función; se reconoce por su nombre)
      expect(pagina?.type.name, url).toBe(PaginaHerramienta.name);
      expect(pagina?.props.lugar, url).toEqual(lugar(pantalla));
    }
  });

  it('niveles.herramienta.la_direccion_escrita_con_porcentajes_monta_la_misma_herramienta_que_el_servidor_sirvio', async () => {
    // uvicorn decodifica la dirección antes de decidir qué página sirve y el navegador la entrega cruda
    for (const url of ['/estudio/marketing/distrito/%76ideo/', '/estudio/%6Darketing/%64istrito/video/', '/estudio/marketing%2Fdistrito%2Fvideo/']) {
      const { montar, pagina } = await abrir(url);
      expect(montar, url).toHaveBeenCalledTimes(1);
      expect(pagina?.type.name, url).toBe(PaginaHerramienta.name);
      expect(pagina?.props.lugar, url).toEqual(lugar('video'));
    }
  });

  it('niveles.herramienta.si_la_direccion_no_es_una_herramienta_de_la_caja_se_dice_en_vez_de_dejar_la_pagina_en_blanco', async () => {
    // un nivel de navegación tiene su propia entrada (nivel.tsx); una hoja, otra pantalla: si esta página se abre ahí, no hay nada que enseñar
    for (const url of [
      '/estudio/',
      '/estudio/marketing/',
      '/estudio/marketing/distrito/',
      '/estudio/marketing/blotato/agenda/',
      '/estudio/marketing/distrito/Video/',
      '/estudio/marketing/distrito/nada/',
      '/estudio/marketing/distrito/video/de-mas/',
      '/estudio/nada/',
      '/otra/',
      '/estudio/%E0%A4%A/',
    ]) {
      const { montar, pagina } = await abrir(url);
      expect(montar, url).toHaveBeenCalledTimes(1);
      expect(pagina?.type.name, url).toBe(NoEncontrada.name);
      expect(document.title, url).toBe('No encontramos esa página');
    }
  });

  it('niveles.herramienta.la_entrada_no_toca_ni_el_titulo_ni_la_historia: eso lo hace la página al montarse', async () => {
    document.title = TITULO.video;
    const antes = history.length;
    await abrir(VIDEO);
    expect(document.title).toBe(TITULO.video);
    expect(history.length).toBe(antes);
    expect(history.state).toEqual({ guardado: true });
  });
});
