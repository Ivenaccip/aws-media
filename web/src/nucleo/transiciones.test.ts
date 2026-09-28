// UI·18 — la miniatura que viaja del inicio a su película. jsdom no tiene
// View Transitions: los eventos pageswap/pagereveal se disparan a mano, con
// y sin `viewTransition`, que es lo que decide si hay nombre o no.
import { act, render, screen } from '@testing-library/react';
import { createElement, useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { quitarVT, simularVT } from '../prueba/transicion';
import {
  miniaturaQueLlega,
  NOMBRE_MINIATURA,
  nombreVT,
  olvidarMiniatura,
  tocarMiniatura,
  transicionar,
  trasLaLlegada,
} from './transiciones';

function evento(tipo: 'pageswap' | 'pagereveal', conTransicion: boolean) {
  const e = new Event(tipo);
  Object.defineProperty(e, 'viewTransition', { value: conTransicion ? {} : null });
  dispatchEvent(e);
}

function imagen() {
  const img = document.createElement('img');
  document.body.append(img);
  return img;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('tocarMiniatura / miniaturaQueLlega', () => {
  it('la película que se abre recibe la miniatura que se tocó, con su proporción', () => {
    const img = imagen();
    Object.defineProperties(img, { naturalWidth: { value: 1280 }, naturalHeight: { value: 720 } });
    tocarMiniatura('p1', '/api/proyectos/p1/archivo/portada.jpg', img);
    expect(miniaturaQueLlega('p1')).toEqual({ src: '/api/proyectos/p1/archivo/portada.jpg', proporcion: 1280 / 720 });
  });

  it('sin imagen cargada viaja sin proporción (la pantalla nueva pone 16:9)', () => {
    tocarMiniatura('p1', '/api/a.jpg', imagen());
    expect(miniaturaQueLlega('p1')).toEqual({ src: '/api/a.jpg', proporcion: null });
  });

  it('otra película, o ninguna, no recibe nada', () => {
    tocarMiniatura('p1', '/api/a.jpg', null);
    expect(miniaturaQueLlega('p2')).toBeNull();
    expect(miniaturaQueLlega(null)).toBeNull();
  });

  it('una pista vieja no vale: no viene del clic de hace un momento', () => {
    vi.useFakeTimers();
    tocarMiniatura('p1', '/api/a.jpg', null);
    vi.advanceTimersByTime(10_001);
    expect(miniaturaQueLlega('p1')).toBeNull();
  });

  it('leer no borra (StrictMode lee dos veces); olvidar sí', () => {
    tocarMiniatura('p1', '/api/a.jpg', null);
    expect(miniaturaQueLlega('p1')?.src).toBe('/api/a.jpg');
    expect(miniaturaQueLlega('p1')?.src).toBe('/api/a.jpg');
    olvidarMiniatura();
    expect(miniaturaQueLlega('p1')).toBeNull();
  });

  it('una pista rota en sessionStorage no rompe la pantalla', () => {
    sessionStorage.setItem('vt:miniatura', '{no es json');
    expect(miniaturaQueLlega('p1')).toBeNull();
    sessionStorage.setItem('vt:miniatura', JSON.stringify({ id: 'p1', src: 5, t: Date.now() }));
    expect(miniaturaQueLlega('p1')).toBeNull();
    // solo direcciones de la API, nunca otra cosa que alguien dejó ahí
    sessionStorage.setItem('vt:miniatura', JSON.stringify({ id: 'p1', src: 'https://otro.sitio/x.jpg', t: Date.now() }));
    expect(miniaturaQueLlega('p1')).toBeNull();
  });
});

describe('el nombre de la miniatura', () => {
  it('se le pone SOLO a la tocada, y solo si el navegador hace la transición', () => {
    const tocada = imagen();
    const otra = imagen();
    tocarMiniatura('p1', '/api/a.jpg', tocada);
    evento('pageswap', true);
    expect(tocada.style.viewTransitionName).toBe(NOMBRE_MINIATURA);
    expect(otra.style.viewTransitionName).toBe('');
  });

  it('sin transición (navegador sin soporte o movimiento reducido) no se nombra', () => {
    const tocada = imagen();
    tocarMiniatura('p1', '/api/a.jpg', tocada);
    evento('pageswap', false);
    expect(tocada.style.viewTransitionName).toBe('');
  });

  it('al volver con «atrás» se le quita, para no repetir nombre', () => {
    const tocada = imagen();
    tocarMiniatura('p1', '/api/a.jpg', tocada);
    evento('pageswap', true);
    evento('pagereveal', true);
    expect(tocada.style.viewTransitionName).toBe('');
  });

  it('un clic que no terminó en navegación no deja nombre para el siguiente', () => {
    const primera = imagen();
    const segunda = imagen();
    tocarMiniatura('p1', '/api/a.jpg', primera);
    tocarMiniatura('p2', '/api/b.jpg', segunda);
    evento('pageswap', true);
    expect(primera.style.viewTransitionName).toBe('');
    expect(segunda.style.viewTransitionName).toBe(NOMBRE_MINIATURA);
    expect(miniaturaQueLlega('p2')?.src).toBe('/api/b.jpg');
  });
});

describe('trasLaLlegada', () => {
  it('sin transición (jsdom, o un navegador sin ellas) se cumple sola', async () => {
    await expect(trasLaLlegada()).resolves.toBeUndefined();
  });
});

// ── UI·21: transicionar() y nombreVT() ────────────────────────────────────

/** Un texto con estado: el test lo cambia desde fuera, dentro del `cambio`. */
function Texto({ exponer }: { exponer: (poner: (t: string) => void) => void }) {
  const [texto, setTexto] = useState('viejo');
  useEffect(() => exponer(setTexto), [exponer]);
  return createElement('p', { 'data-testid': 'texto' }, texto);
}

/** Un matchMedia de mentira: solo «reducir movimiento» puede coincidir. */
function ponerReducir(reduce: boolean) {
  const mm = vi.fn((q: string) => ({ matches: reduce && q === '(prefers-reduced-motion: reduce)', media: q }));
  vi.stubGlobal('matchMedia', mm);
  return mm;
}

describe('UI·21 · transicionar', () => {
  afterEach(() => {
    quitarVT();
    Reflect.deleteProperty(document, 'hidden'); // vuelve el getter de jsdom
  });

  it('sin startViewTransition (jsdom, un navegador viejo) el cambio corre al instante y devuelve null', () => {
    const cambio = vi.fn();
    expect(transicionar(cambio, ['reordenar'])).toBeNull();
    expect(cambio).toHaveBeenCalledOnce();
  });

  it('con «reducir movimiento» va al instante aunque haya soporte', () => {
    const vt = simularVT();
    const mm = ponerReducir(true);
    const cambio = vi.fn();
    expect(transicionar(cambio, ['reordenar'])).toBeNull();
    expect(cambio).toHaveBeenCalledOnce();
    expect(vt.espia).not.toHaveBeenCalled();
    expect(mm).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('con la pestaña oculta va al instante (nadie mira y el navegador la saltaría)', () => {
    const vt = simularVT();
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    const cambio = vi.fn();
    expect(transicionar(cambio, ['reordenar'])).toBeNull();
    expect(cambio).toHaveBeenCalledOnce();
    expect(vt.espia).not.toHaveBeenCalled();
  });

  it('sin soporte de tipos (Chrome 111-124: solo acepta una función) va al instante', () => {
    const vt = simularVT({ sinTipos: true });
    const cambio = vi.fn();
    expect(transicionar(cambio, ['reordenar'])).toBeNull();
    expect(cambio).toHaveBeenCalledOnce();
    expect(vt.espia).not.toHaveBeenCalled();
  });

  it('con soporte va dentro de la transición con sus tipos, y el DOM ya está pintado cuando update vuelve (flushSync)', () => {
    let poner!: (t: string) => void;
    const alVolver: string[] = [];
    const vt = simularVT({ trasUpdate: () => alVolver.push(screen.getByTestId('texto').textContent ?? '') });
    ponerReducir(false);
    render(createElement(Texto, { exponer: p => (poner = p) }));
    let devuelta: ViewTransition | null = null;
    act(() => {
      devuelta = transicionar(() => poner('nuevo'), ['reordenar']);
    });
    expect(vt.espia).toHaveBeenCalledOnce();
    expect(vt.espia).toHaveBeenCalledWith(expect.objectContaining({ types: ['reordenar'] }));
    expect(devuelta).not.toBeNull();
    // dentro de act, sin flushSync React lo dejaría para el final: aquí diría «viejo»
    expect(alVolver).toEqual(['nuevo']);
    expect(screen.getByTestId('texto')).toHaveTextContent('nuevo');
  });

  it('los tipos se copian: cambiar el arreglo después no toca la transición', () => {
    const vt = simularVT();
    const tipos = ['reordenar'];
    transicionar(() => undefined, tipos);
    tipos.push('otro');
    expect(vt.tipos).toEqual([['reordenar']]);
  });

  it('si la transición se salta (ready, finished y updateCallbackDone rechazados), no queda ningún rechazo sin atender', async () => {
    const sueltos: unknown[] = [];
    const oir = (razon: unknown) => void sueltos.push(razon);
    process.on('unhandledRejection', oir);
    try {
      simularVT({ saltada: true });
      const cambio = vi.fn();
      expect(transicionar(cambio, ['reordenar'])).not.toBeNull();
      // el cambio corre igual: saltarse la animación no se salta los datos
      expect(cambio).toHaveBeenCalledOnce();
      await new Promise(listo => setTimeout(listo, 0));
      expect(sueltos).toEqual([]);
    } finally {
      process.off('unhandledRejection', oir);
    }
  });
});

describe('UI·21 · nombreVT', () => {
  const VALIDO = /^[A-Za-z][A-Za-z0-9_-]*$/;

  it('lo que ya es [A-Za-z0-9-] pasa tal cual, con su prefijo', () => {
    expect(nombreVT('perfil', 'ig-AbC')).toBe('perfil-ig-AbC');
  });

  it('un «.» de un id de cuenta va como _2e_', () => {
    expect(nombreVT('cuenta', 'in-la.cuenta')).toBe('cuenta-in-la_2e_cuenta');
  });

  it('«a_b» y «a.b» no chocan: el «_» también se escapa', () => {
    expect(nombreVT('x', 'a_b')).not.toBe(nombreVT('x', 'a.b'));
    expect(nombreVT('x', 'a_b')).toBe('x-a_5f_b');
  });

  it('siempre es un nombre válido, con ids raros también', () => {
    const ids = ['ig-AbC', 'in-la.cuenta', 'a_b', 'a b', 'ñandú', '🙂', '1abc', '_', '--', '', 'a/b?c=d#e', 'x_2e_y'];
    for (const id of ids) expect(nombreVT('perfil', id)).toMatch(VALIDO);
    // y distintos entre sí
    expect(new Set(ids.map(id => nombreVT('perfil', id))).size).toBe(ids.length);
  });
});
