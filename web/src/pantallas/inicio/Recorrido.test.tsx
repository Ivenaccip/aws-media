// El recorrido del inicio como COMPORTAMIENTO (dueño, 15-oct-2026: «Mapa con Irremplazables», y en la segunda ronda «el mapa es el
// inicio»): se aterriza en el mapa, el título va arriba y fuera de cualquier tarjeta, solo la caja lleva tarjeta, no hay «Volver a …» (las
// migas suben de nivel; la única excepción es la página aparte de donde se llegó), Esc, el foco, la caja que no se desmonta, lo que va
// debajo, y la entrada por ?desde=…&ver=…. Se prueba con el Inicio entero (lo que ve la persona), con el servidor simulado. La lógica sola
// está en estadoRecorrido.test.ts; el mapa, las opciones y la lista, cada uno solo, en Mapa.test.tsx y Pantallas.test.tsx; la geometría
// (centrado, posición del título, ancho de la tarjeta) NO se puede medir en jsdom: la miden las pruebas de navegador (e2e/inicio-recorrido).
import { createRef, StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { json, ponerAvisos, servidor, sinRed } from '../../prueba/servidor';
import { huecoDe, IDEAS_EDICION, PISTA_CADA_MS, PISTA_FUNDIDO_MS } from './edicion';
import { Inicio } from './Inicio';
import type { EstadoBlotato, Proyecto } from './logica';
import { Recorrido } from './Recorrido';
import { REPOSO } from './estadoRecorrido';

const CONECTADO: EstadoBlotato = {
  conectado: true,
  origen: 'usuario',
  cuentas: [{ id: '1', platform: 'instagram', fullname: 'Estudio Norte', username: 'estudio.norte' }],
  error: null,
  plan: { nombre: 'Starter', usd_por_mes: 29 },
};
const SIN_CLAVE: EstadoBlotato = { ...CONECTADO, conectado: false, origen: null, cuentas: [] };
const P1: Proyecto = {
  id: 'p1',
  creado: '2026-09-20T10:00:00Z',
  estado: 'listo',
  brief: 'La historia del café',
  archivado: false,
  miniatura: null,
  miniatura_alt: null,
};

function montar({ proyectos = [] as Proyecto[], blotato = CONECTADO as EstadoBlotato | null } = {}) {
  return servidor({
    '/api/proyectos': () => json(proyectos),
    '/api/slots': () => json({ slots: null, activos: 0 }),
    '/api/imagenes': () => json({ total: 0, imagenes: [] }),
    '/api/edicion/proyectos': () => json([]),
    '/api/clip': () => json({ clips: [] }),
    '/api/blotato': () => (blotato ? json(blotato) : sinRed()),
    '/api/moderar': () => json({ permitido: true }),
  });
}

let ir: ReturnType<typeof vi.fn<(url: string) => void>>;
/** El inicio recién abierto: el mapa, con la caja montada y escondida. */
const pintar = () => render(<Inicio ir={ir} />);

beforeEach(() => {
  vi.unstubAllGlobals();
  montar(); // un servidor por omisión: una cuenta nueva con Blotato conectado (cada prueba pone el suyo si necesita otro)
  ir = vi.fn<(url: string) => void>();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  history.replaceState(null, '', '/estudio/inicio/');
});

// lo que se ve y lo que se pulsa
const campo = () => screen.getByRole('textbox', { name: '¿Qué vamos a crear hoy?' });
const hayCaja = () => screen.queryByRole('textbox', { name: '¿Qué vamos a crear hoy?' }) !== null;
const h2 = (nombre: string) => screen.getByRole('heading', { level: 2, name: nombre });
/** La región del inicio: el título, las migas y el paso de ahora (no es la tarjeta: esa es `[data-limite-lista]`). */
const region = () => screen.getByRole('region', { name: 'Irremplazables' });
/** La tarjeta de la caja (borde, fondo y relleno) o, en los demás pasos, el mismo contenedor sin nada de eso. */
const cuerpo = () => region().querySelector<HTMLElement>('[data-limite-lista]')!;
const migaArea = (area = 'Marketing') => screen.getByRole('button', { name: `Volver al mapa para cambiar de área (ahora: ${area})` });
const migaGrupo = (area: string, grupo: string) => screen.getByRole('button', { name: `Volver a las opciones de ${area} (ahora: ${grupo})` });
/** Todo «Volver a …» que haya: un botón o un enlace. Las migas se llaman «Volver al mapa…» y «Volver a las opciones…» (no cuentan). */
const volveres = () => {
  const nombre = { name: /^Volver a (?!las opciones)/ };
  return [...screen.queryAllByRole('button', nombre), ...screen.queryAllByRole('link', nombre)];
};
const ficha = (nombre: RegExp | string) => within(screen.getByRole('group', { name: 'Áreas' })).getByRole('button', { name: nombre });
// la lista de pantallas de un grupo (las migas son otra lista, dentro de su <nav>)
const lista = () => screen.getAllByRole('list').find(l => !l.closest('nav'))!;
const tarjetaDeGrupo = (area: string, grupo: string) => within(screen.getByRole('group', { name: area })).getByRole('button', { name: new RegExp(`^${grupo}`) });
const riel = () => within(screen.getByRole('group', { name: 'Qué quieres crear' }));

async function alMapa() {
  await userEvent.click(migaArea());
}
/** Desde el mapa: el área elegida. */
async function alasOpciones(area = 'Marketing') {
  await userEvent.click(ficha(new RegExp(`^${area}`)));
}
/** Desde el mapa: el área y el grupo. */
async function aLaLista(area: string, grupo: string) {
  await alasOpciones(area);
  await userEvent.click(tarjetaDeGrupo(area, grupo));
}
/** Desde el mapa, el camino a la caja: Marketing → Distrito. */
async function alaCaja() {
  await aLaLista('Marketing', 'Distrito');
}
/** El inicio ya en la caja (lo que antes era aterrizar). */
async function pintarEnLaCaja() {
  const r = pintar();
  await alaCaja();
  return r;
}

describe('el inicio · se aterriza en el mapa', () => {
  it('lo primero que se ve es «Elige un área» con las cinco áreas: sin migas, sin «Volver a …», y la caja escondida', async () => {
    pintar();
    expect(h2('Elige un área')).toBeInTheDocument();
    const nombres = within(screen.getByRole('group', { name: 'Áreas' })).getAllByRole('button').map(b => b.querySelector('span')?.textContent);
    expect(nombres).toEqual(['Marketing', 'Producto', 'Central', 'Ventas', 'Automatizaciones']);
    expect(screen.queryByRole('navigation', { name: 'Dónde estás' })).toBeNull();
    expect(volveres()).toHaveLength(0);
    expect(hayCaja()).toBe(false);
    expect(screen.queryByRole('heading', { name: '¿Qué vamos a crear hoy?' })).toBeNull();
  });

  it('la caja está MONTADA aunque no se vea (el estado vive en ella): su campo está en el árbol, escondido', () => {
    const { container } = pintar();
    const montado = container.querySelector('textarea');
    expect(montado).not.toBeNull();
    expect(montado?.closest('[hidden]')).not.toBeNull();
  });

  it('nada se ve elegido: ninguna ficha lleva «Estás aquí» ni aria-current (dueño: «no debería de verse de ese tono, hasta que lo seleccionen»)', () => {
    pintar();
    expect(screen.queryByText('Estás aquí')).toBeNull();
    for (const f of within(screen.getByRole('group', { name: 'Áreas' })).getAllByRole('button')) expect(f).not.toHaveAttribute('aria-current');
  });

  it('…y tampoco después de haber estado en la caja de Marketing: el mapa sigue sin marcar nada', async () => {
    await pintarEnLaCaja();
    await alMapa();
    expect(h2('Elige un área')).toBeInTheDocument();
    expect(screen.queryByText('Estás aquí')).toBeNull();
    for (const f of within(screen.getByRole('group', { name: 'Áreas' })).getAllByRole('button')) expect(f).not.toHaveAttribute('aria-current');
  });

  it('Marketing y Central, las dos que se abren, se ven iguales: el mismo borde y el mismo fondo (el tono de hoy de «Central»)', () => {
    pintar();
    const tono = (nombre: RegExp) => ficha(nombre).className.split(/\s+/).filter(c => /^(border-linea|bg-superficie|bg-elevada|border-campo)$/.test(c));
    expect(tono(/^Marketing/)).toEqual(['border-linea', 'bg-superficie']);
    expect(tono(/^Central/)).toEqual(['border-linea', 'bg-superficie']);
  });

  it('Producto, Ventas y Automatizaciones no abren nada: el mapa se queda como estaba', async () => {
    pintar();
    for (const nombre of ['Producto', 'Ventas', 'Automatizaciones']) {
      await userEvent.click(ficha(new RegExp(`^${nombre}`)));
      expect(h2('Elige un área')).toBeInTheDocument();
    }
    expect(screen.queryByRole('heading', { name: 'Elige un grupo' })).toBeNull();
  });

  it('sin menú a la izquierda: ni navegación de secciones, ni aside', () => {
    const { container } = pintar();
    expect(screen.queryByRole('navigation', { name: 'Secciones' })).toBeNull();
    expect(container.querySelector('aside')).toBeNull();
    expect(screen.queryByText('Estudio de Contenido')).toBeNull();
  });
});

describe('el título «Irremplazables» · fuera y arriba de cualquier tarjeta, en todos los pasos', () => {
  const sinTarjeta = (el: HTMLElement) => !/(^|\s)(border|bg-superficie|p-6)(\s|$)/.test(el.className);

  it('es el único h1, en dorado, y NO está dentro del contenedor de la tarjeta: va antes que él', async () => {
    pintar();
    expect(screen.getAllByRole('heading', { level: 1 }).map(h => h.textContent)).toEqual(['Irremplazables']);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.querySelector('.texto-oro')).not.toBeNull();
    expect(h1).toHaveClass('[overflow-wrap:anywhere]');
    expect(cuerpo().contains(h1)).toBe(false);
    expect(h1.compareDocumentPosition(cuerpo()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // y es lo primero de la región, que lo toma como su nombre
    expect(region().firstElementChild).toBe(h1);
  });

  it('en la caja el h1 sigue fuera: la tarjeta lleva las migas y la caja, y el título queda arriba de ella', async () => {
    await pintarEnLaCaja();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(cuerpo().contains(h1)).toBe(false);
    expect(region().firstElementChild).toBe(h1);
    expect(within(cuerpo()).getByRole('navigation', { name: 'Dónde estás' })).toBeInTheDocument();
    expect(within(cuerpo()).getByRole('textbox', { name: '¿Qué vamos a crear hoy?' })).toBeInTheDocument();
  });

  it('en TODOS los pasos (mapa, opciones, lista, caja) hay un solo h1, es lo primero de la región y no está en la tarjeta', async () => {
    pintar();
    const comprobar = () => {
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(region().firstElementChild).toBe(screen.getByRole('heading', { level: 1 }));
      expect(cuerpo().contains(screen.getByRole('heading', { level: 1 }))).toBe(false);
    };
    comprobar();
    await alasOpciones();
    comprobar();
    await userEvent.click(tarjetaDeGrupo('Marketing', 'Blotato'));
    comprobar();
    await userEvent.click(migaGrupo('Marketing', 'Blotato'));
    await userEvent.click(tarjetaDeGrupo('Marketing', 'Distrito'));
    comprobar();
  });

  it('SOLO la caja lleva tarjeta (borde, fondo y relleno): el mapa, las opciones y la lista de un grupo son pantallas sueltas', async () => {
    pintar();
    expect(sinTarjeta(cuerpo())).toBe(true); // el mapa
    await alasOpciones();
    expect(sinTarjeta(cuerpo())).toBe(true); // las opciones
    await userEvent.click(tarjetaDeGrupo('Marketing', 'Blotato'));
    expect(sinTarjeta(cuerpo())).toBe(true); // la lista
    await userEvent.click(migaGrupo('Marketing', 'Blotato'));
    await userEvent.click(tarjetaDeGrupo('Marketing', 'Distrito'));
    expect(cuerpo()).toHaveClass('border', 'border-linea', 'bg-superficie', 'p-6'); // la caja
    // y al salir de la caja la tarjeta se va: el MISMO contenedor, sin nada de tarjeta
    await alMapa();
    expect(sinTarjeta(cuerpo())).toBe(true);
  });

  it('las migas van DENTRO de la tarjeta (a la izquierda) con la caja, y centradas bajo el título en los pasos sin tarjeta', async () => {
    pintar();
    await alasOpciones();
    const filaDelMapa = screen.getByRole('navigation', { name: 'Dónde estás' }).parentElement!;
    expect(filaDelMapa).toHaveClass('justify-center');
    expect(cuerpo().contains(filaDelMapa)).toBe(true); // el contenedor es el mismo, solo que sin tarjeta
    await userEvent.click(tarjetaDeGrupo('Marketing', 'Distrito'));
    const filaDeLaCaja = screen.getByRole('navigation', { name: 'Dónde estás' }).parentElement!;
    expect(filaDeLaCaja).not.toHaveClass('justify-center');
    expect(cuerpo()).toHaveClass('border');
  });

  it('el título no pierde nada de lo suyo al salir de la tarjeta: texto dorado en un <span> en línea, y partible para no salirse a 320 px', () => {
    pintar();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveClass('text-center', 'font-titulo', 'text-titulo-lg', 'font-extrabold');
    expect(h1.firstElementChild?.tagName).toBe('SPAN');
    expect(h1.firstElementChild).toHaveClass('texto-oro');
  });
});

describe('la caja, al llegar a ella · Marketing › Distrito', () => {
  it('elegir Marketing y Distrito la muestra, con sus migas, y NO hay «Volver a Imagen/Video/Edición»', async () => {
    await pintarEnLaCaja();
    expect(campo()).toBeInTheDocument();
    expect(migaArea()).toHaveTextContent('Marketing');
    expect(migaGrupo('Marketing', 'Distrito')).toHaveAttribute('aria-current', 'step');
    expect(volveres()).toHaveLength(0);
    await screen.findByRole('button', { name: /^Imagen$/ });
  });

  it('la tarjeta es el límite de las listas de la caja: lleva data-limite-lista, que SelectorOpcion busca para no sobresalir de ella', async () => {
    await pintarEnLaCaja();
    expect(cuerpo()).toHaveAttribute('data-limite-lista');
    // y el chip de la caja está dentro de ella (si no, no la encontraría con `closest`)
    expect(document.querySelector('button[aria-haspopup="listbox"]')!.closest('[data-limite-lista]')).toBe(cuerpo());
  });

  it('un h2 por paso: «Elige un área» al abrir, el de cada paso al abrirlo, y «¿Qué vamos a crear hoy?» en la caja', async () => {
    pintar();
    const titulos = () => within(region()).getAllByRole('heading', { level: 2 }).map(h => h.textContent);
    expect(titulos()).toEqual(['Elige un área']);
    await userEvent.click(ficha(/^Marketing/));
    expect(titulos()).toEqual(['Elige un grupo']);
    await userEvent.click(tarjetaDeGrupo('Marketing', 'Blotato'));
    expect(titulos()).toEqual(['Blotato']);
    await userEvent.click(migaGrupo('Marketing', 'Blotato'));
    await userEvent.click(tarjetaDeGrupo('Marketing', 'Distrito'));
    expect(titulos()).toEqual(['¿Qué vamos a crear hoy?']);
    // y siempre el mismo y único h1
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('lo que la caja le dice a quien no escribió nada', () => {
  it('ya no lo manda a un menú de la izquierda que no existe: dice solo lo que falta', async () => {
    await pintarEnLaCaja();
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));
    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('Cuéntanos qué quieres primero.');
    expect(aviso.textContent).not.toMatch(/menú|izquierda/i);
  });
});

// NAV-05 del prototipo (el «aviso fantasma»): el cuadro de avisos de abajo a la derecha es de toda la página, no de la caja. Un error de la
// caja («Cuéntanos qué quieres primero.») no puede quedarse flotando sobre el mapa o una lista, donde ya no hay formulario que lo explique.
describe('un error de la caja no se queda en el cuadro de avisos mientras la caja está escondida', () => {
  it('«Crear» sin texto y abrir el mapa: el error de la caja sale del cuadro; con otro paso a la vista no vuelve a quitarse nada', async () => {
    const avisos = ponerAvisos();
    await pintarEnLaCaja();
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));
    expect(avisos.mostrar).toHaveBeenCalledExactlyOnceWith('Cuéntanos qué quieres primero.', { tipo: 'mal', clave: 'caja' });
    // con la caja a la vista el error se queda (hasta que se corrija o se cierre)
    expect(avisos.quitar).not.toHaveBeenCalled();
    await alMapa();
    expect(avisos.quitar).toHaveBeenCalledExactlyOnceWith('caja');
    // cambiar de paso entre pasos que tampoco son la caja no repite el quitar: ya no hay nada que quitar
    await userEvent.click(ficha(/^Marketing/));
    await userEvent.click(tarjetaDeGrupo('Marketing', 'Blotato'));
    expect(avisos.quitar).toHaveBeenCalledTimes(1);
  });

  it('también el de Edición («Primero agrega el video…») y también cuando se esconde por la lista de un grupo', async () => {
    const avisos = ponerAvisos();
    await pintarEnLaCaja();
    await userEvent.click(riel().getByRole('button', { name: 'Edición' }));
    await userEvent.click(screen.getByRole('button', { name: /^Iniciar/ }));
    expect(avisos.mostrar).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('Primero agrega el video'), { tipo: 'mal', clave: 'caja' });
    await userEvent.click(migaGrupo('Marketing', 'Distrito'));
    await userEvent.click(tarjetaDeGrupo('Marketing', 'Blotato'));
    expect(avisos.quitar).toHaveBeenCalledExactlyOnceWith('caja');
  });

  it('«Ya estamos creando…» NO es un error: con el pedido en marcha, abrir el mapa lo deja en el cuadro', async () => {
    const avisos = ponerAvisos();
    // el servidor tarda: el pedido sigue en vuelo y su aviso verde en el cuadro
    servidor({
      '/api/proyectos': () => json([]),
      '/api/slots': () => json({ slots: null, activos: 0 }),
      '/api/imagenes': () => json({ total: 0, imagenes: [] }),
      '/api/edicion/proyectos': () => json([]),
      '/api/clip': () => json({ clips: [] }),
      '/api/blotato': () => json(CONECTADO),
      '/api/moderar': () => json({ permitido: true }),
      '/api/clip/generar': () => new Promise<Response>(() => undefined),
    });
    await pintarEnLaCaja();
    await userEvent.type(campo(), 'un gato en la luna');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(avisos.mostrar).toHaveBeenCalledWith(expect.stringContaining('Ya estamos creando'), { tipo: 'ok', clave: 'caja' }));
    await alMapa();
    expect(avisos.quitar).not.toHaveBeenCalled();
  });
});

