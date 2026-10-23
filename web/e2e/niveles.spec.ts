// El recorrido por páginas en un navegador de verdad (dueño, 21-oct-2026: «por cada pestaña, una ruta»). Cada nivel es su propia página, con
// su dirección y su `<title>`: el mapa (/estudio/), las opciones de un área (/estudio/marketing/), la lista de un grupo
// (/estudio/marketing/distrito/) y la caja, en la pestaña que dice la dirección (…/distrito/video/). Es la versión de Playwright de lo que
// se comprobó a mano contra la app real al diseñarlo. Lo que jsdom y vitest no ven y aquí sí:
//  · el recorrido entero con sus direcciones, sus títulos, sus enlaces (las fichas y las tarjetas SON enlaces; las apagadas, no) y sus migas;
//  · «Atrás» sube un nivel, y Esc en las opciones de un área sube al mapa (y en ningún otro lado);
//  · la caja en sus tres direcciones: cada una abre su pestaña, y cambiar de pestaña mueve la dirección y el título sin agregar historia;
//  · las entradas de antes (/estudio/inicio/, ?prompt=, ?brief=, ?blotato=conectar) llegan a su página, y las direcciones tecleadas a mano
//    (sin barra, en mayúsculas) también;
//  · lo que pesa: las páginas de navegación NO traen la caja ni piden las listas que esta usa, y Blotato solo se pide en sus dos grupos;
//  · el doble clic lento a 390 px (el segundo clic cae sobre la tarjeta de la página siguiente) no salta dos niveles;
//  · a 320 y 390 px ningún nivel se arrastra de lado, y con «reducir movimiento» nada se mueve en una página de cada plantilla.
// No gasta nada: la API es de mentira (e2e/recorrido.ts) y el servidor es e2e/servidor.mjs, que repite el de verdad (server/web.py).
import { expect, test, type Locator, type Page, type Request } from '@playwright/test';

import { animacionesVivas } from './pantallas';
import {
  abrirInicio,
  abrirLaCaja,
  algunVolver,
  direccionDe,
  elegir,
  elegirHerramienta,
  esperarRuta,
  ficha,
  fichaApagada,
  herramienta,
  irAlMapa,
  migas,
  opcion,
  paso,
  region,
  relojFijo,
  riel,
  rutaDe,
  simular,
  sinNavegar,
  sobraAlLado,
  TITULO_MAPA,
  URL_BLOTATO,
  URL_CAJA,
  URL_DISTRITO,
  URL_MAPA,
  URL_MARKETING,
  vigilarNavegaciones,
  type EstadoDeBlotato,
  type Herramienta,
} from './recorrido';

const CAJA = '¿Qué vamos a crear hoy?';

/** Lo que una página pidió desde que se empezó a mirar: las llamadas a la API y los archivos de la app (/estudio/assets/*). */
function observar(page: Page) {
  const visto = { api: [] as string[], archivos: [] as string[], errores: [] as string[] };
  page.on('request', r => {
    const { pathname } = new URL(r.url());
    if (pathname.startsWith('/api/')) visto.api.push(pathname);
    else if (pathname.startsWith('/estudio/assets/')) visto.archivos.push(pathname.slice('/estudio/assets/'.length));
  });
  page.on('pageerror', e => visto.errores.push(String(e)));
  return visto;
}

/** Las listas de datos que SOLO usa la caja (Mis creaciones, Mis imágenes, los clips…): una página de navegación no las pide. */
const LISTAS_DE_LA_CAJA = ['/api/proyectos', '/api/slots', '/api/imagenes', '/api/edicion/proyectos', '/api/clip'];

const hrefDe = (loc: Locator) => loc.getAttribute('href');

// ---------------------------------------------------------------------------
// el recorrido, página por página

