// UI·24 — el «no» y el «listo» de los formularios, sin toasts. Un campo que
// pasa a tener error tiembla (240 ms, ±6 px); lo que se guardó lo dice una
// palomita que se dibuja (300 ms) junto al texto, que llega con el resorte.
// Aquí en un navegador de verdad: jsdom no anima. La vitrina trae un
// formulario de muestra sin API; la Agenda y el diálogo de Blotato son los de
// verdad, con la API simulada.
import { expect, test, type Locator, type Page } from '@playwright/test';

import { animacionesVivas } from './pantallas';

declare global {
  interface Window {
    __ui24: string[];
  }
}

// Cada animación de esta tarjeta que ARRANCA, con su duración, en orden. Se
// oye el animationstart en vez de mirar lo que corre: 300 ms se acaban
// mientras un locator espera (y un diálogo que se cierra deja la página
// aria-hidden un instante), y así no se pierde ninguna.
async function oir(page: Page) {
  await page.addInitScript(() => {
    window.__ui24 = [];
    document.addEventListener(
      'animationstart',
      e => {
        if (!/^(campo-tiembla|trazo-se-dibuja|guardado-llega)$/.test(e.animationName)) return;
        const d = parseFloat(getComputedStyle(e.target as Element).animationDuration) * 1000;
        window.__ui24.push(`${e.animationName} ${Math.round(d)}`);
      },
      true,
    );
  });
}
/** Lo que arrancó desde la última vez que se preguntó. El animationstart se
 *  despacha en el siguiente cuadro: se esperan dos antes de leer. */
const arrancaron = (page: Page) =>
  page.evaluate(async () => {
    for (let i = 0; i < 2; i++) await new Promise(r => requestAnimationFrame(r));
    return window.__ui24.splice(0);
  });

// cuántos px se movió la caja a los `ms` del temblor (lo congela ahí y lo acaba)
const translateEn = (caja: Locator, ms: number) =>
  caja.evaluate((el, t) => {
    const a = el.getAnimations()[0]!;
    a.pause();
    a.currentTime = t;
    const v = parseFloat(getComputedStyle(el).translate);
    a.finish();
    return v;
  }, ms);

// cuánto trazo falta por dibujar (1 o más = nada, 0 = entero), a los `ms` si se dice
const faltaDelTrazo = (trazo: Locator, ms?: number) =>
  trazo.evaluate((p, t) => {
    const a = p.getAnimations()[0];
    if (a && t !== null) {
      a.pause();
      a.currentTime = t;
    }
    return parseFloat(getComputedStyle(p).strokeDashoffset);
  }, ms ?? null);

async function vitrina(page: Page) {
  await oir(page);
  await page.goto('/estudio/_vitrina/');
  const campo = page.getByRole('textbox', { name: 'Nombre del canal' });
  await campo.scrollIntoViewIfNeeded();
  const guardar = page.getByRole('button', { name: 'Guardar', exact: true });
  return { campo, guardar, listo: page.getByRole('status').filter({ hasText: /^Guardado$/ }) };
}

test('vitrina: al abrir nada tiembla ni se dibuja (la palomita del aviso está quieta)', async ({ page }) => {
  await vitrina(page);
  await page.waitForTimeout(400);
  expect(await arrancaron(page)).toEqual([]);
});

test('vitrina: el error que aparece hace temblar la caja; repetirlo, teclear o cambiarle el texto, no', async ({ page }) => {
  const { campo, guardar } = await vitrina(page);
  await guardar.click();
  await expect(page.getByText('Escribe el nombre de tu canal.')).toBeVisible();
  await expect(campo).toHaveAttribute('aria-invalid', 'true');
  expect(await translateEn(campo, 20)).toBeCloseTo(-6, 1); // a la izquierda a los 20 ms
  expect(await arrancaron(page)).toEqual(['campo-tiembla 240']);
  await guardar.click(); // el mismo error otra vez
  await campo.fill('a'); // teclas
  await guardar.click(); // otro texto, sin pasar por «sin error»
  await expect(page.getByText('Usa al menos 3 letras.')).toBeVisible();
  await page.waitForTimeout(100);
  expect(await arrancaron(page)).toEqual([]);
});

