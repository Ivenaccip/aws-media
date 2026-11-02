// La entrada de las TRES páginas de la caja (…/distrito/imagen/, …/video/, …/edicion/): la caja de siempre, ya en la pestaña de la dirección.
// Es la misma página con tres direcciones: la caja guarda el texto, el video y la subida al cambiar de pestaña, y eso no se pierde. Qué pestaña
// lo dice la dirección (marca/rutas.ts), y al cambiar de pestaña la dirección y el título la siguen (niveles/PaginaHerramienta.tsx).
//
// La dirección se lee DECODIFICADA (`nivelDeDireccion`): el servidor decide qué página sirve con la ruta ya decodificada y `location.pathname`
// llega como se escribió, así que `/estudio/marketing/distrito/%76ideo/` se sirve y es la pestaña Video. Y si la dirección no es de ninguna
// herramienta nunca queda el documento vacío: se enseña `NoEncontrada` (como nivel.tsx), con un enlace a la principal.
import '../../estilos/tokens.css';

import { nivelDeDireccion } from '../../marca/rutas';
import { montar } from '../../nucleo/montar';
import { NoEncontrada, TITULO_NO_ENCONTRADA } from './niveles/NoEncontrada';
import { PaginaHerramienta } from './niveles/PaginaHerramienta';

const nivel = nivelDeDireccion(location.pathname);

if (nivel?.tipo === 'herramienta') {
  montar(<PaginaHerramienta lugar={nivel.lugar} />);
} else {
  document.title = TITULO_NO_ENCONTRADA;
  montar(<NoEncontrada />);
}
