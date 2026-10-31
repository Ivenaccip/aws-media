// Lo que comparten las pruebas de navegador del Constructor y del Asistente de Automatizaciones: cómo señalar cada cosa por su rol y su
// nombre, los pasos de armar un flujo con el ratón (elegir el disparador, el «+», la patita), lo que se mide en cada estado (desborde, letra,
// objetivos de 44 px, solapes, axe, foco) y la descarga real. NO gasta nada ni sale de la máquina: la API es de mentira (`page.route`) y la
// pantalla del Constructor no hace un solo pedido propio (se vigila: `simular` anota cualquier /api/ que no sea de los scripts de la página).
// Los textos están escritos a mano a propósito: si alguien cambia un rótulo, las pruebas lo notan en vez de seguirlo en silencio.
//
// Capturas: con AUTOMATIZA_CAPTURAS=<carpeta> (o PW_CAPTURAS) cada estado que se `revisa` se guarda como PNG para mirarlo.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, type Download, type Locator, type Page } from '@playwright/test';

const AXE = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
export const CAPTURAS = process.env.AUTOMATIZA_CAPTURAS ?? process.env.PW_CAPTURAS;

/** 1100 (escritorio), 390 (celular) y 320 (el celular más angosto que se mide en el repo). */
export const ANCHOS = [
  { ancho: 1100, alto: 900 },
  { ancho: 390, alto: 844 },
  { ancho: 320, alto: 700 },
] as const;

/** Un texto literal como expresión regular. */
export const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------------------
// La página y lo que pide por su cuenta

/** Lo único que la página del Constructor pide a /api/: lo piden sus scripts (auth.js, monedero.js y trabajos.js), no el lienzo. */
const PEDIDOS_DE_LA_PAGINA = ['/api/auth/config', '/api/creditos', '/api/trabajos'];

/**
 * Prepara la página: la bandeja de trabajos (la de abajo a la derecha, trabajos.js) lee /api/trabajos y aquí no hay ninguno; y anota
 * cualquier otro pedido a /api/ para poder decir, al final, que el Constructor no mandó nada a ningún servidor. `permitidos`: prefijos de
 * ruta que la pantalla SÍ puede pedir (el Asistente: `/api/automatiza/`).
 */
export async function simular(page: Page, permitidos: readonly string[] = []): Promise<{ ajenos: string[] }> {
  const ajenos: string[] = [];
  await page.route('**/api/trabajos', route => route.fulfill({ json: { trabajos: [], sondeo_s: 15 } }));
  page.on('request', r => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/') || PEDIDOS_DE_LA_PAGINA.includes(u.pathname) || permitidos.some(p => u.pathname.startsWith(p))) return;
    ajenos.push(`${r.method()} ${u.pathname}`);
  });
  return { ajenos };
}

export const URL_CONSTRUCTOR = '/estudio/constructor/';

export async function abrir(page: Page) {
  await page.goto(URL_CONSTRUCTOR);
  await expect(page.getByRole('heading', { level: 2, name: 'Arma tu automatización' })).toBeVisible();
}

// ---------------------------------------------------------------------------
// Cómo se señala cada cosa

export const principal = (page: Page) => page.locator('main');
/** El cuadro de avisos de abajo a la derecha (trabajos.js). */
export const bandeja = (page: Page) => page.locator('#bandeja');
/** El marco con scroll del lienzo. */
export const lienzo = (page: Page) => page.getByRole('group', { name: 'Lienzo del flujo' });
/** El panel de Ajustes (del cuadro, de la conexión o el vacío). */
export const ajustes = (page: Page) => page.locator('#ajustes');
/** El menú flotante del «+». */
export const menu = (page: Page) => page.getByRole('dialog');

export const campoNombre = (page: Page) => page.getByLabel('Nombre del flujo');
export const botonDeshacer = (page: Page) => principal(page).getByRole('button', { name: 'Deshacer', exact: true });
export const botonLimpiar = (page: Page) => principal(page).getByRole('button', { name: 'Limpiar', exact: true });
export const botonJson = (page: Page) => principal(page).getByRole('button', { name: /^(Ver|Ocultar) el JSON$/ });
export const botonDescargar = (page: Page) => principal(page).getByRole('button', { name: 'Descargar .json', exact: true });
export const avisoDeshacer = (page: Page) => bandeja(page).getByRole('button', { name: 'Deshacer', exact: true });
export const cajaJson = (page: Page) => page.getByRole('region', { name: 'JSON del flujo para n8n' });

