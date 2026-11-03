import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AGENTE_N8N,
  APPS,
  APPS_DISPARADOR,
  AYUDANTE_N8N,
  DISPARADORES_N8N,
  disparadorN8n,
  FRECUENCIAS,
  IAS,
  ICONO_AGENTE,
  ICONO_APP,
  MODELO_OPENAI,
  OTRA_APP,
  PENDIENTES,
  TIPOS_DISPARADOR,
  appDe,
  iaDe,
  pendienteDe,
  tipoDeDisparador,
} from './catalogo';
import { deIA, norm, SALIDA } from './texto';
import type { NodoDisparador, ParametrosN8n, ValorJson } from './tipos';

// El catálogo de n8n y los permitidos viven fuera de web/ (media/library/n8n), y la etapa `web` del Dockerfile corre
// vitest con SOLO web/: por eso aquí no se leen. Se lee `golden/n8n-referencia.json`, el recorte que escribe
// tests/test_constructor_paridad.py y que esa misma prueba vigila contra catalog.json y permitidos.json (si cambian, falla
// allá hasta que se regenere). Con el recorte al día, estas pruebas dicen qué fila de datos/ hay que revisar.
// (new URL(…, import.meta.url) no sirve aquí: el URL global es el de jsdom)
const DIR = dirname(fileURLToPath(import.meta.url));
const leerJson = <T>(ruta: string): T => JSON.parse(readFileSync(resolve(DIR, ruta), 'utf8')) as T;

interface NodoCatalogo {
  nombre: string;
  versiones: number[];
  version_por_defecto: number;
  disparador: boolean;
  como_herramienta: boolean;
  oculto: boolean;
  credenciales: { nombre: string }[];
}
interface Catalogo {
  nodos: Record<string, NodoCatalogo | undefined>;
  credenciales: Record<string, string | undefined>;
}
interface Permitidos {
  llm: { proveedor: string; nodo: string; modelo: string };
  nodos: { tipo: string; funcion: string }[];
}
interface Referencia {
  formato: 1;
  catalogo: Catalogo;
  permitidos: Permitidos;
}

const REFERENCIA = leerJson<Referencia>('golden/n8n-referencia.json');
const CATALOGO = REFERENCIA.catalogo;
const PERMITIDOS = REFERENCIA.permitidos;
const PERMITIDOS_TIPOS = new Set(PERMITIDOS.nodos.map(n => n.tipo));
const tiposPermitidosCon = (funcion: string) => PERMITIDOS.nodos.filter(n => n.funcion === funcion).map(n => n.tipo);

/** Lo que el catálogo y los permitidos dicen de un nodo: ¿existe?, ¿en esa versión?, ¿es la por defecto?, ¿se puede usar? */
function revisar(tipo: string, version: number, cred?: string) {
  const nodo = CATALOGO.nodos[tipo];
  expect(nodo, `${tipo} no está en catalog.json`).toBeDefined();
  expect(nodo?.oculto, `${tipo} está oculto`).toBe(false);
  expect(nodo?.versiones, `${tipo} ${version} no es una versión del catálogo`).toContain(version);
  expect(version, `${tipo}: la versión fija ya no es la por defecto del catálogo`).toBe(nodo?.version_por_defecto);
  expect(PERMITIDOS_TIPOS.has(tipo), `${tipo} no está en permitidos.json`).toBe(true);
  if (cred !== undefined) {
    expect(
      nodo?.credenciales.map(c => c.nombre),
      `${cred} no es una credencial de ${tipo}`,
    ).toContain(cred);
    expect(CATALOGO.credenciales[cred], `${cred} no está en el diccionario de credenciales`).toBeDefined();
  }
  return nodo;
}

/** Recorre un valor de JSON y devuelve todos los objetos y listas que contiene (para buscar referencias compartidas). */
function contenedores(v: ValorJson | ParametrosN8n, salida: object[] = []): object[] {
  if (v !== null && typeof v === 'object') {
    salida.push(v);
    for (const hijo of Object.values(v)) contenedores(hijo, salida);
  }
  return salida;
}

