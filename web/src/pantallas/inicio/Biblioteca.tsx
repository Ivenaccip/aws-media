// «Elegir de Mis creaciones»: la hoja que abre el «+» de la caja (opción A del lienzo de diseño, sección 7).
// Dos pestañas: «Mis creaciones» (las imágenes que ya hiciste, para usarlas de referencia) y «Mi computadora» (lo
// de siempre: elegir o soltar archivos). Lo elegido lleva un número —el orden en que se marcó— y el tope sale de
// lo que la tarea admite: hasta 3 en el clip (menos las que ya están en la caja), 1 al editar (ahí elegir otra
// reemplaza a la anterior).
//
// No sabe nada de la caja: recibe las imágenes y devuelve las elegidas; traerlas del servidor y agregarlas es de
// quien la usa (`alAgregar`), que contesta si salió bien. Si no salió, la hoja se queda con lo elegido.
import { useMemo, useState, type DragEvent } from 'react';

import { Boton } from '../../ui/Boton';
import { Dialogo } from '../../ui/Dialogo';
import { Icono } from '../../ui/Icono';
import { Pestanas } from '../../ui/Pestanas';
import { unir } from '../../ui/unir';
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
  /** Trae las elegidas (en el orden en que se marcaron) a la caja. true: salió bien y la hoja se cierra. */
  alAgregar: (elegidas: Imagen[]) => Promise<boolean>;
  /** «Elegir archivos…»: la hoja se cierra y se abre el selector de archivos. */
  alElegirArchivos: () => void;
  /** Se soltaron archivos en «Mi computadora». */
  alSoltarArchivos: (archivos: File[]) => void;
  /** Qué archivos sirven, en una frase: «JPG, PNG o WebP · hasta 15 MB». */
  descripcionArchivos: string;
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
}: PropsBiblioteca) {
  // los nombres de lo elegido, en el orden en que se marcó
  const [sel, setSel] = useState<string[]>([]);
  const [trayendo, setTrayendo] = useState(false);
  const [soltando, setSoltando] = useState(false);
  const ordenadas = useMemo(() => [...imagenes].sort((a, b) => b.creado - a.creado), [imagenes]);

  function cambiar(a: boolean) {
    // lo elegido sin agregar no se guarda para la próxima vez
    if (!a) setSel([]);
    alCambiar(a);
  }

  function alternar(im: Imagen) {
    setSel(s => {
      if (s.includes(im.nombre)) return s.filter(n => n !== im.nombre);
      if (reemplaza) return [im.nombre];
      return s.length < disponibles ? [...s, im.nombre] : s;
    });
  }

  async function agregar() {
    const elegidas = sel.map(n => imagenes.find(i => i.nombre === n)).filter((i): i is Imagen => i !== undefined);
    if (!elegidas.length || trayendo) return;
    setTrayendo(true);
    try {
      if (await alAgregar(elegidas)) cambiar(false);
    } finally {
      setTrayendo(false);
    }
  }

  const alSoltar = (e: DragEvent) => {
    e.preventDefault();
    setSoltando(false);
    alSoltarArchivos(Array.from(e.dataTransfer.files));
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
    </div>
  );

  return (
    <Dialogo abierto={abierto} alCambiar={cambiar} titulo="Agregar imágenes" ancho>
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
        aria-label={`${elegida ? 'Quitar' : 'Elegir'} tu imagen del ${dia}`}
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
