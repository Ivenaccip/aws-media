// Las 12 pantallas del estudio en React (UI·8). La vitrina no cuenta: es interna.
export const PANTALLAS = [
  'inicio', 'crear', 'shorts', 'subir', 'imagenes', 'mix',
  'agenda', 'metricas', 'estilos', 'competencia', 'clip', 'admin',
] as const;

export type Pantalla = (typeof PANTALLAS)[number];

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
