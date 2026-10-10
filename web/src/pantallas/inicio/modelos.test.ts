// El catálogo de modelos y tools/tarifas.json §modelos no se pueden desfasar:
// lo que el menú enseña es lo que la tarifa dice, y un modelo sin precio no sale.
import { describe, expect, it } from 'vitest';

import { clip, modelos, video } from '../../nucleo/tarifas';
import { destinoDe, OPCIONES } from './logica';
import {
  admite,
  cambioPorDuracion,
  CATALOGO,
  DURACION_PREDETERMINADA,
  DURACIONES,
  duracionesDe,
  duracionesOfrecidas,
  duracionVigente,
  grupos,
  llavePrecio,
  modeloPara,
  ofrecidosDe,
  PREDETERMINADO,
  precioDe,
  precioMinimo,
  type Modelo,
  type Tarea,
  type TablaPrecios,
} from './modelos';

const TAREAS: Tarea[] = ['imagen', 'editar', 'clip'];
type Precios = TablaPrecios;

/** Un precio para CADA modelo y calidad del catálogo: para ver que todos tienen dónde caer. El clip, uno por duración. */
function preciosDeTodos(): Precios {
  const p = { imagen: {}, editar: {}, clip: {} } as Precios;
  for (const t of TAREAS)
    for (const m of CATALOGO[t]) {
      const precio = t === 'clip' ? { '4': 4, '6': 6, '8': 8 } : 5;
      if (m.calidades) for (const c of m.calidades) p[t][llavePrecio(m.id, c.id)] = precio;
      else p[t][m.id] = precio;
    }
  return p;
}

