// El formulario de una clase (nueva o por editar): Número de clase · Título · Fecha de grabación · Para qué sirve · Liga de
// referencia · «Guardar clase». La liga es de referencia: una clase con liga NO lleva video (el servidor no deja que una clase con
// archivo lleve liga), así que con la liga puesta la clase se crea como liga, y al editar solo las clases-liga la muestran. Va en línea, en una tarjeta, y no en un diálogo: así el único botón ámbar de la vista es siempre
// el que toca (mientras está abierto, «Nueva clase» se esconde).
//
// Cada formulario nuevo trae su «clave» (un UUID del navegador): un doble clic, o un reintento tras un corte de red, manda la
// MISMA clave y el servidor devuelve la misma clase en vez de crear otra. Los límites (largo del título y del resumen) los
// dice el servidor en la lista; aquí solo se revisa lo mínimo (que haya número y título) y el servidor manda en lo demás: su
// texto de error se enseña tal cual, junto al campo que corresponde.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { ErrorApi } from '../../nucleo/api';
import { Aviso } from '../../ui/Aviso';
import { Boton } from '../../ui/Boton';
import { Campo } from '../../ui/Campo';
import { CuadroDeTexto } from '../../ui/CuadroDeTexto';
import {
  CAMPOS_VACIOS,
  CAMPO_DEL_ERROR,
  camposDe,
  claveNueva,
  crearClase,
  cuerpoCambios,
  cuerpoNuevo,
  editarClase,
  largo,
  validar,
  type CambiosClase,
  type Campos,
  type Clase,
  type ErroresCampos,
  type LimitesClases,
} from './logicaClases';

export interface PropsFormularioClase {
  limites: LimitesClases;
  /** La clase que se edita; sin ella, es una clase nueva. */
  clase: Clase | null;
  /** Salió bien: la clase como la devolvió el servidor. */
  alGuardar: (c: Clase) => void;
  alCancelar: () => void;
}

