// La Biblioteca de prompts en un navegador de verdad (Ajustes 3, 16-oct-2026): lo que jsdom no ve y aquí sí —el diseño a 1100 y a 390 px,
// que no se arrastre de lado, que todo lo tocable mida 44 px y la letra no baje de 13, el aro de foco, un solo botón ámbar, el portapapeles
// de verdad, y el viaje completo de «Llevar a la caja» hasta el inicio real—, más axe sobre cada estado.
// El API es de mentira (e2e/biblioteca.ts): no gasta nada. PW_CAPTURAS=<carpeta> guarda una captura de cada estado para mirarla.
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import {
  abrir,
  ambito,
  anuncios,
  auditar,
  buscador,
  CASA,
  casillas,
  categoria,
  fila,
  filas,
  franja,
  interruptor,
  lista,
  MIOS,
  principales,
  simular,
  sobraAlLado,
  tituloDelDetalle,
} from './biblioteca';
import { riel, simular as simularInicio } from './recorrido';

const ANCHOS = [
  { ancho: 1100, alto: 800 },
  { ancho: 390, alto: 844 },
] as const;

const CAPTURAS = process.env.PW_CAPTURAS;
async function capturar(page: Page, nombre: string, ancho: number) {
  if (CAPTURAS) await page.screenshot({ path: join(CAPTURAS, `${nombre}-${ancho}.png`), fullPage: true });
}

// axe-core viene en el árbol de node_modules (lo trae eslint-plugin-jsx-a11y) pero no es una dependencia declarada de web/: si un día
// no estuviera, la prueba de axe se salta en vez de romper las demás
let axeFuente: string | null = null;
try {
  axeFuente = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
} catch {
  axeFuente = null;
}

/** Corre axe (WCAG 2.0, 2.1 y 2.2 A y AA, y las buenas prácticas) sobre lo que se ve ahora y devuelve lo que encontró, legible. */
async function axe(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: axeFuente! });
  return page.evaluate(async () => {
    // sin la píldora del saldo (#mon-real): la pone monedero.js, igual en todas las pantallas, y no es de esta
    const r = await (window as unknown as { axe: { run: (c: object, o: object) => Promise<{ violations: Array<{ id: string; help: string; nodes: Array<{ target: unknown[] }> }> }> } }).axe.run({ include: [['body']], exclude: [['#mon-real']] }, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    });
    return r.violations.map(v => `${v.id}: ${v.help} → ${v.nodes.map(n => n.target.join(' ')).join(' | ')}`);
  });
}

