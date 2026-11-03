// Todos los avisos que el Constructor le dice a la persona, en un solo lugar: lo que cada acción
// responde (Apéndice A del informe 04) y lo que dice la interfaz al descargar y copiar. El reductor
// los arma con estas funciones y las pruebas los comparan con ellas, así el español (LATAM, tuteo,
// «dólares» donde toque) se revisa en un archivo y no en cien.
//
// Cada función devuelve `{ texto, tipo }`: `ok` = salió bien, `info` = te cuento qué pasó o qué toca,
// `mal` = no se pudo y por qué. Los nombres de los cuadros llegan ya hechos (`tituloDe`); aquí van
// entre «» como en el mockup. Puro: no importa nada de React ni del DOM.

import { TOPE_AGENTES, TOPE_APPS, TOPE_CUADROS } from './datos/constantes';
import type { ClaseCambio, Conectando, TipoAviso, TipoArista } from './tipos';

/** Un aviso a medio hacer: su texto y su tono. El reductor le pone el `id` y si lleva «Deshacer». */
export interface TextoAviso {
  texto: string;
  tipo: TipoAviso;
}

const ok = (texto: string): TextoAviso => ({ texto, tipo: 'ok' });
const info = (texto: string): TextoAviso => ({ texto, tipo: 'info' });
const mal = (texto: string): TextoAviso => ({ texto, tipo: 'mal' });
/** Un nombre entre comillas angulares. */
const q = (nombre: string) => `«${nombre}»`;

// ---------------------------------------------------------------- elegir y abrir

/** Se tocó la insignia de una flecha. */
export const abrirEnlace = (de: string, a: string): TextoAviso =>
  info(`Elegiste la conexión de ${q(de)} a ${q(a)}. En el panel de Ajustes puedes cambiarla.`);

/** Se creó el disparador; `unidoCon` = el cuadro con el que se conectó solo (si había cuadros sueltos). */
export const disparadorElegido = (titulo: string, unidoCon: string | null): TextoAviso =>
  ok(
    `Listo: el flujo arranca con ${q(titulo)}` +
      (unidoCon === null ? '. Ahora toca el + para agregar lo que sigue.' : ` y lo conectamos con ${q(unidoCon)}.`),
  );

/** Ya había un disparador: el tope es uno por flujo. */
export const yaHayDisparador = (): TextoAviso => mal('Por ahora es un solo disparador por flujo.');

// ---------------------------------------------------------------- el menú del «+»

export const menuEnMedio = (): TextoAviso => info('Elige qué poner en medio de la conexión.');
export const menuHerramienta = (de: string): TextoAviso => info(`Elige la app que le das a ${q(de)} como herramienta.`);
export const menuDespues = (de: string): TextoAviso => info(`Elige qué va después de ${q(de)}: una app o un agente.`);
export const menuCerrado = (): TextoAviso => info('Cerramos el menú.');
/** Por qué solo un agente tiene patita o puede conversar con otra IA. Es también el motivo de la regla 8 de `puedeEnlazar` (grafo.ts lo importa de aquí). */
export const MOTIVO_SOLO_AGENTES_TIENEN_HERRAMIENTAS = 'Solo un agente de IA puede tener herramientas o conversar con otra IA.';
/** Se intentó abrir la patita de algo que no es un agente. */
export const soloAgentesTienenHerramientas = (): TextoAviso => mal(MOTIVO_SOLO_AGENTES_TIENEN_HERRAMIENTAS);

export const topeAgentes = (): TextoAviso => mal(`Por ahora son hasta ${TOPE_AGENTES} agentes por flujo.`);
export const topeApps = (): TextoAviso => mal(`Por ahora son hasta ${TOPE_APPS} apps por flujo.`);
/**
 * Por qué una IA no puede ir por la patita (solo van apps). Es la base de los tres avisos de la regla «por la patita solo van
 * apps» y el motivo que muestra un cuadro que no se puede elegir al conectar (selectores.ts lo exporta como `MOTIVO_SOLO_APPS`).
 */
export const MOTIVO_SOLO_APPS =
  'Por la patita solo van apps. Para que dos IA conversen, ponlas una después de otra y toca su flecha.';
/** El menú de la patita no crea agentes (se puede poner un agente después, con el + de la derecha). */
export const soloAppsEnElMenu = (): TextoAviso =>
  mal(MOTIVO_SOLO_APPS.replace('una después de otra y', 'una después de otra con el + de la derecha y'));
