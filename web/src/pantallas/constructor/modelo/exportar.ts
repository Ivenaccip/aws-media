// El exportador a n8n: del flujo del lienzo al archivo `.json` que se importa en n8n.
// Portado de Main.dc.html:971-1150 (el mockup) con las correcciones deliberadas de golden/LEEME.md.
//
// Tres funciones, de la más barata a la más cara:
//   · revisarFlujo(est)      → { errores, avisos }. No arma ni serializa nada: es lo que el lienzo
//                              necesita en cada pulsación para decir «te falta esto».
//   · construirN8n(est, op)  → FlujoN8n. Arma los nodos y las conexiones. Solo al descargar, copiar o ver el JSON.
//   · construirFlujo(est, op)→ { errores, avisos, flujo, json }. Las dos de arriba juntas más el texto del archivo.
//
// Es puro y determinista: no toca el DOM, ni el reloj, ni `crypto`, ni `Intl`. La zona horaria se
// INYECTA (`opciones.zona`; `zonaLocal()` la lee del navegador, pero solo si quien llama lo pide).
// Dado el mismo flujo, el archivo sale idéntico byte a byte.
//
// Seguridad (todo se prueba en exportar.test.ts):
//   · Nada de lo que escribe la persona se vuelve expresión de n8n. Un valor es expresión solo si
//     empieza con «=»: los textos libres pasan por `sinIgual`, la tarea pierde sus llaves y los nombres
//     que van dentro de una expresión se escapan con `literalExpr`.
//   · Un texto que parece una clave (sk-…, AIza…, token de Telegram…) es un error, también si lo
//     parece solo después de limpiarlo (la ruta del webhook, un nombre recortado). Y `construirFlujo`
//     revisa el archivo ya armado una vez más.
//   · Las credenciales salen siempre como referencias vacías (`{ id: '', name }`).
//   · Los parámetros que entrega el catálogo se copian al exportar: lo que sale nunca comparte un objeto con él ni con otro nodo.
//   · Ningún objeto se arma con una clave que escriba la persona: las conexiones van por nombre de
//     nodo, y esas se construyen con `Map` y `Object.fromEntries` (el nombre `__proto__` no sale).

import { appDe, AGENTE_N8N, AYUDANTE_N8N, disparadorN8n, iaDe, OTRA_APP, pendienteDe } from './catalogo';
import { LARGO_NOMBRE_N8N, NOMBRE_FLUJO_INICIAL, VUELTAS_MAX } from './datos/constantes';
import { conClave } from './secretos';
import {
  copiaJson,
  deIA,
  expr,
  literalExpr,
  nombreHerramientaSeguro,
  recortar,
  rutaLimpia,
  SALIDA,
  sinCaracteresRaros,
  sinIgual,
  tituloDe,
  uuidDeterminista,
} from './texto';
import type { Arista, Flujo, Nodo, NodoAgente, NodoApp, NodoDisparador, ParametrosN8n } from './tipos';

// ---------------------------------------------------------------- tipos de lo que sale

/** Las credenciales de un nodo: SIEMPRE referencias vacías (`id: ''`); se conectan dentro de n8n. */
export interface CredencialesN8n {
  [clave: string]: { id: string; name: string };
}

/** Los tipos de conexión que genera el Constructor. */
export type TipoConexionN8n = 'main' | 'ai_languageModel' | 'ai_tool';

/** A dónde llega una conexión. */
export interface DestinoN8n {
  node: string;
  type: TipoConexionN8n;
  index: number;
}

/** Las conexiones de n8n: por nombre de nodo de origen y tipo de conexión. */
export interface ConexionesN8n {
  [origen: string]: { [T in TipoConexionN8n]?: DestinoN8n[][] };
}

/** Un nodo del archivo de n8n. El orden de las claves es el del archivo que se descarga. */
export interface NodoN8n {
  parameters: ParametrosN8n;
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  credentials?: CredencialesN8n;
  webhookId?: string;
  notes?: string;
}

/** El archivo que se importa en n8n. */
export interface FlujoN8n {
  name: string;
  nodes: NodoN8n[];
  connections: ConexionesN8n;
  settings: { executionOrder: 'v1'; timezone?: string };
  pinData: Record<string, never>;
}

/** Lo que el exportador necesita del estado: el flujo (cuadros, conexiones y nombre). */
export type EstadoExportable = Pick<Flujo, 'nodes' | 'edges' | 'nombreFlujo'>;

