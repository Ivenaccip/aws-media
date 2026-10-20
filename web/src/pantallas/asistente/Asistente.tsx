// /estudio/asistente/ — el Asistente de Automatizaciones: la persona cuenta con sus palabras qué quiere automatizar y la pantalla le
// devuelve un flujo de n8n, listo para descargar o para abrir en el Constructor.
//
// Por ahora el servidor corre en modo «prueba»: responde con flujos de EJEMPLO elegidos por las palabras del pedido (sin modelo, sin
// base de datos, sin costo). La pantalla lo dice, mientras `config.modo` sea «prueba». Lo que cambie cuando el servidor arme de
// verdad lo decide el servidor: aquí solo se ofrece escribir si `GET /api/automatiza/config` dice que está activo Y que es gratis.
//
// Privacidad: lo que la persona escribe vive solo en el estado de React: ningún efecto lo guarda en el navegador (el único
// almacenamiento de esta pantalla es el borrador del Constructor al «Abrir en el constructor», y ahí va el FLUJO, no el pedido).
//
// Foco: nunca cae a <body>. Al llegar el resultado va a su encabezado; al fallar por lo que se escribió (o porque hay que volver a
// escribirlo), al cuadro de texto; un fallo del servicio deja el foco donde estaba (en «Armar flujo»: moverlo justo cuando entra el
// aviso puede cortar su anuncio); los ejemplos mandan el foco al cuadro antes de desaparecer. Anuncios: una sola región viva; los
// cuadros de error se anuncian solos (role="alert") y pasarse del máximo se dice una vez, al cruzarlo.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { EncabezadoHoja } from '../../marca/EncabezadoHoja';
import { ErrorTresPartes } from '../../marca/ErrorTresPartes';
import type { Lugar } from '../../marca/menu';
import { useTituloPestana } from '../../nucleo/useTituloPestana';
import { Aviso } from '../../ui/Aviso';
import { Boton } from '../../ui/Boton';
import { CuadroDeTexto } from '../../ui/CuadroDeTexto';
import { Esqueleto } from '../../ui/Esqueleto';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import { EJEMPLOS } from '../constructor/modelo/ejemplos';
import type { FuenteAlmacen } from '../constructor/modelo/borrador';
import { Apagado, EsperaArmando, SinCobertura } from './Estados';
import { Resultado } from './Resultado';
import {
  CODIGOS_DEL_CUADRO,
  largo,
  PASOS_ESPERA,
  puedeOfrecer,
  textoContador,
  textoLargo,
  TEXTO_NO_DISPONIBLE,
  validarPedido,
  type CodigoFallo,
  type Fallo,
} from './logica';
import type { Navegar } from './traspaso';
import { useArmado } from './useArmado';

/** Dónde está el Asistente en el mapa (marca/menu.ts): de aquí salen sus migas «Automatizaciones › Distrito › Asistente». */
const LUGAR: Lugar = { area: 'automatizaciones', grupo: 'distrito', pantalla: 'asistente' };

const PLACEHOLDER =
  'Por ejemplo: cuando me llegue un correo de un cliente, que una IA le conteste y lo anote en una hoja de cálculo.';

/** Lo que se agrega a «Qué sigue» cuando el error no es de lo que se escribió. */
const SIGUE: Partial<Record<Fallo['codigo'], string>> = {
  no_encontrada: 'Escribe tu pedido de nuevo y pulsa «Armar flujo».',
  sin_conexion: 'Revisa tu conexión y pulsa «Armar flujo» otra vez: tu texto sigue en el cuadro.',
  // los que NO se arreglan con volver a pulsar ya: «Llegaste al límite de hoy» no puede seguir con «intentarlo otra vez»
  agotado: 'Vuelve mañana para armar otro flujo. Tu texto sigue en el cuadro mientras no cierres esta página.',
  en_curso: 'Cuando termine ese armado, pulsa «Armar flujo» otra vez. Tu texto sigue en el cuadro.',
  sin_saldo: 'Cuando recargues, pulsa «Armar flujo» otra vez. Tu texto sigue en el cuadro.',
  no_nube: 'Abre el Asistente desde el sitio del estudio, no desde tu computadora.',
};
const SIGUE_POR_OMISION = 'Tu texto sigue en el cuadro. Pulsa «Armar flujo» para intentarlo otra vez.';

