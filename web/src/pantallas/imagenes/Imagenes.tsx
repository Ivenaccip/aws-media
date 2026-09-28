// /estudio/imagenes/ — crear, editar con pincel o transformar una imagen
// (UI·8.7). Cobra una cosa por envío, «Generar / Cambiar / Transformar ✦ N»,
// con la tarifa de tools/tarifas.json (video.imagen).
//
// Paridad con static/imagenes.html. Lo que se cuida del dinero:
//   · el candado del cobro es el de <BotonCobro>: un doble clic es UN envío,
//     y que monedero.js refresque el saldo a media petición no reabre nada;
//   · todo lo que se puede decir antes de cobrar se dice antes (un atajo sin
//     elegir, editar sin imagen, el pincel sin zona, el texto vacío);
//   · el pedido se arma ANTES de moderar: lo que se toque durante la revisión
//     ya no cambia lo que se cobra;
//   · con una petición en vuelo no se cambia la imagen, la zona ni el modo.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { BotonCobro } from '../../marca/BotonCobro';
import { EsperaIA } from '../../marca/EsperaIA';
import { Marco } from '../../marca/Marco';
import { Recarga } from '../../marca/Recarga';
import { refrescarSaldo, useSaldo } from '../../marca/useSaldo';
import { ErrorApi } from '../../nucleo/api';
import { moderar } from '../../nucleo/moderar';
import { video } from '../../nucleo/tarifas';
import { Aviso } from '../../ui/Aviso';
import { Boton, claseBoton } from '../../ui/Boton';
import { Dialogo } from '../../ui/Dialogo';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import { decodificar, type Decodificada } from './decodificar';
import { Lienzo, type MandoLienzo } from './Lienzo';
import {
  bajarPropia,
  cargarEstilos,
  crear,
  editar,
  formatoDe,
  MAX_TEXTO,
  mensaje,
  modoDe,
  nombrePropio,
  paleta,
  problemaArchivo,
  problemaEnvio,
  quiereEditar,
  TEXTOS,
  urlArchivo,
  vistaDe,
  type Atajo,
  type Estado,
  type Estilo,
  type Formato,
  type Hecha,
} from './logica';

interface Trabajo {
  archivo: File;
  /** Si es una de tus imágenes guardadas: se puede descargar. */
  nombre: string | null;
  dec: Decodificada;
}

interface Falla {
  texto: string;
  sinSaldo?: boolean;
}

const FORMATOS: [Formato, string, string, string][] = [
  ['horizontal', 'Horizontal', 'YouTube · ', '16:9'],
  ['vertical', 'Vertical', 'Reels · TikTok · Shorts · ', '9:16'],
  ['cuadrado', 'Cuadrado', 'Instagram · Facebook · ', '1:1'],
];

const PALABRAS = ['Crea', 'Edita', 'Bocetea'];
const TARIFA = video.imagen;
const AL_AGOTAR =
  'Esto está tardando más de lo normal. Si no aparece tu imagen, inténtalo otra vez; si te descontaron créditos, escríbenos.';

