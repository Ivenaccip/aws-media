// «De videos a Shorts», el segundo modo de «Editar ▾» en la caja del inicio, en un navegador de verdad (lo que jsdom no ve):
//  · el chip abre sus dos opciones y elegir Shorts cambia el cuerpo (el campo de la liga, sin el cuadro de escritura);
//  · lo tocable mide al menos 44 px y nada se sale de la pantalla a 1100, 390 y 320 px;
//  · «Iniciar» sin nada avisa en el cuadro de abajo a la derecha (el real, static/trabajos.js) y sin ir a ningún lado;
//  · una liga que no es de YouTube se corrige junto al campo, sin navegar;
//  · con una liga de YouTube navega a /estudio/shorts/?url=… y esa pantalla (la de verdad, la de dist/) la deja escrita en
//    «Importar de YouTube» (puesta arriba, a la vista también en un teléfono), con el foco en «Cotizar», SIN pedir ni cotizar ni
//    importar nada por su cuenta.
// No gasta nada: el servidor y «S3» son rutas de mentira, y las de dinero de Shorts, de las que se vigila que NO se llamen.
import { expect, test, type Page } from '@playwright/test';

import { abrirLaCaja } from './recorrido';

const RESPUESTAS_VACIAS: Record<string, unknown> = {
  '**/api/proyectos': [],
  '**/api/slots': { slots: null, activos: 0 },
  '**/api/imagenes': { total: 0, imagenes: [] },
  '**/api/edicion/proyectos': [],
  '**/api/clip': { clips: [] },
  '**/api/trabajos': { trabajos: [], sondeo_s: 15 },
  '**/api/moderar': { permitido: true },
};
const LIGA = 'https://www.youtube.com/watch?v=abc123DEF45';

const chip = (page: Page) => page.locator('button[aria-haspopup="listbox"]');
const campoLiga = (page: Page) => page.getByRole('textbox', { name: 'Liga de YouTube' });
const iniciar = (page: Page) => page.getByRole('button', { name: 'Iniciar', exact: true });

/** La caja de Edición en el modo Shorts. Devuelve las peticiones de dinero de Shorts que salieron (deben ser ninguna). */
async function enShorts(page: Page) {
  const dinero: string[] = [];
  for (const [ruta, json] of Object.entries(RESPUESTAS_VACIAS)) await page.route(ruta, r => r.fulfill({ json }));
  await page.route('**/api/blotato**', r => r.fulfill({ status: 404, json: { detail: 'no' } }));
  await page.route('**/api/media/config', r => r.fulfill({ json: { activo: true, cdn: '' } }));
  await page.route('**/api/shorts/importar**', r => {
    dinero.push(`${r.request().method()} ${new URL(r.request().url()).pathname}`);
    return r.fulfill({ status: 500, json: { detail: 'no debía llamarse' } });
  });
  // el inicio abre en el mapa (dueño, 15-oct-2026): a la caja se llega por el camino de siempre, Marketing → Distrito
  await abrirLaCaja(page);
  await page.getByRole('group', { name: 'Qué quieres crear' }).getByRole('button', { name: 'Edición' }).click();
  await chip(page).click();
  await page.getByRole('option', { name: /De videos a Shorts/ }).click();
  await expect(campoLiga(page)).toBeVisible();
  return dinero;
}

