// Pruebas de PROPIEDADES del reductor del Constructor: el puerto del fuzz del mockup (revision/fuzz/fuzz.cjs) sobre
// el reductor y los selectores de verdad. Secuencias de acciones al azar con SEMILLA fija; tras CADA acción se
// comprueba que el estado sigue sano (grafo, topes, punteros, contadores, pila de Deshacer), que lo que se pinta
// (selectores) y lo que se exporta (construirFlujo / revisarFlujo) dicen lo mismo que el grafo, que Deshacer
// restaura exactamente la instantánea, que una acción a un id que no existe no cambia nada y que cada acción
// cambia SOLO lo que dice que cambia. Los ojos de todo eso están en `prueba/` (ver el encabezado de cada archivo).
//
//   · `prueba/semilla.ts`   el azar con semilla.
//   · `prueba/gestos.ts`    qué hace la persona (`gestoUI`: solo lo que los selectores ofrecen) y qué hace un programa
//                           descuidado (`gestoAPI`: ids que ya no existen, valores de tipo equivocado, flujos rotos).
//   · `prueba/oraculos.ts`  qué se comprueba tras cada acción.
//   · `prueba/campana.ts`   la sesión, las campañas y el minimizador de secuencias.
//
// Cinco campañas (`ui`, `api`, `mixto`, `grande` —sesgada a crecer hasta los topes—, `claves` pegadas por error y `larga`
// —sin ediciones, para llenar la pila de Deshacer—), con tres semillas y, de vez en cuando, la página que se recarga.
// Si algo falla, el mensaje trae la semilla, la campaña, el número de secuencia y la secuencia MÍNIMA de acciones que lo
// repite. Para repetir o ampliar:
//
//   FUZZ_SEMILLA=777 FUZZ_N=30 npx vitest run src/pantallas/constructor/modelo/reductor.propiedades.test.ts
//   FUZZ_N=600 npx vitest run …    (una pasada larga: miles de secuencias; tarda minutos)
//
// Lo que NO es un invariante duro (informe 04 §8.3): que una acción automática deje un cuadro a la izquierda de su
// origen o una herramienta que no cuelga debajo cuando no cabe, o que un trazo salga del lienzo. Eso se CUENTA
// (`suaves`) y se prueba aparte, con escenarios; no se exige. Sí se exige lo que `huecoParaInsertar` arregló: «Poner un
// cuadro en medio» jamás deja una flecha hacia atrás (si no cabe, avisa y no crea nada).
//
// Cada `it` lleva su nombre literal `constructor.propiedades.…` (registro anti-pérdida).

import { beforeAll, describe, expect, it } from 'vitest';

import {
  congelar,
  correrCampanas,
  correrSecuencia,
  DEPS_REALES,
  describir,
  distintos,
  minimizar,
  reproducir,
  Sesion,
  type Campana,
  type Hallazgo,
  type ResultadoCampanas,
} from './prueba/campana';
import { ejemplo } from './ejemplos';
import { construirFlujo } from './exportar';
import { buscarSuciedad, revisarEstado, revisarExportacion, revisarVistas, type Dependencias, type Grupo } from './prueba/oraculos';
import { estadoInicial, reducir } from './reductor';
import type { AccionConstructor as A, EstadoConstructor as E, Flujo, Nodo, NodoAgente, NodoApp, NodoDisparador } from './tipos';

// ---------------------------------------------------------------- la corrida compartida

/** Cuántas secuencias por campaña y por semilla (las campañas `grande` y `claves` llevan una fracción). */
const N_POR_DEFECTO = 20;
const N = Math.max(1, Math.floor(Number(process.env.FUZZ_N ?? N_POR_DEFECTO)) || N_POR_DEFECTO);
const SEMILLAS: readonly number[] = process.env.FUZZ_SEMILLA ? [Number(process.env.FUZZ_SEMILLA)] : [20261020, 777, 31337];
/** Con la corrida de fábrica se exigen umbrales de cobertura; con una más corta (FUZZ_N chico) no. */
const CORRIDA_COMPLETA = N >= N_POR_DEFECTO && SEMILLAS.length >= 3;

function campanas(n: number): Campana[] {
  return [
    { nombre: 'ui', modo: 'ui', n, largo: [5, 60] },
    { nombre: 'api', modo: 'api', n, largo: [5, 60] },
    { nombre: 'mixto', modo: 'mixto', n, largo: [5, 60] },
    { nombre: 'grande', modo: 'grande', n: Math.max(2, Math.ceil(n / 4)), largo: [60, 150] },
    { nombre: 'claves', modo: 'mixto', conClaves: true, n: Math.max(2, Math.ceil(n / 2)), largo: [10, 50] },
    // sesiones largas sin mover ni teclear: la pila de Deshacer llega a sus 20 instantáneas
    { nombre: 'larga', modo: 'larga', n: Math.max(2, Math.ceil(n / 6)), largo: [150, 300] },
  ];
}

let corrida: ResultadoCampanas;

beforeAll(() => {
  corrida = correrCampanas(SEMILLAS, campanas(N));
}, 240_000);

/** No hubo ninguna violación de esas familias (o de esos códigos): si las hubo, el mensaje trae la secuencia mínima que la repite. */
function sinViolaciones(grupos: readonly Grupo[], codigos?: (codigo: string) => boolean): void {
  const malos = corrida.hallazgos.filter(h => grupos.includes(h.grupo) && (codigos === undefined || codigos(h.codigo)));
  expect(distintos(malos).map(h => describir(h))).toEqual([]);
}

