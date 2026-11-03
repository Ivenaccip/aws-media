// Los textos que el Constructor le dice a la persona viven en textos.ts. Esta prueba vigila dos cosas: que cada frase que
// se repetía en varios módulos (selectores.ts, grafo.ts, textos.ts) salga de UN solo lugar, y que lo que se lee no cambió
// (las frases de abajo son las literales de siempre).

import { describe, expect, it } from 'vitest';

import { TOPE_AGENTES, TOPE_APPS } from './datos/constantes';
import { ejemplo } from './ejemplos';
import { puedeEnlazar } from './grafo';
import { estadoInicial } from './reductor';
import { MOTIVO_SOLO_APPS, textoConectar, vistaMenu } from './selectores';
import * as T from './textos';
import type { EstadoConstructor, Flujo, Nodo } from './tipos';

const apps = (n: number, desde = 0): Nodo[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${desde + i + 1}`, kind: 'app' as const, x: 8 + i * 240, y: 600, nombre: `App ${desde + i + 1}` }));
const agentes = (n: number): Nodo[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `a${i + 1}`,
    kind: 'agent' as const,
    x: 8 + i * 240,
    y: 400,
    nombre: `Agente ${i + 1}`,
    ia: 'openai' as const,
    tarea: '',
    instrucciones: '',
  }));

describe('textos · cada frase repetida sale de un solo lugar', () => {
  it('constructor.textos.la_regla_de_la_patita_se_dice_igual_en_el_menu_al_conectar_y_en_el_motivo_del_cuadro', () => {
    const base = 'Por la patita solo van apps. Para que dos IA conversen, ponlas una después de otra';
    expect(T.MOTIVO_SOLO_APPS).toBe(`${base} y toca su flecha.`);
    expect(MOTIVO_SOLO_APPS).toBe(T.MOTIVO_SOLO_APPS);
    expect(T.soloAppsEnElMenu()).toEqual({ texto: `${base} con el + de la derecha y toca su flecha.`, tipo: 'mal' });
    expect(T.soloAppsAlConectar()).toEqual({ texto: `${base} y toca su flecha. Elige otro cuadro, o cancela.`, tipo: 'mal' });
  });

  it('constructor.textos.solo_un_agente_tiene_herramientas_es_la_misma_frase_en_el_aviso_y_en_la_regla_de_conexion', () => {
    const frase = 'Solo un agente de IA puede tener herramientas o conversar con otra IA.';
    expect(T.MOTIVO_SOLO_AGENTES_TIENEN_HERRAMIENTAS).toBe(frase);
    expect(T.soloAgentesTienenHerramientas()).toEqual({ texto: frase, tipo: 'mal' });
    const f = ejemplo();
    // una app no puede tener herramientas: la regla 8 de puedeEnlazar dice la misma frase
    expect(puedeEnlazar(f, 'p1', 'p2', 'tool')).toEqual({ ok: false, motivo: frase });
  });

  it('constructor.textos.el_banner_de_conectar_y_los_topes_del_menu_son_los_de_textos', () => {
    const f = ejemplo();
    const con = (tipo: 'seq' | 'tool', rol: 'origen' | 'destino'): EstadoConstructor => ({
      ...estadoInicial(f),
      conectando: { ancla: 'a1', rol, tipo },
    });
    const dicho = (tipo: 'seq' | 'tool', rol: 'origen' | 'destino') => textoConectar(con(tipo, rol));
    expect(dicho('seq', 'origen')).toBe('Toca el cuadro que irá DESPUÉS de «Atención a clientes».');
    expect(dicho('seq', 'destino')).toBe('Toca el cuadro que irá ANTES de «Atención a clientes».');
    expect(dicho('tool', 'origen')).toBe('Toca la app que «Atención a clientes» podrá usar como herramienta.');
    expect(dicho('tool', 'destino')).toBe('Toca el agente que podrá usar «Atención a clientes» como herramienta.');
    for (const tipo of ['seq', 'tool'] as const) {
      for (const rol of ['origen', 'destino'] as const) {
        expect(dicho(tipo, rol), `${tipo} ${rol}`).toBe(T.textoConectar(tipo, rol, 'Atención a clientes').texto);
      }
    }
    expect(textoConectar({ flujo: f, conectando: null })).toBe('');

    // con 8 apps y 4 agentes el menú bloquea las dos opciones con el aviso de textos.ts
    const lleno: Flujo = { nodes: [...agentes(TOPE_AGENTES), ...apps(TOPE_APPS)], edges: [], nombreFlujo: 'x' };
    const menu = vistaMenu({ ...estadoInicial(lleno), menu: { ancla: 'a1', tipo: 'seq', paso: 'inicio', insertarEn: null } });
    const porId = (id: string) => menu?.opciones.find(o => o.id === id);
    expect(porId('app')?.motivo).toBe(T.topeApps().texto);
    expect(porId('app')?.motivo).toBe(`Por ahora son hasta ${TOPE_APPS} apps por flujo.`);
    expect(porId('agente')?.motivo).toBe(T.topeAgentes().texto);
    expect(porId('agente')?.motivo).toBe(`Por ahora son hasta ${TOPE_AGENTES} agentes por flujo.`);
  });

  it('constructor.textos.un_flujo_de_afuera_rechazado_dice_por_que_sin_repetir_la_clave', () => {
    expect(T.flujoRechazado(['con-clave'])).toEqual({
      texto: 'No pudimos abrir ese flujo: trae una clave pegada. Las claves se ponen en n8n al conectar la cuenta, nunca dentro del flujo.',
      tipo: 'mal',
    });
    expect(T.flujoRechazado(['tope-cuadros']).texto).toBe('No pudimos abrir ese flujo: es demasiado grande y por ahora el Constructor admite hasta 13 cuadros.');
    expect(T.flujoRechazado(['tope-conexiones']).texto).toBe(T.flujoRechazado(['tope-cuadros']).texto);
    expect(T.flujoRechazado(['forma']).texto).toBe('No pudimos abrir ese flujo: no se puede dibujar en el Constructor.');
    // los topes de siempre no cambian
    expect(T.flujoRechazado(['tope-apps']).texto).toContain('más de 8 apps');
    expect(T.flujoRechazado(['tope-agentes']).texto).toContain('más de 4 agentes');
    expect(T.flujoRechazado(['varios-disparadores']).texto).toContain('más de un disparador');
  });
});