test('vitrina: se arregla y vuelve a fallar: tiembla otra vez (a la derecha a los 60 ms)', async ({ page }) => {
  const { campo, guardar } = await vitrina(page);
  await guardar.click();
  // que el primero alcance a arrancar: quitarle el error en el mismo cuadro lo cancelaría
  await expect.poll(() => arrancaron(page)).toEqual(['campo-tiembla 240']);
  await campo.fill('Mi canal');
  await guardar.click();
  await expect(campo).not.toHaveAttribute('aria-invalid');
  await campo.fill('');
  await guardar.click();
  await expect(campo).toHaveAttribute('aria-invalid', 'true');
  expect(await translateEn(campo, 60)).toBeCloseTo(6, 1);
  const temblores = (await arrancaron(page)).filter(n => n.startsWith('campo-tiembla'));
  expect(temblores).toEqual(['campo-tiembla 240']);
});

test('vitrina: «Guardado» se dibuja junto al botón, se anuncia y el foco se queda en «Guardar»', async ({ page }) => {
  const { campo, guardar, listo } = await vitrina(page);
  await campo.fill('Mi canal');
  await guardar.click();
  await expect(listo).toBeVisible();
  await expect(guardar).toBeFocused();
  const trazo = listo.locator('path');
  expect(await faltaDelTrazo(trazo, 0)).toBeGreaterThanOrEqual(1);
  const aMedias = await faltaDelTrazo(trazo, 150);
  expect(aMedias).toBeGreaterThan(0);
  expect(aMedias).toBeLessThan(1);
  await trazo.evaluate(p => p.getAnimations().forEach(a => a.finish()));
  expect(await arrancaron(page)).toEqual(['trazo-se-dibuja 300', 'guardado-llega 250']);
  // quieto, el trazo es entero y sin guion
  await expect.poll(() => faltaDelTrazo(trazo)).toBe(0);
  expect(await trazo.evaluate(p => getComputedStyle(p).strokeDasharray)).toBe('none');
  // escribir otra vez lo quita
  await campo.fill('Mi canal 2');
  await expect(listo).toHaveCount(0);
});

// ── la Agenda de verdad, con la API simulada
const UNA = {
  id: 'sch_1',
  red: 'Instagram',
  cuenta_nombre: 'miCuenta',
  cuando: '2099-05-01T15:00:00Z',
  texto: 'Hola mundo',
  cortado: false,
  medios: 1,
};

async function agenda(page: Page) {
  await oir(page);
  await page.route('**/api/agenda', r =>
    r.fulfill({ json: { items: [UNA], cursor: null, total: 1, error: null, reconectar: false } }),
  );
  await page.route('**/api/agenda/reprogramar', r => r.fulfill({ json: { id: 'sch_1' } }));
  await page.goto('/estudio/agenda/');
  await page.getByRole('button', { name: 'Cambiar la hora' }).click();
  const dlg = page.getByRole('dialog', { name: 'Cambiar la hora' });
  await expect(dlg).toBeVisible();
  return {
    dlg,
    campo: dlg.getByLabel('Nueva fecha y hora'),
    guardar: dlg.getByRole('button', { name: 'Guardar' }),
    ok: page.getByRole('status').filter({ hasText: /^Hora cambiada: Instagram sale el/ }),
  };
}

