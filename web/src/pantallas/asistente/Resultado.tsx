// El flujo que armó el Asistente: su nombre, lo que lleva, lo que falta conectar en n8n y qué hacer con él (descargarlo o abrirlo en el
// Constructor). Todo lo que manda el servidor es TEXTO: aquí se pinta como texto (React lo escapa; no hay HTML crudo).
//
//   · «Descargar .json» baja el flujo de n8n tal cual lo mandó el servidor (con sangría). Si el navegador no deja descargar (una vista
//     incrustada, un navegador sin Blob), se ofrece «Copiar el JSON» con el texto a la vista: una descarga nunca se pierde en silencio.
//   · «Abrir en el constructor» SOLO si la respuesta trae un grafo que el Constructor puede abrir. Se pasa por el borrador del
//     Constructor (traspaso.ts); si ya hay un flujo con cuadros ahí, se pregunta antes de reemplazarlo.
//   · Al llegar, el foco va al encabezado «Tu flujo está listo» (lo pone quien monta esto, con `refTitulo`).
import { useEffect, useMemo, useRef, useState, type Ref } from 'react';

import { descargarArchivo } from '../../nucleo/descargarArchivo';
import { Boton } from '../../ui/Boton';
import { Confirmar } from '../../ui/Confirmar';
import { Icono } from '../../ui/Icono';
import type { FuenteAlmacen } from '../constructor/modelo/borrador';
import { copiarTexto } from '../coi/copiar';
import { jsonDelFlujo, nombreDelArchivo, type FlujoListo, type ModoAsistente } from './logica';
import { almacenDelNavegador, hayBorrador, navegarA, pasarAlConstructor, sePuedeAbrir, type Navegar } from './traspaso';

const COPIADO_MS = 2200;
/** Un segundo clic tan pegado al primero no baja otro archivo. */
const SIN_REPETIR_MS = 1000;
/** Cuánto se espera a que la página se vaya tras pasar el flujo al Constructor antes de dejar que se vuelva a intentar. */
const SOLTAR_TRASPASO_MS = 4000;

const SUBTITULO = 'm-0 mb-1 text-xs font-semibold uppercase tracking-[0.06em] text-secundario';

export interface PropsResultado {
  listo: FlujoListo;
  modo: ModoAsistente;
  /** El encabezado «Tu flujo está listo»: a donde va el foco cuando llega el resultado. */
  refTitulo: Ref<HTMLHeadingElement>;
  /** Lo que se le dice al lector de pantalla (la región viva de la pantalla; un solo sitio para no repetir anuncios). */
  alDecir: (texto: string) => void;
  /** Adónde se va después de pasar el flujo al Constructor. Sin esto, `location.assign`. */
  ir?: Navegar;
  /** El almacenamiento del borrador del Constructor. Sin esto, `window.localStorage`. */
  almacen?: FuenteAlmacen;
}

