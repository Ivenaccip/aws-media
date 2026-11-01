// El registro del mapa (menu.ts): lo que sus datos dicen tiene que ser lo que el inicio hace. El recorrido y las migas se
// prueban donde viven (pantallas/inicio, Marco); aquí, los datos que nadie más leería para darse cuenta de que mienten.
import { describe, expect, it } from 'vitest';

import { MENU, areaDe, buscar, detalleDeGrupo, grupoDe, lugarATexto, lugarDePagina, urlDeInicio } from './menu';
import { nivelDeRuta } from './rutas';

describe('menu · las pestañas de la caja', () => {
  it('menu.caja.solo_marketing_distrito_trae_las_pestanas_de_la_caja: Imagen, Video y Edición, en ese orden; Blotato, Avanzado y Central son listas', () => {
    const conCaja = MENU.flatMap(a => a.grupos.filter(g => g.pantallas.some(p => p.caja !== undefined)).map(g => `${a.clave}.${g.clave}`));
    expect(conCaja).toEqual(['mkt.distrito']);
    const distrito = grupoDe('mkt', 'distrito')!;
    expect(distrito.pantallas.map(p => [p.clave, p.titulo, p.caja])).toEqual([
      ['imagen', 'Imagen', 'imagenes'],
      ['video', 'Video', 'videos'],
      ['edicion', 'Edición', 'edicion'],
    ]);
    // ninguna pestaña de la caja es una página aparte: su página la arma rutas.ts (…/distrito/video/)
    expect(distrito.pantallas.every(p => p.href === undefined)).toBe(true);
  });
});

describe('menu · el detalle de una tarjeta de grupo', () => {
  const grupo = (area: string, clave: string) => MENU.find(a => a.clave === area)!.grupos.find(g => g.clave === clave)!;

  it('menu.detalle.lista_las_pantallas_en_orden', () => {
    expect(detalleDeGrupo(grupo('mkt', 'distrito'))).toBe('Imagen · Video · Edición');
    expect(detalleDeGrupo(grupo('mkt', 'blotato'))).toBe('Agenda tus publicaciones · Investiga tu competencia · Ver mis métricas');
  });

  it('menu.detalle.un_grupo_sin_pantallas_dice_proximamente: es el dato quien lo dice, no el componente', () => {
    const sinPantallas = MENU.flatMap(a => a.grupos.map(g => ({ lugar: `${a.clave}.${g.clave}`, g }))).filter(({ g }) => !g.pantallas.length);
    expect(sinPantallas.map(({ lugar }) => lugar)).toEqual(['central.deepseek', 'automatizaciones.tus']);
    for (const { g } of sinPantallas) expect(detalleDeGrupo(g)).toBe('Próximamente');
  });
});

describe('menu · un área y un grupo por su clave', () => {
  it('menu.por_clave.areaDe_y_grupoDe_dan_lo_del_mapa: el grupo es el de ESA área (Distrito hay en tres)', () => {
    expect(areaDe('mkt')).toBe(MENU[0]);
    expect(grupoDe('central', 'distrito')).toBe(MENU.find(a => a.clave === 'central')!.grupos[0]);
    expect(grupoDe('central', 'distrito')).not.toBe(grupoDe('mkt', 'distrito'));
    expect(grupoDe('automatizaciones', 'distrito')?.pantallas.map(p => p.clave)).toEqual(['constructor', 'asistente', 'actualizar']);
    // una pareja que no existe: el grupo de OTRA área, o un área que no hay
    expect(grupoDe('central', 'blotato')).toBeUndefined();
    expect(grupoDe('nada', 'distrito')).toBeUndefined();
    expect(areaDe('nada')).toBeUndefined();
    expect(areaDe('')).toBeUndefined();
  });

  it('menu.por_clave.una_clave_de_Object_prototype_no_es_un_area_ni_un_grupo: constructor, __proto__ y toString', () => {
    for (const clave of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(areaDe(clave), clave).toBeUndefined();
      expect(grupoDe(clave, clave), clave).toBeUndefined();
      expect(grupoDe('mkt', clave), clave).toBeUndefined();
      expect(buscar({ area: 'mkt', grupo: 'distrito', pantalla: clave }), clave).toBeNull();
    }
  });
});

