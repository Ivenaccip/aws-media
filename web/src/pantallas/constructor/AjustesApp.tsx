// Los ajustes de una app: su nombre (texto libre; si coincide con una del catálogo hay conector listo en n8n y si no sale un HTTP
// Request) con la nota que lo dice, y las apps con conector listo como pastillas para elegir de un toque.
//
// Edita con `editarNodo`. El `maxLength` es LARGO_NOMBRE_APP, el mismo tope del reductor. La pastilla que coincide con el nombre
// actual lleva `aria-pressed`.
//
// Lo usa AjustesNodo dentro del panel; no lleva su propio contenedor.
import { Campo } from '../../ui/Campo';
import { LARGO_NOMBRE_APP } from './modelo/datos/constantes';
import type { AjustesApp as VistaApp } from './modelo/selectores';
import type { AccionConstructor } from './modelo/tipos';
import { Pastilla, TituloDePanel } from './PiezasPanel';

export interface PropsAjustesApp {
  vista: VistaApp;
  despachar: (accion: AccionConstructor) => void;
}

export function AjustesApp({ vista, despachar }: PropsAjustesApp) {
  const { nodo } = vista;
  const poner = (nombre: string) => despachar({ k: 'editarNodo', id: nodo.id, parche: { nombre } });
  return (
    <>
      <TituloDePanel>App</TituloDePanel>
      <p className="m-0 text-sm text-secundario">Escribe el nombre de la app, o elige una de la lista.</p>
      <Campo
        etiqueta="Nombre de la app"
        type="text"
        maxLength={LARGO_NOMBRE_APP}
        placeholder="Por ejemplo: Gmail"
        value={nodo.nombre}
        ayuda={vista.notaApp}
        onChange={e => poner(e.target.value)}
      />
      <div role="group" aria-label="Apps con conector listo" className="flex flex-wrap gap-2">
        {vista.sugerencias.map(s => (
          <Pastilla key={s} texto={s} elegida={nodo.nombre === s} aria-pressed={nodo.nombre === s} onClick={() => poner(s)} />
        ))}
      </div>
    </>
  );
}