/** Lo que una función de `params` debe cumplir: cada llamada es un objeto nuevo y modificarlo no toca la siguiente. */
function afirmarCopiaNueva(nombre: string, fn: () => ParametrosN8n) {
  const primera = fn();
  const foto = JSON.stringify(primera);
  const segunda = fn();
  expect(primera, nombre).not.toBe(segunda);
  const dePrimera = new Set(contenedores(primera));
  for (const c of contenedores(segunda)) expect(dePrimera.has(c), `${nombre}: comparte una referencia`).toBe(false);
  for (const c of contenedores(primera)) {
    if (Array.isArray(c)) c.push('contaminado');
    else (c as Record<string, ValorJson>)['contaminado'] = true;
  }
  expect(JSON.stringify(fn()), `${nombre}: cambiar una copia cambió el catálogo`).toBe(foto);
}

/** Todas las expresiones (`=…`) de los parámetros, en cualquier nivel. */
function expresiones(v: ValorJson | ParametrosN8n): string[] {
  if (typeof v === 'string') return v.startsWith('=') ? [v] : [];
  if (v !== null && typeof v === 'object') return Object.values(v).flatMap(h => expresiones(h));
  return [];
}

const disp = (tipo: NodoDisparador['tipo'], extra: Partial<NodoDisparador> = {}): NodoDisparador => ({
  id: 't1',
  kind: 'trigger',
  x: 8,
  y: 180,
  tipo,
  frec: 'dia',
  ruta: 'mi-flujo',
  app: 'gmail',
  ...extra,
});

