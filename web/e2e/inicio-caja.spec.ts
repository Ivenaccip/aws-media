// La caja del inicio en un navegador de verdad, con el static/trabajos.js real (lo sirve e2e/servidor.mjs):
//  · Ctrl+V con una imagen copiada la agrega (un DataTransfer y un ClipboardEvent reales, no los de jsdom);
//  · «Crear una imagen» tiene su «+» y, con una imagen, la caja pasa a «Editar una imagen»;
//  · «Ya estamos creando…» y los errores salen en el cuadro de abajo a la derecha, no junto a la caja.
// Lo que vitest no puede ver: que window.avisos exista cuando la caja lo llama y dónde cae el cuadro en pantalla.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, test, type Page } from '@playwright/test';

const RESPUESTAS_VACIAS: Record<string, unknown> = {
  '**/api/proyectos': [],
  '**/api/slots': { slots: null, activos: 0 },
  '**/api/imagenes': { total: 0, imagenes: [] },
  '**/api/edicion/proyectos': [],
  '**/api/clip': { clips: [] },
  '**/api/trabajos': { trabajos: [], sondeo_s: 15 },
  '**/api/moderar': { permitido: true },
};

// un PNG de 1×1: lo que «sirve» el estudio como imagen de Mis creaciones
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
// Un «CDN» de verdad, en OTRO origen y SIN cabeceras CORS, como el de la nube: una imagen se pinta desde ahí (<img>), pero un
// fetch desde la página falla. Sin esto la prueba pasaría con un servidor que sirve la imagen en el mismo origen.
async function cdnSinCors() {
  const servidor = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(PNG_1X1);
  });
  await new Promise<void>(listo => servidor.listen(0, '127.0.0.1', listo));
  const { port } = servidor.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, cerrar: () => new Promise<void>(listo => servidor.close(() => listo())) };
}

const imagenDeMisCreaciones = (i: number) => ({ nombre: `img-${i}.jpg`, url: `/api/imagenes/img-${i}.jpg`, creado: 1_758_000_000 + i });

async function inicio(
  page: Page,
  generar: { estado: number; cuerpo: unknown; demoraMs?: number },
  imagenes: Array<ReturnType<typeof imagenDeMisCreaciones>> = [],
  cdn?: string,
) {
  for (const [ruta, json] of Object.entries(RESPUESTAS_VACIAS)) await page.route(ruta, r => r.fulfill({ json }));
  if (imagenes.length) {
    await page.route('**/api/imagenes', r => r.fulfill({ json: { total: imagenes.length, imagenes } }));
    // Con `cdn`, como en la nube: la URL de cada imagen REDIRIGE a un CDN sin CORS. La miniatura (un <img>) carga; un fetch
    // ahí falla. Los bytes salen de nuestro endpoint /archivo, del mismo origen.
    await page.route('**/api/imagenes/*.jpg', r =>
      cdn ? r.fulfill({ status: 302, headers: { location: `${cdn}/imagen.png` } }) : r.fulfill({ body: PNG_1X1, contentType: 'image/png' }),
    );
    await page.route('**/api/imagenes/*.jpg/archivo', r => r.fulfill({ body: PNG_1X1, contentType: 'image/png' }));
  }
  await page.route('**/api/blotato', r => r.fulfill({ status: 404, json: { detail: 'no' } }));
  await page.route('**/api/clip/generar', async r => {
    if (generar.demoraMs) await new Promise(f => setTimeout(f, generar.demoraMs));
    await r.fulfill({ status: generar.estado, json: generar.cuerpo });
  });
  await page.goto('/estudio/inicio/');
  await expect(page.getByRole('textbox', { name: '¿Qué vamos a crear hoy?' })).toBeVisible();
}

const caja = (page: Page) => page.getByRole('textbox', { name: '¿Qué vamos a crear hoy?' });

