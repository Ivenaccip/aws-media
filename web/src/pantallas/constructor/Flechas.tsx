// Las flechas del lienzo, en DOS capas que Lienzo.tsx pone en sitios distintos del DOM:
//
//   · <LineasFlechas>      un <svg> por conexión (la curva y sus puntas). Va ANTES que los cuadros: queda debajo
//                          de ellos y fuera del orden de Tab (es decoración: aria-hidden, sin eventos).
//   · <InsigniasFlechas>   el círculo de cada flecha: un <button> de 44 × 44 en el punto medio. Va DESPUÉS de los
//                          cuadros (el orden del DOM es el de Tab y el de lectura: cuadros, y luego sus flechas) y
//                          encima de ellos. Es lo ÚNICO clicable de una flecha: axe y el teclado lo necesitan,
//                          y la línea es `pointer-events: none`.
//
// Todo lo que se pinta sale de VistaFlecha (selectores.ts: `vistaFlechas`); aquí no hay geometría. El «un
// solo sentido / ida y vuelta / herramienta» NO puede ir solo en el trazo: viaja en el nombre accesible de la
// insignia («Conexión de «A» a «B»: un solo sentido. Editar») y en el panel de Ajustes. Los colores son clases de
// token (nunca un literal: el guardián de paleta no admite ninguno) y se eligen de un mapa de cadenas COMPLETAS,
// porque Tailwind solo genera la clase que ve escrita entera.
//
// La curva no se anima (ni `stroke-dashoffset` de «flujo»): las flechas son geometría que se recalcula.

import { memo } from 'react';

import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import type { VistaFlecha } from './modelo/selectores';

/** La clase de trazo según la flecha esté elegida o no. */
const TRAZO = { normal: 'stroke-secundario', activa: 'stroke-ambar-claro' } as const;
/** La clase de relleno de las puntas (mismo color que el trazo). */
const PUNTA = { normal: 'fill-secundario', activa: 'fill-ambar-claro' } as const;

/** El punteado de una conexión «ida y vuelta»: 6 de trazo y 6 de hueco, como el mockup. */
const PUNTEADO = '6 6';

/** ¿Pintaría lo mismo? (solo lo que el dibujo lee: no el nombre ni los eventos). */
function mismaLinea(a: { flecha: VistaFlecha }, b: { flecha: VistaFlecha }): boolean {
  const x = a.flecha;
  const y = b.flecha;
  return x.id === y.id && x.d === y.d && x.puntas === y.puntas && x.ancho === y.ancho && x.punteada === y.punteada && x.activa === y.activa;
}

/**
 * El dibujo de UNA conexión: un <svg> del tamaño del lienzo (`absolute inset-0 size-full`, así no depende del ancho
 * ni del alto: crecer el lienzo no lo repinta) con una `<path>` para la curva y otra, aparte, para las puntas
 * (un `marker` de SVG solo pinta el inicio y el final de todo el trazo y las flechas «conversan» llevan dos puntas).
 * `overflow-visible`: el trazo de una curva que se sale un poco no se recorta. Con memo: arrastrar un cuadro
 * repinta solo las flechas que le tocan.
 */
const Linea = memo(function Linea({ flecha }: { flecha: VistaFlecha }) {
  const estado = flecha.activa ? 'activa' : 'normal';
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
      aria-hidden="true"
      focusable="false"
      data-flecha={flecha.id}
    >
      <path
        d={flecha.d}
        fill="none"
        strokeWidth={flecha.ancho}
        {...(flecha.punteada ? { strokeDasharray: PUNTEADO } : {})}
        className={TRAZO[estado]}
      />
      <path d={flecha.puntas} stroke="none" className={PUNTA[estado]} />
    </svg>
  );
}, mismaLinea);

/** Los trazos de todas las conexiones, uno por flecha, con el id de la conexión como llave. */
export function LineasFlechas({ flechas }: { flechas: readonly VistaFlecha[] }) {
  return (
    <>
      {flechas.map(f => (
        <Linea key={f.id} flecha={f} />
      ))}
    </>
  );
}

/**
 * Los círculos de las flechas. Cada uno es un botón de 44 × 44 (el objetivo táctil) con un dibujo de 28 px adentro:
 * el aro de foco va en el dibujo y no en el botón (`constructor.css`, `.cn-b44`). `aria-pressed` dice cuál es la
 * conexión elegida; el `title` es otro texto que el nombre a propósito («Toca para editarla.»).
 */
export function InsigniasFlechas({ flechas, alAbrir }: { flechas: readonly VistaFlecha[]; alAbrir: (id: string) => void }) {
  return (
    <>
      {flechas.map(f => (
        <button
          key={f.id}
          type="button"
          className={unir('cn-b44 cn-insignia', f.tipo === 'tool' && 'cn-insignia-tool', f.activa && 'cn-insignia-act')}
          style={{ left: f.insignia.x, top: f.insignia.y }}
          data-insignia={f.id}
          aria-pressed={f.activa}
          aria-label={f.etiqueta}
          title={f.titulo}
          onClick={() => alAbrir(f.id)}
        >
          <span className="cn-dibujo cn-d28 cn-redondo">
            <Icono nombre={f.icono} className="size-4!" />
          </span>
        </button>
      ))}
    </>
  );
}
