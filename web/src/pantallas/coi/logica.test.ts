// COI sin React: lo que la pantalla calcula (contador, «Faltan…», título que se propone, texto que se copia, cómo se lee un error).
// Cada test empieza por el ID de su invariante (tests/test_migracion_ui.py).
import { describe, expect, it } from 'vitest';

import { ErrorApi } from '../../nucleo/api';
import {
  claveAleatoria,
  codigoDelBloque,
  contadorTexto,
  encabezado,
  esBloqueDeCodigo,
  faltanTexto,
  falloDe,
  largo,
  lineasDe,
  mismaRenovacion,
  partesDe,
  primeraFrase,
  puntitos,
  textoDeBloque,
  textoTodo,
  type Coi,
} from './logica';

const COI: Coi = {
  contexto: 'Necesito un guion para presentar un producto.',
  objetivo: 'Escribir un guion de 75 palabras. Que se lea en 30 segundos.',
  instrucciones: '1. Rol\n   * Actúa como guionista.\n2. Datos\n   * Nombre del producto.',
  completo: '#CONTEXTO\n…',
  estructura_ok: true,
};

describe('coi · contador y «Faltan…»', () => {
  it('coi.contador.dice_cuantos_quedan_en_singular_y_plural', () => {
    expect(contadorTexto(3, 3)).toBe('Te quedan 3 de 3 hoy');
    expect(contadorTexto(2, 3)).toBe('Te quedan 2 de 3 hoy');
    expect(contadorTexto(1, 3)).toBe('Te queda 1 de 3 hoy');
    expect(contadorTexto(0, 3)).toBe('Ya usaste tus 3 de hoy');
    expect(puntitos(2, 3)).toEqual([true, true, false]);
    expect(puntitos(0, 3)).toEqual([false, false, false]);
  });

  it('coi.contador.faltan_sale_de_los_segundos_del_servidor_y_se_redondea_hacia_arriba', () => {
    expect(faltanTexto(19200)).toBe('Faltan 5 h 20 min');
    expect(faltanTexto(19100)).toBe('Faltan 5 h 19 min'); // 318,3 min: sube a 319
    expect(faltanTexto(3600)).toBe('Faltan 1 h');
    expect(faltanTexto(3660)).toBe('Faltan 1 h 1 min');
    expect(faltanTexto(90)).toBe('Faltan 2 min');
    expect(faltanTexto(60)).toBe('Faltan 1 min');
    // nunca «0 min» con tiempo por delante
    expect(faltanTexto(59)).toBe('Falta menos de 1 min');
    expect(faltanTexto(0)).toBe('Falta menos de 1 min');
    expect(faltanTexto(-5)).toBe('Falta menos de 1 min');
  });
});

