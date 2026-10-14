// «Edición» (E1): lo que la caja del inicio enseña cuando la familia es Edición. Es solo lo que
// se ve; el estado, la subida, el precio y el cobro están en useEdicion (lo llama Caja, así que
// cambiar de familia no pierde el texto, el video ni una subida a medias).
//
// Un solo botón principal, SIEMPRE el mismo elemento, que se apaga con `aria-disabled` y no con
// `disabled`: apagado sigue enfocable y explica por qué (sin video avisa, sin texto lleva el
// foco al campo, fuera de rango lo lleva al «+»). Su aspecto de apagado es el de siempre
// (docs/DISENO.md §5: borde discontinuo, gris), no el ámbar a media opacidad del lienzo.
// «Subiendo…» y «Calculando…» NO son apagado sino «Trabajando» (§5, y el lienzo los pinta ámbar con el cursor
// de espera): conservan el ámbar, no se tragan el clic (avisa que hay un trabajo en curso) y se leen ocupados.
//
// Lo que la revisión visual y de accesibilidad exige aquí (cada cosa tiene su prueba en Edicion.test.tsx):
//   · el campo conserva el aro de foco de la carta (§4, «sin excepción»): llevarle el foco desde «Editar» o desde una
//     idea sin que se vea dónde cayó dejaba a quien usa teclado sin saber dónde está;
//   · el ejemplo del campo (placeholder) se lee con el gris secundario (6.45:1), no con el 50 % del texto (4.39:1), y
//     el campo crece lo que haga falta para que en un teléfono no se corte la última línea;
//   · el «Recargar» tiene 44 px de área táctil aunque su letra sea chica;
//   · cada apagado se explica con su propia línea (`aria-describedby`), no solo los de «sin texto» y «fuera».
import { useId } from 'react';

import { ESTRELLA } from '../../nucleo/estrella';
import { entero } from '../../nucleo/formato';
import { NotaSaldo } from '../../marca/NotaSaldo';
import { Recarga } from '../../marca/Recarga';
import { Boton } from '../../ui/Boton';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import {
  AYUDA_TEXTO,
  AYUDA_VIDEO,
  ETIQUETA_TEXTO,
  HUECO_TEXTO,
  IDEAS_EDICION,
  NOTA_CALCULANDO,
  NOTA_COPIA,
  NOTA_SIN_PRECIO,
  NOTA_SUBIENDO,
  reloj,
  tamano,
} from './edicion';
import { DESCRIPCION_VIDEOS, EXTS_VIDEO } from './envio';
import type { ManejoEdicion, RefsEdicion, VideoDeEdicion } from './useEdicion';

// lo que el selector de archivos deja escoger: las extensiones del servidor y los tipos que las acompañan
const ACEPTA = [...EXTS_VIDEO, 'video/mp4', 'video/quicktime'].join(',');

const NOTA = 'm-0 text-xs text-secundario';

// «Recargar» (cuando la recarga está abierta) es un enlace de una línea de letra chica: el área táctil de 44 px se la da
// el relleno, y los márgenes negativos la devuelven al renglón para que la nota no crezca ni se mueva. El aro de foco va
// por dentro (como el lienzo en sus avisos): por fuera taparía la línea de arriba
const RECARGA = 'text-xs min-h-11 min-w-11 px-2 -mx-2 -my-3 focus-visible:-outline-offset-3';

