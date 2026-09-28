// /estudio/estilos/ — la copiadora de estilos (UI·8.2). Cobra una cosa,
// «Analizar ✦ N». Paridad con static/estilos.html y un arreglo de dinero: la
// vieja volvía a encender «Analizar» en cada vuelta del sondeo, también con
// el cobro todavía en vuelo (estilos.html:157). Aquí el candado es el de
// <BotonCobro>, que no lo toca nadie más.
import { useId, useState } from 'react';

import { BotonCobro } from '../../marca/BotonCobro';
import { EsperaIA } from '../../marca/EsperaIA';
import { Marco } from '../../marca/Marco';
import { NotaSaldo } from '../../marca/NotaSaldo';
import { Recarga } from '../../marca/Recarga';
import { refrescarSaldo, useSaldo } from '../../marca/useSaldo';
import { ErrorApi, recuperarApartado } from '../../nucleo/api';
import { nombreVT } from '../../nucleo/transiciones';
import { useListaViva } from '../../nucleo/useListaViva';
import { useLlegada } from '../../nucleo/useLlegada';
import { useTituloPestana } from '../../nucleo/useTituloPestana';
import { Aviso } from '../../ui/Aviso';
import { Boton } from '../../ui/Boton';
import { FilaViva } from '../../ui/FilaViva';
import { Tarjeta } from '../../ui/Tarjeta';
import { unir } from '../../ui/unir';
import { analizar, cargar, colorSeguro, detalle, titulo, vivos, type Listado, type Perfil } from './logica';

const AL_AGOTAR =
  'Llevamos un rato sin novedades. El análisis sigue en la nube: puedes cerrar la página y volver. ' +
  'Si sigue igual, escríbenos.';

function urlInicial(): string {
  const a = recuperarApartado('estilo-analizar');
  const c = a?.cuerpo as { url?: unknown } | undefined;
  return typeof c?.url === 'string' ? c.url : '';
}

export function Estilos() {
  const lista = useListaViva<Listado>(cargar, l => vivos(l).length > 0, {
    alTerminar: refrescarSaldo,
    // UI·21: re-analizar uno que falló lo sube a la cima: viaja, no salta
    claves: l => l.estilos.map(e => e.id),
  });
  const [url, setUrl] = useState(urlInicial);
  const [estado, setEstado] = useState<{ texto: string; error: boolean; sinSaldo?: boolean } | null>(null);
  const saldo = useSaldo();
  const idUrl = useId();

  const enMarcha = lista.datos ? vivos(lista.datos) : [];
  useTituloPestana(enMarcha.length ? 'Analizando el estilo' : null);

  async function alAnalizar() {
    const limpia = url.trim();
    if (!limpia) {
      setEstado({ texto: 'Pega la liga primero.', error: false });
      return;
    }
    setEstado(null);
    let cobrado = false; // UI·19: el «−N» vuela si el servidor cobró
    try {
      await analizar(limpia);
      cobrado = true;
      setUrl('');
      refrescarSaldo();
      await lista.actualizar();
    } catch (e) {
      setEstado({
        texto: e instanceof Error ? e.message : String(e),
        error: true,
        sinSaldo: e instanceof ErrorApi && e.sinSaldo,
      });
    }
    return cobrado;
  }

  const tarifa = lista.datos?.creditos ?? null;

  return (
    <Marco
      pantalla="estilos"
      titulo="Copiadora de estilos"
      bajada={
        <p className="m-0 text-md">
          Pega la liga de un reel de Instagram o un TikTok que te guste: la IA analiza sus frames y arma el perfil
          visual — paleta, tipografía, iluminación, tono — para que recrees ese estilo en tus imágenes y videos. Se
          copia el estilo, nunca el contenido.
        </p>
      }
    >
      <div className="max-w-[860px]">
        <Tarjeta titulo="Analizar un video" className="mb-6">
          <label htmlFor={idUrl} className="sr-only">
            Liga de Instagram o TikTok
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              id={idUrl}
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://www.instagram.com/reel/… o https://www.tiktok.com/@…/video/…"
              className="min-h-11 min-w-0 flex-[1_1_320px] rounded-medio border border-campo bg-elevada px-3 text-sm text-texto"
            />
            {tarifa !== null ? (
              <BotonCobro verbo="Analizar" costo={tarifa} saldo={saldo} trabajando="Analizando…" alCobrar={alAnalizar} />
            ) : (
              <Boton nivel="principal" disabled>
                Analizar
              </Boton>
            )}
          </div>
          {tarifa !== null && (
            <div className="mt-2">
              <NotaSaldo saldo={saldo} costo={tarifa} />
            </div>
          )}
          {estado && (
            <p
              className={unir('mt-2 mb-0 text-sm', estado.error ? 'text-error' : 'text-secundario')}
              role={estado.error ? 'alert' : 'status'}
            >
              {estado.texto}
              {estado.sinSaldo && (
                <>
                  {' '}
                  <Recarga />
                </>
              )}
            </p>
          )}
        </Tarjeta>

        <Tarjeta titulo="Tus perfiles de estilo">
          {lista.sinRed && (
            <div className="mb-3">
              <Aviso>Sin conexión — reintentando… Tu análisis sigue en la nube.</Aviso>
            </div>
          )}
          {lista.error && (
            <div className="mb-3">
              <Aviso tipo="error">
                No pudimos traer tus perfiles de estilo. Revisa tu conexión e inténtalo de nuevo.{' '}
                <Boton nivel="enlace" onClick={() => void lista.actualizar()}>
                  Reintentar
                </Boton>
              </Aviso>
            </div>
          )}
          {lista.datos === null && !lista.error && <p className="m-0 text-xs text-secundario">Cargando…</p>}
          {lista.datos && !lista.datos.estilos.length && (
            <p className="m-0 text-xs text-secundario">Todavía no tienes perfiles — pega una liga arriba.</p>
          )}
          {lista.datos?.estilos.map(e => (
            <FilaViva key={e.id} nombre={nombreVT('perfil', e.id)} nueva={lista.nuevos.has(e.id)}>
              <TarjetaPerfil perfil={e} conOrbe={enMarcha.length === 1} />
            </FilaViva>
          ))}
        </Tarjeta>
      </div>
    </Marco>
  );
}

