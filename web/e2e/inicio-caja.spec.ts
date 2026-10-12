// La caja del inicio en un navegador de verdad, con el static/trabajos.js real (lo sirve e2e/servidor.mjs):
//  · Ctrl+V con una imagen copiada la agrega (un DataTransfer y un ClipboardEvent reales, no los de jsdom);
//  · «Crear una imagen» tiene su «+» y, con una imagen, la caja pasa a «Editar una imagen»;
//  · «Ya estamos creando…» y los errores salen en el cuadro de abajo a la derecha, no junto a la caja.
// Lo que vitest no puede ver: que window.avisos exista cuando la caja lo llama y dónde cae el cuadro en pantalla.
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

async function inicio(page: Page, generar: { estado: number; cuerpo: unknown; demoraMs?: number }) {
  for (const [ruta, json] of Object.entries(RESPUESTAS_VACIAS)) await page.route(ruta, r => r.fulfill({ json }));
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
