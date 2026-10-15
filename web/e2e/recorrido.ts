// Lo que comparten las pruebas de navegador del recorrido del inicio (la tarjeta «Irremplazables»: mapa en X → tres opciones →
// la caja o la lista de pantallas de un grupo; pantallas/inicio/recorrido.ts): el estudio de mentira y las maneras de señalar
// cada cosa de la tarjeta, por su rol y su nombre —lo que ve y oye una persona—, no por clases.
//
// Los textos están escritos a mano a propósito (no se importan de marca/menu.ts): si alguien cambia un rótulo del mapa, las
// pruebas lo notan en vez de seguirlo en silencio.
import { expect, type Locator, type Page } from '@playwright/test';

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

/** Abre el inicio (con `?desde=…` si se quiere entrar como lo hacen las migas de otra pantalla) y espera a que aparezca la tarjeta. */
export async function abrirInicio(page: Page, url = '/estudio/inicio/') {
  await page.goto(url);
  await expect(tarjeta(page)).toBeVisible();
}

// ---------------------------------------------------------------------------
// la tarjeta y sus partes

export const tarjeta = (page: Page): Locator => page.getByRole('region', { name: 'Irremplazables' });

/** El único `h2` a la vista de la tarjeta: «Elige un área», «Elige un grupo», el nombre del grupo o el de la caja. */
export const paso = (page: Page): Locator => tarjeta(page).getByRole('heading', { level: 2 });

export const migas = (page: Page): Locator => tarjeta(page).getByRole('navigation', { name: 'Dónde estás' });

/** Una ficha del mapa. El nombre accesible trae lo que tenga la ficha («Marketing Estás aquí», «Producto Próximamente»). */
export const ficha = (page: Page, area: string): Locator =>
  tarjeta(page).getByRole('group', { name: 'Áreas', exact: true }).getByRole('button', { name: new RegExp(`^${area}`) });

/** Una de las tres opciones de un área. */
export const opcion = (page: Page, area: string, grupo: string): Locator =>
  tarjeta(page).getByRole('group', { name: area, exact: true }).getByRole('button', { name: new RegExp(`^${grupo}`) });

/** «Volver a Video»: dice a dónde caerás. */
export const volverA = (page: Page, destino: string): Locator =>
  tarjeta(page).getByRole('button', { name: `Volver a ${destino}`, exact: true });

/** Los botones del riel de la caja (Imagen, Video, Edición). */
export const riel = (page: Page, familia: string): Locator =>
  page.getByRole('group', { name: 'Qué quieres crear' }).getByRole('button', { name: familia, exact: true });

// ---------------------------------------------------------------------------
// moverse por el recorrido

/** La miga del área abre el mapa. Sirve desde la caja, desde las opciones y desde la lista de un grupo. */
export async function irAlMapa(page: Page) {
  await migas(page).getByRole('button', { name: /^Volver al mapa/ }).click();
  await expect(paso(page)).toHaveText('Elige un área');
}

/** Del mapa al contenido de un grupo: la ficha del área y la tarjeta del grupo. */
export async function elegir(page: Page, area: string, grupo: string) {
  await ficha(page, area).click();
  await expect(paso(page)).toHaveText('Elige un grupo');
  await opcion(page, area, grupo).click();
}

/** Desde donde estés (la caja o una lista) hasta el contenido de un grupo, pasando por el mapa. */
export async function irA(page: Page, area: string, grupo: string) {
  await irAlMapa(page);
  await elegir(page, area, grupo);
}

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
  await page.route('**/api/editar/entrevista/costo', r =>
    r.fulfill({ json: { fuente: 'videos/entrevista/subidas/entrevista.mp4', duracion_s: 724, con_transcript: false, creditos: 8, backend_listo: true, aviso: null } }),
  );
}