for (const { ancho, alto } of ANCHOS) {
  test.describe(`a ${ancho} px`, () => {
    test.use({ viewport: { width: ancho, height: alto } });

    test('reposo: los 14 prompts, el detalle del primero, un solo ámbar, nada se arrastra de lado, todo se toca y se lee', async ({ page }) => {
      await abrir(page);
      await expect(filas(page)).toHaveCount(14);
      await expect(fila(page, 'Retrato de estudio con luz suave')).toHaveAttribute('aria-current', 'true');
      await expect(tituloDelDetalle(page)).toHaveText('Retrato de estudio con luz suave');
      // en celular el paso 1 es solo la lista: ningún ámbar hasta que se elige uno
      expect(await principales(page)).toEqual(ancho < 960 ? [] : ['Llevar a la caja']);
      await auditar(page, `reposo a ${ancho}`);
      // «Irremplazables» arriba, fuera de toda tarjeta, y las migas debajo
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Irremplazables');
      await expect(page.getByRole('navigation', { name: 'Dónde estás' }).getByRole('link')).toHaveText(['Central', 'Distrito', 'Biblioteca de prompts']);
      // en un celular se ve UN paso: la lista; en escritorio, los dos paneles
      if (ancho < 960) {
        await expect(tituloDelDetalle(page)).toBeHidden();
        await expect(page.getByRole('group', { name: 'Pasos' })).toBeVisible();
      } else {
        await expect(tituloDelDetalle(page)).toBeVisible();
        await expect(page.getByRole('group', { name: 'Pasos' })).toBeHidden();
      }
      await capturar(page, 'reposo', ancho);
    });

    test('una sola parada de Tab en la lista, y el aro de foco se ve en cada parada', async ({ page }) => {
      await abrir(page);
      // lo que se alcanza con Tab, de arriba abajo, hasta salir de la lista: la lista cuenta UNA vez
      const paradas: string[] = [];
      let enLista = 0;
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Tab');
        const info = await page.evaluate(() => {
          const a = document.activeElement as HTMLElement;
          const cs = getComputedStyle(a);
          return {
            nombre: (a.getAttribute('aria-label') ?? a.textContent ?? '').trim().slice(0, 40),
            enLista: !!a.closest('ul[aria-label="Prompts de la Biblioteca"]'),
            aro: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2,
            padre: !!a.closest('[class*="has-focus-visible"]'),
          };
        });
        // el aro: el propio elemento, o el cuadro que lo envuelve (el buscador)
        expect(info.aro || info.padre, `sin aro de foco en «${info.nombre}»`).toBe(true);
        if (info.enLista) enLista += 1;
        paradas.push(info.nombre);
        if (info.nombre.startsWith('Ir a COI')) break;
      }
      expect(enLista).toBe(1);
      expect(paradas.at(-1)).toMatch(/^Ir a COI/);
      // el orden: las migas, el conmutador, el buscador, las categorías, UNA parada en la lista y el enlace a COI
      const en = (re: RegExp) => paradas.findIndex(p => re.test(p));
      expect(en(/^Ir al mapa/)).toBe(0);
      expect(en(/^De la casa/)).toBeGreaterThan(en(/^Ir a las opciones/));
      expect(en(/^Míos/)).toBe(en(/^De la casa/) + 1);
      expect(en(/^Buscar un prompt/)).toBeGreaterThan(en(/^Míos/));
      expect(en(/^Todos/)).toBeGreaterThan(en(/^Buscar un prompt/));
      expect(en(/^Retrato de estudio/)).toBeGreaterThan(en(/^Investigación/));
      expect(en(/^Ir a COI/)).toBe(en(/^Retrato de estudio/) + 1);
    });

    test('buscar sin acentos ni mayúsculas, filtrar por categoría y quitar los filtros', async ({ page }) => {
      await abrir(page);
      await buscador(page).fill('ILUSTRACION');
      await expect(filas(page)).toHaveText([/^Ilustración plana para explicar una idea/]);
      await expect(page.getByText('1 resultado para «ILUSTRACION»')).toBeVisible();
      await buscador(page).fill('zapatos de baile');
      await expect(lista(page)).toHaveCount(0);
      if (ancho < 960) {
        // en celular se ve el paso 1: lo dice la lista y ofrece COI abajo (el panel grande es el paso 2)
        await expect(page.getByText('Nada coincide con lo que buscas.')).toBeVisible();
        await expect(page.getByRole('link', { name: /Ir a COI/ }).first()).toBeVisible();
        expect(await principales(page)).toEqual([]);
      } else {
        await expect(page.getByRole('heading', { name: 'No encontramos ese prompt' })).toBeVisible();
        expect(await principales(page)).toEqual(['Diseñar uno con COI']);
      }
      await auditar(page, `sin resultados a ${ancho}`);
      await capturar(page, 'sin-resultados', ancho);
      await page.getByRole('button', { name: 'Quitar filtros' }).first().click();
      await expect(filas(page)).toHaveCount(14);
      await categoria(page, 'Video').click();
      await expect(filas(page)).toHaveCount(3);
      await expect(categoria(page, 'Video')).toHaveAttribute('aria-pressed', 'true');
      await capturar(page, 'categoria', ancho);
    });

    test('copiar usa el portapapeles de verdad, confirma sin mover el foco y se anuncia', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await abrir(page);
      if (ancho < 960) await fila(page, 'Retrato de estudio con luz suave').click();
      const copiar = page.getByRole('button', { name: /^Copiar el prompt/ });
      await copiar.focus();
      await copiar.click();
      await expect(page.getByRole('button', { name: 'Copiado: Retrato de estudio con luz suave' })).toBeFocused();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CASA[0]!.prompt);
      await expect(anuncios(page)).toHaveText(/Copiado: Retrato de estudio con luz suave\./);
      await auditar(page, `copiado a ${ancho}`);
      await capturar(page, 'copiado', ancho);
    });

    test('fijar: hasta 3 sin sustituir en silencio, el orden con el teclado, quitar, y todo sobrevive a recargar', async ({ page }) => {
      const llamadas = await abrir(page);
      const ir = async (titulo: string) => {
        await fila(page, titulo).click();
        if (ancho < 960) await expect(tituloDelDetalle(page)).toBeFocused();
      };
      const volver = async () => {
        if (ancho < 960) await page.getByRole('button', { name: 'Volver a la lista' }).click();
      };
      // franja vacía: tres casillas que dicen cómo llenarse
      await expect(casillas(page)).toHaveCount(3);
      await expect(franja(page)).toContainText('Fija aquí un prompt que quieras recordar');
      for (const t of ['Retrato de estudio con luz suave', 'Café con vapor en cámara lenta', 'Guion de 30 segundos para un producto']) {
        await ir(t);
        const pin = interruptor(page);
        await expect(pin).toHaveAttribute('aria-pressed', 'false');
        await pin.click();
        await expect(pin).toHaveAttribute('aria-pressed', 'true');
        await volver();
      }
      await expect.poll(() => llamadas.puts.at(-1)).toEqual(['casa-retrato', 'casa-cafe', 'casa-guion30']);
      // el cuarto NO sustituye a nadie: avisa, no pide nada y el foco se queda en el botón
      await ir('Paisaje al amanecer en acuarela');
      const pin = interruptor(page);
      await pin.focus();
      await pin.click();
      await expect(page.getByText('Ya tienes 3 fijados. Quita uno para fijar este.')).toBeVisible();
      await expect(pin).toBeFocused();
      await expect(pin).toHaveAttribute('aria-pressed', 'false');
      expect(llamadas.puts).toHaveLength(3);
      expect(await principales(page)).toEqual(['Llevar a la caja']);
      await capturar(page, 'tope', ancho);
      await auditar(page, `tope a ${ancho}`);
      await volver();
      // el orden, con el teclado: subir el 2.º; el foco sigue en el mismo botón aunque su casilla cambió de lugar
      const subir = franja(page).getByRole('button', { name: 'Subir «Café con vapor en cámara lenta»' });
      await subir.focus();
      await page.keyboard.press('Enter');
      await expect(subir).toBeFocused();
      await expect(casillas(page).nth(0)).toContainText('Café con vapor en cámara lenta');
      await expect.poll(() => llamadas.puts.at(-1)).toEqual(['casa-cafe', 'casa-retrato', 'casa-guion30']);
      // el primero ya no sube: apagado pero enfocable
      await expect(subir).toHaveAttribute('aria-disabled', 'true');
      await page.keyboard.press('Enter');
      expect(llamadas.puts).toHaveLength(4);
      // recargar: el servidor manda el orden y la pantalla lo respeta
      await page.reload();
      await expect(casillas(page).nth(0)).toContainText('Café con vapor en cámara lenta');
      await expect(casillas(page).nth(1)).toContainText('Retrato de estudio con luz suave');
      await expect(casillas(page).nth(2)).toContainText('Guion de 30 segundos para un producto');
      await expect(fila(page, 'Retrato de estudio con luz suave').getByText('Fijado')).toBeAttached();
      await capturar(page, 'fijados', ancho);
      await auditar(page, `fijados a ${ancho}`);
      // quitar uno desde su casilla
      await franja(page).getByRole('button', { name: 'Quitar «Retrato de estudio con luz suave» de fijados' }).click();
      await expect(casillas(page).nth(2)).toContainText('Fija aquí un prompt que quieras recordar');
      await expect.poll(() => llamadas.puts.at(-1)).toEqual(['casa-cafe', 'casa-guion30']);
      // el foco no cae a <body>
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
    });

    test('fijar es optimista: se ve al instante y, si el servidor falla, vuelve atrás y lo dice', async ({ page }) => {
      await abrir(page, { guardado: { falla: true, demora: 400 } });
      if (ancho < 960) await fila(page, 'Retrato de estudio con luz suave').click();
      await interruptor(page).click();
      // al instante (el servidor tarda 400 ms): ya está fijado
      await expect(interruptor(page)).toHaveAttribute('aria-pressed', 'true');
      if (ancho >= 960) await expect(casillas(page).nth(0)).toContainText('Retrato de estudio con luz suave');
      // y luego vuelve atrás
      await expect(interruptor(page)).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByRole('alert')).toContainText('No se pudo guardar tus fijados ahora. Tus fijados quedaron como estaban.');
      if (ancho >= 960) await expect(casillas(page).nth(0)).toContainText('Fija aquí un prompt que quieras recordar');
      await capturar(page, 'fijar-fallo', ancho);
    });

    test('«Míos»: conmutador, vacío con enlace a COI, y borrar uno con confirmación (también de los fijados)', async ({ page }) => {
      const sin = await abrir(page, { mios: [] });
      await ambito(page, 'Míos').click();
      await expect(page.getByText('Todavía no guardas ninguno. Arma uno con COI y pulsa «Guardar».')).toBeVisible();
      await expect(page.getByRole('link', { name: /Ir a COI/ }).first()).toHaveAttribute('href', '/estudio/coi/');
      await expect(page.getByRole('link', { name: /Ir a COI/ }).first()).toBeVisible();
      await auditar(page, `Míos vacío a ${ancho}`);
      await capturar(page, 'mios-vacio', ancho);
      expect(sin.borrados).toEqual([]);
    });

    test('«Míos» con prompts: se fijan, se borran con confirmación y desaparecen de la franja', async ({ page }) => {
      const llamadas = await abrir(page, { mios: MIOS, fijados: ['mio-0123456789ab', 'casa-retrato'] });
      await ambito(page, 'Míos').click();
      await expect(filas(page)).toHaveCount(2);
      await capturar(page, 'mios', ancho);
      if (ancho < 960) await fila(page, 'Guion para el reel de la semana').click();
      await page.getByRole('button', { name: 'Borrar «Guion para el reel de la semana»' }).click();
      const dialogo = page.getByRole('alertdialog', { name: '¿Borrar este prompt?' });
      await expect(dialogo).toBeVisible();
      await capturar(page, 'borrar', ancho);
      await dialogo.getByRole('button', { name: 'Cancelar' }).click();
      expect(llamadas.borrados).toEqual([]);
      await page.getByRole('button', { name: 'Borrar «Guion para el reel de la semana»' }).click();
      await dialogo.getByRole('button', { name: 'Borrar' }).click();
      await expect.poll(() => llamadas.borrados).toEqual(['mio-0123456789ab']);
      await expect(casillas(page).nth(0)).toContainText('Retrato de estudio con luz suave');
      await expect(casillas(page).nth(1)).toContainText('Fija aquí un prompt que quieras recordar');
      // lo borrado no se pidió como fijado de nuevo: el servidor ya lo había quitado
      expect(llamadas.puts).toEqual([]);
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
    });

    test('error al cargar con «Reintentar», y el cargando no se queda colgado', async ({ page }) => {
      const llamadas = await simular(page, { carga: { falla: 'una-vez' } });
      await page.goto('/estudio/biblioteca/');
      await expect(page.getByRole('alert')).toContainText('No pudimos cargar la Biblioteca');
      expect(await principales(page)).toEqual(['Reintentar']);
      await auditar(page, `error a ${ancho}`);
      await capturar(page, 'error', ancho);
      await page.getByRole('button', { name: 'Reintentar' }).click();
      await expect(filas(page)).toHaveCount(14);
      expect(llamadas.cargas).toBe(2);
    });

    test('cargando: el esqueleto se dice y no se arrastra de lado', async ({ page }) => {
      await simular(page, { carga: { demora: 1500 } });
      await page.goto('/estudio/biblioteca/');
      await expect(page.getByText('Cargando la Biblioteca…')).toBeVisible();
      expect(await sobraAlLado(page)).toBeLessThanOrEqual(0);
      await capturar(page, 'cargando', ancho);
      await expect(filas(page)).toHaveCount(14);
    });
  });
}

