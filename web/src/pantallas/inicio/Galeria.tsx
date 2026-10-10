// «Mis creaciones»: lo que hiciste, en una sola galería (R4b). Películas, videos
// cortos, shorts, imágenes y ediciones juntos, lo más nuevo primero. Los filtros
// solo reducen la lista; un filtro sin nada no se ofrece. Lo que se está
// generando aparece al principio, con su giro, sin sacarte de la página.
//
// Un video corto o una imagen se abren en un visor encima de la página: ahí se
// ve, se descarga, y una imagen se puede mandar de vuelta a la caja como
// referencia. Lo demás (películas, shorts, ediciones) sigue abriendo su pantalla.
import { useState, type ReactNode } from 'react';

import { claseBoton } from '../../ui/Boton';
import { Dialogo } from '../../ui/Dialogo';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import {
  CREACIONES_A_LA_VISTA,
  FILTROS,
  filtroDe,
  type ClipCorto,
  type Creacion,
  type Filtro,
  type Imagen,
  type Proyecto,
} from './logica';
import { TarjetaEdicion, TarjetaImagen, TarjetaVideo } from './Obras';

/** Algo que se pidió desde la caja y todavía no llega a la lista. */
export interface Pendiente {
  clave: string;
  tipo: 'corto' | 'imagen';
  texto: string;
}

type Visto = { tipo: 'corto'; c: ClipCorto } | { tipo: 'imagen'; im: Imagen };

export interface PropsGaleria {
  creaciones: Creacion[];
  pendientes?: Pendiente[];
  /** «2 de 3 slots»: solo cuentan las películas. */
  slots?: ReactNode;
  alArchivar: (p: Proyecto) => void;
  /** Sin esto, el visor no ofrece «Usar como referencia». */
  alUsarReferencia?: (im: Imagen) => void;
}

const FILTRO_DE_PENDIENTE = { corto: 'cortos', imagen: 'imagenes' } as const;

export function Galeria({ creaciones, pendientes = [], slots, alArchivar, alUsarReferencia }: PropsGaleria) {
  const [filtro, setFiltro] = useState<Filtro>('todo');
  const [limite, setLimite] = useState(CREACIONES_A_LA_VISTA);
  const [visto, setVisto] = useState<Visto | null>(null);

  const cuenta = (f: Filtro) =>
    f === 'todo'
      ? creaciones.length + pendientes.length
      : creaciones.filter(c => filtroDe(c) === f).length + pendientes.filter(p => FILTRO_DE_PENDIENTE[p.tipo] === f).length;
  const chips = FILTROS.filter(f => f.id === 'todo' || cuenta(f.id) > 0);
  // si el filtro elegido se quedó sin nada (se archivó lo último), vuelve a «Todo»
  const activo: Filtro = cuenta(filtro) > 0 ? filtro : 'todo';

  const lista = creaciones.filter(c => activo === 'todo' || filtroDe(c) === activo);
  const nuevos = pendientes.filter(p => activo === 'todo' || FILTRO_DE_PENDIENTE[p.tipo] === activo);
  const aLaVista = lista.slice(0, limite);

  function pintar(c: Creacion) {
    if (c.tipo === 'imagen') return <TarjetaImagen key={c.clave} im={c.im} alAbrir={im => setVisto({ tipo: 'imagen', im })} />;
    if (c.tipo === 'edicion') return <TarjetaEdicion key={c.clave} e={c.e} />;
    return (
      <TarjetaVideo
        key={c.clave}
        v={c}
        alArchivar={alArchivar}
        alAbrirClip={cl => setVisto({ tipo: 'corto', c: cl })}
      />
    );
  }

  return (
    <section className="mb-7" aria-labelledby="creaciones-titulo">
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <h2 id="creaciones-titulo" className="m-0 text-titulo-sm font-bold">
          Mis creaciones
        </h2>
        {slots}
      </div>

      <div role="group" aria-label="Filtrar" className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1 min-[640px]:flex-wrap">
        {chips.map(f => (
          <button
            key={f.id}
            type="button"
            aria-pressed={activo === f.id}
            onClick={() => {
              setFiltro(f.id);
              setLimite(CREACIONES_A_LA_VISTA);
            }}
            className={unir(
              'inline-flex min-h-11 flex-none cursor-pointer items-center gap-1.5 rounded-pildora border px-3.5 text-sm',
              activo === f.id
                ? 'border-campo bg-elevada text-texto'
                : 'border-linea bg-transparent text-secundario hover:border-campo',
            )}
          >
            {f.rotulo} <span className="text-xs text-secundario">{cuenta(f.id)}</span>
          </button>
        ))}
      </div>

      {lista.length + nuevos.length === 0 ? (
        <p className="m-0 text-sm text-secundario">Aún no hay nada aquí. Escribe arriba qué quieres crear.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3.5 min-[861px]:grid-cols-3">
          {nuevos.map(p => (
            <Generando key={p.clave} p={p} />
          ))}
          {aLaVista.map(pintar)}
        </div>
      )}

      {lista.length > limite && (
        <div className="mt-4 flex justify-center">
          <button type="button" className={claseBoton('secundario')} onClick={() => setLimite(l => l + CREACIONES_A_LA_VISTA)}>
            Ver más ({lista.length - limite})
          </button>
        </div>
      )}

      <Visor visto={visto} alCerrar={() => setVisto(null)} alUsarReferencia={alUsarReferencia} />
    </section>
  );
}

