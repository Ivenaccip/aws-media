// La lista de un grupo cuyas herramientas dependen de Blotato (Marketing › Blotato y › Avanzado): sabe si está conectado y ofrece el
// diálogo para conectarlo. Las reglas son las de siempre (M23 · C):
//   · `conectado === null` (no se sabe: la consulta falló o aún no contesta) NO apaga nada: dejar sin sus herramientas a quien sí pagó,
//     porque un fetch no respondió, es peor que dejar entrar a quien no;
//   · `?blotato=conectar` (el editor de cortes y las pantallas de Blotato mandan aquí cuando falta la conexión) abre el diálogo de
//     una vez. Esa entrada NO se limpia de la dirección (recargar vuelve a ofrecer conectar), como en la caja: `urlSinEntrada`
//     (../llegada.ts) solo limpia desde/ver/prompt/brief.
//
// Qué pesa y cuándo se pide (el mapa, las áreas y los demás grupos no cargan nada de esto):
//   · ESTE archivo es chico y viaja con la página: la lista (`Pantallas`) se pinta ya, con su botón y su foco, y es SIEMPRE la misma —
//     no una de espera que React cambie por la de verdad cuando llega el código (eso desmontaba los nodos: el foco de quien ya estaba
//     tabulando caía a <body> y el botón «Conecta tu cuenta» de la espera no hacía nada);
//   · la lectura del estado (`logica`: api, tarifas, modelos…) va con import() y se pide al montar;
//   · el diálogo (Blotato.tsx: Radix, Confirmar, Guardado…) va con import() y solo se pide la primera vez que se abre. Avanzado, que no
//     ofrece el botón, no lo trae hasta que alguien pulsa una herramienta apagada.
//   · el foco: lo que lo tenía se anota al PEDIR abrir (`abrir`), no cuando el diálogo se monta. Si la lectura llega antes que el código,
//     el diálogo se monta ya con el campo de la clave enfocado (su autoFocus) y ya no hay botón que recordar: al cerrar el foco caía a <body>.
//     Lo que se pulsó llega de `Pantallas` (`desde`): un navegador que no enfoca lo que se pulsa con el ratón (Safari, con un botón) no lo
//     deja en `document.activeElement`.
// Si el diálogo no llega, `LimiteDeCarga` lo dice donde se pulsó; la lista sigue ahí.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';

import type { GrupoMenu, PantallaMenu } from '../../../marca/menu';
import { Aviso } from '../../../ui/Aviso';
import type { EstadoBlotato } from '../logica';
import { Pantallas } from '../Pantallas';
import { LimiteDeCarga } from './LimiteDeCarga';

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Lee el estado de Blotato; `ligero` = sin las cuentas de redes (solo saber si hay clave). La lógica se pide en el momento, no antes. */
const leer = (ligero: boolean): Promise<EstadoBlotato> => import('../logica').then(l => l.leerBlotato(ligero));

const DialogoBlotato = lazy(() => import('../Blotato').then(m => ({ default: m.DialogoBlotato })));

export interface PropsGrupoConBlotato {
  grupo: GrupoMenu;
  /** La dirección de las herramientas que no traen `href` (las de la Caja), como en `Pantallas`. */
  hrefDe?: (p: PantallaMenu) => string | undefined;
}

export function GrupoConBlotato({ grupo, hrefDe }: PropsGrupoConBlotato) {
  // null = no se sabe: las pantallas de Blotato se quedan encendidas
  const [conectado, setConectado] = useState<boolean | null>(null);
  const [abierto, setAbierto] = useState(false);
  // el diálogo se pide la primera vez que se abre y desde entonces se queda montado (cerrarlo anima su salida)
  const [pedido, setPedido] = useState(false);
  const [estado, setEstado] = useState<EstadoBlotato | null>(null);
  const [error, setError] = useState('');
  // lo que se pulsó para abrir (el botón de conectar, una tarjeta apagada) o, sin eso, lo que tenía el foco: a donde vuelve al cerrar.
  // null = nada (abierto por la dirección)
  const origenDelFoco = useRef<HTMLElement | null>(null);

  const abrir = useCallback((desde?: HTMLElement) => {
    const activo = desde ?? document.activeElement;
    origenDelFoco.current = activo instanceof HTMLElement && activo !== document.body ? activo : null;
    setEstado(null);
    setError('');
    setAbierto(true);
    setPedido(true);
    leer(false).then(
      d => {
        setEstado(d);
        setConectado(d.conectado);
      },
      (e: unknown) => setError(mensaje(e)),
    );
  }, []);

  useEffect(() => {
    // abrir() y el setConectado de la lectura ponen estado: van en un callback, no en el cuerpo del efecto
    if (new URLSearchParams(location.search).get('blotato') === 'conectar') {
      Promise.resolve().then(() => abrir());
    } else {
      leer(true).then(
        d => setConectado(d.conectado),
        () => undefined,
      );
    }
  }, [abrir]);

  return (
    <>
      <Pantallas grupo={grupo} conectado={conectado} alConectar={abrir} {...(hrefDe ? { hrefDe } : {})} />
      {pedido && (
        <LimiteDeCarga
          alFallar={
            <div className="mt-4">
              <Aviso tipo="error">No pudimos abrir la conexión con Blotato. Recarga la página para intentarlo de nuevo.</Aviso>
            </div>
          }
        >
          <Suspense fallback={null}>
            <DialogoBlotato
              abierto={abierto}
              alCambiar={setAbierto}
              focoAlCerrar={origenDelFoco}
              estado={estado}
              errorCarga={error}
              alSaber={d => {
                setEstado(d);
                setConectado(d.conectado);
              }}
            />
          </Suspense>
        </LimiteDeCarga>
      )}
    </>
  );
}
