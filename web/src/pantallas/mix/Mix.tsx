// /estudio/mix/ — MIX, publicidad automática: una publicación al día, sola
// (UI·8.8). Paridad con static/mix.html.
//
// Lo que cobra es «Encender la campaña», y cobra la campaña ENTERA por
// adelantado. Por eso la pantalla no decide ningún número:
//   · el costo sale de /api/mix/borrador (el mismo mix.resumen_costo que
//     cobra /encender) y no se enseña antes de ver el ejemplo;
//   · lo que se devuelve al apagar sale de `devolucion` de GET /api/mix;
//   · el ejemplo del día 1 es gratis, y si después cambia lo que se VE (el
//     motivo, el tono, la foto o el día de inicio) deja de valer: sin un
//     ejemplo vigente no hay botón de encender.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { EsperaIA } from '../../marca/EsperaIA';
import { Marco } from '../../marca/Marco';
import { Recarga } from '../../marca/Recarga';
import { refrescarSaldo } from '../../marca/useSaldo';
import { ErrorApi } from '../../nucleo/api';
import { Aviso, type TipoAviso } from '../../ui/Aviso';
import { Boton } from '../../ui/Boton';
import { Confirmar } from '../../ui/Confirmar';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import { Calendario } from './Calendario';
import {
  apagar,
  AVISO_MS,
  cargar,
  cargarCuentas,
  clicDia,
  CONECTAR,
  devolucion,
  dias,
  encender,
  estadoDe,
  etiquetaCuenta,
  fechaCorta,
  fechaFila,
  firma,
  fraseDevolucion,
  guardarBorrador,
  horaTexto,
  hoy,
  hrefImagen,
  leerEjemplo,
  mensaje,
  n,
  nombreCuenta,
  pausa,
  pedirEjemplo,
  PILDORAS,
  pideConectar,
  pl,
  problemaFoto,
  proxima,
  queFalta,
  reanudar,
  REDES,
  rotulo,
  suma,
  TONOS,
  TOPE_MS,
  zona,
  type Campana,
  type Corrida,
  type Costo,
  type Cuenta,
  type EstadoMix,
} from './logica';

export interface Nota {
  tipo: TipoAviso;
  texto: string;
  conectar?: boolean;
  reintentar?: () => void;
  sinSaldo?: boolean;
}

const ZONA = zona();

export function Mix() {
  const [datos, setDatos] = useState<EstadoMix | null>(null);
  const [version, setVersion] = useState(0);
  const [nota, setNota] = useState<Nota | null>(null);
  const trabajando = useRef(false);
  const datosRef = useRef<EstadoMix | null>(null);

  const otraVez = useRef<() => void>(() => undefined);
  const recargar = useCallback(async (limpiar = true) => {
    try {
      const j = await cargar();
      datosRef.current = j;
      setDatos(j);
      setVersion(v => v + 1); // el formulario se vuelve a armar desde lo guardado
      if (limpiar) setNota(null); // el aviso de la carga anterior no sobrevive a una buena
    } catch (e) {
      setNota({ tipo: 'error', texto: mensaje(e), conectar: pideConectar(e), reintentar: () => otraVez.current() });
    }
  }, []);
  useEffect(() => {
    otraVez.current = () => void recargar();
  }, [recargar]);

  const arrancada = useRef(false);
  useEffect(() => {
    if (arrancada.current) return;
    arrancada.current = true;
    Promise.resolve().then(() => recargar());
  }, [recargar]);

  // al volver a la pestaña se recarga una campaña encendida: el reloj publica
  // solo. Un borrador NO: rearmar el formulario tiraba lo escrito sin guardar
  // (la vieja lo hacía), y con un ejemplo en marcha arrancaría otra espera
  useEffect(() => {
    const alVer = () => {
      if (document.hidden) return;
      const c = datosRef.current?.campana;
      if (c && c.estado !== 'borrador' && !trabajando.current) void recargar(false);
    };
    document.addEventListener('visibilitychange', alVer);
    return () => document.removeEventListener('visibilitychange', alVer);
  }, [recargar]);

  const c = datos?.campana ?? null;
  const encendida = !!c && c.estado !== 'borrador';

  return (
    <Marco
      pantalla="mix"
      titulo="MIX · publicidad automática"
      bajada={
        <p className="m-0 text-md">
          Sube una foto de tu producto, cuéntanos para qué es la campaña y marca los días. A partir de ahí sale{' '}
          <b className="text-texto">una publicación al día</b>, sola, sin que tengas que revisarla. Tu foto es la base de
          todas las imágenes.
        </p>
      }
    >
      <div className="max-w-[900px]">
        {nota && (
          <div className="mb-4">
            <Aviso tipo={nota.tipo}>
              {nota.texto}
              {nota.sinSaldo && (
                <>
                  {' '}
                  <Recarga />
                </>
              )}
              {nota.conectar ? (
                <>
                  {' '}
                  <a className="text-enlace underline underline-offset-4 hover:text-texto" href={CONECTAR}>
                    Conectar Blotato
                  </a>
                </>
              ) : (
                nota.reintentar && (
                  <>
                    {' '}
                    <Boton nivel="enlace" onClick={nota.reintentar}>
                      Reintentar
                    </Boton>
                  </>
                )
              )}
            </Aviso>
          </div>
        )}

        {datos && !datos.tiene_blotato && (
          <Seccion titulo="Conecta tu Blotato para usar MIX">
            <p className="m-0 text-sm text-secundario">
              MIX publica por ti en tus redes, y para eso necesita tu cuenta de Blotato conectada. Es la cuenta donde van a
              salir las publicaciones.{' '}
              <a className="text-enlace underline underline-offset-4 hover:text-texto" href={CONECTAR}>
                Conectar Blotato
              </a>
            </p>
          </Seccion>
        )}

        {!datos && !nota && <p className="text-xs text-secundario">Abriendo tu campaña…</p>}

        {datos && !encendida && datos.ultima && <UltimaCampana u={datos.ultima} />}

        {datos &&
          (encendida ? (
            <Viva key={version} datos={datos} alRecargar={recargar} alNota={setNota} />
          ) : (
            <Formulario key={version} datos={datos} alRecargar={recargar} alNota={setNota} trabajando={trabajando} />
          ))}
      </div>
    </Marco>
  );
}

