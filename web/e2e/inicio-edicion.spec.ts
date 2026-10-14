// La caja de «Edición» del inicio (E1) en un navegador de verdad, con el static/trabajos.js real:
//  · el botón «Iniciar» (antes «Editar») es dorado en todos los estados y, aun sin poder, SIGUE enfocable (Tab) y, sin texto,
//    el clic lleva el foco al campo sin avisar;
//  · el campo está en un cuadro bien definido con UN solo aro de foco, y «Editar ▾» va junto al «+» (14-oct-2026);
//  · los avisos caen en el cuadro de abajo a la derecha y no junto a la caja;
//  · en un teléfono (390 px) nada se sale de la pantalla y todo lo tocable mide al menos 44 × 44 px
//    (jsdom no tiene diseño: eso solo se ve aquí);
//  · la subida de verdad (XHR) muestra su progreso y el precio sale del servidor;
//  · «Cancelar la subida» corta el PUT real (nada se confirma) y un texto enorme pegado se queda en 2000;
//  · revisión visual y de accesibilidad (lo que jsdom no ve): el aro de foco del campo, el contraste de su ejemplo, que el
//    ejemplo no se corte en un teléfono, «Subiendo…» en ámbar, el «Recargar» de 44 px y que con «reducir movimiento» nada
//    se quede moviéndose;
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

async function edicion(page: Page, costo: unknown = COSTO, { saldo, subidaMs = 600 }: { saldo?: number; subidaMs?: number } = {}) {
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
  await page.getByRole('group', { name: 'Qué quieres crear' }).getByRole('button', { name: 'Edición' }).click();
  await expect(campo(page)).toBeVisible();
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
  await expect(page.getByText('Escribe qué quieres hacer con tu video, o toca una idea.')).toBeVisible();
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
      ...(await page.getByRole('group', { name: 'Ideas para escribir' }).getByRole('button').all()),
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

test('el cuadro se ve enfocado con UN solo aro, su ejemplo se lee con 4.5:1 y «Subiendo…» sigue en ámbar con cursor de espera', async ({ page }) => {
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
  // el ejemplo: el gris secundario sobre el fondo del cuadro (elevada; con el 50 % del texto daba 4.39:1 ya sobre la superficie)
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

  test('el ejemplo del campo se lee entero (no se corta), a 320 px también y donde el navegador no mide el contenido', async ({ page }) => {
    await edicion(page);
    const corte = () => campo(page).evaluate(e => ({ alto: e.getBoundingClientRect().height, sobra: e.scrollHeight - e.clientHeight }));
    // con field-sizing (Chrome): crece hasta lo que haga falta, también en 320 px
    for (const ancho of [390, 360, 320, 640, 861]) {
      await page.setViewportSize({ width: ancho, height: 844 });
      const c = await corte();
      expect(c.sobra, `a ${ancho} px el ejemplo se corta (el campo mide ${c.alto})`).toBeLessThanOrEqual(1);
    }
    // sin él (Safari y Firefox, que aún no lo saben): el piso de la clase basta de 375 px para arriba
    await campo(page).evaluate(e => e.style.setProperty('field-sizing', 'fixed'));
    for (const ancho of [375, 390, 430, 639, 640, 861, 1440]) {
      await page.setViewportSize({ width: ancho, height: 844 });
      const c = await corte();
      expect(c.sobra, `a ${ancho} px, sin field-sizing, el ejemplo se corta (el campo mide ${c.alto})`).toBeLessThanOrEqual(1);
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
  // las ideas, el «+», el chip «Editar ▾» e «Iniciar» están en ese orden (y Shift+Tab los recorre al revés)
  const orden: string[] = [];
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press('Tab');
    orden.push(await enfocado());
  }
  expect(orden).toEqual([
    'Quita muletillas y silencios',
    'Un short vertical para Reels',
    'Resumen de 60 segundos',
    'Subtítulos grandes y un título',
    'Agregar el video que quieres editar',
    'Editar ▾',
    'Iniciar',
  ]);
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

test('«Editar ▾» va junto al «+», abre su lista de una opción, y elegirla solo cierra', async ({ page }) => {
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
  // la lista: una opción, con «según el video»
  await chip(page).click();
  const lista = page.getByRole('listbox', { name: 'Opciones' });
  await expect(lista).toBeVisible();
  // con la lista abierta el globo de la pista se quita (la misma nota sale en la fila de la lista), aunque el ratón siga encima
  expect(await chip(page).evaluate(e => getComputedStyle(e, '::after').display)).toBe('none');
  await expect(lista.getByRole('option')).toHaveCount(1);
  await expect(lista.getByRole('option')).toContainText('según el video');
  await expect(lista.getByRole('option')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(lista).toHaveCount(0);
  await expect(chip(page)).toBeFocused();
  // Enter la elige: cierra y vuelve al chip; sin ninguna petición de editar
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
