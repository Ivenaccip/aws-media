// El prefijo «use» lo exige React (reglas de los hooks).
//
// Subir el video de UNA clase, en este orden y sin saltarse ninguno: permiso (POST …/subida: el servidor elige la clave de S3 y
// da el TOKEN de esta subida) → PUT directo a S3 con progreso (subirConProgreso, el de siempre) → confirmar (POST …/confirmar: el
// servidor mira con HEAD que el archivo exista) → medir (POST …/medir: ffprobe sobre una URL firmada). Nada de esto llama a un
// proveedor de pago.
//
// · Doble clic = una subida: el candado va ANTES del primer await.
// · Cancelar corta el PUT y NO confirma: el servidor devuelve la clase a «borrador» (POST …/cancelar).
// · El token viaja en confirmar y en cancelar: si la subida ya no es la vigente (se empezó otra, se canceló desde otra pestaña),
//   el servidor contesta 409 `subida_cambio` y no toca nada. Aquí eso NO se cancela ni se trata como falla de red: se dice y se
//   vuelve a pedir la clase. Una subida que quedó a medias (se cerró la pestaña) no sabe su token y cancela sin él.
// · Si el permiso o el PUT fallan, se intenta devolver la clase a «borrador». Si ni eso se puede (sin internet), la clase se
//   queda como la tiene el servidor —«subiendo»— y la tarjeta ofrece «Cancelar subida».
// · Con el PUT ya terminado, un fallo de CONFIRMAR no tira el video a la basura: si es pasajero (red, 5xx, `s3_fallo`, una base
//   dormida) la clase se queda «subiendo», el video ya está en la nube y la tarjeta ofrece «Reintentar la confirmación». Solo un
//   rechazo definitivo (el archivo no está, está vacío, pesa distinto, no es video) suelta la subida.
// · Cerrar la pestaña con la subida a medias la pierde: el navegador avisa (beforeunload). Hay UN solo aviso para todas las
//   subidas y se quita cuando termina la última, no la primera; tampoco se quita porque la tarjeta se desmonte.
import { useEffect, useRef, useState } from 'react';

import { ErrorApi } from '../../nucleo/api';
import { subirConProgreso } from '../../nucleo/subida';
import {
  cancelarSubida,
  confirmarSubida,
  esFalloAmbiguo,
  esRechazoDefinitivo,
  esSubidaCambio,
  medirClase,
  motivoDeRechazo,
  pedirSubida,
  type Clase,
  type LimitesClases,
} from './logicaClases';

export const TEXTO_FALLO_SUBIDA = 'No se pudo subir el video. Revisa tu conexión e inténtalo otra vez.';
export const TEXTO_SUBIDA_CANCELADA = 'Subida cancelada. Puedes elegir el video otra vez.';
export const TEXTO_SUBIDA_AJENA = 'Esa subida ya no es la vigente: se empezó otra o se canceló. No se cambió nada.';
/** La subida quedó abierta en el servidor (no hubo internet para soltarla): la tarjeta ofrece «Cancelar subida». */
export const TEXTO_QUEDO_ABIERTA = 'La subida quedó abierta en el servidor: pulsa «Cancelar subida» para volver a elegir el video.';
const TEXTO_CORTADA_SIN_SOLTAR = `Cortamos la subida, pero no pudimos avisarle al servidor. ${TEXTO_QUEDO_ABIERTA}`;
const TEXTO_YA_SOLTADA = 'Ya soltamos esa subida: puedes elegir el video otra vez.';

export type Fase = 'permiso' | 'subiendo' | 'confirmando' | 'midiendo';

export interface Progreso {
  fase: Fase;
  pct: number;
  cargados: number;
  total: number;
}

export interface Nota {
  tipo: 'error' | 'aviso';
  texto: string;
}

// ---------------------------------------------------------------------------
// El aviso de cerrar la pestaña: UN listener para todas las subidas y un contador. Cada tarjeta tiene su propio candado, así que
// se pueden subir varias clases a la vez; quitar el aviso cuando termina la primera dejaba a las demás sin protección.

