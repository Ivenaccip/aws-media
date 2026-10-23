// El recorrido del inicio en un navegador de verdad (dueño, 15-oct-2026: «Mapa con Irremplazables»; 21-oct-2026: «por cada pestaña, una ruta»).
// Cada nivel es su propia página, con su dirección y su `<title>`: el mapa en X (/estudio/), las opciones de un área (/estudio/marketing/), la
// lista de un grupo (/estudio/marketing/distrito/, o «Todavía no está disponible.» si el grupo no tiene pantallas) y la caja, en la pestaña que
// dice su dirección (/estudio/marketing/distrito/video/). De una a otra se pasa con un clic en un enlace —las fichas, las tarjetas y las migas
// son enlaces; Producto y Ventas, botones quietos— y cada página empieza de cero. Lo que jsdom no ve y aquí sí:
//  · la geometría: «Irremplazables» cae en el mismo lugar en todas las páginas; el mapa, las opciones y las listas van centrados y sin cuadro
//    alrededor; solo la caja lleva tarjeta, que baja respecto de antes (a 64 px, pegada al saldo) y no se centra en vertical;
//  · las dos diagonales del mapa unen de verdad las cuatro esquinas por detrás de las fichas, y en un celular (por debajo de 560 px) la X se
//    vuelve compacta, centrada, sin desborde, con todo tocable de 44 px y «Automatizaciones» en una sola línea;
//  · nada se ve elegido: ni «Estás aquí» ni el tono de seleccionada, ni en el mapa ni al volver a las opciones; no hay «Volver a …» (las migas
//    suben de nivel y «atrás» regresa);
//  · la caja: cambiar de pestaña conserva el texto, la liga y una subida en curso; salir a otra página lo descarta, sin aviso (D11), salvo una
//    subida a medias, que el navegador sí avisa. «Mis creaciones» y «Tu primer video» solo existen en la página de la caja;
//  · Blotato conectado, sin conectar y sin saberlo (con /api/blotato de mentira): apagado o encendido, y un clic en lo apagado abre el diálogo
//    de conectar en vez de navegar;
//  · el teclado y el foco: cada página nueva empieza en <body> (no hereda el foco de la anterior), dice dónde cae con su <title>, y el primer Tab
//    entra por las migas y sigue por el contenido en orden de lectura; Esc sube al mapa SOLO desde las opciones de un área (D12);
//  · el doble clic lento (el segundo clic cae ya en la página nueva) no salta dos niveles ni activa lo que quedó debajo;
//  · desde una pantalla hoja (la agenda…) las migas van directo al mapa y a las opciones, «atrás» regresa a la hoja, y los marcadores de antes
//    (/estudio/inicio/?desde=&ver=) aterrizan en el mapa sin cambiar nada.
// Lo que NO navega se afirma con `sinNavegar` (e2e/recorrido.ts): sin esperar un rato a ver si pasa. Las pocas esperas fijas que quedan dicen
// por qué no hay un evento que esperar en su lugar.
// Lo que vive en otro archivo, y aquí no se repite:
//  · e2e/niveles.spec.ts «un doble clic lento sobre «Marketing» no salta dos niveles»: el doble clic en la ficha Marketing del mapa (a 390 px es
//    donde cae la tarjeta «Distrito»; en escritorio no cae nada bajo el punto y no habría qué medir);
//  · e2e/niveles.spec.ts «Esc en las opciones de un área sube al mapa; en el mapa, en un grupo y en la caja no hace nada»: Esc con el foco en
//    <body>, recién cargada la página (el oyente ya no es de la región sino del documento). Que lo que ya atendió Esc no se repita lo fija en
//    jsdom `niveles.area.esc_que_ya_atendio_un_menu_no_navega` (src/pantallas/inicio/niveles/PaginaNivel.test.tsx).
// No gasta nada: el servidor y los servicios son rutas de mentira (e2e/recorrido.ts, e2e/servidor.mjs).
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  abrirInicio,
  abrirLaCaja,
  algunVolver,
  cualquierFicha,
  direccionDe,
  elegir,
  elegirHerramienta,
  enfocado,
  esperarRuta,
  ficha,
  fichaApagada,
  herramienta,
  irA,
  irAlMapa,
  lineasDe,
  migaDeHoja,
  migas,
  opcion,
  paso,
  region,
  riel,
  rutaDe,
  simular,
  simularSubida,
  sinNavegar,
  sobraAlLado,
  tarjeta,
  tarjetasDeLaLista,
  TITULO_MAPA,
  URL_BLOTATO,
  URL_CAJA,
  URL_DISTRITO,
  URL_MAPA,
  URL_MARKETING,
  VIDEO,
  vigilarNavegaciones,
  volverA,
} from './recorrido';

const AREAS = ['Marketing', 'Producto', 'Central', 'Ventas', 'Automatizaciones'] as const;

const CAJA = '¿Qué vamos a crear hoy?';

/** Las opciones del área Central (Distrito · Deepseek) y las de Automatizaciones (Distrito · Tus automatizaciones). */
const URL_CENTRAL = '/estudio/central/';
const URL_AUTOMATIZACIONES = '/estudio/automatizaciones/';
/** El grupo Avanzado de Marketing (Publicaciones automáticas, que depende de Blotato, y la Copiadora de estilos, que no). */
const URL_AVANZADO = '/estudio/marketing/avanzado/';

/** El inicio de UNA página de antes. Ya no existe: el servidor lo reenvía con un 302 a /estudio/, con su query (los marcadores viejos). */
const URL_VIEJA = '/estudio/inicio/';

/** Donde caía el borde de la tarjeta antes de esta ronda (el saldo es fijo arriba a la derecha y acaba a 52 px). */
const TARJETA_ANTES = 64;

/** Las tres pestañas de la caja: la clave de su dirección y el nombre de su botón en el riel. */
const PESTANAS = [
  ['imagen', 'Imagen'],
  ['video', 'Video'],
  ['edicion', 'Edición'],
] as const;

/** Espera a que la página recién cargada haya pintado y corrido sus efectos (dos cuadros y una vuelta de la cola), sin un tiempo fijo: lo
 *  que tomara el foco al montarse (un `useEffect`) ya lo habría tomado. */
const trasPintar = (page: Page) =>
  page.evaluate(() => new Promise<void>(listo => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(listo, 0)))));

