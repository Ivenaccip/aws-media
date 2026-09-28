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

// UI·19: lo que BotonCobro le cuenta a monedero.js cuando un cobro salió
// bien, para que dibuje el «−N» saliendo del botón hacia la píldora.
export interface DetalleCobro {
  costo: number;
  /** Dónde estaba el botón (en px del viewport), o null si no se sabe. */
  rect: { x: number; y: number; ancho: number; alto: number } | null;
}

declare global {
  interface WindowEventMap {
    cobro: CustomEvent<DetalleCobro>;
  }
  interface Window {
    orbe?: {
      montar(el: HTMLElement, op: OpcionesOrbe): MandoOrbe;
      soportado(): boolean;
      precargar(): void;
    };
    monedero?: {
      get(): { saldo?: number | null } | null;
      refrescar(): void;
      recargar(): void;
      /** El único interruptor de la recarga (monedero.js). Hoy, false. */
      recarga?: boolean;
      /** Qué decir en vez del botón cuando la recarga está cerrada. */
      cta?: string;
    };
  }
}

export {};
