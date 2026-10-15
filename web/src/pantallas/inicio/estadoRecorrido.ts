// El recorrido del inicio (dueño, 15-oct-2026: «Mapa con Irremplazables»): en qué paso de la tarjeta estás y a dónde te lleva
// cada cosa. Es todo el estado y toda la lógica del recorrido SIN React ni DOM, para poder probarlo entero (estadoRecorrido.test.ts);
// Recorrido.tsx, Mapa.tsx, Grupos.tsx y Pantallas.tsx solo lo pintan.
//
// Son tres pasos, y la tarjeta siempre muestra uno:
//   · `mapa`: la X con las cinco áreas («Elige un área»);
//   · `grupos`: las tres opciones del área que se eligió («Elige un grupo»);
//   · `contenido`: lo que hay dentro del grupo donde estás: la caja (Marketing › Distrito) o la lista de sus pantallas.
// Se aterriza en `contenido`, en la caja, como siempre (decisión del dueño): el mapa se abre desde las migas.
//
// Hay DOS lugares que no son el mismo:
//   · el que estás MIRANDO (`explora`, solo en `grupos`): puede ser otra área que la de donde estás;
//   · donde ESTÁS (`area` + `grupo`, y `hoja` si llegaste desde una página aparte): es a donde «Volver a …» te regresa, así que
//     explorar el mapa nunca te saca de donde estabas hasta que eliges un grupo.
//
// Desde una pantalla hoja (agenda, métricas…) las migas son enlaces al inicio con `?desde=<lugar>&ver=<mapa|grupos>` (marca/menu.ts,
// `urlDeInicio`). Aquí se lee esa entrada UNA vez (`estadoInicial`), con las claves validadas contra el mapa: una clave que no existe
// (un enlace viejo, escrito a mano) se ignora y se aterriza en la caja.
import {
  buscar,
  LUGAR_INICIAL,
  lugarDeTexto,
  MENU,
  PARAM_DESDE,
  PARAM_VER,
  type AreaMenu,
  type GrupoMenu,
  type PestanaCaja,
} from '../../marca/menu';
import type { NombreIcono } from '../../ui/iconos';

export type Paso = 'mapa' | 'grupos' | 'contenido';

export interface EstadoRecorrido {
  paso: Paso;
  /** El área cuyas opciones se ven en `grupos` (la que se eligió en el mapa, o la de donde estás al reabrirlas desde la miga). */
  explora: string;
  /** Donde estás: el área y el grupo cuyo contenido es el de `contenido` y al que «Volver» regresa. */
  area: string;
  grupo: string;
  /** La clave de la pantalla de OTRA página desde la que se llegó (`?desde=`), mientras sigas sin elegir un grupo. Con ella,
   *  «Volver» no cambia de paso: te lleva de regreso a esa página. null en cualquier otro caso (y siempre en `contenido`). */
  hoja: string | null;
}

/** Al abrir el inicio sin nada en la URL: la caja, en el grupo de siempre. */
export const REPOSO: EstadoRecorrido = {
  paso: 'contenido',
  explora: LUGAR_INICIAL.area,
  area: LUGAR_INICIAL.area,
  grupo: LUGAR_INICIAL.grupo,
  hoja: null,
};

// ---------------------------------------------------------------------------
// el mapa de menu.ts, por clave

export const areaDe = (clave: string): AreaMenu | undefined => MENU.find(a => a.clave === clave);

export const grupoDe = (area: string, clave: string): GrupoMenu | undefined =>
  areaDe(area)?.grupos.find(g => g.clave === clave);

/** El grupo con las pestañas de la caja (Imagen, Video, Edición): su contenido ES la caja, no una lista de pantallas. */
export const esCaja = (g: GrupoMenu): boolean => g.pantallas.some(p => p.caja !== undefined);

