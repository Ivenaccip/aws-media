// El marco de cada pantalla migrada (UI·7, docs/PLAN-UI.md §3): arriba
// «← Estudio», las migas si la pantalla está en el mapa, el título y su bajada.
//
// Las migas (dueño, 15-oct-2026: «Mapa con Irremplazables») son «Marketing ›
// Blotato»: el lugar de esta pantalla en el mapa de marca/menu.ts, como ENLACES
// a la página de cada nivel (urlDeInicio): «Marketing» lleva al mapa de áreas
// (/estudio/) y «Blotato» a las opciones del área (/estudio/marketing/), sin
// parámetros. Volver aquí es el «atrás» del navegador. Las pantallas que el mapa
// no conoce (admin, crear, subir, clip, imágenes, shorts) no las llevan: no hay a
// qué nivel llevarlas.
//
// «Usar la versión anterior» ya no se enseña (decisión del dueño, 28-sep): la
// ruta /ui/clasica sigue en server/migracion.py por si hace falta volver a una
// pantalla vieja a mano, pero ninguna pantalla la anuncia.
// 64 px arriba: la píldora del monedero (fija, arriba a la derecha) acaba a
// 52 px (UI·12).
import type { ReactNode } from 'react';

import { Icono } from '../ui/Icono';
import { lugarDePagina, urlDeInicio } from './menu';
import { Migas, type Miga } from './Migas';

export interface PropsMarco {
  /** El nombre de la pantalla en server/migracion.py (p. ej. «admin»). Si está en el
   *  mapa (`pagina` de marca/menu.ts), de aquí salen sus migas. */
  pantalla: string;
  /** Casi siempre un texto; imágenes pasa su título con la palabra que gira. */
  titulo: ReactNode;
  /** Una línea bajo el título: qué hay en esta pantalla. */
  bajada?: ReactNode;
  children: ReactNode;
}

const ENLACE =
  'inline-flex min-h-11 items-center gap-2 text-sm text-enlace no-underline ' +
  'hover:text-texto hover:underline underline-offset-4';

/** «Área › Grupo» de una pantalla hoja; nada si el mapa no la conoce. Los rótulos dicen a dónde llevan, porque aquí cambian de página. */
function migasDe(pantalla: string): Miga[] {
  const hallazgo = lugarDePagina(pantalla);
  if (!hallazgo) return [];
  const { area, grupo, lugar } = hallazgo;
  return [
    {
      clave: 'area',
      titulo: area.titulo,
      icono: area.icono,
      rotulo: `Ir al mapa para cambiar de área (ahora: ${area.titulo})`,
      href: urlDeInicio(lugar, 'mapa'),
    },
    {
      clave: 'grupo',
      titulo: grupo.titulo,
      icono: grupo.icono,
      rotulo: `Ir a las opciones de ${area.titulo} (ahora: ${grupo.titulo})`,
      href: urlDeInicio(lugar, 'grupos'),
    },
  ];
}

export function Marco({ pantalla, titulo, bajada, children }: PropsMarco) {
  const migas = migasDe(pantalla);
  return (
    <div className="mx-auto max-w-[1080px] px-4 pt-16 pb-10 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-6">
        <nav aria-label="Navegación" className="flex flex-wrap items-center justify-between gap-x-6">
          <a className={ENLACE} href="/estudio/">
            <Icono nombre="volver" />
            Estudio
          </a>
        </nav>
        {/* su propia <nav>: «Navegación» (volver al Estudio) y «Dónde estás» (esta pantalla en el mapa) son dos cosas distintas */}
        <Migas migas={migas} />
      </div>
      <main>
        <h1 className="mt-2 mb-2 font-titulo text-titulo-lg font-extrabold tracking-[-0.02em]">{titulo}</h1>
        {bajada && <div className="mb-6 max-w-[75ch] text-secundario">{bajada}</div>}
        {children}
      </main>
    </div>
  );
}
