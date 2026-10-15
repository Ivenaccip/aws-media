// El recorrido del inicio sin React (recorrido.ts): los pasos, las migas, a dónde regresa «Volver a …», la entrada por la URL y el
// doble clic. Cada regla lleva una prueba que se rompe si la regla se rompe (se vio fallar con la regla cambiada).
import { describe, expect, it } from 'vitest';

import { LUGAR_INICIAL, MENU, buscar, lugarATexto, urlDeInicio, type Lugar, type PestanaCaja } from '../../marca/menu';
import {
  REPOSO,
  VENTANA_DOBLE_CLIC_MS,
  areaDe,
  cajaVisible,
  destinoDeVolver,
  esCaja,
  esDobleClicAccidental,
  estadoInicial,
  grupoActual,
  grupoDe,
  hayVolver,
  migasDe,
  reducir,
  urlSinEntrada,
  type Accion,
  type EstadoRecorrido,
} from './recorrido';

// los lugares de menu.ts: todos los (área, grupo, pantalla)
const LUGARES: Lugar[] = MENU.flatMap(a => a.grupos.flatMap(g => g.pantallas.map(p => ({ area: a.clave, grupo: g.clave, pantalla: p.clave }))));
const FAMILIAS: PestanaCaja[] = ['imagenes', 'videos', 'edicion'];

const en = (paso: EstadoRecorrido['paso'], resto: Partial<EstadoRecorrido> = {}): EstadoRecorrido => ({ ...REPOSO, paso, ...resto });
const desdeUrl = (l: Lugar, ver: 'mapa' | 'grupos') => estadoInicial(new URL(urlDeInicio(l, ver), 'http://x').search);

describe('REPOSO · se aterriza en la caja', () => {
  it('es el lugar inicial de menu.ts (Marketing › Distrito) y su contenido es la caja', () => {
    expect(REPOSO).toEqual({ paso: 'contenido', explora: LUGAR_INICIAL.area, area: LUGAR_INICIAL.area, grupo: LUGAR_INICIAL.grupo, hoja: null });
    expect(esCaja(grupoActual(REPOSO))).toBe(true);
    expect(cajaVisible(REPOSO)).toBe(true);
    expect(hayVolver(REPOSO)).toBe(false);
  });

  it('solo el grupo con pestañas de caja es la caja: Blotato, Avanzado y todo Central son listas', () => {
    const cajas = MENU.flatMap(a => a.grupos.filter(esCaja).map(g => `${a.clave}.${g.clave}`));
    expect(cajas).toEqual(['mkt.distrito']);
  });
});

