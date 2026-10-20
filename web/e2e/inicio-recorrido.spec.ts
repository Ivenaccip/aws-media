// El inicio en un navegador de verdad (dueño, 15-oct-2026: «Mapa con Irremplazables», y en la segunda ronda «el mapa es el inicio»). Se
// aterriza en el MAPA en X; de ahí, tres opciones por área y, por último, la caja (Marketing › Distrito) o la lista de pantallas de un grupo.
// Solo la caja lleva tarjeta; «Irremplazables» va arriba de todo, fuera de ella y en el mismo lugar en todos los pasos. Lo que jsdom no ve y
// aquí sí:
//  · la geometría: el título no se mueve entre pasos; el mapa (y las opciones, y las listas) están centrados sin un cuadro alrededor, en
//    horizontal y en el alto que sobra; la tarjeta de la caja baja respecto de antes (a 64 px, pegada al saldo) y no se centra en vertical;
//  · las dos diagonales del mapa unen de verdad las cuatro esquinas por detrás de las fichas, y en un celular (por debajo de 560 px) la X se
//    vuelve compacta, centrada, sin desborde, con todo tocable de 44 px y «Automatizaciones» en una sola línea;
//  · nada se ve elegido: ni «Estás aquí» ni el tono de seleccionada en el mapa, y no hay «Volver a …» (las migas suben de nivel);
//  · la caja se queda montada con el mapa abierto: el texto escrito, el video subido y una subida en curso no se pierden;
//  · Blotato conectado, sin conectar y sin saberlo (con /api/blotato de mentira): apagado o encendido, y un clic en lo apagado
//    abre el diálogo de conectar en vez de navegar;
//  · el foco nunca cae a <body> al cambiar de paso, Tab recorre el mapa en orden de lectura, y Esc es de la región;
//  · desde una página aparte (la agenda…) la miga «Marketing» llega al mapa con la URL limpia, de punta a punta, y ahí SÍ hay un
//    «Volver a Agenda» (esa página no se alcanza con las migas).
// No gasta nada: el servidor y los servicios son rutas de mentira (e2e/recorrido.ts).
import { expect, test, type Page } from '@playwright/test';

import {
  abrirInicio,
  abrirLaCaja,
  algunVolver,
  elegir,
  enfocado,
  ficha,
  irA,
  irAlMapa,
  lineasDe,
  migas,
  opcion,
  paso,
  region,
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
/** Donde caía el borde de la tarjeta antes de esta ronda (el saldo es fijo arriba a la derecha y acaba a 52 px). */
const TARJETA_ANTES = 64;

const rutaDe = (page: Page) => new URL(page.url()).pathname;

/** Lo que se le pide a cada paso a cualquier ancho: nada se sale de la pantalla, todo lo tocable mide 44 px y la letra no baja de 13. */
async function auditar(page: Page, donde: string) {
  expect(await sobraAlLado(page), `${donde}: la página se arrastra de lado`).toBeLessThanOrEqual(0);
  const problemas = await region(page).evaluate(seccion => {
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

/** La geometría del paso de ahora: el título, el bloque (el `h2` y lo que le sigue) y la tarjeta, ya con las tipografías cargadas. */
async function medir(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const caja = (e: Element) => {
      const b = e.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height };
    };
    const h1 = document.querySelector('h1')!;
    const h2 = Array.from(document.querySelectorAll('h2')).find(h => !h.closest('[hidden]'))!;
    const tarjeta = document.querySelector('[data-limite-lista]')!;
    const paso = h2.parentElement!;
    // el bloque del paso sin tarjeta: del `h2` al final de lo último que trae (la X, las tres opciones o la lista)
    const contenido = paso.lastElementChild!;
    const mapa = document.querySelector('[role="group"][aria-label="Áreas"]');
    return {
      titulo: caja(h1),
      h2: caja(h2),
      tarjeta: caja(tarjeta),
      bloque: { top: h2.getBoundingClientRect().top, bottom: contenido.getBoundingClientRect().bottom },
      mapa: mapa ? caja(mapa) : null,
      alto: innerHeight,
      ancho: document.documentElement.clientWidth,
    };
  });
}

// ---------------------------------------------------------------------------
// aterrizar: el mapa es el inicio

test('se aterriza en el MAPA: «Elige un área», las cinco áreas, sin migas, sin «Volver a …» y con la caja escondida (montada)', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(paso(page)).toHaveText('Elige un área');
  const nombres = (await region(page).getByRole('group', { name: 'Áreas', exact: true }).getByRole('button').allTextContents()).map(t =>
    t.replace(/Próximamente/g, ''),
  );
  expect(nombres).toEqual([...AREAS]);
  await expect(migas(page)).toHaveCount(0);
  await expect(algunVolver(page)).toHaveCount(0);
  // la caja no se ve, pero está montada: su campo sigue en el árbol (escondido) esperando a que la elijan
  await expect(page.getByRole('textbox', { name: CAJA })).toBeHidden();
  await expect(page.locator('textarea')).toHaveCount(1);
  await expect(page.getByText('Elige un grupo')).toHaveCount(0);
  expect(rutaDe(page)).toBe(URL_DEL_INICIO);
  // aterrizar no le quita el foco a la página (solo entrar por la miga de otra pantalla lo pone en el título del paso)
  expect((await enfocado(page)).etiqueta).toBe('body');
});

test('nada se ve elegido en el mapa: ninguna ficha lleva «Estás aquí» ni aria-current, y Marketing y Central se ven EXACTAMENTE igual', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
  for (const area of AREAS) await expect(ficha(page, area), area).not.toHaveAttribute('aria-current', /./);
  // el tono de las dos que se abren: el mismo borde y el mismo fondo (el de hoy de «Central»); las apagadas, distintas (más hondas)
  const tono = (area: string) => ficha(page, area).evaluate(b => ({ fondo: getComputedStyle(b).backgroundColor, borde: getComputedStyle(b).borderTopColor }));
  const marketing = await tono('Marketing');
  expect(marketing).toEqual(await tono('Central'));
  expect(marketing).toEqual(await tono('Automatizaciones'));
  const apagada = await tono('Producto');
  expect(apagada.fondo, 'las apagadas se distinguen de las que se abren').not.toBe(marketing.fondo);
  // y después de haber estado en la caja de Marketing, el mapa tampoco la marca
  await elegir(page, 'Marketing', 'Distrito');
  await irAlMapa(page);
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
  expect(await tono('Marketing')).toEqual(marketing);
  for (const area of AREAS) await expect(ficha(page, area), area).not.toHaveAttribute('aria-current', /./);
});

test('con el ratón encima una ficha que se abre sí cambia de tono (el hover se conserva) y se enfoca con aro visible', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  const fondo = () => ficha(page, 'Marketing').evaluate(b => getComputedStyle(b).backgroundColor);
  const reposo = await fondo();
  await ficha(page, 'Marketing').hover();
  await expect.poll(fondo).not.toBe(reposo);
  await page.mouse.move(0, 0);
  await expect.poll(fondo).toBe(reposo);
  // con el teclado (el aro de foco es `:focus-visible`): desde el título del paso, Tab llega a Marketing y se ve su aro
  await paso(page).focus();
  await page.keyboard.press('Tab');
  await expect(ficha(page, 'Marketing')).toBeFocused();
  expect(await ficha(page, 'Marketing').evaluate(b => getComputedStyle(b).outlineStyle), 'sin aro de foco').not.toBe('none');
});

