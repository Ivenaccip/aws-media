// Lo que comparten las pruebas del Asistente: el servidor de mentira (config, armar, consultar) y las respuestas que daría de verdad
// (server/automatiza_api.py en modo «prueba»). No es una prueba: aquí no hay `it`.
import { json, servidor, type Ruta } from '../../prueba/servidor';
import { ejemplo } from '../constructor/modelo/ejemplos';

export const CONFIG = {
  activo: true,
  modo: 'prueba',
  gratis: true,
  costo_creditos: 0,
  largo_minimo: 20,
  largo_maximo: 1500,
  cupo: null,
};

/** El 202 de `POST /armar`. */
export const INICIO = { id: 'p1.eyJtIjoiY29ycmVvIn0', estado: 'armando', modo: 'prueba', paso: 'entender', costo_creditos: 0 };

/** El flujo de n8n que baja «Descargar .json» (lo mínimo que parece uno). */
export const FLUJO = {
  name: 'Responder correos de clientes',
  nodes: [{ name: 'Gmail Trigger', type: 'n8n-nodes-base.gmailTrigger', typeVersion: 1.2, position: [0, 0], parameters: {} }],
  connections: {},
  settings: {},
};

/** El mismo flujo como grafo del Constructor (el de ejemplo del propio Constructor: cinco cuadros, cuatro conexiones). */
export const grafo = () => {
  const f = ejemplo();
  return { nombreFlujo: f.nombreFlujo, nodes: f.nodes, edges: f.edges };
};

/** `GET /armar/{id}` terminado bien. `extra` pisa llaves (o las quita con `undefined`). */
export function listo(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const cuerpo: Record<string, unknown> = {
    id: INICIO.id,
    estado: 'listo',
    listo: true,
    modo: 'prueba',
    lleva_seg: 4,
    nombre: FLUJO.name,
    resumen: 'Cuando llega un correo nuevo, una IA redacta la respuesta y te la envía por Gmail.',
    nodos: [
      { tipo: 'n8n-nodes-base.gmailTrigger', nombre: 'Gmail Trigger', etiqueta: 'Llega un correo (Gmail)', nombre_en_flujo: 'Gmail Trigger' },
      { tipo: '@n8n/n8n-nodes-langchain.agent', nombre: 'AI Agent', etiqueta: 'Agente de IA', nombre_en_flujo: 'Atención por correo' },
      { tipo: 'n8n-nodes-base.gmail', nombre: 'Gmail', etiqueta: 'Gmail (paso)', nombre_en_flujo: 'Gmail' },
    ],
    pendientes: ['Conecta tu cuenta de Gmail en n8n y elige el destinatario.', 'Conecta tu cuenta de OpenAI en n8n.'],
    advertencias: [],
    flujo: FLUJO,
    grafo: grafo(),
  };
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete cuerpo[k];
    else cuerpo[k] = v;
  }
  return cuerpo;
}

export const armandoEn = (paso: string) => ({ id: INICIO.id, estado: 'armando', listo: false, modo: 'prueba', lleva_seg: 1, paso });

export const SIN_COBERTURA = {
  id: INICIO.id,
  estado: 'sin_cobertura',
  listo: false,
  modo: 'prueba',
  lleva_seg: 4,
  mensaje: 'Todavía no sabemos armar esto con n8n.',
  faltan: ['En esta prueba, apps como HubSpot, GitHub, Instagram, lectores de RSS y Google Calendar todavía no se pueden conectar.'],
};

/** Un error del API: `detail = {codigo, texto}`. */
export const falla = (status: number, codigo: string, texto: string, extra: Record<string, unknown> = {}) =>
  json({ detail: { codigo, texto, ...extra } }, status);

export interface Guion {
  config?: Ruta;
  /** `POST /api/automatiza/armar` */
  armar?: Ruta;
  /** `GET /api/automatiza/armar/{id}` */
  consultar?: Ruta;
}

/** El servidor del Asistente: una sola ruta para `armar` y `armar/{id}` (el método dice cuál es). */
export function asistente(g: Guion = {}) {
  const armar = g.armar ?? (() => json(INICIO, 202));
  const consultar = g.consultar ?? (() => json(listo()));
  return servidor({
    '/api/automatiza/config': g.config ?? (() => json(CONFIG)),
    '/api/automatiza/armar': (url, init) => (init?.method === 'POST' ? armar(url, init) : consultar(url, init)),
  });
}

type Llamadas = ReturnType<typeof servidor>;

export const pedidos = (f: Llamadas) => f.mock.calls.filter(c => c[0] === '/api/automatiza/armar' && c[1]?.method === 'POST');
export const consultas = (f: Llamadas) => f.mock.calls.filter(c => String(c[0]).startsWith('/api/automatiza/armar/'));
export const cuerpoDe = (llamada: Llamadas['mock']['calls'][number]) => JSON.parse(String(llamada[1]?.body)) as Record<string, unknown>;

/** Un almacenamiento en memoria con la forma de `Storage`, para el borrador del Constructor. */
export function memoria(inicial: Record<string, string> = {}) {
  const datos = new Map(Object.entries(inicial));
  return {
    datos,
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
    removeItem: (k: string) => void datos.delete(k),
  };
}
