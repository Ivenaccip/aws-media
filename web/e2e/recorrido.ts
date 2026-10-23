// Lo que comparten las pruebas de navegador del recorrido del inicio («Irremplazables»): el estudio de mentira y las maneras de señalar
// cada cosa, por su rol y su nombre —lo que ve y oye una persona—, no por clases.
//
// RUTAS POR NIVEL (dueño, 21-oct-2026: «por cada pestaña, una ruta»). Antes el recorrido era UNA página (/estudio/inicio/) que cambiaba de
// paso por dentro; ahora cada nivel es su propia página, con su dirección y su `<title>`:
//
//   /estudio/                              el mapa («Elige un área»)           ← la principal; aquí empieza todo
//   /estudio/marketing/                    las opciones del área («Elige un grupo»)
//   /estudio/marketing/distrito/           la lista del grupo: Imagen · Video · Edición, como enlaces
//   /estudio/marketing/distrito/video/     la caja («¿Qué vamos a crear hoy?»), con su pestaña (imagen · video · edicion)
//
// Qué cambia para quien escribe una prueba (la API de este archivo es la misma; los nombres que importan y lo que hacen, también):
//   · pasar de un nivel a otro es NAVEGAR: las fichas, las tarjetas de grupo, las tarjetas de la lista y las migas son ENLACES (rol `link`,
//     no `button`); las que no se abren (Producto, Ventas) siguen siendo botones quietos con `aria-disabled` (`fichaApagada`). Un clic en
//     un enlace carga otra página: los `Locator` se vuelven a buscar solos en la nueva, pero lo que se guardó de la vieja (un
//     `evaluate`, un `boundingBox`) ya no vale;
//   · ABRIR el inicio es ir a `/estudio/` (`abrirInicio`) y llegar a la caja es ir directo a su dirección (`abrirLaCaja`). Marketing ›
//     Distrito ya NO es la caja: es la lista Imagen · Video · Edición (`elegirHerramienta` da el último clic);
//   · ya no existe «Volver a …», «Estás aquí», ni el `?desde=&ver=` de las pantallas hoja (sus migas son enlaces directos al mapa y a las
//     opciones del área); `volverA` y `algunVolver` se conservan para afirmar justo que NO están;
//   · salir de la caja a un nivel superior descarta lo que estaba escrito (cambiar de pestaña DENTRO de la caja sigue conservándolo).
//
// Lo que el servidor reenvía (server/web.py, ENTRADAS_VIEJAS; e2e/servidor.mjs lo repite): `/estudio/inicio/` → `/estudio/`, y `?prompt=` /
// `?brief=` / `?blotato=conectar` a la caja en Imagen, a la caja en Video y al grupo Blotato.
//
// API (todo lo de abajo es lo que importan los specs; inicio-recorrido.spec.ts usa lo mismo que antes):
//   · el estudio de mentira:   simular, simularSubida, VIDEO, tipos EstadoDeBlotato y Simulacion
//   · las direcciones:         URL_MAPA, URL_MARKETING, URL_DISTRITO, URL_BLOTATO, URL_CAJA[imagen|video|edicion], TITULO_MAPA
//   · dónde está la página:    rutaDe (camino), direccionDe (camino + query), esperarRuta (espera a un camino, ya cargado)
//   · abrir:                   abrirInicio(page, url = URL_MAPA), abrirLaCaja(page, url = URL_CAJA.video)
//   · señalar:                 region, tarjeta, paso, migas, ficha, fichaApagada, cualquierFicha, opcion, herramienta, tarjetasDeLaLista, riel,
//                              volverA, algunVolver, migaDeHoja (las migas de una pantalla hoja, fuera de la región)
//   · moverse (clic + espera): irAlMapa, elegir(área, grupo), elegirHerramienta(nombre), irA(área, grupo)
//   · lo que NO navega:        vigilarNavegaciones (antes de abrir), sinNavegar(page, acción, ruta) — sin esperar un rato fijo
//   · el reloj de la guarda:   relojFijo(page, ms) — `Date.now()` quieto en «ms después de cargar la página» (el doble clic no depende de la máquina)
//   · foco y medidas:          enfocado, sobraAlLado, lineasDe
//
// Los textos y las direcciones están escritos a mano a propósito (no se importan de marca/menu.ts ni de marca/rutas.ts): si alguien cambia
// un rótulo o una dirección, las pruebas lo notan en vez de seguirlo en silencio.
import { expect, type Locator, type Page } from '@playwright/test';