// ---------------------------------------------------------------------------
// el título arriba y la geometría de cada paso

const VENTANAS = [
  { ancho: 1100, alto: 800 },
  { ancho: 1440, alto: 900 },
  { ancho: 390, alto: 844 },
  { ancho: 320, alto: 740 },
] as const;

for (const { ancho, alto } of VENTANAS) {
  test(`a ${ancho}×${alto} «Irremplazables» está arriba, fuera de la tarjeta, y NO se mueve entre el mapa, las opciones, la lista y la caja`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    await simular(page);
    await abrirInicio(page);
    const pasos: Array<[string, Awaited<ReturnType<typeof medir>>]> = [];
    pasos.push(['el mapa', await medir(page)]);
    await ficha(page, 'Marketing').click();
    pasos.push(['las opciones', await medir(page)]);
    await opcion(page, 'Marketing', 'Blotato').click();
    pasos.push(['la lista de Blotato', await medir(page)]);
    await irA(page, 'Marketing', 'Distrito');
    pasos.push(['la caja', await medir(page)]);

    const [, primero] = pasos[0]!;
    for (const [donde, m] of pasos) {
      expect(m.titulo.top, `${donde}: el título se movió (arriba)`).toBeCloseTo(primero.titulo.top, 0);
      expect(m.titulo.height, `${donde}: el título cambió de alto`).toBeCloseTo(primero.titulo.height, 0);
      expect(m.titulo.left + m.titulo.width / 2, `${donde}: el título no está centrado`).toBeCloseTo(m.ancho / 2, 0);
      // arriba de todo: debajo del saldo (que es fijo y acaba a 52 px) y mucho antes de la mitad de la pantalla
      expect(m.titulo.top, `${donde}: el título quedó pegado al saldo`).toBeGreaterThanOrEqual(64);
      expect(m.titulo.bottom, `${donde}: el título no está arriba`).toBeLessThan(m.alto / 4);
    }
    // el mismo título, dentro de la región, y la tarjeta (con la caja) empieza DEBAJO de él: no lo rodea
    const [, caja] = pasos[3]!;
    expect(caja.tarjeta.top, 'la tarjeta de la caja no empieza debajo del título').toBeGreaterThanOrEqual(caja.titulo.bottom + 24);
    expect(await sobraAlLado(page)).toBeLessThanOrEqual(0);
  });

  test(`a ${ancho}×${alto} la tarjeta de la caja queda MÁS ABAJO que antes (no pegada arriba, a ${TARJETA_ANTES} px) y no se centra en vertical`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    await simular(page);
    await abrirLaCaja(page);
    const m = await medir(page);
    // antes el borde caía a 64 px, pegado al saldo; ahora, debajo del título y con aire: al menos 80 px más abajo
    expect(m.tarjeta.top, 'la tarjeta sigue pegada arriba').toBeGreaterThanOrEqual(TARJETA_ANTES + 80);
    // pero sigue siendo «arriba», con el contenido de la caja a la vista en la primera pantalla
    expect(m.tarjeta.top).toBeLessThan(m.alto / 3);
    // la caja misma (su título «¿Qué vamos a crear hoy?») baja también respecto de donde estaba (a 185 px a 1100×800; ahora a 233)
    expect(m.h2.top).toBeGreaterThanOrEqual(220);
    // con más alto de ventana la tarjeta no se mueve: no se está centrando
    const antes = m.tarjeta.top;
    await page.setViewportSize({ width: ancho, height: alto + 500 });
    expect((await medir(page)).tarjeta.top, 'con más alto de pantalla la tarjeta se movió: se está centrando en vertical').toBeCloseTo(antes, 0);
  });
}

for (const { ancho, alto } of [VENTANAS[0], VENTANAS[1]]) {
  test(`a ${ancho}×${alto} la tarjeta de la caja mide 820 px y va centrada en horizontal`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    await simular(page);
    await abrirLaCaja(page);
    const m = await medir(page);
    expect(m.tarjeta.width).toBeCloseTo(820, 0);
    expect(Math.abs(m.tarjeta.left + m.tarjeta.width / 2 - m.ancho / 2), 'la tarjeta no está centrada').toBeLessThanOrEqual(1);
  });
}

// El mapa, las opciones y la lista de un grupo ya no van dentro de una tarjeta (dueño: «ni debe de haber un cuadrado rodeando a todos»): el
// contenedor sigue ahí (es el límite de la lista de «Editar ▾») pero sin borde, fondo ni relleno; con la caja sí los lleva.
test('el mapa, las opciones y la lista de un grupo no tienen ningún cuadro alrededor; la caja sí lo tiene (borde, fondo y relleno)', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  const estilo = () =>
    tarjeta(page).evaluate(e => {
      const c = getComputedStyle(e);
      return { borde: c.borderTopWidth, fondo: c.backgroundColor, relleno: c.paddingTop, sombra: c.boxShadow };
    });
  const SIN = { borde: '0px', fondo: 'rgba(0, 0, 0, 0)', relleno: '0px', sombra: 'none' };
  expect(await estilo(), 'el mapa tiene un cuadro').toEqual(SIN);
  await ficha(page, 'Marketing').click();
  expect(await estilo(), 'las opciones tienen un cuadro').toEqual(SIN);
  await opcion(page, 'Marketing', 'Blotato').click();
  expect(await estilo(), 'la lista tiene un cuadro').toEqual(SIN);
  await irA(page, 'Marketing', 'Distrito');
  const conCaja = await estilo();
  expect(conCaja.borde).toBe('1px');
  expect(conCaja.fondo).not.toBe('rgba(0, 0, 0, 0)');
  expect(conCaja.relleno).toBe('24px');
  // y al salir de la caja el cuadro se va
  await irAlMapa(page);
  expect(await estilo(), 'el mapa, tras la caja, volvió a tener cuadro').toEqual(SIN);
});

// «debe de estar centrado»: horizontalmente y en el alto que sobra bajo el título (huecos arriba y abajo parecidos). La unidad centrada es lo que
// se ve bajo el título: «Elige un área» y la X juntos. (El hueco se mide del borde de abajo del título al de arriba del bloque, y del de abajo
// del bloque al borde de la ventana.)
for (const { ancho, alto } of VENTANAS) {
  test(`a ${ancho}×${alto} el mapa («Elige un área» y la X) está centrado: en horizontal y con huecos parecidos arriba y abajo`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    await simular(page);
    await abrirInicio(page);
    const m = await medir(page);
    const arriba = m.bloque.top - m.titulo.bottom;
    const abajo = m.alto - m.bloque.bottom;
    expect(Math.abs(arriba - abajo), `huecos de ${arriba.toFixed(1)} px arriba y ${abajo.toFixed(1)} px abajo`).toBeLessThanOrEqual(8);
    expect(arriba, 'el mapa se pegó al título').toBeGreaterThanOrEqual(24);
    // en horizontal: el centro de la X es el centro de la ventana
    const x = m.mapa!;
    expect(Math.abs(x.left + x.width / 2 - m.ancho / 2), 'la X no está centrada en horizontal').toBeLessThanOrEqual(1);
    // el título también (y el h2 «Elige un área»)
    expect(Math.abs(m.h2.left + m.h2.width / 2 - m.ancho / 2), '«Elige un área» no está centrado').toBeLessThanOrEqual(1);
    // sin desborde ni nada que se corte por abajo: la página no pasa del alto de la ventana
    expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight), 'la página se desplaza en vertical').toBeLessThanOrEqual(0);
    expect(await sobraAlLado(page)).toBeLessThanOrEqual(0);
  });
}

