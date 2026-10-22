// El borrador del Constructor en el navegador (decisión D3 del plan): el flujo que se está armando se guarda en `localStorage` para que no
// se pierda al recargar, al ir al Asistente y volver, ni cuando la sesión caduca a media edición. Aquí vive lo que toca el navegador y el
// reloj; las reglas (qué se guarda, qué se rechaza, claves pegadas) son del módulo puro `modelo/borrador.ts`.
//
// Orden que importa (informe 04 §9.5):
//  1. CARGAR antes de guardar: `leerArranque` lee el borrador UNA vez, al crear el estado. Guardar un lienzo vacío BORRA el borrador, así
//     que nada se guarda hasta que el flujo cambia de verdad (lo que se cargó no se vuelve a escribir). La excepción es un flujo que dejó
//     el Asistente (`origen: 'asistente'`): se guarda enseguida para quitarle esa marca, y al recargar ya es «tu borrador».
//  2. GUARDAR diferido (`ESPERA_GUARDADO_MS` después del último cambio) y de inmediato en `auth:saliendo` (la sesión caducó y `auth.js`
//     está por navegar a otro sitio) y en `pagehide` (la pestaña se cierra o se recarga).
//  3. Si no se pudo guardar (parece una clave, el almacenamiento está lleno o negado) se dice UNA vez por motivo. Cuando un guardado sale
//     bien, el aviso se retira (`alGuardarBien`) y se rearma: si después vuelve a pasar, se vuelve a decir. Un guardado que falló se
//     reintenta al salir (`auth:saliendo`, `pagehide`): solo cuenta como guardado el que de verdad se escribió.
//  4. DOS PESTAÑAS: este hook recuerda el texto exacto que leyó o escribió por última vez (`visto`). Si cuando va a guardar lo que hay en
//     el almacenamiento es otra cosa —otra pestaña lo cambió, o el Asistente dejó ahí su flujo—, NO lo pisa: lo dice una vez
//     (`alConflicto`) y deja de guardar en esta pestaña hasta que se recargue. También se entera al momento por el evento `storage`.
//
// «Limpiar» borra también el borrador: un flujo sin cuadros no es un borrador y `guardar` lo trata como «borra el borrador».
import { useCallback, useEffect, useRef } from 'react';

import {
  CLAVE_BORRADOR,
  crearBorrador,
  seDescarto,
  TEXTO_NO_GUARDADO,
  TEXTO_NO_RECUPERADO,
  type MotivoNoGuardar,
} from './modelo/borrador';
import { estadoInicial } from './modelo/reductor';
import type { AvisoConstructor, EstadoConstructor, Flujo, Nodo, TipoAviso } from './modelo/tipos';

/** Cuánto se espera, después del último cambio, para escribir el borrador. */
export const ESPERA_GUARDADO_MS = 500;

/** Lo que se dice al abrir con un borrador de la persona. */
export const TEXTO_RECUPERADO = 'Recuperamos tu borrador.';
/** Lo que se dice al abrir con el flujo que dejó el Asistente. */
export const TEXTO_DEL_ASISTENTE = 'Abrimos tu flujo del Asistente.';
/** La línea fija de privacidad de la pantalla. */
export const TEXTO_PRIVACIDAD = 'Tu borrador se guarda solo en este navegador.';
/** Lo que se dice cuando otra pestaña cambió el borrador y esta deja de guardar para no pisarlo. */
export const TEXTO_OTRA_PESTANA =
  'Este borrador cambió en otra pestaña, así que dejamos de guardar aquí para no pisarlo. Recarga esta página para ver la última versión; si quieres conservar lo de esta pestaña, descarga el .json.';

// el almacenamiento de verdad: una función, porque en algunos navegadores solo LEER `window.localStorage` lanza (el módulo puro lo atrapa)
const borrador = crearBorrador(() => window.localStorage);

/** El texto exacto que hay guardado ahora (null si no hay nada o si el navegador no deja mirar). Nunca lanza. */
function leerCrudo(): string | null {
  try {
    return window.localStorage.getItem(CLAVE_BORRADOR);
  } catch {
    return null;
  }
}

/** Lo que dice cómo arrancó la pantalla. */
export interface Arranque {
  /** El estado con el que arranca el reductor (con el aviso de «Recuperamos tu borrador» ya puesto, si toca). */
  estado: EstadoConstructor;
  /** ¿Hay que escribir el borrador al entrar? Solo si lo dejó el Asistente (para quitarle la marca). */
  guardarAlEntrar: boolean;
  /** El texto exacto que había guardado al leerlo (lo que `useBorrador` compara antes de escribir, por si otra pestaña lo cambia). */
  crudo: string | null;
}

/** El estado con un aviso de arranque: su `id` es 1 y `eventos` ya cuenta con él. */
function conAvisoDeArranque(e: EstadoConstructor, texto: string, tipo: TipoAviso): EstadoConstructor {
  const aviso: AvisoConstructor = { id: e.eventos + 1, texto, tipo, conDeshacer: false };
  return { ...e, eventos: aviso.id, aviso };
}

/** El primer agente del flujo, o si no hay, el primer cuadro. */
function primeroParaElegir(nodes: readonly Nodo[]): string | null {
  return (nodes.find(n => n.kind === 'agent') ?? nodes[0])?.id ?? null;
}

/**
 * Lee el borrador y arma el estado de arranque. Se llama UNA vez al montar (en el inicializador de un `useState`):
 *  · sin borrador, o sin almacenamiento: un lienzo vacío, sin aviso;
 *  · un borrador que no sirve (roto, de una versión futura, con una clave, inválido): un lienzo vacío y se dice que no se pudo recuperar;
 *  · un borrador de la persona: su flujo y «Recuperamos tu borrador.»;
 *  · el flujo del Asistente: su flujo, «Abrimos tu flujo del Asistente.», el primer agente elegido y el foco en él.
 */
