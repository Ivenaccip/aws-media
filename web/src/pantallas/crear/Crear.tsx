// /estudio/crear/ — crear una película: configurar, esperar el guion,
// revisarlo, producir (con o sin aprobar las imágenes) y verla (UI·8.9).
// Paridad con static/crear.html.
//
// Cobra en tres sitios, siempre con el precio de tools/tarifas.json o del
// servidor, nunca calculado aparte: «Generar» (el guion), «Producir» (el
// resto de la duración elegida) y «Cambiar» (una imagen). Reintentar una
// producción fallida cobra otra vez lo mismo, y lo dice antes.
//
// La película vive en la nube: la URL lleva ?p=<id> y cerrar la pestaña no
// pierde nada. Mientras trabaja se sondea cada 2.5 s, y con la pestaña oculta
// el sondeo duerme (cada vuelta es una Lambda y una consulta a Aurora).
import { useCallback, useEffect, useRef, useState } from 'react';

import { BotonCobro } from '../../marca/BotonCobro';
import { ErrorTresPartes } from '../../marca/ErrorTresPartes';
import { EsperaPasos } from '../../marca/EsperaPasos';
import { Marco } from '../../marca/Marco';
import { Recarga } from '../../marca/Recarga';
import { refrescarSaldo, useSaldo } from '../../marca/useSaldo';
import { ErrorApi } from '../../nucleo/api';
import { ESTRELLA } from '../../nucleo/estrella';
import {
  type Llegada as LlegadaDeMiniatura,
  miniaturaQueLlega,
  NOMBRE_MINIATURA,
  olvidarMiniatura,
  trasLaLlegada,
} from '../../nucleo/transiciones';
import { useSondeo } from '../../nucleo/useSondeo';
import { Aviso } from '../../ui/Aviso';
import { Boton, claseBoton } from '../../ui/Boton';
import { Confirmar } from '../../ui/Confirmar';
import { Icono } from '../../ui/Icono';
import { Formulario, type Inicial } from './Formulario';
import {
  animar,
  archivo,
  avanceDe,
  cancelar,
  cargar,
  costoProducir,
  devuelto,
  enMarcha,
  esHttp,
  estimar,
  etiquetaEtapa,
  fallaAlProducir,
  hrefEmpezar,
  mensaje,
  modoValido,
  PASOS_PREP,
  PASOS_PROD,
  pasoDe,
  PREPARAR,
  producir,
  reabrir,
  regenerarImagen,
  SIN_AVANCE,
  TARIFA_IMAGEN,
  TERMINAL,
  textoFalta,
  textosDe,
  type Avance,
  type Proyecto,
} from './logica';
import { Revision } from './Revision';

export const SONDEO_MS = 2500;
/** El tope del orbe cuenta desde el último AVANCE real, no desde que abriste. */
export const SIN_AVANCE_MS = 720000;
/** El worker devuelve justo después de marcar el error: el saldo se pide un poco después. */
export const SALDO_TRAS_ERROR_MS = 4000;

const TITULO: Record<string, string> = {
  preparando: 'Escribiendo tu guion',
  creado: 'Escribiendo tu guion',
  produciendo: 'Produciendo tu película',
  revision: 'Revisa tu película',
  imagenes: '¿Te gustan estas imágenes?',
  listo: 'Película lista',
};

function leerUrl(): { id: string | null; inicial: Inicial } {
  const q = new URLSearchParams(location.search);
  return {
    id: q.get('p'),
    inicial: {
      brief: (q.get('brief') ?? '').slice(0, 5000),
      modo: modoValido(q.get('modo')),
      pipeline: q.get('pipeline'),
    },
  };
}

