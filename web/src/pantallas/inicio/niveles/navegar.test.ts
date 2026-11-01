// Lo que cada página sabe de su nivel (navegar.ts): sus migas y qué hace Esc. Sin el prefijo `inicio.`: no son invariantes del registro
// de migración (docs/migracion/inicio.md); son pruebas de las direcciones de cada nivel. Hasta E8 lo daba el estado del recorrido en
// página (estadoRecorrido.ts, retirado): estas pruebas absorbieron lo que aquel probaba de las migas y de Esc.
import { describe, expect, it } from 'vitest';

import { MENU } from '../../../marca/menu';
import { nivelDeRuta, type Nivel } from '../../../marca/rutas';
import { escapeDeNivel, migasDeNivel } from './navegar';

const CAJA: Nivel = { tipo: 'herramienta', lugar: { area: 'mkt', grupo: 'distrito', pantalla: 'video' } };

describe('niveles · las migas de cada página (migasDeNivel)', () => {
  it('niveles.migas.el_mapa_no_tiene_migas: se está eligiendo el primer nivel', () => {
    expect(migasDeNivel({ tipo: 'mapa' })).toEqual([]);
  });

  it('niveles.migas.en_un_area_la_suya_vuelve_al_mapa_y_es_donde_estas', () => {
    expect(migasDeNivel({ tipo: 'area', area: 'central' })).toEqual([
      { clave: 'area', titulo: 'Central', icono: 'central', rotulo: 'Volver al mapa para cambiar de área (ahora: Central)', actual: true, href: '/estudio/' },
    ]);
  });

  it('niveles.migas.en_un_grupo_el_area_vuelve_al_mapa_y_el_grupo_a_las_opciones_del_area: la del grupo es la actual (D6)', () => {
    expect(migasDeNivel({ tipo: 'grupo', area: 'mkt', grupo: 'blotato' })).toEqual([
      { clave: 'area', titulo: 'Marketing', icono: 'marketing', rotulo: 'Volver al mapa para cambiar de área (ahora: Marketing)', actual: false, href: '/estudio/' },
      { clave: 'grupo', titulo: 'Blotato', icono: 'publicar', rotulo: 'Volver a las opciones de Marketing (ahora: Blotato)', actual: true, href: '/estudio/marketing/' },
    ]);
  });

  it('niveles.migas.la_caja_lleva_las_de_su_grupo: Marketing › Distrito', () => {
    expect(migasDeNivel(CAJA)).toEqual(migasDeNivel({ tipo: 'grupo', area: 'mkt', grupo: 'distrito' }));
    expect(migasDeNivel(CAJA).map(m => m.titulo)).toEqual(['Marketing', 'Distrito']);
  });

  it('niveles.migas.en_cada_area_y_cada_grupo_del_mapa: su titulo, su icono, el rotulo de siempre y la ultima es donde estas', () => {
    for (const area of MENU) {
      const delArea = (actual: boolean) => ({
        clave: 'area',
        titulo: area.titulo,
        icono: area.icono,
        rotulo: `Volver al mapa para cambiar de área (ahora: ${area.titulo})`,
        actual,
        href: '/estudio/',
      });
      expect(migasDeNivel({ tipo: 'area', area: area.clave }), area.clave).toEqual([delArea(true)]);
      for (const grupo of area.grupos) {
        expect(migasDeNivel({ tipo: 'grupo', area: area.clave, grupo: grupo.clave }), `${area.clave}.${grupo.clave}`).toEqual([
          delArea(false),
          {
            clave: 'grupo',
            titulo: grupo.titulo,
            icono: grupo.icono,
            rotulo: `Volver a las opciones de ${area.titulo} (ahora: ${grupo.titulo})`,
            actual: true,
            href: `/estudio/${area.ruta ?? area.clave}/`,
          },
        ]);
      }
    }
  });

  it('niveles.migas.el_texto_visible_de_cada_miga_esta_dentro_de_su_nombre_accesible: WCAG 2.5.3', () => {
    for (const area of MENU) {
      for (const n of [{ tipo: 'area', area: area.clave }, ...area.grupos.map(g => ({ tipo: 'grupo', area: area.clave, grupo: g.clave }))] as Nivel[])
        for (const m of migasDeNivel(n)) expect(m.rotulo, m.titulo).toContain(m.titulo);
    }
  });

  it('niveles.migas.cada_href_es_una_pagina_de_nivel_que_rutas_entiende: el mapa o las opciones del area', () => {
    for (const area of MENU)
      for (const grupo of area.grupos) {
        const [delArea, delGrupo] = migasDeNivel({ tipo: 'grupo', area: area.clave, grupo: grupo.clave });
        expect(nivelDeRuta(delArea!.href!)).toEqual({ tipo: 'mapa' });
        expect(nivelDeRuta(delGrupo!.href!)).toEqual({ tipo: 'area', area: area.clave });
      }
  });

  it('niveles.migas.un_area_proximamente_no_revienta: producto y ventas tienen la suya', () => {
    for (const a of MENU.filter(x => x.proximamente)) {
      expect(migasDeNivel({ tipo: 'area', area: a.clave }).map(m => m.titulo)).toEqual([a.titulo]);
    }
  });

  it('niveles.migas.un_nivel_que_el_mapa_no_conoce_no_tiene_migas: tampoco las claves de Object_prototype', () => {
    for (const clave of ['nada', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(migasDeNivel({ tipo: 'area', area: clave }), clave).toEqual([]);
      expect(migasDeNivel({ tipo: 'grupo', area: clave, grupo: clave }), clave).toEqual([]);
      expect(migasDeNivel({ tipo: 'grupo', area: 'mkt', grupo: clave }), clave).toEqual([]);
      expect(migasDeNivel({ tipo: 'herramienta', lugar: { area: 'mkt', grupo: clave, pantalla: clave } }), clave).toEqual([]);
    }
  });
});

describe('niveles · qué hace Esc en cada página (escapeDeNivel, D12)', () => {
  it('niveles.esc.en_las_opciones_de_un_area_sube_al_mapa: tambien en una Proximamente', () => {
    for (const a of MENU) expect(escapeDeNivel({ tipo: 'area', area: a.clave }), a.clave).toBe('/estudio/');
  });

  it('niveles.esc.en_el_mapa_en_un_grupo_y_en_la_caja_no_hace_nada', () => {
    expect(escapeDeNivel({ tipo: 'mapa' })).toBeNull();
    for (const a of MENU) for (const g of a.grupos) expect(escapeDeNivel({ tipo: 'grupo', area: a.clave, grupo: g.clave })).toBeNull();
    expect(escapeDeNivel(CAJA)).toBeNull();
  });

  it('niveles.esc.un_area_que_el_mapa_no_conoce_no_lleva_a_ningun_lado: constructor, __proto__ y toString', () => {
    for (const clave of ['nada', 'constructor', '__proto__', 'toString']) expect(escapeDeNivel({ tipo: 'area', area: clave }), clave).toBeNull();
  });
});
