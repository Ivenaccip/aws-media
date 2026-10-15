// La caja del inicio en un navegador de verdad, con el static/trabajos.js real (lo sirve e2e/servidor.mjs):
//  · Ctrl+V con una imagen copiada la agrega (un DataTransfer y un ClipboardEvent reales, no los de jsdom);
//  · «Crear una imagen» tiene su «+» y, con una imagen, la caja pasa a «Editar una imagen»;
//  · «Ya estamos creando…» y los errores salen en el cuadro de abajo a la derecha, no junto a la caja;
//  · el título «Irremplazables» (el h1 de la tarjeta, ya sin menú a la izquierda): su degradado dorado se pinta de verdad, y lo
//    que el menú traía («De videos a Shorts», «Copiadora de estilos») se alcanza por el chip «Editar ▾» y por el mapa.
// Lo que vitest no puede ver: que window.avisos exista cuando la caja lo llama y dónde cae el cuadro en pantalla.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { contraste } from '../src/nucleo/contraste';
import { pistaSePinta } from './pantallas';
import { irA, tarjeta } from './recorrido';

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

// Lo que vitest no puede ver: que un File pase de verdad de una página a otra por el IndexedDB real del navegador. En el
// inicio, «Creador de cuentos» lleva «+» para la foto del personaje; «Crear» la deja en el navegador y navega a Crear
// (directo a /estudio/crear/: la vieja /crear.html ignora `refs` y, según su etapa, ni redirige), que la recoge y la pone en su cuadro. Sin servidor nuevo y sin cobrar.
test('la foto del personaje pasa de la caja a Crear por el navegador y sobrevive a recargar', async ({ page }) => {
  await inicio(page, { estado: 200, cuerpo: {} });
  let posts = 0;
  page.on('request', r => {
    if (r.method() === 'POST') posts++;
  });
  await page.route('**/api/estilos', r => r.fulfill({ json: [{ id: 'animated', nombre: 'Animado', descripcion: '' }] }));
  await page.getByRole('button', { name: /Un video corto/ }).click();
  await page.getByRole('option', { name: /Creador de cuentos/ }).click();
  await caja(page).fill('cómo empezó la Segunda Guerra Mundial');
  await page.getByRole('button', { name: 'Agregar la foto de tu personaje' }).waitFor();
  await page.locator('input[type=file]').setInputFiles({ name: 'perro.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await expect(page.getByRole('button', { name: 'Quitar «perro.png»' })).toBeVisible();
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  // llegó a Crear con el texto, el modo y el token de la foto (no el archivo)
  await page.waitForURL(/\/estudio\/crear\/\?.*refs=[A-Za-z0-9-]{8,64}/);
  expect(new URL(page.url()).searchParams.get('modo')).toBe('investigacion');
  await expect(page.getByLabel('De qué trata tu video')).toHaveValue('cómo empezó la Segunda Guerra Mundial');
  await expect(page.getByAltText('Imagen 1 de tu personaje')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quitar perro.png' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  // recargar Crear no la pierde (leer no borra)
  await page.reload();
  await expect(page.getByAltText('Imagen 1 de tu personaje')).toBeVisible();
  // navegar no cobra ni crea nada
  expect(posts).toBe(0);
});

// El aviso de «Tu foto no alcanzó a llegar» nace junto al «+», no abajo con «Generar»: en un celular lo de abajo queda
// una pantalla y media más allá y `role=alert` no hace scroll.
test('en el celular el aviso de la foto que no llegó queda a la vista, junto al «+» de Crear', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/estilos', r => r.fulfill({ json: [{ id: 'animated', nombre: 'Animado', descripcion: '' }] }));
  await inicio(page, { estado: 200, cuerpo: {} });
  await page.goto('/estudio/crear/?brief=hola&modo=idea&refs=perdida');
  const aviso = page.getByRole('status').filter({ hasText: 'Tu foto no alcanzó a llegar' });
  await expect(aviso).toBeVisible();
  const caja = await aviso.boundingBox();
  const mas = await page.getByRole('button', { name: 'Subir la imagen de tu personaje' }).boundingBox();
  expect(caja!.y + caja!.height).toBeLessThanOrEqual(844);
  expect(mas!.y + mas!.height).toBeLessThanOrEqual(844);
});

// ---- el título de la tarjeta (dueño, 15-oct-2026) y los ajustes del 14-oct-2026 al área de escritura (lo que jsdom no ve: el color, el degradado y el aro de verdad) ----

// El título «Irremplazables» ya no es el del menú de la izquierda (que se fue): es el h1 de la tarjeta del inicio, en dorado con degradado
// (dueño, 15-oct-2026). El degradado se pinta recortando el fondo a la letra, y eso solo lo prueba un navegador: con `text-transparent`
// y sin recorte el título desaparecería. Por eso se mira (1) el estilo calculado, (2) que el texto es transparente SOLO si el navegador
// sabe recortar, y (3) los píxeles de verdad: que hay letra pintada, dorada, y más clara arriba que abajo.
const aHex = (rgb: string) => '#' + (rgb.match(/\d+/g) ?? []).slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('');

/** Los píxeles de la letra del título: cuántos, su color medio y qué tan claro es arriba y abajo (0 a 255). */
async function tintaDelTitulo(page: Page, titulo: Locator) {
  const png = (await titulo.screenshot()).toString('base64');
  return page.evaluate(async base64 => {
    const imagen = await createImageBitmap(await (await fetch('data:image/png;base64,' + base64)).blob());
    const lienzo = new OffscreenCanvas(imagen.width, imagen.height);
    const g = lienzo.getContext('2d')!;
    g.drawImage(imagen, 0, 0);
    const { data, width, height } = g.getImageData(0, 0, imagen.width, imagen.height);
    // el fondo es lo que hay en la esquina; «tinta» es todo lo que se aleja claramente de él
    const [fr, fg, fb] = [data[0]!, data[1]!, data[2]!];
    const tinta: Array<{ y: number; r: number; g: number; b: number }> = [];
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const [r, gg, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
        if (Math.abs(r - fr) + Math.abs(gg - fg) + Math.abs(b - fb) > 200) tinta.push({ y, r, g: gg, b });
      }
    if (!tinta.length) return { pixeles: 0, media: [0, 0, 0], arriba: 0, abajo: 0 };
    const luz = (p: { r: number; g: number; b: number }) => 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b;
    const [primero, ultimo] = [Math.min(...tinta.map(p => p.y)), Math.max(...tinta.map(p => p.y))];
    const mitad = (primero + ultimo) / 2;
    const promedio = (ps: typeof tinta) => ps.reduce((t, p) => t + luz(p), 0) / Math.max(1, ps.length);
    const n = tinta.length;
    return {
      pixeles: n,
      media: [tinta.reduce((t, p) => t + p.r, 0) / n, tinta.reduce((t, p) => t + p.g, 0) / n, tinta.reduce((t, p) => t + p.b, 0) / n],
      arriba: promedio(tinta.filter(p => p.y <= mitad)),
      abajo: promedio(tinta.filter(p => p.y > mitad)),
    };
  }, png);
}

test('el título «Irremplazables» es el h1 de la tarjeta: dorado con degradado, 32 px y negritas, sin icono', async ({ page }) => {
  await inicio(page, { estado: 200, cuerpo: {} });
  const titulo = page.getByRole('heading', { level: 1 });
  // el único h1 de la página, y es el que da nombre a la tarjeta
  await expect(titulo).toHaveCount(1);
  await expect(titulo).toHaveText('Irremplazables');
  await expect(page.getByRole('region', { name: 'Irremplazables' }).getByRole('heading', { level: 1 })).toHaveCount(1);
  expect(await titulo.locator('svg, img').count(), 'el título no lleva icono').toBe(0);
  await expect(titulo).toHaveCSS('font-size', '32px');
  await expect(titulo).toHaveCSS('font-weight', '800');
  await expect(titulo).toHaveCSS('text-align', 'center');

  const e = await titulo.evaluate(el => {
    const c = getComputedStyle(el);
    return {
      imagen: c.backgroundImage,
      recorte: c.backgroundClip,
      color: c.color,
      superficie: getComputedStyle(el.closest('section')!).backgroundColor,
      sabeRecortar: CSS.supports('background-clip', 'text') || CSS.supports('-webkit-background-clip', 'text'),
    };
  });
  const TRANSPARENTE = 'rgba(0, 0, 0, 0)';
  // el texto es transparente solo si el navegador recorta el fondo a la letra; si no sabe, el dorado liso (nunca un título invisible)
  expect(e.color === TRANSPARENTE, `color ${e.color} con recorte ${e.sabeRecortar ? 'soportado' : 'no soportado'}`).toBe(e.sabeRecortar);
  if (e.sabeRecortar) {
    expect(e.recorte).toBe('text');
    // el degradado dorado de la carta, de arriba abajo: claro, dorado, hondo
    expect(e.imagen).toMatch(/^linear-gradient\(.*rgb\(243, 220, 146\).*rgb\(230, 195, 92\).*rgb\(185, 141, 47\)/);
    // y de verdad se ve: hay letra pintada, es dorada y más clara arriba que abajo
    const tinta = await tintaDelTitulo(page, titulo);
    expect(tinta.pixeles, 'no hay letra pintada: el título es invisible').toBeGreaterThan(300);
    const [r, g, b] = tinta.media as [number, number, number];
    expect(r, 'la letra no es dorada').toBeGreaterThan(g);
    expect(g, 'la letra no es dorada').toBeGreaterThan(b + 40);
    expect(tinta.arriba, 'el degradado no va de claro arriba a hondo abajo').toBeGreaterThan(tinta.abajo + 10);
  } else {
    expect(e.imagen).toBe('none');
    expect(aHex(e.color)).toBe('#e6c35c');
  }
  // lo más oscuro del degradado (#b98d2f) sobre la superficie de la tarjeta se lee: 5.45:1 medido en la carta (AA de texto normal, 4.5)
  expect(contraste('#b98d2f', aHex(e.superficie)), 'el dorado hondo no se lee sobre la tarjeta').toBeGreaterThanOrEqual(4.5);
});

test('ya no hay menú «Secciones» ni «Editor de videos», y lo que traía el menú se alcanza por el mapa', async ({ page }) => {
  await inicio(page, { estado: 200, cuerpo: {} });
  await expect(page.getByRole('navigation', { name: 'Secciones' })).toHaveCount(0);
  await expect(page.locator('aside')).toHaveCount(0);
  await expect(page.getByText('Editor de videos')).toHaveCount(0);

  // «De videos a Shorts» vive en el chip «Editar ▾» de la caja (Edición), no en una lista de pantallas
  await page.getByRole('group', { name: 'Qué quieres crear' }).getByRole('button', { name: 'Edición', exact: true }).click();
  await page.locator('button[aria-haspopup="listbox"]').click();
  await expect(page.getByRole('listbox', { name: 'Opciones' }).getByRole('option', { name: /De videos a Shorts/ })).toBeVisible();
  await page.keyboard.press('Escape');

  // por el mapa: Marketing → sus grupos. Cada lista trae SUS pantallas (así «no hay» de abajo no pasa por vacía) y ninguna trae
  // «Editor de videos» ni «De videos a Shorts»
  const area = tarjeta(page);
  for (const [grupo, pantallas] of [['Blotato', 3], ['Avanzado', 2]] as const) {
    await irA(page, 'Marketing', grupo);
    await expect(area.getByRole('link'), `las pantallas de ${grupo}`).toHaveCount(pantallas);
    await expect(area.getByRole('link', { name: /De videos a Shorts|Editor de videos/ }), `en ${grupo}`).toHaveCount(0);
    await expect(area.locator('a[href^="/e1.html"], a[href^="/shorts.html"]'), `en ${grupo}`).toHaveCount(0);
  }
  // «Copiadora de estilos» (provisional, hasta que exista Marcas): Marketing → Avanzado → Copiadora
  await expect(area.getByRole('link', { name: /Copiadora de estilos/ })).toBeVisible();
  await Promise.all([page.waitForURL(/\/estudio\/estilos\//), area.getByRole('link', { name: /Copiadora de estilos/ }).click()]);
  await expect(page.getByRole('heading', { level: 1, name: 'Copiadora de estilos' })).toBeVisible();
});

for (const [familia, nombre] of [
  ['Imagen', '¿Qué vamos a crear hoy?'],
  ['Video', '¿Qué vamos a crear hoy?'],
  ['Edición', 'Cuéntale a la IA qué quieres'],
] as const) {
  test(`el área de escritura de «${familia}» es un cuadro bien definido con UN solo aro de foco`, async ({ page }) => {
    await inicio(page, { estado: 200, cuerpo: {} });
    await page.getByRole('group', { name: 'Qué quieres crear' }).getByRole('button', { name: familia, exact: true }).click();
    const campo = page.getByRole('textbox', { name: nombre });
    await expect(campo).toBeVisible();
    const cuadro = campo.locator('xpath=..');
    // el borde de campo (#55708f), el fondo de campo (elevada, #18293f), el radio de campos (10) y 12 px de relleno
    await expect(cuadro).toHaveCSS('border-top-color', 'rgb(85, 112, 143)');
    await expect(cuadro).toHaveCSS('border-top-width', '1px');
    await expect(cuadro).toHaveCSS('background-color', 'rgb(24, 41, 63)');
    await expect(cuadro).toHaveCSS('border-top-left-radius', '10px');
    await expect(cuadro).toHaveCSS('padding-top', '12px');
    // adentro, el texto no pone borde ni fondo propios
    await expect(campo).toHaveCSS('border-top-width', '0px');
    await expect(campo).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    // un clic en el relleno del cuadro (donde no hay texto) pone el cursor en él
    await page.getByRole('heading', { level: 1 }).click(); // el foco, en otra parte
    await cuadro.click({ position: { x: 4, y: 4 } });
    await expect(campo).toBeFocused();
    // UN solo aro: el del cuadro, con las medidas de la carta; el del texto no existe
    const aros = await campo.evaluate(e => {
      const aro = (el: Element) => {
        const c = getComputedStyle(el);
        return { estilo: c.outlineStyle, ancho: c.outlineWidth, color: c.outlineColor, separacion: c.outlineOffset };
      };
      return { cuadro: aro(e.parentElement!), campo: aro(e) };
    });
    expect(aros.cuadro).toEqual({ estilo: 'solid', ancho: '2px', color: 'rgb(240, 169, 74)', separacion: '3px' });
    expect(aros.campo.estilo).toBe('none');
  });
}

test('en el celular el cuadro de escritura de Imagen y Video cabe en la pantalla', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await inicio(page, { estado: 200, cuerpo: {} });
  for (const familia of ['Imagen', 'Video']) {
    await page.getByRole('group', { name: 'Qué quieres crear' }).getByRole('button', { name: familia, exact: true }).click();
    const cuadro = (await caja(page).locator('xpath=..').boundingBox())!;
    expect(cuadro.x, familia).toBeGreaterThanOrEqual(0);
    expect(cuadro.x + cuadro.width, familia).toBeLessThanOrEqual(390);
    const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sobra, familia).toBeLessThanOrEqual(0);
  }
});

// La pista del chip («Un video corto ▾», «Crear una imagen ▾») es un ::after que cuelga fuera del botón: un `overflow-hidden`
// en el propio botón la recortaba y NUNCA se vio (el estilo calculado decía «visible»; solo la pantalla de verdad lo delata).
for (const familia of ['Imagen', 'Video'] as const) {
  test(`al pasar el ratón por el chip de «${familia}» se PINTA su pista (no la recorta el botón)`, async ({ page }) => {
    await inicio(page, { estado: 200, cuerpo: {} });
    await page.getByRole('group', { name: 'Qué quieres crear' }).getByRole('button', { name: familia, exact: true }).click();
    const chip = page.locator('button[aria-haspopup="listbox"]');
    await expect(chip).toHaveCount(1);
    expect(await pistaSePinta(page, chip), `en «${familia}» no se ve ninguna pista`).toBe(true);
    // el rótulo largo se recorta con «…» en su <span>, no en el botón
    await expect(chip).toHaveCSS('overflow-x', 'visible');
  });
}

test('en el celular la pista del chip queda dentro de la pantalla', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await inicio(page, { estado: 200, cuerpo: {} });
  const chip = page.locator('button[aria-haspopup="listbox"]');
  await chip.hover();
  await expect.poll(() => chip.evaluate(e => getComputedStyle(e, '::after').opacity)).toBe('1');
  const pista = await chip.evaluate(e => {
    const c = e.getBoundingClientRect();
    const d = getComputedStyle(e, '::after');
    return { izq: c.left + parseFloat(d.left || '0'), ancho: parseFloat(d.width) };
  });
  expect(pista.izq).toBeGreaterThanOrEqual(0);
  expect(pista.izq + pista.ancho).toBeLessThanOrEqual(390);
  expect(await pistaSePinta(page, chip)).toBe(true);
});

// A 320 px el ::after de la pista del chip (aun invisible: `invisible` sigue ocupando lugar) pasaba de la pantalla y la página se
// podía arrastrar de lado hasta 24 px, en las tres familias. Se mide la página entera y el borde derecho de la pista con el
// chip bajo el ratón (donde se ve; enfocado es lo mismo), que es lo que un `scrollWidth` general no señalaría.
test('a 320 px la página no se arrastra de lado y la pista del chip queda dentro, en Imagen, Video y Edición', async ({ page }) => {
  await inicio(page, { estado: 200, cuerpo: {} });
  const chip = page.locator('button[aria-haspopup="listbox"]');
  for (const ancho of [320, 340, 359]) {
    await page.setViewportSize({ width: ancho, height: 844 });
    for (const familia of ['Imagen', 'Video', 'Edición']) {
      await page.getByRole('group', { name: 'Qué quieres crear' }).getByRole('button', { name: familia, exact: true }).click();
      await expect(chip).toHaveCount(1);
      const sobra = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(await sobra(), `${familia} a ${ancho} px: la página se arrastra de lado`).toBeLessThanOrEqual(0);
      await chip.hover();
      await expect.poll(() => chip.evaluate(e => getComputedStyle(e, '::after').opacity), { message: `${familia}: la pista no se enseña` }).toBe('1');
      const derecha = await chip.evaluate(e => e.getBoundingClientRect().left + parseFloat(getComputedStyle(e, '::after').width));
      expect(derecha, `${familia} a ${ancho} px: la pista se sale por la derecha`).toBeLessThanOrEqual(ancho);
      expect(await sobra(), `${familia} a ${ancho} px: con la pista a la vista la página se arrastra de lado`).toBeLessThanOrEqual(0);
    }
  }
});

// Con el relleno y el borde del cuadro (12 px por lado), el texto perdió 26 px de ancho: el ejemplo de «Creador de cuentos»
// (el más largo) pasaba a 5 líneas en un teléfono de 320 px y el textarea de 88 px de piso cortaba la última («…la foto de
// tu» y se perdía «personaje»). Se recorre CADA opción de Imagen y de Video, con su ejemplo puesto como texto, a varios anchos.
test('el ejemplo de cada opción de Imagen y Video se lee entero en un teléfono (no se corta la última línea)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await inicio(page, { estado: 200, cuerpo: {} });
  const chip = page.locator('button[aria-haspopup="listbox"]');
  let probadas = 0;
  for (const familia of ['Imagen', 'Video']) {
    await page.getByRole('group', { name: 'Qué quieres crear' }).getByRole('button', { name: familia, exact: true }).click();
    await chip.click();
    const cuantas = await page.getByRole('listbox', { name: 'Opciones' }).getByRole('option').count();
    await page.keyboard.press('Escape');
    for (let i = 0; i < cuantas; i++) {
      await chip.click();
      await page.getByRole('listbox', { name: 'Opciones' }).getByRole('option').nth(i).click();
      const nombre = ((await chip.innerText()) || '').replace('▾', '').trim();
      const ejemplo = (await caja(page).getAttribute('placeholder'))!;
      expect(ejemplo.length, `«${nombre}» sin ejemplo`).toBeGreaterThan(10);
      // el ejemplo, escrito como texto, ocupa lo mismo que su placeholder: si sobra altura, la última línea se pierde
      await caja(page).fill(ejemplo);
      for (const ancho of [320, 340, 359, 360, 375, 390]) {
        await page.setViewportSize({ width: ancho, height: 844 });
        const c = await caja(page).evaluate(e => ({ alto: e.getBoundingClientRect().height, sobra: e.scrollHeight - e.clientHeight }));
        // 2 px de tolerancia: es el interlineado de la última línea (su letra ya está a la vista), no una línea cortada
        expect(c.sobra, `«${nombre}» (${familia}) a ${ancho} px se corta (el campo mide ${c.alto})`).toBeLessThanOrEqual(2);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      probadas++;
    }
  }
  expect(probadas).toBeGreaterThanOrEqual(5); // las de Imagen y las de Video, no una sola familia
});
