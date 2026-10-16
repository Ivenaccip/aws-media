// COI (/estudio/coi/) en un navegador de verdad, a 1100, 390 y 320 px, con la API simulada (`page.route`): el servidor de COI lo construye
// otro rol y aquí NO se llama al modelo ni a la moderación (no cuesta nada). Mide lo que jsdom no ve: que no haya desborde horizontal,
// que lo que se toca mida 44 px o más, que ningún texto baje de 13 px, axe sin violaciones, el foco (nunca cae al body al cambiar
// de estado), el portapapeles real, y que lo que la persona escribe no quede en el almacenamiento del navegador.
//
// Capturas: con COI_CAPTURAS=<carpeta> cada estado se guarda como PNG (para mirarlas). Sin la variable no se guarda nada.
import { readFileSync } from 'node:fs';

import { expect, test, type Page, type Route } from '@playwright/test';

import { animacionesVivas } from './pantallas';

const AXE = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const CAPTURAS = process.env.COI_CAPTURAS;

// ---------------------------------------------------------------------------
// La API de mentira, con la forma del contrato

const COI_DE_MUESTRA = {
  contexto:
    'Necesito un guion para presentar un producto en video, de 30 segundos, para redes sociales. Lo dirá una sola persona frente a la cámara.\n' +
    'Suposición: no dijiste cuál es el producto; uso [PRODUCTO] para que lo cambies por el tuyo.',
  objetivo:
    'Escribir un guion de unas 75 palabras, que se lea en 30 segundos, y que haga que quien lo vea entienda qué es el producto y qué hacer después.',
  instrucciones: [
    '1. Definición del objetivo primario',
    '   * Actúa como guionista de videos cortos para redes sociales.',
    '2. Datos iniciales',
    '   * Nombre del producto, para quién es y la acción que quieres que haga quien lo vea.',
    '3. Estrategia de búsqueda/acción',
    '   * Empieza con un gancho de una frase y cierra con una invitación a actuar.',
    '4. Criterios de validación',
    '   * Máximo 80 palabras y un gancho de menos de 5 segundos.',
    '5. Reglas de desambiguación',
    '   * Si hay dos formas de decir algo, elige la más corta.',
    '6. Formato de salida',
    '   * Dos columnas: «Lo que se dice» y «Lo que se ve».',
    '7. Restricciones',
    '   * Sin promesas exageradas y sin inventar datos del producto.',
  ].join('\n'),
};
const COMPLETO = `#CONTEXTO\n${COI_DE_MUESTRA.contexto}\n#OBJETIVO\n${COI_DE_MUESTRA.objetivo}\n#INSTRUCCIONES\n${COI_DE_MUESTRA.instrucciones}`;

const RENUEVA_EN_S = 19200; // 5 h 20 min
const SE_RENUEVA = '2026-10-17T00:00:00-06:00';
const TEXTO_DE_LA_PERSONA = 'Necesito un guion para presentar mi lampara de escritorio en 30 segundos';

interface Respuesta {
  status: number;
  body: unknown;
  /** Si lleva una promesa, la respuesta espera a que se cumpla (para mirar «Armando tu COI…»). */
  espera?: Promise<void>;
}

interface Sim {
  usos: number;
  enCurso: boolean;
  /** Los segundos que dice el servidor hasta la renovación. */
  renueva: number;
  /** Estado de la lectura del contador: 200 si sale bien; otro número, la falla. */
  estado: number;
  /** Las respuestas de POST /api/coi, en orden; si no quedan, sale un COI bien. */
  armar: Respuesta[];
  guardar: Respuesta[];
  pedidos: { armar: Array<{ texto: string }>; guardar: Array<Record<string, unknown>> };
}

const json = (route: Route, r: Respuesta) =>
  route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });

const estadoDe = (sim: Sim) => ({
  tope: 3,
  usos: sim.usos,
  quedan: Math.max(0, 3 - sim.usos),
  renueva_en_s: sim.renueva,
  se_renueva: SE_RENUEVA,
  en_curso: sim.enCurso,
  gratis: true,
});

const coiOk = (sim: Sim): Respuesta => ({
  status: 200,
  body: {
    coi: { ...COI_DE_MUESTRA, completo: COMPLETO, estructura_ok: true },
    idioma: 'es',
    tope: 3,
    usos: sim.usos,
    quedan: Math.max(0, 3 - sim.usos),
    renueva_en_s: RENUEVA_EN_S,
    se_renueva: SE_RENUEVA,
  },
});