/** Lo que se le pide a cada página a cualquier ancho: nada se sale de la pantalla, todo lo tocable mide 44 px y la letra no baja de 13. */
async function auditar(page: Page, donde: string) {
  expect(await sobraAlLado(page), `${donde}: la página se arrastra de lado`).toBeLessThanOrEqual(0);
  const problemas = await region(page).evaluate(seccion => {
    const hay: string[] = [];
    for (const e of Array.from(seccion.querySelectorAll('*'))) {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // sin caja (escondido)
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

/** La geometría de la página de ahora: el título, el bloque (el `h2` y lo que le sigue) y la tarjeta, ya con las tipografías cargadas. Se
 *  mide SIEMPRE con la página nueva ya cargada (`esperarRuta`): antes se leería la vieja, o se caería con «Execution context was destroyed». */
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
// aterrizar: el mapa es la principal

test('se aterriza en el MAPA (/estudio/): «Elige un área», las cinco áreas en orden de lectura, sin migas, sin «Volver a …» y SIN la caja detrás', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  expect(rutaDe(page)).toBe(URL_MAPA);
  await expect(page).toHaveTitle(TITULO_MAPA);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(paso(page)).toHaveText('Elige un área');
  // las que se abren son enlaces y las apagadas botones: se leen las dos, en el orden en que están en la página
  const nombres = (await region(page).getByRole('group', { name: 'Áreas', exact: true }).locator('a, button').allTextContents()).map(t =>
    t.replace(/Próximamente/g, ''),
  );
  expect(nombres).toEqual([...AREAS]);
  await expect(migas(page)).toHaveCount(0);
  await expect(algunVolver(page)).toHaveCount(0);
  // la caja no está en la página, ni escondida: la de antes seguía montada bajo el mapa, a la espera de que la eligieran, y su cuadro de texto
  // contaba aquí (un localizador de CSS cuenta también lo escondido)
  await expect(page.locator('textarea')).toHaveCount(0);
  await expect(page.getByText('Elige un grupo')).toHaveCount(0);
  // aterrizar no le pone el foco a nada: la página empieza arriba
  await trasPintar(page);
  expect((await enfocado(page)).etiqueta).toBe('body');
});

test('nada se ve elegido en el mapa: ninguna ficha lleva «Estás aquí» ni aria-current, y Marketing, Central y Automatizaciones se ven EXACTAMENTE igual', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
  await expect(region(page).locator('[aria-current]')).toHaveCount(0);
  // el tono de las tres que se abren: el mismo borde y el mismo fondo; las apagadas, distintas (más hondas)
  const tono = (area: string) =>
    cualquierFicha(page, area).evaluate(b => ({ fondo: getComputedStyle(b).backgroundColor, borde: getComputedStyle(b).borderTopColor }));
  const marketing = await tono('Marketing');
  expect(marketing).toEqual(await tono('Central'));
  expect(marketing).toEqual(await tono('Automatizaciones'));
  expect((await tono('Producto')).fondo, 'las apagadas se distinguen de las que se abren').not.toBe(marketing.fondo);
  // y después de haber estado en la caja de Marketing, el mapa tampoco la marca: es otra página, con el mismo mapa de siempre
  await elegir(page, 'Marketing', 'Distrito');
  await elegirHerramienta(page, 'Video');
  await irAlMapa(page);
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
  await expect(region(page).locator('[aria-current]')).toHaveCount(0);
  expect(await tono('Marketing')).toEqual(marketing);
});

test('con el ratón encima una ficha que se abre sí cambia de tono (el hover se conserva) y con el teclado se enfoca con aro visible', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  const fondo = () => ficha(page, 'Marketing').evaluate(b => getComputedStyle(b).backgroundColor);
  const reposo = await fondo();
  await ficha(page, 'Marketing').hover();
  await expect.poll(fondo).not.toBe(reposo);
  await page.mouse.move(0, 0);
  await expect.poll(fondo).toBe(reposo);
  // el aro es `:focus-visible`, el del teclado: recién cargada la página el foco está en <body> y el primer Tab llega a Marketing
  expect((await enfocado(page)).etiqueta).toBe('body');
  await page.keyboard.press('Tab');
  await expect(ficha(page, 'Marketing')).toBeFocused();
  expect(await ficha(page, 'Marketing').evaluate(b => getComputedStyle(b).outlineStyle), 'sin aro de foco').not.toBe('none');
});

// ---------------------------------------------------------------------------
// el título arriba y la geometría de cada página

const VENTANAS = [
  { ancho: 1100, alto: 800 },
  { ancho: 1440, alto: 900 },
  { ancho: 390, alto: 844 },
  { ancho: 320, alto: 740 },
] as const;

// Antes eran pasos de una sola página; ahora son dos plantillas (la de los niveles y la de la caja) que tienen que poner el título en el mismo
// lugar, al píxel: si una de las dos lo moviera, al pasar de página el título saltaría
for (const { ancho, alto } of VENTANAS) {
  test(`a ${ancho}×${alto} «Irremplazables» está arriba, fuera de la tarjeta, y NO se mueve de una página a otra: mapa, opciones, listas y caja`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    await simular(page);
    await abrirInicio(page);
    const paginas: Array<[string, Awaited<ReturnType<typeof medir>>]> = [];
    paginas.push(['el mapa', await medir(page)]);
    await ficha(page, 'Marketing').click();
    await esperarRuta(page, URL_MARKETING);
    paginas.push(['las opciones', await medir(page)]);
    await opcion(page, 'Marketing', 'Blotato').click();
    await esperarRuta(page, URL_BLOTATO);
    paginas.push(['la lista de Blotato', await medir(page)]);
    await irA(page, 'Marketing', 'Distrito');
    paginas.push(['la lista de Distrito', await medir(page)]);
    await elegirHerramienta(page, 'Video');
    paginas.push(['la caja', await medir(page)]);

    const [, primero] = paginas[0]!;
    for (const [donde, m] of paginas) {
      expect(m.titulo.top, `${donde}: el título se movió (arriba)`).toBeCloseTo(primero.titulo.top, 0);
      expect(m.titulo.height, `${donde}: el título cambió de alto`).toBeCloseTo(primero.titulo.height, 0);
      expect(m.titulo.left + m.titulo.width / 2, `${donde}: el título no está centrado`).toBeCloseTo(m.ancho / 2, 0);
      // arriba de todo: debajo del saldo (que es fijo y acaba a 52 px) y mucho antes de la mitad de la pantalla
      expect(m.titulo.top, `${donde}: el título quedó pegado al saldo`).toBeGreaterThanOrEqual(64);
      expect(m.titulo.bottom, `${donde}: el título no está arriba`).toBeLessThan(m.alto / 4);
    }
    // la tarjeta (solo con la caja) empieza DEBAJO del título: no lo rodea
    const [, caja] = paginas[4]!;
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

// El mapa, las opciones y la lista de un grupo no van dentro de una tarjeta (dueño: «ni debe de haber un cuadrado rodeando a todos»): el
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
  await esperarRuta(page, URL_MARKETING);
  expect(await estilo(), 'las opciones tienen un cuadro').toEqual(SIN);
  await opcion(page, 'Marketing', 'Blotato').click();
  await esperarRuta(page, URL_BLOTATO);
  expect(await estilo(), 'la lista de Blotato tiene un cuadro').toEqual(SIN);
  await irA(page, 'Marketing', 'Distrito');
  expect(await estilo(), 'la lista de Distrito tiene un cuadro').toEqual(SIN);
  await elegirHerramienta(page, 'Video');
  const conCaja = await estilo();
  expect(conCaja.borde).toBe('1px');
  expect(conCaja.fondo).not.toBe('rgba(0, 0, 0, 0)');
  expect(conCaja.relleno).toBe('24px');
  // y la página del mapa, venida de la caja, no lo trae
  await irAlMapa(page);
  expect(await estilo(), 'el mapa, tras la caja, tiene cuadro').toEqual(SIN);
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
  await esperarRuta(page, URL_MARKETING);
  for (const { ancho, alto } of [VENTANAS[0], VENTANAS[1]]) {
    await page.setViewportSize({ width: ancho, height: alto });
    const m = await medir(page);
    const filaDeMigas = (await migas(page).boundingBox())!;
    const arriba = m.bloque.top - (filaDeMigas.y + filaDeMigas.height);
    const abajo = m.alto - m.bloque.bottom;
    expect(Math.abs(arriba - abajo), `a ${ancho}×${alto}: ${arriba.toFixed(1)} px arriba y ${abajo.toFixed(1)} px abajo`).toBeLessThanOrEqual(8);
    // las migas, centradas bajo el título (en las páginas sin tarjeta); no a la izquierda
    expect(Math.abs(filaDeMigas.x + filaDeMigas.width / 2 - m.ancho / 2), 'las migas no están centradas').toBeLessThanOrEqual(1);
    expect(filaDeMigas.y).toBeGreaterThanOrEqual(m.titulo.bottom);
    expect(m.bloque.top, 'las opciones quedaron arriba de las migas').toBeGreaterThan(filaDeMigas.y + filaDeMigas.height);
  }
});

// la caja tiene tres direcciones, y las tres son la misma página: las migas van igual en las tres
for (const [clave, nombre] of PESTANAS) {
  test(`en la caja de ${nombre} las migas van DENTRO de la tarjeta, arriba y a la izquierda, y son enlaces a las páginas de arriba`, async ({ page }) => {
    await simular(page);
    await abrirLaCaja(page, URL_CAJA[clave]);
    const t = (await tarjeta(page).boundingBox())!;
    const m = (await migas(page).boundingBox())!;
    expect(m.x, 'las migas no están dentro de la tarjeta').toBeGreaterThanOrEqual(t.x);
    expect(m.x + m.width).toBeLessThanOrEqual(t.x + t.width);
    expect(m.y).toBeGreaterThanOrEqual(t.y);
    expect(m.x - t.x, 'las migas van centradas en vez de a la izquierda').toBeLessThanOrEqual(40);
    // antes eran botones que cambiaban de paso en la misma página; ahora suben de nivel navegando
    await expect(migas(page).getByRole('link')).toHaveText(['Marketing', 'Distrito']);
    await expect(migas(page).getByRole('link').first()).toHaveAttribute('href', URL_MAPA);
    await expect(migas(page).getByRole('link').nth(1)).toHaveAttribute('href', URL_MARKETING);
    await expect(migas(page).getByRole('link').nth(1)).toHaveAttribute('aria-current', 'step');
    await expect(migas(page).getByRole('button')).toHaveCount(0);
    await expect(algunVolver(page)).toHaveCount(0);
  });
}

// ---------------------------------------------------------------------------
// el mapa en X (las fichas que se abren son enlaces; las apagadas, botones quietos: la X las une igual)

for (const ancho of [1100, 600]) {
  test(`a ${ancho} px la X une las cuatro esquinas pasando por Central, por detrás de las fichas`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 900 });
    await simular(page);
    await abrirInicio(page);
    await expect(region(page).getByText('Estás aquí')).toHaveCount(0);

    const caja = async (area: string) => (await cualquierFicha(page, area).boundingBox())!;
    const [marketing, producto, central, ventas, automatizaciones] = await Promise.all(AREAS.map(caja));
    type Caja = NonNullable<typeof marketing>;
    const dentro = (p: { x: number; y: number }, c: Caja) => p.x >= c.x && p.x <= c.x + c.width && p.y >= c.y && p.y <= c.y + c.height;

    // los extremos de cada línea, ya en coordenadas de pantalla, y lo que hay encima de ellos (una ficha: un enlace o un botón)
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
          const encima = (p: { x: number; y: number }) => document.elementFromPoint(p.x, p.y)?.closest('a, button')?.textContent ?? '';
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
        return { svg: capa(svg), puntero: getComputedStyle(svg).pointerEvents, fichas: Array.from(svg.parentElement!.querySelectorAll('a, button')).map(capa) };
      });
    expect(capas.puntero, 'las diagonales reciben el puntero').toBe('none');
    expect(capas.fichas).toHaveLength(5);
    for (const z of capas.fichas) expect(capas.svg, 'las diagonales quedan encima de una ficha').toBeLessThan(z);
    expect(await sobraAlLado(page)).toBeLessThanOrEqual(0);
  });
}

test('Producto y Ventas son fichas inertes: se ven, se enfocan y no se abren; las otras tres son enlaces a la página de su área', async ({ page }) => {
  await simular(page);
  await vigilarNavegaciones(page);
  await abrirInicio(page);
  for (const area of ['Producto', 'Ventas']) {
    // un botón quieto, no un enlace: no tiene a dónde ir
    await expect(ficha(page, area)).toHaveCount(0);
    const f = fichaApagada(page, area);
    await expect(f).toHaveAttribute('aria-disabled', 'true');
    await expect(f).toContainText('Próximamente');
    // Playwright no hace clic en lo `aria-disabled` si no se le fuerza: una persona sí lo pulsa
    await sinNavegar(page, () => f.click({ force: true }), URL_MAPA, `${area}, con un clic`);
    // sigue en el orden de Tab (el lector la dice, y no hay un hueco sin explicar en el mapa), y Enter tampoco la abre
    await f.focus();
    await expect(f).toBeFocused();
    await sinNavegar(page, () => page.keyboard.press('Enter'), URL_MAPA, `${area}, con Enter`);
    await expect(paso(page)).toHaveText('Elige un área');
  }
  for (const [area, href] of [
    ['Marketing', URL_MARKETING],
    ['Central', URL_CENTRAL],
    ['Automatizaciones', URL_AUTOMATIZACIONES],
  ] as const) {
    await expect(ficha(page, area)).toHaveAttribute('href', href);
    await expect(ficha(page, area)).not.toHaveAttribute('aria-disabled', 'true');
    await expect(ficha(page, area)).not.toContainText('Próximamente');
  }
});

// ---------------------------------------------------------------------------
// Automatizaciones (20-oct-2026): el área se enciende con dos grupos

