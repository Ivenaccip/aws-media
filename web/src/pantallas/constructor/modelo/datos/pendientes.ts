// Qué tiene que elegir la persona al abrir cada app en n8n (la credencial se conecta; lo demás,
// no se puede saber desde aquí). Es el aviso «Al abrir «Gmail» en n8n tendrás que conectar tu
// cuenta y elegir el destinatario.» Son los textos del mockup (PEND, Main:1021). Está en un
// `Map` porque se busca por lo que escribe la persona: con un objeto, `constructor` o
// `__proto__` encontrarían algo que no es una app.

/** Por nombre de app del catálogo (el `nombre` exacto de cada DefApp). */
export const PENDIENTES: ReadonlyMap<string, string> = new Map([
  ['Gmail', 'el destinatario'],
  ['Google Sheets', 'el documento y la hoja'],
  ['Slack', 'el canal'],
  ['Telegram', 'el Chat ID'],
  ['Notion', 'la página y el título'],
  ['Airtable', 'la base, la tabla y el registro'],
  ['WhatsApp', 'el número que envía y el que recibe'],
  ['Google Drive', 'la carpeta y el archivo'],
  ['Google Docs', 'la carpeta y el título'],
  ['Correo (SMTP)', 'el remitente y el destinatario'],
]);

/** Lo que hay que elegir en n8n para esa app, o null si no se sabe (la app no es del catálogo). */
export function pendienteDe(nombreApp: string): string | null {
  return PENDIENTES.get(nombreApp) ?? null;
}
