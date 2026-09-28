// UI·21 — las listas vivas: lo que llega abre su espacio en vez de empujar
// todo de golpe, y lo que cambia de lugar viaja de su sitio viejo al nuevo.
// Con «reducir movimiento», todo al instante.
import { expect, test, type Page } from '@playwright/test';

import {
  animacionesVivas, arranques, congelarArranques, cuantasTransiciones, grabarTransiciones, oirArranques, ultimaTransicion,
} from './pantallas';

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
  // lo que arranca, y la que abre se queda en su primer cuadro para medirla
  await oirArranques(page, /^fila-/);
  await competencia(page);
  await congelarArranques(page, 'fila-abre');
  await page.getByPlaceholder(/instagram\.com\/lacuenta/).fill('instagram.com/dos');
  await page.getByRole('button', { name: 'Agregar' }).click();
  await page.getByText('@dos').waitFor();
  // Chromium sabe animar hasta `height: auto` (interpolate-size): abre, no
  // solo se funde; y solo la nueva
  await expect.poll(() => arranques(page)).toEqual(['fila-abre 240']);
  expect(await page.locator('li.fila-viva.fila-entra').count()).toBe(1);
  // y de verdad abre: a la mitad mide menos que al final (en una columna flex
  // el mínimo automático le ganaba al height: 0 y solo se fundía)
  const alto = await page.evaluate(() => {
    const li = document.querySelector<HTMLElement>('li.fila-entra')!;
    const a = li.getAnimations().find(x => (x as CSSAnimation).animationName === 'fila-abre')!;
    a.pause();
    a.currentTime = 120;
    const media = li.getBoundingClientRect().height;
    a.finish();
    return { media, final: li.getBoundingClientRect().height };
  });
  expect(alto.media).toBeGreaterThan(0);
  expect(alto.media).toBeLessThan(alto.final * 0.9);
  await expect.poll(() => page.locator('.fila-entra').count()).toBe(0);
});

test('re-analizar sube el perfil a la cima: las tarjetas viajan, y nada entra animado', async ({ page }) => {
  await grabarTransiciones(page);
  await estilos(page);
  expect(await filas(page)).toEqual(['perfil-ig-bueno', 'perfil-ig-roto']);
  await page.getByRole('button', { name: /Analizar/ }).click();
  await expect.poll(() => cuantasTransiciones(page)).toBe(1);
  const vuelan = await ultimaTransicion(page);
  expect(vuelan).toEqual(expect.arrayContaining([
    expect.stringMatching(/^::view-transition-group\(perfil-ig-roto\)/),
    expect.stringMatching(/^::view-transition-group\(perfil-ig-bueno\)/),
  ]));
  // la página no se fotografía entera: queda viva mientras tanto
  expect(vuelan.some(p => p.includes('(root)'))).toBe(false);
  // y la píldora del saldo va aparte, quieta: nada suyo se anima
  expect(vuelan.some(p => p.includes('(monedero)'))).toBe(false);
  await expect.poll(() => filas(page)).toEqual(['perfil-ig-roto', 'perfil-ig-bueno']);
  expect(await page.locator('.fila-entra').count()).toBe(0);
});

test('si el foco está en una tarjeta que viaja, sigue en el mismo botón al terminar', async ({ page }) => {
  // otro análisis termina mientras miras: el sondeo trae la lista reordenada
  let vuelta = 0;
  await page.route('**/api/estilo', r => {
    const listo = { ...PERFIL('ig-bueno', 'listo'), perfil: { prompt_estilo: 'luz cálida' } };
    return r.fulfill({
      json: {
        creditos: 7,
        estilos: vuelta++ === 0 ? [listo, PERFIL('ig-otro', 'analizando')] : [PERFIL('ig-otro', 'listo'), listo],
      },
    });
  });
  await page.goto('/estudio/estilos/');
  const copiar = page.getByRole('button', { name: 'Copiar' });
  await copiar.focus();
  await expect.poll(() => filas(page), { timeout: 15000 }).toEqual(['perfil-ig-otro', 'perfil-ig-bueno']);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() =>
    (document.activeElement?.closest('.fila-viva') as HTMLElement | null)?.style.getPropertyValue('--vt-nombre'))).toBe('perfil-ig-bueno');
  await expect(page.locator('.fila-viva').last().getByRole('button', { name: 'Copiar' })).toBeFocused();
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
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
    expect(await page.evaluate(() => document.getAnimations().some(a => /view-transition/.test(
      (a.effect as KeyframeEffect | null)?.pseudoElement ?? '')))).toBe(false);
  });
});