/** Precios de PRUEBA del clip (no son los de tarifas.json): LTX sin 4 s y Kling solo en 8 s. */
const CLIP_PRUEBA: Precios = {
  imagen: {},
  editar: {},
  clip: {
    h3t: { '4': 2, '6': 4, '8': 6 },
    'veo-lite': { '4': 4, '6': 6, '8': 8 },
    ltx: { '6': 10, '8': 12 },
    'veo-fast': { '4': 20, '6': 30, '8': 40 },
    kling: { '8': 50 },
  },
};

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
    // el precio de las pantallas que cobran y el del menú son el mismo número: el del clip de 8 s
    expect(modelos.clip['veo-lite']['8']).toBe(clip.video_8s);
    expect(precioDe('clip', 'veo-lite', undefined, undefined, DURACION_PREDETERMINADA)).toBe(clip.video_8s);
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
    const ofrecidos = g.flatMap(x => x.modelos.map(m => m.id));
    const apagados = CATALOGO.imagen.filter(m => !m.activo).map(m => m.id);
    expect(apagados.length).toBeGreaterThan(0); // si no hubiera ninguno, la prueba no probaría nada
    expect(ofrecidos.filter(id => apagados.includes(id))).toEqual([]);
    expect([...ofrecidos].sort()).toEqual(CATALOGO.imagen.filter(m => m.activo).map(m => m.id).sort());
  });

  it('inicio.modelos.lo_que_esta_a_la_venta_hoy', () => {
    // el estado del 9-oct-2026: Nano Banana 2 y Veo 3.1 Fast se encendieron tras la prueba pagada;
    // Veo 3.1 Standard sigue apagado. Si esto cambia, que sea a propósito (y con su número en tarifas.json).
    const activos = (t: Tarea) => CATALOGO[t].filter(m => m.activo).map(m => m.id);
    expect(activos('imagen')).toEqual(['grok', 'nb2']);
    expect(activos('editar')).toEqual(['grok', 'nb2']);
    expect(activos('clip')).toEqual(['veo-lite', 'veo-fast']);
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
    // en imagen cada llave es un entero (el objeto por duración es del clip)
    const creditos = (llave: string) => precios.imagen[llave] as number;
    for (const x of g) {
      const mins = x.modelos.map(m => Math.min(...(m.calidades ? m.calidades.map(c => creditos(llavePrecio(m.id, c.id))) : [creditos(m.id)])));
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

  it('inicio.modelos.el_clip_trae_un_precio_por_duracion_en_enteros', () => {
    for (const [id, porDuracion] of Object.entries(modelos.clip)) {
      // el clip es un objeto por duración: las llaves son segundos que el producto sabe pedir
      expect(typeof porDuracion, id).toBe('object');
      const segundos = Object.keys(porDuracion).map(Number);
      expect(segundos.length, id).toBeGreaterThan(0);
      for (const s of segundos) expect(DURACIONES, `${id}: ${s} s`).toContain(s);
      // enteros positivos, y más corto cuesta menos o igual: lo que promete «Más corto, más barato»
      const valores = segundos.sort((a, b) => a - b).map(s => (porDuracion as Record<string, number>)[String(s)]!);
      for (const n of valores) expect(Number.isInteger(n) && n > 0, `${id}: ${n}`).toBe(true);
      expect(valores, id).toEqual([...valores].sort((a, b) => a - b));
    }
    // el predeterminado tiene la duración de siempre, y todo lo ofrecido trae al menos un número
    expect(precioDe('clip', PREDETERMINADO.clip, undefined, undefined, DURACION_PREDETERMINADA)).not.toBeNull();
    expect(ofrecidosDe('clip').length).toBeGreaterThan(0);
    // imagen y editar siguen con un entero por modelo
    for (const t of ['imagen', 'editar'] as const)
      for (const n of Object.values(modelos[t])) expect(Number.isInteger(n), t).toBe(true);
  });

  it('inicio.modelos.una_duracion_sin_numero_no_se_ofrece_ni_cuesta_cero', () => {
    const todos = encendidos(CATALOGO);
    // LTX no tiene 4 s: ni cero, ni el precio de otra duración
    expect(precioDe('clip', 'ltx', undefined, CLIP_PRUEBA, 4)).toBeNull();
    expect(precioDe('clip', 'ltx', undefined, CLIP_PRUEBA, 6)).toBe(10);
    expect(precioDe('clip', 'ltx', undefined, CLIP_PRUEBA, 8)).toBe(12);
    const ltx = todos.clip.find(m => m.id === 'ltx')!;
    expect(admite('clip', ltx, 4, CLIP_PRUEBA)).toBe(false);
    expect(duracionesDe('clip', ltx, CLIP_PRUEBA)).toEqual([6, 8]);
    // lo que no es un entero positivo no es un precio
    const rota: Precios = { imagen: {}, editar: {}, clip: { 'veo-lite': { '4': 0, '6': 4.5, '8': -8 } } };
    for (const s of DURACIONES) expect(precioDe('clip', 'veo-lite', undefined, rota, s)).toBeNull();
    // una duración que el producto no conoce no se ofrece, aunque la tabla la traiga
    const rara: Precios = { imagen: {}, editar: {}, clip: { 'veo-lite': { '5': 7 } } };
    expect(duracionesDe('clip', todos.clip.find(m => m.id === 'veo-lite')!, rara)).toEqual([]);
    expect(grupos('clip', todos, rara)).toEqual([]);
    // el clip con el número de antes (un entero) ya no es un precio: se rechaza, no se supone que es de 8 s
    const vieja: Precios = { imagen: {}, editar: {}, clip: { 'veo-lite': 36 } };
    expect(precioDe('clip', 'veo-lite', undefined, vieja, 8)).toBeNull();
    expect(grupos('clip', todos, vieja)).toEqual([]);
    // se ofrece con que tenga número en UNA duración; Kling solo en 8 s
    expect(ofrecidosDe('clip', todos, CLIP_PRUEBA).map(m => m.id)).toEqual(['h3t', 'veo-lite', 'ltx', 'veo-fast', 'kling']);
    // y en el selector solo están las duraciones que algún modelo ofrece
    expect(duracionesOfrecidas('clip', ofrecidosDe('clip', todos, CLIP_PRUEBA), CLIP_PRUEBA)).toEqual([4, 6, 8]);
    const soloLtx: Precios = { imagen: {}, editar: {}, clip: { ltx: { '6': 10, '8': 12 } } };
    expect(duracionesOfrecidas('clip', ofrecidosDe('clip', todos, soloLtx), soloLtx)).toEqual([6, 8]);
  });

  it('inicio.modelos.cada_duracion_recalcula_el_rango_del_grupo', () => {
    const todos = encendidos(CATALOGO);
    const rangos = (s: number) => grupos('clip', todos, CLIP_PRUEBA, s).map(g => [g.titulo, g.rango]);
    expect(rangos(4)).toEqual([['Económicos', '2–4'], ['Más calidad', '20']]);
    expect(rangos(6)).toEqual([['Económicos', '4–10'], ['Más calidad', '30']]);
    expect(rangos(8)).toEqual([['Económicos', '6–12'], ['Más calidad', '40–50']]);
    // la duración por defecto es la de siempre
    expect(grupos('clip', todos, CLIP_PRUEBA)).toEqual(grupos('clip', todos, CLIP_PRUEBA, DURACION_PREDETERMINADA));
    // las filas no se mueven al cambiar de duración: se ordenan a la duración más larga de cada modelo
    const orden = (s: number) => grupos('clip', todos, CLIP_PRUEBA, s).map(g => g.modelos.map(m => m.id));
    expect(orden(4)).toEqual([['h3t', 'veo-lite', 'ltx'], ['veo-fast', 'kling']]);
    expect(orden(6)).toEqual(orden(4));
    expect(orden(8)).toEqual(orden(4));
    // un grupo donde nadie admite esa duración sigue ahí (atenuado) y no inventa un rango
    const soloLtx: Precios = { imagen: {}, editar: {}, clip: { ltx: { '6': 10, '8': 12 } } };
    const g = grupos('clip', todos, soloLtx, 4);
    expect(g.map(x => [x.titulo, x.rango, x.modelos.map(m => m.id)])).toEqual([['Económicos', '', ['ltx']]]);
    // el «desde» de un modelo: lo más barato en todas sus duraciones, o en la que se pida
    const lite = todos.clip.find(m => m.id === 'veo-lite')!;
    expect(precioMinimo('clip', lite, CLIP_PRUEBA)).toBe(4);
    expect(precioMinimo('clip', lite, CLIP_PRUEBA, 8)).toBe(8);
    expect(precioMinimo('clip', todos.clip.find(m => m.id === 'ltx')!, CLIP_PRUEBA, 4)).toBeNull();
  });

  it('inicio.modelos.cambiar_la_duracion_deja_el_predeterminado_con_su_aviso', () => {
    const todos = encendidos(CATALOGO);
    const ofrecidos = ofrecidosDe('clip', todos, CLIP_PRUEBA);
    const de = (id: string) => ofrecidos.find(m => m.id === id)!;
    // el elegido sirve: no cambia nada
    expect(cambioPorDuracion('clip', ofrecidos, de('ltx'), 6, CLIP_PRUEBA)).toBeNull();
    expect(modeloPara('clip', ofrecidos, 'ltx', 6, CLIP_PRUEBA)?.id).toBe('ltx');
    // LTX no tiene 4 s: vuelve el predeterminado y se dice por qué
    const c = cambioPorDuracion('clip', ofrecidos, de('ltx'), 4, CLIP_PRUEBA)!;
    expect(c.queda.id).toBe(PREDETERMINADO.clip);
    expect(c.aviso).toBe('LTX-2.5 Fast empieza en 6 s. Te dejamos Veo 3.1 Lite.');
    // Kling solo tiene 8 s
    expect(cambioPorDuracion('clip', ofrecidos, de('kling'), 6, CLIP_PRUEBA)!.aviso).toBe(
      'Kling V3 Pro empieza en 8 s. Te dejamos Veo 3.1 Lite.',
    );
    // si el predeterminado tampoco la tiene, queda el primero que sí, y el aviso lo nombra
    const sinLiteA4: Precios = { ...CLIP_PRUEBA, clip: { ...CLIP_PRUEBA.clip, 'veo-lite': { '6': 6, '8': 8 } } };
    const of2 = ofrecidosDe('clip', todos, sinLiteA4);
    const c2 = cambioPorDuracion('clip', of2, of2.find(m => m.id === 'ltx')!, 4, sinLiteA4)!;
    expect(c2.queda.id).toBe('h3t');
    expect(c2.aviso).toBe('LTX-2.5 Fast empieza en 6 s. Te dejamos MiniMax H3 Max Turbo.');
    // nadie la tiene: no hay con qué sustituir
    expect(modeloPara('clip', of2, 'ltx', 2, sinLiteA4)).toBeUndefined();
    expect(cambioPorDuracion('clip', of2, of2.find(m => m.id === 'ltx')!, 2, sinLiteA4)).toBeNull();
  });

  it('inicio.modelos.la_duracion_que_rige_cae_en_una_que_se_ofrece', () => {
    expect(duracionVigente([4, 6, 8], 6)).toBe(6);
    // la pedida ya no se ofrece: la de siempre, o la más larga que sí
    expect(duracionVigente([6, 8], 4)).toBe(8);
    expect(duracionVigente([4, 6], 8)).toBe(6);
    // sin duración que elegir (imagen, editar) no se toca
    expect(duracionVigente([], 8)).toBe(8);
  });

  it('inicio.modelos.imagen_y_editar_no_dependen_de_la_duracion', () => {
    const todos = encendidos(CATALOGO);
    const tabla = preciosDeTodos();
    tabla.imagen.grok = 2;
    for (const t of ['imagen', 'editar'] as const) {
      const grok = todos[t].find(m => m.id === 'grok')!;
      for (const s of DURACIONES) {
        expect(precioDe(t, 'grok', undefined, tabla, s), `${t} ${s} s`).toBe(t === 'imagen' ? 2 : 5);
        expect(admite(t, grok, s, tabla)).toBe(true);
      }
      expect(duracionesDe(t, grok, tabla)).toEqual([]);
      expect(duracionesOfrecidas(t, ofrecidosDe(t, todos, tabla), tabla)).toEqual([]);
      expect(grupos(t, todos, tabla, 4)).toEqual(grupos(t, todos, tabla, 8));
    }
    // una tabla por duración no es un precio de imagen
    const rara: Precios = { imagen: { grok: { '8': 2 } }, editar: {}, clip: {} };
    expect(precioDe('imagen', 'grok', undefined, rara)).toBeNull();
    // y el «desde» de una imagen con resolución sigue siendo la resolución más barata
    const nbp = todos.imagen.find(m => m.id === 'nbp')!;
    expect(precioMinimo('imagen', nbp, { ...tabla, imagen: { 'nbp-2k': 14, 'nbp-4k': 27 } })).toBe(14);
  });
});
