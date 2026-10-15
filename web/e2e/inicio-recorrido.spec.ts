// El recorrido del inicio en un navegador de verdad (dueño, 15-oct-2026: «Mapa con Irremplazables»). El inicio es UNA tarjeta que
// enseña un paso a la vez —el mapa en X, las tres opciones de un área, la caja o la lista de pantallas de un grupo—, y se aterriza
// en la caja. Lo que jsdom no ve y aquí sí:
//  · las dos diagonales del mapa unen de verdad las cuatro esquinas por detrás de las fichas, y en un celular (por debajo de
//    560 px) la X se vuelve compacta, sin desborde, con todo tocable de 44 px y «Automatizaciones» en una sola línea;
//  · la caja se queda montada con el mapa abierto: el texto escrito, el video subido y una subida en curso no se pierden;
//  · Blotato conectado, sin conectar y sin saberlo (con /api/blotato de mentira): apagado o encendido, y un clic en lo apagado
//    abre el diálogo de conectar en vez de navegar;
//  · el foco nunca cae a <body> al cambiar de paso, Tab recorre el mapa en orden de lectura, y Esc es de la tarjeta;
//  · desde una página aparte (la agenda…) la miga «Marketing» llega al mapa con la URL limpia, de punta a punta.
// No gasta nada: el servidor y los servicios son rutas de mentira (e2e/recorrido.ts).
import { expect, test, type Page } from '@playwright/test';

import {
  abrirInicio,
  elegir,
  enfocado,
  ficha,
  irA,
  irAlMapa,
  lineasDe,
  migas,
  opcion,
  paso,
  riel,
  simular,
  simularSubida,
  sobraAlLado,
  tarjeta,
  VIDEO,
  volverA,
} from './recorrido';

const AREAS = ['Marketing', 'Producto', 'Central', 'Ventas', 'Automatizaciones'] as const;
const CAJA = '¿Qué vamos a crear hoy?';
const URL_DEL_INICIO = '/estudio/inicio/';

const rutaDe = (page: Page) => new URL(page.url()).pathname;

/** Lo que se le pide a cada paso a cualquier ancho: nada se sale de la pantalla, todo lo tocable mide 44 px y la letra no baja de 13. */
async function auditar(page: Page, donde: string) {
  expect(await sobraAlLado(page), `${donde}: la página se arrastra de lado`).toBeLessThanOrEqual(0);
  const problemas = await tarjeta(page).evaluate(seccion => {
    const hay: string[] = [];
    for (const e of Array.from(seccion.querySelectorAll('*'))) {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // escondido (la caja, con otro paso a la vista)
      const nombre = `${e.tagName.toLowerCase()} «${(e.textContent ?? '').trim().slice(0, 30)}»`;
      if (r.right > innerWidth + 0.5 || r.left < -0.5) hay.push(`${nombre} se sale de la pantalla`);
      if (e.matches('button, a') && (r.height < 43.5 || r.width < 43.5)) hay.push(`${nombre} mide ${Math.round(r.width)}×${Math.round(r.height)}`);
      const conTexto = Array.from(e.childNodes).some(n => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim());
      if (conTexto && parseFloat(getComputedStyle(e).fontSize) < 13) hay.push(`${nombre} tiene letra de ${getComputedStyle(e).fontSize}`);
    }
    return hay;
  });
  expect(problemas, donde).toEqual([]);
}

// ---------------------------------------------------------------------------
// aterrizar y la tarjeta

test('se aterriza en la caja, con las migas «Marketing › Distrito» y sin «Volver a …»', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(paso(page)).toHaveText(CAJA);
  await expect(page.getByRole('textbox', { name: CAJA })).toBeVisible();
  // el mapa y las opciones no están (ni escondidas: no se pintan hasta que se abren)
  await expect(page.getByText('Elige un área')).toHaveCount(0);
  await expect(page.getByText('Elige un grupo')).toHaveCount(0);
  const cadena = migas(page).getByRole('button');
  await expect(cadena).toHaveText(['Marketing', 'Distrito']);
  await expect(cadena.nth(1)).toHaveAttribute('aria-current', 'step');
  await expect(tarjeta(page).getByRole('button', { name: /^Volver a (Imagen|Video|Edición)$/ })).toHaveCount(0);
  expect(rutaDe(page)).toBe(URL_DEL_INICIO);
  // aterrizar en la caja no le quita el foco a la página (solo entrar por la miga de otra pantalla lo pone en la tarjeta)
  expect((await enfocado(page)).etiqueta).toBe('body');
});

test('la tarjeta mide 820 px, va centrada y pegada arriba: no se centra en vertical', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  const medidas = [];
  for (const alto of [700, 1300]) {
    await page.setViewportSize({ width: 1100, height: alto });
    const caja = (await tarjeta(page).boundingBox())!;
    const ancho = await page.evaluate(() => document.documentElement.clientWidth);
    medidas.push({ ...caja, centro: caja.x + caja.width / 2 - ancho / 2 });
  }
  for (const m of medidas) {
    expect(m.width).toBeCloseTo(820, 0);
    expect(Math.abs(m.centro), 'la tarjeta no está centrada').toBeLessThanOrEqual(1);
    // 64 px arriba: la píldora del saldo (fija, arriba a la derecha) acaba a 52
    expect(m.y).toBeCloseTo(64, 0);
  }
  expect(medidas[1]!.y, 'con más alto de pantalla la tarjeta se movió: se está centrando en vertical').toBe(medidas[0]!.y);
});

// ---------------------------------------------------------------------------
// el mapa

