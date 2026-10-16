// Cada proyecto es una OBRA (mock): imagen grande, título abajo y, en las
// películas, la X para archivar. La tarjeta entera es el enlace; la X va por
// encima (un botón dentro de un <a> no es HTML válido).
//
// UI·26: en «Mis videos» la leyenda de abajo dice QUÉ es (Video largo, Video
// corto, Shorts, Cuento); el estado solo se agrega si todavía no está listo.
import { useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';

import { avisarCobro, refrescarSaldo, useSaldo } from '../../marca/useSaldo';
import { Recarga } from '../../marca/Recarga';
import { ErrorApi } from '../../nucleo/api';
import { ESTRELLA } from '../../nucleo/estrella';
import { entero } from '../../nucleo/formato';
import { tocarMiniatura } from '../../nucleo/transiciones';
import { Boton } from '../../ui/Boton';
import { Icono } from '../../ui/Icono';
import type { NombreIcono } from '../../ui/iconos';
import { unir } from '../../ui/unir';
import {
  archivable,
  archivo,
  diaImagen,
  esCopia,
  estadoDeCopia,
  estadoEdicion,
  estadoVideo,
  ETIQUETA,
  fechaCorta,
  forma,
  type Edicion,
  type ClipCorto,
  type Imagen,
  type Proyecto,
  type Video,
} from './logica';
import { faltanTras402 } from './edicion';
import { reintentarEdicion } from './envio';

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

/** Lo que abre el visor (un clip, una imagen) es un botón y no un enlace: no cambia de página. */
function TituloBoton({ texto, alAbrir, etiqueta }: { texto: string; alAbrir: () => void; etiqueta?: string }) {
  return (
    <button
      type="button"
      onClick={alAbrir}
      aria-label={etiqueta}
      title={texto}
      className={unir(ESTIRADO, 'm-0 w-full cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit]')}
    >
      <span className="block overflow-hidden text-sm font-semibold text-ellipsis whitespace-nowrap">
        {texto || '(sin título)'}
      </span>
    </button>
  );
}

type De<T extends Video['tipo']> = Extract<Video, { tipo: T }>;

/** UI·26: la tarjeta de cada cosa de «Mis videos». */
export function TarjetaVideo({
  v,
  alArchivar,
  alAbrirClip,
}: {
  v: Video;
  alArchivar: (p: Proyecto) => void;
  alAbrirClip: (c: ClipCorto) => void;
}) {
  if (v.tipo === 'corto') return <TarjetaClip v={v} alAbrir={alAbrirClip} />;
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
 *  video mismo, sin sonido ni controles) y abre en el visor de la galería. */
function TarjetaClip({ v, alAbrir }: { v: De<'corto'>; alAbrir: (c: ClipCorto) => void }) {
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
        {c.estado === 'listo' && c.video ? (
          <TituloBoton texto={c.texto} alAbrir={() => alAbrir(c)} />
        ) : (
          // generándose o con error: no hay nada que ver todavía
          <span className="block overflow-hidden text-sm font-semibold text-ellipsis whitespace-nowrap" title={c.texto}>
            {c.texto || '(sin título)'}
          </span>
        )}
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

export function TarjetaImagen({ im, alAbrir }: { im: Imagen; alAbrir: (im: Imagen) => void }) {
  const dia = diaImagen(im.creado);
  const [rota, setRota] = useState(false);
  const [detalle, setDetalle] = useState(dia);
  return (
    <button
      type="button"
      onClick={() => alAbrir(im)}
      aria-label={`Abrir tu imagen del ${dia}`}
      className={unir(TARJETA, 'cursor-pointer p-0 text-left font-[inherit]')}
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
      <span className="px-3 py-2.5 text-xs text-secundario">
        <span className="font-semibold text-texto">Imagen</span> · {detalle}
      </span>
    </button>
  );
}

/** `alReintentar`: el servidor aceptó el «Reintentar» de una copia que falló; devuelve cuando la lista de Mis creaciones ya se releyó. */
export function TarjetaEdicion({ e, alReintentar }: { e: Edicion; alReintentar?: (() => Promise<unknown> | void) | undefined }) {
  if (esCopia(e)) return <TarjetaCopia e={e} alReintentar={alReintentar} />;
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

/** El objetivo de «Recargar» dentro de una tarjeta de 172 px: como el de la caja, de 44 px y sin empujar a nadie. */
const RECARGA = 'text-xs min-h-11 min-w-11 px-2 -mx-2 -my-3 focus-visible:-outline-offset-3';

/**
 * E2 — una COPIA editada (uno o varios videos unidos): el título que la persona leyó al lanzarla («El tren de papel + 2 más»), su
 * estado y de dónde viene. Editando… no lleva a ningún lado (aún no hay nada que abrir) y se lee ocupada; Listo abre el editor de
 * cortes de ESA copia. Si no se pudo (de nuestro lado), lo dice y ofrece «Reintentar ✦ N» —el mismo que la ficha de «Tus trabajos»,
 * que desaparece al cerrarla o a las 24 h mientras esta tarjeta se queda—, salvo mientras se están devolviendo los créditos (cobraría
 * otra vez sin haber devuelto). La tarjeta no caduca: sale de /api/edicion/proyectos, no de «Tus trabajos». Sin título (un servidor
 * viejo) cae al nombre técnico.
 */
function TarjetaCopia({ e, alReintentar }: { e: Edicion; alReintentar?: (() => Promise<unknown> | void) | undefined }) {
  const st = estadoDeCopia(e);
  const titulo = e.titulo || e.nombre;
  const idTitulo = useId();
  const saldo = useSaldo();
  const boton = useRef<HTMLButtonElement>(null);
  const enElAire = useRef(false); // un doble clic es UN reintento: se cierra antes del primer await
  const [trabajando, setTrabajando] = useState(false);
  // lo que el servidor dijo al negar el reintento: sus palabras, tal cual (`faltan` si fue el 402)
  const [problema, setProblema] = useState<{ texto: string; faltan?: number } | null>(null);
  // lo que se cobró la vez anterior es lo que costará esta (el servidor lo vuelve a decidir y lo dice al aceptar)
  const cobrado = typeof e.editar?.creditos === 'number' && e.editar.creditos > 0 ? e.editar.creditos : null;

  async function reintentar() {
    if (enElAire.current) return;
    enElAire.current = true;
    setTrabajando(true);
    setProblema(null);
    try {
      const r = await reintentarEdicion(e.nombre);
      // el servidor aceptó y cobró: el «−N» vuela con lo que cobró ÉL, el saldo se pone al día y la lista se relee (la tarjeta pasa a «Editando…»)
      const costo = typeof r.creditos === 'number' && r.creditos > 0 ? r.creditos : (cobrado ?? 0);
      if (costo > 0) avisarCobro(costo, boton.current?.getBoundingClientRect() ?? null);
      refrescarSaldo();
      await alReintentar?.();
    } catch (err) {
      if (err instanceof ErrorApi && err.sinSaldo) {
        setProblema({ texto: '', faltan: faltanTras402(err.detalle, cobrado ?? 1, saldo) });
        refrescarSaldo();
      } else {
        // 409 (ya se reintenta, todavía se devuelve…), 502/503 (se devuelve lo cobrado): el texto del servidor, tal cual
        setProblema({ texto: err instanceof Error ? err.message : String(err) });
        // sin respuesta o 5xx: el servidor pudo cobrar o devolver sin que lo supiéramos
        if (err instanceof ErrorApi && (err.estado === 0 || err.estado >= 500)) refrescarSaldo();
      }
    } finally {
      enElAire.current = false;
      setTrabajando(false);
    }
  }

  const contenido = (
    <>
      <Hueco icono="cortar" />
      <span className="px-3 py-2.5">
        <span id={idTitulo} className="block overflow-hidden text-sm font-semibold text-ellipsis whitespace-nowrap" title={titulo}>
          {titulo}
        </span>
        <span className="block text-xs text-secundario">
          <Tono tono={st.tono}>
            <Icono nombre={st.icono} className="mr-1 align-[-0.15em]" />
            {st.texto}
          </Tono>
        </span>
        {st.nota && <span className="block text-xs text-secundario">{st.nota}</span>}
        <span className="block overflow-hidden text-xs text-secundario text-ellipsis whitespace-nowrap">Copia de {titulo}</span>
      </span>
    </>
  );
  // enlace solo cuando hay a dónde ir: una tarjeta que dice «Editando…» y lleva a ningún lado sería un enlace roto
  if (st.listo) {
    return (
      <a href={'/editor/' + encodeURIComponent(e.nombre) + '/'} className={unir(TARJETA, 'no-underline')}>
        {contenido}
      </a>
    );
  }
  return (
    <div className={TARJETA} {...(st.busy ? { 'aria-busy': true } : {})}>
      {contenido}
      {st.reintentable && (
        <div className="px-3 pb-3">
          <Boton
            ref={boton}
            nivel="secundario"
            aria-describedby={idTitulo}
            trabajando={trabajando && 'Reintentando…'}
            onClick={() => void reintentar()}
          >
            {cobrado ? `Reintentar ${ESTRELLA} ${entero(cobrado)}` : 'Reintentar'}
          </Boton>
          {problema && (
            <p role="alert" className="m-0 mt-2 text-xs text-error tabular-nums">
              {problema.faltan !== undefined ? (
                <>
                  Te faltan {ESTRELLA} {entero(problema.faltan)} · <Recarga className={RECARGA} />
                </>
              ) : (
                problema.texto
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