test.describe('axe, estado por estado', () => {
  test.skip(axeFuente === null, 'axe-core no está en node_modules');
  for (const { ancho, alto } of ANCHOS) {
    test.describe(`a ${ancho} px`, () => {
      test.use({ viewport: { width: ancho, height: alto } });

      test('reposo, con fijados y con el tope avisado', async ({ page }) => {
        await abrir(page, { fijados: ['casa-retrato', 'casa-cafe', 'casa-guion30'] });
        expect(await axe(page), 'reposo con 3 fijados').toEqual([]);
        await fila(page, 'Paisaje al amanecer en acuarela').click();
        await interruptor(page).click();
        await expect(page.getByText('Ya tienes 3 fijados. Quita uno para fijar este.')).toBeVisible();
        expect(await axe(page), 'tope avisado').toEqual([]);
      });

      test('sin resultados, «Míos» vacío, «Míos» con prompts y el diálogo de borrar', async ({ page }) => {
        await abrir(page, { mios: MIOS });
        await buscador(page).fill('zapatos de baile');
        await expect(page.getByText('Nada coincide con lo que buscas.')).toBeVisible();
        if (ancho >= 960) await expect(page.getByRole('heading', { name: 'No encontramos ese prompt' })).toBeVisible();
        expect(await axe(page), 'sin resultados').toEqual([]);
        await buscador(page).fill('');
        await ambito(page, 'Míos').click();
        expect(await axe(page), 'míos con prompts').toEqual([]);
        if (ancho < 960) await fila(page, 'Guion para el reel de la semana').click();
        await page.getByRole('button', { name: 'Borrar «Guion para el reel de la semana»' }).click();
        await expect(page.getByRole('alertdialog')).toBeVisible();
        expect(await axe(page), 'diálogo de borrar').toEqual([]);
      });

      test('«Míos» vacío, error y cargando', async ({ page }) => {
        await abrir(page, { mios: [] });
        await ambito(page, 'Míos').click();
        expect(await axe(page), 'míos vacío').toEqual([]);
        await page.unroute('**/api/biblioteca/fijados');
        const error = await page.context().newPage();
        await simular(error, { carga: { falla: 'servidor' } });
        await error.setViewportSize({ width: ancho, height: alto });
        await error.goto('/estudio/biblioteca/');
        await expect(error.getByRole('alert')).toBeVisible();
        expect(await axe(error), 'error').toEqual([]);
        const cargando = await page.context().newPage();
        await simular(cargando, { carga: { demora: 4000 } });
        await cargando.setViewportSize({ width: ancho, height: alto });
        await cargando.goto('/estudio/biblioteca/');
        await expect(cargando.getByText('Cargando la Biblioteca…')).toBeVisible();
        expect(await axe(cargando), 'cargando').toEqual([]);
      });
    });
  }
});

