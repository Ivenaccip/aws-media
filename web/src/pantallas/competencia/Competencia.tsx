// /estudio/competencia/ — investiga tu competencia (UI·8.2). Guardar cuentas
// no cuesta; «Revisar ✦ N» cobra la tarifa por cada cuenta vigilada.
// Paridad con static/competencia.html. Lo que escribe la red social (pies de
// foto, ligas) llega por el actor de Apify: React lo pinta como texto y una
// liga que no es http(s) no se enlaza.
import { useId, useRef, useState } from 'react';

import { BotonCobro } from '../../marca/BotonCobro';
import { EsperaIA } from '../../marca/EsperaIA';
import { Marco } from '../../marca/Marco';
import { NotaSaldo } from '../../marca/NotaSaldo';
import { Recarga } from '../../marca/Recarga';
import { refrescarSaldo, useSaldo } from '../../marca/useSaldo';
import { ErrorApi } from '../../nucleo/api';
import { useListaViva } from '../../nucleo/useListaViva';
import { useTituloPestana } from '../../nucleo/useTituloPestana';
import { Aviso } from '../../ui/Aviso';
import { Boton } from '../../ui/Boton';
import { Icono } from '../../ui/Icono';
import { Tarjeta } from '../../ui/Tarjeta';
import { unir } from '../../ui/unir';
import {
  abrirInforme,
  agregar,
  cargar,
  dia,
  duracionLarga,
  hrefSeguro,
  indice,
  nombreRed,
  numero,
  plural,
  precioNota,
  quitar,
  revisar,
  vivos,
  type Informe,
  type Lectura,
  type Listado,
  type Publicacion,
  type Resumen,
} from './logica';

const AL_AGOTAR =
  'Llevamos un rato sin novedades. La revisión sigue en la nube: puedes cerrar la página y volver. ' +
  'Si sigue igual, escríbenos.';

type Mensaje = { texto: string; error: boolean; sinSaldo?: boolean } | null;

function Nota({ m }: { m: Mensaje }) {
  if (!m) return null;
  return (
    <p className={unir('mt-2 mb-0 text-sm', m.error ? 'text-error' : 'text-secundario')} role={m.error ? 'alert' : 'status'}>
      {m.texto}
      {m.sinSaldo && (
        <>
          {' '}
          <Recarga />
        </>
      )}
    </p>
  );
}

const mensajeDe = (e: unknown, error = true): Mensaje => ({
  texto: e instanceof Error ? e.message : String(e),
  error,
  sinSaldo: e instanceof ErrorApi && e.sinSaldo,
});