/** Lo que dice la revisión: `errores` bloquean la descarga; `avisos` no. */
export interface RevisionFlujo {
  errores: string[];
  avisos: string[];
}

/** Lo que devuelve `construirFlujo`. `flujo` es null (y `json` vacío) si y solo si hay errores. */
export interface ResultadoFlujo extends RevisionFlujo {
  flujo: FlujoN8n | null;
  json: string;
}

/** Opciones del exportador. */
export interface OpcionesExportar {
  /**
   * La zona horaria de quien arma el flujo (p. ej. `America/Mexico_City`). Solo la usa el disparador de
   * tiempo; sin ella (o si no tiene forma de zona) el archivo no lleva `settings.timezone`.
   */
  zona?: string | undefined;
}

// ---------------------------------------------------------------- utilidades pequeñas

const pon = (lista: string[], t: string): void => {
  if (!lista.includes(t)) lista.push(t);
};

const campoDe = (n: Nodo, k: string): string => String((n as unknown as Record<string, unknown>)[k] || '');

/** Un número de posición que siempre es finito (un `NaN` saldría como `null` y n8n no abre el archivo). */
const entero = (v: number): number => (Number.isFinite(v) ? Math.round(v) : 0);

const MSG_CLAVE = 'Quítala: las claves se ponen en n8n al conectar la cuenta, nunca dentro del archivo.';
const MSG_CLAVE_EN_EL_ARCHIVO = `Parece que pegaste una clave en el flujo. ${MSG_CLAVE}`;

/** Una zona horaria con forma de zona de IANA (`UTC`, `America/Mexico_City`, `Etc/GMT+5`). */
const FORMA_DE_ZONA = /^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/;

/** Los nombres que NO se dan a un nodo: como clave de objeto cambian el prototipo en vez de guardar nada. */
const NOMBRES_RESERVADOS: readonly string[] = ['__proto__'];

/**
 * Un texto libre tal como va a un parámetro de n8n (instrucciones, descripción de un ayudante). Si empieza
 * con «=» n8n lo toma por expresión: `sinIgual` le antepone otro «=» para que el primero no se coma, pero
 * entonces lo que sigue es plantilla y unas llaves dobles (`={{ $env.X }}`) se EVALUARÍAN. En ese caso, y solo
 * en ese, se le quitan las llaves, como a la tarea. Un texto que no empieza con «=» queda tal cual: n8n no
 * evalúa un valor que no empieza con «=», traiga las llaves que traiga.
 */
function textoLibre(texto: string): string {
  const t = texto.trim();
  return t.charAt(0) === '=' ? sinIgual(t.replace(/[{}]/g, '').trim()) : t;
}

/**
 * Un UUID con forma de v4 que depende SOLO del texto (cuatro huellas de 32 bits, cyrb128). Sirve para
 * el `webhookId`: debe ser distinto entre flujos distintos —en n8n la URL del chat es `/webhook/<webhookId>/chat`— y
 * debe ser el mismo cada vez que se exporta el mismo flujo (el golden lo exige).
 */
export function uuidDeTexto(texto: string): string {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < texto.length; i += 1) {
    const k = texto.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const mezcla = h1 ^ h2 ^ h3 ^ h4;
  const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');
  const a = hex(mezcla);
  const b = hex(h2 ^ mezcla);
  const c = hex(h3 ^ mezcla);
  const d = hex(h4 ^ mezcla);
  const variante = '89ab'.charAt(parseInt(b.charAt(7), 16) & 3);
  return `${a}-${b.slice(0, 4)}-4${b.slice(4, 7)}-${variante}${c.slice(0, 3)}-${c.slice(3, 8)}${d.slice(0, 7)}`;
}

/** La zona horaria del navegador, o undefined si no se puede saber. Es la única que toca `Intl`, y solo cuando quien llama lo pide. */
export function zonaLocal(): string | undefined {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof z === 'string' && z ? z : undefined;
  } catch {
    return undefined;
  }
}

/** ¿Algún texto del archivo —o alguna clave de objeto, como el nombre de un nodo— parece una clave? */
export function claveEnFlujo(valor: unknown): boolean {
  if (typeof valor === 'string') return conClave(valor);
  if (Array.isArray(valor)) return valor.some(claveEnFlujo);
  if (valor !== null && typeof valor === 'object') return Object.entries(valor).some(([k, v]) => conClave(k) || claveEnFlujo(v));
  return false;
}

