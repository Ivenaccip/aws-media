// Las reglas de la hoja «Agregar videos» y de la lista de la caja, sin pantalla. Cada nombre que empieza por su ID es un invariante del
// registro (tests/test_migracion_ui.py). Nada sale a la red: son funciones puras.
import { describe, expect, it } from 'vitest';

import type { VideoElegible } from './envio';
import {
  bloqueoDeSubir,
  claveDeSubida,
  cuentaDeLaHoja,
  descripcionDeSubir,
  etiquetaDelVideo,
  fechaDeLaHoja,
  LIMITES_DE_RESPALDO,
  mover,
  MAX_BYTES,
  MAX_S,
  MAX_VIDEOS,
  MIN_SOLO_S,
  motivoHoja,
  ordenEnLaHoja,
  quitarDe,
  rotuloDeFormato,
  rotuloDeTipo,
  rotuloDeUsar,
  soloParaUnir,
  sumar,
  unicoCorto,
  usarApagado,
  type FichaDeVideo,
} from './reglasVideos';

let n = 0;
/** Un video de la lista del servidor: horizontal, de 5 minutos, sin motivo. */
function elegible(sobre: Partial<VideoElegible> = {}): VideoElegible {
  n += 1;
  return {
    ref: `proyecto:gen-${n}`,
    tipo: 'pelicula',
    titulo: `Video ${n}`,
    duracion_s: 300,
    formato: 'horizontal',
    fecha: '2026-10-02T15:04:05+00:00',
    miniatura: null,
    video: null,
    con_transcript: true,
    audio: true,
    bytes: 50_000_000,
    es_copia: false,
    copia_de: [],
    motivo: null,
    ...sobre,
  };
}
const ficha = (sobre: Partial<FichaDeVideo> = {}): FichaDeVideo => ({ ref: null, duracion_s: 300, formato: 'horizontal', bytes: 50_000_000, ...sobre });

describe('las constantes de respaldo', () => {
  it('son las de §1 del contrato (el servidor es la autoridad; test_e2_limites las compara con las suyas)', () => {
    expect([MAX_S, MIN_SOLO_S, MAX_VIDEOS, MAX_BYTES]).toEqual([5400, 60, 12, 15 * 1024 ** 3]);
    expect(LIMITES_DE_RESPALDO).toEqual({ max_s: MAX_S, min_solo_s: MIN_SOLO_S, max_videos: MAX_VIDEOS, max_bytes: MAX_BYTES });
  });
});