export function Competencia() {
  const lista = useListaViva<Listado>(cargar, l => vivos(l).length > 0, { alTerminar: refrescarSaldo });
  const [url, setUrl] = useState('');
  const [agregando, setAgregando] = useState(false);
  const [notaCuenta, setNotaCuenta] = useState<Mensaje>(null);
  const [notaRevisar, setNotaRevisar] = useState<Mensaje>(null);
  const [falloQuitar, setFalloQuitar] = useState<string | null>(null);
  const saldo = useSaldo();
  const idUrl = useId();

  const d = lista.datos;
  const enMarcha = d ? vivos(d) : [];
  useTituloPestana(enMarcha.length ? 'Revisando a la competencia' : null);

  async function alAgregar() {
    const limpia = url.trim();
    if (!limpia) {
      setNotaCuenta({ texto: 'Pega la liga del perfil primero.', error: false });
      return;
    }
    setAgregando(true);
    setNotaCuenta(null);
    try {
      await agregar(limpia);
      setUrl('');
      await lista.actualizar();
    } catch (e) {
      setNotaCuenta(mensajeDe(e));
    } finally {
      setAgregando(false);
    }
  }

  async function alQuitar(id: string) {
    try {
      const r = await quitar(id);
      if (lista.datos) lista.poner({ ...lista.datos, cuentas: r.cuentas });
      setFalloQuitar(null);
      setNotaCuenta(null);
    } catch {
      setFalloQuitar(id);
    }
  }

  async function alRevisar() {
    setNotaRevisar(null);
    try {
      await revisar();
      refrescarSaldo();
      await lista.actualizar();
    } catch (e) {
      setNotaRevisar(mensajeDe(e));
    }
  }

  const n = d?.cuentas.length ?? 0;
  const tarifa = d?.credito_por_cuenta ?? null;

  return (
    <Marco
      pantalla="competencia"
      titulo="Investiga tu competencia"
      bajada={
        <p className="m-0 text-md">
          Guarda las cuentas que quieres vigilar y, cuando quieras, revisa qué les está funcionando: sus últimas
          publicaciones con sus números, ordenadas por lo que rindieron <b>para su propia cuenta</b> — no por vistas
          sueltas, que solo dicen quién tiene más seguidores. Guardar cuentas no cuesta nada; solo se cobra traer
          publicaciones nuevas.
        </p>
      }
    >
      <div className="max-w-[860px]">
        {lista.error && (
          <div className="mb-4">
            <Aviso tipo="error">
              No pudimos traer tus cuentas y revisiones. Revisa tu conexión e inténtalo de nuevo.{' '}
              <Boton nivel="enlace" onClick={() => void lista.actualizar()}>
                Reintentar
              </Boton>
            </Aviso>
          </div>
        )}

        <Tarjeta titulo="Las cuentas que vigilas" className="mb-6">
          {d === null && !lista.error && <p className="m-0 text-xs text-secundario">Cargando…</p>}
          {d && !n && <p className="m-0 text-xs text-secundario">Todavía no vigilas a nadie — pega la liga de un perfil abajo.</p>}
          {d && n > 0 && (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {d.cuentas.map(c => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-medio border border-linea px-3 py-1">
                  <span className="text-xs text-secundario">{nombreRed(c.red)}</span>
                  <b className="[overflow-wrap:anywhere]">@{c.cuenta}</b>
                  <Boton
                    nivel="peligro"
                    denso
                    className="ml-auto"
                    aria-label={`Quitar @${c.cuenta}`}
                    onClick={() => void alQuitar(c.id)}
                  >
                    Quitar
                  </Boton>
                </li>
              ))}
            </ul>
          )}
          {falloQuitar && (
            <div className="mt-3">
              <Aviso tipo="error">
                No pudimos quitar esa cuenta. Inténtalo de nuevo.{' '}
                <Boton nivel="enlace" onClick={() => void alQuitar(falloQuitar)}>
                  Reintentar
                </Boton>
              </Aviso>
            </div>
          )}

          <label htmlFor={idUrl} className="sr-only">
            Liga del perfil que quieres vigilar
          </label>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              id={idUrl}
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="instagram.com/lacuenta · tiktok.com/@lacuenta · youtube.com/@lacuenta"
              className="min-h-11 min-w-0 flex-[1_1_320px] rounded-medio border border-campo bg-elevada px-3 text-sm text-texto"
            />
            <Boton nivel="secundario" trabajando={agregando && 'Agregando…'} onClick={() => void alAgregar()}>
              Agregar
            </Boton>
          </div>
          <Nota m={notaCuenta} />

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {tarifa !== null && n > 0 ? (
              <BotonCobro verbo="Revisar" costo={tarifa * n} saldo={saldo} trabajando="Revisando…" alCobrar={alRevisar} />
            ) : (
              <Boton nivel="principal" disabled>
                Revisar
              </Boton>
            )}
            {d && tarifa !== null && (
              <span className="text-xs text-secundario">{precioNota(tarifa, n, d.max_cuentas)}</span>
            )}
          </div>
          {tarifa !== null && n > 0 && (
            <div className="mt-2">
              <NotaSaldo saldo={saldo} costo={tarifa * n} />
            </div>
          )}
          <Nota m={notaRevisar} />
        </Tarjeta>

        <Tarjeta titulo="Tus revisiones">
          {lista.sinRed && (
            <div className="mb-3">
              <Aviso>Sin conexión — reintentando… Tu revisión sigue en la nube.</Aviso>
            </div>
          )}
          {d === null && !lista.error && <p className="m-0 text-xs text-secundario">Cargando…</p>}
          {d && !d.informes.length && <p className="m-0 text-xs text-secundario">Todavía no has revisado a nadie.</p>}
          {d?.informes.map(r => (
            <TarjetaInforme key={r.id} r={r} conOrbe={enMarcha.length === 1} />
          ))}
        </Tarjeta>
      </div>
    </Marco>
  );
}

