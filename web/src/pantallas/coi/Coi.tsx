// /estudio/coi/ — COI: Contexto · Objetivo · Instrucciones (dirección A del lienzo, «Conversación»: una columna, un cuadro grande y
// tres tarjetas plegables). Un chat de UNA sola entrada: la persona escribe una vez y la IA responde una vez con el COI.
//
// Gratis por ahora, con un tope de 3 al día (día de México). Lo cuenta el SERVIDOR (`GET /api/coi/estado`): la web solo lo enseña, y
// «Faltan X h Y min» sale de `renueva_en_s`, nunca del reloj del navegador. Solo cuentan las respuestas terminadas.
//
// Privacidad: lo que la persona escribe y lo que responde la IA NO se guardan, ni aquí (nada de localStorage ni sessionStorage: el
// texto vive en el estado de React y se va con la pestaña) ni en el servidor. Solo se guarda el COI que ella decida guardar, con
// «Guardar», y solo en su Biblioteca. Las instrucciones del modelo viven solo en el servidor: esta pantalla no las conoce.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { Migas, type Miga } from '../../marca/Migas';
import { buscar, urlDeInicio, type Lugar } from '../../marca/menu';
import { useTituloPestana } from '../../nucleo/useTituloPestana';
import { Boton } from '../../ui/Boton';
import { CuadroDeTexto } from '../../ui/CuadroDeTexto';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import { BloqueAgotado, BloqueArmando, BloqueEnCurso, BloqueFalla, BloqueNoDisponible } from './Avisos';
import { GuardarHoja } from './GuardarHoja';
import { IconoCoi } from './IconosCoi';
import { Resultado, ENLACE_BOTON, type Plegados } from './Resultado';
import { copiarTexto, seleccionar } from './copiar';
import {
  armarCoi,
  claveAleatoria,
  contadorTexto,
  falloDe,
  largo,
  MAX_TEXTO,
  puntitos,
  textoDeBloque,
  textoTodo,
  type ClaveBloque,
  type Coi as CoiRespuesta,
  type Fallo,
} from './logica';
import { useEstadoUso } from './useEstadoUso';

const EJEMPLOS = [
  'Un guion para presentar un producto en 30 segundos',
  'Un prompt para resumir un artículo largo en 5 ideas',
  'Ideas de imágenes para una campaña de verano',
  'Investigar a la competencia de mi negocio',
];

/** Dónde está COI en el mapa (marca/menu.ts): de aquí salen sus migas «Central › Distrito › COI». */
const LUGAR: Lugar = { area: 'central', grupo: 'distrito', pantalla: 'coi' };

const PLACEHOLDER = 'Escribe aquí. Por ejemplo: «un guion para presentar un producto en 30 segundos».';
const PLACEHOLDER_AGOTADO = 'Vuelve cuando se renueven tus usos para armar otro COI.';

/** Si el servidor no contesta en este tiempo (él mismo corta a los 24 s, la Lambda a los 29 y la puerta a los 30), se deja de esperar. */
const ESPERA_MAX_MS = 45_000;
const COPIADO_MS = 2200;
const TODOS_ABIERTOS: Plegados = { ctx: true, obj: true, ins: true };

interface Resultado1 {
  coi: CoiRespuesta;
  idioma: 'es' | 'en';
  /** Cuántos resultados van en esta sesión: cambia con cada uno, y con él la clave de guardado. */
  n: number;
  clave: string;
}

