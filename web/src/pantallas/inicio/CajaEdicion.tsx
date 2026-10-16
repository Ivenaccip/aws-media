// «Edición» (E1 y E2): lo que la caja del inicio enseña cuando la familia es Edición. Es solo lo que
// se ve; el estado, la subida, el precio y el cobro están en useEdicion (lo llama Caja, así que
// cambiar de familia no pierde el texto, los videos ni una subida a medias).
//
// E2: el «+» de Editar abre un MENÚ (`role="menu"`, como el de Imagen): «Subir de tu computadora» (varios, en cola) y «Elegir de Mis
// creaciones» (la hoja «Agregar videos», HojaVideos.tsx). Con UN video la caja enseña su tarjeta; con DOS o más, el bloque «N videos ·
// se unen en este orden» con una fila por video y Subir / Bajar / Quitar (el orden de la lista es el orden en que se unen). En el modo
// Shorts nada de esto cambia: un solo video y el «+» abre el selector de archivos directo.
//
// La fila de abajo es la de Video: «+» y el chip «Editar ▾» a la izquierda (el MISMO SelectorOpcion que Imagen y Video, con
// dos opciones: Editar y De videos a Shorts) y el botón principal a la derecha (en un teléfono, abajo, a todo el ancho).
//
// El modo Shorts cambia solo el cuerpo (un texto de apoyo y el campo de la liga de YouTube, en lugar del cuadro donde se
// le escribe a la IA) y a dónde lleva «Iniciar»: no cobra nada, navega a /estudio/shorts/ con la liga o el video ya subido
// (el «+» sube con la misma tarjeta, progreso y «cancelar» que en Editar). El botón, la fila y los avisos son los mismos.
//
// Un solo botón principal, «Iniciar», SIEMPRE el mismo elemento y SIEMPRE ámbar (dueño, 14-oct-2026: «dorado como el de
// Generar»). Cuando aún no se puede, no se pinta apagado: se queda ámbar y explica al pulsarlo, igual que «Crear» de
// Imagen y Video (docs/DISENO.md §5). Eso sí se apaga en la semántica —`aria-disabled` y no `disabled`—, así que sigue
// enfocable y explica por qué (sin video avisa, sin texto lleva el foco al campo, fuera de rango lo lleva al «+»).
// «Subiendo…» y «Calculando…» son «Trabajando» (§5): ámbar, cursor de espera, no se tragan el clic (avisa que hay un
// trabajo en curso) y se leen ocupados.
//
// Las ideas ya no son botones (dueño, 14-oct-2026: «Rotan solas como pista»): en el lugar del texto gris del campo va
// apareciendo y desapareciendo UNA idea a la vez (usePistaRotatoria). Es el `placeholder` NATIVO del <textarea> con su
// opacidad en transición, y no una capa encima: alinea idéntico al texto que se escriba, no tapa clics, desaparece solo al
// escribir y no hay nada que desalinear. Chromium transiciona `::placeholder` (se midió; ver docs/migracion/inicio.md). No
// se anuncia (sin aria-live) y no es el nombre del campo (ese es su aria-label): quien usa lector de pantalla recibe un
// ejemplo fijo como descripción del campo (EJEMPLO_FIJO, en un <p hidden>: solo lo lee `aria-describedby`, no queda suelto
// en el árbol de accesibilidad). La pista solo corre mientras la caja se ve (`enVista`): la tarjeta del inicio la esconde sin
// desmontarla, y escondida no tiene por qué rotar; al volver, empieza otra vez en la primera idea.
//
// Lo que la revisión visual y de accesibilidad exige aquí (cada cosa tiene su prueba en Edicion.test.tsx):
//   · el campo está en un cuadro bien definido (ui/CuadroDeTexto: borde de campo y fondo elevada) y ese cuadro lleva el aro
//     de foco de la carta (§4, «sin excepción»): llevarle el foco desde «Iniciar» sin que se vea dónde cayó dejaba a quien
//     usa teclado sin saber dónde está;
//   · la pista del campo (placeholder) se lee con el gris secundario (6.45:1 sobre la superficie, 5.72:1 sobre el cuadro
//     elevada, que es donde vive), no con el 50 % del texto (4.39:1 sobre la superficie, 4.11:1 sobre elevada), y
//     el campo crece lo que haga falta para que en un teléfono no se corte la última línea (y no cambia de alto al cambiar de idea);
//   · el «Recargar» tiene 44 px de área táctil aunque su letra sea chica;
//   · cada estado del botón se explica con su propia línea (`aria-describedby`), no solo los de «sin texto» y «fuera».
import { useEffect, useId, useRef, useState } from 'react';

