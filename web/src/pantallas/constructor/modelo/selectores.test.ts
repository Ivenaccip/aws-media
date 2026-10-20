import { describe, expect, it } from 'vitest';

import type { NombreIcono } from '../../../ui/iconos';
import { APPS } from './catalogo';
import { ejemplo, muestras } from './ejemplos';
import { revisarFlujo } from './exportar';
import {
  flagsMas,
  guia,
  MOTIVO_SOLO_APPS,
  panelDeAjustes,
  resumenFlujo,
  textoConectar,
  textoSinSeleccion,
  vistaAjustes,
  vistaElegirDisparador,
  vistaEnlace,
  vistaFlechas,
  vistaLienzo,
  vistaMenu,
  vistaNodo,
  vistaNodos,
  type AjustesAgente,
  type AjustesApp,
  type AjustesDisparador,
  type EstadoVista,
  type IconoFlecha,
  type IconoNodo,
  type OpcionMenu,
  type VistaNodo,
} from './selectores';
import type { Arista, Conectando, EstadoConstructor, Flujo, MenuMas, Nodo, NodoAgente, NodoApp, NodoDisparador, TipoArista } from './tipos';

// ---------------------------------------------------------------- constructores de prueba

const agente = (id: string, x: number, y: number, nombre: string, extra: Partial<NodoAgente> = {}): NodoAgente => ({
  id,
  kind: 'agent',
  x,
  y,
  nombre,
  ia: 'openai',
  tarea: '',
  instrucciones: 'Sé breve.',
  ...extra,
});
const app = (id: string, x: number, y: number, nombre: string): NodoApp => ({ id, kind: 'app', x, y, nombre });
const disparador = (id = 't1', extra: Partial<NodoDisparador> = {}): NodoDisparador => ({
  id,
  kind: 'trigger',
  x: 8,
  y: 180,
  tipo: 'chat',
  frec: 'dia',
  ruta: 'mi-flujo',
  app: 'gmail',
  ...extra,
});
const arista = (id: string, de: string, a: string, tipo: TipoArista): Arista => ({ id, de, a, tipo });

const flujoDe = (nodes: Nodo[], edges: Arista[], nombreFlujo = 'Mi flujo'): Flujo => ({ nodes, edges, nombreFlujo });
const estadoDe = (flujo: Flujo, extra: Partial<Omit<EstadoVista, 'flujo'>> = {}): EstadoVista => ({
  flujo,
  sel: null,
  selEdge: null,
  menu: null,
  conectando: null,
  ...extra,
});
const menuDe = (ancla: string, tipo: TipoArista, paso: MenuMas['paso'], insertarEn: string | null = null): MenuMas => ({ ancla, tipo, paso, insertarEn });
const conectandoDe = (ancla: string, rol: Conectando['rol'], tipo: TipoArista): Conectando => ({ ancla, rol, tipo });

/** El ejemplo del lienzo + un agente y una app sueltos (para tener a quién conectar). */
function conSueltos(): Flujo {
  const f = ejemplo();
  f.nodes.push(agente('a3', 900, 500, 'Libre'), app('p3', 900, 640, 'Notion'));
  return f;
}

/** Dos IA que conversan: el ejemplo con la conexión a1 → a2 de ida y vuelta (y su descripción). */
function conversan(): Flujo {
  const f = ejemplo();
  const e2 = f.edges.find(e => e.id === 'e2');
  const a2 = f.nodes.find(n => n.id === 'a2');
  if (!e2 || a2?.kind !== 'agent') throw new Error('el ejemplo ya no es el de siempre');
  e2.tipo = 'tool';
  a2.desc = 'Revisa el tono y señala qué mejorar.';
  return f;
}

function vn(e: EstadoVista, id: string): VistaNodo {
  const v = vistaNodos(e).find(x => x.id === id);
  if (!v) throw new Error(`no hay vista de ${id}`);
  return v;
}

function nodoDe(f: Flujo, id: string): Nodo {
  const n = f.nodes.find(x => x.id === id);
  if (!n) throw new Error(`no hay cuadro ${id}`);
  return n;
}

/** Congela el valor y todo lo que contiene: si un selector intentara modificarlo, lanzaría. */
function congelar<T>(valor: T): T {
  if (valor !== null && typeof valor === 'object' && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const v of Object.values(valor)) congelar(v);
  }
  return valor;
}

/** Todos los textos de un valor (de cualquier profundidad). */
function textosDe(valor: unknown, acc: string[] = []): string[] {
  if (typeof valor === 'string') acc.push(valor);
  else if (Array.isArray(valor)) for (const v of valor) textosDe(v, acc);
  else if (valor !== null && typeof valor === 'object') for (const v of Object.values(valor)) textosDe(v, acc);
  return acc;
}

// ---------------------------------------------------------------- cada cuadro