describe('por qué un video no se puede elegir', () => {
  it('inicio.hojavideos.los_motivos_de_apagado_siguen_su_orden_y_solo_los_del_video_van_aparte', () => {
    const texto = (v: VideoElegible, base: FichaDeVideo[] = [], enCaja: FichaDeVideo[] = []) => motivoHoja(v, base, enCaja)?.texto ?? null;
    expect(texto(elegible())).toBeNull();
    // 1. más de 90 min (130 min = 7800 s), aunque además sea una copia: gana la duración, y va aparte
    const larga = elegible({ duracion_s: 7800, es_copia: true, motivo: 'es_copia' });
    expect(motivoHoja(larga, [], [])).toEqual({ codigo: 'larga', texto: 'Dura 130 min · máximo 90 min', aparte: true });
    // justo 90 min sí cabe
    expect(texto(elegible({ duracion_s: 5400 }))).toBeNull();
    // un poco más de 90 min redondea a 90: «Dura 90 min · máximo 90 min» no se entiende. Se dice 91, como el servidor (`larga`)
    expect(texto(elegible({ duracion_s: 5401 }))).toBe('Dura 91 min · máximo 90 min');
    expect(texto(elegible({ duracion_s: 5429 }))).toBe('Dura 91 min · máximo 90 min');
    expect(texto(elegible({ duracion_s: 5431 }))).toBe('Dura 91 min · máximo 90 min');
    expect(texto(elegible({ duracion_s: 5490 }))).toBe('Dura 92 min · máximo 90 min'); // 91,5 → 92
    expect(texto(elegible({ duracion_s: 7800 }))).toBe('Dura 130 min · máximo 90 min'); // lo de siempre no cambia
    // 2. copia > 3. en curso > 4. sin metraje > 5. midiendo: los cuatro del servidor, también aparte
    expect(motivoHoja(elegible({ es_copia: true, motivo: 'es_copia' }), [], [])).toEqual({ codigo: 'es_copia', texto: 'Ya es una edición · ábrela en su editor', aparte: true });
    expect(motivoHoja(elegible({ motivo: 'en_curso' }), [], [])).toEqual({ codigo: 'en_curso', texto: 'Se está editando ahora', aparte: true });
    expect(motivoHoja(elegible({ motivo: 'sin_metraje' }), [], [])).toEqual({ codigo: 'sin_metraje', texto: 'No tiene video para editar', aparte: true });
    expect(motivoHoja(elegible({ motivo: 'midiendo', duracion_s: null, formato: null, bytes: null }), [], [])).toEqual({
      codigo: 'midiendo',
      texto: 'Calculando su duración…',
      aparte: true,
    });
    // una duración que no llegó es lo mismo que «midiendo», aunque el servidor no lo haya dicho
    expect(texto(elegible({ duracion_s: null }))).toBe('Calculando su duración…');
    // 6. ya está en la caja (no va aparte: se queda en su lugar, con palomita)
    const uno = elegible();
    expect(motivoHoja(uno, [], [ficha({ ref: uno.ref })])).toEqual({ codigo: 'en_caja', texto: 'En la caja', aparte: false });
    // 7. formato distinto al de lo elegido o al de la caja
    const vertical = elegible({ formato: 'vertical' });
    const horizontal = elegible({ formato: 'horizontal' });
    expect(texto(vertical, [ficha()])).toBe('Vertical · no se une con horizontales');
    expect(texto(horizontal, [ficha({ formato: 'vertical' })])).toBe('Horizontal · no se une con verticales');
    expect(texto(vertical, [], [ficha()])).toBe('Vertical · no se une con horizontales');
    expect(texto(vertical, [], [ficha({ formato: 'vertical' })])).toBeNull();
    // de la caja, el formato de un archivo recién subido aún se ignora: no se sabe hasta cotizar
    expect(texto(vertical, [], [ficha({ formato: null, ref: 'proyecto:subida' })])).toBeNull();
    // 8. se pasaría de 90 min: la caja (30 min) + lo marcado (40 min) + este (25 min)
    const cabe = elegible({ duracion_s: 20 * 60 });
    expect(texto(cabe, [ficha({ duracion_s: 40 * 60 })], [ficha({ duracion_s: 30 * 60 })])).toBeNull();
    expect(texto(elegible({ duracion_s: 25 * 60 }), [ficha({ duracion_s: 40 * 60 })], [ficha({ duracion_s: 30 * 60 })])).toBe('Se pasa de 90 min');
    // 9. ya son 12 (entre la caja y lo marcado)
    const doce = Array.from({ length: 12 }, () => ficha({ duracion_s: 10 }));
    expect(texto(elegible({ duracion_s: 10 }), doce.slice(0, 11))).toBeNull();
    expect(texto(elegible({ duracion_s: 10 }), doce.slice(0, 5), doce.slice(5, 12))).toBe('Ya son 12 videos · es el máximo');
    // 10. pesarían más de 15 GB juntos
    expect(texto(elegible({ bytes: 6 * 1024 ** 3 }), [ficha({ bytes: 9 * 1024 ** 3 })])).toBeNull(); // 15 GB justos
    expect(texto(elegible({ bytes: 6 * 1024 ** 3 + 1 }), [ficha({ bytes: 9 * 1024 ** 3 })])).toBe('Pesan demasiado juntos · máximo 15 GB');
    // el orden: formato antes que los 90 min, los 90 min antes que los 12, los 12 antes que el peso
    const todoAlLimite = [ficha({ duracion_s: 5390, bytes: 15 * 1024 ** 3, formato: 'vertical' })];
    expect(texto(elegible({ duracion_s: 20, bytes: 1 }), todoAlLimite)).toBe('Horizontal · no se une con verticales');
    expect(texto(elegible({ duracion_s: 20, bytes: 1, formato: 'vertical' }), todoAlLimite)).toBe('Se pasa de 90 min');
    const doceCortos = Array.from({ length: 12 }, () => ficha({ duracion_s: 1, bytes: 2 * 1024 ** 3 }));
    expect(texto(elegible({ duracion_s: 1, bytes: 2 * 1024 ** 3 }), doceCortos)).toBe('Ya son 12 videos · es el máximo');
    // uno ya marcado nunca se apaga: se puede desmarcar aunque lo marcado ya llene el tope
    const marcado = elegible({ formato: 'vertical' });
    expect(motivoHoja(marcado, [ficha({ ref: marcado.ref, formato: 'vertical' }), ...doceCortos], [])).toBeNull();
  });

  it('usa los límites que manda el servidor, no los de respaldo', () => {
    const lim = { max_s: 3600, min_solo_s: 30, max_videos: 3, max_bytes: 2 * 1024 ** 3 };
    expect(motivoHoja(elegible({ duracion_s: 3700 }), [], [], lim)?.texto).toBe('Dura 62 min · máximo 60 min');
    // el piso sigue al TOPE que manda el servidor, no a un 90 fijo: 3601 s redondea a 60 y se dice 61
    expect(motivoHoja(elegible({ duracion_s: 3601 }), [], [], lim)?.texto).toBe('Dura 61 min · máximo 60 min');
    expect(motivoHoja(elegible({ duracion_s: 1900 }), [ficha({ duracion_s: 1900 })], [], lim)?.texto).toBe('Se pasa de 60 min');
    expect(motivoHoja(elegible({ duracion_s: 10 }), [ficha(), ficha(), ficha()], [], lim)?.texto).toBe('Ya son 3 videos · es el máximo');
    expect(motivoHoja(elegible({ bytes: 2 * 1024 ** 3 }), [ficha({ bytes: 1 })], [], lim)?.texto).toBe('Pesan demasiado juntos · máximo 2 GB');
    expect(unicoCorto([{ duracion_s: 40 }], lim)).toBe(false); // con un mínimo de 30 s, 40 s sí se edita solo
    expect(descripcionDeSubir(lim)).toBe('MP4, MOV o M4V, hasta 60 minutos en total');
  });
});

