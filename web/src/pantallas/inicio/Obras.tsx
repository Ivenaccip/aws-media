// Cada proyecto es una OBRA (mock): imagen grande, título abajo y, en las
// películas, la X para archivar. La tarjeta entera es el enlace; la X va por
// encima (un botón dentro de un <a> no es HTML válido).
import { useState, type ReactNode } from 'react';

import { Icono } from '../../ui/Icono';
import type { NombreIcono } from '../../ui/iconos';
import { unir } from '../../ui/unir';
import {
  archivable,
  archivo,
  diaImagen,
  ESTADO,
  estadoEdicion,
  fechaCorta,
  forma,
  type Edicion,
  type Imagen,
  type Proyecto,
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

export function TarjetaProyecto({ p, alArchivar }: { p: Proyecto; alArchivar: (p: Proyecto) => void }) {
  // portada rota (película anterior al frame de portada) → cae al personaje
  // elegido y solo al final al hueco, sin icono roto
  const fuentes = [p.miniatura, p.miniatura_alt].filter((x): x is string => Boolean(x)).map(n => archivo(p.id, n));
  const [intento, setIntento] = useState(0);
  const src = fuentes[intento];
  const e = ESTADO[p.estado];
  const fecha = fechaCorta(p.creado);
  return (
    <article className={TARJETA}>
      {src ? (
        <img src={src} alt="" loading="lazy" className={MINIATURA} onError={() => setIntento(i => i + 1)} />
      ) : (
        <Hueco icono="video" />
      )}
      <div className="px-3 py-2.5">
        <a href={'/crear.html?p=' + encodeURIComponent(p.id)} className={ESTIRADO} title={p.brief}>
          <span className="block overflow-hidden text-sm font-semibold text-ellipsis whitespace-nowrap">
            {p.brief || '(sin título)'}
          </span>
        </a>
        <p className="m-0 text-xs text-secundario">
          {e ? (
            <Tono tono={e.tono}>
              <Icono nombre={e.icono} className="mr-1 align-[-0.15em]" />
              {e.texto}
            </Tono>
          ) : (
            p.estado
          )}
          {fecha && ` · ${fecha}`}
        </p>
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

/** La tarjeta punteada del final: «Nueva película», «Nueva imagen». */
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
