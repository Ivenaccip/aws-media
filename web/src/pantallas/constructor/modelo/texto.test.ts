import { describe, expect, it } from 'vitest';

import {
  copiaJson,
  deIA,
  esFrecuencia,
  expr,
  frecTexto,
  literalExpr,
  esObjeto,
  nombreHerramientaSeguro,
  norm,
  numeroLibre,
  recortar,
  rutaLimpia,
  SALIDA,
  sinIgual,
  slug,
  tituloDe,
  uuidDeterminista,
} from './texto';
import type { Nodo, ParametrosN8n } from './tipos';

// Los valores esperados salen de correr las mismas funciones del mockup (Main.dc.html) con las
// mismas entradas: el golden del exportador depende de que no cambien.

describe('norm', () => {
  it('constructor.texto.norm_quita_mayusculas_acentos_y_espacios_y_lo_que_no_es_texto_es_vacio', () => {
    const casos: [unknown, string][] = [
      ['', ''],
      ['   ', ''],
      ['  Hola  ', 'hola'],
      ['ÁÉÍÓÚ áéíóú ñ Ñ ü', 'aeiou aeiou n n u'],
      ['Hoja de cálculo', 'hoja de calculo'],
      ['e\u0301', 'e'],
      // los dos extremos del rango de marcas combinantes (U+0300 a U+036F) y lo que queda justo fuera
      ['a\u0300', 'a'],
      ['a\u0360b\u036f', 'ab'],
      ['a\u02ffb', 'a\u02ffb'],
      ['a\u0370', 'a\u0371'],
      ['日本語', '日本語'],
      ['emoji 😀 x', 'emoji 😀 x'],
      ['ｆｕｌｌｗｉｄｔｈ', 'ｆｕｌｌｗｉｄｔｈ'],
      [null, ''],
      [undefined, ''],
      [0, ''],
      [false, ''],
      [12, '12'],
    ];
    for (const [entrada, esperado] of casos) expect(norm(entrada), JSON.stringify(entrada)).toBe(esperado);
  });
});

describe('rutaLimpia y slug', () => {
  it('constructor.texto.ruta_limpia_deja_letras_numeros_guion_y_guion_bajo_sin_guiones_en_los_extremos', () => {
    const casos: [unknown, string][] = [
      ['Mi Flujo Ñandú!', 'mi-flujo-nandu'],
      ['Atención a clientes (v2)', 'atencion-a-clientes-v2'],
      ['', ''],
      ['   ', ''],
      ['###', ''],
      ['---a---', 'a'],
      ['a_b-c', 'a_b-c'],
      ['A B', 'a-b'],
      ['mi/flujo?x=1', 'mi-flujo-x-1'],
      ['{{x}}', 'x'],
      ['日本語', ''],
      ['emoji 😀 x', 'emoji-x'],
      ['__proto__', '__proto__'],
      ['toString', 'tostring'],
      [null, ''],
    ];
    for (const [entrada, esperado] of casos) expect(rutaLimpia(entrada), JSON.stringify(entrada)).toBe(esperado);
    // sin tope de largo (el dueño lo decide)
    expect(rutaLimpia('a'.repeat(300))).toHaveLength(300);
  });

  it('constructor.texto.slug_solo_letras_y_numeros_hasta_60_y_nunca_termina_en_guion', () => {
    const casos: [unknown, string][] = [
      ['Atención a clientes (v2)', 'atencion-a-clientes-v2'],
      ['Mi Flujo Ñandú!', 'mi-flujo-nandu'],
      ['Correo (SMTP)', 'correo-smtp'],
      ['', ''],
      ['---', ''],
      ['__proto__', 'proto'],
      ['constructor', 'constructor'],
      [undefined, ''],
    ];
    for (const [entrada, esperado] of casos) expect(slug(entrada), JSON.stringify(entrada)).toBe(esperado);
    expect(slug('a'.repeat(70))).toBe('a'.repeat(60));
    // el recorte puede caer justo en un guion: el mockup lo dejaba al final del nombre de archivo
    expect(slug(`${'a'.repeat(59)} b`)).toBe('a'.repeat(59));
    for (const t of ['x'.repeat(59) + ' y', 'ab cd '.repeat(30), '- '.repeat(40)]) {
      expect(slug(t).length).toBeLessThanOrEqual(60);
      expect(slug(t)).not.toMatch(/^-|-$/);
    }
  });
});