// ---------------------------------------------------------------- análisis del grafo

interface Analisis extends RevisionFlujo {
  nodes: readonly Nodo[];
  edges: readonly Arista[];
  nombreFlujo: string;
  porId: Map<string, Nodo>;
  /** Para cada cuadro, el agente del que es herramienta o ayudante (el último `tool` que le llega). */
  padre: Map<string, string>;
  seqs: Arista[];
  trig: NodoDisparador | undefined;
  /** Sube por los padres mientras padre e hijo sean agentes: lo que sigue a un ayudante sale de su agente principal. */
  raiz: (id: string) => string;
  /** Los cuadros que le entregan su respuesta (sus orígenes por `seq`, con los ayudantes reemplazados por su raíz, sin repetir). */
  antes: (id: string) => Nodo[];
  /** Los cuadros a los que este le entrega la suya. */
  despues: (id: string) => Nodo[];
}

/** El nombre con que un cuadro entra a la lista de nombres de nodo (antes de volverlo único). */
function baseDeNombre(n: Nodo): string {
  if (n.kind === 'trigger') return disparadorN8n(n).nombreBase;
  if (n.kind === 'agent') return String(n.nombre || '').trim() || AGENTE_N8N.nombreBase;
  const d = appDe(n.nombre);
  return d ? d.nombre : String(n.nombre || '').trim();
}

/** La tarea de un agente tal como se exporta: sin llaves (no puede abrir una expresión) y sin espacios en los extremos. */
const tareaLimpia = (n: NodoAgente): string => String(n.tarea || '').replace(/[{}]/g, '').trim();

/**
 * Todos los textos de un cuadro que pueden parar en el archivo: lo que la persona escribió y también
 * lo que queda después de limpiarlo (la ruta del webhook, el nombre recortado o sin acentos, la tarea sin
 * llaves). Una clave puede aparecer solo DESPUÉS de limpiar: «sk@aaaa…» pasa a ser «sk-aaaa…» en la ruta.
 */
function formasDeTexto(n: Nodo): string[] {
  const formas = ['nombre', 'tarea', 'desc', 'instrucciones', 'ruta'].map(k => campoDe(n, k));
  if (n.kind === 'trigger') {
    formas.push(rutaLimpia(n.ruta));
    return formas;
  }
  const base = baseDeNombre(n);
  const seguro = nombreHerramientaSeguro(base);
  formas.push(base, recortar(base, LARGO_NOMBRE_N8N), seguro, recortar(seguro, LARGO_NOMBRE_N8N));
  if (n.kind === 'agent') formas.push(tareaLimpia(n), textoLibre(campoDe(n, 'instrucciones')), textoLibre(campoDe(n, 'desc')));
  return formas;
}

/**
 * El cuadro con sus textos sin caracteres de control ni de dirección. Lo que sale del reductor y del borrador ya viene limpio (`recortar`):
 * esta es la última barrera, por si el exportador recibe un flujo armado por otro camino. Un NUL en un `name` del archivo lo rechaza la base
 * de datos de n8n al importarlo. Si nada cambia, el mismo cuadro.
 */
function limpiarTextos(n: Nodo): Nodo {
  let copia: Record<string, unknown> | null = null;
  for (const [k, v] of Object.entries(n)) {
    if (k === 'id' || k === 'kind' || typeof v !== 'string') continue;
    const limpio = sinCaracteresRaros(v);
    if (limpio === v) continue;
    copia ??= { ...n };
    copia[k] = limpio;
  }
  return copia === null ? n : (copia as unknown as Nodo);
}

