// Regresiones de la revisión de la interfaz que viven en el reductor y en los selectores: el foco que no se pierde (cerrar el menú
// volviendo a pulsar el «+», quitar una herramienta, deshacer), «Poner un cuadro en medio» que no suelta la flecha, mover con el
// teclado que pide traer el cuadro a la vista y el texto que no deja pasar caracteres de control. «Deshacer» sin tirar la pila
// tiene sus pruebas en reductor.deshacer.test.ts.
//
// Cada `it` lleva su nombre literal `constructor.<tema>.…` (registro anti-pérdida: los `it.each` no cuentan).

import { describe, expect, it } from 'vitest';

import { ejemplo } from './ejemplos';
import { estadoInicial, reducir } from './reductor';
import { panelDeAjustes, vistaEnlace, vistaNodos } from './selectores';
import { recortar } from './texto';
import type { AccionConstructor as A, EstadoConstructor as E, Foco, NodoAgente } from './tipos';

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
/** El ejemplo con `a1` elegido: t1 → a1 → a2, con p1 (Google Sheets) colgada de a1 y p2 (Slack) colgada de a2. */
const conEjemplo = (): E => congelar({ ...estadoInicial(ejemplo()), sel: 'a1' });
const foco = (e: E): Foco | null => e.foco?.objetivo ?? null;

// ================================================================ cerrar el menú volviendo a pulsar el «+»

describe('foco · el menú del «+»', () => {
  it('constructor.foco.volver_a_pulsar_el_mas_que_abrio_el_menu_lo_cierra_y_devuelve_el_foco_a_ese_mas', () => {
    // sin esto, en un navegador que no enfoca los botones al clic (Safari, Firefox en macOS) el foco cae a <body>
    const derecha = ir(conEjemplo(), { k: 'abrirMenu', ancla: 'a2', tipo: 'seq' });
    expect(derecha.menu).not.toBeNull();
    const cerrada = ir(derecha, { k: 'abrirMenu', ancla: 'a2', tipo: 'seq' });
    expect(cerrada.menu).toBeNull();
    expect(foco(cerrada)).toEqual({ k: 'mas', clave: 'der-a2' });
    expect(cerrada.foco?.n).toBeGreaterThan(derecha.foco?.n ?? 0);
    // el de la patita
    const patita = ir(conEjemplo(), { k: 'abrirMenu', ancla: 'a1', tipo: 'tool' }, { k: 'abrirMenu', ancla: 'a1', tipo: 'tool' });
    expect(patita.menu).toBeNull();
    expect(foco(patita)).toEqual({ k: 'mas', clave: 'tool-a1' });
    // y el de «Poner un cuadro en medio» (adonde vuelve el foco es el botón de la flecha)
    const enMedio: A = { k: 'abrirMenu', ancla: 'a1', tipo: 'seq', insertarEn: 'e2' };
    const medio = ir(conEjemplo(), { k: 'abrirEnlace', id: 'e2' }, enMedio, enMedio);
    expect(medio.menu).toBeNull();
    expect(foco(medio)).toEqual({ k: 'mas', clave: 'medio' });
  });
});

// ================================================================ «Poner un cuadro en medio»

