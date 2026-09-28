// Cada proyecto es una OBRA (mock): imagen grande, título abajo y, en las
// películas, la X para archivar. La tarjeta entera es el enlace; la X va por
// encima (un botón dentro de un <a> no es HTML válido).
//
// UI·26: en «Mis videos» la leyenda de abajo dice QUÉ es (Video largo, Video
// corto, Shorts, Cuento); el estado solo se agrega si todavía no está listo.
import { useRef, useState, type MouseEvent, type ReactNode } from 'react';

import { tocarMiniatura } from '../../nucleo/transiciones';
import { Icono } from '../../ui/Icono';
import type { NombreIcono } from '../../ui/iconos';
import { unir } from '../../ui/unir';
import {
  archivable,
  archivo,
  diaImagen,
  estadoEdicion,
  estadoVideo,
  ETIQUETA,
  fechaCorta,
  forma,
  type Edicion,
  type Imagen,
  type Proyecto,
  type Video,
} from './logica';

const TARJETA =
  'relative flex flex-col overflow-hidden rounded-boton border border-linea bg-superficie text-texto transition-colors hover:border-campo';
// el ::after estira el enlace a toda la tarjeta
const ESTIRADO = 'text-texto no-underline after:absolute after:inset-0 after:content-[""]';
const MINIATURA = 'block aspect-[16/10] w-full border-b border-linea object-cover';

function Hueco({ icono }: { icono: NombreIcono }) {
  return (
    <div className={unir(MINIATURA, 'grid place-items-center bg-elevada text-secundario')}>
      <Icono nombre={icono} className="size-7" />
    </div>
  );
}

function Tono({ tono, children }: { tono?: 'ok' | 'mal' | undefined; children: ReactNode }) {
  return <span className={tono === 'ok' ? 'text-exito' : tono === 'mal' ? 'text-error' : undefined}>{children}</span>;
}

/** «Cuento · en revisión — te espera · 28/9/2026»; lista, «Video largo · 28/9/2026». */
function Leyenda({ v, fecha }: { v: Video; fecha: string }) {
  const e = estadoVideo(v);
  return (
    <p className="m-0 text-xs text-secundario">
      <span className="font-semibold text-texto">{ETIQUETA[v.tipo]}</span>
      {e && (
        <>
          {' · '}
          <Tono tono={e.tono}>
            <Icono nombre={e.icono} className="mr-1 align-[-0.15em]" />
            {e.texto}
          </Tono>
        </>
      )}
      {fecha && ` · ${fecha}`}
    </p>
  );
}

function Titulo({ href, texto, alAbrir }: { href: string; texto: string; alAbrir?: ((e: MouseEvent) => void) | undefined }) {
  return (
    <a href={href} className={ESTIRADO} title={texto} onClick={alAbrir}>
      <span className="block overflow-hidden text-sm font-semibold text-ellipsis whitespace-nowrap">
        {texto || '(sin título)'}
      </span>
    </a>
  );
}

type De<T extends Video['tipo']> = Extract<Video, { tipo: T }>;

/** UI·26: la tarjeta de cada cosa de «Mis videos». */
export function TarjetaVideo({ v, alArchivar }: { v: Video; alArchivar: (p: Proyecto) => void }) {
  if (v.tipo === 'corto') return <TarjetaClip v={v} />;
  if (v.tipo === 'shorts') return <TarjetaShorts v={v} />;
  return <TarjetaProyecto v={v} alArchivar={alArchivar} />;
}

function TarjetaProyecto({ v, alArchivar }: { v: De<'largo' | 'cuento'>; alArchivar: (p: Proyecto) => void }) {
  const { p } = v;
  // portada rota (película anterior al frame de portada) → cae al personaje
  // elegido y solo al final al hueco, sin icono roto
  const fuentes = [p.miniatura, p.miniatura_alt].filter((x): x is string => Boolean(x)).map(n => archivo(p.id, n));
  const [intento, setIntento] = useState(0);
  const src = fuentes[intento];
  const fecha = fechaCorta(p.creado);
  const img = useRef<HTMLImageElement>(null);
  // UI·18: una película lista abre en su reproductor, y esta miniatura se
  // agranda hasta él (nucleo/transiciones.ts). Las demás abren en su progreso
  // o su revisión: no hay a dónde agrandarse.
  const alAbrir =
    p.estado === 'listo' && src
      ? (e: MouseEvent) => {
          // con Ctrl/⌘/Shift/Alt se abre en otra pestaña o ventana: aquí no hay transición
          if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
          tocarMiniatura(p.id, src, img.current);
        }
      : undefined;
  return (
    <article className={TARJETA}>
      {src ? (
        <img ref={img} src={src} alt="" loading="lazy" className={MINIATURA} onError={() => setIntento(i => i + 1)} />
      ) : (
        <Hueco icono="video" />
      )}
      <div className="px-3 py-2.5">
        <Titulo href={'/crear.html?p=' + encodeURIComponent(p.id)} texto={p.brief} alAbrir={alAbrir} />
        <Leyenda v={v} fecha={fecha} />
      </div>
      {archivable(p) && (
        <button
          type="button"
          title="Archivar (no se borra nada)"
          aria-label={`Archivar «${p.brief || 'sin título'}»`}
          onClick={() => alArchivar(p)}
          className="absolute top-1 right-1 z-10 grid size-11 cursor-pointer place-items-center rounded-medio border-0 bg-hundido/70 text-texto hover:bg-hundido"
        >
          <Icono nombre="cerrar" />
        </button>
      )}
    </article>
  );
}

