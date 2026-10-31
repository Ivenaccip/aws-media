// Los 40 casos del harness del mockup (prueba/harness.cjs:15-70), escritos en TypeScript: 34 flujos
// que se exportan (31 «buenos» + las 3 muestras del Asistente) y 6 que deben ser rechazados. Mismos
// nombres, MISMO ORDEN y mismos cuadros que en casos.json, porque exportar.golden.test.ts compara el
// resultado contra ese archivo (golden/mockup-casos.json). Cada llamada arma objetos NUEVOS.
//
// Los constructores (`base`, `disp`, `ag`, `nodoApp`, `nodoAgente`, `arista`, `conversan`) también los
// usan las pruebas de exportar.test.ts para armar flujos a mano.

import { APPS } from '../catalogo';
import { ejemplo, muestras } from '../ejemplos';
import type { Arista, Flujo, NodoAgente, NodoApp, NodoDisparador, TipoArista } from '../tipos';

/** Un caso del golden: un nombre y el flujo del lienzo del que sale. */
export interface CasoGolden {
  nombre: string;
  flujo: Flujo;
  /** true si el exportador debe rechazarlo (hay errores y no hay archivo). */
  rechazado: boolean;
}

// ---------------------------------------------------------------- constructores (los del harness)

/** El punto de partida de casi todos los casos: el ejemplo (chat → «Atención a clientes» → «Revisor»). */
export function base(): Flujo {
  return { ...ejemplo(), nombreFlujo: 'Atención a clientes' };
}

/** El disparador del flujo (falla si no hay). */
export function disp(st: Flujo): NodoDisparador {
  const t = st.nodes.find((n): n is NodoDisparador => n.kind === 'trigger');
  if (!t) throw new Error('el flujo no tiene disparador');
  return t;
}

/** El agente con ese id (falla si no existe o no es un agente). */
export function ag(st: Flujo, id: string): NodoAgente {
  const n = st.nodes.find((x): x is NodoAgente => x.id === id && x.kind === 'agent');
  if (!n) throw new Error(`no hay agente ${id}`);
  return n;
}

/** Agrega una app (a 100, 330, como en el harness). */
export function nodoApp(st: Flujo, id: string, nombre: string): NodoApp {
  const n: NodoApp = { id, kind: 'app', x: 100, y: 330, nombre };
  st.nodes.push(n);
  return n;
}

/** Agrega un agente (a 100, 100) que ya trae descripción de ayudante, como en el harness. */
export function nodoAgente(st: Flujo, id: string, nombre: string, extra: Partial<NodoAgente> = {}): NodoAgente {
  const n: NodoAgente = {
    id,
    kind: 'agent',
    x: 100,
    y: 100,
    nombre,
    ia: 'openai',
    tarea: '',
    desc: `Ayuda con ${nombre}.`,
    instrucciones: 'Sé breve.',
    ...extra,
  };
  st.nodes.push(n);
  return n;
}

/** Agrega una conexión con el id del harness (`x<n><de><a>`). */
export function arista(st: Flujo, de: string, a: string, tipo: TipoArista): Arista {
  const e: Arista = { id: `x${st.edges.length}${de}${a}`, de, a, tipo };
  st.edges.push(e);
  return e;
}

/** Hace que `a` converse con `de` (ida y vuelta): vuelve `tool` la conexión que ya hubiera o crea una, y le pone descripción a `a`. */
export function conversan(st: Flujo, de: string, a: string): void {
  const e = st.edges.find(x => x.de === de && x.a === a);
  if (e) e.tipo = 'tool';
  else arista(st, de, a, 'tool');
  const ayudante = ag(st, a);
  ayudante.desc = ayudante.desc || 'Revisa y critica.';
}

// ---------------------------------------------------------------- los casos

function caso(nombre: string, mod: (st: Flujo) => void, rechazado = false): CasoGolden {
  const flujo = base();
  mod(flujo);
  return { nombre, flujo, rechazado };
}

const sinAgentes = (st: Flujo): void => {
  st.nodes = st.nodes.filter(n => n.kind !== 'agent');
  st.edges = [];
};