import { cotizacion } from './edicion';

const RESPUESTAS_VACIAS: Record<string, unknown> = {
  '**/api/proyectos': [],
  '**/api/slots': { slots: null, activos: 0 },
  '**/api/edicion/proyectos': [],
  '**/api/clip': { clips: [] },
  '**/api/trabajos': { trabajos: [], sondeo_s: 15 },
  '**/api/moderar': { permitido: true },
};

/** Un PNG de 1×1: lo que «sirve» el estudio como imagen de Mis creaciones. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** Qué contesta /api/blotato: `caido` = no se sabe si está conectado (la consulta falla), que no apaga nada. */
export type EstadoDeBlotato = 'conectado' | 'sin-conectar' | 'caido';

const estadoDeBlotato = (conectado: boolean) => ({
  conectado,
  origen: conectado ? 'usuario' : null,
  cuentas: conectado ? [{ id: 'c1', platform: 'instagram', username: 'ana', fullname: 'Ana Pérez' }] : [],
  error: null,
  plan: null,
});

export interface Simulacion {
  blotato?: EstadoDeBlotato;
  /** Cuántas imágenes tiene «Mis creaciones». Con 0 sale, en su lugar, «Tu primer video, en tres caminos». */
  imagenes?: number;
}

/**
 * El estudio de mentira del inicio: listas vacías (o con imágenes), Blotato como se pida y nada más. Devuelve, en orden, lo que se
 * le pidió a /api/blotato (`GET ?redes=0`, `POST`…), y lo que le llegó en el cuerpo de un POST. Un POST (conectar) deja a Blotato
 * conectado para las lecturas que siguen.
 */
export async function simular(page: Page, { blotato = 'caido', imagenes = 0 }: Simulacion = {}) {
  for (const [ruta, json] of Object.entries(RESPUESTAS_VACIAS)) await page.route(ruta, r => r.fulfill({ json }));
  const lista = Array.from({ length: imagenes }, (_, i) => ({ nombre: `img-${i + 1}.jpg`, url: `/api/imagenes/img-${i + 1}.jpg`, creado: 1_758_000_000 + i }));
  await page.route('**/api/imagenes', r => r.fulfill({ json: { total: lista.length, imagenes: lista } }));
  await page.route('**/api/imagenes/*.jpg', r => r.fulfill({ body: PNG_1X1, contentType: 'image/png' }));

  const pedidos: string[] = [];
  const claves: string[] = [];
  let conectado = blotato === 'conectado';
  // una expresión y no un glob: el de Playwright no dice si `?redes=0` cuenta como parte de la ruta
  await page.route(/\/api\/blotato(\?.*)?$/, r => {
    const { method, url } = { method: r.request().method(), url: new URL(r.request().url()) };
    pedidos.push(`${method} ${url.search}`.trim());
    if (blotato === 'caido') return r.fulfill({ status: 404, json: { detail: 'no' } });
    if (method === 'POST') {
      claves.push((r.request().postDataJSON() as { clave: string }).clave);
      conectado = true;
    }
    return r.fulfill({ json: estadoDeBlotato(conectado) });
  });
  return { pedidos, claves };
}

// ---------------------------------------------------------------------------
// las direcciones del recorrido (escritas a mano, ver arriba)

/** Las tres herramientas de la caja: una misma página con tres direcciones, la pestaña la dice la dirección. */
export type Herramienta = 'imagen' | 'video' | 'edicion';