/** UI·26 — un clip de 8 s. Listo, su primer cuadro hace de miniatura (el
 *  video mismo, sin sonido ni controles); abre en su pantalla con `?c=`. */
function TarjetaClip({ v }: { v: De<'corto'> }) {
  const { c } = v;
  const [roto, setRoto] = useState(false);
  const fecha = fechaCorta(c.inicio ?? '');
  return (
    <article className={TARJETA}>
      {c.estado === 'listo' && c.video && !roto ? (
        // #t: que el navegador pinte un cuadro de adentro y no el negro del inicio
        <video
          src={c.video + '#t=0.5'}
          muted
          playsInline
          preload="metadata"
          aria-hidden="true"
          tabIndex={-1}
          className={unir(MINIATURA, 'bg-hundido')}
          onError={() => setRoto(true)}
        />
      ) : (
        <Hueco icono="video" />
      )}
      <div className="px-3 py-2.5">
        <Titulo href={'/clip.html?c=' + encodeURIComponent(c.id)} texto={c.texto} />
        <Leyenda v={v} fecha={fecha} />
      </div>
    </article>
  );
}

/** UI·26 — los shorts sacados de un video largo: abren en su pantalla con `?p=`. */
function TarjetaShorts({ v }: { v: De<'shorts'> }) {
  const { e } = v;
  const fecha = fechaCorta(e.shorts.inicio ?? e.creado ?? '');
  return (
    <article className={TARJETA}>
      <Hueco icono="shorts" />
      <div className="px-3 py-2.5">
        <Titulo href={'/shorts.html?p=' + encodeURIComponent(e.nombre)} texto={e.shorts.titulo || e.nombre} />
        <Leyenda v={v} fecha={fecha} />
      </div>
    </article>
  );
}

export function TarjetaImagen({ im }: { im: Imagen }) {
  const dia = diaImagen(im.creado);
  const [rota, setRota] = useState(false);
  const [detalle, setDetalle] = useState(dia);
  return (
    <a
      href={'/imagenes.html?img=' + encodeURIComponent(im.nombre)}
      aria-label={`Abrir tu imagen del ${dia} para editarla`}
      className={unir(TARJETA, 'no-underline')}
    >
      {rota ? (
        <Hueco icono="imagen" />
      ) : (
        <img
          src={im.url}
          alt=""
          loading="lazy"
          className={MINIATURA}
          onLoad={e => setDetalle(`${forma(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} · ${dia}`)}
          onError={() => setRota(true)}
        />
      )}
      <span className="px-3 py-2.5 text-xs text-secundario">{detalle}</span>
    </a>
  );
}

export function TarjetaEdicion({ e }: { e: Edicion }) {
  const st = estadoEdicion(e);
  return (
    <a href={'/e1.html?p=' + encodeURIComponent(e.nombre)} className={unir(TARJETA, 'no-underline')}>
      <Hueco icono="cortar" />
      <span className="px-3 py-2.5">
        <span className="block overflow-hidden text-sm font-semibold text-ellipsis whitespace-nowrap">{e.nombre}</span>
        <span className="block text-xs text-secundario">
          <Tono tono={st.tono}>
            {st.icono && <Icono nombre={st.icono} className="mr-1 align-[-0.15em]" />}
            {st.texto}
          </Tono>
        </span>
      </span>
    </a>
  );
}

/** La tarjeta punteada del final: «Nuevo video», «Nueva imagen». */
export function TarjetaNueva({ texto, href, alPulsar }: { texto: string; href?: string; alPulsar?: () => void }) {
  const clase =
    'grid min-h-[150px] cursor-pointer place-items-center rounded-boton border border-dashed border-linea bg-superficie text-sm text-secundario no-underline transition-colors hover:border-campo hover:text-texto';
  const dentro = (
    <span className="flex items-center gap-2">
      <Icono nombre="mas" />
      {texto}
    </span>
  );
  return href ? (
    <a href={href} className={clase}>
      {dentro}
    </a>
  ) : (
    <button type="button" onClick={alPulsar} className={unir(clase, 'w-full')}>
      {dentro}
    </button>
  );
}
