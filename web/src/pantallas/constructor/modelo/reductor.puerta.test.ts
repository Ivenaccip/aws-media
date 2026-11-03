// La PUERTA del reductor: lo que pasa cuando un flujo llega de afuera (`cargarFlujo`, `estadoInicial(flujo)`), los topes
// de largo de lo que se teclea (`editarNodo`, `renombrarFlujo`) y las peticiones que no deben apuntar a lo que ya no
// existe. Regresiones de la revisión del motor (hallazgos Q3, Q4, Q5, H-01, H-02, H-03, H-07, H-08, H-10 y H-11).
//
// La regla (plan D7): el reductor es la ÚNICA barrera. Un flujo que no pasó por el borrador no puede dejar un estado
// con campos de tipo equivocado, ids que el borrador rechazaría, textos sin tope ni nada que haga lanzar a un selector.
//
// Cada `it` lleva su nombre literal `constructor.reductor.…` (registro anti-pérdida: los `it.each` no cuentan).

import { describe, expect, it } from 'vitest';

import { crearBorrador, leerBorrador, normalizarFlujo, prepararTraspaso, type Almacen } from './borrador';
import {
  LARGO_DESC_AYUDANTE,
  LARGO_NOMBRE_AGENTE,
  LARGO_NOMBRE_APP,
  LARGO_NOMBRE_FLUJO,
  LARGO_RUTA,
  LARGO_TEXTO_AGENTE,
  NOMBRE_FLUJO_INICIAL,
  TOPE_CUADROS,
} from './datos/constantes';
import { ejemplo } from './ejemplos';
import { construirFlujo, revisarFlujo } from './exportar';
import { invariantesDelGrafo, violacionesDelGrafo } from './grafo';
import { estadoInicial, reducir } from './reductor';
import { resumenFlujo, vistaAjustes, vistaFlechas, vistaNodos } from './selectores';
import * as T from './textos';
import type { AccionConstructor as A, EstadoConstructor as E, Flujo, Nodo, NodoAgente } from './tipos';

// ---------------------------------------------------------------- ayudas

/** Un valor de JSON legítimo que hace lanzar a `String(v)`: un objeto con `toString: null`. */
const SIN_TOSTRING = (): unknown => JSON.parse('{"toString":null}');

/** Un sustituto suelto (la mitad de un emoji) en cualquier parte del texto. */
const SUSTITUTO_SUELTO = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

const vacio = (): E => estadoInicial();
const ir = (e: E, ...acciones: A[]): E => acciones.reduce((s, a) => reducir(s, a), e);
const conEjemplo = (): E => estadoInicial(ejemplo());

/** El ejemplo como JSON recién leído (sin tipos: lo que llegaría de afuera). */
const ejemploCrudo = (): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[]; nombreFlujo: unknown } =>
  JSON.parse(JSON.stringify(ejemplo())) as { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[]; nombreFlujo: unknown };

/** El cuadro con ese id del flujo crudo. */
function crudo(f: { nodes: Record<string, unknown>[] }, id: string): Record<string, unknown> {
  const n = f.nodes.find(x => x['id'] === id);
  if (!n) throw new Error(`no hay ${id}`);
  return n;
}

/** Una memoria de mentira para el borrador. */
function memoria(): Almacen & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: k => datos.get(k) ?? null,
    setItem: (k, v) => void datos.set(k, v),
    removeItem: k => void datos.delete(k),
  };
}

/** Todo lo que la pantalla pregunta de un estado: ninguna pregunta puede lanzar. */
function preguntaTodo(e: E): void {
  resumenFlujo(e);
  vistaNodos(e);
  vistaFlechas(e);
  for (const n of e.flujo.nodes) vistaAjustes({ ...e, sel: n.id });
  revisarFlujo(e.flujo);
  construirFlujo(e.flujo, { zona: 'UTC' });
}

// ---------------------------------------------------------------- H-01 · un valor de JSON que hace lanzar a String()

