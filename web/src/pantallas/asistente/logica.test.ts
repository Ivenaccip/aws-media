// Lo puro del Asistente: cómo se lee lo que contesta el servidor (sin fiarse de su forma), cómo se valida el pedido y qué texto sale de
// cada error. Sin React, sin red, sin DOM.
import { describe, expect, it } from 'vitest';

import { ErrorApi } from '../../nucleo/api';
import { CONFIG, FLUJO, INICIO, SIN_COBERTURA, armandoEn, grafo, listo } from './arnes';
import {
  CODIGOS_DEL_CUADRO,
  PASOS,
  PASOS_ESPERA,
  esAbortada,
  esTransitorio,
  falloDe,
  indiceDePaso,
  jsonDelFlujo,
  largo,
  leerArmado,
  leerConfig,
  leerId,
  nombreDelArchivo,
  puedeOfrecer,
  textoContador,
  validarPedido,
} from './logica';

const LIMITES = { minimo: 20, maximo: 1500 };

describe('leerConfig', () => {
  it('lee lo que dice el servidor: si está activo, el modo, si es gratis y los límites', () => {
    expect(leerConfig(CONFIG)).toEqual({ activo: true, modo: 'prueba', gratis: true, minimo: 20, maximo: 1500, texto: null });
  });

  it('sin los límites o sin «activo» no hay nada que ofrecer: null', () => {
    expect(leerConfig(null)).toBeNull();
    expect(leerConfig([])).toBeNull();
    expect(leerConfig({ ...CONFIG, largo_minimo: undefined })).toBeNull();
    expect(leerConfig({ ...CONFIG, largo_maximo: 0 })).toBeNull();
    expect(leerConfig({ ...CONFIG, largo_minimo: 50, largo_maximo: 10 })).toBeNull();
    expect(leerConfig({ ...CONFIG, activo: 'sí' })).toBeNull();
  });

  it('un modo que no conoce es «no_disponible» y lo que no dice que es gratis, no se da por gratis', () => {
    const c = leerConfig({ ...CONFIG, modo: 'secreto', gratis: undefined });
    expect(c?.modo).toBe('no_disponible');
    expect(c?.gratis).toBe(false);
  });

  it('solo se ofrece escribir si está activo Y es gratis', () => {
    const c = (extra: object) => leerConfig({ ...CONFIG, ...extra })!;
    expect(puedeOfrecer(c({}))).toBe(true);
    expect(puedeOfrecer(c({ activo: false }))).toBe(false);
    expect(puedeOfrecer(c({ gratis: false, costo_creditos: 12 }))).toBe(false);
  });

  it('el texto del servidor para el estado apagado se conserva', () => {
    expect(leerConfig({ ...CONFIG, activo: false, texto: 'Vuelve luego.' })?.texto).toBe('Vuelve luego.');
    expect(leerConfig({ ...CONFIG, texto: '   ' })?.texto).toBeNull();
  });
});

describe('validarPedido y el contador', () => {
  it('vacío, corto y largo dicen qué hacer, con cuánto lleva', () => {
    expect(validarPedido('   ', LIMITES)).toMatchObject({ codigo: 'vacio', texto: 'Escribe primero qué quieres automatizar, aunque sea en una frase.' });
    expect(validarPedido('hola', LIMITES)).toMatchObject({
      codigo: 'corto',
      texto: 'Cuéntanos un poco más: escribe al menos 20 caracteres. Llevas 4.',
    });
    expect(validarPedido('a'.repeat(1501), LIMITES)).toMatchObject({
      codigo: 'largo',
      texto: 'Es muy largo: el máximo es de 1500 caracteres y llevas 1501. Acórtalo para armar tu flujo.',
    });
  });

  it('los límites son los justos: 20 y 1500 entran', () => {
    expect(validarPedido('a'.repeat(20), LIMITES)).toBeNull();
    expect(validarPedido('a'.repeat(1500), LIMITES)).toBeNull();
    expect(validarPedido('a'.repeat(19), LIMITES)?.codigo).toBe('corto');
  });

  it('mide lo recortado y en puntos de código, como el servidor: un emoji cuenta uno', () => {
    expect(largo('😀😀')).toBe(2);
    expect(validarPedido('  ' + 'a'.repeat(19) + '  ', LIMITES)?.codigo).toBe('corto');
    expect(validarPedido('😀'.repeat(20), LIMITES)).toBeNull();
  });

  it('el contador dice cuánto llevas y, mientras falta, el mínimo', () => {
    expect(textoContador('', LIMITES)).toBe('0 de 1500 caracteres');
    expect(textoContador('hola', LIMITES)).toBe('4 de 1500 caracteres · mínimo 20');
    expect(textoContador('a'.repeat(30), LIMITES)).toBe('30 de 1500 caracteres');
  });
});

