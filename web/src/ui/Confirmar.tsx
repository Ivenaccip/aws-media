// Confirmación accesible en lugar de confirm() (docs/PLAN-UI.md §2). El foco
// arranca en «Cancelar»: lo que no se puede deshacer nunca es la opción por
// defecto.
import * as A from '@radix-ui/react-alert-dialog';

import { useEffect, useRef, type RefObject } from 'react';

import { Boton } from './Boton';
import { CAJA, VELO, useFocoDeVuelta, useLoUltimoAbierto } from './Dialogo';

export interface PropsConfirmar {
  abierto: boolean;
  alCambiar: (abierto: boolean) => void;
  titulo: string;
  descripcion: string;
  /** El verbo de la acción: «Borrar», «Apagar la campaña»… */
  confirmar: string;
  cancelar?: string;
  /** Pinta la acción como peligro (borrar, apagar). */
  peligro?: boolean;
  alConfirmar: () => void;
  /** Si lo que tenía el foco al abrir ya no está (o no se deja enfocar), aquí. */
  focoDeRespaldo?: RefObject<HTMLElement | null>;
}

export function Confirmar({
  abierto, alCambiar, alConfirmar, focoDeRespaldo, ...props
}: PropsConfirmar) {
  const foco = useFocoDeVuelta(focoDeRespaldo);
  // UI·20: la caja sigue ahí 100 ms tras el primer clic; un segundo clic (o
  // Enter con autorepetición) no confirma otra vez. Candado y no `abierto`:
  // dos clics en el mismo tic ven el mismo render
  const confirmado = useRef(false);
  useEffect(() => {
    if (abierto) confirmado.current = false;
  }, [abierto]);
  function alPulsar() {
    if (!abierto || confirmado.current) return;
    confirmado.current = true;
    alConfirmar();
  }
  // mientras sale se ve lo último que tuvo abierto
  const titulo = useLoUltimoAbierto(props.titulo, abierto);
  const descripcion = useLoUltimoAbierto(props.descripcion, abierto);
  const confirmar = useLoUltimoAbierto(props.confirmar, abierto);
  const cancelar = useLoUltimoAbierto(props.cancelar ?? 'Cancelar', abierto);
  const peligro = useLoUltimoAbierto(props.peligro ?? false, abierto);
  return (
    <A.Root open={abierto} onOpenChange={alCambiar}>
      <A.Portal>
        <A.Overlay className={VELO} />
        <A.Content className={CAJA} {...foco}>
          <A.Title className="m-0 font-titulo text-titulo-sm font-bold">{titulo}</A.Title>
          <A.Description className="mb-0 mt-2 text-md text-secundario">{descripcion}</A.Description>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <A.Cancel asChild>
              <Boton nivel="secundario">{cancelar}</Boton>
            </A.Cancel>
            <A.Action asChild>
              <Boton nivel={peligro ? 'peligro' : 'principal'} onClick={alPulsar}>
                {confirmar}
              </Boton>
            </A.Action>
          </div>
        </A.Content>
      </A.Portal>
    </A.Root>
  );
}
