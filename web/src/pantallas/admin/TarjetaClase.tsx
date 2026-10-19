// Una clase en la lista: su número y título, el chip de estado, lo que se sabe del video y sus acciones (subir el video, ver
// la vista previa, editar, archivar). La archivada es otra tarjeta, más chica, con «Restaurar».
//
// Todo lo que viene del servidor (título, resumen, nombre del archivo, error, liga) se pinta como TEXTO: nada de HTML crudo.
// La liga solo se vuelve enlace si es https; la URL firmada del video se usa para el <video> y no se enseña ni se guarda.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { Aviso } from '../../ui/Aviso';
import { Boton, claseBoton } from '../../ui/Boton';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import {
  aceptar,
  duracionLarga,
  etiquetaEstado,
  fechaLarga,
  ligaSegura,
  tamano,
  tieneVideo,
  urlDeVideo,
  type Clase,
  type LimitesClases,
} from './logicaClases';
import { useSubidaClase, type Progreso } from './useSubidaClase';

const CARTA = 'rounded-grande border border-linea bg-superficie p-4 sm:p-6';
const ENLACE = 'inline-flex min-h-11 items-center gap-1 text-sm text-enlace underline underline-offset-4 hover:text-texto';

type Tono = 'neutro' | 'subiendo' | 'listo' | 'falla';

const TONO: Record<Tono, string> = {
  neutro: 'border-linea text-secundario',
  subiendo: 'border-ambar-hondo bg-aviso-fondo text-texto',
  listo: 'border-linea bg-exito-fondo text-exito',
  falla: 'border-peligro-borde bg-peligro-fondo text-peligro-texto',
};

const tonoDe = (estado: string): Tono =>
  estado === 'subiendo' ? 'subiendo' : estado === 'subido' ? 'listo' : estado === 'error' ? 'falla' : 'neutro';

function Chip({ texto, tono }: { texto: string; tono: Tono }) {
  return (
    <span className={unir('inline-flex flex-none items-center rounded-pildora border px-3 py-0.5 text-xs font-medium whitespace-nowrap', TONO[tono])}>
      {texto}
    </span>
  );
}

export const idTituloDe = (c: Clase) => `clase-${c.id}-titulo`;
export const idEditarDe = (c: Clase) => `clase-${c.id}-editar`;

function Encabezado({ clase, chip }: { clase: Clase; chip: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <h3 id={idTituloDe(clase)} tabIndex={-1} className="m-0 min-w-0 flex-1 basis-48 text-md font-semibold [overflow-wrap:anywhere]">
        Clase {clase.numero} · {clase.titulo}
      </h3>
      {chip}
    </div>
  );
}

const Linea = ({ children }: { children: ReactNode }) => <p className="m-0 mt-1 text-xs text-secundario [overflow-wrap:anywhere]">{children}</p>;

function Datos({ clase }: { clase: Clase }) {
  const fecha = fechaLarga(clase.grabada_en);
  const enlace = ligaSegura(clase.liga);
  return (
    <>
      {fecha && <Linea>Grabada el {fecha}</Linea>}
      {clase.resumen && (
        <p className="m-0 mt-2 text-sm [overflow-wrap:anywhere]">
          <span className="text-secundario">Para qué sirve: </span>
          {clase.resumen}
        </p>
      )}
      {clase.liga &&
        (enlace ? (
          <a className={unir(ENLACE, 'mt-1')} href={enlace} target="_blank" rel="noopener noreferrer">
            Abrir la liga de referencia
            <Icono nombre="externo" />
          </a>
        ) : (
          // una liga que no es https no se vuelve enlace: se lee como texto
          <Linea>Liga de referencia: {clase.liga}</Linea>
        ))}
    </>
  );
}

/** Lo que se sabe del video ya subido: «Listo: 1 h 02 min · 1.4 GB». */
function lineaDelVideo(c: Clase): string {
  if (!tieneVideo(c)) return '';
  const partes = [c.duracion_s != null ? duracionLarga(c.duracion_s) : null, c.bytes ? tamano(c.bytes) : null].filter(Boolean);
  return c.duracion_s != null ? `Listo: ${partes.join(' · ')}` : `Subido: ${partes.join(' · ')}. Falta medir cuánto dura.`;
}

