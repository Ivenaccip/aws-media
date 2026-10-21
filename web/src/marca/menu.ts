// El mapa del producto: áreas → grupos → pantallas (dueño, 15-oct-2026: «Mapa con Irremplazables»). Es la ÚNICA lista de
// adónde se puede ir: el recorrido del inicio (mapa en X, tres opciones, lista de pantallas) y las migas de las pantallas hoja
// (agenda, métricas…) salen de aquí, así no se desincronizan.
//
// Una pantalla es de uno de tres tipos:
//   · `caja`: una pestaña de la caja del inicio (Imagen, Video, Edición). No navega: cambia de pestaña.
//   · `href`: una página aparte (agenda, competencia…). Navega, con la transición entre pantallas de siempre.
//   · `proximamente`: todavía no existe. Se enseña apagada (`aria-disabled`) y no lleva a ningún lado.
// Las URL `href` son las de siempre (`/agenda.html`…): server/migracion.py las manda a la pantalla nueva.
import type { NombreIcono } from '../ui/iconos';

/** Las tres pestañas de la caja del inicio (`Familia` de pantallas/inicio/logica.ts). */
export type PestanaCaja = 'imagenes' | 'videos' | 'edicion';

export interface PantallaMenu {
  clave: string;
  titulo: string;
  icono: NombreIcono;
  /** Una línea de apoyo (la lista de pantallas de un grupo la enseña bajo el título). */
  texto?: string;
  /** Una pestaña de la caja del inicio. */
  caja?: PestanaCaja;
  /** Una página aparte. */
  href?: string;
  /** La clave con la que esa página se llama en `<Marco pantalla="…">` (para sus migas). */
  pagina?: string;
  /** Se apaga sin la clave de Blotato del usuario (M23 · C). */
  blotato?: boolean;
  proximamente?: boolean;
}

export interface GrupoMenu {
  clave: string;
  titulo: string;
  icono: NombreIcono;
  /** Vacía = un grupo que todavía no existe (Deepseek): su tarjeta dice «Próximamente» y, al abrirla, que no está disponible. */
  pantallas: readonly PantallaMenu[];
}

export interface AreaMenu {
  clave: string;
  titulo: string;
  icono: NombreIcono;
  grupos: readonly GrupoMenu[];
  /** Un área apagada: se ve en el mapa («Próximamente») y no se puede abrir. */
  proximamente?: boolean;
  /** Cómo se llama el área en la dirección (/estudio/<ruta>/) si no es su `clave`: la de Marketing es `mkt` y la dirección dice `marketing`. */
  ruta?: string;
}

/** Dónde estás: claves de un área, un grupo y una pantalla de `MENU`. */
export interface Lugar {
  area: string;
  grupo: string;
  pantalla: string;
}

