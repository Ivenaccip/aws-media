// Lo que comparten las pruebas de navegador del Asistente de Automatizaciones (/estudio/automatizaciones/distrito/asistente/): el servidor
// de mentira con la forma del contrato real (server/automatiza_api.py, modo «prueba»: GET /config, POST /armar, GET /armar/{id}), con el
// flujo de n8n y el grafo salidos de las MUESTRAS de verdad (media/library/n8n/muestras_prueba.json) para que lo que se descarga y lo que
// se abre en el Constructor sea real, y las maneras de señalar cada cosa por su rol y su nombre. NO gasta nada ni sale de la máquina:
// ninguna ruta toca el servidor. Los textos están escritos a mano a propósito: si alguien cambia un rótulo, las pruebas lo notan en vez de
// seguirlo en silencio.
//
// La medición (`revisar`: desborde, letra, 44 px, axe, foco) es la del Constructor (e2e/constructor.ts): una sola para las dos pantallas.
import { readFileSync } from 'node:fs';

import { expect, type Page, type Route } from '@playwright/test';

import { simular as simularPagina } from './constructor';

export const URL_ASISTENTE = '/estudio/automatizaciones/distrito/asistente/';

// ---------------------------------------------------------------------------
// Las muestras de verdad (las mismas con las que responde el servidor en modo «prueba»)

interface Muestra {
  id: string;
  estado: string;
  claves: string[];
  resumen?: string;
  flujo?: { name: string; nodes: Array<{ type: string; name: string }> };
  grafo?: { nombreFlujo: string; nodes: unknown[]; edges: unknown[] };
  faltan?: string[];
}

const MUESTRAS = (JSON.parse(readFileSync(new URL('../../media/library/n8n/muestras_prueba.json', import.meta.url), 'utf8')) as { muestras: Muestra[] }).muestras;

/** La muestra «Responder correos de clientes» (la que sale con «correo», «gmail», «email»…). */
export const MUESTRA_CORREOS = MUESTRAS.find(m => m.id === 'correos')!;
/** «Asistente de preguntas frecuentes» (con «chat», «preguntas», «whatsapp»…). */
export const MUESTRA_PREGUNTAS = MUESTRAS.find(m => m.claves.includes('chat'))!;
/** La que dice «todavía no sabemos armar esto» (con «hubspot», «github», «instagram»…). */
export const MUESTRA_SIN_COBERTURA = MUESTRAS.find(m => m.estado === 'sin_cobertura')!;

// ---------------------------------------------------------------------------
// El servidor de mentira

export const CONFIG = {
  activo: true,
  modo: 'prueba',
  gratis: true,
  costo_creditos: 0,
  largo_minimo: 20,
  largo_maximo: 1500,
  cupo: null,
};

export const ID = 'p1.eyJ1IjoiYWJjIiwidCI6MSwibSI6ImNvcnJlb3MifQ';

/** El 202 de `POST /armar`. */
export const INICIO = { id: ID, estado: 'armando', modo: 'prueba', paso: 'entender', costo_creditos: 0 };

export const armandoEn = (paso: string) => ({ id: ID, estado: 'armando', listo: false, modo: 'prueba', lleva_seg: 5, paso });

/** `GET /armar/{id}` terminado bien, con el flujo y el grafo de una muestra. `extra` pisa llaves (o las quita con `undefined`). */
export function listo(muestra: Muestra = MUESTRA_CORREOS, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const flujo = muestra.flujo!;
  const cuerpo: Record<string, unknown> = {
    id: ID,
    estado: 'listo',
    listo: true,
    modo: 'prueba',
    lleva_seg: 6,
    nombre: flujo.name,
    resumen: muestra.resumen ?? null,
    nodos: flujo.nodes.map(n => ({ tipo: n.type, nombre: n.name, etiqueta: n.name, nombre_en_flujo: n.name })),
    pendientes: ['Conecta tu cuenta de Gmail en n8n y elige el destinatario.', 'Conecta tu cuenta de OpenAI en n8n.'],
    advertencias: [],
    flujo,
    grafo: muestra.grafo,
  };
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete cuerpo[k];
    else cuerpo[k] = v;
  }
  return cuerpo;
}

export const sinCobertura = (): Record<string, unknown> => ({
  id: ID,
  estado: 'sin_cobertura',
  listo: false,
  modo: 'prueba',
  lleva_seg: 6,
  mensaje: 'Todavía no sabemos armar esto con n8n.',
  faltan: MUESTRA_SIN_COBERTURA.faltan ?? [],
});

export interface Respuesta {
  status: number;
  body: unknown;
  /** Si lleva una promesa, la respuesta espera a que se cumpla. */
  espera?: Promise<void>;
  /** Corta la conexión en lugar de contestar. */
  cortar?: boolean;
}

export const ok = (body: unknown, status = 200): Respuesta => ({ status, body });
/** Un error del API: `detail = {codigo, texto, …}`. */
export const falla = (status: number, codigo: string, texto: string, extra: Record<string, unknown> = {}): Respuesta => ({
  status,
  body: { detail: { codigo, texto, ...extra } },
});
export const sinRed: Respuesta = { status: 0, body: null, cortar: true };