export function CajaEdicion({ ed, refs: { area, mas, archivos, principal } }: { ed: ManejoEdicion; refs: RefsEdicion }) {
  const idAyudaTexto = useId();
  const idAviso = useId();
  // la nota que explica el apagado cuando no es el aviso del servidor ni «escribe qué quieres» (solo hay una a la vez)
  const idNota = useId();
  const { video, boton, hayTexto } = ed;

  // lo que el botón principal dice, y por qué está apagado (los lectores de pantalla lo leen al enfocarlo)
  const etiqueta =
    boton.tipo === 'subiendo'
      ? 'Subiendo…'
      : boton.tipo === 'calculando'
        ? 'Calculando…'
        : boton.tipo === 'sin_texto' || boton.tipo === 'sin_saldo' || boton.tipo === 'listo'
          ? `Editar ${ESTRELLA} ${entero(boton.creditos)}`
          : 'Editar';
  // subiendo y calculando son «trabajando»: ámbar, cursor de espera y ocupado; no el gris discontinuo del apagado
  const esperando = boton.tipo === 'subiendo' || boton.tipo === 'calculando';
  const apagado = boton.tipo !== 'listo' && !esperando;
  const hayNota = esperando || boton.tipo === 'sin_precio' || (boton.tipo === 'sin_video' && hayTexto) || (boton.tipo === 'sin_saldo' && ed.saldo !== null);
  const describe = [
    boton.tipo === 'fuera' ? idAviso : '',
    (boton.tipo === 'sin_texto' || boton.tipo === 'fuera' || boton.tipo === 'sin_video') && !hayTexto ? idAyudaTexto : '',
    hayNota ? idNota : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      {video && <TarjetaVideo video={video} bloqueado={ed.lanzando} alQuitar={ed.quitar} />}
      {video && <p className={unir(NOTA, 'mb-3')}>{NOTA_COPIA}</p>}

      <textarea
        id="texto-edicion"
        ref={area}
        rows={2}
        maxLength={2000}
        aria-label={ETIQUETA_TEXTO}
        aria-required="true"
        value={ed.texto}
        onChange={e => ed.escribir(e.target.value)}
        placeholder={HUECO_TEXTO}
        // sin `outline-none`: el aro de foco de la carta (§4) lo pone tokens.css, y el campo es adonde se lleva el foco
        className="max-h-56 min-h-24 w-full resize-y rounded-chico border-0 bg-transparent p-0 text-sm text-texto field-sizing-content placeholder:text-secundario focus-visible:outline-offset-4 min-[640px]:min-h-17"
      />

      <div role="group" aria-label="Ideas para escribir" className="mt-2.5 flex flex-wrap gap-2">
        {IDEAS_EDICION.map(idea => (
          <button
            key={idea}
            type="button"
            onClick={() => ed.usarIdea(idea)}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-pildora border border-linea bg-transparent px-3 text-xs text-secundario hover:border-campo hover:bg-elevada hover:text-texto"
          >
            {idea}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-2.5 min-[640px]:flex-row min-[640px]:items-center">
        {/* oculto: lo abre el «+». El clic lo hace el botón, no el input */}
        <input
          ref={archivos}
          type="file"
          accept={ACEPTA}
          tabIndex={-1}
          aria-hidden="true"
          className="hidden"
          onChange={e => {
            ed.recibir(Array.from(e.target.files ?? []));
            e.target.value = ''; // para poder elegir el mismo archivo otra vez
          }}
        />
        <button
          ref={mas}
          type="button"
          aria-label={video ? 'Cambiar el video' : 'Agregar el video que quieres editar'}
          aria-disabled={ed.ocupado || undefined}
          title={`Agrega el video (${DESCRIPCION_VIDEOS}) o arrástralo a la caja`}
          onClick={ed.tocarMas}
          className="grid size-12 flex-none cursor-pointer place-items-center rounded-pildora border border-linea bg-transparent text-texto hover:border-campo aria-disabled:cursor-default aria-disabled:text-apagado aria-disabled:hover:border-linea min-[640px]:size-11"
        >
          <Icono nombre="mas" />
        </button>

        <div className="min-[640px]:ml-auto">
          <Boton
            ref={principal}
            nivel="principal"
            apagado={apagado}
            trabajando={ed.lanzando && 'Editando…'}
            // trabajando: ocupado y no disponible para quien lo lee, pero el clic llega (avisa que hay un trabajo en curso)
            {...(esperando ? { 'aria-busy': true, 'aria-disabled': true } : {})}
            {...(describe ? { 'aria-describedby': describe } : {})}
            onClick={ed.tocarEditar}
            className={unir('w-full min-[640px]:w-auto', esperando && 'cursor-progress')}
          >
            {etiqueta}
          </Boton>
        </div>
      </div>

      <div role="status" className="mt-2.5 flex flex-col gap-1">
        {boton.tipo === 'subiendo' && (
          <p id={idNota} className={NOTA}>
            {NOTA_SUBIENDO}
          </p>
        )}
        {boton.tipo === 'calculando' && (
          <p id={idNota} className={NOTA}>
            {NOTA_CALCULANDO}
          </p>
        )}
        {boton.tipo === 'sin_precio' && (
          <p id={idNota} className={NOTA}>
            {NOTA_SIN_PRECIO}
          </p>
        )}
        {boton.tipo === 'fuera' && (
          <p id={idAviso} className={unir(NOTA, 'text-texto')}>
            {boton.aviso}
          </p>
        )}
        {!hayTexto && (
          <p id={idAyudaTexto} className={NOTA}>
            {AYUDA_TEXTO}
          </p>
        )}
        {boton.tipo === 'sin_video' && hayTexto && (
          <p id={idNota} className={NOTA}>
            {AYUDA_VIDEO}
          </p>
        )}
        {boton.tipo === 'listo' && <NotaSaldo saldo={ed.saldo} costo={boton.creditos} />}
        {boton.tipo === 'sin_saldo' && ed.saldo !== null && (
          <p id={idNota} className={unir(NOTA, 'tabular-nums')}>
            Tienes {ESTRELLA} {entero(ed.saldo)}: no alcanza para editar este video.
          </p>
        )}
        {ed.faltan > 0 && (
          <p className={unir(NOTA, 'tabular-nums')}>
            Te faltan {ESTRELLA} {entero(ed.faltan)} · <Recarga className={RECARGA} />
          </p>
        )}
      </div>
    </>
  );
}

/** El video de la caja: nombre, de qué es, y su ✕ (que cancela la subida si aún sube; mientras sale el pedido, apagada). */
function TarjetaVideo({ video, bloqueado, alQuitar }: { video: VideoDeEdicion; bloqueado: boolean; alQuitar: () => void }) {
  const formato = (video.archivo.name.split('.').pop() ?? '').toUpperCase();
  // la duración la mide el servidor al calcular el precio: antes de eso solo se sabe lo que pesa
  const meta = video.costo
    ? [reloj(video.costo.duracion_s), formato, tamano(video.archivo.size)]
    : [formato, tamano(video.archivo.size)];
  const subiendo = video.fase === 'subiendo';
  return (
    <div className="mb-2 flex max-w-[440px] items-center gap-3 rounded-medio border border-linea bg-hundido py-1.5 pr-1 pl-1.5">
      <span className="grid h-11 w-18 flex-none place-items-center rounded-chico bg-elevada text-secundario">
        <Icono nombre="video" />
      </span>
      <div className="min-w-0 flex-1">
        <b className="block truncate text-sm font-semibold">{video.archivo.name}</b>
        <small className="block text-xs text-secundario tabular-nums">{meta.filter(Boolean).join(' · ')}</small>
        {subiendo && (
          <>
            <div
              role="progressbar"
              aria-label="Subiendo el video"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={video.pct}
              className="my-1.5 h-1 overflow-hidden rounded-chico bg-elevada"
            >
              <div className="h-full bg-ambar transition-[width] duration-300" style={{ width: `${video.pct}%` }} />
            </div>
            <small className="block text-xs text-secundario tabular-nums">
              Subiendo… {entero(video.pct)} %. No cierres esta pestaña.
            </small>
          </>
        )}
      </div>
      <button
        type="button"
        aria-label={subiendo ? 'Cancelar la subida' : 'Quitar este video'}
        aria-disabled={bloqueado || undefined}
        onClick={alQuitar}
        className="grid size-11 flex-none cursor-pointer place-items-center rounded-medio border-0 bg-transparent text-secundario hover:bg-elevada hover:text-texto aria-disabled:cursor-default aria-disabled:text-apagado aria-disabled:hover:bg-transparent aria-disabled:hover:text-apagado"
      >
        <Icono nombre="cerrar" />
      </button>
    </div>
  );
}