/** Los flujos «buenos» (31), en el orden de casos.json. */
function buenos(): CasoGolden[] {
  const lista: CasoGolden[] = [];
  const agrega = (nombre: string, mod: (st: Flujo) => void): void => {
    lista.push(caso(nombre, mod));
  };
  // el ejemplo: Chat → «Atención a clientes» [Google Sheets] → «Revisor» [Slack]
  agrega('ejemplo', () => {});
  for (const frec of ['hora', 'dia', 'lunes'] as const) {
    agrega(`tiempo_${frec}`, st => {
      Object.assign(disp(st), { tipo: 'tiempo', frec });
      ag(st, 'a1').tarea = 'Resume lo importante.';
    });
  }
  agrega('web', st => {
    Object.assign(disp(st), { tipo: 'web', ruta: 'Mi Flujo Ñandú!' });
    ag(st, 'a1').tarea = 'Procesa el pedido.';
  });
  agrega('app_gmail', st => {
    Object.assign(disp(st), { tipo: 'app', app: 'gmail' });
    ag(st, 'a1').tarea = 'Contesta.';
  });
  agrega('app_telegram', st => {
    Object.assign(disp(st), { tipo: 'app', app: 'telegram' });
    ag(st, 'a1').tarea = 'Contesta.';
  });
  for (const ia of ['openai', 'anthropic', 'gemini', 'openrouter'] as const) {
    agrega(`ia_${ia}`, st => {
      ag(st, 'a1').ia = ia;
      ag(st, 'a2').ia = ia;
    });
  }
  agrega('cadena_app_app', st => {
    Object.assign(disp(st), { tipo: 'tiempo' });
    ag(st, 'a1').tarea = 'Resume.';
    st.edges = [];
    nodoApp(st, 'g', 'Gmail');
    arista(st, 't1', 'a1', 'seq');
    arista(st, 'a1', 'g', 'seq');
    arista(st, 'g', 'p2', 'seq');
  });
  agrega('agente_a_agente_paso', st => {
    Object.assign(disp(st), { tipo: 'web', ruta: 'x' });
    ag(st, 'a1').tarea = 'Analiza.';
    ag(st, 'a2').tarea = 'Redacta.';
    st.edges = [];
    arista(st, 't1', 'a1', 'seq');
    arista(st, 'a1', 'a2', 'seq');
    arista(st, 'a2', 'p2', 'seq');
  });
  agrega('agente_con_dos_herramientas', st => {
    nodoApp(st, 'p3', 'Notion');
    arista(st, 'a2', 'p3', 'tool');
  });
  agrega('tres_agentes_en_cadena', st => {
    nodoAgente(st, 'a3', 'Verificador');
    arista(st, 'a2', 'a3', 'seq');
  });
  agrega('dos_IA_conversan', st => {
    conversan(st, 'a1', 'a2');
    ag(st, 'a2').desc = 'Revisa el tono y señala qué mejorar.';
  });
  agrega('conversan_y_luego_un_paso', st => {
    conversan(st, 'a1', 'a2');
    nodoApp(st, 'g', 'Gmail');
    arista(st, 'a2', 'g', 'seq');
  });
  agrega('conversan_en_cadena', st => {
    conversan(st, 'a1', 'a2');
    nodoAgente(st, 'a3', 'Verificador');
    arista(st, 'a2', 'a3', 'tool');
  });
  agrega('una_IA_con_dos_que_conversan', st => {
    conversan(st, 'a1', 'a2');
    nodoAgente(st, 'a3', 'Traductor');
    arista(st, 'a1', 'a3', 'tool');
  });
  agrega('dos_parejas_en_secuencia', st => {
    conversan(st, 'a1', 'a2');
    nodoAgente(st, 'a3', 'Redactor');
    nodoAgente(st, 'a4', 'Crítico');
    arista(st, 'a2', 'a3', 'seq');
    arista(st, 'a3', 'a4', 'tool');
  });
  agrega('cuatro_agentes_en_abanico', st => {
    nodoAgente(st, 'a3', 'Verificador');
    nodoAgente(st, 'a4', 'Traductor');
    arista(st, 'a1', 'a3', 'seq');
    arista(st, 'a1', 'a4', 'seq');
  });
  agrega('disparador_directo_a_app', st => {
    sinAgentes(st);
    arista(st, 't1', 'p2', 'seq');
  });
  agrega('app_desconocida_paso_y_herramienta', st => {
    nodoApp(st, 'p8', 'HubSpot');
    nodoApp(st, 'p9', 'Zendesk');
    arista(st, 'a1', 'p8', 'seq');
    arista(st, 'a1', 'p9', 'tool');
  });
  agrega('todas_las_apps_como_herramienta', st => {
    st.nodes = st.nodes.filter(n => n.kind !== 'app');
    st.edges = st.edges.filter(e => e.tipo === 'seq');
    APPS.forEach((a, i) => {
      nodoApp(st, `q${i}`, a.nombre);
      arista(st, 'a1', `q${i}`, 'tool');
    });
  });
  agrega('todas_las_apps_como_paso', st => {
    st.nodes = st.nodes.filter(n => n.kind !== 'app');
    st.edges = st.edges.filter(e => e.tipo === 'seq');
    APPS.forEach((a, i) => {
      nodoApp(st, `q${i}`, a.nombre);
      arista(st, 'a2', `q${i}`, 'seq');
    });
  });
  agrega('abanico_de_pasos', st => {
    nodoApp(st, 'p3', 'Telegram');
    arista(st, 'a2', 'p3', 'seq');
  });
  agrega('nombres_repetidos', st => {
    nodoAgente(st, 'a3', 'Gmail');
    nodoAgente(st, 'a5', 'Revisor');
    nodoApp(st, 'p8', 'gmail');
    nodoApp(st, 'p7', 'AI Agent');
    arista(st, 'a1', 'a3', 'seq');
    arista(st, 'a1', 'a5', 'seq');
    arista(st, 'a1', 'p8', 'tool');
    arista(st, 'a1', 'p7', 'seq');
  });
  agrega('nombre_con_comillas', st => {
    ag(st, 'a1').nombre = "Atención d'Ana";
    nodoApp(st, 'g', 'Gmail');
    arista(st, 'a2', 'g', 'seq');
    nodoApp(st, 'g2', 'Slack');
    arista(st, 'g', 'g2', 'seq');
  });
  agrega('nombre_flujo_vacio', st => {
    st.nombreFlujo = '   ';
  });
  agrega('lienzo_sin_agente_aviso', st => {
    sinAgentes(st);
    arista(st, 't1', 'p2', 'seq');
  });
  agrega('nodo_suelto_aviso', st => {
    nodoApp(st, 'p9', 'Notion');
  });
  return lista;
}