const textoDeProgreso = (p: Progreso) =>
  p.fase === 'permiso'
    ? 'Pidiendo permiso de subida…'
    : p.fase === 'subiendo'
      ? `Subiendo… ${p.pct} %`
      : p.fase === 'confirmando'
        ? 'Confirmando que el video llegó…'
        : 'Midiendo cuánto dura el video…';

// lo que el lector de pantalla oye al cambiar de fase (el porcentaje no se anuncia: cambiaría a cada rato)
const ANUNCIO: Record<Progreso['fase'], string> = {
  permiso: 'Pidiendo permiso de subida.',
  subiendo: 'Subiendo el video.',
  confirmando: 'Confirmando que el video llegó.',
  midiendo: 'Midiendo cuánto dura el video.',
};

type Video =
  | { tipo: 'cerrado' }
  | { tipo: 'pidiendo' }
  | { tipo: 'listo'; url: string }
  | { tipo: 'fallo'; texto: string };

const TEXTO_VIDEO_ROTO = 'No pudimos cargar el video. Pulsa «Ver video» otra vez para pedir una liga nueva.';

export interface PropsTarjetaClase {
  clase: Clase;
  limites: LimitesClases;
  /** Una respuesta del servidor con la clase al día. */
  alClase: (c: Clase) => void;
  alEditar: () => void;
  alArchivar: () => void;
}

