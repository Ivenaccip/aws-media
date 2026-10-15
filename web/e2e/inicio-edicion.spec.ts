// La caja de «Edición» del inicio (E1) en un navegador de verdad, con el static/trabajos.js real:
//  · el botón «Iniciar» (antes «Editar») es dorado en todos los estados y, aun sin poder, SIGUE enfocable (Tab) y, sin texto,
//    el clic lleva el foco al campo sin avisar;
//  · el campo está en un cuadro bien definido con UN solo aro de foco, y «Editar ▾» va junto al «+» (14-oct-2026);
//  · los avisos caen en el cuadro de abajo a la derecha y no junto a la caja;
//  · en un teléfono (390 px) nada se sale de la pantalla y todo lo tocable mide al menos 44 × 44 px
//    (jsdom no tiene diseño: eso solo se ve aquí);
//  · la subida de verdad (XHR) muestra su progreso y el precio sale del servidor;
//  · «Cancelar la subida» corta el PUT real (nada se confirma) y un texto enorme pegado se queda en 2000;
//  · revisión visual y de accesibilidad (lo que jsdom no ve): el aro de foco del campo, el contraste de su pista, que la
//    pista no se corte en un teléfono, «Subiendo…» en ámbar, el «Recargar» de 44 px y que con «reducir movimiento» nada
//    se quede moviéndose;
//  · las ideas ya no son botones sino una pista que rota sola dentro del campo (14-oct-2026, «Rotan solas como pista»): el
//    fundido ocurre DE VERDAD en el `::placeholder` nativo, se congela con el foco, desaparece al escribir, no mueve el alto
//    del cuadro (320, 390 y 1100 px) y no tapa clics (no hay capa encima). El reloj de la pantalla es el falso de Playwright
//    (`page.clock`), pero los fundidos de CSS corren en tiempo real: por eso se miden con muestras;
//  · la caja entera se recorre SOLO con teclado (Tab, Shift+Tab, Enter, Espacio) y el apagado enfocable se puede activar.
// No gasta nada: el servidor y «S3» son rutas de mentira.
import { expect, test, type Page } from '@playwright/test';

import { contraste } from '../src/nucleo/contraste';
import { animacionesVivas, pistaSePinta } from './pantallas';

const RESPUESTAS_VACIAS: Record<string, unknown> = {
  '**/api/proyectos': [],
  '**/api/slots': { slots: null, activos: 0 },
  '**/api/imagenes': { total: 0, imagenes: [] },
  '**/api/edicion/proyectos': [],
  '**/api/clip': { clips: [] },
  '**/api/trabajos': { trabajos: [], sondeo_s: 15 },
  '**/api/moderar': { permitido: true },
};

const COSTO = { fuente: 'videos/entrevista/subidas/entrevista.mp4', duracion_s: 724, con_transcript: false, creditos: 8, backend_listo: true, aviso: null };

async function edicion(
  page: Page,
  costo: unknown = COSTO,
  { saldo, subidaMs = 600, reloj = false }: { saldo?: number; subidaMs?: number; reloj?: boolean } = {},
) {
  // `reloj`: el de la pantalla (setTimeout, Date…) pasa a ser el falso de Playwright, quieto hasta que la prueba lo mueva
  if (reloj) await page.clock.install({ time: 0 });
  for (const [ruta, json] of Object.entries(RESPUESTAS_VACIAS)) await page.route(ruta, r => r.fulfill({ json }));
  if (saldo !== undefined) await page.route('**/api/creditos', r => r.fulfill({ json: { activo: true, saldo, tarifas: {}, packs: [] } }));
  await page.route('**/api/blotato', r => r.fulfill({ status: 404, json: { detail: 'no' } }));
  await page.route('**/api/media/config', r => r.fulfill({ json: { activo: true, cdn: '' } }));
  // lo ya subido con ese nombre: nada (si lo hubiera, la caja estrenaría un nombre nuevo para no mezclar proyectos)
  await page.route('**/api/media/entrevista', r => r.fulfill({ json: { subidas: [] } }));
  // el PUT a «S3» es del mismo origen para no depender de CORS; tarda un poco para poder ver la barra
  await page.route('**/api/media/presign', r =>
    r.fulfill({ json: { url: '/s3-falso/subida', key: 'videos/entrevista/subidas/entrevista.mp4', content_type: 'video/mp4' } }),
  );
  await page.route('**/s3-falso/subida', async r => {
    await new Promise(f => setTimeout(f, subidaMs));
    await r.fulfill({ status: 200, body: '' });
  });
  await page.route('**/api/media/confirmar', r => r.fulfill({ json: { archivo: 'entrevista.mp4', cdn: '' } }));
  await page.route('**/api/editar/entrevista/costo', r => r.fulfill({ json: costo }));
  await page.route('**/api/editar/entrevista/sugerir', r => r.fulfill({ json: { lanzado: true, creditos: 8 } }));
  await page.goto('/estudio/inicio/');
  if (reloj) await page.clock.pauseAt(1000);
  await page.getByRole('group', { name: 'Qué quieres crear' }).getByRole('button', { name: 'Edición' }).click();
  await expect(campo(page)).toBeVisible();
}

