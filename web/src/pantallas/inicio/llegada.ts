// Lo que una página del recorrido lee UNA vez de su dirección y después limpia. Sin React ni DOM, y sin nada de la caja: la entrada de
// las páginas de nivel (niveles/nivel.tsx) lo trae para limpiar el mapa, y no puede arrastrar a la caja con él.
//
// Hay dos entradas:
//   · la de «Llevar a la caja» de la Biblioteca de prompts (Ajustes 3, 16-oct-2026): `?prompt=<texto>` abre la caja en la pestaña Imagen con
//     el texto puesto, y `?brief=<texto>` en la pestaña Video (`leerLlegadaDeTexto`). Llegar así nunca crea ni cobra nada: solo deja la caja
//     lista;
//   · la de las migas viejas de las pantallas hoja, `?desde=<lugar>&ver=<mapa|grupos>` (marca/menu.ts, PARAM_DESDE y PARAM_VER). Ya no la
//     emite nadie (las migas van directo a la página de su nivel), pero un marcador guardado todavía la trae: el mapa no la lee, solo la quita.
// Las dos se quitan de la dirección (`urlSinEntrada`) en cuanto se leyeron: recargar o compartir el enlace no las repite.
import { PARAM_DESDE, PARAM_VER } from '../../marca/menu';

/** Los parámetros de la dirección que se leen UNA vez y se limpian: `desde` y `ver` (de las pantallas hoja de antes) y `prompt` y `brief`
 *  (de la Biblioteca). */
const PARAM_PROMPT = 'prompt';
const PARAM_BRIEF = 'brief';
const ENTRADAS = [PARAM_DESDE, PARAM_VER, PARAM_PROMPT, PARAM_BRIEF] as const;

/** Lo más que cabe en el cuadro de la caja (su `maxLength`): un texto más largo se corta, no se pierde la llegada. */
export const MAX_TEXTO_DE_LLEGADA = 5000;

export interface LlegadaDeTexto {
  /** La pestaña de la caja que se abre: `?prompt=` es una imagen, `?brief=` un video. */
  familia: 'imagenes' | 'videos';
  texto: string;
}

/** El texto con el que se llega a la caja (`?prompt=` o `?brief=`), o null si no hay o viene vacío. Con los dos, gana `prompt`. El texto se
 *  toma tal cual, sin recortarle los espacios de en medio: es un prompt, y su forma importa. Solo es TEXTO: la caja lo pone en su cuadro y
 *  React lo escapa. */
export function leerLlegadaDeTexto(busqueda: string): LlegadaDeTexto | null {
  const params = new URLSearchParams(busqueda);
  for (const [param, familia] of [
    [PARAM_PROMPT, 'imagenes'],
    [PARAM_BRIEF, 'videos'],
  ] as const) {
    const texto = params.get(param);
    if (texto !== null && texto.trim()) return { familia, texto: texto.slice(0, MAX_TEXTO_DE_LLEGADA) };
  }
  return null;
}

/** La dirección SIN `desde`, `ver`, `prompt` ni `brief` (con todo lo demás: `?blotato=conectar`, `utm_*`, el ancla), o null si no traía
 *  ninguno. Se pone con `history.replaceState`: la entrada se lee una vez y recargar o compartir el enlace no la repite. */
export function urlSinEntrada(href: string): string | null {
  const url = new URL(href);
  if (!ENTRADAS.some(p => url.searchParams.has(p))) return null;
  for (const p of ENTRADAS) url.searchParams.delete(p);
  return url.pathname + url.search + url.hash;
}
