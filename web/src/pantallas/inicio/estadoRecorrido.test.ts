// El recorrido del inicio sin React (estadoRecorrido.ts): los pasos, las migas, el «Volver a …» que queda (solo el de otra página) y
// qué hace Esc, la entrada por la URL y el doble clic. Cada regla lleva una prueba que se rompe si la regla se rompe (se vio fallar con
// la regla cambiada).
import { describe, expect, it } from 'vitest';

import { LUGAR_INICIAL, MENU, PARAM_DESDE, PARAM_VER, buscar, lugarATexto, type Lugar } from '../../marca/menu';
import {
  REPOSO,
  VENTANA_DOBLE_CLIC_MS,
  alEscape,
  areaDe,
  cajaVisible,
  destinoDeVolver,
  esCaja,
  esDobleClicAccidental,
  estadoInicial,
  grupoActual,
  grupoDe,
  migasDe,
  reducir,
  urlSinEntrada,
  type Accion,
  type EstadoRecorrido,
} from './estadoRecorrido';

// los lugares de menu.ts: todos los (área, grupo, pantalla)
const LUGARES: Lugar[] = MENU.flatMap(a => a.grupos.flatMap(g => g.pantallas.map(p => ({ area: a.clave, grupo: g.clave, pantalla: p.clave }))));

const en = (paso: EstadoRecorrido['paso'], resto: Partial<EstadoRecorrido> = {}): EstadoRecorrido => ({ ...REPOSO, paso, ...resto });
// El enlace VIEJO de las migas (`?desde=<lugar>&ver=<mapa|grupos>`): hoy ya no lo emite nadie (urlDeInicio va directo a las páginas del
// nivel), pero el inicio de una sola página todavía lo LEE de un marcador guardado, y aquí se prueba que lo lee bien para cada pantalla.
const desdeUrl = (l: Lugar, ver: 'mapa' | 'grupos') => estadoInicial(`?${PARAM_DESDE}=${lugarATexto(l)}&${PARAM_VER}=${ver}`);

describe('REPOSO · se aterriza en el mapa, con nada elegido', () => {
  it('abre el paso del mapa; los pies de la caja escondida son el lugar inicial de menu.ts (Marketing › Distrito) y no hay nada elegido', () => {
    expect(REPOSO).toEqual({
      paso: 'mapa',
      explora: LUGAR_INICIAL.area,
      area: LUGAR_INICIAL.area,
      grupo: LUGAR_INICIAL.grupo,
      elegido: false,
      hoja: null,
    });
    // la caja existe (es la de Marketing › Distrito) pero no se ve: el mapa es el inicio
    expect(esCaja(grupoActual(REPOSO))).toBe(true);
    expect(cajaVisible(REPOSO)).toBe(false);
    expect(destinoDeVolver(REPOSO)).toBeNull();
  });

  it('sin nada elegido no hay migas ni «Volver a …»: el mapa no tiene a dónde subir', () => {
    expect(migasDe(REPOSO)).toEqual([]);
    expect(alEscape(REPOSO)).toBeNull();
  });

  it('solo el grupo con pestañas de caja es la caja: Blotato, Avanzado y todo Central son listas', () => {
    const cajas = MENU.flatMap(a => a.grupos.filter(esCaja).map(g => `${a.clave}.${g.clave}`));
    expect(cajas).toEqual(['mkt.distrito']);
  });
});

