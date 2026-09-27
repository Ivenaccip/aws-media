// Los scripts clásicos que las páginas privadas cargan antes del módulo
// (docs/PLAN-UI.md §3): /auth.js, /monedero.js y /orbe.js. Ninguno es
// obligatorio aquí: la vitrina es pública y no carga auth.js ni monedero.js.

// La API de static/orbe.js (M19), tal cual.
export interface MandoOrbe {
  texto(t: string): MandoOrbe;
  estado(e: 'idle' | 'pensando'): MandoOrbe;
  /** Hubo avance real: el tope vuelve a contar desde ahora. */
  latir(): MandoOrbe;
  apagar(motivo?: string): MandoOrbe;
  desmontar(): void;
}

export interface OpcionesOrbe {
  texto: string;
  forma?: 'heroe';
  estado?: 'idle' | 'pensando';
  /** Milisegundos de silencio tras los que el orbe se apaga (el trabajo no). */
  tope?: number;
  alAgotar?: () => void;
}

declare global {
  interface Window {
    orbe?: {
      montar(el: HTMLElement, op: OpcionesOrbe): MandoOrbe;
      soportado(): boolean;
      precargar(): void;
    };
    monedero?: {
      get(): { saldo?: number } | null;
      refrescar(): void;
      recargar(): void;
    };
  }
}

export {};
