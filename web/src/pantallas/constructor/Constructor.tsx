// /estudio/constructor/ — el Constructor de automatizaciones: un lienzo estilo n8n donde la persona arma su flujo cuadro por cuadro y lo
// descarga como un .json que se importa en n8n. Todo pasa en el navegador: no llama a ningún servicio, no cobra y no manda nada.
//
// Esta pantalla solo ENSAMBLA. Las reglas del flujo, el menú, las flechas y el archivo de n8n viven en `modelo/` (puro y probado); los
// componentes de esta carpeta dibujan lo que calculan los selectores y devuelven eventos; aquí:
//   · `useReducer(reducir, …)` es la ÚNICA puerta por la que cambia el flujo (los topes y las reglas son del reductor);
//   · los selectores de `modelo/selectores.ts` se convierten en las props del lienzo y de los paneles;
//   · los EFECTOS que el reductor pide dentro del estado (`foco`, `ver`, `scrollAjustes`, `aviso`) se cumplen aquí, con el contrato de
//     atributos de foco de abajo, y se apagan con `limpiarPeticiones`;
//   · el borrador del navegador (`useBorrador`), el archivo (`descargarArchivo`) y los avisos de la esquina (`avisar`).
//
// CONTRATO DE ATRIBUTOS PARA EL FOCO (lo ponen los componentes, lo consume este archivo): botón del cuadro `data-nodo="<id>"`; × `data-quitar`;
// «+» de la derecha `data-mas="der-<id>"`, de la patita `data-mas="tool-<id>"` y «Poner un cuadro en medio» `data-mas="medio"`; círculo de
// la flecha `data-insignia="<id de la arista>"`; panel de Ajustes `id="ajustes"` con `tabIndex={-1}`; primera opción no bloqueada del menú
// y de «¿Qué hace que tu flujo arranque?» `data-foco="1"`; «Un solo sentido» del editor de la flecha `data-enl="1"`.
//
// El foco nunca cae a `<body>`: si lo que el reductor pidió todavía no existe se reintenta en el siguiente cuadro y, si tampoco, cae al
// primer cuadro, a Ajustes o al título de la pantalla (siempre hay uno enfocable).
//
// Avisos (D9): cada aviso nuevo del reductor se dice UNA vez en el cuadro de abajo a la derecha (`avisar`), con «Deshacer» cuando toca. Si
// la página no trae ese cuadro (las pruebas, la vitrina) se dice en una región `role="status"` de esta misma pantalla: un solo mecanismo
// activo a la vez, para que ningún lector de pantalla lo anuncie doble. Lo que dejó de ser cierto se retira: «Todavía no se puede
// descargar» cuando ya se puede, «No guardamos tu borrador» cuando ya se guarda.
//
// Teclado global: Ctrl/Cmd+Z deshace (menos cuando el foco está en un campo de texto: ahí deshace el texto) y Esc lo atienden las piezas
// (el lienzo, el menú y Ajustes mandan `cerrarTodo`, `cerrarMenu` y `volverDeAjustes`); con el foco perdido en <body> lo atiende un
// oyente del documento mientras haya un menú abierto o una conexión en curso. Una composición de teclado (IME) nunca cuenta como Esc.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { EncabezadoHoja } from '../../marca/EncabezadoHoja';
import type { Lugar } from '../../marca/menu';
import { avisar, quitarAviso, type OpcionesAvisoRapido } from '../../nucleo/avisos';
import { descargarArchivo } from '../../nucleo/descargarArchivo';
import { Boton } from '../../ui/Boton';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import './avisos.css';
import { AjustesEnlace } from './AjustesEnlace';
import { AjustesNodo } from './AjustesNodo';
import { Barra } from './Barra';
import { ElegirDisparador } from './ElegirDisparador';
import { AvisoConectando, AyudaTeclado, Guia, ID_AYUDA_TECLADO, Leyenda, ResumenDelFlujo } from './Guia';
import { Lienzo } from './Lienzo';
import { MenuMas } from './MenuMas';
import { construirFlujo, zonaLocal } from './modelo/exportar';
import { scrollParaVer } from './modelo/geometria';
import { puedeDeshacer, reducir } from './modelo/reductor';
import {
  guia,
  panelDeAjustes,
  resumenFlujo,
  textoConectar,
  textoSinSeleccion,
  vistaAjustes,
  vistaElegirDisparador,
  vistaEnlace,
  vistaFlechas,
  vistaLienzo,
  vistaMenu,
  vistaNodos,
} from './modelo/selectores';
import * as T from './modelo/textos';
import { slug } from './modelo/texto';
import type { AvisoConstructor, Foco, TipoAviso } from './modelo/tipos';
import { AjustesVacio, ID_AJUSTES } from './PanelAjustes';
import { ID_PANEL_JSON, PanelJson } from './PanelJson';
import { BOTON_44 } from './PiezasPanel';
import { leerArranque, TEXTO_PRIVACIDAD, useBorrador } from './useBorrador';

