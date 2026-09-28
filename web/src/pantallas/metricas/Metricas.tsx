// /estudio/metricas/ — lo que ya salió por Blotato, lo que no salió y cómo
// rinde (UI·8.6). No cobra nada. Paridad con static/metricas.html; los avisos
// viven en la pantalla y no en el cuadro de trabajos.js.
//
// Dos listas de UNA misma respuesta: «Recientes» (/v2/posts, la única que
// trae las fallidas) y «Las más vistas» (/v2/analytics). Fallan por separado
// y cada una conserva lo suyo; cambiar de vista no gasta llamada. Una carga a
// la vez, y la que se pide mientras hay otra se encola.
import { useCallback, useEffect, useRef, useState } from 'react';

import { Marco } from '../../marca/Marco';
import { Aviso } from '../../ui/Aviso';
import { Boton } from '../../ui/Boton';
import { Icono } from '../../ui/Icono';
import { unir as clases } from '../../ui/unir';
import { GraficaVistas } from './Grafica';
import {
  barrasVistas,
  cargar,
  casillas,
  CONECTAR,
  conNumeros,
  delta,
  enlaceSeguro,
  ETIQUETAS,
  estado,
  fecha,
  mensaje,
  num,
  pedirNumeros,
  QUE_REC,
  QUE_TOP,
  rutaTramo,
  texto,
  tieneNumeros,
  TOPE,
  unir,
  valor,
  ventana,
  type Publicacion,
} from './logica';

type Vista = 'rec' | 'top';

interface Falla {
  texto: string;
  conectar: boolean;
  reintentar?: () => void;
}

interface Pendiente {
  mas: boolean;
  listos: (() => void)[];
}

