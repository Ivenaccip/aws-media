// Los cuatro proveedores de IA que se ofrecen y el nodo «Chat Model» de n8n de cada uno.
// type, typeVersion y credencial salen de media/library/n8n/catalog.json y permitidos.json
// (catalogo.test.ts lo comprueba contra los dos archivos). Lo que no se pudo verificar NO se
// inventa: solo OpenAI lleva modelo, el de permitidos.json → llm.modelo; Anthropic, Gemini y
// OpenRouter usan el modelo que n8n trae por defecto (decisión D5 del plan).

import type { DefIA } from '../tipos';

/**
 * El modelo de OpenAI. Es el de `permitidos.json → llm.modelo` (decidido por el dueño el 30-sep-2026 y
 * visto en la lista «From list» de su n8n). catalogo.test.ts falla si deja de coincidir.
 */
export const MODELO_OPENAI = 'gpt-5.4-mini';

/** OpenAI (GPT): la que se usa por defecto. */
export const IA_OPENAI: DefIA = {
  id: 'openai',
  nombre: 'OpenAI (GPT)',
  detalle: 'Necesitas tu llave de OpenAI. Es la que usamos por defecto: barata y de las más fáciles de conectar.',
  tipo: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  nodo: 'OpenAI Chat Model',
  cred: { clave: 'openAiApi', nombre: 'OpenAI' },
  params: () => ({ model: { __rl: true, mode: 'id', value: MODELO_OPENAI }, options: {} }),
};

/** Claude (Anthropic): sin modelo fijo, n8n usa el suyo. */
export const IA_ANTHROPIC: DefIA = {
  id: 'anthropic',
  nombre: 'Claude (Anthropic)',
  detalle: 'Necesitas tu llave de Anthropic.',
  tipo: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
  version: 1.6,
  nodo: 'Anthropic Chat Model',
  cred: { clave: 'anthropicApi', nombre: 'Anthropic' },
  params: () => ({ options: {} }),
};

/** Gemini (Google): sin modelo fijo. */
export const IA_GEMINI: DefIA = {
  id: 'gemini',
  nombre: 'Gemini (Google)',
  detalle: 'Necesitas tu llave de Google AI.',
  tipo: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
  version: 1.2,
  nodo: 'Google Gemini Chat Model',
  cred: { clave: 'googlePalmApi', nombre: 'Google Gemini' },
  params: () => ({ options: {} }),
};

/** OpenRouter (otros modelos): sin modelo fijo. */
export const IA_OPENROUTER: DefIA = {
  id: 'openrouter',
  nombre: 'OpenRouter (otros modelos)',
  detalle: 'Una sola llave para muchos modelos: DeepSeek, Llama, Mistral y más.',
  tipo: '@n8n/n8n-nodes-langchain.lmChatOpenRouter',
  version: 1,
  nodo: 'OpenRouter Chat Model',
  cred: { clave: 'openRouterApi', nombre: 'OpenRouter' },
  params: () => ({ options: {} }),
};

/** Los proveedores, en el orden de la lista de Ajustes. */
export const IAS: readonly DefIA[] = [IA_OPENAI, IA_ANTHROPIC, IA_GEMINI, IA_OPENROUTER];