export const MENU: readonly AreaMenu[] = [
  {
    clave: 'mkt',
    ruta: 'marketing',
    titulo: 'Marketing',
    icono: 'marketing',
    grupos: [
      {
        clave: 'distrito',
        titulo: 'Distrito',
        icono: 'ubicacion',
        pantallas: [
          { clave: 'imagen', titulo: 'Imagen', icono: 'imagen', caja: 'imagenes' },
          { clave: 'video', titulo: 'Video', icono: 'video', caja: 'videos' },
          { clave: 'edicion', titulo: 'Edición', icono: 'cortar', caja: 'edicion' },
        ],
      },
      {
        clave: 'blotato',
        titulo: 'Blotato',
        icono: 'publicar',
        pantallas: [
          {
            clave: 'agenda',
            titulo: 'Agenda tus publicaciones',
            icono: 'agenda',
            texto: 'Programa tus posts en todas tus redes',
            href: '/agenda.html',
            pagina: 'agenda',
            blotato: true,
          },
          {
            // se apaga A PROPÓSITO aunque corre con Apify: el grupo se comporta como un bloque (dueño, 18-sep)
            clave: 'competencia',
            titulo: 'Investiga tu competencia',
            icono: 'competencia',
            texto: 'Qué le está funcionando a quien vigilas',
            href: '/competencia.html',
            pagina: 'competencia',
            blotato: true,
          },
          {
            clave: 'metricas',
            titulo: 'Ver mis métricas',
            icono: 'metricas',
            texto: 'Cómo rinden tus publicaciones',
            href: '/metricas.html',
            pagina: 'metricas',
            blotato: true,
          },
        ],
      },
      {
        clave: 'avanzado',
        titulo: 'Avanzado',
        icono: 'ajustes',
        pantallas: [
          {
            // MIX; Blotato es su requisito (dueño, 19-sep)
            clave: 'automaticas',
            titulo: 'Publicaciones automáticas',
            icono: 'automatico',
            texto: 'Una publicación al día, sola, desde una foto tuya',
            href: '/mix.html',
            pagina: 'mix',
            blotato: true,
          },
          {
            // PROVISIONAL: la Copiadora de estilos va a ser parte de «Marcas» (dueño, 15-oct-2026). Hasta que Marcas exista,
            // quitarla del menú dejaría sin puerta una pantalla que funciona.
            clave: 'estilos',
            titulo: 'Copiadora de estilos',
            icono: 'estilo',
            texto: 'Recrea el estilo visual de un contenido que te guste',
            href: '/estilos.html',
            pagina: 'estilos',
          },
        ],
      },
    ],
  },
  {
    clave: 'central',
    titulo: 'Central',
    icono: 'central',
    grupos: [
      {
        clave: 'distrito',
        titulo: 'Distrito',
        icono: 'ubicacion',
        pantallas: [
          {
            // 16-oct-2026 (dueño): COI se enciende. Contexto · Objetivo · Instrucciones, gratis (3 al día)
            clave: 'coi',
            titulo: 'COI',
            icono: 'coi',
            texto: 'Diseña un prompt: Contexto, Objetivo e Instrucciones',
            // sin `pagina`: COI no se pinta con <Marco> (lleva su propio marco, con «Irremplazables» arriba); sus migas las arma ella con `buscar`
            href: '/estudio/coi/',
          },
          {
            // Ajustes 3 (16-oct-2026): encendida. Sin `pagina` a propósito: su encabezado («Irremplazables» + migas de tres niveles)
            // no es el `<Marco>` de las hojas, y esa clave exige un <Marco pantalla="…"> (Marco.test.tsx)
            clave: 'biblioteca',
            titulo: 'Biblioteca de prompts',
            icono: 'biblioteca',
            texto: 'Prompts listos para copiar, usar y fijar',
            href: '/estudio/biblioteca/',
          },
          { clave: 'preguntas', titulo: 'Preguntas sobre la clase', icono: 'pregunta', proximamente: true },
          { clave: 'glosario', titulo: 'Glosario IA', icono: 'glosario', proximamente: true },
        ],
      },
      { clave: 'deepseek', titulo: 'Deepseek', icono: 'buscar', pantallas: [] },
    ],
  },
  { clave: 'producto', titulo: 'Producto', icono: 'producto', grupos: [], proximamente: true },
  { clave: 'ventas', titulo: 'Ventas', icono: 'ventas', grupos: [], proximamente: true },
  {
    clave: 'automatizaciones',
    titulo: 'Automatizaciones',
    icono: 'rapido',
    grupos: [
      {
        clave: 'distrito',
        titulo: 'Distrito',
        icono: 'ubicacion',
        pantallas: [
          {
            clave: 'constructor',
            titulo: 'Constructor',
            icono: 'flujo',
            texto: 'Arma tu flujo cuadro por cuadro y descárgalo para n8n.',
            href: '/estudio/constructor/',
          },
          {
            clave: 'asistente',
            titulo: 'Asistente',
            icono: 'magia',
            texto: 'Cuéntanos qué quieres automatizar y te armamos el flujo.',
            href: '/estudio/asistente/',
          },
          { clave: 'actualizar', titulo: 'Actualizar flujos', icono: 'automatico', proximamente: true },
        ],
      },
      { clave: 'tus', titulo: 'Tus automatizaciones', icono: 'biblioteca', pantallas: [] },
    ],
  },
];

