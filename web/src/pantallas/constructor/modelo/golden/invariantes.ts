// Lo que TODO archivo que sale del exportador debe cumplir, sea cual sea el flujo del que venga.
// Es un oráculo: no arma nada, mira un FlujoN8n ya hecho y devuelve los códigos de lo que viola
// (vacío = bien). Lo usan el golden (los 34 flujos) y las pruebas de propiedades de exportar.test.ts.
// Sale de las revisiones del harness del mockup (harness.cjs:72-96), de fuzz.cjs (chequearFlujo) y
// de test_reglas_extra_del_constructor del informe 06 §5.4.

import { DISPARADORES_N8N, IAS } from '../catalogo';
import { claveEnFlujo, type FlujoN8n, type NodoN8n } from '../exportar';

const AGENTE = '@n8n/n8n-nodes-langchain.agent';
const AYUDANTE = '@n8n/n8n-nodes-langchain.agentTool';
const TIPOS_DISPARADOR: ReadonlySet<string> = new Set(DISPARADORES_N8N.map(d => d.tipo));
const TIPOS_MODELO: ReadonlySet<string> = new Set(IAS.map(i => i.tipo));
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Cuántos nodos puede tener un archivo: 1 disparador + 4 agentes con su modelo + 8 apps. */
export const MAX_NODOS_N8N = 1 + 4 * 2 + 8;

const esHerramientaDeApp = (n: NodoN8n): boolean => /Tool$/.test(n.type) && n.type !== AYUDANTE;

function* valoresYClaves(valor: unknown, ruta: string): Generator<{ ruta: string; clave?: string; valor: unknown }> {
  if (Array.isArray(valor)) {
    for (const [i, v] of valor.entries()) yield* valoresYClaves(v, `${ruta}[${i}]`);
  } else if (valor !== null && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) {
      yield { ruta: `${ruta}.${k}`, clave: k, valor: v };
      yield* valoresYClaves(v, `${ruta}.${k}`);
    }
  } else {
    yield { ruta, valor };
  }
}

