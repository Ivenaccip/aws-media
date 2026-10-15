// Las tres opciones (paso 2 del recorrido, «Elige un grupo»): una tarjeta por grupo del área que se eligió en el mapa. Cada una dice
// qué pantallas trae (`detalleDeGrupo`, de menu.ts). Marketing: Distrito · Blotato · Avanzado.
//
// El grupo donde estás lleva «Estás aquí» y se ve marcado; elegir (el mismo u otro) exige un clic. En el celular las tarjetas
// apilan en una columna.
import { detalleDeGrupo, type AreaMenu, type GrupoMenu } from '../../marca/menu';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import { EstasAqui } from './Mapa';

export interface PropsGrupos {
  area: AreaMenu;
  /** El grupo donde estás, si es de esta área (lleva «Estás aquí»). */
  aqui: string | null;
  /** `detail` es el del clic (1, 2 en un doble clic, 0 con el teclado): Recorrido ignora el segundo clic de un doble clic. */
  alElegir: (grupo: GrupoMenu, detail: number) => void;
}

export function Grupos({ area, aqui, alElegir }: PropsGrupos) {
  return (
    <div
      role="group"
      aria-label={area.titulo}
      className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3 py-2 max-[560px]:grid-cols-1"
    >
      {area.grupos.map(grupo => {
        const estasAqui = aqui === grupo.clave;
        return (
          <button
            key={grupo.clave}
            type="button"
            aria-current={estasAqui ? 'location' : undefined}
            onClick={e => alElegir(grupo, e.detail)}
            className={unir(
              'flex min-h-35 cursor-pointer flex-col items-start gap-2 rounded-grande border p-4 text-left text-texto hover:border-campo hover:bg-elevada',
              estasAqui ? 'border-campo bg-elevada' : 'border-linea bg-superficie',
            )}
          >
            <Icono nombre={grupo.icono} className="size-6! text-secundario" />
            <b className="font-titulo text-titulo-sm leading-[1.3] font-bold">{grupo.titulo}</b>
            <small className="text-xs text-secundario [overflow-wrap:anywhere]">
              {grupo.proximamente && !grupo.pantallas.length ? 'Próximamente' : detalleDeGrupo(grupo)}
            </small>
            {estasAqui && <EstasAqui />}
          </button>
        );
      })}
    </div>
  );
}
