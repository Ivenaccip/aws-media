// La mitad TypeScript de la paridad con Python (M4b, informe 06 §4-§5).
//
// El catálogo del Constructor (catalogo.ts + datos/) es una tabla escrita a mano; la verdad sobre lo que n8n
// ofrece y lo que el repo permite vive en media/library/n8n/catalog.json y permitidos.json. Las dos mitades no
// se leen entre sí: se hablan por UN archivo,
//
//     golden/catalogo-usado.json     lo escribe y lo vigila ESTA prueba (nunca se edita a mano)
//
//   · vitest (aquí) comprueba que ese JSON es EXACTAMENTE lo que dice el catálogo de TypeScript y el exportador.
//     Si alguien toca una fila de datos/ sin regenerarlo, falla. Vitest nunca lee media/ ni pipeline/ (la etapa
//     `web` del Dockerfile solo copia web/): por eso esta prueba solo lee golden/.
//   · pytest (tests/test_constructor_paridad.py) lee ese JSON y golden/flujos.json y los compara con el catálogo
//     de n8n, con permitidos.json y con pipeline/validador.py. Python nunca lee TypeScript.
//
// Si el JSON se edita a mano, falla aquí; si se regenera con algo que n8n o el validador no aceptan, falla allá.
//
// Para reescribir el JSON (a propósito, nunca en silencio):
//     ACTUALIZAR_DORADO=1 npx vitest run src/pantallas/constructor/modelo/catalogo.paridad.test.ts
// y luego, desde la raíz del repo:
//     ./venv/bin/python -m pytest tests/test_constructor_paridad.py -p no:cacheprovider

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AGENTE_N8N, APPS, AYUDANTE_N8N, DISPARADORES_N8N, IAS, OTRA_APP } from './catalogo';
import { construirFlujo } from './exportar';
import { casosGolden } from './golden/casos';
import { SECRETOS } from './secretos';
import type { CredencialN8n } from './tipos';

// new URL(…, import.meta.url) no sirve aquí: el URL global es el de jsdom
const RUTA_JSON = resolve(dirname(fileURLToPath(import.meta.url)), 'golden', 'catalogo-usado.json');

// ---------------------------------------------------------------- el documento

interface FilaCredencial {
  clave: string;
  nombre: string;
}
interface FilaApp {
  nombre: string;
  tipo: string;
  tipoHerramienta: string;
  typeVersion: number;
  credencial: FilaCredencial;
}
interface FilaIA {
  id: string;
  nodo: string;
  tipo: string;
  typeVersion: number;
  credencial: FilaCredencial;
  /** El modelo que se manda (solo OpenAI lo fija); null si n8n usa el suyo. */
  modelo: string | null;
}
interface FilaDisparador {
  nombreBase: string;
  tipo: string;
  typeVersion: number;
  credencial: FilaCredencial | null;
}
interface FilaNodo {
  tipo: string;
  typeVersion: number;
}
interface FilaOtraApp extends FilaNodo {
  tipoHerramienta: string;
}
/** Un texto armado por pedazos (`[texto, veces]`): en el archivo ninguna sonda se parece a una clave de verdad. */
type Partes = [string, number][];
interface Sonda {
  id: string;
  partes: Partes;
  /** Los índices de SECRETOS que la reconocen, según TypeScript. */
  coincide: number[];
}
interface CatalogoUsado {
  formato: 1;
  generadoPor: string;
  apps: FilaApp[];
  ias: FilaIA[];
  disparadores: FilaDisparador[];
  agente: FilaNodo;
  ayudante: FilaNodo;
  otraApp: FilaOtraApp;
  secretos: {
    patrones: { fuente: string; ignoraMayusculas: boolean }[];
    sondas: Sonda[];
  };
}

/**
 * Las sondas de claves: qué debe decir cada uno de los dieciséis patrones. `esperado` es la respuesta de TypeScript
 * (los índices de SECRETOS que la reconocen); pytest compara la de Python con la que queda en el JSON (Python conoce
 * los índices 0 a 7). Las divergencias —entre motores de expresiones, o porque TypeScript va por delante de Python— las
 * declara pytest una por una.
 */
