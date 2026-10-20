// «4 · Clases» de /estudio/admin/ en un navegador de verdad, a 1100, 390 y 320 px, con la API simulada (`page.route`, como edicion.ts): el
// servidor de las clases lo construye otro rol y aquí NO se llama a ningún proveedor de pago ni a S3 (el PUT es del mismo origen y tarda
// lo que la prueba diga). Mide lo que jsdom no ve: que no haya desborde horizontal, que lo que se toca mida 44 px o más, que ningún texto
// baje de 13 px, axe sin violaciones y el foco (nunca cae al body al abrir y cerrar el formulario y el diálogo de archivar).
//
// Capturas: con GUIA_CAPTURAS=<carpeta> cada estado se guarda como PNG (para mirarlas). Sin la variable no se guarda nada.
import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

const AXE = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const CAPTURAS = process.env.GUIA_CAPTURAS;

// ---------------------------------------------------------------------------
// La API de mentira, con la forma del contrato (sección 5.1 del diseño de la Guía de clases)

const LIMITES = {
  max_bytes: 5368709120,
  extensiones: ['.mp4', '.mov', '.m4v'],
  content_types: ['video/mp4', 'video/quicktime', 'video/x-m4v'],
  presign_s: 900,
  duracion_min_s: 60,
  duracion_max_s: 7200,
  titulo_max: 120,
  resumen_max: 140,
  numero_min: 1,
  numero_max: 999,
  liga_max: 500,
};

const RESUMEN = {
  usuarios: [],
  aurora: null,
  piso_venta_usd: 0.05,
  totales: { costo_usd: 0, margen_usd: 0, gastados: 0, peliculas: 0 },
  langfuse_base: 'https://lf.ejemplo',
};

interface ClaseSim {
  id: string;
  numero: number;
  titulo: string;
  resumen: string | null;
  grabada_en: string | null;
  origen: 'archivo' | 'liga';
  nombre_original: string | null;
  liga: string | null;
  bytes: number | null;
  duracion_s: number | null;
  estado: string;
  paso: null;
  error: string | null;
  publicada: boolean;
  indice: null;
  creado: string;
  actualizado: string;
  archivada_en?: string | null;
}

const clase = (sobre: Partial<ClaseSim> = {}): ClaseSim => ({
  id: 'cl-3f9a21bc',
  numero: 5,
  titulo: 'Respuestas automáticas con tus datos',
  resumen: 'Conectas la IA con la información de tu negocio para que conteste como tú.',
  grabada_en: '2026-03-12',
  origen: 'archivo',
  nombre_original: null,
  liga: null,
  bytes: null,
  duracion_s: null,
  estado: 'borrador',
  paso: null,
  error: null,
  publicada: false,
  indice: null,
  creado: '2026-10-19T20:00:00Z',
  actualizado: '2026-10-19T20:00:00Z',
  ...sobre,
});

const SUBIDA_SIN_MEDIR = clase({ id: 'cl-cc33dd44', numero: 3, titulo: 'Un video sin medir', estado: 'subido', bytes: 1_400_000_000, duracion_s: null, nombre_original: 'clase3.mp4' });

const SUBIDA = clase({ id: 'cl-aa11bb22', numero: 2, titulo: 'Cómo hablarle a la IA', estado: 'subido', bytes: 1_400_000_000, duracion_s: 3720.4, nombre_original: 'clase2.mp4', grabada_en: '2026-02-10' });

interface Sim {
  vivas: Map<string, ClaseSim>;
  archivadas: Map<string, ClaseSim>;
  /** «MÉTODO ruta», en el orden en que llegó. */
  pedidos: string[];
  cuerpos: Array<{ ruta: string; cuerpo: Record<string, unknown> | null }>;
  /** Cuánto tarda el PUT a «S3» (ms). */
  subidaMs: number;
  clasesPedidas: number;
  /** El token de la subida vigente de cada clase (lo da /subida; confirmar y cancelar lo traen de vuelta). */
  tokens: Map<string, string>;
  /** Cuántas veces más responde 502 `s3_fallo` a «confirmar» (un fallo pasajero). */
  confirmarFalla: number;
  /** Los ids de clase cuyo DELETE o cuyo restaurar responden con error. */
  archivarFalla: Set<string>;
  restaurarFalla: Set<string>;
}


