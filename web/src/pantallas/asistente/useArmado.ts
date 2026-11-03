// El prefijo «use» lo exige React (reglas de los hooks).
//
// Todo lo que el Asistente le pregunta al servidor, con su estado: la configuración (si se puede escribir y los límites del pedido) y
// el armado (mandar el pedido, preguntar cómo va con la escalera de nucleo/sondeo.ts y quedarse con el final).
//
//   · Doble envío: `armar` cierra el candado (`enVuelo`) ANTES de que React pinte «Armando…»; un segundo clic no manda nada.
//   · Se pregunta con la escalera 5-5-5-10-10-20 s de `useSondeo` (se duerme con la pestaña oculta y vuelve a preguntar al volver). Un
//     corte de red o un 502/504 no tumban el armado: se sigue intentando solo y se avisa con `sinConexion`. Pasados 10 minutos se
//     deja de esperar, pero después de preguntar una última vez (la pestaña pudo estar oculta y el flujo ya estar listo).
//   · Al desmontar la pantalla no queda nada corriendo: el sondeo se para (useSondeo) y lo que vuela se aborta.
//   · Una respuesta que llega tarde de un armado anterior no pisa el de ahora (cada armado lleva su número).
//   · El pedido NO se guarda: este hook no toca el almacenamiento del navegador.
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSondeo } from '../../nucleo/useSondeo';
import {
  cargarConfig,
  consultarArmado,
  esAbortada,
  esTransitorio,
  fallo,
  falloDe,
  leerArmado,
  leerConfig,
  leerId,
  pedirArmado,
  TEXTO_NO_DISPONIBLE,
  TEXTO_TARDO,
  type Config,
  type Fallo,
  type FlujoListo,
  type Lectura,
} from './logica';

/** Cuánto se espera un armado antes de rendirse. El real tarda de segundos a un par de minutos; esto es solo la red de seguridad. */
export const ESPERA_MAX_MS = 10 * 60_000;

export type Fase =
  | { tipo: 'libre' }
  /** `id` es null mientras el pedido vuela; con el 202 pasa a tener id y empieza el sondeo. `desde`: cuándo empezó (ms del navegador). */
  | { tipo: 'armando'; id: string | null; paso: number; lugar: number | null; desde: number }
  | { tipo: 'listo'; listo: FlujoListo }
  | { tipo: 'sin_cobertura'; mensaje: string; faltan: string[] }
  | { tipo: 'fallo'; fallo: Fallo };

interface Armador {
  config: Config | null;
  /** Por qué no se pudo leer la configuración (sin conexión, no disponible); null si se leyó bien. */
  errorConfig: Fallo | null;
  /** Vuelve a pedir la configuración. Devuelve la nueva, o null si no se pudo. */
  recargarConfig: () => Promise<Config | null>;
  fase: Fase;
  /** El sondeo no logra hablar con el servidor: se sigue intentando solo. */
  sinConexion: boolean;
  /** Manda el pedido (el texto ya viene validado por quien llama: la pantalla lo dice junto al cuadro). false si no lo mandó porque
   *  ya hay otro armándose: el doble clic. */
  armar: (texto: string) => boolean;
  /** Quita un fallo de la vista (la persona empezó a escribir otra cosa). No toca un resultado. */
  descartarFallo: () => void;
}

const ROTA = fallo('respuesta', TEXTO_NO_DISPONIBLE);

/**
 * El fallo de una llamada que NO es la consulta de un pedido (la configuración, mandar el pedido). Un 404 ahí no es «no
 * encontramos ese pedido» —no hay pedido todavía— sino que el servicio no está donde debía: se dice como «no disponible».
 */
function falloDeServicio(e: unknown): Fallo {
  const f = falloDe(e);
  return f.codigo === 'no_encontrada' ? fallo('no_disponible', TEXTO_NO_DISPONIBLE, f.estado) : f;
}

/** De lo que leyó el sondeo a lo que muestra la pantalla. */
function faseDe(l: Exclude<Lectura, { estado: 'armando' }>): Fase {
  if (l.estado === 'listo') return { tipo: 'listo', listo: l.listo };
  if (l.estado === 'sin_cobertura') return { tipo: 'sin_cobertura', mensaje: l.mensaje, faltan: l.faltan };
  return { tipo: 'fallo', fallo: l.fallo };
}