const SONDAS: { id: string; partes: Partes; esperado: number[] }[] = [
  // las ocho familias, en el orden de SECRETOS
  { id: 'openai_anthropic_openrouter', partes: [['sk-', 1], ['a', 20]], esperado: [0] },
  { id: 'google', partes: [['AIza', 1], ['b', 35]], esperado: [1] },
  { id: 'slack', partes: [['xoxb-', 1], ['1', 10]], esperado: [2] },
  { id: 'github', partes: [['ghp_', 1], ['c', 30]], esperado: [3] },
  { id: 'bot_de_telegram', partes: [['1', 9], [':', 1], ['d', 35]], esperado: [4] },
  { id: 'bearer', partes: [['bearer ', 1], ['e', 20]], esperado: [5] },
  { id: 'llave_privada', partes: [['-----BEGIN RSA PRIV', 1], ['ATE KEY-----', 1]], esperado: [6] },
  { id: 'aws', partes: [['AKIA', 1], ['F', 16]], esperado: [7] },
  // el límite de cada una: un carácter menos, o pegada a una letra, no es clave
  { id: 'sk_con_un_caracter_menos', partes: [['sk-', 1], ['a', 19]], esperado: [] },
  { id: 'google_con_un_caracter_menos', partes: [['AIza', 1], ['b', 34]], esperado: [] },
  { id: 'telegram_con_siete_digitos', partes: [['1', 7], [':', 1], ['d', 35]], esperado: [] },
  { id: 'telegram_con_once_digitos', partes: [['1', 11], [':', 1], ['d', 35]], esperado: [] },
  { id: 'aws_pegada_a_una_letra', partes: [['x', 1], ['AKIA', 1], ['F', 16]], esperado: [] },
  { id: 'sk_en_mayusculas', partes: [['SK-', 1], ['A', 20]], esperado: [] },
  // (?i) solo en bearer
  { id: 'bearer_en_mayusculas', partes: [['BEARER ', 1], ['e', 20]], esperado: [5] },
  { id: 'bearer_con_espacio_duro', partes: [['bearer ', 1], ['e', 20]], esperado: [5] },
  // divergencias conocidas JS ↔ Python (ver tests/test_constructor_paridad.py)
  { id: 'telegram_con_digitos_arabes', partes: [['١', 9], [':', 1], ['d', 35]], esperado: [] },
  { id: 'aws_junto_a_una_letra_acentuada', partes: [['ñ', 1], ['AKIA', 1], ['F', 16]], esperado: [7] },
  { id: 'aws_seguida_de_una_letra_acentuada', partes: [['AKIA', 1], ['F', 16], ['ñ', 1]], esperado: [7] },
  // TypeScript va por delante de Python en `sk-` y en `gh[pousr]_`: el límite de palabra (hallazgo Q2 de la revisión del motor)
  { id: 'sk_dentro_de_una_palabra_task', partes: [['task-', 1], ['management-system-webhook', 1]], esperado: [] },
  { id: 'sk_dentro_de_una_palabra_risk', partes: [['risk-', 1], ['assessment-for-the-quarter', 1]], esperado: [] },
  { id: 'sk_dentro_de_una_url_de_notion', partes: [['https://www.notion.so/Task-', 1], ['Tracker-Weekly-Plan-0123456789abcdef', 1]], esperado: [] },
  { id: 'sk_con_etiqueta', partes: [['OPENAI_API_KEY=sk-proj-', 1], ['a', 24]], esperado: [0] },
  { id: 'github_pegada_a_una_letra', partes: [['highp_', 1], ['c', 30]], esperado: [] },
  // los ocho formatos que solo conoce TypeScript (índices 8 a 15): su clave de verdad, y la misma con un carácter menos
  { id: 'notion', partes: [['ntn_', 1], ['N', 30]], esperado: [8] },
  { id: 'notion_viejo', partes: [['secret_', 1], ['V', 40]], esperado: [9] },
  { id: 'airtable', partes: [['pat', 1], ['A', 14], ['.', 1], ['0', 64]], esperado: [10] },
  { id: 'whatsapp_meta', partes: [['EAA', 1], ['M', 40]], esperado: [11] },
  { id: 'slack_aplicacion', partes: [['xapp-1-', 1], ['S', 24]], esperado: [12] },
  { id: 'github_grano_fino', partes: [['github_pat_', 1], ['G', 50]], esperado: [13] },
  { id: 'stripe', partes: [['sk_live_', 1], ['T', 24]], esperado: [14] },
  { id: 'sendgrid', partes: [['SG.', 1], ['W', 22], ['.', 1], ['W', 43]], esperado: [15] },
  { id: 'notion_con_un_caracter_menos', partes: [['ntn_', 1], ['N', 29]], esperado: [] },
  { id: 'airtable_con_la_segunda_parte_no_hexadecimal', partes: [['pat', 1], ['A', 14], ['.', 1], ['Z', 64]], esperado: [] },
  { id: 'stripe_publicable_no_es_secreta', partes: [['pk_live_', 1], ['T', 24]], esperado: [] },
];

