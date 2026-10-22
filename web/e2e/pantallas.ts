import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

// Las carpetas de web/estudio/ con página, a cualquier profundidad y no solo en el primer nivel, como rutas relativas con «/»:
// «inicio», «agenda», «marketing/distrito/imagen» (lo que va entre `/estudio/` y la barra final de la dirección).
// Una carpeta sin index.html no es pantalla (solo agrupa a otras); las que empiezan por «_» (la vitrina, cualquier `_borrador`) son
// internas y no cuentan, ni ellas ni lo que cuelga de ellas (server/web.py las marca igual, tramo por tramo).
function carpetasConPagina(raiz: string, rel: string[] = []): string[] {
  const aqui = join(raiz, ...rel);
  const propia = rel.length > 0 && existsSync(join(aqui, 'index.html')) ? [rel.join('/')] : [];
  return propia.concat(
    readdirSync(aqui, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('_'))
      .flatMap(d => carpetasConPagina(raiz, [...rel, d.name])),
  );
}

// Las pantallas del estudio en React (UI·8), leídas de web/estudio/: una pantalla nueva —o una página de nivel (rutas por nivel:
// /estudio/marketing/, /estudio/marketing/distrito/imagen/…)— entra sola al guardián de «reducir movimiento»; una hoja que se muda a su
// dirección anidada (E7 de las rutas por nivel) tampoco se pierde de vista. `movimiento-reducido.spec.ts` las abre en `/estudio/${pantalla}/`.
//
// La PRINCIPAL (web/estudio/index.html, el mapa en /estudio/) NO está aquí a propósito: no es una carpeta hija (su ruta relativa sería
// la cadena vacía y `/estudio/${''}/` da «//»). Su código es el de cualquier otra página de nivel (`niveles/nivel.tsx`), que ya recorren
// «marketing», «central»…; la prueba de «reducir movimiento» del mapa mismo vive en niveles.spec.ts, que la abre por `URL_MAPA`.
export const PANTALLAS: readonly string[] = carpetasConPagina(fileURLToPath(new URL('../estudio/', import.meta.url))).sort();

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

/**
 * ¿La pista de un chip (el `::after` de `data-pista`, que cuelga FUERA del botón, encima de él) se PINTA de verdad?
 * `getComputedStyle(chip, '::after')` dice «visible, opacidad 1» aunque un `overflow-hidden` del propio botón recorte el
 * globo (así estuvo en Imagen, Video y Edición, sin que nada lo notara): el estilo calculado no ve el recorte. Se compara
 * la franja de pantalla justo encima del chip con el ratón lejos y con el ratón encima; si son idénticas, no se ve nada.
 * Si hay más de un chip, `chip` ya debe ser uno solo.
 */
export async function pistaSePinta(page: Page, chip: Locator): Promise<boolean> {
  await chip.scrollIntoViewIfNeeded();
  const caja = (await chip.boundingBox())!;
  const ancho = page.viewportSize()!.width;
  const y = Math.max(0, caja.y - 110);
  // termina 4 px antes del chip: su borde cambia con el ratón encima y no debe contar como «pista»
  const franja = { x: 0, y, width: ancho, height: Math.max(1, caja.y - 4 - y) };
  await page.mouse.move(0, 0);
  await chip.evaluate(e => (e as HTMLElement).blur());
  const sin = await page.screenshot({ clip: franja });
  await chip.hover();
  // la pista aparece con una transición de opacidad corta: se espera a que llegue a 1
  for (let i = 0; i < 40; i++) {
    if ((await chip.evaluate(e => getComputedStyle(e, '::after').opacity)) === '1') break;
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(50);
  const con = await page.screenshot({ clip: franja });
  return !sin.equals(con);
}
