// /estudio/clip/ — el clip de 8 segundos (UI·8.1). Primera pantalla migrada
// con usuarios reales: cobra una sola cosa, «Generar ✦ N».
// Paridad con static/clip.html: mismas llamadas, mismo precio (del server),
// mismas validaciones. Qué pasó con cada aserción vieja: docs/migracion/clip.md.
//
// UI·26: el historial «Tus clips» se fue a «Mis videos» del inicio. Aquí
// solo se ve el que se genera, el que acaba de terminar y el que se abrió
// desde el inicio con `?c=`.
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { BotonCobro } from '../../marca/BotonCobro';
import { avanceEspera, EsperaPasos, reloj, textoLlevas, useLlevas } from '../../marca/EsperaPasos';
import { Marco } from '../../marca/Marco';
import { NotaSaldo } from '../../marca/NotaSaldo';
import { Recarga } from '../../marca/Recarga';
import { refrescarSaldo, useSaldo } from '../../marca/useSaldo';
import { ErrorApi, recuperarApartado } from '../../nucleo/api';
import { creditos } from '../../nucleo/formato';
import { nombreVT } from '../../nucleo/transiciones';
import { useNuevos } from '../../nucleo/useListaViva';
import { useLlegada } from '../../nucleo/useLlegada';
import { useSondeo } from '../../nucleo/useSondeo';
import { Aviso } from '../../ui/Aviso';
import { Boton } from '../../ui/Boton';
import { FilaViva } from '../../ui/FilaViva';
import { Icono } from '../../ui/Icono';
import { Tarjeta } from '../../ui/Tarjeta';
import { unir } from '../../ui/unir';
import {
  aLaVista,
  cargarClip,
  cargarClips,
  cargarConfig,
  clipPedido,
  costo,
  detalleClip,
  ESTIMADO_CLIP_MS,
  firmar,
  generando,
  generar,
  notaPrecio,
  PASOS_CLIP,
  subirDirecto,
  tipoDe,
  tomarBrief,
  type Clip as FichaClip,
  type Config,
  type Formato,
} from './logica';

interface Foto {
  id: number;
  subiendo: boolean;
  key?: string;
  url?: string;
}

const TITULO = 'Estudio de video · Clip de 8 segundos';

function textoInicial(): string {
  // lo que quedó apartado si la sesión venció a mitad de «Generar»
  const apartado = recuperarApartado('clip-generar');
  const cuerpo = apartado?.cuerpo as { texto?: unknown } | undefined;
  if (typeof cuerpo?.texto === 'string') return cuerpo.texto;
  return tomarBrief();
}

const CLAVES = (l: FichaClip[]) => l.map(c => c.id);

