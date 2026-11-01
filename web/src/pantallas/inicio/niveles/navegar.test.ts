// Lo que cada página sabe de su nivel (navegar.ts): sus migas y qué hace Esc, y el puente con el recorrido en página de antes. Sin el
// prefijo `inicio.`: no son invariantes del registro de migración (docs/migracion/inicio.md); son pruebas de las direcciones de cada nivel.
import { describe, expect, it } from 'vitest';

import { MENU } from '../../../marca/menu';
import { nivelDeRuta, type Nivel } from '../../../marca/rutas';
import { alEscape, migasDe } from '../estadoRecorrido';
import { escapeDeNivel, estadoDeNivel, migasDeNivel, urlDeAccion } from './navegar';

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

  it('niveles.migas.son_las_mismas_que_daba_el_recorrido_en_pagina: titulo, icono, rotulo y actual, en cada area y cada grupo', () => {
    // (las de antes eran botones: sin `href`; toEqual no cuenta una propiedad que vale undefined)
    const sinHref = (n: Nivel) => migasDeNivel(n).map(m => ({ ...m, href: undefined }));
    for (const area of MENU) {
      const n: Nivel = { tipo: 'area', area: area.clave };
      expect(sinHref(n), area.clave).toEqual(migasDe(estadoDeNivel(n)));
      for (const grupo of area.grupos) {
        const g: Nivel = { tipo: 'grupo', area: area.clave, grupo: grupo.clave };
        expect(sinHref(g), `${area.clave}.${grupo.clave}`).toEqual(migasDe(estadoDeNivel(g)));
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

  it('niveles.esc.dice_lo_mismo_que_el_recorrido_en_pagina: abrir el mapa es ir a la principal', () => {
    for (const n of [{ tipo: 'mapa' }, ...MENU.map(a => ({ tipo: 'area', area: a.clave })), { tipo: 'grupo', area: 'mkt', grupo: 'blotato' }, CAJA] as Nivel[]) {
      const antes = alEscape(estadoDeNivel(n));
      expect(escapeDeNivel(n)).toBe(antes?.tipo === 'accion' ? urlDeAccion(antes.accion, estadoDeNivel(n)) : null);
    }
  });
});

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