describe('reducir · los pasos', () => {
  it('la miga del área abre el mapa sin moverte de donde estás', () => {
    expect(reducir(REPOSO, { tipo: 'abrir-mapa' })).toEqual({ ...REPOSO, paso: 'mapa' });
  });

  it('elegir un área abre sus opciones y NO te saca de donde estabas (así «Volver» te deja exactamente ahí)', () => {
    const e = reducir(en('mapa'), { tipo: 'elegir-area', area: 'central' });
    expect(e).toMatchObject({ paso: 'grupos', explora: 'central', area: 'mkt', grupo: 'distrito' });
  });

  it('Producto, Ventas y Automatizaciones están apagadas: elegirlas no cambia nada (el mismo objeto)', () => {
    const mapa = en('mapa');
    for (const clave of ['producto', 'ventas', 'automatizaciones']) {
      expect(areaDe(clave)?.proximamente).toBe(true);
      expect(reducir(mapa, { tipo: 'elegir-area', area: clave })).toBe(mapa);
    }
  });

  it('un área que no existe no cambia nada', () => {
    const mapa = en('mapa');
    expect(reducir(mapa, { tipo: 'elegir-area', area: 'nada' })).toBe(mapa);
    expect(reducir(mapa, { tipo: 'elegir-area', area: '' })).toBe(mapa);
  });

  it('elegir un grupo pasa a su contenido: ahí estás ahora, y la pantalla de la que venías se olvida', () => {
    const venia = en('grupos', { explora: 'mkt', hoja: 'agenda', grupo: 'blotato' });
    expect(reducir(venia, { tipo: 'elegir-grupo', area: 'mkt', grupo: 'avanzado' })).toEqual({
      paso: 'contenido',
      explora: 'mkt',
      area: 'mkt',
      grupo: 'avanzado',
      hoja: null,
    });
  });

  it('un grupo de OTRA área (o que no existe) no se elige: no hay a dónde ir', () => {
    const opciones = en('grupos');
    expect(reducir(opciones, { tipo: 'elegir-grupo', area: 'mkt', grupo: 'deepseek' })).toBe(opciones);
    expect(reducir(opciones, { tipo: 'elegir-grupo', area: 'central', grupo: 'blotato' })).toBe(opciones);
    expect(reducir(opciones, { tipo: 'elegir-grupo', area: 'producto', grupo: 'distrito' })).toBe(opciones);
  });

  it('un grupo apagado (Deepseek) SÍ se elige: su contenido dice que todavía no está', () => {
    expect(reducir(en('grupos', { explora: 'central' }), { tipo: 'elegir-grupo', area: 'central', grupo: 'deepseek' })).toMatchObject({
      paso: 'contenido',
      area: 'central',
      grupo: 'deepseek',
    });
  });

  it('«Volver» desde el mapa y desde las opciones regresa al contenido de donde estabas, aunque hayas mirado otra área', () => {
    const mirando = reducir(reducir(REPOSO, { tipo: 'abrir-mapa' }), { tipo: 'elegir-area', area: 'central' });
    expect(mirando.explora).toBe('central');
    const de = reducir(mirando, { tipo: 'volver' });
    expect(de).toMatchObject({ paso: 'contenido', area: 'mkt', grupo: 'distrito' });
    expect(reducir(en('mapa'), { tipo: 'volver' })).toEqual(REPOSO);
  });

  it('«Volver» en el contenido no hace nada (el mismo objeto)', () => {
    expect(reducir(REPOSO, { tipo: 'volver' })).toBe(REPOSO);
  });

  it('con una página aparte de por medio, «Volver» no cambia de paso: navegar a ella es de quien pinta (destinoDeVolver)', () => {
    const venia = en('mapa', { area: 'mkt', grupo: 'blotato', hoja: 'agenda' });
    expect(reducir(venia, { tipo: 'volver' })).toBe(venia);
  });

  it('la miga del grupo reabre las opciones del ÁREA donde estás; en el mapa no hay miga de grupo', () => {
    const e = reducir(en('contenido', { area: 'central', grupo: 'deepseek', explora: 'mkt' }), { tipo: 'abrir-grupos' });
    expect(e).toMatchObject({ paso: 'grupos', explora: 'central', area: 'central', grupo: 'deepseek' });
    const mapa = en('mapa');
    expect(reducir(mapa, { tipo: 'abrir-grupos' })).toBe(mapa);
  });

  it('abrir el mapa estando en el mapa no cambia nada (el mismo objeto)', () => {
    const mapa = en('mapa');
    expect(reducir(mapa, { tipo: 'abrir-mapa' })).toBe(mapa);
  });

  it('es pura: no cambia el estado que recibe', () => {
    const congelado = Object.freeze({ ...REPOSO });
    const acciones: Accion[] = [
      { tipo: 'abrir-mapa' },
      { tipo: 'abrir-grupos' },
      { tipo: 'elegir-area', area: 'central' },
      { tipo: 'elegir-grupo', area: 'mkt', grupo: 'blotato' },
      { tipo: 'volver' },
    ];
    for (const a of acciones) expect(() => reducir(congelado, a)).not.toThrow();
    expect(congelado).toEqual(REPOSO);
  });
});

