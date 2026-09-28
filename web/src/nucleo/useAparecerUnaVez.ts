// UI·23 — «la primera vez que entra en pantalla». Le pone `data-entra` al
// elemento UNA sola vez por clave y por pestaña, y el CSS anima solo lo que
// lleva esa marca. Sin ella —sin JS todavía, en jsdom, con «reducir
// movimiento», al volver con el scroll— se ve el estado FINAL: nada arranca
// invisible, y una captura o un lector que no hace scroll lo ve entero.
//
// Cuándo se pone:
//   · si ya está a la vista al montarse (se abrió con un clic), en el layout
//     effect, ANTES de pintar. El IntersectionObserver avisa un cuadro tarde:
//     se vería completo, luego vacío y luego creciendo;
//   · si no, cuando el IntersectionObserver lo ve llegar, con un margen para
//     que la marca se ponga justo antes de que asome.
// Se quita cuando termina la animación del hijo que lleva `data-final` (lo
// último que se mueve): así un hijo que llegue después, con la gráfica ya
// dibujada, no crece solo.
//
// Se descartó animation-timeline: view(): se desanda al hacer scroll hacia
// atrás y se repite cada vez que vuelve a entrar.
//
// La marca es un atributo del DOM y no estado de React: no provoca otro
// render, y React no la pisa porque no la conoce.
import { useLayoutEffect, type RefObject } from 'react';

// lo que ya entró en esta pestaña; una navegación completa lo olvida
const vistas = new Set<string>();

/** Para las pruebas: todo vuelve a «nunca visto». */
export function olvidarApariciones(): void {
  vistas.clear();
}

// cuánto antes de asomar se pone la marca: más que lo que avanza la página en
// un cuadro de scroll, para que el primer cuadro visible ya sea el del arranque
const MARGEN_PX = 48;

// jsdom no tiene matchMedia (ni IntersectionObserver)
const quieto = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function aLaVista(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.height > 0 && r.bottom > 0 && r.top < innerHeight;
}

export function useAparecerUnaVez(ref: RefObject<HTMLElement | null>, clave: string): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // en StrictMode el efecto corre dos veces sobre el MISMO nodo: la marca
    // se queda, y este oyente se vuelve a poner en la segunda vuelta
    const fin = (e: Event) => {
      if (e.target instanceof Element && e.target.hasAttribute('data-final')) el.removeAttribute('data-entra');
    };
    el.addEventListener('animationend', fin);
    el.addEventListener('animationcancel', fin);
    const soltar = () => {
      el.removeEventListener('animationend', fin);
      el.removeEventListener('animationcancel', fin);
    };
    if (vistas.has(clave) || typeof IntersectionObserver !== 'function' || quieto()) return soltar;

    const entrar = () => {
      if (vistas.has(clave)) return;
      vistas.add(clave);
      el.setAttribute('data-entra', '');
    };
    if (aLaVista(el)) {
      entrar();
      return soltar;
    }
    // `vivo`: un observador ya desconectado puede entregar un aviso que tenía en cola
    let vivo = true;
    const io = new IntersectionObserver(
      avisos => {
        if (!vivo || !avisos.some(a => a.isIntersecting)) return;
        io.disconnect();
        entrar();
      },
      { rootMargin: `${MARGEN_PX}px 0px` },
    );
    io.observe(el);
    return () => {
      vivo = false;
      io.disconnect();
      soltar();
    };
  }, [ref, clave]);
}