import { ESTRELLA } from '../../nucleo/estrella';
import { entero } from '../../nucleo/formato';
import { NotaSaldo } from '../../marca/NotaSaldo';
import { Recarga } from '../../marca/Recarga';
import { Boton } from '../../ui/Boton';
import { Campo } from '../../ui/Campo';
import { CuadroDeTexto } from '../../ui/CuadroDeTexto';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import {
  APOYO_SHORTS,
  AYUDA_TEXTO,
  AYUDA_VIDEO,
  EJEMPLO_FIJO,
  ETIQUETA_LIGA,
  ETIQUETA_TEXTO,
  HUECO_LIGA,
  huecoDe,
  IDEAS_EDICION,
  IDEAS_UNION,
  modoDe,
  MODOS_EDICION,
  NOTA_CALCULANDO,
  NOTA_COPIA,
  NOTA_COPIA_VARIOS,
  NOTA_SIN_PRECIO,
  NOTA_SUBIENDO,
  notaDeShorts,
  reloj,
  tamano,
} from './edicion';
import { DESCRIPCION_VIDEOS, EXTS_VIDEO } from './envio';
import { ALTO_DE_ACCION, ANCHO_DE_ACCION } from './medidas';
import { bloqueoDeSubir, descripcionDeSubir, duracionCompleta, rotuloDeFormato, rotuloDeTipo, sumar, type FichaDeVideo } from './reglasVideos';
import { SelectorOpcion } from './SelectorOpcion';
import type { ManejoEdicion, RefsEdicion, VideoDeEdicion } from './useEdicion';
import { usePistaRotatoria } from './usePistaRotatoria';

// lo que el selector de archivos deja escoger: las extensiones del servidor y los tipos que las acompañan
const ACEPTA = [...EXTS_VIDEO, 'video/mp4', 'video/quicktime'].join(',');

const NOTA = 'm-0 text-xs text-secundario';

// El fundido de la pista, sobre el `::placeholder` del campo (Tailwind: `placeholder:`): la opacidad con el token de duración
// de la carta (--dur-media: algo que entra o sale). Lo que entra frena al llegar (--ease-salida) y lo que se va acelera
// (--ease-entrada); una transición usa la curva del estado al que VA. Con «reducir movimiento» ni se rota ni se transiciona
// (`::placeholder` no es `*`: la regla global de tokens.css no lo alcanza, por eso el motion-reduce propio).
const PISTA = 'placeholder:transition-opacity placeholder:duration-(--dur-media) motion-reduce:placeholder:transition-none';
const PISTA_ENTRA = 'placeholder:opacity-100 placeholder:ease-(--ease-salida)';
const PISTA_SALE = 'placeholder:opacity-0 placeholder:ease-(--ease-entrada)';

// «Recargar» (cuando la recarga está abierta) es un enlace de una línea de letra chica: el área táctil de 44 px se la da
// el relleno, y los márgenes negativos la devuelven al renglón para que la nota no crezca ni se mueva. El aro de foco va
// por dentro (como el lienzo en sus avisos): por fuera taparía la línea de arriba
const RECARGA = 'text-xs min-h-11 min-w-11 px-2 -mx-2 -my-3 focus-visible:-outline-offset-3';

