// El inicio (dueño, 15-oct-2026: «Mapa con Irremplazables», y en la segunda ronda «el mapa es el inicio»). De arriba abajo: «Irremplazables»
// (el único `h1`, en dorado, sin ícono, FUERA y ARRIBA de cualquier tarjeta y en el mismo lugar en todos los pasos), las migas, y el
// paso de ahora con su `h2`: el mapa en X (lo primero que se ve), las tres opciones, la lista de pantallas de un grupo o la caja. Qué
// paso toca lo decide estadoRecorrido.ts.
//
// Solo la caja lleva tarjeta (borde, fondo y relleno), y las migas se quedan dentro de ella, arriba. El mapa, las opciones y la lista de un
// grupo son pantallas sueltas: sin cuadro que las rodee, centradas bajo el título en horizontal y en el alto que sobra de la pantalla
// (la sección crece hasta el pie de la ventana y el paso se centra en ella; Inicio.tsx le da la altura), y las migas van centradas bajo
// el título.
//
// La caja (`children`) se queda MONTADA mientras se ve otro paso (también al abrir el inicio, que arranca en el mapa) y solo se esconde con
// `hidden`: desmontarla perdería el texto escrito, el video subido o una subida en curso (su estado vive dentro de ella). Esconder lo
// esconde de todo: ni se ve, ni se enfoca, ni lo lee un lector de pantalla.
//
// Teclado y foco (lo que el prototipo midió y arregló):
//   · no hay «Volver a …»: subir de nivel son las migas (dueño, 15-oct-2026). La excepción es la página aparte de donde se llegó
//     (`hoja`, p. ej. Agenda): esa no se alcanza con las migas, y con ella sí hay «Volver a Agenda». Esc: con esa página de por medio
//     regresa a ella, en las opciones sube al mapa, y en el mapa y en el contenido no hace nada (alEscape). El oyente va en la sección y NO
//     en la página: con un diálogo, un menú de la caja o la lista de «Editar ▾» abiertos, Esc es de ellos;
//   · el foco nunca cae a `<body>` (desde ahí Esc dejaría de llegar a la sección): al cambiar de paso el botón pulsado desaparece, y
//     si el foco se perdió pasa al `h2` del paso nuevo (`tabIndex=-1`, solo programático). Si el foco sigue dentro, no se mueve; el
//     que está dentro de la caja que ese mismo cambio esconde cuenta como perdido (el navegador lo suelta a `<body>` un instante después).
//     Llegar por la miga de otra página (?desde=&ver=) es abrir el inicio ya en el mapa o las opciones, con el foco en `<body>`:
//     ahí también va al `h2` al montar, para que Esc vuelva a esa página sin tener que tabular antes. Abrir el inicio sin más (el mapa,
//     sin nada elegido) NO toca el foco: ahí Esc no hace nada, y a una página recién cargada no se le roba;
//   · el orden de Tab es el de lectura: las migas (solo hay en las opciones, en las listas y en la caja), «Volver a …» (solo con una página
//     aparte) y el paso (en el mapa: Marketing, Producto, Central, Ventas, Automatizaciones);
//   · un doble clic no activa por accidente lo que aparece donde estaba lo pulsado: el segundo clic cae en la primera tarjeta de las
//     opciones, en el botón de conectar o en la primera pantalla de una lista (esDobleClicAccidental, para toda la sección).
import { useId, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';

import { Migas, type Miga } from '../../marca/Migas';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import { Grupos } from './Grupos';
import { Mapa } from './Mapa';
import { Pantallas } from './Pantallas';
import {
  ahora,
  alEscape,
  areaDe,
  cajaVisible,
  destinoDeVolver,
  esCaja,
  esDobleClicAccidental,
  grupoActual,
  migasDe,
  type Accion,
  type EstadoRecorrido,
} from './estadoRecorrido';

export interface PropsRecorrido {
  estado: EstadoRecorrido;
  despachar: (accion: Accion) => void;
  /** null = no se sabe si Blotato está conectado (no apaga nada). */
  conectado: boolean | null;
  alConectar: () => void;
  /** A dónde ir (en la página, location.assign; en las pruebas, un espía): Esc con una página aparte de por medio. */
  ir: (url: string) => void;
  /** El `h2` de la caja («¿Qué vamos a crear hoy?»), que vive dentro de ella: a él pasa el foco cuando el paso es la caja. */
  tituloCaja: RefObject<HTMLHeadingElement | null>;
  /** Con ella, las migas son ENLACES (la dirección de cada acción, o null si no lleva a ningún lado) y no botones que cambian de paso: la
   *  página de una herramienta (…/distrito/video/) sube de nivel navegando. Sin ella, las migas de siempre. */
  hrefDeMiga?: ((accion: Accion) => string | null) | undefined;
  /** La caja, ya montada. */
  children: ReactNode;
}

const TITULO_DE_PASO = 'm-0 mb-3 w-fit max-w-full font-titulo text-titulo-md font-bold';

// La tarjeta es solo de la caja. Va a `mt-8` (32 px) debajo del título: con él fuera de ella, el borde queda a 155 px del borde de la
// ventana a 1100×800 (antes, 64 px, pegado al saldo), y el título de la caja («¿Qué vamos a crear hoy?») baja de 185 a 233 px.
const TARJETA =
  'mt-8 rounded-grande border border-linea bg-superficie p-6 max-[560px]:px-4 max-[380px]:px-2 max-[380px]:pt-4 max-[380px]:pb-6';

const VOLVER =
  'inline-flex min-h-11 max-w-full cursor-pointer items-center gap-2 rounded-pildora border border-linea bg-transparent px-3 py-1 text-left text-xs font-medium text-texto no-underline hover:border-campo hover:bg-elevada';

export function Recorrido({ estado, despachar, conectado, alConectar, ir, tituloCaja, hrefDeMiga, children }: PropsRecorrido) {
  const idTitulo = useId();
  const marco = useRef<HTMLElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  // cuándo cambió el paso por última vez (para el doble clic)
  const cambioEn = useRef(0);
  const verCaja = cajaVisible(estado);

  // al cambiar de paso (o de grupo) el botón pulsado desaparece y el foco se iría a <body>: si se perdió, va al título del paso nuevo.
  // No corre al montar (el foco de la página no es de la sección) ni mueve un foco que sigue dentro (un botón del riel de la caja)
  const visto = useRef({ paso: estado.paso, area: estado.area, grupo: estado.grupo });
  useLayoutEffect(() => {
    const antes = visto.current;
    if (antes.paso === estado.paso && antes.area === estado.area && antes.grupo === estado.grupo) return;
    visto.current = { paso: estado.paso, area: estado.area, grupo: estado.grupo };
    cambioEn.current = ahora();
    const activo = document.activeElement;
    // El foco dentro de la caja que este cambio acaba de esconder (`hidden`) también está perdido: sigue siendo `activeElement` hasta que
    // el navegador lo suelta, y lo hace un instante después, a `<body>`. Pasa cuando lo pulsado no mueve el foco (la acción «hacer clic» de
    // un lector, el control por voz, un `.click()`): con el ratón o el teclado la miga lo toma y el foco ya viene de ella
    const perdido = !activo || activo === document.body || !marco.current?.contains(activo) || activo.closest('[hidden]') !== null;
    if (perdido) (verCaja ? tituloCaja : titulo).current?.focus({ preventScroll: true });
  }, [estado.paso, estado.area, estado.grupo, verCaja, tituloCaja]);

  // Llegar por la miga de una página hoja (?desde=&ver=) abre el inicio en el mapa o las opciones con algo ya elegido (`elegido`; el
  // reposo no lo tiene). El navegador acaba de cargar una página nueva y el foco está en <body>, donde Esc no llega a la sección (su
  // oyente es de ella): sin esto hay que tabular o hacer clic antes de que Esc valga. Abrir el inicio sin más no toca el foco de la
  // página. Y como al cambiar de paso, no se le roba a quien ya lo tiene (un diálogo, un campo con autofoco): solo se llena un foco vacío
  const llegoPorEnlace = useRef(estado.elegido && estado.paso !== 'contenido');
  useLayoutEffect(() => {
    if (!llegoPorEnlace.current) return;
    const activo = document.activeElement;
    if (!activo || activo === document.body) titulo.current?.focus({ preventScroll: true });
  }, []);

  const destino = destinoDeVolver(estado);

  // Un doble clic cambia de paso con el primero, y el segundo (`detail` 2) cae sobre lo que apareció donde estaba lo pulsado: elegiría
  // un grupo, navegaría a la primera pantalla de una lista o abriría el diálogo de conectar sin que nadie lo pidiera. Se atiende en la
  // captura, antes de que llegue a lo de adentro, y se cancela también (si no, un enlace navegaría igual). El mapa, las opciones y las
  // listas no tienen que saber de esto, y una elección deliberada (otro clic pasado el medio segundo) o el teclado (`detail` 0) pasan
  function alPulsarAntes(e: MouseEvent<HTMLElement>) {
    if (!esDobleClicAccidental(e.detail, ahora() - cambioEn.current)) return;
    e.preventDefault();
    e.stopPropagation();
  }

  // Esc dentro de la sección (alEscape dice qué hace en este paso). Lo que ya atendió Esc (un menú, una lista) lo marcó con preventDefault:
  // no se repite
  function alTeclear(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const hacer = alEscape(estado);
    if (!hacer) return;
    e.preventDefault();
    if (hacer.tipo === 'ir') ir(hacer.href);
    else despachar(hacer.accion);
  }

  const migas: Miga[] = migasDe(estado).map(m => {
    const accion: Accion = { tipo: m.clave === 'area' ? 'abrir-mapa' : 'abrir-grupos' };
    const href = hrefDeMiga?.(accion);
    return {
      clave: m.clave,
      titulo: m.titulo,
      icono: m.icono,
      rotulo: m.rotulo,
      actual: m.actual,
      ...(href ? { href } : { alPulsar: () => despachar(accion) }),
    };
  });

  const areaExplorada = estado.paso === 'grupos' ? areaDe(estado.explora) : undefined;
  const grupo = estado.paso === 'contenido' ? grupoActual(estado) : undefined;

  return (
    // Esc se atiende aquí y no en toda la página (ver arriba); el elemento no es interactivo: solo recoge el teclado y el ratón de lo de adentro.
    // Sin la caja a la vista la sección llena el alto que deja Inicio.tsx (`flex-1`): ahí el paso se centra
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      ref={marco}
      aria-labelledby={idTitulo}
      onKeyDown={alTeclear}
      onClickCapture={alPulsarAntes}
      className={unir('mx-auto flex w-full max-w-[820px] flex-col', !verCaja && 'flex-1')}
    >
      {/* El degradado dorado es un FONDO recortado a la letra: puesto en el h1 solo cubriría la caja del h1, y la letra que se saliera de
          ella (espaciado de texto de WCAG 1.4.12 a 320 px, letra más grande) quedaría transparente y desaparecería. En un <span> en línea
          su caja mide lo que el texto, y el h1 parte la palabra en vez de dejarla salirse de la sección. `mt-6` lo deja donde estaba
          dentro de la tarjeta (89 px), y no se mueve de un paso a otro */}
      <h1
        id={idTitulo}
        className="m-0 mt-6 text-center font-titulo text-titulo-lg font-extrabold tracking-[-0.02em] [overflow-wrap:anywhere]"
      >
        <span className="texto-oro">Irremplazables</span>
      </h1>

      {/* `data-limite-lista`: la lista de «Editar ▾» (SelectorOpcion) busca este marcador con `closest` para no sobresalir de la tarjeta,
          que es este mismo elemento mientras se ve la caja */}
      <div data-limite-lista="" className={verCaja ? TARJETA : 'flex flex-1 flex-col'}>
        {(migas.length > 0 || destino) && (
          <div className={unir('flex min-h-11 flex-wrap items-center gap-2', verCaja ? 'mb-2' : 'mt-2 justify-center')}>
            <Migas migas={migas} />
            {destino && (
              <a href={destino.href} className={VOLVER}>
                <Icono nombre="volver" className="size-5! text-secundario" />
                {destino.rotulo}
              </a>
            )}
          </div>
        )}

        {!verCaja && (
          <div className="flex flex-1 flex-col justify-center py-6">
            {estado.paso === 'mapa' && (
              <>
                <h2 ref={titulo} tabIndex={-1} className={unir(TITULO_DE_PASO, 'mx-auto text-center')}>
                  Elige un área
                </h2>
                <Mapa alElegir={a => despachar({ tipo: 'elegir-area', area: a.clave })} />
              </>
            )}

            {areaExplorada && (
              <>
                <h2 ref={titulo} tabIndex={-1} className={unir(TITULO_DE_PASO, 'mx-auto text-center')}>
                  Elige un grupo
                </h2>
                <Grupos
                  area={areaExplorada}
                  aqui={estado.elegido && estado.area === areaExplorada.clave ? estado.grupo : null}
                  alElegir={g => despachar({ tipo: 'elegir-grupo', area: areaExplorada.clave, grupo: g.clave })}
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
          </div>
        )}

        <div hidden={!verCaja}>{children}</div>
      </div>
    </section>
  );
}