export function useArmado(): Armador {
  const [config, setConfig] = useState<Config | null>(null);
  const [errorConfig, setErrorConfig] = useState<Fallo | null>(null);
  const [fase, setFase] = useState<Fase>({ tipo: 'libre' });
  const [sinConexion, setSinConexion] = useState(false);

  const vivo = useRef(true);
  const enVuelo = useRef(false);
  /** El armado en curso: su número, su id (cuando ya lo hay) y a qué hora empezó. */
  const actual = useRef<{ numero: number; id: string | null; desde: number } | null>(null);
  const contador = useRef(0);
  const vuelaArmado = useRef<AbortController | null>(null);
  const vuelaConfig = useRef<AbortController | null>(null);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
      vuelaArmado.current?.abort();
      vuelaConfig.current?.abort();
    };
  }, []);

  const recargarConfig = useCallback(async (): Promise<Config | null> => {
    vuelaConfig.current?.abort();
    const control = new AbortController();
    vuelaConfig.current = control;
    try {
      const c = leerConfig(await cargarConfig(control.signal));
      if (!vivo.current || control.signal.aborted) return null;
      if (!c) {
        setErrorConfig(ROTA);
        return null;
      }
      setConfig(c);
      setErrorConfig(null);
      return c;
    } catch (e) {
      if (!vivo.current || esAbortada(e)) return null;
      setErrorConfig(falloDeServicio(e));
      return null;
    }
  }, []);

  // al abrir: el primer vistazo corre fuera del render (así el setState de recargarConfig no cae dentro del efecto)
  useEffect(() => {
    const t = setTimeout(() => void recargarConfig(), 0);
    return () => clearTimeout(t);
  }, [recargarConfig]);

  /** El armado terminó (bien o mal): se libera el candado y se enseña el final. Solo si sigue siendo ESTE armado. */
  const terminar = useCallback((numero: number, final: Fase) => {
    if (!vivo.current || actual.current?.numero !== numero) return;
    actual.current = null;
    enVuelo.current = false;
    setSinConexion(false);
    setFase(final);
  }, []);

  /** Lo que pasa después de mandar el pedido: el 202 con el id (y a preguntar), o un final, o un error. */
  const mandar = useCallback(
    async (texto: string, numero: number, desde: number, senal: AbortSignal): Promise<void> => {
      try {
        const datos = await pedirArmado(texto, senal);
        if (!vivo.current || actual.current?.numero !== numero) return;
        const lectura = leerArmado(datos);
        const id = leerId(datos);
        if (lectura.estado !== 'armando') {
          terminar(numero, faseDe(lectura));
        } else if (id === null) {
          terminar(numero, { tipo: 'fallo', fallo: ROTA });
        } else {
          actual.current = { numero, id, desde };
          setFase({ tipo: 'armando', id, paso: lectura.paso ?? 0, lugar: lectura.lugar, desde });
        }
      } catch (e) {
        if (esAbortada(e)) return;
        terminar(numero, { tipo: 'fallo', fallo: falloDeServicio(e) });
      }
    },
    [terminar],
  );

  const armar = useCallback(
    (texto: string): boolean => {
      // el candado va antes que cualquier `await` y que cualquier setState: un segundo clic en el mismo tic ya lo encuentra cerrado
      if (enVuelo.current) return false;
      enVuelo.current = true;
      contador.current += 1;
      const numero = contador.current;
      const desde = Date.now();
      actual.current = { numero, id: null, desde };
      vuelaArmado.current?.abort();
      const control = new AbortController();
      vuelaArmado.current = control;
      setSinConexion(false);
      setFase({ tipo: 'armando', id: null, paso: 0, lugar: null, desde });
      void mandar(texto, numero, desde, control.signal);
      return true;
    },
    [mandar],
  );

  // preguntar cómo va: mientras haya un armado con id. La tarea devuelve true cuando ya no hace falta seguir (el final llegó o es
  // un error que no se arregla esperando).
  const sondeando = fase.tipo === 'armando' && fase.id !== null;
  useSondeo(sondeando, async () => {
    const a = actual.current;
    if (!a || a.id === null) return true;
    // El tope se mira ANTES de preguntar pero se aplica DESPUÉS: con la pestaña oculta el sondeo se duerme, y al volver pueden haber pasado
    // más de 10 minutos con el flujo ya terminado en el servidor; rendirse sin preguntar tiraba un resultado hecho. Una última pregunta, y si
    // sigue «armando» (o no hay manera de preguntar) ahí sí se deja de esperar.
    const vencido = Date.now() - a.desde > ESPERA_MAX_MS;
    const seRinde = () => {
      terminar(a.numero, { tipo: 'fallo', fallo: fallo('tardo', TEXTO_TARDO) });
      return true;
    };
    const control = new AbortController();
    vuelaArmado.current = control;
    try {
      const lectura = leerArmado(await consultarArmado(a.id, control.signal));
      if (!vivo.current || actual.current?.numero !== a.numero) return true;
      setSinConexion(false);
      if (lectura.estado === 'armando') {
        if (vencido) return seRinde();
        setFase(previa => {
          if (previa.tipo !== 'armando') return previa;
          // los pasos solo avanzan: una respuesta vieja que llega tarde no los regresa
          const paso = Math.max(previa.paso, lectura.paso ?? previa.paso);
          return paso === previa.paso && lectura.lugar === previa.lugar ? previa : { ...previa, paso, lugar: lectura.lugar };
        });
        return false;
      }
      terminar(a.numero, faseDe(lectura));
      return true;
    } catch (e) {
      if (esAbortada(e) || !vivo.current) return true;
      const f = falloDe(e);
      if (esTransitorio(f)) {
        // un corte pasa solo: se sigue preguntando y se avisa (salvo que ya se pasó el tope: no se espera para siempre)
        if (vencido) return seRinde();
        setSinConexion(true);
        return false;
      }
      terminar(a.numero, { tipo: 'fallo', fallo: f });
      return true;
    }
  });

  const descartarFallo = useCallback(() => setFase(f => (f.tipo === 'fallo' ? { tipo: 'libre' } : f)), []);

  return { config, errorConfig, recargarConfig, fase, sinConexion, armar, descartarFallo };
}
