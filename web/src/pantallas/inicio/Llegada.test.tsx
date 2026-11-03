// Llegar a la caja con un texto ya escrito (Ajustes 3, 16-oct-2026): «Llevar a la caja» de la Biblioteca de prompts manda a
// `/estudio/marketing/distrito/imagen/?prompt=<texto>` (Imagen) o `…/video/?brief=<texto>` (Video). La página de la caja abre en esa
// pestaña con el texto puesto, lo dice, quita el parámetro de la dirección y NO crea ni cobra nada. Sin parámetros, nada cambia.
//
// Son pruebas SUELTAS (sin ID `inicio.`): es función nueva, no algo que la pantalla vieja garantizara (ver docs/migracion/inicio.md,
// «Pruebas sueltas»). La caja se prueba en Inicio.test.tsx y sus tres direcciones en niveles/Herramienta.test.tsx; aquí solo lo que
// tiene que ver con llegar con un texto.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { json, ponerMonedero, servidor } from '../../prueba/servidor';
import { MAX_TEXTO_DE_LLEGADA, leerLlegadaDeTexto, urlSinEntrada } from './llegada';
import { PaginaHerramienta } from './niveles/PaginaHerramienta';

const PROMPT_CON_HUECOS = 'Fotografía de producto de [PRODUCTO] flotando sobre un fondo azul medianoche liso. Formato cuadrado 1:1.';
const PROMPT_SIN_HUECOS = 'Plano cerrado de una taza de café con vapor subiendo despacio. Duración: 5 segundos.';
const AVISO_CON_HUECOS = 'Te trajimos el prompt. Cambia lo que va entre [corchetes] y pulsa Crear.';
const AVISO_SIN_HUECOS = 'Te trajimos el prompt. Revísalo y pulsa Crear.';

const IMAGEN = '/estudio/marketing/distrito/imagen/';
const VIDEO = '/estudio/marketing/distrito/video/';
/** La dirección que arma «Llevar a la caja» (la tabla DESTINO de logica.ts): la página de Imagen con `?prompt=` y la de Video con
 *  `?brief=`, y el texto con encodeURIComponent, como en pantallas/biblioteca/logica.ts. */
const con = (param: 'prompt' | 'brief', texto: string) => `${param === 'prompt' ? IMAGEN : VIDEO}?${param}=${encodeURIComponent(texto)}`;
/** Abre la página de la caja en `url`, como la abre herramienta.tsx: con la herramienta que dice la dirección. */
function abrir(url: string) {
  history.replaceState(null, '', url);
  const pantalla = new URL(url, location.href).pathname.startsWith(IMAGEN) ? 'imagen' : 'video';
  return render(<PaginaHerramienta lugar={{ area: 'mkt', grupo: 'distrito', pantalla }} ir={ir} />);
}