const esDeConexiones = (c: string) => /^flujo-(conexion|desalineado|tipo|nombres-repetidos|invariante)/.test(c);

// ---------------------------------------------------------------- las propiedades sobre secuencias al azar

describe('propiedades · secuencias de acciones al azar con semilla', () => {
  it('constructor.propiedades.ninguna_secuencia_al_azar_rompe_un_invariante_del_grafo_ni_un_tope', () => {
    sinViolaciones(['grafo']);
  });

  it('constructor.propiedades.nada_apunta_a_algo_que_no_existe_y_el_menu_y_la_conexion_en_curso_nunca_conviven', () => {
    sinViolaciones(['punteros']);
  });

  it('constructor.propiedades.los_contadores_nunca_bajan_ningun_id_se_repite_y_la_pila_no_pasa_de_20', () => {
    sinViolaciones(['estado']);
    sinViolaciones(['transicion'], c =>
      /^(contador|eventos|scroll|id-nuevo|id-repetido|pila|historial|cambio-estructural|instantanea-con|edicion-|accion-de-interfaz)/.test(c),
    );
  });

  it('constructor.propiedades.construir_y_revisar_el_flujo_no_lanzan_el_json_es_estable_y_nunca_lleva_una_clave', () => {
    sinViolaciones(['exportacion'], c => !esDeConexiones(c));
  });

  it('constructor.propiedades.las_conexiones_del_archivo_son_exactamente_las_que_dibuja_el_lienzo', () => {
    sinViolaciones(['exportacion'], esDeConexiones);
  });

  it('constructor.propiedades.deshacer_restaura_exactamente_la_instantanea_en_cualquier_momento', () => {
    sinViolaciones(['deshacer']);
    sinViolaciones(['transicion'], c => /^(deshacer|instantanea)/.test(c));
  });

  it('constructor.propiedades.los_selectores_nunca_devuelven_nan_ni_undefined_y_dicen_lo_mismo_que_el_grafo', () => {
    sinViolaciones(['selectores']);
  });

  it('constructor.propiedades.una_accion_a_un_id_que_no_existe_deja_el_estado_exactamente_igual', () => {
    sinViolaciones(['id-inexistente']);
  });

  it('constructor.propiedades.cada_accion_cambia_solo_lo_que_dice_que_cambia', () => {
    sinViolaciones(['transicion']);
  });

  it('constructor.propiedades.lo_que_la_interfaz_ofrece_el_reductor_lo_cumple_y_lo_que_marca_imposible_lo_rechaza', () => {
    sinViolaciones(['acuerdo']);
  });

  it('constructor.propiedades.puede_enlazar_nunca_acepta_una_conexion_que_rompa_un_invariante', () => {
    sinViolaciones(['diferencial']);
  });

  it('constructor.propiedades.todo_estado_alcanzable_se_guarda_como_borrador_y_se_recupera_igual', () => {
    sinViolaciones(['borrador']);
  });

  it('constructor.propiedades.ninguna_accion_lanza_ni_modifica_lo_que_recibe', () => {
    // cada estado y cada acción se congelan a fondo: modificar algo lanza, y eso es una violación
    sinViolaciones(['accion']);
  });

  it('constructor.propiedades.la_corrida_alcanzo_los_casos_dificiles', () => {
    expect(corrida.secuencias).toBeGreaterThanOrEqual(SEMILLAS.length * campanas(N).reduce((suma, c) => suma + c.n, 0));
    expect(corrida.pasos).toBeGreaterThan(corrida.secuencias * 5);
    if (!CORRIDA_COMPLETA) return;
    const c = (k: string) => corrida.cobertura.get(k) ?? 0;
    // lo que la corrida debe haber hecho de verdad para que «cero violaciones» no sea «cero cobertura»
    const minimos: [string, number][] = [
      ['Deshacer real', 20],
      ['Deshacer desde un aviso viejo (rechazado)', 1],
      ['poner en medio con éxito', 3],
      ['cambiarTipoEnlace con cambio real (seq → tool)', 3],
      ['cambiarTipoEnlace con cambio real (tool → seq)', 3],
      ['conectar con uno que ya está: éxito', 3],
      ['conectar con uno que ya está: rechazado', 20],
      ['quitar uniendo lo de antes con lo de después', 2],
      ['quitar un agente con herramientas', 1],
      ['quitar un trigger', 5],
      ['quitarEnlace con éxito', 10],
      ['crearDesdeMenu creó un agente', 20],
      ['crearDesdeMenu creó una app', 20],
      ['herramienta creada por la patita', 5],
      ['hay un ayudante (una IA que conversa con otra)', 5],
      ['herramientas anidadas (el padre también cuelga de alguien)', 1],
      ['abanico de pasos (un cuadro con 2 o más siguientes)', 20],
      ['confluencia (un cuadro con 2 o más anteriores)', 5],
      ['flujo sin disparador (se quitó con la ×)', 5],
      ['estado con 4 agentes (tope)', 1],
      ['estado con 8 apps (tope)', 1],
      ['estado con 10 o más cuadros', 10],
      ['cargarFlujo aceptado', 3],
      ['cargarFlujo rechazado', 3],
      ['modo conectando abierto', 20],
      ['menú de poner en medio abierto', 5],
      ['una edición dejó la pila intacta', 10],
      ['Deshacer conservó lo movido o escrito después', 3],
      ['pila llena (20)', 1],
      ['recargar la página (el estado nace del borrador)', 20],
      ['exportación sin errores', 100],
      ['exportación bloqueada por errores', 100],
      ['borrador: ida y vuelta', 100],
      ['borrador: se negó a guardar una clave', 3],
      ['diferencial: pares evaluados', 1000],
      ['diferencial: puedeEnlazar dijo sí', 100],
      ['diferencial: puedeEnlazar dijo no', 100],
    ];
    const faltan = minimos.filter(([k, min]) => c(k) < min).map(([k, min]) => `${k}: ${c(k)} y se pedían ${min}`);
    expect(faltan).toEqual([]);
    // todas las acciones del reductor se probaron
    const acciones = [...corrida.cobertura.keys()].filter(k => k.startsWith('acción: ')).map(k => k.slice(8));
    expect(acciones.length).toBe(24);
  });
});

