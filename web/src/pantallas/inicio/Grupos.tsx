// Las tres opciones (paso 2 del recorrido, «Elige un grupo»): una tarjeta por grupo del área que se eligió en el mapa. Cada una dice
// qué pantallas trae, o «Próximamente» si todavía no trae ninguna (`detalleDeGrupo`, de menu.ts). Marketing: Distrito · Blotato · Avanzado.
//
// Sin tarjeta que las rodee (dueño, 15-oct-2026): como el mapa, es una pantalla suelta que Recorrido.tsx centra bajo el título.
//
// El grupo donde estás lleva «Estás aquí» y se ve marcado, pero SOLO si ya elegiste uno (`aqui` es null en el reposo: nadie ha elegido
// nada, y marcar el grupo de la caja escondida diría lo mismo que se quitó del mapa). Elegir (el mismo u otro) exige un clic. En el
// celular las tarjetas apilan en una columna.
import { detalleDeGrupo, type AreaMenu, type GrupoMenu } from '../../marca/menu';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';

/** «Estás aquí»: una etiqueta que NO se parte (a 390 y 320 px cabe en su tarjeta). */
function EstasAqui() {
  return (
    <span className="inline-flex min-h-6 items-center rounded-pildora bg-activa px-2 text-xs font-medium whitespace-nowrap text-texto">
      Estás aquí
    </span>
  );
}

export interface PropsGrupos {
  area: AreaMenu;
  /** El grupo donde estás, si ya elegiste uno y es de esta área (lleva «Estás aquí»). */
  aqui: string | null;
  alElegir: (grupo: GrupoMenu) => void;
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
            onClick={() => alElegir(grupo)}
            className={unir(
              'flex min-h-35 cursor-pointer flex-col items-start gap-2 rounded-grande border p-4 text-left text-texto hover:border-campo hover:bg-elevada',
              estasAqui ? 'border-campo bg-elevada' : 'border-linea bg-superficie',
            )}
          >
            <Icono nombre={grupo.icono} className="size-6! text-secundario" />
            <b className="font-titulo text-titulo-sm leading-[1.3] font-bold">{grupo.titulo}</b>
            <small className="text-xs text-secundario [overflow-wrap:anywhere]">{detalleDeGrupo(grupo)}</small>
            {estasAqui && <EstasAqui />}
          </button>
        );
      })}
    </div>
  );
}
