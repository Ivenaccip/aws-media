// El flujo de ejemplo del lienzo vacío, las tres muestras con las que responde el Asistente en modo
// «prueba» y las frases de ejemplo del Asistente. Idénticos al mockup (Main.dc.html:789-793,
// 828-846 y 1551-1578): mismos ids bajos (t1, a1, a2, p1, p2, e1…e4, para no chocar con el
// contador de ids, que arranca en 20) y mismas coordenadas. Cada llamada arma objetos NUEVOS:
// quien los reciba puede guardarlos en su estado sin que otro los comparta.

import { norm } from './texto';
import type { Arista, Flujo, Muestra, Nodo, NodoAgente, NodoApp, NodoDisparador, TipoArista } from './tipos';

/** El nombre que lleva el flujo de ejemplo. */
export const NOMBRE_EJEMPLO = 'Atención a clientes';

/** Frases para probar el Asistente. */
export const EJEMPLOS: readonly string[] = [
  'Cuando me llegue un correo de un cliente, que una IA le conteste y lo anote en una hoja de cálculo',
  'Un chat donde mis clientes pregunten lo de siempre, una IA les responda y otra IA revise la respuesta',
  'Cada mañana, un resumen de lo importante por correo y por Slack',
];

function agente(
  id: string,
  x: number,
  y: number,
  nombre: string,
  ia: NodoAgente['ia'],
  tarea: string,
  instrucciones: string,
): NodoAgente {
  return { id, kind: 'agent', x, y, nombre, ia, tarea, instrucciones };
}

function app(id: string, x: number, y: number, nombre: string): NodoApp {
  return { id, kind: 'app', x, y, nombre };
}

function disparador(tipo: NodoDisparador['tipo'], extra: Partial<NodoDisparador> = {}): NodoDisparador {
  return { id: 't1', kind: 'trigger', x: 8, y: 180, tipo, frec: 'dia', ruta: 'mi-flujo', app: 'gmail', ...extra };
}

function arista(n: number, de: string, a: string, tipo: TipoArista): Arista {
  return { id: `e${n}`, de, a, tipo };
}

/**
 * El ejemplo: un chat → «Atención a clientes» (que consulta Google Sheets) → «Revisor» (que avisa
 * por Slack). Las dos apps son herramientas de sus agentes (`tool`).
 */
export function ejemplo(): Flujo {
  const nodes: Nodo[] = [
    disparador('chat'),
    agente(
      'a1',
      312,
      180,
      'Atención a clientes',
      'openai',
      '',
      'Eres el asistente de atención a clientes. Responde en español, con claridad y amabilidad. Si necesitas un dato, búscalo en la hoja de Google Sheets.',
    ),
    agente(
      'a2',
      616,
      180,
      'Revisor',
      'anthropic',
      '',
      'Revisa la respuesta que te llega: que sea clara, amable y corta. Si habla de algo delicado, avisa al equipo en Slack.',
    ),
    app('p1', 176, 380, 'Google Sheets'),
    app('p2', 480, 380, 'Slack'),
  ];
  const edges: Arista[] = [
    arista(1, 't1', 'a1', 'seq'),
    arista(2, 'a1', 'a2', 'seq'),
    arista(3, 'a1', 'p1', 'tool'),
    arista(4, 'a2', 'p2', 'tool'),
  ];
  return { nodes, edges, nombreFlujo: NOMBRE_EJEMPLO };
}

/** «Responder correos de clientes»: llega un correo, un agente lo contesta (consulta una hoja) y responde por Gmail. */
function muestraCorreos(): Muestra {
  return {
    claves: ['correo', 'gmail', 'email', 'mail'],
    nombre: 'Responder correos de clientes',
    nodes: [
      disparador('app', { app: 'gmail' }),
      agente(
        'a1',
        312,
        180,
        'Atención por correo',
        'openai',
        'Lee el correo nuevo y redacta una respuesta amable con la información que tengas. Si no sabes algo, dilo.',
        'Eres el asistente de atención al cliente. Responde en español, breve y amable.',
      ),
      app('p1', 176, 380, 'Google Sheets'),
      app('p2', 616, 180, 'Gmail'),
    ],
    edges: [arista(1, 't1', 'a1', 'seq'), arista(2, 'a1', 'p2', 'seq'), arista(3, 'a1', 'p1', 'tool')],
    fuentes: ['Llega un correo (Gmail)', 'Agente de IA', 'Google Sheets (lo consulta el agente)', 'Gmail (paso final)'],
  };
}

/** «Asistente de preguntas frecuentes»: un chat, un agente (que consulta Notion) y otro que revisa lo que respondió. */
function muestraPreguntas(): Muestra {
  return {
    claves: ['chat', 'preguntas', 'whatsapp', 'telegram', 'investig'],
    nombre: 'Asistente de preguntas frecuentes',
    nodes: [
      disparador('chat'),
      agente(
        'a1',
        312,
        180,
        'Atención',
        'anthropic',
        '',
        'Responde las preguntas frecuentes con claridad. Si necesitas datos de la base de conocimiento, búscalos en Notion.',
      ),
      agente(
        'a2',
        616,
        180,
        'Revisor',
        'openai',
        '',
        'Revisa la respuesta: que sea clara, amable y corta, y déjala lista para enviar.',
      ),
      app('p1', 176, 380, 'Notion'),
    ],
    edges: [arista(1, 't1', 'a1', 'seq'), arista(2, 'a1', 'a2', 'seq'), arista(3, 'a1', 'p1', 'tool')],
    fuentes: [
      'Alguien escribe en el chat',
      'Agente de IA',
      'Otro agente de IA (va después)',
      'Notion (lo consulta el agente)',
    ],
  };
}

/** «Resumen diario»: cada día un agente prepara un resumen y lo manda por Gmail y por Slack. Es la muestra de reserva. */
function muestraResumen(): Muestra {
  return {
    claves: [],
    nombre: 'Resumen diario',
    nodes: [
      disparador('tiempo', { frec: 'dia' }),
      agente(
        'a1',
        312,
        180,
        'Resumidor',
        'openai',
        'Prepara un resumen de lo importante del día.',
        'Escribe en español, en viñetas cortas.',
      ),
      app('p1', 616, 80, 'Gmail'),
      app('p2', 616, 288, 'Slack'),
    ],
    edges: [arista(1, 't1', 'a1', 'seq'), arista(2, 'a1', 'p1', 'seq'), arista(3, 'a1', 'p2', 'seq')],
    fuentes: ['Cada día', 'Agente de IA', 'Gmail (paso)', 'Slack (paso)'],
  };
}

/** Las tres muestras del Asistente en modo «prueba». La última (sin palabras clave) es la de reserva. */
export function muestras(): Muestra[] {
  return [muestraCorreos(), muestraPreguntas(), muestraResumen()];
}

/**
 * La muestra que le toca a un pedido: la primera cuyas palabras clave salgan en el texto (sin
 * mayúsculas ni acentos). Si ninguna sale, la última («Resumen diario»).
 */
export function muestraDe(texto: unknown): Muestra {
  const t = norm(texto);
  const hallada = [muestraCorreos(), muestraPreguntas()].find(m => m.claves.some(c => t.includes(norm(c))));
  return hallada ?? muestraResumen();
}