async function simular(
  page: Page,
  o: { vivas?: ClaseSim[]; archivadas?: ClaseSim[]; subidaMs?: number; confirmarFalla?: number; archivarFalla?: string[]; restaurarFalla?: string[] } = {},
): Promise<Sim> {
  const sim: Sim = {
    vivas: new Map((o.vivas ?? []).map(c => [c.id, c])),
    archivadas: new Map((o.archivadas ?? []).map(c => [c.id, c])),
    pedidos: [],
    cuerpos: [],
    subidaMs: o.subidaMs ?? 900,
    clasesPedidas: 0,
    tokens: new Map(),
    confirmarFalla: o.confirmarFalla ?? 0,
    archivarFalla: new Set(o.archivarFalla ?? []),
    restaurarFalla: new Set(o.restaurarFalla ?? []),
  };
  let n = 0;
  let nToken = 0;
  await page.route('**/api/admin/resumen', r => r.fulfill({ json: RESUMEN }));
  await page.route(/\/api\/admin\/clases(\/|\?|$)/, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const metodo = req.method();
    const [, , , , id, accion] = url.pathname.split('/'); // '', api, admin, clases, <id>, <accion>
    const cuerpo = (req.postData() ? req.postDataJSON() : null) as Record<string, unknown> | null;
    sim.pedidos.push(`${metodo} ${url.pathname}${url.search}`);
    sim.cuerpos.push({ ruta: url.pathname, cuerpo });
    const json = (j: unknown, status = 200) => route.fulfill({ status, json: j });
    const falla = (status: number, codigo: string, texto: string) => json({ detail: { codigo, texto } }, status);
    if (!id) {
      if (metodo === 'GET') {
        sim.clasesPedidas += 1;
        const lista = url.searchParams.get('archivadas') === '1' ? [...sim.archivadas.values()] : [...sim.vivas.values()];
        return json({ clases: lista, limites: LIMITES });
      }
      const nueva = clase({
        id: `cl-0000000${++n}`,
        numero: Number(cuerpo?.numero),
        titulo: String(cuerpo?.titulo),
        resumen: (cuerpo?.resumen as string | undefined) ?? null,
        grabada_en: (cuerpo?.grabada_en as string | undefined) ?? null,
        origen: cuerpo?.origen as 'archivo' | 'liga',
        liga: (cuerpo?.liga as string | undefined) ?? null,
      });
      sim.vivas.set(nueva.id, nueva);
      return json({ clase: nueva }, 201);
    }
    const actual = sim.vivas.get(id) ?? sim.archivadas.get(id);
    if (!actual) return falla(404, 'no_existe', 'Esa clase no existe.');
    const poner = (cambios: Partial<ClaseSim>) => {
      const c = { ...actual, ...cambios };
      sim.vivas.set(id, c);
      return c;
    };
    if (metodo === 'PATCH') return json({ clase: poner(cuerpo as Partial<ClaseSim>) });
    if (metodo === 'DELETE') {
      if (sim.archivarFalla.has(id)) return falla(503, 'no_disponible', 'No pudimos archivar la clase ahora. Inténtalo en un momento.');
      sim.archivadas.set(id, { ...actual, archivada_en: '2026-10-20T10:00:00Z' });
      sim.vivas.delete(id);
      return json({ ok: true });
    }
    if (accion === 'subida') {
      poner({ estado: 'subiendo' });
      const token = (++nToken).toString(16).padStart(32, 'c');
      sim.tokens.set(id, token);
      return json({ url: `/s3-falso/subida?clase=${id}`, content_type: cuerpo?.content_type, expira_s: 900, token });
    }
    // como el servidor de verdad: solo se confirma o se cancela desde «subiendo», y un token que no es el vigente no toca nada
    if (accion === 'confirmar' || accion === 'cancelar') {
      if (actual.estado !== 'subiendo') return falla(409, 'estado_no_permite', 'Eso no se puede hacer con la clase tal como está ahora.');
      if (cuerpo?.token !== undefined && cuerpo.token !== sim.tokens.get(id)) {
        return falla(409, 'subida_cambio', 'Esa subida ya no es la vigente: se empezó otra o se canceló. No se cambió nada.');
      }
      if (accion === 'confirmar' && sim.confirmarFalla > 0) {
        sim.confirmarFalla -= 1;
        return falla(502, 's3_fallo', 'No pudimos hablar con S3 ahora. Inténtalo de nuevo en unos minutos.');
      }
      sim.tokens.delete(id);
      if (accion === 'cancelar') return json({ clase: poner({ estado: 'borrador' }) });
      return json({ clase: poner({ estado: 'subido', bytes: 1_400_000_000, nombre_original: cuerpo?.nombre ? String(cuerpo.nombre) : null }) });
    }
    if (accion === 'medir') return json({ clase: poner({ duracion_s: 3720.4 }) });
    if (accion === 'video') return json({ url: `/s3-falso/video.mp4?clase=${id}`, expira_s: 7200 });
    if (accion === 'restaurar') {
      if (sim.restaurarFalla.has(id)) return falla(409, 'numero_repetido', `Ya hay una clase ${actual.numero}. Cámbiale el número a una de las dos.`);
      const vuelta = { ...actual, archivada_en: null };
      sim.archivadas.delete(id);
      sim.vivas.set(id, vuelta);
      return json({ clase: vuelta });
    }
    return falla(404, 'no_existe', 'Esa ruta no existe.');
  });
  // el PUT a «S3» es del mismo origen para no depender de CORS; tarda un poco para poder ver la barra
  await page.route('**/s3-falso/subida*', async r => {
    await new Promise(f => setTimeout(f, sim.subidaMs));
    await r.fulfill({ status: 200, body: '' });
  });
  // el video se queda «cargando» (no hay un mp4 que reproducir): así se mide el reproductor sin que se rompa a media prueba
  await page.route('**/s3-falso/video.mp4*', () => new Promise<void>(() => {}));
  return sim;
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

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
    // el texto que solo leen los lectores de pantalla (`sr-only`) mide 1 px: no se ve
    const oculto = (e: Element) => {
      const r = e.getBoundingClientRect();
      return r.width <= 1 || r.height <= 1;
    };
    // la bajada del panel (las tres vistas de siempre) no es de esta pestaña: se mide lo demás
    const bajada = document.querySelector('h1')?.nextElementSibling;
    const fuera: string[] = [];
    const finos: string[] = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) {
      const n = tw.currentNode;
      const t = (n.textContent ?? '').trim();
      const p = n.parentElement;
      if (!t || !p || !visible(p) || oculto(p) || p.closest('.sr-only,[hidden],script,style')) continue;
      const rango = document.createRange();
      rango.selectNodeContents(n);
      const rr = rango.getBoundingClientRect();
      if (rr.width === 0) continue;
      const fs = parseFloat(getComputedStyle(p).fontSize);
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
      if (!visible(e) || e.closest('[hidden],[inert]') || e.matches('.sr-only') || bajada?.contains(e)) continue;
      const r = e.getBoundingClientRect();
      if (r.height < 43.5 || r.width < 43.5) {
        const nombre = (e.getAttribute('aria-label') ?? (e as HTMLElement).innerText ?? e.tagName).trim().replace(/\s+/g, ' ').slice(0, 30);
        chicos.push(`${nombre} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return { vw, scrollW: document.documentElement.scrollWidth, finos, fuera, chicos, h1: [...document.querySelectorAll('h1')].filter(visible).length };
  });
}

async function axe(page: Page) {
  await page.evaluate(AXE);
  return page.evaluate(async () => {
    const run = (window as unknown as { axe: { run: (c: object, o: object) => Promise<{ violations: Array<{ id: string; nodes: Array<{ target: unknown[] }> }> }> } }).axe;
    // la bajada del panel (`h1 + div`: las tres vistas de siempre y sus enlaces a AWS) es del panel, no de esta pestaña
    const r = await run.run({ include: [['body']], exclude: [['h1 + div']] }, { resultTypes: ['violations'] });
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
  if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/admin-clases-${nombre}-${m.vw}.png`, fullPage: true });
}

