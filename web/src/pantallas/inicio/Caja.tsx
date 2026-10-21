// «¿Qué vamos a crear hoy?» (M25 · B, R4 + R4b): el riel de la izquierda dice QUÉ
// te llevas (Imagen o Video), el chip de tarea CUÁL de esas cosas, y el chip de
// modelo CON QUÉ IA. El precio se ve dentro del menú de modelo, junto al «Crear».
// El clip suma ahí mismo su duración (4, 6 u 8 s, 8 por defecto): la caja la
// guarda y la manda con el pedido; el precio lo calcula el servidor.
//
// Lo que elige modelo (un video corto, crear o editar una imagen) se pide AQUÍ:
// la caja sube las imágenes de referencia (el «+», arrastrándolas o pegándolas con
// Ctrl+V), pide con el modelo elegido y se queda en el inicio; lo que se genera
// aparece en «Mis creaciones». Lo demás (cuentos, historias) sigue llevando a su
// pantalla con el texto ya puesto.
//
// Cuentos e historias también tienen «+» (dueño, 14-oct-2026), para la foto del personaje. Esa pantalla (Crear) la
// recibe de otra página, y un archivo no cabe en la URL: «Crear» la deja en el navegador (nucleo/traspaso) y navega
// con `refs=<token>`; Crear la recoge y la pone en su cuadro. Navegar no cobra nada, así que si la foto no se pudo
// dejar se navega igual (`refs=perdida`) y Crear lo dice. Aquí no hay red nueva.
//
// «Crear una imagen» también tiene «+»: con una imagen la tarea es editarla, así
// que la caja pasa sola a «Editar una imagen».
//
// La tercera familia, Edición (E1 y E2), es otra caja: uno o varios videos —subidos o elegidos de Mis creaciones— + lo que quieres que
// les haga la IA (CajaEdicion). Su estado vive en useEdicion, que se llama AQUÍ y no en
// CajaEdicion: cambiar de familia no pierde el texto, los videos ni una subida a medias.
//
// Dos piezas se comparten con Edición (dueño, 14-oct-2026): el cuadro bien definido donde se escribe (ui/CuadroDeTexto)
// y el chip de tarea con su lista (SelectorOpcion: «Un video corto ▾», «Crear una imagen ▾», «Editar ▾»). La caja solo le
// pide al chip que cierre su lista cuando cambia de familia.
//
// Lo que la caja dice —que ya está creando, o por qué no pudo— sale en el cuadro de
// abajo a la derecha (nucleo/avisos); donde esa página no lo trae, junto a la caja.
//
// Desde el 15-oct-2026 (dueño, «Mapa con Irremplazables») la caja va DENTRO de la tarjeta del inicio (Recorrido.tsx): no pinta su
// propia tarjeta (sin fondo, borde, relleno ni margen). El inicio la esconde con `hidden` mientras se ve el mapa o una lista (al abrir,
// se ve el mapa: la caja arranca escondida), SIN desmontarla, y le avisa con `enVista` para que lo que corre solo para ser visto
// (la pista rotatoria de Edición) no siga corriendo en lo escondido.
import {
  forwardRef,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';

import { ErrorApi } from '../../nucleo/api';
import { avisar, quitarAviso } from '../../nucleo/avisos';
import { ESTRELLA } from '../../nucleo/estrella';
import { moderar } from '../../nucleo/moderar';
import { guardarPreferencia, leerPreferencia } from '../../nucleo/preferencia';
import { clip as tarifaClip } from '../../nucleo/tarifas';
import { guardarArchivos, TRASPASO_PERDIDO } from '../../nucleo/traspaso';
import { refrescarSaldo } from '../../marca/useSaldo';
import { Aviso } from '../../ui/Aviso';
import { Boton } from '../../ui/Boton';
import { CuadroDeTexto } from '../../ui/CuadroDeTexto';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import {
  descripcionDeArchivos,
  esLanzada,
  imagenesPegadas,
  MAX_FOTOS_CLIP,
  pedirClip,
  pedirEdicion,
  pedirImagen,
  rechazo,
  soloImagenes,
  tipoDe,
  traerImagen,
} from './envio';
import { Biblioteca } from './Biblioteca';
import { CajaEdicion } from './CajaEdicion';
import { HojaVideos } from './HojaVideos';
import type { Pendiente } from './Galeria';
import type { LlegadaDeTexto } from './estadoRecorrido';
import { destinoDe, OPCIONES, type Familia, type Imagen, type Opcion } from './logica';
import { MenuModelo, type Eleccion } from './MenuModelo';
import {
  admite,
  ahorroSinSonido,
  cambioPorDuracion,
  CATALOGO,
  detalleDe,
  DURACION_PREDETERMINADA,
  duracionesDe,
  duracionesOfrecidas,
  duracionVigente,
  grupos as gruposDe,
  llavePrecio,
  modeloPara,
  ofrecidosDe,
  precioDe,
  PRECIOS,
  puedeApagar,
  textoSonido,
  type Tarea,
} from './modelos';
import { SelectorOpcion, type MandoSelector } from './SelectorOpcion';
import { useEdicion } from './useEdicion';

export interface MandoCaja {
  /** Pone la familia y la opción, enfoca el texto y sube la página. */
  elegir(familia: Familia, id?: string): void;
  /** Pone una imagen tuya como referencia de un video corto (el «Usar como referencia» del visor). */
  referencia(archivo: File): void;
}

export interface PropsCaja {
  /** A dónde ir. En la página es location.assign; en los tests, un espía. */
  ir: (url: string) => void;
  /** Se pidió algo con la caja: aparece «generando» en la galería. */
  alPedir?: (p: Pendiente) => void;
  /** Ya contestó el servidor (bien o mal): la tarjeta de «generando» se quita y la lista se relee.
   *  `esperarLista`: el servidor dejó una imagen en marcha (`lanzado`: ya cobró y la hace), y solo la lista de
   *  imágenes la trae; la tarjeta se queda hasta que esa lectura salga bien (o pasen 2 minutos). Una imagen que
   *  contestó hecha ({nombre, url}) no la necesita. */
  alTerminar?: (clave: string, esperarLista: boolean) => void;
  /** Las imágenes de «Mis creaciones»: con ellas, el «+» ofrece también «Elegir de Mis creaciones». Sin ninguna, el
   *  «+» abre el selector de archivos, como siempre. */
  imagenes?: Imagen[] | undefined;
  /** El `h2` «¿Qué vamos a crear hoy?»: el recorrido le lleva el foco al volver a la caja (lleva `tabIndex={-1}`). */
  tituloRef?: Ref<HTMLHeadingElement>;
  /** La tarjeta del inicio la tiene a la vista. Falso = sigue montada (con lo escrito, el video, la subida) pero escondida con
   *  `hidden` mientras se ve el mapa, las opciones o una lista: lo que corre solo para ser visto (la pista de Edición) se para. */
  enVista?: boolean;
  /** El servidor aceptó una edición (E2): «Mis creaciones» ya tiene la tarjeta «Editando…» de su copia, y el inicio relee sus listas. */
  alEditar?: () => void;
  /** Se llegó con un texto ya escrito (`?prompt=` o `?brief=`, de «Llevar a la caja» en la Biblioteca de prompts): la caja arranca en esa
   *  pestaña con el texto puesto, lo dice y lleva el foco a su cuadro. Solo se lee al montarse: no crea ni cobra nada. */
  llegada?: LlegadaDeTexto | null;
  /** La pestaña con la que arranca cuando NO se llegó con un texto: la de la página de esa herramienta (…/distrito/edicion/). Sin ella, Video.
   *  Un texto que llega (`llegada`) manda sobre ella: `…/video/?prompt=x` abre Imagen. Solo se lee al montarse. */
  familiaInicial?: Familia | undefined;
  /** Se llama con la pestaña de ahora al montarse y cada vez que cambia (el riel, `elegir`, `referencia`): la página de una herramienta
   *  usa esto para que su dirección y su título sigan a la pestaña. En el montaje también, porque un texto que llega puede abrir otra
   *  pestaña que la de la dirección. Sin ella, la caja no avisa a nadie. */
  alCambiarFamilia?: ((familia: Familia) => void) | undefined;
}

const SIN_IMAGENES: Imagen[] = [];

// Lo que la caja dice (que ya está creando, o por qué no pudo) va al cuadro de abajo a la derecha, el mismo de
// «Tus trabajos» (static/trabajos.js). Comparten clave: lo nuevo reemplaza lo anterior de la caja.
const CLAVE_AVISO = 'caja';

/** ¿Lo que se arrastra trae archivos? Un texto seleccionado que se mueve dentro del cuadro no los trae. */
const traeArchivos = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/** Lo que va entre [corchetes] en un prompt es un hueco por llenar (así vienen los de la Biblioteca). */
const HUECO = /\[[^\]\n]+\]/;
// «Te trajimos el prompt…» (contrato de Ajustes 3): el primero es el texto de siempre; el segundo, para un prompt que no trae huecos
const AVISO_CON_HUECOS = 'Te trajimos el prompt. Cambia lo que va entre [corchetes] y pulsa Crear.';
const AVISO_SIN_HUECOS = 'Te trajimos el prompt. Revísalo y pulsa Crear.';

