// UI·18 — entre pantallas de web/ hay View Transition: el resto se funde, la
// píldora del saldo se queda quieta y la miniatura que tocaste en el inicio
// se agranda hasta el reproductor de su película.
import { expect, test, type Page } from '@playwright/test';

import { MINIATURA_SVG, PELICULA } from './datos';
import { abrirInicio, abrirLaCaja, ficha, paso, URL_MAPA, URL_MARKETING } from './recorrido';

// Lo que vio cada documento al revelarse: si hubo transición y qué grupos
// armó el navegador (::view-transition-old/new(<nombre>)).
declare global {
  interface Window {
    __vt?: { hubo: boolean; grupos: string[]; duro?: number };
  }
}

async function espiarTransiciones(page: Page) {
  await page.addInitScript(() => {
    addEventListener('pagereveal', e => {
      const vt = (e as Event & { viewTransition?: ViewTransition | null }).viewTransition;
      const inicio = performance.now();
      window.__vt = { hubo: !!vt, grupos: [] };
      void vt?.finished.then(() => (window.__vt!.duro = performance.now() - inicio));
      void vt?.ready.then(() => {
        window.__vt!.grupos = document.getAnimations()
          .map(a => (a.effect as KeyframeEffect | null)?.pseudoElement ?? '')
          .filter(Boolean);
      });
    });
  });
}

async function inicioConUnaPelicula(page: Page) {
  await page.route('**/api/proyectos', r => r.fulfill({ json: [
    { id: PELICULA.id, creado: '2026-09-20T10:00:00Z', estado: 'listo', brief: PELICULA.brief,
      archivado: false, miniatura: 'portada.jpg', miniatura_alt: null },
  ] }));
  await page.route(`**/api/proyectos/${PELICULA.id}`, r => r.fulfill({ json: PELICULA }));
  await page.route(/\/api\/proyectos\/[^/]+\/archivo\/.*\.jpg$/, r =>
    r.fulfill({ contentType: 'image/svg+xml', body: MINIATURA_SVG }));
}

test('inicio → película: la miniatura viaja y la píldora se queda quieta', async ({ page }) => {
  await espiarTransiciones(page);
  await inicioConUnaPelicula(page);
  // «Mis creaciones» se ve con la caja, que es una página con su dirección (…/distrito/video/)
  await abrirLaCaja(page);
  await expect(page.locator('#mon-saldo')).toHaveText('120 créditos ✦');
  await page.getByRole('link', { name: PELICULA.brief }).click();
  await page.waitForURL(`**/estudio/crear/?p=${PELICULA.id}`);
  await expect.poll(() => page.evaluate(() => window.__vt?.grupos.length ?? 0)).toBeGreaterThan(0);
  const vt = await page.evaluate(() => window.__vt!);
  expect(vt.hubo).toBe(true);
  // las dos pantallas tenían su miniatura y su píldora con el mismo nombre
  expect(vt.grupos).toEqual(expect.arrayContaining([
    '::view-transition-old(miniatura)', '::view-transition-new(miniatura)',
    '::view-transition-old(monedero)', '::view-transition-new(monedero)',
  ]));
  // la película contesta al instante, pero la miniatura no se quita hasta
  // que la transición termina: quitarla antes la corta en seco
  await expect.poll(() => page.evaluate(() => window.__vt?.duro ?? 0)).toBeGreaterThan(250);
  // y al terminar, la película se ve
  await expect(page.locator('video')).toBeVisible();
});

test('sin «reducir movimiento» hay transición; con él, no', async ({ browser }) => {
  for (const [preferencia, esperado] of [['no-preference', true], ['reduce', false]] as const) {
    const ctx = await browser.newContext({ reducedMotion: preferencia });
    const page = await ctx.newPage();
    await espiarTransiciones(page);
    await page.goto(URL_MAPA);
    await page.locator('#raiz > *').first().waitFor();
    await page.waitForTimeout(300);
    // la navegación la hace la página, como un clic: las que teclea el
    // usuario (o page.goto) nunca llevan transición
    await page.evaluate(() => { location.href = '/estudio/agenda/'; });
    await page.waitForURL('**/estudio/agenda/');
    await page.locator('#raiz > *').first().waitFor();
    expect(await page.evaluate(() => window.__vt?.hubo)).toBe(esperado);
    await ctx.close();
  }
});

