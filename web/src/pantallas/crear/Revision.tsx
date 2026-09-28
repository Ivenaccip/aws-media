// 3 · Revisión: el personaje, la voz y el guion, y «Producir ✦ N».
//
// Lo que se cuida del dinero:
//   · el precio de producir es el del servidor (/estimacion → creditos, el
//     mismo costo_producir que cobra); sin él no hay botón que cobre;
//   · producir guarda ANTES el guion y el personaje: se produce lo que se ve;
//   · «Cambiar ✦ 2» (modificar el personaje) y «Producir» no vuelan a la vez;
//   · el autoguardado jamás persiste un guion vacío, y cerrar la pestaña con
//     cambios sin guardar pregunta.
import { useEffect, useId, useRef, useState } from 'react';

import { BotonCobro } from '../../marca/BotonCobro';
import { EsperaIA } from '../../marca/EsperaIA';
import { Recarga } from '../../marca/Recarga';
import { refrescarSaldo, useSaldo } from '../../marca/useSaldo';
import { ErrorApi } from '../../nucleo/api';
import { dolares } from '../../nucleo/formato';
import { Aviso } from '../../ui/Aviso';
import { Boton } from '../../ui/Boton';
import { Guardado } from '../../ui/Guardado';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import { TARDA, TOPE_MS } from './Formulario';
import {
  archivo,
  cuerpoGuion,
  esHttp,
  esNarracion,
  estimar,
  generarOpciones,
  guardarGuion,
  guardarPersonaje,
  limpias,
  mensaje,
  metaEscena,
  modificarPersonaje,
  muestraVoz,
  NIVEL,
  PREPARAR,
  precioDe,
  producir,
  rutaOpcion,
  TARIFA_IMAGEN,
  textoEstimado,
  textosDe,
  vocesDe,
  vozInicial,
  type Estimacion,
  type Proyecto,
} from './logica';
import { Chip, Tarjeta } from './Piezas';

interface Falla {
  texto: string;
  sinSaldo?: boolean;
}

interface Escena {
  k: number;
  t: string;
}

const nuevaClave = (l: Escena[]) => l.reduce((m, e) => Math.max(m, e.k), -1) + 1;

export const ESPERA_ESTIMAR_MS = 400;
export const ESPERA_GUARDAR_MS = 1000;
export const REINTENTO_GUARDAR_MS = 4000;
const GUARDADO = 'Guardado a las ';