test('agenda: una hora que ya pasó hace temblar el campo; la que sirve se confirma con la palomita', async ({ page }) => {
  const { dlg, campo, guardar, ok } = await agenda(page);
  await campo.fill('2001-01-01T10:00');
  await guardar.click();
  await expect(dlg.getByText('Esa hora ya pasó: elige una más adelante.')).toBeVisible();
  await expect.poll(() => arrancaron(page)).toEqual(['campo-tiembla 240']);
  await campo.fill('2099-06-01T10:30');
  await guardar.click();
  await expect(ok).toBeVisible();
  // la palomita del Aviso; el texto «Hora cambiada…» no es un «Guardado» y no llega con resorte
  await expect.poll(() => arrancaron(page)).toEqual(['trazo-se-dibuja 300']);
  await expect.poll(() => faltaDelTrazo(ok.locator('path'))).toBe(0);
});

// ── conectar Blotato en el inicio
async function blotato(page: Page) {
  await oir(page);
  let conectado = false;
  await page.route(/\/api\/blotato(\?.*)?$/, r => {
    if (r.request().method() === 'POST') conectado = true;
    return r.fulfill({
      json: {
        conectado,
        origen: conectado ? 'usuario' : null,
        cuentas: conectado ? [{ id: '1', platform: 'instagram', fullname: 'Estudio Norte', username: 'estudio.norte' }] : [],
        error: null,
        plan: null,
      },
    });
  });
  await page.goto('/estudio/inicio/?blotato=conectar');
  const form = page.getByRole('dialog', { name: 'Conecta tu Blotato' });
  await expect(form).toBeVisible();
  await form.getByLabel('Tu clave de API de Blotato').fill('una-clave');
  await form.getByRole('button', { name: 'Conectar' }).click();
  const dlg = page.getByRole('dialog', { name: 'Tu Blotato' });
  return { dlg, listo: dlg.getByRole('status').filter({ hasText: 'Tu Blotato está conectado' }) };
}

test('inicio: la clave de Blotato recién guardada dibuja su palomita y el foco no sale del diálogo', async ({ page }) => {
  const { dlg, listo } = await blotato(page);
  await expect(listo).toBeVisible();
  await expect.poll(() => arrancaron(page)).toEqual(['trazo-se-dibuja 300', 'guardado-llega 250']);
  expect(await dlg.evaluate(d => d.contains(document.activeElement))).toBe(true);
  await expect.poll(() => faltaDelTrazo(listo.locator('path'))).toBe(0);
});

test.describe('con «reducir movimiento»', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('vitrina: no tiembla ni se dibuja; el error y «Guardado» salen igual', async ({ page }) => {
    const { campo, guardar, listo } = await vitrina(page);
    await guardar.click();
    await expect(page.getByText('Escribe el nombre de tu canal.')).toBeVisible();
    await expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(await campo.evaluate(c => c.getAnimations().length)).toBe(0);
    await campo.fill('Mi canal');
    await guardar.click();
    await expect(listo).toBeVisible();
    expect(await faltaDelTrazo(listo.locator('path'))).toBe(0);
    expect(await listo.getByText('Guardado').evaluate(t => getComputedStyle(t).opacity)).toBe('1');
    await page.getByRole('button', { name: 'Dibujar la palomita' }).click();
    await page.waitForTimeout(100);
    expect(await arrancaron(page)).toEqual([]);
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
  });

  test('agenda: no tiembla ni se dibuja; el error y «Hora cambiada» salen igual', async ({ page }) => {
    const { dlg, campo, guardar, ok } = await agenda(page);
    await campo.fill('2001-01-01T10:00');
    await guardar.click();
    await expect(dlg.getByText('Esa hora ya pasó: elige una más adelante.')).toBeVisible();
    await expect(campo).toHaveAttribute('aria-invalid', 'true');
    await campo.fill('2099-06-01T10:30');
    await guardar.click();
    await expect(ok).toBeVisible();
    expect(await faltaDelTrazo(ok.locator('path'))).toBe(0);
    expect(await arrancaron(page)).toEqual([]);
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
  });

  test('inicio: Blotato conectado, sin dibujar', async ({ page }) => {
    const { listo } = await blotato(page);
    await expect(listo).toBeVisible();
    expect(await faltaDelTrazo(listo.locator('path'))).toBe(0);
    expect(await arrancaron(page)).toEqual([]);
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
  });
});
