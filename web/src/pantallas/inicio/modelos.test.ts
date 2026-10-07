// El catálogo de modelos y tools/tarifas.json §modelos no se pueden desfasar:
// lo que el menú enseña es lo que la tarifa dice, y un modelo sin precio no sale.
import { describe, expect, it } from 'vitest';

import { clip, modelos, video } from '../../nucleo/tarifas';
import { destinoDe, OPCIONES } from './logica';
import { CATALOGO, grupos, llavePrecio, PREDETERMINADO, precioDe, type Modelo, type Tarea } from './modelos';

const TAREAS: Tarea[] = ['imagen', 'editar', 'clip'];
type Precios = Record<Tarea, Record<string, number>>;

/** Un precio para CADA modelo y calidad del catálogo: para ver que todos tienen dónde caer. */
function preciosDeTodos(): Precios {
  const p = { imagen: {}, editar: {}, clip: {} } as Precios;
  for (const t of TAREAS)
    for (const m of CATALOGO[t]) {
      if (m.calidades) for (const c of m.calidades) p[t][llavePrecio(m.id, c.id)] = 5;
      else p[t][m.id] = 5;
    }
  return p;
}

const encendidos = (c: Record<Tarea, Modelo[]>) =>
  Object.fromEntries(TAREAS.map(t => [t, c[t].map(m => ({ ...m, activo: true }))])) as Record<Tarea, Modelo[]>;

describe('modelos.ts y tarifas.json', () => {
  it('inicio.modelos.cada_modelo_activo_tiene_precio_y_cada_precio_su_modelo', () => {
    for (const t of TAREAS) {
      const activos = CATALOGO[t].filter(m => m.activo);
      expect(activos.length, `ninguna oferta en ${t}`).toBeGreaterThan(0);
      for (const m of activos) {
        const llaves = m.calidades ? m.calidades.map(c => llavePrecio(m.id, c.id)) : [m.id];
        for (const k of llaves) expect(modelos[t as keyof typeof modelos], `${t}:${k}`).toHaveProperty(k);
      }
      // y al revés: un número en tarifas.json sin modelo activo es un precio huérfano
      const llaves = activos.flatMap(m => (m.calidades ? m.calidades.map(c => llavePrecio(m.id, c.id)) : [m.id]));
      for (const k of Object.keys(modelos[t as keyof typeof modelos])) expect(llaves, `${t}:${k}`).toContain(k);
    }
  });

  it('inicio.modelos.el_predeterminado_esta_activo_y_es_el_que_ya_valia', () => {
    for (const t of TAREAS) {
      const m = CATALOGO[t].find(x => x.id === PREDETERMINADO[t])!;
      expect(m?.activo, t).toBe(true);
      expect(precioDe(t, m.id), t).not.toBeNull();
    }
    // el precio de las pantallas que cobran y el del menú son el mismo número
    expect(modelos.clip['veo-lite']).toBe(clip.video_8s);
    expect(modelos.imagen.grok).toBe(video.imagen);
    expect(modelos.editar.grok).toBe(video.imagen);
  });

  it('inicio.modelos.sin_precio_confirmado_no_se_ofrece_aunque_este_activo', () => {
    const todos = encendidos(CATALOGO);
    // sin tarifa para nadie: no sale nada
    expect(grupos('imagen', todos, { imagen: {}, editar: {}, clip: {} })).toEqual([]);
    // con precio solo para Grok: sale Grok y ningún otro
    const g = grupos('imagen', todos, { imagen: { grok: 2 }, editar: {}, clip: {} });
    expect(g.flatMap(x => x.modelos.map(m => m.id))).toEqual(['grok']);
    // un modelo con resolución a medias (solo 2K) no se ofrece: 4K se cobraría sin número
    const media = grupos('imagen', todos, { imagen: { grok: 2, 'nbp-2k': 14 }, editar: {}, clip: {} });
    expect(media.flatMap(x => x.modelos.map(m => m.id))).toEqual(['grok']);
  });

  it('inicio.modelos.un_modelo_apagado_no_se_ofrece_aunque_tenga_precio', () => {
    const g = grupos('imagen', CATALOGO, preciosDeTodos());
    expect(g.flatMap(x => x.modelos.map(m => m.id))).toEqual(['grok']);
  });

  it('inicio.modelos.por_nivel_y_de_menor_a_mayor_precio', () => {
    const precios = preciosDeTodos();
    precios.imagen.grok = 2;
    precios.imagen.klein = 2;
    precios.imagen.flux2 = 3;
    precios.imagen.nb2 = 8;
    precios.imagen['nbp-2k'] = 14;
    precios.imagen['nbp-4k'] = 27;
    const g = grupos('imagen', encendidos(CATALOGO), precios);
    expect(g.map(x => x.titulo)).toEqual(['Económicos', 'Equilibrados', 'Máxima calidad']);
    for (const x of g) {
      const mins = x.modelos.map(m => Math.min(...(m.calidades ? m.calidades.map(c => precios.imagen[llavePrecio(m.id, c.id)]!) : [precios.imagen[m.id]!])));
      expect(mins).toEqual([...mins].sort((a, b) => a - b));
    }
    expect(g[2]!.rango).toBe('14–27');
  });

  it('inicio.modelos.todo_modelo_del_catalogo_cae_en_un_nivel_de_su_tarea', () => {
    // si un modelo trae un nivel que su tarea no enseña, desaparecería sin avisar
    for (const t of TAREAS) {
      const g = grupos(t, encendidos(CATALOGO), preciosDeTodos());
      expect(g.flatMap(x => x.modelos).length, t).toBe(CATALOGO[t].length);
    }
  });

  it('inicio.modelos.editar_solo_los_que_tienen_endpoint_edit', () => {
    expect(CATALOGO.editar.map(m => m.id)).toEqual(['grok', 'gpt2', 'nb2', 'nbp']);
  });

  it('inicio.modelos.el_modelo_viaja_en_la_url_solo_si_no_es_el_predeterminado', () => {
    const clipOpc = OPCIONES.videos[0]!;
    expect(destinoDe(clipOpc, 'hola')).toBe('/clip.html?brief=hola');
    expect(destinoDe(clipOpc, 'hola', 'veo-lite')).toBe('/clip.html?brief=hola');
    expect(destinoDe(clipOpc, 'hola', 'kling')).toBe('/clip.html?brief=hola&modelo=kling');
    const img = OPCIONES.imagenes[0]!;
    expect(destinoDe(img, 'gato', 'nbp-4k')).toBe('/imagenes.html?prompt=gato&modelo=nbp-4k');
    // las tareas sin modelo nunca lo llevan
    const cuento = OPCIONES.videos[1]!;
    expect(destinoDe(cuento, 'tema', 'kling')).toBe('/crear.html?brief=tema&modo=investigacion');
  });
});
