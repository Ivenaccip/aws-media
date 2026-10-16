// El estado de la caja de «Edición» (E1 y E2): lo que la persona escribió, los videos que juntó, su precio y la corrida que lanzó.
// Vive en un hook que llama Caja —no en CajaEdicion— a propósito: cambiar de familia (Imagen, Video, Edición) desmonta la caja de
// Edición, y ni el texto, ni la lista de videos, ni una subida a medias se pueden perder por eso (la subida sigue y al volver ya está lista).
//
// Orden de las cosas, y de qué es cada una:
//   1. juntar videos: subir de la computadora (VARIOS, en cola, de uno en uno: nucleo/subida, firmar, PUT con progreso, confirmar) y/o
//      elegir de «Mis creaciones» (la hoja entrega referencias; no hay nada que traer: la copia la hace el servidor). Cada video de la
//      caja tiene una referencia —«proyecto:<nombre>» o «clip:<id>»— y el orden de la lista ES el orden en que se unen. El nombre del
//      proyecto de una subida sale del archivo; si ya es un proyecto TUYO con video (no mezclar con su transcripción) o si otra cuenta
//      lo usa (409), se estrena un nombre alterno (el 409, con UN reintento).
//   2. precio: POST /api/edicion/cotizar con las referencias. El servidor mide cada video, decide si el conjunto se puede editar y cuánto
//      cuesta; si manda un `bloqueo` se enseña tal cual y no se deja editar. Se vuelve a pedir cuando cambia QUÉ hay en la caja
//      (agregar o quitar), no cuando cambia el orden: el orden no cambia ni el precio ni la validez.
//   3. lanzar: POST /api/edicion/iniciar con {pedido, videos, instruccion}. El servidor copia, cobra antes de lanzar y devuelve los
//      créditos si no pudo: aquí nunca viaja un número de créditos ni una key de S3. `pedido` es la clave de idempotencia: la MISMA
//      mientras la respuesta sea dudosa (red caída, tiempo agotado), para que reintentar no cobre dos veces; otra con cualquier
//      respuesta de verdad o cuando cambia lo que se pide.
//   4. sondeo: tras lanzar, y solo entonces (nunca al montar), se pregunta cada 5 s si la copia sigue en marcha. Mientras siga, o mientras
//      se suba algo, no se empieza otra cosa. El servidor lo garantiza (409); este aviso es de la pantalla.
//
// El chip «Editar ▾» tiene dos modos y el modo también vive aquí (por lo mismo: cambiar de familia o abrir el mapa no lo
// pierde). «De videos a Shorts» usa la misma subida (progreso, cancelar, tarjeta del video) pero con UN solo video, NO pide el precio de
// Edición ni cobra nada: «Iniciar» lleva a /estudio/shorts/ con la liga o el proyecto, y esa pantalla es la que muestra cada
// precio y cobra con su propio botón.
//
// Por qué no es un <BotonCobro>: ese se apaga con `disabled` (no se enfoca ni explica) y aquí el apagado tiene que seguir
// enfocable (sin texto lleva el foco al campo; con un aviso del servidor, al «+»). Las reglas de dinero que BotonCobro impone viven
// aquí, cada una con su prueba: el candado se cierra antes del primer await (doble clic y Enter repetido = UNA petición),
// sin saldo conocido no se pide nada, y el «−N» solo vuela cuando el servidor aceptó, con lo que el servidor cobró.
//
// La lista de videos vive en dos lugares a propósito: `lista` (un ref) es la verdad que leen las funciones asíncronas —una subida que
// termina dentro de un minuto debe ver la lista de AHORA, no la del render en que empezó— y `videos` (estado) es lo que se pinta.
import { useEffect, useRef, useState, type RefObject } from 'react';

import { ErrorApi } from '../../nucleo/api';
import { moderar } from '../../nucleo/moderar';
import { cargarConfig, confirmar, firmar, nombreAlterno, subirConProgreso } from '../../nucleo/subida';
import { avisarCobro, refrescarSaldo, useSaldo } from '../../marca/useSaldo';
import { esLigaDeYoutube, LIGA_INVALIDA } from '../shorts/logica';
import {
  AVISO_OCUPADO,
  AVISO_SIN_FUENTE,
  AVISO_SIN_VIDEO,
  avisoDeExito,
  destinoShorts,
  estadoDeShorts,
  estadoDelBoton,
  faltanTras402,
  limpiarInstruccion,
  nombreDeProyecto,
  type EstadoBoton,
  type EstadoBotonShorts,
  type EstadoCotizacion,
  type FaseVideo,
  type IdModo,
} from './edicion';
import {
  cotizarEdicion,
  DESCRIPCION_VIDEOS,
  iniciarEdicion,
  nombreYaTieneVideo,
  pedirEstadoEdicion,
  rechazoVideo,
  soloVideos,
  type Cotizacion,
  type FormatoVideo,
  type TipoVideo,
  type VideoElegible,
} from './envio';
// CORRIDA_MAX_MS: el servidor da por caducada una corrida a las 2 h (server/edicion_api.py) y la pantalla también deja de esperarla
import { CORRIDA_MAX_MS, cargarEdiciones } from './logica';
import { claveDeSubida, mover as moverEnLista, MAX_VIDEOS, quitarDe } from './reglasVideos';