export function leerArranque(): Arranque {
  const crudo = leerCrudo();
  const r = borrador.cargar();
  if (!r.ok) {
    const vacio = estadoInicial();
    return { estado: seDescarto(r.motivo) ? conAvisoDeArranque(vacio, TEXTO_NO_RECUPERADO, 'info') : vacio, guardarAlEntrar: false, crudo };
  }
  const e = estadoInicial(r.flujo);
  if (r.origen !== 'asistente') return { estado: conAvisoDeArranque(e, TEXTO_RECUPERADO, 'ok'), guardarAlEntrar: false, crudo };
  const sel = primeroParaElegir(e.flujo.nodes);
  const conAviso = conAvisoDeArranque(e, TEXTO_DEL_ASISTENTE, 'ok');
  if (sel === null) return { estado: conAviso, guardarAlEntrar: true, crudo };
  const n = conAviso.eventos + 1;
  return { estado: { ...conAviso, sel, eventos: n, foco: { objetivo: { k: 'nodo', id: sel }, n } }, guardarAlEntrar: true, crudo };
}

export interface OpcionesUseBorrador {
  /** Escribir el borrador aunque el flujo no haya cambiado (el que dejó el Asistente). */
  guardarAlEntrar: boolean;
  /** Lo que `leerArranque` encontró guardado (`Arranque.crudo`): con qué se compara antes de escribir. */
  crudoInicial: string | null;
  /** Se llama UNA vez por motivo cuando no se pudo guardar; `texto` ya viene en palabras de persona. */
  alNoGuardar: (motivo: MotivoNoGuardar, texto: string) => void;
  /** Un guardado salió bien después de haber avisado que no se podía: el aviso ya no es cierto y la pantalla lo retira. */
  alGuardarBien: () => void;
  /** Otra pestaña cambió el borrador: esta deja de guardar. Se llama UNA vez; `texto` ya viene en palabras de persona. */
  alConflicto: (texto: string) => void;
}

/** Guarda `flujo` como borrador (diferido, y de inmediato al salir). No devuelve nada: la pantalla no depende de que se guarde. */
export function useBorrador(flujo: Flujo, { guardarAlEntrar, crudoInicial, alNoGuardar, alGuardarBien, alConflicto }: OpcionesUseBorrador): void {
  // el último flujo que se guardó de verdad (o el que se cargó: no hay por qué reescribirlo)
  const ultimo = useRef<Flujo | null>(guardarAlEntrar ? null : flujo);
  const reciente = useRef(flujo);
  const avisar = useRef(alNoGuardar);
  const avisarBien = useRef(alGuardarBien);
  const avisarConflicto = useRef(alConflicto);
  const dichos = useRef<Set<MotivoNoGuardar> | null>(null);
  // el texto exacto que esta pestaña leyó o escribió por última vez, y si ya se supo que otra pestaña lo cambió
  const visto = useRef<string | null>(crudoInicial);
  const enConflicto = useRef(false);

  useEffect(() => {
    reciente.current = flujo;
    avisar.current = alNoGuardar;
    avisarBien.current = alGuardarBien;
    avisarConflicto.current = alConflicto;
  });

  const declararConflicto = useCallback(() => {
    if (enConflicto.current) return;
    enConflicto.current = true;
    avisarConflicto.current(TEXTO_OTRA_PESTANA);
  }, []);

  const guardar = useCallback(() => {
    const f = reciente.current;
    if (ultimo.current === f || enConflicto.current) return;
    // otra pestaña (o el Asistente) escribió el borrador desde que esta lo leyó o lo escribió: lo suyo vale más que un cambio que ni vio
    if (leerCrudo() !== visto.current) {
      declararConflicto();
      return;
    }
    const r = borrador.guardar(f);
    dichos.current ??= new Set();
    if (r.ok) {
      // solo un guardado que de verdad se escribió cuenta: si falló, `auth:saliendo` y `pagehide` lo reintentan
      ultimo.current = f;
      visto.current = leerCrudo();
      if (dichos.current.size > 0) {
        dichos.current.clear();
        avisarBien.current();
      }
      return;
    }
    if (dichos.current.has(r.motivo)) return;
    dichos.current.add(r.motivo);
    avisar.current(r.motivo, TEXTO_NO_GUARDADO[r.motivo]);
  }, [declararConflicto]);

  // diferido: cada cambio reinicia la espera
  useEffect(() => {
    if (ultimo.current === flujo) return;
    const t = setTimeout(guardar, ESPERA_GUARDADO_MS);
    return () => clearTimeout(t);
  }, [flujo, guardar]);

  // inmediato: la sesión caducó (auth.js avisa justo antes de irse) o la pestaña se cierra o se recarga
  useEffect(() => {
    window.addEventListener('auth:saliendo', guardar);
    window.addEventListener('pagehide', guardar);
    return () => {
      window.removeEventListener('auth:saliendo', guardar);
      window.removeEventListener('pagehide', guardar);
    };
  }, [guardar]);

  // otra pestaña escribió (o borró) el borrador: se entera al momento y no espera al próximo guardado
  useEffect(() => {
    const alCambiar = (e: StorageEvent) => {
      if (e.key !== null && e.key !== CLAVE_BORRADOR) return;
      if (leerCrudo() !== visto.current) declararConflicto();
    };
    window.addEventListener('storage', alCambiar);
    return () => window.removeEventListener('storage', alCambiar);
  }, [declararConflicto]);
}
