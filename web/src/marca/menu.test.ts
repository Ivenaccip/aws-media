// El registro del mapa (menu.ts): lo que sus datos dicen tiene que ser lo que el inicio hace. El recorrido y las migas se
// prueban donde viven (pantallas/inicio, Marco); aquí, los datos que nadie más leería para darse cuenta de que mienten.
import { describe, expect, it } from 'vitest';

import { LUGAR_INICIAL, MENU, buscar, detalleDeGrupo } from './menu';

describe('menu · el lugar inicial', () => {
  it('menu.lugar_inicial.es_la_pestana_video: la caja arranca en Video (inicio.edicion.el_riel_…_arranca_en_video), no en Imagen', () => {
    const hallazgo = buscar(LUGAR_INICIAL);
    expect(hallazgo?.pantalla.caja).toBe('videos');
    expect(hallazgo?.pantalla.titulo).toBe('Video');
  });
});

describe('menu · el detalle de una tarjeta de grupo', () => {
  const grupo = (area: string, clave: string) => MENU.find(a => a.clave === area)!.grupos.find(g => g.clave === clave)!;

  it('menu.detalle.lista_las_pantallas_en_orden', () => {
    expect(detalleDeGrupo(grupo('mkt', 'distrito'))).toBe('Imagen · Video · Edición');
    expect(detalleDeGrupo(grupo('mkt', 'blotato'))).toBe('Agenda tus publicaciones · Investiga tu competencia · Ver mis métricas');
  });

  it('menu.detalle.un_grupo_sin_pantallas_dice_proximamente: es el dato quien lo dice, no el componente', () => {
    const sinPantallas = MENU.flatMap(a => a.grupos).filter(g => !g.pantallas.length);
    expect(sinPantallas.map(g => g.clave)).toEqual(['deepseek']);
    for (const g of sinPantallas) expect(detalleDeGrupo(g)).toBe('Próximamente');
  });
});