/** Dónde está el Constructor en el mapa (marca/menu.ts): de aquí salen sus migas «Automatizaciones › Distrito › Constructor». */
const LUGAR: Lugar = { area: 'automatizaciones', grupo: 'distrito', pantalla: 'constructor' };

/** Los avisos del reductor comparten clave: uno nuevo reemplaza al anterior (y el «Deshacer» viejo desaparece con él). */
const CLAVE_AVISO = 'constructor';
/** Lo del archivo (descargar) y del borrador tiene su propia clave: no pisa al aviso con «Deshacer». */
const CLAVE_ARCHIVO = 'constructor-archivo';
const CLAVE_AVISO_BORRADOR = 'constructor-borrador';

/** Cuánto se queda en la esquina un aviso que ofrece «Deshacer» (el de abajo a la derecha se va solo a los 5 s si no se dice). */
const SEGUNDOS_CON_DESHACER = 10;
/** Cuánto dura el candado de «Descargar .json»: dos clics seguidos bajan UN archivo. */
const CANDADO_DESCARGA_MS = 1000;

const TEXTO_NAVEGADOR_SIN_DESCARGA =
  'Tu navegador no nos dejó descargar el archivo. Dejamos el JSON abierto abajo: cópialo y guárdalo como un archivo .json.';

const BORDE_AVISO: Record<TipoAviso, string> = {
  ok: 'border-linea bg-superficie',
  info: 'border-linea bg-superficie',
  mal: 'border-error bg-superficie',
};

// ================================================================ el foco que pide el reductor

/** El elemento con ese valor en ese atributo (sin armar un selector con el id: así ningún carácter lo rompe). */
function porAtributo(atributo: string, valor: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(`[${atributo}]`)).find(el => el.getAttribute(atributo) === valor) ?? null;
}

/** El elemento al que apunta una petición de foco, con los atributos del contrato. Null si todavía no existe. */
function elementoDeFoco(objetivo: Foco, marco: HTMLElement | null): HTMLElement | null {
  const en = marco ?? document;
  switch (objetivo.k) {
    case 'nodo':
      return porAtributo('data-nodo', objetivo.id);
    case 'mas':
      return porAtributo('data-mas', objetivo.clave);
    case 'insignia':
      return porAtributo('data-insignia', objetivo.id);
    case 'ajustes':
      return document.getElementById(ID_AJUSTES);
    case 'primeraOpcionMenu':
      // con el menú y la tarjeta del disparador a la vez hay dos `data-foco="1"`: el del menú es el que está dentro del diálogo
      return en.querySelector<HTMLElement>('[role="dialog"] [data-foco="1"]');
    case 'primeraOpcionDisparador':
      return en.querySelector<HTMLElement>('[role="group"][aria-label="Disparador del flujo"] [data-foco="1"]');
    case 'opcionUnSentido':
      return document.querySelector<HTMLElement>('[data-enl="1"]');
    case 'primerNodo':
      return document.querySelector<HTMLElement>('[data-nodo]');
  }
}

/** Adonde cae el foco si lo pedido no existe: algo cercano y, al final, el título de la pantalla (siempre se puede enfocar). */
function respaldoDeFoco(objetivo: Foco, marco: HTMLElement | null, titulo: HTMLElement | null): HTMLElement | null {
  const dueno = objetivo.k === 'mas' ? /^(?:der|tool)-(.+)$/.exec(objetivo.clave)?.[1] : undefined;
  return (
    (dueno === undefined ? null : porAtributo('data-nodo', dueno)) ??
    // «Poner un cuadro en medio» ya no está (la conexión se quitó): la flecha que se estaba editando, si sigue elegida
    (objetivo.k === 'mas' && objetivo.clave === 'medio' ? document.querySelector<HTMLElement>('[data-insignia][aria-pressed="true"]') : null) ??
    (objetivo.k === 'primeraOpcionMenu' ? (marco ?? document).querySelector<HTMLElement>('[role="dialog"] button') : null) ??
    document.querySelector<HTMLElement>('[data-nodo]') ??
    document.getElementById(ID_AJUSTES) ??
    (marco ?? document).querySelector<HTMLElement>('[data-foco="1"]') ??
    (marco !== null && marco.tabIndex === 0 ? marco : null) ??
    titulo
  );
}

