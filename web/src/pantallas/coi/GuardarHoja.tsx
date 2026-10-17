// «Guardar»: la hoja chica que guarda el COI que le salió a la persona en SU Biblioteca («Míos», privado). Solo se guarda si pulsa
// «Guardar» aquí; guardar NO llama al modelo y NO gasta uno de los usos de hoy.
//
// El título viene prefijado con la primera frase del objetivo (editable, 80 como máximo) y la categoría arranca en «Guion y texto».
// Cada resultado trae su propia `clave` (32 hex, aleatoria): un reintento del mismo guardado la repite y el servidor devuelve el mismo
// registro en vez de crear otro (doble clic, un fallo de red a medias).
import { useId, useRef, useState, type FormEvent } from 'react';

import { ErrorApi } from '../../nucleo/api';
import { Aviso } from '../../ui/Aviso';
import { Boton } from '../../ui/Boton';
import { Campo } from '../../ui/Campo';
import { Dialogo } from '../../ui/Dialogo';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import {
  CATEGORIAS,
  guardarEnMios,
  largo,
  MAX_TITULO,
  primeraFrase,
  textoTodo,
  type Categoria,
  type Coi,
} from './logica';

export interface PropsGuardarHoja {
  coi: Coi;
  idioma: 'es' | 'en';
  abierto: boolean;
  alCerrar: () => void;
  /** La clave de este resultado (32 hex). */
  clave: string;
  /** Salió bien: el título con el que quedó guardado. */
  alGuardado: (titulo: string) => void;
  /** Cuántos usos de COI tiene la persona por día (para decir que guardar no gasta ninguno). */
  tope: number;
}

/** Un COI que pasa del tope de la Biblioteca se entregó bien (y contó): solo no cabe guardado. Sin nombrar el campo interno ni el tope.
 *  El botón que lo lleva es «Copiar todo», o «Copiar» si la respuesta no vino en tres bloques. */
const textoCoiLargo = (tresBloques: boolean) =>
  `Este COI es demasiado largo para guardarlo en tu Biblioteca. Cierra esta hoja y usa «${tresBloques ? 'Copiar todo' : 'Copiar'}» para llevártelo.`;

const CHIP =
  'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-pildora border border-linea px-4 text-sm text-texto ' +
  'hover:border-campo hover:bg-elevada has-checked:border-campo has-checked:bg-activa has-checked:font-semibold ' +
  'has-focus-visible:outline-2 has-focus-visible:outline-offset-3 has-focus-visible:outline-ambar-claro';

export function GuardarHoja({ coi, idioma, abierto, alCerrar, clave, alGuardado, tope }: PropsGuardarHoja) {
  const idForm = useId();
  const [titulo, setTitulo] = useState(() => primeraFrase(coi));
  const [categoria, setCategoria] = useState<Categoria>('guion');
  const [enviando, setEnviando] = useState(false);
  const [errTitulo, setErrTitulo] = useState<string | null>(null);
  const [error, setError] = useState<{ texto: string; lleno: boolean } | null>(null);
  const campo = useRef<HTMLInputElement>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    const limpio = titulo.trim();
    if (!limpio) {
      setErrTitulo('Ponle un título para encontrarlo después.');
      campo.current?.focus();
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const r = await guardarEnMios({ titulo: limpio, prompt: textoTodo(coi, idioma), categoria, clave });
      alGuardado(r.prompt.titulo || limpio);
    } catch (err) {
      const d = err instanceof ErrorApi && typeof err.detalle === 'object' && err.detalle !== null ? (err.detalle as { codigo?: unknown; campo?: unknown }) : {};
      const texto = err instanceof Error ? err.message : String(err);
      if (d.codigo === 'titulo_invalido') {
        // el texto del servidor, tal cual, junto al campo que hay que corregir
        setErrTitulo(texto);
        campo.current?.focus();
      } else {
        setError({ texto: d.codigo === 'muy_largo' && d.campo === 'prompt' ? textoCoiLargo(coi.estructura_ok) : texto, lleno: d.codigo === 'lleno' });
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo
      abierto={abierto}
      alCambiar={a => {
        if (!a && !enviando) alCerrar();
      }}
      titulo="Guardar en tu Biblioteca"
      descripcion={`Se guarda solo para ti, en «Míos». Guardar no gasta ninguno de tus ${tope} usos de hoy.`}
      focoInicial={campo}
      acciones={
        <>
          <Boton onClick={alCerrar} disabled={enviando}>
            Cancelar
          </Boton>
          <Boton nivel="principal" type="submit" form={idForm} trabajando={enviando && 'Guardando…'}>
            Guardar
          </Boton>
        </>
      }
    >
      <form id={idForm} onSubmit={e => void enviar(e)} className="flex flex-col gap-4" noValidate>
        <Campo
          ref={campo}
          etiqueta="Título"
          value={titulo}
          maxLength={MAX_TITULO}
          error={errTitulo}
          ayuda={`${largo(titulo)} de ${MAX_TITULO} caracteres`}
          autoComplete="off"
          onChange={e => {
            setTitulo(e.target.value);
            setErrTitulo(null);
          }}
        />
        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="mb-1 p-0 text-sm font-medium">Categoría</legend>
          <div className="flex flex-wrap gap-2">
            {CATEGORIAS.map(c => (
              <label key={c.clave} className={unir(CHIP)}>
                <input
                  type="radio"
                  name={`${idForm}-categoria`}
                  value={c.clave}
                  checked={categoria === c.clave}
                  onChange={() => setCategoria(c.clave)}
                  className="sr-only"
                />
                {categoria === c.clave && <Icono nombre="listo" className="size-4!" />}
                {c.nombre}
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <Aviso tipo="error">
            <p className="m-0">{error.texto}</p>
            {error.lleno && (
              <a
                href="/estudio/biblioteca/?ver=mios"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center text-enlace underline underline-offset-4 hover:text-texto"
              >
                Abre tu Biblioteca en otra pestaña para borrar alguno
              </a>
            )}
          </Aviso>
        )}
      </form>
    </Dialogo>
  );
}
