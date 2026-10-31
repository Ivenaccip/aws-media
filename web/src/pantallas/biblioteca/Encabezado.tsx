// El encabezado de la Biblioteca (dueño, 15-oct-2026, «Mapa con Irremplazables»; contrato de Ajustes 3, §4): «Irremplazables» arriba, en
// dorado, sin ícono y fuera de toda tarjeta —el mismo título, en el mismo lugar que en el inicio—, y debajo, centradas, las migas
// «Central › Distrito › Biblioteca de prompts». Son el mismo componente de migas de las pantallas hoja (marca/Migas), con una
// diferencia: aquí la ruta llega hasta la propia pantalla (la última, la de «estás aquí»).
//
// Cada miga lleva a la página de su nivel, como en las pantallas hoja: «Central», al mapa (/estudio/), y «Distrito», a las opciones de
// Central (/estudio/central/), sin parámetros (urlDeInicio, marca/menu.ts).
//
// No es el `<Marco>` de las hojas: aquel lleva «← Estudio» y las migas a la izquierda, y el título de la pantalla como `h1`. Aquí el
// único `h1` es «Irremplazables» y el nombre de la pantalla es un `h2` (como en el inicio).
import { buscar, urlDeInicio, type Lugar } from '../../marca/menu';
import { Migas, type Miga } from '../../marca/Migas';

export const LUGAR: Lugar = { area: 'central', grupo: 'distrito', pantalla: 'biblioteca' };

export function Encabezado() {
  const hallazgo = buscar(LUGAR);
  if (!hallazgo) throw new Error('biblioteca: el lugar central.distrito.biblioteca no está en marca/menu.ts');
  const { area, grupo, pantalla } = hallazgo;
  const migas: Miga[] = [
    {
      clave: 'area',
      titulo: area.titulo,
      icono: area.icono,
      rotulo: `Ir al mapa para cambiar de área (ahora: ${area.titulo})`,
      href: urlDeInicio(LUGAR, 'mapa'),
    },
    {
      clave: 'grupo',
      titulo: grupo.titulo,
      icono: grupo.icono,
      rotulo: `Ir a las opciones de ${area.titulo} (ahora: ${grupo.titulo})`,
      href: urlDeInicio(LUGAR, 'grupos'),
    },
    {
      clave: 'pantalla',
      titulo: pantalla.titulo,
      icono: pantalla.icono,
      rotulo: `${pantalla.titulo} (estás aquí)`,
      actual: true,
      href: pantalla.href ?? '/estudio/central/distrito/biblioteca/',
    },
  ];
  return (
    <header className="flex flex-col items-center">
      {/* el degradado dorado es un FONDO recortado a la letra: va en un <span> en línea, no en el h1 (ver pantallas/inicio/Recorrido.tsx) */}
      <h1 className="m-0 mt-6 text-center font-titulo text-titulo-lg font-extrabold tracking-[-0.02em] [overflow-wrap:anywhere]">
        <span className="texto-oro">Irremplazables</span>
      </h1>
      {/* en un celular las tres migas no caben con sus íconos en una fila (la flecha quedaría sola al principio de la segunda): sin ellos sí */}
      <Migas migas={migas} className="mt-2 flex justify-center max-[480px]:[&_svg]:hidden" />
    </header>
  );
}