describe('foco · poner un cuadro en medio', () => {
  const enMedio: A = { k: 'abrirMenu', ancla: 'a1', tipo: 'seq', insertarEn: 'e2' };

  it('constructor.foco.al_abrir_el_menu_de_poner_en_medio_la_flecha_sigue_elegida_y_su_panel_sigue_en_pantalla', () => {
    const e = ir(conEjemplo(), { k: 'abrirEnlace', id: 'e2' }, enMedio);
    expect(e.menu).toMatchObject({ ancla: 'a1', insertarEn: 'e2' });
    // sin esto el panel pasaba a «Ajustes del cuadro» y el botón «Poner un cuadro en medio» (donde vuelve el foco) dejaba de existir
    expect(e.selEdge).toBe('e2');
    expect(e.sel).toBeNull();
    expect(panelDeAjustes(e)).toBe('enlace');
    expect(vistaEnlace(e)).toMatchObject({ id: 'e2', puedeMedio: true, medioAbierto: true });
    // cerrado, el botón dice que no hay menú abierto
    expect(vistaEnlace(ir(e, { k: 'cerrarMenu' }))).toMatchObject({ id: 'e2', medioAbierto: false });
  });

  it('constructor.foco.cerrar_el_menu_de_poner_en_medio_pide_el_foco_del_boton_y_ese_boton_sigue_existiendo', () => {
    const abierto = ir(conEjemplo(), { k: 'abrirEnlace', id: 'e2' }, enMedio);
    const cerrado = ir(abierto, { k: 'cerrarMenu' });
    expect(foco(cerrado)).toEqual({ k: 'mas', clave: 'medio' });
    // el panel de la flecha (con su botón «Poner un cuadro en medio») sigue ahí para recibirlo
    expect(panelDeAjustes(cerrado)).toBe('enlace');
    expect(vistaEnlace(cerrado)?.puedeMedio).toBe(true);
    // Esc (cerrarTodo) cierra el menú y no suelta la flecha tampoco
    const esc = ir(abierto, { k: 'cerrarTodo' });
    expect(esc.menu).toBeNull();
    expect(esc.selEdge).toBe('e2');
  });

  it('constructor.foco.crear_el_cuadro_en_medio_elige_el_cuadro_nuevo_y_suelta_la_flecha', () => {
    const e = ir(conEjemplo(), { k: 'abrirEnlace', id: 'e2' }, enMedio, { k: 'pasoMenu', paso: 'app' }, { k: 'crearDesdeMenu', que: 'app', nombreApp: 'Gmail' });
    expect(e.menu).toBeNull();
    expect(e.selEdge).toBeNull();
    expect(e.sel).not.toBeNull();
    expect(e.flujo.nodes.find(n => n.id === e.sel)).toMatchObject({ kind: 'app', nombre: 'Gmail' });
    expect(foco(e)).toEqual({ k: 'nodo', id: e.sel });
  });

  it('constructor.foco.si_la_flecha_de_en_medio_deja_de_existir_con_el_menu_abierto_el_menu_se_cierra_y_no_queda_nada_fantasma', () => {
    const abierto = ir(conEjemplo(), { k: 'abrirEnlace', id: 'e2' }, enMedio);
    // quitar la conexión desde otro lado (el reductor acepta la acción con el menú abierto)
    const sinFlecha = ir(abierto, { k: 'quitarEnlace', id: 'e2' });
    expect(sinFlecha.menu).toBeNull();
    expect(sinFlecha.selEdge).toBeNull();
    expect(sinFlecha.flujo.edges.some(x => x.id === 'e2')).toBe(false);
  });
});

// ================================================================ a dónde va el foco al quitar y al deshacer