/** El cuadro por el título que se ve en él («Chat», «Agente 1», «Gmail»). Es el botón con `data-nodo`. */
export const nodo = (page: Page, titulo: string) =>
  page.locator('[data-nodo]').and(page.getByRole('button', { name: new RegExp(`^[^:]+: ${esc(titulo)}\\. `) }));
/** Todos los cuadros del lienzo. */
export const nodos = (page: Page) => page.locator('[data-nodo]');
/** El «+» de la derecha de un cuadro. `nombre` es el nombre corto: «Disparador Chat», «Agente 1», «Gmail». */
export const mas = (page: Page, nombre: string) =>
  page.getByRole('button', { name: new RegExp(`^Agregar lo que sigue después de «${esc(nombre)}»`) });
/** El «+» de la patita de un agente. */
export const patita = (page: Page, agente: string) =>
  page.getByRole('button', { name: new RegExp(`^Darle una herramienta a «${esc(agente)}»`) });
/** La × de un cuadro. */
export const quitarX = (page: Page, nombre: string) => page.getByRole('button', { name: `Quitar «${nombre}»`, exact: true });
/** El círculo de la flecha de un cuadro a otro (nombres cortos). */
export const flecha = (page: Page, de: string, a: string) =>
  page.getByRole('button', { name: new RegExp(`^Conexión de «${esc(de)}» a «${esc(a)}»`) });
export const flechas = (page: Page) => page.locator('[data-insignia]');
/** Una opción del menú o de un panel, por el principio de su nombre. */
export const opcion = (donde: Locator, titulo: string | RegExp) =>
  donde.getByRole('button', { name: typeof titulo === 'string' ? new RegExp(`^${esc(titulo)}`) : titulo });

// ---------------------------------------------------------------------------
// Armar un flujo con el ratón

export type Disparador = 'Tiempo' | 'Chat' | 'Web' | 'App';

export async function elegirDisparador(page: Page, tipo: Disparador) {
  await page.getByRole('group', { name: 'Disparador del flujo' }).getByRole('button', { name: new RegExp(`^${tipo}`) }).click();
}

/** «+» → «Un agente de IA». `despuesDe` es el nombre corto del cuadro. */
export async function agregarAgente(page: Page, despuesDe: string) {
  await mas(page, despuesDe).click();
  await opcion(menu(page), 'Un agente de IA').click();
}

/** «+» → «Una aplicación» → la app de la lista. */
export async function agregarApp(page: Page, despuesDe: string, app: string) {
  await mas(page, despuesDe).click();
  await opcion(menu(page), 'Una aplicación').click();
  await menu(page).getByRole('button', { name: app, exact: true }).click();
}

/** La patita de un agente → la app de la lista (la patita abre directo la lista de apps). */
export async function darHerramienta(page: Page, agente: string, app: string) {
  await patita(page, agente).click();
  await menu(page).getByRole('button', { name: app, exact: true }).click();
}

/** Chat → «Agente 1» → Gmail (los cuadros más sencillos que descargan). */
export async function flujoSencillo(page: Page) {
  await elegirDisparador(page, 'Chat');
  await agregarAgente(page, 'Disparador Chat');
  await agregarApp(page, 'Agente 1', 'Gmail');
  await expect(nodos(page)).toHaveCount(3);
}

// ---------------------------------------------------------------------------
// El archivo

export interface Archivo {
  descarga: Download;
  nombre: string;
  texto: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el .json de n8n: cada prueba lo mira por dentro con su propia forma
  json: any;
}

/** Pulsa «Descargar .json» y espera la descarga de verdad: el nombre que sugiere el navegador y el archivo ya leído. */
export async function descargar(page: Page): Promise<Archivo> {
  const [descarga] = await Promise.all([page.waitForEvent('download'), botonDescargar(page).click()]);
  const ruta = await descarga.path();
  const texto = readFileSync(ruta, 'utf8');
  return { descarga, nombre: descarga.suggestedFilename(), texto, json: JSON.parse(texto) };
}

/** Los tipos de nodo de n8n de un flujo exportado, en orden. */
export const tiposDe = (json: { nodes: Array<{ type: string }> }): string[] => json.nodes.map(n => n.type);

/** Lo que n8n tendría que poder importar: un flujo con nodos, conexiones y ajustes, sin valores vacíos de verdad. */
export function esFlujoDeN8n(json: unknown): boolean {
  if (typeof json !== 'object' || json === null) return false;
  const f = json as Record<string, unknown>;
  return (
    typeof f.name === 'string' &&
    Array.isArray(f.nodes) &&
    f.nodes.length > 0 &&
    typeof f.connections === 'object' &&
    f.connections !== null &&
    typeof f.settings === 'object' &&
    f.settings !== null
  );
}

