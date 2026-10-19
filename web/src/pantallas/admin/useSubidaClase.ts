// El prefijo «use» lo exige React (reglas de los hooks).
//
// Subir el video de UNA clase, en este orden y sin saltarse ninguno: permiso (POST …/subida: el servidor elige la clave de S3) →
// PUT directo a S3 con progreso (subirConProgreso, el de siempre) → confirmar (POST …/confirmar: el servidor mira con HEAD que el
// archivo exista) → medir (POST …/medir: ffprobe sobre una URL firmada). Nada de esto llama a un proveedor de pago.
//
// · Doble clic = una subida: el candado va ANTES del primer await.
// · Cancelar corta el PUT y NO confirma: el servidor devuelve la clase a «borrador» (POST …/cancelar).
// · Si algo falla después del permiso, se intenta devolver la clase a «borrador» para que la persona pueda volver a elegir el
//   video; si ni eso se puede, la tarjeta ofrece «Cancelar subida».
// · Cerrar la pestaña con la subida a medias la pierde: el navegador avisa (beforeunload). El aviso se quita cuando la subida
//   termina, no cuando la tarjeta se desmonta: cambiar de pestaña del panel no la detiene.
import { useRef, useState } from 'react';

import { ErrorApi } from '../../nucleo/api';
import { subirConProgreso } from '../../nucleo/subida';
import {
  cancelarSubida,
  confirmarSubida,
  medirClase,
  motivoDeRechazo,
  pedirSubida,
  type Clase,
  type LimitesClases,
} from './logicaClases';

export const TEXTO_FALLO_SUBIDA = 'No se pudo subir el video. Revisa tu conexión e inténtalo otra vez.';
export const TEXTO_SUBIDA_CANCELADA = 'Subida cancelada. Puedes elegir el video otra vez.';

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

const avisarAlSalir = (e: BeforeUnloadEvent) => e.preventDefault();

class Cancelada extends Error {}

const textoDe = (e: unknown, respaldo: string) => (e instanceof ErrorApi ? e.message : respaldo);

export function useSubidaClase(id: string, limites: LimitesClases, alClase: (c: Clase) => void) {
  const [progreso, setProgreso] = useState<Progreso | null>(null);
  const [nota, setNota] = useState<Nota | null>(null);
  const candado = useRef(false);
  const cancelado = useRef(false);
  const cortarPut = useRef<(() => void) | null>(null);

  /** Medir la duración: va después de confirmar, y también sola con «Medir duración» si falló. */
  async function medir(subidaReciente: boolean) {
    setProgreso({ fase: 'midiendo', pct: 100, cargados: 0, total: 0 });
    try {
      alClase(await medirClase(id));
    } catch (e) {
      const texto = textoDe(e, 'No se pudo medir el video.');
      setNota({ tipo: 'error', texto: subidaReciente ? `El video quedó subido, pero no se pudo medir cuánto dura. ${texto}` : texto });
    }
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
    window.addEventListener('beforeunload', avisarAlSalir);
    setProgreso({ fase: 'permiso', pct: 0, cargados: 0, total: archivo.size });
    // el servidor ya tiene la clase como «subiendo»: si algo falla hay que devolverla a «borrador»
    let abierta = false;
    try {
      try {
        const permiso = await pedirSubida(id, archivo);
        abierta = true;
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
        setProgreso({ fase: 'confirmando', pct: 100, cargados: archivo.size, total: archivo.size });
        const clase = await confirmarSubida(id, archivo.name);
        abierta = false;
        alClase(clase);
      } catch (e) {
        cortarPut.current = null;
        if (abierta) {
          try {
            alClase(await cancelarSubida(id));
          } catch {
            /* se queda como estaba: la tarjeta ofrece «Cancelar subida» */
          }
        }
        setNota(
          cancelado.current
            ? { tipo: 'aviso', texto: TEXTO_SUBIDA_CANCELADA }
            : { tipo: 'error', texto: textoDe(e, TEXTO_FALLO_SUBIDA) },
        );
        return;
      }
      await medir(true);
    } finally {
      window.removeEventListener('beforeunload', avisarAlSalir);
      cortarPut.current = null;
      candado.current = false;
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

  /** Una subida que quedó a medias en el servidor (se cerró la pestaña): la devuelve a «borrador». */
  async function soltarSubidaVieja() {
    if (candado.current) return;
    candado.current = true;
    setNota(null);
    try {
      alClase(await cancelarSubida(id));
    } catch (e) {
      setNota({ tipo: 'error', texto: textoDe(e, 'No se pudo cancelar la subida. Inténtalo otra vez.') });
    } finally {
      candado.current = false;
    }
  }

  const puedeCancelar = progreso?.fase === 'permiso' || progreso?.fase === 'subiendo';
  return { progreso, nota, subir, cancelar, puedeCancelar, medirOtraVez, soltarSubidaVieja, quitarNota: () => setNota(null) };
}