function Seccion({
  titulo,
  n: num,
  icono,
  accion,
  children,
}: {
  titulo: string;
  n?: number;
  icono?: 'automatico';
  accion?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-4 rounded-grande border border-linea bg-superficie p-4 sm:p-6">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="m-0 flex items-center gap-2 font-titulo text-titulo-sm font-bold">
          {num !== undefined && <span className="text-secundario">{num}.</span>}
          {icono && <Icono nombre={icono} className="text-secundario" />}
          {titulo}
        </h2>
        {accion && <div className="ml-auto">{accion}</div>}
      </div>
      {children}
    </section>
  );
}

// La campaña anterior, cuando el reloj ya la cerró: sin esto el dueño abre
// MIX el día después y encuentra un formulario en blanco, sin rastro de lo que
// pagó ni de lo que salió.
function UltimaCampana({ u }: { u: NonNullable<EstadoMix['ultima']> }) {
  const total = dias(u.empieza, u.termina);
  const devueltos = Math.trunc(Number(u.creditos_devueltos) || 0);
  return (
    <p className="mb-4 text-sm text-secundario">
      {u.estado === 'cancelada' ? 'Apagaste tu campaña' : 'Tu campaña terminó'}: salieron {n(u.salieron)} de {n(total)} días.
      {devueltos ? ` Te devolvimos ${pl(devueltos, 'crédito', 'créditos')}.` : ''} Puedes crear otra cuando quieras.
    </p>
  );
}

interface Ejemplo {
  dia: string;
  texto: string;
  imagen: string | null;
}