/** La principal: el mapa («Elige un área»). */
export const URL_MAPA = '/estudio/';
/** Las opciones del área Marketing («Elige un grupo»): Distrito · Blotato · Avanzado. */
export const URL_MARKETING = '/estudio/marketing/';
/** El grupo Distrito de Marketing: la LISTA Imagen · Video · Edición (no la caja). */
export const URL_DISTRITO = '/estudio/marketing/distrito/';
/** El grupo Blotato de Marketing (a donde el servidor manda `?blotato=conectar`). */
export const URL_BLOTATO = '/estudio/marketing/blotato/';
/** La caja, en la pestaña de cada herramienta. */
export const URL_CAJA: Readonly<Record<Herramienta, string>> = {
  imagen: '/estudio/marketing/distrito/imagen/',
  video: '/estudio/marketing/distrito/video/',
  edicion: '/estudio/marketing/distrito/edicion/',
};
/** El título de la pestaña del navegador del mapa; el de cada nivel le añade « · Área · Grupo · Herramienta» (marca/rutas.ts). */
export const TITULO_MAPA = 'Estudio de video';

/** Dónde está la página: solo el camino, sin query ni ancla (`/estudio/marketing/`). */
export const rutaDe = (page: Page): string => new URL(page.url()).pathname;

/** Dónde está la página, con su query (`/estudio/marketing/blotato/?blotato=conectar`): lo que dejó el servidor tras un 302. */
export const direccionDe = (page: Page): string => {
  const u = new URL(page.url());
  return u.pathname + u.search;
};

/** Espera a que la página sea la de ese camino (ya cargada). Un clic en un enlace carga otro documento: esto es lo que lo espera. */
export const esperarRuta = (page: Page, ruta: string) => page.waitForURL(u => u.pathname === ruta);

/** Pulsa un enlace y espera a la página a la que lleva (la que dice su `href`). Un enlace sin `href` (un botón) hace fallar la prueba aquí. */
async function irPorEnlace(page: Page, enlace: Locator) {
  const href = await enlace.getAttribute('href');
  expect(href, 'el enlace no tiene href: ¿es un botón?').not.toBeNull();
  const destino = new URL(href!, page.url()).pathname;
  await enlace.click();
  await esperarRuta(page, destino);
}

// ---------------------------------------------------------------------------
// abrir el inicio y la caja

/** Abre el inicio y espera a que aparezca su región. Sin dirección aterriza en el MAPA (`/estudio/`, la principal). Las direcciones de antes
 *  (`/estudio/inicio/`, `/estudio/?prompt=…`) las reenvía el servidor, y aquí se termina en la página a la que llegan: la que se pide no
 *  tiene por qué ser la que se ve (`direccionDe`). */
export async function abrirInicio(page: Page, url = URL_MAPA) {
  await page.goto(url);
  await expect(region(page)).toBeVisible();
}

/** Abre la caja yendo DIRECTO a su dirección (por omisión, la pestaña Video) y espera a su título. `url` puede ser otra herramienta
 *  (`URL_CAJA.imagen`) o traer un query (`?prompt=hola`, `?brief=…`, `?blotato=conectar`). Para llegar CLICANDO por el recorrido, `irA` +
 *  `elegirHerramienta`. */
export async function abrirLaCaja(page: Page, url = URL_CAJA.video) {
  await abrirInicio(page, url);
  await expect(paso(page)).toHaveText('¿Qué vamos a crear hoy?');
}

// ---------------------------------------------------------------------------
// la región, la tarjeta y sus partes

/** La página entera de un nivel: el título (h1), las migas y el paso de ahora. La región toma su nombre del h1. */
export const region = (page: Page): Locator => page.getByRole('region', { name: 'Irremplazables' });

/** La TARJETA (borde, fondo y relleno), que solo existe con la caja a la vista; en los demás pasos es el mismo contenedor, sin nada de eso.
 *  Es el límite que busca la lista de «Editar ▾» (`data-limite-lista`). */
export const tarjeta = (page: Page): Locator => region(page).locator('[data-limite-lista]');

/** El único `h2` a la vista de la región: «Elige un área», «Elige un grupo», el nombre del grupo o el de la caja. */
export const paso = (page: Page): Locator => region(page).getByRole('heading', { level: 2 });

export const migas = (page: Page): Locator => region(page).getByRole('navigation', { name: 'Dónde estás' });

/** Una ficha del mapa que SE ABRE: un ENLACE a la página del área. El nombre accesible es el del área, sin nada más: ninguna lleva «Estás aquí».
 *  Producto y Ventas no se abren: son `fichaApagada`. */
