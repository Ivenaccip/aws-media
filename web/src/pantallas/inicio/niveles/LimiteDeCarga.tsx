// Un límite de error para lo que una página de nivel pide con import() (el diálogo de Blotato): si el archivo no llega (la red se cayó,
// o un deploy borró el archivo con hash que esta página, ya abierta, todavía nombra), React desmonta la RAÍZ entera y la persona se queda
// con una pantalla en blanco aunque la lista de herramientas, que es lo que vino a buscar, estaba funcionando. Con el límite se cae solo
// lo que no cargó y en su lugar se enseña `alFallar`.
//
// Es una clase porque React no tiene (todavía) un hook para esto. Cuenta el error en la consola, como cualquier otro, y no lo traga.
import { Component, type ReactNode } from 'react';

export interface PropsLimiteDeCarga {
  /** Lo que se enseña en lugar de lo que no cargó. */
  alFallar: ReactNode;
  children: ReactNode;
}

export class LimiteDeCarga extends Component<PropsLimiteDeCarga, { fallo: boolean }> {
  override state = { fallo: false };

  static getDerivedStateFromError(): { fallo: boolean } {
    return { fallo: true };
  }

  override render(): ReactNode {
    return this.state.fallo ? this.props.alFallar : this.props.children;
  }
}
