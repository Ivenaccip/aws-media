// Un cuadro del lienzo con todo lo que cuelga de él: el botón del cuadro (arrastrable), la × que lo quita, el «+»
// de la derecha (el suelto o el redondo pegado al cuadro) y la patita de los agentes con su «+» y su rótulo
// «Herramientas». Todo lo que se lee sale de VistaNodo (selectores.ts: `vistaNodos`); aquí no hay reglas del flujo.
//
// El DOM de cada cuadro, en este orden (es el de Tab): cuadro → × → «+» de la derecha → «+» de la patita.
//
//   <div class="cn-caja-nodo">                 la caja de 216 × 96 en su lugar (left/top; sin transición)
//     <button data-nodo>                       el cuadro: arrastrar, abrir con clic o Enter, flechas, Supr
//     <button data-quitar>                     la ×, arriba a la derecha
//     <button data-mas="der-<id>">             «Agregar lo que sigue» (con su tramo, o redondo si ya hay algo)
//     <button data-mas="tool-<id>">            «Darle una herramienta» (solo agentes), con el rótulo «Herramientas»
//
// Los atributos `data-*` son el CONTRATO con Constructor.tsx, que cumple el foco con ellos. Nada de aquí cambia
// el estado: cada gesto sale como evento (props `al…`) y quien ensambla lo manda al reductor.
//
// Nombres accesibles: el del cuadro (`aria-label`) trae las tres líneas que se ven, en el mismo orden (WCAG 2.5.3); su relación con un agente
// («App · herramienta de «Agente 1»») va aparte, como descripción. Ningún botón repite su nombre en un `title`: algunos lectores dicen nombre y
// descripción y se oiría dos veces lo mismo.
//
// Teclado en el cuadro: flechas mueven 8 px (24 con Mayús), Supr o Retroceso lo quita (una sola vez por pulsación:
// mantenerla no se come los demás cuadros), Enter y Espacio lo abren (el `click` con `detail === 0`). Esc lo
// atiende Lienzo.tsx (cubre también la ×, los «+» y las insignias), no este archivo.

import type { KeyboardEvent, MouseEvent } from 'react';

import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import { ALTO_CUADRO, ANCHO_CUADRO } from './modelo/datos/constantes';
import type { ModoConexion, VarianteNodo, VistaNodo } from './modelo/selectores';
import type { DireccionTecla, TipoArista } from './modelo/tipos';
import type { ArrastreCuadro } from './useArrastre';

/** La clase de cada variante (cadenas completas, nunca compuestas con una plantilla). */
const CLASE_VARIANTE: Record<VarianteNodo, string> = {
  disparador: 'cn-nodo-trig',
  agente: 'cn-nodo-ag',
  app: 'cn-nodo-app',
};

/**
 * La clase de cada papel en el modo «toca el cuadro destino». El ancla no suma nada aquí: ya viene con el realce de
 * elegido (`vista.resaltado`), y repetir la clase no cambiaría nada.
 */
const CLASE_MODO: Record<ModoConexion, string> = {
  ancla: '',
  destino: 'cn-nodo-destino',
  nulo: 'cn-nodo-nulo',
};

/** Qué flecha del teclado es qué dirección. */
const TECLA_A_DIRECCION: Readonly<Record<string, DireccionTecla>> = {
  ArrowLeft: 'izquierda',
  ArrowRight: 'derecha',
  ArrowUp: 'arriba',
  ArrowDown: 'abajo',
};

export interface PropsNodo {
  vista: VistaNodo;
  /** Los manejadores del arrastre (los comparte todo el lienzo: es un solo gesto a la vez). */
  arrastre: ArrastreCuadro;
  /** Tocó el cuadro. `conTeclado` = fue Enter o Espacio (el foco debe pasar al panel de Ajustes). */
  alAbrir: (id: string, conTeclado: boolean) => void;
  alQuitar: (id: string) => void;
  /** Tocó un «+»: el de la derecha (`seq`) o el de la patita (`tool`). */
  alAbrirMas: (ancla: string, tipo: TipoArista) => void;
  alMoverConTeclado: (id: string, direccion: DireccionTecla, grande: boolean) => void;
}

/** El «+» de 44 × 44 con su dibujo de 28 px. `redondo`: el que va pegado al cuadro cuando ya le sigue algo. */
function BotonMas({
  clave,
  posicion,
  etiqueta,
  abierto,
  redondo = false,
  alPulsar,
}: {
  /** `der-<id>` o `tool-<id>` (el contrato del foco). */
  clave: string;
  posicion: 'cn-mas-stub' | 'cn-mas-asa' | 'cn-mas-tool';
  etiqueta: string;
  /** ¿Está abierto el menú que este «+» abrió? */
  abierto: boolean;
  redondo?: boolean;
  alPulsar: () => void;
}) {
  return (
    <button
      type="button"
      className={unir('cn-b44', posicion, abierto && 'cn-act')}
      data-mas={clave}
      aria-haspopup="dialog"
      aria-expanded={abierto}
      aria-label={etiqueta}
      onClick={alPulsar}
    >
      <span className={unir('cn-dibujo cn-d28', redondo && 'cn-redondo')}>
        <Icono nombre="mas" className="size-4!" />
      </span>
    </button>
  );
}