type EstadoDetalle = { tipo: 'cerrado' } | { tipo: 'abriendo' } | { tipo: 'fallo' } | { tipo: 'abierto'; doc: Informe };

function TarjetaInforme({ r, conOrbe }: { r: Resumen; conOrbe: boolean }) {
  const [detalle, setDetalle] = useState<EstadoDetalle>({ tipo: 'cerrado' });
  // el informe ya pedido no se vuelve a pedir al cerrar y abrir
  const cache = useRef<Informe | null>(null);

  const cab = (
    <h3 className="m-0 mb-1 text-md font-semibold [overflow-wrap:anywhere]">
      {dia(r.inicio)} <span className="font-normal text-secundario">· {r.cuentas.map(c => '@' + c.cuenta).join(', ')}</span>
    </h3>
  );

  if (r.estado === 'analizando') {
    return (
      <article className="mb-4 rounded-grande border border-linea p-4">
        {cab}
        {conOrbe ? (
          <EsperaIA texto="Revisando a la competencia · 1-2 min" tope={900000} textoAlAgotar={AL_AGOTAR} />
        ) : (
          <p role="status" className="m-0 text-xs text-secundario">
            Revisando a la competencia — suele tardar un par de minutos; puedes cerrar la página.
          </p>
        )}
      </article>
    );
  }
  if (r.estado === 'error') {
    return (
      <article className="mb-4 rounded-grande border border-linea p-4">
        {cab}
        <p className="m-0 text-sm text-error">
          <Icono nombre="aviso" /> La revisión falló{r.error ? ` (${r.error})` : ''} — tus créditos se devolvieron.
        </p>
      </article>
    );
  }

  const abierto = detalle.tipo === 'abierto' || detalle.tipo === 'abriendo';

  async function alternar() {
    if (abierto) {
      setDetalle({ tipo: 'cerrado' });
      return;
    }
    if (cache.current) {
      setDetalle({ tipo: 'abierto', doc: cache.current });
      return;
    }
    setDetalle({ tipo: 'abriendo' });
    try {
      cache.current = await abrirInforme(r.id);
      setDetalle({ tipo: 'abierto', doc: cache.current });
    } catch {
      setDetalle({ tipo: 'fallo' });
    }
  }

  const cr = r.creditos ?? 0;
  const pubs = r.n_publicaciones;
  return (
    <article className="mb-4 rounded-grande border border-linea p-4">
      {cab}
      <p className="m-0 flex flex-wrap items-center gap-x-2 text-xs text-secundario">
        {pubs} {plural(pubs, 'publicación', 'publicaciones')} · {cr} {plural(cr, 'crédito', 'créditos')}
        {r.devueltos ? ` (${r.devueltos} ${plural(r.devueltos, 'devuelto', 'devueltos')})` : ''}
        <Boton nivel="secundario" denso aria-expanded={abierto} onClick={() => void alternar()}>
          {abierto ? 'Cerrar' : 'Ver'}
        </Boton>
      </p>
      {detalle.tipo === 'abriendo' && <p className="text-xs text-secundario">Abriendo…</p>}
      {detalle.tipo === 'fallo' && (
        <div className="mt-2">
          <Aviso tipo="error">
            No pudimos abrir ese informe. Inténtalo de nuevo.{' '}
            <Boton nivel="enlace" onClick={() => void alternar()}>
              Reintentar
            </Boton>
          </Aviso>
        </div>
      )}
      {detalle.tipo === 'abierto' && <CuerpoInforme doc={detalle.doc} />}
    </article>
  );
}