describe('un solo video corto', () => {
  it('inicio.hojavideos.un_solo_video_de_menos_de_1_min_no_se_edita_solo_y_uno_de_60_s_si', () => {
    expect(unicoCorto([{ duracion_s: 8 }])).toBe(true);
    expect(unicoCorto([{ duracion_s: 59.96 }])).toBe(true); // sin redondear: 59,96 s redondeado sería 1:00
    expect(unicoCorto([{ duracion_s: 60 }])).toBe(false);
    expect(unicoCorto([{ duracion_s: 724 }])).toBe(false);
    // dos o más cortos sí se pueden unir: sin mínimo
    expect(unicoCorto([{ duracion_s: 8 }, { duracion_s: 8 }])).toBe(false);
    expect(unicoCorto([])).toBe(false);
    // una duración que aún no se sabe no se juzga: lo dirá cotizar
    expect(unicoCorto([{ duracion_s: null }])).toBe(false);
    expect(soloParaUnir({ duracion_s: 59 })).toBe(true);
    expect(soloParaUnir({ duracion_s: 60 })).toBe(false);
    expect(soloParaUnir({ duracion_s: null })).toBe(false);
    // «Usar» se apaga con nada marcado o con UN corto (contando la caja)
    expect(usarApagado([], [])).toBe(true);
    expect(usarApagado([ficha({ duracion_s: 8 })], [])).toBe(true);
    expect(usarApagado([ficha({ duracion_s: 8 })], [ficha({ duracion_s: 8 })])).toBe(false);
    expect(usarApagado([ficha({ duracion_s: 300 })], [])).toBe(false);
  });
});

