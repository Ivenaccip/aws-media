// «4 · Clases» del panel: aquí el dueño da de alta las clases de la Guía y sube el video de cada una. Esta rebanada NO gasta
// nada: crear, listar y editar clases; subir el video a S3 con una URL firmada, confirmar que llegó y medir cuánto dura;
// cancelar; la vista previa; archivar (borrado suave: no se borra nada) y restaurar. No llama a ningún proveedor de pago.
//
// La pestaña vive en un <Tabs> de Radix que desmonta lo que no se ve: este componente pide su lista cuando se abre, no antes.
// Un solo botón ámbar a la vez: «Nueva clase»; con el formulario abierto, el ámbar es «Guardar clase» y «Nueva clase» se esconde.
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { ErrorApi } from '../../nucleo/api';
import { Aviso } from '../../ui/Aviso';
import { Boton } from '../../ui/Boton';
import { Confirmar } from '../../ui/Confirmar';
import { Interruptor } from '../../ui/Interruptor';
import { Vacio } from '../../ui/Vacio';
import { FormularioClase } from './FormularioClase';
import { TarjetaArchivada, TarjetaClase, idEditarDe, idTituloDe } from './TarjetaClase';
import {
  archivarClase,
  cargarClases,
  estaArchivada,
  ordenar,
  restaurarClase,
  type Clase,
  type LimitesClases,
} from './logicaClases';

type Carga =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; clases: Clase[]; limites: LimitesClases };

type Archivadas = { tipo: 'cargando' } | { tipo: 'error'; mensaje: string } | { tipo: 'listo'; clases: Clase[] };

type Formulario = { modo: 'nueva' } | { modo: 'editar'; id: string };

const ID_NUEVA = 'clases-nueva';
const ID_TITULO = 'clases-titulo';

function mensajeDe(e: unknown): string {
  if (e instanceof ErrorApi) return e.message;
  return 'No se pudo cargar — recarga la página.';
}