export function Resultado({ listo, modo, refTitulo, alDecir, ir = navegarA, almacen = almacenDelNavegador }: PropsResultado) {
  const [sinDescarga, setSinDescarga] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [noAbrio, setNoAbrio] = useState<string | null>(null);

  const botonAbrir = useRef<HTMLButtonElement>(null);
  const cuadroJson = useRef<HTMLTextAreaElement>(null);
  // ya se pasó el flujo al Constructor y la página está por irse: un segundo clic no lo vuelve a pasar ni pregunta si reemplazar el que se acaba de escribir
  const yaSePaso = useRef(false);
  const relojPaso = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultimaDescarga = useRef(Number.NEGATIVE_INFINITY);
  const temporizadorCopia = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (temporizadorCopia.current) clearTimeout(temporizadorCopia.current);
      if (relojPaso.current) clearTimeout(relojPaso.current);
    },
    [],
  );

  const json = useMemo(() => jsonDelFlujo(listo.flujo), [listo.flujo]);
  // el botón solo se ofrece si el grafo que mandó el servidor se puede abrir de verdad: uno que siempre fallaría no se muestra
  const puedeAbrir = useMemo(() => listo.grafo !== null && sePuedeAbrir(listo.grafo), [listo.grafo]);

  function descargar() {
    const ahora = performance.now();
    if (ahora - ultimaDescarga.current < SIN_REPETIR_MS) return;
    ultimaDescarga.current = ahora;
    const archivo = nombreDelArchivo(listo.nombre);
    if (descargarArchivo(archivo, json)) {
      alDecir(`Descargamos «${archivo}».`);
    } else {
      setSinDescarga(true);
      alDecir('Tu navegador no dejó descargar el archivo. Puedes copiar el JSON.');
    }
  }

  async function copiar() {
    if (await copiarTexto(json)) {
      setCopiado(true);
      alDecir('Copiamos el JSON.');
      if (temporizadorCopia.current) clearTimeout(temporizadorCopia.current);
      temporizadorCopia.current = setTimeout(() => {
        temporizadorCopia.current = null;
        setCopiado(false);
      }, COPIADO_MS);
    } else {
      cuadroJson.current?.select();
      alDecir('No pudimos copiar solos. Dejamos el texto seleccionado: cópialo con Ctrl+C.');
    }
  }

  function traspasar() {
    const r = pasarAlConstructor(listo.grafo, almacen, ir);
    setNoAbrio(r.ok ? null : r.texto);
    if (!r.ok) return;
    // la navegación tarda en confirmarse y la página sigue viva: durante ese rato nada más pasa. Si no se fue (se canceló la navegación), se suelta.
    yaSePaso.current = true;
    relojPaso.current = setTimeout(() => {
      yaSePaso.current = false;
    }, SOLTAR_TRASPASO_MS);
  }

  function alAbrir() {
    if (yaSePaso.current) return;
    setNoAbrio(null);
    // si ya hay un flujo con cuadros en el Constructor, abrir este lo reemplaza: primero se pregunta
    if (hayBorrador(almacen)) setConfirmando(true);
    else traspasar();
  }

  return (
    <section aria-labelledby="asis-res" className="mt-8 flex flex-col gap-4 rounded-grande border border-linea bg-superficie p-5">
      <div>
        <h2 id="asis-res" ref={refTitulo} tabIndex={-1} className="m-0 font-titulo text-titulo-sm font-bold">
          Tu flujo está listo
        </h2>
        <p className="m-0 mt-1 font-titulo text-md font-semibold [overflow-wrap:anywhere]">{listo.nombre}</p>
      </div>

      {listo.nodos.length > 0 && (
        <ul aria-label="Cuadros del flujo" className="m-0 flex list-none flex-wrap gap-2 p-0">
          {listo.nodos.map((n, i) => (
            <li key={i} className="rounded-pildora border border-linea bg-elevada px-3 py-1.5 text-xs [overflow-wrap:anywhere]">
              {n.nombre}
            </li>
          ))}
        </ul>
      )}

      {listo.resumen && <p className="m-0 max-w-[65ch] [overflow-wrap:anywhere]">{listo.resumen}</p>}

      {listo.pendientes.length > 0 && (
        <div>
          <h3 className={SUBTITULO}>Antes de usarlo en n8n</h3>
          <ul className="m-0 grid list-disc gap-1 pl-5">
            {listo.pendientes.map((p, i) => (
              <li key={i} className="[overflow-wrap:anywhere]">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      {listo.advertencias.length > 0 && (
        // la lista cambia con cada resultado: un <div>, no el <Aviso> (que lleva role="status" y la anunciaría)
        <div className="rounded-medio border border-ambar-hondo bg-aviso-fondo px-3 py-2.5">
          <h3 className={SUBTITULO}>Ten en cuenta</h3>
          <ul className="m-0 grid list-disc gap-1 pl-5">
            {listo.advertencias.map((a, i) => (
              <li key={i} className="[overflow-wrap:anywhere]">
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {modo === 'prueba' && (
        <p className="m-0 text-xs text-secundario">
          Ejemplo de prueba: lo elegimos por las palabras de tu pedido, no lo armamos a tu medida.
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Boton nivel="principal" icono={<Icono nombre="descargar" className="size-5!" />} onClick={descargar} className="w-full sm:w-auto">
          Descargar .json
        </Boton>
        {puedeAbrir && (
          <Boton ref={botonAbrir} onClick={alAbrir} className="w-full sm:w-auto">
            Abrir en el constructor
          </Boton>
        )}
      </div>

      {noAbrio && (
        <p role="alert" className="m-0 flex items-start gap-2 text-sm text-error">
          <Icono nombre="aviso" className="mt-px size-5! shrink-0" />
          <span className="text-texto [overflow-wrap:anywhere]">{noAbrio}</span>
        </p>
      )}

      {sinDescarga && (
        <div className="flex flex-col gap-3 rounded-medio border border-linea bg-hundido p-3">
          <p className="m-0 text-sm [overflow-wrap:anywhere]">
            Tu navegador no dejó descargar el archivo. Copia el JSON y pégalo en un archivo con el nombre «{nombreDelArchivo(listo.nombre)}».
          </p>
          <label htmlFor="asis-json" className="text-xs font-semibold text-secundario">
            El JSON de tu flujo
          </label>
          <textarea
            id="asis-json"
            ref={cuadroJson}
            readOnly
            rows={8}
            wrap="off"
            value={json}
            className="block max-h-72 w-full rounded-medio border border-campo bg-elevada p-3 text-xs text-texto"
          />
          <div>
            <Boton onClick={() => void copiar()} aria-label={copiado ? 'Copiado: el JSON' : 'Copiar el JSON'}>
              {copiado ? <Icono nombre="listo" className="size-5!" /> : <Icono nombre="copiar" className="size-5!" />}
              {copiado ? 'Copiado' : 'Copiar el JSON'}
            </Boton>
          </div>
        </div>
      )}

      <p className="m-0 text-xs text-secundario">
        Para usarlo: en n8n, abre el menú «⋯» de arriba a la derecha y elige «Import from File».
      </p>

      <Confirmar
        abierto={confirmando}
        alCambiar={setConfirmando}
        titulo="¿Reemplazar tu flujo del constructor?"
        descripcion="Ya tienes un flujo en el constructor. Si abres este, el que tienes ahí se reemplaza. Si quieres conservarlo, descárgalo antes desde el constructor."
        confirmar="Reemplazar y abrir"
        peligro
        alConfirmar={traspasar}
        focoDeRespaldo={botonAbrir}
      />
    </section>
  );
}