test.describe('el recorrido, página por página', () => {
  test('del mapa a la caja, un clic por página: cada una con su dirección, su título, sus enlaces y sus migas', async ({ page }) => {
    await simular(page);
    const visto = observar(page);

    // el mapa: la principal. Las que se abren son enlaces a la página del área; Producto y Ventas, botones quietos
    await abrirInicio(page);
    expect(rutaDe(page)).toBe(URL_MAPA);
    await expect(page).toHaveTitle(TITULO_MAPA);
    await expect(paso(page)).toHaveText('Elige un área');
    await expect(migas(page)).toHaveCount(0);
    expect(await hrefDe(ficha(page, 'Marketing'))).toBe('/estudio/marketing/');
    expect(await hrefDe(ficha(page, 'Central'))).toBe('/estudio/central/');
    expect(await hrefDe(ficha(page, 'Automatizaciones'))).toBe('/estudio/automatizaciones/');
    for (const area of ['Producto', 'Ventas']) {
      await expect(fichaApagada(page, area)).toHaveAttribute('aria-disabled', 'true');
      await expect(fichaApagada(page, area)).toContainText('Próximamente');
      await expect(ficha(page, area)).toHaveCount(0);
    }
    // ninguna ficha se ve elegida, y no hay «Volver a …»
    await expect(region(page).locator('[aria-current]')).toHaveCount(0);
    await expect(algunVolver(page)).toHaveCount(0);

    // Marketing: las tres opciones del área, enlaces a la página de cada grupo
    await ficha(page, 'Marketing').click();
    await esperarRuta(page, URL_MARKETING);
    await expect(page).toHaveTitle('Estudio de video · Marketing');
    await expect(paso(page)).toHaveText('Elige un grupo');
    expect(await hrefDe(opcion(page, 'Marketing', 'Distrito'))).toBe(URL_DISTRITO);
    expect(await hrefDe(opcion(page, 'Marketing', 'Blotato'))).toBe(URL_BLOTATO);
    expect(await hrefDe(opcion(page, 'Marketing', 'Avanzado'))).toBe('/estudio/marketing/avanzado/');
    // la miga del área es un enlace al mapa y dice dónde estás
    const migaArea = migas(page).getByRole('link', { name: /^Volver al mapa/ });
    await expect(migaArea).toHaveAttribute('href', URL_MAPA);
    await expect(migaArea).toHaveAttribute('aria-current', 'step');
    await expect(migas(page).getByRole('listitem')).toHaveCount(1);

    // Distrito: la lista Imagen · Video · Edición, tres enlaces (y NO la caja)
    await opcion(page, 'Marketing', 'Distrito').click();
    await esperarRuta(page, URL_DISTRITO);
    await expect(page).toHaveTitle('Estudio de video · Marketing · Distrito');
    await expect(paso(page)).toHaveText('Distrito');
    await expect(herramienta(page, 'Imagen')).toHaveAttribute('href', URL_CAJA.imagen);
    await expect(herramienta(page, 'Video')).toHaveAttribute('href', URL_CAJA.video);
    await expect(herramienta(page, 'Edición')).toHaveAttribute('href', URL_CAJA.edicion);
    await expect(region(page).getByRole('textbox')).toHaveCount(0);
    // las migas: Marketing sube al mapa y Distrito (donde estás) a las opciones del área
    await expect(migas(page).getByRole('link', { name: /^Volver al mapa/ })).toHaveAttribute('href', URL_MAPA);
    const migaGrupo = migas(page).getByRole('link', { name: /^Volver a las opciones de Marketing/ });
    await expect(migaGrupo).toHaveAttribute('href', URL_MARKETING);
    await expect(migaGrupo).toHaveAttribute('aria-current', 'step');

    // Video: la caja, en su pestaña
    await herramienta(page, 'Video').click();
    await esperarRuta(page, URL_CAJA.video);
    await expect(page).toHaveTitle('Estudio de video · Marketing · Distrito · Video');
    await expect(paso(page)).toHaveText(CAJA);
    await expect(riel(page, 'Video')).toHaveAttribute('aria-pressed', 'true');
    await expect(riel(page, 'Imagen')).toHaveAttribute('aria-pressed', 'false');

    // la miga del grupo, desde la caja, sube a las opciones del área (como siempre)
    await migas(page).getByRole('link', { name: /^Volver a las opciones de Marketing/ }).click();
    await esperarRuta(page, URL_MARKETING);
    await expect(paso(page)).toHaveText('Elige un grupo');
    // y la del área, al mapa
    await irAlMapa(page);
    expect(rutaDe(page)).toBe(URL_MAPA);

    expect(visto.errores).toEqual([]);
  });

  test('cada área y cada grupo tiene su página y su título, también por el camino de los ayudantes (elegir y elegirHerramienta)', async ({ page }) => {
    await simular(page);
    await abrirInicio(page);
    await elegir(page, 'Central', 'Distrito');
    expect(rutaDe(page)).toBe('/estudio/central/distrito/');
    await expect(page).toHaveTitle('Estudio de video · Central · Distrito');
    await expect(paso(page)).toHaveText('Distrito');
    // COI y la Biblioteca son enlaces a su pantalla; Preguntas y Glosario, tarjetas quietas «Próximamente»
    await expect(region(page).getByRole('link', { name: /^COI/ })).toHaveAttribute('href', '/estudio/coi/');
    await expect(region(page).getByRole('link', { name: /^Biblioteca de prompts/ })).toHaveAttribute('href', '/estudio/biblioteca/');
    for (const nombre of ['Preguntas sobre la clase', 'Glosario IA']) {
      await expect(region(page).getByRole('link', { name: new RegExp(`^${nombre}`) })).toHaveCount(0);
      await expect(region(page).getByText(nombre)).toBeVisible();
    }
    await expect(region(page).getByText('Próximamente')).toHaveCount(2);

    await irAlMapa(page);
    await elegir(page, 'Marketing', 'Distrito');
    await elegirHerramienta(page, 'Edición');
    expect(rutaDe(page)).toBe(URL_CAJA.edicion);
    await expect(page).toHaveTitle('Estudio de video · Marketing · Distrito · Edición');
    await expect(riel(page, 'Edición')).toHaveAttribute('aria-pressed', 'true');
  });

  test('«Atrás» sube un nivel: cada página es una entrada del historial', async ({ page }) => {
    await simular(page);
    await abrirInicio(page);
    await elegir(page, 'Marketing', 'Distrito');
    await elegirHerramienta(page, 'Video');
    expect(rutaDe(page)).toBe(URL_CAJA.video);

    await page.goBack();
    await esperarRuta(page, URL_DISTRITO);
    await expect(paso(page)).toHaveText('Distrito');
    await expect(page).toHaveTitle('Estudio de video · Marketing · Distrito');
    await page.goBack();
    await esperarRuta(page, URL_MARKETING);
    await expect(paso(page)).toHaveText('Elige un grupo');
    await page.goBack();
    await esperarRuta(page, URL_MAPA);
    await expect(paso(page)).toHaveText('Elige un área');
    await expect(page).toHaveTitle(TITULO_MAPA);

    // y «adelante» baja otra vez
    await page.goForward();
    await esperarRuta(page, URL_MARKETING);
    await expect(paso(page)).toHaveText('Elige un grupo');
  });

  test('Esc en las opciones de un área sube al mapa; en el mapa, en un grupo y en la caja no hace nada', async ({ page }) => {
    await simular(page);
    await abrirInicio(page, URL_MARKETING);
    await expect(paso(page)).toHaveText('Elige un grupo');
    // recién cargada, el foco está en <body> (no dentro de la sección): Esc vale igual
    expect((await page.evaluate(() => document.activeElement?.tagName))?.toLowerCase()).toBe('body');
    await page.keyboard.press('Escape');
    await esperarRuta(page, URL_MAPA);
    await expect(paso(page)).toHaveText('Elige un área');
    // «atrás» vuelve a las opciones: Esc fue una navegación como cualquier otra
    await page.goBack();
    await esperarRuta(page, URL_MARKETING);

    // en el mapa, un grupo y la caja, Esc se queda donde está
    for (const url of [URL_MAPA, URL_DISTRITO, URL_BLOTATO, URL_CAJA.video]) {
      await abrirInicio(page, url);
      await expect(paso(page)).toBeVisible();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      expect(rutaDe(page), `Esc en ${url}`).toBe(url);
    }
  });

  test('lo que todavía no existe tiene su página y lo dice: «Todavía no está disponible.», con su título', async ({ page }) => {
    await simular(page);
    const casos = [
      ['/estudio/ventas/', 'Estudio de video · Ventas', 'Ventas'],
      ['/estudio/producto/', 'Estudio de video · Producto', 'Producto'],
      ['/estudio/central/deepseek/', 'Estudio de video · Central · Deepseek', 'Deepseek'],
      ['/estudio/automatizaciones/tus/', 'Estudio de video · Automatizaciones · Tus automatizaciones', 'Tus automatizaciones'],
    ] as const;
    for (const [url, titulo, h2] of casos) {
      await abrirInicio(page, url);
      expect(rutaDe(page)).toBe(url);
      await expect(page).toHaveTitle(titulo);
      await expect(paso(page)).toHaveText(h2);
      await expect(region(page).getByText('Todavía no está disponible.')).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// la caja en sus tres direcciones

test.describe('la caja en sus tres direcciones', () => {
  const PESTANAS: readonly [Herramienta, string][] = [
    ['imagen', 'Imagen'],
    ['video', 'Video'],
    ['edicion', 'Edición'],
  ];

  for (const [clave, nombre] of PESTANAS) {
    test(`${URL_CAJA[clave]} abre la caja en ${nombre}, con su título`, async ({ page }) => {
      await simular(page);
      await abrirLaCaja(page, URL_CAJA[clave]);
      expect(rutaDe(page)).toBe(URL_CAJA[clave]);
      await expect(page).toHaveTitle(`Estudio de video · Marketing · Distrito · ${nombre}`);
      for (const [otra, otraNombre] of PESTANAS) {
        await expect(riel(page, otraNombre)).toHaveAttribute('aria-pressed', String(otra === clave));
      }
    });
  }

  test('cambiar de pestaña mueve la dirección y el título, sin agregar historia ni recargar', async ({ page }) => {
    await simular(page);
    await abrirLaCaja(page, URL_CAJA.video);
    const historia = await page.evaluate(() => history.length);
    // una marca en el documento: si la página se recargara o cambiara, se perdería
    await page.evaluate(() => { (window as unknown as { __misma: boolean }).__misma = true; });

    await riel(page, 'Imagen').click();
    await esperarRuta(page, URL_CAJA.imagen);
    await expect(page).toHaveTitle('Estudio de video · Marketing · Distrito · Imagen');
    await riel(page, 'Edición').click();
    await esperarRuta(page, URL_CAJA.edicion);
    await expect(page).toHaveTitle('Estudio de video · Marketing · Distrito · Edición');
    await riel(page, 'Video').click();
    await esperarRuta(page, URL_CAJA.video);
    await expect(page).toHaveTitle('Estudio de video · Marketing · Distrito · Video');

    expect(await page.evaluate(() => (window as unknown as { __misma?: boolean }).__misma)).toBe(true);
    expect(await page.evaluate(() => history.length), 'cambiar de pestaña no agrega historia').toBe(historia);

    // recargar o compartir esa dirección abre la pestaña que dice, no otra
    await riel(page, 'Edición').click();
    await esperarRuta(page, URL_CAJA.edicion);
    await page.reload();
    await expect(riel(page, 'Edición')).toHaveAttribute('aria-pressed', 'true');
    // y «atrás» sube al grupo, no recorre las pestañas
    await abrirInicio(page, URL_DISTRITO);
    await herramienta(page, 'Imagen').click();
    await esperarRuta(page, URL_CAJA.imagen);
    await riel(page, 'Video').click();
    await esperarRuta(page, URL_CAJA.video);
    await page.goBack();
    await esperarRuta(page, URL_DISTRITO);
  });

  test('cambiar de pestaña conserva lo escrito (la caja es una sola página con tres direcciones)', async ({ page }) => {
    await simular(page);
    await abrirLaCaja(page, URL_CAJA.imagen);
    const cuadro = page.getByRole('textbox', { name: CAJA });
    await cuadro.fill('Un gato en un tejado');
    await riel(page, 'Video').click();
    await esperarRuta(page, URL_CAJA.video);
    await riel(page, 'Imagen').click();
    await esperarRuta(page, URL_CAJA.imagen);
    await expect(cuadro).toHaveValue('Un gato en un tejado');
  });

  test('un texto que llega por la dirección abre la pestaña que le toca, aunque la dirección sea otra, y la dirección la sigue', async ({ page }) => {
    await simular(page);
    // ?prompt= es una imagen: la caja abre en Imagen con el texto puesto y la dirección pasa a …/imagen/, sin el ?prompt=
    await abrirLaCaja(page, `${URL_CAJA.video}?prompt=hola%20mundo`);
    await expect(riel(page, 'Imagen')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('textbox', { name: CAJA })).toHaveValue('hola mundo');
    await esperarRuta(page, URL_CAJA.imagen);
    expect(direccionDe(page)).toBe(URL_CAJA.imagen);
    await expect(page).toHaveTitle('Estudio de video · Marketing · Distrito · Imagen');
    // recargar NO repite la llegada: la caja vacía
    await page.reload();
    await expect(page.getByRole('textbox', { name: CAJA })).toHaveValue('');

    // ?brief= es un video
    await abrirLaCaja(page, `${URL_CAJA.imagen}?brief=Un%20video%20de%20mi%20perro`);
    await expect(riel(page, 'Video')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('textbox', { name: CAJA })).toHaveValue('Un video de mi perro');
    await esperarRuta(page, URL_CAJA.video);
    expect(direccionDe(page)).toBe(URL_CAJA.video);
  });
});

// ---------------------------------------------------------------------------
// las direcciones de antes y las tecleadas a mano (las reenvía el servidor, antes de que la página exista)

test.describe('las direcciones de antes y las tecleadas a mano', () => {
  const VIEJAS: readonly [string, string, string][] = [
    // dirección pedida, dirección en la que se termina, título
    ['/estudio/inicio/', URL_MAPA, TITULO_MAPA],
    ['/estudio/inicio', URL_MAPA, TITULO_MAPA],
    ['/estudio/inicio/?x=1', `${URL_MAPA}?x=1`, TITULO_MAPA],
    ['/estudio/?prompt=hola%20mundo', `${URL_CAJA.imagen}`, 'Estudio de video · Marketing · Distrito · Imagen'],
    ['/estudio/inicio/?prompt=hola%20mundo', `${URL_CAJA.imagen}`, 'Estudio de video · Marketing · Distrito · Imagen'],
    ['/estudio/?brief=Un%20video', `${URL_CAJA.video}`, 'Estudio de video · Marketing · Distrito · Video'],
    ['/estudio/?blotato=conectar', `${URL_BLOTATO}?blotato=conectar`, 'Estudio de video · Marketing · Blotato'],
    ['/estudio/inicio/?blotato=conectar', `${URL_BLOTATO}?blotato=conectar`, 'Estudio de video · Marketing · Blotato'],
    // lo que se tecleó sin barra o en mayúsculas llega a la página con barra
    ['/estudio/marketing', URL_MARKETING, 'Estudio de video · Marketing'],
    ['/estudio/Marketing/', URL_MARKETING, 'Estudio de video · Marketing'],
    ['/estudio//marketing//distrito', URL_DISTRITO, 'Estudio de video · Marketing · Distrito'],
    // «//» con barra final y las escritas con «%XX»: la página lee location.pathname tal cual y no reconocería su nivel (el servidor las corrige)
    ['/estudio//marketing/', URL_MARKETING, 'Estudio de video · Marketing'],
    ['/estudio/%6Darketing/', URL_MARKETING, 'Estudio de video · Marketing'],
    ['/estudio/marketing%2Fdistrito/', URL_DISTRITO, 'Estudio de video · Marketing · Distrito'],
    // un parámetro repetido: el servidor decide con el PRIMERO, como la página (URLSearchParams.get)
    ['/estudio/?blotato=conectar&blotato=otra', `${URL_BLOTATO}?blotato=conectar&blotato=otra`, 'Estudio de video · Marketing · Blotato'],
    ['/estudio/?blotato=otra&blotato=conectar', `${URL_MAPA}?blotato=otra&blotato=conectar`, TITULO_MAPA],
    ['/estudio/marketing/distrito/Video', URL_CAJA.video, 'Estudio de video · Marketing · Distrito · Video'],
    ['/estudio/central?x=1', '/estudio/central/?x=1', 'Estudio de video · Central'],
    ['/estudio', URL_MAPA, TITULO_MAPA],
  ];

  for (const [pedida, final, tituloEsperado] of VIEJAS) {
    test(`${pedida} → ${final}`, async ({ page }) => {
      await simular(page);
      const visto = observar(page);
      await page.goto(pedida);
      // con ?blotato=conectar el diálogo está abierto y deja el resto de la página fuera del árbol de accesibilidad: se espera a que haya página
      await page.locator('#raiz > *').first().waitFor();
      expect(direccionDe(page)).toBe(final);
      await expect(page).toHaveTitle(tituloEsperado);
      expect(visto.errores).toEqual([]);
    });
  }

  test('?blotato=conectar llega al grupo Blotato con el diálogo de conectar abierto', async ({ page }) => {
    await simular(page, { blotato: 'sin-conectar' });
    await page.goto('/estudio/?blotato=conectar');
    await esperarRuta(page, URL_BLOTATO);
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('?desde= y ?ver= (las migas de las pantallas de antes) ya no cambian nada: se ve el mapa, con la dirección limpia', async ({ page }) => {
    await simular(page);
    await page.goto('/estudio/?desde=mkt.distrito.video&ver=grupos');
    await expect(paso(page)).toHaveText('Elige un área');
    expect(direccionDe(page)).toBe(URL_MAPA);
    await expect(algunVolver(page)).toHaveCount(0);
  });

  test('una dirección que no existe es un 404, no una página en blanco', async ({ page }) => {
    for (const url of ['/estudio/nada/', '/estudio/marketing/nada/', '/estudio/marketing/distrito/nada/']) {
      const respuesta = await page.goto(url);
      expect(respuesta?.status(), url).toBe(404);
    }
  });

  // El servidor de estas pruebas (e2e/servidor.mjs) repite el de verdad: sirve una página solo si su dirección es una del registro de dist.
  // Con `request` la dirección llega TAL CUAL (el navegador normalizaría los «..»).
  test('una dirección con «..%2f» no se sale de dist: es un 404 y no el index.html de otra carpeta', async ({ request }) => {
    // desde web/dist/estudio, tres niveles arriba es la raíz del repo, y static/index.html (el inicio clásico) existe
    for (const url of ['/estudio/..%2f..%2f..%2fstatic%2f', '/estudio/..%2f..%2f..%2f..%2f..%2f..%2f..%2f..%2f..%2ftmp%2f']) {
      const respuesta = await request.get(url, { maxRedirects: 0 });
      expect(respuesta.status(), url).toBe(404);
      expect(await respuesta.text(), url).not.toContain('<html');
    }
  });

  test('un «%» mal formado es un 404 y el servidor sigue en pie', async ({ request }) => {
    expect((await request.get('/estudio/%E0%A4%A/', { maxRedirects: 0 })).status()).toBe(404);
    expect((await request.get('/api/%E0%A4%A', { maxRedirects: 0 })).status()).toBe(404);
    expect((await request.get('/__e2e')).ok()).toBe(true);
  });

  test('un asset que falta o escrito de lado es un 404 JSON, nunca HTML', async ({ request }) => {
    for (const url of ['/estudio/assets/no-existe.js', '/estudio//assets/x.js', '/estudio/assets/../marketing/index.html']) {
      const respuesta = await request.get(url, { maxRedirects: 0, headers: { Accept: 'text/html' } });
      expect(respuesta.status(), url).toBe(404);
      expect(respuesta.headers()['content-type'], url).toContain('application/json');
    }
  });
});

// ---------------------------------------------------------------------------
// Blotato: se pide solo donde se usa

test.describe('Blotato', () => {
  // las tarjetas de la lista (<ul>), no las migas (<ol>)
  const tarjetas = (page: Page) => region(page).locator('ul').getByRole('link');

  for (const [estado, apagadas] of [['conectado', 0], ['sin-conectar', 3], ['caido', 0]] as [EstadoDeBlotato, number][]) {
    test(`Marketing › Blotato con Blotato ${estado}: ${apagadas ? 'las tres tarjetas se apagan' : 'ninguna se apaga'}`, async ({ page }) => {
      await simular(page, { blotato: estado });
      await abrirInicio(page, URL_BLOTATO);
      await expect(tarjetas(page)).toHaveCount(3);
      await expect(region(page).locator('a[aria-disabled="true"]')).toHaveCount(apagadas);
      // el botón de arriba dice lo que pasa: conectar o ver la cuenta. Sin saberlo (la consulta falla) no se apaga nada
      const boton = region(page).getByRole('button', { name: estado === 'conectado' ? 'Blotato conectado: ver o cambiar' : 'Conecta tu cuenta de Blotato' });
      await expect(boton).toBeVisible();
      if (apagadas) await expect(region(page).getByText('Conecta tu Blotato para usarlo')).toHaveCount(3);
    });
  }

  test('un clic en una tarjeta apagada ofrece conectar en vez de navegar', async ({ page }) => {
    await simular(page, { blotato: 'sin-conectar' });
    await abrirInicio(page, URL_BLOTATO);
    await expect(region(page).locator('a[aria-disabled="true"]')).toHaveCount(3);
    // apagada con `aria-disabled`: el clic llega (por eso `force`: Playwright no hace clic en lo que se declara desactivado) y ofrece conectar
    await region(page).getByRole('link', { name: /^Agenda tus publicaciones/ }).click({ force: true });
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(rutaDe(page)).toBe(URL_BLOTATO);
  });

  test('Distrito (y el mapa y las áreas) no piden nada de Blotato; su grupo sí', async ({ page }) => {
    await simular(page, { blotato: 'conectado' });
    const visto = observar(page);
    for (const url of [URL_MAPA, URL_MARKETING, URL_DISTRITO, '/estudio/central/distrito/']) {
      await abrirInicio(page, url);
      await expect(paso(page)).toBeVisible();
      await page.waitForTimeout(300);
    }
    expect(visto.api.filter(p => p === '/api/blotato'), 'ninguna página que no usa Blotato lo consulta').toEqual([]);
    expect(visto.archivos.filter(a => /^(Blotato|GrupoConBlotato)-/.test(a))).toEqual([]);

    await abrirInicio(page, URL_BLOTATO);
    await expect(region(page).getByRole('button', { name: 'Blotato conectado: ver o cambiar' })).toBeVisible();
    expect(visto.api).toContain('/api/blotato');
    // el diálogo se pide con el primer clic, no antes
    expect(visto.archivos.filter(a => /^Blotato-/.test(a))).toEqual([]);
    await region(page).getByRole('button', { name: 'Blotato conectado: ver o cambiar' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(visto.archivos.filter(a => /^Blotato-/.test(a)).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// lo que pesa: las páginas de navegación no traen la caja

test.describe('las páginas de navegación no traen la caja', () => {
  /** Cuánto JS (sin comprimir: el servidor de las pruebas no comprime) bajó el navegador para dejar esta página lista. */
  async function bytesDeJs(page: Page, url: string): Promise<number> {
    const pedidos: Promise<number>[] = [];
    const alTerminar = (r: Request) => {
      if (new URL(r.url()).pathname.startsWith('/estudio/assets/') && r.url().endsWith('.js')) pedidos.push(r.sizes().then(s => s.responseBodySize));
    };
    page.on('requestfinished', alTerminar);
    await abrirInicio(page, url);
    await page.waitForLoadState('networkidle');
    page.off('requestfinished', alTerminar);
    return (await Promise.all(pedidos)).reduce((a, b) => a + b, 0);
  }

  // medido al diseñarlo: las 13 páginas de navegación bajan 245 kB de JS; la caja, 433 kB. Los topes dejan margen por si el menú crece, pero
  // no tanto como para que la caja entera (≈ 190 kB más) quepa en una página de navegación sin que esto lo note
  const TOPE_DE_NAVEGACION = 300_000;
  const PISO_DE_LA_CAJA = 400_000;

  test('el mapa, las áreas y los grupos no piden su código ni sus listas; la caja sí', async ({ page }) => {
    await simular(page);
    const visto = observar(page);
    for (const url of [URL_MAPA, URL_MARKETING, URL_DISTRITO, URL_BLOTATO, '/estudio/central/', '/estudio/ventas/']) {
      await abrirInicio(page, url);
      await expect(paso(page)).toBeVisible();
      await page.waitForTimeout(300);
    }
    expect(visto.archivos.filter(a => a.startsWith('herramienta-')), 'el código de la caja').toEqual([]);
    expect(visto.api.filter(p => LISTAS_DE_LA_CAJA.includes(p)), 'las listas de la caja').toEqual([]);
    // lo que toda página privada necesita sí se pide: el saldo (monedero.js) y la configuración del acceso (auth.js)
    expect(visto.api).toEqual(expect.arrayContaining(['/api/auth/config', '/api/creditos']));

    // el control: la página de la caja trae su código y pide sus listas. Si esto fallara, lo de arriba pasaría sin mirar nada
    await abrirLaCaja(page);
    await page.waitForLoadState('networkidle');
    expect(visto.archivos.filter(a => a.startsWith('herramienta-'))).not.toEqual([]);
    expect(visto.api).toEqual(expect.arrayContaining(['/api/proyectos', '/api/imagenes']));
    expect(visto.errores).toEqual([]);
  });

  test('pesan lo suyo: una página de navegación baja bastante menos JavaScript que la de la caja', async ({ page }) => {
    await simular(page);
    for (const url of [URL_MAPA, URL_MARKETING, URL_DISTRITO, URL_BLOTATO]) {
      const bytes = await bytesDeJs(page, url);
      expect(bytes, `${url}: JS de la página de navegación`).toBeGreaterThan(0);
      expect(bytes, `${url}: JS de la página de navegación`).toBeLessThanOrEqual(TOPE_DE_NAVEGACION);
    }
    // el control: la caja baja la suya entera. Si no pasara de aquí, el tope de arriba no distinguiría nada
    expect(await bytesDeJs(page, URL_CAJA.video), 'JS de la caja').toBeGreaterThanOrEqual(PISO_DE_LA_CAJA);
  });

  test('pasar del mapa a un grupo no pide ningún archivo de código nuevo: la entrada de las páginas de navegación es una sola', async ({ page }) => {
    await simular(page);
    const entradas = new Map<string, number>();
    page.on('requestfinished', r => {
      const { pathname } = new URL(r.url());
      if (pathname.startsWith('/estudio/assets/') && pathname.endsWith('.js')) entradas.set(pathname, (entradas.get(pathname) ?? 0) + 1);
    });
    await abrirInicio(page);
    const alAbrirElMapa = new Set(entradas.keys());
    expect(alAbrirElMapa.size).toBeGreaterThan(0);
    await elegir(page, 'Marketing', 'Distrito');
    await expect(paso(page)).toHaveText('Distrito');
    // se compara QUÉ archivos se piden (el servidor de las pruebas no manda Cache-Control de los assets: no se mide el caché del navegador).
    // Entre el mapa y un grupo son los mismos (la entrada es una sola, nivel.tsx): ningún archivo nuevo
    const nuevos = [...entradas.keys()].filter(a => !alAbrirElMapa.has(a));
    expect(nuevos, 'archivos nuevos al pasar del mapa a un grupo').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// el celular

test.describe('el celular', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  // A 390 px la ficha «Marketing» del mapa y la tarjeta «Distrito» de la página siguiente coinciden: sin la guarda, el segundo clic de un
  // doble clic (que llega cuando la página nueva ya cargó) saltaría dos niveles. Un clic deliberado, pasado el medio segundo, sí pasa.
  // Con «reducir movimiento» a propósito: mientras corre la View Transition entre páginas (180–300 ms) el navegador entrega todo clic al
  // <html> y el segundo clic NUNCA llegaría a la tarjeta, con guarda o sin ella; la prueba pasaría sin mirar nada. Sin transición, la
  // tarjeta recibe el clic y solo la guarda lo detiene (quitarla hace fallar esta prueba).
  test.describe('doble clic', () => {
    test.use({ contextOptions: { reducedMotion: 'reduce' } });

    // El `Date.now()` de la página está quieto (`relojFijo`): cuánto tiempo pasó entre la página nueva y el segundo clic es lo que la prueba dice,
    // no lo que tarde la máquina en llegar (con un reloj de verdad, la prueba medía la velocidad de la CPU y no la guarda).
    test('un doble clic lento sobre «Marketing» no salta dos niveles', async ({ page }) => {
      await simular(page);
      await vigilarNavegaciones(page);
      await abrirInicio(page);
      const caja = (await ficha(page, 'Marketing').boundingBox())!;
      const x = caja.x + caja.width / 2;
      const y = caja.y + caja.height / 2;

      await relojFijo(page);
      await page.mouse.move(x, y);
      await page.mouse.down({ clickCount: 1 });
      await page.mouse.up({ clickCount: 1 });
      await esperarRuta(page, URL_MARKETING);
      await expect(paso(page)).toHaveText('Elige un grupo');
      await relojFijo(page, 80);

      // el punto del primer clic cae ahora sobre la tarjeta «Distrito» (y nada lo tapa): si no, esta prueba no mide nada
      const enElPunto = await page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.closest('a')?.getAttribute('href') ?? null, [x, y]);
      expect(enElPunto, 'la tarjeta «Distrito» no está bajo la ficha «Marketing»').toBe(URL_DISTRITO);

      // el segundo clic del doble clic llega ya sobre la página nueva (detail 2, 80 ms después de cargada)
      await sinNavegar(
        page,
        async () => {
          await page.mouse.move(x, y);
          await page.mouse.down({ clickCount: 2 });
          await page.mouse.up({ clickCount: 2 });
        },
        URL_MARKETING,
        'el doble clic saltó dos niveles',
      );

      // el control: un clic deliberado en el mismo punto, pasado el medio segundo, sí abre la tarjeta
      await relojFijo(page, 600);
      await page.mouse.move(x, y);
      await page.mouse.down({ clickCount: 1 });
      await page.mouse.up({ clickCount: 1 });
      await esperarRuta(page, URL_DISTRITO);
    });

    test('la guarda dura exactamente medio segundo: a los 499 ms el segundo clic se descarta y a los 500 ya pasa', async ({ page }) => {
      await simular(page);
      await vigilarNavegaciones(page);
      await abrirInicio(page);
      const caja = (await ficha(page, 'Marketing').boundingBox())!;
      const x = caja.x + caja.width / 2;
      const y = caja.y + caja.height / 2;
      const segundoClic = async () => {
        await page.mouse.move(x, y);
        await page.mouse.down({ clickCount: 2 });
        await page.mouse.up({ clickCount: 2 });
      };

      await relojFijo(page);
      await page.mouse.click(x, y);
      await esperarRuta(page, URL_MARKETING);
      await expect(paso(page)).toHaveText('Elige un grupo');
      // VENTANA_DOBLE_CLIC_MS (src/pantallas/inicio/estadoRecorrido.ts): 499 ms después todavía es «el segundo clic de un doble clic»…
      await relojFijo(page, 499);
      await sinNavegar(page, segundoClic, URL_MARKETING, 'a los 499 ms');
      // …y a los 500 ya es una elección: abre la tarjeta que cae bajo el punto
      await relojFijo(page, 500);
      await segundoClic();
      await esperarRuta(page, URL_DISTRITO);
    });
  });

  test('el teclado no cuenta como doble clic: Enter sobre una ficha recién cargada abre su página', async ({ page }) => {
    await simular(page);
    await abrirInicio(page);
    await ficha(page, 'Marketing').focus();
    await page.keyboard.press('Enter');
    await esperarRuta(page, URL_MARKETING);
    await opcion(page, 'Marketing', 'Distrito').focus();
    await page.keyboard.press('Enter');
    await esperarRuta(page, URL_DISTRITO);
  });
});

for (const ancho of [320, 390]) {
  test.describe(`a ${ancho} px`, () => {
    test.use({ viewport: { width: ancho, height: 800 } });

    const NIVELES: readonly [string, string][] = [
      ['el mapa', URL_MAPA],
      ['las opciones de un área', URL_MARKETING],
      ['la lista de un grupo', URL_DISTRITO],
      ['la lista de Blotato', URL_BLOTATO],
      ['las opciones de Central', '/estudio/central/'],
      ['la caja', URL_CAJA.video],
    ];

    for (const [nombre, url] of NIVELES) {
      test(`${nombre} no se arrastra de lado`, async ({ page }) => {
        await simular(page);
        await abrirInicio(page, url);
        await expect(paso(page)).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        expect(await sobraAlLado(page), `${url} a ${ancho} px: la página se arrastra de lado`).toBeLessThanOrEqual(0);
        // el título se ve entero y las migas, si las hay, caben
        const h1 = (await region(page).getByRole('heading', { level: 1 }).boundingBox())!;
        expect(h1.x).toBeGreaterThanOrEqual(0);
        expect(h1.x + h1.width).toBeLessThanOrEqual(ancho + 0.5);
      });
    }

    test('«Automatizaciones», la ficha más larga del mapa, cabe en su ficha en una sola línea', async ({ page }) => {
      await simular(page);
      await abrirInicio(page);
      const nombre = ficha(page, 'Automatizaciones').getByText('Automatizaciones', { exact: true });
      const caja = (await ficha(page, 'Automatizaciones').boundingBox())!;
      const texto = (await nombre.boundingBox())!;
      expect(texto.x).toBeGreaterThanOrEqual(caja.x - 0.5);
      expect(texto.x + texto.width).toBeLessThanOrEqual(caja.x + caja.width + 0.5);
    });
  });
}

// ---------------------------------------------------------------------------
// reducir movimiento: una página de cada plantilla (el mapa, un área, un grupo y la caja). El bucle de movimiento-reducido.spec.ts recorre
// las carpetas de web/estudio/ menos la principal; aquí se mira también el mapa y se comprueba que el guardián ve (el control).

test.describe('con «reducir movimiento»', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  const PLANTILLAS: readonly [string, string][] = [
    ['el mapa', URL_MAPA],
    ['un área', URL_MARKETING],
    ['un grupo', URL_DISTRITO],
    ['la caja', URL_CAJA.video],
  ];

  for (const [nombre, url] of PLANTILLAS) {
    test(`${nombre}: ni mientras carga ni ya cargada se mueve nada, y al pasar a otra página tampoco`, async ({ page }) => {
      // la API de las listas no contesta nunca: la página se queda cargando lo suyo
      await page.route(/\/api\/(?!auth\/config$|creditos$)/, () => {});
      await page.goto(url);
      await page.locator('#raiz > *').first().waitFor();
      await page.waitForTimeout(400);
      expect(await page.evaluate(animacionesVivas), `${url}: mientras carga`).toEqual([]);

      await page.unroute(/\/api\/(?!auth\/config$|creditos$)/);
      await simular(page);
      await page.reload();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(400);
      expect(await page.evaluate(animacionesVivas), `${url}: ya cargada`).toEqual([]);
    });
  }

  test('pasar de un nivel a otro con un clic tampoco anima nada', async ({ page }) => {
    await simular(page);
    await abrirInicio(page);
    await ficha(page, 'Marketing').click();
    await esperarRuta(page, URL_MARKETING);
    await expect(paso(page)).toHaveText('Elige un grupo');
    await page.waitForTimeout(400);
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
  });
});

// El control: sin la preferencia, la misma sonda SÍ se mueve en una página de nivel. Si esto fallara, lo de arriba pasaría sin mirar nada.
test('sin «reducir movimiento», una sonda que gira en una página de nivel sí se ve (el guardián sí ve)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await simular(page);
  await abrirInicio(page, URL_MARKETING);
  await page.evaluate(() => {
    const s = document.createElement('div');
    s.className = 'animate-spin';
    s.id = 'sonda';
    s.style.cssText = 'width:10px;height:10px';
    document.body.append(s);
  });
  await page.waitForTimeout(100);
  expect((await page.evaluate(animacionesVivas)).map(a => a.objetivo)).toContain('div#sonda.animate-spin');
});