export function TarjetaClase({ clase, limites, alClase, alEditar, alArchivar }: PropsTarjetaClase) {
  const idEstado = useId();
  const s = useSubidaClase(clase.id, limites, alClase);
  const [video, setVideo] = useState<Video>({ tipo: 'cerrado' });
  const pidiendoVideo = useRef(false);
  const reproductor = useRef<HTMLVideoElement>(null);

  // al abrirse la vista previa, el foco se va al reproductor (sus controles son del navegador)
  const hayVideoListo = video.tipo === 'listo';
  useEffect(() => {
    if (hayVideoListo) reproductor.current?.focus();
  }, [hayVideoListo]);

  async function verVideo() {
    if (video.tipo === 'listo') {
      setVideo({ tipo: 'cerrado' });
      return;
    }
    if (pidiendoVideo.current) return;
    pidiendoVideo.current = true;
    setVideo({ tipo: 'pidiendo' });
    try {
      const r = await urlDeVideo(clase.id);
      setVideo({ tipo: 'listo', url: r.url });
    } catch (e) {
      setVideo({ tipo: 'fallo', texto: e instanceof Error ? e.message : String(e) });
    } finally {
      pidiendoVideo.current = false;
    }
  }

  const subiendo = s.progreso !== null;
  const hayVideo = tieneVideo(clase);
  const sinMedir = hayVideo && clase.duracion_s == null;
  const puedeSubir = clase.origen === 'archivo' && clase.estado === 'borrador' && !subiendo;
  // el servidor la tiene «subiendo» y aquí no hay ninguna en curso: quedó a medias (se cerró la pestaña, se cortó la red…) o sigue
  // corriendo desde otra vista del panel (cambiar de pestaña desmonta esta, pero el PUT no se detiene)
  const subidaVieja = clase.estado === 'subiendo' && !subiendo;
  const linea = lineaDelVideo(clase);
  const n = clase.numero;

  return (
    <article aria-labelledby={idTituloDe(clase)} className={CARTA}>
      <Encabezado
        clase={clase}
        chip={<Chip texto={subiendo ? 'Subiendo' : etiquetaEstado(clase)} tono={subiendo ? 'subiendo' : tonoDe(clase.estado)} />}
      />
      <Datos clase={clase} />
      {clase.origen === 'liga' && <Linea>Es solo una referencia: no lleva video que subir.</Linea>}
      {clase.nombre_original && <Linea>Archivo: {clase.nombre_original}</Linea>}
      {/* siempre montado: al llenarse, el lector de pantalla lo anuncia */}
      <p role="status" className={linea ? 'm-0 mt-1 text-sm' : 'sr-only'}>
        {linea}
      </p>
      {clase.error && <p className="m-0 mt-2 text-sm text-error [overflow-wrap:anywhere]">Falló: {clase.error}</p>}
      {subidaVieja && (
        <p className="m-0 mt-2 text-sm text-secundario">Hay una subida en curso o que quedó a medias. Si no avanza, cancélala para empezar de nuevo.</p>
      )}

      {s.progreso && (
        <div className="mt-4">
          <p id={idEstado} className="m-0 text-sm">
            {textoDeProgreso(s.progreso)}
          </p>
          {s.progreso.fase === 'subiendo' && (
            <div
              role="progressbar"
              aria-labelledby={idEstado}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={s.progreso.pct}
              className="mt-2 h-2 overflow-hidden rounded-chico bg-elevada"
            >
              <div className="h-full bg-ambar transition-[width] duration-300" style={{ width: `${s.progreso.pct}%` }} />
            </div>
          )}
          {s.puedeCancelar && (
            <Boton className="mt-3" onClick={s.cancelar}>
              Cancelar
            </Boton>
          )}
        </div>
      )}
      <p role="status" className="sr-only">
        {s.progreso ? ANUNCIO[s.progreso.fase] : ''}
      </p>

      {s.nota && (
        <div className="mt-3">
          <Aviso tipo={s.nota.tipo === 'error' ? 'error' : 'aviso'}>{s.nota.texto}</Aviso>
        </div>
      )}

      {!subiendo && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {puedeSubir && (
            <label className={unir(claseBoton('secundario'), 'has-focus-visible:outline-2 has-focus-visible:outline-offset-3 has-focus-visible:outline-ambar-claro')}>
              <input
                type="file"
                accept={aceptar(limites)}
                className="sr-only"
                aria-label={`Subir video de la clase ${n}`}
                onChange={e => {
                  const archivo = e.target.files?.[0];
                  e.target.value = ''; // elegir el mismo archivo otra vez vuelve a avisar
                  if (archivo) void s.subir(archivo);
                }}
              />
              <Icono nombre="subir" />
              Subir video de la clase
            </label>
          )}
          {subidaVieja && (
            <Boton onClick={() => void s.soltarSubidaVieja()}>Cancelar subida</Boton>
          )}
          {sinMedir && (
            <Boton onClick={() => void s.medirOtraVez()} aria-label={`Medir la duración de la clase ${n}`}>
              Medir duración
            </Boton>
          )}
          {hayVideo && (
            <Boton
              aria-label={`${video.tipo === 'listo' ? 'Ocultar' : 'Ver'} video de la clase ${n}`}
              trabajando={video.tipo === 'pidiendo' && 'Abriendo…'}
              onClick={() => void verVideo()}
            >
              {video.tipo === 'listo' ? 'Ocultar video' : 'Ver video'}
            </Boton>
          )}
          <Boton id={idEditarDe(clase)} aria-label={`Editar la clase ${n}`} onClick={alEditar}>
            Editar
          </Boton>
          <Boton aria-label={`Archivar la clase ${n}`} onClick={alArchivar}>
            Archivar
          </Boton>
        </div>
      )}

      {video.tipo === 'fallo' && (
        <div className="mt-3">
          <Aviso tipo="error">{video.texto}</Aviso>
        </div>
      )}
      {video.tipo === 'listo' && (
        <video
          ref={reproductor}
          src={video.url}
          controls
          playsInline
          preload="metadata"
          aria-label={`Vista previa de la clase ${n}`}
          className="mt-3 block aspect-video w-full rounded-medio bg-hundido"
          onError={() => setVideo({ tipo: 'fallo', texto: TEXTO_VIDEO_ROTO })}
        >
          <track kind="captions" />
        </video>
      )}
    </article>
  );
}

export interface PropsTarjetaArchivada {
  clase: Clase;
  alRestaurar: () => void;
  /** Mientras se restaura, el botón dice «Restaurando…» y no acepta otro clic. */
  restaurando: boolean;
}

export function TarjetaArchivada({ clase, alRestaurar, restaurando }: PropsTarjetaArchivada) {
  const linea = lineaDelVideo(clase);
  return (
    <article aria-labelledby={idTituloDe(clase)} className={CARTA}>
      <Encabezado clase={clase} chip={<Chip texto="Archivada" tono="neutro" />} />
      <Datos clase={clase} />
      {linea && <Linea>{linea}</Linea>}
      <div className="mt-4">
        <Boton
          aria-label={`Restaurar la clase ${clase.numero}`}
          trabajando={restaurando && 'Restaurando…'}
          onClick={alRestaurar}
        >
          Restaurar
        </Boton>
      </div>
    </article>
  );
}