for (const ancho of [1100, 600]) {
  test(`a ${ancho} px la X une las cuatro esquinas pasando por Central, por detrás de las fichas`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 900 });
    await simular(page);
    await abrirInicio(page);
    await irAlMapa(page);
    await expect(ficha(page, 'Marketing')).toContainText('Estás aquí');

    const caja = async (area: string) => (await ficha(page, area).boundingBox())!;
    const [marketing, producto, central, ventas, automatizaciones] = await Promise.all(AREAS.map(caja));
    type Caja = NonNullable<typeof marketing>;
    const dentro = (p: { x: number; y: number }, c: Caja) => p.x >= c.x && p.x <= c.x + c.width && p.y >= c.y && p.y <= c.y + c.height;

    // los extremos de cada línea, ya en coordenadas de pantalla, y lo que hay encima de ellos
    const lineas = await tarjeta(page)
      .locator('svg[viewBox="0 0 100 100"] line')
      .evaluateAll(ls =>
        ls.map(l => {
          const m = (l as SVGLineElement).getScreenCTM()!;
          const punto = (x: string, y: string) => {
            const q = new DOMPoint(Number(l.getAttribute(x)), Number(l.getAttribute(y))).matrixTransform(m);
            return { x: q.x, y: q.y };
          };
          const a = punto('x1', 'y1');
          const b = punto('x2', 'y2');
          const encima = (p: { x: number; y: number }) => document.elementFromPoint(p.x, p.y)?.closest('button')?.textContent ?? '';
          return { a, b, medio: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, encimaDeA: encima(a), encimaDeB: encima(b), trazo: getComputedStyle(l).strokeDasharray };
        }),
      );
    expect(lineas, 'la X lleva dos diagonales').toHaveLength(2);
    const une = (x: Caja, y: Caja) => lineas.some(l => (dentro(l.a, x) && dentro(l.b, y)) || (dentro(l.a, y) && dentro(l.b, x)));
    expect(une(marketing!, automatizaciones!), 'una diagonal debe ir de Marketing a Automatizaciones').toBe(true);
    expect(une(producto!, ventas!), 'la otra, de Producto a Ventas').toBe(true);
    for (const l of lineas) {
      expect(dentro(l.medio, central!), 'una diagonal no pasa por Central').toBe(true);
      expect(l.trazo, 'las diagonales son punteadas').not.toBe('none');
      // por detrás: en sus extremos, lo que recibe el puntero es la ficha de la esquina, no el trazo
      expect(l.encimaDeA).toMatch(/^(Marketing|Producto|Ventas|Automatizaciones)/);
      expect(l.encimaDeB).toMatch(/^(Marketing|Producto|Ventas|Automatizaciones)/);
    }
    // por detrás también en la pila: el SVG queda en una capa más baja que cada ficha y no recibe el puntero
    const capas = await tarjeta(page)
      .locator('svg[viewBox="0 0 100 100"]')
      .evaluate(svg => {
        const capa = (e: Element) => Number.parseInt(getComputedStyle(e).zIndex, 10) || 0;
        return { svg: capa(svg), puntero: getComputedStyle(svg).pointerEvents, fichas: Array.from(svg.parentElement!.querySelectorAll('button')).map(capa) };
      });
    expect(capas.puntero, 'las diagonales reciben el puntero').toBe('none');
    expect(capas.fichas).toHaveLength(5);
    for (const z of capas.fichas) expect(capas.svg, 'las diagonales quedan encima de una ficha').toBeLessThan(z);
    expect(await sobraAlLado(page)).toBeLessThanOrEqual(0);
  });
}

test('el mapa lista las cinco áreas en orden de lectura, y «Estás aquí» marca solo donde estás', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await irAlMapa(page);
  const nombres = (await tarjeta(page).getByRole('group', { name: 'Áreas', exact: true }).getByRole('button').allTextContents()).map(t =>
    t.replace(/Estás aquí|Próximamente/g, ''),
  );
  expect(nombres).toEqual([...AREAS]);
  await expect(tarjeta(page).getByText('Estás aquí')).toHaveCount(1);
  await expect(ficha(page, 'Marketing')).toHaveAttribute('aria-current', 'location');
  // en el mapa no hay migas (se está eligiendo el primer nivel) y «Volver» dice a dónde caerás
  await expect(migas(page)).toHaveCount(0);
  await expect(volverA(page, 'Video')).toBeVisible();
});

test('Producto, Ventas y Automatizaciones son fichas inertes: se ven, se enfocan y no se abren', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await irAlMapa(page);
  for (const area of ['Producto', 'Ventas', 'Automatizaciones']) {
    const f = ficha(page, area);
    await expect(f).toHaveAttribute('aria-disabled', 'true');
    await expect(f).toContainText('Próximamente');
    // Playwright no hace clic en lo `aria-disabled` si no se le fuerza: una persona sí lo pulsa
    await f.click({ force: true });
    await expect(paso(page), `${area}: se abrió`).toHaveText('Elige un área');
    await f.focus();
    await page.keyboard.press('Enter');
    await expect(paso(page), `${area}: se abrió con Enter`).toHaveText('Elige un área');
  }
  for (const area of ['Marketing', 'Central']) await expect(ficha(page, area)).not.toHaveAttribute('aria-disabled', 'true');
  expect(rutaDe(page)).toBe(URL_DEL_INICIO);
});

test('un doble clic en una ficha del mapa abre las opciones y no elige un grupo por accidente', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await irAlMapa(page);
  // el segundo clic cae sobre la primera tarjeta, que aparece justo donde estaba la ficha
  await ficha(page, 'Marketing').dblclick();
  await expect(paso(page)).toHaveText('Elige un grupo');
  await expect(page.getByRole('textbox', { name: CAJA })).toBeHidden();
});

// El mismo doble clic un nivel más abajo: el segundo clic cae sobre lo que aparece donde estaba la tarjeta del grupo (el botón de conectar o la
// primera pantalla de la lista, que es un enlace). Navegaba fuera del inicio —y lo escrito en la caja se perdía— o abría el diálogo de conectar
// sin que nadie lo pidiera. Playwright hace el doble clic de verdad (clickCount 1 y 2, el segundo con `detail` 2).
for (const [ancho, grupo, blotato] of [
  [1100, 'Blotato', 'conectado'],
  [1100, 'Blotato', 'sin-conectar'],
  [390, 'Blotato', 'conectado'],
  [390, 'Blotato', 'sin-conectar'],
  [1100, 'Avanzado', 'conectado'],
] as const) {
  test(`un doble clic en la tarjeta «${grupo}» (${blotato}, ${ancho} px) abre su lista y no activa lo que cae debajo`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 900 });
    await simular(page, { blotato });
    await abrirInicio(page);
    await page.getByRole('textbox', { name: CAJA }).fill('un gato jugando en la nieve');
    await irAlMapa(page);
    await ficha(page, 'Marketing').click();
    await expect(paso(page)).toHaveText('Elige un grupo');
    await opcion(page, 'Marketing', grupo).dblclick();
    await expect(paso(page)).toHaveText(grupo);
    // ni salió del inicio (lo escrito en la caja sigue ahí) ni se abrió el diálogo de conectar
    await page.waitForTimeout(400);
    expect(rutaDe(page)).toBe(URL_DEL_INICIO);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(paso(page)).toHaveText(grupo);
    if (blotato === 'sin-conectar') {
      // una pulsación deliberada pasa: la guardia dura medio segundo, no para siempre
      await page.waitForTimeout(600);
      await tarjeta(page).getByRole('button', { name: 'Conecta tu cuenta de Blotato' }).dblclick();
      await expect(page.getByRole('dialog', { name: 'Conecta tu Blotato' })).toBeVisible();
    }
  });
}