// ---------------------------------------------------------------------------
// El borrador del navegador (decisión D3: localStorage, con la llave versionada)

export const CLAVE_BORRADOR = 'constructor.borrador.v1';

export const leerBorrador = (page: Page) => page.evaluate(k => localStorage.getItem(k), CLAVE_BORRADOR);

/** Espera (con reintento) a que el borrador se escriba: el guardado es diferido 500 ms después del último cambio. */
export async function esperarBorrador(page: Page, cuando: (b: { nodes: Array<{ id: string; kind: string; nombre?: string }>; nombreFlujo: string }) => boolean = () => true) {
  await expect
    .poll(async () => {
      const crudo = await leerBorrador(page);
      if (!crudo) return false;
      try {
        return cuando(JSON.parse(crudo));
      } catch {
        return false;
      }
    })
    .toBe(true);
}

// ---------------------------------------------------------------------------
// Lo que se mide en cada estado

export interface Medidas {
  vw: number;
  scrollW: number;
  alto: number;
  minFont: number;
  finos: string[];
  fuera: string[];
  chicos: string[];
  h1: number;
}

/**
 * Desborde horizontal de la página, la letra más chica, los textos que se salen de su caja o de la ventana y los objetivos menores de 44 px.
 * Lo que está DENTRO del marco del lienzo se mide contra el marco, no contra la ventana: el lienzo se desplaza por dentro y sus cuadros
 * pueden estar fuera de la vista sin ser un defecto (el marco no ensancha la página: eso lo dice `scrollW`).
 */