describe('el mapa, desde la caja', () => {
  it('la miga del área lo abre; en el mapa se está eligiendo el primer nivel: sin migas y sin «Volver a …»', async () => {
    await pintarEnLaCaja();
    await alMapa();
    expect(h2('Elige un área')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Dónde estás' })).toBeNull();
    expect(volveres()).toHaveLength(0);
  });

  it('la caja se esconde pero SIGUE MONTADA: lo escrito y la pestaña están ahí al volver a ella por Marketing › Distrito', async () => {
    const { container } = await pintarEnLaCaja();
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    await userEvent.type(campo(), 'un faro de noche');
    await alMapa();
    expect(hayCaja()).toBe(false);
    // no se desmontó: el campo sigue en el árbol (escondido, no enfocable) con su texto
    const montado = container.querySelector('textarea');
    expect(montado).toHaveValue('un faro de noche');
    expect(montado?.closest('[hidden]')).not.toBeNull();
    await alaCaja();
    expect(campo()).toHaveValue('un faro de noche');
    expect(screen.getByRole('button', { name: 'Imagen' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('no hay «Volver a Imagen», «Volver a Video» ni «Volver a Edición»: ni con el mapa ni con las opciones abiertas, en ninguna pestaña', async () => {
    await pintarEnLaCaja();
    for (const pestana of ['Imagen', 'Edición', 'Video']) {
      await userEvent.click(screen.getByRole('button', { name: pestana }));
      await alMapa();
      expect(volveres()).toHaveLength(0);
      await alasOpciones();
      expect(volveres()).toHaveLength(0);
      await userEvent.click(tarjetaDeGrupo('Marketing', 'Distrito'));
      // al volver a la caja, la pestaña que dejaste sigue siendo la que elegiste
      expect(screen.getByRole('button', { name: pestana })).toHaveAttribute('aria-pressed', 'true');
    }
  });
});

describe('las tres opciones', () => {
  it('elegir Marketing en el mapa abre Distrito · Blotato · Avanzado, con lo que trae cada uno y SIN «Estás aquí»: nadie ha elegido nada', async () => {
    pintar();
    await alasOpciones();
    expect(h2('Elige un grupo')).toBeInTheDocument();
    const grupos = within(screen.getByRole('group', { name: 'Marketing' })).getAllByRole('button');
    expect(grupos.map(g => g.querySelector('b')?.textContent)).toEqual(['Distrito', 'Blotato', 'Avanzado']);
    expect(grupos[0]).toHaveTextContent('Imagen · Video · Edición');
    // el grupo de la caja escondida no se marca: sería el mismo «parece seleccionado» que se quitó del mapa
    expect(screen.queryByText('Estás aquí')).toBeNull();
    for (const g of grupos) expect(g).not.toHaveAttribute('aria-current');
    // la miga del área está (y es donde estás); la del grupo todavía no
    expect(migaArea()).toHaveAttribute('aria-current', 'step');
    expect(screen.queryByRole('button', { name: /^Volver a las opciones de/ })).toBeNull();
    expect(volveres()).toHaveLength(0);
  });

  it('después de elegir un grupo SÍ se sabe dónde estás: al reabrir las opciones, «Estás aquí» está en ese grupo', async () => {
    pintar();
    await aLaLista('Marketing', 'Blotato');
    await userEvent.click(migaGrupo('Marketing', 'Blotato'));
    const grupos = within(screen.getByRole('group', { name: 'Marketing' })).getAllByRole('button');
    expect(grupos.filter(g => g.textContent?.includes('Estás aquí')).map(g => g.querySelector('b')?.textContent)).toEqual(['Blotato']);
    expect(tarjetaDeGrupo('Marketing', 'Blotato')).toHaveAttribute('aria-current', 'location');
    expect(tarjetaDeGrupo('Marketing', 'Distrito')).not.toHaveAttribute('aria-current');
  });

  it('elegir Distrito muestra la caja, tal como estaba', async () => {
    await pintarEnLaCaja();
    await userEvent.type(campo(), 'mi perro en la playa');
    await alMapa();
    await alasOpciones();
    await userEvent.click(tarjetaDeGrupo('Marketing', 'Distrito'));
    expect(campo()).toHaveValue('mi perro en la playa');
    expect(volveres()).toHaveLength(0);
  });

  it('mirar otra área NO te saca de donde estabas: en Central ninguna tarjeta dice «Estás aquí», y al volver a Marketing sigue en Distrito', async () => {
    await pintarEnLaCaja();
    await alMapa();
    await alasOpciones('Central');
    expect(within(screen.getByRole('group', { name: 'Central' })).getAllByRole('button').map(g => g.querySelector('b')?.textContent)).toEqual([
      'Distrito',
      'Deepseek',
    ]);
    // en Central no estás en ninguno
    expect(screen.queryByText('Estás aquí')).toBeNull();
    await userEvent.click(migaArea('Central'));
    await alasOpciones('Marketing');
    expect(tarjetaDeGrupo('Marketing', 'Distrito')).toHaveTextContent('Estás aquí');
    // y la caja de Marketing › Distrito sigue siendo la caja: no se movió
    await userEvent.click(tarjetaDeGrupo('Marketing', 'Distrito'));
    expect(campo()).toBeInTheDocument();
    expect(migaGrupo('Marketing', 'Distrito')).toBeInTheDocument();
  });

  it('la miga del grupo reabre las opciones de SU área, y la del área el mapa; sin «Volver a …» en ninguna', async () => {
    await pintarEnLaCaja();
    await userEvent.click(migaGrupo('Marketing', 'Distrito'));
    expect(h2('Elige un grupo')).toBeInTheDocument();
    expect(volveres()).toHaveLength(0);
    await userEvent.click(migaArea());
    expect(h2('Elige un área')).toBeInTheDocument();
  });
});

describe('la lista de un grupo', () => {
  it('Marketing › Blotato: su nombre, el botón de conectar y sus tres pantallas; la caja y lo de debajo se esconden', async () => {
    montar({ proyectos: [P1] });
    pintar();
    await aLaLista('Marketing', 'Blotato');
    expect(h2('Blotato')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Blotato conectado|Conecta tu cuenta de Blotato/ })).toBeInTheDocument();
    expect(within(lista()).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual([
      '/agenda.html',
      '/competencia.html',
      '/metricas.html',
    ]);
    expect(hayCaja()).toBe(false);
    expect(screen.queryByRole('heading', { name: 'Mis creaciones' })).toBeNull();
    // migas: Marketing › Blotato, con el grupo como el lugar de ahora; y ningún «Volver a …»
    expect(migaGrupo('Marketing', 'Blotato')).toHaveAttribute('aria-current', 'step');
    expect(volveres()).toHaveLength(0);
  });

  it('desde la lista, el mapa no dice «Volver a Blotato» ni marca Marketing; las opciones marcan Blotato como donde estás', async () => {
    pintar();
    await aLaLista('Marketing', 'Blotato');
    await userEvent.click(migaArea());
    expect(screen.queryByText('Estás aquí')).toBeNull();
    expect(volveres()).toHaveLength(0);
    await alasOpciones();
    expect(tarjetaDeGrupo('Marketing', 'Blotato')).toHaveTextContent('Estás aquí');
  });

  it('Central › Distrito: lo que no existe sale «Próximamente» y no es un enlace; COI y la Biblioteca de prompts (encendidas) llevan a su pantalla; Deepseek dice que no está disponible', async () => {
    pintar();
    await aLaLista('Central', 'Distrito');
    const filas = within(lista()).getAllByRole('listitem');
    expect(filas.map(f => f.querySelector('b')?.textContent)).toEqual(['COI', 'Biblioteca de prompts', 'Preguntas sobre la clase', 'Glosario IA']);
    expect(screen.queryAllByRole('link').map(a => a.getAttribute('href'))).toEqual(['/estudio/coi/', '/estudio/biblioteca/']);
    expect(filas.filter(f => /próximamente/i.test(f.textContent ?? ''))).toHaveLength(2);
    await userEvent.click(migaGrupo('Central', 'Distrito'));
    await userEvent.click(tarjetaDeGrupo('Central', 'Deepseek'));
    expect(h2('Deepseek')).toBeInTheDocument();
    expect(screen.getByText('Todavía no está disponible.')).toBeInTheDocument();
  });

  it('sin la clave de Blotato las tres se apagan y el clic abre conectar, sin salir del inicio; conectado no apaga nada', async () => {
    montar({ blotato: SIN_CLAVE });
    pintar();
    await aLaLista('Marketing', 'Blotato');
    await waitFor(() => expect(within(lista()).getAllByRole('link').filter(a => a.getAttribute('aria-disabled') === 'true')).toHaveLength(3));
    await userEvent.click(within(lista()).getAllByRole('link')[0]!);
    expect(await screen.findByRole('dialog', { name: 'Conecta tu Blotato' })).toBeInTheDocument();
    expect(ir).not.toHaveBeenCalled();
  });
});

describe('debajo de la tarjeta', () => {
  it('«Mis creaciones» se ve solo con la caja a la vista: con el mapa o una lista se esconde, y SIGUE montada (no pierde su filtro)', async () => {
    montar({ proyectos: [P1] });
    const { container } = pintar();
    // al abrir se ve el mapa: lo de debajo está montado pero escondido
    await waitFor(() => expect(container.querySelector('#creaciones-titulo')).not.toBeNull());
    expect(screen.queryByRole('heading', { name: 'Mis creaciones' })).toBeNull();
    await alaCaja();
    expect(await screen.findByRole('heading', { name: 'Mis creaciones' })).toBeInTheDocument();
    await alMapa();
    expect(screen.queryByRole('heading', { name: 'Mis creaciones' })).toBeNull();
    expect(container.querySelector('#creaciones-titulo')).not.toBeNull();
    await alaCaja();
    expect(screen.getByRole('heading', { name: 'Mis creaciones' })).toBeInTheDocument();
    // con una lista (no la caja) también se esconde
    await userEvent.click(migaGrupo('Marketing', 'Distrito'));
    await userEvent.click(tarjetaDeGrupo('Marketing', 'Avanzado'));
    expect(screen.queryByRole('heading', { name: 'Mis creaciones' })).toBeNull();
  });

  it('en una cuenta nueva, los «tres caminos» tampoco salen sino con la caja', async () => {
    pintar();
    expect(screen.queryByRole('heading', { name: 'Tu primer video, en tres caminos' })).toBeNull();
    await alasOpciones();
    expect(screen.queryByRole('heading', { name: 'Tu primer video, en tres caminos' })).toBeNull();
    await userEvent.click(tarjetaDeGrupo('Marketing', 'Distrito'));
    expect(await screen.findByRole('heading', { name: 'Tu primer video, en tres caminos' })).toBeInTheDocument();
  });

  it('va del mismo ancho que la región (820 px como mucho, centrada)', async () => {
    montar({ proyectos: [P1] });
    const { container } = pintar();
    await waitFor(() => expect(container.querySelector('#creaciones-titulo')).not.toBeNull());
    expect(region().className).toContain('max-w-[820px]');
    expect(region().className).toContain('mx-auto');
    const envoltura = container.querySelector('#creaciones-titulo')!.closest('[hidden], div.mx-auto')!;
    expect(envoltura.className).toContain('max-w-[820px]');
  });
});

describe('Esc', () => {
  it('en el mapa (lo primero que se ve) no hace nada: no hay a dónde subir', async () => {
    pintar();
    ficha(/^Marketing/).focus();
    await userEvent.keyboard('{Escape}');
    expect(h2('Elige un área')).toBeInTheDocument();
    expect(ir).not.toHaveBeenCalled();
  });

  it('en las opciones sube un nivel: abre el mapa (y de ahí, otra vez Esc no hace nada)', async () => {
    pintar();
    await alasOpciones('Central');
    await userEvent.keyboard('{Escape}');
    expect(h2('Elige un área')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Elige un grupo' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(h2('Elige un área')).toBeInTheDocument();
    expect(hayCaja()).toBe(false);
  });

  it('en las opciones, viniendo de la caja, también sube al MAPA (no «regresa a la caja»: ya no hay a dónde regresar)', async () => {
    await pintarEnLaCaja();
    await userEvent.click(migaGrupo('Marketing', 'Distrito'));
    await userEvent.keyboard('{Escape}');
    expect(h2('Elige un área')).toBeInTheDocument();
    expect(hayCaja()).toBe(false);
  });

  it('solo Esc: cualquier otra tecla (Enter, flechas, letras) en el mapa o en las opciones no cambia de paso', async () => {
    pintar();
    await alasOpciones();
    await userEvent.keyboard('a{ArrowDown}{ArrowLeft}{Backspace}{Shift}{Tab}');
    expect(h2('Elige un grupo')).toBeInTheDocument();
    await userEvent.click(migaArea());
    await userEvent.keyboard('{ArrowUp}{Home}b');
    expect(h2('Elige un área')).toBeInTheDocument();
  });

  it('en la caja no hace nada: ni cambia de paso ni borra lo escrito', async () => {
    await pintarEnLaCaja();
    await userEvent.type(campo(), 'hola');
    await userEvent.keyboard('{Escape}');
    expect(campo()).toHaveValue('hola');
    expect(screen.queryByRole('heading', { name: /^Elige un/ })).toBeNull();
    expect(ir).not.toHaveBeenCalled();
  });

  it('en la lista de un grupo tampoco hace nada', async () => {
    pintar();
    await aLaLista('Marketing', 'Blotato');
    await userEvent.keyboard('{Escape}');
    expect(h2('Blotato')).toBeInTheDocument();
  });

  it('con el foco FUERA de la región no hace nada (el oyente es de la región, no de toda la página)', async () => {
    pintar();
    await alasOpciones();
    (document.activeElement as HTMLElement).blur();
    expect(document.body).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(h2('Elige un grupo')).toBeInTheDocument();
  });

  it('si lo que tenía el foco ya atendió Esc (lo cancela con preventDefault), no se repite como «subir»', async () => {
    pintar();
    await alasOpciones();
    const tarjeta1 = tarjetaDeGrupo('Marketing', 'Distrito');
    tarjeta1.addEventListener('keydown', e => e.key === 'Escape' && e.preventDefault());
    tarjeta1.focus();
    await userEvent.keyboard('{Escape}');
    expect(h2('Elige un grupo')).toBeInTheDocument();
  });
});

describe('el foco no cae a <body>', () => {
  it('al abrir el inicio (el mapa, sin nada elegido) no roba el foco de la página', () => {
    pintar();
    expect(h2('Elige un área')).toBeInTheDocument();
    expect(document.body).toHaveFocus();
  });

  it('llegar por ?desde=…&ver=… SÍ lleva el foco al título del paso abierto: «Elige un área» o «Elige un grupo»', () => {
    history.replaceState(null, '', '/estudio/inicio/?desde=mkt.blotato.agenda&ver=mapa');
    const { unmount } = pintar();
    expect(h2('Elige un área')).toHaveFocus();
    unmount();
    history.replaceState(null, '', '/estudio/inicio/?desde=mkt.blotato.agenda&ver=grupos');
    pintar();
    expect(h2('Elige un grupo')).toHaveFocus();
    // enfocable solo por código: no entra en el orden de Tab
    expect(h2('Elige un grupo')).toHaveAttribute('tabindex', '-1');
  });

  it('bajo StrictMode (el efecto corre dos veces) el foco de llegada queda en el título del paso, una sola vez', () => {
    history.replaceState(null, '', '/estudio/inicio/?desde=mkt.blotato.agenda&ver=mapa');
    render(
      <StrictMode>
        <Inicio ir={ir} />
      </StrictMode>,
    );
    expect(h2('Elige un área')).toHaveFocus();
  });

  it('una región que se monta en la lista de un grupo (sin haber llegado por un enlace) tampoco roba el foco: es solo de la llegada', () => {
    // la lista tiene su título enfocable igual que el mapa: lo que decide es cómo se llegó, no que haya título
    render(
      <Recorrido
        estado={{ ...REPOSO, paso: 'contenido', grupo: 'blotato', elegido: true }}
        despachar={vi.fn()}
        conectado
        alConectar={vi.fn()}
        ir={ir}
        tituloCaja={createRef()}
      >
        <p>caja</p>
      </Recorrido>,
    );
    expect(h2('Blotato')).toBeInTheDocument();
    expect(document.body).toHaveFocus();
  });

  it('…pero no se lo roba a quien ya lo tenía (un campo con autofoco, un diálogo): solo llena un foco vacío', () => {
    const otro = document.createElement('button');
    document.body.append(otro);
    onTestFinished(() => otro.remove());
    otro.focus();
    history.replaceState(null, '', '/estudio/inicio/?desde=mkt.blotato.agenda&ver=mapa');
    pintar();
    expect(otro).toHaveFocus();
    expect(h2('Elige un área')).not.toHaveFocus();
  });

  it('cada paso lleva el foco a su h2: las opciones, la lista, «Elige un grupo» al reabrirlas, y el mapa', async () => {
    pintar();
    await userEvent.click(ficha(/^Marketing/));
    expect(h2('Elige un grupo')).toHaveFocus();
    await userEvent.click(tarjetaDeGrupo('Marketing', 'Blotato'));
    expect(h2('Blotato')).toHaveFocus();
    await userEvent.click(migaGrupo('Marketing', 'Blotato'));
    expect(h2('Elige un grupo')).toHaveFocus();
    await userEvent.click(migaArea());
    expect(h2('Elige un área')).toHaveFocus();
  });

  it('elegir Distrito lleva el foco al título de la caja, que sigue siendo enfocable solo por código (sin entrar en Tab)', async () => {
    pintar();
    await alaCaja();
    expect(h2('¿Qué vamos a crear hoy?')).toHaveFocus();
    // un título que se enfoca con código no entra en el orden de Tab (tabindex -1)
    expect(h2('¿Qué vamos a crear hoy?')).toHaveAttribute('tabindex', '-1');
  });

  it('un foco que sigue dentro de la región (la miga del área, que no se desmonta al pasar de la caja a las opciones) NO se mueve al título', async () => {
    await pintarEnLaCaja();
    migaArea().focus();
    // `.click()` no mueve el foco: la miga del grupo desaparece, la del área sigue ahí y con el foco
    act(() => migaGrupo('Marketing', 'Distrito').click());
    expect(h2('Elige un grupo')).toBeInTheDocument();
    expect(migaArea()).toHaveFocus();
    expect(h2('Elige un grupo')).not.toHaveFocus();
  });

  it('un foco DENTRO de la caja que se esconde cuenta como perdido: una activación que no mueve el foco (.click(), la acción «hacer clic» de un lector) lo lleva al título del paso, no a <body>', async () => {
    await pintarEnLaCaja();
    // el foco está en el cuadro de texto de la caja; abrir el mapa con `.click()` no se lo quita a nadie (un clic de ratón sí enfoca la miga)
    campo().focus();
    act(() => migaArea().click());
    expect(h2('Elige un área')).toBeInTheDocument();
    expect(hayCaja()).toBe(false);
    expect(h2('Elige un área')).toHaveFocus();
    // otra vez a la caja, y con el foco en el chip «Un video corto ▾» (otro control de la caja), igual
    await alaCaja();
    expect(h2('¿Qué vamos a crear hoy?')).toHaveFocus();
    document.querySelector<HTMLElement>('button[aria-haspopup="listbox"]')!.focus();
    act(() => migaGrupo('Marketing', 'Distrito').click());
    expect(h2('Elige un grupo')).toHaveFocus();
    // Esc sigue llegando a la región desde ahí: sube un nivel, al mapa
    await userEvent.keyboard('{Escape}');
    expect(h2('Elige un área')).toHaveFocus();
  });

  it('con teclado: Enter en una ficha y Enter en una tarjeta de grupo llevan el foco al título del paso nuevo, no a <body>', async () => {
    pintar();
    ficha(/^Marketing/).focus();
    await userEvent.keyboard('{Enter}');
    expect(h2('Elige un grupo')).toHaveFocus();
    tarjetaDeGrupo('Marketing', 'Avanzado').focus();
    await userEvent.keyboard('{Enter}');
    expect(h2('Avanzado')).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  it('Esc sube y deja el foco en el título del paso: no hace falta volver a hacer clic para que Esc siga valiendo', async () => {
    pintar();
    await alasOpciones();
    await userEvent.keyboard('{Escape}');
    expect(h2('Elige un área')).toHaveFocus();
    // sin hacer clic en nada: Esc en el mapa no hace nada, pero otra ronda sigue funcionando
    await userEvent.keyboard('{Escape}');
    expect(h2('Elige un área')).toHaveFocus();
    await userEvent.click(ficha(/^Marketing/));
    await userEvent.keyboard('{Escape}');
    expect(h2('Elige un área')).toHaveFocus();
  });

  it('el orden de Tab es el de lectura: en el mapa, solo las cinco fichas (ni migas ni «Volver a …»)', async () => {
    pintar();
    // todo lo que se enfoca con Tab dentro de la región, en el orden del DOM (que es el que sigue Tab)
    const enOrden = () =>
      Array.from(region().querySelectorAll<HTMLElement>('button, a[href], input, textarea, [tabindex="0"]'))
        .filter(el => !el.closest('[hidden]'))
        .map(el => el.querySelector('b')?.textContent ?? el.querySelector('span')?.textContent ?? el.textContent);
    expect(enOrden()).toEqual(['Marketing', 'Producto', 'Central', 'Ventas', 'Automatizaciones']);
    // en las opciones: primero la miga, luego las tres tarjetas
    await alasOpciones();
    expect(enOrden()).toEqual(['Marketing', 'Distrito', 'Blotato', 'Avanzado']);
  });
});

// A11Y-11 del prototipo, con la región entera: la caja se queda montada y escondida (`hidden`) mientras se ve el mapa, las opciones o una
// lista, así que la pista rotatoria del campo de Edición no puede seguir rotando sin que se vea ni volver donde iba. El reloj es de verdad
// pero falso (vi.useFakeTimers): cada prueba mueve el tiempo y cuenta los temporizadores vivos. Los nombres no llevan el prefijo `inicio.`
// (el de los invariantes del registro anti-pérdida): es una función nueva.
describe('la pista de Edición con la caja escondida por el recorrido', () => {
  const ANTES_DE_SALIR = PISTA_CADA_MS - PISTA_FUNDIDO_MS;
  // el campo de Edición, escondido o no (escondido no sale por rol)
  const area = () => document.getElementById('texto-edicion') as HTMLTextAreaElement;
  const pista = () => area().getAttribute('placeholder');
  // la caja entera está escondida con `hidden` (por rol no se ve, pero el campo sigue en el árbol)
  const escondida = () => area().closest('[hidden]') !== null;
  const saliendo = () => area().className.split(/\s+/).includes('placeholder:opacity-0');
  /** Un tramo del reloj falso. El temporizador de cada paso lo arma un efecto, que corre al salir del act: de a `paso` por act. */
  const avanzar = (ms: number, paso = ms) => {
    for (let t = 0; t < ms; t += paso) {
      act(() => {
        vi.advanceTimersByTime(Math.min(paso, ms - t));
      });
    }
  };
  /** De la caja al mapa y de vuelta a ella, sin esperar nada (con el reloj falso `userEvent` se cuelga). */
  const irALaCaja = () => {
    fireEvent.click(ficha(/^Marketing/));
    fireEvent.click(tarjetaDeGrupo('Marketing', 'Distrito'));
  };

  /** Una idea de la rotación: sale (a los 3.75 s) y entra la siguiente (a los 4). */
  const unaIdea = () => {
    avanzar(ANTES_DE_SALIR);
    avanzar(PISTA_FUNDIDO_MS);
  };

  /** El inicio con el reloj falso, ya en la caja y en la pestaña Edición. */
  async function enEdicion() {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    pintar();
    await act(async () => {}); // llegan las listas del servidor simulado
    irALaCaja();
    fireEvent.click(riel().getByRole('button', { name: 'Edición' }));
    avanzar(1); // los temporizadores de 0 ms del propio React al pintar el cambio no son de la pista
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('con el mapa abierto no corre ningún temporizador de la pista, y volver a la caja la deja en la primera idea, sin fundido', async () => {
    await enEdicion();
    const rodando = vi.getTimerCount();
    unaIdea();
    unaIdea();
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[2]));
    fireEvent.click(migaArea());
    avanzar(1);
    expect(escondida()).toBe(true);
    // la caja sigue montada pero escondida: el campo está en el árbol y la pista no corre (es el temporizador de menos)
    expect(area()).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(rodando - 1);
    avanzar(PISTA_CADA_MS * 40, 100);
    expect(vi.getTimerCount()).toBe(rodando - 1);
    // Marketing › Distrito: la caja se ve de nuevo, en la primera idea y sin salir (sin fundido), y de ahí rota
    irALaCaja();
    avanzar(1);
    expect(escondida()).toBe(false);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
    expect(saliendo()).toBe(false);
    expect(vi.getTimerCount()).toBe(rodando);
    // (ya pasó 1 ms desde que volvió: el primer intervalo se cumple a los 3.75 s justos)
    avanzar(ANTES_DE_SALIR - 2);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
    expect(saliendo()).toBe(false);
    avanzar(1);
    expect(saliendo()).toBe(true);
    avanzar(PISTA_FUNDIDO_MS);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
  });

  it('con la lista de otro grupo a la vista tampoco corre, y volver a Distrito por el mapa la deja en la primera idea; lo escrito se queda', async () => {
    await enEdicion();
    const rodando = vi.getTimerCount();
    unaIdea();
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[1]));
    fireEvent.click(migaArea());
    fireEvent.click(ficha(/^Marketing/));
    fireEvent.click(tarjetaDeGrupo('Marketing', 'Blotato'));
    avanzar(1);
    expect(h2('Blotato')).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(rodando - 1);
    avanzar(PISTA_CADA_MS * 40, 100);
    expect(vi.getTimerCount()).toBe(rodando - 1);
    fireEvent.click(migaGrupo('Marketing', 'Blotato'));
    fireEvent.click(tarjetaDeGrupo('Marketing', 'Distrito'));
    avanzar(1);
    expect(escondida()).toBe(false);
    expect(pista()).toBe(huecoDe(IDEAS_EDICION[0]));
    expect(saliendo()).toBe(false);
    expect(vi.getTimerCount()).toBe(rodando);
    // escribir en el campo, esconder la caja y volver: el texto no se pierde (por eso la caja no se desmonta)
    fireEvent.change(area(), { target: { value: 'Quita los silencios' } });
    fireEvent.click(migaArea());
    irALaCaja();
    avanzar(1);
    expect(area()).toHaveValue('Quita los silencios');
  });
});

describe('el doble clic en una ficha del mapa', () => {
  it('el segundo clic de un doble clic no elige un grupo por accidente: se queda en «Elige un grupo»', () => {
    pintar();
    fireEvent.click(ficha(/^Marketing/), { detail: 1 });
    expect(h2('Elige un grupo')).toBeInTheDocument();
    // el segundo clic cae donde apareció la primera tarjeta (Distrito)
    fireEvent.click(tarjetaDeGrupo('Marketing', 'Distrito'), { detail: 2 });
    expect(h2('Elige un grupo')).toBeInTheDocument();
    expect(hayCaja()).toBe(false);
  });

  it('una elección deliberada pasa: un clic normal enseguida, el teclado, o un doble clic pasado el medio segundo', async () => {
    pintar();
    fireEvent.click(ficha(/^Marketing/), { detail: 1 });
    fireEvent.click(tarjetaDeGrupo('Marketing', 'Blotato'), { detail: 1 });
    expect(h2('Blotato')).toBeInTheDocument();
    // un doble clic, pero medio segundo después de abrirlas
    await userEvent.click(migaArea());
    await userEvent.click(ficha(/^Marketing/));
    const ahora = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(ahora + 600);
    fireEvent.click(tarjetaDeGrupo('Marketing', 'Avanzado'), { detail: 2 });
    expect(h2('Avanzado')).toBeInTheDocument();
  });
});

// Un nivel más abajo pasa lo mismo: el segundo clic de un doble clic en la tarjeta de «Blotato» cae sobre lo que aparece donde estaba
// (el botón de conectar o la primera pantalla de la lista, que es un enlace) y navegaba fuera del inicio, o abría el diálogo sin que
// nadie lo pidiera. La guardia es de la región entera: cualquier segundo clic (`detail > 1`) a menos de medio segundo de CAMBIAR de
// paso se ignora. El reloj se congela: con el de verdad la prueba dependería de lo rápido que corra la máquina.
describe('el doble clic en la tarjeta de un grupo', () => {
  const T0 = 1_000_000;
  /** Los clics que LLEGAN hasta el documento, y si alguien ya los había cancelado; luego los cancela para que jsdom no intente navegar. */
  function clicsQueLlegan() {
    const llegaron: boolean[] = [];
    const oir = (e: Event) => {
      llegaron.push(e.defaultPrevented);
      e.preventDefault();
    };
    document.addEventListener('click', oir);
    onTestFinished(() => document.removeEventListener('click', oir));
    return llegaron;
  }

  it('sin la clave de Blotato, el segundo clic no abre el diálogo de conectar: ni el botón ni la primera pantalla de la lista lo reciben', async () => {
    montar({ blotato: SIN_CLAVE });
    pintar();
    const reloj = vi.spyOn(Date, 'now').mockReturnValue(T0);
    await alasOpciones();
    fireEvent.click(tarjetaDeGrupo('Marketing', 'Blotato'), { detail: 1 });
    expect(h2('Blotato')).toBeInTheDocument();
    const conectar = await screen.findByRole('button', { name: 'Conecta tu cuenta de Blotato' });
    const primera = within(lista()).getAllByRole('link')[0]!;
    // el segundo clic (detail 2) de un doble clic sobre la tarjeta: cae en uno de los dos
    fireEvent.click(conectar, { detail: 2 });
    fireEvent.click(primera, { detail: 2 });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(ir).not.toHaveBeenCalled();
    // una pulsación deliberada pasa: la misma, pasado el medio segundo
    reloj.mockReturnValue(T0 + 600);
    fireEvent.click(conectar, { detail: 2 });
    expect(await screen.findByRole('dialog', { name: 'Conecta tu Blotato' })).toBeInTheDocument();
  });

  it('con Blotato conectado, el segundo clic no activa la primera pantalla de la lista: no navega; un clic normal sí', async () => {
    pintar();
    const reloj = vi.spyOn(Date, 'now').mockReturnValue(T0);
    await alasOpciones();
    fireEvent.click(tarjetaDeGrupo('Marketing', 'Blotato'), { detail: 1 });
    await screen.findByRole('button', { name: 'Blotato conectado: ver o cambiar' });
    const primera = within(lista()).getAllByRole('link')[0]!;
    // el segundo clic se cancela en la región (preventDefault: el enlace no navega). `fireEvent` devuelve false si alguien lo canceló
    expect(fireEvent.click(primera, { detail: 2 })).toBe(false);
    // un clic normal (detail 1) enseguida, o uno con el teclado (detail 0), siguen su camino: nadie los cancela antes de que el
    // navegador decida navegar (este oyente los cancela después, solo para que jsdom no lo intente)
    const llegaron = clicsQueLlegan();
    fireEvent.click(primera, { detail: 1 });
    fireEvent.click(primera, { detail: 0 });
    expect(llegaron).toEqual([false, false]);
    // y un doble clic pasado el medio segundo también
    reloj.mockReturnValue(T0 + 600);
    fireEvent.click(primera, { detail: 2 });
    expect(llegaron).toEqual([false, false, false]);
  });

  it('el mismo cuidado al llegar a la caja: el segundo clic de un doble clic en «Distrito» no pulsa lo que quedó debajo', async () => {
    await pintarEnLaCaja();
    await userEvent.click(screen.getByRole('button', { name: 'Imagen' }));
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    await alMapa();
    await alasOpciones();
    fireEvent.click(tarjetaDeGrupo('Marketing', 'Distrito'), { detail: 1 });
    expect(hayCaja()).toBe(true);
    // el segundo clic cae en el riel de la caja (Video): Imagen se queda
    fireEvent.click(riel().getByRole('button', { name: 'Video' }), { detail: 2 });
    expect(riel().getByRole('button', { name: 'Imagen' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('la entrada por ?desde=…&ver=…', () => {
  const con = (busqueda: string) => history.replaceState(null, '', `/estudio/inicio/${busqueda}`);

  it('desde una pantalla hoja con ver=mapa: abre el mapa, sin nada marcado, y «Volver a …» es un ENLACE a esa página, centrado bajo el título', async () => {
    con('?desde=mkt.blotato.agenda&ver=mapa');
    pintar();
    expect(h2('Elige un área')).toBeInTheDocument();
    expect(screen.queryByText('Estás aquí')).toBeNull();
    const volver = screen.getByRole('link', { name: 'Volver a Agenda tus publicaciones' });
    expect(volver).toHaveAttribute('href', '/agenda.html');
    expect(volver.parentElement).toHaveClass('justify-center');
    expect(screen.queryByRole('button', { name: /^Volver a / })).toBeNull();
    // la caja no se ve, pero está montada: elegir Distrito la enseña
    expect(hayCaja()).toBe(false);
    await userEvent.click(ficha(/^Marketing/));
    await userEvent.click(tarjetaDeGrupo('Marketing', 'Distrito'));
    expect(campo()).toBeInTheDocument();
  });

  it('con la página de por medio, el orden de Tab es «Volver a …» y luego las fichas', () => {
    con('?desde=mkt.blotato.agenda&ver=mapa');
    pintar();
    const enOrden = Array.from(region().querySelectorAll<HTMLElement>('button, a[href], input, textarea, [tabindex="0"]'))
      .filter(el => !el.closest('[hidden]'))
      .map(el => el.querySelector('span')?.textContent ?? el.textContent);
    expect(enOrden).toEqual(['Volver a Agenda tus publicaciones', 'Marketing', 'Producto', 'Central', 'Ventas', 'Automatizaciones']);
  });

  it('la URL queda limpia (/estudio/inicio/): se lee una vez y recargar no repite el recorrido', () => {
    con('?desde=mkt.blotato.agenda&ver=mapa');
    pintar();
    expect(location.pathname + location.search).toBe('/estudio/inicio/');
  });

  it('desde otra pantalla con ver=grupos: abre las tres opciones de su área, con «Estás aquí» en su grupo (venías de él)', () => {
    con('?desde=mkt.avanzado.automaticas&ver=grupos');
    pintar();
    expect(h2('Elige un grupo')).toBeInTheDocument();
    expect(tarjetaDeGrupo('Marketing', 'Avanzado')).toHaveTextContent('Estás aquí');
    expect(tarjetaDeGrupo('Marketing', 'Distrito')).not.toHaveTextContent('Estás aquí');
    expect(screen.getByRole('link', { name: 'Volver a Publicaciones automáticas' })).toHaveAttribute('href', '/mix.html');
  });

  it('Esc con una página aparte de por medio NAVEGA a ella (y no cambia de paso)', async () => {
    con('?desde=mkt.blotato.metricas&ver=mapa');
    pintar();
    // sin tabular ni hacer clic antes: el foco ya está en el título del paso, dentro de la región
    await userEvent.keyboard('{Escape}');
    expect(ir).toHaveBeenCalledExactlyOnceWith('/metricas.html');
    expect(h2('Elige un área')).toBeInTheDocument();
  });

  it('Esc nada más llegar a las tres opciones también vuelve a la página de origen (y no sube al mapa)', async () => {
    con('?desde=mkt.avanzado.automaticas&ver=grupos');
    pintar();
    await userEvent.keyboard('{Escape}');
    expect(ir).toHaveBeenCalledExactlyOnceWith('/mix.html');
    expect(h2('Elige un grupo')).toBeInTheDocument();
  });

  it('elegir un grupo olvida la página de la que venías: a partir de ahí no queda ningún «Volver a …», ni enlace ni botón', async () => {
    con('?desde=mkt.blotato.agenda&ver=mapa');
    pintar();
    await userEvent.click(ficha(/^Marketing/));
    await userEvent.click(tarjetaDeGrupo('Marketing', 'Blotato'));
    await userEvent.click(migaArea());
    expect(volveres()).toHaveLength(0);
    // y Esc en las opciones sube al mapa, como en cualquier otra entrada
    await userEvent.click(ficha(/^Marketing/));
    await userEvent.keyboard('{Escape}');
    expect(ir).not.toHaveBeenCalled();
    expect(h2('Elige un área')).toBeInTheDocument();
  });

  it('una pantalla o una vista que no existe se ignora: se aterriza en el mapa, y la URL igual se limpia', () => {
    for (const q of ['?desde=mkt.blotato.nada&ver=mapa', '?desde=mkt.blotato.agenda&ver=otra', '?desde=basura&ver=mapa', '?ver=mapa']) {
      con(q);
      const { unmount } = pintar();
      expect(h2('Elige un área'), q).toBeInTheDocument();
      expect(hayCaja(), q).toBe(false);
      expect(volveres(), q).toHaveLength(0);
      expect(location.search, q).toBe('');
      // aterrizar en el mapa sin nada elegido no toca el foco de la página, aunque la URL traiga una entrada que no sirve
      expect(document.body, q).toHaveFocus();
      unmount();
    }
  });

  it('sin entrada no reescribe la URL: un ?blotato=conectar (el editor manda ahí) no se pierde', async () => {
    con('?blotato=conectar');
    const reemplazar = vi.spyOn(history, 'replaceState');
    montar({ blotato: SIN_CLAVE });
    pintar();
    expect(await screen.findByRole('dialog', { name: 'Conecta tu Blotato' })).toBeInTheDocument();
    expect(reemplazar).not.toHaveBeenCalled();
    expect(location.search).toBe('?blotato=conectar');
  });

  it('con entrada quita solo lo suyo: lo demás de la URL se queda, y el diálogo de ?blotato=conectar abre igual', async () => {
    con('?blotato=conectar&desde=mkt.blotato.agenda&ver=mapa');
    montar({ blotato: SIN_CLAVE });
    pintar();
    expect(location.search).toBe('?blotato=conectar');
    expect(await screen.findByRole('dialog', { name: 'Conecta tu Blotato' })).toBeInTheDocument();
    // con el diálogo abierto el resto de la página queda detrás (aria-hidden): el mapa de la entrada sigue ahí
    expect(screen.getByRole('heading', { level: 2, name: 'Elige un área', hidden: true })).toBeInTheDocument();
  });
});

describe('Blotato conectado o no, desde el recorrido', () => {
  it('si no se sabe (la consulta falla), la lista no apaga nada', async () => {
    montar({ blotato: null });
    pintar();
    await aLaLista('Marketing', 'Blotato');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Conecta tu cuenta de Blotato' })).toBeInTheDocument());
    for (const a of within(lista()).getAllByRole('link')) expect(a).not.toHaveAttribute('aria-disabled');
  });
});