describe('reducir · exhaustivo: ningún camino deja un estado roto', () => {
  // todas las acciones posibles con las claves de menu.ts (más una clave que no existe)
  const acciones: Accion[] = [
    { tipo: 'abrir-mapa' },
    { tipo: 'abrir-grupos' },
    { tipo: 'volver' },
    { tipo: 'elegir-area', area: 'no-existe' },
    ...MENU.flatMap<Accion>(a => [
      { tipo: 'elegir-area', area: a.clave },
      ...MENU.flatMap(otra => otra.grupos.map<Accion>(g => ({ tipo: 'elegir-grupo', area: a.clave, grupo: g.clave }))),
    ]),
  ];
  const clave = (e: EstadoRecorrido) => JSON.stringify(e);

  // todos los estados a los que se llega desde la caja y desde cada pantalla de menu.ts (con las dos formas de entrar por la URL)
  const alcanzados = new Map<string, EstadoRecorrido>();
  const pendientes: EstadoRecorrido[] = [REPOSO, ...LUGARES.flatMap(l => [desdeUrl(l, 'mapa'), desdeUrl(l, 'grupos')])];
  for (let e = pendientes.pop(); e; e = pendientes.pop()) {
    if (alcanzados.has(clave(e))) continue;
    alcanzados.set(clave(e), e);
    for (const a of acciones) pendientes.push(reducir(e, a));
  }

  it('recorre de verdad el espacio de estados (si esto baja, la exploración dejó de explorar)', () => {
    expect(alcanzados.size).toBeGreaterThan(40);
  });

  it.each([...alcanzados.values()].map(e => [clave(e), e] as const))('%s', (_, e) => {
    // dónde estás y qué miras existen en menu.ts
    expect(grupoDe(e.area, e.grupo)).toBeDefined();
    expect(areaDe(e.explora)?.grupos.length).toBeGreaterThan(0);
    expect(areaDe(e.explora)?.proximamente).not.toBe(true);
    // la página de la que vienes existe y tiene a dónde volver; y en el contenido ya no hay página de por medio
    if (e.hoja !== null) {
      expect(e.paso).not.toBe('contenido');
      expect(grupoDe(e.area, e.grupo)?.pantallas.find(p => p.clave === e.hoja)?.href).toBeTruthy();
    }
    // las migas: ninguna en el mapa, el área en las opciones, área y grupo en el contenido; la última es donde estás
    const migas = migasDe(e);
    expect(migas).toHaveLength({ mapa: 0, grupos: 1, contenido: 2 }[e.paso]);
    if (migas.length) expect(migas.at(-1)?.actual).toBe(true);
    // «Volver a …» siempre dice a dónde, y navega solo si vienes de una página
    for (const f of FAMILIAS) {
      const d = destinoDeVolver(e, f);
      expect(d.rotulo).toMatch(/^Volver a \S.*/);
      expect(d.href !== null).toBe(e.hoja !== null);
    }
    // la caja se ve solo en su grupo y en el contenido
    expect(cajaVisible(e)).toBe(e.paso === 'contenido' && esCaja(grupoActual(e)));
    // y siempre hay salida: «Volver» (o la página) o ya estás en el contenido
    expect(hayVolver(e)).toBe(e.paso !== 'contenido');
  });
});

describe('migasDe · la ruta elegida, y cada miga reabre su nivel', () => {
  it('en el mapa no hay migas: se está eligiendo el primer nivel', () => {
    expect(migasDe(en('mapa'))).toEqual([]);
  });

  it('en las opciones, el área que se MIRA (no la de donde estás), y es la actual', () => {
    const migas = migasDe(en('grupos', { explora: 'central' }));
    expect(migas).toEqual([
      { clave: 'area', titulo: 'Central', icono: 'central', rotulo: 'Volver al mapa para cambiar de área (ahora: Central)', actual: true },
    ]);
  });

  it('en el contenido, área y grupo de donde estás; la del grupo es la actual y las dos dicen a dónde llevan', () => {
    expect(migasDe(REPOSO)).toEqual([
      { clave: 'area', titulo: 'Marketing', icono: 'marketing', rotulo: 'Volver al mapa para cambiar de área (ahora: Marketing)', actual: false },
      { clave: 'grupo', titulo: 'Distrito', icono: 'ubicacion', rotulo: 'Volver a las opciones de Marketing (ahora: Distrito)', actual: true },
    ]);
  });

  it('el texto visible de cada miga está dentro de su nombre accesible (WCAG 2.5.3)', () => {
    for (const e of [en('grupos'), REPOSO, en('contenido', { area: 'central', grupo: 'deepseek' })])
      for (const m of migasDe(e)) expect(m.rotulo).toContain(m.titulo);
  });
});

