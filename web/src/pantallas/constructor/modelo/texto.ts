// Las funciones de texto del Constructor: limpiar nombres, armar expresiones de n8n y
// poner título a un cuadro. Puras y deterministas (el archivo de ejemplo del golden depende
// de que `uuidDeterminista` dé siempre lo mismo). Portadas de Main.dc.html:799-827 y
// 1347-1351; los rangos Unicode van con escapes \u para que el archivo no lleve caracteres
// combinantes invisibles.

import { FRECUENCIAS, TIPO_CHAT, TIPOS_DISPARADOR } from './datos/disparadores';
import { conClave } from './secretos';
import type { Frecuencia, Nodo, ParametrosN8n, ValorJson } from './tipos';

/** ¿Es un objeto que no es una lista ni null? (la forma de un cuadro, una conexión o un flujo). */
export const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * El texto cortado a `max` unidades SIN dejar la mitad de un emoji: un sustituto alto al final (porque el corte cayó en
 * medio de un par, o porque el texto ya venía así) no es texto válido y en el archivo saldría como un `\ud83d` huérfano.
 * Es la ÚNICA función de recorte del motor (reductor, borrador y exportador). Un texto que cabe y está bien formado
 * se devuelve tal cual.
 */
export function recortar(texto: string, max: number): string {
  const t = texto.length > max ? texto.slice(0, max) : texto;
  const ultimo = t.charCodeAt(t.length - 1);
  return ultimo >= 0xd800 && ultimo <= 0xdbff ? t.slice(0, -1) : t;
}

/**
 * El texto en minúsculas, sin acentos (marcas U+0300 a U+036F tras NFD) y sin espacios en los
 * extremos. Lo que no es texto (null, undefined, 0, false) es el texto vacío.
 */
