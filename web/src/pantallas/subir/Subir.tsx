// /estudio/subir/ — editar metraje (UI·8.3). Sube el video directo a S3 con
// progreso real (<SubirVideo>, compartida con shorts) y, con el metraje arriba, enseña los dos caminos: Cortes IA
// (shorts) y Editor IA, que cobra una cosa: «Proponer ✦ N».
// Paridad con static/e1.html: mismas llamadas, mismo precio (del server),
// mismas validaciones. Qué pasó con cada aserción vieja: docs/migracion/subir.md.
import { useCallback, useEffect, useRef, useState } from 'react';

import { BotonCobro } from '../../marca/BotonCobro';
import { EsperaIA } from '../../marca/EsperaIA';
import { Marco } from '../../marca/Marco';
import { NotaSaldo } from '../../marca/NotaSaldo';
import { Recarga } from '../../marca/Recarga';
import { SubirVideo } from '../../marca/SubirVideo';
import { refrescarSaldo, useSaldo } from '../../marca/useSaldo';
import { ErrorApi } from '../../nucleo/api';
import { useSondeo } from '../../nucleo/useSondeo';
import { useTituloPestana } from '../../nucleo/useTituloPestana';
import { Aviso } from '../../ui/Aviso';
import { Boton, claseBoton } from '../../ui/Boton';
import { Confirmar } from '../../ui/Confirmar';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import {
  aShorts,
  alEditor,
  cargarConfig,
  cargarCosto,
  cargarEstado,
  corriendo,
  notaMetraje,
  resumenListo,
  sugerir,
  type ConfigMedia,
  type Costo,
  type EstadoEditar,
} from './logica';
import './subir.css';

const LOCAL = 'En esta instalación local el corte se hace con /clean-cut desde Claude Code.';
const AL_AGOTAR =
  'Llevamos un rato sin novedades. La corrida sigue en la nube: puedes cerrar esto y volver con el mismo ' +
  'enlace. Si sigue igual, escríbenos.';

type Carga =
  | { tipo: 'cargando' }
  | { tipo: 'local' }
  | { tipo: 'error'; texto: string }
  | { tipo: 'ok'; st: EstadoEditar; costo?: Costo; errorCosto?: string };

