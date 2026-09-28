// /estudio/agenda/ — lo que tienes programado en tus redes (UI·8.6). No cobra
// nada. Paridad con static/agenda.html, con dos cambios de forma:
//   · «Cancelar» ya no usa confirm(): una confirmación con el foco en «No,
//     dejarla» (lo que no se deshace nunca es la opción por defecto) y con
//     botones que no dicen dos veces «Cancelar»;
//   · los avisos viven en la pantalla, no en el cuadro de trabajos.js.
// Una carga a la vez: dos tiran dos veces de Blotato, y la que se pide
// mientras hay otra en curso se ENCOLA (cancelar dos seguidas perdía la
// segunda recarga y la lista enseñaba lo que ya no existe).
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { Marco } from '../../marca/Marco';
import { Aviso } from '../../ui/Aviso';
import { Boton } from '../../ui/Boton';
import { Campo } from '../../ui/Campo';
import { Confirmar } from '../../ui/Confirmar';
import { Dialogo } from '../../ui/Dialogo';
import { Icono } from '../../ui/Icono';
import {
  adjuntos,
  cancelar,
  cargar,
  confirmacion,
  CONECTAR,
  estado,
  fecha,
  local,
  minimo,
  mensaje,
  quien,
  reprogramar,
  resumen,
  texto,
  validar,
  zona,
  type Programada,
} from './logica';

interface Nota {
  tipo: 'error' | 'exito';
  texto: string;
  /** UI·24: el éxito de algo que se acaba de guardar: la palomita se dibuja. */
  guardado?: boolean;
  conectar?: boolean;
  reintentar?: () => void;
}

interface Pendiente {
  mas: boolean;
  listos: (() => void)[];
}