const armar = (partes: Partes): string => partes.map(([texto, veces]) => texto.repeat(veces)).join('');
const coincidencias = (texto: string): number[] => SECRETOS.flatMap((r, i) => (r.test(texto) ? [i] : []));

const credencialDe = (c: CredencialN8n): FilaCredencial => ({ clave: c.clave, nombre: c.nombre });

/** El modelo que fija el nodo de la IA, o null si no fija ninguno (`parameters.model.value`). */
function modeloDe(ia: (typeof IAS)[number]): string | null {
  const modelo = ia.params()['model'];
  if (modelo === undefined || modelo === null || typeof modelo !== 'object' || Array.isArray(modelo)) return null;
  const valor = modelo['value'];
  return typeof valor === 'string' ? valor : null;
}

/** Lo que el Constructor usa de n8n, tal como lo dice HOY el catálogo de TypeScript. Es lo que se guarda en el JSON. */
function catalogoUsado(): CatalogoUsado {
  // un disparador de cada tipo basta: type, typeVersion y credencial no dependen de la frecuencia ni de la ruta
  return {
    formato: 1,
    generadoPor:
      'web/src/pantallas/constructor/modelo/catalogo.paridad.test.ts (ACTUALIZAR_DORADO=1). No se edita a mano.',
    apps: APPS.map(a => ({
      nombre: a.nombre,
      tipo: a.tipo,
      tipoHerramienta: a.tipoHerramienta,
      typeVersion: a.version,
      credencial: credencialDe(a.cred),
    })),
    ias: IAS.map(i => ({
      id: i.id,
      nodo: i.nodo,
      tipo: i.tipo,
      typeVersion: i.version,
      credencial: credencialDe(i.cred),
      modelo: modeloDe(i),
    })),
    disparadores: DISPARADORES_N8N.map(d => ({
      nombreBase: d.nombreBase,
      tipo: d.tipo,
      typeVersion: d.version,
      credencial: d.cred === null ? null : credencialDe(d.cred),
    })),
    agente: { tipo: AGENTE_N8N.tipo, typeVersion: AGENTE_N8N.version },
    ayudante: { tipo: AYUDANTE_N8N.tipo, typeVersion: AYUDANTE_N8N.version },
    otraApp: { tipo: OTRA_APP.tipo, tipoHerramienta: OTRA_APP.tipoHerramienta, typeVersion: OTRA_APP.version },
    secretos: {
      patrones: SECRETOS.map(r => ({ fuente: r.source, ignoraMayusculas: r.ignoreCase })),
      sondas: SONDAS.map(s => ({ id: s.id, partes: s.partes, coincide: coincidencias(armar(s.partes)) })),
    },
  };
}