// Un pegado de verdad: un DataTransfer con un archivo, en un ClipboardEvent que se puede cancelar.
// Devuelve true si nadie lo canceló (o sea, si el navegador seguiría pegando como texto).
function pegarImagen(page: Page, nombre: string, texto = '') {
  return page.evaluate(
    ([n, t]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], n!, { type: 'image/png' }));
      if (t) dt.setData('text/plain', t);
      const evento = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      return (document.querySelector('textarea') as HTMLElement).dispatchEvent(evento);
    },
    [nombre, texto],
  );
}

test('pegar una captura de verdad la agrega a la caja', async ({ page }) => {
  await inicio(page, { estado: 200, cuerpo: {} });
  await page.getByRole('button', { name: 'Imagen' }).click();
  await caja(page).click();
  expect(await pegarImagen(page, 'image.png')).toBe(false);
  await expect(page.getByRole('button', { name: 'Quitar «imagen-pegada.png»' })).toBeVisible();
  // en «Crear una imagen» una imagen la convierte en «Editar una imagen»
  await expect(page.getByRole('button', { name: 'Editar una imagen' })).toBeVisible();
});

test('un pegado con texto sigue siendo texto', async ({ page }) => {
  await inicio(page, { estado: 200, cuerpo: {} });
  await caja(page).click();
  expect(await pegarImagen(page, 'image.png', 'una tabla de Excel')).toBe(true);
  await expect(page.getByRole('list', { name: 'Imágenes de referencia' })).toHaveCount(0);
});

test('«Crear una imagen» tiene su «+»', async ({ page }) => {
  await inicio(page, { estado: 200, cuerpo: {} });
  await page.getByRole('button', { name: 'Imagen' }).click();
  await expect(page.getByRole('button', { name: 'Crear una imagen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agregar una imagen para editarla' })).toBeVisible();
});

// El cuadro de abajo a la derecha: pegado a la esquina, a 16 px de cada borde
async function esquinaInferiorDerecha(page: Page) {
  const caja = await page.locator('#bandeja').boundingBox();
  const ventana = page.viewportSize()!;
  expect(caja).not.toBeNull();
  expect(Math.abs(ventana.width - (caja!.x + caja!.width))).toBeLessThanOrEqual(20);
  expect(Math.abs(ventana.height - (caja!.y + caja!.height))).toBeLessThanOrEqual(20);
}

test('al generar sale «Ya estamos creando…» abajo a la derecha, y no junto a la caja', async ({ page }) => {
  await inicio(page, { estado: 200, cuerpo: { lanzado: true, id: 'clip-1', creditos: 36 }, demoraMs: 800 });
  await caja(page).fill('un gato jugando en la nieve');
  await page.getByRole('button', { name: /^Modelo / }).click();
  await page.getByRole('dialog', { name: 'Elegir modelo' }).getByRole('button', { name: 'Crear' }).click();
  const cuadro = page.locator('#bandeja');
  await expect(cuadro).toContainText('Ya estamos creando tu clip de 8 segundos');
  await esquinaInferiorDerecha(page);
  // y con su icono: sin iconos.js el cuadro sale con un hueco donde iría
  expect((await cuadro.locator('svg.ico').first().boundingBox())?.width ?? 0).toBeGreaterThan(8);
  // nada de mensajes junto a la caja
  await expect(page.locator('section [role="status"], section [role="alert"]')).toHaveCount(0);
  await page.screenshot({ path: process.env.PW_CAPTURA_AVISO ?? 'test-results/aviso-creando.png' });
});

