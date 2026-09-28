// UI·18 — la miniatura que viaja del inicio a su película. jsdom no tiene
// View Transitions: los eventos pageswap/pagereveal se disparan a mano, con
// y sin `viewTransition`, que es lo que decide si hay nombre o no.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { miniaturaQueLlega, NOMBRE_MINIATURA, olvidarMiniatura, tocarMiniatura, trasLaLlegada } from './transiciones';

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
