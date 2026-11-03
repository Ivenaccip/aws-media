// El menú flotante del «+» (el de la derecha de un cuadro, el de la patita de un agente y «Poner un cuadro en medio» del editor
// de la flecha). Dos pasos: el inicio («Una aplicación» · «Un agente de IA» · «Uno que ya está en el lienzo») y el de las apps
// (pastillas de las diez con conector listo + «¿Otra app?»). La patita abre directo en el paso de las apps (solo van apps).
//
// Va DENTRO del lienzo (su contenedor es `relative`) y se coloca solo en `vista.x` / `vista.y`, que calcula `vistaMenu`. Es NO
// MODAL: nada atrapa el foco, Tab sale a donde sigue (el mockup lo hace así a propósito) y Esc lo cierra. Recibe el objeto de
// `vistaMenu` y `despachar`; lo único que guarda es el texto de «¿Otra app?», que nace vacío cada vez que se llega a ese paso.
//
// Foco (contrato con Constructor.tsx): la primera opción NO bloqueada del paso de inicio y la primera pastilla del paso de apps
// llevan `data-foco="1"`. Al cerrar, el reductor pide devolver el foco al «+» que lo abrió (`cerrarMenu`).
//
// Una opción bloqueada por un tope (8 apps, 4 agentes) NO se apaga con `disabled`: lleva `aria-disabled`, el motivo escrito dentro
// del botón (así se lee) y, al pulsarla, el clic llega al reductor, que lo dice también en el aviso.
import { useEffect, useRef, useState } from 'react';

import { Boton } from '../../ui/Boton';
import { Campo } from '../../ui/Campo';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import { LARGO_NOMBRE_APP } from './modelo/datos/constantes';
import type { OpcionMenu, VistaMenu } from './modelo/selectores';
import type { AccionConstructor } from './modelo/tipos';
import { BOTON_44, esComposicion, Opcion, Pastilla } from './PiezasPanel';

type Despachar = (accion: AccionConstructor) => void;

export interface PropsMenuMas {
  vista: VistaMenu;
  despachar: Despachar;
  /** Clases extra del contenedor. */
  className?: string;
}

export function MenuMas({ vista, despachar, className }: PropsMenuMas) {
  const caja = useRef<HTMLDivElement>(null);
  // El menú sale pegado a su «+», que puede estar en el borde del marco con scroll del lienzo: al abrirse (y al crecer, de inicio a apps)
  // se trae completo a la vista, en el marco y en la página. Sin `behavior`: instantáneo (nada de scroll animado: «reducir movimiento»).
  // `?.` porque jsdom no trae `scrollIntoView`.
  useEffect(() => {
    caja.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [vista.x, vista.y, vista.paso]);
  return (
    // el teclado de un contenedor va en un envoltorio sin rol (jsx-a11y no deja un onKeyDown en el propio dialog): los eventos de
    // los botones y del campo suben hasta aquí
    <div
      ref={caja}
      role="presentation"
      // 300 px, pero nunca más que lo que cabe en la ventana: a 320 px el marco del lienzo mide 288 y un menú de 300 se quedaba sin borde por un
      // lado u otro (`max-w-full` se medía contra el lienzo entero, que mide más de mil, y nunca recortaba)
      className={unir('absolute z-6 w-75 max-w-[calc(100vw-48px)]', className)}
      style={{ left: vista.x, top: vista.y }}
      onKeyDown={e => {
        if (e.key !== 'Escape' || esComposicion(e)) return;
        e.preventDefault();
        e.stopPropagation();
        despachar({ k: 'cerrarMenu' });
      }}
    >
      <div role="dialog" aria-label={vista.titulo} className="flex flex-col gap-3 rounded-grande border border-campo bg-superficie p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="m-0 text-sm font-semibold [overflow-wrap:anywhere]">{vista.titulo}</h3>
          <Boton aria-label="Cerrar el menú" denso className="size-11 shrink-0 px-0!" onClick={() => despachar({ k: 'cerrarMenu' })}>
            <Icono nombre="cerrar" className="size-5!" />
          </Boton>
        </div>
        {vista.hayNota && <p className="m-0 text-xs text-secundario [overflow-wrap:anywhere]">{vista.nota}</p>}
        {vista.esInicio && <PasoInicio vista={vista} despachar={despachar} />}
        {/* la `key` hace que el texto de «¿Otra app?» no pase de un menú a otro si el «+» cambia con el menú abierto */}
        {vista.esApp && <PasoApps key={`${vista.ancla}|${vista.tipo}|${vista.insertarEn ?? ''}`} vista={vista} despachar={despachar} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- paso 1: qué poner

function PasoInicio({ vista, despachar }: { vista: VistaMenu; despachar: Despachar }) {
  function elegir(o: OpcionMenu) {
    if (o.id === 'existente') {
      despachar({ k: 'iniciarConexion', ancla: vista.ancla, rol: 'origen', tipo: vista.tipo });
    } else if (o.id === 'app') {
      // bloqueada: se pide crear una app y es el reductor quien responde con el tope (sin avisar nada desde aquí)
      despachar(o.bloqueada ? { k: 'crearDesdeMenu', que: 'app' } : { k: 'pasoMenu', paso: 'app' });
    } else {
      despachar({ k: 'crearDesdeMenu', que: 'agente' });
    }
  }
  return (
    <div className="flex flex-col gap-2">
      {vista.opciones.map(o => (
        <Opcion
          key={o.id}
          titulo={o.titulo}
          detalle={o.detalle}
          nota={o.motivo}
          icono={o.icono}
          bloqueada={o.bloqueada}
          data-foco={o.primera ? '1' : undefined}
          onClick={() => elegir(o)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- paso 2: qué app

function PasoApps({ vista, despachar }: { vista: VistaMenu; despachar: Despachar }) {
  const [otra, setOtra] = useState('');
  const agregarOtra = () => despachar({ k: 'crearDesdeMenu', que: 'app', nombreApp: otra });
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Apps con conector listo" className="flex flex-wrap gap-2">
        {vista.apps.map(a => (
          <Pastilla
            key={a.nombre}
            texto={a.nombre}
            data-foco={a.primera ? '1' : undefined}
            onClick={() => despachar({ k: 'crearDesdeMenu', que: 'app', nombreApp: a.nombre })}
          />
        ))}
      </div>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Campo
            etiqueta="¿Otra app? Escribe su nombre"
            type="text"
            maxLength={LARGO_NOMBRE_APP}
            placeholder="Por ejemplo: HubSpot"
            value={otra}
            onChange={e => setOtra(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Enter' || esComposicion(e)) return;
              e.preventDefault();
              agregarOtra();
            }}
          />
        </div>
        <Boton denso className={BOTON_44} onClick={agregarOtra}>
          Agregar
        </Boton>
      </div>
      {vista.hayExistente && (
        <Boton className="self-start" onClick={() => despachar({ k: 'iniciarConexion', ancla: vista.ancla, rol: 'origen', tipo: vista.tipo })}>
          Una app que ya está en el lienzo
        </Boton>
      )}
      {vista.hayAtras && (
        <Boton className="self-start" onClick={() => despachar({ k: 'pasoMenu', paso: 'inicio' })}>
          Atrás
        </Boton>
      )}
    </div>
  );
}