// ---------------------------------------------------------------- lo que NO es un invariante duro

/** Un flujo de tres cuadros con lo que haga falta, para armar escenarios a mano. */
function flujoDe(nodes: Nodo[], edges: Flujo['edges']): Flujo {
  return { nodes, edges, nombreFlujo: 'Escenario' };
}
const disparador = (x = 8, y = 180): NodoDisparador => ({ id: 't1', kind: 'trigger', x, y, tipo: 'chat', frec: 'dia', ruta: 'mi-flujo', app: 'gmail' });
const agente = (id: string, x: number, y: number): NodoAgente => ({ id, kind: 'agent', x, y, nombre: id, ia: 'openai', tarea: '', instrucciones: '', desc: 'Ayuda.' });
const app = (id: string, x: number, y: number): NodoApp => ({ id, kind: 'app', x, y, nombre: 'Notion' });

/** Corre las acciones sobre un flujo y dice, por acción, qué violaciones salieron (debe ser ninguna) y qué se contó como «suave». */
function escenario(f: Flujo, acciones: A[]): { violaciones: string[]; suaves: Map<string, number>; sesion: Sesion } {
  const sesion = new Sesion({ inicial: estadoInicial(f), completo: true });
  const violaciones = acciones.flatMap(a => sesion.aplicar(a).map(v => `${v.codigo}: ${v.detalle}`));
  return { violaciones, suaves: sesion.ctx.suaves, sesion };
}

describe('propiedades · la colocación hacia adelante es un objetivo, no un invariante duro', () => {
  it('constructor.propiedades.la_colocacion_hacia_adelante_es_un_objetivo_y_no_un_invariante_duro', () => {
    // 1 · conectar con un cuadro que quedó a la IZQUIERDA: el reductor lo acepta (el grafo es válido) y solo se cuenta
    const paso = escenario(flujoDe([disparador(), agente('a1', 312, 180), app('p3', 8, 600)], [{ id: 'e1', de: 't1', a: 'a1', tipo: 'seq' }]), [
      { k: 'iniciarConexion', ancla: 'a1', rol: 'origen', tipo: 'seq' },
      { k: 'intentarConexion', id: 'p3' },
    ]);
    expect(paso.violaciones).toEqual([]);
    expect(paso.sesion.estado.flujo.edges.some(x => x.de === 'a1' && x.a === 'p3' && x.tipo === 'seq')).toBe(true);
    expect(paso.suaves.get('al conectar, paso que no queda a la derecha de su origen')).toBe(1);

    // 2 · una IA que conversa y queda a la izquierda de su agente (conectando desde la IA que va a colgar)
    const ayudante = escenario(flujoDe([disparador(), agente('a1', 312, 180), agente('a3', 8, 600)], [{ id: 'e1', de: 't1', a: 'a1', tipo: 'seq' }]), [
      { k: 'iniciarConexion', ancla: 'a3', rol: 'destino', tipo: 'tool' },
      { k: 'intentarConexion', id: 'a1' },
    ]);
    expect(ayudante.violaciones).toEqual([]);
    expect(ayudante.sesion.estado.flujo.edges.some(x => x.de === 'a1' && x.a === 'a3' && x.tipo === 'tool')).toBe(true);
    expect(ayudante.suaves.get('al conectar, ayudante que no queda a la derecha de su agente')).toBe(1);

    // 3 · una herramienta que está ARRIBA de su agente: la curva sale por arriba, el grafo es válido
    const encima = escenario(flujoDe([disparador(), agente('a1', 312, 380), app('p3', 312, 8)], [{ id: 'e1', de: 't1', a: 'a1', tipo: 'seq' }]), [
      { k: 'iniciarConexion', ancla: 'a1', rol: 'origen', tipo: 'tool' },
      { k: 'intentarConexion', id: 'p3' },
    ]);
    expect(encima.violaciones).toEqual([]);
    expect(encima.suaves.get('al conectar, herramienta que no cuelga debajo de su agente')).toBe(1);

    // 4 · hasta una acción AUTOMÁTICA lo deja así cuando no hay lugar: la IA principal arrimada al borde derecho del
    // lienzo no tiene dónde poner a su ayudante a la derecha (los minimizados del fuzz del mockup: el borde manda)
    const borde = escenario(flujoDe([disparador(), agente('a1', 2400, 180), agente('a2', 2400, 400)], [
      { id: 'e1', de: 't1', a: 'a1', tipo: 'seq' },
      { id: 'e2', de: 'a1', a: 'a2', tipo: 'seq' },
    ]), [{ k: 'cambiarTipoEnlace', id: 'e2', tipo: 'tool' }]);
    expect(borde.violaciones).toEqual([]);
    expect(borde.suaves.get('ayudante que no queda a la derecha de su agente')).toBe(1);

    // ninguno de esos códigos del fuzz del mockup es una violación de la corrida: no existen como código
    const blandos = ['ayudante-no-a-la-derecha', 'paso-no-a-la-derecha', 'conectar-paso-no-a-la-derecha', 'herramienta-no-debajo', 'trazo-fuera-del-lienzo'];
    expect(corrida.hallazgos.filter(h => blandos.includes(h.codigo))).toEqual([]);
    // y lo que SÍ se exige (poner en medio sin dejar una flecha hacia atrás) no tiene ninguna excepción
    expect(corrida.hallazgos.filter(h => h.codigo === 'insertar-deja-una-flecha-hacia-atras')).toEqual([]);
  });
});

