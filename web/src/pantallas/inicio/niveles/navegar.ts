// Lo que cada página del recorrido sabe de su nivel: sus migas y qué hace Esc. Todo puro, para probarlo sin React ni DOM. El nivel lo da la
// dirección (una página por nivel: marca/rutas.ts) y subir de nivel es ir a otra dirección.
//
// Las entradas de ANTES al inicio (`?prompt=`, `?brief=`, `?blotato=conectar`) NO se atienden aquí: las manda a su página el servidor,
// con un 302 (server/web.py, tabla ENTRADAS_VIEJAS). `?desde=&ver=` no se reenvía: el mapa se sirve tal cual y nivel.tsx lo quita de la
// dirección. Aquí no hay salto de JavaScript que las reinterprete.
//
// `estadoDeNivel` y `urlDeAccion` son el puente con el recorrido en página de antes (estadoRecorrido.ts): solo los usa Inicio.tsx, que la
// caja todavía monta, y se van con él (E8.7).
import type { Miga } from '../../../marca/Migas';
import { areaDe, grupoDe } from '../../../marca/menu';
import { RUTA_MAPA, urlDeArea, urlDeGrupo, type Nivel } from '../../../marca/rutas';
import { REPOSO, type Accion, type EstadoRecorrido } from '../estadoRecorrido';

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
      const area = areaDe(a.area);
      const grupo = grupoDe(a.area, a.grupo);
      return area && grupo ? urlDeGrupo(area, grupo) : null;
    }
  }
}

/** El área y el grupo donde está un nivel (la herramienta es de su grupo); undefined lo que el mapa no conoce o el nivel no tiene. */
function lugarDe(n: Nivel) {
  if (n.tipo === 'mapa') return { area: undefined, grupo: undefined };
  const claves = n.tipo === 'herramienta' ? n.lugar : n;
  const area = areaDe(claves.area);
  const grupo = 'grupo' in claves ? grupoDe(claves.area, claves.grupo) : undefined;
  return { area, grupo };
}

/**
 * Las migas de una página (D6: las de siempre, ahora como enlaces): en el mapa no hay (se está eligiendo el primer nivel); en un área, la
 * suya, que vuelve al mapa y es donde estás; en un grupo y en la caja, el área (al mapa) y el grupo (a las opciones del área), que es la
 * actual. Cada una lleva en su nombre a dónde lleva y dónde estás, con el texto visible dentro (WCAG 2.5.3). Un nivel que el mapa no
 * conoce no tiene migas: nunca revienta.
 */
export function migasDeNivel(n: Nivel): Miga[] {
  const { area, grupo } = lugarDe(n);
  if (!area) return [];
  const delArea: Miga = {
    clave: 'area',
    titulo: area.titulo,
    icono: area.icono,
    rotulo: `Volver al mapa para cambiar de área (ahora: ${area.titulo})`,
    actual: n.tipo === 'area',
    href: RUTA_MAPA,
  };
  if (n.tipo === 'area') return [delArea];
  if (!grupo) return [];
  return [
    delArea,
    {
      clave: 'grupo',
      titulo: grupo.titulo,
      icono: grupo.icono,
      rotulo: `Volver a las opciones de ${area.titulo} (ahora: ${grupo.titulo})`,
      actual: true,
      href: urlDeArea(area),
    },
  ];
}

/** A dónde lleva Esc (D12): en las opciones de un área sube al mapa (también en un área «Próximamente»); en el mapa, en un grupo y en la
 *  caja no hace nada. null = nada. */
export const escapeDeNivel = (n: Nivel): string | null => (n.tipo === 'area' && areaDe(n.area) ? RUTA_MAPA : null);
