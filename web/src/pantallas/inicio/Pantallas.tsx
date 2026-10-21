// Lo que hay dentro de un grupo que NO es la caja (paso 3 del recorrido): la lista de sus pantallas, como tarjetas-enlace con su
// título, su línea de apoyo y su ícono. El título del grupo (el `h2`) lo pone Recorrido.
//
// Lo que antes hacía el menú de la izquierda (UI·8.4) vive aquí, con las mismas reglas (M23 · C):
//   · las pantallas de Blotato se APAGAN a la vista (`aria-disabled` y opacidad) sin la clave del usuario, en vez de esconderse:
//     escondidas, nadie descubre que el producto sabe hacerlo. Su clic ofrece conectar en vez de llevar a una pantalla que solo
//     sabe decir «conéctala»;
//   · `conectado === null` (no se sabe: la consulta falló) NO apaga nada. Dejar sin sus herramientas a quien sí pagó, porque un
//     fetch no respondió, es peor que dejar entrar a quien no;
//   · el botón de conectar o ver la cuenta (antes el «+»/✓ del encabezado del grupo Blotato) va arriba de las tarjetas de un
//     grupo que depende entero de Blotato.
// Lo que todavía no existe (todo Central) sale apagado con «Próximamente» y no navega; un grupo sin pantallas aún (Deepseek) lo dice.
import type { MouseEvent } from 'react';

import type { GrupoMenu, PantallaMenu } from '../../marca/menu';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';

export interface PropsPantallas {
  grupo: GrupoMenu;
  /** null = no se sabe si Blotato está conectado. */
  conectado: boolean | null;
  alConectar: () => void;
  /** La dirección de una herramienta que no trae `href` (las tres pestañas de la caja: una página por herramienta). Sin ella, esas tarjetas
   *  quedan quietas, como siempre. */
  hrefDe?: (pantalla: PantallaMenu) => string | undefined;
}

/** ¿El grupo entero depende de Blotato? Entonces lleva el botón de conectar (Avanzado trae MIX y la Copiadora: ahí no). */
const dependeDeBlotato = (g: GrupoMenu): boolean => g.pantallas.length > 0 && g.pantallas.every(p => p.blotato);

export function Pantallas({ grupo, conectado, alConectar, hrefDe }: PropsPantallas) {
  if (!grupo.pantallas.length) {
    return <p className="m-0 text-sm text-secundario">Todavía no está disponible.</p>;
  }
  const etiqueta = conectado ? 'Blotato conectado: ver o cambiar' : 'Conecta tu cuenta de Blotato';
  return (
    <>
      {dependeDeBlotato(grupo) && (
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={alConectar}
          className={unir(
            'mb-4 inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-boton border px-4 text-sm font-medium',
            conectado
              ? 'border-exito bg-exito-fondo text-exito'
              : 'border-campo bg-transparent text-texto hover:border-secundario hover:bg-elevada',
          )}
        >
          <Icono nombre={conectado ? 'listo' : 'mas'} />
          {etiqueta}
        </button>
      )}
      <ul className="m-0 grid list-none gap-3 p-0">
        {grupo.pantallas.map(p => (
          <li key={p.clave}>
            <Tarjeta p={p} href={p.href ?? hrefDe?.(p)} apagada={Boolean(p.blotato) && conectado === false} alConectar={alConectar} />
          </li>
        ))}
      </ul>
    </>
  );
}

const TARJETA = 'flex min-h-14 items-start gap-3 rounded-grande border border-linea p-4 no-underline';

function Tarjeta({ p, href, apagada, alConectar }: { p: PantallaMenu; href: string | undefined; apagada: boolean; alConectar: () => void }) {
  const dentro = (
    <>
      <Icono nombre={p.icono} className="size-6! text-secundario" />
      <span className="block min-w-0 flex-1">
        <b className="block text-sm leading-snug font-semibold">{p.titulo}</b>
        {(p.proximamente || p.texto) && (
          <small className="block text-xs leading-snug text-secundario">
            {p.proximamente ? (
              'Próximamente'
            ) : apagada ? (
              <span className="text-ambar-claro">Conecta tu Blotato para usarlo</span>
            ) : (
              p.texto
            )}
          </small>
        )}
      </span>
    </>
  );
  // sin dirección (o apagada para siempre) no hay a dónde ir: una tarjeta quieta, sin ser un enlace que no lleva a nada. Se apaga como
  // las fichas «Próximamente» del mapa (fondo hundido y texto secundario), NO con opacidad: «Próximamente» es información, y a media
  // opacidad se leía a 3.19:1 (axe); así queda a 7:1
  if (!href || p.proximamente) return <div className={unir(TARJETA, 'bg-hundido text-secundario')}>{dentro}</div>;
  // el clic de una apagada ofrece conectar en vez de navegar
  const alPulsar = (ev: MouseEvent) => {
    if (!apagada) return;
    ev.preventDefault();
    alConectar();
  };
  return (
    <a
      href={href}
      aria-disabled={apagada || undefined}
      onClick={alPulsar}
      className={unir(TARJETA, 'bg-superficie text-texto transition-colors hover:border-campo hover:bg-elevada', apagada && 'opacity-60')}
    >
      {dentro}
    </a>
  );
}