describe('foco · quitar y deshacer', () => {
  it('constructor.foco.quitar_una_herramienta_manda_el_foco_a_su_agente_y_no_al_primer_cuadro_del_lienzo', () => {
    // p2 (Slack) cuelga de a2 (Revisor)
    const e = ir(conEjemplo(), { k: 'quitarNodo', id: 'p2' });
    expect(foco(e)).toEqual({ k: 'nodo', id: 'a2' });
    // p1 (Google Sheets) cuelga de a1
    expect(foco(ir(conEjemplo(), { k: 'quitarNodo', id: 'p1' }))).toEqual({ k: 'nodo', id: 'a1' });
  });

  it('constructor.foco.quitar_un_agente_unido_por_ida_y_vuelta_manda_el_foco_a_su_agente_principal', () => {
    // a2 pasa a conversar con a1 (la conexión e2 se vuelve «ida y vuelta»): ahora a2 es el ayudante de a1
    const conversan = ir(conEjemplo(), { k: 'cambiarTipoEnlace', id: 'e2', tipo: 'tool' });
    expect(conversan.flujo.edges.find(x => x.id === 'e2')?.tipo).toBe('tool');
    const e = ir(conversan, { k: 'quitarNodo', id: 'a2' });
    expect(foco(e)).toEqual({ k: 'nodo', id: 'a1' });
  });

  it('constructor.foco.quitar_un_cuadro_en_una_cadena_sigue_mandando_el_foco_al_que_venia_antes', () => {
    // el comportamiento de siempre no cambia: a2 recibía de a1
    expect(foco(ir(conEjemplo(), { k: 'quitarNodo', id: 'a2' }))).toEqual({ k: 'nodo', id: 'a1' });
    // y el primer cuadro (nadie lo precede ni cuelga de nadie) cae al primero que quede
    expect(foco(ir(conEjemplo(), { k: 'quitarNodo', id: 't1' }))).toEqual({ k: 'primerNodo' });
  });

  it('constructor.foco.deshacer_manda_el_foco_al_cuadro_que_volvio_y_no_al_que_estaba_elegido', () => {
    // se quita p2 con a1 elegido: al deshacer el foco va a p2 (lo restaurado), aunque la selección vuelva a ser a1
    const quitado = ir(conEjemplo(), { k: 'quitarNodo', id: 'p2' });
    const vuelto = ir(quitado, { k: 'deshacer' });
    expect(vuelto.flujo.nodes.some(n => n.id === 'p2')).toBe(true);
    expect(vuelto.sel).toBe('a1');
    expect(foco(vuelto)).toEqual({ k: 'nodo', id: 'p2' });
  });

  it('constructor.foco.deshacer_algo_que_no_trajo_cuadros_manda_el_foco_al_cuadro_elegido_o_al_primero', () => {
    // quitar una conexión no quita cuadros: no hay ningún cuadro «restaurado», se queda lo de siempre
    const sinConexion = ir(conEjemplo(), { k: 'quitarEnlace', id: 'e2' });
    expect(foco(ir(sinConexion, { k: 'deshacer' }))).toEqual({ k: 'nodo', id: 'a1' });
    // limpiar trae TODOS los cuadros: el foco va al elegido que tenían (a1)
    const limpio = ir(conEjemplo(), { k: 'limpiar' });
    expect(foco(ir(limpio, { k: 'deshacer' }))).toEqual({ k: 'nodo', id: 'a1' });
  });
});

// ================================================================ mover con el teclado trae el cuadro a la vista

describe('mover con el teclado · a la vista', () => {
  it('constructor.teclado.mover_un_cuadro_con_las_flechas_pide_traerlo_a_la_vista_y_el_arrastre_no', () => {
    const e0 = conEjemplo();
    const e1 = ir(e0, { k: 'moverConTeclado', id: 'a1', direccion: 'derecha', grande: true });
    expect(e1.flujo.nodes.find(n => n.id === 'a1')?.x).toBeGreaterThan(e0.flujo.nodes.find(n => n.id === 'a1')?.x ?? 0);
    expect(e1.ver).toEqual({ id: 'a1', n: e1.eventos });
    expect(e1.eventos).toBeGreaterThan(e0.eventos);
    // cada pulsación pide de nuevo (el efecto de la pantalla apaga la petición entre una y otra)
    const e2 = ir(ir(e1, { k: 'limpiarPeticiones' }), { k: 'moverConTeclado', id: 'a1', direccion: 'abajo' });
    expect(e2.ver).toEqual({ id: 'a1', n: e2.eventos });
    // el arrastre con el puntero no pide nada: el cuadro ya está bajo el dedo
    const arrastre = ir(e0, { k: 'moverNodo', id: 'a1', x: 600, y: 300 });
    expect(arrastre.ver).toBeNull();
    // y contra el borde, donde no se mueve nada, tampoco
    const borde = ir(ir(e0, { k: 'moverNodo', id: 'p1', x: 0, y: 0 }), { k: 'moverConTeclado', id: 'p1', direccion: 'izquierda' });
    expect(borde.ver).toBeNull();
  });
});

// ================================================================ el nombre accesible del cuadro