// lo que se ve ámbar de botón: los botones con el fondo del principal Y los interruptores, cuya pista o bolita también pueden pintarse
// con él (encendido NO debe: DISENO.md §5)
const ambares = (page: Page) =>
  page.locator('button').evaluateAll(bs => {
    const AMBAR = 'rgb(218, 140, 40)';
    const esAmbar = (e: Element) => getComputedStyle(e).backgroundColor === AMBAR;
    return bs
      .filter(b => esAmbar(b) || (b.getAttribute('role') === 'switch' && [...b.querySelectorAll('*')].some(esAmbar)))
      .map(b => b.textContent || b.getAttribute('role'));
  });

/** Lo que tiene el foco ahora, para el mensaje de la prueba: «H3: Clase 5 · …», «BODY». */
const dondeEstaElFoco = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return 'BODY';
    return `${a.tagName}: ${(a.getAttribute('aria-label') ?? a.textContent ?? '').trim().slice(0, 40)}`;
  });

async function abrirPestana(page: Page) {
  await page.goto('/estudio/admin/');
  const lista = page.getByRole('tablist', { name: 'Vistas' });
  await expect(lista).toBeVisible();
  await page.getByRole('tab', { name: '4 · Clases' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Clases', exact: true })).toBeVisible();
}

const VIDEO = { name: 'clase5.mp4', mimeType: 'video/mp4', buffer: Buffer.from('no es un video de verdad: el PUT es de mentira') };

/** Elige el video como lo haría quien usa el teclado: primero llega con Tab al selector (el foco queda ahí) y luego elige. `setInputFiles`
 *  no mueve el foco por sí solo, así que sin esto la prueba no vería lo que pasa cuando el selector, con el foco, desaparece. */
async function elegirConTeclado(page: Page, n: number, archivo: typeof VIDEO | { name: string; mimeType: string; buffer: Buffer }) {
  const selector = page.getByLabel(`Subir video de la clase ${n}`);
  await selector.focus();
  await selector.setInputFiles(archivo);
}
const tarjeta = (page: Page, n: number) => page.getByRole('article', { name: new RegExp(`^Clase ${n} ·`) });

// 1100 (escritorio), 390 (celular) y 320 (el celular más angosto que se mide en el repo)
for (const [ancho, alto] of [
  [1100, 900],
  [390, 844],
  [320, 700],
] as const) {
  test.describe(`Admin · Clases a ${ancho} px`, () => {
    test.use({ viewport: { width: ancho, height: alto } });

    test('la pestaña es la cuarta y última, la lista solo se pide al abrirla, y hay un solo botón ámbar', async ({ page }) => {
      const sim = await simular(page, { vivas: [clase(), SUBIDA] });
      await page.goto('/estudio/admin/');
      const tabs = page.getByRole('tablist', { name: 'Vistas' }).getByRole('tab');
      await expect(tabs).toHaveText(['1 · Ingresos', '2 · Costos', '3 · Flujo', '4 · Clases']);
      // con la pestaña cerrada no se pidió nada de clases
      expect(sim.clasesPedidas).toBe(0);
      await tabs.nth(3).click();
      await expect(page.getByRole('button', { name: 'Nueva clase' })).toBeVisible();
      expect(sim.clasesPedidas).toBe(1);
      await expect(page.getByText('Aquí subes los videos de las clases que usará la Guía. Subir no cuesta nada.')).toBeVisible();
      await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Clase 2 · Cómo hablarle a la IA', 'Clase 5 · Respuestas automáticas con tus datos']);
      await expect(tarjeta(page, 2).getByText('Listo: 1 h 02 min · 1.4 GB')).toBeVisible();
      await expect(tarjeta(page, 5).getByText('Borrador')).toBeVisible();
      await expect(page.getByLabel('Subir video de la clase 5')).toHaveAttribute('accept', '.mp4,.mov,.m4v,video/mp4,video/quicktime,video/x-m4v');
      // un solo ámbar. El botón pasa de apagado a ámbar con una transición de 120 ms: se espera a que llegue al color final
      await expect(page.getByRole('button', { name: 'Nueva clase' })).toHaveCSS('background-color', 'rgb(218, 140, 40)');
      expect(await ambares(page)).toEqual(['Nueva clase']);
      await revisar(page, 'reposo');
    });

    test('lista vacía: enseña el primer paso y no repite el botón ámbar', async ({ page }) => {
      await simular(page);
      await abrirPestana(page);
      await expect(page.getByText('Todavía no hay clases')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Nueva clase' })).toHaveCount(1);
      expect(await ambares(page)).toEqual(['Nueva clase']);
      await revisar(page, 'vacia');
    });

    test('formulario: abre con el foco en el número, «Guardar clase» es el único ámbar, y al guardar el foco va a la clase nueva', async ({ page }) => {
      const sim = await simular(page);
      await abrirPestana(page);
      await page.getByRole('button', { name: 'Nueva clase' }).click();
      const form = page.getByRole('region', { name: 'Nueva clase' });
      await expect(form).toBeVisible();
      await expect(page.getByLabel('Número de clase')).toBeFocused();
      await expect(page.getByRole('button', { name: 'Nueva clase' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Guardar clase' })).toHaveCSS('background-color', 'rgb(218, 140, 40)');
      expect(await ambares(page)).toEqual(['Guardar clase']);
      await revisar(page, 'formulario');
      // sin número ni título: los errores salen junto a los campos, con el foco en el primero, y no se manda nada
      await page.getByRole('button', { name: 'Guardar clase' }).click();
      await expect(page.getByText('Escribe el número de la clase: un número entero, como 5.')).toBeVisible();
      await expect(page.getByText('Escribe el título de la clase.')).toBeVisible();
      await expect(page.getByLabel('Número de clase')).toBeFocused();
      expect(sim.pedidos.filter(p => p.startsWith('POST'))).toEqual([]);
      await revisar(page, 'formulario-con-errores');
      await page.getByLabel('Número de clase').fill('5');
      await page.getByLabel('Título').fill('Respuestas automáticas con tus datos');
      await page.getByLabel('Fecha de grabación').fill('2026-03-12');
      await page.getByLabel('Para qué sirve (máx. 140)').fill('Conectas la IA con la información de tu negocio.');
      // el doble clic no duplica: un solo POST
      await page.getByRole('button', { name: 'Guardar clase' }).dblclick();
      await expect(page.getByRole('heading', { level: 3, name: 'Clase 5 · Respuestas automáticas con tus datos' })).toBeFocused();
      expect(sim.pedidos.filter(p => p.startsWith('POST'))).toEqual(['POST /api/admin/clases']);
      const cuerpo = sim.cuerpos.find(c => c.cuerpo)!.cuerpo!;
      expect(cuerpo).toMatchObject({ numero: 5, titulo: 'Respuestas automáticas con tus datos', grabada_en: '2026-03-12', origen: 'archivo' });
      expect(cuerpo.clave).toMatch(/^[0-9a-f-]{36}$/);
      await expect(page.getByRole('region', { name: 'Nueva clase' })).toHaveCount(0);
      expect(await ambares(page)).toEqual(['Nueva clase']);
      await revisar(page, 'clase-creada');
    });

    test('cancelar el formulario devuelve el foco a «Nueva clase»; editar prellena y vuelve a «Editar»', async ({ page }) => {
      await simular(page, { vivas: [clase()] });
      await abrirPestana(page);
      await page.getByRole('button', { name: 'Nueva clase' }).click();
      await page.getByRole('region', { name: 'Nueva clase' }).getByRole('button', { name: 'Cancelar' }).click();
      await expect(page.getByRole('button', { name: 'Nueva clase' })).toBeFocused();
      await page.getByRole('button', { name: 'Editar la clase 5' }).click();
      const form = page.getByRole('region', { name: 'Editar la clase 5' });
      await expect(form.getByLabel('Título')).toHaveValue('Respuestas automáticas con tus datos');
      await expect(form.getByLabel('Fecha de grabación')).toHaveValue('2026-03-12');
      await expect(form.getByLabel(/Liga de referencia/)).toHaveCount(0);
      await revisar(page, 'editar');
      await form.getByRole('button', { name: 'Cancelar' }).click();
      await expect(page.getByRole('button', { name: 'Editar la clase 5' })).toBeFocused();
    });

    test('subir: permiso → PUT con progreso → confirmar → medir, y «Listo: 1 h 02 min · 1.4 GB»', async ({ page }) => {
      const sim = await simular(page, { vivas: [clase()], subidaMs: 1500 });
      await abrirPestana(page);
      await elegirConTeclado(page, 5, VIDEO);
      const t = tarjeta(page, 5);
      await expect(t.getByRole('progressbar')).toBeVisible();
      await expect(t.getByText(/^Subiendo… \d+ %$/)).toBeVisible();
      await expect(t.getByText('Subiendo', { exact: true })).toBeVisible(); // el chip
      await expect(t.getByRole('button', { name: 'Cancelar' })).toBeVisible();
      expect(await ambares(page)).toEqual(['Nueva clase']);
      // el selector tenía el foco y desapareció al empezar: el foco se fue al título de la tarjeta, no al body
      await expect(t.getByRole('heading', { level: 3 })).toBeFocused();
      await revisar(page, 'subiendo');
      await expect(t.getByText('Listo: 1 h 02 min · 1.4 GB')).toBeVisible();
      expect(sim.pedidos.filter(p => p.startsWith('POST'))).toEqual([
        'POST /api/admin/clases/cl-3f9a21bc/subida',
        'POST /api/admin/clases/cl-3f9a21bc/confirmar',
        'POST /api/admin/clases/cl-3f9a21bc/medir',
      ]);
      await expect(t.getByText('Archivo: clase5.mp4')).toBeVisible();
      await expect(t.getByText('Subido', { exact: true })).toBeVisible();
      // terminó y el foco no se perdió por el camino
      await expect(t.getByRole('heading', { level: 3 })).toBeFocused();
      await revisar(page, 'subido');
    });

    test('cancelar la subida corta el PUT, no confirma y deja elegir otro video', async ({ page }) => {
      const sim = await simular(page, { vivas: [clase()], subidaMs: 4000 });
      await abrirPestana(page);
      await elegirConTeclado(page, 5, VIDEO);
      const t = tarjeta(page, 5);
      await t.getByRole('button', { name: 'Cancelar' }).click();
      await expect(t.getByText('Subida cancelada. Puedes elegir el video otra vez.')).toBeVisible();
      await expect(t.getByText('Borrador')).toBeVisible();
      await expect(page.getByLabel('Subir video de la clase 5')).toBeAttached();
      expect(sim.pedidos.filter(p => p.startsWith('POST'))).toEqual(['POST /api/admin/clases/cl-3f9a21bc/subida', 'POST /api/admin/clases/cl-3f9a21bc/cancelar']);
      // «Cancelar» (con el foco, por el clic) desapareció: el foco quedó en el título de la tarjeta
      await expect(t.getByRole('heading', { level: 3 })).toBeFocused();
      await revisar(page, 'subida-cancelada');
    });

    test('un archivo que no es video no pide permiso y lo dice', async ({ page }) => {
      const sim = await simular(page, { vivas: [clase()] });
      await abrirPestana(page);
      await elegirConTeclado(page, 5, { name: 'virus.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') });
      await expect(page.getByRole('alert')).toContainText('Ese archivo no es de un tipo que se pueda subir. Elige un video .mp4, .mov, .m4v.');
      expect(sim.pedidos.filter(p => p.startsWith('POST'))).toEqual([]);
      // nada se desmontó: el selector sigue ahí con el foco
      await expect(page.getByLabel('Subir video de la clase 5')).toBeFocused();
      await revisar(page, 'archivo-no-valido');
    });

    test('ver video: el reproductor sale dentro de la tarjeta, sin desborde, y se oculta', async ({ page }) => {
      const sim = await simular(page, { vivas: [SUBIDA] });
      await abrirPestana(page);
      await page.getByRole('button', { name: 'Ver video de la clase 2' }).click();
      const reproductor = page.getByLabel('Vista previa de la clase 2');
      await expect(reproductor).toBeVisible();
      await expect(reproductor).toHaveAttribute('src', /\/s3-falso\/video\.mp4/);
      await expect(reproductor).not.toHaveAttribute('autoplay', /.*/);
      await expect(reproductor).toBeFocused();
      const caja = await reproductor.boundingBox();
      expect(caja!.width).toBeLessThanOrEqual(ancho);
      expect(Math.abs(caja!.width / caja!.height - 16 / 9)).toBeLessThan(0.05);
      expect(sim.pedidos).toContain('GET /api/admin/clases/cl-aa11bb22/video');
      await revisar(page, 'ver-video');
      await page.getByRole('button', { name: 'Ocultar video de la clase 2' }).click();
      await expect(reproductor).toHaveCount(0);
    });

    test('archivar: el diálogo arranca en «Cancelar», Esc no archiva, confirmar archiva y restaurar la devuelve; el foco nunca cae al body', async ({ page }) => {
      const sim = await simular(page, { vivas: [clase(), SUBIDA] });
      await abrirPestana(page);
      const archivar = page.getByRole('button', { name: 'Archivar la clase 5' });
      await archivar.click();
      const dialogo = page.getByRole('alertdialog', { name: '¿Archivar la clase 5?' });
      await expect(dialogo).toBeVisible();
      await expect(dialogo).toContainText('Deja de aparecer en la lista y en la Guía. No se borra nada y se puede restaurar.');
      await expect(dialogo.getByRole('button', { name: 'Cancelar' })).toBeFocused();
      // la acción es de nivel peligro, no ámbar
      expect(await ambares(page)).toEqual(['Nueva clase']);
      await expect(dialogo.getByRole('button', { name: 'Archivar' })).not.toHaveCSS('background-color', 'rgb(218, 140, 40)');
      await revisar(page, 'archivar-dialogo');
      // Esc cierra sin archivar y el foco vuelve al botón que lo abrió
      await page.keyboard.press('Escape');
      await expect(dialogo).toBeHidden();
      await expect(archivar).toBeFocused();
      expect(sim.pedidos.filter(p => p.startsWith('DELETE'))).toEqual([]);
      // «Cancelar» tampoco archiva
      await archivar.click();
      await dialogo.getByRole('button', { name: 'Cancelar' }).click();
      await expect(dialogo).toBeHidden();
      await expect(archivar).toBeFocused();
      expect(sim.pedidos.filter(p => p.startsWith('DELETE'))).toEqual([]);
      // confirmar archiva: la tarjeta sale y el foco se queda en el título de la lista
      await archivar.click();
      await dialogo.getByRole('button', { name: 'Archivar' }).click();
      await expect(tarjeta(page, 5)).toHaveCount(0);
      expect(sim.pedidos.filter(p => p.startsWith('DELETE'))).toEqual(['DELETE /api/admin/clases/cl-3f9a21bc']);
      await expect(page.getByRole('heading', { level: 2, name: 'Clases', exact: true })).toBeFocused();
      await revisar(page, 'archivada');
      // las archivadas, con el interruptor
      expect(sim.pedidos.some(p => p.includes('archivadas=1'))).toBe(false);
      await page.getByRole('switch', { name: 'Ver clases archivadas' }).click();
      const archivada = page.getByRole('article', { name: 'Clase 5 · Respuestas automáticas con tus datos' });
      await expect(archivada).toBeVisible();
      await expect(archivada.getByText('Archivada')).toBeVisible();
      // con el interruptor ENCENDIDO sigue habiendo un solo ámbar: la pista no es del color del botón principal sino el tono de «elegido»
      // (borde #a96716 sobre fondo #2e2110, DISENO.md §5). Se espera a que termine la transición de 120 ms antes de contar
      const interruptor = page.getByRole('switch', { name: 'Ver clases archivadas' });
      await expect(interruptor).toHaveAttribute('aria-checked', 'true');
      await expect(interruptor.locator(':scope > span')).toHaveCSS('background-color', 'rgb(46, 33, 16)');
      await expect(interruptor.locator(':scope > span')).toHaveCSS('border-top-color', 'rgb(169, 103, 22)');
      expect(await ambares(page)).toEqual(['Nueva clase']);
      await revisar(page, 'archivadas');
      await archivada.getByRole('button', { name: 'Restaurar la clase 5' }).click();
      await expect(page.getByRole('heading', { level: 3, name: 'Clase 5 · Respuestas automáticas con tus datos' })).toBeFocused();
      await expect(page.getByText('No hay clases archivadas.')).toBeVisible();
      expect(sim.pedidos.filter(p => p.includes('restaurar'))).toEqual(['POST /api/admin/clases/cl-3f9a21bc/restaurar']);
      await revisar(page, 'restaurada');
    });

    test('textos largos y HTML del servidor: se pintan como texto y no desbordan', async ({ page }) => {
      await simular(page, {
        vivas: [
          clase({
            titulo: 'T'.repeat(120),
            resumen: '<img src=x onerror=alert(1)> ' + 'R'.repeat(110),
            nombre_original: '<svg onload=alert(2)>' + 'a'.repeat(95) + '.mp4',
            estado: 'subido',
            bytes: 1_400_000_000,
            duracion_s: 3720.4,
            error: 'Falló ' + 'x'.repeat(100),
          }),
          clase({ id: 'cl-2', numero: 6, titulo: 'Solo una liga', origen: 'liga', liga: 'https://ejemplo.com/' + 'ruta/'.repeat(30) }),
        ],
      });
      await abrirPestana(page);
      await expect(page.getByText(/<img src=x onerror=alert\(1\)>/)).toBeVisible();
      await expect(page.locator('img, svg[onload]')).toHaveCount(0);
      await expect(page.getByRole('link', { name: /Abrir la liga de referencia/ })).toHaveAttribute('target', '_blank');
      await revisar(page, 'textos-largos');
    });

    test('el foco nunca cae al body: empezar, cancelar con el teclado, terminar y medir la duración', async ({ page }) => {
      await simular(page, { vivas: [clase(), SUBIDA_SIN_MEDIR], subidaMs: 1200 });
      await abrirPestana(page);
      const t = tarjeta(page, 5);
      const titulo = t.getByRole('heading', { level: 3 });
      // empezar: el selector con el foco desaparece y el foco va al título de la tarjeta
      await elegirConTeclado(page, 5, VIDEO);
      await expect(titulo, `foco al empezar: ${await dondeEstaElFoco(page)}`).toBeFocused();
      // cancelar con Enter: «Cancelar» tenía el foco y desaparece
      await t.getByRole('button', { name: 'Cancelar' }).focus();
      await page.keyboard.press('Enter');
      await expect(t.getByText('Subida cancelada. Puedes elegir el video otra vez.')).toBeVisible();
      expect(await dondeEstaElFoco(page), 'foco al cancelar').toMatch(/^H3/);
      // terminar: la persona se fue a «Cancelar» con Tab y el PUT acaba; el botón se va y el foco se queda en la tarjeta
      await elegirConTeclado(page, 5, VIDEO);
      await t.getByRole('button', { name: 'Cancelar' }).focus();
      await expect(t.getByText('Listo: 1 h 02 min · 1.4 GB')).toBeVisible();
      expect(await dondeEstaElFoco(page), 'foco al terminar').toMatch(/^H3/);
      // «Medir duración» con Enter: el botón se va al llenarse la duración
      const sinMedir = tarjeta(page, 3);
      await sinMedir.getByRole('button', { name: 'Medir duración de la clase 3' }).focus();
      await page.keyboard.press('Enter');
      await expect(sinMedir.getByText('Listo: 1 h 02 min · 1.4 GB')).toBeVisible();
      expect(await dondeEstaElFoco(page), 'foco al medir').toMatch(/^H3/);
      await revisar(page, 'foco-tras-medir');
    });

    test('confirmar falla un momento: el video no se tira, se puede reintentar sin subir otra vez y todo cabe', async ({ page }) => {
      const sim = await simular(page, { vivas: [clase()], subidaMs: 500, confirmarFalla: 1 });
      await abrirPestana(page);
      await elegirConTeclado(page, 5, VIDEO);
      const t = tarjeta(page, 5);
      await expect(t.getByRole('alert')).toContainText('Tu video ya llegó a la nube, pero no pudimos confirmarlo.');
      await expect(t.getByRole('alert')).toContainText('No pudimos hablar con S3 ahora.');
      await expect(t.getByRole('button', { name: 'Reintentar la confirmación' })).toBeVisible();
      await expect(t.getByRole('button', { name: 'Cancelar subida' })).toBeVisible();
      await expect(t.getByText('Subiendo', { exact: true })).toBeVisible(); // el chip: la clase sigue «subiendo»
      await expect(page.getByLabel('Subir video de la clase 5')).toHaveCount(0);
      // NO se canceló nada
      expect(sim.pedidos.filter(p => p.includes('/cancelar'))).toEqual([]);
      expect(await ambares(page)).toEqual(['Nueva clase']);
      await revisar(page, 'sin-confirmar');
      await t.getByRole('button', { name: 'Reintentar la confirmación' }).click();
      await expect(t.getByText('Listo: 1 h 02 min · 1.4 GB')).toBeVisible();
      const confirmaciones = sim.cuerpos.filter(c => c.ruta.endsWith('/confirmar'));
      expect(confirmaciones).toHaveLength(2);
      expect(confirmaciones[1]!.cuerpo).toEqual(confirmaciones[0]!.cuerpo);
      expect(confirmaciones[0]!.cuerpo!.token).toMatch(/^[0-9a-f]{32}$/);
      expect(sim.pedidos.filter(p => p.endsWith('/subida'))).toHaveLength(1);
      expect(await dondeEstaElFoco(page), 'foco al terminar').toMatch(/^H3/);
    });

    test('si falla archivar o restaurar, el aviso sale dentro de la tarjeta que se tocó y a la vista', async ({ page }) => {
      const vivas = Array.from({ length: 8 }, (_, i) => clase({ id: `cl-v${i + 1}`, numero: i + 1, titulo: `Clase de prueba ${i + 1}` }));
      await simular(page, {
        vivas,
        archivadas: [clase({ id: 'cl-viejo', numero: 20, titulo: 'Vieja' })],
        archivarFalla: ['cl-v8'],
        restaurarFalla: ['cl-viejo'],
      });
      await abrirPestana(page);
      const octava = tarjeta(page, 8);
      await octava.getByRole('button', { name: 'Archivar la clase 8' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Archivar' }).click();
      const alerta = octava.getByRole('alert');
      await expect(alerta).toContainText('No pudimos archivar la clase ahora.');
      await expect(alerta).toBeInViewport();
      await expect(page.getByRole('alert')).toHaveCount(1);
      await revisar(page, 'archivar-fallo');
      // restaurar con un número repetido: el aviso está en la tarjeta archivada, que queda a la vista
      await page.getByRole('switch', { name: 'Ver clases archivadas' }).click();
      const vieja = page.getByRole('article', { name: 'Clase 20 · Vieja' });
      await vieja.getByRole('button', { name: 'Restaurar la clase 20' }).click();
      await expect(vieja.getByRole('alert')).toContainText('Ya hay una clase 20. Cámbiale el número a una de las dos.');
      await expect(vieja.getByRole('alert')).toBeInViewport();
      // cada aviso vive en SU tarjeta: el de archivar sigue en la 8 (nadie lo quitó) y el de restaurar, en la archivada
      await expect(page.getByRole('alert')).toHaveCount(2);
      await expect(octava.getByRole('alert')).toHaveCount(1);
      await revisar(page, 'restaurar-fallo');
    });

    test('«Editar» de otra clase con cambios sin guardar pregunta antes, y el foco no se pierde', async ({ page }) => {
      const sim = await simular(page, { vivas: [clase(), clase({ id: 'cl-2', numero: 6, titulo: 'Seis' })] });
      await abrirPestana(page);
      await page.getByRole('button', { name: 'Nueva clase' }).click();
      await page.getByLabel('Título').fill('Lo que estaba escribiendo');
      await page.getByRole('button', { name: 'Editar la clase 6' }).click();
      const dialogo = page.getByRole('alertdialog', { name: '¿Dejar lo que estás escribiendo?' });
      await expect(dialogo).toBeVisible();
      await expect(dialogo).toContainText('Tienes cambios sin guardar en «Nueva clase». Si sigues, se pierden.');
      await expect(dialogo.getByRole('button', { name: 'Seguir escribiendo' })).toBeFocused();
      await expect(dialogo.getByRole('button', { name: 'Editar la clase 6' })).not.toHaveCSS('background-color', 'rgb(218, 140, 40)');
      await revisar(page, 'editar-pregunta');
      // «Seguir escribiendo» no toca nada y devuelve el foco al formulario
      await dialogo.getByRole('button', { name: 'Seguir escribiendo' }).click();
      await expect(dialogo).toBeHidden();
      await expect(page.getByLabel('Número de clase')).toBeFocused();
      await expect(page.getByLabel('Título')).toHaveValue('Lo que estaba escribiendo');
      // «Editar la clase 6» cambia de formulario y el foco va al primer campo del nuevo
      await page.getByRole('button', { name: 'Editar la clase 6' }).click();
      await dialogo.getByRole('button', { name: 'Editar la clase 6' }).click();
      await expect(dialogo).toBeHidden();
      await expect(page.getByRole('region', { name: 'Editar la clase 6' })).toBeVisible();
      await expect(page.getByLabel('Título')).toHaveValue('Seis');
      await expect(page.getByLabel('Número de clase')).toBeFocused();
      expect(sim.pedidos.filter(p => p.startsWith('POST') || p.startsWith('PATCH'))).toEqual([]);
      await revisar(page, 'editar-otra');
    });

    test('cambiar de pestaña del panel no pierde el formulario a medias ni la subida en curso', async ({ page }) => {
      const sim = await simular(page, { vivas: [clase(), clase({ id: 'cl-2', numero: 6, titulo: 'Seis' })], subidaMs: 2500 });
      await abrirPestana(page);
      await page.getByRole('button', { name: 'Nueva clase' }).click();
      await page.getByLabel('Título').fill('Borrador a medias');
      await elegirConTeclado(page, 5, VIDEO);
      await expect(tarjeta(page, 5).getByRole('progressbar')).toBeVisible();
      await page.getByRole('tab', { name: '1 · Ingresos' }).click();
      await expect(page.getByLabel('Título')).toBeHidden();
      await page.getByRole('tab', { name: '4 · Clases' }).click();
      // el formulario conserva lo escrito y la subida sigue contándose como suya (barra y «Cancelar», no «Cancelar subida»)
      await expect(page.getByLabel('Título')).toHaveValue('Borrador a medias');
      await expect(tarjeta(page, 5).getByRole('progressbar').or(tarjeta(page, 5).getByText(/^Listo: /))).toBeVisible();
      await expect(tarjeta(page, 5).getByRole('button', { name: 'Cancelar subida' })).toHaveCount(0);
      await expect(tarjeta(page, 5).getByText('Listo: 1 h 02 min · 1.4 GB')).toBeVisible();
      expect(sim.clasesPedidas).toBe(1);
      await revisar(page, 'tras-cambiar-de-pestana', { foco: false });
    });

    test('nada de la pantalla se guarda en el almacenamiento del navegador', async ({ page }) => {
      await simular(page, { vivas: [clase()] });
      await abrirPestana(page);
      await page.getByRole('button', { name: 'Nueva clase' }).click();
      await page.getByLabel('Número de clase').fill('8');
      await page.getByLabel('Título').fill('Otra clase');
      await page.getByRole('button', { name: 'Guardar clase' }).click();
      await page.getByLabel('Subir video de la clase 5').setInputFiles(VIDEO);
      await expect(tarjeta(page, 5).getByText('Listo: 1 h 02 min · 1.4 GB')).toBeVisible();
      const guardado = await page.evaluate(() => ({ local: localStorage.length, sesion: sessionStorage.length }));
      expect(guardado).toEqual({ local: 0, sesion: 0 });
    });
  });
}