/** Cada cuánto se pregunta si la corrida sigue, una vez lanzada. */
const SONDEO_MS = 5000;

/** Lo que dice nucleo/subida cuando se cae la red a mitad del PUT: aquí se completa con cuánto había subido (lienzo: «Se perdió la
 *  conexión a los 41 %»). Una prueba comprueba que siga siendo ese texto. */
export const ERROR_DE_RED_AL_SUBIR = 'La subida falló — revisa tu conexión e intenta de nuevo.';
/** Esta instalación no sube videos (`/api/media/config`: `activo` en falso): no es de ningún archivo y no se dice con el nombre de uno. */
const SIN_SUBIDAS = 'Subir videos no está disponible en esta instalación.';

/** Un video de la caja: uno que se subió de la computadora, o una creación elegida de «Mis creaciones». */
export interface VideoDeEdicion {
  /** Estable mientras esté en la caja: la `key` de React y con lo que se quita o se mueve. */
  id: string;
  /** Cómo se llama en pantalla: el archivo, o el título de la creación. */
  nombre: string;
  origen: 'subido' | 'creacion';
  /** El archivo (solo en lo subido de la computadora). */
  archivo: File | null;
  /** El nombre del proyecto en el servidor: el del archivo, o su variante si otra cuenta ya lo tenía. Vacío en una creación. */
  proyecto: string;
  /** «proyecto:<nombre>» o «clip:<id>»: null mientras una subida no se confirma. Es lo ÚNICO que viaja al servidor. */
  ref: string | null;
  tipo: TipoVideo | null;
  fase: FaseVideo;
  /** 0–100, la subida a la nube. */
  pct: number;
  /** Lo que sabe la caja de él: de una creación, lo que dijo la lista; de una subida, lo que midió el servidor al cotizar. */
  duracion_s: number | null;
  formato: FormatoVideo | null;
  bytes: number | null;
}

/** Cómo le habla la caja a la persona: el canal de avisos de Caja (cuadro de abajo a la derecha, o junto a la caja). */
export interface Mensajes {
  decir(tipo: 'ok' | 'mal', texto: string): void;
  limpiarError(): void;
  /** Lo que se dijo en verde junto a la caja (donde no hay cuadro) ya no aplica. */
  olvidarAviso(): void;
}

export interface ManejoEdicion {
  /** El modo del chip «Editar ▾»: lo que la caja enseña y a dónde lleva «Iniciar». */
  modo: IdModo;
  /** La liga de YouTube escrita en el modo Shorts (queda escrita aunque se cambie de modo). */
  liga: string;
  /** Lo que está mal de la liga, junto al campo (null = nada). Se va en cuanto se escribe otra. */
  errorLiga: string | null;
  texto: string;
  /** Hay algo que decirle a la IA: lo que de verdad le llegaría (sin espacios ni caracteres invisibles), no lo que se ve. */
  hayTexto: boolean;
  /** Los videos de la caja, en el orden en que se unen. */
  videos: VideoDeEdicion[];
  /** El que ve el modo Shorts: el primero que se subió de la computadora (Shorts trabaja con UN video). */
  video: VideoDeEdicion | null;
  /** El precio de lo que hay en la caja (lo calcula el servidor). */
  cotizacion: EstadoCotizacion;
  boton: EstadoBoton;
  /** Lo que dice el botón principal cuando el modo es Shorts. */
  botonShorts: EstadoBotonShorts;
  /** Una subida (o su cola) o una corrida en curso: «+» e «Iniciar» avisan en vez de empezar otra. */
  ocupado: boolean;
  /** Entre el clic y la respuesta del servidor. */
  lanzando: boolean;
  saldo: number | null;
  /** Lo lee el lector de pantalla tras mover un video: «“Perro” ahora es el número 2 de 3.». */
  movido: string;
  /** Lo que le falta de saldo (0 = nada), sabido por el saldo o por el 402 del servidor. */
  faltan: number;
  escribir(texto: string): void;
  escribirLiga(liga: string): void;
  /** Cambia de modo desde el chip. Elegir el de ahora no hace nada. */
  elegirModo(id: IdModo): void;
  /** Los archivos que llegan del selector o de soltarlos en la caja. */
  recibir(archivos: File[]): void;
  /** Lo que se eligió de «Mis creaciones» (la hoja), al final de la caja y sin repetir lo que ya está. */
  agregarElegidos(elegidos: VideoElegible[]): void;
  quitar(id: string): void;
  /** Sube (-1) o baja (+1) un video: cambia el orden en que se unen. No cobra ni vuelve a cotizar. */
  mover(id: string, d: -1 | 1): void;
  /** El «+» de Shorts (un solo video): abre el selector de archivos. */
  tocarMas(): void;
  /** El «+» de Editar: ¿se puede abrir el menú? Con una subida o una corrida en marcha dice por qué no (y devuelve false). */
  puedeAgregar(): boolean;
  /** «Subir de tu computadora» del menú del «+»: abre el selector de archivos. */
  abrirSelector(): void;
  /** El botón principal, «Iniciar»: en Editar lanza la corrida; en Shorts lleva a su pantalla. */
  tocarIniciar(): void;
}