/** Los fallos que mandan el foco al cuadro de texto: lo que hay que corregir es lo que se escribió (o volver a escribirlo). */
const PIDEN_EL_CUADRO: readonly CodigoFallo[] = [...CODIGOS_DEL_CUADRO, 'no_encontrada'];

/** El tope de escritura del cuadro: cuatro veces el máximo del servidor. Deja pasar un poco de más (para poder decir «Es muy largo») pero no
 *  millones de caracteres sin cortes, que congelaban el navegador al pintarlos. */
const VECES_EL_MAXIMO = 4;

/** Lo técnico del error, para el pliegue «Detalles técnicos» (sin repetir lo que ya se dijo en palabras de persona). */
const detalleTecnico = (f: Fallo): string | null => (f.estado > 0 ? `HTTP ${f.estado} · ${f.codigo}` : null);

export interface PropsAsistente {
  /** Adónde se va después de pasar el flujo al Constructor. Sin esto, `location.assign`. Es para las pruebas. */
  ir?: Navegar;
  /** El almacenamiento del borrador del Constructor. Sin esto, `window.localStorage`. Es para las pruebas. */
  almacen?: FuenteAlmacen;
}

export function Asistente({ ir, almacen }: PropsAsistente = {}) {
  const { config, errorConfig, recargarConfig, fase, sinConexion, armar, descartarFallo } = useArmado();
  // el texto vive SOLO aquí: ningún efecto lo guarda en el navegador
  const [texto, setTexto] = useState('');
  const [errCampo, setErrCampo] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState('');
  const [reintentando, setReintentando] = useState(false);

  const area = useRef<HTMLTextAreaElement>(null);
  const botonArmar = useRef<HTMLButtonElement>(null);
  const entrada = useRef<HTMLDivElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const tituloRes = useRef<HTMLHeadingElement>(null);
  const aviso = useRef(0);
  /** Hay que mandar el foco a la pantalla en el próximo render (tras reintentar, cuando el cuadro de error se va). */
  const porEnfocar = useRef(false);

  const armando = fase.tipo === 'armando';
  const ofrecer = config !== null && puedeOfrecer(config);
  const maximo = config?.maximo ?? 0;
  const llevas = largo(texto.trim());
  const demasiado = ofrecer && llevas > maximo;
  const falloDelCuadro = fase.tipo === 'fallo' && CODIGOS_DEL_CUADRO.includes(fase.fallo.codigo) ? fase.fallo : null;
  const falloDeArmar = fase.tipo === 'fallo' && falloDelCuadro === null ? fase.fallo : null;
  const verEjemplos = ofrecer && !texto.trim() && !armando;
  const bordeError = Boolean(errCampo) || demasiado || falloDelCuadro !== null;

  useTituloPestana(armando ? 'Armando tu flujo' : fase.tipo === 'listo' ? 'Tu flujo está listo' : null);

  // lo que se dice al lector de pantalla cuando no es un cuadro de error (esos se anuncian solos). Un texto igual al anterior se vuelve
  // a decir: el espacio final lo hace «nuevo». La espera se anuncia desde el propio estado: una sola voz, sin efectos
  const decir = (mensaje: string) => {
    aviso.current += 1;
    setAnuncio(mensaje + (aviso.current % 2 ? '' : ' '));
  };
  const anuncioDeLaEspera = armando
    ? sinConexion
      ? 'Sin conexión. Seguimos intentando.'
      : `Armando tu flujo. ${PASOS_ESPERA[Math.min(fase.paso, PASOS_ESPERA.length - 1)]?.activo ?? 'Armando'}…`
    : '';

  // llegó el final de un armado: el resultado lleva el foco a su encabezado y un fallo, al cuadro (que es lo que hay que corregir);
  // salvo que la persona ya se haya ido a otra parte de la página
  useEffect(() => {
    if (fase.tipo !== 'listo' && fase.tipo !== 'sin_cobertura' && fase.tipo !== 'fallo') return;
    const a = document.activeElement;
    if (a && a !== document.body && !entrada.current?.contains(a)) return;
    if (fase.tipo === 'fallo') {
      // un fallo del servicio no tiene nada que corregir en el texto: el foco se queda donde estaba; solo si se había perdido (<body>: un
      // navegador que no enfoca el botón al hacerle clic) vuelve a «Armar flujo»
      if (PIDEN_EL_CUADRO.includes(fase.fallo.codigo)) area.current?.focus();
      else if (!a || a === document.body) botonArmar.current?.focus();
    } else tituloRes.current?.focus();
  }, [fase]);

  // tras «Reintentar» con éxito el cuadro de error desaparece: el foco va al cuadro de texto, o al título si hoy no se puede escribir
  useEffect(() => {
    if (!porEnfocar.current) return;
    porEnfocar.current = false;
    (area.current ?? titulo.current)?.focus();
  });

  function alEscribir(valor: string) {
    // pasarse del máximo se dice UNA vez, al cruzarlo (el párrafo «Es muy largo» no es región viva: cambia con cada letra)
    const ahora = largo(valor.trim());
    if (ofrecer && ahora > maximo && !demasiado) decir(textoLargo(maximo, ahora));
    setTexto(valor);
    setErrCampo(null);
    // un error del pedido anterior ya no dice nada de lo que se está escribiendo
    descartarFallo();
  }

  function elegirEjemplo(t: string) {
    setTexto(t);
    setErrCampo(null);
    descartarFallo();
    // el ejemplo desaparece al escribir: el foco se va al cuadro ANTES de que el botón se desmonte
    area.current?.focus();
  }

  function alTeclear(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      alArmar();
    }
  }

  function alArmar() {
    // apagado no actúa (el propio botón dice por qué); `armar` cierra el doble clic antes de que React pinte «Armando…»
    if (!config || !ofrecer || armando) return;
    const f = validarPedido(texto, config);
    if (f) {
      // lo muy largo ya se dice solo, junto al cuadro, mientras se escribe
      if (f.codigo !== 'largo') {
        setErrCampo(f.texto);
        area.current?.focus();
      }
      return;
    }
    setErrCampo(null);
    setAnuncio('');
    armar(texto.trim());
  }

  async function reintentar() {
    setReintentando(true);
    decir('Reintentando…');
    const c = await recargarConfig();
    if (c) porEnfocar.current = true;
    else decir('Sigue sin estar disponible. Inténtalo en unos minutos.');
    setReintentando(false);
  }

  const describeCampo =
    [errCampo && 'asis-err', demasiado && 'asis-largo', falloDelCuadro && 'asis-mod', 'asis-cuenta'].filter(Boolean).join(' ') || undefined;

  return (
    <div className="mx-auto w-full max-w-[1080px] px-4 pt-16 pb-14 sm:px-6">
      <EncabezadoHoja lugar={LUGAR} />

      <main className="mx-auto mt-8 max-w-[760px]">
        <header className="mb-6">
          <h2 ref={titulo} tabIndex={-1} className="m-0 mb-2 font-titulo text-titulo-md font-bold [overflow-wrap:anywhere]">
            Cuéntanos qué quieres automatizar
          </h2>
          <p className="m-0 max-w-[65ch] text-sm text-secundario sm:text-md">
            Lo escribes con tus palabras y te armamos un flujo que puedes descargar para n8n o abrir en el constructor.
          </p>
        </header>

        {config?.modo === 'prueba' && (
          <div className="mb-6">
            <Aviso>
              <b className="font-semibold">Prueba: por ahora armamos flujos de ejemplo.</b> Elegimos el que más se parece a tu pedido. No
              guardamos lo que escribes.
            </Aviso>
          </div>
        )}

        {config === null && errorConfig === null && <Esqueleto className="h-40 w-full" etiqueta="Revisando si el Asistente está disponible" />}

        {errorConfig && config === null && (
          <div className="flex flex-col gap-3">
            <ErrorTresPartes
              anunciar
              paso={errorConfig.texto}
              sigue="Revisa tu conexión y pulsa «Reintentar»."
              detalle={detalleTecnico(errorConfig)}
            />
            <div>
              <Boton trabajando={reintentando && 'Reintentando…'} onClick={() => void reintentar()}>
                Reintentar
              </Boton>
            </div>
          </div>
        )}

        {config !== null && !ofrecer && <Apagado texto={config.texto ?? TEXTO_NO_DISPONIBLE} />}

        {config !== null && ofrecer && (
          // un <div>, no una <section aria-labelledby>: tomaba su nombre del mismo <label> del campo y el lector decía la frase dos veces
          <div ref={entrada} className="flex flex-col gap-3">
            <label id="asis-lbl" htmlFor="asis-ta" className="text-md font-semibold">
              Cuéntale qué necesitas
            </label>
            <CuadroDeTexto
              ref={area}
              id="asis-ta"
              rows={5}
              maxLength={maximo * VECES_EL_MAXIMO}
              value={texto}
              placeholder={PLACEHOLDER}
              readOnly={armando}
              aria-busy={armando || undefined}
              aria-invalid={bordeError || undefined}
              aria-describedby={describeCampo}
              aria-keyshortcuts="Control+Enter Meta+Enter"
              onChange={e => alEscribir(e.target.value)}
              onKeyDown={alTeclear}
              claseCuadro={unir(bordeError && 'border-error!')}
              className={unir('min-h-32 sm:min-h-[152px]', armando && 'text-secundario')}
            />

            <p id="asis-cuenta" className={unir('m-0 text-xs tabular-nums', demasiado ? 'text-error' : 'text-secundario')}>
              {textoContador(texto, config)}
            </p>

            {errCampo && (
              <p id="asis-err" role="alert" className="m-0 flex items-start gap-2 text-sm text-error">
                <Icono nombre="aviso" className="mt-px size-5! shrink-0" />
                <span className="text-texto [overflow-wrap:anywhere]">{errCampo}</span>
              </p>
            )}
            {demasiado && (
              <p id="asis-largo" className="m-0 flex items-start gap-2 text-sm text-error">
                <Icono nombre="aviso" className="mt-px size-5! shrink-0" />
                <span className="text-texto">{textoLargo(maximo, llevas)}</span>
              </p>
            )}
            {falloDelCuadro && (
              <p id="asis-mod" role="alert" className="m-0 flex items-start gap-2 text-sm text-error">
                <Icono nombre="aviso" className="mt-px size-5! shrink-0" />
                <span className="text-texto [overflow-wrap:anywhere]">{falloDelCuadro.texto}</span>
              </p>
            )}

            {verEjemplos && (
              <div>
                <p id="asis-ej" className="m-0 mb-2 text-xs font-semibold uppercase tracking-[0.4px] text-secundario">
                  Ejemplos para empezar
                </p>
                <ul aria-labelledby="asis-ej" className="m-0 grid list-none grid-cols-1 gap-2 p-0">
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

            <div>
              <Boton
                ref={botonArmar}
                nivel={fase.tipo === 'listo' ? 'secundario' : 'principal'}
                apagado={demasiado}
                trabajando={armando && 'Armando…'}
                aria-describedby={demasiado ? 'asis-largo' : undefined}
                onClick={alArmar}
                className="w-full sm:w-auto"
                icono={
                  armando ? (
                    <span aria-hidden="true" className="size-[18px] rounded-full border-2 border-ambar-hondo border-t-tinta motion-safe:animate-spin" />
                  ) : null
                }
              >
                {fase.tipo === 'listo' ? 'Armar otro flujo' : 'Armar flujo'}
              </Boton>
            </div>

            {fase.tipo === 'armando' && <EsperaArmando paso={fase.paso} lugar={fase.lugar} desde={fase.desde} sinConexion={sinConexion} />}

            {falloDeArmar && (
              <ErrorTresPartes
                anunciar
                paso={falloDeArmar.texto}
                sigue={SIGUE[falloDeArmar.codigo] ?? SIGUE_POR_OMISION}
                detalle={detalleTecnico(falloDeArmar)}
              />
            )}
          </div>
        )}

        {ofrecer && fase.tipo === 'sin_cobertura' && <SinCobertura refTitulo={tituloRes} mensaje={fase.mensaje} faltan={fase.faltan} />}

        {ofrecer && fase.tipo === 'listo' && config && (
          <Resultado
            listo={fase.listo}
            modo={config.modo}
            refTitulo={tituloRes}
            alDecir={decir}
            {...(ir ? { ir } : {})}
            {...(almacen ? { almacen } : {})}
          />
        )}

        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {anuncioDeLaEspera || anuncio}
        </p>
      </main>
    </div>
  );
}