export const ficha = (page: Page, area: string): Locator =>
  region(page).getByRole('group', { name: 'Áreas', exact: true }).getByRole('link', { name: new RegExp(`^${area}`) });

/** Una ficha del mapa que NO se abre («Próximamente»): un botón quieto, con `aria-disabled`, que sigue en el orden de Tab y no lleva a ningún lado. */
export const fichaApagada = (page: Page, area: string): Locator =>
  region(page).getByRole('group', { name: 'Áreas', exact: true }).getByRole('button', { name: new RegExp(`^${area}`) });

/** Una ficha del mapa, se abra o no: el enlace de las que se abren (`ficha`) o el botón quieto de las apagadas (`fichaApagada`). Para lo
 *  que se mide igual en las cinco (dónde caen, cuánto miden, su tono). */
export const cualquierFicha = (page: Page, area: string): Locator => ficha(page, area).or(fichaApagada(page, area));

/** Una de las opciones de un área: un ENLACE a la página del grupo. */
export const opcion = (page: Page, area: string, grupo: string): Locator =>
  region(page).getByRole('group', { name: area, exact: true }).getByRole('link', { name: new RegExp(`^${grupo}`) });

/** Una herramienta de la lista de un grupo (Imagen · Video · Edición en Marketing › Distrito): un ENLACE a su página. */
// la lista es un <ul>: las migas son un <ol> y también traen enlaces
export const herramienta = (page: Page, nombre: string): Locator => region(page).locator('ul').getByRole('link', { name: new RegExp(`^${nombre}`) });

/** Todas las tarjetas-enlace de la lista de un grupo, en orden (las de Blotato, apagadas o no; COI y la Biblioteca…). Lo «Próximamente» no
 *  es un enlace y no cuenta; las migas tampoco: son de otra lista. */
export const tarjetasDeLaLista = (page: Page): Locator => region(page).locator('ul').getByRole('link');

/** «Volver a Agenda tus publicaciones»: ya NO existe (las migas de las pantallas hoja van directo al mapa y a las opciones del área, y volver
 *  a donde se estaba es el «atrás» del navegador). Se conserva para afirmar que no está: `await expect(volverA(page, '…')).toHaveCount(0)`. */
export const volverA = (page: Page, destino: string): Locator =>
  region(page).getByRole('link', { name: `Volver a ${destino}`, exact: true });

/** Cualquier «Volver a …» (botón o enlace) que se vea: no debe haber ninguno. Las migas («Volver al mapa…», «Volver a las opciones…») no
 *  cuentan: su texto es el del lugar, no «Volver a …». */
export const algunVolver = (page: Page): Locator => region(page).locator('button, a').filter({ hasText: /^Volver a / });

/** Los botones del riel de la caja (Imagen, Video, Edición). Cambiar de pestaña aquí NO navega: la dirección y el título la siguen
 *  (`history.replaceState`), sin agregar historia. */
export const riel = (page: Page, familia: string): Locator =>
  page.getByRole('group', { name: 'Qué quieres crear' }).getByRole('button', { name: familia, exact: true });

/** Una miga de una pantalla HOJA (la agenda, la Copiadora, el Constructor…), que no tiene la región del recorrido: «Ir al mapa para cambiar
 *  de área (ahora: Marketing)» o «Ir a las opciones de Marketing (ahora: Blotato)». Son enlaces directos a `/estudio/` y a `/estudio/<área>/`. */
export const migaDeHoja = (page: Page, nombre: RegExp): Locator =>
  page.getByRole('navigation', { name: 'Dónde estás' }).getByRole('link', { name: nombre });

// ---------------------------------------------------------------------------
// moverse por el recorrido (cada paso es una página: se espera a que cargue)

/** La miga del área abre el mapa. Sirve desde la caja, desde las opciones y desde la lista de un grupo. */
export async function irAlMapa(page: Page) {
  await irPorEnlace(page, migas(page).getByRole('link', { name: /^Volver al mapa/ }));
  await expect(paso(page)).toHaveText('Elige un área');
}