function analizar(est: EstadoExportable): Analisis {
  const nodes = est.nodes.map(limpiarTextos);
  const edges = est.edges;
  const nombreDelFlujo = typeof est.nombreFlujo === 'string' ? sinCaracteresRaros(est.nombreFlujo) : est.nombreFlujo;
  const porId = new Map<string, Nodo>();
  for (const n of nodes) porId.set(n.id, n);
  const padre = new Map<string, string>();
  for (const e of edges) if (e.tipo === 'tool') padre.set(e.a, e.de);
  const seqs = edges.filter(e => e.tipo === 'seq');

  const raiz = (id: string): string => {
    let x = id;
    for (let i = 0; i < VUELTAS_MAX; i += 1) {
      const pa = padre.get(x);
      const nPadre = pa === undefined ? undefined : porId.get(pa);
      const nX = porId.get(x);
      if (pa !== undefined && nPadre && nPadre.kind === 'agent' && nX && nX.kind === 'agent') x = pa;
      else break;
    }
    return x;
  };
  const antes = (id: string): Nodo[] => {
    // varias conexiones del mismo agente principal (él y su ayudante) son UNA sola entrada para n8n
    const vistos = new Set<string>();
    const origenes: Nodo[] = [];
    for (const e of seqs) {
      if (e.a !== id) continue;
      const origen = porId.get(raiz(e.de));
      if (origen && !vistos.has(origen.id)) {
        vistos.add(origen.id);
        origenes.push(origen);
      }
    }
    return origenes;
  };
  const despues = (id: string): Nodo[] => seqs.filter(e => raiz(e.de) === id).flatMap(e => porId.get(e.a) ?? []);

  const trig = nodes.find((n): n is NodoDisparador => n.kind === 'trigger');
  const agentes = nodes.filter((n): n is NodoAgente => n.kind === 'agent');
  const apps = nodes.filter((n): n is NodoApp => n.kind === 'app');
  const errores: string[] = [];
  const avisos: string[] = [];

  // ---- errores (bloquean la descarga)
  if (!trig) pon(errores, 'Falta un disparador: dile al flujo cuándo arrancar.');
  if (trig && despues(trig.id).length === 0) pon(errores, 'Toca el + junto al disparador para agregar el primer paso.');
  if (trig && trig.tipo === 'web' && !rutaLimpia(trig.ruta)) pon(errores, 'El disparador web necesita una ruta para su enlace.');
  for (const ag of agentes) {
    const t = tituloDe(ag);
    const pa = padre.get(ag.id);
    if (pa !== undefined) {
      if (!String(ag.desc || '').trim()) pon(errores, `Dile a «${t}» para qué le sirve a «${tituloDe(porId.get(pa))}» cuando conversan.`);
    } else if (antes(ag.id).some(p => p.kind === 'trigger' && p.tipo !== 'chat') && !String(ag.tarea || '').trim()) {
      pon(errores, `Dile a «${t}» qué debe hacer cada vez que se dispare.`);
    }
  }
  for (const p of apps) if (!String(p.nombre || '').trim()) pon(errores, 'Una app no tiene nombre: ponle uno, por ejemplo Gmail.');
  // claves pegadas por error: el archivo no debe llevar ninguna (mismas reglas que pipeline/validador.py)
  for (const n of nodes) {
    if (formasDeTexto(n).some(conClave)) pon(errores, `Parece que pegaste una clave en «${tituloDe(n)}». ${MSG_CLAVE}`);
  }
  if (conClave(nombreDelFlujo)) pon(errores, 'Parece que pegaste una clave en el nombre del flujo. Quítala.');

  // ---- avisos (no bloquean)
  if (agentes.length === 0) pon(avisos, 'Tu flujo no tiene agente de IA: solo hará lo que digan las apps.');
  for (const p of apps) {
    const nombre = String(p.nombre || '').trim();
    if (nombre && !appDe(nombre)) {
      pon(avisos, `«${tituloDe(p)}» no trae un conector listo en n8n: tendrás que configurar esa conexión tú dentro de n8n.`);
    }
  }
  for (const n of nodes) {
    const recibe = antes(n.id).length;
    if (n.kind !== 'trigger' && !padre.has(n.id) && recibe === 0) pon(avisos, `«${tituloDe(n)}» no está conectado a nada: n8n lo dejará suelto.`);
    if (recibe > 1) {
      pon(avisos, `«${tituloDe(n)}» recibe de ${recibe} cuadros: n8n lo ejecutará una vez por cada uno, no los junta. Para juntarlos usa un nodo Merge en n8n.`);
    }
  }
  for (const p of apps) {
    const d = appDe(p.nombre);
    const pendiente = d ? pendienteDe(d.nombre) : null;
    if (d && pendiente) pon(avisos, `Al abrir «${d.nombre}» en n8n tendrás que conectar tu cuenta y elegir ${pendiente}.`);
  }
  if (trig && trig.tipo === 'chat') pon(avisos, 'El chat quedará público: cualquiera con el enlace podrá escribirle (y gastar tu llave de IA).');

  return { nodes, edges, nombreFlujo: nombreDelFlujo, porId, padre, seqs, trig, raiz, antes, despues, errores, avisos };
}

