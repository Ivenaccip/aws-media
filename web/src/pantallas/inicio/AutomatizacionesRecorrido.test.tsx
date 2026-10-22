// Automatizaciones (dueño, 20-oct-2026): el área se enciende en el mapa con dos grupos —«Distrito» (Constructor, Asistente y «Actualizar flujos»,
// apagada) y «Tus automatizaciones» (sin pantallas)—. Aquí, lo que el mapa, el recorrido y la lista de pantallas hacen con ella: la ficha se abre,
// las opciones, el grupo vacío (el precedente es Deepseek), las migas, la entrada por ?desde=…&ver=… desde Constructor o Asistente (sus hojas son
// páginas aparte, con su propio encabezado como COI y la Biblioteca: sin `pagina` en el mapa), el doble clic y Esc. Los nombres NO llevan el prefijo
// `inicio.` (el de los invariantes del registro anti-pérdida: tests/test_migracion_ui.py): es una función nueva.
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MENU, buscar, detalleDeGrupo, lugarDePagina, urlDeInicio } from '../../marca/menu';
import { json, servidor, sinRed } from '../../prueba/servidor';
import { REPOSO, alEscape, areaDe, destinoDeVolver, estadoInicial, grupoDe, migasDe, reducir } from './estadoRecorrido';
import { Inicio } from './Inicio';
import { Pantallas } from './Pantallas';

function montar() {
  return servidor({
    '/api/proyectos': () => json([]),
    '/api/slots': () => json({ slots: null, activos: 0 }),
    '/api/imagenes': () => json({ total: 0, imagenes: [] }),
    '/api/edicion/proyectos': () => json([]),
    '/api/clip': () => json({ clips: [] }),
    '/api/blotato': () => sinRed(),
    '/api/moderar': () => json({ permitido: true }),
  });
}
let ir: ReturnType<typeof vi.fn<(url: string) => void>>;
beforeEach(() => {
  vi.unstubAllGlobals();
  montar();
  ir = vi.fn<(url: string) => void>();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  history.replaceState(null, '', '/estudio/inicio/');
});

const h2 = (n: string) => screen.getByRole('heading', { level: 2, name: n });
const ficha = (n: RegExp | string) => within(screen.getByRole('group', { name: 'Áreas' })).getByRole('button', { name: n });
const tarjetaDeGrupo = (area: string, grupo: string) => within(screen.getByRole('group', { name: area })).getByRole('button', { name: new RegExp(`^${grupo}`) });
const migaArea = (a: string) => screen.getByRole('button', { name: `Volver al mapa para cambiar de área (ahora: ${a})` });
const migaGrupo = (a: string, g: string) => screen.getByRole('button', { name: `Volver a las opciones de ${a} (ahora: ${g})` });
const lista = () => screen.getAllByRole('list').find(l => !l.closest('nav'))!;
const volveres = () => {
  const nombre = { name: /^Volver a (?!las opciones)/ };
  return [...screen.queryAllByRole('button', nombre), ...screen.queryAllByRole('link', nombre)];
};
const pintar = () => render(<Inicio ir={ir} />);

describe('menu · Automatizaciones', () => {
  const area = MENU.find(a => a.clave === 'automatizaciones')!;
  it('está encendida: sin proximamente, con dos grupos; Distrito con 3 pantallas (2 con href, 1 apagada) y «Tus automatizaciones» vacío', () => {
    expect(area.proximamente).toBeUndefined();
    expect(area.icono).toBe('rapido');
    expect(area.grupos.map(g => [g.clave, g.titulo, g.pantallas.length])).toEqual([
      ['distrito', 'Distrito', 3],
      ['tus', 'Tus automatizaciones', 0],
    ]);
    const [constructor, asistente, actualizar] = area.grupos[0]!.pantallas;
    expect([constructor?.href, asistente?.href]).toEqual(['/estudio/constructor/', '/estudio/asistente/']);
    expect(constructor?.texto).toBe('Arma tu flujo cuadro por cuadro y descárgalo para n8n.');
    expect(asistente?.texto).toBe('Cuéntanos qué quieres automatizar y te armamos el flujo.');
    expect(actualizar).toMatchObject({ titulo: 'Actualizar flujos', proximamente: true });
    expect(actualizar?.href).toBeUndefined();
    expect(detalleDeGrupo(area.grupos[0]!)).toBe('Constructor · Asistente · Actualizar flujos');
    expect(detalleDeGrupo(area.grupos[1]!)).toBe('Próximamente');
  });
  it('sus pantallas hoja no llevan `pagina` (como COI y la Biblioteca): lugarDePagina no las conoce y buscar sí', () => {
    expect(area.grupos[0]!.pantallas.every(p => p.pagina === undefined)).toBe(true);
    expect(lugarDePagina('constructor')).toBeNull();
    expect(buscar({ area: 'automatizaciones', grupo: 'distrito', pantalla: 'constructor' })?.pantalla.titulo).toBe('Constructor');
    // la clave de un grupo vacío no es un lugar: `buscar` exige una pantalla
    expect(buscar({ area: 'automatizaciones', grupo: 'tus', pantalla: 'x' })).toBeNull();
  });
  it('las migas de una hoja de Automatizaciones: el enlace del área abre el mapa y el del grupo las opciones, "desde" la hoja', () => {
    const l = { area: 'automatizaciones', grupo: 'distrito', pantalla: 'constructor' };
    expect(urlDeInicio(l, 'mapa')).toBe('/estudio/inicio/?desde=automatizaciones.distrito.constructor&ver=mapa');
  });
});