test('las opciones también quedan centradas en horizontal y en el alto que sobra bajo las migas (a 1100×800 y 1440×900)', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await ficha(page, 'Marketing').click();
  for (const { ancho, alto } of [VENTANAS[0], VENTANAS[1]]) {
    await page.setViewportSize({ width: ancho, height: alto });
    const m = await medir(page);
    const filaDeMigas = (await migas(page).boundingBox())!;
    const arriba = m.bloque.top - (filaDeMigas.y + filaDeMigas.height);
    const abajo = m.alto - m.bloque.bottom;
    expect(Math.abs(arriba - abajo), `a ${ancho}×${alto}: ${arriba.toFixed(1)} px arriba y ${abajo.toFixed(1)} px abajo`).toBeLessThanOrEqual(8);
    // las migas, centradas bajo el título (en los pasos sin tarjeta); no a la izquierda
    expect(Math.abs(filaDeMigas.x + filaDeMigas.width / 2 - m.ancho / 2), 'las migas no están centradas').toBeLessThanOrEqual(1);
    expect(filaDeMigas.y).toBeGreaterThanOrEqual(m.titulo.bottom);
    expect(m.bloque.top, 'las opciones quedaron arriba de las migas').toBeGreaterThan(filaDeMigas.y + filaDeMigas.height);
  }
});

test('las migas van DENTRO de la tarjeta, arriba y a la izquierda, mientras se ve la caja', async ({ page }) => {
  await simular(page);
  await abrirLaCaja(page);
  const t = (await tarjeta(page).boundingBox())!;
  const m = (await migas(page).boundingBox())!;
  expect(m.x, 'las migas no están dentro de la tarjeta').toBeGreaterThanOrEqual(t.x);
  expect(m.x + m.width).toBeLessThanOrEqual(t.x + t.width);
  expect(m.y).toBeGreaterThanOrEqual(t.y);
  expect(m.x - t.x, 'las migas van centradas en vez de a la izquierda').toBeLessThanOrEqual(40);
  await expect(migas(page).getByRole('button')).toHaveText(['Marketing', 'Distrito']);
  await expect(migas(page).getByRole('button').nth(1)).toHaveAttribute('aria-current', 'step');
  await expect(algunVolver(page)).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// el mapa

for (const ancho of [1100, 600]) {
  test(`a ${ancho} px la X une las cuatro esquinas pasando por Central, por detrás de las fichas`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 900 });
    await simular(page);
    await abrirInicio(page);
    await expect(region(page).getByText('Estás aquí')).toHaveCount(0);

    const caja = async (area: string) => (await ficha(page, area).boundingBox())!;
    const [marketing, producto, central, ventas, automatizaciones] = await Promise.all(AREAS.map(caja));
    type Caja = NonNullable<typeof marketing>;
    const dentro = (p: { x: number; y: number }, c: Caja) => p.x >= c.x && p.x <= c.x + c.width && p.y >= c.y && p.y <= c.y + c.height;

    // los extremos de cada línea, ya en coordenadas de pantalla, y lo que hay encima de ellos
    const lineas = await region(page)
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
    const capas = await region(page)
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

test('Producto y Ventas son fichas inertes: se ven, se enfocan y no se abren', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  for (const area of ['Producto', 'Ventas']) {
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
  for (const area of ['Marketing', 'Central', 'Automatizaciones']) {
    await expect(ficha(page, area)).not.toHaveAttribute('aria-disabled', 'true');
    await expect(ficha(page, area)).not.toContainText('Próximamente');
  }
  expect(rutaDe(page)).toBe(URL_DEL_INICIO);
});

// ---------------------------------------------------------------------------
// Automatizaciones (20-oct-2026): el área se enciende con dos grupos

test('Automatizaciones: Distrito trae Constructor y Asistente (enlaces) y «Actualizar flujos» («Próximamente», quieta); «Tus automatizaciones» dice que todavía no está disponible', async ({ page }) => {
  await simular(page, { blotato: 'sin-conectar' });
  await abrirInicio(page);
  await ficha(page, 'Automatizaciones').click();
  await expect(paso(page)).toHaveText('Elige un grupo');
  await expect(region(page).getByRole('group', { name: 'Automatizaciones', exact: true }).getByRole('button')).toHaveText([/^Distrito/, /^Tus automatizaciones/]);
  await expect(opcion(page, 'Automatizaciones', 'Distrito')).toContainText('Constructor · Asistente · Actualizar flujos');
  await expect(opcion(page, 'Automatizaciones', 'Tus automatizaciones')).toContainText('Próximamente');
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);

  await opcion(page, 'Automatizaciones', 'Distrito').click();
  await expect(paso(page)).toHaveText('Distrito');
  await expect(migas(page).getByRole('button')).toHaveText(['Automatizaciones', 'Distrito']);
  await expect(region(page).getByRole('link')).toHaveText([/^Constructor/, /^Asistente/]);
  await expect(region(page).getByRole('link', { name: /^Constructor/ })).toHaveAttribute('href', '/estudio/constructor/');
  await expect(region(page).getByRole('link', { name: /^Asistente/ })).toHaveAttribute('href', '/estudio/asistente/');
  // no depende de Blotato: aun sin clave no se apaga nada ni hay botón de conectar
  await expect(region(page).getByRole('link', { name: /Constructor/ })).not.toHaveAttribute('aria-disabled', 'true');
  await expect(region(page).getByRole('button', { name: /Blotato/ })).toHaveCount(0);
  const apagada = region(page).getByText('Actualizar flujos', { exact: true });
  await expect(apagada).toBeVisible();
  await apagada.click();
  await expect(paso(page), '«Actualizar flujos» navegó').toHaveText('Distrito');
  await expect(region(page).getByText('Próximamente')).toHaveCount(1);
  expect(rutaDe(page)).toBe(URL_DEL_INICIO);

  // el otro grupo, sin pantallas
  await migas(page).getByRole('button', { name: /^Volver a las opciones de Automatizaciones/ }).click();
  await expect(opcion(page, 'Automatizaciones', 'Distrito')).toContainText('Estás aquí');
  await opcion(page, 'Automatizaciones', 'Tus automatizaciones').click();
  await expect(paso(page)).toHaveText('Tus automatizaciones');
  await expect(region(page).getByText('Todavía no está disponible.')).toBeVisible();
  await expect(paso(page)).toBeFocused();
  // Esc en el contenido no hace nada; las migas suben de nivel
  await page.keyboard.press('Escape');
  await expect(paso(page)).toHaveText('Tus automatizaciones');
  await irAlMapa(page);
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
  // mirar Marketing no marca su «Distrito»: estás en el de Automatizaciones
  await ficha(page, 'Marketing').click();
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
});

test('Automatizaciones: Esc en sus opciones sube al mapa, y un doble clic en la ficha no elige un grupo por accidente', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await ficha(page, 'Automatizaciones').click();
  await expect(paso(page)).toHaveText('Elige un grupo');
  await expect(paso(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(paso(page)).toHaveText('Elige un área');
  await expect(paso(page)).toBeFocused();
  // el segundo clic de un doble clic cae donde apareció una tarjeta (o en un hueco): no elige nada
  await ficha(page, 'Automatizaciones').dblclick();
  await expect(paso(page)).toHaveText('Elige un grupo');
  await expect(region(page).getByRole('link')).toHaveCount(0);
});

test('un doble clic en una ficha del mapa abre las opciones y no elige un grupo por accidente', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
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
    await abrirLaCaja(page);
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
      await region(page).getByRole('button', { name: 'Conecta tu cuenta de Blotato' }).dblclick();
      await expect(page.getByRole('dialog', { name: 'Conecta tu Blotato' })).toBeVisible();
    }
  });
}

