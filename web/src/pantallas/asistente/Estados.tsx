// Los cuadros de estado del Asistente que no son un error de armado ni el resultado: el Asistente apagado, «todavía no sabemos armar
// esto» (sin cobertura) y la espera. El `texto` y el `mensaje` del servidor se muestran tal cual: ya vienen escritos para la persona.
import type { Ref } from 'react';

import { EsperaPasos, textoLlevas, useLlevas } from '../../marca/EsperaPasos';
import { claseBoton } from '../../ui/Boton';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import { PASOS_ESPERA } from './logica';
import { URL_CONSTRUCTOR } from './traspaso';

const CAJA = 'flex flex-col gap-3 rounded-grande border border-linea bg-superficie p-5';
const TITULO = 'm-0 flex items-center gap-2.5 font-titulo text-titulo-sm font-bold [overflow-wrap:anywhere]';
const SUBTITULO = 'm-0 mb-1 text-xs font-semibold uppercase tracking-[0.06em] text-secundario';

/** El servidor dice que no se puede escribir (`activo: false`) o que esta pantalla todavía no sabe ofrecerlo: no se ofrece escribir. */
export function Apagado({ texto }: { texto: string }) {
  return (
    <section aria-labelledby="asis-apagado" className={CAJA}>
      <h2 id="asis-apagado" className={TITULO}>
        <Icono nombre="aviso" className="text-ambar-claro" />
        No está disponible por ahora
      </h2>
      <p className="m-0 [overflow-wrap:anywhere]">{texto}</p>
      <p className="m-0 text-secundario">Mientras tanto, puedes armar tu flujo a mano en el constructor.</p>
      <div>
        <a href={URL_CONSTRUCTOR} className={claseBoton('secundario')}>
          Abrir el constructor
        </a>
      </div>
    </section>
  );
}

/** Armar no fue posible porque todavía no sabemos hacerlo con n8n: no es un error, es una respuesta. La persona lo reformula o lo arma a mano. */
export function SinCobertura({ mensaje, faltan, refTitulo }: { mensaje: string; faltan: string[]; refTitulo: Ref<HTMLHeadingElement> }) {
  return (
    <section aria-labelledby="asis-sin" className={unir('mt-8', CAJA)}>
      <h2 id="asis-sin" ref={refTitulo} tabIndex={-1} className={TITULO}>
        Todavía no podemos armar esto
      </h2>
      <p className="m-0 [overflow-wrap:anywhere]">{mensaje}</p>
      {faltan.length > 0 && (
        <div>
          <h3 className={SUBTITULO}>Lo que nos falta</h3>
          <ul className="m-0 grid list-disc gap-1 pl-5">
            {faltan.map((f, i) => (
              <li key={i} className="[overflow-wrap:anywhere]">
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h3 className={SUBTITULO}>Qué sigue</h3>
        <p className="m-0">Cuéntalo con otras palabras, o arma tu flujo a mano en el constructor.</p>
      </div>
      <div>
        <a href={URL_CONSTRUCTOR} className={claseBoton('secundario')}>
          Abrir el constructor
        </a>
      </div>
    </section>
  );
}

/**
 * La espera: los cuatro pasos que informa el servidor y cuánto llevas. Vive en su propio componente para que el reloj («Llevas 0:07»),
 * que cambia cada segundo, vuelva a pintar solo esto y no toda la pantalla. No lleva `role="status"`: lo que se anuncia (el paso en
 * curso, la falta de conexión) lo dice la región viva de la pantalla, una sola vez.
 */
export function EsperaArmando({
  paso,
  lugar,
  desde,
  sinConexion,
}: {
  paso: number;
  lugar: number | null;
  desde: number;
  sinConexion: boolean;
}) {
  const llevas = useLlevas(desde);
  const reloj = textoLlevas(llevas);
  const tiempo = [reloj, lugar !== null ? `Vas en el lugar ${lugar} de la fila.` : null].filter(Boolean).join(' ') || null;
  return (
    <div className="mt-2 flex flex-col gap-3">
      <EsperaPasos pasos={PASOS_ESPERA} paso={paso} tiempo={tiempo} />
      {sinConexion && (
        <p className="m-0 flex items-start gap-2 text-sm text-secundario">
          <Icono nombre="sinred" className="mt-px size-5! shrink-0" />
          Sin conexión. Seguimos intentando…
        </p>
      )}
    </div>
  );
}