// ---------------------------------------------------------------------------
// las tres opciones

test('elegir Marketing da tres opciones, con las pantallas de cada una y «Estás aquí» solo en Distrito', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await irAlMapa(page);
  await ficha(page, 'Marketing').click();
  await expect(paso(page)).toHaveText('Elige un grupo');
  const tres = tarjeta(page).getByRole('group', { name: 'Marketing', exact: true }).getByRole('button');
  await expect(tres).toHaveCount(3);
  await expect(opcion(page, 'Marketing', 'Distrito')).toContainText('Imagen · Video · Edición');
  await expect(opcion(page, 'Marketing', 'Blotato')).toContainText('Agenda tus publicaciones · Investiga tu competencia · Ver mis métricas');
  await expect(opcion(page, 'Marketing', 'Avanzado')).toContainText('Publicaciones automáticas · Copiadora de estilos');
  await expect(opcion(page, 'Marketing', 'Distrito')).toContainText('Estás aquí');
  await expect(opcion(page, 'Marketing', 'Distrito')).toHaveAttribute('aria-current', 'location');
  await expect(tarjeta(page).getByText('Estás aquí')).toHaveCount(1);
  // la miga del área es donde estás en este paso; «Volver» sigue diciendo a dónde regresarás
  await expect(migas(page).getByRole('button')).toHaveText(['Marketing']);
  await expect(migas(page).getByRole('button')).toHaveAttribute('aria-current', 'step');
  await expect(volverA(page, 'Video')).toBeVisible();
});

// ---------------------------------------------------------------------------
// la caja se queda montada

for (const [familia, campo] of [
  ['Imagen', CAJA],
  ['Video', CAJA],
  ['Edición', 'Cuéntale a la IA qué quieres'],
] as const) {
  test(`«${familia}»: abrir el mapa y volver con «Volver a ${familia}» deja el texto escrito y la pestaña como estaban`, async ({ page }) => {
    await simular(page);
    await abrirInicio(page);
    await riel(page, familia).click();
    const cuadro = page.getByRole('textbox', { name: campo });
    await cuadro.fill('un gato jugando en la nieve');
    await irAlMapa(page);
    // escondida, no desmontada: no se ve ni se enfoca, pero sigue ahí con lo suyo
    await expect(cuadro).toBeHidden();
    await expect(page.locator('textarea')).toHaveCount(1);
    await volverA(page, familia).click();
    await expect(paso(page)).toHaveText(CAJA);
    await expect(cuadro).toHaveValue('un gato jugando en la nieve');
    await expect(riel(page, familia)).toHaveAttribute('aria-pressed', 'true');
  });
}

test('el camino largo (mapa → Marketing → Distrito) también vuelve a la caja con el texto, y el foco va a su título', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  const cuadro = page.getByRole('textbox', { name: CAJA });
  await cuadro.fill('un perro surfeando');
  await irA(page, 'Marketing', 'Distrito');
  await expect(paso(page)).toHaveText(CAJA);
  await expect(cuadro).toHaveValue('un perro surfeando');
  // el botón que se pulsó desapareció: el foco no se pierde, pasa al título de la caja
  await expect(paso(page)).toBeFocused();
});

test('«De videos a Shorts» y la liga escrita se conservan al abrir el mapa y volver a Edición', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await riel(page, 'Edición').click();
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.getByRole('option', { name: /De videos a Shorts/ }).click();
  const liga = page.getByRole('textbox', { name: 'Liga de YouTube' });
  await liga.fill('https://www.youtube.com/watch?v=abc123DEF45');
  await irAlMapa(page);
  await expect(liga).toBeHidden();
  await volverA(page, 'Edición').click();
  await expect(liga).toHaveValue('https://www.youtube.com/watch?v=abc123DEF45');
  await expect(page.locator('button[aria-haspopup="listbox"]')).toContainText('De videos a Shorts');
});

test('una subida en curso sigue con el mapa abierto, y el video listo y su precio están al volver', async ({ page }) => {
  let soltar!: () => void;
  const puerta = new Promise<void>(resolver => (soltar = resolver));
  await simular(page);
  await simularSubida(page, puerta);
  await abrirInicio(page);
  await riel(page, 'Edición').click();
  const subida = page.waitForRequest('**/s3-falso/subida');
  await page.locator('input[type="file"]').setInputFiles(VIDEO);
  await subida;
  // sube (el PUT está esperando) y se abre el mapa: la caja se esconde con la subida adentro
  await irAlMapa(page);
  // la subida termina (y pide el precio) con el mapa abierto, sin que la caja se vea
  const precio = page.waitForResponse('**/api/editar/entrevista/costo');
  soltar();
  await precio;
  await volverA(page, 'Edición').click();
  await expect(page.getByRole('button', { name: 'Iniciar ✦ 8' })).toBeVisible();
  await expect(page.getByText('entrevista.mp4')).toBeVisible();
});

test('«Mis creaciones» se ve solo con la caja a la vista (en el mapa, las opciones y las listas se esconde, y vuelve)', async ({ page }) => {
  await simular(page, { imagenes: 2 });
  await abrirInicio(page);
  const creaciones = page.getByRole('region', { name: 'Mis creaciones' });
  await expect(creaciones).toBeVisible();
  await irAlMapa(page);
  await expect(creaciones, 'en el mapa').toBeHidden();
  await ficha(page, 'Marketing').click();
  await expect(creaciones, 'en las opciones').toBeHidden();
  await opcion(page, 'Marketing', 'Blotato').click();
  await expect(creaciones, 'en la lista de Blotato').toBeHidden();
  // sigue montada: la galería no pierde su filtro ni su visor
  await expect(page.locator('#creaciones-titulo')).toHaveCount(1);
  await irA(page, 'Marketing', 'Distrito');
  await expect(creaciones).toBeVisible();
});