// las ideas de la pista, tal como las lee el dueño (a propósito NO se importan de edicion.ts: si alguien cambia el texto, esta
// prueba lo nota) y los números del reloj
const IDEAS = ['Quita muletillas y silencios', 'Un short vertical para Reels', 'Resumen de 60 segundos', 'Subtítulos grandes y un título'];
const hueco = (i: number) => `Cuéntale a la IA qué quieres. Ejemplo: «${IDEAS[i % IDEAS.length]}»`;
const CADA_MS = 4000;
const FUNDIDO_MS = 250;

/**
 * Pasa a la idea siguiente con el reloj falso: 3.75 s hasta que la actual empieza a salir y 0.25 s hasta que entra la otra.
 * Entre un paso y otro hay una espera real corta: el temporizador del paso siguiente lo arma un efecto de React, y el
 * planificador de React no es el reloj falso.
 */
async function siguienteIdea(page: Page) {
  await page.clock.runFor(CADA_MS - FUNDIDO_MS);
  await page.waitForTimeout(40);
  await page.clock.runFor(FUNDIDO_MS);
  await page.waitForTimeout(40);
}

/** Lo que la pista es ahora: su texto y la opacidad (calculada) de su `::placeholder`. */
const pistaAhora = (page: Page) =>
  campo(page).evaluate(e => ({ texto: e.getAttribute('placeholder'), opacidad: Number(getComputedStyle(e, '::placeholder').opacity) }));

/** Muestrea la opacidad de la pista cada 20 ms durante `ms` (tiempo real: los fundidos de CSS no los mueve el reloj falso). */
async function opacidades(page: Page, ms: number) {
  const muestras: number[] = [];
  for (let t = 0; t < ms; t += 20) {
    muestras.push((await pistaAhora(page)).opacidad);
    await page.waitForTimeout(20);
  }
  return muestras;
}

const campo = (page: Page) => page.getByRole('textbox', { name: 'Cuéntale a la IA qué quieres' });
const iniciar = (page: Page) => page.getByRole('button', { name: /^(Iniciar|Subiendo)/ });
// por su `aria-haspopup`, no por su nombre: al pasar el ratón o enfocarlo, la pista (::after) se vuelve visible y Chrome la suma a su nombre
const chip = (page: Page) => page.locator('button[aria-haspopup="listbox"]');

