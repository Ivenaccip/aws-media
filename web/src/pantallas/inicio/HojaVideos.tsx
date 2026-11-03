// «Agregar videos» (E2): la hoja que abre «Elegir de Mis creaciones» en el «+» de la caja de Edición. Hermana de Biblioteca (la de
// imágenes) y con su misma disciplina: la lista es una foto de CUANDO se abre (se vuelve a pedir en cada apertura), cerrarla por donde
// sea olvida lo marcado y los avisos y cancela lo que se estuviera pidiendo, y el foco vuelve al «+».
//
// Dos pestañas: «Mis creaciones» (películas, cuentos, clips y ediciones que ya hiciste) y «Mi computadora» (elegir o soltar archivos).
// Cada video es un botón de dos estados con su duración, su formato y, si está marcado, su número de orden: el orden en que se marca
// es el orden en que se unen, y sigue la cuenta de lo que ya hay en la caja. Lo que no cuadra con lo ya elegido se apaga y DICE POR
// QUÉ (`aria-disabled`, no `disabled`: sigue enfocable y el lector de pantalla lee el motivo); lo que es del video mismo —más de
// 90 min, una edición, sin metraje— va aparte, en «No se pueden editar».
//
// No sabe nada de la caja: recibe qué hay en ella (para apagar y numerar) y devuelve lo elegido. Traer los videos no hace falta (la
// copia la hace el servidor, de servidor a servidor), así que `alUsar` es síncrono. Las reglas de apagado viven en reglasVideos.ts
// (puras, con su prueba); la UI AVISA, el servidor GARANTIZA: lo que se marca aquí se vuelve a validar al cotizar y al iniciar.
// Si la lista no llega, la hoja lo dice ADENTRO (el cuadro de avisos queda tapado por el diálogo) y deja reintentar.
import { useEffect, useId, useState, type DragEvent, type RefObject } from 'react';

import { Boton } from '../../ui/Boton';
import { Dialogo } from '../../ui/Dialogo';
import { Icono } from '../../ui/Icono';
import { Pestanas } from '../../ui/Pestanas';
import { unir } from '../../ui/unir';
import { reloj } from './edicion';
import { DESCRIPCION_VIDEOS, pedirElegibles, soloVideos, type Elegibles, type LimitesDeEdicion, type TipoVideo, type VideoElegible } from './envio';
import {
  cuentaDeLaHoja,
  fechaDeLaHoja,
  etiquetaDelVideo,
  LIMITES_DE_RESPALDO,
  motivoHoja,
  ordenEnLaHoja,
  rotuloDeFormato,
  rotuloDeTipo,
  rotuloDeUsar,
  soloParaUnir,
  usarApagado,
  type FichaDeVideo,
  type Motivo,
} from './reglasVideos';

export interface PropsHojaVideos {
  abierto: boolean;
  alCambiar: (abierto: boolean) => void;
  /** Lo que ya está en la caja: para apagar «En la caja», comparar el formato, sumar los minutos y seguir su numeración. */
  enCaja: readonly FichaDeVideo[];
  /** «Usar N videos»: los elegidos, en el orden en que se marcaron. La caja los agrega AL FINAL. Síncrono: no hay nada que traer. */
  alUsar: (elegidos: VideoElegible[]) => void;
  /** «Elegir archivos…» (o «Subir de mi computadora» con la lista vacía): lo marcado se agrega primero y se abre el selector. */
  alElegirArchivos: (marcados: VideoElegible[]) => void;
  /** Se soltaron archivos de video en «Mi computadora»: lo marcado se agrega primero y luego se suben. */
  alSoltarArchivos: (archivos: File[], marcados: VideoElegible[]) => void;
  /** Dónde vuelve el foco al cerrar (el «+»): la hoja se abre desde un menú que ya se desmontó. */
  focoAlCerrar?: RefObject<HTMLElement | null> | undefined;
  /** Hay un trabajo en curso: «Usar» y los archivos avisan en vez de agregar. */
  ocupado?: boolean;
}

type Carga = { estado: 'cargando' } | { estado: 'error' } | { estado: 'lista'; videos: VideoElegible[]; limites: LimitesDeEdicion };

type Filtro = 'todo' | TipoVideo;

