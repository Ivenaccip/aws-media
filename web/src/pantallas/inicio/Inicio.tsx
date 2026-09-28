// /estudio/inicio/ — el inicio del estudio (UI·8.4). No cobra: reparte.
// La caja lleva a la pantalla que cobra con el texto puesto; el menú, a las
// herramientas; las listas, a lo que ya hiciste.
// Paridad con static/index.html: mismas llamadas, mismos destinos. Qué pasó
// con cada aserción vieja: docs/migracion/inicio.md.
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';

import { ErrorApi } from '../../nucleo/api';
import { Aviso } from '../../ui/Aviso';
import { Boton, claseBoton } from '../../ui/Boton';
import { Confirmar } from '../../ui/Confirmar';
import { Icono } from '../../ui/Icono';
import type { NombreIcono } from '../../ui/iconos';
import { unir } from '../../ui/unir';
import { DialogoBlotato } from './Blotato';
import { Caja, type MandoCaja } from './Caja';
import {
  archivar,
  cargarEdiciones,
  cargarImagenes,
  cargarProyectos,
  cargarSlots,
  desarchivar,
  IMG_A_LA_VISTA,
  leerBlotato,
  textoSlots,
  type Edicion,
  type EstadoBlotato,
  type Imagen,
  type Proyecto,
} from './logica';
import { TarjetaEdicion, TarjetaImagen, TarjetaNueva, TarjetaProyecto } from './Obras';

interface Listas {
  proyectos: Proyecto[];
  slots: number | null;
  /** null = no llegaron: la sección no se enseña (y no cuenta como vacía). */
  imagenes: Imagen[] | null;
  ediciones: Edicion[] | null;
}

const mensaje = (e: unknown) => {
  // el 409 de desarchivar trae el texto en `detail` y alguno viejo en `detail.aviso`
  if (e instanceof ErrorApi && e.detalle && typeof e.detalle === 'object' && 'aviso' in e.detalle) {
    const a = (e.detalle as { aviso: unknown }).aviso;
    if (typeof a === 'string') return a;
  }
  return e instanceof Error ? e.message : String(e);
};

const navegar = (url: string) => location.assign(url);

