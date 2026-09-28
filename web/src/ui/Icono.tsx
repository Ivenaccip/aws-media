// Un icono de trazo (docs/DISENO.md §6). Siempre decorativo: el nombre lo dice
// el texto de al lado o el aria-label del botón que lo lleva. inline-block: el
// preflight de Tailwind pone los svg en block y el icono saltaba de renglón.
import { TRAZOS, type NombreIcono } from './iconos';
import { unir } from './unir';

export function Icono({
  nombre,
  className,
  dibujar = false,
}: {
  nombre: NombreIcono;
  className?: string;
  /** UI·24: el trazo se dibuja al montar (300 ms). Quieto, es el mismo icono. */
  dibujar?: boolean;
}) {
  return (
    <svg
      className={unir('inline-block size-[1.25em] shrink-0 align-[-0.25em]', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* pathLength=1: el guion de trazo-se-dibuja mide lo que el trazo */}
      <path d={TRAZOS[nombre]} {...(dibujar ? { pathLength: 1, className: 'motion-safe:animate-trazo-se-dibuja' } : {})} />
    </svg>
  );
}
