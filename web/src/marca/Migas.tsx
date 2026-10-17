// Las migas: la ruta elegida (Marketing › Blotato…) como chips en una fila, y cada chip reabre su nivel (dueño, 15-oct-2026:
// «Mapa con Irremplazables»). Sirven igual en el inicio (botones que cambian de paso) y en las pantallas hoja (enlaces al inicio
// con `?desde=…&ver=…`, ver marca/menu.ts), así que cada miga lleva `alPulsar` O `href`.
import { Icono } from '../ui/Icono';
import type { NombreIcono } from '../ui/iconos';
import { unir } from '../ui/unir';

export interface Miga {
  clave: string;
  titulo: string;
  icono?: NombreIcono;
  /** Lo que lee el lector de pantalla si es más largo que el título («Volver al mapa para cambiar de área (ahora: Marketing)»). */
  rotulo?: string;
  /** Es la miga donde estás: el lector la dice como `aria-current`. */
  actual?: boolean;
  href?: string;
  alPulsar?: () => void;
}

export interface PropsMigas {
  migas: readonly Miga[];
  /** El nombre de la región para el lector de pantalla. */
  etiqueta?: string;
  className?: string;
}

const CHIP =
  'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-pildora border-0 bg-elevada px-3 text-xs font-medium text-texto no-underline hover:bg-activa';
// La miga donde estás, cuando no lleva a ningún lado (COI: «Central › Distrito › COI»): un chip quieto, no un botón que no hace nada.
const ACTUAL = 'inline-flex min-h-11 items-center gap-2 rounded-pildora bg-activa px-3 text-xs font-semibold text-texto';

export function Migas({ migas, etiqueta = 'Dónde estás', className }: PropsMigas) {
  if (!migas.length) return null;
  return (
    <nav aria-label={etiqueta} className={className}>
      <ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
        {migas.map((m, i) => {
          const contenido = (
            <>
              {m.icono && <Icono nombre={m.icono} className="size-5! text-secundario" />}
              {m.titulo}
            </>
          );
          const comunes = { 'aria-label': m.rotulo ?? m.titulo, ...(m.actual ? { 'aria-current': 'step' as const } : {}) };
          const quieta = m.actual && !m.href && !m.alPulsar;
          return (
            <li key={m.clave} className="flex items-center gap-2">
              {i > 0 && (
                <span aria-hidden="true" className="text-secundario">
                  ›
                </span>
              )}
              {quieta ? (
                <span aria-current="step" className={ACTUAL}>
                  {contenido}
                </span>
              ) : m.href ? (
                <a href={m.href} className={unir(CHIP)} {...comunes}>
                  {contenido}
                </a>
              ) : (
                <button type="button" onClick={m.alPulsar} className={unir(CHIP)} {...comunes}>
                  {contenido}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
