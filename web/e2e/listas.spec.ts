// UI·21 — las listas vivas: lo que llega abre su espacio en vez de empujar
// todo de golpe, y lo que cambia de lugar viaja de su sitio viejo al nuevo.
// Con «reducir movimiento», todo al instante.
import { expect, test, type Page } from '@playwright/test';

import { animacionesVivas } from './pantallas';

const CUENTA = (id: string, cuenta: string) => ({ id, red: 'instagram', cuenta });
const PERFIL = (id: string, estado: string) => ({
  id, estado, plataforma: 'instagram', error: estado === 'error' ? 'el reel no se pudo bajar' : undefined,
  fuente: { autor: id, plataforma: 'instagram' }, paleta: [], perfil: {},
});

// Competencia con una cuenta; al agregar, el listado trae dos
async function competencia(page: Page) {
  let agregada = false;
  const listado = () => ({
    cuentas: agregada ? [CUENTA('in-uno', 'uno'), CUENTA('in-dos', 'dos')] : [CUENTA('in-uno', 'uno')],
    informes: [], credito_por_cuenta: 5, max_cuentas: 10,
  });
  await page.route('**/api/competencia', r => r.fulfill({ json: listado() }));
  await page.route('**/api/competencia/cuentas', r => {
    agregada = true;
    return r.fulfill({ json: { cuentas: listado().cuentas } });
  });
  await page.goto('/estudio/competencia/');
  await page.getByText('@uno').waitFor();
  await page.waitForTimeout(300);
}

// Estilos con dos perfiles; re-analizar el que falló lo sube a la cima
async function estilos(page: Page) {
  let reanalizado = false;
  await page.route('**/api/estilo', r =>
    r.fulfill({
      json: {
        creditos: 7,
        estilos: reanalizado
          ? [PERFIL('ig-roto', 'listo'), PERFIL('ig-bueno', 'listo')]
          : [PERFIL('ig-bueno', 'listo'), PERFIL('ig-roto', 'error')],
      },
    }),
  );
  await page.route('**/api/estilo/analizar', r => {
    reanalizado = true;
    return r.fulfill({ json: { lanzado: true, id: 'ig-roto', creditos: 7 } });
  });
  await page.goto('/estudio/estilos/');
  await page.getByText('El análisis falló', { exact: false }).waitFor();
  await page.getByPlaceholder(/instagram/).fill('https://www.instagram.com/reel/roto');
  await page.waitForTimeout(300);
}

const filas = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll<HTMLElement>('.fila-viva')].map(f => f.style.getPropertyValue('--vt-nombre')));

test('la cuenta que se agrega abre su espacio; la que ya estaba no se anima', async ({ page }) => {
  await competencia(page);
  await page.getByPlaceholder(/instagram\.com\/lacuenta/).fill('instagram.com/dos');
  await page.getByRole('button', { name: 'Agregar' }).click();
  await page.getByText('@dos').waitFor();
  // solo las de filas (el botón «Agregar» tiene su propia transición de hover)
  const vivas = (await page.evaluate(animacionesVivas)).filter(a => a.nombre.startsWith('fila-'));
  // Chromium sabe animar hasta `height: auto` (interpolate-size): abre, no solo se funde
  expect(vivas.map(a => `${a.nombre} ${a.duracion} ${a.objetivo}`)).toEqual([
    expect.stringMatching(/^fila-abre 240 li\.fila-viva\.fila-entra/),
  ]);
  await expect.poll(() => page.locator('.fila-entra').count()).toBe(0);
});

test('re-analizar sube el perfil a la cima: las tarjetas viajan, y nada entra animado', async ({ page }) => {
  await estilos(page);
  expect(await filas(page)).toEqual(['perfil-ig-bueno', 'perfil-ig-roto']);
  await page.getByRole('button', { name: /Analizar/ }).click();
  await expect.poll(() =>
    page.evaluate(() => document.getAnimations().map(a => (a.effect as KeyframeEffect | null)?.pseudoElement ?? '').filter(Boolean)),
  ).toEqual(expect.arrayContaining(['::view-transition-group(perfil-ig-roto)', '::view-transition-group(perfil-ig-bueno)']));
  // la página no se fotografía entera: queda viva mientras tanto
  const pseudos = await page.evaluate(() => document.getAnimations().map(a => (a.effect as KeyframeEffect | null)?.pseudoElement ?? ''));
  expect(pseudos.some(p => p.includes('(root)'))).toBe(false);
  await expect.poll(() => filas(page)).toEqual(['perfil-ig-roto', 'perfil-ig-bueno']);
  expect(await page.locator('.fila-entra').count()).toBe(0);
});

test.describe('con «reducir movimiento»', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('la cuenta nueva aparece y la lista se reordena al instante', async ({ page }) => {
    await competencia(page);
    await page.getByPlaceholder(/instagram\.com\/lacuenta/).fill('instagram.com/dos');
    await page.getByRole('button', { name: 'Agregar' }).click();
    await page.getByText('@dos').waitFor();
    expect(await page.evaluate(animacionesVivas)).toEqual([]);

    await estilos(page);
    await page.getByRole('button', { name: /Analizar/ }).click();
    await expect.poll(() => filas(page)).toEqual(['perfil-ig-roto', 'perfil-ig-bueno']);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });
});