const esAbortada = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export function Coi() {
  const { estado, error: errorEstado, recargar, poner } = useEstadoUso();
  // el texto vive SOLO aquí: ningún efecto lo guarda en el navegador
  const [texto, setTexto] = useState('');
  const [pidiendo, setPidiendo] = useState(false);
  const [resultado, setResultado] = useState<Resultado1 | null>(null);
  const [fallo, setFallo] = useState<Fallo | null>(null);
  const [errCampo, setErrCampo] = useState<string | null>(null);
  const [abiertos, setAbiertos] = useState<Plegados>(TODOS_ABIERTOS);
  const [copiado, setCopiado] = useState('');
  const [hojaAbierta, setHojaAbierta] = useState(false);
  const [guardado, setGuardado] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState('');

  const area = useRef<HTMLTextAreaElement>(null);
  const entrada = useRef<HTMLElement>(null);
  const tituloRes = useRef<HTMLHeadingElement>(null);
  const aviso = useRef(0);
  const temporizadorCopia = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelar = useRef<AbortController | null>(null);
  const enVuelo = useRef(false);
  const contados = useRef(0);
  const vivo = useRef(true);

  useTituloPestana(pidiendo ? 'Armando tu COI' : null);

  // al irse la pantalla: nada queda corriendo
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
      cancelar.current?.abort();
      if (temporizadorCopia.current) clearTimeout(temporizadorCopia.current);
    };
  }, []);

  // lo que se dice al lector de pantalla (un texto igual al anterior se vuelve a decir: el espacio final lo hace «nuevo»)
  const decir = (mensaje: string) => {
    aviso.current += 1;
    setAnuncio(mensaje + (aviso.current % 2 ? '' : ' '));
  };

  // llegó un COI: el foco va a su encabezado, salvo que la persona ya se haya ido a otra parte de la página
  const numero = resultado?.n ?? 0;
  useEffect(() => {
    if (numero === 0) return;
    const a = document.activeElement;
    if (!a || a === document.body || entrada.current?.contains(a)) tituloRes.current?.focus();
  }, [numero]);

  const tope = estado?.tope ?? 3;
  const quedan = estado?.quedan ?? tope;
  const agotado = estado !== null && estado.quedan <= 0;
  const enCurso = estado?.en_curso === true;
  const largoTexto = largo(texto.trim());
  const demasiado = largoTexto > MAX_TEXTO;
  const moderacion = fallo?.codigo === 'moderacion';
  // lo que sale en el cuadro de «falló»: todo menos lo que ya tiene su sitio (la moderación junto al cuadro, «otra en curso» y «ya usaste los 3»,
  // que salen del estado del servidor). Un `muy_largo` o `vacio` del servidor, que el cliente ya evita, se dice aquí por si se cuelan
  const falloDeArmar = fallo && !['moderacion', 'en_curso', 'agotado'].includes(fallo.codigo) ? fallo : null;
  const apagado = estado === null || agotado || enCurso || demasiado;
  const verEjemplos = !texto.trim() && !agotado && !pidiendo;
  const sinCargar = estado === null;

  const migas = useMemo<Miga[]>(() => {
    const h = buscar(LUGAR);
    if (!h) return [];
    return [
      {
        clave: 'area',
        titulo: h.area.titulo,
        icono: h.area.icono,
        rotulo: `Ir al mapa para cambiar de área (ahora: ${h.area.titulo})`,
        href: urlDeInicio(LUGAR, 'mapa'),
      },
      {
        clave: 'grupo',
        titulo: h.grupo.titulo,
        icono: h.grupo.icono,
        rotulo: `Ir a las opciones de ${h.area.titulo} (ahora: ${h.grupo.titulo})`,
        href: urlDeInicio(LUGAR, 'grupos'),
      },
      { clave: 'pantalla', titulo: h.pantalla.titulo, icono: h.pantalla.icono, actual: true },
    ];
  }, []);

  // por qué el botón está apagado: lo lee el lector de pantalla desde el propio botón
  const porQueApagado = demasiado
    ? 'coi-largo'
    : agotado
      ? 'coi-agota'
      : enCurso
        ? 'coi-curso'
        : sinCargar
          ? 'coi-cont'
          : undefined;
  const describeCampo =
    [
      errCampo && 'coi-err',
      demasiado && 'coi-largo',
      moderacion && 'coi-mod',
      agotado && 'coi-agota',
      enCurso && 'coi-curso',
      'coi-priv',
    ]
      .filter(Boolean)
      .join(' ') || undefined;

  function alEscribir(valor: string) {
    setTexto(valor);
    setErrCampo(null);
    // un error de la entrada anterior ya no dice nada de lo que se está escribiendo
    if (fallo && fallo.codigo !== 'en_curso') setFallo(null);
  }

  function alTeclear(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void armar();
    }
  }

  function elegirEjemplo(t: string) {
    setTexto(t);
    setErrCampo(null);
    setFallo(null);
    // el ejemplo desaparece al escribir: el foco se va al cuadro ANTES de que el botón se desmonte
    area.current?.focus();
  }

  async function armar() {
    // apagado no actúa (el propio botón dice por qué); `enVuelo` cierra el doble clic antes de que React pinte «Armando…»
    if (enVuelo.current || pidiendo || estado === null || agotado || enCurso) return;
    const limpio = texto.trim();
    if (!limpio) {
      setErrCampo('Escribe primero qué necesitas, aunque sea en una frase.');
      area.current?.focus();
      return;
    }
    if (largo(limpio) > MAX_TEXTO) return;
    enVuelo.current = true;
    setPidiendo(true);
    setFallo(null);
    setErrCampo(null);
    decir('Armando tu COI…');
    const control = new AbortController();
    cancelar.current = control;
    const plazo = setTimeout(() => control.abort(), ESPERA_MAX_MS);
    try {
      const r = await armarCoi(limpio, control.signal);
      contados.current += 1;
      setResultado({ coi: r.coi, idioma: r.idioma, n: contados.current, clave: claveAleatoria() });
      setAbiertos(TODOS_ABIERTOS);
      setGuardado(null);
      setCopiado('');
      poner({ tope: r.tope, usos: r.usos, quedan: r.quedan, renueva_en_s: r.renueva_en_s, se_renueva: r.se_renueva, en_curso: false });
      decir(
        r.coi.estructura_ok
          ? 'Tu COI está listo, en tres bloques: contexto, objetivo e instrucciones.'
          : 'Tu COI está listo. Te lo dejamos completo, en un solo bloque.',
      );
    } catch (e) {
      if (!vivo.current) return; // la pantalla se fue
      const f = esAbortada(e)
        ? ({ codigo: 'sin_conexion', texto: 'No recibimos respuesta. Revisa tu conexión e inténtalo otra vez.' } satisfies Fallo)
        : falloDe(e);
      setFallo(f);
      if (f.codigo === 'agotado') {
        poner({ quedan: 0, en_curso: false, ...(f.renueva_en_s !== undefined ? { renueva_en_s: f.renueva_en_s } : {}), ...(f.se_renueva ? { se_renueva: f.se_renueva } : {}) });
      } else if (f.codigo === 'en_curso') {
        poner({ en_curso: true });
      }
      // el contador es del servidor: tras cualquier fallo se le vuelve a preguntar cuántos quedan
      void recargar();
      // los cuadros de error se anuncian solos (role="alert"); a la moderación se le lleva el foco al cuadro, que es lo que hay que corregir
      if (f.codigo === 'moderacion') area.current?.focus();
    } finally {
      clearTimeout(plazo);
      enVuelo.current = false;
      if (vivo.current) setPidiendo(false);
    }
  }

  async function copiar(clave: ClaveBloque | 'todo') {
    if (!resultado) return;
    const { coi, idioma } = resultado;
    const t = clave === 'todo' ? textoTodo(coi, idioma) : textoDeBloque(coi, clave, idioma);
    const cual = clave === 'todo' ? (coi.estructura_ok ? 'el COI completo' : 'tu COI') : `el bloque ${textoDeBloque(coi, clave, idioma).split('\n')[0]}`;
    if (await copiarTexto(t)) {
      setCopiado(clave);
      decir(`Copiado: ${cual}.`);
      if (temporizadorCopia.current) clearTimeout(temporizadorCopia.current);
      temporizadorCopia.current = setTimeout(() => {
        temporizadorCopia.current = null;
        setCopiado('');
      }, COPIADO_MS);
    } else {
      seleccionar(document.getElementById(clave === 'todo' ? 'coi-res' : `coi-bq-${clave}`)?.closest('section, article') ?? null);
      decir('No pudimos copiar solos. Dejamos el texto seleccionado: cópialo con Ctrl+C.');
    }
  }

  async function reintentar() {
    setFallo(null);
    const e = await recargar();
    if (e) area.current?.focus();
  }

  const soloLectura = pidiendo || agotado;
  const bordeError = Boolean(errCampo) || demasiado || moderacion;

  return (
    <div className="mx-auto w-full max-w-[1080px] px-4 pt-16 pb-14 sm:px-6">
      <header>
        <h1 className="m-0 text-center font-titulo text-titulo-lg font-extrabold tracking-[-0.02em] [overflow-wrap:anywhere]">
          <span className="texto-oro">Irremplazables</span>
        </h1>
        <Migas migas={migas} className="mt-3 flex justify-center" />
      </header>

      <main className="mx-auto mt-8 max-w-[760px]">
        <header className="mb-6">
          <h2 className="m-0 mb-2 font-titulo text-titulo-md font-bold">Diseña un prompt con COI</h2>
          <p className="m-0 max-w-[65ch] text-sm text-secundario sm:text-md">
            Describe con tus palabras lo que necesitas y te devolvemos un prompt bien armado, en tres bloques: Contexto, Objetivo e Instrucciones.
          </p>
        </header>

        <section ref={entrada} aria-labelledby="coi-lbl" className="flex flex-col gap-3">
          <label id="coi-lbl" htmlFor="coi-ta" className="text-md font-semibold">
            Cuéntale qué necesitas
          </label>
          <CuadroDeTexto
            ref={area}
            id="coi-ta"
            rows={5}
            value={texto}
            placeholder={agotado ? PLACEHOLDER_AGOTADO : PLACEHOLDER}
            readOnly={soloLectura}
            aria-disabled={agotado || undefined}
            aria-busy={pidiendo || undefined}
            aria-invalid={bordeError || undefined}
            aria-describedby={describeCampo}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            onChange={e => alEscribir(e.target.value)}
            onKeyDown={alTeclear}
            claseCuadro={unir(agotado && 'border-dashed border-linea! bg-hundido!', bordeError && !agotado && 'border-error!')}
            className={unir('min-h-32 sm:min-h-[152px]', agotado && 'cursor-default text-apagado placeholder:text-apagado', pidiendo && 'text-secundario')}
          />

          {errCampo && (
            <p id="coi-err" role="alert" className="m-0 flex items-start gap-2 text-sm text-error">
              <Icono nombre="aviso" className="mt-px size-5! shrink-0" />
              {errCampo}
            </p>
          )}
          {demasiado && (
            <p id="coi-largo" className="m-0 flex items-start gap-2 text-sm text-error">
              <Icono nombre="aviso" className="mt-px size-5! shrink-0" />
              Es muy largo: el máximo es de {MAX_TEXTO} caracteres y llevas {largoTexto}. Acórtalo para armar tu COI.
            </p>
          )}
          {moderacion && fallo && (
            <p id="coi-mod" role="alert" className="m-0 flex items-start gap-2 text-sm text-error">
              <Icono nombre="aviso" className="mt-px size-5! shrink-0" />
              <span className="text-texto">
                <b className="font-semibold">No pudimos usar ese texto.</b> {fallo.texto} Cuéntalo con otras palabras e inténtalo otra vez.
              </span>
            </p>
          )}

          {verEjemplos && (
            <div>
              <p id="coi-ej" className="m-0 mb-2 text-xs font-semibold uppercase tracking-[0.4px] text-secundario">
                Ejemplos para empezar
              </p>
              <ul aria-labelledby="coi-ej" className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
                {EJEMPLOS.map(e => (
                  <li key={e} className="flex">
                    <button
                      type="button"
                      onClick={() => elegirEjemplo(e)}
                      className="flex min-h-11 w-full cursor-pointer items-center rounded-medio border border-linea bg-transparent px-3.5 py-2 text-left text-sm leading-snug text-texto hover:border-campo hover:bg-elevada"
                    >
                      {e}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p id="coi-cont" aria-live="polite" aria-atomic="true" className="m-0 flex items-center gap-2.5 text-sm font-medium">
                {estado ? (
                  <>
                    <span aria-hidden="true" className="inline-flex gap-[5px]">
                      {puntitos(quedan, tope).map((lleno, i) => (
                        <i key={i} className={unir('block size-2.5 rounded-full border-[1.5px]', lleno ? 'border-texto bg-texto' : 'border-campo')} />
                      ))}
                    </span>
                    <span className="tabular-nums">{contadorTexto(quedan, tope)}</span>
                  </>
                ) : errorEstado ? null : (
                  <span className="text-secundario">Revisando cuántos te quedan…</span>
                )}
              </p>
              {estado && (
                <p className="m-0 text-xs text-secundario">
                  {agotado
                    ? 'Se renuevan a la medianoche, hora de México.'
                    : quedan === 1
                      ? 'Es el último de hoy. Solo cuentan los COI que terminan bien.'
                      : `${estado.gratis ? 'Gratis por ahora. ' : ''}Solo cuentan los COI que terminan bien.`}
                </p>
              )}
            </div>
            <Boton
              nivel="principal"
              apagado={apagado}
              trabajando={pidiendo && 'Armando…'}
              aria-describedby={porQueApagado}
              onClick={() => void armar()}
              className="w-full sm:w-auto"
              icono={pidiendo ? <span aria-hidden="true" className="size-[18px] rounded-full border-2 border-ambar-hondo border-t-tinta motion-safe:animate-spin" /> : null}
            >
              {resultado ? 'Armar otro COI' : 'Armar COI'}
            </Boton>
          </div>

          {errorEstado && sinCargar && <BloqueNoDisponible fallo={errorEstado} alReintentar={() => void reintentar()} />}
          {enCurso && !pidiendo && <BloqueEnCurso texto={fallo?.codigo === 'en_curso' ? fallo.texto : undefined} />}
          {pidiendo && <BloqueArmando />}
          {falloDeArmar && !pidiendo && <BloqueFalla fallo={falloDeArmar} />}
          {agotado && estado && !pidiendo && <BloqueAgotado tope={tope} renuevaEnS={estado.renueva_en_s} />}

          <p id="coi-priv" className="m-0 flex items-start gap-2 text-xs text-secundario">
            <Icono nombre="candado" className="mt-px size-[18px]! shrink-0" />
            No guardamos lo que escribes ni lo que te responde. Solo se guarda el COI que tú decidas guardar, y solo en tu Biblioteca.
          </p>
        </section>

        {resultado && (
          <Resultado
            coi={resultado.coi}
            idioma={resultado.idioma}
            abiertos={abiertos}
            alAlternar={c => setAbiertos(a => ({ ...a, [c]: !a[c] }))}
            alPlegarTodo={() =>
              setAbiertos(a => (a.ctx && a.obj && a.ins ? { ctx: false, obj: false, ins: false } : TODOS_ABIERTOS))
            }
            copiado={copiado}
            alCopiar={c => void copiar(c)}
            guardado={guardado}
            alGuardar={() => setHojaAbierta(true)}
            refTitulo={tituloRes}
          />
        )}

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-linea pt-4 text-secundario">
          <p className="m-0">¿Buscas uno que ya esté hecho?</p>
          <a href="/estudio/biblioteca/" className={unir(ENLACE_BOTON, 'no-underline')}>
            Mira la Biblioteca de prompts
            <IconoCoi nombre="flecha" />
          </a>
        </footer>

        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {anuncio}
        </p>
      </main>

      {resultado && (
        <GuardarHoja
          key={resultado.n}
          coi={resultado.coi}
          idioma={resultado.idioma}
          abierto={hojaAbierta}
          alCerrar={() => setHojaAbierta(false)}
          clave={resultado.clave}
          tope={tope}
          alGuardado={titulo => {
            setGuardado(titulo);
            setHojaAbierta(false);
            decir('Guardado en tu Biblioteca.');
          }}
        />
      )}
    </div>
  );
}
