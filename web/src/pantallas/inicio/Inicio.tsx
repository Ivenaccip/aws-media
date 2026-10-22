// /estudio/inicio/ — el inicio del estudio (UI·8.4). La caja cobra ahí mismo
// el clip, la imagen, editar una imagen (desde R4b) y la edición de un video
// (desde E1; desde E2 con varios videos unidos); las demás opciones llevan a la pantalla que cobra con el texto
// puesto. Las listas, debajo, llevan a lo que ya hiciste.
//
// Desde el 15-oct-2026 (dueño, «Mapa con Irremplazables») ya no hay menú a la
// izquierda: el inicio (Recorrido) enseña un paso a la vez —el mapa de áreas,
// las tres opciones de un grupo, o su contenido: la caja o la lista de sus
// pantallas—, bajo el título «Irremplazables». Se aterriza en el MAPA (segunda
// ronda del mismo día: «el mapa es el inicio»), sin nada elegido; solo la caja
// lleva tarjeta. La caja se queda montada (y escondida) aunque se vea otro paso:
// no pierde lo escrito ni una subida. Lo que va debajo de ella (Mis creaciones,
// los caminos…) se ve solo cuando la caja se ve. Las pantallas hoja (agenda,
// métricas…) mandan aquí con `?desde=…&ver=…` desde sus migas (estadoRecorrido.ts), y la Biblioteca de prompts con `?prompt=` o `?brief=`
// para dejar un texto ya puesto en la caja (pestaña Imagen o Video).
// Las tres herramientas de la caja también son páginas con su dirección (…/marketing/distrito/imagen/, …/video/, …/edicion/; marca/rutas.ts): es
// este mismo inicio con `lugar` (herramienta.tsx), con la caja ya a la vista en la pestaña de la dirección y las migas como enlaces. Al cambiar de
// pestaña con el riel la página NO se recarga (la caja conserva lo escrito, el video y la subida): la dirección y el título la siguen con
// `history.replaceState`, nunca con `pushState`, para que «atrás» siga subiendo al grupo y no recorra pestañas.
// Paridad con static/index.html: mismas llamadas, mismos destinos. Qué pasó
// con cada aserción vieja: docs/migracion/inicio.md.
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';

import { buscar, type Lugar } from '../../marca/menu';
import { rutasDelRecorrido, urlDeCaja } from '../../marca/rutas';
import { refrescarSaldo } from '../../marca/useSaldo';
import { ErrorApi } from '../../nucleo/api';
import { Aviso } from '../../ui/Aviso';
import { Boton, claseBoton } from '../../ui/Boton';
import { Confirmar } from '../../ui/Confirmar';
import { Icono } from '../../ui/Icono';
import type { NombreIcono } from '../../ui/iconos';
import { unir } from '../../ui/unir';
import { DialogoBlotato } from './Blotato';
import { Caja, type MandoCaja } from './Caja';
import { traerImagen } from './envio';
import {
  archivar,
  cargarClips,
  cargarEdiciones,
  cargarImagenes,
  cargarProyectos,
  cargarSlots,
  corriendoVivo,
  desarchivar,
  leerBlotato,
  creaciones,
  textoSlots,
  type ClipCorto,
  type Edicion,
  type EstadoBlotato,
  type Familia,
  type Imagen,
  type PedidoImagen,
  type Proyecto,
} from './logica';
import { Galeria, type Pendiente } from './Galeria';
import { cajaVisible, estadoInicial, leerLlegadaDeTexto, reducir, urlSinEntrada } from './estadoRecorrido';
import { estadoDeNivel, urlDeAccion } from './niveles/navegar';
import { Recorrido } from './Recorrido';

interface Listas {
  proyectos: Proyecto[];
  slots: number | null;
  /** null = no llegaron: la sección no se enseña (y no cuenta como vacía). */
  imagenes: Imagen[] | null;
  ediciones: Edicion[] | null;
  /** UI·26: los clips de 8 s también son «Mis videos». null = no llegaron. */
  clips: ClipCorto[] | null;
  /** Las imágenes que el servidor hace en segundo plano (generando, o con error de la última hora). */
  pedidos: PedidoImagen[];
}