// ---------------------------------------------------------------------------
// las tres opciones

test('elegir Marketing da tres opciones, con las pantallas de cada una y SIN «Estás aquí»: nadie ha elegido nada', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await ficha(page, 'Marketing').click();
  await expect(paso(page)).toHaveText('Elige un grupo');
  const tres = region(page).getByRole('group', { name: 'Marketing', exact: true }).getByRole('button');
  await expect(tres).toHaveCount(3);
  await expect(opcion(page, 'Marketing', 'Distrito')).toContainText('Imagen · Video · Edición');
  await expect(opcion(page, 'Marketing', 'Blotato')).toContainText('Agenda tus publicaciones · Investiga tu competencia · Ver mis métricas');
  await expect(opcion(page, 'Marketing', 'Avanzado')).toContainText('Publicaciones automáticas · Copiadora de estilos');
  // el grupo de la caja escondida no se marca: sería el mismo «parece seleccionado» que se quitó del mapa
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
  for (const g of ['Distrito', 'Blotato', 'Avanzado']) await expect(opcion(page, 'Marketing', g), g).not.toHaveAttribute('aria-current', /./);
  // la miga del área es donde estás en este paso; no hay «Volver a …»
  await expect(migas(page).getByRole('button')).toHaveText(['Marketing']);
  await expect(migas(page).getByRole('button')).toHaveAttribute('aria-current', 'step');
  await expect(algunVolver(page)).toHaveCount(0);
});

test('después de elegir un grupo, las opciones sí dicen dónde estás: «Estás aquí» en ESE grupo', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await elegir(page, 'Marketing', 'Blotato');
  await migas(page).getByRole('button', { name: /^Volver a las opciones/ }).click();
  await expect(paso(page)).toHaveText('Elige un grupo');
  await expect(opcion(page, 'Marketing', 'Blotato')).toContainText('Estás aquí');
  await expect(opcion(page, 'Marketing', 'Blotato')).toHaveAttribute('aria-current', 'location');
  await expect(region(page).getByText('Estás aquí')).toHaveCount(1);
});

// ---------------------------------------------------------------------------
// la caja se queda montada

for (const [familia, campo] of [
  ['Imagen', CAJA],
  ['Video', CAJA],
  ['Edición', 'Cuéntale a la IA qué quieres'],
] as const) {
  test(`«${familia}»: abrir el mapa y volver a la caja por Marketing › Distrito deja el texto escrito y la pestaña como estaban`, async ({ page }) => {
    await simular(page);
    await abrirLaCaja(page);
    await riel(page, familia).click();
    const cuadro = page.getByRole('textbox', { name: campo });
    await cuadro.fill('un gato jugando en la nieve');
    await irAlMapa(page);
    // escondida, no desmontada: no se ve ni se enfoca, pero sigue ahí con lo suyo
    await expect(cuadro).toBeHidden();
    await expect(page.locator('textarea')).toHaveCount(1);
    await expect(algunVolver(page)).toHaveCount(0);
    await elegir(page, 'Marketing', 'Distrito');
    await expect(paso(page)).toHaveText(CAJA);
    await expect(cuadro).toHaveValue('un gato jugando en la nieve');
    await expect(riel(page, familia)).toHaveAttribute('aria-pressed', 'true');
  });
}

test('mapa → Marketing → Distrito lleva a la caja con el texto, y el foco va a su título', async ({ page }) => {
  await simular(page);
  await abrirLaCaja(page);
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
  await abrirLaCaja(page);
  await riel(page, 'Edición').click();
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.getByRole('option', { name: /De videos a Shorts/ }).click();
  const liga = page.getByRole('textbox', { name: 'Liga de YouTube' });
  await liga.fill('https://www.youtube.com/watch?v=abc123DEF45');
  await irAlMapa(page);
  await expect(liga).toBeHidden();
  await elegir(page, 'Marketing', 'Distrito');
  await expect(liga).toHaveValue('https://www.youtube.com/watch?v=abc123DEF45');
  await expect(page.locator('button[aria-haspopup="listbox"]')).toContainText('De videos a Shorts');
});

test('una subida en curso sigue con el mapa abierto, y el video listo y su precio están al volver', async ({ page }) => {
  let soltar!: () => void;
  const puerta = new Promise<void>(resolver => (soltar = resolver));
  await simular(page);
  await simularSubida(page, puerta);
  await abrirLaCaja(page);
  await riel(page, 'Edición').click();
  const subida = page.waitForRequest('**/s3-falso/subida');
  await page.locator('input[type="file"]').setInputFiles(VIDEO);
  await subida;
  // sube (el PUT está esperando) y se abre el mapa: la caja se esconde con la subida adentro
  await irAlMapa(page);
  // la subida termina (y pide el precio) con el mapa abierto, sin que la caja se vea
  const precio = page.waitForResponse('**/api/edicion/cotizar');
  soltar();
  await precio;
  await elegir(page, 'Marketing', 'Distrito');
  await expect(page.getByRole('button', { name: 'Iniciar ✦ 8' })).toBeVisible();
  await expect(page.getByText('entrevista.mp4')).toBeVisible();
});

test('«Mis creaciones» se ve solo con la caja a la vista (al abrir, en el mapa, las opciones y las listas se esconde; con la caja, aparece)', async ({ page }) => {
  await simular(page, { imagenes: 2 });
  await abrirInicio(page);
  const creaciones = page.getByRole('region', { name: 'Mis creaciones' });
  await expect(creaciones, 'al abrir, en el mapa').toBeHidden();
  await ficha(page, 'Marketing').click();
  await expect(creaciones, 'en las opciones').toBeHidden();
  await opcion(page, 'Marketing', 'Blotato').click();
  await expect(creaciones, 'en la lista de Blotato').toBeHidden();
  // sigue montada: la galería no pierde su filtro ni su visor
  await expect(page.locator('#creaciones-titulo')).toHaveCount(1);
  await irA(page, 'Marketing', 'Distrito');
  await expect(creaciones).toBeVisible();
  await irAlMapa(page);
  await expect(creaciones, 'de vuelta en el mapa').toBeHidden();
});