/** Del mapa a la página de un grupo: la ficha del área y la tarjeta del grupo (dos páginas). Marketing › Distrito es la LISTA de herramientas,
 *  no la caja: `elegirHerramienta` da el último paso. */
export async function elegir(page: Page, area: string, grupo: string) {
  await irPorEnlace(page, ficha(page, area));
  await expect(paso(page)).toHaveText('Elige un grupo');
  await irPorEnlace(page, opcion(page, area, grupo));
}

/** De la lista de Marketing › Distrito a la caja de una herramienta («Imagen», «Video» o «Edición»), con el clic en su enlace. */
export async function elegirHerramienta(page: Page, nombre: string) {
  await irPorEnlace(page, herramienta(page, nombre));
  await expect(paso(page)).toHaveText('¿Qué vamos a crear hoy?');
}

/** Desde donde estés (el mapa, la caja, las opciones o una lista) hasta la página de un grupo, pasando por el mapa. */
export async function irA(page: Page, area: string, grupo: string) {
  await expect(paso(page)).toBeVisible();
  if ((await paso(page).textContent()) !== 'Elige un área') await irAlMapa(page);
  await elegir(page, area, grupo);
}

// ---------------------------------------------------------------------------
// lo que NO navega (Esc en el mapa, un clic en lo apagado, el segundo clic de un doble clic)
//
// Para afirmar que algo NO pasó no hay evento que esperar, y esperar un rato fijo «a ver si navega» es lento y no prueba nada si la máquina va
// lenta. Lo que haría navegar a estas páginas (un enlace, Esc → `location.assign`) EMPIEZA la navegación dentro del mismo clic o de la misma
// tecla, y la Navigation API lo anuncia en ese instante con su evento `navigate`, antes de pedir nada al servidor. Así que: cada documento se
// marca al nacer y anota las navegaciones que empieza; tras la acción, el documento tiene que ser el mismo y no haber anotado ninguna.

interface Vigia {
  documento: number;
  anotadas: string[];
}

/** Desde aquí, cada documento que abra `page` se marca y anota las navegaciones que empieza. Va ANTES de abrir la primera página; lo lee
 *  `sinNavegar`. Sin la Navigation API no se marca nada, y `sinNavegar` lo dice en vez de pasar sin mirar. */
export async function vigilarNavegaciones(page: Page) {
  await page.addInitScript(() => {
    const nav = (window as unknown as { navigation?: EventTarget }).navigation;
    if (!nav) return;
    const vigia: Vigia = { documento: Math.random(), anotadas: [] };
    Object.defineProperty(window, '__vigia', { value: vigia });
    nav.addEventListener('navigate', e => vigia.anotadas.push((e as unknown as { destination: { url: string } }).destination.url));
  });
}

const leerVigia = (page: Page) => page.evaluate(() => (window as unknown as { __vigia?: Vigia }).__vigia ?? null);

/** Hace `accion` (un clic, una tecla) y afirma que NO navegó: la página es el mismo documento, no empezó ninguna navegación y sigue en
 *  `ruta`. Necesita `vigilarNavegaciones` antes de abrir la página. Se compara con lo anotado ANTES de la acción (lo que el documento hizo al
 *  cargar no cuenta); un `history.replaceState` DURANTE la acción sí cuenta (la Navigation API también lo anuncia): un cambio de pestaña de la
 *  caja no va aquí. */
export async function sinNavegar(page: Page, accion: () => Promise<unknown>, ruta: string, donde = '') {
  const antes = await leerVigia(page);
  expect(antes, 'falta vigilarNavegaciones(page) antes de abrir la página (o el navegador no tiene la Navigation API)').not.toBeNull();
  await accion();
  // si la acción navegó, el documento de antes se está yendo (`Execution context was destroyed`) o ya es otro
  const despues = await leerVigia(page).catch((e: unknown) => {
    throw new Error(`${donde}: la acción navegó (${String(e).split('\n')[0]})`);
  });
  expect(despues?.documento, `${donde}: la página se recargó o cambió`).toBe(antes!.documento);
  expect(despues?.anotadas, `${donde}: la acción empezó a navegar`).toEqual(antes!.anotadas);
  expect(rutaDe(page), donde).toBe(ruta);
}

