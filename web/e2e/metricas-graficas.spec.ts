// UI·23 — las gráficas de Métricas se dibujan al llegar: la primera vez que
// una entra en pantalla, sus barras crecen desde la base (500 ms, 50 ms entre
// una y otra) y la cifra de cada barra asoma al final. Una sola vez, y con
// «reducir movimiento», nunca. Aquí en un navegador de verdad: jsdom no anima
// ni tiene IntersectionObserver.
import { expect, test, type Page } from '@playwright/test';

import { TRAMO_METRICAS } from './datos';
import { animacionesVivas } from './pantallas';

// solo las de la gráfica: el resto de la pantalla no viene al caso
const DE_LA_GRAFICA = /^(barra-crece|cifra-asoma) /;
const vivas = async (page: Page) =>
  (await page.evaluate(animacionesVivas)).map(a => `${a.nombre} ${a.duracion}`).filter(n => DE_LA_GRAFICA.test(n));

const tarjeta = (page: Page, red: string) => page.locator('li').filter({ has: page.locator('b', { hasText: new RegExp(`^${red}$`) }) });
const grafica = (page: Page, red: string) => tarjeta(page, red).locator('[data-grafica]');
const marcada = (page: Page, red: string) => grafica(page, red).evaluate(g => g.hasAttribute('data-entra'));

async function abrirMetricas(page: Page) {
  await page.route('**/api/metricas', r => r.fulfill({ json: TRAMO_METRICAS }));
  await page.goto('/estudio/metricas/');
  await tarjeta(page, 'Instagram').waitFor();
}

// lo que tiene la barra y la cifra de cada columna, ahora mismo
const columnas = (page: Page, red: string) =>
  grafica(page, red).evaluate(g =>
    [...g.querySelectorAll('[data-barra]')].map(c => ({
      escala: getComputedStyle(c.firstElementChild!).scale,
      opacidad: getComputedStyle(c.lastElementChild!).opacity,
    })),
  );

test.describe('sin preferencia de movimiento', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' }, viewport: { width: 1440, height: 900 } });

  test('al abrirla ya a la vista, el primer cuadro es el del arranque (sin destello)', async ({ page }) => {
    await abrirMetricas(page);
    // el clic y la lectura en el MISMO cuadro: si la marca llegara tarde se
    // vería completa un instante y luego vacía
    const primerCuadro = await tarjeta(page, 'Instagram').evaluate(
      li =>
        new Promise(listo => {
          const b = [...li.querySelectorAll('button')].find(x => x.textContent === 'Ver el resto')!;
          b.click();
          requestAnimationFrame(() => {
            const g = li.querySelector('[data-grafica]')!;
            const c = g.querySelector('[data-barra]')!;
            listo({
              entra: g.hasAttribute('data-entra'),
              escala: getComputedStyle(c.firstElementChild!).scale,
              opacidad: getComputedStyle(c.lastElementChild!).opacity,
            });
          });
        }),
    );
    expect(primerCuadro).toEqual({ entra: true, escala: '1 0', opacidad: '0' });
  });

  test('crecen 500 ms, 50 ms una detrás de otra, y cada cifra asoma al final de su barra', async ({ page }) => {
    await abrirMetricas(page);
    await tarjeta(page, 'Instagram').getByRole('button', { name: 'Ver el resto' }).click();
    const tiempos = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a): a is CSSAnimation => 'animationName' in a)
        .filter(a => ['barra-crece', 'cifra-asoma'].includes(a.animationName))
        // el retraso sale de un calc() en segundos: 3 × 0.05 s no da 150 exactos
        .map(a => ({
          nombre: a.animationName,
          duracion: Math.round(Number(a.effect!.getTiming().duration)),
          retraso: Math.round(a.effect!.getTiming().delay ?? 0),
        }))
        .sort((x, y) => x.nombre.localeCompare(y.nombre) || x.retraso - y.retraso),
    );
    const barras = [0, 1, 2, 3, 4, 5].map(i => ({ nombre: 'barra-crece', duracion: 500, retraso: i * 50 }));
    const cifras = [0, 1, 2, 3, 4, 5].map(i => ({ nombre: 'cifra-asoma', duracion: 250, retraso: 500 + i * 50 }));
    expect(tiempos).toEqual([...barras, ...cifras]);
    // al acabar la última cifra la marca se va y todo queda en su sitio
    await expect.poll(() => marcada(page, 'Instagram'), { timeout: 3000 }).toBe(false);
    expect(await vivas(page)).toEqual([]);
    for (const c of await columnas(page, 'Instagram')) expect(c).toEqual({ escala: 'none', opacidad: '1' });
  });

  test('solo la primera vez: ni al cerrar y abrir, ni en «Las más vistas»', async ({ page }) => {
    await abrirMetricas(page);
    const li = tarjeta(page, 'Instagram');
    await li.getByRole('button', { name: 'Ver el resto' }).click();
    await expect.poll(() => marcada(page, 'Instagram'), { timeout: 3000 }).toBe(false);
    await li.getByRole('button', { name: 'Ocultar el resto' }).click();
    await li.getByRole('button', { name: 'Ver el resto' }).click();
    expect(await marcada(page, 'Instagram')).toBe(false);
    expect(await vivas(page)).toEqual([]);
    // la misma publicación en la otra lista: ya se vio
    await page.getByRole('button', { name: 'Las más vistas' }).click();
    await expect(grafica(page, 'Instagram')).toBeVisible();
    expect(await marcada(page, 'Instagram')).toBe(false);
    expect(await vivas(page)).toEqual([]);
  });
});