test('«Tu primer video, en tres caminos» (quien empieza) también se esconde fuera de la caja', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  const caminos = page.getByRole('region', { name: 'Tu primer video, en tres caminos' });
  await expect(caminos).toBeHidden();
  await elegir(page, 'Marketing', 'Distrito');
  await expect(caminos).toBeVisible();
  await irAlMapa(page);
  await expect(caminos).toBeHidden();
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
    const enlaces = region(page).getByRole('link');
    await expect(enlaces).toHaveCount(3);
    for (const [i, titulo] of LISTA_DE_BLOTATO.entries()) {
      const e = enlaces.nth(i);
      await expect(e).toContainText(titulo);
      await expect(e).toHaveAttribute('aria-disabled', 'true');
      await expect(e).toContainText('Conecta tu Blotato para usarlo');
      await expect(e).toHaveCSS('opacity', '0.6');
    }
    const conectar = region(page).getByRole('button', { name: 'Conecta tu cuenta de Blotato' });
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
    await region(page).getByRole('button', { name: 'Conecta tu cuenta de Blotato' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Conecta tu Blotato' });
    await dialogo.getByLabel('Tu clave de API de Blotato').fill('clave-de-prueba');
    await dialogo.getByRole('button', { name: 'Conectar' }).click();
    // ya conectado, el diálogo cambia de título («Tu Blotato»): es el mismo, ahora sin el formulario
    const conectado = page.getByRole('dialog', { name: 'Tu Blotato' });
    await expect(conectado.getByText('Tu Blotato está conectado')).toBeVisible();
    expect(claves).toEqual(['clave-de-prueba']);
    await page.keyboard.press('Escape');
    await expect(conectado).toBeHidden();
    const enlaces = region(page).getByRole('link');
    for (let i = 0; i < 3; i++) await expect(enlaces.nth(i)).not.toHaveAttribute('aria-disabled', 'true');
    await expect(region(page).getByText('Conecta tu Blotato para usarlo')).toHaveCount(0);
    await expect(region(page).getByRole('button', { name: 'Blotato conectado: ver o cambiar' })).toBeVisible();
  });
});

test.describe('Blotato conectado', () => {
  test('las tres pantallas salen encendidas y llevan a su página; el botón dice «Blotato conectado: ver o cambiar»', async ({ page }) => {
    await simular(page, { blotato: 'conectado' });
    await abrirInicio(page);
    await irA(page, 'Marketing', 'Blotato');
    const enlaces = region(page).getByRole('link');
    await expect(enlaces).toHaveCount(3);
    for (const [i, titulo] of LISTA_DE_BLOTATO.entries()) {
      await expect(enlaces.nth(i)).toContainText(titulo);
      await expect(enlaces.nth(i)).not.toHaveAttribute('aria-disabled', 'true');
      await expect(enlaces.nth(i)).not.toContainText('Conecta tu Blotato');
    }
    const boton = region(page).getByRole('button', { name: 'Blotato conectado: ver o cambiar' });
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
    const enlaces = region(page).getByRole('link');
    await expect(enlaces).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(enlaces.nth(i)).not.toHaveAttribute('aria-disabled', 'true');
    await expect(region(page).getByText('Conecta tu Blotato para usarlo')).toHaveCount(0);
    await Promise.all([page.waitForURL(/\/estudio\/competencia\//), enlaces.nth(1).click()]);
  });
});

test('Avanzado: «Publicaciones automáticas» se apaga sin Blotato y abre el diálogo; la «Copiadora de estilos» no, y no hay botón de conectar', async ({ page }) => {
  await simular(page, { blotato: 'sin-conectar' });
  await abrirInicio(page);
  await irA(page, 'Marketing', 'Avanzado');
  await expect(paso(page)).toHaveText('Avanzado');
  // el botón de conectar solo va en un grupo que depende ENTERO de Blotato; Avanzado trae la Copiadora, que no
  await expect(region(page).getByRole('button', { name: /Blotato/ })).toHaveCount(0);
  const mix = region(page).getByRole('link', { name: /Publicaciones automáticas/ });
  const copiadora = region(page).getByRole('link', { name: /Copiadora de estilos/ });
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

test('Central: el grupo Distrito trae dos pantallas «Próximamente» que no navegan y COI y la Biblioteca de prompts (encendidas) que sí, y Deepseek dice que todavía no está disponible', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await ficha(page, 'Central').click();
  await expect(paso(page)).toHaveText('Elige un grupo');
  await expect(region(page).getByRole('group', { name: 'Central', exact: true }).getByRole('button')).toHaveText([/^Distrito/, /^Deepseek/]);
  await expect(opcion(page, 'Central', 'Deepseek')).toContainText('Próximamente');
  // nadie ha elegido nada: «Estás aquí» no está en ninguna de sus opciones
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);

  await opcion(page, 'Central', 'Distrito').click();
  await expect(paso(page)).toHaveText('Distrito');
  await expect(migas(page).getByRole('button')).toHaveText(['Central', 'Distrito']);
  // COI y la Biblioteca (16-oct-2026) ya existen y son enlaces (su navegación la prueban e2e/coi.spec.ts y e2e/biblioteca.spec.ts); las otras dos siguen apagadas y no navegan
  for (const titulo of ['COI', 'Biblioteca de prompts']) await expect(region(page).getByText(titulo, { exact: true })).toBeVisible();
  for (const titulo of ['Preguntas sobre la clase', 'Glosario IA']) {
    const fila = region(page).getByText(titulo, { exact: true });
    await expect(fila).toBeVisible();
    await fila.click();
    await expect(paso(page), `«${titulo}» navegó`).toHaveText('Distrito');
  }
  await expect(region(page).getByText('Próximamente')).toHaveCount(2);
  await expect(region(page).getByRole('link')).toHaveText([/^COI/, /^Biblioteca de prompts/]);
  await expect(region(page).getByRole('link', { name: /^COI/ })).toHaveAttribute('href', '/estudio/coi/');
  await expect(region(page).getByRole('link', { name: /^Biblioteca de prompts/ })).toHaveAttribute('href', '/estudio/biblioteca/');
  expect(rutaDe(page)).toBe(URL_DEL_INICIO);

  // ahora SÍ se eligió Central › Distrito: el mapa no marca nada (nunca marca), pero las opciones de Central dicen dónde estás
  await irAlMapa(page);
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
  await ficha(page, 'Central').click();
  await expect(opcion(page, 'Central', 'Distrito')).toContainText('Estás aquí');
  await expect(region(page).getByText('Estás aquí')).toHaveCount(1);
  // y mirar Marketing, que no es donde estás, no marca nada
  await irAlMapa(page);
  await ficha(page, 'Marketing').click();
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
  await irAlMapa(page);
  await elegir(page, 'Central', 'Deepseek');
  await expect(paso(page)).toHaveText('Deepseek');
  await expect(region(page).getByText('Todavía no está disponible.')).toBeVisible();
});

// ---------------------------------------------------------------------------
// teclado y foco

test('Esc: en el mapa no hace nada, en las opciones sube al mapa, en la caja y en una lista no hace nada', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);

  // en el mapa (lo primero que se ve): nada, aunque el foco esté en una ficha
  await ficha(page, 'Marketing').focus();
  await page.keyboard.press('Escape');
  await expect(paso(page)).toHaveText('Elige un área');
  await expect(ficha(page, 'Marketing')).toBeFocused();

  // en las opciones sube un nivel: al mapa, con el foco en su título (no a <body>)
  await ficha(page, 'Central').click();
  await expect(paso(page)).toHaveText('Elige un grupo');
  await page.keyboard.press('Escape');
  await expect(paso(page)).toHaveText('Elige un área');
  await expect(paso(page)).toBeFocused();

  // en la caja: nada (ni cambia de paso ni borra lo escrito)
  await elegir(page, 'Marketing', 'Distrito');
  const cuadro = page.getByRole('textbox', { name: CAJA });
  await cuadro.fill('texto que no se pierde');
  await cuadro.focus();
  await page.keyboard.press('Escape');
  await expect(paso(page)).toHaveText(CAJA);
  await expect(cuadro).toBeFocused();
  await expect(cuadro).toHaveValue('texto que no se pierde');

  // en las opciones, venidas de la caja, también al MAPA (no «regresa a la caja»: ya no hay a dónde regresar)
  await migas(page).getByRole('button', { name: /^Volver a las opciones/ }).click();
  await expect(paso(page)).toHaveText('Elige un grupo');
  await page.keyboard.press('Escape');
  await expect(paso(page)).toHaveText('Elige un área');
  expect(rutaDe(page)).toBe(URL_DEL_INICIO);

  // en la lista de un grupo: nada
  await elegir(page, 'Marketing', 'Blotato');
  await page.keyboard.press('Escape');
  await expect(paso(page)).toHaveText('Blotato');
});

test('Esc es de la región y no de la página: con el foco fuera de ella no mueve el recorrido', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await ficha(page, 'Marketing').click();
  await expect(paso(page)).toHaveText('Elige un grupo');
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  expect((await enfocado(page)).etiqueta).toBe('body');
  await page.keyboard.press('Escape');
  await expect(paso(page)).toHaveText('Elige un grupo');
});