export function norm(t: unknown): string {
  return String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Lo que queda de un texto para ir en el enlace de un webhook: minúsculas, sin acentos, y todo lo
 * que no sea letra, número, guion o guion bajo, pasa a «-». Sin guiones en los extremos. Sin tope de
 * largo. Vacío si no queda nada (el disparador web lo pide como error).
 */
export function rutaLimpia(r: unknown): string {
  return norm(r)
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Un texto para nombre de archivo: solo letras y números separados por «-», hasta 60 caracteres.
 * (El mockup podía dejar un «-» al final si el recorte caía justo en uno; aquí se quita.)
 */
export function slug(t: unknown): string {
  return norm(t)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

/** «Cada hora», «Cada lunes, 9:00» o «Cada día, 9:00» (lo que no se reconoce cae en «día»). */
export function frecTexto(f: unknown): string {
  const hallada = FRECUENCIAS.find(x => x.id === f) ?? FRECUENCIAS.find(x => x.id === 'dia');
  return hallada ? hallada.corto : 'Cada día, 9:00';
}

const un8 = (n: number) => (Math.imul(n, 2654435761) >>> 0).toString(16).padStart(8, '0');

/**
 * Un UUID con forma de v4 que depende SOLO de `i`. n8n pide uno por nodo y el golden exige
 * que el archivo sea idéntico entre corridas, por eso no se usa `crypto.randomUUID`.
 * 1 da `6a99b44c-8a80-442b-8e6d-5c49206bc530`.
 */
export function uuidDeterminista(i: number): string {
  const a = un8(i + 11);
  const b = un8(i * 7 + 23);
  const c = un8(i * 13 + 37);
  const d = un8(i * 17 + 51);
  return `${a}-${b.slice(0, 4)}-4${b.slice(4, 7)}-8${c.slice(0, 3)}-${c.slice(3, 8)}${d.slice(0, 7)}`;
}

/** Lo que se dice en lugar del nombre de un cuadro cuando ese nombre parece una clave: ningún aviso la repite. */
const NOMBRE_OCULTO = { agente: 'Agente con clave pegada', app: 'App con clave pegada' } as const;

/**
 * El nombre con que se habla de un cuadro en avisos y etiquetas: «Disparador Chat»,
 * el nombre del agente (o «Agente») o el de la app (o «App sin nombre»). Sin cuadro, vacío.
 * Un tipo de disparador desconocido cae en «Chat». Si el nombre parece una clave (`conClave`) NO se repite: se dice
 * «Agente con clave pegada» / «App con clave pegada», para que ningún error, aviso ni etiqueta (que un lector de
 * pantalla leería en voz alta) vuelva a escribir lo que la persona pegó por error. El campo sigue mostrando lo que escribió.
 */
export function tituloDe(n: Nodo | null | undefined): string {
  if (!n) return '';
  if (n.kind === 'trigger') {
    const tipo = TIPOS_DISPARADOR.find(x => x.id === n.tipo) ?? TIPO_CHAT;
    return `Disparador ${tipo.nombre}`;
  }
  const nombre = String(n.nombre || '').trim();
  if (nombre !== '' && conClave(nombre)) return n.kind === 'agent' ? NOMBRE_OCULTO.agente : NOMBRE_OCULTO.app;
  if (n.kind === 'agent') return nombre || 'Agente';
  return nombre || 'App sin nombre';
}

/**
 * Un texto para usar DENTRO de una expresión de n8n, entre comillas simples. Escapa a \uXXXX la
 * comilla simple, la barra, las llaves, los saltos de línea y U+2028/2029: las llaves porque
 * `{{` o `}}` dentro de una expresión la cortarían; el resto porque romperían el texto.
 */
export function literalExpr(s: unknown): string {
  const cuerpo = Array.from(String(s))
    .map(ch => {
      const c = ch.charCodeAt(0);
      return "\\'{}\r\n".includes(ch) || c === 0x2028 || c === 0x2029 ? `\\u${c.toString(16).padStart(4, '0')}` : ch;
    })
    .join('');
  return `'${cuerpo}'`;
}

/** Una expresión de n8n: `={{ cuerpo }}`. */
export function expr(cuerpo: string): string {
  return `={{ ${cuerpo} }}`;
}

/** Lo que el agente decide al usar una herramienta: `$fromAI('clave', 'descripción', 'string')`. */
export function deIA(clave: string, desc: string): string {
  return expr(`$fromAI(${literalExpr(clave)}, ${literalExpr(desc)}, 'string')`);
}

/** La respuesta del agente anterior: `={{ $json.output }}`. */
export const SALIDA = expr('$json.output');

/** Un texto que empieza con «=» lo toma n8n por expresión y se come ese «=»: se le antepone otro. */
export function sinIgual(t: string): string {
  return t.charAt(0) === '=' ? `=${t}` : t;
}

/** El primer número k ≥ 1 tal que ningún agente se llama «Agente k» (se compara tras quitar espacios). */
export function numeroLibre(nodes: readonly Nodo[]): number {
  let k = 1;
  while (nodes.some(n => n.kind === 'agent' && String(n.nombre || '').trim() === `Agente ${k}`)) k += 1;
  return k;
}

/**
 * El nombre de un nodo que es herramienta (o ayudante) de un agente. El modelo ve las herramientas
 * por nombre y n8n cambia acentos y símbolos por «_»; sin ellos se lee igual en el flujo y para el
 * modelo. Solo deja letras, números, espacios, «_» y «-»; vacío es «Herramienta».
 */
export function nombreHerramientaSeguro(base: string): string {
  return (
    base
      .normalize('NFD')
      .replace(/[^\u0020-\u007e]/g, '')
      .replace(/[^A-Za-z0-9 _-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Herramienta'
  );
}

/**
 * Una copia profunda de un valor de JSON (cadenas, números, booleanos, null, listas y objetos). Se
 * usa para que lo que se entrega del catálogo nunca comparta referencias con él. Conserva el orden
 * de las claves (el archivo que se descarga lo depende).
 */
export function copiaJson<T extends ValorJson | ParametrosN8n>(valor: T): T {
  if (Array.isArray(valor)) return valor.map(v => copiaJson(v)) as T;
  if (valor !== null && typeof valor === 'object') {
    // `fromEntries` crea propiedades PROPIAS (también `__proto__`); asignar `salida[k] = …` la perdería y cambiaría el prototipo
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, copiaJson(v)])) as T;
  }
  return valor;
}

/** Para los tipos: un tipo de frecuencia conocido. */
export function esFrecuencia(f: unknown): f is Frecuencia {
  return FRECUENCIAS.some(x => x.id === f);
}
