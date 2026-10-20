// Pruebas del exportador a n8n (exportar.ts). Cada diferencia deliberada respecto del mockup tiene aquí
// su prueba con el nombre de lo que cambió (golden/LEEME.md las lista). El porte contra el mockup y el
// golden de producción están en exportar.golden.test.ts.

import { describe, expect, it, vi } from 'vitest';

import { APPS, IAS, iaDe } from './catalogo';
import {
  claveEnFlujo,
  construirFlujo,
  construirN8n,
  revisarFlujo,
  uuidDeTexto,
  zonaLocal,
  type FlujoN8n,
  type NodoN8n,
  type OpcionesExportar,
} from './exportar';
import { ag, arista, base, casosGolden, conversan, disp, nodoAgente, nodoApp } from './golden/casos';
import { expresionesDelFlujo, violacionesDelFlujo } from './golden/invariantes';
import { uuidDeterminista } from './texto';
import type { Flujo, Nodo } from './tipos';

// ---------------------------------------------------------------- ayudas

/** Exporta un flujo que debe estar bien y devuelve el archivo (con la zona «UTC», salvo que se diga otra o `{}`). */
function exportado(st: Flujo, opciones: OpcionesExportar = { zona: 'UTC' }): FlujoN8n {
  const r = construirFlujo(st, opciones);
  expect(r.errores).toEqual([]);
  if (!r.flujo) throw new Error('el flujo debía exportarse');
  return r.flujo;
}

function nodoN8n(f: FlujoN8n, nombre: string): NodoN8n {
  const n = f.nodes.find(x => x.name === nombre);
  if (!n) throw new Error(`no hay nodo «${nombre}»: ${f.nodes.map(x => x.name).join(', ')}`);
  return n;
}

/** El flujo con otros ids de cuadro (`mapa`: id viejo → id nuevo), para probar ids con nombres de prototipo. */
function conIds(st: Flujo, mapa: Record<string, string>): Flujo {
  const nuevo = (id: string) => (Object.hasOwn(mapa, id) ? (mapa[id] as string) : id);
  return {
    nodes: st.nodes.map((n): Nodo => ({ ...n, id: nuevo(n.id) })),
    edges: st.edges.map(e => ({ ...e, de: nuevo(e.de), a: nuevo(e.a) })),
    nombreFlujo: st.nombreFlujo,
  };
}

/** Todo objeto o lista del archivo que aparece dos veces (dos nodos que comparten una referencia). */
function referenciasCompartidas(valor: unknown, vistos = new Set<object>(), ruta = '$'): string[] {
  if (valor === null || typeof valor !== 'object') return [];
  if (vistos.has(valor)) return [ruta];
  vistos.add(valor);
  return Object.entries(valor).flatMap(([k, v]) => referenciasCompartidas(v, vistos, `${ruta}.${k}`));
}

/** El texto de una expresión de n8n sin lo que va entre comillas simples (con escapes): lo que queda es código. */
const sinLiterales = (texto: string): string => texto.replace(/'(?:[^'\\]|\\.)*'/g, "''");