export function Clip() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [clips, setClips] = useState<FichaClip[] | null>(null);
  const [falloCarga, setFalloCarga] = useState(false);
  // UI·21: el clip que acaba de pedirse entra abriendo su espacio. La lista
  // vacía que deja un fallo de carga no cuenta como vista: la primera carga
  // buena después de él tampoco anima
  const nuevos = useNuevos(falloCarga && clips?.length === 0 ? null : clips, CLAVES);
  const [texto, setTexto] = useState(textoInicial);
  const [formato, setFormato] = useState<Formato>('horizontal');
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [errorFoto, setErrorFoto] = useState('');
  const [estado, setEstado] = useState<{ texto: string; error: boolean; sinSaldo?: boolean } | null>(null);
  // tras generar, el botón espera a que ese clip termine (como la vieja)
  const [esperando, setEsperando] = useState(false);
  // UI·26: el abierto desde «Mis videos» y los que se generaron con la
  // pantalla abierta; el resto de los clips vive en el inicio
  const [abierto] = useState(() => clipPedido());
  const [vistos, setVistos] = useState<ReadonlySet<string>>(() => new Set());
  // el abierto que ya no viene en la lista (el servidor lista los más nuevos)
  const [suelto, setSuelto] = useState<FichaClip | null>(null);
  const saldo = useSaldo();
  const archivo = useRef<HTMLInputElement>(null);
  const siguienteId = useRef(0);
  const idTexto = useId();

  const recordar = useCallback((ids: string[]) => {
    setVistos(v => (ids.every(id => v.has(id)) ? v : new Set([...v, ...ids])));
  }, []);

  const aplicar = useCallback((lista: FichaClip[]): boolean => {
    setClips(lista);
    setFalloCarga(false);
    recordar(generando(lista).map(c => c.id));
    const vivos = generando(lista).length > 0;
    if (!vivos) {
      setEsperando(false);
      refrescarSaldo();
    }
    return !vivos;
  }, [recordar]);

  const fallar = useCallback(() => {
    setFalloCarga(true);
    setClips(c => c ?? []);
  }, []);

  // la tarea del sondeo: true = ya no hay nada generándose
  const traer = useCallback(
    () =>
      cargarClips().then(aplicar, (e: unknown) => {
        fallar();
        throw e;
      }),
    [aplicar, fallar],
  );

  useEffect(() => {
    let vigente = true;
    cargarConfig().then(c => vigente && setCfg(c), () => undefined);
    cargarClips().then(l => vigente && aplicar(l), () => vigente && fallar());
    window.orbe?.precargar();
    return () => {
      vigente = false;
    };
  }, [aplicar, fallar]);

  const hayVivos = clips !== null && generando(clips).length > 0;
  // mientras algo se genera (o la lista no se pudo traer) se pregunta con la
  // escalera 5-5-5-10-10-20 s y nada con la pestaña oculta
  useSondeo(hayVivos || falloCarga, traer);

  const vivos = clips ? generando(clips) : [];
  const faltaAbierto = abierto !== null && clips !== null && !falloCarga && !clips.some(c => c.id === abierto);
  useEffect(() => {
    if (!faltaAbierto) return;
    let vigente = true;
    cargarClip(abierto).then(c => vigente && setSuelto(c), () => undefined);
    return () => {
      vigente = false;
    };
  }, [faltaAbierto, abierto]);
  const visibles = [
    ...(clips ? aLaVista(clips, vistos, abierto) : []),
    ...(faltaAbierto && suelto ? [suelto] : []),
  ];
  useEffect(() => {
    document.title = vivos.length ? `Generando tu clip · ${TITULO}` : TITULO;
  }, [vivos.length]);

  const tope = cfg?.max_imagenes ?? 3;
  const listas = fotos.filter(f => !f.subiendo);
  const precio = cfg ? costo(cfg, fotos.length) : null;

  async function alElegirFoto(archivoElegido: File | undefined) {
    if (!archivoElegido) return;
    setErrorFoto('');
    if (cfg && archivoElegido.size > cfg.max_bytes) {
      setErrorFoto('Esa foto pesa demasiado (máximo 20 MB).');
      return;
    }
    const id = siguienteId.current++;
    setFotos(f => [...f, { id, subiendo: true }]);
    try {
      const firma = await firmar(archivoElegido, tipoDe(archivoElegido));
      await subirDirecto(firma, archivoElegido);
      const url = URL.createObjectURL(archivoElegido);
      setFotos(f => f.map(x => (x.id === id ? { id, subiendo: false, key: firma.key, url } : x)));
    } catch (e) {
      setFotos(f => f.filter(x => x.id !== id));
      setErrorFoto(e instanceof Error ? e.message : 'No se pudo subir la foto — inténtalo otra vez.');
    }
  }

  function quitarFoto(id: number) {
    setFotos(f => {
      const fuera = f.find(x => x.id === id);
      if (fuera?.url) URL.revokeObjectURL(fuera.url);
      return f.filter(x => x.id !== id);
    });
  }

  async function alGenerar(cobrado?: () => void) {
    const limpio = texto.trim();
    if (!limpio) {
      setEstado({ texto: 'Escribe qué quieres ver primero.', error: false });
      return;
    }
    if (fotos.some(f => f.subiendo)) {
      setEstado({ texto: 'Espera a que terminen de subir tus fotos.', error: false });
      return;
    }
    setEstado(null);
    try {
      const r = await generar(limpio, formato, listas.map(f => f.key!));
      recordar([r.id]);
      setTexto('');
      fotos.forEach(f => f.url && URL.revokeObjectURL(f.url));
      setFotos([]);
      setEsperando(true);
      cobrado?.(); // antes de releer: el «−N» va con el saldo
      refrescarSaldo();
      await traer().catch(() => undefined);
      return true; // UI·19: se cobró
    } catch (e) {
      const sinSaldo = e instanceof ErrorApi && e.sinSaldo;
      setEstado({ texto: e instanceof Error ? e.message : String(e), error: true, sinSaldo });
    }
  }

  return (
    <Marco
      pantalla="clip"
      titulo="Clip de 8 segundos"
      bajada={
        <p className="m-0 text-md">
          Escribe qué quieres ver y te lo entregamos en un video corto <b>con sonido</b>. Sin guion, sin escenas y sin
          pantalla de revisión: es una sola toma. Si subes fotos, salen en el video; si no subes ninguna, se inventa la
          imagen.
        </p>
      }
    >
      <div className="max-w-[860px]">
        {cfg && !cfg.activo && (
          <div className="mb-6">
            <Aviso>El clip de 8 segundos corre en el servicio: aquí no se puede generar.</Aviso>
          </div>
        )}
        <section className="mb-6 rounded-grande border border-linea bg-superficie p-6">
          <h2 className="m-0 mb-3 flex items-center gap-2 text-titulo-sm font-bold">
            <Icono nombre="idea" className="text-secundario" />
            <label htmlFor={idTexto}>Qué quieres ver</label>
          </h2>
          <textarea
            id={idTexto}
            maxLength={2000}
            value={texto}
            onChange={e => setTexto(e.target.value)}
            placeholder="Mi perro corriendo en la playa al atardecer, con la cámara siguiéndolo"
            className="min-h-22 w-full resize-y rounded-medio border border-campo bg-elevada p-3 text-sm text-texto"
          />

          <ul className="m-0 my-3 flex list-none flex-wrap gap-3 p-0" aria-label="Tus fotos">
            {fotos.map(f =>
              f.subiendo ? (
                <li
                  key={f.id}
                  className="flex size-23 items-center justify-center rounded-medio border border-linea bg-elevada text-xs text-secundario"
                >
                  <span role="status">Subiendo…</span>
                </li>
              ) : (
                <li key={f.id} className="relative size-23 overflow-hidden rounded-medio border border-linea bg-elevada">
                  <img src={f.url} alt="" className="block size-full object-cover" />
                  <button
                    type="button"
                    aria-label="Quitar foto"
                    title="Quitar"
                    onClick={() => quitarFoto(f.id)}
                    className="group absolute top-0 right-0 grid size-11 cursor-pointer place-items-center border-0 bg-transparent p-0 text-texto"
                  >
                    <span className="grid size-6 place-items-center rounded-pildora border border-linea bg-hundido group-hover:border-secundario">
                      <Icono nombre="cerrar" className="size-4" />
                    </span>
                  </button>
                </li>
              ),
            )}
            {fotos.length < tope && (
              <li>
                <button
                  type="button"
                  aria-label={`Agregar foto (${fotos.length} de ${tope})`}
                  onClick={() => archivo.current?.click()}
                  className="flex size-23 cursor-pointer flex-col items-center justify-center gap-1 rounded-medio border border-dashed border-campo bg-elevada text-xs text-texto hover:border-secundario"
                >
                  <Icono nombre="mas" className="text-secundario" />
                  <span>Foto</span>
                  <span className="text-secundario">
                    {fotos.length} de {tope}
                  </span>
                </button>
              </li>
            )}
          </ul>
          <input
            ref={archivo}
            type="file"
            accept="image/*,.heic,.heif"
            hidden
            data-testid="archivo"
            onChange={e => {
              const f = e.target.files?.[0];
              e.target.value = '';
              void alElegirFoto(f);
            }}
          />
          {errorFoto && <p className="m-0 text-sm text-error">{errorFoto}</p>}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div role="group" aria-label="Formato" className="inline-flex gap-2">
              {(['horizontal', 'vertical'] as const).map(f => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={formato === f}
                  onClick={() => setFormato(f)}
                  className={unir(
                    'min-h-11 cursor-pointer rounded-medio border bg-transparent px-4 text-sm transition-colors',
                    formato === f
                      ? 'border-texto bg-elevada text-texto'
                      : 'border-campo text-secundario hover:border-secundario hover:text-texto',
                  )}
                >
                  {f === 'horizontal' ? 'Horizontal' : 'Vertical'}
                </button>
              ))}
            </div>
            {precio !== null && cfg && (
              <>
                <BotonCobro
                  verbo="Generar"
                  costo={precio}
                  saldo={saldo}
                  trabajando="Generando…"
                  deshabilitado={esperando || !cfg.activo}
                  alCobrar={alGenerar}
                />
                <span className="text-xs text-secundario">{notaPrecio(cfg, fotos.length)}</span>
              </>
            )}
          </div>
          {precio !== null && <div className="mt-2"><NotaSaldo saldo={saldo} costo={precio} /></div>}
          {estado && (
            <p className={unir('mt-2 mb-0 text-sm', estado.error ? 'text-error' : 'text-secundario')} role={estado.error ? 'alert' : 'status'}>
              {estado.texto}
              {estado.sinSaldo && (
                <>
                  {' '}
                  <Recarga />
                </>
              )}
            </p>
          )}
        </section>

        {(visibles.length > 0 || falloCarga) && (
          <Tarjeta className="mb-4">
            <h2 className="m-0 mb-3 flex items-center gap-2 text-titulo-sm font-bold">
              <Icono nombre="video" className="text-secundario" />
              {visibles.length > 1 ? 'Tus clips' : 'Tu clip'}
            </h2>
            {falloCarga && (
              <div className="mb-3">
                <Aviso tipo="error">
                  No pudimos traer tus clips. Lo volvemos a intentar en unos segundos.{' '}
                  <Boton nivel="enlace" onClick={() => void traer().catch(() => undefined)}>
                    Reintentar
                  </Boton>
                </Aviso>
              </div>
            )}
            {visibles.map(c => (
              <FilaViva key={c.id} nombre={nombreVT('clip', c.id)} nueva={nuevos.has(c.id)}>
                <TarjetaClip clip={c} conOrbe={vivos.length === 1} />
              </FilaViva>
            ))}
          </Tarjeta>
        )}
        <p className="m-0 text-sm text-secundario">
          Todos tus clips se guardan en{' '}
          <a href="/estudio/" className="text-enlace underline underline-offset-4 hover:text-texto">
            «Mis videos»
          </a>{' '}
          del inicio.
        </p>
      </div>
    </Marco>
  );
}