describe('la llegada con texto, sin React', () => {
  it('?prompt= es una imagen y ?brief= un video; el texto sale decodificado y sin recortar por dentro', () => {
    expect(leerLlegadaDeTexto('?prompt=' + encodeURIComponent(PROMPT_CON_HUECOS))).toEqual({ familia: 'imagenes', texto: PROMPT_CON_HUECOS });
    expect(leerLlegadaDeTexto('?brief=' + encodeURIComponent(PROMPT_SIN_HUECOS))).toEqual({ familia: 'videos', texto: PROMPT_SIN_HUECOS });
    // un «+» escrito en el texto viaja como %2B y vuelve como «+»; los saltos de línea se conservan
    const raro = 'a + b\n\ncon «comillas» y tildes: ñandú';
    expect(leerLlegadaDeTexto('?prompt=' + encodeURIComponent(raro))?.texto).toBe(raro);
  });

  it('sin parámetro, vacío o solo espacios no es una llegada; con los dos, gana prompt', () => {
    expect(leerLlegadaDeTexto('')).toBeNull();
    expect(leerLlegadaDeTexto('?otra=cosa')).toBeNull();
    expect(leerLlegadaDeTexto('?prompt=')).toBeNull();
    expect(leerLlegadaDeTexto('?brief=%20%20')).toBeNull();
    expect(leerLlegadaDeTexto('?prompt=uno&brief=dos')).toEqual({ familia: 'imagenes', texto: 'uno' });
    // un prompt vacío no tapa a un brief con texto
    expect(leerLlegadaDeTexto('?prompt=&brief=dos')).toEqual({ familia: 'videos', texto: 'dos' });
  });

  it('un texto más largo que el cuadro de la caja se corta a 5000 (la llegada no se pierde)', () => {
    const l = leerLlegadaDeTexto('?prompt=' + 'a'.repeat(6000));
    expect(l?.texto).toHaveLength(5000);
    expect(MAX_TEXTO_DE_LLEGADA).toBe(5000);
  });

  it('la dirección se limpia de prompt y de brief, y conserva lo demás (?blotato=conectar, el ancla); sin ellos, nada que limpiar', () => {
    expect(urlSinEntrada('http://x/estudio/marketing/distrito/imagen/?prompt=hola&blotato=conectar#abajo')).toBe('/estudio/marketing/distrito/imagen/?blotato=conectar#abajo');
    expect(urlSinEntrada('http://x/estudio/marketing/distrito/imagen/?brief=hola')).toBe('/estudio/marketing/distrito/imagen/');
    expect(urlSinEntrada('http://x/estudio/marketing/distrito/imagen/?desde=mkt.blotato.agenda&ver=mapa&prompt=x')).toBe('/estudio/marketing/distrito/imagen/');
    expect(urlSinEntrada('http://x/estudio/marketing/distrito/imagen/?blotato=conectar')).toBeNull();
    expect(urlSinEntrada('http://x/estudio/marketing/distrito/imagen/')).toBeNull();
    // aunque venga vacío, el parámetro se quita
    expect(urlSinEntrada('http://x/estudio/marketing/distrito/imagen/?prompt=')).toBe('/estudio/marketing/distrito/imagen/');
  });
});

// `desde` y `ver`: las traían las migas de las pantallas hoja de antes; un marcador viejo todavía las trae al mapa, y nivel.tsx las quita
describe('urlSinEntrada · la URL limpia una vez leída la entrada', () => {
  it('quita desde y ver y deja la ruta', () => {
    expect(urlSinEntrada('http://x/estudio/?desde=mkt.blotato.agenda&ver=mapa')).toBe('/estudio/');
  });

  it('deja lo demás: otros parámetros y el ancla', () => {
    expect(urlSinEntrada('http://x/estudio/?blotato=conectar&desde=mkt.blotato.agenda&ver=grupos#abajo')).toBe('/estudio/?blotato=conectar#abajo');
  });

  it('con uno solo de los dos también limpia (no se queda un `ver` suelto)', () => {
    expect(urlSinEntrada('http://x/estudio/?ver=mapa')).toBe('/estudio/');
    expect(urlSinEntrada('http://x/estudio/?desde=mkt.blotato.agenda')).toBe('/estudio/');
  });

  it('si no traía ninguno, null: no hay nada que reescribir', () => {
    expect(urlSinEntrada('http://x/estudio/')).toBeNull();
    expect(urlSinEntrada('http://x/estudio/?blotato=conectar')).toBeNull();
  });
});

let ir: ReturnType<typeof vi.fn<(url: string) => void>>;
let f: ReturnType<typeof servidor>;

const textoCaja = () => screen.getByRole('textbox', { name: '¿Qué vamos a crear hoy?' }) as HTMLTextAreaElement;
const riel = (nombre: string) => within(screen.getByRole('group', { name: 'Qué quieres crear' })).getByRole('button', { name: nombre });
const aviso = (t: string) => screen.queryByText(t);

beforeEach(() => {
  vi.unstubAllGlobals();
  ir = vi.fn<(url: string) => void>();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  ponerMonedero(100);
  f = servidor({
    '/api/proyectos': () => json([]),
    '/api/slots': () => json({ slots: null, activos: 0 }),
    '/api/imagenes': () => json({ total: 0, imagenes: [] }),
    '/api/edicion/proyectos': () => json([]),
    '/api/clip': () => json({ clips: [] }),
    '/api/blotato': () => json({ conectado: false, origen: null, cuentas: [], error: null, plan: null }),
    '/api/moderar': () => json({ permitido: true }),
  });
});