/** `ir` solo lo cambian los tests (jsdom no navega). */
export function Inicio({ ir = navegar }: { ir?: (url: string) => void }) {
  const [listas, setListas] = useState<Listas | null>(null);
  const [falloCarga, setFalloCarga] = useState(false);
  const [aviso, setAviso] = useState('');
  const [aArchivar, setAArchivar] = useState<Proyecto | null>(null);
  const [todasImg, setTodasImg] = useState(false);

  // null = no se sabe: el menú se queda encendido. Dejar sin sus herramientas
  // a quien sí pagó, porque un fetch no respondió, es peor que dejar entrar a
  // quien no (M23 · C).
  const [conectado, setConectado] = useState<boolean | null>(null);
  const [dlgBlotato, setDlgBlotato] = useState(false);
  const [estadoBlotato, setEstadoBlotato] = useState<EstadoBlotato | null>(null);
  const [errorBlotato, setErrorBlotato] = useState('');

  const caja = useRef<MandoCaja>(null);

  const cargar = useCallback(async () => {
    const [ps, sl, im, ed] = await Promise.allSettled([
      cargarProyectos(),
      cargarSlots(),
      cargarImagenes(),
      cargarEdiciones(),
    ]);
    // sin la lista de proyectos se avisa y el inicio se queda con lo que tenía
    if (ps.status === 'rejected') {
      setFalloCarga(true);
      return;
    }
    setFalloCarga(false);
    setListas({
      proyectos: ps.value,
      slots: sl.status === 'fulfilled' ? sl.value.slots : null,
      imagenes: im.status === 'fulfilled' ? im.value : null,
      ediciones: ed.status === 'fulfilled' ? ed.value : null,
    });
  }, []);

  const abrirBlotato = useCallback(() => {
    setEstadoBlotato(null);
    setErrorBlotato('');
    setDlgBlotato(true);
    leerBlotato().then(
      d => {
        setEstadoBlotato(d);
        setConectado(d.conectado);
      },
      (e: unknown) => setErrorBlotato(mensaje(e)),
    );
  }, []);

  useEffect(() => {
    // cargar() y abrirBlotato() ponen estado: van en un callback, no en el cuerpo del efecto
    Promise.resolve().then(cargar).catch(() => undefined);
    // el editor manda aquí con ?blotato=conectar cuando falta la conexión
    if (new URLSearchParams(location.search).get('blotato') === 'conectar') {
      Promise.resolve().then(abrirBlotato);
    } else {
      leerBlotato(true).then(
        d => setConectado(d.conectado),
        () => undefined,
      );
    }
  }, [cargar, abrirBlotato]);

  async function accion(p: Proyecto, verbo: 'archivar' | 'desarchivar') {
    try {
      await (verbo === 'archivar' ? archivar(p.id) : desarchivar(p.id));
      setAviso('');
      await cargar();
    } catch (e) {
      setAviso(e instanceof ErrorApi && e.estado === 0 ? 'Sin conexión — intenta de nuevo.' : mensaje(e) || 'No se pudo — intenta de nuevo.');
    }
  }

  const activos = listas?.proyectos.filter(p => !p.archivado) ?? [];
  const archivados = listas?.proyectos.filter(p => p.archivado) ?? [];
  // Los tres caminos, solo si las cuatro listas respondieron y las cuatro
  // vienen vacías. Una que falló no cuenta como vacía: a quien ya tiene cosas
  // no se le enseña el inicio de alguien nuevo por un fetch (UI·10).
  const nuevo =
    listas !== null &&
    !listas.proyectos.length &&
    listas.imagenes !== null &&
    !listas.imagenes.length &&
    listas.ediciones !== null &&
    !listas.ediciones.length;
  const cabeHoja = listas !== null && (listas.slots === null || activos.length < listas.slots);
  const imagenes = listas?.imagenes ?? null;
  const aLaVista = imagenes && !todasImg ? imagenes.slice(0, IMG_A_LA_VISTA) : imagenes;

  return (
    <div className="mx-auto max-w-[1100px] px-5 pt-16 pb-14">
      <div className="grid gap-7 min-[861px]:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="min-w-0">
          <h1 className="m-0 flex items-center gap-2.5 px-3 pt-2.5 pb-4 text-titulo-sm font-bold">
            <Icono nombre="video" className="text-ambar-claro" />
            Estudio de video
          </h1>
          <Menu conectado={conectado} alConectar={abrirBlotato} />
        </aside>

        <main className="min-w-0">
          <Caja ref={caja} ir={ir} />

          {falloCarga && (
            <div className="mb-6">
              <Aviso tipo="error">
                No pudimos traer tus proyectos. Revisa tu conexión e inténtalo de nuevo.{' '}
                <Boton nivel="enlace" onClick={() => void cargar()}>
                  Reintentar
                </Boton>
              </Aviso>
            </div>
          )}
          {aviso && (
            <div className="mb-6">
              <Aviso tipo="error">{aviso}</Aviso>
            </div>
          )}

          {nuevo && (
            <Caminos alIdea={() => caja.current?.elegir('videos', 'investigacion')} />
          )}

          {listas === null && !falloCarga && <p className="m-0 text-xs text-secundario">Cargando tus proyectos…</p>}

          {listas && !nuevo && (
            <Seccion titulo="Mis proyectos" extra={<span className="text-xs text-secundario">{textoSlots(activos.length, listas.slots)}</span>}>
              {activos.map(p => (
                <TarjetaProyecto key={p.id} p={p} alArchivar={setAArchivar} />
              ))}
              {cabeHoja && (
                <TarjetaNueva texto="Nueva película" alPulsar={() => caja.current?.elegir('videos')} />
              )}
            </Seccion>
          )}

          {aLaVista && !nuevo && (
            <Seccion
              titulo="Mis imágenes"
              extra={
                imagenes!.length > IMG_A_LA_VISTA && (
                  <Boton nivel="enlace" className="text-xs" aria-expanded={todasImg} onClick={() => setTodasImg(v => !v)}>
                    {todasImg ? 'Ver menos' : `Ver todas (${imagenes!.length})`}
                  </Boton>
                )
              }
            >
              {aLaVista.map(im => (
                <TarjetaImagen key={im.nombre} im={im} />
              ))}
              <TarjetaNueva texto="Nueva imagen" href="/imagenes.html" />
            </Seccion>
          )}

          {/* M14: las ediciones de metraje viven aquí (antes eran las tarjetas de e1) */}
          {listas?.ediciones && listas.ediciones.length > 0 && (
            <Seccion titulo="Mis ediciones">
              {listas.ediciones.map(e => (
                <TarjetaEdicion key={e.nombre} e={e} />
              ))}
            </Seccion>
          )}

          {archivados.length > 0 && (
            <details className="mt-8">
              <summary className="min-h-11 cursor-pointer text-sm text-secundario">
                Proyectos archivados ({archivados.length}) — no se borran, se pueden restaurar
              </summary>
              <ul className="m-0 mt-3 list-none p-0">
                {archivados.map(p => (
                  <li
                    key={p.id}
                    className="mb-1.5 flex items-center justify-between gap-2.5 rounded-medio border border-linea bg-superficie py-1.5 pr-1.5 pl-3.5 text-sm"
                  >
                    <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-secundario">
                      {p.brief || '(sin brief)'}
                    </span>
                    <Boton nivel="secundario" denso onClick={() => void accion(p, 'desarchivar')}>
                      Restaurar
                    </Boton>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </main>
      </div>

      <Confirmar
        abierto={aArchivar !== null}
        alCambiar={a => !a && setAArchivar(null)}
        titulo="¿Archivar este proyecto?"
        descripcion="No se borra nada: sale de tus slots y lo puedes restaurar cuando quieras desde «Proyectos archivados»."
        confirmar="Archivar"
        alConfirmar={() => {
          if (aArchivar) void accion(aArchivar, 'archivar');
        }}
      />

      <DialogoBlotato
        abierto={dlgBlotato}
        alCambiar={setDlgBlotato}
        estado={estadoBlotato}
        errorCarga={errorBlotato}
        alSaber={d => {
          setEstadoBlotato(d);
          setConectado(d.conectado);
        }}
      />
    </div>
  );
}

function Seccion({ titulo, extra, children }: { titulo: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-7">
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-titulo-sm font-bold">{titulo}</h2>
        {extra}
      </div>
      <div className="grid grid-cols-2 gap-3.5 min-[861px]:grid-cols-3">{children}</div>
    </section>
  );
}

function Caminos({ alIdea }: { alIdea: () => void }) {
  const camino = (icono: NombreIcono, titulo: string, texto: string, accion: ReactNode) => (
    <article className="flex flex-col gap-2.5 rounded-grande border border-linea bg-superficie p-5">
      <Icono nombre={icono} className="size-7 text-ambar-claro" />
      <h3 className="m-0 font-titulo text-titulo-sm font-bold">{titulo}</h3>
      <p className="m-0 flex-grow text-secundario">{texto}</p>
      <div>{accion}</div>
    </article>
  );
  return (
    <section aria-labelledby="caminos-titulo" className="mb-8">
      <h2 id="caminos-titulo" className="m-0 mb-1.5 text-titulo-md font-bold">
        Tu primer video, en tres caminos
      </h2>
      <p className="m-0 mb-4.5 max-w-[60ch] text-md text-secundario">
        Elige por dónde empezar. Todo lo que hagas va a aparecer aquí, listo para seguir editando.
      </p>
      <div className="grid gap-3.5 min-[861px]:grid-cols-3">
        {camino(
          'idea',
          'Desde una idea',
          'Escribe el tema: buscamos las fuentes y escribimos el guion. Lo revisas antes de producir.',
          <Boton nivel="secundario" onClick={alIdea}>
            Crear un video
          </Boton>,
        )}
        {camino(
          'shorts',
          'Desde un video largo',
          'Sube tu video o pega la liga de YouTube: te proponemos los mejores momentos como shorts.',
          <a className={claseBoton('secundario')} href="/shorts.html">
            Hacer shorts
          </a>,
        )}
        {camino(
          'cortar',
          'Desde tu metraje',
          'Sube lo que grabaste y la IA te propone el corte: quita muletillas, tomas repetidas y aire muerto.',
          <a className={claseBoton('secundario')} href="/e1.html">
            Subir metraje
          </a>,
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// el menú de la izquierda

interface Entrada {
  href: string;
  icono: NombreIcono;
  titulo: string;
  texto: string;
  /** Se apaga sin la clave de Blotato del usuario (M23 · C). */
  blotato?: boolean;
}

// «Crear imágenes» y «Crear contenido» no están aquí: su puerta es la caja
// (M25 · B). El menú se queda con lo que empieza con algo tuyo (un archivo,
// una liga) más lo de publicar.
const GRUPOS: Array<{ titulo: string; blotato?: boolean; entradas: Entrada[] }> = [
  {
    titulo: 'Estudio de Contenido',
    entradas: [
      { href: '/e1.html', icono: 'cortar', titulo: 'Editor de videos', texto: 'Sube tu metraje y la IA te propone el corte.' },
      { href: '/shorts.html', icono: 'shorts', titulo: 'De videos a Shorts', texto: 'Sube un video largo y te daremos los mejores momentos.' },
      { href: '/estilos.html', icono: 'estilo', titulo: 'Copiadora de estilos', texto: 'Recrea el estilo visual de un contenido que te guste' },
    ],
  },
  {
    titulo: 'Blotato',
    blotato: true,
    // «Investiga tu competencia» se apaga A PROPÓSITO aunque corre con Apify:
    // el grupo se comporta como un bloque (decisión del dueño, 18-sep).
    entradas: [
      { href: '/agenda.html', icono: 'agenda', titulo: 'Agenda tus publicaciones', texto: 'Programa tus posts en todas tus redes', blotato: true },
      { href: '/competencia.html', icono: 'competencia', titulo: 'Investiga tu competencia', texto: 'Qué le está funcionando a quien vigilas', blotato: true },
      { href: '/metricas.html', icono: 'metricas', titulo: 'Ver mis métricas', texto: 'Cómo rinden tus publicaciones', blotato: true },
    ],
  },
  {
    // MIX va DEBAJO de Blotato (dueño, 19-sep): Blotato es su requisito.
    titulo: 'Publicidad Automática',
    entradas: [
      { href: '/mix.html', icono: 'automatico', titulo: 'MIX', texto: 'Una publicación al día, sola, desde una foto tuya', blotato: true },
    ],
  },
];

function Menu({ conectado, alConectar }: { conectado: boolean | null; alConectar: () => void }) {
  const etiqueta = conectado ? 'Blotato conectado: ver o cambiar' : 'Conecta tu cuenta de Blotato';
  return (
    <nav aria-label="Secciones" className="flex gap-2 overflow-x-auto pb-1.5 min-[861px]:block min-[861px]:overflow-visible">
      {GRUPOS.map(g => (
        <div key={g.titulo} className="contents min-[861px]:block">
          {/* en el teléfono el grupo es una pieza más de la fila: el «+» de Blotato no se pierde */}
          <div className="flex flex-none items-center justify-between gap-2 px-0.5 text-xs font-semibold tracking-[0.4px] text-secundario uppercase whitespace-nowrap min-[861px]:pt-4 min-[861px]:pb-2 min-[861px]:first:pt-0">
            {g.titulo}
            {g.blotato && (
              <button
                type="button"
                aria-haspopup="dialog"
                aria-label={etiqueta}
                title={etiqueta}
                onClick={alConectar}
                className={unir(
                  'relative grid size-8 cursor-pointer place-items-center rounded-medio border p-0 before:absolute before:-inset-1.5 before:content-[""]',
                  conectado
                    ? 'border-exito bg-exito-fondo text-exito'
                    : 'border-campo bg-transparent text-secundario hover:border-secundario hover:bg-elevada hover:text-texto',
                )}
              >
                <Icono nombre={conectado ? 'listo' : 'mas'} />
              </button>
            )}
          </div>
          {g.entradas.map(e => (
            <EntradaMenu key={e.href} e={e} apagada={Boolean(e.blotato) && conectado === false} alConectar={alConectar} />
          ))}
        </div>
      ))}
    </nav>
  );
}

function EntradaMenu({ e, apagada, alConectar }: { e: Entrada; apagada: boolean; alConectar: () => void }) {
  // Apagada a la vista en vez de escondida: escondida, nadie descubre que el
  // producto sabe hacerlo. El clic ofrece conectar en vez de llevar a una
  // pantalla que solo sabe decir «conéctala».
  const alPulsar = (ev: MouseEvent) => {
    if (!apagada) return;
    ev.preventDefault();
    alConectar();
  };
  return (
    <a
      href={e.href}
      aria-disabled={apagada || undefined}
      onClick={alPulsar}
      className={unir(
        'group mb-1.5 grid flex-none grid-cols-[auto_1fr] items-start gap-x-2.5 rounded-medio border border-linea bg-superficie px-3 py-2.5 text-texto no-underline transition-colors hover:border-campo hover:bg-elevada',
        apagada && 'opacity-60',
      )}
    >
      <Icono nombre={e.icono} className="mt-px text-secundario group-hover:text-texto" />
      <span>
        <b className="block text-sm leading-snug font-semibold">{e.titulo}</b>
        <small className="hidden text-xs leading-snug text-secundario min-[861px]:block">
          {apagada ? <span className="text-ambar-claro">Conecta tu Blotato para usarlo</span> : e.texto}
        </small>
      </span>
    </a>
  );
}