const FILTROS: ReadonlyArray<{ id: Filtro; rotulo: string }> = [
  { id: 'todo', rotulo: 'Todo' },
  { id: 'pelicula', rotulo: 'Películas' },
  { id: 'cuento', rotulo: 'Cuentos' },
  { id: 'clip', rotulo: 'Clips' },
  { id: 'edicion', rotulo: 'Ediciones' },
];

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Lo que contestó el servidor, o null si no tiene la forma de la lista (una respuesta rara no se pinta). Los límites que no vengan
 *  bien se quedan en los de respaldo. */
function leerLista(r: Elegibles | null | undefined): Carga {
  if (!r || !Array.isArray(r.videos)) return { estado: 'error' };
  const l = r.limites as Partial<LimitesDeEdicion> | undefined;
  const limites: LimitesDeEdicion = {
    max_s: num(l?.max_s) ? l.max_s : LIMITES_DE_RESPALDO.max_s,
    min_solo_s: num(l?.min_solo_s) ? l.min_solo_s : LIMITES_DE_RESPALDO.min_solo_s,
    max_videos: num(l?.max_videos) ? l.max_videos : LIMITES_DE_RESPALDO.max_videos,
    max_bytes: num(l?.max_bytes) ? l.max_bytes : LIMITES_DE_RESPALDO.max_bytes,
  };
  return { estado: 'lista', videos: r.videos, limites };
}

const minutos = (s: number) => Math.round(s / 60);

const fichaDe = (v: VideoElegible): FichaDeVideo => ({ ref: v.ref, duracion_s: v.duracion_s, formato: v.formato, bytes: v.bytes });