/** Donde se cae al abrir el inicio: la caja, en Video (la pestaña en la que arranca desde siempre: es lo que ya se usaba). */
export const LUGAR_INICIAL: Lugar = { area: 'mkt', grupo: 'distrito', pantalla: 'video' };

// Las direcciones del recorrido (una página por nivel; la lista completa y su inversa viven en rutas.ts). Lo mínimo va AQUÍ y no allá
// para que `urlDeInicio` pueda apuntar a ellas sin que menu.ts y rutas.ts se importen entre sí.

/** Todas las páginas del recorrido cuelgan de este prefijo: minúsculas, sin acentos y con barra final. */
export const PREFIJO = '/estudio/';

/** La principal: el mapa («Elige un área»). */
export const RUTA_MAPA = '/estudio/';

/** Cómo se llama el área en la dirección: su `ruta` si la trae (Marketing = `mkt` en el menú, «marketing» en la dirección) o, si no, su `clave`. */
export const trozoDeArea = (a: AreaMenu): string => a.ruta ?? a.clave;

/** La página de un área: «/estudio/marketing/». */
export const urlDeArea = (a: AreaMenu): string => `${PREFIJO}${trozoDeArea(a)}/`;

/** Lo que el texto de una tarjeta de grupo dice: sus pantallas, en orden; un grupo que todavía no trae ninguna, «Próximamente». */
export function detalleDeGrupo(g: GrupoMenu): string {
  return g.pantallas.length ? g.pantallas.map(p => p.titulo).join(' · ') : 'Próximamente';
}

export interface Hallazgo {
  area: AreaMenu;
  grupo: GrupoMenu;
  pantalla: PantallaMenu;
}

/** Busca un lugar en el mapa; null si alguna clave no existe (un enlace viejo o escrito a mano). */
export function buscar(l: Lugar): Hallazgo | null {
  const area = MENU.find(a => a.clave === l.area);
  const grupo = area?.grupos.find(g => g.clave === l.grupo);
  const pantalla = grupo?.pantallas.find(p => p.clave === l.pantalla);
  return area && grupo && pantalla ? { area, grupo, pantalla } : null;
}

/** El lugar de una página aparte, por la clave de su `<Marco pantalla="…">`; null si no está en el mapa. */
export function lugarDePagina(pagina: string): (Hallazgo & { lugar: Lugar }) | null {
  for (const area of MENU)
    for (const grupo of area.grupos)
      for (const pantalla of grupo.pantallas)
        if (pantalla.pagina === pagina)
          return { area, grupo, pantalla, lugar: { area: area.clave, grupo: grupo.clave, pantalla: pantalla.clave } };
  return null;
}

/** «mkt.blotato.agenda» ↔ { area, grupo, pantalla }. Las claves no llevan puntos. */
export const lugarATexto = (l: Lugar): string => `${l.area}.${l.grupo}.${l.pantalla}`;

export function lugarDeTexto(t: string | null | undefined): Lugar | null {
  const [area, grupo, pantalla, ...sobra] = (t ?? '').split('.');
  if (!area || !grupo || !pantalla || sobra.length) return null;
  const l = { area, grupo, pantalla };
  return buscar(l) ? l : null;
}

/** Los parámetros con los que una pantalla hoja manda de vuelta al inicio: `desde` (dónde estaba) y `ver` (qué abrir). */
export const PARAM_DESDE = 'desde';
export const PARAM_VER = 'ver';
export type VerInicio = 'mapa' | 'grupos';

/** La URL del inicio que abre el mapa (`ver=mapa`) o las tres opciones del área (`ver=grupos`) estando "desde" una pantalla. */
export function urlDeInicio(desde: Lugar, ver: VerInicio): string {
  return `/estudio/inicio/?${PARAM_DESDE}=${lugarATexto(desde)}&${PARAM_VER}=${ver}`;
}
