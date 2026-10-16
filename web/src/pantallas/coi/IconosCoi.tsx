// Los cuatro trazos que COI necesita y que la carta (ui/iconos.ts ↔ static/iconos.js) todavía no tiene: copiar, guardar (marcador),
// la flecha de «ir a» y el chevrón de los bloques que se pliegan. Viven aquí, en la carpeta de la pantalla, y no en `ui/iconos.ts`:
// ese archivo es compartido y tests/test_web_tuberia.py exige que su lista sea idéntica a la de static/iconos.js. Mismas medidas
// que el resto: 24 px, trazo 1.7, puntas redondas, currentColor.
import { unir } from '../../ui/unir';

const TRAZOS = {
  copiar: 'M9 9h11v11H9zM15 9V4H4v11h5',
  marcador: 'M6 3h12v18l-6-4.5L6 21z',
  flecha: 'M5 12h14M13 6l6 6-6 6',
  chevron: 'M6 9l6 6 6-6',
} as const;

export type NombreIconoCoi = keyof typeof TRAZOS;

export function IconoCoi({ nombre, className }: { nombre: NombreIconoCoi; className?: string | undefined }) {
  return (
    <svg
      className={unir('inline-block size-5 shrink-0 align-[-0.25em]', className)}
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