/** Cuánto se espera a que una relectura de la lista de imágenes salga bien antes de soltar la tarjeta local: si el
 *  servidor no contesta o no puede leer los pedidos, la tarjeta no puede girar para siempre. */
const ESPERA_MAXIMA_MS = 2 * 60 * 1000;

/** Cuánto se espera para volver a pedir el saldo cuando una copia termina: el worker devuelve los créditos (un video sin nada que cortar)
 *  un instante DESPUÉS de marcarla «lista», y la lista ya no volverá a leerse para verlo. */
export const SALDO_TRAS_COPIA_MS = 4000;

/** Una imagen que el servidor aceptó y cuya relectura de la lista aún no salió bien: su tarjeta local, y desde cuándo se espera. */
interface Espera {
  clave: string;
  desde: number;
}

/** Un pedido en segundo plano se enseña con la misma tarjeta de «Generando…» que lo recién pedido en la caja. */
const comoPendiente = (p: PedidoImagen): Pendiente => ({
  clave: 'i:' + p.id,
  tipo: 'imagen',
  texto: p.texto,
  ...(p.estado === 'error' ? { error: p.error || 'La imagen no se pudo generar. Se te devolvieron los créditos.' } : {}),
});

const mensaje = (e: unknown) => {
  // el 409 de desarchivar trae el texto en `detail` y alguno viejo en `detail.aviso`
  if (e instanceof ErrorApi && e.detalle && typeof e.detalle === 'object' && 'aviso' in e.detalle) {
    const a = (e.detalle as { aviso: unknown }).aviso;
    if (typeof a === 'string') return a;
  }
  return e instanceof Error ? e.message : String(e);
};

const navegar = (url: string) => location.assign(url);

/**
 * Cambia la dirección SIN agregar historia y sin poder tumbar la página: sincronizarla es solo cosmético. `history.replaceState` puede
 * lanzar (Safari: `SecurityError` al pasar de 100 llamadas en 30 s; un iframe o una política que la bloquee) y, llamado desde un efecto, un
 * error así desmonta todo el árbol: la página en blanco y lo escrito o la subida de Edición perdidos. Si falla, la dirección queda
 * desfasada y la caja sigue viva.
 */
function reemplazarDireccion(url: string): void {
  try {
    history.replaceState(history.state, '', url);
  } catch {
    /* la dirección queda como estaba */
  }
}

/**
 * La dirección y el título siguen a la pestaña de la caja (solo en la página de una herramienta). Sale de la caja al montarse y en cada
 * cambio, así que también corrige la dirección cuando la que se abrió no es la de la pestaña: un texto que llega (`?prompt=` es una imagen,
 * `?brief=` un video) abre otra, o la dirección venía escrita de otra manera (`…/imagen/index.html`, con «%XX»). Si la dirección ya es la de
 * la pestaña no hace nada (el `<title>` de la página ya es el suyo): por eso un efecto que corre dos veces (StrictMode) no repite el
 * `replaceState`.
 * Solo cambia el camino. Del query se va lo que Inicio ya leyó una vez al montar (`urlSinEntrada`: prompt, brief, desde, ver); todo lo
 * demás se queda, y el ancla también: `?blotato=conectar` (lo lee el efecto de carga de Inicio, que corre DESPUÉS de este: si se perdiera
 * aquí, el diálogo de conectar no se abriría), `utm_*`. Es una función de módulo, no del componente: su identidad no cambia entre renders.
 */
function seguirLaPestana(f: Familia): void {
  const url = urlDeCaja(f);
  if (!url || location.pathname === url) return;
  const resto = new URL(urlSinEntrada(location.href) ?? location.href, location.href);
  reemplazarDireccion(url + resto.search + resto.hash);
  // el título sigue a la pestaña que se ve aunque la dirección no haya podido moverse
  const ruta = rutasDelRecorrido().find(r => r.url === url);
  if (ruta) document.title = ruta.titulo;
}