export function Clases() {
  const idArchivadas = useId();
  const [carga, setCarga] = useState<Carga>({ tipo: 'cargando' });
  const [intento, setIntento] = useState(0);
  const [formulario, setFormulario] = useState<Formulario | null>(null);
  const [verArchivadas, setVerArchivadas] = useState(false);
  const [archivadas, setArchivadas] = useState<Archivadas>({ tipo: 'cargando' });
  const [pedirArchivadas, setPedirArchivadas] = useState(0);
  const [paraArchivar, setParaArchivar] = useState<Clase | null>(null);
  const [restaurando, setRestaurando] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState('');
  // a dónde va el foco tras el próximo pintado (un id del DOM): nunca se queda en <body> al cerrar el formulario o el diálogo
  const foco = useRef<string | null>(null);
  const refTitulo = useRef<HTMLHeadingElement>(null);
  const trabajando = useRef(false);

  // la lista, al abrir la pestaña (y con «Reintentar»)
  useEffect(() => {
    const c = new AbortController();
    cargarClases(false, c.signal).then(
      l => setCarga({ tipo: 'listo', clases: ordenar(l.clases.filter(x => !estaArchivada(x))), limites: l.limites }),
      (e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setCarga({ tipo: 'error', mensaje: mensajeDe(e) });
      },
    );
    return () => c.abort();
  }, [intento]);

  // las archivadas solo se piden cuando se prenden (o al archivar con ellas a la vista)
  useEffect(() => {
    if (!verArchivadas) return;
    const c = new AbortController();
    cargarClases(true, c.signal).then(
      l => setArchivadas({ tipo: 'listo', clases: l.clases }),
      (e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setArchivadas({ tipo: 'error', mensaje: mensajeDe(e) });
      },
    );
    return () => c.abort();
  }, [verArchivadas, pedirArchivadas]);

  useEffect(() => {
    const id = foco.current;
    if (!id) return;
    foco.current = null;
    document.getElementById(id)?.focus();
  });

  const reemplazar = useCallback((c: Clase) => {
    setCarga(prev => {
      if (prev.tipo !== 'listo') return prev;
      const esta = prev.clases.some(x => x.id === c.id);
      return { ...prev, clases: ordenar(esta ? prev.clases.map(x => (x.id === c.id ? c : x)) : [...prev.clases, c]) };
    });
  }, []);

  function reintentar() {
    setCarga({ tipo: 'cargando' });
    setIntento(n => n + 1);
  }

  function alternarArchivadas(activo: boolean) {
    setVerArchivadas(activo);
    if (activo) {
      setArchivadas({ tipo: 'cargando' });
      setPedirArchivadas(n => n + 1);
    }
  }

  function cerrarFormulario(enfocar: string) {
    foco.current = enfocar;
    setFormulario(null);
  }

  function alGuardar(c: Clase) {
    const era = formulario?.modo === 'editar';
    reemplazar(c);
    setAnuncio(era ? `Clase ${c.numero} guardada.` : `Clase ${c.numero} creada. Ya puedes subir su video.`);
    cerrarFormulario(idTituloDe(c));
  }

  async function archivar(c: Clase) {
    if (trabajando.current) return;
    trabajando.current = true;
    setFallo(null);
    try {
      await archivarClase(c.id);
      setCarga(prev => (prev.tipo === 'listo' ? { ...prev, clases: prev.clases.filter(x => x.id !== c.id) } : prev));
      if (formulario?.modo === 'editar' && formulario.id === c.id) setFormulario(null);
      // con las archivadas a la vista, la lista se trae otra vez para que esta aparezca
      if (verArchivadas) setPedirArchivadas(n => n + 1);
      setAnuncio(`Clase ${c.numero} archivada. No se borró nada: puedes restaurarla.`);
      foco.current = ID_TITULO;
    } catch (e) {
      setFallo(mensajeDe(e));
    } finally {
      trabajando.current = false;
    }
  }

  async function restaurar(c: Clase) {
    if (trabajando.current) return;
    trabajando.current = true;
    setFallo(null);
    setRestaurando(c.id);
    try {
      const vuelta = await restaurarClase(c.id);
      reemplazar(vuelta);
      setArchivadas(prev => (prev.tipo === 'listo' ? { tipo: 'listo', clases: prev.clases.filter(x => x.id !== c.id) } : prev));
      setAnuncio(`Clase ${c.numero} restaurada.`);
      foco.current = idTituloDe(vuelta);
    } catch (e) {
      setFallo(mensajeDe(e));
    } finally {
      trabajando.current = false;
      setRestaurando(null);
    }
  }

  const listo = carga.tipo === 'listo' ? carga : null;
  const aEditar = formulario?.modo === 'editar' && listo ? (listo.clases.find(c => c.id === formulario.id) ?? null) : null;
  const vivas = new Set(listo?.clases.map(c => c.id));
  // lo archivado es lo que `?archivadas=1` trae y la lista de las vivas no tiene (sirve igual si trae solo archivadas o todas);
  // en el orden del servidor: la archivada más reciente primero
  const archivadasAMostrar = archivadas.tipo === 'listo' ? archivadas.clases.filter(c => !vivas.has(c.id)) : [];

  return (
    <section aria-labelledby={ID_TITULO}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h2 ref={refTitulo} id={ID_TITULO} tabIndex={-1} className="m-0 text-titulo-sm font-bold">
          Clases
        </h2>
        {listo && !formulario && (
          <Boton id={ID_NUEVA} nivel="principal" onClick={() => setFormulario({ modo: 'nueva' })}>
            Nueva clase
          </Boton>
        )}
      </div>
      <p className="mb-5 mt-2 max-w-[75ch] text-secundario">
        Aquí subes los videos de las clases que usará la Guía. Subir no cuesta nada.
      </p>

      {carga.tipo === 'cargando' && (
        <p role="status" className="m-0 py-8 text-secundario">
          Cargando las clases…
        </p>
      )}
      {carga.tipo === 'error' && (
        <div className="flex flex-col items-start gap-3">
          <Aviso tipo="error">
            <p className="m-0">No pudimos cargar las clases.</p>
            <p className="m-0 text-xs text-secundario [overflow-wrap:anywhere]">{carga.mensaje}</p>
          </Aviso>
          <Boton onClick={reintentar}>Reintentar</Boton>
        </div>
      )}

      {listo && (
        <>
          {formulario && (
            <FormularioClase
              key={formulario.modo === 'editar' ? formulario.id : 'nueva'}
              limites={listo.limites}
              clase={aEditar}
              alGuardar={alGuardar}
              alCancelar={() => cerrarFormulario(aEditar ? idEditarDe(aEditar) : ID_NUEVA)}
            />
          )}

          {fallo && (
            <div className="mb-4">
              <Aviso tipo="error">{fallo}</Aviso>
            </div>
          )}

          {listo.clases.length === 0 ? (
            !formulario && (
              <Vacio
                icono="subir"
                titulo="Todavía no hay clases"
                texto="Crea la primera con «Nueva clase»: le pones número y título, y luego subes su video."
              />
            )
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Clases">
              {listo.clases.map(c => (
                <li key={c.id}>
                  <TarjetaClase
                    clase={c}
                    limites={listo.limites}
                    alClase={reemplazar}
                    alEditar={() => setFormulario({ modo: 'editar', id: c.id })}
                    alArchivar={() => setParaArchivar(c)}
                  />
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 flex items-center gap-3">
            <Interruptor activo={verArchivadas} alCambiar={alternarArchivadas} aria-labelledby={idArchivadas} />
            <span id={idArchivadas} className="text-sm">
              Ver clases archivadas
            </span>
          </div>

          {verArchivadas && (
            <div className="mt-4">
              <h2 className="m-0 mb-3 text-titulo-sm font-bold">Archivadas</h2>
              {archivadas.tipo === 'cargando' && <p role="status" className="m-0 text-secundario">Cargando las archivadas…</p>}
              {archivadas.tipo === 'error' && (
                <div className="flex flex-col items-start gap-3">
                  <Aviso tipo="error">{archivadas.mensaje}</Aviso>
                  <Boton onClick={() => alternarArchivadas(true)}>Reintentar</Boton>
                </div>
              )}
              {archivadas.tipo === 'listo' &&
                (archivadasAMostrar.length === 0 ? (
                  <p className="m-0 text-secundario">No hay clases archivadas.</p>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Clases archivadas">
                    {archivadasAMostrar.map(c => (
                      <li key={c.id}>
                        <TarjetaArchivada clase={c} restaurando={restaurando === c.id} alRestaurar={() => void restaurar(c)} />
                      </li>
                    ))}
                  </ul>
                ))}
            </div>
          )}
        </>
      )}

      <Confirmar
        abierto={paraArchivar !== null}
        alCambiar={a => !a && setParaArchivar(null)}
        titulo={`¿Archivar la clase ${paraArchivar?.numero ?? ''}?`}
        descripcion="Deja de aparecer en la lista y en la Guía. No se borra nada y se puede restaurar."
        confirmar="Archivar"
        peligro
        focoDeRespaldo={refTitulo}
        alConfirmar={() => {
          const c = paraArchivar;
          if (c) void archivar(c);
        }}
      />

      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {anuncio}
      </div>
    </section>
  );
}