/** Los códigos de lo que el archivo viola. */
export function violacionesDelFlujo(flujo: FlujoN8n): string[] {
  const v: string[] = [];
  const nodos = flujo.nodes;
  const porNombre = new Map<string, NodoN8n>();
  for (const n of nodos) {
    if (porNombre.has(n.name)) v.push(`nombre repetido «${n.name}»`);
    porNombre.set(n.name, n);
  }

  // ---- forma
  if (flujo.name.length < 1 || flujo.name.length > 200) v.push('el nombre del flujo no mide entre 1 y 200');
  if (JSON.stringify(flujo.pinData) !== '{}') v.push('pinData no está vacío');
  if (JSON.stringify(flujo.settings.executionOrder) !== '"v1"') v.push('executionOrder no es v1');
  if (nodos.length < 1 || nodos.length > MAX_NODOS_N8N) v.push(`hay ${nodos.length} nodos`);
  const ids = nodos.map(n => n.id);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) v.push('ids de nodo vacíos o repetidos');
  for (const n of nodos) {
    if (n.name.length < 1 || n.name.length > 128) v.push(`el nombre «${n.name}» no mide entre 1 y 128`);
    if (n.position.length !== 2 || !n.position.every(c => Number.isFinite(c))) v.push(`posición inválida en «${n.name}»`);
    for (const [clave, cred] of Object.entries(n.credentials ?? {})) {
      if (cred.id !== '' || !cred.name) v.push(`credencial «${clave}» de «${n.name}» no es una referencia vacía`);
    }
  }
  if (JSON.stringify(JSON.parse(JSON.stringify(flujo))) !== JSON.stringify(flujo)) v.push('el JSON no vuelve igual (hay undefined o NaN)');
  for (const x of valoresYClaves(flujo, '')) {
    if (x.clave === undefined && x.valor === null) v.push(`valor null en ${x.ruta}`);
    if (x.clave === '__proto__') v.push(`clave __proto__ en ${x.ruta}`);
  }
  if (Object.getPrototypeOf(flujo.connections) !== Object.prototype) v.push('connections no es un objeto simple');
  if (claveEnFlujo(flujo)) v.push('el archivo lleva algo que parece una clave');

  // ---- el disparador
  const disparadores = nodos.filter(n => TIPOS_DISPARADOR.has(n.type));
  if (disparadores.length !== 1) v.push(`hay ${disparadores.length} disparadores`);
  else {
    if (nodos[0] !== disparadores[0]) v.push('el disparador no es el primer nodo');
    if (!flujo.connections[disparadores[0]?.name ?? '']?.main?.[0]?.length) v.push('el disparador no tiene salida main');
  }
  const webhooks = nodos.flatMap(n => (n.webhookId === undefined ? [] : [n.webhookId]));
  if (webhooks.some(w => !UUID_V4.test(w)) || new Set(webhooks).size !== webhooks.length) v.push('webhookId inválido o repetido');

  // ---- las conexiones
  const modelosPorDestino = new Map<string, number>();
  for (const [origen, porTipo] of Object.entries(flujo.connections)) {
    const nOrigen = porNombre.get(origen);
    if (!nOrigen) {
      v.push(`conexión desde «${origen}», que no es ningún nodo`);
      continue;
    }
    for (const [tipo, ramas] of Object.entries(porTipo)) {
      if (ramas.length !== 1) v.push(`«${origen}» ${tipo} no tiene exactamente una rama`);
      for (const rama of ramas) {
        const vistos = new Set<string>();
        for (const d of rama) {
          if (d.type !== tipo || d.index !== 0) v.push(`conexión ${origen} → ${d.node}: tipo o índice mal`);
          if (!porNombre.has(d.node)) v.push(`conexión de «${origen}» a «${d.node}», que no es ningún nodo`);
          if (d.node === origen) v.push(`«${origen}» se conecta consigo mismo`);
          if (vistos.has(d.node)) v.push(`conexión repetida ${origen} → ${d.node} (${tipo})`);
          vistos.add(d.node);
          if (tipo === 'ai_languageModel') {
            if (!TIPOS_MODELO.has(nOrigen.type)) v.push(`«${origen}» da un modelo y no es un modelo de chat`);
            modelosPorDestino.set(d.node, (modelosPorDestino.get(d.node) ?? 0) + 1);
          }
        }
      }
    }
  }

  // ---- agentes, ayudantes y herramientas
  for (const n of nodos) {
    const sale = flujo.connections[n.name] ?? {};
    if (n.type === AGENTE || n.type === AYUDANTE) {
      if (modelosPorDestino.get(n.name) !== 1) v.push(`«${n.name}» recibe ${modelosPorDestino.get(n.name) ?? 0} modelos de chat`);
    }
    if (TIPOS_MODELO.has(n.type) && Object.keys(sale).join() !== 'ai_languageModel') v.push(`el modelo «${n.name}» no solo da ai_languageModel`);
    if (n.type === AYUDANTE) {
      if (sale.main) v.push(`el ayudante «${n.name}» tiene salida main`);
      const aT = sale.ai_tool?.[0] ?? [];
      const destino = aT.length === 1 ? porNombre.get(aT[0]?.node ?? '') : undefined;
      if (!destino || (destino.type !== AGENTE && destino.type !== AYUDANTE)) v.push(`el ayudante «${n.name}» no cuelga de un solo agente`);
      if (!n.parameters.toolDescription || !n.parameters.text) v.push(`el ayudante «${n.name}» no trae descripción y texto`);
    }
    if (esHerramientaDeApp(n)) {
      if (!/^n8n-nodes-base\./.test(n.type)) v.push(`la herramienta «${n.name}» no es una app`);
      if (sale.main) v.push(`la herramienta «${n.name}» tiene salida main`);
      const aT = sale.ai_tool?.[0] ?? [];
      const destino = aT.length === 1 ? porNombre.get(aT[0]?.node ?? '') : undefined;
      // cuelga de un agente o de un ayudante (un agente que conversa con otro también tiene sus herramientas)
      if (!destino || (destino.type !== AGENTE && destino.type !== AYUDANTE)) v.push(`la herramienta «${n.name}» no cuelga de un solo agente`);
    }
  }
  const recibenMain = new Set(Object.values(flujo.connections).flatMap(c => (c.main ?? []).flatMap(r => r.map(d => d.node))));
  for (const n of nodos) {
    if ((n.type === AYUDANTE || esHerramientaDeApp(n)) && recibenMain.has(n.name)) v.push(`«${n.name}» recibe main y es herramienta`);
  }
  return v;
}

/** Cada cadena del flujo que empieza con «=» (n8n la toma por expresión), con dónde está. */
export function expresionesDelFlujo(flujo: FlujoN8n): { ruta: string; texto: string }[] {
  const salida: { ruta: string; texto: string }[] = [];
  for (const n of flujo.nodes) {
    for (const x of valoresYClaves(n.parameters, `${n.name}`)) {
      if (x.clave === undefined && typeof x.valor === 'string' && x.valor.startsWith('=')) salida.push({ ruta: x.ruta, texto: x.valor });
    }
  }
  return salida;
}