// ---------------------------------------------------------------- el flujo en el formato de n8n

function armar(a: Analisis, zona: string | undefined): FlujoN8n {
  const { porId, padre, seqs, trig, raiz, antes } = a;
  // el disparador va primero en el archivo (en el lienzo se agrega al final cuando se quitó y se vuelve a elegir)
  const nodes = [...a.nodes.filter(n => n.kind === 'trigger'), ...a.nodes.filter(n => n.kind !== 'trigger')];

  // nombres de nodo únicos: n8n conecta POR NOMBRE
  const usados = new Set<string>(NOMBRES_RESERVADOS);
  const nom = (base0: string): string => {
    const base = recortar(String(base0), LARGO_NOMBRE_N8N);
    let n = base;
    let i = 2;
    while (usados.has(n)) {
      n = `${base} ${i}`;
      i += 1;
    }
    usados.add(n);
    return n;
  };
  const nombreDe = new Map<string, string>();
  for (const n of nodes) {
    const base = baseDeNombre(n);
    // el modelo ve las herramientas con el nombre del nodo y n8n cambia acentos y símbolos por «_»
    nombreDe.set(n.id, nom(padre.has(n.id) ? nombreHerramientaSeguro(base) : base));
  }
  const nombreDeId = (id: string): string => nombreDe.get(id) ?? '';

  let cuenta = 0;
  const nuevoId = (): string => {
    cuenta += 1;
    return uuidDeterminista(cuenta);
  };
  const pos = (n: Nodo): [number, number] => [entero(n.x), entero(n.y)];
  const lista: NodoN8n[] = [];

  // el nodo de modelo va debajo de su agente, en el primer hueco que no pise ningún otro nodo (cajas de n8n: ~100 px)
  const ocupa: [number, number][] = nodes.map(pos);
  const libre = (x: number, y: number): [number, number] => {
    const choca = (px: number, py: number) => ocupa.some(q => Math.abs(q[0] - px) < 140 && Math.abs(q[1] - py) < 130);
    for (const dy of [190, 320, 450, 580]) {
      for (const dx of [-120, 120, -280, 280, -440, 440, 0]) {
        if (!choca(x + dx, y + dy)) {
          ocupa.push([x + dx, y + dy]);
          return [x + dx, y + dy];
        }
      }
    }
    ocupa.push([x - 120, y + 190]);
    return [x - 120, y + 190];
  };

  const con = new Map<string, Map<TipoConexionN8n, DestinoN8n[][]>>();
  const enlazar = (desde: string, hacia: string, tipo: TipoConexionN8n): void => {
    let porTipo = con.get(desde);
    if (!porTipo) {
      porTipo = new Map();
      con.set(desde, porTipo);
    }
    let ramas = porTipo.get(tipo);
    if (!ramas) {
      ramas = [[]];
      porTipo.set(tipo, ramas);
    }
    ramas[0]?.push({ node: hacia, type: tipo, index: 0 });
  };

  for (const n of nodes) {
    const nombre = nombreDeId(n.id);
    if (n.kind === 'trigger') {
      const def = disparadorN8n(n);
      // el mockup repartía aquí el webhookId con el mismo contador de los ids; se sigue gastando ese número
      // (los ids de los demás nodos no cambian) y el valor se reemplaza abajo por uno que depende del flujo
      const webhookId = def.conWebhookId ? nuevoId() : null;
      const nodo: NodoN8n = { parameters: copiaJson(def.params(n)), id: nuevoId(), name: nombre, type: def.tipo, typeVersion: def.version, position: pos(n) };
      if (def.cred) nodo.credentials = { [def.cred.clave]: { id: '', name: def.cred.nombre } };
      if (webhookId) nodo.webhookId = webhookId;
      lista.push(nodo);
    } else if (n.kind === 'agent') {
      const instr = textoLibre(String(n.instrucciones || ''));
      const opciones: ParametrosN8n = instr ? { systemMessage: instr } : {};
      if (padre.has(n.id)) {
        // una IA que conversa con otra: en n8n es una herramienta del agente principal («AI Agent Tool»), que le pregunta cuantas veces haga falta
        lista.push({
          parameters: {
            toolDescription: textoLibre(String(n.desc || '')),
            text: deIA('Mensaje', 'Lo que le quieres preguntar o pedir a este agente'),
            options: opciones,
          },
          id: nuevoId(),
          name: nombre,
          type: AYUDANTE_N8N.tipo,
          typeVersion: AYUDANTE_N8N.version,
          position: pos(n),
        });
      } else {
        const ant = antes(n.id);
        const tarea = tareaLimpia(n);
        let params: ParametrosN8n;
        if (ant.some(p => p.kind === 'trigger' && p.tipo === 'chat')) params = { options: opciones };
        else {
          const previo = ant[0];
          // lo que el agente recibe de cada disparador: un texto fijo ignora los datos que lo dispararon (correo, mensaje, pedido)
          let entrada: string | null;
          if (!previo) entrada = null;
          else if (previo.kind === 'agent') entrada = '$json.output';
          else if (previo.kind === 'trigger') {
            if (previo.tipo === 'tiempo') entrada = null;
            else if (previo.tipo === 'web') entrada = 'JSON.stringify($json.body)';
            else if (previo.app === 'telegram') entrada = '$json.message.text';
            else entrada = 'JSON.stringify({ de: $json.from?.text, asunto: $json.subject, mensaje: $json.text })';
          } else entrada = 'JSON.stringify($json)';
          const texto = !entrada ? sinIgual(tarea) : tarea ? `=${tarea}\n\n{{ ${entrada} }}` : expr(entrada);
          // un agente suelto sin tarea no tiene qué pedirle al modelo: sin `promptType`, n8n no marca el prompt como obligatorio
          params = texto ? { promptType: 'define', text: texto, options: opciones } : { options: opciones };
        }
        lista.push({ parameters: params, id: nuevoId(), name: nombre, type: AGENTE_N8N.tipo, typeVersion: AGENTE_N8N.version, position: pos(n) });
      }
      // la IA de este agente
      const ia = iaDe(n.ia);
      const mNombre = nom(ia.nodo);
      lista.push({
        parameters: copiaJson(ia.params()),
        id: nuevoId(),
        name: mNombre,
        type: ia.tipo,
        typeVersion: ia.version,
        position: libre(entero(n.x), entero(n.y)),
        credentials: { [ia.cred.clave]: { id: '', name: ia.cred.nombre } },
      });
      enlazar(mNombre, nombre, 'ai_languageModel');
    } else {
      const texto = String(n.nombre || '').trim();
      const def = appDe(texto);
      const esT = padre.has(n.id);
      let nodo: NodoN8n;
      if (def) {
        let parameters: ParametrosN8n;
        if (esT) parameters = copiaJson(def.paramsHerramienta());
        else {
          // como paso, la app usa la respuesta del agente que corrió antes (aunque entre medio haya otra app)
          let previo = antes(n.id)[0];
          for (let v = 0; previo && previo.kind !== 'agent' && v < 10; v += 1) previo = antes(previo.id)[0];
          const directo = antes(n.id)[0];
          const salida =
            directo && directo.kind === 'agent'
              ? SALIDA
              : previo
                ? expr(`$(${literalExpr(nombreDeId(previo.id))}).item.json.output`)
                : expr('JSON.stringify($json)');
          parameters = copiaJson(def.paramsPaso());
          for (const k of Object.keys(parameters)) if (parameters[k] === SALIDA) parameters[k] = salida;
          // si el flujo arrancó con un correo o un mensaje de Telegram, la respuesta va a quien lo mandó
          let g = antes(n.id)[0];
          for (let v = 0; g && g.kind !== 'trigger' && v < 10; v += 1) g = antes(g.id)[0];
          if (g && g.kind === 'trigger' && g.tipo === 'app') {
            const de = literalExpr(nombreDeId(g.id));
            if (def.nombre === 'Gmail' && g.app !== 'telegram') {
              parameters.sendTo = expr(`$(${de}).item.json.from.value[0].address`);
              parameters.subject = expr(`'Re: ' + $(${de}).item.json.subject`);
            }
            if (def.nombre === 'Telegram' && g.app === 'telegram') parameters.chatId = expr(`$(${de}).item.json.message.chat.id`);
          }
        }
        nodo = {
          parameters,
          id: nuevoId(),
          name: nombre,
          type: esT ? def.tipoHerramienta : def.tipo,
          typeVersion: def.version,
          position: pos(n),
          credentials: { [def.cred.clave]: { id: '', name: def.cred.nombre } },
        };
      } else {
        nodo = {
          parameters: copiaJson(esT ? OTRA_APP.paramsHerramienta() : OTRA_APP.paramsPaso()),
          id: nuevoId(),
          name: nombre,
          type: esT ? OTRA_APP.tipoHerramienta : OTRA_APP.tipo,
          typeVersion: OTRA_APP.version,
          position: pos(n),
          notes: OTRA_APP.nota(texto),
        };
      }
      lista.push(nodo);
    }
  }

  // las conexiones: pasos con la salida «main»; herramientas con «ai_tool» (de la herramienta hacia su agente)
  const yaMain = new Map<string, Set<string>>();
  for (const e of seqs) {
    if (!porId.has(e.de) || !porId.has(e.a)) continue;
    const origen = nombreDeId(raiz(e.de));
    const destino = nombreDeId(e.a);
    const yaDesdeEsteOrigen = yaMain.get(origen) ?? new Set<string>();
    yaMain.set(origen, yaDesdeEsteOrigen);
    if (yaDesdeEsteOrigen.has(destino)) continue;
    yaDesdeEsteOrigen.add(destino);
    enlazar(origen, destino, 'main');
  }
  for (const e of a.edges) {
    if (e.tipo === 'tool' && porId.has(e.de) && porId.has(e.a)) enlazar(nombreDeId(e.a), nombreDeId(e.de), 'ai_tool');
  }

  const connections = Object.fromEntries(Array.from(con, ([origen, porTipo]) => [origen, Object.fromEntries(porTipo)])) as ConexionesN8n;
  const settings: FlujoN8n['settings'] = { executionOrder: 'v1' };
  if (trig && disparadorN8n(trig).conZona && zona && FORMA_DE_ZONA.test(zona)) settings.timezone = zona;
  const name = String(a.nombreFlujo || '').trim() || NOMBRE_FLUJO_INICIAL;

  // el webhookId depende del contenido del flujo: dos flujos distintos no pueden compartir la URL del chat
  const conWebhook = lista.filter(n => n.webhookId !== undefined);
  if (conWebhook.length > 0) {
    for (const n of conWebhook) n.webhookId = '';
    const huella = JSON.stringify({ name, nodes: lista, connections });
    conWebhook.forEach((n, i) => {
      n.webhookId = uuidDeTexto(`${huella}#${i}`);
    });
  }

  return { name, nodes: lista, connections, settings, pinData: {} };
}

