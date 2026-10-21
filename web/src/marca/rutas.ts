// Las direcciones del recorrido (dueño, 21-oct-2026: «por cada pestaña, una ruta»): una página por nivel, sin router.
//
//   /estudio/                                el mapa («Elige un área»)           ← la principal
//   /estudio/marketing/                      las opciones del área
//   /estudio/marketing/distrito/             las herramientas del grupo
//   /estudio/marketing/distrito/imagen/      la herramienta (las tres de la Caja: imagen, video, edicion)
//
// Todo sale de MENU (menu.ts): la dirección de un nivel es sus claves, salvo el área que trae `ruta` (Marketing = `mkt`).
// Es una función PURA de los datos (sin DOM ni node:fs), para probarla entera y para que un guardián compare lo que dice con
// las carpetas de web/estudio/. Las pantallas hoja (agenda, COI…) llevan su propia `href` en menu.ts y no son un nivel.
//
// NUNCA se busca un nivel con un objeto indexado por su clave: hay una pantalla que se llama `constructor` y choca con
// Object.prototype. Aquí todo es `find` sobre las listas de MENU.
import { MENU, PREFIJO, RUTA_MAPA, trozoDeArea, urlDeArea, type AreaMenu, type GrupoMenu, type Lugar, type PantallaMenu, type PestanaCaja } from './menu';

// El prefijo, la principal y la dirección de un área viven en menu.ts (así `urlDeInicio` no crea un ciclo de importación);
// se reexportan aquí para que quien trabaja con las direcciones las pida todas de un solo módulo.
export { PREFIJO, RUTA_MAPA, urlDeArea };

export type Nivel =
  | { tipo: 'mapa' }
  | { tipo: 'area'; area: string }
  | { tipo: 'grupo'; area: string; grupo: string }
  /** Una de las tres pestañas de la Caja (imagen, video, edicion): las hojas con `href` ya son una página aparte. */
  | { tipo: 'herramienta'; lugar: Lugar };

export const urlDeGrupo = (a: AreaMenu, g: GrupoMenu): string => `${urlDeArea(a)}${g.clave}/`;
export const urlDeHerramienta = (a: AreaMenu, g: GrupoMenu, p: PantallaMenu): string => `${urlDeGrupo(a, g)}${p.clave}/`;

const INDICE = 'index.html';

/** El nivel que una dirección nombra, o null si no es del recorrido (una hoja, una carpeta que no existe, un enlace escrito a mano). */
export function nivelDeRuta(direccion: string): Nivel | null {
  // /estudio/marketing/index.html es la misma página que /estudio/marketing/
  const pathname = direccion.endsWith(`/${INDICE}`) ? direccion.slice(0, -INDICE.length) : direccion;
  if (pathname === RUTA_MAPA) return { tipo: 'mapa' };
  if (!pathname.startsWith(PREFIJO) || !pathname.endsWith('/')) return null;
  const [trozoArea, claveGrupo, clavePantalla, ...sobra] = pathname.slice(PREFIJO.length, -1).split('/');
  if (!trozoArea || sobra.length) return null;
  const area = MENU.find(a => trozoDeArea(a) === trozoArea);
  if (!area) return null;
  if (claveGrupo === undefined) return { tipo: 'area', area: area.clave };
  const grupo = area.grupos.find(g => g.clave === claveGrupo);
  if (!grupo) return null;
  if (clavePantalla === undefined) return { tipo: 'grupo', area: area.clave, grupo: grupo.clave };
  const pantalla = grupo.pantallas.find(p => p.clave === clavePantalla && p.caja !== undefined);
  return pantalla ? { tipo: 'herramienta', lugar: { area: area.clave, grupo: grupo.clave, pantalla: pantalla.clave } } : null;
}

/**
 * `nivelDeRuta` para lo que da `location.pathname`: la dirección tal como se escribió, que puede traer «%XX». El servidor decide qué página
 * sirve con la ruta ya DECODIFICADA (uvicorn), así que `/estudio/%6Darketing/` llega a la página de Marketing y esta tiene que reconocerla.
 * Un «%» mal formado (`/estudio/%E0%A4%A/`) no se puede decodificar y se queda tal cual: no es un nivel.
 */
export function nivelDeDireccion(pathname: string): Nivel | null {
  let direccion = pathname;
  try {
    direccion = decodeURIComponent(pathname);
  } catch {
    /* un «%» mal formado: se busca tal cual y no será un nivel */
  }
  return nivelDeRuta(direccion);
}

export interface RutaDelRecorrido {
  url: string;
  nivel: Nivel;
  /** El `<title>` de la página: el de siempre, «Estudio de video», y detrás dónde estás. */
  titulo: string;
}

const TITULO = 'Estudio de video';

/**
 * Todas las páginas de nivel que MENU pide, en el orden en que se recorren: el mapa, cada área (también las «Próximamente»: su
 * página dice «Todavía no está disponible.»), cada grupo (también los vacíos) y las herramientas de la Caja. Son 16.
 */
export function rutasDelRecorrido(): RutaDelRecorrido[] {
  const rutas: RutaDelRecorrido[] = [{ url: RUTA_MAPA, nivel: { tipo: 'mapa' }, titulo: TITULO }];
  for (const a of MENU) {
    rutas.push({ url: urlDeArea(a), nivel: { tipo: 'area', area: a.clave }, titulo: `${TITULO} · ${a.titulo}` });
    for (const g of a.grupos) {
      rutas.push({ url: urlDeGrupo(a, g), nivel: { tipo: 'grupo', area: a.clave, grupo: g.clave }, titulo: `${TITULO} · ${a.titulo} · ${g.titulo}` });
      for (const p of g.pantallas.filter(x => x.caja !== undefined)) {
        rutas.push({
          url: urlDeHerramienta(a, g, p),
          nivel: { tipo: 'herramienta', lugar: { area: a.clave, grupo: g.clave, pantalla: p.clave } },
          titulo: `${TITULO} · ${a.titulo} · ${g.titulo} · ${p.titulo}`,
        });
      }
    }
  }
  return rutas;
}

/**
 * La carpeta de web/estudio/ que sirve esa ruta: «/estudio/marketing/distrito/» → «marketing/distrito».
 * La principal (`/estudio/`) es la raíz misma, web/estudio/index.html: su carpeta es la cadena vacía.
 */
export const carpetaDe = (url: string): string => url.slice(PREFIJO.length, -1);

/** La página de la Caja que abre una pestaña (`imagenes` → …/distrito/imagen/): a donde llevan los enlaces de siempre que traían un texto. */
export function urlDeCaja(pestana: PestanaCaja): string | null {
  for (const a of MENU)
    for (const g of a.grupos)
      for (const p of g.pantallas) if (p.caja === pestana) return urlDeHerramienta(a, g, p);
  return null;
}
