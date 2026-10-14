// El catálogo de modelos y tools/tarifas.json §modelos no se pueden desfasar:
// lo que el menú enseña es lo que la tarifa dice, y un modelo sin precio no sale.
import { describe, expect, it } from 'vitest';

import { clip, modelos, video } from '../../nucleo/tarifas';
import { destinoDe, OPCIONES } from './logica';
import {
  admite,
  ahorroSinSonido,
  cambioPorDuracion,
  CATALOGO,
  detalleDe,
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
  puedeApagar,
  textoSonido,
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

// Activos en el catálogo y apagados A PROPÓSITO quitándoles su número de tarifas.json (sin número la caja no los
// ofrece y el servidor responde 422): el espejo de APAGADOS en tests/test_r4_modelos_servidor.py. 14-oct-2026,
// decisión del dueño: editar con Nano Banana 2 pasaba de los 29 s de la Lambda (docs/OPERACION.md).
const APAGADOS = new Set(['editar:nb2']);

describe('modelos.ts y tarifas.json', () => {
  it('inicio.modelos.cada_modelo_activo_tiene_precio_y_cada_precio_su_modelo', () => {
    for (const t of TAREAS) {
      const activos = CATALOGO[t].filter(m => m.activo);
      expect(activos.length, `ninguna oferta en ${t}`).toBeGreaterThan(0);
      for (const m of activos) {
        const llaves = m.calidades ? m.calidades.map(c => llavePrecio(m.id, c.id)) : [m.id];
        for (const k of llaves) {
          if (APAGADOS.has(`${t}:${k}`)) expect(modelos[t as keyof typeof modelos], `${t}:${k} apagado`).not.toHaveProperty(k);
          else expect(modelos[t as keyof typeof modelos], `${t}:${k}`).toHaveProperty(k);
        }
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
    // el estado del 14-oct-2026: Nano Banana 2 y Veo 3.1 Fast se encendieron el 9-oct tras la prueba pagada;
    // el 11-oct entraron para crear imágenes FLUX.2 klein, Z-Image Turbo, FLUX.2 pro, Seedream 5.0 Flash,
    // Seedream 4.5 y FLUX 3 (ninguno edita), y el 12-oct Nano Banana Pro (dos calidades, solo crear: no edita
    // todavía), y el 13-oct, para el clip, MiniMax H3 Max Turbo (16, 22 y 30 créditos), Grok Imagine Video (26, 38 y 50) y
    // Grok Imagine Video 1.5 Lite (12, 18 y 24). Veo 3.1 Standard y los otros tres clips de la Ola 4 (LTX, Kling y
    // Seedance) siguen apagados; el 14-oct Nano Banana 2 dejó de venderse para editar (APAGADOS, arriba: sigue en
    // el catálogo, sin número). Si esto cambia, que sea a propósito (y con su número en tarifas.json).
    const activos = (t: Tarea) => CATALOGO[t].filter(m => m.activo).map(m => m.id);
    expect(activos('imagen')).toEqual(['grok', 'klein', 'zit', 'flux2', 'sdf', 'sd45', 'flux3', 'nb2', 'nbp']);
    expect(activos('editar')).toEqual(['grok', 'nb2']);
    // 14-oct-2026: Nano Banana 2 sigue en el catálogo de editar pero sin número en tarifas.json (decisión del
    // dueño): la caja no lo ofrece y el servidor lo rechaza. A la venta para editar, solo Grok
    expect(activos('editar').filter(id => precioDe('editar', id) !== null)).toEqual(['grok']);
    expect(activos('clip')).toEqual(['h3t', 'veo-lite', 'grokv', 'grokl', 'veo-fast']);
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
    // Nano Banana Pro tiene `/edit` en fal pero no se ofrece para editar todavía: queda fuera del catálogo de editar
    expect(CATALOGO.editar.map(m => m.id)).toEqual(['grok', 'gpt2', 'nb2']);
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


// El sonido del clip (13-oct-2026): el interruptor «Audio» solo vale donde el endpoint lo permite Y tarifas.json trae su
// número «sin sonido» (§modelos.clip_sin_audio). Sin número, el modelo no se puede apagar: ni gratis ni al precio de otro.
describe('el sonido del clip', () => {
  const real = modelos as unknown as Precios;
  const clipDe = (id: string) => CATALOGO.clip.find(m => m.id === id)!;
  /** Precios de PRUEBA con y sin sonido (no son los de tarifas.json). */
  const PRUEBA: Precios = {
    imagen: {},
    editar: {},
    clip: { 'veo-lite': { '4': 18, '6': 28, '8': 36 }, h3t: { '4': 16, '6': 22, '8': 30 }, ltx: { '6': 10, '8': 12 } },
    clip_sin_audio: { 'veo-lite': { '4': 12, '6': 16 }, ltx: {}, h3t: { '8': 1 } },
  };
  /** Lo mismo pero sin la tabla «sin sonido»: nada se puede apagar. */
  const SIN_TABLA: Precios = { imagen: {}, editar: {}, clip: PRUEBA.clip };

  it('inicio.audio.el_catalogo_dice_que_modelos_se_apagan_y_el_resto_dice_por_que_no', () => {
    const sonido = Object.fromEntries(CATALOGO.clip.map(m => [m.id, m.sonido]));
    expect(sonido).toEqual({
      h3t: 'incluido',
      'veo-lite': 'opcional',
      grokv: 'bajo',
      grokl: 'bajo',
      ltx: 'opcional',
      'veo-fast': 'opcional',
      kling: 'opcional',
      seed: 'opcional',
      'veo-std': 'opcional',
    });
    // imagen y editar no tienen sonido que elegir
    for (const t of ['imagen', 'editar'] as const) for (const m of CATALOGO[t]) expect(m.sonido, m.id).toBeUndefined();
  });

  it('inicio.audio.la_tabla_sin_sonido_solo_trae_modelos_activos_que_se_apagan_y_cuesta_menos', () => {
    const tabla = real.clip_sin_audio!;
    expect(Object.keys(tabla).sort()).toEqual(['veo-fast', 'veo-lite']);
    for (const [id, porDuracion] of Object.entries(tabla)) {
      const m = clipDe(id);
      expect(m.activo, id).toBe(true);
      expect(m.sonido, id).toBe('opcional');
      for (const [s, cr] of Object.entries(porDuracion)) {
        const con = (modelos.clip as Record<string, Record<string, number>>)[id]![s]!;
        expect(Number.isInteger(cr) && cr > 0, `${id} ${s} s`).toBe(true);
        expect(cr, `${id} ${s} s`).toBeLessThan(con);
      }
      // una duración sin número sin sonido no se apaga: tiene que tener también su número con sonido
      expect(Object.keys(porDuracion).sort(), id).toEqual(Object.keys((modelos.clip as Record<string, object>)[id]!).sort());
    }
  });

  it('inicio.audio.el_precio_sin_sonido_es_el_de_la_tabla_y_los_que_no_se_apagan_siguen_con_su_precio', () => {
    for (const s of DURACIONES) {
      expect(precioDe('clip', 'veo-lite', undefined, real, s, false)).toBe(real.clip_sin_audio!['veo-lite']![String(s)]);
      expect(precioDe('clip', 'veo-lite', undefined, real, s, true)).toBe((modelos.clip as Record<string, Record<string, number>>)['veo-lite']![String(s)]);
      expect(precioDe('clip', 'veo-lite', undefined, real, s)).toBe(precioDe('clip', 'veo-lite', undefined, real, s, true)); // el defecto es con sonido
      // MiniMax y los dos Grok siempre traen su sonido: apagarlo no les cambia el precio
      for (const id of ['h3t', 'grokv', 'grokl']) {
        expect(precioDe('clip', id, undefined, real, s, false), `${id} ${s} s`).toBe(precioDe('clip', id, undefined, real, s, true));
      }
    }
    // sin tabla, o con una duración que no está, cuesta lo de con sonido y nunca cero
    expect(precioDe('clip', 'veo-lite', undefined, SIN_TABLA, 8, false)).toBe(36);
    expect(precioDe('clip', 'veo-lite', undefined, PRUEBA, 8, false)).toBe(36); // la de 8 s no está en la tabla de prueba
    // el sonido no cambia nada fuera del clip
    expect(precioDe('imagen', 'grok', undefined, real, 8, false)).toBe(modelos.imagen.grok);
  });

  it('inicio.audio.solo_se_puede_apagar_si_el_endpoint_lo_permite_y_hay_numero_a_esa_duracion', () => {
    expect(puedeApagar(clipDe('veo-lite'), 8, real)).toBe(true);
    expect(puedeApagar(clipDe('veo-fast'), 4, real)).toBe(true);
    for (const id of ['h3t', 'grokv', 'grokl']) expect(puedeApagar(clipDe(id), 8, real), id).toBe(false);
    // el endpoint lo permite pero no hay número: LTX con números de prueba, y Veo Lite a 8 s en la tabla de prueba
    expect(puedeApagar(clipDe('ltx'), 8, PRUEBA)).toBe(false);
    expect(puedeApagar(clipDe('veo-lite'), 4, PRUEBA)).toBe(true);
    expect(puedeApagar(clipDe('veo-lite'), 8, PRUEBA)).toBe(false);
    // y sin tabla nada se apaga
    expect(puedeApagar(clipDe('veo-lite'), 8, SIN_TABLA)).toBe(false);
    // un modelo que no se puede apagar según el servidor no se apaga aunque alguien le escriba un número
    expect(puedeApagar(clipDe('h3t'), 8, PRUEBA)).toBe(false);
  });

  it('inicio.audio.el_ahorro_es_la_resta_y_cero_si_no_se_apaga', () => {
    for (const s of DURACIONES) {
      const con = (modelos.clip as Record<string, Record<string, number>>)['veo-fast']![String(s)]!;
      expect(ahorroSinSonido(clipDe('veo-fast'), s, real)).toBe(con - real.clip_sin_audio!['veo-fast']![String(s)]!);
      expect(ahorroSinSonido(clipDe('veo-fast'), s, real)).toBeGreaterThan(0);
      expect(ahorroSinSonido(clipDe('grokl'), s, real)).toBe(0);
    }
    expect(ahorroSinSonido(clipDe('veo-lite'), 8, PRUEBA)).toBe(0); // sin número a 8 s: nada que ahorrar
  });

  it('inicio.audio.el_detalle_de_la_fila_dice_sin_audio_solo_si_se_apaga_de_verdad', () => {
    const lite = clipDe('veo-lite');
    expect(detalleDe(lite, 8, true, real)).toBe('Google · 720p con audio');
    expect(detalleDe(lite, 8, false, real)).toBe('Google · 720p sin audio');
    // MiniMax y Grok no dicen «con audio» y no cambian; un modelo sin número «sin sonido» tampoco cambia
    for (const id of ['h3t', 'grokv', 'grokl']) expect(detalleDe(clipDe(id), 8, false, real), id).toBe(clipDe(id).detalle);
    expect(detalleDe(lite, 8, false, PRUEBA)).toBe('Google · 720p con audio');
  });

  it('inicio.audio.los_modelos_sin_interruptor_dicen_su_estado_y_su_motivo', () => {
    expect(textoSonido(clipDe('h3t'))).toEqual({
      estado: 'Sonido incluido',
      motivo: 'MiniMax H3 Max Turbo trae su propio sonido y no se puede apagar.',
    });
    expect(textoSonido(clipDe('grokv'))).toEqual({
      estado: 'Sonido muy bajo',
      motivo: 'El sonido de Grok Imagine Video es muy bajo y no se puede apagar.',
    });
    expect(textoSonido(clipDe('grokl')).estado).toBe('Sonido muy bajo');
  });

  it('inicio.audio.el_rango_del_grupo_sigue_el_sonido_y_el_orden_no_se_mueve', () => {
    const todos = encendidos(CATALOGO);
    const nombres = (sonido: boolean) => grupos('clip', todos, real, 8, sonido).map(g => g.modelos.map(m => m.id));
    expect(nombres(false)).toEqual(nombres(true)); // el orden es por el precio con sonido
    const con = grupos('clip', todos, real, 8, true).find(g => g.nivel === 'calidad')!;
    const sin = grupos('clip', todos, real, 8, false).find(g => g.nivel === 'calidad')!;
    expect(sin.rango).not.toBe(con.rango);
    expect(sin.rango).toContain(String(real.clip_sin_audio!['veo-fast']!['8']));
  });
});