/** El grupo donde estás. El estado solo se arma con claves de menu.ts (lo validan `reducir` y `estadoInicial`). */
export function grupoActual(e: EstadoRecorrido): GrupoMenu {
  const g = grupoDe(e.area, e.grupo);
  if (!g) throw new Error(`recorrido: el lugar ${e.area}.${e.grupo} no está en menu.ts`);
  return g;
}

/** ¿Lo que se ve ahora es la caja? Con eso las listas de debajo (Mis creaciones…) se muestran o se esconden. */
export const cajaVisible = (e: EstadoRecorrido): boolean => e.paso === 'contenido' && esCaja(grupoActual(e));

// ---------------------------------------------------------------------------
// los cambios de paso

export type Accion =
  /** La miga del área. */
  | { tipo: 'abrir-mapa' }
  /** La miga del grupo: las tres opciones del área donde estás. */
  | { tipo: 'abrir-grupos' }
  /** Una ficha del mapa. */
  | { tipo: 'elegir-area'; area: string }
  /** Una tarjeta de grupo. */
  | { tipo: 'elegir-grupo'; area: string; grupo: string }
  /** «Volver a …» y Esc. */
  | { tipo: 'volver' };

export function reducir(e: EstadoRecorrido, a: Accion): EstadoRecorrido {
  switch (a.tipo) {
    case 'abrir-mapa':
      return e.paso === 'mapa' ? e : { ...e, paso: 'mapa' };
    case 'abrir-grupos':
      // desde el mapa no hay miga de grupo; desde las opciones ya están abiertas
      return e.paso === 'contenido' ? { ...e, paso: 'grupos', explora: e.area } : e;
    case 'elegir-area': {
      // un área apagada (Producto, Ventas…) o sin grupos se ve en el mapa, pero no se abre
      const area = areaDe(a.area);
      if (!area || area.proximamente || !area.grupos.length) return e;
      return { ...e, paso: 'grupos', explora: area.clave };
    }
    case 'elegir-grupo':
      // el grupo tiene que ser de ESA área: una pareja que no existe deja todo como estaba
      if (!grupoDe(a.area, a.grupo)) return e;
      return { paso: 'contenido', explora: a.area, area: a.area, grupo: a.grupo, hoja: null };
    case 'volver':
      // «Volver» a una página aparte no es un cambio de paso: lo atiende quien navega (Recorrido.tsx, con `destinoDeVolver`)
      return e.paso === 'contenido' || e.hoja !== null ? e : { ...e, paso: 'contenido' };
  }
}

// ---------------------------------------------------------------------------
// lo que la tarjeta dice

export interface DatosMiga {
  clave: 'area' | 'grupo';
  titulo: string;
  icono: NombreIcono;
  /** Lo que lee el lector de pantalla: la miga dice a dónde lleva y dónde estás. El texto visible va dentro (WCAG 2.5.3). */
  rotulo: string;
  /** La miga donde estás en este paso (`aria-current`). */
  actual: boolean;
}

/** La ruta ya elegida: en el mapa no hay (se está eligiendo el primer nivel); en las opciones, el área que se mira; en el contenido,
 *  el área y el grupo donde estás. Cada miga reabre su nivel. */
export function migasDe(e: EstadoRecorrido): DatosMiga[] {
  if (e.paso === 'mapa') return [];
  const area = areaDe(e.paso === 'grupos' ? e.explora : e.area);
  if (!area) throw new Error(`recorrido: el área ${e.explora}/${e.area} no está en menu.ts`);
  const migas: DatosMiga[] = [
    {
      clave: 'area',
      titulo: area.titulo,
      icono: area.icono,
      rotulo: `Volver al mapa para cambiar de área (ahora: ${area.titulo})`,
      actual: e.paso === 'grupos',
    },
  ];
  if (e.paso === 'contenido') {
    const grupo = grupoActual(e);
    migas.push({
      clave: 'grupo',
      titulo: grupo.titulo,
      icono: grupo.icono,
      rotulo: `Volver a las opciones de ${area.titulo} (ahora: ${grupo.titulo})`,
      actual: true,
    });
  }
  return migas;
}