test('el foco no se pierde en <body> al cambiar de paso con el ratón: va al título del paso nuevo', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  const alTitulo = async (texto: string) => {
    await expect(paso(page)).toHaveText(texto);
    await expect(paso(page)).toBeFocused();
  };
  await ficha(page, 'Marketing').click();
  await alTitulo('Elige un grupo');
  await opcion(page, 'Marketing', 'Blotato').click();
  await alTitulo('Blotato');
  await migas(page).getByRole('button', { name: /^Volver al mapa/ }).click();
  await alTitulo('Elige un área');
  await ficha(page, 'Marketing').click();
  await alTitulo('Elige un grupo');
  await opcion(page, 'Marketing', 'Blotato').click();
  await alTitulo('Blotato');
  await migas(page).getByRole('button', { name: /^Volver a las opciones/ }).click();
  await alTitulo('Elige un grupo');
  await opcion(page, 'Marketing', 'Distrito').click();
  await alTitulo(CAJA);
  await migas(page).getByRole('button', { name: /^Volver al mapa/ }).click();
  await alTitulo('Elige un área');
});

// Lo pulsado puede no mover el foco (la acción «hacer clic» de un lector en modo exploración, el control por voz, un `.click()`): el campo de
// la caja sigue siendo `activeElement` en el instante en que la caja se esconde, y Chromium lo suelta a <body> un momento después. Sin cuidado,
// el foco acababa en <body>, Esc no llegaba a la región y el lector no oía «Elige un área».
test('el foco que estaba DENTRO de la caja al abrir el mapa sin mover el foco (.click()) no cae a <body>: va al título, y Esc sigue valiendo', async ({ page }) => {
  await simular(page);
  await abrirLaCaja(page);
  const abrirElMapaSinMoverElFoco = () => migas(page).getByRole('button', { name: /^Volver al mapa/ }).evaluate(b => (b as HTMLButtonElement).click());
  for (const [desde, alcanzar] of [
    ['el cuadro de texto', () => page.getByRole('textbox', { name: CAJA }).focus()],
    ['el chip «Un video corto ▾»', () => page.locator('button[aria-haspopup="listbox"]').focus()],
  ] as const) {
    await alcanzar();
    await abrirElMapaSinMoverElFoco();
    await expect(paso(page), `desde ${desde}`).toHaveText('Elige un área');
    await expect(paso(page), `desde ${desde}: el foco se perdió`).toBeFocused();
    // un instante después (cuando el navegador suelta lo que quedó escondido) sigue ahí
    await page.waitForTimeout(300);
    expect((await enfocado(page)).etiqueta, `desde ${desde}: el foco cayó a <body>`).toBe('h2');
    // y Esc sigue llegando a la región: desde las opciones sube al mapa (en el mapa no hay a dónde subir)
    await ficha(page, 'Marketing').click();
    await page.keyboard.press('Escape');
    await expect(paso(page), `desde ${desde}: Esc no subió`).toHaveText('Elige un área');
    await expect(paso(page)).toBeFocused();
    await elegir(page, 'Marketing', 'Distrito');
    await expect(paso(page)).toHaveText(CAJA);
    // la caja de nuevo: se vuelve a empezar por la otra
  }
});

test('Tab recorre el mapa en orden de lectura: solo las cinco fichas, y la sexta salida es de la región', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  // el título del mapa se enfoca con código (tabindex -1): de ahí, Tab va a la primera ficha
  await paso(page).focus();
  const paradas = [];
  for (let i = 0; i < AREAS.length; i++) {
    await page.keyboard.press('Tab');
    paradas.push(await enfocado(page));
  }
  const nombre = (p: { texto: string }) => p.texto.replace(/(Estás aquí|Próximamente)$/, '');
  expect(paradas.map(nombre)).toEqual([...AREAS]);
  // ni migas ni «Volver a …» que tabular: la siguiente parada ya no es de la región
  await page.keyboard.press('Tab');
  expect(await region(page).evaluate(r => r.contains(document.activeElement))).toBe(false);
});