const dormir = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function Formulario({
  datos,
  alRecargar,
  alNota,
  trabajando: trabajandoRef,
}: {
  datos: EstadoMix;
  alRecargar: (limpiar?: boolean) => Promise<void>;
  alNota: (n: Nota | null) => void;
  trabajando: React.MutableRefObject<boolean>;
}) {
  const c = datos.campana; // un borrador, o nada
  const maxDias = Math.max(1, Math.trunc(Number(datos.max_dias)) || 60);
  const guardado = (datos.corridas || []).find(x => x.estado === 'ejemplo');
  const inicial = () => ({
    motivo: c?.motivo ?? '',
    tono: c?.tono && TONOS[c.tono] ? c.tono : 'vender',
    ini: c?.empieza ? String(c.empieza).slice(0, 10) : null,
    fin: c?.termina ? String(c.termina).slice(0, 10) : null,
    imagenId: c?.imagen ?? '',
  });
  const [motivo, setMotivo] = useState(() => inicial().motivo);
  const [tono, setTono] = useState(() => inicial().tono);
  const [ini, setIni] = useState<string | null>(() => inicial().ini);
  const [fin, setFin] = useState<string | null>(() => inicial().fin);
  const [calendario, setCalendario] = useState(0);
  const [hora, setHora] = useState(() => (/^\d{2}:\d{2}$/.test(c?.hora ?? '') ? c!.hora! : '09:00'));
  const [archivo, setArchivo] = useState<File | null>(null);
  const pendiente = useRef(false); // ¿falta mandar esa foto al server?
  const [imagenId, setImagenId] = useState(() => inicial().imagenId);
  const [previa, setPrevia] = useState<string | null>(() => hrefImagen(c?.imagen));
  const [fotoErr, setFotoErr] = useState('');
  const [cuentas, setCuentas] = useState<Cuenta[] | null>(null);
  const [cuentaId, setCuentaId] = useState(c?.canal_id ?? '');
  const [cuentaErr, setCuentaErr] = useState<{ texto: string; conectar?: boolean; reintentar?: boolean } | null>(null);
  const [idBorrador, setIdBorrador] = useState(c?.id ?? '');
  const [costo, setCosto] = useState<Costo | null>(null);
  // el ejemplo que ya vio sigue valiendo al recargar: pedirlo otra vez serían
  // otros dos minutos mirando el orbe para ver lo mismo
  const [ejemplo, setEjemplo] = useState<Ejemplo | null>(() =>
    guardado ? { dia: String(guardado.dia).slice(0, 10), texto: guardado.texto ?? '', imagen: guardado.imagen ?? null } : null,
  );
  const [firmaEjemplo, setFirmaEjemplo] = useState<string | null>(() => {
    const i = inicial();
    return guardado ? firma(i.motivo, i.tono, i.ini, i.imagenId) : null;
  });
  const [trabajando, setTrabajandoEstado] = useState(false);
  const [espera, setEspera] = useState(false);
  const [verErr, setVerErr] = useState('');
  const [encendiendo, setEncendiendo] = useState(false);
  const candado = useRef(false);
  const tokGuardar = useRef(0);
  const vivo = useRef(true);
  const archivoInput = useRef<HTMLInputElement>(null);
  const idMotivo = useId();
  const idHora = useId();
  const idCuenta = useId();

  const setTrabajando = (v: boolean) => {
    trabajandoRef.current = v;
    setTrabajandoEstado(v);
  };
  // StrictMode monta, desmonta y vuelve a montar: el montaje revive la marca
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
      trabajandoRef.current = false;
    };
  }, [trabajandoRef]);

  const cuenta = cuentas?.find(x => String(x.id) === String(cuentaId)) ?? null;
  const tieneFoto = !!archivo || !!imagenId;
  const falta = queFalta({ tieneFoto, motivo, ini, fin, cuenta });
  const firmaAhora = firma(motivo, tono, ini, imagenId);
  const vigente = !!ejemplo && firmaEjemplo === firmaAhora;

  // ── la foto
  function tomarFoto(f: File | null | undefined) {
    setFotoErr('');
    if (!f) return;
    const malo = problemaFoto(f);
    if (malo) {
      setFotoErr(malo);
      return;
    }
    setArchivo(f);
    pendiente.current = true;
    setImagenId(`nueva:${f.name}:${f.size}:${f.lastModified || 0}`);
    setPrevia(p => {
      if (p?.startsWith('blob:')) URL.revokeObjectURL(p);
      return URL.createObjectURL(f);
    });
  }
  const [encima, setEncima] = useState(false);

  // ── las cuentas de Blotato
  const traerCuentas = useCallback(
    async (preferido: string) => {
      setCuentas(null);
      setCuentaErr(null);
      try {
        const j = await cargarCuentas();
        const lista = Array.isArray(j.cuentas) ? j.cuentas : [];
        if (!vivo.current) return;
        setCuentas(lista);
        if (preferido && !lista.some(x => String(x.id) === String(preferido))) {
          setCuentaId('');
          setCuentaErr({ texto: 'La cuenta que habías elegido ya no está conectada en Blotato. Elige otra.' });
        }
      } catch (e) {
        if (!vivo.current) return;
        setCuentas([]);
        setCuentaId('');
        setCuentaErr({ texto: mensaje(e), ...(estadoDe(e) === 409 ? { conectar: true } : { reintentar: true }) });
      }
    },
    [],
  );
  // una vez por formulario: StrictMode monta dos veces y serían dos llamadas a Blotato
  const cuentasPedidas = useRef(false);
  useEffect(() => {
    if (!datos.tiene_blotato || cuentasPedidas.current) return;
    cuentasPedidas.current = true;
    Promise.resolve().then(() => traerCuentas(c?.canal_id ?? ''));
    // solo al armar el formulario
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── el borrador: guarda y se queda con el costo que devuelve. El server
  // reutiliza SIEMPRE el mismo borrador, así que llamarlo seguido no deja
  // ejemplos huérfanos
  async function guardar(): Promise<Costo | null> {
    const tok = ++tokGuardar.current;
    const fd = new FormData();
    fd.append('motivo', motivo.trim());
    fd.append('tono', tono);
    fd.append('canal_id', cuenta ? String(cuenta.id) : '');
    fd.append('canal_red', cuenta ? String(cuenta.platform || '') : '');
    fd.append('canal_nombre', cuenta ? nombreCuenta(cuenta) : '');
    fd.append('hora', hora || '09:00');
    fd.append('zona', ZONA);
    fd.append('empieza', ini || '');
    fd.append('termina', fin || ini || '');
    // la foto viaja UNA vez: después vive en el server
    if (archivo && pendiente.current) fd.append('imagen', archivo, archivo.name || 'foto.jpg');
    const j = await guardarBorrador(fd);
    if (tok !== tokGuardar.current) return null; // llegó tarde: manda la última
    if (j.id) setIdBorrador(j.id);
    if (archivo) pendiente.current = false;
    return j.costo;
  }

  // el costo se vuelve a pedir SOLO con un ejemplo vigente: antes de eso no
  // se enseña ningún número, así que no hay nada que refrescar
  useEffect(() => {
    if (falta || !vigente) return;
    const t = setTimeout(() => {
      guardar().then(
        k => {
          if (k && vivo.current) setCosto(k);
        },
        e => {
          if (!vivo.current) return;
          setCosto(null);
          alNota({ tipo: 'error', texto: mensaje(e), conectar: pideConectar(e) });
        },
      );
    }, 700);
    return () => clearTimeout(t);
    // guardar lee el estado de este render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [falta, vigente, motivo, tono, ini, fin, hora, cuentaId, imagenId]);

  // ── el ejemplo: se PIDE y se espera mirando GET /api/mix. Generarlo tarda
  // de 30 s a 2 min y API Gateway corta a los 29 s: el server lo encola
  const seguirEjemplo = useCallback(
    async (dia: string, laFirma: string) => {
      setTrabajando(true);
      setEspera(true);
      const hasta = Date.now() + TOPE_MS;
      let fila: Corrida | null = null;
      let fallo: string | null = null;
      let descartado = false;
      for (let vuelta = 0; vivo.current; vuelta++) {
        await dormir(pausa(vuelta));
        if (!vivo.current) return;
        let j: EstadoMix;
        try {
          // con plazo propio: una petición colgada congelaría la espera entera
          j = await cargar(typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20000) : undefined);
        } catch (e) {
          // sin red y un 5xx son pasajeros; un 4xx no mejora por insistir
          const st = estadoDe(e);
          if ((st >= 400 && st < 500) || Date.now() > hasta) {
            fallo = mensaje(e);
            break;
          }
          continue;
        }
        const v = leerEjemplo(j, dia);
        if (v.tipo === 'listo') {
          fila = v.fila;
          break;
        }
        if (v.tipo === 'descartado') {
          descartado = true;
          break;
        }
        if (v.tipo === 'fallo') {
          fallo = v.texto;
          break;
        }
        if (Date.now() > hasta) {
          fallo = 'Tu ejemplo sigue preparándose en la nube. Vuelve a abrir esta pantalla en un par de minutos y estará aquí.';
          break;
        }
      }
      if (!vivo.current) return;
      // el orbe se va ANTES de pintar el fallo: nunca gira junto a un error
      setEspera(false);
      setTrabajando(false);
      if (fila) {
        setEjemplo({ dia: String(fila.dia).slice(0, 10), texto: fila.texto ?? '', imagen: fila.imagen ?? null });
        setFirmaEjemplo(laFirma);
        alNota({ tipo: 'exito', texto: 'Listo: abajo está la publicación del primer día.' });
      } else {
        setEjemplo(null);
        if (fallo) alNota({ tipo: 'error', texto: fallo });
        else if (descartado)
          alNota({ tipo: 'aviso', texto: 'Descartamos ese ejemplo porque la campaña cambió. Pide otro cuando quieras: verlo no cuesta nada.' });
      }
    },
    // setTrabajando y alNota no cambian
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // si dejó uno a medias (lo pidió y cerró la pantalla), se retoma la espera;
  // si ese intento murió sin nadie mirando, aquí es donde se cuenta
  const retomado = useRef(false);
  useEffect(() => {
    if (guardado || retomado.current) return;
    retomado.current = true;
    const aMedias = (datos.corridas || []).find(x => x.estado === 'preparando');
    if (!aMedias) return;
    const i = inicial();
    Promise.resolve().then(() => {
      if (aMedias.error) alNota({ tipo: 'error', texto: aMedias.error });
      else void seguirEjemplo(String(aMedias.dia).slice(0, 10), firma(i.motivo, i.tono, i.ini, i.imagenId));
    });
    // solo al armar el formulario
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verEjemplo() {
    if (trabajandoRef.current) return;
    if (falta) {
      setVerErr(falta); // validación: junto al botón
      return;
    }
    setVerErr('');
    alNota(null);
    setTrabajando(true);
    let dia: string;
    let laFirma: string;
    try {
      await guardar();
      // la firma se toma con lo que el server acaba de guardar
      laFirma = firmaAhora;
      dia = (await pedirEjemplo()).dia;
    } catch (e) {
      setTrabajando(false);
      // 409: lo que esta pantalla creía ya no es verdad (otro ejemplo en
      // camino, o ya se encendió). Recargar pinta la verdad y retoma la espera
      if (estadoDe(e) === 409) {
        await alRecargar();
        return;
      }
      setEjemplo(null);
      alNota({ tipo: 'error', texto: mensaje(e), conectar: pideConectar(e), reintentar: () => void verEjemplo() });
      return;
    }
    // el ejemplo anterior deja de valer en cuanto se pide otro: el server ya
    // devolvió su fila a 'preparando' y /encender contestaría 409
    setEjemplo(null);
    setFirmaEjemplo(null);
    setCosto(null);
    alNota({ tipo: 'aviso', texto: 'Estamos preparando tu ejemplo. Aparece aquí solo.' });
    await seguirEjemplo(dia, laFirma);
  }

  async function encenderYa() {
    if (candado.current || !costo) return;
    candado.current = true; // antes de cualquier await: doble clic = un cobro
    setEncendiendo(true);
    alNota(null);
    try {
      const j = await encender(idBorrador || '');
      refrescarSaldo();
      alNota({
        tipo: 'exito',
        texto: `Campaña encendida: ${pl(j.dias, 'publicación', 'publicaciones')}, una cada día a las ${horaTexto(hora)}.`,
      });
      await alRecargar(false);
    } catch (e) {
      alNota({ tipo: 'error', texto: mensaje(e), conectar: pideConectar(e), sinSaldo: e instanceof ErrorApi && e.sinSaldo });
      if (estadoDe(e) === 409) await alRecargar(false); // el estado de la pantalla mentía
    } finally {
      candado.current = false;
      if (vivo.current) setEncendiendo(false);
    }
  }

  function elegirDia(d: string) {
    const r = clicDia(ini, fin, d);
    setIni(r.ini);
    setFin(r.fin);
  }

  const atajos = datos.atajos && typeof datos.atajos === 'object' ? datos.atajos : {};
  const tonos = Array.isArray(datos.tonos) && datos.tonos.length ? datos.tonos : Object.keys(TONOS);
  const conCreditos = datos.saldo !== null;
  const mostrarCosto = vigente && !!costo;
  const alcanza = !conCreditos || !!costo?.alcanza;

  const formulario = (
    <>
      <Seccion titulo="La foto de tu producto" n={1}>
        <p className="m-0 mb-3 text-sm text-secundario">
          De aquí salen todas las imágenes de la campaña, así que siempre se va a ver lo tuyo. JPG, PNG o WebP, hasta 12 MB.
        </p>
        {previa ? (
          <div className="flex flex-wrap items-end gap-3">
            <img src={previa} alt="La foto de tu producto" className="max-h-56 max-w-full rounded-medio object-contain" />
            <Boton nivel="secundario" denso onClick={() => archivoInput.current?.click()}>
              Cambiar la foto
            </Boton>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => archivoInput.current?.click()}
            onDragEnter={e => {
              e.preventDefault();
              setEncima(true);
            }}
            onDragOver={e => {
              e.preventDefault();
              setEncima(true);
            }}
            onDragLeave={() => setEncima(false)}
            onDrop={e => {
              e.preventDefault();
              setEncima(false);
              tomarFoto(e.dataTransfer?.files?.[0]);
            }}
            className={unir(
              'flex w-full cursor-pointer flex-col items-center gap-2 rounded-grande border border-dashed bg-transparent px-4 py-8 text-center text-texto',
              encima ? 'border-texto bg-elevada' : 'border-campo hover:border-secundario',
            )}
          >
            <Icono nombre="subir" className="size-6 text-secundario" />
            <b>Arrastra tu foto aquí</b>
            <span className="text-xs text-secundario">o pulsa para elegirla desde tu teléfono</span>
          </button>
        )}
        <input
          ref={archivoInput}
          type="file"
          hidden
          aria-hidden="true"
          tabIndex={-1}
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          onChange={e => {
            const f = e.target.files?.[0];
            e.target.value = ''; // la MISMA foto otra vez tiene que disparar el change
            tomarFoto(f);
          }}
        />
        {fotoErr && (
          <p role="alert" className="m-0 mt-2 text-sm text-error">
            {fotoErr}
          </p>
        )}
      </Seccion>

      <Seccion titulo="¿Para qué es esta campaña?" n={2}>
        <label htmlFor={idMotivo} className="m-0 mb-3 block text-sm text-secundario">
          Cuéntanos qué quieres lograr estos días. Por ejemplo: dar a conocer el menú nuevo, llenar los martes, o que la gente
          sepa que abriste.
        </label>
        <textarea
          id={idMotivo}
          value={motivo}
          onChange={e => setMotivo(e.target.value)}
          maxLength={2000}
          placeholder="Quiero que la gente del barrio sepa que ya abrimos y que venga a probar el menú del día."
          className="min-h-24 w-full resize-y rounded-medio border border-campo bg-elevada p-3 text-sm text-texto"
        />
        <h2 className="m-0 mb-2 mt-6 flex items-center gap-2 font-titulo text-titulo-sm font-bold">
          <span className="text-secundario">3.</span>El tono
        </h2>
        <p className="m-0 mb-3 text-sm text-secundario">Cambia de verdad lo que se dice y lo que se ve cada día.</p>
        <div role="group" aria-label="El tono de la campaña" className="flex flex-wrap gap-2">
          {tonos.map(t => (
            <Boton
              key={t}
              nivel="secundario"
              denso
              aria-pressed={t === tono}
              onClick={() => setTono(t)}
              className="aria-pressed:border-texto aria-pressed:bg-elevada aria-pressed:font-semibold"
            >
              {rotulo(TONOS, t, t)}
            </Boton>
          ))}
        </div>
      </Seccion>

      <Seccion titulo="Los días" n={4}>
        <p className="m-0 mb-3 text-sm text-secundario">
          Marca en el calendario el primer día y el último. Los atajos solo te rellenan el rango desde hoy: el calendario
          manda.
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          {Object.keys(atajos).map(k => (
            <Boton
              key={k}
              nivel="secundario"
              denso
              onClick={() => {
                const d = Math.max(1, Math.min(maxDias, Math.trunc(Number(atajos[k])) || 1));
                const a = hoy();
                setIni(a);
                setFin(suma(a, d - 1));
                setCalendario(x => x + 1); // el calendario salta al mes del atajo
              }}
            >
              {k}
            </Boton>
          ))}
        </div>
        <Calendario
          key={calendario}
          ini={ini}
          fin={fin}
          maxDias={maxDias}
          alElegir={elegirDia}
          alLimpiar={() => {
            setIni(null);
            setFin(null);
          }}
        />
        <p className="m-0 mt-3 text-sm" aria-live="polite">
          {!ini ? (
            <span className="text-secundario">Marca el primer día de la campaña.</span>
          ) : !fin ? (
            <span className="text-secundario">Empieza el {fechaCorta(ini)}. Ahora marca el último día.</span>
          ) : (
            <>
              Del <b>{fechaCorta(ini)}</b> al <b>{fechaCorta(fin)}</b> · {pl(dias(ini, fin), 'día', 'días')},{' '}
              {pl(dias(ini, fin), 'publicación', 'publicaciones')}.
            </>
          )}
        </p>
        <p className="m-0 mt-1 text-xs text-secundario">
          Cada publicación cuesta {pl(datos.tarifa, 'crédito', 'créditos')}. Verás el total antes de encenderla. Una campaña
          puede durar hasta {n(maxDias)} días.
        </p>
      </Seccion>

      <Seccion titulo="La hora y dónde sale" n={5}>
        <p className="m-0 mb-3 text-sm text-secundario">Todos los días a la misma hora, en la misma cuenta.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={idHora} className="text-sm font-medium">
              La hora de cada día
            </label>
            <select
              id={idHora}
              value={hora}
              onChange={e => setHora(e.target.value)}
              className="min-h-11 rounded-medio border border-campo bg-elevada px-3 text-sm text-texto"
            >
              {Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`).map(v => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
            <label htmlFor={idCuenta} className="text-sm font-medium">
              La cuenta de Blotato
            </label>
            <select
              id={idCuenta}
              value={cuentaId}
              disabled={!cuentas || !cuentas.length}
              onChange={e => setCuentaId(e.target.value)}
              className="min-h-11 w-full rounded-medio border border-campo bg-elevada px-3 text-sm text-texto"
            >
              {!cuentas ? (
                <option value="">Cargando…</option>
              ) : cuentaErr && !cuentas.length ? (
                <option value="">No pudimos traer tus cuentas</option>
              ) : (
                <>
                  <option value="">Elige dónde va a salir</option>
                  {cuentas.map(x => (
                    <option key={String(x.id)} value={String(x.id)}>
                      {etiquetaCuenta(x)}
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>
        </div>
        {ZONA && <p className="m-0 mt-2 text-xs text-secundario">La hora es la de tu zona: {ZONA}.</p>}
        {cuentaErr && (
          <p className="m-0 mt-2 text-sm text-error">
            {cuentaErr.texto}
            {cuentaErr.conectar && (
              <>
                {' '}
                <a className="text-enlace underline underline-offset-4 hover:text-texto" href={CONECTAR}>
                  Conectar Blotato
                </a>
              </>
            )}
            {cuentaErr.reintentar && (
              <>
                {' '}
                <Boton nivel="enlace" onClick={() => void traerCuentas(cuentaId)}>
                  Reintentar
                </Boton>
              </>
            )}
          </p>
        )}
      </Seccion>

      <Seccion titulo="Míralo antes de encenderla" n={6}>
        <p className="m-0 mb-3 text-sm text-secundario">
          Te preparamos la publicación del primer día para que la veas tal cual va a salir. <b className="text-texto">Verla no cuesta nada.</b>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Boton
            nivel={mostrarCosto ? 'secundario' : 'principal'}
            disabled={!!falta || trabajando}
            onClick={() => void verEjemplo()}
          >
            {ejemplo ? 'Ver otro ejemplo' : 'Ver un ejemplo'}
          </Boton>
          <span className="text-xs text-secundario">{falta}</span>
        </div>
        {verErr && (
          <p role="alert" className="m-0 mt-2 text-sm text-error">
            {verErr}
          </p>
        )}
        {espera && (
          <div className="mt-4">
            <EsperaIA
              texto="Preparando tu ejemplo · hasta 2 min"
              tope={AVISO_MS}
              textoAlAgotar="Está tardando más de lo normal. Sigue trabajando en la nube: puedes cerrar esta pantalla y volver, aquí estará."
            />
          </div>
        )}
        {ejemplo && (
          <div className="mt-4">
            <div className="flex flex-col gap-3 rounded-grande border border-linea p-3 sm:flex-row">
              {hrefImagen(ejemplo.imagen) && (
                <img
                  src={hrefImagen(ejemplo.imagen)!}
                  alt="La publicación del primer día"
                  className="w-full rounded-medio object-cover sm:w-56"
                />
              )}
              <div className="min-w-0">
                <p className="m-0 text-xs text-secundario">{ejemplo.dia ? `Día 1 · ${fechaCorta(ejemplo.dia)}` : 'Día 1'}</p>
                <p className="m-0 mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{ejemplo.texto}</p>
              </div>
            </div>
            {vigente ? (
              <p className="m-0 mt-3 text-xs text-secundario">Así se vería tu primera publicación. Verla no cuesta nada.</p>
            ) : (
              <div className="mt-3">
                <Aviso>
                  Cambiaste la campaña después de ver esto. Mira otro ejemplo antes de encenderla: verlo no cuesta nada.
                </Aviso>
              </div>
            )}
          </div>
        )}
        {mostrarCosto && costo && (
          <div className="mt-4">
            <p className="m-0 text-sm">
              Van a salir <b>{pl(costo.publicaciones, 'publicación', 'publicaciones')}</b>, una cada día a las {horaTexto(hora)}.
              {conCreditos && (
                <>
                  {' '}
                  Son <b>{pl(costo.creditos, 'crédito', 'créditos')}</b> y se te cobran ahora.
                </>
              )}
            </p>
            {!alcanza && (
              <p className="m-0 mt-2 text-sm text-error">
                Te faltan {pl(costo.faltan, 'crédito', 'créditos')} para esta campaña. <Recarga />
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Boton nivel="principal" disabled={!alcanza} trabajando={encendiendo && 'Encendiendo…'} onClick={() => void encenderYa()}>
                Encender la campaña
              </Boton>
              <span className="text-xs text-secundario">A partir de ahí sale sola, sin que la revises.</span>
            </div>
          </div>
        )}
      </Seccion>
    </>
  );

  // sin la clave de Blotato la herramienta se ve pero no se usa, y el clic
  // lleva a conectarla en vez de dejar al usuario en un callejón (M23 · C)
  if (!datos.tiene_blotato)
    return (
      <div className="relative">
        <div inert className="opacity-50">
          {formulario}
        </div>
        <a href={CONECTAR} className="absolute inset-0 rounded-grande" aria-label="Conectar Blotato para usar MIX" />
      </div>
    );
  return formulario;
}

function Viva({
  datos,
  alRecargar,
  alNota,
}: {
  datos: EstadoMix;
  alRecargar: (limpiar?: boolean) => Promise<void>;
  alNota: (n: Nota | null) => void;
}) {
  const c = datos.campana as Campana;
  const corridas = datos.corridas || [];
  const total = dias(c.empieza, c.termina);
  const salieron = corridas.filter(x => x.estado === 'publicada').length;
  const porDia: Record<string, Corrida> = Object.create(null) as Record<string, Corrida>;
  for (const x of corridas) porDia[String(x.dia).slice(0, 10)] = x;
  const prox = proxima(c, porDia, hoy());
  const devueltos = Math.trunc(Number(c.creditos_devueltos) || 0);
  const dev = devolucion(datos);
  const [confirmar, setConfirmar] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [reanudando, setReanudando] = useState(false);
  const candado = useRef(false);

  // una corrida a medias es lo único que cambia solo: se mira cada minuto
  // mientras la pestaña está a la vista, y se deja de mirar al terminar
  const corriendo = corridas.some(x => x.estado === 'corriendo');
  useEffect(() => {
    if (!corriendo) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const programar = () => {
      if (t) clearTimeout(t);
      t = document.hidden ? null : setTimeout(() => void alRecargar(false), 60000);
    };
    programar();
    document.addEventListener('visibilitychange', programar);
    return () => {
      if (t) clearTimeout(t);
      document.removeEventListener('visibilitychange', programar);
    };
  }, [corriendo, alRecargar]);

  async function apagarYa() {
    if (candado.current) return;
    candado.current = true;
    setApagando(true);
    alNota(null);
    try {
      const j = await apagar();
      refrescarSaldo();
      const d = Math.trunc(Number(j.devueltos) || 0);
      alNota({ tipo: 'exito', texto: d ? `Campaña apagada. Te devolvimos ${pl(d, 'crédito', 'créditos')}.` : 'Campaña apagada.' });
      await alRecargar(false);
    } catch (e) {
      alNota({ tipo: 'error', texto: mensaje(e), conectar: pideConectar(e) });
      if (estadoDe(e) === 409) await alRecargar(false);
    } finally {
      candado.current = false;
      setApagando(false);
    }
  }

  // sin esto la pausa sería una trampa: MIX la pausa porque se desconectó
  // Blotato, el dueño la reconecta… y no vuelve a publicar nunca
  async function reanudarYa() {
    if (candado.current) return;
    candado.current = true;
    setReanudando(true);
    alNota(null);
    try {
      await reanudar(c.id || '');
      alNota({ tipo: 'exito', texto: 'Campaña reanudada. La próxima sale a su hora.' });
    } catch (e) {
      alNota({ tipo: 'error', texto: mensaje(e), conectar: pideConectar(e) });
    } finally {
      candado.current = false;
      setReanudando(false);
      await alRecargar(false);
    }
  }

  const img = hrefImagen(c.imagen);
  return (
    <Seccion
      titulo="Tu campaña"
      icono="automatico"
      accion={
        <Boton nivel="secundario" denso icono={<Icono nombre="rehacer" />} onClick={() => void alRecargar()}>
          Actualizar
        </Boton>
      }
    >
      {c.estado === 'pausada' ? (
        <div className="mb-4">
          <Aviso>
            Campaña en pausa. Ya salieron {n(salieron)} de {n(total)}.
            {c.nota && <span className="block text-secundario">{c.nota}</span>}
          </Aviso>
        </div>
      ) : (
        <p className="m-0 mb-4 text-sm">
          Publicando todos los días a las {horaTexto(c.hora)}. Ya salieron{' '}
          <b>
            {n(salieron)} de {n(total)}
          </b>
          .{prox && <span className="block text-xs text-secundario">{prox}</span>}
        </p>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        {img && <img src={img} alt="La foto de tu producto" className="w-full rounded-medio object-cover sm:w-40" />}
        <div className="min-w-0 text-sm">
          <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{c.motivo}</p>
          <p className="m-0 mt-1 text-xs text-secundario">
            Tono: {rotulo(TONOS, c.tono, c.tono || '')} · {fechaCorta(c.empieza)} al {fechaCorta(c.termina)}
            {c.canal_nombre || c.canal_red ? ` · ${rotulo(REDES, c.canal_red, c.canal_red || '')} ${c.canal_nombre || ''}` : ''}
          </p>
          <p className="m-0 mt-1 text-xs text-secundario">
            Pagaste {pl(c.creditos_cobrados, 'crédito', 'créditos')} por adelantado.
            {devueltos ? ` Te devolvimos ${pl(devueltos, 'crédito', 'créditos')} de los días que no salieron.` : ''}
          </p>
        </div>
      </div>

      <ol className="m-0 list-none p-0">
        {Array.from({ length: total }, (_, i) => {
          const d = suma(c.empieza, i);
          return <FilaDia key={d} dia={d} num={i + 1} corrida={porDia[d]} />;
        })}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <p className="m-0 mr-auto flex-[1_1_260px] text-xs text-secundario">{fraseDevolucion(dev)}</p>
        {c.estado === 'pausada' && (
          <Boton nivel="secundario" trabajando={reanudando && 'Reanudando…'} onClick={() => void reanudarYa()}>
            Reanudar
          </Boton>
        )}
        <Boton nivel="peligro" trabajando={apagando && 'Apagando…'} onClick={() => setConfirmar(true)}>
          Apagar la campaña
        </Boton>
      </div>

      <Confirmar
        abierto={confirmar}
        alCambiar={setConfirmar}
        titulo="¿Apagar la campaña?"
        descripcion={`${fraseDevolucion(dev)} No se puede deshacer: deja de publicar desde hoy.`}
        confirmar="Sí, apagarla"
        cancelar="No, dejarla"
        peligro
        alConfirmar={() => {
          setConfirmar(false);
          void apagarYa();
        }}
      />
    </Seccion>
  );
}

const TONO_PILDORA = {
  buena: 'border-linea bg-exito-fondo text-exito',
  viva: 'border-linea bg-elevada text-texto',
  mala: 'border-peligro-borde bg-peligro-fondo text-error',
  '': 'border-linea bg-elevada text-secundario',
} as const;

function FilaDia({ dia, num, corrida }: { dia: string; num: number; corrida: Corrida | undefined }) {
  const est = corrida ? String(corrida.estado || '') : '';
  const [tono, texto] = rotulo(PILDORAS, est, ['', 'Pendiente'] as [keyof typeof TONO_PILDORA, string]);
  const img = hrefImagen(corrida?.imagen);
  return (
    <li className="flex gap-3 border-t border-linea py-3">
      <div className="w-24 flex-none text-xs text-secundario">
        Día {num} · {fechaFila(dia)}
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <span className={unir('inline-block rounded-chico border px-2 py-0.5 text-xs', TONO_PILDORA[tono])}>{texto}</span>
        {corrida?.texto && <p className="m-0 mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{corrida.texto}</p>}
        {est === 'ejemplo' && <p className="m-0 mt-1 text-xs text-secundario">Es la que viste antes de encenderla.</p>}
        {est === 'error' && corrida?.error && <p className="m-0 mt-1 text-sm text-error">{corrida.error}</p>}
      </div>
      {img && <img src={img} alt="" className="size-16 flex-none rounded-medio object-cover" />}
    </li>
  );
}