test('«Tu primer video, en tres caminos» (quien empieza) también se esconde con el mapa abierto', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  const caminos = page.getByRole('region', { name: 'Tu primer video, en tres caminos' });
  await expect(caminos).toBeVisible();
  await irAlMapa(page);
  await expect(caminos).toBeHidden();
  await volverA(page, 'Video').click();
  await expect(caminos).toBeVisible();
});

// ---------------------------------------------------------------------------
// Blotato

const LISTA_DE_BLOTATO = ['Agenda tus publicaciones', 'Investiga tu competencia', 'Ver mis métricas'];

test.describe('Blotato SIN conectar', () => {
  test('las tres pantallas salen apagadas y un clic abre el diálogo de conectar, sin navegar ni mover el recorrido', async ({ page }) => {
    const { pedidos } = await simular(page, { blotato: 'sin-conectar' });
    await abrirInicio(page);
    await irA(page, 'Marketing', 'Blotato');
    await expect(paso(page)).toHaveText('Blotato');
    const enlaces = tarjeta(page).getByRole('link');
    await expect(enlaces).toHaveCount(3);
    for (const [i, titulo] of LISTA_DE_BLOTATO.entries()) {
      const e = enlaces.nth(i);
      await expect(e).toContainText(titulo);
      await expect(e).toHaveAttribute('aria-disabled', 'true');
      await expect(e).toContainText('Conecta tu Blotato para usarlo');
      await expect(e).toHaveCSS('opacity', '0.6');
    }
    const conectar = tarjeta(page).getByRole('button', { name: 'Conecta tu cuenta de Blotato' });
    await expect(conectar).toHaveAttribute('aria-haspopup', 'dialog');
    // la consulta ligera (`?redes=0`) es la del montaje; la completa, la del diálogo
    expect(pedidos[0]).toBe('GET ?redes=0');

    await enlaces.first().click({ force: true });
    const dialogo = page.getByRole('dialog', { name: 'Conecta tu Blotato' });
    await expect(dialogo).toBeVisible();
    expect(rutaDe(page)).toBe(URL_DEL_INICIO);
    await expect.poll(() => pedidos.at(-1)).toBe('GET');
    // Esc es del diálogo: lo cierra y el recorrido se queda donde estaba, con el foco en algo (no en <body>)
    await page.keyboard.press('Escape');
    await expect(dialogo).toBeHidden();
    await expect(paso(page)).toHaveText('Blotato');
    expect((await enfocado(page)).etiqueta).not.toBe('body');
  });

  test('el botón «Conecta tu cuenta de Blotato» abre el diálogo, y al conectar se encienden las tres pantallas', async ({ page }) => {
    const { claves } = await simular(page, { blotato: 'sin-conectar' });
    await abrirInicio(page);
    await irA(page, 'Marketing', 'Blotato');
    await tarjeta(page).getByRole('button', { name: 'Conecta tu cuenta de Blotato' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Conecta tu Blotato' });
    await dialogo.getByLabel('Tu clave de API de Blotato').fill('clave-de-prueba');
    await dialogo.getByRole('button', { name: 'Conectar' }).click();
    // ya conectado, el diálogo cambia de título («Tu Blotato»): es el mismo, ahora sin el formulario
    const conectado = page.getByRole('dialog', { name: 'Tu Blotato' });
    await expect(conectado.getByText('Tu Blotato está conectado')).toBeVisible();
    expect(claves).toEqual(['clave-de-prueba']);
    await page.keyboard.press('Escape');
    await expect(conectado).toBeHidden();
    const enlaces = tarjeta(page).getByRole('link');
    for (let i = 0; i < 3; i++) await expect(enlaces.nth(i)).not.toHaveAttribute('aria-disabled', 'true');
    await expect(tarjeta(page).getByText('Conecta tu Blotato para usarlo')).toHaveCount(0);
    await expect(tarjeta(page).getByRole('button', { name: 'Blotato conectado: ver o cambiar' })).toBeVisible();
  });
});

test.describe('Blotato conectado', () => {
  test('las tres pantallas salen encendidas y llevan a su página; el botón dice «Blotato conectado: ver o cambiar»', async ({ page }) => {
    await simular(page, { blotato: 'conectado' });
    await abrirInicio(page);
    await irA(page, 'Marketing', 'Blotato');
    const enlaces = tarjeta(page).getByRole('link');
    await expect(enlaces).toHaveCount(3);
    for (const [i, titulo] of LISTA_DE_BLOTATO.entries()) {
      await expect(enlaces.nth(i)).toContainText(titulo);
      await expect(enlaces.nth(i)).not.toHaveAttribute('aria-disabled', 'true');
      await expect(enlaces.nth(i)).not.toContainText('Conecta tu Blotato');
    }
    const boton = tarjeta(page).getByRole('button', { name: 'Blotato conectado: ver o cambiar' });
    await expect(boton).toHaveAttribute('aria-haspopup', 'dialog');
    await boton.click();
    const dialogo = page.getByRole('dialog', { name: 'Tu Blotato' });
    await expect(dialogo).toContainText('Tu Blotato está conectado');
    await expect(dialogo.getByRole('list', { name: 'Redes conectadas en tu Blotato' })).toContainText('Instagram');
    await page.keyboard.press('Escape');
    await expect(dialogo).toBeHidden();
    // un clic en la pantalla navega a ella (la vieja /agenda.html la manda el servidor a la nueva)
    await Promise.all([page.waitForURL(/\/estudio\/agenda\//), enlaces.first().click()]);
  });
});

test.describe('Blotato sin saber si está conectado', () => {
  test('no apaga nada (dejar sin sus herramientas a quien sí pagó, por un fetch que falló, es peor) y un clic navega', async ({ page }) => {
    await simular(page, { blotato: 'caido' });
    await abrirInicio(page);
    await irA(page, 'Marketing', 'Blotato');
    const enlaces = tarjeta(page).getByRole('link');
    await expect(enlaces).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(enlaces.nth(i)).not.toHaveAttribute('aria-disabled', 'true');
    await expect(tarjeta(page).getByText('Conecta tu Blotato para usarlo')).toHaveCount(0);
    await Promise.all([page.waitForURL(/\/estudio\/competencia\//), enlaces.nth(1).click()]);
  });
});

test('Avanzado: «Publicaciones automáticas» se apaga sin Blotato y abre el diálogo; la «Copiadora de estilos» no, y no hay botón de conectar', async ({ page }) => {
  await simular(page, { blotato: 'sin-conectar' });
  await abrirInicio(page);
  await irA(page, 'Marketing', 'Avanzado');
  await expect(paso(page)).toHaveText('Avanzado');
  // el botón de conectar solo va en un grupo que depende ENTERO de Blotato; Avanzado trae la Copiadora, que no
  await expect(tarjeta(page).getByRole('button', { name: /Blotato/ })).toHaveCount(0);
  const mix = tarjeta(page).getByRole('link', { name: /Publicaciones automáticas/ });
  const copiadora = tarjeta(page).getByRole('link', { name: /Copiadora de estilos/ });
  await expect(mix).toHaveAttribute('aria-disabled', 'true');
  await expect(copiadora).not.toHaveAttribute('aria-disabled', 'true');
  await expect(copiadora).not.toContainText('Conecta tu Blotato');
  await mix.click({ force: true });
  await expect(page.getByRole('dialog', { name: 'Conecta tu Blotato' })).toBeVisible();
  expect(rutaDe(page)).toBe(URL_DEL_INICIO);
  await page.keyboard.press('Escape');
  await Promise.all([page.waitForURL(/\/estudio\/estilos\//), copiadora.click()]);
});

// ---------------------------------------------------------------------------
// Central

test('Central: el grupo Distrito trae cuatro pantallas «Próximamente» que no navegan, y Deepseek dice que todavía no está disponible', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await irAlMapa(page);
  await ficha(page, 'Central').click();
  await expect(paso(page)).toHaveText('Elige un grupo');
  await expect(tarjeta(page).getByRole('group', { name: 'Central', exact: true }).getByRole('button')).toHaveText([/^Distrito/, /^Deepseek/]);
  await expect(opcion(page, 'Central', 'Deepseek')).toContainText('Próximamente');
  // se mira Central pero se está en Marketing: «Estás aquí» no está en ninguna de sus opciones
  await expect(tarjeta(page).getByText('Estás aquí')).toHaveCount(0);

  await opcion(page, 'Central', 'Distrito').click();
  await expect(paso(page)).toHaveText('Distrito');
  await expect(migas(page).getByRole('button')).toHaveText(['Central', 'Distrito']);
  for (const titulo of ['COI', 'Biblioteca de prompts', 'Preguntas sobre la clase', 'Glosario IA']) {
    const fila = tarjeta(page).getByText(titulo, { exact: true });
    await expect(fila).toBeVisible();
    await fila.click();
    await expect(paso(page), `«${titulo}» navegó`).toHaveText('Distrito');
  }
  await expect(tarjeta(page).getByText('Próximamente')).toHaveCount(4);
  await expect(tarjeta(page).getByRole('link')).toHaveCount(0);
  expect(rutaDe(page)).toBe(URL_DEL_INICIO);

  // ahora SÍ se está en Central: el mapa lo marca y «Volver» regresa a este grupo
  await irAlMapa(page);
  await expect(ficha(page, 'Central')).toContainText('Estás aquí');
  await expect(ficha(page, 'Marketing')).not.toContainText('Estás aquí');
  await elegir(page, 'Central', 'Deepseek');
  await expect(paso(page)).toHaveText('Deepseek');
  await expect(tarjeta(page).getByText('Todavía no está disponible.')).toBeVisible();
});

// ---------------------------------------------------------------------------
// teclado y foco

test('Esc dentro de la tarjeta es «Volver a …»: del mapa y de las opciones regresa a la caja, y mirar Central no te saca de Marketing', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  const cuadro = page.getByRole('textbox', { name: CAJA });
  await cuadro.fill('texto que no se pierde');

  await irAlMapa(page);
  await page.keyboard.press('Escape');
  await expect(paso(page)).toHaveText(CAJA);
  await expect(paso(page)).toBeFocused();

  // mirar las opciones de otra área no cambia dónde estás
  await irAlMapa(page);
  await ficha(page, 'Central').click();
  await expect(paso(page)).toHaveText('Elige un grupo');
  await page.keyboard.press('Escape');
  await expect(paso(page)).toHaveText(CAJA);
  await expect(migas(page).getByRole('button')).toHaveText(['Marketing', 'Distrito']);
  await expect(cuadro).toHaveValue('texto que no se pierde');

  // en la caja Esc no hace nada
  await cuadro.focus();
  await page.keyboard.press('Escape');
  await expect(paso(page)).toHaveText(CAJA);
  await expect(cuadro).toBeFocused();
});

test('Esc es de la tarjeta y no de la página: con el foco fuera de ella no mueve el recorrido; en una lista tampoco', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await irAlMapa(page);
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  expect((await enfocado(page)).etiqueta).toBe('body');
  await page.keyboard.press('Escape');
  await expect(paso(page)).toHaveText('Elige un área');
  await elegir(page, 'Marketing', 'Blotato');
  await page.keyboard.press('Escape');
  await expect(paso(page)).toHaveText('Blotato');
});

test('el foco no se pierde en <body> al cambiar de paso con el ratón: va al título del paso nuevo', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  const alTitulo = async (texto: string) => {
    await expect(paso(page)).toHaveText(texto);
    await expect(paso(page)).toBeFocused();
  };
  await migas(page).getByRole('button', { name: /^Volver al mapa/ }).click();
  await alTitulo('Elige un área');
  await ficha(page, 'Marketing').click();
  await alTitulo('Elige un grupo');
  await opcion(page, 'Marketing', 'Blotato').click();
  await alTitulo('Blotato');
  await migas(page).getByRole('button', { name: /^Volver al mapa/ }).click();
  await alTitulo('Elige un área');
  await volverA(page, 'Blotato').click();
  await alTitulo('Blotato');
  await migas(page).getByRole('button', { name: /^Volver a las opciones/ }).click();
  await alTitulo('Elige un grupo');
  await opcion(page, 'Marketing', 'Distrito').click();
  await alTitulo(CAJA);
});

// Lo pulsado puede no mover el foco (la acción «hacer clic» de un lector en modo exploración, el control por voz, un `.click()`): el campo de
// la caja sigue siendo `activeElement` en el instante en que la caja se esconde, y Chromium lo suelta a <body> un momento después. Sin cuidado,
// el foco acababa en <body>, Esc no llegaba a la tarjeta y el lector no oía «Elige un área».
test('el foco que estaba DENTRO de la caja al abrir el mapa sin mover el foco (.click()) no cae a <body>: va al título, y Esc sigue valiendo', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  const abrirElMapaSinMoverElFoco = () => migas(page).getByRole('button', { name: /^Volver al mapa/ }).evaluate(b => (b as HTMLButtonElement).click());
  for (const [desde, alcanzar] of [
    ['el cuadro de texto', () => page.getByRole('textbox', { name: CAJA }).focus()],
    ['el chip «Un video corto ▾»', () => page.locator('button[aria-haspopup="listbox"]').focus()],
  ] as const) {
    await alcanzar();
    await abrirElMapaSinMoverElFoco();
    await expect(paso(page), `desde ${desde}`).toHaveText('Elige un área');
    await expect(paso(page), `desde ${desde}: el foco se perdió`).toBeFocused();
    // un instante después (cuando el navegador suelta lo que quedó escondido) sigue ahí, y Esc vuelve a la caja
    await page.waitForTimeout(300);
    expect((await enfocado(page)).etiqueta, `desde ${desde}: el foco cayó a <body>`).toBe('h2');
    await page.keyboard.press('Escape');
    await expect(paso(page), `desde ${desde}: Esc no volvió`).toHaveText(CAJA);
    await expect(paso(page)).toBeFocused();
  }
});

test('Tab recorre el mapa en orden de lectura; el único tope en <body> es la salida de la página, tras el último', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await irAlMapa(page);
  // el foco ya está en «Elige un área»: de ahí, Tab va a la primera ficha
  const paradas = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    paradas.push(await enfocado(page));
  }
  const nombre = (p: { texto: string }) => p.texto.replace(/(Estás aquí|Próximamente)$/, '');
  // el mapa entero (también las tres fichas inertes), la salida de la página, «Volver a Video» y vuelta a empezar
  const cuerpos = paradas.map((p, i) => (p.etiqueta === 'body' ? i : -1)).filter(i => i >= 0);
  expect(paradas.filter(p => p.etiqueta !== 'body').map(nombre)).toEqual([...AREAS, 'Volver a Video', ...AREAS]);
  // <body> sale UNA vez y justo tras el último enfocable: es el navegador saliendo de la página, no un foco perdido
  expect(cuerpos).toEqual([AREAS.length]);
});

test('con solo el teclado: Enter en una ficha y en una tarjeta cambian de paso, y Tab sigue desde el título nuevo', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await migas(page).getByRole('button', { name: /^Volver al mapa/ }).focus();
  await page.keyboard.press('Enter');
  await expect(paso(page)).toHaveText('Elige un área');
  await expect(paso(page)).toBeFocused();
  await page.keyboard.press('Tab');
  expect((await enfocado(page)).texto).toMatch(/^Marketing/);
  await page.keyboard.press('Enter');
  await expect(paso(page)).toHaveText('Elige un grupo');
  await expect(paso(page)).toBeFocused();
  await page.keyboard.press('Tab');
  expect((await enfocado(page)).texto).toMatch(/^Distrito/);
  await page.keyboard.press('Enter');
  await expect(paso(page)).toHaveText(CAJA);
  await expect(paso(page)).toBeFocused();
  // la caja ya está a la vista y se escribe en ella: Tab desde su título llega al cuadro
  await page.keyboard.press('Tab');
  expect((await enfocado(page)).etiqueta).toBe('textarea');
});

// ---------------------------------------------------------------------------
// el celular: la X compacta y lo demás

for (const ancho of [390, 320]) {
  test.describe(`a ${ancho} px`, () => {
    test.use({ viewport: { width: ancho, height: 800 } });

    test('el mapa es una X compacta: dos columnas, Central en una banda de ancho completo, trazos cortos y sin desborde', async ({ page }) => {
      await simular(page);
      await abrirInicio(page);
      await irAlMapa(page);
      const c = {} as Record<(typeof AREAS)[number], { x: number; y: number; width: number; height: number }>;
      for (const a of AREAS) c[a] = (await ficha(page, a).boundingBox())!;

      // dos columnas: Marketing y Producto en una fila; Central, una banda de la orilla de la una a la de la otra; las otras dos abajo
      expect(c.Producto.y).toBeCloseTo(c.Marketing.y, 0);
      expect(c.Producto.x).toBeGreaterThan(c.Marketing.x + c.Marketing.width - 1);
      expect(c.Central.x).toBeCloseTo(c.Marketing.x, 0);
      expect(c.Central.x + c.Central.width).toBeCloseTo(c.Producto.x + c.Producto.width, 0);
      expect(c.Central.y).toBeGreaterThan(c.Marketing.y + c.Marketing.height);
      expect(c.Ventas.y).toBeGreaterThan(c.Central.y + c.Central.height);
      expect(c.Automatizaciones.y).toBeCloseTo(c.Ventas.y, 0);
      for (const a of AREAS) {
        expect(c[a].height, `${a}: alto táctil`).toBeGreaterThanOrEqual(44);
        expect(c[a].width, `${a}: ancho táctil`).toBeGreaterThanOrEqual(44);
        expect(c[a].x + c[a].width, `${a} se sale por la derecha`).toBeLessThanOrEqual(ancho);
      }

      // la X grande no se pinta; en su lugar, un trazo corto de cada esquina a la banda
      await expect(tarjeta(page).locator('svg[viewBox="0 0 100 100"]')).toBeHidden();
      const trazo = (area: (typeof AREAS)[number]) =>
        ficha(page, area).evaluate(boton => {
          const s = Array.from(boton.querySelectorAll('span[aria-hidden="true"]')).find(x => getComputedStyle(x).borderLeftStyle === 'dotted');
          const r = s?.getBoundingClientRect();
          return r && r.height > 0 ? { arriba: r.top, abajo: r.bottom } : null;
        });
      for (const a of ['Marketing', 'Producto'] as const) {
        const t = (await trazo(a))!;
        expect(t, `${a}: sin trazo`).not.toBeNull();
        // (el trazo cuelga del borde de adentro de la ficha: 1 px de su borde queda por fuera, de ahí el 1 de margen)
        expect(Math.abs(t.arriba - (c[a].y + c[a].height)), `${a}: el trazo no sale de su ficha`).toBeLessThanOrEqual(1.5);
        expect(Math.abs(t.abajo - c.Central.y), `${a}: el trazo no llega a la banda`).toBeLessThanOrEqual(1.5);
      }
      for (const a of ['Ventas', 'Automatizaciones'] as const) {
        const t = (await trazo(a))!;
        expect(t, `${a}: sin trazo`).not.toBeNull();
        expect(Math.abs(t.abajo - c[a].y), `${a}: el trazo no sale de su ficha`).toBeLessThanOrEqual(1.5);
        expect(Math.abs(t.arriba - (c.Central.y + c.Central.height)), `${a}: el trazo no llega a la banda`).toBeLessThanOrEqual(1.5);
      }
      expect(await trazo('Central'), 'Central es la banda: no lleva trazo').toBeNull();

      // «Automatizaciones» y «Estás aquí» no se parten y caben en su ficha
      const nombre = ficha(page, 'Automatizaciones').getByText('Automatizaciones', { exact: true });
      expect(await lineasDe(nombre), '«Automatizaciones» se parte en dos líneas').toBe(1);
      const sobra = await nombre.evaluate(el => {
        const t = el.getBoundingClientRect();
        const f = (el.closest('button') as HTMLElement).getBoundingClientRect();
        return { derecha: t.right - f.right, izquierda: f.left - t.left };
      });
      expect(sobra.derecha, '«Automatizaciones» se sale de su ficha').toBeLessThanOrEqual(0);
      expect(sobra.izquierda, '«Automatizaciones» se sale de su ficha').toBeLessThanOrEqual(0);
      expect(await lineasDe(ficha(page, 'Marketing').getByText('Estás aquí')), '«Estás aquí» se parte').toBe(1);
      expect(await sobraAlLado(page)).toBeLessThanOrEqual(0);
    });

    test('cada paso (mapa, opciones, listas) cabe: sin desborde, lo tocable de 44 px y letra de 13 px o más', async ({ page }) => {
      await simular(page, { blotato: 'sin-conectar' });
      await abrirInicio(page);
      await irAlMapa(page);
      await auditar(page, 'el mapa');
      await ficha(page, 'Marketing').click();
      await auditar(page, 'las opciones de Marketing');
      // en una sola columna: cada tarjeta ocupa el ancho y no hay dos en una fila
      const columnas = await tarjeta(page).getByRole('group', { name: 'Marketing', exact: true }).getByRole('button').evaluateAll(bs => bs.map(b => b.getBoundingClientRect().x));
      expect(new Set(columnas.map(x => Math.round(x))).size, 'las opciones no se apilan en una columna').toBe(1);
      await opcion(page, 'Marketing', 'Blotato').click();
      await auditar(page, 'la lista de Blotato');
      await irA(page, 'Marketing', 'Avanzado');
      await auditar(page, 'la lista de Avanzado');
      await irA(page, 'Central', 'Distrito');
      await auditar(page, 'Central › Distrito');
      await irA(page, 'Central', 'Deepseek');
      await auditar(page, 'Central › Deepseek');
    });
  });
}

test('a 1100 px cada paso cumple lo mismo: sin desborde, lo tocable de 44 px y letra de 13 px o más', async ({ page }) => {
  await simular(page, { blotato: 'sin-conectar' });
  await abrirInicio(page);
  await irAlMapa(page);
  await auditar(page, 'el mapa');
  await ficha(page, 'Marketing').click();
  await auditar(page, 'las opciones de Marketing');
  await opcion(page, 'Marketing', 'Blotato').click();
  await auditar(page, 'la lista de Blotato');
  await irA(page, 'Central', 'Distrito');
  await auditar(page, 'Central › Distrito');
});

test('el mapa pasa de la X compacta a la X grande en el corte de 560 px, y a ningún ancho se desborda ni se parte «Automatizaciones»', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await irAlMapa(page);
  const equis = tarjeta(page).locator('svg[viewBox="0 0 100 100"]');
  // (a 560 justos Tailwind 4 todavía no aplica `max-[560px]`: ahí se pinta la grande, y tampoco desborda; no se fija de qué lado cae)
  for (const ancho of [320, 360, 390, 414, 480, 540, 559, 560, 561, 600, 640, 700, 760, 761, 860, 861, 1000]) {
    await page.setViewportSize({ width: ancho, height: 800 });
    expect(await sobraAlLado(page), `a ${ancho} px la página se arrastra de lado`).toBeLessThanOrEqual(0);
    expect(await lineasDe(ficha(page, 'Automatizaciones').getByText('Automatizaciones', { exact: true })), `a ${ancho} px «Automatizaciones» se parte`).toBe(1);
    const cajas = await Promise.all(AREAS.map(a => ficha(page, a).boundingBox()));
    for (const [i, c] of cajas.entries()) {
      expect(c!.height, `a ${ancho} px ${AREAS[i]} mide ${c!.height} de alto`).toBeGreaterThanOrEqual(44);
      expect(c!.x + c!.width, `a ${ancho} px ${AREAS[i]} se sale por la derecha`).toBeLessThanOrEqual(ancho);
    }
    if (ancho <= 559) await expect(equis, `a ${ancho} px sigue la X grande`).toBeHidden();
    if (ancho >= 561) await expect(equis, `a ${ancho} px falta la X grande`).toBeVisible();
  }
});

// ---------------------------------------------------------------------------
// desde una página hoja: la miga lleva al inicio, de punta a punta

const HOJAS = [
  { ruta: 'agenda', titulo: 'Agenda tus publicaciones', grupo: 'Blotato' },
  { ruta: 'competencia', titulo: 'Investiga tu competencia', grupo: 'Blotato' },
  { ruta: 'metricas', titulo: 'Ver mis métricas', grupo: 'Blotato' },
  { ruta: 'mix', titulo: 'Publicaciones automáticas', grupo: 'Avanzado' },
  { ruta: 'estilos', titulo: 'Copiadora de estilos', grupo: 'Avanzado' },
] as const;

const migaDeHoja = (page: Page, nombre: RegExp) => page.getByRole('navigation', { name: 'Dónde estás' }).getByRole('link', { name: nombre });

/** Espera a que el inicio haya leído `?desde=…&ver=…` y dejado la URL limpia. */
const urlLimpia = (page: Page) => expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe(URL_DEL_INICIO);

for (const hoja of HOJAS) {
  test(`desde /estudio/${hoja.ruta}/: la miga «Marketing» cae en «Elige un área», con la URL limpia, y «Volver a ${hoja.titulo}» regresa`, async ({ page }) => {
    await simular(page);
    await page.goto(`/estudio/${hoja.ruta}/`);
    await migaDeHoja(page, /^Ir al mapa/).click();
    await expect(paso(page)).toHaveText('Elige un área');
    await urlLimpia(page);
    // se llega con el foco ya en la tarjeta (en su título), no en <body>: de ahí Esc y Tab valen desde el primer toque
    await expect(paso(page)).toBeFocused();
    await expect(ficha(page, 'Marketing')).toContainText('Estás aquí');
    const volver = tarjeta(page).getByRole('link', { name: `Volver a ${hoja.titulo}`, exact: true });
    await expect(volver).toBeVisible();
    await Promise.all([page.waitForURL(new RegExp(`/estudio/${hoja.ruta}/`)), volver.click()]);
  });

  test(`desde /estudio/${hoja.ruta}/: la miga «${hoja.grupo}» cae en «Elige un grupo» y marca ${hoja.grupo} como «Estás aquí»`, async ({ page }) => {
    await simular(page);
    await page.goto(`/estudio/${hoja.ruta}/`);
    await migaDeHoja(page, new RegExp(`^Ir a las opciones de Marketing \\(ahora: ${hoja.grupo}\\)`)).click();
    await expect(paso(page)).toHaveText('Elige un grupo');
    await urlLimpia(page);
    await expect(paso(page)).toBeFocused();
    await expect(tarjeta(page).getByText('Estás aquí')).toHaveCount(1);
    await expect(opcion(page, 'Marketing', hoja.grupo)).toContainText('Estás aquí');
    await expect(tarjeta(page).getByRole('link', { name: `Volver a ${hoja.titulo}`, exact: true })).toBeVisible();
  });
}

test('desde la agenda: Esc, sin tocar nada más, navega de regreso a la agenda; y Tab sigue desde el título', async ({ page }) => {
  await simular(page);
  await page.goto('/estudio/agenda/');
  await migaDeHoja(page, /^Ir al mapa/).click();
  await expect(paso(page)).toHaveText('Elige un área');
  await expect(paso(page)).toBeFocused();
  // Tab sigue desde el título (que no es tabulable): la primera ficha; y Shift+Tab, el «Volver a …» de antes
  await page.keyboard.press('Tab');
  expect((await enfocado(page)).texto).toMatch(/^Marketing/);
  await page.keyboard.press('Shift+Tab');
  expect((await enfocado(page)).texto).toBe('Volver a Agenda tus publicaciones');
  await Promise.all([page.waitForURL(/\/estudio\/agenda\//), page.keyboard.press('Escape')]);
});

test('desde la agenda: Esc llega a la tarjeta de entrada, con las opciones abiertas, y navega de regreso', async ({ page }) => {
  await simular(page);
  await page.goto('/estudio/agenda/');
  await migaDeHoja(page, /^Ir a las opciones/).click();
  await expect(paso(page)).toHaveText('Elige un grupo');
  await Promise.all([page.waitForURL(/\/estudio\/agenda\//), page.keyboard.press('Escape')]);
});

test('desde la agenda: «atrás» del navegador regresa a la agenda (la URL limpia reemplaza la entrada, no suma otra)', async ({ page }) => {
  await simular(page);
  await page.goto('/estudio/agenda/');
  await migaDeHoja(page, /^Ir al mapa/).click();
  await expect(paso(page)).toHaveText('Elige un área');
  await urlLimpia(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/estudio\/agenda\//);
});

test('desde la agenda: recargar el inicio ya limpio aterriza en la caja, sin repetir el recorrido', async ({ page }) => {
  await simular(page);
  await page.goto('/estudio/agenda/');
  await migaDeHoja(page, /^Ir a las opciones/).click();
  await expect(paso(page)).toHaveText('Elige un grupo');
  await urlLimpia(page);
  await page.reload();
  await expect(paso(page)).toHaveText(CAJA);
  await expect(page.getByRole('textbox', { name: CAJA })).toBeVisible();
});

test('las entradas por la URL que no valen se ignoran: se aterriza en la caja y la URL se limpia', async ({ page }) => {
  await simular(page);
  for (const consulta of [
    '?desde=mkt.blotato.nada&ver=mapa', // el lugar no existe
    '?desde=mkt.blotato&ver=mapa', // le falta una clave
    '?desde=mkt.blotato.agenda&ver=otra', // qué abrir no es mapa ni grupos
    '?desde=mkt.blotato.agenda', // sin «ver»
    '?ver=mapa', // sin «desde»
  ]) {
    await abrirInicio(page, URL_DEL_INICIO + consulta);
    await expect(paso(page), consulta).toHaveText(CAJA);
    await urlLimpia(page);
  }
});

test('una pantalla de la caja como origen (?desde=mkt.distrito.video): abre el mapa y «Volver a Video» no navega, solo vuelve a la caja', async ({ page }) => {
  await simular(page);
  await abrirInicio(page, `${URL_DEL_INICIO}?desde=mkt.distrito.video&ver=mapa`);
  await expect(paso(page)).toHaveText('Elige un área');
  await urlLimpia(page);
  await volverA(page, 'Video').click();
  await expect(paso(page)).toHaveText(CAJA);
  expect(rutaDe(page)).toBe(URL_DEL_INICIO);
});

test('?blotato=conectar sigue abriendo el diálogo aunque llegue con ?desde=…&ver=…, y la URL solo pierde lo del recorrido', async ({ page }) => {
  await simular(page, { blotato: 'sin-conectar' });
  await page.goto(`${URL_DEL_INICIO}?desde=mkt.blotato.agenda&ver=grupos&blotato=conectar`);
  const dialogo = page.getByRole('dialog', { name: 'Conecta tu Blotato' });
  await expect(dialogo).toBeVisible();
  await expect.poll(() => new URL(page.url()).search).toBe('?blotato=conectar');
  // el diálogo es modal: tiene el foco (no se lo lleva el título de la tarjeta) y deja a la tarjeta fuera del árbol de accesibilidad
  await expect(dialogo.getByLabel('Tu clave de API de Blotato')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialogo).toBeHidden();
  await expect(paso(page)).toHaveText('Elige un grupo');
});
