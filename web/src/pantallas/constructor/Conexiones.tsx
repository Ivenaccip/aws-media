// «Conexiones» del panel de Ajustes de un cuadro: la frase que explica qué papel juega, la lista de sus conexiones con «Editar» y
// «Quitar», y los dos botones para seguir armando («Agregar lo que sigue» y, solo en un agente, «Darle una herramienta»).
//
// Recibe lo que ya calculó `vistaAjustes` (el mismo objeto del panel; solo lee los campos de `AjustesComunes`) y `despachar`.
// Cada botón manda su acción y el reductor pide el foco que toca (al abrir un menú, a su primera opción; al editar una conexión,
// a «Un solo sentido»; al quitarla, al cuadro de donde salía).
//
// Los botones de cada fila llevan el texto de la fila en su nombre («Editar la conexión: Después va «Revisor»»): «Editar» a secas
// no diría de cuál. Letra ≥ 13 px y objetivos de 44 px.
import { Boton } from '../../ui/Boton';
import type { AjustesComunes } from './modelo/selectores';
import type { AccionConstructor } from './modelo/tipos';
import { BOTON_44 } from './PiezasPanel';

export interface PropsConexiones {
  vista: Pick<AjustesComunes, 'id' | 'rolTexto' | 'conexiones' | 'btnSig' | 'textoSig' | 'btnHerr'>;
  despachar: (accion: AccionConstructor) => void;
}

export function Conexiones({ vista, despachar }: PropsConexiones) {
  return (
    <div className="flex flex-col gap-3 border-t border-linea pt-4">
      <h4 className="m-0 text-sm font-semibold">Conexiones</h4>
      <p className="m-0 text-xs text-secundario [overflow-wrap:anywhere]">{vista.rolTexto}</p>
      {vista.conexiones.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {vista.conexiones.map(c => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-medio border border-linea bg-elevada py-2 pl-3 pr-2 text-xs"
            >
              <span className="min-w-0 [overflow-wrap:anywhere]">{c.texto}</span>
              <span className="flex gap-2">
                <Boton denso className={BOTON_44} aria-label={c.etiquetaEditar} onClick={() => despachar({ k: 'abrirEnlace', id: c.id })}>
                  Editar
                </Boton>
                <Boton denso className={BOTON_44} aria-label={c.etiquetaQuitar} onClick={() => despachar({ k: 'quitarEnlace', id: c.id })}>
                  Quitar
                </Boton>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col items-start gap-2">
        {vista.btnSig && (
          <Boton onClick={() => despachar({ k: 'abrirMenu', ancla: vista.id, tipo: 'seq' })}>{vista.textoSig}</Boton>
        )}
        {vista.btnHerr && (
          <Boton onClick={() => despachar({ k: 'abrirMenu', ancla: vista.id, tipo: 'tool' })}>Darle una herramienta</Boton>
        )}
      </div>
    </div>
  );
}