const detalle = (status: number, codigo: string, texto: string, extra: Record<string, unknown> = {}): Respuesta => ({
  status,
  body: { detail: { codigo, texto, ...extra } },
});

async function simular(page: Page, parcial: Partial<Sim> = {}): Promise<Sim> {
  const sim: Sim = {
    usos: 0,
    enCurso: false,
    renueva: RENUEVA_EN_S,
    estado: 200,
    armar: [],
    guardar: [],
    pedidos: { armar: [], guardar: [] },
    ...parcial,
  };
  await page.route('**/api/coi/estado', route =>
    sim.estado === 200
      ? json(route, { status: 200, body: estadoDe(sim) })
      : json(route, detalle(sim.estado, 'no_disponible', 'COI no está disponible en este momento.')),
  );
  await page.route('**/api/coi', async route => {
    sim.pedidos.armar.push(route.request().postDataJSON() as { texto: string });
    const siguiente = sim.armar.shift();
    if (siguiente?.espera) await siguiente.espera;
    if (siguiente) {
      if (siguiente.status === 200) sim.usos += 1;
      return json(route, siguiente.status === 200 ? { ...siguiente, body: { ...(siguiente.body as object), usos: sim.usos, quedan: 3 - sim.usos } } : siguiente);
    }
    sim.usos += 1;
    return json(route, coiOk(sim));
  });
  await page.route('**/api/biblioteca/mios', async route => {
    sim.pedidos.guardar.push(route.request().postDataJSON() as Record<string, unknown>);
    const siguiente = sim.guardar.shift();
    if (siguiente?.espera) await siguiente.espera;
    if (siguiente) return json(route, siguiente);
    const p = sim.pedidos.guardar.at(-1)!;
    return json(route, {
      status: 201,
      body: { prompt: { id: 'mio-0123456789ab', titulo: p.titulo, para_que: '', prompt: p.prompt, categoria: p.categoria, etiquetas: [], origen: 'coi', creado: '2026-10-16T18:20:00Z', lleva_a: null } },
    });
  });
  return sim;
}

const abrir = async (page: Page) => {
  await page.goto('/estudio/coi/');
  await expect(page.getByRole('heading', { name: 'Diseña un prompt con COI' })).toBeVisible();
};

const cuadro = (page: Page) => page.getByRole('textbox', { name: 'Cuéntale qué necesitas' });
const armar = (page: Page) => page.getByRole('button', { name: /^Armar (otro )?COI$|^Armando…$/ });
const contador = (page: Page) => page.locator('#coi-cont');

// ---------------------------------------------------------------------------
// Lo que se mide en cada estado