describe('el pie de la hoja', () => {
  it('inicio.hojavideos.el_pie_dice_lo_que_pasa_en_sus_seis_casos', () => {
    const base = { sinVideos: false, marcados: [] as FichaDeVideo[], enCaja: [] as FichaDeVideo[] };
    // 1. Mi computadora
    expect(cuentaDeLaHoja({ ...base, pestana: 'computadora' })).toEqual({ texto: 'Se sube de tu computadora y no cuesta créditos. Puedes subir varios.', alerta: null });
    // 2. la lista vino vacía
    expect(cuentaDeLaHoja({ ...base, pestana: 'creaciones', sinVideos: true })).toEqual({ texto: 'Aquí aparecen los videos que hagas con IA.', alerta: null });
    // 3. nada marcado
    expect(cuentaDeLaHoja({ ...base, pestana: 'creaciones' })).toEqual({ texto: 'Elige uno o varios videos. Se unen en el orden en que los marques.', alerta: null });
    // 4. uno solo y corto: el pie y la alerta aparte
    expect(cuentaDeLaHoja({ ...base, pestana: 'creaciones', marcados: [ficha({ duracion_s: 8 })] })).toEqual({
      texto: '1 video · 0:08 en total.',
      alerta: 'Un video de menos de 1 min no se puede editar solo. Marca otro para unirlos.',
    });
    // 5. normal, sin caja: singular y plural
    expect(cuentaDeLaHoja({ ...base, pestana: 'creaciones', marcados: [ficha({ duracion_s: 724 })] })).toEqual({
      texto: '1 video · 12:04 en total · Se edita una copia; tus originales no se tocan.',
      alerta: null,
    });
    expect(cuentaDeLaHoja({ ...base, pestana: 'creaciones', marcados: [ficha({ duracion_s: 30 }), ficha({ duracion_s: 42 })] }).texto).toBe(
      '2 videos · 1:12 en total · Se edita una copia; tus originales no se tocan.',
    );
    // 6. normal, con caja: suma lo de la caja
    expect(
      cuentaDeLaHoja({ ...base, pestana: 'creaciones', marcados: [ficha({ duracion_s: 724 })], enCaja: [ficha({ duracion_s: 30 }), ficha({ duracion_s: 42 }), ficha({ duracion_s: 0 })] }).texto,
    ).toBe('1 video · 12:04 en total · Con los de la caja serán 4 (13:16). Se edita una copia; tus originales no se tocan.');
    // un corto marcado junto a uno de la caja ya son dos: se unen, sin alerta
    expect(cuentaDeLaHoja({ ...base, pestana: 'creaciones', marcados: [ficha({ duracion_s: 8 })], enCaja: [ficha({ duracion_s: 8 })] }).alerta).toBeNull();
    // con un archivo de la caja que aún no se mide no se dice una suma que sería mentira a medias
    expect(
      cuentaDeLaHoja({ ...base, pestana: 'creaciones', marcados: [ficha({ duracion_s: 724 })], enCaja: [ficha({ duracion_s: null })] }).texto,
    ).toBe('1 video · 12:04 en total · Con los de la caja serán 2. Se edita una copia; tus originales no se tocan.');
    // los botones
    expect([0, 1, 2, 5].map(rotuloDeUsar)).toEqual(['Usar videos', 'Usar este video', 'Usar 2 videos', 'Usar 5 videos']);
  });
});

describe('la numeración y la lista', () => {
  it('inicio.hojavideos.los_numeros_de_orden_continuan_la_cuenta_de_la_caja', () => {
    // con 3 en la caja, el primero marcado es el 4
    expect([0, 1, 2].map(i => ordenEnLaHoja(3, i))).toEqual([4, 5, 6]);
    expect([0, 1].map(i => ordenEnLaHoja(0, i))).toEqual([1, 2]);
  });

  it('mover sube o baja un lugar sin tocar la lista de origen y no se sale de los extremos', () => {
    const lista = ['a', 'b', 'c'];
    expect(mover(lista, 1, -1)).toEqual(['b', 'a', 'c']);
    expect(mover(lista, 1, 1)).toEqual(['a', 'c', 'b']);
    expect(mover(lista, 0, -1)).toEqual(['a', 'b', 'c']);
    expect(mover(lista, 2, 1)).toEqual(['a', 'b', 'c']);
    expect(mover(lista, 9, 1)).toEqual(['a', 'b', 'c']);
    expect(mover(lista, 1, -1)).not.toBe(lista);
    expect(lista).toEqual(['a', 'b', 'c']);
  });

  it('quitarDe saca una posición y deja los números en orden', () => {
    const lista = ['a', 'b', 'c', 'd'];
    expect(quitarDe(lista, 1)).toEqual(['a', 'c', 'd']);
    expect(quitarDe(lista, 3)).toEqual(['a', 'b', 'c']);
    expect(quitarDe(lista, 9)).toEqual(['a', 'b', 'c', 'd']);
    expect(lista).toHaveLength(4);
  });

  it('la suma de las duraciones no cuenta lo que aún no se sabe', () => {
    expect(sumar([{ duracion_s: 30 }, { duracion_s: null }, { duracion_s: 42.5 }])).toBe(72.5);
    expect(sumar([])).toBe(0);
  });

  it('una subida confirmada es el proyecto «proyecto:<nombre>»', () => {
    expect(claveDeSubida('entrevista-final')).toBe('proyecto:entrevista-final');
  });
});