test('con solo el teclado: Enter en una ficha y en una tarjeta cambian de paso, y Tab sigue desde el título nuevo', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await ficha(page, 'Marketing').focus();
  await page.keyboard.press('Enter');
  await expect(paso(page)).toHaveText('Elige un grupo');
  await expect(paso(page)).toBeFocused();
  // Tab sigue desde el título (que no es tabulable): la primera tarjeta; la miga del área, que está antes en la página, queda atrás
  await page.keyboard.press('Tab');
  expect((await enfocado(page)).texto).toMatch(/^Distrito/);
  await page.keyboard.press('Shift+Tab');
  expect((await enfocado(page)).texto).toBe('Marketing');
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
      // centrada en horizontal: la X ocupa la pantalla de margen a margen y su centro es el de la ventana
      const izquierda = Math.min(...AREAS.map(a => c[a].x));
      const derecha = Math.max(...AREAS.map(a => c[a].x + c[a].width));
      expect(Math.abs((izquierda + derecha) / 2 - ancho / 2), 'la X compacta no está centrada').toBeLessThanOrEqual(1);

      // la X grande no se pinta; en su lugar, un trazo corto de cada esquina a la banda
      await expect(region(page).locator('svg[viewBox="0 0 100 100"]')).toBeHidden();
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

      // «Automatizaciones» y «Próximamente» no se parten y caben en su ficha
      const nombre = ficha(page, 'Automatizaciones').getByText('Automatizaciones', { exact: true });
      expect(await lineasDe(nombre), '«Automatizaciones» se parte en dos líneas').toBe(1);
      const sobra = await nombre.evaluate(el => {
        const t = el.getBoundingClientRect();
        const f = (el.closest('button') as HTMLElement).getBoundingClientRect();
        return { derecha: t.right - f.right, izquierda: f.left - t.left };
      });
      expect(sobra.derecha, '«Automatizaciones» se sale de su ficha').toBeLessThanOrEqual(0);
      expect(sobra.izquierda, '«Automatizaciones» se sale de su ficha').toBeLessThanOrEqual(0);
      expect(await lineasDe(ficha(page, 'Producto').getByText('Próximamente')), '«Próximamente» se parte').toBe(1);
      expect(await sobraAlLado(page)).toBeLessThanOrEqual(0);
    });

    test('cada paso (mapa, opciones, listas) cabe: sin desborde, lo tocable de 44 px y letra de 13 px o más', async ({ page }) => {
      await simular(page, { blotato: 'sin-conectar' });
      await abrirInicio(page);
      await auditar(page, 'el mapa');
      await ficha(page, 'Marketing').click();
      await auditar(page, 'las opciones de Marketing');
      // en una sola columna: cada tarjeta ocupa el ancho y no hay dos en una fila
      const columnas = await region(page).getByRole('group', { name: 'Marketing', exact: true }).getByRole('button').evaluateAll(bs => bs.map(b => b.getBoundingClientRect().x));
      expect(new Set(columnas.map(x => Math.round(x))).size, 'las opciones no se apilan en una columna').toBe(1);
      await opcion(page, 'Marketing', 'Blotato').click();
      await auditar(page, 'la lista de Blotato');
      await irA(page, 'Marketing', 'Avanzado');
      await auditar(page, 'la lista de Avanzado');
      await irA(page, 'Central', 'Distrito');
      await auditar(page, 'Central › Distrito');
      await irA(page, 'Central', 'Deepseek');
      await auditar(page, 'Central › Deepseek');
      await irA(page, 'Automatizaciones', 'Distrito');
      await auditar(page, 'Automatizaciones › Distrito');
      await irA(page, 'Automatizaciones', 'Tus automatizaciones');
      await auditar(page, 'Automatizaciones › Tus automatizaciones');
      await irAlMapa(page);
      await ficha(page, 'Automatizaciones').click();
      await auditar(page, 'las opciones de Automatizaciones');
      await irA(page, 'Marketing', 'Distrito');
      await auditar(page, 'la caja');
    });
  });
}

test('a 1100 px cada paso cumple lo mismo: sin desborde, lo tocable de 44 px y letra de 13 px o más', async ({ page }) => {
  await simular(page, { blotato: 'sin-conectar' });
  await abrirInicio(page);
  await auditar(page, 'el mapa');
  await ficha(page, 'Marketing').click();
  await auditar(page, 'las opciones de Marketing');
  await opcion(page, 'Marketing', 'Blotato').click();
  await auditar(page, 'la lista de Blotato');
  await irA(page, 'Central', 'Distrito');
  await auditar(page, 'Central › Distrito');
  await irA(page, 'Automatizaciones', 'Distrito');
  await auditar(page, 'Automatizaciones › Distrito');
  await irA(page, 'Marketing', 'Distrito');
  await auditar(page, 'la caja');
});

test('el mapa pasa de la X compacta a la X grande en el corte de 560 px, y a ningún ancho se desborda ni se parte «Automatizaciones»', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  const equis = region(page).locator('svg[viewBox="0 0 100 100"]');
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
    // se llega con el foco ya en el título del paso, no en <body>: de ahí Esc y Tab valen desde el primer toque
    await expect(paso(page)).toBeFocused();
    await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
    // el único «Volver a …» que queda: el de la página de donde se llegó, que no se alcanza con las migas
    const volver = volverA(page, hoja.titulo);
    await expect(volver).toBeVisible();
    await expect(algunVolver(page)).toHaveCount(1);
    await Promise.all([page.waitForURL(new RegExp(`/estudio/${hoja.ruta}/`)), volver.click()]);
  });

  test(`desde /estudio/${hoja.ruta}/: la miga «${hoja.grupo}» cae en «Elige un grupo» y marca ${hoja.grupo} como «Estás aquí» (venías de él)`, async ({ page }) => {
    await simular(page);
    await page.goto(`/estudio/${hoja.ruta}/`);
    await migaDeHoja(page, new RegExp(`^Ir a las opciones de Marketing \\(ahora: ${hoja.grupo}\\)`)).click();
    await expect(paso(page)).toHaveText('Elige un grupo');
    await urlLimpia(page);
    await expect(paso(page)).toBeFocused();
    await expect(region(page).getByText('Estás aquí')).toHaveCount(1);
    await expect(opcion(page, 'Marketing', hoja.grupo)).toContainText('Estás aquí');
    await expect(volverA(page, hoja.titulo)).toBeVisible();
  });
}

const HOJAS_DE_AUTOMATIZACIONES = [
  { lugar: 'automatizaciones.distrito.constructor', titulo: 'Constructor', href: '/estudio/constructor/' },
  { lugar: 'automatizaciones.distrito.asistente', titulo: 'Asistente', href: '/estudio/asistente/' },
] as const;

for (const hoja of HOJAS_DE_AUTOMATIZACIONES) {
  test(`?desde=${hoja.lugar}: con ver=mapa abre «Elige un área» y «Volver a ${hoja.titulo}» es un enlace a ${hoja.href}; con ver=grupos, las opciones de Automatizaciones con «Estás aquí» en Distrito`, async ({ page }) => {
    await simular(page);
    await abrirInicio(page, `${URL_DEL_INICIO}?desde=${hoja.lugar}&ver=mapa`);
    await expect(paso(page)).toHaveText('Elige un área');
    await urlLimpia(page);
    await expect(paso(page)).toBeFocused();
    await expect(volverA(page, hoja.titulo)).toHaveAttribute('href', hoja.href);
    await expect(algunVolver(page)).toHaveCount(1);
    await abrirInicio(page, `${URL_DEL_INICIO}?desde=${hoja.lugar}&ver=grupos`);
    await expect(paso(page)).toHaveText('Elige un grupo');
    await expect(opcion(page, 'Automatizaciones', 'Distrito')).toContainText('Estás aquí');
    await expect(region(page).getByText('Estás aquí')).toHaveCount(1);
    await expect(volverA(page, hoja.titulo)).toBeVisible();
  });
}

