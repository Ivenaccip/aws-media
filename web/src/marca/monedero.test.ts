// UI·19 — static/monedero.js, el de verdad, corriendo en jsdom. Es un script
// clásico sin exports (lo cargan también las pantallas viejas): se lee como
// texto y se ejecuta; lo público es window.monedero, el evento 'monedero' y
// lo que pinta. La etapa web del Dockerfile lo copia para que esto corra ahí.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// new URL(…, import.meta.url) no sirve aquí: el URL global es el de jsdom
const CODIGO = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../static/monedero.js'), 'utf8');

let saldo: number | null;
let activo: boolean;
let colgado: boolean;

function cargar() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      colgado
        ? new Promise<Response>(() => undefined)
        : Promise.resolve(new Response(JSON.stringify({ activo, saldo, tarifas: {}, packs: [] }))),
    ),
  );
  new Function(CODIGO)();
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const cifra = () => $('#mon-cifra').style.getPropertyValue('--mon-saldo');
const tenida = () => $('#mon-pill').classList.contains('mon-tinte');

async function llega(nuevo: number) {
  saldo = nuevo;
  window.monedero!.refrescar();
  await vi.waitFor(() => expect($('#mon-real').textContent).toBe(nuevo + ' créditos ✦'));
}

function cobro(detalle: unknown) {
  window.dispatchEvent(new CustomEvent('cobro', { detail: detalle }));
}

beforeEach(() => {
  saldo = 120;
  activo = true;
  colgado = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.head.replaceChildren();
  delete window.monedero;
});

describe('el saldo rueda', () => {
  it('la primera carga no rueda, no tiñe y no se anuncia', async () => {
    cargar();
    await vi.waitFor(() => expect($('#mon-real').textContent).toBe('120 créditos ✦'));
    expect(cifra()).toBe('120');
    expect(tenida()).toBe(false);
    expect($('#mon-aviso').textContent).toBe('');
    // la transición vuelve a ser la de la hoja: la próxima vez sí rueda
    expect($('#mon-cifra').style.transition).toBe('');
  });

  it('un saldo menor rueda hasta el nuevo, tiñe la píldora y se anuncia al instante', async () => {
    cargar();
    await vi.waitFor(() => expect(cifra()).toBe('120'));
    vi.useFakeTimers();
    await llega(108);
    expect(cifra()).toBe('108');
    expect($('#mon-aviso').textContent).toBe('Tu saldo: 108 créditos');
    expect($('#mon-aviso')).toHaveAttribute('role', 'status');
    expect(tenida()).toBe(true);
    vi.advanceTimersByTime(900);
    expect(tenida()).toBe(false);
  });

  it('una recarga (sube) también rueda', async () => {
    cargar();
    await vi.waitFor(() => expect(cifra()).toBe('120'));
    await llega(620);
    expect(cifra()).toBe('620');
    expect(tenida()).toBe(true);
  });

  it('el mismo saldo otra vez no hace nada', async () => {
    cargar();
    await vi.waitFor(() => expect(cifra()).toBe('120'));
    window.monedero!.refrescar();
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(tenida()).toBe(false);
    expect($('#mon-aviso').textContent).toBe('');
  });

  it('lo que se ve no se lee; lo que se lee es el número real', async () => {
    cargar();
    await vi.waitFor(() => expect(cifra()).toBe('120'));
    expect($('#mon-cifra')).toHaveAttribute('aria-hidden', 'true');
    expect($('#mon-saldo').textContent).toBe('120 créditos ✦');
  });

  it('registra --mon-saldo como entero (así el navegador sabe interpolarlo)', () => {
    const registerProperty = vi.fn();
    vi.stubGlobal('CSS', { registerProperty });
    cargar();
    expect(registerProperty).toHaveBeenCalledWith({ name: '--mon-saldo', syntax: '<integer>', inherits: false, initialValue: '0' });
  });

  it('sin CSS.registerProperty carga igual (el número cambia de golpe)', async () => {
    vi.stubGlobal('CSS', undefined);
    cargar();
    await vi.waitFor(() => expect(cifra()).toBe('120'));
  });

  it('con «reducir movimiento» la hoja propia lo deja quieto (las viejas no cargan tokens.css)', () => {
    cargar();
    const hoja = [...document.querySelectorAll('style')].map(s => s.textContent).join('');
    expect(hoja).toContain('@media (prefers-reduced-motion: reduce){#mon-cifra{transition:none}');
    expect(hoja).toContain('#mon-pill.mon-tinte{animation:none}');
  });

  it('antes del primer saldo la píldora no se ve: counter() diría «0 créditos»', () => {
    colgado = true;
    cargar();
    // jsdom no lee `display` de ese cssText (se atraganta antes); el atributo
    // sí lo trae, y e2e/saldo.spec.ts lo mira en un navegador de verdad
    expect($('#mon-pill').getAttribute('style')).toContain('display:none;');
    expect($('#mon-ticket').getAttribute('style')).toContain('display:none;');
  });

  it('lo guardado por UI·18 cuenta como pintado: si el servidor trae otro, rueda', async () => {
    sessionStorage.setItem('monedero:ultimo', JSON.stringify({ quien: '', saldo: 200, sesion: false }));
    colgado = true;
    cargar();
    expect(cifra()).toBe('200');
    expect(tenida()).toBe(false);
    colgado = false;
    await llega(120);
    expect(cifra()).toBe('120');
    expect($('#mon-aviso').textContent).toBe('Tu saldo: 120 créditos');
  });

  it('si el monedero resulta apagado, la píldora guardada se esconde y se olvida', async () => {
    sessionStorage.setItem('monedero:ultimo', JSON.stringify({ quien: '', saldo: 200, sesion: false }));
    activo = false;
    cargar();
    await vi.waitFor(() => expect($('#mon-pill').style.display).toBe('none'));
    expect(sessionStorage.getItem('monedero:ultimo')).toBeNull();
  });
});