export function Revision({
  proyecto,
  alCambiar,
  alMinutos,
}: {
  proyecto: Proyecto;
  /** El proyecto nuevo que devolvió el servidor (opciones, o ya produciendo). */
  alCambiar: (p: Proyecto) => void;
  alMinutos: (m: number | null) => void;
}) {
  const saldo = useSaldo();
  const narracion = esNarracion(proyecto);
  const id = proyecto.id;
  const [escenas, setEscenas] = useState<Escena[]>(() => {
    const l = textosDe(proyecto);
    return (narracion ? [l[0] ?? ''] : l).map((t, k) => ({ k, t }));
  });
  const [nombre, setNombre] = useState(proyecto.personaje.nombre ?? '');
  const [elegida, setElegida] = useState<number | null>(proyecto.personaje.elegida ?? null);
  const [voz, setVoz] = useState(() => vozInicial(proyecto));
  const [modoImg, setModoImg] = useState<'auto' | 'manual'>('auto');
  const [est, setEst] = useState<Estimacion | null>(null);
  const [sinCosto, setSinCosto] = useState(false);
  const [intento, setIntento] = useState(0);
  const [guardado, setGuardado] = useState('');
  const [falla, setFalla] = useState<Falla | null>(null);
  const [ocupado, setOcupado] = useState<null | 'producir' | 'cambiar'>(null);
  const idNombre = useId();
  const idVoz = useId();

  const textos = escenas.map(e => e.t);
  const firma = JSON.stringify(limpias(textos));

  // ── la estimación (gratis): el precio de producir y los minutos
  const alMin = useRef(alMinutos);
  useEffect(() => {
    alMin.current = alMinutos;
  });
  useEffect(() => {
    const ctl = new AbortController();
    const t = setTimeout(() => {
      estimar(id, JSON.parse(firma) as string[], ctl.signal).then(
        c => {
          setEst(c);
          setSinCosto(false);
          alMin.current(c.minutos ?? null);
        },
        e => {
          // sin cifra no hay botón que cobre: se dice y se ofrece reintentar
          if (!(e instanceof DOMException && e.name === 'AbortError')) setSinCosto(true);
        },
      );
    }, ESPERA_ESTIMAR_MS);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [id, firma, intento]);

  // ── autoguardado: un refresh o un cierre ya no destruyen el guion editado
  const vivo = useRef({ escenas: textos, voz, elegida, nombre, ocupado });
  useEffect(() => {
    vivo.current = { escenas: textos, voz, elegida, nombre, ocupado };
  });
  const sinGuardar = useRef(false);
  const reloj = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const guardando = useRef(false);

  const autoguardar = useRef(async () => undefined as void);
  useEffect(() => {
    autoguardar.current = async () => {
      const v = vivo.current;
      if (guardando.current || v.ocupado === 'producir') return;
      if (!limpias(v.escenas).length) return; // jamás persistir un guion vacío
      guardando.current = true;
      try {
        await guardarGuion(id, cuerpoGuion(narracion, v.escenas, v.voz || null));
        if (v.elegida != null) await guardarPersonaje(id, v.elegida, v.nombre);
        sinGuardar.current = false;
        setGuardado(GUARDADO + new Date().toTimeString().slice(0, 5));
      } catch {
        setGuardado('Sin guardar, reintentando…');
        clearTimeout(reloj.current);
        reloj.current = setTimeout(() => void autoguardar.current(), REINTENTO_GUARDAR_MS);
      } finally {
        guardando.current = false;
      }
    };
  });

  function cambio() {
    sinGuardar.current = true;
    setGuardado('Guardando…');
    clearTimeout(reloj.current);
    reloj.current = setTimeout(() => void autoguardar.current(), ESPERA_GUARDAR_MS);
  }

  useEffect(() => {
    const antes = (e: BeforeUnloadEvent) => {
      if (sinGuardar.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', antes);
    return () => {
      window.removeEventListener('beforeunload', antes);
      clearTimeout(reloj.current);
    };
  }, []);

  // ── producir: guarda lo que se ve y cobra
  async function alProducir() {
    setFalla(null);
    if (ocupado) return;
    if (elegida == null) {
      setFalla({ texto: 'Elige una opción de personaje.' });
      return;
    }
    if (!limpias(textos).length) {
      setFalla({ texto: narracion ? 'Escribe la narración antes de producir.' : 'Escribe al menos una escena.' });
      return;
    }
    setOcupado('producir');
    clearTimeout(reloj.current);
    try {
      await guardarGuion(id, cuerpoGuion(narracion, textos, voz || null));
      await guardarPersonaje(id, elegida, nombre);
      // M22 · G: con «manual» la producción para a enseñar las imágenes
      const p = await producir(id, modoImg === 'manual');
      sinGuardar.current = false;
      refrescarSaldo();
      alCambiar(p);
      return true; // UI·19: se cobró
    } catch (e) {
      setFalla({ texto: mensaje(e), sinSaldo: e instanceof ErrorApi && e.sinSaldo });
    } finally {
      setOcupado(null);
    }
  }

  const total = precioDe(proyecto.duracion_s);
  const creditos = est?.creditos ?? null;
  const saldoProd = saldo ?? est?.creditos_saldo ?? null;
  const faltan = creditos != null && saldoProd != null ? Math.max(0, creditos - saldoProd) : 0;

  return (
    <>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <Personaje
            proyecto={proyecto}
            elegida={elegida}
            nombre={nombre}
            idNombre={idNombre}
            ocupado={ocupado}
            saldo={saldo}
            alNombre={n => {
              setNombre(n);
              cambio();
            }}
            alElegir={i => {
              setElegida(i);
              cambio();
            }}
            alCambiar={p => {
              setElegida(p.personaje.elegida ?? null);
              alCambiar(p);
            }}
            alOcupar={o => setOcupado(o ? 'cambiar' : null)}
          />
          <Voces
            proyecto={proyecto}
            voz={voz}
            idVoz={idVoz}
            alElegir={v => {
              setVoz(v);
              cambio();
            }}
          />
        </div>

        <Tarjeta titulo={narracion ? 'Narración (texto corrido)' : 'Guion (una escena por bloque)'} icono="guion">
          <p className="m-0 mb-3 text-xs text-secundario">
            {narracion
              ? 'Edita la narración completa; el video se corta sobre la voz. ~2 palabras/s.'
              : 'Edita lo que quieras. Cada bloque es una escena narrada; ~2 palabras/s. Más de 14 palabras obliga a partir la escena (cuesta más).'}
          </p>
          {narracion ? (
            <textarea
              value={escenas[0]?.t ?? ''}
              aria-label="Narración completa"
              onChange={e => {
                const t = e.target.value;
                setEscenas([{ k: 0, t }]);
                cambio();
              }}
              className="min-h-[220px] w-full resize-y rounded-medio border border-campo bg-elevada p-2.5 text-sm text-texto"
            />
          ) : (
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {escenas.map((e, i) => {
                const meta = metaEscena(e.t);
                return (
                  <li key={e.k} className="flex gap-2">
                    <span className="w-7 shrink-0 pt-2.5 text-right tabular-nums text-secundario" aria-hidden="true">
                      {i + 1}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <textarea
                        value={e.t}
                        aria-label={'Escena ' + (i + 1)}
                        onChange={ev => {
                          const t = ev.target.value;
                          setEscenas(l => l.map(x => (x.k === e.k ? { ...x, t } : x)));
                          cambio();
                        }}
                        className="field-sizing-content min-h-16 w-full resize-y rounded-medio border border-campo bg-elevada p-2.5 text-sm text-texto"
                      />
                      <span className={unir('text-right text-xs tabular-nums', meta.aviso ? 'text-ambar-claro' : 'text-secundario')}>
                        {meta.texto}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={'Quitar escena ' + (i + 1)}
                      title="Quitar la escena"
                      onClick={() => {
                        setEscenas(l => l.filter(x => x.k !== e.k));
                        cambio();
                      }}
                      className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-medio border-0 bg-transparent p-0 text-secundario hover:bg-elevada hover:text-texto"
                    >
                      <Icono nombre="cerrar" />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {!narracion && (
            <div className="mt-2">
              <Boton
                nivel="secundario"
                icono={<Icono nombre="mas" />}
                onClick={() => {
                  setEscenas(l => [...l, { k: nuevaClave(l), t: '' }]);
                  cambio();
                }}
              >
                Añadir escena
              </Boton>
            </div>
          )}
          <p className="m-0 mt-2 text-xs text-secundario">{textoEstimado(narracion, textos, proyecto.duracion_s)}</p>
        </Tarjeta>
      </div>

      {proyecto.dossier && (
        <section className="mt-3 rounded-grande border border-linea bg-superficie p-4">
          <details>
            <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-secundario">
              <Icono nombre="contexto" />
              Contexto investigado ({proyecto.fuentes.length} fuentes)
            </summary>
            <p className="whitespace-pre-wrap text-sm">{proyecto.dossier}</p>
            <ul className="text-sm">
              {proyecto.fuentes.map((u, i) => (
                <li key={i} className="break-words">
                  {esHttp(u) ? (
                    <a href={u} target="_blank" rel="noopener noreferrer" className="text-enlace underline underline-offset-4 hover:text-texto">
                      {u}
                    </a>
                  ) : (
                    u
                  )}
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      <div className="mt-3 bg-fondo pb-3.5 pt-2.5 md:sticky md:bottom-0">
        {/* M22 · G: quién revisa las imágenes. Una decisión, dos chips. */}
        <div role="radiogroup" aria-label="Cuándo revisar las imágenes" className="mb-2.5 flex flex-wrap gap-2">
          <Chip rol="radio" puesto={modoImg === 'auto'} onClick={() => setModoImg('auto')}>
            <Icono nombre="rapido" />
            De corrido
          </Chip>
          <Chip rol="radio" puesto={modoImg === 'manual'} onClick={() => setModoImg('manual')}>
            <Icono nombre="imagen" />
            Enséñame las imágenes antes de animar
          </Chip>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {creditos != null ? (
            <BotonCobro
              verbo="Producir"
              costo={creditos}
              saldo={saldoProd}
              trabajando="Guardando y produciendo…"
              deshabilitado={ocupado === 'cambiar'}
              alCobrar={alProducir}
            />
          ) : est ? (
            // sin monedero (dev local) no hay créditos que poner tras la estrella
            <Boton nivel="principal" trabajando={ocupado === 'producir' && 'Guardando y produciendo…'} disabled={!!ocupado} onClick={() => void alProducir()}>
              Producir
            </Boton>
          ) : (
            <Boton nivel="principal" disabled>
              Producir
            </Boton>
          )}
          {!est && sinCosto ? (
            <p className="m-0 text-xs text-secundario">
              No pudimos calcular el costo.{' '}
              <Boton nivel="enlace" className="text-xs" onClick={() => setIntento(n => n + 1)}>
                Reintentar
              </Boton>
            </p>
          ) : (
          <p className="m-0 text-xs text-secundario">
            {!est
              ? 'Calculando el costo…'
              : creditos != null
                ? (total != null ? 'Con los ' + PREPARAR + ' créditos del guion, tu película suma ' + total + '. ' : '') +
                  (est.minutos ? (faltan > 0 || saldoProd == null ? '~' + est.minutos + ' min.' : 'Te quedan ' + saldoProd + ' créditos · ~' + est.minutos + ' min.') : '')
                : (est.total != null ? '≈ ' + dolares(est.total) + ' · ' : '') + (est.minutos ? '~' + est.minutos + ' min.' : '')}
          </p>
          )}
        </div>
        {guardado && (
          <p className="m-0 mt-1 text-xs text-secundario" role="status">
            {/* UI·24: lo que sí se guardó lleva su palomita, en la misma nota
                que ya anuncia «Guardando…» (una sola región) */}
            {guardado.startsWith(GUARDADO) ? <Guardado anuncia={false}>{guardado}</Guardado> : guardado}
          </p>
        )}
        {falla && (
          <p role="alert" className="m-0 mt-1 whitespace-pre-wrap text-sm text-error">
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
    </>
  );
}

function Personaje({
  proyecto,
  elegida,
  nombre,
  idNombre,
  ocupado,
  saldo,
  alNombre,
  alElegir,
  alCambiar,
  alOcupar,
}: {
  proyecto: Proyecto;
  elegida: number | null;
  nombre: string;
  idNombre: string;
  ocupado: null | 'producir' | 'cambiar';
  saldo: number | null;
  alNombre: (n: string) => void;
  alElegir: (i: number) => void;
  alCambiar: (p: Proyecto) => void;
  alOcupar: (o: boolean) => void;
}) {
  const opciones = proyecto.personaje.opciones;
  const [creando, setCreando] = useState(false);
  const [msgGenerar, setMsgGenerar] = useState<string | null>(null);
  const [pedido, setPedido] = useState('');
  const [msgCambio, setMsgCambio] = useState<Falla | null>(null);
  const [cambiando, setCambiando] = useState(false);
  const idPedido = useId();

  // no cobra: va incluido en los créditos del guion
  async function generar() {
    setCreando(true);
    setMsgGenerar(null);
    try {
      alCambiar(await generarOpciones(proyecto.id));
    } catch (e) {
      setMsgGenerar(mensaje(e));
    } finally {
      setCreando(false);
    }
  }

  async function cambiar() {
    setMsgCambio(null);
    const instruccion = pedido.trim();
    // lo que se puede decir antes de cobrar se dice antes
    if (!instruccion) {
      setMsgCambio({ texto: 'Escribe qué quieres cambiar.' });
      return;
    }
    if (elegida == null) {
      setMsgCambio({ texto: 'Primero elige la opción a modificar.' });
      return;
    }
    alOcupar(true);
    setCambiando(true);
    try {
      const p = await modificarPersonaje(proyecto.id, instruccion, elegida);
      setPedido('');
      setCambiando(false); // el orbe se va antes de que aparezca la imagen nueva
      refrescarSaldo();
      alCambiar(p);
      return true; // UI·19: se cobró
    } catch (e) {
      setMsgCambio({ texto: mensaje(e), sinSaldo: e instanceof ErrorApi && e.sinSaldo });
    } finally {
      setCambiando(false);
      alOcupar(false);
    }
  }

  return (
    <Tarjeta titulo="Elige tu personaje" icono="personaje">
      <label htmlFor={idNombre} className="sr-only">
        Nombre del personaje
      </label>
      <input
        id={idNombre}
        type="text"
        value={nombre}
        onChange={e => alNombre(e.target.value)}
        placeholder="Nombre del personaje"
        className="mb-2.5 min-h-11 w-full rounded-medio border border-campo bg-elevada px-3 text-sm text-texto"
      />
      {opciones.length ? (
        <div role="group" aria-label="Opciones del personaje" className="grid grid-cols-2 gap-3">
          {opciones.map((o, i) => (
            <button
              key={i + o.path}
              type="button"
              aria-pressed={elegida === i}
              aria-label={'Opción ' + (i + 1) + ' del personaje'}
              onClick={() => alElegir(i)}
              className={unir(
                'cursor-pointer overflow-hidden rounded-medio border-[3px] bg-transparent p-0',
                elegida === i ? 'border-texto' : 'border-transparent hover:border-campo',
              )}
            >
              <img src={archivo(proyecto.id, rutaOpcion(o.path))} alt="" className="block w-full" />
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <p className="m-0 text-xs text-secundario">Aún no hay opciones de personaje.</p>
          <Boton nivel="secundario" trabajando={creando && 'Dibujando…'} onClick={() => void generar()}>
            Crear 2 opciones
          </Boton>
          {creando && (
            <EsperaIA
              texto="Dibujando 2 opciones de personaje · ~30 s"
              tope={TOPE_MS}
              textoAlAgotar={TARDA + 'Si no aparecen las opciones, inténtalo otra vez.'}
            />
          )}
          <p className={unir('m-0 text-xs', msgGenerar ? 'text-error' : 'text-secundario')} role={msgGenerar ? 'alert' : undefined}>
            {msgGenerar ?? 'Sin costo: va incluido en los créditos del guion.'}
          </p>
        </div>
      )}
      {opciones.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-2">
          <div className="flex flex-wrap items-start gap-2">
            <label htmlFor={idPedido} className="sr-only">
              Qué cambiar de la opción elegida
            </label>
            <input
              id={idPedido}
              type="text"
              value={pedido}
              onChange={e => setPedido(e.target.value)}
              disabled={cambiando}
              placeholder="Pide un cambio, p. ej. «ponle lentes»"
              className="min-h-11 min-w-0 flex-1 basis-56 rounded-medio border border-campo bg-elevada px-3 text-sm text-texto"
            />
            <BotonCobro
              verbo="Cambiar"
              nivel="secundario"
              costo={TARIFA_IMAGEN}
              saldo={saldo}
              trabajando="Cambiando…"
              deshabilitado={ocupado === 'producir'}
              alCobrar={cambiar}
            />
          </div>
          {cambiando && (
            <EsperaIA
              texto="Cambiando el personaje · ~20 s"
              tope={TOPE_MS}
              textoAlAgotar={TARDA + 'Si no cambia la imagen, inténtalo otra vez; si te descontaron créditos, escríbenos.'}
            />
          )}
          {msgCambio && (
            <p role="alert" className="m-0 text-xs text-error">
              {msgCambio.texto}
              {msgCambio.sinSaldo && (
                <>
                  {' '}
                  <Recarga className="text-xs" />
                </>
              )}
            </p>
          )}
        </div>
      )}
      {proyecto.personaje.descripcion && (
        <details className="mt-2.5">
          <summary className="flex min-h-11 cursor-pointer items-center text-secundario">Descripción detectada</summary>
          <p className="m-0 text-xs text-secundario">{proyecto.personaje.descripcion}</p>
        </details>
      )}
    </Tarjeta>
  );
}

function Voces({
  proyecto,
  voz,
  idVoz,
  alElegir,
}: {
  proyecto: Proyecto;
  voz: string;
  idVoz: string;
  alElegir: (v: string) => void;
}) {
  const lista = vocesDe(proyecto);
  const audio = useRef<HTMLAudioElement>(null);
  const [cargando, setCargando] = useState(false);
  const [oir, setOir] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);
  const motivo = lista.find(v => v.id === voz)?.motivo ?? '';

  // M1: muestra fija por voz, cacheada en el servidor: escuchar es gratis
  function escuchar() {
    setFallo(false);
    setCargando(true);
    setOir(voz);
  }

  return (
    <Tarjeta titulo="Voz del narrador" icono="voz">
      <p className="m-0 text-xs text-secundario">
        Una sola voz para toda la película, ordenadas por ajuste al guion: <Punto c="bg-exito" /> encaja · <Punto c="bg-ambar-claro" /> tal vez
        · <Punto c="bg-error" /> no encaja.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label htmlFor={idVoz} className="sr-only">
          Voz del narrador
        </label>
        <select
          id={idVoz}
          value={voz}
          onChange={e => {
            alElegir(e.target.value);
            setOir(null);
          }}
          className="min-h-11 min-w-0 flex-1 rounded-medio border border-campo bg-elevada px-2.5 text-sm text-texto"
        >
          {lista.map(v => (
            <option key={v.id} value={v.id}>
              {v.id} · {NIVEL[v.nivel] ?? ''}
            </option>
          ))}
        </select>
        <Boton
          nivel="secundario"
          icono={<Icono nombre="escuchar" />}
          trabajando={cargando && 'Cargando…'}
          title="Muestra fija de la voz, sin costo"
          onClick={escuchar}
        >
          Escuchar
        </Boton>
      </div>
      {motivo && <p className="m-0 mt-2 text-xs text-secundario">{motivo}</p>}
      {oir && (
        // una muestra de voz de una frase («Hola, mi nombre es…»): no hay pista de subtítulos
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio
          ref={audio}
          key={oir}
          src={muestraVoz(oir)}
          controls
          className="mt-2 w-full"
          onCanPlay={() => {
            setCargando(false);
            void audio.current?.play().catch(() => undefined);
          }}
          onError={() => {
            setCargando(false);
            setFallo(true);
            setOir(null);
          }}
        />
      )}
      {fallo && (
        <div className="mt-2">
          <Aviso tipo="error">No se pudo cargar la muestra de voz. Intenta de nuevo.</Aviso>
        </div>
      )}
    </Tarjeta>
  );
}

function Punto({ c }: { c: string }) {
  return <span aria-hidden="true" className={unir('inline-block size-2.5 rounded-full align-middle', c)} />;
}
