// Confirmación accesible en lugar de confirm() (docs/PLAN-UI.md §2). El foco
// arranca en «Cancelar»: lo que no se puede deshacer nunca es la opción por
// defecto.
import * as A from '@radix-ui/react-alert-dialog';

import { Boton } from './Boton';
import { CAJA, VELO, useFocoDeVuelta } from './Dialogo';

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
}

export function Confirmar({
  abierto, alCambiar, titulo, descripcion, confirmar, cancelar = 'Cancelar',
  peligro = false, alConfirmar,
}: PropsConfirmar) {
  const foco = useFocoDeVuelta();
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
              <Boton nivel={peligro ? 'peligro' : 'principal'} onClick={alConfirmar}>
                {confirmar}
              </Boton>
            </A.Action>
          </div>
        </A.Content>
      </A.Portal>
    </A.Root>
  );
}