function TarjetaPerfil({ perfil: e, conOrbe }: { perfil: Perfil; conOrbe: boolean }) {
  // UI·21: al quedar listo (con la pantalla abierta) su detalle se enciende
  const [encendida, apagar] = useLlegada(e.estado === 'listo');
  if (e.estado === 'analizando' || e.estado === 'error') {
    return (
      <article className="mb-4 rounded-grande border border-linea p-4">
        <h3 className="m-0 mb-1 text-md font-semibold [overflow-wrap:anywhere]">
          {e.id} <small className="font-normal text-secundario">{e.plataforma}</small>
        </h3>
        {e.estado === 'analizando' ? (
          conOrbe ? (
            <EsperaIA texto="Analizando el estilo · 1-2 min" tope={900000} textoAlAgotar={AL_AGOTAR} />
          ) : (
            <p role="status" className="m-0 text-xs text-secundario">
              Analizando el estilo — suele tardar 1-2 minutos; puedes cerrar la página.
            </p>
          )
        ) : (
          <p className="m-0 text-sm text-error">
            El análisis falló{e.error ? ` (${e.error})` : ''} — tus créditos se devolvieron.
          </p>
        )}
      </article>
    );
  }
  const p = e.perfil ?? {};
  const filas: Array<[string, string | undefined]> = [
    ['Tipografía', p.tipografia],
    ['Captions', p.captions],
    ['Iluminación', p.iluminacion],
    ['Estética', p.estetica],
    ['Tono', p.tono],
  ];
  return (
    <article className="mb-4 rounded-grande border border-linea p-4">
      <h3 className="m-0 mb-1 text-md font-semibold [overflow-wrap:anywhere]">
        {titulo(e)}{' '}
        <small className={unir('font-normal text-secundario', encendida && 'destello')} onAnimationEnd={apagar}>
          {detalle(e)}
        </small>
      </h3>
      <div className="my-3 flex h-8 overflow-hidden rounded-medio border border-linea" aria-label="Paleta" role="img">
        {(e.paleta ?? []).map((c, i) => {
          const color = colorSeguro(c.hex);
          return color ? (
            <span key={i} className="h-full" style={{ background: color, flex: `${Math.max(c.pct, 1)} 1 0` }} title={`${color} · ${c.pct}%`} />
          ) : null;
        })}
      </div>
      <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        {filas.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-secundario">{k}</dt>
            <dd className="m-0">{v}</dd>
          </div>
        ))}
        <dt className="text-secundario">Prompt</dt>
        <dd className="m-0">
          <code className="rounded-chico bg-elevada px-1.5 [overflow-wrap:anywhere]">{p.prompt_estilo}</code>{' '}
          <Copiar texto={p.prompt_estilo ?? ''} />
        </dd>
      </dl>
      <p className="mt-2 mb-0 text-xs text-secundario">
        Pega el prompt en «Crear imágenes» o «Crear contenido» para trabajar con esta estética.
      </p>
    </article>
  );
}

function Copiar({ texto }: { texto: string }) {
  const [nota, setNota] = useState<{ ok: boolean } | null>(null);
  async function copiar() {
    try {
      // sin contexto seguro navigator.clipboard no existe: también es un fallo
      await navigator.clipboard.writeText(texto);
      setNota({ ok: true });
    } catch {
      setNota({ ok: false });
    }
  }
  return (
    <>
      <Boton nivel="secundario" denso onClick={() => void copiar()}>
        Copiar
      </Boton>
      <span role="status" className={unir('ml-2 text-xs', nota?.ok === false ? 'text-error' : 'text-secundario')}>
        {nota && (nota.ok ? 'Copiado' : 'No se pudo copiar. Selecciona el texto y cópialo a mano.')}
      </span>
    </>
  );
}
