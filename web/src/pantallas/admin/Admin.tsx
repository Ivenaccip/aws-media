// /estudio/admin/ — el panel del negocio, piloto de la migración (UI·7).
// Paridad con static/admin.html: las mismas tres vistas, las mismas cifras y
// las mismas llamadas. Cambia el aspecto, no el comportamiento
// (docs/PLAN-UI.md §4). Qué pasó con cada aserción vieja:
// docs/migracion/admin.md.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Marco } from '../../marca/Marco';
import { ErrorApi } from '../../nucleo/api';
import { dolares } from '../../nucleo/formato';
import { Aviso } from '../../ui/Aviso';
import { Boton } from '../../ui/Boton';
import { Icono } from '../../ui/Icono';
import { Pestanas } from '../../ui/Pestanas';
import { TablaDatos, type Columna } from '../../ui/TablaDatos';
import { Tarjeta } from '../../ui/Tarjeta';
import { unir } from '../../ui/unir';
import {
  awsTotal,
  cargarDetalle,
  cargarResumen,
  costoIA,
  dolares4,
  enlaceTraza,
  ingresos,
  ingresosTotales,
  megas,
  nombreDe,
  proveedor,
  sincronizar,
  tiempo,
  type Detalle,
  type Resumen,
  type Traza,
  type UsuarioResumen,
} from './logica';

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'sin-acceso' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; datos: Resumen };

const NOTA = 'mt-3 mb-0 max-w-[75ch] text-xs text-secundario';

function Cifra({ valor, texto, tono }: { valor: ReactNode; texto: ReactNode; tono?: 'pos' | 'neg' }) {
  return (
    <div className="flex-[1_1_160px] rounded-grande border border-linea bg-superficie px-5 py-4">
      <b
        className={unir(
          'mb-1 block text-titulo-sm font-semibold tabular-nums',
          tono === 'pos' && 'text-exito',
          tono === 'neg' && 'text-error',
        )}
      >
        {valor}
      </b>
      <span className="text-xs text-secundario">{texto}</span>
    </div>
  );
}

const Fila = ({ children }: { children: ReactNode }) => (
  <div className="mb-6 flex flex-wrap items-stretch gap-3">{children}</div>
);

const tonoDe = (x: number) => (x >= 0 ? 'text-exito' : 'text-error');

function estadoDeError(e: unknown): Estado | null {
  if (e instanceof DOMException && e.name === 'AbortError') return null;
  if (e instanceof ErrorApi && e.estado === 403) return { tipo: 'sin-acceso' };
  if (e instanceof ErrorApi && e.estado === 0)
    return { tipo: 'error', mensaje: 'No se pudo cargar — revisa tu conexión y recarga.' };
  if (e instanceof ErrorApi) return { tipo: 'error', mensaje: e.message };
  return { tipo: 'error', mensaje: 'No se pudo cargar — recarga la página.' };
}