export function Agenda() {
  const [items, setItems] = useState<Programada[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  // qué decir cuando no hay tarjetas: aún nadie respondió, no hay nada, o falló
  const [fondo, setFondo] = useState<'buscando' | 'vacia' | 'caida'>('buscando');
  const [ocupado, setOcupado] = useState(true);
  const [nota, setNota] = useState<Nota | null>(null);
  const [aCancelar, setACancelar] = useState<Programada | null>(null);
  const [cancelando, setCancelando] = useState<ReadonlySet<string>>(new Set());

  // lo que lee la carga en curso sin esperar al siguiente render
  const itemsRef = useRef<Programada[]>([]);
  const cursorRef = useRef<string | null>(null);
  const cargando = useRef(false);
  const pendiente = useRef<Pendiente | null>(null);
  const actualizar = useRef<HTMLButtonElement>(null);

  const pintar = (nuevos: Programada[], mas: boolean) => {
    itemsRef.current = mas ? itemsRef.current.concat(nuevos) : nuevos.slice();
    setItems(itemsRef.current);
    if (!itemsRef.current.length) setFondo('vacia');
  };

  // cargar entra por aquí: si ya hay una carga, esta espera su turno
  const cargarLista = useCallback((mas = false): Promise<void> => {
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
      setNota(null);
      try {
        const j = await cargar(mas ? cursorRef.current : null);
        const nuevos = Array.isArray(j.items) ? j.items : [];
        if (j.error) {
          // Blotato falló y el server responde 200 con el porqué. Lo pintado SE
          // QUEDA: decirle «no tienes nada» a quien tiene doce es mentirle. Y
          // el cursor y el total no se pisan con los null del fallo.
          if (nuevos.length) pintar(nuevos, mas);
          else if (!itemsRef.current.length) setFondo('caida');
          setNota({ tipo: 'error', texto: j.error, conectar: !!j.reconectar, reintentar: () => void pedirCarga(mas) });
        } else {
          // sin error manda la respuesta: una última página vacía y con cursor
          // null apaga «Ver más»
          cursorRef.current = typeof j.cursor === 'string' && j.cursor ? j.cursor : null;
          pintar(nuevos, mas);
          setTotal(j.total);
        }
      } catch (e) {
        if (!itemsRef.current.length) setFondo('caida');
        setNota({ tipo: 'error', texto: mensaje(e), conectar: estado(e) === 409, reintentar: () => void pedirCarga(mas) });
      } finally {
        cargando.current = false;
        setOcupado(false);
        setCursor(cursorRef.current);
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



  // UNA carga al abrir: StrictMode monta dos veces y serían dos llamadas a Blotato
  const arrancada = useRef(false);
  useEffect(() => {
    if (arrancada.current) return;
    arrancada.current = true;
    Promise.resolve().then(() => cargarLista());
  }, [cargarLista]);

  // la tarjeta que tenía el foco pudo desaparecer: el foco no cae al <body>.
  // Se mira DESPUÉS de pintar y sin carga en curso: «Actualizar» está
  // deshabilitado mientras carga, y un botón deshabilitado no toma el foco
  // (con la red de verdad, la lista vuelve después de cerrar el diálogo)
  const focoPendiente = useRef(false);
  const [, pedirFoco] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!focoPendiente.current || ocupado) return;
    focoPendiente.current = false;
    const a = document.activeElement;
    if (!a || a === document.body) actualizar.current?.focus();
  });
  const focoSinDueno = () => {
    focoPendiente.current = true;
    pedirFoco();
  };

  // ── cambiar la hora
  const [editando, setEditando] = useState<Programada | null>(null);
  const [valor, setValor] = useState('');
  const [errorCampo, setErrorCampo] = useState<string | null>(null);
  const [errorDlg, setErrorDlg] = useState('');
  const [guardando, setGuardando] = useState(false);
  const candadoHora = useRef(false);
  // sube al abrir y al cerrar: una respuesta tardía no manda sobre OTRO diálogo
  const gen = useRef(0);
  const campo = useRef<HTMLInputElement>(null);
  const [min, setMinimo] = useState('');

  function abrirHora(it: Programada) {
    gen.current++;
    setErrorCampo(null);
    setErrorDlg('');
    setValor(local(it.cuando));
    setMinimo(minimo()); // ni el pasado ni el minuto de gracia
    setEditando(it);
  }

  function cerrarHora() {
    gen.current++;
    setEditando(null);
  }

  async function guardarHora() {
    const it = editando;
    if (!it || candadoHora.current) return;
    const malo = validar(valor, Date.now());
    if (malo) {
      setErrorCampo(malo); // cero llamadas si la fecha no sirve
      return;
    }
    const mio = gen.current;
    const vigente = () => mio === gen.current;
    candadoHora.current = true;
    setGuardando(true);
    setErrorCampo(null);
    setErrorDlg('');
    try {
      const cuando = new Date(valor).toISOString(); // local → UTC, UNA vez
      await reprogramar(it.id, cuando);
      if (vigente()) cerrarHora();
      await cargarLista();
      setNota({ tipo: 'exito', texto: `Hora cambiada: ${it.red} sale el ${fecha(cuando)} (tu hora).`, guardado: true });
      focoSinDueno();
    } catch (e) {
      if (estado(e) === 404) {
        // ya no está programada: el diálogo sobra y la lista miente. Primero
        // repintar y después el aviso (la carga limpia el aviso al empezar).
        if (vigente()) cerrarHora();
        await cargarLista();
        setNota({ tipo: 'error', texto: mensaje(e) });
        focoSinDueno();
      } else if (vigente()) setErrorDlg(mensaje(e));
      // cerraron el diálogo mientras viajaba: el fallo va a la pantalla
      else setNota({ tipo: 'error', texto: mensaje(e), conectar: estado(e) === 409 });
    } finally {
      candadoHora.current = false;
      setGuardando(false);
    }
  }

  // ── cancelar
  async function cancelarYa(it: Programada) {
    if (cancelando.has(it.id)) return;
    setCancelando(s => new Set(s).add(it.id));
    setNota(null);
    try {
      await cancelar(it.id);
      await cargarLista();
      // lo irreversible no pasa en silencio: se lee y se ve
      setNota({ tipo: 'exito', texto: 'Publicación cancelada.' });
    } catch (e) {
      if (estado(e) === 404) await cargarLista(); // ya no estaba: la lista mentía
      setNota({ tipo: 'error', texto: mensaje(e), conectar: estado(e) === 409 });
    } finally {
      setCancelando(s => {
        const n = new Set(s);
        n.delete(it.id);
        return n;
      });
      focoSinDueno();
    }
  }

  const laZona = zona();

  return (
    <Marco
      pantalla="agenda"
      titulo="Agenda tus publicaciones"
      bajada={
        <p className="m-0 text-md">
          Lo que tienes programado en tus redes. Aquí puedes cambiarles la hora o cancelarlas antes de que salgan.
        </p>
      }
    >
      <div className="max-w-[900px]">
        <section className="rounded-grande border border-linea bg-superficie p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <p className="m-0 mr-auto text-xs text-secundario">{resumen(total)}</p>
            <Boton
              ref={actualizar}
              nivel="secundario"
              icono={<Icono nombre="rehacer" />}
              disabled={ocupado}
              onClick={() => void cargarLista()}
            >
              Actualizar
            </Boton>
          </div>

          {nota && (
            <div className="mt-4">
              <Aviso tipo={nota.tipo} dibujar={!!nota.guardado}>
                {nota.texto}
                {nota.conectar ? (
                  <>
                    {' '}
                    <a className="text-enlace hover:text-texto" href={CONECTAR}>
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

          {items.length ? (
            <ul className="m-0 mt-4 list-none p-0">
              {items.map(it => (
                <TarjetaProgramada
                  key={it.id}
                  it={it}
                  apagada={ocupado || cancelando.has(it.id)}
                  alHora={() => abrirHora(it)}
                  alCancelar={() => setACancelar(it)}
                />
              ))}
            </ul>
          ) : (
            <p className="m-0 mt-4 py-2 text-xs text-secundario" role="status">
              {fondo === 'buscando'
                ? 'Buscando lo que tienes programado…'
                : fondo === 'caida'
                  ? 'No pudimos traer tu agenda ahora. Pulsa «Actualizar» para intentarlo de nuevo.'
                  : 'No tienes nada programado. Cuando programes un video desde el editor, en Publicar, aparecerá aquí.'}
            </p>
          )}

          {cursor && (
            <Boton nivel="secundario" className="mt-2" disabled={ocupado} onClick={() => void cargarLista(true)}>
              Ver más
            </Boton>
          )}
        </section>
      </div>

      <Dialogo
        abierto={editando !== null}
        alCambiar={a => {
          if (!a) cerrarHora();
        }}
        titulo="Cambiar la hora"
        focoInicial={campo}
        // UI·20: el foco vuelve 100 ms después de cerrar; si la tarjeta que
        // abrió ya no está, va a «Actualizar»
        focoDeRespaldo={actualizar}
        acciones={
          <>
            <Boton nivel="secundario" onClick={cerrarHora}>
              Volver
            </Boton>
            <Boton nivel="principal" trabajando={guardando && 'Guardando…'} onClick={() => void guardarHora()}>
              Guardar
            </Boton>
          </>
        }
      >
        {editando && (
          <>
            <p className="m-0 mb-4 text-xs text-secundario">
              <b className="font-semibold text-texto">{quien(editando)}</b> · {fecha(editando.cuando)}
            </p>
            <Campo
              ref={campo}
              etiqueta="Nueva fecha y hora"
              type="datetime-local"
              value={valor}
              min={min}
              onChange={e => {
                setValor(e.target.value);
                setErrorCampo(null);
              }}
              error={errorCampo}
              {...(laZona ? { ayuda: `La hora es de tu zona: ${laZona}.` } : {})}
            />
            {errorDlg && (
              <div className="mt-3">
                <Aviso tipo="error">{errorDlg}</Aviso>
              </div>
            )}
          </>
        )}
      </Dialogo>

      <Confirmar
        abierto={aCancelar !== null}
        alCambiar={a => {
          if (!a) setACancelar(null);
        }}
        titulo="¿Cancelar esta publicación?"
        descripcion={aCancelar ? confirmacion(aCancelar) : ''}
        focoDeRespaldo={actualizar}
        confirmar="Sí, cancelarla"
        cancelar="No, dejarla"
        peligro
        alConfirmar={() => {
          const it = aCancelar;
          setACancelar(null);
          if (it) void cancelarYa(it);
        }}
      />
    </Marco>
  );
}

function TarjetaProgramada({
  it,
  apagada,
  alHora,
  alCancelar,
}: {
  it: Programada;
  apagada: boolean;
  alHora: () => void;
  alCancelar: () => void;
}) {
  const t = texto(it);
  const adj = adjuntos(it.medios);
  return (
    <li className="mb-3 rounded-grande border border-linea p-4 sm:px-5">
      <div className="flex flex-wrap items-baseline gap-1">
        <b className="font-semibold">{it.red}</b>
        {it.cuenta_nombre && <span className="text-xs text-secundario"> · {it.cuenta_nombre}</span>}
        {it.destino && <span className="text-xs text-secundario"> · {it.destino}</span>}
        <span className="ml-auto whitespace-nowrap rounded-chico border border-linea bg-elevada px-3 py-1 text-xs text-secundario tabular-nums">
          {fecha(it.cuando)}
        </span>
      </div>
      {t ? (
        <p className="m-0 mt-2 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{t}</p>
      ) : (
        <p className="m-0 mt-2 text-sm text-secundario">Sin texto</p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {adj && (
          <span className="mr-auto inline-flex basis-full items-center gap-1 text-xs text-secundario sm:basis-auto">
            <Icono nombre="adjunto" />
            {adj}
          </span>
        )}
        <Boton nivel="secundario" denso disabled={apagada} onClick={alHora}>
          Cambiar la hora
        </Boton>
        <Boton nivel="peligro" denso disabled={apagada} onClick={alCancelar}>
          Cancelar
        </Boton>
      </div>
    </li>
  );
}
