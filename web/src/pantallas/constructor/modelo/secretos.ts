// Detectar claves pegadas por error. Un archivo de n8n NO lleva claves: se ponen en n8n al
// conectar la cuenta. Las primeras ocho expresiones son las de pipeline/validador.py:SECRETOS, EN EL MISMO ORDEN,
// con una diferencia: el límite de palabra (`\b`) delante de `sk-` y de `gh[pousr]_`, porque sin él una frase normal
// como `task-management-system-webhook` o `risk-assessment-for-the-quarter` (que contienen «sk-»), o la URL de una
// página de Notion («…/Task-Tracker-Weekly-Plan-0123456789abcdef»), se tomaba por una clave y bloqueaba la descarga.
// Las ocho de después son formatos reales que Python todavía no conoce (Notion, Airtable, WhatsApp/Meta, Slack de
// aplicación, GitHub de grano fino, Stripe, SendGrid): son las claves que una persona pegaría al armar un flujo con las
// apps del propio catálogo. Hasta que pipeline/validador.py las adopte, tests/test_constructor_paridad.py declara por
// escrito cada diferencia (`PYTHON_ATRASADO`) y falla cuando Python se pone al día, para borrar la excepción.
// catalogo.paridad.test.ts guarda estos patrones y sus sondas en golden/catalogo-usado.json, y pytest los compara.
//
// Ninguna lleva la bandera `g`: con ella `test` guardaría `lastIndex` y daría respuestas distintas
// la segunda vez. Ninguna usa lookbehind (`(?<!…)`): un Safari viejo no lo entiende y rompería la carga del módulo.

/** Los patrones de claves conocidas. Los índices 0 a 7 siguen el orden de Python; del 8 en adelante solo existen aquí. */
export const SECRETOS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}/, // OpenAI, Anthropic, OpenRouter
  /AIza[0-9A-Za-z_-]{35}/, // Google
  /xox[baprs]-[0-9A-Za-z-]{10,}/, // Slack
  /\bgh[pousr]_[A-Za-z0-9]{30,}/, // GitHub
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/, // bot de Telegram
  /bearer\s+[A-Za-z0-9._~+/-]{20,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/, // AWS
  /\bntn_[A-Za-z0-9]{30,}/, // Notion (integración, formato nuevo)
  /\bsecret_[A-Za-z0-9]{40,}/, // Notion (integración, formato viejo)
  /\bpat[A-Za-z0-9]{14}\.[0-9a-f]{64}/, // Airtable (token personal)
  /\bEAA[A-Za-z0-9]{40,}/, // WhatsApp Cloud API / Meta
  /\bxapp-\d-[A-Za-z0-9-]{20,}/, // Slack (token de aplicación)
  /\bgithub_pat_[A-Za-z0-9_]{50,}/, // GitHub (token de grano fino)
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/, // Stripe
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/, // SendGrid
];

/**
 * ¿El texto parece traer una clave? Lo que no es texto (null, undefined, un número, un objeto —también uno de JSON cuyo
 * `toString` no es una función—) no la trae, y preguntarlo nunca lanza.
 */
export function conClave(texto: unknown): boolean {
  return typeof texto === 'string' && SECRETOS.some(r => r.test(texto));
}
