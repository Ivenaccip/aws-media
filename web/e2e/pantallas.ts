import { readdirSync } from 'node:fs';

import type { Page } from '@playwright/test';

// Las pantallas del estudio en React (UI·8), leídas de web/estudio/: una
// pantalla nueva entra sola al guardián de «reducir movimiento». La vitrina
// (_vitrina) no cuenta: es interna.
export const PANTALLAS: readonly string[] = readdirSync(new URL('../estudio/', import.meta.url), { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('_'))
  .map(d => d.name)
  .sort();

// Lo que el navegador todavía está moviendo: animaciones CSS, transiciones y
// las de Element.animate(). Las de JS NO obedecen la regla global de
// tokens.css (esa regla solo acorta las de CSS): si alguien anima con
// .animate() sin preguntar por prefers-reduced-motion, aparece aquí. Las que
// la regla dejó en 0.01 ms pueden seguir «running» un instante: no cuentan.
export function animacionesVivas(): { nombre: string; duracion: string; objetivo: string }[] {
  return document.getAnimations()
    .filter(a => {
      const duracion = a.effect?.getComputedTiming().duration;
      return a.playState === 'running' && !(typeof duracion === 'number' && duracion <= 1);
    })
    .map(a => {
      const efecto = a.effect as KeyframeEffect | null;
      const objetivo = efecto?.target;
      const nombre = 'animationName' in a ? String(a.animationName)
        : 'transitionProperty' in a ? `transición de ${String(a.transitionProperty)}`
          : 'Element.animate()';
      return {
        nombre,
        duracion: String(efecto?.getComputedTiming().duration),
        objetivo: objetivo instanceof Element
          ? objetivo.tagName.toLowerCase() + (objetivo.id ? '#' + objetivo.id : '') +
            (typeof objetivo.className === 'string' && objetivo.className ? '.' + objetivo.className.trim().split(/\s+/).slice(0, 3).join('.') : '')
          : String(objetivo),
      };
    });
}

// Lo que ARRANCA, no lo que sigue corriendo: una animación de 100 ms ya
// terminó cuando una prueba lenta la busca en getAnimations(). Se oyen
// animationstart y transitionstart desde antes de cargar y se anota
// «nombre duración-en-ms» (las transiciones: «transición de <propiedad>»).
// Lo que esté en congelarArranques() se queda quieto en su primer cuadro,
// para medirlo a mano sin prisa.
export async function oirArranques(page: Page, nombres: RegExp) {
  await page.addInitScript((fuente: string) => {
    const re = new RegExp(fuente);
    const w = window as unknown as { __arranques: string[]; __congelar: string[] };
    w.__arranques = [];
    w.__congelar = [];
    const nombreDe = (a: Animation) =>
      'animationName' in a ? String(a.animationName) : `transición de ${String((a as CSSTransition).transitionProperty)}`;
    function anotar(objetivo: Element, pseudo: string, clave: string, animacion: boolean) {
      const nombre = animacion ? clave : `transición de ${clave}`;
      if (!re.test(nombre)) return;
      const cs = getComputedStyle(objetivo, pseudo || null);
      const lista = (animacion ? cs.animationName : cs.transitionProperty).split(',').map(s => s.trim());
      const duraciones = (animacion ? cs.animationDuration : cs.transitionDuration).split(',');
      const d = duraciones[Math.max(0, lista.indexOf(clave)) % duraciones.length]!;
      w.__arranques.push(`${nombre} ${Math.round(parseFloat(d) * 1000)}`);
      if (!w.__congelar.includes(nombre)) return;
      for (const a of objetivo.getAnimations({ subtree: true })) {
        const e = a.effect as KeyframeEffect | null;
        if (e?.target !== objetivo || (e.pseudoElement ?? '') !== pseudo) continue;
        if (nombreDe(a) === nombre && a.playState === 'running') {
          a.pause();
          a.currentTime = 0;
        }
      }
    }
    document.addEventListener('animationstart', e => anotar(e.target as Element, e.pseudoElement, e.animationName, true), true);
    document.addEventListener('transitionstart', e => anotar(e.target as Element, e.pseudoElement, e.propertyName, false), true);
  }, nombres.source);
}

/** Lo que se congela en su primer cuadro de aquí en adelante (nada, sin nombres). */
export const congelarArranques = (page: Page, ...nombres: string[]) =>
  page.evaluate(n => { (window as unknown as { __congelar: string[] }).__congelar = n; }, nombres);

/** Lo que arrancó hasta ahora (sin borrarlo): para expect.poll. */
export const arranques = (page: Page) =>
  page.evaluate(() => [...(window as unknown as { __arranques: string[] }).__arranques]);

/** Empieza la cuenta de nuevo, dos cuadros después (el animationstart de lo
 *  que ya pasó se despacha en el siguiente cuadro). */
export const olvidarArranques = (page: Page) =>
  page.evaluate(async () => {
    for (let i = 0; i < 2; i++) await new Promise(r => requestAnimationFrame(r));
    (window as unknown as { __arranques: string[] }).__arranques.length = 0;
  });

// Lo que anima cada View Transition de una sola pantalla, fotografiado en su
// `ready`: duran 180–300 ms y muestrear desde fuera llega tarde en una
// máquina cargada. «pseudo-elemento keyframes», una lista por transición.
export async function grabarTransiciones(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __vts: string[][] };
    w.__vts = [];
    const original = document.startViewTransition?.bind(document);
    if (!original) return;
    document.startViewTransition = ((o: StartViewTransitionOptions) => {
      const vt = original(o);
      vt.ready
        .then(() => {
          w.__vts.push(document.getAnimations().map(a => {
            const e = a.effect as KeyframeEffect | null;
            return `${e?.pseudoElement ?? ''} ${'animationName' in a ? String(a.animationName) : ''}`.trim();
          }));
        })
        .catch(() => undefined);
      return vt;
    }) as typeof document.startViewTransition;
  });
}
export const ultimaTransicion = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vts: string[][] }).__vts.at(-1) ?? []);
export const cuantasTransiciones = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vts: string[][] }).__vts.length);