afterEach(() => {
  delete window.monedero;
  history.replaceState(null, '', '/');
});

/** Lo que el servidor recibió que NO es una lectura: crear o cobrar algo sería un POST, un PUT o un DELETE. */
const escrituras = () => f.mock.calls.filter(c => (c[1]?.method ?? 'GET') !== 'GET').map(c => `${c[1]?.method} ${String(c[0])}`);

describe('la página de la caja, al llegar con un texto', () => {
  it('?prompt=: la caja abierta DIRECTO en Imagen («Crear una imagen») con el texto puesto, el aviso dicho y el foco en el cuadro', async () => {
    abrir(con('prompt', PROMPT_CON_HUECOS));
    // lo primero que se ve es la caja, ya en su pestaña
    expect(screen.queryByText('Elige un área')).toBeNull();
    expect(textoCaja().value).toBe(PROMPT_CON_HUECOS);
    expect(riel('Imagen')).toHaveAttribute('aria-pressed', 'true');
    expect(riel('Video')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Crear una imagen/ })).toBeInTheDocument();
    expect(aviso(AVISO_CON_HUECOS)).toBeInTheDocument();
    // el cuadro quedó descrito por el aviso y con el foco
    expect(textoCaja()).toHaveFocus();
    expect(textoCaja().getAttribute('aria-describedby')).toBe(aviso(AVISO_CON_HUECOS)!.closest('[id]')!.id);
    // la dirección quedó limpia: recargar no vuelve a llenar la caja
    expect(location.pathname + location.search).toBe(IMAGEN);
    // las migas dicen dónde estás: Marketing › Distrito (enlaces a su nivel)
    expect(within(screen.getByRole('navigation', { name: 'Dónde estás' })).getAllByRole('link').map(b => b.textContent)).toEqual(['Marketing', 'Distrito']);
    await waitFor(() => expect(f).toHaveBeenCalled());
    // llegar no crea ni cobra nada
    expect(escrituras()).toEqual([]);
    expect(window.monedero!.refrescar).not.toHaveBeenCalled();
    expect(ir).not.toHaveBeenCalled();
  });

  it('?brief=: la caja abierta en Video («Un video corto») con el texto puesto', () => {
    abrir(con('brief', PROMPT_SIN_HUECOS));
    expect(textoCaja().value).toBe(PROMPT_SIN_HUECOS);
    expect(riel('Video')).toHaveAttribute('aria-pressed', 'true');
    expect(riel('Imagen')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Un video corto/ })).toBeInTheDocument();
    expect(textoCaja()).toHaveFocus();
    expect(location.search).toBe('');
  });

  it('un prompt sin [huecos] no manda cambiar lo que va entre corchetes: dice que lo revises', () => {
    abrir(con('brief', PROMPT_SIN_HUECOS));
    expect(aviso(AVISO_SIN_HUECOS)).toBeInTheDocument();
    expect(aviso(AVISO_CON_HUECOS)).toBeNull();
  });

  it('el aviso se queda mientras se edita, y se va al vaciar el cuadro, al cambiar de pestaña o al elegir otra desde fuera', async () => {
    const { unmount } = abrir(con('prompt', PROMPT_CON_HUECOS));
    await userEvent.type(textoCaja(), ' Más cosas.');
    expect(aviso(AVISO_CON_HUECOS)).toBeInTheDocument();
    await userEvent.clear(textoCaja());
    expect(aviso(AVISO_CON_HUECOS)).toBeNull();
    unmount();

    abrir(con('prompt', PROMPT_CON_HUECOS));
    await userEvent.click(riel('Video'));
    expect(aviso(AVISO_CON_HUECOS)).toBeNull();
    // el texto sigue ahí: cambiar de pestaña no lo borra
    expect(textoCaja().value).toBe(PROMPT_CON_HUECOS);
  });

  it('elegir otra tarea desde fuera (la tarjeta «Crear un video» de quien empieza) también quita el aviso, y el texto se queda', async () => {
    abrir(con('prompt', PROMPT_CON_HUECOS));
    expect(aviso(AVISO_CON_HUECOS)).toBeInTheDocument();
    // las listas vienen vacías: salen los tres caminos de quien empieza, y el primero llama a caja.elegir('videos', 'investigacion')
    await userEvent.click(await screen.findByRole('button', { name: 'Crear un video' }));
    expect(aviso(AVISO_CON_HUECOS)).toBeNull();
    expect(riel('Video')).toHaveAttribute('aria-pressed', 'true');
    expect(textoCaja().value).toBe(PROMPT_CON_HUECOS);
  });

  it('con ?prompt= Y un ?desde=&ver= viejo a la vez gana el texto: la caja abre con él, y la dirección queda sin los tres', () => {
    abrir(`${IMAGEN}?prompt=${encodeURIComponent(PROMPT_CON_HUECOS)}&desde=mkt.blotato.agenda&ver=mapa`);
    expect(screen.queryByText('Elige un área')).toBeNull();
    expect(textoCaja().value).toBe(PROMPT_CON_HUECOS);
    expect(aviso(AVISO_CON_HUECOS)).toBeInTheDocument();
    expect(location.search).toBe('');
  });

  it('el texto llega como TEXTO: nada de lo que trae se vuelve HTML', () => {
    const malo = '<img src=x onerror="window.__roto=1"> y <b>negritas</b> [X]';
    const { container } = abrir(con('prompt', malo));
    expect(textoCaja().value).toBe(malo);
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect((window as unknown as { __roto?: number }).__roto).toBeUndefined();
  });

  it('con Crear, el texto que llegó se manda por el camino de siempre (moderar primero) y el aviso se va', async () => {
    const peticion = vi.fn();
    f = servidor({
      '/api/proyectos': () => json([]),
      '/api/slots': () => json({ slots: null, activos: 0 }),
      '/api/imagenes': (_u, init) => {
        if (init?.method !== 'POST') return json({ total: 0, imagenes: [] });
        peticion(JSON.parse(String(init.body)));
        return json({ nombre: 'img-1.jpg', url: '/api/imagenes/img-1.jpg' });
      },
      '/api/edicion/proyectos': () => json([]),
      '/api/clip': () => json({ clips: [] }),
      '/api/blotato': () => json({ conectado: false, origen: null, cuentas: [], error: null, plan: null }),
      '/api/moderar': () => json({ permitido: true }),
    });
    abrir(con('prompt', PROMPT_CON_HUECOS));
    expect(escrituras()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(peticion).toHaveBeenCalled());
    expect(peticion.mock.calls[0]![0]).toMatchObject({ prompt: PROMPT_CON_HUECOS });
    await waitFor(() => expect(aviso(AVISO_CON_HUECOS)).toBeNull());
  });
});

describe('la página de la caja, SIN parámetros: no cambia', () => {
  it('abre en la pestaña de su dirección, vacía y sin aviso, sin tocar el foco ni lo demás de la dirección', async () => {
    abrir(`${VIDEO}?blotato=nada`);
    expect(riel('Video')).toHaveAttribute('aria-pressed', 'true');
    expect(textoCaja().value).toBe('');
    expect(screen.queryByText(/Te trajimos el prompt/)).toBeNull();
    expect(document.body).toHaveFocus();
    // lo que no es de la entrada se queda en la dirección
    expect(location.pathname + location.search).toBe(`${VIDEO}?blotato=nada`);
    await waitFor(() => expect(f).toHaveBeenCalled());
  });

  it('un ?prompt= vacío no es una llegada: la caja abre en su pestaña sin texto ni aviso, y la dirección igual se limpia', async () => {
    abrir(`${VIDEO}?prompt=`);
    expect(riel('Video')).toHaveAttribute('aria-pressed', 'true');
    expect(textoCaja().value).toBe('');
    expect(screen.queryByText(/Te trajimos el prompt/)).toBeNull();
    expect(location.pathname + location.search).toBe(VIDEO);
    await waitFor(() => expect(f).toHaveBeenCalled());
  });
});