/** La tarjeta de lo que se acaba de pedir: gira hasta que la lista la trae. */
function Generando({ p }: { p: Pendiente }) {
  return (
    <article
      aria-busy="true"
      className="relative flex flex-col overflow-hidden rounded-boton border border-linea bg-superficie text-texto"
    >
      <div className="grid aspect-[16/10] w-full place-items-center border-b border-linea bg-elevada text-secundario">
        <span className="flex flex-col items-center gap-1.5 text-xs">
          <Icono nombre="reloj" className="size-6 animate-spin motion-reduce:animate-none" />
          Generando…
        </span>
      </div>
      <div className="px-3 py-2.5">
        <span className="block overflow-hidden text-sm font-semibold text-ellipsis whitespace-nowrap" title={p.texto}>
          {p.texto}
        </span>
        <p className="m-0 text-xs text-secundario">
          <span className="font-semibold text-texto">{p.tipo === 'corto' ? 'Video corto' : 'Imagen'}</span> · puedes seguir
          usando la página
        </p>
      </div>
    </article>
  );
}

function Visor({
  visto,
  alCerrar,
  alUsarReferencia,
}: {
  visto: Visto | null;
  alCerrar: () => void;
  alUsarReferencia: ((im: Imagen) => void) | undefined;
}) {
  const clip = visto?.tipo === 'corto' ? visto.c : null;
  const imagen = visto?.tipo === 'imagen' ? visto.im : null;
  return (
    <Dialogo
      abierto={visto !== null}
      alCambiar={a => {
        if (!a) alCerrar();
      }}
      titulo={clip ? clip.texto || 'Tu video corto' : 'Tu imagen'}
      acciones={
        <>
          {clip?.video && (
            <a className={claseBoton('secundario')} href={clip.video} download>
              <Icono nombre="descargar" /> Descargar
            </a>
          )}
          {imagen && (
            <>
              <a className={claseBoton('secundario')} href={imagen.url} download>
                <Icono nombre="descargar" /> Descargar
              </a>
              <a className={claseBoton('secundario')} href={'/imagenes.html?img=' + encodeURIComponent(imagen.nombre)}>
                Editar
              </a>
              {alUsarReferencia && (
                <button
                  type="button"
                  className={claseBoton('principal')}
                  onClick={() => {
                    alUsarReferencia(imagen);
                    alCerrar();
                  }}
                >
                  Usar como referencia
                </button>
              )}
            </>
          )}
        </>
      }
    >
      {clip ? (
        // el clip lo genera la IA con su audio: no hay pista de subtítulos que ofrecer
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video src={clip.video} controls playsInline autoPlay className="block max-h-[60vh] w-full rounded-medio bg-hundido" />
      ) : imagen ? (
        <img src={imagen.url} alt="" className="block max-h-[60vh] w-full rounded-medio bg-hundido object-contain" />
      ) : null}
    </Dialogo>
  );
}