/** ¿Hay «Volver a …»? Solo con el mapa o las opciones abiertos: en el contenido ya estás en él. */
export const hayVolver = (e: EstadoRecorrido): boolean => e.paso !== 'contenido';

export interface DestinoDeVolver {
  /** «Volver a Imagen»: dice DÓNDE caerás (la pestaña de la caja de ahora, la pantalla de donde viniste o el grupo). */
  rotulo: string;
  /** Con una página aparte de por medio, su dirección: «Volver» navega en vez de cambiar de paso. */
  href: string | null;
}

/** A dónde regresa «Volver a …» (y Esc). `familia` es la pestaña de la caja de ahora: la caja es el único contenido que cambia solo. */
export function destinoDeVolver(e: EstadoRecorrido, familia: PestanaCaja): DestinoDeVolver {
  const grupo = grupoActual(e);
  const hoja = e.hoja === null ? undefined : grupo.pantallas.find(p => p.clave === e.hoja);
  if (hoja) return { rotulo: `Volver a ${hoja.titulo}`, href: hoja.href ?? null };
  const pestana = esCaja(grupo) ? grupo.pantallas.find(p => p.caja === familia) : undefined;
  return { rotulo: `Volver a ${pestana?.titulo ?? grupo.titulo}`, href: null };
}

// ---------------------------------------------------------------------------
// la entrada por la URL

/** El estado con el que abre el inicio: el de `?desde=<lugar>&ver=<mapa|grupos>` si ambos son válidos, y si no, la caja. */
export function estadoInicial(busqueda: string): EstadoRecorrido {
  const params = new URLSearchParams(busqueda);
  const lugar = lugarDeTexto(params.get(PARAM_DESDE));
  const ver = params.get(PARAM_VER);
  if (!lugar || (ver !== 'mapa' && ver !== 'grupos')) return REPOSO;
  const pantalla = buscar(lugar)?.pantalla;
  return {
    paso: ver === 'mapa' ? 'mapa' : 'grupos',
    explora: lugar.area,
    area: lugar.area,
    grupo: lugar.grupo,
    // «Volver» solo puede ir a una página que existe: una pestaña de la caja o una pantalla apagada no son otra página
    hoja: pantalla?.href ? pantalla.clave : null,
  };
}

/** La dirección del inicio SIN `desde` ni `ver` (con todo lo demás: `?blotato=conectar`, el ancla), o null si no los traía.
 *  Se pone con `history.replaceState`: la entrada se lee una vez y recargar o compartir el enlace no repite el recorrido. */
export function urlSinEntrada(href: string): string | null {
  const url = new URL(href);
  if (!url.searchParams.has(PARAM_DESDE) && !url.searchParams.has(PARAM_VER)) return null;
  url.searchParams.delete(PARAM_DESDE);
  url.searchParams.delete(PARAM_VER);
  return url.pathname + url.search + url.hash;
}

// ---------------------------------------------------------------------------
// el doble clic

/** La hora de un clic. Aparte, y no un `Date.now()` suelto en el componente: así la lectura del reloj vive fuera del render. */
export const ahora = (): number => Date.now();

/** Cuánto después de cambiar de paso un segundo clic de un doble clic se toma por accidente. */
export const VENTANA_DOBLE_CLIC_MS = 500;

/** El doble clic en una ficha del mapa o en la tarjeta de un grupo: el primer clic cambia de paso y el segundo cae sobre lo que aparece
 *  en el mismo sitio (la primera tarjeta de las opciones, el botón de conectar o la primera pantalla de una lista), que se activaría
 *  sin que nadie lo pidiera. Un segundo clic (`detail > 1`) a menos de medio segundo del cambio no cuenta; una elección deliberada
 *  (otro clic pasado el medio segundo) y el teclado (Enter: `detail` 0) pasan. */
export const esDobleClicAccidental = (detail: number, msDesdeElCambio: number): boolean =>
  detail > 1 && msDesdeElCambio < VENTANA_DOBLE_CLIC_MS;