describe('vistaNodo', () => {
  it('constructor.selectores.cada_cuadro_del_ejemplo_trae_tipo_titulo_detalle_icono_y_etiqueta', () => {
    const e = estadoDe(ejemplo());
    expect(vn(e, 't1')).toMatchObject({
      kind: 'trigger',
      variante: 'disparador',
      tipo: 'Disparador',
      tipoCorto: 'Disparador',
      titulo: 'Chat',
      detalle: 'Mensaje en el chat',
      icono: 'chat',
      etiqueta: 'Disparador: Chat',
      esHerramienta: false,
      x: 8,
      y: 180,
    });
    expect(vn(e, 'a1')).toMatchObject({
      variante: 'agente',
      tipo: 'Agente de IA',
      tipoCorto: 'Agente de IA',
      titulo: 'Atención a clientes',
      detalle: 'OpenAI (GPT)',
      icono: 'magia',
      etiqueta: 'Agente de IA: Atención a clientes',
      esHerramienta: false,
    });
    expect(vn(e, 'a2')).toMatchObject({ titulo: 'Revisor', detalle: 'Claude (Anthropic)' });
    expect(vn(e, 'p1')).toMatchObject({
      variante: 'app',
      tipo: 'App · herramienta de «Atención a clientes»',
      tipoCorto: 'App · herramienta',
      titulo: 'Google Sheets',
      detalle: 'Lista para n8n',
      icono: 'app',
      etiqueta: 'App · herramienta de «Atención a clientes»: Google Sheets',
      esHerramienta: true,
    });
    // en el orden del flujo, y la vista de uno solo es la misma
    expect(vistaNodos(e).map(v => v.id)).toEqual(['t1', 'a1', 'a2', 'p1', 'p2']);
    expect(vistaNodo(e, nodoDe(e.flujo, 'a2'))).toEqual(vn(e, 'a2'));
  });

  it('constructor.selectores.el_detalle_del_disparador_depende_de_su_tipo_su_frecuencia_su_ruta_y_su_app', () => {
    const detalle = (extra: Partial<NodoDisparador>) => vn(estadoDe(flujoDe([disparador('t1', extra)], [])), 't1').detalle;
    expect(detalle({ tipo: 'tiempo', frec: 'hora' })).toBe('Cada hora');
    expect(detalle({ tipo: 'tiempo', frec: 'dia' })).toBe('Cada día, 9:00');
    expect(detalle({ tipo: 'tiempo', frec: 'lunes' })).toBe('Cada lunes, 9:00');
    expect(detalle({ tipo: 'web', ruta: 'Mi Flujo Ñandú!' })).toBe('/webhook/mi-flujo-nandu');
    expect(detalle({ tipo: 'web', ruta: '###' })).toBe('/webhook/…');
    expect(detalle({ tipo: 'app', app: 'gmail' })).toBe('Gmail: correo nuevo');
    expect(detalle({ tipo: 'app', app: 'telegram' })).toBe('Telegram: mensaje nuevo');
    expect(detalle({ tipo: 'chat' })).toBe('Mensaje en el chat');
    // el título y el ícono salen del tipo; uno desconocido cae en «Chat», como en el mockup
    const porTipo = (tipo: NodoDisparador['tipo']) => vn(estadoDe(flujoDe([disparador('t1', { tipo })], [])), 't1');
    expect([porTipo('tiempo').titulo, porTipo('tiempo').icono]).toEqual(['Tiempo', 'reloj']);
    expect([porTipo('web').titulo, porTipo('web').icono]).toEqual(['Web', 'web']);
    expect([porTipo('app').titulo, porTipo('app').icono]).toEqual(['App', 'app']);
    const raro = { ...disparador(), tipo: 'otro' } as unknown as NodoDisparador;
    const vRaro = vn(estadoDe(flujoDe([raro], [])), 't1');
    expect([vRaro.titulo, vRaro.detalle, vRaro.icono]).toEqual(['Chat', 'Mensaje en el chat', 'chat']);
  });

  it('constructor.selectores.una_app_dice_si_n8n_la_conoce_si_es_un_paso_o_si_es_herramienta', () => {
    const f = flujoDe(
      [
        disparador('t1', { tipo: 'tiempo' }),
        agente('a1', 312, 180, 'Agente'),
        app('p1', 616, 180, 'Gmail'),
        app('p2', 616, 400, 'HubSpot'),
        app('p3', 176, 380, ''),
        app('p4', 400, 380, '  '),
        app('p5', 800, 380, 'Slack'),
      ],
      [arista('e1', 't1', 'a1', 'seq'), arista('e2', 'a1', 'p1', 'seq'), arista('e3', 'a1', 'p5', 'tool')],
    );
    const e = estadoDe(f);
    expect(vn(e, 'p1')).toMatchObject({ tipo: 'App · paso del flujo', tipoCorto: 'App · paso del flujo', detalle: 'Lista para n8n', esHerramienta: false });
    expect(vn(e, 'p2')).toMatchObject({ tipo: 'App', tipoCorto: 'App', detalle: 'La configuras tú en n8n' });
    expect(vn(e, 'p3')).toMatchObject({ titulo: 'App sin nombre', detalle: 'Ponle un nombre' });
    expect(vn(e, 'p4')).toMatchObject({ titulo: 'App sin nombre', detalle: 'Ponle un nombre' });
    expect(vn(e, 'p5')).toMatchObject({ tipo: 'App · herramienta de «Agente»', esHerramienta: true });
  });

  it('constructor.selectores.un_agente_que_conversa_con_otro_lo_dice_y_el_que_lo_tiene_pierde_su_mas_de_la_derecha', () => {
    const e = estadoDe(conversan());
    // a2 conversa con a1: es un ayudante (tiene padre) pero sigue siendo agente
    expect(vn(e, 'a2')).toMatchObject({
      tipo: 'Agente de IA que conversa con «Atención a clientes»',
      tipoCorto: 'Agente · conversa',
      esHerramienta: true,
      clase: 'nodo-ag nodo-tool',
      etiqueta: 'Agente de IA que conversa con «Atención a clientes»: Revisor',
    });
    // a1 conversa con a2: lo que sigue se agrega desde a2
    expect(vn(e, 'a1')).toMatchObject({ puedeDer: false, stubDer: false, asaDer: false, patita: true });
    // a2 es ayudante pero agente: sí puede tener algo después
    expect(vn(e, 'a2')).toMatchObject({ puedeDer: true, stubDer: true, asaDer: false, patita: true });
  });

  it('constructor.selectores.los_flags_del_mas_dicen_si_se_pinta_el_suelto_el_redondo_o_ninguno_y_si_hay_patita', () => {
    const f = ejemplo();
    f.nodes.push(app('p3', 900, 300, 'Notion'));
    const e = estadoDe(f);
    // el disparador ya tiene algo después: el «+» pegado (asa); a2 no: el suelto (stub)
    expect(vn(e, 't1')).toMatchObject({ puedeDer: true, asaDer: true, stubDer: false, patita: false });
    expect(vn(e, 'a1')).toMatchObject({ puedeDer: true, asaDer: true, stubDer: false, patita: true });
    expect(vn(e, 'a2')).toMatchObject({ puedeDer: true, asaDer: false, stubDer: true, patita: true });
    // una herramienta no recibe nada después; una app suelta sí; ninguna app tiene patita
    expect(vn(e, 'p1')).toMatchObject({ puedeDer: false, stubDer: false, asaDer: false, patita: false });
    expect(vn(e, 'p3')).toMatchObject({ puedeDer: true, stubDer: true, asaDer: false, patita: false });
    // la función suelta da lo mismo
    expect(flagsMas(f, nodoDe(f, 'a1'))).toEqual({ puedeDer: true, stubDer: false, asaDer: true, patita: true, conversaCon: false });
    expect(flagsMas(conversan(), nodoDe(conversan(), 'a1'))).toMatchObject({ puedeDer: false, conversaCon: true });
    expect(flagsMas(f, nodoDe(f, 'p1'))).toMatchObject({ puedeDer: false, conversaCon: false });
  });

  it('constructor.selectores.las_clases_salen_por_nombre_de_variante_y_ninguna_lleva_color', () => {
    const f = ejemplo();
    const sin = estadoDe(f);
    expect(vn(sin, 't1').clase).toBe('nodo-trig');
    expect(vn(sin, 'a1').clase).toBe('nodo-ag');
    expect(vn(sin, 'p1').clase).toBe('nodo-app nodo-tool');
    // el elegido lleva el realce
    const elegido = estadoDe(f, { sel: 'a1' });
    expect(vn(elegido, 'a1')).toMatchObject({ clase: 'nodo-ag nodo-sel', seleccionado: true, resaltado: true });
    expect(vn(elegido, 'a2')).toMatchObject({ clase: 'nodo-ag', seleccionado: false, resaltado: false });
    expect(vn(estadoDe(f, { sel: 'p2' }), 'p2').clase).toBe('nodo-app nodo-tool nodo-sel');
    // nada con forma de color
    for (const v of vistaNodos(elegido)) expect(v.clase).not.toMatch(/#|rgb|hsl|\d/);
  });

  it('constructor.selectores.en_modo_conectando_marca_el_ancla_los_destinos_validos_y_los_nulos_con_su_motivo', () => {
    const f = conSueltos();
    const e = estadoDe(f, { sel: 'a1', conectando: conectandoDe('a1', 'origen', 'tool') });
    const modo = (id: string) => {
      const v = vn(e, id);
      return [v.modoConexion, v.motivoNulo] as const;
    };
    // el ancla se resalta (aunque el elegido sea otro) y los demás no se resaltan por estar elegidos
    expect(vn(e, 'a1')).toMatchObject({ modoConexion: 'ancla', resaltado: true, motivoNulo: null, clase: 'nodo-ag nodo-sel' });
    // la única app a la que puede llegar por la patita es la suelta
    expect(modo('p3')).toEqual(['destino', null]);
    expect(vn(e, 'p3').clase).toBe('nodo-app nodo-destino');
    // las demás reglas de puedeEnlazar, con su motivo
    expect(modo('t1')).toEqual(['nulo', 'Nada puede ir antes de un disparador: él es el inicio del flujo.']);
    expect(modo('p1')).toEqual(['nulo', 'Esos dos cuadros ya están conectados así.']);
    expect(modo('p2')).toEqual(['nulo', '«Slack» ya es herramienta o ayudante de otro agente.']);
    expect(modo('a2')[0]).toBe('nulo');
    expect(modo('a2')[1]).toMatch(/^«Revisor» ya es un paso del flujo \(le llega una conexión\)/);
    // un agente libre SÍ se podría conectar con ida y vuelta, pero por la patita solo van apps
    expect(modo('a3')).toEqual(['nulo', MOTIVO_SOLO_APPS]);
    expect(MOTIVO_SOLO_APPS).toMatch(/^Por la patita solo van apps\./);
    expect(vn(e, 'a3').clase).toBe('nodo-ag nodo-nulo');
    // fuera del modo conectando no hay modo ni motivo
    const sinModo = vn(estadoDe(f), 'a3');
    expect([sinModo.modoConexion, sinModo.motivoNulo]).toEqual([null, null]);
  });

  it('constructor.selectores.al_conectar_con_rol_destino_se_invierte_la_pregunta_y_la_patita_no_filtra', () => {
    const f = conSueltos();
    // se parte de la app suelta y se busca QUIÉN la tendrá de herramienta
    const e = estadoDe(f, { conectando: conectandoDe('p3', 'destino', 'tool') });
    expect(vn(e, 'p3').modoConexion).toBe('ancla');
    expect(vn(e, 'a1').modoConexion).toBe('destino');
    expect(vn(e, 'a3').modoConexion).toBe('destino');
    expect(vn(e, 't1')).toMatchObject({ modoConexion: 'nulo', motivoNulo: 'Solo un agente de IA puede tener herramientas o conversar con otra IA.' });
    // en un solo sentido, hacia adelante: de «Libre» a cualquiera menos al disparador y a las herramientas
    const seq = estadoDe(f, { conectando: conectandoDe('a3', 'origen', 'seq') });
    expect(vn(seq, 'a1').modoConexion).toBe('destino');
    expect(vn(seq, 'p3').modoConexion).toBe('destino');
    expect(vn(seq, 't1').modoConexion).toBe('nulo');
    expect(vn(seq, 'p1')).toMatchObject({ modoConexion: 'nulo', motivoNulo: '«Google Sheets» es herramienta de un agente: no puede ser un paso del flujo.' });
    // y hacia atrás: ¿quién puede ir ANTES de «Libre»?
    const antes = estadoDe(f, { conectando: conectandoDe('a3', 'destino', 'seq') });
    expect(vn(antes, 't1').modoConexion).toBe('destino');
    expect(vn(antes, 'a2').modoConexion).toBe('destino');
    expect(vn(antes, 'p1').modoConexion).toBe('nulo');
  });

  it('constructor.selectores.los_menus_abiertos_marcan_el_mas_que_los_abrio', () => {
    const f = ejemplo();
    const der = estadoDe(f, { menu: menuDe('a2', 'seq', 'inicio') });
    expect(vn(der, 'a2')).toMatchObject({ abiertoDer: true, abiertoTool: false });
    expect(vn(der, 'a1')).toMatchObject({ abiertoDer: false, abiertoTool: false });
    const tool = estadoDe(f, { menu: menuDe('a2', 'tool', 'app') });
    expect(vn(tool, 'a2')).toMatchObject({ abiertoDer: false, abiertoTool: true });
    // «poner en medio» sale del «+» de la flecha, no del cuadro
    const medio = estadoDe(f, { menu: menuDe('a1', 'seq', 'inicio', 'e2') });
    expect(vn(medio, 'a1')).toMatchObject({ abiertoDer: false, abiertoTool: false });
    // un menú cuya ancla ya no existe no marca nada
    const fantasma = estadoDe(f, { menu: menuDe('zzz', 'seq', 'inicio') });
    expect(vistaNodos(fantasma).some(v => v.abiertoDer || v.abiertoTool)).toBe(false);
  });

  it('constructor.selectores.las_etiquetas_para_lectores_de_pantalla_dicen_el_verbo_y_el_objeto', () => {
    const v = vn(estadoDe(ejemplo()), 'a1');
    expect(v.etiquetaMasDer).toBe('Agregar lo que sigue después de «Atención a clientes»: una app o un agente de IA');
    expect(v.etiquetaMasTool).toBe('Darle una herramienta a «Atención a clientes»: una app');
    expect(v.etiquetaQuitar).toBe('Quitar «Atención a clientes»');
    // el disparador se nombra con su título largo
    expect(vn(estadoDe(ejemplo()), 't1').etiquetaQuitar).toBe('Quitar «Disparador Chat»');
    expect(vn(estadoDe(flujoDe([app('p1', 0, 0, '')], [])), 'p1').etiquetaQuitar).toBe('Quitar «App sin nombre»');
  });
});

// ---------------------------------------------------------------- las flechas

describe('vistaFlechas', () => {
  it('constructor.selectores.las_flechas_del_ejemplo_dan_la_curva_las_puntas_y_la_insignia_del_mockup', () => {
    // valores sacados de renderVals del mockup para el ejemplo
    const fl = vistaFlechas(estadoDe(ejemplo()));
    expect(fl.map(f => f.id)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(fl.map(f => f.d)).toEqual([
      'M224 228C268 228 268 228 312 228',
      'M528 228C572 228 572 228 616 228',
      'M420 276C420 328 284 328 284 380',
      'M724 276C724 328 588 328 588 380',
    ]);
    expect(fl.map(f => f.puntas)).toEqual([
      'M312 228L301 233L301 223z',
      'M616 228L605 233L605 223z',
      'M420 276L425 287L415 287zM284 380L279 369L289 369z',
      'M724 276L729 287L719 287zM588 380L583 369L593 369z',
    ]);
    expect(fl.map(f => f.insignia)).toEqual([
      { x: 260, y: 206 },
      { x: 564, y: 206 },
      { x: 291, y: 322 },
      { x: 595, y: 322 },
    ]);
    // el centro de la insignia es la esquina más 22
    for (const f of fl) expect([f.insignia.x + 22, f.insignia.y + 22]).toEqual([f.medio.x, f.medio.y]);
  });

  it('constructor.selectores.cada_flecha_dice_su_forma_su_trazo_su_icono_y_sus_dos_textos', () => {
    const fl = vistaFlechas(estadoDe(ejemplo()));
    const e1 = fl[0];
    const e3 = fl[2];
    expect(e1).toMatchObject({
      tipo: 'seq',
      forma: 'paso',
      activa: false,
      ancho: 2,
      punteada: false,
      icono: 'unSentido',
      etiqueta: 'Conexión de «Disparador Chat» a «Atención a clientes»: un solo sentido. Editar',
      titulo: 'Un solo sentido. Toca para editarla.',
    });
    expect(e3).toMatchObject({
      tipo: 'tool',
      forma: 'herramienta',
      punteada: true,
      icono: 'idaYVuelta',
      etiqueta: 'Conexión de «Atención a clientes» a «Google Sheets»: ida y vuelta. Editar',
      titulo: 'Ida y vuelta. Toca para editarla.',
    });
    // el título es distinto de la etiqueta a propósito
    for (const f of fl) expect(f.titulo).not.toBe(f.etiqueta);
    // dos IA que conversan
    const conv = vistaFlechas(estadoDe(conversan())).find(f => f.id === 'e2');
    expect(conv).toMatchObject({ tipo: 'tool', forma: 'conversan', punteada: true, icono: 'idaYVuelta' });
    expect(conv?.puntas.match(/z/g)).toHaveLength(2);
  });

  it('constructor.selectores.la_conexion_elegida_se_marca_activa_y_se_dibuja_mas_gruesa', () => {
    const fl = vistaFlechas(estadoDe(ejemplo(), { selEdge: 'e3' }));
    expect(fl.map(f => [f.id, f.activa, f.ancho])).toEqual([
      ['e1', false, 2],
      ['e2', false, 2],
      ['e3', true, 3],
      ['e4', false, 2],
    ]);
  });

  it('constructor.selectores.una_conexion_con_un_extremo_que_no_existe_no_se_dibuja', () => {
    const f = ejemplo();
    f.edges.push(arista('e9', 'a1', 'fantasma', 'seq'), arista('e10', 'fantasma', 'a2', 'seq'));
    const fl = vistaFlechas(estadoDe(f));
    expect(fl.map(x => x.id)).toEqual(['e1', 'e2', 'e3', 'e4']);
  });

  it('constructor.selectores.una_herramienta_encima_o_al_lado_del_agente_da_trazos_sin_nan', () => {
    // tres posiciones de la herramienta respecto de su agente: debajo, encima, al lado, y encimada
    for (const [x, y] of [
      [176, 380],
      [176, 40],
      [344, 250],
      [312, 180],
      [100, 100],
    ] as const) {
      const f = ejemplo();
      const p1 = nodoDe(f, 'p1');
      p1.x = x;
      p1.y = y;
      for (const fl of vistaFlechas(estadoDe(f))) {
        expect(fl.d + fl.puntas, `${x},${y} ${fl.id}`).not.toMatch(/NaN|undefined|Infinity/);
        expect(Number.isFinite(fl.insignia.x) && Number.isFinite(fl.insignia.y)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------- el menú del «+»

describe('vistaMenu', () => {
  it('constructor.selectores.sin_menu_o_con_un_ancla_que_ya_no_existe_no_hay_menu', () => {
    expect(vistaMenu(estadoDe(ejemplo()))).toBeNull();
    expect(vistaMenu(estadoDe(ejemplo(), { menu: menuDe('zzz', 'seq', 'inicio') }))).toBeNull();
    expect(vistaMenu(estadoDe(flujoDe([], []), { menu: menuDe('a1', 'seq', 'inicio') }))).toBeNull();
  });

  it('constructor.selectores.el_menu_de_lo_que_sigue_ofrece_app_agente_y_uno_del_lienzo_con_el_foco_en_la_primera', () => {
    // valores de renderVals del mockup para el ejemplo
    const m = vistaMenu(estadoDe(ejemplo(), { menu: menuDe('t1', 'seq', 'inicio') }));
    expect(m).toMatchObject({
      ancla: 't1',
      tipo: 'seq',
      paso: 'inicio',
      insertarEn: null,
      titulo: 'Agregar después de «Disparador Chat»',
      esInicio: true,
      esApp: false,
      hayAtras: true,
      hayExistente: false,
      x: 258,
      y: 172,
      alto: 340,
      fondo: 512,
    });
    expect(m?.opciones.map(o => [o.id, o.titulo, o.bloqueada, o.primera, o.icono])).toEqual([
      ['app', 'Una aplicación', false, true, 'app'],
      ['agente', 'Un agente de IA', false, false, 'magia'],
      ['existente', 'Uno que ya está en el lienzo', false, false, 'enlace'],
    ]);
    expect(m?.opciones[0]?.detalle).toBe('Gmail, Slack, Google Sheets… Hace algo con la respuesta de «Disparador Chat».');
    expect(m?.opciones[1]?.detalle).toBe('Piensa y decide qué responder con lo que recibe.');
    // como ya le sigue algo, la nota avisa que se suma y cómo poner un cuadro en medio
    expect(m?.hayNota).toBe(true);
    expect(m?.nota).toMatch(/^Esto se suma a lo que ya sigue/);
    // las apps, en el orden del catálogo; solo la primera lleva el foco
    expect(m?.apps.map(a => a.nombre)).toEqual(APPS.map(a => a.nombre));
    expect(m?.apps.map(a => a.primera)).toEqual(APPS.map((_, i) => i === 0));
  });

  it('constructor.selectores.al_final_del_flujo_el_menu_se_abre_mas_a_la_derecha_y_sin_nota', () => {
    const m = vistaMenu(estadoDe(ejemplo(), { menu: menuDe('p2', 'seq', 'inicio') }));
    // p2 es una herramienta: el menú se abre igual (el reductor decide si deja); 292 px a la derecha, sin nota
    expect(m).toMatchObject({ titulo: 'Agregar después de «Slack»', x: 684, y: 372, nota: '', hayNota: false });
    expect(m?.opciones.map(o => o.id)).toEqual(['app', 'agente']);
    // x se limita para que quepa en el lienzo (ancho - 316): a2 pediría 908 y el lienzo mide 1000
    const a2 = vistaMenu(estadoDe(ejemplo(), { menu: menuDe('a2', 'seq', 'inicio') }));
    expect(a2).toMatchObject({ x: 684, y: 172 });
    const casiAlBorde = ejemplo();
    nodoDe(casiAlBorde, 'a2').x = 2000;
    const borde = vistaMenu(estadoDe(casiAlBorde, { menu: menuDe('a2', 'seq', 'inicio') }));
    expect(borde?.x).toBe(2000 + 216 + 112 - 316);
  });

  it('constructor.selectores.el_menu_de_herramientas_abre_en_las_apps_sin_agentes_ni_atras_y_con_su_nota', () => {
    const m = vistaMenu(estadoDe(ejemplo(), { menu: menuDe('a1', 'tool', 'app') }));
    expect(m).toMatchObject({
      titulo: 'Darle una herramienta a «Atención a clientes»',
      esInicio: false,
      esApp: true,
      hayAtras: false,
      hayExistente: false,
      x: 270,
      y: 346,
      alto: 580,
      fondo: 926,
      hayNota: true,
    });
    expect(m?.opciones.map(o => o.id)).toEqual(['app']);
    expect(m?.opciones[0]?.detalle).toBe('Gmail, Google Sheets, Slack… El agente la usa cuando la necesita y recibe lo que responde.');
    expect(m?.nota).toMatch(/^Una herramienta no va después de nada: «Atención a clientes» la consulta solo cuando la necesita/);
    // con una app suelta en el lienzo se ofrece «Uno que ya está en el lienzo» (solo apps, por la patita)
    const libre = vistaMenu(estadoDe(conSueltos(), { menu: menuDe('a1', 'tool', 'app') }));
    expect(libre).toMatchObject({ hayExistente: true });
    expect(libre?.opciones.map(o => o.id)).toEqual(['app', 'existente']);
    // un agente libre NO cuenta como candidato de la patita
    const soloAgente = ejemplo();
    soloAgente.nodes.push(agente('a3', 900, 500, 'Libre'));
    expect(vistaMenu(estadoDe(soloAgente, { menu: menuDe('a1', 'tool', 'app') }))).toMatchObject({ hayExistente: false });
  });

  it('constructor.selectores.poner_en_medio_se_abre_bajo_la_insignia_de_la_flecha_y_sin_nota_ni_uno_existente', () => {
    const e = estadoDe(ejemplo(), { menu: menuDe('a1', 'seq', 'inicio', 'e2') });
    const m = vistaMenu(e);
    expect(m).toMatchObject({ titulo: 'Poner en medio', nota: '', hayNota: false, insertarEn: 'e2', x: 436, y: 252 });
    expect(m?.opciones.map(o => o.id)).toEqual(['app', 'agente']);
    // aunque haya cuadros sueltos a los que se podría conectar, al poner en medio no se ofrece «Uno que ya está en el lienzo»
    const conLibres = (insertarEn: string | null) => vistaMenu(estadoDe(conSueltos(), { menu: menuDe('a1', 'seq', 'inicio', insertarEn) }));
    expect(conLibres('e2')?.opciones.map(o => o.id)).toEqual(['app', 'agente']);
    expect(conLibres(null)?.opciones.map(o => o.id)).toEqual(['app', 'agente', 'existente']);
    // sale del medio de la flecha: 150 a la izquierda y 24 abajo
    const medio = vistaFlechas(e).find(f => f.id === 'e2')?.medio;
    expect([m?.x, m?.y]).toEqual([(medio?.x ?? 0) - 150, (medio?.y ?? 0) + 24]);
    // una flecha que no existe no rompe: cae en el menú de lo que sigue
    const sinFlecha = vistaMenu(estadoDe(ejemplo(), { menu: menuDe('a1', 'seq', 'inicio', 'e99') }));
    expect(sinFlecha?.titulo).toBe('Poner en medio');
    expect(sinFlecha?.x).toBe(562);
  });

  it('constructor.selectores.los_topes_bloquean_las_opciones_con_su_motivo_y_la_primera_libre_lleva_el_foco', () => {
    const nodes: Nodo[] = [disparador('t1', { tipo: 'tiempo' })];
    for (let i = 1; i <= 4; i += 1) nodes.push(agente(`a${i}`, 300 + i * 20, 20 + i * 100, `Agente ${i}`));
    for (let i = 1; i <= 8; i += 1) nodes.push(app(`p${i}`, 800, 20 + i * 100, `App ${i}`));
    const m = vistaMenu(estadoDe(flujoDe(nodes, []), { menu: menuDe('t1', 'seq', 'inicio') }));
    const op = (id: string) => m?.opciones.find(o => o.id === id);
    expect(op('app')).toMatchObject({ bloqueada: true, motivo: 'Por ahora son hasta 8 apps por flujo.', primera: false });
    expect(op('agente')).toMatchObject({ bloqueada: true, motivo: 'Por ahora son hasta 4 agentes por flujo.', primera: false });
    // la primera NO bloqueada es la de «uno que ya está»
    expect(op('existente')).toMatchObject({ bloqueada: false, motivo: null, primera: true });
    // solo las apps al tope: el agente pasa a ser la primera libre
    const sinApps = flujoDe([disparador('t1', { tipo: 'tiempo' }), ...nodes.filter(n => n.kind === 'app')], []);
    const m2 = vistaMenu(estadoDe(sinApps, { menu: menuDe('t1', 'seq', 'inicio') }));
    expect(m2?.opciones.find(o => o.id === 'agente')).toMatchObject({ bloqueada: false, primera: true });
    expect(m2?.opciones.find(o => o.id === 'app')).toMatchObject({ bloqueada: true, primera: false });
    // exactamente una con foco, o ninguna si todo está bloqueado
    expect(m2?.opciones.filter(o => o.primera)).toHaveLength(1);
    const todoLleno = flujoDe([...nodes.filter(n => n.kind !== 'trigger'), disparador('t1')], []);
    const m3 = vistaMenu(estadoDe(todoLleno, { menu: menuDe('a1', 'seq', 'inicio') }));
    expect(m3?.opciones.filter(o => o.bloqueada).map(o => o.id)).toEqual(['app', 'agente']);
  });

  it('constructor.selectores.el_lienzo_crece_hasta_los_cuadros_y_hasta_donde_pide_el_menu_abierto', () => {
    expect(vistaLienzo(estadoDe(ejemplo()))).toEqual({ ancho: 1000, alto: 780 });
    expect(vistaLienzo(estadoDe(flujoDe([], [])))).toEqual({ ancho: 1000, alto: 780 });
    // el menú de herramientas pide hasta 926 de alto (y + 580)
    expect(vistaLienzo(estadoDe(ejemplo(), { menu: menuDe('a1', 'tool', 'app') }))).toEqual({ ancho: 1000, alto: 926 });
    // un cuadro lejos alarga el lienzo: x + 216 + 112 por la derecha, y + 96 + 168 por abajo
    const f = ejemplo();
    nodoDe(f, 'p2').x = 1500;
    nodoDe(f, 'p2').y = 900;
    expect(vistaLienzo(estadoDe(f))).toEqual({ ancho: 1500 + 216 + 112, alto: 900 + 96 + 168 });
  });
});

// ---------------------------------------------------------------- Ajustes del cuadro elegido

describe('vistaAjustes', () => {
  it('constructor.selectores.sin_cuadro_elegido_o_con_uno_que_ya_no_existe_no_hay_ajustes', () => {
    expect(vistaAjustes(estadoDe(ejemplo()))).toBeNull();
    expect(vistaAjustes(estadoDe(ejemplo(), { sel: 'zzz' }))).toBeNull();
    expect(vistaAjustes(estadoDe(ejemplo(), { sel: 'a1' }))?.panel).toBe('agente');
  });

  it('constructor.selectores.el_panel_de_un_agente_tras_un_chat_no_pide_tarea_y_lista_sus_conexiones', () => {
    const aj = vistaAjustes(estadoDe(ejemplo(), { sel: 'a1' })) as AjustesAgente;
    expect(aj.panel).toBe('agente');
    expect(aj).toMatchObject({
      id: 'a1',
      esAyudante: false,
      esHerramienta: false,
      padreNombre: '',
      pideTarea: false,
      etiquetaTarea: 'Instrucción para este paso (opcional: recibe lo que salió del paso anterior)',
      btnSig: true,
      textoSig: 'Agregar lo que sigue',
      btnHerr: true,
    });
    expect(aj.rolTexto).toMatch(/^Toca el \+ que está a la derecha del cuadro para agregar lo que sigue/);
    expect(aj.conexiones.map(c => c.texto)).toEqual(['Viene de «Disparador Chat»', 'Después va «Revisor»', 'Herramienta: «Google Sheets»']);
    expect(aj.conexiones.map(c => c.id)).toEqual(['e1', 'e2', 'e3']);
    expect(aj.conexiones[0]).toMatchObject({
      etiquetaEditar: 'Editar la conexión: Viene de «Disparador Chat»',
      etiquetaQuitar: 'Quitar la conexión: Viene de «Disparador Chat»',
    });
    // las cuatro IA, con la del agente activa
    expect(aj.ias.map(i => [i.id, i.activa])).toEqual([
      ['openai', true],
      ['anthropic', false],
      ['gemini', false],
      ['openrouter', false],
    ]);
    expect(aj.nodo.id).toBe('a1');
  });

  it('constructor.selectores.un_agente_despues_de_otro_pide_tarea_y_despues_de_un_disparador_que_no_es_chat_la_pide_distinto', () => {
    const detras = vistaAjustes(estadoDe(ejemplo(), { sel: 'a2' })) as AjustesAgente;
    expect(detras).toMatchObject({
      pideTarea: true,
      etiquetaTarea: 'Instrucción para este paso (opcional: recibe lo que salió del paso anterior)',
    });
    expect(detras.conexiones.map(c => c.texto)).toEqual(['Viene de «Atención a clientes»', 'Herramienta: «Slack»']);
    const f = ejemplo();
    const t1 = nodoDe(f, 't1');
    if (t1.kind === 'trigger') t1.tipo = 'web';
    const trasWeb = vistaAjustes(estadoDe(f, { sel: 'a1' })) as AjustesAgente;
    expect(trasWeb).toMatchObject({ pideTarea: true, etiquetaTarea: '¿Qué debe hacer cada vez que se dispare?' });
    if (t1.kind === 'trigger') t1.tipo = 'tiempo';
    expect((vistaAjustes(estadoDe(f, { sel: 'a1' })) as AjustesAgente).etiquetaTarea).toBe('¿Qué debe hacer cada vez que se dispare?');
  });

  it('constructor.selectores.el_panel_de_dos_ia_que_conversan_pide_para_que_le_sirve_y_el_principal_no_ofrece_lo_que_sigue', () => {
    const e = estadoDe(conversan());
    const ayudante = vistaAjustes({ ...e, sel: 'a2' }) as AjustesAgente;
    expect(ayudante).toMatchObject({ esAyudante: true, esHerramienta: true, padreNombre: 'Atención a clientes', pideTarea: false, btnSig: true, btnHerr: true });
    expect(ayudante.rolTexto).toMatch(/^Esta IA conversa con «Atención a clientes»: ella le pide algo, esta responde/);
    expect(ayudante.rolTexto).toContain('Lo que siga después recibe la respuesta final de «Atención a clientes».');
    expect(ayudante.conexiones.map(c => c.texto)).toEqual(['Conversa con «Atención a clientes»', 'Herramienta: «Slack»']);
    const principal = vistaAjustes({ ...e, sel: 'a1' }) as AjustesAgente;
    expect(principal).toMatchObject({ esAyudante: false, btnSig: false, btnHerr: true });
    expect(principal.rolTexto).toMatch(/^Este agente conversa con otra IA \(a su derecha\)/);
    expect(principal.conexiones.map(c => c.texto)).toEqual(['Viene de «Disparador Chat»', 'Conversa con «Revisor»', 'Herramienta: «Google Sheets»']);
  });

  it('constructor.selectores.el_panel_de_un_disparador_trae_sus_tipos_la_ruta_limpia_el_enlace_y_las_opciones', () => {
    const f = ejemplo();
    const t1 = nodoDe(f, 't1');
    if (t1.kind === 'trigger') Object.assign(t1, { tipo: 'web', ruta: 'Mi Flujo Ñandú!' });
    const aj = vistaAjustes(estadoDe(f, { sel: 't1' })) as AjustesDisparador;
    expect(aj).toMatchObject({
      panel: 'disparador',
      tiempo: false,
      web: true,
      deApp: false,
      frecuencia: 'dia',
      ruta: 'Mi Flujo Ñandú!',
      appDisparador: 'gmail',
      enlace: 'https://tu-n8n.com/webhook/mi-flujo-nandu',
      btnSig: true,
      textoSig: 'Agregar el primer paso',
      btnHerr: false,
    });
    expect(aj.rolTexto).toMatch(/^El disparador es el inicio del flujo: nada puede ir antes de él\./);
    expect(aj.tipos.map(t => [t.id, t.nombre, t.activa])).toEqual([
      ['tiempo', 'Tiempo', false],
      ['chat', 'Chat', false],
      ['web', 'Web', true],
      ['app', 'App', false],
    ]);
    expect(aj.opcionesFrecuencia.map(o => [o.id, o.texto])).toEqual([
      ['hora', 'Cada hora'],
      ['dia', 'Cada día a las 9:00'],
      ['lunes', 'Cada lunes a las 9:00'],
    ]);
    expect(aj.opcionesApp.map(o => [o.id, o.texto])).toEqual([
      ['gmail', 'Gmail: llega un correo'],
      ['telegram', 'Telegram: llega un mensaje'],
    ]);
    expect(aj.conexiones.map(c => c.texto)).toEqual(['Después va «Atención a clientes»']);
    // sin ruta limpia, el enlace usa «mi-flujo»
    if (t1.kind === 'trigger') t1.ruta = '###';
    expect((vistaAjustes(estadoDe(f, { sel: 't1' })) as AjustesDisparador).enlace).toBe('https://tu-n8n.com/webhook/mi-flujo');
    // de tiempo y de app
    if (t1.kind === 'trigger') Object.assign(t1, { tipo: 'tiempo', frec: 'lunes' });
    expect(vistaAjustes(estadoDe(f, { sel: 't1' }))).toMatchObject({ tiempo: true, web: false, deApp: false, frecuencia: 'lunes' });
    if (t1.kind === 'trigger') Object.assign(t1, { tipo: 'app', app: 'telegram' });
    expect(vistaAjustes(estadoDe(f, { sel: 't1' }))).toMatchObject({ tiempo: false, web: false, deApp: true, appDisparador: 'telegram' });
  });

  it('constructor.selectores.el_panel_de_una_app_dice_si_n8n_la_conoce_y_si_es_herramienta_paso_o_esta_suelta', () => {
    const e = estadoDe(conSueltos());
    const herr = vistaAjustes({ ...e, sel: 'p1' }) as AjustesApp;
    expect(herr).toMatchObject({
      panel: 'app',
      esHerramienta: true,
      padreNombre: 'Atención a clientes',
      notaApp: 'n8n ya sabe conectarse a esta app.',
      btnSig: false,
      btnHerr: false,
      textoSig: 'Agregar lo que sigue',
    });
    expect(herr.rolTexto).toMatch(/^Es una HERRAMIENTA del agente «Atención a clientes»: ida y vuelta\./);
    // la lista de conexiones de una herramienta dice de quién es herramienta (el mockup decía «Conversa con»)
    expect(herr.conexiones.map(c => c.texto)).toEqual(['Es herramienta de «Atención a clientes»']);
    expect(herr.sugerencias).toEqual(APPS.map(a => a.nombre));
    expect(herr.sugerencias).toHaveLength(10);

    const suelta = vistaAjustes({ ...e, sel: 'p3' }) as AjustesApp;
    expect(suelta).toMatchObject({ btnSig: true, esHerramienta: false, conexiones: [] });
    expect(suelta.rolTexto).toMatch(/^Sin conectar todavía\./);

    // paso del flujo: recibe un «seq»
    const f = flujoDe(
      [disparador('t1', { tipo: 'tiempo' }), app('p1', 300, 180, 'HubSpot'), app('p2', 600, 180, '')],
      [arista('e1', 't1', 'p1', 'seq')],
    );
    const paso = vistaAjustes(estadoDe(f, { sel: 'p1' })) as AjustesApp;
    expect(paso.rolTexto).toMatch(/^Es un PASO del flujo: corre después de la respuesta del cuadro anterior/);
    expect(paso.notaApp).toBe('n8n no trae un conector listo para esta app: la conexión la configuras tú dentro de n8n.');
    expect(paso.conexiones.map(c => c.texto)).toEqual(['Viene de «Disparador Tiempo»']);
    expect((vistaAjustes(estadoDe(f, { sel: 'p2' })) as AjustesApp).notaApp).toBe('Escribe el nombre de la app que quieres usar.');
  });

  it('constructor.selectores.una_conexion_con_un_cuadro_que_ya_no_existe_no_sale_en_la_lista', () => {
    const f = ejemplo();
    f.edges.push(arista('e9', 'a1', 'fantasma', 'seq'));
    const aj = vistaAjustes(estadoDe(f, { sel: 'a1' }));
    expect(aj?.conexiones.map(c => c.id)).toEqual(['e1', 'e2', 'e3']);
  });
});

// ---------------------------------------------------------------- el editor de la flecha

describe('vistaEnlace', () => {
  it('constructor.selectores.sin_flecha_elegida_o_con_un_cuadro_elegido_o_con_un_extremo_perdido_no_hay_editor', () => {
    expect(vistaEnlace(estadoDe(ejemplo()))).toBeNull();
    expect(vistaEnlace(estadoDe(ejemplo(), { selEdge: 'e99' }))).toBeNull();
    // manda el cuadro
    expect(vistaEnlace(estadoDe(ejemplo(), { sel: 'a1', selEdge: 'e1' }))).toBeNull();
    // un «sel» fantasma no cuenta
    expect(vistaEnlace(estadoDe(ejemplo(), { sel: 'zzz', selEdge: 'e1' }))?.id).toBe('e1');
    const f = ejemplo();
    f.edges.push(arista('e9', 'a1', 'fantasma', 'seq'));
    expect(vistaEnlace(estadoDe(f, { selEdge: 'e9' }))).toBeNull();
    expect(panelDeAjustes(estadoDe(f, { selEdge: 'e9' }))).toBe('ninguno');
  });

  it('constructor.selectores.el_editor_de_un_solo_sentido_entre_dos_agentes_ofrece_ida_y_vuelta_y_poner_en_medio', () => {
    const v = vistaEnlace(estadoDe(ejemplo(), { selEdge: 'e2' }));
    expect(v).toMatchObject({ id: 'e2', de: 'a1', a: 'a2', deNombre: 'Atención a clientes', aNombre: 'Revisor', esUno: true, puedeMedio: true });
    expect(v?.uno).toEqual({ tipo: 'seq', activa: true, noElegible: false, nota: null });
    expect(v?.doble).toEqual({ tipo: 'tool', activa: false, noElegible: false, nota: null });
    // el texto largo de «ida y vuelta» cuando el destino es otro agente
    expect(v?.textoDoble).toBe(
      '«Atención a clientes» y «Revisor» conversan: «Atención a clientes» le pide algo a «Revisor» cuantas veces haga falta (por ejemplo, un borrador y su revisión) y «Revisor» le responde, hasta quedar conformes. Lo que siga después recibe la respuesta final de «Atención a clientes».',
    );
  });

  it('constructor.selectores.si_ya_conversan_la_opcion_activa_es_ida_y_vuelta_y_no_se_ofrece_poner_en_medio', () => {
    const v = vistaEnlace(estadoDe(conversan(), { selEdge: 'e2' }));
    expect(v).toMatchObject({ esUno: false, puedeMedio: false });
    expect(v?.doble).toMatchObject({ activa: true, noElegible: false, nota: null });
    expect(v?.uno).toMatchObject({ activa: false, noElegible: false, nota: null });
  });

  it('constructor.selectores.una_flecha_a_una_app_explica_la_ida_y_vuelta_como_herramienta', () => {
    const v = vistaEnlace(estadoDe(ejemplo(), { selEdge: 'e3' }));
    expect(v?.esUno).toBe(false);
    expect(v?.textoDoble).toBe(
      '«Atención a clientes» (un agente) le pide algo a «Google Sheets» solo cuando lo necesita, y «Google Sheets» le regresa el resultado. Es como preguntarle algo a un compañero. Queda colgada de su patita como herramienta.',
    );
    expect(v?.uno).toMatchObject({ noElegible: false });
  });

  it('constructor.selectores.la_opcion_que_no_se_puede_elegir_trae_su_motivo_y_la_activa_nunca_se_marca_asi', () => {
    // del disparador solo sale un solo sentido: «ida y vuelta» exige que el origen sea un agente
    const v = vistaEnlace(estadoDe(ejemplo(), { selEdge: 'e1' }));
    expect(v?.uno).toMatchObject({ activa: true, noElegible: false, nota: null });
    expect(v?.doble).toEqual({
      tipo: 'tool',
      activa: false,
      noElegible: true,
      nota: 'No se puede: Solo un agente de IA puede tener herramientas o conversar con otra IA.',
    });
    // se prueba sobre el flujo SIN esa conexión: b → c → a ya existe y a → b la cerraría en círculo
    const f = flujoDe(
      [agente('a', 0, 0, 'A'), agente('b', 400, 0, 'B'), agente('c', 800, 0, 'C')],
      [arista('e1', 'a', 'b', 'tool'), arista('e2', 'b', 'c', 'seq'), arista('e3', 'c', 'a', 'seq')],
    );
    const ciclo = vistaEnlace(estadoDe(f, { selEdge: 'e1' }));
    expect(ciclo?.doble.noElegible).toBe(false);
    expect(ciclo?.uno).toEqual({
      tipo: 'seq',
      activa: false,
      noElegible: true,
      nota: 'No se puede: Eso haría un círculo: el flujo volvería a empezar solo.',
    });
    // nunca la activa
    for (const id of ['e1', 'e2', 'e3', 'e4']) {
      const w = vistaEnlace(estadoDe(ejemplo(), { selEdge: id }));
      const activa = w?.esUno ? w.uno : w?.doble;
      expect(activa?.noElegible, id).toBe(false);
      expect(activa?.nota, id).toBeNull();
    }
  });

  it('constructor.selectores.el_panel_que_toca_es_el_del_cuadro_el_de_la_flecha_o_ninguno', () => {
    const f = ejemplo();
    expect(panelDeAjustes(estadoDe(f))).toBe('ninguno');
    expect(panelDeAjustes(estadoDe(f, { sel: 'a1' }))).toBe('cuadro');
    expect(panelDeAjustes(estadoDe(f, { selEdge: 'e2' }))).toBe('enlace');
    expect(panelDeAjustes(estadoDe(f, { sel: 'a1', selEdge: 'e2' }))).toBe('cuadro');
    expect(panelDeAjustes(estadoDe(f, { sel: 'zzz' }))).toBe('ninguno');
    expect(panelDeAjustes(estadoDe(f, { sel: 'zzz', selEdge: 'e2' }))).toBe('enlace');
    expect(panelDeAjustes(estadoDe(f, { selEdge: 'e99' }))).toBe('ninguno');
  });
});

// ---------------------------------------------------------------- guía, textos sueltos y resumen

describe('textos y resumen', () => {
  it('constructor.selectores.la_guia_y_el_texto_sin_seleccion_siguen_los_pasos_del_flujo', () => {
    const vacio = estadoDe(flujoDe([], []));
    expect(guia(vacio)).toBe('Paso 1: elige cómo arranca tu flujo.');
    expect(textoSinSeleccion(vacio)).toBe('Empieza eligiendo el disparador en el lienzo.');
    const soloDisparador = estadoDe(flujoDe([disparador()], []));
    expect(guia(soloDisparador)).toBe('Paso 2: toca el + junto al disparador y elige qué sigue: una app o un agente de IA.');
    expect(textoSinSeleccion(soloDisparador)).toBe('Toca un cuadro para ver y cambiar sus ajustes, o toca una flecha para decidir cómo se conectan.');
    // con un agente y sin herramientas: la pista de la patita
    const agenteSinHerr = estadoDe(flujoDe([disparador(), agente('a1', 300, 180, 'A')], [arista('e1', 't1', 'a1', 'seq')]));
    expect(guia(agenteSinHerr)).toMatch(/^Para que un agente consulte una app mientras piensa, toca el \+ de su patita/);
    // con herramientas (el ejemplo) o sin agentes: la pista de la flecha
    const conHerr = guia(estadoDe(ejemplo()));
    expect(conHerr).toMatch(/^Toca el círculo de una flecha para elegir/);
    const sinAgentes = estadoDe(flujoDe([disparador(), app('p1', 300, 180, 'Gmail')], [arista('e1', 't1', 'p1', 'seq')]));
    expect(guia(sinAgentes)).toBe(conHerr);
  });

  it('constructor.selectores.el_texto_de_conectar_cambia_con_el_tipo_el_rol_y_el_nombre_del_ancla', () => {
    const f = ejemplo();
    const t = (c: Conectando | null) => textoConectar(estadoDe(f, { conectando: c }));
    expect(t(conectandoDe('a1', 'origen', 'seq'))).toBe('Toca el cuadro que irá DESPUÉS de «Atención a clientes».');
    expect(t(conectandoDe('a1', 'destino', 'seq'))).toBe('Toca el cuadro que irá ANTES de «Atención a clientes».');
    expect(t(conectandoDe('a1', 'origen', 'tool'))).toBe('Toca la app que «Atención a clientes» podrá usar como herramienta.');
    expect(t(conectandoDe('p1', 'destino', 'tool'))).toBe('Toca el agente que podrá usar «Google Sheets» como herramienta.');
    expect(t(conectandoDe('t1', 'origen', 'seq'))).toBe('Toca el cuadro que irá DESPUÉS de «Disparador Chat».');
    expect(t(null)).toBe('');
  });

  it('constructor.selectores.la_tarjeta_de_elegir_disparador_dice_paso_1_o_falta_y_ofrece_el_ejemplo_solo_con_el_lienzo_vacio', () => {
    const vacio = vistaElegirDisparador(estadoDe(flujoDe([], [])));
    expect(vacio).toMatchObject({ visible: true, etiqueta: 'Paso 1', titulo: '¿Qué hace que tu flujo arranque?', puedeEjemplo: true });
    expect(vacio.opciones.map(o => [o.id, o.nombre, o.icono])).toEqual([
      ['tiempo', 'Tiempo', 'reloj'],
      ['chat', 'Chat', 'chat'],
      ['web', 'Web', 'web'],
      ['app', 'App', 'app'],
    ]);
    expect(vacio.opciones[0]?.detalle).toBe('Arranca solo, a la hora que digas.');
    // se quitó el disparador pero quedan cuadros
    const sinDisparador = vistaElegirDisparador(estadoDe(flujoDe([agente('a1', 300, 180, 'A')], [])));
    expect(sinDisparador).toMatchObject({ visible: true, etiqueta: 'Falta el disparador', titulo: 'Elige qué hace que tu flujo arranque', puedeEjemplo: false });
    // con disparador, la tarjeta no se pinta
    expect(vistaElegirDisparador(estadoDe(ejemplo())).visible).toBe(false);
  });

  it('constructor.selectores.el_resumen_usa_la_revision_del_exportador_y_no_pinta_errores_con_el_lienzo_vacio', () => {
    const e = estadoDe(ejemplo());
    const r = resumenFlujo(e);
    expect(r.errores).toEqual(revisarFlujo(e.flujo).errores);
    expect(r.avisos).toEqual(revisarFlujo(e.flujo).avisos);
    expect(r).toMatchObject({ errores: [], hayErrores: false, puedeDescargar: true, primerError: null, cuadros: 5 });
    expect(r.hayAvisos).toBe(true);
    expect(r.avisos).toContain('El chat quedará público: cualquiera con el enlace podrá escribirle (y gastar tu llave de IA).');
    expect(r.resumenOk).toBe(
      'Listo para descargar: 5 cuadros. Al abrirlo en n8n tendrás que conectar tus cuentas (Gmail, OpenAI…) y elegir hojas, canales y destinatarios.',
    );
    // un cuadro, en singular
    expect(resumenFlujo(estadoDe(flujoDe([disparador()], []))).resumenOk).toMatch(/^Listo para descargar: 1 cuadro\. /);

    // lienzo vacío: hay errores (falta el disparador) pero no se pinta «Te falta esto…» ni los avisos
    const vacio = resumenFlujo(estadoDe(flujoDe([], [])));
    expect(vacio.errores.length).toBeGreaterThan(0);
    expect(vacio).toMatchObject({ hayErrores: false, puedeDescargar: false, hayAvisos: false, cuadros: 0 });
    expect(vacio.primerError).toBe(vacio.errores[0]);
    expect(vacio.textoSinJson).toBe(`Todavía no hay JSON. Te falta: ${vacio.errores[0]}`);

    // con cuadros y con errores sí se pinta
    const solo = resumenFlujo(estadoDe(flujoDe([disparador()], [])));
    expect(solo).toMatchObject({ hayErrores: true, puedeDescargar: false });
    expect(solo.primerError).toBe(solo.errores[0]);
  });
});

// ---------------------------------------------------------------- propiedades de todos los selectores

// Compila solo si TODOS los nombres de ícono que devuelven los selectores existen en ui/iconos.ts
type IconosQueSalen = IconoNodo | IconoFlecha | OpcionMenu['icono'];
const iconosExisten: IconosQueSalen extends NombreIcono ? true : never = true;
type TodoUnEstado = EstadoConstructor extends EstadoVista ? true : never;
const estadoEnteroSirve: TodoUnEstado = true;

/** Los flujos de referencia: el ejemplo, las muestras del Asistente, dos IA que conversan y uno con cuadros sueltos. */
function flujosDeReferencia(): Flujo[] {
  return [
    ejemplo(),
    ...muestras().map(m => flujoDe(m.nodes, m.edges, m.nombre)),
    conversan(),
    conSueltos(),
    flujoDe([], []),
    flujoDe([agente('a1', 300, 180, 'Sin disparador')], []),
    // un disparador web y uno de tiempo, con apps como paso
    flujoDe(
      [disparador('t1', { tipo: 'web', ruta: 'Mi Ruta' }), app('p1', 300, 180, 'Gmail'), app('p2', 600, 180, 'HubSpot')],
      [arista('e1', 't1', 'p1', 'seq'), arista('e2', 'p1', 'p2', 'seq')],
    ),
  ];
}

/** Todos los estados de interfaz que se pueden pintar sobre un flujo. */
function estadosSobre(f: Flujo): EstadoVista[] {
  const out: EstadoVista[] = [estadoDe(f)];
  const tipos: TipoArista[] = ['seq', 'tool'];
  for (const n of f.nodes) {
    out.push(estadoDe(f, { sel: n.id }));
    for (const tipo of tipos) {
      for (const paso of ['inicio', 'app'] as const) out.push(estadoDe(f, { menu: menuDe(n.id, tipo, paso) }));
      for (const rol of ['origen', 'destino'] as const) out.push(estadoDe(f, { conectando: conectandoDe(n.id, rol, tipo) }));
    }
  }
  for (const e of f.edges) {
    out.push(estadoDe(f, { selEdge: e.id }));
    if (e.tipo === 'seq') out.push(estadoDe(f, { menu: menuDe(e.de, 'seq', 'inicio', e.id) }));
  }
  out.push(estadoDe(f, { sel: 'fantasma', selEdge: 'e999', menu: menuDe('fantasma', 'seq', 'inicio'), conectando: conectandoDe('fantasma', 'origen', 'seq') }));
  return out;
}

function todoLoQueDan(e: EstadoVista): unknown[] {
  return [
    vistaNodos(e),
    vistaFlechas(e),
    vistaMenu(e),
    vistaLienzo(e),
    vistaAjustes(e),
    vistaEnlace(e),
    panelDeAjustes(e),
    guia(e),
    textoSinSeleccion(e),
    textoConectar(e),
    vistaElegirDisparador(e),
    resumenFlujo(e),
  ];
}

describe('todos los selectores', () => {
  it('constructor.selectores.los_iconos_que_devuelven_existen_en_la_lista_de_iconos_y_un_estado_entero_del_constructor_sirve_de_entrada', () => {
    // (lo que importa lo comprueba tsc arriba; aquí se mira que en ejecución sea cierto)
    expect(iconosExisten && estadoEnteroSirve).toBe(true);
    const vistos = new Set<string>();
    for (const f of flujosDeReferencia()) {
      for (const e of estadosSobre(f)) {
        for (const v of vistaNodos(e)) vistos.add(v.icono);
        for (const fl of vistaFlechas(e)) vistos.add(fl.icono);
        for (const o of vistaMenu(e)?.opciones ?? []) vistos.add(o.icono);
      }
    }
    expect([...vistos].sort()).toEqual(['app', 'chat', 'enlace', 'idaYVuelta', 'magia', 'reloj', 'unSentido', 'web']);
  });

  it('constructor.selectores.no_truenan_en_ningun_estado_ni_dejan_nan_undefined_object_ni_null_en_los_textos', () => {
    let estados = 0;
    for (const f of flujosDeReferencia()) {
      for (const e of estadosSobre(f)) {
        estados += 1;
        const salida = todoLoQueDan(e);
        for (const t of textosDe(salida)) {
          expect(t, t).not.toMatch(/NaN|undefined|\[object |Infinity|\bnull\b/);
        }
        // los números que salen son finitos
        for (const v of vistaNodos(e)) expect([v.x, v.y].every(Number.isFinite)).toBe(true);
        const lz = vistaLienzo(e);
        expect(lz.ancho).toBeGreaterThanOrEqual(1000);
        expect(lz.alto).toBeGreaterThanOrEqual(780);
        const m = vistaMenu(e);
        if (m) expect([m.x, m.y, m.alto, m.fondo].every(Number.isFinite)).toBe(true);
      }
    }
    expect(estados).toBeGreaterThan(150);
  });

  it('constructor.selectores.no_modifican_el_estado_que_reciben_ni_comparten_objetos_entre_llamadas', () => {
    for (const f of flujosDeReferencia()) {
      for (const e of estadosSobre(f)) {
        const antes = JSON.stringify(e);
        todoLoQueDan(congelar(structuredClone(e)));
        expect(JSON.stringify(e)).toBe(antes);
      }
    }
    // la misma entrada da lo mismo (son puras) y cada llamada devuelve objetos nuevos
    const e = estadoDe(ejemplo(), { sel: 'a1', menu: menuDe('a2', 'seq', 'inicio') });
    const a = todoLoQueDan(e);
    const b = todoLoQueDan(e);
    expect(a).toEqual(b);
    expect(vistaNodos(e)[0]).not.toBe(vistaNodos(e)[0]);
    expect(vistaMenu(e)?.opciones).not.toBe(vistaMenu(e)?.opciones);
  });

  it('constructor.selectores.los_textos_son_de_latam_con_tuteo_sin_puntos_suspensivos_de_tres_puntos_ni_signos_de_apertura', () => {
    const vistos = new Set<string>();
    for (const f of flujosDeReferencia()) {
      for (const e of estadosSobre(f)) for (const t of textosDe(todoLoQueDan(e))) vistos.add(t);
    }
    expect(vistos.size).toBeGreaterThan(100);
    for (const t of vistos) {
      expect(t, t).not.toMatch(/\.\.\./);
      expect(t, t).not.toMatch(/¡/);
      expect(t, t).not.toMatch(/\b(ordenador|móvil|fichero|vosotros|centavos?|workflow|node|credentials)\b/i);
    }
  });

  it('constructor.selectores.los_ids_con_nombre_de_prototipo_no_rompen_nada_ni_tocan_object_prototype', () => {
    const nombres = ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty'];
    const nodes: Nodo[] = [
      { ...disparador(nombres[0] ?? 'x', { tipo: 'tiempo' }) },
      agente(nombres[1] ?? 'x', 312, 180, 'A'),
      app(nombres[2] ?? 'x', 176, 380, 'Gmail'),
      app(nombres[3] ?? 'x', 616, 180, 'Slack'),
      agente(nombres[4] ?? 'x', 616, 400, 'B'),
    ];
    const edges = [
      arista('e1', 'constructor', 'toString', 'seq'),
      arista('e2', 'toString', 'valueOf', 'tool'),
      arista('e3', 'toString', '__proto__', 'seq'),
      arista('e4', 'toString', 'hasOwnProperty', 'tool'),
    ];
    const f = flujoDe(nodes, edges);
    for (const e of estadosSobre(f).concat(
      nombres.map(id => estadoDe(f, { sel: id })),
      nombres.map(id => estadoDe(f, { menu: menuDe(id, 'seq', 'inicio') })),
    )) {
      expect(() => todoLoQueDan(e)).not.toThrow();
    }
    const e = estadoDe(f, { sel: 'toString' });
    expect(vistaNodos(e)).toHaveLength(5);
    expect(vn(e, 'valueOf')).toMatchObject({ esHerramienta: true, tipo: 'App · herramienta de «A»' });
    expect(vistaFlechas(e).map(x => x.id)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect((vistaAjustes(e) as AjustesAgente).conexiones).toHaveLength(4);
    expect(Object.keys(Object.prototype)).toEqual([]);
    expect(({} as Record<string, unknown>).main).toBeUndefined();
  });
});