/** El mp4 mínimo que acepta el selector: el servidor de mentira no lo mira. */
const VIDEO = { name: 'entrevista.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2048, 1) };

async function conVideo(page: Page) {
  await page.locator('input[type="file"]').setInputFiles(VIDEO);
  await expect(page.getByRole('button', { name: 'Iniciar ✦ 8' })).toBeVisible();
}

test('«Iniciar» sin poder sigue enfocable con Tab y, sin texto, el clic lleva el foco al campo sin avisar', async ({ page }) => {
  await edicion(page);
  await conVideo(page);
  const boton = page.getByRole('button', { name: 'Iniciar ✦ 8' });
  await expect(boton).toHaveAttribute('aria-disabled', 'true');
  await boton.focus();
  await expect(boton).toBeFocused();
  // con Tab se llega a él desde el chip «Editar ▾», que va después del «+» (un botón `disabled` se saltaría)
  await chip(page).focus();
  await page.keyboard.press('Tab');
  await expect(boton).toBeFocused();
  // Playwright trata `aria-disabled` como «no habilitado» y se negaría a hacer clic: `force` es el clic de una persona
  await boton.click({ force: true });
  await expect(campo(page)).toBeFocused();
  await expect(page.locator('#bandeja [role="alert"]')).toHaveCount(0);
  await expect(page.getByText('Escribe qué quieres hacer con tu video.')).toBeVisible();
  // escribir lo enciende
  await campo(page).fill('Quítale las muletillas');
  await expect(page.getByRole('button', { name: 'Iniciar ✦ 8' })).not.toHaveAttribute('aria-disabled', 'true');
});

test('sin video, «Iniciar» avisa en el cuadro de abajo a la derecha y no junto a la caja', async ({ page }) => {
  await edicion(page);
  await iniciar(page).click({ force: true });
  const cuadro = page.locator('#bandeja');
  await expect(cuadro.getByRole('alert')).toContainText('Primero agrega el video: pulsa el «+» o arrástralo a la caja.');
  const caja = await cuadro.boundingBox();
  const ventana = page.viewportSize()!;
  expect(Math.abs(ventana.width - (caja!.x + caja!.width))).toBeLessThanOrEqual(20);
  expect(Math.abs(ventana.height - (caja!.y + caja!.height))).toBeLessThanOrEqual(20);
  await expect(page.locator('section [role="alert"]')).toHaveCount(0);
});

test('la subida muestra su barra de verdad y el precio llega del servidor', async ({ page }) => {
  await edicion(page);
  await page.locator('input[type="file"]').setInputFiles(VIDEO);
  await expect(page.getByRole('progressbar', { name: 'Subiendo el video' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Subiendo…' })).toBeVisible();
  await expect(page.getByText('Cuando termine de subir calculamos el precio. Hasta entonces no se cobra nada.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iniciar ✦ 8' })).toBeVisible();
  await expect(page.getByText('12:04 · MP4 · 1 MB')).toBeVisible();
});

test('lanzar vacía la caja y no se puede empezar otra con la corrida en curso', async ({ page }) => {
  await edicion(page);
  await conVideo(page);
  await campo(page).fill('Quítale las muletillas');
  await page.getByRole('button', { name: 'Iniciar ✦ 8' }).click();
  await expect(campo(page)).toHaveValue('');
  await expect(page.getByText('entrevista.mp4')).toHaveCount(0);
  await page.getByRole('button', { name: 'Agregar el video que quieres editar' }).click({ force: true });
  await expect(page.locator('#bandeja')).toContainText('Ya hay un trabajo en curso. Cuando termine puedes empezar otro.');
});

test('cancelar la subida de verdad corta el PUT: no se confirma nada y la caja queda para otro video', async ({ page }) => {
  const confirmaciones: string[] = [];
  await edicion(page);
  page.on('request', r => {
    if (r.url().includes('/api/media/confirmar')) confirmaciones.push(r.url());
  });
  await page.locator('input[type="file"]').setInputFiles(VIDEO);
  await expect(page.getByRole('progressbar', { name: 'Subiendo el video' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar la subida' }).click();
  await expect(page.getByText('entrevista.mp4')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Iniciar', exact: true })).toBeVisible();
  // el «S3» de mentira tarda 600 ms: si el PUT siguiera vivo ya habría confirmado
  await page.waitForTimeout(1000);
  expect(confirmaciones).toEqual([]);
  await expect(page.locator('#bandeja [role="alert"]')).toHaveCount(0);
});

test('un texto enorme pegado se queda en 2000 caracteres (el límite lo pone el navegador)', async ({ page }) => {
  await edicion(page);
  await campo(page).click();
  await page.keyboard.insertText('x'.repeat(2500));
  expect((await campo(page).inputValue()).length).toBe(2000);
});

test.describe('en el teléfono', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('nada se sale de la pantalla y todo lo tocable mide al menos 44 × 44 px', async ({ page }) => {
    await edicion(page);
    await conVideo(page);
    await campo(page).fill('Quítale las muletillas');
    // sin desplazamiento de lado
    const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sobra).toBeLessThanOrEqual(0);
    const tocables = [
      ...(await page.getByRole('group', { name: 'Qué quieres crear' }).getByRole('button').all()),
      page.getByRole('button', { name: 'Cambiar el video' }),
      chip(page),
      page.getByRole('button', { name: 'Quitar este video' }),
      page.getByRole('button', { name: 'Iniciar ✦ 8' }),
    ];
    for (const t of tocables) {
      const caja = (await t.boundingBox())!;
      const nombre = (await t.textContent()) || (await t.getAttribute('aria-label')) || '?';
      expect(caja.width, nombre).toBeGreaterThanOrEqual(44);
      expect(caja.height, nombre).toBeGreaterThanOrEqual(44);
      expect(caja.x + caja.width, nombre).toBeLessThanOrEqual(390);
    }
    await page.screenshot({ path: process.env.PW_CAPTURA_EDICION ?? 'test-results/edicion-telefono.png' });
  });
});

test('en el escritorio la caja de Edición se ve completa', async ({ page }) => {
  await edicion(page);
  await conVideo(page);
  await campo(page).fill('Quítale las muletillas');
  await page.screenshot({ path: process.env.PW_CAPTURA_EDICION_ESCRITORIO ?? 'test-results/edicion-escritorio.png' });
});

// ---- revisión visual y de accesibilidad: lo que el lienzo (Recorrido-2) y docs/DISENO.md §4 y §5 piden y jsdom no ve ----

const riel = (page: Page) => page.getByRole('group', { name: 'Qué quieres crear' });

/** «rgb(r, g, b)» → «#rrggbb» (lo que lee `contraste`). */
const aHex = (rgb: string) => {
  const m = /rgba?\((\d+), (\d+), (\d+)/.exec(rgb);
  if (!m) throw new Error('color que no es rgb: ' + rgb);
  return '#' + [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('');
};

test('el cuadro se ve enfocado con UN solo aro, su pista se lee con 4.5:1 y «Subiendo…» sigue en ámbar con cursor de espera', async ({ page }) => {
  await edicion(page, COSTO, { subidaMs: 4000 });
  // el aro de foco de la carta (§4) lo dibuja el cuadro que envuelve al campo: se llega con Tab y se ve. El campo no dibuja el
  // suyo (dos aros, uno dentro del otro, se verían como un error)
  await riel(page).getByRole('button', { name: 'Edición' }).focus();
  await page.keyboard.press('Tab');
  await expect(campo(page)).toBeFocused();
  const aros = await campo(page).evaluate(e => {
    const aro = (el: Element) => {
      const c = getComputedStyle(el);
      return { estilo: c.outlineStyle, ancho: c.outlineWidth, color: c.outlineColor, separacion: c.outlineOffset };
    };
    return { cuadro: aro(e.parentElement!), campo: aro(e) };
  });
  expect(aros.cuadro).toEqual({ estilo: 'solid', ancho: '2px', color: 'rgb(240, 169, 74)', separacion: '3px' });
  expect(aros.campo.estilo).toBe('none');
  // la pista: el gris secundario sobre el fondo del cuadro (elevada; con el 50 % del texto daba 4.39:1 ya sobre la superficie)
  const ejemplo = await campo(page).evaluate(e => ({ color: getComputedStyle(e, '::placeholder').color, fondo: getComputedStyle(e.parentElement!).backgroundColor }));
  expect(contraste(aHex(ejemplo.color), aHex(ejemplo.fondo))).toBeGreaterThanOrEqual(4.5);
  // «Subiendo…»: «Trabajando» de la carta (ámbar, cursor de espera, ocupado), no el gris discontinuo del apagado
  await page.locator('input[type="file"]').setInputFiles(VIDEO);
  const subiendo = page.getByRole('button', { name: 'Subiendo…' });
  await expect(subiendo).toHaveAttribute('aria-busy', 'true');
  await expect(subiendo).toHaveCSS('background-color', 'rgb(218, 140, 40)'); // espera a que termine la transición de color
  await expect(subiendo).toHaveCSS('cursor', 'progress');
  await expect(subiendo).toHaveCSS('border-top-width', '0px'); // el apagado de la carta lleva borde discontinuo
});

test.describe('en el teléfono, revisión visual', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('las cuatro ideas de la pista se leen enteras (no se cortan), a 320 px también y donde el navegador no mide el contenido', async ({ page }) => {
    await edicion(page, COSTO, { reloj: true });
    const corte = () => campo(page).evaluate(e => ({ alto: e.getBoundingClientRect().height, sobra: e.scrollHeight - e.clientHeight }));
    /** Las cuatro ideas, una tras otra, al ancho de ahora (al terminar vuelve a la primera). */
    async function lasCuatro(ancho: number, aviso: string) {
      for (let i = 0; i < IDEAS.length; i++) {
        expect((await pistaAhora(page)).texto).toBe(hueco(i));
        const c = await corte();
        expect(c.sobra, `a ${ancho} px ${aviso}la idea ${i + 1} se corta (el campo mide ${c.alto})`).toBeLessThanOrEqual(1);
        await siguienteIdea(page);
      }
    }
    // con field-sizing (Chrome): crece hasta lo que haga falta, también en 320 px
    for (const ancho of [390, 360, 320, 640, 861]) {
      await page.setViewportSize({ width: ancho, height: 844 });
      await lasCuatro(ancho, '');
    }
    // sin él (Safari y Firefox, que aún no lo saben): el piso de la clase basta de 375 px para arriba
    await campo(page).evaluate(e => e.style.setProperty('field-sizing', 'fixed'));
    for (const ancho of [375, 390, 430, 639, 640, 861, 1440]) {
      await page.setViewportSize({ width: ancho, height: 844 });
      await lasCuatro(ancho, 'sin field-sizing, ');
    }
  });

  test('«Recargar» (con la recarga abierta) mide al menos 44 × 44 px y no hace crecer la nota', async ({ page }) => {
    await edicion(page, COSTO, { saldo: 5 });
    await conVideo(page);
    // monedero.js trae la recarga cerrada: se abre para ver el botón de verdad
    await page.evaluate(() => {
      (window as unknown as { monedero: { recarga: boolean } }).monedero.recarga = true;
    });
    await campo(page).fill('Quítale las muletillas');
    const nota = page.getByText(/^Te faltan/);
    await expect(nota).toBeVisible();
    const recargar = page.getByRole('button', { name: 'Recargar' });
    const caja = (await recargar.boundingBox())!;
    expect(caja.width).toBeGreaterThanOrEqual(44);
    expect(caja.height).toBeGreaterThanOrEqual(44);
    expect(caja.x).toBeGreaterThanOrEqual(0);
    expect(caja.x + caja.width).toBeLessThanOrEqual(390);
    // los márgenes negativos la devuelven al renglón: la nota mide lo de una línea de letra chica (13 px × 1.45)
    const alto = (await nota.boundingBox())!.height;
    expect(alto).toBeLessThanOrEqual(30);
  });
});

// ---- las ideas rotan solas como pista dentro del campo (dueño, 14-oct-2026) ----

test('la pista rota sola con un fundido DE VERDAD en el ::placeholder, da la vuelta y al abrir no anima nada', async ({ page }) => {
  await edicion(page, COSTO, { reloj: true });
  // al abrir: la primera idea, entera, y sin ninguna transición en marcha (docs/DISENO.md §4: lo que ya estaba no anima)
  expect(await pistaAhora(page)).toEqual({ texto: hueco(0), opacidad: 1 });
  expect(await opacidades(page, 300)).toEqual(new Array(15).fill(1));
  // el `::placeholder` del propio campo, con el token de duración de la carta (--dur-media) y sin capa encima
  const estilo = await campo(page).evaluate(e => {
    const c = getComputedStyle(e, '::placeholder');
    return { propiedad: c.transitionProperty, duracion: c.transitionDuration, color: c.color };
  });
  expect(estilo).toMatchObject({ propiedad: 'opacity', duracion: '0.25s', color: 'rgb(147, 163, 184)' });
  await expect(campo(page).locator('xpath=..').locator('> *')).toHaveCount(1);
  // da dos vueltas completas; en cada salida y en cada entrada la opacidad pasa por valores de en medio (un fundido, no un salto)
  for (let i = 0; i < IDEAS.length * 2; i++) {
    expect((await pistaAhora(page)).texto, `idea ${i + 1}`).toBe(hueco(i));
    await page.clock.runFor(CADA_MS - FUNDIDO_MS);
    const sale = await opacidades(page, 320);
    expect(sale.at(-1), `la idea ${i + 1} termina de salir`).toBe(0);
    expect(sale.some(o => o > 0.05 && o < 0.95), `la idea ${i + 1} sale con un fundido (${sale.join(' ')})`).toBe(true);
    // sigue siendo el mismo texto: se cambia cuando ya no se ve
    expect((await pistaAhora(page)).texto).toBe(hueco(i));
    await page.clock.runFor(FUNDIDO_MS);
    const entra = await opacidades(page, 320);
    expect(entra.at(-1), `la idea ${i + 2} termina de entrar`).toBe(1);
    expect(entra.some(o => o > 0.05 && o < 0.95), `la idea ${i + 2} entra con un fundido (${entra.join(' ')})`).toBe(true);
    expect((await pistaAhora(page)).texto).toBe(hueco(i + 1));
  }
  expect((await pistaAhora(page)).texto).toBe(hueco(0)); // dio la vuelta
});

test('con el foco la pista se congela entera, al escribir desaparece y al soltar el foco con el campo vacío retoma', async ({ page }) => {
  await edicion(page, COSTO, { reloj: true });
  await siguienteIdea(page);
  expect((await pistaAhora(page)).texto).toBe(hueco(1));
  // a mitad del fundido de salida se enfoca: no queda a media luz, queda entera
  await page.clock.runFor(CADA_MS - FUNDIDO_MS);
  await page.waitForTimeout(60);
  await campo(page).focus();
  await page.waitForTimeout(FUNDIDO_MS + 100);
  expect(await pistaAhora(page)).toEqual({ texto: hueco(1), opacidad: 1 });
  for (let i = 0; i < 4; i++) {
    await page.clock.runFor(CADA_MS);
    await page.waitForTimeout(40);
  }
  expect(await pistaAhora(page)).toEqual({ texto: hueco(1), opacidad: 1 });
  // al escribir desaparece como cualquier pista (y no corre nada)
  expect(await campo(page).evaluate(e => e.matches(':placeholder-shown'))).toBe(true);
  await page.keyboard.type('Quítale las muletillas');
  expect(await campo(page).evaluate(e => e.matches(':placeholder-shown'))).toBe(false);
  await campo(page).fill('');
  expect(await campo(page).evaluate(e => e.matches(':placeholder-shown'))).toBe(true);
  // soltar el foco con el campo vacío: retoma desde la que estaba
  await campo(page).evaluate(e => e.blur());
  await page.clock.runFor(CADA_MS - FUNDIDO_MS);
  await page.waitForTimeout(40);
  await page.clock.runFor(FUNDIDO_MS);
  await page.waitForTimeout(40);
  expect((await pistaAhora(page)).texto).toBe(hueco(2));
});

test('al rotar el cuadro no cambia de alto ni mueve lo de abajo, a 320, 390 y 1100 px', async ({ page }) => {
  await edicion(page, COSTO, { reloj: true });
  const mas = page.getByRole('button', { name: 'Agregar el video que quieres editar' });
  for (const ancho of [320, 390, 1100]) {
    await page.setViewportSize({ width: ancho, height: 844 });
    const medidas: Array<{ campo: number; cuadro: number; mas: number; sobra: number }> = [];
    for (let i = 0; i < IDEAS.length; i++) {
      const m = await campo(page).evaluate(e => ({
        campo: e.getBoundingClientRect().height,
        cuadro: e.parentElement!.getBoundingClientRect().height,
        sobra: e.scrollHeight - e.clientHeight,
      }));
      medidas.push({ ...m, mas: (await mas.boundingBox())!.y });
      await siguienteIdea(page);
    }
    // incluso a media salida y a media entrada (la pista a media luz sigue ocupando lo mismo)
    await page.clock.runFor(CADA_MS - FUNDIDO_MS);
    await page.waitForTimeout(100);
    medidas.push({ campo: (await campo(page).boundingBox())!.height, cuadro: (await campo(page).locator('xpath=..').boundingBox())!.height, mas: (await mas.boundingBox())!.y, sobra: 0 });
    expect(new Set(medidas.map(m => m.campo)).size, `a ${ancho} px cambia el alto del campo: ${JSON.stringify(medidas)}`).toBe(1);
    expect(new Set(medidas.map(m => m.cuadro)).size, `a ${ancho} px cambia el alto del cuadro`).toBe(1);
    expect(new Set(medidas.map(m => m.mas)).size, `a ${ancho} px se mueve lo de abajo`).toBe(1);
    for (const m of medidas) expect(m.sobra).toBeLessThanOrEqual(1);
    await page.clock.runFor(FUNDIDO_MS);
    await page.waitForTimeout(40);
    // la pista que más ocupa cabe dentro del piso del campo (96 px en teléfono, 68 desde 640 px): sin él, ni crece ni empuja
    expect(medidas[0]!.campo).toBe(ancho < 640 ? 96 : 68);
  }
});

test('la pista es el placeholder nativo: un clic donde se lee cae en el campo y no hay nada encima', async ({ page }) => {
  await edicion(page, COSTO, { reloj: true });
  const caja = (await campo(page).boundingBox())!;
  // el centro de la primera línea, donde está el texto de la pista
  const x = caja.x + 24;
  const y = caja.y + 8;
  const encima = await page.evaluate(([a, b]) => {
    const el = document.elementFromPoint(a!, b!);
    return el ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') : null;
  }, [x, y]);
  expect(encima).toBe('textarea#texto-edicion');
  await page.mouse.click(x, y);
  await expect(campo(page)).toBeFocused();
});

// El ejemplo fijo es solo la DESCRIPCIÓN del campo (`aria-describedby`). Con `sr-only` el párrafo quedaba además en el árbol de
// accesibilidad, y quien navega en modo lectura lo oía como párrafo entre el campo y el «+» y otra vez al enfocar el campo.
// Se mira el árbol del navegador de verdad: ningún párrafo suelto con el ejemplo, y la descripción del campo intacta.
test('el ejemplo fijo describe al campo y no queda como párrafo suelto en el árbol de accesibilidad', async ({ page }) => {
  await edicion(page);
  const ejemplo = 'Por ejemplo: quítale las muletillas, ponle subtítulos y hazlo vertical para Reels.';
  await expect(campo(page)).toHaveAccessibleDescription(ejemplo);
  await expect(page.getByRole('paragraph').filter({ hasText: 'Por ejemplo' })).toHaveCount(0);
  await expect(page.getByText(ejemplo)).toBeHidden();
  // sigue siendo la descripción con el foco, con texto escrito y con la rotación de la pista andando
  await campo(page).fill('Quítale las muletillas');
  await expect(campo(page)).toHaveAccessibleDescription(ejemplo);
});

test('toda la caja se recorre solo con el teclado: Tab, Shift+Tab, Enter y Espacio', async ({ page }) => {
  const sugerir: string[] = [];
  await edicion(page);
  await page.route('**/api/editar/entrevista/sugerir', r => {
    sugerir.push(r.request().postData() ?? '');
    return r.fulfill({ json: { lanzado: true, creditos: 8 } });
  });
  const enfocado = () => page.evaluate(() => (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '').trim());
  // el recorrido empieza en el riel: Tab desde «Video» llega a «Edición»
  await riel(page).getByRole('button', { name: 'Video', exact: true }).focus();
  await page.keyboard.press('Tab');
  expect(await enfocado()).toBe('Edición');
  // sin video: Tab lleva al campo y se escribe sin tocar el ratón
  await page.keyboard.press('Tab');
  await expect(campo(page)).toBeFocused();
  await page.keyboard.type('Quítale las muletillas');
  // el «+», el chip «Editar ▾» e «Iniciar» están en ese orden (y Shift+Tab los recorre al revés); las ideas ya no son botones
  const orden: string[] = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab');
    orden.push(await enfocado());
  }
  expect(orden).toEqual(['Agregar el video que quieres editar', 'Editar ▾', 'Iniciar']);
  await page.keyboard.press('Shift+Tab');
  expect(await enfocado()).toBe('Editar ▾');
  await page.keyboard.press('Shift+Tab');
  expect(await enfocado()).toBe('Agregar el video que quieres editar');
  // Espacio en el «+» abre el selector de archivos
  const [selector] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Space')]);
  await selector.setFiles(VIDEO);
  await expect(page.getByRole('button', { name: 'Iniciar ✦ 8' })).toBeVisible();
  // «Iniciar ✦ 8» ya está encendido: Tab hasta él (pasando por el chip) y Enter lanza UNA vez, con la instrucción y nada más
  await page.getByRole('button', { name: 'Cambiar el video' }).focus();
  await page.keyboard.press('Tab');
  expect(await enfocado()).toBe('Editar ▾');
  await page.keyboard.press('Tab');
  expect(await enfocado()).toBe('Iniciar ✦ 8');
  await page.keyboard.press('Enter');
  await expect(campo(page)).toHaveValue('');
  expect(sugerir).toEqual(['{"instruccion":"Quítale las muletillas"}']);
});

test('«Iniciar» con aria-disabled se activa con Enter y con Espacio: lleva el foco al campo', async ({ page }) => {
  await edicion(page);
  await conVideo(page);
  const boton = page.getByRole('button', { name: 'Iniciar ✦ 8' });
  for (const tecla of ['Enter', 'Space']) {
    await boton.focus();
    await page.keyboard.press(tecla);
    await expect(campo(page), `con ${tecla}`).toBeFocused();
  }
  await expect(page.locator('#bandeja [role="alert"]')).toHaveCount(0);
});

// ---- los ajustes del dueño del 14-oct-2026: «Iniciar» dorado en todos los estados y «Editar ▾» junto al «+» ----

test('«Iniciar» es dorado en TODOS los estados (sin video, sin texto, con todo, subiendo): ni gris ni borde discontinuo', async ({ page }) => {
  await edicion(page, COSTO, { subidaMs: 1500 });
  const boton = iniciar(page);
  // el ámbar de la carta con su tinta; sin el gris discontinuo del apagado (esperando a que acabe la transición de color)
  const dorado = async (nombre: string) => {
    await expect(boton, nombre).toHaveCSS('background-color', 'rgb(218, 140, 40)');
    await expect(boton, nombre).toHaveCSS('color', 'rgb(20, 16, 10)');
    await expect(boton, nombre).toHaveCSS('border-top-width', '0px');
    await expect(boton, nombre).not.toHaveCSS('border-top-style', 'dashed');
  };
  await expect(boton).toHaveText('Iniciar');
  await dorado('sin video');
  await expect(boton).toHaveAttribute('aria-disabled', 'true');
  await campo(page).fill('Quítale las muletillas');
  await dorado('sin video, con texto');
  await page.locator('input[type="file"]').setInputFiles(VIDEO);
  await expect(page.getByRole('button', { name: 'Subiendo…' })).toBeVisible();
  await dorado('subiendo');
  await expect(boton).toHaveText('Iniciar ✦ 8');
  await dorado('con precio y texto');
  await expect(boton).not.toHaveAttribute('aria-disabled', 'true');
  await campo(page).fill('');
  await dorado('con precio, sin texto');
  await expect(boton).toHaveAttribute('aria-disabled', 'true');
});

test('«Editar ▾» va junto al «+», abre su lista de dos opciones, y elegir la de ahora solo cierra', async ({ page }) => {
  await edicion(page);
  const mas = page.getByRole('button', { name: 'Agregar el video que quieres editar' });
  const cajaMas = (await mas.boundingBox())!;
  const cajaChip = (await chip(page).boundingBox())!;
  // misma fila, pegado al «+» a su derecha (10 px de hueco)
  expect(Math.abs(cajaChip.y + cajaChip.height / 2 - (cajaMas.y + cajaMas.height / 2))).toBeLessThanOrEqual(2);
  expect(cajaChip.x - (cajaMas.x + cajaMas.width)).toBeGreaterThanOrEqual(0);
  expect(cajaChip.x - (cajaMas.x + cajaMas.width)).toBeLessThanOrEqual(16);
  // «Iniciar» a la derecha, en la misma fila (desde 640 px)
  const cajaIniciar = (await iniciar(page).boundingBox())!;
  expect(cajaIniciar.x).toBeGreaterThan(cajaChip.x + cajaChip.width);
  expect(Math.abs(cajaIniciar.y + cajaIniciar.height / 2 - (cajaChip.y + cajaChip.height / 2))).toBeLessThanOrEqual(2);
  // y pegado al borde derecho del cuadro de escritura, como la fila de Video (ml-auto): no junto al chip
  const bordeDerecho = await campo(page).evaluate(e => e.parentElement!.getBoundingClientRect().right);
  expect(Math.abs(cajaIniciar.x + cajaIniciar.width - bordeDerecho), '«Iniciar» no queda alineado a la derecha').toBeLessThanOrEqual(2);
  // la pista al pasar el ratón (el `data-pista` pintado con ::after, como en Video): dice la nota... y se PINTA. El estilo
  // calculado daba «visible» aun cuando el botón la recortaba con overflow-hidden, así que se compara la pantalla de verdad
  expect(await pistaSePinta(page, chip(page)), 'al pasar el ratón por «Editar ▾» no se pinta ninguna pista').toBe(true);
  const pista = await chip(page).evaluate(e => getComputedStyle(e, '::after').content);
  expect(pista).toContain('Sube tu metraje y la IA te propone el corte. Se edita una copia: tu original se queda como está.');
  // la lista: Editar (la de ahora) y De videos a Shorts, cada una con «según el video»
  await chip(page).click();
  const lista = page.getByRole('listbox', { name: 'Opciones' });
  await expect(lista).toBeVisible();
  // con la lista abierta el globo de la pista se quita (la misma nota sale en la fila de la lista), aunque el ratón siga encima
  expect(await chip(page).evaluate(e => getComputedStyle(e, '::after').display)).toBe('none');
  await expect(lista.getByRole('option')).toHaveCount(2);
  await expect(lista.getByRole('option').nth(0)).toContainText('según el video');
  await expect(lista.getByRole('option').nth(0)).toBeFocused();
  await expect(lista.getByRole('option').nth(1)).toContainText('De videos a Shorts');
  await page.keyboard.press('Escape');
  await expect(lista).toHaveCount(0);
  await expect(chip(page)).toBeFocused();
  // Enter elige la de ahora (la lista abre en ella): cierra y vuelve al chip; sin ninguna petición de editar
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(lista).toHaveCount(0);
  await expect(chip(page)).toBeFocused();
  await expect(page.locator('#bandeja [role="alert"]')).toHaveCount(0);
});

test.describe('en el teléfono, «Editar ▾» e «Iniciar»', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('«+» y el chip arriba en una fila, «Iniciar» abajo a todo el ancho, y la lista abierta no se sale de la pantalla', async ({ page }) => {
    await edicion(page);
    const mas = (await page.getByRole('button', { name: 'Agregar el video que quieres editar' }).boundingBox())!;
    const selector = (await chip(page).boundingBox())!;
    const inicio = (await iniciar(page).boundingBox())!;
    const cuadro = (await campo(page).evaluate(e => e.parentElement!.getBoundingClientRect().toJSON())) as { x: number; width: number };
    expect(Math.abs(selector.y + selector.height / 2 - (mas.y + mas.height / 2))).toBeLessThanOrEqual(2);
    expect(inicio.y).toBeGreaterThanOrEqual(mas.y + mas.height);
    // «Iniciar» ocupa el ancho del cuadro (la fila de Video hace lo mismo con «Crear»)
    expect(Math.abs(inicio.width - cuadro.width)).toBeLessThanOrEqual(2);
    for (const caja of [mas, selector, inicio]) {
      expect(caja.x).toBeGreaterThanOrEqual(0);
      expect(caja.x + caja.width).toBeLessThanOrEqual(390);
      expect(caja.height).toBeGreaterThanOrEqual(44);
    }
    await chip(page).click();
    const lista = (await page.getByRole('listbox', { name: 'Opciones' }).boundingBox())!;
    expect(lista.x).toBeGreaterThanOrEqual(0);
    expect(lista.x + lista.width).toBeLessThanOrEqual(390);
    const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sobra).toBeLessThanOrEqual(0);
  });
});

test.describe('con «reducir movimiento»', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('subiendo, lanzando y vacía: nada de la caja de Edición se queda moviéndose', async ({ page }) => {
    await edicion(page, COSTO, { subidaMs: 3000 });
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
    await page.locator('input[type="file"]').setInputFiles(VIDEO);
    await expect(page.getByRole('progressbar', { name: 'Subiendo el video' })).toBeVisible();
    await page.waitForTimeout(400);
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
    await expect(page.getByRole('button', { name: 'Iniciar ✦ 8' })).toBeVisible({ timeout: 8000 });
    await campo(page).fill('Quítale las muletillas');
    await page.getByRole('button', { name: 'Iniciar ✦ 8' }).click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
  });
});
