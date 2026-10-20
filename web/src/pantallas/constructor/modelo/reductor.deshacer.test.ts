// Pruebas de «Deshacer» (decisión D8 del plan): la pila real de hasta 20 instantáneas, qué la llena, qué la
// tira y qué la deja quieta. Es lo que corrige los defectos 9.2-a, -b y -n del mockup: allí «Deshacer» seguía
// disponible después de editar o arrastrar y, al pulsarlo, borraba esas ediciones; «Limpiar» no se podía
// deshacer; y el foco caía a `<body>`.
//
// Los estados que salen del reductor se congelan a fondo (`ir`): si una acción modificara algo de lo que
// recibió —o si una instantánea compartiera algo que luego se modifica—, la prueba revienta.

import { describe, expect, it } from 'vitest';

import { MAX_HISTORIAL } from './datos/constantes';
import { ejemplo, muestras } from './ejemplos';
import { invariantesDelGrafo } from './grafo';
import { estadoInicial, puedeDeshacer, reducir } from './reductor';
import * as T from './textos';
import type { AccionConstructor as A, ClaseCambio, EstadoConstructor as E, Flujo, Foco, Nodo, NodoAgente } from './tipos';

// ---------------------------------------------------------------- ayudas

function congelar<V>(v: V): V {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    for (const hijo of Object.values(v)) congelar(hijo);
    Object.freeze(v);
  }
  return v;
}

function ir(e: E, ...acciones: A[]): E {
  let s = e;
  for (const a of acciones) s = congelar(reducir(s, a));
  return s;
}

const vacio = (): E => congelar(estadoInicial());
/** El ejemplo con `a1` elegido. */
const conEjemplo = (): E => congelar({ ...estadoInicial(ejemplo()), sel: 'a1' });

function nodo(e: E, id: string): Nodo {
  const n = e.flujo.nodes.find(x => x.id === id);
  if (!n) throw new Error(`no hay cuadro ${id}`);
  return n;
}
const foco = (e: E): Foco | null => e.foco?.objetivo ?? null;
const cima = (e: E) => {
  const i = e.historial[e.historial.length - 1];
  if (!i) throw new Error('la pila está vacía');
  return i;
};

/** Lo que dejó de estar en pie: el aviso del estado es este, con o sin «Deshacer». */
function avisoEs(e: E, t: T.TextoAviso, conDeshacer = false): void {
  expect(e.aviso?.texto).toBe(t.texto);
  expect(e.aviso?.tipo).toBe(t.tipo);
  expect(e.aviso?.conDeshacer).toBe(conDeshacer);
}

/** Lo que una acción dejó guardado en la pila. */
interface CasoInstantanea {
  nombre: string;
  /** El estado justo antes de la acción. */
  antes: () => E;
  accion: A;
  clase: ClaseCambio;
  /** ¿El aviso de la acción ofrece «Deshacer»? */
  conAviso: boolean;
}

const abierto = (...pre: A[]): E => ir(conEjemplo(), ...pre);

const CASOS: CasoInstantanea[] = [
  { nombre: 'quitarNodo', antes: conEjemplo, accion: { k: 'quitarNodo', id: 'a1' }, clase: 'quitar', conAviso: true },
  { nombre: 'quitarEnlace', antes: conEjemplo, accion: { k: 'quitarEnlace', id: 'e2' }, clase: 'quitar', conAviso: true },
  {
    nombre: 'cambiarTipoEnlace',
    antes: conEjemplo,
    accion: { k: 'cambiarTipoEnlace', id: 'e2', tipo: 'tool' },
    clase: 'cambiar',
    conAviso: true,
  },
  {
    nombre: 'poner un cuadro en medio',
    antes: () => abierto({ k: 'abrirMenu', ancla: 'a1', tipo: 'seq', insertarEn: 'e2' }, { k: 'pasoMenu', paso: 'app' }),
    accion: { k: 'crearDesdeMenu', que: 'app', nombreApp: 'Gmail' },
    clase: 'cambiar',
    conAviso: true,
  },
  { nombre: 'limpiar', antes: conEjemplo, accion: { k: 'limpiar' }, clase: 'quitar', conAviso: true },
  { nombre: 'cargarEjemplo', antes: vacio, accion: { k: 'cargarEjemplo' }, clase: 'cargar', conAviso: true },
  {
    nombre: 'cargarFlujo',
    antes: conEjemplo,
    accion: { k: 'cargarFlujo', flujo: { ...ejemplo(), nombreFlujo: 'De afuera' } },
    clase: 'cargar',
    conAviso: true,
  },
  {
    nombre: 'agregar un cuadro',
    antes: () => abierto({ k: 'abrirMenu', ancla: 'a2', tipo: 'seq' }),
    accion: { k: 'crearDesdeMenu', que: 'agente' },
    clase: 'agregar',
    conAviso: false,
  },
  { nombre: 'elegirDisparador', antes: vacio, accion: { k: 'elegirDisparador', tipo: 'chat' }, clase: 'agregar', conAviso: false },
  {
    nombre: 'intentarConexion',
    antes: () => {
      const f = ejemplo();
      f.nodes.push({ id: 'z', kind: 'app', x: 700, y: 400, nombre: 'Notion' });
      return ir(congelar({ ...estadoInicial(f), sel: 'a1' }), { k: 'iniciarConexion', ancla: 'a2', rol: 'origen', tipo: 'seq' });
    },
    accion: { k: 'intentarConexion', id: 'z' },
    clase: 'cambiar',
    conAviso: false,
  },
];

