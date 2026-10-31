// Las diez apps con conector listo y el nodo de reserva para cualquier otra. type, typeVersion y
// credencial salen de media/library/n8n/catalog.json y permitidos.json; catalogo.test.ts lo
// comprueba contra los dos archivos. Los parámetros son decisión de diseño del Constructor:
// como PASO, la app usa la respuesta del agente (`SALIDA`); como HERRAMIENTA, el agente
// decide qué mandar con `$fromAI`. Solo cinco llevan parámetros; en las demás la persona
// configura todo en n8n (los textos de qué elegir están en pendientes.ts).
//
// Cada `params…()` arma un objeto NUEVO en cada llamada: lo que se exporta nunca comparte
// referencias con el catálogo (en el mockup sí, y un cambio al exportar lo contaminaba).

import { deIA, SALIDA } from '../texto';
import type { CredencialN8n, DefApp, DefOtraApp, ParametrosN8n } from '../tipos';

const sinParametros = (): ParametrosN8n => ({});

function app(
  nombre: string,
  alias: readonly string[],
  tipo: string,
  version: number,
  cred: CredencialN8n,
  paramsPaso: () => ParametrosN8n = sinParametros,
  paramsHerramienta: () => ParametrosN8n = sinParametros,
): DefApp {
  return { nombre, alias, tipo, tipoHerramienta: `${tipo}Tool`, version, cred, paramsPaso, paramsHerramienta };
}

/** Las diez apps, en el orden de la lista de sugerencias. Los alias van ya normalizados (`norm`). */
export const APPS: readonly DefApp[] = [
  app(
    'Gmail',
    ['gmail', 'google mail', 'correo gmail'],
    'n8n-nodes-base.gmail',
    2.2,
    { clave: 'gmailOAuth2', nombre: 'Gmail' },
    () => ({
      resource: 'message',
      operation: 'send',
      sendTo: '',
      subject: 'Respuesta del asistente',
      emailType: 'text',
      message: SALIDA,
      options: { appendAttribution: false },
    }),
    () => ({
      descriptionType: 'auto',
      resource: 'message',
      operation: 'send',
      sendTo: deIA('Para', ''),
      subject: deIA('Asunto', ''),
      emailType: 'text',
      message: deIA('Mensaje', ''),
      options: { appendAttribution: false },
    }),
  ),
  app(
    'Google Sheets',
    ['google sheets', 'sheets', 'hoja de calculo', 'hojas de calculo', 'google hojas'],
    'n8n-nodes-base.googleSheets',
    4.7,
    { clave: 'googleSheetsOAuth2Api', nombre: 'Google Sheets' },
  ),
  app(
    'Slack',
    ['slack'],
    'n8n-nodes-base.slack',
    2.7,
    { clave: 'slackApi', nombre: 'Slack' },
    () => ({ select: 'channel', text: SALIDA, otherOptions: { includeLinkToWorkflow: false } }),
    () => ({
      select: 'channel',
      text: deIA('Mensaje', 'El texto que se publica en el canal'),
      otherOptions: { includeLinkToWorkflow: false },
    }),
  ),
  app(
    'Telegram',
    ['telegram'],
    'n8n-nodes-base.telegram',
    1.2,
    { clave: 'telegramApi', nombre: 'Telegram' },
    () => ({
      resource: 'message',
      operation: 'sendMessage',
      chatId: '',
      text: SALIDA,
      additionalFields: { appendAttribution: false },
    }),
    () => ({
      resource: 'message',
      operation: 'sendMessage',
      chatId: '',
      text: deIA('Mensaje', 'El texto que se envía'),
      additionalFields: { appendAttribution: false },
    }),
  ),
  app('Notion', ['notion'], 'n8n-nodes-base.notion', 3, { clave: 'notionApi', nombre: 'Notion' }),
  app('Airtable', ['airtable'], 'n8n-nodes-base.airtable', 2.2, { clave: 'airtableTokenApi', nombre: 'Airtable' }),
  app(
    'WhatsApp',
    ['whatsapp', 'whatsapp business'],
    'n8n-nodes-base.whatsApp',
    1.1,
    { clave: 'whatsAppApi', nombre: 'WhatsApp' },
    () => ({ operation: 'send', phoneNumberId: '', recipientPhoneNumber: '', textBody: SALIDA }),
    () => ({
      operation: 'send',
      phoneNumberId: '',
      recipientPhoneNumber: deIA('Telefono', 'Número con código de país'),
      textBody: deIA('Mensaje', 'El texto que se envía'),
    }),
  ),
  app(
    'Google Drive',
    ['google drive', 'drive'],
    'n8n-nodes-base.googleDrive',
    3,
    { clave: 'googleDriveOAuth2Api', nombre: 'Google Drive' },
  ),
  app(
    'Google Docs',
    ['google docs', 'docs'],
    'n8n-nodes-base.googleDocs',
    2,
    { clave: 'googleDocsOAuth2Api', nombre: 'Google Docs' },
  ),
  app(
    'Correo (SMTP)',
    ['correo', 'correo smtp', 'smtp', 'email', 'enviar correo'],
    'n8n-nodes-base.emailSend',
    2.1,
    { clave: 'smtp', nombre: 'SMTP' },
    () => ({
      emailFormat: 'text',
      subject: 'Respuesta del asistente',
      text: SALIDA,
      options: { appendAttribution: false },
    }),
    () => ({
      emailFormat: 'text',
      toEmail: deIA('Para', ''),
      subject: deIA('Asunto', ''),
      text: deIA('Mensaje', ''),
      options: { appendAttribution: false },
    }),
  ),
];

/**
 * «¿Otra app?»: lo que se exporta cuando el nombre no es de ninguna app del catálogo. Un HTTP Request
 * sin dirección (la persona pone la API en n8n); como herramienta es la variante `httpRequestTool`.
 * Lleva una nota que dice de qué app se trata. Sin credencial.
 */
export const OTRA_APP: DefOtraApp = {
  tipo: 'n8n-nodes-base.httpRequest',
  tipoHerramienta: 'n8n-nodes-base.httpRequestTool',
  version: 4.5,
  paramsPaso: () => ({ method: 'POST', url: '', options: {} }),
  paramsHerramienta: () => ({ method: 'GET', url: '', options: {} }),
  nota: nombre => `Configura aquí la API de ${nombre}.`,
};