/** El archivo tal como se escribe: 2 espacios, UTF-8, LF y salto de línea final. */
const serializar = (doc: CatalogoUsado): string => `${JSON.stringify(doc, null, 2)}\n`;

// ---------------------------------------------------------------- la comparación (con motivos legibles)

const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Dónde difieren dos valores de JSON (a lo más 8 rutas, para que el mensaje se pueda leer). */
function diferencias(guardado: unknown, actual: unknown, ruta = '$', salida: string[] = []): string[] {
  if (salida.length >= 8) return salida;
  if (Array.isArray(guardado) && Array.isArray(actual)) {
    if (guardado.length !== actual.length) {
      salida.push(`${ruta}: en el JSON hay ${guardado.length} elementos y en TypeScript ${actual.length}`);
    }
    const n = Math.min(guardado.length, actual.length);
    for (let i = 0; i < n; i += 1) diferencias(guardado[i], actual[i], `${ruta}[${i}]`, salida);
  } else if (esObjeto(guardado) && esObjeto(actual)) {
    for (const k of new Set([...Object.keys(guardado), ...Object.keys(actual)])) {
      if (!(k in guardado)) salida.push(`${ruta}.${k}: no está en el JSON y TypeScript lo trae`);
      else if (!(k in actual)) salida.push(`${ruta}.${k}: está en el JSON y TypeScript ya no lo trae`);
      else diferencias(guardado[k], actual[k], `${ruta}.${k}`, salida);
    }
  } else if (guardado !== actual) {
    salida.push(`${ruta}: en el JSON ${JSON.stringify(guardado)}, en TypeScript ${JSON.stringify(actual)}`);
  }
  return salida;
}

/** Por qué el JSON guardado no es lo que dice el catálogo de TypeScript. Vacío = es exactamente eso. */
function motivosDeDiferencia(guardado: string | null, actual: CatalogoUsado): string[] {
  if (guardado === null) return ['falta golden/catalogo-usado.json'];
  if (guardado === serializar(actual)) return [];
  let analizado: unknown;
  try {
    analizado = JSON.parse(guardado);
  } catch {
    return ['golden/catalogo-usado.json no es JSON válido'];
  }
  const motivos = diferencias(analizado, actual);
  return motivos.length > 0 ? motivos : ['el contenido es el mismo pero el formato no (2 espacios y un salto de línea final)'];
}