describe('destinoDeVolver · a dónde regresa «Volver a …»', () => {
  it('en la caja dice la pestaña de ahora: Imagen, Video o Edición', () => {
    const rotulo = (f: PestanaCaja) => destinoDeVolver(en('mapa'), f).rotulo;
    expect(rotulo('imagenes')).toBe('Volver a Imagen');
    expect(rotulo('videos')).toBe('Volver a Video');
    expect(rotulo('edicion')).toBe('Volver a Edición');
    expect(destinoDeVolver(en('mapa'), 'edicion').href).toBeNull();
  });

  it('en una lista dice el grupo, sin importar la pestaña de la caja', () => {
    for (const f of FAMILIAS) {
      expect(destinoDeVolver(en('grupos', { grupo: 'blotato' }), f).rotulo).toBe('Volver a Blotato');
      expect(destinoDeVolver(en('mapa', { area: 'central', grupo: 'deepseek' }), f).rotulo).toBe('Volver a Deepseek');
    }
  });

  it('si vienes de una pantalla hoja dice SU nombre y su dirección: «Volver» navega', () => {
    const d = destinoDeVolver(en('mapa', { grupo: 'blotato', hoja: 'metricas' }), 'videos');
    expect(d).toEqual({ rotulo: 'Volver a Ver mis métricas', href: '/metricas.html' });
  });

  it('cada pantalla con dirección de menu.ts se vuelve a ella, con su nombre', () => {
    const conDireccion = LUGARES.filter(l => buscar(l)?.pantalla.href);
    expect(conDireccion.length).toBeGreaterThanOrEqual(5);
    for (const l of conDireccion) {
      const d = destinoDeVolver(desdeUrl(l, 'mapa'), 'videos');
      expect(d).toEqual({ rotulo: `Volver a ${buscar(l)!.pantalla.titulo}`, href: buscar(l)!.pantalla.href });
    }
  });
});