export function HojaVideos({ abierto, alCambiar, enCaja, alUsar, alElegirArchivos, alSoltarArchivos, focoAlCerrar, ocupado = false }: PropsHojaVideos) {
  const idPie = useId();
  const [carga, setCarga] = useState<Carga>({ estado: 'cargando' });
  const [intento, setIntento] = useState(0);
  const [pestana, setPestana] = useState<'creaciones' | 'computadora'>('creaciones');
  // las referencias de lo marcado, en el orden en que se marcó
  const [marcados, setMarcados] = useState<string[]>([]);
  const [filtro, setFiltro] = useState<Filtro>('todo');
  const [soltando, setSoltando] = useState(false);
  const [avisoZona, setAvisoZona] = useState('');
  const [estabaAbierta, setEstabaAbierta] = useState(abierto);
  // abrir es una foto nueva (se vuelve a pedir); cerrar —por donde sea: Cancelar, Esc, la equis, el velo, «Usar»— olvida lo marcado, el
  // filtro, la pestaña y los avisos. Se ajusta al renderizar (no en un efecto): así la hoja nunca llega a pintarse con lo de la vez anterior
  if (abierto !== estabaAbierta) {
    setEstabaAbierta(abierto);
    setMarcados([]);
    setFiltro('todo');
    setPestana('creaciones');
    setAvisoZona('');
    setSoltando(false);
    if (abierto) setCarga({ estado: 'cargando' });
  }

  // la única petición de esta etapa que no es de subida. Se aborta al cerrar (o al reintentar): una lista que llega tarde no se pinta
  useEffect(() => {
    if (!abierto) return;
    const pedido = new AbortController();
    pedirElegibles(pedido.signal).then(
      r => {
        if (!pedido.signal.aborted) setCarga(leerLista(r));
      },
      () => {
        if (!pedido.signal.aborted) setCarga({ estado: 'error' });
      },
    );
    return () => pedido.abort();
  }, [abierto, intento]);

  const videos = carga.estado === 'lista' ? carga.videos : [];
  const lim = carga.estado === 'lista' ? carga.limites : LIMITES_DE_RESPALDO;
  const elegidos = marcados.map(ref => videos.find(v => v.ref === ref)).filter((v): v is VideoElegible => v !== undefined);
  const fichasMarcadas = elegidos.map(fichaDe);

  const visibles = videos.filter(v => filtro === 'todo' || v.tipo === filtro);
  const motivoDe = (v: VideoElegible): Motivo | null => motivoHoja(v, fichasMarcadas, enCaja, lim);
  const aparte = visibles.filter(v => motivoDe(v)?.aparte);
  const aqui = visibles.filter(v => !motivoDe(v)?.aparte);
  const cuenta = (f: Filtro) => (f === 'todo' ? videos.length : videos.filter(v => v.tipo === f).length);

  // mientras la lista no llega (o no pudo llegar) no hay nada que contar: el pie calla en «Mis creaciones» y no promete lo que aún no existe
  const pie =
    pestana === 'creaciones' && carga.estado !== 'lista'
      ? { texto: '', alerta: null }
      : cuentaDeLaHoja({ pestana, sinVideos: carga.estado === 'lista' && videos.length === 0, marcados: fichasMarcadas, enCaja, lim });
  const hayUsar = pestana === 'creaciones' && carga.estado === 'lista' && videos.length > 0;
  const noUsar = ocupado || usarApagado(fichasMarcadas, enCaja, lim);

  function cerrar(a: boolean) {
    alCambiar(a);
  }

  function alternar(v: VideoElegible) {
    if (motivoDe(v)) return;
    setMarcados(m => (m.includes(v.ref) ? m.filter(r => r !== v.ref) : [...m, v.ref]));
  }

  function usar() {
    if (noUsar) return;
    alUsar(elegidos);
    cerrar(false);
  }

  function elegirArchivos() {
    if (ocupado) return;
    alElegirArchivos(elegidos);
    cerrar(false);
  }

  const traeArchivos = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const alSoltar = (e: DragEvent) => {
    e.preventDefault();
    setSoltando(false);
    const soltadas = Array.from(e.dataTransfer.files);
    if (!soltadas.length || ocupado) return;
    // lo que no es un video no cierra la hoja: se dice aquí, donde se ve
    const buenos = soloVideos(soltadas);
    if (!buenos.length) {
      setAvisoZona(`Solo sirven videos: ${DESCRIPCION_VIDEOS}.`);
      return;
    }
    setAvisoZona('');
    alSoltarArchivos(buenos, elegidos);
    cerrar(false);
  };

  const filtros = (
    <div role="group" aria-label="Filtrar por tipo" className="mb-3 flex flex-wrap gap-2">
      {FILTROS.map(f => (
        <button
          key={f.id}
          type="button"
          aria-pressed={filtro === f.id}
          onClick={() => setFiltro(f.id)}
          className={unir(
            'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-pildora border px-3.5 text-sm',
            filtro === f.id ? 'border-campo bg-elevada text-texto' : 'border-linea bg-transparent text-secundario hover:border-campo hover:text-texto',
          )}
        >
          {f.rotulo}
          <small className="text-xs text-secundario tabular-nums">{cuenta(f.id)}</small>
        </button>
      ))}
    </div>
  );

  const cuerpoCreaciones =
    carga.estado === 'cargando' ? (
      <p role="status" className="m-0 py-8 text-center text-sm text-secundario">
        Cargando tus videos…
      </p>
    ) : carga.estado === 'error' ? (
      <div role="alert" className="grid place-items-center gap-3 py-8 text-center">
        <p className="m-0 text-sm text-error">No pudimos traer tus videos. Revisa tu conexión e inténtalo de nuevo.</p>
        <Boton
          nivel="secundario"
          onClick={() => {
            setCarga({ estado: 'cargando' });
            setIntento(i => i + 1);
          }}
        >
          Reintentar
        </Boton>
      </div>
    ) : videos.length === 0 ? (
      <div className="grid place-items-center gap-2 py-8 text-center">
        <Icono nombre="video" className="size-8 text-secundario" />
        <p className="m-0 text-md font-semibold">Todavía no tienes videos hechos con IA.</p>
        <p className="m-0 max-w-[44ch] text-xs text-secundario">
          Cuando hagas una película, un cuento o un clip, lo encuentras aquí para editarlo o unirlo con otros.
        </p>
        <Boton nivel="principal" icono={<Icono nombre="subir" />} onClick={elegirArchivos} {...(ocupado ? { apagado: true } : {})}>
          Subir de mi computadora
        </Boton>
      </div>
    ) : (
      <>
        {filtros}
        {visibles.length === 0 ? (
          <p className="m-0 py-6 text-center text-sm text-secundario">Aquí no hay videos de este tipo todavía.</p>
        ) : (
          <>
            {aqui.length > 0 && (
              <ul aria-label="Tus videos" className="m-0 grid list-none grid-cols-2 gap-3 p-1 min-[640px]:grid-cols-3">
                {aqui.map(v => (
                  <Tarjeta
                    key={v.ref}
                    v={v}
                    lim={lim}
                    orden={marcados.includes(v.ref) ? ordenEnLaHoja(enCaja.length, marcados.indexOf(v.ref)) : 0}
                    motivo={marcados.includes(v.ref) ? null : motivoDe(v)}
                    alPulsar={() => alternar(v)}
                  />
                ))}
              </ul>
            )}
            {aparte.length > 0 && (
              <>
                <p className="mx-0 mt-5 mb-2 text-xs font-semibold tracking-wide text-secundario uppercase">No se pueden editar</p>
                <ul aria-label="Videos que no se pueden editar" className="m-0 grid list-none grid-cols-2 gap-3 p-1 min-[640px]:grid-cols-3">
                  {aparte.map(v => (
                    <Tarjeta key={v.ref} v={v} lim={lim} orden={0} motivo={motivoDe(v)} alPulsar={() => undefined} />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        <p className="mx-0 mt-4 mb-0 text-xs text-secundario">
          Para editar un solo video, debe durar de {minutos(lim.min_solo_s)} a {minutos(lim.max_s)} min. Al unir varios no hay mínimo y el total
          llega hasta {minutos(lim.max_s)} min. Los videos horizontales y los verticales no se mezclan.
        </p>
      </>
    );

  const cuerpoComputadora = (
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
      <p className="m-0 text-md font-semibold">Arrastra tus videos aquí</p>
      <p className="m-0 max-w-[48ch] text-xs text-secundario">
        MP4, MOV o M4V, hasta {minutos(lim.max_s)} minutos en total. Para editar un solo video, debe durar al menos {minutos(lim.min_solo_s)} minuto;
        para unir varios no hay mínimo.
      </p>
      {elegidos.length > 0 && (
        <p className="m-0 max-w-[48ch] text-xs text-texto">
          {elegidos.length === 1
            ? 'Se agrega junto con el video que marcaste en Mis creaciones.'
            : `Se agregan junto con los ${elegidos.length} videos que marcaste en Mis creaciones.`}
        </p>
      )}
      <Boton nivel="secundario" onClick={elegirArchivos} {...(ocupado ? { apagado: true } : {})}>
        Elegir archivos…
      </Boton>
      {avisoZona && (
        <p role="alert" className="m-0 max-w-[48ch] text-xs text-error">
          {avisoZona}
        </p>
      )}
    </div>
  );

  return (
    <Dialogo abierto={abierto} alCambiar={cerrar} titulo="Agregar videos" ancho focoAlCerrar={focoAlCerrar}>
      <Pestanas
        etiqueta="De dónde vienen"
        alCambiar={id => setPestana(id === 'computadora' ? 'computadora' : 'creaciones')}
        pestanas={[
          { id: 'creaciones', titulo: 'Mis creaciones', contenido: <div className="max-h-[clamp(120px,calc(100dvh-392px),500px)] overflow-y-auto pr-1 min-[640px]:max-h-[clamp(120px,calc(100dvh-290px),500px)]">{cuerpoCreaciones}</div> },
          { id: 'computadora', titulo: 'Mi computadora', contenido: cuerpoComputadora },
        ]}
      />
      {/* El pie se queda a la vista: la lista cede alto antes que nadie (ver arriba) y, si aun así la hoja no cabe en la ventana —un teléfono de
          lado—, la hoja se desplaza por dentro y «Usar» sigue pegado abajo. `-mx-6 -mb-6` y `px-6 pb-6` lo estiran sobre el margen de la hoja */}
      <div className="sticky bottom-0 z-10 -mx-6 -mb-6 mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-linea bg-superficie px-6 pt-3 pb-6">
        <div id={idPie} role="status" className="min-w-0 flex-1 basis-56 text-xs text-secundario tabular-nums">
          <span>{pie.texto}</span>
          {pie.alerta && (
            <span className="mt-1 flex items-start gap-1.5 text-texto">
              <Icono nombre="aviso" className="mt-0.5 size-4 text-secundario" />
              <span>{pie.alerta}</span>
            </span>
          )}
        </div>
        <span className="ml-auto flex w-full flex-col gap-3 min-[640px]:w-auto min-[640px]:flex-row [@media(max-height:480px)]:w-auto [@media(max-height:480px)]:flex-row">
          <Boton nivel="secundario" onClick={() => cerrar(false)}>
            Cancelar
          </Boton>
          {hayUsar && (
            <Boton nivel="principal" aria-describedby={idPie} {...(noUsar ? { apagado: true } : {})} onClick={usar}>
              {rotuloDeUsar(elegidos.length)}
            </Boton>
          )}
        </span>
      </div>
    </Dialogo>
  );
}

/** Un video de la hoja: el botón de dos estados con su miniatura, sus insignias y su número, y debajo su nombre, de qué es y por qué no. */
function Tarjeta({
  v,
  lim,
  orden,
  motivo,
  alPulsar,
}: {
  v: VideoElegible;
  lim: LimitesDeEdicion;
  /** Su lugar entre lo elegido (sigue la cuenta de la caja), o 0 si no lo está. */
  orden: number;
  motivo: Motivo | null;
  alPulsar: () => void;
}) {
  const [rota, setRota] = useState(false);
  const marcado = orden > 0;
  const apagado = motivo !== null;
  const formato = rotuloDeFormato(v.formato);
  const soloUnir = soloParaUnir(v, lim);
  const fecha = fechaDeLaHoja(v.fecha);
  return (
    <li className="min-w-0">
      <button
        type="button"
        aria-pressed={marcado}
        aria-disabled={apagado || undefined}
        aria-label={etiquetaDelVideo({ titulo: v.titulo, duracion_s: v.duracion_s, formato: v.formato, soloUnir, orden, motivo: motivo?.texto ?? '' })}
        onClick={() => {
          if (!apagado) alPulsar();
        }}
        className={unir(
          'relative block aspect-video w-full overflow-hidden rounded-medio border-2 bg-elevada p-0',
          marcado ? 'border-ambar-claro' : 'border-linea',
          // lo marcado NO cambia de borde al pasar el ratón: `hover:border-campo` le ganaba al ámbar mientras el puntero seguía encima
          // (justo después de pulsar) y la selección parecía no haber ocurrido. Como en Biblioteca
          apagado ? 'cursor-default' : unir('cursor-pointer', !marcado && 'hover:border-campo'),
        )}
      >
        <span className={unir('grid size-full place-items-center text-secundario', apagado && 'opacity-40')}>
          {v.miniatura && !rota ? (
            <img src={v.miniatura} alt="" loading="lazy" className="size-full object-cover" onError={() => setRota(true)} />
          ) : v.video && !rota ? (
            // un clip: su primer cuadro hace de miniatura (el video mismo, sin sonido ni controles)
            <video src={v.video + '#t=0.5'} muted playsInline preload="metadata" aria-hidden="true" tabIndex={-1} className="size-full object-cover" onError={() => setRota(true)} />
          ) : (
            <Icono nombre="video" className="size-7" />
          )}
        </span>
        {formato && (
          <span className="absolute bottom-1.5 left-1.5 rounded-chico bg-hundido/80 px-1.5 text-xs text-texto tabular-nums">{formato}</span>
        )}
        {v.duracion_s !== null && (
          <span className="absolute right-1.5 bottom-1.5 rounded-chico bg-hundido/80 px-1.5 text-xs text-texto tabular-nums">{reloj(v.duracion_s)}</span>
        )}
        {marcado && (
          <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-pildora bg-ambar-claro text-xs font-semibold text-tinta">{orden}</span>
        )}
      </button>
      <span className="mt-1.5 block text-sm font-semibold [overflow-wrap:anywhere]">{v.titulo}</span>
      <span className="block text-xs text-secundario">
        {rotuloDeTipo(v.tipo)}
        {fecha && ` · ${fecha}`}
      </span>
      {soloUnir && <span className="mt-1 inline-block rounded-pildora border border-campo px-2 text-xs text-texto">Solo para unir</span>}
      {motivo && (
        <span aria-hidden="true" className={unir('mt-0.5 flex items-start gap-1 text-xs', motivo.codigo === 'en_caja' ? 'text-exito' : 'text-texto')}>
          <Icono nombre={motivo.codigo === 'en_caja' ? 'listo' : 'prohibido'} className="mt-0.5 size-4 text-secundario" />
          <span>{motivo.texto}</span>
        </span>
      )}
    </li>
  );
}