// ---------------------------------------------------------------------------
// el reloj de la guarda del doble clic
//
// La guarda de PaginaNivel (esDobleClicAccidental) descarta un segundo clic (`detail` > 1) que llega a menos de VENTANA_DOBLE_CLIC_MS (500) de
// que la página se montó, y mide con `Date.now()`. Si la prueba lo mide con el reloj de verdad, lo que decide el resultado es cuánto tarda la
// máquina entre el primer clic y el segundo (esperar la página, mirar qué cae debajo, mover el ratón: cada paso es un viaje al navegador), y
// con la máquina cargada el segundo clic cae pasados los 500 ms y «la guarda no funciona». Con el `Date.now()` de la página QUIETO, el tiempo
// transcurrido es el que la prueba dice y nada más: los temporizadores siguen corriendo, solo `Date.now()` y `new Date()` dejan de avanzar.

/** Una hora cualquiera: solo cuenta la diferencia entre lo que la página leyó al montarse y lo que lee después. */
const HORA_FIJA = Date.UTC(2026, 9, 22, 12, 0, 0);

/** Fija `Date.now()` en `HORA_FIJA + ms`. Se llama ANTES del clic que carga la página (esa página nace a la hora de entonces: `ms` = 0, el
 *  valor por omisión) y de nuevo, ya cargada, con «cuánto pasó desde que cargó»: `relojFijo(page, 80)` es «pasaron 80 ms». Vale para las páginas
 *  que se abran después (el cambio de documento no lo reinicia) y se puede mover cuantas veces haga falta. */
export const relojFijo = (page: Page, ms = 0) => page.clock.setFixedTime(HORA_FIJA + ms);

// ---------------------------------------------------------------------------
// lo que el foco y la pantalla dicen

/** Qué tiene el foco: la etiqueta y el texto de ese elemento, o `body` si no hay ninguno (el foco perdido). */
export const enfocado = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    const esBody = !a || a === document.body;
    return { etiqueta: esBody ? 'body' : a.tagName.toLowerCase(), texto: esBody ? '' : (a.textContent ?? '').trim() };
  });

/** ¿La página se arrastra de lado? Lo que sobra por la derecha (≤ 0 = nada). */
export const sobraAlLado = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Cuántas líneas ocupa el texto de un elemento: una sola es lo que se pide de «Automatizaciones» y «Estás aquí». */
export const lineasDe = (loc: Locator) =>
  loc.evaluate(el => {
    const rango = document.createRange();
    rango.selectNodeContents(el);
    return new Set(Array.from(rango.getClientRects()).map(r => Math.round(r.top))).size;
  });

// ---------------------------------------------------------------------------
// la subida de un video en la caja de Edición (lo mínimo de inicio-edicion.spec.ts: el servidor y «S3» son rutas de mentira)

export const VIDEO = { name: 'entrevista.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2048, 1) };

/** Las rutas de una subida: el PUT a «S3» espera a `puerta`, así la prueba decide cuándo termina de subir. */
export async function simularSubida(page: Page, puerta: Promise<void>) {
  await page.route('**/api/media/config', r => r.fulfill({ json: { activo: true, cdn: '' } }));
  await page.route('**/api/media/entrevista', r => r.fulfill({ json: { subidas: [] } }));
  await page.route('**/api/media/presign', r =>
    r.fulfill({ json: { url: '/s3-falso/subida', key: 'videos/entrevista/subidas/entrevista.mp4', content_type: 'video/mp4' } }),
  );
  await page.route('**/s3-falso/subida', async r => {
    await puerta;
    await r.fulfill({ status: 200, body: '' });
  });
  await page.route('**/api/media/confirmar', r => r.fulfill({ json: { archivo: 'entrevista.mp4', cdn: '' } }));
  // E2: el precio sale de POST /api/edicion/cotizar con las referencias de la caja
  await page.route('**/api/edicion/cotizar', r => {
    const refs = (r.request().postDataJSON() as { videos: string[] }).videos;
    return r.fulfill({ json: cotizacion(refs) });
  });
}
