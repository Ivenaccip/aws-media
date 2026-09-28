// UI·25 — el punto del buzón sobre el boleto: llega con un rebote y suelta
// UNA onda cuando avisos_sin_leer sube; con el mismo número, quieto. Hoy el
// servidor no manda el campo (el buzón es UI·17): aquí se simula.
import { expect, test, type Page } from '@playwright/test';

import { animacionesVivas, arranques, oirArranques, olvidarArranques } from './pantallas';

async function conAvisos(page: Page, ...lista: Array<number | undefined>) {
  let i = 0;
  await page.route('**/api/creditos', r => {
    const avisos_sin_leer = lista[Math.min(i++, lista.length - 1)];
    return r.fulfill({ json: { activo: true, saldo: 120, tarifas: {}, packs: [], avisos_sin_leer } });
  });
}

const delPunto = async (page: Page) =>
  (await page.evaluate(animacionesVivas)).filter(a => a.objetivo.startsWith('span#mon-punto')).map(a => a.nombre);

test('sin el campo (el servidor de hoy) no hay punto', async ({ page }) => {
  await conAvisos(page, undefined);
  await page.goto('/estudio/estilos/');
  await expect(page.locator('#mon-real')).toHaveText('120 créditos ✦');
  await expect(page.locator('#mon-punto')).toBeHidden();
});

test('avisos nuevos: el punto llega y suelta una onda; con el mismo número no se repite', async ({ page }) => {
  // lo que arranca: la llegada dura 300 ms y una máquina cargada llega tarde a mirarla
  await oirArranques(page, /^mon-(punto-llega|onda)$/);
  await conAvisos(page, 2, 2, 3);
  await page.goto('/estudio/estilos/');
  const punto = page.locator('#mon-punto');
  await expect(punto).toBeVisible();
  await expect.poll(() => arranques(page)).toEqual(['mon-punto-llega 300', 'mon-onda 900']);
  await expect.poll(() => delPunto(page), { timeout: 3000 }).toEqual([]);
  await olvidarArranques(page);

  await page.evaluate(() => window.monedero!.refrescar()); // mismo número
  await page.waitForTimeout(700); // más que la espera de la onda (250 ms)
  expect(await arranques(page)).toEqual([]);

  await page.evaluate(() => window.monedero!.refrescar()); // uno más
  // ya estaba: no vuelve a crecer desde cero, solo la onda
  await expect.poll(() => arranques(page)).toEqual(['mon-onda 900']);
});

test('el punto no tapa la píldora ni se encima con ella', async ({ page }) => {
  await conAvisos(page, 1);
  await page.goto('/estudio/estilos/');
  await expect(page.locator('#mon-punto')).toBeVisible();
  const [p, pill] = await Promise.all([page.locator('#mon-punto').boundingBox(), page.locator('#mon-pill').boundingBox()]);
  expect(p!.x + p!.width).toBeLessThanOrEqual(pill!.x);
});

test.describe('con «reducir movimiento»', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('el punto aparece quieto', async ({ page }) => {
    await conAvisos(page, 2);
    await page.goto('/estudio/estilos/');
    await expect(page.locator('#mon-punto')).toBeVisible();
    expect(await delPunto(page)).toEqual([]);
  });
});