function CuerpoInforme({ doc }: { doc: Informe }) {
  const fallidas = doc.fallidas ?? [];
  return (
    <div className="mt-3">
      {fallidas.length > 0 && (
        <div className="mb-3">
          <Aviso tipo="error">
            No se pudo traer {fallidas.map(c => '@' + c.cuenta).join(', ')}: {fallidas[0]!.motivo ?? ''}
            {doc.devueltos ? ` Te devolvimos ${doc.devueltos} ${plural(doc.devueltos, 'crédito', 'créditos')}.` : ''}
          </Aviso>
        </div>
      )}
      <LecturaInforme l={doc.lectura} pubs={doc.publicaciones ?? []} />
      {(doc.publicaciones ?? []).map(p => (
        <Pub key={p.id} p={p} />
      ))}
    </div>
  );
}

function LecturaInforme({ l, pubs }: { l: Lectura | null | undefined; pubs: Publicacion[] }) {
  if (!l || (!l.patrones && !l.ganchos && !l.formato)) return null;
  const ids = new Set(pubs.map(p => p.id));
  const patrones = l.patrones ?? [];
  return (
    <div className="mb-4 rounded-medio border border-linea bg-hundido p-4 text-sm">
      <h4 className="m-0 mb-2 text-sm font-semibold">Qué se repite en las que rinden</h4>
      {patrones.length ? (
        <ul className="m-0 pl-5">
          {patrones.map((pt, i) => {
            const cuantas = (pt.ids ?? []).filter(x => ids.has(x)).length;
            return (
              <li key={i}>
                {pt.que}
                {cuantas > 0 && (
                  <span className="text-secundario">
                    {' '}
                    ({cuantas} {plural(cuantas, 'publicación', 'publicaciones')})
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="m-0 text-secundario">No hay un patrón que estos datos sostengan.</p>
      )}
      {l.ganchos && (
        <p className="mt-2 mb-0">
          <b>Ganchos:</b> {l.ganchos}
        </p>
      )}
      {l.formato && (
        <p className="mt-2 mb-0">
          <b>Formato:</b> {l.formato}
        </p>
      )}
      {(l.probar ?? []).length > 0 && (
        <>
          <h4 className="mt-3 mb-2 text-sm font-semibold">Qué puedes probar</h4>
          <ul className="m-0 pl-5">
            {l.probar!.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </>
      )}
      {l.advertencia && (
        <div className="mt-3">
          <Aviso>{l.advertencia}</Aviso>
        </div>
      )}
    </div>
  );
}

function Pub({ p }: { p: Publicacion }) {
  const ind = indice(p.indice);
  const href = hrefSeguro(p.enlace);
  const texto = p.texto ?? '';
  return (
    <div className="border-t border-linea py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs text-secundario">{nombreRed(p.red)}</span>
        <b className="[overflow-wrap:anywhere]">@{p.cuenta}</b>
        <span className="text-xs text-secundario">
          {dia(p.cuando)}
          {p.duracion_s ? ' · ' + duracionLarga(p.duracion_s) : ''}
        </span>
        {ind && (
          <span
            className={unir('rounded-pildora border px-2 text-xs', ind.alto ? 'border-exito text-exito' : 'border-linea text-secundario')}
            title="Vistas de esta publicación frente a lo normal de su cuenta"
          >
            {ind.texto}
          </span>
        )}
        {href && (
          <a className="ml-auto inline-flex min-h-11 items-center gap-1 text-enlace no-underline hover:underline" href={href} target="_blank" rel="noopener noreferrer">
            Ver <Icono nombre="externo" />
          </a>
        )}
      </div>
      {texto && (
        <p className="my-1 [overflow-wrap:anywhere]">
          {texto.slice(0, 180)}
          {texto.length > 180 ? '…' : ''}
        </p>
      )}
      <div className="flex flex-wrap gap-x-4 text-xs text-secundario tabular-nums">
        <span>
          Vistas <b className="text-texto">{numero(p.vistas)}</b>
        </span>
        <span>
          Me gusta <b className="text-texto">{numero(p.me_gusta)}</b>
        </span>
        <span>
          Comentarios <b className="text-texto">{numero(p.comentarios)}</b>
        </span>
        <span>
          Compartidos <b className="text-texto">{numero(p.compartidos)}</b>
        </span>
      </div>
    </div>
  );
}
