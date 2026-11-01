// El encabezado de una pantalla hoja con título propio (dueño, 15-oct-2026, «Mapa con Irremplazables»): «Irremplazables» arriba, en
// dorado, sin ícono y fuera de toda tarjeta —el mismo título, en el mismo lugar que en el inicio—, y debajo, centradas, las migas
// «Área › Grupo › Pantalla» sacadas de marca/menu.ts. Es el de COI y la Biblioteca, sin copiarlo: el Constructor y el Asistente de
// Automatizaciones lo usan.
//
// Cada miga lleva a la página de su nivel, como en las demás hojas: el área, al mapa (/estudio/), y el grupo, a las opciones del área
// (/estudio/<área>/), sin parámetros (urlDeInicio). La última miga es la pantalla donde estás: un chip quieto (como en COI), no un enlace
// que no lleva a ningún lado.
//
// No es el `<Marco>` de las hojas con «← Estudio»: aquí el único `h1` es «Irremplazables» y el nombre de la pantalla lo pone quien
// usa este encabezado, como `h2`.
import { buscar, urlDeInicio, type Lugar } from './menu';
import { Migas, type Miga } from './Migas';

export interface PropsEncabezadoHoja {
  /** Dónde estás, con las claves de `MENU` (marca/menu.ts). */
  lugar: Lugar;
}

export function EncabezadoHoja({ lugar }: PropsEncabezadoHoja) {
  const hallazgo = buscar(lugar);
  if (!hallazgo) throw new Error(`encabezado: el lugar ${lugar.area}.${lugar.grupo}.${lugar.pantalla} no está en marca/menu.ts`);
  const { area, grupo, pantalla } = hallazgo;
  const migas: Miga[] = [
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
    { clave: 'pantalla', titulo: pantalla.titulo, icono: pantalla.icono, actual: true },
  ];
  return (
    <header className="flex flex-col items-center">
      {/* el degradado dorado es un FONDO recortado a la letra: va en un <span> en línea, no en el h1 (ver pantallas/inicio/niveles/PaginaHerramienta.tsx) */}
      <h1 className="m-0 mt-6 text-center font-titulo text-titulo-lg font-extrabold tracking-[-0.02em] [overflow-wrap:anywhere]">
        <span className="texto-oro">Irremplazables</span>
      </h1>
      {/* en un celular las tres migas no caben en una fila: sin sus íconos sí caben a 390 px, y a 320 se parten en dos renglones. Los «›» entre
          ellas tampoco se pintan ahí: el de la segunda línea quedaba SOLO, pegado al borde izquierdo (cada «›» va con la miga que le sigue). */}
      <Migas migas={migas} className="mt-2 flex justify-center max-[480px]:[&_svg]:hidden max-[480px]:[&_li>span[aria-hidden=true]]:hidden" />
    </header>
  );
}