/** Los elementos a los que hay que llevar el foco o hacer clic. Van APARTE del resto: lo que lee el render no debe
 *  colgar de un objeto que lleva refs (la regla react-hooks/refs lo marcaría entero). */
export interface RefsEdicion {
  area: RefObject<HTMLTextAreaElement | null>;
  /** El campo de la liga (solo existe en el modo Shorts, sin video). */
  liga: RefObject<HTMLInputElement | null>;
  mas: RefObject<HTMLButtonElement | null>;
  archivos: RefObject<HTMLInputElement | null>;
  principal: RefObject<HTMLButtonElement | null>;
}

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Una clave de 32 caracteres hexadecimales (`^[0-9a-f]{32}$`): la clave de idempotencia de un pedido. */
function nuevoPedido(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * ¿Se quedó sin saberse si el servidor recibió el pedido? Sin respuesta (la red se cayó con él en el aire), con un 504 (la puerta de
 * enlace se rindió esperando: el servicio pudo seguir y cobrar) o con una respuesta que no se pudo leer. Entonces el pedido se
 * reintenta con la MISMA clave: si salió, el servidor lo reconoce y no cobra otra vez. Cualquier otra respuesta es de verdad (aceptó, o
 * dijo por qué no): la clave se renueva.
 */
const respuestaDudosa = (e: unknown) => !(e instanceof ErrorApi) || e.estado === 0 || e.estado === 504;

/** El 409 que dice que algo YA está en curso —«Ya hay un trabajo en curso…» (el `ocupado` de E2) o «La corrida ya está en curso…» (el de
 *  E1)—: el único 409 tras el cual la pantalla sabe que corre otra edición. Los demás se leen tal cual y no cambian lo que la pantalla
 *  cree: «Esta edición ya falló y se te devolvió…» (deja volver a pulsar «Iniciar») y «Todavía estamos devolviendo los créditos de esta
 *  edición…» (hay una deuda, no una tarea en curso). */
const YA_HAY_TAREA = /en curso/i;

/** Una respuesta de error que NO es de la aplicación sino de la puerta de enlace (un 5xx cuyo cuerpo es `{"message": …}`, sin el `detail`
 *  del servidor): el pedido pudo haber llegado, cobrado y lanzado antes de que la puerta se rindiera. */
const deLaPuerta = (e: unknown) => e instanceof ErrorApi && e.estado >= 500 && typeof e.detalle !== 'string';

/** `ir` es el de Caja: a dónde navegar (location.assign en la página, un espía en los tests). Solo lo usa «Iniciar» en Shorts.
 *  `alEditar`: el servidor aceptó una edición (la lista de «Mis creaciones» ya tiene su tarjeta «Editando…»). */
export function useEdicion(
  { decir: decirAfuera, limpiarError: limpiarAfuera, olvidarAviso }: Mensajes,
  ir: (url: string) => void,
  alEditar?: () => void,
): [ManejoEdicion, RefsEdicion] {
  // lo último que se dijo fue «Ya hay un trabajo en curso…»: cuando ese trabajo termina, el aviso se quita solo (el lienzo lo
  // hace: un aviso que dice «espera» no puede quedarse cuando ya no hay nada que esperar). Cualquier otra cosa que se diga o
  // se quite lo suelta: lo que reemplazó a ese aviso no es de este hook para quitarlo
  const avisoOcupado = useRef(false);
  const decir: Mensajes['decir'] = (tipo, texto) => {
    avisoOcupado.current = texto === AVISO_OCUPADO;
    decirAfuera(tipo, texto);
  };
  // lo que falló al subir en ESTA cola, ya dicho con el nombre de su archivo: la caja tiene UN solo canal de avisos y cada fallo lo pisaba, así
  // que con dos archivos perdidos solo se leía el último (y ninguno decía cuál era). Quitar el error de la caja (limpiarError) la vacía
  const fallosDeSubida = useRef<string[]>([]);
  const limpiarError = () => {
    avisoOcupado.current = false;
    fallosDeSubida.current = [];
    limpiarAfuera();
  };
  const [modo, setModo] = useState<IdModo>('editar');
  // el modo de AHORA, para lo que se pregunta tras un await (la cola de subida: ¿hay que pedir el precio de Edición?): la
  // closure de `subir` es la del render en que empezó, y para entonces la persona pudo cambiar el chip
  const modoVigente = useRef<IdModo>('editar');
  const [liga, setLiga] = useState('');
  const [errorLiga, setErrorLiga] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [videos, setVideos] = useState<VideoDeEdicion[]>([]);
  const [cotizacion, setCotizacion] = useState<EstadoCotizacion>({ fase: 'ninguna' });
  const [movido, setMovido] = useState('');
  const [lanzando, setLanzando] = useState(false);
  // la copia lanzada que sigue en pie: se le pregunta al servidor hasta que termine. `copia` null = el servidor dijo que ya había otra
  // en curso (409) y no se sabe cuál: se pregunta por la lista de ediciones
  const [enCurso, setEnCurso] = useState<{ copia: string | null; desde: number } | null>(null);
  // lo que faltó según el 402 del servidor, con el saldo que había entonces: vale mientras el saldo no cambie (si
  // monedero.js ya trae el de verdad, manda ese)
  const [sinSaldoDelServidor, setSinSaldoDelServidor] = useState<{ faltan: number; saldo: number | null } | null>(null);
  const saldo = useSaldo();

  const area = useRef<HTMLTextAreaElement>(null);
  const campoLiga = useRef<HTMLInputElement>(null);
  const mas = useRef<HTMLButtonElement>(null);
  const archivos = useRef<HTMLInputElement>(null);
  const principal = useRef<HTMLButtonElement>(null);
  const candado = useRef(false); // un doble clic es UNA petición: se cierra antes del primer await
  const lista = useRef<VideoDeEdicion[]>([]); // la verdad de la lista (ver la cabecera); `videos` es su copia para pintar
  const secuencia = useRef(0);
  const intentoPrecio = useRef(0); // cambiar lo que hay en la caja invalida el precio que aún venía en camino
  const faseDelPrecio = useRef<EstadoCotizacion['fase']>('ninguna');
  const trabajando = useRef(false); // la cola de subida tiene UN solo trabajador
  const subiendoAhora = useRef<string | null>(null);
  const cancelarSubida = useRef<(() => void) | null>(null);
  const desmontado = useRef(false);
  // la clave del pedido y la composición a la que pertenece (videos en su orden + el texto limpio)
  const pedido = useRef<{ clave: string; composicion: string } | null>(null);

  // algo sube o espera su turno (la caja cuenta como ocupada hasta que termina la cola)
  const hayCola = videos.some(v => v.fase !== 'listo');
  const ocupado = hayCola || enCurso !== null || lanzando;
  // «hay texto» es lo que le llegaría a la IA, no lo que se ve: un campo con solo caracteres invisibles está vacío
  const hayTexto = limpiarInstruccion(texto) !== '';
  const video = videos.find(v => v.origen === 'subido') ?? null;
  const boton = estadoDelBoton({ videos: videos.length, subiendo: hayCola, cotizacion, hayTexto, saldo });
  const botonShorts = estadoDeShorts({ video, liga });
  const faltanLocal = boton.tipo === 'sin_saldo' ? boton.faltan : 0;
  const faltanDelServidor = sinSaldoDelServidor && sinSaldoDelServidor.saldo === saldo ? sinSaldoDelServidor.faltan : 0;
  const faltan = Math.max(faltanLocal, faltanDelServidor);

  // el trabajo que el aviso pedía esperar ya terminó (subida lista o corrida terminada): el aviso se va
  useEffect(() => {
    if (ocupado || !avisoOcupado.current) return;
    avisoOcupado.current = false;
    limpiarAfuera();
  }, [ocupado, limpiarAfuera]);

  // cerrar la pestaña con la subida (o su cola) a medias la pierde: el navegador avisa
  useEffect(() => {
    if (!hayCola) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [hayCola]);

  // la caja se desmontó: una subida a medias no sigue sola ni confirma un proyecto que ya nadie va a ver, la cola se vacía, y lo que el
  // precio aún esperaba deja de valer (cambiar de familia NO desmonta este hook: vive en Caja)
  useEffect(() => {
    const cancelar = cancelarSubida;
    const fin = desmontado;
    const precio = intentoPrecio;
    fin.current = false; // StrictMode monta, desmonta y vuelve a montar
    return () => {
      fin.current = true;
      precio.current++;
      cancelar.current?.();
      cancelar.current = null;
    };
  }, []);

  // la copia lanzada: se pregunta cada 5 s (solo desde que se lanzó) hasta que termine. Al terminar el saldo se pone al día: si no
  // hubo nada que quitar, o falló por nuestro lado, el servidor devolvió los créditos
  useEffect(() => {
    if (!enCurso) return;
    let vigente = true;
    const terminar = () => {
      setEnCurso(null);
      refrescarSaldo();
    };
    const t = setInterval(() => {
      // el tope no espera a que el servidor conteste: una pregunta que nunca vuelve no deja la caja bloqueada
      if (Date.now() - enCurso.desde >= CORRIDA_MAX_MS) {
        terminar();
        return;
      }
      const sigue = enCurso.copia
        ? pedirEstadoEdicion(enCurso.copia).then(st => st.editar?.estado === 'corriendo')
        : cargarEdiciones().then(l => l.some(e => e.editar?.estado === 'corriendo'));
      void sigue.then(
        corre => {
          if (vigente && !corre) terminar();
        },
        e => {
          // un 404 es que el proyecto ya no existe: nada corre. Lo demás (sin red, 5xx) no dice nada: se sigue preguntando
          if (vigente && e instanceof ErrorApi && e.estado === 404) terminar();
        },
      );
    }, SONDEO_MS);
    return () => {
      vigente = false;
      clearInterval(t);
    };
  }, [enCurso]);

  function enfocarTexto() {
    area.current?.focus();
  }

  function escribir(nuevo: string) {
    setTexto(nuevo);
    olvidarAviso();
  }

  function escribirLiga(nueva: string) {
    setLiga(nueva);
    setErrorLiga(null);
    // lo de antes («primero pega la liga») ya no vale
    limpiarError();
  }

  // --- la lista --------------------------------------------------------------------------------------------------------------

  function guardarLista(nueva: VideoDeEdicion[]) {
    lista.current = nueva;
    setVideos(nueva);
  }

  function cambiar(id: string, cambios: Partial<VideoDeEdicion>) {
    guardarLista(lista.current.map(v => (v.id === id ? { ...v, ...cambios } : v)));
  }

  /** ¿Ese video sigue en la caja? Quitarlo (o desmontar) en medio de una subida deja a la subida sin a quién avisar. */
  const sigue = (id: string) => !desmontado.current && lista.current.some(v => v.id === id);

  function ponerPrecio(nuevo: EstadoCotizacion) {
    faseDelPrecio.current = nuevo.fase;
    setCotizacion(nuevo);
  }

  /** Cambió QUÉ hay en la caja (agregar o quitar; no reordenar): el precio de antes no vale. Si todo está subido y el modo es Editar, se
   *  vuelve a pedir; si aún falta subir algo, se pide al terminar la cola. */
  function cambioElConjunto() {
    intentoPrecio.current++;
    setSinSaldoDelServidor(null);
    if (!lista.current.length || modoVigente.current !== 'editar' || lista.current.some(v => v.fase !== 'listo')) {
      ponerPrecio({ fase: 'ninguna' });
      return;
    }
    void pedirPrecio();
  }

  /** Pide el precio de TODO lo que hay en la caja. Si no llega, la caja se queda e «Iniciar» lo vuelve a pedir. */
  async function pedirPrecio() {
    const refs = lista.current.map(v => v.ref);
    if (!refs.length || refs.some(r => r === null)) return;
    const mio = ++intentoPrecio.current;
    ponerPrecio({ fase: 'calculando' });
    try {
      const c = await cotizarEdicion(refs as string[]);
      if (intentoPrecio.current !== mio) return;
      if (!c || typeof c !== 'object') throw new Error('sin precio');
      // lo que midió el servidor (duración y formato de cada subida) se queda en su ficha
      const medidas = new Map((Array.isArray(c.videos) ? c.videos : []).map(m => [m.ref, m]));
      guardarLista(
        lista.current.map(v => {
          const m = v.ref ? medidas.get(v.ref) : undefined;
          return m ? { ...v, duracion_s: m.duracion_s ?? v.duracion_s, formato: m.formato ?? v.formato, bytes: m.bytes ?? v.bytes } : v;
        }),
      );
      ponerPrecio({ fase: 'lista', datos: c as Cotizacion });
    } catch (e) {
      if (intentoPrecio.current !== mio) return;
      ponerPrecio({ fase: 'sin_precio' });
      decir('mal', mensaje(e));
    }
  }

  function elegirModo(id: IdModo) {
    if (id === modo) return;
    modoVigente.current = id;
    setModo(id);
    // lo que decía el otro modo (un aviso, el error de la liga) no es de este
    setErrorLiga(null);
    limpiarError();
    olvidarAviso();
    // lo que se subió estando en Shorts no trae el precio de Edición: se pide al pasar a Editar, como si se hubiera subido allí
    if (
      id === 'editar' &&
      lista.current.length &&
      lista.current.every(v => v.fase === 'listo') &&
      (faseDelPrecio.current === 'ninguna' || faseDelPrecio.current === 'sin_precio')
    ) {
      void pedirPrecio();
    }
  }

  // --- subir -----------------------------------------------------------------------------------------------------------------

  function siguienteId() {
    secuencia.current += 1;
    return `v${secuencia.current}`;
  }

  /** Sube UN video de la cola. Si lo quitan en medio (o se desmonta la caja) se detiene sin decir nada: no es un error de nadie. */
  async function subirUno(id: string) {
    const inicial = lista.current.find(v => v.id === id);
    const archivo = inicial?.archivo;
    if (!inicial || !archivo) return;
    let proyecto = inicial.proyecto;
    subiendoAhora.current = id;
    cambiar(id, { fase: 'subiendo', pct: 0 });
    try {
      const cfg = await cargarConfig();
      if (!sigue(id)) return;
      if (!cfg.activo) throw new Error(SIN_SUBIDAS);
      // «video.mp4», «final.mp4»… se repiten: si ese nombre ya es un proyecto tuyo con video, reusarlo mezclaría el nuevo con la
      // transcripción y los cortes del viejo. Se estrena un nombre (el 409 de abajo sigue cubriendo el de otra cuenta). Y si OTRO video de
      // esta misma caja ya lo lleva, también: dos archivos del mismo nombre no son el mismo proyecto
      const yaEra = await nombreYaTieneVideo(proyecto);
      if (!sigue(id)) return;
      if (yaEra || lista.current.some(v => v.id !== id && v.fase !== 'en_cola' && v.proyecto === proyecto)) {
        proyecto = nombreAlterno(proyecto);
        cambiar(id, { proyecto });
      }
      let firma;
      try {
        firma = await firmar(proyecto, archivo);
      } catch (e) {
        if (!(e instanceof ErrorApi && e.estado === 409)) throw e;
        // el nombre es único entre TODAS las cuentas: nada se subió todavía, así que se prueba con una variante
        proyecto = nombreAlterno(proyecto);
        if (sigue(id)) cambiar(id, { proyecto });
        firma = await firmar(proyecto, archivo);
      }
      if (!sigue(id)) return; // lo quitaron mientras se pedía el permiso
      const envio = subirConProgreso(firma, archivo, a => {
        if (sigue(id)) cambiar(id, { pct: a.pct });
      });
      cancelarSubida.current = envio.cancelar;
      try {
        await envio.hecho;
      } finally {
        cancelarSubida.current = null;
      }
      if (!sigue(id)) return;
      // el nombre del archivo tal como la persona lo vio: el de la key va saneado («Mi Entrevista (1).mp4» → «Mi_Entrevista_1.mp4») y
      // de él saldría el título de la copia
      await confirmar(proyecto, firma.key, archivo.name);
      if (!sigue(id)) return;
    } catch (e) {
      // quitar el video cancela el PUT y eso rechaza la promesa: no es un error de nadie
      if (!sigue(id)) return;
      const pct = lista.current.find(v => v.id === id)?.pct ?? 0;
      guardarLista(quitarDe(lista.current, lista.current.findIndex(v => v.id === id)));
      // con varios archivos en la cola, «La subida falló» a secas no dice de quién: cada fallo lleva el nombre del suyo, como los rechazos
      // (lo de la instalación entera —no hay subidas— no es de ningún archivo: se dice una vez, sin nombre)
      const motivo =
        mensaje(e) === ERROR_DE_RED_AL_SUBIR
          ? textoDeRedCortada(pct, archivo.name)
          : mensaje(e) === SIN_SUBIDAS
            ? SIN_SUBIDAS
            : `“${archivo.name}”: ${mensaje(e)}`;
      if (!fallosDeSubida.current.includes(motivo)) fallosDeSubida.current = [...fallosDeSubida.current, motivo];
      decir('mal', fallosDeSubida.current.join(' '));
      return;
    } finally {
      if (subiendoAhora.current === id) subiendoAhora.current = null;
    }
    // la subida confirmada es un proyecto del editor: desde aquí es un video más, con su referencia
    cambiar(id, { fase: 'listo', pct: 100, ref: claveDeSubida(proyecto), proyecto });
  }

  /** La cola: de uno en uno, en el orden de la lista. Al terminar, si todo quedó subido y el modo es Editar, se pide el precio. */
  async function procesarCola() {
    if (trabajando.current) return;
    trabajando.current = true;
    try {
      for (;;) {
        const siguiente = lista.current.find(v => v.fase === 'en_cola');
        if (!siguiente || desmontado.current) break;
        await subirUno(siguiente.id);
      }
    } finally {
      trabajando.current = false;
    }
    if (desmontado.current) return;
    // Shorts no pide el precio de Edición: el del análisis y el de cada short los muestra su pantalla, antes de cobrar
    if (modoVigente.current === 'editar' && lista.current.length && lista.current.every(v => v.fase === 'listo')) {
      await pedirPrecio();
    } else if (!lista.current.length) {
      ponerPrecio({ fase: 'ninguna' });
    }
  }

  function recibir(llegados: File[]) {
    if (ocupado) {
      decir('mal', AVISO_OCUPADO);
      return;
    }
    const delTipo = soloVideos(llegados);
    if (!delTipo.length) {
      if (llegados.length) decir('mal', `Eso no es un video. Sirven: ${DESCRIPCION_VIDEOS}.`);
      return;
    }
    // los que no sirven se rechazan UNO POR UNO con su motivo, y no frenan a los demás
    const motivos: string[] = [];
    const buenos: File[] = [];
    for (const f of delTipo) {
      const motivo = rechazoVideo(f);
      if (motivo) motivos.push(motivo);
      else buenos.push(f);
    }
    if (modoVigente.current === 'shorts') {
      // Shorts trabaja con UN video: si llegan varios se toma el primero y se dice; el que estaba en la caja se cambia por el nuevo
      const primero = buenos[0];
      if (!primero) {
        decir('mal', motivos.join(' '));
        return;
      }
      limpiarError();
      if (buenos.length > 1) decir('ok', `Por ahora se saca de un video a la vez: usamos «${primero.name}».`);
      guardarLista([]);
      ponerPrecio({ fase: 'ninguna' });
      agregarArchivos([primero]);
      return;
    }
    // Editar: cabe lo que falte hasta el tope; el resto se descarta y se dice
    const caben = Math.max(0, MAX_VIDEOS - lista.current.length);
    const entran = buenos.slice(0, caben);
    const avisos = [...motivos];
    if (buenos.length > entran.length) avisos.push(`Como mucho ${MAX_VIDEOS} videos.`);
    if (avisos.length) decir('mal', avisos.join(' '));
    else limpiarError();
    if (entran.length) agregarArchivos(entran);
  }

  /** Pone los archivos al final de la caja, «En cola», y arranca la cola. */
  function agregarArchivos(nuevos: File[]) {
    const nuevosVideos: VideoDeEdicion[] = nuevos.map(archivo => ({
      id: siguienteId(),
      nombre: archivo.name,
      origen: 'subido',
      archivo,
      proyecto: nombreDeProyecto(archivo.name),
      ref: null,
      tipo: null,
      fase: 'en_cola',
      pct: 0,
      duracion_s: null,
      formato: null,
      bytes: archivo.size,
    }));
    guardarLista([...lista.current, ...nuevosVideos]);
    cambioElConjunto();
    void procesarCola();
  }

  function agregarElegidos(elegidos: VideoElegible[]) {
    const hechos = lista.current;
    const nuevos = elegidos.filter(e => !hechos.some(h => h.ref === e.ref)).slice(0, Math.max(0, MAX_VIDEOS - hechos.length));
    if (!nuevos.length) return;
    limpiarError();
    guardarLista([
      ...hechos,
      ...nuevos.map(
        (e): VideoDeEdicion => ({
          id: siguienteId(),
          nombre: e.titulo,
          origen: 'creacion',
          archivo: null,
          proyecto: '',
          ref: e.ref,
          tipo: e.tipo,
          fase: 'listo',
          pct: 100,
          duracion_s: e.duracion_s,
          formato: e.formato,
          bytes: e.bytes,
        }),
      ),
    ]);
    cambioElConjunto();
  }

  function quitar(id: string) {
    if (candado.current) return; // ya salió el pedido: la caja no se toca a medias
    const i = lista.current.findIndex(v => v.id === id);
    if (i < 0) return;
    // quitar el que sube corta el PUT; quitar uno que espera su turno solo lo saca de la cola
    if (subiendoAhora.current === id) cancelarSubida.current?.();
    guardarLista(quitarDe(lista.current, i));
    setMovido('');
    limpiarError();
    cambioElConjunto();
    mas.current?.focus(); // el ✕ se va con el video: el foco no se queda en el aire
  }

  function mover(id: string, d: -1 | 1) {
    if (candado.current) return;
    const i = lista.current.findIndex(v => v.id === id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= lista.current.length) return;
    const movido = lista.current[i]!;
    guardarLista(moverEnLista(lista.current, i, d));
    // reordenar no cobra ni vuelve a cotizar: el orden no cambia ni el precio ni la validez
    setMovido(`“${movido.nombre}” ahora es el número ${j + 1} de ${lista.current.length}.`);
  }

  function tocarMas() {
    if (ocupado) {
      decir('mal', AVISO_OCUPADO);
      return;
    }
    limpiarError();
    archivos.current?.click();
  }

  function puedeAgregar() {
    if (ocupado) {
      decir('mal', AVISO_OCUPADO);
      return false;
    }
    limpiarError();
    return true;
  }

  function abrirSelector() {
    if (ocupado) {
      decir('mal', AVISO_OCUPADO);
      return;
    }
    archivos.current?.click();
  }

  // --- lanzar ----------------------------------------------------------------------------------------------------------------

  async function lanzar(creditos: number) {
    if (candado.current) return;
    const refs = lista.current.map(v => v.ref);
    if (!refs.length || refs.some(r => r === null)) return;
    // lo que le llega a la IA es el texto limpio (el servidor lo limpia igual); sin nada que decir no se pide ni se cobra
    const instruccion = limpiarInstruccion(texto);
    if (!instruccion) {
      enfocarTexto();
      return;
    }
    candado.current = true; // antes del primer await: doble clic = una petición
    setLanzando(true);
    setSinSaldoDelServidor(null);
    limpiarError();
    // la clave del pedido es de ESTA composición: otra lista, otro orden u otro texto es otro pedido
    const composicion = JSON.stringify([refs, instruccion]);
    if (pedido.current?.composicion !== composicion) pedido.current = { clave: nuevoPedido(), composicion };
    const clave = pedido.current.clave;
    try {
      const veredicto = await moderar(instruccion); // M13: se modera ANTES de lo que cobra
      if (!veredicto.permitido) {
        decir('mal', veredicto.mensaje);
        return;
      }
      const r = await iniciarEdicion({ pedido: clave, videos: refs as string[], instruccion });
      pedido.current = null; // contestó: lo que se pida después es otro pedido
      // el servidor aceptó: el «−N» vuela con lo que cobró (no con el precio de la pantalla), la caja se vacía y la tarea sigue en
      // «Tus trabajos». Si el servidor ya conocía ese pedido (`repetido`) esta petición no cobró nada: no hay «−N» que dibujar
      if (!r.repetido) avisarCobro(typeof r.creditos === 'number' ? r.creditos : creditos, principal.current?.getBoundingClientRect() ?? null);
      refrescarSaldo();
      guardarLista([]);
      intentoPrecio.current++;
      ponerPrecio({ fase: 'ninguna' });
      setMovido('');
      // si mientras salía el pedido la persona ya escribió otra cosa, eso no es lo que se mandó y no se borra
      setTexto(t => (limpiarInstruccion(t) === instruccion ? '' : t));
      if (typeof r.nombre === 'string' && r.nombre) setEnCurso({ copia: r.nombre, desde: Date.now() });
      alEditar?.();
      decir('ok', avisoDeExito(refs.length));
    } catch (e) {
      if (!respuestaDudosa(e)) pedido.current = null;
      if (e instanceof ErrorApi && e.sinSaldo) {
        // nada se cobró: «Te faltan ✦ N · Recargar» junto al botón
        setSinSaldoDelServidor({ faltan: faltanTras402(e.detalle, creditos, saldo), saldo });
        refrescarSaldo();
      } else {
        decir('mal', mensaje(e));
        if (e instanceof ErrorApi && e.estado === 409 && YA_HAY_TAREA.test(e.message)) {
          // el servidor dice que ya corre otra edición: la pantalla también lo sabe desde ahora (y «Mis creaciones» se pone al día)
          setEnCurso({ copia: null, desde: Date.now() });
          alEditar?.();
        } else if (deLaPuerta(e)) {
          // la puerta de enlace se rindió sin decir si el pedido llegó: «Mis creaciones» se relee ya, y si el servidor sí lo lanzó la
          // tarjeta «Editando…» sale sola en vez de que la persona lo descubra al volver a pulsar «Iniciar» y recibir un 409
          alEditar?.();
        }
        // 413/422/404: una regla del servidor que la caja no sabía (o que cambió): se vuelve a pedir el precio, que trae su aviso
        if (e instanceof ErrorApi && [404, 413, 422].includes(e.estado)) void pedirPrecio();
        // el 502 y el 503 son «no se pudo lanzar» y «no hay lugar»: el servidor ya devolvió los créditos. Sin respuesta (se cayó la red
        // con el pedido en el aire), un 409 (la edición ya existe: quizá la de ese pedido perdido) o cualquier 5xx: el servidor pudo
        // haber cobrado, así que la píldora se pone al día en vez de quedarse con un saldo viejo
        if (e instanceof ErrorApi && (e.estado === 0 || e.estado === 409 || e.estado >= 500)) refrescarSaldo();
      }
    } finally {
      candado.current = false;
      setLanzando(false);
    }
  }

  /** «Iniciar» en Shorts: no cobra ni pide nada, navega. Con un video subido va a su proyecto; si no, con la liga puesta. */
  function iniciarShorts() {
    if (video?.proyecto) {
      limpiarError();
      ir(destinoShorts({ proyecto: video.proyecto }));
      return;
    }
    const limpia = liga.trim();
    if (!limpia) {
      decir('mal', AVISO_SIN_FUENTE);
      return;
    }
    // una liga que no es de YouTube se corrige en el campo, sin ir a ningún lado ni gastar nada
    if (!esLigaDeYoutube(limpia)) {
      limpiarError();
      setErrorLiga(LIGA_INVALIDA);
      campoLiga.current?.focus();
      return;
    }
    limpiarError();
    ir(destinoShorts({ liga: limpia }));
  }

  function tocarIniciar() {
    if (lanzando) return;
    // el precio que aún viene en camino cuenta como trabajo en curso (como en E1): «Iniciar» no empieza otra cosa
    if (ocupado || (modo === 'editar' && boton.tipo === 'calculando')) {
      decir('mal', AVISO_OCUPADO);
      return;
    }
    if (modo === 'shorts') {
      iniciarShorts();
      return;
    }
    switch (boton.tipo) {
      case 'sin_video':
        decir('mal', AVISO_SIN_VIDEO);
        break;
      case 'sin_precio':
        limpiarError();
        void pedirPrecio();
        break;
      case 'fuera':
        // sin aviso: el motivo ya está escrito debajo del botón (es el del servidor); lo que se puede hacer es cambiar los videos
        limpiarError();
        mas.current?.focus();
        break;
      case 'sin_texto':
        limpiarError();
        enfocarTexto();
        break;
      case 'listo':
        void lanzar(boton.creditos);
        break;
      default:
        break; // subiendo y sin saldo ya se explican solos
    }
  }

  return [
    {
      modo,
      liga,
      errorLiga,
      texto,
      hayTexto,
      videos,
      video,
      cotizacion,
      boton,
      botonShorts,
      ocupado,
      lanzando,
      saldo,
      movido,
      faltan,
      escribir,
      escribirLiga,
      elegirModo,
      recibir,
      agregarElegidos,
      quitar,
      mover,
      tocarMas,
      puedeAgregar,
      abrirSelector,
      tocarIniciar,
    },
    { area, liga: campoLiga, mas, archivos, principal },
  ];
}

/** «Se perdió la conexión con “dos.mp4” a los 41 %. No se cobró nada. Vuelve a subirlo con el «+».» (nada se había subido aún: «…al empezar a subir»). */
function textoDeRedCortada(pct: number, nombre: string): string {
  const donde = pct > 0 ? `a los ${pct} %` : 'al empezar a subir';
  return `Se perdió la conexión con “${nombre}” ${donde}. No se cobró nada. Vuelve a subirlo con el «+».`;
}