describe('falloDe', () => {
  it('un error del API con {codigo, texto} usa el texto del servidor tal cual', () => {
    const e = new ErrorApi(422, 'x', { codigo: 'corto', texto: 'Cuéntanos un poco más: al menos 20 caracteres.', minimo: 20 });
    expect(falloDe(e)).toEqual({ codigo: 'corto', texto: 'Cuéntanos un poco más: al menos 20 caracteres.', estado: 422 });
  });

  it('sin conexión es «sin_conexion» y es transitorio; un 404 sin cuerpo propio dice que escribas de nuevo el pedido', () => {
    const sinRed = falloDe(new ErrorApi(0, 'No hay conexión. Revisa tu internet y vuelve a intentar.', null));
    expect(sinRed).toMatchObject({ codigo: 'sin_conexion', estado: 0 });
    expect(esTransitorio(sinRed)).toBe(true);
    const noHay = falloDe(new ErrorApi(404, 'Not Found', 'Not Found'));
    expect(noHay.codigo).toBe('no_encontrada');
    expect(noHay.texto).toBe('No encontramos ese pedido. Escribe de nuevo qué quieres automatizar.');
  });

  it('un 503 es «no_disponible» y NO es transitorio; un 502 o 504 de la puerta sí', () => {
    const f = falloDe(new ErrorApi(503, 'x', { codigo: 'no_disponible', texto: 'El Asistente no está disponible por ahora. Inténtalo en unos minutos.' }));
    expect(f.codigo).toBe('no_disponible');
    expect(esTransitorio(f)).toBe(false);
    expect(esTransitorio(falloDe(new ErrorApi(502, 'x', null)))).toBe(true);
    expect(esTransitorio(falloDe(new ErrorApi(504, 'x', null)))).toBe(true);
    expect(esTransitorio(falloDe(new ErrorApi(500, 'x', null)))).toBe(false);
  });

  it('lo que no es un error del API sale como «otro», en español, sin el mensaje de la excepción', () => {
    const f = falloDe(new TypeError('boom interno'));
    expect(f.codigo).toBe('otro');
    expect(f.texto).not.toContain('boom');
  });

  it('un código que no conoce se vuelve «otro» pero conserva el texto del servidor', () => {
    const f = falloDe(new ErrorApi(409, 'x', { codigo: 'inventado', texto: 'Algo nuevo.' }));
    expect(f).toEqual({ codigo: 'otro', texto: 'Algo nuevo.', estado: 409 });
  });

  it('los errores que se dicen junto al cuadro son los del pedido', () => {
    expect([...CODIGOS_DEL_CUADRO].sort()).toEqual(['corto', 'largo', 'moderacion', 'texto_invalido', 'vacio']);
  });

  it('esAbortada reconoce una petición cancelada', () => {
    expect(esAbortada(new DOMException('x', 'AbortError'))).toBe(true);
    expect(esAbortada(new Error('x'))).toBe(false);
  });
});

