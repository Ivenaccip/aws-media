// UI·18 — el guardián de «reducir movimiento». Con la preferencia del sistema
// encendida, ninguna de las 12 pantallas deja algo moviéndose: ni mientras
// carga, ni lo que pinta después. Lo apaga todo la regla global de
// tokens.css; esta prueba existe para que nadie la rompa, y para cazar lo que
// esa regla no alcanza (Element.animate() de JS).
//
// Las pruebas de cada tarjeta de movimiento (UI·19 a UI·25) repiten esto en
// sus propios estados: un diálogo abierto, una lista que crece, etc.
//
// Lo que rota con un RELOJ (la pista del campo de Edición en el inicio, 14-oct-2026) no lo
// alcanza la regla global —que solo acorta animaciones y transiciones de CSS— ni
// `animacionesVivas` —que no ve las transiciones del `::placeholder`—: quien corre el
// reloj tiene que preguntar por la preferencia, y la prueba de abajo lo vigila.
import { expect, test, type Locator, type Page } from '@playwright/test';

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

// ---- la pista que rota en el campo de Edición del inicio (14-oct-2026) ----
// La pantalla «inicio» arranca en Video: la rotación vive en la pestaña Edición, que las pruebas de arriba no abren. El
// reloj de la pantalla es el falso de Playwright (quieto hasta que se mueve) para no esperar los segundos de verdad.
const IDEA_PRIMERA = 'Cuéntale a la IA qué quieres. Ejemplo: «Quita muletillas y silencios»';
const IDEA_SEGUNDA = 'Cuéntale a la IA qué quieres. Ejemplo: «Un short vertical para Reels»';
const IDEA_TERCERA = 'Cuéntale a la IA qué quieres. Ejemplo: «Resumen de 60 segundos»';

async function abrirEdicion(page: Page) {
  const vacias: Record<string, unknown> = {
    '**/api/proyectos': [],
    '**/api/slots': { slots: null, activos: 0 },
    '**/api/imagenes': { total: 0, imagenes: [] },
    '**/api/edicion/proyectos': [],
    '**/api/clip': { clips: [] },
    '**/api/trabajos': { trabajos: [], sondeo_s: 15 },
  };
  await page.clock.install({ time: 0 });
  for (const [ruta, json] of Object.entries(vacias)) await page.route(ruta, r => r.fulfill({ json }));
  await page.goto('/estudio/inicio/');
  await page.clock.pauseAt(1000);
  await page.getByRole('group', { name: 'Qué quieres crear' }).getByRole('button', { name: 'Edición' }).click();
  const campo = page.getByRole('textbox', { name: 'Cuéntale a la IA qué quieres' });
  await campo.waitFor();
  return campo;
}

const pista = (campo: Locator) =>
  campo.evaluate(e => {
    const c = getComputedStyle(e, '::placeholder');
    return { texto: e.getAttribute('placeholder'), opacidad: c.opacity, transicion: c.transitionProperty };
  });

test.describe('la pista de Edición con «reducir movimiento»', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('queda fija en la primera idea: ni rota ni se funde, por mucho que pase el tiempo', async ({ page }) => {
    const campo = await abrirEdicion(page);
    expect(await pista(campo)).toEqual({ texto: IDEA_PRIMERA, opacidad: '1', transicion: 'none' });
    for (let i = 0; i < 6; i++) {
      await page.clock.runFor(10_000);
      await page.waitForTimeout(40);
      expect(await pista(campo), `a los ${(i + 1) * 10} s`).toEqual({ texto: IDEA_PRIMERA, opacidad: '1', transicion: 'none' });
    }
  });
});

// El control: sin la preferencia, la misma pantalla SÍ rota. Si esto fallara, el guardián de arriba estaría pasando sin mirar nada.
test('sin «reducir movimiento», la pista de Edición sí rota (el guardián sí ve)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const campo = await abrirEdicion(page);
  expect((await pista(campo)).texto).toBe(IDEA_PRIMERA);
  await page.clock.runFor(3750);
  await page.waitForTimeout(40);
  await page.clock.runFor(250);
  await page.waitForTimeout(40);
  expect(await pista(campo)).toMatchObject({ texto: IDEA_SEGUNDA, transicion: 'opacity' });
});