export function Admin() {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });

  const alFallar = useCallback((e: unknown) => {
    const siguiente = estadoDeError(e);
    if (siguiente) setEstado(siguiente);
  }, []);

  useEffect(() => {
    const c = new AbortController();
    cargarResumen(c.signal).then(datos => setEstado({ tipo: 'listo', datos }), alFallar);
    return () => c.abort();
  }, [alFallar]);

  // tras sincronizar: trae el resumen otra vez sin volver a «Cargando…»
  const recargar = useCallback(
    () => cargarResumen().then(datos => setEstado({ tipo: 'listo', datos }), alFallar),
    [alFallar],
  );

  return (
    <Marco
      pantalla="admin"
      titulo="Panel del negocio"
      bajada={
        <p className="m-0">
          Tres vistas: <b>1 · Ingresos</b> (lo que los usuarios gastan en créditos), <b>2 · Costos</b> (la IA
          por un lado y AWS por el otro) y <b>3 · Flujo</b> (ingresos − costos). Aurora/CloudFront son
          compartidos: para el total están el{' '}
          <a className="text-enlace" href="https://console.aws.amazon.com/billing/home#/budgets" target="_blank" rel="noopener noreferrer">
            presupuesto de $50/mes
          </a>{' '}
          y{' '}
          <a className="text-enlace" href="https://console.aws.amazon.com/cost-management/home#/cost-explorer" target="_blank" rel="noopener noreferrer">
            Cost Explorer
          </a>
          .
        </p>
      }
    >
      {estado.tipo === 'cargando' && (
        <p role="status" className="py-16 text-center text-secundario">
          Cargando…
        </p>
      )}
      {estado.tipo === 'error' && (
        <div className="py-16 text-center text-secundario" role="alert">
          {estado.mensaje}
        </div>
      )}
      {estado.tipo === 'sin-acceso' && (
        <div className="py-16 text-center text-secundario">
          <p className="m-0">
            <Icono nombre="candado" /> Esta página es solo para administradores.
          </p>
          <p className="m-0 text-xs">
            Se otorga con <code className="rounded-chico bg-elevada px-1.5">tools/usuarios.py admin &lt;correo&gt;</code>{' '}
            (y un re-login).
          </p>
        </div>
      )}
      {estado.tipo === 'listo' && <Panel datos={estado.datos} recargar={recargar} />}
    </Marco>
  );
}

function Panel({ datos, recargar }: { datos: Resumen; recargar: () => Promise<void> }) {
  return (
    <Pestanas
      etiqueta="Vistas"
      pestanas={[
        { id: 'ingresos', titulo: '1 · Ingresos', contenido: <VistaIngresos d={datos} /> },
        { id: 'costos', titulo: '2 · Costos', contenido: <VistaCostos d={datos} recargar={recargar} /> },
        { id: 'flujo', titulo: '3 · Flujo', contenido: <VistaFlujo d={datos} /> },
      ]}
    />
  );
}

// ================= 1 · INGRESOS =================

function VistaIngresos({ d }: { d: Resumen }) {
  const piso = d.piso_venta_usd;
  const suma = (k: 'comprados' | 'cortesia') => d.usuarios.reduce((s, u) => s + u[k], 0);
  const columnas: Columna<UsuarioResumen>[] = [
    { clave: 'usuario', titulo: 'Usuario', celda: u => <span title={u.user_id}>{nombreDe(u)}</span> },
    { clave: 'cortesia', titulo: 'Cortesía', numerica: true, celda: u => u.cortesia },
    { clave: 'comprados', titulo: 'Comprados', numerica: true, celda: u => u.comprados },
    { clave: 'quemados', titulo: 'Quemados', numerica: true, celda: u => u.gastados },
    { clave: 'ingresos', titulo: 'Ingresos USD', numerica: true, celda: u => dolares4(ingresos(u, piso)) },
    { clave: 'saldo', titulo: 'Saldo', numerica: true, celda: u => u.saldo },
    { clave: 'peliculas', titulo: 'Películas', numerica: true, celda: u => u.peliculas },
  ];
  return (
    <>
      <Fila>
        <Cifra valor={dolares(ingresosTotales(d))} texto="ingresos por créditos quemados" />
        <Cifra valor={d.totales.gastados} texto={`créditos quemados (× $${piso}/cr)`} />
        <Cifra valor={suma('comprados')} texto="créditos comprados" />
        <Cifra valor={suma('cortesia')} texto="créditos de cortesía regalados" />
      </Fila>
      <Tarjeta titulo="Por usuario">
        <TablaDatos titulo="Ingresos por usuario" columnas={columnas} filas={d.usuarios} claveFila={u => u.user_id} />
        <p className={NOTA}>
          Los ingresos se reconocen cuando el crédito se QUEMA (créditos quemados × el piso de venta de
          tarifas.json), no cuando se compra: un crédito comprado sin usar todavía no nos costó nada.
        </p>
      </Tarjeta>
    </>
  );
}

// ================= 2 · COSTOS =================