export function Crear() {
  const [url] = useState(leerUrl);
  const [proyecto, setProyecto] = useState<Proyecto | null>(null);
  const [avance, setAvance] = useState<Avance>(SIN_AVANCE);
  const [latido, setLatido] = useState('');
  const [minutos, setMinutos] = useState<number | null>(null);
  const [sinRed, setSinRed] = useState(false);
  const [noAbrio, setNoAbrio] = useState(false);
  const [version, setVersion] = useState(0); // la revisión se vuelve a armar al reabrir
  const actual = useRef<Proyecto | null>(null);
  const fallos = useRef(0);
  // UI·18: la miniatura que el inicio tocó para abrir esta película. Se
  // queda hasta que el navegador termina de agrandarla, aunque la película
  // llegue antes: quitarla a medio camino corta la transición en seco.
  const [llega] = useState(() => miniaturaQueLlega(url.id));
  const [enVuelo, setEnVuelo] = useState(llega !== null);
  useEffect(() => {
    olvidarMiniatura();
    let vivo = true;
    void trasLaLlegada().then(() => vivo && setEnVuelo(false));
    return () => {
      vivo = false;
    };
  }, []);

  const poner = useCallback((p: Proyecto) => {
    const antes = actual.current;
    actual.current = p;
    setProyecto(p);
    setAvance(a => (enMarcha(p) ? avanceDe(p, a) : SIN_AVANCE));
    // M19: el orbe late con cada avance real (etapa nueva o una escena más)
    setLatido([p.estado, p.etapa, p.progreso.escenas_listas || 0].join(':'));
    if (p.estado === 'revision' && antes && antes.estado !== 'revision') setVersion(v => v + 1);
    // el saldo se refresca al llegar al error: la devolución la hace el
    // worker justo después, y la píldora de arriba tiene que verla
    if (p.estado === 'error' && antes?.estado !== 'error') setTimeout(refrescarSaldo, SALDO_TRAS_ERROR_MS);
  }, []);

  // ── al abrir: la película del enlace (una vez, aunque StrictMode monte dos)
  const abrir = useCallback(async () => {
    if (!url.id) return;
    setNoAbrio(false);
    try {
      poner(await cargar(url.id));
    } catch {
      setNoAbrio(true);
    }
  }, [url.id, poner]);
  const arrancado = useRef(false);
  useEffect(() => {
    if (arrancado.current) return;
    arrancado.current = true;
    window.orbe?.precargar(); // el motor se baja en tiempo muerto, no al hacer clic
    Promise.resolve().then(abrir);
  }, [abrir]);

  // ── el sondeo: solo mientras la película trabaja
  const vivo = !!proyecto && !TERMINAL.includes(proyecto.estado);
  useSondeo(
    vivo,
    async () => {
      const id = actual.current?.id;
      if (!id) return true;
      const p = await cargar(id);
      fallos.current = 0;
      setSinRed(false);
      poner(p);
      return TERMINAL.includes(p.estado);
    },
    {
      escalera: [SONDEO_MS],
      // M5: tras 2 fallos seguidos se avisa y se sigue reintentando
      alFallar: () => {
        fallos.current += 1;
        if (fallos.current >= 2) setSinRed(true);
      },
    },
  );

  // al volver con el enlace a media producción no hay estimación en memoria:
  // se pide una vez con el texto que ya aprobaste (gratis)
  const pidioMin = useRef(false);
  useEffect(() => {
    if (!proyecto || proyecto.estado !== 'produciendo' || minutos || pidioMin.current) return;
    pidioMin.current = true;
    const textos = textosDe(proyecto).filter(t => t.trim());
    estimar(proyecto.id, textos).then(
      c => setMinutos(c.minutos || null),
      () => undefined, // sin cifra: la pantalla no la promete
    );
  }, [proyecto, minutos]);

  function alCrear(p: Proyecto) {
    history.replaceState(null, '', '?p=' + encodeURIComponent(p.id));
    poner(p);
  }

  const estado = proyecto?.estado;
  const enLlegada = llega !== null && (enVuelo || (!proyecto && !noAbrio));
  const titulo = !proyecto
    ? url.id
      ? 'Tu película'
      : 'Crea tu video'
    : estado === 'error'
      ? fallaAlProducir(proyecto)
        ? 'No pudimos terminar tu película'
        : 'No pudimos terminar tu guion'
      : (TITULO[estado ?? ''] ?? 'Tu película');

  return (
    <Marco pantalla="crear" titulo={titulo}>
      {sinRed && vivo && (
        <div className="mb-4">
          <Aviso tipo="aviso">Sin conexión, reintentando… Tu trabajo sigue en la nube.</Aviso>
        </div>
      )}
      {noAbrio && (
        <div className="mb-4">
          <Aviso tipo="error">
            No pudimos abrir esa película. Revisa tu conexión e inténtalo de nuevo.{' '}
            <Boton nivel="enlace" onClick={() => void abrir()}>
              Reintentar
            </Boton>
          </Aviso>
        </div>
      )}
      {enLlegada ? (
        <Llegada {...llega} />
      ) : (
        <>
          {!proyecto && url.id && !noAbrio && <p className="text-xs text-secundario">Abriendo tu película…</p>}
          {!proyecto && !url.id && <Formulario inicial={url.inicial} alCrear={alCrear} />}
          {proyecto && enMarcha(proyecto) && (
            <Progreso proyecto={proyecto} avance={avance} latido={latido} minutos={minutos} reposo={sinRed} />
          )}
          {proyecto && estado === 'revision' && (
            <Revision key={proyecto.id + ':' + version} proyecto={proyecto} alCambiar={poner} alMinutos={setMinutos} />
          )}
          {proyecto && estado === 'imagenes' && <Aprobar proyecto={proyecto} alCambiar={poner} />}
          {proyecto && estado === 'listo' && <Resultado proyecto={proyecto} alCambiar={poner} />}
          {proyecto && estado === 'error' && <Falla proyecto={proyecto} alCambiar={poner} />}
        </>
      )}
    </Marco>
  );
}

