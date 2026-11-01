// El recorrido del inicio (dueño, 15-oct-2026: «Mapa con Irremplazables»): en qué paso estás y a dónde te lleva cada cosa. Es todo
// el estado y toda la lógica del recorrido SIN React ni DOM, para poder probarlo entero (estadoRecorrido.test.ts); Recorrido.tsx,
// Mapa.tsx, Grupos.tsx y Pantallas.tsx solo lo pintan.
//
// Son tres pasos, y el inicio siempre muestra uno:
//   · `mapa`: la X con las cinco áreas («Elige un área»);
//   · `grupos`: las tres opciones del área que se eligió («Elige un grupo»);
//   · `contenido`: lo que hay dentro del grupo donde estás: la caja (Marketing › Distrito) o la lista de sus pantallas.
// Se aterriza en `mapa` (dueño, 15-oct-2026, segunda ronda: «el mapa es el inicio»): nada está elegido todavía, y la caja (Marketing ›
// Distrito) está montada y escondida esperando a que la elijan. Antes se aterrizaba en la caja.
//
// Hay DOS lugares que no son el mismo:
//   · el que estás MIRANDO (`explora`, solo en `grupos`): puede ser otra área que la de donde estás;
//   · donde ESTÁS (`area` + `grupo`, y `hoja` si llegaste desde una página aparte), que solo cuenta si ya elegiste (`elegido`): mirar el
//     mapa nunca te saca de donde estabas hasta que eliges un grupo. En el reposo `area` y `grupo` son los de la caja escondida, pero
//     `elegido` es falso: nada se ve marcado, porque nadie ha elegido nada.
//
// Subir de nivel son las migas (el área abre el mapa, el grupo abre las opciones) y Esc en las opciones: no hay «Volver a …». La única
// excepción es la página aparte de donde se llegó (`hoja`): esa no se alcanza con las migas, así que ahí sí hay «Volver a Agenda» y Esc
// regresa a ella.
//
// Desde una pantalla hoja (agenda, métricas…) las migas eran enlaces al inicio con `?desde=<lugar>&ver=<mapa|grupos>`. Ya no: ahora van
// directo a la página del nivel (marca/menu.ts, `urlDeInicio`), pero un marcador viejo con esa entrada todavía llega aquí. Se lee UNA vez
// (`estadoInicial`), con las claves validadas contra el mapa: una clave que no existe (un enlace viejo, escrito a mano) se ignora y se
// aterriza en el mapa, como siempre.
//
// Y hay otra entrada, la de «Llevar a la caja» de la Biblioteca de prompts (Ajustes 3, 16-oct-2026): `?prompt=<texto>` abre DIRECTO la caja en la
// pestaña Imagen con el texto puesto, y `?brief=<texto>` en la pestaña Video (`leerLlegadaDeTexto`, en llegada.ts). Llegar así nunca crea
// ni cobra nada: solo deja la caja lista. Se lee una vez y la URL se limpia (`urlSinEntrada`, también en llegada.ts), igual que `?desde=`.
import { areaDe, buscar, grupoDe, LUGAR_INICIAL, lugarDeTexto, PARAM_DESDE, PARAM_VER, type GrupoMenu } from '../../marca/menu';
import type { NombreIcono } from '../../ui/iconos';
import { leerLlegadaDeTexto } from './llegada';

export type Paso = 'mapa' | 'grupos' | 'contenido';

export interface EstadoRecorrido {
  paso: Paso;
  /** El área cuyas opciones se ven en `grupos` (la que se eligió en el mapa, o la de donde estás al reabrirlas desde la miga). */
  explora: string;
  /** Donde estás: el área y el grupo cuyo contenido es el de `contenido` (la caja montada, vista o escondida, es la de este grupo). */
  area: string;
  grupo: string;
  /** ¿Ya hay un grupo elegido? Verdadero al elegir uno y al llegar desde una pantalla de otra página; falso SOLO en el reposo, donde
   *  `area` y `grupo` son los de la caja escondida pero nadie ha elegido nada. Sin él las fichas no llevan «Estás aquí» ni tono. */
  elegido: boolean;
  /** La clave de la pantalla de OTRA página desde la que se llegó (`?desde=`), mientras sigas sin elegir un grupo. Con ella se
   *  ve «Volver a …» y Esc te lleva de regreso a esa página. null en cualquier otro caso (y siempre en `contenido`). */
  hoja: string | null;
}

