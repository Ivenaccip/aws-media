// Lo que se muestra de los disparadores: los cuatro tipos, las frecuencias y las dos apps
// que pueden iniciar un flujo. Los textos son los del mockup (K().TIPOS y las opciones de
// Ajustes). Cómo se exportan a n8n está en disparadoresN8n.ts. Este archivo no importa nada
// del motor (texto.ts lo importa a él), para no hacer un círculo.

import type { DefAppDisparador, DefFrecuencia, DefTipoDisparador } from '../tipos';

/** Arranca solo, a la hora que digas. */
export const TIPO_TIEMPO: DefTipoDisparador = {
  id: 'tiempo',
  nombre: 'Tiempo',
  detalle: 'Arranca solo, a la hora que digas.',
  icono: 'reloj',
};

/** Alguien le escribe en un chat. Es el que se usa cuando el tipo no se reconoce. */
export const TIPO_CHAT: DefTipoDisparador = {
  id: 'chat',
  nombre: 'Chat',
  detalle: 'Alguien le escribe en un chat.',
  icono: 'chat',
};

/** Otra página o servicio le avisa por internet. */
export const TIPO_WEB: DefTipoDisparador = {
  id: 'web',
  nombre: 'Web',
  detalle: 'Otra página o servicio le avisa por internet.',
  icono: 'web',
};

/** Pasa algo en una app. */
export const TIPO_APP: DefTipoDisparador = {
  id: 'app',
  nombre: 'App',
  detalle: 'Pasa algo en una app, por ejemplo llega un correo.',
  icono: 'app',
};

/** Los cuatro disparadores que se ofrecen, en el orden de la tarjeta «Elige cómo arranca tu flujo». */
export const TIPOS_DISPARADOR: readonly DefTipoDisparador[] = [TIPO_TIEMPO, TIPO_CHAT, TIPO_WEB, TIPO_APP];

/** Las frecuencias del disparador de tiempo. `opcion` es el texto del selector; `corto`, el del cuadro. */
export const FRECUENCIAS: readonly DefFrecuencia[] = [
  { id: 'hora', opcion: 'Cada hora', corto: 'Cada hora' },
  { id: 'dia', opcion: 'Cada día a las 9:00', corto: 'Cada día, 9:00' },
  { id: 'lunes', opcion: 'Cada lunes a las 9:00', corto: 'Cada lunes, 9:00' },
];

/** Las apps que pueden iniciar un flujo (por ahora solo estas dos). */
export const APPS_DISPARADOR: readonly DefAppDisparador[] = [
  { id: 'gmail', opcion: 'Gmail: llega un correo', detalle: 'Gmail: correo nuevo' },
  { id: 'telegram', opcion: 'Telegram: llega un mensaje', detalle: 'Telegram: mensaje nuevo' },
];