// ================================================================ avisos

/** Cómo se dice un aviso en el cuadro de abajo a la derecha: `info` sale como `ok` (trabajos.js le pone a `info` el ícono de «sin conexión» y lo deja fijo). */
function opcionesDeAviso(tipo: TipoAviso, clave: string, segundos?: number): OpcionesAvisoRapido {
  if (tipo === 'mal') return { tipo: 'mal', clave };
  return { tipo: 'ok', clave, ...(segundos === undefined ? {} : { segundos }) };
}

/** Un mensaje que no viene del reductor (descargar, no se pudo guardar el borrador) y que quedó en pantalla porque no hay cuadro de avisos. */
interface MensajeLocal {
  texto: string;
  tipo: TipoAviso;
  /** La clave con la que se dijo (la misma que en la esquina): así se sabe qué mensaje quitar cuando ya no es cierto. */
  clave: string;
  /** ¿Deja de ser cierto en cuanto el flujo se puede descargar? */
  alPoderDescargar: boolean;
  /** El contador de eventos del reductor cuando se dijo: un aviso del reductor con `id` mayor es más nuevo. */
  desde: number;
}

function AvisoEnPantalla({ texto, tipo, alDeshacer }: { texto: string; tipo: TipoAviso; alDeshacer?: () => void }) {
  return (
    <div
      role="status"
      className={unir('flex flex-wrap items-center justify-between gap-3 rounded-boton border px-4 py-3 text-sm', BORDE_AVISO[tipo])}
    >
      <span className="min-w-0 [overflow-wrap:anywhere]">{texto}</span>
      {alDeshacer && (
        <Boton denso className={BOTON_44} onClick={alDeshacer}>
          Deshacer
        </Boton>
      )}
    </div>
  );
}

/** Lleva el foco a «Copiar el JSON», el primer botón de la caja del JSON (que `focus()` trae a la vista). */
function enfocarCopiarJson(): void {
  document.getElementById(ID_PANEL_JSON)?.querySelector<HTMLElement>('button')?.focus();
}

/** ¿El foco está donde Ctrl+Z es del navegador (deshacer lo escrito) o de un diálogo que tapa el lienzo? */
function atajoEsDelNavegador(objetivo: EventTarget | null): boolean {
  return objetivo instanceof Element && objetivo.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="alertdialog"]') !== null;
}

// ================================================================ la pantalla