// ---------------------------------------------------------------- lo que se exporta

/** Los errores (bloquean la descarga) y avisos (no) de un flujo. Barata: no arma ni serializa nada. */
export function revisarFlujo(est: EstadoExportable): RevisionFlujo {
  const { errores, avisos } = analizar(est);
  return { errores, avisos };
}

/**
 * Arma el archivo de n8n. Solo para un flujo SIN errores (`revisarFlujo`); si los tiene, o si el archivo
 * armado lleva algo que parece una clave, lanza. Es lo costoso: llámala al descargar, copiar o ver el
 * JSON, no en cada pulsación.
 */
export function construirN8n(est: EstadoExportable, opciones: OpcionesExportar = {}): FlujoN8n {
  const a = analizar(est);
  if (a.errores.length > 0) throw new Error(`El flujo tiene errores: ${a.errores.join(' | ')}`);
  const flujo = armar(a, opciones.zona);
  if (claveEnFlujo(flujo)) throw new Error(MSG_CLAVE_EN_EL_ARCHIVO);
  return flujo;
}

/** La revisión y, si no hay errores, el archivo (`flujo`) y su texto (`json`, con 2 espacios). Con errores: `flujo` null y `json` vacío. */
export function construirFlujo(est: EstadoExportable, opciones: OpcionesExportar = {}): ResultadoFlujo {
  const a = analizar(est);
  if (a.errores.length > 0) return { errores: a.errores, avisos: a.avisos, flujo: null, json: '' };
  const flujo = armar(a, opciones.zona);
  // última red: aunque la revisión no haya visto una clave, el archivo armado no sale con ella
  if (claveEnFlujo(flujo)) return { errores: [MSG_CLAVE_EN_EL_ARCHIVO], avisos: a.avisos, flujo: null, json: '' };
  return { errores: a.errores, avisos: a.avisos, flujo, json: JSON.stringify(flujo, null, 2) };
}