interface Nota {
  texto: string;
  error?: boolean;
  sinSaldo?: boolean;
}

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Subir() {
  const [cfg, setCfg] = useState<ConfigMedia | null>(null);
  const [proyecto, setProyecto] = useState(() => new URLSearchParams(location.search).get('p') ?? '');
  const [carga, setCarga] = useState<Carga>({ tipo: 'cargando' });
  const [sinRed, setSinRed] = useState(false);
  const [vuelta, setVuelta] = useState(0);

  const [videoSubido, setVideoSubido] = useState<string | null>(null);

  const [notaEditor, setNotaEditor] = useState<Nota | null>(null);
  const [lanzando, setLanzando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  const saldo = useSaldo();
  const respuesta = useRef<((si: boolean) => void) | null>(null);
  const ultimo = useRef<EstadoEditar | null>(null);
  const actual = useRef(proyecto);
  useEffect(() => {
    actual.current = proyecto;
  });

  useEffect(() => {
    let vigente = true;
    cargarConfig().then(
      c => vigente && setCfg(c),
      () => vigente && setCfg({ activo: false, cdn: '' }), // instalación local sin media API
    );
    window.orbe?.precargar();
    return () => {
      vigente = false;
    };
  }, []);

  // Lo que hacía initCorte(): el estado del proyecto y, si toca cobrar, el
  // precio ANTES de enseñar el botón (regla dura: nube sin preview = bug).
  // Devuelve true cuando ya no hay nada que seguir preguntando.
  const leer = useCallback(async (p: string): Promise<boolean> => {
    let st: EstadoEditar;
    try {
      st = await cargarEstado(p);
    } catch (e) {
      if (actual.current !== p) return true;
      if (e instanceof ErrorApi && e.estado === 503) {
        setCarga({ tipo: 'local' });
        return true;
      }
      // con la corrida viva, un fallo de red no mata el sondeo (M19)
      if (corriendo(ultimo.current)) {
        setSinRed(true);
        throw e;
      }
      setCarga({ tipo: 'error', texto: mensaje(e) });
      return true;
    }
    if (actual.current !== p) return true;
    setSinRed(false);
    const antes = ultimo.current;
    ultimo.current = st;
    // terminó la corrida: si falló o no encontró relleno, hubo devolución
    if (corriendo(antes) && !corriendo(st)) refrescarSaldo();
    if (corriendo(st) || st.editor_listo || !st.fuente) {
      setCarga({ tipo: 'ok', st });
      return !corriendo(st);
    }
    try {
      const costo = await cargarCosto(p);
      if (actual.current === p) setCarga({ tipo: 'ok', st, costo });
    } catch (e) {
      if (actual.current === p) setCarga({ tipo: 'ok', st, errorCosto: mensaje(e) });
    }
    return true;
  }, []);

  useEffect(() => {
    if (!proyecto) return;
    // leer() pone estado: va en un callback, no en el cuerpo del efecto
    Promise.resolve(proyecto).then(leer).catch(() => undefined);
  }, [proyecto, vuelta, leer]);

  const st = carga.tipo === 'ok' ? carga.st : null;
  const vivo = corriendo(st);
  useSondeo(Boolean(proyecto) && (vivo || sinRed), () => leer(proyecto));

  const listo = st?.editor_listo ? resumenListo(st.editar) : null;
  useTituloPestana(
    vivo ? 'Revisando tu metraje' : listo ? (listo.nada ? '✓ Sin relleno que quitar' : '✓ Corte propuesto') : null,
  );

  // «Proponer ✦ N»: el precio ya está en el botón; la confirmación evita el
  // cobro por un clic accidental. El candado de <BotonCobro> sigue cerrado
  // mientras el diálogo está abierto: un doble clic no abre dos.
  const preguntar = () =>
    new Promise<boolean>(r => {
      respuesta.current = r;
      setConfirmando(true);
    });
  const responder = (si: boolean) => {
    respuesta.current?.(si);
    respuesta.current = null;
    setConfirmando(false);
  };

  async function alProponer() {
    if (!(await preguntar())) return;
    const p = proyecto;
    setNotaEditor(null);
    setLanzando(true); // el POST tarda unos segundos: no dejarlos mudos
    try {
      await sugerir(p);
      refrescarSaldo();
    } catch (e) {
      // el error se queda a la vista y el botón vuelve a servir
      setNotaEditor({ texto: mensaje(e), error: true, sinSaldo: e instanceof ErrorApi && e.sinSaldo });
      return;
    } finally {
      setLanzando(false);
    }
    await leer(p).catch(() => undefined);
    return true; // UI·19: se cobró; el «−N» vuela del botón
  }

  const conFuente = Boolean(st?.fuente);
  const video = videoSubido ?? (cfg?.cdn && st?.fuente ? `${cfg.cdn}/${st.fuente}` : undefined);
  const costo = carga.tipo === 'ok' ? carga.costo : undefined;

  return (
    <Marco pantalla="subir" titulo="Editar metraje">
      {cfg && !cfg.activo && !proyecto && (
        <div className="mb-6">
          <Aviso>Subir metraje corre en el servicio: aquí no se puede subir.</Aviso>
        </div>
      )}

      {cfg?.activo && (
        <SubirVideo
          titulo="Subir metraje"
          descripcion="El video sube directo a la nube (no pasa por el servidor) y queda listo para editar."
          nombreInicial={proyecto}
          principal={!conFuente}
          alSubir={(p, sub) => {
            setVideoSubido(sub.cdn);
            // M14: el metraje recién subido pasa directo al panel de los dos caminos
            history.replaceState(null, '', '?p=' + encodeURIComponent(p));
            setNotaEditor(null);
            setProyecto(p);
            setVuelta(v => v + 1);
          }}
        />
      )}

      {proyecto && (
        <div className="grid items-stretch gap-6 min-[761px]:grid-cols-[1.15fr_1fr]">
          <section className="flex flex-col rounded-grande border border-linea bg-superficie p-6">
            <h2 className="m-0 flex flex-wrap items-center gap-2 text-titulo-sm font-bold">
              <Icono nombre="video" className="text-secundario" />
              Tu video{' '}
              <span className="font-texto text-sm font-normal text-secundario [overflow-wrap:anywhere]">
                · {proyecto}
              </span>
            </h2>
            <video
              src={video}
              controls
              preload="metadata"
              className="mt-3 min-h-60 w-full flex-1 rounded-medio bg-[#000000] object-contain"
            >
              <track kind="captions" />
            </video>
            <EstadoCorte carga={carga} />
          </section>

          <div className="grid gap-6">
            <section className="group relative rounded-grande border border-linea bg-superficie p-6 transition-colors hover:border-secundario">
              <h2 className="m-0 mb-1 flex items-center gap-2 text-titulo-sm font-bold">
                <Icono nombre="shorts" className="text-secundario" />
                Cortes IA
              </h2>
              <p className="m-0 text-secundario">
                La IA encuentra los mejores momentos de tu video y los convierte en clips verticales con captions,
                listos para TikTok, Reels y Shorts.
              </p>
              <div className="anim anim-shorts" aria-hidden="true">
                <div className="cinta" />
                <div className="clip c1" />
                <div className="clip c2" />
                <div className="clip c3" />
              </div>
              {conFuente ? (
                // la tarjeta entera es el enlace (pedido del dueño): el ::after lo estira
                <a
                  href={aShorts(proyecto)}
                  className="inline-flex min-h-11 items-center gap-1 font-medium text-enlace no-underline after:absolute after:inset-0 after:rounded-grande hover:underline"
                >
                  Sacar mis cortes
                  <Icono nombre="derecha" />
                </a>
              ) : (
                st && <p className="m-0 text-sm text-secundario">Sube tu metraje primero</p>
              )}
            </section>

            <section className="rounded-grande border border-linea bg-superficie p-6">
              <h2 className="m-0 mb-1 flex items-center gap-2 text-titulo-sm font-bold">
                <Icono nombre="cortar" className="text-secundario" />
                Editor IA
              </h2>
              <p className="m-0 text-secundario">
                La IA propone el corte de tu metraje — muletillas, retakes, aire muerto — y tú apruebas cada sugerencia
                en el editor. Nada se aplica solo.
              </p>
              {vivo || lanzando ? (
                // el orbe OCUPA el sitio de la animación decorativa, no se le suma
                <div className="my-4 grid min-h-[110px] place-items-center rounded-medio border border-linea bg-fondo p-3">
                  <EsperaIA
                    heroe
                    texto="Revisando tu metraje · transcribir y proponer el corte"
                    tope={1800000}
                    textoAlAgotar={AL_AGOTAR}
                  />
                </div>
              ) : (
                <div className="anim anim-editor" aria-hidden="true">
                  <div className="pista" />
                  <div className="seg s1" />
                  <div className="seg s2" />
                  <div className="seg s3" />
                  <div className="cabezal" />
                </div>
              )}
              {vivo && sinRed && (
                <Aviso>Sin conexión — reintentando… Tu corrida sigue en la nube.</Aviso>
              )}
              {st?.editor_listo && (
                <a href={alEditor(proyecto)} className={claseBoton('principal')}>
                  Editar
                  <Icono nombre="derecha" />
                </a>
              )}
              {st && !st.fuente && !st.editor_listo && (
                <p className="m-0 text-sm text-secundario">Sube tu metraje primero</p>
              )}
              {costo && !costo.backend_listo && <p className="m-0 text-sm text-secundario">{costo.aviso}</p>}
              {costo?.backend_listo && !vivo && (
                <>
                  <BotonCobro
                    verbo="Proponer"
                    costo={costo.creditos}
                    saldo={saldo}
                    trabajando="Lanzando…"
                    alCobrar={alProponer}
                  />
                  <div className="mt-2">
                    <NotaSaldo saldo={saldo} costo={costo.creditos} />
                  </div>
                </>
              )}
              {carga.tipo === 'ok' && carga.errorCosto && (
                <p role="alert" className="m-0 text-sm text-error">
                  {carga.errorCosto}
                </p>
              )}
              {notaEditor && (
                <p
                  role={notaEditor.error ? 'alert' : 'status'}
                  className={unir('mt-2 mb-0 text-sm', notaEditor.error ? 'text-error' : 'text-secundario')}
                >
                  {notaEditor.texto}
                  {notaEditor.sinSaldo && (
                    <>
                      {' '}
                      <Recarga />
                    </>
                  )}
                </p>
              )}
              {carga.tipo === 'error' && (
                <Boton nivel="enlace" onClick={() => setVuelta(v => v + 1)}>
                  Reintentar
                </Boton>
              )}
            </section>
          </div>
        </div>
      )}

      {costo && (
        <Confirmar
          abierto={confirmando}
          alCambiar={abierto => !abierto && responder(false)}
          titulo="¿Proponer el corte?"
          descripcion={`La IA va a revisar tu metraje y proponer el corte por ${costo.creditos} créditos.`}
          confirmar="Proponer"
          alConfirmar={() => responder(true)}
        />
      )}
    </Marco>
  );
}

/** La línea bajo el video: en qué está el corte, dicha como texto. */
function EstadoCorte({ carga }: { carga: Carga }) {
  let texto: string | null = null;
  let icono: 'cortar' | 'aviso' | null = null;
  let mal = false;
  if (carga.tipo === 'local') texto = LOCAL;
  else if (carga.tipo === 'error') {
    texto = carga.texto;
    icono = 'aviso';
    mal = true;
  } else if (carga.tipo === 'ok') {
    const { st, costo } = carga;
    const ed = st.editar ?? {};
    if (corriendo(st)) texto = null; // el orbe ya lleva el texto (role=status): sin duplicar
    else if (st.editor_listo) {
      texto = resumenListo(st.editar).texto;
      icono = 'cortar';
    } else if (!st.fuente) texto = 'Sube tu metraje arriba y aquí aparecen tus dos caminos.';
    else if (ed.estado === 'error') {
      // el fallo anterior y el metraje son contexto, no etiqueta de la acción
      texto = 'La corrida anterior falló y tus créditos se devolvieron.';
      icono = 'aviso';
      mal = true;
    } else if (!ed.estado && costo) texto = notaMetraje(costo);
  }
  return (
    <p role="status" className="mt-3 mb-0 text-xs text-secundario">
      {icono && <Icono nombre={icono} className={unir('mr-1 align-[-0.15em]', mal ? 'text-error' : 'text-secundario')} />}
      {texto}
    </p>
  );
}