describe('estadoRecorrido · Automatizaciones', () => {
  it('elegirla abre sus opciones sin moverte de donde estabas ni elegir nada', () => {
    expect(areaDe('automatizaciones')?.proximamente).toBeUndefined();
    expect(reducir(REPOSO, { tipo: 'elegir-area', area: 'automatizaciones' })).toMatchObject({
      paso: 'grupos',
      explora: 'automatizaciones',
      area: 'mkt',
      grupo: 'distrito',
      elegido: false,
    });
  });
  it('Producto y Ventas siguen apagadas', () => {
    for (const clave of ['producto', 'ventas']) {
      expect(areaDe(clave)?.proximamente).toBe(true);
      expect(reducir(REPOSO, { tipo: 'elegir-area', area: clave })).toBe(REPOSO);
    }
  });
  it('«Tus automatizaciones» (grupo vacío) SÍ se elige: es el precedente de Deepseek', () => {
    const e = reducir(reducir(REPOSO, { tipo: 'elegir-area', area: 'automatizaciones' }), { tipo: 'elegir-grupo', area: 'automatizaciones', grupo: 'tus' });
    expect(e).toMatchObject({ paso: 'contenido', area: 'automatizaciones', grupo: 'tus', elegido: true, hoja: null });
    expect(migasDe(e).map(m => m.titulo)).toEqual(['Automatizaciones', 'Tus automatizaciones']);
    expect(alEscape(e)).toBeNull();
  });
  it('el grupo «distrito» de OTRA área no se elige en Automatizaciones y viceversa (la pareja área+grupo manda)', () => {
    expect(grupoDe('automatizaciones', 'distrito')).not.toBe(grupoDe('mkt', 'distrito'));
    expect(grupoDe('automatizaciones', 'blotato')).toBeUndefined();
    expect(grupoDe('mkt', 'tus')).toBeUndefined();
  });
  it('entrada desde Constructor: hoja = constructor (hay a dónde volver); desde «Actualizar flujos» (apagada) no', () => {
    expect(estadoInicial('?desde=automatizaciones.distrito.constructor&ver=mapa')).toEqual({
      paso: 'mapa',
      explora: 'automatizaciones',
      area: 'automatizaciones',
      grupo: 'distrito',
      elegido: true,
      hoja: 'constructor',
    });
    expect(destinoDeVolver(estadoInicial('?desde=automatizaciones.distrito.asistente&ver=grupos'))).toEqual({
      rotulo: 'Volver a Asistente',
      href: '/estudio/asistente/',
    });
    expect(estadoInicial('?desde=automatizaciones.distrito.actualizar&ver=grupos')).toMatchObject({ paso: 'grupos', hoja: null });
    // el grupo vacío no tiene pantallas: ningún `desde` válido apunta a él
    expect(estadoInicial('?desde=automatizaciones.tus.algo&ver=mapa')).toBe(REPOSO);
  });
});