/** Al abrir el inicio sin nada en la URL: el mapa, con nada elegido (la caja de Marketing › Distrito, montada y escondida). */
export const REPOSO: EstadoRecorrido = {
  paso: 'mapa',
  explora: LUGAR_INICIAL.area,
  area: LUGAR_INICIAL.area,
  grupo: LUGAR_INICIAL.grupo,
  elegido: false,
  hoja: null,
};

// ---------------------------------------------------------------------------
// el mapa de menu.ts, por clave (`areaDe` y `grupoDe` viven en menu.ts)

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
  /** La miga del área, y Esc en las opciones. */
  | { tipo: 'abrir-mapa' }
  /** La miga del grupo: las tres opciones del área donde estás. */
  | { tipo: 'abrir-grupos' }
  /** Una ficha del mapa. */
  | { tipo: 'elegir-area'; area: string }
  /** Una tarjeta de grupo. */
  | { tipo: 'elegir-grupo'; area: string; grupo: string };

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
      return { paso: 'contenido', explora: a.area, area: a.area, grupo: a.grupo, elegido: true, hoja: null };
  }
}

// ---------------------------------------------------------------------------
// lo que el inicio dice

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

export interface DestinoDeVolver {
  /** «Volver a Agenda»: dice DÓNDE caerás, la pantalla de donde viniste. */
  rotulo: string;
  /** Su dirección: «Volver» navega (`location.assign`), no cambia de paso. */
  href: string;
}

/** El «Volver a …» que queda (dueño, 15-oct-2026: «no podemos poner el botón de "Volver a video"»): solo el de la PÁGINA APARTE de donde
 *  se llegó (`hoja`, ver `estadoInicial`), porque esa no se alcanza con las migas. Dentro del inicio subir de nivel son las migas. null =
 *  no hay botón. */
export function destinoDeVolver(e: EstadoRecorrido): DestinoDeVolver | null {
  if (e.hoja === null) return null;
  const hoja = grupoActual(e).pantallas.find(p => p.clave === e.hoja);
  return hoja?.href ? { rotulo: `Volver a ${hoja.titulo}`, href: hoja.href } : null;
}

/** Qué hace Esc en el paso de ahora: con una página aparte de por medio, regresa a ella (en el mapa y en las opciones); sin ella, en las
 *  opciones sube un nivel (al mapa); en el mapa y en el contenido (la caja o la lista de un grupo) no hace nada. null = nada. */
export type AlEscape = { tipo: 'ir'; href: string } | { tipo: 'accion'; accion: Accion };

export function alEscape(e: EstadoRecorrido): AlEscape | null {
  if (e.paso === 'contenido') return null;
  const destino = destinoDeVolver(e);
  if (destino) return { tipo: 'ir', href: destino.href };
  return e.paso === 'grupos' ? { tipo: 'accion', accion: { tipo: 'abrir-mapa' } } : null;
}

// ---------------------------------------------------------------------------
// la entrada por la URL

/** El estado con el que abre el inicio: el de `?desde=<lugar>&ver=<mapa|grupos>` si ambos son válidos, y si no, el reposo (el mapa). */
export function estadoInicial(busqueda: string): EstadoRecorrido {
  // un texto que llega a la caja (de la Biblioteca): se abre la caja, la de Marketing › Distrito, con algo ya elegido
  if (leerLlegadaDeTexto(busqueda)) return { ...REPOSO, paso: 'contenido', elegido: true };
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
    // venías de una pantalla de ese grupo: estás ahí
    elegido: true,
    // «Volver» solo puede ir a una página que existe: una pestaña de la caja o una pantalla apagada no son otra página
    hoja: pantalla?.href ? pantalla.clave : null,
  };
}