describe('coi · qué se copia y qué se propone guardar', () => {
  it('coi.logica.el_texto_copiado_lleva_encabezado_y_los_tres_bloques_en_orden', () => {
    expect(textoDeBloque(COI, 'obj', 'es')).toBe(`#OBJETIVO\n${COI.objetivo}`);
    expect(textoTodo(COI, 'es')).toBe(
      `#CONTEXTO\n${COI.contexto}\n\n#OBJETIVO\n${COI.objetivo}\n\n#INSTRUCCIONES\n${COI.instrucciones}`,
    );
    // sin estructura: lo que respondió el modelo, entero
    expect(textoTodo({ ...COI, contexto: null, objetivo: null, instrucciones: null, completo: ' Hola\n\nmundo ', estructura_ok: false }, 'es')).toBe('Hola\n\nmundo');
  });

  it('coi.logica.los_encabezados_siguen_el_idioma_en_que_salio', () => {
    expect(encabezado('ctx', 'es')).toBe('#CONTEXTO');
    expect(encabezado('ins', 'en')).toBe('#INSTRUCTIONS');
    expect(textoDeBloque({ ...COI, objetivo: 'Write a script.' }, 'obj', 'en')).toBe('#OBJECTIVE\nWrite a script.');
  });

  it('coi.guardar.el_titulo_propuesto_es_la_primera_frase_del_objetivo_y_cabe_en_80', () => {
    expect(primeraFrase(COI)).toBe('Escribir un guion de 75 palabras');
    // sin marcas de markdown
    expect(primeraFrase({ ...COI, objetivo: '**Crear** un plan de contenido. Otra cosa.' })).toBe('Crear un plan de contenido');
    // una frase larguísima se corta en una palabra entera y lleva «…», sin pasar de 80
    const larga = 'Diseñar una campaña de lanzamiento para una marca de café de especialidad con presencia en cinco ciudades y tienda en línea';
    const t = primeraFrase({ ...COI, objetivo: larga });
    expect(largo(t)).toBeLessThanOrEqual(80);
    expect(t.endsWith('…')).toBe(true);
    expect(larga.startsWith(t.slice(0, -1))).toBe(true);
    // sin objetivo y sin estructura: la primera línea de lo que respondió el modelo
    expect(primeraFrase({ ...COI, objetivo: null, estructura_ok: false, completo: '\n\n  Un prompt para resumir artículos. Más texto.' })).toBe('Un prompt para resumir artículos');
    // nada que proponer: vacío (la hoja pide un título)
    expect(primeraFrase({ ...COI, objetivo: '' })).toBe('');
  });

  it('coi.guardar.la_clave_son_32_hex_y_cada_intento_trae_otra', () => {
    const a = claveAleatoria();
    const b = claveAleatoria();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it('coi.armar.los_caracteres_se_cuentan_como_el_servidor_un_emoji_es_uno', () => {
    expect(largo('hola')).toBe(4);
    expect(largo('😀😀')).toBe(2); // 4 en UTF-16
  });
});

describe('coi · cómo se lee un error del API', () => {
  const api = (estado: number, detalle: unknown) => new ErrorApi(estado, typeof detalle === 'string' ? detalle : 'texto', detalle);

  it('coi.errores.el_codigo_y_el_texto_salen_del_detail_objeto', () => {
    const f = falloDe(new ErrorApi(429, 'Ya usaste tus 3.', { codigo: 'agotado', texto: 'Ya usaste tus 3.', quedan: 0, renueva_en_s: 3600, se_renueva: '2026-10-17T00:00:00-06:00' }));
    expect(f).toEqual({ codigo: 'agotado', texto: 'Ya usaste tus 3.', renueva_en_s: 3600, se_renueva: '2026-10-17T00:00:00-06:00' });
    for (const c of ['en_curso', 'moderacion', 'texto_invalido', 'modelo', 'tardo', 'no_disponible', 'muy_largo', 'vacio'] as const)
      expect(falloDe(new ErrorApi(422, 'x', { codigo: c, texto: 'x' })).codigo).toBe(c);
    // el 429 de «demasiados intentos» trae lo mismo que el de «agotado»: cuándo se renueva
    expect(
      falloDe(new ErrorApi(429, 'Hoy ya intentaste muchas veces.', { codigo: 'demasiados_intentos', texto: 'Hoy ya intentaste muchas veces.', quedan: 3, renueva_en_s: 3660, se_renueva: '2026-10-17T00:00:00-06:00' })),
    ).toEqual({ codigo: 'demasiados_intentos', texto: 'Hoy ya intentaste muchas veces.', renueva_en_s: 3660, se_renueva: '2026-10-17T00:00:00-06:00' });
  });

  it('coi.errores.la_misma_medianoche_se_compara_como_instante_y_no_como_texto', () => {
    expect(mismaRenovacion('2026-10-17T00:00:00-06:00', '2026-10-17T00:00:00-06:00')).toBe(true);
    // el mismo instante dicho con otra zona es la misma medianoche; otro día no
    expect(mismaRenovacion('2026-10-17T00:00:00-06:00', '2026-10-17T06:00:00Z')).toBe(true);
    expect(mismaRenovacion('2026-10-17T00:00:00-06:00', '2026-10-18T00:00:00-06:00')).toBe(false);
    // lo que no se puede leer se compara como texto (nunca «distinto» por un NaN)
    expect(mismaRenovacion('mañana', 'mañana')).toBe(true);
    expect(mismaRenovacion('mañana', 'hoy')).toBe(false);
  });

  it('coi.errores.sin_conexion_y_lo_que_no_es_del_contrato_se_distinguen', () => {
    expect(falloDe(new ErrorApi(0, 'No hay conexión.', null)).codigo).toBe('sin_conexion');
    expect(falloDe(api(504, { message: 'Endpoint request timed out' })).codigo).toBe('otro');
    expect(falloDe(api(500, { codigo: 'inventado', texto: 'algo' })).codigo).toBe('otro');
    expect(falloDe(new Error('boom'))).toEqual({ codigo: 'otro', texto: 'boom' });
  });
});

describe('coi · cómo se lee un bloque', () => {
  it('coi.resultado.las_partes_numeradas_de_las_instrucciones_se_separan', () => {
    const partes = partesDe(COI.instrucciones!);
    expect(partes).toEqual([
      { n: 1, titulo: 'Rol', lineas: ['Actúa como guionista.'] },
      { n: 2, titulo: 'Datos', lineas: ['Nombre del producto.'] },
    ]);
    // con negritas y viñetas de guion
    expect(partesDe('**1. Rol:**\n- Una cosa\n**2. Datos**\n- Otra')).toEqual([
      { n: 1, titulo: 'Rol', lineas: ['Una cosa'] },
      { n: 2, titulo: 'Datos', lineas: ['Otra'] },
    ]);
  });

  it('coi.resultado.los_pasos_numerados_de_una_parte_no_abren_partes_nuevas', () => {
    // la parte 3 trae sus propios pasos «1. 2. 3. 4.», sangrados: no son partes de primer nivel (antes salían 1,2,3,1,2,3,4,4,5,6,7)
    const t = '1. A\n   * a\n2. B\n   * b\n3. Estrategia\n   1. p1\n   2. p2\n   3. p3\n   4. p4\n4. D\n   * d\n5. E\n   * e\n6. F\n   * f\n7. G\n   * g';
    const p = partesDe(t)!;
    expect(p.map(x => x.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(p[2]!.lineas).toEqual(['1. p1', '2. p2', '3. p3', '4. p4']);
    // sin sangría pero volviendo a empezar en 1: tampoco es una parte (no es la que sigue)
    expect(partesDe('1. A\n2. B\n3. C\n1. paso\n2. paso\n4. D')!.map(x => x.n)).toEqual([1, 2, 3, 4]);
    // y un «4.» sangrado dentro de la parte 3 tampoco abre una cuarta antes de tiempo
    expect(partesDe('1. A\n2. B\n3. C\n   4. paso\n4. D')!.map(x => x.titulo)).toEqual(['A', 'B', 'C', 'D']);
    // las partes son siete: lo que siga contando ya no es una parte
    const ocho = Array.from({ length: 8 }, (_, i) => `${i + 1}. P${i + 1}`).join('\n');
    expect(partesDe(ocho)!.map(x => x.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(partesDe(ocho)![6]!.lineas).toEqual(['8. P8']);
    // un bloque entero sangrado por el modelo sigue siendo una lista de partes
    expect(partesDe('  1. A\n  2. B')!.map(x => x.n)).toEqual([1, 2]);
  });

  it('coi.resultado.un_bloque_de_codigo_dentro_de_una_parte_conserva_su_forma', () => {
    // la parte 6 pide un JSON: llega con su sangría de viñeta, una línea en blanco, un `**kwargs` y hasta un «2.» que NO es una parte
    const t = [
      '1. A', '   * a', '2. B', '   * b', '3. C', '   * c', '4. D', '   * d', '5. E', '   * e',
      '6. Formato de salida',
      '   * Devuelve este JSON:',
      '     ```json',
      '     {',
      '       "titulo": "x",',
      '',
      '       "args": "**kwargs",',
      '       "pasos": "2. no soy una parte"',
      '     }',
      '     ```',
      '   * Y nada más.',
      '7. G', '   * g',
    ].join('\n');
    const p = partesDe(t)!;
    expect(p.map(x => x.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const [intro, bloque, cierre] = p[5]!.lineas;
    expect(intro).toBe('Devuelve este JSON:');
    expect(cierre).toBe('Y nada más.');
    // el bloque es UNA entrada, sin la sangría que le dio el modelo y con la suya; no pierde negritas ni líneas en blanco
    expect(p[5]!.lineas).toHaveLength(3);
    expect(esBloqueDeCodigo(bloque!)).toBe(true);
    expect(esBloqueDeCodigo(intro!)).toBe(false);
    expect(codigoDelBloque(bloque!)).toBe('{\n  "titulo": "x",\n\n  "args": "**kwargs",\n  "pasos": "2. no soy una parte"\n}');
    // una respuesta cortada antes de la cerca final: el bloque se cierra solo y lo que había se enseña
    const cortada = partesDe('1. A\n2. B\n   ```\n   x = 1\n   y = 2')!;
    expect(cortada.map(x => x.n)).toEqual([1, 2]);
    expect(codigoDelBloque(cortada[1]!.lineas[0]!)).toBe('x = 1\ny = 2');
  });

  it('coi.resultado.un_texto_que_no_trae_partes_se_lee_como_parrafos_sin_perder_nada', () => {
    expect(partesDe('Haz esto.\nLuego esto.')).toBeNull();
    // una sola parte numerada no alcanza para una lista
    expect(partesDe('1. Rol\n   * Algo')).toBeNull();
    // texto antes de la primera parte: se queda en párrafos, para no perderlo
    expect(partesDe('Intro\n1. Rol\n2. Datos')).toBeNull();
  });

  it('coi.resultado.las_suposiciones_se_marcan_y_el_resto_son_parrafos', () => {
    expect(lineasDe('Primero.\n\n**Suposición:** no dijiste el producto.\nSuposiciones - el tono es cercano\nAssumption: audience is new')).toEqual([
      { tipo: 'parrafo', texto: 'Primero.' },
      { tipo: 'suposicion', texto: 'no dijiste el producto.' },
      { tipo: 'suposicion', texto: 'el tono es cercano' },
      { tipo: 'suposicion', texto: 'audience is new' },
    ]);
    expect(lineasDe('* una viñeta\n• otra')).toEqual([
      { tipo: 'parrafo', texto: 'una viñeta' },
      { tipo: 'parrafo', texto: 'otra' },
    ]);
  });
});
