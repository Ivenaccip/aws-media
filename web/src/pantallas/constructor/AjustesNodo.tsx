// El panel de Ajustes de un CUADRO elegido: según su tipo, los ajustes de un agente, del disparador o de una app (AjustesAgente,
// AjustesDisparador, AjustesApp), la lista de sus conexiones con «Agregar lo que sigue» y «Darle una herramienta» (Conexiones) y,
// al final, «Quitar este cuadro».
//
// Recibe lo que calcula `vistaAjustes(estado)` (nunca null: si no hay cuadro elegido se pinta `AjustesVacio` o `AjustesEnlace`;
// `panelDeAjustes(estado)` dice cuál) y `despachar`. El contenedor es `PanelAjustes` (`id="ajustes"`, `tabIndex={-1}`, Esc regresa
// al cuadro): `className` es del envoltorio, para que la pantalla le dé ancho y lugar.
//
// «Quitar este cuadro» manda `quitarNodo`: el reductor guarda la foto para «Deshacer», avisa con el botón y pide el foco, así que
// aquí no se confirma nada (D8 del plan: quitar un cuadro no es irreversible).
import { Boton } from '../../ui/Boton';
import { Icono } from '../../ui/Icono';
import { AjustesAgente } from './AjustesAgente';
import { AjustesApp } from './AjustesApp';
import { AjustesDisparador } from './AjustesDisparador';
import { Conexiones } from './Conexiones';
import type { VistaAjustes } from './modelo/selectores';
import type { AccionConstructor } from './modelo/tipos';
import { PanelAjustes } from './PanelAjustes';

export interface PropsAjustesNodo {
  vista: VistaAjustes;
  despachar: (accion: AccionConstructor) => void;
  className?: string;
}

export function AjustesNodo({ vista, despachar, className }: PropsAjustesNodo) {
  return (
    <PanelAjustes etiqueta="Ajustes del cuadro" despachar={despachar} {...(className ? { className } : {})}>
      {vista.panel === 'agente' ? (
        <AjustesAgente vista={vista} despachar={despachar} />
      ) : vista.panel === 'disparador' ? (
        <AjustesDisparador vista={vista} despachar={despachar} />
      ) : (
        <AjustesApp vista={vista} despachar={despachar} />
      )}
      <Conexiones vista={vista} despachar={despachar} />
      <Boton
        className="self-start"
        icono={<Icono nombre="papelera" className="size-5!" />}
        onClick={() => despachar({ k: 'quitarNodo', id: vista.id })}
      >
        Quitar este cuadro
      </Boton>
    </PanelAjustes>
  );
}
