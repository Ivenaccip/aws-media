// La prueba dorada del exportador, en dos mitades:
//
//   1. EL PORTE contra el mockup. golden/mockup-casos.json es casos.json tal como lo escribió el harness del
//      mockup (40 casos: 34 flujos y 6 rechazos). El exportador de producción debe reproducirlo BYTE A BYTE,
//      salvo las diferencias deliberadas de golden/LEEME.md, que esta prueba nombra una por una: si cambia
//      cualquier otra cosa (un texto, el orden de una clave, un id), falla.
//   2. EL GOLDEN DE PRODUCCIÓN. golden/flujos.json es lo que sale hoy del exportador para esos mismos casos
//      (más el índice de los que usan agentTool). tests/test_constructor_flujos.py lo pasa por el validador de
//      Python. Esta prueba lo compara; con ACTUALIZAR_DORADO=1 lo reescribe:
//          ACTUALIZAR_DORADO=1 npx vitest run src/pantallas/constructor/modelo/exportar.golden.test.ts
//      Sin esa variable, un archivo que falta o que cambió FALLA (nada se escribe en silencio).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { construirFlujo, revisarFlujo, type FlujoN8n } from './exportar';
import { casosGolden } from './golden/casos';
import { violacionesDelFlujo } from './golden/invariantes';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'golden');
const TEXTO_MOCKUP = readFileSync(resolve(DIR, 'mockup-casos.json'), 'utf8');
const RUTA_FLUJOS = resolve(DIR, 'flujos.json');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AGENT_TOOL = '@n8n/n8n-nodes-langchain.agentTool';

interface NodoGolden {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  webhookId?: string;
}
interface CasoGuardado {
  errores: string[];
  avisos: string[];
  flujo: { nodes: NodoGolden[] } | null;
}

/** Lo que el exportador de producción da para los 40 casos, con la zona «UTC» (la del harness del mockup). */
function salidaDeProduccion(): Record<string, CasoGuardado> {
  const salida: Record<string, CasoGuardado> = {};
  for (const c of casosGolden()) {
    const v = construirFlujo(c.flujo, { zona: 'UTC' });
    salida[c.nombre] = { errores: v.errores, avisos: v.avisos, flujo: v.flujo as unknown as CasoGuardado['flujo'] };
  }
  return salida;
}

/** Aplica al casos.json del mockup las diferencias deliberadas, y cuenta dónde. */
function conLasDiferenciasDeliberadas(mockup: Record<string, CasoGuardado>, produccion: Record<string, CasoGuardado>) {
  const cuenta = { modelosDeAnthropic: 0, webhookIds: 0, agentesSueltos: [] as string[] };
  for (const [caso, c] of Object.entries(mockup)) {
    for (const n of c.flujo?.nodes ?? []) {
      // D5 (datos): Anthropic ya no fija el modelo `claude-haiku-5-5`, que no existe en el repo
      if (n.type === '@n8n/n8n-nodes-langchain.lmChatAnthropic') {
        delete n.parameters.model;
        cuenta.modelosDeAnthropic += 1;
      }
      // corrección: el webhookId depende del flujo (en el mockup era el mismo en los 26 flujos con chat o webhook)
      if (n.webhookId !== undefined) {
        const nuevo = produccion[caso]?.flujo?.nodes.find(x => x.name === n.name)?.webhookId;
        expect(nuevo, `${caso}: el webhookId de «${n.name}»`).toMatch(UUID_V4);
        expect(nuevo).not.toBe(n.webhookId);
        n.webhookId = nuevo as string;
        cuenta.webhookIds += 1;
      }
      // corrección: un agente suelto sin tarea ya no manda `promptType` con un `text` vacío
      if (n.type === '@n8n/n8n-nodes-langchain.agent' && n.parameters.text === '') {
        delete n.parameters.promptType;
        delete n.parameters.text;
        cuenta.agentesSueltos.push(`${caso}/${n.name}`);
      }
    }
  }
  return cuenta;
}