export function CajaEdicion({
  ed,
  refs: { area, liga, mas, archivos, principal },
  enVista,
  alElegirDeCreaciones,
}: {
  ed: ManejoEdicion;
  refs: RefsEdicion;
  /** La tarjeta del inicio tiene la caja a la vista. Falso = sigue montada pero escondida (mapa, opciones o lista): la pista no corre. */
  enVista: boolean;
  /** «Elegir de Mis creaciones» del menú del «+»: abre la hoja «Agregar videos». La hoja vive en Caja, FUERA de la sección que recibe lo
   *  que se arrastra (como la de imágenes): lo que se suelta o se hace en ella no sube hasta el arrastre de la caja. */
  alElegirDeCreaciones: () => void;
}) {
  const idAyudaTexto = useId();
  const idAviso = useId();
  // la nota que explica el apagado cuando no es el aviso del servidor ni «escribe qué quieres» (solo hay una a la vez)
  const idNota = useId();
  const idEjemplo = useId();
  const { videos, boton, hayTexto } = ed;
  const video = ed.video;
  const enShorts = ed.modo === 'shorts';
  const varios = videos.length > 1;
  // la nota de Shorts: si «Iniciar» va a llevar a otra pantalla se dice; si no (nada puesto, o una liga que no es de YouTube), lo
  // único que se promete es que subir es gratis. Va en el mismo lugar y con el mismo id que la nota que explica el apagado en Editar
  const notaShorts = notaDeShorts({ video, liga: ed.liga });

  // el menú del «+» (solo en Editar)
  const [menu, setMenu] = useState(false);
  const contenedorMas = useRef<HTMLDivElement>(null);
  const fichas: FichaDeVideo[] = videos.map(v => ({ ref: v.ref, duracion_s: v.duracion_s, formato: v.formato, bytes: v.bytes }));
  const sinCupo = bloqueoDeSubir(fichas);

  // un clic fuera o Esc lo cierra (con Esc el foco vuelve al «+», si estaba en el menú); al abrir, el foco va a su primera opción
  useEffect(() => {
    if (!menu) return;
    const fuera = (e: MouseEvent) => {
      if (!contenedorMas.current?.contains(e.target as Node)) setMenu(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenu(false);
      const foco = document.activeElement;
      if (!foco || foco === document.body || contenedorMas.current?.contains(foco)) mas.current?.focus();
    };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', esc);
    contenedorMas.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', esc);
    };
  }, [menu, mas]);

  // cambiar a Shorts (o a otra familia, que desmonta esta caja) deja sin menú: se ajusta al renderizar, no en un efecto
  if (enShorts && menu) setMenu(false);

  function alPulsarMas() {
    if (enShorts) {
      ed.tocarMas();
      return;
    }
    if (menu) {
      setMenu(false);
      return;
    }
    // con una subida o una corrida en marcha no se abre: dice por qué
    if (ed.puedeAgregar()) setMenu(true);
  }

  /** Flechas, Inicio y Fin recorren las opciones del menú; Tab lo cierra y sigue al control que viene después del «+». */
  function teclasDelMenu(e: React.KeyboardEvent<HTMLDivElement>) {
    const opciones = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const i = opciones.indexOf(document.activeElement as HTMLElement);
    const ir = (j: number) => {
      e.preventDefault();
      opciones[(j + opciones.length) % opciones.length]?.focus();
    };
    if (e.key === 'ArrowDown') ir(i + 1);
    else if (e.key === 'ArrowUp') ir(i < 0 ? opciones.length - 1 : i - 1);
    else if (e.key === 'Home') ir(0);
    else if (e.key === 'End') ir(opciones.length - 1);
    else if (e.key === 'Tab') {
      setMenu(false);
      mas.current?.focus(); // sin preventDefault: el Tab de ahora sigue desde el «+»
    }
  }

  // la pista rota solo con el campo vacío y sin el foco: con texto no se ve, y quien va a escribir no la debe ver cambiar
  // bajo el cursor (se congela en la que estaba; al soltar el foco con el campo vacío, retoma)
  const [enfocado, setEnfocado] = useState(false);
  // y solo con el campo a la vista: la caja escondida por el mapa, las opciones o una lista sigue montada (con su texto y su
  // video), y en Shorts el campo es otro. Sin campo a la vista no corre ningún reloj, y al volver (a la caja, o de Shorts a
  // Editar) la pista arranca otra vez en la primera idea
  const campoAlaVista = enVista && !enShorts;
  // un campo que se esconde pierde el foco, y Chromium lo avisa con blur (se midió), pero no se da por hecho que todos los navegadores
  // lo hagan. Con un `enfocado` viejo la pista volvería congelada y sin nadie escribiendo, así que se suelta aquí y no se espera el aviso
  if (!campoAlaVista && enfocado) setEnfocado(false);
  // con dos o más videos la pista suma «Únelos en este orden y quita los silencios» como primera idea
  const pista = usePistaRotatoria(varios ? IDEAS_UNION : IDEAS_EDICION, enfocado || ed.texto !== '', campoAlaVista);

  // lo que el botón principal dice (los lectores de pantalla lo leen al enfocarlo, con su descripción)
  const etiqueta = enShorts
    ? ed.botonShorts.tipo === 'subiendo'
      ? 'Subiendo…'
      : 'Iniciar'
    : boton.tipo === 'subiendo'
      ? 'Subiendo…'
      : boton.tipo === 'calculando'
        ? 'Calculando…'
        : boton.tipo === 'sin_texto' || boton.tipo === 'sin_saldo' || boton.tipo === 'listo'
          ? `Iniciar ${ESTRELLA} ${entero(boton.creditos)}`
          : 'Iniciar';
  // subiendo y calculando son «trabajando»: ocupado y con cursor de espera
  const esperando = enShorts ? ed.botonShorts.tipo === 'subiendo' : boton.tipo === 'subiendo' || boton.tipo === 'calculando';
  // «Iniciar» solo cobra o navega cuando el estado es `listo`; en cualquier otro, sigue ámbar pero `aria-disabled` y explica
  const apagado = enShorts ? ed.botonShorts.tipo !== 'listo' : boton.tipo !== 'listo';
  const hayNota = esperando || boton.tipo === 'sin_precio' || (boton.tipo === 'sin_video' && hayTexto) || (boton.tipo === 'sin_saldo' && ed.saldo !== null);
  const describe = enShorts
    ? idNota
    : [
        boton.tipo === 'fuera' ? idAviso : '',
        (boton.tipo === 'sin_texto' || boton.tipo === 'fuera' || boton.tipo === 'sin_video') && !hayTexto ? idAyudaTexto : '',
        hayNota ? idNota : '',
      ]
        .filter(Boolean)
        .join(' ');

  return (
    <>
      {enShorts ? (
        <>
          <p className="m-0 mb-3 text-sm text-secundario">{APOYO_SHORTS}</p>
          {/* con un video subido manda su tarjeta y el campo se va (la liga queda escrita: vuelve al quitar el video) */}
          {video ? (
            <TarjetaVideo video={video} bloqueado={ed.lanzando} alQuitar={() => ed.quitar(video.id)} />
          ) : (
            <Campo
              ref={liga}
              etiqueta={ETIQUETA_LIGA}
              etiquetaOculta
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              maxLength={2000}
              placeholder={HUECO_LIGA}
              value={ed.liga}
              error={ed.errorLiga}
              onChange={e => ed.escribirLiga(e.target.value)}
              // Enter es «Iniciar», como en cualquier cuadro de una sola línea (no es un <form>: aquí no hay envío nativo)
              onKeyDown={e => {
                if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                e.preventDefault();
                ed.tocarIniciar();
              }}
              // la pista con el gris secundario, como la del cuadro de escribir (el 50 % del texto no llega a 4.5:1 sobre elevada)
              className="placeholder:text-secundario"
            />
          )}
        </>
      ) : (
        <>
          {/* UN video: su tarjeta y la nota de la copia. DOS o más: el bloque de la unión, con su orden */}
          {videos.length === 1 && videos[0] && (
            <>
              <TarjetaVideo video={videos[0]} bloqueado={ed.lanzando} alQuitar={() => ed.quitar(videos[0]!.id)} />
              <p className={unir(NOTA, 'mb-3')}>{NOTA_COPIA}</p>
            </>
          )}
          {varios && <BloqueUnion ed={ed} />}

          <CuadroDeTexto
            id="texto-edicion"
            ref={area}
            rows={2}
            maxLength={2000}
            aria-label={ETIQUETA_TEXTO}
            aria-required="true"
            aria-describedby={idEjemplo}
            value={ed.texto}
            onChange={e => ed.escribir(e.target.value)}
            onFocus={() => setEnfocado(true)}
            onBlur={() => setEnfocado(false)}
            placeholder={huecoDe(pista.idea)}
            className={unir(
              'max-h-56 min-h-24 resize-y field-sizing-content min-[640px]:min-h-17',
              PISTA,
              pista.saliendo ? PISTA_SALE : PISTA_ENTRA,
            )}
          />
          {/* el ejemplo que no rota, para el lector de pantalla: solo es la descripción del campo (`aria-describedby` lee el texto
              aunque el <p> esté oculto). Oculto de verdad (`hidden`) y no solo invisible (`sr-only`): si no, en modo lectura el
              lector lo recita como un párrafo suelto entre el campo y el «+», y otra vez al enfocar el campo. A la vista ya está la
              pista de arriba, rotando */}
          <p id={idEjemplo} hidden>
            {EJEMPLO_FIJO}
          </p>
        </>
      )}

      <div className="mt-3 flex flex-col gap-2.5 min-[640px]:flex-row min-[640px]:flex-wrap min-[640px]:items-center">
        {/* oculto: lo abre el «+». El clic lo hace el botón, no el input. En Editar admite VARIOS archivos (van en cola) */}
        <input
          ref={archivos}
          type="file"
          accept={ACEPTA}
          multiple={!enShorts}
          tabIndex={-1}
          aria-hidden="true"
          className="hidden"
          onChange={e => {
            ed.recibir(Array.from(e.target.files ?? []));
            e.target.value = ''; // para poder elegir el mismo archivo otra vez
          }}
        />
        <div className="flex min-w-0 gap-2.5">
          <div ref={contenedorMas} className="relative flex-none">
            <button
              ref={mas}
              type="button"
              aria-label={
                enShorts
                  ? video
                    ? 'Cambiar el video'
                    : 'Agregar el video largo'
                  : videos.length
                    ? 'Agregar otro video'
                    : 'Agregar el video que quieres editar'
              }
              aria-disabled={ed.ocupado || undefined}
              {...(enShorts ? {} : { 'aria-haspopup': 'menu' as const, 'aria-expanded': menu })}
              title={`Agrega el video (${DESCRIPCION_VIDEOS}) o arrástralo a la caja`}
              onClick={alPulsarMas}
              className="grid size-12 flex-none cursor-pointer place-items-center rounded-pildora border border-linea bg-transparent text-texto hover:border-campo aria-disabled:cursor-default aria-disabled:text-apagado aria-disabled:hover:border-linea min-[640px]:size-11"
            >
              <Icono nombre="mas" />
            </button>
            {menu && !enShorts && (
              <div
                role="menu"
                aria-label="Agregar videos"
                tabIndex={-1}
                onKeyDown={teclasDelMenu}
                className={unir(
                  'absolute left-0 z-20 w-[min(340px,calc(100vw-48px))] rounded-grande border border-linea bg-superficie p-1.5',
                  // con dos o más videos la caja ya es alta: el menú se abre hacia arriba para no salirse de la pantalla
                  varios ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]',
                )}
              >
                <button
                  type="button"
                  role="menuitem"
                  aria-disabled={sinCupo !== null || undefined}
                  onClick={() => {
                    if (sinCupo !== null) return; // apagado: dice por qué en su subtítulo y el menú se queda
                    setMenu(false);
                    ed.abrirSelector();
                  }}
                  className={unir(ITEM, sinCupo !== null && 'cursor-default text-apagado hover:bg-transparent')}
                >
                  <Icono nombre="subir" className="text-secundario" />
                  <span className="block min-w-0 flex-1">
                    <b className="block text-sm font-semibold">Subir de tu computadora</b>
                    <small className="block text-xs text-secundario">{sinCupo ?? descripcionDeSubir()}</small>
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    alElegirDeCreaciones();
                  }}
                  className={ITEM}
                >
                  <Icono nombre="video" className="text-secundario" />
                  <span className="block min-w-0 flex-1">
                    <b className="block text-sm font-semibold">Elegir de Mis creaciones</b>
                    <small className="block text-xs text-secundario">Videos que ya hiciste con IA: elige uno o varios</small>
                  </span>
                </button>
                <p className="m-0 mx-1 mt-1 border-t border-linea px-1.5 pt-2.5 pb-1.5 text-xs text-secundario">
                  También puedes arrastrar el video a la caja.
                </p>
              </div>
            )}
          </div>
          {/* el mismo chip que Imagen y Video: elegir un modo cambia el cuerpo de la caja (elegir el de ahora solo cierra la lista) */}
          <SelectorOpcion opciones={MODOS_EDICION} elegida={modoDe(ed.modo)} detalle={m => m.detalle} alElegir={m => ed.elegirModo(m.id)} />
        </div>

        <div className="flex flex-col gap-2.5 min-[640px]:ml-auto min-[640px]:flex-row min-[640px]:items-center">
          <Boton
            ref={principal}
            nivel="principal"
            trabajando={ed.lanzando && 'Iniciando…'}
            // ámbar en todos los estados: NO se le pasa `apagado` (que lo pintaría gris y discontinuo). Lo que sí queda es la
            // semántica: `aria-disabled` mientras no se pueda, y el clic llega para explicar por qué
            {...(apagado ? { 'aria-disabled': true } : {})}
            // trabajando: ocupado y no disponible para quien lo lee, pero el clic llega (avisa que hay un trabajo en curso)
            {...(esperando ? { 'aria-busy': true } : {})}
            {...(describe ? { 'aria-describedby': describe } : {})}
            onClick={ed.tocarIniciar}
            // en escritorio mide lo que el selector de modelo de Video (medidas.ts): mismo ancho mínimo y mismo alto que el resto de la fila
            className={unir('w-full min-[640px]:w-auto', ANCHO_DE_ACCION, ALTO_DE_ACCION, esperando && 'cursor-progress')}
          >
            {etiqueta}
          </Boton>
        </div>
      </div>

      {/* `has-`: la ayuda de abajo es solo para el lector de pantalla (`sr-only`); sin ninguna nota a la vista no deja el margen vacío */}
      <div role="status" className="flex flex-col gap-1 has-[>:not(.sr-only)]:mt-2.5">
        {enShorts ? (
          <p id={idNota} className={NOTA}>
            {notaShorts}
          </p>
        ) : (
          <>
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
            {/* el aviso del servidor, TAL CUAL: «Un video de menos de 1 min no se puede editar solo…», «Los videos horizontales y los
                verticales no se mezclan…». La caja no duplica sus textos */}
            {boton.tipo === 'fuera' && (
              <p id={idAviso} className={unir(NOTA, 'text-texto')}>
                {boton.aviso}
              </p>
            )}
            {/* «Escribe qué quieres hacer con tu video.» ya no se ve (dueño, 15-oct-2026: «quita el texto»), pero cumple una función: es la
                descripción de «Iniciar» (`aria-describedby`) mientras no hay texto, y quitarla del todo dejaría a quien usa lector de
                pantalla sin saber por qué no avanza. Queda solo para él (`sr-only`), en la misma región de estado, así que se anuncia igual
                que antes */}
            {!hayTexto && (
              <p id={idAyudaTexto} className="sr-only">
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
                Tienes {ESTRELLA} {entero(ed.saldo)}: no alcanza para editar {varios ? 'estos videos' : 'este video'}.
              </p>
            )}
            {ed.faltan > 0 && (
              <p className={unir(NOTA, 'tabular-nums')}>
                Te faltan {ESTRELLA} {entero(ed.faltan)} · <Recarga className={RECARGA} />
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}

const ITEM =
  'flex w-full min-h-14 cursor-pointer items-center gap-3 rounded-medio border-0 bg-transparent px-2.5 py-2 text-left text-texto hover:bg-elevada';

/** Lo que se sabe de un video para su línea de meta, en UNA línea: una creación, «Película · 0:30 · 16:9»; un archivo subido,
 *  «12:04 · MP4 · 824 MB» (la duración llega con el primer precio: antes de eso, solo el formato y el peso). */
function metaDe(v: VideoDeEdicion): string {
  const duracion = v.duracion_s === null ? '' : reloj(v.duracion_s);
  if (v.origen === 'creacion') return [v.tipo ? rotuloDeTipo(v.tipo) : '', duracion, rotuloDeFormato(v.formato)].filter(Boolean).join(' · ');
  const extension = (v.archivo?.name.split('.').pop() ?? '').toUpperCase();
  return [duracion, extension, v.archivo ? tamano(v.archivo.size) : ''].filter(Boolean).join(' · ');
}

/**
 * La unión (dos o más videos): «N videos · 1:12 · se unen en este orden», una fila por video con su número, y la nota de las copias.
 * Subir y Bajar solo cambian el orden (no cobran ni vuelven a cotizar); cada fila mide al menos 44 px y sus tres botones, 44 × 44. Desde
 * la 5.ª fila la lista tiene alto máximo de cuatro y se desplaza por dentro: la caja no crece sin límite.
 */
function BloqueUnion({ ed }: { ed: ManejoEdicion }) {
  const { videos } = ed;
  const total = duracionCompleta(videos) ? sumar(videos) : null;
  // al mover una fila el navegador puede soltar el foco del botón que se pulsó (el nodo cambia de lugar): se le devuelve, al mismo botón
  const foco = useRef<{ id: string; accion: 'subir' | 'bajar' } | null>(null);
  useEffect(() => {
    const f = foco.current;
    if (!f) return;
    foco.current = null;
    document.querySelector<HTMLElement>(`[data-fila="${f.id}"] [data-accion="${f.accion}"]`)?.focus();
  }, [videos]);
  return (
    <div role="group" aria-label="Videos que se unen" className="mb-3 max-w-[560px] rounded-medio border border-linea bg-hundido p-2">
      <p className="m-0 mb-2 px-1 text-sm">
        <b className="font-semibold tabular-nums">
          {videos.length} videos{total !== null && ` · ${reloj(total)}`}
        </b>{' '}
        · se unen en este orden
      </p>
      <ul
        aria-label="Orden de los videos"
        className={unir('m-0 flex list-none flex-col gap-1.5 p-0', videos.length >= 5 && 'max-h-[15.125rem] overflow-y-auto')}
      >
        {videos.map((v, i) => (
          <FilaDeVideo
            key={v.id}
            v={v}
            posicion={i}
            total={videos.length}
            bloqueado={ed.lanzando}
            alMover={(d, accion) => {
              foco.current = { id: v.id, accion };
              ed.mover(v.id, d);
            }}
            alQuitar={() => ed.quitar(v.id)}
          />
        ))}
      </ul>
      <p className={unir(NOTA, 'mt-2 px-1')}>{NOTA_COPIA_VARIOS}</p>
      {/* el lector de pantalla oye dónde quedó el video que se movió */}
      <div role="status" className="sr-only">
        {ed.movido}
      </div>
    </div>
  );
}

const BOTON_FILA =
  'grid size-11 flex-none cursor-pointer place-items-center rounded-medio border-0 bg-transparent text-secundario hover:bg-elevada hover:text-texto aria-disabled:cursor-default aria-disabled:text-apagado aria-disabled:hover:bg-transparent aria-disabled:hover:text-apagado';

function FilaDeVideo({
  v,
  posicion,
  total,
  bloqueado,
  alMover,
  alQuitar,
}: {
  v: VideoDeEdicion;
  posicion: number;
  total: number;
  bloqueado: boolean;
  alMover: (d: -1 | 1, accion: 'subir' | 'bajar') => void;
  alQuitar: () => void;
}) {
  const subiendo = v.fase === 'subiendo';
  const primera = posicion === 0;
  const ultima = posicion === total - 1;
  const meta = metaDe(v);
  return (
    // `flex-wrap`: en 320 px no caben el nombre (al menos 8 rem) y los tres botones de 44 px en una línea; los botones pasan juntos a la
    // línea de abajo, a la derecha, en vez de aplastar el nombre hasta dejarlo ilegible
    <li data-fila={v.id} className="flex min-h-14 flex-wrap items-center gap-x-2 rounded-medio border border-linea bg-superficie py-1 pr-1 pl-2">
      <span aria-hidden="true" className="grid size-6 flex-none place-items-center rounded-pildora bg-elevada text-xs font-semibold tabular-nums">
        {posicion + 1}
      </span>
      {/* en una pantalla muy angosta (320 px) no cabe la miniatura junto a los tres botones de 44 px: el nombre manda */}
      <span aria-hidden="true" className="hidden h-9 w-14 flex-none place-items-center rounded-chico bg-elevada text-secundario min-[400px]:grid">
        <Icono nombre="video" />
      </span>
      <div className="min-w-0 flex-1 basis-32">
        <b className="block truncate text-sm font-semibold" title={v.nombre}>
          {v.nombre}
        </b>
        {v.fase === 'en_cola' ? (
          <small className="block truncate text-xs text-secundario">En cola</small>
        ) : (
          meta && <small className="block truncate text-xs text-secundario tabular-nums">{meta}</small>
        )}
        {subiendo && (
          <>
            <div
              role="progressbar"
              aria-label={`Subiendo “${v.nombre}”`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={v.pct}
              className="my-1 h-1 overflow-hidden rounded-chico bg-elevada"
            >
              <div className="h-full bg-ambar transition-[width] duration-300" style={{ width: `${v.pct}%` }} />
            </div>
            <small className="block text-xs text-secundario tabular-nums">Subiendo… {entero(v.pct)} %. No cierres esta pestaña.</small>
          </>
        )}
      </div>
      <div className="ml-auto flex flex-none">
        <button
          type="button"
          data-accion="subir"
          aria-label={`Subir “${v.nombre}”`}
          aria-disabled={primera || bloqueado || undefined}
          onClick={() => {
            if (!primera && !bloqueado) alMover(-1, 'subir');
          }}
          className={BOTON_FILA}
        >
          <Icono nombre="arriba" />
        </button>
        <button
          type="button"
          data-accion="bajar"
          aria-label={`Bajar “${v.nombre}”`}
          aria-disabled={ultima || bloqueado || undefined}
          onClick={() => {
            if (!ultima && !bloqueado) alMover(1, 'bajar');
          }}
          className={BOTON_FILA}
        >
          <Icono nombre="abajo" />
        </button>
        <button
          type="button"
          aria-label={subiendo ? `Cancelar la subida de “${v.nombre}”` : `Quitar “${v.nombre}”`}
          aria-disabled={bloqueado || undefined}
          onClick={alQuitar}
          className={BOTON_FILA}
        >
          <Icono nombre="cerrar" />
        </button>
      </div>
    </li>
  );
}

/** El video de la caja: nombre, de qué es, y su ✕ (que cancela la subida si aún sube; mientras sale el pedido, apagada). */
function TarjetaVideo({ video, bloqueado, alQuitar }: { video: VideoDeEdicion; bloqueado: boolean; alQuitar: () => void }) {
  const subiendo = video.fase === 'subiendo';
  const meta = video.fase === 'en_cola' ? 'En cola' : metaDe(video);
  return (
    <div className="mb-2 flex max-w-[440px] items-center gap-3 rounded-medio border border-linea bg-hundido py-1.5 pr-1 pl-1.5">
      <span className="grid h-11 w-18 flex-none place-items-center rounded-chico bg-elevada text-secundario">
        <Icono nombre="video" />
      </span>
      <div className="min-w-0 flex-1">
        <b className="block truncate text-sm font-semibold">{video.nombre}</b>
        <small className="block text-xs text-secundario tabular-nums">{meta}</small>
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
