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
//
// El recorrido del inicio (15-oct-2026, «Mapa con Irremplazables»): el bucle de las pantallas de
// abajo ya cubre `inicio` (en la caja) y las cinco páginas hoja con sus migas; los pasos del
// recorrido (el mapa, las tres opciones, las listas) y la pista de Edición al abrir el mapa y
// volver tienen sus pruebas más abajo.
import { expect, test, type Locator, type Page } from '@playwright/test';

import { animacionesVivas, arranques, oirArranques, PANTALLAS } from './pantallas';
import { abrirInicio, irA, irAlMapa, simular, tarjeta, volverA } from './recorrido';

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

// ---- el recorrido del inicio (15-oct-2026): el mapa, las tres opciones y las listas de pantallas ----
// Los pasos del recorrido no los ve el bucle de arriba (que abre el inicio en la caja). Se recorre cada uno con «reducir movimiento»
// encendido y se pasa el ratón por TODO lo que se puede tocar: una ficha, una tarjeta o una miga que se animara al pasar el ratón
// aparecería aquí. Aparte, todo lo que ARRANCÓ en la página (animaciones y transiciones, con su duración) debe ser de 1 ms o menos.
const duracionDe = (arranque: string) => Number(arranque.split(' ').at(-1));

test.describe('el recorrido del inicio con «reducir movimiento»', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('el mapa, las opciones y las listas no dejan nada moviéndose, ni al pasar el ratón por cada ficha, tarjeta y miga', async ({ page }) => {
    await simular(page, { blotato: 'conectado' });
    await oirArranques(page, /./);
    await abrirInicio(page);
    const quieto = async (donde: string) => {
      await page.waitForTimeout(300);
      expect(await page.evaluate(animacionesVivas), `${donde}: algo se mueve`).toEqual([]);
      const tocables = tarjeta(page).locator('button:visible, a:visible');
      const cuantos = await tocables.count();
      expect(cuantos, `${donde}: no hay nada que tocar`).toBeGreaterThan(0);
      for (let i = 0; i < cuantos; i++) {
        await tocables.nth(i).hover();
        await page.waitForTimeout(60);
        expect(await page.evaluate(animacionesVivas), `${donde}: algo se mueve al pasar el ratón por el elemento ${i + 1}`).toEqual([]);
      }
    };
    await irAlMapa(page);
    await quieto('el mapa');
    await tarjeta(page).getByRole('group', { name: 'Áreas', exact: true }).getByRole('button', { name: /^Marketing/ }).click();
    await quieto('las opciones de Marketing');
    await tarjeta(page).getByRole('group', { name: 'Marketing', exact: true }).getByRole('button', { name: /^Blotato/ }).click();
    await quieto('la lista de Blotato');
    await irA(page, 'Central', 'Distrito');
    await quieto('la lista de Central');
    const largos = (await arranques(page)).filter(a => duracionDe(a) > 1);
    expect(largos, 'algo arrancó con duración real').toEqual([]);
  });
});

// El control: sin la preferencia, pasar el ratón por una tarjeta de la lista SÍ arranca una transición. Si esto fallara, el guardián
// de arriba estaría pasando sin mirar nada.
test('sin «reducir movimiento», pasar el ratón por una tarjeta de la lista arranca una transición (el guardián sí ve)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await simular(page, { blotato: 'conectado' });
  await oirArranques(page, /^transición de /);
  await abrirInicio(page);
  await irA(page, 'Marketing', 'Blotato');
  await tarjeta(page).getByRole('link').first().hover();
  await expect.poll(async () => (await arranques(page)).some(a => duracionDe(a) >= 100)).toBe(true);
});

// ---- la pista de Edición y el mapa (la caja se esconde, no se desmonta) ----
// Escondida, la caja no tiene por qué seguir rotando su pista, y al volver arranca otra vez en la primera idea.
test.describe('la pista de Edición al abrir el mapa y volver, con «reducir movimiento»', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('queda fija en la primera idea antes, durante y después: abrir el mapa no la pone a rotar', async ({ page }) => {
    const campo = await abrirEdicion(page);
    // escondido (con el mapa abierto) el campo ya no sale por su rol: se le sigue la pista por ser el único <textarea>, que no depende de verlo
    const escondido = page.locator('textarea');
    const quieta = { texto: IDEA_PRIMERA, opacidad: '1', transicion: 'none' };
    expect(await pista(campo)).toEqual(quieta);
    await irAlMapa(page);
    for (let i = 0; i < 3; i++) {
      await page.clock.runFor(10_000);
      await page.waitForTimeout(40);
      expect(await pista(escondido), `con el mapa abierto, a los ${(i + 1) * 10} s`).toEqual(quieta);
    }
    await volverA(page, 'Edición').click();
    expect(await pista(campo)).toEqual(quieta);
    await page.clock.runFor(10_000);
    await page.waitForTimeout(40);
    expect(await pista(campo)).toEqual(quieta);
  });
});

test('sin «reducir movimiento», la pista deja de rotar con el mapa abierto y, al volver, arranca otra vez en la primera idea (el guardián sí ve)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const campo = await abrirEdicion(page);
  await unaIdeaMas(page);
  await unaIdeaMas(page);
  expect((await pista(campo)).texto).toBe(IDEA_TERCERA);
  await irAlMapa(page);
  // con el mapa abierto nadie la ve: por mucho que pase el tiempo no avanza (con un reloj vivo estaría en otra idea). El campo
  // escondido ya no sale por su rol, así que se le lee la pista por ser el único <textarea>
  await page.clock.runFor(30_000);
  await page.waitForTimeout(40);
  expect(await pista(page.locator('textarea'))).toMatchObject({ texto: IDEA_PRIMERA, opacidad: '1' });
  await volverA(page, 'Edición').click();
  expect(await pista(campo)).toMatchObject({ texto: IDEA_PRIMERA, opacidad: '1' });
  // y rota desde ahí con su intervalo completo: a los 3.7 s sigue la primera, entera, y a los 4 s ya es la segunda
  await page.clock.runFor(3700);
  await page.waitForTimeout(40);
  expect(await pista(campo)).toMatchObject({ texto: IDEA_PRIMERA, opacidad: '1' });
  await page.clock.runFor(50);
  await page.waitForTimeout(40);
  await page.clock.runFor(250);
  await page.waitForTimeout(40);
  expect((await pista(campo)).texto).toBe(IDEA_SEGUNDA);
});
