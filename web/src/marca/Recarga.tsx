// «Te faltan créditos»: qué ofrecer al lado. monedero.js tiene UN interruptor
// (window.monedero.recarga): abierto, un botón «Recargar» que abre su panel;
// cerrado —hoy—, el texto de window.monedero.cta («Escríbenos por el canal de
// la comunidad…»). Un botón que no hace nada es peor que no tener botón.
import { Boton } from '../ui/Boton';

export function Recarga({ className }: { className?: string }) {
  const m = typeof window !== 'undefined' ? window.monedero : undefined;
  if (!m) return null;
  if (m.recarga) {
    return (
      <Boton nivel="enlace" {...(className ? { className } : {})} onClick={() => m.recargar()}>
        Recargar
      </Boton>
    );
  }
  return m.cta ? <span {...(className ? { className } : {})}>{m.cta}</span> : null;
}