export function Metricas() {
  const [rec, setRec] = useState<Publicacion[]>([]);
  const [top, setTop] = useState<Publicacion[]>([]);
  const [vista, setVista] = useState<Vista>('rec');
  // null = nadie ha respondido todavía; si no, qué respondió la última carga
  const [ultima, setUltima] = useState<{ lista: boolean; numeros: boolean } | null>(null);
  const [tramo, setTramo] = useState<{ desde: string | null; hasta: string | null; cursor: string | null; ultimo: boolean }>(
    { desde: null, hasta: null, cursor: null, ultimo: false },
  );
  // «Las más vistas» lleva su PROPIO tramo: si los números fallan mientras la
  // lista avanza, ponerles la fecha nueva sería atribuirlos a otro mes
  const [tramoTop, setTramoTop] = useState<{ desde: string | null; hasta: string | null }>({ desde: null, hasta: null });
  const [ocupado, setOcupado] = useState(true);
  const [falla, setFalla] = useState<Falla | null>(null);
  const [nota, setNota] = useState('');
  const [anuncio, setAnuncio] = useState('');
  // por id y NUNCA por posición: una lista que se repinta no abre la de al lado
  const [abiertos, setAbiertos] = useState<ReadonlySet<string>>(new Set());
  // «Preguntando…» vive en el estado, no en el botón: repintar no lo revive
  const [pidiendo, setPidiendo] = useState<ReadonlySet<string>>(new Set());

  const recRef = useRef<Publicacion[]>([]);
  const topRef = useRef<Publicacion[]>([]);
  const tramoRef = useRef(tramo);
  const cargando = useRef(false);
  const pendiente = useRef<Pendiente | null>(null);
  const pidiendoRef = useRef(new Set<string>());

  const ponerRec = (l: Publicacion[]) => {
    recRef.current = l;
    setRec(l);
  };
  const ponerTop = (l: Publicacion[]) => {
    topRef.current = l;
    setTop(l);
  };

  // cargar entra por aquí: si ya hay una carga, esta espera su turno
  const cargarTramo = useCallback((mas = false): Promise<void> => {
    function pedirCarga(m: boolean): Promise<void> {
      if (!cargando.current) return ya(m);
      if (pendiente.current) pendiente.current.mas = m;
      else pendiente.current = { mas: m, listos: [] };
      const p = pendiente.current;
      return new Promise(r => p.listos.push(r));
    }

    async function ya(mas: boolean): Promise<void> {
      cargando.current = true;
      setOcupado(true);
      setFalla(null);
      setAnuncio('');
      const reintentar = () => void pedirCarga(mas);
      try {
        const t = tramoRef.current;
        const j = await cargar(rutaTramo(mas, t.desde, t.hasta, t.cursor));
        const items = Array.isArray(j.items) ? j.items : [];
        // lo que respondió se pinta aunque lo otro fallara
        if (j.hay_lista) {
          ponerRec(mas ? unir(recRef.current, items) : items);
          // el tramo que manda es SIEMPRE el de la última página que llegó
          tramoRef.current = {
            cursor: typeof j.cursor === 'string' && j.cursor ? j.cursor : null,
            desde: j.desde || t.desde,
            hasta: j.hasta || t.hasta,
            ultimo: !!j.ultimo_tramo,
          };
          setTramo(tramoRef.current);
        }
        if (j.hay_numeros) {
          ponerTop(Array.isArray(j.mejores) ? j.mejores : []);
          setTramoTop({ desde: j.desde || null, hasta: j.hasta || null });
        }
        setUltima({ lista: !!j.hay_lista, numeros: !!j.hay_numeros });
        if (j.error) setFalla({ texto: j.error, conectar: !!j.reconectar, reintentar });
        // el aviso del recorte NO es un error: va en gris y aparte
        setNota(j.aviso || '');
      } catch (e) {
        setUltima({ lista: false, numeros: false });
        setFalla({ texto: mensaje(e), conectar: estado(e) === 409, reintentar });
      } finally {
        cargando.current = false;
        setOcupado(false);
        const pend = pendiente.current;
        pendiente.current = null;
        if (pend) {
          await ya(pend.mas);
          pend.listos.forEach(r => r());
        }
      }
    }

    return pedirCarga(mas);
  }, []);



  // UNA carga al abrir: StrictMode monta dos veces y serían cuatro llamadas a Blotato
  const arrancada = useRef(false);
  useEffect(() => {
    if (arrancada.current) return;
    arrancada.current = true;
    Promise.resolve().then(() => cargarTramo());
  }, [cargarTramo]);

  function alternar(id: string) {
    setAbiertos(s => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  }

  // UNA llamada, solo para lo que el server marcó «no lo sabemos». Si
  // responde, el botón no vuelve: Blotato no mide de nuevo porque se lo pidamos.
  async function preguntar(it: Publicacion) {
    if (pidiendoRef.current.has(it.id)) return;
    pidiendoRef.current.add(it.id);
    setPidiendo(new Set(pidiendoRef.current));
    setFalla(null);
    try {
      const j = await pedirNumeros(it.id);
      // la misma publicación puede estar en las dos listas: se escribe en las dos
      ponerRec(conNumeros(recRef.current, j, it.id));
      ponerTop(conNumeros(topRef.current, j, it.id));
      if (j.numeros) setAbiertos(s => new Set(s).add(it.id));
      const vistas = j.numeros ? num(j.numeros.vistas) : '';
      setAnuncio(vistas ? `${it.red}: ${vistas} vistas.` : `${it.red}: ${j.motivo ?? ''}`);
    } catch (e) {
      // lo que falló de verdad sí se puede reintentar
      setFalla({ texto: mensaje(e), conectar: estado(e) === 409 });
    } finally {
      pidiendoRef.current.delete(it.id);
      setPidiendo(new Set(pidiendoRef.current));
    }
  }

  const esTop = vista === 'top';
  const lista = esTop ? top : rec;
  const v = esTop ? ventana(tramoTop.desde, tramoTop.hasta) : ventana(tramo.desde, tramo.hasta);
  const tope = !esTop && tramo.ultimo && !tramo.cursor ? ` · ${TOPE}` : '';
  const rotulo = (esTop ? QUE_TOP : QUE_REC) + (v ? ` ${v}${tope}.` : '');
  // quien mira diez tarjetas no se queda en blanco porque falló la OTRA llamada
  const caida = ultima !== null && !lista.length && !(esTop ? ultima.numeros : ultima.lista);
  const hayMas = !esTop && ultima !== null && (!!tramo.cursor || !tramo.ultimo);

  return (
    <Marco
      pantalla="metricas"
      titulo="Cómo rinden tus publicaciones"
      bajada={
        <p className="m-0 text-md">
          Todo lo que salió de tu cuenta de Blotato —y lo que no pudo salir—, aunque lo hayas publicado desde otro
          lado. Blotato recoge los números por tandas, desde un par de horas después de publicar: no se pueden pedir
          antes de que los recoja.
        </p>
      }
    >
      <div className="max-w-[900px]">
        <section className="rounded-grande border border-linea bg-superficie p-4 sm:p-6" aria-labelledby="mt-titulo">
          {/* los títulos del detalle son h3: sin este h2 se saltaría un nivel */}
          <h2 id="mt-titulo" className="sr-only">
            Tus publicaciones
          </h2>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <div role="group" aria-label="Qué lista ver" className="mr-auto flex flex-wrap gap-2">
              {(
                [
                  ['rec', 'Recientes'],
                  ['top', 'Las más vistas'],
                ] as const
              ).map(([id, et]) => (
                <Boton
                  key={id}
                  nivel="secundario"
                  denso
                  aria-pressed={vista === id}
                  disabled={ocupado}
                  onClick={() => setVista(id)}
                  // elegir no es ámbar (docs/DISENO.md §3): la puesta, en blanco
                  className="aria-pressed:border-texto aria-pressed:bg-elevada aria-pressed:font-semibold"
                >
                  {et}
                </Boton>
              ))}
            </div>
            <Boton nivel="secundario" denso disabled={ocupado} onClick={() => void cargarTramo()}>
              Actualizar
            </Boton>
          </div>
          <p className="m-0 text-xs text-secundario">{rotulo}</p>
          {nota && <p className="m-0 mt-1 text-xs text-secundario">{nota}</p>}
          <p role="status" aria-live="polite" className="m-0 text-sm text-exito empty:hidden">
            {anuncio}
          </p>

          {falla && (
            <div className="mt-3">
              <Aviso tipo="error">
                {falla.texto}
                {falla.conectar ? (
                  <>
                    {' '}
                    <a className="text-enlace hover:text-texto" href={CONECTAR}>
                      Conectar Blotato
                    </a>
                  </>
                ) : (
                  falla.reintentar && (
                    <>
                      {' '}
                      <Boton nivel="enlace" onClick={falla.reintentar}>
                        Reintentar
                      </Boton>
                    </>
                  )
                )}
              </Aviso>
            </div>
          )}

          {lista.length ? (
            <ul className="m-0 mt-4 list-none p-0">
              {lista.map((it, i) => (
                <TarjetaPublicacion
                  key={it.id}
                  it={it}
                  puesto={esTop ? i + 1 : 0}
                  abierto={abiertos.has(it.id)}
                  pidiendo={pidiendo.has(it.id)}
                  apagada={ocupado}
                  alAlternar={() => alternar(it.id)}
                  alPedir={() => void preguntar(it)}
                />
              ))}
            </ul>
          ) : (
            <p className="m-0 mt-4 py-2 text-xs text-secundario">
              {ultima === null
                ? 'Buscando tus publicaciones…'
                : caida
                  ? 'No pudimos traer tus publicaciones ahora. Pulsa «Actualizar» para intentarlo de nuevo.'
                  : esTop
                    ? 'Todavía no hay ninguna publicación medida en este tramo.'
                    : 'En este tramo no publicaste nada. Prueba con «Ver más» para mirar más atrás.'}
            </p>
          )}

          {hayMas && (
            <Boton nivel="secundario" className="mt-2" disabled={ocupado} onClick={() => void cargarTramo(true)}>
              {tramo.cursor ? 'Ver más' : 'Ver 30 días más atrás'}
            </Boton>
          )}
        </section>
      </div>
    </Marco>
  );
}

function TarjetaPublicacion({
  it,
  puesto,
  abierto,
  pidiendo,
  apagada,
  alAlternar,
  alPedir,
}: {
  it: Publicacion;
  puesto: number;
  abierto: boolean;
  pidiendo: boolean;
  apagada: boolean;
  alAlternar: () => void;
  alPedir: () => void;
}) {
  const fallida = it.estado === 'fallido';
  const t = texto(it);
  const cas = casillas(it.numeros);
  const enlace = enlaceSeguro(it.enlace);
  const medios = typeof it.medios === 'number' && it.medios > 0 ? it.medios : 0;
  const conNumeros = tieneNumeros(it);
  const idDetalle = 'det-' + it.id;
  return (
    <li className={clases('mb-3 rounded-grande border p-4', fallida ? 'border-peligro-borde' : 'border-linea')}>
      <div className="flex flex-wrap items-baseline gap-2">
        {puesto > 0 && <span className="text-xs text-secundario tabular-nums">{puesto}.</span>}
        <b className="font-titulo text-titulo-sm font-bold">{it.red}</b>
        <span
          className={clases(
            'whitespace-nowrap rounded-chico border bg-elevada px-3 py-1 text-xs',
            fallida ? 'border-peligro-borde text-error' : 'border-linea text-secundario',
          )}
        >
          {fallida ? 'No salió' : 'Publicada'}
        </span>
        <span className="ml-auto whitespace-nowrap rounded-chico border border-linea bg-elevada px-3 py-1 text-xs text-secundario tabular-nums">
          {fecha(it.cuando)}
        </span>
      </div>
      {t ? (
        <p className="m-0 mt-2 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{t}</p>
      ) : (
        <p className="m-0 mt-2 text-sm text-secundario">Sin texto</p>
      )}
      {/* lo redacta la red social, no Blotato: el texto menos fiable de la pantalla */}
      {fallida && it.error_red && <p className="m-0 mt-2 text-sm text-error">{it.error_red}</p>}
      {cas.length > 0 && (
        <>
          <div className="mt-3 flex flex-wrap gap-6 tabular-nums">
            {cas.map(([n, et]) => (
              <div key={et} className="min-w-[76px]">
                <b className="block text-titulo-sm font-semibold">{n}</b>
                <span className="text-xs text-secundario">{et}</span>
              </div>
            ))}
          </div>
          <p className="m-0 text-xs text-secundario tabular-nums">
            {it.medido ? `Medido el ${fecha(it.medido)} (tu hora). ` : ''}
            {delta(it)}
          </p>
        </>
      )}
      {!it.numeros && it.motivo && <p className="m-0 mt-2 text-xs text-secundario">{it.motivo}</p>}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
        {enlace && (
          <a
            href={enlace}
            target="_blank"
            rel="noopener noreferrer"
            className="mr-auto inline-flex min-h-11 items-center gap-1 text-sm text-enlace hover:text-texto"
          >
            Ver la publicación
            <Icono nombre="externo" />
          </a>
        )}
        {medios > 0 && (
          <span className={clases('inline-flex items-center gap-1 text-xs text-secundario', !enlace && 'mr-auto')}>
            <Icono nombre="adjunto" />
            {medios} {medios === 1 ? 'archivo' : 'archivos'}
          </span>
        )}
        {conNumeros ? (
          <Boton nivel="secundario" denso aria-expanded={abierto} aria-controls={idDetalle} disabled={apagada} onClick={alAlternar}>
            {abierto ? 'Ocultar el resto' : 'Ver el resto'}
          </Boton>
        ) : (
          // solo para lo que NO sabemos: un botón que garantiza «no hay nada» es un botón roto
          it.puede_pedir && (
            <Boton nivel="secundario" denso disabled={apagada || pidiendo} onClick={alPedir}>
              {pidiendo ? 'Preguntando…' : 'Ver números'}
            </Boton>
          )
        )}
      </div>
      {abierto && (
        <div id={idDetalle} className="mt-3 border-t border-linea pt-3">
          <Detalle it={it} />
        </div>
      )}
    </li>
  );
}

function Detalle({ it }: { it: Publicacion }) {
  const datos = Array.isArray(it.detalle) ? it.detalle : [];
  const h = Array.isArray(it.historial) ? it.historial : [];
  const g = barrasVistas(h);
  if (!datos.length && h.length < 2)
    return <p className="m-0 text-xs text-secundario">No hay nada más que enseñar de esta publicación.</p>;
  return (
    <>
      {datos.length > 0 && (
        <>
          <h3 className="m-0 mb-2 text-sm font-semibold">Todo lo que informó {it.red}</h3>
          <dl className="m-0 mb-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs tabular-nums">
            {datos.map((d, i) => (
              <div key={(d.clave ?? d.etiqueta) + i} className="contents">
                <dt className="text-secundario">{d.etiqueta}</dt>
                <dd className="m-0 text-right">{valor(d)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {h.length >= 2 && (
        <>
          <h3 className="m-0 mb-2 text-sm font-semibold">Cómo fue cambiando</h3>
          {/* UI·23: la gráfica va encima; la tabla se queda, con todo */}
          {g && <GraficaVistas id={it.id} barras={g.barras} de={g.de} />}
          {/* una tabla de mediciones no cabe en un teléfono: rueda ella, no la página.
              Lo que rueda se tiene que poder rodar con el teclado (axe:
              scrollable-region-focusable), por eso lleva tabIndex */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Mediciones">
            <table className="w-full border-collapse text-xs tabular-nums">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-b border-linea py-1 pr-3 text-left font-medium text-secundario">
                    Medido
                  </th>
                  {ETIQUETAS.map(([, et]) => (
                    <th key={et} className="whitespace-nowrap border-b border-linea py-1 pr-3 text-right font-medium text-secundario">
                      {et}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {h
                  .slice()
                  .reverse()
                  .map((f, i) => (
                    <tr key={f.cuando + i}>
                      <td className="whitespace-nowrap py-1 pr-3 text-left">{fecha(f.cuando)}</td>
                      {ETIQUETAS.map(([k]) => (
                        <td key={k} className="whitespace-nowrap py-1 pr-3 text-right">
                          {num(f.numeros?.[k])}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
