// UI·25 — el punto del buzón sobre el boleto: llega con un rebote y suelta
// UNA onda cuando avisos_sin_leer sube; con el mismo número, quieto. Hoy el
// servidor no manda el campo (el buzón es UI·17): aquí se simula.
import { expect, test, type Page } from '@playwright/test';

import { animacionesVivas } from './pantallas';

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
  await conAvisos(page, 2, 2, 3);
  await page.goto('/estudio/estilos/');
  const punto = page.locator('#mon-punto');
  await expect(punto).toBeVisible();
  expect(await delPunto(page)).toEqual(expect.arrayContaining(['mon-punto-llega', 'mon-onda']));
  await expect.poll(() => delPunto(page), { timeout: 3000 }).toEqual([]);

  await page.evaluate(() => window.monedero!.refrescar()); // mismo número
  await page.waitForTimeout(400);
  expect(await delPunto(page)).toEqual([]);

  await page.evaluate(() => window.monedero!.refrescar()); // uno más
  await expect.poll(() => delPunto(page)).toContain('mon-onda');
  // ya estaba: no vuelve a crecer desde cero
  expect(await delPunto(page)).not.toContain('mon-punto-llega');
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