function VistaCostos({ d, recargar }: { d: Resumen; recargar: () => Promise<void> }) {
  const t = d.totales;
  const [elegido, setElegido] = useState<UsuarioResumen | null>(null);
  const columnas: Columna<UsuarioResumen>[] = [
    {
      clave: 'usuario',
      titulo: 'Usuario',
      celda: u => (
        <Boton
          nivel="enlace"
          className="min-h-11 text-left"
          title={u.user_id}
          aria-label={`Ver las corridas de ${nombreDe(u)}`}
          onClick={() => setElegido(u)}
        >
          {nombreDe(u)}
        </Boton>
      ),
    },
    { clave: 'openai', titulo: 'OpenAI', numerica: true, celda: u => dolares4(proveedor(u, 'openai')) },
    { clave: 'fal', titulo: 'fal', numerica: true, celda: u => dolares4(proveedor(u, 'fal')) },
    { clave: 'claude', titulo: 'Claude', numerica: true, celda: u => dolares4(proveedor(u, 'claude')) },
    {
      clave: 'ia',
      titulo: 'IA total',
      numerica: true,
      celda: u => <span className="font-semibold text-texto">{dolares4(costoIA(u))}</span>,
    },
    {
      clave: 'aurora',
      titulo: 'Aurora ≈',
      numerica: true,
      celda: u => (
        <span title="Aurora del mes, prorrateada por la actividad registrada — informativa, no entra al costo total">
          {dolares4(u.aurora_usd ?? 0)}
        </span>
      ),
    },
    {
      clave: 'fargate',
      titulo: 'Fargate',
      numerica: true,
      celda: u => (
        <span title={'Fargate/Lambda estimado por corrida' + (u.fargate_s ? ' — ' + tiempo(u.fargate_s) + ' de cómputo' : '')}>
          {dolares4(u.costo_aws_usd ?? 0)}
        </span>
      ),
    },
    { clave: 's3', titulo: 'S3', numerica: true, celda: u => megas(u.s3_bytes) },
    {
      clave: 'aws',
      titulo: 'AWS total',
      numerica: true,
      celda: u => (
        <span className="font-semibold text-texto" title="Aurora prorrateada + Fargate/Lambda">
          {dolares4(awsTotal(u))}
        </span>
      ),
    },
    { clave: 'total', titulo: 'Costo total', numerica: true, celda: u => dolares4(u.costo_usd) },
  ];
  return (
    <>
      <Fila>
        <Cifra valor={dolares(costoIA(t))} texto="IA (APIs — Langfuse)" />
        <Cifra valor={dolares(proveedor(t, 'openai'))} texto="· OpenAI" />
        <Cifra valor={dolares(proveedor(t, 'fal'))} texto="· fal" />
        <Cifra valor={dolares(proveedor(t, 'claude'))} texto="· Claude" />
        <Cifra valor={dolares(t.costo_aws_usd ?? 0)} texto="infra AWS (Fargate/Lambda)" />
        {d.aurora && <Cifra valor={dolares(d.aurora.usd)} texto={`Aurora del mes (${d.aurora.acu_horas} h-ACU)`} />}
        <Cifra valor={dolares(t.costo_usd)} texto="costo directo total" />
        <Sincronizar recargar={recargar} />
      </Fila>
      <Tarjeta titulo="Por usuario">
        <p className="mt-0 mb-3 text-xs text-secundario">Elige un usuario para ver el detalle por corrida.</p>
        <TablaDatos titulo="Costos por usuario" columnas={columnas} filas={d.usuarios} claveFila={u => u.user_id} />
        <p className={NOTA}>
          El desglose OpenAI / fal / Claude sale del modelo de cada generación; lo sincronizado ANTES de este
          desglose no trae vendor y solo aparece en <b>IA total</b> (re-aparece desglosado si borras esas filas y
          re-sincronizas el periodo). La IA sale de las trazas de Langfuse (sync diario 06:00 UTC + el botón de
          arriba). <b>Aurora ≈</b> es el costo REAL del mes de la base (horas-ACU medidas en CloudWatch × la tarifa de
          Aurora) prorrateado por la actividad registrada de cada usuario en el mes — la base es
          compartida, así que el reparto es aproximado. <b>Fargate</b> es la línea estimada por corrida (segundos
          reales de Fargate/Lambda × las tarifas de AWS; el tooltip trae el tiempo de cómputo).{' '}
          <b>AWS total</b> = Aurora ≈ + Fargate. S3 se muestra aparte, y el <b>Costo total</b> (la base del margen)
          sigue siendo IA + Fargate — Aurora es informativa y no entra. CloudFront/ECR siguen solo en Cost Explorer.
        </p>
      </Tarjeta>
      {elegido && <DetalleUsuario key={elegido.user_id} usuario={elegido} base={d.langfuse_base} />}
    </>
  );
}