// ---------------------------------------------------------------- qué se guarda

describe('deshacer · lo que se guarda', () => {
  it('constructor.deshacer.cada_accion_estructural_guarda_la_instantanea_exacta_de_antes_con_su_texto_y_su_aviso', () => {
    for (const c of CASOS) {
      const antes = c.antes();
      const despues = ir(antes, c.accion);
      const m = c.nombre;
      expect(despues.historial, m).toHaveLength(antes.historial.length + 1);
      const inst = cima(despues);
      // las listas son las MISMAS (no copias: el reductor nunca las modifica)
      expect(inst.nodes, m).toBe(antes.flujo.nodes);
      expect(inst.edges, m).toBe(antes.flujo.edges);
      expect(inst.sel, m).toBe(antes.sel);
      expect(inst.nombreFlujo, m).toBe(antes.flujo.nombreFlujo);
      expect(inst.clase, m).toBe(c.clase);
      // lo que la acción le dijo a la persona, y de qué aviso es
      expect(inst.texto, m).toBe(despues.aviso?.texto);
      expect(inst.avisoId, m).toBe(despues.aviso?.id);
      expect(despues.aviso?.conDeshacer, m).toBe(c.conAviso);
      expect(puedeDeshacer(despues), m).toBe(true);
      // lo anterior de la pila no se toca
      for (const [i, vieja] of antes.historial.entries()) expect(despues.historial[i], m).toBe(vieja);
    }
  });

  it('constructor.deshacer.deshacer_devuelve_exactamente_lo_de_antes_para_cada_accion_estructural', () => {
    for (const c of CASOS) {
      const antes = c.antes();
      const despues = ir(antes, c.accion);
      const e = ir(despues, { k: 'deshacer' });
      const m = c.nombre;
      expect(e.flujo.nodes, m).toBe(antes.flujo.nodes);
      expect(e.flujo.edges, m).toBe(antes.flujo.edges);
      expect(e.flujo.nombreFlujo, m).toBe(antes.flujo.nombreFlujo);
      expect(e.sel, m).toBe(antes.sel);
      expect(e.selEdge, m).toBeNull();
      expect(e.menu, m).toBeNull();
      expect(e.conectando, m).toBeNull();
      expect(e.historial.length, m).toBe(antes.historial.length);
      expect(invariantesDelGrafo(e.flujo.nodes, e.flujo.edges), m).toEqual([]);
      avisoEs(e, T.deshecho(c.clase));
    }
  });

  it('constructor.deshacer.el_texto_de_listo_depende_de_la_clase_de_cambio', () => {
    expect(T.deshecho('quitar').texto).toBe('Listo: volvimos a poner lo que quitaste.');
    expect(T.deshecho('agregar').texto).toBe('Listo: quitamos lo que habías agregado.');
    expect(T.deshecho('cargar').texto).toBe('Listo: volvió el flujo que tenías antes.');
    expect(T.deshecho('cambiar').texto).toBe('Listo: volvimos a como estaba antes.');
    const e = ir(conEjemplo(), { k: 'quitarNodo', id: 'p2' }, { k: 'deshacer' });
    expect(e.aviso?.texto).toBe('Listo: volvimos a poner lo que quitaste.');
    expect(e.aviso?.tipo).toBe('ok');
  });

  it('constructor.deshacer.deshacer_restaura_cuadros_conexiones_nombre_y_seleccion_pero_no_el_contador', () => {
    const e0 = conEjemplo();
    expect(e0.siguiente).toBe(20);
    // quitar a1 une t1 con a2 y gasta el número 21
    const quitado = ir(e0, { k: 'quitarNodo', id: 'a1' });
    expect(quitado.siguiente).toBe(21);
    expect(quitado.sel).toBeNull();
    const vuelto = ir(quitado, { k: 'deshacer' });
    expect(vuelto.flujo.nodes).toBe(e0.flujo.nodes);
    expect(vuelto.flujo.edges).toBe(e0.flujo.edges);
    expect(vuelto.sel).toBe('a1');
    expect(vuelto.siguiente).toBe(21); // el contador NO se restaura: el e21 de la unión no se vuelve a repartir
    expect(vuelto.historial).toEqual([]);
    expect(puedeDeshacer(vuelto)).toBe(false);
    // lo que se cree después usa un número que nadie usó
    const nuevo = ir(vuelto, { k: 'abrirMenu', ancla: 'a2', tipo: 'tool' }, { k: 'crearDesdeMenu', que: 'app', nombreApp: 'Notion' });
    expect(nuevo.flujo.nodes[nuevo.flujo.nodes.length - 1]?.id).toBe('p22');
    expect(nuevo.flujo.edges.map(x => x.id)).not.toContain('e21');
    // el nombre del flujo también vuelve: cargar el ejemplo lo cambia
    const v0 = vacio();
    const cargado = ir(v0, { k: 'cargarEjemplo' });
    expect(cargado.flujo.nombreFlujo).toBe('Atención a clientes');
    const atras = ir(cargado, { k: 'deshacer' });
    expect(atras.flujo.nombreFlujo).toBe('Mi automatización');
    expect(atras.flujo.nodes).toBe(v0.flujo.nodes);
    expect(atras.sel).toBeNull();
    // y el de un flujo de afuera
    const resumen = muestras()[2];
    if (!resumen) throw new Error('muestra');
    const ajeno: Flujo = { nodes: resumen.nodes, edges: resumen.edges, nombreFlujo: resumen.nombre };
    const otro = ir(conEjemplo(), { k: 'cargarFlujo', flujo: ajeno });
    expect(otro.flujo.nombreFlujo).toBe('Resumen diario');
    expect(ir(otro, { k: 'deshacer' }).flujo.nombreFlujo).toBe('Atención a clientes');
  });

  it('constructor.deshacer.limpiar_se_puede_deshacer_y_el_nombre_del_flujo_se_queda_en_ambos_sentidos', () => {
    const e0 = ir(conEjemplo(), { k: 'renombrarFlujo', nombre: 'Mi nombre' });
    const limpio = ir(e0, { k: 'limpiar' });
    expect(limpio.flujo.nodes).toEqual([]);
    expect(limpio.flujo.edges).toEqual([]);
    expect(limpio.flujo.nombreFlujo).toBe('Mi nombre');
    avisoEs(limpio, T.limpiado(), true); // el aviso de «Empezamos de cero» ofrece Deshacer
    expect(puedeDeshacer(limpio)).toBe(true);
    expect(cima(limpio).avisoId).toBe(limpio.aviso?.id);
    const vuelto = ir(limpio, { k: 'deshacer' });
    expect(vuelto.flujo.nodes).toBe(e0.flujo.nodes);
    expect(vuelto.flujo.edges).toBe(e0.flujo.edges);
    expect(vuelto.flujo.nombreFlujo).toBe('Mi nombre');
    expect(vuelto.sel).toBe('a1');
    avisoEs(vuelto, T.deshecho('quitar'));
    // limpiar y desde ahí empezar de nuevo: el disparador nuevo también se puede deshacer, y luego limpiar
    const otra = ir(limpio, { k: 'elegirDisparador', tipo: 'web' });
    expect(otra.historial).toHaveLength(2);
    expect(ir(otra, { k: 'deshacer' }, { k: 'deshacer' }).flujo.nodes).toBe(e0.flujo.nodes);
  });

  it('constructor.deshacer.cada_deshacer_gasta_una_instantanea_y_se_recorre_en_orden_inverso', () => {
    const e0 = conEjemplo();
    const e1 = ir(e0, { k: 'quitarNodo', id: 'p2' });
    const e2 = ir(e1, { k: 'quitarEnlace', id: 'e2' });
    const e3 = ir(e2, { k: 'cambiarTipoEnlace', id: 'e3', tipo: 'seq' });
    expect(e3.historial.map(i => i.clase)).toEqual(['quitar', 'quitar', 'cambiar']);
    const d1 = ir(e3, { k: 'deshacer' });
    expect(d1.flujo.edges).toBe(e2.flujo.edges);
    expect(d1.flujo.nodes).toBe(e2.flujo.nodes);
    const d2 = ir(d1, { k: 'deshacer' });
    expect(d2.flujo.edges).toBe(e1.flujo.edges);
    expect(d2.flujo.nodes).toBe(e1.flujo.nodes);
    const d3 = ir(d2, { k: 'deshacer' });
    expect(d3.flujo.edges).toBe(e0.flujo.edges);
    expect(d3.flujo.nodes).toBe(e0.flujo.nodes);
    expect(puedeDeshacer(d3)).toBe(false);
  });

  it('constructor.deshacer.la_pila_guarda_hasta_20_y_descarta_las_mas_viejas', () => {
    expect(MAX_HISTORIAL).toBe(20);
    let e = conEjemplo();
    const flujos = [e.flujo];
    for (let i = 1; i <= 25; i += 1) {
      e = ir(e, { k: 'cambiarTipoEnlace', id: 'e2', tipo: i % 2 === 1 ? 'tool' : 'seq' });
      flujos.push(e.flujo);
      expect(e.historial.length).toBe(Math.min(i, MAX_HISTORIAL));
    }
    expect(e.historial).toHaveLength(20);
    // quedan las instantáneas de antes de los cambios 6 a 25: la más vieja es el estado tras el cambio 5
    expect(e.historial[0]?.nodes).toBe(flujos[5]?.nodes);
    expect(e.historial[0]?.edges).toBe(flujos[5]?.edges);
    expect(cima(e).edges).toBe(flujos[24]?.edges);
    for (let i = 0; i < 20; i += 1) {
      expect(puedeDeshacer(e)).toBe(true);
      e = ir(e, { k: 'deshacer' });
    }
    expect(puedeDeshacer(e)).toBe(false);
    expect(e.flujo.edges).toBe(flujos[5]?.edges); // más atrás ya no se puede
    expect(e.flujo.edges.find(x => x.id === 'e2')?.tipo).toBe('tool');
    // un deshacer de más no rompe nada: lo dice
    const de_mas = ir(e, { k: 'deshacer' });
    expect(de_mas.flujo).toBe(e.flujo);
    avisoEs(de_mas, T.nadaQueDeshacer());
    expect(de_mas.aviso?.texto).toBe('Ya no hay nada que deshacer.');
  });

  it('constructor.deshacer.agregar_entra_en_la_pila_pero_su_aviso_no_ofrece_deshacer_y_deshacerlo_quita_lo_agregado', () => {
    const e0 = abierto({ k: 'abrirMenu', ancla: 'a2', tipo: 'seq' });
    const e1 = ir(e0, { k: 'crearDesdeMenu', que: 'agente' });
    expect(e1.flujo.nodes).toHaveLength(6);
    expect(e1.aviso?.conDeshacer).toBe(false);
    expect(puedeDeshacer(e1)).toBe(true); // el botón de la barra y Ctrl+Z sí valen
    const e2 = ir(e1, { k: 'deshacer' });
    expect(e2.flujo.nodes).toBe(e0.flujo.nodes);
    expect(e2.flujo.edges).toBe(e0.flujo.edges);
    avisoEs(e2, T.deshecho('agregar'));
    // el disparador recién elegido en un lienzo vacío: deshacer vuelve al lienzo vacío y el foco va a elegir otra vez
    const t = ir(vacio(), { k: 'elegirDisparador', tipo: 'tiempo' });
    expect(t.aviso?.conDeshacer).toBe(false);
    const sinT = ir(t, { k: 'deshacer' });
    expect(sinT.flujo.nodes).toEqual([]);
    expect(foco(sinT)).toEqual({ k: 'primeraOpcionDisparador' });
  });

  it('constructor.deshacer.lo_que_no_cambia_nada_no_guarda_instantanea_y_los_fallos_tampoco', () => {
    const e0 = conEjemplo();
    const sinPila = (e: E, nombre: string) => {
      expect(e.historial, nombre).toBe(e0.historial);
      expect(puedeDeshacer(e), nombre).toBe(false);
    };
    // un id que no existe
    sinPila(ir(e0, { k: 'quitarNodo', id: 'zzz' }), 'quitarNodo zzz');
    sinPila(ir(e0, { k: 'quitarEnlace', id: 'zzz' }), 'quitarEnlace zzz');
    sinPila(ir(e0, { k: 'cambiarTipoEnlace', id: 'zzz', tipo: 'tool' }), 'cambiarTipoEnlace zzz');
    // el mismo tipo
    sinPila(ir(e0, { k: 'cambiarTipoEnlace', id: 'e2', tipo: 'seq' }), 'cambiarTipoEnlace igual');
    // una regla lo rechaza
    sinPila(ir(e0, { k: 'cambiarTipoEnlace', id: 'e1', tipo: 'tool' }), 'cambiarTipoEnlace rechazado');
    // un tope
    let tope = e0;
    for (let i = 0; i < 2; i += 1) tope = ir(tope, { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' }, { k: 'crearDesdeMenu', que: 'agente' });
    const llena = tope.historial.length;
    const rechazado = ir(tope, { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' }, { k: 'crearDesdeMenu', que: 'agente' });
    expect(rechazado.historial.length).toBe(llena);
    // una app sin nombre
    const sinNombre = ir(e0, { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' }, { k: 'crearDesdeMenu', que: 'app', nombreApp: '' });
    sinPila(sinNombre, 'app sin nombre');
    // otro disparador cuando ya hay uno
    sinPila(ir(e0, { k: 'elegirDisparador', tipo: 'web' }), 'segundo disparador');
    // limpiar lo que ya está vacío
    expect(ir(vacio(), { k: 'limpiar' }).historial).toEqual([]);
    // un flujo de afuera rechazado
    sinPila(ir(e0, { k: 'cargarFlujo', flujo: { nodes: [], edges: [{ id: 'e1', de: 'x', a: 'y', tipo: 'seq' }], nombreFlujo: 'x' } }), 'cargarFlujo rechazado');
    // conectar con un cuadro que no sirve
    const c = ir(e0, { k: 'iniciarConexion', ancla: 'a2', rol: 'origen', tipo: 'seq' }, { k: 'intentarConexion', id: 'p1' });
    sinPila(c, 'intentarConexion rechazado');
    // deshacer sin nada
    expect(ir(e0, { k: 'deshacer' }).historial).toBe(e0.historial);
  });
});

// ---------------------------------------------------------------- qué la tira y qué la deja quieta

describe('deshacer · lo que la invalida y lo que no', () => {
  /** Quitó p2 (con aviso y Deshacer) y deja el estado listo para probar lo que viene después. */
  const tras = (): E => ir(conEjemplo(), { k: 'quitarNodo', id: 'p2' });

  it('constructor.deshacer.tras_editar_un_texto_el_deshacer_del_aviso_ya_no_aplica_y_no_borra_lo_escrito', () => {
    const q = tras();
    expect(q.aviso?.conDeshacer).toBe(true);
    const avisoId = q.aviso?.id ?? 0;
    const editado = ir(q, { k: 'editarNodo', id: 'a1', parche: { nombre: 'Mi agente' } });
    // el aviso es el mismo (mismo id, mismo texto: no se vuelve a anunciar) pero ya no ofrece Deshacer
    expect(editado.aviso?.id).toBe(avisoId);
    expect(editado.aviso?.texto).toBe(q.aviso?.texto);
    expect(editado.aviso?.conDeshacer).toBe(false);
    expect(editado.historial).toEqual([]);
    expect(puedeDeshacer(editado)).toBe(false);
    // el Deshacer que quedó en un aviso viejo no hace nada y lo dice
    const viejo = ir(editado, { k: 'deshacer', avisoId });
    expect(viejo.flujo).toBe(editado.flujo);
    avisoEs(viejo, T.yaNoSePuedeDeshacer());
    expect(viejo.aviso?.texto).toBe('Eso ya no se puede deshacer: cambiaste algo después.');
    // el del botón de la barra ni siquiera tiene qué deshacer
    const barra = ir(editado, { k: 'deshacer' });
    expect(barra.flujo).toBe(editado.flujo);
    avisoEs(barra, T.nadaQueDeshacer());
    // y lo escrito sigue ahí
    expect((nodo(barra, 'a1') as NodoAgente).nombre).toBe('Mi agente');
    expect(barra.flujo.nodes.some(n => n.id === 'p2')).toBe(false);
  });

  it('constructor.deshacer.mover_con_el_raton_o_el_teclado_o_renombrar_tambien_tiran_la_pila', () => {
    const casos: [string, A][] = [
      ['moverNodo', { k: 'moverNodo', id: 'a1', x: 400, y: 300 }],
      ['moverConTeclado', { k: 'moverConTeclado', id: 'a1', direccion: 'derecha' }],
      ['moverConTeclado grande', { k: 'moverConTeclado', id: 'p1', direccion: 'abajo', grande: true }],
      ['renombrarFlujo', { k: 'renombrarFlujo', nombre: 'Otro nombre' }],
      ['editarNodo tarea', { k: 'editarNodo', id: 'a2', parche: { tarea: 'Haz algo' } }],
      ['editarNodo disparador', { k: 'editarNodo', id: 't1', parche: { tipo: 'web' } }],
      ['editarNodo app', { k: 'editarNodo', id: 'p1', parche: { nombre: 'Notion' } }],
    ];
    for (const [nombre, accion] of casos) {
      const q = tras();
      expect(q.historial, nombre).toHaveLength(1);
      const e = ir(q, accion);
      expect(e.historial, nombre).toEqual([]);
      expect(e.aviso?.conDeshacer, nombre).toBe(false);
      expect(puedeDeshacer(e), nombre).toBe(false);
      // y la pila entera: con dos quitar antes, también se va todo
      const doble = ir(q, { k: 'quitarEnlace', id: 'e2' }, accion);
      expect(ir(q, { k: 'quitarEnlace', id: 'e2' }).historial, nombre).toHaveLength(2);
      expect(doble.historial, nombre).toEqual([]);
    }
    // el arrastre del mockup (arrastre + Deshacer = la x vuelve de 392 a 312) ya no pasa
    const q = tras();
    const movido = ir(q, { k: 'moverNodo', id: 'a1', x: 392, y: 180 });
    const intento = ir(movido, { k: 'deshacer' });
    expect(nodo(intento, 'a1').x).toBe(392);
  });

  it('constructor.deshacer.lo_que_no_cambia_nada_no_tira_la_pila', () => {
    // con a1 ya en la rejilla (el ejemplo trae y=180, que la rejilla de 8 acomoda a 184 al primer movimiento)
    const enRejilla = ir(conEjemplo(), { k: 'moverNodo', id: 'a1', x: 312, y: 184 });
    const base = ir(enRejilla, { k: 'quitarNodo', id: 'p1' });
    expect(base.historial).toHaveLength(1);
    const sinCambio: [string, A][] = [
      ['moverNodo a donde ya está', { k: 'moverNodo', id: 'a1', x: 312, y: 184 }],
      ['moverNodo a un punto que la rejilla lleva al mismo lugar', { k: 'moverNodo', id: 'a1', x: 314, y: 186 }],
      ['moverNodo con NaN', { k: 'moverNodo', id: 'a1', x: Number.NaN, y: 0 }],
      ['moverNodo de un cuadro que no existe', { k: 'moverNodo', id: 'zzz', x: 0, y: 0 }],
      ['moverConTeclado de un cuadro que no existe', { k: 'moverConTeclado', id: 'zzz', direccion: 'arriba' }],
      ['renombrarFlujo con el mismo nombre', { k: 'renombrarFlujo', nombre: base.flujo.nombreFlujo }],
      ['editarNodo con el mismo valor', { k: 'editarNodo', id: 'a1', parche: { nombre: 'Atención a clientes' } }],
      ['editarNodo con un campo que no es de ese cuadro', { k: 'editarNodo', id: 'a1', parche: { ruta: 'x' } as never }],
      ['editarNodo con un valor que no existe', { k: 'editarNodo', id: 'a1', parche: { ia: 'otra' } as never }],
      ['editarNodo de un cuadro que no existe', { k: 'editarNodo', id: 'zzz', parche: { nombre: 'x' } }],
    ];
    for (const [nombre, accion] of sinCambio) {
      const e = ir(base, accion);
      expect(e.historial, nombre).toBe(base.historial);
      expect(e.aviso?.conDeshacer, nombre).toBe(true);
    }
    // en cambio un movimiento de verdad, aunque sea de 8 px, sí la tira
    expect(ir(base, { k: 'moverNodo', id: 'a1', x: 320, y: 184 }).historial).toEqual([]);
  });

  it('constructor.deshacer.moverse_contra_el_borde_no_cambia_nada_y_la_pila_se_queda', () => {
    // un cuadro ya pegado al borde: mover más allá no cambia su posición
    const f = ejemplo();
    f.nodes = f.nodes.map(n => (n.id === 'p1' ? { ...n, x: 0, y: 0 } : n));
    const base = ir(congelar({ ...estadoInicial(f), sel: null }), { k: 'quitarNodo', id: 'p2' });
    const e = ir(base, { k: 'moverConTeclado', id: 'p1', direccion: 'izquierda' });
    expect(e.historial).toBe(base.historial);
    expect(e.sel).toBe('p1'); // igual lo elige
    expect(e.aviso?.conDeshacer).toBe(true);
    const e2 = ir(base, { k: 'moverNodo', id: 'p1', x: -100, y: -100 });
    expect(e2.historial).toBe(base.historial);
  });

  it('constructor.deshacer.seleccionar_abrir_menus_y_cancelar_no_tocan_la_pila_y_el_aviso_viejo_sigue_valiendo', () => {
    const q = tras();
    const avisoId = q.aviso?.id ?? 0;
    const quietas: [string, A[]][] = [
      ['abrirNodo', [{ k: 'abrirNodo', id: 'a2', teclado: true }]],
      ['abrirEnlace', [{ k: 'abrirEnlace', id: 'e1' }]],
      ['abrirMenu y cerrar', [{ k: 'abrirMenu', ancla: 'a1', tipo: 'seq' }, { k: 'pasoMenu', paso: 'app' }, { k: 'cerrarMenu' }]],
      ['conectar y cancelar', [{ k: 'iniciarConexion', ancla: 'a2', rol: 'origen', tipo: 'seq' }, { k: 'cancelarConexion' }]],
      ['Esc', [{ k: 'abrirMenu', ancla: 'a1', tipo: 'tool' }, { k: 'cerrarTodo' }]],
      ['volver de Ajustes', [{ k: 'abrirNodo', id: 'a1' }, { k: 'volverDeAjustes' }]],
      ['limpiar peticiones', [{ k: 'limpiarPeticiones' }]],
      ['un rechazo cualquiera', [{ k: 'cambiarTipoEnlace', id: 'e1', tipo: 'tool' }]],
    ];
    for (const [nombre, acciones] of quietas) {
      const e = ir(q, ...acciones);
      expect(e.historial, nombre).toBe(q.historial);
      expect(puedeDeshacer(e), nombre).toBe(true);
      // el aviso de pantalla cambió (ya no es el de «Quitamos…»), pero el Deshacer del aviso viejo, que sigue en la caja de abajo a la derecha, vale
      const deshecho = ir(e, { k: 'deshacer', avisoId });
      expect(deshecho.flujo.nodes.some(n => n.id === 'p2'), nombre).toBe(true);
      avisoEs(deshecho, T.deshecho('quitar'));
    }
  });

  it('constructor.deshacer.un_aviso_viejo_no_deshace_lo_que_vino_despues', () => {
    const e0 = conEjemplo();
    const e1 = ir(e0, { k: 'quitarNodo', id: 'p2' });
    const id1 = e1.aviso?.id ?? 0;
    const e2 = ir(e1, { k: 'quitarNodo', id: 'p1' });
    const id2 = e2.aviso?.id ?? 0;
    expect(id2).toBeGreaterThan(id1);
    // el Deshacer del primer aviso ya no es de la instantánea de arriba: no hace nada
    const rechazo = ir(e2, { k: 'deshacer', avisoId: id1 });
    expect(rechazo.flujo).toBe(e2.flujo);
    expect(rechazo.historial).toBe(e2.historial);
    avisoEs(rechazo, T.yaNoSePuedeDeshacer());
    // el del segundo sí; y entonces el primero vuelve a valer
    const e3 = ir(rechazo, { k: 'deshacer', avisoId: id2 });
    expect(e3.flujo.nodes).toBe(e1.flujo.nodes);
    const e4 = ir(e3, { k: 'deshacer', avisoId: id1 });
    expect(e4.flujo.nodes).toBe(e0.flujo.nodes);
    // un avisoId inventado
    expect(ir(e2, { k: 'deshacer', avisoId: 99999 }).flujo).toBe(e2.flujo);
  });

  it('constructor.deshacer.el_aviso_que_ofrece_deshacer_siempre_es_el_de_la_instantanea_de_arriba', () => {
    let e = conEjemplo();
    const pasos: A[] = [
      { k: 'quitarNodo', id: 'p2' },
      { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' },
      { k: 'crearDesdeMenu', que: 'agente' },
      { k: 'cambiarTipoEnlace', id: 'e2', tipo: 'tool' },
      { k: 'quitarEnlace', id: 'e3' },
      { k: 'moverNodo', id: 'a1', x: 24, y: 24 },
      { k: 'quitarNodo', id: 'a2' },
      { k: 'deshacer' },
      { k: 'limpiar' },
      { k: 'cargarEjemplo' },
      { k: 'editarNodo', id: 'a1', parche: { tarea: 'x' } },
      { k: 'quitarNodo', id: 'p1' },
      { k: 'abrirNodo', id: 'a1' },
    ];
    for (const a of pasos) {
      e = ir(e, a);
      if (e.aviso?.conDeshacer) {
        expect(cima(e).avisoId, a.k).toBe(e.aviso.id);
        expect(puedeDeshacer(e), a.k).toBe(true);
      }
    }
  });

  it('constructor.deshacer.cargar_un_flujo_ajeno_o_el_ejemplo_se_deshace_y_uno_rechazado_no_guarda_nada', () => {
    const e0 = conEjemplo();
    const nuevo = ir(e0, { k: 'cargarEjemplo' });
    expect(nuevo.historial).toHaveLength(1);
    expect(cima(nuevo).clase).toBe('cargar');
    expect(nuevo.flujo.nodes).not.toBe(e0.flujo.nodes); // el ejemplo arma objetos nuevos
    const vuelto = ir(nuevo, { k: 'deshacer' });
    expect(vuelto.flujo.nodes).toBe(e0.flujo.nodes);
    avisoEs(vuelto, T.deshecho('cargar'));
    expect(vuelto.aviso?.texto).toBe('Listo: volvió el flujo que tenías antes.');
    // un flujo de afuera que no cumple los topes
    const cinco: Flujo = {
      nodes: Array.from({ length: 5 }, (_, i) => ({ id: `a${i + 1}`, kind: 'agent', x: i * 300, y: 0, nombre: `A${i}`, ia: 'openai', tarea: '', instrucciones: '' })),
      edges: [],
      nombreFlujo: 'Muchos',
    };
    const rechazo = ir(e0, { k: 'cargarFlujo', flujo: cinco });
    expect(rechazo.historial).toBe(e0.historial);
    expect(rechazo.flujo).toBe(e0.flujo);
  });

  it('constructor.deshacer.poner_en_medio_y_cambiar_el_tipo_devuelven_las_posiciones_exactas_de_antes', () => {
    const e0 = conEjemplo();
    const medio = ir(e0, { k: 'abrirMenu', ancla: 'a1', tipo: 'seq', insertarEn: 'e2' }, { k: 'crearDesdeMenu', que: 'app', nombreApp: 'Gmail' });
    expect(nodo(medio, 'a2').x).toBe(1000); // se corrió para hacer lugar
    const atras = ir(medio, { k: 'deshacer' });
    expect(nodo(atras, 'a2')).toBe(nodo(e0, 'a2'));
    expect(nodo(atras, 'a2').x).toBe(616);
    expect(nodo(atras, 'p2').x).toBe(480);
    expect(atras.flujo.edges.map(x => x.id)).toEqual(['e1', 'e2', 'e3', 'e4']);
    // el contador no se devuelve: el cuadro y las dos conexiones de la inserción no se vuelven a repartir
    expect(atras.siguiente).toBe(medio.siguiente);
    const tipo = ir(e0, { k: 'cambiarTipoEnlace', id: 'e4', tipo: 'seq' });
    expect(nodo(tipo, 'p2').x).not.toBe(480);
    const igual = ir(tipo, { k: 'deshacer' });
    expect(nodo(igual, 'p2')).toBe(nodo(e0, 'p2'));
    expect(igual.flujo.edges.find(x => x.id === 'e4')?.tipo).toBe('tool');
  });

  it('constructor.deshacer.deshacer_sin_nada_guardado_lo_dice_sin_tocar_el_flujo', () => {
    const e0 = conEjemplo();
    const e = ir(e0, { k: 'deshacer' });
    expect(e.flujo).toBe(e0.flujo);
    expect(e.historial).toBe(e0.historial);
    avisoEs(e, T.nadaQueDeshacer());
    expect(e.aviso?.tipo).toBe('info');
    // cada vez es un aviso nuevo (el lector de pantalla lo repite)
    const otra = ir(e, { k: 'deshacer' });
    expect(otra.aviso?.id).toBeGreaterThan(e.aviso?.id ?? 0);
  });
});

// ---------------------------------------------------------------- foco

describe('deshacer · foco', () => {
  it('constructor.deshacer.el_foco_va_al_cuadro_restaurado_y_si_no_hay_al_primero_o_a_elegir_disparador', () => {
    // con un cuadro elegido: ese cuadro
    const conSel = ir(conEjemplo(), { k: 'quitarNodo', id: 'a1' }, { k: 'deshacer' });
    expect(foco(conSel)).toEqual({ k: 'nodo', id: 'a1' });
    // sin cuadro elegido: el primero
    const sinSel = ir(congelar(estadoInicial(ejemplo())), { k: 'quitarNodo', id: 'p2' }, { k: 'deshacer' });
    expect(sinSel.sel).toBeNull();
    expect(foco(sinSel)).toEqual({ k: 'primerNodo' });
    // volver a un lienzo vacío: la primera opción de «Elige cómo arranca tu flujo»
    const vaciado = ir(vacio(), { k: 'cargarEjemplo' }, { k: 'deshacer' });
    expect(vaciado.flujo.nodes).toEqual([]);
    expect(foco(vaciado)).toEqual({ k: 'primeraOpcionDisparador' });
    // cada deshacer pide el foco de nuevo (n sube)
    const dos = ir(conEjemplo(), { k: 'quitarNodo', id: 'p2' }, { k: 'quitarNodo', id: 'p1' }, { k: 'deshacer' });
    const n = dos.foco?.n ?? 0;
    expect(ir(dos, { k: 'deshacer' }).foco?.n).toBeGreaterThan(n);
  });
});