describe('catálogo contra media/library/n8n (golden/n8n-referencia.json)', () => {
  it('constructor.catalogo.las_cuatro_ia_existen_estan_permitidas_con_la_version_por_defecto_y_su_credencial', () => {
    expect(IAS.map(i => i.id)).toEqual(['openai', 'anthropic', 'gemini', 'openrouter']);
    for (const ia of IAS) {
      const nodo = revisar(ia.tipo, ia.version, ia.cred.clave);
      expect(nodo?.como_herramienta, ia.tipo).toBe(false);
      expect(nodo?.disparador, ia.tipo).toBe(false);
      expect(ia.nodo, ia.id).toMatch(/Chat Model$/);
    }
    // son EXACTAMENTE los modelos de chat que se permiten (si se permite otro, hay que decidir si se ofrece)
    const permitidasIA = PERMITIDOS.nodos.filter(n => /langchain\.lmChat/.test(n.tipo)).map(n => n.tipo);
    expect(IAS.map(i => i.tipo).sort()).toEqual(permitidasIA.sort());
    // nombres de nodo distintos entre sí (n8n pide nombres únicos)
    expect(new Set(IAS.map(i => i.nodo)).size).toBe(IAS.length);
  });

  it('constructor.catalogo.solo_openai_lleva_modelo_y_es_el_de_permitidos_json', () => {
    expect(MODELO_OPENAI).toBe(PERMITIDOS.llm.modelo);
    const openai = iaDe('openai');
    expect(openai.tipo).toBe(PERMITIDOS.llm.nodo);
    expect(PERMITIDOS.llm.proveedor).toBe('openai');
    expect(openai.params()).toEqual({ model: { __rl: true, mode: 'id', value: PERMITIDOS.llm.modelo }, options: {} });
    // Claude, Gemini y OpenRouter: sin modelo (n8n usa el suyo). claude-haiku-5-5 del mockup no tiene fuente en el repo
    for (const id of ['anthropic', 'gemini', 'openrouter']) {
      expect(iaDe(id).params(), id).toEqual({ options: {} });
    }
    expect(JSON.stringify(IAS.map(i => i.params()))).not.toContain('haiku');
  });

  it('constructor.catalogo.los_cinco_disparadores_existen_estan_permitidos_y_su_credencial_es_del_nodo', () => {
    expect(DISPARADORES_N8N).toHaveLength(5);
    for (const d of DISPARADORES_N8N) {
      const nodo = revisar(d.tipo, d.version, d.cred?.clave);
      expect(nodo?.disparador, d.tipo).toBe(true);
      expect(PERMITIDOS.nodos.find(n => n.tipo === d.tipo)?.funcion, d.tipo).toBe('disparador');
    }
    // solo el chat y el webhook llevan webhookId
    expect(DISPARADORES_N8N.filter(d => d.conWebhookId).map(d => d.nombreBase)).toEqual([
      'When chat message received',
      'Webhook',
    ]);
    // el Constructor no ofrece los otros dos disparadores permitidos; si se permite uno más hay que decidir si se ofrece
    const ofrecidos = new Set(DISPARADORES_N8N.map(d => d.tipo));
    const sinOfrecer = tiposPermitidosCon('disparador').filter(t => !ofrecidos.has(t));
    expect(sinOfrecer.sort()).toEqual(['n8n-nodes-base.formTrigger', 'n8n-nodes-base.manualTrigger']);
    // solo el de tiempo lleva zona horaria
    expect(DISPARADORES_N8N.filter(d => d.conZona).map(d => d.nombreBase)).toEqual(['Schedule Trigger']);
  });

  it('constructor.catalogo.las_diez_apps_existen_estan_permitidas_pueden_ser_herramienta_y_su_credencial_es_del_nodo', () => {
    expect(APPS).toHaveLength(10);
    for (const app of APPS) {
      const nodo = revisar(app.tipo, app.version, app.cred.clave);
      expect(nodo?.como_herramienta, `${app.nombre} no puede ser herramienta`).toBe(true);
      expect(app.tipoHerramienta).toBe(`${app.tipo}Tool`);
      expect(PERMITIDOS.nodos.find(n => n.tipo === app.tipo)?.funcion, app.nombre).toBe('apps');
    }
    // son EXACTAMENTE las apps permitidas: si se permite otra, falta ofrecerla en el menú
    expect(APPS.map(a => a.tipo).sort()).toEqual(tiposPermitidosCon('apps').sort());
    expect(new Set(APPS.map(a => a.nombre)).size).toBe(APPS.length);
    expect(new Set(APPS.map(a => a.tipo)).size).toBe(APPS.length);
  });

  it('constructor.catalogo.la_otra_app_es_un_http_request_que_tambien_puede_ser_herramienta', () => {
    const nodo = revisar(OTRA_APP.tipo, OTRA_APP.version);
    expect(nodo?.como_herramienta).toBe(true);
    expect(OTRA_APP.tipoHerramienta).toBe(`${OTRA_APP.tipo}Tool`);
    expect(OTRA_APP.paramsPaso()).toEqual({ method: 'POST', url: '', options: {} });
    expect(OTRA_APP.paramsHerramienta()).toEqual({ method: 'GET', url: '', options: {} });
    expect(OTRA_APP.nota('HubSpot')).toBe('Configura aquí la API de HubSpot.');
  });

  it('constructor.catalogo.el_agente_existe_y_el_ayudante_agent_tool_aun_no_esta_permitido_decision_d4', () => {
    const agente = revisar(AGENTE_N8N.tipo, AGENTE_N8N.version);
    expect(agente?.disparador).toBe(false);
    expect(AGENTE_N8N.nombreBase).toBe('AI Agent');
    // El ayudante: existe en el catálogo, con la versión por defecto, pero permitidos.json NO lo trae. El validador
    // de Python lo rechaza hoy («Este nodo aún no lo soportamos: AI Agent Tool»). Si el dueño lo permite
    // (informe 06 §3), esta prueba falla a propósito: borra la excepción y deja que `revisar` lo cubra.
    const ayudante = CATALOGO.nodos[AYUDANTE_N8N.tipo];
    expect(ayudante, 'agentTool no está en catalog.json').toBeDefined();
    expect(ayudante?.versiones).toContain(AYUDANTE_N8N.version);
    expect(AYUDANTE_N8N.version).toBe(ayudante?.version_por_defecto);
    expect(
      PERMITIDOS_TIPOS.has(AYUDANTE_N8N.tipo),
      'agentTool ya está en permitidos.json: borra esta excepción (D4) del Constructor y de la prueba de paridad',
    ).toBe(false);
  });
});

