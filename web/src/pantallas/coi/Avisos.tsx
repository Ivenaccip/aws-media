// Los cuadros de estado de COI (dirección A, COI-A.dc.html): «otra en curso», «Armando tu COI…», lo que falló, «ya usaste los 3» y
// «no disponible». Cada uno con las medidas y los colores de la carta (radio de 12, fondo de aviso o superficie, ícono a la izquierda).
// El `texto` del servidor se muestra tal cual: ya viene escrito para la persona.
import type { ReactNode } from 'react';

import { Boton } from '../../ui/Boton';
import { Icono } from '../../ui/Icono';
import type { NombreIcono } from '../../ui/iconos';
import { unir } from '../../ui/unir';
import { IconoCoi } from './IconosCoi';
import { ENLACE_BOTON } from './Resultado';
import { faltanTexto, type CodigoFallo, type Fallo } from './logica';

const CAJA = 'flex items-start gap-3 rounded-boton border p-4';
const TITULO = 'm-0 font-titulo text-md font-bold leading-snug';

function Caja({
  icono,
  colorIcono,
  clase,
  children,
  ...aria
}: {
  icono: NombreIcono;
  colorIcono: string;
  clase: string;
  children: ReactNode;
  id?: string;
  role?: 'alert' | 'status';
}) {
  return (
    <div className={unir(CAJA, clase)} {...aria}>
      <Icono nombre={icono} className={unir('mt-px size-6! shrink-0', colorIcono)} />
      <div className="min-w-0 [&_p]:[overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

/** Hay otro COI armándose para esta persona (otra pestaña, o una petición que no terminó): el botón se apaga hasta que termine. */
export function BloqueEnCurso({ texto }: { texto?: string | undefined }) {
  return (
    <Caja id="coi-curso" role="status" icono="aviso" colorIcono="text-ambar-claro" clase="border-ambar-hondo bg-aviso-fondo">
      <h3 className={TITULO}>Ya hay un COI en camino</h3>
      <p className="m-0 mt-0.5">
        {texto ??
          'Estamos armando el que pediste hace un momento. Espera a que termine para pedir otro: no se gasta ninguno hasta que termine bien.'}
      </p>
    </Caja>
  );
}

/** «Armando tu COI…» sin pasos falsos: un giro y lo que de verdad pasa. */
export function BloqueArmando() {
  return (
    // sin role: «Armando tu COI…» ya lo dice la región viva de la pantalla (un cuadro que nace con su texto no siempre se anuncia)
    <div className={unir(CAJA, 'border-linea bg-superficie')}>
      <span
        aria-hidden="true"
        className="mt-0.5 size-7 shrink-0 rounded-full border-[3px] border-activa border-t-ambar motion-safe:animate-spin"
      />
      <div className="min-w-0">
        <h3 className={TITULO}>Armando tu COI…</h3>
        <p className="m-0 mt-0.5 text-xs text-secundario">
          Puede tardar un momento. No se gasta ninguno hasta que termine bien. No cierres esta pantalla: no guardamos nada, así que si sales
          no podrás ver la respuesta.
        </p>
      </div>
    </div>
  );
}

const TITULO_FALLO: Partial<Record<CodigoFallo, string>> = {
  modelo: 'Algo falló de nuestro lado',
  tardo: 'Tardó demasiado',
  no_disponible: 'COI no está disponible ahora',
  sin_conexion: 'No hay conexión',
};

/** Lo que falló al armar: el texto del servidor y qué hacer. La entrada NO se toca: el texto sigue en el cuadro. */
export function BloqueFalla({ fallo }: { fallo: Fallo }) {
  return (
    <Caja role="alert" icono="aviso" colorIcono="text-error" clase="border-linea bg-hundido">
      <h3 className={TITULO}>{TITULO_FALLO[fallo.codigo] ?? 'No pudimos armar tu COI'}</h3>
      <p className="m-0 mt-1">{fallo.texto}</p>
      <p className="m-0 mt-1">Tu texto sigue en el cuadro. Pulsa «Armar COI» para intentarlo otra vez.</p>
    </Caja>
  );
}

/** No se pudo ni leer cuántos te quedan: sin eso no se arma nada (falla cerrado). «Reintentar» vuelve a preguntar. */
export function BloqueNoDisponible({ fallo, alReintentar }: { fallo: Fallo; alReintentar: () => void }) {
  return (
    <Caja role="alert" icono={fallo.codigo === 'sin_conexion' ? 'sinred' : 'aviso'} colorIcono="text-error" clase="border-linea bg-hundido">
      <h3 className={TITULO}>{TITULO_FALLO[fallo.codigo] ?? 'COI no está disponible ahora'}</h3>
      <p className="m-0 mt-1">{fallo.texto}</p>
      <p className="m-0 mt-1">No se gastó ninguno de tus usos.</p>
      <div className="mt-3">
        <Boton onClick={alReintentar}>Reintentar</Boton>
      </div>
    </Caja>
  );
}

/** Ya usaste los 3: NO es un error. La entrada se apaga, el último resultado sigue a la vista y la Biblioteca es el plan B. */
export function BloqueAgotado({ tope, renuevaEnS }: { tope: number; renuevaEnS: number }) {
  return (
    <Caja id="coi-agota" icono="reloj" colorIcono="text-secundario" clase="border-linea bg-superficie">
      <h3 className="m-0 font-titulo text-titulo-sm font-bold leading-snug">Ya usaste tus {tope} COI de hoy</h3>
      <p className="m-0 mt-1">
        Se renuevan a la medianoche, hora de México (12:00 a. m.). <span className="tabular-nums">{faltanTexto(renuevaEnS)}</span>.
      </p>
      <p className="m-0 mt-1.5 text-secundario">Mientras tanto, puedes usar los prompts que ya están hechos.</p>
      <a href="/estudio/biblioteca/" className={unir(ENLACE_BOTON, 'no-underline -ml-2 mt-1')}>
        Ir a la Biblioteca de prompts
        <IconoCoi nombre="flecha" />
      </a>
    </Caja>
  );
}