// Y reacciona si la persona cambia la preferencia con la pantalla abierta
test('si se enciende «reducir movimiento» con la pantalla abierta, la pista vuelve a la primera y se queda quieta', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const campo = await abrirEdicion(page);
  await page.clock.runFor(3750);
  await page.waitForTimeout(40);
  await page.clock.runFor(250);
  await page.waitForTimeout(40);
  expect((await pista(campo)).texto).toBe(IDEA_SEGUNDA);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(async () => (await pista(campo)).texto).toBe(IDEA_PRIMERA);
  for (let i = 0; i < 3; i++) {
    await page.clock.runFor(10_000);
    await page.waitForTimeout(40);
  }
  expect(await pista(campo)).toEqual({ texto: IDEA_PRIMERA, opacidad: '1', transicion: 'none' });
});

// Y al apagarla con la pantalla abierta (el sentido que faltaba): la pista sigue en la primera, entera, y rota desde ahí con su
// intervalo completo; no salta de golpe, sin fundido, a la idea que traía guardada la rotación. Con el campo enfocado la
// rotación ya estaba parada (`rota` falso antes y después), y ahí el salto también se vería bajo el cursor.
async function unaIdeaMas(page: Page) {
  await page.clock.runFor(3750);
  await page.waitForTimeout(40);
  await page.clock.runFor(250);
  await page.waitForTimeout(40);
}

test('si se apaga «reducir movimiento» con la pantalla abierta, la pista sigue en la primera y rota desde ahí', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const campo = await abrirEdicion(page);
  await unaIdeaMas(page);
  expect((await pista(campo)).texto).toBe(IDEA_SEGUNDA);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(async () => (await pista(campo)).texto).toBe(IDEA_PRIMERA);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // tiempo REAL (el reloj de la pantalla es el falso): el salto, de haberlo, es inmediato
  await page.waitForTimeout(300);
  expect(await pista(campo)).toMatchObject({ texto: IDEA_PRIMERA, opacidad: '1' });
  // rota con su intervalo completo: a los 3.7 s sigue la primera (entera), y a los 4 s ya es la segunda. (El temporizador del
  // fundido lo arma un efecto de React, que no corre con el reloj falso: de ahí la espera corta entre un paso y otro)
  await page.clock.runFor(3700);
  await page.waitForTimeout(40);
  expect(await pista(campo)).toMatchObject({ texto: IDEA_PRIMERA, opacidad: '1' });
  await page.clock.runFor(50);
  await page.waitForTimeout(40);
  await page.clock.runFor(250);
  await page.waitForTimeout(40);
  expect((await pista(campo)).texto).toBe(IDEA_SEGUNDA);
});

test('si se enciende y se apaga «reducir movimiento» con el campo enfocado, la pista sigue en la primera, quieta', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const campo = await abrirEdicion(page);
  await unaIdeaMas(page);
  await unaIdeaMas(page);
  expect((await pista(campo)).texto).toBe(IDEA_TERCERA);
  await campo.focus();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(async () => (await pista(campo)).texto).toBe(IDEA_PRIMERA);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(300);
  expect(await pista(campo)).toMatchObject({ texto: IDEA_PRIMERA, opacidad: '1' });
  // sigue quieta bajo el cursor por mucho que pase el tiempo...
  for (let i = 0; i < 3; i++) {
    await page.clock.runFor(10_000);
    await page.waitForTimeout(40);
  }
  expect(await pista(campo)).toMatchObject({ texto: IDEA_PRIMERA, opacidad: '1' });
  // ...y al soltar el foco con el campo vacío rota desde la primera
  await campo.evaluate(e => e.blur());
  await page.waitForTimeout(300);
  await unaIdeaMas(page);
  expect((await pista(campo)).texto).toBe(IDEA_SEGUNDA);
});