test.describe('en un teléfono', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' }, viewport: { width: 390, height: 640 } });

  test('la que queda bajo el pliegue espera al scroll, y al volver no se repite', async ({ page }) => {
    await abrirMetricas(page);
    // el botón abajo del todo: el detalle largo deja la gráfica fuera de la vista
    await tarjeta(page, 'TikTok').evaluate(li => {
      const b = [...li.querySelectorAll('button')].find(x => x.textContent === 'Ver el resto')!;
      b.scrollIntoView({ block: 'end' });
      b.click();
    });
    await expect(grafica(page, 'TikTok')).toBeAttached();
    await page.waitForTimeout(300);
    expect(await marcada(page, 'TikTok')).toBe(false);
    expect(await vivas(page)).toEqual([]);
    // llega con el scroll: ahora sí
    await grafica(page, 'TikTok').scrollIntoViewIfNeeded();
    await expect.poll(() => vivas(page)).toContain('barra-crece 500');
    await expect.poll(() => marcada(page, 'TikTok'), { timeout: 3000 }).toBe(false);
    // se va y vuelve: ya está dibujada
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);
    await grafica(page, 'TikTok').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    expect(await marcada(page, 'TikTok')).toBe(false);
    expect(await vivas(page)).toEqual([]);
  });

  for (const [red, columnas] of [['Instagram', 6], ['YouTube', 5]] as const) {
    test(`${red}: cabe, sin rodar de lado y sin que una cifra o una fecha pise a la de al lado`, async ({ page }) => {
      await abrirMetricas(page);
      await tarjeta(page, red).getByRole('button', { name: 'Ver el resto' }).click();
      await grafica(page, red).scrollIntoViewIfNeeded();
      await expect.poll(() => marcada(page, red), { timeout: 3000 }).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      // lo que ocupa el TEXTO (la caja de la fecha es la columna entera)
      const filas = await grafica(page, red).evaluate(g =>
        [g.querySelectorAll('[data-barra] > :last-child'), g.querySelectorAll('[data-fechas] > *')].map(l =>
          [...l].map(c => {
            const rango = document.createRange();
            rango.selectNodeContents(c);
            const r = rango.getBoundingClientRect();
            return { izq: r.left, der: r.right };
          }),
        ),
      );
      const caja = await tarjeta(page, red).evaluate(li => {
        const r = li.getBoundingClientRect();
        return { izq: r.left, der: r.right };
      });
      for (const fila of filas) {
        expect(fila).toHaveLength(columnas);
        for (let i = 1; i < fila.length; i++) expect(fila[i]!.izq).toBeGreaterThanOrEqual(fila[i - 1]!.der);
        expect(fila[0]!.izq).toBeGreaterThanOrEqual(caja.izq);
        expect(fila[fila.length - 1]!.der).toBeLessThanOrEqual(caja.der);
      }
    });
  }
});

test.describe('con «reducir movimiento»', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('no se anima: completa desde el primer cuadro', async ({ page }) => {
    await abrirMetricas(page);
    await tarjeta(page, 'Instagram').getByRole('button', { name: 'Ver el resto' }).click();
    await expect(grafica(page, 'Instagram')).toBeVisible();
    expect(await marcada(page, 'Instagram')).toBe(false);
    expect(await vivas(page)).toEqual([]);
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
    for (const c of await columnas(page, 'Instagram')) expect(c).toEqual({ escala: 'none', opacidad: '1' });
  });
});