function Sincronizar({ recargar }: { recargar: () => Promise<void> }) {
  const [trabajando, setTrabajando] = useState(false);
  const [nota, setNota] = useState<ReactNode>(null);
  // el candado va ANTES del await: dos clics seguidos no alcanzan a ver el
  // estado nuevo de React y mandarían dos POST
  const vuela = useRef(false);

  async function alPulsar() {
    if (vuela.current) return;
    vuela.current = true;
    setTrabajando(true);
    setNota(
      <>
        <Icono nombre="espera" /> trayendo trazas de Langfuse…
      </>,
    );
    try {
      const r = await sincronizar();
      setNota(
        <>
          <Icono nombre="listo" className="text-exito" /> {r.nuevas} trazas nuevas — recargando…
        </>,
      );
      await recargar();
    } catch (e) {
      setNota('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      vuela.current = false;
      setTrabajando(false);
    }
  }

  return (
    <div className="flex flex-col justify-center gap-1 sm:ml-auto">
      <Boton nivel="principal" icono={<Icono nombre="rehacer" />} trabajando={trabajando && 'Sincronizando…'} onClick={alPulsar}>
        Sincronizar costes (7 días)
      </Boton>
      <div className="min-h-5 text-xs text-secundario" role="status">
        {nota}
      </div>
    </div>
  );
}

type EstadoDetalle =
  | { tipo: 'cargando' }
  | { tipo: 'sin-red' }
  | { tipo: 'error'; estado: number }
  | { tipo: 'listo'; d: Detalle };

function DetalleUsuario({ usuario, base }: { usuario: UsuarioResumen; base: string }) {
  const [estado, setEstado] = useState<EstadoDetalle>({ tipo: 'cargando' });
  const [intento, setIntento] = useState(0);
  const caja = useRef<HTMLElement>(null);

  useEffect(() => {
    let vigente = true;
    cargarDetalle(usuario.user_id).then(
      d => vigente && setEstado({ tipo: 'listo', d }),
      (e: unknown) =>
        vigente &&
        setEstado(e instanceof ErrorApi && e.estado !== 0 ? { tipo: 'error', estado: e.estado } : { tipo: 'sin-red' }),
    );
    return () => {
      vigente = false;
    };
  }, [usuario.user_id, intento]);

  function reintentar() {
    setEstado({ tipo: 'cargando' });
    setIntento(n => n + 1);
  }

  useEffect(() => {
    caja.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, []);

  const traza = (t: Traza, i: number) => (
    <li key={i}>
      · {t.concepto} — {dolares4(t.costo_usd)}
      {t.segundos ? ` · ~${tiempo(t.segundos)} de cómputo` : ''}
      {t.traza && (
        <>
          {' '}
          <a className="whitespace-nowrap text-enlace no-underline hover:underline" href={enlaceTraza(base, t.traza)} target="_blank" rel="noopener noreferrer">
            traza <Icono nombre="externo" />
          </a>
        </>
      )}
    </li>
  );
  const lista = (ts: Traza[]) => <ul className="m-0 mt-2 list-none p-0 text-xs text-secundario">{ts.map(traza)}</ul>;

  return (
    <section ref={caja} aria-labelledby="detalle-titulo" className="mt-6 rounded-grande border border-linea bg-superficie p-6">
      <h2 id="detalle-titulo" className="m-0 mb-3 text-titulo-sm font-bold [overflow-wrap:anywhere]">
        Corridas de {nombreDe(usuario)}
      </h2>
      {estado.tipo === 'cargando' && <p className="text-xs text-secundario">Cargando…</p>}
      {estado.tipo === 'error' && <p className="text-xs text-secundario">Error {estado.estado}.</p>}
      {estado.tipo === 'sin-red' && (
        <Aviso tipo="error">
          No se pudo abrir el detalle — revisa tu conexión.{' '}
          <Boton nivel="enlace" onClick={reintentar}>
            Reintentar
          </Boton>
        </Aviso>
      )}
      {estado.tipo === 'listo' && (
        <>
          {estado.d.proyectos.map(p => (
            <div key={p.id} className="mb-3 rounded-medio border border-linea px-4 py-3">
              <div className="flex flex-wrap justify-between gap-3">
                <span className="max-w-[60%] truncate" title={p.brief ?? ''}>
                  {p.brief || p.id}
                </span>
                <span className="text-xs text-secundario">
                  {p.estado} · {p.duracion_s ? p.duracion_s + ' s · ' : ''}
                  {new Date(p.creado).toLocaleDateString()}
                </span>
              </div>
              <div className="mt-1">
                <b>{p.creditos}</b> <span className="text-xs text-secundario">créditos netos</span> ·{' '}
                <b>{dolares4(p.costo_usd)}</b> <span className="text-xs text-secundario">de costo directo</span>
              </div>
              {p.trazas.length > 0 && lista(p.trazas)}
            </div>
          ))}
          {!estado.d.proyectos.length && <p className="text-xs text-secundario">Sin proyectos.</p>}
          {estado.d.sin_proyecto.length > 0 && (
            <div className="mb-3 rounded-medio border border-linea px-4 py-3">
              <span>Sin proyecto asociado</span>
              {lista(estado.d.sin_proyecto)}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ================= 3 · FLUJO =================

function VistaFlujo({ d }: { d: Resumen }) {
  const t = d.totales;
  const piso = d.piso_venta_usd;
  const columnas: Columna<UsuarioResumen>[] = [
    { clave: 'usuario', titulo: 'Usuario', celda: u => <span title={u.user_id}>{nombreDe(u)}</span> },
    { clave: 'ingresos', titulo: 'Ingresos', numerica: true, celda: u => dolares4(ingresos(u, piso)) },
    { clave: 'costos', titulo: 'Costos', numerica: true, celda: u => dolares4(u.costo_usd) },
    {
      clave: 'flujo',
      titulo: 'Flujo',
      numerica: true,
      celda: u => <span className={tonoDe(u.margen_usd)}>{dolares4(u.margen_usd)}</span>,
    },
  ];
  return (
    <>
      <Fila>
        <Cifra valor={dolares(t.margen_usd)} texto="flujo total (ingresos − costos)" tono={t.margen_usd >= 0 ? 'pos' : 'neg'} />
        <Cifra valor={dolares(ingresosTotales(d))} texto="1 · ingresos" />
        <Cifra valor={dolares(t.costo_usd)} texto="2 · costos" />
        <Cifra valor={t.peliculas} texto="películas producidas" />
      </Fila>
      <Tarjeta titulo="Por usuario">
        <TablaDatos titulo="Flujo por usuario" columnas={columnas} filas={d.usuarios} claveFila={u => u.user_id} />
        <p className={NOTA}>
          Flujo = créditos quemados × ${piso} dólares por crédito − costo directo (IA + AWS) de ese usuario. Un flujo
          negativo en «Claude IA (desarrollo)» es normal: son nuestras corridas de prueba, sin créditos detrás.
        </p>
      </Tarjeta>
    </>
  );
}
