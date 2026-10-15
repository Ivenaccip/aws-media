// El estado de la caja de «Edición» (E1): lo que la persona escribió, el video que subió, su
// precio y la corrida que lanzó. Vive en un hook que llama Caja —no en CajaEdicion— a
// propósito: cambiar de familia (Imagen, Video, Edición) desmonta la caja de Edición, y ni
// el texto, ni el video, ni una subida a medias se pueden perder por eso (la subida sigue y
// al volver ya está lista).
//
// Orden de las cosas, y de qué es cada una:
//   1. subir: nucleo/subida (firmar, PUT con progreso, confirmar). El nombre del proyecto sale
//      del archivo; si ya es un proyecto TUYO con video (no mezclar con su transcripción) o si otra
//      cuenta lo usa (409), se estrena un nombre alterno (el 409, con UN reintento).
//   2. precio: GET /api/editar/<p>/costo. El servidor mide el video y decide; si manda un
//      `aviso` (fuera de 1–90 min…) se enseña tal cual y no se deja editar.
//   3. lanzar: POST /api/editar/<p>/sugerir con SOLO la instrucción. El servidor cobra antes
//      de lanzar y devuelve los créditos si no pudo: aquí nunca viaja un número de créditos.
//   4. sondeo: tras lanzar, y solo entonces (nunca al montar), se pregunta cada 5 s si la
//      corrida sigue. Mientras siga, o mientras suba un video, no se empieza otra cosa.
//      El servidor aún no tiene un candado por cuenta: este aviso es de la pantalla.
//
// El chip «Editar ▾» tiene dos modos y el modo también vive aquí (por lo mismo: cambiar de familia o abrir el mapa no lo
// pierde). «De videos a Shorts» usa la misma subida (progreso, cancelar, tarjeta del video) pero NO pide el precio de
// Edición ni cobra nada: «Iniciar» lleva a /estudio/shorts/ con la liga o el proyecto, y esa pantalla es la que muestra cada
// precio y cobra con su propio botón.
//
// Por qué no es un <BotonCobro>: ese se apaga con `disabled` (no se enfoca ni explica) y aquí el apagado tiene que seguir
// enfocable (sin texto lleva el foco al campo; fuera de rango, al «+»). Las reglas de dinero que BotonCobro impone viven
// aquí, cada una con su prueba: el candado se cierra antes del primer await (doble clic y Enter repetido = UNA petición),
// sin saldo conocido no se pide nada, y el «−N» solo vuela cuando el servidor aceptó, con lo que el servidor cobró.
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
  destinoShorts,
  estadoDeShorts,
  estadoDelBoton,
  faltanTras402,
  limpiarInstruccion,
  nombreDeProyecto,
  type EstadoBoton,
  type EstadoBotonShorts,
  type FaseVideo,
  type IdModo,
} from './edicion';
import {
  DESCRIPCION_VIDEOS,
  lanzarEdicion,
  nombreYaTieneVideo,
  pedirCostoEdicion,
  pedirEstadoEdicion,
  rechazoVideo,
  soloVideos,
  type CostoEdicion,
} from './envio';

/** Cada cuánto se pregunta si la corrida sigue, una vez lanzada. */
const SONDEO_MS = 5000;
/** El servidor da por caducada una corrida a las 2 h (server/editar_api.py): la pantalla también deja de esperarla. */
const CORRIDA_MAX_MS = 2 * 60 * 60 * 1000;