describe('el porte contra el mockup', () => {
  it('constructor.golden.el_porte_reproduce_los_40_casos_del_mockup_byte_a_byte_salvo_las_diferencias_deliberadas', () => {
    // el archivo es exactamente lo que escribe JSON.stringify(…, null, 1): se puede comparar como texto
    expect(TEXTO_MOCKUP).toBe(JSON.stringify(JSON.parse(TEXTO_MOCKUP), null, 1));
    const mockup = JSON.parse(TEXTO_MOCKUP) as Record<string, CasoGuardado>;
    const produccion = salidaDeProduccion();
    expect(Object.keys(produccion)).toEqual(Object.keys(mockup));
    expect(Object.keys(mockup)).toHaveLength(40);

    const cuenta = conLasDiferenciasDeliberadas(mockup, produccion);
    // las diferencias son exactamente estas y no otras
    expect(cuenta.webhookIds).toBe(26);
    expect(cuenta.agentesSueltos).toEqual(['cadena_app_app/Revisor']);
    expect(cuenta.modelosDeAnthropic).toBeGreaterThan(0);

    expect(JSON.stringify(produccion, null, 1)).toBe(JSON.stringify(mockup, null, 1));
  });

  it('constructor.golden.sin_las_diferencias_deliberadas_solo_difieren_los_flujos_que_las_tienen', () => {
    const mockup = JSON.parse(TEXTO_MOCKUP) as Record<string, CasoGuardado>;
    const produccion = salidaDeProduccion();
    const distintos = Object.keys(mockup).filter(k => JSON.stringify(mockup[k]) !== JSON.stringify(produccion[k]));
    const conDiferencia = Object.entries(mockup)
      .filter(([, c]) =>
        (c.flujo?.nodes ?? []).some(
          n => n.webhookId !== undefined || n.type.endsWith('lmChatAnthropic') || (n.type.endsWith('.agent') && n.parameters.text === ''),
        ),
      )
      .map(([k]) => k);
    expect(distintos).toEqual(conDiferencia);
    // y los otros 6 casos (los rechazos) son idénticos al mockup, palabra por palabra
    for (const k of Object.keys(mockup).filter(n => n.startsWith('err_'))) expect(produccion[k]).toEqual(mockup[k]);
  });

  it('constructor.golden.los_errores_y_los_avisos_son_los_mismos_textos_del_mockup_y_los_6_rechazos_no_dan_archivo', () => {
    const mockup = JSON.parse(TEXTO_MOCKUP) as Record<string, CasoGuardado>;
    let rechazos = 0;
    for (const c of casosGolden()) {
      const esperado = mockup[c.nombre];
      expect(esperado, c.nombre).toBeDefined();
      // la revisión barata y la completa dicen lo mismo, y es lo que dijo el mockup
      const r = revisarFlujo(c.flujo);
      expect(r.errores, c.nombre).toEqual(esperado?.errores);
      expect(r.avisos, c.nombre).toEqual(esperado?.avisos);
      const v = construirFlujo(c.flujo, { zona: 'UTC' });
      expect(v.errores, c.nombre).toEqual(esperado?.errores);
      expect(v.avisos, c.nombre).toEqual(esperado?.avisos);
      expect(v.flujo === null, c.nombre).toBe(v.errores.length > 0);
      expect(v.flujo === null, c.nombre).toBe(c.rechazado);
      if (c.rechazado) {
        rechazos += 1;
        expect(v.json).toBe('');
        expect(v.errores).toHaveLength(1);
      }
    }
    expect(rechazos).toBe(6);
  });
});