/** La clave del navegador donde se recuerda si el clip va con sonido o sin él. */
const CLAVE_SONIDO = 'caja.sonido';

// el riel: tres botones con icono. En celular es una fila sobre el texto.
const RIEL = [
  { familia: 'imagenes', rotulo: 'Imagen', icono: 'imagen' },
  { familia: 'videos', rotulo: 'Video', icono: 'video' },
  { familia: 'edicion', rotulo: 'Edición', icono: 'cortar' },
] as const;

export const Caja = forwardRef<MandoCaja, PropsCaja>(function Caja(
  { ir, alPedir, alTerminar, imagenes = SIN_IMAGENES, tituloRef, enVista = true, alEditar, llegada = null, familiaInicial, alCambiarFamilia },
  ref,
) {
  // Arranca en el clip a propósito: es lo que ya se usaba, así que es lo que
  // menos sorprende a quien no abra el menú de modelo (M25 · B). Con un texto que llega de la Biblioteca de prompts, en la pestaña de ese
  // texto (Imagen: «Crear una imagen»; Video: «Un video corto») y con él puesto; y sin texto, en la de la página (`familiaInicial`).
  // Edición no está en OPCIONES (su chip usa MODOS_EDICION): ahí la opción de Imagen/Video que se conserva es la del clip.
  const inicial: Familia = llegada?.familia ?? familiaInicial ?? 'videos';
  const [familia, setFamilia] = useState<Familia>(inicial);
  const [opcion, setOpcion] = useState<Opcion>(OPCIONES[inicial === 'edicion' ? 'videos' : inicial][0]!);
  // cada tarea recuerda su propio modelo
  const [elegidos, setElegidos] = useState<Partial<Record<Tarea, Eleccion>>>({});
  // la duración que se pidió para el clip; la que rige sale de abajo (puede ser otra si esa ya no se ofrece)
  const [pedida, setPedida] = useState(DURACION_PREDETERMINADA);
  // lo que la persona prefiere para el sonido del clip, y el navegador recuerda («con sonido» si nunca eligió). Lo que se
  // pide sale de abajo: solo vale en los modelos que se pueden apagar, y en los demás el clip siempre lleva sonido
  const [prefSonido, setPrefSonido] = useState(() => leerPreferencia(CLAVE_SONIDO) !== 'sin');
  const [texto, setTexto] = useState(llegada?.texto ?? '');
  // «Te trajimos el prompt…»: se queda mientras el texto sea el que llegó; se va al crear, al cambiar de pestaña o al vaciar el cuadro
  const [trajeron, setTrajeron] = useState(llegada !== null);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  // las imágenes de referencia: se suben al pedir, no al agregarlas
  const [refs, setRefs] = useState<File[]>([]);
  const [aviso, setAviso] = useState('');
  const [arrastrando, setArrastrando] = useState(false);
  const archivos = useRef<HTMLInputElement>(null);
  // el menú del «+» (con imágenes en Mis creaciones) y la hoja «Elegir de Mis creaciones»
  const [menuMas, setMenuMas] = useState(false);
  const [biblioteca, setBiblioteca] = useState(false);
  // la hoja «Agregar videos» del «+» de Edición (E2): vive aquí, fuera de la sección que recibe lo que se arrastra, igual que la de imágenes
  const [hojaVideos, setHojaVideos] = useState(false);
  const mas = useRef<HTMLDivElement>(null);
  const botonMas = useRef<HTMLButtonElement>(null);
  const pedidos = useRef(0);
  const seccion = useRef<HTMLElement>(null);
  // el cuadro de abajo a la derecha trae un error de la caja (un error se queda hasta cerrarlo)
  const errorEnElCuadro = useRef(false);
  const area = useRef<HTMLTextAreaElement>(null);
  // el chip de la tarea (SelectorOpcion): la caja solo le pide cerrar la lista cuando cambia de familia
  const selector = useRef<MandoSelector>(null);
  const idTitulo = useId();
  const idLlegada = useId();
  // llegar con un texto (de la Biblioteca de prompts) es una acción deliberada: el foco va al cuadro, con el cursor listo para cambiar lo
  // que va entre [corchetes]. Solo al montarse y solo si se llegó así; sin texto, la caja no toca el foco de la página
  const alLlegar = useEffectEvent(() => {
    if (llegada) area.current?.focus({ preventScroll: true });
  });
  useEffect(() => {
    alLlegar();
  }, []);
  // La pestaña de ahora se avisa al montarse y en cada cambio, venga de donde venga (el riel, `elegir` o `referencia`: los tres `setFamilia`).
  // `alCambiarFamilia` se lee como evento de efecto: que quien la pasa la cree de nuevo en cada render no vuelve a avisar.
  const avisarFamilia = useEffectEvent((f: Familia) => alCambiarFamilia?.(f));
  useEffect(() => {
    avisarFamilia(familia);
  }, [familia]);
  // el estado de Edición (texto, video, subida, precio, corrida) vive aquí, no en CajaEdicion: ver la cabecera
  const [edicion, refsEdicion] = useEdicion({ decir, limpiarError, olvidarAviso: () => setAviso('') }, ir, alEditar);
  const enEdicion = familia === 'edicion';
  // elegir('edicion') desde fuera: el campo de esa caja se monta en el render que sigue, así que el foco se le da ahí
  const enfocarAlMontar = useRef(false);
  useEffect(() => {
    if (!enEdicion || !enfocarAlMontar.current) return;
    enfocarAlMontar.current = false;
    // el campo de Edición es el del texto o, en el modo Shorts, el de la liga
    (refsEdicion.area.current ?? refsEdicion.liga.current)?.focus();
  }, [enEdicion, refsEdicion.area, refsEdicion.liga]);

  useImperativeHandle(ref, () => ({
    elegir(f, id) {
      setFamilia(f);
      setTrajeron(false);
      if (f === 'edicion') {
        const campo = refsEdicion.area.current ?? refsEdicion.liga.current;
        if (campo) campo.focus();
        else enfocarAlMontar.current = true;
      } else {
        setOpcion(OPCIONES[f].find(o => o.id === id) ?? OPCIONES[f][0]!);
        selector.current?.cerrar();
        area.current?.focus();
      }
      window.scrollTo?.({ top: 0, behavior: 'smooth' });
    },
    referencia(archivo) {
      setFamilia('videos');
      setOpcion(OPCIONES.videos[0]!);
      selector.current?.cerrar();
      setRefs(r => [...r, archivo].slice(-MAX_FOTOS_CLIP));
      area.current?.focus();
      window.scrollTo?.({ top: 0, behavior: 'smooth' });
    },
  }));

  // «Generando…» dura hasta que la página navega. Si la persona regresa con «atrás»,
  // el navegador restaura ESTA página desde su caché con el estado que tenía:
  // sin esto, el botón se quedaría trabajando para siempre.
  useEffect(() => {
    const volvio = (e: Event) => {
      if ((e as PageTransitionEvent).persisted) setEnviando(false);
    };
    window.addEventListener('pageshow', volvio);
    return () => window.removeEventListener('pageshow', volvio);
  }, []);

  // el menú del «+»: un clic fuera o Esc lo cierra (con Esc el foco vuelve al «+», si estaba en el menú); al abrir, el
  // foco va a su primera opción
  useEffect(() => {
    if (!menuMas) return;
    const fuera = (e: MouseEvent) => {
      if (!mas.current?.contains(e.target as Node)) setMenuMas(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuMas(false);
      const foco = document.activeElement;
      if (!foco || foco === document.body || mas.current?.contains(foco)) botonMas.current?.focus();
    };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', esc);
    mas.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', esc);
    };
  }, [menuMas]);

  // las opciones del menú son las de la familia de la opción de ahora (Imagen o Video usan OPCIONES; Edición pinta su propio
  // chip con MODOS_EDICION desde CajaEdicion, y la opción de Imagen/Video se conserva)
  const opciones = OPCIONES[OPCIONES.imagenes.some(o => o.id === opcion.id) ? 'imagenes' : 'videos'];

  // el modelo de la tarea: el que eligió, o el predeterminado, o el primero que
  // se ofrezca (y que admita la duración, en el clip). Si no se ofrece ninguno,
  // la tarea no muestra chip de modelo.
  const tarea = opcion.modelos;
  const ofrecidos = useMemo(() => (tarea ? ofrecidosDe(tarea) : []), [tarea]);
  const duraciones = tarea ? duracionesOfrecidas(tarea, ofrecidos) : [];
  const segundos = duracionVigente(duraciones, pedida);
  // la lista de grupos es barata (a lo más nueve modelos) y solo la lee el menú: se recalcula en cada render, sin useMemo
  const grupos = tarea ? gruposDe(tarea, CATALOGO, PRECIOS, segundos, prefSonido) : [];
  const guardado = tarea ? elegidos[tarea] : undefined;
  const modelo = tarea ? modeloPara(tarea, ofrecidos, guardado?.id, segundos) : undefined;
  const calidad = modelo?.calidades ? (modelo.calidades.find(c => c.id === guardado?.calidad) ?? modelo.calidades[0]) : undefined;
  const modeloId = modelo ? llavePrecio(modelo.id, calidad?.id) : undefined;
  // el sonido del clip: la preferencia solo cuenta si el modelo se puede apagar a esta duración; si no, lleva sonido
  const sePuedeApagar = tarea === 'clip' && !!modelo && puedeApagar(modelo, segundos);
  const conSonido = !sePuedeApagar || prefSonido;

  function cambiarSonido(nuevo: boolean) {
    setPrefSonido(nuevo);
    guardarPreferencia(CLAVE_SONIDO, nuevo ? 'con' : 'sin');
  }

  /** Cambia la duración del clip. Si el modelo elegido no la ofrece, vuelve al predeterminado y lo dice. */
  function elegirDuracion(nueva: number): string | undefined {
    setPedida(nueva);
    const cambio = tarea && modelo ? cambioPorDuracion(tarea, ofrecidos, modelo, nueva) : null;
    if (!tarea || !cambio) return undefined;
    setElegidos(e => ({ ...e, [tarea]: { id: cambio.queda.id } }));
    return cambio.aviso;
  }

  // cuántas referencias admite la tarea de ahora; las que sobren se guardan, no se pierden
  const maxRefs = opcion.referencias ?? 0;
  const fotos = useMemo(() => refs.slice(0, maxRefs), [refs, maxRefs]);
  // «Crear una imagen» no parte de ninguna, pero admite agregar una: con ella la tarea es editarla, y la caja pasa
  // a «Editar una imagen» (que es la que sabe partir de una y trae solo los modelos que editan)
  const alAgregar = opcion.alAgregar ? opciones.find(o => o.id === opcion.alAgregar) : undefined;
  // en Edición no hay imágenes: ni «+» de imágenes, ni pegar, ni la hoja (el «+» de esa caja trae VIDEOS)
  const admiteImagenes = !enEdicion && (maxRefs > 0 || alAgregar !== undefined);
  // lo que se agrega rige por la tarea que va a quedar (con una imagen, «Crear una imagen» pasa a editar)
  const tareaDeImagenes = alAgregar ?? opcion;
  const topeDeImagenes = tareaDeImagenes.referencias ?? 0;
  const disponibles = topeDeImagenes === 1 ? 1 : Math.max(0, topeDeImagenes - fotos.length);
  const archivosDeLaTarea = tareaDeImagenes.id === 'clip' ? 'clip' : 'editar';
  // cómo llama la tarea a lo que se agrega (la foto del personaje, en cuentos e historias); sin esto, los de siempre
  const textosMas = tareaDeImagenes.textosMas;
  const hayBiblioteca = admiteImagenes && imagenes.length > 0;

  /** Lo que la caja dice: en el cuadro de abajo a la derecha y, si esa página no lo trae, aquí mismo. */
  function decir(tipo: 'ok' | 'mal', texto: string) {
    if (avisar(texto, { tipo, clave: CLAVE_AVISO })) {
      errorEnElCuadro.current = tipo === 'mal';
      setError('');
      setAviso('');
    } else if (tipo === 'mal') {
      setError(texto);
      setAviso('');
    } else {
      setAviso(texto);
      setError('');
    }
  }

  /** Quita del cuadro el error de la caja, si hay uno. Un aviso verde de «ya lo estamos creando» no es un error y se queda. */
  function quitarErrorDelCuadro() {
    if (!errorEnElCuadro.current) return;
    errorEnElCuadro.current = false;
    quitarAviso(CLAVE_AVISO);
  }

  /** Lo que estaba mal ya se corrigió (se agregó la imagen, se vuelve a pedir): se quita el error, esté junto a la caja
   *  o en el cuadro. */
  function limpiarError() {
    setError('');
    quitarErrorDelCuadro();
  }

  // NAV-05 del prototipo (el «aviso fantasma»): el cuadro de abajo a la derecha es de toda la página, no de la caja. Con la caja
  // escondida (el mapa, las tres opciones o una lista a la vista) su error no tiene formulario que lo explique y se quedaría flotando
  // sobre otro paso: se quita. No se guarda para volver a ponerlo; «Crear» o «Iniciar» lo repiten si sigue faltando algo
  const alEsconderse = useEffectEvent(quitarErrorDelCuadro);
  useEffect(() => {
    if (!enVista) alEsconderse();
  }, [enVista]);

  function agregar(nuevos: File[]) {
    // con una imagen en «Crear una imagen» la tarea que rige es la de editar: sus topes y sus extensiones
    const tarea = alAgregar ?? opcion;
    const tope = tarea.referencias ?? 0;
    if (!tope) return;
    setAviso('');
    // lo de antes ya no vale (faltaba la imagen, la anterior no servía…); lo que rechace este lote se dice después
    limpiarError();
    const buenos: File[] = [];
    for (const f of nuevos) {
      const motivo = rechazo(f, tarea.id === 'clip' ? 'clip' : 'editar');
      if (motivo) {
        decir('mal', motivo);
        continue;
      }
      // la caja acepta por extensión, pero Crear (y el motor) por tipo: una foto sin tipo (WebP sin registrar en el
      // sistema, un archivo de Drive…) se completa aquí, igual que el clip al subirla, para que no se pierda al llegar
      buenos.push(f.type ? f : new File([f], f.name, { type: tipoDe(f), lastModified: f.lastModified }));
    }
    if (!buenos.length) return;
    // con una sola referencia (editar) la nueva reemplaza a la de adelante —las demás, que el clip tenía, se guardan—;
    // con varias, se suman hasta el tope
    setRefs(r => (tope === 1 ? [buenos[0]!, ...r.slice(1)] : [...r, ...buenos].slice(0, tope)));
    if (tope > 1 && fotos.length + buenos.length > tope) decir('mal', `Como mucho ${tope} imágenes.`);
    if (alAgregar) pasarAEditar(alAgregar);
  }

  /** El «+»: con imágenes en Mis creaciones abre su menú; sin ellas, el selector de archivos de siempre. Quien lo abre
   *  ya corrige lo que falló: el error del cuadro de avisos se quita (en un celular chico lo tapaba, con sus toques). */
  function alPulsarMas() {
    if (hayBiblioteca) {
      if (!menuMas) limpiarError();
      setMenuMas(m => !m);
    } else archivos.current?.click();
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
      setMenuMas(false);
      botonMas.current?.focus(); // sin preventDefault: el Tab de ahora sigue desde el «+»
    }
  }

  function subirDeLaComputadora() {
    setMenuMas(false);
    archivos.current?.click();
  }

  function abrirBiblioteca() {
    setMenuMas(false);
    setBiblioteca(true);
  }

  /** Las elegidas en la hoja, traídas del servidor y agregadas como cualquier otra imagen. null: salió bien. Un texto:
   *  no se pudo traer alguna, y la hoja lo dice dentro de sí y se queda abierta con lo elegido (el cuadro de avisos
   *  queda tapado por el diálogo). Si la hoja se cierra mientras trae, `signal` se aborta y no se agrega nada. */
  async function traerDeLaBiblioteca(elegidas: Imagen[], signal: AbortSignal): Promise<string | null> {
    let traidas: File[];
    try {
      traidas = await Promise.all(elegidas.map(im => traerImagen(im, signal)));
    } catch {
      return signal.aborted ? null : 'No pudimos traer esa imagen — inténtalo de nuevo.';
    }
    if (!signal.aborted) agregar(traidas);
    return null;
  }

  /** «Crear una imagen» recibió una imagen: sigue «Editar una imagen», con el mismo modelo si ese también edita. */
  function pasarAEditar(editar: Opcion) {
    setOpcion(editar);
    const suyo = elegidos.imagen;
    if (suyo && !elegidos.editar && ofrecidosDe('editar').some(m => m.id === suyo.id)) {
      setElegidos(e => ({ ...e, editar: suyo }));
    }
    decir('ok', 'Con una imagen, la caja la edita: pasamos a «Editar una imagen».');
  }

  function quitar(i: number) {
    setRefs(r => r.filter((_, j) => j !== i));
  }

  function alSoltar(e: React.DragEvent) {
    if (!(admiteImagenes || enEdicion) || !traeArchivos(e)) return;
    e.preventDefault();
    setArrastrando(false);
    // en Edición lo que se suelta son los videos a editar (VARIOS, y se suben en cola); pegar, en cambio, se ignora
    if (enEdicion) edicion.recibir(Array.from(e.dataTransfer.files));
    else agregar(soloImagenes(Array.from(e.dataTransfer.files)));
  }

  // Ctrl+V con una imagen copiada (una captura, o un archivo del explorador): se agrega igual que con el «+».
  // Va en el documento y no en el texto: da igual dónde esté el foco de la página.
  const alPegar = useEffectEvent((e: ClipboardEvent) => {
    if (!admiteImagenes) return;
    const destino = e.target instanceof HTMLElement ? e.target : null;
    // en otro campo (la clave de Blotato…) lo pegado es de ese campo; el único que es de la caja es su texto
    if (destino && destino !== area.current && (destino.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(destino.tagName))) return;
    // con un diálogo abierto (el visor, Blotato) la caja queda detrás, y con el mapa o una lista a la vista la tarjeta la esconde
    // (`hidden`, sin aria-hidden): no se le agrega nada sin que se vea, ni se corta un pegado que no es suyo
    if (!enVista || seccion.current?.closest('[aria-hidden="true"]')) return;
    const imagenes = imagenesPegadas(e.clipboardData);
    if (!imagenes.length) return;
    e.preventDefault();
    agregar(imagenes);
  });
  useEffect(() => {
    const oir = (e: ClipboardEvent) => alPegar(e);
    document.addEventListener('paste', oir);
    return () => document.removeEventListener('paste', oir);
  }, []);

  /** Devuelve true si el menú de modelo debe cerrarse: salió el pedido, o faltaba algo y el aviso (que cae abajo a la
   *  derecha, donde está el «Crear» del menú) no debe quedar tapando el botón. false solo si ya hay un pedido en vuelo. */
  function enviar(): boolean {
    const limpio = texto.trim();
    if (!limpio) {
      decir('mal', 'Cuéntanos qué quieres primero.');
      area.current?.focus();
      return true;
    }
    if (enviando) return false;
    // lo que elige modelo se pide aquí; lo demás va a su pantalla con el texto puesto
    if (opcion.modelos && modeloId) {
      if (opcion.id === 'imagen_editar' && !fotos.length) {
        decir('mal', 'Agrega con el + la imagen que quieres editar.');
        return true;
      }
      limpiarError();
      void pedirAqui(limpio, modeloId, fotos);
      return true;
    }
    // una foto que el clip aceptó (HEIC, GIF, AVIF, hasta 20 MB) y llegó aquí al cambiar de opción no pasó por la regla de
    // esta: se revisa antes de dejarla en el navegador y navegar, y se dice por qué no sirve
    const rechazada = fotos.map(f => rechazo(f, 'editar')).find(Boolean);
    if (rechazada) {
      decir('mal', rechazada);
      return true;
    }
    limpiarError();
    setEnviando(true); // hasta que la página navegue; antes del primer await: un doble clic es UNA navegación
    if (fotos.length) void irConFoto(opcion, limpio, fotos);
    else ir(destinoDe(opcion, limpio, modeloId));
    return true;
  }

  /** Cuentos e historias con la foto del personaje: se deja en el navegador y se navega con su token. Si no se pudo
   *  dejar (sin IndexedDB, ventana privada, cuota), se navega igual con `perdida`: navegar no cobra, y Crear le dice a
   *  la persona que agregue la foto allá. `guardarArchivos` no lanza y tiene plazo: la caja no se queda esperando. */
  async function irConFoto(destino: Opcion, limpio: string, adjuntas: File[]) {
    let token: string | null = null;
    try {
      token = await guardarArchivos(adjuntas);
    } catch {
      /* no debería lanzar; si lo hace, es lo mismo que no haber podido: se navega con «perdida» */
    }
    ir(destinoDe(destino, limpio, undefined, token ?? TRASPASO_PERDIDO));
  }

  async function pedirAqui(limpio: string, modelo: string, adjuntas: File[]) {
    const clave = `pedido-${++pedidos.current}`;
    setEnviando(true);
    setAviso('');
    let salio = false;
    let lanzada = false; // el servidor dejó una imagen en marcha: ya cobró y la hace
    let enElCuadro = false; // «ya lo estamos creando» salió en el cuadro de abajo a la derecha
    const tipo = opcion.id === 'clip' ? 'corto' : 'imagen';
    const queHace =
      opcion.id === 'clip'
        ? `creando tu clip de ${segundos} segundos${conSonido ? '' : ' sin sonido'}`
        : opcion.id === 'imagen'
          ? 'creando tu imagen'
          : 'editando tu imagen';
    try {
      const v = await moderar(limpio); // M13: se modera ANTES de lo que cobra
      if (!v.permitido) {
        decir('mal', v.mensaje);
        return;
      }
      alPedir?.({ clave, tipo, texto: limpio });
      salio = true;
      // la tarjeta de «Generando…» y este aviso salen juntos; si el servidor lo rechaza, el error lo reemplaza
      enElCuadro = avisar(`Ya estamos ${queHace}. Míralo abajo, en «Mis creaciones».`, { tipo: 'ok', clave: CLAVE_AVISO });
      if (enElCuadro) {
        errorEnElCuadro.current = false; // el aviso verde reemplazó al error de antes
        setError('');
      }
      // una imagen de un modelo que tarda contesta `lanzado` (ya se cobró, va en camino):
      // para la caja es lo mismo que una hecha, y «Mis creaciones» la enseña generándose
      if (opcion.id === 'clip') await pedirClip(limpio, modelo, adjuntas, segundos, conSonido);
      else if (opcion.id === 'imagen') lanzada = esLanzada(await pedirImagen(limpio, modelo));
      else await pedirEdicion(limpio, modelo, adjuntas[0]!);
      setTexto('');
      setTrajeron(false);
      setRefs([]);
      // sin el cuadro (esta página no lo trae) se dice aquí, junto a la caja
      if (!enElCuadro) setAviso('Listo, ya va. Míralo abajo, en «Mis creaciones».');
      refrescarSaldo(); // se cobró: el saldo cambia
    } catch (e) {
      decir('mal', e instanceof Error ? e.message : String(e));
      // 402 y demás: nada se cobró; el 502 de imágenes ya devolvió los créditos
      if (e instanceof ErrorApi && e.estado === 502) refrescarSaldo();
    } finally {
      setEnviando(false);
      if (salio) alTerminar?.(clave, lanzada);
    }
  }

  const crear = (
    <Boton
      nivel="principal"
      trabajando={enviando && 'Generando…'}
      onClick={enviar}
      className={unir('w-full min-[640px]:w-auto', modelo && 'min-[640px]:hidden')}
    >
      Crear <Icono nombre="enviar" />
    </Boton>
  );

  return (
    <>
      {/* arrastrar es un atajo: el camino accesible es el botón «+» (con teclado y lector de pantalla) */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <section
        ref={seccion}
        onDragOver={e => {
          // solo lo que trae archivos: mover texto dentro del propio cuadro sigue su camino normal
          if (!(admiteImagenes || enEdicion) || !traeArchivos(e)) return;
          e.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastrando(false);
        }}
        onDrop={alSoltar}
        // la caja va DENTRO de la tarjeta del inicio (Recorrido): sin fondo, relleno ni margen propios. El borde se queda,
        // transparente, para pintar el «suelta aquí» (discontinuo, ámbar) al arrastrar archivos sin que nada se mueva. En alto contraste
        // (`forced-colors`) el navegador pinta hasta un borde transparente con el color del sistema y saldría un segundo marco dentro
        // del de la tarjeta: ahí el borde en reposo se quita (el «suelta aquí» sí es un marco que hay que ver, y se queda)
        className={unir(
          'flex flex-col gap-4 rounded-grande border min-[640px]:flex-row',
          arrastrando ? 'border-dashed border-ambar' : 'border-transparent forced-colors:border-0',
        )}
      >
        <div
          role="group"
          aria-label="Qué quieres crear"
          className="flex flex-none gap-1 rounded-boton border border-linea p-1 min-[640px]:w-[81px] min-[640px]:flex-col min-[640px]:gap-1.5 min-[640px]:rounded-none min-[640px]:border-0 min-[640px]:border-r min-[640px]:p-0 min-[640px]:pr-4"
        >
          {RIEL.map(r => (
            <button
              key={r.familia}
              type="button"
              aria-pressed={familia === r.familia}
              onClick={() => {
                setFamilia(r.familia);
                setTrajeron(false);
                // Imagen y Video eligen su primera opción, como siempre; Edición no está en OPCIONES (su chip usa MODOS_EDICION) y
                // conserva todo lo suyo, también su modo (Editar o De videos a Shorts)
                if (r.familia !== 'edicion') setOpcion(OPCIONES[r.familia][0]!);
                selector.current?.cerrar();
              }}
              className={unir(
                'flex min-h-12 flex-1 cursor-pointer flex-row items-center justify-center gap-2 rounded-medio border-0 text-sm',
                'min-[640px]:min-h-16 min-[640px]:w-16 min-[640px]:flex-none min-[640px]:flex-col min-[640px]:gap-1 min-[640px]:text-xs',
                familia === r.familia ? 'bg-elevada text-texto' : 'bg-transparent text-secundario hover:bg-elevada',
              )}
            >
              <Icono nombre={r.icono} />
              {r.rotulo}
            </button>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <h2 id={idTitulo} ref={tituloRef} tabIndex={-1} className="m-0 mb-2 w-fit max-w-full font-titulo text-titulo-md font-bold">
            ¿Qué vamos a crear hoy?
          </h2>
          {enEdicion ? (
            <CajaEdicion ed={edicion} refs={refsEdicion} enVista={enVista} alElegirDeCreaciones={() => setHojaVideos(true)} />
          ) : (
            <>
              {trajeron && llegada && (
                <div id={idLlegada} className="mb-2">
                  <Aviso>
                    {HUECO.test(llegada.texto) ? AVISO_CON_HUECOS : AVISO_SIN_HUECOS}
                  </Aviso>
                </div>
              )}
              {fotos.length > 0 && <Referencias fotos={fotos} alQuitar={quitar} etiqueta={textosMas?.lista ?? 'Imágenes de referencia'} />}
              <CuadroDeTexto
                ref={area}
                aria-labelledby={idTitulo}
                aria-describedby={trajeron ? idLlegada : undefined}
                maxLength={5000}
                value={texto}
                onChange={e => {
                  setTexto(e.target.value);
                  setAviso('');
                  if (!e.target.value) setTrajeron(false);
                }}
                placeholder={opcion.hueco}
                // piso de 112 px bajo 360 px (88 desde ahí): con el relleno del cuadro el texto pierde 26 px de ancho y, en un
                // teléfono de 320, el ejemplo de «Creador de cuentos» (la más larga) pasa a 5 líneas y se cortaba la última
                className="min-h-28 resize-y min-[360px]:min-h-22"
              />
              <div className="mt-2 flex flex-col gap-2.5 min-[640px]:flex-row min-[640px]:flex-wrap min-[640px]:items-center">
                <div className="flex min-w-0 gap-2.5">
                {admiteImagenes && (
                  <>
                    {/* oculto: lo abre el «+». El clic lo hace el botón, no el input */}
                    <input
                      ref={archivos}
                      type="file"
                      accept="image/*,.heic,.heif"
                      multiple={maxRefs > 1}
                      tabIndex={-1}
                      aria-hidden="true"
                      className="hidden"
                      onChange={e => {
                        agregar(Array.from(e.target.files ?? []));
                        e.target.value = ''; // para poder elegir el mismo archivo otra vez
                      }}
                    />
                    <div ref={mas} className="relative flex-none">
                      <button
                        ref={botonMas}
                        type="button"
                        aria-label={
                          textosMas?.boton ??
                          (maxRefs > 1
                            ? 'Agregar imágenes de referencia'
                            : alAgregar
                              ? 'Agregar una imagen para editarla'
                              : 'Agregar la imagen que quieres editar')
                        }
                        title={textosMas?.pista ?? 'Agregar imágenes, arrástralas a la caja o pégalas con Ctrl+V'}
                        {...(hayBiblioteca ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': menuMas } : {})}
                        onClick={alPulsarMas}
                        className="grid size-12 flex-none cursor-pointer place-items-center rounded-pildora border border-linea bg-transparent text-texto hover:border-campo min-[640px]:size-11"
                      >
                        <Icono nombre="mas" />
                      </button>
                      {menuMas && (
                        <div
                          role="menu"
                          aria-label={textosMas?.menu ?? 'Agregar imágenes'}
                          tabIndex={-1}
                          onKeyDown={teclasDelMenu}
                          className="absolute top-[calc(100%+8px)] left-0 z-20 w-[min(340px,calc(100vw-48px))] rounded-grande border border-linea bg-superficie p-1.5"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={subirDeLaComputadora}
                            className="flex w-full min-h-14 cursor-pointer items-center gap-3 rounded-medio border-0 bg-transparent px-2.5 py-2 text-left text-texto hover:bg-elevada"
                          >
                            <Icono nombre="subir" className="text-secundario" />
                            <span className="block min-w-0 flex-1">
                              <b className="block text-sm font-semibold">Subir de tu computadora</b>
                              <small className="block text-xs text-secundario">{descripcionDeArchivos(archivosDeLaTarea)}</small>
                            </span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={abrirBiblioteca}
                            className="flex w-full min-h-14 cursor-pointer items-center gap-3 rounded-medio border-0 bg-transparent px-2.5 py-2 text-left text-texto hover:bg-elevada"
                          >
                            <Icono nombre="imagen" className="text-secundario" />
                            <span className="block min-w-0 flex-1">
                              <b className="block text-sm font-semibold">Elegir de Mis creaciones</b>
                              <small className="block text-xs text-secundario">
                                {imagenes.length === 1 ? '1 imagen tuya' : `${imagenes.length} imágenes tuyas`}
                              </small>
                            </span>
                          </button>
                          <p className="m-0 mx-1 mt-1 border-t border-linea px-1.5 pt-2.5 pb-1.5 text-xs text-secundario">
                            {textosMas?.recordatorio ?? 'También puedes arrastrarlas a la caja o pegarlas con Ctrl+V.'}
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}
                <SelectorOpcion
                  ref={selector}
                  opciones={opciones}
                  elegida={opcion}
                  detalle={o => (o.modelos ? 'según el modelo' : `${ESTRELLA} ${o.precio}`)}
                  alElegir={setOpcion}
                />
                </div>

                <div className="flex flex-col gap-2.5 min-[640px]:ml-auto min-[640px]:flex-row min-[640px]:items-center">
                  {tarea && modelo && (
                    <MenuModelo
                      key={tarea}
                      tarea={tarea}
                      grupos={grupos}
                      elegido={calidad ? { id: modelo.id, calidad: calidad.id } : { id: modelo.id }}
                      alElegir={e => setElegidos(s => ({ ...s, [tarea]: e }))}
                      precio={(id, cal) => precioDe(tarea, id, cal, PRECIOS, segundos, prefSonido)!}
                      alCrear={enviar}
                      enviando={enviando}
                      {...(duraciones.length
                        ? {
                            duracion: {
                              segundos,
                              opciones: duraciones,
                              alElegir: elegirDuracion,
                              admite: m => admite(tarea, m, segundos),
                              desde: m => duracionesDe(tarea, m)[0]!,
                            },
                          }
                        : {})}
                      {...(tarea === 'clip'
                        ? {
                            sonido: {
                              activo: conSonido,
                              editable: sePuedeApagar,
                              estado: sePuedeApagar ? (conSonido ? 'Con sonido' : 'Sin sonido') : textoSonido(modelo).estado,
                              motivo: sePuedeApagar ? '' : textoSonido(modelo).motivo,
                              ahorro: ahorroSinSonido(modelo, segundos),
                              detalle: m => detalleDe(m, segundos, prefSonido),
                              alCambiar: cambiarSonido,
                            },
                          }
                        : {})}
                      {...(tarea === 'clip' && fotos.length >= 2
                        ? { nota: `+ ${ESTRELLA} ${tarifaClip.componer_imagenes} por juntar tus ${fotos.length} imágenes en una` }
                        : {})}
                    />
                  )}
                  {crear}
                </div>
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="mt-2.5 mb-0 text-xs text-error">
              {error}
            </p>
          )}
          {aviso && !error && (
            <p role="status" className="mt-2.5 mb-0 text-xs text-secundario">
              {aviso}
            </p>
          )}
        </div>
      </section>

      {/* fuera del <section>: lo que se suelta o se hace en la hoja no sube hasta el arrastre de la caja */}
      <HojaVideos
        abierto={hojaVideos && enEdicion}
        alCambiar={setHojaVideos}
        enCaja={edicion.videos.map(v => ({ ref: v.ref, duracion_s: v.duracion_s, formato: v.formato, bytes: v.bytes }))}
        alUsar={edicion.agregarElegidos}
        // lo marcado se agrega primero: elegir archivos después no deshace la selección (decisión del lienzo)
        alElegirArchivos={marcados => {
          edicion.agregarElegidos(marcados);
          edicion.abrirSelector();
        }}
        alSoltarArchivos={(soltados, marcados) => {
          edicion.agregarElegidos(marcados);
          edicion.recibir(soltados);
        }}
        focoAlCerrar={refsEdicion.mas}
        ocupado={edicion.ocupado}
      />
      <Biblioteca
        abierto={biblioteca}
        alCambiar={setBiblioteca}
        imagenes={imagenes}
        disponibles={disponibles}
        reemplaza={topeDeImagenes === 1}
        alAgregar={traerDeLaBiblioteca}
        alElegirArchivos={() => {
          setBiblioteca(false);
          archivos.current?.click();
        }}
        alSoltarArchivos={soltadas => {
          setBiblioteca(false);
          agregar(soltadas); // la hoja ya dejó solo las imágenes
        }}
        descripcionArchivos={descripcionDeArchivos(archivosDeLaTarea)}
        focoAlCerrar={botonMas}
      />
    </>
  );
});


/** Las miniaturas de lo que se va a mandar, con su ✕. Las URL de vista previa se sueltan al irse. */
function Referencias({ fotos, alQuitar, etiqueta }: { fotos: File[]; alQuitar: (i: number) => void; etiqueta: string }) {
  // jsdom no trae createObjectURL: ahí no hay vista previa y no pasa nada
  const urls = useMemo(() => fotos.map(f => (typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : '')), [fotos]);
  useEffect(() => () => urls.forEach(u => u && URL.revokeObjectURL(u)), [urls]);
  return (
    <ul aria-label={etiqueta} className="m-0 mb-2 flex list-none flex-wrap gap-3 p-0">
      {fotos.map((f, i) => (
        <li key={f.name + i} className="relative size-14 rounded-medio border border-linea bg-elevada">
          {urls[i] ? <img src={urls[i]} alt="" className="size-full rounded-medio object-cover" /> : null}
          <button
            type="button"
            aria-label={`Quitar «${f.name}»`}
            onClick={() => alQuitar(i)}
            className="absolute -top-2 -right-2 grid size-6 cursor-pointer place-items-center rounded-pildora border border-linea bg-fondo p-0 text-texto hover:border-campo"
          >
            <Icono nombre="cerrar" className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}
