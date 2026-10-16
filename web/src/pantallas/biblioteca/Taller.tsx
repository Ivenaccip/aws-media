// El taller de dos paneles (dirección B del lienzo, Ajustes 3): a la izquierda se ELIGE —conmutador «De la casa / Míos», los tres fijados,
// buscador, categorías con su conteo y la lista—; a la derecha se USA —el prompt completo, «Copiar», «Llevar a la caja» y el pin—.
// En un celular (< 960 px) los dos paneles son dos pasos: «1 Elige» → «2 Úsalo».
//
// Lo que cuida cada parte:
//   · la lista es UNA parada de Tab: la fila con la parada lleva `tabindex=0` y las demás -1; ↑ ↓ Inicio y Fin mueven el foco, Enter o
//     un clic eligen. Con 100 prompts, Tab no cruza cien botones;
//   · copiar no mueve el foco: confirma en el propio botón y en la región de avisos. Con la API moderna, con el método viejo y, si
//     el navegador no deja ninguno, el prompt queda SELECCIONADO y se dice;
//   · fijar es un interruptor (`aria-pressed`) que se ve ya y se guarda después (useFijados). Con el tope lleno NO sustituye nada: avisa
//     y no mueve el foco;
//   · llevar a la caja es un enlace al Inicio con el texto en la dirección (urlDeLlevar): llevarlo no crea ni cobra nada;
//   · borrar un «mío» pide confirmar, y el foco no cae a <body> al desaparecer lo que lo tenía.
// Todo texto del servidor (títulos, prompts, etiquetas) se pinta como texto: React lo escapa y aquí no hay HTML crudo.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { Aviso } from '../../ui/Aviso';
import { Boton, claseBoton } from '../../ui/Boton';
import { Confirmar } from '../../ui/Confirmar';
import { Icono } from '../../ui/Icono';
import type { NombreIcono } from '../../ui/iconos';
import { unir } from '../../ui/unir';
import { Fijados } from './Fijados';
import {
  borrarMio,
  codigoDe,
  copiarTexto,
  filtrar,
  fijar,
  hayFiltro,
  mover,
  partesDe,
  pestanaDe,
  porTexto,
  quitar,
  resumenDeLista,
  SIN_FILTRO,
  sePuedeLlevar,
  textoDe,
  TODAS,
  urlDeLlevar,
  type Ambito,
  ambitoDeLaDireccion,
  type Filtro,
  type Listado,
  type Prompt,
} from './logica';
import { useFijados } from './useFijados';

const RUTA_COI = '/estudio/coi/';

/** Lo que dice una nota junto a los fijados o al pin, y dónde se ve. */
interface Nota {
  donde: 'detalle' | 'franja';
  tipo: 'aviso' | 'error';
  texto: string;
}

const iconoDe = (categoria: string): NombreIcono =>
  categoria === 'imagen' ? 'imagen' : categoria === 'video' ? 'video' : categoria === 'investigacion' ? 'investiga' : 'guion';

/** ¿Es un celular? Ahí los dos paneles son dos pasos y elegir pasa al segundo. Mismo corte que `min-[960px]:` de abajo. */
const esCelular = (): boolean => typeof matchMedia === 'function' && matchMedia('(max-width: 959px)').matches;

const BOTON_TEXTO =
  'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-boton border-0 bg-transparent px-3 text-sm text-enlace no-underline hover:text-texto hover:underline underline-offset-4';
const BOTON_MEDIO =
  'inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-boton border border-campo bg-transparent px-4 text-sm font-medium text-texto no-underline hover:border-secundario hover:bg-elevada';
const BOTON_LISTO =
  'inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-boton border border-exito bg-exito-fondo px-5 text-sm font-medium text-exito';
const TITULO_DE_SECCION = 'm-0 mb-1.5 text-xs font-semibold tracking-wide text-secundario uppercase';

