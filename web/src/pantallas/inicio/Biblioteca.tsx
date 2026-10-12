// «Elegir de Mis creaciones»: la hoja que abre el «+» de la caja (opción A del lienzo de diseño, sección 7).
// Dos pestañas: «Mis creaciones» (las imágenes que ya hiciste, para usarlas de referencia) y «Mi computadora» (lo
// de siempre: elegir o soltar archivos). Lo elegido lleva un número —el orden en que se marcó— y el tope sale de
// lo que la tarea admite: hasta 3 en el clip (menos las que ya están en la caja), 1 al editar (ahí elegir otra
// reemplaza a la anterior).
//
// No sabe nada de la caja: recibe las imágenes y devuelve las elegidas; traerlas del servidor y agregarlas es de
// quien la usa (`alAgregar`), que contesta si salió bien. Si no salió, la hoja se queda con lo elegido y dice por qué
// ADENTRO (el cuadro de avisos de abajo a la derecha queda tapado por el diálogo: es aria-hidden mientras está abierto
// y, en un celular, cubre sus botones).
//
// Mientras está abierta, la lista no se mueve: una imagen nueva que llega del sondeo se vería hasta que se vuelva a abrir.
// Cerrarla —por donde sea— olvida lo elegido y cancela lo que se estuviera trayendo.
import { useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from 'react';

import { Boton } from '../../ui/Boton';
import { Dialogo } from '../../ui/Dialogo';
import { Icono } from '../../ui/Icono';
import { Pestanas } from '../../ui/Pestanas';
import { unir } from '../../ui/unir';
import { soloImagenes } from './envio';
import { diaImagen, type Imagen } from './logica';

export interface PropsBiblioteca {
  abierto: boolean;
  alCambiar: (abierto: boolean) => void;
  /** Las imágenes de «Mis creaciones». Aquí se ordenan: la más nueva primero. */
  imagenes: Imagen[];
  /** Cuántas se pueden elegir ahora (las que le caben a la caja). */
  disponibles: number;
  /** La tarea solo admite UNA (editar): elegir otra reemplaza a la anterior, en vez de topar. Con el clip, aunque ya
   *  solo quepa una más, las demás se apagan. */
  reemplaza: boolean;
  /** Trae las elegidas (en el orden en que se marcaron) a la caja. null: salió bien y la hoja se cierra; un texto: lo que
   *  salió mal, que la hoja dice y se queda con lo elegido. Si la hoja se cierra mientras trae, `signal` se aborta y no
   *  debe agregarse nada. */
  alAgregar: (elegidas: Imagen[], signal: AbortSignal) => Promise<string | null>;
  /** «Elegir archivos…»: la hoja se cierra y se abre el selector de archivos. */
  alElegirArchivos: () => void;
  /** Se soltaron archivos en «Mi computadora». */
  alSoltarArchivos: (archivos: File[]) => void;
  /** Qué archivos sirven, en una frase: «JPG, PNG o WebP · hasta 15 MB». */
  descripcionArchivos: string;
  /** Dónde vuelve el foco al cerrar (el «+» de la caja): la hoja se abre desde un menú que ya se desmontó. */
  focoAlCerrar?: RefObject<HTMLElement | null> | undefined;
}

export function Biblioteca({
  abierto,
  alCambiar,
  imagenes,
  disponibles,
  reemplaza,
  alAgregar,
  alElegirArchivos,
  alSoltarArchivos,
  descripcionArchivos,
  focoAlCerrar,
}: PropsBiblioteca) {
  // los nombres de lo elegido, en el orden en que se marcó
  const [sel, setSel] = useState<string[]>([]);
  const [trayendo, setTrayendo] = useState(false);
  const [soltando, setSoltando] = useState(false);
  const [error, setError] = useState('');
  const [avisoZona, setAvisoZona] = useState('');
  // la lista queda como estaba al abrir (se vuelve a leer al reabrir); y al cerrar, por donde sea (Cancelar, Esc, la
  // equis, el velo, «Elegir archivos…», soltar), lo elegido y los avisos se olvidan
  const [vistas, setVistas] = useState(imagenes);
  const [estabaAbierta, setEstabaAbierta] = useState(abierto);
  if (abierto !== estabaAbierta) {
    setEstabaAbierta(abierto);
    if (abierto) setVistas(imagenes);
    else {
      setSel([]);
      setError('');
      setAvisoZona('');
    }
  }
  const ordenadas = useMemo(() => [...vistas].sort((a, b) => b.creado - a.creado), [vistas]);
  // lo que se está trayendo: al cerrar la hoja se cancela, y la caja no recibe nada
  const trayendoAhora = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!abierto) trayendoAhora.current?.abort();
  }, [abierto]);

  function cambiar(a: boolean) {
    alCambiar(a);
  }

  function alternar(im: Imagen) {
    setError('');
    setSel(s => {
      if (s.includes(im.nombre)) return s.filter(n => n !== im.nombre);
      if (reemplaza) return [im.nombre];
      return s.length < disponibles ? [...s, im.nombre] : s;
    });
  }

  async function agregar() {
    const elegidas = sel.map(n => vistas.find(i => i.nombre === n)).filter((i): i is Imagen => i !== undefined);
    if (!elegidas.length || trayendo) return;
    const traer = new AbortController();
    trayendoAhora.current = traer;
    setTrayendo(true);
    setError('');
    try {
      const mal = await alAgregar(elegidas, traer.signal);
      if (traer.signal.aborted) return; // la hoja se cerró mientras traía: ya no hay nada que decir
      if (mal === null) cambiar(false);
      else setError(mal);
    } finally {
      setTrayendo(false);
    }
  }

  const alSoltar = (e: DragEvent) => {
    e.preventDefault();
    setSoltando(false);
    const soltadas = Array.from(e.dataTransfer.files);
    if (!soltadas.length) return;
    // lo que no es una imagen no cierra la hoja: se dice aquí, donde se ve
    const imgs = soloImagenes(soltadas);
    if (!imgs.length) {
      setAvisoZona(`Solo sirven imágenes: ${descripcionArchivos}.`);
      return;
    }
    setAvisoZona('');
    alSoltarArchivos(imgs);
  };
  const traeArchivos = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

  const contador =
    disponibles === 0
      ? 'Ya tienes todas las que caben: quita una de la caja para elegir otra.'
      : `${sel.length} de ${disponibles} seleccionadas`;

  const creaciones = (
    <div>
      {ordenadas.length === 0 ? (
        <p className="m-0 text-sm text-secundario">Aún no tienes imágenes en Mis creaciones.</p>
      ) : (
        <ul
          aria-label="Tus imágenes"
          className="m-0 grid max-h-[min(52vh,440px)] list-none grid-cols-2 gap-4 overflow-y-auto p-1 min-[640px]:grid-cols-4"
        >
          {ordenadas.map(im => (
            <Miniatura
              key={im.nombre}
              im={im}
              numero={sel.indexOf(im.nombre) + 1}
              bloqueada={!reemplaza && !sel.includes(im.nombre) && sel.length >= disponibles}
              alPulsar={() => alternar(im)}
            />
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-3 mb-0 text-xs text-error">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-linea pt-3">
        <span role="status" className="text-xs text-secundario tabular-nums">
          {contador}
        </span>
        <span className="flex gap-3">
          <Boton nivel="secundario" onClick={() => cambiar(false)}>
            Cancelar
          </Boton>
          <Boton nivel="principal" disabled={sel.length === 0} trabajando={trayendo && 'Agregando…'} onClick={() => void agregar()}>
            {sel.length ? `Agregar ${sel.length}` : 'Agregar'}
          </Boton>
        </span>
      </div>
    </div>
  );

  const computadora = (
    // soltar es un atajo: el camino accesible es el botón
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      onDragOver={e => {
        if (!traeArchivos(e)) return;
        e.preventDefault();
        setSoltando(true);
      }}
      onDragLeave={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSoltando(false);
      }}
      onDrop={alSoltar}
      className={unir(
        'grid min-h-[260px] place-items-center gap-3 rounded-medio border-2 border-dashed p-6 text-center',
        soltando ? 'border-ambar' : 'border-campo',
      )}
    >
      <Icono nombre="subir" className="size-8 text-secundario" />
      <p className="m-0 text-md font-semibold">Arrastra tus imágenes aquí</p>
      <p className="m-0 max-w-[40ch] text-xs text-secundario">{descripcionArchivos}.</p>
      <Boton nivel="secundario" onClick={alElegirArchivos}>
        Elegir archivos…
      </Boton>
      {avisoZona && (
        <p role="alert" className="m-0 max-w-[40ch] text-xs text-error">
          {avisoZona}
        </p>
      )}
    </div>
  );

  return (
    <Dialogo abierto={abierto} alCambiar={cambiar} titulo="Agregar imágenes" ancho focoAlCerrar={focoAlCerrar}>
      <Pestanas
        etiqueta="De dónde vienen"
        pestanas={[
          { id: 'creaciones', titulo: 'Mis creaciones', contenido: creaciones },
          { id: 'computadora', titulo: 'Mi computadora', contenido: computadora },
        ]}
      />
    </Dialogo>
  );
}

/** Una imagen de Mis creaciones: botón de dos estados, con su número cuando está elegida. */
function Miniatura({
  im,
  numero,
  bloqueada,
  alPulsar,
}: {
  im: Imagen;
  /** Su lugar entre las elegidas (1, 2, 3), o 0 si no lo está. */
  numero: number;
  /** Ya se llenó el tope y esta no está elegida: no se puede sumar. */
  bloqueada: boolean;
  alPulsar: () => void;
}) {
  const [rota, setRota] = useState(false);
  const dia = diaImagen(im.creado);
  const elegida = numero > 0;
  return (
    <li className="min-w-0">
      <button
        type="button"
        aria-pressed={elegida}
        aria-disabled={bloqueada || undefined}
        aria-label={elegida ? `Tu imagen del ${dia}, elegida: número ${numero}` : `Tu imagen del ${dia}`}
        onClick={() => {
          if (!bloqueada) alPulsar();
        }}
        className={unir(
          'relative block aspect-square w-full overflow-hidden rounded-medio border-2 bg-elevada p-0',
          elegida ? 'border-ambar-claro' : 'border-linea hover:border-campo',
          bloqueada ? 'cursor-default opacity-40' : 'cursor-pointer',
        )}
      >
        {rota ? (
          <span className="grid size-full place-items-center text-secundario">
            <Icono nombre="imagen" className="size-7" />
          </span>
        ) : (
          <img src={im.url} alt="" loading="lazy" className="size-full object-cover" onError={() => setRota(true)} />
        )}
        {elegida && (
          <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-pildora bg-ambar-claro text-xs font-semibold text-tinta">
            {numero}
          </span>
        )}
      </button>
      <span className="mt-1 block text-xs text-secundario">{dia}</span>
    </li>
  );
}