test('un error al generar sale en el cuadro, reemplaza al «creando» y el texto se queda', async ({ page }) => {
  await inicio(page, {
    estado: 402,
    cuerpo: { detail: 'Créditos insuficientes: esta acción cuesta 36 créditos y tu saldo es 2.' },
  });
  await caja(page).fill('un gato jugando en la nieve');
  await page.getByRole('button', { name: /^Modelo / }).click();
  await page.getByRole('dialog', { name: 'Elegir modelo' }).getByRole('button', { name: 'Crear' }).click();
  const cuadro = page.locator('#bandeja');
  await expect(cuadro.getByRole('alert')).toContainText('Créditos insuficientes');
  await expect(cuadro).not.toContainText('Ya estamos creando');
  await esquinaInferiorDerecha(page);
  await expect(page.locator('section [role="alert"]')).toHaveCount(0);
  await expect(caja(page)).toHaveValue('un gato jugando en la nieve');
  // un error se queda hasta cerrarlo: su «×» tiene que verse (iconos.js + la regla .ico de tokens.css) y funcionar
  const cerrar = cuadro.getByRole('button', { name: 'Cerrar aviso' });
  await expect(cerrar).toBeVisible();
  const icono = await cerrar.locator('svg.ico').boundingBox();
  expect(icono?.width ?? 0).toBeGreaterThan(8);
  await page.screenshot({ path: process.env.PW_CAPTURA_ERROR ?? 'test-results/aviso-error.png' });
  await cerrar.click();
  await expect(cuadro.getByRole('alert')).toHaveCount(0);
});

test('sin texto, el error también sale en el cuadro', async ({ page }) => {
  await inicio(page, { estado: 200, cuerpo: {} });
  await page.getByRole('button', { name: /^Modelo / }).click();
  await page.getByRole('dialog', { name: 'Elegir modelo' }).getByRole('button', { name: 'Crear' }).click();
  await expect(page.locator('#bandeja').getByRole('alert')).toContainText('Cuéntanos qué quieres primero');
});

test('el «+» ofrece Mis creaciones: se eligen imágenes en la hoja y llegan a la caja', async ({ page }) => {
  const cdn = await cdnSinCors();
  try {
    await hojaDeMisCreaciones(page, cdn.url);
  } finally {
    await cdn.cerrar();
  }
});

