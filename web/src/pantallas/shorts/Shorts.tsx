// /estudio/shorts/ — de un video largo a shorts (UI·8.5). Cobra TRES cosas:
// «Importar ✦ N» (traer de YouTube), «Analizar ✦ N» (transcript y
// candidatos) y «Renderizar ✦ N» (los shorts marcados). Cada una con su
// <BotonCobro>: el candado no lo toca el sondeo (la vieja volvía a encender
// Analizar en cada vuelta, también con el cobro en vuelo).
// Paridad con static/shorts.html: mismas llamadas, mismos precios (del
// server). Qué pasó con cada aserción vieja: docs/migracion/shorts.md.
import { useEffect, useId, useState } from 'react';

import { BotonCobro } from '../../marca/BotonCobro';
import { EsperaPasos, textoLlevas, useLlevas } from '../../marca/EsperaPasos';
import { Marco } from '../../marca/Marco';
import { NotaSaldo } from '../../marca/NotaSaldo';
import { Recarga } from '../../marca/Recarga';
import { SubirVideo } from '../../marca/SubirVideo';
import { refrescarSaldo, useSaldo } from '../../marca/useSaldo';
import { ErrorApi } from '../../nucleo/api';
import { cargarConfig } from '../../nucleo/subida';
import { useListaViva } from '../../nucleo/useListaViva';
import { useLlegada } from '../../nucleo/useLlegada';
import { useTituloPestana } from '../../nucleo/useTituloPestana';
import { Aviso } from '../../ui/Aviso';
import { Boton } from '../../ui/Boton';
import { Campo } from '../../ui/Campo';
import { FilaViva } from '../../ui/FilaViva';
import { Icono } from '../../ui/Icono';
import { Tarjeta } from '../../ui/Tarjeta';
import { unir } from '../../ui/unir';
import {
  analizar,
  cargar,
  cargarCosto,
  cargarProyectos,
  conP,
  cotizar,
  esLigaDeYoutube,
  ESTILOS,
  hrefSeguro,
  importar,
  keyDe,
  LIGA_INVALIDA,
  MAX_SHORTS,
  PASOS_SHORTS,
  minutos,
  PLATAFORMAS,
  plural,
  problemaDe,
  renderizar,
  TIPOS,
  urlDescarga,
  vivo,
  type Candidato,
  type Costo,
  type Cotizacion,
  type EdicionConMetraje,
  type EstadoShorts,
  type Proyecto,
} from './logica';

interface Nota {
  texto: string;
  error?: boolean;
  sinSaldo?: boolean;
}

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));
const notaDeError = (e: unknown): Nota => ({ texto: mensaje(e), error: true, sinSaldo: e instanceof ErrorApi && e.sinSaldo });

const AL_AGOTAR =
  'Llevamos un rato sin novedades. El análisis sigue en la nube: puedes cerrar la página y volver. Si sigue igual, escríbenos.';

function NotaLinea({ nota, className }: { nota: Nota | null; className?: string }) {
  if (!nota) return null;
  return (
    <p
      role={nota.error ? 'alert' : 'status'}
      className={unir('mb-0 text-sm', nota.error ? 'text-error' : 'text-secundario', className)}
    >
      {nota.texto}
      {nota.sinSaldo && (
        <>
          {' '}
          <Recarga />
        </>
      )}
    </p>
  );
}

/** Una espera que NO es la IA pensando (descargar, renderizar): sin orbe (M19). */
// UI·27: la espera de cada paso del camino (logica.ts, PASOS_SHORTS)
function EsperaShorts({
  paso,
  inicio,
  texto,
  suele,
  plano = false,
  className,
}: {
  paso: number;
  inicio: string | undefined;
  texto: string;
  suele?: string;
  plano?: boolean;
  className?: string;
}) {
  const llevas = useLlevas(inicio);
  // el orbe es «la IA piensa» (M19): solo el análisis. Traer el video y el
  // render (Remotion componiendo) dicen lo que pasa sin él
  const ia = paso === 1;
  return (
    <EsperaPasos
      plano={plano}
      {...(className ? { className } : {})}
      pasos={PASOS_SHORTS}
      paso={paso}
      tiempo={textoLlevas(llevas, suele)}
      {...(ia ? { orbe: { texto, tope: 1800000, textoAlAgotar: AL_AGOTAR } } : { estado: texto })}
      cerrar="Puedes cerrar esta pestaña: sigue en la nube y este enlace te trae de vuelta."
    />
  );
}

