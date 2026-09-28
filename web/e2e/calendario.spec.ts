// UI·22 — el calendario de Mix tiene dirección: «Mes siguiente» saca la
// rejilla por la izquierda y mete la nueva por la derecha; «Mes anterior», al
// revés. Con «reducir movimiento», el mes cambia al instante.
import { expect, test, type Page } from '@playwright/test';

const hoy = new Date();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dia = (n: number) => {
  const d = new Date(hoy);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const nombre = (desplazamiento: number) => {
  const t = new Date(hoy.getFullYear(), hoy.getMonth() + desplazamiento, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// MIX sin campaña: el formulario con el calendario
async function mixVacio(page: Page) {
  await page.route(/\/api\/mix$/, r =>
    r.fulfill({
      json: {
        campana: null, corridas: [], saldo: 120, tarifa: 5, tonos: ['vender', 'informar', 'recordar'],
        atajos: { '3 días': 3, '1 semana': 7 }, max_dias: 60, tiene_blotato: true, devolucion: 0,
        ultima: { empieza: dia(-20), termina: dia(-6), estado: 'terminada', salieron: 14, creditos_devueltos: 0 },
      },
    }),
  );
  await page.route('**/api/mix/cuentas', r =>
    r.fulfill({ json: { cuentas: [{ id: 'c1', platform: 'instagram', username: 'cafe.de.barrio' }], fuera: [] } }),
  );
  await page.goto('/estudio/mix/');
  await page.getByRole('button', { name: 'Mes siguiente' }).waitFor();
}

// qué pseudo-elementos anima el navegador ahora mismo, con qué keyframes
const animando = (page: Page) =>
  page.evaluate(() =>
    document.getAnimations().map(a => {
      const e = a.effect as KeyframeEffect | null;
      return `${e?.pseudoElement ?? ''} ${'animationName' in a ? String(a.animationName) : ''}`.trim();
    }),
  );

const mesALaVista = (page: Page) => page.locator('[data-cal="mes-0"]').textContent();

test('«Mes siguiente» sale por la izquierda y entra por la derecha; «Mes anterior», al revés', async ({ page }) => {
  await mixVacio(page);
  await page.waitForTimeout(300);
  expect(await mesALaVista(page)).toBe(nombre(0));

  await page.getByRole('button', { name: 'Mes siguiente' }).click();
  await expect.poll(() => animando(page)).toEqual(expect.arrayContaining([
    '::view-transition-old(cal-dias-0) cal-sale-izq',
    '::view-transition-new(cal-dias-0) cal-entra-der',
  ]));
  // el encabezado solo se funde: no se desliza
  const conMes = (await animando(page)).filter(a => a.includes('(cal-mes-0)'));
  expect(conMes.some(a => /cal-(sale|entra)/.test(a))).toBe(false);
  // la página no se fotografía entera: solo el calendario vuela
  expect((await animando(page)).some(a => a.includes('(root)'))).toBe(false);
  await expect.poll(() => mesALaVista(page)).toBe(nombre(1));
  await expect(page.locator('p[aria-live="polite"]').filter({ hasText: nombre(1) })).toHaveCount(1);
  await expect.poll(() => animando(page)).toEqual([]);

  await page.getByRole('button', { name: 'Mes anterior' }).click();
  await expect.poll(() => animando(page)).toEqual(expect.arrayContaining([
    '::view-transition-old(cal-dias-0) cal-sale-der',
    '::view-transition-new(cal-dias-0) cal-entra-izq',
  ]));
  await expect.poll(() => mesALaVista(page)).toBe(nombre(0));
});

test('dos clics rápidos en «Mes siguiente» avanzan dos meses', async ({ page }) => {
  await mixVacio(page);
  const siguiente = page.getByRole('button', { name: 'Mes siguiente' });
  await siguiente.click();
  await siguiente.click();
  await expect.poll(() => mesALaVista(page)).toBe(nombre(2));
});

test('en escritorio se ven dos meses y los dos viajan', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mixVacio(page);
  await page.getByRole('button', { name: 'Mes siguiente' }).click();
  await expect.poll(() => animando(page)).toEqual(expect.arrayContaining([
    '::view-transition-new(cal-dias-0) cal-entra-der',
    '::view-transition-new(cal-dias-1) cal-entra-der',
  ]));
});

test.describe('con «reducir movimiento»', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('el mes cambia al instante, sin transición, y se anuncia igual', async ({ page }) => {
    await mixVacio(page);
    await page.evaluate(() => {
      (window as unknown as { transiciones: number }).transiciones = 0;
      const original = document.startViewTransition.bind(document);
      document.startViewTransition = ((o: StartViewTransitionOptions) => {
        (window as unknown as { transiciones: number }).transiciones++;
        return original(o);
      }) as typeof document.startViewTransition;
    });
    await page.getByRole('button', { name: 'Mes siguiente' }).click();
    expect(await mesALaVista(page)).toBe(nombre(1));
    await expect(page.locator('p[aria-live="polite"]').filter({ hasText: nombre(1) })).toHaveCount(1);
    expect(await page.evaluate(() => (window as unknown as { transiciones: number }).transiciones)).toBe(0);
  });
});