// Automatizaciones (dueño, 20-oct-2026): el área se enciende en el mapa con dos grupos —«Distrito» (Constructor, Asistente y «Actualizar
// flujos», apagada) y «Tus automatizaciones» (sin pantallas)—. Lo que dicen sus datos; sus páginas, en pantallas/inicio/niveles.
describe('menu · Automatizaciones', () => {
  const area = MENU.find(a => a.clave === 'automatizaciones')!;

  it('menu.automatizaciones.esta_encendida_con_dos_grupos: Distrito con 3 pantallas (2 con href, 1 apagada) y «Tus automatizaciones» vacío', () => {
    expect(area.proximamente).toBeUndefined();
    expect(area.icono).toBe('rapido');
    expect(area.grupos.map(g => [g.clave, g.titulo, g.pantallas.length])).toEqual([
      ['distrito', 'Distrito', 3],
      ['tus', 'Tus automatizaciones', 0],
    ]);
    const [constructor, asistente, actualizar] = area.grupos[0]!.pantallas;
    expect([constructor?.href, asistente?.href]).toEqual(['/estudio/automatizaciones/distrito/constructor/', '/estudio/automatizaciones/distrito/asistente/']);
    expect(constructor?.texto).toBe('Arma tu flujo cuadro por cuadro y descárgalo para n8n.');
    expect(asistente?.texto).toBe('Cuéntanos qué quieres automatizar y te armamos el flujo.');
    expect(actualizar).toMatchObject({ titulo: 'Actualizar flujos', proximamente: true });
    expect(actualizar?.href).toBeUndefined();
    expect(detalleDeGrupo(area.grupos[0]!)).toBe('Constructor · Asistente · Actualizar flujos');
    expect(detalleDeGrupo(area.grupos[1]!)).toBe('Próximamente');
  });

  it('menu.automatizaciones.sus_hojas_no_llevan_pagina: como COI y la Biblioteca, lugarDePagina no las conoce y buscar sí', () => {
    expect(area.grupos[0]!.pantallas.every(p => p.pagina === undefined)).toBe(true);
    expect(lugarDePagina('constructor')).toBeNull();
    expect(buscar({ area: 'automatizaciones', grupo: 'distrito', pantalla: 'constructor' })?.pantalla.titulo).toBe('Constructor');
    // la clave de un grupo vacío no es un lugar: `buscar` exige una pantalla
    expect(buscar({ area: 'automatizaciones', grupo: 'tus', pantalla: 'x' })).toBeNull();
  });

  it('menu.automatizaciones.su_distrito_no_es_el_de_otra_area: la pareja área+grupo manda', () => {
    expect(grupoDe('automatizaciones', 'distrito')).not.toBe(grupoDe('mkt', 'distrito'));
    expect(grupoDe('automatizaciones', 'blotato')).toBeUndefined();
    expect(grupoDe('mkt', 'tus')).toBeUndefined();
  });

  it('menu.automatizaciones.producto_y_ventas_siguen_apagadas', () => {
    for (const clave of ['producto', 'ventas']) expect(areaDe(clave)?.proximamente, clave).toBe(true);
  });

  it('menu.automatizaciones.las_migas_de_sus_hojas_van_directo_a_su_pagina: el mapa y las opciones de Automatizaciones', () => {
    const l = { area: 'automatizaciones', grupo: 'distrito', pantalla: 'constructor' };
    expect(urlDeInicio(l, 'mapa')).toBe('/estudio/');
    expect(urlDeInicio(l, 'grupos')).toBe('/estudio/automatizaciones/');
  });
});

describe('menu · a dónde llevan las migas de una hoja (urlDeInicio)', () => {
  it('menu.migas.cada_pantalla_lleva_a_la_pagina_de_su_nivel: el mapa, o las opciones de SU área', () => {
    const LUGARES = MENU.flatMap(a => a.grupos.flatMap(g => g.pantallas.map(p => ({ area: a.clave, grupo: g.clave, pantalla: p.clave }))));
    expect(LUGARES.filter(l => l.area === 'automatizaciones')).toHaveLength(3);
    for (const l of LUGARES) {
      expect(nivelDeRuta(urlDeInicio(l, 'mapa')), lugarATexto(l)).toEqual({ tipo: 'mapa' });
      expect(nivelDeRuta(urlDeInicio(l, 'grupos')), lugarATexto(l)).toEqual({ tipo: 'area', area: l.area });
    }
  });
});