let subidasActivas = 0;
const avisarAlSalir = (e: BeforeUnloadEvent) => e.preventDefault();

function sumarSubida() {
  if (subidasActivas++ === 0) window.addEventListener('beforeunload', avisarAlSalir);
}

function restarSubida() {
  if (subidasActivas > 0 && --subidasActivas === 0) window.removeEventListener('beforeunload', avisarAlSalir);
}

/** Solo para las pruebas: lo que una prueba dejó a medias no se arrastra a la siguiente. */
export function reiniciarAvisoDeSalida() {
  subidasActivas = 0;
  window.removeEventListener('beforeunload', avisarAlSalir);
}

// ---------------------------------------------------------------------------

class Cancelada extends Error {}

const textoDe = (e: unknown, respaldo: string) => (e instanceof ErrorApi ? e.message : respaldo);

const unir = (...partes: Array<string | false | undefined>) => partes.filter(Boolean).join(' ');

/** Cómo salió devolver la clase a «borrador». */
type Cierre = { r: 'hecho' } | { r: 'ajena'; error: unknown } | { r: 'fallo'; error: unknown };

export function useSubidaClase(clase: Clase, limites: LimitesClases, alClase: (c: Clase) => void, alRecargar: () => void) {
  const id = clase.id;
  const [progreso, setProgreso] = useState<Progreso | null>(null);
  const [nota, setNota] = useState<Nota | null>(null);
  /** El PUT terminó y confirmar falló por algo pasajero: la clase sigue «subiendo» y se puede volver a confirmar. */
  const [sinConfirmar, setSinConfirmar] = useState(false);
  const candado = useRef(false);
  const cancelado = useRef(false);
  const cortarPut = useRef<(() => void) | null>(null);
  /** El token de la subida propia; vacío en una subida que quedó a medias. */
  const token = useRef<string | undefined>(undefined);
  const pendiente = useRef<{ nombre: string; bytes: number } | null>(null);
  const cuenta = useRef(false);
  // lo último que llegó por props, para las funciones que siguen vivas cuando la tarjeta se vuelve a pintar
  const ultimo = useRef({ clase, alClase, alRecargar });
  useEffect(() => {
    ultimo.current = { clase, alClase, alRecargar };
  });
  // si la tarjeta se desmonta con la confirmación pendiente (nadie la va a reintentar), el aviso de cerrar la pestaña no se queda
  useEffect(
    () => () => {
      if (!candado.current && cuenta.current) {
        cuenta.current = false;
        restarSubida();
      }
    },
    [],
  );

  /** Cuenta (o deja de contar) esta tarjeta en el aviso de cerrar la pestaña. */
  function contar(si: boolean) {
    if (cuenta.current === si) return;
    cuenta.current = si;
    if (si) sumarSubida();
    else restarSubida();
  }

  function ponerPendiente(p: { nombre: string; bytes: number } | null) {
    pendiente.current = p;
    setSinConfirmar(p !== null);
  }

  /** Medir la duración: va después de confirmar, y también sola con «Medir duración» si falló. */
  async function medir(subidaReciente: boolean) {
    setProgreso({ fase: 'midiendo', pct: 100, cargados: 0, total: 0 });
    try {
      ultimo.current.alClase(await medirClase(id));
    } catch (e) {
      const texto = textoDe(e, 'No se pudo medir el video.');
      setNota({ tipo: 'error', texto: subidaReciente ? `El video quedó subido, pero no se pudo medir cuánto dura. ${texto}` : texto });
    }
  }

  /** Devuelve la clase a «borrador» con el token de ESTA subida. */
  async function soltar(): Promise<Cierre> {
    try {
      const vuelta = await cancelarSubida(id, token.current);
      token.current = undefined;
      ultimo.current.alClase(vuelta);
      return { r: 'hecho' };
    } catch (e) {
      if (esSubidaCambio(e)) {
        // no era la vigente: el servidor no tocó nada. Se olvida el token y se vuelve a pedir la clase para ver cómo quedó
        token.current = undefined;
        ultimo.current.alRecargar();
        return { r: 'ajena', error: e };
      }
      return { r: 'fallo', error: e };
    }
  }

  /** El permiso o el PUT fallaron (o la persona canceló): la clase vuelve a «borrador» si se puede, y se dice qué pasó. */
  async function alFallarAntesDeConfirmar(e: unknown, abierta: boolean) {
    const cancelada = cancelado.current;
    const cierre = abierta ? await soltar() : null;
    // el permiso no contestó (sin red, 5xx): el servidor pudo haber dejado la clase «subiendo» sin que aquí se sepa
    if (!abierta && esFalloAmbiguo(e)) ultimo.current.alRecargar();
    if (cierre?.r === 'ajena') {
      setNota({ tipo: 'aviso', texto: textoDe(cierre.error, TEXTO_SUBIDA_AJENA) });
    } else if (cancelada) {
      setNota(cierre?.r === 'fallo' ? { tipo: 'error', texto: TEXTO_CORTADA_SIN_SOLTAR } : { tipo: 'aviso', texto: TEXTO_SUBIDA_CANCELADA });
    } else {
      setNota({ tipo: 'error', texto: unir(textoDe(e, TEXTO_FALLO_SUBIDA), cierre?.r === 'fallo' && TEXTO_QUEDO_ABIERTA) });
    }
  }

  /** El video ya está en la nube (o se cree que sí): confirmar con el token y medir. `propia`: la subida la hizo esta tarjeta. */
  async function confirmarYMedir(nombre: string | undefined, bytes: number, propia: boolean) {
    ponerPendiente(null);
    setProgreso({ fase: 'confirmando', pct: 100, cargados: bytes, total: bytes });
    let confirmada: Clase;
    try {
      confirmada = await confirmarSubida(id, nombre, token.current);
    } catch (e) {
      if (esSubidaCambio(e)) {
        token.current = undefined;
        setNota({ tipo: 'aviso', texto: textoDe(e, TEXTO_SUBIDA_AJENA) });
        ultimo.current.alRecargar();
      } else if (propia && esRechazoDefinitivo(e)) {
        // el servidor miró el archivo y no sirve: reintentar no lo arregla, se suelta la subida para elegir otro video
        const cierre = await soltar();
        const dicho = textoDe(e, TEXTO_FALLO_SUBIDA);
        setNota(
          cierre.r === 'hecho'
            ? { tipo: 'error', texto: unir(dicho, TEXTO_YA_SOLTADA) }
            : cierre.r === 'ajena'
              ? { tipo: 'aviso', texto: textoDe(cierre.error, TEXTO_SUBIDA_AJENA) }
              : { tipo: 'error', texto: unir(dicho, TEXTO_QUEDO_ABIERTA) },
        );
      } else if (propia) {
        // pasajero: el video ya llegó. La clase se queda «subiendo» y se puede confirmar otra vez, sin volver a subir nada
        ponerPendiente({ nombre: nombre ?? '', bytes });
        setNota({
          tipo: 'error',
          texto: unir(
            'Tu video ya llegó a la nube, pero no pudimos confirmarlo.',
            textoDe(e, ''),
            'No hace falta subirlo otra vez: pulsa «Reintentar la confirmación».',
          ),
        });
      } else {
        // una subida que quedó a medias y de la que aquí no se sabe nada: se dice lo que contestó el servidor y nada más
        setNota({ tipo: 'error', texto: textoDe(e, 'No se pudo confirmar el video. Inténtalo otra vez.') });
      }
      return;
    }
    token.current = undefined;
    ultimo.current.alClase(confirmada);
    await medir(true);
  }

  async function subir(archivo: File) {
    if (candado.current) return;
    setNota(null);
    const motivo = motivoDeRechazo(archivo, limites);
    if (motivo) {
      setNota({ tipo: 'error', texto: motivo });
      return;
    }
    candado.current = true; // antes de cualquier await: doble clic = una subida
    cancelado.current = false;
    token.current = undefined;
    ponerPendiente(null);
    contar(true);
    setProgreso({ fase: 'permiso', pct: 0, cargados: 0, total: archivo.size });
    try {
      // el servidor ya tiene la clase como «subiendo»: si algo falla hay que devolverla a «borrador»
      let abierta = false;
      try {
        const permiso = await pedirSubida(id, archivo);
        abierta = true;
        token.current = permiso.token;
        // lo que el servidor acaba de hacer, también aquí: si más tarde no hay internet para soltarla, la tarjeta ya sabe que
        // quedó «subiendo» y ofrece «Cancelar subida»
        ultimo.current.alClase({ ...ultimo.current.clase, estado: 'subiendo' });
        if (cancelado.current) throw new Cancelada();
        setProgreso({ fase: 'subiendo', pct: 0, cargados: 0, total: archivo.size });
        // la clave de S3 no se ve desde aquí: el PUT solo necesita la URL firmada y el tipo con el que se firmó
        const s = subirConProgreso({ url: permiso.url, key: '', content_type: permiso.content_type }, archivo, a =>
          setProgreso({ fase: 'subiendo', pct: a.pct, cargados: a.cargados, total: a.total }),
        );
        cortarPut.current = s.cancelar;
        await s.hecho;
        cortarPut.current = null;
        if (cancelado.current) throw new Cancelada();
      } catch (e) {
        cortarPut.current = null;
        await alFallarAntesDeConfirmar(e, abierta);
        return;
      }
      await confirmarYMedir(archivo.name, archivo.size, true);
    } finally {
      cortarPut.current = null;
      candado.current = false;
      contar(pendiente.current !== null); // con la confirmación pendiente, cerrar la pestaña todavía pierde el video
      setProgreso(null);
    }
  }

  /** Confirmar otra vez: el video ya llegó a la nube y la clase sigue «subiendo». También sirve en una subida que quedó a medias. */
  async function reintentarConfirmacion() {
    if (candado.current) return;
    const p = pendiente.current;
    candado.current = true;
    setNota(null);
    contar(true);
    try {
      await confirmarYMedir(p?.nombre || undefined, p?.bytes ?? 0, p !== null);
    } finally {
      candado.current = false;
      contar(pendiente.current !== null);
      setProgreso(null);
    }
  }

  async function medirOtraVez() {
    if (candado.current) return;
    candado.current = true;
    setNota(null);
    try {
      await medir(false);
    } finally {
      candado.current = false;
      setProgreso(null);
    }
  }

  /** Solo antes de que el video termine de subir: después ya no hay nada que cancelar. */
  function cancelar() {
    if (!candado.current) return;
    cancelado.current = true;
    cortarPut.current?.();
  }

  /** Una subida que quedó abierta en el servidor (se cerró la pestaña, no hubo internet, la confirmación no pasó): la devuelve a «borrador». */
  async function soltarSubidaVieja() {
    if (candado.current) return;
    candado.current = true;
    setNota(null);
    try {
      const cierre = await soltar();
      if (cierre.r === 'fallo') {
        const e = cierre.error;
        setNota({ tipo: 'error', texto: textoDe(e, 'No se pudo cancelar la subida. Inténtalo otra vez.') });
        // un 409 aquí es casi seguro una tarjeta desactualizada (la subida ya terminó o se canceló): se vuelve a pedir la clase
        if (e instanceof ErrorApi && e.estado === 409) ultimo.current.alRecargar();
        return;
      }
      ponerPendiente(null);
      setNota(cierre.r === 'hecho' ? { tipo: 'aviso', texto: TEXTO_SUBIDA_CANCELADA } : { tipo: 'aviso', texto: textoDe(cierre.error, TEXTO_SUBIDA_AJENA) });
    } finally {
      candado.current = false;
      contar(pendiente.current !== null);
    }
  }

  const puedeCancelar = progreso?.fase === 'permiso' || progreso?.fase === 'subiendo';
  return {
    progreso,
    nota,
    sinConfirmar,
    subir,
    cancelar,
    puedeCancelar,
    medirOtraVez,
    reintentarConfirmacion,
    soltarSubidaVieja,
    quitarNota: () => setNota(null),
  };
}