async function medir(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const visible = (e: Element) => {
      const r = e.getBoundingClientRect();
      const c = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none';
    };
    // el texto que solo leen los lectores de pantalla (`sr-only`, también el de `max-[360px]:sr-only`) mide 1 px: no se ve
    const oculto = (e: Element) => {
      const r = e.getBoundingClientRect();
      return r.width <= 1 || r.height <= 1;
    };
    const fuera: string[] = [];
    const finos: string[] = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let minFont = 99;
    while (tw.nextNode()) {
      const n = tw.currentNode;
      const t = (n.textContent ?? '').trim();
      const p = n.parentElement;
      // #monedero es la píldora del saldo (static/monedero.js): de todas las pantallas, no de COI
      if (!t || !p || !visible(p) || oculto(p) || p.closest('.sr-only,[hidden],script,style,#monedero,#mon-panel')) continue;
      const rango = document.createRange();
      rango.selectNodeContents(n);
      const rr = rango.getBoundingClientRect();
      if (rr.width === 0) continue;
      const fs = parseFloat(getComputedStyle(p).fontSize);
      minFont = Math.min(minFont, fs);
      if (fs < 13) finos.push(`${t.slice(0, 30)} (${fs}px)`);
      if (rr.left < -0.5 || rr.right > vw + 0.5) fuera.push(`${t.slice(0, 30)} se sale de la ventana`);
      // un texto que se sale de su propia tarjeta
      const caja = p.closest('article, [role="alert"], [role="status"], .rounded-boton, .rounded-grande, button, a');
      if (caja && visible(caja)) {
        const rc = caja.getBoundingClientRect();
        if (rr.left < rc.left - 0.5 || rr.right > rc.right + 0.5) fuera.push(`${t.slice(0, 30)} se sale de su caja`);
      }
    }
    const chicos: string[] = [];
    for (const e of document.querySelectorAll('button, a[href], input:not([type=hidden]), textarea, select, [tabindex="0"]')) {
      if (!visible(e) || e.closest('[hidden],[inert],#monedero,#mon-panel') || e.matches('.sr-only')) continue;
      const r = e.getBoundingClientRect();
      if (r.height < 43.5 || r.width < 43.5) {
        const nombre = (e.getAttribute('aria-label') ?? (e as HTMLElement).innerText ?? e.tagName).trim().replace(/\s+/g, ' ').slice(0, 30);
        chicos.push(`${nombre} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return {
      vw,
      scrollW: document.documentElement.scrollWidth,
      alto: document.documentElement.scrollHeight,
      minFont,
      finos,
      fuera,
      chicos,
      h1: [...document.querySelectorAll('h1')].filter(visible).length,
    };
  });
}

async function axe(page: Page) {
  await page.evaluate(AXE);
  return page.evaluate(async () => {
    const run = (window as unknown as { axe: { run: (c: object, o: object) => Promise<{ violations: Array<{ id: string; nodes: Array<{ target: unknown[] }> }> }> } }).axe;
    // la píldora del saldo (monedero.js) es de todas las pantallas, no de COI
    const r = await run.run({ include: [['body']], exclude: [['#monedero'], ['#mon-panel']] }, { resultTypes: ['violations'] });
    return r.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  });
}

/** Mide, pasa axe y comprueba que el foco no esté en el body. `nombre` es el de la captura. */
async function revisar(page: Page, nombre: string, opciones: { foco?: boolean } = {}) {
  const m = await medir(page);
  expect(m.scrollW, `${nombre}: desborde horizontal`).toBeLessThanOrEqual(m.vw);
  expect(m.fuera, `${nombre}: textos fuera de su caja`).toEqual([]);
  expect(m.finos, `${nombre}: letra menor de 13 px`).toEqual([]);
  expect(m.chicos, `${nombre}: objetivos menores de 44 px`).toEqual([]);
  expect(m.h1, `${nombre}: un solo h1`).toBe(1);
  expect(await axe(page), `${nombre}: axe`).toEqual([]);
  if (opciones.foco !== false) {
    const enBody = await page.evaluate(() => document.activeElement === document.body || document.activeElement === null);
    expect(enBody, `${nombre}: el foco cayó al body`).toBe(false);
  }
  if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/${nombre}-${m.vw}.png`, fullPage: true });
}

// 1100 (escritorio), 390 (celular) y 320 (el celular más angosto que se mide en el repo)
for (const [ancho, alto] of [
  [1100, 900],
  [390, 844],
  [320, 700],
] as const) {
  test.describe(`COI a ${ancho} px`, () => {
    test.use({ viewport: { width: ancho, height: alto } });

    test('reposo: cuadro grande, contador del servidor, un solo botón ámbar, ejemplos, privacidad y enlace a la Biblioteca', async ({ page }) => {
      await simular(page);
      await abrir(page);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Irremplazables');
      await expect(page.getByRole('navigation', { name: 'Dónde estás' }).locator('li')).toContainText(['Central', 'Distrito', 'COI']);
      await expect(contador(page)).toHaveText('Te quedan 3 de 3 hoy');
      await expect(page.getByText('Gratis por ahora. Solo cuentan los COI que terminan bien.')).toBeVisible();
      await expect(armar(page)).toHaveText('Armar COI');
      await expect(armar(page)).not.toHaveAttribute('aria-disabled', 'true');
      await expect(page.getByRole('list', { name: 'Ejemplos para empezar' }).getByRole('button')).toHaveCount(4);
      await expect(
        page.getByText('No guardamos lo que escribes ni lo que te responde. Solo se guarda el COI que tú decidas guardar, y solo en tu Biblioteca.'),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: 'Mira la Biblioteca de prompts' })).toHaveAttribute('href', '/estudio/biblioteca/');
      // un solo botón ámbar: el principal lo lleva solo «Armar COI»
      const ambar = await page.locator('button').evaluateAll(bs => bs.filter(b => getComputedStyle(b).backgroundColor === 'rgb(218, 140, 40)').map(b => b.textContent));
      expect(ambar).toEqual(['Armar COI']);
      // el cuadro mide de verdad «grande»
      const caja = await cuadro(page).boundingBox();
      expect(caja!.height).toBeGreaterThanOrEqual(120);
      await cuadro(page).focus();
      await revisar(page, 'coi-reposo');
    });

    test('un ejemplo llena el cuadro y el foco se queda en él; escribir esconde los ejemplos', async ({ page }) => {
      await simular(page);
      await abrir(page);
      await page.getByRole('button', { name: 'Ideas de imágenes para una campaña de verano' }).click();
      await expect(cuadro(page)).toHaveValue('Ideas de imágenes para una campaña de verano');
      await expect(cuadro(page)).toBeFocused();
      await expect(page.getByText('Ejemplos para empezar')).toHaveCount(0);
      await revisar(page, 'coi-escribiendo');
    });

    test('armar: «Armando tu COI…» sin pasos falsos, luego tres tarjetas, el contador baja y el foco va al resultado', async ({ page }) => {
      let soltar!: () => void;
      const sim = await simular(page, { armar: [{ ...coiOk({ usos: 1 } as Sim), espera: new Promise<void>(r => (soltar = r)) }] });
      await abrir(page);
      await cuadro(page).fill(`  ${TEXTO_DE_LA_PERSONA}  `);
      await armar(page).click();
      // generando: el botón dice «Armando…», no cobra ninguno todavía y el foco sigue en el botón
      await expect(page.getByRole('heading', { name: 'Armando tu COI…' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Armando…' })).toHaveAttribute('aria-busy', 'true');
      await expect(contador(page)).toHaveText('Te quedan 3 de 3 hoy');
      await expect(page.getByRole('button', { name: 'Armando…' })).toBeFocused();
      await expect(cuadro(page)).toHaveAttribute('readonly', '');
      await revisar(page, 'coi-generando');
      // un segundo clic mientras trabaja no manda otra petición
      await page.getByRole('button', { name: 'Armando…' }).click({ force: true });
      soltar();
      await expect(page.getByRole('heading', { name: 'Tu COI' })).toBeFocused();
      expect(sim.pedidos.armar).toEqual([{ texto: TEXTO_DE_LA_PERSONA }]); // recortado, y una sola vez
      await expect(contador(page)).toHaveText('Te quedan 2 de 3 hoy');
      for (const titulo of ['#CONTEXTO', '#OBJETIVO', '#INSTRUCCIONES']) await expect(page.getByRole('button', { name: new RegExp(`^${titulo}`) })).toHaveAttribute('aria-expanded', 'true');
      // las siete partes de #INSTRUCCIONES, numeradas
      await expect(page.locator('[data-bloque="ins"] ol > li')).toHaveCount(7);
      await expect(page.getByText('Suposición', { exact: true })).toBeVisible();
      await expect(armar(page)).toHaveText('Armar otro COI');
      await revisar(page, 'coi-resultado');
    });

    test('plegar todo, abrir todo y plegar uno; los bloques plegados no se leen', async ({ page }) => {
      await simular(page);
      await abrir(page);
      await cuadro(page).fill(TEXTO_DE_LA_PERSONA);
      await armar(page).click();
      await expect(page.getByRole('heading', { name: 'Tu COI' })).toBeFocused();
      await page.getByRole('button', { name: 'Plegar todo' }).click();
      for (const c of ['ctx', 'obj', 'ins']) await expect(page.locator(`#coi-bq-${c}`)).toBeHidden();
      await expect(page.getByRole('button', { name: 'Abrir todo' })).toBeFocused();
      await page.getByRole('button', { name: /^#OBJETIVO/ }).click();
      await expect(page.locator('#coi-bq-obj')).toBeVisible();
      await expect(page.locator('#coi-bq-ctx')).toBeHidden();
      await page.getByRole('button', { name: 'Abrir todo' }).click();
      await expect(page.getByRole('button', { name: 'Plegar todo' })).toBeVisible();
      await revisar(page, 'coi-plegado');
    });

    test('copiar: por bloque y todo, con el portapapeles de verdad, sin mover el foco', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await simular(page);
      await abrir(page);
      await cuadro(page).fill(TEXTO_DE_LA_PERSONA);
      await armar(page).click();
      await expect(page.getByRole('heading', { name: 'Tu COI' })).toBeFocused();
      const copiarObj = page.getByRole('button', { name: 'Copiar el bloque #OBJETIVO' });
      await copiarObj.click();
      await expect(page.getByRole('button', { name: 'Copiado: el bloque #OBJETIVO' })).toBeFocused();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`#OBJETIVO\n${COI_DE_MUESTRA.objetivo}`);
      await page.getByRole('button', { name: 'Copiar todo el COI' }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        `#CONTEXTO\n${COI_DE_MUESTRA.contexto}\n\n#OBJETIVO\n${COI_DE_MUESTRA.objetivo}\n\n#INSTRUCCIONES\n${COI_DE_MUESTRA.instrucciones}`,
      );
      await expect(page.getByRole('button', { name: 'Copiado: todo el COI' })).toBeFocused();
      // la confirmación vuelve sola
      await expect(page.getByRole('button', { name: 'Copiar todo el COI' })).toBeVisible({ timeout: 5000 });
    });

    test('guardar: hoja chica con título prefijado y editable, categoría, y «Guardado en tu Biblioteca» con enlace a Míos', async ({ page }) => {
      const sim = await simular(page);
      await abrir(page);
      await cuadro(page).fill(TEXTO_DE_LA_PERSONA);
      await armar(page).click();
      await expect(page.getByRole('heading', { name: 'Tu COI' })).toBeFocused();
      await page.getByRole('button', { name: 'Guardar', exact: true }).click();
      const hoja = page.getByRole('dialog', { name: 'Guardar en tu Biblioteca' });
      await expect(hoja).toBeVisible();
      await expect(hoja.getByLabel('Título')).toHaveValue('Escribir un guion de unas 75 palabras, que se lea en 30 segundos, y que haga…');
      await expect(hoja.getByLabel('Título')).toBeFocused();
      expect((await hoja.getByLabel('Título').inputValue()).length).toBeLessThanOrEqual(80);
      await expect(hoja.getByRole('radio', { name: 'Guion y texto' })).toBeChecked();
      await hoja.getByLabel('Título').fill('Guion de 30 segundos');
      await hoja.getByText('Video', { exact: true }).click();
      if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/coi-guardar-hoja-${ancho}.png` });
      expect(await axe(page), 'hoja de guardar: axe').toEqual([]);
      await hoja.getByRole('button', { name: 'Guardar' }).click();
      await expect(hoja).toBeHidden();
      await expect(page.getByRole('button', { name: 'Guardado' })).toBeFocused();
      await expect(page.getByText('Guardado en tu Biblioteca. Solo tú lo ves.')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Ver en Míos' })).toHaveAttribute('href', /^\/estudio\/biblioteca\//);
      // guardar NO gasta un uso
      await expect(contador(page)).toHaveText('Te quedan 2 de 3 hoy');
      expect(sim.pedidos.guardar).toHaveLength(1);
      const p = sim.pedidos.guardar[0]!;
      expect(p).toMatchObject({ titulo: 'Guion de 30 segundos', categoria: 'video', origen: 'coi', para_que: '', etiquetas: [] });
      expect(p.clave).toMatch(/^[0-9a-f]{32}$/);
      expect(p.prompt).toBe(`#CONTEXTO\n${COI_DE_MUESTRA.contexto}\n\n#OBJETIVO\n${COI_DE_MUESTRA.objetivo}\n\n#INSTRUCCIONES\n${COI_DE_MUESTRA.instrucciones}`);
      await revisar(page, 'coi-guardado');
    });

    test('guardar: el reintento del mismo guardado manda la MISMA clave; un COI nuevo trae otra', async ({ page }) => {
      const sim = await simular(page, { guardar: [detalle(500, 'otro', 'No pudimos guardarlo ahora.')] });
      await abrir(page);
      await cuadro(page).fill(TEXTO_DE_LA_PERSONA);
      await armar(page).click();
      await page.getByRole('button', { name: 'Guardar', exact: true }).click();
      const hoja = page.getByRole('dialog', { name: 'Guardar en tu Biblioteca' });
      await hoja.getByRole('button', { name: 'Guardar' }).click();
      await expect(hoja.getByRole('alert')).toContainText('No pudimos guardarlo ahora.');
      await hoja.getByRole('button', { name: 'Guardar' }).click();
      await expect(hoja).toBeHidden();
      expect(sim.pedidos.guardar).toHaveLength(2);
      expect(sim.pedidos.guardar[1]!.clave).toBe(sim.pedidos.guardar[0]!.clave);
      // otro COI, otro guardado, otra clave
      await armar(page).click();
      await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Guardar', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
      await expect(page.getByRole('dialog')).toBeHidden();
      expect(sim.pedidos.guardar).toHaveLength(3);
      expect(sim.pedidos.guardar[2]!.clave).not.toBe(sim.pedidos.guardar[0]!.clave);
    });

    test('quedan 1 y ya usaste los 3: la entrada se apaga, NO es un error, y el último resultado sigue a la vista', async ({ page }) => {
      const sim = await simular(page, { usos: 1 });
      await abrir(page);
      await expect(contador(page)).toHaveText('Te quedan 2 de 3 hoy');
      await cuadro(page).fill(TEXTO_DE_LA_PERSONA);
      await armar(page).click();
      await expect(contador(page)).toHaveText('Te queda 1 de 3 hoy');
      await expect(page.getByText('Es el último de hoy. Solo cuentan los COI que terminan bien.')).toBeVisible();
      await revisar(page, 'coi-queda-1');
      await armar(page).click();
      await expect(contador(page)).toHaveText('Ya usaste tus 3 de hoy');
      expect(sim.usos).toBe(3);
      // el contador y el «Faltan…» salen de renueva_en_s del servidor (19200 s = 5 h 20 min), no del reloj del navegador
      await expect(page.getByText('Se renuevan a la medianoche, hora de México (12:00 a. m.). Faltan 5 h 20 min.')).toBeVisible();
      await expect(armar(page)).toHaveAttribute('aria-disabled', 'true');
      await expect(cuadro(page)).toHaveAttribute('aria-disabled', 'true');
      await expect(cuadro(page)).toHaveAttribute('readonly', '');
      await expect(page.getByRole('alert')).toHaveCount(0); // no es un error
      // el último COI sigue a la vista, con su «Copiar»
      await expect(page.getByRole('heading', { name: 'Tu COI' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Copiar todo el COI' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Ir a la Biblioteca de prompts' })).toHaveAttribute('href', '/estudio/biblioteca/');
      // pulsar el botón apagado no manda nada
      const antes = sim.pedidos.armar.length;
      await armar(page).click({ force: true });
      expect(sim.pedidos.armar.length).toBe(antes);
      await revisar(page, 'coi-ya-usaste-3');
    });

    test('al abrir con los 3 usados: entrada apagada, sin resultado, y el «Faltan…» del servidor', async ({ page }) => {
      await simular(page, { usos: 3 });
      await abrir(page);
      await expect(contador(page)).toHaveText('Ya usaste tus 3 de hoy');
      await expect(page.getByRole('heading', { name: 'Ya usaste tus 3 COI de hoy' })).toBeVisible();
      await expect(page.getByText('Ejemplos para empezar')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Tu COI' })).toHaveCount(0);
      await cuadro(page).focus();
      await revisar(page, 'coi-agotado-al-abrir');
    });

    test('429 agotado (otra pestaña gastó el último): lo dice sin error, con renueva_en_s del 429', async ({ page }) => {
      const sim = await simular(page, { renueva: 3660, armar: [detalle(429, 'agotado', 'Ya usaste tus 3 COI de hoy.', { quedan: 0, renueva_en_s: 3660, se_renueva: SE_RENUEVA })] });
      await abrir(page);
      await cuadro(page).fill(TEXTO_DE_LA_PERSONA);
      sim.usos = 3; // mientras tanto, otra pestaña gastó el último
      await armar(page).click();
      await expect(page.getByRole('heading', { name: 'Ya usaste tus 3 COI de hoy' })).toBeVisible();
      await expect(cuadro(page)).toHaveValue(TEXTO_DE_LA_PERSONA); // lo escrito no se pierde
      await expect(page.getByText(/Faltan 1 h 1 min\./)).toBeVisible();
    });

    test('falló el modelo (502): «no se gastó ninguno», el texto sigue en el cuadro y se puede reintentar', async ({ page }) => {
      const sim = await simular(page, { armar: [detalle(502, 'modelo', 'No pudimos armar tu COI ahora. No se gastó ninguno de tus usos.')] });
      await abrir(page);
      await cuadro(page).fill(TEXTO_DE_LA_PERSONA);
      await armar(page).click();
      const alerta = page.getByRole('alert');
      await expect(alerta).toContainText('Algo falló de nuestro lado');
      await expect(alerta).toContainText('No se gastó ninguno de tus usos.');
      await expect(alerta).toContainText('Tu texto sigue en el cuadro.');
      await expect(cuadro(page)).toHaveValue(TEXTO_DE_LA_PERSONA);
      await expect(contador(page)).toHaveText('Te quedan 3 de 3 hoy');
      await expect(armar(page)).toBeFocused();
      await revisar(page, 'coi-fallo-modelo');
      await armar(page).click();
      await expect(page.getByRole('heading', { name: 'Tu COI' })).toBeFocused();
      expect(sim.pedidos.armar).toHaveLength(2);
    });

    test('tardó (504): lo dice y no gasta ninguno', async ({ page }) => {
      await simular(page, { armar: [detalle(504, 'tardo', 'Tardó demasiado en responder. No se gastó ninguno de tus usos.')] });
      await abrir(page);
      await cuadro(page).fill(TEXTO_DE_LA_PERSONA);
      await armar(page).click();
      await expect(page.getByRole('alert')).toContainText('Tardó demasiado');
      await expect(contador(page)).toHaveText('Te quedan 3 de 3 hoy');
      await revisar(page, 'coi-tardo');
    });

    test('moderación (422): el motivo junto al cuadro, el foco al cuadro y escribir quita el aviso', async ({ page }) => {
      await simular(page, { armar: [detalle(422, 'moderacion', 'No se gastó ninguno de tus usos. Motivo: contenido que acosa a otra persona.')] });
      await abrir(page);
      await cuadro(page).fill('Un mensaje para presionar a un cliente que no ha pagado');
      await armar(page).click();
      const aviso = page.locator('#coi-mod');
      await expect(aviso).toContainText('No pudimos usar ese texto.');
      await expect(aviso).toContainText('No se gastó ninguno de tus usos. Motivo: contenido que acosa a otra persona.');
      await expect(cuadro(page)).toBeFocused();
      await expect(cuadro(page)).toHaveAttribute('aria-invalid', 'true');
      await expect(cuadro(page)).toHaveAttribute('aria-describedby', /coi-mod/);
      await expect(contador(page)).toHaveText('Te quedan 3 de 3 hoy');
      await revisar(page, 'coi-moderacion');
      await cuadro(page).press('End');
      await cuadro(page).pressSequentially(' otra vez');
      await expect(aviso).toHaveCount(0);
    });

    test('otra en curso (409): el botón se apaga, avisa y, cuando el servidor suelta el candado, se puede pedir otra vez', async ({ page }) => {
      const sim = await simular(page, { armar: [detalle(409, 'en_curso', 'Ya estamos armando otro COI para ti. Espera a que termine.')] });
      await abrir(page);
      await cuadro(page).fill(TEXTO_DE_LA_PERSONA);
      sim.enCurso = true; // lo que dirá el servidor al volver a preguntar
      await armar(page).click();
      const aviso = page.locator('#coi-curso');
      await expect(aviso).toContainText('Ya hay un COI en camino');
      await expect(aviso).toContainText('Ya estamos armando otro COI para ti. Espera a que termine.');
      await expect(armar(page)).toHaveAttribute('aria-disabled', 'true');
      await expect(armar(page)).toBeFocused();
      await expect(contador(page)).toHaveText('Te quedan 3 de 3 hoy');
      await revisar(page, 'coi-otra-en-curso');
      // el servidor suelta el candado: a los pocos segundos (sondeo de 4 s) el botón vuelve
      sim.enCurso = false;
      await expect(aviso).toHaveCount(0, { timeout: 9000 });
      await expect(armar(page)).not.toHaveAttribute('aria-disabled', 'true');
    });

    test('otra en curso al abrir (otra pestaña): botón apagado con su motivo', async ({ page }) => {
      await simular(page, { enCurso: true });
      await abrir(page);
      await expect(page.locator('#coi-curso')).toContainText('Ya hay un COI en camino');
      await expect(armar(page)).toHaveAttribute('aria-disabled', 'true');
      await expect(armar(page)).toHaveAttribute('aria-describedby', 'coi-curso');
    });

    test('no disponible (falla cerrado): sin contador no se arma nada y «Reintentar» vuelve a preguntar', async ({ page }) => {
      const sim = await simular(page, { estado: 503 });
      await abrir(page);
      const alerta = page.getByRole('alert');
      await expect(alerta).toContainText('COI no está disponible ahora');
      await expect(alerta).toContainText('COI no está disponible en este momento.');
      await expect(armar(page)).toHaveAttribute('aria-disabled', 'true');
      await revisar(page, 'coi-no-disponible', { foco: false });
      sim.estado = 200;
      await alerta.getByRole('button', { name: 'Reintentar' }).click();
      await expect(contador(page)).toHaveText('Te quedan 3 de 3 hoy');
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(cuadro(page)).toBeFocused();
      await expect(armar(page)).not.toHaveAttribute('aria-disabled', 'true');
    });

    test('sin conexión al armar: lo dice y el texto sigue ahí', async ({ page }) => {
      await simular(page);
      await abrir(page);
      await page.route('**/api/coi', route => route.abort('internetdisconnected'));
      await cuadro(page).fill(TEXTO_DE_LA_PERSONA);
      await armar(page).click();
      await expect(page.getByRole('alert')).toContainText('No hay conexión');
      await expect(cuadro(page)).toHaveValue(TEXTO_DE_LA_PERSONA);
      await revisar(page, 'coi-sin-conexion');
    });

    test('estructura_ok = false: una sola tarjeta «Tu COI» con el texto completo y «Copiar»', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const completo = 'Aquí va tu prompt.\n\nUsa un tono cercano y frases cortas.';
      await simular(page, {
        armar: [
          {
            status: 200,
            body: { coi: { contexto: null, objetivo: null, instrucciones: null, completo, estructura_ok: false }, idioma: 'es', tope: 3, usos: 1, quedan: 2, renueva_en_s: RENUEVA_EN_S, se_renueva: SE_RENUEVA },
          },
        ],
      });
      await abrir(page);
      await cuadro(page).fill(TEXTO_DE_LA_PERSONA);
      await armar(page).click();
      await expect(page.getByRole('heading', { name: 'Tu COI' })).toBeFocused();
      await expect(page.locator('article')).toHaveCount(1);
      await expect(page.locator('article')).toContainText('Aquí va tu prompt.');
      await expect(page.getByRole('button', { name: 'Plegar todo' })).toHaveCount(0);
      await expect(contador(page)).toHaveText('Te quedan 2 de 3 hoy'); // esa respuesta SÍ cuenta
      await page.getByRole('button', { name: 'Copiar el COI completo' }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(completo);
      await revisar(page, 'coi-sin-estructura');
    });

    test('Ctrl+Intro envía desde el cuadro; con el cuadro vacío no manda nada y lo dice junto al campo', async ({ page }) => {
      const sim = await simular(page);
      await abrir(page);
      await cuadro(page).focus();
      await page.keyboard.press('Control+Enter');
      await expect(page.getByRole('alert')).toContainText('Escribe primero qué necesitas, aunque sea en una frase.');
      await expect(cuadro(page)).toBeFocused();
      expect(sim.pedidos.armar).toHaveLength(0);
      await cuadro(page).fill(TEXTO_DE_LA_PERSONA);
      await page.keyboard.press('Control+Enter');
      await expect(page.getByRole('heading', { name: 'Tu COI' })).toBeFocused();
      expect(sim.pedidos.armar).toHaveLength(1);
    });

    test('más de 2000 caracteres: no se manda y se dice cuántos lleva', async ({ page }) => {
      const sim = await simular(page);
      await abrir(page);
      await cuadro(page).fill('a'.repeat(2001));
      await expect(page.locator('#coi-largo')).toContainText('el máximo es de 2000 caracteres y llevas 2001');
      await expect(armar(page)).toHaveAttribute('aria-disabled', 'true');
      await armar(page).click({ force: true });
      expect(sim.pedidos.armar).toHaveLength(0);
      await cuadro(page).fill('a'.repeat(2000));
      await expect(page.locator('#coi-largo')).toHaveCount(0);
    });

    test('lo que la persona escribe y lo que responde la IA no queda en el navegador', async ({ page, context }) => {
      await simular(page);
      await abrir(page);
      await cuadro(page).fill(TEXTO_DE_LA_PERSONA);
      await armar(page).click();
      await expect(page.getByRole('heading', { name: 'Tu COI' })).toBeFocused();
      const guardado = await page.evaluate(async () => {
        const bd = 'indexedDB' in window && typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map(d => d.name) : [];
        return JSON.stringify({ local: { ...localStorage }, sesion: { ...sessionStorage }, cookies: document.cookie, bd });
      });
      expect(guardado).not.toContain('lampara');
      expect(guardado).not.toContain('guion');
      expect(guardado).not.toContain('Escribir un guion');
      const galletas = JSON.stringify(await context.cookies());
      expect(galletas).not.toContain('lampara');
      // recargar: la caja vuelve vacía y no hay resultado
      await page.reload();
      await expect(cuadro(page)).toHaveValue('');
      await expect(page.getByRole('heading', { name: 'Tu COI' })).toHaveCount(0);
    });
  });
}

test.describe('COI con «reducir movimiento»', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' }, viewport: { width: 1100, height: 900 } });

  test('mientras arma no corre ninguna animación', async ({ page }) => {
    let soltar!: () => void;
    await simular(page, { armar: [{ ...coiOk({ usos: 1 } as Sim), espera: new Promise<void>(r => (soltar = r)) }] });
    await abrir(page);
    await cuadro(page).fill(TEXTO_DE_LA_PERSONA);
    await armar(page).click();
    await expect(page.getByRole('heading', { name: 'Armando tu COI…' })).toBeVisible();
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
    soltar();
    await expect(page.getByRole('heading', { name: 'Tu COI' })).toBeVisible();
    expect(await page.evaluate(animacionesVivas)).toEqual([]);
  });
});