test('?desde=automatizaciones.distrito.actualizar (una pantalla apagada) abre las opciones sin «Volver a …»; y un grupo vacío no es un origen válido', async ({ page }) => {
  await simular(page);
  await abrirInicio(page, `${URL_DEL_INICIO}?desde=automatizaciones.distrito.actualizar&ver=grupos`);
  await expect(paso(page)).toHaveText('Elige un grupo');
  await expect(algunVolver(page)).toHaveCount(0);
  await expect(opcion(page, 'Automatizaciones', 'Distrito')).toContainText('Estás aquí');
  await abrirInicio(page, `${URL_DEL_INICIO}?desde=automatizaciones.tus.algo&ver=grupos`);
  await expect(paso(page)).toHaveText('Elige un área');
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
});

test('desde la agenda: «Volver a Agenda…» va centrado bajo el título, junto al lugar de las migas', async ({ page }) => {
  await simular(page);
  await page.goto('/estudio/agenda/');
  await migaDeHoja(page, /^Ir al mapa/).click();
  await expect(paso(page)).toHaveText('Elige un área');
  const m = await medir(page);
  const volver = (await volverA(page, 'Agenda tus publicaciones').boundingBox())!;
  expect(Math.abs(volver.x + volver.width / 2 - m.ancho / 2), '«Volver a Agenda» no está centrado').toBeLessThanOrEqual(1);
  expect(volver.y, '«Volver a Agenda» no está bajo el título').toBeGreaterThanOrEqual(m.titulo.bottom);
  expect(m.bloque.top, 'el mapa quedó arriba de «Volver a Agenda»').toBeGreaterThan(volver.y + volver.height);
  expect(volver.height).toBeGreaterThanOrEqual(44);
});

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

test('desde la agenda: Esc llega a la región de entrada, con las opciones abiertas, y navega de regreso', async ({ page }) => {
  await simular(page);
  await page.goto('/estudio/agenda/');
  await migaDeHoja(page, /^Ir a las opciones/).click();
  await expect(paso(page)).toHaveText('Elige un grupo');
  await Promise.all([page.waitForURL(/\/estudio\/agenda\//), page.keyboard.press('Escape')]);
});

test('desde la agenda: elegir un grupo olvida la página de origen: ya no hay «Volver a Agenda», y Esc sube al mapa en vez de navegar', async ({ page }) => {
  await simular(page);
  await page.goto('/estudio/agenda/');
  await migaDeHoja(page, /^Ir al mapa/).click();
  await expect(paso(page)).toHaveText('Elige un área');
  await elegir(page, 'Marketing', 'Blotato');
  await irAlMapa(page);
  await expect(algunVolver(page)).toHaveCount(0);
  await ficha(page, 'Marketing').click();
  await page.keyboard.press('Escape');
  await expect(paso(page)).toHaveText('Elige un área');
  expect(rutaDe(page)).toBe(URL_DEL_INICIO);
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

test('desde la agenda: recargar el inicio ya limpio aterriza en el mapa, sin repetir el recorrido ni «Volver a Agenda»', async ({ page }) => {
  await simular(page);
  await page.goto('/estudio/agenda/');
  await migaDeHoja(page, /^Ir a las opciones/).click();
  await expect(paso(page)).toHaveText('Elige un grupo');
  await urlLimpia(page);
  await page.reload();
  await expect(paso(page)).toHaveText('Elige un área');
  await expect(algunVolver(page)).toHaveCount(0);
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
});

test('las entradas por la URL que no valen se ignoran: se aterriza en el mapa y la URL se limpia', async ({ page }) => {
  await simular(page);
  for (const consulta of [
    '?desde=mkt.blotato.nada&ver=mapa', // el lugar no existe
    '?desde=mkt.blotato&ver=mapa', // le falta una clave
    '?desde=mkt.blotato.agenda&ver=otra', // qué abrir no es mapa ni grupos
    '?desde=mkt.blotato.agenda', // sin «ver»
    '?ver=mapa', // sin «desde»
  ]) {
    await abrirInicio(page, URL_DEL_INICIO + consulta);
    await expect(paso(page), consulta).toHaveText('Elige un área');
    await expect(algunVolver(page), consulta).toHaveCount(0);
    await urlLimpia(page);
  }
});

test('una pantalla de la caja como origen (?desde=mkt.distrito.video): abre el mapa y NO hay «Volver a Video»; Marketing › Distrito lleva a la caja', async ({ page }) => {
  await simular(page);
  await abrirInicio(page, `${URL_DEL_INICIO}?desde=mkt.distrito.video&ver=mapa`);
  await expect(paso(page)).toHaveText('Elige un área');
  await urlLimpia(page);
  // la caja no es otra página: no hay a dónde «volver» fuera del inicio
  await expect(algunVolver(page)).toHaveCount(0);
  await elegir(page, 'Marketing', 'Distrito');
  await expect(paso(page)).toHaveText(CAJA);
  expect(rutaDe(page)).toBe(URL_DEL_INICIO);
});

test('?blotato=conectar sigue abriendo el diálogo aunque llegue con ?desde=…&ver=…, y la URL solo pierde lo del recorrido', async ({ page }) => {
  await simular(page, { blotato: 'sin-conectar' });
  await page.goto(`${URL_DEL_INICIO}?desde=mkt.blotato.agenda&ver=grupos&blotato=conectar`);
  const dialogo = page.getByRole('dialog', { name: 'Conecta tu Blotato' });
  await expect(dialogo).toBeVisible();
  await expect.poll(() => new URL(page.url()).search).toBe('?blotato=conectar');
  // el diálogo es modal: tiene el foco (no se lo lleva el título del paso) y deja a la región fuera del árbol de accesibilidad
  await expect(dialogo.getByLabel('Tu clave de API de Blotato')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialogo).toBeHidden();
  await expect(paso(page)).toHaveText('Elige un grupo');
});

// el helper `volverA` solo existe para el enlace de otra página: una prueba que lo busque como botón de la caja no encontraría nada
test('«Volver a Video» no existe en ningún paso de ningún recorrido normal (mapa, opciones, lista y caja)', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await expect(algunVolver(page)).toHaveCount(0);
  await ficha(page, 'Marketing').click();
  await expect(algunVolver(page)).toHaveCount(0);
  await opcion(page, 'Marketing', 'Blotato').click();
  await expect(algunVolver(page)).toHaveCount(0);
  await irA(page, 'Marketing', 'Distrito');
  await expect(algunVolver(page)).toHaveCount(0);
  await irAlMapa(page);
  await expect(algunVolver(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Volver a (Imagen|Video|Edición)$/ })).toHaveCount(0);
  await expect(volverA(page, 'Video')).toHaveCount(0);
});