export function Constructor() {
  // el borrador se lee UNA vez, antes de guardar nada (guardar un lienzo vacío lo borraría)
  const [arranque] = useState(leerArranque);
  const [estado, despachar] = useReducer(reducir, arranque.estado);
  const [jsonAbierto, setJsonAbierto] = useState(false);
  const [local, setLocal] = useState<MensajeLocal | null>(null);

  const marco = useRef<HTMLDivElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const ajustes = useRef<HTMLDivElement>(null);
  const candadoDescarga = useRef(false);
  const relojDescarga = useRef<ReturnType<typeof setTimeout> | null>(null);
  // «Todavía no se puede descargar» está a la vista (en la esquina): se retira solo cuando ya se puede
  const noSePuedeDescargarDicho = useRef(false);
  // se mostró el JSON porque el navegador no dejó descargar: el foco va a «Copiar el JSON» en cuanto la caja exista
  const enfocarJson = useRef(false);
  // el último aviso del reductor que se dijo en la esquina, y si ofrecía «Deshacer»
  const dicho = useRef({ id: 0, conDeshacer: false });

  const { flujo } = estado;
  const resumen = useMemo(() => resumenFlujo({ flujo }), [flujo]);
  const json = useMemo(() => (jsonAbierto ? construirFlujo(flujo, { zona: zonaLocal() }).json || null : null), [jsonAbierto, flujo]);
  const hayCuadroDeAvisos = typeof window !== 'undefined' && window.avisos !== undefined;

  /**
   * Dice algo que no viene del reductor: en la esquina si la hay y, si no, en la pantalla. `alPoderDescargar`: lo que se dice deja de ser
   * cierto en cuanto el flujo se puede descargar («Todavía no se puede descargar…»): en la pantalla se esconde solo.
   */
  const decir = useCallback(
    (a: T.TextoAviso, clave: string, segundos?: number, alPoderDescargar = false) => {
      if (avisar(a.texto, opcionesDeAviso(a.tipo, clave, segundos))) return;
      setLocal({ texto: a.texto, tipo: a.tipo, clave, alPoderDescargar, desde: estado.eventos });
    },
    [estado.eventos],
  );

  useBorrador(flujo, {
    guardarAlEntrar: arranque.guardarAlEntrar,
    crudoInicial: arranque.crudo,
    alNoGuardar: (_motivo, texto) => decir({ texto, tipo: 'mal' }, CLAVE_AVISO_BORRADOR),
    // ya se guarda: el rojo que pedía «Quítala» (o «Descarga el .json») dejó de ser cierto
    alGuardarBien: () => {
      quitarAviso(CLAVE_AVISO_BORRADOR);
      setLocal(l => (l?.clave === CLAVE_AVISO_BORRADOR ? null : l));
    },
    alConflicto: texto => decir({ texto, tipo: 'mal' }, CLAVE_AVISO_BORRADOR),
  });

  // al irse la pantalla: ningún candado queda corriendo
  useEffect(
    () => () => {
      if (relojDescarga.current) clearTimeout(relojDescarga.current);
    },
    [],
  );

  // ---------------------------------------------------------------- efectos que pide el reductor

  // «hazme visible este cuadro» y foco: primero se trae el cuadro a la vista (scrollLeft, sin animación) y luego se enfoca
  useEffect(() => {
    const { foco, ver } = estado;
    if (!foco && !ver) return;
    const hasta = Math.max(foco?.n ?? 0, ver?.n ?? 0);
    if (ver) {
      const nodo = estado.flujo.nodes.find(n => n.id === ver.id);
      const m = marco.current;
      if (nodo && m) {
        const izq = scrollParaVer(m, nodo);
        if (izq !== m.scrollLeft) m.scrollLeft = izq;
      }
    }
    if (!foco) {
      // sin foco que pedir (mover un cuadro con el teclado): el cuadro enfocado no se queda recortado fuera del marco ni de la ventana
      if (ver) porAtributo('data-nodo', ver.id)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      despachar({ k: 'limpiarPeticiones', hasta });
      return;
    }
    const enfocar = (ultimoIntento: boolean): boolean => {
      const el = elementoDeFoco(foco.objetivo, marco.current) ?? (ultimoIntento ? respaldoDeFoco(foco.objetivo, marco.current, titulo.current) : null);
      el?.focus();
      return el !== null;
    };
    if (enfocar(false)) {
      despachar({ k: 'limpiarPeticiones', hasta });
      return;
    }
    // todavía no está pintado: se reintenta en el siguiente cuadro y, si tampoco, cae al respaldo
    const cuadro = requestAnimationFrame(() => {
      enfocar(true);
      despachar({ k: 'limpiarPeticiones', hasta });
    });
    return () => cancelAnimationFrame(cuadro);
  }, [estado, despachar]);

  // al elegir un cuadro o una flecha, Ajustes se trae a la vista: en una pantalla angosta queda debajo del lienzo y se baja hasta él; en una
  // ancha va junto al lienzo, pero con la página desplazada su encabezado puede haber quedado arriba, fuera de la ventana, y se sube hasta él
  useEffect(() => {
    if (estado.scrollAjustes === 0) return;
    const panel = ajustes.current;
    const lienzo = marco.current;
    if (!panel || !lienzo) return;
    const { top } = panel.getBoundingClientRect();
    if (top < lienzo.getBoundingClientRect().bottom) {
      if (top < 0) panel.scrollIntoView?.({ block: 'start' });
      return;
    }
    panel.scrollIntoView?.({ block: 'nearest' });
  }, [estado.scrollAjustes]);

  // cada aviso nuevo del reductor se dice UNA vez; si dejó de ofrecer «Deshacer» (se editó algo después), su botón de la esquina se quita
  useEffect(() => {
    const a: AvisoConstructor | null = estado.aviso;
    if (!a) return;
    if (a.id === dicho.current.id) {
      if (dicho.current.conDeshacer && !a.conDeshacer) {
        dicho.current.conDeshacer = false;
        quitarAviso(CLAVE_AVISO);
      }
      return;
    }
    dicho.current = { id: a.id, conDeshacer: a.conDeshacer };
    if (typeof window.avisos === 'undefined') return;
    const accion = a.conDeshacer ? { texto: 'Deshacer', al: () => despachar({ k: 'deshacer', avisoId: a.id }) } : undefined;
    avisar(a.texto, {
      ...opcionesDeAviso(a.tipo, CLAVE_AVISO, accion ? SEGUNDOS_CON_DESHACER : undefined),
      ...(accion ? { accion } : {}),
    });
  }, [estado.aviso, despachar]);

  // «Todavía no se puede descargar» ya no es cierto cuando el flujo se puede descargar: se retira de la esquina (un aviso rojo no se cierra
  // solo y llegar a su «Cerrar» con el teclado cuesta decenas de Tab)
  useEffect(() => {
    if (!resumen.puedeDescargar || !noSePuedeDescargarDicho.current) return;
    noSePuedeDescargarDicho.current = false;
    quitarAviso(CLAVE_ARCHIVO);
  }, [resumen.puedeDescargar]);

  // «Dejamos el JSON abierto abajo»: el foco va a «Copiar el JSON» en cuanto la caja existe, para que quien no usa ratón llegue sin recorrer todo
  useEffect(() => {
    if (!jsonAbierto || !enfocarJson.current) return;
    enfocarJson.current = false;
    enfocarCopiarJson();
  }, [jsonAbierto]);

  // Esc con un menú abierto o una conexión en curso, aunque el foco esté perdido en <body> (si estaba en un control del lienzo, en el menú o en
  // Ajustes, ellos ya lo atendieron: `defaultPrevented`, o el menú detuvo el evento y ni llega). Un diálogo modal (la pregunta de «Limpiar»)
  // es dueño de su Esc, y una composición de teclado (IME) no es un Esc.
  const hayAlgoAbierto = estado.menu !== null || estado.conectando !== null;
  useEffect(() => {
    if (!hayAlgoAbierto) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      if (document.querySelector('[role="alertdialog"]')) return;
      despachar({ k: 'cerrarTodo' });
    };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [hayAlgoAbierto, despachar]);

  // Ctrl/Cmd+Z deshace, salvo en un campo de texto (ahí deshace lo escrito)
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.shiftKey || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      if (atajoEsDelNavegador(e.target)) return;
      e.preventDefault();
      despachar({ k: 'deshacer' });
    };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [despachar]);

  // ---------------------------------------------------------------- descargar

  function descargar() {
    // un solo clic = un solo archivo: el candado se pone ANTES de bajar nada
    if (candadoDescarga.current) return;
    if (!resumen.puedeDescargar) {
      noSePuedeDescargarDicho.current = true;
      decir(T.descargaNoPosible(resumen.primerError ?? ''), CLAVE_ARCHIVO, undefined, true);
      return;
    }
    const hecho = construirFlujo(flujo, { zona: zonaLocal() });
    if (!hecho.flujo) {
      noSePuedeDescargarDicho.current = true;
      decir(T.descargaNoPosible(hecho.errores[0] ?? ''), CLAVE_ARCHIVO, undefined, true);
      return;
    }
    candadoDescarga.current = true;
    relojDescarga.current = setTimeout(() => {
      candadoDescarga.current = false;
    }, CANDADO_DESCARGA_MS);
    const nombre = `${slug(flujo.nombreFlujo) || 'flujo'}.json`;
    if (descargarArchivo(nombre, hecho.json)) {
      // lo que sigue (importarlo en n8n) se necesita después: el aviso se queda hasta cerrarlo
      decir(T.descargado(nombre), CLAVE_ARCHIVO, 0);
    } else {
      if (jsonAbierto) enfocarCopiarJson();
      else {
        enfocarJson.current = true;
        setJsonAbierto(true);
      }
      decir({ texto: TEXTO_NAVEGADOR_SIN_DESCARGA, tipo: 'mal' }, CLAVE_ARCHIVO);
    }
  }

  // ---------------------------------------------------------------- lo que se pinta

  const cual = panelDeAjustes(estado);
  const detalle = cual === 'cuadro' ? vistaAjustes(estado) : null;
  const enlace = cual === 'enlace' ? vistaEnlace(estado) : null;
  const menu = vistaMenu(estado);
  const { ancho, alto } = vistaLienzo(estado);
  const aviso = estado.aviso;
  // en pantalla solo si no hay cuadro de avisos: el del reductor o el local, el que sea más nuevo
  const localVigente = local !== null && local.alPoderDescargar && resumen.puedeDescargar ? null : local;
  const delReductor = aviso !== null && (localVigente === null || aviso.id > localVigente.desde);
  const enPantalla = hayCuadroDeAvisos ? null : delReductor ? aviso : localVigente;

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pt-16 pb-14 sm:px-6">
      <EncabezadoHoja lugar={LUGAR} />

      <main className="mt-8">
        <header className="mb-6">
          <h2 ref={titulo} tabIndex={-1} className="m-0 mb-2 font-titulo text-titulo-md font-bold [overflow-wrap:anywhere]">
            Arma tu automatización
          </h2>
          <p className="m-0 max-w-[65ch] text-sm text-secundario sm:text-md">
            Elige cómo arranca tu flujo, toca el + para ir agregando lo que sigue y descarga el archivo .json para abrirlo en n8n.
          </p>
        </header>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4">
            <Guia texto={guia(estado)} />
            <Barra
              nombreFlujo={flujo.nombreFlujo}
              resumen={resumen}
              puedeDeshacer={puedeDeshacer(estado)}
              hayCuadros={flujo.nodes.length > 0}
              jsonAbierto={jsonAbierto}
              despachar={despachar}
              alDescargar={descargar}
              alAlternarJson={() => setJsonAbierto(v => !v)}
            />
            <AvisoConectando texto={textoConectar(estado)} despachar={despachar} />
            {enPantalla && (
              <AvisoEnPantalla
                texto={enPantalla.texto}
                tipo={enPantalla.tipo}
                {...('conDeshacer' in enPantalla && enPantalla.conDeshacer
                  ? { alDeshacer: () => despachar({ k: 'deshacer', avisoId: enPantalla.id }) }
                  : {})}
              />
            )}

            <Lienzo
              nodos={vistaNodos(estado)}
              flechas={vistaFlechas(estado)}
              ancho={ancho}
              alto={alto}
              modoConexion={estado.conectando !== null}
              alMoverNodo={(id, x, y) => despachar({ k: 'moverNodo', id, x, y })}
              alMoverConTeclado={(id, direccion, grande) => despachar({ k: 'moverConTeclado', id, direccion, grande })}
              alAbrirNodo={(id, teclado) => despachar({ k: 'abrirNodo', id, teclado })}
              alQuitarNodo={id => despachar({ k: 'quitarNodo', id })}
              alAbrirMas={(ancla, tipo) => despachar({ k: 'abrirMenu', ancla, tipo })}
              alAbrirFlecha={id => despachar({ k: 'abrirEnlace', id })}
              alEscape={() => despachar({ k: 'cerrarTodo' })}
              alClicFondo={() => {
                if (estado.menu) despachar({ k: 'cerrarMenu' });
                else if (estado.conectando) despachar({ k: 'cancelarConexion' });
              }}
              marcoRef={marco}
              ayudaId={ID_AYUDA_TECLADO}
            >
              <ElegirDisparador vista={vistaElegirDisparador(estado)} despachar={despachar} />
              {menu && <MenuMas vista={menu} despachar={despachar} />}
            </Lienzo>

            <Leyenda />
            <AyudaTeclado />
            <ResumenDelFlujo resumen={resumen} />

            <div className="flex flex-col gap-2 text-xs text-secundario">
              <p className="m-0 flex items-start gap-2">
                <Icono nombre="candado" className="mt-px size-[18px]! shrink-0" />
                {TEXTO_PRIVACIDAD}
              </p>
              <p className="m-0">Para abrirlo en n8n: en el menú «⋯» de arriba a la derecha, elige «Import from File».</p>
            </div>

            {jsonAbierto && <PanelJson json={json} textoSinJson={resumen.textoSinJson} />}
          </div>

          <div ref={ajustes} className="min-w-0">
            {detalle ? (
              <AjustesNodo vista={detalle} despachar={despachar} />
            ) : enlace ? (
              <AjustesEnlace vista={enlace} despachar={despachar} />
            ) : (
              <AjustesVacio texto={textoSinSeleccion(estado)} despachar={despachar} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