export function Shorts() {
  const [p, setP] = useState(() => new URLSearchParams(location.search).get('p') ?? '');
  const [conSubida, setConSubida] = useState(false);

  useEffect(() => {
    let vigente = true;
    // local sin S3: la sección de subir no aparece
    cargarConfig().then(
      c => vigente && setConSubida(c.activo),
      () => undefined,
    );
    window.orbe?.precargar();
    return () => {
      vigente = false;
    };
  }, []);

  const abrir = (nombre: string) => {
    history.replaceState(null, '', conP(nombre));
    setP(nombre);
  };

  return (
    <Marco
      pantalla="shorts"
      titulo={p ? `Shorts · ${p}` : 'Shorts'}
      bajada={
        <p className="m-0 text-md">
          Clips verticales 9:16 con captions animados. El análisis puntúa candidatos con el gancho, la coherencia y el
          payoff; tú eliges cuáles renderizar.
        </p>
      }
    >
      <div className="max-w-[900px]">
        {p ? (
          <ProyectoShorts key={p} p={p} alAbrir={abrir} />
        ) : (
          <>
            <Eleccion />
            {conSubida && (
              <SubirVideo
                titulo="Subir un video"
                descripcion="Sube tu .mp4 y la IA lo transcribe y te propone los mejores momentos, sin pasar por la página de edición."
                principal={false}
                sugerirNombre
                alSubir={nombre => abrir(nombre)}
              />
            )}
            <Importar principal alImportar={abrir} />
          </>
        )}
      </div>
    </Marco>
  );
}

// ---------------------------------------------------------------------------
// sin ?p=: de qué video sacamos los shorts (M14: antes vivía en e1)

