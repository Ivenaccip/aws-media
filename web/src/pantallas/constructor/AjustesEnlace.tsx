// El panel de Ajustes de una CONEXIÓN elegida (lo que se abre al tocar el círculo de una flecha): de qué cuadro a cuál, las dos
// maneras de conectarlos —«Un solo sentido» (como pasar un recado) o «Ida y vuelta» (como preguntarle algo a un compañero)—, con un
// dibujo de cada una, «Poner un cuadro en medio» (solo si es de un solo sentido) y «Quitar esta conexión».
//
// Recibe lo que calcula `vistaEnlace(estado)` (nunca null: si no hay conexión elegida se pinta otro panel; `panelDeAjustes(estado)`
// dice cuál) y `despachar`. El contenedor es `PanelAjustes` (`id="ajustes"`; Esc regresa a la flecha).
//
// Las dos opciones son `aria-pressed`: la de hoy lleva palomita. Si una no se puede elegir (la regla del grafo lo impide) se
// pinta con `aria-disabled`, NO con `disabled`: sigue enfocable, dice «No se puede: <motivo>» dentro del botón y al pulsarla el
// clic llega igual al reductor, que lo dice también en el aviso («No se puede cambiar: …»).
//
// Contrato de foco con Constructor.tsx: «Un solo sentido» lleva `data-enl="1"` (adonde cae el foco al abrir la conexión) y
// «Poner un cuadro en medio» lleva `data-mas="medio"` (adonde vuelve el foco al cerrar el menú de «en medio»).
import { Boton } from '../../ui/Boton';
import { Icono } from '../../ui/Icono';
import type { OpcionEnlace, VistaEnlace } from './modelo/selectores';
import type { AccionConstructor, TipoArista } from './modelo/tipos';
import { Opcion, TituloDePanel } from './PiezasPanel';
import { PanelAjustes } from './PanelAjustes';

export interface PropsAjustesEnlace {
  vista: VistaEnlace;
  despachar: (accion: AccionConstructor) => void;
  className?: string;
}

/** Dos cajitas A y B con la flecha entre ellas: decoración (el texto de la opción dice lo mismo con palabras). */
function Dibujo({ doble }: { doble: boolean }) {
  return (
    <svg
      width="132"
      height="28"
      viewBox="0 0 132 28"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="stroke-secundario"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="4" width="30" height="20" rx="6" />
      <rect x="101" y="4" width="30" height="20" rx="6" />
      {doble ? (
        <>
          <path d="M41 14h50" strokeDasharray="5 5" />
          <path d="M41 8l-6 6 6 6M91 8l6 6-6 6" />
        </>
      ) : (
        <path d="M35 14h58M87 8l6 6-6 6" />
      )}
      <text x="16" y="18" textAnchor="middle" className="fill-texto stroke-none text-xs">
        A
      </text>
      <text x="116" y="18" textAnchor="middle" className="fill-texto stroke-none text-xs">
        B
      </text>
    </svg>
  );
}

export function AjustesEnlace({ vista, despachar, className }: PropsAjustesEnlace) {
  const elegir = (tipo: TipoArista) => despachar({ k: 'cambiarTipoEnlace', id: vista.id, tipo });
  const textoUno = `«${vista.deNombre}» termina y le pasa su respuesta a «${vista.aNombre}», que corre después. No regresa nada. Es como pasar un recado.`;
  return (
    <PanelAjustes etiqueta="Ajustes de la conexión" despachar={despachar} {...(className ? { className } : {})}>
      <TituloDePanel>Conexión</TituloDePanel>
      <p className="m-0 text-sm [overflow-wrap:anywhere]">
        De <b className="font-semibold">«{vista.deNombre}»</b> a <b className="font-semibold">«{vista.aNombre}»</b>
      </p>
      <p className="m-0 text-sm text-secundario">Elige cómo viaja la información entre estos dos cuadros.</p>
      <div role="group" aria-label="Cómo se conectan" className="flex flex-col gap-2">
        <Modo
          titulo="Un solo sentido"
          opcion={vista.uno}
          detalle={textoUno}
          datoEnl
          doble={false}
          alElegir={() => elegir('seq')}
        />
        <Modo titulo="Ida y vuelta" opcion={vista.doble} detalle={vista.textoDoble} doble alElegir={() => elegir('tool')} />
      </div>
      <div className="flex flex-col items-start gap-2 border-t border-linea pt-4">
        {vista.puedeMedio && (
          <Boton
            data-mas="medio"
            aria-haspopup="dialog"
            aria-expanded={vista.medioAbierto}
            onClick={() => despachar({ k: 'abrirMenu', ancla: vista.de, tipo: 'seq', insertarEn: vista.id })}
          >
            Poner un cuadro en medio
          </Boton>
        )}
        <Boton icono={<Icono nombre="papelera" className="size-5!" />} onClick={() => despachar({ k: 'quitarEnlace', id: vista.id })}>
          Quitar esta conexión
        </Boton>
      </div>
    </PanelAjustes>
  );
}

interface PropsModo {
  titulo: string;
  opcion: OpcionEnlace;
  detalle: string;
  doble: boolean;
  /** Es la opción a la que cae el foco al abrir el editor (`data-enl="1"`). */
  datoEnl?: boolean;
  alElegir: () => void;
}

function Modo({ titulo, opcion, detalle, doble, datoEnl = false, alElegir }: PropsModo) {
  return (
    <Opcion
      titulo={titulo}
      detalle={detalle}
      nota={opcion.nota}
      elegida={opcion.activa}
      bloqueada={opcion.noElegible}
      aria-pressed={opcion.activa}
      data-enl={datoEnl ? '1' : undefined}
      onClick={alElegir}
    >
      <Dibujo doble={doble} />
    </Opcion>
  );
}