const AGOTADO_CLIP =
  'Llevamos un rato sin novedades. El clip sigue en la nube: puedes cerrar la página y volver. Si sigue igual, escríbenos.';

// UI·27: la misma espera que crear (marca/EsperaPasos). Solo el primero que se
// genera lleva el orbe (hay uno por página); los demás, su reloj en una línea.
function EsperaClip({ inicio }: { inicio: string | null | undefined }) {
  const llevas = useLlevas(inicio);
  return (
    <EsperaPasos
      plano
      className="mt-3"
      pasos={PASOS_CLIP}
      paso={1}
      pct={avanceEspera(1, PASOS_CLIP.length, llevas, ESTIMADO_CLIP_MS)}
      tiempo={textoLlevas(llevas, '1–2 min')}
      orbe={{ texto: 'Generando tu clip · 1-2 min', tope: 600000, textoAlAgotar: AGOTADO_CLIP }}
      cerrar="Puedes cerrar esta pestaña: el clip sigue en la nube y aquí lo encuentras al volver."
    />
  );
}

function EsperaCorta({ inicio }: { inicio: string | null | undefined }) {
  const llevas = useLlevas(inicio);
  return (
    <p role="status" className="m-0 min-h-10 text-xs text-secundario">
      Generando tu clip…{llevas != null ? ' · llevas ' + reloj(llevas) : ''}
    </p>
  );
}

