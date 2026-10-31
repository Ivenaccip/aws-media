// Del recorrido en página al recorrido por direcciones: el MISMO estado y las MISMAS acciones de estadoRecorrido.ts, pero el paso lo
// da la dirección (una página por nivel) y cada acción es ir a otra dirección. Todo puro, para probarlo sin React ni DOM.
//
// Las entradas de ANTES al inicio (`?prompt=`, `?brief=`, `?blotato=conectar`, `?desde=&ver=`) NO se atienden aquí: las manda a su
// página el servidor, con un 302 (server/web.py, tabla ENTRADAS_VIEJAS). Aquí no hay salto de JavaScript que las reinterprete.
import { MENU } from '../../../marca/menu';
import { RUTA_MAPA, urlDeArea, urlDeGrupo, type Nivel } from '../../../marca/rutas';
import { REPOSO, areaDe, grupoDe, type Accion, type EstadoRecorrido } from '../estadoRecorrido';

/** El estado del recorrido que corresponde a una página: lo que `migasDe`, `alEscape` y `Recorrido` ya saben leer. Nada está «elegido»
 *  (no hay «Estás aquí»: la dirección ya dice dónde estás). */
export function estadoDeNivel(n: Nivel): EstadoRecorrido {
  switch (n.tipo) {
    case 'mapa':
      return REPOSO;
    case 'area':
      return { paso: 'grupos', explora: n.area, area: n.area, grupo: areaDe(n.area)?.grupos[0]?.clave ?? '', elegido: false, hoja: null };
    case 'grupo':
      return { paso: 'contenido', explora: n.area, area: n.area, grupo: n.grupo, elegido: false, hoja: null };
    case 'herramienta':
      return { paso: 'contenido', explora: n.lugar.area, area: n.lugar.area, grupo: n.lugar.grupo, elegido: false, hoja: null };
  }
}

/** A dónde lleva una acción del recorrido estando en `e`; null si no lleva a ningún lado (un área apagada, una pareja que no existe).
 *  Las migas conservan lo de siempre: la del área vuelve al mapa y la del grupo, a las opciones del área. */
export function urlDeAccion(a: Accion, e: Pick<EstadoRecorrido, 'area'>): string | null {
  switch (a.tipo) {
    case 'abrir-mapa':
      return RUTA_MAPA;
    case 'abrir-grupos': {
      const area = areaDe(e.area);
      return area ? urlDeArea(area) : null;
    }
    case 'elegir-area': {
      const area = areaDe(a.area);
      return area && !area.proximamente && area.grupos.length ? urlDeArea(area) : null;
    }
    case 'elegir-grupo': {
      const area = MENU.find(x => x.clave === a.area);
      const grupo = grupoDe(a.area, a.grupo);
      return area && grupo ? urlDeGrupo(area, grupo) : null;
    }
  }
}