export function Imagenes() {
  const saldo = useSaldo();
  const [estilos, setEstilos] = useState<Estilo[]>([]);
  const [estilo, setEstilo] = useState('animated');
  const [estiloCustom, setEstiloCustom] = useState('');
  // El de TRANSFORMAR va aparte y empieza vacío: si el «Animado» de crear
  // viajara, «pásala a acuarela» llegaría como «acuarela… Target look: Pixar»
  const [estiloDestino, setEstiloDestino] = useState<string | null>(null);
  const [estiloCustomDest, setEstiloCustomDest] = useState('');
  const [formatoElegido, setFormatoElegido] = useState<Formato>('cuadrado');
  const [modoSel, setModoSel] = useState<'pincel' | 'todo'>('pincel');
  const [trabajo, setTrabajo] = useState<Trabajo | null>(null);
  const [resultado, setResultado] = useState<Hecha | null>(null);
  const [estado, setEstado] = useState<Estado>('vacio');
  const [prompt, setPrompt] = useState('');
  const [promptCreado, setPromptCreado] = useState('');
  const [intencion, setIntencion] = useState(false);
  const [pidioEditar, setPidioEditar] = useState(false);
  const [prefiereCrear, setPrefiereCrear] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [enVuelo, setEnVuelo] = useState(false);
  const [espera, setEspera] = useState<string | null>(null);
  const [hayTrazo, setHayTrazo] = useState(false);
  const [grosor, setGrosor] = useState(46);
  const [falla, setFalla] = useState<Falla | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [abriendo, setAbriendo] = useState(false);
  const [siguiendo, setSiguiendo] = useState(false);
  const [veredicto, setVeredicto] = useState<{ mensaje: string; motivo: string } | null>(null);
  const [miniatura, setMiniatura] = useState('');

  const lienzo = useRef<MandoLienzo | null>(null);
  const texto = useRef<HTMLTextAreaElement>(null);
  const archivoInput = useRef<HTMLInputElement>(null);
  const envio = useRef<HTMLSpanElement>(null);
  const generacion = useRef(0);
  // lo que leen las promesas y los eventos del documento sin esperar un render
  const vivo = useRef({ enVuelo: false, trabajo: null as Trabajo | null, resultado: null as Hecha | null, estado: 'vacio' as Estado });
  useEffect(() => {
    vivo.current = { enVuelo, trabajo, resultado, estado };
  }, [enVuelo, trabajo, resultado, estado]);

  // qué se ve: sin imagen no hay lienzo; sin resultado no hay resultado
  const visible: Estado =
    estado === 'lienzo' && !trabajo ? (resultado ? 'resultado' : 'vacio') : estado === 'resultado' && !resultado ? 'vacio' : estado;
  const vista = vistaDe({
    hayImagen: !!trabajo,
    hayResultado: !!resultado,
    cargando,
    intencion,
    pidioEditar,
    prefiereCrear,
  });
  const modo = modoDe(!!trabajo, vista, modoSel);
  const transformando = vista === 'editar' && modoSel === 'todo';
  const formato: Formato = trabajo ? formatoDe(trabajo.dec.ancho, trabajo.dec.alto) : formatoElegido;
  const idTexto = useId();

  // ── la imagen de trabajo
  const abrirArchivo = useCallback((f: File | null | undefined, nombre: string | null = null) => {
    if (vivo.current.enVuelo) return; // no se cambia la imagen bajo una petición en curso
    const malo = problemaArchivo(f);
    if (malo) {
      setFalla({ texto: malo });
      return;
    }
    setFalla(null);
    setAviso(null);
    // cada carga invalida las anteriores, y mientras decodifica no se envía
    const gen = ++generacion.current;
    setCargando(true);
    decodificar(f!).then(
      dec => {
        if (gen !== generacion.current || vivo.current.enVuelo) return;
        setTrabajo({ archivo: f!, nombre, dec });
        setEstado('lienzo');
      },
      () => {
        if (gen === generacion.current) setFalla({ texto: 'No pude abrir esa imagen.' });
      },
    ).finally(() => {
      if (gen === generacion.current) setCargando(false);
    });
  }, []);

  function soltarImagen() {
    generacion.current++; // una carga a medias ya no cuenta
    setCargando(false);
    setTrabajo(null);
    setHayTrazo(false);
    setEstiloDestino(null);
  }

  // «Quitar» suelta la imagen de trabajo, NO el resultado ya pagado
  function quitar() {
    if (enVuelo) return;
    soltarImagen();
    setEstado(resultado ? 'resultado' : 'vacio');
  }

  // vuelve a crear, con el texto de la última imagen creada (lo creado y lo
  // editado ya quedó en «Mis imágenes» del inicio)
  function empezarDeNuevo() {
    if (vivo.current.enVuelo) return;
    soltarImagen();
    setResultado(null);
    setPidioEditar(false);
    setPrompt(promptCreado);
    setIntencion(quiereEditar(promptCreado));
    if (!promptCreado.trim()) setPrefiereCrear(false);
    setEstado('vacio');
    texto.current?.focus();
  }

  const elegirArchivo = () => {
    if (!vivo.current.enVuelo) archivoInput.current?.click();
  };

  // «Seguir editando»: el resultado pasa a ser la imagen de trabajo
  const seguir = useCallback(
    async (nombre: string) => {
      if (vivo.current.enVuelo) return;
      setFalla(null);
      setSiguiendo(true);
      try {
        const f = await bajarPropia(nombre);
        // si mientras bajaba salió otra petición o cambió lo que hay en
        // pantalla, esta imagen ya es vieja: pintarla sería editar otra versión
        const v = vivo.current;
        if (v.enVuelo || v.resultado?.nombre !== nombre || v.estado !== 'resultado') return;
        abrirArchivo(f, nombre);
        texto.current?.focus();
      } catch (e) {
        setFalla({ texto: 'No pude abrir tu imagen para editarla: ' + mensaje(e) });
      } finally {
        setSiguiendo(false);
      }
    },
    [abrirArchivo],
  );

  // ── al abrir: los estilos, y lo que manda el enlace
  const arrancada = useRef(false);
  useEffect(() => {
    if (arrancada.current) return;
    arrancada.current = true;
    cargarEstilos().then(setEstilos, () =>
      setAviso('No pudimos cargar los estilos. Recarga la página para elegir otro.'),
    );
    // «Mis imágenes» del inicio abre aquí con ?img=<nombre>; el menú viejo del
    // editor, con ?editar=1; la caja del inicio, con ?prompt=
    const q = new URLSearchParams(location.search);
    const nombre = q.get('img');
    const t = q.get('prompt');
    Promise.resolve().then(() => {
      if (q.has('editar') || nombre) setPidioEditar(true);
      if (t) {
        setPrompt(t.slice(0, MAX_TEXTO));
        setIntencion(quiereEditar(t));
      }
      if (!nombrePropio(nombre)) return;
      setAbriendo(true);
      bajarPropia(nombre)
        .then(f => {
          if (!vivo.current.trabajo && !vivo.current.enVuelo) abrirArchivo(f, nombre);
        })
        .catch(e => setAviso('No pude abrir tu imagen: ' + mensaje(e)))
        .finally(() => setAbriendo(false));
    });
  }, [abrirArchivo]);

  // soltar una imagen en cualquier parte la abre; pegar (Ctrl+V) también,
  // salvo que venga texto (Excel y PowerPoint copian texto Y un dibujo)
  const [arrastrando, setArrastrando] = useState(false);
  useEffect(() => {
    const conArchivos = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const sobre = (e: DragEvent) => {
      if (!conArchivos(e)) return;
      e.preventDefault();
      setArrastrando(!vivo.current.enVuelo);
    };
    const fuera = (e: DragEvent) => {
      if (!conArchivos(e)) return;
      e.preventDefault();
      setArrastrando(false);
    };
    const suelta = (e: DragEvent) => {
      if (!conArchivos(e)) return;
      e.preventDefault();
      setArrastrando(false);
      abrirArchivo(e.dataTransfer!.files[0]);
    };
    const pega = (e: ClipboardEvent) => {
      const cd = e.clipboardData;
      if (!cd || vivo.current.enVuelo || [...cd.types].includes('text/plain')) return;
      const f = [...cd.files].find(x => x.type.startsWith('image/'));
      if (f) {
        e.preventDefault();
        abrirArchivo(f);
      }
    };
    document.addEventListener('dragover', sobre);
    document.addEventListener('dragleave', fuera);
    document.addEventListener('drop', suelta);
    document.addEventListener('paste', pega);
    return () => {
      document.removeEventListener('dragover', sobre);
      document.removeEventListener('dragleave', fuera);
      document.removeEventListener('drop', suelta);
      document.removeEventListener('paste', pega);
    };
  }, [abrirArchivo]);

  // la miniatura de «Tu imagen» sale del lienzo ya pintado
  useEffect(() => {
    if (!trabajo) return;
    Promise.resolve().then(() => setMiniatura(lienzo.current?.miniatura() ?? ''));
  }, [trabajo]);

  // ── la intención: se lee cuando deja de escribir (cambiar la cuadrícula a
  // media palabra desorienta) y al enviar
  const tIntencion = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(tIntencion.current ?? undefined), []);
  function alEscribir(v: string) {
    setPrompt(v);
    clearTimeout(tIntencion.current ?? undefined);
    tIntencion.current = setTimeout(() => {
      if (vivo.current.enVuelo) return;
      if (!v.trim()) setPrefiereCrear(false);
      setIntencion(quiereEditar(v));
    }, 700);
  }

  // ── modo, estilo y formato
  function fijarModo(m: 'pincel' | 'todo') {
    if (enVuelo) return;
    setModoSel(m);
    setFalla(null);
    // quien elige «Cambiar una zona» va a pintar: se le enseña su imagen
    if (m === 'pincel' && trabajo && visible === 'resultado') setEstado('lienzo');
  }

  function fijarEstilo(id: string, destino = transformando) {
    // al transformar, tocar el elegido lo suelta: se vuelve a «sin estilo»
    if (destino) setEstiloDestino(d => (d === id ? null : id));
    else setEstilo(id);
  }

  function elegirFormato(f: Formato) {
    if (trabajo) return; // con imagen el formato lo pone ella
    setFormatoElegido(f);
  }

  // ── la paleta de «/»
  const pal = paleta(prompt, estilos, !!trabajo, !!(trabajo || resultado));
  const [selMovida, setSelMovida] = useState<{ para: string; i: number } | null>(null);
  const sel = selMovida && selMovida.para === prompt ? selMovida.i : pal.sel;

  function usarAtajo(a: Atajo | undefined) {
    if (!a || enVuelo) return;
    setPrompt(''); // el comando no viaja al modelo
    const x = a.accion;
    if (x.tipo === 'modo') fijarModo(x.modo);
    else if (x.tipo === 'subir') elegirArchivo();
    else if (x.tipo === 'editar') {
      setPidioEditar(true);
      setPrefiereCrear(false);
    } else if (x.tipo === 'formato') elegirFormato(x.formato);
    else if (x.tipo === 'estilo') fijarEstilo(x.id);
    else empezarDeNuevo();
    texto.current?.focus();
  }

  function teclas(e: React.KeyboardEvent<HTMLElement>) {
    const n = pal.lista.length;
    if (n) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelMovida({ para: prompt, i: (sel + 1) % n });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelMovida({ para: prompt, i: sel <= 0 ? n - 1 : sel - 1 });
        return;
      }
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (sel >= 0) usarAtajo(pal.lista[sel]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setPrompt('');
        return;
      }
      // Tab no se toca: mueve el foco, como en cualquier campo
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      envio.current?.querySelector('button')?.click();
    }
  }

  // ── enviar (el candado lo pone BotonCobro, antes de cualquier await)
  async function enviar(cobrado?: () => void) {
    if (vivo.current.enVuelo || cargando) return;
    setFalla(null);
    // lo recién escrito también cuenta
    const intAhora = quiereEditar(prompt);
    setIntencion(intAhora);
    const vistaAhora = vistaDe({ hayImagen: !!trabajo, hayResultado: !!resultado, cargando, intencion: intAhora, pidioEditar, prefiereCrear });
    const m = modoDe(!!trabajo, vistaAhora, modoSel);
    const p = prompt.trim();
    const malo = problemaEnvio({ modo: m, prompt: p, hayImagen: !!trabajo, hayResultado: !!resultado, hayTrazo });
    if (malo) {
      if (m === 'pincel' && trabajo && !hayTrazo && visible !== 'lienzo') setEstado('lienzo'); // para pintar hay que ver la imagen
      setFalla({ texto: malo });
      if (!p) texto.current?.focus();
      return;
    }
    vivo.current.enVuelo = true;
    setEnVuelo(true);
    setEspera('Revisando tu texto…'); // cubre el hueco mudo del guardarraíl
    let creada: Hecha | null = null;
    let cobra = false; // UI·19: el «−N» vuela solo si el servidor cobró
    try {
      // el pedido se arma ANTES de moderar: tocar la pantalla durante la
      // revisión ya no cambia lo que se cobra
      let hacer: () => Promise<Hecha>;
      if (m === 'crear') {
        const cuerpo = { prompt: p, estilo, estilo_custom: estiloCustom, formato };
        hacer = () => crear(cuerpo);
      } else {
        const fd = new FormData();
        fd.append('prompt', p);
        fd.append('modo', m);
        fd.append('imagen', await lienzo.current!.imagenBlob(), 'imagen.jpg');
        if (m === 'pincel') fd.append('marcada', await lienzo.current!.marcadaBlob(), 'marcada.jpg');
        // el estilo es un destino: solo al transformar, y solo si se eligió uno
        if (m === 'todo' && estiloDestino) {
          fd.append('estilo', estiloDestino);
          fd.append('estilo_custom', estiloCustomDest);
        }
        hacer = () => editar(fd);
      }
      const v = await moderar(p); // M13
      if (!v.permitido) {
        setVeredicto({ mensaje: v.mensaje, motivo: v.motivo });
        return;
      }
      setEspera(TEXTOS[m].trabajando);
      const d = await hacer();
      setEspera(null); // el orbe se va ANTES de que aparezca el resultado
      setResultado(d);
      vivo.current.resultado = d;
      vivo.current.estado = 'resultado';
      setEstado('resultado');
      if (m === 'crear') {
        // el texto ya se gastó: la caja queda lista para decir qué cambiar
        creada = d;
        setPromptCreado(p);
        setPrompt('');
        setIntencion(false);
      }
      cobra = true;
      cobrado?.(); // antes de bajar la imagen: el «−N» va con el saldo
      refrescarSaldo();
    } catch (e) {
      setEspera(null); // NUNCA un orbe girando junto a un error
      setFalla({ texto: mensaje(e), sinSaldo: e instanceof ErrorApi && e.sinSaldo });
    } finally {
      setEspera(null);
      vivo.current.enVuelo = false;
      setEnVuelo(false);
    }
    // lo recién creado pasa directo a editarse
    if (creada) await seguir(creada.nombre);
    return cobra;
  }

  // ── el título: la palabra gira mientras la pantalla está en blanco
  const [palabra, setPalabra] = useState(0);
  const gira = vista === 'crear' && !prompt.trim() && !reduceMovimiento();
  useEffect(() => {
    if (!gira) return;
    const t = setInterval(() => setPalabra(i => (i + 1) % PALABRAS.length), 2600);
    return () => clearInterval(t);
  }, [gira]);
  const fija = vista === 'editar' ? 1 : 0;
  const mostrada = gira ? palabra : fija;

  const propia = visible === 'resultado' ? resultado?.nombre : visible === 'lienzo' ? trabajo?.nombre : null;
  const t = TEXTOS[modo];

  const titulo = (
    <>
      <span className="sr-only">{PALABRAS[fija]} tu imagen</span>
      <span aria-hidden="true">
        <span className="bg-gradient-to-r from-ambar to-ambar-claro bg-clip-text text-transparent" key={mostrada}>
          {PALABRAS[mostrada]}
        </span>{' '}
        tu imagen
      </span>
    </>
  );

  // ── las tarjetas (con key: la caja de texto no se desmonta al cambiar de vista)
  const tarjetas: ReactNode[] = [];
  if (vista === 'crear')
    tarjetas.push(
      <Tarjeta key="estilo" titulo="Estilo visual" icono="estilo" className="md:col-start-1 md:row-span-2 md:row-start-1">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
          <div role="group" aria-label="Estilo visual" className="flex flex-wrap gap-2 sm:flex-col sm:flex-nowrap">
            {estilos.map(e => (
              <Chip key={e.id} puesto={estilo === e.id} onClick={() => fijarEstilo(e.id, false)}>
                {e.nombre}
              </Chip>
            ))}
            {!estilos.length && !aviso && <span className="text-xs text-secundario">Cargando estilos…</span>}
          </div>
          <Muestra estilo={estilo} descripcion={estilos.find(e => e.id === estilo)?.descripcion ?? ''}>
            {estilo === 'custom' && (
              <textarea
                value={estiloCustom}
                onChange={e => setEstiloCustom(e.target.value)}
                maxLength={500}
                aria-label="Describe tu estilo"
                placeholder="Describe el estilo con tus palabras (en inglés funciona mejor)"
                className="absolute inset-0 size-full resize-none border-0 bg-elevada p-3 text-sm text-texto"
              />
            )}
          </Muestra>
        </div>
      </Tarjeta>,
    );
  else
    tarjetas.push(
      <section
        key="imagen"
        aria-label="Tu imagen"
        className={unir(
          'flex min-w-0 flex-col gap-3 rounded-grande border bg-superficie p-3 md:col-start-1 md:row-span-3 md:row-start-1',
          arrastrando ? 'border-dashed border-texto' : 'border-linea',
        )}
      >
        {visible === 'lienzo' && modo === 'pincel' && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              Pincel
              <input
                type="range"
                min={10}
                max={120}
                value={grosor}
                onChange={e => setGrosor(Number(e.target.value))}
                disabled={enVuelo}
                aria-label="Grosor del pincel"
                className="min-h-11 w-[120px] accent-texto"
              />
            </label>
            <Boton nivel="secundario" denso disabled={enVuelo || !hayTrazo} onClick={() => lienzo.current?.borrarZona()}>
              Borrar zona
            </Boton>
            <span className="text-xs text-secundario">Pinta lo que quieres cambiar.</span>
          </div>
        )}
        <div className="relative grid min-h-[280px] flex-1 place-items-center md:min-h-[420px]">
          {visible === 'vacio' && (
            <div className="flex flex-col items-center gap-3 rounded-grande border border-dashed border-linea px-6 py-10 text-center">
              <Icono nombre="imagen" className="size-8 text-secundario" />
              <p className="m-0 font-semibold">
                {abriendo || cargando ? 'Abriendo tu imagen…' : 'Sube la imagen o el boceto que quieres editar'}
              </p>
              <p className="m-0 text-xs text-secundario">
                Arrástrala aquí, pégala o elígela. JPG, PNG o WebP, hasta 15 MB.
              </p>
              <Boton nivel="secundario" icono={<Icono nombre="subir" />} disabled={enVuelo || cargando} onClick={elegirArchivo}>
                Elegir una imagen
              </Boton>
              <Boton
                nivel="enlace"
                disabled={enVuelo}
                onClick={() => {
                  setPrefiereCrear(true);
                  setPidioEditar(false);
                  setIntencion(false);
                  texto.current?.focus();
                }}
              >
                No, quiero crear una imagen nueva
              </Boton>
            </div>
          )}
          {trabajo && (
            <div className={unir('size-full place-items-center', visible === 'lienzo' ? 'grid' : 'hidden')}>
              <Lienzo
                ref={lienzo}
                imagen={trabajo.dec}
                pincel={modo === 'pincel'}
                grosor={grosor}
                bloqueado={enVuelo}
                alTrazo={setHayTrazo}
              />
            </div>
          )}
          {visible === 'resultado' && resultado && (
            <img src={resultado.url} alt="Tu imagen nueva" className="max-h-full max-w-full rounded-medio object-contain" />
          )}
          {espera && vista === 'editar' && (
            <div className="absolute right-2 top-2">
              <EsperaIA texto={espera} tope={180000} textoAlAgotar={AL_AGOTAR} />
            </div>
          )}
        </div>
        {visible !== 'vacio' && (
          <div className="flex flex-wrap items-center gap-2">
            {visible === 'resultado' && trabajo && (
              <Boton nivel="secundario" denso disabled={enVuelo} onClick={() => setEstado('lienzo')}>
                {miniatura && <img src={miniatura} alt="" className="size-6 rounded-chico object-cover" />}
                Tu imagen
              </Boton>
            )}
            {resultado && visible !== 'resultado' && resultado.nombre !== trabajo?.nombre && (
              <Boton nivel="secundario" denso disabled={enVuelo} onClick={() => setEstado('resultado')}>
                Ver resultado
              </Boton>
            )}
            {visible === 'lienzo' && (
              <Boton nivel="secundario" denso icono={<Icono nombre="cerrar" />} disabled={enVuelo} onClick={quitar}>
                Quitar imagen
              </Boton>
            )}
            <span className="flex-1" />
            {propia && (
              <a className={claseBoton('secundario', true)} href={urlArchivo(propia)} download="imagen.jpg">
                <Icono nombre="descargar" />
                Descargar
              </a>
            )}
            {visible === 'resultado' && resultado && (
              <Boton
                nivel="secundario"
                denso
                icono={<Icono nombre="editar" />}
                disabled={enVuelo || siguiendo}
                onClick={() => void seguir(resultado.nombre)}
              >
                Seguir editando
              </Boton>
            )}
            <Boton nivel="secundario" denso icono={<Icono nombre="mas" />} disabled={enVuelo} onClick={empezarDeNuevo}>
              Nueva imagen
            </Boton>
          </div>
        )}
      </section>,
      <Tarjeta key="modos" titulo="¿Qué cambiamos?" icono="pincel" className="md:col-start-2 md:row-start-1">
        <div role="radiogroup" aria-label="Qué quieres hacer" className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ['pincel', 'Cambiar una zona', 'Pintas dónde y el resto queda igual'],
              ['todo', 'Transformar toda la imagen', 'Otro estilo, otra técnica, otra época'],
            ] as const
          ).map(([id, b, s]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={modoSel === id}
              disabled={enVuelo}
              onClick={() => fijarModo(id)}
              className={unir(
                'flex min-h-11 cursor-pointer flex-col items-start gap-1 rounded-medio border bg-transparent p-3 text-left text-sm disabled:cursor-default',
                modoSel === id ? 'border-texto bg-elevada text-texto' : 'border-campo text-secundario hover:border-secundario',
              )}
            >
              <b className="font-semibold">{b}</b>
              <span className="text-xs text-secundario">{s}</span>
            </button>
          ))}
        </div>
        {modoSel === 'todo' && (
          <div className="mt-3">
            <span className="text-xs text-secundario">Llévala a un estilo (opcional)</span>
            <div role="group" aria-label="Estilo al que se convierte" className="mt-2 flex flex-wrap gap-2">
              {estilos.map(e => (
                <Chip key={e.id} puesto={estiloDestino === e.id} disabled={enVuelo} onClick={() => fijarEstilo(e.id, true)}>
                  {e.nombre}
                </Chip>
              ))}
            </div>
            {estiloDestino === 'custom' && (
              <input
                type="text"
                value={estiloCustomDest}
                onChange={e => setEstiloCustomDest(e.target.value)}
                maxLength={500}
                aria-label="Describe el estilo"
                placeholder="Describe el estilo (en inglés funciona mejor)"
                className="mt-2 min-h-11 w-full rounded-medio border border-campo bg-elevada px-3 text-sm text-texto"
              />
            )}
          </div>
        )}
        <p className="m-0 mt-3 text-xs text-secundario">
          {modoSel === 'pincel'
            ? 'La zona nueva toma el estilo de tu imagen.'
            : estiloDestino
              ? 'Tu imagen se convierte a este estilo. Tócalo otra vez para quitarlo.'
              : 'Sin estilo, tu imagen toma el look que describas.'}
        </p>
      </Tarjeta>,
    );

  tarjetas.push(
    <section
      key="texto"
      className={unir(
        'relative flex min-w-0 flex-col gap-3 rounded-grande border bg-superficie p-4 focus-within:border-campo',
        vista === 'crear' ? 'md:col-start-2 md:row-start-1' : 'md:col-start-2 md:row-start-2',
        arrastrando && vista === 'crear' ? 'border-dashed border-texto' : 'border-linea',
      )}
    >
      {pal.lista.length > 0 && (
        <div
          id={idTexto + '-paleta'}
          role="listbox"
          aria-label="Atajos"
          // la lista rueda si hay muchos atajos: se maneja desde la caja de
          // texto (aria-activedescendant) y, con Tab, también desde ella
          // misma — lo que rueda tiene que poder recibir el foco
          tabIndex={0}
          aria-activedescendant={sel >= 0 ? `${idTexto}-atajo-${sel}` : undefined}
          onKeyDown={teclas}
          className="absolute inset-x-3 bottom-[calc(100%+8px)] z-10 max-h-[232px] overflow-y-auto rounded-boton border border-campo bg-superficie p-1"
        >
          {pal.lista.map((a, i) => (
            <div
              key={a.cmd}
              id={`${idTexto}-atajo-${i}`}
              role="option"
              aria-selected={i === sel}
              // se eligen con la flecha desde la caja o la lista (aria-activedescendant);
              // el foco directo es para el lector de pantalla
              tabIndex={-1}
              onClick={() => usarAtajo(a)}
              onKeyDown={e => {
                if (e.key === 'Enter') usarAtajo(a);
              }}
              className={unir('cursor-pointer rounded-medio p-3 text-sm leading-5 hover:bg-elevada', i === sel && 'bg-elevada')}
            >
              <b className="font-semibold text-texto">{a.cmd}</b> · {a.que}
            </div>
          ))}
        </div>
      )}
      <p className="sr-only" aria-live="polite" id={idTexto + '-anuncio'}>
        {pal.lista.length ? `${pal.lista.length} atajos. Flechas para elegir, Enter para usar.` : ''}
      </p>
      <textarea
        ref={texto}
        value={prompt}
        onChange={e => alEscribir(e.target.value)}
        onKeyDown={teclas}
        maxLength={MAX_TEXTO}
        aria-label="Qué quieres"
        aria-controls={pal.lista.length ? idTexto + '-paleta' : undefined}
        aria-activedescendant={sel >= 0 && pal.lista.length ? `${idTexto}-atajo-${sel}` : undefined}
        aria-describedby={idTexto + '-anuncio'}
        placeholder={t.hint}
        className="min-h-24 flex-1 resize-none border-0 bg-transparent px-0.5 py-1 text-md text-texto outline-none"
      />
      <div className="flex items-center gap-2">
        {!trabajo && (
          <button
            type="button"
            aria-label="Subir una imagen para editarla"
            title="Sube una imagen o un boceto para editarlo"
            disabled={enVuelo}
            onClick={elegirArchivo}
            className="grid size-11 flex-none cursor-pointer place-items-center rounded-full border border-campo bg-transparent p-0 text-texto hover:enabled:border-secundario hover:enabled:bg-elevada disabled:cursor-default disabled:opacity-40"
          >
            <Icono nombre="mas" />
          </button>
        )}
        <span className="min-w-0 flex-1 text-xs text-secundario">
          {visible === 'resultado' && trabajo ? 'Enviar otra vez vuelve a aplicar el cambio sobre tu imagen.' : ''}
        </span>
        <span className="ml-auto text-xs text-secundario tabular-nums">
          {prompt.length}/{MAX_TEXTO}
        </span>
      </div>
    </section>,
  );

  if (vista === 'crear')
    tarjetas.push(
      <Tarjeta key="formato" titulo="Formato" icono="formato" className="md:col-start-2 md:row-start-2">
        <div role="radiogroup" aria-label="Formato de la imagen" className="grid grid-cols-3 gap-3">
          {FORMATOS.map(([id, b, plat, ar]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={formato === id}
              aria-disabled={!!trabajo || undefined}
              onClick={() => elegirFormato(id)}
              className={unir(
                'flex min-h-11 min-w-0 cursor-pointer flex-col items-center gap-1 rounded-medio border bg-transparent p-2 text-center text-sm',
                formato === id ? 'border-texto bg-elevada text-texto' : 'border-campo text-secundario hover:border-secundario',
              )}
            >
              <span className="flex h-10 items-center justify-center" aria-hidden="true">
                <span
                  className={unir(
                    'block rounded-[3px] border-2 border-current opacity-75',
                    id === 'horizontal' ? 'h-[23px] w-10' : id === 'vertical' ? 'h-10 w-[23px]' : 'size-8',
                  )}
                />
              </span>
              <b className="font-semibold">{b}</b>
              <span className="text-xs">
                <span className="hidden sm:inline">{plat}</span>
                {ar}
              </span>
            </button>
          ))}
        </div>
        <p className="m-0 mt-2 text-xs text-secundario">Si después la editas, conserva este formato.</p>
      </Tarjeta>,
    );

  return (
    <Marco pantalla="imagenes" titulo={titulo}>
      <input
        ref={archivoInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={e => {
          const f = e.target.files?.[0];
          e.target.value = ''; // elegir otra vez el mismo archivo vuelve a disparar change
          abrirArchivo(f);
        }}
      />
      {aviso && (
        <div className="mb-4">
          <Aviso tipo="error">{aviso}</Aviso>
        </div>
      )}
      <div className={unir('grid gap-3', vista === 'crear' ? 'md:grid-cols-2' : 'md:grid-cols-[3fr_2fr]')}>{tarjetas}</div>

      <div className="mt-6 flex flex-col items-center gap-2">
        <span ref={envio}>
          <BotonCobro
            verbo={t.verbo}
            costo={TARIFA}
            saldo={saldo}
            trabajando={t.verbo === 'Generar' ? 'Creando…' : t.verbo === 'Cambiar' ? 'Cambiando…' : 'Transformando…'}
            deshabilitado={cargando}
            alCobrar={enviar}
          />
        </span>
        {espera && vista === 'crear' && <EsperaIA texto={espera} tope={180000} textoAlAgotar={AL_AGOTAR} />}
        {falla && (
          <p role="alert" className="m-0 max-w-[65ch] whitespace-pre-wrap text-center text-sm text-error">
            {falla.texto}
            {falla.sinSaldo && (
              <>
                {' '}
                <Recarga />
              </>
            )}
          </p>
        )}
      </div>

      <Dialogo
        abierto={veredicto !== null}
        alCambiar={a => {
          if (!a) setVeredicto(null);
        }}
        titulo="Revisa tu texto"
        descripcion={veredicto?.mensaje ?? ''}
        focoAlCerrar={texto}
        acciones={
          <Boton
            nivel="principal"
            onClick={() => setVeredicto(null)}
          >
            Entendido, lo edito
          </Boton>
        }
      >
        {veredicto?.motivo ? <p className="m-0 text-sm text-secundario">{veredicto.motivo}</p> : null}
      </Dialogo>
    </Marco>
  );
}