describe('reducir · los pasos', () => {
  it('abrir el mapa estando en el mapa (el reposo) no cambia nada: el mismo objeto', () => {
    expect(reducir(REPOSO, { tipo: 'abrir-mapa' })).toBe(REPOSO);
  });

  it('la miga del área abre el mapa sin moverte de donde estás ni cambiar lo elegido', () => {
    const enLaCaja = en('contenido', { elegido: true });
    expect(reducir(enLaCaja, { tipo: 'abrir-mapa' })).toEqual({ ...enLaCaja, paso: 'mapa' });
  });

  it('elegir un área abre sus opciones y NO te saca de donde estabas ni elige nada', () => {
    const e = reducir(REPOSO, { tipo: 'elegir-area', area: 'central' });
    expect(e).toMatchObject({ paso: 'grupos', explora: 'central', area: 'mkt', grupo: 'distrito', elegido: false });
  });

  it('Producto y Ventas están apagadas: elegirlas no cambia nada (el mismo objeto)', () => {
    for (const clave of ['producto', 'ventas']) {
      expect(areaDe(clave)?.proximamente).toBe(true);
      expect(reducir(REPOSO, { tipo: 'elegir-area', area: clave })).toBe(REPOSO);
    }
  });

  it('un área que no existe no cambia nada', () => {
    expect(reducir(REPOSO, { tipo: 'elegir-area', area: 'nada' })).toBe(REPOSO);
    expect(reducir(REPOSO, { tipo: 'elegir-area', area: '' })).toBe(REPOSO);
  });

  it('elegir un grupo pasa a su contenido: ya hay algo elegido, ahí estás, y la pantalla de la que venías se olvida', () => {
    const venia = en('grupos', { explora: 'mkt', hoja: 'agenda', grupo: 'blotato', elegido: true });
    expect(reducir(venia, { tipo: 'elegir-grupo', area: 'mkt', grupo: 'avanzado' })).toEqual({
      paso: 'contenido',
      explora: 'mkt',
      area: 'mkt',
      grupo: 'avanzado',
      elegido: true,
      hoja: null,
    });
  });

  it('desde el reposo, mapa → Marketing → Distrito llega a la caja ya elegida (es el camino de siempre a la caja)', () => {
    const opciones = reducir(REPOSO, { tipo: 'elegir-area', area: 'mkt' });
    expect(opciones).toMatchObject({ paso: 'grupos', elegido: false });
    const caja = reducir(opciones, { tipo: 'elegir-grupo', area: 'mkt', grupo: 'distrito' });
    expect(caja).toMatchObject({ paso: 'contenido', area: 'mkt', grupo: 'distrito', elegido: true });
    expect(cajaVisible(caja)).toBe(true);
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

  it('la miga del grupo reabre las opciones del ÁREA donde estás; en el mapa no hay miga de grupo', () => {
    const e = reducir(en('contenido', { area: 'central', grupo: 'deepseek', explora: 'mkt', elegido: true }), { tipo: 'abrir-grupos' });
    expect(e).toMatchObject({ paso: 'grupos', explora: 'central', area: 'central', grupo: 'deepseek' });
    const mapa = en('mapa');
    expect(reducir(mapa, { tipo: 'abrir-grupos' })).toBe(mapa);
  });

  it('es pura: no cambia el estado que recibe', () => {
    const congelado = Object.freeze({ ...REPOSO });
    const acciones: Accion[] = [
      { tipo: 'abrir-mapa' },
      { tipo: 'abrir-grupos' },
      { tipo: 'elegir-area', area: 'central' },
      { tipo: 'elegir-grupo', area: 'mkt', grupo: 'blotato' },
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
    { tipo: 'elegir-area', area: 'no-existe' },
    ...MENU.flatMap<Accion>(a => [
      { tipo: 'elegir-area', area: a.clave },
      ...MENU.flatMap(otra => otra.grupos.map<Accion>(g => ({ tipo: 'elegir-grupo', area: a.clave, grupo: g.clave }))),
    ]),
  ];
  const clave = (e: EstadoRecorrido) => JSON.stringify(e);

  // todos los estados a los que se llega desde el reposo y desde cada pantalla de menu.ts (con las dos formas de entrar por la URL)
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
    // nada elegido solo existe en el reposo: ni en el contenido (se llega a él ELIGIENDO), ni con una página de por medio (venías de ella)
    if (!e.elegido) {
      expect(e.paso).not.toBe('contenido');
      expect(e.hoja).toBeNull();
      expect([e.area, e.grupo]).toEqual([LUGAR_INICIAL.area, LUGAR_INICIAL.grupo]);
    }
    // las migas: ninguna en el mapa, el área en las opciones, área y grupo en el contenido; la última es donde estás
    const migas = migasDe(e);
    expect(migas).toHaveLength({ mapa: 0, grupos: 1, contenido: 2 }[e.paso]);
    if (migas.length) expect(migas.at(-1)?.actual).toBe(true);
    // «Volver a …» solo existe con una página aparte de por medio, y entonces navega a ella
    const d = destinoDeVolver(e);
    expect(d === null).toBe(e.hoja === null);
    if (d) expect(d.rotulo).toMatch(/^Volver a \S.*/);
    // Esc: nada en el contenido; con una página de por medio, ir a ella; sin ella, las opciones suben al mapa y el mapa no hace nada
    const esc = alEscape(e);
    if (e.paso === 'contenido') expect(esc).toBeNull();
    else if (d) expect(esc).toEqual({ tipo: 'ir', href: d.href });
    else expect(esc).toEqual(e.paso === 'grupos' ? { tipo: 'accion', accion: { tipo: 'abrir-mapa' } } : null);
    // la caja se ve solo en su grupo y en el contenido
    expect(cajaVisible(e)).toBe(e.paso === 'contenido' && esCaja(grupoActual(e)));
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
    expect(migasDe(en('contenido', { elegido: true }))).toEqual([
      { clave: 'area', titulo: 'Marketing', icono: 'marketing', rotulo: 'Volver al mapa para cambiar de área (ahora: Marketing)', actual: false },
      { clave: 'grupo', titulo: 'Distrito', icono: 'ubicacion', rotulo: 'Volver a las opciones de Marketing (ahora: Distrito)', actual: true },
    ]);
  });

  it('el texto visible de cada miga está dentro de su nombre accesible (WCAG 2.5.3)', () => {
    for (const e of [en('grupos'), en('contenido', { elegido: true }), en('contenido', { area: 'central', grupo: 'deepseek', elegido: true })])
      for (const m of migasDe(e)) expect(m.rotulo).toContain(m.titulo);
  });
});

describe('destinoDeVolver · el único «Volver a …» que queda es el de la página de donde llegaste', () => {
  it('sin una página aparte de por medio no hay «Volver a …»: ni en el mapa, ni en las opciones, ni en una lista (para eso están las migas)', () => {
    for (const paso of ['mapa', 'grupos', 'contenido'] as const) {
      expect(destinoDeVolver(en(paso))).toBeNull();
      expect(destinoDeVolver(en(paso, { grupo: 'blotato', elegido: true }))).toBeNull();
      expect(destinoDeVolver(en(paso, { area: 'central', grupo: 'deepseek', elegido: true }))).toBeNull();
    }
  });

  it('si vienes de una pantalla hoja dice SU nombre y su dirección: «Volver» navega', () => {
    const d = destinoDeVolver(en('mapa', { grupo: 'blotato', hoja: 'metricas', elegido: true }));
    expect(d).toEqual({ rotulo: 'Volver a Ver mis métricas', href: '/metricas.html' });
  });

  it('cada pantalla con dirección de menu.ts se vuelve a ella, con su nombre', () => {
    const conDireccion = LUGARES.filter(l => buscar(l)?.pantalla.href);
    expect(conDireccion.length).toBeGreaterThanOrEqual(5);
    for (const l of conDireccion) {
      const d = destinoDeVolver(desdeUrl(l, 'mapa'));
      expect(d).toEqual({ rotulo: `Volver a ${buscar(l)!.pantalla.titulo}`, href: buscar(l)!.pantalla.href });
    }
  });
});

describe('alEscape · qué hace Esc en cada paso', () => {
  it('en el mapa (el reposo) no hace nada: no hay a dónde subir', () => {
    expect(alEscape(REPOSO)).toBeNull();
    expect(alEscape(en('mapa', { elegido: true }))).toBeNull();
  });

  it('en las opciones sube un nivel: abre el mapa', () => {
    expect(alEscape(en('grupos'))).toEqual({ tipo: 'accion', accion: { tipo: 'abrir-mapa' } });
    expect(alEscape(en('grupos', { explora: 'central' }))).toEqual({ tipo: 'accion', accion: { tipo: 'abrir-mapa' } });
  });

  it('en el contenido (la caja o la lista de un grupo) no hace nada: ya no hay «Volver a …» al que regresar', () => {
    expect(alEscape(en('contenido', { elegido: true }))).toBeNull();
    expect(alEscape(en('contenido', { grupo: 'blotato', elegido: true }))).toBeNull();
    expect(alEscape(en('contenido', { area: 'central', grupo: 'deepseek', elegido: true }))).toBeNull();
  });

  it('con una página aparte de por medio regresa a ella, en el mapa y en las opciones', () => {
    for (const paso of ['mapa', 'grupos'] as const) {
      const e = en(paso, { grupo: 'blotato', hoja: 'agenda', elegido: true });
      expect(alEscape(e)).toEqual({ tipo: 'ir', href: destinoDeVolver(e)!.href });
    }
  });
});

describe('estadoInicial · la entrada por ?desde=…&ver=…', () => {
  it('sin nada en la URL, el reposo: el mapa, con nada elegido', () => {
    expect(estadoInicial('')).toBe(REPOSO);
    expect(estadoInicial('?otra=1')).toBe(REPOSO);
    expect(estadoInicial('').paso).toBe('mapa');
  });

  it('desde una pantalla hoja con ver=mapa abre el mapa, ahí estás (ya hay algo elegido), y «Volver» regresa a esa página', () => {
    expect(estadoInicial('?desde=mkt.blotato.agenda&ver=mapa')).toEqual({
      paso: 'mapa',
      explora: 'mkt',
      area: 'mkt',
      grupo: 'blotato',
      elegido: true,
      hoja: 'agenda',
    });
  });

  it('con ver=grupos abre las tres opciones del área de esa pantalla', () => {
    expect(estadoInicial('?desde=mkt.avanzado.automaticas&ver=grupos')).toEqual({
      paso: 'grupos',
      explora: 'mkt',
      area: 'mkt',
      grupo: 'avanzado',
      elegido: true,
      hoja: 'automaticas',
    });
  });

  it('un lugar que no existe, o ver inválido o ausente, se ignoran y se aterriza en el mapa (el reposo)', () => {
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

  it('una pestaña de la caja o una pantalla apagada no son otra página: no hay a dónde «volver» fuera del inicio (pero sí vienes de ese grupo)', () => {
    expect(estadoInicial('?desde=mkt.distrito.edicion&ver=mapa')).toMatchObject({ paso: 'mapa', area: 'mkt', grupo: 'distrito', elegido: true, hoja: null });
    // «Preguntas sobre la clase» sigue «Próximamente» (COI ya es una página: llegar desde ella deja «Volver a COI», ver abajo)
    expect(estadoInicial('?desde=central.distrito.preguntas&ver=grupos')).toMatchObject({ paso: 'grupos', explora: 'central', area: 'central', hoja: null });
  });

  it('llegar desde COI (central.distrito.coi) es llegar desde una página aparte: queda su `hoja` para el «Volver a COI»', () => {
    expect(estadoInicial('?desde=central.distrito.coi&ver=grupos')).toMatchObject({ paso: 'grupos', explora: 'central', area: 'central', hoja: 'coi' });
  });

  it('lo demás de la URL no estorba (?blotato=conectar viaja aparte)', () => {
    expect(estadoInicial('?blotato=conectar&desde=mkt.blotato.metricas&ver=grupos')).toMatchObject({ paso: 'grupos', hoja: 'metricas' });
  });

  it('el enlace viejo de las migas de las hojas (?desde=<lugar>&ver=…) se lee de vuelta tal cual, para cada pantalla del mapa', () => {
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

describe('esDobleClicAccidental · el segundo clic de un doble clic que cambió de paso (una ficha del mapa, la tarjeta de un grupo)', () => {
  it('se ignora un segundo clic (detail > 1) a menos de medio segundo del cambio de paso', () => {
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