export interface VideoDeEdicion {
  archivo: File;
  /** El nombre del proyecto en el servidor: el del archivo, o su variante si otra cuenta ya lo tenía. */
  proyecto: string;
  fase: FaseVideo;
  /** 0–100, la subida a la nube. */
  pct: number;
  costo: CostoEdicion | null;
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
  video: VideoDeEdicion | null;
  boton: EstadoBoton;
  /** Lo que dice el botón principal cuando el modo es Shorts. */
  botonShorts: EstadoBotonShorts;
  /** Una subida, un precio por calcular o una corrida en curso: «+» e «Iniciar» avisan en vez de empezar otra. */
  ocupado: boolean;
  /** Entre el clic y la respuesta del servidor. */
  lanzando: boolean;
  saldo: number | null;
  /** Lo que le falta de saldo (0 = nada), sabido por el saldo o por el 402 del servidor. */
  faltan: number;
  escribir(texto: string): void;
  escribirLiga(liga: string): void;
  /** Cambia de modo desde el chip. Elegir el de ahora no hace nada. */
  elegirModo(id: IdModo): void;
  /** Los archivos que llegan del selector o de soltarlos en la caja. */
  recibir(archivos: File[]): void;
  quitar(): void;
  tocarMas(): void;
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

/** `ir` es el de Caja: a dónde navegar (location.assign en la página, un espía en los tests). Solo lo usa «Iniciar» en Shorts. */
export function useEdicion(
  { decir: decirAfuera, limpiarError: limpiarAfuera, olvidarAviso }: Mensajes,
  ir: (url: string) => void,
): [ManejoEdicion, RefsEdicion] {
  // lo último que se dijo fue «Ya hay un trabajo en curso…»: cuando ese trabajo termina, el aviso se quita solo (el lienzo lo
  // hace: un aviso que dice «espera» no puede quedarse cuando ya no hay nada que esperar). Cualquier otra cosa que se diga o
  // se quite lo suelta: lo que reemplazó a ese aviso no es de este hook para quitarlo
  const avisoOcupado = useRef(false);
  const decir: Mensajes['decir'] = (tipo, texto) => {
    avisoOcupado.current = texto === AVISO_OCUPADO;
    decirAfuera(tipo, texto);
  };
  const limpiarError = () => {
    avisoOcupado.current = false;
    limpiarAfuera();
  };
  const [modo, setModo] = useState<IdModo>('editar');
  // el modo de AHORA, para lo que se pregunta tras un await (la subida: ¿hay que pedir el precio de Edición?): la
  // closure de `subir` es la del render en que empezó, y para entonces la persona pudo cambiar el chip
  const modoVigente = useRef<IdModo>('editar');
  const [liga, setLiga] = useState('');
  const [errorLiga, setErrorLiga] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [video, setVideo] = useState<VideoDeEdicion | null>(null);
  const [lanzando, setLanzando] = useState(false);
  // la corrida lanzada que sigue en pie: se le pregunta al servidor hasta que termine
  const [enCurso, setEnCurso] = useState<{ proyecto: string; desde: number } | null>(null);
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
  const intento = useRef(0); // quitar el video (o poner otro) invalida lo que la subida anterior aún espera
  const cancelarSubida = useRef<(() => void) | null>(null);

  const subiendo = video?.fase === 'subiendo';
  const ocupado = subiendo || video?.fase === 'calculando' || enCurso !== null || lanzando;
  // «hay texto» es lo que le llegaría a la IA, no lo que se ve: un campo con solo caracteres invisibles está vacío
  const hayTexto = limpiarInstruccion(texto) !== '';
  const boton = estadoDelBoton({ video, hayTexto, saldo });
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

  // cerrar la pestaña con la subida a medias la pierde: el navegador avisa
  useEffect(() => {
    if (!subiendo) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [subiendo]);

  // la caja se desmontó: una subida a medias no sigue sola ni confirma un proyecto que ya nadie va a ver, y lo que
  // el precio o el permiso aún esperaban deja de valer (cambiar de familia NO desmonta este hook: vive en Caja)
  useEffect(() => {
    const cancelar = cancelarSubida;
    const invalidar = intento;
    return () => {
      invalidar.current++;
      cancelar.current?.();
      cancelar.current = null;
    };
  }, []);

  // la corrida lanzada: se pregunta cada 5 s (solo desde que se lanzó) hasta que termine. Al terminar el saldo se pone al
  // día: si no hubo nada que quitar, el servidor devolvió los créditos
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
      void pedirEstadoEdicion(enCurso.proyecto).then(
        st => {
          if (vigente && st.editar?.estado !== 'corriendo') terminar();
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

  function elegirModo(id: IdModo) {
    if (id === modo) return;
    modoVigente.current = id;
    setModo(id);
    // lo que decía el otro modo (un aviso, el error de la liga) no es de este
    setErrorLiga(null);
    limpiarError();
    olvidarAviso();
    // un video que subió estando en Shorts no trae el precio de Edición: se pide al pasar a Editar, como si hubiera subido allí
    if (id === 'editar' && video?.fase === 'listo' && !video.costo) void calcularPrecio(video.proyecto, intento.current);
  }

  /** Pide el precio del video subido. Si no llega, el video se queda e «Iniciar» lo vuelve a pedir. */
  async function calcularPrecio(proyecto: string, mio: number) {
    if (intento.current === mio) setVideo(v => v && { ...v, fase: 'calculando' });
    try {
      const costo = await pedirCostoEdicion(proyecto);
      if (intento.current !== mio) return;
      setVideo(v => v && { ...v, fase: 'listo', costo });
    } catch (e) {
      if (intento.current !== mio) return;
      setVideo(v => v && { ...v, fase: 'sin_precio' });
      decir('mal', mensaje(e));
    }
  }

  async function subir(archivo: File) {
    const mio = ++intento.current;
    let proyecto = nombreDeProyecto(archivo.name);
    setSinSaldoDelServidor(null);
    setVideo({ archivo, proyecto, fase: 'subiendo', pct: 0, costo: null });
    try {
      const cfg = await cargarConfig();
      if (intento.current !== mio) return;
      if (!cfg.activo) throw new Error('Subir videos no está disponible en esta instalación.');
      // «video.mp4», «final.mp4»… se repiten: si ese nombre ya es un proyecto tuyo con video, reusarlo mezclaría el nuevo con
      // la transcripción y los cortes del viejo. Se estrena un nombre (el 409 de abajo sigue cubriendo el de otra cuenta)
      const yaEra = await nombreYaTieneVideo(proyecto);
      if (intento.current !== mio) return;
      if (yaEra) {
        proyecto = nombreAlterno(proyecto);
        setVideo(v => v && { ...v, proyecto });
      }
      let firma;
      try {
        firma = await firmar(proyecto, archivo);
      } catch (e) {
        if (!(e instanceof ErrorApi && e.estado === 409)) throw e;
        // el nombre es único entre TODAS las cuentas: nada se subió todavía, así que se prueba con una variante
        proyecto = nombreAlterno(proyecto);
        if (intento.current === mio) setVideo(v => v && { ...v, proyecto });
        firma = await firmar(proyecto, archivo);
      }
      if (intento.current !== mio) return; // la quitaron mientras se pedía el permiso
      const envio = subirConProgreso(firma, archivo, a => {
        if (intento.current === mio) setVideo(v => v && { ...v, pct: a.pct });
      });
      cancelarSubida.current = envio.cancelar;
      try {
        await envio.hecho;
      } finally {
        cancelarSubida.current = null;
      }
      if (intento.current !== mio) return;
      await confirmar(proyecto, firma.key);
      if (intento.current !== mio) return;
    } catch (e) {
      // quitar el video cancela el PUT y eso rechaza la promesa: no es un error de nadie
      if (intento.current !== mio) return;
      setVideo(null);
      decir('mal', mensaje(e));
      return;
    }
    if (modoVigente.current === 'shorts') {
      // Shorts no pide el precio de Edición: el del análisis y el de cada short los muestra su pantalla, antes de cobrar
      setVideo(v => v && { ...v, fase: 'listo' });
      return;
    }
    await calcularPrecio(proyecto, mio);
  }

  function recibir(llegados: File[]) {
    if (ocupado) {
      decir('mal', AVISO_OCUPADO);
      return;
    }
    const videos = soloVideos(llegados);
    const primero = videos[0];
    if (!primero) {
      if (llegados.length) decir('mal', `Eso no es un video. Sirven: ${DESCRIPCION_VIDEOS}.`);
      return;
    }
    const motivo = rechazoVideo(primero);
    if (motivo) {
      decir('mal', motivo);
      return;
    }
    limpiarError();
    // en E1 se edita un video a la vez: si llegan varios se toma el primero y se dice
    if (videos.length > 1) {
      decir('ok', `Por ahora ${modoVigente.current === 'shorts' ? 'se saca de' : 'se edita'} un video a la vez: usamos «${primero.name}».`);
    }
    void subir(primero);
  }

  function quitar() {
    if (candado.current) return; // ya salió el pedido: el video no se quita a medias
    intento.current++; // lo que la subida o el precio aún esperaban ya no vale
    cancelarSubida.current?.();
    cancelarSubida.current = null;
    setVideo(null);
    setSinSaldoDelServidor(null);
    limpiarError();
    mas.current?.focus(); // el ✕ se va con el video: el foco no se queda en el aire
  }

  function tocarMas() {
    if (ocupado) {
      decir('mal', AVISO_OCUPADO);
      return;
    }
    limpiarError();
    archivos.current?.click();
  }

  async function lanzar(v: VideoDeEdicion, creditos: number) {
    if (candado.current) return;
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
    try {
      const veredicto = await moderar(instruccion); // M13: se modera ANTES de lo que cobra
      if (!veredicto.permitido) {
        decir('mal', veredicto.mensaje);
        return;
      }
      const r = await lanzarEdicion(v.proyecto, instruccion);
      // el servidor aceptó y cobró: el «−N» vuela, la caja se vacía y la tarea sigue en «Tus trabajos»
      avisarCobro(r.creditos || creditos, principal.current?.getBoundingClientRect() ?? null);
      refrescarSaldo();
      setVideo(null);
      // si mientras salía el pedido la persona ya escribió otra cosa, eso no es lo que se mandó y no se borra
      setTexto(t => (limpiarInstruccion(t) === instruccion ? '' : t));
      setEnCurso({ proyecto: v.proyecto, desde: Date.now() });
      decir('ok', 'Ya estamos editando tu video. Sigue el avance en «Tus trabajos».');
    } catch (e) {
      if (e instanceof ErrorApi && e.sinSaldo) {
        // nada se cobró: «Te faltan ✦ N · Recargar» junto al botón
        setSinSaldoDelServidor({ faltan: faltanTras402(e.detalle, creditos, saldo), saldo });
        refrescarSaldo();
      } else {
        decir('mal', mensaje(e));
        if (e instanceof ErrorApi && e.estado === 409) {
          // el servidor dice que ya corre: la pantalla también lo sabe desde ahora
          setEnCurso({ proyecto: v.proyecto, desde: Date.now() });
        }
        // el 502 es «no se pudo lanzar»: el servidor ya devolvió los créditos. Sin respuesta (se cayó la red con el pedido
        // en el aire), un 409 (la corrida ya existe: quizá la de ese pedido perdido) o cualquier 5xx: el servidor pudo
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
    if (video) {
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
    if (ocupado) {
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
        if (video) {
          limpiarError();
          void calcularPrecio(video.proyecto, intento.current);
        }
        break;
      case 'fuera':
        // sin aviso: el motivo ya está escrito debajo del botón; lo que se puede hacer es cambiar el video
        limpiarError();
        mas.current?.focus();
        break;
      case 'sin_texto':
        limpiarError();
        enfocarTexto();
        break;
      case 'listo':
        if (video) void lanzar(video, boton.creditos);
        break;
      default:
        break; // subiendo, calculando y sin saldo ya se explican solos
    }
  }

  return [
    {
      modo,
      liga,
      errorLiga,
      texto,
      hayTexto,
      video,
      boton,
      botonShorts,
      ocupado,
      lanzando,
      saldo,
      faltan,
      escribir,
      escribirLiga,
      elegirModo,
      recibir,
      quitar,
      tocarMas,
      tocarIniciar,
    },
    { area, liga: campoLiga, mas, archivos, principal },
  ];
}