test('Automatizaciones: Distrito trae Constructor y Asistente (enlaces) y «Actualizar flujos» («Próximamente», quieta); «Tus automatizaciones» dice que todavía no está disponible', async ({ page }) => {
  await simular(page, { blotato: 'sin-conectar' });
  await vigilarNavegaciones(page);
  await abrirInicio(page);
  await ficha(page, 'Automatizaciones').click();
  await esperarRuta(page, URL_AUTOMATIZACIONES);
  await expect(page).toHaveTitle('Estudio de video · Automatizaciones');
  await expect(paso(page)).toHaveText('Elige un grupo');
  await expect(region(page).getByRole('group', { name: 'Automatizaciones', exact: true }).getByRole('link')).toHaveText([/^Distrito/, /^Tus automatizaciones/]);
  await expect(opcion(page, 'Automatizaciones', 'Distrito')).toHaveAttribute('href', '/estudio/automatizaciones/distrito/');
  await expect(opcion(page, 'Automatizaciones', 'Distrito')).toContainText('Constructor · Asistente · Actualizar flujos');
  await expect(opcion(page, 'Automatizaciones', 'Tus automatizaciones')).toHaveAttribute('href', '/estudio/automatizaciones/tus/');
  await expect(opcion(page, 'Automatizaciones', 'Tus automatizaciones')).toContainText('Próximamente');
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);

  await opcion(page, 'Automatizaciones', 'Distrito').click();
  await esperarRuta(page, '/estudio/automatizaciones/distrito/');
  await expect(page).toHaveTitle('Estudio de video · Automatizaciones · Distrito');
  await expect(paso(page)).toHaveText('Distrito');
  await expect(migas(page).getByRole('link')).toHaveText(['Automatizaciones', 'Distrito']);
  const tarjetas = tarjetasDeLaLista(page);
  await expect(tarjetas).toHaveText([/^Constructor/, /^Asistente/]);
  await expect(tarjetas.first()).toHaveAttribute('href', '/estudio/constructor/');
  await expect(tarjetas.last()).toHaveAttribute('href', '/estudio/asistente/');
  // no depende de Blotato: aun sin clave no se apaga nada ni hay botón de conectar
  await expect(region(page).locator('[aria-disabled="true"]')).toHaveCount(0);
  await expect(region(page).getByRole('button', { name: /Blotato/ })).toHaveCount(0);
  const apagada = region(page).getByText('Actualizar flujos', { exact: true });
  await expect(apagada).toBeVisible();
  await sinNavegar(page, () => apagada.click(), '/estudio/automatizaciones/distrito/', '«Actualizar flujos»');
  await expect(region(page).getByText('Próximamente')).toHaveCount(1);

  // la miga del grupo sube a las opciones, y ahí nada se marca: antes «Estás aquí» caía en el Distrito del que se volvía
  await migas(page).getByRole('link', { name: /^Volver a las opciones de Automatizaciones/ }).click();
  await esperarRuta(page, URL_AUTOMATIZACIONES);
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
  await expect(region(page).getByRole('group', { name: 'Automatizaciones', exact: true }).locator('[aria-current]')).toHaveCount(0);

  // el otro grupo, sin pantallas: su propia página, que lo dice (D5)
  await opcion(page, 'Automatizaciones', 'Tus automatizaciones').click();
  await esperarRuta(page, '/estudio/automatizaciones/tus/');
  await expect(page).toHaveTitle('Estudio de video · Automatizaciones · Tus automatizaciones');
  await expect(paso(page)).toHaveText('Tus automatizaciones');
  await expect(region(page).getByText('Todavía no está disponible.')).toBeVisible();
  await trasPintar(page);
  expect((await enfocado(page)).etiqueta, 'la página nueva le puso el foco a algo').toBe('body');
  // Esc en un grupo no hace nada (D12): las migas suben de nivel
  await sinNavegar(page, () => page.keyboard.press('Escape'), '/estudio/automatizaciones/tus/', 'Esc en un grupo vacío');
  await expect(paso(page)).toHaveText('Tus automatizaciones');
  await irAlMapa(page);
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
  // mirar Marketing no marca nada: no hay un grupo «elegido»
  await ficha(page, 'Marketing').click();
  await esperarRuta(page, URL_MARKETING);
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// el doble clic, ahora entre páginas
//
// Antes el primer clic cambiaba el paso en la misma página y el segundo caía sobre lo que apareció donde estaba lo pulsado. Ahora el primer clic
// CARGA otra página y el segundo (clickCount 2) llega ya sobre ella: `dblclick()` de Playwright manda los dos de seguido, antes de que la página
// nueva exista, y no mediría nada; el clic lento se hace a mano. Lo detiene la guarda de PaginaNivel (esDobleClicAccidental: `detail` > 1 a
// menos de medio segundo de montada la página). Va con «reducir movimiento»: mientras corre la View Transition entre páginas el navegador
// entrega todo clic al <html>, y el segundo clic no llegaría a nada, con guarda o sin ella. Cada caso fija QUÉ cae bajo el punto en la página
// nueva (si no cayera nada, la prueba no mediría la guarda) y termina con el control: un clic deliberado en el mismo punto sí lo activa.

/** Lo que tarda una persona entre los dos clics de un doble clic. Es fijo a propósito: es lo que se simula (la guarda cuenta 500 ms). */
const ENTRE_CLICS_MS = 80;

/** El doble clic lento en `punto`: el primer clic carga `destino`; el segundo (detail 2) llega `ENTRE_CLICS_MS` después, en el mismo punto,
 *  sobre la página nueva, y NO navega (`sinNavegar`). Devuelve qué había ahí: el `href` del enlace o el texto del botón (null = nada). */
async function dobleClicLento(page: Page, punto: { x: number; y: number }, destino: string): Promise<string | null> {
  await page.mouse.move(punto.x, punto.y);
  await page.mouse.down({ clickCount: 1 });
  await page.mouse.up({ clickCount: 1 });
  // en cuanto la página nueva está montada (su `load` puede tardar más: la guarda cuenta desde que se montó)
  await page.waitForURL(u => u.pathname === destino, { waitUntil: 'commit' });
  await expect(paso(page)).toBeVisible();
  await page.waitForTimeout(ENTRE_CLICS_MS);
  const debajo = await page.evaluate(([x, y]) => {
    const e = document.elementFromPoint(x!, y!)?.closest('a, button');
    return e ? (e.getAttribute('href') ?? (e.textContent ?? '').trim()) : null;
  }, [punto.x, punto.y]);
  await sinNavegar(
    page,
    async () => {
      await page.mouse.move(punto.x, punto.y);
      await page.mouse.down({ clickCount: 2 });
      await page.mouse.up({ clickCount: 2 });
    },
    destino,
    'el segundo clic del doble clic',
  );
  return debajo;
}

const centroDe = async (loc: Locator, fraccionDelAlto = 0.5) => {
  const c = (await loc.boundingBox())!;
  return { x: c.x + c.width / 2, y: c.y + c.height * fraccionDelAlto };
};

test.describe('a 390 px, con «reducir movimiento» (solo la guarda detiene el doble clic)', () => {
  test.use({ viewport: { width: 390, height: 800 }, contextOptions: { reducedMotion: 'reduce' } });

  test('Automatizaciones: Esc en sus opciones sube al mapa, y un doble clic lento en su ficha no elige un grupo por accidente', async ({ page }) => {
    await simular(page);
    await vigilarNavegaciones(page);
    // Esc en las opciones del área (D12), recién cargada la página: el foco está en <body> y no en el título (ya no se le pone)
    await abrirInicio(page, URL_AUTOMATIZACIONES);
    await expect(paso(page)).toHaveText('Elige un grupo');
    await trasPintar(page);
    expect((await enfocado(page)).etiqueta).toBe('body');
    await page.keyboard.press('Escape');
    await esperarRuta(page, URL_MAPA);
    await expect(paso(page)).toHaveText('Elige un área');
    // fue una navegación como cualquier otra: «atrás» vuelve a las opciones
    await page.goBack();
    await esperarRuta(page, URL_AUTOMATIZACIONES);

    // a 390 px la tarjeta «Tus automatizaciones» de la página siguiente cae justo bajo la ficha (en escritorio no cae nada)
    await abrirInicio(page);
    const punto = await centroDe(ficha(page, 'Automatizaciones'));
    const debajo = await dobleClicLento(page, punto, URL_AUTOMATIZACIONES);
    expect(debajo, 'la tarjeta «Tus automatizaciones» no está bajo la ficha: la prueba no mide la guarda').toBe('/estudio/automatizaciones/tus/');
    await expect(paso(page)).toHaveText('Elige un grupo');
    // el control: un clic deliberado en el mismo punto sí abre la tarjeta
    await page.mouse.click(punto.x, punto.y);
    await esperarRuta(page, '/estudio/automatizaciones/tus/');
  });
});

// Un nivel más abajo: el segundo clic cae sobre lo que aparece donde estaba la tarjeta del grupo. Navegaría a esa pantalla, abriría el diálogo
// de conectar sin que nadie lo pidiera, o saltaría a la caja. [ancho, grupo, su página, Blotato, a qué altura de la tarjeta se pulsa, lo que cae
// debajo en su página]
test.describe('doble clic en la tarjeta de un grupo, con «reducir movimiento» (solo la guarda lo detiene)', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  for (const [ancho, grupo, destino, blotato, fraccion, debajoEsperado] of [
    [1100, 'Blotato', URL_BLOTATO, 'conectado', 0.5, '/competencia.html'],
    [1100, 'Blotato', URL_BLOTATO, 'sin-conectar', 0.5, '/competencia.html'],
    [390, 'Blotato', URL_BLOTATO, 'conectado', 0.5, '/competencia.html'],
    [390, 'Blotato', URL_BLOTATO, 'sin-conectar', 0.5, '/competencia.html'],
    // el centro de Avanzado cae en el hueco entre sus dos tarjetas: un cuarto de su alto cae sobre la primera
    [1100, 'Avanzado', URL_AVANZADO, 'conectado', 0.25, '/mix.html'],
    // desde que Distrito es una lista, debajo de su tarjeta cae «Video»: el doble clic saltaría a la caja
    [1100, 'Distrito', URL_DISTRITO, 'conectado', 0.5, URL_CAJA.video],
  ] as const) {
    test(`«${grupo}» (${blotato}, ${ancho} px): abre su lista y no activa lo que cae debajo`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: 900 });
      await simular(page, { blotato });
      await vigilarNavegaciones(page);
      await abrirInicio(page, URL_MARKETING);
      await page.evaluate(() => document.fonts.ready);
      const punto = await centroDe(opcion(page, 'Marketing', grupo), fraccion);
      const debajo = await dobleClicLento(page, punto, destino);
      expect(debajo, 'bajo el primer clic no cae lo esperado: la prueba no mide la guarda').toBe(debajoEsperado);
      await expect(paso(page)).toHaveText(grupo);
      if (blotato === 'sin-conectar') {
        // lo de debajo es una pantalla apagada: su clic no navega, abre el diálogo de conectar, y el código del diálogo llega con import(). No
        // hay evento que esperar para afirmar que NO se abrió: se le da tiempo de sobra para llegar
        await page.waitForTimeout(900);
        await expect(page.getByRole('dialog'), 'el doble clic abrió el diálogo de conectar').toHaveCount(0);
        // el control: una pulsación deliberada pasa (la guarda dura medio segundo, no para siempre)
        await region(page).getByRole('button', { name: 'Conecta tu cuenta de Blotato' }).dblclick();
        await expect(page.getByRole('dialog', { name: 'Conecta tu Blotato' })).toBeVisible();
      } else {
        await expect(page.getByRole('dialog')).toHaveCount(0);
        // el control: un clic deliberado en el mismo punto activa lo de debajo
        await page.mouse.click(punto.x, punto.y);
        await page.waitForURL(u => u.pathname !== destino);
      }
    });
  }
});

// Y un nivel más: la tarjeta «Imagen» o «Video» de Distrito carga la caja, que también es una página nueva. A 390 px el segundo clic cae
// sobre el chip de la tarea («Crear una imagen ▾») o sobre el selector de modelo, que se abrirían sin que nadie lo pidiera. Lo detiene la
// guarda de Recorrido, que en la página de una herramienta cuenta desde que la página se montó (como PaginaNivel). En el escritorio no
// cae nada debajo, y en Edición tampoco: no hay qué medir.
test.describe('doble clic en una herramienta de Distrito, a 390 px y con «reducir movimiento» (solo la guarda lo detiene)', () => {
  test.use({ viewport: { width: 390, height: 900 }, contextOptions: { reducedMotion: 'reduce' } });

  for (const [nombre, destino, debajoEsperado] of [
    ['Imagen', URL_CAJA.imagen, /^Crear una imagen/],
    ['Video', URL_CAJA.video, /^Modelo/],
  ] as const) {
    test(`«${nombre}»: abre la caja y no abre lo que cae debajo`, async ({ page }) => {
      await simular(page);
      await vigilarNavegaciones(page);
      await abrirInicio(page, URL_DISTRITO);
      await page.evaluate(() => document.fonts.ready);
      const punto = await centroDe(herramienta(page, nombre));
      const debajo = await dobleClicLento(page, punto, destino);
      expect(debajo, 'bajo el primer clic no cae un menú de la caja: la prueba no mide la guarda').toMatch(debajoEsperado);
      await expect(paso(page)).toHaveText('¿Qué vamos a crear hoy?');
      const abiertos = page.locator('[aria-expanded="true"]');
      await expect(abiertos).toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      // el control: un clic deliberado en el mismo punto sí lo abre
      await page.mouse.click(punto.x, punto.y);
      await expect(abiertos).toHaveCount(1);
    });
  }
});

// ---------------------------------------------------------------------------
// las tres opciones

test('las opciones de Marketing son tres enlaces, con las pantallas de cada una y SIN «Estás aquí»: nadie ha elegido nada', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await ficha(page, 'Marketing').click();
  await esperarRuta(page, URL_MARKETING);
  await expect(page).toHaveTitle('Estudio de video · Marketing');
  await expect(paso(page)).toHaveText('Elige un grupo');
  await expect(region(page).getByRole('group', { name: 'Marketing', exact: true }).getByRole('link')).toHaveCount(3);
  await expect(opcion(page, 'Marketing', 'Distrito')).toContainText('Imagen · Video · Edición');
  await expect(opcion(page, 'Marketing', 'Blotato')).toContainText('Agenda tus publicaciones · Investiga tu competencia · Ver mis métricas');
  await expect(opcion(page, 'Marketing', 'Avanzado')).toContainText('Publicaciones automáticas · Copiadora de estilos');
  // cada una lleva a la página de su grupo
  await expect(opcion(page, 'Marketing', 'Distrito')).toHaveAttribute('href', URL_DISTRITO);
  await expect(opcion(page, 'Marketing', 'Blotato')).toHaveAttribute('href', URL_BLOTATO);
  await expect(opcion(page, 'Marketing', 'Avanzado')).toHaveAttribute('href', URL_AVANZADO);
  // ningún grupo se marca: sería el mismo «parece seleccionado» que se quitó del mapa
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
  for (const g of ['Distrito', 'Blotato', 'Avanzado']) await expect(opcion(page, 'Marketing', g), g).not.toHaveAttribute('aria-current', /./);
  // la miga del área es donde estás en esta página (y sube al mapa); no hay «Volver a …»
  await expect(migas(page).getByRole('link')).toHaveText(['Marketing']);
  await expect(migas(page).getByRole('link')).toHaveAttribute('aria-current', 'step');
  await expect(migas(page).getByRole('link')).toHaveAttribute('href', URL_MAPA);
  await expect(migas(page).getByRole('button')).toHaveCount(0);
  await expect(algunVolver(page)).toHaveCount(0);
});

