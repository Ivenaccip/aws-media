// La idea de turno de la pista del campo de Edición (dueño, 14-oct-2026: «Rotan solas como pista»): una idea a la vez que
// sale con un fundido y entra la siguiente, en círculo. Este hook es solo el reloj; lo que se ve (el `placeholder` del campo y
// su opacidad) lo pone CajaEdicion con lo que devuelve.
//
// Un solo reloj, y siempre UN solo temporizador vivo: es un setTimeout que se vuelve a armar en cada paso (el efecto depende
// del paso en que va). Así no hay un intervalo y un temporizador de fundido que se puedan desfasar, ni dos rotaciones en
// StrictMode (que monta, desmonta y monta el efecto: el primer temporizador se cancela antes de armar el segundo), y desmontar
// no deja nada vivo. Dos pasos por idea:
//   · «quieta»: la idea se lee entera. Dura PISTA_CADA_MS menos un fundido, para que de una idea a la siguiente pasen
//     exactamente PISTA_CADA_MS (los 4 s que se prometen), contando el fundido de salida;
//   · «saliendo»: se apaga (opacidad 0, con --ease-entrada: lo que se va acelera). Al terminar el fundido se cambia el texto,
//     que ya no se ve, y la idea nueva entra (opacidad 1, con --ease-salida: lo que llega frena).
//
// Cuándo NO corre (`quieta` y `enVista` de afuera, y lo que el hook sabe solo):
//   · `quieta`: el campo tiene el foco (quien va a escribir no debe ver la pista cambiar bajo el cursor) o tiene texto (la pista
//     no se ve). No corre NADA: ni temporizador ni fundidos. Al soltarse retoma en la MISMA idea;
//   · `enVista` falso: el campo no se puede ver aunque siga montado. El modo Shorts cambia el campo por otro, y el inicio de una sola
//     página (retirado en E8) escondía la caja con `hidden` mientras enseñaba el mapa, las opciones o una lista (desmontarla perdía
//     lo escrito); hoy la página de su herramienta siempre la tiene a la vista. Nadie ve la pista: no corre NADA, y lo que había
//     avanzado se olvida, así que al volver arranca otra vez en la primera idea, sin fundido. (Volver a la pestaña Edición ya lo
//     hacía solo: cambiar de pestaña desmonta esta caja y su estado);
//   · «reducir movimiento»: se queda fija en la primera idea, sin fundido ni rotación, y reacciona si la preferencia cambia
//     (al encenderla vuelve a la primera; al apagarla sigue en la primera y rota desde ahí, sin saltar a la idea que iba);
//   · la pestaña del navegador está oculta: no se acumulan ni se disparan ciclos que nadie ve.
// Al parar, una idea que iba saliendo vuelve a verse entera: congelada a medio apagar, el campo se quedaría sin pista. Al
// retomar, la cuenta empieza de cero (no se descuenta el tiempo que se llevaba).
//
// Empieza SIEMPRE en la primera idea y sin animación (docs/DISENO.md §4: «Nada anima por defecto lo que ya estaba al abrir la
// pantalla»): el estado inicial es «la primera, quieta», y un cambio de estilo solo anima cuando algo cambia.
import { useEffect, useState } from 'react';

import { useMovimientoReducido, usePestanaOculta } from '../../nucleo/useAmbiente';
import { PISTA_CADA_MS, PISTA_FUNDIDO_MS } from './edicion';

export interface PistaRotatoria {
  /** La idea de turno. */
  idea: string;
  /** Se está apagando: lo que la ve debe llevar la opacidad a 0 (y a 1 cuando vuelva a ser falso). */
  saliendo: boolean;
}

interface Paso {
  indice: number;
  saliendo: boolean;
}

const AL_ABRIR: Paso = { indice: 0, saliendo: false };

/**
 * @param ideas lo que rota, en orden; la primera es la que se ve al abrir.
 * @param quieta la pista no se está viendo o alguien va a escribir (foco, texto): no corre nada y retoma donde iba.
 * @param enVista el campo se puede ver ahora. Falso = no corre nada Y se olvida lo avanzado: al volver arranca en la primera.
 */
export function usePistaRotatoria(ideas: readonly [string, ...string[]], quieta: boolean, enVista: boolean): PistaRotatoria {
  const reducido = useMovimientoReducido();
  const oculta = usePestanaOculta();
  const rota = enVista && !quieta && !reducido && !oculta;
  const [paso, setPaso] = useState<Paso>(AL_ABRIR);

  // al dejar de rotar, la idea que iba saliendo vuelve a verse entera (ajustar el estado al renderizar, no en un efecto:
  // así el cuadro con la pista a media luz no llega a pintarse)
  const [rotaAntes, setRotaAntes] = useState(rota);
  if (rota !== rotaAntes) {
    setRotaAntes(rota);
    if (!rota && paso.saliendo) setPaso({ indice: paso.indice, saliendo: false });
  }

  // con «reducir movimiento» manda la primera idea, entera, y lo que la rotación había avanzado se olvida: así, al apagar la
  // preferencia con la pantalla abierta, la pista sigue en la primera y rota desde ahí con su fundido, y no salta de golpe a la
  // idea que traía guardada. Fuera de la vista pasa lo mismo, y se olvida ahí mismo (con el campo apagado, sin que se note) y no
  // al volver, cuando el cambio de idea se vería. Va atado a `reducido` y a `enVista` y NO al bloque de arriba: `rota` también
  // cambia por foco, texto y pestaña oculta (ahí SÍ se retoma en la misma idea), y con el campo enfocado `rota` ya era falso al
  // encender y apagar la preferencia, así que ese bloque no correría. Es idempotente: tras un render con `paso` en AL_ABRIR la
  // condición es falsa
  if ((reducido || !enVista) && (paso.indice !== 0 || paso.saliendo)) setPaso(AL_ABRIR);

  const total = ideas.length;
  useEffect(() => {
    if (!rota) return;
    const temporizador = setTimeout(
      () => setPaso(p => (p.saliendo ? { indice: (p.indice + 1) % total, saliendo: false } : { indice: p.indice, saliendo: true })),
      paso.saliendo ? PISTA_FUNDIDO_MS : PISTA_CADA_MS - PISTA_FUNDIDO_MS,
    );
    return () => clearTimeout(temporizador);
  }, [rota, paso, total]);

  // `rota &&` NO es redundante con el reinicio de arriba: ese solo corre en el render donde `rota` cambia, y un temporizador
  // viejo puede vencer entre el commit que para la rotación y la limpieza de su efecto, dejando `paso.saliendo` en true con
  // `rota` en falso (la pista se quedaría en opacidad 0 con el campo enfocado). Lo prueba usePistaRotatoria.test.tsx
  return { idea: ideas[paso.indice] ?? ideas[0], saliendo: rota && paso.saliendo };
}