export function FormularioClase({ limites, clase, alGuardar, alCancelar }: PropsFormularioClase) {
  const idTitulo = useId();
  const [campos, setCampos] = useState<Campos>(() => (clase ? camposDe(clase) : CAMPOS_VACIOS));
  const [errores, setErrores] = useState<ErroresCampos>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // una clave por formulario abierto: sobrevive a los reintentos y cambia solo con el siguiente «Nueva clase»
  const [clave] = useState(claveNueva);
  const vuela = useRef(false);
  const numero = useRef<HTMLInputElement>(null);
  const titulo = useRef<HTMLInputElement>(null);
  const fecha = useRef<HTMLInputElement>(null);
  const resumen = useRef<HTMLTextAreaElement>(null);
  const liga = useRef<HTMLInputElement>(null);

  useEffect(() => {
    numero.current?.focus();
  }, []);

  function poner(campo: keyof Campos, valor: string) {
    setCampos(c => ({ ...c, [campo]: valor }));
    setErrores(e => (e[campo] ? { ...e, [campo]: undefined } : e));
    setGeneral(null);
  }

  function llevarAlPrimero(e: ErroresCampos) {
    if (e.numero) numero.current?.focus();
    else if (e.titulo) titulo.current?.focus();
    else if (e.grabada_en) fecha.current?.focus();
    else if (e.resumen) resumen.current?.focus();
    else if (e.liga) liga.current?.focus();
  }

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    // el candado va antes de cualquier await: dos clics seguidos no alcanzan a ver el estado nuevo de React
    if (vuela.current) return;
    const faltan = validar(campos, limites, ligaObligatoria);
    if (Object.keys(faltan).length) {
      setErrores(faltan);
      llevarAlPrimero(faltan);
      return;
    }
    let cambios: CambiosClase | null = null;
    if (clase) {
      cambios = cuerpoCambios(clase, campos);
      // nada cambió: no hay nada que mandar
      if (Object.keys(cambios).length === 0) {
        alCancelar();
        return;
      }
    }
    vuela.current = true;
    setEnviando(true);
    setErrores({});
    setGeneral(null);
    try {
      const guardada = clase && cambios ? await editarClase(clase.id, cambios) : await crearClase(cuerpoNuevo(campos, clave));
      alGuardar(guardada);
    } catch (e) {
      const texto = e instanceof Error ? e.message : String(e);
      const codigo =
        e instanceof ErrorApi && typeof e.detalle === 'object' && e.detalle !== null ? (e.detalle as { codigo?: unknown }).codigo : undefined;
      const campo = typeof codigo === 'string' ? CAMPO_DEL_ERROR[codigo] : undefined;
      if (campo) {
        // el texto del servidor, tal cual, junto al campo que hay que corregir
        const e2: ErroresCampos = { [campo]: texto };
        setErrores(e2);
        llevarAlPrimero(e2);
      } else {
        setGeneral(texto);
      }
    } finally {
      vuela.current = false;
      setEnviando(false);
    }
  }

  // en una clase que ya es una liga, la liga es lo único que la hace clase: no se puede dejar vacía
  const ligaObligatoria = clase?.origen === 'liga';
  const hayLiga = !clase || ligaObligatoria; // una clase con archivo no lleva liga
  const resumenMax = limites.resumen_max;
  const errResumen = errores.resumen;
  const idResumen = `${idTitulo}-resumen`;
  return (
    <section aria-labelledby={idTitulo} className="mb-6 rounded-grande border border-linea bg-superficie p-4 sm:p-6">
      <h2 id={idTitulo} className="m-0 mb-4 text-titulo-sm font-bold [overflow-wrap:anywhere]">
        {clase ? `Editar la clase ${clase.numero}` : 'Nueva clase'}
      </h2>
      <form onSubmit={e => void enviar(e)} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Campo
            ref={numero}
            etiqueta="Número de clase"
            ayuda="Es el «Clase N» que verá la persona."
            error={errores.numero ?? null}
            value={campos.numero}
            inputMode="numeric"
            autoComplete="off"
            onChange={e => poner('numero', e.target.value)}
          />
          <Campo
            ref={titulo}
            etiqueta="Título"
            ayuda={`${largo(campos.titulo)} de ${limites.titulo_max}`}
            error={errores.titulo ?? null}
            value={campos.titulo}
            maxLength={limites.titulo_max}
            autoComplete="off"
            onChange={e => poner('titulo', e.target.value)}
          />
        </div>
        <Campo
          ref={fecha}
          etiqueta="Fecha de grabación"
          type="date"
          error={errores.grabada_en ?? null}
          value={campos.grabada_en}
          onChange={e => poner('grabada_en', e.target.value)}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor={idResumen} className="text-sm font-medium">
            {`Para qué sirve (máx. ${resumenMax})`}
          </label>
          <CuadroDeTexto
            ref={resumen}
            id={idResumen}
            rows={3}
            value={campos.resumen}
            maxLength={resumenMax}
            aria-invalid={errResumen ? true : undefined}
            aria-describedby={`${idResumen}-ayuda`}
            {...(errResumen ? { claseCuadro: 'border-error!' } : {})}
            onChange={e => poner('resumen', e.target.value)}
          />
          {errResumen && <p className="m-0 text-xs text-error">{errResumen}</p>}
          <p id={`${idResumen}-ayuda`} className="m-0 text-xs text-secundario">
            {largo(campos.resumen)} de {resumenMax}
          </p>
        </div>
        {hayLiga && (
          <Campo
            ref={liga}
            etiqueta={ligaObligatoria ? 'Liga de referencia' : 'Liga de referencia (opcional)'}
            ayuda={
              ligaObligatoria
                ? 'Esta clase es solo una referencia: no lleva video que subir.'
                : 'Si la pones, la clase es solo una referencia y no lleva video que subir.'
            }
            error={errores.liga ?? null}
            value={campos.liga}
            inputMode="url"
            autoComplete="off"
            {...(limites.liga_max ? { maxLength: limites.liga_max } : {})}
            onChange={e => poner('liga', e.target.value)}
          />
        )}
        {general && <Aviso tipo="error">{general}</Aviso>}
        <div className="flex flex-wrap justify-end gap-3">
          <Boton onClick={alCancelar} disabled={enviando}>
            Cancelar
          </Boton>
          <Boton nivel="principal" type="submit" trabajando={enviando && 'Guardando…'}>
            Guardar clase
          </Boton>
        </div>
      </form>
    </section>
  );
}