for (const ancho of [1100, 390, 320]) {
  test.describe(`a ${ancho} px`, () => {
    test.use({ viewport: { width: ancho, height: 800 } });

    test('el chip lista Editar y De videos a Shorts, el cuerpo cambia, todo mide 44 px y nada se desborda', async ({ page }) => {
      await enShorts(page);
      await expect(chip(page)).toHaveText(/De videos a Shorts/);
      await expect(page.getByRole('textbox', { name: 'Cuéntale a la IA qué quieres' })).toHaveCount(0);
      for (const t of [campoLiga(page), chip(page), page.getByRole('button', { name: 'Agregar el video largo' }), iniciar(page)]) {
        const caja = (await t.boundingBox())!;
        expect(caja.height, 'área táctil').toBeGreaterThanOrEqual(44);
        expect(caja.x).toBeGreaterThanOrEqual(0);
        expect(caja.x + caja.width).toBeLessThanOrEqual(ancho);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      // la lista abierta, con las dos opciones, no se sale de la pantalla
      await chip(page).click();
      const lista = page.getByRole('listbox', { name: 'Opciones' });
      await expect(lista.getByRole('option')).toHaveCount(2);
      await expect(lista.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
      const cajaLista = (await lista.boundingBox())!;
      expect(cajaLista.x).toBeGreaterThanOrEqual(0);
      expect(cajaLista.x + cajaLista.width).toBeLessThanOrEqual(ancho);
      await page.keyboard.press('Escape');
      await expect(chip(page)).toBeFocused();
    });
  });
}

test('«Iniciar» sin liga avisa en el cuadro de abajo a la derecha y no navega; una liga que no es de YouTube se corrige junto al campo', async ({ page }) => {
  const dinero = await enShorts(page);
  // sigue ámbar (no el gris discontinuo) y, aun sin poder, enfocable
  await expect(iniciar(page)).toHaveAttribute('aria-disabled', 'true');
  await iniciar(page).click({ force: true });
  await expect(page.locator('#bandeja')).toContainText('Primero pega la liga de YouTube o agrega el video con el «+».');
  expect(new URL(page.url()).pathname).toBe('/estudio/inicio/');
  // una liga que no es de YouTube: el error va junto al campo y el campo lo dice; no se navega
  await campoLiga(page).fill('https://vimeo.com/123456789');
  await iniciar(page).click();
  await expect(page.getByText(/Esa no parece una liga de YouTube/)).toBeVisible();
  await expect(campoLiga(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(campoLiga(page)).toBeFocused();
  expect(new URL(page.url()).pathname).toBe('/estudio/inicio/');
  // escribir quita el error
  await campoLiga(page).press('Backspace');
  await expect(page.getByText(/Esa no parece una liga de YouTube/)).toHaveCount(0);
  expect(dinero).toEqual([]);
});

test('con una liga de YouTube, «Iniciar» (y Enter) navega a Shorts con la liga puesta en Importar y sin gastar nada', async ({ page }) => {
  const dinero = await enShorts(page);
  await campoLiga(page).fill(LIGA);
  await expect(iniciar(page)).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByText('Te llevamos a Shorts: ahí ves el precio antes de que se cobre algo.')).toBeVisible();
  await Promise.all([page.waitForURL(/\/estudio\/shorts\/\?url=/), campoLiga(page).press('Enter')]);
  expect(new URL(page.url()).searchParams.get('url')).toBe(LIGA);
  // la pantalla de Shorts de verdad: la liga ya escrita en «Importar de YouTube», el foco en «Cotizar» y ninguna petición de
  // dinero salió sola
  await expect(page.getByRole('heading', { name: 'Importar de YouTube' })).toBeVisible();
  await expect(campoLiga(page)).toHaveValue(LIGA);
  await expect(page.getByRole('button', { name: 'Cotizar' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Cotizar' })).toBeInViewport();
  await page.waitForTimeout(500);
  expect(dinero).toEqual([]);
});

test.describe('en el teléfono, la pantalla de Shorts trae a la vista la liga que llegó', () => {
  test.use({ viewport: { width: 390, height: 700 } });

  // «Importar» va arriba cuando la URL trae liga: como tercera tarjeta, la lista de proyectos y la subida (que cargan después y
  // empujan todo hacia abajo, algo que jsdom no mide) la dejaban bajo el pliegue aun con el foco puesto en «Cotizar»
  test('«Importar» queda visible, con la liga escrita y el foco en «Cotizar», sin bajar', async ({ page }) => {
    for (const [ruta, json] of Object.entries(RESPUESTAS_VACIAS)) await page.route(ruta, r => r.fulfill({ json }));
    await page.route('**/api/media/config', r => r.fulfill({ json: { activo: true, cdn: '' } }));
    await page.goto('/estudio/shorts/?url=' + encodeURIComponent(LIGA));
    await expect(page.getByRole('button', { name: 'Cotizar' })).toBeInViewport();
    await expect(campoLiga(page)).toBeInViewport();
    await expect(campoLiga(page)).toHaveValue(LIGA);
  });
});