describe('el golden de producción', () => {
  /** El documento de golden/flujos.json: el índice de los que usan agentTool y los 40 casos. */
  function documento() {
    const produccion = salidaDeProduccion();
    const usanAgentTool: string[] = [];
    const rechazados: string[] = [];
    const casos: Record<string, CasoGuardado & { usaAgentTool: boolean }> = {};
    for (const [nombre, c] of Object.entries(produccion)) {
      const usa = (c.flujo?.nodes ?? []).some(n => n.type === AGENT_TOOL);
      if (usa) usanAgentTool.push(nombre);
      if (c.flujo === null) rechazados.push(nombre);
      casos[nombre] = { errores: c.errores, avisos: c.avisos, usaAgentTool: usa, flujo: c.flujo };
    }
    return {
      formato: 1,
      generadoPor: 'web/src/pantallas/constructor/modelo/exportar.golden.test.ts (ACTUALIZAR_DORADO=1). No se edita a mano.',
      zona: 'UTC',
      usanAgentTool,
      rechazados,
      casos,
    };
  }

  it('constructor.golden.flujos_json_es_lo_que_sale_hoy_del_exportador_y_solo_se_reescribe_con_actualizar_dorado', () => {
    const esperado = `${JSON.stringify(documento(), null, 2)}\n`;
    if (process.env.ACTUALIZAR_DORADO === '1') {
      writeFileSync(RUTA_FLUJOS, esperado, 'utf8');
      return;
    }
    let guardado: string | null = null;
    try {
      guardado = readFileSync(RUTA_FLUJOS, 'utf8');
    } catch {
      guardado = null;
    }
    expect(guardado, 'falta golden/flujos.json: corre con ACTUALIZAR_DORADO=1').not.toBeNull();
    expect(guardado === esperado, 'golden/flujos.json no coincide con lo que da el exportador: revisa el cambio y, si es a propósito, corre con ACTUALIZAR_DORADO=1').toBe(true);
  });

  it('constructor.golden.los_flujos_con_agent_tool_estan_marcados_en_el_indice_y_en_cada_caso', () => {
    const d = documento();
    // son los 5 que el validador de hoy rechaza solo por agentTool (informe 06 §2)
    expect(d.usanAgentTool).toEqual([
      'dos_IA_conversan',
      'conversan_y_luego_un_paso',
      'conversan_en_cadena',
      'una_IA_con_dos_que_conversan',
      'dos_parejas_en_secuencia',
    ]);
    for (const [nombre, c] of Object.entries(d.casos)) expect(c.usaAgentTool, nombre).toBe(d.usanAgentTool.includes(nombre));
    expect(d.rechazados).toEqual([
      'err_sin_trigger',
      'err_trigger_sin_salida',
      'err_web_sin_ruta',
      'err_sin_tarea_tras_disparador',
      'err_ayudante_sin_descripcion',
      'err_app_sin_nombre',
    ]);
    expect(Object.values(d.casos).filter(c => c.flujo !== null)).toHaveLength(34);
  });

  it('constructor.golden.los_34_archivos_cumplen_los_invariantes_de_n8n', () => {
    const d = documento();
    let revisados = 0;
    for (const [nombre, c] of Object.entries(d.casos)) {
      if (c.flujo === null) continue;
      revisados += 1;
      expect(violacionesDelFlujo(c.flujo as unknown as FlujoN8n), nombre).toEqual([]);
    }
    expect(revisados).toBe(34);
  });

  it('constructor.golden.cada_flujo_con_chat_o_webhook_tiene_su_propio_webhook_id', () => {
    const d = documento();
    const duenos = new Map<string, string[]>(); // webhookId → los casos que lo llevan
    const huella = new Map<string, string>(); // webhookId → el flujo sin webhookId, como texto
    let conWebhook = 0;
    for (const [nombre, c] of Object.entries(d.casos)) {
      for (const n of c.flujo?.nodes ?? []) {
        if (n.webhookId === undefined) continue;
        conWebhook += 1;
        duenos.set(n.webhookId, [...(duenos.get(n.webhookId) ?? []), nombre]);
        const sinId = JSON.stringify(c.flujo, (k, v) => (k === 'webhookId' ? '' : v));
        // el mismo webhookId solo puede repetirse si el flujo es idéntico
        expect(huella.get(n.webhookId) ?? sinId, `${nombre} repite el webhookId de otro flujo distinto`).toBe(sinId);
        huella.set(n.webhookId, sinId);
      }
    }
    // los 26 con chat o webhook, y uno solo repetido: dos casos del harness que arman EL MISMO flujo
    expect(conWebhook).toBe(26);
    const repetidos = [...duenos.values()].filter(v => v.length > 1);
    expect(repetidos).toEqual([['disparador_directo_a_app', 'lienzo_sin_agente_aviso']]);
    expect(duenos.size).toBe(25);
  });

  it('constructor.golden.solo_los_disparadores_de_tiempo_llevan_zona_y_es_la_que_se_inyecto', () => {
    const conTiempo: string[] = [];
    for (const c of casosGolden()) {
      const v = construirFlujo(c.flujo, { zona: 'America/Mexico_City' });
      if (!v.flujo) continue;
      if (v.flujo.settings.timezone !== undefined) {
        conTiempo.push(c.nombre);
        expect(v.flujo.settings.timezone).toBe('America/Mexico_City');
      }
      // sin zona inyectada, ninguno la trae
      expect(construirFlujo(c.flujo).flujo?.settings).toEqual({ executionOrder: 'v1' });
    }
    expect(conTiempo).toEqual(['tiempo_hora', 'tiempo_dia', 'tiempo_lunes', 'cadena_app_app', 'muestra_2']);
  });
});