export const escribeNombreApp = (): TextoAviso => mal('Escribe el nombre de la app.');
export const conexionYaNoExiste = (): TextoAviso => mal('Esa conexión ya no existe.');
/** `huecoParaInsertar` devolvió null: no cabe un cuadro en medio sin dejar una flecha hacia atrás. */
export const sinLugarEnMedio = (): TextoAviso =>
  mal('No hay lugar en medio de esa conexión: mueve los cuadros de la derecha y vuelve a intentarlo.');

/** Una regla de `puedeEnlazar` rechazó lo que se iba a crear o conectar: su motivo, tal cual. */
export const motivoDeRechazo = (motivo: string): TextoAviso => mal(motivo);

/** Dónde quedó lo que se agregó. */
export type LugarAgregado = 'medio' | { herramientaDe: string } | { despuesDe: string };

/** Se creó un cuadro desde el menú. `cuadro` = su título; `esAgente` decide «el agente «X»» o «X». */
export function agregado(cuadro: string, esAgente: boolean, lugar: LugarAgregado): TextoAviso {
  const que = esAgente ? `el agente ${q(cuadro)}` : q(cuadro);
  const donde =
    lugar === 'medio'
      ? 'en medio'
      : 'herramientaDe' in lugar
        ? `como herramienta de ${q(lugar.herramientaDe)}`
        : `después de ${q(lugar.despuesDe)}`;
  return ok(`Agregamos ${que} ${donde}. Sus ajustes están en el panel de Ajustes.`);
}

// ---------------------------------------------------------------- conectar con uno que ya está

/** Lo que dice el aviso (y el banner) mientras se espera el cuadro destino. */
export function textoConectar(tipo: TipoArista, rol: Conectando['rol'], ancla: string): TextoAviso {
  if (tipo === 'seq') {
    return info(
      rol === 'origen' ? `Toca el cuadro que irá DESPUÉS de ${q(ancla)}.` : `Toca el cuadro que irá ANTES de ${q(ancla)}.`,
    );
  }
  return info(
    rol === 'origen'
      ? `Toca la app que ${q(ancla)} podrá usar como herramienta.`
      : `Toca el agente que podrá usar ${q(ancla)} como herramienta.`,
  );
}

export const conexionCancelada = (): TextoAviso => info('Cancelamos la conexión.');
/** Un cuadro no sirve de destino: el motivo de `puedeEnlazar` y cómo seguir. */
export const elegirOtro = (motivo: string): TextoAviso => mal(`${motivo} Elige otro cuadro, o cancela.`);
export const soloAppsAlConectar = (): TextoAviso => mal(`${MOTIVO_SOLO_APPS} Elige otro cuadro, o cancela.`);
export const conectados = (de: string, a: string): TextoAviso => ok(`Conectamos ${q(de)} con ${q(a)}.`);
/** Esc sobre un cuadro. */
export const cerramosTodo = (): TextoAviso => info('Cerramos lo que estaba abierto.');

// ---------------------------------------------------------------- el editor de la flecha

export const noSePuedeCambiar = (motivo: string): TextoAviso => mal(`No se puede cambiar: ${motivo}`);
export const ahoraConversan = (a: string, b: string): TextoAviso =>
  ok(`${q(a)} y ${q(b)} ahora conversan: ida y vuelta. Revisa en sus ajustes para qué le sirve ${q(b)}.`);
export const ahoraEsHerramienta = (a: string, b: string): TextoAviso =>
  ok(`${q(b)} ahora es herramienta de ${q(a)}: ida y vuelta.`);
export const ahoraVaDespues = (a: string, b: string): TextoAviso =>
  ok(`${q(b)} ahora va después de ${q(a)}: un solo sentido.`);
export const conexionQuitada = (): TextoAviso => info('Quitamos la conexión.');

// ---------------------------------------------------------------- quitar, deshacer, limpiar, cargar

/** Lo que pasó al quitar un cuadro: cuántas conexiones se unieron, cuántas herramientas quedaron sueltas, si era el disparador. */
export interface DatosQuitar {
  titulo: string;
  /** ¿Se unió lo de antes con lo de después (A → B → C pasó a A → C)? */
  unidos: boolean;
  /** Cuántas herramientas (conexiones `tool`) salían del cuadro y quedaron sueltas. */
  sueltas: number;
  /** ¿Era el disparador? */
  esDisparador: boolean;
}

