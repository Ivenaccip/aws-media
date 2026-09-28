// UI·19 — el saldo rueda después de un cobro, la píldora se tiñe y un «−N»
// vuela del botón que cobró. Aquí en un navegador de verdad: jsdom no anima
// ni interpola la propiedad registrada.
import { expect, test, type Page } from '@playwright/test';

import { animacionesVivas, arranques, congelarArranques, oirArranques } from './pantallas';

// /api/creditos va contestando los saldos de la lista, uno por petición (el
// último se repite)
async function saldos(page: Page, ...lista: number[]) {
  let i = 0;
  await page.route('**/api/creditos', r => {
    const saldo = lista[Math.min(i++, lista.length - 1)];
    return r.fulfill({ json: { activo: true, saldo, tarifas: {}, packs: [] } });
  });
}

const cifra = (page: Page) =>
  page.evaluate(() => Number(getComputedStyle(document.querySelector('#mon-cifra')!).getPropertyValue('--mon-saldo')));

async function estilosConCobro(page: Page, respuesta: { status: number; json: unknown }) {
  await page.route('**/api/estilo', r => r.fulfill({ json: { estilos: [], creditos: 7 } }));
  await page.route('**/api/estilo/analizar', r => r.fulfill(respuesta));
  await page.goto('/estudio/estilos/');
  await page.getByPlaceholder(/instagram/).fill('https://www.instagram.com/reel/abc');
}

test('la primera carga no rueda ni se tiñe', async ({ page }) => {
  await saldos(page, 120);
  await page.goto('/estudio/estilos/');
  await expect(page.locator('#mon-real')).toHaveText('120 créditos ✦');
  await page.waitForTimeout(100);
  const vivas = (await page.evaluate(animacionesVivas)).map(a => a.nombre);
  expect(vivas).not.toContain('transición de --mon-saldo');
  expect(vivas).not.toContain('mon-tinte');
  expect(await cifra(page)).toBe(120);
});

test('un saldo menor rueda hasta el nuevo, tiñe la píldora y lo anuncia', async ({ page }) => {
  // lo que arranca; y el número se queda en su primer cuadro para medirlo a
  // media rodada sin carreras con una máquina lenta
  await oirArranques(page, /^(transición de --mon-saldo|mon-tinte)$/);
  await saldos(page, 120, 90);
  await page.goto('/estudio/estilos/');
  await expect(page.locator('#mon-real')).toHaveText('120 créditos ✦');
  await congelarArranques(page, 'transición de --mon-saldo');
  await page.evaluate(() => window.monedero!.refrescar());
  await expect(page.locator('#mon-aviso')).toHaveText('Tu saldo: 90 créditos');
  await expect.poll(() => arranques(page)).toEqual(expect.arrayContaining(['transición de --mon-saldo 700', 'mon-tinte 900']));
  const aMedias = await page.evaluate(() => {
    const c = document.querySelector('#mon-cifra')!;
    const t = c.getAnimations().find(a => (a as CSSTransition).transitionProperty === '--mon-saldo')!;
    t.currentTime = 250;
    const v = Number(getComputedStyle(c).getPropertyValue('--mon-saldo'));
    t.finish();
    return v;
  });
  expect(aMedias).toBeGreaterThan(90);
  expect(aMedias).toBeLessThan(120);
  await expect.poll(() => cifra(page)).toBe(90);
  await expect(page.locator('#mon-real')).toHaveText('90 créditos ✦');
  await expect.poll(() => page.evaluate(animacionesVivas)).toEqual([]);
});

test('Estilos cobra: vuela «−7» del botón a la píldora y el saldo baja', async ({ page }) => {
  await oirArranques(page, /^mon-vuela$/);
  await saldos(page, 120, 113);
  await estilosConCobro(page, { status: 200, json: { lanzado: true, id: 'e1', creditos: 7 } });
  await expect(page.locator('#mon-real')).toHaveText('120 créditos ✦');
  await page.getByRole('button', { name: 'Analizar ✦ 7' }).click();
  const vuelo = page.locator('.mon-vuelo');
  await expect(vuelo).toHaveText('−7');
  await expect(vuelo).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(() => arranques(page)).toEqual(['mon-vuela 600']);
  await expect(vuelo).toHaveCount(0);
  await expect.poll(() => cifra(page)).toBe(113);
});

test('un cobro que falla (402) no vuela nada y el saldo se queda', async ({ page }) => {
  await saldos(page, 120);
  await estilosConCobro(page, { status: 402, json: { detail: 'Te faltan créditos.' } });
  await expect(page.locator('#mon-real')).toHaveText('120 créditos ✦');
  // cuenta cada «−N» que llegue a existir, aunque dure 600 ms
  await page.evaluate(() => {
    const w = window as unknown as { vuelos: number };
    w.vuelos = 0;
    new MutationObserver(ms => {
      for (const m of ms) for (const n of m.addedNodes) if (n instanceof Element && n.matches('.mon-vuelo')) w.vuelos++;
    }).observe(document.body, { childList: true });
  });
  await page.getByRole('button', { name: 'Analizar ✦ 7' }).click();
  await expect(page.getByText('Te faltan créditos.')).toBeVisible();
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => (window as unknown as { vuelos: number }).vuelos)).toBe(0);
  expect(await cifra(page)).toBe(120);
});

test.describe('con «reducir movimiento»', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('el número cambia de una vez, se anuncia igual y nada vuela', async ({ page }) => {
    await saldos(page, 120, 113);
    await estilosConCobro(page, { status: 200, json: { lanzado: true, id: 'e1', creditos: 7 } });
    await expect(page.locator('#mon-real')).toHaveText('120 créditos ✦');
    await page.getByRole('button', { name: 'Analizar ✦ 7' }).click();
    await expect(page.locator('#mon-aviso')).toHaveText('Tu saldo: 113 créditos');
    expect(await cifra(page)).toBe(113);
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
    expect(await page.locator('.mon-vuelo').count()).toBe(0);
  });
});

test('sin CSS.registerProperty el número cambia de golpe, como antes', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(CSS, 'registerProperty', { value: undefined });
  });
  await saldos(page, 120, 90);
  await page.goto('/estudio/estilos/');
  await expect(page.locator('#mon-real')).toHaveText('120 créditos ✦');
  await page.evaluate(() => window.monedero!.refrescar());
  await expect(page.locator('#mon-aviso')).toHaveText('Tu saldo: 90 créditos');
  expect(await cifra(page)).toBe(90);
  // el texto que se ve también es el nuevo (counter() de una variable sin registrar)
  expect((await page.evaluate(animacionesVivas)).map(a => a.nombre)).not.toContain('transición de --mon-saldo');
});

test('con sesión y sin saldo todavía, la píldora no dice «0 créditos»', async ({ page }) => {
  await page.route('**/api/auth/config', r => r.fulfill({ json: { activo: true, dominio: 'x', client_id: 'y' } }));
  await page.route('**/api/creditos', () => {}); // no contesta
  await page.goto('/estudio/estilos/');
  await page.locator('#raiz > *').first().waitFor();
  await page.waitForTimeout(300);
  await expect(page.locator('#mon-pill')).toBeHidden();
  await expect(page.locator('#mon-avatar')).toBeVisible();
});