// ── 2 · la espera larga (UI·11 · carta §8): pasos con nombre, lo que falta y
// «puedes cerrar esta pestaña». La barra se queda: es real y no retrocede.
function Progreso({
  proyecto: p,
  avance,
  latido,
  minutos,
  reposo,
}: {
  proyecto: Proyecto;
  avance: Avance;
  latido: string;
  minutos: number | null;
  reposo: boolean;
}) {
  const prod = p.estado === 'produciendo';
  const total = p.progreso.escenas_total;
  return (
    <EsperaPasos
      pasos={prod ? PASOS_PROD : PASOS_PREP}
      paso={avance.paso}
      // «Animando las escenas · 2 de 6»: el conteo es del paso de las escenas
      detalle={prod && avance.paso === 2 && total ? ' · ' + (p.progreso.escenas_listas || 0) + ' de ' + total : undefined}
      pct={avance.pct}
      tiempo={prod ? textoFalta(minutos, avance.pct) : null}
      orbe={{
        texto: etiquetaEtapa(p),
        tope: SIN_AVANCE_MS,
        latido,
        reposo,
        textoAlAgotar:
          'Llevamos un rato sin novedades. Tu película sigue en la nube: puedes cerrar esto y volver con el mismo enlace. Si sigue igual, escríbenos.',
      }}
      cerrar="Puedes cerrar esta pestaña: el trabajo sigue en la nube y este enlace te trae de vuelta."
    />
  );
}

