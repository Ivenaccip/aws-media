// 1 · Configurar la película (M23 · V): estilo, el cuadro de texto con las
// imágenes del personaje, formato y duración, y «Generar ✦ N».
//
// Lo que se cuida del dinero:
//   · el botón dice lo que se cobra al tocarlo (el guion, video.preparar); el
//     total de la duración elegida vive junto al temporizador;
//   · el candado es el de <BotonCobro>: un doble clic es UNA película;
//   · el pedido se arma ANTES de moderar, y mientras vuela la cuadrícula
//     entera queda inerte: ni el precio ni las imágenes cambian a medias;
//   · el 409 del balanceador pregunta con <Confirmar> antes de forzar.
import { useEffect, useId, useRef, useState } from 'react';

import { BotonCobro } from '../../marca/BotonCobro';
import { EsperaIA } from '../../marca/EsperaIA';
import { Recarga } from '../../marca/Recarga';
import { refrescarSaldo, useSaldo } from '../../marca/useSaldo';
import { ErrorApi } from '../../nucleo/api';
import { ESTRELLA } from '../../nucleo/estrella';
import { moderar } from '../../nucleo/moderar';
import { Boton } from '../../ui/Boton';
import { Confirmar } from '../../ui/Confirmar';
import { Dialogo } from '../../ui/Dialogo';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import {
  armarForm,
  avisoFuera,
  avisoSaldo,
  cargarEstilos,
  cercana,
  choqueDe,
  crearProyecto,
  DURACION_INICIAL,
  DURACIONES,
  duracionEnPalabras,
  MAX_BRIEF,
  MAX_REFS,
  mensaje,
  MODONOTAS,
  moverDuracion,
  mss,
  notaCobro,
  PREPARAR,
  precioDe,
  sumarArchivos,
  type Estilo,
  type Formato,
  type Modo,
  type Pedido,
  type Proyecto,
} from './logica';
import { Chip, Muestra, Tarjeta } from './Piezas';

export const TOPE_MS = 180000; // red para la promesa que nunca resuelve, no plazo del trabajo
export const TARDA = 'Esto está tardando más de lo normal. ';

export interface Inicial {
  brief: string;
  modo: Modo;
  pipeline: string | null;
}

interface Falla {
  texto: string;
  sinSaldo?: boolean;
}