export async function medir(page: Page): Promise<Medidas> {
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
    // lo que se desplaza por dentro (el marco del lienzo y la caja del JSON) tiene su propio recorte: su texto no se mide contra la ventana
    // ni contra el marco, sino que se mide el CONTENEDOR (más abajo) y que no ensanche la página (`scrollW`)
    const conScroll = (e: Element) => e.closest('[role="group"][aria-label="Lienzo del flujo"], [role="region"][aria-label="JSON del flujo para n8n"]');
    const fuera: string[] = [];
    const finos: string[] = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let minFont = 99;
    while (tw.nextNode()) {
      const n = tw.currentNode;
      const t = (n.textContent ?? '').trim();
      const p = n.parentElement;
      // #monedero / #mon-panel: la píldora del saldo (static/monedero.js) es de todas las pantallas
      if (!t || !p || !visible(p) || oculto(p) || p.closest('.sr-only,[hidden],script,style,#monedero,#mon-panel')) continue;
      const rango = document.createRange();
      rango.selectNodeContents(n);
      const rr = rango.getBoundingClientRect();
      if (rr.width === 0) continue;
      const fs = parseFloat(getComputedStyle(p).fontSize);
      minFont = Math.min(minFont, fs);
      if (fs < 13) finos.push(`${t.slice(0, 30)} (${fs}px)`);
      const contenedor = conScroll(p);
      if (contenedor === null && (rr.left < -0.5 || rr.right > vw + 0.5)) fuera.push(`${t.slice(0, 30)} se sale de la ventana`);
      // el texto de un cuadro se corta con puntos suspensivos a propósito (`text-overflow: ellipsis`): no cuenta como «se sale»
      if (p.closest('.cn-nodo-txt')) continue;
      const caja = p.closest('article, [role="alert"], [role="status"], .rounded-boton, .rounded-grande, button, a');
      if (caja && visible(caja) && caja !== contenedor && !(contenedor && caja.contains(contenedor))) {
        const rc = caja.getBoundingClientRect();
        if (rr.left < rc.left - 0.5 || rr.right > rc.right + 0.5) fuera.push(`${t.slice(0, 30)} se sale de su caja`);
      }
    }
    // los contenedores con scroll propio caben en la ventana (lo de adentro se desplaza; el contenedor no se sale)
    for (const c of document.querySelectorAll('[role="group"][aria-label="Lienzo del flujo"], [role="region"][aria-label="JSON del flujo para n8n"]')) {
      const r = c.getBoundingClientRect();
      if (r.width > 0 && (r.left < -0.5 || r.right > vw + 0.5)) fuera.push(`${c.getAttribute('aria-label')} se sale de la ventana`);
    }
    const chicos: string[] = [];
    for (const e of document.querySelectorAll('button, a[href], input:not([type=hidden]), textarea, select, summary, [tabindex="0"]')) {
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

/** axe (WCAG 2.0 a 2.2 A y AA y buenas prácticas) sobre lo que se ve ahora, sin la píldora del saldo. Devuelve lo que encontró, legible. */
export async function axe(page: Page): Promise<string[]> {
  await page.evaluate(AXE);
  return page.evaluate(async () => {
    const run = (window as unknown as { axe: { run: (c: object, o: object) => Promise<{ violations: Array<{ id: string; nodes: Array<{ target: unknown[] }> }> }> } }).axe;
    // la píldora del saldo (monedero.js) es de todas las pantallas, no de ésta
    const r = await run.run({ include: [['body']], exclude: [['#monedero'], ['#mon-panel'], ['#mon-real']] }, { resultTypes: ['violations'] });
    return r.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  });
}

/** ¿El foco está en el cuerpo de la página (o en nada)? Nunca debería: siempre hay un control enfocado. */
export const focoEnElCuerpo = (page: Page) => page.evaluate(() => document.activeElement === document.body || document.activeElement === null);

/** Mide, pasa axe y comprueba que el foco no esté en el body. `nombre` es el de la captura. */
export async function revisar(page: Page, nombre: string, opciones: { foco?: boolean } = {}) {
  const m = await medir(page);
  expect(m.scrollW, `${nombre}: desborde horizontal`).toBeLessThanOrEqual(m.vw);
  expect(m.fuera, `${nombre}: textos fuera de su caja`).toEqual([]);
  expect(m.finos, `${nombre}: letra menor de 13 px`).toEqual([]);
  expect(m.chicos, `${nombre}: objetivos menores de 44 px`).toEqual([]);
  expect(m.h1, `${nombre}: un solo h1`).toBe(1);
  expect(await axe(page), `${nombre}: axe`).toEqual([]);
  if (opciones.foco !== false) expect(await focoEnElCuerpo(page), `${nombre}: el foco cayó al body`).toBe(false);
  if (CAPTURAS) await page.screenshot({ path: join(CAPTURAS, `${nombre}-${m.vw}.png`), fullPage: true });
}

/**
 * Los pares de controles del lienzo cuyas áreas táctiles se tapan, con cuánto. La × se cuelga a propósito de la esquina de su cuadro (el
 * clic lo gana la ×) y eso no cuenta; lo demás sí. `dibujos`: si se miden los círculos que se ven (los de 24 y 28 px) en vez de las
 * áreas de 44 px.
 */
export async function solapes(page: Page, dibujos = false): Promise<string[]> {
  return page.evaluate(soloDibujos => {
    const lista = [...document.querySelectorAll<HTMLElement>('.cn-lienzo button')]
      .filter(b => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map(b => {
        const caja = soloDibujos ? (b.querySelector<HTMLElement>('.cn-dibujo') ?? b) : b;
        return { nombre: (b.getAttribute('aria-label') ?? b.textContent ?? '').trim().slice(0, 36), r: caja.getBoundingClientRect(), esCuadro: b.hasAttribute('data-nodo'), esX: b.hasAttribute('data-quitar') };
      });
    const tapados: string[] = [];
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        const a = lista[i]!;
        const c = lista[j]!;
        // un cuadro y lo que cuelga de él (la ×, los «+», la patita) comparten esquina a propósito; dos cuadros entre sí no deberían
        if ((a.esCuadro && !c.esCuadro) || (c.esCuadro && !a.esCuadro)) continue;
        const ancho = Math.min(a.r.right, c.r.right) - Math.max(a.r.left, c.r.left);
        const alto = Math.min(a.r.bottom, c.r.bottom) - Math.max(a.r.top, c.r.top);
        if (ancho > 0.5 && alto > 0.5) tapados.push(`${a.nombre} × ${c.nombre}: ${Math.round(ancho)}×${Math.round(alto)}`);
      }
    }
    return tapados;
  }, dibujos);
}

/** Cuánto vale el aro de foco del control enfocado: el suyo o, en los botones de 44 px, el de su dibujo interior (nunca los dos). */
export function aroDelFoco(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const trazo = (e: Element) => {
      const c = getComputedStyle(e);
      return { ancho: parseFloat(c.outlineWidth), estilo: c.outlineStyle, color: c.outlineColor };
    };
    const propio = trazo(el);
    const dibujo = el.querySelector('.cn-dibujo');
    const interior = dibujo ? trazo(dibujo) : null;
    const lleva = (t: { ancho: number; estilo: string } | null) => t !== null && t.ancho >= 2 && t.estilo !== 'none';
    return { propio, interior, nombre: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? el.tagName, aros: Number(lleva(propio)) + Number(lleva(interior)) };
  });
}