// ── 3.5 · las imágenes por aprobar (M22 · G). La película ya está pagada: lo
// único que cuesta aquí es pedir OTRA imagen.
function Aprobar({ proyecto: p, alCambiar }: { proyecto: Proyecto; alCambiar: (p: Proyecto) => void }) {
  const saldo = useSaldo();
  const imgs = p.progreso.imagenes ?? [];
  // cache-buster: la imagen nueva se escribe en el MISMO archivo (start_N.jpg)
  const [version, setVersion] = useState(0);
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [falla, setFalla] = useState<{ texto: string; sinSaldo?: boolean } | null>(null);
  const [ocupado, setOcupado] = useState<null | 'otra' | 'animar' | 'cancelar'>(null);
  const [preguntar, setPreguntar] = useState(false);
  const [devueltos, setDevueltos] = useState<number | null>(null);

  async function otra(esc: string, prompt: string) {
    if (ocupado) return;
    setFalla(null);
    setOcupado('otra');
    try {
      const nuevo = await regenerarImagen(p.id, esc, prompt);
      setVersion(v => v + 1);
      refrescarSaldo();
      alCambiar(nuevo);
      return true; // UI·19: se cobró
    } catch (e) {
      setFalla({ texto: mensaje(e), sinSaldo: e instanceof ErrorApi && e.sinSaldo });
    } finally {
      setOcupado(null);
    }
  }

  async function hacer(que: 'animar' | 'cancelar') {
    if (ocupado) return;
    setFalla(null);
    setOcupado(que);
    try {
      if (que === 'animar') alCambiar(await animar(p.id));
      else {
        const d = await cancelar(p.id);
        refrescarSaldo();
        setDevueltos(d.devueltos);
        alCambiar(d.proyecto);
      }
    } catch (e) {
      setFalla({ texto: mensaje(e) });
    } finally {
      setOcupado(null);
    }
  }

  return (
    <>
      {devueltos != null && devueltos > 0 && (
        <div className="mb-4">
          <Aviso tipo="exito">Te devolvimos {devueltos} créditos.</Aviso>
        </div>
      )}
      <p className="m-0 mb-4 max-w-[75ch] text-secundario">
        Cada una es el primer cuadro de una toma: de ahí sale el movimiento. Cámbiala ahora si no te convence: pedir otra
        cuesta una fracción de lo que cuesta animarla y volver a empezar.
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
        {imgs.map((im, i) => {
          const prompt = prompts[im.id] ?? im.prompt ?? '';
          return (
            <figure key={im.id} className="m-0 flex flex-col">
              <img
                src={archivo(p.id, im.archivo) + '?v=' + version}
                alt={'Imagen de la toma ' + (i + 1)}
                className="block w-full rounded-medio bg-linea"
              />
              <figcaption className="mb-1.5 mt-2 text-xs text-secundario">
                Toma {i + 1}
                {im.planos && im.planos > 1 ? ' · manda en ' + im.planos + ' planos' : ''} · «{(im.narracion ?? '').slice(0, 90)}»
              </figcaption>
              <details className="mb-1.5">
                <summary className="flex min-h-11 cursor-pointer items-center text-xs text-secundario">Describir otra imagen</summary>
                <textarea
                  value={prompt}
                  rows={3}
                  aria-label={'Descripción de la imagen de la toma ' + (i + 1)}
                  onChange={e => setPrompts(x => ({ ...x, [im.id]: e.target.value }))}
                  className="w-full resize-y rounded-medio border border-campo bg-elevada p-2 text-xs text-texto"
                />
              </details>
              <BotonCobro
                verbo="Cambiar"
                nivel="secundario"
                costo={TARIFA_IMAGEN}
                saldo={saldo}
                trabajando="Generando…"
                deshabilitado={!!ocupado}
                alCobrar={() => otra(im.id, prompt)}
              />
            </figure>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 bg-fondo pb-3.5 pt-2.5 md:sticky md:bottom-0">
        <Boton
          nivel="principal"
          icono={<Icono nombre="video" />}
          disabled={!!ocupado && ocupado !== 'animar'}
          trabajando={ocupado === 'animar' && 'Arrancando…'}
          onClick={() => void hacer('animar')}
        >
          Animar la película
        </Boton>
        <Boton
          nivel="secundario"
          disabled={!!ocupado && ocupado !== 'cancelar'}
          trabajando={ocupado === 'cancelar' && 'Volviendo…'}
          onClick={() => setPreguntar(true)}
        >
          Mejor no
        </Boton>
        <p className="m-0 text-xs text-secundario">
          {imgs.length
            ? imgs.length + (imgs.length === 1 ? ' imagen' : ' imágenes') + ' · animar ya está pagado; pedir otra imagen cuesta ' + ESTRELLA + ' ' + TARIFA_IMAGEN + '.'
            : 'Sin imágenes que aprobar.'}
        </p>
        {falla && (
          <p role="alert" className="m-0 w-full whitespace-pre-wrap text-sm text-error">
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
      <Confirmar
        abierto={preguntar}
        alCambiar={setPreguntar}
        titulo="¿Volver a revisión sin animar?"
        descripcion="Te devolvemos los créditos de la animación, menos lo que ya costaron estas imágenes. Si luego produces otra vez, se cobra como la primera."
        confirmar="Sí, volver a revisión"
        cancelar="No, seguir aquí"
        alConfirmar={() => void hacer('cancelar')}
      />
    </>
  );
}

// ── 4 · el resultado: el video grande, Descargar | Editor | Rehacer
// UI·18: mientras la película carga, su miniatura ocupa el lugar del
// reproductor, con el nombre que el inicio le puso a la que tocaste: el
// navegador la agranda desde allá hasta aquí (nucleo/transiciones.ts).
function Llegada({ src, proporcion }: LlegadaDeMiniatura) {
  return (
    <div className="max-w-[900px]">
      <section className="rounded-grande border border-linea bg-superficie p-4">
        <img
          src={src}
          alt=""
          // la caja existe antes de que la imagen cargue: sin alto, el
          // navegador agrandaría la miniatura hacia una raya
          style={{ viewTransitionName: NOMBRE_MINIATURA, aspectRatio: proporcion ?? 16 / 9 }}
          className="block max-h-[70vh] w-full rounded-medio object-contain"
        />
        <p className="mb-0 mt-3 text-xs text-secundario">Abriendo tu película…</p>
      </section>
    </div>
  );
}

function Resultado({ proyecto: p, alCambiar }: { proyecto: Proyecto; alCambiar: (p: Proyecto) => void }) {
  const [falla, setFalla] = useState<string | null>(null);
  const [volviendo, setVolviendo] = useState(false);
  const gen = p.progreso.editor;

  // «Rehacer» reabre la película a revisión: gratis; producir de nuevo cobra
  async function rehacer() {
    setFalla(null);
    setVolviendo(true);
    try {
      alCambiar(await reabrir(p.id));
    } catch (e) {
      setFalla(e instanceof ErrorApi && e.estado === 0 ? 'No se pudo volver a revisión. Revisa tu conexión.' : mensaje(e));
    } finally {
      setVolviendo(false);
    }
  }

  return (
    <div className="max-w-[900px]">
      <section className="rounded-grande border border-linea bg-superficie p-4">
        <h2 className="sr-only">Tu película</h2>
        {/* el frame de portada como póster: se VE la película antes de dar play.
            Sin <track>: el servidor no produce una pista de subtítulos aparte */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          controls
          src={archivo(p.id, 'pelicula.mp4')}
          poster={archivo(p.id, 'portada.jpg')}
          className="block max-h-[70vh] w-full rounded-medio object-contain"
        />
        {p.resultado?.mensaje && <p className="mb-0 mt-3 whitespace-pre-wrap">{p.resultado.mensaje}</p>}
        {esHttp(p.resultado?.link) && (
          <p className="mb-0 mt-2">
            <a href={p.resultado.link} target="_blank" rel="noopener noreferrer" className="text-enlace underline underline-offset-4 hover:text-texto">
              Abrir en Drive
            </a>
          </p>
        )}
      </section>
      {/* ninguno es principal: la película ya está hecha y nada aquí cobra */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <a className={claseBoton('secundario')} href={archivo(p.id, 'pelicula.mp4')} download="pelicula.mp4">
          <Icono nombre="descargar" />
          Descargar
        </a>
        {gen ? (
          <a
            className={claseBoton('secundario')}
            href={'/editor/' + encodeURIComponent(gen) + '/'}
            title="Abre la película en el editor de cortes: recorta, ajusta y guarda versiones ahí mismo (gratis)"
          >
            <Icono nombre="cortar" />
            Editor
          </a>
        ) : (
          <Boton nivel="secundario" disabled icono={<Icono nombre="cortar" />} title="El editor de esta película aún no está listo">
            Editor
          </Boton>
        )}
        <Boton
          nivel="secundario"
          icono={<Icono nombre="rehacer" />}
          trabajando={volviendo && 'Volviendo…'}
          title="Vuelve a revisión para ajustar guion, voz o personaje (producir de nuevo cobra como siempre)"
          onClick={() => void rehacer()}
        >
          Rehacer
        </Boton>
      </div>
      {!gen && (
        <p className="m-0 mt-2 text-xs text-secundario">
          El editor de esta película aún no está listo: el paso al editor falló o sigue corriendo.
        </p>
      )}
      {falla && (
        <p role="alert" className="m-0 mt-2 text-sm text-error">
          {falla}
        </p>
      )}
    </div>
  );
}

// ── el error (UI·11 · carta §8): qué pasó, qué pasó con tus créditos y qué
// sigue, con UN solo botón ámbar. Lo técnico queda plegado.
function Falla({ proyecto: p, alCambiar }: { proyecto: Proyecto; alCambiar: (p: Proyecto) => void }) {
  const saldo = useSaldo();
  const [falla, setFalla] = useState<{ texto: string; sinSaldo?: boolean } | null>(null);
  const alProducir = fallaAlProducir(p);
  const pasos = alProducir ? PASOS_PROD : PASOS_PREP;
  const paso = pasos[pasoDe(pasos, p.etapa)];
  const conCreditos = saldo !== null; // sin monedero no se habla de créditos (ni aquí ni en ErrorTresPartes)
  const dev = devuelto(p, alProducir);
  const costo = alProducir ? costoProducir(p.duracion_s) : null;
  const candado = useRef(false); // el de BotonCobro, también para el botón sin precio

  async function reintentar() {
    if (candado.current) return;
    candado.current = true;
    setFalla(null);
    try {
      const nuevo = await producir(p.id, null);
      refrescarSaldo();
      alCambiar(nuevo);
      return true; // UI·19: se cobró
    } catch (e) {
      // va aparte: «qué pasó» sigue contando el fallo original
      setFalla({ texto: mensaje(e), sinSaldo: e instanceof ErrorApi && e.sinSaldo });
    } finally {
      candado.current = false;
    }
  }

  let sigue = alProducir ? 'Reintentar vuelve a producir con lo mismo que aprobaste.' : 'Empieza de nuevo con la misma idea.';
  if (conCreditos && costo != null) sigue += ' Cuesta ' + costo + ' créditos y se cobran de nuevo.';
  else if (conCreditos && !alProducir) sigue += ' El guion cuesta ' + PREPARAR + ' créditos, como la primera vez.';

  return (
    <div className="max-w-[720px]">
      <ErrorTresPartes
        paso={
          (paso?.activo ? 'Se detuvo en «' + paso.activo + '». ' : '') +
          (alProducir
            ? 'Tu guion, tu voz y tu personaje siguen guardados.'
            : 'Tu idea no se perdió: «Empezar de nuevo» la trae escrita.')
        }
        creditos={
          dev != null
            ? 'Te devolvimos ' + ESTRELLA + ' ' + dev + ': no pagas por ' + (alProducir ? 'una película' : 'un guion') + ' que no salió.'
            : 'Te devolvimos lo que se cobró: no pagas por lo que no salió.'
        }
        sigue={sigue}
        detalle={p.error}
      />
      <div className="mt-4 flex flex-wrap items-start gap-3">
        {alProducir &&
          (costo != null ? (
            <BotonCobro verbo="Reintentar" costo={costo} saldo={saldo} trabajando="Reintentando…" alCobrar={reintentar} />
          ) : (
            <Boton nivel="principal" onClick={() => void reintentar()}>
              Reintentar
            </Boton>
          ))}
        {/* sin nada que reintentar, empezar de nuevo pasa a ser el principal */}
        <a className={claseBoton(alProducir ? 'secundario' : 'principal')} href={hrefEmpezar(p.brief)}>
          Empezar de nuevo
        </a>
      </div>
      {falla && (
        <p role="alert" className="m-0 mt-2 whitespace-pre-wrap text-sm text-error">
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
  );
}
