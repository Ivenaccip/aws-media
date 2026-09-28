// UI·18 — el guardián de «reducir movimiento». Con la preferencia del sistema
// encendida, ninguna de las 12 pantallas deja algo moviéndose: ni mientras
// carga, ni lo que pinta después. Lo apaga todo la regla global de
// tokens.css; esta prueba existe para que nadie la rompa, y para cazar lo que
// esa regla no alcanza (Element.animate() de JS).
//
// Las pruebas de cada tarjeta de movimiento (UI·19 a UI·25) repiten esto en
// sus propios estados: un diálogo abierto, una lista que crece, etc.
import { expect, test, type Page } from '@playwright/test';

import { animacionesVivas, PANTALLAS } from './pantallas';

// una sonda que gira para siempre, con la clase de Tailwind que ya usa la app
async function sonda(page: Page) {
  await page.evaluate(() => {
    const s = document.createElement('div');
    s.className = 'animate-spin';
    s.id = 'sonda';
    s.style.cssText = 'width:10px;height:10px';
    document.body.append(s);
  });
  await page.waitForTimeout(100);
}

test.describe('con «reducir movimiento»', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  for (const pantalla of PANTALLAS) {
    test(`${pantalla}: mientras carga, nada se mueve`, async ({ page }) => {
      // la API de la pantalla no contesta nunca: se queda cargando
      await page.route(/\/api\/(?!auth\/config$|creditos$)/, () => {});
      await page.goto(`/estudio/${pantalla}/`);
      await page.locator('#raiz > *').first().waitFor();
      await page.waitForTimeout(400);
      expect(await page.evaluate(animacionesVivas)).toEqual([]);
    });

    test(`${pantalla}: ya cargada, nada se mueve`, async ({ page }) => {
      await page.goto(`/estudio/${pantalla}/`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(400);
      expect(await page.evaluate(animacionesVivas)).toEqual([]);
    });

    test(`${pantalla}: la regla global está y detiene lo infinito`, async ({ page }) => {
      await page.goto(`/estudio/${pantalla}/`);
      await page.locator('#raiz > *').first().waitFor();
      await sonda(page);
      expect(await page.evaluate(animacionesVivas)).toEqual([]);
    });
  }
});

// El control: sin la preferencia, la misma sonda SÍ se mueve. Si esto
// fallara, el guardián de arriba estaría pasando sin mirar nada.
test('sin «reducir movimiento», la sonda gira (el guardián sí ve)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/estudio/inicio/');
  await page.locator('#raiz > *').first().waitFor();
  await sonda(page);
  expect((await page.evaluate(animacionesVivas)).map(a => a.objetivo)).toContain('div#sonda.animate-spin');
});
