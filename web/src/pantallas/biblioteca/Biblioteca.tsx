// /estudio/central/distrito/biblioteca/ — la Biblioteca de prompts (Ajustes 3, 16-oct-2026; Central › Distrito). Prompts listos para
// copiar y usar, y un top 3 que cada quien fija para recordar. No cobra: copiar, fijar y llevar a la caja son gratis (crear, ya en la
// caja, sí cobra, como siempre). Los de la casa los cura el dueño; los «Míos» son los que cada quien guardó desde COI, privados.
//
// Esta pieza es el marco y los estados de la carga —cargando, error con «Reintentar», vacía—; el taller de dos paneles está en
// Taller.tsx. Una sola carga trae todo (GET /api/biblioteca) y la búsqueda se hace en el navegador. Qué pasó con cada garantía y qué
// pruebas la sostienen: docs/migracion/biblioteca.md.
import { useEffect, useState } from 'react';

import { ErrorApi } from '../../nucleo/api';
import { Boton, claseBoton } from '../../ui/Boton';
import { Icono } from '../../ui/Icono';
import { Encabezado } from './Encabezado';
import { cargar, type Listado } from './logica';
import { Taller } from './Taller';

type Estado = { tipo: 'cargando' } | { tipo: 'error'; texto: string } | { tipo: 'lista'; datos: Listado };

const TEXTO_DEL_ERROR = 'No pudimos traer los prompts. Puede ser algo pasajero: inténtalo otra vez en unos segundos.';

export function Biblioteca() {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vivo = true;
    cargar().then(
      datos => vivo && setEstado({ tipo: 'lista', datos }),
      (e: unknown) => vivo && setEstado({ tipo: 'error', texto: e instanceof ErrorApi && e.estado === 0 ? e.message : TEXTO_DEL_ERROR }),
    );
    return () => {
      vivo = false;
    };
  }, [intento]);

  function reintentar() {
    setEstado({ tipo: 'cargando' });
    setIntento(n => n + 1);
  }

  return (
    <div className="mx-auto max-w-[1240px] px-4 pt-16 pb-16 min-[960px]:px-8">
      <Encabezado />
      <main className="mt-6">
        <div className="mb-5">
          <h2 className="m-0 font-titulo text-titulo-md font-bold">Biblioteca de prompts</h2>
          <p className="m-0 mt-1.5 max-w-[70ch] text-secundario">Prompts listos para copiar y usar. Es gratis: no gasta créditos.</p>
        </div>

        {estado.tipo === 'cargando' && <Cargando />}

        {estado.tipo === 'error' && (
          <div
            role="alert"
            className="mx-auto my-6 flex max-w-[520px] flex-col items-center gap-2.5 rounded-grande border border-peligro-borde bg-peligro-fondo px-6 py-12 text-center"
          >
            <Icono nombre="aviso" className="size-9 text-peligro-texto" />
            <h3 className="m-0 font-titulo text-titulo-md font-bold">No pudimos cargar la Biblioteca</h3>
            <p className="m-0 max-w-[44ch] text-md text-texto">{estado.texto}</p>
            <Boton nivel="principal" className="mt-2" icono={<Icono nombre="rehacer" />} onClick={reintentar}>
              Reintentar
            </Boton>
          </div>
        )}

        {estado.tipo === 'lista' &&
          (estado.datos.casa.length === 0 && estado.datos.mios.length === 0 ? (
            <div className="mx-auto my-6 flex max-w-[520px] flex-col items-center gap-2.5 rounded-grande border border-linea bg-superficie px-6 py-12 text-center">
              <Icono nombre="biblioteca" className="size-9 text-secundario" />
              <h3 className="m-0 font-titulo text-titulo-md font-bold">Aún no hay prompts en la Biblioteca</h3>
              <p className="m-0 max-w-[44ch] text-md text-secundario">
                Los estamos preparando. Mientras tanto puedes diseñar el tuyo con COI: escribes lo que necesitas y te devolvemos un prompt bien armado.
              </p>
              <a href="/estudio/central/distrito/coi/" className={`${claseBoton('principal')} mt-2`}>
                Diseñar un prompt con COI
                <Icono nombre="derecha" />
              </a>
            </div>
          ) : (
            <Taller datos={estado.datos} />
          ))}
      </main>
    </div>
  );
}

/** El hueco mientras llega la lista: la misma forma del taller, sin pasos falsos. Quieto con «reducir movimiento». */
function Cargando() {
  const filas = ['58%/86%', '70%/60%', '46%/78%', '64%/70%', '52%/84%', '72%/56%'];
  const barra = (ancho: string, alto = 'h-3.5') => (
    <span className={`block ${alto} animate-pulse rounded-chico bg-elevada motion-reduce:animate-none`} style={{ width: ancho }} />
  );
  return (
    <div aria-busy="true" className="min-[960px]:grid min-[960px]:grid-cols-[minmax(360px,440px)_minmax(0,1fr)] min-[960px]:gap-6">
      <section aria-label="Cargando la lista" className="rounded-grande border border-linea bg-superficie p-4 min-[960px]:p-6">
        <p role="status" className="m-0 flex min-h-11 items-center gap-2.5 text-sm text-secundario">
          <span
            aria-hidden="true"
            className="inline-block size-5 shrink-0 animate-spin rounded-full border-2 border-linea border-t-ambar-claro motion-reduce:animate-none"
          />
          Cargando la Biblioteca…
        </p>
        <div aria-hidden="true" className="mt-2 flex flex-col gap-3.5">
          {filas.map(f => {
            const [a, b] = f.split('/') as [string, string];
            return (
              <div key={f} className="flex min-h-16 items-center gap-3 px-3 py-2.5">
                <span className="size-10 shrink-0 rounded-medio bg-elevada" />
                <span className="flex flex-1 flex-col gap-2">
                  {barra(a)}
                  {barra(b)}
                </span>
              </div>
            );
          })}
        </div>
      </section>
      <section aria-label="Cargando el prompt" className="hidden rounded-grande border border-linea bg-superficie p-6 min-[960px]:block">
        <div aria-hidden="true" className="flex flex-col gap-3">
          {barra('90px', 'h-6')}
          {barra('62%', 'h-7')}
          {barra('30%')}
          {barra('80%')}
          {barra('100%', 'h-28')}
        </div>
      </section>
    </div>
  );
}