/** Se quitó un cuadro (lleva «Deshacer»). */
export function quitamos(d: DatosQuitar): TextoAviso {
  const nota =
    d.sueltas === 0
      ? ''
      : d.sueltas === 1
        ? ' Su herramienta quedó suelta en el lienzo: quítala también si ya no la necesitas.'
        : ` Sus ${d.sueltas} herramientas quedaron sueltas en el lienzo: quítalas también si ya no las necesitas.`;
  const disparador = d.esDisparador ? ' Elige otro disparador para que el flujo vuelva a arrancar.' : '';
  const base = d.unidos
    ? `Quitamos ${q(d.titulo)} y unimos lo de antes con lo de después.`
    : `Quitamos ${q(d.titulo)} y sus conexiones.`;
  return info(base + nota + disparador);
}

/** Se deshizo la última instantánea; el texto depende de qué clase de cambio era. */
export function deshecho(clase: ClaseCambio): TextoAviso {
  switch (clase) {
    case 'quitar':
      return ok('Listo: volvimos a poner lo que quitaste.');
    case 'agregar':
      return ok('Listo: quitamos lo que habías agregado.');
    case 'cargar':
      return ok('Listo: volvió el flujo que tenías antes.');
    case 'cambiar':
      return ok('Listo: volvimos a como estaba antes.');
  }
}

/** Se pidió deshacer y no hay nada guardado. */
export const nadaQueDeshacer = (): TextoAviso => info('Ya no hay nada que deshacer.');
/** Se pidió deshacer desde un aviso viejo: después de eso se cambió otra cosa y deshacerlo borraría ese cambio. */
export const yaNoSePuedeDeshacer = (): TextoAviso =>
  info('Eso ya no se puede deshacer: cambiaste algo después.');

export const limpiado = (): TextoAviso => info('Empezamos de cero. Elige cómo arranca tu flujo.');
export const ejemploCargado = (): TextoAviso => ok('Cargamos el ejemplo.');
/** Se abrió un flujo de afuera (Asistente, borrador). */
export const flujoAbierto = (): TextoAviso => ok('Abrimos tu flujo en el constructor.');

/**
 * Se rechazó un flujo de afuera. `codigos` son los de `invariantesDelGrafo` (`codigoDeViolacion`) o, si ni siquiera
 * llegó a mirarse el grafo, `forma`, `con-clave` (texto que parece una clave: el aviso NO la repite) o `tope-cuadros`
 * / `tope-conexiones` (demasiado grande para mirarlo). Si el motivo es un tope, se dice cuál; si no, se dice que no se
 * puede dibujar.
 */
export function flujoRechazado(codigos: readonly string[]): TextoAviso {
  const principio = 'No pudimos abrir ese flujo';
  if (codigos.includes('con-clave')) {
    return mal(`${principio}: trae una clave pegada. Las claves se ponen en n8n al conectar la cuenta, nunca dentro del flujo.`);
  }
  if (codigos.includes('tope-cuadros') || codigos.includes('tope-conexiones')) {
    return mal(`${principio}: es demasiado grande y por ahora el Constructor admite hasta ${TOPE_CUADROS} cuadros.`);
  }
  if (codigos.includes('varios-disparadores')) {
    return mal(`${principio}: tiene más de un disparador y por ahora el Constructor admite uno.`);
  }
  if (codigos.includes('tope-agentes')) {
    return mal(`${principio}: tiene más de ${TOPE_AGENTES} agentes de IA y por ahora el Constructor admite hasta ${TOPE_AGENTES}.`);
  }
  if (codigos.includes('tope-apps')) {
    return mal(`${principio}: tiene más de ${TOPE_APPS} apps y por ahora el Constructor admite hasta ${TOPE_APPS}.`);
  }
  return mal(`${principio}: no se puede dibujar en el Constructor.`);
}

// ---------------------------------------------------------------- descargar y copiar (los dice la interfaz)

/** No hay archivo todavía: el primer error de `revisarFlujo`. */
export const descargaNoPosible = (primerError: string): TextoAviso => mal(`Todavía no se puede descargar. ${primerError}`);
/** Se descargó `archivo`. Cómo abrirlo en n8n va en el mismo aviso. */
export const descargado = (archivo: string): TextoAviso =>
  ok(`Listo: ${archivo}. En n8n, abre el menú «⋯» de arriba a la derecha y elige «Import from File».`);
export const noSeDescargo = (): TextoAviso => info('No se descargó. Cuando quieras, vuelve a pulsar «Descargar .json».');
export const jsonNoDisponible = (primerError: string): TextoAviso => mal(`Todavía no hay JSON: ${primerError}`);
export const jsonCopiado = (): TextoAviso => ok('Copiamos el JSON.');
export const noSeCopio = (): TextoAviso => mal('No pudimos copiar solos. Selecciona el texto y usa Ctrl+C.');
