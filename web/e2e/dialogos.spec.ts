// UI·20 — los diálogos entran (150 ms) y salen (100 ms), y el foco hace lo
// de siempre: entra al abrir y vuelve al botón que abrió al cerrar. En la
// vitrina viven un Dialogo y un Confirmar de muestra, sin API.
import { expect, test, type Page } from '@playwright/test';

import { animacionesVivas } from './pantallas';

// solo las del diálogo: la vitrina tiene sus propias animaciones (el orbe,
// los esqueletos) que no vienen al caso
const DEL_DIALOGO = /^(caja-entra|caja-sale|velo-entra|velo-sale) /;
const nombres = async (page: Page) =>
  (await page.evaluate(animacionesVivas)).map(a => `${a.nombre} ${a.duracion}`).filter(n => DEL_DIALOGO.test(n));

for (const caso of [
  { boton: 'Abrir diálogo', rol: 'dialog' as const },
  { boton: 'Borrar el proyecto…', rol: 'alertdialog' as const },
]) {
  test(`${caso.rol}: entra, sale más rápido de lo que entró y el foco vuelve`, async ({ page }) => {
    await page.goto('/estudio/_vitrina/');
    const abrir = page.getByRole('button', { name: caso.boton });
    await abrir.focus();
    await page.keyboard.press('Enter');
    const d = page.getByRole(caso.rol);
    await expect(d).toBeVisible();
    expect(await nombres(page)).toEqual(expect.arrayContaining(['caja-entra 150', 'velo-entra 150']));
    await expect.poll(() => nombres(page)).toEqual([]);
    await page.keyboard.press('Escape');
    // sigue en pantalla mientras sale: Radix espera el animationend
    expect(await nombres(page)).toEqual(expect.arrayContaining(['caja-sale 100', 'velo-sale 100']));
    await expect(d).toBeHidden();
    await expect(abrir).toBeFocused();
  });
}

test('el Confirmar con «Cancelar» también devuelve el foco', async ({ page }) => {
  await page.goto('/estudio/_vitrina/');
  const abrir = page.getByRole('button', { name: 'Borrar el proyecto…' });
  await abrir.click();
  // lo que no se puede deshacer nunca es la opción por defecto
  await expect(page.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(abrir).toBeFocused();
});

test('Agenda con la red de verdad: al cancelar con el teclado, el foco acaba en «Actualizar», no en el <body>', async ({ page }) => {
  // la lista y el cancelar tardan: «Actualizar» sigue deshabilitado (cargando)
  // cuando el diálogo se desmonta y cuando cancelarYa termina
  let cancelada = false;
  const tarda = () => new Promise(r => setTimeout(r, 400));
  await page.route('**/api/agenda', async r => {
    await tarda();
    const items = cancelada ? [] : [{ id: 'sch_1', red: 'Instagram', cuenta_nombre: 'miCuenta', cuando: '2099-05-01T15:00:00Z', texto: 'Hola', cortado: false, medios: 1 }];
    return r.fulfill({ json: { items, cursor: null, total: items.length, error: null, reconectar: false } });
  });
  await page.route('**/api/agenda/cancelar', async r => {
    await tarda();
    cancelada = true;
    return r.fulfill({ json: { ok: true } });
  });
  await page.goto('/estudio/agenda/');
  const cancelar = page.getByRole('button', { name: 'Cancelar', exact: true });
  await cancelar.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'No, dejarla' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Sí, cancelarla' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Publicación cancelada.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Actualizar' })).toBeFocused();
});

test('mientras sale, el diálogo ya no oye el teclado (Enter no manda el formulario cerrado)', async ({ page }) => {
  let posts = 0;
  await page.route(/\/api\/blotato(\?.*)?$/, r => {
    if (r.request().method() === 'POST') posts++;
    return r.fulfill({ json: { conectado: false, origen: null, cuentas: [], error: null, plan: null } });
  });
  await page.goto('/estudio/inicio/?blotato=conectar');
  const form = page.getByRole('dialog', { name: 'Conecta tu Blotato' });
  const clave = form.getByLabel('Tu clave de API de Blotato');
  await clave.fill('una-clave');
  await clave.focus();
  // Escape y, en los 100 ms de la salida, Enter
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await expect(form).toBeHidden();
  await page.waitForTimeout(300);
  expect(posts).toBe(0);
});

test.describe('con «reducir movimiento»', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('abre y cierra al instante', async ({ page }) => {
    await page.goto('/estudio/_vitrina/');
    const abrir = page.getByRole('button', { name: 'Abrir diálogo' });
    await abrir.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await nombres(page)).toEqual([]);
    await page.keyboard.press('Escape');
    expect(await nombres(page)).toEqual([]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(abrir).toBeFocused();
  });
});
