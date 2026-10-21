// Del recorrido en página al recorrido por direcciones (navegar.ts). Sin el prefijo `inicio.`: no son invariantes del registro de
// migración (docs/migracion/inicio.md); son pruebas de las direcciones de cada nivel.
import { describe, expect, it } from 'vitest';

import { MENU } from '../../../marca/menu';
import { nivelDeRuta } from '../../../marca/rutas';
import { alEscape, migasDe } from '../estadoRecorrido';
import { estadoDeNivel, urlDeAccion } from './navegar';

describe('niveles · cada página es un estado del recorrido que ya se sabe leer', () => {
  it('niveles.estado.el_mapa_no_tiene_migas_el_area_una_y_el_grupo_dos: y Esc solo sube desde las opciones del área', () => {
    expect(migasDe(estadoDeNivel({ tipo: 'mapa' }))).toEqual([]);
    expect(migasDe(estadoDeNivel({ tipo: 'area', area: 'mkt' })).map(m => m.titulo)).toEqual(['Marketing']);
    expect(migasDe(estadoDeNivel({ tipo: 'grupo', area: 'central', grupo: 'distrito' })).map(m => m.titulo)).toEqual(['Central', 'Distrito']);
    expect(alEscape(estadoDeNivel({ tipo: 'mapa' }))).toBeNull();
    expect(alEscape(estadoDeNivel({ tipo: 'area', area: 'mkt' }))).toEqual({ tipo: 'accion', accion: { tipo: 'abrir-mapa' } });
    expect(alEscape(estadoDeNivel({ tipo: 'grupo', area: 'mkt', grupo: 'blotato' }))).toBeNull();
  });

  it('niveles.estado.una_herramienta_de_la_caja_es_el_contenido_de_su_grupo: mismas migas que el grupo, sin Esc', () => {
    const e = estadoDeNivel({ tipo: 'herramienta', lugar: { area: 'mkt', grupo: 'distrito', pantalla: 'video' } });
    expect(e).toMatchObject({ paso: 'contenido', area: 'mkt', grupo: 'distrito', elegido: false, hoja: null });
    expect(migasDe(e).map(m => m.titulo)).toEqual(['Marketing', 'Distrito']);
    expect(alEscape(e)).toBeNull();
  });

  it('niveles.estado.nada_esta_elegido_ni_hay_hoja: la dirección ya dice dónde estás, no hay «Estás aquí» ni «Volver a …»', () => {
    for (const nivel of [
      { tipo: 'mapa' },
      { tipo: 'area', area: 'central' },
      { tipo: 'grupo', area: 'mkt', grupo: 'avanzado' },
    ] as const) {
      expect(estadoDeNivel(nivel)).toMatchObject({ elegido: false, hoja: null });
    }
  });

  it('niveles.estado.un_area_proximamente_o_sin_grupos_no_revienta: producto y ventas', () => {
    for (const a of MENU.filter(x => x.proximamente)) {
      expect(() => migasDe(estadoDeNivel({ tipo: 'area', area: a.clave }))).not.toThrow();
      expect(alEscape(estadoDeNivel({ tipo: 'area', area: a.clave }))).toEqual({ tipo: 'accion', accion: { tipo: 'abrir-mapa' } });
    }
  });
});

describe('niveles · a dónde lleva cada acción', () => {
  const desde = { area: 'mkt' };

  it('niveles.accion.las_migas_conservan_lo_de_siempre: la del area abre el mapa y la del grupo, las opciones del area', () => {
    expect(urlDeAccion({ tipo: 'abrir-mapa' }, desde)).toBe('/estudio/');
    expect(urlDeAccion({ tipo: 'abrir-grupos' }, desde)).toBe('/estudio/marketing/');
    expect(urlDeAccion({ tipo: 'abrir-grupos' }, { area: 'central' })).toBe('/estudio/central/');
    expect(urlDeAccion({ tipo: 'abrir-grupos' }, { area: 'nada' })).toBeNull();
  });

  it('niveles.accion.elegir_lleva_a_la_pagina_del_nivel: un area apagada o una pareja que no existe, a ningun lado', () => {
    expect(urlDeAccion({ tipo: 'elegir-area', area: 'automatizaciones' }, desde)).toBe('/estudio/automatizaciones/');
    expect(urlDeAccion({ tipo: 'elegir-grupo', area: 'mkt', grupo: 'blotato' }, desde)).toBe('/estudio/marketing/blotato/');
    expect(urlDeAccion({ tipo: 'elegir-area', area: 'ventas' }, desde)).toBeNull();
    expect(urlDeAccion({ tipo: 'elegir-grupo', area: 'mkt', grupo: 'deepseek' }, desde)).toBeNull();
  });

  it('niveles.accion.una_clave_que_es_de_Object_prototype_no_es_un_nivel: constructor, __proto__ y toString', () => {
    for (const clave of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(urlDeAccion({ tipo: 'elegir-area', area: clave }, desde)).toBeNull();
      expect(urlDeAccion({ tipo: 'elegir-grupo', area: clave, grupo: clave }, desde)).toBeNull();
      expect(urlDeAccion({ tipo: 'elegir-grupo', area: 'mkt', grupo: clave }, desde)).toBeNull();
      expect(urlDeAccion({ tipo: 'abrir-grupos' }, { area: clave })).toBeNull();
    }
  });

  it('niveles.accion.cada_direccion_que_sale_de_una_accion_la_entiende_nivelDeRuta: ida y vuelta con rutas.ts', () => {
    for (const area of MENU) {
      const aArea = urlDeAccion({ tipo: 'elegir-area', area: area.clave }, desde);
      if (aArea) expect(nivelDeRuta(aArea)).toEqual({ tipo: 'area', area: area.clave });
      for (const grupo of area.grupos) {
        const aGrupo = urlDeAccion({ tipo: 'elegir-grupo', area: area.clave, grupo: grupo.clave }, desde);
        expect(aGrupo).not.toBeNull();
        expect(nivelDeRuta(aGrupo!)).toEqual({ tipo: 'grupo', area: area.clave, grupo: grupo.clave });
      }
    }
    expect(nivelDeRuta(urlDeAccion({ tipo: 'abrir-mapa' }, desde)!)).toEqual({ tipo: 'mapa' });
  });
});