export interface Sim {
  config: Respuesta;
  /** Las respuestas de `POST /armar`, en orden; si no quedan, el 202 de prueba. */
  armar: Respuesta[];
  /** Las respuestas de `GET /armar/{id}`, en orden; la última se repite. Sin ninguna, el flujo de las muestras. */
  consultar: Respuesta[];
  pedidos: Array<{ texto: string }>;
  consultas: string[];
  /** Cuántas veces se preguntó la configuración. */
  configs: number;
  /** Cuándo (Date.now() del navegador de pruebas) llegó cada pregunta de cómo va el armado. */
  cuando: number[];
}

async function responder(route: Route, r: Respuesta) {
  if (r.espera) await r.espera;
  if (r.cortar) return route.abort('internetdisconnected');
  return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
}

/** Prepara la página con el servidor de mentira del Asistente (y la bandeja). Devuelve lo que se fue pidiendo, para mirarlo al final. */
export async function simular(page: Page, parcial: Partial<Sim> = {}): Promise<Sim & { ajenos: string[] }> {
  const { ajenos } = await simularPagina(page, ['/api/automatiza/']);
  const sim: Sim & { ajenos: string[] } = {
    config: ok(CONFIG),
    armar: [],
    consultar: [],
    pedidos: [],
    consultas: [],
    configs: 0,
    cuando: [],
    ...parcial,
    ajenos,
  };
  await page.route('**/api/automatiza/config', route => {
    sim.configs += 1;
    return responder(route, sim.config);
  });
  await page.route('**/api/automatiza/armar', route => {
    sim.pedidos.push(route.request().postDataJSON() as { texto: string });
    return responder(route, sim.armar.shift() ?? ok(INICIO, 202));
  });
  await page.route('**/api/automatiza/armar/*', route => {
    sim.consultas.push(decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()!));
    sim.cuando.push(Date.now());
    const siguiente = sim.consultar.length > 1 ? sim.consultar.shift()! : (sim.consultar[0] ?? ok(listo()));
    return responder(route, siguiente);
  });
  return sim;
}

// ---------------------------------------------------------------------------
// Cómo se señala cada cosa

export const TEXTO_DE_LA_PERSONA = 'Cuando me llegue un correo de un cliente, que una IA le conteste y lo anote en una hoja';

export async function abrir(page: Page) {
  await page.goto(URL_ASISTENTE);
  await expect(page.getByRole('heading', { level: 2, name: 'Cuéntanos qué quieres automatizar' })).toBeVisible();
}

export const principal = (page: Page) => page.locator('main');
export const cuadro = (page: Page) => page.getByRole('textbox', { name: 'Cuéntale qué necesitas' });
export const armar = (page: Page) => page.getByRole('button', { name: /^Armar (otro )?flujo$|^Armando…$/ });
export const contador = (page: Page) => page.locator('#asis-cuenta');
export const ejemplos = (page: Page) => page.getByRole('list', { name: 'Ejemplos para empezar' }).getByRole('button');
export const pasos = (page: Page) => page.getByRole('list', { name: 'Pasos' });
export const tituloListo = (page: Page) => page.getByRole('heading', { level: 2, name: 'Tu flujo está listo' });
export const botonDescargar = (page: Page) => principal(page).getByRole('button', { name: 'Descargar .json', exact: true });
export const botonAbrirEnConstructor = (page: Page) => principal(page).getByRole('button', { name: 'Abrir en el constructor', exact: true });
export const copiarJson = (page: Page) => principal(page).getByRole('button', { name: /^(Copiar|Copiado)/ });
/** El cuadro de avisos de abajo a la derecha (trabajos.js): el Asistente no lo usa, pero no debe haber nada ahí. */
export const bandeja = (page: Page) => page.locator('#bandeja');
/** La región viva de la pantalla (una sola): lo que se le dice al lector de pantalla. */
export const regionViva = (page: Page) => page.locator('main p.sr-only[role="status"]');

/** Escribe el pedido y pulsa «Armar flujo». */
export async function pedir(page: Page, texto = TEXTO_DE_LA_PERSONA) {
  await cuadro(page).fill(texto);
  await armar(page).click();
}

/** El paso que se está haciendo ahora (el que lleva `aria-current="step"`) y los que ya terminaron. */
export async function estadoDePasos(page: Page): Promise<{ activo: string | null; hechos: string[] }> {
  const items = pasos(page).getByRole('listitem');
  const textos = await items.allInnerTexts();
  const actual = await items.evaluateAll(lis => lis.map(li => li.getAttribute('aria-current') === 'step'));
  const iconoHecho = await items.evaluateAll(lis => lis.map(li => li.querySelector('svg') !== null));
  return {
    activo: textos.find((_, i) => actual[i]) ?? null,
    hechos: textos.filter((_, i) => iconoHecho[i] && !actual[i]),
  };
}