describe('estadoInicial · la entrada por ?desde=…&ver=…', () => {
  it('sin nada en la URL, la caja', () => {
    expect(estadoInicial('')).toBe(REPOSO);
    expect(estadoInicial('?otra=1')).toBe(REPOSO);
  });

  it('desde una pantalla hoja con ver=mapa abre el mapa, ahí estás, y «Volver» regresa a esa página', () => {
    expect(estadoInicial('?desde=mkt.blotato.agenda&ver=mapa')).toEqual({
      paso: 'mapa',
      explora: 'mkt',
      area: 'mkt',
      grupo: 'blotato',
      hoja: 'agenda',
    });
  });

  it('con ver=grupos abre las tres opciones del área de esa pantalla', () => {
    expect(estadoInicial('?desde=mkt.avanzado.automaticas&ver=grupos')).toEqual({
      paso: 'grupos',
      explora: 'mkt',
      area: 'mkt',
      grupo: 'avanzado',
      hoja: 'automaticas',
    });
  });

  it('un lugar que no existe, o ver inválido o ausente, se ignoran y se aterriza en la caja', () => {
    for (const q of [
      '?desde=mkt.blotato.nada&ver=mapa', // la pantalla no existe
      '?desde=mkt.nada.agenda&ver=mapa', // el grupo no existe
      '?desde=nada.blotato.agenda&ver=mapa', // el área no existe
      '?desde=mkt.blotato&ver=mapa', // faltan claves
      '?desde=mkt.blotato.agenda.otra&ver=mapa', // sobran
      '?desde=&ver=mapa',
      '?ver=mapa', // sin `desde`
      '?desde=mkt.blotato.agenda', // sin `ver`
      '?desde=mkt.blotato.agenda&ver=otra', // `ver` que no es de aquí
      '?desde=mkt.blotato.agenda&ver=MAPA',
      '?desde=agenda&ver=grupos',
      '?desde=%00&ver=mapa',
    ]) {
      expect(estadoInicial(q), q).toBe(REPOSO);
    }
  });

  it('una pestaña de la caja o una pantalla apagada no son otra página: no hay a dónde «volver» fuera del inicio', () => {
    expect(estadoInicial('?desde=mkt.distrito.edicion&ver=mapa')).toMatchObject({ paso: 'mapa', area: 'mkt', grupo: 'distrito', hoja: null });
    expect(estadoInicial('?desde=central.distrito.coi&ver=grupos')).toMatchObject({ paso: 'grupos', explora: 'central', area: 'central', hoja: null });
  });

  it('lo demás de la URL no estorba (?blotato=conectar viaja aparte)', () => {
    expect(estadoInicial('?blotato=conectar&desde=mkt.blotato.metricas&ver=grupos')).toMatchObject({ paso: 'grupos', hoja: 'metricas' });
  });

  it('lo que arma urlDeInicio (el enlace de las migas de las hojas) es justo lo que se lee aquí, para cada pantalla del mapa', () => {
    for (const l of LUGARES) {
      for (const ver of ['mapa', 'grupos'] as const) {
        const e = desdeUrl(l, ver);
        expect(e, lugarATexto(l)).toMatchObject({ paso: ver, explora: l.area, area: l.area, grupo: l.grupo });
      }
    }
  });
});

describe('urlSinEntrada · la URL limpia una vez leída la entrada', () => {
  it('quita desde y ver y deja la ruta', () => {
    expect(urlSinEntrada('http://x/estudio/inicio/?desde=mkt.blotato.agenda&ver=mapa')).toBe('/estudio/inicio/');
  });

  it('deja lo demás: otros parámetros y el ancla', () => {
    expect(urlSinEntrada('http://x/estudio/inicio/?blotato=conectar&desde=mkt.blotato.agenda&ver=grupos#abajo')).toBe(
      '/estudio/inicio/?blotato=conectar#abajo',
    );
  });

  it('con uno solo de los dos también limpia (no se queda un `ver` suelto)', () => {
    expect(urlSinEntrada('http://x/estudio/inicio/?ver=mapa')).toBe('/estudio/inicio/');
    expect(urlSinEntrada('http://x/estudio/inicio/?desde=mkt.blotato.agenda')).toBe('/estudio/inicio/');
  });

  it('si no traía ninguno, null: no hay nada que reescribir', () => {
    expect(urlSinEntrada('http://x/estudio/inicio/')).toBeNull();
    expect(urlSinEntrada('http://x/estudio/inicio/?blotato=conectar')).toBeNull();
  });
});

describe('esDobleClicAccidental · el segundo clic de un doble clic en una ficha del mapa', () => {
  it('se ignora un segundo clic (detail > 1) a menos de medio segundo de abrir las opciones', () => {
    expect(esDobleClicAccidental(2, 0)).toBe(true);
    expect(esDobleClicAccidental(2, VENTANA_DOBLE_CLIC_MS - 1)).toBe(true);
    expect(esDobleClicAccidental(3, 120)).toBe(true);
  });

  it('una elección deliberada pasa: el primer clic, el teclado (detail 0) y un doble clic pasado el medio segundo', () => {
    expect(esDobleClicAccidental(1, 0)).toBe(false);
    expect(esDobleClicAccidental(0, 0)).toBe(false);
    expect(esDobleClicAccidental(2, VENTANA_DOBLE_CLIC_MS)).toBe(false);
    expect(esDobleClicAccidental(2, 5000)).toBe(false);
  });
});