/** Las 3 muestras del Asistente enlatado, exportadas como flujos (muestra_0, muestra_1, muestra_2). */
function deLasMuestras(): CasoGolden[] {
  return muestras().map((mu, i) => ({
    nombre: `muestra_${i}`,
    flujo: { nodes: mu.nodes, edges: mu.edges, nombreFlujo: mu.nombre },
    rechazado: false,
  }));
}

/** Los 6 flujos que el exportador debe rechazar. */
function rechazados(): CasoGolden[] {
  return [
    caso('err_sin_trigger', st => {
      st.nodes = st.nodes.filter(n => n.kind !== 'trigger');
      st.edges = st.edges.filter(e => e.de !== 't1');
    }, true),
    caso('err_trigger_sin_salida', st => {
      st.edges = st.edges.filter(e => e.de !== 't1');
    }, true),
    caso('err_web_sin_ruta', st => {
      Object.assign(disp(st), { tipo: 'web', ruta: '  ' });
      ag(st, 'a1').tarea = 'x';
    }, true),
    caso('err_sin_tarea_tras_disparador', st => {
      Object.assign(disp(st), { tipo: 'tiempo' });
      ag(st, 'a1').tarea = '';
    }, true),
    caso('err_ayudante_sin_descripcion', st => {
      conversan(st, 'a1', 'a2');
      ag(st, 'a2').desc = '  ';
    }, true),
    caso('err_app_sin_nombre', st => {
      nodoApp(st, 'p6', ' ');
    }, true),
  ];
}

/** Los 40 casos, en el orden de casos.json: 31 buenos, 3 muestras, 6 rechazados. */
export function casosGolden(): CasoGolden[] {
  return [...buenos(), ...deLasMuestras(), ...rechazados()];
}
