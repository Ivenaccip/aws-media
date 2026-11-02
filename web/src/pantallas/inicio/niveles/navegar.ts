// Lo que cada página del recorrido sabe de su nivel: sus migas y qué hace Esc. Todo puro, para probarlo sin React ni DOM. El nivel lo da la
// dirección (una página por nivel: marca/rutas.ts) y subir de nivel es ir a otra dirección.
//
// Las entradas de ANTES al inicio (`?prompt=`, `?brief=`, `?blotato=conectar`) NO se atienden aquí: las manda a su página el servidor,
// con un 302 (server/web.py, tabla ENTRADAS_VIEJAS). `?desde=&ver=` no se reenvía: el mapa se sirve tal cual y nivel.tsx lo quita de la
// dirección. Aquí no hay salto de JavaScript que las reinterprete.
import type { Miga } from '../../../marca/Migas';
import { areaDe, grupoDe } from '../../../marca/menu';
import { RUTA_MAPA, urlDeArea, type Nivel } from '../../../marca/rutas';

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