/** `ir` solo lo cambian los tests (jsdom no navega).
 *  `lugar`: la página de una herramienta de la caja (…/distrito/imagen/): la caja ya en esa pestaña, las migas de arriba son enlaces a otras
 *  PÁGINAS en vez de cambiar de paso aquí, y la dirección sigue a la pestaña. Sin él, el inicio de siempre, con su recorrido en página. Un
 *  `lugar` que no es una pestaña de la caja (una hoja, una clave que no existe) no es una herramienta: se ignora y sale el inicio de siempre. */
export function Inicio({ ir = navegar, lugar }: { ir?: (url: string) => void; lugar?: Lugar }) {
  const [listas, setListas] = useState<Listas | null>(null);
  const [falloCarga, setFalloCarga] = useState(false);
  // se soltó la tarjeta de una imagen pedida sin poder confirmarla: el mismo aviso, hasta una lectura buena
  const [sinConfirmar, setSinConfirmar] = useState(false);
  const [aviso, setAviso] = useState('');
  const [aArchivar, setAArchivar] = useState<Proyecto | null>(null);

  // null = no se sabe: las pantallas de Blotato se quedan encendidas. Dejar sin
  // sus herramientas a quien sí pagó, porque un fetch no respondió, es peor que
  // dejar entrar a quien no (M23 · C).
  const [conectado, setConectado] = useState<boolean | null>(null);
  const [dlgBlotato, setDlgBlotato] = useState(false);
  const [estadoBlotato, setEstadoBlotato] = useState<EstadoBlotato | null>(null);
  const [errorBlotato, setErrorBlotato] = useState('');

  const caja = useRef<MandoCaja>(null);
  // la pestaña de la caja que nombra `lugar`; undefined = no hay `lugar` o no es una herramienta de la caja (el inicio de siempre)
  const pestanaDeLugar = lugar ? buscar(lugar)?.pantalla.caja : undefined;
  // el recorrido: en qué paso va (el mapa al abrir), y desde dónde llegó si venía de una pantalla hoja (?desde=…&ver=…, que se lee UNA vez).
  // La página de una herramienta arranca en el contenido del grupo, con la caja a la vista
  const [recorrido, despachar] = useReducer(reducir, undefined, () =>
    lugar && pestanaDeLugar ? estadoDeNivel({ tipo: 'herramienta', lugar }) : estadoInicial(location.search),
  );
  const tituloCaja = useRef<HTMLHeadingElement>(null);
  // el texto con el que se llegó a la caja (?prompt= o ?brief=, de «Llevar a la caja» de la Biblioteca de prompts): se lee UNA vez, junto con
  // el recorrido, y la caja lo pone en su cuadro al montarse. Llegar así no crea ni cobra nada
  const [llegada] = useState(() => leerLlegadaDeTexto(location.search));
  // los pedidos en segundo plano que estaban generándose en la última lista: si uno pasa a error, el worker devolvió los créditos
  const generandoImagenes = useRef<Set<string>>(new Set());
  // las copias de E2 que estaban editándose en la última lista: si una pasa a error, el servidor devolvió los créditos; si pasa a «lista»
  // sin nada que cortar (un solo video), también (la píldora no sondea el saldo: sin esto se quedaba vieja hasta recargar)
  const editandoCopias = useRef<Set<string>>(new Set());
  // el segundo vistazo al saldo de una copia que terminó (SALDO_TRAS_COPIA_MS): se cancela si la pantalla se va
  const saldoPendiente = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const pendientes = saldoPendiente;
    return () => {
      pendientes.current.forEach(clearTimeout);
      pendientes.current = [];
    };
  }, []);
  // lo que se pidió desde la caja y todavía no llega a la lista
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  // las imágenes que el servidor aceptó desde la caja y cuya relectura de la lista aún no salió bien: su tarjeta
  // es lo único que dice que van en camino, así que se queda (y se sigue intentando) hasta que la lista las traiga
  // o pasen ESPERA_MAXIMA_MS
  const [esperandoLista, setEsperandoLista] = useState<Espera[]>([]);
  // lo mismo, para leerlo desde un callback que quedó de un render anterior (el fin de un pedido)
  const esperando = useRef<Espera[]>([]);
  useEffect(() => {
    esperando.current = esperandoLista;
  }, [esperandoLista]);

  /** true si la relectura salió bien con la lista de imágenes y sus pedidos, que es donde vive lo que se pide en la
   *  caja. Una lectura que llegó pero sin poder leer los pedidos (`pendientes_ok: false`) no cuenta: su `pendientes`
   *  vacía no dice que no haya. */
  const cargar = useCallback(async (): Promise<boolean> => {
    const [ps, sl, im, ed, cl] = await Promise.allSettled([
      cargarProyectos(),
      cargarSlots(),
      cargarImagenes(),
      cargarEdiciones(),
      cargarClips(),
    ]);
    // sin la lista de proyectos se avisa y el inicio se queda con lo que tenía
    if (ps.status === 'rejected') {
      setFalloCarga(true);
      return false;
    }
    setFalloCarga(false);
    if (ed.status === 'fulfilled') {
      // una copia que editaba y ya no (falló, o terminó): el servidor pudo devolver lo cobrado —al fallar, o al no haber nada que
      // cortar—, así que el saldo se pone al día ya y otra vez un momento después, cuando el worker haya terminado de devolver
      if (ed.value.some(e => (e.editar?.estado === 'error' || e.editar?.estado === 'listo') && editandoCopias.current.has(e.nombre))) {
        refrescarSaldo();
        saldoPendiente.current.push(setTimeout(refrescarSaldo, SALDO_TRAS_COPIA_MS));
      }
      editandoCopias.current = new Set(ed.value.filter(e => e.editar?.estado === 'corriendo').map(e => e.nombre));
    }
    const pedidos = im.status === 'fulfilled' && im.value.pendientesOk ? im.value.pendientes : null;
    if (pedidos) {
      // una que generaba y ahora falló: ya se devolvió lo cobrado, el saldo se pone al día
      if (pedidos.some(p => p.estado === 'error' && generandoImagenes.current.has(p.id))) refrescarSaldo();
      generandoImagenes.current = new Set(pedidos.filter(p => p.estado === 'generando').map(p => p.id));
      setSinConfirmar(false);
    }
    setListas(antes => ({
      proyectos: ps.value,
      slots: sl.status === 'fulfilled' ? sl.value.slots : null,
      imagenes: im.status === 'fulfilled' ? im.value.imagenes : null,
      ediciones: ed.status === 'fulfilled' ? ed.value : null,
      clips: cl.status === 'fulfilled' ? cl.value : null,
      // si la lista de imágenes no llegó, o llegó sin poder leer los pedidos, estos se quedan como estaban: sin ellos
      // el sondeo se pararía a medias (las imágenes ya terminadas que sí vinieron se siguen mostrando)
      pedidos: pedidos ?? antes?.pedidos ?? [],
    }));
    return pedidos !== null;
  }, []);

  // la lista ya trae lo pedido en la caja: sus tarjetas locales se van
  const quitarPendientes = useCallback((claves: string[]) => {
    setPendientes(l => l.filter(p => !claves.includes(p.clave)));
    setEsperandoLista(l => l.filter(e => !claves.includes(e.clave)));
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

  // la entrada ya se leyó: la URL vuelve a /estudio/inicio/ (sin tocar lo demás, como ?blotato=conectar) para que recargar o compartir
  // el enlace no repita el recorrido, y «atrás» siga llevando a la pantalla de donde se vino.
  // En la página de una herramienta la caja (hija: sus efectos corren antes) ya pudo cambiar el camino a la dirección de su pestaña
  // (`seguirLaPestana`, que también quita lo que se leyó); entonces aquí no queda nada que limpiar. Si la pestaña ya era la de la dirección,
  // esto quita el `?prompt=`
  useEffect(() => {
    const limpia = urlSinEntrada(location.href);
    if (limpia) reemplazarDireccion(limpia);
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

  // Un video corto tarda un par de minutos y una imagen de un modelo lento, medio
  // minuto: mientras alguno se genera, la galería se vuelve a pedir sola (cada 5 s,
  // como la pantalla del clip). También mientras una imagen recién pedida espera que
  // una relectura salga bien: sin ella, ni la tarjeta ni el sondeo tendrían de dónde seguir.
  // E2: una copia que se está editando también (su tarjeta «Editando…» pasa a «Listo» o «No se pudo editar» sin recargar)
  // (solo una que corre DE VERDAD: una tarea muerta que el servidor aún dice «corriendo» no puede mantener la pantalla sondeando para siempre)
  const hayGenerando =
    (listas?.clips?.some(c => c.estado === 'generando') ?? false) ||
    (listas?.pedidos.some(p => p.estado === 'generando') ?? false) ||
    (listas?.ediciones?.some(e => corriendoVivo(e)) ?? false);
  useEffect(() => {
    if (!hayGenerando && !esperandoLista.length) return;
    const t = setInterval(() => {
      // esta lectura empezó después de pedirlas: si sale bien, las trae y sus tarjetas locales sobran
      void cargar().then(llego => {
        if (!esperandoLista.length) return;
        if (llego) return quitarPendientes(esperandoLista.map(e => e.clave));
        // sin una lectura buena en ESPERA_MAXIMA_MS la tarjeta no puede girar para siempre: se suelta y se avisa
        const vencidas = esperandoLista.filter(e => Date.now() - e.desde >= ESPERA_MAXIMA_MS);
        if (vencidas.length) {
          quitarPendientes(vencidas.map(e => e.clave));
          setSinConfirmar(true);
        }
      });
    }, 5000);
    return () => clearInterval(t);
  }, [hayGenerando, esperandoLista, cargar, quitarPendientes]);

  // La bandeja «Tus trabajos» (static/trabajos.js) acaba de lanzar algo por su cuenta —un «Reintentar» que el servidor aceptó—: la copia ya
  // corre, pero aquí su tarjeta decía «No se pudo editar» y, sin nada corriendo en esta lista, nada la volvía a leer. Se relee ya; con la
  // copia «corriendo» el sondeo de arriba la lleva hasta «Listo».
  useEffect(() => {
    const releer = () => void cargar();
    window.addEventListener('trabajos:lanzado', releer);
    return () => window.removeEventListener('trabajos:lanzado', releer);
  }, [cargar]);

  // «Usar como referencia» del visor: la imagen vuelve a la caja, lista para animarla
  async function usarComoReferencia(im: Imagen) {
    try {
      caja.current?.referencia(await traerImagen(im));
    } catch {
      setAviso('No pudimos traer esa imagen — inténtalo de nuevo.');
    }
  }

  async function accion(p: Proyecto, verbo: 'archivar' | 'desarchivar') {
    try {
      await (verbo === 'archivar' ? archivar(p.id) : desarchivar(p.id));
      setAviso('');
      await cargar();
    } catch (e) {
      setAviso(e instanceof ErrorApi && e.estado === 0 ? 'Sin conexión — intenta de nuevo.' : mensaje(e) || 'No se pudo — intenta de nuevo.');
    }
  }

  // lo mismo que decide Recorrido para esconder la caja: con ella a la vista se ven también las listas de debajo, y la pista corre
  const verCaja = cajaVisible(recorrido);
  const activos = listas?.proyectos.filter(p => !p.archivado) ?? [];
  const archivados = listas?.proyectos.filter(p => p.archivado) ?? [];
  // Los tres caminos, solo si todas las listas respondieron y todas vienen
  // vacías. Una que falló no cuenta como vacía: a quien ya tiene cosas no se
  // le enseña el inicio de alguien nuevo por un fetch (UI·10).
  const nuevo =
    listas !== null &&
    !pendientes.length &&
    !listas.proyectos.length &&
    listas.imagenes !== null &&
    !listas.imagenes.length &&
    listas.ediciones !== null &&
    !listas.ediciones.length &&
    listas.clips !== null &&
    !listas.clips.length &&
    !listas.pedidos.length;

  return (
    <>
      {/* La altura de la ventana (`min-h-dvh`) es lo que deja a Recorrido centrar el mapa, las opciones y las listas en el alto que
          sobra; con ellos no hay nada debajo que separar (sin `pb`), y con la caja sí (sus listas terminan ahí) */}
      <main className={unir('mx-auto flex min-h-dvh max-w-[1100px] flex-col px-4 pt-16 max-[380px]:px-3', verCaja ? 'pb-8' : 'pb-0')}>
        <Recorrido
          estado={recorrido}
          despachar={despachar}
          conectado={conectado}
          alConectar={abrirBlotato}
          ir={ir}
          tituloCaja={tituloCaja}
          hrefDeMiga={pestanaDeLugar ? a => urlDeAccion(a, recorrido) : undefined}
        >
          <Caja
            ref={caja}
            ir={ir}
            imagenes={listas?.imagenes ?? undefined}
            tituloRef={tituloCaja}
            llegada={llegada}
            familiaInicial={pestanaDeLugar}
            alCambiarFamilia={pestanaDeLugar ? seguirLaPestana : undefined}
            enVista={verCaja}
            alEditar={() => void cargar()}
            alPedir={p => setPendientes(l => [p, ...l])}
            alTerminar={(clave, esperarLista) => {
              // la lista ya trae lo nuevo (o el error se ve en la caja): la tarjeta de «generando» se va.
              // Una imagen que el servidor aceptó se queda hasta que la lista llegue: si esa lectura
              // falla (o no pudo leer los pedidos), la tarjeta es lo único que dice que va en camino
              // (se reintenta cada 5 s, hasta ESPERA_MAXIMA_MS).
              const desde = Date.now();
              // las que ya esperaban cuando sale esta lectura: si sale bien, las trae a ellas también
              const previas = esperando.current.map(e => e.clave);
              void cargar().then(llego => {
                if (llego) quitarPendientes([clave, ...previas]);
                else if (!esperarLista) quitarPendientes([clave]);
                else setEsperandoLista(l => [...l, { clave, desde }]);
              });
            }}
          />
        </Recorrido>

        {/* Debajo de la tarjeta, del mismo ancho, y SOLO con la caja a la vista: con el mapa, las tres opciones o la lista de un
            grupo no pintan nada (y siguen montadas: una galería que se desmonta pierde su filtro y su visor) */}
        <div hidden={!verCaja} className="mx-auto mt-8 w-full max-w-[820px]">
          {(falloCarga || sinConfirmar) && (
            <div className="mb-6">
              <Aviso tipo="error">
                No pudimos traer tus videos. Revisa tu conexión e inténtalo de nuevo.{' '}
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

          {listas === null && !falloCarga && <p className="m-0 text-xs text-secundario">Cargando tus videos…</p>}

          {/* R4b: todo lo que hiciste en una galería. Los slots siguen contando
              solo películas: un clip, una imagen o unos shorts no ocupan lugar */}
          {listas && !nuevo && (
            <Galeria
              creaciones={creaciones(listas.proyectos, listas.clips, listas.ediciones, listas.imagenes)}
              pendientes={[...pendientes, ...listas.pedidos.map(comoPendiente)]}
              slots={<span className="text-xs text-secundario">{textoSlots(activos.length, listas.slots)}</span>}
              alArchivar={setAArchivar}
              alUsarReferencia={usarComoReferencia}
              alReintentar={cargar}
            />
          )}
          {listas && !nuevo && listas.clips === null && (
            <p className="-mt-4 mb-7 text-xs text-secundario">
              No pudimos traer tus videos cortos.{' '}
              <Boton nivel="enlace" className="text-xs" onClick={() => void cargar()}>
                Reintentar
              </Boton>
            </p>
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
        </div>
      </main>

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
    </>
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
