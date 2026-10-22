// Cómo se exporta cada disparador a n8n: type, typeVersion, nombre base, credencial y
// parámetros. Datos de media/library/n8n/catalog.json y permitidos.json (catalogo.test.ts lo
// comprueba). Una variante por combinación: tiempo, chat, web, app+Telegram, app+Gmail.
//
// Misma regla que en el mockup: lo que no es tiempo, chat ni web se decide por `app`
// (Telegram si es «telegram»; Gmail en cualquier otro caso).

import { rutaLimpia } from '../texto';
import type { DefAgenteN8n, DefDisparadorN8n, NodoDisparador } from '../tipos';

/** Cada hora, cada día a las 9:00 o cada lunes a las 9:00 (lo desconocido cae en «cada día»). */
const DISPARADOR_TIEMPO: DefDisparadorN8n = {
  tipo: 'n8n-nodes-base.scheduleTrigger',
  version: 1.4,
  nombreBase: 'Schedule Trigger',
  cred: null,
  conWebhookId: false,
  conZona: true,
  params: n => ({
    rule: {
      interval: [
        n.frec === 'hora'
          ? { field: 'hours', hoursInterval: 1 }
          : n.frec === 'lunes'
            ? { field: 'weeks', triggerAtDay: [1], triggerAtHour: 9 }
            : { field: 'days', triggerAtHour: 9 },
      ],
    },
  }),
};

/** El chat público de n8n. */
const DISPARADOR_CHAT: DefDisparadorN8n = {
  tipo: '@n8n/n8n-nodes-langchain.chatTrigger',
  version: 1.5,
  nombreBase: 'When chat message received',
  cred: null,
  conWebhookId: true,
  conZona: false,
  params: () => ({ public: true, options: { responseMode: 'streaming' } }),
};

/** Un webhook POST con la ruta que escribió la persona, ya limpia. */
const DISPARADOR_WEB: DefDisparadorN8n = {
  tipo: 'n8n-nodes-base.webhook',
  version: 2.1,
  nombreBase: 'Webhook',
  cred: null,
  conWebhookId: true,
  conZona: false,
  params: (n: NodoDisparador) => ({ httpMethod: 'POST', path: rutaLimpia(n.ruta), options: {} }),
};

/** Llega un mensaje a Telegram. */
const DISPARADOR_TELEGRAM: DefDisparadorN8n = {
  tipo: 'n8n-nodes-base.telegramTrigger',
  version: 1.5,
  nombreBase: 'Telegram Trigger',
  cred: { clave: 'telegramApi', nombre: 'Telegram' },
  conWebhookId: false,
  conZona: false,
  params: () => ({ updates: ['message'], additionalFields: {} }),
};

/** Llega un correo a Gmail (revisa cada minuto). */
const DISPARADOR_GMAIL: DefDisparadorN8n = {
  tipo: 'n8n-nodes-base.gmailTrigger',
  version: 1.4,
  nombreBase: 'Gmail Trigger',
  cred: { clave: 'gmailOAuth2', nombre: 'Gmail' },
  conWebhookId: false,
  conZona: false,
  params: () => ({ pollTimes: { item: [{ mode: 'everyMinute' }] }, simple: false, filters: {}, options: {} }),
};

/** Las cinco variantes, para recorrerlas (pruebas y paridad). */
export const DISPARADORES_N8N: readonly DefDisparadorN8n[] = [
  DISPARADOR_TIEMPO,
  DISPARADOR_CHAT,
  DISPARADOR_WEB,
  DISPARADOR_TELEGRAM,
  DISPARADOR_GMAIL,
];

/** La definición de n8n que le toca a este disparador. */
export function disparadorN8n(n: Pick<NodoDisparador, 'tipo' | 'app'>): DefDisparadorN8n {
  if (n.tipo === 'tiempo') return DISPARADOR_TIEMPO;
  if (n.tipo === 'chat') return DISPARADOR_CHAT;
  if (n.tipo === 'web') return DISPARADOR_WEB;
  return n.app === 'telegram' ? DISPARADOR_TELEGRAM : DISPARADOR_GMAIL;
}

/** El agente de IA de n8n (el que lleva el prompt y conecta su modelo, sus herramientas y sus ayudantes). */
export const AGENTE_N8N: DefAgenteN8n = {
  tipo: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  nombreBase: 'AI Agent',
};

/**
 * Una IA que conversa con otra se exporta como «AI Agent Tool» del agente principal, que le pregunta
 * cuantas veces haga falta. Hoy `permitidos.json` NO lo incluye (decisión D4 del plan: queda como
 * decisión del dueño); catalogo.test.ts lo deja anotado.
 */
export const AYUDANTE_N8N: DefAgenteN8n = {
  tipo: '@n8n/n8n-nodes-langchain.agentTool',
  version: 3,
  // el nombre sale igual que el del agente: el que escribió la persona, o «AI Agent»
  nombreBase: 'AI Agent',
};
