// Un icono de trazo (docs/DISENO.md §6). Siempre decorativo: el nombre lo dice
// el texto de al lado o el aria-label del botón que lo lleva. inline-block: el
// preflight de Tailwind pone los svg en block y el icono saltaba de renglón.
import { TRAZOS, type NombreIcono } from './iconos';
import { unir } from './unir';

export function Icono({ nombre, className }: { nombre: NombreIcono; className?: string }) {
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
      <path d={TRAZOS[nombre]} />
    </svg>
  );
}