/** Los cuerpos de código de una expresión: lo que va entre `{{` y `}}`, sin sus textos entre comillas. */
function codigoDe(expresion: string): string[] {
  return [...expresion.matchAll(/\{\{([\s\S]*?)\}\}/g)].map(m => sinLiterales(m[1] ?? ''));
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SECRETO = 'SECRETO_INYECTADO';
/** Textos que intentan abrir una expresión o salirse de una comilla. Todos llevan la marca. */
const HOSTILES = [
  `{{ $env.${SECRETO} }}`,
  `={{ $env.${SECRETO} }}`,
  `=${SECRETO}`,
  `'); $env.${SECRETO}; ('`,
  `}} $env.${SECRETO} {{`,
  `\\' $env.${SECRETO}`,
  `a\n={{ ${SECRETO} }}`,
  `\u2028{{${SECRETO}}}`,
];

// Muestras de cada forma de clave que el repo conoce (las 8 de pipeline/validador.py:SECRETOS).
const CLAVES: Record<string, string> = {
  openai: `sk-${'a'.repeat(24)}`,
  google: `AIza${'a'.repeat(35)}`,
  slack: 'xoxb-1234567890',
  github: `ghp_${'a'.repeat(36)}`,
  telegram: `123456789:${'A'.repeat(35)}`,
  bearer: `Bearer ${'a'.repeat(24)}`,
  pem: '-----BEGIN PRIVATE KEY-----',
  aws: `AKIA${'A'.repeat(16)}`,
};

// ---------------------------------------------------------------- errores y avisos

describe('revisión: errores y avisos', () => {
  it('constructor.exportar.los_errores_salen_en_el_orden_del_mockup_con_sus_textos_y_sin_repetirse', () => {
    // sin disparador
    const sin = base();
    sin.nodes = sin.nodes.filter(n => n.kind !== 'trigger');
    sin.edges = sin.edges.filter(e => e.de !== 't1');
    expect(revisarFlujo(sin).errores).toEqual(['Falta un disparador: dile al flujo cuándo arrancar.']);

    // todos los demás, en su orden: primer paso, ruta, agentes, apps, claves, nombre del flujo
    const mal = base();
    Object.assign(disp(mal), { tipo: 'web', ruta: '###' });
    mal.edges = mal.edges.filter(e => e.de !== 't1');
    nodoApp(mal, 'p6', ' ');
    nodoApp(mal, 'p7', '');
    ag(mal, 'a2').instrucciones = CLAVES.openai as string;
    mal.nombreFlujo = CLAVES.google as string;
    expect(revisarFlujo(mal).errores).toEqual([
      'Toca el + junto al disparador para agregar el primer paso.',
      'El disparador web necesita una ruta para su enlace.',
      'Una app no tiene nombre: ponle uno, por ejemplo Gmail.',
      'Parece que pegaste una clave en «Revisor». Quítala: las claves se ponen en n8n al conectar la cuenta, nunca dentro del archivo.',
      'Parece que pegaste una clave en el nombre del flujo. Quítala.',
    ]);

    // la tarea que falta, el ayudante sin descripción, y los que se repiten se dicen una vez
    const tareas = base();
    Object.assign(disp(tareas), { tipo: 'tiempo' });
    nodoAgente(tareas, 'a3', 'Revisor');
    arista(tareas, 't1', 'a3', 'seq');
    expect(revisarFlujo(tareas).errores).toEqual(['Dile a «Atención a clientes» qué debe hacer cada vez que se dispare.', 'Dile a «Revisor» qué debe hacer cada vez que se dispare.']);
    const dosIguales = base();
    Object.assign(disp(dosIguales), { tipo: 'tiempo' });
    ag(dosIguales, 'a2').nombre = 'Atención a clientes';
    arista(dosIguales, 't1', 'a2', 'seq');
    expect(revisarFlujo(dosIguales).errores).toEqual(['Dile a «Atención a clientes» qué debe hacer cada vez que se dispare.']);
    const ayudante = base();
    conversan(ayudante, 'a1', 'a2');
    ag(ayudante, 'a2').desc = '  ';
    expect(revisarFlujo(ayudante).errores).toEqual(['Dile a «Revisor» para qué le sirve a «Atención a clientes» cuando conversan.']);
  });

  it('constructor.exportar.los_avisos_salen_en_el_orden_del_mockup_con_sus_textos', () => {
    const st = base();
    nodoApp(st, 'p8', 'HubSpot');
    nodoApp(st, 'p9', 'Notion');
    arista(st, 'a1', 'p8', 'seq');
    arista(st, 'a2', 'p8', 'seq');
    expect(revisarFlujo(st).errores).toEqual([]);
    expect(revisarFlujo(st).avisos).toEqual([
      '«HubSpot» no trae un conector listo en n8n: tendrás que configurar esa conexión tú dentro de n8n.',
      '«HubSpot» recibe de 2 cuadros: n8n lo ejecutará una vez por cada uno, no los junta. Para juntarlos usa un nodo Merge en n8n.',
      '«Notion» no está conectado a nada: n8n lo dejará suelto.',
      'Al abrir «Google Sheets» en n8n tendrás que conectar tu cuenta y elegir el documento y la hoja.',
      'Al abrir «Slack» en n8n tendrás que conectar tu cuenta y elegir el canal.',
      'Al abrir «Notion» en n8n tendrás que conectar tu cuenta y elegir la página y el título.',
      'El chat quedará público: cualquiera con el enlace podrá escribirle (y gastar tu llave de IA).',
    ]);
    // sin agentes
    const sinAgentes = base();
    sinAgentes.nodes = sinAgentes.nodes.filter(n => n.kind !== 'agent');
    sinAgentes.edges = [];
    arista(sinAgentes, 't1', 'p2', 'seq');
    expect(revisarFlujo(sinAgentes).avisos[0]).toBe('Tu flujo no tiene agente de IA: solo hará lo que digan las apps.');
  });

  it('constructor.exportar.recibe_de_n_cuadros_cuenta_agentes_distintos_y_no_la_conexion_del_agente_y_la_de_su_ayudante', () => {
    const st = base();
    conversan(st, 'a1', 'a2'); // a2 conversa con a1: es su ayudante
    nodoApp(st, 'g', 'Gmail');
    arista(st, 'a1', 'g', 'seq');
    arista(st, 'a2', 'g', 'seq'); // lo que sigue al ayudante sale del agente principal: es la MISMA entrada
    const f = exportado(st);
    expect(revisarFlujo(st).avisos.filter(a => a.includes('recibe de'))).toEqual([]);
    expect(f.connections['Atención a clientes']?.main?.[0]).toEqual([{ node: 'Gmail', type: 'main', index: 0 }]);
    // pero dos agentes distintos sí son dos entradas
    const dos = base();
    nodoApp(dos, 'g', 'Gmail');
    arista(dos, 'a1', 'g', 'seq');
    arista(dos, 'a2', 'g', 'seq');
    expect(revisarFlujo(dos).avisos).toContain('«Gmail» recibe de 2 cuadros: n8n lo ejecutará una vez por cada uno, no los junta. Para juntarlos usa un nodo Merge en n8n.');
  });

  it('constructor.exportar.revisar_flujo_no_serializa_ni_arma_nada_y_construir_si', () => {
    const st = base();
    const stringify = vi.spyOn(JSON, 'stringify');
    const params = [...IAS.map(ia => vi.spyOn(ia, 'params')), ...APPS.flatMap(a => [vi.spyOn(a, 'paramsPaso'), vi.spyOn(a, 'paramsHerramienta')])];
    revisarFlujo(st);
    revisarFlujo({ ...st, nombreFlujo: CLAVES.openai as string });
    expect(stringify).not.toHaveBeenCalled();
    expect(params.every(p => p.mock.calls.length === 0)).toBe(true);
    // armar el archivo sí pide los parámetros, y el texto del archivo sí serializa
    construirN8n(st);
    expect(params.some(p => p.mock.calls.length > 0)).toBe(true);
    expect(stringify).toHaveBeenCalled();
    stringify.mockClear();
    construirFlujo(st);
    expect(stringify).toHaveBeenCalled();
  });

  it('constructor.exportar.el_flujo_es_nulo_si_y_solo_si_hay_errores_y_el_json_vuelve_al_mismo_objeto', () => {
    let buenos = 0;
    for (const c of casosGolden()) {
      const r = construirFlujo(c.flujo, { zona: 'UTC' });
      expect(r.flujo === null, c.nombre).toBe(r.errores.length > 0);
      if (r.flujo) {
        buenos += 1;
        expect(JSON.parse(r.json), c.nombre).toEqual(r.flujo);
        expect(r.json, c.nombre).toBe(JSON.stringify(r.flujo, null, 2));
        expect(construirN8n(c.flujo, { zona: 'UTC' }), c.nombre).toEqual(r.flujo);
      } else {
        expect(r.json).toBe('');
        expect(() => construirN8n(c.flujo)).toThrow(r.errores[0] as string);
      }
    }
    expect(buenos).toBe(34);
  });
});

// ---------------------------------------------------------------- determinismo y zona

describe('determinismo y zona horaria', () => {
  it('constructor.exportar.es_puro_y_deterministico_sin_azar_reloj_ni_intl_y_los_ids_son_los_del_contador', () => {
    const azar = vi.spyOn(Math, 'random');
    const ahora = vi.spyOn(Date, 'now');
    const uuid = vi.spyOn(globalThis.crypto, 'randomUUID');
    const intl = vi.spyOn(Intl, 'DateTimeFormat');
    const primera = casosGolden().map(c => construirFlujo(c.flujo).json);
    const segunda = casosGolden().map(c => construirFlujo(c.flujo).json);
    expect(segunda).toEqual(primera);
    expect(azar).not.toHaveBeenCalled();
    expect(ahora).not.toHaveBeenCalled();
    expect(uuid).not.toHaveBeenCalled();
    expect(intl).not.toHaveBeenCalled();
    // el ejemplo: el webhookId gasta el 1, luego van el id del disparador (2), el del primer agente (3), su modelo (4)…
    const f = exportado(base());
    expect(f.nodes.map(n => n.id)).toEqual([2, 3, 4, 5, 6, 7, 8].map(i => uuidDeterminista(i)));
    expect(f.nodes.map(n => n.name)).toEqual(['When chat message received', 'Atención a clientes', 'OpenAI Chat Model', 'Revisor', 'Anthropic Chat Model', 'Google Sheets', 'Slack']);
  });

  it('constructor.exportar.la_zona_se_inyecta_solo_la_usa_el_disparador_de_tiempo_y_una_zona_sin_forma_se_ignora', () => {
    const tiempo = base();
    Object.assign(disp(tiempo), { tipo: 'tiempo' });
    ag(tiempo, 'a1').tarea = 'Resume.';
    expect(exportado(tiempo, { zona: 'America/Mexico_City' }).settings).toEqual({ executionOrder: 'v1', timezone: 'America/Mexico_City' });
    expect(exportado(tiempo, { zona: 'Etc/GMT+5' }).settings.timezone).toBe('Etc/GMT+5');
    // sin zona, o con algo que no es una zona, no hay timezone (y nada revienta)
    expect(exportado(tiempo, {}).settings).toEqual({ executionOrder: 'v1' });
    expect(exportado(tiempo, { zona: undefined }).settings).toEqual({ executionOrder: 'v1' });
    expect(construirFlujo(tiempo).flujo?.settings).toEqual({ executionOrder: 'v1' });
    for (const mala of ['', 'no es zona', '../etc/passwd', '{{ $env.X }}', 'x'.repeat(100), '1UTC']) {
      expect(exportado(tiempo, { zona: mala }).settings, mala).toEqual({ executionOrder: 'v1' });
    }
    // un chat no lleva zona aunque se la den
    expect(exportado(base()).settings).toEqual({ executionOrder: 'v1' });
    // el orden de las claves del archivo: name, nodes, connections, settings, pinData
    expect(Object.keys(exportado(tiempo))).toEqual(['name', 'nodes', 'connections', 'settings', 'pinData']);
  });
  it('constructor.exportar.zona_local_lee_la_del_navegador_solo_cuando_se_le_pide', () => {
    const intl = vi.spyOn(Intl, 'DateTimeFormat');
    expect(intl).not.toHaveBeenCalled();
    const z = zonaLocal();
    expect(intl).toHaveBeenCalled();
    expect(z === undefined || (typeof z === 'string' && z.length > 0)).toBe(true);
    intl.mockImplementation(() => {
      throw new Error('sin Intl');
    });
    expect(zonaLocal()).toBeUndefined();
  });
});

// ---------------------------------------------------------------- nombres, referencias, webhookId

describe('las correcciones al mockup', () => {
  it('constructor.exportar.los_nombres_de_nodo_son_unicos_con_set_y_constructor_tostring_o_proto_no_dan_un_sufijo_espurio', () => {
    const st = base();
    Object.assign(disp(st), { tipo: 'chat' });
    for (const [i, nombre] of ['constructor', 'toString', 'hasOwnProperty', 'valueOf'].entries()) {
      nodoAgente(st, `a${10 + i}`, nombre);
      arista(st, 'a1', `a${10 + i}`, 'seq');
    }
    nodoApp(st, 'p20', 'constructor');
    arista(st, 'a10', 'p20', 'seq');
    const f = exportado(st);
    const nombres = f.nodes.map(n => n.name);
    for (const n of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) expect(nombres.filter(x => x === n || x === `${n} 2`)).toEqual(n === 'constructor' ? [n, `${n} 2`] : [n]);
    expect(new Set(nombres).size).toBe(nombres.length);
    // las conexiones de un nodo llamado «constructor» están donde deben (con un objeto simple se perdían)
    expect(Object.hasOwn(f.connections, 'constructor')).toBe(true);
    expect(f.connections['constructor']?.main?.[0]).toEqual([{ node: 'constructor 2', type: 'main', index: 0 }]);
    expect(violacionesDelFlujo(f)).toEqual([]);
    // lo repetido sí lleva 2, 3…
    const rep = base();
    for (let i = 0; i < 3; i += 1) {
      nodoAgente(rep, `a${10 + i}`, 'Repe');
      arista(rep, 'a1', `a${10 + i}`, 'seq');
    }
    expect(exportado(rep).nodes.filter(n => n.name.startsWith('Repe')).map(n => n.name)).toEqual(['Repe', 'Repe 2', 'Repe 3']);
  });

  it('constructor.exportar.un_cuadro_llamado___proto___no_sale_con_ese_nombre_ni_contamina_ningun_prototipo', () => {
    const antes = Object.getOwnPropertyNames(Object.prototype).sort();
    const st = base();
    nodoAgente(st, 'a3', '__proto__');
    arista(st, 'a1', 'a3', 'seq');
    nodoApp(st, 'p3', '__proto__');
    arista(st, 'a3', 'p3', 'seq');
    const r = construirFlujo(st, { zona: 'UTC' });
    expect(r.errores).toEqual([]);
    const f = r.flujo as FlujoN8n;
    expect(f.nodes.map(n => n.name)).toContain('__proto__ 2');
    expect(f.nodes.map(n => n.name)).toContain('__proto__ 3');
    expect(f.nodes.map(n => n.name)).not.toContain('__proto__');
    expect(r.json).not.toMatch(/"__proto__"\s*:/);
    expect(Object.getPrototypeOf(f.connections)).toBe(Object.prototype);
    expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(antes);
    expect(Object.hasOwn(Object, 'main')).toBe(false);
    expect(({} as Record<string, unknown>).main).toBeUndefined();
    expect(violacionesDelFlujo(f)).toEqual([]);
  });

  it('constructor.exportar.los_ids_de_cuadro_con_nombres_de_prototipo_no_cambian_el_archivo', () => {
    const normal = construirFlujo(base(), { zona: 'UTC' }).json;
    const raros = conIds(base(), { a1: 'constructor', a2: '__proto__', p1: 'toString', p2: 'hasOwnProperty', t1: 'valueOf' });
    expect(construirFlujo(raros, { zona: 'UTC' }).json).toBe(normal);
  });

  it('constructor.exportar.los_parametros_no_se_comparten_ni_entre_nodos_ni_con_el_catalogo', () => {
    // dentro de un archivo, ninguna lista ni objeto aparece dos veces
    for (const c of casosGolden()) {
      const f = construirFlujo(c.flujo, { zona: 'UTC' }).flujo;
      if (f) expect(referenciasCompartidas(f), c.nombre).toEqual([]);
    }
    // y cambiar lo exportado no cambia lo que sale la próxima vez ni el catálogo
    const st = base();
    const primera = construirFlujo(st, { zona: 'UTC' });
    const f = primera.flujo as FlujoN8n;
    for (const n of f.nodes) {
      n.parameters.contaminado = true;
      const opciones = n.parameters.options;
      if (opciones && typeof opciones === 'object' && !Array.isArray(opciones)) opciones.contaminado = true;
      if (n.credentials) for (const cred of Object.values(n.credentials)) cred.name = 'otra';
      n.position.push(0);
    }
    f.settings.executionOrder = 'v1';
    expect(construirFlujo(st, { zona: 'UTC' }).json).toBe(primera.json);
    expect(iaDe('openai').params()).toEqual({ model: { __rl: true, mode: 'id', value: 'gpt-5.4-mini' }, options: {} });
    expect(JSON.stringify(APPS.map(a => [a.paramsPaso(), a.paramsHerramienta()]))).not.toContain('contaminado');
  });

  it('constructor.exportar.aunque_el_catalogo_entregara_siempre_el_mismo_objeto_lo_exportado_no_lo_comparte', () => {
    // el defecto del mockup: `parameters` era el MISMO objeto del catálogo. Aquí el catálogo lo vuelve a hacer a propósito…
    const compartido = { model: { __rl: true, mode: 'id', value: 'gpt-5.4-mini' }, options: { anidado: { lista: [1, 2] } } };
    vi.spyOn(iaDe('openai'), 'params').mockReturnValue(compartido);
    const compartidoDeApp = { select: 'channel', otherOptions: { includeLinkToWorkflow: false } };
    for (const a of APPS) vi.spyOn(a, 'paramsHerramienta').mockReturnValue(compartidoDeApp);
    const st = base();
    ag(st, 'a2').ia = 'openai';
    const f = exportado(st);
    const modelos = f.nodes.filter(n => n.type.endsWith('lmChatOpenAi'));
    expect(modelos).toHaveLength(2);
    // …y aun así los dos modelos y las dos herramientas son objetos distintos y distintos del catálogo
    expect(modelos[0]?.parameters).not.toBe(compartido);
    expect(modelos[0]?.parameters).not.toBe(modelos[1]?.parameters);
    expect(modelos[0]?.parameters.options).not.toBe(modelos[1]?.parameters.options);
    expect(nodoN8n(f, 'Slack').parameters).not.toBe(nodoN8n(f, 'Google Sheets').parameters);
    expect(nodoN8n(f, 'Slack').parameters).not.toBe(compartidoDeApp);
    expect(referenciasCompartidas(f)).toEqual([]);
    ((modelos[0]?.parameters.options as { anidado: { lista: number[] } }).anidado.lista).push(3);
    expect(compartido.options.anidado.lista).toEqual([1, 2]);
    expect(modelos[1]?.parameters.options).toEqual({ anidado: { lista: [1, 2] } });
  });

  it('constructor.exportar.el_webhook_id_depende_del_flujo_es_estable_y_con_forma_de_uuid_v4', () => {
    const chat = base();
    const a = exportado(chat).nodes[0]?.webhookId as string;
    expect(a).toMatch(UUID_V4);
    // el del mockup era siempre este, en todos los flujos
    expect(a).not.toBe('6a99b44c-8a80-442b-8e6d-5c49206bc530');
    // el mismo flujo, el mismo id; no depende de la zona ni de en qué parte de la lista se agregó el disparador
    expect(exportado(base()).nodes[0]?.webhookId).toBe(a);
    expect(exportado(base(), {}).nodes[0]?.webhookId).toBe(a);
    expect(exportado(base(), { zona: 'America/Bogota' }).nodes[0]?.webhookId).toBe(a);
    const alFinal = base();
    alFinal.nodes.push(alFinal.nodes.shift() as Nodo);
    expect(exportado(alFinal).nodes[0]?.webhookId).toBe(a);
    // flujos distintos, ids distintos: el nombre, un texto, una IA, una conexión, el tipo de disparador
    const otros: Flujo[] = [];
    const nombre = base();
    nombre.nombreFlujo = 'Otro nombre';
    otros.push(nombre);
    const texto = base();
    ag(texto, 'a1').instrucciones += ' Sé breve.';
    otros.push(texto);
    const ia = base();
    ag(ia, 'a1').ia = 'gemini';
    otros.push(ia);
    const conexion = base();
    nodoApp(conexion, 'p9', 'Notion');
    arista(conexion, 'a1', 'p9', 'tool');
    otros.push(conexion);
    const web = base();
    Object.assign(disp(web), { tipo: 'web', ruta: 'x' });
    ag(web, 'a1').tarea = 'Hola.';
    otros.push(web);
    const ids = new Set([a, ...otros.map(o => exportado(o).nodes[0]?.webhookId)]);
    expect(ids.size).toBe(otros.length + 1);
    // un disparador sin webhook (tiempo, app) no lo lleva
    const tiempo = base();
    Object.assign(disp(tiempo), { tipo: 'tiempo' });
    ag(tiempo, 'a1').tarea = 'Resume.';
    expect(exportado(tiempo).nodes.some(n => n.webhookId !== undefined)).toBe(false);
    // el id del nodo no es el webhookId, y los ids de los demás nodos siguen siendo los del contador
    const f = exportado(chat);
    expect(f.nodes[0]?.id).toBe(uuidDeterminista(2));
    expect(f.nodes[0]?.id).not.toBe(a);
  });
  it('constructor.exportar.uuid_de_texto_da_uuid_v4_estables_y_distintos_para_textos_distintos', () => {
    expect(uuidDeTexto('hola')).toBe(uuidDeTexto('hola'));
    expect(uuidDeTexto('hola')).not.toBe(uuidDeTexto('hola '));
    expect(uuidDeTexto('')).toMatch(UUID_V4);
    const vistos = new Set<string>();
    for (let i = 0; i < 5000; i += 1) {
      const u = uuidDeTexto(`flujo ${i}`);
      expect(u).toMatch(UUID_V4);
      vistos.add(u);
    }
    expect(vistos.size).toBe(5000);
  });

  it('constructor.exportar.un_agente_suelto_sin_tarea_no_manda_prompt_type_ni_texto_vacio', () => {
    const st = base();
    st.edges = st.edges.filter(e => e.id !== 'e2'); // «Revisor» queda sin entrada
    const f = exportado(st);
    const revisor = nodoN8n(f, 'Revisor');
    expect(revisor.parameters).toEqual({ options: { systemMessage: ag(st, 'a2').instrucciones } });
    expect(Object.hasOwn(revisor.parameters, 'promptType')).toBe(false);
    expect(Object.hasOwn(revisor.parameters, 'text')).toBe(false);
    expect(revisarFlujo(st).avisos).toContain('«Revisor» no está conectado a nada: n8n lo dejará suelto.');
    // ningún agente de ningún caso sale con `text` vacío
    for (const c of casosGolden()) {
      for (const n of construirFlujo(c.flujo).flujo?.nodes ?? []) expect(n.parameters.text, `${c.nombre}/${n.name}`).not.toBe('');
    }
    // con tarea, el texto es la tarea (sin entrada que agregar)
    ag(st, 'a2').tarea = 'Revisa esto.';
    expect(nodoN8n(exportado(st), 'Revisor').parameters).toMatchObject({ promptType: 'define', text: 'Revisa esto.' });
  });

  it('constructor.exportar.el_disparador_va_primero_en_el_archivo_aunque_se_haya_agregado_al_final', () => {
    const normal = construirFlujo(base(), { zona: 'UTC' }).json;
    const alFinal = base();
    const t1 = alFinal.nodes.shift() as Nodo;
    alFinal.nodes.push(t1);
    expect(alFinal.nodes[alFinal.nodes.length - 1]?.kind).toBe('trigger');
    const f = exportado(alFinal);
    expect(f.nodes[0]?.name).toBe('When chat message received');
    // el archivo es el mismo que con el disparador primero
    expect(JSON.stringify(f, null, 2)).toBe(normal);
    // y un cuadro que se llama como el disparador no se lo quita
    const choque = base();
    nodoApp(choque, 'p5', 'Webhook');
    choque.nodes.unshift(choque.nodes.pop() as Nodo);
    Object.assign(disp(choque), { tipo: 'web', ruta: 'x' });
    ag(choque, 'a1').tarea = 'Hola.';
    arista(choque, 'a2', 'p5', 'seq');
    expect(exportado(choque).nodes.slice(0, 1).map(n => n.name)).toEqual(['Webhook']);
    expect(exportado(choque).nodes.some(n => n.name === 'Webhook 2')).toBe(true);
  });

  it('constructor.exportar.las_conexiones_main_no_se_pierden_cuando_los_nombres_llevan_el_signo_mayor_que', () => {
    const st = base();
    st.nodes = st.nodes.filter(n => n.kind === 'trigger');
    st.edges = [];
    nodoAgente(st, 'a1', 'x>y');
    nodoAgente(st, 'a2', 'x');
    nodoApp(st, 'p1', 'z');
    nodoApp(st, 'p2', 'y>z');
    arista(st, 't1', 'a1', 'seq');
    arista(st, 't1', 'a2', 'seq');
    arista(st, 'a1', 'p1', 'seq');
    arista(st, 'a2', 'p2', 'seq');
    const f = exportado(st);
    // con la clave «origen>destino» del mockup, «x>y» + «z» y «x» + «y>z» eran la misma y se perdía una
    expect(f.connections['x>y']?.main?.[0]).toEqual([{ node: 'z', type: 'main', index: 0 }]);
    expect(f.connections['x']?.main?.[0]).toEqual([{ node: 'y>z', type: 'main', index: 0 }]);
    expect(violacionesDelFlujo(f)).toEqual([]);
  });

  it('constructor.exportar.un_nombre_largo_se_recorta_a_100_sin_partir_un_emoji_y_una_posicion_invalida_sale_en_cero', () => {
    const st = base();
    ag(st, 'a1').nombre = `${'x'.repeat(99)}😀 fin`;
    ag(st, 'a2').nombre = 'y'.repeat(150);
    const f = exportado(st);
    for (const n of f.nodes) {
      expect(n.name.length, n.name).toBeLessThanOrEqual(100);
      expect(n.name, n.name).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
    }
    expect(f.nodes[1]?.name).toBe('x'.repeat(99));
    expect(f.nodes[3]?.name).toBe('y'.repeat(100));
    const nan = base();
    ag(nan, 'a1').x = Number.NaN;
    ag(nan, 'a2').y = Number.POSITIVE_INFINITY;
    const g = exportado(nan);
    expect(nodoN8n(g, 'Atención a clientes').position).toEqual([0, 180]);
    expect(nodoN8n(g, 'Revisor').position).toEqual([616, 0]);
    expect(violacionesDelFlujo(g)).toEqual([]);
  });
});

// ---------------------------------------------------------------- seguridad

describe('seguridad del exportador', () => {
  it('constructor.exportar.un_texto_que_empieza_con_igual_no_se_vuelve_expresion_ni_con_llaves_dobles_dentro', () => {
    const st = base();
    Object.assign(disp(st), { tipo: 'web', ruta: 'x' });
    const a1 = ag(st, 'a1');
    a1.instrucciones = '={{ $env.X }}';
    a1.tarea = '=hazlo';
    conversan(st, 'a1', 'a2');
    const a2 = ag(st, 'a2');
    a2.instrucciones = '= otra';
    a2.desc = '=={{ $env.X }} y {{ $env.Y }}';
    const f = exportado(st);
    // el «=» que n8n se comería se compensa con otro, y las llaves de un texto así se quitan: de lo contrario el
    // «=» de más sería la marca de expresión y `{{ $env.X }}` se EVALUARÍA
    expect(nodoN8n(f, 'Atención a clientes').parameters).toEqual({
      promptType: 'define',
      text: '==hazlo\n\n{{ JSON.stringify($json.body) }}',
      options: { systemMessage: '== $env.X' },
    });
    expect(nodoN8n(f, 'Revisor').parameters).toMatchObject({ toolDescription: '=== $env.X  y  $env.Y', options: { systemMessage: '== otra' } });
    for (const e of expresionesDelFlujo(f)) expect(codigoDe(e.texto).join('\n'), e.texto).not.toMatch(/\$env/);
    // sin entrada (agente suelto) la tarea pasa por sinIgual
    const suelto = base();
    suelto.edges = suelto.edges.filter(e => e.id !== 'e2');
    ag(suelto, 'a2').tarea = '=Revisa';
    expect(nodoN8n(exportado(suelto), 'Revisor').parameters.text).toBe('==Revisa');
    // lo que no empieza con «=» queda tal cual, llaves incluidas: n8n no evalúa un valor que no empieza con «=»
    const llaves = base();
    ag(llaves, 'a1').instrucciones = 'Responde con {{ $json.x }} y {nombre}. Usa a = b.';
    const sm = nodoN8n(exportado(llaves), 'Atención a clientes').parameters.options as { systemMessage: string };
    expect(sm.systemMessage).toBe('Responde con {{ $json.x }} y {nombre}. Usa a = b.');
    // los espacios de los extremos se quitan antes de mirar el primer carácter
    const espacios = base();
    ag(espacios, 'a1').instrucciones = '   ={{ $env.X }}  ';
    expect((nodoN8n(exportado(espacios), 'Atención a clientes').parameters.options as { systemMessage: string }).systemMessage).toBe('== $env.X');
  });
  it('constructor.exportar.ninguna_llave_doble_ni_comilla_del_usuario_llega_al_codigo_de_una_expresion', () => {
    for (const [i, hostil] of HOSTILES.entries()) {
      // el texto hostil en TODOS los campos libres: nombre del flujo, de agentes y de apps, tarea, descripción, instrucciones, ruta
      const st: Flujo = base();
      st.nodes = st.nodes.filter(n => n.kind === 'trigger');
      st.edges = [];
      Object.assign(disp(st), { tipo: 'app', app: 'gmail', ruta: hostil });
      st.nombreFlujo = hostil;
      nodoAgente(st, 'a1', hostil, { tarea: hostil, instrucciones: hostil, desc: hostil });
      nodoAgente(st, 'a2', `${hostil} 2`, { tarea: hostil, instrucciones: hostil, desc: hostil });
      nodoApp(st, 'p1', 'Gmail');
      nodoApp(st, 'p2', 'Slack');
      nodoApp(st, 'p3', `${hostil} app`);
      nodoApp(st, 'p4', hostil);
      arista(st, 't1', 'a1', 'seq');
      arista(st, 'a1', 'p1', 'seq'); // Gmail después de un agente
      arista(st, 'p1', 'p2', 'seq'); // y un paso más: cita al agente con $('…')
      arista(st, 'p2', 'p3', 'seq'); // una app desconocida de paso
      arista(st, 'a1', 'a2', 'tool'); // un ayudante
      arista(st, 'a2', 'p4', 'tool'); // y su herramienta desconocida
      const r = construirFlujo(st, { zona: 'UTC' });
      const f = r.flujo as FlujoN8n;
      expect(r.errores, `texto ${i}`).toEqual([]);
      expect(f, `texto ${i}`).not.toBeNull();
      // 1) lo que n8n evalúa (lo que va entre «{{» y «}}») es del exportador: nada del usuario, ni siquiera entre comillas…
      const expresiones = expresionesDelFlujo(f);
      expect(expresiones.length).toBeGreaterThan(0);
      for (const e of expresiones) {
        expect(codigoDe(e.texto).join('\n'), `${e.ruta}: ${e.texto}`).not.toContain(SECRETO);
        // …y una expresión que es toda código no trae nada del usuario fuera de comillas
        if (e.texto.startsWith('={{')) expect(sinLiterales(e.texto), e.ruta).not.toContain(SECRETO);
      }
      // 2) el texto del agente es «=<tarea sin llaves>» y después la entrada entre llaves dobles
      const agente = nodoN8n(f, f.nodes.find(n => n.type.endsWith('.agent'))?.name ?? '');
      const texto = agente.parameters.text as string;
      expect(texto.startsWith('=')).toBe(true);
      expect(texto.slice(0, texto.indexOf('\n\n{{'))).not.toMatch(/[{}]/);
      // 3) lo demás que escribió la persona está en valores inertes: no empiezan con «=», o si empiezan (porque
      //    ella escribió «=») ya no traen llaves
      for (const n of f.nodes) {
        for (const x of [(n.parameters.options as { systemMessage?: string } | undefined)?.systemMessage, n.parameters.toolDescription]) {
          if (typeof x !== 'string') continue;
          if (x.startsWith('=')) expect(x, n.name).not.toMatch(/[{}]/);
        }
      }
      expect(violacionesDelFlujo(f), `texto ${i}`).toEqual([]);
    }
  });
  it('constructor.exportar.un_nombre_con_comillas_o_llaves_se_escapa_dentro_de_las_expresiones_que_lo_citan', () => {
    const st = base();
    st.nodes = st.nodes.filter(n => n.kind === 'trigger');
    st.edges = [];
    Object.assign(disp(st), { tipo: 'tiempo' });
    nodoAgente(st, 'a1', "O'Neil {{x}} \\ fin", { tarea: 'Resume.' });
    nodoApp(st, 'g', 'Gmail');
    nodoApp(st, 's', 'Slack');
    arista(st, 't1', 'a1', 'seq');
    arista(st, 'a1', 'g', 'seq');
    arista(st, 'g', 's', 'seq');
    const f = exportado(st);
    const slack = nodoN8n(f, 'Slack').parameters.text as string;
    // la comilla, la barra y las llaves van como \uXXXX: no cierran el texto ni abren otra expresión
    expect(slack).toBe("={{ $('O\\u0027Neil \\u007b\\u007bx\\u007d\\u007d \\u005c fin').item.json.output }}");
    expect(sinLiterales(slack)).toBe("={{ $('').item.json.output }}");
    expect(codigoDe(slack)).toEqual([" $('').item.json.output "]);
  });
  it('constructor.exportar.una_clave_pegada_en_cualquier_campo_es_un_error_y_no_hay_archivo', () => {
    // cada campo que escribe la persona, con la forma de cuadro que lo prueba
    const campos: Record<string, (st: Flujo, clave: string) => void> = {
      'nombre del agente': (st, k) => void (ag(st, 'a1').nombre = `Agente ${k}`),
      instrucciones: (st, k) => void (ag(st, 'a1').instrucciones = `Usa ${k} para entrar`),
      'descripcion del ayudante': (st, k) => {
        conversan(st, 'a1', 'a2');
        ag(st, 'a2').desc = k;
      },
      'nombre de la app': (st, k) => void nodoApp(st, 'p9', k),
      'ruta del webhook': (st, k) => void Object.assign(disp(st), { tipo: 'web', ruta: k }),
      tarea: (st, k) => {
        Object.assign(disp(st), { tipo: 'tiempo' });
        ag(st, 'a1').tarea = k;
      },
    };
    for (const [forma, clave] of Object.entries(CLAVES)) {
      for (const [campo, poner] of Object.entries(campos)) {
        const st = base();
        poner(st, clave);
        const r = construirFlujo(st);
        expect(r.flujo, `${forma} en ${campo}`).toBeNull();
        expect(r.json).toBe('');
        expect(r.errores.some(e => e.startsWith('Parece que pegaste una clave en «')), `${forma} en ${campo}: ${r.errores.join(' | ')}`).toBe(true);
        expect(() => construirN8n(st), `${forma} en ${campo}`).toThrow();
      }
      const conNombre = base();
      conNombre.nombreFlujo = `Flujo ${clave}`;
      expect(revisarFlujo(conNombre).errores).toEqual(['Parece que pegaste una clave en el nombre del flujo. Quítala.']);
    }
    // el mensaje dice en qué cuadro y qué hacer
    const st = base();
    ag(st, 'a2').instrucciones = CLAVES.openai as string;
    expect(revisarFlujo(st).errores).toEqual(['Parece que pegaste una clave en «Revisor». Quítala: las claves se ponen en n8n al conectar la cuenta, nunca dentro del archivo.']);
  });

  it('constructor.exportar.tambien_se_rechaza_la_clave_que_aparece_solo_despues_de_limpiar_el_texto', () => {
    // la ruta «sk aaaa…» se vuelve «sk-aaaa…» en el enlace del webhook
    const ruta = base();
    Object.assign(disp(ruta), { tipo: 'web', ruta: `sk ${'a'.repeat(24)}` });
    ag(ruta, 'a1').tarea = 'Hola.';
    expect(revisarFlujo(ruta).errores).toEqual(['Parece que pegaste una clave en «Disparador Web». Quítala: las claves se ponen en n8n al conectar la cuenta, nunca dentro del archivo.']);
    // la tarea pierde sus llaves: «sk-{}aaaa…» queda «sk-aaaa…»
    const tarea = base();
    Object.assign(disp(tarea), { tipo: 'tiempo' });
    ag(tarea, 'a1').tarea = `sk-{}${'a'.repeat(24)}`;
    expect(revisarFlujo(tarea).errores).toHaveLength(1);
    // el nombre de una herramienta pierde lo que no es ASCII: «sk-ñaaaa…» queda «sk-aaaa…»
    const herramienta = base();
    nodoApp(herramienta, 'p9', `sk-ñ${'a'.repeat(24)}`);
    arista(herramienta, 'a1', 'p9', 'tool');
    expect(revisarFlujo(herramienta).errores).toHaveLength(1);
    // el texto que empieza con «=» pierde las llaves: «=sk-{}aaaa…» queda «== sk-aaaa…»
    const igual = base();
    ag(igual, 'a1').instrucciones = `=sk-{}${'a'.repeat(24)}`;
    expect(revisarFlujo(igual).errores).toHaveLength(1);
    // el nombre se corta a 100: un token de Telegram que el corte deja completo
    const corte = base();
    ag(corte, 'a1').nombre = `${'p'.repeat(54)} 123456789:${'a'.repeat(35)}${'z'.repeat(20)}`;
    expect(corte.nodes.length).toBeGreaterThan(0);
    expect(revisarFlujo(corte).errores).toHaveLength(1);
    // lo parecido que no es clave sigue pasando
    const bien = base();
    ag(bien, 'a1').instrucciones = 'Usa sk-corto y AIza no es una clave, ni 123:abc.';
    expect(revisarFlujo(bien).errores).toEqual([]);
  });

  it('constructor.exportar.la_red_final_revisa_textos_y_claves_de_objeto_de_todo_el_archivo', () => {
    const limpio = exportado(base());
    expect(claveEnFlujo(limpio)).toBe(false);
    const k = CLAVES.openai as string;
    const casos: Record<string, (f: FlujoN8n) => void> = {
      'nombre del flujo': f => (f.name = k),
      'nombre de nodo': f => (nodoN8n(f, 'Slack').name = k),
      parámetro: f => (nodoN8n(f, 'Slack').parameters.text = `x ${k}`),
      'lista anidada': f => (nodoN8n(f, 'When chat message received').parameters.lista = [[{ a: k }]]),
      notas: f => (nodoN8n(f, 'Slack').notes = k),
      credencial: f => ((nodoN8n(f, 'Slack').credentials ??= {}).otra = { id: '', name: k }),
      'clave de conexión': f => (f.connections[k] = {}),
    };
    for (const [donde, mutar] of Object.entries(casos)) {
      const f = exportado(base());
      mutar(f);
      expect(claveEnFlujo(f), donde).toBe(true);
    }
    expect(claveEnFlujo(null)).toBe(false);
    expect(claveEnFlujo(42)).toBe(false);
    // y `construirFlujo` la usa: lo que la revisión no vio (aquí, la zona que pasa quien llama) tampoco sale en el archivo
    const tiempo = base();
    Object.assign(disp(tiempo), { tipo: 'tiempo' });
    ag(tiempo, 'a1').tarea = 'Resume.';
    const conClave = { zona: `sk-${'a'.repeat(24)}` };
    expect(revisarFlujo(tiempo).errores).toEqual([]);
    expect(construirFlujo(tiempo, conClave)).toMatchObject({
      errores: ['Parece que pegaste una clave en el flujo. Quítala: las claves se ponen en n8n al conectar la cuenta, nunca dentro del archivo.'],
      flujo: null,
      json: '',
    });
    expect(() => construirN8n(tiempo, conClave)).toThrow('Parece que pegaste una clave en el flujo');
  });

  it('constructor.exportar.las_credenciales_salen_siempre_como_referencias_vacias_y_no_hay_nada_parecido_a_una_clave', () => {
    let conCredencial = 0;
    for (const c of casosGolden()) {
      const f = construirFlujo(c.flujo, { zona: 'UTC' }).flujo;
      if (!f) continue;
      for (const n of f.nodes) {
        for (const [clave, cred] of Object.entries(n.credentials ?? {})) {
          conCredencial += 1;
          expect(cred.id, `${c.nombre}/${n.name}/${clave}`).toBe('');
          expect(cred.name.length).toBeGreaterThan(0);
          expect(Object.keys(cred).sort()).toEqual(['id', 'name']);
        }
      }
      expect(claveEnFlujo(f), c.nombre).toBe(false);
    }
    expect(conCredencial).toBeGreaterThan(50);
    // cada agente trae la credencial de SU IA
    const f = exportado(base());
    expect(nodoN8n(f, 'OpenAI Chat Model').credentials).toEqual({ openAiApi: { id: '', name: 'OpenAI' } });
    expect(nodoN8n(f, 'Anthropic Chat Model').credentials).toEqual({ anthropicApi: { id: '', name: 'Anthropic' } });
  });
});

// ---------------------------------------------------------------- el mapeo a n8n

describe('del lienzo a los nodos de n8n', () => {
  it('constructor.exportar.las_conexiones_del_ejemplo_son_exactamente_las_esperadas_y_en_el_orden_del_archivo', () => {
    const f = exportado(base());
    expect(Object.keys(f.connections)).toEqual(['OpenAI Chat Model', 'Anthropic Chat Model', 'When chat message received', 'Atención a clientes', 'Google Sheets', 'Slack']);
    expect(f.connections).toEqual({
      'OpenAI Chat Model': { ai_languageModel: [[{ node: 'Atención a clientes', type: 'ai_languageModel', index: 0 }]] },
      'Anthropic Chat Model': { ai_languageModel: [[{ node: 'Revisor', type: 'ai_languageModel', index: 0 }]] },
      'When chat message received': { main: [[{ node: 'Atención a clientes', type: 'main', index: 0 }]] },
      'Atención a clientes': { main: [[{ node: 'Revisor', type: 'main', index: 0 }]] },
      'Google Sheets': { ai_tool: [[{ node: 'Atención a clientes', type: 'ai_tool', index: 0 }]] },
      Slack: { ai_tool: [[{ node: 'Revisor', type: 'ai_tool', index: 0 }]] },
    });
    // una IA que conversa es una herramienta del principal y lo que sigue sale del principal
    const st = base();
    conversan(st, 'a1', 'a2');
    nodoApp(st, 'g', 'Gmail');
    arista(st, 'a2', 'g', 'seq');
    const g = exportado(st);
    expect(nodoN8n(g, 'Revisor').type).toBe('@n8n/n8n-nodes-langchain.agentTool');
    expect(g.connections['Atención a clientes']?.main?.[0]).toEqual([{ node: 'Gmail', type: 'main', index: 0 }]);
    expect(g.connections['Revisor']?.ai_tool?.[0]).toEqual([{ node: 'Atención a clientes', type: 'ai_tool', index: 0 }]);
    expect(g.connections['Revisor']?.main).toBeUndefined();
    expect(g.connections['Anthropic Chat Model']?.ai_languageModel?.[0]).toEqual([{ node: 'Revisor', type: 'ai_languageModel', index: 0 }]);
  });

  it('constructor.exportar.lo_que_recibe_el_agente_depende_de_quien_le_entrega_la_respuesta', () => {
    const con = (tipo: 'tiempo' | 'web' | 'app', app: 'gmail' | 'telegram', tarea: string): Flujo => {
      const st = base();
      Object.assign(disp(st), { tipo, app, ruta: 'x' });
      ag(st, 'a1').tarea = tarea;
      return st;
    };
    const texto = (st: Flujo) => nodoN8n(exportado(st), 'Atención a clientes').parameters;
    // tras el chat, el agente lee el mensaje solo: no lleva prompt
    expect(texto(base())).toEqual({ options: { systemMessage: ag(base(), 'a1').instrucciones } });
    // un disparador de tiempo no entrega nada: el texto es la tarea
    expect(texto(con('tiempo', 'gmail', 'Resume.'))).toMatchObject({ promptType: 'define', text: 'Resume.' });
    expect(texto(con('web', 'gmail', 'Procesa.'))).toMatchObject({ text: '=Procesa.\n\n{{ JSON.stringify($json.body) }}' });
    expect(texto(con('app', 'telegram', 'Contesta.'))).toMatchObject({ text: '=Contesta.\n\n{{ $json.message.text }}' });
    expect(texto(con('app', 'gmail', 'Contesta.'))).toMatchObject({
      text: '=Contesta.\n\n{{ JSON.stringify({ de: $json.from?.text, asunto: $json.subject, mensaje: $json.text }) }}',
    });
    // la tarea pierde sus llaves
    expect(texto(con('web', 'gmail', 'Haz {{ esto }} y {aquello}'))).toMatchObject({ text: '=Haz  esto  y aquello\n\n{{ JSON.stringify($json.body) }}' });
    // tras otro agente sin tarea: su respuesta; tras una app: todo lo que llegó
    const st = base();
    expect(nodoN8n(exportado(st), 'Revisor').parameters).toMatchObject({ promptType: 'define', text: '={{ $json.output }}' });
    const trasApp = base();
    Object.assign(disp(trasApp), { tipo: 'tiempo' });
    trasApp.nodes = trasApp.nodes.filter(n => n.id !== 'a2');
    trasApp.edges = [];
    nodoApp(trasApp, 'g', 'Gmail');
    nodoAgente(trasApp, 'a9', 'Despues', { desc: '' });
    arista(trasApp, 't1', 'g', 'seq');
    arista(trasApp, 'g', 'a9', 'seq');
    arista(trasApp, 't1', 'a1', 'seq');
    ag(trasApp, 'a1').tarea = 'Hola.';
    expect(nodoN8n(exportado(trasApp), 'Despues').parameters).toMatchObject({ text: '={{ JSON.stringify($json) }}' });
  });

  it('constructor.exportar.una_app_como_paso_usa_la_respuesta_del_agente_y_responde_a_quien_escribio', () => {
    // Gmail tras un agente
    const st = base();
    nodoApp(st, 'g', 'Gmail');
    arista(st, 'a2', 'g', 'seq');
    expect(nodoN8n(exportado(st), 'Gmail').parameters).toMatchObject({ message: '={{ $json.output }}', sendTo: '', subject: 'Respuesta del asistente' });
    // un paso más: cita al agente por su nombre
    nodoApp(st, 'h', 'Telegram');
    arista(st, 'g', 'h', 'seq');
    expect(nodoN8n(exportado(st), 'Telegram').parameters.text).toBe("={{ $('Revisor').item.json.output }}");
    // tras el disparador sin ningún agente en medio: todo lo que llegó
    const directo = base();
    directo.nodes = directo.nodes.filter(n => n.kind !== 'agent');
    directo.edges = [];
    arista(directo, 't1', 'p2', 'seq');
    expect(nodoN8n(exportado(directo), 'Slack').parameters.text).toBe('={{ JSON.stringify($json) }}');
    // el flujo que arranca con un correo contesta a quien lo escribió
    const correo = base();
    Object.assign(disp(correo), { tipo: 'app', app: 'gmail' });
    ag(correo, 'a1').tarea = 'Contesta.';
    nodoApp(correo, 'g', 'Gmail');
    arista(correo, 'a2', 'g', 'seq');
    expect(nodoN8n(exportado(correo), 'Gmail').parameters).toMatchObject({
      sendTo: "={{ $('Gmail Trigger').item.json.from.value[0].address }}",
      subject: "={{ 'Re: ' + $('Gmail Trigger').item.json.subject }}",
    });
    const telegram = base();
    Object.assign(disp(telegram), { tipo: 'app', app: 'telegram' });
    ag(telegram, 'a1').tarea = 'Contesta.';
    nodoApp(telegram, 'tg', 'Telegram');
    arista(telegram, 'a2', 'tg', 'seq');
    expect(nodoN8n(exportado(telegram), 'Telegram').parameters).toMatchObject({ chatId: "={{ $('Telegram Trigger').item.json.message.chat.id }}" });
    // como herramienta el agente decide: `$fromAI`, no la respuesta del paso anterior
    const herramienta = base();
    expect(JSON.stringify(nodoN8n(exportado(herramienta), 'Slack').parameters)).toContain('$fromAI');
    expect(nodoN8n(exportado(herramienta), 'Slack').type).toBe('n8n-nodes-base.slackTool');
  });

  it('constructor.exportar.una_app_que_no_esta_en_el_catalogo_es_un_http_request_con_su_nota', () => {
    const st = base();
    nodoApp(st, 'h', 'Hub  Spot ');
    nodoApp(st, 'z', 'Zendesk');
    arista(st, 'a2', 'h', 'seq');
    arista(st, 'a2', 'z', 'tool');
    const f = exportado(st);
    const paso = nodoN8n(f, 'Hub  Spot');
    expect(paso).toMatchObject({ type: 'n8n-nodes-base.httpRequest', typeVersion: 4.5, parameters: { method: 'POST', url: '', options: {} }, notes: 'Configura aquí la API de Hub  Spot.' });
    expect(paso.credentials).toBeUndefined();
    expect(nodoN8n(f, 'Zendesk')).toMatchObject({ type: 'n8n-nodes-base.httpRequestTool', parameters: { method: 'GET', url: '' }, notes: 'Configura aquí la API de Zendesk.' });
  });

  it('constructor.exportar.el_modelo_de_cada_agente_va_debajo_sin_pisar_ningun_otro_nodo', () => {
    const modelos = new Set(IAS.map(i => i.tipo));
    let revisados = 0;
    for (const c of casosGolden()) {
      const f = construirFlujo(c.flujo, { zona: 'UTC' }).flujo;
      if (!f) continue;
      for (const m of f.nodes.filter(n => modelos.has(n.type))) {
        revisados += 1;
        for (const o of f.nodes) {
          if (o === m) continue;
          const pisa = Math.abs(o.position[0] - m.position[0]) < 140 && Math.abs(o.position[1] - m.position[1]) < 130;
          // un modelo posterior puede haber quedado al lado de uno anterior solo si ya no cabía; en los casos no pasa
          expect(pisa, `${c.nombre}: «${m.name}» pisa a «${o.name}»`).toBe(false);
        }
      }
    }
    expect(revisados).toBeGreaterThan(40);
    // el primer hueco es 190 px debajo del agente (312, 180): el de la izquierda (192) y el de la derecha (432) pisan a las apps, el siguiente no
    expect(nodoN8n(exportado(base()), 'OpenAI Chat Model').position).toEqual([32, 370]);
  });
});

// ---------------------------------------------------------------- propiedades con semilla

/** Un generador de números con semilla (mulberry32): las corridas se pueden repetir. */
function azar(semilla: number): () => number {
  let a = semilla;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOMBRES_DE_APP = ['Gmail', 'Slack', 'Google Sheets', 'Notion', 'Telegram', 'HubSpot', 'correo', 'Hoja de cálculo', 'constructor', 'a>b', "O'Neil", ...HOSTILES];
const TEXTOS = ['', 'Hola.', 'Resume lo importante.', 'Haz {x}', '  ', ...HOSTILES, CLAVES.openai as string];

/** Un flujo al azar que cumple las reglas del lienzo (un disparador, ≤ 4 agentes, ≤ 8 apps, sin ciclos). */
function flujoAlAzar(r: () => number): Flujo {
  const elige = <T>(lista: readonly T[]): T => lista[Math.floor(r() * lista.length)] as T;
  const st: Flujo = { nodes: [], edges: [], nombreFlujo: elige(['Flujo', '', '  ', 'Mi flujo', ...HOSTILES]) };
  st.nodes.push({ id: 't1', kind: 'trigger', x: 8, y: 180, tipo: elige(['tiempo', 'chat', 'web', 'app'] as const), frec: elige(['hora', 'dia', 'lunes'] as const), ruta: elige(['mi-flujo', 'Ruta Ñ!', '', ...HOSTILES]), app: elige(['gmail', 'telegram'] as const) });
  const nAgentes = Math.floor(r() * 5);
  const nApps = Math.floor(r() * 9);
  const otros: Nodo[] = [];
  for (let i = 0; i < nAgentes; i += 1) {
    otros.push({ id: `a${i + 1}`, kind: 'agent', x: Math.floor(r() * 60) * 8, y: Math.floor(r() * 40) * 8, nombre: elige(['Agente', 'Revisor', 'Atención', 'toString', ...HOSTILES]), ia: elige(['openai', 'anthropic', 'gemini', 'openrouter'] as const), tarea: elige(TEXTOS), instrucciones: elige(TEXTOS), desc: elige(TEXTOS) });
  }
  for (let i = 0; i < nApps; i += 1) {
    otros.push({ id: `p${i + 1}`, kind: 'app', x: Math.floor(r() * 60) * 8, y: Math.floor(r() * 40) * 8, nombre: elige(NOMBRES_DE_APP) });
  }
  // el orden de la lista es el orden del flujo: las conexiones solo van de un cuadro a otro posterior (sin ciclos)
  const orden = [st.nodes[0] as Nodo, ...otros.sort(() => r() - 0.5)];
  st.nodes = orden.slice().sort(() => r() - 0.5);
  const conPadre = new Set<string>();
  const conSeq = new Set<string>();
  orden.forEach((n, i) => {
    if (i === 0) return;
    const antes = orden.slice(0, i);
    const agentesAntes = antes.filter(x => x.kind === 'agent' && x.id !== n.id);
    // herramienta (app o agente) de un agente anterior, si puede serlo
    if (n.kind !== 'trigger' && agentesAntes.length > 0 && r() < 0.4) {
      const padre = elige(agentesAntes);
      st.edges.push({ id: `e${st.edges.length + 1}`, de: padre.id, a: n.id, tipo: 'tool' });
      conPadre.add(n.id);
      return;
    }
    // si no, un paso: de uno o dos cuadros anteriores que puedan dar un paso
    const puedenDar = antes.filter(x => !(x.kind === 'app' && conPadre.has(x.id)));
    const cuantos = r() < 0.2 && puedenDar.length > 1 ? 2 : 1;
    for (const de of [...puedenDar].sort(() => r() - 0.5).slice(0, cuantos)) {
      st.edges.push({ id: `e${st.edges.length + 1}`, de: de.id, a: n.id, tipo: 'seq' });
      conSeq.add(de.id);
      conSeq.add(n.id);
    }
  });
  // una app que es herramienta no toca ninguna conexión de un solo sentido: la regla del lienzo
  st.edges = st.edges.filter(e => e.tipo === 'tool' || !(conPadre.has(e.a) && st.nodes.find(n => n.id === e.a)?.kind === 'app') );
  st.edges = st.edges.filter(e => !(e.tipo === 'seq' && conPadre.has(e.de) && st.nodes.find(n => n.id === e.de)?.kind === 'app'));
  // un ayudante no recibe pasos
  st.edges = st.edges.filter(e => !(e.tipo === 'seq' && conPadre.has(e.a)));
  return st;
}

describe('propiedades con semilla', () => {
  it('constructor.exportar.cualquier_flujo_valido_al_azar_da_un_archivo_que_cumple_los_invariantes_y_la_revision_barata_dice_lo_mismo', () => {
    const vueltas = Number(process.env.FUZZ_N ?? 400);
    const semilla = Number(process.env.FUZZ_SEMILLA ?? 20261020);
    let exportados = 0;
    let rechazados = 0;
    for (let i = 0; i < vueltas; i += 1) {
      const st = flujoAlAzar(azar(semilla + i));
      const copia = JSON.stringify(st);
      const rev = revisarFlujo(st);
      const r = construirFlujo(st, { zona: 'UTC' });
      expect(JSON.stringify(st), `semilla ${semilla + i}: el exportador no debe tocar el flujo`).toBe(copia);
      expect(r.errores, `semilla ${semilla + i}`).toEqual(rev.errores);
      expect(r.avisos, `semilla ${semilla + i}`).toEqual(rev.avisos);
      if (r.errores.length > 0) {
        rechazados += 1;
        expect(r.flujo).toBeNull();
        continue;
      }
      exportados += 1;
      const f = r.flujo as FlujoN8n;
      expect(violacionesDelFlujo(f), `semilla ${semilla + i}\n${r.json}`).toEqual([]);
      expect(referenciasCompartidas(f), `semilla ${semilla + i}`).toEqual([]);
      expect(construirFlujo(st, { zona: 'UTC' }).json, `semilla ${semilla + i}: no es determinista`).toBe(r.json);
      expect(f.nodes.filter(n => n.type.endsWith('.agent') || n.type.endsWith('.agentTool')).length * 2 + f.nodes.filter(n => !/\.agent(Tool)?$/.test(n.type) && !/lmChat/.test(n.type)).length).toBeLessThanOrEqual(17);
      // nada del usuario llega al código de una expresión
      for (const e of expresionesDelFlujo(f)) {
        expect(codigoDe(e.texto).join('\n'), `semilla ${semilla + i}: ${e.texto}`).not.toContain(SECRETO);
        if (e.texto.startsWith('={{')) expect(sinLiterales(e.texto), `semilla ${semilla + i}: ${e.texto}`).not.toContain(SECRETO);
      }
    }
    // la mezcla no es trivial: salen archivos y también rechazos
    expect(exportados).toBeGreaterThan(vueltas / 10);
    expect(rechazados).toBeGreaterThan(vueltas / 10);
  });
});