async function hojaDeMisCreaciones(page: Page, cdn: string) {
  await inicio(page, { estado: 200, cuerpo: {} }, [imagenDeMisCreaciones(1), imagenDeMisCreaciones(2), imagenDeMisCreaciones(3)], cdn);
  const mas = page.getByRole('button', { name: 'Agregar imágenes de referencia' });
  await mas.click();
  await expect(page.getByRole('menu', { name: 'Agregar imágenes' })).toBeVisible();
  await page.getByRole('menuitem', { name: /Elegir de Mis creaciones/ }).click();
  const hoja = page.getByRole('dialog', { name: 'Agregar imágenes' });
  await expect(hoja).toBeVisible();
  // las miniaturas cargan de verdad (no son cuadros vacíos)
  await expect
    .poll(() => hoja.locator('img').first().evaluate(i => (i as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  const miniaturas = hoja.getByRole('button', { name: /^Tu imagen del/ });
  await miniaturas.nth(0).click();
  await miniaturas.nth(2).click();
  await expect(hoja.getByRole('status')).toContainText('2 de 3 seleccionadas');
  await page.screenshot({ path: process.env.PW_CAPTURA_HOJA ?? 'test-results/hoja-mis-creaciones.png' });
  await hoja.getByRole('button', { name: 'Agregar 2' }).click();
  await expect(hoja).toBeHidden();
  // la más nueva (img-3) se marcó al final, así que va segunda
  await expect(page.getByRole('button', { name: 'Quitar «img-3.jpg»' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quitar «img-1.jpg»' })).toBeVisible();
}

test('el interruptor «Audio» del clip: baja el precio, el chip lo dice en un celular y el pedido va sin sonido', async ({ page }) => {
  await inicio(page, { estado: 200, cuerpo: { lanzado: true, id: 'clip-1', creditos: 22 } });
  await page.setViewportSize({ width: 375, height: 800 });
  await caja(page).fill('un gato en la luna');
  const chip = page.getByRole('button', { name: /^Modelo / });
  await chip.click();
  const menu = page.getByRole('dialog', { name: 'Elegir modelo' });
  const interruptor = menu.getByRole('switch', { name: 'Audio' });
  // arranca con sonido, como siempre, y el pie dice el precio de con sonido
  await expect(interruptor).toHaveAttribute('aria-checked', 'true');
  await expect(menu).toContainText('Con sonido');
  await expect(menu).toContainText('Veo 3.1 Lite✦ 36 por clip de 8 s');
  await interruptor.click();
  await expect(interruptor).toHaveAttribute('aria-checked', 'false');
  await expect(menu).toContainText('Sin sonido');
  await expect(menu).toContainText('Veo 3.1 Lite✦ 22 por clip de 8 s · ahorras ✦ 14');
  // el chip dice «sin audio» y los segundos no se recortan aunque el nombre no quepa: se prueba con el nombre más largo
  await menu.getByRole('radio', { name: /Veo 3\.1 Fast/ }).click();
  await page.keyboard.press('Escape');
  await expect(chip).toContainText('· 8 s · sin audio');
  const cabe = await chip.evaluate(el => {
    const b = el.getBoundingClientRect();
    const resto = Array.from(el.querySelectorAll('span')).find(s => s.children.length === 0 && /sin audio/.test(s.textContent ?? ''));
    const r = resto?.getBoundingClientRect();
    return !!r && r.left >= b.left && r.right <= b.right + 0.5;
  });
  expect(cabe).toBe(true);
  // el pedido sale con `audio: false`, el modelo y los segundos
  await chip.click();
  const pedido = page.waitForRequest('**/api/clip/generar');
  await menu.getByRole('button', { name: 'Crear' }).click();
  expect((await pedido).postDataJSON()).toMatchObject({ audio: false, modelo: 'veo-fast', segundos: 8 });
});

test('en un celular bajo la hoja del menú no pasa de la barra del saldo y el interruptor se toca entero', async ({ page }) => {
  await inicio(page, { estado: 200, cuerpo: {} });
  for (const [ancho, alto] of [[320, 568], [375, 553]] as const) {
    await page.setViewportSize({ width: ancho, height: alto });
    const chip = page.getByRole('button', { name: /^Modelo / });
    await chip.click();
    const menu = page.getByRole('dialog', { name: 'Elegir modelo' });
    // el modelo con el pie más alto: el interruptor bloqueado y su motivo escrito debajo
    await menu.getByRole('radio', { name: /Grok Imagine Video 1\.5 Lite/ }).click();
    await expect(menu).toContainText('no se puede apagar');
    const hoja = (await menu.boundingBox())!;
    expect(hoja.y, `${ancho}×${alto}: la hoja tapa la barra del saldo`).toBeGreaterThanOrEqual(50);
    expect(hoja.y + hoja.height).toBeLessThanOrEqual(alto + 0.5);
    // «Cerrar» es lo que se toca en su centro, no la barra del saldo
    const c = (await menu.getByRole('button', { name: 'Cerrar' }).boundingBox())!;
    const cerrarLibre = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x!, y!)?.closest('[role="dialog"]') !== null,
      [c.x + c.width / 2, c.y + c.height / 2],
    );
    expect(cerrarLibre, `${ancho}×${alto}: algo tapa «Cerrar»`).toBe(true);
    // el interruptor mide 44 px y se toca hasta su borde de abajo (no lo tapa el texto del estado)
    const sw = (await menu.getByRole('switch', { name: 'Audio' }).boundingBox())!;
    expect(sw.height).toBeGreaterThanOrEqual(44);
    const enElBorde = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x!, y!)?.closest('[role="switch"]') !== null,
      [sw.x + sw.width / 2, sw.y + sw.height - 2],
    );
    expect(enElBorde, `${ancho}×${alto}: el borde de abajo del interruptor no lo recibe`).toBe(true);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  }
});