export function Formulario({ inicial, alCrear }: { inicial: Inicial; alCrear: (p: Proyecto) => void }) {
  const saldo = useSaldo();
  const [estilos, setEstilos] = useState<Estilo[] | null>(null);
  const [sinEstilos, setSinEstilos] = useState(false);
  const [estilo, setEstilo] = useState('animated');
  const [estiloCustom, setEstiloCustom] = useState('');
  const [brief, setBrief] = useState(inicial.brief.slice(0, MAX_BRIEF));
  const [modo, setModo] = useState<Modo>(inicial.modo);
  const [rubro, setRubro] = useState('');
  const [extra, setExtra] = useState('');
  const [formato, setFormato] = useState<Formato>('horizontal');
  const [dur, setDur] = useState(() => cercana(DURACION_INICIAL));
  const [adjuntos, setAdjuntos] = useState<{ archivo: File; url: string }[]>([]);
  const [soltando, setSoltando] = useState(false);
  const [enVuelo, setEnVuelo] = useState(false);
  const [espera, setEspera] = useState<string | null>(null);
  const [falla, setFalla] = useState<Falla | null>(null);
  const [veredicto, setVeredicto] = useState<{ mensaje: string; motivo: string } | null>(null);
  const [balanceador, setBalanceador] = useState<string | null>(null);
  const texto = useRef<HTMLTextAreaElement>(null);
  const custom = useRef<HTMLTextAreaElement>(null);
  const elegir = useRef<HTMLInputElement>(null);
  const pedido = useRef<Pedido | null>(null);
  const idRubro = useId();
  const idExtra = useId();

  // una vez, aunque StrictMode monte dos veces
  const arrancado = useRef(false);
  useEffect(() => {
    if (arrancado.current) return;
    arrancado.current = true;
    cargarEstilos().then(
      l => setEstilos(Array.isArray(l) ? l : []),
      () => setSinEstilos(true),
    );
  }, []);

  // las miniaturas: una blob: URL por archivo, que vive mientras siga adjunto
  function agregar(lista: FileList | File[]) {
    if (vivo.current.enVuelo) return;
    const ya = vivo.current.adjuntos;
    const { lista: nueva, fuera } = sumarArchivos(ya.map(a => a.archivo), [...lista]);
    if (nueva.length === ya.length && !fuera) return; // nada que sea imagen
    const siguen = ya.concat(nueva.slice(ya.length).map(archivo => ({ archivo, url: URL.createObjectURL(archivo) })));
    vivo.current.adjuntos = siguen;
    setAdjuntos(siguen);
    setFalla(fuera > 0 ? { texto: avisoFuera(fuera) } : null);
  }

  function quitar(i: number, boton: HTMLButtonElement) {
    if (enVuelo) return;
    const fuera = adjuntos[i];
    if (fuera) URL.revokeObjectURL(fuera.url);
    const siguen = adjuntos.filter((_, k) => k !== i);
    vivo.current.adjuntos = siguen;
    setAdjuntos(siguen);
    setFalla(null);
    // el foco no se pierde: a la miniatura que queda o al texto
    const lista = boton.closest('[data-miniaturas]');
    requestAnimationFrame(() => {
      const otro = lista?.querySelector<HTMLButtonElement>('button');
      (otro ?? texto.current)?.focus();
    });
  }

  // arrastrar una imagen al cuadro, o pegarla. Van como oyentes nativos: el
  // cuadro no es un control, solo recibe lo que le sueltan
  const cuadro = useRef<HTMLElement>(null);
  const vivo = useRef({ enVuelo, adjuntos, agregar });
  useEffect(() => {
    vivo.current = { enVuelo, adjuntos, agregar };
  });
  // al irse, las blob: URL que queden se sueltan
  useEffect(() => () => vivo.current.adjuntos.forEach(a => URL.revokeObjectURL(a.url)), []);
  useEffect(() => {
    const el = cuadro.current;
    if (!el) return;
    const sobre = (e: DragEvent) => {
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      setSoltando(true);
    };
    const sale = (e: DragEvent) => {
      if (!el.contains(e.relatedTarget as Node | null)) setSoltando(false);
    };
    const suelta = (e: DragEvent) => {
      setSoltando(false);
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      vivo.current.agregar(e.dataTransfer.files);
    };
    // si el portapapeles trae texto, gana el texto: copiar de Excel también
    // lleva un dibujo de la tabla
    const pega = (e: ClipboardEvent) => {
      const d = e.clipboardData;
      if (!d || d.types.includes('text/plain') || !d.files.length) return;
      e.preventDefault();
      vivo.current.agregar(d.files);
    };
    el.addEventListener('dragover', sobre);
    el.addEventListener('dragleave', sale);
    el.addEventListener('drop', suelta);
    el.addEventListener('paste', pega);
    return () => {
      el.removeEventListener('dragover', sobre);
      el.removeEventListener('dragleave', sale);
      el.removeEventListener('drop', suelta);
      el.removeEventListener('paste', pega);
    };
  }, []);

  function fijarModo(m: Modo) {
    setModo(actual => (actual === m ? 'auto' : m)); // segundo clic = soltar
  }

  // ── enviar (el candado lo pone BotonCobro, antes de cualquier await)
  async function enviar(forzar = false) {
    if (enVuelo) return;
    setFalla(null);
    if (!forzar) {
      if (!brief.trim()) {
        setFalla({ texto: 'Describe tu video primero.' });
        texto.current?.focus();
        return;
      }
      // el pedido se arma ANTES de moderar: se manda lo que se veía al pulsar
      pedido.current = {
        brief, estilo, estilo_custom: estiloCustom, duracion_s: dur, modo, rubro,
        personaje_extra: extra, formato, pipeline: inicial.pipeline, referencias: adjuntos.map(a => a.archivo),
      };
    }
    const p = pedido.current;
    if (!p) return;
    setEnVuelo(true);
    setEspera(forzar ? 'Preparando tu película…' : 'Revisando tu texto…'); // el hueco mudo del guardarraíl
    try {
      // M13: guardarraíl ANTES de mandar (y de cobrar); forzar ya pasó una vez
      if (!forzar) {
        const v = await moderar(p.brief + '\n' + p.personaje_extra);
        if (!v.permitido) {
          setVeredicto({ mensaje: v.mensaje, motivo: v.motivo });
          return;
        }
      }
      setEspera('Preparando tu película…');
      const nuevo = await crearProyecto(armarForm(p, forzar));
      setEspera(null); // el orbe se va antes de lo que sigue
      refrescarSaldo();
      alCrear(nuevo);
    } catch (e) {
      setEspera(null); // NUNCA un orbe girando junto a un error
      if (e instanceof ErrorApi && e.estado === 409) {
        const c = choqueDe(e.detalle);
        // sin espacio: forzar no aplica, hay que archivar primero
        if (c.slots) setFalla({ texto: c.aviso });
        else setBalanceador(c.balanceador);
      } else {
        setFalla({ texto: mensaje(e), sinSaldo: e instanceof ErrorApi && e.sinSaldo });
      }
    } finally {
      setEspera(null);
      setEnVuelo(false);
    }
  }

  const total = precioDe(dur);
  const i = DURACIONES.indexOf(dur);
  const max = DURACIONES[DURACIONES.length - 1]!;
  const nota = notaCobro(dur);
  const alcanza = avisoSaldo(saldo, dur);
  const descripcion = estilos?.find(e => e.id === estilo)?.descripcion ?? '';

  function teclaReloj(e: React.KeyboardEvent) {
    const pasos = ({ ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, Home: -99, End: 99 } as Record<string, number>)[e.key];
    if (!pasos) return;
    e.preventDefault();
    setDur(d => moverDuracion(d, pasos));
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3" inert={enVuelo}>
        <Tarjeta titulo="Estilo visual" icono="estilo">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
            <div role="radiogroup" aria-label="Estilo visual" className="flex flex-wrap gap-2 sm:flex-col sm:flex-nowrap">
              {(estilos ?? []).map(e => (
                <Chip
                  key={e.id}
                  rol="radio"
                  puesto={estilo === e.id}
                  onClick={() => {
                    setEstilo(e.id);
                    if (e.id === 'custom') requestAnimationFrame(() => custom.current?.focus());
                  }}
                >
                  {e.nombre}
                </Chip>
              ))}
              {!estilos && !sinEstilos && <span className="text-xs text-secundario">Cargando estilos…</span>}
            </div>
            <Muestra estilo={estilo} descripcion={descripcion}>
              {sinEstilos && (
                // sin la lista no hay botones: que se sepa con qué estilo sale
                <p className="m-0 text-center text-xs text-secundario">
                  No pudimos cargar los estilos. Tu video saldrá en Animado; recarga la página para elegir otro.
                </p>
              )}
              {estilo === 'custom' && (
                <textarea
                  ref={custom}
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
        </Tarjeta>

        {/* Un solo cuadro: la imagen del personaje arriba cuando la hay, el
            texto debajo y el «+» abajo a la izquierda. */}
        <section
          ref={cuadro}
          aria-label="Tu video"
          className={unir(
            'flex min-w-0 flex-col gap-2.5 rounded-grande border bg-superficie p-4 md:col-span-2',
            soltando ? 'border-dashed border-texto' : 'border-linea focus-within:border-campo',
          )}
        >
          {adjuntos.length > 0 && (
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex flex-wrap gap-2" data-miniaturas>
                {adjuntos.map(({ archivo: f, url }, k) => (
                  <div key={url} className="relative size-[88px] overflow-hidden rounded-medio border border-linea bg-elevada">
                    <img src={url} alt={'Imagen ' + (k + 1) + ' de tu personaje'} className="block size-full object-cover" />
                    <button
                      type="button"
                      aria-label={'Quitar ' + f.name}
                      title="Quitar"
                      onClick={e => quitar(k, e.currentTarget)}
                      className="absolute right-1 top-1 grid size-6 cursor-pointer place-items-center rounded-full border border-linea bg-hundido/85 p-0 text-texto hover:border-secundario"
                    >
                      <Icono nombre="cerrar" className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
              <label htmlFor={idExtra} className="sr-only">
                Detalles del personaje (opcional)
              </label>
              <input
                id={idExtra}
                type="text"
                value={extra}
                onChange={e => setExtra(e.target.value)}
                maxLength={500}
                placeholder="Detalles del personaje (opcional), p. ej. «siempre lleva sombrero»"
                className="min-h-11 min-w-[200px] flex-1 rounded-medio border border-campo bg-elevada px-3 text-xs text-texto"
              />
            </div>
          )}
          <textarea
            ref={texto}
            value={brief}
            onChange={e => setBrief(e.target.value)}
            maxLength={MAX_BRIEF}
            aria-label="De qué trata tu video"
            placeholder="Describe tu video…"
            className="min-h-[120px] flex-1 resize-none border-0 bg-transparent px-0.5 py-1 text-md text-texto outline-none"
          />
          {modo !== 'auto' && <p className="m-0 text-xs text-secundario">{MODONOTAS[modo]}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label="Subir la imagen de tu personaje"
              title={'Sube la imagen de tu personaje (hasta ' + MAX_REFS + '). Te damos 2 versiones en el estilo elegido.'}
              disabled={adjuntos.length >= MAX_REFS}
              onClick={() => elegir.current?.click()}
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-campo bg-transparent p-0 text-texto hover:enabled:border-secundario hover:enabled:bg-elevada disabled:cursor-default disabled:opacity-40"
            >
              <Icono nombre="mas" />
            </button>
            <input
              ref={elegir}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={e => {
                if (e.target.files) agregar(e.target.files);
                e.target.value = '';
              }}
            />
            {/* sin ninguno marcado = detectamos solos si es historia o idea */}
            <div role="group" aria-label="Cómo lo trabajamos" className="flex gap-1.5">
              <Chip puesto={modo === 'investigacion'} onClick={() => fijarModo('investigacion')}>
                Investigación
              </Chip>
              <Chip puesto={modo === 'idea'} onClick={() => fijarModo('idea')}>
                Tengo una idea
              </Chip>
            </div>
            <label htmlFor={idRubro} className="sr-only">
              Rubro de tu canal (opcional)
            </label>
            <input
              id={idRubro}
              type="text"
              value={rubro}
              onChange={e => setRubro(e.target.value)}
              placeholder="Rubro de tu canal (opcional)"
              title="P. ej. «tecnología». Validamos que el tema coincida antes de gastar."
              className="ml-auto min-h-11 min-w-[150px] max-w-[240px] flex-1 rounded-medio border border-campo bg-elevada px-3 text-xs text-texto"
            />
            <span className="text-xs tabular-nums text-secundario" aria-label={brief.length + ' de ' + MAX_BRIEF + ' caracteres'}>
              {brief.length}/{MAX_BRIEF}
            </span>
          </div>
        </section>

        <Tarjeta titulo="Formato" icono="formato" className="md:col-span-2">
          <div role="radiogroup" aria-label="Formato del video" className="grid flex-1 grid-cols-2 gap-3">
            {(
              [
                ['horizontal', 'Horizontal', 'YouTube · 16:9', 'h-[23px] w-10'],
                ['vertical', 'Vertical', 'Reels · TikTok · Shorts · 9:16', 'h-10 w-[23px]'],
              ] as const
            ).map(([id, nombre, sub, forma]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={formato === id}
                onClick={() => setFormato(id)}
                className={unir(
                  'flex min-w-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-medio border p-3 text-center',
                  formato === id ? 'border-texto bg-elevada text-texto' : 'border-campo bg-transparent text-secundario hover:border-secundario',
                )}
              >
                <span className="mb-1.5 flex h-10 items-center" aria-hidden="true">
                  <span className={unir('block rounded-[3px] border-2 border-current opacity-75', forma)} />
                </span>
                <b>{nombre}</b>
                <span className="text-xs text-secundario">{sub}</span>
              </button>
            ))}
          </div>
          <p className="m-0 mt-2 text-xs text-secundario">Se elige ahora y no se puede cambiar después.</p>
        </Tarjeta>

        <Tarjeta titulo="Duración" icono="reloj">
          <div className="flex flex-1 items-center justify-center gap-3.5">
            <button
              type="button"
              aria-label="Quitar 5 segundos"
              disabled={i <= 0}
              onClick={() => setDur(d => moverDuracion(d, -1))}
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-campo bg-elevada p-0 text-texto hover:enabled:border-secundario disabled:cursor-default disabled:opacity-35"
            >
              <Icono nombre="menos" />
            </button>
            <div
              role="spinbutton"
              tabIndex={0}
              aria-label="Duración del video"
              aria-valuemin={DURACIONES[0]}
              aria-valuemax={max}
              aria-valuenow={dur}
              aria-valuetext={duracionEnPalabras(dur)}
              onKeyDown={teclaReloj}
              className="relative size-[100px] shrink-0 rounded-full"
            >
              <svg viewBox="0 0 120 120" aria-hidden="true" className="block size-full">
                <circle cx="60" cy="60" r="52" fill="none" strokeWidth="8" className="stroke-linea" />
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  pathLength={100}
                  fill="none"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={((dur / max) * 100).toFixed(2) + ' 100'}
                  transform="rotate(-90 60 60)"
                  className="stroke-ambar transition-[stroke-dasharray] duration-200 motion-reduce:transition-none"
                />
              </svg>
              <span className="absolute inset-0 grid place-items-center font-titulo text-titulo-md font-semibold tabular-nums">
                {mss(dur)}
              </span>
            </div>
            <button
              type="button"
              aria-label="Sumar 5 segundos"
              disabled={i >= DURACIONES.length - 1}
              onClick={() => setDur(d => moverDuracion(d, 1))}
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-campo bg-elevada p-0 text-texto hover:enabled:border-secundario disabled:cursor-default disabled:opacity-35"
            >
              <Icono nombre="mas" />
            </button>
          </div>
          {total != null && (
            <p className="m-0 mt-2.5 text-center text-sm text-secundario">
              Película de {mss(dur)}:{' '}
              <b className="tabular-nums text-texto">
                {ESTRELLA} {total} en total
              </b>
            </p>
          )}
        </Tarjeta>
      </div>

      <div className="mt-4 flex flex-col items-center gap-2 text-center">
        <BotonCobro
          verbo="Generar"
          costo={PREPARAR}
          saldo={saldo}
          trabajando="Preparando…"
          deshabilitado={enVuelo}
          alCobrar={() => enviar()}
        />
        {espera && <EsperaIA texto={espera} tope={TOPE_MS} textoAlAgotar={TARDA + 'Si no arranca tu película, inténtalo otra vez; si te descontaron créditos, escríbenos.'} />}
        {alcanza && <p className="m-0 text-xs text-secundario">{alcanza}</p>}
        {falla && (
          <p role="alert" className="m-0 max-w-[65ch] whitespace-pre-wrap text-sm text-error">
            {falla.texto}
            {falla.sinSaldo && (
              <>
                {' '}
                <Recarga />
              </>
            )}
          </p>
        )}
        {nota && <p className="m-0 max-w-[65ch] text-xs text-secundario">{nota}</p>}
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
          <Boton nivel="principal" onClick={() => setVeredicto(null)}>
            Entendido, lo edito
          </Boton>
        }
      >
        {veredicto?.motivo ? <p className="m-0 text-sm text-secundario">{veredicto.motivo}</p> : null}
      </Dialogo>

      <Confirmar
        abierto={balanceador !== null}
        alCambiar={a => {
          if (!a) setBalanceador(null);
        }}
        titulo="¿Crear de todos modos?"
        descripcion={balanceador ?? ''}
        confirmar="Sí, crearla"
        cancelar="No, la cambio"
        alConfirmar={() => {
          setBalanceador(null);
          void enviar(true);
        }}
      />
    </>
  );
}