function leerGuardado(): string | null {
  try {
    return readFileSync(RUTA_JSON, 'utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- las pruebas

describe('paridad del catálogo con Python', () => {
  it('constructor.paridad.catalogo_usado_json_es_lo_que_dice_el_catalogo_ts_y_solo_se_reescribe_con_actualizar_dorado', () => {
    const actual = catalogoUsado();
    // la única forma de escribirlo es pedirlo: sin la variable, un archivo que falta o que cambió FALLA
    if (process.env.ACTUALIZAR_DORADO === '1') {
      writeFileSync(RUTA_JSON, serializar(actual), 'utf8');
      return;
    }
    expect(
      motivosDeDiferencia(leerGuardado(), actual),
      'golden/catalogo-usado.json no coincide con el catálogo de TypeScript. Si el cambio es a propósito: ' +
        'ACTUALIZAR_DORADO=1 npx vitest run src/pantallas/constructor/modelo/catalogo.paridad.test.ts, revisa el diff y ' +
        'corre ./venv/bin/python -m pytest tests/test_constructor_paridad.py -p no:cacheprovider',
    ).toEqual([]);
  });

  it('constructor.paridad.una_fila_tocada_cambia_el_json_y_la_comparacion_dice_cual', () => {
    const actual = catalogoUsado();
    const texto = serializar(actual);
    expect(motivosDeDiferencia(texto, actual)).toEqual([]);

    // la comparación no es de adorno: cada tipo de cambio se nota y dice dónde
    const gmail = structuredClone(actual);
    expect(gmail.apps[0]?.nombre).toBe('Gmail');
    (gmail.apps[0] as FilaApp).typeVersion += 0.1;
    expect(motivosDeDiferencia(serializar(gmail), actual)).toEqual([
      expect.stringContaining('$.apps[0].typeVersion'),
    ]);

    const credencial = structuredClone(actual);
    (credencial.ias[1] as FilaIA).credencial.clave = 'otraClave';
    expect(motivosDeDiferencia(serializar(credencial), actual)).toEqual([
      expect.stringContaining('$.ias[1].credencial.clave'),
    ]);

    const sinUna = structuredClone(actual);
    sinUna.disparadores.pop();
    expect(motivosDeDiferencia(serializar(sinUna), actual)).toEqual([
      expect.stringContaining('$.disparadores: en el JSON hay 4 elementos y en TypeScript 5'),
    ]);

    const patron = structuredClone(actual);
    (patron.secretos.patrones[0] as { fuente: string }).fuente = 'sk-[a-z]{20,}';
    expect(motivosDeDiferencia(serializar(patron), actual)).toEqual([
      expect.stringContaining('$.secretos.patrones[0].fuente'),
    ]);

    // y un JSON que falta, que no es JSON o que solo cambia de formato también se dicen
    expect(motivosDeDiferencia(null, actual)).toEqual(['falta golden/catalogo-usado.json']);
    expect(motivosDeDiferencia('{', actual)).toEqual(['golden/catalogo-usado.json no es JSON válido']);
    expect(motivosDeDiferencia(JSON.stringify(actual), actual)).toEqual([
      expect.stringContaining('el formato no'),
    ]);
  });

  it('constructor.paridad.la_tabla_trae_las_diez_apps_las_cuatro_ia_los_cinco_disparadores_el_agente_el_ayudante_y_la_otra_app', () => {
    const doc = catalogoUsado();
    expect(doc.apps).toHaveLength(10);
    expect(doc.ias.map(i => i.id)).toEqual(['openai', 'anthropic', 'gemini', 'openrouter']);
    expect(doc.disparadores).toHaveLength(5);
    expect(doc.agente.tipo).toBe('@n8n/n8n-nodes-langchain.agent');
    // el ayudante de «dos IA que conversan» es agentTool: pytest sabe que hoy permitidos.json no lo trae (decisión D4)
    expect(doc.ayudante.tipo).toBe('@n8n/n8n-nodes-langchain.agentTool');
    expect(doc.otraApp.tipo).toBe('n8n-nodes-base.httpRequest');
    for (const a of doc.apps) expect(a.tipoHerramienta, a.nombre).toBe(`${a.tipo}Tool`);
    expect(doc.otraApp.tipoHerramienta).toBe(`${doc.otraApp.tipo}Tool`);
    // ni dos filas con el mismo tipo ni dos con el mismo nombre
    const tipos = [
      ...doc.apps.map(a => a.tipo),
      ...doc.ias.map(i => i.tipo),
      ...doc.disparadores.map(d => d.tipo),
      doc.agente.tipo,
      doc.ayudante.tipo,
      doc.otraApp.tipo,
    ];
    expect(new Set(tipos).size).toBe(tipos.length);
    expect(new Set(doc.apps.map(a => a.nombre)).size).toBe(doc.apps.length);
    // las versiones y las credenciales son lo que el catálogo trae (no hay filas a medio llenar)
    for (const f of [...doc.apps, ...doc.ias, ...doc.disparadores, doc.agente, doc.ayudante, doc.otraApp]) {
      expect(Number.isFinite(f.typeVersion) && f.typeVersion > 0, f.tipo).toBe(true);
    }
    for (const c of [...doc.apps.map(a => a.credencial), ...doc.ias.map(i => i.credencial)]) {
      expect(c.clave.length > 0 && c.nombre.length > 0, JSON.stringify(c)).toBe(true);
    }
    // solo los disparadores de Telegram y Gmail piden credencial
    expect(doc.disparadores.filter(d => d.credencial !== null).map(d => d.nombreBase)).toEqual([
      'Telegram Trigger',
      'Gmail Trigger',
    ]);
    // solo OpenAI fija el modelo (decisión D5): pytest lo compara con permitidos.json → llm.modelo
    expect(doc.ias.map(i => i.modelo)).toEqual(['gpt-5.4-mini', null, null, null]);
  });

  it('constructor.paridad.todo_nodo_que_exporta_el_constructor_esta_declarado_en_la_tabla_y_cada_fila_de_la_tabla_se_exporta', () => {
    const doc = catalogoUsado();
    // type|typeVersion → la credencial que debe llevar el nodo
    const tabla = new Map<string, FilaCredencial | null>();
    const fila = (tipo: string, version: number, cred: FilaCredencial | null): void => {
      const clave = `${tipo}|${version}`;
      expect(tabla.has(clave), `la tabla repite ${clave}`).toBe(false);
      tabla.set(clave, cred);
    };
    for (const a of doc.apps) {
      fila(a.tipo, a.typeVersion, a.credencial);
      fila(a.tipoHerramienta, a.typeVersion, a.credencial);
    }
    for (const i of doc.ias) fila(i.tipo, i.typeVersion, i.credencial);
    for (const d of doc.disparadores) fila(d.tipo, d.typeVersion, d.credencial);
    fila(doc.agente.tipo, doc.agente.typeVersion, null);
    fila(doc.ayudante.tipo, doc.ayudante.typeVersion, null);
    fila(doc.otraApp.tipo, doc.otraApp.typeVersion, null);
    fila(doc.otraApp.tipoHerramienta, doc.otraApp.typeVersion, null);
    expect(tabla.size).toBe(33); // 22 filas base + 11 variantes de herramienta

    const exportados = new Set<string>();
    let flujos = 0;
    for (const c of casosGolden()) {
      const resultado = construirFlujo(c.flujo, { zona: 'UTC' });
      if (resultado.flujo === null) continue;
      flujos += 1;
      for (const n of resultado.flujo.nodes) {
        const clave = `${n.type}|${n.typeVersion}`;
        expect(tabla.has(clave), `${c.nombre}: «${n.name}» exporta ${clave}, que la tabla del catálogo no declara`).toBe(true);
        exportados.add(clave);
        const esperada = tabla.get(clave) ?? null;
        expect(
          Object.entries(n.credentials ?? {}).map(([k, v]) => [k, v.name, v.id]),
          `${c.nombre}: la credencial de «${n.name}»`,
        ).toEqual(esperada === null ? [] : [[esperada.clave, esperada.nombre, '']]);
      }
    }
    expect(flujos).toBe(34);
    // y al revés: nada de la tabla queda sin exportarse (si no, pytest no lo vería pasar por el validador)
    expect([...tabla.keys()].filter(k => !exportados.has(k))).toEqual([]);
  });

  it('constructor.paridad.las_sondas_de_claves_dicen_lo_que_espera_typescript_y_quedan_en_el_json_para_python', () => {
    const doc = catalogoUsado();
    expect(doc.secretos.patrones).toHaveLength(16);
    // solo bearer ignora mayúsculas (índice 5)
    expect(doc.secretos.patrones.map(p => p.ignoraMayusculas)).toEqual(SECRETOS.map((_, i) => i === 5));
    expect(doc.secretos.sondas.map(s => s.id)).toEqual(SONDAS.map(s => s.id));
    for (const s of SONDAS) {
      expect(coincidencias(armar(s.partes)), s.id).toEqual(s.esperado);
    }
    // ningún id se repite y ninguna sonda se guarda como texto corrido: el archivo no trae nada con forma de clave
    expect(new Set(SONDAS.map(s => s.id)).size).toBe(SONDAS.length);
    const texto = serializar(doc);
    for (const s of SONDAS) expect(texto.includes(armar(s.partes)), s.id).toBe(false);
    expect(
      SECRETOS.some(r => r.test(texto)),
      'golden/catalogo-usado.json no debe parecer que trae una clave',
    ).toBe(false);
  });
});