describe('etiquetas · el nombre del cuadro contiene lo que se ve', () => {
  const vista = (id: string) => vistaNodos(conEjemplo()).find(v => v.id === id)!;

  it('constructor.etiquetas.el_nombre_accesible_del_cuadro_contiene_su_tipo_su_titulo_y_su_detalle_en_el_orden_en_que_se_ven', () => {
    for (const id of ['t1', 'a1', 'a2', 'p1', 'p2']) {
      const v = vista(id);
      // WCAG 2.5.3: quien dicta «clic OpenAI GPT» tiene que poder elegir el cuadro; el nombre trae las tres líneas, en el mismo orden
      expect(v.etiqueta, id).toBe(`${v.tipoCorto}: ${v.titulo}. ${v.detalle}`);
    }
    expect(vista('a1').etiqueta).toBe('Agente de IA: Atención a clientes. OpenAI (GPT)');
    expect(vista('p1').etiqueta).toBe('App · herramienta: Google Sheets. Lista para n8n');
    expect(vista('t1').etiqueta).toBe('Disparador: Chat. Mensaje en el chat');
  });

  it('constructor.etiquetas.la_relacion_con_el_agente_viaja_aparte_como_descripcion_y_solo_cuando_el_cuadro_cuelga_de_otro', () => {
    expect(vista('p1').rol).toBe('App · herramienta de «Atención a clientes»');
    expect(vista('t1').rol).toBeNull();
    expect(vista('a1').rol).toBeNull();
    expect(vista('a2').rol).toBeNull();
    const conversan = ir(conEjemplo(), { k: 'cambiarTipoEnlace', id: 'e2', tipo: 'tool' });
    const ayudante = vistaNodos(conversan).find(v => v.id === 'a2')!;
    expect(ayudante.rol).toBe('Agente de IA que conversa con «Atención a clientes»');
    expect(ayudante.etiqueta).toMatch(/^Agente · conversa: Revisor\. \S/);
  });
});

// ================================================================ el texto que se teclea

describe('texto · caracteres que no son texto', () => {
  const NUL = String.fromCharCode(0);
  const ESC = String.fromCharCode(27);

  it('constructor.texto.recortar_quita_los_caracteres_de_control_pero_deja_el_tabulador_y_los_saltos_de_linea', () => {
    expect(recortar(`a${NUL}b`, 10)).toBe('ab');
    expect(recortar(`a${ESC}[31mb`, 10)).toBe('a[31mb');
    expect(recortar(`uno\ndos\ttres\r\ncuatro`, 100)).toBe(`uno\ndos\ttres\r\ncuatro`);
    expect(recortar(`x\u0007y\u007fz\u0085w`, 10)).toBe('xyzw');
    // el corte cuenta lo que queda: los caracteres que se quitan no gastan el tope
    expect(recortar(`${NUL}${NUL}abcd`, 3)).toBe('abc');
  });

  it('constructor.texto.recortar_quita_los_controles_de_direccion_que_invierten_el_resto_de_la_linea_y_los_sustitutos_sueltos', () => {
    // U+202E (forzar derecha a izquierda) invertía «no trae un conector listo…» en avisos y listas
    expect(recortar('\u202eWWW', 10)).toBe('WWW');
    expect(recortar('a\u202ab\u202cc\u2066d\u2069e', 10)).toBe('abcde');
    // los emoji y el texto de derecha a izquierda de verdad (sin controles) pasan tal cual
    expect(recortar('hola \u{1F600} mundo', 50)).toBe('hola \u{1F600} mundo');
    expect(recortar('مرحبا', 50)).toBe('مرحبا');
    // un sustituto bajo suelto (sin su alto) tampoco es texto
    expect(recortar('a\udc00b', 10)).toBe('ab');
    expect(recortar('a\ud83d', 10)).toBe('a');
  });

  it('constructor.texto.lo_que_se_teclea_en_un_nombre_no_deja_pasar_un_caracter_de_control_ni_al_estado_ni_al_archivo_de_n8n', () => {
    const e = ir(conEjemplo(), { k: 'editarNodo', id: 'a1', parche: { nombre: `a${NUL}b\u202ec` } }, { k: 'renombrarFlujo', nombre: `Mi${NUL} flujo` });
    expect((e.flujo.nodes.find(n => n.id === 'a1') as NodoAgente).nombre).toBe('abc');
    expect(e.flujo.nombreFlujo).toBe('Mi flujo');
  });
});