// Antes, al volver a las opciones desde un grupo, «Estás aquí» marcaba ESE grupo. Ya no existe: la dirección y el <title> dicen dónde estás, y no
// hay un grupo «elegido» que marcar. Lo que aquello cuidaba —saber de dónde se viene— lo hace el «atrás» del navegador, que regresa al grupo.
test('al volver de un grupo a las opciones, por la miga o por «atrás», nada se marca: no hay «Estás aquí»', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await elegir(page, 'Marketing', 'Blotato');
  expect(rutaDe(page)).toBe(URL_BLOTATO);
  await migas(page).getByRole('link', { name: /^Volver a las opciones de Marketing/ }).click();
  await esperarRuta(page, URL_MARKETING);
  await expect(paso(page)).toHaveText('Elige un grupo');
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
  await expect(opcion(page, 'Marketing', 'Blotato')).not.toHaveAttribute('aria-current', /./);
  await expect(region(page).locator('[aria-current="location"]')).toHaveCount(0);
  // «atrás» regresa al grupo; y otra vez «atrás», a las opciones de antes de elegirlo: tampoco marcadas
  await page.goBack();
  await esperarRuta(page, URL_BLOTATO);
  await expect(paso(page)).toHaveText('Blotato');
  await page.goBack();
  await esperarRuta(page, URL_MARKETING);
  await expect(paso(page)).toHaveText('Elige un grupo');
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
  await expect(region(page).locator('[aria-current="location"]')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// la caja: una página aparte, con tres pestañas que SÍ conservan lo escrito
//
// Antes la caja se quedaba montada (y escondida) bajo el mapa: el texto, el video subido y una subida en curso sobrevivían a abrir el mapa y
// volver. Ahora el mapa, las opciones y las listas son otras páginas y no la montan (el mapa ni siquiera trae su código: niveles.spec.ts lo
// vigila). Lo que sigue igual se prueba DENTRO de la caja: sus tres pestañas (Imagen · Video · Edición) son tres direcciones de una sola página, y
// cambiar de una a otra conserva lo escrito, la liga y la subida. Lo que cambió se prueba al revés: salir de la caja a un nivel de arriba lo
// descarta, sin aviso del navegador (D11); la única excepción es una subida a medias, que el navegador sí avisa antes de perderla. En jsdom,
// `inicio.edicion.cambiar_de_familia_y_volver_conserva_texto_y_video_y_no_cancela_la_subida` (src/pantallas/inicio/Edicion.test.tsx) sigue vigente.

/** Los avisos del navegador (beforeunload) que salgan. Por omisión se aceptan: si sale uno que no debía, la prueba falla por él y no por
 *  quedarse esperando una navegación que el aviso detuvo. Con «quedarse» se rechazan (la página no se va). */
function oirAvisos(page: Page, responder: 'aceptar' | 'quedarse' = 'aceptar') {
  const avisos: string[] = [];
  page.on('dialog', d => {
    avisos.push(d.type());
    void (responder === 'aceptar' ? d.accept() : d.dismiss());
  });
  return avisos;
}

// Imagen y Video comparten UN cuadro de texto (cambiar entre ellas lo conserva, y lo prueba niveles.spec.ts); Edición tiene el suyo. Por eso la
// otra pestaña es Edición para las dos primeras e Imagen para Edición: así el cuadro de la familia SÍ se esconde al cambiar.
for (const [familia, clave, otra, claveOtra, campo] of [
  ['Imagen', 'imagen', 'Edición', 'edicion', CAJA],
  ['Video', 'video', 'Edición', 'edicion', CAJA],
  ['Edición', 'edicion', 'Imagen', 'imagen', 'Cuéntale a la IA qué quieres'],
] as const) {
  test(`«${familia}»: cambiar de pestaña conserva lo escrito; salir al mapa y volver por Marketing › Distrito › ${familia} abre la caja vacía, sin aviso`, async ({ page }) => {
    const avisos = oirAvisos(page);
    await simular(page);
    await abrirLaCaja(page, URL_CAJA[clave]);
    const cuadro = page.getByRole('textbox', { name: campo });
    await cuadro.fill('un gato jugando en la nieve');
    // lo que SÍ se conserva: la otra pestaña tiene su propio cuadro, el de esta se esconde (no se desmonta), y la dirección sigue a la pestaña
    await riel(page, otra).click();
    await esperarRuta(page, URL_CAJA[claveOtra]);
    await expect(cuadro).toBeHidden();
    await riel(page, familia).click();
    await esperarRuta(page, URL_CAJA[clave]);
    await expect(cuadro).toHaveValue('un gato jugando en la nieve');

    // salir: el mapa es otra página y no trae la caja, ni escondida
    await irAlMapa(page);
    await expect(page.locator('textarea')).toHaveCount(0);
    await expect(algunVolver(page)).toHaveCount(0);
    // volver clicando: una caja nueva, vacía, en la pestaña de la dirección elegida
    await elegir(page, 'Marketing', 'Distrito');
    await elegirHerramienta(page, familia);
    expect(rutaDe(page)).toBe(URL_CAJA[clave]);
    await expect(cuadro).toHaveValue('');
    await expect(riel(page, familia)).toHaveAttribute('aria-pressed', 'true');
    expect(avisos, 'el navegador avisó al salir de la caja (D11: sin aviso)').toEqual([]);
  });
}

test('mapa → Marketing → Distrito → Video: la caja llega por enlaces en una página nueva, con su <title>, sin foco prestado, y el primer Tab entra por la miga del área', async ({ page }) => {
  await simular(page);
  await abrirLaCaja(page);
  await page.getByRole('textbox', { name: CAJA }).fill('un perro surfeando');
  await irA(page, 'Marketing', 'Distrito');
  // Marketing › Distrito ya no es la caja: es la lista de sus tres herramientas, sin cuadro de texto
  await expect(paso(page)).toHaveText('Distrito');
  await expect(page.locator('textarea')).toHaveCount(0);
  await elegirHerramienta(page, 'Video');
  expect(rutaDe(page)).toBe(URL_CAJA.video);
  await expect(page).toHaveTitle('Estudio de video · Marketing · Distrito · Video');
  // lo escrito antes no viaja (D11)
  await expect(page.getByRole('textbox', { name: CAJA })).toHaveValue('');
  // antes el botón pulsado desaparecía y el foco pasaba al título de la caja; ahora es otra página y empieza arriba: nadie le pone el foco
  await trasPintar(page);
  expect((await enfocado(page)).etiqueta, 'la caja le puso el foco a algo al llegar').toBe('body');
  await expect(paso(page)).not.toBeFocused();
  // y Tab entra por el principio: las dos migas y luego el riel
  await page.keyboard.press('Tab');
  await expect(migas(page).getByRole('link', { name: /^Volver al mapa/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(migas(page).getByRole('link', { name: /^Volver a las opciones de Marketing/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(riel(page, 'Imagen')).toBeFocused();
});

test('«De videos a Shorts» y la liga se conservan al cambiar de pestaña y se pierden al salir de la caja: vuelve en «Editar», sin liga', async ({ page }) => {
  const avisos = oirAvisos(page);
  await simular(page);
  await abrirLaCaja(page, URL_CAJA.edicion);
  const chip = page.locator('button[aria-haspopup="listbox"]');
  await chip.click();
  await page.getByRole('option', { name: /De videos a Shorts/ }).click();
  const liga = page.getByRole('textbox', { name: 'Liga de YouTube' });
  await liga.fill('https://www.youtube.com/watch?v=abc123DEF45');
  // lo que SÍ se conserva: Edición guarda su modo y su liga mientras se mira otra pestaña
  await riel(page, 'Imagen').click();
  await esperarRuta(page, URL_CAJA.imagen);
  await expect(liga).toBeHidden();
  await riel(page, 'Edición').click();
  await esperarRuta(page, URL_CAJA.edicion);
  await expect(liga).toHaveValue('https://www.youtube.com/watch?v=abc123DEF45');
  await expect(chip).toContainText('De videos a Shorts');

  // salir y volver: una caja nueva, en el modo de siempre («Editar ▾»), sin la liga (que solo existe en el modo Shorts) ni texto
  await irAlMapa(page);
  await elegir(page, 'Marketing', 'Distrito');
  await elegirHerramienta(page, 'Edición');
  await expect(chip).not.toContainText('De videos a Shorts');
  await expect(liga).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Cuéntale a la IA qué quieres' })).toHaveValue('');
  expect(avisos, 'el navegador avisó al salir de la caja (D11: sin aviso)').toEqual([]);
});

/** Lo que se le pide a «S3» y al servidor por una subida: lo que termina de subir pide confirmar y cotizar. */
function oirSubida(page: Page) {
  const pedidos: string[] = [];
  page.on('request', r => {
    const { pathname } = new URL(r.url());
    if (pathname === '/api/media/confirmar' || pathname === '/api/edicion/cotizar') pedidos.push(pathname);
  });
  return pedidos;
}

/** Una subida a medias en la caja de Edición: el PUT a «S3» espera a que la prueba llame a `soltar`. */
async function subirAMedias(page: Page) {
  let soltar!: () => void;
  const puerta = new Promise<void>(resolver => (soltar = resolver));
  await simularSubida(page, puerta);
  await abrirLaCaja(page, URL_CAJA.edicion);
  const subida = page.waitForRequest('**/s3-falso/subida');
  await page.locator('input[type="file"]').setInputFiles(VIDEO);
  await subida;
  return soltar;
}

test('una subida en curso sigue al cambiar de pestaña, y el video listo y su precio están al volver a Edición', async ({ page }) => {
  await simular(page);
  const soltar = await subirAMedias(page);
  // sube (el PUT está esperando) y se cambia de pestaña: la caja es la misma página, la subida no se cancela
  await riel(page, 'Imagen').click();
  await esperarRuta(page, URL_CAJA.imagen);
  // la subida termina (y pide el precio) con otra pestaña a la vista
  const precio = page.waitForResponse('**/api/edicion/cotizar');
  soltar();
  await precio;
  await riel(page, 'Edición').click();
  await esperarRuta(page, URL_CAJA.edicion);
  await expect(page.getByRole('button', { name: 'Iniciar ✦ 8' })).toBeVisible();
  await expect(page.getByText('entrevista.mp4')).toBeVisible();
});

// Antes la subida seguía sola con el mapa abierto (la caja quedaba montada debajo), y no había nada que avisar. Ahora salir de la caja la corta:
// el navegador pregunta antes (beforeunload, useEdicion.ts), y si la caja volviera a quedarse montada bajo el mapa, no habría pregunta.
test('salir de la caja con una subida a medias pide confirmar; quedarse la deja terminar, y ya terminada salir no pregunta', async ({ page }) => {
  const avisos = oirAvisos(page, 'quedarse');
  const pedidos = oirSubida(page);
  await simular(page);
  const soltar = await subirAMedias(page);
  // `.click()` y no `irAlMapa`: con el aviso no hay navegación que esperar
  await migas(page).getByRole('link', { name: /^Volver al mapa/ }).click();
  await expect.poll(() => avisos).toEqual(['beforeunload']);
  expect(rutaDe(page)).toBe(URL_CAJA.edicion);
  // quedarse: la subida termina en esta misma página, con su precio
  const precio = page.waitForResponse('**/api/edicion/cotizar');
  soltar();
  await precio;
  await expect(page.getByRole('button', { name: 'Iniciar ✦ 8' })).toBeVisible();
  await expect(page.getByText('entrevista.mp4')).toBeVisible();
  expect(pedidos).toEqual(['/api/media/confirmar', '/api/edicion/cotizar']);
  // ya sin nada a medias, salir no pregunta (con «quedarse», un aviso dejaría la prueba esperando en irAlMapa), y el video no viaja (D11)
  await irAlMapa(page);
  expect(avisos).toEqual(['beforeunload']);
  await elegir(page, 'Marketing', 'Distrito');
  await elegirHerramienta(page, 'Edición');
  await expect(page.getByText('entrevista.mp4')).toHaveCount(0);
});

test('salir de la caja con una subida a medias y aceptar el aviso la corta: no se confirma ni se cotiza, y la caja nueva no la trae', async ({ page }) => {
  const avisos = oirAvisos(page, 'aceptar');
  const pedidos = oirSubida(page);
  await simular(page);
  const soltar = await subirAMedias(page);
  await irAlMapa(page);
  expect(avisos).toEqual(['beforeunload']);
  // el PUT de la página que se fue termina ahora: ya no queda quién lo confirme
  soltar();
  await elegir(page, 'Marketing', 'Distrito');
  await elegirHerramienta(page, 'Edición');
  await expect(page.getByText('entrevista.mp4')).toHaveCount(0);
  expect(pedidos, 'la subida cortada siguió: se confirmó o se cotizó').toEqual([]);
});

// «Mis creaciones» y «Tu primer video, en tres caminos» van debajo de la caja: salen con ella y no existen en las páginas de navegación (antes
// seguían montadas y escondidas, y `toBeHidden` bastaba; ahora `toHaveCount(0)`: escondidas ya no vale).
test('«Mis creaciones» solo existe en la página de la caja, en sus tres pestañas (en el mapa, las opciones y las listas no está)', async ({ page }) => {
  await simular(page, { imagenes: 2 });
  await abrirInicio(page);
  const creaciones = page.getByRole('region', { name: 'Mis creaciones' });
  await expect(creaciones, 'en el mapa').toHaveCount(0);
  await ficha(page, 'Marketing').click();
  await esperarRuta(page, URL_MARKETING);
  await expect(creaciones, 'en las opciones').toHaveCount(0);
  await opcion(page, 'Marketing', 'Blotato').click();
  await esperarRuta(page, URL_BLOTATO);
  await expect(paso(page)).toHaveText('Blotato');
  await expect(creaciones, 'en la lista de Blotato').toHaveCount(0);
  await expect(page.locator('#creaciones-titulo')).toHaveCount(0);
  await irA(page, 'Marketing', 'Distrito');
  await expect(creaciones, 'en la lista de Distrito').toHaveCount(0);
  for (const [, nombre] of PESTANAS) {
    await elegirHerramienta(page, nombre);
    await expect(creaciones, `en la caja de ${nombre}`).toBeVisible();
    await page.goBack();
    await esperarRuta(page, URL_DISTRITO);
  }
  await abrirLaCaja(page);
  await irAlMapa(page);
  await expect(creaciones, 'de vuelta en el mapa').toHaveCount(0);
});

test('«Tu primer video, en tres caminos» (quien empieza) solo existe en la página de la caja', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  const caminos = page.getByRole('region', { name: 'Tu primer video, en tres caminos' });
  await expect(caminos).toHaveCount(0);
  await elegir(page, 'Marketing', 'Distrito');
  await expect(caminos, 'en la lista de Distrito').toHaveCount(0);
  await elegirHerramienta(page, 'Video');
  await expect(caminos).toBeVisible();
  await irAlMapa(page);
  await expect(caminos).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Blotato: se entra por la dirección del grupo (Marketing › Blotato y › Avanzado), que es donde se usa

const LISTA_DE_BLOTATO = ['Agenda tus publicaciones', 'Investiga tu competencia', 'Ver mis métricas'];

test.describe('Blotato SIN conectar', () => {
  test('las tres pantallas salen apagadas y un clic abre el diálogo de conectar, sin navegar ni mover la página', async ({ page }) => {
    const { pedidos } = await simular(page, { blotato: 'sin-conectar' });
    await vigilarNavegaciones(page);
    await abrirInicio(page, URL_BLOTATO);
    await expect(paso(page)).toHaveText('Blotato');
    await expect(page).toHaveTitle('Estudio de video · Marketing · Blotato');
    const enlaces = tarjetasDeLaLista(page);
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

    // apagada con `aria-disabled`: el clic llega (por eso `force`) y ofrece conectar en vez de navegar
    await sinNavegar(page, () => enlaces.first().click({ force: true }), URL_BLOTATO, 'el clic en una pantalla apagada');
    const dialogo = page.getByRole('dialog', { name: 'Conecta tu Blotato' });
    await expect(dialogo).toBeVisible();
    await expect.poll(() => pedidos.at(-1)).toBe('GET');
    // Esc es del diálogo: lo cierra, la página se queda donde estaba y el foco vuelve a la tarjeta que lo abrió (no a <body>). Es la
    // primera apertura, sin nada retenido: el orden natural (abajo, las dos maneras de llegar a ese instante)
    await sinNavegar(page, () => page.keyboard.press('Escape'), URL_BLOTATO, 'Esc en el diálogo');
    await expect(dialogo).toBeHidden();
    await expect(paso(page)).toHaveText('Blotato');
    await expect(enlaces.first()).toBeFocused();
  });

  // Antes: «Esc cierra el diálogo, y el foco queda en algo (no en <body>)». Al cerrar, el diálogo devuelve el foco a lo que lo tenía al abrirse
  // (`useFocoDeVuelta`, ui/Dialogo.tsx), y lo anota en el instante en que el diálogo se monta. Dos maneras de llegar a ese instante:
  //  · la lectura llega ANTES que el código del diálogo (que se pide con import(), página aparte). Es el orden de siempre en la primera
  //    apertura: el diálogo se monta ya con el campo, y su autoFocus le quita el foco al botón antes de que el diálogo lo anote. Antes el
  //    foco caía a <body>; ahora GrupoConBlotato anota quién lo abrió y se lo pasa de respaldo (`focoDeRespaldo`) → vuelve al botón;
  //  · la lectura completa del estado (`GET /api/blotato`) tarda más que el código del diálogo: se monta «revisando», con el botón aún
  //    enfocado, y el campo de la clave (autoFocus) aparece después → el foco vuelve al botón. Ese orden hay que forzarlo (la puerta).
  test('Esc cierra el diálogo y el foco vuelve al botón que lo abrió: la lectura del estado llega DESPUÉS de que el diálogo se monta', async ({ page }) => {
    await simular(page, { blotato: 'sin-conectar' });
    let soltar!: () => void;
    const puerta = new Promise<void>(resolver => (soltar = resolver));
    // solo la lectura completa (la del diálogo); la ligera (`?redes=0`) es la del montaje de la lista
    await page.route(/\/api\/blotato$/, async r => {
      await puerta;
      await r.fallback();
    });
    await abrirInicio(page, URL_BLOTATO);
    const boton = region(page).getByRole('button', { name: 'Conecta tu cuenta de Blotato' });
    await boton.click();
    const dialogo = page.getByRole('dialog', { name: 'Conecta tu Blotato' });
    await expect(dialogo).toBeVisible();
    soltar();
    await expect(dialogo.getByLabel('Tu clave de API de Blotato')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialogo).toBeHidden();
    await expect(boton).toBeFocused();
  });

  // Era un defecto conocido (con test.fail hasta el arreglo de GrupoConBlotato): el foco caía a <body>. El orden ya es el natural de la
  // primera apertura; retrasar el código del diálogo solo lo vuelve seguro bajo carga (la lectura, de mentira, llega en milisegundos).
  test('Esc cierra el diálogo y el foco vuelve al botón que lo abrió: la lectura del estado llega ANTES de que el diálogo se monte', async ({ page }) => {
    await simular(page, { blotato: 'sin-conectar' });
    await page.route(/\/estudio\/assets\/Blotato-[^/]*\.js$/, async r => {
      await new Promise(resolver => setTimeout(resolver, 700));
      await r.continue();
    });
    await abrirInicio(page, URL_BLOTATO);
    const boton = region(page).getByRole('button', { name: 'Conecta tu cuenta de Blotato' });
    await boton.click();
    const dialogo = page.getByRole('dialog', { name: 'Conecta tu Blotato' });
    await expect(dialogo.getByLabel('Tu clave de API de Blotato')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialogo).toBeHidden();
    await expect(boton).toBeFocused();
  });

  test('el botón «Conecta tu cuenta de Blotato» abre el diálogo, y al conectar se encienden las tres pantallas', async ({ page }) => {
    const { claves, pedidos } = await simular(page, { blotato: 'sin-conectar' });
    await abrirInicio(page, URL_BLOTATO);
    // el control: antes de conectar, las tres están apagadas
    await expect(region(page).locator('a[aria-disabled="true"]')).toHaveCount(3);
    await region(page).getByRole('button', { name: 'Conecta tu cuenta de Blotato' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Conecta tu Blotato' });
    await dialogo.getByLabel('Tu clave de API de Blotato').fill('clave-de-prueba');
    await dialogo.getByRole('button', { name: 'Conectar' }).click();
    // ya conectado, el diálogo cambia de título («Tu Blotato»): es el mismo, ahora sin el formulario
    const conectado = page.getByRole('dialog', { name: 'Tu Blotato' });
    await expect(conectado.getByText('Tu Blotato está conectado')).toBeVisible();
    expect(claves).toEqual(['clave-de-prueba']);
    expect(pedidos.at(-1)).toBe('POST');
    await page.keyboard.press('Escape');
    await expect(conectado).toBeHidden();
    // la lista se enciende con lo que contestó el POST, sin recargar
    const enlaces = tarjetasDeLaLista(page);
    await expect(enlaces).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(enlaces.nth(i)).not.toHaveAttribute('aria-disabled', 'true');
    await expect(region(page).locator('a[aria-disabled="true"]')).toHaveCount(0);
    await expect(region(page).getByText('Conecta tu Blotato para usarlo')).toHaveCount(0);
    await expect(region(page).getByRole('button', { name: 'Blotato conectado: ver o cambiar' })).toBeVisible();
  });
});

test.describe('Blotato conectado', () => {
  test('las tres pantallas salen encendidas y llevan a su página; el botón dice «Blotato conectado: ver o cambiar»', async ({ page }) => {
    await simular(page, { blotato: 'conectado' });
    await abrirInicio(page, URL_BLOTATO);
    const enlaces = tarjetasDeLaLista(page);
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
    await abrirInicio(page, URL_BLOTATO);
    const enlaces = tarjetasDeLaLista(page);
    await expect(enlaces).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(enlaces.nth(i)).not.toHaveAttribute('aria-disabled', 'true');
    await expect(region(page).getByText('Conecta tu Blotato para usarlo')).toHaveCount(0);
    await Promise.all([page.waitForURL(/\/estudio\/competencia\//), enlaces.nth(1).click()]);
  });
});

test('Avanzado: «Publicaciones automáticas» se apaga sin Blotato y abre el diálogo; la «Copiadora de estilos» no, y no hay botón de conectar', async ({ page }) => {
  await simular(page, { blotato: 'sin-conectar' });
  await vigilarNavegaciones(page);
  // por la dirección: llegando con un clic, el clic forzado de abajo caería en el <html> mientras corre la View Transition y no abriría nada
  await abrirInicio(page, URL_AVANZADO);
  await expect(paso(page)).toHaveText('Avanzado');
  await expect(page).toHaveTitle('Estudio de video · Marketing · Avanzado');
  // el botón de conectar solo va en un grupo que depende ENTERO de Blotato; Avanzado trae la Copiadora, que no
  await expect(region(page).getByRole('button', { name: /Blotato/ })).toHaveCount(0);
  const mix = region(page).getByRole('link', { name: /Publicaciones automáticas/ });
  const copiadora = region(page).getByRole('link', { name: /Copiadora de estilos/ });
  await expect(mix).toHaveAttribute('aria-disabled', 'true');
  await expect(copiadora).not.toHaveAttribute('aria-disabled', 'true');
  await expect(copiadora).not.toContainText('Conecta tu Blotato');
  await sinNavegar(page, () => mix.click({ force: true }), URL_AVANZADO, 'el clic en «Publicaciones automáticas» apagada');
  await expect(page.getByRole('dialog', { name: 'Conecta tu Blotato' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await Promise.all([page.waitForURL(/\/estudio\/estilos\//), copiadora.click()]);
});

// ---------------------------------------------------------------------------
// Central

test('Central: el grupo Distrito trae dos pantallas «Próximamente» que no navegan y COI y la Biblioteca de prompts (encendidas) que sí, y Deepseek dice que todavía no está disponible', async ({ page }) => {
  await simular(page);
  await vigilarNavegaciones(page);
  await abrirInicio(page);
  await ficha(page, 'Central').click();
  await esperarRuta(page, URL_CENTRAL);
  await expect(page).toHaveTitle('Estudio de video · Central');
  await expect(paso(page)).toHaveText('Elige un grupo');
  await expect(region(page).getByRole('group', { name: 'Central', exact: true }).getByRole('link')).toHaveText([/^Distrito/, /^Deepseek/]);
  await expect(opcion(page, 'Central', 'Deepseek')).toContainText('Próximamente');
  // nadie ha elegido nada: «Estás aquí» no está en ninguna de sus opciones
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);

  await opcion(page, 'Central', 'Distrito').click();
  await esperarRuta(page, '/estudio/central/distrito/');
  await expect(page).toHaveTitle('Estudio de video · Central · Distrito');
  await expect(paso(page)).toHaveText('Distrito');
  await expect(migas(page).getByRole('link')).toHaveText(['Central', 'Distrito']);
  // COI y la Biblioteca (16-oct-2026) ya existen y son enlaces (su navegación la prueban e2e/coi.spec.ts y e2e/biblioteca.spec.ts); las otras dos
  // siguen apagadas: tarjetas quietas, sin enlace
  for (const titulo of ['COI', 'Biblioteca de prompts']) await expect(region(page).getByText(titulo, { exact: true })).toBeVisible();
  for (const titulo of ['Preguntas sobre la clase', 'Glosario IA']) {
    const fila = region(page).getByText(titulo, { exact: true });
    await expect(fila).toBeVisible();
    await sinNavegar(page, () => fila.click(), '/estudio/central/distrito/', `«${titulo}»`);
  }
  await expect(region(page).getByText('Próximamente')).toHaveCount(2);
  const tarjetas = tarjetasDeLaLista(page);
  await expect(tarjetas).toHaveText([/^COI/, /^Biblioteca de prompts/]);
  await expect(tarjetas.first()).toHaveAttribute('href', '/estudio/coi/');
  await expect(tarjetas.last()).toHaveAttribute('href', '/estudio/biblioteca/');

  // el mapa y las opciones de Central no marcan nada tras haber estado en su Distrito (antes, «Estás aquí» en Distrito)
  await irAlMapa(page);
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
  await ficha(page, 'Central').click();
  await esperarRuta(page, URL_CENTRAL);
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
  await expect(opcion(page, 'Central', 'Distrito')).not.toHaveAttribute('aria-current', /./);
  // ni las de Marketing
  await irAlMapa(page);
  await ficha(page, 'Marketing').click();
  await esperarRuta(page, URL_MARKETING);
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
  // y el otro grupo de Central: su propia página, que dice que todavía no está disponible (D5)
  await irAlMapa(page);
  await elegir(page, 'Central', 'Deepseek');
  expect(rutaDe(page)).toBe('/estudio/central/deepseek/');
  await expect(page).toHaveTitle('Estudio de video · Central · Deepseek');
  await expect(paso(page)).toHaveText('Deepseek');
  await expect(region(page).getByText('Todavía no está disponible.')).toBeVisible();
});

// ---------------------------------------------------------------------------
// teclado y foco
//
// La página ya no lleva el foco al título de cada paso: antes un clic cambiaba el paso en la misma página, el botón pulsado desaparecía y, sin ese
// cuidado, el foco caía a <body>. Ahora cada paso es un documento nuevo: el navegador lo deja al principio, el lector de pantalla anuncia su
// <title> y Tab entra por el primer elemento de LA PÁGINA NUEVA. Lo que se probaba —que el foco no se pierde en algo que ya no existe— se prueba
// como eso: la página nueva empieza en <body> (sin un foco prestado, ni puesto con código en su título) y el primer Tab cae en su contenido.

test('Esc: en el mapa no hace nada, en las opciones sube al mapa (también con el foco dentro de ellas), y en la caja y en una lista no hace nada (ni borra lo escrito)', async ({ page }) => {
  await simular(page);
  await vigilarNavegaciones(page);
  await abrirInicio(page);

  // en el mapa (lo primero que se ve): nada, aunque el foco esté en una ficha
  await ficha(page, 'Marketing').focus();
  await sinNavegar(page, () => page.keyboard.press('Escape'), URL_MAPA, 'Esc en el mapa');
  await expect(paso(page)).toHaveText('Elige un área');
  await expect(ficha(page, 'Marketing')).toBeFocused();

  // en las opciones sube un nivel, al mapa, aunque el foco esté en una de sus tarjetas (con el foco en <body>: niveles.spec.ts)
  await ficha(page, 'Central').click();
  await esperarRuta(page, URL_CENTRAL);
  await expect(paso(page)).toHaveText('Elige un grupo');
  await opcion(page, 'Central', 'Distrito').focus();
  await page.keyboard.press('Escape');
  await esperarRuta(page, URL_MAPA);
  await expect(paso(page)).toHaveText('Elige un área');

  // en la caja: nada (ni cambia de página ni borra lo escrito)
  await elegir(page, 'Marketing', 'Distrito');
  await elegirHerramienta(page, 'Video');
  const cuadro = page.getByRole('textbox', { name: CAJA });
  await cuadro.fill('texto que no se pierde');
  await cuadro.focus();
  await sinNavegar(page, () => page.keyboard.press('Escape'), URL_CAJA.video, 'Esc en la caja');
  await expect(paso(page)).toHaveText(CAJA);
  await expect(cuadro).toBeFocused();
  await expect(cuadro).toHaveValue('texto que no se pierde');

  // en las opciones, venidas de la caja, también al MAPA (no «regresa a la caja»: la miga es la que sube, y Esc sube al mapa)
  await migas(page).getByRole('link', { name: /^Volver a las opciones de Marketing/ }).click();
  await esperarRuta(page, URL_MARKETING);
  await expect(paso(page)).toHaveText('Elige un grupo');
  await page.keyboard.press('Escape');
  await esperarRuta(page, URL_MAPA);

  // en la lista de un grupo: nada
  await elegir(page, 'Marketing', 'Blotato');
  await sinNavegar(page, () => page.keyboard.press('Escape'), URL_BLOTATO, 'Esc en la lista de Blotato');
  await expect(paso(page)).toHaveText('Blotato');
});

test('al cambiar de página con el ratón el foco no se queda en algo que ya no existe: la página nueva empieza arriba, dice dónde cae con su <title> y el primer Tab entra a su contenido', async ({ page }) => {
  await simular(page);
  /** La página a la que se llegó: su camino, su título, su `h2`, sin foco (ni el de la anterior ni el de su título) y lo primero que se tabula. */
  const aterrizar = async (camino: string, titulo: string, h2: string, primerTab: string) => {
    await esperarRuta(page, camino);
    await expect(page).toHaveTitle(titulo);
    await expect(paso(page)).toHaveText(h2);
    await trasPintar(page);
    expect((await enfocado(page)).etiqueta, `${camino}: la página nueva debe empezar sin foco`).toBe('body');
    await page.keyboard.press('Tab');
    expect((await enfocado(page)).texto, `${camino}: lo primero que se tabula`).toBe(primerTab);
  };
  await abrirInicio(page);
  await aterrizar(URL_MAPA, TITULO_MAPA, 'Elige un área', 'Marketing');

  // en las demás páginas lo primero es la miga del área, antes que el contenido
  await ficha(page, 'Marketing').click();
  await aterrizar(URL_MARKETING, 'Estudio de video · Marketing', 'Elige un grupo', 'Marketing');
  await opcion(page, 'Marketing', 'Blotato').click();
  await aterrizar(URL_BLOTATO, 'Estudio de video · Marketing · Blotato', 'Blotato', 'Marketing');
  await migas(page).getByRole('link', { name: /^Volver al mapa/ }).click();
  await aterrizar(URL_MAPA, TITULO_MAPA, 'Elige un área', 'Marketing');

  await ficha(page, 'Marketing').click();
  await aterrizar(URL_MARKETING, 'Estudio de video · Marketing', 'Elige un grupo', 'Marketing');
  await opcion(page, 'Marketing', 'Blotato').click();
  await aterrizar(URL_BLOTATO, 'Estudio de video · Marketing · Blotato', 'Blotato', 'Marketing');
  await migas(page).getByRole('link', { name: /^Volver a las opciones de Marketing/ }).click();
  await aterrizar(URL_MARKETING, 'Estudio de video · Marketing', 'Elige un grupo', 'Marketing');
  await opcion(page, 'Marketing', 'Distrito').click();
  await aterrizar(URL_DISTRITO, 'Estudio de video · Marketing · Distrito', 'Distrito', 'Marketing');
  // la caja: su título se puede enfocar con código (tabindex -1), pero nadie lo hace al llegar
  await herramienta(page, 'Video').click();
  await aterrizar(URL_CAJA.video, 'Estudio de video · Marketing · Distrito · Video', CAJA, 'Marketing');
  await migas(page).getByRole('link', { name: /^Volver al mapa/ }).click();
  await aterrizar(URL_MAPA, TITULO_MAPA, 'Elige un área', 'Marketing');
});

// Lo pulsado puede no mover el foco (la acción «hacer clic» de un lector en modo exploración, el control por voz, un `.click()`): el campo de la
// caja sigue siendo `activeElement` en el instante en que se sale de ella. Antes la caja se escondía con el foco adentro y Chromium lo soltaba a
// <body>; ahora la caja se va con su página, y la nueva no hereda nada: empieza en <body>, Tab entra a su contenido y Esc vale sin tabular.
test('el foco que estaba DENTRO de la caja al salir por una miga sin mover el foco (.click()) no pasa a la página nueva: empieza arriba, y Tab y Esc valen', async ({ page }) => {
  await simular(page);
  const pulsarSinMoverElFoco = (miga: RegExp) => migas(page).getByRole('link', { name: miga }).evaluate(a => (a as HTMLAnchorElement).click());
  for (const [desde, alcanzar] of [
    ['el cuadro de texto', () => page.getByRole('textbox', { name: CAJA }).focus()],
    ['el chip «Un video corto ▾»', () => page.locator('button[aria-haspopup="listbox"]').focus()],
  ] as const) {
    // la miga del grupo: a las opciones, y de ahí Esc sube al mapa sin tocar nada más
    await abrirLaCaja(page);
    await alcanzar();
    await pulsarSinMoverElFoco(/^Volver a las opciones de Marketing/);
    await esperarRuta(page, URL_MARKETING);
    await expect(paso(page), `desde ${desde}`).toHaveText('Elige un grupo');
    await trasPintar(page);
    expect((await enfocado(page)).etiqueta, `desde ${desde}: las opciones heredaron un foco`).toBe('body');
    await page.keyboard.press('Escape');
    await esperarRuta(page, URL_MAPA);

    // la miga del área: al mapa, y Tab entra por la primera ficha
    await abrirLaCaja(page);
    await alcanzar();
    await pulsarSinMoverElFoco(/^Volver al mapa/);
    await esperarRuta(page, URL_MAPA);
    await expect(paso(page), `desde ${desde}`).toHaveText('Elige un área');
    await trasPintar(page);
    expect((await enfocado(page)).etiqueta, `desde ${desde}: el mapa heredó un foco`).toBe('body');
    await page.keyboard.press('Tab');
    await expect(ficha(page, 'Marketing'), `desde ${desde}: Tab no entró al mapa`).toBeFocused();
  }
});

test('Tab recorre el mapa en orden de lectura: solo las cinco fichas, y antes de la primera y después de la última no hay nada de la región', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  // recién cargada la página el foco está en <body>: el primer Tab va a la primera ficha
  expect((await enfocado(page)).etiqueta).toBe('body');
  const paradas = [];
  for (let i = 0; i < AREAS.length; i++) {
    await page.keyboard.press('Tab');
    paradas.push(await enfocado(page));
  }
  // tres enlaces y dos botones apagados (Producto y Ventas siguen en el orden de Tab)
  const nombre = (p: { texto: string }) => p.texto.replace(/Próximamente$/, '');
  expect(paradas.map(nombre)).toEqual([...AREAS]);
  expect(paradas.map(p => p.etiqueta)).toEqual(['a', 'button', 'a', 'button', 'a']);
  // ni migas ni «Volver a …» que tabular: la sexta parada ya no es de la región, y antes de la primera ficha tampoco hay nada de ella
  const enLaRegion = () => region(page).evaluate(r => r.contains(document.activeElement));
  await page.keyboard.press('Tab');
  expect(await enLaRegion()).toBe(false);
  await ficha(page, 'Marketing').focus();
  await page.keyboard.press('Shift+Tab');
  expect(await enLaRegion()).toBe(false);
});

test('con solo el teclado: Enter en una ficha, en una tarjeta y en una herramienta llevan hasta la caja, y Tab sigue desde el principio de cada página', async ({ page }) => {
  await simular(page);
  await abrirInicio(page);
  await ficha(page, 'Marketing').focus();
  await page.keyboard.press('Enter');
  await esperarRuta(page, URL_MARKETING);
  await expect(paso(page)).toHaveText('Elige un grupo');
  // página nueva: sin foco. Tab entra por la miga del área, que está antes que las tarjetas en la página, y sigue por ellas
  expect((await enfocado(page)).etiqueta).toBe('body');
  await page.keyboard.press('Tab');
  expect((await enfocado(page)).texto).toBe('Marketing');
  await page.keyboard.press('Tab');
  expect((await enfocado(page)).texto).toMatch(/^Distrito/);
  await page.keyboard.press('Shift+Tab');
  expect((await enfocado(page)).texto).toBe('Marketing');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await esperarRuta(page, URL_DISTRITO);
  await expect(paso(page)).toHaveText('Distrito');
  // la lista de herramientas: dos migas y luego Imagen · Video · Edición
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  expect((await enfocado(page)).texto).toMatch(/^Imagen/);
  await page.keyboard.press('Tab');
  expect((await enfocado(page)).texto).toMatch(/^Video/);
  await page.keyboard.press('Enter');
  await esperarRuta(page, URL_CAJA.video);
  await expect(paso(page)).toHaveText(CAJA);
  // la caja: las dos migas, las tres pestañas del riel y el cuadro de texto
  const paradas = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    paradas.push((await enfocado(page)).etiqueta);
  }
  expect(paradas).toEqual(['a', 'a', 'button', 'button', 'button', 'textarea']);
});

// ---------------------------------------------------------------------------
// el celular: la X compacta y lo demás

/** Una página de cada clase del recorrido (también las que dicen «Todavía no está disponible.» y las tres pestañas de la caja), para auditar a
 *  cada ancho. Se entra por la dirección: cada nivel es un documento, y llegar con un clic no cambia lo que se pinta (el paso de una a otra con
 *  el ratón lo miden las de geometría y foco de arriba). `apagadas`: con Blotato sin conectar, lo apagado llega después del primer pintado (con
 *  la lectura de su estado), y se audita ya con su aviso. */
const PAGINAS: ReadonlyArray<{ donde: string; url: string; apagadas?: number }> = [
  { donde: 'el mapa', url: URL_MAPA },
  { donde: 'las opciones de Marketing', url: URL_MARKETING },
  { donde: 'la lista de Distrito', url: URL_DISTRITO },
  { donde: 'la lista de Blotato', url: URL_BLOTATO, apagadas: 3 },
  { donde: 'la lista de Avanzado', url: URL_AVANZADO, apagadas: 1 },
  { donde: 'las opciones de Central', url: URL_CENTRAL },
  { donde: 'Central › Distrito', url: '/estudio/central/distrito/' },
  { donde: 'Central › Deepseek', url: '/estudio/central/deepseek/' },
  { donde: 'las opciones de Automatizaciones', url: URL_AUTOMATIZACIONES },
  { donde: 'Automatizaciones › Distrito', url: '/estudio/automatizaciones/distrito/' },
  { donde: 'Automatizaciones › Tus automatizaciones', url: '/estudio/automatizaciones/tus/' },
  { donde: 'Producto', url: '/estudio/producto/' },
  { donde: 'Ventas', url: '/estudio/ventas/' },
  { donde: 'la caja en Imagen', url: URL_CAJA.imagen },
  { donde: 'la caja en Video', url: URL_CAJA.video },
  { donde: 'la caja en Edición', url: URL_CAJA.edicion },
];

/** Recorre `PAGINAS` y audita cada una, ya pintada del todo. */
async function auditarLasPaginas(page: Page, ademas?: (url: string) => Promise<void>) {
  for (const { donde, url, apagadas } of PAGINAS) {
    await abrirInicio(page, url);
    await expect(paso(page), donde).toBeVisible();
    if (apagadas) await expect(region(page).getByText('Conecta tu Blotato para usarlo'), donde).toHaveCount(apagadas);
    await page.evaluate(() => document.fonts.ready);
    await auditar(page, donde);
    await ademas?.(url);
  }
}

for (const ancho of [390, 320]) {
  test.describe(`a ${ancho} px`, () => {
    test.use({ viewport: { width: ancho, height: 800 } });

    test('el mapa es una X compacta: dos columnas, Central en una banda de ancho completo, trazos cortos y sin desborde', async ({ page }) => {
      await simular(page);
      await abrirInicio(page);
      const c = {} as Record<(typeof AREAS)[number], { x: number; y: number; width: number; height: number }>;
      for (const a of AREAS) c[a] = (await cualquierFicha(page, a).boundingBox())!;

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
        cualquierFicha(page, area).evaluate(f => {
          const s = Array.from(f.querySelectorAll('span[aria-hidden="true"]')).find(x => getComputedStyle(x).borderLeftStyle === 'dotted');
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
      const nombre = cualquierFicha(page, 'Automatizaciones').getByText('Automatizaciones', { exact: true });
      expect(await lineasDe(nombre), '«Automatizaciones» se parte en dos líneas').toBe(1);
      const sobra = await nombre.evaluate(el => {
        const t = el.getBoundingClientRect();
        const f = (el.closest('a, button') as HTMLElement).getBoundingClientRect();
        return { derecha: t.right - f.right, izquierda: f.left - t.left };
      });
      expect(sobra.derecha, '«Automatizaciones» se sale de su ficha').toBeLessThanOrEqual(0);
      expect(sobra.izquierda, '«Automatizaciones» se sale de su ficha').toBeLessThanOrEqual(0);
      expect(await lineasDe(fichaApagada(page, 'Producto').getByText('Próximamente')), '«Próximamente» se parte').toBe(1);
      expect(await sobraAlLado(page)).toBeLessThanOrEqual(0);
    });

    test('cada página (mapa, opciones, listas, «Todavía no está disponible.» y la caja en sus tres pestañas) cabe: sin desborde, lo tocable de 44 px y letra de 13 px o más', async ({ page }) => {
      await simular(page, { blotato: 'sin-conectar' });
      await auditarLasPaginas(page, async url => {
        if (url !== URL_MARKETING) return;
        // en una sola columna: cada tarjeta de las opciones ocupa el ancho y no hay dos en una fila
        const columnas = await region(page)
          .getByRole('group', { name: 'Marketing', exact: true })
          .getByRole('link')
          .evaluateAll(ts => ts.map(t => Math.round(t.getBoundingClientRect().x)));
        expect(columnas, 'las opciones de Marketing').toHaveLength(3);
        expect(new Set(columnas).size, 'las opciones no se apilan en una columna').toBe(1);
      });
    });
  });
}

test('a 1100 px cada página cumple lo mismo: sin desborde, lo tocable de 44 px y letra de 13 px o más', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await simular(page, { blotato: 'sin-conectar' });
  await auditarLasPaginas(page);
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
    const cajas = await Promise.all(AREAS.map(a => cualquierFicha(page, a).boundingBox()));
    for (const [i, c] of cajas.entries()) {
      expect(c!.height, `a ${ancho} px ${AREAS[i]} mide ${c!.height} de alto`).toBeGreaterThanOrEqual(44);
      expect(c!.x + c!.width, `a ${ancho} px ${AREAS[i]} se sale por la derecha`).toBeLessThanOrEqual(ancho);
    }
    if (ancho <= 559) await expect(equis, `a ${ancho} px sigue la X grande`).toBeHidden();
    if (ancho >= 561) await expect(equis, `a ${ancho} px falta la X grande`).toBeVisible();
  }
});

// ---------------------------------------------------------------------------
// desde una página hoja: las migas llevan al mapa y a las opciones del área, de punta a punta
//
// Antes la miga de una hoja (la agenda…) era un enlace a `/estudio/inicio/?desde=<lugar>&ver=<mapa|grupos>`: el inicio lo leía una vez, limpiaba la
// dirección, ponía el foco en el título, marcaba «Estás aquí» y enseñaba «Volver a Agenda» (con Esc de regreso). Ahora la miga es un enlace directo a
// la página del nivel (`/estudio/` o `/estudio/marketing/`, `urlDeInicio` de marca/menu.ts) y no lleva nada en la dirección. Lo que hacía el inicio se
// prueba al revés (no hay «Volver a …», ni «Estás aquí», ni foco en el título, ni Esc de regreso) o con su equivalente por páginas («atrás» regresa a
// la hoja). Retirada, sin nada que medir en su lugar: «desde la agenda, «Volver a Agenda…» va centrado bajo el título» (la posición de un enlace
// que ya no existe; que no existe lo afirman las de abajo, y el centrado del mapa al que se llega, las de geometría).

const HOJAS = [
  { ruta: 'agenda', titulo: 'Agenda tus publicaciones', grupo: 'Blotato' },
  { ruta: 'competencia', titulo: 'Investiga tu competencia', grupo: 'Blotato' },
  { ruta: 'metricas', titulo: 'Ver mis métricas', grupo: 'Blotato' },
  { ruta: 'mix', titulo: 'Publicaciones automáticas', grupo: 'Avanzado' },
  { ruta: 'estilos', titulo: 'Copiadora de estilos', grupo: 'Avanzado' },
] as const;

const AL_MAPA = /^Ir al mapa/;
const A_LAS_OPCIONES = /^Ir a las opciones/;

for (const hoja of HOJAS) {
  test(`desde /estudio/${hoja.ruta}/: la miga «Marketing» cae en el mapa con la dirección limpia, sin «Volver a ${hoja.titulo}» ni foco en el título, y «atrás» regresa a la hoja`, async ({ page }) => {
    await simular(page);
    await page.goto(`/estudio/${hoja.ruta}/`);
    await expect(migaDeHoja(page, AL_MAPA)).toHaveAttribute('href', URL_MAPA);
    await migaDeHoja(page, AL_MAPA).click();
    await esperarRuta(page, URL_MAPA);
    // limpia desde el primer momento, sin ?desde=&ver= que la página tenga que leer y quitar
    expect(direccionDe(page)).toBe(URL_MAPA);
    await expect(page).toHaveTitle(TITULO_MAPA);
    await expect(paso(page)).toHaveText('Elige un área');
    await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
    // ya no hay «Volver a …»: volver a donde se estaba es el «atrás» del navegador
    await expect(volverA(page, hoja.titulo)).toHaveCount(0);
    await expect(algunVolver(page)).toHaveCount(0);
    // y el foco no va al título: la página empieza arriba, y el primer Tab cae en la primera ficha
    await trasPintar(page);
    expect((await enfocado(page)).etiqueta).toBe('body');
    await page.keyboard.press('Tab');
    await expect(ficha(page, 'Marketing')).toBeFocused();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/estudio/${hoja.ruta}/`));
  });

  test(`desde /estudio/${hoja.ruta}/: la miga «${hoja.grupo}» cae en las opciones de Marketing SIN «Estás aquí» en ${hoja.grupo}, y «atrás» regresa a la hoja`, async ({ page }) => {
    await simular(page);
    await page.goto(`/estudio/${hoja.ruta}/`);
    const miga = migaDeHoja(page, new RegExp(`^Ir a las opciones de Marketing \\(ahora: ${hoja.grupo}\\)`));
    await expect(miga).toHaveAttribute('href', URL_MARKETING);
    await miga.click();
    await esperarRuta(page, URL_MARKETING);
    expect(direccionDe(page)).toBe(URL_MARKETING);
    await expect(page).toHaveTitle('Estudio de video · Marketing');
    await expect(paso(page)).toHaveText('Elige un grupo');
    // antes «Estás aquí» marcaba el grupo del que se venía; ahora lo recuerda el historial, no la página
    await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
    await expect(opcion(page, 'Marketing', hoja.grupo)).not.toHaveAttribute('aria-current', /./);
    await expect(volverA(page, hoja.titulo)).toHaveCount(0);
    await trasPintar(page);
    expect((await enfocado(page)).etiqueta).toBe('body');
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/estudio/${hoja.ruta}/`));
  });
}

const HOJAS_DE_AUTOMATIZACIONES = [
  { ruta: 'constructor', lugar: 'automatizaciones.distrito.constructor', titulo: 'Constructor' },
  { ruta: 'asistente', lugar: 'automatizaciones.distrito.asistente', titulo: 'Asistente' },
] as const;

for (const hoja of HOJAS_DE_AUTOMATIZACIONES) {
  test(`desde /estudio/${hoja.ruta}/: sus migas llevan al mapa y a las opciones de Automatizaciones sin «Volver a ${hoja.titulo}» ni «Estás aquí»; y su marcador viejo (?desde=${hoja.lugar}) abre el mapa`, async ({ page }) => {
    await simular(page);
    await page.goto(`/estudio/${hoja.ruta}/`);
    await expect(migaDeHoja(page, AL_MAPA)).toHaveAttribute('href', URL_MAPA);
    await migaDeHoja(page, AL_MAPA).click();
    await esperarRuta(page, URL_MAPA);
    expect(direccionDe(page)).toBe(URL_MAPA);
    await expect(paso(page)).toHaveText('Elige un área');
    // antes: «Volver a Constructor», un enlace a /estudio/constructor/
    await expect(volverA(page, hoja.titulo)).toHaveCount(0);
    await expect(algunVolver(page)).toHaveCount(0);

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/estudio/${hoja.ruta}/`));
    const miga = migaDeHoja(page, /^Ir a las opciones de Automatizaciones \(ahora: Distrito\)/);
    await expect(miga).toHaveAttribute('href', URL_AUTOMATIZACIONES);
    await miga.click();
    await esperarRuta(page, URL_AUTOMATIZACIONES);
    expect(direccionDe(page)).toBe(URL_AUTOMATIZACIONES);
    await expect(paso(page)).toHaveText('Elige un grupo');
    // antes, «Estás aquí» en Distrito
    await expect(opcion(page, 'Automatizaciones', 'Distrito')).not.toContainText('Estás aquí');
    await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
    await expect(volverA(page, hoja.titulo)).toHaveCount(0);

    // el enlace que guardó quien usaba la miga de antes: con ver=mapa y con ver=grupos, el mapa (ver=grupos ya no abre las opciones)
    for (const ver of ['mapa', 'grupos']) {
      await abrirInicio(page, `${URL_VIEJA}?desde=${hoja.lugar}&ver=${ver}`);
      await expect(paso(page), `ver=${ver}`).toHaveText('Elige un área');
      await expect.poll(() => direccionDe(page), `ver=${ver}`).toBe(URL_MAPA);
      await expect(volverA(page, hoja.titulo), `ver=${ver}`).toHaveCount(0);
      await expect(algunVolver(page), `ver=${ver}`).toHaveCount(0);
      await expect(region(page).getByText('Estás aquí'), `ver=${ver}`).toHaveCount(0);
    }
  });
}

test('desde la agenda: en el mapa, Esc ya no regresa a la agenda (no hace nada) y no hay «Volver a Agenda…» antes de la primera ficha', async ({ page }) => {
  await simular(page);
  await vigilarNavegaciones(page);
  await page.goto('/estudio/agenda/');
  await migaDeHoja(page, AL_MAPA).click();
  await esperarRuta(page, URL_MAPA);
  await expect(paso(page)).toHaveText('Elige un área');
  await trasPintar(page);
  expect((await enfocado(page)).etiqueta).toBe('body');
  // antes, Esc sin tocar nada más navegaba de regreso a la agenda; ahora en el mapa no hace nada (D12), con el foco donde esté
  await sinNavegar(page, () => page.keyboard.press('Escape'), URL_MAPA, 'Esc recién llegado al mapa');
  await page.keyboard.press('Tab');
  expect((await enfocado(page)).texto).toMatch(/^Marketing/);
  await sinNavegar(page, () => page.keyboard.press('Escape'), URL_MAPA, 'Esc en la primera ficha');
  // antes de la primera ficha estaba «Volver a Agenda tus publicaciones»; ya no hay nada de la región
  await page.keyboard.press('Shift+Tab');
  expect(await region(page).evaluate(r => r.contains(document.activeElement))).toBe(false);
});

test('desde la agenda: Esc en las opciones sube al MAPA, ya no navega de regreso a la agenda', async ({ page }) => {
  await simular(page);
  await page.goto('/estudio/agenda/');
  await migaDeHoja(page, A_LAS_OPCIONES).click();
  await esperarRuta(page, URL_MARKETING);
  await expect(paso(page)).toHaveText('Elige un grupo');
  await trasPintar(page);
  expect((await enfocado(page)).etiqueta).toBe('body');
  await page.keyboard.press('Escape');
  await esperarRuta(page, URL_MAPA);
  await expect(paso(page)).toHaveText('Elige un área');
});

test('desde la agenda: elegir un grupo y volver al mapa no deja ningún «Volver a Agenda», y Esc en las opciones sube al mapa', async ({ page }) => {
  await simular(page);
  await page.goto('/estudio/agenda/');
  await migaDeHoja(page, AL_MAPA).click();
  await esperarRuta(page, URL_MAPA);
  await elegir(page, 'Marketing', 'Blotato');
  expect(rutaDe(page)).toBe(URL_BLOTATO);
  await irAlMapa(page);
  await expect(algunVolver(page)).toHaveCount(0);
  await ficha(page, 'Marketing').click();
  await esperarRuta(page, URL_MARKETING);
  await page.keyboard.press('Escape');
  await esperarRuta(page, URL_MAPA);
  await expect(paso(page)).toHaveText('Elige un área');
});

test('desde la agenda: «atrás» del navegador regresa a la agenda, también tras un marcador viejo (los 302 y la dirección limpia no suman entradas)', async ({ page }) => {
  await simular(page);
  await page.goto('/estudio/agenda/');
  await migaDeHoja(page, AL_MAPA).click();
  await esperarRuta(page, URL_MAPA);
  expect(direccionDe(page)).toBe(URL_MAPA);
  await page.goBack();
  await expect(page).toHaveURL(/\/estudio\/agenda\//);
  // el marcador de la miga de antes: /estudio/inicio/ → 302 a /estudio/ con su query, y la página la limpia con replaceState. Una sola entrada
  await abrirInicio(page, `${URL_VIEJA}?desde=mkt.blotato.agenda&ver=mapa`);
  await expect.poll(() => direccionDe(page)).toBe(URL_MAPA);
  await page.goBack();
  await expect(page).toHaveURL(/\/estudio\/agenda\//);
});

test('desde la agenda: recargar las opciones las vuelve a abrir (la dirección ES el nivel), sin «Volver a Agenda» ni «Estás aquí»', async ({ page }) => {
  await simular(page);
  await page.goto('/estudio/agenda/');
  await migaDeHoja(page, A_LAS_OPCIONES).click();
  await esperarRuta(page, URL_MARKETING);
  await page.reload();
  // antes, recargar caía en el mapa: el inicio era una sola dirección y el paso vivía en la página
  expect(rutaDe(page)).toBe(URL_MARKETING);
  await expect(paso(page)).toHaveText('Elige un grupo');
  await expect(algunVolver(page)).toHaveCount(0);
  await expect(region(page).getByText('Estás aquí')).toHaveCount(0);
});

// Los marcadores de antes (/estudio/inicio/?desde=&ver=, las migas de las pantallas hoja): el servidor manda /estudio/inicio/ a /estudio/ con su
// query, y la página del mapa le quita lo del recorrido (recargar o compartir no repite nada). Antes cada entrada válida abría un paso, con «Estás
// aquí» y su «Volver a …», y una inventada o a medias se ignoraba; ahora todas, válidas o no, aterrizan igual.
test('los marcadores de antes (/estudio/inicio/?desde=&ver=), válidos o no, aterrizan en el mapa con la dirección limpia, sin «Volver a …» ni «Estás aquí»', async ({ page }) => {
  await simular(page);
  for (const consulta of [
    '?desde=mkt.blotato.agenda&ver=mapa',
    '?desde=mkt.blotato.agenda&ver=grupos',
    '?desde=automatizaciones.distrito.actualizar&ver=grupos', // una pantalla apagada (antes, las opciones con «Estás aquí» en Distrito)
    '?desde=automatizaciones.tus.algo&ver=grupos', // un grupo vacío
    '?desde=mkt.blotato.nada&ver=mapa', // el lugar no existe
    '?desde=mkt.blotato&ver=mapa', // le falta una clave
    '?desde=mkt.blotato.agenda&ver=otra', // qué abrir no es mapa ni grupos
    '?desde=mkt.blotato.agenda', // sin «ver»
    '?ver=mapa', // sin «desde»
  ]) {
    await abrirInicio(page, URL_VIEJA + consulta);
    await expect(paso(page), consulta).toHaveText('Elige un área');
    await expect.poll(() => direccionDe(page), consulta).toBe(URL_MAPA);
    await expect(algunVolver(page), consulta).toHaveCount(0);
    await expect(region(page).getByText('Estás aquí'), consulta).toHaveCount(0);
  }
});

test('una pantalla de la caja como origen (?desde=mkt.distrito.video): abre el mapa, sin «Volver a Video»; Marketing › Distrito es la lista, y Video, la caja', async ({ page }) => {
  await simular(page);
  await abrirInicio(page, `${URL_VIEJA}?desde=mkt.distrito.video&ver=mapa`);
  await expect(paso(page)).toHaveText('Elige un área');
  await expect.poll(() => direccionDe(page)).toBe(URL_MAPA);
  await expect(algunVolver(page)).toHaveCount(0);
  await expect(volverA(page, 'Video')).toHaveCount(0);
  await elegir(page, 'Marketing', 'Distrito');
  expect(rutaDe(page)).toBe(URL_DISTRITO);
  await expect(paso(page)).toHaveText('Distrito');
  await elegirHerramienta(page, 'Video');
  expect(rutaDe(page)).toBe(URL_CAJA.video);
});

// La dirección final conserva desde y ver (solo el mapa los limpia; en el grupo no estorban): no se afirma nada de ellos.
test('?blotato=conectar sigue abriendo el diálogo aunque llegue por /estudio/inicio/ con ?desde=…&ver=…: el servidor lo manda al grupo Blotato, y cerrarlo no navega', async ({ page }) => {
  await simular(page, { blotato: 'sin-conectar' });
  await vigilarNavegaciones(page);
  await page.goto(`${URL_VIEJA}?desde=mkt.blotato.agenda&ver=grupos&blotato=conectar`);
  await esperarRuta(page, URL_BLOTATO);
  const dialogo = page.getByRole('dialog', { name: 'Conecta tu Blotato' });
  await expect(dialogo).toBeVisible();
  expect(new URL(page.url()).searchParams.get('blotato')).toBe('conectar');
  // el diálogo es modal: tiene el foco
  await expect(dialogo.getByLabel('Tu clave de API de Blotato')).toBeFocused();
  await sinNavegar(page, () => page.keyboard.press('Escape'), URL_BLOTATO, 'Esc en el diálogo');
  await expect(dialogo).toBeHidden();
  // antes se quedaba en las opciones de Marketing; ahora en el grupo Blotato, que es donde se conecta
  await expect(paso(page)).toHaveText('Blotato');
});

// `volverA` solo existe para afirmar que no hay un enlace a otra página: «Volver a Video» (dueño, 15-oct-2026: «no podemos poner el botón de
// "Volver a video"») no aparece en ninguna página del recorrido, tampoco en la caja, a la que se llega por sus tres pestañas
test('«Volver a Video» no existe en ninguna página de un recorrido normal (mapa, opciones, listas y la caja en sus tres pestañas)', async ({ page }) => {
  await simular(page);
  const sinVolver = async (donde: string) => {
    await expect(algunVolver(page), donde).toHaveCount(0);
    for (const rol of ['button', 'link'] as const) {
      await expect(page.getByRole(rol, { name: /^Volver a (Imagen|Video|Edición)$/ }), donde).toHaveCount(0);
    }
  };
  await abrirInicio(page);
  await sinVolver('el mapa');
  await ficha(page, 'Marketing').click();
  await esperarRuta(page, URL_MARKETING);
  await sinVolver('las opciones');
  await opcion(page, 'Marketing', 'Blotato').click();
  await esperarRuta(page, URL_BLOTATO);
  await sinVolver('la lista de Blotato');
  await irA(page, 'Marketing', 'Distrito');
  await sinVolver('la lista de Distrito');
  for (const [, nombre] of PESTANAS) {
    await elegirHerramienta(page, nombre);
    await sinVolver(`la caja en ${nombre}`);
    await expect(volverA(page, nombre)).toHaveCount(0);
    await page.goBack();
    await esperarRuta(page, URL_DISTRITO);
  }
  await irAlMapa(page);
  await sinVolver('el mapa, de vuelta');
});