describe('frecTexto', () => {
  it('constructor.texto.frecuencia_en_texto_y_lo_desconocido_cae_en_cada_dia', () => {
    expect(frecTexto('hora')).toBe('Cada hora');
    expect(frecTexto('dia')).toBe('Cada día, 9:00');
    expect(frecTexto('lunes')).toBe('Cada lunes, 9:00');
    for (const raro of ['x', '', undefined, null, 3, '__proto__', 'constructor']) {
      expect(frecTexto(raro), String(raro)).toBe('Cada día, 9:00');
    }
    expect(esFrecuencia('hora')).toBe(true);
    expect(esFrecuencia('mes')).toBe(false);
    expect(esFrecuencia('__proto__')).toBe(false);
  });
});

describe('uuidDeterminista', () => {
  it('constructor.texto.uuid_determinista_da_siempre_lo_mismo_con_forma_de_v4', () => {
    // dos valores medidos en el mockup y presentes en casos.json: si cambian, el golden se rompe
    expect(uuidDeterminista(1)).toBe('6a99b44c-8a80-442b-8e6d-5c49206bc530');
    expect(uuidDeterminista(2)).toBe('08d12dfd-de04-4969-8efa-6f28f886b67c');
    expect(uuidDeterminista(3)).toBe('a708a7ae-3188-4ea6-8f87-8208c0a1a7c8');
    expect(uuidDeterminista(0)).toBe('cc623a9b-36fb-4eee-8de0-49695850d3e4');
    const vistos = new Set<string>();
    for (let i = 1; i <= 300; i += 1) {
      const u = uuidDeterminista(i);
      expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(uuidDeterminista(i)).toBe(u);
      vistos.add(u);
    }
    expect(vistos.size).toBe(300);
  });
});

describe('tituloDe', () => {
  it('constructor.texto.titulo_de_cada_cuadro_con_sus_nombres_por_defecto_y_el_disparador_raro_cae_en_chat', () => {
    const base = { id: 'n', x: 0, y: 0 };
    const disp = (tipo: string) => ({ ...base, kind: 'trigger', tipo, frec: 'dia', ruta: '', app: 'gmail' }) as Nodo;
    const agente = (nombre: string | undefined) =>
      ({ ...base, kind: 'agent', nombre, ia: 'openai', tarea: '', instrucciones: '' }) as Nodo;
    const app = (nombre: string | undefined) => ({ ...base, kind: 'app', nombre }) as Nodo;
    expect(tituloDe(disp('tiempo'))).toBe('Disparador Tiempo');
    expect(tituloDe(disp('chat'))).toBe('Disparador Chat');
    expect(tituloDe(disp('web'))).toBe('Disparador Web');
    expect(tituloDe(disp('app'))).toBe('Disparador App');
    expect(tituloDe(disp('zzz'))).toBe('Disparador Chat');
    expect(tituloDe(disp('__proto__'))).toBe('Disparador Chat');
    expect(tituloDe(agente('  Ana '))).toBe('Ana');
    expect(tituloDe(agente(''))).toBe('Agente');
    expect(tituloDe(agente(undefined))).toBe('Agente');
    expect(tituloDe(app(' Slack '))).toBe('Slack');
    expect(tituloDe(app('  '))).toBe('App sin nombre');
    expect(tituloDe(app(undefined))).toBe('App sin nombre');
    expect(tituloDe(null)).toBe('');
    expect(tituloDe(undefined)).toBe('');
  });
});

describe('tituloDe con una clave pegada', () => {
  it('constructor.texto.titulo_de_no_repite_un_nombre_que_parece_una_clave', () => {
    const clave = `${'s'}k-${'a'.repeat(24)}`;
    const base = { id: 'n', x: 0, y: 0 };
    const agente = (nombre: string) => ({ ...base, kind: 'agent', nombre, ia: 'openai', tarea: '', instrucciones: '' }) as Nodo;
    const app = (nombre: string) => ({ ...base, kind: 'app', nombre }) as Nodo;
    expect(tituloDe(app(clave))).toBe('App con clave pegada');
    expect(tituloDe(app(`  ${clave}  `))).toBe('App con clave pegada');
    expect(tituloDe(app(`mi llave ${clave}`))).toBe('App con clave pegada');
    expect(tituloDe(agente(clave))).toBe('Agente con clave pegada');
    for (const n of [app(clave), agente(clave)]) expect(tituloDe(n)).not.toContain('aaaa');
    // un nombre normal (también uno con «sk-» dentro de una palabra) se queda como está
    expect(tituloDe(app('task-management-system-webhook'))).toBe('task-management-system-webhook');
    expect(tituloDe(agente('Risk-assessment-for-the-quarter'))).toBe('Risk-assessment-for-the-quarter');
    expect(tituloDe(app('Slack'))).toBe('Slack');
  });
});

