// La tarjeta del inicio (dueño, 15-oct-2026: «Mapa con Irremplazables»): UNA tarjeta centrada, sin columna a la izquierda. De arriba
// abajo: «Irremplazables» (el único `h1`, en dorado, sin ícono), las migas con «Volver a …» a la derecha, y el paso de ahora con su
// `h2`: el mapa en X, las tres opciones, la caja o la lista de pantallas de un grupo. Qué paso toca lo decide recorrido.ts.
//
// La caja (`children`) se queda MONTADA mientras se ve otro paso y solo se esconde con `hidden`: desmontarla perdería el texto
// escrito, el video subido o una subida en curso (su estado vive dentro de ella). Esconder lo esconde de todo: ni se ve, ni se
// enfoca, ni lo lee un lector de pantalla.
//
// Teclado y foco (lo que el prototipo midió y arregló):
//   · Esc dentro de la tarjeta = «Volver a …» con el mapa o las tres opciones abiertos; en la caja no hace nada. El oyente va en la
//     tarjeta y NO en la página: con un diálogo, un menú de la caja o la lista de «Editar ▾» abiertos, Esc es de ellos;
//   · el foco nunca cae a `<body>` (desde ahí Esc dejaría de llegar a la tarjeta): al cambiar de paso el botón pulsado desaparece, y
//     si el foco se perdió pasa al `h2` del paso nuevo (`tabIndex=-1`, solo programático). Si el foco sigue dentro, no se mueve;
//   · el orden de Tab es el de lectura: migas, «Volver a …», y el paso (Marketing, Producto, Central, Ventas, Automatizaciones);
//   · un doble clic en una ficha del mapa no elige un grupo por accidente (esDobleClicAccidental).
import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

import { Migas, type Miga } from '../../marca/Migas';
import type { AreaMenu, GrupoMenu, PestanaCaja } from '../../marca/menu';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import { Grupos } from './Grupos';
import { Mapa } from './Mapa';
import { Pantallas } from './Pantallas';
import {
  ahora,
  areaDe,
  cajaVisible,
  destinoDeVolver,
  esCaja,
  esDobleClicAccidental,
  grupoActual,
  hayVolver,
  migasDe,
  type Accion,
  type EstadoRecorrido,
} from './recorrido';

export interface PropsRecorrido {
  estado: EstadoRecorrido;
  despachar: (accion: Accion) => void;
  /** La pestaña de la caja de ahora: «Volver a Imagen» (o Video, o Edición) dice a cuál volverás. */
  familia: PestanaCaja;
  /** null = no se sabe si Blotato está conectado (no apaga nada). */
  conectado: boolean | null;
  alConectar: () => void;
  /** A dónde ir (en la página, location.assign; en las pruebas, un espía): Esc con una página aparte de por medio. */
  ir: (url: string) => void;
  /** El `h2` de la caja («¿Qué vamos a crear hoy?»), que vive dentro de ella: a él pasa el foco cuando el paso es la caja. */
  tituloCaja: RefObject<HTMLHeadingElement | null>;
  /** La caja, ya montada. */
  children: ReactNode;
}

const TITULO_DE_PASO = 'm-0 mb-3 w-fit max-w-full font-titulo text-titulo-md font-bold';

const VOLVER =
  'ml-auto inline-flex min-h-11 max-w-full cursor-pointer items-center gap-2 rounded-pildora border border-linea bg-transparent px-3 py-1 text-left text-xs font-medium text-texto no-underline hover:border-campo hover:bg-elevada';