test('entre dos niveles del recorrido también se funde: un clic en la ficha del mapa lleva transición (y con «reducir movimiento», no)', async ({ browser }) => {
  for (const [preferencia, esperado] of [['no-preference', true], ['reduce', false]] as const) {
    const ctx = await browser.newContext({ reducedMotion: preferencia });
    const page = await ctx.newPage();
    await espiarTransiciones(page);
    await abrirInicio(page);
    // como una persona: la página ya pintó antes del clic
    await page.waitForTimeout(300);
    await ficha(page, 'Marketing').click();
    await page.waitForURL(`**${URL_MARKETING}`);
    await expect(paso(page)).toHaveText('Elige un grupo');
    expect(await page.evaluate(() => window.__vt?.hubo), `a ${preferencia}`).toBe(esperado);
    await ctx.close();
  }
});

test('una película que no está lista no se agranda (no tiene reproductor)', async ({ page }) => {
  await espiarTransiciones(page);
  await page.route('**/api/proyectos', r => r.fulfill({ json: [
    { id: 'p2', creado: '2026-09-20T10:00:00Z', estado: 'revision', brief: 'Un gato en revisión',
      archivado: false, miniatura: 'portada.jpg', miniatura_alt: null },
  ] }));
  await page.route(/\/api\/proyectos\/[^/]+\/archivo\/.*\.jpg$/, r =>
    r.fulfill({ contentType: 'image/svg+xml', body: MINIATURA_SVG }));
  // «Mis creaciones» se ve con la caja a la vista
  await abrirLaCaja(page);
  await page.getByRole('link', { name: 'Un gato en revisión' }).click();
  await page.waitForURL('**/estudio/crear/?p=p2');
  await expect.poll(() => page.evaluate(() => window.__vt?.grupos.length ?? 0)).toBeGreaterThan(0);
  const vt = await page.evaluate(() => window.__vt!);
  expect(vt.grupos.some(g => g.includes('(miniatura)'))).toBe(false);
});

test('entre una pantalla nueva y una vieja también se funde (carta.css pide lo mismo)', async ({ page }) => {
  await espiarTransiciones(page);
  // el inicio viejo (static/index.html) solo se sirve con la cookie `ui=clasica`: sin ella el servidor lo manda a /estudio/ (etapa `todos`),
  // como las demás viejas mandan a las nuevas
  await page.goto(URL_MAPA);
  await page.context().addCookies([{ name: 'ui', value: 'clasica', domain: new URL(page.url()).hostname, path: '/' }]);
  await page.locator('#raiz > *').first().waitFor();
  // como una persona: la página ya pintó antes del clic. Navegar en el
  // mismo instante en que carga no deja nada que fotografiar
  await page.waitForTimeout(300);
  // Ojo: una vieja que
  // corra un <script> ANTES de carta.css (hoy solo la portada pública) a
  // veces se fotografía antes de saber que pide el fundido
  await page.evaluate(() => { location.href = '/index.html'; });
  await page.waitForURL('**/index.html');
  await expect.poll(() => page.evaluate(() => window.__vt?.hubo ?? null)).toBe(true);
  // y lo pide solo sin «reducir movimiento»
  expect(await page.evaluate(() =>
    [...document.styleSheets].some(h => [...h.cssRules].some(r =>
      r instanceof CSSMediaRule && r.conditionText.includes('prefers-reduced-motion: no-preference') &&
      r.cssText.includes('@view-transition'))),
  )).toBe(true);
});