test.describe('en celular, dos pasos', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('elegir pasa a «Úsalo» con el foco en el título; «Volver a la lista» regresa a la fila; los pasos también se pulsan', async ({ page }) => {
    await abrir(page);
    const pasos = page.getByRole('group', { name: 'Pasos' });
    await expect(pasos.getByRole('button', { name: /Elige/ })).toHaveAttribute('aria-current', 'step');
    await fila(page, 'Café con vapor en cámara lenta').click();
    await expect(pasos.getByRole('button', { name: /Úsalo/ })).toHaveAttribute('aria-current', 'step');
    await expect(tituloDelDetalle(page)).toBeFocused();
    await expect(tituloDelDetalle(page)).toHaveText('Café con vapor en cámara lenta');
    await expect(lista(page)).toBeHidden();
    await auditar(page, 'paso 2 a 390');
    await capturar(page, 'paso2', 390);
    await page.getByRole('button', { name: 'Volver a la lista' }).click();
    await expect(fila(page, 'Café con vapor en cámara lenta')).toBeFocused();
    await expect(tituloDelDetalle(page)).toBeHidden();
    await pasos.getByRole('button', { name: /Úsalo/ }).click();
    await expect(tituloDelDetalle(page)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// «Llevar a la caja»: el viaje completo, con el inicio de verdad

test.describe('llevar a la caja', () => {
  for (const { ancho, alto } of ANCHOS) {
    test.describe(`a ${ancho} px`, () => {
      test.use({ viewport: { width: ancho, height: alto } });

      test('Imagen: de la Biblioteca al inicio con la caja abierta en Imagen, el texto puesto, el aviso dicho y la dirección limpia', async ({ page }) => {
        await simularInicio(page);
        await abrir(page);
        await fila(page, 'Producto flotando sobre un color').click();
        const llevar = page.getByRole('link', { name: 'Llevar a la caja' });
        const prompt = CASA[1]!.prompt;
        await expect(llevar).toHaveAttribute('href', '/estudio/inicio/?prompt=' + encodeURIComponent(prompt));
        await llevar.click();
        await expect(page).toHaveURL(/\/estudio\/inicio\/$/);
        // la caja abierta DIRECTO, en Imagen, con el texto puesto y el foco en su cuadro
        const caja = page.getByRole('textbox', { name: '¿Qué vamos a crear hoy?' });
        await expect(caja).toBeVisible();
        await expect(caja).toHaveValue(prompt);
        await expect(caja).toBeFocused();
        await expect(riel(page, 'Imagen')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByText('Te trajimos el prompt. Cambia lo que va entre [corchetes] y pulsa Crear.')).toBeVisible();
        expect(await sobraAlLado(page)).toBeLessThanOrEqual(0);
        await capturar(page, 'llegada-imagen', ancho);
        // llegar no crea ni cobra nada, y recargar NO vuelve a llenar la caja: el mapa de siempre
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Elige un área' })).toBeVisible();
        await expect(page.locator('textarea')).toHaveValue('');
      });

      test('Video: ?brief= abre la caja en Video con el texto puesto', async ({ page }) => {
        await simularInicio(page);
        await abrir(page);
        await fila(page, 'Café con vapor en cámara lenta').click();
        await page.getByRole('link', { name: 'Llevar a la caja' }).click();
        const caja = page.getByRole('textbox', { name: '¿Qué vamos a crear hoy?' });
        await expect(caja).toHaveValue(CASA[4]!.prompt);
        await expect(riel(page, 'Video')).toHaveAttribute('aria-pressed', 'true');
        await expect(page).toHaveURL(/\/estudio\/inicio\/$/);
        // sin huecos en el prompt: el aviso no manda cambiar lo que va entre corchetes
        await expect(page.getByText('Te trajimos el prompt. Revísalo y pulsa Crear.')).toBeVisible();
        await capturar(page, 'llegada-video', ancho);
      });
    });
  }

  test('sin parámetros el inicio abre en el mapa, igual que siempre', async ({ page }) => {
    await simularInicio(page);
    await page.goto('/estudio/inicio/');
    await expect(page.getByRole('heading', { name: 'Elige un área' })).toBeVisible();
    await expect(page.getByText(/Te trajimos el prompt/)).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: '¿Qué vamos a crear hoy?' })).toBeHidden();
  });

  test('«Central › Distrito › Biblioteca de prompts» está en el inicio y lleva a la pantalla; sus migas vuelven al mapa y a las opciones', async ({ page }) => {
    await simularInicio(page);
    await simular(page);
    await page.goto('/estudio/inicio/');
    await page.getByRole('group', { name: 'Áreas', exact: true }).getByRole('button', { name: /^Central/ }).click();
    await page.getByRole('group', { name: 'Central', exact: true }).getByRole('button', { name: /^Distrito/ }).click();
    const entrada = page.getByRole('link', { name: /^Biblioteca de prompts/ });
    await expect(entrada).toHaveAttribute('href', '/estudio/biblioteca/');
    await entrada.click();
    await expect(page.getByRole('heading', { level: 2, name: 'Biblioteca de prompts' })).toBeVisible();
    // «Distrito» vuelve a las opciones de Central, con «Volver a Biblioteca de prompts»; «Central» al mapa
    await page.getByRole('navigation', { name: 'Dónde estás' }).getByRole('link', { name: /^Ir a las opciones de Central/ }).click();
    await expect(page.getByRole('heading', { name: 'Elige un grupo' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Volver a Biblioteca de prompts' })).toHaveAttribute('href', '/estudio/biblioteca/');
    await expect(page).toHaveURL(/\/estudio\/inicio\/$/);
  });
});