describe('lo que el menú del «+» apaga', () => {
  it('con 12 videos o 90 minutos en la caja «Subir de tu computadora» se apaga y dice por qué', () => {
    expect(bloqueoDeSubir([])).toBeNull();
    expect(bloqueoDeSubir(Array.from({ length: 11 }, () => ficha({ duracion_s: 10 })))).toBeNull();
    expect(bloqueoDeSubir(Array.from({ length: 12 }, () => ficha({ duracion_s: 10 })))).toBe('Ya tienes 12 videos: es el máximo.');
    expect(bloqueoDeSubir([ficha({ duracion_s: 5399 })])).toBeNull();
    expect(bloqueoDeSubir([ficha({ duracion_s: 5400 })])).toBe('Ya llegaste a 90 minutos en total: no caben más videos.');
    expect(bloqueoDeSubir([ficha({ duracion_s: 3000 }), ficha({ duracion_s: 2400 })])).toBe('Ya llegaste a 90 minutos en total: no caben más videos.');
    // con una duración sin saber no se afirma que ya se llegó a los 90
    expect(bloqueoDeSubir([ficha({ duracion_s: 5400 }), ficha({ duracion_s: null })])).toBeNull();
    expect(descripcionDeSubir()).toBe('MP4, MOV o M4V, hasta 90 minutos en total');
  });
});

describe('rótulos', () => {
  it('el tipo, el formato y la fecha corta se leen como una persona', () => {
    expect(['pelicula', 'cuento', 'clip', 'edicion'].map(t => rotuloDeTipo(t as VideoElegible['tipo']))).toEqual(['Película', 'Cuento', 'Clip', 'Edición']);
    expect([rotuloDeFormato('horizontal'), rotuloDeFormato('vertical'), rotuloDeFormato(null)]).toEqual(['16:9', '9:16', '']);
    expect(fechaDeLaHoja('2026-10-02T15:04:05+00:00')).toBe('2/10');
    expect(fechaDeLaHoja(null)).toBe('');
    expect(fechaDeLaHoja('no es una fecha')).toBe('');
  });

  it('el nombre accesible suma cada trozo solo si aplica, en el orden del contrato', () => {
    const e = { titulo: 'Perro en la playa', duracion_s: 8, formato: 'horizontal' as const, soloUnir: true, orden: 0, motivo: '' };
    expect(etiquetaDelVideo({ ...e, soloUnir: false })).toBe('Perro en la playa, 0:08, 16:9');
    expect(etiquetaDelVideo(e)).toBe('Perro en la playa, 0:08, 16:9, solo para unir');
    expect(etiquetaDelVideo({ ...e, orden: 4 })).toBe('Perro en la playa, 0:08, 16:9, solo para unir, elegido, número 4');
    expect(etiquetaDelVideo({ ...e, soloUnir: false, motivo: 'En la caja' })).toBe('Perro en la playa, 0:08, 16:9, no disponible: En la caja');
    expect(etiquetaDelVideo({ ...e, duracion_s: null, formato: null, soloUnir: false, motivo: 'Calculando su duración…' })).toBe(
      'Perro en la playa, no disponible: Calculando su duración…',
    );
  });
});