export function Taller({ datos }: { datos: Listado }) {
  const { categorias, casa, limites } = datos;
  const [mios, setMios] = useState(datos.mios);
  const [ambito, setAmbito] = useState<Ambito>(() => ambitoDeLaDireccion(window.location.search));
  const [filtro, setFiltro] = useState<Filtro>(SIN_FILTRO);
  const [sel, setSel] = useState<string | null>(null);
  // en celular: 1 = la lista, 2 = el prompt
  const [paso, setPaso] = useState<1 | 2>(1);
  // la fila con la parada de Tab (una sola, como en una lista de opciones)
  const [foco, setFoco] = useState('');
  const [copiado, setCopiado] = useState('');
  const [anuncio, setAnuncio] = useState('');
  const [nota, setNota] = useState<Nota | null>(null);
  const [aBorrar, setABorrar] = useState<Prompt | null>(null);

  const tituloLista = useRef<HTMLHeadingElement>(null);
  const tituloFijados = useRef<HTMLHeadingElement>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cuenta = useRef(0);
  // lo que hay que enfocar cuando termine el render que viene (el elemento todavía no existe, o va a cambiar de lugar)
  const porEnfocar = useRef<(() => HTMLElement | null | undefined) | null>(null);
  // dónde se hizo lo último con los fijados: ahí se dice si no se pudo guardar
  const dondeFijo = useRef<Nota['donde']>('detalle');

  const fijados = useFijados(datos.fijados, texto =>
    setNota({ donde: dondeFijo.current, tipo: 'error', texto: `${texto} Tus fijados quedaron como estaban.` }),
  );

  useEffect(() => {
    const f = porEnfocar.current;
    if (!f) return;
    porEnfocar.current = null;
    f()?.focus();
  });
  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  const decir = (mensaje: string) => {
    cuenta.current += 1;
    // un espacio de más cambia el texto: el mismo aviso dicho dos veces se vuelve a leer
    setAnuncio(mensaje + (cuenta.current % 2 ? '' : ' '));
  };
  const enElDom = (selector: string, quien: (e: HTMLElement) => boolean = () => true) =>
    Array.from(raiz.current?.querySelectorAll<HTMLElement>(selector) ?? []).find(quien) ?? null;
  const nombreDe = (clave: string) => categorias.find(c => c.clave === clave)?.nombre ?? '';

  // ---- lo que se ve
  const lista = ambito === 'casa' ? casa : mios;
  const visibles = useMemo(() => filtrar(lista, filtro, categorias), [lista, filtro, categorias]);
  const base = useMemo(() => porTexto(lista, filtro, categorias), [lista, filtro, categorias]);
  const actual = visibles.find(p => p.id === sel) ?? visibles[0] ?? null;
  const porId = useMemo(() => new Map([...casa, ...mios].map(p => [p.id, p])), [casa, mios]);
  const fijadosVivos = fijados.ids.flatMap(id => porId.get(id) ?? []);
  const tope = limites.fijados;
  const paradaDeTab = visibles.some(p => p.id === foco) ? foco : (actual?.id ?? '');
  const chips = [{ clave: TODAS, nombre: 'Todos', n: base.length }, ...categorias.map(c => ({ ...c, n: base.filter(p => p.categoria === c.clave).length }))];

  // ---- elegir
  function elegir(id: string) {
    setSel(id);
    setFoco('');
    setCopiado('');
    setNota(n => (n?.donde === 'detalle' ? null : n));
    if (esCelular()) {
      setPaso(2);
      porEnfocar.current = () => document.getElementById('bib-detalle');
    } else {
      decir(`Mostrando «${porId.get(id)?.titulo ?? ''}».`);
    }
  }

  function cambiarAmbito(a: Ambito) {
    if (a === ambito) return;
    setAmbito(a);
    setFiltro(SIN_FILTRO);
    setSel(null);
    setFoco('');
    setPaso(1);
    setNota(null);
  }

  function filtrarPor(nuevo: Filtro) {
    setFiltro(nuevo);
    setFoco('');
    setCopiado('');
    setPaso(1);
  }

  function abrirFijado(p: Prompt) {
    const esMio = mios.some(m => m.id === p.id);
    setAmbito(esMio ? 'mios' : 'casa');
    setFiltro(SIN_FILTRO);
    setSel(p.id);
    setFoco('');
    setCopiado('');
    setNota(n => (n?.donde === 'detalle' ? null : n));
    if (esCelular()) {
      setPaso(2);
      porEnfocar.current = () => document.getElementById('bib-detalle');
    } else {
      decir(`Mostrando «${p.titulo}».`);
      // si no estaba a la vista en la lista, que se vea
      porEnfocar.current = () => {
        enElDom('[data-id]', e => e.dataset.id === p.id)?.scrollIntoView?.({ block: 'nearest' });
        return null;
      };
    }
  }

  // las flechas viven en cada fila (que es un botón) y no en la lista: así la lista no es un elemento no interactivo con teclado
  function teclaFila(e: KeyboardEvent<HTMLButtonElement>) {
    const k = e.key;
    if (k !== 'ArrowDown' && k !== 'ArrowUp' && k !== 'Home' && k !== 'End') return;
    const filas = Array.from(e.currentTarget.closest('ul')?.querySelectorAll<HTMLButtonElement>('button[data-id]') ?? []);
    const i = filas.indexOf(e.currentTarget);
    if (i < 0) return;
    const j = k === 'Home' ? 0 : k === 'End' ? filas.length - 1 : Math.min(filas.length - 1, Math.max(0, i + (k === 'ArrowDown' ? 1 : -1)));
    e.preventDefault();
    filas[j]?.focus();
  }

  // ---- fijar
  function alternarPin(p: Prompt) {
    dondeFijo.current = 'detalle';
    setNota(null);
    const ahora = fijados.leer();
    if (ahora.includes(p.id)) {
      fijados.cambiar(quitar(ahora, p.id));
      decir(`Quitaste «${p.titulo}» de tus fijados.`);
      return;
    }
    const r = fijar(ahora, p.id, tope);
    // con el tope lleno no se sustituye nada en silencio: se dice y el foco se queda donde estaba (en el botón)
    if (!r.ok) {
      setNota({ donde: 'detalle', tipo: 'aviso', texto: r.texto });
      return;
    }
    fijados.cambiar(r.ids);
    decir(`Fijaste «${p.titulo}». Es el ${r.ids.length} de tus ${tope} fijados.`);
  }

  function moverFijado(p: Prompt, paso: -1 | 1) {
    dondeFijo.current = 'franja';
    setNota(null);
    const nueva = mover(fijados.leer(), p.id, paso);
    fijados.cambiar(nueva);
    decir(`«${p.titulo}» queda en el lugar ${nueva.indexOf(p.id) + 1} de ${nueva.length}.`);
    // reordenar mueve la casilla de lugar: el foco vuelve al mismo botón, donde haya quedado
    const accion = paso < 0 ? 'subir' : 'bajar';
    porEnfocar.current = () => enElDom(`[data-fijado] [data-accion="${accion}"]`, e => e.closest<HTMLElement>('[data-fijado]')?.dataset.fijado === p.id);
  }

  function quitarFijado(p: Prompt) {
    dondeFijo.current = 'franja';
    setNota(null);
    const antes = fijados.leer();
    fijados.cambiar(quitar(antes, p.id));
    decir(`Quitaste «${p.titulo}» de tus fijados.`);
    // el botón que tenía el foco desaparece: pasa a la casilla que ocupó su lugar (o a la anterior), y si no queda ninguna, al título
    const i = antes.indexOf(p.id);
    const sigue = quitar(antes, p.id)[Math.min(i, antes.length - 2)];
    porEnfocar.current = () =>
      (sigue ? enElDom('[data-fijado] [data-accion="abrir"]', e => e.closest<HTMLElement>('[data-fijado]')?.dataset.fijado === sigue) : null) ??
      tituloFijados.current;
  }

  // ---- copiar
  async function copiar(p: Prompt) {
    if (await copiarTexto(p.prompt)) {
      setCopiado(p.id);
      decir(`Copiado: ${p.titulo}.`);
      if (temporizador.current) clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => {
        temporizador.current = null;
        setCopiado('');
      }, 2200);
      return;
    }
    // ningún método dejó copiar: el texto queda seleccionado para que se copie a mano
    try {
      const nodo = document.getElementById('bib-prompt');
      const seleccion = window.getSelection();
      if (nodo && seleccion) {
        seleccion.removeAllRanges();
        const rango = document.createRange();
        rango.selectNodeContents(nodo);
        seleccion.addRange(rango);
      }
    } catch {
      /* sin selección */
    }
    decir('No se pudo copiar solo. El prompt quedó seleccionado: cópialo con Ctrl y C.');
  }

  // ---- borrar un «mío»
  async function borrar(p: Prompt) {
    try {
      await borrarMio(p.id);
    } catch (e) {
      // «no es tuyo» = ya no existe (otra pestaña lo borró): igual se quita. Cualquier otro fallo se dice, y el prompt se queda
      if (codigoDe(e) !== 'no_es_tuyo') {
        setNota({ donde: 'detalle', tipo: 'error', texto: `No pudimos borrarlo. ${textoDe(e)}` });
        return;
      }
    }
    fijados.olvidar(p.id);
    setMios(l => l.filter(x => x.id !== p.id));
    setSel(null);
    setNota(null);
    setPaso(1);
    decir(`Borraste «${p.titulo}».`);
  }

  const enMios = ambito === 'mios';
  const sinMios = enMios && mios.length === 0;
  const sinCasa = !enMios && casa.length === 0;

  return (
    <div ref={raiz}>
      {/* en celular, los dos paneles son dos pasos */}
      <div role="group" aria-label="Pasos" className="mb-3.5 grid grid-cols-2 gap-2 min-[960px]:hidden">
        {(
          [
            [1, 'Elige', 'Busca o filtra'],
            [2, 'Úsalo', 'Copiar o llevar'],
          ] as const
        ).map(([n, t, s]) => (
          <button
            key={n}
            type="button"
            aria-current={paso === n ? 'step' : undefined}
            onClick={() => setPaso(n)}
            className={unir(
              'flex min-h-14 cursor-pointer items-center gap-2.5 rounded-boton border px-3.5 text-left text-sm font-medium',
              paso === n ? 'border-campo bg-elevada text-texto' : 'border-linea bg-transparent text-secundario hover:border-campo hover:text-texto',
            )}
          >
            <span
              aria-hidden="true"
              className={unir(
                'grid size-7 shrink-0 place-items-center rounded-pildora border-[1.5px] font-titulo text-sm font-bold',
                paso === n ? 'border-ambar-claro text-ambar-claro' : 'border-campo text-secundario',
              )}
            >
              {n}
            </span>
            <span>
              <b className="block font-medium">{t}</b>
              <small className="block text-xs font-normal text-secundario">{s}</small>
            </span>
          </button>
        ))}
      </div>

      <div className="min-[960px]:grid min-[960px]:h-[max(980px,calc(100dvh-4rem))] min-[960px]:grid-cols-[minmax(360px,440px)_minmax(0,1fr)] min-[960px]:gap-6">
        {/* ---------- izquierda: elegir ---------- */}
        <section
          aria-labelledby="bib-h-lista"
          className={unir(
            'min-w-0 flex-col rounded-grande border border-linea bg-superficie p-4 min-[960px]:min-h-0 min-[960px]:p-6',
            paso === 2 ? 'hidden min-[960px]:flex' : 'flex',
          )}
        >
          <div className="mb-2.5 flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h3 id="bib-h-lista" ref={tituloLista} tabIndex={-1} className="m-0 font-titulo text-titulo-sm font-bold">
              Elige un prompt
            </h3>
            <span className="inline-flex min-h-6 items-center rounded-pildora border border-linea bg-hundido px-2.5 text-xs font-medium text-secundario tabular-nums">
              {lista.length} en total
            </span>
          </div>

          <div role="group" aria-label="De quién son los prompts" className="mb-3 grid grid-cols-2 gap-1 rounded-boton border border-linea bg-hundido p-1">
            {(
              [
                ['casa', 'De la casa', casa.length],
                ['mios', 'Míos', mios.length],
              ] as const
            ).map(([clave, rotulo, n]) => (
              <button
                key={clave}
                type="button"
                aria-pressed={ambito === clave}
                onClick={() => cambiarAmbito(clave)}
                className={unir(
                  'flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-medio border-0 text-sm font-medium',
                  ambito === clave ? 'bg-elevada text-texto' : 'bg-transparent text-secundario hover:text-texto',
                )}
              >
                {rotulo}{' '}
                <em className="text-xs font-normal not-italic text-secundario tabular-nums">{n}</em>
              </button>
            ))}
          </div>

          <Fijados
            items={fijadosVivos}
            tope={tope}
            abierto={actual?.id ?? null}
            alAbrir={abrirFijado}
            alMover={moverFijado}
            alQuitar={quitarFijado}
            tituloRef={tituloFijados}
            nota={nota?.donde === 'franja' ? <NotaPin nota={nota} /> : undefined}
          />

          {!sinMios && !sinCasa && (
            <>
              <div className="flex items-center gap-2.5 rounded-medio border border-campo bg-elevada pr-1 pl-3 has-focus-visible:outline-2 has-focus-visible:outline-offset-3 has-focus-visible:outline-ambar-claro">
                <Icono nombre="buscar" className="text-secundario" />
                <input
                  type="search"
                  aria-label="Buscar un prompt"
                  placeholder="Busca por tema, título o etiqueta"
                  autoComplete="off"
                  value={filtro.q}
                  onChange={e => filtrarPor({ ...filtro, q: e.target.value })}
                  className="min-h-11 min-w-0 flex-1 border-0 bg-transparent text-sm text-texto outline-none placeholder:text-secundario [&::-webkit-search-cancel-button]:hidden"
                />
                {filtro.q && (
                  <button
                    type="button"
                    aria-label="Borrar la búsqueda"
                    onClick={() => {
                      filtrarPor({ ...filtro, q: '' });
                      porEnfocar.current = () => enElDom('input[type="search"]');
                    }}
                    className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-medio border-0 bg-transparent p-0 text-secundario hover:bg-activa hover:text-texto"
                  >
                    <Icono nombre="cerrar" />
                  </button>
                )}
              </div>

              <div role="group" aria-label="Categoría" className="mt-3 flex flex-wrap gap-2">
                {chips.map(c => (
                  <button
                    key={c.clave}
                    type="button"
                    aria-pressed={filtro.categoria === c.clave}
                    onClick={() => filtrarPor({ ...filtro, categoria: c.clave })}
                    className={unir(
                      'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-medio border px-3.5 text-sm text-texto',
                      filtro.categoria === c.clave ? 'border-campo bg-elevada' : 'border-linea bg-transparent hover:border-campo',
                    )}
                  >
                    {c.nombre}{' '}
                    <em className="text-secundario not-italic tabular-nums">{c.n}</em>
                  </button>
                ))}
                {filtro.etiqueta && (
                  <button
                    type="button"
                    aria-label={`Quitar la etiqueta ${filtro.etiqueta}`}
                    onClick={() => filtrarPor({ ...filtro, etiqueta: '' })}
                    className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-medio border border-campo bg-elevada px-3.5 text-sm text-texto"
                  >
                    #{filtro.etiqueta}
                    <Icono nombre="cerrar" className="size-4" />
                  </button>
                )}
              </div>

              <div className="mt-1 flex min-h-11 items-center justify-between gap-2">
                <p aria-live="polite" className="m-0 text-xs text-secundario">
                  {resumenDeLista(visibles.length, filtro, categorias)}
                </p>
                {hayFiltro(filtro) && (
                  <button type="button" className={BOTON_TEXTO} onClick={() => filtrarPor(SIN_FILTRO)}>
                    Quitar filtros
                  </button>
                )}
              </div>
            </>
          )}

          {visibles.length > 0 && (
            <ul
              aria-label="Prompts de la Biblioteca"
              className="m-0 -mx-2 flex list-none flex-col gap-1.5 p-0 px-2 min-[960px]:min-h-0 min-[960px]:flex-1 min-[960px]:overflow-y-auto min-[960px]:pb-4 min-[960px]:[mask-image:linear-gradient(to_bottom,black_calc(100%_-_22px),transparent)]"
            >
              {visibles.map(p => {
                const esActual = p.id === actual?.id;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      data-id={p.id}
                      aria-current={esActual ? 'true' : undefined}
                      tabIndex={p.id === paradaDeTab ? 0 : -1}
                      onFocus={() => setFoco(p.id)}
                      onKeyDown={teclaFila}
                      onClick={() => elegir(p.id)}
                      className={unir(
                        'flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-boton border px-3 py-2.5 text-left text-texto',
                        esActual ? 'border-campo bg-elevada' : 'border-transparent bg-transparent hover:bg-elevada',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={unir(
                          'grid size-10 shrink-0 place-items-center rounded-medio',
                          esActual ? 'bg-aviso-fondo text-ambar-claro' : 'bg-hundido text-secundario',
                        )}
                      >
                        <Icono nombre={iconoDe(p.categoria)} />
                      </span>
                      <span className="block min-w-0 flex-1">
                        <b className="block text-sm leading-snug font-semibold">{p.titulo}</b>
                        <small className="line-clamp-2 block text-xs leading-snug text-secundario">{p.para_que || p.prompt}</small>
                      </span>
                      {fijados.ids.includes(p.id) && (
                        <>
                          <Icono nombre="fijar" className="size-5 text-ambar-claro" />
                          <span className="sr-only">Fijado</span>
                        </>
                      )}
                      <Icono nombre="derecha" className="shrink-0 text-secundario min-[960px]:hidden" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {sinMios && <p className="m-0 flex-1 px-1 py-3 text-sm text-secundario">Todavía no guardas ninguno. Arma uno con COI y pulsa «Guardar».</p>}
          {sinCasa && <p className="m-0 flex-1 px-1 py-3 text-sm text-secundario">Todavía no hay prompts de la casa.</p>}
          {!sinMios && !sinCasa && visibles.length === 0 && <p className="m-0 flex-1 px-1 py-3 text-sm text-secundario">Nada coincide con lo que buscas.</p>}

          {/* siempre: en un celular el panel de la derecha (donde también hay un enlace a COI) es el paso 2, y este es el que se ve */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-boton border border-linea bg-hundido px-3.5 py-3">
            <p className="m-0 min-w-36 flex-1 text-sm text-secundario">
              <b className="block font-semibold text-texto">¿No encuentras el tuyo?</b>
              Diséñalo con COI.
            </p>
            <a href={RUTA_COI} className={BOTON_MEDIO}>
              Ir a COI
              <Icono nombre="derecha" />
            </a>
          </div>
        </section>

        {/* ---------- derecha: usarlo ---------- */}
        <section
          aria-labelledby="bib-detalle"
          className={unir(
            'min-w-0 flex-col rounded-grande border border-linea bg-superficie p-4 min-[960px]:min-h-0 min-[960px]:overflow-y-auto min-[960px]:p-6',
            paso === 1 ? 'hidden min-[960px]:flex' : 'flex',
          )}
        >
          {actual ? (
            <Detalle
              p={actual}
              categoria={nombreDe(actual.categoria)}
              fijado={fijados.ids.includes(actual.id)}
              copiado={copiado === actual.id}
              nota={nota?.donde === 'detalle' ? <NotaPin nota={nota} /> : undefined}
              alVolver={() => {
                setPaso(1);
                porEnfocar.current = () => enElDom('button[data-id]', e => e.dataset.id === actual.id);
              }}
              alAlternarPin={() => alternarPin(actual)}
              alCopiar={() => void copiar(actual)}
              alBorrar={() => setABorrar(actual)}
              alEtiquetar={t => {
                filtrarPor({ q: '', categoria: TODAS, etiqueta: t });
                decir(`Mostrando los prompts con la etiqueta ${t}.`);
              }}
            />
          ) : sinMios ? (
            <Vacio
              icono="personaje"
              titulo="Aquí vivirán tus prompts"
              texto="Lo que guardes desde COI aparecerá aquí. Solo tú lo verás: no se mezcla con los de la casa ni lo ve nadie más."
              accion={
                <a href={RUTA_COI} className={BOTON_MEDIO}>
                  Ir a COI
                  <Icono nombre="derecha" />
                </a>
              }
            />
          ) : sinCasa ? (
            <Vacio
              icono="biblioteca"
              titulo="Todavía no hay prompts de la casa"
              texto="Los estamos preparando. Mientras tanto puedes diseñar el tuyo con COI."
              accion={
                <a href={RUTA_COI} className={BOTON_MEDIO}>
                  Ir a COI
                  <Icono nombre="derecha" />
                </a>
              }
            />
          ) : (
            <Vacio
              icono="buscar"
              titulo="No encontramos ese prompt"
              texto="Prueba con otra palabra o quita los filtros. Si lo que buscas no está, lo puedes diseñar tú con COI: escribes lo que necesitas y te armamos el prompt."
              accion={
                <div className="flex flex-wrap gap-2.5">
                  <a href={RUTA_COI} className={claseBoton('principal')}>
                    Diseñar uno con COI
                    <Icono nombre="derecha" />
                  </a>
                  <Boton nivel="secundario" onClick={() => filtrarPor(SIN_FILTRO)}>
                    Quitar filtros
                  </Boton>
                </div>
              }
            />
          )}
        </section>
      </div>

      <Confirmar
        abierto={aBorrar !== null}
        alCambiar={a => !a && setABorrar(null)}
        titulo="¿Borrar este prompt?"
        descripcion={`«${aBorrar?.titulo ?? ''}» se quita de tu Biblioteca y de tus fijados. No se puede deshacer.`}
        confirmar="Borrar"
        peligro
        focoDeRespaldo={tituloLista}
        alConfirmar={() => {
          const p = aBorrar;
          if (p) void borrar(p);
        }}
      />

      {/* anuncios para lectores de pantalla: copiado, fijado, borrado… (nada de esto mueve el foco) */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {anuncio}
      </div>
    </div>
  );
}

/** Un aviso o un error sobre los fijados. El error es una alerta; el aviso (el tope) es un estado, y no mueve el foco. */
function NotaPin({ nota }: { nota: Nota }) {
  return (
    <div className="mt-2.5">
      <Aviso tipo={nota.tipo}>{nota.texto}</Aviso>
    </div>
  );
}

interface PropsDetalle {
  p: Prompt;
  categoria: string;
  fijado: boolean;
  copiado: boolean;
  nota?: ReactNode;
  alVolver: () => void;
  alAlternarPin: () => void;
  alCopiar: () => void;
  alBorrar: () => void;
  alEtiquetar: (t: string) => void;
}

function Detalle({ p, categoria, fijado, copiado, nota, alVolver, alAlternarPin, alCopiar, alBorrar, alEtiquetar }: PropsDetalle) {
  const llevar = urlDeLlevar(p);
  const partes = partesDe(p.prompt);
  const esMio = p.origen !== undefined;
  const conHuecos = partes.some(x => x.hueco);
  // el ámbar es «Llevar a la caja» si existe y «Copiar» si no (uno solo por pantalla)
  const copiarEsPrincipal = llevar === null;
  const destino = llevar
    ? `Se abre el Inicio en la pestaña ${pestanaDe(p.lleva_a!)} con este prompt ya puesto. Llevarlo no gasta créditos; crear sí, como siempre.`
    : sePuedeLlevar(p)
      ? 'Es muy largo para llevarlo a la caja: cópialo y pégalo donde lo vayas a usar.'
      : 'Cópialo y pégalo donde lo vayas a usar.';
  return (
    <div className="flex min-h-full flex-col">
      <button type="button" className={unir(BOTON_TEXTO, '-ml-3 mb-1.5 self-start min-[960px]:hidden')} onClick={alVolver}>
        <Icono nombre="volver" />
        Volver a la lista
      </button>

      <div className="mb-4.5 flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex min-h-7 items-center gap-2 rounded-pildora border border-linea bg-hundido pr-3 pl-2 text-xs font-medium text-secundario">
            <Icono nombre={iconoDe(p.categoria)} className="size-4" />
            {categoria || 'Sin categoría'}
          </span>
          <button
            type="button"
            aria-pressed={fijado}
            aria-label={`${fijado ? 'Quitar de fijados' : 'Fijar'} «${p.titulo}»`}
            onClick={alAlternarPin}
            className={unir(
              'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-boton border px-4 text-sm font-medium text-texto transition-colors',
              fijado ? 'border-ambar-hondo bg-aviso-fondo hover:border-ambar' : 'border-campo bg-transparent hover:border-secundario hover:bg-elevada',
            )}
          >
            <Icono nombre="fijar" className={unir(fijado && 'fill-current text-ambar-claro')} />
            {fijado ? 'Quitar de fijados' : 'Fijar'}
          </button>
        </div>
        {nota}
        <h3 id="bib-detalle" tabIndex={-1} className="m-0 font-titulo text-titulo-md font-bold [overflow-wrap:anywhere]">
          {p.titulo}
        </h3>
      </div>

      <div className="mb-4.5">
        <div className="flex flex-wrap gap-2.5">
          {llevar && (
            <a href={llevar} className={claseBoton('principal')}>
              <Icono nombre="llevar" />
              Llevar a la caja
            </a>
          )}
          <button
            type="button"
            aria-label={copiado ? `Copiado: ${p.titulo}` : `Copiar el prompt «${p.titulo}»`}
            onClick={alCopiar}
            className={copiado ? BOTON_LISTO : claseBoton(copiarEsPrincipal ? 'principal' : 'secundario')}
          >
            <Icono nombre={copiado ? 'listo' : 'copiar'} />
            {copiado ? 'Copiado' : 'Copiar'}
          </button>
          {esMio && (
            <Boton nivel="peligro" aria-label={`Borrar «${p.titulo}»`} onClick={alBorrar}>
              Borrar
            </Boton>
          )}
        </div>
        <p className="m-0 mt-2.5 text-xs text-secundario">{destino}</p>
      </div>

      {p.para_que && (
        <div className="mb-4.5">
          <h4 className={TITULO_DE_SECCION}>Para qué sirve</h4>
          <p className="m-0 max-w-[64ch] text-sm leading-relaxed">{p.para_que}</p>
        </div>
      )}

      <div className="mb-4.5">
        <h4 className={TITULO_DE_SECCION}>El prompt</h4>
        <div id="bib-prompt" className="rounded-grande border border-linea bg-hundido px-4 py-3.5 text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
          {partes.map((x, i) =>
            x.hueco ? (
              <span key={i} className="rounded-chico bg-aviso-fondo px-1 text-ambar-claro">
                {x.texto}
              </span>
            ) : (
              <span key={i}>{x.texto}</span>
            ),
          )}
        </div>
        {conHuecos && <p className="m-0 mt-2 text-xs text-secundario">Cambia lo que está entre [corchetes] por lo tuyo antes de usarlo.</p>}
      </div>

      {p.etiquetas.length > 0 && (
        <div className="mb-4.5">
          <h4 className={TITULO_DE_SECCION}>Etiquetas</h4>
          <div className="flex flex-wrap gap-2">
            {p.etiquetas.map(t => (
              <button
                key={t}
                type="button"
                aria-label={`#${t}: ver los prompts con esa etiqueta`}
                onClick={() => alEtiquetar(t)}
                className="inline-flex min-h-11 cursor-pointer items-center rounded-medio border border-linea bg-transparent px-3.5 text-sm text-enlace hover:border-campo hover:text-texto"
              >
                #{t}
              </button>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

function Vacio({ icono, titulo, texto, accion }: { icono: NombreIcono; titulo: string; texto: string; accion: ReactNode }) {
  return (
    <div className="flex max-w-[56ch] flex-col items-start gap-2.5 py-2">
      <Icono nombre={icono} className="size-8 text-secundario" />
      <h3 id="bib-detalle" tabIndex={-1} className="m-0 font-titulo text-titulo-sm font-bold">
        {titulo}
      </h3>
      <p className="m-0 text-sm leading-relaxed text-secundario">{texto}</p>
      <div className="mt-1.5">{accion}</div>
    </div>
  );
}