export function Recorrido({ estado, despachar, familia, conectado, alConectar, ir, tituloCaja, children }: PropsRecorrido) {
  const idTitulo = useId();
  const marco = useRef<HTMLElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  // cuándo se abrieron las tres opciones desde el mapa (para el doble clic)
  const abiertoEn = useRef(0);
  const verCaja = cajaVisible(estado);

  // al cambiar de paso (o de grupo) el botón pulsado desaparece y el foco se iría a <body>: si se perdió, va al título del paso nuevo.
  // No corre al montar (el foco de la página no es de la tarjeta) ni mueve un foco que sigue dentro (un botón del riel de la caja)
  const visto = useRef({ paso: estado.paso, area: estado.area, grupo: estado.grupo });
  useLayoutEffect(() => {
    const antes = visto.current;
    if (antes.paso === estado.paso && antes.area === estado.area && antes.grupo === estado.grupo) return;
    visto.current = { paso: estado.paso, area: estado.area, grupo: estado.grupo };
    const activo = document.activeElement;
    const perdido = !activo || activo === document.body || !marco.current?.contains(activo);
    if (perdido) (verCaja ? tituloCaja : titulo).current?.focus({ preventScroll: true });
  }, [estado.paso, estado.area, estado.grupo, verCaja, tituloCaja]);

  const destino = destinoDeVolver(estado, familia);

  function abrir(accion: Accion) {
    if (accion.tipo === 'elegir-area') abiertoEn.current = ahora();
    despachar(accion);
  }

  function elegirGrupo(area: AreaMenu, grupo: GrupoMenu, detail: number) {
    if (esDobleClicAccidental(detail, ahora() - abiertoEn.current)) return;
    despachar({ tipo: 'elegir-grupo', area: area.clave, grupo: grupo.clave });
  }

  // Esc dentro de la tarjeta = «Volver a …». Lo que ya atendió Esc (un menú, una lista) lo marcó con preventDefault: no se repite
  function alTeclear(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Escape' || e.defaultPrevented || !hayVolver(estado)) return;
    e.preventDefault();
    if (destino.href) ir(destino.href);
    else despachar({ tipo: 'volver' });
  }

  const migas: Miga[] = migasDe(estado).map(m => ({
    clave: m.clave,
    titulo: m.titulo,
    icono: m.icono,
    rotulo: m.rotulo,
    actual: m.actual,
    alPulsar: () => abrir({ tipo: m.clave === 'area' ? 'abrir-mapa' : 'abrir-grupos' }),
  }));

  const areaExplorada = estado.paso === 'grupos' ? areaDe(estado.explora) : undefined;
  const grupo = estado.paso === 'contenido' ? grupoActual(estado) : undefined;

  return (
    // Esc se atiende aquí y no en toda la página (ver arriba); el elemento no es interactivo: solo recoge el teclado de lo de adentro
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      ref={marco}
      aria-labelledby={idTitulo}
      onKeyDown={alTeclear}
      className="mx-auto max-w-[820px] rounded-grande border border-linea bg-superficie p-6 max-[560px]:px-4 max-[380px]:px-2 max-[380px]:pt-4 max-[380px]:pb-6"
    >
      <h1 id={idTitulo} className="m-0 mb-2 text-center font-titulo text-titulo-lg font-extrabold tracking-[-0.02em] texto-oro">
        Irremplazables
      </h1>

      <div className="mb-2 flex min-h-11 flex-wrap items-center gap-2">
        <Migas migas={migas} />
        {hayVolver(estado) &&
          (destino.href ? (
            <a href={destino.href} className={VOLVER}>
              <Icono nombre="volver" className="size-5! text-secundario" />
              {destino.rotulo}
            </a>
          ) : (
            <button type="button" onClick={() => despachar({ tipo: 'volver' })} className={VOLVER}>
              <Icono nombre="volver" className="size-5! text-secundario" />
              {destino.rotulo}
            </button>
          ))}
      </div>

      {estado.paso === 'mapa' && (
        <>
          <h2 ref={titulo} tabIndex={-1} className={unir(TITULO_DE_PASO, 'mx-auto text-center')}>
            Elige un área
          </h2>
          <Mapa aqui={estado.area} alElegir={a => abrir({ tipo: 'elegir-area', area: a.clave })} />
        </>
      )}

      {areaExplorada && (
        <>
          <h2 ref={titulo} tabIndex={-1} className={unir(TITULO_DE_PASO, 'mx-auto text-center')}>
            Elige un grupo
          </h2>
          <Grupos
            area={areaExplorada}
            aqui={estado.area === areaExplorada.clave ? estado.grupo : null}
            alElegir={(g, detail) => elegirGrupo(areaExplorada, g, detail)}
          />
        </>
      )}

      {grupo && !esCaja(grupo) && (
        <>
          <h2 ref={titulo} tabIndex={-1} className={TITULO_DE_PASO}>
            {grupo.titulo}
          </h2>
          <Pantallas grupo={grupo} conectado={conectado} alConectar={alConectar} />
        </>
      )}

      <div hidden={!verCaja}>{children}</div>
    </section>
  );
}