describe('el «−N» que vuela', () => {
  const RECT = { x: 10, y: 400, ancho: 120, alto: 48 };
  const vuelo = () => document.querySelector<HTMLElement>('.mon-vuelo');

  it('sale del botón hacia la píldora, no se lee, y se va al terminar', async () => {
    cargar();
    await vi.waitFor(() => expect(cifra()).toBe('120'));
    cobro({ costo: 12, rect: RECT });
    const n = vuelo()!;
    expect(n.textContent).toBe('−12');
    expect(n).toHaveAttribute('aria-hidden', 'true');
    expect(n.style.left).toBe('70px');
    expect(n.style.top).toBe('424px');
    expect(n.style.getPropertyValue('--dx')).toMatch(/px$/);
    expect($('#monedero').contains(n)).toBe(false); // a <body>, fuera de la píldora con nombre
    n.dispatchEvent(new Event('animationend'));
    expect(vuelo()).toBeNull();
  });

  it('si la animación no llega a correr, se quita solo', async () => {
    cargar();
    await vi.waitFor(() => expect(cifra()).toBe('120'));
    vi.useFakeTimers();
    cobro({ costo: 12, rect: RECT });
    expect(vuelo()).not.toBeNull();
    vi.advanceTimersByTime(1000);
    expect(vuelo()).toBeNull();
  });

  it('con «reducir movimiento» no vuela nada (el saldo ya se anuncia)', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
    cargar();
    await vi.waitFor(() => expect(cifra()).toBe('120'));
    cobro({ costo: 12, rect: RECT });
    expect(vuelo()).toBeNull();
  });

  it('nada que volar sin saldo pintado, sin costo o sin botón', async () => {
    colgado = true;
    cargar();
    cobro({ costo: 12, rect: RECT });
    expect(vuelo()).toBeNull();
    document.body.replaceChildren();
    colgado = false;
    cargar();
    await vi.waitFor(() => expect(cifra()).toBe('120'));
    for (const d of [{ costo: 0, rect: RECT }, { costo: -5, rect: RECT }, { costo: 'x', rect: RECT }, { costo: 12, rect: null }, null]) {
      cobro(d);
    }
    expect(vuelo()).toBeNull();
  });
});
