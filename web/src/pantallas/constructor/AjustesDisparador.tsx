// Los ajustes del disparador: de qué tipo es (cuatro tarjetas) y, según el tipo, cada cuánto corre (a una hora), la ruta de su enlace
// (aviso web, con el enlace que va a quedar a la vista) o en qué app tiene que pasar algo. Un disparador de chat no pide nada más.
//
// Todo edita con `editarNodo`. Los campos que el tipo actual no usa se CONSERVAN al cambiar de tipo (lo guarda el reductor), así
// que ir y volver no pierde la ruta ni la frecuencia. El `maxLength` de la ruta es LARGO_RUTA, el mismo tope del reductor.
//
// Lo usa AjustesNodo dentro del panel; no lleva su propio contenedor.
import { Campo } from '../../ui/Campo';
import { LARGO_RUTA } from './modelo/datos/constantes';
import type { AjustesDisparador as VistaDisparador } from './modelo/selectores';
import type { AccionConstructor, ParcheNodo } from './modelo/tipos';
import { Opcion, Selector, TituloDePanel } from './PiezasPanel';

export interface PropsAjustesDisparador {
  vista: VistaDisparador;
  despachar: (accion: AccionConstructor) => void;
}

export function AjustesDisparador({ vista, despachar }: PropsAjustesDisparador) {
  const { nodo } = vista;
  const editar = (parche: ParcheNodo) => despachar({ k: 'editarNodo', id: nodo.id, parche });
  return (
    <>
      <TituloDePanel>Disparador</TituloDePanel>
      <p className="m-0 text-sm text-secundario">¿Qué hace que tu flujo arranque?</p>
      <div role="group" aria-label="Tipo de disparador" className="flex flex-col gap-2">
        {vista.tipos.map(t => (
          <Opcion
            key={t.id}
            titulo={t.nombre}
            detalle={t.detalle}
            elegida={t.activa}
            aria-pressed={t.activa}
            onClick={() => editar({ tipo: t.id })}
          />
        ))}
      </div>
      {vista.tiempo && (
        <Selector etiqueta="¿Cada cuánto?" valor={vista.frecuencia} opciones={vista.opcionesFrecuencia} alCambiar={frec => editar({ frec })} />
      )}
      {vista.web && (
        <Campo
          etiqueta="Ruta del enlace (letras, números y guiones)"
          type="text"
          maxLength={LARGO_RUTA}
          placeholder="mi-flujo"
          value={vista.ruta}
          ayuda={`Tu enlace quedará así: ${vista.enlace}`}
          onChange={e => editar({ ruta: e.target.value })}
        />
      )}
      {vista.deApp && (
        <Selector
          etiqueta="¿En qué app tiene que pasar algo?"
          valor={vista.appDisparador}
          opciones={vista.opcionesApp}
          alCambiar={app => editar({ app })}
          ayuda="Por ahora solo estas dos apps pueden iniciar un flujo."
        />
      )}
    </>
  );
}