function reduceMovimiento(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function Tarjeta({
  titulo,
  icono,
  className,
  children,
}: {
  titulo: string;
  icono: 'estilo' | 'pincel' | 'formato';
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={unir('flex min-w-0 flex-col rounded-grande border border-linea bg-superficie p-4', className)}>
      <h2 className="m-0 mb-3 flex items-center gap-2 font-titulo text-titulo-sm font-bold">
        <Icono nombre={icono} className="text-secundario" />
        {titulo}
      </h2>
      {children}
    </section>
  );
}

// elegir no es «hacer»: lo elegido se marca en blanco, no en ámbar
function Chip({
  puesto,
  disabled,
  onClick,
  children,
}: {
  puesto: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={puesto}
      disabled={disabled}
      onClick={onClick}
      className={unir(
        'min-h-11 cursor-pointer whitespace-nowrap rounded-medio border px-3.5 text-left text-sm disabled:cursor-default',
        puesto ? 'border-texto bg-elevada text-texto' : 'border-campo bg-transparent text-secundario hover:border-secundario hover:text-texto',
      )}
    >
      {children}
    </button>
  );
}

function Muestra({ estilo, descripcion, children }: { estilo: string; descripcion: string; children?: ReactNode }) {
  // la foto tapa la descripción solo cuando llegó; si no existe, queda el texto
  const [lista, setLista] = useState<string | null>(null);
  const [rota, setRota] = useState<string | null>(null);
  const conFoto = estilo !== 'custom' && rota !== estilo;
  return (
    <div className="relative grid min-h-[200px] flex-1 place-items-center overflow-hidden rounded-medio border border-linea p-3">
      <p className="m-0 text-center text-xs text-secundario">{descripcion}</p>
      {conFoto && (
        <img
          key={estilo}
          src={`/estilos/${estilo}.jpg`}
          alt="Ejemplo del estilo elegido"
          onLoad={() => setLista(estilo)}
          onError={() => setRota(estilo)}
          className={unir('absolute inset-0 size-full object-cover', lista !== estilo && 'invisible')}
        />
      )}
      {children}
    </div>
  );
}