describe('datos del catálogo', () => {
  it('constructor.catalogo.las_descripciones_en_espanol_son_las_del_mockup', () => {
    expect(IAS.map(i => [i.nombre, i.detalle])).toEqual([
      ['OpenAI (GPT)', 'Necesitas tu llave de OpenAI. Es la que usamos por defecto: barata y de las más fáciles de conectar.'],
      ['Claude (Anthropic)', 'Necesitas tu llave de Anthropic.'],
      ['Gemini (Google)', 'Necesitas tu llave de Google AI.'],
      ['OpenRouter (otros modelos)', 'Una sola llave para muchos modelos: DeepSeek, Llama, Mistral y más.'],
    ]);
    expect(IAS.map(i => i.cred.nombre)).toEqual(['OpenAI', 'Anthropic', 'Google Gemini', 'OpenRouter']);
    expect(IAS.map(i => i.nodo)).toEqual([
      'OpenAI Chat Model',
      'Anthropic Chat Model',
      'Google Gemini Chat Model',
      'OpenRouter Chat Model',
    ]);
    expect(TIPOS_DISPARADOR.map(t => [t.id, t.nombre, t.detalle, t.icono])).toEqual([
      ['tiempo', 'Tiempo', 'Arranca solo, a la hora que digas.', 'reloj'],
      ['chat', 'Chat', 'Alguien le escribe en un chat.', 'chat'],
      ['web', 'Web', 'Otra página o servicio le avisa por internet.', 'web'],
      ['app', 'App', 'Pasa algo en una app, por ejemplo llega un correo.', 'app'],
    ]);
    expect(FRECUENCIAS.map(f => [f.id, f.opcion, f.corto])).toEqual([
      ['hora', 'Cada hora', 'Cada hora'],
      ['dia', 'Cada día a las 9:00', 'Cada día, 9:00'],
      ['lunes', 'Cada lunes a las 9:00', 'Cada lunes, 9:00'],
    ]);
    expect(APPS_DISPARADOR.map(a => [a.id, a.opcion, a.detalle])).toEqual([
      ['gmail', 'Gmail: llega un correo', 'Gmail: correo nuevo'],
      ['telegram', 'Telegram: llega un mensaje', 'Telegram: mensaje nuevo'],
    ]);
    expect(APPS.map(a => [a.nombre, a.cred.nombre])).toEqual([
      ['Gmail', 'Gmail'],
      ['Google Sheets', 'Google Sheets'],
      ['Slack', 'Slack'],
      ['Telegram', 'Telegram'],
      ['Notion', 'Notion'],
      ['Airtable', 'Airtable'],
      ['WhatsApp', 'WhatsApp'],
      ['Google Drive', 'Google Drive'],
      ['Google Docs', 'Google Docs'],
      ['Correo (SMTP)', 'SMTP'],
    ]);
    expect(ICONO_AGENTE).toBe('magia');
    expect(ICONO_APP).toBe('app');
  });

  it('constructor.catalogo.lo_que_hay_que_elegir_en_n8n_esta_para_cada_app_y_se_busca_sin_prototipos', () => {
    expect([...PENDIENTES.entries()]).toEqual([
      ['Gmail', 'el destinatario'],
      ['Google Sheets', 'el documento y la hoja'],
      ['Slack', 'el canal'],
      ['Telegram', 'el Chat ID'],
      ['Notion', 'la página y el título'],
      ['Airtable', 'la base, la tabla y el registro'],
      ['WhatsApp', 'el número que envía y el que recibe'],
      ['Google Drive', 'la carpeta y el archivo'],
      ['Google Docs', 'la carpeta y el título'],
      ['Correo (SMTP)', 'el remitente y el destinatario'],
    ]);
    for (const app of APPS) expect(pendienteDe(app.nombre), app.nombre).not.toBeNull();
    for (const raro of ['', 'HubSpot', 'gmail', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(pendienteDe(raro), raro).toBeNull();
    }
  });

  it('constructor.catalogo.cada_llamada_a_params_da_un_objeto_nuevo_que_no_comparte_nada_con_el_catalogo', () => {
    for (const ia of IAS) afirmarCopiaNueva(`ia ${ia.id}`, ia.params);
    for (const app of APPS) {
      afirmarCopiaNueva(`app ${app.nombre} como paso`, app.paramsPaso);
      afirmarCopiaNueva(`app ${app.nombre} como herramienta`, app.paramsHerramienta);
    }
    afirmarCopiaNueva('otra app como paso', OTRA_APP.paramsPaso);
    afirmarCopiaNueva('otra app como herramienta', OTRA_APP.paramsHerramienta);
    for (const frec of ['hora', 'dia', 'lunes'] as const) {
      afirmarCopiaNueva(`tiempo ${frec}`, () => disparadorN8n(disp('tiempo', { frec })).params(disp('tiempo', { frec })));
    }
    for (const d of DISPARADORES_N8N) afirmarCopiaNueva(d.nombreBase, () => d.params(disp('web')));
    // los textos y las definiciones se pueden leer pero no cambiar por casualidad entre llamadas
    expect(iaDe('openai').params()).toEqual(iaDe('openai').params());
  });

  it('constructor.catalogo.como_paso_la_app_usa_la_respuesta_del_agente_y_como_herramienta_el_agente_decide', () => {
    for (const app of APPS) {
      // como herramienta: nada depende de la salida de otro nodo; solo textos fijos o $fromAI
      for (const e of expresiones(app.paramsHerramienta())) {
        expect(e, `${app.nombre} herramienta`).toMatch(/^=\{\{ \$fromAI\('[A-Za-z0-9_-]+', '.*', 'string'\) \}\}$/);
      }
      // como paso: la única expresión permitida es la respuesta del agente anterior
      for (const e of expresiones(app.paramsPaso())) expect(e, `${app.nombre} paso`).toBe(SALIDA);
    }
    // las claves de $fromAI llevan solo letras, números, guion y guion bajo (≤ 64): «Telefono» va sin tilde
    for (const app of APPS) {
      for (const e of expresiones(app.paramsHerramienta())) {
        const clave = /\$fromAI\('([^']*)'/.exec(e)?.[1] ?? '';
        expect(clave, e).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      }
    }
    const porNombre = (n: string) => APPS.find(a => a.nombre === n);
    // las cinco que no llevan parámetros los configura la persona en n8n
    for (const n of ['Google Sheets', 'Notion', 'Airtable', 'Google Drive', 'Google Docs']) {
      expect(porNombre(n)?.paramsPaso(), n).toEqual({});
      expect(porNombre(n)?.paramsHerramienta(), n).toEqual({});
    }
    expect(porNombre('Gmail')?.paramsHerramienta()).toEqual({
      descriptionType: 'auto',
      resource: 'message',
      operation: 'send',
      sendTo: deIA('Para', ''),
      subject: deIA('Asunto', ''),
      emailType: 'text',
      message: deIA('Mensaje', ''),
      options: { appendAttribution: false },
    });
    expect(porNombre('WhatsApp')?.paramsHerramienta()['recipientPhoneNumber']).toBe(
      "={{ $fromAI('Telefono', 'Número con código de país', 'string') }}",
    );
    // el orden de las claves es el del archivo que se descarga
    expect(Object.keys(porNombre('Gmail')?.paramsPaso() ?? {})).toEqual([
      'resource',
      'operation',
      'sendTo',
      'subject',
      'emailType',
      'message',
      'options',
    ]);
  });

  it('constructor.catalogo.los_parametros_de_cada_disparador_dependen_de_su_frecuencia_o_su_ruta', () => {
    const params = (n: NodoDisparador) => disparadorN8n(n).params(n);
    expect(params(disp('tiempo', { frec: 'hora' }))).toEqual({ rule: { interval: [{ field: 'hours', hoursInterval: 1 }] } });
    expect(params(disp('tiempo', { frec: 'dia' }))).toEqual({ rule: { interval: [{ field: 'days', triggerAtHour: 9 }] } });
    expect(params(disp('tiempo', { frec: 'lunes' }))).toEqual({
      rule: { interval: [{ field: 'weeks', triggerAtDay: [1], triggerAtHour: 9 }] },
    });
    // una frecuencia que no se reconoce cae en «cada día»
    expect(params(disp('tiempo', { frec: 'mes' as never }))).toEqual({ rule: { interval: [{ field: 'days', triggerAtHour: 9 }] } });
    expect(params(disp('chat'))).toEqual({ public: true, options: { responseMode: 'streaming' } });
    expect(params(disp('web', { ruta: 'Mi Flujo Ñandú!' }))).toEqual({ httpMethod: 'POST', path: 'mi-flujo-nandu', options: {} });
    expect(params(disp('web', { ruta: '###' }))['path']).toBe('');
    expect(params(disp('app', { app: 'telegram' }))).toEqual({ updates: ['message'], additionalFields: {} });
    expect(params(disp('app', { app: 'gmail' }))).toEqual({
      pollTimes: { item: [{ mode: 'everyMinute' }] },
      simple: false,
      filters: {},
      options: {},
    });
    // qué nodo de n8n le toca a cada uno
    expect(disparadorN8n(disp('tiempo')).nombreBase).toBe('Schedule Trigger');
    expect(disparadorN8n(disp('chat')).nombreBase).toBe('When chat message received');
    expect(disparadorN8n(disp('web')).nombreBase).toBe('Webhook');
    expect(disparadorN8n(disp('app', { app: 'telegram' })).nombreBase).toBe('Telegram Trigger');
    expect(disparadorN8n(disp('app', { app: 'gmail' })).nombreBase).toBe('Gmail Trigger');
    // lo que no es tiempo, chat ni web se decide por la app: Telegram si es «telegram», Gmail en cualquier otro caso
    expect(disparadorN8n(disp('zzz' as never, { app: 'telegram' })).nombreBase).toBe('Telegram Trigger');
    expect(disparadorN8n(disp('zzz' as never, { app: 'otra' as never })).nombreBase).toBe('Gmail Trigger');
    expect(disparadorN8n(disp('app', { app: 'telegram' })).cred).toEqual({ clave: 'telegramApi', nombre: 'Telegram' });
    expect(disparadorN8n(disp('app', { app: 'gmail' })).cred).toEqual({ clave: 'gmailOAuth2', nombre: 'Gmail' });
    expect(disparadorN8n(disp('chat')).cred).toBeNull();
  });
});