function TarjetaClip({ clip: c, conOrbe }: { clip: FichaClip; conOrbe: boolean }) {
  // UI·21: al quedar listo (con la pantalla abierta) su detalle se enciende
  const [encendido, apagar] = useLlegada(c.estado !== 'generando' && c.estado !== 'error');
  return (
    <article className="mb-4 rounded-grande border border-linea p-4">
      <p className="m-0 mb-1 text-sm [overflow-wrap:anywhere]">{c.texto}</p>
      {c.estado === 'generando' && (conOrbe ? <EsperaClip inicio={c.inicio} /> : <EsperaCorta inicio={c.inicio} />)}
      {c.estado === 'error' && (
        <>
          <p className="m-0 text-sm text-error">{c.error || 'No se pudo generar.'}</p>
          <p className="m-0 text-xs text-secundario">Los créditos volvieron a tu saldo.</p>
        </>
      )}
      {c.estado !== 'generando' && c.estado !== 'error' && (
        <>
          <p className={unir('m-0 text-xs text-secundario', encendido && 'destello')} onAnimationEnd={apagar}>
            {detalleClip(c)} · {creditos(c.creditos)}
          </p>
          {c.recorte && (
            <div className="mt-1">
              <Aviso>{c.recorte}</Aviso>
            </div>
          )}
          {c.video && (
            <video src={c.video} controls preload="metadata" className="mt-3 w-full rounded-medio bg-hundido">
              <track kind="captions" />
            </video>
          )}
        </>
      )}
    </article>
  );
}