function Eleccion() {
  const [lista, setLista] = useState<EdicionConMetraje[] | null>(null);
  const [fallo, setFallo] = useState(false);
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    let vigente = true;
    cargarProyectos().then(
      ps => {
        if (!vigente) return;
        setLista(ps);
        setFallo(false);
      },
      () => vigente && setFallo(true),
    );
    return () => {
      vigente = false;
    };
  }, [vuelta]);

  // un fallo de red NO es «no tienes videos»: eso sale solo con la lista bien y vacía (UI·16)
  if (fallo)
    return (
      <div className="mb-6">
        <Aviso tipo="error">
          No pudimos traer tus proyectos. Revisa tu conexión e inténtalo de nuevo.{' '}
          <Boton nivel="enlace" onClick={() => setVuelta(v => v + 1)}>
            Reintentar
          </Boton>
        </Aviso>
      </div>
    );
  if (lista === null) return <p className="mb-6 text-sm text-secundario">Cargando tus proyectos con metraje…</p>;
  if (!lista.length)
    return (
      <p className="mb-6 text-sm text-secundario">
        Todavía no tienes videos con metraje: sube uno aquí abajo o importa uno de YouTube.
      </p>
    );
  return (
    <Tarjeta titulo="¿De qué video sacamos los shorts?" className="mb-6">
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {lista.map(e => (
          <li key={e.nombre}>
            <a
              href={conP(e.nombre)}
              className="inline-flex min-h-11 items-center gap-2 rounded-medio border border-linea px-3 text-sm text-texto no-underline hover:border-campo hover:bg-elevada"
            >
              <Icono nombre="video" className="text-secundario" />
              {e.nombre}
            </a>
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------
// M17: importar de YouTube. Cotizar es gratis; importar cobra lo cotizado.

function Importar({ principal, alImportar }: { principal: boolean; alImportar: (nombre: string) => void }) {
  const [url, setUrl] = useState('');
  const [cotiza, setCotiza] = useState<Cotizacion | null>(null);
  const [cotizando, setCotizando] = useState(false);
  const [notaCotiza, setNotaCotiza] = useState<Nota | null>(null);
  // UI·24: lo que está mal de la liga va en el campo (y el campo tiembla);
  // la nota de abajo queda para lo que no es culpa de la liga (red, servidor)
  const [errorLiga, setErrorLiga] = useState<string | null>(null);
  const [nota, setNota] = useState<Nota | null>(null);
  const saldo = useSaldo();

  async function alCotizar() {
    const limpia = url.trim();
    if (cotizando) return;
    if (!esLigaDeYoutube(limpia)) {
      setErrorLiga(LIGA_INVALIDA);
      return;
    }
    setCotizando(true);
    setCotiza(null);
    setNota(null);
    setNotaCotiza({ texto: 'Cotizando…' });
    try {
      const c = await cotizar(limpia);
      setCotiza(c);
      setNotaCotiza(null);
    } catch (e) {
      // un 4xx de cotizar habla de ESA liga (no existe, muy corta, muy larga):
      // va en el campo. Lo demás (red, 5xx) no es culpa de la liga
      if (e instanceof ErrorApi && e.estado >= 400 && e.estado < 500 && !e.sinSaldo) {
        setNotaCotiza(null);
        setErrorLiga(mensaje(e));
      } else setNotaCotiza(notaDeError(e));
    } finally {
      setCotizando(false);
    }
  }

  async function alImportarClic() {
    if (!cotiza) return;
    setNota(null);
    try {
      const r = await importar(url.trim());
      refrescarSaldo();
      alImportar(r.nombre);
      return true; // UI·19: se cobró
    } catch (e) {
      // ya importado o importándose: se abre el que existe
      if (e instanceof ErrorApi && e.estado === 409 && cotiza.nombre) alImportar(cotiza.nombre);
      else setNota(notaDeError(e));
    }
  }

  return (
    <Tarjeta titulo="Importar de YouTube" className="mb-6">
      <p className="m-0 mb-4 text-secundario">
        Pega la liga de un video (entre 1 y 90 min): lo traemos al servicio y de ahí salen tus shorts. Llega como
        proyecto aparte, así que no toca el que tengas abierto.
      </p>
      <form
        className="flex flex-wrap items-start gap-3"
        noValidate
        onSubmit={e => {
          e.preventDefault();
          void alCotizar();
        }}
      >
        <div className="min-w-0 flex-[1_1_320px]">
          <Campo
            etiqueta="Liga de YouTube"
            etiquetaOculta
            type="url"
            value={url}
            error={errorLiga}
            // la cotización es de ESA liga: cambiarla la anula, para no cobrar otra
            onChange={e => {
              setUrl(e.target.value);
              setCotiza(null);
              setErrorLiga(null);
            }}
            placeholder="https://www.youtube.com/watch?v=…"
          />
        </div>
        <Boton type="submit" nivel="secundario" trabajando={cotizando && 'Cotizando…'}>
          Cotizar
        </Boton>
      </form>
      {cotiza && (
        <div className="mt-3">
          <p className="m-0 mb-3 text-sm text-secundario [overflow-wrap:anywhere]">
            «{cotiza.titulo}» · {minutos(cotiza.duracion_s)}
          </p>
          <BotonCobro
            verbo="Importar"
            costo={cotiza.creditos}
            saldo={saldo}
            trabajando="Importando…"
            nivel={principal ? 'principal' : 'secundario'}
            alCobrar={alImportarClic}
          />
          <div className="mt-2">
            <NotaSaldo saldo={saldo} costo={cotiza.creditos} />
          </div>
        </div>
      )}
      <NotaLinea nota={notaCotiza} className="mt-2" />
      <NotaLinea nota={nota} className="mt-2" />
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------
// con ?p=: analizar → elegir → renderizar

function ProyectoShorts({ p, alAbrir }: { p: string; alAbrir: (nombre: string) => void }) {
  const lista = useListaViva<Proyecto>(() => cargar(p), vivo, { alTerminar: refrescarSaldo });
  const d = lista.datos;
  const imp = d?.importar ?? {};
  const st: EstadoShorts = d?.shorts ?? {};
  const render = st.render ?? {};
  const descargando = imp.estado === 'descargando';
  // UI·21: los shorts que acaban de salir entran abriendo su espacio (no
  // los que ya estaban al abrir la página)
  const [salidasNuevas] = useLlegada(d === null ? null : render.estado === 'listo' && !!render.salidas);

  useTituloPestana(
    descargando
      ? 'Trayendo el video'
      : render.estado === 'corriendo'
        ? 'Renderizando'
        : render.estado === 'listo' && render.salidas
          ? '✓ Shorts listos'
          : st.estado === 'analizando'
            ? 'Analizando tu video'
            : st.estado === 'candidatos'
              ? '✓ Análisis listo'
              : null,
  );

  // se lanzó algo: la lista se pone en «vivo» ya, sin esperar a la siguiente vuelta
  const marcarVivo = (cambio: (d: Proyecto) => Proyecto) => {
    if (lista.datos) lista.poner(cambio(lista.datos));
    void lista.actualizar();
  };

  const falloCarga =
    lista.fallo instanceof ErrorApi && lista.fallo.estado !== 0 && !/^Algo salió mal/.test(lista.fallo.message)
      ? lista.fallo.message
      : 'No pudimos cargar tu proyecto. Revisa tu conexión e inténtalo de nuevo.';

  return (
    <>
      {lista.error && (
        <div className="mb-6">
          <Aviso tipo="error">
            {falloCarga}{' '}
            <Boton nivel="enlace" onClick={() => void lista.actualizar()}>
              Reintentar
            </Boton>
          </Aviso>
        </div>
      )}
      {lista.sinRed && (
        <div className="mb-6">
          <Aviso>Sin conexión — reintentando… Tu trabajo sigue en la nube.</Aviso>
        </div>
      )}
      {d === null && !lista.error && <p className="text-sm text-secundario">Cargando…</p>}

      {d && descargando && (
        <EsperaShorts
          className="mb-6"
          paso={0}
          inicio={imp.inicio}
          suele="1–3 min"
          texto={'Trayendo «' + (imp.titulo || 'el video') + '» de YouTube'}
        />
      )}

      {d && !descargando && imp.estado === 'error' && !d.fuente && (
        <div className="mb-6">
          <Aviso tipo="error">
            La importación falló{imp.error ? ` (${imp.error})` : ''} — tus créditos se devolvieron. Vuelve a{' '}
            <a href="?">intentarlo</a>.
          </Aviso>
        </div>
      )}

      {d && !descargando && !(imp.estado === 'error' && !d.fuente) && (
        <>
          <Analisis p={p} st={st} alLanzar={() => marcarVivo(x => ({ ...x, shorts: { estado: 'analizando' } }))} />
          {st.estado === 'candidatos' && st.candidatos && (
            <Candidatos
              key={st.listo ?? String(st.candidatos.length)}
              p={p}
              candidatos={st.candidatos}
              porShort={d.creditos_por_short}
              render={render}
              alLanzar={() =>
                marcarVivo(x => ({ ...x, shorts: { ...st, render: { ...render, estado: 'corriendo' } } }))
              }
            />
          )}
          {render.estado === 'listo' && render.salidas && (
            <FilaViva nombre="salidas" nueva={salidasNuevas}>
              <Salidas salidas={render.salidas} cdn={d.cdn} />
            </FilaViva>
          )}
        </>
      )}

      {d && !descargando && <Importar principal={false} alImportar={alAbrir} />}
    </>
  );
}

function Analisis({ p, st, alLanzar }: { p: string; st: EstadoShorts; alLanzar: () => void }) {
  const [costo, setCosto] = useState<Costo | null>(null);
  const [errorCosto, setErrorCosto] = useState('');
  const [nota, setNota] = useState<Nota | null>(null);
  const saldo = useSaldo();
  const analizando = st.estado === 'analizando';
  const conCandidatos = st.estado === 'candidatos';
  // UI·21: «Análisis listo» se enciende un instante al terminar con la página abierta
  const [encendido, apagar] = useLlegada(conCandidatos);

  // el precio ANTES del botón (regla dura: nube sin preview = bug); una vez basta
  const hacePrecio = !analizando && costo === null && !errorCosto;
  useEffect(() => {
    if (!hacePrecio) return;
    let vigente = true;
    cargarCosto(p).then(
      c => vigente && setCosto(c),
      (e: unknown) => vigente && setErrorCosto(mensaje(e)),
    );
    return () => {
      vigente = false;
    };
  }, [p, hacePrecio]);

  async function alAnalizar() {
    setNota(null);
    try {
      await analizar(p);
    } catch (e) {
      setNota(notaDeError(e));
      return;
    }
    refrescarSaldo();
    alLanzar();
    return true; // UI·19: se cobró
  }

  const verbo = conCandidatos ? 'Re-analizar' : 'Analizar';
  const n = st.candidatos?.length ?? 0;
  return (
    <Tarjeta titulo="1 · Analizar el video" className="mb-6">
      {analizando ? (
        <>
          <EsperaShorts plano paso={1} inicio={st.inicio} texto="Analizando tu video · transcript y candidatos" />
        </>
      ) : (
        <>
          {conCandidatos && (
            <p className="m-0 mb-2 text-sm">
              <span className={unir('text-exito', encendido && 'destello')} onAnimationEnd={apagar}>
                <Icono nombre="listo" className="mr-1 align-[-0.15em]" />
                Análisis listo
              </span>{' '}
              <span className="text-secundario">
                ({n} {plural(n, 'candidato', 'candidatos')}
                {st.listo ? ' · ' + new Date(st.listo).toLocaleString('es-MX') : ''})
              </span>
            </p>
          )}
          {st.estado === 'error' && (
            // el orbe NUNCA acompaña a un error
            <p role="alert" className="m-0 mb-2 text-sm text-error">
              El análisis falló{st.error ? ` (${st.error})` : ''} — tus créditos se devolvieron.
            </p>
          )}
          {errorCosto && (
            <p role="alert" className="m-0 text-sm text-error">
              {errorCosto}
            </p>
          )}
          {costo && (
            <p className="m-0 mb-3 text-sm text-secundario">
              El video dura {minutos(costo.duracion_s)}.{' '}
              {costo.con_transcript
                ? 'Ya trae transcript: el análisis no re-transcribe.'
                : 'Incluye la transcripción en nube (cobrada por duración).'}
              {!costo.backend_listo && costo.aviso && (
                <>
                  {' '}
                  <Icono nombre="aviso" className="align-[-0.15em]" /> {costo.aviso}
                </>
              )}
            </p>
          )}
          {!costo && !errorCosto && (
            <Boton nivel={conCandidatos ? 'secundario' : 'principal'} disabled>
              {verbo}…
            </Boton>
          )}
          {costo && (
            <>
              <BotonCobro
                verbo={verbo}
                costo={costo.creditos_analizar}
                saldo={saldo}
                trabajando="Lanzando…"
                deshabilitado={!costo.backend_listo}
                // con candidatos, el principal es Renderizar
                nivel={conCandidatos ? 'secundario' : 'principal'}
                alCobrar={alAnalizar}
              />
              {!conCandidatos && (
                <div className="mt-2">
                  <NotaSaldo saldo={saldo} costo={costo.creditos_analizar} />
                </div>
              )}
            </>
          )}
          <NotaLinea nota={nota} className="mt-2" />
        </>
      )}
    </Tarjeta>
  );
}

interface Eleccion {
  marcado: boolean;
  start: string;
  end: string;
  h1: string;
  h2: string;
}

const inicial = (c: Candidato, i: number): Eleccion => ({
  marcado: i < 3, // los tres mejores, marcados de entrada
  start: String(c.start),
  end: String(c.end),
  h1: c.hook_line1 ?? '',
  h2: c.hook_line2 ?? '',
});

const corteDe = (e: Eleccion) => ({
  start: parseFloat(e.start),
  end: parseFloat(e.end),
  hook_line1: e.h1,
  hook_line2: e.h2,
});

const CAMPO = 'min-h-10 rounded-medio border border-campo bg-elevada px-2 text-sm text-texto';

function Candidatos({
  p,
  candidatos,
  porShort,
  render,
  alLanzar,
}: {
  p: string;
  candidatos: Candidato[];
  porShort: number | undefined;
  render: NonNullable<EstadoShorts['render']>;
  alLanzar: () => void;
}) {
  // lo que eliges y ajustas vive aquí: el sondeo ya no lo borra en cada vuelta
  const [eleccion, setEleccion] = useState<Eleccion[]>(() => candidatos.map(inicial));
  // UI·21: «Render listo» se enciende un instante al terminar con la página abierta
  const [renderEncendido, apagarRender] = useLlegada(render.estado === 'listo' && !!render.salidas);
  const [estilo, setEstilo] = useState<string>('bold');
  const [plataforma, setPlataforma] = useState<string>('all');
  const [tipo, setTipo] = useState<string>('auto');
  const [nota, setNota] = useState<Nota | null>(null);
  const saldo = useSaldo();
  const ids = useId();

  const cambiar = (i: number, cambio: Partial<Eleccion>) =>
    setEleccion(l => l.map((e, j) => (j === i ? { ...e, ...cambio } : e)));

  const marcados = eleccion.filter(e => e.marcado);
  const n = marcados.length;
  const problemas = eleccion.map(e => (e.marcado ? problemaDe(corteDe(e)) : null));
  const hayProblema = problemas.some(Boolean);
  const demasiados = n > MAX_SHORTS;
  const corriendo = render.estado === 'corriendo';

  async function alRenderizar() {
    setNota(null);
    try {
      await renderizar(p, { shorts: marcados.map(corteDe), estilo, plataforma, tipo });
    } catch (e) {
      setNota(notaDeError(e));
      return;
    }
    refrescarSaldo();
    alLanzar();
    return true; // UI·19: se cobró
  }

  return (
    <Tarjeta titulo="2 · Elige tus shorts" className="mb-6">
      <p className="m-0 mb-3 text-secundario">
        Marca los que quieras, ajusta inicio y fin (segundos) y el gancho en pantalla. Los límites se afinan solos a
        palabra y silencio antes de cortar.
      </p>
      <ol className="m-0 grid list-none gap-3 p-0">
        {candidatos.map((c, i) => {
          const e = eleccion[i]!;
          const problema = problemas[i];
          return (
            <li
              key={i}
              // marcado = borde y fondo; nada de bajar la opacidad (el texto
              // atenuado no pasa el contraste AA) ni de ámbar (elegir no es actuar)
              className={unir(
                'grid grid-cols-[auto_1fr] gap-3 rounded-grande border p-3',
                e.marcado ? 'border-campo bg-elevada' : 'border-dashed border-linea',
              )}
            >
              <label className="flex min-h-11 flex-col items-center gap-1">
                <input
                  type="checkbox"
                  checked={e.marcado}
                  onChange={ev => cambiar(i, { marcado: ev.target.checked })}
                  aria-label={`Usar el candidato ${i + 1}`}
                  className="size-5 accent-texto"
                />
                <span className="text-xs font-semibold tabular-nums text-secundario">{c.score.toFixed(1)}</span>
              </label>
              <div className="min-w-0">
                <p className="m-0 text-sm [overflow-wrap:anywhere]">{c.texto}</p>
                <p className="m-0 mt-1 text-xs text-secundario [overflow-wrap:anywhere]">{c.razon}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(
                    [
                      ['start', 'inicio', 'number'],
                      ['end', 'fin', 'number'],
                      ['h1', 'gancho', 'text'],
                      ['h2', 'línea 2', 'text'],
                    ] as const
                  ).map(([k, rotulo, tipoCampo]) => (
                    <label key={k} className="flex flex-col gap-0.5 text-xs text-secundario">
                      {rotulo}
                      <input
                        type={tipoCampo}
                        step={tipoCampo === 'number' ? 0.1 : undefined}
                        maxLength={tipoCampo === 'text' ? 40 : undefined}
                        aria-label={`${rotulo} del candidato ${i + 1}`}
                        aria-invalid={tipoCampo === 'number' && problema ? true : undefined}
                        aria-describedby={problema ? `${ids}-p${i}` : undefined}
                        value={e[k]}
                        onChange={ev => cambiar(i, { [k]: ev.target.value })}
                        className={unir(CAMPO, tipoCampo === 'number' ? 'w-24' : 'w-44', problema && tipoCampo === 'number' && 'border-error')}
                      />
                    </label>
                  ))}
                </div>
                {problema && (
                  <p id={`${ids}-p${i}`} className="m-0 mt-1 text-xs text-error">
                    {problema}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex flex-wrap gap-3">
        {(
          [
            ['Estilo', estilo, setEstilo, ESTILOS.map(e => [e, e] as const)],
            ['Plataforma', plataforma, setPlataforma, PLATAFORMAS],
            ['Contenido', tipo, setTipo, TIPOS],
          ] as const
        ).map(([rotulo, valor, poner, opciones]) => (
          <label key={rotulo} className="flex flex-col gap-0.5 text-xs text-secundario">
            {rotulo}
            <select value={valor} onChange={e => poner(e.target.value)} className={CAMPO}>
              {opciones.map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="mt-4">
        {corriendo ? (
          <EsperaShorts plano paso={3} inicio={render.inicio} suele="unos minutos por short" texto="Renderizando en la nube" />
        ) : n && porShort !== undefined ? (
          <BotonCobro
            verbo="Renderizar"
            costo={n * porShort}
            saldo={saldo}
            trabajando="Lanzando…"
            deshabilitado={hayProblema || demasiados}
            alCobrar={alRenderizar}
          />
        ) : (
          <Boton nivel="principal" disabled>
            Renderizar
          </Boton>
        )}
        {!corriendo && (
          <p role="status" className="mt-2 mb-0 text-sm text-secundario">
            {!n
              ? 'Marca al menos un candidato.'
              : demasiados
                ? `Son ${n} marcados: el máximo por render es ${MAX_SHORTS}.`
                : hayProblema
                  ? 'Corrige los tiempos marcados en rojo.'
                  : `${n} ${plural(n, 'short marcado', 'shorts marcados')}.`}
          </p>
        )}
        {!corriendo && n > 0 && porShort !== undefined && (
          <div className="mt-1">
            <NotaSaldo saldo={saldo} costo={n * porShort} />
          </div>
        )}
        {render.estado === 'listo' && render.salidas && !corriendo && (
          <p className="mt-2 mb-0 text-sm text-exito">
            <span className={unir(renderEncendido && 'destello')} onAnimationEnd={apagarRender}>
              <Icono nombre="listo" className="mr-1 align-[-0.15em]" />
              Render listo
            </span>
          </p>
        )}
        {render.estado === 'error' && !corriendo && (
          <p role="alert" className="mt-2 mb-0 text-sm text-error">
            El render falló{render.log ? ` (${render.log.slice(0, 160)})` : ''} — tus créditos se devolvieron. Ajusta y vuelve a
            intentar.
          </p>
        )}
        <NotaLinea nota={nota} className="mt-2" />
      </div>
    </Tarjeta>
  );
}

function Salidas({ salidas, cdn }: { salidas: NonNullable<NonNullable<EstadoShorts['render']>['salidas']>; cdn: string | undefined }) {
  return (
    <Tarjeta titulo="3 · Tus shorts" className="mb-6">
      <ul className="m-0 grid list-none gap-2 p-0">
        {salidas.map(s => {
          const ver = hrefSeguro(s.url);
          const key = keyDe(s, cdn);
          return (
            <li
              key={s.key ?? s.archivo}
              className="flex flex-wrap items-center justify-between gap-2 rounded-medio border border-linea px-3 py-2 text-sm"
            >
              <span className="[overflow-wrap:anywhere]">
                {s.archivo} <span className="text-secundario">· {(s.bytes / 1e6).toFixed(1)} MB</span>
              </span>
              <span className="flex gap-4">
                {ver && (
                  <a href={ver} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1">
                    <Icono nombre="externo" />
                    Ver
                  </a>
                )}
                {key && (
                  <a href={urlDescarga(key, s.archivo)} className="inline-flex min-h-11 items-center gap-1">
                    <Icono nombre="descargar" />
                    Descargar
                  </a>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 mb-0 text-xs text-secundario">
        Servidos por CDN: descarga y publica donde quieras. Cada render nuevo agrega archivos (nada se borra).
      </p>
    </Tarjeta>
  );
}