// ---------------------------------------------------------------- escenarios dirigidos (lo que el azar casi no alcanza)

describe('propiedades · escenarios dirigidos de los que el azar casi no se acerca', () => {
  it('constructor.propiedades.un_agente_y_su_ia_que_conversa_con_el_mismo_siguiente_dan_una_sola_conexion_main', () => {
    // a1 conversa con a2, y los dos van al mismo p1: para n8n solo el agente principal da la respuesta, así que es UNA conexión
    const f = flujoDe(
      [disparador(), agente('a1', 312, 180), agente('a2', 616, 180), app('p1', 920, 180)],
      [
        { id: 'e1', de: 't1', a: 'a1', tipo: 'seq' },
        { id: 'e2', de: 'a1', a: 'a2', tipo: 'tool' },
        { id: 'e3', de: 'a1', a: 'p1', tipo: 'seq' },
        { id: 'e4', de: 'a2', a: 'p1', tipo: 'seq' },
      ],
    );
    const { violaciones, sesion } = escenario(f, [{ k: 'abrirNodo', id: 'a1' }]);
    expect(violaciones).toEqual([]);
    const r = construirFlujo(sesion.estado.flujo);
    expect(r.errores).toEqual([]);
    expect(r.flujo?.connections.a1?.main?.[0]).toEqual([{ node: 'Notion', type: 'main', index: 0 }]);
  });

  it('constructor.propiedades.los_nombres_y_textos_hostiles_nunca_se_vuelven_expresiones_de_n8n', () => {
    // nombres con comillas, barras y llaves en un agente que va seguido de DOS apps (la segunda cita al agente por su nombre dentro de
    // una expresión), instrucciones que empiezan con «=» y traen llaves, y una IA que conversa con «para qué sirve» igual de hostil
    const hostil: NodoAgente = { ...agente('a1', 312, 180), nombre: "Ana's bot \\ }} Pérez {{", instrucciones: '={{ $env.X }}', tarea: 'Haz {algo} con {{ $json }}' };
    const f = flujoDe(
      [
        { ...disparador(), tipo: 'web' },
        hostil,
        { ...agente('a2', 920, 400), nombre: "x'); y('", desc: '={{ $env.Y }}', instrucciones: '=={{ $env.Z }}' },
        { ...app('p1', 616, 180), nombre: 'Gmail' },
        { ...app('p2', 920, 180), nombre: 'Slack' },
        { ...app('p3', 616, 600), nombre: '__proto__' },
        { ...app('p4', 312, 500), nombre: "d'Ana }}{{" },
      ],
      [
        { id: 'e1', de: 't1', a: 'a1', tipo: 'seq' },
        { id: 'e2', de: 'a1', a: 'p1', tipo: 'seq' },
        { id: 'e3', de: 'p1', a: 'p2', tipo: 'seq' },
        { id: 'e4', de: 'a1', a: 'a2', tipo: 'tool' },
        { id: 'e5', de: 'a2', a: 'p3', tipo: 'tool' },
        { id: 'e6', de: 'a1', a: 'p4', tipo: 'tool' },
      ],
    );
    const { violaciones, sesion } = escenario(f, [{ k: 'abrirNodo', id: 'a1' }]);
    expect(violaciones).toEqual([]);
    const r = construirFlujo(sesion.estado.flujo);
    expect(r.errores).toEqual([]);
    const slack = r.flujo?.nodes.find(n => n.name === 'Slack');
    // la segunda app cita al agente por su nombre: la comilla, la barra y las llaves van como \\uXXXX
    expect(JSON.stringify(slack?.parameters)).toContain('\\u0027');
    expect(JSON.stringify(slack?.parameters)).not.toContain("Ana's");
    // y las instrucciones que empiezan con «=» no dejan llaves que n8n evaluaría
    const agenteN8n = r.flujo?.nodes.find(n => n.name === "Ana's bot \\ }} Pérez {{");
    expect(JSON.stringify(agenteN8n?.parameters)).not.toMatch(/systemMessage":"=+\{\{/);
  });

  it('constructor.propiedades.un_estado_con_punteros_a_lo_que_ya_no_existe_no_hace_tronar_nada_y_la_siguiente_accion_lo_sana', () => {
    // el estado envenenado a mano (E4 del fuzz del mockup): un menú, una conexión en curso o una selección que apuntan a algo que no está
    const sano = estadoInicial(ejemplo());
    const venenos: Record<string, Partial<E>> = {
      'menú con ancla borrada': { menu: { ancla: 'FANTASMA', tipo: 'seq', paso: 'inicio', insertarEn: null } },
      'menú con conexión borrada': { menu: { ancla: 'a1', tipo: 'seq', paso: 'app', insertarEn: 'EFANTASMA' } },
      'menú de «en medio» con la conexión de otro': { menu: { ancla: 'a1', tipo: 'seq', paso: 'app', insertarEn: 'e4' } },
      'conectando con ancla borrada': { conectando: { ancla: 'FANTASMA', rol: 'origen', tipo: 'seq' } },
      'cuadro elegido borrado': { sel: 'FANTASMA' },
      'conexión elegida borrada': { selEdge: 'EFANTASMA' },
      'cuadro y conexión elegidos a la vez': { sel: 'a1', selEdge: 'e1' },
      'menú y conectando a la vez': { menu: { ancla: 'a1', tipo: 'seq', paso: 'inicio', insertarEn: null }, conectando: { ancla: 'a2', rol: 'origen', tipo: 'seq' } },
    };
    const acciones: A[] = [
      { k: 'elegirDisparador', tipo: 'web' },
      { k: 'abrirNodo', id: 'a1' },
      { k: 'abrirNodo', id: 'p2' },
      { k: 'abrirEnlace', id: 'e1' },
      { k: 'abrirMenu', ancla: 'a1', tipo: 'seq' },
      { k: 'abrirMenu', ancla: 'a2', tipo: 'tool' },
      { k: 'cerrarMenu' },
      { k: 'pasoMenu', paso: 'app' },
      { k: 'crearDesdeMenu', que: 'app', nombreApp: 'Gmail' },
      { k: 'crearDesdeMenu', que: 'agente' },
      { k: 'iniciarConexion', ancla: 'a1', rol: 'origen', tipo: 'seq' },
      { k: 'intentarConexion', id: 'p2' },
      { k: 'cancelarConexion' },
      { k: 'cerrarTodo' },
      { k: 'cambiarTipoEnlace', id: 'e2', tipo: 'tool' },
      { k: 'quitarEnlace', id: 'e2' },
      { k: 'quitarNodo', id: 'p2' },
      { k: 'moverNodo', id: 'a1', x: 400, y: 400 },
      { k: 'moverConTeclado', id: 'a1', direccion: 'derecha' },
      { k: 'editarNodo', id: 'a1', parche: { nombre: 'Otro' } },
      { k: 'renombrarFlujo', nombre: 'Otro' },
      { k: 'limpiar' },
      { k: 'cargarEjemplo' },
      { k: 'deshacer' },
      { k: 'volverDeAjustes' },
      { k: 'limpiarPeticiones' },
    ];
    const ctx = new Sesion().ctx;
    const mal: string[] = [];
    for (const [veneno, parche] of Object.entries(venenos)) {
      const envenenado = congelar<E>({ ...sano, ...parche });
      for (const a of acciones) {
        try {
          const r = congelar(reducir(envenenado, a));
          const fallas = [...revisarVistas(r), ...revisarExportacion(r, { ...ctx, completo: true })];
          // si la acción cambió algo, el estado que sale ya no apunta a lo que no existe (sanear); si no cambió nada, los selectores igual lo aguantan
          if (r !== envenenado) fallas.push(...revisarEstado(r, ctx).filter(v => v.grupo === 'punteros'));
          for (const v of fallas) mal.push(`${veneno} + ${a.k}: ${v.codigo}: ${v.detalle.slice(0, 80)}`);
        } catch (x) {
          mal.push(`${veneno} + ${a.k}: LANZA ${x instanceof Error ? x.message : String(x)}`);
        }
      }
    }
    expect(mal).toEqual([]);
  });
});

// ---------------------------------------------------------------- determinismo

describe('propiedades · la corrida se puede repetir', () => {
  it('constructor.propiedades.la_misma_semilla_da_la_misma_corrida_y_las_acciones_se_pueden_repetir', () => {
    const c: Campana = { nombre: 'mixto', modo: 'mixto', n: 1, largo: [30, 40] };
    const nuevo = () => ({ cobertura: new Map<string, number>(), suaves: new Map<string, number>() });
    const x = correrSecuencia(77, c, 0, 5, nuevo());
    const y = correrSecuencia(77, c, 0, 5, nuevo());
    const otra = correrSecuencia(77, c, 0, 6, nuevo());
    expect(JSON.stringify(x.acciones)).toBe(JSON.stringify(y.acciones));
    expect(JSON.stringify(x.estadoFinal)).toBe(JSON.stringify(y.estadoFinal));
    expect(JSON.stringify(x.acciones)).not.toBe(JSON.stringify(otra.acciones));
    // las acciones son datos: volver a darlas a una sesión nueva lleva al mismo estado (el reductor es puro)
    const s = new Sesion();
    for (const a of x.acciones) expect(s.aplicar(a)).toEqual([]);
    expect(JSON.stringify(s.estado)).toBe(JSON.stringify(x.estadoFinal));
    // y con otra semilla, otra secuencia
    const z = correrSecuencia(78, c, 0, 5, nuevo());
    expect(JSON.stringify(z.acciones)).not.toBe(JSON.stringify(x.acciones));
  });
});

// ---------------------------------------------------------------- que los ojos vean: mutantes

type Reductor = Dependencias['reducir'];
type Armado = Dependencias['construirFlujo'];

/** Un reductor «con un defecto»: el de verdad y, encima, lo que `rompe` le haga al resultado. */
const conDefecto = (rompe: (despues: E, antes: E, a: A) => E): Dependencias => ({
  ...DEPS_REALES,
  reducir: ((antes, a) => rompe(DEPS_REALES.reducir(antes, a), antes, a)) as Reductor,
});
/** Un exportador «con un defecto». */
const exportadorConDefecto = (rompe: (r: ReturnType<Armado>) => ReturnType<Armado>): Dependencias => ({
  ...DEPS_REALES,
  construirFlujo: ((est, op) => rompe(DEPS_REALES.construirFlujo(est, op))) as Armado,
});

interface Mutante {
  nombre: string;
  deps: Dependencias;
  /** Qué violaciones delatan el defecto (alguna basta). */
  delata: (h: Hallazgo) => boolean;
}

const aristaMala = (e: E, a: A): E | null => {
  // un «conectar» que se salta las reglas: agrega la conexión aunque el reductor la haya rechazado
  if (!e.conectando || (a.k !== 'intentarConexion' && a.k !== 'abrirNodo')) return null;
  const otro = e.flujo.nodes.find(n => n.id === a.id);
  if (!otro || otro.id === e.conectando.ancla) return null;
  const [de, hacia] = e.conectando.rol === 'origen' ? [e.conectando.ancla, otro.id] : [otro.id, e.conectando.ancla];
  const siguiente = e.siguiente + 1;
  return { ...e, flujo: { ...e.flujo, edges: [...e.flujo.edges, { id: `e${siguiente}`, de, a: hacia, tipo: e.conectando.tipo }] }, siguiente, conectando: null };
};

const MUTANTES: Mutante[] = [
  {
    nombre: 'quitar deja la selección apuntando al cuadro quitado',
    deps: conDefecto((r, e, a) => (a.k === 'quitarNodo' && r.flujo !== e.flujo ? { ...r, sel: a.id } : r)),
    delata: h => h.codigo === 'sel-fantasma',
  },
  {
    nombre: 'Deshacer devuelve los cuadros en otro orden',
    deps: conDefecto((r, e, a) => (a.k === 'deshacer' && r.flujo !== e.flujo && r.flujo.nodes.length > 1 ? { ...r, flujo: { ...r.flujo, nodes: [...r.flujo.nodes].reverse() } } : r)),
    delata: h => h.codigo === 'deshacer-no-restaura',
  },
  {
    nombre: 'un segundo disparador cuando ya había uno',
    deps: conDefecto((r, e, a) =>
      a.k === 'elegirDisparador' && r.flujo === e.flujo && e.flujo.nodes.some(n => n.kind === 'trigger')
        ? { ...r, flujo: { ...r.flujo, nodes: [...r.flujo.nodes, { id: 't99', kind: 'trigger', x: 8, y: 800, tipo: 'chat', frec: 'dia', ruta: 'x', app: 'gmail' }] } }
        : r,
    ),
    delata: h => h.codigo === 'varios-disparadores',
  },
  {
    nombre: 'mover un cuadro no anota qué se tocó para que Deshacer no lo pise',
    deps: conDefecto((r, e, a) => (a.k === 'moverNodo' && r.flujo !== e.flujo ? { ...r, historial: e.historial } : r)),
    delata: h => h.codigo === 'edicion-no-marca-lo-tocado',
  },
  {
    nombre: 'mover un cuadro tira la pila de Deshacer (el defecto de antes)',
    deps: conDefecto((r, e, a) => (a.k === 'moverNodo' && r.flujo !== e.flujo ? { ...r, historial: [] } : r)),
    delata: h => h.codigo === 'edicion-cambia-el-tamano-de-la-pila',
  },
  {
    nombre: 'arrastrar un cuadro apaga el «Deshacer» del aviso',
    deps: conDefecto((r, e, a) => (a.k === 'moverNodo' && r.flujo !== e.flujo && r.aviso?.conDeshacer ? { ...r, aviso: { ...r.aviso, conDeshacer: false } } : r)),
    delata: h => h.codigo === 'edicion-cambia-el-deshacer-del-aviso',
  },
  {
    nombre: 'Deshacer pisa lo que se movió o se escribió después con la posición y el texto de la foto',
    deps: conDefecto((r, e, a) => {
      const foto = e.historial[e.historial.length - 1];
      return a.k === 'deshacer' && r.flujo !== e.flujo && foto && (foto.tocados?.length ?? 0) > 0 && foto.clase !== 'cargar' ? { ...r, flujo: { ...r.flujo, nodes: foto.nodes } } : r;
    }),
    delata: h => h.codigo === 'deshacer-no-restaura',
  },
  {
    nombre: 'quitar un cuadro que no existe igual cambia el estado',
    deps: conDefecto((r, e, a) => (a.k === 'quitarNodo' && r === e ? { ...r, eventos: r.eventos + 1 } : r)),
    delata: h => h.codigo === 'id-inexistente-cambia-el-estado',
  },
  {
    nombre: 'mover un cuadro modifica el estado que recibe',
    deps: conDefecto((r, e, a) => {
      if (a.k === 'moverNodo') (e.flujo.nodes[0] as unknown as { x: number }).x += 8;
      return r;
    }),
    delata: h => h.codigo === 'accion-lanza',
  },
  {
    nombre: 'crear un cuadro no sube el contador de ids',
    deps: conDefecto((r, e, a) => (a.k === 'crearDesdeMenu' && r.flujo !== e.flujo ? { ...r, siguiente: e.siguiente } : r)),
    delata: h => h.codigo === 'id-pasa-del-contador',
  },
  {
    nombre: 'conectar se salta las reglas de enlace',
    deps: conDefecto((r, e, a) => (r.flujo === e.flujo ? (aristaMala(e, a) ?? r) : r)),
    delata: h => h.grupo === 'grafo' || h.codigo === 'destino-nulo-conecta',
  },
  {
    nombre: 'cargar un flujo de afuera sin revisarlo',
    deps: conDefecto((r, e, a) =>
      a.k === 'cargarFlujo' && r.flujo === e.flujo && typeof a.flujo === 'object' && a.flujo !== null && Array.isArray(a.flujo.nodes) && Array.isArray(a.flujo.edges)
        ? { ...r, flujo: a.flujo }
        : r,
    ),
    delata: h => h.grupo === 'grafo' || h.codigo === 'flujo-roto-se-acepta-o-no-avisa' || h.codigo === 'flujo-sin-forma',
  },
  {
    nombre: 'un cuarto de agentes de más',
    deps: conDefecto((r, e, a) =>
      a.k === 'crearDesdeMenu' && a.que === 'agente' && r.flujo !== e.flujo
        ? { ...r, flujo: { ...r.flujo, nodes: [...r.flujo.nodes, ...[91, 92, 93, 94].map((k): Nodo => ({ id: `a${k}`, kind: 'agent', x: 8 + k * 8, y: 1600, nombre: `Extra ${k}`, ia: 'openai', tarea: '', instrucciones: '' }))] } }
        : r,
    ),
    delata: h => h.codigo === 'tope-agentes' || h.codigo === 'mas-ofrecido-rechazado',
  },
  {
    nombre: 'quitar un cuadro no guarda su instantánea',
    deps: conDefecto((r, e, a) => (a.k === 'quitarNodo' && r.flujo !== e.flujo ? { ...r, historial: r.historial.slice(0, -1) } : r)),
    delata: h => h.codigo === 'cambio-estructural-sin-instantanea',
  },
  {
    nombre: 'el exportador da un archivo distinto cada vez',
    deps: (() => {
      let veces = 0;
      return exportadorConDefecto(r => {
        veces += 1;
        return r.flujo !== null && veces % 2 === 0 ? { ...r, json: `${r.json} ` } : r;
      });
    })(),
    delata: h => h.codigo === 'flujo-json-inestable' || h.codigo === 'flujo-json-distinto',
  },
  {
    nombre: 'el exportador pierde una conexión',
    deps: exportadorConDefecto(r => {
      if (r.flujo === null) return r;
      const [primera, ...resto] = Object.entries(r.flujo.connections);
      if (!primera) return r;
      const flujo = { ...r.flujo, connections: Object.fromEntries(resto) };
      return { ...r, flujo, json: JSON.stringify(flujo, null, 2) };
    }),
    delata: h => h.codigo === 'flujo-conexion-falta' || h.codigo === 'flujo-invariante',
  },
  {
    nombre: 'el exportador dice «sin errores» y no entrega el archivo',
    deps: exportadorConDefecto(r => (r.flujo !== null ? { ...r, flujo: null, json: '' } : r)),
    delata: h => h.codigo === 'flujo-errores-vs-nulo',
  },
  {
    nombre: 'poner en medio deja el cuadro nuevo a la izquierda de su origen',
    deps: conDefecto((r, e, a) =>
      a.k === 'crearDesdeMenu' && e.menu?.insertarEn && r.flujo !== e.flujo
        ? { ...r, flujo: { ...r.flujo, nodes: r.flujo.nodes.map((n, i, l) => (i === l.length - 1 ? { ...n, x: 0 } : n)) } }
        : r,
    ),
    delata: h => h.codigo === 'insertar-deja-una-flecha-hacia-atras',
  },
  {
    nombre: 'Deshacer no gasta la instantánea',
    deps: conDefecto((r, e, a) => (a.k === 'deshacer' && r.flujo !== e.flujo ? { ...r, historial: e.historial } : r)),
    delata: h => h.codigo === 'deshacer-gasta-mal-la-pila',
  },
  {
    nombre: 'el foco queda en un cuadro que se quitó',
    deps: conDefecto((r, e, a) => (a.k === 'quitarNodo' && r.flujo !== e.flujo ? { ...r, foco: { objetivo: { k: 'nodo', id: a.id }, n: r.eventos } } : r)),
    delata: h => h.codigo === 'foco-sin-destino',
  },
  {
    nombre: 'editar un campo mueve el cuadro',
    deps: conDefecto((r, e, a) =>
      a.k === 'editarNodo' && r.flujo !== e.flujo ? { ...r, flujo: { ...r.flujo, nodes: r.flujo.nodes.map(n => (n.id === a.id ? { ...n, x: n.x + 8 } : n)) } } : r,
    ),
    delata: h => h.codigo === 'editar-cambia-lo-que-no-debe',
  },
  {
    nombre: 'conectar rechaza un destino que la vista marca como válido',
    deps: conDefecto((r, e, a) =>
      (a.k === 'intentarConexion' || a.k === 'abrirNodo') && e.conectando && r.flujo !== e.flujo
        ? { ...e, eventos: e.eventos + 1, aviso: { id: e.eventos + 1, texto: 'No.', tipo: 'mal', conDeshacer: false } }
        : r,
    ),
    delata: h => h.codigo === 'destino-valido-no-conecta',
  },
  {
    nombre: 'tocar un cuadro no lo elige',
    deps: conDefecto((r, e, a) => (a.k === 'abrirNodo' && !e.conectando && r !== e ? { ...r, sel: null } : r)),
    delata: h => h.codigo === 'abrir-no-elige',
  },
  {
    nombre: 'abrir un flujo de afuera deja el estado compartiendo sus cuadros',
    deps: conDefecto((r, e, a) => (a.k === 'cargarFlujo' && r.flujo !== e.flujo ? { ...r, flujo: a.flujo } : r)),
    delata: h => h.codigo === 'cargar-flujo-comparte-objetos',
  },
];

/** Las campañas cortas con las que se busca cada mutante: parar en el primero que lo delata. */
const CAMPANAS_DE_MUTANTE: Campana[] = [
  { nombre: 'ui', modo: 'ui', n: 30, largo: [5, 50] },
  { nombre: 'api', modo: 'api', n: 12, largo: [5, 50] },
  { nombre: 'mixto', modo: 'mixto', n: 30, largo: [5, 50] },
];

describe('propiedades · los ojos de la prueba ven los defectos', () => {
  it('constructor.propiedades.los_ojos_de_la_prueba_detectan_cada_mutante_del_reductor_y_del_exportador', () => {
    const sinVer: string[] = [];
    for (const m of MUTANTES) {
      const r = correrCampanas([20261020], CAMPANAS_DE_MUTANTE, m.deps, true);
      if (!r.hallazgos.some(m.delata)) sinVer.push(`${m.nombre}: ${r.hallazgos.length === 0 ? 'ninguna violación' : [...new Set(r.hallazgos.map(h => h.codigo))].join(', ')}`);
    }
    expect(sinVer).toEqual([]);
    expect(MUTANTES.length).toBeGreaterThanOrEqual(20);
  }, 120_000);

  it('constructor.propiedades.el_minimizador_reduce_una_secuencia_que_falla_a_las_acciones_que_la_causan', () => {
    const m = MUTANTES[2];
    expect(m?.nombre).toBe('un segundo disparador cuando ya había uno');
    const deps = (m as Mutante).deps;
    const r = correrCampanas([20261020], [{ nombre: 'api', modo: 'api', n: 40, largo: [20, 60] }], deps, true);
    const h = r.hallazgos.find(x => x.codigo === 'varios-disparadores');
    expect(h).toBeDefined();
    const largo = (h as Hallazgo).acciones.length;
    const minima = minimizar((h as Hallazgo).acciones, 'varios-disparadores', deps);
    // dos acciones bastan: algo que deje un disparador en el lienzo (elegirlo, o abrir un flujo que ya lo trae) y elegirlo otra vez
    expect(minima).toHaveLength(2);
    expect(minima[1]?.k).toBe('elegirDisparador');
    expect(largo).toBeGreaterThanOrEqual(2);
    expect(reproducir(minima, 'varios-disparadores', deps)).not.toBeNull();
    // sin el defecto, la misma secuencia mínima no rompe nada
    expect(reproducir(minima, 'varios-disparadores')).toBeNull();
    const texto = describir(h as Hallazgo, deps);
    expect(texto).toContain('varios-disparadores');
    expect(texto).toContain('secuencia mínima (2 acciones)');
    expect(texto).toContain('semilla 20261020');
  }, 60_000);

  it('constructor.propiedades.el_detector_de_suciedad_ve_nan_undefined_infinito_y_objetos_sin_formato', () => {
    expect(buscarSuciedad({ a: 1, b: 'Hola «Mundo»', c: [0, -3.5, 'x'], d: { e: null, f: '' } })).toEqual([]);
    const sucio = buscarSuciedad(
      { n: Number.NaN, i: Infinity, u: undefined, t1: 'Hola undefined', t2: 'valor NaN', t3: '[object Object]', t4: 'es null', lista: [1, { x: -Infinity }] },
      'v',
    );
    expect(sucio.map(x => `${x.codigo} ${x.ruta}`)).toEqual([
      'selector-numero-no-finito v.n',
      'selector-numero-no-finito v.i',
      'selector-undefined v.u',
      'selector-texto-sucio v.t1',
      'selector-texto-sucio v.t2',
      'selector-texto-sucio v.t3',
      'selector-texto-sucio v.t4',
      'selector-numero-no-finito v.lista[1].x',
    ]);
    // no se pierde en un ciclo
    const ciclo: Record<string, unknown> = { n: 1 };
    ciclo.otra = ciclo;
    expect(buscarSuciedad(ciclo)).toEqual([]);
    // «nulo» y «nula» (español) no son «null»
    expect(buscarSuciedad({ clase: 'nodo-nulo', modo: 'nulo' })).toEqual([]);
  });

  it('constructor.propiedades.los_estados_y_las_acciones_de_la_prueba_se_congelan_a_fondo', () => {
    const e = congelar(estadoInicial());
    expect(Object.isFrozen(e)).toBe(true);
    expect(Object.isFrozen(e.flujo.nodes)).toBe(true);
    const a = congelar<A>({ k: 'cargarFlujo', flujo: { nodes: [], edges: [], nombreFlujo: 'x' } });
    expect(Object.isFrozen(a)).toBe(true);
    expect(() => {
      (e.flujo as { nombreFlujo: string }).nombreFlujo = 'otro';
    }).toThrow(TypeError);
  });
});