describe('recortar y esObjeto', () => {
  it('constructor.texto.recortar_corta_sin_dejar_la_mitad_de_un_emoji_y_limpia_un_sustituto_alto_final', () => {
    const emoji = '\u{1F600}';
    expect(recortar('hola', 10)).toBe('hola');
    expect(recortar('hola', 4)).toBe('hola');
    expect(recortar('hola', 2)).toBe('ho');
    expect(recortar('hola', 0)).toBe('');
    expect(recortar('', 5)).toBe('');
    // el corte cae en medio de un emoji: se quita la mitad
    expect(recortar(`ab${emoji}cd`, 3)).toBe('ab');
    expect(recortar(`ab${emoji}cd`, 4)).toBe(`ab${emoji}`);
    expect(recortar(`${emoji}${emoji}`, 3)).toBe(emoji);
    // un emoji entero al final se respeta
    expect(recortar(`ab${emoji}`, 4)).toBe(`ab${emoji}`);
    // un sustituto alto suelto al final se quita aunque el texto ya cupiera
    expect(recortar('ab\ud83d', 10)).toBe('ab');
    expect(recortar('\ud83d', 1)).toBe('');
    // el resultado siempre está bien formado y nunca pasa del tope
    for (let max = 0; max <= 6; max += 1) {
      for (const t of ['a', `a${emoji}`, `${emoji}b${emoji}`, `${emoji}${emoji}${emoji}`, 'ñandú', 'ab\ud83d']) {
        const r = recortar(t, max);
        expect(r.length, `${t} ${max}`).toBeLessThanOrEqual(max);
        expect(r, `${t} ${max}`).not.toMatch(/[\ud800-\udbff]$/);
        expect(t.startsWith(r) || r === '', `${t} ${max}`).toBe(true);
      }
    }
  });

  it('constructor.texto.es_objeto_acepta_los_objetos_y_rechaza_listas_null_y_lo_demas', () => {
    expect(esObjeto({})).toBe(true);
    expect(esObjeto({ a: 1 })).toBe(true);
    expect(esObjeto(Object.create(null))).toBe(true);
    for (const v of [null, undefined, [], [1], 'x', 3, true, () => 1]) expect(esObjeto(v), String(v)).toBe(false);
  });
});