describe('búsquedas', () => {
  it('constructor.catalogo.app_de_busca_por_nombre_y_alias_sin_mayusculas_ni_acentos', () => {
    const casos: [string, string | null][] = [
      ['Gmail', 'Gmail'],
      ['  GMAIL  ', 'Gmail'],
      ['Gmàil', 'Gmail'],
      ['google mail', 'Gmail'],
      ['Correo Gmail', 'Gmail'],
      ['Google Sheets', 'Google Sheets'],
      ['sheets', 'Google Sheets'],
      ['SHEETS', 'Google Sheets'],
      ['Hoja de cálculo', 'Google Sheets'],
      ['hojas de cálculo', 'Google Sheets'],
      ['google hojas', 'Google Sheets'],
      ['Slack', 'Slack'],
      ['drive', 'Google Drive'],
      ['DOCS', 'Google Docs'],
      ['wHaTsApP BuSiNeSs', 'WhatsApp'],
      ['Correo (SMTP)', 'Correo (SMTP)'],
      ['correo', 'Correo (SMTP)'],
      ['email', 'Correo (SMTP)'],
      ['Enviar correo', 'Correo (SMTP)'],
      ['smtp', 'Correo (SMTP)'],
      // lo que no es del catálogo
      ['HubSpot', null],
      ['Google  Sheets', null],
      ['', null],
      ['   ', null],
      ['Gmail Pro', null],
    ];
    for (const [entrada, esperado] of casos) expect(appDe(entrada)?.nombre ?? null, entrada).toBe(esperado);
    expect(appDe(null)).toBeNull();
    expect(appDe(undefined)).toBeNull();
  });

  it('constructor.catalogo.los_nombres_de_prototipo_no_son_apps_ni_ia_ni_disparadores_y_no_rompen_nada', () => {
    for (const raro of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'prototype']) {
      expect(appDe(raro), raro).toBeNull();
      expect(iaDe(raro).id, raro).toBe('openai');
      expect(tipoDeDisparador(raro).id, raro).toBe('chat');
      expect(pendienteDe(raro), raro).toBeNull();
    }
  });

  it('constructor.catalogo.los_alias_ya_estan_normalizados_y_no_se_repiten_entre_apps', () => {
    const vistos = new Map<string, string>();
    for (const app of APPS) {
      expect(app.alias.length, app.nombre).toBeGreaterThan(0);
      for (const alias of app.alias) {
        expect(norm(alias), `alias «${alias}» de ${app.nombre}`).toBe(alias);
        expect(vistos.get(alias), `alias «${alias}» repetido`).toBeUndefined();
        vistos.set(alias, app.nombre);
      }
      // el nombre de una app no es alias de otra
      expect(vistos.get(norm(app.nombre)) ?? app.nombre, app.nombre).toBe(app.nombre);
      // y cada app se encuentra a sí misma
      expect(appDe(app.nombre)?.nombre, app.nombre).toBe(app.nombre);
    }
  });

  it('constructor.catalogo.ia_de_y_tipo_de_disparador_caen_en_openai_y_chat', () => {
    expect(iaDe('anthropic').nombre).toBe('Claude (Anthropic)');
    expect(iaDe('gemini').id).toBe('gemini');
    expect(iaDe('openrouter').id).toBe('openrouter');
    for (const raro of ['', 'gpt', undefined, null, 3]) expect(iaDe(raro).id).toBe('openai');
    expect(tipoDeDisparador('tiempo').nombre).toBe('Tiempo');
    expect(tipoDeDisparador('web').nombre).toBe('Web');
    expect(tipoDeDisparador('app').nombre).toBe('App');
    for (const raro of ['', 'zzz', undefined, null]) expect(tipoDeDisparador(raro).id).toBe('chat');
  });
});