describe('reductor · la puerta no lanza con valores de JSON raros', () => {
  it('constructor.reductor.un_objeto_con_tostring_nulo_en_x_y_o_el_tipo_no_hace_lanzar_a_las_invariantes_ni_al_reductor', () => {
    const variantes: [string, (f: ReturnType<typeof ejemploCrudo>) => void][] = [
      ['x de un cuadro', f => void (crudo(f, 'a1')['x'] = SIN_TOSTRING())],
      ['y de un cuadro', f => void (crudo(f, 'a1')['y'] = SIN_TOSTRING())],
      ['tipo de una conexión', f => void (f.edges[0]!['tipo'] = SIN_TOSTRING())],
    ];
    for (const [nombre, estropea] of variantes) {
      const f = ejemploCrudo();
      estropea(f);
      // las invariantes prometen aceptar CUALQUIER cosa: reportan, no lanzan
      expect(() => invariantesDelGrafo(f.nodes as unknown as Nodo[], f.edges as never), nombre).not.toThrow();
      expect(() => violacionesDelGrafo(f.nodes as unknown as Nodo[], f.edges as never), nombre).not.toThrow();
      expect(invariantesDelGrafo(f.nodes as unknown as Nodo[], f.edges as never).length, nombre).toBeGreaterThan(0);
      // y el reductor tampoco: lo rechaza con un aviso y deja el flujo como estaba
      const e0 = conEjemplo();
      let e1: E | undefined;
      expect(() => void (e1 = reducir(e0, { k: 'cargarFlujo', flujo: f as unknown as Flujo })), nombre).not.toThrow();
      expect(e1?.flujo, nombre).toBe(e0.flujo);
      expect(e1?.aviso?.tipo, nombre).toBe('mal');
      expect(() => estadoInicial(f as unknown as Flujo), nombre).not.toThrow();
      expect(estadoInicial(f as unknown as Flujo).flujo.nodes, nombre).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------- H-02 / Q4 · la puerta valida los campos, no solo el grafo

describe('reductor · un flujo de afuera pasa por la misma limpieza que el borrador', () => {
  it('constructor.reductor.cargar_un_flujo_con_campos_de_tipo_equivocado_o_enumeraciones_que_no_existen_lo_rechaza', () => {
    const estropeos: [string, (f: ReturnType<typeof ejemploCrudo>) => void][] = [
      ['nombre de agente que es un objeto', f => void (crudo(f, 'a1')['nombre'] = { a: 1 })],
      ['nombre de agente que es un número', f => void (crudo(f, 'a1')['nombre'] = 42)],
      ['tarea nula', f => void (crudo(f, 'a1')['tarea'] = null)],
      ['instrucciones que son un número', f => void (crudo(f, 'a1')['instrucciones'] = 7)],
      ['una IA que no se ofrece', f => void (crudo(f, 'a1')['ia'] = 'nope')],
      ['un tipo de disparador que no existe', f => void (crudo(f, 't1')['tipo'] = 'bogus')],
      ['una frecuencia que no existe', f => void (crudo(f, 't1')['frec'] = 'siempre')],
      ['una ruta que no es texto', f => void (crudo(f, 't1')['ruta'] = SIN_TOSTRING())],
      ['el nombre de una app que no es texto', f => void (crudo(f, 'p1')['nombre'] = SIN_TOSTRING())],
      ['una descripción que es un arreglo', f => void (crudo(f, 'a2')['desc'] = ['x'])],
      ['un id con espacios', f => void (crudo(f, 'p1')['id'] = 'p 1')],
    ];
    for (const [nombre, estropea] of estropeos) {
      const f = ejemploCrudo();
      estropea(f);
      const e0 = conEjemplo();
      const e1 = reducir(e0, { k: 'cargarFlujo', flujo: f as unknown as Flujo });
      expect(e1.flujo, nombre).toBe(e0.flujo);
      expect(e1.aviso?.tipo, nombre).toBe('mal');
      // desde el arranque, igual: un flujo así no entra
      expect(estadoInicial(f as unknown as Flujo).flujo.nodes, nombre).toEqual([]);
      // y ningún estado que salga de aquí hace lanzar a la pantalla
      expect(() => preguntaTodo(e1), nombre).not.toThrow();
    }
  });

  it('constructor.reductor.cargar_un_flujo_con_ids_que_el_borrador_rechaza_tambien_lo_rechaza_el_reductor', () => {
    for (const id of ['a b', '__proto__', 'constructor', 'x'.repeat(100_000), '1a', '']) {
      const f = ejemploCrudo();
      crudo(f, 'p1')['id'] = id;
      for (const edge of f.edges) {
        if (edge['a'] === 'p1') edge['a'] = id;
        if (edge['de'] === 'p1') edge['de'] = id;
      }
      const e0 = conEjemplo();
      const e1 = reducir(e0, { k: 'cargarFlujo', flujo: f as unknown as Flujo });
      expect(e1.flujo, JSON.stringify(id.slice(0, 20))).toBe(e0.flujo);
      expect(e1.aviso?.tipo).toBe('mal');
    }
  });

  it('constructor.reductor.lo_que_el_reductor_acepta_de_afuera_el_borrador_lo_guarda_y_lo_devuelve_igual', () => {
    const f = ejemploCrudo();
    crudo(f, 'a1')['tarea'] = 'x'.repeat(9000);
    crudo(f, 't1')['ruta'] = 'r'.repeat(300);
    f.nombreFlujo = 'n'.repeat(200);
    const e = reducir(vacio(), { k: 'cargarFlujo', flujo: f as unknown as Flujo });
    expect(e.aviso?.tipo).toBe('ok');
    const almacen = memoria();
    const borrador = crearBorrador(almacen);
    const guardado = borrador.guardar(e.flujo);
    // ya viene recortado: el borrador no tiene nada más que recortar
    expect(guardado).toMatchObject({ ok: true, accion: 'guardado', recortes: [] });
    const cargado = borrador.cargar();
    expect(cargado.ok && cargado.flujo).toEqual(e.flujo);
  });

  it('constructor.reductor.un_flujo_de_afuera_sin_nombre_o_con_un_nombre_que_no_es_texto_se_llama_como_uno_nuevo', () => {
    const f = ejemploCrudo();
    f.nombreFlujo = { a: 1 };
    expect(reducir(vacio(), { k: 'cargarFlujo', flujo: f as unknown as Flujo }).flujo.nombreFlujo).toBe(NOMBRE_FLUJO_INICIAL);
    expect(estadoInicial(f as unknown as Flujo).flujo.nombreFlujo).toBe(NOMBRE_FLUJO_INICIAL);
    delete (f as { nombreFlujo?: unknown }).nombreFlujo;
    expect(reducir(vacio(), { k: 'cargarFlujo', flujo: f as unknown as Flujo }).flujo.nombreFlujo).toBe(NOMBRE_FLUJO_INICIAL);
  });

  it('constructor.reductor.cargar_un_flujo_con_una_clave_pegada_lo_rechaza_y_el_aviso_no_repite_la_clave', () => {
    const clave = `${'s'}k-${'a'.repeat(24)}`;
    const f = ejemploCrudo();
    crudo(f, 'a1')['instrucciones'] = `usa ${clave}`;
    const e0 = conEjemplo();
    const e1 = reducir(e0, { k: 'cargarFlujo', flujo: f as unknown as Flujo });
    expect(e1.flujo).toBe(e0.flujo);
    expect(e1.aviso?.tipo).toBe('mal');
    expect(e1.aviso?.texto).toBe(T.flujoRechazado(['con-clave']).texto);
    expect(e1.aviso?.texto).toContain('clave');
    expect(e1.aviso?.texto).not.toContain(clave);
    expect(estadoInicial(f as unknown as Flujo).flujo.nodes).toEqual([]);
  });

  it('constructor.reductor.un_flujo_enorme_se_rechaza_sin_recorrerlo_y_dice_cuantos_cuadros_admite', () => {
    let lecturasDeElementos = 0;
    const enorme = new Proxy(new Array<unknown>(100_000), {
      get(objetivo, clave, receptor) {
        if (typeof clave === 'string' && /^\d+$/.test(clave)) lecturasDeElementos += 1;
        return Reflect.get(objetivo, clave, receptor) as unknown;
      },
    });
    const flujo = { nodes: enorme, edges: [], nombreFlujo: 'x' } as unknown as Flujo;
    const e0 = conEjemplo();
    const e1 = reducir(e0, { k: 'cargarFlujo', flujo });
    expect(e1.flujo).toBe(e0.flujo);
    expect(e1.aviso?.texto).toBe(T.flujoRechazado(['tope-cuadros']).texto);
    expect(e1.aviso?.texto).toContain(String(TOPE_CUADROS));
    estadoInicial(flujo);
    // ni un solo elemento leído: el tope se aplica antes de mirar nada
    expect(lecturasDeElementos).toBe(0);
    // lo mismo con las conexiones
    const conexiones = new Proxy(new Array<unknown>(100_000), {
      get(objetivo, clave, receptor) {
        if (typeof clave === 'string' && /^\d+$/.test(clave)) lecturasDeElementos += 1;
        return Reflect.get(objetivo, clave, receptor) as unknown;
      },
    });
    reducir(e0, { k: 'cargarFlujo', flujo: { nodes: [], edges: conexiones, nombreFlujo: 'x' } as unknown as Flujo });
    expect(lecturasDeElementos).toBe(0);
  });
});

// ---------------------------------------------------------------- Q3 / H-03 · los topes de largo viven en el reductor

describe('reductor · los topes de largo de lo que se teclea', () => {
  const agenteDe = (e: E, id: string): NodoAgente => {
    const n = e.flujo.nodes.find(x => x.id === id);
    if (!n || n.kind !== 'agent') throw new Error(`no hay agente ${id}`);
    return n;
  };

  it('constructor.reductor.editar_nodo_nunca_deja_un_texto_mas_largo_que_su_tope', () => {
    let e = conEjemplo();
    e = ir(
      e,
      { k: 'editarNodo', id: 'a1', parche: { nombre: 'n'.repeat(500), tarea: 't'.repeat(9000), instrucciones: 'i'.repeat(9000) } },
      { k: 'editarNodo', id: 'a2', parche: { desc: 'd'.repeat(5000) } },
      { k: 'editarNodo', id: 't1', parche: { tipo: 'web', ruta: 'r'.repeat(300) } },
      { k: 'editarNodo', id: 'p1', parche: { nombre: 'p'.repeat(500) } },
      { k: 'renombrarFlujo', nombre: 'f'.repeat(500) },
    );
    const a1 = agenteDe(e, 'a1');
    expect(a1.nombre).toHaveLength(LARGO_NOMBRE_AGENTE);
    expect(a1.tarea).toHaveLength(LARGO_TEXTO_AGENTE);
    expect(a1.instrucciones).toHaveLength(LARGO_TEXTO_AGENTE);
    expect(agenteDe(e, 'a2').desc).toHaveLength(LARGO_DESC_AYUDANTE);
    const t1 = e.flujo.nodes.find(n => n.id === 't1');
    expect(t1?.kind === 'trigger' && t1.ruta).toHaveLength(LARGO_RUTA);
    const p1 = e.flujo.nodes.find(n => n.id === 'p1');
    expect(p1?.kind === 'app' && p1.nombre).toHaveLength(LARGO_NOMBRE_APP);
    expect(e.flujo.nombreFlujo).toHaveLength(LARGO_NOMBRE_FLUJO);
  });

  it('constructor.reductor.lo_que_se_ve_en_el_lienzo_es_lo_que_el_borrador_guarda_y_lo_que_vuelve_al_recargar', () => {
    const e = ir(
      conEjemplo(),
      { k: 'editarNodo', id: 'a1', parche: { tarea: 't'.repeat(9000), instrucciones: 'i'.repeat(9000) } },
      { k: 'editarNodo', id: 'a2', parche: { desc: 'd'.repeat(5000) } },
      { k: 'editarNodo', id: 't1', parche: { tipo: 'web', ruta: 'r'.repeat(300) } },
    );
    const almacen = memoria();
    const borrador = crearBorrador(almacen);
    const guardado = borrador.guardar(e.flujo);
    // el borrador no tiene que recortar nada: el reductor ya lo hizo
    expect(guardado).toMatchObject({ ok: true, accion: 'guardado', recortes: [] });
    const cargado = borrador.cargar();
    expect(cargado.ok && cargado.flujo).toEqual(e.flujo);
    // y el archivo de n8n que se exporta desde la memoria es el mismo que saldría tras recargar
    const recargado = estadoInicial(cargado.ok ? cargado.flujo : undefined);
    expect(construirFlujo(e.flujo, { zona: 'UTC' })).toEqual(construirFlujo(recargado.flujo, { zona: 'UTC' }));
  });

  it('constructor.reductor.al_recortar_un_texto_no_queda_la_mitad_de_un_emoji', () => {
    const emoji = '\u{1F600}';
    const e = ir(
      conEjemplo(),
      { k: 'renombrarFlujo', nombre: `${'x'.repeat(LARGO_NOMBRE_FLUJO - 1)}${emoji}zzz` },
      { k: 'editarNodo', id: 'a1', parche: { nombre: `${'a'.repeat(LARGO_NOMBRE_AGENTE - 1)}${emoji}zzz` } },
      { k: 'editarNodo', id: 'p1', parche: { nombre: `${'p'.repeat(LARGO_NOMBRE_APP - 1)}${emoji}zzz` } },
      { k: 'editarNodo', id: 'a1', parche: { tarea: `${'t'.repeat(LARGO_TEXTO_AGENTE - 1)}${emoji}` } },
      { k: 'editarNodo', id: 't1', parche: { tipo: 'web', ruta: `${'r'.repeat(LARGO_RUTA - 1)}${emoji}` } },
    );
    expect(e.flujo.nombreFlujo).not.toMatch(SUSTITUTO_SUELTO);
    for (const n of e.flujo.nodes) {
      for (const [campo, valor] of Object.entries(n)) {
        if (typeof valor === 'string') expect(valor, `${n.id}.${campo}`).not.toMatch(SUSTITUTO_SUELTO);
      }
    }
    // el archivo exportado no lleva un escape huérfano
    const salida = construirFlujo({ ...e.flujo, nodes: e.flujo.nodes.map(n => (n.kind === 'trigger' ? { ...n, tipo: 'chat' as const } : n)) }, { zona: 'UTC' });
    expect(salida.json).not.toMatch(/\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i);
    // un flujo que llega con un sustituto suelto de más (aunque no pase del tope) también se limpia
    const f = ejemploCrudo();
    crudo(f, 'p1')['nombre'] = 'Hola\ud83d';
    const n = normalizarFlujo(f);
    expect(n.ok && (n.flujo.nodes.find(x => x.id === 'p1') as { nombre: string }).nombre).toBe('Hola');
  });
});

// ---------------------------------------------------------------- H-07 · el contador que llega de afuera

describe('reductor · el contador de ids que llega de afuera', () => {
  it('constructor.reductor.un_contador_enorme_se_ignora_porque_con_el_los_ids_se_repetirian', () => {
    const f = ejemplo();
    expect(estadoInicial(f, Number.MAX_SAFE_INTEGER).siguiente).toBe(20);
    expect(estadoInicial(f, 1e12).siguiente).toBe(20);
    expect(estadoInicial(f, 999_999_999_999).siguiente).toBe(999_999_999_999);
    // y con un contador legítimo muy alto siguen entrando cuadros nuevos, cada uno con su id
    let e = estadoInicial(f, 999_999_999_990);
    const ids = new Set(e.flujo.nodes.map(n => n.id));
    for (let i = 0; i < 4; i += 1) {
      e = ir(e, { k: 'abrirMenu', ancla: 'a2', tipo: 'seq' }, { k: 'crearDesdeMenu', que: 'app', nombreApp: `App ${i}` });
      const nuevo = e.flujo.nodes[e.flujo.nodes.length - 1];
      if (!nuevo) throw new Error('sin cuadro');
      expect(ids.has(nuevo.id), nuevo.id).toBe(false);
      ids.add(nuevo.id);
    }
  });
});

// ---------------------------------------------------------------- H-10 · peticiones que no apuntan a lo que ya no existe

describe('reductor · las peticiones de foco y de «ver» no quedan colgadas', () => {
  it('constructor.reductor.ver_no_apunta_a_un_cuadro_que_se_quito_o_se_deshizo', () => {
    const base = conEjemplo();
    const creado = ir(base, { k: 'abrirMenu', ancla: 'a2', tipo: 'seq' }, { k: 'crearDesdeMenu', que: 'app', nombreApp: 'Slack' });
    const id = creado.flujo.nodes[creado.flujo.nodes.length - 1]?.id ?? '';
    expect(creado.ver?.id).toBe(id);
    // deshacer: el cuadro ya no existe y la petición de traerlo a la vista tampoco
    expect(ir(creado, { k: 'deshacer' }).ver).toBeNull();
    // quitarlo antes de que la pantalla cumpla la petición: igual
    expect(ir(creado, { k: 'quitarNodo', id }).ver).toBeNull();
    // y una petición vigente se conserva
    expect(creado.ver).not.toBeNull();
  });

  it('constructor.reductor.el_foco_no_apunta_a_un_menu_cerrado_ni_a_una_flecha_que_no_esta_elegida', () => {
    const conMenu = ir(conEjemplo(), { k: 'abrirMenu', ancla: 'a2', tipo: 'seq' });
    expect(conMenu.foco?.objetivo).toEqual({ k: 'primeraOpcionMenu' });
    // tocar otro cuadro cierra el menú sin pedir otro foco: la petición vieja ya no vale
    const cerrado = ir(conMenu, { k: 'abrirNodo', id: 'a1' });
    expect(cerrado.menu).toBeNull();
    expect(cerrado.foco).toBeNull();

    const conFlecha = ir(conEjemplo(), { k: 'abrirEnlace', id: 'e1' });
    expect(conFlecha.foco?.objetivo).toEqual({ k: 'opcionUnSentido' });
    const sinFlecha = ir(conFlecha, { k: 'abrirNodo', id: 'a1' });
    expect(sinFlecha.selEdge).toBeNull();
    expect(sinFlecha.foco).toBeNull();

    // un foco que sí tiene a dónde ir se queda
    expect(ir(conEjemplo(), { k: 'abrirMenu', ancla: 'a2', tipo: 'seq' }).foco?.objetivo).toEqual({ k: 'primeraOpcionMenu' });
    expect(ir(conEjemplo(), { k: 'abrirNodo', id: 'a1', teclado: true }).foco?.objetivo).toEqual({ k: 'ajustes' });
  });
});

// ---------------------------------------------------------------- H-06 · el traspaso no lanza

describe('borrador · el traspaso del Asistente no lanza con objetos exóticos', () => {
  it('constructor.borrador.preparar_traspaso_y_traspasar_no_lanzan_con_un_objeto_que_lanza_al_leerlo', () => {
    const traicionero = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('proxy');
        },
        get() {
          throw new Error('proxy');
        },
        has() {
          throw new Error('proxy');
        },
        ownKeys() {
          throw new Error('proxy');
        },
      },
    );
    expect(() => prepararTraspaso(traicionero)).not.toThrow();
    const r = prepararTraspaso(traicionero);
    expect(r.ok).toBe(false);
    const almacen = memoria();
    const borrador = crearBorrador(almacen);
    expect(() => borrador.traspasar(traicionero)).not.toThrow();
    expect(borrador.traspasar(traicionero)).toMatchObject({ ok: false, motivo: 'invalido' });
    expect(almacen.datos.size).toBe(0);
    // lo que nunca lanzó sigue sin lanzar
    expect(() => leerBorrador(traicionero)).not.toThrow();
  });
});

// ---------------------------------------------------------------- H-05 · ningún aviso ni etiqueta repite la clave pegada

describe('reductor · una clave pegada en el nombre de un cuadro no se repite en lo que se dice', () => {
  it('constructor.reductor.ningun_aviso_error_ni_etiqueta_repite_la_clave_pegada_en_el_nombre_de_un_cuadro', () => {
    const clave = `${'s'}k-${'a'.repeat(24)}`;
    // el ejemplo con una app cuyo nombre es una clave, y un agente que también la trae
    let e = ir(
      conEjemplo(),
      { k: 'editarNodo', id: 'p1', parche: { nombre: clave } },
      { k: 'editarNodo', id: 'a2', parche: { nombre: `Revisor ${clave}` } },
    );
    // el campo sigue mostrando lo que la persona escribió
    expect(e.flujo.nodes.find(n => n.id === 'p1')).toMatchObject({ nombre: clave });
    const dicho: string[] = [];
    const recoge = (x: E): void => void (x.aviso && dicho.push(x.aviso.texto));

    // lo que dice el exportador
    const revision = revisarFlujo(e.flujo);
    expect(revision.errores.length).toBeGreaterThan(0);
    dicho.push(...revision.errores, ...revision.avisos);
    const resumen = resumenFlujo(e);
    dicho.push(resumen.textoSinJson, resumen.primerError ?? '', resumen.resumenOk);
    const descarga = construirFlujo(e.flujo, { zona: 'UTC' });
    dicho.push(...descarga.errores, ...descarga.avisos);

    // lo que dicen los avisos de las acciones
    for (const accion of [
      { k: 'abrirMenu', ancla: 'p1', tipo: 'seq' },
      { k: 'abrirMenu', ancla: 'a1', tipo: 'tool' },
      { k: 'iniciarConexion', ancla: 'p1', rol: 'origen', tipo: 'seq' },
      { k: 'iniciarConexion', ancla: 'a2', rol: 'destino', tipo: 'seq' },
      { k: 'abrirEnlace', id: 'e3' },
      { k: 'abrirEnlace', id: 'e2' },
      { k: 'cambiarTipoEnlace', id: 'e2', tipo: 'tool' },
      { k: 'quitarEnlace', id: 'e3' },
      { k: 'quitarNodo', id: 'a2' },
      { k: 'quitarNodo', id: 'p1' },
    ] satisfies A[]) {
      recoge(reducir(e, accion));
      e = reducir(e, { k: 'cerrarTodo' });
    }

    // y lo que lee un lector de pantalla: títulos, etiquetas de las flechas y panel de Ajustes
    for (const n of vistaNodos(e)) dicho.push(n.titulo, n.tipo, n.detalle, ...Object.values(n).filter((v): v is string => typeof v === 'string'));
    for (const f of vistaFlechas(e)) dicho.push(f.etiqueta);
    const ajustes = vistaAjustes({ ...e, sel: 'a2' });
    if (ajustes) dicho.push(JSON.stringify(ajustes.conexiones));

    expect(dicho.length).toBeGreaterThan(10);
    for (const texto of dicho) expect(texto, texto.slice(0, 80)).not.toContain(clave);
    for (const texto of dicho) expect(texto, texto.slice(0, 80)).not.toMatch(/a{20}/);
    // pero sí se dice QUÉ pasa
    expect(revision.errores.join(' ')).toContain('Parece que pegaste una clave');
    expect(revision.errores.join(' ')).toContain('App con clave pegada');
  });
});