describe('expresiones de n8n', () => {
  it('constructor.texto.literal_expr_escapa_comilla_barra_llaves_saltos_y_separadores_de_linea', () => {
    expect(literalExpr('')).toBe("''");
    expect(literalExpr('Atención a clientes (v2)')).toBe("'Atención a clientes (v2)'");
    expect(literalExpr('日本語 😀 ñ')).toBe("'日本語 😀 ñ'");
    expect(literalExpr("d'Ana {x} \\ \r\n \u2028 \u2029 ok")).toBe(
      "'d\\u0027Ana \\u007bx\\u007d \\u005c \\u000d\\u000a \\u2028 \\u2029 ok'",
    );
    // por dentro no queda nada que corte la expresión
    for (const t of ["a'b", '{{x}}', '}}', 'una\nlinea', 'tab\ty', 'barra \\ y \\\\ doble']) {
      const dentro = literalExpr(t).slice(1, -1);
      expect(literalExpr(t)).toMatch(/^'.*'$/s);
      expect(dentro).not.toMatch(/['{}\r\n\u2028\u2029]/);
      expect(dentro.replace(/\\u[0-9a-f]{4}/g, '')).not.toContain('\\');
    }
    expect(literalExpr(null)).toBe("'null'");
  });

  it('constructor.texto.expr_deia_y_salida_arman_las_expresiones_exactas', () => {
    expect(expr('$json.output')).toBe('={{ $json.output }}');
    expect(SALIDA).toBe('={{ $json.output }}');
    expect(deIA('Para', '')).toBe("={{ $fromAI('Para', '', 'string') }}");
    expect(deIA('Telefono', 'Número con código de país')).toBe(
      "={{ $fromAI('Telefono', 'Número con código de país', 'string') }}",
    );
    // una comilla en la descripción no rompe la expresión
    expect(deIA('Mensaje', "el texto de 'Ana'")).toBe(
      "={{ $fromAI('Mensaje', 'el texto de \\u0027Ana\\u0027', 'string') }}",
    );
  });

  it('constructor.texto.sin_igual_protege_solo_el_inicio', () => {
    const casos: [string, string][] = [
      ['', ''],
      ['hola', 'hola'],
      ['=hola', '==hola'],
      ['==x', '===x'],
      [' =x', ' =x'],
      ['a=b', 'a=b'],
      ['{{ x }}', '{{ x }}'],
    ];
    for (const [entrada, esperado] of casos) expect(sinIgual(entrada), entrada).toBe(esperado);
  });
});

describe('numeroLibre', () => {
  it('constructor.texto.numero_libre_es_el_primer_agente_k_que_no_esta_en_uso', () => {
    const agente = (nombre: string): Nodo => ({
      id: nombre,
      kind: 'agent',
      x: 0,
      y: 0,
      nombre,
      ia: 'openai',
      tarea: '',
      instrucciones: '',
    });
    const app = (nombre: string): Nodo => ({ id: nombre, kind: 'app', x: 0, y: 0, nombre });
    expect(numeroLibre([])).toBe(1);
    expect(numeroLibre([agente('Agente 1')])).toBe(2);
    expect(numeroLibre([agente('Agente 2')])).toBe(1);
    expect(numeroLibre([agente('Agente 1'), agente('Agente 2'), agente(' Agente 3 ')])).toBe(4);
    // solo cuentan los agentes
    expect(numeroLibre([app('Agente 1')])).toBe(1);
    // si se quita el 1 y quedan el 2 y el 3, el siguiente es el 1, no el 4
    expect(numeroLibre([agente('Agente 2'), agente('Agente 3')])).toBe(1);
  });
});

describe('nombreHerramientaSeguro', () => {
  it('constructor.texto.nombre_seguro_deja_solo_ascii_imprimible_y_vacio_es_herramienta', () => {
    const casos: [string, string][] = [
      ['Revisor', 'Revisor'],
      ['Crítico', 'Critico'],
      ['Ñandú', 'Nandu'],
      ['¡Hola, mundo!', 'Hola mundo'],
      ['  a   b  ', 'a b'],
      ['a_b-c', 'a_b-c'],
      ['a/b', 'a b'],
      ['AI Agent', 'AI Agent'],
      ['', 'Herramienta'],
      ['   ', 'Herramienta'],
      ['日本語', 'Herramienta'],
      ['😀', 'Herramienta'],
      ['(((', 'Herramienta'],
      ['__proto__', '__proto__'],
    ];
    for (const [entrada, esperado] of casos) expect(nombreHerramientaSeguro(entrada), entrada).toBe(esperado);
  });
});

describe('copiaJson', () => {
  it('constructor.texto.copia_json_no_comparte_referencias_y_conserva_el_orden_de_las_claves', () => {
    const original: ParametrosN8n = {
      z: 1,
      a: { __rl: true, mode: 'id', value: 'x', hondo: [1, { b: null }, 'c'] },
      m: [],
      t: 'texto',
    };
    const copia = copiaJson(original);
    expect(copia).toEqual(original);
    expect(JSON.stringify(copia)).toBe(JSON.stringify(original));
    expect(Object.keys(copia)).toEqual(['z', 'a', 'm', 't']);
    expect(copia).not.toBe(original);
    expect(copia['a']).not.toBe(original['a']);
    expect(copia['m']).not.toBe(original['m']);
    // cambiar la copia no toca el original
    const a = copia['a'] as { hondo: unknown[]; value: string };
    a.hondo.push('nuevo');
    a.value = 'otro';
    expect((original['a'] as { value: string }).value).toBe('x');
    expect((original['a'] as { hondo: unknown[] }).hondo).toHaveLength(3);
    // lo que no es objeto vuelve tal cual
    expect(copiaJson('x')).toBe('x');
    expect(copiaJson(3)).toBe(3);
    expect(copiaJson(null)).toBeNull();
    expect(copiaJson(false)).toBe(false);
  });

  it('constructor.texto.copia_json_conserva_una_clave_proto_propia_sin_cambiar_el_prototipo_de_la_copia', () => {
    // JSON.parse crea `__proto__` como propiedad PROPIA; asignarla con `salida[k] = …` la perdería y cambiaría el prototipo
    const original = JSON.parse('{"__proto__":{"a":1},"b":2,"hondo":{"__proto__":{"c":3}}}') as ParametrosN8n;
    expect(Object.keys(original)).toEqual(['__proto__', 'b', 'hondo']);
    const copia = copiaJson(original);
    expect(Object.keys(copia)).toEqual(['__proto__', 'b', 'hondo']);
    expect(Object.getOwnPropertyDescriptor(copia, '__proto__')?.value).toEqual({ a: 1 });
    expect(JSON.stringify(copia)).toBe(JSON.stringify(original));
    // y el prototipo de la copia no cambió: no hereda `a`
    expect(Object.getPrototypeOf(copia)).toBe(Object.prototype);
    expect((copia as { a?: unknown }).a).toBeUndefined();
    const hondo = copia['hondo'] as object;
    expect(Object.getPrototypeOf(hondo)).toBe(Object.prototype);
    expect((hondo as { c?: unknown }).c).toBeUndefined();
    expect(Object.keys(hondo)).toEqual(['__proto__']);
    // y no contamina nada
    expect(({} as { a?: unknown }).a).toBeUndefined();
  });
});
