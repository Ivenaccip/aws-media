// La entrada de las páginas de NIVEL (el mapa, cada área, cada grupo): una sola para todas. Qué nivel es lo dice la dirección
// (marca/rutas.ts), así un index.html puesto en una carpeta que no es la suya no enseña otra cosa. No importa la caja: las tres
// herramientas de la caja tienen su propia entrada (../herramienta.tsx).
//
// Las entradas de ANTES al inicio (`?prompt=`, `?brief=`, `?blotato=conectar`) las manda a su página el servidor con un 302, antes de que
// esta página exista: aquí no hay un salto de JavaScript que las reinterprete. Lo único que se hace con la dirección es limpiar `desde` y
// `ver` del mapa (las traían las migas de las pantallas hoja de antes y se leían una vez): recargar o compartir la dirección no repite nada.
//
// La dirección se lee DECODIFICADA (`nivelDeDireccion`): el servidor decide qué página sirve con la ruta ya decodificada y `location.pathname`
// llega como se escribió, así que `/estudio/%6Darketing/` se sirve y es el área Marketing. Y si la dirección no es de ningún nivel nunca queda
// el documento vacío: se enseña `NoEncontrada`, con un enlace a la principal.
import '../../../estilos/tokens.css';

import { nivelDeDireccion } from '../../../marca/rutas';
import { montar } from '../../../nucleo/montar';
import { urlSinEntrada } from '../estadoRecorrido';
import { NoEncontrada, TITULO_NO_ENCONTRADA } from './NoEncontrada';
import { PaginaNivel } from './PaginaNivel';

const nivel = nivelDeDireccion(location.pathname);

if (nivel && nivel.tipo !== 'herramienta') {
  if (nivel.tipo === 'mapa') {
    const limpia = urlSinEntrada(location.href);
    if (limpia) history.replaceState(history.state, '', limpia);
  }
  montar(<PaginaNivel nivel={nivel} />);
} else {
  document.title = TITULO_NO_ENCONTRADA;
  montar(<NoEncontrada />);
}