describe('Pantallas · Automatizaciones', () => {
  const distrito = grupoDe('automatizaciones', 'distrito')!;
  const tus = grupoDe('automatizaciones', 'tus')!;
  it('Distrito: dos enlaces y una tarjeta «Próximamente» quieta; sin botón de conectar (no depende de Blotato) aunque Blotato no esté conectado', () => {
    render(<Pantallas grupo={distrito} conectado={false} alConectar={() => undefined} />);
    const filas = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(filas.map(f => f.querySelector('b')?.textContent)).toEqual(['Constructor', 'Asistente', 'Actualizar flujos']);
    expect(screen.queryAllByRole('link').map(a => a.getAttribute('href'))).toEqual(['/estudio/constructor/', '/estudio/asistente/']);
    for (const a of screen.getAllByRole('link')) expect(a).not.toHaveAttribute('aria-disabled');
    expect(filas[2]).toHaveTextContent('Próximamente');
    expect(filas[2]!.firstElementChild!.className.split(/\s+/)).toEqual(expect.arrayContaining(['bg-hundido', 'text-secundario']));
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('«Tus automatizaciones» dice que todavía no está disponible', () => {
    render(<Pantallas grupo={tus} conectado alConectar={() => undefined} />);
    expect(screen.getByText('Todavía no está disponible.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('Recorrido · Automatizaciones', () => {
  it('la ficha se abre: «Elige un grupo» con Distrito y Tus automatizaciones, y lo que trae cada uno', async () => {
    pintar();
    expect(ficha(/^Automatizaciones/)).not.toHaveAttribute('aria-disabled');
    expect(ficha(/^Automatizaciones/)).not.toHaveTextContent('Próximamente');
    await userEvent.click(ficha(/^Automatizaciones/));
    expect(h2('Elige un grupo')).toBeInTheDocument();
    const tarjetas = within(screen.getByRole('group', { name: 'Automatizaciones' })).getAllByRole('button');
    expect(tarjetas.map(t => t.querySelector('b')?.textContent)).toEqual(['Distrito', 'Tus automatizaciones']);
    expect(tarjetas[0]).toHaveTextContent('Constructor · Asistente · Actualizar flujos');
    expect(tarjetas[1]).toHaveTextContent('Próximamente');
    expect(screen.queryByText('Estás aquí')).toBeNull();
  });
  it('Distrito: lista con dos enlaces y una apagada; la miga del grupo y la del área suben de nivel; sin «Volver a …»', async () => {
    pintar();
    await userEvent.click(ficha(/^Automatizaciones/));
    await userEvent.click(tarjetaDeGrupo('Automatizaciones', 'Distrito'));
    expect(h2('Distrito')).toHaveFocus();
    expect(within(lista()).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual(['/estudio/constructor/', '/estudio/asistente/']);
    expect(screen.queryByText('Todavía no está disponible.')).toBeNull();
    expect(migaGrupo('Automatizaciones', 'Distrito')).toHaveAttribute('aria-current', 'step');
    expect(volveres()).toHaveLength(0);
    // la caja y lo de debajo siguen escondidos
    expect(screen.queryByRole('textbox', { name: '¿Qué vamos a crear hoy?' })).toBeNull();
    await userEvent.click(migaGrupo('Automatizaciones', 'Distrito'));
    expect(h2('Elige un grupo')).toBeInTheDocument();
    // ahora SÍ estás en Distrito de Automatizaciones: «Estás aquí» en SU Distrito, y no en el de Marketing
    expect(tarjetaDeGrupo('Automatizaciones', 'Distrito')).toHaveTextContent('Estás aquí');
    await userEvent.click(migaArea('Automatizaciones'));
    await userEvent.click(ficha(/^Marketing/));
    expect(screen.queryByText('Estás aquí')).toBeNull(); // el «Distrito» de Marketing NO se marca: ahí no estás
  });
  it('«Tus automatizaciones»: «Todavía no está disponible.» bajo su título, Esc no hace nada en el contenido', async () => {
    pintar();
    await userEvent.click(ficha(/^Automatizaciones/));
    await userEvent.click(tarjetaDeGrupo('Automatizaciones', 'Tus automatizaciones'));
    expect(h2('Tus automatizaciones')).toBeInTheDocument();
    expect(screen.getByText('Todavía no está disponible.')).toBeInTheDocument();
    expect(screen.getAllByRole('list').filter(l => !l.closest('nav'))).toHaveLength(0); // sin lista de pantallas (las migas son otra lista)
    await userEvent.keyboard('{Escape}');
    expect(h2('Tus automatizaciones')).toBeInTheDocument();
    await userEvent.click(migaGrupo('Automatizaciones', 'Tus automatizaciones'));
    expect(tarjetaDeGrupo('Automatizaciones', 'Tus automatizaciones')).toHaveTextContent('Estás aquí');
  });
  it('Esc en sus opciones sube al mapa', async () => {
    pintar();
    await userEvent.click(ficha(/^Automatizaciones/));
    await userEvent.keyboard('{Escape}');
    expect(h2('Elige un área')).toBeInTheDocument();
  });
  it('el orden de Tab: en las opciones de Automatizaciones, la miga y sus dos tarjetas', async () => {
    pintar();
    await userEvent.click(ficha(/^Automatizaciones/));
    const region = screen.getByRole('region', { name: 'Irremplazables' });
    const enOrden = Array.from(region.querySelectorAll<HTMLElement>('button, a[href], input, textarea, [tabindex="0"]'))
      .filter(el => !el.closest('[hidden]'))
      .map(el => el.querySelector('b')?.textContent ?? el.querySelector('span')?.textContent ?? el.textContent);
    expect(enOrden).toEqual(['Automatizaciones', 'Distrito', 'Tus automatizaciones']);
  });
  it('llegar desde Constructor con ver=mapa: "Volver a Constructor" es un ENLACE, Esc navega a él, y Automatizaciones sigue abierta', () => {
    history.replaceState(null, '', '/estudio/inicio/?desde=automatizaciones.distrito.constructor&ver=mapa');
    pintar();
    expect(h2('Elige un área')).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Volver a Constructor' })).toHaveAttribute('href', '/estudio/constructor/');
    expect(ficha(/^Automatizaciones/)).not.toHaveAttribute('aria-disabled');
  });
  it('llegar desde Asistente con ver=grupos: abre las opciones de Automatizaciones con «Estás aquí» en Distrito', () => {
    history.replaceState(null, '', '/estudio/inicio/?desde=automatizaciones.distrito.asistente&ver=grupos');
    pintar();
    expect(h2('Elige un grupo')).toHaveFocus();
    expect(tarjetaDeGrupo('Automatizaciones', 'Distrito')).toHaveTextContent('Estás aquí');
    expect(screen.getByRole('link', { name: 'Volver a Asistente' })).toBeInTheDocument();
  });
  it('Producto y Ventas siguen sin abrir nada', async () => {
    pintar();
    for (const nombre of ['Producto', 'Ventas']) {
      await userEvent.click(ficha(new RegExp(`^${nombre}`)));
      expect(h2('Elige un área')).toBeInTheDocument();
    }
  });
});

describe('exhaustivo · todos los lugares con pantalla (incluye Automatizaciones)', () => {
  it('cada urlDeInicio de cada pantalla de menu.ts se lee de vuelta', () => {
    const LUGARES = MENU.flatMap(a => a.grupos.flatMap(g => g.pantallas.map(p => ({ area: a.clave, grupo: g.clave, pantalla: p.clave }))));
    expect(LUGARES.filter(l => l.area === 'automatizaciones')).toHaveLength(3);
    for (const l of LUGARES) for (const ver of ['mapa', 'grupos'] as const) {
      const e = estadoInicial(new URL(urlDeInicio(l, ver), 'http://x').search);
      expect(e).toMatchObject({ paso: ver, explora: l.area, area: l.area, grupo: l.grupo });
    }
  });
});

describe('Recorrido · Automatizaciones · doble clic y Esc con la hoja de por medio', () => {
  it('el segundo clic de un doble clic en «Distrito» no activa «Constructor» (el primer enlace de la lista) ni navega', async () => {
    pintar();
    fireEvent.click(ficha(/^Automatizaciones/), { detail: 1 });
    fireEvent.click(tarjetaDeGrupo('Automatizaciones', 'Distrito'), { detail: 1 });
    expect(h2('Distrito')).toBeInTheDocument();
    const primera = within(lista()).getAllByRole('link')[0]!;
    expect(fireEvent.click(primera, { detail: 2 })).toBe(false); // cancelado en la captura de la región
    expect(ir).not.toHaveBeenCalled();
  });
  it('Esc con Constructor de por medio (ver=grupos) navega a /estudio/constructor/', async () => {
    history.replaceState(null, '', '/estudio/inicio/?desde=automatizaciones.distrito.constructor&ver=grupos');
    pintar();
    await userEvent.keyboard('{Escape}');
    expect(ir).toHaveBeenCalledExactlyOnceWith('/estudio/constructor/');
  });
  it('elegir otro grupo olvida la hoja: ya no hay «Volver a Constructor»', async () => {
    history.replaceState(null, '', '/estudio/inicio/?desde=automatizaciones.distrito.constructor&ver=grupos');
    pintar();
    await userEvent.click(tarjetaDeGrupo('Automatizaciones', 'Tus automatizaciones'));
    expect(volveres()).toHaveLength(0);
  });
  it('desde «Actualizar flujos» (apagada, sin href) no hay a dónde volver y Esc sube al mapa', async () => {
    history.replaceState(null, '', '/estudio/inicio/?desde=automatizaciones.distrito.actualizar&ver=grupos');
    pintar();
    expect(volveres()).toHaveLength(0);
    await userEvent.keyboard('{Escape}');
    expect(h2('Elige un área')).toBeInTheDocument();
    expect(ir).not.toHaveBeenCalled();
  });
});
