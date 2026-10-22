// El arrastre de un cuadro con el puntero (ratón, dedo o lápiz). Porta `abajo/mover/soltar` del
// mockup (Main.dc.html:1408-1436) con tres cambios deliberados, cada uno probado en useArrastre.test.tsx:
//
//   1. La captura del puntero se pide al PRESIONAR, sobre el propio cuadro, y no al pasar el umbral
//      sobre el contenedor. Con la del mockup, un ratón que sale del cuadro antes de que llegue el
//      primer `pointermove` ya no le avisaba a nadie; con esta, todos los movimientos llegan al cuadro
//      desde el primer instante y un clic quieto sigue siendo un clic (el `click` cae en el cuadro).
//      Es `setPointerCapture?.()` dentro de try: jsdom no la tiene, y un puntero que ya se fue la lanza.
//   2. Si el marco del lienzo se desplaza mientras se arrastra (la rueda del ratón), el cuadro sigue
//      al puntero: se suma lo que se desplazó el marco desde que se presionó (`leerScroll`).
//   3. Un segundo puntero (otro dedo) no secuestra un arrastre que ya está en curso. Salvo que el primero ya no exista: un puntero
//      PRIMARIO nuevo del mismo tipo (un dedo que llega cuando no hay otro apoyado) solo puede nacer si el anterior se perdió —su
//      pointerup o pointercancel nunca llegó: el cuadro se desmontó a mitad del gesto, un gesto del sistema—, y entonces reemplaza al
//      huérfano. Sin esto un gesto perdido dejaba muerto el arrastre de cualquier otro dedo hasta recargar.
//
// El hook NO mueve nada por su cuenta: avisa con `alMover(id, x, y)` la posición que le toca al cuadro
// en px de lienzo, SIN ajustarla a la rejilla ni al lienzo (eso es del reductor: `moverNodo`). Tampoco
// cambia la selección: arrastrar no elige el cuadro, solo el clic lo hace.
//
// El estado del gesto vive en refs (se lee en los eventos, nunca al pintar): una repintada por cada
// `pointermove` ya es todo el costo que hay que pagar.

import { useRef, type PointerEvent as EventoPuntero } from 'react';

import { UMBRAL_ARRASTRE } from './modelo/datos/constantes';
import type { Punto } from './modelo/tipos';

/** El cuadro que se presiona: su id y dónde está AHORA (de ahí parte el desplazamiento). */
export type CuadroArrastrable = Punto & { readonly id: string };

export interface OpcionesArrastre {
  /** Avisa dónde le toca estar al cuadro `id`, en px de lienzo y sin ajustar. */
  alMover: (id: string, x: number, y: number) => void;
  /** Cuánto lleva desplazado el marco del lienzo (`scrollLeft`, `scrollTop`). Sin él, se supone 0. */
  leerScroll?: () => Punto;
}

/** Los manejadores que se cuelgan del botón del cuadro, y la pregunta que se hace en su `click`. */
export interface ArrastreCuadro {
  /** `onPointerDown` del cuadro. Pasa el cuadro tal como está en ese instante. */
  presionar: (e: EventoPuntero<HTMLElement>, cuadro: CuadroArrastrable) => void;
  /** `onPointerMove`. */
  mover: (e: EventoPuntero<HTMLElement>) => void;
  /** `onPointerUp`, `onPointerCancel` y `onLostPointerCapture`: los tres terminan el gesto. */
  soltar: (e: EventoPuntero<HTMLElement>) => void;
  /**
   * Para el `click`: ¿es el que sigue a un arrastre? Si lo es, lo gasta (devuelve true UNA vez) y quien llama
   * no debe hacer nada con ese clic. Una pregunta a destiempo no inventa un clic suprimido: la marca se apaga
   * sola en cuanto termina la cola de eventos del navegador.
   */
  clicSuprimido: () => boolean;
}

interface Gesto {
  id: string;
  pid: number;
  /** `touch`, `mouse` o `pen`: dos punteros de tipos distintos pueden ser primarios a la vez. */
  tipo: string;
  /** Dónde se presionó (px de ventana). */
  sx: number;
  sy: number;
  /** Dónde estaba el cuadro al presionar (px de lienzo). */
  ox: number;
  oy: number;
  /** El desplazamiento del marco al presionar. */
  scroll0: Punto;
  /** ¿Ya pasó el umbral? Antes de eso todavía puede ser un clic. */
  mov: boolean;
}

const SIN_SCROLL: Punto = { x: 0, y: 0 };

export function useArrastre({ alMover, leerScroll }: OpcionesArrastre): ArrastreCuadro {
  const gesto = useRef<Gesto | null>(null);
  const acabaDeArrastrar = useRef(false);

  const terminar = (g: Gesto) => {
    gesto.current = null;
    if (!g.mov) return;
    // El `click` llega en el mismo turno de eventos que el `pointerup`: la marca vive hasta que se vacía la cola
    // (como el mockup, `setTimeout(…, 0)`) y el primero que la pregunte la gasta.
    acabaDeArrastrar.current = true;
    setTimeout(() => {
      acabaDeArrastrar.current = false;
    }, 0);
  };

  const presionar: ArrastreCuadro['presionar'] = (e, cuadro) => {
    if (e.button !== 0) return; // el clic derecho y el del medio no arrastran
    // otro dedo mientras ya se arrastra no lo secuestra; uno primario del mismo tipo reemplaza a un gesto cuyo puntero se perdió
    if (gesto.current && gesto.current.pid !== e.pointerId && !(e.isPrimary && e.pointerType === gesto.current.tipo)) return;
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    gesto.current = {
      id: cuadro.id,
      pid: e.pointerId,
      tipo: e.pointerType,
      sx: e.clientX,
      sy: e.clientY,
      ox: cuadro.x,
      oy: cuadro.y,
      scroll0: leerScroll?.() ?? SIN_SCROLL,
      mov: false,
    };
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* el puntero ya no existe: se arrastra sin captura */
    }
  };

  const mover: ArrastreCuadro['mover'] = e => {
    const g = gesto.current;
    if (!g || e.pointerId !== g.pid) return;
    if (!e.buttons) {
      // se soltó fuera de la ventana y nadie se enteró: el arrastre no sigue vivo
      terminar(g);
      return;
    }
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    if (!g.mov) {
      if (Math.abs(dx) + Math.abs(dy) < UMBRAL_ARRASTRE) return; // todavía es un clic
      g.mov = true;
    }
    const s = leerScroll?.() ?? SIN_SCROLL;
    alMover(g.id, g.ox + dx + (s.x - g.scroll0.x), g.oy + dy + (s.y - g.scroll0.y));
  };

  const soltar: ArrastreCuadro['soltar'] = e => {
    const g = gesto.current;
    if (!g || e.pointerId !== g.pid) return;
    terminar(g);
  };

  const clicSuprimido = () => {
    if (!acabaDeArrastrar.current) return false;
    acabaDeArrastrar.current = false;
    return true;
  };

  return { presionar, mover, soltar, clicSuprimido };
}
