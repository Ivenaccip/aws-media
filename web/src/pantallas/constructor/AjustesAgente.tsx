// Los ajustes de un agente de IA: su nombre, con qué IA piensa (cuatro tarjetas), para qué le sirve a su agente principal (solo si es
// ayudante), qué debe hacer cada vez que corre (solo si no le llega un chat directo ni es ayudante) y sus instrucciones de fondo.
//
// Todo es controlado por `vista.nodo` y edita con `editarNodo`; el reductor es quien recorta, así que cada `maxLength` es el MISMO
// tope que aplica él (datos/constantes.ts): si no, el borrador recortaría en silencio lo que se escribió.
//
// Lo usa AjustesNodo dentro del panel; no lleva su propio contenedor.
import { Campo } from '../../ui/Campo';
import { LARGO_DESC_AYUDANTE, LARGO_NOMBRE_AGENTE, LARGO_TEXTO_AGENTE } from './modelo/datos/constantes';
import type { AjustesAgente as VistaAgente } from './modelo/selectores';
import type { AccionConstructor, ParcheNodo } from './modelo/tipos';
import { AreaDeTexto, Opcion, TituloDePanel } from './PiezasPanel';

export interface PropsAjustesAgente {
  vista: VistaAgente;
  despachar: (accion: AccionConstructor) => void;
}

export function AjustesAgente({ vista, despachar }: PropsAjustesAgente) {
  const { nodo } = vista;
  const editar = (parche: ParcheNodo) => despachar({ k: 'editarNodo', id: nodo.id, parche });
  return (
    <>
      <TituloDePanel>Agente de IA</TituloDePanel>
      {vista.esAyudante && (
        <span className="inline-flex min-h-6 items-center self-start rounded-chico border border-campo px-2 text-xs text-secundario">
          Conversa con otra IA
        </span>
      )}
      <p className="m-0 text-sm text-secundario">El agente piensa y decide qué hacer. ¿Con qué IA quieres que piense?</p>
      <Campo
        etiqueta="Nombre del agente"
        type="text"
        maxLength={LARGO_NOMBRE_AGENTE}
        placeholder="Por ejemplo: Investigador"
        value={nodo.nombre}
        onChange={e => editar({ nombre: e.target.value })}
      />
      <div role="group" aria-label="IA del agente" className="flex flex-col gap-2">
        {vista.ias.map(ia => (
          <Opcion
            key={ia.id}
            titulo={ia.nombre}
            detalle={ia.detalle}
            elegida={ia.activa}
            aria-pressed={ia.activa}
            onClick={() => editar({ ia: ia.id })}
          />
        ))}
      </div>
      {vista.esAyudante && (
        <AreaDeTexto
          etiqueta={`¿Para qué le sirve a «${vista.padreNombre}»? (así sabe cuándo pedirle su opinión)`}
          rows={2}
          maxLength={LARGO_DESC_AYUDANTE}
          value={nodo.desc ?? ''}
          onChange={e => editar({ desc: e.target.value })}
        />
      )}
      {vista.pideTarea && (
        <AreaDeTexto
          etiqueta={vista.etiquetaTarea}
          rows={3}
          maxLength={LARGO_TEXTO_AGENTE}
          placeholder="Por ejemplo: lee el correo nuevo y escribe una respuesta amable."
          value={nodo.tarea}
          onChange={e => editar({ tarea: e.target.value })}
        />
      )}
      <AreaDeTexto
        etiqueta="Instrucciones del agente"
        rows={4}
        maxLength={LARGO_TEXTO_AGENTE}
        value={nodo.instrucciones}
        onChange={e => editar({ instrucciones: e.target.value })}
      />
    </>
  );
}