export function Nodo({ vista: v, arrastre, alAbrir, alQuitar, alAbrirMas, alMoverConTeclado }: PropsNodo) {
  const nulo = v.modoConexion === 'nulo';
  // el motivo por el que un cuadro no es destino se LEE: aria-disabled (no `disabled`, para que siga enfocable y su clic avise) + describedby
  const idMotivo = `cn-motivo-${v.id}`;
  // de quién cuelga (una herramienta o una IA que conversa): la descripción del cuadro, no su nombre
  const idRol = `cn-rol-${v.id}`;
  const descritoPor = [v.rol !== null ? idRol : null, nulo && v.motivoNulo ? idMotivo : null].filter(Boolean).join(' ');

  const alClic = (e: MouseEvent<HTMLButtonElement>) => {
    if (arrastre.clicSuprimido()) return; // el clic que cierra un arrastre no abre nada
    alAbrir(v.id, e.detail === 0); // detail 0 = Enter, Espacio o un lector de pantalla: el foco va a Ajustes
  };

  const alTeclear = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // Ctrl/Cmd+Z y compañía son del lienzo, no del cuadro
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (!e.repeat) alQuitar(v.id);
      return;
    }
    const direccion = TECLA_A_DIRECCION[e.key];
    if (!direccion) return;
    e.preventDefault(); // que la flecha no desplace el marco del lienzo
    alMoverConTeclado(v.id, direccion, e.shiftKey);
  };

  return (
    <div className="cn-caja-nodo" style={{ left: v.x, top: v.y, width: ANCHO_CUADRO, height: ALTO_CUADRO }}>
      <button
        type="button"
        className={unir('cn-nodo', CLASE_VARIANTE[v.variante], v.esHerramienta && 'cn-nodo-tool', v.resaltado && 'cn-nodo-sel', v.modoConexion && CLASE_MODO[v.modoConexion])}
        data-nodo={v.id}
        aria-pressed={v.seleccionado}
        aria-label={v.etiqueta}
        aria-keyshortcuts="Delete Backspace ArrowUp ArrowDown ArrowLeft ArrowRight"
        {...(nulo ? { 'aria-disabled': true } : {})}
        {...(descritoPor ? { 'aria-describedby': descritoPor } : {})}
        onPointerDown={e => arrastre.presionar(e, { id: v.id, x: v.x, y: v.y })}
        onPointerMove={arrastre.mover}
        onPointerUp={arrastre.soltar}
        onPointerCancel={arrastre.soltar}
        onLostPointerCapture={arrastre.soltar}
        onClick={alClic}
        onKeyDown={alTeclear}
      >
        <span className="cn-nodo-ico">
          <Icono nombre={v.icono} className="size-5!" />
        </span>
        {/* los espacios entre las tres líneas no se pintan (un contenedor flex ignora el texto en blanco) pero sí cuentan para quien lee el texto
            del botón sin mirar el CSS: axe (label-content-name-mismatch) lo juntaba todo —«Agente de IAAtención a clientesOpenAI (GPT)»— y marcaba
            que el nombre accesible no lo contenía */}
        <span className="cn-nodo-txt">
          <span className="cn-nodo-tipo">{v.tipoCorto}</span>{' '}
          <span className="cn-nodo-nom">{v.titulo}</span>{' '}
          <span className="cn-nodo-det">{v.detalle}</span>
        </span>
      </button>
      {v.rol !== null ? (
        <span id={idRol} className="sr-only">
          {v.rol}
        </span>
      ) : null}
      {nulo && v.motivoNulo ? (
        <span id={idMotivo} className="sr-only">
          {v.motivoNulo}
        </span>
      ) : null}

      <button
        type="button"
        className="cn-b44 cn-quitar"
        data-quitar={v.id}
        aria-label={v.etiquetaQuitar}
        onClick={() => alQuitar(v.id)}
      >
        <span className="cn-dibujo cn-d24 cn-redondo">
          <Icono nombre="cerrar" className="size-3!" />
        </span>
      </button>

      {v.stubDer ? (
        <>
          <span className="cn-rama cn-rama-der" aria-hidden="true" />
          <BotonMas clave={`der-${v.id}`} posicion="cn-mas-stub" etiqueta={v.etiquetaMasDer} abierto={v.abiertoDer} alPulsar={() => alAbrirMas(v.id, 'seq')} />
        </>
      ) : null}
      {v.asaDer ? (
        <BotonMas clave={`der-${v.id}`} posicion="cn-mas-asa" etiqueta={v.etiquetaMasDer} abierto={v.abiertoDer} redondo alPulsar={() => alAbrirMas(v.id, 'seq')} />
      ) : null}
      {v.patita ? (
        <>
          <span className="cn-rama cn-rama-tool" aria-hidden="true" />
          <BotonMas clave={`tool-${v.id}`} posicion="cn-mas-tool" etiqueta={v.etiquetaMasTool} abierto={v.abiertoTool} alPulsar={() => alAbrirMas(v.id, 'tool')} />
          <span className="cn-pata-txt" aria-hidden="true">
            Herramientas
          </span>
        </>
      ) : null}
    </div>
  );
}