describe('leerArmado', () => {
  it('armando: el paso es el índice de los cuatro que informa el servidor; uno desconocido es null', () => {
    expect(PASOS).toEqual(['entender', 'buscar', 'armar', 'revisar']);
    expect(PASOS_ESPERA).toHaveLength(4);
    expect(leerArmado(armandoEn('armar'))).toEqual({ estado: 'armando', paso: 2, lugar: null });
    expect(leerArmado(armandoEn('inventado'))).toEqual({ estado: 'armando', paso: null, lugar: null });
    expect(indiceDePaso('revisar')).toBe(3);
    expect(indiceDePaso(7)).toBeNull();
  });

  it('en_fila (reservado para el modo real) se lee como armando en el primer paso, con su lugar', () => {
    expect(leerArmado({ estado: 'en_fila', lugar: 3 })).toEqual({ estado: 'armando', paso: 0, lugar: 3 });
    expect(leerArmado({ estado: 'en_fila', lugar: 'tres' })).toEqual({ estado: 'armando', paso: 0, lugar: null });
  });

  it('listo: nombre, resumen, chips (en español), pendientes, advertencias, flujo y grafo', () => {
    const l = leerArmado(listo({ advertencias: ['Ojo.'] }));
    if (l.estado !== 'listo') throw new Error('debía estar listo');
    expect(l.listo.nombre).toBe(FLUJO.name);
    expect(l.listo.nodos.map(n => n.nombre)).toEqual(['Llega un correo (Gmail)', 'Agente de IA', 'Gmail (paso)']);
    expect(l.listo.pendientes).toHaveLength(2);
    expect(l.listo.advertencias).toEqual(['Ojo.']);
    expect(l.listo.flujo).toEqual(FLUJO);
    expect(l.listo.grafo).toEqual(grafo());
  });

  it('listo sin `etiqueta` usa el nombre de n8n; sin `grafo`, el grafo es null (no se ofrece abrir en el constructor)', () => {
    const l = leerArmado(listo({ nodos: [{ tipo: 'x', nombre: 'Gmail' }, { nombre: '   ' }, 'raro', null], grafo: undefined }));
    if (l.estado !== 'listo') throw new Error('debía estar listo');
    expect(l.listo.nodos).toEqual([{ tipo: 'x', nombre: 'Gmail' }]);
    expect(l.listo.grafo).toBeNull();
  });

  it('listo sin flujo o sin nombre es una respuesta que no se entiende, no un resultado', () => {
    for (const roto of [listo({ flujo: undefined }), listo({ flujo: 'texto' }), listo({ nombre: '' }), listo({ nombre: 7 })]) {
      expect(leerArmado(roto)).toMatchObject({ estado: 'fallo', fallo: { codigo: 'respuesta' } });
    }
  });

  it('los textos sueltos solo cuentan si son texto: lo demás se descarta', () => {
    const l = leerArmado(listo({ pendientes: ['a', 3, '', null, 'b'], resumen: 12 }));
    if (l.estado !== 'listo') throw new Error('debía estar listo');
    expect(l.listo.pendientes).toEqual(['a', 'b']);
    expect(l.listo.resumen).toBeNull();
  });

  it('sin_cobertura: el mensaje y lo que falta', () => {
    expect(leerArmado(SIN_COBERTURA)).toEqual({ estado: 'sin_cobertura', mensaje: SIN_COBERTURA.mensaje, faltan: SIN_COBERTURA.faltan });
    expect(leerArmado({ estado: 'sin_cobertura' })).toMatchObject({ mensaje: 'Todavía no sabemos armar esto con n8n.', faltan: [] });
  });

  it('no_salio y rechazada (reservados para el modo real) son fallos con su mensaje', () => {
    expect(leerArmado({ estado: 'no_salio', mensaje: 'No salió.' })).toMatchObject({ estado: 'fallo', fallo: { codigo: 'no_salio', texto: 'No salió.' } });
    expect(leerArmado({ estado: 'rechazada' })).toMatchObject({ estado: 'fallo', fallo: { codigo: 'rechazada' } });
  });

  it('lo que no es un objeto o trae un estado desconocido es una respuesta que no se entiende', () => {
    expect(leerArmado(null)).toMatchObject({ estado: 'fallo', fallo: { codigo: 'respuesta' } });
    expect(leerArmado('ok')).toMatchObject({ estado: 'fallo', fallo: { codigo: 'respuesta' } });
    expect(leerArmado({ estado: 'misterio' })).toMatchObject({ estado: 'fallo', fallo: { codigo: 'respuesta' } });
  });

  it('el id del 202 es un texto sin espacios ni barras (va en la ruta del GET)', () => {
    expect(leerId(INICIO)).toBe(INICIO.id);
    for (const malo of [{ id: '' }, { id: 'a b' }, { id: 'a/b' }, { id: 'a?b' }, { id: 'a#b' }, { id: 5 }, null, { id: 'x'.repeat(201) }]) {
      expect(leerId(malo)).toBeNull();
    }
  });
});

describe('el archivo', () => {
  it('el nombre es el del flujo, limpio, más «.json»; sin nombre usable, «flujo.json»', () => {
    expect(nombreDelArchivo('Responder correos de clientes')).toBe('Responder correos de clientes.json');
    expect(nombreDelArchivo('a/b\\c: d?')).toBe('a b c d.json');
    expect(nombreDelArchivo('///')).toBe('flujo.json');
  });

  it('un nombre larguísimo se acota sin cortar «.json»', () => {
    const n = nombreDelArchivo('x'.repeat(500));
    expect(n.endsWith('.json')).toBe(true);
    expect(n.length).toBeLessThanOrEqual(105);
  });

  it('el JSON se baja con sangría de dos espacios, tal cual lo mandó el servidor', () => {
    expect(jsonDelFlujo({ a: [1, 2] })).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    expect(JSON.parse(jsonDelFlujo(FLUJO))).toEqual(FLUJO);
  });
});
