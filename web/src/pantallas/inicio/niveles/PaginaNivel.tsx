// Una página del recorrido (mapa, área o grupo): lo MISMO que el inicio enseñaba en cada paso, pero con su propia dirección y SIN la caja.
// Reusa lo que ya está —Mapa, Grupos, Pantallas, Migas y la lógica de estadoRecorrido.ts— y no importa nada de la caja (Caja, Edición,
// Galería, Mis creaciones): por eso pesa lo suyo. El diseño es el de Recorrido.tsx (título arriba, migas centradas, el paso centrado en el
// alto que sobra); las migas conservan lo de siempre: la del área vuelve al mapa y la del grupo, a las opciones del área.
//
// Lo que hacía el estado y ahora hace el navegador: «subir de nivel» es la miga (un enlace) o el «atrás» del navegador, y el foco empieza
// arriba en cada página (el `<title>` de cada una dice dónde es: no hay foco programático al `h2`). Se conservan dos cosas:
//   · Esc en las opciones del área sube al mapa. Con la página recién cargada el foco está en <body> y no dentro de la sección, así que
//     el oyente es del DOCUMENTO; lo que ya atendió Esc (un menú, un diálogo) lo marcó con preventDefault y no se repite;
//   · la guarda del doble clic (esDobleClicAccidental): el primer clic ya cargó otra página y el segundo cae sobre lo que apareció donde
//     estaba lo pulsado (a 390 px la ficha «Marketing» del mapa y la tarjeta «Distrito» de la página siguiente coinciden). Sin la
//     guarda, ese segundo clic saltaría dos niveles. Una página es nueva en cada nivel, así que se cuenta desde que ESTA se cargó.
//
// Quien sí pesa aparte es Blotato (la lectura de su estado, el diálogo, Radix): solo los dos grupos que lo usan lo piden, y con import()
// (ver GrupoConBlotato.tsx: la lista es la misma desde el primer pintado, no una de espera que se cambie por otra).
import { useEffect, useId, useMemo, useState, type MouseEvent } from 'react';

import { Migas, type Miga } from '../../../marca/Migas';
import { areaDe, grupoDe, type AreaMenu, type GrupoMenu, type PantallaMenu } from '../../../marca/menu';
import { urlDeArea, urlDeGrupo, urlDeHerramienta, type Nivel } from '../../../marca/rutas';
import { unir } from '../../../ui/unir';
import { ahora, alEscape, esDobleClicAccidental, migasDe } from '../estadoRecorrido';
import { Grupos } from '../Grupos';
import { Mapa } from '../Mapa';
import { Pantallas } from '../Pantallas';
import { GrupoConBlotato } from './GrupoConBlotato';
import { estadoDeNivel, urlDeAccion } from './navegar';

// Igual que en Recorrido.tsx: el mapa y las opciones centran su título; el de un grupo va a la izquierda, con su lista
const TITULO_DE_PASO = 'm-0 mb-3 w-fit max-w-full font-titulo text-titulo-md font-bold';
const CENTRADO = 'mx-auto text-center';

const navegar = (url: string) => location.assign(url);

/** Las tres pestañas de la caja son páginas de otro tipo (la caja), pero se LISTAN aquí: cada tarjeta es un enlace a la suya. */
function hrefDeHerramienta(area: AreaMenu, grupo: GrupoMenu) {
  return (p: PantallaMenu) => (p.caja !== undefined ? urlDeHerramienta(area, grupo, p) : undefined);
}

export interface PropsPaginaNivel {
  nivel: Exclude<Nivel, { tipo: 'herramienta' }>;
  /** A dónde ir (en la página, location.assign; en las pruebas, un espía): Esc en las opciones. */
  ir?: (url: string) => void;
}

export function PaginaNivel({ nivel, ir = navegar }: PropsPaginaNivel) {
  const idTitulo = useId();
  const estado = useMemo(() => estadoDeNivel(nivel), [nivel]);
  // cuándo se cargó la página: un segundo clic de un doble clic a menos de medio segundo cae en lo que apareció donde estaba lo pulsado
  // y se descarta, también el enlace. Se lee una vez, al montar
  const [cargada] = useState(ahora);

  // Se atiende en la captura, antes de que llegue a lo de adentro, y se cancela también (si no, un enlace navegaría igual). El mapa, las
  // opciones y las listas no tienen que saber de esto; una elección deliberada (otro clic pasado el medio segundo) y el teclado (Enter:
  // `detail` 0) pasan
  function alPulsarAntes(e: MouseEvent<HTMLElement>) {
    if (!esDobleClicAccidental(e.detail, ahora() - cargada)) return;
    e.preventDefault();
    e.stopPropagation();
  }

  useEffect(() => {
    const hacer = alEscape(estado);
    if (hacer?.tipo !== 'accion') return;
    const url = urlDeAccion(hacer.accion, estado);
    if (!url) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      ir(url);
    };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [estado, ir]);

  const migas: Miga[] = migasDe(estado).map(m => {
    const url = urlDeAccion({ tipo: m.clave === 'area' ? 'abrir-mapa' : 'abrir-grupos' }, estado);
    return {
      clave: m.clave,
      titulo: m.titulo,
      icono: m.icono,
      rotulo: m.rotulo,
      actual: m.actual,
      ...(url ? { href: url } : {}),
    };
  });

  const area = nivel.tipo === 'mapa' ? undefined : areaDe(nivel.area);
  const grupo = nivel.tipo === 'grupo' ? grupoDe(nivel.area, nivel.grupo) : undefined;

  return (
    <main className="mx-auto flex min-h-dvh max-w-[1100px] flex-col px-4 pt-16 pb-0 max-[380px]:px-3">
      <section aria-labelledby={idTitulo} onClickCapture={alPulsarAntes} className="mx-auto flex w-full max-w-[820px] flex-1 flex-col">
        {/* El degradado dorado es un FONDO recortado a la letra: va en un <span> en línea para que su caja mida lo que el texto (ver Recorrido.tsx) */}
        <h1
          id={idTitulo}
          className="m-0 mt-6 text-center font-titulo text-titulo-lg font-extrabold tracking-[-0.02em] [overflow-wrap:anywhere]"
        >
          <span className="texto-oro">Irremplazables</span>
        </h1>

        <div data-limite-lista="" className="flex flex-1 flex-col">
          {migas.length > 0 && (
            <div className="mt-2 flex min-h-11 flex-wrap items-center justify-center gap-2">
              <Migas migas={migas} />
            </div>
          )}

          <div className="flex flex-1 flex-col justify-center py-6">
            {nivel.tipo === 'mapa' && (
              <>
                <h2 className={unir(TITULO_DE_PASO, CENTRADO)}>Elige un área</h2>
                {/* las que se abren son enlaces (`hrefDe`); las apagadas, botones quietos que no llevan a ningún lado */}
                <Mapa alElegir={() => undefined} hrefDe={urlDeArea} />
              </>
            )}

            {area && nivel.tipo === 'area' && (
              <>
                <h2 className={unir(TITULO_DE_PASO, CENTRADO)}>{area.proximamente ? area.titulo : 'Elige un grupo'}</h2>
                {area.proximamente || !area.grupos.length ? (
                  <p className="m-0 text-center text-sm text-secundario">Todavía no está disponible.</p>
                ) : (
                  <Grupos area={area} aqui={null} alElegir={() => undefined} hrefDe={g => urlDeGrupo(area, g)} />
                )}
              </>
            )}

            {area && grupo && (
              <>
                <h2 className={TITULO_DE_PASO}>{grupo.titulo}</h2>
                {grupo.pantallas.some(p => p.blotato) ? (
                  <GrupoConBlotato grupo={grupo} hrefDe={hrefDeHerramienta(area, grupo)} />
                ) : (
                  <Pantallas grupo={grupo} conectado={null} alConectar={() => undefined} hrefDe={hrefDeHerramienta(area, grupo)} />
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
